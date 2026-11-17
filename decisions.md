# Decisions log

- 2026-10-09: **Name: GeoGur.** It avoids the clash with GeoHints.com.
- 2026-10-09: **Purpose: learning the world**, not gaining score in GeoGuessr. Precision matters more than anything: exact coordinates, distances and OSM IDs.
- 2026-10-09: **No embedded Street View.** Each result has an "Open in Google Maps" link to its exact coordinates instead. This removes Google API cost and terms issues.
- 2026-10-09: **No community features** (no submissions, accounts or social features).
- 2026-10-09: **Website only** for now. No Android app.
- 2026-10-09: **v0.1 stack:** zero-dependency Node server, live Overpass queries with an on-disk cache, Nominatim reverse geocoding, Leaflet with grayscale OSM tiles. Design: white background, black UI, minimal.
- 2026-10-09: **Ports 6665 + 6670.** Chrome and Firefox block 6665 (an IRC port, ERR_UNSAFE_PORT), so 6670 is the one that opens in a browser.
- 2026-10-09: **Clues v1 holds only facts that can be stated exactly** (driving side, calling codes, ccTLDs, scripts, special letters, a few plate and road-line facts). Bollards, poles and bus stops start empty and are added through the editor with a verified date and example coordinates, rather than written from memory.
- 2026-10-09: **Sun tool uses exact solar geometry** (Spencer declination plus the spherical-triangle relation) and carries the user's ± margins through into a latitude band. It was checked against a forward model and recovers the true latitude exactly.
- 2026-10-10: **Clue library imported** from our own descriptions of GeoHints examples (13 categories, ~2,500 entries). Photos are not copied; each entry links to the exact Street View panorama instead. Strength = how many countries share the same attribute combination in this library.
- 2026-10-10: Catalog expanded to ~170 presets; raw tags support `=`, `~` (regex), `!=`; "Visible map area" region; CSV/GeoJSON export; example searches.
