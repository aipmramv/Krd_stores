// Furnished interior for one opened floor of a modelled tower: carpet, service core with lifts,
// columns, workstation clusters, glass meeting rooms and, on the store floor, the ESD electronics
// store with rack rows. Built on demand from the floor plate outline stored in the Blender model.
import * as THREE from 'three';

type P = [number, number]; // scene x, z

function inside([x, z]: P, poly: P[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

const mat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: .7, emissive: color, emissiveIntensity: .08, ...o });

const MATS = {
  carpet: mat('#7E8792', { roughness: 1, emissiveIntensity: .05 }),
  esd: mat('#5F7FA6', { roughness: .9 }),
  core: mat('#D9D5CD', { roughness: .85 }),
  lift: mat('#3B3F45', { metalness: .6, roughness: .3, emissiveIntensity: 0 }),
  column: mat('#E4E2DD', { roughness: .8 }),
  desk: mat('#F2F0EB', { roughness: .5 }),
  screen: mat('#9AA6B2', { roughness: .9 }),
  chair: mat('#2E3238', { roughness: .8, emissiveIntensity: 0 }),
  monitor: mat('#15171A', { roughness: .3, emissive: '#5A86FF', emissiveIntensity: .25 }),
  glass: new THREE.MeshStandardMaterial({ color: '#BFD8E6', roughness: .05, metalness: .1, transparent: true, opacity: .28, depthWrite: false }),
  table: mat('#B58A5A', { roughness: .6 }),
  rack: mat('#5A6068', { metalness: .5, roughness: .4 }),
  line: new THREE.MeshBasicMaterial({ color: '#FFE141', toneMapped: false }),
};
const BIN_COLS = ['#1450F5', '#A1B9FB', '#AAE1C8', '#FFE141', '#D2F5FF'];

function instanced(geo: THREE.BufferGeometry, m: THREE.Material, mats: THREE.Matrix4[], cols?: THREE.Color[]) {
  const im = new THREE.InstancedMesh(geo, m, Math.max(1, mats.length));
  mats.forEach((x, i) => { im.setMatrixAt(i, x); if (cols) im.setColorAt(i, cols[i]); });
  im.count = mats.length;
  im.castShadow = im.receiveShadow = true;
  return im;
}
const at = (x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

export interface Interior { group: THREE.Group; ceiling: THREE.Object3D; store?: THREE.Vector3; storePad?: THREE.Mesh }

/** `plan` is the floor's inner glass line in scene x/z; the group sits at the floor level. */
export function buildInterior(plan: P[], h: number, store: boolean): Interior {
  const g = new THREE.Group();
  const xs = plan.map(p => p[0]), zs = plan.map(p => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, W = x1 - x0, D = z1 - z0;
  const long = W >= D;
  const fits = (x: number, z: number, m: number) => [[x - m, z - m], [x + m, z - m], [x + m, z + m], [x - m, z + m]].every(p => inside(p as P, plan));

  // Carpet.
  const shape = new THREE.Shape(plan.map(([x, z]) => new THREE.Vector2(x, -z)));
  const carpet = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), MATS.carpet);
  carpet.position.y = .1; carpet.receiveShadow = true;
  g.add(carpet);

  // Service core: lifts, stairs and toilets in the middle of the plate.
  const coreW = long ? Math.min(28, W * .26) : 12, coreD = long ? 11 : Math.min(28, D * .26);
  const core = new THREE.Mesh(new THREE.BoxGeometry(coreW, h - .3, coreD), MATS.core);
  core.position.set(cx, (h - .3) / 2, cz); core.castShadow = core.receiveShadow = true;
  g.add(core);
  const lifts: THREE.Matrix4[] = [];
  for (let i = 0; i < 4; i++) {
    const o = -coreW / 2 + coreW * (i + 1.5) / 6;
    lifts.push(at(cx + (long ? o : 0), 1.2, cz + (long ? coreD / 2 + .03 : o), long ? 0 : Math.PI / 2));
  }
  g.add(instanced(new THREE.BoxGeometry(1.4, 2.4, .06), MATS.lift, lifts));
  const inCore = (x: number, z: number, m: number) => Math.abs(x - cx) < coreW / 2 + m && Math.abs(z - cz) < coreD / 2 + m;

  // Store wing: the east third of the plate on the store floor.
  const storeX = store ? cx + W * .18 : Infinity;
  const inStore = (x: number) => x > storeX;

  // Columns on a 9 m grid.
  const cols: THREE.Matrix4[] = [];
  for (let x = cx - Math.floor(W / 18) * 9; x <= x1; x += 9) for (let z = cz - Math.floor(D / 18) * 9; z <= z1; z += 9) {
    if (fits(x, z, 2.5) && !inCore(x, z, 1)) cols.push(at(x, (h - .3) / 2, z));
  }
  g.add(instanced(new THREE.CylinderGeometry(.38, .38, h - .3, 12), MATS.column, cols));

  // Meeting rooms with glass walls at both ends of the core.
  const rooms = new THREE.Group();
  for (const s of [-1, 1]) {
    const rx = long ? cx + s * (coreW / 2 + 4.5) : cx, rz = long ? cz : cz + s * (coreD / 2 + 4.5);
    if (store && inStore(rx)) continue;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(long ? 7 : 10, 2.9, long ? 10 : 7), MATS.glass);
    wall.position.set(rx, 1.45, rz);
    const table = new THREE.Mesh(new THREE.BoxGeometry(long ? 2 : 5, .75, long ? 5 : 2), MATS.table);
    table.position.set(rx, .45, rz); table.castShadow = true;
    rooms.add(wall, table);
  }
  g.add(rooms);

  // Workstation pods (two facing desks pairs) on an open-plan grid.
  const desks: THREE.Matrix4[] = [], scr: THREE.Matrix4[] = [], chairs: THREE.Matrix4[] = [], mons: THREE.Matrix4[] = [];
  const sx = 4.4, sz = 4;
  for (let x = x0 + 4; x < x1 - 3; x += sx) for (let z = z0 + 4; z < z1 - 3; z += sz) {
    if (!fits(x, z, 2.6) || inCore(x, z, 4) || (store && x > storeX - 3)) continue;
    if (cols.some(c => { const p = new THREE.Vector3().setFromMatrixPosition(c); return Math.abs(p.x - x) < 2 && Math.abs(p.z - z) < 1.3; })) continue;
    desks.push(at(x, .74, z));
    scr.push(at(x, 1.0, z));
    for (const dx of [-.8, .8]) for (const dz of [-1.05, 1.05]) {
      chairs.push(at(x + dx, .45, z + dz * 1.0));
      mons.push(at(x + dx, .98, z + dz * .3));
    }
  }
  g.add(instanced(new THREE.BoxGeometry(3.2, .05, 1.6), MATS.desk, desks));
  g.add(instanced(new THREE.BoxGeometry(3.2, .45, .04), MATS.screen, scr));
  g.add(instanced(new THREE.BoxGeometry(.5, .9, .5), MATS.chair, chairs));
  g.add(instanced(new THREE.BoxGeometry(.56, .34, .04), MATS.monitor, mons));

  // Ceiling with light panels, shown only when walking inside (it would hide the floor from above).
  const ceiling = new THREE.Group();
  const ceil = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), mat('#ECEBE7', { roughness: .9, emissiveIntensity: .35, side: THREE.DoubleSide }));
  ceil.position.y = h - .35;
  const panels: THREE.Matrix4[] = [];
  for (let x = x0 + 3; x < x1 - 2; x += 3.6) for (let z = z0 + 3; z < z1 - 2; z += 3.6) if (fits(x, z, 1.5) && !inCore(x, z, .5)) panels.push(at(x, h - .37, z));
  const lights = instanced(new THREE.BoxGeometry(1.2, .02, .6), new THREE.MeshBasicMaterial({ color: '#FFF8EC', toneMapped: false }), panels);
  lights.castShadow = false;
  ceiling.add(ceil, lights);
  ceiling.visible = false;
  g.add(ceiling);

  const res: Interior = { group: g, ceiling };
  if (store) {
    // ESD electronics store: blue ESD floor, yellow boundary, four rack rows with coloured bins.
    const pts = plan.filter(([x]) => x > storeX);
    const sx0 = storeX + 1.5, sx1 = Math.max(...pts.map(p => p[0])) - 4;
    const zs2 = pts.map(p => p[1]);
    const sz0 = Math.min(...zs2) + 4, sz1 = Math.max(...zs2) - 4;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(sx1 - sx0, sz1 - sz0).rotateX(-Math.PI / 2), MATS.esd);
    pad.position.set((sx0 + sx1) / 2, .13, (sz0 + sz1) / 2); pad.receiveShadow = true;
    g.add(pad);
    const edge: THREE.Matrix4[] = [];
    const ew = sx1 - sx0, ed = sz1 - sz0, mx = (sx0 + sx1) / 2, mz = (sz0 + sz1) / 2;
    edge.push(at(mx, .15, sz0, 0, ew, 1, 1), at(mx, .15, sz1, 0, ew, 1, 1), at(sx0, .15, mz, Math.PI / 2, ed, 1, 1), at(sx1, .15, mz, Math.PI / 2, ed, 1, 1));
    g.add(instanced(new THREE.BoxGeometry(1, .02, .12), MATS.line, edge));
    const racks: THREE.Matrix4[] = [], shelves: THREE.Matrix4[] = [], bins: THREE.Matrix4[] = [], binCol: THREE.Color[] = [];
    const rows = 4, len = Math.min(ew - 5, 22);
    for (let r = 0; r < rows; r++) {
      const z = sz0 + ed * (r + 1) / (rows + 1);
      // Back-to-back shelving: a spine with shelves, bins facing both aisles.
      racks.push(at(mx, 1.1, z, 0, len, 1, 1));
      for (let lv = 0; lv < 4; lv++) {
        shelves.push(at(mx, .14 + lv * .52, z, 0, len, 1, 1));
        for (const side of [-1, 1]) for (let i = 0; i < Math.floor(len / .62); i++) {
          if ((i * 7 + lv * 3 + r + side) % 6 === 0) continue;
          bins.push(at(mx - len / 2 + .31 + i * .62, .32 + lv * .52, z + side * .33));
          binCol.push(new THREE.Color(BIN_COLS[(i + lv * 2 + r + (side > 0 ? 1 : 0)) % BIN_COLS.length]));
        }
      }
    }
    g.add(instanced(new THREE.BoxGeometry(1, 2.2, .06), MATS.rack, racks));
    g.add(instanced(new THREE.BoxGeometry(1, .04, 1.2), MATS.rack, shelves));
    g.add(instanced(new THREE.BoxGeometry(.54, .32, .5), new THREE.MeshStandardMaterial({ roughness: .6 }), bins, binCol));
    res.store = new THREE.Vector3(mx, 2.6, mz);
    res.storePad = pad;
  }
  return res;
}
