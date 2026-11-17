# Co-occurrence search engine

## The query
"Find locations where feature A, feature B (and C…) all lie within *R* meters of each other, and where Street View coverage exists."
Example: `brand=Lidl` + `public_transport=platform` + `amenity=place_of_worship`, R = 150 m.

## Data source: OpenStreetMap
- Brands are well tagged thanks to the **name-suggestion-index** (`brand`, `brand:wikidata`), which gives clean, canonical brand IDs.
- Transit stops, churches, water towers, fuel stations, pharmacies and so on all have standard tags.
- License: ODbL. Attribution is required and derived databases must be shared alike, which is fine for us.
- Weak spots: coverage varies by country (Europe is great; parts of Africa/Asia are thin). Small local brands may be missing.

## Why not just query Overpass live
A global "Lidl near a church" query touches millions of objects, and the public Overpass servers will throttle or time out. We need our **own preprocessed index**:
- Download planet or regional extracts (Geofabrik), then keep only the tags we care about (a small fraction of the planet).
- Store as points in **PostGIS**, or bucket them into **H3 hex cells** (resolution ~9–10 ≈ 100–200 m).
- Query strategy: start from the **rarest** feature in the query, then look for the others within R around each candidate. That makes it fast even globally.

## "Within visual range" is the hard part
- v1: plain distance (user-adjustable, 50–300 m). Honest and simple.
- v2 ideas: ignore features across rivers or highways, prefer same street, use building footprints as a rough line-of-sight occluder. Probably not worth it early.
- Also useful: "on the same road" and "at an intersection" as constraints.

## Street View coverage filter
A match only matters if a camera could have seen it.
- Google's **Street View metadata endpoint** answers "is there a panorama near this point?" and is billed separately from (and much cheaper than, or free compared to) loading the panorama. Check current pricing before relying on it.
- Use it to **filter and rank candidates lazily**, only for results the user actually looks at, then cache.
- No official global coverage dataset exists; community coverage maps exist, but licensing is unclear.

## Inspecting matches
- Map with result pins and clusters, then click to open the **Google Street View** embed (Maps JavaScript API) at the nearest panorama, facing the features.
- Alternative or fallback: **Mapillary** (free, open imagery). But GeoGuessr uses Google, so Google is what players need to see.
- Nice touch: draw arrows/labels in the panorama for where A, B and C are.

## Query UX
- Chips: `[Lidl] + [bus stop] + [church]` · radius slider · region filter.
- Autocomplete over brands (NSI) and a curated list of "things you can see from a road", not raw OSM tags.
- Show a result count live as you add chips, so players learn which combinations are discriminating.
