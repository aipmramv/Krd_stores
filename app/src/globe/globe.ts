// One CesiumJS globe for every map and site screen: Network, Routes, Shipments, Site twin and Moves.
// Everything geographic comes through Cesium ion with the user's token:
//   imagery  — Cesium ion world imagery (aerial with labels, or road)
//   terrain  — Cesium World Terrain
//   3D       — Cesium OSM Buildings, and Google Photorealistic 3D Tiles (ion asset 2275207) when zoomed in
// Flying from all of India down into a site is a single continuous camera move.
// App overlays (pins, tags, labels, photo pins) are HTML elements placed over the globe each frame,
// so they keep the KONE design-system styling.
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { AIR, NETWORK_BOUNDS, NH48, RAIL, ROUTES, SHIPS, XFERS } from '../data/sample';
import { SITE_BY_ID, SITES } from '../data/sites';
import type { Facility, LatLng, ScreenId, Site } from '../data/types';
import { stageSafeArea } from '../safeArea';
import { go, openPhoto, pinSite, selectBuilding, selectRoute, selectShip, toast } from '../state/actions';
import { getState, isOn, MAP_SCREENS, setState, SITE_SCREENS, subscribe, type AppState } from '../state/store';

const RAD = Math.PI / 180;
/** Base date of the sample data; the timeline offsets from it. */
const TODAY_UTC = Date.UTC(2026, 9, 18);
const istNow = () => { const d = new Date(); return (d.getUTCHours() + d.getUTCMinutes() / 60 + 5.5) % 24; };
export function sceneDate(s: AppState = getState()) {
  return new Date(TODAY_UTC + s.t * 86400000 + ((s.tod ?? istNow()) - 5.5) * 3600000);
}

/** Quadratic bezier between two points, bowed sideways by k; reads as a flight or lane arc. */
export function bez(a: LatLng, b: LatLng, k = .18, n = 48): LatLng[] {
  const [la, lo] = a, [lb, lob] = b;
  const mx = (la + lb) / 2, my = (lo + lob) / 2, dx = lb - la, dy = lob - lo;
  const cx = mx - dy * k, cy = my + dx * k;
  const out: LatLng[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * la + 2 * u * t * cx + t * t * lb, u * u * lo + 2 * u * t * cy + t * t * lob]);
  }
  return out;
}

/** Cesium ion world imagery: aerial with labels, or road map. */
const worldImagery = (b: AppState['base']) => Cesium.ImageryLayer.fromProviderAsync(
  Cesium.createWorldImageryAsync({ style: b === 'sat' ? Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS : Cesium.IonWorldImageryStyle.ROAD }));
const cart = ([la, lo]: LatLng, h = 0) => Cesium.Cartesian3.fromDegrees(lo, la, h);
/** Facility position: its approximate offset from the site coordinate, in metres east/north. */
export function facilityLL(site: Site, f: Facility): LatLng {
  const [e, n] = f.at ?? [0, 0], [la, lo] = site.ll;
  return [la + n / 111320, lo + e / (111320 * Math.cos(la * RAD))];
}

type Group = 'sites' | 'xfer' | 'ship' | 'route' | 'site' | 'flows' | 'photos';
interface Ov { el: HTMLElement; pos: Cesium.Cartesian3; group: Group; show?: () => boolean; z: number; anchor: 'pt' | 'top' | 'mid'; w?: number; h?: number }
interface Mover { ov: Ov; p: LatLng[]; d: number; o: number }
interface Flow { a: Cesium.Cartesian3; m: Cesium.Cartesian3; b: Cesium.Cartesian3; off: number }

const bezier3 = (a: Cesium.Cartesian3, m: Cesium.Cartesian3, b: Cesium.Cartesian3, t: number, out = new Cesium.Cartesian3()) => {
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * m.x + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * m.y + t * t * b.y;
  out.z = u * u * a.z + 2 * u * t * m.z + t * t * b.z;
  return out;
};

class GlobeEngine {
  viewer: Cesium.Viewer | null = null;
  ready = false;
  private el: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private ovs: Ov[] = [];
  private movers: Mover[] = [];
  private ents: Record<Group, Cesium.Entity[]> = { sites: [], xfer: [], ship: [], route: [], site: [], flows: [], photos: [] };
  private flows: Flow[] = [];
  /** Flow entities with the layer switch that shows them. */
  private flowLayer = new Map<Cesium.Entity, string>();
  private osm: Cesium.Cesium3DTileset | null = null;
  private google: Cesium.Cesium3DTileset | null = null;
  private tower: Cesium.Entity | null = null;
  private last: Partial<AppState> = {};
  private frame = 0;
  private scratch = new Cesium.Cartesian2();

  init(el: HTMLElement, overlayRoot: HTMLElement, credits: HTMLElement) {
    if (this.viewer) return;
    this.el = el; this.root = overlayRoot;
    const token = getState().cesiumToken;
    if (token) Cesium.Ion.defaultAccessToken = token;
    const v = this.viewer = new Cesium.Viewer(el, {
      animation: false, timeline: false, baseLayerPicker: false, geocoder: false, homeButton: false, infoBox: false,
      selectionIndicator: false, navigationHelpButton: false, sceneModePicker: false, fullscreenButton: false,
      creditContainer: credits, shouldAnimate: false,
      baseLayer: token ? worldImagery('sat') : false,
      terrain: token ? Cesium.Terrain.fromWorldTerrain() : undefined,
    });
    const scene = v.scene;
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#22313F');
    scene.globe.enableLighting = true;
    scene.globe.depthTestAgainstTerrain = true;
    scene.fog.enabled = true;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    v.camera.setView({ destination: Cesium.Rectangle.fromDegrees(NETWORK_BOUNDS[0][1], NETWORK_BOUNDS[0][0], NETWORK_BOUNDS[1][1], NETWORK_BOUNDS[1][0]) });
    // Any manual camera move ends a cinematic tour.
    v.screenSpaceEventHandler.setInputAction(() => { if (getState().tour) setState({ tour: false }); }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    if (token) this.loadIon(); else setState({ ion: 'none' });
    this.drawSites(); this.drawXfers(); this.drawShips(); this.drawRoutes(); this.drawSite();
    scene.preRender.addEventListener(() => this.preRender());
    scene.postRender.addEventListener(() => this.placeOverlays());
    this.applyClock();
    this.ready = true;
    subscribe(() => this.sync());
  }

  /** Terrain, imagery, OSM buildings and Google photorealistic tiles, all through Cesium ion. */
  private async loadIon() {
    const v = this.viewer!;
    setState({ ion: 'loading' });
    const fail = (what: string, e: unknown) => {
      console.error(what, e);
      setState({ ion: 'error' });
      toast(`Cesium ion: ${what} could not load · check the token's asset access and allowed URLs`);
    };
    v.scene.globe.tileLoadProgressEvent.addEventListener(() => { if (getState().ion === 'loading') setState({ ion: 'ok' }); });
    v.imageryLayers.get(0)?.errorEvent.addEventListener(e => fail('imagery', e));
    try {
      this.osm = await Cesium.createOsmBuildingsAsync();
      this.osm.show = false;
      v.scene.primitives.add(this.osm);
    } catch (e) { fail('OSM buildings', e); }
    try {
      this.google = await Cesium.createGooglePhotorealistic3DTileset({ onlyUsingWithGoogleGeocoder: true }, { enableCollision: true, maximumScreenSpaceError: 12 });
      this.google.show = false;
      v.scene.primitives.add(this.google);
    } catch (e) { fail('Google Photorealistic 3D Tiles (ion asset 2275207)', e); }
  }

  private applyBase(b: AppState['base']) {
    const v = this.viewer;
    if (!v || !getState().cesiumToken) return;
    v.imageryLayers.removeAll();
    v.imageryLayers.add(worldImagery(b));
  }

  /** The sun follows the timeline date and the time-of-day slider (IST). */
  private applyClock() {
    const v = this.viewer;
    if (v) v.clock.currentTime = Cesium.JulianDate.fromDate(sceneDate());
  }

  private sync() {
    const s = getState(), p = this.last;
    this.last = s;
    if (!this.viewer) return;
    const changed = (k: keyof AppState) => s[k] !== p[k];
    if (changed('base') && p.base) this.applyBase(s.base);
    if (changed('t') || changed('tod')) this.applyClock();
    if (changed('site')) { this.drawSites(); this.drawSite(); if (SITE_SCREENS.includes(s.screen) && p.site) this.fitScreen(); }
    if (changed('off') || changed('screen')) this.drawSites();
    if (s.screen === 'routes' && (changed('route') || changed('off') || changed('screen'))) this.drawRoutes();
    if (MAP_SCREENS.includes(s.screen) && s.screen !== 'routes' && (changed('ship') || changed('screen'))) this.drawShips();
    if (changed('photos') || changed('bld')) this.drawSite();
    if (changed('mapTilt') && p.mapTilt !== undefined && MAP_SCREENS.includes(s.screen)) this.fitScreen();
    if (changed('dim') && p.dim && SITE_SCREENS.includes(s.screen)) this.fitScreen();
  }

  // ---------- Overlays ----------
  private clear(g: Group) {
    this.ovs = this.ovs.filter(o => { if (o.group === g) { o.el.remove(); return false; } return true; });
    this.movers = this.movers.filter(m => m.ov.group !== g);
    this.ents[g].forEach(e => this.viewer!.entities.remove(e));
    this.ents[g] = [];
    if (g === 'flows') { this.flows = []; this.flowLayer.clear(); }
  }
  private overlay(g: Group, pos: Cesium.Cartesian3, html: string, o: { z?: number; onClick?: () => void; show?: () => boolean; cls?: string } = {}) {
    const el = document.createElement('div');
    el.className = 'mk' + (o.cls ? ' ' + o.cls : '');
    el.innerHTML = html;
    el.style.zIndex = String(o.z ?? 0);
    if (o.onClick) el.addEventListener('click', e => { e.stopPropagation(); o.onClick!(); });
    this.root!.appendChild(el);
    const anchor = o.cls?.includes('at-top') ? 'top' as const : o.cls?.includes('at-mid') ? 'mid' as const : 'pt' as const;
    const ov: Ov = { el, pos, group: g, show: o.show, z: o.z ?? 0, anchor };
    this.ovs.push(ov);
    return ov;
  }
  private line(g: Group, pts: LatLng[], color: string, width: number, dash = false, alpha = 1) {
    const c = Cesium.Color.fromCssColorString(color).withAlpha(alpha);
    this.ents[g].push(this.viewer!.entities.add({
      polyline: {
        positions: pts.map(p => cart(p)), width, clampToGround: true,
        material: dash ? new Cesium.PolylineDashMaterialProperty({ color: c, dashLength: 14 }) : c,
      },
    }));
  }
  private mover(g: Group, p: LatLng[], cls: string, d: number, o = 0) {
    const ov = this.overlay(g, cart(p[0]), `<span class="mv ${cls}"></span>`, { z: 5 });
    this.movers.push({ ov, p, d, o });
  }

  /** Which overlay groups belong to the current screen and layer switches. */
  private groupOn(g: Group, s = getState()) {
    const scr = s.screen;
    switch (g) {
      case 'sites': return MAP_SCREENS.includes(scr) && (scr !== 'network' || isOn(s, 'network', 'sites'));
      case 'xfer': return scr === 'network' && isOn(s, 'network', 'xfer');
      case 'ship': return (scr === 'network' && isOn(s, 'network', 'ship')) || scr === 'shipments';
      case 'route': return scr === 'routes';
      case 'site': return SITE_SCREENS.includes(scr) && isOn(s, scr, 'lbl');
      case 'flows': return scr === 'movements';
      case 'photos': return scr === 'site' && isOn(s, 'site', 'photos');
    }
  }

  private drawSites() {
    if (!this.viewer) return;
    const s = getState();
    this.clear('sites');
    SITES.forEach(site => {
      const sel = site.id === s.site, side = site.left === 'b' ? 'b' : site.left ? 'l' : '';
      const n = site.alerts.length, pulse = n && isOn(s, 'network', 'alerts') ? '<span class="pu"></span>' : '';
      this.overlay('sites', cart(site.ll, site.ellH + 20),
        `<div class="pin ${side} ${sel ? 'sel' : ''}">${pulse}<span class="pd"></span><div class="pc"><b>${site.name}</b><span>${site.type.split(' · ')[0]} · ${n ? `${n} alert${n > 1 ? 's' : ''}` : 'no alerts'}</span></div></div>`,
        { z: sel ? 30 : 20, onClick: () => pinSite(site.id) });
    });
  }

  private drawXfers() {
    this.clear('xfer');
    XFERS.forEach(([a, b], i) => {
      const p = bez(SITE_BY_ID[a].ll, SITE_BY_ID[b].ll, .22);
      this.line('xfer', p, '#FFFFFF', 2, true, .85);
      this.mover('xfer', p, '', 8 + i * 2, i * .3);
    });
  }

  private drawShips() {
    const s = getState();
    this.clear('ship');
    SHIPS.forEach((sh, i) => {
      const p = bez(SITE_BY_ID[sh.from].ll, SITE_BY_ID[sh.to].ll, .08), on = i === s.ship;
      if (sh.hold) {
        const hold = sh.hold;
        let k = 0, best = Infinity;
        p.forEach((q, j) => { const d = (q[0] - hold[0]) ** 2 + (q[1] - hold[1]) ** 2; if (d < best) { best = d; k = j; } });
        this.line('ship', p.slice(0, k + 1), '#1450F5', on ? 5 : 3);
        this.line('ship', p.slice(k), '#C8312B', 3, true);
        this.overlay('ship', cart(p[k]), '<span class="exc"><u></u><i></i></span>', { z: 25 });
        if (s.screen === 'shipments') this.overlay('ship', cart(p[k]), `<span class="tagm bad" style="left:-8rem;top:2.75rem"><b>E-way bill hold · Hubballi</b>${sh.carrier} · ${sh.id}</span>`, { z: 24, onClick: () => selectShip(i) });
      } else {
        const warn = sh.dot === '#C77700';
        this.line('ship', p, on ? '#1450F5' : warn ? '#FFE141' : '#A1B9FB', on ? 5 : 2.5, !on, on ? 1 : .9);
        this.mover('ship', p, (on ? 'big ' : '') + (warn ? 'warn' : ''), sh.dur ?? 10, i * .17);
      }
    });
  }

  private routeGeom(g: 'road' | 'air' | 'rail'): LatLng[] {
    if (g === 'road') return NH48;
    if (g === 'rail') return RAIL;
    return [AIR.siteA, AIR.airportA, ...bez(AIR.airportA, AIR.airportB, -.12, 40), AIR.siteB];
  }

  private drawRoutes() {
    const s = getState();
    this.clear('route');
    const order = ROUTES.map((_, i) => i).sort((a, b) => Number(a === s.route) - Number(b === s.route));
    const drawn = new Set<string>();
    order.forEach(i => {
      const r = ROUTES[i], on = i === s.route;
      if (drawn.has(r.geom) && !on) return;
      drawn.add(r.geom);
      const g = this.routeGeom(r.geom);
      if (on) { this.line('route', g, '#1450F5', 6); this.mover('route', g, 'big', 10); }
      else this.line('route', g, '#FFFFFF', 3, true, .8);
    });
    ROUTES.forEach((r, i) => {
      if (r.fr === undefined) return;
      const g = this.routeGeom(r.geom), p = g[Math.min(g.length - 1, Math.round((g.length - 1) * r.fr))];
      const on = i === s.route || (ROUTES[s.route].fr === undefined && r.geom === ROUTES[s.route].geom);
      this.overlay('route', cart(p), `<span class="tagm ${on ? 'on' : ''}" style="left:${r.ox}px;top:${r.oy}px"><b>${r.mode}</b>${r.eta} · ${r.cost}</span>`, { z: on ? 22 : 21, onClick: () => selectRoute(i) });
    });
    if (isOn(s, 'routes', 'weather')) {
      this.ents.route.push(this.viewer!.entities.add({
        position: cart([16.9, 74.05]),
        ellipse: { semiMajorAxis: 75000, semiMinorAxis: 75000, material: Cesium.Color.fromCssColorString('#FFE141').withAlpha(.18), classificationType: Cesium.ClassificationType.TERRAIN },
      }));
      this.overlay('route', cart([16.2, 72.4]), '<span class="tagm warn"><b>Heavy rain alert · Western Ghats</b>Road leg +6 h risk</span>', { z: 21 });
    }
  }

  /** Facility labels, internal flows, photo pins and the modelled test tower for the selected site. */
  private drawSite() {
    if (!this.viewer) return;
    const s = getState(), site = SITE_BY_ID[s.site];
    this.clear('site'); this.clear('flows'); this.clear('photos');
    const pos = (f: Facility, up = 45) => cart(facilityLL(site, f), site.ellH + up);
    site.facilities.forEach(f => {
      const isMain = !!f.floors, store = isMain ? ` · <u>Open store</u>` : '';
      this.overlay('site', pos(f), `<button class="lbl ${f.alert && isOn(s, 'site', 'alerts3') ? 'bad' : ''} ${s.bld === f.k ? 'on' : ''}"><b>${f.n}</b><span>${f.s}${store}</span></button>`, {
        z: isMain ? 12 : 10, cls: 'at-top',
        onClick: () => { if (isMain && s.bld === f.k) go('store'); else { selectBuilding(f.k); this.focus(f.k); } },
      });
    });
    const byK = Object.fromEntries(site.facilities.map(f => [f.k, f]));
    site.flows.forEach(([a, b, col, label, layer], i) => {
      if (!byK[a] || !byK[b]) return;
      const A = pos(byK[a], 30), B = pos(byK[b], 30);
      const mid = Cesium.Cartesian3.midpoint(A, B, new Cesium.Cartesian3());
      const up = Cesium.Cartesian3.normalize(mid, new Cesium.Cartesian3());
      const M = Cesium.Cartesian3.add(mid, Cesium.Cartesian3.multiplyByScalar(up, Math.max(60, Cesium.Cartesian3.distance(A, B) * .45), up), new Cesium.Cartesian3());
      const pts = Array.from({ length: 33 }, (_, j) => bezier3(A, M, B, j / 32));
      const on = () => getState().screen === 'movements' && isOn(getState(), 'movements', layer);
      const c = Cesium.Color.fromCssColorString(col);
      const arc = this.viewer!.entities.add({ polyline: { positions: pts, width: 6, material: new Cesium.PolylineGlowMaterialProperty({ color: c, glowPower: .25 }) } });
      const fl: Flow = { a: A, m: M, b: B, off: i * .21 };
      this.flows.push(fl);
      const ball = this.viewer!.entities.add({
        position: new Cesium.CallbackPositionProperty(() => bezier3(fl.a, fl.m, fl.b, ((performance.now() / 1000) * .16 + fl.off) % 1), false),
        point: { pixelSize: 11, color: Cesium.Color.WHITE, outlineColor: c, outlineWidth: 3 },
      });
      for (const e of [arc, ball]) { this.ents.flows.push(e); this.flowLayer.set(e, layer); }
      this.overlay('flows', bezier3(A, M, B, .5), `<span class="lbl flow" style="background:${col};${col === '#C8312B' ? 'color:#fff' : ''}">${label}</span>`, { z: 8, show: on, cls: 'at-mid' });
    });
    const ph = s.photos[site.id];
    if (ph?.status === 'ready') ph.items.forEach((p, i) => {
      if (!p.ll) return;
      this.overlay('photos', cart(p.ll, site.ellH + 25), `<button class="lbl photo"><img src="${p.thumb}" alt="" loading="lazy"></button>`, { z: 4, cls: 'at-top', onClick: () => openPhoto(site.id, i) });
    });
    // Blender-built test tower where a site has one, shown when the photorealistic mesh is off.
    if (this.tower) { this.viewer.entities.remove(this.tower); this.tower = null; }
    const tf = site.facilities.find(f => f.modelled === 'test_tower');
    if (tf) {
      const [la, lo] = facilityLL(site, tf);
      this.tower = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lo, la, 0),
        model: { uri: `${import.meta.env.BASE_URL}models/test_tower.glb`, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, minimumPixelSize: 32 },
      });
    }
  }

  // ---------- Frame ----------
  private preRender() {
    const v = this.viewer!, s = getState(), cam = v.camera;
    const h = cam.positionCartographic.height;
    // Photorealistic mesh close in, OSM buildings otherwise; the globe hides under the mesh.
    const near = h < 40000;
    const real = !!this.google && s.photoreal && near;
    if (this.google) this.google.show = real;
    if (this.osm) this.osm.show = !real && near;
    v.scene.globe.show = !(real && h < 6000);
    if (this.tower) this.tower.show = !real && SITE_SCREENS.includes(s.screen);
    v.shadows = SITE_SCREENS.includes(s.screen) && h < 5000;
    // Cinematic tour: orbit the site's vertical axis.
    if (s.tour && SITE_SCREENS.includes(s.screen)) cam.rotate(Cesium.Cartesian3.normalize(cart(SITE_BY_ID[s.site].ll), new Cesium.Cartesian3()), -.0018);
    // Centre the view in the part of the stage the panels leave free.
    if (this.frame++ % 10 === 0) this.applyOffset();
  }

  private applyOffset() {
    const v = this.viewer!, f = v.camera.frustum;
    if (!(f instanceof Cesium.PerspectiveFrustum) || !this.el) return;
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1, sa = stageSafeArea();
    const dx = (sa.l + sa.r) / 2 - w / 2, dy = (sa.t + sa.b) / 2 - h / 2;
    const fov = f.fov ?? Math.PI / 3, aspect = w / h, fovy = aspect < 1 ? fov : Math.atan(Math.tan(fov / 2) / aspect) * 2;
    const halfH = f.near * Math.tan(fovy / 2), halfW = halfH * aspect;
    f.xOffset = -dx / (w / 2) * halfW;
    f.yOffset = dy / (h / 2) * halfH;
  }

  private placeOverlays() {
    const v = this.viewer!, s = getState(), cam = v.camera;
    const t = performance.now() / 1000;
    for (const m of this.movers) {
      const f = ((t / m.d) + m.o) % 1, x = f * (m.p.length - 1), i = Math.floor(x), k = x - i;
      const a = m.p[i], b = m.p[Math.min(i + 1, m.p.length - 1)];
      m.ov.pos = cart([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
    const occ = new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, cam.positionWC);
    const on: Record<Group, boolean> = { sites: this.groupOn('sites', s), xfer: this.groupOn('xfer', s), ship: this.groupOn('ship', s), route: this.groupOn('route', s), site: this.groupOn('site', s), flows: this.groupOn('flows', s), photos: this.groupOn('photos', s) };
    for (const g of Object.keys(this.ents) as Group[]) for (const e of this.ents[g]) {
      const layer = this.flowLayer.get(e);
      e.show = on[g] && (!layer || isOn(s, 'movements', layer));
    }
    const W = this.el!.clientWidth, H = this.el!.clientHeight;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const items: { o: Ov; x: number; y: number }[] = [];
    for (const o of this.ovs) {
      let vis = on[o.group] && (!o.show || o.show());
      let p: Cesium.Cartesian2 | undefined;
      if (vis) {
        const toP = Cesium.Cartesian3.subtract(o.pos, cam.positionWC, new Cesium.Cartesian3());
        vis = Cesium.Cartesian3.dot(toP, cam.directionWC) > 0 && occ.isPointVisible(o.pos);
        if (vis) p = Cesium.SceneTransforms.worldToWindowCoordinates(v.scene, o.pos, this.scratch);
        vis = !!p && p.x > -200 && p.y > -200 && p.x < W + 200 && p.y < H + 200;
      }
      if (!vis || !p) { o.el.style.display = 'none'; continue; }
      o.el.style.display = '';
      items.push({ o, x: p.x, y: p.y });
    }
    // Labels above a point are de-overlapped: higher z first, later ones nudged up or hidden.
    items.sort((a, b) => b.o.z - a.o.z);
    for (const { o, x, y } of items) {
      let dy = 0;
      if (o.anchor !== 'pt') {
        const c = o.el.firstElementChild as HTMLElement | null;
        if (c && (!o.w || this.frame % 30 === 0)) { o.w = c.offsetWidth; o.h = c.offsetHeight; }
        const w = o.w ?? 0, h = o.h ?? 0, x0 = x - w / 2;
        let y0 = o.anchor === 'top' ? y - h - 6 : y - h / 2, n = 0;
        for (; n < 6; n++) {
          const hit = placed.find(r => x0 < r.x + r.w + 4 && x0 + w + 4 > r.x && y0 < r.y + r.h + 4 && y0 + h + 4 > r.y);
          if (!hit) break;
          y0 = hit.y - h - 6;
        }
        if (n === 6) { o.el.style.display = 'none'; continue; }
        dy = y0 - (o.anchor === 'top' ? y - h - 6 : y - h / 2);
        placed.push({ x: x0, y: y0, w, h });
      }
      o.el.style.transform = `translate(${x.toFixed(1)}px,${(y + dy).toFixed(1)}px)`;
    }
  }

  // ---------- Camera ----------
  /** How much larger than the content the view must be, given the panels covering the stage. */
  private fitK() {
    const w = this.el!.clientWidth || 1, h = this.el!.clientHeight || 1, sa = stageSafeArea();
    return Math.min(2.6, Math.max(1, Math.max(w / Math.max(200, sa.r - sa.l), h / Math.max(200, sa.b - sa.t))));
  }

  private flyToPoints(pts: LatLng[], pitchDeg: number, heading = 0, duration = 1.6, minRadius = 0) {
    const v = this.viewer;
    if (!v) return;
    const bs = Cesium.BoundingSphere.fromPoints(pts.map(p => cart(p)));
    bs.radius = Math.max(bs.radius, minRadius) * this.fitK();
    v.camera.flyToBoundingSphere(bs, { offset: new Cesium.HeadingPitchRange(heading, pitchDeg * RAD, 0), duration });
  }

  private siteView(duration = 2.8) {
    const s = getState(), site = SITE_BY_ID[s.site];
    const pts = site.facilities.map(f => facilityLL(site, f));
    const top = s.dim === '2D';
    this.flyToPoints(pts, top ? -89.5 : -38, top ? 0 : -35 * RAD, duration, 150);
  }

  fitScreen() {
    if (!this.viewer) return;
    const s = getState(), pitch = s.mapTilt ? -45 : -89.5;
    if (s.screen === 'network') this.flyToPoints([...NETWORK_BOUNDS, ...SITES.map(x => x.ll)], pitch, 0, 2);
    if (s.screen === 'routes') this.flyToPoints([...NH48, ...RAIL], pitch, 0, 1.6);
    if (s.screen === 'shipments') { const sh = SHIPS[s.ship]; this.flyToPoints([SITE_BY_ID[sh.from].ll, SITE_BY_ID[sh.to].ll], pitch, 0, 1.6, 15000); }
    if (SITE_SCREENS.includes(s.screen)) this.siteView();
  }

  /** Called when the globe becomes visible or the screen changes. */
  show(scr: ScreenId) {
    if (!this.viewer) return;
    this.viewer.resize();
    this.drawSites();
    if (scr === 'routes') this.drawRoutes(); else if (MAP_SCREENS.includes(scr)) this.drawShips();
    this.drawSite();
    this.fitScreen();
  }

  focus(k: string) {
    const s = getState(), site = SITE_BY_ID[s.site], f = site.facilities.find(x => x.k === k);
    if (!f || !this.viewer) return;
    this.flyToPoints([facilityLL(site, f)], -30, this.viewer.camera.heading, 1.4, 120);
  }

  /** Stand near a photo's location, looking towards the site. */
  viewPhoto(siteId: string, i: number) {
    const ph = getState().photos[siteId], site = SITE_BY_ID[siteId];
    if (ph?.status !== 'ready' || !ph.items[i]?.ll || !this.viewer) return;
    const [la, lo] = ph.items[i].ll!;
    const heading = Math.atan2((site.ll[1] - lo) * Math.cos(la * RAD), site.ll[0] - la);
    this.viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(lo, la, site.ellH + 60), orientation: { heading, pitch: -12 * RAD, roll: 0 }, duration: 1.6 });
  }

  zoomBy(d: number) {
    const c = this.viewer?.camera;
    if (!c) return;
    const h = c.positionCartographic.height;
    if (d > 0) c.zoomIn(h * .4); else c.zoomOut(h * .7);
  }
  resize() { this.viewer?.resize(); }
}

export const globe = new GlobeEngine();
