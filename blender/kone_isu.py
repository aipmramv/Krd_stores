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
BIKES = [(425, 128), (482, 140), (480, 151), (423, 139)]
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


class Frame:
    """Local building axes from a traced quad: u along the long side, v towards its front (north)."""

    def __init__(self, px):
        a, b, c, d, e, f = PX_TO_ENU
        q = [(a * x + c, e * y + f) for x, y in px]
        self.o = centre(q)
        ux, uy = q[1][0] - q[0][0], q[1][1] - q[0][1]
        self.W = math.hypot(ux, uy)
        self.u = (ux / self.W, uy / self.W)
        self.v = (-self.u[1], self.u[0])
        self.D = math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1])

    def __call__(self, u, v):
        return (self.o[0] + self.u[0] * u + self.v[0] * v, self.o[1] + self.u[1] * u + self.v[1] * v)

    def pts(self, local):
        return [self(u, v) for u, v in local]

    def box(self, m, u, v, w, d, z0, h):
        """Box aligned with the building axes."""
        ring = self.pts([(u - w / 2, v - d / 2), (u + w / 2, v - d / 2), (u + w / 2, v + d / 2), (u - w / 2, v + d / 2)])
        k1.wall(m, ring, [0, w, w + d, 2 * w + d, 2 * w + 2 * d], z0, z0 + h, u_scale=4)
        m.ngon(ring, z0 + h, scale=4)
        m.ngon(ring, z0, flip=True, scale=4)


def admin_plan(F, R=9.0, n=16):
    """Rectangle with the front corner at the curved (east) end rounded, counter-clockwise."""
    W, D = F.W / 2, F.D / 2
    loc = [(-W, -D), (W, -D), (W, D - R)]
    for i in range(1, n):
        a = math.pi / 2 * i / n
        loc.append((W - R + R * math.cos(a), D - R + R * math.sin(a)))
    loc += [(W - R, D), (-W, D)]
    return loc


def admin(coll, M):
    """Admin and training block, after the ISU entrance photo: three storeys of blue glazing between
    white bands, a curved glass corner with white fins, a deep overhanging roof canopy on two round
    columns, a projecting glass box at the front, a white stair tower and a rooftop penthouse,
    with the lawn, kerbs, flagpoles and welcome sign in front."""
    root = bpy.data.objects.new('adm', None)
    coll.objects.link(root)
    F = Frame(ADMIN[0])
    W, D = F.W, F.D
    loc = admin_plan(F)
    plan = F.pts(loc)
    run = perimeter(plan)
    nrm = k1.normals(plan)
    G, L1, L2, TOP = 4.5, 8.7, 12.9, 13.4
    glass, blue, white, fins, metal, roof, pent = (k1.Mesh() for _ in range(7))
    k1.wall(glass, k1.offset(plan, nrm, -0.6), run, 0, G)              # recessed ground floor glazing
    k1.wall(blue, plan, run, G + .8, L1)                                 # first floor ribbon
    k1.wall(blue, plan, run, L1 + .8, L2)                                # second floor ribbon
    for z0, z1 in ((G, G + .8), (L1, L1 + .8), (L2, TOP)):
        k1.wall(white, k1.offset(plan, nrm, .12), run, z0, z1, u_scale=6)
    k1.wall(white, k1.offset(plan, nrm, -0.6), run, 0, .4, u_scale=6)   # plinth
    roof.ngon(plan, TOP)
    # White vertical fins on the curved corner and the east end of the front.
    for (u, v), (nx, ny) in zip(loc, k1.normals(loc)):
        if u > W / 2 - 14 and v > -D / 2 + 3:
            F.box(fins, u + nx * .35, v + ny * .35, .18, .18, 0, L2)
    for u in [W / 2 - 9 - i * 1.4 for i in range(4)]:
        F.box(fins, u, D / 2 + .35, .16, .6, 0, L2)
    # Deep canopy roof with ribs underneath, carried on two round columns at the front.
    can_loc = [(u + nx * 3.2, v + ny * (5.0 if ny > .5 else 2.2)) for (u, v), (nx, ny) in zip(loc, k1.normals(loc))]
    can = F.pts(can_loc)
    metal.ngon(can, TOP + 1.1)
    metal.ngon(can, TOP + .3, flip=True)
    k1.wall(metal, can, perimeter(can), TOP + .3, TOP + 1.1, u_scale=6)
    for i in range(int(W / 2.6)):
        u = -W / 2 + 1.5 + i * 2.6
        F.box(metal, u, D / 2 + 2.4, .25, 5.0, TOP - .2, .5)
    for u in (W * .2, -W * .05):
        c = F(u, D / 2 + 3.4)
        ring = [(c[0] + .65 * math.cos(2 * math.pi * k / 20), c[1] + .65 * math.sin(2 * math.pi * k / 20)) for k in range(20)]
        k1.wall(metal, ring, perimeter(ring), 0, TOP + .3, u_scale=4)
    # Projecting glass box on the front, ground and first floors.
    box_glass = k1.Mesh()
    F.box(box_glass, -W * .02, D / 2 + 1.4, 11, 2.8, .6, L1 - .4)
    F.box(white, -W * .02, D / 2 + 1.4, 11.4, 3.0, L1 - .4, .5)
    # White stair tower at the west end, with a slot window.
    F.box(white, -W / 2 + 3, 0, 6.5, D + .6, 0, TOP + 2.2)
    F.box(fins, -W / 2 + 3, D / 2 + .35, 1.1, .1, 1.5, TOP - .5)
    # Penthouse on the roof.
    F.box(pent, 3, -2, 15, 9, TOP + 1.1, 3.4)
    F.box(blue, 3, -2, 15.2, 9.2, TOP + 2.2, 1.4)
    # Lawn, kerb, flags and welcome sign in front.
    lawn, kerb_y, kerb_k, flags, sign, poles = (k1.Mesh() for _ in range(6))
    lawn_loc = [(-W / 2, D / 2 + 6), (W / 2 + 6, D / 2 + 6), (W / 2 + 6, D / 2 + 15), (-W / 2, D / 2 + 15)]
    lawn.ngon(F.pts(lawn_loc), .18)
    edge = lawn_loc + lawn_loc[:1]
    for (u0, v0), (u1, v1) in zip(edge, edge[1:]):
        L = math.hypot(u1 - u0, v1 - v0)
        for i in range(int(L / .6)):
            t = (i + .5) / int(L / .6)
            u, v = u0 + (u1 - u0) * t, v0 + (v1 - v0) * t
            F.box(kerb_y if i % 2 else kerb_k, u, v, .55 if u1 != u0 else .25, .25 if u1 != u0 else .55, 0, .3)
    for i, u in enumerate((-W * .1, -W * .22, -W * .34)):
        c = F(u, D / 2 + 11)
        ring = [(c[0] + .08 * math.cos(2 * math.pi * k / 8), c[1] + .08 * math.sin(2 * math.pi * k / 8)) for k in range(8)]
        k1.wall(poles, ring, perimeter(ring), 0, 12, u_scale=1)
        a, b2 = F(u, D / 2 + 11), F(u - .1, D / 2 + 11 + 2.2)
        flags.quad((a[0], a[1], 9.6), (b2[0], b2[1], 9.4), (b2[0], b2[1], 11.8), (a[0], a[1], 11.9), [(0, 0), (1, 0), (1, 1), (0, 1)])
    s0, s1 = F(-W / 2 + 6, D / 2 + 14), F(-W / 2 + 9, D / 2 + 14)
    sign.quad((s0[0], s0[1], .3), (s1[0], s1[1], .3), (s1[0], s1[1], 4.2), (s0[0], s0[1], 4.2), [(0, 0), (1, 0), (1, 1), (0, 1)])
    sign.quad((s1[0], s1[1], .3), (s0[0], s0[1], .3), (s0[0], s0[1], 4.2), (s1[0], s1[1], 4.2), [(0, 0), (1, 0), (1, 1), (0, 1)])
    for mesh, name, mat in ((glass, 'ground floor glazing', 'clear glass'), (blue, 'blue glazing', 'glass'), (white, 'white bands', 'white'),
                            (fins, 'fins', 'white'), (metal, 'canopy and columns', 'canopy'), (roof, 'roof', 'roof'), (pent, 'penthouse', 'white'),
                            (box_glass, 'glass box', 'clear glass'), (lawn, 'lawn', 'green'), (kerb_y, 'kerb yellow', 'kerb yellow'),
                            (kerb_k, 'kerb black', 'kerb black'), (poles, 'flagpoles', 'canopy'), (flags, 'KONE flags', 'flag'), (sign, 'welcome sign', 'sign')):
        mesh.obj(f'Admin {name}', M[mat], coll, root, smooth=False)

    # Rear training block: same language, simpler.
    F = Frame(ADMIN[1])
    plan = F.pts([(-F.W / 2, -F.D / 2), (F.W / 2, -F.D / 2), (F.W / 2, F.D / 2), (-F.W / 2, F.D / 2)])
    run = perimeter(plan)
    nrm = k1.normals(plan)
    b2, w2, r2 = k1.Mesh(), k1.Mesh(), k1.Mesh()
    k1.wall(b2, k1.offset(plan, nrm, -0.4), run, 0, 4.2)
    for z0 in (4.2, 8.4):
        k1.wall(w2, k1.offset(plan, nrm, .1), run, z0, z0 + .8, u_scale=6)
        k1.wall(b2, plan, run, z0 + .8, z0 + 4.2)
    k1.wall(w2, k1.offset(plan, nrm, .1), run, 12.6, 13.2, u_scale=6)
    can = k1.offset(plan, nrm, 2.0)
    r2.ngon(plan, 13.2)
    w2.ngon(can, 13.9)
    k1.wall(w2, can, perimeter(can), 13.2, 13.9, u_scale=6)
    for fu, fv in ((-.25, .1), (.25, -.15)):
        F.box(r2, fu * F.W, fv * F.D, 7, 5, 13.9, 2.6)
    b2.obj('Training block glazing', M['glass'], coll, root, smooth=False)
    w2.obj('Training block bands and canopy', M['white'], coll, root, smooth=False)
    r2.obj('Training block roof', M['roof'], coll, root, smooth=False)
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


def blue_glass(x, y, W=512, H=256):
    """Deep blue reflective glazing in 1.5 m panels, as on the admin block."""
    if x % 64 < 3 or y < 4:
        return (0.62, 0.66, 0.7)
    g = y / H
    return (0.02 + 0.06 * g, 0.12 + 0.14 * g, 0.42 + 0.22 * g)


def clear_glass(x, y, W=512, H=256):
    """Lighter, greener ground-floor glazing with the lobby showing through."""
    if x % 64 < 3 or y < 4:
        return (0.7, 0.72, 0.74)
    g = y / H
    lobby = 0.12 if (x // 64) % 3 == 1 and y < H * .6 else 0
    return (0.28 + 0.15 * g + lobby, 0.45 + 0.15 * g + lobby, 0.48 + 0.15 * g + lobby)


def laterite(x, y, W=256, H=256):
    """Red laterite paving with faint joints."""
    n = (math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1
    j = x % 64 < 1 or y % 64 < 1
    b = (0.66 + 0.06 * n) * (0.9 if j else 1)
    return (b, b * 0.62, b * 0.52)


def flag(x, y, W=128, H=96):
    """Pale lilac flag with the KONE blue block."""
    if 14 < x < 70 and 50 < y < 82:
        return (0.08, 0.31, 0.96)
    return (0.86, 0.84, 0.95)


def sign(x, y, W=64, H=96):
    """'Welcome to KONE' board: white with the blue KONE header."""
    if y > 76 and 30 < x < 60:
        return (0.08, 0.31, 0.96)
    if 30 < y < 62 and 8 < x < 56 and (y // 6) % 2 == 0:
        return (0.25, 0.27, 0.3)
    return (0.95, 0.95, 0.95)


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
        'glass': k1.textured('ISU blue glazing', k1.image('ISU blue glazing', 512, 256, blue_glass), 0.12, 0.12, emit=k1.image('Kosmo lit windows', 512, 256, k1.lit)),
        'clear glass': k1.textured('ISU clear glazing', k1.image('ISU clear glazing', 512, 256, clear_glass), 0.08, 0.1, emit=k1.image('Kosmo lit windows', 512, 256, k1.lit)),
        'canopy': sfo.material('ISU canopy metal', (0.42, 0.46, 0.5, 1), 0.3, 0.8),
        'kerb yellow': sfo.material('ISU kerb yellow', (0.85, 0.62, 0.02, 1), 0.7, 0.0),
        'kerb black': sfo.material('ISU kerb black', (0.03, 0.03, 0.03, 1), 0.7, 0.0),
        'flag': k1.textured('KONE flag', k1.image('KONE flag', 128, 96, flag), 0.8, 0.0),
        'sign': k1.textured('Welcome to KONE sign', k1.image('Welcome sign', 64, 96, sign), 0.6, 0.0),
        'fence': sfo.material('ISU fence', (0.5, 0.52, 0.55, 1), 0.6, 0.6),
        'crate': sfo.material('ISU crates', (0.55, 0.42, 0.26, 1), 0.8, 0.0),
        'paving': k1.textured('ISU paving', k1.image('ISU laterite paving', 256, 256, laterite), 0.9, 0.0),
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
