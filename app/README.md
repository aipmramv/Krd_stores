# KTEC Materials Twin

React + TypeScript + Vite build of the Claude Design handoff `project/Materials Twin v2.html`:
a digital twin of KONE material flows across the four key KONE sites in India:
KTEC Chennai (Ambattur), KTEC Pune (Aundh), KONE ISU & Test Tower (Sriperumbudur) and the KONE – DHL warehouse (Oragadam).

All maps and 3D sites are drawn with **CesiumJS** and **Cesium ion**, using one token.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build in dist/ (Cesium runtime assets copied to dist/cesium)
npm run preview
```

## Cesium ion token

Everything geographic comes through Cesium ion: imagery, Cesium World Terrain, Cesium OSM Buildings,
and Google Photorealistic 3D Tiles (ion asset 2275207). Without a token the globe has none of these.

- Enter the token in the app under **Display** (stored on that device only), or
- set `VITE_CESIUM_ION_TOKEN` (`app/.env.local` for local builds, or the `CESIUM_ION_TOKEN` repository secret for Pages).

In Cesium ion, the token must be able to read asset 2275207: add **Google Photorealistic 3D Tiles** to My Assets from
the Asset Depot. Restrict its allowed URLs to where the app is hosted. The token ends up in the public site.
The free Community plan is for non-commercial use; production use needs a paid ion plan, and Google's terms apply
to the photorealistic tiles.

URL parameters: `?screen=network|routes|site|store|shipments|movements|reports|mobile`, `&site=ktec|pnq|isu|dhl` and `&mode=kiosk`.
`VITE_MAPILLARY_TOKEN` adds Mapillary street-level photos next to Wikimedia Commons photos.

## Modules

| Key | Module | Surface |
| --- | --- | --- |
| 1 | Network: sites, transfers, shipments in transit | Cesium globe |
| 2 | Routes: road / air / rail / split options Chennai → Pune | Cesium globe |
| 3 | Site twin: Google Photorealistic 3D Tiles (or Cesium OSM Buildings), facilities, photos, real sun | Cesium globe |
| 4 | Store twin: racks and bins, colour by occupancy / ageing / project / hazard, radial bin menu, move by tap | three.js |
| 5 | Shipments: carriers, milestones, exceptions | Cesium globe |
| 6 | Moves & scrap: internal flows between facilities, scrap approval | Cesium globe |
| 7 | Reports & masters: parts master grid | page |
| 8 | Mobile companion preview | page |

Ctrl K opens search, 1–8 switch module, Esc closes overlays or cancels a move.
Moving between map screens and sites is one continuous Cesium camera flight. The **3D** button tilts the map,
and the time-of-day slider moves the sun.

## Structure

- `src/data/` — the four key sites with facilities, approximate facility positions and flows (`sites.ts`), sample business data (`sample.ts`) and the store model. Typed in `types.ts`.
- `src/globe/globe.ts` — the Cesium globe: ion layers, camera flights, HTML overlays (pins, lanes, tags, facility labels, photo pins) placed clear of the panels.
- `src/three/` — the store interior (`engine.ts`, `store3d.ts`) and its DOM labels (`labels.ts`).
- `src/services/photos.ts` — site photos from Wikimedia Commons and Mapillary.
- `src/state/` — a small external store (`store.ts`, read in components with `useApp`) and all user actions (`actions.ts`).
- `src/components/` — top bar, stage chrome (rail, crumbs, controls, timeline), drawer per screen, pages, overlays.
- `public/models/test_tower.glb` — the KONE test tower, built in Blender by `../blender/build_assets.py`. It shows at ISU when the photorealistic tiles are off.

Facility positions in `sites.ts` are offsets in metres from each site coordinate and are approximate. Replace them with surveyed positions.
