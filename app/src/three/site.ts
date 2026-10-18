// Site twin built from latitude/longitude: Esri satellite tiles as the ground, OpenStreetMap
// building footprints extruded to height, with KTEC roles assigned to the nearest large buildings.
// Falls back to stylised campus massing when Overpass is unreachable.
import * as THREE from 'three';
import type { Site } from '../data/types';
import { getState, isOn } from '../state/store';

export interface BuildingMeta {
  k: string;
  n: string;
  s: string;
  col?: string;
  alert?: boolean;
  c: THREE.Vector3;
  h: number;
  obj?: THREE.Object3D;
  mat?: THREE.MeshStandardMaterial;
  slabs?: THREE.Mesh[];
}
export interface Flow { curve: THREE.QuadraticBezierCurve3; ball: THREE.Mesh; off: number; label: string; col: string; layer: string; mid: THREE.Vector3 }
export interface SiteScene {
  sc: THREE.Scene;
  meta: Record<string, BuildingMeta>;
  flows: Flow[];
  src: 'osm' | 'proc';
  center: THREE.Vector3;
}

interface Footprint { pts: [number, number][]; area: number; c: [number, number]; h: number; d: number; role?: Role }
interface Role { k: string; n: string; s: string; col: string; alert?: boolean }
interface OsmWay { id: number; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> }

export const B2_FLOORS = ['L0 · Receiving and heavy', 'L1 · Electronics store', 'L2 · Lab stores'];
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const tileLoader = new THREE.TextureLoader();
tileLoader.setCrossOrigin('anonymous');

export function addLights(sc: THREE.Scene, big: number) {
  sc.add(new THREE.HemisphereLight(0xffffff, 0x8a8a7a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  sun.position.set(big * .6, big * 1.1, big * .4);
  sun.castShadow = true;
  const s = sun.shadow;
  s.mapSize.set(2048, 2048);
  Object.assign(s.camera, { left: -big, right: big, top: big, bottom: -big, far: big * 4 });
  s.bias = -.0005; s.normalBias = .5;
  sc.add(sun);
}

async function fetchFootprints(lat0: number, lon0: number, xz: (lat: number, lon: number) => [number, number]): Promise<Footprint[]> {
  const q = `[out:json][timeout:12];way["building"](around:520,${lat0},${lon0});out geom;`;
  let j: { elements?: OsmWay[] } | null = null;
  for (const ep of OVERPASS) {
    try {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ac.signal });
      clearTimeout(to);
      j = await r.json();
      break;
    } catch { /* try next mirror */ }
  }
  if (!j) return [];
  return (j.elements ?? []).filter(e => e.geometry && e.geometry.length > 3).map(e => {
    const pts = e.geometry!.map(g => { const [x, zz] = xz(g.lat, g.lon); return [x, -zz] as [number, number]; });
    // Shoelace area and centroid.
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], c = x0 * y1 - x1 * y0;
      a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    a /= 2;
    if (Math.abs(a) < 1) return null;
    cx /= 6 * a; cy /= 6 * a;
    const tg = e.tags ?? {};
    let h = parseFloat(tg.height) || (parseFloat(tg['building:levels']) * 3.4) || 0;
    if (!h) { const r2 = Math.abs(Math.sin(e.id)); h = Math.abs(a) > 2500 ? 10 + r2 * 6 : 5 + r2 * 7; }
    return { pts, area: Math.abs(a), c: [cx, cy] as [number, number], h: Math.min(h, 60), d: Math.hypot(cx, cy) };
  }).filter((b): b is Footprint => !!b);
}

function stylisedCampus(): Footprint[] {
  const rect = (x: number, y: number, w: number, d: number, h: number): Footprint =>
    ({ pts: [[x, y], [x + w, y], [x + w, y + d], [x, y + d], [x, y]], area: w * d, c: [x + w / 2, y + d / 2], h, d: Math.hypot(x + w / 2, y + d / 2) });
  return [rect(-40, -30, 90, 60, 14), rect(-150, -20, 70, 45, 11), rect(-40, 60, 55, 35, 16), rect(30, 60, 30, 24, 7), rect(70, 60, 26, 22, 6),
    rect(-150, 50, 60, 50, 9), rect(80, -70, 40, 30, 8), rect(140, 10, 60, 40, 9), rect(-60, -120, 80, 40, 10)];
}

const cache: Record<string, SiteScene> = {};
export const siteCached = (id: string) => !!cache[id];

export async function buildSite(site: Site): Promise<SiteScene> {
  if (cache[site.id]) return cache[site.id];
  const sc = new THREE.Scene();
  sc.background = new THREE.Color('#C9D3DD');
  sc.fog = new THREE.Fog('#C9D3DD', 900, 2600);
  addLights(sc, 420);
  const [lat0, lon0] = site.ll, mLat = 111320, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  const xz = (lat: number, lon: number): [number, number] => [(lon - lon0) * mLon, -(lat - lat0) * mLat];

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshStandardMaterial({ color: '#9C9F8C', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.2; ground.receiveShadow = true;
  sc.add(ground);

  // Satellite ground: a 7×7 block of zoom-17 Esri tiles around the site.
  const z = 17, n = 2 ** z, fx = (lon0 + 180) / 360 * n, la = lat0 * Math.PI / 180;
  const fy = (1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2 * n;
  const cx = Math.floor(fx), cy = Math.floor(fy), T = 3;
  const t2lon = (x: number) => x / n * 360 - 180;
  const t2lat = (y: number) => { const t = Math.PI - 2 * Math.PI * y / n; return 180 / Math.PI * Math.atan(.5 * (Math.exp(t) - Math.exp(-t))); };
  const imgGroup = new THREE.Group();
  sc.add(imgGroup);
  for (let dx = -T; dx <= T; dx++) for (let dy = -T; dy <= T; dy++) {
    const x = cx + dx, y = cy + dy;
    const [x1, z1] = xz(t2lat(y), t2lon(x)), [x2, z2] = xz(t2lat(y + 1), t2lon(x + 1));
    const mat = new THREE.MeshStandardMaterial({ color: '#9C9F8C', roughness: 1 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), mat);
    m.rotation.x = -Math.PI / 2; m.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2); m.receiveShadow = true;
    imgGroup.add(m);
    tileLoader.load(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, tex => {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      mat.map = tex; mat.color.set('#ffffff'); mat.needsUpdate = true;
    });
  }

  let blds = await fetchFootprints(lat0, lon0, xz).catch(() => []);
  const src = blds.length >= 5 ? 'osm' : 'proc';
  if (src === 'proc') blds = stylisedCampus();

  // The largest of the six nearest substantial buildings becomes B2 (stores); the rest take the other roles.
  const roles: Role[] = [
    { k: 'b2', n: 'Building B2 · Stores', s: `3 floors · ${site.space}% space`, col: '#A1B9FB' },
    { k: 'lab', n: 'R&D labs', s: '12 labs · 3 booked today', col: '#D2F5FF' },
    { k: 'adm', n: 'Admin and offices', s: 'Badge access', col: '#F7F8FA' },
    { k: 'haz', n: 'Hazmat store', s: '31 °C · limit 25 °C', col: '#FFCDD7', alert: true },
    { k: 'qua', n: 'Quarantine', s: '2 lots on hold', col: '#FFE141' },
    { k: 'stg', n: 'Staging and docks', s: '5 inbound today', col: '#AAE1C8' },
  ];
  const cand = blds.filter(b => b.area > 350 && b.d < 330).sort((a, b) => a.d - b.d).slice(0, 6);
  if (cand.length) {
    const big = cand.reduce((m, b) => (b.area > m.area ? b : m), cand[0]);
    cand.splice(cand.indexOf(big), 1); cand.unshift(big);
  }
  cand.forEach((b, i) => { b.role = roles[i]; });

  const ctxMat = new THREE.MeshStandardMaterial({ color: '#E3E5E8', roughness: .85 });
  const ctxGroup = new THREE.Group(), ktecGroup = new THREE.Group();
  sc.add(ctxGroup, ktecGroup);
  const mkGeo = (pts: [number, number][], h: number) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))), { depth: h, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  };
  const meta: Record<string, BuildingMeta> = {};
  blds.forEach(b => {
    if (!b.role) {
      const m = new THREE.Mesh(mkGeo(b.pts, b.h), ctxMat);
      m.castShadow = m.receiveShadow = true;
      ctxGroup.add(m);
      return;
    }
    const r = b.role, h = r.k === 'b2' ? Math.max(b.h, 15) : Math.max(b.h, 7);
    const mat = new THREE.MeshStandardMaterial({ color: r.col, roughness: .6, emissive: '#000000' });
    let obj: THREE.Object3D;
    let slabs: THREE.Mesh[] | undefined;
    if (r.k === 'b2') {
      obj = new THREE.Group();
      slabs = [];
      const fh = h / 3;
      B2_FLOORS.forEach((_, i) => {
        const sm = new THREE.MeshStandardMaterial({ color: i === 1 ? '#1450F5' : r.col, roughness: .55 });
        const m = new THREE.Mesh(mkGeo(b.pts, fh - .6), sm);
        m.castShadow = m.receiveShadow = true;
        m.userData = { k: 'b2', floor: i, base: i * fh };
        m.position.y = i * fh;
        obj.add(m); slabs!.push(m);
      });
    } else {
      obj = new THREE.Mesh(mkGeo(b.pts, h), mat);
      obj.castShadow = obj.receiveShadow = true;
      obj.userData = { k: r.k };
    }
    ktecGroup.add(obj);
    meta[r.k] = { ...r, c: new THREE.Vector3(b.c[0], 0, -b.c[1]), h, obj, mat, slabs };
  });

  // Test tower and scrap yard are modelled, not from OSM.
  const b2 = meta.b2 ? meta.b2.c : new THREE.Vector3();
  const towerPos = new THREE.Vector3(b2.x + 95, 0, b2.z - 55);
  const tower = new THREE.Group();
  const tb = new THREE.Mesh(new THREE.BoxGeometry(14, 72, 14), new THREE.MeshStandardMaterial({ color: '#C4C7CD', roughness: .5 }));
  tb.position.y = 36; tb.castShadow = true; tb.userData = { k: 'tow' };
  const band = new THREE.Mesh(new THREE.BoxGeometry(14.2, 4, 14.2), new THREE.MeshStandardMaterial({ color: '#1450F5', roughness: .4 }));
  band.position.y = 70;
  tower.add(tb, band); tower.position.copy(towerPos);
  ktecGroup.add(tower);
  meta.tow = { k: 'tow', n: 'Test tower', s: 'Shaft 2 in test · modelled', c: towerPos, h: 72, obj: tower };

  const yardPos = new THREE.Vector3(b2.x - 30, 0, b2.z + 120);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: '#F3EEEA', transparent: true, opacity: .8, roughness: 1 }));
  yard.rotation.x = -Math.PI / 2; yard.position.set(yardPos.x, .3, yardPos.z); yard.userData = { k: 'scr' };
  ktecGroup.add(yard);
  const yEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(60, 40)), new THREE.LineBasicMaterial({ color: '#C8312B' }));
  yEdge.rotation.x = -Math.PI / 2; yEdge.position.set(yardPos.x, .4, yardPos.z);
  ktecGroup.add(yEdge);
  for (let i = 0; i < 6; i++) {
    const bx = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 3), new THREE.MeshStandardMaterial({ color: i % 2 ? '#767A82' : '#4A4D55', roughness: .8 }));
    bx.position.set(yardPos.x - 20 + i * 8, 1.1, yardPos.z - 6 + (i % 3) * 5); bx.castShadow = true;
    ktecGroup.add(bx);
  }
  meta.scr = { k: 'scr', n: 'Scrap yard', s: '4 open cases · modelled', c: yardPos, h: 2 };

  // Internal material flows between buildings, drawn as arcs with a moving ball.
  const flowGroup = new THREE.Group();
  sc.add(flowGroup);
  const flows: Flow[] = [];
  const top = (k: string) => (meta[k] ? meta[k].c.clone().setY(meta[k].h + 2) : null);
  const FL: [string, string, string, string, string][] = [
    ['b2', 'lab', '#A1B9FB', 'Prototype build · 24 units', 'flows'],
    ['lab', 'tow', '#D2F5FF', 'Lab test · 6 units', 'flows'],
    ['tow', 'scr', '#C8312B', 'Scrap · SC-2026-0418', 'scrapf'],
    ['b2', 'qua', '#FFE141', 'Quarantine · 2 lots', 'flows'],
    ['stg', 'b2', '#AAE1C8', 'Put-away · 18 pallets', 'flows'],
  ];
  const flowGroups: THREE.Group[] = [];
  FL.forEach(([a, b, col, label, layer], i) => {
    const p0 = top(a), p2 = top(b);
    if (!p0 || !p2) return;
    const mid = p0.clone().add(p2).multiplyScalar(.5);
    mid.y += Math.max(30, p0.distanceTo(p2) * .45);
    const curve = new THREE.QuadraticBezierCurve3(p0, mid, p2);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 1.1, 8, false), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .9 }));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(3.2, 20, 12), new THREE.MeshBasicMaterial({ color: '#FFFFFF' }));
    const g = new THREE.Group();
    g.add(tube, ball); g.userData.layer = layer;
    flowGroup.add(g); flowGroups.push(g);
    flows.push({ curve, ball, off: i * .21, label, col, layer, mid: curve.getPoint(.5) });
  });

  sc.userData.tick = (t: number) => {
    const s = getState();
    const peel = s.peel && s.screen === 'site';
    meta.b2?.slabs?.forEach((m, i) => {
      const target = m.userData.base + (peel ? i * 9 : 0);
      m.position.y += (target - m.position.y) * .12;
    });
    flows.forEach(f => { f.ball.position.copy(f.curve.getPoint((t * .18 + f.off) % 1)); });
    flowGroup.visible = s.screen === 'movements';
    flowGroups.forEach(g => { g.visible = isOn(s, 'movements', g.userData.layer); });
    ctxGroup.visible = isOn(s, s.screen, 'ctx');
    imgGroup.visible = isOn(s, 'site', 'img');
    Object.values(meta).forEach(m => {
      if (!m.mat) return;
      m.mat.emissive.set(s.bld === m.k ? '#1450F5' : '#000000');
      m.mat.emissiveIntensity = .35;
    });
  };

  return (cache[site.id] = { sc, meta, flows, src, center: b2 });
}
