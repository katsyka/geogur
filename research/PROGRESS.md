# Clue library — status (2026-10-10)

Done: all 13 categories described (research/*.txt), imported into app/data/clues.json (2,548 entries, 2,351 with exact Street View pano/heading from research/links.json).
Re-import after editing research files: `python3 tools/import_clues.py && systemctl restart geogur` (editor-added entries are kept).
Next: verify entries one by one (set "verified" date in the editor).
