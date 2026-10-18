// Leaflet map for the Network, Routes and Shipments screens. Imperative by design:
// it subscribes to the app store and redraws its layers when relevant state changes.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AIR, INDIA_BOUNDS, NH48, RAIL, ROUTES, SHIPS, SITE_BY_ID, SITES, XFERS } from '../data/sample';
import type { LatLng, ScreenId } from '../data/types';
import { pinSite, selectRoute, selectShip } from '../state/actions';
import { getState, isOn, MAP_SCREENS, subscribe, type AppState } from '../state/store';

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';

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

interface Mover { m: L.Marker; p: LatLng[]; d: number; o: number }

const divM = (ll: LatLng, html: string, z = 0) =>
  L.marker(ll, { icon: L.divIcon({ className: '', html, iconSize: [0, 0] }), zIndexOffset: z, keyboard: false });

class MapEngine {
  map: L.Map | null = null;
  ready = false;
  private el: HTMLElement | null = null;
  private base: Record<'sat' | 'lab' | 'osm', L.TileLayer> | null = null;
  private g = {} as Record<'sites' | 'xfer' | 'ship' | 'route', L.LayerGroup>;
  private movers: Mover[] = [];
  private roadGeom: LatLng[] = NH48;
  private last: Partial<AppState> = {};

  init(el: HTMLElement) {
    if (this.map) return;
    this.el = el;
    const map = this.map = L.map(el, { zoomControl: false, minZoom: 4, maxZoom: 19, zoomSnap: .25, worldCopyJump: false });
    this.base = {
      sat: L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
      lab: L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, attribution: 'Labels © Esri' }),
      osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }),
    };
    this.applyBase(getState().base);
    map.fitBounds(INDIA_BOUNDS);
    this.g.sites = L.layerGroup().addTo(map);
    this.g.xfer = L.layerGroup();
    this.g.ship = L.layerGroup();
    this.g.route = L.layerGroup();
    this.drawSites(); this.drawXfers(); this.drawShips(); this.drawRoutes();
    this.ready = true;
    subscribe(() => this.sync());
    requestAnimationFrame(this.anim);
    this.fetchRoad();
  }

  private hidden() { return !this.el || this.el.classList.contains('hidden'); }

  /** Redraw only what changed since the last store update. */
  private sync() {
    const s = getState(), p = this.last;
    this.last = s;
    if (s.base !== p.base) this.applyBase(s.base);
    if (!MAP_SCREENS.includes(s.screen)) return;
    const changed = (k: keyof AppState) => s[k] !== p[k];
    if (changed('site') || changed('off') || changed('screen')) this.drawSites();
    if (s.screen === 'routes' && (changed('route') || changed('off') || changed('screen'))) this.drawRoutes();
    if (s.screen !== 'routes' && (changed('ship') || changed('screen'))) this.drawShips();
    if (changed('off') || changed('screen')) this.layersFor(s.screen);
  }

  private applyBase(b: 'sat' | 'osm') {
    const map = this.map, base = this.base;
    if (!map || !base) return;
    Object.values(base).forEach(l => map.removeLayer(l));
    if (b === 'sat') { base.sat.addTo(map); base.lab.addTo(map); } else base.osm.addTo(map);
  }

  private mover(p: LatLng[], cls: string, d: number, o = 0) {
    const m = divM(p[0], `<span class="mv ${cls}"></span>`);
    this.movers.push({ m, p, d, o });
    return m;
  }

  private drawSites() {
    const s = getState();
    this.g.sites.clearLayers();
    SITES.forEach(site => {
      const sel = site.id === s.site;
      const side = site.left === 'b' ? 'b' : site.left ? 'l' : '';
      const pulse = site.alerts && isOn(s, 'network', 'alerts') ? '<span class="pu"></span>' : '';
      const alerts = site.alerts ? `${site.alerts} alert${site.alerts > 1 ? 's' : ''}` : 'no alerts';
      const m = divM(site.ll, `<div class="pin ${side} ${sel ? 'sel' : ''}">${pulse}<span class="pd"></span><div class="pc"><b>${site.name}</b><span>Space ${site.space}% · ${alerts}</span></div></div>`, sel ? 1000 : 0);
      m.on('click', () => pinSite(site.id));
      this.g.sites.addLayer(m);
    });
  }

  private dropMovers(group: L.LayerGroup) {
    const gone = new Set(group.getLayers());
    this.movers = this.movers.filter(mv => !gone.has(mv.m));
    group.clearLayers();
  }

  private drawXfers() {
    this.dropMovers(this.g.xfer);
    XFERS.forEach(([a, b], i) => {
      const p = bez(SITE_BY_ID[a].ll, SITE_BY_ID[b].ll, .22);
      this.g.xfer.addLayer(L.polyline(p, { color: '#FFFFFF', weight: 2, opacity: .85, className: 'flowdash' }));
      this.g.xfer.addLayer(this.mover(p, '', 8 + i * 2, i * .3));
    });
  }

  private drawShips() {
    const s = getState();
    this.dropMovers(this.g.ship);
    SHIPS.forEach((sh, i) => {
      const p = bez(SITE_BY_ID[sh.from].ll, SITE_BY_ID[sh.to].ll, .08);
      const on = i === s.ship;
      if (sh.hold) {
        const hold = sh.hold;
        let k = 0, best = Infinity;
        p.forEach((q, j) => { const d = (q[0] - hold[0]) ** 2 + (q[1] - hold[1]) ** 2; if (d < best) { best = d; k = j; } });
        this.g.ship.addLayer(L.polyline(p.slice(0, k + 1), { color: '#1450F5', weight: on ? 5 : 3 }));
        this.g.ship.addLayer(L.polyline(p.slice(k), { color: '#C8312B', weight: 3, dashArray: '4 8' }));
        this.g.ship.addLayer(divM(p[k], '<span class="exc"><u></u><i></i></span>', 900));
        if (s.screen === 'shipments') {
          const tag = divM(p[k], `<span class="tagm bad" style="left:-8rem;top:2.75rem"><b>E-way bill hold · Hubballi</b>${sh.carrier} · ${sh.id}</span>`, 800);
          tag.on('click', () => selectShip(i));
          this.g.ship.addLayer(tag);
        }
      } else {
        const warn = sh.dot === '#C77700';
        this.g.ship.addLayer(L.polyline(p, { color: on ? '#1450F5' : warn ? '#FFE141' : '#A1B9FB', weight: on ? 5 : 2.5, opacity: on ? 1 : .9, dashArray: on ? undefined : '2 7' }));
        this.g.ship.addLayer(this.mover(p, (on ? 'big ' : '') + (warn ? 'warn' : ''), sh.dur ?? 10, i * .17));
      }
    });
  }

  private routeGeom(g: 'road' | 'air' | 'rail'): LatLng[] {
    if (g === 'road') return this.roadGeom;
    if (g === 'rail') return RAIL;
    return [AIR.siteA, AIR.airportA, ...bez(AIR.airportA, AIR.airportB, -.12, 40), AIR.siteB];
  }

  private drawRoutes() {
    const s = getState();
    this.dropMovers(this.g.route);
    // Draw the selected option last so it sits on top; options that share a geometry draw once.
    const order = ROUTES.map((_, i) => i).sort((a, b) => Number(a === s.route) - Number(b === s.route));
    const drawn = new Set<string>();
    order.forEach(i => {
      const r = ROUTES[i], on = i === s.route;
      if (drawn.has(r.geom) && !on) return;
      drawn.add(r.geom);
      const g = this.routeGeom(r.geom);
      this.g.route.addLayer(L.polyline(g, on ? { color: '#1450F5', weight: 6, opacity: 1 } : { color: '#FFFFFF', weight: 3, opacity: .8, dashArray: '6 8' }));
      if (on) this.g.route.addLayer(this.mover(g, 'big', 10));
    });
    ROUTES.forEach((r, i) => {
      if (r.fr === undefined) return;
      const g = this.routeGeom(r.geom), p = g[Math.min(g.length - 1, Math.round((g.length - 1) * r.fr))];
      // The split option rides on the air leg, so its tag lights the air tag.
      const on = i === s.route || (ROUTES[s.route].fr === undefined && r.geom === ROUTES[s.route].geom);
      const tag = divM(p, `<span class="tagm ${on ? 'on' : ''}" style="left:${r.ox}px;top:${r.oy}px"><b>${r.mode}</b>${r.eta} · ${r.cost}</span>`, on ? 700 : 600);
      tag.on('click', () => selectRoute(i));
      this.g.route.addLayer(tag);
    });
    if (isOn(s, 'routes', 'weather')) {
      this.g.route.addLayer(L.circle([16.9, 74.05], { radius: 75000, color: '#FFE141', weight: 2, dashArray: '6 6', fillColor: '#FFE141', fillOpacity: .15 }));
      this.g.route.addLayer(divM([16.2, 72.4], '<span class="tagm warn"><b>Heavy rain alert · Western Ghats</b>Road leg +6 h risk</span>', 650));
    }
  }

  /** Swap the stored NH48 polyline for a real OSRM road route when the service is reachable. */
  private async fetchRoad() {
    try {
      const a = SITE_BY_ID.ktec.ll, b = SITE_BY_ID.pnq.ll;
      const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${a[1]},${a[0]};${b[1]},${b[0]}?overview=simplified&geometries=geojson`);
      const j = await r.json();
      const coords: [number, number][] | undefined = j.routes?.[0]?.geometry?.coordinates;
      if (coords) { this.roadGeom = coords.map(c => [c[1], c[0]]); if (getState().screen === 'routes') this.drawRoutes(); }
    } catch { /* keep the stored geometry */ }
  }

  private anim = (now: number) => {
    requestAnimationFrame(this.anim);
    if (this.hidden()) return;
    const sec = now / 1000;
    this.movers.forEach(({ m, p, d, o }) => {
      if (!(m as unknown as { _map?: L.Map })._map) return;
      const f = ((sec / d) + o) % 1, x = f * (p.length - 1), i = Math.floor(x), t = x - i;
      const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
      m.setLatLng([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    });
  };

  layersFor(scr: ScreenId) {
    const map = this.map;
    if (!map) return;
    const s = getState();
    const want: Record<string, boolean> = { sites: true };
    if (scr === 'network') {
      want.xfer = isOn(s, 'network', 'xfer');
      want.ship = isOn(s, 'network', 'ship');
      want.sites = isOn(s, 'network', 'sites');
    }
    if (scr === 'shipments') want.ship = true;
    if (scr === 'routes') want.route = true;
    (['sites', 'xfer', 'ship', 'route'] as const).forEach(k => { if (want[k]) this.g[k].addTo(map); else map.removeLayer(this.g[k]); });
  }

  /** Map padding so fitted content clears the rail, drawer and timeline. */
  private pad(): L.FitBoundsOptions {
    const H = document.documentElement, rem = parseFloat(getComputedStyle(H).fontSize);
    const portrait = H.classList.contains('portrait');
    const w = (id: string) => (document.getElementById(id) as HTMLElement | null)?.offsetWidth ?? 0;
    const h = (id: string) => (document.getElementById(id) as HTMLElement | null)?.offsetHeight ?? 0;
    const railw = H.classList.contains('rail-closed') || portrait ? 0 : w('rail') + rem;
    const dr = portrait || H.classList.contains('drawer-closed') ? 0 : w('drawer') + rem;
    const bot = h('timeline') + 2 * rem + (portrait ? h('drawer') + rem : 0);
    return { paddingTopLeft: [railw + rem * 2, rem * 4.5], paddingBottomRight: [dr + rem * 2, bot + rem] };
  }

  fitScreen() {
    const map = this.map;
    if (!map) return;
    const s = getState();
    if (s.screen === 'network') map.flyToBounds(INDIA_BOUNDS, { ...this.pad(), duration: .8 });
    if (s.screen === 'routes') map.flyToBounds(L.latLngBounds([...NH48, ...RAIL]), { ...this.pad(), duration: .8 });
    if (s.screen === 'shipments') {
      const sh = SHIPS[s.ship];
      map.flyToBounds(L.latLngBounds([SITE_BY_ID[sh.from].ll, SITE_BY_ID[sh.to].ll]), { ...this.pad(), duration: .8, maxZoom: 8 });
    }
  }

  /** Called when the map surface becomes visible for a map screen. */
  show(scr: ScreenId) {
    if (!this.map) return;
    this.map.invalidateSize();
    this.drawSites();
    if (scr === 'routes') this.drawRoutes(); else this.drawShips();
    this.layersFor(scr);
    this.fitScreen();
  }

  invalidate() { this.map?.invalidateSize(); }
  flyTo(ll: LatLng, minZoom: number) { this.map?.flyTo(ll, Math.max(this.map.getZoom(), minZoom), { duration: .8 }); }
  zoomBy(d: number) { this.map?.setZoom(this.map.getZoom() + d); }
  flyToSite(ll: LatLng, done: () => void) {
    const map = this.map;
    if (!map) { done(); return; }
    map.flyTo(ll, 17, { duration: 1.4 });
    map.once('moveend', done);
  }
}

export const mapEngine = new MapEngine();
