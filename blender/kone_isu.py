"""Model the KONE ISU factory and test tower campus, SIPCOT Pillaipakkam, Sriperumbudur.

  python blender/kone_isu.py

Builds blender/sites/isu.blend and exports it with site_from_osm.export. Every KONE facility is a
hand-made model at its real position, so nothing is matched to the sparse OpenStreetMap data here:
- `main` production hall with a solar roof and the KONE blue eave band; floors (ground assembly,
         mezzanine store, roof) as floor_0..floor_2 so the hall still peels open
- `tow`  test tower: white shaft with dark glazing strips, a cantilevered head with the KONE sign
         and a glazed lobby podium
- `adm`  admin and training block, blue glazed, stepped; `wh` component warehouse; `stg` dispatch
         dock shed; `haz` hazmat store; `qua` quarantine cage; `scr` scrap yard
- `campus` scenery: paving, internal roads, lawns, round entrance garden, gate, security cabin,
         two-wheeler shed and the solar car port

Footprints are traced on Esri World Imagery (pixel coordinates below, see PX_TO_ENU). Metres, X east, Y north, Z up; the origin is
the site coordinate in app/src/data/sites.ts.
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import kosmo_one as k1  # noqa: E402  (geometry helpers and image textures)
import site_from_osm as sfo  # noqa: E402

# Footprints are traced on an Esri World Imagery zoom-18 mosaic (0.582 m per pixel, north up; the
# crop's top-left is global pixel 48 462 900, 31 116 856). The site origin, the middle of the
# production hall at 12.95646, 79.97717, is pixel (357, 465). e = a*x + b*y + c, n = d*x + e*y + f.
PX = 0.582
PX_TO_ENU = (PX, 0.0, -357 * PX, 0.0, -PX, 465 * PX)


def enu(pts):
    a, b, c, d, e, f = PX_TO_ENU
    out = [(a * x + b * y + c, d * x + e * y + f) for x, y in pts]
    # Counter-clockwise for outward normals.
    area = sum(out[i][0] * out[(i + 1) % len(out)][1] - out[(i + 1) % len(out)][0] * out[i][1] for i in range(len(out)))
    return out if area > 0 else out[::-1]


def centre(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def perimeter(pts):
    run = [0.0]
    for i in range(len(pts)):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % len(pts)]
        run.append(run[-1] + math.hypot(x1 - x0, y1 - y0))
    return run


def inset(pts, d):
    return k1.offset(pts, k1.normals(pts), -d)


def lerp2(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


# ---------- traced footprints (satellite pixels) ----------
HALL = [(232, 303), (430, 283), (480, 625), (287, 650)]
ANNEX = [(255, 272), (390, 262), (393, 284), (257, 292)]
WAREHOUSE = [(154, 462), (240, 453), (266, 648), (181, 656)]
ADMIN = [[(244, 118), (330, 112), (345, 165), (250, 170)], [(248, 178), (345, 182), (350, 245), (258, 250)]]
GARDEN = (378, 180, 22)
TOWER = (118, 640)
DOCKS = [(463, 362), (487, 360), (497, 443), (472, 446)]
HAZ = [(488, 490), (508, 489), (511, 519), (491, 520)]
QUA = [(500, 532), (518, 531), (520, 556), (502, 557)]
SCRAP = [(455, 690), (495, 688), (497, 735), (458, 738)]
UTILITY = [(510, 672), (545, 668), (552, 752), (516, 756)]
CARPORT = [(312, 686), (395, 682), (397, 700), (314, 704)]
GATE = (410, 128)
BIKES = [(250, 78), (358, 104), (355, 116), (247, 90)]
CAMPUS = [(105, 10), (200, 40), (420, 110), (455, 240), (500, 480), (560, 620), (560, 780), (470, 790), (300, 730), (150, 690), (20, 615), (120, 330)]
ROADS = [
    [(410, 128), (440, 250), (500, 480), (520, 640), (500, 760)],
    [(205, 255), (250, 650), (300, 720), (480, 715)],
    [(205, 255), (440, 245)],
    [(300, 668), (485, 655)],
]


def solar_roof(m, pts, z, rows=30):
    """Rows of panels across a roof outline, a few left out like the real array."""
    p = pts
    for r in range(rows):
        t0, t1 = (r + .2) / rows, (r + .75) / rows
        a0, a1 = lerp2(p[0], p[3], t0), lerp2(p[1], p[2], t0)
        b0, b1 = lerp2(p[0], p[3], t1), lerp2(p[1], p[2], t1)
        cols = 22
        for c in range(cols):
            if (r * 7 + c * 3) % 9 == 0:
                continue
            u0, u1 = (c + .1) / cols, (c + .9) / cols
            q = [lerp2(a0, a1, u0), lerp2(a0, a1, u1), lerp2(b0, b1, u1), lerp2(b0, b1, u0)]
            m.quad((*q[0], z), (*q[1], z), (*q[2], z + .25), (*q[3], z + .25), [(0, 0), (1, 0), (1, 1), (0, 1)])


def shed(coll, key, px, h, M, roof='roof', wall='clad', band=True, parent=None, label=None):
    pts = enu(px)
    run = perimeter(pts)
    root = parent or bpy.data.objects.new(key, None)
    if not parent:
        coll.objects.link(root)
        if label:
            root['label'] = label
    w, r = k1.Mesh(), k1.Mesh()
    k1.wall(w, pts, run, 0, h - (1.2 if band else 0), u_scale=8)
    r.ngon(pts, h)
    w.obj(f'{key} walls', M[wall], coll, root, smooth=False)
    r.obj(f'{key} roof', M[roof], coll, root, smooth=False)
    if band:
        b = k1.Mesh()
        k1.wall(b, k1.offset(pts, k1.normals(pts), .15), run, h - 1.2, h + .3, u_scale=8)
        b.obj(f'{key} eave band', M['blue'], coll, root, smooth=False)
    return root


def hall(coll, M):
    pts = enu(HALL)
    run = perimeter(pts)
    root = bpy.data.objects.new('main', None)
    coll.objects.link(root)
    H = [0, 8, 14, 16]
    for i in range(3):
        g = bpy.data.objects.new(f'floor_{i}', None)
        coll.objects.link(g)
        g.parent = root
        w, s = k1.Mesh(), k1.Mesh()
        top = H[i + 1] - (1.2 if i == 2 else 0)
        k1.wall(w, pts, run, H[i], top, u_scale=8)
        s.ngon(inset(pts, .3), H[i] + .05)
        w.obj(f'Hall L{i} walls', M['clad'], coll, g, smooth=False)
        s.obj(f'Hall L{i} slab', M['slab'], coll, g, smooth=False)
        if i == 0:
            # Dock doors and a glazed entrance on the north face.
            d = k1.Mesh()
            for t in (.2, .35, .5, .65, .8):
                a, b = lerp2(pts[1], pts[2], t - .03), lerp2(pts[1], pts[2], t + .03)
                nx, ny = k1.normals([pts[1], a, b, pts[2]])[1]
                d.quad((a[0] + nx * .1, a[1] + ny * .1, 0), (b[0] + nx * .1, b[1] + ny * .1, 0), (b[0] + nx * .1, b[1] + ny * .1, 5.5), (a[0] + nx * .1, a[1] + ny * .1, 5.5), [(0, 0), (1, 0), (1, 1), (0, 1)])
            d.obj('Hall dock doors', M['door'], coll, g, smooth=False)
        if i == 2:
            b, r, sol = k1.Mesh(), k1.Mesh(), k1.Mesh()
            k1.wall(b, k1.offset(pts, k1.normals(pts), .15), run, H[3] - 1.2, H[3] + .4, u_scale=8)
            r.ngon(pts, H[3])
            solar_roof(sol, inset(pts, 4), H[3] + .3)
            b.obj('Hall eave band', M['blue'], coll, g, smooth=False)
            r.obj('Hall roof', M['roof'], coll, g, smooth=False)
            sol.obj('Hall solar array', M['solar'], coll, g, smooth=False)
    return root


def tower(coll, M):
    """Test tower: 72 m shaft block with dark glazing strips, cantilevered head, glazed podium."""
    cx, cy = enu([TOWER])[0]
    root = bpy.data.objects.new('tow', None)
    coll.objects.link(root)
    W, D, Ht = 16.0, 12.0, 72.0
    body, glass, head, podium, sign = k1.Mesh(), k1.Mesh(), k1.Mesh(), k1.Mesh(), k1.Mesh()
    k1.box(body, cx, cy, W, D, 0, Ht)
    # Vertical glazing strips on all four faces, as in the photos.
    for side in range(4):
        horiz = side % 2 == 0
        L = W if horiz else D
        sgn = 1 if side < 2 else -1
        for t in (-.32, .05, .3):
            u0, u1 = t * L - .8, t * L + .8
            off = (D if horiz else W) / 2 + .06
            if horiz:
                y = cy + sgn * off
                glass.quad((cx + u0, y, 4), (cx + u1, y, 4), (cx + u1, y, Ht - 9), (cx + u0, y, Ht - 9), [(0, 0), (.2, 0), (.2, 6), (0, 6)])
            else:
                x = cx + sgn * off
                glass.quad((x, cy + u0, 4), (x, cy + u1, 4), (x, cy + u1, Ht - 9), (x, cy + u0, Ht - 9), [(0, 0), (.2, 0), (.2, 6), (0, 6)])
    # Head: the top 9 m steps out on the west side and carries a dark band.
    k1.box(head, cx - 2.5, cy, W + 5, D + 1, Ht - 9, 9)
    hb = k1.Mesh()
    k1.box(hb, cx - 2.5, cy, W + 5.2, D + 1.2, Ht - 6.5, 2.6)
    k1.box(sign, cx, cy, 7, 2, Ht, 2.4)
    k1.box(podium, cx + W / 2 + 6, cy - 1, 14, 16, 0, 7.5)
    body.obj('Tower shaft block', M['white'], coll, root, smooth=False)
    glass.obj('Tower glazing strips', M['dark glass'], coll, root, smooth=False)
    head.obj('Tower head', M['white'], coll, root, smooth=False)
    hb.obj('Tower head band', M['dark glass'], coll, root, smooth=False)
    sign.obj('Tower KONE sign', M['blue'], coll, root, smooth=False)
    podium.obj('Tower lobby podium', M['glass'], coll, root, smooth=False)
    return root


def admin(coll, M):
    root = bpy.data.objects.new('adm', None)
    coll.objects.link(root)
    for i, (px, floors) in enumerate(zip(ADMIN, (3, 4))):
        pts = enu(px)
        run = perimeter(pts)
        g, r, c = k1.Mesh(), k1.Mesh(), k1.Mesh()
        for f in range(floors):
            k1.wall(g, pts, run, f * 4.2, f * 4.2 + 4.2)
        for f in range(1, floors + 1):
            k1.wall(c, k1.offset(pts, k1.normals(pts), .5), run, f * 4.2 - .5, f * 4.2, u_scale=6)
        r.ngon(pts, floors * 4.2)
        # Roof overhang over the top floor, as on the street front.
        k1.wall(c, k1.offset(pts, k1.normals(pts), 2.2), run, floors * 4.2, floors * 4.2 + .6, u_scale=6)
        c.ngon(k1.offset(pts, k1.normals(pts), 2.2), floors * 4.2 + .6)
        for (fx, fy) in ((.3, .4), (.7, .6)):
            p = lerp2(lerp2(pts[0], pts[1], fx), lerp2(pts[3], pts[2], fx), fy)
            k1.box(r, p[0], p[1], 6, 4, floors * 4.2 + .6, 2.4)
        g.obj(f'Admin block {i + 1} glazing', M['glass'], coll, root, smooth=False)
        c.obj(f'Admin block {i + 1} frame', M['white'], coll, root, smooth=False)
        r.obj(f'Admin block {i + 1} roof', M['roof'], coll, root, smooth=False)
    return root


def yard(coll, key, px, M, label=None):
    pts = enu(px)
    run = perimeter(pts)
    root = bpy.data.objects.new(key, None)
    coll.objects.link(root)
    pad, fence, crates = k1.Mesh(), k1.Mesh(), k1.Mesh()
    pad.ngon(pts, .15)
    k1.wall(fence, pts, run, .15, 2.2, u_scale=3)
    cx, cy = centre(pts)
    for i in range(9):
        a = i * 2.4
        k1.box(crates, cx + math.cos(a) * 6 * (i % 3) / 2, cy + math.sin(a) * 9 * (i % 3) / 2, 3.2, 2.2, .15, 1.6 + (i % 3) * .5)
    pad.obj(f'{key} pad', M['slab'], coll, root, smooth=False)
    fence.obj(f'{key} fence', M['fence'], coll, root, smooth=False)
    crates.obj(f'{key} crates', M['crate'], coll, root, smooth=False)
    return root


def campus(coll, M):
    root = bpy.data.objects.new('campus', None)
    coll.objects.link(root)
    root['label'] = 'Campus'
    pave, road, lawn, gate, bikes, carport, sol = (k1.Mesh() for _ in range(7))
    pave.ngon(enu(CAMPUS), .08, scale=8)
    for line in ROADS:
        p = [(PX_TO_ENU[0] * x + PX_TO_ENU[2], PX_TO_ENU[4] * y + PX_TO_ENU[5]) for x, y in line]
        for (x0, y0), (x1, y1) in zip(p, p[1:]):
            l = math.hypot(x1 - x0, y1 - y0)
            nx, ny = -(y1 - y0) / l * 4, (x1 - x0) / l * 4
            road.quad((x0 + nx, y0 + ny, .12), (x0 - nx, y0 - ny, .12), (x1 - nx, y1 - ny, .12), (x1 + nx, y1 + ny, .12), [(0, 0), (1, 0), (1, l / 8), (0, l / 8)])
    gx, gy, gr = GARDEN
    (cx, cy), = enu([(gx, gy)])
    r = gr * abs(PX_TO_ENU[0])
    ring = [(cx + r * math.cos(2 * math.pi * i / 48), cy + r * math.sin(2 * math.pi * i / 48)) for i in range(48)]
    lawn.ngon(ring, .2)
    k1.wall(lawn, ring, perimeter(ring), .1, .45, u_scale=4)
    (gx, gy), = enu([GATE])
    for dx in (-7, 7):
        k1.box(gate, gx + dx, gy, 1.2, 1.2, 0, 4.5)
    k1.box(gate, gx, gy, 16, 1.4, 4.5, 1.1)
    k1.box(gate, gx + 12, gy - 4, 5, 4, 0, 3)
    bp = enu(BIKES)
    k1.wall(bikes, bp, perimeter(bp), 2.8, 3.2, u_scale=6)
    bikes.ngon(bp, 3.2)
    cp = enu(CARPORT)
    carport.ngon(cp, 3.4)
    k1.wall(carport, cp, perimeter(cp), 3.0, 3.4, u_scale=6)
    solar_roof(sol, cp, 3.45, rows=3)
    pave.obj('Campus paving', M['paving'], coll, root, smooth=False)
    road.obj('Campus roads', M['asphalt'], coll, root, smooth=False)
    lawn.obj('Entrance garden', M['green'], coll, root, smooth=False)
    gate.obj('Main gate and security', M['white'], coll, root, smooth=False)
    bikes.obj('Two-wheeler shed', M['clad'], coll, root, smooth=False)
    carport.obj('Car port', M['clad'], coll, root, smooth=False)
    sol.obj('Car port solar', M['solar'], coll, root, smooth=False)
    return root


def cells(x, y):
    """Solar module texture: dark blue cells with silver gaps."""
    if x % 32 < 2 or y % 32 < 2:
        return (0.55, 0.57, 0.6)
    return (0.05, 0.09, 0.2)


def ribs(x, y):
    """Insulated metal cladding: white with vertical ribs every metre."""
    v = 0.88 if x % 32 < 3 else 0.95
    return (v, v, v * 0.99)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    kone = bpy.data.collections.new('KONE')
    bpy.context.scene.collection.children.link(kone)
    os.makedirs(sfo.BLENDS, exist_ok=True)
    M = {
        'clad': k1.textured('ISU cladding', k1.image('ISU cladding', 256, 64, ribs), 0.5, 0.2),
        'solar': k1.textured('ISU solar', k1.image('ISU solar', 128, 128, cells), 0.25, 0.4),
        'roof': sfo.material('ISU roof', (0.78, 0.78, 0.76, 1), 0.6, 0.3),
        'slab': sfo.material('ISU slab', (0.6, 0.6, 0.58, 1), 0.9, 0.0),
        'blue': sfo.material('KONE blue', (0.007, 0.08, 0.9, 1), 0.4, 0.1),
        'door': sfo.material('ISU dock doors', (0.35, 0.37, 0.4, 1), 0.5, 0.5),
        'white': sfo.material('ISU white panels', (0.9, 0.9, 0.89, 1), 0.45, 0.05),
        'dark glass': sfo.material('ISU dark glazing', (0.02, 0.04, 0.07, 1), 0.08, 0.7),
        'glass': k1.textured('ISU blue glazing', k1.image('Kosmo curtain wall', 512, 256, k1.curtain), 0.1, 0.6, emit=k1.image('Kosmo lit windows', 512, 256, k1.lit)),
        'fence': sfo.material('ISU fence', (0.5, 0.52, 0.55, 1), 0.6, 0.6),
        'crate': sfo.material('ISU crates', (0.55, 0.42, 0.26, 1), 0.8, 0.0),
        'paving': k1.textured('ISU paving', k1.image('Kosmo paving', 256, 256, k1.paving), 0.9, 0.0),
        'asphalt': sfo.material('ISU asphalt', (0.12, 0.12, 0.13, 1), 0.95, 0.0),
        'green': sfo.material('ISU lawn', (0.14, 0.32, 0.09, 1), 0.95, 0.0),
    }
    hall(kone, M)
    tower(kone, M)
    admin(kone, M)
    shed(kone, 'wh', WAREHOUSE, 13, M)
    shed(kone, 'annex', ANNEX, 9, M, label='Hall annex')
    shed(kone, 'utility', UTILITY, 7, M, band=False, label='Utility block')
    shed(kone, 'stg', DOCKS, 8, M)
    shed(kone, 'haz', HAZ, 5, M, band=False)
    yard(kone, 'qua', QUA, M)
    yard(kone, 'scr', SCRAP, M)
    campus(kone, M)
    path = os.path.join(sfo.BLENDS, 'isu.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print('saved', os.path.relpath(path, sfo.ROOT))
    sfo.export(next(s for s in sfo.SITES if s['id'] == 'isu'))


if __name__ == '__main__':
    main()
