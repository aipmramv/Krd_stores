// Electronics store twin: racks with instanced bins coloured by the active mode, zones you can drop
// stock onto, planned inbound pallets you can drag to a bin, a pulsing exception bin, and the
// touch tools: drag fit preview, follow-a-part, selection, x-ray, a guiding beam, the pick path
// and trolleys moving along the aisles for moves in progress.
import * as THREE from 'three';
import { LEGENDS } from '../data/sample';
import { BAYS, binColor, binId, binOf, EXCEPTION_BIN, isReserved, LEVELS, rnd, ROWS } from '../data/storeModel';
import type { Bin, ColorMode } from '../data/types';
import type { Camera, Part, StockLot } from '../db/schema';
import { livePositions, type LivePos } from '../services/live';
import { pickOrder, type Fit } from '../services/storeOps';
import { getStoreView } from '../services/storeView';
import { getState, isOn } from '../state/store';

export const BAY = 2.7, LV = 1.55, ROWZ = [-9, -3, 3, 9], X0 = -16.2;
export const binPos = ({ r, i, k }: Bin) => new THREE.Vector3(X0 + i * BAY + BAY / 2, .35 + k * LV + .6, ROWZ[r]);

/** Floor areas of the store you can drop stock onto (location codes in the site's areas). */
export const AREAS: { code: string; label: string; x: number; z: number; w: number; d: number; col: string; op: number }[] = [
  { code: 'Quarantine Q-01', label: 'Quarantine cage', x: 19.5, z: -9, w: 7, d: 10, col: '#FFE141', op: .22 },
  { code: 'Hazmat H-01', label: 'Hazmat cabinet', x: 19.5, z: 4, w: 7, d: 8, col: '#FFCDD7', op: .22 },
  { code: 'Inbound staging', label: 'Inbound staging', x: -1.5, z: 13.5, w: 40, d: 5, col: '#AAE1C8', op: .16 },
];
export const areaPos = (code: string) => { const a = AREAS.find(x => x.code === code); return a ? new THREE.Vector3(a.x, .6, a.z) : null; };

export interface StoreScene {
  sc: THREE.Scene;
  bins: THREE.InstancedMesh;
  idx: Bin[];
  moveLine: THREE.Group;
  zones: THREE.Mesh[];
  ghosts: THREE.Group;
  cams: THREE.Group;
}

let cached: StoreScene | null = null;
/** Positions drawn in the last frame (the virtual CCTV detects people from these). */
export let live: LivePos[] = [];
/** While dragging: how each bin (and area) would take the dragged stock. */
let fitMap: Map<string, Fit> | null = null;
let hoverZone: string | null = null;
const FIT_COL: Record<Fit, string> = { ok: '#1B7F4E', partial: '#C77700', no: '#5A1F1C' };

export function buildStore(): StoreScene {
  if (cached) return cached;
  const sc = new THREE.Scene();
  sc.background = new THREE.Color('#1F2024');
  sc.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.4));
  const d = new THREE.DirectionalLight(0xffffff, 2);
  d.position.set(20, 40, 25); d.castShadow = true; d.shadow.mapSize.set(2048, 2048);
  Object.assign(d.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35 });
  sc.add(d);
  for (let i = 0; i < 3; i++) { const p = new THREE.PointLight(0xffffff, 40, 30); p.position.set(-12 + i * 12, 9, 0); sc.add(p); }

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(48, 34), new THREE.MeshStandardMaterial({ color: '#5A5D64', roughness: .9 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
  sc.add(floor);
  const grid = new THREE.GridHelper(48, 24, '#6E7179', '#64676E');
  grid.position.y = .01; grid.scale.z = 34 / 48;
  sc.add(grid);
  const wallM = new THREE.MeshStandardMaterial({ color: '#C4C7CD', roughness: .9, transparent: true, opacity: .55, side: THREE.DoubleSide });
  const w1 = new THREE.Mesh(new THREE.PlaneGeometry(48, 8), wallM); w1.position.set(0, 4, -17); sc.add(w1);
  const w2 = new THREE.Mesh(new THREE.PlaneGeometry(34, 8), wallM); w2.rotation.y = Math.PI / 2; w2.position.set(-24, 4, 0); sc.add(w2);

  // Zones: the ESD area is decoration; the others are drop targets.
  const zoneMesh = (x: number, z: number, w: number, dd: number, col: string, op: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, .03, z); sc.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, dd)), new THREE.LineBasicMaterial({ color: col }));
    e.rotation.x = -Math.PI / 2; e.position.set(x, .05, z); sc.add(e);
    return m;
  };
  zoneMesh(-1.5, -6, 36, 9, '#D2F5FF', .12);
  const zones = AREAS.map(a => { const m = zoneMesh(a.x, a.z, a.w, a.d, a.col, a.op); m.userData = { area: a.code, base: a.op }; return m; });

  const frameM = new THREE.MeshStandardMaterial({ color: '#2C2E33', roughness: .6, metalness: .4, transparent: true });
  const beamM = new THREE.MeshStandardMaterial({ color: '#1450F5', roughness: .5, metalness: .3, transparent: true });
  ROWZ.forEach(z => {
    for (let i = 0; i <= BAYS; i++) for (const dz of [-.65, .65]) {
      const u = new THREE.Mesh(new THREE.BoxGeometry(.12, 6.6, .12), frameM);
      u.position.set(X0 + i * BAY, 3.3, z + dz); u.castShadow = true; sc.add(u);
    }
    for (let k = 0; k < LEVELS; k++) for (const dz of [-.65, .65]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(BAYS * BAY, .14, .1), beamM);
      b.position.set(X0 + BAYS / 2 * BAY, .3 + k * LV, z + dz); sc.add(b);
    }
  });

  // One instance per bin, scaled vertically by its fill level.
  const count = ROWS.length * BAYS * LEVELS;
  const binM = new THREE.MeshStandardMaterial({ roughness: .7, transparent: true });
  const bins = new THREE.InstancedMesh(new THREE.BoxGeometry(BAY - .3, 1.15, 1.15), binM, count);
  bins.castShadow = bins.receiveShadow = true;
  const idx: Bin[] = [];
  const mtx = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < ROWS.length; r++) for (let i = 0; i < BAYS; i++) for (let k = 0; k < LEVELS; k++) {
    const b = { r, i, k }, p = binPos(b);
    const fill = .45 + rnd(r, i, k) * .55;
    mtx.compose(p.clone().setY(p.y - .575 * (1 - fill)), new THREE.Quaternion(), new THREE.Vector3(1, fill, 1));
    bins.setMatrixAt(n++, mtx);
    idx.push(b);
  }
  sc.add(bins);

  // Planned inbound: one pallet per waiting put-away task; press, hold and drag one onto a bin.
  const ghosts = new THREE.Group();
  sc.add(ghosts);
  let ghostKey = '';
  const mkGhosts = (tasks: { id: string; qty: number }[]) => {
    ghosts.clear();
    tasks.slice(0, 10).forEach((t, i) => {
      const g = new THREE.BoxGeometry(2.4, 1.6, 2.2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#A1B9FB', transparent: true, opacity: .22, depthWrite: false }));
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineDashedMaterial({ color: '#A1B9FB', dashSize: .3, gapSize: .2 }));
      e.computeLineDistances();
      const grp = new THREE.Group();
      grp.add(m, e); grp.position.set(-17 + i * 3.6, .8, 13.5);
      m.userData = { task: t.id };
      ghosts.add(grp);
    });
  };

  const exc = new THREE.Mesh(new THREE.BoxGeometry(BAY - .25, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: '#C8312B', emissive: '#C8312B', emissiveIntensity: .6, transparent: true, opacity: .95 }));
  exc.position.copy(binPos(EXCEPTION_BIN));
  sc.add(exc);
  const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BAY - .1, 1.35, 1.35)), new THREE.LineBasicMaterial({ color: '#FFFFFF' }));
  sc.add(selBox);
  const moveLine = new THREE.Group();
  sc.add(moveLine);

  // Multi-selection outlines.
  const selGroup = new THREE.Group();
  sc.add(selGroup);
  const selGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(BAY - .05, 1.4, 1.4)), selMat = new THREE.LineBasicMaterial({ color: '#FFE141' });
  let selKey = '';

  // Guiding beam: a column of light over a bin found by search.
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, 14, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#7FA3FF', transparent: true, opacity: .3, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: '#7FA3FF', transparent: true, opacity: .8, side: THREE.DoubleSide, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2;
  sc.add(beam, ring);

  // Pick path along the aisles.
  const path = new THREE.Group();
  sc.add(path);
  let pathKey = '';

  // Trolleys (UWB tags) carry the work in progress; idle ones wait at inbound staging.
  const trolleyGeo = new THREE.BoxGeometry(1.1, .7, .8);
  const tMat = { approved: new THREE.MeshStandardMaterial({ color: '#1450F5', emissive: '#1450F5', emissiveIntensity: .4 }), idle: new THREE.MeshStandardMaterial({ color: '#767A82', roughness: .7 }) };

  sc.userData.tick = (t: number) => {
    const s = getState();
    const view = getStoreView()?.site === s.site ? getStoreView() : null;
    const excBin = view ? binOf(view.counts[0]?.from) : EXCEPTION_BIN;
    exc.visible = isOn(s, 'store', 'exc') && !!excBin && !fitMap;
    if (excBin) exc.position.copy(binPos(excBin));
    (exc.material as THREE.MeshStandardMaterial).emissiveIntensity = .35 + .45 * (.5 + .5 * Math.sin(t * 4.5));
    ghosts.visible = isOn(s, 'store', 'ghost');
    const tasks = view?.putaways.map(m => ({ id: m._id, qty: m.qty })) ?? [];
    const gk = tasks.map(x => x.id).join();
    if (gk !== ghostKey) { ghostKey = gk; mkGhosts(tasks); }
    selBox.position.copy(binPos(s.bin));
    selBox.visible = !s.selectMode;

    // Selection outlines.
    const sk = s.storeSel.join();
    if (sk !== selKey) {
      selKey = sk; selGroup.clear();
      for (const c of s.storeSel) { const b = binOf(c); if (b) { const l = new THREE.LineSegments(selGeo, selMat); l.position.copy(binPos(b)); selGroup.add(l); } }
    }
    selMat.opacity = .6 + .4 * Math.sin(t * 5);

    // Beam.
    const bb = binOf(s.beam ?? undefined);
    beam.visible = ring.visible = !!bb;
    if (bb) {
      const p = binPos(bb);
      beam.position.set(p.x, 7, p.z); ring.position.set(p.x, .06, p.z);
      (beam.material as THREE.MeshBasicMaterial).opacity = .18 + .14 * (.5 + .5 * Math.sin(t * 3));
      ring.scale.setScalar(1 + .25 * ((t * .8) % 1));
    }

    // Zones light up when stock is dragged over them.
    for (const z of zones) {
      const m = z.material as THREE.MeshBasicMaterial, fit = fitMap?.get(z.userData.area);
      m.opacity = fitMap ? (z.userData.area === hoverZone ? .6 : .3) : z.userData.base;
      m.color.set(fit ? FIT_COL[fit] : AREAS.find(a => a.code === z.userData.area)!.col);
    }

    // X-ray: racks fade so every bin can be seen.
    frameM.opacity = beamM.opacity = s.xray ? .12 : 1;
    w1.visible = w2.visible = !s.xray;

    // Pick path.
    const pk = s.pickPath ? sk : '';
    if (pk !== pathKey) { pathKey = pk; drawPath(path, s.pickPath ? s.storeSel : []); }

    // People, trolleys and the forklift where their tags say (services/live.ts).
    live = view ? livePositions(view.trackers, view.movements, Date.now() / 1000) : [];
    const lk = live.map(p => p.id + (p.task ?? '')).join();
    if (lk !== liveKey) {
      liveKey = lk; actors.clear();
      for (const p of live) {
        const o = p.kind === 'badge' ? worker() : p.kind === 'forklift' ? forklift() : new THREE.Mesh(trolleyGeo, p.task ? tMat.approved : tMat.idle);
        o.castShadow = true; o.userData.id = p.id;
        actors.add(o);
      }
    }
    actors.visible = isOn(s, 'store', 'tags');
    for (const o of actors.children) {
      const p = live.find(x => x.id === o.userData.id);
      if (!p) continue;
      const prev = o.position.clone();
      o.position.set(p.x, p.kind === 'trolley' ? .45 : 0, p.z);
      const dx = p.x - prev.x, dz = p.z - prev.z;
      if (Math.hypot(dx, dz) > .01) o.rotation.y = Math.atan2(dx, dz);
    }

    // Cameras: the open one's view cone is bright.
    cams.visible = isOn(s, 'store', 'cam');
    const ck = (view?.cameras ?? []).map(c => c._id + c.status).join();
    if (ck !== camKey) { camKey = ck; mkCameras(view?.cameras ?? []); }
    const openCam = s.overlay?.kind === 'camera' ? s.overlay.id : null;
    for (const g of cams.children) {
      const on = g.userData.camera === openCam;
      (g.userData.cone as THREE.Mesh).visible = on || !openCam;
      ((g.userData.cone as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = on ? .16 : .05;
      ((g.userData.lines as THREE.LineSegments).material as THREE.LineBasicMaterial).color.set(on ? '#FFE141' : '#7FA3FF');
    }
  };

  // ---- Cameras and people ----
  const cams = new THREE.Group();
  sc.add(cams);
  let camKey = '';
  const camBodyM = new THREE.MeshStandardMaterial({ color: '#2A2C31', roughness: .4, metalness: .5 });
  const mkCameras = (list: Camera[]) => {
    cams.clear();
    for (const c of list) {
      const g = new THREE.Group();
      const pos = new THREE.Vector3(...c.pos), look = new THREE.Vector3(...c.look);
      const body = new THREE.Mesh(new THREE.BoxGeometry(.35, .3, .6), camBodyM);
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, .08, 16), new THREE.MeshBasicMaterial({ color: c.status === 'online' ? '#1B7F4E' : '#C8312B' }));
      lens.rotation.x = Math.PI / 2; lens.position.z = .32;
      const head = new THREE.Group(); head.add(body, lens);
      head.position.copy(pos); head.lookAt(look);
      body.userData.camera = c._id; lens.userData.camera = c._id;
      // View cone: a pyramid to 9 m along the aim, matching the camera's field of view.
      const dir = look.clone().sub(pos).normalize(), far = 9, hh = Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) * far, hw = hh * 16 / 9;
      const up = new THREE.Vector3(0, 1, 0), right = dir.clone().cross(up).normalize(), u = right.clone().cross(dir).normalize();
      const ctr = pos.clone().add(dir.clone().multiplyScalar(far));
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ctr.clone().add(right.clone().multiplyScalar(a * hw)).add(u.clone().multiplyScalar(b * hh)));
      const geo = new THREE.BufferGeometry().setFromPoints([pos, corners[0], corners[1], pos, corners[1], corners[2], pos, corners[2], corners[3], pos, corners[3], corners[0]]);
      const cone = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#7FA3FF', transparent: true, opacity: .05, side: THREE.DoubleSide, depthWrite: false }));
      const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(corners.flatMap((p, i) => [pos, p, p, corners[(i + 1) % 4]])), new THREE.LineBasicMaterial({ color: '#7FA3FF', transparent: true, opacity: .3 }));
      cone.userData.camera = c._id;
      g.add(head, cone, lines);
      g.userData = { camera: c._id, cone, lines, head };
      cams.add(g);
    }
  };
  const actors = new THREE.Group();
  sc.add(actors);
  let liveKey = '';
  const vestM = new THREE.MeshStandardMaterial({ color: '#2F6FD6', roughness: .8 }), skinM = new THREE.MeshStandardMaterial({ color: '#B98A6A', roughness: .8 }), legM = new THREE.MeshStandardMaterial({ color: '#2A2C31' });
  const worker = () => {
    const g = new THREE.Group();
    const legs = new THREE.Mesh(new THREE.BoxGeometry(.36, .85, .22), legM); legs.position.y = .43;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(.24, .5, 4, 10), vestM); body.position.y = 1.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.16, 14, 10), skinM); head.position.y = 1.68;
    g.add(legs, body, head);
    return g;
  };
  const forklift = () => {
    const g = new THREE.Group(), y = new THREE.MeshStandardMaterial({ color: '#E8B10C', roughness: .6 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, .9, 2), y); base.position.y = .55;
    const mast = new THREE.Mesh(new THREE.BoxGeometry(1, 2.4, .12), legM); mast.position.set(0, 1.4, 1.05);
    const forks = new THREE.Mesh(new THREE.BoxGeometry(.9, .06, 1), legM); forks.position.set(0, .2, 1.6);
    g.add(base, mast, forks);
    return g;
  };

  cached = { sc, bins, idx, moveLine, zones, ghosts, cams };
  recolorBins();
  return cached;
}


/** Pick path through the selected bins (walking order from storeOps), drawn on the floor. */
export let pathStops: { code: string; pos: THREE.Vector3 }[] = [];
function drawPath(g: THREE.Group, codes: string[]) {
  g.children.forEach(o => (o as THREE.Mesh).geometry?.dispose());
  g.clear(); pathStops = [];
  const bins = codes.map(c => binOf(c)).filter((b): b is Bin => !!b);
  if (!bins.length) return;
  const { order, pts } = pickOrder(bins);
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(new THREE.Vector3(pts[i - 1][0], .12, pts[i - 1][1]), new THREE.Vector3(pts[i][0], .12, pts[i][1])));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve as unknown as THREE.Curve<THREE.Vector3>, Math.max(16, pts.length * 12), .14, 6, false), new THREE.MeshBasicMaterial({ color: '#FFE141', toneMapped: false })));
  pathStops = order.map(b => ({ code: binId(b), pos: binPos(b).setY(binPos(b).y + .9) }));
}

const EMPTY = '#3A3D44';
const PROJECT: Record<string, number> = { 'DX Class 2027': 0, 'MonoSpace retrofit': 1, 'Escalator drive test': 2 };

/** Colour and fill of a bin from its stock lots, for the active colour mode. */
export function binLook(mode: ColorMode, lots: StockLot[], parts: Map<string, Part>, capacity: number, activity = 0): { col: string; fill: number } {
  const qty = lots.reduce((n, l) => n + l.qty, 0);
  const L = LEGENDS[mode];
  if (mode === 'activity') return { col: qty || activity ? L[activity >= 6 ? 3 : activity >= 3 ? 2 : activity >= 1 ? 1 : 0][0] : EMPTY, fill: qty ? .2 + .8 * Math.min(1, qty / capacity) : .06 };
  if (!qty) return { col: EMPTY, fill: .06 };
  const f = Math.min(1, qty / capacity);
  const fill = .2 + .8 * f;
  if (mode === 'occupancy') return { col: f < .25 ? L[0][0] : f < .5 ? L[1][0] : f < .75 ? L[2][0] : f < .92 ? L[3][0] : L[4][0], fill };
  if (mode === 'value') {
    const v = lots.reduce((n, l) => n + l.qty * (parts.get(l.partNo)?.unitCost ?? 0), 0);
    return { col: L[v > 1e6 ? 3 : v > 2e5 ? 2 : v > 5e4 ? 1 : 0][0], fill };
  }
  if (mode === 'ageing') {
    const days = Math.max(...lots.map(l => (Date.now() - Date.parse(l.receivedAt)) / 86400000));
    return { col: days < 30 ? L[0][0] : days < 90 ? L[1][0] : days < 180 ? L[2][0] : L[3][0], fill };
  }
  if (mode === 'project') return { col: L[PROJECT[lots[0].project] ?? 3][0], fill };
  const hz = lots.map(l => parts.get(l.partNo)?.hazard ?? '');
  return { col: hz.some(h => /UN\d|Flammable/.test(h)) ? L[2][0] : hz.some(h => h === 'ESD') ? L[0][0] : L[3][0], fill };
}

/** Show (or clear) the drag fit preview: green fits, amber partly, dark red does not. */
export function setDragPreview(map: Map<string, Fit> | null, zone: string | null = null) {
  fitMap = map; hoverZone = zone;
  recolorBins();
}

export function recolorBins() {
  if (!cached) return;
  const { bins, idx } = cached, s = getState(), c = new THREE.Color(), m = new THREE.Matrix4();
  const resv = isOn(s, 'store', 'resv'), view = getStoreView()?.site === s.site ? getStoreView() : null;
  const dim = new THREE.Color('#2A2C31');
  (bins.material as THREE.MeshStandardMaterial).opacity = s.xray && !fitMap ? .55 : 1;
  idx.forEach((b, n) => {
    if (!view) { c.set(resv && isReserved(b) ? '#FFFFFF' : binColor(s.mode, b)); bins.setColorAt(n, c); return; }
    const code = binId(b), lots = view.lots.get(code) ?? [];
    const { col, fill } = binLook(s.mode, lots, view.parts, view.locs.get(code)?.capacity ?? 60, view.activity.get(code) ?? 0);
    c.set(resv && lots.some(l => l.reserved > 0) ? '#FFFFFF' : col);
    // Overlays: drag fit preview, then the followed part (matches bright, the rest dimmed).
    const fit = fitMap?.get(code);
    if (fitMap) c.set(fit ? FIT_COL[fit] : '#2A2C31');
    else if (s.follow) { if (lots.some(l => l.partNo === s.follow)) c.set('#FFE141'); else c.lerp(dim, .85); }
    bins.setColorAt(n, c);
    const p = binPos(b);
    const f = fitMap && fit ? Math.max(fill, .35) : fill;
    m.compose(p.setY(p.y - .575 * (1 - f)), new THREE.Quaternion(), new THREE.Vector3(1, f, 1));
    bins.setMatrixAt(n, m);
  });
  bins.instanceColor!.needsUpdate = true;
  bins.instanceMatrix.needsUpdate = true;
  bins.computeBoundingSphere();
}

function arc(p0: THREE.Vector3, p2: THREE.Vector3, col: string, r = .12) {
  const mid = p0.clone().add(p2).multiplyScalar(.5);
  mid.y += 3 + p0.distanceTo(p2) * .15;
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, mid, p2), 40, r, 8, false), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
}
const posOf = (loc?: string) => { const b = binOf(loc); return b ? binPos(b) : areaPos(loc?.split(':').pop() ?? ''); };

/** Arcs for the open move requests (yellow awaiting approval, blue approved) and the one being drawn. */
export function drawMoves(draft?: { from: Bin; to: Bin | null; toArea?: string } | null) {
  if (!cached) return;
  const g = cached.moveLine;
  g.children.forEach(o => (o as THREE.Mesh).geometry?.dispose());
  g.clear();
  const view = getStoreView();
  if (view?.site === getState().site) for (const mv of view.moves) {
    const a = posOf(mv.from), b = posOf(mv.to);
    if (a && b) g.add(arc(a, b, mv.status === 'approved' ? '#1450F5' : '#FFE141'));
  }
  const to = draft?.to ? binPos(draft.to) : draft?.toArea ? areaPos(draft.toArea) : null;
  if (draft && to) g.add(arc(binPos(draft.from), to, '#FFFFFF', .16));
}

/** The drop area under a ray, if any. */
export function areaAt(ray: THREE.Raycaster): string | null {
  if (!cached) return null;
  return (ray.intersectObjects(cached.zones, false)[0]?.object.userData.area as string) ?? null;
}
/** The camera under a ray, if any. */
export function cameraAt(ray: THREE.Raycaster): string | null {
  if (!cached || !cached.cams.visible) return null;
  return (ray.intersectObjects(cached.cams.children.map(g => g.userData.head as THREE.Object3D), true)[0]?.object.userData.camera as string) ?? null;
}
/** The put-away task of the inbound pallet under a ray, if any. */
export function ghostAt(ray: THREE.Raycaster): string | null {
  if (!cached || !cached.ghosts.visible) return null;
  return (ray.intersectObjects(cached.ghosts.children, true).find(h => h.object.userData.task)?.object.userData.task as string) ?? null;
}
