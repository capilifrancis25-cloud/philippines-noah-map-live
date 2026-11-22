'use strict';

function registerOverviewProtocol(maplibregl) {
  maplibregl.addProtocol('noah-overview', async (request, controller) => {
    const url = new URL(request.url.slice('noah-overview://'.length));
    if (url.origin !== location.origin) throw new Error('Invalid overview tile origin');
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('Overview tile request failed (' + response.status + ')');
    const raw = await response.arrayBuffer();
    const bytes = new Uint8Array(raw);
    const compressed = bytes[0] === 0x1f && bytes[1] === 0x8b;
    const data = compressed ?
      await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : raw;
    return { data, cacheControl: response.headers.get('cache-control'), expires: response.headers.get('expires') };
  });
}

function overviewSource(overview, name, maxzoom, localUrl, attribution) {
  const tile = localUrl('./overview/' + name + '/{z}/{x}/{y}.pbf.gz')
    .replace(/%7B/g, '{').replace(/%7D/g, '}');
  return { type: 'vector', tiles: ['noah-overview://' + tile], minzoom: 4, maxzoom,
    bounds: overview.bounds, attribution };
}

function addOnlineBasemap(style, url, overview, localUrl) {
  const attribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps';
  const osm = { type: 'vector', url: 'pmtiles://' + url,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · HOT · BetterGov.PH' };
  const detailZoom = overview.basemapMaxZoom + 1;
  const font = ['Noto Sans Regular'];
  const name = ['coalesce', ['get', 'name_en'], ['get', 'name:en'], ['get', 'name'], ''];
  const roadClass = ['get', 'highway'];
  const majorRoad = ['in', roadClass, ['literal', ['motorway', 'trunk', 'primary', 'secondary']]];
  const polygon = ['==', ['geometry-type'], 'Polygon'];
  const line = ['==', ['geometry-type'], 'LineString'];
  const placeLayout = {
    'text-field': name, 'text-font': font, 'text-padding': 8,
    'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 13, 14],
    'symbol-sort-key': ['match', ['get', 'place'], 'city', 0, 'town', 1, 2]
  };
  const placePaint = { 'text-color': '#263b48', 'text-halo-color': '#fff', 'text-halo-width': 1.2 };

  style.glyphs = localUrl('./map-assets/fonts/{fontstack}/{range}.pbf').replace(/%7B/g, '{').replace(/%7D/g, '}');
  style.sources['overview-basemap'] = overviewSource(overview, 'basemap', overview.basemapMaxZoom, localUrl, attribution);
  style.layers.push(
    { id: 'land-outline', type: 'fill', source: 'overview-basemap', 'source-layer': 'earth',
      filter: polygon, paint: { 'fill-color': '#eceee5' } },
    { id: 'overview-water', type: 'fill', source: 'overview-basemap', 'source-layer': 'water',
      filter: polygon, paint: { 'fill-color': '#b9d9e8' } },
    { id: 'overview-boundaries', type: 'line', source: 'overview-basemap', 'source-layer': 'boundaries',
      maxzoom: detailZoom, paint: { 'line-color': '#aab6aa', 'line-width': 0.8 } },
    { id: 'overview-roads', type: 'line', source: 'overview-basemap', 'source-layer': 'roads', minzoom: 7,
      maxzoom: detailZoom, filter: ['in', ['get', 'kind'], ['literal', ['highway', 'major_road']]],
      paint: { 'line-color': '#d7bfa1', 'line-width': 1 } },
    { id: 'overview-places', type: 'symbol', source: 'overview-basemap', 'source-layer': 'places',
      maxzoom: detailZoom, filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', name, '']],
      layout: { ...placeLayout, 'symbol-sort-key': ['match', ['get', 'kind'], 'country', 0, 'locality', 1, 2] },
      paint: placePaint }
  );

  const streetLayers = [
    { id: 'water-areas', type: 'fill', source: 'streets', 'source-layer': 'waterways', minzoom: detailZoom,
      filter: polygon, paint: { 'fill-color': '#b9d9e8' } },
    { id: 'water-lines', type: 'line', source: 'streets', 'source-layer': 'waterways', minzoom: detailZoom,
      filter: line, paint: { 'line-color': '#9ac5de', 'line-width': 1.2 } },
    { id: 'road-lines', type: 'line', source: 'streets', 'source-layer': 'roads', minzoom: detailZoom,
      filter: ['all', line, ['step', ['zoom'], majorRoad, 11, true]],
      paint: { 'line-color': ['case', majorRoad, '#d7bfa1', '#fff'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 13, 1.8, 18, 6] } },
    { id: 'place-labels', type: 'symbol', source: 'places', 'source-layer': 'populated_places', minzoom: detailZoom,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', name, '']], layout: placeLayout, paint: placePaint },
    { id: 'road-labels', type: 'symbol', source: 'streets', 'source-layer': 'roads', minzoom: 13,
      filter: ['all', line, ['!=', name, '']],
      layout: { 'text-field': name, 'text-font': font, 'symbol-placement': 'line', 'text-size': 11 },
      paint: { 'text-color': '#43515a', 'text-halo-color': '#fff', 'text-halo-width': 1.1 } }
  ];
  const firstOverlay = map => map.getStyle().layers.find(layer => layer.source?.startsWith('noah') ||
    layer.id === 'weather-overlay' || layer.id === 'local-import' || layer.type === 'symbol' ||
    layer.type === 'fill-extrusion')?.id;

  return (map, buildings) => {
    const zoom = map.getZoom();
    if (zoom >= detailZoom && !map.getSource('streets')) {
      map.addSource('streets', { ...osm, maxzoom: 13 });
      map.addSource('places', { ...osm, maxzoom: 12 });
      const underOverlays = firstOverlay(map);
      for (const layer of streetLayers) map.addLayer(layer, layer.type === 'symbol' ? undefined : underOverlays);
    }
    if (zoom >= 14 && !map.getSource('basemap')) {
      map.addSource('basemap', osm);
      map.addLayer({
        id: 'building-footprints', type: 'fill', source: 'basemap', 'source-layer': 'buildings', minzoom: 14,
        filter: polygon, paint: { 'fill-color': '#d4d3cb', 'fill-opacity': 0.6 }
      }, firstOverlay(map));
      map.addLayer(buildings(), map.getStyle().layers.find(layer => layer.type === 'symbol')?.id);
    }
  };
}

const onlineWeather = (() => {
  const source = 'https://webgis-static.up.edu.ph/api/';
  const legends = 'https://noah.up.edu.ph/assets/legends/';
  const files = new Map();
  const forecastIds = [];
  for (const [base, prefix, legend] of [
    ['max-temperature', 't2m', 'max_temperature'], ['heat-index', 'HI', 'heat_index']
  ]) {
    for (let day = 1; day <= 5; day++) {
      const id = day === 1 ? base : base + '-day' + day;
      files.set(id + '-image.png', source + 'temperature/' + prefix + '_' + day + '.png');
      files.set(id + '-legend.png', legends + 'temperature/wu_' + legend + '.png');
      forecastIds.push(id);
    }
  }
  files.set('rainfall-image.png', source + 'rainfall/rainmap_gtif_day1.png');
  files.set('rainfall-legend.png', legends + 'rainfall-contour/rainfall-contour-legend-forecast.png');
  files.set('recent-rainfall-image.png', source + 'contours/1hr_latest_rainfall_contour.png');
  files.set('recent-rainfall-legend.png', legends + 'rainfall-contour/rainfall-contour-legend-1hr.png');
  files.set('satellite-clouds.webm', source + 'sat_webm/ph_himawari.webm');
  forecastIds.push('rainfall');

  const bounds = [[113, 23], [131, 23], [131, 3], [113, 3]];
  const hour = 60 * 60 * 1000;
  const longitude = degrees => degrees * Math.PI / 180 * 6378137;
  const latitude = degrees => Math.log(Math.tan(Math.PI / 4 + degrees * Math.PI / 360)) * 6378137;
  const frameId = date => date.toISOString().slice(0, 13).replace(/[-T]/g, '');

  function mediaUrl(file, version) {
    const frame = /^cloud-history\/(\d{4})(\d{2})(\d{2})(\d{2})\.png$/.exec(file);
    if (frame) {
      const [, year, month, day, hour] = frame;
      const parameters = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: 'Himawari_AHI_Band13_Clean_Infrared',
        STYLES: '', CRS: 'EPSG:3857', BBOX: [longitude(113), latitude(3), longitude(131), latitude(23)].join(','),
        WIDTH: 512, HEIGHT: 576, FORMAT: 'image/png', TRANSPARENT: 'TRUE',
        TIME: year + '-' + month + '-' + day + 'T' + hour + ':00:00Z'
      });
      return 'https://gibs.earthdata.nasa.gov/wms/epsg3857/best/wms.cgi?' + parameters;
    }
    const url = files.get(file);
    return url && (file.endsWith('-legend.png') ? url : url + (version || ''));
  }

  function status() {
    const checkedAt = new Date().toISOString();
    const latest = Math.floor((Date.now() - hour) / hour) * hour;
    const frames = Array.from({ length: 97 }, (_, i) => {
      const date = new Date(latest - (96 - i) * hour);
      return { id: frameId(date), time: date.toISOString() };
    });
    return {
      forecasts: Object.fromEntries(forecastIds.map(id => [id, checkedAt])),
      observedLayers: { 'recent-rainfall': checkedAt, 'satellite-clouds': checkedAt },
      observations: null,
      cloudHistory: { bounds, frames },
      retryAt: 0,
      failures: []
    };
  }
  return { mediaUrl, status };
})();
