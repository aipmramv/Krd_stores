"""Model Kosmo One (One Indiabulls Park), Ambattur, for the KTEC Chennai site and export it.

  python blender/kosmo_one.py

Builds blender/sites/ktec.blend with both towers in the KONE collection and exports them with
site_from_osm.export. Tower B (east, KTEC) is `main`, with floors grouped as floor_0..floor_2;
Tower A (west) is `twa`. Shapes and sizes are read off satellite and street photos: glass skins
wrapped in wavy horizontal aluminium louvres, rounded plans, flat roofs with plant, and a barrel
rooflight on Tower B. Coordinates are metres, X east, Y north, Z up, origin at the site centre.
"""
import math
import os
import sys

import bpy  # noqa: F401 - imported before site_from_osm so bpy is ready

sys.path.insert(0, os.path.dirname(__file__))
import site_from_osm as sfo  # noqa: E402

FH, FLOORS = 4.2, 14
TOWERS = {  # centre, half sizes, superellipse exponent, louvre wave phase
    'twa': dict(c=(-68, 0), a=72, b=31, n=3.0, phase=0.0, name='Tower A'),
    'main': dict(c=(68, 0), a=48, b=37, n=3.6, phase=1.3, name='Tower B'),
}
GROUPS = [range(0, 5), range(5, 10), range(10, FLOORS)]  # matches the three floor bands in sites.ts


def plan(t, N=180):
    """Superellipse outline, counter-clockwise, with cumulative arc length."""
    cx, cy = t['c']
    pts = []
    for i in range(N):
        th = 2 * math.pi * i / N
        c, s = math.cos(th), math.sin(th)
        pts.append((cx + t['a'] * math.copysign(abs(c) ** (2 / t['n']), c), cy + t['b'] * math.copysign(abs(s) ** (2 / t['n']), s)))
    run, acc = [0.0], 0.0
    for i in range(N):
        (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % N]
        acc += math.hypot(x1 - x0, y1 - y0)
        run.append(acc)
    return pts, run


def normals(pts):
    n = len(pts)
    out = []
    for i in range(n):
        (x0, y0), (x1, y1) = pts[i - 1], pts[(i + 1) % n]
        dx, dy = x1 - x0, y1 - y0
        l = math.hypot(dx, dy) or 1
        out.append((dy / l, -dx / l))  # outward for a counter-clockwise ring
    return out


class Mesh:
    def __init__(self):
        self.v, self.f, self.uv = [], [], []

    def quad(self, a, b, c, d, uvs):
        i = len(self.v)
        self.v += [a, b, c, d]
        self.f.append((i, i + 1, i + 2, i + 3))
        self.uv.append(uvs)

    def ngon(self, pts, z, flip=False):
        i = len(self.v)
        self.v += [(x, y, z) for x, y in pts]
        idx = list(range(i, i + len(pts)))
        self.f.append(tuple(idx[::-1] if flip else idx))
        self.uv.append([(x / 20, y / 20) for x, y in (pts[::-1] if flip else pts)])

    def obj(self, name, mat, coll, parent=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        layer = me.uv_layers.new(name='UVMap')
        k = 0
        for poly, uvs in zip(me.polygons, self.uv):
            for li, uv in zip(poly.loop_indices, uvs):
                layer.data[li].uv = uv
            k += 1
        me.materials.append(mat)
        for p in me.polygons:
            p.use_smooth = True
        me.validate()
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob.parent = parent
        return ob


def band(m, pts, run, z0, z1, off=0.0, nrm=None, u_scale=12.0):
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        (x0, y0), (x1, y1) = pts[i], pts[j]
        if off:
            x0, y0 = x0 + nrm[i][0] * off, y0 + nrm[i][1] * off
            x1, y1 = x1 + nrm[j][0] * off, y1 + nrm[j][1] * off
        u0, u1 = run[i] / u_scale, run[i + 1] / u_scale
        m.quad((x0, y0, z0), (x1, y1, z0), (x1, y1, z1), (x0, y0, z1), [(u0, 0), (u1, 0), (u1, 1), (u0, 1)])


def louvre(m, pts, nrm, run, z, depth, th=0.28):
    """A horizontal aluminium fin whose depth varies around the building (the wavy bands)."""
    n = len(pts)
    ring_in = [(x - nx * .05, y - ny * .05) for (x, y), (nx, ny) in zip(pts, nrm)]
    ring_out = [(x + nx * depth(i), y + ny * depth(i)) for i, ((x, y), (nx, ny)) in enumerate(zip(pts, nrm))]
    for i in range(n):
        j = (i + 1) % n
        a, b, c, d = ring_in[i], ring_in[j], ring_out[j], ring_out[i]
        u0, u1 = run[i] / 10, run[i + 1] / 10
        m.quad((*a, z + th), (*d, z + th), (*c, z + th), (*b, z + th), [(u0, 0), (u0, 1), (u1, 1), (u1, 0)])  # top
        m.quad((*a, z), (*b, z), (*c, z), (*d, z), [(u0, 0), (u1, 0), (u1, 1), (u0, 1)])  # underside
        m.quad((*d, z), (*c, z), (*c, z + th), (*d, z + th), [(u0, 0), (u1, 0), (u1, .1), (u0, .1)])  # nose


def glass_image():
    """Curtain-wall texture: 8 panels of 1.5 m across one 4.2 m floor, with spandrel and mullions."""
    W, H = 512, 256
    img = bpy.data.images.new('Kosmo curtain wall', W, H, alpha=False)
    px = []
    for y in range(H):
        v = y / H
        for x in range(W):
            if x % 64 < 4 or y < 5:
                c = (0.78, 0.80, 0.82)  # mullion and transom
            elif v < 0.2:
                c = (0.10, 0.15, 0.18)  # spandrel
            else:
                g = (v - 0.2) / 0.8
                tint = 0.92 + 0.08 * math.sin(x / 64 * 2.1)
                c = ((0.16 + 0.18 * g) * tint, (0.30 + 0.20 * g) * tint, (0.34 + 0.22 * g) * tint)
            px += [*c, 1.0]
    img.pixels = px
    path = os.path.join(sfo.BLENDS, 'kosmo_glass.png')
    os.makedirs(sfo.BLENDS, exist_ok=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def glass_material(img):
    m = bpy.data.materials.new('Kosmo glass')
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    nt.links.new(tex.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.12
    p.inputs['Metallic'].default_value = 0.55
    return m


def tower(key, t, coll, mats):
    pts, run = plan(t)
    nrm = normals(pts)
    root = bpy.data.objects.new(key, None)
    coll.objects.link(root)
    P = run[-1]
    groups = GROUPS if key == 'main' else [range(FLOORS)]
    for gi, floors in enumerate(groups):
        parent = root
        if key == 'main':
            parent = bpy.data.objects.new(f'floor_{gi}', None)
            coll.objects.link(parent)
            parent.parent = root
        glass, fins, slab = Mesh(), Mesh(), Mesh()
        for j in floors:
            z0 = j * FH
            # Ground floor sits a little inside the louvres, as a lobby under the first band.
            band(glass, pts, run, z0, z0 + FH, off=-1.2 if j == 0 else 0, nrm=nrm)
            wave = lambda i, j=j: 0.3 + 2.6 * (0.5 + 0.5 * math.sin(2 * math.pi * run[i] / P * 3 + j * 0.55 + t['phase'])) ** 3
            louvre(fins, pts, nrm, run, z0 + FH - 0.3, wave)
            slab.ngon([(x - nx * .3, y - ny * .3) for (x, y), (nx, ny) in zip(pts, nrm)], z0 + 0.02)
        name = f'{t["name"]} · floors {floors[0] + 1}–{floors[-1] + 1}'
        glass.obj(f'{key} glass {gi}', mats['glass'], coll, parent).name = name + ' glass'
        fins.obj(f'{key} louvres {gi}', mats['fins'], coll, parent).name = name + ' louvres'
        slab.obj(f'{key} slabs {gi}', mats['roof'], coll, parent).name = name + ' slabs'
    # Roof: deck, parapet, plant and (Tower B) the barrel rooflight.
    top = FLOORS * FH
    roof = Mesh()
    roof.ngon(pts, top)
    band(roof, pts, run, top, top + 1.4, u_scale=10)
    inner = [(x - nx * .35, y - ny * .35) for (x, y), (nx, ny) in zip(pts, nrm)]
    band(roof, inner[::-1], [0.0] + [r for r in run[1:]], top, top + 1.4, u_scale=10)
    cx, cy = t['c']
    boxes = [(-.35, .25, 9, 6, 3), (.3, -.3, 12, 7, 3.5), (-.1, -.45, 6, 6, 2.5), (.45, .35, 8, 5, 3)]
    for fx, fy, w, d, h in boxes:
        bx, by = cx + fx * t['a'], cy + fy * t['b']
        ring = [(bx - w / 2, by - d / 2), (bx + w / 2, by - d / 2), (bx + w / 2, by + d / 2), (bx - w / 2, by + d / 2)]
        band(roof, ring, [0, w, w + d, 2 * w + d, 2 * w + 2 * d], top, top + h, u_scale=10)
        roof.ngon(ring, top + h)
    parent = bpy.data.objects.get('floor_2') if key == 'main' else root
    roof.obj(f'{key} roof', mats['roof'], coll, parent).name = f'{t["name"]} roof'
    if key == 'main':
        vault = Mesh()
        L, R, S = 30, 5, 16
        x0, y0 = cx - 4, cy + 6
        for i in range(S):
            a0, a1 = math.pi * i / S, math.pi * (i + 1) / S
            p0 = (y0 + R * math.cos(a0), top + R * math.sin(a0) * .9)
            p1 = (y0 + R * math.cos(a1), top + R * math.sin(a1) * .9)
            vault.quad((x0 - L / 2, p0[0], p0[1]), (x0 + L / 2, p0[0], p0[1]), (x0 + L / 2, p1[0], p1[1]), (x0 - L / 2, p1[0], p1[1]),
                       [(0, i / S), (2.5, i / S), (2.5, (i + 1) / S), (0, (i + 1) / S)])
        vault.obj('main rooflight', mats['glass'], coll, parent).name = 'Tower B rooflight'
    return root


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    kone = bpy.data.collections.new('KONE')
    bpy.context.scene.collection.children.link(kone)
    mats = {
        'glass': glass_material(glass_image()),
        'fins': sfo.material('Kosmo louvres', (0.80, 0.82, 0.84, 1), 0.35, 0.7),
        'roof': sfo.material('Kosmo roof', (0.52, 0.52, 0.50, 1), 0.85, 0.0),
    }
    for key, t in TOWERS.items():
        tower(key, t, kone, mats)
    path = os.path.join(sfo.BLENDS, 'ktec.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path)
    print('saved', os.path.relpath(path, sfo.ROOT))
    sfo.export(next(s for s in sfo.SITES if s['id'] == 'ktec'))


if __name__ == '__main__':
    main()
