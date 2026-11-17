# Product thinking

## Two features, two different moments in a round
| Moment | Player's question | Feature |
|---|---|---|
| First 10–30 s | "Which country / region?" | Encyclopedia (country-level) |
| After that | "Where exactly in this region?" | Co-occurrence search (meter-level) |

These are almost two products. The encyclopedia is mostly **content**; the search is mostly **data engineering**. They share a brand and a map, not much else.

## How it gets used (has to be decided; see risks)
- **A. Study / training mode.** Use it between games, on your own maps, or to review a round you just lost ("where was that?"). Clean ethically, and it's how strong players already learn.
- **B. Live companion during casual or solo play.** Second screen next to the game.
- **C. Live during competitive/ranked play.** That is cheating. We should not design for it.

My recommendation: market and design for **A**, tolerate **B**, never mention ranked.
"Round review" is also a strong feature on its own: paste or drop the location after the round and see which clues you could have used.

## Platform
- The search engine needs a big map and a panorama viewer, so it suits **web/desktop**.
- The encyclopedia is quick lookup, so it suits **phone** too (PWA or Android; we already have Android tooling from Bleper/YukiChat).
- Suggestion: one web app (responsive, installable PWA, works offline for the encyclopedia). Native Android later only if needed.

## MVP proposal
1. Encyclopedia covering **~10 high-frequency countries** × **5 clue categories**, with fast facet filtering. Ship this first: it's cheaper, useful right away, and draws users.
2. Co-occurrence search for **one region** (for example one country) with **brands + transit stops + a handful of POI types**, distance-based "visibility" and a Street View check.
3. Expand coverage once the pipeline is proven.
