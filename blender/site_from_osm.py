"""Blender pipeline for the hybrid site twins: real OpenStreetMap geometry in, hand-refined KONE
buildings out.

1. Build:   python blender/site_from_osm.py --site ktec            (or --site all)
   Reads the site's OSM data (app/public/osm/<site>.json if present, else the Overpass API),
   builds blender/sites/<site>.blend in site-local metres (X east, Y north, Z up, origin at the
   site coordinate) and exports the KONE buildings.
2. Refine:  open blender/sites/<site>.blend, edit the objects in the "KONE" collection (keep their
   names), apply facade photos to the "<key> facade" materials. The "Context" collection is only a
   reference; the app builds the neighbourhood itself from OSM.
3. Export:  python blender/site_from_osm.py --site ktec --export
   Writes app/public/models/sites/<site>/<key>.glb and app/public/models/sites/manifest.json.
   The app then shows these models in place of the automatic OSM boxes.

The primary building is split into "floor_0", "floor_1", … objects so the app can still peel it
open. Run with the bpy module (pip install bpy==5.2.2) or `blender --background --python … -- …`.
Facility keys and roles come from blender/sites.json (node app/scripts/export-sites.ts).
"""
import argparse
import json
import math
import os
import sys
import urllib.parse
import urllib.request

import bpy  # noqa: I001 - bpy must load before bmesh when Blender runs as a Python module
import bmesh

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SITES = json.load(open(os.path.join(ROOT, 'blender', 'sites.json')))
OUT = os.path.join(ROOT, 'app', 'public', 'models', 'sites')
BLENDS = os.path.join(ROOT, 'blender', 'sites')
R_BLD, R_CTX = 750, 1000
OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
            'https://overpass.osm.jp/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
FACADE = {  # base colour, roughness, metallic, as in the app's procedural facades
    'glass': ((0.20, 0.27, 0.34, 1), 0.2, 0.35),
    'metal': ((0.55, 0.57, 0.59, 1), 0.45, 0.3),
    'concrete': ((0.58, 0.55, 0.50, 1), 0.85, 0.0),
}


# ---------- OSM, mirroring app/src/services/osm.ts ----------
def overpass_query(lat, lon):
    return f'''[out:json][timeout:90];(
    way["building"](around:{R_BLD},{lat},{lon});
    way["highway"](around:{R_CTX},{lat},{lon});
    way["landuse"~"grass|meadow|forest|recreation_ground|village_green|orchard"](around:{R_CTX},{lat},{lon});
    way["leisure"~"park|garden|pitch"](around:{R_CTX},{lat},{lon});
    way["natural"~"water|wood|scrub"](around:{R_CTX},{lat},{lon});
    node["natural"="tree"](around:{R_BLD},{lat},{lon});
  );out geom;'''


def load_osm(site, path=None):
    path = path or os.path.join(ROOT, 'app', 'public', 'osm', f"{site['id']}.json")
    if os.path.exists(path):
        print('OSM from', os.path.relpath(path, ROOT))
        return json.load(open(path))
    body = urllib.parse.urlencode({'data': overpass_query(*site['ll'])}).encode()
    for ep in OVERPASS:
        try:
            with urllib.request.urlopen(urllib.request.Request(ep, data=body), timeout=120) as r:
                j = json.load(r)
                if j.get('elements'):
                    print('OSM from', ep)
                    return j
        except Exception as e:  # noqa: BLE001 - try the next mirror
            print('  ', ep, 'failed:', e)
    sys.exit(f"No OSM data for {site['id']}: pass --osm FILE or check the network")


def projector(lat0, lon0):
    m_lat, m_lon = 111320, 111320 * math.cos(math.radians(lat0))
    return lambda lat, lon: ((lon - lon0) * m_lon, (lat - lat0) * m_lat)


def poly_stats(pts):
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        k = x0 * y1 - x1 * y0
        a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k
    a /= 2
    return a, ((cx / (6 * a), cy / (6 * a)) if abs(a) > 1e-6 else pts[0])


def inside(p, pts):
    x, y, hit, j = p[0], p[1], False, len(pts) - 1
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def height_of(tags, area, eid):
    for key in ('height', 'building:height'):
        try:
            h = float(tags.get(key, '').split()[0])
            if h:
                return h
        except (ValueError, IndexError):
            pass
    try:
        lv = float(tags.get('building:levels', ''))
        if lv:
            return lv * 3.5 + 1
    except ValueError:
        pass
    r = abs(math.sin(eid * 12.9898)) % 1
    t = tags.get('building')
    if t in ('industrial', 'warehouse', 'factory'):
        return 9 + r * 5
    if t in ('office', 'commercial'):
        return 28 + r * 30 if area > 1500 else 12 + r * 10
    if t in ('house', 'residential', 'apartments'):
        return 12 + r * 9 if area > 600 else 6 + r * 4
    return 10 + r * 8 if area > 2500 else 5 + r * 6


def buildings(site, osm):
    xy = projector(*site['ll'])
    out = []
    for e in osm.get('elements', []):
        t = e.get('tags') or {}
        if e.get('type') != 'way' or not t.get('building') or len(e.get('geometry') or []) < 4:
            continue
        pts = [xy(g['lat'], g['lon']) for g in e['geometry']]
        a, c = poly_stats(pts)
        if abs(a) < 12:
            continue
        out.append({'id': e['id'], 'pts': pts, 'area': abs(a), 'c': c, 'h': min(height_of(t, abs(a), e['id']), 180), 'd': math.hypot(*c)})
    return out


def match(site, blds):
    """Same rule as the app: building on the site point (or largest of the six nearest) is primary."""
    to_match = [f for f in site['facilities'] if not f['modelled']]
    at_site = next((b for b in blds if inside((0, 0), b['pts']) and b['area'] > 200), None)
    cands = sorted([b for b in blds if b['area'] > 150 and b['d'] < 360], key=lambda b: b['d'])
    main = at_site or max(cands[:6], key=lambda b: b['area'], default=None)
    m = {}
    if main:
        m[to_match[0]['k']] = main
    for b, f in zip([b for b in cands if b is not main], to_match[1:]):
        m[f['k']] = b
    return m


# ---------- Blender scene ----------
def material(name, color, rough, metal):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = color
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    return m


def hex_rgba(h):
    h = h.lstrip('#')
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb) + (1,)


def prism(name, pts, z0, height, mats, collection):
    """Extruded footprint with facade (index 0) and roof (index 1) materials, UVs in metres."""
    ring = pts[:-1] if pts[0] == pts[-1] else pts
    if poly_stats(ring + ring[:1])[0] < 0:
        ring = ring[::-1]
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, z0)) for x, y in ring]
    top = [bm.verts.new((x, y, z0 + height)) for x, y in ring]
    roof = bm.faces.new(top)
    roof.material_index = 1
    floor = bm.faces.new(bottom[::-1])
    floor.material_index = 1
    uv = bm.loops.layers.uv.new('UVMap')
    run = 0.0
    n = len(ring)
    for i in range(n):
        a, b = bottom[i], bottom[(i + 1) % n]
        f = bm.faces.new((a, b, top[(i + 1) % n], top[i]))
        f.material_index = 0
        length = (b.co - a.co).length
        for loop, (u, v) in zip(f.loops, ((run, z0), (run + length, z0), (run + length, z0 + height), (run, z0 + height))):
            loop[uv].uv = (u / 10, v / 10)  # 1 UV unit = 10 m, so a facade photo tile covers 10 m
        run += length
    for f in (roof, floor):
        for loop in f.loops:
            loop[uv].uv = (loop.vert.co.x / 20, loop.vert.co.y / 20)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    collection.objects.link(ob)
    return ob


def build(site, osm):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    kone = bpy.data.collections.new('KONE')
    ctx = bpy.data.collections.new('Context')
    scene.collection.children.link(kone)
    scene.collection.children.link(ctx)
    blds = buildings(site, osm)
    matched = match(site, blds)
    used = {id(b) for b in matched.values()}
    ctx_mat = material('Context', (0.75, 0.76, 0.77, 1), 0.8, 0)
    for b in blds:
        if id(b) not in used:
            prism(f"osm_{b['id']}", b['pts'], 0, b['h'], [ctx_mat, ctx_mat], ctx)
    facilities = {f['k']: f for f in site['facilities']}
    for k, b in matched.items():
        f = facilities[k]
        col, rough, metal = FACADE[f['facade']]
        mats = [material(f'{k} facade', col, rough, metal), material(f'{k} roof', hex_rgba(f['col']), 0.8, 0)]
        if f['floors']:
            h = max(b['h'], 15)
            fh = h / f['floors']
            root = bpy.data.objects.new(k, None)
            kone.objects.link(root)
            for i in range(f['floors']):
                part = prism(f'floor_{i}', b['pts'], i * fh, fh - 0.5, mats, kone)
                part.parent = root
        else:
            prism(k, b['pts'], 0, max(b['h'], 6), mats, kone)
    ground = bpy.data.meshes.new('Ground')
    s = R_CTX
    ground.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('Ground (reference)', ground)
    ctx.objects.link(g)
    os.makedirs(BLENDS, exist_ok=True)
    path = os.path.join(BLENDS, f"{site['id']}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print('saved', os.path.relpath(path, ROOT), '·', len(blds), 'OSM buildings ·', len(matched), 'KONE buildings')


def export(site):
    path = os.path.join(BLENDS, f"{site['id']}.blend")
    if bpy.data.filepath != path:
        bpy.ops.wm.open_mainfile(filepath=path)
    kone = bpy.data.collections['KONE']
    out = os.path.join(OUT, site['id'])
    os.makedirs(out, exist_ok=True)
    files = {}
    for root in [o for o in kone.objects if o.parent is None]:
        bpy.ops.object.select_all(action='DESELECT')
        for o in [root, *root.children_recursive]:
            o.select_set(True)
        f = os.path.join(out, f'{root.name}.glb')
        bpy.ops.export_scene.gltf(filepath=f, export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
        files[root.name] = f"{site['id']}/{root.name}.glb"
        print('exported', os.path.relpath(f, ROOT))
    manifest_path = os.path.join(OUT, 'manifest.json')
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    manifest[site['id']] = files
    json.dump(manifest, open(manifest_path, 'w'), indent=2)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--site', required=True, help='site id (ktec, isu, dhl, pnq) or all')
    ap.add_argument('--export', action='store_true', help='only re-export the refined KONE buildings from the .blend')
    ap.add_argument('--osm', help='Overpass JSON file to use instead of fetching')
    a = ap.parse_args(argv)
    for site in SITES if a.site == 'all' else [s for s in SITES if s['id'] == a.site]:
        if not a.export:
            build(site, load_osm(site, a.osm))
        export(site)


if __name__ == '__main__':
    main()
