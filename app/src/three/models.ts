// Blender-built glTF assets (see blender/build_assets.py), loaded once and instanced.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Group | null>>();

export function loadModel(name: 'test_tower' | 'truck' | 'trees'): Promise<THREE.Group | null> {
  let p = cache.get(name);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`).then(g => {
      g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return g.scene;
    }).catch(() => null);
    cache.set(name, p);
  }
  return p;
}

/** Copy of a model's top-level object, ready to place. */
export function placeModel(src: THREE.Object3D) {
  return src.clone(true);
}

/**
 * One InstancedMesh per primitive of `variant`, placing it at every matrix.
 * Keeps hundreds of trees or trucks to a handful of draw calls.
 */
export function instance(variant: THREE.Object3D, matrices: THREE.Matrix4[]) {
  const group = new THREE.Group();
  if (!matrices.length) return group;
  variant.updateMatrixWorld(true);
  const rootInv = variant.matrixWorld.clone().invert();
  variant.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const local = rootInv.clone().multiply(m.matrixWorld);
    const im = new THREE.InstancedMesh(m.geometry, m.material, matrices.length);
    const tmp = new THREE.Matrix4();
    matrices.forEach((mx, i) => im.setMatrixAt(i, tmp.multiplyMatrices(mx, local)));
    im.castShadow = true; im.receiveShadow = true;
    group.add(im);
  });
  return group;
}

/** The variants inside the trees model, each re-centred on its own trunk. */
export function treeVariants(trees: THREE.Group): THREE.Object3D[] {
  return trees.children.map(c => {
    const v = c.clone(true);
    v.position.set(0, 0, 0);
    const holder = new THREE.Group();
    holder.add(v);
    return holder;
  });
}

/**
 * Hand-refined KONE buildings from the Blender site pipeline (blender/site_from_osm.py), keyed by
 * facility. They are modelled in site-local metres around the site coordinate, so each one sits at
 * the scene origin as exported. Sites without models resolve to {}.
 */
let manifest: Promise<Record<string, Record<string, string>>> | null = null;
export async function loadSiteModels(siteId: string): Promise<Record<string, THREE.Group>> {
  manifest ??= fetch(`${import.meta.env.BASE_URL}models/sites/manifest.json`).then(r => (r.ok ? r.json() : {})).catch(() => ({}));
  const files = (await manifest)[siteId] ?? {};
  const out: Record<string, THREE.Group> = {};
  await Promise.all(Object.entries(files).map(async ([k, file]) => {
    try {
      const g = await loader.loadAsync(`${import.meta.env.BASE_URL}models/sites/${file}`);
      g.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      out[k] = g.scene;
    } catch { /* keep the automatic building */ }
  }));
  return out;
}
