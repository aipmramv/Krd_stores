# KTEC Materials Twin

React + TypeScript + Vite build of the Claude Design handoff `project/Materials Twin v2.html`:
a digital twin of KONE material flows across the four key KONE sites in India:
KTEC Chennai (Ambattur), KTEC Pune (Aundh), KONE ISU & Test Tower (Sriperumbudur) and the KONE – DHL warehouse (Oragadam).

**Map data is OpenStreetMap only:** the map uses OpenStreetMap standard tiles, and the 3D site twins are
built in three.js from OpenStreetMap buildings, roads, trees and parks, plus Blender-modelled assets.
No API keys or tokens are needed.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build in dist/
npm run preview
```

URL parameters: `?screen=network|routes|site|store|shipments|movements|reports|mobile`, `&site=ktec|pnq|isu|dhl` and `&mode=kiosk`.
`VITE_MAPILLARY_TOKEN` (optional) adds Mapillary street-level photos next to Wikimedia Commons photos.

## Modules

| Key | Module | Surface |
| --- | --- | --- |
| 1 | Network: sites, transfers, shipments in transit | OpenStreetMap map (MapLibre) |
| 2 | Routes: road / air / rail / split options Chennai → Pune | OpenStreetMap map |
| 3 | Site twin: real OSM buildings from lat/long, physical sun and sky, primary building peels open by floor | three.js |
| 4 | Store twin: racks and bins, colour by occupancy / ageing / project / hazard, radial bin menu, move by tap | three.js |
| 5 | Shipments: carriers, milestones, exceptions | OpenStreetMap map |
| 6 | Moves & scrap: internal flows, scrap approval | three.js |
| 7 | Reports & masters: parts master grid | page |
| 8 | Mobile companion preview | page |

Ctrl K opens search, 1–8 switch module, Esc closes overlays or cancels a move.

## Map to site

Entering a site, the map flies down to the site at the scale where one map pixel equals one 3D ground pixel,
while the 3D scene builds on the same OpenStreetMap tiles. The 3D camera starts exactly overhead, the map
cross-fades away and the camera tilts down into the site. Leaving reverses this.

## OpenStreetMap data

- Map and 3D ground: `tile.openstreetmap.org` standard tiles. They're fine for a pilot. For production or kiosk
  traffic, use a dedicated OSM tile host or self-hosted tiles, per the OSM tile usage policy.
- Buildings, roads, trees, parks and water: the Overpass API. `scripts/fetch-osm.ts` runs in the Pages deploy and
  bundles each site's data into `public/osm/`, so the app doesn't depend on busy public Overpass servers.
  The live mirrors are the fallback.

## Structure

- `src/data/` — the four key sites with facilities and flows (`sites.ts`), sample business data (`sample.ts`) and the store model.
- `src/map/mapEngine.ts` — the OpenStreetMap map (MapLibre GL, raster OSM tiles).
- `src/three/` — site scene from OSM (`site.ts`), sun and sky (`sky.ts`), procedural facades (`textures.ts`), Blender models (`models.ts`), the store (`store3d.ts`), the renderer and handoff (`engine.ts`) and DOM labels (`labels.ts`).
- `src/services/` — OSM data (`osm.ts`) and site photos (`photos.ts`).
- `public/models/` — glTF assets built in Blender by `../blender/build_assets.py`.
