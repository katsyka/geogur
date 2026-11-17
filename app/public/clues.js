'use strict';
// Clues: reverse lookup "what I see" -> candidate countries, plus a browsable library of visual clues.

(() => {
  const CATEGORIES = {
    bollard: 'Bollards', pole: 'Utility poles', bus_stop: 'Bus stops', tram_stop: 'Tram stops', stop_sign: 'Stop signs',
    pedestrian: 'Pedestrian crossing signs', chevron: 'Chevrons', rail_crossing: 'Railway crossings', traffic_light: 'Traffic lights',
    plate: 'Licence plates', street_name: 'Street name signs', house_number: 'House numbers', post_box: 'Post boxes',
    road_line: 'Road lines', sign: 'Other signs', other: 'Other',
  };
  const flag = iso => String.fromCodePoint(...[...iso].map(ch => 127397 + ch.charCodeAt(0)));
  const ADMIN_KEY = 'geogur.admin';
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* optional */ } };
  const PAGE = 120;
  const TOP_VALUES = 10;

  let data = null;      // { countries, facts }
  let entries = [];     // visual clue entries from the server
  let byIso = {};       // iso -> country
  let idx = {};         // cat -> { all: [], iso: { XX: [] }, keys: { key: [[value, count], ...] } }
  let started = false;
  const sel = { drive: null, scripts: new Set(), letters: new Set(), facts: new Set(), attrs: {}, q: '' };
  const ui = { mode: 'countries', open: new Set(), expanded: new Set(), browseCat: null, shown: PAGE, country: null };

  // ---------- links ----------

  function streetView(p) {
    if (p.pano) return `https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(p.pano)}${p.heading != null ? `&heading=${p.heading}` : ''}${p.pitch != null ? `&pitch=${p.pitch}` : ''}`;
    return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat.toFixed(7)},${p.lon.toFixed(7)}${p.heading != null ? `&heading=${p.heading}` : ''}`;
  }
  const mapLink = p => `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;

  // ---------- index ----------

  function buildIndex() {
    idx = {};
    for (const e of entries) {
      const c = (idx[e.category] ||= { all: [], iso: {}, keys: {} });
      c.all.push(e);
      for (const iso of e.countries) (c.iso[iso] ||= []).push(e);
    }
    for (const c of Object.values(idx)) {
      const counts = {};
      for (const e of c.all) for (const [k, v] of Object.entries(e.attributes)) ((counts[k] ||= {})[v] = (counts[k][v] || 0) + 1);
      for (const [k, m] of Object.entries(counts)) c.keys[k] = Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }
  }
  const catOrder = () => Object.keys(CATEGORIES).filter(c => idx[c]).concat(Object.keys(idx).filter(c => !CATEGORIES[c]));

  // ---------- filtering ----------

  function parseQuery(q) {
    q = q.trim().toLowerCase();
    if (!q) return null;
    if (/^\.[a-z]{2,3}$/.test(q)) return { tld: q };
    const ph = q.replace(/[\s()-]/g, '');
    if (/^\+?\d{1,6}$/.test(ph)) return { phone: ph.startsWith('+') ? ph : '+' + ph };
    return { text: q };
  }

  function phoneMatch(c, ph) {
    const code = c.phone; // e.g. "+420"
    if (!code) return false;
    if (ph.length <= code.length) return code.startsWith(ph);
    if (!ph.startsWith(code)) return false;
    // NANP (+1): the next 3 digits are the area code.
    if (code === '+1' && c.nanp) {
      const rest = ph.slice(2, 5);
      if (c.nanp === 'many') return !Object.values(byIso).some(o => o.phone === '+1' && o.nanp !== 'many' && o.nanp.split(', ').some(a => rest.length === 3 && a === rest));
      return c.nanp.split(', ').some(a => a.startsWith(rest));
    }
    return true;
  }

  const entryMatches = (e, attrs) => Object.entries(attrs).every(([k, v]) => e.attributes[k] === v);
  const entryText = e => `${e.title} ${e.note} ${Object.values(e.attributes).join(' ')} ${CATEGORIES[e.category] || e.category}`.toLowerCase();

  function passes(c, s) {
    if (s.drive && c.drive !== s.drive) return false;
    for (const x of s.scripts) if (!c.scripts.includes(x)) return false;
    for (const x of s.letters) if (!c.letters.includes(x)) return false;
    for (const x of s.facts) if (!c.facts.includes(x)) return false;
    for (const [cat, attrs] of Object.entries(s.attrs)) {
      if (!Object.keys(attrs).length) continue;
      const list = idx[cat] && idx[cat].iso[c.iso];
      if (!list || !list.some(e => entryMatches(e, attrs))) return false;
    }
    const pq = parseQuery(s.q);
    if (pq) {
      if (pq.tld && c.tld !== pq.tld) return false;
      if (pq.phone && !phoneMatch(c, pq.phone)) return false;
      if (pq.text) {
        const t = pq.text;
        const hit = c.name.toLowerCase().includes(t) || c.iso.toLowerCase() === t ||
          Object.values(idx).some(ci => (ci.iso[c.iso] || []).some(e => entryText(e).includes(t)));
        if (!hit) return false;
      }
    }
    return true;
  }

  function cloneSel() {
    return { ...sel, scripts: new Set(sel.scripts), letters: new Set(sel.letters), facts: new Set(sel.facts), attrs: JSON.parse(JSON.stringify(sel.attrs)) };
  }
  // How many countries would remain if `mod` were applied to the current selection.
  function countWith(mod) {
    const s = cloneSel();
    mod(s);
    let n = 0;
    for (const c of data.countries) if (passes(c, s)) n++;
    return n;
  }

  // Entries shown in the clue browser: their country passes every filter, and they match their own category's attributes.
  function matchingEntries(cat) {
    const pq = parseQuery(sel.q);
    const ok = new Set(data.countries.filter(c => passes(c, { ...sel, q: pq && pq.text ? '' : sel.q })).map(c => c.iso));
    const attrs = sel.attrs[cat] || {};
    return (idx[cat] ? idx[cat].all : []).filter(e => e.countries.some(i => ok.has(i)) && entryMatches(e, attrs) &&
      (!pq || !pq.text || entryText(e).includes(pq.text) || e.countries.some(i => byIso[i] && byIso[i].name.toLowerCase().includes(pq.text))));
  }

  const activeAttrCount = () => Object.values(sel.attrs).reduce((n, a) => n + Object.keys(a).length, 0);

  // ---------- facets ----------

  function opt(label, on, count, attrs, title) {
    return `<button class="opt${on ? ' on' : ''}${!on && count === 0 ? ' dead' : ''}" ${attrs}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}${on ? '' : `<span class="c">${count}</span>`}</button>`;
  }

  function renderFacets() {
    const C = data.countries;
    let h = '';

    h += `<div class="fgroup"><h3>Driving side</h3><div class="opts">` +
      [['L', 'Left'], ['R', 'Right']].map(([v, l]) => opt(l, sel.drive === v, countWith(s => { s.drive = v; }), `data-drive="${v}"`)).join('') + `</div></div>`;

    const scripts = [...new Set(C.flatMap(c => c.scripts))].sort((a, b) => a === 'Latin' ? -1 : b === 'Latin' ? 1 : a.localeCompare(b));
    h += `<div class="fgroup"><h3>Alphabet <span class="hint">all selected</span></h3><div class="opts">` +
      scripts.map(x => opt(x, sel.scripts.has(x), countWith(s => s.scripts.add(x)), `data-script="${esc(x)}"`)).join('') + `</div></div>`;

    const letters = [...new Set(C.flatMap(c => [...c.letters]))];
    const isCyr = ch => /[Ѐ-ӿ]/.test(ch);
    const groups = [['Latin', letters.filter(l => !isCyr(l)).sort((a, b) => a.localeCompare(b))], ['Cyrillic', letters.filter(isCyr).sort((a, b) => a.localeCompare(b))]];
    h += `<div class="fgroup"><h3>Special letters <span class="hint">seen on signs</span></h3>` +
      groups.map(([g, ls]) => `<div class="subh">${g}</div><div class="keys">` + ls.map(l => {
        const on = sel.letters.has(l), n = on ? 1 : countWith(s => s.letters.add(l));
        return `<button class="key${on ? ' on' : ''}${!on && n === 0 ? ' dead' : ''}" data-letter="${esc(l)}" title="${n} countries">${esc(l)}</button>`;
      }).join('') + `</div>`).join('') + `</div>`;

    const factGroups = {};
    for (const [id, f] of Object.entries(data.facts)) (factGroups[f.group] ||= []).push([id, f]);
    for (const [g, list] of Object.entries(factGroups)) {
      h += `<div class="fgroup"><h3>${esc(g)}</h3><div class="opts">` +
        list.map(([id, f]) => opt(f.label, sel.facts.has(id), countWith(s => s.facts.add(id)), `data-fact="${id}"`, f.note)).join('') + `</div></div>`;
    }

    // Visual clue categories (collapsible; counts only computed for open ones).
    h += `<div class="fsep">Visual clues <span class="hint">${entries.length.toLocaleString()} examples</span></div>`;
    for (const cat of catOrder()) {
      const ci = idx[cat];
      const chosen = sel.attrs[cat] || {};
      const nChosen = Object.keys(chosen).length;
      if (nChosen) ui.open.add(cat);
      const open = ui.open.has(cat);
      h += `<details class="fgroup fcat" data-cat-group="${cat}"${open ? ' open' : ''}><summary><span>${esc(CATEGORIES[cat] || cat)}</span><span class="hint">${nChosen ? `${nChosen} selected · ` : ''}${ci.all.length}</span></summary>`;
      if (open) {
        h += Object.entries(ci.keys).map(([k, vals]) => {
          const more = vals.length > TOP_VALUES && !ui.expanded.has(`${cat}|${k}`);
          const list = more ? vals.filter(([v], i) => i < TOP_VALUES || chosen[k] === v) : vals;
          return `<div class="subh">${esc(k)}</div><div class="opts">` + list.map(([v]) => {
            const on = chosen[k] === v;
            return opt(v, on, on ? 0 : countWith(s => { (s.attrs[cat] ||= {})[k] = v; }), `data-cat="${cat}" data-k="${esc(k)}" data-v="${esc(v)}"`);
          }).join('') + (more ? `<button class="opt more-btn" data-more="${cat}|${esc(k)}">+${vals.length - list.length} more</button>` : '') + `</div>`;
        }).join('');
        h += `<div class="fcat-foot"><button class="linkbtn" data-browse="${cat}">Browse ${ci.all.length} examples →</button></div>`;
      }
      h += `</details>`;
    }

    const body = $('#facet-body');
    const scroll = body.parentElement.scrollTop;
    body.innerHTML = h;
    body.parentElement.scrollTop = scroll;
    body.querySelectorAll('[data-drive]').forEach(b => b.onclick = () => { sel.drive = sel.drive === b.dataset.drive ? null : b.dataset.drive; update(); });
    body.querySelectorAll('[data-script]').forEach(b => b.onclick = () => { toggle(sel.scripts, b.dataset.script); update(); });
    body.querySelectorAll('[data-letter]').forEach(b => b.onclick = () => { toggle(sel.letters, b.dataset.letter); update(); });
    body.querySelectorAll('[data-fact]').forEach(b => b.onclick = () => { toggle(sel.facts, b.dataset.fact); update(); });
    body.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
      const a = (sel.attrs[b.dataset.cat] ||= {});
      if (a[b.dataset.k] === b.dataset.v) delete a[b.dataset.k]; else a[b.dataset.k] = b.dataset.v;
      if (!Object.keys(a).length) delete sel.attrs[b.dataset.cat];
      ui.open.add(b.dataset.cat);
      if (ui.mode === 'clues') ui.browseCat = b.dataset.cat;
      update();
    });
    body.querySelectorAll('[data-more]').forEach(b => b.onclick = () => { ui.expanded.add(b.dataset.more); renderFacets(); });
    body.querySelectorAll('[data-browse]').forEach(b => b.onclick = () => { ui.mode = 'clues'; ui.browseCat = b.dataset.browse; ui.shown = PAGE; update(); });
    body.querySelectorAll('details.fcat').forEach(d => d.addEventListener('toggle', () => {
      const cat = d.dataset.catGroup;
      if (d.open === ui.open.has(cat) || (!d.open && sel.attrs[cat])) return;
      if (d.open) ui.open.add(cat); else ui.open.delete(cat);
      renderFacets();
    }));
  }

  function toggle(set, v) { set.has(v) ? set.delete(v) : set.add(v); }

  function renderActive() {
    const chips = [];
    if (sel.drive) chips.push([`Drives on the ${sel.drive === 'L' ? 'left' : 'right'}`, () => { sel.drive = null; }]);
    for (const x of sel.scripts) chips.push([x, () => sel.scripts.delete(x)]);
    for (const x of sel.letters) chips.push([x, () => sel.letters.delete(x)]);
    for (const x of sel.facts) chips.push([data.facts[x].label, () => sel.facts.delete(x)]);
    for (const [cat, attrs] of Object.entries(sel.attrs)) for (const [k, v] of Object.entries(attrs)) chips.push([`${CATEGORIES[cat] || cat}: ${k} ${v}`, () => { delete attrs[k]; if (!Object.keys(attrs).length) delete sel.attrs[cat]; }]);
    if (sel.q.trim()) chips.push([`“${sel.q.trim()}”`, () => { sel.q = ''; $('#clue-q').value = ''; }]);
    $('#active-chips').innerHTML = chips.map((c, i) => `<button class="opt on" data-i="${i}">${esc(c[0])} ×</button>`).join('');
    $('#active-chips').querySelectorAll('button').forEach(b => b.onclick = () => { chips[+b.dataset.i][1](); update(); });
  }

  // ---------- main area ----------

  function renderModeTabs() {
    document.querySelectorAll('#cl-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === ui.mode));
  }

  function renderGrid() {
    const list = data.countries.filter(c => passes(c, sel)).sort((a, b) => a.name.localeCompare(b.name));
    $('#cl-count').textContent = list.length;
    $('#cl-sub').textContent = `${list.length === 1 ? 'country' : 'countries'} of ${data.countries.length}`;
    if (ui.mode === 'clues') { renderBrowse(); return; }
    const attrCats = Object.keys(sel.attrs).filter(c => Object.keys(sel.attrs[c]).length);
    const matchCount = iso => attrCats.reduce((n, cat) => n + ((idx[cat] && idx[cat].iso[iso]) || []).filter(e => entryMatches(e, sel.attrs[cat])).length, 0);
    $('#cgrid').className = 'cgrid';
    $('#cgrid').innerHTML = list.length ? list.map((c, i) => {
      const m = attrCats.length ? matchCount(c.iso) : 0;
      return `<div class="cc" data-iso="${c.iso}" style="animation-delay:${Math.min(i, 40) * 8}ms">
        <span class="fl">${flag(c.iso)}</span>
        <span class="nm">${esc(c.name)}</span>
        <span class="meta">${c.iso} · ${c.drive === 'L' ? 'left' : 'right'} · ${esc(c.phone)}${c.tld ? ' · ' + esc(c.tld) : ''}${m ? ` · <b>${m} match${m === 1 ? '' : 'es'}</b>` : ''}</span>
      </div>`;
    }).join('') : `<div class="empty-big">No country matches all of these. Remove a filter.</div>`;
    $('#cgrid').querySelectorAll('.cc').forEach(el => el.onclick = () => showCountry(el.dataset.iso));
    if (list.length === 1 && ui.country !== list[0].iso) showCountry(list[0].iso);
  }

  function renderBrowse() {
    const cats = catOrder();
    if (!ui.browseCat || !idx[ui.browseCat]) ui.browseCat = Object.keys(sel.attrs)[0] || cats[0];
    const cat = ui.browseCat;
    const list = matchingEntries(cat);
    const tabs = `<div class="btabs">${cats.map(c => {
      const n = c === cat ? list.length : matchingEntries(c).length;
      return `<button class="opt${c === cat ? ' on' : ''}${n ? '' : ' dead'}" data-bcat="${c}">${esc(CATEGORIES[c] || c)}<span class="c">${n}</span></button>`;
    }).join('')}</div>`;
    const rows = list.slice(0, ui.shown).map(e => entryRow(e, true)).join('');
    const more = list.length > ui.shown ? `<div class="more"><button class="btn ghost sm" id="b-more">Show more (${list.length - ui.shown} left)</button></div>` : '';
    $('#cgrid').className = 'browse';
    $('#cgrid').innerHTML = tabs + (list.length ? `<div class="elist2">${rows}</div>${more}` : `<div class="empty-big">No ${esc((CATEGORIES[cat] || cat).toLowerCase())} match these filters.</div>`) +
      `<p class="help srcnote">Descriptions are our own; example locations come from community clue collections (GeoHints). Each “Street View” link opens the exact panorama, position and heading.</p>`;
    $('#cgrid').querySelectorAll('[data-bcat]').forEach(b => b.onclick = () => { ui.browseCat = b.dataset.bcat; ui.shown = PAGE; ui.open.add(b.dataset.bcat); update(); });
    $('#cgrid').querySelectorAll('[data-iso]').forEach(b => b.onclick = ev => { ev.preventDefault(); showCountry(b.dataset.iso); });
    const m = $('#b-more'); if (m) m.onclick = () => { ui.shown += PAGE; renderBrowse(); };
  }

  function entryRow(e, withCountry) {
    const attrs = Object.entries(e.attributes).map(([k, v]) => `<span class="ak">${esc(k)} <b>${esc(v)}</b></span>`).join('');
    const ex = e.examples.map((p, i) => `<a href="${streetView(p)}" target="_blank" rel="noopener" title="${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}${p.heading != null ? ` · heading ${p.heading}°` : ''}">Street View${e.examples.length > 1 ? ' ' + (i + 1) : ''} ↗</a><a href="${mapLink(p)}" target="_blank" rel="noopener">Map ↗</a>`).join('');
    const where = withCountry ? e.countries.map(i => `<a href="#/clues?c=${i}" class="ctry" data-iso="${i}">${flag(i)} ${esc((byIso[i] || {}).name || i)}</a>`).join(' ') : '';
    return `<div class="erow">
      <div class="et">${where ? `<span class="ew">${where}</span>` : ''}<span class="ett">${esc(e.title)}</span><span class="str ${e.strength}" title="${strengthHelp(e.strength)}">${e.strength}</span></div>
      <div class="ea">${attrs}${e.note ? `<span class="en">${esc(e.note)}</span>` : ''}</div>
      ${ex ? `<div class="el">${ex}</div>` : ''}
    </div>`;
  }
  const strengthHelp = s => s === 'unique' ? 'No other country in this library has the same combination' : s === 'strong' ? 'Shared with 2–3 countries in this library' : 'Shared with 4 or more countries in this library';

  function update() { renderFacets(); renderActive(); renderModeTabs(); renderGrid(); }

  // ---------- country card ----------

  function showCountry(iso) {
    const c = byIso[iso];
    if (!c) return;
    ui.country = iso;
    if (location.hash !== `#/clues?c=${iso}`) history.replaceState(null, '', `#/clues?c=${iso}`);
    $('#editor').hidden = true;
    const factsBy = {};
    for (const id of c.facts) { const f = data.facts[id]; (factsBy[f.group] ||= []).push(f); }
    const el = $('#cdetail');
    el.hidden = false;
    const cats = catOrder().filter(cat => idx[cat].iso[iso]);
    el.innerHTML = `
      <div class="d-head">
        <div class="d-top">
          <div class="d-title" style="font-size:20px">${flag(c.iso)} ${esc(c.name)}</div>
          <button class="x" id="cd-close">×</button>
        </div>
      </div>
      <div class="d-sec">
        <table class="kv">
          <tr><td>ISO code</td><td class="mono">${c.iso}</td></tr>
          <tr><td>Region</td><td>${esc(c.region)}</td></tr>
          <tr><td>Drives on</td><td>${c.drive === 'L' ? 'Left' : 'Right'}</td></tr>
          <tr><td>Phone code</td><td class="mono">${esc(c.phone)}${c.nanp ? ` <span class="muted">(area codes: ${esc(c.nanp)})</span>` : ''}</td></tr>
          <tr><td>Domain</td><td class="mono">${c.tld ? esc(c.tld) : '<span class="muted">none</span>'}</td></tr>
          <tr><td>Alphabet</td><td>${esc(c.scripts.join(', '))}</td></tr>
          <tr><td>Special letters</td><td class="mono" style="font-size:15px">${c.letters ? esc([...c.letters].join(' ')) : '<span class="muted">—</span>'}</td></tr>
        </table>
      </div>
      ${Object.entries(factsBy).map(([g, fs]) => `<div class="d-sec"><h4>${esc(g)}</h4>${fs.map(f => `<div class="fact"><div class="t">${esc(f.label)}<span class="str ${f.strength}">${f.strength}</span></div>${f.note ? `<div class="n">${esc(f.note)}</div>` : ''}</div>`).join('')}</div>`).join('')}
      <div class="d-sec"><h4>Visual clues (${cats.reduce((n, cat) => n + idx[cat].iso[iso].length, 0)})</h4>
        ${cats.length ? cats.map(cat => {
          const list = idx[cat].iso[iso];
          const attrs = sel.attrs[cat];
          const hits = attrs ? list.filter(e => entryMatches(e, attrs)) : [];
          const ordered = attrs ? [...hits, ...list.filter(e => !hits.includes(e))] : list;
          return `<details class="ccat"${attrs ? ' open' : ''}><summary>${esc(CATEGORIES[cat] || cat)} <span class="muted">${list.length}${attrs ? ` · ${hits.length} match` : ''}</span></summary>${ordered.map(e => entryRow(e, false)).join('')}</details>`;
        }).join('') : '<p class="help">No entries yet.</p>'}
      </div>`;
    $('#cd-close').onclick = closeCountry;
  }

  function closeCountry() {
    $('#cdetail').hidden = true;
    ui.country = null;
    if (location.hash.startsWith('#/clues?')) history.replaceState(null, '', '#/clues');
  }

  // ---------- editor (admin key required) ----------

  async function openEditor(edit, filter = '') {
    $('#cdetail').hidden = true;
    const el = $('#editor');
    el.hidden = false;
    const key = lsGet(ADMIN_KEY);
    let ok = false;
    if (key) {
      try { ok = (await fetch('/api/admin/check', { headers: { 'X-Admin-Token': key } })).ok; } catch { ok = false; }
    }
    if (!ok) {
      el.innerHTML = `<div class="d-head"><div class="d-top"><div class="d-title">Edit clues</div><button class="x" id="ed-close">×</button></div></div>
        <div class="d-sec"><form class="form" id="key-form">
          <label>Admin key<input type="text" id="key-in" placeholder="from /root/geohint/app/.admin_token" autocomplete="off"></label>
          <button class="btn primary">Unlock</button>
          <div class="help" id="key-msg"></div>
        </form></div>`;
      $('#ed-close').onclick = () => { el.hidden = true; };
      $('#key-form').onsubmit = e => { e.preventDefault(); lsSet(ADMIN_KEY, $('#key-in').value.trim()); openEditor(); };
      if (key) $('#key-msg').textContent = 'That key was not accepted.';
      return;
    }
    const e = edit || { category: 'bollard', title: '', attributes: {}, countries: [], strength: 'strong', note: '', examples: [], verified: '' };
    const exLine = p => [p.lat, p.lon, p.heading ?? '', p.pitch ?? '', p.pano ?? ''].join(', ').replace(/(, )+$/, '');
    const f = filter.trim().toLowerCase();
    const listed = entries.filter(x => !f || `${x.title} ${x.countries.join(' ')} ${x.category} ${x.id}`.toLowerCase().includes(f));
    el.innerHTML = `<div class="d-head"><div class="d-top"><div class="d-title">${edit ? 'Edit clue' : 'New clue'}</div><button class="x" id="ed-close">×</button></div></div>
      <div class="d-sec"><form class="form" id="clue-form">
        <label>Category<select name="category">${Object.entries(CATEGORIES).map(([k, l]) => `<option value="${k}"${k === e.category ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Title<input type="text" name="title" value="${esc(e.title)}" placeholder="e.g. White bollard, black slanted band"></label>
        <label>Attributes <span class="help">one per line, “key: value”. These become filters.</span>
          <textarea name="attributes" placeholder="body: white&#10;top band: black&#10;reflectors: red/white">${esc(Object.entries(e.attributes).map(([k, v]) => `${k}: ${v}`).join('\n'))}</textarea></label>
        <label>Countries <span class="help">ISO codes, comma-separated</span><input type="text" name="countries" value="${esc(e.countries.join(', '))}" placeholder="FR, BE"></label>
        <label>Strength<select name="strength">${['unique', 'strong', 'common'].map(x => `<option${x === e.strength ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Note<textarea name="note">${esc(e.note)}</textarea></label>
        <label>Example locations <span class="help">one per line: “lat, lon[, heading, pitch, pano id]”. They become Street View links.</span>
          <textarea name="examples" placeholder="48.858370, 2.294481, 120">${esc(e.examples.map(exLine).join('\n'))}</textarea></label>
        <label>Verified on<input type="date" name="verified" class="date" value="${esc(e.verified || '')}"></label>
        <div class="row"><button class="btn primary" type="submit">Save</button>${edit ? '<button class="btn ghost" type="button" id="ed-new">New instead</button>' : ''}</div>
        <div class="help" id="ed-msg"></div>
      </form></div>
      <div class="d-sec"><h4>Entries (${entries.length})</h4>
        <input type="text" id="ed-filter" placeholder="Filter by title, ISO code, category…" value="${esc(filter)}" style="margin-bottom:8px">
        <ul class="elist">${listed.slice(0, 60).map(x => `<li><span>${esc(x.title)} <span class="muted">· ${esc(CATEGORIES[x.category] || x.category)} · ${esc(x.countries.join(', '))}</span></span><span class="row"><button class="btn ghost sm" data-edit="${esc(x.id)}">Edit</button><button class="btn ghost sm" data-del="${esc(x.id)}">Delete</button></span></li>`).join('') || '<li class="muted">None</li>'}
        ${listed.length > 60 ? `<li class="muted">… ${listed.length - 60} more, narrow the filter</li>` : ''}</ul></div>
      <div class="d-sec"><button class="linkbtn" id="ed-lock">Forget admin key on this device</button></div>`;
    $('#ed-close').onclick = () => { el.hidden = true; };
    $('#ed-lock').onclick = () => { lsSet(ADMIN_KEY, null); el.hidden = true; };
    const n = $('#ed-new'); if (n) n.onclick = () => openEditor();
    const fi = $('#ed-filter');
    fi.oninput = () => { const pos = fi.selectionStart; openEditor(edit, fi.value).then(() => { const x = $('#ed-filter'); x.focus(); x.setSelectionRange(pos, pos); }); };
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(entries.find(x => x.id === b.dataset.edit), filter));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!confirm('Delete this clue?')) return;
      await fetch(`/api/clues?id=${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE', headers: { 'X-Admin-Token': key } });
      await loadEntries(); update(); openEditor(undefined, filter);
    });
    $('#clue-form').onsubmit = async ev => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = {
        id: edit ? edit.id : undefined, source: edit ? edit.source : undefined,
        category: fd.get('category'), title: fd.get('title'), strength: fd.get('strength'), note: fd.get('note'), verified: fd.get('verified'),
        attributes: Object.fromEntries(String(fd.get('attributes')).split('\n').map(l => l.split(':')).filter(p => p.length >= 2).map(([k, ...v]) => [k.trim(), v.join(':').trim()])),
        countries: String(fd.get('countries')).split(/[\s,;]+/).filter(Boolean),
        examples: String(fd.get('examples')).split('\n').map(l => l.split(',').map(s => s.trim())).filter(p => p.length >= 2 && p[0] && p[1])
          .map(([lat, lon, heading, pitch, pano]) => ({ lat: Number(lat), lon: Number(lon), heading, pitch, pano })),
      };
      const unknown = body.countries.map(x => x.toUpperCase()).filter(x => !byIso[x]);
      try {
        const res = await fetch('/api/clues', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Token': key }, body: JSON.stringify(body) });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error);
        await loadEntries(); update(); await openEditor(out, filter);
        $('#ed-msg').textContent = 'Saved.' + (unknown.length ? ` Note: ${unknown.join(', ')} not in the country list.` : '');
      } catch (err) { $('#ed-msg').textContent = err.message; }
    };
  }

  // ---------- boot ----------

  async function loadEntries() {
    try { entries = await (await fetch('/api/clues')).json(); } catch { entries = []; }
    buildIndex();
  }

  let qTimer = null;
  async function start(qs) {
    if (!started) {
      started = true;
      data = await (await fetch('/data/countries.json')).json();
      byIso = Object.fromEntries(data.countries.map(c => [c.iso, c]));
      await loadEntries();
      $('#clue-q').addEventListener('input', e => {
        sel.q = e.target.value;
        clearTimeout(qTimer);
        qTimer = setTimeout(update, 150);
      });
      $('#facet-reset').onclick = () => {
        sel.drive = null; sel.scripts.clear(); sel.letters.clear(); sel.facts.clear(); sel.attrs = {}; sel.q = '';
        $('#clue-q').value = ''; closeCountry(); update();
      };
      document.querySelectorAll('#cl-mode button').forEach(b => b.onclick = () => { ui.mode = b.dataset.mode; ui.shown = PAGE; update(); });
      $('#admin-btn').onclick = () => openEditor();
      update();
    }
    const c = new URLSearchParams(qs || '').get('c');
    if (c && byIso[c.toUpperCase()]) showCountry(c.toUpperCase());
  }

  (window.viewHooks ||= {}).clues = start;
})();
