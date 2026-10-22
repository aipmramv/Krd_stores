// three.js renderer shared by the Site twin, Movements and Store twin screens.
// The camera's view offset keeps the scene centred in the area not covered by panels, and the
// site camera can start exactly where the map left off, so map ↔ 3D transitions are seamless.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SITE_BY_ID } from '../data/sites';
import { binId, binOf, ROWS } from '../data/storeModel';
import type { Bin } from '../data/types';
import { HANDOFF_ZOOM, metresPerPixel, stageSafeArea, type Rect } from '../safeArea';
import { binAction, enterFloor, go, openPhoto, selectBin, selectBuilding, setBinTask, setMoveTarget, startMove, toast } from '../state/actions';
import { getStoreView, loadStoreView, onStoreView } from '../services/storeView';
import { getState, isOn, setState, subscribe, THREE_SCREENS } from '../state/store';
import { Labels } from './labels';
import { buildSite, setHovered, siteCached, type SiteScene } from './site';
import { binPos, buildStore, drawMoves, recolorBins, ROWZ, X0 } from './store3d';

const RADIAL = ['Move', 'Reserve', 'Count', 'Scrap', 'History', 'Docs'];
const H = () => document.documentElement;
const rem = () => parseFloat(getComputedStyle(H()).fontSize);

interface Tween { p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; via?: THREE.Vector3; s: number; ms: number; done?: () => void }

/** Midnight IST today; the timeline offsets from it. */
const todayIst = () => { const ist = Date.now() + 5.5 * 3600000; return ist - (ist % 86400000) - 5.5 * 3600000; };
const istNow = () => { const d = new Date(); return (d.getUTCHours() + d.getUTCMinutes() / 60 + 5.5) % 24; };
export function sceneDate() {
  const s = getState(), h = s.tod ?? istNow();
  return new Date(todayIst() + s.t * 86400000 + h * 3600000);
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
    // Treat a press that barely moves as a tap, so orbiting never selects things. In the store,
    // pressing and holding a bin starts a move: drag to the destination bin and let go.
    let down: [number, number] | null = null;
    R.domElement.addEventListener('pointerdown', e => {
      down = [e.clientX, e.clientY];
      const b = getState().screen === 'store' && !getState().moveDraft ? this.binAt(e) : null;
      if (b) this.press = setTimeout(() => { this.press = null; this.dragFrom = b; this.dragTo = null; ctl.enabled = false; navigator.vibrate?.(15); startMove(b); }, 420);
    });
    R.domElement.addEventListener('pointerup', e => {
      clearTimeout(this.press ?? undefined); this.press = null;
      if (this.dragFrom) {
        if (this.dragTo) setMoveTarget(this.dragTo);
        this.dragFrom = this.dragTo = null; ctl.enabled = true; down = null;
        return;
      }
      if (!down) return;
      const d = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (d < 8) this.pick(e);
    });
    R.domElement.addEventListener('pointermove', e => {
      if (this.press && down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 8) { clearTimeout(this.press); this.press = null; }
      if (this.dragFrom) {
        const b = this.binAt(e), to = b && binId(b) !== binId(this.dragFrom) ? b : null;
        if ((to && binId(to)) !== (this.dragTo && binId(this.dragTo))) { this.dragTo = to; drawMoves({ from: this.dragFrom, to }); }
        return;
      }
      if (e.pointerType === 'mouse') this.hover(e);
    });
    onStoreView(() => { recolorBins(); drawMoves(getState().moveDraft); if (getState().screen === 'store' && this.active === buildStore().sc) this.storeLabels(); });
    new ResizeObserver(() => this.resize()).observe(el);
    addEventListener('resize', () => { this.sa = null; });
    document.addEventListener('transitionend', () => { this.sa = null; });
    subscribe(() => this.sync());
    this.resize();
    this.loop();
  }

  private press: ReturnType<typeof setTimeout> | null = null;
  private dragFrom: Bin | null = null;
  private dragTo: Bin | null = null;

  private binAt(e: PointerEvent): Bin | null {
    this.ray.setFromCamera(this.ndc(e), this.cam);
    const st = buildStore(), hit = this.ray.intersectObject(st.bins)[0];
    return hit && hit.instanceId !== undefined ? st.idx[hit.instanceId] : null;
  }

  /** Redraw the move arcs, including the request being drawn. */
  drawMoves() { drawMoves(getState().moveDraft); }

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

  private fly(pos: THREE.Vector3Tuple | THREE.Vector3, target: THREE.Vector3Tuple | THREE.Vector3, ms = 1100, delay = 0, via?: THREE.Vector3) {
    const v = (x: THREE.Vector3Tuple | THREE.Vector3) => (x instanceof THREE.Vector3 ? x.clone() : new THREE.Vector3(...x));
    return new Promise<void>(done => {
      this.tween = { p0: this.cam.position.clone(), t0: this.ctl!.target.clone(), p1: v(pos), t1: v(target), via, s: performance.now() + delay, ms, done };
    });
  }

  /** React to store changes that need the scene: tour and photo pins. */
  private lastPhotos: unknown = null;
  private sync() {
    const s = getState();
    if (this.ctl) this.ctl.autoRotate = s.tour && (s.screen === 'site' || s.screen === 'movements');
    if (this.site && s.stage === 'three') {
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
      if (tw.via) {
        // Quadratic Bézier through `via`, so long moves swing round instead of cutting through.
        const a = (1 - k) * (1 - k), b = 2 * (1 - k) * k, c = k * k;
        this.cam.position.set(a * tw.p0.x + b * tw.via.x + c * tw.p1.x, a * tw.p0.y + b * tw.via.y + c * tw.p1.y, a * tw.p0.z + b * tw.via.z + c * tw.p1.z);
      } else this.cam.position.lerpVectors(tw.p0, tw.p1, k);
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
    if (!this.site || this.active !== this.site.sc) return null;
    this.ray.setFromCamera(this.ndc(e), this.cam);
    return this.ray.intersectObjects(this.site.pickables, false)[0] ?? null;
  }
  private hover(e: PointerEvent) {
    const now = performance.now();
    if (now - this.hoverAt < 60) return;
    this.hoverAt = now;
    const hit = this.facilityAt(e);
    const ud = hit?.object.userData;
    const ktec = ud && this.site?.meta[ud.k]?.f.levels?.includes(ud.floor) ? ud.floor as number : null;
    setHovered(ud ? ud.k : null, ktec);
    this.R!.domElement.style.cursor = hit ? 'pointer' : '';
  }

  private pick(e: PointerEvent) {
    const s = getState();
    if (s.screen === 'store') {
      this.ray.setFromCamera(this.ndc(e), this.cam);
      const st = buildStore(), hit = this.ray.intersectObject(st.bins)[0];
      if (hit && hit.instanceId !== undefined) {
        const b = st.idx[hit.instanceId];
        if (s.moveDraft && !s.moveDraft.to) { setMoveTarget(b); return; }
        selectBin(b); this.showRadial(); return;
      }
      this.hideRadial();
      return;
    }
    const hit = this.facilityAt(e);
    if (!hit) return;
    const { k, floor, store } = hit.object.userData;
    const main = this.site!.meta.main;
    if (store) { go('store'); return; }
    // Modelled towers: tapping a KTEC storey opens it; anything else just selects the tower.
    const fi = main?.f.levels?.indexOf(floor) ?? -1;
    if (k === 'main' && fi >= 0 && s.floor !== fi) { enterFloor(fi); return; }
    if (k === 'main' && main?.tower) { selectBuilding(k); if (s.floor === null) this.focus(k); return; }
    // Tapping the peeled-open store floor of the selected primary building drills into the store.
    if (k === 'main' && floor === main?.f.storeFloor && s.bld === 'main' && s.peel) { go('store'); return; }
    selectBuilding(k);
    this.focus(k);
  }

  /**
   * Camera for the opened floor: a dolls-house view looking down into the floor from the side the
   * user is already on, or (walking) eye level just inside the glass, facing across the floor.
   */
  showFloor() {
    const s = getState(), site = this.site, ctl = this.ctl, m = site?.meta.main;
    if (!site || !ctl || !m?.tower || !m.f.levels || s.screen !== 'site') return;
    setState({ tour: false });
    if (s.floor === null) {
      ctl.minDistance = 25; ctl.maxPolarAngle = 1.45;
      this.focus('main');
      return;
    }
    const fr = site.levelFrame(m.f.levels[s.floor]);
    if (!fr) return;
    const dirH = this.cam.position.clone().sub(fr.c).setY(0);
    if (dirH.lengthSq() < 1) dirH.set(.6, 0, 1);
    dirH.normalize();
    if (s.walk) {
      // Stand at one end of the floor beside the core, on the camera's side, looking down its length.
      const xs = fr.plan.map(p => p[0]), zs = fr.plan.map(p => p[1]);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      const longX = x1 - x0 >= z1 - z0, side = Math.sign(longX ? dirH.z : dirH.x) || 1;
      const from = (longX ? dirH.x : dirH.z) > 0 ? 1 : -1;
      const eye = longX ? new THREE.Vector3(fr.c.x + from * ((x1 - x0) / 2 - 7), fr.c.y + 1.65, fr.c.z + side * 8.5)
        : new THREE.Vector3(fr.c.x + side * 8.5, fr.c.y + 1.65, fr.c.z + from * ((z1 - z0) / 2 - 7));
      const look = longX ? new THREE.Vector3(fr.c.x - from * (x1 - x0) / 4, fr.c.y + 1.3, eye.z) : new THREE.Vector3(eye.x, fr.c.y + 1.3, fr.c.z - from * (z1 - z0) / 4);
      ctl.minDistance = .5; ctl.maxPolarAngle = 1.75;
      const via = this.cam.position.clone().lerp(eye, .5).setY(Math.max(this.cam.position.y, eye.y) + 6);
      this.fly(eye, look, 1900, 0, via);
      return;
    }
    ctl.minDistance = 8; ctl.maxPolarAngle = 1.45;
    const target = fr.c.clone().setY(fr.c.y + 1);
    const dist = fr.r * 1.7 * this.fitK(), el = THREE.MathUtils.degToRad(42);
    const pos = target.clone().addScaledVector(dirH, Math.cos(el) * dist).setY(target.y + Math.sin(el) * dist);
    const via = this.cam.position.clone().lerp(pos, .5);
    via.y = Math.max(via.y, pos.y) + dist * .15;
    this.fly(pos, target, 1700, 0, via);
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


  // ---------- Labels ----------
  private siteLabels(res: SiteScene) {
    const L = this.labels!;
    L.clear();
    const s0 = getState();
    const lbl = () => { const s = getState(); return isOn(s, s.screen === 'movements' ? 'movements' : 'site', 'lbl'); };
    Object.values(res.meta).forEach(m => {
      const f = m.f;
      if (m.tower && f.levels && f.floors) {
        // Only the KTEC storeys are offered, as a lift-style floor panel beside the tower on the
        // side facing the camera; hovering a button lights that floor on the model.
        const tw = m.tower, lvls = f.levels;
        const mid = (tw.z[lvls[0]] + tw.z[lvls[lvls.length - 1] + 1]) / 2;
        const pos = () => {
          const d = this.cam.position.clone().sub(m.c);
          let best = tw.plan[0], bd = -Infinity;
          for (const p of tw.plan) { const v = (p[0] - m.c.x) * d.x + (p[1] - m.c.z) * d.z; if (v > bd) { bd = v; best = p; } }
          return new THREE.Vector3(best[0], mid, best[1]);
        };
        const btns = lvls.map((_, i) => i).reverse().map(i => `<button data-i="${i}" aria-label="Enter ${f.floors![i][0]}"><b>${f.floors![i][0].replace(/\D+/g, '')}</b></button>`).join('');
        const panel = L.add(pos, `<span class="eb">${f.n}</span><div class="keys">${btns}</div><span>Choose a floor</span>`, {
          cls: 'lift', tag: 'div', ax: 0, ay: -.5, dx: 22, pri: 4,
          show: () => { const s = getState(); return s.screen === 'site' && s.floor === null && lbl(); },
        });
        panel.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
          const i = +b.dataset.i!;
          b.addEventListener('click', () => enterFloor(i));
          b.addEventListener('pointerenter', () => setHovered('main', lvls[i]));
          b.addEventListener('pointerleave', () => setHovered(null));
        });
        const st = f.storeFloor !== undefined ? tw.interiors[f.levels[f.storeFloor]] : undefined;
        if (st?.store) {
          const lv = f.levels[f.storeFloor!];
          L.add(st.store.clone().setY(tw.z[lv] + 3.2), '<b>Electronics store</b><span>Open store twin ›</span>', {
            cls: 'on', onClick: () => go('store'), pri: 5,
            show: () => { const s = getState(); return s.screen === 'site' && s.floor === f.storeFloor && !s.walk; },
          });
        }
        return;
      }
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
    L.clear();
    ROWZ.forEach((z, i) => L.add(new THREE.Vector3(X0 - 1.6, .2, z), `<b>Rack ${ROWS[i]}</b>`, { tag: 'span', ay: -.5, show: lbl }));
    L.add(new THREE.Vector3(-1.5, .1, -11), '<b>ESD protected area</b>', { tag: 'span', show: lbl });
    L.add(new THREE.Vector3(19.5, .1, -9), '<b>Quarantine cage</b><span>Lots on hold</span>', { tag: 'span', show: lbl });
    L.add(new THREE.Vector3(19.5, .1, 4), '<b>Hazmat cabinet</b><span>Li-ion · flammables</span>', { tag: 'span', show: lbl });
    const view = getStoreView()?.site === getState().site ? getStoreView() : null;
    const pa = view?.putaways ?? [];
    if (pa.length) {
      const first = pa[0], units = pa.reduce((n, m) => n + m.qty, 0);
      L.add(new THREE.Vector3(-12, 1.8, 13.5), `<b>Waiting for put-away · ${pa.length} task${pa.length > 1 ? 's' : ''}</b><span>${units} units · first ${first.ref ?? first._id}</span>`,
        { tag: 'button', show: () => isOn(getState(), 'store', 'ghost'), onClick: () => setBinTask('putaway') });
    }
    for (const m of (view?.counts ?? []).slice(0, 2)) {
      const b = binOf(m.from);
      if (!b) continue;
      const part = view!.parts.get(m.partNo), d = (m.counted ?? 0) - m.qty;
      L.add(binPos(b).add(new THREE.Vector3(0, .8, 0)),
        `<div class="e">${binId(b)} · COUNT VARIANCE</div><b style="font-size:.875rem">${part?.description ?? m.partNo}</b><span>System ${m.qty} · counted ${m.counted} · ${d > 0 ? '+' : ''}${d}</span><span>Waiting for the store manager · ${m._id}</span>`,
        { cls: 'card bad', tag: 'div', show: () => isOn(getState(), 'store', 'exc'), dx: 20, ax: 0, pri: 5 });
    }
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
      this.storeLabels();
      this.showRadial();
      void loadStoreView(getState().site).then(() => { recolorBins(); drawMoves(getState().moveDraft); });
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
      ctl.minDistance = 25; ctl.maxDistance = 5000; ctl.maxPolarAngle = 1.45;
      const fromAbove = this.prev !== 'site' && this.prev !== 'movements';
      if (opts.handoff || fromAbove) { this.cam.position.set(0, this.handoffHeight(), .01); ctl.target.set(0, 0, 0); }
      // Back from the store twin (or re-entering) with a floor open: return to that floor.
      const mm = res.meta.main, fl = getState().floor;
      if (!opts.handoff && (this.prev === 'store' || this.prev === 'site') && fl !== null && mm?.tower && mm.f.levels) {
        if (this.prev === 'store') {
          const fr = res.levelFrame(mm.f.levels[fl])!;
          ctl.target.copy(fr.c);
          this.cam.position.copy(fr.c).add(new THREE.Vector3(fr.r * .9, fr.r * 1.6, fr.r * 1.3));
        }
        this.showFloor(); this.resize(); this.prev = 'site';
        return;
      }
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
