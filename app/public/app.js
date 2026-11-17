'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toFixed(6);
const gmaps = (lat, lon) => `https://www.google.com/maps/search/?api=1&query=${fmt(lat)},${fmt(lon)}`;
const osmUrl = m => `https://www.openstreetmap.org/${m.type}/${m.id}`;

const TEST_QUERY = {
  region: { name: 'Czechia', type: 'boundary/administrative', osm_type: 'relation', osm_id: 51684, bbox: [48.5518081, 51.0557008, 12.0905752, 18.8592531] },
  features: [{ kind: 'brand', value: 'Lidl' }, { kind: 'preset', id: 'bus_stop' }, { kind: 'preset', id: 'church' }],
  radius: 150,
  mode: 'mutual',
};

// Ready-made example searches. Regions are looked up by name (Nominatim) when clicked, except continent sets.
const P = id => ({ kind: 'preset', id });
const B = value => ({ kind: 'brand', value });
const PRESETS = [
  { title: 'Lidl + bus stop + church', region: 'Czechia', features: [B('Lidl'), P('bus_stop'), P('church')], radius: 150 },
  { title: 'Windmill + church', region: 'Netherlands', features: [P('windmill'), P('church')], radius: 250 },
  { title: 'Mosque + Orthodox church', region: 'Bosnia and Herzegovina', features: [P('mosque'), P('church_orthodox')], radius: 150 },
  { title: 'Shinto shrine + Buddhist temple + level crossing', region: 'Kyoto Prefecture', features: [P('shrine_shinto'), P('temple_buddhist'), P('level_crossing')], radius: 200 },
  { title: 'Lighthouse + church', region: 'Denmark', features: [P('lighthouse'), P('church')], radius: 400 },
  { title: 'Water tower + church + level crossing', region: 'Belgium', features: [P('water_tower'), P('church'), P('level_crossing')], radius: 300 },
  { title: 'Wayside cross + bus stop + fire station', region: 'Slovakia', features: [P('wayside_cross'), P('bus_stop'), P('fire_station')], radius: 150 },
  { title: 'McDonald\'s + roundabout + fuel station', region: 'Poland', features: [B('McDonald\'s'), P('roundabout'), P('fuel')], radius: 150 },
  { title: 'Toll booth + fuel station', region: 'Chile', features: [P('toll_booth'), P('fuel')], radius: 300 },
  { title: 'Castle + vineyard + church', region: 'Rhineland-Palatinate', features: [P('castle'), P('vineyard'), P('church')], radius: 400 },
  { title: 'Tram stop + mosque', region: 'Turkey', features: [P('tram_stop'), P('mosque')], radius: 150 },
  { title: 'Wind turbine + church + level crossing', region: 'Denmark', features: [P('wind_turbine'), P('church'), P('level_crossing')], radius: 500 },
  { title: '7-Eleven + Shinto shrine', region: 'Tokyo', features: [B('7-Eleven'), P('shrine_shinto')], radius: 100 },
  { title: 'Synagogue + church + mosque', region: 'Europe', set: 'europe', features: [P('synagogue'), P('church'), P('mosque')], radius: 300 },
  { title: '3× bus stop with shelter + roundabout', region: 'Ireland', features: [{ ...P('bus_shelter'), count: 3 }, P('roundabout')], radius: 200 },
  { title: 'Cattle grid + church', region: 'Wales', features: [P('cattle_grid'), P('church')], radius: 300 },
];

const state = {
  region: null,
  features: [],
  radius: 150,
  mode: 'mutual',
  result: null,
  selected: -1,
  shown: 200,
};
let catalog = [];
const addrCache = new Map();

// ---------------- routing ----------------

function route() {
  const [, view = 'outline', qs = ''] = location.hash.match(/^#\/(\w+)\??(.*)$/) || [];
  const v = ['search', 'clues', 'sun', 'outline'].includes(view) ? view : 'outline';
  document.querySelectorAll('.view').forEach(el => { el.hidden = el.id !== `view-${v}`; });
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.view === v));
  if (window.viewHooks && window.viewHooks[v]) window.viewHooks[v](qs);
  if (v === 'search') {
    initMap();
    setTimeout(() => map.invalidateSize(), 0);
    const params = new URLSearchParams(qs);
    const q = params.get('q'), sel = params.get('sel');
    if (q) {
      try {
        const parsed = JSON.parse(decodeURIComponent(escape(atob(q))));
        if (JSON.stringify(parsed) !== JSON.stringify(currentQuery())) {
          loadQuery(parsed);
          runSearch().then(() => { if (sel != null && state.result && state.result.groups[+sel]) select(+sel); });
        }
      } catch { /* ignore broken links */ }
    }
  }
}
window.addEventListener('hashchange', route);

function currentQuery() {
  return { region: state.region, features: state.features, radius: state.radius, mode: state.mode };
}

function queryHash(q, sel) {
  return '#/search?q=' + encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(q))))) + (sel != null ? `&sel=${sel}` : '');
}

// Copies, so later edits (± counts) don't change a history entry or a preset.
function loadQuery(q) {
  q = JSON.parse(JSON.stringify(q));
  state.region = q.region; state.features = q.features || []; state.radius = q.radius || 150; state.mode = q.mode || 'mutual';
  renderBuilder();
}

// ---------------- builder ----------------

function featureBaseLabel(f) {
  if (f.kind === 'preset') return (catalog.find(c => c.id === f.id) || {}).label || f.id;
  if (f.kind === 'brand') return f.value;
  return f.value ? `${f.key}${f.op || '='}${f.value}` : `${f.key}=*`;
}
function featureTags(f) {
  if (f.kind === 'preset') return (catalog.find(c => c.id === f.id) || {}).tags || '';
  if (f.kind === 'brand') return `brand or name = “${f.value}” (case-insensitive)`;
  return featureBaseLabel(f);
}
function featureLabel(f) {
  return (f.count || 1) > 1 ? `${f.count}× ${featureBaseLabel(f)}` : featureBaseLabel(f);
}
function featureKind(f) {
  return f.kind === 'preset' ? 'preset' : f.kind === 'brand' ? 'brand / name' : 'OSM tag';
}

function renderBuilder() {
  const rp = $('#region-picked');
  if (state.region) {
    rp.hidden = false;
    rp.innerHTML = `<span class="nm" title="${esc(state.region.name)}">${esc(state.region.name)}</span><button class="x" title="Change region">×</button>`;
    rp.querySelector('.x').onclick = () => { state.region = null; renderBuilder(); $('#region-input').focus(); };
    $('#region-form').hidden = true;
  } else {
    rp.hidden = true;
    $('#region-form').hidden = false;
  }
  $('#feature-list').innerHTML = state.features.map((f, i) =>
    `<li><span class="n">${i + 1}</span><span class="nm" title="${esc(featureTags(f))}">${esc(featureBaseLabel(f))}<span class="k">${featureKind(f)}</span></span>
      <span class="cnt" title="How many of these must be in range"><button data-dec="${i}" ${(f.count || 1) <= 1 ? 'disabled' : ''}>−</button><b>${f.count || 1}×</b><button data-inc="${i}" ${(f.count || 1) >= 10 ? 'disabled' : ''}>+</button></span>
      <button class="x" data-i="${i}" title="Remove">×</button></li>`).join('');
  $('#feature-list').querySelectorAll('.x').forEach(b => b.onclick = () => { state.features.splice(+b.dataset.i, 1); renderBuilder(); });
  $('#feature-list').querySelectorAll('[data-inc]').forEach(b => b.onclick = () => { const f = state.features[+b.dataset.inc]; f.count = Math.min(10, (f.count || 1) + 1); renderBuilder(); });
  $('#feature-list').querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { const f = state.features[+b.dataset.dec]; f.count = Math.max(1, (f.count || 1) - 1); renderBuilder(); });
  document.querySelectorAll('#set-chips .opt').forEach(b => b.classList.toggle('on', !!state.region && (b.dataset.set === 'view' ? state.region.kind === 'bbox' : state.region.kind === 'set' && state.region.id === b.dataset.set)));
  $('#feature-input').disabled = state.features.length >= 5;
  $('#feature-input').placeholder = state.features.length >= 5 ? 'Maximum 5 features' : 'Add: bus stop, church, Lidl, man_made=water_tower…';
  $('#radius').value = state.radius;
  $('#radius-out').textContent = `${state.radius} m`;
  document.querySelectorAll('#view-search .seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
  drawRegion();
}

// Region lookup (explicit search on submit; Nominatim forbids type-ahead).
$('#region-form').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#region-input').value.trim();
  if (!q) return;
  const ul = $('#region-results');
  ul.hidden = false;
  ul.innerHTML = '<li class="t">Searching…</li>';
  try {
    const list = await api(`/api/region?q=${encodeURIComponent(q)}`);
    if (!list.length) { ul.innerHTML = '<li class="t">Nothing found. Try the English or local name, or zoom the map there and use “Visible map area”.</li>'; return; }
    ul.innerHTML = list.map((r, i) => `<li data-i="${i}"><div>${esc(r.name)}</div><div class="t">${esc(r.type)} · ${r.osm_type}/${r.osm_id}</div></li>`).join('');
    ul.querySelectorAll('li').forEach(li => li.onclick = () => {
      state.region = list[+li.dataset.i];
      ul.hidden = true; $('#region-input').value = '';
      renderBuilder();
    });
  } catch (err) { ul.innerHTML = `<li class="t">${esc(err.message)}</li>`; }
});

// Feature combobox
let sugg = [], act = 0;
function suggestions(text) {
  const t = text.trim().toLowerCase();
  const out = [];
  if (!t) return catalog.map(c => ({ f: { kind: 'preset', id: c.id }, label: c.label, g: c.group, tags: c.tags }));
  // Raw OSM tags: key=value, key=* (any value), key~regex, key!=value.
  const tag = text.match(/^\s*([\w:.-]+)\s*(!=|=|~)\s*(.*?)\s*$/);
  if (tag) {
    const [, key, op, value] = tag;
    const any = !value || value === '*';
    out.push({ f: { kind: 'tag', key, op: any ? '=' : op, value: any ? '' : value }, label: any ? `${key}=*` : `${key}${op}${value}`, g: 'OSM tag', tags: op === '~' ? 'regular expression on the value' : op === '!=' ? 'key present, value different' : '' });
  }
  const words = t.split(/\s+/);
  const scored = [];
  for (const c of catalog) {
    const hay = `${c.label} ${c.id.replace(/_/g, ' ')} ${c.aka || ''} ${c.tags}`.toLowerCase();
    if (!words.every(w => hay.includes(w))) continue;
    scored.push([c.label.toLowerCase().startsWith(t) ? 0 : c.label.toLowerCase().includes(t) ? 1 : 2, c]);
  }
  scored.sort((a, b) => a[0] - b[0]);
  for (const [, c] of scored) out.push({ f: { kind: 'preset', id: c.id }, label: c.label, g: c.group, tags: c.tags });
  if (!tag) out.push({ f: { kind: 'brand', value: text.trim() }, label: `“${text.trim()}”`, g: 'Brand / name (exact)', tags: 'matches the brand or name tag' });
  return out;
}
function renderSuggest() {
  const ul = $('#feature-suggest');
  if (!sugg.length) { ul.hidden = true; return; }
  ul.hidden = false;
  ul.innerHTML = sugg.map((s, i) => `<li data-i="${i}" class="${i === act ? 'act' : ''}"><span class="sl"><span>${esc(s.label)}</span>${s.tags ? `<span class="tg">${esc(s.tags)}</span>` : ''}</span><span class="g">${esc(s.g)}</span></li>`).join('');
  ul.querySelectorAll('li').forEach(li => li.onmousedown = e => { e.preventDefault(); pick(+li.dataset.i); });
  const a = ul.querySelector('.act'); if (a) a.scrollIntoView({ block: 'nearest' });
}
function pick(i) {
  const s = sugg[i]; if (!s) return;
  state.features.push(s.f);
  $('#feature-input').value = '';
  sugg = []; renderSuggest(); renderBuilder();
  if (state.features.length < 5) $('#feature-input').focus();
}
const fi = $('#feature-input');
fi.addEventListener('input', () => { sugg = suggestions(fi.value); act = 0; renderSuggest(); });
fi.addEventListener('focus', () => { sugg = suggestions(fi.value); act = 0; renderSuggest(); });
fi.addEventListener('blur', () => { sugg = []; renderSuggest(); });
fi.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { act = Math.min(act + 1, sugg.length - 1); renderSuggest(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { act = Math.max(act - 1, 0); renderSuggest(); e.preventDefault(); }
  else if (e.key === 'Enter') { pick(act); e.preventDefault(); }
  else if (e.key === 'Escape') { fi.blur(); }
});

$('#radius').addEventListener('input', e => { state.radius = +e.target.value; $('#radius-out').textContent = `${state.radius} m`; });
document.querySelectorAll('#view-search .seg button').forEach(b => b.onclick = () => { state.mode = b.dataset.mode; renderBuilder(); });

// ---------------- search ----------------

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const SET_BBOX = {
  world: [-56, 75, -170, 180], europe: [34, 71.5, -25, 45], asia: [-11, 55.5, 25, 146], africa: [-35, 37.5, -18, 52],
  north_america: [7, 72, -170, -52], south_america: [-56, 13, -82, -34], oceania: [-47.5, 21, 105, 180],
};
const groupKey = g => g.members.map(m => `${m.type}/${m.id}`).sort().join(',');
const addrKey = g => `${g.center.lat.toFixed(6)},${g.center.lon.toFixed(6)}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtTime = ms => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

let searchSeq = 0;
let currentJob = null;
async function runSearch() {
  const st = $('#status');
  if (!state.region) { st.hidden = false; st.className = 'status err'; st.textContent = 'Pick a region first.'; return; }
  if (state.region.kind === 'bbox') {
    const [s, n, w, e] = state.region.bbox;
    if (n - s > 12 || e - w > 12) { st.hidden = false; st.className = 'status err'; st.textContent = 'The map area is too large. Zoom in and pick “Visible map area” again, or pick a country or continent.'; return; }
  }
  if (state.features.length < 2 && !state.features.some(f => (f.count || 1) > 1)) {
    st.hidden = false; st.className = 'status err'; st.textContent = 'Add at least two features (or one feature with a count of 2+).'; return;
  }
  const seq = ++searchSeq;
  if (currentJob) fetch(`/api/job/${currentJob}`, { method: 'DELETE' }).catch(() => {});
  currentJob = null;
  const q = currentQuery();
  history.replaceState(null, '', queryHash(q));
  const btn = $('#search-btn');
  btn.disabled = true;
  st.hidden = true;
  closeDetail();
  if (allLayer) allLayer.clearLayers();
  state.result = null; state.selected = -1; state.shown = 200;
  startScan(q);
  const t0 = Date.now();
  try {
    const meta = await api('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
    if (seq !== searchSeq) return;
    currentJob = meta.job;
    const r = state.result = { ...meta, groups: [], status: 'running', total: 0, done: 0, failed: [] };
    let first = true;
    for (;;) {
      await sleep(first ? 250 : 1200);
      first = false;
      if (seq !== searchSeq) return;
      const j = await api(`/api/job/${meta.job}?since=${r.groups.length}`);
      if (seq !== searchSeq) return;
      Object.assign(r, { status: j.status, total: j.total, done: j.done, current: j.current, note: j.note, failed: j.failed, osm_base: j.osm_base, ql: j.ql, elapsed: j.elapsed, truncated: j.truncated, error: j.error });
      if (j.final) {
        const selKey = state.selected >= 0 && r.groups[state.selected] ? groupKey(r.groups[state.selected]) : null;
        r.groups = j.groups;
        state.selected = selKey ? r.groups.findIndex(g => groupKey(g) === selKey) : -1;
        break;
      }
      if (j.groups.length) { const from = r.groups.length; r.groups.push(...j.groups); addDots(from); }
      updateScan(r);
      renderResults();
    }
    // Cached answers come back instantly; keep the scan visible briefly so the change of state reads.
    const wait = 700 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (seq !== searchSeq) return;
    stopScan();
    currentJob = null;
    if (r.status === 'error' && !r.groups.length) throw new Error(r.error || 'Search failed');
    renderResults(); drawAll(true);
    if (state.selected >= 0) select(state.selected);
    saveHistory(q, r.groups.length);
    reverseQueue = r.groups.slice(0, 25);
    pumpReverse(seq);
  } catch (err) {
    if (seq !== searchSeq) return;
    stopScan();
    st.hidden = false;
    st.className = 'status err'; st.textContent = err.message;
    renderResults();
  } finally {
    if (seq === searchSeq) btn.disabled = false;
  }
}

// ---------------- scanning animation ----------------

let scanTimer = null, scanT0 = 0;
function startScan(q) {
  initMap();
  const [s, n, w, e] = q.region.bbox;
  map.fitBounds([[s, w], [n, e]], { animate: false, padding: [30, 30] });
  $('#scan-title').textContent = `Scanning ${q.region.name.split(',')[0]}`;
  $('#scan-feats').innerHTML = q.features.map((f, i) => `<span style="animation-delay:${i * 0.35}s">${esc(featureLabel(f))}</span>`).join('<em>+</em>');
  $('#scan-prog').hidden = true;
  $('#scan-note').textContent = '';
  $('#scan').hidden = false;
  document.body.classList.add('scanning');
  placeRadar();
  map.on('move zoom resize', placeRadar);
  scanT0 = Date.now();
  const tick = () => {
    const txt = fmtTime(Date.now() - scanT0);
    $('#scan-time').textContent = txt;
    $('#search-btn').textContent = `Searching… ${txt}`;
  };
  tick();
  clearInterval(scanTimer);
  scanTimer = setInterval(tick, 500);
  // Skeleton rows in the results list.
  $('#results').innerHTML = `<div class="results-head"><div class="big">Searching…</div><div class="meta">${esc(q.features.map(featureLabel).join(' + '))} · ≤${q.radius} m</div></div>` +
    '<ul class="rlist skel">' + Array.from({ length: 7 }, (_, i) => `<li style="animation-delay:${i * 0.08}s"><span class="i"></span><span class="bar w1"></span><span class="bar w3"></span><span class="bar w2"></span></li>`).join('') + '</ul>';
}

function updateScan(r) {
  if (r.total > 1) {
    $('#scan-prog').hidden = false;
    $('#scan-bar').style.width = `${(r.done / r.total) * 100}%`;
    $('#scan-count').textContent = `${r.done} / ${r.total} countries`;
  }
  $('#scan-title').textContent = r.current ? `Scanning ${r.current}` : `Scanning ${r.region.split(',')[0]}`;
  $('#scan-note').textContent = r.note || (r.groups.length ? `${r.groups.length} place${r.groups.length === 1 ? '' : 's'} found so far` : '');
}

function stopScan() {
  clearInterval(scanTimer);
  $('#scan').hidden = true;
  document.body.classList.remove('scanning');
  $('#search-btn').textContent = 'Search';
  if (map) map.off('move zoom resize', placeRadar);
}

function placeRadar() {
  if (!state.region) return;
  const [s, n, w, e] = state.region.bbox;
  const p1 = map.latLngToContainerPoint([n, w]), p2 = map.latLngToContainerPoint([s, e]);
  const c = map.latLngToContainerPoint([(s + n) / 2, (w + e) / 2]);
  const size = map.getSize();
  const d = Math.max(160, Math.min(Math.hypot(p2.x - p1.x, p2.y - p1.y), Math.min(size.x, size.y) * 0.9));
  const r = $('#radar');
  r.style.width = r.style.height = `${d}px`;
  r.style.left = `${c.x - d / 2}px`;
  r.style.top = `${c.y - d / 2}px`;
}

$('#scan-cancel').onclick = () => {
  if (currentJob) fetch(`/api/job/${currentJob}`, { method: 'DELETE' }).catch(() => {});
  $('#scan-note').textContent = 'Stopping after the current part…';
};

// ---------------- region outline ----------------

const shapeCache = new Map();
let regionLayer = null, drawnRegionKey = null;
async function drawRegion() {
  if (!map) return;
  const reg = state.region;
  const key = reg ? (reg.kind === 'set' ? `set/${reg.id}` : reg.kind === 'bbox' ? `bbox/${reg.bbox.join(',')}` : `${reg.osm_type}/${reg.osm_id}`) : null;
  if (key === drawnRegionKey) return;
  drawnRegionKey = key;
  if (regionLayer) { regionLayer.remove(); regionLayer = null; }
  if (!reg) return;
  if (reg.kind === 'set') {
    if (!state.result) { const [s, n, w, e] = reg.bbox; map.fitBounds([[s, w], [n, e]]); }
    return;
  }
  let gj = reg.kind === 'bbox' ? null : shapeCache.get(key);
  if (gj === undefined) {
    try { gj = (await api(`/api/region/shape?osm_type=${reg.osm_type}&osm_id=${reg.osm_id}`)).geojson; } catch { gj = null; }
    shapeCache.set(key, gj);
  }
  if (drawnRegionKey !== key) return;
  const [s, n, w, e] = reg.bbox;
  const geom = gj && /Polygon/.test(gj.type) ? gj : { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] };
  regionLayer = L.geoJSON(geom, { interactive: false, style: { color: '#0a0a0a', weight: 1.5, opacity: .75, dashArray: '6 6', fill: true, fillColor: '#0a0a0a', fillOpacity: .025, className: 'region-line' } }).addTo(map);
  regionLayer.bringToBack();
  if (!state.result && reg.kind !== 'bbox') map.fitBounds(regionLayer.getBounds(), { padding: [30, 30] });
}

$('#search-btn').onclick = runSearch;

// ---------------- history (this browser only) ----------------

const HIST_KEY = 'geogur.history';
function loadHistory() { try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch { return []; } }
function saveHistory(q, count) {
  const key = JSON.stringify(q);
  const list = loadHistory().filter(h => JSON.stringify(h.q) !== key);
  list.unshift({ q, count, at: Date.now() });
  try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 20))); } catch { /* optional */ }
  renderHistory();
}
function renderHistory() {
  const list = loadHistory();
  const box = $('#history');
  if (!list.length) { box.hidden = true; return; }
  box.hidden = false;
  $('#history-list').innerHTML = list.map((h, i) => `<li data-i="${i}">
      <span class="hq">${esc(h.q.features.map(featureLabel).join(' + '))}</span>
      <span class="hm">${esc(h.q.region.name.split(',')[0])} · ≤${h.q.radius} m · ${h.count} place${h.count === 1 ? '' : 's'}</span>
    </li>`).join('');
  $('#history-list').querySelectorAll('li').forEach(li => li.onclick = () => { loadQuery(list[+li.dataset.i].q); runSearch(); });
}
$('#history-clear').onclick = e => { e.preventDefault(); try { localStorage.removeItem(HIST_KEY); } catch { /* optional */ } renderHistory(); };

function shortAddress(a) {
  if (!a || !a.parts) return null;
  const p = a.parts;
  const street = [p.road || p.pedestrian || p.square || p.hamlet, p.house_number].filter(Boolean).join(' ');
  const place = p.city || p.town || p.village || p.municipality || p.suburb || p.county;
  return [street, place, p.country].filter(Boolean).join(', ');
}

let renderPending = false;
function renderResults() {
  const r = state.result, box = $('#results');
  if (!r) { box.innerHTML = ''; return; }
  const running = r.status === 'running';
  const n = r.groups.length;
  const failed = r.failed && r.failed.length ? `<div class="warn">${r.failed.length} part${r.failed.length === 1 ? '' : 's'} couldn't be searched (server busy): ${esc(r.failed.map(f => f.label).join(', '))}. <button class="linkbtn" id="retry">Retry</button> (finished parts are cached)</div>` : '';
  const head = `<div class="results-head">
      <div class="big">${running ? 'Searching… ' : ''}${n.toLocaleString()} place${n === 1 ? '' : 's'}${running ? ' so far' : ''}${r.truncated ? ' (first 5,000)' : ''}</div>
      <div class="meta">${esc(r.features.map(f => f.label).join(' + '))} · ≤${r.radius} m · ${r.mode === 'mutual' ? 'mutual' : 'anchor: ' + esc(r.features[r.anchor].label)}</div>
      <div class="meta">${esc(r.region.split(',')[0])}${r.total > 1 ? ` · ${r.done}/${r.total} countries` : ''}${r.elapsed != null ? ' · ' + fmtTime(r.elapsed) : ''}${r.osm_base ? ' · OSM ' + esc(r.osm_base.replace('T', ' ').replace('Z', ' UTC')) : ''}${r.status === 'cancelled' ? ' · stopped early' : ''}</div>
      ${!running && n ? `<div class="exp"><button class="linkbtn" id="exp-csv">CSV</button><button class="linkbtn" id="exp-geo">GeoJSON</button><button class="linkbtn" id="exp-link">Copy link</button></div>` : ''}
      ${failed}
    </div>`;
  if (!n) {
    box.innerHTML = head + (running ? '' : `<div class="empty">No place in this region has all of these within ${r.radius} m. Try a larger range or fewer features.</div>`) + qlBlock(r);
  } else {
    const items = r.groups.slice(0, state.shown).map((g, i) => {
      const a = addrCache.get(addrKey(g));
      const names = g.members.map(m => m.tags.name).filter(Boolean).slice(0, 3).join(' · ');
      return `<li data-i="${i}" class="${i === state.selected ? 'on' : ''}">
        <span class="i">${i + 1}</span>
        <span class="addr">${esc(shortAddress(a) || `${fmt(g.center.lat)}, ${fmt(g.center.lon)}`)}</span>
        <span class="sp">${g.spread} m</span>
        <span class="sub">${esc(names || '—')}</span>
      </li>`;
    }).join('');
    const more = n > state.shown ? `<div class="more"><button class="btn ghost sm" id="more">Show more (${n - state.shown} left)</button></div>` : '';
    box.innerHTML = head + `<ul class="rlist">${items}</ul>` + more + qlBlock(r);
    box.querySelectorAll('.rlist li').forEach(li => li.onclick = () => select(+li.dataset.i));
    const m = $('#more'); if (m) m.onclick = () => { state.shown += 200; renderResults(); };
  }
  const rt = $('#retry'); if (rt) rt.onclick = runSearch;
  const ec = $('#exp-csv'); if (ec) ec.onclick = () => download('geogur.csv', 'text/csv', toCsv(r));
  const eg = $('#exp-geo'); if (eg) eg.onclick = () => download('geogur.geojson', 'application/geo+json', JSON.stringify(toGeoJson(r), null, 1));
  const el = $('#exp-link'); if (el) el.onclick = e => {
    navigator.clipboard.writeText(location.href).then(() => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy link'; }, 1200); });
  };
}

// ---------------- export ----------------

function download(name, type, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toCsv(r) {
  const q = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const rows = [['rank', 'center_lat', 'center_lon', 'spread_m', 'address', 'feature', 'name', 'osm', 'lat', 'lon', 'google_maps']];
  r.groups.forEach((g, i) => {
    const a = addrCache.get(addrKey(g));
    for (const m of [...g.members].sort((x, y) => x.fi - y.fi)) {
      rows.push([i + 1, fmt(g.center.lat), fmt(g.center.lon), g.spread, a ? a.address : '', r.features[m.fi].label, m.tags.name || m.tags.brand || '', `${m.type}/${m.id}`, fmt(m.lat), fmt(m.lon), gmaps(m.lat, m.lon)]);
    }
  });
  return rows.map(row => row.map(q).join(',')).join('\n') + '\n';
}

function toGeoJson(r) {
  return {
    type: 'FeatureCollection',
    features: r.groups.map((g, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+fmt(g.center.lon), +fmt(g.center.lat)] },
      properties: {
        rank: i + 1, spread_m: g.spread, google_maps: gmaps(g.center.lat, g.center.lon),
        members: g.members.map(m => ({ feature: r.features[m.fi].label, name: m.tags.name || null, osm: `${m.type}/${m.id}`, lat: +fmt(m.lat), lon: +fmt(m.lon) })),
      },
    })),
  };
}

function qlBlock(r) {
  return r.ql ? `<details class="ql"><summary>Overpass query used${r.total > 1 ? ' (first part)' : ''}</summary><pre>${esc(r.ql)}</pre></details>` : '';
}

// ---------------- reverse geocoding (throttled server-side; we just go one by one) ----------------

let reverseQueue = [];
async function pumpReverse(seq) {
  while (reverseQueue.length && seq === searchSeq) {
    const g = reverseQueue.shift();
    if (addrCache.has(addrKey(g))) continue;
    await loadAddress(g, seq);
  }
}
async function loadAddress(g, seq = searchSeq) {
  if (!g) return;
  const k = addrKey(g);
  if (addrCache.has(k)) return addrCache.get(k);
  try {
    const a = await api(`/api/reverse?lat=${g.center.lat}&lon=${g.center.lon}`);
    addrCache.set(k, a);
    if (seq !== searchSeq || !state.result) return a;
    const i = state.result.groups.indexOf(g);
    const li = document.querySelector(`.rlist li[data-i="${i}"] .addr`);
    if (li) li.textContent = shortAddress(a) || li.textContent;
    if (state.selected === i) renderDetail();
    return a;
  } catch { /* address is optional */ }
}

// ---------------- map ----------------

let map, allLayer, selLayer;
function initMap() {
  if (map) return;
  map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([50, 15], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  allLayer = L.layerGroup().addTo(map);
  selLayer = L.layerGroup().addTo(map);
  drawRegion();
}

function dotFor(g, i, delay) {
  const m = L.circleMarker([g.center.lat, g.center.lon], { radius: 5, color: '#fff', weight: 1.5, fillColor: '#0a0a0a', fillOpacity: 1, className: 'dot' })
    .on('click', () => select(state.result.groups.indexOf(g))).addTo(allLayer);
  if (m._path && delay) m._path.style.animationDelay = `${Math.round(delay)}ms`;
}

// New groups arriving while a search is still running.
function addDots(from) {
  const gs = state.result.groups;
  for (let i = from; i < gs.length; i++) dotFor(gs[i], i, Math.min(i - from, 30) * 25);
}

function drawAll(fit) {
  allLayer.clearLayers(); selLayer.clearLayers();
  const gs = state.result.groups;
  const step = Math.min(40, 1200 / Math.max(1, gs.length));
  gs.forEach((g, i) => dotFor(g, i, i < 300 ? i * step : 0));
  if (!fit) return;
  if (gs.length) map.fitBounds(L.latLngBounds(gs.map(g => [g.center.lat, g.center.lon])).pad(0.1), { maxZoom: 16, animate: false });
  else if (state.region) { const [s, n, w, e] = state.region.bbox; map.fitBounds([[s, w], [n, e]]); }
}

function select(i) {
  if (!state.result || !state.result.groups[i]) return;
  state.selected = i;
  history.replaceState(null, '', queryHash(currentQuery(), i));
  document.querySelectorAll('.rlist li').forEach(li => li.classList.toggle('on', +li.dataset.i === i));
  const li = document.querySelector(`.rlist li[data-i="${i}"]`); if (li) li.scrollIntoView({ block: 'nearest' });
  const g = state.result.groups[i];
  selLayer.clearLayers();
  L.circle([g.center.lat, g.center.lon], { radius: state.result.radius / 2, color: '#0a0a0a', weight: 1, dashArray: '4 4', fill: false, interactive: false }).addTo(selLayer);
  g.members.forEach(m => {
    L.polyline([[g.center.lat, g.center.lon], [m.lat, m.lon]], { color: '#0a0a0a', weight: 1, opacity: .5, interactive: false }).addTo(selLayer);
  });
  L.marker([g.center.lat, g.center.lon], { icon: L.divIcon({ className: '', html: '<div class="pin c"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }), interactive: false }).addTo(selLayer);
  g.members.forEach(m => {
    L.marker([m.lat, m.lon], { icon: L.divIcon({ className: '', html: `<div class="pin">${m.fi + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }), title: m.tags.name || '' }).addTo(selLayer);
  });
  const wide = window.innerWidth > 860;
  map.fitBounds(L.latLngBounds(g.members.map(m => [m.lat, m.lon])).pad(0.3), {
    maxZoom: 18,
    paddingTopLeft: [40, 40],
    paddingBottomRight: wide ? [460, 40] : [40, Math.round(window.innerHeight * 0.4)],
  });
  renderDetail();
  loadAddress(g);
}

function closeDetail() { $('#detail').hidden = true; if (selLayer) selLayer.clearLayers(); }

function renderDetail() {
  const r = state.result, i = state.selected, g = r && r.groups[i];
  if (!g) return;
  const a = addrCache.get(addrKey(g));
  const c = `${fmt(g.center.lat)}, ${fmt(g.center.lon)}`;
  const members = [...g.members].sort((x, y) => x.fi - y.fi);
  const mem = members.map(m => {
    const tags = Object.entries(m.tags).map(([k, v]) => `${k}=${v}`).join('\n');
    const addrTag = [m.tags['addr:street'], m.tags['addr:housenumber'], m.tags['addr:city']].filter(Boolean).join(' ');
    return `<div class="mem">
      <div class="pin">${m.fi + 1}</div>
      <div>
        <div class="f">${esc(r.features[m.fi].label)}</div>
        <div class="nm">${esc(m.tags.name || m.tags.brand || '(unnamed)')}</div>
        ${addrTag ? `<div class="f">${esc(addrTag)}</div>` : ''}
        <div class="c">${fmt(m.lat)}, ${fmt(m.lon)} · ${m.d} m from centre</div>
        <div class="ln"><a href="${gmaps(m.lat, m.lon)}" target="_blank" rel="noopener">Google Maps ↗</a><a href="${osmUrl(m)}" target="_blank" rel="noopener">OSM ${m.type}/${m.id} ↗</a></div>
        <details><summary>All tags (${Object.keys(m.tags).length})</summary><pre class="tags">${esc(tags)}</pre></details>
      </div>
    </div>`;
  }).join('');

  // pairwise distance matrix
  const d = (p, q) => {
    const R = 6371008.8, t = x => x * Math.PI / 180;
    const h = Math.sin(t(q.lat - p.lat) / 2) ** 2 + Math.cos(t(p.lat)) * Math.cos(t(q.lat)) * Math.sin(t(q.lon - p.lon) / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  };
  const mx = `<table class="mx"><tr><th></th>${members.map(m => `<th>${m.fi + 1}</th>`).join('')}</tr>` +
    members.map(p => `<tr><th>${p.fi + 1}</th>${members.map(q => `<td>${p === q ? '·' : d(p, q)}</td>`).join('')}</tr>`).join('') + '</table>';

  const el = $('#detail');
  el.hidden = false;
  el.innerHTML = `
    <div class="d-head">
      <div class="d-top">
        <div class="d-title">${esc(a ? a.address : 'Looking up address…')}</div>
        <button class="x" id="d-close" title="Close">×</button>
      </div>
      <div class="d-coord"><span>${c}</span><button class="copy" id="d-copy">copy</button></div>
      <div class="d-actions">
        <a class="btn primary" href="${gmaps(g.center.lat, g.center.lon)}" target="_blank" rel="noopener">Open in Google Maps ↗</a>
        <span class="btn ghost" style="cursor:default">#${i + 1} · spread ${g.spread} m</span>
      </div>
    </div>
    <div class="d-sec"><h4>Features</h4>${mem}</div>
    <div class="d-sec"><h4>Distances (m)</h4>${mx}</div>`;
  $('#d-close').onclick = () => { closeDetail(); state.selected = -1; history.replaceState(null, '', queryHash(currentQuery())); document.querySelectorAll('.rlist li.on').forEach(li => li.classList.remove('on')); };
  $('#d-copy').onclick = e => { navigator.clipboard.writeText(c).then(() => { e.target.textContent = 'copied'; setTimeout(() => e.target.textContent = 'copy', 1200); }); };
}

$('#run-test').onclick = e => { e.preventDefault(); location.hash = queryHash(TEST_QUERY); };

// ---------------- boot ----------------

async function initSets() {
  let sets = [];
  try { sets = await api('/api/sets'); } catch { return; }
  $('#set-chips').innerHTML = sets.map(x => `<button type="button" class="opt" data-set="${x.id}">${esc(x.name)}<span class="c">${x.count}</span></button>`).join('') +
    `<button type="button" class="opt" data-set="view" title="Search exactly the area you see on the map">Visible map area</button>`;
  $('#set-chips').querySelectorAll('.opt').forEach(b => b.onclick = () => {
    if (b.dataset.set === 'view') {
      initMap();
      const bb = map.getBounds();
      const r6 = v => Math.round(v * 1e6) / 1e6;
      const box = [r6(bb.getSouth()), r6(bb.getNorth()), r6(Math.max(-180, bb.getWest())), r6(Math.min(180, bb.getEast()))];
      state.region = { kind: 'bbox', name: `Map area ${box[0].toFixed(3)} ${box[2].toFixed(3)} → ${box[1].toFixed(3)} ${box[3].toFixed(3)}`, bbox: box };
    } else {
      const x = sets.find(y => y.id === b.dataset.set);
      state.region = { kind: 'set', id: x.id, name: x.name, bbox: SET_BBOX[x.id] };
    }
    $('#region-results').hidden = true;
    renderBuilder();
  });
}

// ---------------- example searches ----------------

function renderPresets() {
  $('#preset-list').innerHTML = PRESETS.map((p, i) => `<li data-i="${i}"><span class="hq">${esc(p.title)}</span><span class="hm">${esc(p.region)} · ≤${p.radius} m</span></li>`).join('');
  $('#preset-list').querySelectorAll('li').forEach(li => li.onclick = async () => {
    const p = PRESETS[+li.dataset.i];
    const st = $('#status');
    let region;
    if (p.set) region = { kind: 'set', id: p.set, name: p.region, bbox: SET_BBOX[p.set] };
    else {
      st.hidden = false; st.className = 'status'; st.innerHTML = `<span class="spin"></span> Looking up ${esc(p.region)}…`;
      try {
        const list = await api(`/api/region?q=${encodeURIComponent(p.region)}`);
        region = list.find(x => x.osm_type === 'relation') || list[0];
        if (!region) throw new Error(`${p.region} not found`);
      } catch (err) { st.className = 'status err'; st.textContent = err.message; return; }
      st.hidden = true;
    }
    loadQuery({ region, features: p.features, radius: p.radius, mode: 'mutual' });
    runSearch();
  });
}

(async () => {
  try { catalog = await api('/api/catalog'); } catch { catalog = []; }
  await initSets();
  renderPresets();
  renderHistory();
  renderBuilder();
  route();
})();
