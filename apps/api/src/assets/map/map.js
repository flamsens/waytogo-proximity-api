// Playground map for the shared-mobility proximity API (vanilla JS, no build step).
(() => {
  'use strict';

  // ---- Config ---------------------------------------------------------------
  const COLORS = { car: '#cf222e', bicycle: '#1a7f37', cargo_bicycle: '#9a6700', scooter: '#8250df' };
  const OTHER_COLOR = '#59636e';
  const BELGIUM = { center: [4.47, 50.5], zoom: 7 };
  const $ = (id) => document.getElementById(id);
  /** Escapes text from the API before it goes into HTML (defence in depth against odd upstream data). */
  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const label = (ff) => esc(ff.replace(/_/g, ' '));

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

  /**
   * Heatmap radius is in screen pixels; convert metres to pixels for every zoom level.
   * Metres per pixel (512 px tiles) = 78271.517 · cos(lat) / 2^zoom; Belgium ≈ 50.8° N.
   */
  function metersToPixelsExpression(meters) {
    const atZoom0 = meters / (78271.517 * Math.cos((50.8 * Math.PI) / 180));
    return ['interpolate', ['exponential', 2], ['zoom'], 0, atZoom0, 22, atZoom0 * 2 ** 22];
  }

  map.on('load', async () => {
    map.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Empty layer used only to keep the heatmap below the points and the search circle.
    map.addLayer({ id: 'points-anchor', type: 'background', paint: { 'background-opacity': 0 } });
    // Proximity heatmap: every vehicle spreads over the selected radius *in metres* (not pixels),
    // all vehicles weigh the same and vehicle types share one colour scale. A shaded spot is
    // within ~radius of shared mobility; darker means more vehicles within reach.
    map.addLayer({
      id: 'heat', type: 'heatmap', source: 'points', layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': 1,
        // Low intensity: one vehicle within reach = light green, many = dark green.
        'heatmap-intensity': 0.12,
        'heatmap-radius': metersToPixelsExpression(state.radius),
        'heatmap-opacity': 0.75,
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(0,0,0,0)',
          0.02, 'rgba(199,233,192,0.6)',
          0.3, '#74c476',
          0.6, '#31a354',
          1, '#006d2c',
        ],
      },
    }, 'points-anchor');
    map.addLayer({
      id: 'points', type: 'circle', source: 'points',
      paint: {
        'circle-color': colorExpression,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 1.5, 15, 5],
        'circle-opacity': 0.8,
      },
    });
    map.addSource('range', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Search circle: tinted fill, white casing under a thick outline so it stands out on any background.
    map.addLayer({ id: 'range-fill', type: 'fill', source: 'range', filter: ['==', ['get', 'kind'], 'all'], paint: { 'fill-color': '#0969da', 'fill-opacity': 0.15 } });
    map.addLayer({ id: 'range-casing', type: 'line', source: 'range', paint: { 'line-color': '#ffffff', 'line-width': 7 } });
    map.addLayer({ id: 'range-line', type: 'line', source: 'range', filter: ['==', ['get', 'kind'], 'all'], paint: { 'line-color': '#0550ae', 'line-width': 3.5 } });
    map.addLayer({ id: 'range-car-line', type: 'line', source: 'range', filter: ['==', ['get', 'kind'], 'car'], paint: {
      'line-color': COLORS.car, 'line-width': 3.5, 'line-dasharray': [2, 1.5],
    } });

    await loadPoints();
    applyFilter();
  });

  // Click on a dot: show what's there. Click anywhere else: search around that point.
  map.on('click', (e) => {
    const box = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
    const hits = map.getLayoutProperty('points', 'visibility') === 'none' ? [] : map.queryRenderedFeatures(box, { layers: ['points'] });
    if (hits.length > 0) {
      showPointPopup(hits);
      return;
    }
    setCenter([e.lngLat.lng, e.lngLat.lat]);
  });
  map.on('mouseenter', 'points', () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', 'points', () => (map.getCanvas().style.cursor = ''));

  /** Popup listing the vehicles under the cursor (dots at one station can overlap). */
  function showPointPopup(features) {
    const totals = {};
    for (const f of features) totals[f.properties.formFactor] = (totals[f.properties.formFactor] || 0) + f.properties.count;
    const lines = Object.entries(totals)
      .map(([ff, n]) => `<div><span class="swatch" style="background:${COLORS[ff] || OTHER_COLOR}"></span>${esc(n)} × ${label(ff)}</div>`)
      .join('');
    new maplibregl.Popup({ closeButton: true })
      .setLngLat(features[0].geometry.coordinates)
      .setHTML(`${lines}<button type="button" class="popup-search">Search around here</button>`)
      .addTo(map)
      .getElement()
      .querySelector('.popup-search')
      .addEventListener('click', () => setCenter(features[0].geometry.coordinates));
  }

  function setCenter(lngLat) {
    state.center = lngLat;
    update();
  }

  // ---- Address lookup (OpenStreetMap Nominatim) -----------------------------
  // Searches only on submit, as Nominatim's usage policy allows max 1 request/second.
  $('addressForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('address').value.trim();
    if (!q) return;
    const list = $('addressResults');
    list.innerHTML = '<li class="hint">Searching…</li>';
    try {
      const params = new URLSearchParams({ q, format: 'jsonv2', countrycodes: 'be', limit: '5' });
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'Accept-Language': 'nl,fr,en' } });
      const results = res.ok ? await res.json() : [];
      list.innerHTML = results.length ? '' : '<li class="hint">No address found in Belgium.</li>';
      for (const r of results) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = r.display_name;
        button.addEventListener('click', () => {
          const lngLat = [Number(r.lon), Number(r.lat)];
          map.flyTo({ center: lngLat, zoom: 15 });
          setCenter(lngLat);
          list.innerHTML = '';
          $('address').value = r.display_name;
        });
        li.append(button);
        list.append(li);
      }
    } catch {
      list.innerHTML = '<li class="error">Address lookup failed, try again.</li>';
    }
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
    $('snapshotCaption').textContent =
      `Heatmap: shaded areas are within the selected radius of available shared mobility; darker = more vehicles within reach. ` +
      `Snapshot of ${when}, not an average: free-floating vehicles move during the day.`;
  }

  // ---- Controls -------------------------------------------------------------
  function renderFormFactorToggles(features) {
    const totals = {};
    for (const f of features) totals[f.properties.formFactor] = (totals[f.properties.formFactor] || 0) + f.properties.count;
    $('formFactors').innerHTML = '';
    for (const ff of Object.keys(totals).sort()) {
      const label = document.createElement('label');
      label.innerHTML = `<input type="checkbox" ${state.enabled.has(ff) ? 'checked' : ''}/> <span class="swatch" style="background:${COLORS[ff] || OTHER_COLOR}"></span>${label(ff)} (${esc(totals[ff])})`;
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
      // The proximity heatmap follows the general radius.
      if (key === 'radius' && map.getLayer('heat')) map.setPaintProperty('heat', 'heatmap-radius', metersToPixelsExpression(value));
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
      $('result').innerHTML = `<p class="error">${esc([].concat(body.message).join(', '))}</p>`;
      return;
    }
    const rows = Object.entries(body.byFormFactor)
      .map(([ff, n]) => `<tr><td><span class="swatch" style="background:${COLORS[ff] || OTHER_COLOR}"></span>${label(ff)}</td><td>${esc(n)}</td></tr>`)
      .join('');
    $('result').innerHTML = `<table>${rows}<tr class="total"><td>Total</td><td>${esc(body.total)}</td></tr></table>`;
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

  let centerMarker = null;
  function drawRange() {
    centerMarker ??= new maplibregl.Marker({ color: '#0550ae' });
    centerMarker.setLngLat(state.center).addTo(map);
    const features = [{ type: 'Feature', properties: { kind: 'all' }, geometry: { type: 'Polygon', coordinates: [circle(state.center, state.radius)] } }];
    if (state.useCarRadius) {
      features.push({ type: 'Feature', properties: { kind: 'car' }, geometry: { type: 'Polygon', coordinates: [circle(state.center, state.carRadius)] } });
    }
    map.getSource('range').setData({ type: 'FeatureCollection', features });
  }
})();
