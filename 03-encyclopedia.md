# Clue encyclopedia

## Key design idea: search by what you see, not by country
Existing sites mostly go **country → clues**. In-game you have the reverse problem: "I see a white bollard with a red reflector. Where am I?"
So the core UX should be **facet filtering that narrows a country list**:
- Bollard: white body, black band, red reflector → 6 countries left
- Plus driving side: right → 4
- Plus road lines: yellow center → 1

Each clue is a structured record, not just a blog post:
```
category: bollard | pole | bus_stop | road_line | plate | sign | chevron | sun | ...
attributes: { color, shape, reflector_color, ... }   # facets
countries/regions: [...]                              # can be sub-national
confidence: unique | strong | common
image(s), short note, source
```
That structure is what makes "lightning fast" possible: the whole dataset is small enough to ship to the browser and filter client-side, offline, instantly.

## Categories for v1
Bus stops, road markings, utility poles, bollards, sun position. Cheap extras later: plates, chevrons, language/script, driving side, car "metas" (Street View car features), domains on signs, phone prefixes.

## Sun position as a little tool, not just an article
Inputs: the compass heading the sun is at, plus rough time of year if known. Output: hemisphere, and a rough latitude band.
That's an interactive widget rather than a static page, and a nice differentiator.

## Content is the moat and the main cost
- Writing hundreds of accurate entries with images is the real work.
- **Images:** we can't copy Plonk It / GeoHints / screenshots of Google Street View (Google ToS). Options: Mapillary and Wikimedia Commons (CC licenses, attribution required), our own photos, or community submissions.
- **Accuracy:** clues change (new poles, new road paint). Need "last verified" dates and a way for users to report errors.
- Possible model: we seed ~200 high-value entries, then accept community submissions with review.
