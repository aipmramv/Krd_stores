"""Model Kosmo One (One Indiabulls Park), Ambattur, for the KTEC Chennai site and export it.

  python blender/kosmo_one.py

Builds blender/sites/ktec.blend and exports it with site_from_osm.export:
- `main`  Tower B (west, KTEC): ground + 12 floors, one group per level (floor_0 = ground …
          floor_12), so the app can open any floor. Glass skin wrapped in wavy aluminium louvres
          with an undulating crown, and a vaulted entrance canopy on the road (north) side.
- `twa`   Tower A (east): ground + 12 floors as one piece, straight louvres, barrel rooflight.
- `plaza` Paving, planters and the basement ramp around both towers.

Sizes come from satellite and street photos scaled to the published floor plate (Block B about
50,000 sq ft per floor, 3 basements + ground + 12 floors). Coordinates are metres, X east, Y north,
Z up, origin at the site centre (13.09220, 80.16336). The plan outline and floor heights are stored
on the root object (exported as glTF extras) so the app can furnish a floor when it is opened.
"""
import json
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import site_from_osm as sfo  # noqa: E402

G_H, FH, UPPER = 5.0, 4.0, 12
LEVEL_Z = [0.0] + [G_H + i * FH for i in range(UPPER)]  # floor level of ground, 1 … 12
TOP = G_H + UPPER * FH
TOWER_B = dict(c=(-54.0, 0.0), a=57.0, b=24.5, n=3.0)
TOWER_A = dict(c=(54.0, 0.0), a=38.0, b=29.5, n=3.6)


# ---------- geometry helpers ----------
def plan(t, N=200, wave=0.0):
    """Superellipse outline, counter-clockwise. `wave` undulates the north face (Tower B)."""
    cx, cy = t['c']
    pts = []
    for i in range(N):
        th = 2 * math.pi * i / N
        c, s = math.cos(th), math.sin(th)
        x = t['a'] * math.copysign(abs(c) ** (2 / t['n']), c)
        y = t['b'] * math.copysign(abs(s) ** (2 / t['n']), s)
        if wave and s > 0:
            y += wave * math.sin(2 * math.pi * (x + t['a']) / 38) * s ** 2
        pts.append((cx + x, cy + y))
    run = [0.0]
    for i in range(N):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % N]
        run.append(run[-1] + math.hypot(x1 - x0, y1 - y0))
    return pts, run


def normals(pts):
    out = []
    n = len(pts)
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i - 1], pts[(i + 1) % n]
        l = math.hypot(x1 - x0, y1 - y0) or 1
        out.append(((y1 - y0) / l, -(x1 - x0) / l))
    return out


def offset(pts, nrm, d):
    return [(x + nx * d, y + ny * d) for (x, y), (nx, ny) in zip(pts, nrm)]


class Mesh:
    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def quad(self, a, b, c, d, uvs):
        i = len(self.v)
        self.v += [a, b, c, d]
        self.f.append((i, i + 1, i + 2, i + 3))
        self.uv.append(uvs)

    def ngon(self, pts, z, flip=False, scale=20):
        i = len(self.v)
        ring = pts[::-1] if flip else pts
        self.v += [(x, y, z) for x, y in ring]
        self.f.append(tuple(range(i, i + len(ring))))
        self.uv.append([(x / scale, y / scale) for x, y in ring])

    def obj(self, name, mat, coll, parent=None, smooth=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        layer = me.uv_layers.new(name='UVMap')
        for poly, uvs in zip(me.polygons, self.uv):
            for li, uv in zip(poly.loop_indices, uvs):
                layer.data[li].uv = uv
            poly.use_smooth = smooth
        me.materials.append(mat)
        me.validate()
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob.parent = parent
        return ob


def wall(m, pts, run, z0, z1, u_scale=12.0):
    """Vertical band; z0 and z1 may be numbers or per-vertex functions."""
    n = len(pts)
    f0 = z0 if callable(z0) else (lambda i: z0)
    f1 = z1 if callable(z1) else (lambda i: z1)
    for i in range(n):
        j = (i + 1) % n
        (x0, y0), (x1, y1) = pts[i], pts[j]
        u0, u1 = run[i] / u_scale, run[i + 1] / u_scale
        m.quad((x0, y0, f0(i)), (x1, y1, f0(j)), (x1, y1, f1(j)), (x0, y0, f1(i)), [(u0, 0), (u1, 0), (u1, 1), (u0, 1)])


def fin(m, pts, nrm, run, z, depth, th=0.3):
    """Horizontal aluminium louvre; `z` and `depth` are per-vertex functions."""
    n = len(pts)
    inner = [(x - nx * .05, y - ny * .05) for (x, y), (nx, ny) in zip(pts, nrm)]
    outer = [(x + nx * depth(i), y + ny * depth(i)) for i, ((x, y), (nx, ny)) in enumerate(zip(pts, nrm))]
    for i in range(n):
        j = (i + 1) % n
        a, b, c, d = inner[i], inner[j], outer[j], outer[i]
        za, zb = z(i), z(j)
        u0, u1 = run[i] / 10, run[i + 1] / 10
        m.quad((*a, za + th), (*d, za + th), (*c, zb + th), (*b, zb + th), [(u0, 0), (u0, 1), (u1, 1), (u1, 0)])
        m.quad((*a, za), (*b, zb), (*c, zb), (*d, za), [(u0, 0), (u1, 0), (u1, 1), (u0, 1)])
        m.quad((*d, za), (*c, zb), (*c, zb + th), (*d, za + th), [(u0, 0), (u1, 0), (u1, .1), (u0, .1)])


def box(m, cx, cy, w, d, z0, h):
    ring = [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]
    wall(m, ring, [0, w, w + d, 2 * w + d, 2 * w + 2 * d], z0, z0 + h, u_scale=4)
    m.ngon(ring, z0 + h, scale=4)


def vault(m, x0, x1, yc, r, z0, rise=1.0, S=18, axis='x'):
    """Half-cylinder shell (barrel rooflight or entrance canopy)."""
    for i in range(S):
        a0, a1 = math.pi * i / S, math.pi * (i + 1) / S
        p0 = (yc + r * math.cos(a0), z0 + r * math.sin(a0) * rise)
        p1 = (yc + r * math.cos(a1), z0 + r * math.sin(a1) * rise)
        uv = [(0, i / S), (abs(x1 - x0) / 6, i / S), (abs(x1 - x0) / 6, (i + 1) / S), (0, (i + 1) / S)]
        if axis == 'x':
            m.quad((x0, p0[0], p0[1]), (x1, p0[0], p0[1]), (x1, p1[0], p1[1]), (x0, p1[0], p1[1]), uv)
        else:
            m.quad((p0[0], x0, p0[1]), (p1[0], x0, p1[1]), (p1[0], x1, p1[1]), (p0[0], x1, p0[1]), uv)


# ---------- materials ----------
def image(name, W, H, fn):
    img = bpy.data.images.new(name, W, H, alpha=False)
    px = []
    for y in range(H):
        for x in range(W):
            px += [*fn(x, y), 1.0]
    img.pixels = px
    path = os.path.join(sfo.BLENDS, name.lower().replace(' ', '_') + '.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def curtain(x, y, W=512, H=256):
    """8 panels of 1.5 m across one floor: mullions, spandrel band, sky-tinted glazing."""
    v = y / H
    if x % 64 < 3 or y < 4:
        return (0.80, 0.82, 0.84)
    if v < 0.18:
        return (0.12, 0.16, 0.19)
    g = (v - 0.18) / 0.82
    k = 0.9 + 0.1 * math.sin(x / 64 * 2.3)
    return ((0.20 + 0.20 * g) * k, (0.33 + 0.22 * g) * k, (0.38 + 0.24 * g) * k)


def lit(x, y, W=512, H=256):
    """Night glow: most panels lit warm white, some dark, none on the spandrel."""
    if y / H < 0.2 or x % 64 < 3:
        return (0, 0, 0)
    on = math.sin((x // 64) * 12.9898 + 7.1) * 43758.5453 % 1
    return (0.95, 0.86, 0.66) if on > .35 else (0.05, 0.05, 0.06)


def paving(x, y, W=256, H=256):
    j = x % 64 < 2 or y % 64 < 2
    n = (math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1
    base = 0.62 + 0.05 * n
    return (base * .8, base * .78, base * .74) if j else (base, base * .97, base * .92)


def textured(name, img, rough, metal, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    nt.links.new(t.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        e = nt.nodes.new('ShaderNodeTexImage')
        e.image = emit
        nt.links.new(e.outputs['Color'], p.inputs['Emission Color'])
        p.inputs['Emission Strength'].default_value = 1.0
    return m


# ---------- towers ----------
def tower_b(coll, M):
    pts, run = plan(TOWER_B, wave=2.6)
    nrm = normals(pts)
    P = run[-1]
    root = bpy.data.objects.new('main', None)
    coll.objects.link(root)
    inner = offset(pts, nrm, -0.35)
    root['plan'] = json.dumps([[round(x, 2), round(y, 2)] for x, y in inner[::2]])
    root['levels'] = json.dumps(LEVEL_Z + [TOP])
    root['label'] = 'Tower B'
    for lv in range(UPPER + 1):
        z0, z1 = LEVEL_Z[lv], (LEVEL_Z[lv + 1] if lv < UPPER else TOP)
        grp = bpy.data.objects.new(f'floor_{lv}', None)
        coll.objects.link(grp)
        grp.parent = root
        glass, fins, slab = Mesh(), Mesh(), Mesh()
        if lv == 0:
            # Recessed double-height lobby behind the first louvre.
            lobby = offset(pts, nrm, -2.0)
            wall(glass, lobby, run, 0.0, z1)
            slab.ngon(lobby, 0.05)
        else:
            wall(glass, pts, run, z0, z1)
            slab.ngon(inner, z0 + 0.05)
        # The louvre at the top of this level rises and falls around the building, like the
        # bands on the real facade; higher floors wave a little more.
        amp = 0.35 + 0.07 * lv
        z = lambda i, lv=lv, amp=amp: z1 - 0.5 + amp * math.sin(2 * math.pi * run[i] / P * 5 + lv * 0.33)
        fins_depth = lambda i, lv=lv: 0.75 + 0.55 * (0.5 + 0.5 * math.sin(2 * math.pi * run[i] / P * 3 + lv * 0.5))
        fin(fins, pts, nrm, run, z, fins_depth)
        glass.obj(f'Tower B L{lv} glass', M['glass'], coll, grp)
        fins.obj(f'Tower B L{lv} louvres', M['fins'], coll, grp)
        slab.obj(f'Tower B L{lv} slab', M['slab'], coll, grp, smooth=False)
    # Crown: a louvre-clad parapet whose top undulates, over a flat roof with plant.
    crown, roof = Mesh(), Mesh()
    ztop = lambda i: TOP + 2.6 + 1.6 * math.sin(2 * math.pi * run[i] / P * 3 + 0.8)
    wall(crown, offset(pts, nrm, 0.4), run, TOP - 0.2, ztop, u_scale=10)
    wall(crown, offset(pts, nrm, 0.1)[::-1], run, TOP, lambda i: ztop(len(pts) - 1 - i) - 0.3, u_scale=10)
    roof.ngon(inner, TOP)
    cx, cy = TOWER_B['c']
    for fx, fy, w, d, h in [(-.55, .1, 10, 7, 3.2), (-.2, -.2, 14, 8, 3.6), (.2, .25, 9, 6, 2.8), (.55, -.1, 12, 7, 3.4), (0, .05, 6, 6, 5)]:
        box(roof, cx + fx * TOWER_B['a'], cy + fy * TOWER_B['b'], w, d, TOP, h)
    top_grp = bpy.data.objects['floor_12']
    crown.obj('Tower B crown', M['fins'], coll, top_grp)
    roof.obj('Tower B roof', M['roof'], coll, top_grp, smooth=False)
    # Vaulted entrance canopy on the road side.
    can = Mesh()
    vault(can, cy + TOWER_B['b'] - 3, cy + TOWER_B['b'] + 12, cx + 6, 9, 0, rise=0.75, axis='y')
    can.obj('Tower B entrance canopy', M['canopy'], coll, bpy.data.objects['floor_0'])
    return root


def tower_a(coll, M):
    pts, run = plan(TOWER_A)
    nrm = normals(pts)
    root = bpy.data.objects.new('twa', None)
    coll.objects.link(root)
    root['label'] = 'Tower A'
    glass, fins, roof = Mesh(), Mesh(), Mesh()
    wall(glass, offset(pts, nrm, -1.8), run, 0.0, G_H)
    wall(glass, pts, run, G_H, TOP)
    for lv in range(1, UPPER + 1):
        z = LEVEL_Z[lv + 1] - 0.5 if lv < UPPER else TOP - 0.5
        fin(fins, pts, nrm, run, lambda i, z=z: z, lambda i: 1.0)
    fin(fins, pts, nrm, run, lambda i: G_H - 0.5, lambda i: 1.0)
    wall(fins, offset(pts, nrm, 0.3), run, TOP - 0.2, TOP + 1.8, u_scale=10)
    roof.ngon(offset(pts, nrm, -0.3), TOP)
    cx, cy = TOWER_A['c']
    for fx, fy, w, d, h in [(-.4, -.5, 8, 6, 3), (.45, -.45, 10, 6, 3.2), (.5, .45, 7, 6, 2.6)]:
        box(roof, cx + fx * TOWER_A['a'], cy + fy * TOWER_A['b'], w, d, TOP, h)
    glass.obj('Tower A glass', M['glass'], coll, root)
    fins.obj('Tower A louvres', M['fins'], coll, root)
    roof.obj('Tower A roof', M['roof'], coll, root, smooth=False)
    sky = Mesh()
    vault(sky, cx - 12, cx + 18, cy + 6, 5, TOP, rise=0.9)
    sky.obj('Tower A rooflight', M['glass'], coll, root)
    return root


def plaza(coll, M):
    root = bpy.data.objects.new('plaza', None)
    coll.objects.link(root)
    root['label'] = 'Plaza'
    pave, green, ramp = Mesh(), Mesh(), Mesh()
    pave.ngon([(-122, -38), (102, -38), (102, 50), (-122, 50)], 0.12, scale=8)
    # Planters and hedges on the north plaza, as seen from above.
    for x0, x1, y in [(-112, -78, 38), (-70, -30, 40), (-22, 14, 42), (24, 60, 38), (70, 96, 40)]:
        box(green, (x0 + x1) / 2, y, x1 - x0, 3.2, 0.12, 0.9)
    for x, y in [(-100, -32), (-60, -33), (-20, -33), (30, -33), (80, -34)]:
        box(green, x, y, 8, 3, 0.12, 0.7)
    # Ramp down to the basements between the towers.
    ramp.quad((-6, 46, 0.14), (6, 46, 0.14), (6, 30, -4.5), (-6, 30, -4.5), [(0, 0), (1, 0), (1, 3), (0, 3)])
    wall(ramp, [(-6.4, 30), (-6.4, 46), (6.4, 46), (6.4, 30)], [0, 16, 28.8, 44.8, 57.6], 0.12, 1.1, u_scale=4)
    pave.obj('Plaza paving', M['paving'], coll, root, smooth=False)
    green.obj('Plaza planters', M['green'], coll, root, smooth=False)
    ramp.obj('Basement ramp', M['slab'], coll, root, smooth=False)
    return root


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    kone = bpy.data.collections.new('KONE')
    bpy.context.scene.collection.children.link(kone)
    os.makedirs(sfo.BLENDS, exist_ok=True)
    M = {
        'glass': textured('Kosmo curtain wall', image('Kosmo curtain wall', 512, 256, curtain), 0.1, 0.6, emit=image('Kosmo lit windows', 512, 256, lit)),
        'fins': sfo.material('Kosmo louvres', (0.86, 0.87, 0.88, 1), 0.3, 0.75),
        'roof': sfo.material('Kosmo roof', (0.55, 0.55, 0.53, 1), 0.85, 0.0),
        'slab': sfo.material('Kosmo slab', (0.62, 0.62, 0.60, 1), 0.9, 0.0),
        'canopy': sfo.material('Kosmo canopy', (0.93, 0.93, 0.92, 1), 0.35, 0.2),
        'paving': textured('Kosmo paving', image('Kosmo paving', 256, 256, paving), 0.9, 0.0),
        'green': sfo.material('Kosmo planting', (0.16, 0.30, 0.10, 1), 0.9, 0.0),
    }
    tower_b(kone, M)
    tower_a(kone, M)
    plaza(kone, M)
    path = os.path.join(sfo.BLENDS, 'ktec.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print('saved', os.path.relpath(path, sfo.ROOT))
    sfo.export(next(s for s in sfo.SITES if s['id'] == 'ktec'))


if __name__ == '__main__':
    main()
