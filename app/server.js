// GeoGur server: static frontend + co-occurrence search over OpenStreetMap (Overpass) + Nominatim geocoding.
// Zero dependencies (Node 22).

const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CATALOG, BY_ID, selectorText } = require('./catalog');

const PORTS = (process.env.PORTS || '6665,6670').split(',').map(Number);
const PUBLIC = path.join(__dirname, 'public');
const CACHE_DIR = path.join(__dirname, 'cache');
const UA = 'GeoGur/0.1 (geography learning tool; contact kviappsgames@gmail.com)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const MAX_FEATURES = 5;

const DATA_DIR = path.join(__dirname, 'data');
const CLUES_FILE = path.join(DATA_DIR, 'clues.json');
const TOKEN_FILE = path.join(__dirname, '.admin_token');

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TOKEN_FILE)) fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(12).toString('hex') + '\n', { mode: 0o600 });
const ADMIN_TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();

// ---------- small utils ----------

function hash(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function cacheGet(ns, key) {
  try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, `${ns}-${key}.json`), 'utf8')); } catch { return null; }
}

function cachePut(ns, key, val) {
  fs.writeFileSync(path.join(CACHE_DIR, `${ns}-${key}.json`), JSON.stringify(val));
}

// Serialises calls so we never hit a public service in parallel, with a minimum gap between calls.
function makeQueue(gapMs) {
  let tail = Promise.resolve();
  let last = 0;
  return fn => {
    const run = tail.then(async () => {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      try { return await fn(); } finally { last = Date.now(); }
    });
    tail = run.catch(() => {});
    return run;
  };
}
const nominatimQueue = makeQueue(1100);
const overpassQueue = makeQueue(500);

const R_EARTH = 6371008.8;
function dist(a, b) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

function qlString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function regexEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- Nominatim ----------

async function nominatim(pathAndQuery) {
  const key = hash(pathAndQuery);
  const hit = cacheGet('nom', key);
  if (hit) return hit;
  const data = await nominatimQueue(async () => {
    const res = await fetch('https://nominatim.openstreetmap.org' + pathAndQuery, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return res.json();
  });
  cachePut('nom', key, data);
  return data;
}

async function searchRegion(q) {
  const data = await nominatim(`/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`);
  return data.map(d => ({
    name: d.display_name,
    type: `${d.category}/${d.type}`,
    osm_type: d.osm_type,
    osm_id: Number(d.osm_id),
    // Nominatim bbox order: [south, north, west, east]
    bbox: d.boundingbox.map(Number),
  }));
}

// Simplified outline of a region, for drawing on the map.
async function regionShape(osmType, osmId) {
  const letter = { relation: 'R', way: 'W', node: 'N' }[osmType];
  if (!letter || !Number.isInteger(osmId)) throw new Error('Bad region id');
  const d = await nominatim(`/lookup?format=json&polygon_geojson=1&polygon_threshold=0.005&osm_ids=${letter}${osmId}`);
  return (d[0] && d[0].geojson) || null;
}

async function reverse(lat, lon) {
  const d = await nominatim(`/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
  return { address: d.display_name || null, parts: d.address || null };
}

// ---------- Overpass query building ----------

// Turns a user feature spec into { label, selectors: [ '[k=v][k2=v2]', ... ], rarity }
function resolveFeature(f) {
  const r = resolveFeatureBase(f);
  r.count = Math.max(1, Math.min(10, Math.round(Number(f.count) || 1)));
  if (r.count > 1) r.label = `${r.count}× ${r.label}`;
  return r;
}

function resolveFeatureBase(f) {
  if (f.kind === 'preset') {
    const c = BY_ID[f.id];
    if (!c) throw new Error(`Unknown feature: ${f.id}`);
    const selectors = c.sel.map(filters => filters.map(([k, op, v]) =>
      op ? `[${qlString(k)}${op}${qlString(v)}]` : `[${qlString(k)}]`).join(''));
    return { label: c.label, selectors, rarity: c.rarity };
  }
  if (f.kind === 'brand') {
    const v = String(f.value || '').trim();
    if (!v) throw new Error('Empty brand name');
    const re = qlString(`^${regexEscape(v)}$`);
    return { label: v, selectors: [`["brand"~${re},i]`, `["name"~${re},i]`], rarity: 10 };
  }
  if (f.kind === 'tag') {
    const k = String(f.key || '').trim(), v = String(f.value || '').trim();
    const op = ['=', '~', '!='].includes(f.op) ? f.op : '=';
    if (!k) throw new Error('Empty tag key');
    if (!v) return { label: `${k}=*`, selectors: [`[${qlString(k)}]`], rarity: 20 };
    if (op === '~') { try { new RegExp(v); } catch { throw new Error(`Bad pattern in ${k}~${v}`); } }
    // "k!=v" still needs the key to exist, otherwise it would match every object in the region.
    const sel = op === '!=' ? `[${qlString(k)}][${qlString(k)}!=${qlString(v)}]` : `[${qlString(k)}${op}${qlString(v)}]`;
    return { label: `${k}${op}${v}`, selectors: [sel], rarity: 20 };
  }
  throw new Error('Bad feature kind');
}

// A "chunk" is one Overpass query's worth of area: { label, def, filter, bbox:[s,n,w,e], depth }.
function regionChunk(region) {
  if (region.osm_type === 'relation' || region.osm_type === 'way') {
    const id = (region.osm_type === 'relation' ? 3600000000 : 2400000000) + region.osm_id;
    return { label: region.name.split(',')[0], def: `area(id:${id})->.region;`, filter: '(area.region)', bbox: region.bbox, depth: 0 };
  }
  return { label: region.name.split(',')[0], def: '', filter: '', bbox: region.bbox, depth: 0 };
}

function countryChunk(c) {
  return {
    label: c.name, iso: c.iso,
    def: `(area["ISO3166-1"="${c.iso}"];area["ISO3166-1:alpha2"="${c.iso}"];)->.region;`,
    filter: '(area.region)', bbox: c.bbox || null, depth: 0,
  };
}

// Splits a chunk's bbox into 4 quadrants (used when a query is too heavy for one request).
function splitChunk(ch) {
  const [s, n, w, e] = ch.bbox;
  const mlat = (s + n) / 2, mlon = (w + e) / 2;
  return [[s, mlat, w, mlon], [s, mlat, mlon, e], [mlat, n, w, mlon], [mlat, n, mlon, e]].map((bb, i) => ({
    ...ch, label: `${ch.label} (part ${i + 1}/4)`, bbox: bb, depth: ch.depth + 1, tile: bb,
  }));
}

function chunkFilter(ch) {
  const bb = ch.tile ? `(${ch.tile[0]},${ch.tile[2]},${ch.tile[1]},${ch.tile[3]})` : '';
  if (!ch.filter && !bb) { const [s, n, w, e] = ch.bbox; return `(${s},${w},${n},${e})`; }
  return ch.filter + bb;
}

// Union of a feature's selectors with an extra filter appended, e.g. "(area.region)" or "(around.f0:150)".
function union(feature, extra) {
  return '(' + feature.selectors.map(s => `nwr${s}${extra};`).join('') + ')';
}

// Modest resource declarations: busy Overpass servers reject big declarations first (HTTP 504/429).
function buildQuery(ch, feats, radius) {
  const R = radius;
  const lines = ['[out:json][timeout:100][maxsize:268435456];', ch.def];
  // f0 = anchor (rarest). Everything else only needs to exist near an anchor.
  lines.push(`${union(feats[0], chunkFilter(ch))}->.f0;`);
  // A single feature with a count ("3× bus stop"): every element is an anchor candidate, grouping happens here.
  if (feats.length === 1) {
    lines.push('make sep idx=0; out; .f0 out center tags;');
    return lines.filter(Boolean).join('\n');
  }
  for (let i = 1; i < feats.length; i++) lines.push(`${union(feats[i], `(around.f0:${R})`)}->.f${i};`);
  // Keep only anchors that have every other feature in range.
  let narrow = 'nwr.f0';
  for (let i = 1; i < feats.length; i++) narrow += `(around.f${i}:${R})`;
  lines.push(`${narrow}->.a;`);
  lines.push(`make sep idx=0; out; .a out center tags;`);
  for (let i = 1; i < feats.length; i++) {
    lines.push(`nwr.f${i}(around.a:${R})->.g${i};`);
    lines.push(`make sep idx=${i}; out; .g${i} out center tags;`);
  }
  // "3× bus stop" as the anchor: also fetch the other anchors near each one.
  if (feats[0].count > 1) lines.push(`nwr.f0(around.a:${R})->.g0; make sep idx=${feats.length}; out; .g0 out center tags;`);
  return lines.filter(Boolean).join('\n');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

class OverpassError extends Error {
  constructor(msg, kind) { super(msg); this.kind = kind; } // kind: busy | toobig | fatal
}

// Waits until overpass-api.de reports a free slot for our IP (it allows 2 at a time).
async function waitForSlot(onWait) {
  for (let i = 0; i < 20; i++) {
    let text = '';
    try {
      const res = await fetch('https://overpass-api.de/api/status', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
      text = await res.text();
    } catch { return; }
    const free = text.match(/(\d+) slots? available now/);
    if (free && +free[1] > 0) return;
    const waits = [...text.matchAll(/in (-?\d+) seconds/g)].map(m => +m[1]);
    const w = waits.length ? Math.max(1, Math.min(...waits)) : 5;
    if (onWait) onWait(`Waiting for a free query slot (${w} s)`);
    await sleep((w + 1) * 1000);
  }
}

async function overpassOnce(url, ql) {
  let res, text;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(ql),
      signal: AbortSignal.timeout(130000),
    });
    text = await res.text();
  } catch (e) {
    throw new OverpassError(`${new URL(url).host}: ${e.name === 'TimeoutError' ? 'no answer in 130 s' : e.message}`, 'busy');
  }
  if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) throw new OverpassError(`${new URL(url).host} HTTP ${res.status}`, 'busy');
  if (!res.ok) {
    if (/timeout|out of memory/i.test(text)) throw new OverpassError(`${new URL(url).host}: query too heavy`, 'toobig');
    if (res.status >= 500) throw new OverpassError(`${new URL(url).host} HTTP ${res.status}`, 'busy');
    throw new OverpassError(`${new URL(url).host} HTTP ${res.status}`, 'fatal');
  }
  let json;
  try { json = JSON.parse(text); } catch { throw new OverpassError(`${new URL(url).host}: bad response`, 'busy'); }
  if (json.remark && /timed out|out of memory/i.test(json.remark)) throw new OverpassError(`query too heavy (${json.remark.trim().slice(0, 80)})`, 'toobig');
  if (json.remark && /error/i.test(json.remark)) throw new OverpassError(json.remark.trim(), 'fatal');
  return json;
}

// One query with patience: waits for a slot, backs off on busy servers, falls back to a mirror.
const BACKOFF = [5, 10, 20, 30, 45, 60];
async function runOverpass(ql, onWait) {
  let last;
  for (let attempt = 0; attempt < BACKOFF.length + 1; attempt++) {
    const url = attempt >= 2 && attempt % 2 === 0 ? OVERPASS[OVERPASS.length - 1] : OVERPASS[0];
    try {
      return await overpassQueue(async () => {
        if (url === OVERPASS[0]) await waitForSlot(onWait);
        return overpassOnce(url, ql);
      });
    } catch (e) {
      last = e;
      console.warn('[overpass]', e.message);
      if (e.kind !== 'busy' || attempt === BACKOFF.length) throw e;
      const w = BACKOFF[attempt];
      if (onWait) onWait(`Server busy (${e.message}), retrying in ${w} s`);
      await sleep(w * 1000);
    }
  }
  throw last;
}

// ---------- grouping ----------

function point(el) {
  if (el.lat != null) return { lat: el.lat, lon: el.lon };
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

function slim(el, featureIndex) {
  const p = point(el);
  return { fi: featureIndex, type: el.type, id: el.id, lat: p.lat, lon: p.lon, tags: el.tags || {} };
}

function splitBySeparator(elements, n) {
  const buckets = Array.from({ length: n + 1 }, () => []);
  let cur = -1;
  for (const el of elements) {
    if (el.type === 'sep') { cur = Number(el.tags.idx); continue; }
    if (cur < 0 || !point(el)) continue;
    buckets[cur].push(slim(el, cur));
  }
  return buckets;
}

// Same physical thing mapped twice (e.g. a church as a node and as a building)?
function sameThing(x, y) {
  if (x.type === y.type && x.id === y.id) return true;
  return x.type !== y.type && (x.tags.name || '') === (y.tags.name || '') && dist(x, y) < 30;
}

// For one anchor, choose need[i] distinct elements of each feature i.
// mode 'anchor': all within R of the anchor (nearest first). mode 'mutual': every pair within R.
// lists[i] = candidate elements of feature i (lists[0] = other elements of the anchor's feature).
function pickGroup(anchor, lists, need, R, mode) {
  const slots = [];
  for (let i = 0; i < lists.length; i++) {
    const k = i === 0 ? need[0] - 1 : need[i];
    if (k <= 0) continue;
    const near = lists[i]
      .filter(e => !sameThing(e, anchor))
      .map(e => ({ e, d: dist(anchor, e) }))
      .filter(x => x.d <= R)
      .sort((a, b) => a.d - b.d)
      .slice(0, 16)
      .map(x => x.e);
    if (near.length < k) return null;
    for (let j = 0; j < k; j++) slots.push({ list: near, feature: i, first: j === 0 });
  }
  const chosen = [anchor];
  const idx = [];
  let budget = 20000;
  const step = si => {
    if (si === slots.length) return true;
    if (--budget < 0) return false;
    const slot = slots[si];
    // Within one feature, pick in increasing order to avoid trying permutations.
    const start = slot.first ? 0 : idx[si - 1] + 1;
    for (let j = start; j < slot.list.length; j++) {
      const c = slot.list[j];
      if (chosen.some(x => sameThing(x, c))) continue;
      if (mode === 'mutual' && !chosen.every(x => dist(x, c) <= R)) continue;
      chosen.push(c); idx[si] = j;
      if (step(si + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return step(0) ? chosen : null;
}

function buildGroups(buckets, R, mode, need) {
  const n = need.length;
  // Collapse duplicate anchors (e.g. a shop mapped as both a node and a building) within 30 m.
  const anchors = [];
  for (const a of buckets[0]) {
    if (anchors.some(b => dist(a, b) < 30 && (a.tags.name || '') === (b.tags.name || ''))) continue;
    anchors.push(a);
  }
  const lists = [need[0] > 1 ? [...buckets[n], ...buckets[0]] : [], ...buckets.slice(1, n)];
  const groups = [];
  const used = new Set(); // with "3× X" as anchor, each X would otherwise start its own copy of the same group
  for (const a of anchors) {
    if (used.has(`${a.type}/${a.id}`)) continue;
    const members = pickGroup(a, lists, need, R, mode);
    if (!members) continue;
    if (need[0] > 1) for (const m of members) used.add(`${m.type}/${m.id}`);
    const lat = members.reduce((s, m) => s + m.lat, 0) / members.length;
    const lon = members.reduce((s, m) => s + m.lon, 0) / members.length;
    let spread = 0;
    for (let i = 0; i < members.length; i++)
      for (let j = i + 1; j < members.length; j++) spread = Math.max(spread, dist(members[i], members[j]));
    groups.push({
      center: { lat, lon },
      spread: Math.round(spread),
      members: members.map(m => ({ ...m, d: Math.round(dist(m, { lat, lon })) })),
    });
  }
  groups.sort((a, b) => a.spread - b.spread);
  return groups;
}

// ---------- country sets (continent / world mode) ----------

const COUNTRIES = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data', 'countries.json'), 'utf8')).countries;
const SOUTH_AMERICA = new Set(['CO', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'BR', 'FK']);
const SETS = {
  world: { name: 'Whole world', test: () => true },
  europe: { name: 'Europe', test: c => c.region === 'Europe' },
  asia: { name: 'Asia', test: c => c.region === 'Asia' },
  africa: { name: 'Africa', test: c => c.region === 'Africa' },
  north_america: { name: 'North & Central America', test: c => c.region === 'Americas' && !SOUTH_AMERICA.has(c.iso) },
  south_america: { name: 'South America', test: c => SOUTH_AMERICA.has(c.iso) },
  oceania: { name: 'Oceania', test: c => c.region === 'Oceania' },
};

// Bounding boxes of the coverage countries (needed to split big countries into tiles). Resolved once per country, then cached.
const BBOX_FILE = path.join(DATA_DIR, 'country-bbox.json');
let countryBbox = null;
async function loadCountryBboxes() {
  if (countryBbox) return countryBbox;
  let known = {};
  try { known = JSON.parse(fs.readFileSync(BBOX_FILE, 'utf8')); } catch { /* build below */ }
  const missing = COUNTRIES.filter(c => !known[c.iso]);
  if (!missing.length) { countryBbox = known; return known; }
  let ql = '[out:json][timeout:120];';
  for (const c of missing) ql += `(area["ISO3166-1"="${c.iso}"];area["ISO3166-1:alpha2"="${c.iso}"];);out ids;make sep iso="${c.iso}";out;`;
  const json = await runOverpass(ql);
  const rels = {}; let cur = [];
  for (const e of json.elements) {
    if (e.type === 'sep') { rels[e.tags.iso] = cur.filter(id => id > 3600000000).map(id => id - 3600000000); cur = []; } else cur.push(e.id);
  }
  const all = Object.entries(rels).flatMap(([iso, ids]) => ids.map(id => [iso, id]));
  const out = { ...known };
  for (let i = 0; i < all.length; i += 40) {
    const batch = all.slice(i, i + 40);
    const d = await nominatim(`/lookup?format=json&osm_ids=${batch.map(([, id]) => 'R' + id).join(',')}`);
    for (const r of d) {
      const hit = batch.find(([, id]) => id === Number(r.osm_id));
      if (!hit) continue;
      const [s, n, w, e] = r.boundingbox.map(Number);
      const prev = out[hit[0]];
      out[hit[0]] = prev ? [Math.min(prev[0], s), Math.max(prev[1], n), Math.min(prev[2], w), Math.max(prev[3], e)] : [s, n, w, e];
    }
  }
  fs.writeFileSync(BBOX_FILE, JSON.stringify(out));
  countryBbox = out;
  return out;
}

// ---------- search jobs ----------

const jobs = new Map();
const MAX_GROUPS = 5000;

function validate(body) {
  const region = body.region;
  if (!region) throw new Error('Pick a region first');
  if (region.kind === 'set') { if (!SETS[region.id]) throw new Error('Unknown region set'); }
  else if (!Array.isArray(region.bbox) || region.bbox.length !== 4) throw new Error('Pick a region first');
  const radius = Math.max(10, Math.min(1000, Math.round(Number(body.radius) || 150)));
  const mode = body.mode === 'mutual' ? 'mutual' : 'anchor';
  if (!Array.isArray(body.features) || !body.features.length) throw new Error('Add at least two features');
  if (body.features.length > MAX_FEATURES) throw new Error(`At most ${MAX_FEATURES} features`);
  const resolved = body.features.map((f, i) => ({ ...resolveFeature(f), orig: i }));
  if (resolved.length === 1 && resolved[0].count < 2) throw new Error('Add at least two features (or one feature with a count of 2 or more)');
  // Rarest first: it becomes the anchor and keeps each Overpass query small.
  const ordered = [...resolved].sort((a, b) => a.rarity - b.rarity);
  return { region, radius, mode, resolved, ordered };
}

async function planChunks(region) {
  if (region.kind !== 'set') return [regionChunk(region)];
  const bb = await loadCountryBboxes().catch(() => ({}));
  return COUNTRIES.filter(SETS[region.id].test).map(c => countryChunk({ ...c, bbox: bb[c.iso] }));
}

// Runs one chunk (with caching); splits it into tiles if Overpass says it's too heavy.
async function runChunk(job, ch) {
  const key = hash({ v: 3, def: ch.def, f: chunkFilter(ch), feats: job.ordered.map(f => f.selectors), r: job.radius, ac: job.ordered[0].count > 1 });
  const hit = cacheGet('ovp', key);
  if (hit) return [hit];
  const ql = buildQuery(ch, job.ordered, job.radius);
  if (!job.ql) job.ql = ql;
  try {
    const json = await runOverpass(ql, note => { job.note = note; });
    job.note = '';
    const raw = { elements: json.elements, osm_base: json.osm3s && json.osm3s.timestamp_osm_base };
    cachePut('ovp', key, raw);
    return [raw];
  } catch (e) {
    if (e.kind === 'toobig' && ch.bbox && ch.depth < 4 && !job.cancelled) {
      job.note = `${ch.label} is large, splitting it into 4 parts`;
      const parts = [];
      for (const sub of splitChunk(ch)) {
        if (job.cancelled) break;
        job.current = sub.label;
        parts.push(...await runChunk(job, sub));
      }
      return parts;
    }
    throw e;
  }
}

function addRaw(job, raw) {
  const n = job.ordered.length;
  const buckets = splitBySeparator(raw.elements, n);
  // Re-index members so fi refers to the user's original feature order (the extra bucket n is the anchor feature).
  buckets.forEach((b, bi) => { for (const e of b) e.fi = job.ordered[bi === n ? 0 : bi].orig; });
  job.anchorsMatched += buckets[0].length;
  for (const g of buildGroups(buckets, job.radius, job.mode, job.ordered.map(f => f.count))) {
    const k = g.members.map(m => `${m.type}/${m.id}`).sort().join(',');
    if (job.seen.has(k) || job.groups.length >= MAX_GROUPS) continue;
    job.seen.add(k);
    job.groups.push(g);
  }
  if (raw.osm_base && (!job.osm_base || raw.osm_base > job.osm_base)) job.osm_base = raw.osm_base;
}

async function runJob(job) {
  try {
    job.chunks = await planChunks(job.region);
    job.total = job.chunks.length;
    for (const ch of job.chunks) {
      // Nobody is polling any more (tab closed): stop instead of working through the rest of a continent.
      if (Date.now() - job.polledAt > 120000) job.cancelled = true;
      if (job.cancelled) break;
      job.current = ch.label;
      try {
        for (const raw of await runChunk(job, ch)) addRaw(job, raw);
      } catch (e) {
        if (e.kind === 'fatal') throw e;
        job.failed.push({ label: ch.label, error: e.message });
      }
      job.done++;
    }
    job.groups.sort((a, b) => a.spread - b.spread);
    job.status = job.cancelled ? 'cancelled' : job.failed.length && job.failed.length === job.total ? 'error' : 'done';
    if (job.status === 'error') job.error = job.total === 1
      ? `OpenStreetMap's query server couldn't run this search (${job.failed[0].error}). Try again in a minute.`
      : 'Every part of this search failed. The OpenStreetMap servers are probably overloaded; try again in a minute.';
  } catch (e) {
    job.status = 'error';
    job.error = e.message;
  }
  job.current = '';
  job.note = '';
  job.finishedAt = Date.now();
  console.log(`[search] ${job.regionName} | ${job.resolved.map(f => f.label).join(' + ')} | r=${job.radius} ${job.mode} -> ${job.groups.length} groups, ${job.done}/${job.total} parts, ${job.failed.length} failed, ${job.status} ${Date.now() - job.startedAt}ms`);
}

function startSearch(body) {
  const v = validate(body);
  const id = crypto.randomBytes(8).toString('hex');
  const job = {
    id, ...v, regionName: v.region.kind === 'set' ? SETS[v.region.id].name : v.region.name,
    status: 'running', total: 0, done: 0, current: 'Preparing', note: '', failed: [],
    groups: [], seen: new Set(), anchorsMatched: 0, osm_base: null, ql: '', cancelled: false, startedAt: Date.now(), polledAt: Date.now(),
  };
  jobs.set(id, job);
  runJob(job);
  return {
    job: id,
    features: v.resolved.map(f => ({ label: f.label })),
    anchor: v.ordered[0].orig,
    radius: v.radius, mode: v.mode, region: job.regionName,
  };
}

function jobStatus(job, since) {
  job.polledAt = Date.now();
  return {
    status: job.status, error: job.error || null,
    total: job.total, done: job.done, current: job.current, note: job.note,
    failed: job.failed, count: job.groups.length, truncated: job.groups.length >= MAX_GROUPS,
    // While running, stream only new groups; once finished, send the full sorted list.
    groups: job.status === 'running' ? job.groups.slice(since) : job.groups,
    final: job.status !== 'running',
    elapsed: (job.finishedAt || Date.now()) - job.startedAt,
    osm_base: job.osm_base, ql: job.ql,
  };
}

// Drop finished jobs after 30 minutes.
setInterval(() => {
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > 30 * 60000) jobs.delete(id);
}, 60000).unref();

// ---------- clue entries (visual clues: bollards, poles, bus stops, …) ----------

function loadClues() {
  try { return JSON.parse(fs.readFileSync(CLUES_FILE, 'utf8')); } catch { return []; }
}

function saveClues(list) {
  const tmp = CLUES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, CLUES_FILE);
}

function cleanClue(c) {
  const str = (v, max = 400) => String(v ?? '').trim().slice(0, max);
  const num = (v, lo, hi) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n * 10) / 10 : undefined; };
  const out = {
    id: str(c.id, 64) || crypto.randomBytes(6).toString('hex'),
    category: str(c.category, 40).toLowerCase(),
    title: str(c.title, 120),
    attributes: {},
    countries: [...new Set((Array.isArray(c.countries) ? c.countries : []).map(x => str(x, 2).toUpperCase()).filter(x => /^[A-Z]{2}$/.test(x)))],
    strength: ['unique', 'strong', 'common'].includes(c.strength) ? c.strength : 'common',
    note: str(c.note, 2000),
    examples: (Array.isArray(c.examples) ? c.examples : []).slice(0, 10)
      .map(e => {
        const x = { lat: Number(e.lat), lon: Number(e.lon), heading: num(e.heading, 0, 360), pitch: num(e.pitch, -90, 90) };
        if (/^[\w-]{10,64}$/.test(e.pano || '')) x.pano = e.pano;
        return JSON.parse(JSON.stringify(x));
      })
      .filter(e => Number.isFinite(e.lat) && Number.isFinite(e.lon) && Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180),
    verified: /^\d{4}-\d{2}-\d{2}$/.test(c.verified) ? c.verified : null,
    source: str(c.source, 80) || 'editor',
  };
  for (const [k, v] of Object.entries(c.attributes || {})) {
    const key = str(k, 40).toLowerCase(), val = str(v, 60);
    if (key && val) out.attributes[key] = val;
  }
  if (!out.category || !out.title || !out.countries.length) throw new Error('Category, title and at least one country are required');
  return out;
}

function isAdmin(req) {
  const t = req.headers['x-admin-token'] || '';
  return t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN));
}

// ---------- HTTP ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

// Gzips text bodies when the browser accepts it (the clue library is ~1 MB of JSON).
function sendBody(req, res, code, type, body, cache) {
  const headers = { 'Content-Type': type, 'Cache-Control': cache, 'Vary': 'Accept-Encoding' };
  if (body.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    body = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
  }
  res.writeHead(code, headers);
  res.end(body);
}

function send(res, code, obj) {
  sendBody(res.req || { headers: {} }, res, code, 'application/json; charset=utf-8', Buffer.from(JSON.stringify(obj)), 'no-store');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e5) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('Bad JSON')); } });
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/catalog') return send(res, 200, CATALOG.map(c => ({ id: c.id, label: c.label, group: c.group, tags: selectorText(c), aka: c.aka || '' })));
    if (url.pathname === '/api/region') {
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return send(res, 400, { error: 'Empty query' });
      return send(res, 200, await searchRegion(q));
    }
    if (url.pathname === '/api/region/shape') {
      return send(res, 200, { geojson: await regionShape(url.searchParams.get('osm_type'), Number(url.searchParams.get('osm_id'))) });
    }
    if (url.pathname === '/api/clues' && req.method === 'GET') {
      return sendBody(req, res, 200, 'application/json; charset=utf-8', fs.readFileSync(CLUES_FILE), 'no-cache');
    }
    if (url.pathname === '/api/admin/check') return send(res, isAdmin(req) ? 200 : 401, { ok: isAdmin(req) });
    if (url.pathname === '/api/clues' && (req.method === 'POST' || req.method === 'DELETE')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'Wrong admin key' });
      const list = loadClues();
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        saveClues(list.filter(c => c.id !== id));
        return send(res, 200, { ok: true });
      }
      const clue = cleanClue(await readBody(req));
      const i = list.findIndex(c => c.id === clue.id);
      if (i >= 0) list[i] = clue; else list.push(clue);
      saveClues(list);
      return send(res, 200, clue);
    }
    if (url.pathname === '/api/reverse') {
      const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return send(res, 400, { error: 'Bad coordinates' });
      return send(res, 200, await reverse(lat, lon));
    }
    if (url.pathname === '/api/search' && req.method === 'POST') return send(res, 200, startSearch(await readBody(req)));
    if (url.pathname === '/api/sets') return send(res, 200, Object.entries(SETS).map(([id, x]) => ({ id, name: x.name, count: COUNTRIES.filter(x.test).length })));
    const jm = url.pathname.match(/^\/api\/job\/([0-9a-f]{16})$/);
    if (jm) {
      const job = jobs.get(jm[1]);
      if (!job) return send(res, 404, { error: 'Search expired. Run it again.' });
      if (req.method === 'DELETE') { job.cancelled = true; return send(res, 200, { ok: true }); }
      return send(res, 200, jobStatus(job, Math.max(0, Number(url.searchParams.get('since')) || 0)));
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });

    // Static files; unknown paths fall back to the SPA shell.
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'Forbidden' });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    sendBody(req, res, 200, MIME[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file), 'no-cache');
  } catch (e) {
    console.error('[error]', url.pathname, e.message);
    send(res, 500, { error: e.message });
  }
}

for (const p of PORTS) {
  const s = http.createServer(handle);
  s.requestTimeout = 300000;
  s.listen(p, '0.0.0.0', () => console.log(`GeoGur listening on :${p}`));
}
