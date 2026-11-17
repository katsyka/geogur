# Risks & things to be careful about

## 1. Fair play / reputation (biggest one)
Using a real-time lookup tool during competitive GeoGuessr is cheating, and the community reacts strongly to it. A meter-level "find this exact spot" engine is exactly the kind of tool that gets labelled a cheat.
**Mitigation:** position as training / round review / casual. Don't integrate with or read the GeoGuessr client in any way. No browser extension that hooks the game.

## 2. Name clash
**GeoHints** (geohints.com) is already a well-known GeoGuessr clue site. "GeoHint" is too close: confusing and possibly a trademark issue. Worth picking a different name early.

## 3. Google Maps Platform cost & terms
- Loading Street View panoramas is billed per load once past the free monthly allowance. Viral traffic could get expensive. Need per-user rate limits and caching, or let power users bring their own API key.
- Google's terms restrict caching/storing imagery and some uses alongside non-Google maps. Read them before designing the result map (e.g. a Leaflet/OSM map + Google Street View mix may be restricted).

## 4. Data quality
OSM is great in Europe, patchy elsewhere. Results will be uneven by region; tell users that honestly in the UI.

## 5. Content licensing
No scraping of other clue sites. Images need a clear license.

## 6. Scale of preprocessing
Planet-scale OSM processing needs a decent machine (RAM/disk). A regional start keeps this cheap; our current VPS may handle a few countries but probably not the whole planet.
