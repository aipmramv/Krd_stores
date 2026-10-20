// Electronics store twin: racks with instanced bins coloured by the active mode, zones,
// planned inbound pallets as translucent ghosts, and a pulsing exception bin.
import * as THREE from 'three';
import { LEGENDS } from '../data/sample';
import { BAYS, binColor, binId, binOf, EXCEPTION_BIN, isReserved, LEVELS, rnd, ROWS } from '../data/storeModel';
import type { Bin, ColorMode } from '../data/types';
import type { Part, StockLot } from '../db/schema';
import { getStoreView } from '../services/storeView';
import { getState, isOn } from '../state/store';

export const BAY = 2.7, LV = 1.55, ROWZ = [-9, -3, 3, 9], X0 = -16.2;
export const binPos = ({ r, i, k }: Bin) => new THREE.Vector3(X0 + i * BAY + BAY / 2, .35 + k * LV + .6, ROWZ[r]);

export interface StoreScene {
  sc: THREE.Scene;
  bins: THREE.InstancedMesh;
  idx: Bin[];
  moveLine: THREE.Group;
}

let cached: StoreScene | null = null;

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

  const zone = (x: number, z: number, w: number, dd: number, col: string, op = .22) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, .03, z); sc.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, dd)), new THREE.LineBasicMaterial({ color: col }));
    e.rotation.x = -Math.PI / 2; e.position.set(x, .05, z); sc.add(e);
  };
  zone(-1.5, -6, 36, 9, '#D2F5FF', .12);   // ESD protected area
  zone(19.5, -9, 7, 10, '#FFE141');        // quarantine cage
  zone(-1.5, 13.5, 40, 5, '#AAE1C8', .16); // staging
  zone(19.5, 4, 7, 8, '#FFCDD7');          // hazmat cabinet

  const frameM = new THREE.MeshStandardMaterial({ color: '#2C2E33', roughness: .6, metalness: .4 });
  const beamM = new THREE.MeshStandardMaterial({ color: '#1450F5', roughness: .5, metalness: .3 });
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
  const bins = new THREE.InstancedMesh(new THREE.BoxGeometry(BAY - .3, 1.15, 1.15), new THREE.MeshStandardMaterial({ roughness: .7 }), count);
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

  const ghosts = new THREE.Group();
  sc.add(ghosts);
  let ghostN = 0;
  const mkGhosts = (c: number) => {
    ghosts.clear();
    for (let i = 0; i < c; i++) {
      const g = new THREE.BoxGeometry(2.4, 1.6, 2.2);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#A1B9FB', transparent: true, opacity: .14, depthWrite: false }));
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineDashedMaterial({ color: '#A1B9FB', dashSize: .3, gapSize: .2 }));
      e.computeLineDistances();
      const grp = new THREE.Group();
      grp.add(m, e); grp.position.set(-17 + i * 3.6, .8, 13.5);
      ghosts.add(grp);
    }
    ghostN = c;
  };
  mkGhosts(5);

  const exc = new THREE.Mesh(new THREE.BoxGeometry(BAY - .25, 1.2, 1.2), new THREE.MeshStandardMaterial({ color: '#C8312B', emissive: '#C8312B', emissiveIntensity: .6, transparent: true, opacity: .95 }));
  exc.position.copy(binPos(EXCEPTION_BIN));
  sc.add(exc);
  const selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BAY - .1, 1.35, 1.35)), new THREE.LineBasicMaterial({ color: '#FFFFFF' }));
  sc.add(selBox);
  const moveLine = new THREE.Group();
  sc.add(moveLine);

  sc.userData.tick = (t: number) => {
    const s = getState();
    // The pulsing bin marks the first open count variance; ghosts stand for waiting put-aways.
    const view = getStoreView()?.site === s.site ? getStoreView() : null;
    const excBin = view ? binOf(view.counts[0]?.from) : EXCEPTION_BIN;
    exc.visible = isOn(s, 'store', 'exc') && !!excBin;
    if (excBin) exc.position.copy(binPos(excBin));
    (exc.material as THREE.MeshStandardMaterial).emissiveIntensity = .35 + .45 * (.5 + .5 * Math.sin(t * 4.5));
    ghosts.visible = isOn(s, 'store', 'ghost');
    selBox.position.copy(binPos(s.bin));
    // A second PO lands a week out, so the forecast shows more planned pallets.
    const want = Math.min(10, (view ? view.putaways.reduce((n, m) => n + Math.max(1, Math.round(m.qty / 10)), 0) : 5) + (s.t > 7 ? 3 : 0));
    if (want !== ghostN) mkGhosts(want);
  };

  cached = { sc, bins, idx, moveLine };
  recolorBins();
  return cached;
}

const EMPTY = '#3A3D44';
const PROJECT: Record<string, number> = { 'DX Class 2027': 0, 'MonoSpace retrofit': 1, 'Escalator drive test': 2 };

/** Colour and fill of a bin from its stock lots, for the active colour mode. */
export function binLook(mode: ColorMode, lots: StockLot[], parts: Map<string, Part>, capacity: number): { col: string; fill: number } {
  const qty = lots.reduce((n, l) => n + l.qty, 0);
  if (!qty) return { col: EMPTY, fill: .06 };
  const L = LEGENDS[mode], f = Math.min(1, qty / capacity);
  const fill = .2 + .8 * f;
  if (mode === 'occupancy') return { col: f < .25 ? L[0][0] : f < .5 ? L[1][0] : f < .75 ? L[2][0] : f < .92 ? L[3][0] : L[4][0], fill };
  if (mode === 'ageing') {
    const days = Math.max(...lots.map(l => (Date.now() - Date.parse(l.receivedAt)) / 86400000));
    return { col: days < 30 ? L[0][0] : days < 90 ? L[1][0] : days < 180 ? L[2][0] : L[3][0], fill };
  }
  if (mode === 'project') return { col: L[PROJECT[lots[0].project] ?? 3][0], fill };
  const hz = lots.map(l => parts.get(l.partNo)?.hazard ?? '');
  return { col: hz.some(h => /UN\d|Flammable/.test(h)) ? L[2][0] : hz.some(h => h === 'ESD') ? L[0][0] : L[3][0], fill };
}

export function recolorBins() {
  if (!cached) return;
  const { bins, idx } = cached, s = getState(), c = new THREE.Color(), m = new THREE.Matrix4();
  const resv = isOn(s, 'store', 'resv'), view = getStoreView()?.site === s.site ? getStoreView() : null;
  idx.forEach((b, n) => {
    if (!view) { c.set(resv && isReserved(b) ? '#FFFFFF' : binColor(s.mode, b)); bins.setColorAt(n, c); return; }
    const code = binId(b), lots = view.lots.get(code) ?? [];
    const { col, fill } = binLook(s.mode, lots, view.parts, view.locs.get(code)?.capacity ?? 60);
    c.set(resv && lots.some(l => l.reserved > 0) ? '#FFFFFF' : col);
    bins.setColorAt(n, c);
    const p = binPos(b);
    m.compose(p.setY(p.y - .575 * (1 - fill)), new THREE.Quaternion(), new THREE.Vector3(1, fill, 1));
    bins.setMatrixAt(n, m);
  });
  bins.instanceColor!.needsUpdate = true;
  bins.instanceMatrix.needsUpdate = true;
  bins.computeBoundingSphere();
}

function arc(a: Bin, b: Bin, col: string, r = .12) {
  const p0 = binPos(a), p2 = binPos(b), mid = p0.clone().add(p2).multiplyScalar(.5);
  mid.y += 3 + p0.distanceTo(p2) * .15;
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, mid, p2), 40, r, 8, false), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
}

/** Arcs for the open move requests (yellow awaiting approval, blue approved) and the one being drawn. */
export function drawMoves(draft?: { from: Bin; to: Bin | null } | null) {
  if (!cached) return;
  const g = cached.moveLine;
  g.children.forEach(o => (o as THREE.Mesh).geometry?.dispose());
  g.clear();
  const view = getStoreView();
  if (view?.site === getState().site) for (const mv of view.moves) {
    const a = binOf(mv.from), b = binOf(mv.to);
    if (a && b) g.add(arc(a, b, mv.status === 'approved' ? '#1450F5' : '#FFE141'));
  }
  if (draft?.to) g.add(arc(draft.from, draft.to, '#FFFFFF', .16));
}
