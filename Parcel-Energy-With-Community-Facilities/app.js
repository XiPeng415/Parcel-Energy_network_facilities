let network = null;
let nodes = null;
let edges = null;
let allNodes = [];
let allEdges = [];
let nodeMap = new Map();
let edgeMap = new Map();
let visibleTypes = new Set();
let degrees = new Map();
const MAX_ROAD_NODES = 0;
let adjacency = new Map();
let typeColorMap = new Map();

let networkMiniMap = null;
let networkParcelsGeoJSON = null;
let networkAllParcelsLayer = null;
let networkSelectedLayer = null;
let networkConnectedLayer = null;
let networkFacilityLayer = null;
let networkPathLayer = null;
let networkSharedParcelsLayer = null;
let networkSharedParcelsByType = new Map();
let parcelIndex = new Map();

let hawkerPoints = null;
let libraryPoints = null;
let museumPoints = null;
let sportPoints = null;
let hawkerPaths = null;
let libraryPaths = null;
let museumPaths = null;
let sportPaths = null;
const MAX_PATHS_PER_TYPE = 1;
let facilityPointIndex = {
  HawkerCentre: new Map(),
  Library: new Map(),
  Museum: new Map(),
  SportFacility: new Map()
};
let pathIndex = {
  HawkerCentre: new Map(),
  Library: new Map(),
  Museum: new Map(),
  SportFacility: new Map()
};

const FACILITY_TYPES = ['HawkerCentre', 'Library', 'Museum', 'SportFacility'];
const FACILITY_COLORS = {
  HawkerCentre: '#1f2a44',
  Library: '#f4b400',
  Museum: '#0f9d58',
  SportFacility: '#db4437'
};
const SHARED_PARCEL_COLORS = {
  HawkerCentre: '#3f4e6b',
  Library: '#f9c74f',
  Museum: '#34a853',
  SportFacility: '#e57373'
};

let parcelToFacilities = new Map();
let facilityToParcels = new Map();

function init() {
  const data = window.NETWORK_DATA;
  if (!data) {
    console.error('Missing NETWORK_DATA');
    return;
  }

  allNodes = data.nodes || [];
  allEdges = data.edges || [];

  degrees = new Map();
  adjacency = new Map();
  allEdges.forEach(e => {
    degrees.set(e.from, (degrees.get(e.from) || 0) + 1);
    degrees.set(e.to, (degrees.get(e.to) || 0) + 1);
    if (!adjacency.has(e.from)) adjacency.set(e.from, []);
    if (!adjacency.has(e.to)) adjacency.set(e.to, []);
    adjacency.get(e.from).push(e.to);
    adjacency.get(e.to).push(e.from);
  });

  // Reduce road nodes (NamedStreet) to top-N by degree to avoid dense clump
  const roadIds = allNodes.filter(n => n.type === 'NamedStreet').map(n => n.id);
  if (MAX_ROAD_NODES === 0) {
    allNodes = allNodes.filter(n => n.type !== 'NamedStreet');
  } else if (roadIds.length > MAX_ROAD_NODES) {
    const roadSorted = roadIds.sort((a, b) => (degrees.get(b) || 0) - (degrees.get(a) || 0));
    const keepRoad = new Set(roadSorted.slice(0, MAX_ROAD_NODES));
    allNodes = allNodes.filter(n => n.type !== 'NamedStreet' || keepRoad.has(n.id));
  }

  const allowedIds = new Set(allNodes.map(n => n.id));
  allEdges = allEdges.filter(e => allowedIds.has(e.from) && allowedIds.has(e.to));

  // Rebuild maps after filtering
  nodeMap = new Map(allNodes.map(n => [n.id, n]));
  edgeMap = new Map(allEdges.map((e, i) => [i, e]));

  degrees = new Map();
  allEdges.forEach(e => {
    degrees.set(e.from, (degrees.get(e.from) || 0) + 1);
    degrees.set(e.to, (degrees.get(e.to) || 0) + 1);
  });

  // Build parcel <-> facility adjacency
  parcelToFacilities = new Map();
  facilityToParcels = new Map();
  allEdges.forEach(e => {
    const a = nodeMap.get(e.from);
    const b = nodeMap.get(e.to);
    if (!a || !b) return;
    const aIsParcel = a.type === 'Parcel';
    const bIsParcel = b.type === 'Parcel';
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

  const rawTypes = (data.stats && data.stats.node_types) || [];
  rawTypes.forEach(t => {
    if (t && t.type) visibleTypes.add(t.type);
  });

  initNetwork();
  buildTypeColorMap();
  createLegend();
  renderConnectionsLegend();
  // Preload map data in background to make first click faster
  preloadMapData();

  document.getElementById('nodeCount').textContent = allNodes.length;
  document.getElementById('edgeCount').textContent = allEdges.length;
  document.getElementById('visibleNodes').textContent = allNodes.length;
}

function initNetwork() {
  const container = document.getElementById('network-canvas');

  const visNodes = allNodes.map(node => ({
    id: node.id,
    label: node.label,
    title: `${node.label}\nType: ${node.type}`,
    color: {
      background: node.color,
      border: node.color,
      highlight: { background: '#e74c3c', border: '#c0392b' }
    },
    size: Math.max(4, Math.min(12, (node.size || 10) * 0.5)),
    font: { color: '#2c3e50', size: 10, face: 'Helvetica Neue' },
    nodeType: node.type,
    nodeData: node
  }));

  const visEdges = allEdges.map((edge, idx) => ({
    id: idx,
    from: edge.from,
    to: edge.to,
    label: edge.label,
    arrows: 'to',
    color: { color: 'rgba(0,0,0,0.15)', highlight: '#3498db' },
    font: { color: '#7f8c8d', size: 9 },
    edgeData: edge
  }));

  nodes = new vis.DataSet(visNodes);
  edges = new vis.DataSet(visEdges);

  const options = {
    layout: { improvedLayout: true },
    nodes: {
      shape: 'dot',
      borderWidth: 1,
      shadow: false,
      scaling: { min: 8, max: 30 }
    },
    edges: {
      width: 1,
      smooth: false,
      color: { color: 'rgba(0,0,0,0.18)', highlight: '#3498db' }
    },
    physics: {
      enabled: true,
      solver: 'forceAtlas2Based',
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

  // Stop motion after short stabilization
  network.once('stabilizationIterationsDone', function() {
    network.setOptions({ physics: false });
  });

  network.on('click', function(params) {
    if (params.nodes.length > 0) {
      showNodeInfo(params.nodes[0]);
      showNetworkMiniMap(params.nodes[0]);
    } else if (params.edges.length > 0) {
      showEdgeInfo(params.edges[0]);
    } else {
      closeSidebar();
    }
  });

  network.on('selectNode', params => {
    document.getElementById('selectedInfo').textContent = `${params.nodes.length} node(s)`;
  });

  network.on('deselectNode', () => {
    document.getElementById('selectedInfo').textContent = 'None';
  });
}

function showNodeInfo(nodeId) {
  const node = nodeMap.get(nodeId);
  if (!node) return;

  const sidebar = document.getElementById('sidebar');
  const title = document.getElementById('sidebarTitle');
  const content = document.getElementById('sidebarContent');

  title.textContent = node.label || node.id;

  let html = '<div class="info-section">';
  html += '<h3>Basic Information</h3>';
  html += `<div class="info-item"><div class="info-label">Node ID</div><div class="info-value">${node.id}</div></div>`;
  html += `<div class="info-item"><div class="info-label">Label</div><div class="info-value">${node.label || '-'}</div></div>`;
  html += `<div class="info-item"><div class="info-label">Type</div><div class="info-value">${node.type || 'Unknown'}</div></div>`;
  html += `<div class="info-item"><div class="info-label">Degree</div><div class="info-value">${degrees.get(node.id) || 0}</div></div>`;
  html += '</div>';

  const props = node.properties || {};
  const connectedNodeIds = adjacency.get(nodeId) || [];
  const propKeys = Object.keys(props);
  if (propKeys.length > 0) {
    html += '<div class="info-section">';
    html += '<h3>Key Properties</h3>';
    propKeys.sort().forEach(key => {
      const vals = Array.isArray(props[key]) ? props[key] : [props[key]];
      const value = vals.join(', ');
      html += `<div class="info-item"><div class="info-label">${key}</div><div class="info-value">${value}</div></div>`;
    });
    html += '</div>';
  }

  // Update connections panel for parcels
  if (node.type === 'Parcel') {
    if (!networkMiniMap) {
      initializeNetworkMiniMap().then(() => updateConnectionsPanel(nodeId));
    } else {
      updateConnectionsPanel(nodeId);
    }
  }

  content.innerHTML = html;
  sidebar.classList.add('show');
}

function showEdgeInfo(edgeId) {
  const edge = edgeMap.get(edgeId);
  if (!edge) return;

  const fromNode = nodeMap.get(edge.from);
  const toNode = nodeMap.get(edge.to);

  const sidebar = document.getElementById('sidebar');
  const title = document.getElementById('sidebarTitle');
  const content = document.getElementById('sidebarContent');

  title.textContent = 'Relationship Details';

  let html = '<div class="info-section">';
  html += '<h3>Relationship</h3>';
  html += `<div class="info-item"><div class="info-label">Predicate</div><div class="info-value">${edge.label}</div></div>`;
  html += `<div class="info-item"><div class="info-label">From</div><div class="info-value">${fromNode ? fromNode.label : edge.from}</div></div>`;
  html += `<div class="info-item"><div class="info-label">To</div><div class="info-value">${toNode ? toNode.label : edge.to}</div></div>`;
  html += '</div>';

  content.innerHTML = html;
  sidebar.classList.add('show');
  hideNetworkMiniMap();
}

function createLegend() {
  const legendContent = document.getElementById('legendContent');
  const typeCounts = {};

  allNodes.forEach(n => {
    typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
  });

  const types = Object.keys(typeCounts).sort();
  let html = '';

  types.forEach(type => {
    const color = typeColorMap.get(type) || '#95a5a6';
    const checked = visibleTypes.has(type) ? 'checked' : '';
    html += `
      <div class="legend-item">
        <input type="checkbox" ${checked} data-type="${type}" />
        <span class="legend-dot" style="background: ${color};"></span>
        <span>${type} (${typeCounts[type]})</span>
      </div>
    `;
  });

  legendContent.innerHTML = html;

  legendContent.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const t = cb.getAttribute('data-type');
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
  allNodes.forEach(n => {
    if (!typeColorMap.has(n.type)) typeColorMap.set(n.type, n.color);
  });
}

function applyTypeFilter() {
  const updates = [];
  let visibleCount = 0;

  allNodes.forEach(n => {
    const isVisible = visibleTypes.has(n.type);
    updates.push({ id: n.id, hidden: !isVisible });
    if (isVisible) visibleCount += 1;
  });

  nodes.update(updates);
  document.getElementById('visibleNodes').textContent = visibleCount;
}

// Search
const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', function(e) {
    const term = e.target.value.toLowerCase().trim();
    if (!term) {
      network.selectNodes([]);
      return;
    }

    const matches = allNodes
      .filter(n => (n.label || '').toLowerCase().includes(term))
      .map(n => n.id);

    if (matches.length > 0) {
      network.selectNodes(matches);
      network.focus(matches[0], { scale: 1.5, animation: true });
    }
  });
}

function resetView() {
  network.fit({ animation: { duration: 800, easingFunction: 'easeInOutQuad' } });
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
  document.getElementById('sidebar').classList.remove('show');
  if (network) network.unselectAll();
  hideNetworkMiniMap();
}

function toggleLegend() {
  const legend = document.getElementById('legendPanel');
  legend.style.display = legend.style.display === 'none' ? 'block' : 'none';
}

// =====================
// NETWORK VIEW MINI-MAP
// =====================
// Preload map data in background to speed up first click
async function preloadMapData() {
  if (networkParcelsGeoJSON && hawkerPoints && libraryPoints && museumPoints && sportPoints &&
      hawkerPaths && libraryPaths && museumPaths && sportPaths) {
    return;
  }

  const files = [
    'parcels.geojson',
    'HawkerCentres_wgs84.geojson',
    'Libraries_wgs84.geojson',
    'Museums_wgs84.geojson',
    'SportFacilities_wgs84.geojson',
    'HawkerCentres_network_paths_wgs84_simplified.geojson',
    'Libraries_network_paths_wgs84_simplified.geojson',
    'Museum_network_paths_wgs84_simplified.geojson',
    'SportFacility_network_paths_wgs84_simplified.geojson'
  ];

  try {
    const [
      parcelsRes, hawkerRes, libRes, museumRes, sportRes,
      hawkerPathRes, libPathRes, museumPathRes, sportPathRes
    ] = await Promise.all(files.map(f => fetch(f)));

    if (parcelsRes.ok) networkParcelsGeoJSON = await parcelsRes.json();
    if (hawkerRes.ok) hawkerPoints = await hawkerRes.json();
    if (libRes.ok) libraryPoints = await libRes.json();
    if (museumRes.ok) museumPoints = await museumRes.json();
    if (sportRes.ok) sportPoints = await sportRes.json();
    if (hawkerPathRes.ok) hawkerPaths = await hawkerPathRes.json();
    if (libPathRes.ok) libraryPaths = await libPathRes.json();
    if (museumPathRes.ok) museumPaths = await museumPathRes.json();
    if (sportPathRes.ok) sportPaths = await sportPathRes.json();

    if (networkParcelsGeoJSON) {
      parcelIndex = new Map();
      networkParcelsGeoJSON.features.forEach(f => {
        const name = f.properties ? f.properties.Name : null;
        if (name) parcelIndex.set(name, f);
      });
    }

    buildFacilityPointIndex();
    buildPathIndex();
  } catch (err) {
    console.error('Preload map data failed:', err);
  }
}

async function initializeNetworkMiniMap() {
  if (networkMiniMap) return;

  const mapSection = document.getElementById('networkMapSection');
  const mapStatus = document.getElementById('networkMapStatus');

  try {
    networkMiniMap = L.map('networkMiniMap', {
      center: [1.35, 103.82],
      zoom: 12,
      zoomControl: false,
      preferCanvas: true,
      zoomAnimation: false,
      fadeAnimation: false
    });

    // Layers order
    networkMiniMap.createPane('pathsPane');
    networkMiniMap.getPane('pathsPane').style.zIndex = 450;
    networkMiniMap.createPane('pointsPane');
    networkMiniMap.getPane('pointsPane').style.zIndex = 460;

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(networkMiniMap);

    if (!networkParcelsGeoJSON) {
      const response = await fetch('parcels.geojson');
      if (!response.ok) throw new Error('parcels.geojson not found');
      networkParcelsGeoJSON = await response.json();
      parcelIndex = new Map();
      networkParcelsGeoJSON.features.forEach(f => {
        const name = f.properties ? f.properties.Name : null;
        if (name) parcelIndex.set(name, f);
      });
    } else if (parcelIndex.size === 0) {
      parcelIndex = new Map();
      networkParcelsGeoJSON.features.forEach(f => {
        const name = f.properties ? f.properties.Name : null;
        if (name) parcelIndex.set(name, f);
      });
    }

    // Load facility points
    if (!hawkerPoints) {
      const res = await fetch('HawkerCentres_wgs84.geojson');
      if (res.ok) hawkerPoints = await res.json();
    }
    if (!libraryPoints) {
      const res = await fetch('Libraries_wgs84.geojson');
      if (res.ok) libraryPoints = await res.json();
    }
    if (!museumPoints) {
      const res = await fetch('Museums_wgs84.geojson');
      if (res.ok) museumPoints = await res.json();
    }
    if (!sportPoints) {
      const res = await fetch('SportFacilities_wgs84.geojson');
      if (res.ok) sportPoints = await res.json();
    }

    // Load network paths
    if (!hawkerPaths) {
      const res = await fetch('HawkerCentres_network_paths_wgs84_simplified.geojson');
      if (res.ok) hawkerPaths = await res.json();
    }
    if (!libraryPaths) {
      const res = await fetch('Libraries_network_paths_wgs84_simplified.geojson');
      if (res.ok) libraryPaths = await res.json();
    }
    if (!museumPaths) {
      const res = await fetch('Museum_network_paths_wgs84_simplified.geojson');
      if (res.ok) museumPaths = await res.json();
    }
    if (!sportPaths) {
      const res = await fetch('SportFacility_network_paths_wgs84_simplified.geojson');
      if (res.ok) sportPaths = await res.json();
    }

    buildFacilityPointIndex();
    buildPathIndex();

    // Skip drawing all parcels to speed up initial render

    if (mapStatus) mapStatus.textContent = '';
    if (mapSection) mapSection.style.display = 'block';
  } catch (err) {
    if (mapStatus) {
      mapStatus.textContent = 'Missing parcels.geojson for mini-map.';
    }
    console.error(err);
  }
}

function showNetworkMiniMap(nodeId) {
  const mapSection = document.getElementById('networkMapSection');
  if (mapSection) mapSection.style.display = 'block';

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
  if (id.includes('#')) return id.split('#').pop();
  if (id.includes('/')) return id.split('/').pop();
  return id;
}

function normalizeParcelName(name) {
  if (!name) return name;
  // Convert "Parcel_kml_12345" -> "kml_12345"
  if (name.startsWith('Parcel_')) return name.replace('Parcel_', '');
  return name;
}

function normKey(v) {
  if (!v) return '';
  return String(v).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildFacilityPointIndex() {
  facilityPointIndex = {
    HawkerCentre: new Map(),
    Library: new Map(),
    Museum: new Map(),
    SportFacility: new Map()
  };

  if (hawkerPoints) {
    hawkerPoints.features.forEach(f => {
      const nameVal = f.properties ? f.properties.NAME : null;
      if (!nameVal) return;
      const key = normKey(`Hawker_${nameVal}`);
      facilityPointIndex.HawkerCentre.set(key, f);
    });
  }
  if (libraryPoints) {
    libraryPoints.features.forEach(f => {
      const nameVal = f.properties ? f.properties.Name : null;
      if (!nameVal) return;
      const key = normKey(`Library_${nameVal}`);
      facilityPointIndex.Library.set(key, f);
    });
  }
  if (museumPoints) {
    museumPoints.features.forEach(f => {
      const nameVal = f.properties ? f.properties.NAME : null;
      if (!nameVal) return;
      const key = normKey(`Museum_${nameVal}`);
      facilityPointIndex.Museum.set(key, f);
    });
  }
  if (sportPoints) {
    sportPoints.features.forEach(f => {
      const nameVal = f.properties ? f.properties.Name : null;
      if (!nameVal) return;
      const key = normKey(`Sport_${nameVal}`);
      facilityPointIndex.SportFacility.set(key, f);
    });
  }
}

function buildPathIndex() {
  pathIndex = {
    HawkerCentre: new Map(),
    Library: new Map(),
    Museum: new Map(),
    SportFacility: new Map()
  };

  function indexPaths(pathData, type) {
    if (!pathData) return;
    pathData.features.forEach(f => {
      const cid = f.properties ? f.properties.centroid_id : null;
      if (!cid) return;
      if (!pathIndex[type].has(cid)) pathIndex[type].set(cid, []);
      pathIndex[type].get(cid).push(f);
    });
  }

  indexPaths(hawkerPaths, 'HawkerCentre');
  indexPaths(libraryPaths, 'Library');
  indexPaths(museumPaths, 'Museum');
  indexPaths(sportPaths, 'SportFacility');
}

function renderConnectionsLegend() {
  const legend = document.getElementById('connectionsLegend');
  if (!legend) return;
  legend.innerHTML = FACILITY_TYPES.map(t => {
    return `<div class="legend-item"><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${t}</div>`;
  }).join('');
}

function getFacilityDistances(centroidId) {
  const out = [];

  function collect(pathData, type, nameKey, distanceKey) {
    if (!pathData) return;
    pathData.features.forEach(f => {
      const p = f.properties || {};
      if (p.centroid_id !== centroidId) return;
      out.push({
        type,
        name: p[nameKey],
        distance: p[distanceKey]
      });
    });
  }

  collect(hawkerPaths, 'HawkerCentre', 'hawker_name', 'network_distance_m');
  collect(libraryPaths, 'Library', 'library_name', 'network_distance_m');
  collect(museumPaths, 'Museum', 'museum_name', 'network_distance_m');
  collect(sportPaths, 'SportFacility', 'sport_name', 'network_distance_m');

  return out;
}

function normalizeFacilityLabel(type, label) {
  if (!label) return '';
  let v = String(label);
  v = v.replace(`${type}: `, '');
  v = v.replace(/^Hawker:\s*/, '');
  v = v.replace(/^Library:\s*/, '');
  v = v.replace(/^Museum:\s*/, '');
  v = v.replace(/^SportFacility:\s*/, '');
  v = v.replace(/^Hawker_/, '');
  v = v.replace(/^Library_/, '');
  v = v.replace(/^Museum_/, '');
  v = v.replace(/^Sport_/, '');
  v = v.replace(/^SportFacility_/, '');
  return v;
}

function facilityLabelPrefix(type) {
  if (type === 'HawkerCentre') return 'Hawker: ';
  if (type === 'Library') return 'Library: ';
  if (type === 'Museum') return 'Museum: ';
  if (type === 'SportFacility') return 'SportFacility: ';
  return `${type}: `;
}

function pathDataForType(type) {
  if (type === 'HawkerCentre') return { data: hawkerPaths, nameKey: 'hawker_name' };
  if (type === 'Library') return { data: libraryPaths, nameKey: 'library_name' };
  if (type === 'Museum') return { data: museumPaths, nameKey: 'museum_name' };
  if (type === 'SportFacility') return { data: sportPaths, nameKey: 'sport_name' };
  return null;
}

function getSharedParcelsByPath(type, facilityName, centroidId) {
  const spec = pathDataForType(type);
  if (!spec || !spec.data || !facilityName) return [];
  const out = [];
  spec.data.features.forEach(f => {
    const p = f.properties || {};
    if (p[spec.nameKey] !== facilityName) return;
    const cid = normalizeParcelName(p.centroid_id);
    if (!cid || cid === centroidId) return;
    out.push(cid);
  });
  return out;
}

function updateConnectionsPanel(parcelNodeId) {
  const panel = document.getElementById('connectionsContent');
  if (!panel) return;

  const centroidId = normalizeParcelName(extractLocalName(parcelNodeId));
  const connectedFacilities = parcelToFacilities.get(parcelNodeId) || [];

  // Facilities + distances from path datasets
  const distances = getFacilityDistances(centroidId);
  const byType = {};
  const byTypeKeys = {};
  FACILITY_TYPES.forEach(t => {
    byType[t] = [];
    byTypeKeys[t] = new Map();
  });

  function upsertFacility(type, label, dist, pathName) {
    if (!FACILITY_TYPES.includes(type)) return;
    const keyBase = pathName || normalizeFacilityLabel(type, label);
    const key = normKey(keyBase);
    if (!key) return;

    const existingIdx = byTypeKeys[type].get(key);
    if (existingIdx == null) {
      byTypeKeys[type].set(key, byType[type].length);
      byType[type].push({ label, dist, pathName: pathName || null, key });
      return;
    }

    const existing = byType[type][existingIdx];
    if (existing.dist == null && dist != null) existing.dist = dist;
    if (!existing.pathName && pathName) existing.pathName = pathName;
    if ((label || '').length > (existing.label || '').length) existing.label = label;
  }

  // 1) Merge graph edges
  connectedFacilities.forEach(fid => {
    const n = nodeMap.get(fid);
    if (!n || !FACILITY_TYPES.includes(n.type)) return;

    const label = n.label || extractLocalName(n.id);
    const cleanLabel = normalizeFacilityLabel(n.type, label);
    const localId = extractLocalName(n.id);
    const cleanLocalId = normalizeFacilityLabel(n.type, localId);
    const match = distances.find(d =>
      d.type === n.type &&
      (
        normKey(d.name) === normKey(cleanLabel) ||
        normKey(d.name) === normKey(cleanLocalId)
      )
    );
    upsertFacility(n.type, label, match ? match.distance : null, match ? String(match.name) : null);
  });

  // 2) Merge path records (ensures all facility types appear when path data exists)
  distances.forEach(d => {
    if (!FACILITY_TYPES.includes(d.type)) return;
    const label = `${facilityLabelPrefix(d.type)}${d.name}`;
    upsertFacility(d.type, label, d.distance, String(d.name));
  });

  FACILITY_TYPES.forEach(t => {
    byType[t].sort((a, b) => {
      const da = a.dist == null ? Number.POSITIVE_INFINITY : Number(a.dist);
      const db = b.dist == null ? Number.POSITIVE_INFINITY : Number(b.dist);
      return da - db;
    });
  });

  const facilitiesHtml = FACILITY_TYPES.map(t => {
    const items = (byType[t] || []);
    if (items.length === 0) {
      return `<div class="connections-section"><h4>${t}</h4><div class="muted">No connected ${t} for this parcel in current dataset.</div></div>`;
    }
    const rows = items.map(item => {
      const dist = item.dist != null ? `${Number(item.dist).toFixed(2)} m` : '-';
      return `<div class="connections-row"><div><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${item.label}</div><div>${dist}</div></div>`;
    }).join('');
    return `<div class="connections-section"><h4>${t}</h4>${rows}</div>`;
  }).join('');

  // Shared parcels by facility (path-based, so all 4 types can be represented)
  const sharedRows = FACILITY_TYPES.map(t => {
    const items = byType[t] || [];
    if (items.length === 0) {
      return `<div class="connections-row"><div><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${t}</div><div>0</div></div>`;
    }
    const primary = items[0];
    const facilityName = primary.pathName || normalizeFacilityLabel(t, primary.label);
    const sharedParcels = getSharedParcelsByPath(t, facilityName, centroidId);
    const sample = sharedParcels.slice(0, 8).map(id => `Parcel: ${id}`).join(', ');
    return `<div class="connections-row"><div><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${primary.label}</div><div>${sharedParcels.length}${sample ? `: ${sample}${sharedParcels.length > 8 ? ' …' : ''}` : ''}</div></div>`;
  });

  const sharedHtml = sharedRows.length > 0
    ? `<div class="connections-section"><h4>Shared Parcels By Facility</h4>${sharedRows.join('')}</div>`
    : `<div class="connections-section"><h4>Shared Parcels By Facility</h4><div class="muted">No shared parcels found.</div></div>`;

  panel.innerHTML = `${facilitiesHtml}${sharedHtml}`;
}

function updateNetworkMiniMap(nodeId) {
  if (!networkParcelsGeoJSON || !networkMiniMap) return;

  if (networkSelectedLayer) networkMiniMap.removeLayer(networkSelectedLayer);
  if (networkConnectedLayer) networkMiniMap.removeLayer(networkConnectedLayer);
  if (networkFacilityLayer) networkMiniMap.removeLayer(networkFacilityLayer);
  if (networkPathLayer) networkMiniMap.removeLayer(networkPathLayer);
  if (networkSharedParcelsLayer) networkMiniMap.removeLayer(networkSharedParcelsLayer);
  networkSharedParcelsByType.forEach(layer => networkMiniMap.removeLayer(layer));
  networkSharedParcelsByType = new Map();

  const connectedNodeIds = adjacency.get(nodeId) || [];

  const localNodeId = normalizeParcelName(extractLocalName(nodeId));
  const connectedLocalIds = connectedNodeIds.map(id =>
    normalizeParcelName(extractLocalName(id))
  );

  const connectedFeatures = connectedLocalIds
    .map(id => parcelIndex.get(id))
    .filter(Boolean);

  if (connectedFeatures.length > 0) {
    networkConnectedLayer = L.geoJSON({ type: 'FeatureCollection', features: connectedFeatures }, {
      style: {
        fillColor: '#9b59b6',
        fillOpacity: 0.45,
        color: '#8e44ad',
        weight: 2,
        opacity: 0.8
      }
    }).addTo(networkMiniMap);
  }

  const selectedFeature = parcelIndex.get(localNodeId);

  const mapStatus = document.getElementById('networkMapStatus');

  if (selectedFeature) {
    networkSelectedLayer = L.geoJSON({ type: 'FeatureCollection', features: [selectedFeature] }, {
      style: {
        fillColor: '#ff3b30',
        fillOpacity: 0.85,
        color: '#b00020',
        weight: 4,
        opacity: 1
      }
    }).addTo(networkMiniMap);

    if (mapStatus) mapStatus.textContent = '';
    fitNetworkMap();
  } else {
    if (mapStatus) {
      mapStatus.textContent = 'No matching parcel for this node.';
    }
    // Ensure map renders even without parcel match
    networkMiniMap.setView([1.35, 103.82], 12, { animate: false });
  }

  // Shared parcels (same facility) highlight by facility type
  if (nodeMap.get(nodeId)?.type === 'Parcel') {
    const facilities = parcelToFacilities.get(nodeId) || [];
    const byType = {};
    facilities.forEach(fid => {
      const facility = nodeMap.get(fid);
      if (!facility || !FACILITY_TYPES.includes(facility.type)) return;
      if (!byType[facility.type]) byType[facility.type] = new Set();
      const parcels = facilityToParcels.get(fid) || [];
      parcels.forEach(pid => {
        if (pid !== nodeId) byType[facility.type].add(pid);
      });
    });

    Object.keys(byType).forEach(type => {
      const features = Array.from(byType[type])
        .map(pid => normalizeParcelName(extractLocalName(pid)))
        .map(id => parcelIndex.get(id))
        .filter(Boolean)
        .slice(0, 200);
      if (features.length === 0) return;
      const layer = L.geoJSON({ type: 'FeatureCollection', features }, {
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

  // Draw connected facilities + network paths by centroid_id
  const centroidId = localNodeId;
  const facilityMarkers = [];
  const pathFeatures = [];

  function addPaths(type, nameKey, color, prefix) {
    const matches = (pathIndex[type].get(centroidId) || []).slice(0, MAX_PATHS_PER_TYPE);
    matches.forEach(f => pathFeatures.push({ feature: f, color }));
    matches.forEach(f => {
      const n = f.properties ? f.properties[nameKey] : null;
      const key = normKey(`${prefix}${n}`);
      const point = facilityPointIndex[type].get(key);
      if (point) facilityMarkers.push({ feature: point, color });
    });
  }

  addPaths('HawkerCentre', 'hawker_name', FACILITY_COLORS.HawkerCentre, 'Hawker_');
  addPaths('Library', 'library_name', FACILITY_COLORS.Library, 'Library_');
  addPaths('Museum', 'museum_name', FACILITY_COLORS.Museum, 'Museum_');
  addPaths('SportFacility', 'sport_name', FACILITY_COLORS.SportFacility, 'Sport_');

  if (pathFeatures.length > 0) {
    const group = L.featureGroup();
    pathFeatures.forEach(p => {
      L.geoJSON(p.feature, {
        pane: 'pathsPane',
        style: {
          color: p.color,
          weight: 2,
          opacity: 0.9
        }
      }).addTo(group);
    });
    networkPathLayer = group.addTo(networkMiniMap);
  }

  if (facilityMarkers.length > 0) {
    const group = L.featureGroup();
    facilityMarkers.forEach(m => {
      L.geoJSON(m.feature, {
        pane: 'pointsPane',
        pointToLayer: function(feature, latlng) {
          return L.circleMarker(latlng, {
            radius: 6,
            fillColor: m.color,
            color: '#ffffff',
            weight: 1,
            fillOpacity: 0.9
          });
        }
      }).addTo(group);
    });
    networkFacilityLayer = group.addTo(networkMiniMap);
  }
}

function updateMapLegend(nodeId) {
  const legend = document.getElementById('networkMapLegend');
  if (!legend) return;
  const localId = normalizeParcelName(extractLocalName(nodeId));
  let html = `<div class="legend-item"><span class="legend-dot" style="background:#ff3b30;"></span>Selected Parcel: ${localId}</div>`;
  html += `<div class="legend-item"><span class="legend-dot" style="background:#9b59b6;"></span>Connected Parcels (direct graph)</div>`;
  FACILITY_TYPES.forEach(type => {
    html += `<div class="legend-item"><span class="legend-dot" style="background:${FACILITY_COLORS[type]};"></span>${type} (facility point + path)</div>`;
  });
  FACILITY_TYPES.forEach(type => {
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
  if (networkSharedParcelsLayer) layers.push(networkSharedParcelsLayer);
  networkSharedParcelsByType.forEach(layer => layers.push(layer));
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
  const mapSection = document.getElementById('networkMapSection');
  if (mapSection) mapSection.style.display = 'none';
}

window.fitNetworkMap = fitNetworkMap;
