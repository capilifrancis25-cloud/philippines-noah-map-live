'use strict';

function bindWeather(map, maplibregl, showMap, service) {
  const layerSelect = document.getElementById('weather-layer');
  const airportToggle = document.getElementById('airport-temperatures');
  const refresh = document.getElementById('refresh-weather');
  const legend = document.getElementById('weather-legend');
  const layerTime = document.getElementById('weather-layer-time');
  const playback = document.getElementById('cloud-playback');
  const player = document.getElementById('weather-player');
  const position = document.getElementById('weather-position');
  const frameLabel = document.getElementById('weather-frame');
  const frameCount = document.getElementById('weather-frame-count');
  const play = document.getElementById('weather-play');
  const dayBack = document.getElementById('weather-day-back');
  const dayForward = document.getElementById('weather-day-forward');
  const airportTime = document.getElementById('airport-time');
  const message = document.getElementById('weather-status');
  const mediaUrl = (file, version = '') => service ? service.mediaUrl(file, version) : '/weather/' + file + version;
  const timestamp = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
  const forecastBounds = [[116.855, 19.402], [127.055, 19.402], [127.055, 5.205], [116.855, 5.205]];
  const rainfallBounds = [[115.35, 21.55], [128.25, 21.55], [128.25, 3.85], [115.35, 3.85]];
  const satelliteBounds = [[100, 29.25], [160, 29.25], [160, 5], [100, 5]];
  const rasterId = 'weather-overlay';
  const airportMarkers = [];
  let airportPopup;
  let data = { forecasts: {}, observedLayers: {}, observations: null };
  let shownUrl;
  let shownLayer;
  let timelineLayer;
  let frames = [];
  let playing;

  function stopPlayer() {
    clearInterval(playing);
    playing = undefined;
    play.textContent = 'Play';
  }

  function configurePlayer() {
    const layer = layerSelect.value;
    const oldPosition = Number(position.value);
    const previous = timelineLayer === layer ? frames[oldPosition] : null;
    const followLatest = layer === 'cloud-history' && oldPosition === frames.length - 1;
    timelineLayer = layer;
    if (layer === 'cloud-history') {
      frames = data.cloudHistory?.frames || [];
    } else if (layer === 'max-temperature' || layer === 'heat-index') {
      frames = [1, 2, 3, 4, 5].map(day => ({ day, id: day === 1 ? layer : layer + '-day' + day }))
        .filter(frame => data.forecasts[frame.id]);
    } else {
      frames = [];
    }
    stopPlayer();
    position.max = String(Math.max(0, frames.length - 1));
    const match = frames.findIndex(frame => frame.id === previous?.id);
    position.value = String(match !== -1 && !followLatest ? match : layer === 'cloud-history' ? frames.length - 1 : 0);
    player.hidden = !frames.length;
    position.disabled = play.disabled = frames.length < 2;
    dayBack.hidden = dayForward.hidden = layer !== 'cloud-history';
    frameCount.textContent = layer === 'cloud-history' ? frames.length + ' hourly frames' : frames.length + ' forecast days';
  }

  function updatePlayerLabel(frame) {
    const label = frame.time ? timestamp.format(new Date(frame.time)) : 'Day ' + frame.day;
    frameLabel.value = label;
    position.setAttribute('aria-valuetext', label);
    dayBack.disabled = Number(position.value) === 0;
    dayForward.disabled = Number(position.value) === frames.length - 1;
  }

  function showFrame(index) {
    position.value = String(index);
    renderWeatherLayer();
  }

  function jumpDay(days) {
    stopPlayer();
    const target = Date.parse(frames[Number(position.value)].time) + days * 24 * 60 * 60 * 1000;
    const nearest = frames.reduce((best, frame, index) =>
      Math.abs(Date.parse(frame.time) - target) < Math.abs(Date.parse(frames[best].time) - target) ? index : best, 0);
    showFrame(nearest);
  }

  function updatePlayback() {
    const video = map.getSource(rasterId)?.getVideo?.();
    playback.disabled = !video;
    playback.textContent = video?.paused ? 'Play cloud loop' : 'Pause cloud loop';
  }

  function renderWeatherLayer() {
    const layer = layerSelect.value;
    const frame = frames[Number(position.value)];
    const id = frame?.id || layer;
    const isHistory = layer === 'cloud-history';
    const isVideo = layer === 'satellite-clouds';
    const fetchedAt = data.observedLayers[id] || data.forecasts[id];
    const version = '?fetched=' + encodeURIComponent(fetchedAt);
    let path = fetchedAt ? mediaUrl(isVideo ? id + '.webm' : id + '-image.png', version) : null;
    if (isHistory && frame) path = mediaUrl('cloud-history/' + frame.id + '.png');
    const url = path ? new URL(path, location.href).href : null;

    if (url && shownLayer === layer && !isVideo && shownUrl && shownUrl !== url) {
      map.getSource(rasterId).updateImage({ url });
    } else if (shownUrl !== url) {
      if (map.getLayer(rasterId)) {
        map.removeLayer(rasterId);
        map.removeSource(rasterId);
      }
      if (url) {
        const firstOverlay = map.getStyle().layers.find(layer =>
          layer.source?.startsWith('noah') || layer.id === 'local-import' ||
          layer.type === 'fill-extrusion' || layer.type === 'symbol');
        const coordinates = isHistory ? data.cloudHistory.bounds : id === 'recent-rainfall' ? rainfallBounds : forecastBounds;
        const source = isVideo ?
          { type: 'video', urls: [url], coordinates: satelliteBounds } :
          { type: 'image', url, coordinates };
        map.addSource(rasterId, source);
        map.addLayer({ id: rasterId, source: rasterId, type: 'raster',
          paint: { 'raster-opacity': isVideo || isHistory ? 0.62 : 0.72, 'raster-fade-duration': 0 } }, firstOverlay?.id);
      }
    }
    shownUrl = url;
    shownLayer = layer;
    playback.hidden = !url || !isVideo;
    updatePlayback();
    legend.hidden = !url || isVideo || isHistory;
    if (!legend.hidden) {
      const legendId = frames[0]?.id || id;
      const legendUrl = mediaUrl(legendId + '-legend.png');
      if (legend.getAttribute('src') !== legendUrl) legend.src = legendUrl;
      legend.alt = layerSelect.selectedOptions[0].textContent + ' color scale';
    }
    layerTime.hidden = !url || isHistory;
    if (url && !isHistory) {
      const label = isVideo ? 'Satellite loop downloaded ' : 'Map downloaded ';
      layerTime.textContent = service ? 'Live map source · UP NOAH' : label + timestamp.format(new Date(fetchedAt));
    }
    if (frame) updatePlayerLabel(frame);
  }

  function describeStationWeather(report) {
    const details = [];
    const coverLabels = {
      SKC: 'Clear', CLR: 'Clear', NSC: 'No significant clouds', NCD: 'No cloud detected',
      FEW: 'Few clouds', SCT: 'Scattered clouds', BKN: 'Broken clouds', OVC: 'Overcast',
      VV: 'Vertical visibility'
    };
    for (const { cover, base } of report.cloudLayers || []) {
      const height = base === null ? '' : (cover === 'VV' ? ' ' : ' at ') + base.toLocaleString('en-PH') + ' ft';
      details.push(coverLabels[cover] + height);
    }
    if (report.wind) {
      const { speed, direction, gust } = report.wind;
      const from = direction === 'VRB' ? ' variable direction' :
        direction === null ? '' : ' from ' + direction + '°';
      details.push(speed === 0 ? 'Calm wind' : 'Wind ' + speed + ' kt' + from +
        (gust === null ? '' : ', gusts ' + gust + ' kt'));
    }
    return details;
  }

  function renderAirports() {
    for (const marker of airportMarkers) marker.remove();
    airportMarkers.length = 0;
    airportPopup?.remove();
    const reports = data.observations?.reports || [];
    airportTime.hidden = !airportToggle.checked || !reports.length;
    if (airportTime.hidden) return;
    airportTime.textContent = 'Latest of ' + reports.length + ' reports · ' +
      timestamp.format(Math.max(...reports.map(report => report.obsTime)) * 1000);
    for (const report of reports) {
      const markerButton = document.createElement('button');
      markerButton.type = 'button';
      markerButton.className = 'airport-marker';
      markerButton.textContent = report.temp + '°';
      markerButton.setAttribute('aria-label', report.icaoId + ' measured temperature ' + report.temp + ' degrees Celsius');
      const coordinates = [report.lon, report.lat];
      markerButton.addEventListener('click', event => {
        event.stopPropagation();
        airportPopup?.remove();
        const detail = document.createElement('div');
        detail.className = 'weather-popup';
        const label = document.createElement('strong');
        label.textContent = report.icaoId + ' · ' + report.name;
        const reading = document.createElement('p');
        reading.textContent = report.temp + ' °C measured ' + timestamp.format(report.obsTime * 1000);
        detail.append(label, reading);
        for (const text of describeStationWeather(report)) {
          const line = document.createElement('p');
          line.textContent = text;
          detail.append(line);
        }
        airportPopup = new maplibregl.Popup({ offset: 14 })
          .setLngLat(coordinates).setDOMContent(detail).addTo(map);
      });
      airportMarkers.push(new maplibregl.Marker({ element: markerButton }).setLngLat(coordinates).addTo(map));
    }
  }

  function applyStatus(next) {
    data = { observedLayers: {}, ...next };
    const layers = { ...data.forecasts, ...data.observedLayers };
    if (data.cloudHistory?.frames.length) layers['cloud-history'] = true;
    for (const name of ['max-temperature', 'heat-index']) {
      layers[name] ||= Object.keys(data.forecasts).some(key => key.startsWith(name + '-day'));
    }
    const hasLayers = Object.values(layers).some(Boolean);
    const hasReports = Boolean(data.observations?.reports.length);
    for (const option of layerSelect.options) {
      option.disabled = Boolean(option.value) && !layers[option.value];
    }
    layerSelect.disabled = !hasLayers;
    airportToggle.disabled = !hasReports;
    configurePlayer();
    renderWeatherLayer();
    renderAirports();
    const saved = hasLayers || hasReports;
    if (data.failures.length) {
      const labels = { 'max-temperature': 'maximum temperature', 'heat-index': 'heat index',
        rainfall: 'rainfall forecast', 'satellite-clouds': 'satellite clouds',
        'recent-rainfall': 'recent rainfall', observations: 'airport reports', 'cloud-history': 'some hourly cloud frames' };
      const unavailable = new Set(data.failures.map(id => labels[id.replace(/-day[2-5]$/, '')] || id));
      message.textContent = 'Refresh unavailable for ' + [...unavailable].join(', ') +
        '. ' + (saved ? 'Previously saved data remains available.' : 'Try refreshing again in five minutes.');
    } else {
      message.textContent = service ? 'Weather loads from its source when selected.' :
        saved ? 'Saved weather layers work offline.' : 'No saved weather yet. Connect to the internet and refresh.';
    }
  }

  async function loadStatus(url, options) {
    if (service) {
      applyStatus(await service.status());
      return;
    }
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Weather request failed');
    applyStatus(await response.json());
  }

  layerSelect.addEventListener('change', () => {
    configurePlayer();
    renderWeatherLayer();
    if (layerSelect.value) showMap();
  });
  position.addEventListener('input', () => { stopPlayer(); renderWeatherLayer(); });
  dayBack.addEventListener('click', () => jumpDay(-1));
  dayForward.addEventListener('click', () => jumpDay(1));
  play.addEventListener('click', () => {
    if (playing) return stopPlayer();
    if (Number(position.value) === frames.length - 1) showFrame(0);
    playing = setInterval(() => showFrame((Number(position.value) + 1) % frames.length), 950);
    play.textContent = 'Pause';
  });
  map.on('sourcedata', event => {
    if (event.sourceId === rasterId && layerSelect.value === 'satellite-clouds') updatePlayback();
  });
  playback.addEventListener('click', async () => {
    const video = map.getSource(rasterId)?.getVideo?.();
    if (!video) return;
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {
      message.textContent = 'The cloud loop could not play in this browser.';
    } finally {
      updatePlayback();
    }
  });
  airportToggle.addEventListener('change', () => { renderAirports(); if (airportToggle.checked) showMap(); });
  refresh.addEventListener('click', async () => {
    if (data.retryAt > Date.now()) {
      message.textContent = 'Next refresh available at ' + timestamp.format(data.retryAt) + '.';
      return;
    }
    refresh.disabled = true;
    message.textContent = service ? 'Refreshing weather sources…' :
      'Fetching weather. The first hourly archive download may take a minute.';
    try {
      await loadStatus('/weather/refresh', { method: 'POST' });
    } catch {
      message.textContent = 'Could not refresh weather. Check your connection and try again.';
    } finally {
      refresh.disabled = false;
    }
  });
  loadStatus('/weather/status.json').catch(() => {
    message.textContent = 'Could not read saved weather. Try refreshing.';
  }).finally(() => { refresh.disabled = false; });
}
