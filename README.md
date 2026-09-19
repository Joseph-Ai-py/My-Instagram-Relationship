# Instagram Relationship Universe v6

Responsive web version of the 3D Instagram relationship graph.

## What changed
- Desktop-first web layout with responsive mobile/tablet breakpoints.
- Supports down to 320 CSS px as the primary small-screen target, with an extra 359px/280px fallback layer.
- Playback speed controls: 0.25x / 0.5x / 1x / 2x / 4x.
- Close Friends are explicitly visualized with Orbit 1 color, a glowing CF ring, and a `CF` badge.
- Existing nodes animate only when their target/orbit changes; new nodes enter from the center; exiting nodes move outward before removal.
- Instagram ZIP import is local in the browser, with tolerant file matching for numbered export suffixes and optional empty/missing relationship files.
- Only `followers_1.json` and `following.json` are treated as required core files; the other relationship files are reported when missing and default to empty data.

## Run

```bash
py -m http.server 8000
```

Open `http://localhost:8000`.

## ZIP input
The importer searches inside:

`connections/followers_and_following/`

for the 11 relationship files, including numbered variants such as `restricted_profiles_5.json`.
