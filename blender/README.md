# Blender site models

The 3D site view is a hybrid. The neighbourhood (roads, trees, parks, other buildings) is built
automatically in three.js from OpenStreetMap. The KONE buildings at each site can be replaced with
models made in Blender, which look much closer to the real buildings.

## Files

- `sites.json` lists the four sites and their KONE facilities. Regenerate it with
  `node app/scripts/export-sites.ts` after you change `app/src/data/sites.ts`.
- `site_from_osm.py` builds `sites/<site>.blend` from OSM data. KONE buildings go in the **KONE**
  collection, everything else goes in **Context** for reference. With `--export` it writes each
  KONE building to `app/public/models/sites/<site>/<key>.glb` and updates `manifest.json`.
- `build_assets.py` builds the shared props: the test tower, trucks and trees.
- `kosmo_one.py` models Kosmo One for KTEC Chennai by hand: Tower B (KTEC) with one group per
  storey (`floor_0` = ground … `floor_12`), Tower A and the plaza. The floor plate outline and the
  level heights are stored on the `main` root as custom properties (glTF extras), so the app can
  open a floor and furnish it. Facilities with `levels` in `sites.ts` use this.
- `kone_isu.py` models the KONE ISU factory and test tower campus at SIPCOT Pillaipakkam from
  footprints traced on Esri World Imagery: production hall (peels into ground, mezzanine and roof),
  test tower, admin block, warehouse, docks, hazmat store, quarantine and scrap yards, and the
  campus paving, roads, gate and car port.
- The **OSM snapshot** workflow saves the app's OSM data, a lookup of named places and, with the
  `imagery` input (`lat,lon[,zoom]`), a satellite mosaic to the `osm-snapshot` branch for tracing.

## Workflow

1. In GitHub Actions, run **Blender site models** (pick a site id — `ktec`, `pnq`, `isu`, `dhl` — or leave it on `all`). Download the
   `blender-sites` artifact. It holds a starter `.blend` for each site, built from real OSM footprints.
2. In Blender, refine the objects in the **KONE** collection. Keep the object names: the root object
   is named after the facility key (`main`, `tower` and so on). Floors of the primary building are
   children named `floor_0`, `floor_1`, … The app peels these floors apart and labels them.
   Apply the facade photos to the `<key> facade` and `<key> roof` materials. UVs are 10 m per unit.
3. Commit the edited file to `blender/sites/<site>.blend` and push. The workflow then exports the
   GLBs, commits them, and the Pages deploy publishes them.

The axes are X east, Y north and Z up, with the site centre at the origin. One unit is one metre.

## Photos

Put building photos in `blender/photos/<site>/`, for example `blender/photos/ktec/front.jpg`.
Facade shots taken straight on, in daylight, work best. Include one wide shot of each building for
its shape and proportions.

## Running locally

```sh
python -m venv bpyenv && bpyenv/bin/pip install bpy==5.2.2
bpyenv/bin/python blender/site_from_osm.py --site all            # builds .blend files (needs Overpass)
bpyenv/bin/python blender/site_from_osm.py --site all --export   # .blend → GLB + manifest
```
