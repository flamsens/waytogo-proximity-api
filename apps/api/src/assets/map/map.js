// Playground map for the shared-mobility proximity API (vanilla JS, no build step).
(() => {
  'use strict';

  // ---- Config ---------------------------------------------------------------
  const COLORS = { car: '#cf222e', bicycle: '#1a7f37', cargo_bicycle: '#9a6700', scooter: '#8250df' };
  const OTHER_COLOR = '#59636e';
  const BELGIUM = { center: [4.47, 50.5], zoom: 7 };
  const $ = (id) => document.getElementById(id);

  const state = {
    center: null, // [lon, lat]
    radius: 200,
    carRadius: 400,
    useCarRadius: false,
    enabled: new Set(Object.keys(COLORS)),
  };

  // ---- Map ------------------------------------------------------------------
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    ...BELGIUM,
  });
  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  const colorExpression = ['match', ['get', 'formFactor'], ...Object.entries(COLORS).flat(), OTHER_COLOR];

  map.on('load', async () => {
    map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'heat', type: 'heatmap', source: 'points', layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['get', 'count'],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 14, 2],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 7, 6, 14, 30],
      },
    });
    map.addLayer({
      id: 'points', type: 'circle', source: 'points',
      paint: {
        'circle-color': colorExpression,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 15, 5],
        'circle-opacity': 0.8,
      },
    });
    map.addSource('range', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'range-fill', type: 'fill', source: 'range', filter: ['==', ['get', 'kind'], 'all'], paint: { 'fill-color': '#0969da', 'fill-opacity': 0.08 } });
    map.addLayer({ id: 'range-line', type: 'line', source: 'range', paint: {
      'line-color': ['match', ['get', 'kind'], 'car', COLORS.car, '#0969da'],
      'line-width': 2,
      'line-dasharray': ['match', ['get', 'kind'], 'car', ['literal', [2, 2]], ['literal', [1, 0]]],
    } });

    await loadPoints();
    applyFilter();
  });

  map.on('click', (e) => {
    state.center = [e.lngLat.lng, e.lngLat.lat];
    update();
  });

  async function loadPoints() {
    const res = await fetch('/v1/points');
    if (!res.ok) { $('snapshotCaption').textContent = 'Data not loaded yet, retrying…'; setTimeout(loadPoints, 5000); return; }
    const data = await res.json();
    map.getSource('points').setData(data);
    renderFormFactorToggles(data.features);
    // The oldest source fetch time is when this snapshot was taken.
    const health = await (await fetch('/health')).json();
    const fetched = Object.values(health.sources || {}).map((s) => s.fetchedAt).filter(Boolean).sort()[0];
    const when = fetched ? new Date(fetched).toLocaleString() : 'unknown time';
    $('snapshotCaption').textContent = `Snapshot of ${when}, not an average: free-floating vehicles move during the day.`;
  }

  // ---- Controls -------------------------------------------------------------
  function renderFormFactorToggles(features) {
    const totals = {};
    for (const f of features) totals[f.properties.formFactor] = (totals[f.properties.formFactor] || 0) + f.properties.count;
    $('formFactors').innerHTML = '';
    for (const ff of Object.keys(totals).sort()) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" ${state.enabled.has(ff) ? 'checked' : ''}/> <span class="swatch" style="background:${COLORS[ff] || OTHER_COLOR}"></span>${ff.replace('_', ' ')} (${totals[ff]})`;
      label.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) state.enabled.add(ff);
        else state.enabled.delete(ff);
        applyFilter();
      });
      $('formFactors').append(label);
    }
  }

  function applyFilter() {
    const filter = ['in', ['get', 'formFactor'], ['literal', [...state.enabled]]];
    map.setFilter('points', filter);
    map.setFilter('heat', filter);
  }

  document.querySelectorAll('input[name=view]').forEach((input) =>
    input.addEventListener('change', () => {
      const heat = input.value === 'heatmap' && input.checked;
      map.setLayoutProperty('heat', 'visibility', heat ? 'visible' : 'none');
      map.setLayoutProperty('points', 'visibility', heat ? 'none' : 'visible');
    }),
  );

  /** Keeps a slider and its number input in sync and stores the value in `state[key]`. */
  function bindRange(sliderId, numberId, key) {
    const set = (v) => {
      const value = Math.min(1000, Math.max(1, Number(v) || 1));
      $(sliderId).value = $(numberId).value = state[key] = value;
      scheduleUpdate();
    };
    $(sliderId).addEventListener('input', (e) => set(e.target.value));
    $(numberId).addEventListener('change', (e) => set(e.target.value));
  }
  bindRange('radius', 'radiusNumber', 'radius');
  bindRange('carRadius', 'carRadiusNumber', 'carRadius');
  $('useCarRadius').addEventListener('change', (e) => {
    state.useCarRadius = e.target.checked;
    $('carRadiusRow').hidden = !state.useCarRadius;
    scheduleUpdate();
  });

  let timer;
  function scheduleUpdate() {
    clearTimeout(timer);
    timer = setTimeout(update, 250);
  }

  // ---- Query + result -------------------------------------------------------
  let latestRequest = 0;
  async function update() {
    if (!state.center) return;
    drawRange();
    const [lon, lat] = state.center;
    const params = new URLSearchParams({ lat, lon, radius: state.radius });
    if (state.useCarRadius) params.set('carRadius', state.carRadius);
    // Responses can arrive out of order; only the newest request may update the panel.
    const requestId = ++latestRequest;
    const res = await fetch(`/v1/availability?${params}`);
    const body = await res.json();
    if (requestId !== latestRequest) return;
    if (!res.ok) {
      $('result').innerHTML = `<p class="error">${[].concat(body.message).join(', ')}</p>`;
      return;
    }
    const rows = Object.entries(body.byFormFactor)
      .map(([ff, n]) => `<tr><td><span class="swatch" style="background:${COLORS[ff] || OTHER_COLOR}"></span>${ff.replace('_', ' ')}</td><td>${n}</td></tr>`)
      .join('');
    $('result').innerHTML = `<table>${rows}<tr class="total"><td>Total</td><td>${body.total}</td></tr></table>`;
    $('dataAge').textContent = `Data is ${Math.round(body.data.ageSeconds / 60)} min old.`;
  }

  /** Circle as a 64-vertex polygon around `center` (destination-point formula). */
  function circle(center, meters) {
    const R = 6371008.8, [lon, lat] = center.map((d) => (d * Math.PI) / 180), d = meters / R;
    const ring = [];
    for (let i = 0; i <= 64; i++) {
      const b = (i / 64) * 2 * Math.PI;
      const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
      const lon2 = lon + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
      ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }
    return ring;
  }

  function drawRange() {
    const features = [{ type: 'Feature', properties: { kind: 'all' }, geometry: { type: 'Polygon', coordinates: [circle(state.center, state.radius)] } }];
    if (state.useCarRadius) {
      features.push({ type: 'Feature', properties: { kind: 'car' }, geometry: { type: 'Polygon', coordinates: [circle(state.center, state.carRadius)] } });
    }
    map.getSource('range').setData({ type: 'FeatureCollection', features });
  }
})();
