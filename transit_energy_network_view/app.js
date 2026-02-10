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

let busPoints = null;
let mrtPoints = null;
let busPaths = null;
let mrtPaths = null;
const MAX_PATHS_PER_TYPE = 1;
let facilityPointIndex = {
  BusStation: new Map(),
  MRTStation: new Map()
};
let facilityPointList = {
  BusStation: [],
  MRTStation: []
};
let pathIndex = {
  BusStation: new Map(),
  MRTStation: new Map()
};

const FACILITY_TYPES = ['BusStation', 'MRTStation'];
const FACILITY_COLORS = {
  BusStation: '#2563eb',
  MRTStation: '#0f9d58'
};
const SHARED_PARCEL_COLORS = {
  BusStation: '#93c5fd',
  MRTStation: '#34d399'
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
  if (networkParcelsGeoJSON && busPoints && mrtPoints &&
      busPaths && mrtPaths) {
    return;
  }

  const files = [
    'parcels.geojson',
    'BusStations_wgs84.geojson',
    'MRTStations_wgs84.geojson',
    'bus_network_paths_wgs84.geojson',
    'mrt_network_paths_wgs84.geojson'
  ];

  try {
    const [
      parcelsRes, busRes, mrtRes, busPathRes, mrtPathRes
    ] = await Promise.all(files.map(f => fetch(f)));

    if (parcelsRes.ok) networkParcelsGeoJSON = await parcelsRes.json();
    if (busRes.ok) busPoints = await busRes.json();
    if (mrtRes.ok) mrtPoints = await mrtRes.json();
    if (busPathRes.ok) busPaths = await busPathRes.json();
    if (mrtPathRes.ok) mrtPaths = await mrtPathRes.json();

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

    // Load station points
    if (!busPoints) {
      const res = await fetch('BusStations_wgs84.geojson');
      if (res.ok) busPoints = await res.json();
    }
    if (!mrtPoints) {
      const res = await fetch('MRTStations_wgs84.geojson');
      if (res.ok) mrtPoints = await res.json();
    }

    // Load network paths
    if (!busPaths) {
      const res = await fetch('bus_network_paths_wgs84.geojson');
      if (res.ok) busPaths = await res.json();
    }
    if (!mrtPaths) {
      const res = await fetch('mrt_network_paths_wgs84.geojson');
      if (res.ok) mrtPaths = await res.json();
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
    BusStation: new Map(),
    MRTStation: new Map()
  };
  facilityPointList = {
    BusStation: [],
    MRTStation: []
  };

  if (busPoints) {
    busPoints.features.forEach(f => {
      const p = f.properties || {};
      const nameVal = p.station_name || p.bus_stop_desc || p.NAME || p.Name;
      if (!nameVal) return;
      const key = normKey(`Bus_${nameVal}`);
      if (!facilityPointIndex.BusStation.has(key)) facilityPointIndex.BusStation.set(key, []);
      facilityPointIndex.BusStation.get(key).push(f);
      facilityPointList.BusStation.push(f);
    });
  }
  if (mrtPoints) {
    mrtPoints.features.forEach(f => {
      const p = f.properties || {};
      const nameVal = p.station_name || p.mrt_stationName || p.mrt_STATION_NA || p.NAME || p.Name;
      if (!nameVal) return;
      const exitCode = p.mrt_exitCode || p.mrt_EXIT_CODE || '';
      const fullName = exitCode ? `${nameVal} (${exitCode})` : nameVal;
      const key = normKey(`MRT_${fullName}`);
      if (!facilityPointIndex.MRTStation.has(key)) facilityPointIndex.MRTStation.set(key, []);
      facilityPointIndex.MRTStation.get(key).push(f);
      facilityPointList.MRTStation.push(f);
    });
  }
}

function buildPathIndex() {
  pathIndex = {
    BusStation: new Map(),
    MRTStation: new Map()
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

  indexPaths(busPaths, 'BusStation');
  indexPaths(mrtPaths, 'MRTStation');
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

  collect(busPaths, 'BusStation', 'bus_stop_desc', 'network_distance_m');
  if (mrtPaths) {
    mrtPaths.features.forEach(f => {
      const p = f.properties || {};
      if (p.centroid_id !== centroidId) return;
      const name = p.mrt_STATION_NA || '';
      const exit = p.mrt_EXIT_CODE || '';
      const fullName = exit ? `${name} (${exit})` : name;
      out.push({
        type: 'MRTStation',
        name: fullName,
        distance: p.network_distance_m
      });
    });
  }

  return out;
}

function normalizeFacilityLabel(type, label) {
  if (!label) return '';
  let v = String(label);
  v = v.replace(`${type}: `, '');
  v = v.replace(/^Bus:\s*/i, '');
  v = v.replace(/^MRT:\s*/i, '');
  v = v.replace(/^Bus_/, '');
  v = v.replace(/^MRT_/, '');
  v = v.replace(/^MRTStation_/, '');
  return v;
}

function getPathEndCoord(feature) {
  if (!feature || !feature.geometry) return null;
  const geom = feature.geometry;
  if (geom.type === 'LineString' && geom.coordinates.length > 0) {
    return geom.coordinates[geom.coordinates.length - 1];
  }
  if (geom.type === 'MultiLineString' && geom.coordinates.length > 0) {
    const lastLine = geom.coordinates[geom.coordinates.length - 1];
    if (lastLine && lastLine.length > 0) return lastLine[lastLine.length - 1];
  }
  return null;
}

function getPathStartCoord(feature) {
  if (!feature || !feature.geometry) return null;
  const geom = feature.geometry;
  if (geom.type === 'LineString' && geom.coordinates.length > 0) {
    return geom.coordinates[0];
  }
  if (geom.type === 'MultiLineString' && geom.coordinates.length > 0) {
    const firstLine = geom.coordinates[0];
    if (firstLine && firstLine.length > 0) return firstLine[0];
  }
  return null;
}

function pickNearestFeature(features, coord) {
  if (!features || features.length === 0) return null;
  if (!coord) return features[0];
  let best = features[0];
  let bestDist = Infinity;
  features.forEach(f => {
    if (!f.geometry || !f.geometry.coordinates) return;
    const c = f.geometry.coordinates;
    const dx = c[0] - coord[0];
    const dy = c[1] - coord[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  });
  return best;
}

function pickNearestFromList(list, coord) {
  if (!list || list.length === 0) return null;
  if (!coord) return list[0];
  let best = list[0];
  let bestDist = Infinity;
  list.forEach(f => {
    if (!f.geometry || !f.geometry.coordinates) return;
    const c = f.geometry.coordinates;
    const dx = c[0] - coord[0];
    const dy = c[1] - coord[1];
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  });
  return best;
}

function pickNearestToPath(list, feature) {
  if (!list || list.length === 0) return null;
  const start = getPathStartCoord(feature);
  const end = getPathEndCoord(feature);
  if (!start && !end) return list[0];
  let best = list[0];
  let bestDist = Infinity;
  list.forEach(f => {
    if (!f.geometry || !f.geometry.coordinates) return;
    const c = f.geometry.coordinates;
    let d = Infinity;
    if (start) {
      const dx = c[0] - start[0];
      const dy = c[1] - start[1];
      d = Math.min(d, dx * dx + dy * dy);
    }
    if (end) {
      const dx = c[0] - end[0];
      const dy = c[1] - end[1];
      d = Math.min(d, dx * dx + dy * dy);
    }
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  });
  return best;
}

function getPolygonCentroid(geom) {
  if (!geom || !geom.coordinates) return null;
  const coords = geom.coordinates;
  if (geom.type === 'Polygon' && coords.length > 0) {
    const ring = coords[0];
    let x = 0;
    let y = 0;
    let n = ring.length || 0;
    if (n === 0) return null;
    ring.forEach(c => {
      x += c[0];
      y += c[1];
    });
    return [x / n, y / n];
  }
  if (geom.type === 'MultiPolygon' && coords.length > 0) {
    const ring = coords[0][0];
    let x = 0;
    let y = 0;
    let n = ring.length || 0;
    if (n === 0) return null;
    ring.forEach(c => {
      x += c[0];
      y += c[1];
    });
    return [x / n, y / n];
  }
  return null;
}

function pickStationEndpoint(feature, parcelCentroid) {
  const start = getPathStartCoord(feature);
  const end = getPathEndCoord(feature);
  if (!start) return end;
  if (!end) return start;
  if (!parcelCentroid) return end;
  const dxs = start[0] - parcelCentroid[0];
  const dys = start[1] - parcelCentroid[1];
  const dxe = end[0] - parcelCentroid[0];
  const dye = end[1] - parcelCentroid[1];
  const ds = dxs * dxs + dys * dys;
  const de = dxe * dxe + dye * dye;
  return de >= ds ? end : start;
}

function getStationEndpointSide(feature, parcelCentroid) {
  const start = getPathStartCoord(feature);
  const end = getPathEndCoord(feature);
  if (!start && !end) return { coord: null, useEnd: true };
  if (!start) return { coord: end, useEnd: true };
  if (!end) return { coord: start, useEnd: false };
  if (!parcelCentroid) return { coord: end, useEnd: true };
  const dxs = start[0] - parcelCentroid[0];
  const dys = start[1] - parcelCentroid[1];
  const dxe = end[0] - parcelCentroid[0];
  const dye = end[1] - parcelCentroid[1];
  const ds = dxs * dxs + dys * dys;
  const de = dxe * dxe + dye * dye;
  return de >= ds ? { coord: end, useEnd: true } : { coord: start, useEnd: false };
}

function buildPointFeature(coord) {
  if (!coord) return null;
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Point',
      coordinates: coord
    }
  };
}

function snapPathFeature(feature, stationCoord, useEnd) {
  if (!feature || !feature.geometry || !stationCoord) return feature;
  const geom = feature.geometry;
  const clone = JSON.parse(JSON.stringify(feature));
  if (geom.type === 'LineString' && clone.geometry.coordinates.length > 0) {
    if (useEnd) {
      clone.geometry.coordinates[clone.geometry.coordinates.length - 1] = stationCoord;
    } else {
      clone.geometry.coordinates[0] = stationCoord;
    }
  } else if (geom.type === 'MultiLineString' && clone.geometry.coordinates.length > 0) {
    if (useEnd) {
      const lastLine = clone.geometry.coordinates[clone.geometry.coordinates.length - 1];
      if (lastLine && lastLine.length > 0) {
        lastLine[lastLine.length - 1] = stationCoord;
      }
    } else {
      const firstLine = clone.geometry.coordinates[0];
      if (firstLine && firstLine.length > 0) {
        firstLine[0] = stationCoord;
      }
    }
  }
  return clone;
}

function updateConnectionsPanel(parcelNodeId) {
  const panel = document.getElementById('connectionsContent');
  if (!panel) return;

  const centroidId = normalizeParcelName(extractLocalName(parcelNodeId));
  const connectedFacilities = parcelToFacilities.get(parcelNodeId) || [];

  // Facilities + distances from path datasets
  const distances = getFacilityDistances(centroidId);
  const distanceMap = new Map();
  const distancesByType = {};
  distances.forEach(d => {
    const key = `${d.type}::${d.name}`;
    distanceMap.set(key, d.distance);
    if (!distancesByType[d.type]) distancesByType[d.type] = [];
    distancesByType[d.type].push(d);
  });

  const byType = {};
  connectedFacilities.forEach(fid => {
    const n = nodeMap.get(fid);
    if (!n || !FACILITY_TYPES.includes(n.type)) return;
    if (!byType[n.type]) byType[n.type] = [];
    const label = n.label || extractLocalName(n.id);
    const cleanLabel = normalizeFacilityLabel(n.type, label);
    let dist = distanceMap.get(`${n.type}::${cleanLabel}`);
    if (dist == null && distancesByType[n.type] && distancesByType[n.type].length === 1) {
      dist = distancesByType[n.type][0].distance;
    }
    byType[n.type].push({ label, dist });
  });

  const facilitiesHtml = FACILITY_TYPES.map(t => {
    const items = (byType[t] || []);
    if (items.length === 0) return '';
    const rows = items.map(item => {
      const dist = item.dist != null ? `${Number(item.dist).toFixed(2)} m` : '-';
      return `<div class="connections-row"><div><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${item.label}</div><div>${dist}</div></div>`;
    }).join('');
    return `<div class="connections-section"><h4>${t}</h4>${rows}</div>`;
  }).join('');

  // Shared parcels by facility
  const sharedRows = [];
  connectedFacilities.forEach(fid => {
    const facility = nodeMap.get(fid);
    if (!facility || !FACILITY_TYPES.includes(facility.type)) return;
    const parcels = (facilityToParcels.get(fid) || []).filter(pid => pid !== parcelNodeId);
    const sample = parcels.slice(0, 8).map(pid => {
      const n = nodeMap.get(pid);
      return n ? (n.label || extractLocalName(n.id)) : extractLocalName(pid);
    }).join(', ');
    sharedRows.push(`<div class="connections-row"><div><span class="type-dot" style="background:${FACILITY_COLORS[facility.type]}"></span>${facility.label || extractLocalName(facility.id)}</div><div>${parcels.length}${sample ? `: ${sample}${parcels.length > 8 ? ' …' : ''}` : ''}</div></div>`);
  });

  const sharedHtml = sharedRows.length > 0
    ? `<div class="connections-section"><h4>Shared Parcels By Station</h4>${sharedRows.join('')}</div>`
    : `<div class="connections-section"><h4>Shared Parcels By Station</h4><div class="muted">No shared parcels found.</div></div>`;

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
  let selectedCentroid = null;

  const mapStatus = document.getElementById('networkMapStatus');

  if (selectedFeature) {
    selectedCentroid = getPolygonCentroid(selectedFeature.geometry);
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
    const matches = (pathIndex[type].get(centroidId) || []).slice();
    matches.sort((a, b) => {
      const da = a.properties ? a.properties.network_distance_m : null;
      const db = b.properties ? b.properties.network_distance_m : null;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
    const picked = matches.slice(0, MAX_PATHS_PER_TYPE);
    picked.forEach(f => {
      const { coord, useEnd } = getStationEndpointSide(f, selectedCentroid);
      const nearestStation = pickNearestFromList(facilityPointList[type], coord);
      if (!nearestStation || !nearestStation.geometry) {
        pathFeatures.push({ feature: f, color });
        const pointFeature = buildPointFeature(coord);
        if (pointFeature) facilityMarkers.push({ feature: pointFeature, color });
        return;
      }
      const stationCoord = nearestStation.geometry.coordinates;
      const snapped = snapPathFeature(f, stationCoord, useEnd);
      pathFeatures.push({ feature: snapped, color });
      facilityMarkers.push({ feature: nearestStation, color });
    });
  }

  addPaths('BusStation', 'bus_stop_desc', FACILITY_COLORS.BusStation, 'Bus_');
  // MRT path names need exit code to match point labels
  const mrtMatches = (pathIndex.MRTStation.get(centroidId) || []).slice();
  mrtMatches.sort((a, b) => {
    const da = a.properties ? a.properties.network_distance_m : null;
    const db = b.properties ? b.properties.network_distance_m : null;
    if (da == null && db == null) return 0;
    if (da == null) return 1;
    if (db == null) return -1;
    return da - db;
  });
  const mrtPicked = mrtMatches.slice(0, MAX_PATHS_PER_TYPE);
  mrtPicked.forEach(f => {
    const { coord, useEnd } = getStationEndpointSide(f, selectedCentroid);
    const nearestStation = pickNearestFromList(facilityPointList.MRTStation, coord);
    if (!nearestStation || !nearestStation.geometry) {
      pathFeatures.push({ feature: f, color: FACILITY_COLORS.MRTStation });
      const pointFeature = buildPointFeature(coord);
      if (pointFeature) facilityMarkers.push({ feature: pointFeature, color: FACILITY_COLORS.MRTStation });
      return;
    }
    const stationCoord = nearestStation.geometry.coordinates;
    const snapped = snapPathFeature(f, stationCoord, useEnd);
    pathFeatures.push({ feature: snapped, color: FACILITY_COLORS.MRTStation });
    facilityMarkers.push({ feature: nearestStation, color: FACILITY_COLORS.MRTStation });
  });

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
    html += `<div class="legend-item"><span class="legend-dot" style="background:${FACILITY_COLORS[type]};"></span>${type} (station point + path)</div>`;
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
