'use strict';

const byId = id => document.getElementById(id);
const philippines = [[116.3, 4.5], [126.9, 21.25]];
const buildingZoom = 15;
const buildingLayerId = 'basemap-buildings-3d';
const groups = [
  { title: 'Flood', enabled: true, items: [
    ['flood_25yr', '25-year rainfall scenario'],
    ['flood_5yr', '5-year rainfall scenario']
  ] },
  { title: 'Landslide', enabled: false, items: [
    ['landslide', 'Landslide hazard'], ['debris_flow', 'Debris flow and alluvial fan']
  ] },
  { title: 'Storm surge', enabled: false, items: [
    ['storm_surge_ssa1', 'Advisory 1'], ['storm_surge_ssa2', 'Advisory 2'],
    ['storm_surge_ssa3', 'Advisory 3'], ['storm_surge_ssa4', 'Advisory 4']
  ] }
];
const knownLayers = Object.fromEntries(groups.flatMap(group => group.items.map(([id, label]) =>
  [id, { label: group.title + ' · ' + label, group: group.title }]
)));
const localUrl = path => new URL(path, window.location.href).href;
const active = new Set();
let map;
let marker;
let pinned;
let places = [];
let importedName;
let maplibregl;
let archiveAvailable = false;
let mapReady = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function makeLayerControls(available) {
  for (const group of groups) {
    const items = group.items.filter(([id]) => available.has(id));
    if (!items.length) continue;
    const block = node('div', '', 'layer-group');
    const label = node('label');
    const toggle = node('input');
    toggle.type = 'checkbox';
    toggle.checked = group.enabled;
    label.append(toggle, document.createTextNode(group.title));
    const selector = node('select');
    selector.setAttribute('aria-label', group.title + ' scenario');
    for (const [id, title] of items) {
      const option = node('option', title);
      option.value = id;
      selector.append(option);
    }
    const update = () => {
      for (const [id] of items) {
        const visible = toggle.checked && selector.value === id;
        if (visible) active.add(id);
        else active.delete(id);
        if (map?.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
      if (pinned) inspect();
    };
    toggle.addEventListener('change', update);
    selector.addEventListener('change', () => { toggle.checked = true; update(); });
    const selectorWrap = node('div', '', 'select-wrap');
    selectorWrap.append(selector);
    block.append(label, selectorWrap);
    byId('layer-controls').append(block);
    update();
  }
}

function hazardClass(layer, value) {
  if (value === undefined || value === null || value === '') return 'Class unavailable';
  if (knownLayers[layer]?.group !== 'Landslide') {
    return ({ 1: 'Low', 2: 'Medium', 3: 'High' })[value] || 'Class ' + value;
  }
  return 'NOAH class ' + value;
}

function getAttribute(properties, field) {
  return properties[Object.keys(properties).find(key => key.toLowerCase() === field.toLowerCase())];
}

function inspect() {
  if (!pinned || !mapReady) return;
  const output = byId('inspection-result');
  if (!map.areTilesLoaded()) {
    output.textContent = 'Reading the selected map layers…';
    return;
  }
  const layers = [...active].filter(id => map.getLayer(id));
  if (map.getLayer('local-import')) layers.push('local-import');
  if (!layers.length) {
    output.textContent = archiveAvailable ? 'Turn on a hazard layer or open a local shapefile ZIP.' :
      'Open a local shapefile ZIP to inspect this location.';
    return;
  }
  const point = map.project(pinned);
  const canvas = map.getCanvas();
  if (point.x < 0 || point.y < 0 || point.x > canvas.clientWidth || point.y > canvas.clientHeight) {
    output.textContent = 'The selected pin is outside the current map view.';
    return;
  }
  const matches = new Map();
  const rendered = map.queryRenderedFeatures([point.x, point.y], { layers });
  for (const feature of rendered) {
    const id = feature.layer.id;
    const properties = feature.properties;
    const value = ['Var', 'HAZ', 'GRIDCODE', 'GRID'].map(key => getAttribute(properties, key))
      .find(entry => entry !== undefined && entry !== null && entry !== '');
    const level = id === 'local-import' && value !== undefined ? 'Source class ' + value : hazardClass(id, value);
    if (!matches.has(id)) matches.set(id, new Set());
    matches.get(id).add(level);
  }
  const list = node('ul');
  for (const [id, values] of matches) {
    const item = node('li');
    item.append(node('strong', knownLayers[id]?.label || importedName), document.createTextNode(' · ' + [...values].join(', ')));
    list.append(item);
  }
  output.replaceChildren();
  if (list.childElementCount) {
    output.append(list, node('p', 'Use the original shapefile for exact boundaries.', 'hint'));
  } else {
    output.textContent = 'No visible hazard polygon at this pin. Coverage and detail vary by layer and zoom.';
  }
}

function setPin(location) {
  pinned = location;
  marker.setLngLat(location).addTo(map);
  byId('coordinate').textContent = location[1].toFixed(5) + '°, ' + location[0].toFixed(5) + '°';
  inspect();
}

function normalize(value) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function findPlaces(value) {
  const term = normalize(value);
  if (term.length < 2) return [];
  const hits = places.filter(place => place.search.includes(term));
  return hits.sort((a, b) => Number(!a.search.startsWith(term)) - Number(!b.search.startsWith(term)) ||
    a.name.localeCompare(b.name)).slice(0, 7);
}

function parseCoordinates(value) {
  const match = value.trim().match(/^([+-]?\d+(?:\.\d+)?)\s*[,; ]\s*([+-]?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  const [lon, lat] = Math.abs(first) > 90 ? [first, second] : [second, first];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lon, lat] : null;
}

function bindSearch() {
  const form = byId('search-form');
  const input = byId('search');
  const results = byId('suggestions');
  const status = byId('search-status');
  function selectPlace(place) {
    map.fitBounds(place.bounds, { padding: 60, maxZoom: 13, duration: 450 });
    setPin(place.center);
    input.value = place.name;
    results.hidden = true;
    status.textContent = place.type + (place.parent ? ' · ' + place.parent : '');
    showMapOnSmallScreen();
  }
  input.addEventListener('input', () => {
    const hits = findPlaces(input.value);
    results.replaceChildren(...hits.map(place => {
      const row = node('li');
      const button = node('button', place.name);
      button.type = 'button';
      button.append(node('small', place.type + (place.parent ? ' · ' + place.parent : '')));
      button.addEventListener('click', () => selectPlace(place));
      row.append(button);
      return row;
    }));
    results.hidden = !hits.length;
  });
  form.addEventListener('keydown', event => { if (event.key === 'Escape') results.hidden = true; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!mapReady) return;
    const location = parseCoordinates(input.value);
    if (location) {
      if (location.some((coordinate, i) => coordinate < philippines[0][i] || coordinate > philippines[1][i])) {
        status.textContent = 'Enter coordinates within the Philippines map extent.';
        return;
      }
      map.flyTo({ center: location, zoom: 12 });
      setPin(location);
      results.hidden = true;
      status.textContent = 'Pin placed on the map.';
      showMapOnSmallScreen();
      return;
    }
    const hits = findPlaces(input.value);
    if (hits.length) selectPlace(hits[0]);
    else status.textContent = 'No matching place. Try a different name or enter latitude, longitude.';
  });
}

function showMapOnSmallScreen() {
  if (matchMedia('(max-width: 700px)').matches) {
    map.getContainer().parentElement.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function shapeBounds(data) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  function visit(coordinates) {
    if (!Array.isArray(coordinates)) return;
    const [x, y] = coordinates;
    if (typeof x === 'number' && typeof y === 'number') {
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    } else coordinates.forEach(visit);
  }
  for (const feature of data.features) visit(feature.geometry?.coordinates);
  return bounds;
}

function bindImport() {
  const input = byId('upload');
  const status = byId('import-status');
  const remove = byId('remove-import');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (!mapReady || !window.shp) {
      status.textContent = 'Wait for the local map to finish loading.';
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      status.textContent = 'Choose a ZIP under 100 MiB for browser import.';
      input.value = '';
      return;
    }
    input.disabled = true;
    status.textContent = 'Reading ' + file.name + '…';
    try {
      const parsed = await window.shp(await file.arrayBuffer());
      const features = (Array.isArray(parsed) ? parsed : [parsed]).flatMap(collection => collection.features)
        .filter(feature => ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type));
      const data = { type: 'FeatureCollection', features };
      const bounds = shapeBounds(data);
      if (!features.length || bounds[0] < 114 || bounds[2] > 129 || bounds[1] < 3 || bounds[3] > 23) {
        throw new Error('Choose a polygon layer within the Philippines with a valid .prj file.');
      }
      if (map.getSource('local-import')) {
        map.getSource('local-import').setData(data);
      } else {
        map.addSource('local-import', { type: 'geojson', data });
        map.addLayer({ id: 'local-import', type: 'fill', source: 'local-import', paint: {
          'fill-color': '#19777e', 'fill-opacity': 0.68, 'fill-outline-color': '#084f59'
        }}, map.getStyle().layers.find(layer => layer.type === 'fill-extrusion' || layer.type === 'symbol')?.id);
      }
      importedName = file.name;
      remove.hidden = false;
      status.textContent = features.length.toLocaleString() + ' local polygons shown in teal.';
      map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 60, maxZoom: 14 });
    } catch (error) {
      status.textContent = 'Could not open that ZIP. ' + error.message;
      input.value = '';
    } finally { input.disabled = false; }
  });
  remove.addEventListener('click', () => {
    if (map.getLayer('local-import')) {
      map.removeLayer('local-import');
      map.removeSource('local-import');
    }
    input.value = '';
    remove.hidden = true;
    status.textContent = 'Local layer removed.';
    inspect();
  });
}

function buildingLayer(online) {
  const base = ['max', 0, ['number', ['get', 'min_height'], 0]];
  const mappedHeight = online ?
    ['to-number', ['coalesce', ['get', 'height'], ['*', 3, ['to-number', ['get', 'building_levels'], 0]], 0], 0] :
    ['number', ['get', 'height'], 7];
  const height = ['max', ['+', base, 2], online ? ['case', ['>', mappedHeight, 0], mappedHeight, 7] : mappedHeight];
  return {
    id: buildingLayerId,
    type: 'fill-extrusion',
    source: 'basemap',
    'source-layer': 'buildings',
    minzoom: buildingZoom,
    filter: online ? ['==', ['geometry-type'], 'Polygon'] :
      ['all', ['==', ['geometry-type'], 'Polygon'],
        ['in', ['get', 'kind'], ['literal', ['building', 'building_part']]]],
    paint: {
      'fill-extrusion-color': '#e0dcd4',
      'fill-extrusion-opacity': 0.86,
      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], buildingZoom - 0.25, 0, buildingZoom + 0.65, height],
      'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], buildingZoom - 0.25, 0, buildingZoom + 0.65, base]
    }
  };
}

function bindBuildingView() {
  const toggle = byId('building-view');
  toggle.hidden = false;
  let detailed = false;
  function updatePitch() {
    const next = toggle.getAttribute('aria-pressed') === 'true' && map.getZoom() >= buildingZoom;
    if (detailed === next) return;
    detailed = next;
    const pitch = detailed ? 42 : 0;
    if (Math.abs(map.getPitch() - pitch) > 0.1) map.easeTo({ pitch, duration: 300 });
  }
  toggle.addEventListener('click', () => {
    const enabled = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(enabled));
    map.setLayoutProperty(buildingLayerId, 'visibility', enabled ? 'visible' : 'none');
    updatePitch();
  });
  map.on('moveend', updatePitch);
  updatePitch();
}

async function initialize() {
  bindSearch();
  bindImport();
  const status = byId('map-status');
  if (location.protocol === 'file:') {
    status.textContent = 'Start Open Dashboard.cmd to open this page with its local map files.';
    return;
  }
  const [module, manifest] = await Promise.all([
    import('./vendor/maplibre-gl.mjs'),
    fetch('./manifest.json').then(response => response.json())
  ]);
  maplibregl = module;
  const remoteHazards = manifest.hazardSources;
  const availableHazards = new Set(Object.keys(knownLayers).filter(id => !remoteHazards || Object.hasOwn(remoteHazards, id)));
  makeLayerControls(availableHazards);
  archiveAvailable = Boolean(manifest.hazard || (remoteHazards && availableHazards.size));
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  const style = { version: 8, sources: {}, layers: [
    { id: 'water-background', type: 'background', paint: { 'background-color': '#dceaf2' } }
  ] };
  if (manifest.basemapUrl) {
    addOnlineBasemap(style, manifest.basemapUrl, localUrl);
  } else if (manifest.basemap) {
    style.glyphs = localUrl('./map-assets/fonts/{fontstack}/{range}.pbf').replace(/%7B/g, '{').replace(/%7D/g, '}');
    const basemapArchive = manifest.basemapArchive || 'philippines.pmtiles';
    style.sources.basemap = { type: 'vector', url: 'pmtiles://' + localUrl('./map-assets/tiles/' + basemapArchive),
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps' };
    const baseStyle = { ...basemaps.namedFlavor('light'), water: '#bddce8' };
    const baseLayers = basemaps.layers('basemap', baseStyle, { lang: 'en' });
    for (const layer of baseLayers) {
      if (layer.layout?.['icon-image']) {
        if (!layer.layout['text-field']) continue;
        delete layer.layout['icon-image'];
      }
      if (layer.layout?.['text-font']) layer.layout['text-font'] = ['Noto Sans Regular'];
      if (layer.type === 'background') style.layers[0] = layer;
      else style.layers.push(layer);
    }
  } else if (manifest.boundaries) {
    style.sources.boundary = { type: 'geojson', data: './map-assets/ADM2.geojson' };
    style.layers.push({ id: 'land-outline', type: 'fill', source: 'boundary',
      paint: { 'fill-color': '#eef3e8', 'fill-outline-color': '#8aa89f' } });
  }
  if (archiveAvailable) {
    const attribution = '<a href="https://noah.up.edu.ph/">Project NOAH</a> · <a href="https://huggingface.co/datasets/bettergovph/project-noah-hazard-maps">BetterGov.PH</a> · ODbL';
    if (!remoteHazards) {
      style.sources.noah = {
        type: 'vector', url: 'pmtiles://' + localUrl('./map-assets/tiles/' + manifest.hazard), attribution
      };
    }
    const hazards = [...availableHazards].map(id => {
      const layer = knownLayers[id];
      const source = remoteHazards ? 'noah-' + id : 'noah';
      if (remoteHazards) style.sources[source] = { type: 'vector', url: 'pmtiles://' + remoteHazards[id], attribution };
      const isSlope = layer.group === 'Landslide';
      const classification = ['to-number', ['get', layer.group === 'Flood' ? 'Var' : 'HAZ'], 0];
      const palette = isSlope ? ['#ceb5e7', '#b386d6', '#8b56b0', '#633888'] :
        ['#efd04e', '#f08f36', '#d84542', '#ab2235'];
      return {
        id, type: 'fill', source, 'source-layer': id,
        layout: { visibility: active.has(id) ? 'visible' : 'none' },
        paint: { 'fill-color': ['match', classification, 1, palette[0], 2, palette[1], 3, palette[2], 4, palette[3], '#738695'],
          'fill-opacity': 0.72 }
      };
    });
    const firstLabel = style.layers.findIndex(layer => layer.type === 'symbol');
    style.layers.splice(firstLabel === -1 ? style.layers.length : firstLabel, 0, ...hazards);
  }
  if (manifest.basemap) {
    const firstLabel = style.layers.findIndex(layer => layer.type === 'symbol');
    style.layers.splice(firstLabel === -1 ? style.layers.length : firstLabel, 0, buildingLayer(Boolean(manifest.basemapUrl)));
  }
  const showHome = () => map.fitBounds(philippines, { padding: 24, duration: 450, pitch: 0 });
  map = new maplibregl.Map({ container: 'map', style, bounds: philippines, fitBoundsOptions: { padding: 24 },
    maxZoom: 20, minZoom: 4, maxBounds: [[114, 2], [130, 23]], dragRotate: false });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');
  marker = new maplibregl.Marker({ color: '#096853' });
  byId('home').addEventListener('click', showHome);
  map.on('click', event => setPin(event.lngLat.toArray()));
  map.on('idle', inspect);
  map.on('load', () => {
    mapReady = true;
    if (manifest.basemap) bindBuildingView();
    bindWeather(map, maplibregl, showMapOnSmallScreen, manifest.basemapUrl ? onlineWeather : undefined);
    if (manifest.basemap && (manifest.hazard === 'noah.pmtiles' || remoteHazards)) status.hidden = true;
    else status.textContent = !manifest.hazard ? 'Open a local shapefile ZIP to view hazard data.' :
      'Local overview tiles are loaded. Fine boundaries can be reviewed from a shapefile ZIP.';
  });
  map.on('error', event => {
    console.error(event.error);
    status.hidden = false;
    status.textContent = manifest.basemapUrl ? 'A map layer could not be loaded. Try reloading the page.' :
      'A local map asset could not be read. Check the dashboard files and reload.';
  });
  if (manifest.places) {
    const index = await fetch('./map-assets/places.json').then(response => response.json());
    places = index.map(place => ({ ...place, search: normalize(place.name + ' ' + (place.parent || '')) }));
  }
}

initialize().catch(error => {
  byId('map-status').textContent = 'The local dashboard could not load. ' + error.message;
  console.error(error);
});
