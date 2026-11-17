# Imports the visual clue library (research/*.txt) into app/data/clues.json.
#   research/sel.json   one item per example: category, country, GeoHints sub-label, Google Maps short link
#   research/<cat>.txt  our own description of each item ("sid | attr | attr | ... | note"), sid = index within its category
#   research/links.json short link -> resolved Google Maps URL (exact Street View position, heading, pitch, pano id)
# Entries added by hand through the editor (source != 'geohints.com') are kept. Re-run after editing research files:
#   python3 tools/import_clues.py && systemctl restart geogur
import json, os, re, collections

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
R = lambda *p: os.path.join(ROOT, *p)

# Attribute keys per category, in the column order of research/<cat>.txt.
KEYS = {
    'bollard': ['body', 'top band', 'reflectors'],
    'pole': ['material', 'shape', 'top'],
    'bus_stop': ['colour', 'symbol', 'text'],
    'chevron': ['background', 'arrow'],
    'pedestrian': ['shape', 'colour'],
    'stop_sign': ['shape', 'text', 'border'],
    'rail_crossing': ['shape', 'colour'],
    'plate': ['background', 'characters', 'left strip'],
    'post_box': ['colour', 'form'],
    'traffic_light': ['housing', 'backplate'],
    'tram_stop': ['colour', 'symbol'],
    'street_name': ['background', 'text'],
    'house_number': ['background', 'text'],
}
NOUN = {'bollard': 'bollard', 'pole': 'pole', 'bus_stop': 'bus stop sign', 'chevron': 'chevron', 'pedestrian': 'crossing sign',
        'stop_sign': 'stop sign', 'rail_crossing': 'railway crossing sign', 'plate': 'plate', 'post_box': 'post box',
        'traffic_light': 'traffic light', 'tram_stop': 'tram stop sign', 'street_name': 'street sign', 'house_number': 'house number'}

countries = json.load(open(R('app', 'public', 'data', 'countries.json')))['countries']
name_iso = {c['name']: c['iso'] for c in countries}
name_iso.update({'Czech Republic': 'CZ', 'United States Virgin Islands': 'VI', 'Macao': 'MO', 'Svalbard and Jan Mayen': 'SJ'})
sel = json.load(open(R('research', 'sel.json')))
links = json.load(open(R('research', 'links.json')))

def example(short):
    url = links.get(short) or ''
    m = re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)(?:,([\d.]+)a)?(?:,([\d.]+)y)?(?:,([\d.]+)h)?(?:,([\d.]+)t)?', url)
    if not m: return None
    ex = {'lat': round(float(m.group(1)), 7), 'lon': round(float(m.group(2)), 7)}
    if m.group(5): ex['heading'] = round(float(m.group(5)), 1)
    if m.group(6): ex['pitch'] = round(float(m.group(6)) - 90, 1)
    pano = re.search(r'!1s([\w-]{20,})!2e0', url)
    if pano: ex['pano'] = pano.group(1)
    return ex

def cap(s): return s[:1].upper() + s[1:]

desc = {}
for cat, keys in KEYS.items():
    for line in open(R('research', cat + '.txt'), encoding='utf-8'):
        if line.startswith('#') or not line.strip(): continue
        parts = [p.strip() for p in line.rstrip('\n').split('|')]
        sid, vals, note = parts[0], parts[1:1 + len(keys)], (parts[1 + len(keys)] if len(parts) > len(keys) + 1 else '')
        assert len(vals) == len(keys), (cat, line)
        desc[(cat, sid)] = (dict((k, v) for k, v in zip(keys, vals) if v and v != '-'), note)

out, skipped = [], collections.Counter()
for item in sel:
    cat, sid = item['cat'], item['sid']
    if (cat, sid) not in desc: skipped['no description'] += 1; continue
    iso = name_iso.get(item['country'])
    if not iso: skipped['country ' + item['country']] += 1; continue
    attrs, note = desc[(cat, sid)]
    title = cap(note) if note else cap(' · '.join(f'{k} {v}' for k, v in attrs.items()))
    ex = example(item.get('link') or '')
    out.append({
        'id': 'gh-' + item['id'].replace(':', '-'), 'category': cat, 'title': title, 'attributes': attrs,
        'countries': [iso], 'strength': 'common', 'note': item.get('note') or '',
        'examples': [ex] if ex else [], 'verified': None, 'source': 'geohints.com',
    })

# Strength within this library: how many countries share the exact same attribute combination.
share = collections.defaultdict(set)
for e in out: share[(e['category'], tuple(sorted(e['attributes'].items())))].update(e['countries'])
for e in out:
    n = len(share[(e['category'], tuple(sorted(e['attributes'].items())))])
    e['strength'] = 'unique' if n == 1 else 'strong' if n <= 3 else 'common'

path = R('app', 'data', 'clues.json')
try: manual = [e for e in json.load(open(path)) if e.get('source') != 'geohints.com']
except FileNotFoundError: manual = []
json.dump(manual + out, open(path + '.tmp', 'w'), ensure_ascii=False, indent=1)
os.replace(path + '.tmp', path)
print(f'{len(out)} imported, {len(manual)} manual kept, {sum(1 for e in out if e["examples"])} with Street View position; skipped {dict(skipped)}')
print(collections.Counter(e['category'] for e in out))
