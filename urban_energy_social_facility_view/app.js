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
const MIN_NODE_DEGREE = 1;
let adjacency = new Map();
let typeColorMap = new Map();

let networkMiniMap = null;
let networkParcelsGeoJSON = null;
let networkAllParcelsLayer = null;
let networkSelectedLayer = null;
let networkConnectedLayer = null;
let networkFacilityLayer = null;
let networkPathLayer = null;
let networkPathEndpointLayer = null;
let networkSharedParcelsLayer = null;
let networkSharedParcelsByType = new Map();
let networkSharedParcelsMultiLayer = null;
let networkSharedParcelsCounts = new Map();
let parcelIndex = new Map();

let gardenPoints = null;
let childCarePoints = null;
let useSitePoints = null;
let socialServicePoints = null;
let gardenPaths = null;
let childCarePaths = null;
let useSitePaths = null;
let socialServicePaths = null;
const MAX_PATHS_PER_TYPE = 1;
let facilityPointIndex = {
  CommunityGarden: new Map(),
  ChildCareCenter: new Map(),
  CommunityUseSite: new Map(),
  SocialServiceAgency: new Map()
};
let pathIndex = {
  CommunityGarden: new Map(),
  ChildCareCenter: new Map(),
  CommunityUseSite: new Map(),
  SocialServiceAgency: new Map()
};

const FACILITY_TYPES = ['CommunityGarden', 'ChildCareCenter', 'CommunityUseSite', 'SocialServiceAgency'];
const FACILITY_LABELS = {
  CommunityGarden: 'Community Garden',
  ChildCareCenter: 'Child Care',
  CommunityUseSite: 'Community Use Site',
  SocialServiceAgency: 'Social Service'
};
const FACILITY_COLORS = {
  CommunityGarden: '#2ecc71',
  ChildCareCenter: '#3498db',
  CommunityUseSite: '#f39c12',
  SocialServiceAgency: '#9b59b6'
};
const SHARED_PARCEL_COLORS = {
  CommunityGarden: '#7bd389',
  ChildCareCenter: '#7fb3ff',
  CommunityUseSite: '#f6b26b',
  SocialServiceAgency: '#c39bd3'
};
const SHARED_PARCEL_MULTI_COLOR = '#6b7280';
const SHARED_PARCEL_ENABLED = {
  CommunityGarden: true,
  ChildCareCenter: true,
  CommunityUseSite: true,
  SocialServiceAgency: true
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

  if (MIN_NODE_DEGREE > 0) {
    allNodes = allNodes.filter(n => (degrees.get(n.id) || 0) >= MIN_NODE_DEGREE);
    const keepIds = new Set(allNodes.map(n => n.id));
    allEdges = allEdges.filter(e => keepIds.has(e.from) && keepIds.has(e.to));
  }

  // Rebuild maps after degree-based filtering
  nodeMap = new Map(allNodes.map(n => [n.id, n]));
  edgeMap = new Map(allEdges.map((e, i) => [i, e]));

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
  let propKeys = Object.keys(props);
  if (node.type === 'Parcel') {
    const allowedPrefixes = ['basic_', 'energy_', 'intensity_', 'size_', 'share_', 'carbon_'];
    propKeys = propKeys.filter(key => {
      const k = key.toLowerCase();
      if (k === 'label') return false;
      return allowedPrefixes.some(prefix => k.startsWith(prefix));
    });
    propKeys.sort((a, b) => {
      const rank = (k) => {
        const x = k.toLowerCase();
        if (x.startsWith('basic_')) return 0;
        if (x.startsWith('size_')) return 1;
        if (x.startsWith('energy_')) return 2;
        if (x.startsWith('intensity_')) return 3;
        if (x.startsWith('share_')) return 4;
        if (x.startsWith('carbon_')) return 5;
        return 6;
      };
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });
  } else {
    propKeys.sort();
  }

  if (propKeys.length > 0) {
    html += '<div class="info-section">';
    html += node.type === 'Parcel' ? '<h3>Energy + Parcel Attributes</h3>' : '<h3>Key Properties</h3>';
    propKeys.forEach(key => {
      const vals = Array.isArray(props[key]) ? props[key] : [props[key]];
      const value = vals.join(', ');
      html += `<div class="info-item"><div class="info-label">${key}</div><div class="info-value">${value}</div></div>`;
    });
    html += '</div>';
  } else if (node.type === 'Parcel') {
    html += '<div class="info-section">';
    html += '<h3>Energy + Parcel Attributes</h3>';
    html += '<p class="muted">No energy attributes are available for this parcel.</p>';
    html += '</div>';
  }

  if (node.type === 'Parcel') {
    if (!networkMiniMap) {
      initializeNetworkMiniMap().then(() => updateConnectionsPanel(nodeId));
    } else {
      updateConnectionsPanel(nodeId);
    }
    showNetworkMiniMap(nodeId);
  } else {
    hideNetworkMiniMap();
    updateConnectionsPanel(null);
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
    const displayName = FACILITY_LABELS[type] || type;
    html += `
      <div class="legend-item">
        <input type="checkbox" ${checked} data-type="${type}" />
        <span class="legend-dot" style="background: ${color};"></span>
        <span>${displayName} (${typeCounts[type]})</span>
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
  if (networkParcelsGeoJSON && gardenPoints && childCarePoints && useSitePoints && socialServicePoints &&
      gardenPaths && childCarePaths && useSitePaths && socialServicePaths) {
    return;
  }

  const files = [
    'parcels.geojson',
    'CommunityGardens_wgs84.geojson',
    'ChildCare_wgs84.geojson',
    'CommunityUseSites_wgs84.geojson',
    'SocialServiceAgencies_wgs84.geojson',
    'CommunityGarden_network_paths_wgs84_simplified.geojson',
    'ChildCare_network_paths_wgs84_simplified.geojson',
    'CommunityUseSite_network_paths_wgs84_simplified.geojson',
    'SocialService_network_paths_wgs84_simplified.geojson'
  ];

  try {
    const [
      parcelsRes, gardenRes, childCareRes, useSiteRes, socialServiceRes,
      gardenPathRes, childCarePathRes, useSitePathRes, socialServicePathRes
    ] = await Promise.all(files.map(f => fetch(f)));

    if (parcelsRes.ok) networkParcelsGeoJSON = await parcelsRes.json();
    if (gardenRes.ok) gardenPoints = await gardenRes.json();
    if (childCareRes.ok) childCarePoints = await childCareRes.json();
    if (useSiteRes.ok) useSitePoints = await useSiteRes.json();
    if (socialServiceRes.ok) socialServicePoints = await socialServiceRes.json();
    if (gardenPathRes.ok) gardenPaths = await gardenPathRes.json();
    if (childCarePathRes.ok) childCarePaths = await childCarePathRes.json();
    if (useSitePathRes.ok) useSitePaths = await useSitePathRes.json();
    if (socialServicePathRes.ok) socialServicePaths = await socialServicePathRes.json();

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
    networkMiniMap.createPane('sharedPane');
    networkMiniMap.getPane('sharedPane').style.zIndex = 430;

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
    if (!gardenPoints) {
      const res = await fetch('CommunityGardens_wgs84.geojson');
      if (res.ok) gardenPoints = await res.json();
    }
    if (!childCarePoints) {
      const res = await fetch('ChildCare_wgs84.geojson');
      if (res.ok) childCarePoints = await res.json();
    }
    if (!useSitePoints) {
      const res = await fetch('CommunityUseSites_wgs84.geojson');
      if (res.ok) useSitePoints = await res.json();
    }
    if (!socialServicePoints) {
      const res = await fetch('SocialServiceAgencies_wgs84.geojson');
      if (res.ok) socialServicePoints = await res.json();
    }

    // Load network paths
    if (!gardenPaths) {
      const res = await fetch('CommunityGarden_network_paths_wgs84_simplified.geojson');
      if (res.ok) gardenPaths = await res.json();
    }
    if (!childCarePaths) {
      const res = await fetch('ChildCare_network_paths_wgs84_simplified.geojson');
      if (res.ok) childCarePaths = await res.json();
    }
    if (!useSitePaths) {
      const res = await fetch('CommunityUseSite_network_paths_wgs84_simplified.geojson');
      if (res.ok) useSitePaths = await res.json();
    }
    if (!socialServicePaths) {
      const res = await fetch('SocialService_network_paths_wgs84_simplified.geojson');
      if (res.ok) socialServicePaths = await res.json();
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
    CommunityGarden: new Map(),
    ChildCareCenter: new Map(),
    CommunityUseSite: new Map(),
    SocialServiceAgency: new Map()
  };

  function indexPoints(points, type, idKey, nameKey) {
    if (!points) return;
    points.features.forEach(f => {
      const props = f.properties || {};
      const fid = props[idKey];
      const nameVal = props[nameKey];
      if (fid) {
        facilityPointIndex[type].set(String(fid), f);
        facilityPointIndex[type].set(normKey(String(fid)), f);
      }
      if (nameVal) {
        facilityPointIndex[type].set(normKey(String(nameVal)), f);
      }
    });
  }

  indexPoints(gardenPoints, 'CommunityGarden', 'facility_id', 'GARDEN_NAME');
  indexPoints(childCarePoints, 'ChildCareCenter', 'facility_id', 'Name');
  indexPoints(useSitePoints, 'CommunityUseSite', 'facility_id', 'NAME');
  indexPoints(socialServicePoints, 'SocialServiceAgency', 'facility_id', 'Agency_Name');
}

function buildPathIndex() {
  pathIndex = {
    CommunityGarden: new Map(),
    ChildCareCenter: new Map(),
    CommunityUseSite: new Map(),
    SocialServiceAgency: new Map()
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

  indexPaths(gardenPaths, 'CommunityGarden');
  indexPaths(childCarePaths, 'ChildCareCenter');
  indexPaths(useSitePaths, 'CommunityUseSite');
  indexPaths(socialServicePaths, 'SocialServiceAgency');
}

function renderConnectionsLegend() {
  const legend = document.getElementById('connectionsLegend');
  if (!legend) return;
  legend.innerHTML = FACILITY_TYPES.map(t => {
    return `<div class="legend-item"><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${FACILITY_LABELS[t] || t}</div>`;
  }).join('');
}

function getFacilityDistances(centroidId) {
  const out = [];
  const minByType = {};

  function updateMin(type, dist) {
    if (dist == null) return;
    if (!minByType[type] || dist < minByType[type]) minByType[type] = dist;
  }

  function collect(pathData, type, keyFn, distanceKey) {
    if (!pathData) return;
    pathData.features.forEach(f => {
      const p = f.properties || {};
      if (p.centroid_id !== centroidId) return;
      const dist = p[distanceKey];
      const key = keyFn ? keyFn(p) : null;
      out.push({ type, key, distance: dist });
      updateMin(type, dist);
    });
  }

  collect(gardenPaths, 'CommunityGarden', p => p.garden_id ? `site_${p.garden_id}` : p.garden_name, 'network_distance_m');
  collect(childCarePaths, 'ChildCareCenter', null, 'network_distance_m');
  collect(useSitePaths, 'CommunityUseSite', p => p.site_id ? `site_${p.site_id}` : p.site_name, 'network_distance_m');
  collect(socialServicePaths, 'SocialServiceAgency', p => p.agency_name, 'network_distance_m');

  return { items: out, minByType };
}

function normalizeFacilityLabel(type, label) {
  if (!label) return '';
  let v = String(label);
  v = v.replace(`${type}: `, '');
  v = v.replace(/^CommunityGarden_/, '');
  v = v.replace(/^ChildCare_/, '');
  v = v.replace(/^CommunityUseSite_/, '');
  v = v.replace(/^SocialService_/, '');
  return v;
}

function updateConnectionsPanel(parcelNodeId) {
  const panel = document.getElementById('connectionsContent');
  if (!panel) return;

  if (!parcelNodeId) {
    panel.innerHTML = '<p class="muted">Select a parcel to see connected facilities, distances, and shared parcels.</p>';
    return;
  }

  const centroidId = normalizeParcelName(extractLocalName(parcelNodeId));
  const connectedFacilities = parcelToFacilities.get(parcelNodeId) || [];

  // Facilities + distances from path datasets
  const distanceData = getFacilityDistances(centroidId);
  const distanceMap = new Map();
  distanceData.items.forEach(d => {
    if (!d.key) return;
    const key = `${d.type}::${normKey(d.key)}`;
    distanceMap.set(key, d.distance);
  });

  const byType = {};
  connectedFacilities.forEach(fid => {
    const n = nodeMap.get(fid);
    if (!n || !FACILITY_TYPES.includes(n.type)) return;
    if (!byType[n.type]) byType[n.type] = [];
    const label = n.label || extractLocalName(n.id);
    const cleanLabel = normalizeFacilityLabel(n.type, label);
    const props = n.properties || {};
    const facilityId = Array.isArray(props.facility_id) ? props.facility_id[0] : props.facility_id;
    const facilityName = Array.isArray(props.facility_name) ? props.facility_name[0] : props.facility_name;
    let dist = null;
    if (facilityId) dist = distanceMap.get(`${n.type}::${normKey(String(facilityId))}`);
    if (dist == null && facilityName) dist = distanceMap.get(`${n.type}::${normKey(String(facilityName))}`);
    if (dist == null && cleanLabel) dist = distanceMap.get(`${n.type}::${normKey(String(cleanLabel))}`);
    if (dist == null && distanceData.minByType[n.type] != null) {
      dist = distanceData.minByType[n.type];
    }
    byType[n.type].push({ label, dist });
  });

  const facilitiesHtml = FACILITY_TYPES.map(t => {
    const items = (byType[t] || []);
    if (items.length === 0) {
      return `<div class="connections-section"><h4>${FACILITY_LABELS[t] || t}</h4><div class="muted">No connected facility of this type for the selected parcel in the current dataset.</div></div>`;
    }
    const rows = items.map(item => {
      const dist = item.dist != null ? `${Number(item.dist).toFixed(2)} m` : '-';
      return `<div class="connections-row"><div><span class="type-dot" style="background:${FACILITY_COLORS[t]}"></span>${item.label}</div><div>${dist}</div></div>`;
    }).join('');
    return `<div class="connections-section"><h4>${FACILITY_LABELS[t] || t}</h4>${rows}</div>`;
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
  if (networkPathEndpointLayer) networkMiniMap.removeLayer(networkPathEndpointLayer);
  if (networkSharedParcelsLayer) networkMiniMap.removeLayer(networkSharedParcelsLayer);
  if (networkSharedParcelsMultiLayer) networkMiniMap.removeLayer(networkSharedParcelsMultiLayer);
  networkSharedParcelsByType.forEach(layer => networkMiniMap.removeLayer(layer));
  networkSharedParcelsByType = new Map();
  networkSharedParcelsMultiLayer = null;
  networkSharedParcelsCounts = new Map();

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
    const parcelTypeMap = new Map();
    const sharedInfo = new Map();
    facilities.forEach(fid => {
      const facility = nodeMap.get(fid);
      if (!facility || !FACILITY_TYPES.includes(facility.type)) return;
      if (!byType[facility.type]) byType[facility.type] = new Set();
      const parcels = facilityToParcels.get(fid) || [];
      parcels.forEach(pid => {
        if (pid !== nodeId) {
          byType[facility.type].add(pid);
          if (!parcelTypeMap.has(pid)) parcelTypeMap.set(pid, new Set());
          parcelTypeMap.get(pid).add(facility.type);
          const parcelKey = normalizeParcelName(extractLocalName(pid));
          if (!sharedInfo.has(parcelKey)) {
            sharedInfo.set(parcelKey, { types: new Set(), facilities: [] });
          }
          const entry = sharedInfo.get(parcelKey);
          entry.types.add(facility.type);
          entry.facilities.push({
            type: facility.type,
            label: facility.label || extractLocalName(facility.id),
            id: facility.id
          });
        }
      });
    });

    const multiTypeFeatures = [];

    function buildFeatureWithMeta(parcelKey) {
      const base = parcelIndex.get(parcelKey);
      if (!base) return null;
      const info = sharedInfo.get(parcelKey);
      const types = info ? Array.from(info.types) : [];
      const facilities = info ? info.facilities : [];
      return {
        type: 'Feature',
        geometry: base.geometry,
        properties: {
          ...(base.properties || {}),
          __shared_types: types,
          __shared_facilities: facilities
        }
      };
    }

    function sharedTooltip(feature) {
      const types = feature.properties?.__shared_types || [];
      const labels = types.map(t => FACILITY_LABELS[t] || t);
      const facilities = feature.properties?.__shared_facilities || [];
      const facNames = facilities.map(f => f.label).filter(Boolean);
      let text = labels.length ? `Shared via: ${labels.join(', ')}` : 'Shared via: unknown';
      if (facNames.length > 0) {
        const sample = facNames.slice(0, 3).join(', ');
        text += `<br/>Facilities: ${sample}${facNames.length > 3 ? ' …' : ''}`;
      }
      return text;
    }

    FACILITY_TYPES.forEach(type => {
      if (!SHARED_PARCEL_ENABLED[type]) return;
      const features = Array.from(byType[type] || [])
        .map(pid => normalizeParcelName(extractLocalName(pid)))
        .map(id => buildFeatureWithMeta(id))
        .filter(Boolean)
        .slice(0, 200);
      networkSharedParcelsCounts.set(type, features.length);
      if (features.length === 0) return;
      const layer = L.geoJSON({ type: 'FeatureCollection', features }, {
        pane: 'sharedPane',
        interactive: true,
        style: {
          fillColor: SHARED_PARCEL_COLORS[type],
          fillOpacity: 0.25,
          color: SHARED_PARCEL_COLORS[type],
          weight: 1,
          opacity: 0.6
        },
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(sharedTooltip(feature), { sticky: true });
          layer.bindPopup(sharedTooltip(feature), { maxWidth: 280 });
          layer.on('click', () => {
            const mapStatus = document.getElementById('networkMapStatus');
            if (mapStatus) mapStatus.innerHTML = sharedTooltip(feature);
          });
        }
      }).addTo(networkMiniMap);
      networkSharedParcelsByType.set(type, layer);
    });

    const multiIds = Array.from(parcelTypeMap.entries())
      .filter(([, types]) => types.size > 1)
      .map(([pid]) => pid);
    if (multiIds.length > 0) {
      multiTypeFeatures.push(...multiIds
        .map(pid => {
          const id = normalizeParcelName(extractLocalName(pid));
          return buildFeatureWithMeta(id);
        })
        .filter(Boolean)
        .slice(0, 200));
    }
    if (multiTypeFeatures.length > 0) {
      networkSharedParcelsMultiLayer = L.geoJSON({ type: 'FeatureCollection', features: multiTypeFeatures }, {
        pane: 'sharedPane',
        interactive: true,
        style: {
          fillColor: SHARED_PARCEL_MULTI_COLOR,
          fillOpacity: 0.12,
          color: SHARED_PARCEL_MULTI_COLOR,
          weight: 1,
          opacity: 0.85,
          dashArray: '5,4'
        },
        onEachFeature: (feature, layer) => {
          layer.bindTooltip(sharedTooltip(feature), { sticky: true });
          layer.bindPopup(sharedTooltip(feature), { maxWidth: 280 });
          layer.on('click', () => {
            const mapStatus = document.getElementById('networkMapStatus');
            if (mapStatus) mapStatus.innerHTML = sharedTooltip(feature);
          });
        }
      }).addTo(networkMiniMap);
    }
  }

  updateMapLegend(nodeId);

  // Draw network paths by centroid_id (for parcel selections)
  const centroidId = localNodeId;
  const facilityMarkers = [];
  const pathFeatures = [];

  if (nodeMap.get(nodeId)?.type === 'Parcel') {
    function normalizeVal(val) {
      return val == null ? '' : normKey(String(val));
    }

    function normalizeFacilityId(type, val) {
      let out = normalizeVal(val);
      if (!out) return out;
      if (type === 'CommunityUseSite' && out.startsWith('site_')) out = out.slice(5);
      if (type === 'CommunityGarden' && out.startsWith('garden_')) out = out.slice(7);
      return out;
    }

    function facilityMatchKeys(type, node) {
      const props = node.properties || {};
      const keys = new Set();
      if (props.facility_id) keys.add(normalizeFacilityId(type, props.facility_id));
      if (props.facility_name) keys.add(normalizeVal(props.facility_name));
      if (node.label) keys.add(normalizeVal(normalizeFacilityLabel(type, node.label)));
      return keys;
    }

    function featureKey(type, feature) {
      const p = feature.properties || {};
      if (type === 'CommunityUseSite') return [normalizeFacilityId(type, p.site_id), normalizeVal(p.site_name)];
      if (type === 'CommunityGarden') return [normalizeFacilityId(type, p.garden_id), normalizeVal(p.garden_name)];
      if (type === 'SocialServiceAgency') return [normalizeVal(p.agency_name)];
      // ChildCare paths use garden_* fields in this dataset
      if (type === 'ChildCareCenter') return [normalizeFacilityId('CommunityGarden', p.garden_id), normalizeVal(p.garden_name)];
      return [''];
    }

    function featureDistance(feature) {
      const p = feature.properties || {};
      return Number(p.network_distance_m ?? p.euclidean_distance_m ?? Number.POSITIVE_INFINITY);
    }

    function addPathsForFacility(node, type, color) {
      const featureList = (pathIndex[type]?.get(centroidId) || []);
      if (featureList.length === 0) return;
      const matchKeys = facilityMatchKeys(type, node);
      let matches = featureList.filter(f => {
        const keys = featureKey(type, f);
        return keys.some(k => k && matchKeys.has(k));
      });

      // ChildCare paths lack stable ids in this dataset; fallback to nearest path
      if (matches.length === 0 && type === 'ChildCareCenter') {
        matches = [...featureList].sort((a, b) => featureDistance(a) - featureDistance(b)).slice(0, 1);
      }

      matches.slice(0, MAX_PATHS_PER_TYPE).forEach(f => pathFeatures.push({ feature: f, color, type }));
    }

    connectedNodeIds.forEach(fid => {
      const n = nodeMap.get(fid);
      if (!n || !FACILITY_TYPES.includes(n.type)) return;
      addPathsForFacility(n, n.type, FACILITY_COLORS[n.type]);
    });
  }

  function getFeatureLatLng(feature) {
    if (!feature || !feature.geometry) return null;
    const geom = feature.geometry;
    if (geom.type === 'Point' && Array.isArray(geom.coordinates)) {
      return [geom.coordinates[1], geom.coordinates[0]];
    }
    // Fall back to centroid of bounds for polygonal facility features
    const bounds = L.geoJSON(feature).getBounds();
    if (bounds && bounds.isValid()) return bounds.getCenter();
    return null;
  }

  function getPathEndLatLng(feature) {
    if (!feature || !feature.geometry) return null;
    const geom = feature.geometry;
    let coords = null;
    if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      coords = geom.coordinates[geom.coordinates.length - 1];
    } else if (geom.type === 'MultiLineString' && Array.isArray(geom.coordinates) && geom.coordinates.length > 0) {
      const lastLine = geom.coordinates[geom.coordinates.length - 1];
      coords = lastLine[lastLine.length - 1];
    }
    if (!coords || coords.length < 2) return null;
    return [coords[1], coords[0]];
  }

  // Facility markers from connected facility nodes
  const seen = new Set();
  const connectedFacilityTypes = new Set();
  connectedNodeIds.forEach(fid => {
    const n = nodeMap.get(fid);
    if (!n || !FACILITY_TYPES.includes(n.type)) return;
    connectedFacilityTypes.add(n.type);
    const props = n.properties || {};
    const facilityId = Array.isArray(props.facility_id) ? props.facility_id[0] : props.facility_id;
    const facilityName = Array.isArray(props.facility_name) ? props.facility_name[0] : props.facility_name;
    let point = null;
    if (facilityId) point = facilityPointIndex[n.type].get(String(facilityId)) || facilityPointIndex[n.type].get(normKey(String(facilityId)));
    if (!point && facilityName) point = facilityPointIndex[n.type].get(normKey(String(facilityName)));
    if (!point && n.label) point = facilityPointIndex[n.type].get(normKey(normalizeFacilityLabel(n.type, n.label)));
    if (!point) return;
    const key = `${n.type}:${point.id || point.properties?.facility_id || point.properties?.NAME || point.properties?.Name || point.properties?.GARDEN_NAME || point.properties?.Agency_Name}`;
    if (seen.has(key)) return;
    seen.add(key);
    const latlngRaw = getFeatureLatLng(point);
    if (!latlngRaw) return;
    const latlng = Array.isArray(latlngRaw) ? latlngRaw : [latlngRaw.lat, latlngRaw.lng];
    facilityMarkers.push({ feature: point, type: n.type, color: FACILITY_COLORS[n.type], latlng });
  });

  // If a connected type has no facility point match, fall back to path endpoint marker.
  const markerTypes = new Set(facilityMarkers.map(m => m.type));
  connectedFacilityTypes.forEach(type => {
    if (markerTypes.has(type)) return;
    const fallback = pathFeatures.find(p => p.type === type);
    if (!fallback) return;
    const latlng = getPathEndLatLng(fallback.feature);
    if (!latlng) return;
    facilityMarkers.push({ feature: null, type, color: FACILITY_COLORS[type], latlng });
    markerTypes.add(type);
  });

  // Spread markers that share nearly the same location so all facility types remain visible.
  const markerBuckets = new Map();
  facilityMarkers.forEach(marker => {
    const key = `${marker.latlng[0].toFixed(4)}:${marker.latlng[1].toFixed(4)}`;
    if (!markerBuckets.has(key)) markerBuckets.set(key, []);
    markerBuckets.get(key).push(marker);
  });
  markerBuckets.forEach(group => {
    if (group.length <= 1) return;
    const radius = 0.00015;
    group.forEach((marker, idx) => {
      const angle = (2 * Math.PI * idx) / group.length;
      marker.latlng = [
        marker.latlng[0] + radius * Math.sin(angle),
        marker.latlng[1] + radius * Math.cos(angle)
      ];
    });
  });

  if (pathFeatures.length > 0) {
    const group = L.featureGroup();
    const endpoints = L.featureGroup();
    pathFeatures.forEach(p => {
      L.geoJSON(p.feature, {
        pane: 'pathsPane',
        style: {
          color: p.color,
          weight: 2,
          opacity: 0.9
        }
      }).addTo(group);

      const endpoint = getPathEndLatLng(p.feature);
      if (endpoint) {
        L.circleMarker(endpoint, {
          radius: 4,
          fillColor: p.color,
          color: '#ffffff',
          weight: 1,
          fillOpacity: 0.95
        }).addTo(endpoints);
      }
    });
    networkPathLayer = group.addTo(networkMiniMap);
    networkPathEndpointLayer = endpoints.addTo(networkMiniMap);
  }

  if (facilityMarkers.length > 0) {
    const group = L.featureGroup();
    facilityMarkers.forEach(m => {
      L.circleMarker(m.latlng, {
        pane: 'pointsPane',
        radius: 6,
        fillColor: m.color,
        color: '#ffffff',
        weight: 1,
        fillOpacity: 0.9
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
    html += `<div class="legend-item"><span class="legend-dot" style="background:${FACILITY_COLORS[type]};"></span>${FACILITY_LABELS[type] || type} (facility point + path)</div>`;
  });
  FACILITY_TYPES.forEach(type => {
    if (!SHARED_PARCEL_ENABLED[type]) return;
    const count = networkSharedParcelsCounts.get(type);
    const suffix = count != null ? ` (${count})` : '';
    html += `<div class="legend-item"><span class="legend-dot" style="background:${SHARED_PARCEL_COLORS[type]};"></span>Shared Parcels via ${type}${suffix}</div>`;
  });
  if (networkSharedParcelsMultiLayer) {
    html += `<div class="legend-item"><span class="legend-dot" style="background:${SHARED_PARCEL_MULTI_COLOR};"></span>Shared Parcels via multiple facility types (grey dashed, hover)</div>`;
  }
  legend.innerHTML = html;
}

function fitNetworkMap() {
  if (!networkMiniMap) return;
  const layers = [];
  if (networkSelectedLayer) layers.push(networkSelectedLayer);
  if (networkConnectedLayer) layers.push(networkConnectedLayer);
  if (networkPathLayer) layers.push(networkPathLayer);
  if (networkPathEndpointLayer) layers.push(networkPathEndpointLayer);
  if (networkFacilityLayer) layers.push(networkFacilityLayer);
  if (networkSharedParcelsLayer) layers.push(networkSharedParcelsLayer);
  if (networkSharedParcelsMultiLayer) layers.push(networkSharedParcelsMultiLayer);
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
