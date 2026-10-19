# KTEC Materials Twin — realistic sites plan

> **Update:** maps and sites now run on CesiumJS + Cesium ion only (imagery, Cesium World Terrain,
> Cesium OSM Buildings, Google Photorealistic 3D Tiles via ion asset 2275207). The OpenStreetMap/Overpass,
> Esri, MapLibre and Google-key paths described below were removed; the store interior stays in three.js.

Goal: the four key KONE sites in India, shown on the map and as immersive, realistic 3D sites,
with one continuous camera motion from the map down into each site.

## Key sites

| Id | Site | Kind | Lat, long |
| --- | --- | --- | --- |
| `ktec` | KTEC Chennai — Tower-B, One India Bulls Tech Park, Ambattur Industrial Estate, Chennai 600058 | R&D centre | 13.09217, 80.16324 |
| `pnq` | KTEC Pune — Westend Icon, Westend Mall Campus, Aundh, Pune 411067 | R&D centre | 18.5631, 73.8078 |
| `isu` | KONE ISU & Test Tower — Plot A 28, SIPCOT Industrial Park, Pillaipakkam, Sriperumbudur 602105 | Factory | 12.9868, 79.9922 |
| `dhl` | KONE – DHL Warehouse — IndoSpace Oragadam 3, Ezhichur Road, Oragadam 631606 | 3PL warehouse | 12.8105, 79.9575 |

All shipments, transfers, routes and site twins now run on these four sites only.

## Phase 1 — implemented in this change

1. **Real sites on the map.** The four sites with address, coordinates and site profile (facilities,
   floors, internal flows). The network map frames all four, and the drawer shows the address and photos.
2. **Real buildings.** On entering a site, the browser fetches OpenStreetMap data from Overpass:
   building footprints (with `height` / `building:levels`), roads, trees, parks and water within ~800 m.
   The result is cached in the browser. KONE facility roles are assigned to the nearest large buildings.
3. **Realistic rendering (three.js).**
   - Physical sky with the sun at its true position for the site's latitude/longitude, date (timeline) and time of day.
   - Image-based lighting from the sky, soft sun shadows, ACES tone mapping and distance haze.
   - Procedural PBR facades by building type: glass curtain wall for offices, ribbed metal cladding for factories and warehouses.
     Windows glow at night. Rooftop plant on large roofs.
   - Satellite imagery as the ground: a sharp inner ring (zoom 18) over a wider outer ring (zoom 16).
   - Trees from OSM, plus trees scattered in parks, and trucks driving the site roads.
4. **Blender assets.** `blender/build_assets.py` (run headless with the `bpy` module) builds the KONE
   test tower, a truck and a tree, and exports them as glTF into `app/public/models/`. three.js loads
   and instances them, so Blender-modelled assets and three.js-generated city massing share one scene.
5. **Photos.** Geotagged photos near each site from Wikimedia Commons (no key needed), with credit and
   licence. Street-level photos are added from Mapillary when `VITE_MAPILLARY_TOKEN` is set.
   Photos show in the drawer and as pins in 3D. Opening a photo shows it full size, and "View in 3D" flies there.
6. **Seamless map ↔ site motion.** The map flies to the site, and the 3D camera starts at exactly the
   map's scale and position, overhead. The map then cross-fades into the 3D scene while the camera
   tilts down into an oblique view. Leaving reverses this: the camera rises to overhead, the map
   fades back in and zooms out. Switching sites from inside 3D does the same out-fly-in sequence.
7. **Photorealistic mode (optional).** With a Cesium ion token (`VITE_CESIUM_ION_TOKEN`) or a Google
   Maps Platform key (`VITE_GOOGLE_MAPS_API_KEY`), entered under Display or set as a repository secret,
   the site is rendered from Google Photorealistic 3D Tiles: real photogrammetry of every building.
   Cesium ion is tried first because it needs no Google billing. Its free Community plan is for
   non-commercial use; commercial use needs a paid ion plan. KONE labels, flows and photos stay on top.
8. **Interaction.** Hover highlight on buildings, tap to focus the camera on one, a cinematic auto-orbit
   "Tour", a time-of-day slider with "Now", and per-site layers (OSM buildings, neighbours, satellite
   ground, trees, vehicles, photos, labels, alerts).

## Phase 2 — planned next

- **Interiors from real floor plans.** Import DWG/IFC floor plans for Tower-B, the ISU factory and the
  DHL warehouse. A Blender pipeline would produce the floor GLBs, so the store twin matches each real store.
- **Site-owned 3D captures.** Drone photogrammetry or LiDAR of each site as 3D Tiles. This works without
  Google and is more accurate inside the campus.
- **Live IoT.** Test tower car position and shaft status, dock door sensors, and temperature in the
  hazmat store, streamed over MQTT/WebSocket.
- **Elevator digital twin in the test tower.** Animate cars from KONE 24/7 Connected Services data.
- **Terrain.** Height maps (e.g. Copernicus DEM) instead of a flat ground.
- **Post-processing.** Ambient occlusion and bloom for high-end screens, switched off automatically on kiosks.
- **WebXR.** Walkthrough of the site and stores in a headset.
- **Field photos.** Users upload site photos from the mobile companion, geotagged and shown as pins.

## Limits

- OSM coverage varies. Where a building has no `height` tag, height is estimated from its size, and
  the site falls back to a stylised campus if Overpass is unreachable.
- Facility roles (which building is the store, the labs and so on) are assigned automatically from
  footprint size and distance until real site layouts are supplied.
- Google Photorealistic 3D Tiles need a billing-enabled key and carry Google attribution.
