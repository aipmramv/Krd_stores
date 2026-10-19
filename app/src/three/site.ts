// Realistic site twin built from latitude/longitude:
// - ground: OpenStreetMap standard tiles (a sharp zoom-17 ring, the map's own tiles, over a wide zoom-15 ring)
// - buildings: OpenStreetMap footprints and heights with procedural PBR facades
// - KONE facilities matched to the nearest large buildings; the primary one peels open by floor
// - Blender-modelled test tower, trees and trucks; OSM roads, parks and water when the tiles are unavailable
// - physical sky and sun for the site's position, date and time of day
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Facility, Site } from '../data/types';
import { fetchOsm, inside, polyStats, projector, type OsmBuilding, type OsmData, type Pt } from '../services/osm';
import { getState, isOn, setState } from '../state/store';
import { instance, loadModel, placeModel, treeVariants } from './models';
import { SkyRig } from './sky';
import { allFacades, facadeMaterial, roofMaterial } from './textures';

export interface FacilityMeta {
  f: Facility;
  k: string;
  /** Footprint centre at ground level. */
  c: THREE.Vector3;
  h: number;
  /** Footprint radius, for camera framing. */
  size: number;
  obj: THREE.Object3D;
  slabs?: THREE.Mesh[];
  outline?: THREE.LineSegments;
}
export interface Flow { curve: THREE.QuadraticBezierCurve3; ball: THREE.Mesh; off: number; label: string; col: string; layer: string; mid: THREE.Vector3 }
interface Mover { obj: THREE.Object3D; path: THREE.Vector3[]; len: number[]; total: number; s: number; v: number; dir: number }

export interface SiteScene {
  site: Site;
  sc: THREE.Scene;
  sky: SkyRig;
  meta: Record<string, FacilityMeta>;
  flows: Flow[];
  /** Objects that answer to taps and hover. */
  pickables: THREE.Object3D[];
  src: 'osm' | 'stylised';
  center: THREE.Vector3;
  radius: number;
  /** Resolves once most of the sharp imagery ring has loaded (or failed), so handoffs look seamless. */
  groundReady: Promise<void>;
  /** Scene x/z for a latitude/longitude. */
  toScene(lat: number, lon: number): THREE.Vector3;
}

const OSM_TILES = 'https://tile.openstreetmap.org';
const tileLoader = new THREE.TextureLoader();
tileLoader.setCrossOrigin('anonymous');

/** Footprint (x east, y north) → extruded geometry in scene space (x east, y up, z south). */
function extrude(pts: Pt[], h: number) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))), { depth: h, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Split a non-indexed ExtrudeGeometry into [roof caps, walls] so many buildings can be merged per material. */
function splitCapsWalls(g: THREE.BufferGeometry): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const parts = g.groups.map(gr => {
    const out = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const a = attr as THREE.BufferAttribute, n = a.itemSize;
      out.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(gr.start * n, (gr.start + gr.count) * n), n));
    }
    return { out, i: gr.materialIndex ?? 0 };
  });
  const caps = mergeGeometries(parts.filter(p => p.i === 0).map(p => p.out))!;
  const walls = mergeGeometries(parts.filter(p => p.i === 1).map(p => p.out))!;
  return [caps, walls];
}

const facadeOf = (b: OsmBuilding) =>
  ['industrial', 'warehouse', 'factory', 'hangar', 'shed'].includes(b.tag) ? 'metal' as const
    : ['office', 'commercial', 'retail', 'hotel'].includes(b.tag) || b.h > 24 ? 'glass' as const : 'concrete' as const;

/** A stand-in campus when OpenStreetMap cannot be reached. */
function stylised(site: Site): OsmData {
  const rect = (id: number, x: number, y: number, w: number, d: number, h: number, tag: string): OsmBuilding =>
    ({ id, pts: [[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]], area: w * d, c: [x + w / 2, y + d / 2], h, d: Math.hypot(x + w / 2, y + d / 2), tag });
  const b: OsmBuilding[] =
    site.kind === 'rnd' ? [rect(1, -25, -25, 50, 40, 58, 'office'), rect(2, 45, -20, 45, 38, 52, 'office'), rect(3, -110, -30, 55, 45, 18, 'commercial'), rect(4, -30, 45, 70, 40, 14, 'parking'), rect(5, 60, 50, 30, 24, 7, 'industrial'), rect(6, 110, -40, 26, 20, 6, 'industrial')]
      : site.kind === 'factory' ? [rect(1, -80, -45, 160, 90, 15, 'industrial'), rect(2, 100, -40, 90, 60, 12, 'warehouse'), rect(3, -80, 70, 50, 30, 12, 'office'), rect(4, 100, 40, 40, 30, 8, 'industrial'), rect(5, -20, 70, 26, 18, 6, 'industrial'), rect(6, 40, 70, 30, 22, 7, 'industrial')]
        : [rect(1, -110, -55, 220, 110, 13, 'warehouse'), rect(2, -110, 110, 220, 90, 13, 'warehouse'), rect(3, 140, -20, 24, 16, 6, 'office'), rect(4, 140, 30, 20, 20, 7, 'industrial')];
  for (let i = 0; i < 26; i++) {
    const a = i * 2.39996, r = 280 + (i % 5) * 70;
    b.push(rect(100 + i, Math.cos(a) * r, Math.sin(a) * r, 30 + (i % 4) * 15, 25 + (i % 3) * 12, 8 + (i % 6) * 5, i % 3 ? 'industrial' : 'commercial'));
  }
  const loop: Pt[] = [[-160, -110], [200, -110], [200, 230], [-160, 230], [-160, -110]];
  return { buildings: b, roads: [{ pts: loop, kind: 'service' }, { pts: [[-600, -110], [600, -110]], kind: 'primary' }], green: [[[-300, 260], [-180, 260], [-180, 380], [-300, 380], [-300, 260]]], water: [], trees: [] };
}

function ribbon(pts: Pt[], w: number, y: number) {
  const pos: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
    const a = [x0 + nx, y, -(y0 + ny)], b = [x0 - nx, y, -(y0 - ny)], c = [x1 + nx, y, -(y1 + ny)], d = [x1 - nx, y, -(y1 - ny)];
    pos.push(...a, ...b, ...c, ...b, ...d, ...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const EMPTY_STATS = { buildings: 0, trees: 0, roads: 0, source: 'osm' as const, imagery: 'loading' as const };
const ROAD_W: Record<string, number> = { motorway: 16, trunk: 14, primary: 12, secondary: 10, tertiary: 8, unclassified: 6, residential: 6, service: 4.5 };

const cache: Record<string, Promise<SiteScene>> = {};
export const siteCached = (id: string) => id in cache;
export const buildSite = (site: Site) => (cache[site.id] ??= build(site));

async function build(site: Site): Promise<SiteScene> {
  const [lat0, lon0] = site.ll;
  const xy = projector(lat0, lon0);
  const sc = new THREE.Scene();
  sc.fog = new THREE.Fog('#C9D3DD', 1500, 9000);
  const sky = new SkyRig(sc, 700);

  let src: 'osm' | 'stylised' = 'osm';
  const stats = (p: Partial<{ buildings: number; trees: number; roads: number; imagery: 'loading' | 'ok' | 'unavailable' }>) =>
    setState(s => ({ siteStats: { ...s.siteStats, [site.id]: { ...(s.siteStats[site.id] ?? EMPTY_STATS), source: src, ...p } } }));

  // ---------- Ground: OpenStreetMap tile rings ----------
  const groundBase = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: '#8C8B78', roughness: 1 }));
  groundBase.rotation.x = -Math.PI / 2; groundBase.position.y = -1.2; groundBase.receiveShadow = true;
  sc.add(groundBase);
  const imgGroup = new THREE.Group();
  sc.add(imgGroup);
  let sharpTotal = 0, sharpDone = 0, sharpOk = 0;
  let groundResolve!: () => void;
  const groundReady = new Promise<void>(r => { groundResolve = r; });
  setTimeout(() => groundResolve(), 3500);
  const ring = (z: number, T: number, sharp: boolean) => {
    const n = 2 ** z, fx = (lon0 + 180) / 360 * n, la = lat0 * Math.PI / 180;
    const fy = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n;
    const cx = Math.floor(fx), cy = Math.floor(fy);
    const t2lon = (x: number) => x / n * 360 - 180;
    const t2lat = (y: number) => { const t = Math.PI - 2 * Math.PI * y / n; return 180 / Math.PI * Math.atan(.5 * (Math.exp(t) - Math.exp(-t))); };
    for (let dx = -T; dx <= T; dx++) for (let dy = -T; dy <= T; dy++) {
      const x = cx + dx, y = cy + dy;
      const [x1, n1] = xy(t2lat(y), t2lon(x)), [x2, n2] = xy(t2lat(y + 1), t2lon(x + 1));
      const mat = new THREE.MeshStandardMaterial({ color: '#8C8B78', roughness: 1, visible: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, n1 - n2), mat);
      m.rotation.x = -Math.PI / 2; m.position.set((x1 + x2) / 2, sharp ? 0 : -.6, -(n1 + n2) / 2); m.receiveShadow = true;
      imgGroup.add(m);
      if (sharp) sharpTotal++;
      tileLoader.load(`${OSM_TILES}/${z}/${x}/${y}.png`, tex => {
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
        mat.map = tex; mat.color.set('#ffffff'); mat.visible = true; mat.needsUpdate = true;
        if (sharp) { sharpOk++; done(); }
      }, undefined, () => { if (sharp) done(); });
    }
    function done() {
      sharpDone++;
      if (sharpDone >= sharpTotal * .85) groundResolve();
      if (sharpDone === sharpTotal) stats({ imagery: sharpOk ? 'ok' : 'unavailable' });
    }
  };
  ring(15, 3, false);
  ring(17, 4, true);
  const imageryOk = () => sharpOk > 0;

  // ---------- OpenStreetMap ----------
  const osm = await fetchOsm(site.id, lat0, lon0).catch(() => null);
  src = osm && osm.buildings.length >= 5 ? 'osm' : 'stylised';
  const data = src === 'osm' ? osm! : stylised(site);

  // ---------- Facilities: match KONE roles to buildings ----------
  const blds = data.buildings;
  const matched = new Map<OsmBuilding, Facility>();
  const toMatch = site.facilities.filter(f => !f.modelled);
  const atSite = blds.find(b => inside([0, 0], b.pts) && b.area > 200);
  const cands = blds.filter(b => b.area > 150 && b.d < 360).sort((a, b) => a.d - b.d);
  const main = atSite ?? cands.slice(0, 6).reduce<OsmBuilding | undefined>((m, b) => (!m || b.area > m.area ? b : m), undefined);
  if (main) matched.set(main, toMatch[0]);
  cands.filter(b => b !== main).slice(0, toMatch.length - 1).forEach((b, i) => matched.set(b, toMatch[i + 1]));

  // ---------- Buildings ----------
  const ctxGroup = new THREE.Group(), konGroup = new THREE.Group();
  sc.add(ctxGroup, konGroup);
  const meta: Record<string, FacilityMeta> = {};
  const pickables: THREE.Object3D[] = [];
  const byFacade: Record<string, { caps: THREE.BufferGeometry[]; walls: THREE.BufferGeometry[] }> = {};
  const plant: THREE.Matrix4[] = [];
  const outlineMat = new THREE.LineBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: .9 });
  const footprintRadius = (b: OsmBuilding) => Math.sqrt(b.area / Math.PI);

  for (const b of blds) {
    const f = matched.get(b);
    if (!f) {
      const kind = facadeOf(b);
      const [caps, walls] = splitCapsWalls(extrude(b.pts, b.h));
      (byFacade[kind] ??= { caps: [], walls: [] }).caps.push(caps);
      byFacade[kind].walls.push(walls);
      if (b.area > 1500) {
        for (let i = 0; i < Math.min(5, Math.floor(b.area / 900)); i++) {
          const r = footprintRadius(b) * .45, a = b.id * .7 + i * 2.1;
          const p = new THREE.Vector3(b.c[0] + Math.cos(a) * r * (.3 + (i % 3) * .3), b.h + 1.2, -(b.c[1] + Math.sin(a) * r * (.3 + (i % 3) * .3)));
          if (inside([p.x, -p.z], b.pts)) plant.push(new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
        }
      }
      continue;
    }
    const h = f.floors ? Math.max(b.h, 15) : Math.max(b.h, 6);
    const walls = facadeMaterial(f.facade), roof = roofMaterial(f.col);
    let obj: THREE.Object3D;
    let slabs: THREE.Mesh[] | undefined;
    if (f.floors) {
      obj = new THREE.Group();
      slabs = [];
      const fh = h / f.floors.length;
      f.floors.forEach((_, i) => {
        const m = new THREE.Mesh(extrude(b.pts, fh - .5), [roof, walls]);
        m.castShadow = m.receiveShadow = true;
        m.position.y = i * fh;
        m.userData = { k: f.k, floor: i, base: i * fh };
        obj.add(m); slabs!.push(m); pickables.push(m);
      });
    } else {
      obj = new THREE.Mesh(extrude(b.pts, h), [roof, walls]);
      obj.castShadow = obj.receiveShadow = true;
      obj.userData = { k: f.k };
      pickables.push(obj);
    }
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(extrude(b.pts, h + .3), 30), outlineMat);
    outline.visible = false;
    konGroup.add(obj, outline);
    meta[f.k] = { f, k: f.k, c: new THREE.Vector3(b.c[0], 0, -b.c[1]), h, size: footprintRadius(b), obj, slabs, outline };
  }
  for (const [kind, g] of Object.entries(byFacade)) {
    const walls = new THREE.Mesh(mergeGeometries(g.walls)!, facadeMaterial(kind as Facility['facade']));
    const caps = new THREE.Mesh(mergeGeometries(g.caps)!, roofMaterial());
    for (const m of [walls, caps]) { m.castShadow = m.receiveShadow = true; ctxGroup.add(m); }
  }
  if (plant.length) {
    const hvac = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 2.4, 3), new THREE.MeshStandardMaterial({ color: '#B9BCC0', roughness: .5, metalness: .5 }), plant.length);
    plant.forEach((m, i) => hvac.setMatrixAt(i, m));
    hvac.castShadow = true;
    ctxGroup.add(hvac);
  }

  // ---------- Free ground for modelled facilities ----------
  const center = meta.main ? meta.main.c.clone() : new THREE.Vector3();
  const blocked: Pt[][] = blds.map(b => b.pts);
  const freeSpot = (half: number, from: number): Pt => {
    for (let r = from; r < from + 260; r += 18) for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2 + r * .01, x = center.x + Math.cos(a) * r, y = -center.z + Math.sin(a) * r;
      const probe: Pt[] = [[x, y], [x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half]];
      if (probe.every(p => !blocked.some(poly => inside(p, poly)))) {
        blocked.push([[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half], [x - half, y - half]]);
        return [x, y];
      }
    }
    return [center.x + from, -center.z - from];
  };
  const mainSize = meta.main?.size ?? 40;
  const [towerM, truckM, treesM] = await Promise.all([loadModel('test_tower'), loadModel('truck'), loadModel('trees')]);
  for (const f of site.facilities.filter(x => x.modelled)) {
    if (f.modelled === 'test_tower') {
      const [x, y] = freeSpot(16, mainSize + 50);
      const tower = towerM ? placeModel(towerM) : new THREE.Mesh(new THREE.BoxGeometry(14, 92, 14).translate(0, 46, 0), facadeMaterial('concrete'));
      tower.position.set(x, 0, -y);
      tower.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.userData = { k: f.k }; pickables.push(o); } });
      konGroup.add(tower);
      meta[f.k] = { f, k: f.k, c: new THREE.Vector3(x, 0, -y), h: 106, size: 14, obj: tower };
    } else {
      const [x, y] = freeSpot(32, mainSize + 70);
      const yard = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: '#B8B1A4', roughness: 1, transparent: true, opacity: .85 }));
      pad.rotation.x = -Math.PI / 2; pad.position.y = .25; pad.userData = { k: f.k };
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(60, 40)), new THREE.LineBasicMaterial({ color: '#C8312B' }));
      edge.rotation.x = -Math.PI / 2; edge.position.y = .35;
      yard.add(pad, edge);
      for (let i = 0; i < 8; i++) {
        const bx = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.8 + (i % 3) * .6, 2.4), new THREE.MeshStandardMaterial({ color: ['#6E747A', '#4A4D55', '#8A6E4B'][i % 3], roughness: .8, metalness: .3 }));
        bx.position.set(-22 + i * 6.2, .9, -8 + (i % 3) * 7); bx.rotation.y = i * .4; bx.castShadow = true;
        yard.add(bx);
      }
      yard.position.set(x, 0, -y);
      konGroup.add(yard); pickables.push(pad);
      meta[f.k] = { f, k: f.k, c: new THREE.Vector3(x, 0, -y), h: 3, size: 30, obj: yard };
    }
  }

  // ---------- Roads, parks and water (drawn when there is no imagery) ----------
  const mapGroup = new THREE.Group();
  sc.add(mapGroup);
  const asphalt = new THREE.MeshStandardMaterial({ color: '#4C4F55', roughness: .95 });
  const roadGeos = data.roads.filter(r => ROAD_W[r.kind]).map(r => ribbon(r.pts, ROAD_W[r.kind], .18));
  if (roadGeos.length) mapGroup.add(new THREE.Mesh(mergeGeometries(roadGeos)!, asphalt));
  const flat = (polys: Pt[][], color: string) => {
    const geos = polys.filter(p => p.length > 3).map(p => {
      const g = new THREE.ShapeGeometry(new THREE.Shape(p.map(q => new THREE.Vector2(q[0], q[1]))));
      g.rotateX(-Math.PI / 2);
      g.translate(0, .08, 0);
      return g;
    });
    if (geos.length) mapGroup.add(new THREE.Mesh(mergeGeometries(geos)!, new THREE.MeshStandardMaterial({ color, roughness: 1 })));
  };
  flat(data.green, '#6F8A4E');
  flat(data.water, '#5E7F95');

  // ---------- Trees (Blender model, instanced) ----------
  const treeGroup = new THREE.Group();
  sc.add(treeGroup);
  const treePts: Pt[] = [...data.trees];
  for (const poly of data.green) {
    const { a } = polyStats(poly);
    const n = Math.min(60, Math.floor(Math.abs(a) / 260));
    const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const p: Pt = [x0 + (x1 - x0) * ((Math.sin(tries * 12.9898 + a) * 43758.5453) % 1 + 1) % 1, y0 + (y1 - y0) * ((Math.sin(tries * 78.233 + a) * 12345.678) % 1 + 1) % 1];
      if (inside(p, poly)) { treePts.push(p); i++; }
    }
  }
  if (src === 'stylised') for (let i = 0; i < 90; i++) { const a = i * 2.3999, r = 140 + (i % 9) * 22; treePts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  const treeList = treePts.filter(p => Math.hypot(p[0], p[1]) < 1000 && !blds.some(b => inside(p, b.pts))).slice(0, 1500);
  if (treesM) {
    const variants = treeVariants(treesM);
    const mats: THREE.Matrix4[][] = variants.map(() => []);
    treeList.forEach((p, i) => {
      const s = .8 + ((i * 0.618) % 1) * .6;
      mats[i % variants.length].push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], 0, -p[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7), new THREE.Vector3(s, s, s)));
    });
    variants.forEach((v, i) => treeGroup.add(instance(v, mats[i])));
  }

  // ---------- Vehicles ----------
  const vehGroup = new THREE.Group();
  sc.add(vehGroup);
  const movers: Mover[] = [];
  if (truckM) {
    const lanes = data.roads
      .filter(r => ['service', 'tertiary', 'unclassified', 'residential', 'secondary'].includes(r.kind))
      .map(r => {
        const path = r.pts.map(p => new THREE.Vector3(p[0], 0, -p[1]));
        const len = [0];
        for (let i = 1; i < path.length; i++) len.push(len[i - 1] + path[i].distanceTo(path[i - 1]));
        return { path, len, total: len[len.length - 1], d: Math.min(...r.pts.map(p => Math.hypot(p[0], p[1]))) };
      })
      .filter(l => l.total > 90 && l.d < 450)
      .sort((a, b) => a.d - b.d)
      .slice(0, 6);
    lanes.forEach((l, i) => {
      const obj = placeModel(truckM);
      vehGroup.add(obj);
      movers.push({ obj, path: l.path, len: l.len, total: l.total, s: (i * 53) % l.total, v: 6 + (i % 3) * 2, dir: i % 2 ? -1 : 1 });
    });
    // Trucks backed onto the dock face of a warehouse or factory hall.
    const dockAt = site.kind !== 'rnd' && main;
    if (dockAt) {
      let best = 0, bi = 0;
      for (let i = 0; i < main.pts.length - 1; i++) { const [a, b] = [main.pts[i], main.pts[i + 1]]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (l > best) { best = l; bi = i; } }
      const [a, b] = [main.pts[bi], main.pts[bi + 1]];
      const ux = (b[0] - a[0]) / best, uy = (b[1] - a[1]) / best;
      let nx = -uy, ny = ux;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if ((mx - main.c[0]) * nx + (my - main.c[1]) * ny < 0) { nx = -nx; ny = -ny; }
      const count = Math.min(8, Math.floor(best / 14));
      for (let i = 0; i < count; i++) {
        const t = (i + .5) / count, px = a[0] + (b[0] - a[0]) * t + nx * 8.5, py = a[1] + (b[1] - a[1]) * t + ny * 8.5;
        const obj = placeModel(truckM);
        obj.position.set(px, 0, -py);
        obj.rotation.y = Math.atan2(ny, nx); // forward (+X) points away from the dock, rear against the doors
        vehGroup.add(obj);
      }
    }
  }

  // ---------- Internal flows ----------
  const flowGroup = new THREE.Group();
  sc.add(flowGroup);
  const flows: Flow[] = [];
  const flowGroups: THREE.Group[] = [];
  const top = (k: string) => (meta[k] ? meta[k].c.clone().setY(Math.min(meta[k].h, 60) + 4) : null);
  site.flows.forEach(([a, b, col, label, layer], i) => {
    const p0 = top(a), p2 = top(b);
    if (!p0 || !p2) return;
    const mid = p0.clone().add(p2).multiplyScalar(.5);
    mid.y += Math.max(35, p0.distanceTo(p2) * .45);
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 1.4, 8, false), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .92, toneMapped: false }));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(3.6, 20, 12), new THREE.MeshBasicMaterial({ color: '#FFFFFF', toneMapped: false }));
    const g = new THREE.Group();
    g.add(tube, ball); g.userData.layer = layer;
    flowGroup.add(g); flowGroups.push(g);
    flows.push({ curve, ball, off: i * .21, label, col, layer, mid: curve.getPoint(.5) });
  });

  const spread = Object.values(meta).reduce((m, x) => Math.max(m, x.c.distanceTo(center) + x.size), 0);
  const radius = THREE.MathUtils.clamp(spread + 60, 180, 520);
  stats({ buildings: blds.length, trees: treeList.length, roads: data.roads.length });

  const v = new THREE.Vector3(), q = new THREE.Vector3();
  let last = 0;
  sc.userData.tick = (t: number) => {
    const dt = Math.min(.1, t - last); last = t;
    const s = getState();
    const peel = s.peel && s.screen === 'site';
    meta.main?.slabs?.forEach((m, i) => {
      const target = m.userData.base + (peel ? i * 10 : 0);
      m.position.y += (target - m.position.y) * .12;
    });
    flows.forEach(f => { f.ball.position.copy(f.curve.getPoint((t * .16 + f.off) % 1)); });
    for (const m of movers) {
      m.s += m.v * dt * m.dir;
      if (m.s > m.total || m.s < 0) { m.dir *= -1; m.s = THREE.MathUtils.clamp(m.s, 0, m.total); }
      let i = 1;
      while (i < m.len.length - 1 && m.len[i] < m.s) i++;
      const k = (m.s - m.len[i - 1]) / Math.max(.001, m.len[i] - m.len[i - 1]);
      v.lerpVectors(m.path[i - 1], m.path[i], k);
      q.subVectors(m.path[i], m.path[i - 1]).multiplyScalar(m.dir);
      // Keep left, as on Indian roads.
      const side = new THREE.Vector3(q.z, 0, -q.x).normalize().multiplyScalar(-2.2);
      m.obj.position.copy(v).add(side);
      m.obj.rotation.y = Math.atan2(-q.z, q.x);
    }
    flowGroup.visible = s.screen === 'movements';
    flowGroups.forEach(g => { g.visible = isOn(s, 'movements', g.userData.layer); });
    const scr = s.screen === 'movements' ? 'movements' : 'site';
    ctxGroup.visible = isOn(s, scr, 'ctx');
    imgGroup.visible = isOn(s, 'site', 'img') && imageryOk();
    mapGroup.visible = !imgGroup.visible;
    treeGroup.visible = isOn(s, scr, 'trees');
    vehGroup.visible = isOn(s, scr, 'veh');
    for (const m of Object.values(meta)) if (m.outline) m.outline.visible = s.bld === m.k || hovered === m.k;
    const night = 1 - sky.day;
    for (const m of allFacades()) m.emissiveIntensity = night * .9;
  };

  const res: SiteScene = {
    site, sc, sky, meta, flows, pickables, src, center, radius, groundReady,
    toScene(lat, lon) { const [x, y] = xy(lat, lon); return new THREE.Vector3(x, 0, -y); },
  };
  return res;
}

let hovered: string | null = null;
export const setHovered = (k: string | null) => { hovered = k; };
