"""Build the Blender-modelled assets for the KTEC Materials Twin site scenes.

Run headless with the `bpy` module (Blender as a Python module):

    python -m venv .venv && .venv/bin/pip install bpy==5.2.2
    .venv/bin/python blender/build_assets.py

or with a Blender install:

    blender --background --python blender/build_assets.py

Writes glTF binaries to app/public/models/. Units are metres; each asset sits on the ground at the
origin. Blender is Z-up; the glTF exporter converts to three.js Y-up, and +X stays the forward axis.
"""
import math
import os

import bpy

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'public', 'models')

KONE_BLUE = (0.007, 0.08, 0.91, 1)  # #1450F5 in linear space
WHITE = (0.85, 0.86, 0.87, 1)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color, rough=0.6, metal=0.0, emission=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = color
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emission:
        p.inputs['Emission Color'].default_value = emission
        p.inputs['Emission Strength'].default_value = 1.0
    return m


def box(name, size, loc, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    o.data.materials.append(material)
    return o


def cyl(name, r, depth, loc, material, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(material)
    bpy.ops.object.shade_smooth()
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def export(name):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f'{name}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=True)
    print('wrote', os.path.relpath(path))


def test_tower():
    """Lift test tower: glazed podium, concrete shaft with a full-height glass strip and a KONE blue crown."""
    reset()
    concrete = mat('Concrete', (0.62, 0.62, 0.6, 1), rough=0.85)
    glass = mat('Glass', (0.05, 0.09, 0.13, 1), rough=0.08, metal=0.7)
    blue = mat('KONE blue', KONE_BLUE, rough=0.35, metal=0.2)
    steel = mat('Steel', (0.5, 0.52, 0.55, 1), rough=0.4, metal=0.9)
    lit = mat('Aviation light', (1, 0.1, 0.05, 1), emission=(1, 0.1, 0.05, 1))
    H = 92.0
    parts = [
        box('Podium', (26, 18, 7), (0, 0, 3.5), glass),
        box('Podium roof', (26.6, 18.6, 0.6), (0, 0, 7.3), concrete),
        box('Shaft', (14, 14, H), (0, 0, H / 2), concrete, bevel=0.15),
        box('Glass strip S', (4.2, 0.3, H - 14), (0, -7.05, (H - 14) / 2 + 8), glass),
        box('Glass strip E', (0.3, 4.2, H - 14), (7.05, 0, (H - 14) / 2 + 8), glass),
        box('Crown', (14.6, 14.6, 7), (0, 0, H - 3.5), blue),
        box('Parapet', (14.8, 14.8, 0.8), (0, 0, H + 0.4), concrete),
        box('Machine room', (8, 8, 4), (0, 0, H + 2), concrete),
        cyl('Mast', 0.25, 10, (0, 0, H + 9), steel, verts=12),
        cyl('Mast light', 0.45, 0.6, (0, 0, H + 14.2), lit, verts=12),
    ]
    # Floor bands every 6 m so the concrete shaft reads at scale.
    for z in range(14, int(H) - 8, 6):
        parts.append(box(f'Band {z}', (14.2, 14.2, 0.3), (0, 0, z), concrete))
    join(parts, 'KONE test tower')
    export('test_tower')


def truck():
    """Indian 32 ft container truck with a KONE blue box. Forward is +X."""
    reset()
    paint = mat('Cab paint', WHITE, rough=0.3, metal=0.4)
    blue = mat('KONE blue', KONE_BLUE, rough=0.45, metal=0.1)
    glass = mat('Windscreen', (0.02, 0.03, 0.05, 1), rough=0.05, metal=0.6)
    rubber = mat('Tyre', (0.02, 0.02, 0.02, 1), rough=0.9)
    chassis = mat('Chassis', (0.08, 0.08, 0.09, 1), rough=0.7, metal=0.5)
    lamp = mat('Lamp', (1, 0.95, 0.8, 1), emission=(1, 0.95, 0.8, 1))
    parts = [
        box('Chassis', (11.6, 2.0, 0.4), (0, 0, 1.0), chassis),
        box('Container', (9.4, 2.5, 2.8), (-1.0, 0, 2.7), blue, bevel=0.04),
        box('Cab', (2.3, 2.45, 2.4), (4.75, 0, 2.3), paint, bevel=0.12),
        box('Windscreen', (0.08, 2.1, 1.0), (5.92, 0, 2.85), glass),
        box('Bumper', (0.3, 2.45, 0.4), (5.95, 0, 1.0), chassis),
        box('Lamp L', (0.06, 0.35, 0.2), (6.11, 0.85, 1.25), lamp),
        box('Lamp R', (0.06, 0.35, 0.2), (6.11, -0.85, 1.25), lamp),
    ]
    for x in (4.6, -2.6, -4.0, -5.0):
        for y in (1.05, -1.05):
            parts.append(cyl(f'Tyre {x} {y}', 0.52, 0.32, (x, y, 0.52), rubber, rot=(math.pi / 2, 0, 0)))
    join(parts, 'KONE truck')
    export('truck')


def trees():
    """Two low-poly tropical trees (rain tree and neem-like) as separate objects for instancing."""
    reset()
    bark = mat('Bark', (0.16, 0.11, 0.07, 1), rough=0.95)
    leaf_a = mat('Leaves dark', (0.05, 0.16, 0.04, 1), rough=0.8)
    leaf_b = mat('Leaves light', (0.1, 0.24, 0.05, 1), rough=0.8)

    def canopy(name, r, loc, m, sub=2):
        bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=sub, location=loc)
        o = bpy.context.active_object
        o.name = name
        o.scale = (1, 1, 0.72)
        bpy.ops.object.transform_apply(scale=True)
        o.data.materials.append(m)
        return o

    a = join([
        cyl('Trunk A', 0.32, 4.2, (0, 0, 2.1), bark, verts=8),
        canopy('Crown A1', 3.4, (0, 0, 5.6), leaf_a),
        canopy('Crown A2', 2.4, (1.6, 0.8, 6.6), leaf_b),
        canopy('Crown A3', 2.2, (-1.5, -0.9, 6.3), leaf_a),
    ], 'Tree A')
    b = join([
        cyl('Trunk B', 0.22, 3.2, (0, 0, 1.6), bark, verts=8),
        canopy('Crown B1', 2.1, (0, 0, 4.4), leaf_b),
        canopy('Crown B2', 1.5, (0.6, -0.5, 5.6), leaf_a),
    ], 'Tree B')
    b.location.x = 12  # kept apart in the file; the app reads each object's geometry
    export('trees')


if __name__ == '__main__':
    test_tower()
    truck()
    trees()
