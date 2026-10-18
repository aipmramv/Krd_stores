# KTEC Materials Twin

React + TypeScript + Vite build of the Claude Design handoff `project/Materials Twin v2.html`:
a digital twin of KONE KTEC material flows across sites in India.

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + static build in dist/
npm run preview
```

URL parameters: `?screen=network|routes|site|store|shipments|movements|reports|mobile` and `&mode=kiosk`.
`layouts.html` shows the app at 13 in laptop through 40 in kiosk resolutions side by side.

## Modules

| Key | Module | Surface |
| --- | --- | --- |
| 1 | Network: sites, transfers, shipments in transit | Leaflet map |
| 2 | Routes: road / air / rail / split options Chennai → Pune | Leaflet map |
| 3 | Site twin: campus from lat/long, B2 floors peel open | three.js |
| 4 | Store twin: racks and bins, colour by occupancy / ageing / project / hazard, radial bin menu, move by tap | three.js |
| 5 | Shipments: carriers, milestones, exceptions | Leaflet map |
| 6 | Moves & scrap: internal flows, scrap approval | three.js |
| 7 | Reports & masters: parts master grid | page |
| 8 | Mobile companion preview | page |

Ctrl K opens search, 1–8 switch module, Esc closes overlays or cancels a move.

## Structure

- `src/data/` — sample data (`sample.ts`) and the store model. Typed in `types.ts`; replace these exports with API-backed sources later.
- `src/state/` — a small external store (`store.ts`, read in components with `useApp`) and all user actions (`actions.ts`).
- `src/map/mapEngine.ts` — Leaflet map. Imperative; subscribes to the store and redraws layers.
- `src/three/` — renderer and camera (`engine.ts`), DOM labels kept clear of the panels (`labels.ts`), the site scene (`site.ts`) and the store scene (`store3d.ts`).
- `src/components/` — top bar, stage chrome (rail, crumbs, controls, timeline), drawer per screen, pages, overlays.
- `src/styles/` — KONE design-system tokens and fonts (`kone/`) and the app CSS ported verbatim from the prototype.

Layout is driven by classes on `<html>` (`portrait`, `narrow`, `docked`, `kiosk`, `rail-closed`, `drawer-closed`, `sheet-*`) set in `src/useLayout.ts`. In portrait the drawer becomes a bottom sheet (peek / half / full) and modules move to a bottom dock.

## Live services

All business data is sample data. Map context comes from public services, each with a fallback:

- Esri World Imagery tiles: map base and site ground. Without them the ground is plain.
- OpenStreetMap Overpass: building footprints around each site. Without it the site shows stylised campus massing.
- OSRM: real road geometry for the road route. Without it the route follows the stored NH48 polyline.
