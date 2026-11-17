# GeoGur

A precise tool for learning the world's geography: find real places by what can be seen there, and study the clues that tell countries apart.

## Features

### Locate: co-occurrence search

Ask for places where several things are close together, for example *a Lidl within 200 m of a tram stop and a church*. Results come from live OpenStreetMap data. Each one has exact coordinates, distances, the matched OSM objects and an "Open in Google Maps" link.

### Clues: regional encyclopedia

A filterable reference of the details that identify a country or region: driving side, road markings, bollards, utility poles, bus stops, licence plates, scripts, phone codes and domains. Entries are kept exact and sourced. Anything unverified stays out.

### Sun: latitude tool

Work out which hemisphere and roughly what latitude you are at from the direction and height of the sun.

## Stack

- **Server:** Node.js with no dependencies (`app/server.js`)
- **Frontend:** plain HTML, CSS and JavaScript (`app/public/`)
- **Data:** OpenStreetMap through Overpass (search) and Nominatim (regions, reverse geocoding); OSM raster tiles for the map

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/catalog` | Preset features available for search |
| `POST /api/search` | Co-occurrence search |
| `GET /api/region?q=` | Region lookup |
| `GET /api/region/shape` | Region outline |
| `GET /api/reverse?lat=&lon=` | Reverse geocoding |
| `GET /api/clues` | Clue entries (writes need the `X-Admin-Token` header) |

## Running

```sh
cd app
node server.js
```

To edit clues on the site, create `app/.admin_token` containing a secret of your choice.

## Project structure

| Path | Contents |
| --- | --- |
| `app/catalog.js` | Maps preset features to OSM tags; add new search presets here |
| `app/data/clues.json` | Visual clue entries |
| `tools/build_countries.py` | Source of the country facts; regenerates `app/public/data/countries.json` |
| `research/` | Collected clue research |
| `01-product.md` … `05-open-questions.md`, `decisions.md` | Design notes and the decision log |
| `NOTES.md` | Development notes |

## Data

Map data © OpenStreetMap contributors, available under the ODbL.
