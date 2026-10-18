// three.js renderer shared by the Site twin, Movements and Store twin screens.
// The camera's view offset keeps the scene centred in the area not covered by panels.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SITE_BY_ID } from '../data/sample';
import { EXCEPTION_BIN, ROWS } from '../data/storeModel';
import type { Bin } from '../data/types';
import { binAction, completeMove, go, selectBin, selectBuilding, toast } from '../state/actions';
import { getState, isOn, setState, THREE_SCREENS } from '../state/store';
import { Labels, type Rect } from './labels';
import { B2_FLOORS, buildSite, siteCached, type SiteScene } from './site';
import { binPos, buildStore, drawMove, recolorBins, ROWZ, X0 } from './store3d';

const RADIAL = ['Move', 'Reserve', 'Count', 'Scrap', 'History', 'Docs'];
const H = () => document.documentElement;
const rem = () => parseFloat(getComputedStyle(H()).fontSize);

interface Tween { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; s: number; ms: number }

class ThreeEngine {
  private R: THREE.WebGLRenderer | null = null;
  private cam = new THREE.PerspectiveCamera(42, 1, 1, 8000);
  private ctl: OrbitControls | null = null;
  private el: HTMLElement | null = null;
  private radialEl: HTMLElement | null = null;
  private labels: Labels | null = null;
  private active: THREE.Scene | null = null;
  private site: SiteScene | null = null;
  private tween: Tween | null = null;
  private clock = new THREE.Clock();
  private sa: Rect | null = null;
  private saFrame = 0;
  private radialAt: THREE.Vector3 | null = null;
  /** The 3D screen shown last; null after leaving 3D, so re-entry starts from an overhead shot. */
  private prev: string | null = null;
  private fpsN = 0;
  private fpsT = performance.now();
  private ray = new THREE.Raycaster();

  init(el: HTMLElement, labelsEl: HTMLElement, radialEl: HTMLElement) {
    if (this.R) return;
    this.el = el; this.radialEl = radialEl; this.labels = new Labels(labelsEl);
    const R = this.R = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    R.setPixelRatio(Math.min(devicePixelRatio, 2));
    R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
    R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
    el.appendChild(R.domElement);
    const ctl = this.ctl = new OrbitControls(this.cam, R.domElement);
    ctl.enableDamping = true; ctl.dampingFactor = .08; ctl.screenSpacePanning = false; ctl.maxPolarAngle = 1.42;
    ctl.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    // Treat a press that barely moves as a tap, so orbiting never selects things.
    let down: [number, number] | null = null;
    R.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    R.domElement.addEventListener('pointerup', e => {
      if (!down) return;
      const d = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (d < 8) this.pick(e);
    });
    new ResizeObserver(() => this.resize()).observe(el);
    addEventListener('resize', () => { this.sa = null; });
    document.addEventListener('transitionend', () => { this.sa = null; });
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

  /** Area of the stage not covered by the rail, drawer, crumbs, controls or timeline. */
  private safeArea(): Rect {
    const base = this.el!.getBoundingClientRect(), g = rem();
    const a = { l: g * .5, t: g * .5, r: base.width - g * .5, b: base.height - g * .5 };
    const rel = (id: string) => {
      const e = document.getElementById(id);
      if (!e || e.classList.contains('hidden')) return null;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.right <= base.left + 2 || r.left >= base.right - 2) return null;
      return { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top };
    };
    const rail = rel('rail'), dr = rel('drawer'), tl = rel('timeline'), ct = rel('ctrls'), cr = rel('crumbsIn');
    if (rail) a.l = Math.max(a.l, rail.r + g * .5);
    if (cr) a.t = Math.max(a.t, cr.b + g * .5);
    if (tl) a.b = Math.min(a.b, tl.t - g * .5);
    if (H().classList.contains('portrait')) { if (dr) a.b = Math.min(a.b, dr.t - g * .5); }
    else { if (dr) a.r = Math.min(a.r, dr.l - g * .5); if (ct) a.r = Math.min(a.r, ct.l - g * .5); }
    return a;
  }

  private applyOffset() {
    if (!this.el) return;
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    if (!this.sa) this.sa = this.safeArea();
    const cx = (this.sa.l + this.sa.r) / 2, cy = (this.sa.t + this.sa.b) / 2;
    this.cam.setViewOffset(w, h, -(cx - w / 2), -(cy - h / 2), w, h);
    this.cam.updateProjectionMatrix();
  }

  /** How far to pull the camera back so the scene fits the safe area. */
  private fitK() {
    const w = this.el!.clientWidth || 1, h = this.el!.clientHeight || 1;
    if (!this.sa) this.sa = this.safeArea();
    const sa = this.sa;
    return Math.max(1, Math.min(2.4, Math.max(w / Math.max(200, sa.r - sa.l), h / Math.max(200, sa.b - sa.t)) * .92));
  }

  private fly(pos: THREE.Vector3Tuple, target: THREE.Vector3Tuple, ms = 1100) {
    this.tween = { p0: this.cam.position.clone(), t0: this.ctl!.target.clone(), p1: new THREE.Vector3(...pos), t1: new THREE.Vector3(...target), s: performance.now(), ms };
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    if (this.hidden() || !this.active || !this.R || !this.ctl) return;
    const now = performance.now(), t = this.clock.getElapsedTime();
    const tw = this.tween;
    if (tw) {
      let k = Math.min(1, (now - tw.s) / tw.ms);
      k = 1 - Math.pow(1 - k, 3);
      this.cam.position.lerpVectors(tw.p0, tw.p1, k);
      this.ctl.target.lerpVectors(tw.t0, tw.t1, k);
      if (k >= 1) this.tween = null;
    }
    this.ctl.update();
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
    if (!this.sa || (this.saFrame++ % 15) === 0) { this.sa = this.safeArea(); this.applyOffset(); }
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

  // ---------- Picking ----------
  private pick(e: PointerEvent) {
    const R = this.R!, rect = R.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.cam);
    const s = getState();
    if (s.screen === 'store') {
      const st = buildStore(), hit = this.ray.intersectObject(st.bins)[0];
      if (hit && hit.instanceId !== undefined) {
        const b = st.idx[hit.instanceId];
        if (s.moveFrom) { this.makeMove(s.moveFrom, b); return; }
        selectBin(b); this.showRadial(); return;
      }
      this.hideRadial();
      return;
    }
    if (!this.site) return;
    const objs: THREE.Object3D[] = [];
    this.site.sc.traverse(o => { if ((o as THREE.Mesh).isMesh && o.userData?.k) objs.push(o); });
    const hit = this.ray.intersectObjects(objs, false)[0];
    if (!hit) return;
    const { k, floor } = hit.object.userData;
    // Tapping the peeled-open L1 slab of a selected B2 drills into the store.
    if (k === 'b2' && floor === 1 && s.bld === 'b2' && s.peel) { go('store'); return; }
    selectBuilding(k);
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
    const lbl = (scr: 'site' | 'movements' | null) => () => { const s = getState(); return isOn(s, scr ?? s.screen, 'lbl'); };
    Object.values(res.meta).forEach(m => {
      if (m.k === 'b2') {
        B2_FLOORS.forEach((n, i) => {
          const slab = m.slabs![i];
          L.add(() => new THREE.Vector3(m.c.x, slab.position.y + m.h / 3 * .5, m.c.z), `<b>${n}</b><span>${['72%', '84%', '61%'][i]} space</span>`, {
            cls: i === 1 ? 'on' : '', onClick: i === 1 ? () => go('store') : () => selectBuilding('b2'),
            show: () => getState().screen === 'site' && lbl('site')(), ax: 0, ay: -.5, dx: 24, pri: 3 - i,
          });
        });
        L.add(m.c.clone().setY(m.h + 32), `<b>${m.n}</b><span>${m.s}</span>`, {
          onClick: () => selectBuilding('b2'),
          show: () => { const s = getState(); return (s.screen === 'movements' || !s.peel) && lbl(null)(); },
        });
        return;
      }
      L.add(m.c.clone().setY(m.h + 4), `<b>${m.n}</b><span>${m.s}</span>`, {
        cls: m.alert && isOn(getState(), 'site', 'alerts3') ? 'bad' : '', pri: m.alert ? 2 : 0,
        onClick: () => selectBuilding(m.k), show: lbl(null),
      });
    });
    res.flows.forEach(f => {
      const el = L.add(f.mid, f.label, { cls: 'flow', tag: 'span', ay: -.5, show: () => { const s = getState(); return s.screen === 'movements' && isOn(s, 'movements', f.layer); } });
      el.style.background = f.col;
      if (f.col === '#C8312B') el.style.color = '#fff';
    });
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

  // ---------- Screens ----------
  /** Show the current 3D screen. `reset` re-runs the opening camera move. */
  async enter(reset = false) {
    if (!this.R || !this.ctl) return;
    if (reset) this.prev = null;
    const screen = getState().screen, ctl = this.ctl;
    if (screen === 'store') {
      const st = buildStore();
      this.active = st.sc;
      this.labels!.clear(); this.storeLabels();
      this.showRadial();
      this.cam.position.set(0, 70, .1); ctl.target.set(0, 0, 0); ctl.minDistance = 8; ctl.maxDistance = 90;
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
      this.siteLabels(res);
      const c = res.center;
      ctl.minDistance = 40; ctl.maxDistance = 1600;
      if (this.prev !== 'site' && this.prev !== 'movements') { this.cam.position.set(c.x, 1100, c.z + 1); ctl.target.copy(c); }
      const k = this.fitK();
      this.fly([c.x + 20 + 210 * k, 250 * k, c.z + 20 + 310 * k], [c.x + 20, 0, c.z + 20], 1600);
      if (res.src === 'proc') toast('Live building footprints unavailable · showing stylised campus massing');
    }
    this.resize();
    if (THREE_SCREENS.includes(getState().screen)) this.prev = getState().screen;
  }

  leave() { this.hideRadial(); this.prev = null; }

  recolorBins() { recolorBins(); }

  zoomBy(d: number) {
    if (!this.ctl) return;
    const tg = this.ctl.target, dir = this.cam.position.clone().sub(tg).multiplyScalar(d > 0 ? .7 : 1.4);
    this.fly(tg.clone().add(dir).toArray(), tg.toArray(), 400);
  }

  /** 2D is a straight-down view of the current target; 3D re-runs the screen's opening shot. */
  applyDim() {
    if (!this.ctl) return;
    const s = getState(), tg = this.ctl.target;
    if (s.dim === '2D') this.fly([tg.x, s.screen === 'store' ? 60 : 900, tg.z + .1], tg.toArray(), 700);
    else this.enter();
  }
}

export const threeEngine = new ThreeEngine();
