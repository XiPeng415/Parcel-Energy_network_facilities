let network = null;
let nodes = null;
let edges = null;
let allNodes = [];
let allEdges = [];
let nodeMap = new Map();
let edgeMap = new Map();
let visibleTypes = new Set();
let degrees = new Map();
let adjacency = new Map();
let typeColorMap = new Map();

let networkMiniMap = null;
let networkParcelsGeoJSON = null;
let networkSelectedLayer = null;
let networkConnectedLayer = null;
let networkFacilityLayer = null;
let networkPathLayer = null;
let networkSharedParcelsByType = new Map();
let parcelIndex = new Map();

let restaurantPoints = null;
let cafePoints = null;
let barPoints = null;
let restaurantPaths = null;
let cafePaths = null;
let barPaths = null;

const MAX_PATHS_PER_TYPE = 3;
const MAX_FACILITY_DISTANCE_M = 1000;

let facilityPointIndex = {
  Restaurant: new Map(),
  Cafe: new Map(),
  Bar: new Map()
};

let pathIndex = {
  Restaurant: new Map(),
  Cafe: new Map(),
  Bar: new Map()
};

const FACILITY_TYPES = ["Restaurant", "Cafe", "Bar"];
const FACILITY_COLORS = {
  Restaurant: "#2f6de1",
  Cafe: "#16a085",
  Bar: "#e67e22"
};
const SHARED_PARCEL_COLORS = {
  Restaurant: "#8ab0ff",
  Cafe: "#63c7b4",
  Bar: "#f3b579"
};

const PARCEL_NUMERIC_PLACEHOLDER_KEYS = [
  "parcel_building_count",
  "parcel_total_footprint_m2",
  "parcel_total_gfa_m2",
  "parcel_total_embodied_carbon_kgco2e",
  "parcel_total_energy_kwh_yr",
  "parcel_total_cooling_kwh_yr",
  "parcel_total_lighting_kwh_yr",
  "parcel_total_equipment_kwh_yr",
  "parcel_total_water_kwh_yr"
];

let parcelToFacilities = new Map();
let facilityToParcels = new Map();

function toValueArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

function isZeroLike(v) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) < 1e-12;
}

function hasMissingParcelEnergyBundle(props) {
  const metricKeys = PARCEL_NUMERIC_PLACEHOLDER_KEYS.filter((k) =>
    Object.prototype.hasOwnProperty.call(props, k)
  );
  if (metricKeys.length === 0) return false;

  return metricKeys.every((k) => {
    const vals = toValueArray(props[k]);
    if (vals.length === 0) return true;
    return vals.every((v) => isZeroLike(v));
  });
}

function formatNodePropertyValue(nodeType, key, rawValue, missingEnergyBundle) {
  const vals = toValueArray(rawValue);
  if (vals.length === 0) return "-";

  if (
    nodeType === "Parcel" &&
    missingEnergyBundle &&
    PARCEL_NUMERIC_PLACEHOLDER_KEYS.includes(key) &&
    vals.every((v) => isZeroLike(v))
  ) {
    return "-";
  }

  return vals.join(", ");
}

function init() {
  const data = window.NETWORK_DATA;
  if (!data) {
    console.error("Missing NETWORK_DATA");
    return;
  }

  allNodes = data.nodes || [];
  allEdges = data.edges || [];

  rebuildGraphMaps();
  filterIsolatedParcels();
  buildParcelFacilityAdjacency();

  const rawTypes = (data.stats && data.stats.node_types) || [];
  rawTypes.forEach((t) => {
    if (t && t.type) visibleTypes.add(t.type);
  });

  initNetwork();
  buildTypeColorMap();
  createLegend();
  renderConnectionsLegend();
  preloadMapData();

  document.getElementById("nodeCount").textContent = allNodes.length;
  document.getElementById("edgeCount").textContent = allEdges.length;
  document.getElementById("visibleNodes").textContent = allNodes.length;
}

function filterIsolatedParcels() {
  const isolatedParcelIds = allNodes
    .filter((n) => n.type === "Parcel" && (degrees.get(n.id) || 0) === 0)
    .map((n) => n.id);

  if (isolatedParcelIds.length === 0) return;

  const dropSet = new Set(isolatedParcelIds);
  allNodes = allNodes.filter((n) => !dropSet.has(n.id));
  allEdges = allEdges.filter((e) => !dropSet.has(e.from) && !dropSet.has(e.to));

  // Recompute maps after removing isolated parcels.
  rebuildGraphMaps();
}

function rebuildGraphMaps() {
  nodeMap = new Map(allNodes.map((n) => [n.id, n]));
  edgeMap = new Map(allEdges.map((e, i) => [i, e]));
  degrees = new Map();
  adjacency = new Map();

  allEdges.forEach((e) => {
    degrees.set(e.from, (degrees.get(e.from) || 0) + 1);
    degrees.set(e.to, (degrees.get(e.to) || 0) + 1);
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    if (!adjacency.has(e.to)) adjacency.set(e.to, []);
    adjacency.get(e.from).push(e.to);
    adjacency.get(e.to).push(e.from);
  });
}

function buildParcelFacilityAdjacency() {
  parcelToFacilities = new Map();
  facilityToParcels = new Map();
  allEdges.forEach((e) => {
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) return;
    const aIsParcel = a.type === "Parcel";
    const bIsParcel = b.type === "Parcel";
    const aIsFacility = FACILITY_TYPES.includes(a.type);
    const bIsFacility = FACILITY_TYPES.includes(b.type);
    if (aIsParcel && bIsFacility) {
      if (!parcelToFacilities.has(a.id)) parcelToFacilities.set(a.id, []);
      parcelToFacilities.get(a.id).push(b.id);
      if (!facilityToParcels.has(b.id)) facilityToParcels.set(b.id, []);
      facilityToParcels.get(b.id).push(a.id);
    } else if (bIsParcel && aIsFacility) {
      if (!parcelToFacilities.has(b.id)) parcelToFacilities.set(b.id, []);
      parcelToFacilities.get(b.id).push(a.id);
      if (!facilityToParcels.has(a.id)) facilityToParcels.set(a.id, []);
      facilityToParcels.get(a.id).push(b.id);
    }
  });
}

function initNetwork() {
  const container = document.getElementById("network-canvas");

  const visNodes = allNodes.map((node) => ({
    id: node.id,
    label: node.label,
    title: `${node.label}\nType: ${node.type}`,
    color: {
      background: node.color,
      border: node.color,
      highlight: { background: "#e74c3c", border: "#c0392b" }
    },
    size: Math.max(4, Math.min(12, (node.size || 10) * 0.5)),
    font: { color: "#2c3e50", size: 10, face: "Helvetica Neue" },
    nodeType: node.type,
    nodeData: node
  }));

  const visEdges = allEdges.map((edge, idx) => ({
    id: idx,
    from: edge.from,
    to: edge.to,
    label: edge.label,
    arrows: "to",
    color: { color: "rgba(0,0,0,0.15)", highlight: "#3498db" },
    font: { color: "#7f8c8d", size: 9 },
    edgeData: edge
  }));

  nodes = new vis.DataSet(visNodes);
  edges = new vis.DataSet(visEdges);

  const options = {
    layout: { improvedLayout: true },
    nodes: {
      shape: "dot",
      borderWidth: 1,
      shadow: false,
      scaling: { min: 8, max: 30 }
    },
    edges: {
      width: 1,
      smooth: false,
      color: { color: "rgba(0,0,0,0.18)", highlight: "#3498db" }
    },
    physics: {
      enabled: true,
      solver: "forceAtlas2Based",
      stabilization: { iterations: 90, updateInterval: 25 },
      forceAtlas2Based: {
        gravitationalConstant: -50,
        centralGravity: 0.01,
        springLength: 120,
        springConstant: 0.08,
        damping: 0.4,
        avoidOverlap: 1.0
      },
      maxVelocity: 30,
      minVelocity: 0.1
    },
    interaction: {
      hover: true,
      tooltipDelay: 100,
      hideEdgesOnDrag: true,
      hideNodesOnDrag: true
    }
  };

  network = new vis.Network(container, { nodes, edges }, options);

  network.once("stabilizationIterationsDone", function() {
    network.setOptions({ physics: false });
  });

  network.on("click", function(params) {
    if (params.nodes.length > 0) {
      showNodeInfo(params.nodes[0]);
      showNetworkMiniMap(params.nodes[0]);
    } else if (params.edges.length > 0) {
      showEdgeInfo(params.edges[0]);
    } else {
      closeSidebar();
    }
  });

  network.on("selectNode", (params) => {
    document.getElementById("selectedInfo").textContent = `${params.nodes.length} node(s)`;
  });

  network.on("deselectNode", () => {
    document.getElementById("selectedInfo").textContent = "None";
  });
}

function showNodeInfo(nodeId) {
  const node = nodeMap.get(nodeId);
  if (!node) return;

  const sidebar = document.getElementById("sidebar");
  const title = document.getElementById("sidebarTitle");
  const content = document.getElementById("sidebarContent");

  title.textContent = node.label || node.id;

  let html = '<div class="info-section">';
  html += "<h3>Basic Information</h3>";
  html += `<div class="info-item"><div class="info-label">Node ID</div><div class="info-value">${node.id}</div></div>`;
  html += `<div class="info-item"><div class="info-label">Label</div><div class="info-value">${node.label || "-"}</div></div>`;
  html += `<div class="info-item"><div class="info-label">Type</div><div class="info-value">${node.type || "Unknown"}</div></div>`;
  html += `<div class="info-item"><div class="info-label">Degree</div><div class="info-value">${degrees.get(node.id) || 0}</div></div>`;
  html += "</div>";

  const props = node.properties || {};
  const propKeys = Object.keys(props);
  const missingEnergyBundle =
    node.type === "Parcel" && hasMissingParcelEnergyBundle(props);
  if (propKeys.length > 0) {
    html += '<div class="info-section">';
    html += "<h3>Key Properties</h3>";
    if (missingEnergyBundle) {
      html += '<div class="muted">No parcel energy/building record for this parcel in source dataset.</div>';
    }
    propKeys.sort().forEach((key) => {
      const value = formatNodePropertyValue(node.type, key, props[key], missingEnergyBundle);
      html += `<div class="info-item"><div class="info-label">${key}</div><div class="info-value">${value}</div></div>`;
    });
    html += "</div>";
  }

  if (node.type === "Parcel") {
    if (!networkMiniMap) {
      initializeNetworkMiniMap().then(() => updateConnectionsPanel(nodeId));
    } else {
      updateConnectionsPanel(nodeId);
    }
  }

  content.innerHTML = html;
  sidebar.classList.add("show");
}

function showEdgeInfo(edgeId) {
  const edge = edgeMap.get(edgeId);
  if (!edge) return;

  const fromNode = nodeMap.get(edge.from);
  const toNode = nodeMap.get(edge.to);

  const sidebar = document.getElementById("sidebar");
  const title = document.getElementById("sidebarTitle");
  const content = document.getElementById("sidebarContent");

  title.textContent = "Relationship Details";

  let html = '<div class="info-section">';
  html += "<h3>Relationship</h3>";
  html += `<div class="info-item"><div class="info-label">Predicate</div><div class="info-value">${edge.label}</div></div>`;
  html += `<div class="info-item"><div class="info-label">From</div><div class="info-value">${fromNode ? fromNode.label : edge.from}</div></div>`;
  html += `<div class="info-item"><div class="info-label">To</div><div class="info-value">${toNode ? toNode.label : edge.to}</div></div>`;
  html += "</div>";

  content.innerHTML = html;
  sidebar.classList.add("show");
  hideNetworkMiniMap();
}

function createLegend() {
  const legendContent = document.getElementById("legendContent");
  const typeCounts = {};

  allNodes.forEach((n) => {
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  });

  const types = Object.keys(typeCounts).sort();
  let html = "";

  types.forEach((type) => {
    const color = typeColorMap.get(type) || "#95a5a6";
    const checked = visibleTypes.has(type) ? "checked" : "";
    html += `
      <div class="legend-item">
        <input type="checkbox" ${checked} data-type="${type}" />
        <span class="legend-dot" style="background: ${color};"></span>
        <span>${type} (${typeCounts[type]})</span>
      </div>
    `;
  });

  legendContent.innerHTML = html;

  legendContent.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const t = cb.getAttribute("data-type");
      if (cb.checked) {
        visibleTypes.add(t);
      } else {
        visibleTypes.delete(t);
      }
      applyTypeFilter();
    });
  });
}

function buildTypeColorMap() {
  typeColorMap = new Map();
  allNodes.forEach((n) => {
    if (!typeColorMap.has(n.type)) typeColorMap.set(n.type, n.color);
  });
}

function applyTypeFilter() {
  const updates = [];
  let visibleCount = 0;

  allNodes.forEach((n) => {
    const isVisible = visibleTypes.has(n.type);
    updates.push({ id: n.id, hidden: !isVisible });
    if (isVisible) visibleCount += 1;
  });

  nodes.update(updates);
  document.getElementById("visibleNodes").textContent = visibleCount;
}

const searchInput = document.getElementById("searchInput");
if (searchInput) {
  searchInput.addEventListener("input", function(e) {
    const term = e.target.value.toLowerCase().trim();
    if (!term) {
      network.selectNodes([]);
      return;
    }

    const matches = allNodes
      .filter((n) => (n.label || "").toLowerCase().includes(term))
      .map((n) => n.id);

    if (matches.length > 0) {
      network.selectNodes(matches);
      network.focus(matches[0], { scale: 1.5, animation: true });
    }
  });
}

function resetView() {
  network.fit({ animation: { duration: 800, easingFunction: "easeInOutQuad" } });
}

function fitNetwork() {
  network.fit();
}

function runLayout() {
  if (!network) return;
  network.setOptions({ physics: true });
  setTimeout(() => {
    network.setOptions({ physics: false });
  }, 1500);
}

function closeSidebar() {
  document.getElementById("sidebar").classList.remove("show");
  if (network) network.unselectAll();
  hideNetworkMiniMap();
}

function toggleLegend() {
  const legend = document.getElementById("legendPanel");
  legend.style.display = legend.style.display === "none" ? "block" : "none";
}

async function preloadMapData() {
  if (networkParcelsGeoJSON && restaurantPoints && cafePoints && barPoints && restaurantPaths && cafePaths && barPaths) {
    return;
  }

  const files = [
    "parcels.geojson",
    "Restaurants_wgs84.geojson",
    "Cafes_wgs84.geojson",
    "Bars_wgs84.geojson",
    "Restaurant_network_paths_wgs84_simplified.geojson",
    "Cafe_network_paths_wgs84_simplified.geojson",
    "Bar_network_paths_wgs84_simplified.geojson"
  ];

  try {
    const [parcelsRes, restaurantRes, cafeRes, barRes, restaurantPathRes, cafePathRes, barPathRes] = await Promise.all(
      files.map((f) => fetch(f))
    );

    if (parcelsRes.ok) networkParcelsGeoJSON = await parcelsRes.json();
    if (restaurantRes.ok) restaurantPoints = await restaurantRes.json();
    if (cafeRes.ok) cafePoints = await cafeRes.json();
    if (barRes.ok) barPoints = await barRes.json();
    if (restaurantPathRes.ok) restaurantPaths = await restaurantPathRes.json();
    if (cafePathRes.ok) cafePaths = await cafePathRes.json();
    if (barPathRes.ok) barPaths = await barPathRes.json();

    if (networkParcelsGeoJSON) {
      parcelIndex = new Map();
      networkParcelsGeoJSON.features.forEach((f) => {
        const name = f.properties ? f.properties.Name : null;
        if (name) parcelIndex.set(name, f);
      });
    }

    buildFacilityPointIndex();
    buildPathIndex();
  } catch (err) {
    console.error("Preload map data failed:", err);
  }
}

async function initializeNetworkMiniMap() {
  if (networkMiniMap) return;

  const mapSection = document.getElementById("networkMapSection");
  const mapStatus = document.getElementById("networkMapStatus");

  try {
    networkMiniMap = L.map("networkMiniMap", {
      center: [1.35, 103.82],
      zoom: 12,
      zoomControl: false,
      preferCanvas: true,
      zoomAnimation: false,
      fadeAnimation: false
    });

    networkMiniMap.createPane("pathsPane");
    networkMiniMap.getPane("pathsPane").style.zIndex = 450;
    networkMiniMap.createPane("pointsPane");
    networkMiniMap.getPane("pointsPane").style.zIndex = 460;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "&copy; OpenStreetMap &copy; CARTO",
      subdomains: "abcd",
      maxZoom: 19
    }).addTo(networkMiniMap);

    if (!networkParcelsGeoJSON) {
      const response = await fetch("parcels.geojson");
      if (!response.ok) throw new Error("parcels.geojson not found");
      networkParcelsGeoJSON = await response.json();
      parcelIndex = new Map();
      networkParcelsGeoJSON.features.forEach((f) => {
        const name = f.properties ? f.properties.Name : null;
        if (name) parcelIndex.set(name, f);
      });
    }

    if (!restaurantPoints) {
      const res = await fetch("Restaurants_wgs84.geojson");
      if (res.ok) restaurantPoints = await res.json();
    }
    if (!cafePoints) {
      const res = await fetch("Cafes_wgs84.geojson");
      if (res.ok) cafePoints = await res.json();
    }
    if (!barPoints) {
      const res = await fetch("Bars_wgs84.geojson");
      if (res.ok) barPoints = await res.json();
    }

    if (!restaurantPaths) {
      const res = await fetch("Restaurant_network_paths_wgs84_simplified.geojson");
      if (res.ok) restaurantPaths = await res.json();
    }
    if (!cafePaths) {
      const res = await fetch("Cafe_network_paths_wgs84_simplified.geojson");
      if (res.ok) cafePaths = await res.json();
    }
    if (!barPaths) {
      const res = await fetch("Bar_network_paths_wgs84_simplified.geojson");
      if (res.ok) barPaths = await res.json();
    }

    buildFacilityPointIndex();
    buildPathIndex();

    if (mapStatus) mapStatus.textContent = "";
    if (mapSection) mapSection.style.display = "block";
  } catch (err) {
    if (mapStatus) mapStatus.textContent = "Missing parcels.geojson for mini-map.";
    console.error(err);
  }
}

function showNetworkMiniMap(nodeId) {
  const mapSection = document.getElementById("networkMapSection");
  if (mapSection) mapSection.style.display = "block";

  if (!networkMiniMap) {
    initializeNetworkMiniMap().then(() => {
      updateNetworkMiniMap(nodeId);
      setTimeout(() => {
        if (networkMiniMap) networkMiniMap.invalidateSize();
      }, 50);
    });
  } else {
    updateNetworkMiniMap(nodeId);
    setTimeout(() => {
      if (networkMiniMap) networkMiniMap.invalidateSize();
    }, 50);
  }
}

function extractLocalName(id) {
  if (!id) return id;
  if (id.includes("#")) return id.split("#").pop();
  if (id.includes("/")) return id.split("/").pop();
  return id;
}

function normalizeParcelName(name) {
  if (!name) return name;
  if (name.startsWith("Parcel_")) return name.replace("Parcel_", "");
  return name;
}

function normKey(v) {
  if (!v) return "";
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function buildFacilityPointIndex() {
  facilityPointIndex = {
    Restaurant: new Map(),
    Cafe: new Map(),
    Bar: new Map()
  };

  if (restaurantPoints) {
    restaurantPoints.features.forEach((f) => {
      const nameVal = f.properties ? f.properties.name : null;
      if (!nameVal) return;
      const key = normKey(`Restaurant_${nameVal}`);
      facilityPointIndex.Restaurant.set(key, f);
    });
  }
  if (cafePoints) {
    cafePoints.features.forEach((f) => {
      const nameVal = f.properties ? f.properties.name : null;
      if (!nameVal) return;
      const key = normKey(`Cafe_${nameVal}`);
      facilityPointIndex.Cafe.set(key, f);
    });
  }
  if (barPoints) {
    barPoints.features.forEach((f) => {
      const nameVal = f.properties ? f.properties.name : null;
      if (!nameVal) return;
      const key = normKey(`Bar_${nameVal}`);
      facilityPointIndex.Bar.set(key, f);
    });
  }
}

function buildPathIndex() {
  pathIndex = {
    Restaurant: new Map(),
    Cafe: new Map(),
    Bar: new Map()
  };

  function indexPaths(pathData, type) {
    if (!pathData) return;
    pathData.features.forEach((f) => {
      const cid = f.properties ? f.properties.centroid_id : null;
      if (!cid) return;
      if (!pathIndex[type].has(cid)) pathIndex[type].set(cid, []);
      pathIndex[type].get(cid).push(f);
    });
  }

  indexPaths(restaurantPaths, "Restaurant");
  indexPaths(cafePaths, "Cafe");
  indexPaths(barPaths, "Bar");
}

function renderConnectionsLegend() {
  const legend = document.getElementById("connectionsLegend");
  if (!legend) return;
  legend.innerHTML = FACILITY_TYPES.map((t) => {
    return `<div class="legend-item"><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${t}</div>`;
  }).join("");
}

function getFacilityDistances(centroidId) {
  const out = [];

  function collect(pathData, type, nameKey, distanceKey) {
    if (!pathData) return;
    pathData.features.forEach((f) => {
      const p = f.properties || {};
      if (p.centroid_id !== centroidId) return;
      out.push({
        type,
        name: p[nameKey],
        distance: p[distanceKey]
      });
    });
  }

  collect(restaurantPaths, "Restaurant", "restaurant_name", "network_distance_m");
  collect(cafePaths, "Cafe", "cafe_name", "network_distance_m");
  collect(barPaths, "Bar", "bar_name", "network_distance_m");

  return out;
}

function normalizeFacilityLabel(type, label) {
  if (!label) return "";
  let v = String(label);
  v = v.replace(`${type}: `, "");
  v = v.replace(/^Restaurant_/, "");
  v = v.replace(/^Cafe_/, "");
  v = v.replace(/^Bar_/, "");
  return v;
}

function getConnectedFacilitiesWithDistances(parcelNodeId) {
  const centroidId = normalizeParcelName(extractLocalName(parcelNodeId));
  const connectedFacilities = parcelToFacilities.get(parcelNodeId) || [];
  const distances = getFacilityDistances(centroidId);
  const distanceMap = new Map();
  const distancesByType = {};

  distances.forEach((d) => {
    if (!d || !d.type) return;
    const numericDist = Number(d.distance);
    if (!Number.isFinite(numericDist)) return;
    const normName = d.name == null ? "" : normKey(d.name);
    if (normName) {
      distanceMap.set(`${d.type}::${normName}`, numericDist);
    }
    if (!distancesByType[d.type]) distancesByType[d.type] = [];
    distancesByType[d.type].push(numericDist);
  });

  const records = [];
  connectedFacilities.forEach((fid) => {
    const n = nodeMap.get(fid);
    if (!n || !FACILITY_TYPES.includes(n.type)) return;
    const label = n.label || extractLocalName(n.id);
    const cleanLabel = normalizeFacilityLabel(n.type, label);
    let dist = distanceMap.get(`${n.type}::${normKey(cleanLabel)}`);
    if (dist == null && distancesByType[n.type] && distancesByType[n.type].length === 1) {
      dist = distancesByType[n.type][0];
    }
    dist = Number.isFinite(Number(dist)) ? Number(dist) : null;
    records.push({ id: fid, type: n.type, label, dist, node: n });
  });

  return { centroidId, records };
}

function updateConnectionsPanel(parcelNodeId) {
  const panel = document.getElementById("connectionsContent");
  if (!panel) return;
  if (!parcelNodeId) {
    panel.innerHTML = '<p class="muted">Select a parcel to see connected facilities, distances, and shared parcels.</p>';
    return;
  }

  const { records } = getConnectedFacilitiesWithDistances(parcelNodeId);
  const visibleRecords = records.filter((r) => r.dist != null && r.dist <= MAX_FACILITY_DISTANCE_M);

  const byType = {};
  visibleRecords.forEach((record) => {
    if (!byType[record.type]) byType[record.type] = [];
    byType[record.type].push({ label: record.label, dist: record.dist, id: record.id });
  });

  const facilitiesHtml = FACILITY_TYPES.map((t) => {
    const items = byType[t] || [];
    if (items.length === 0) {
      return `<div class="connections-section"><h4>${t}</h4><div class="muted">No connected ${t} within ${MAX_FACILITY_DISTANCE_M} m.</div></div>`;
    }
    const rows = items.map((item) => {
      const dist = item.dist != null ? `${Number(item.dist).toFixed(2)} m` : "-";
      return `<div class="connections-row"><div><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${item.label}</div><div>${dist}</div></div>`;
    }).join("");
    return `<div class="connections-section"><h4>${t}</h4>${rows}</div>`;
  }).join("");

  const sharedRows = [];
  visibleRecords.forEach((record) => {
    const fid = record.id;
    const facility = nodeMap.get(fid);
    if (!facility || !FACILITY_TYPES.includes(facility.type)) return;
    const parcels = (facilityToParcels.get(fid) || []).filter((pid) => pid !== parcelNodeId);
    const sample = parcels.slice(0, 8).map((pid) => {
      const n = nodeMap.get(pid);
      return n ? n.label || extractLocalName(n.id) : extractLocalName(pid);
    }).join(", ");
    sharedRows.push(
      `<div class="connections-row"><div><span class="type-dot" style="background:${FACILITY_COLORS[facility.type]}"></span>${facility.label || extractLocalName(facility.id)}</div><div>${parcels.length}${sample ? `: ${sample}${parcels.length > 8 ? " ..." : ""}` : ""}</div></div>`
    );
  });

  const sharedHtml = sharedRows.length > 0
    ? `<div class="connections-section"><h4>Shared Parcels By Facility</h4>${sharedRows.join("")}</div>`
    : `<div class="connections-section"><h4>Shared Parcels By Facility</h4><div class="muted">No shared parcels found within ${MAX_FACILITY_DISTANCE_M} m filtered facilities.</div></div>`;

  panel.innerHTML = `<p class="muted">Showing only facilities within ${MAX_FACILITY_DISTANCE_M} m network distance.</p>${facilitiesHtml}${sharedHtml}`;
}

function updateNetworkMiniMap(nodeId) {
  if (!networkParcelsGeoJSON || !networkMiniMap) return;

  if (networkSelectedLayer) networkMiniMap.removeLayer(networkSelectedLayer);
  if (networkConnectedLayer) networkMiniMap.removeLayer(networkConnectedLayer);
  if (networkFacilityLayer) networkMiniMap.removeLayer(networkFacilityLayer);
  if (networkPathLayer) networkMiniMap.removeLayer(networkPathLayer);
  networkSharedParcelsByType.forEach((layer) => networkMiniMap.removeLayer(layer));
  networkSharedParcelsByType = new Map();

  const connectedNodeIds = adjacency.get(nodeId) || [];
  const localNodeId = normalizeParcelName(extractLocalName(nodeId));
  const connectedLocalIds = connectedNodeIds.map((id) => normalizeParcelName(extractLocalName(id)));
  const { centroidId, records } = getConnectedFacilitiesWithDistances(nodeId);
  const visibleFacilityRecords = records.filter((r) => r.dist != null && r.dist <= MAX_FACILITY_DISTANCE_M);
  const visibleFacilityIds = new Set(visibleFacilityRecords.map((r) => r.id));

  const connectedFeatures = connectedLocalIds.map((id) => parcelIndex.get(id)).filter(Boolean);
  if (connectedFeatures.length > 0) {
    networkConnectedLayer = L.geoJSON({ type: "FeatureCollection", features: connectedFeatures }, {
      style: {
        fillColor: "#9b59b6",
        fillOpacity: 0.45,
        color: "#8e44ad",
        weight: 2,
        opacity: 0.8
      }
    }).addTo(networkMiniMap);
  }

  const selectedFeature = parcelIndex.get(localNodeId);
  const mapStatus = document.getElementById("networkMapStatus");

  if (selectedFeature) {
    networkSelectedLayer = L.geoJSON({ type: "FeatureCollection", features: [selectedFeature] }, {
      style: {
        fillColor: "#ff3b30",
        fillOpacity: 0.85,
        color: "#b00020",
        weight: 4,
        opacity: 1
      }
    }).addTo(networkMiniMap);
    if (mapStatus) {
      mapStatus.textContent = visibleFacilityRecords.length === 0
        ? `No connected F&B facilities within ${MAX_FACILITY_DISTANCE_M} m for this parcel.`
        : "";
    }
    fitNetworkMap();
  } else {
    if (mapStatus) mapStatus.textContent = "No matching parcel for this node.";
    networkMiniMap.setView([1.35, 103.82], 12, { animate: false });
  }

  if (nodeMap.get(nodeId)?.type === "Parcel") {
    const facilities = (parcelToFacilities.get(nodeId) || []).filter((fid) => visibleFacilityIds.has(fid));
    const byType = {};
    facilities.forEach((fid) => {
      const facility = nodeMap.get(fid);
      if (!facility || !FACILITY_TYPES.includes(facility.type)) return;
      if (!byType[facility.type]) byType[facility.type] = new Set();
      const parcels = facilityToParcels.get(fid) || [];
      parcels.forEach((pid) => {
        if (pid !== nodeId) byType[facility.type].add(pid);
      });
    });

    Object.keys(byType).forEach((type) => {
      const features = Array.from(byType[type])
        .map((pid) => normalizeParcelName(extractLocalName(pid)))
        .map((id) => parcelIndex.get(id))
        .filter(Boolean)
        .slice(0, 200);
      if (features.length === 0) return;
      const layer = L.geoJSON({ type: "FeatureCollection", features }, {
        style: {
          fillColor: SHARED_PARCEL_COLORS[type],
          fillOpacity: 0.25,
          color: SHARED_PARCEL_COLORS[type],
          weight: 1,
          opacity: 0.6
        }
      }).addTo(networkMiniMap);
      networkSharedParcelsByType.set(type, layer);
    });
  }

  updateMapLegend(nodeId);

  const pathFeatures = [];

  function addPaths(type, nameKey, color, prefix) {
    const matches = (pathIndex[type].get(centroidId) || [])
      .filter((f) => {
        const p = f.properties || {};
        const dist = Number(p.network_distance_m ?? p.euclidean_distance_m ?? Number.POSITIVE_INFINITY);
        return Number.isFinite(dist) && dist <= MAX_FACILITY_DISTANCE_M;
      })
      .sort((a, b) => {
        const da = Number(a.properties?.network_distance_m ?? a.properties?.euclidean_distance_m ?? Number.POSITIVE_INFINITY);
        const db = Number(b.properties?.network_distance_m ?? b.properties?.euclidean_distance_m ?? Number.POSITIVE_INFINITY);
        return da - db;
      })
      .slice(0, MAX_PATHS_PER_TYPE);
    matches.forEach((f) => pathFeatures.push({ feature: f, color, type }));
  }

  addPaths("Restaurant", "restaurant_name", FACILITY_COLORS.Restaurant, "Restaurant_");
  addPaths("Cafe", "cafe_name", FACILITY_COLORS.Cafe, "Cafe_");
  addPaths("Bar", "bar_name", FACILITY_COLORS.Bar, "Bar_");

  if (pathFeatures.length > 0) {
    const pathGroup = L.featureGroup();
    const endpointGroup = L.featureGroup();
    pathFeatures.forEach((p) => {
      L.geoJSON(p.feature, {
        pane: "pathsPane",
        style: {
          color: p.color,
          weight: 2,
          opacity: 0.9
        }
      }).addTo(pathGroup);

      const geom = p.feature.geometry || {};
      let coords = null;
      if (geom.type === "LineString" && Array.isArray(geom.coordinates)) {
        coords = geom.coordinates[geom.coordinates.length - 1];
      } else if (geom.type === "MultiLineString" && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
        const lastLine = geom.coordinates[geom.coordinates.length - 1];
        coords = lastLine[lastLine.length - 1];
      }
      if (coords && coords.length >= 2) {
        L.circleMarker([coords[1], coords[0]], {
          pane: "pointsPane",
          radius: 6,
          fillColor: p.color,
          color: "#ffffff",
          weight: 1,
          fillOpacity: 0.9
        }).addTo(endpointGroup);
      }
    });
    networkPathLayer = pathGroup.addTo(networkMiniMap);
    networkFacilityLayer = endpointGroup.addTo(networkMiniMap);
  }
}

function updateMapLegend(nodeId) {
  const legend = document.getElementById("networkMapLegend");
  if (!legend) return;
  const localId = normalizeParcelName(extractLocalName(nodeId));
  let html = `<div class="legend-item"><span class="legend-dot" style="background:#ff3b30;"></span>Selected Parcel: ${localId}</div>`;
  html += `<div class="legend-item"><span class="legend-dot" style="background:#9b59b6;"></span>Connected Parcels (direct graph)</div>`;
  FACILITY_TYPES.forEach((type) => {
    html += `<div class="legend-item"><span class="legend-dot" style="background:${FACILITY_COLORS[type]};"></span>${type} (point + path)</div>`;
  });
  FACILITY_TYPES.forEach((type) => {
    if (networkSharedParcelsByType.has(type)) {
      html += `<div class="legend-item"><span class="legend-dot" style="background:${SHARED_PARCEL_COLORS[type]};"></span>Shared Parcels via ${type}</div>`;
    }
  });
  legend.innerHTML = html;
}

function fitNetworkMap() {
  if (!networkMiniMap) return;
  const layers = [];
  if (networkSelectedLayer) layers.push(networkSelectedLayer);
  if (networkConnectedLayer) layers.push(networkConnectedLayer);
  if (networkPathLayer) layers.push(networkPathLayer);
  if (networkFacilityLayer) layers.push(networkFacilityLayer);
  networkSharedParcelsByType.forEach((layer) => layers.push(layer));
  if (layers.length === 0) return;
  const group = L.featureGroup(layers);
  if (group.getBounds().isValid()) {
    networkMiniMap.fitBounds(group.getBounds(), {
      padding: [30, 30],
      maxZoom: 14,
      animate: false
    });
  }
}

function hideNetworkMiniMap() {
  const mapSection = document.getElementById("networkMapSection");
  if (mapSection) mapSection.style.display = "none";
}

window.fitNetworkMap = fitNetworkMap;
