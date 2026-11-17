'use strict';
// Sun: latitude from the sun's bearing + elevation + date, using exact solar geometry.
//
// For latitude φ, declination δ, elevation h and azimuth A (from north, clockwise):
//   sin δ = sin φ · sin h + cos φ · cos h · cos A
// Writing a = sin h, b = cos h · cos A:  a sin φ + b cos φ = sin δ  ⇒  R sin(φ + θ) = sin δ,
// with R = √(a² + b²), θ = atan2(b, a). This has up to two solutions in [−90°, 90°].

(() => {
  const D = Math.PI / 180;
  let started = false, map, bandLayer;
  const st = { az: 180, azTol: 5, h: 40, hTol: 5, hMode: 'deg', obj: 1, shadow: 1.2, dateMode: 'exact', date: new Date().toISOString().slice(0, 10) };

  // Solar declination (Spencer 1971, error < 0.04°), by day of year.
  function declination(doy) {
    const g = 2 * Math.PI / 365 * (doy - 1);
    return (0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g)
      + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g)) / D;
  }
  function dayOfYear(iso) {
    const d = new Date(iso + 'T12:00:00Z');
    return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
  }

  function latitudes(Adeg, hdeg, ddeg) {
    const A = Adeg * D, h = hdeg * D, d = ddeg * D;
    const a = Math.sin(h), b = Math.cos(h) * Math.cos(A);
    const R = Math.hypot(a, b), th = Math.atan2(b, a);
    const s = Math.sin(d) / R;
    if (Math.abs(s) > 1) return [];
    const base = Math.asin(s);
    const out = [];
    for (const x of [base - th, Math.PI - base - th]) {
      // normalise into [−π, π] then keep only valid latitudes
      let p = Math.atan2(Math.sin(x), Math.cos(x));
      if (p >= -Math.PI / 2 - 1e-9 && p <= Math.PI / 2 + 1e-9) out.push(Math.max(-90, Math.min(90, p / D)));
    }
    return out;
  }

  function elevation() {
    return st.hMode === 'deg' ? st.h : Math.atan2(st.obj, st.shadow) / D;
  }

  function declinations() {
    if (st.dateMode === 'unknown') { const r = []; for (let d = -23.44; d <= 23.44 + 1e-9; d += 0.25) r.push(d); return r; }
    const doy = dayOfYear(st.date);
    if (st.dateMode === 'exact') return [declination(doy)];
    const r = []; for (let k = -14; k <= 14; k++) r.push(declination(((doy - 1 + k + 365) % 365) + 1)); return r;
  }

  function compute() {
    const h = elevation();
    const hTol = st.hTol;
    const decls = declinations();
    const BIN = 0.25;
    const bins = new Set();
    const aStep = Math.max(0.25, st.azTol / 12), hStep = Math.max(0.25, hTol / 12);
    for (let A = st.az - st.azTol; A <= st.az + st.azTol + 1e-9; A += aStep) {
      for (let e = Math.max(0.1, h - hTol); e <= Math.min(89.9, h + hTol) + 1e-9; e += hStep) {
        for (const d of decls) for (const p of latitudes(A, e, d)) bins.add(Math.round(p / BIN));
      }
    }
    const sorted = [...bins].sort((x, y) => x - y);
    const bands = [];
    for (const b of sorted) {
      const last = bands[bands.length - 1];
      if (last && b - last[1] <= 1) last[1] = b; else bands.push([b, b]);
    }
    const best = st.dateMode === 'exact' ? latitudes(st.az, h, decls[0]) : [];
    return { h, bands: bands.map(([a, b]) => [a * BIN - BIN / 2, b * BIN + BIN / 2].map(v => Math.max(-90, Math.min(90, v)))), best, decl: decls };
  }

  const fmtLat = v => `${Math.abs(v).toFixed(1)}°${v >= 0 ? 'N' : 'S'}`;

  // ---------- compass ----------

  function drawCompass() {
    const svg = $('#compass');
    let h = '<circle r="100" fill="#fff" stroke="#0a0a0a" stroke-width="1.5"/>';
    for (let a = 0; a < 360; a += 5) {
      const big = a % 45 === 0, r1 = big ? 86 : a % 15 === 0 ? 91 : 95;
      const s = Math.sin(a * D), c = -Math.cos(a * D);
      h += `<line x1="${s * r1}" y1="${c * r1}" x2="${s * 100}" y2="${c * 100}" stroke="#0a0a0a" stroke-width="${big ? 1.5 : 0.75}" opacity="${big ? 1 : .45}"/>`;
    }
    [['N', 0], ['E', 90], ['S', 180], ['W', 270]].forEach(([l, a]) => { h += `<text x="${Math.sin(a * D) * 74}" y="${-Math.cos(a * D) * 74}">${l}</text>`; });
    // tolerance wedge
    const a0 = (st.az - st.azTol) * D, a1 = (st.az + st.azTol) * D, R = 62;
    if (st.azTol > 0) h += `<path d="M0 0 L${Math.sin(a0) * R} ${-Math.cos(a0) * R} A${R} ${R} 0 ${st.azTol * 2 > 180 ? 1 : 0} 1 ${Math.sin(a1) * R} ${-Math.cos(a1) * R} Z" fill="#0a0a0a" opacity=".08"/>`;
    const sx = Math.sin(st.az * D), sy = -Math.cos(st.az * D);
    h += `<line x1="0" y1="0" x2="${sx * 44}" y2="${sy * 44}" stroke="#0a0a0a" stroke-width="1.5"/>`;
    // sun symbol
    h += `<g transform="translate(${sx * 44} ${sy * 44})"><circle r="8" fill="#0a0a0a"/>`;
    for (let k = 0; k < 8; k++) { const t = k * 45 * D; h += `<line x1="${Math.cos(t) * 11}" y1="${Math.sin(t) * 11}" x2="${Math.cos(t) * 15}" y2="${Math.sin(t) * 15}" stroke="#0a0a0a" stroke-width="1.5"/>`; }
    h += '</g><circle r="3" fill="#0a0a0a"/>';
    svg.innerHTML = h;
  }

  function compassPointer(ev) {
    const r = $('#compass').getBoundingClientRect();
    const x = ev.clientX - (r.left + r.width / 2), y = ev.clientY - (r.top + r.height / 2);
    st.az = (Math.round(Math.atan2(x, -y) / D) + 360) % 360;
    $('#az').value = st.az;
    update();
  }

  // ---------- output ----------

  function renderOut(res) {
    const el = $('#sun-out');
    if (!res.bands.length) {
      el.innerHTML = `<p class="help">No latitude on Earth fits these values. Check the sun bearing and height, or widen the ± margins.</p>`;
      return;
    }
    const allN = res.bands.every(([a]) => a >= 0), allS = res.bands.every(([, b]) => b <= 0);
    const hemi = allN ? 'Northern hemisphere' : allS ? 'Southern hemisphere' : 'Either hemisphere';
    const declTxt = res.decl.length === 1 ? `${res.decl[0].toFixed(2)}°` : `${Math.min(...res.decl).toFixed(1)}° … ${Math.max(...res.decl).toFixed(1)}°`;
    el.innerHTML = `
      <div class="eyebrow">${hemi}</div>
      ${res.bands.map(([a, b]) => `<div class="band"><div class="big">${fmtLat(a)} – ${fmtLat(b)}</div><div class="help">band width ${(b - a).toFixed(1)}°, about ${Math.round((b - a) * 111)} km north–south</div></div>`).join('')}
      ${res.best.length ? `<p class="help" style="margin-top:12px">Exact fit for your central values: <b class="mono">${res.best.map(fmtLat).join(' or ')}</b></p>` : ''}
      <table class="kv" style="margin-top:16px">
        <tr><td>Sun elevation used</td><td class="mono">${res.h.toFixed(1)}° ± ${st.hTol}°</td></tr>
        <tr><td>Sun bearing</td><td class="mono">${st.az}° ± ${st.azTol}°</td></tr>
        <tr><td>Solar declination</td><td class="mono">${declTxt}</td></tr>
      </table>
      <p class="help" style="margin-top:14px">The band includes every latitude consistent with your inputs and margins. Time of day doesn't matter: bearing and height fix it together.</p>`;
  }

  function renderMap(res) {
    if (!map) return;
    bandLayer.clearLayers();
    for (const [a, b] of res.bands) {
      L.rectangle([[a, -540], [b, 540]], { color: '#0a0a0a', weight: 1, fillColor: '#0a0a0a', fillOpacity: .18, interactive: false }).addTo(bandLayer);
    }
    for (const r of res.best) L.polyline([[r, -540], [r, 540]], { color: '#0a0a0a', weight: 2, interactive: false }).addTo(bandLayer);
  }

  function update() {
    st.az = ((+$('#az').value % 360) + 360) % 360 || 0;
    st.azTol = Math.max(0, +$('#az-tol').value || 0);
    st.h = Math.min(90, Math.max(0.5, +$('#h').value || 0.5));
    st.hTol = Math.max(0, +$('#h-tol').value || 0);
    st.obj = Math.max(0.01, +$('#obj').value || 1);
    st.shadow = Math.max(0.01, +$('#shadow').value || 1);
    st.date = $('#date').value || st.date;
    const res = compute();
    $('#az-out').textContent = `${st.az}°`;
    $('#h-out').textContent = `${res.h.toFixed(1)}°`;
    drawCompass();
    renderOut(res);
    renderMap(res);
  }

  function seg(id, key, after) {
    document.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => {
      st[key] = b.dataset.m;
      document.querySelectorAll(`#${id} button`).forEach(x => x.classList.toggle('on', x === b));
      if (after) after();
      update();
    });
  }

  function start() {
    if (!started) {
      started = true;
      $('#date').value = st.date;
      ['az', 'az-tol', 'h', 'h-tol', 'obj', 'shadow', 'date'].forEach(id => $('#' + id).addEventListener('input', update));
      seg('h-mode', 'hMode', () => { $('#h-deg').hidden = st.hMode !== 'deg'; $('#h-shadow').hidden = st.hMode === 'deg'; });
      seg('date-mode', 'dateMode', () => { $('#date').hidden = st.dateMode === 'unknown'; });
      const c = $('#compass');
      let drag = false;
      c.addEventListener('pointerdown', e => { drag = true; c.setPointerCapture(e.pointerId); compassPointer(e); });
      c.addEventListener('pointermove', e => { if (drag) compassPointer(e); });
      c.addEventListener('pointerup', () => { drag = false; });
      map = L.map('sunmap', { worldCopyJump: true, minZoom: 1 }).setView([20, 10], 2);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 8, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
      [[0, '6 0'], [23.44, '4 4'], [-23.44, '4 4']].forEach(([lat, dash]) => L.polyline([[lat, -540], [lat, 540]], { color: '#0a0a0a', weight: 1, opacity: .45, dashArray: dash, interactive: false }).addTo(map));
      bandLayer = L.layerGroup().addTo(map);
      update();
    }
    setTimeout(() => map.invalidateSize(), 0);
  }

  (window.viewHooks ||= {}).sun = start;
})();
