# GeoGur — project notes  _(folder still named geohint)_

Status: **v0.2 running.** Locate (with searching animation), Clues (facet filter + editor) and Sun (latitude tool) all work.
URL: http://144.31.188.168:6670 (also :6665, which browsers block)
Started: 2026-10-09

## The idea (one paragraph)
A precise tool for learning the world, inspired by GeoGuessr. Two parts:
1. **Co-occurrence search.** "Show me places where *X* is within sight of *Y* (and *Z*)", for example a Lidl near a tram stop near a church. Each match has exact coordinates and an "Open in Google Maps" link.
2. **Clue encyclopedia.** A fast, filterable reference of regional clues (bus stops, road lines, poles, bollards, sun direction and so on) for narrowing down the country first.

## Files
- [01-product.md](01-product.md): who it's for, how it gets used, MVP scope
- [02-search-engine.md](02-search-engine.md): how the co-occurrence search could work
- [03-encyclopedia.md](03-encyclopedia.md): the clue reference, its structure and content strategy
- [04-risks.md](04-risks.md): fair play, API costs, licensing, the name clash
- [05-open-questions.md](05-open-questions.md): decisions we still need to make
- [decisions.md](decisions.md): log of what we've agreed

## App
- `app/server.js`: Node server with no dependencies; API under `/api/*`
  - `GET /api/catalog`: preset features
  - `GET /api/region?q=`: Nominatim search
  - `POST /api/search`: co-occurrence search (Overpass)
  - `GET /api/reverse?lat=&lon=`: address lookup
- `app/catalog.js`: maps preset features to OSM tags (add new presets here)
- `tools/build_countries.py`: source of the Clues country facts (driving side, phone, domain, scripts, letters, plates, road lines). Edit it, then re-run to regenerate `app/public/data/countries.json`
- `app/data/clues.json`: visual clue entries (bollards, poles, bus stops…). Edit them on the site via “Edit clues”
- `app/.admin_token`: the key for “Edit clues” (`cat /root/geohint/app/.admin_token`)
  - `GET/POST/DELETE /api/clues`: clue entries (writes need the `X-Admin-Token` header)
  - `GET /api/region/shape`: region outline (Nominatim)
- `app/public/`: frontend (index.html, app.css, app.js = Locate + routing, clues.js, sun.js)
- `app/cache/`: cached Overpass and Nominatim responses (safe to delete)
- Service: `systemctl restart geogur`. Logs: `journalctl -u geogur -f`
- URLs: `#/search?q=<base64 query>&sel=<index>` links to a query and a specific result
