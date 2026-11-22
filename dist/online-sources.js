'use strict';

function addOnlineBasemap(style, url, localUrl) {
  const osm = {
    type: 'vector', url: 'pmtiles://' + url,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · HOT · BetterGov.PH'
  };
  style.glyphs = localUrl('/map-assets/fonts/{fontstack}/{range}.pbf').replace(/%7B/g, '{').replace(/%7D/g, '}');
  style.sources.basemap = osm;
  style.sources.streets = { ...osm, maxzoom: 13 };
  style.sources.places = { ...osm, maxzoom: 12 };
  style.sources.boundary = { type: 'geojson', data: '/map-assets/ADM2.geojson',
    attribution: '<a href="https://www.geoboundaries.org/">geoBoundaries</a> · CC BY 3.0 IGO' };
  const roadClass = ['get', 'highway'];
  const majorRoad = ['in', roadClass, ['literal', ['motorway', 'trunk', 'primary', 'secondary']]];
  const font = ['Noto Sans Regular'];
  const name = ['coalesce', ['get', 'name_en'], ['get', 'name'], ''];
  style.layers.push(
    { id: 'land-outline', type: 'fill', source: 'boundary', paint: { 'fill-color': '#eceee5', 'fill-outline-color': '#a8b2a2' } },
    { id: 'water-areas', type: 'fill', source: 'streets', 'source-layer': 'waterways',
      filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#b9d9e8' } },
    { id: 'water-lines', type: 'line', source: 'streets', 'source-layer': 'waterways', minzoom: 8,
      filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#9ac5de', 'line-width': 1.2 } },
    { id: 'road-lines', type: 'line', source: 'streets', 'source-layer': 'roads', minzoom: 7,
      filter: ['all', ['==', ['geometry-type'], 'LineString'],
        ['step', ['zoom'], majorRoad, 11, true]],
      paint: { 'line-color': ['case', majorRoad, '#d7bfa1', '#fff'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 13, 1.8, 18, 6] } },
    { id: 'building-footprints', type: 'fill', source: 'basemap', 'source-layer': 'buildings', minzoom: 14,
      filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#d4d3cb', 'fill-opacity': 0.6 } },
    { id: 'place-labels', type: 'symbol', source: 'places', 'source-layer': 'populated_places', minzoom: 5,
      filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', name, '']],
      layout: { 'text-field': name, 'text-font': font,
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 13, 14], 'text-padding': 8,
        'symbol-sort-key': ['match', ['get', 'place'], 'city', 0, 'town', 1, 'village', 2, 3] },
      paint: { 'text-color': '#263b48', 'text-halo-color': '#fff', 'text-halo-width': 1.2 } },
    { id: 'road-labels', type: 'symbol', source: 'streets', 'source-layer': 'roads', minzoom: 13,
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', name, '']],
      layout: { 'text-field': name, 'text-font': font, 'symbol-placement': 'line', 'text-size': 11 },
      paint: { 'text-color': '#43515a', 'text-halo-color': '#fff', 'text-halo-width': 1.1 } }
  );
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
