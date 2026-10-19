// three.js renderer shared by the Site twin, Movements and Store twin screens.
// The camera's view offset keeps the scene centred in the area not covered by panels, and the
// site camera can start exactly where the map left off, so map ↔ 3D transitions are seamless.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SITE_BY_ID } from '../data/sites';
import { EXCEPTION_BIN, ROWS } from '../data/storeModel';
import type { Bin } from '../data/types';
import { HANDOFF_ZOOM, metresPerPixel, stageSafeArea, type Rect } from '../safeArea';
import { binAction, completeMove, go, openPhoto, selectBin, selectBuilding, toast } from '../state/actions';
import { getState, isOn, setState, subscribe, THREE_SCREENS } from '../state/store';
import { Labels } from './labels';
import { buildSite, setHovered, siteCached, type SiteScene } from './site';
import { binPos, buildStore, drawMove, recolorBins, ROWZ, X0 } from './store3d';
import type { PhotorealTiles } from './tiles';

const RADIAL = ['Move', 'Reserve', 'Count', 'Scrap', 'History', 'Docs'];
const H = () => document.documentElement;
const rem = () => parseFloat(getComputedStyle(H()).fontSize);

interface Tween { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; s: number; ms: number; done?: () => void }

/** Base date of the sample data; the timeline offsets from it. */
const TODAY_UTC = Date.UTC(2026, 9, 18);
const istNow = () => { const d = new Date(); return (d.getUTCHours() + d.getUTCMinutes() / 60 + 5.5) % 24; };
export function sceneDate() {
  const s = getState(), h = s.tod ?? istNow();
  return new Date(TODAY_UTC + s.t * 86400000 + (h - 5.5) * 3600000);
}

class ThreeEngine {
  private R: THREE.WebGLRenderer | null = null;
  private cam = new THREE.PerspectiveCamera(42, 1, 1, 60000);
  private ctl: OrbitControls | null = null;
  private el: HTMLElement | null = null;
  private radialEl: HTMLElement | null = null;
  private labels: Labels | null = null;
  private active: THREE.Scene | null = null;
  private site: SiteScene | null = null;
  private tiles: { id: string; pr: PhotorealTiles } | null = null;
  private tween: Tween | null = null;
  private sa: Rect | null = null;
  private saFrame = 0;
  private radialAt: THREE.Vector3 | null = null;
  /** The 3D screen shown last; null after leaving 3D, so re-entry starts from an overhead shot. */
  private prev: string | null = null;
  private fpsN = 0;
  private fpsT = performance.now();
  private sunT = 0;
  private ray = new THREE.Raycaster();
  private hoverAt = 0;

  init(el: HTMLElement, labelsEl: HTMLElement, radialEl: HTMLElement) {
    if (this.R) return;
    this.el = el; this.radialEl = radialEl; this.labels = new Labels(labelsEl);
    const R = this.R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    R.setPixelRatio(Math.min(devicePixelRatio, 2));
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFShadowMap;
    R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping;
    el.appendChild(R.domElement);
    const ctl = this.ctl = new OrbitControls(this.cam, R.domElement);
    ctl.enableDamping = true; ctl.dampingFactor = .08; ctl.screenSpacePanning = false; ctl.maxPolarAngle = 1.45;
    ctl.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    ctl.autoRotateSpeed = .5;
    // Any manual orbit ends a cinematic tour and an in-flight camera move.
    ctl.addEventListener('start', () => { this.tween = null; if (getState().tour) setState({ tour: false }); });
    // Treat a press that barely moves as a tap, so orbiting never selects things.
    let down: [number, number] | null = null;
    R.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    R.domElement.addEventListener('pointerup', e => {
      if (!down) return;
      const d = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (d < 8) this.pick(e);
    });
    R.domElement.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') this.hover(e); });
    new ResizeObserver(() => this.resize()).observe(el);
    addEventListener('resize', () => { this.sa = null; });
    document.addEventListener('transitionend', () => { this.sa = null; });
    subscribe(() => this.sync());
    this.resize();
    this.loop();
  }

  private hidden() { return !this.el || this.el.classList.contains('hidden'); }

  resize() {
    if (!this.R || !this.el) return;
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.R.setSize(w, h, false);
    this.cam.aspect = w / h;
    this.sa = null;
    this.applyOffset();
  }

  private applyOffset() {
    if (!this.el) return;
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    if (!this.sa) this.sa = stageSafeArea();
    const cx = (this.sa.l + this.sa.r) / 2, cy = (this.sa.t + this.sa.b) / 2;
    this.cam.setViewOffset(w, h, -(cx - w / 2), -(cy - h / 2), w, h);
    this.cam.updateProjectionMatrix();
  }

  /** How far to pull the camera back so the scene fits the safe area. */
  private fitK() {
    const w = this.el!.clientWidth || 1, h = this.el!.clientHeight || 1;
    if (!this.sa) this.sa = stageSafeArea();
    const sa = this.sa;
    return Math.max(1, Math.min(2.4, Math.max(w / Math.max(200, sa.r - sa.l), h / Math.max(200, sa.b - sa.t)) * .92));
  }

  private fly(pos: THREE.Vector3Tuple | THREE.Vector3, target: THREE.Vector3Tuple | THREE.Vector3, ms = 1100, delay = 0) {
    const v = (x: THREE.Vector3Tuple | THREE.Vector3) => (x instanceof THREE.Vector3 ? x.clone() : new THREE.Vector3(...x));
    return new Promise<void>(done => {
      this.tween = { p0: this.cam.position.clone(), t0: this.ctl!.target.clone(), p1: v(pos), t1: v(target), s: performance.now() + delay, ms, done };
    });
  }

  /** React to store changes that need the scene: tour, photoreal mode, photo pins. */
  private lastPhotos: unknown = null;
  private sync() {
    const s = getState();
    if (this.ctl) this.ctl.autoRotate = s.tour && (s.screen === 'site' || s.screen === 'movements');
    if (this.site && s.stage === 'three') {
      this.applyPhotoreal();
      const ph = s.photos[this.site.site.id];
      if (ph !== this.lastPhotos) { this.lastPhotos = ph; this.siteLabels(this.site); }
    }
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.hidden() || !this.active || !this.R || !this.ctl) return;
    const now = performance.now(), t = now / 1000;
    const tw = this.tween;
    if (tw && now >= tw.s) {
      let k = Math.min(1, (now - tw.s) / tw.ms);
      k = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      this.cam.position.lerpVectors(tw.p0, tw.p1, k);
      this.ctl.target.lerpVectors(tw.t0, tw.t1, k);
      if (k >= 1) { this.tween = null; tw.done?.(); }
    }
    this.ctl.update();
    const site = this.active === this.site?.sc ? this.site : null;
    if (site) {
      // Depth range, haze and sun follow the camera and the selected time.
      const dist = this.cam.position.distanceTo(this.ctl.target);
      this.cam.near = THREE.MathUtils.clamp(dist / 400, .5, 8);
      this.cam.far = 60000;
      this.cam.updateProjectionMatrix();
      const fog = site.sc.fog as THREE.Fog;
      fog.near = dist * 1.2 + 600; fog.far = dist * 4 + 6000;
      if (now - this.sunT > 400) {
        this.sunT = now;
        const [lat, lon] = site.site.ll;
        site.sky.update(this.R, sceneDate(), lat, lon);
        fog.color.set(site.sky.day > .5 ? '#C6D0D9' : site.sky.day > .1 ? '#8A7E78' : '#141A26');
        this.R.toneMappingExposure = .42 + .2 * site.sky.day;
        const sun = site.sky.sun;
        sun.target.position.copy(this.ctl.target);
        sun.position.add(this.ctl.target);
      }
      if (this.tiles && this.tiles.id === site.site.id) this.tiles.pr.update(this.cam, this.R);
    } else this.R.toneMappingExposure = 1.05;
    this.active.userData.tick?.(t);
    this.R.render(this.active, this.cam);
    this.updateOverlay();
    this.fpsN++;
    if (now - this.fpsT > 1000) {
      const fps = document.getElementById('fps');
      if (fps) fps.textContent = Math.round(this.fpsN * 1000 / (now - this.fpsT)) + ' fps';
      this.fpsN = 0; this.fpsT = now;
    }
  };

  private updateOverlay() {
    const w = this.el!.clientWidth, h = this.el!.clientHeight;
    if (!this.sa || (this.saFrame++ % 15) === 0) { this.sa = stageSafeArea(); this.applyOffset(); }
    let ring: { x: number; y: number; r: number } | null = null;
    const rd = this.radialEl!;
    if (this.radialAt && !rd.classList.contains('hidden')) {
      const v = this.radialAt.clone().project(this.cam);
      const x = (v.x * .5 + .5) * w, y = (-v.y * .5 + .5) * h;
      rd.style.transform = `translate(${x}px,${y}px)`;
      const rr = rd.querySelector<HTMLElement>('.ring');
      ring = { x, y, r: rr ? rr.offsetWidth / 2 + 6 : 0 };
    }
    this.labels!.update(this.cam, w, h, this.sa, ring);
  }

  // ---------- Radial bin menu ----------
  showRadial() {
    const rd = this.radialEl;
    if (!rd || getState().screen !== 'store') return;
    this.radialAt = binPos(getState().bin).add(new THREE.Vector3(0, .7, 0));
    const px = rem(), r = Math.max(64, (getState().kiosk ? 3.25 : 2.75) * px * 1.65);
    rd.innerHTML = `<div class="ring" style="width:${r * 2 + px * 3.5}px;height:${r * 2 + px * 3.5}px"></div>`;
    RADIAL.forEach((a, j) => {
      const ang = -Math.PI / 2 + j * Math.PI / 3, b = document.createElement('button');
      if (j === 0) b.className = 'p';
      b.style.left = `${(Math.cos(ang) * r).toFixed(1)}px`;
      b.style.top = `${(Math.sin(ang) * r).toFixed(1)}px`;
      b.textContent = a;
      b.addEventListener('click', () => binAction(a));
      rd.appendChild(b);
    });
    rd.classList.remove('hidden');
  }
  hideRadial() { this.radialEl?.classList.add('hidden'); this.radialAt = null; }
  /** Rebuild the radial at the current size, e.g. after switching touch density. */
  refreshRadial() { if (this.radialAt) this.showRadial(); }

  // ---------- Picking and hover ----------
  private ndc(e: PointerEvent) {
    const rect = this.R!.domElement.getBoundingClientRect();
    return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  }
  private facilityAt(e: PointerEvent) {
    if (!this.site || this.active !== this.site.sc || getState().photoreal) return null;
    this.ray.setFromCamera(this.ndc(e), this.cam);
    return this.ray.intersectObjects(this.site.pickables, false)[0] ?? null;
  }
  private hover(e: PointerEvent) {
    const now = performance.now();
    if (now - this.hoverAt < 60) return;
    this.hoverAt = now;
    const hit = this.facilityAt(e);
    setHovered(hit ? hit.object.userData.k : null);
    this.R!.domElement.style.cursor = hit ? 'pointer' : '';
  }

  private pick(e: PointerEvent) {
    const s = getState();
    if (s.screen === 'store') {
      this.ray.setFromCamera(this.ndc(e), this.cam);
      const st = buildStore(), hit = this.ray.intersectObject(st.bins)[0];
      if (hit && hit.instanceId !== undefined) {
        const b = st.idx[hit.instanceId];
        if (s.moveFrom) { this.makeMove(s.moveFrom, b); return; }
        selectBin(b); this.showRadial(); return;
      }
      this.hideRadial();
      return;
    }
    const hit = this.facilityAt(e);
    if (!hit) return;
    const { k, floor } = hit.object.userData;
    const main = this.site!.meta.main;
    // Tapping the peeled-open store floor of the selected primary building drills into the store.
    if (k === 'main' && floor === main?.f.storeFloor && s.bld === 'main' && s.peel) { go('store'); return; }
    selectBuilding(k);
    this.focus(k);
  }

  /** Fly to frame one facility, keeping the current viewing direction. */
  focus(k: string) {
    const m = this.site?.meta[k];
    if (!m || !this.ctl) return;
    const target = m.c.clone().setY(Math.min(m.h, 80) * .4);
    const dir = this.cam.position.clone().sub(this.ctl.target).normalize();
    if (dir.y < .35) { dir.y = .35; dir.normalize(); }
    const dist = Math.max(90, m.size * 3 + m.h * 1.4) * this.fitK();
    this.fly(target.clone().addScaledVector(dir, dist), target, 1200);
  }

  private makeMove(a: Bin, b: Bin) {
    drawMove(a, b);
    completeMove(a, b);
    this.showRadial();
  }

  // ---------- Labels ----------
  private siteLabels(res: SiteScene) {
    const L = this.labels!;
    L.clear();
    const s0 = getState();
    const lbl = () => { const s = getState(); return isOn(s, s.screen === 'movements' ? 'movements' : 'site', 'lbl'); };
    Object.values(res.meta).forEach(m => {
      const f = m.f;
      if (m.slabs && f.floors) {
        f.floors.forEach(([n, space], i) => {
          const slab = m.slabs![i], isStore = i === f.storeFloor;
          L.add(() => new THREE.Vector3(m.c.x, slab.position.y + m.h / f.floors!.length * .5, m.c.z), `<b>${n}</b><span>${space === '—' ? 'No stock' : space + ' space'}</span>`, {
            cls: isStore ? 'on' : '', onClick: isStore ? () => go('store') : () => { selectBuilding('main'); this.focus('main'); },
            show: () => getState().screen === 'site' && getState().peel && lbl(), ax: 0, ay: -.5, dx: 24, pri: 4 - i,
          });
        });
        L.add(m.c.clone().setY(m.h + 14), `<b>${f.n}</b><span>${f.s}</span>`, {
          onClick: () => { selectBuilding('main'); this.focus('main'); }, pri: 3,
          show: () => { const s = getState(); return (s.screen === 'movements' || !s.peel) && lbl(); },
        });
        return;
      }
      L.add(m.c.clone().setY(m.h + 4), `<b>${f.n}</b><span>${f.s}</span>`, {
        cls: f.alert && isOn(s0, 'site', 'alerts3') ? 'bad' : '', pri: f.alert ? 2 : 0,
        onClick: () => { selectBuilding(m.k); this.focus(m.k); }, show: lbl,
      });
    });
    res.flows.forEach(f => {
      const el = L.add(f.mid, f.label, { cls: 'flow', tag: 'span', ay: -.5, show: () => { const s = getState(); return s.screen === 'movements' && isOn(s, 'movements', f.layer); } });
      el.style.background = f.col;
      if (f.col === '#C8312B') el.style.color = '#fff';
    });
    const ph = s0.photos[res.site.id];
    if (ph?.status === 'ready') {
      ph.items.forEach((p, i) => {
        if (!p.ll) return;
        const pos = res.toScene(p.ll[0], p.ll[1]);
        if (pos.length() > 1300) return;
        const el = L.add(pos.setY(10), `<img src="${p.thumb}" alt="" loading="lazy">`, {
          cls: 'photo', onClick: () => openPhoto(res.site.id, i), pri: -1,
          show: () => { const s = getState(); return s.screen === 'site' && isOn(s, 'site', 'photos') && !el.dataset.broken; },
        });
        el.querySelector('img')!.addEventListener('error', () => { el.dataset.broken = '1'; });
      });
    }
  }

  private storeLabels() {
    const L = this.labels!, lbl = () => isOn(getState(), 'store', 'lbl');
    ROWZ.forEach((z, i) => L.add(new THREE.Vector3(X0 - 1.6, .2, z), `<b>Rack ${ROWS[i]}</b>`, { tag: 'span', ay: -.5, show: lbl }));
    L.add(new THREE.Vector3(-1.5, .1, -11), '<b>ESD protected area</b>', { tag: 'span', show: lbl });
    L.add(new THREE.Vector3(19.5, .1, -9), '<b>Quarantine cage</b><span>2 lots on hold</span>', { tag: 'span', show: lbl });
    L.add(new THREE.Vector3(19.5, .1, 4), '<b>Hazmat cabinet</b><span>Li-ion · flammables</span>', { tag: 'span', show: lbl });
    L.add(new THREE.Vector3(-12, 1.8, 13.5), '<b>Planned inbound · PO 4500182</b><span>Pallets arriving 21 Oct · 2 slots free</span>', { tag: 'span', show: () => isOn(getState(), 'store', 'ghost') });
    L.add(binPos(EXCEPTION_BIN).add(new THREE.Vector3(0, .8, 0)),
      '<div class="e">C-10-04 · COUNT VARIANCE</div><b style="font-size:.875rem">IoT gateway PCB</b><span>System 40 · scanned 36 · 24/7 Connected</span><span>Next: recount today, assigned to S. Iyer</span>',
      { cls: 'card bad', tag: 'div', show: () => isOn(getState(), 'store', 'exc'), dx: 20, ax: 0, pri: 5 });
  }

  // ---------- Photoreal tiles ----------
  private tilesLoading = false;
  private applyPhotoreal() {
    const s = getState(), site = this.site;
    if (!site || !this.R) return;
    const want = s.photoreal && !!s.googleKey;
    if (!want) this.dropTiles();
    else if (this.tiles?.id !== site.site.id && !this.tilesLoading) {
      this.dropTiles();
      this.tilesLoading = true;
      const [lat, lon] = site.site.ll, R = this.R;
      // The tiles renderer is only downloaded when photorealistic mode is first used.
      import('./tiles').then(({ PhotorealTiles }) => {
        const pr = new PhotorealTiles(s.googleKey, lat, lon, this.cam, R);
        pr.tiles.addEventListener('load-error', () => toast('Photorealistic tiles could not load · check the Google key and Map Tiles API access'));
        site.sc.add(pr.group);
        this.tiles = { id: site.site.id, pr };
        site.setPhotoreal(true);
      }).catch(() => { toast('Photorealistic tiles are unavailable'); setState({ photoreal: false }); })
        .finally(() => { this.tilesLoading = false; });
    }
    site.setPhotoreal(want && this.tiles?.id === site.site.id);
  }
  private dropTiles() {
    if (!this.tiles) return;
    this.tiles.pr.group.removeFromParent();
    this.tiles.pr.dispose();
    this.tiles = null;
  }

  // ---------- Map handoff ----------
  /** Camera height that shows the ground at the map's handoff zoom, 1 CSS px to 1 map px. */
  private handoffHeight() {
    const lat = SITE_BY_ID[getState().site].ll[0];
    const hpx = this.el!.clientHeight || innerHeight;
    return hpx * metresPerPixel(lat, HANDOFF_ZOOM) / 2 / Math.tan(THREE.MathUtils.degToRad(this.cam.fov / 2));
  }

  /** Build (or reuse) a site's scene and wait for its imagery, before the map hands over. */
  async prepare(siteId: string) {
    const res = await buildSite(SITE_BY_ID[siteId]);
    await res.groundReady;
    return res;
  }

  /** Rise to the overhead view that matches the map at handoff zoom; resolves when there. */
  toOverhead(ms = 1000) {
    if (!this.ctl) return Promise.resolve();
    setState({ tour: false });
    return this.fly([0, this.handoffHeight(), .01], [0, 0, 0], ms);
  }

  // ---------- Screens ----------
  /**
   * Show the current 3D screen. `reset` re-runs the opening camera move; `handoff` starts from the
   * overhead view matching the map so the cross-fade from the map is seamless.
   */
  async enter(opts: { reset?: boolean; handoff?: boolean } = {}) {
    if (!this.R || !this.ctl) return;
    if (opts.reset) this.prev = null;
    const screen = getState().screen, ctl = this.ctl;
    this.cam.fov = 42;
    if (screen === 'store') {
      const st = buildStore();
      this.active = st.sc;
      this.labels!.clear(); this.storeLabels();
      this.showRadial();
      this.cam.near = .5; this.cam.far = 2000;
      this.cam.position.set(0, 70, .1); ctl.target.set(0, 0, 0); ctl.minDistance = 8; ctl.maxDistance = 90; ctl.maxPolarAngle = 1.42;
      const k = this.fitK();
      this.fly([26 * k, 24 * k, 34 * k], [0, 2, 0], 1200);
    } else {
      this.hideRadial();
      const site = SITE_BY_ID[getState().site];
      if (!siteCached(site.id)) setState({ loading: true });
      const res = await buildSite(site);
      setState({ loading: false });
      const now = getState().screen;
      if (now !== 'site' && now !== 'movements') return;
      this.site = res; this.active = res.sc;
      this.lastPhotos = getState().photos[site.id];
      this.siteLabels(res);
      this.applyPhotoreal();
      ctl.minDistance = 25; ctl.maxDistance = 5000; ctl.maxPolarAngle = 1.45;
      const fromAbove = this.prev !== 'site' && this.prev !== 'movements';
      if (opts.handoff || fromAbove) { this.cam.position.set(0, this.handoffHeight(), .01); ctl.target.set(0, 0, 0); }
      const c = res.center, k = this.fitK(), r = res.radius;
      // Oblique view from the south-east, framing the KONE facilities.
      const target = new THREE.Vector3(c.x * .6, 0, c.z * .6);
      const pos = target.clone().add(new THREE.Vector3(r * .9, r * .95, r * 1.35).multiplyScalar(k));
      await this.fly(pos, target, opts.handoff ? 2600 : 1800, opts.handoff ? 350 : 0);
      if (res.src === 'stylised') toast('Live OpenStreetMap buildings unavailable · showing a stylised campus');
    }
    this.resize();
    if (THREE_SCREENS.includes(getState().screen)) this.prev = getState().screen;
  }

  leave() { this.hideRadial(); this.prev = null; this.tween = null; }

  recolorBins() { recolorBins(); }

  zoomBy(d: number) {
    if (!this.ctl) return;
    const tg = this.ctl.target, dir = this.cam.position.clone().sub(tg).multiplyScalar(d > 0 ? .7 : 1.4);
    this.fly(tg.clone().add(dir), tg.clone(), 400);
  }

  /** 2D is a straight-down view of the current target; 3D re-runs the screen's opening shot. */
  applyDim() {
    if (!this.ctl) return;
    const s = getState(), tg = this.ctl.target;
    if (s.dim === '2D') this.fly([tg.x, s.screen === 'store' ? 60 : this.handoffHeight() * .6, tg.z + .1], tg.clone(), 700);
    else this.enter();
  }

  /** Stand near a photo's location, looking towards the site. */
  viewPhoto(siteId: string, i: number) {
    const ph = getState().photos[siteId];
    const site = this.site;
    if (ph?.status !== 'ready' || !site || site.site.id !== siteId) return;
    const p = ph.items[i];
    if (!p.ll) return;
    const at = site.toScene(p.ll[0], p.ll[1]);
    const look = site.center.clone().setY(15);
    const back = at.clone().sub(look).setY(0).normalize().multiplyScalar(60);
    this.fly(at.clone().add(back).setY(45), look.lerp(at, .35), 1600);
  }
}

export const threeEngine = new ThreeEngine();
