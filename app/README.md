# KTEC Materials Twin

React + TypeScript + Vite build of the Claude Design handoff `project/Materials Twin v2.html`:
a digital twin of KONE material flows across the four key KONE sites in India:
KTEC Chennai (Ambattur), KTEC Pune (Aundh), KONE ISU & Test Tower (Sriperumbudur) and the KONE – DHL warehouse (Oragadam).
See `../docs/PLAN-realistic-twin.md` for the realistic-site plan.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build in dist/
npm run preview
```

URL parameters: `?screen=network|routes|site|store|shipments|movements|reports|mobile`, `&site=ktec|pnq|isu|dhl` and `&mode=kiosk`.

Optional environment variables (`app/.env.local`):

| Variable | Enables |
| --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | Photorealistic 3D site view from Google Photorealistic 3D Tiles. It can also be entered at runtime under Display, where it is stored on that device only. |
| `VITE_MAPILLARY_TOKEN` | Street-level photos from Mapillary, alongside Wikimedia Commons photos. |
| `VITE_CESIUM_ION_TOKEN` | Photorealistic 3D through Cesium ion (Google Photorealistic 3D Tiles, ion asset 2275207). It needs no Google billing and is used before a Google key. It can also be entered under Display. |
`layouts.html` shows the app at 13 in laptop through 40 in kiosk resolutions side by side.

## Modules

| Key | Module | Surface |
| --- | --- | --- |
| 1 | Network: sites, transfers, shipments in transit | Leaflet map |
| 2 | Routes: road / air / rail / split options Chennai → Pune | Leaflet map |
| 3 | Site twin: real buildings from lat/long, physical sun and sky, primary building peels open by floor | three.js |
| 4 | Store twin: racks and bins, colour by occupancy / ageing / project / hazard, radial bin menu, move by tap | three.js |
| 5 | Shipments: carriers, milestones, exceptions | Leaflet map |
| 6 | Moves & scrap: internal flows, scrap approval | three.js |
| 7 | Reports & masters: parts master grid | page |
| 8 | Mobile companion preview | page |

Ctrl K opens search, 1–8 switch module, Esc closes overlays or cancels a move.

## Structure

- `src/data/` — the four key sites with facilities and flows (`sites.ts`), sample business data (`sample.ts`) and the store model. Typed in `types.ts`.
- `src/services/` — OpenStreetMap buildings, roads and trees from Overpass (`osm.ts`, cached in the browser) and site photos from Wikimedia Commons and Mapillary (`photos.ts`).
- `src/state/` — a small external store (`store.ts`, read in components with `useApp`) and all user actions (`actions.ts`).
- `src/map/mapEngine.ts` — Leaflet map. Imperative; subscribes to the store and redraws layers.
- `src/three/` — renderer, camera and map handoff (`engine.ts`), DOM labels kept clear of the panels (`labels.ts`), the realistic site scene (`site.ts`), sun and sky (`sky.ts`), procedural PBR facades (`textures.ts`), Blender models (`models.ts`), Google photoreal tiles (`tiles.ts`, loaded on demand) and the store scene (`store3d.ts`).
- `public/models/` — glTF assets built in Blender by `../blender/build_assets.py`: the test tower, a truck and trees.
- `src/components/` — top bar, stage chrome (rail, crumbs, controls, timeline), drawer per screen, pages, overlays.
- `src/styles/` — KONE design-system tokens and fonts (`kone/`) and the app CSS ported verbatim from the prototype.

Layout is driven by classes on `<html>` (`portrait`, `narrow`, `docked`, `kiosk`, `rail-closed`, `drawer-closed`, `sheet-*`) set in `src/useLayout.ts`. In portrait the drawer becomes a bottom sheet (peek / half / full) and modules move to a bottom dock.

## Map to site

Entering a site, the map flies down to zoom 17 with the site at the centre of the visible area. Meanwhile
the 3D scene builds from the same satellite tiles. The 3D camera starts exactly overhead at the map's
scale, the map cross-fades away and the camera tilts down into the site. Leaving reverses it, and
switching sites from inside 3D rises out, flies across the map and descends into the new site.

## Live services

Site positions are real; stock, shipments and alerts are sample data. Map and site context comes from
public services, each with a fallback:

- Esri World Imagery tiles: map base and site ground. Without them the ground uses OSM roads, parks and water.
- OpenStreetMap Overpass: building footprints and heights, roads, trees and parks around each site. Without it the site shows a stylised campus.
- Wikimedia Commons: geotagged photos within 2 km. Mapillary street-level photos are added when a token is set.
- OSRM: real road geometry for the road route. Without it the route follows the stored NH48 polyline.
- Google Photorealistic 3D Tiles: optional, through a Cesium ion token or a Google key. The data credits show on screen while the tiles are visible.

## Blender assets

```sh
python -m venv .venv && .venv/bin/pip install bpy==5.2.2
.venv/bin/python ../blender/build_assets.py   # writes public/models/*.glb
```
