// MapLibre GL map for the Network, Routes and Shipments screens, drawn only from OpenStreetMap
// standard tiles. Imperative by design: it subscribes to the app store and redraws its layers
// when relevant state changes.
import maplibregl, { type GeoJSONSource, type LngLatLike, type Map as MLMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature } from 'geojson';
import { AIR, NETWORK_BOUNDS, NH48, RAIL, ROUTES, SHIPS, XFERS } from '../data/sample';
import { SITE_BY_ID, SITES } from '../data/sites';
import type { LatLng, ScreenId } from '../data/types';
import { HANDOFF_ZOOM, safeCentreOffset } from '../safeArea';
import { pinSite, selectRoute, selectShip } from '../state/actions';
import { getState, isOn, MAP_SCREENS, subscribe, type AppState } from '../state/store';

/** Flight time grows gently with distance: about 2 s across a city, 3.4 s across India. */
const flightSeconds = (km: number) => Math.min(3.4, 1.8 + Math.log10(1 + km) * .55);

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

/** App coordinates are [lat, lng]; MapLibre wants [lng, lat]. */
const lnglat = ([la, lo]: LatLng): [number, number] => [lo, la];
const km = (a: LatLng, b: LatLng) => {
  const R = 6371, r = Math.PI / 180, dla = (b[0] - a[0]) * r, dlo = (b[1] - a[1]) * r;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dlo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

type Group = 'sites' | 'xfer' | 'ship' | 'route';
type Dash = 'solid' | 'dash' | 'dot';
interface Line { group: Group; pts: LatLng[]; color: string; width: number; opacity?: number; dash?: Dash }
interface Mover { m: Marker; p: LatLng[]; d: number; o: number; group: Group }

/** An HTML marker at a point; `html` is positioned relative to a zero-size anchor, like the pin CSS expects. */
function htmlMarker(ll: LatLng, html: string, z = 0, onClick?: () => void) {
  const el = document.createElement('div');
  el.className = 'mk';
  el.innerHTML = html;
  el.style.zIndex = String(z);
  if (onClick) el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat(lnglat(ll));
}

/** Circle of `radius` metres as a polygon ring. */
function circle(c: LatLng, radius: number, n = 64): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    out.push([c[1] + radius * Math.sin(a) / (111320 * Math.cos(c[0] * Math.PI / 180)), c[0] + radius * Math.cos(a) / 110540]);
  }
  return out;
}

class MapEngine {
  map: MLMap | null = null;
  ready = false;
  private el: HTMLElement | null = null;
  private loaded = false;
  private lines: Line[] = [];
  private markers: Record<Group, Marker[]> = { sites: [], xfer: [], ship: [], route: [] };
  private movers: Mover[] = [];
  private areas: Feature[] = [];
  private visible = new Set<Group>(['sites']);
  private roadGeom: LatLng[] = NH48;
  private last: Partial<AppState> = {};
  /** Set before the map becomes visible again after the 3D site, so it reappears at the matching view. */
  handoffFrom: LatLng | null = null;

  init(el: HTMLElement) {
    if (this.map) return;
    this.el = el;
    const map = this.map = new maplibregl.Map({
      container: el,
      center: [77, 15.6], zoom: 4.6,
      minZoom: 3, maxZoom: 19, maxPitch: 0, attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' },
          lines: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
          areas: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          { id: 'bg', type: 'background', paint: { 'background-color': '#1A1C20' } },
          { id: 'osm', type: 'raster', source: 'osm' },
          { id: 'area-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': .15 } },
          { id: 'area-line', type: 'line', source: 'areas', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [3, 3] } },
          ...(['solid', 'dash', 'dot'] as const).map(d => ({
            id: `lines-${d}`, type: 'line' as const, source: 'lines', filter: ['==', ['get', 'dash'], d],
            layout: { 'line-cap': d === 'dot' ? 'round' as const : 'butt' as const, 'line-join': 'round' as const },
            paint: {
              'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'],
              ...(d === 'dash' ? { 'line-dasharray': [3, 3] } : d === 'dot' ? { 'line-dasharray': [.4, 2.6] } : {}),
            },
          })),
        ],
      } as maplibregl.StyleSpecification,
    });
    // A flat, north-up street map: no rotation or tilt.
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.touchPitch.disable();
    map.on('load', () => {
      this.loaded = true;
      this.flushLines();
      if (MAP_SCREENS.includes(getState().screen) && !this.hidden()) this.fitScreen();
    });
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
    if (!MAP_SCREENS.includes(s.screen)) return;
    const changed = (k: keyof AppState) => s[k] !== p[k];
    if (changed('site') || changed('off') || changed('screen')) this.drawSites();
    if (s.screen === 'routes' && (changed('route') || changed('off') || changed('screen'))) this.drawRoutes();
    if (s.screen !== 'routes' && (changed('ship') || changed('screen'))) this.drawShips();
    if (changed('off') || changed('screen')) this.layersFor(s.screen);
  }

  // ---------- Drawing ----------
  private clear(group: Group) {
    this.markers[group].forEach(m => m.remove());
    this.markers[group] = [];
    this.movers = this.movers.filter(m => m.group !== group);
    this.lines = this.lines.filter(l => l.group !== group);
  }
  private add(group: Group, m: Marker) {
    this.markers[group].push(m);
    if (this.visible.has(group) && this.map) m.addTo(this.map);
    return m;
  }
  private mover(group: Group, p: LatLng[], cls: string, d: number, o = 0) {
    const m = this.add(group, htmlMarker(p[0], `<span class="mv ${cls}"></span>`, 5));
    this.movers.push({ m, p, d, o, group });
  }
  private flushLines() {
    const map = this.map;
    if (!map || !this.loaded) return;
    (map.getSource('lines') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: this.lines.filter(l => this.visible.has(l.group)).map(l => ({
        type: 'Feature', geometry: { type: 'LineString', coordinates: l.pts.map(lnglat) },
        properties: { color: l.color, width: l.width, opacity: l.opacity ?? 1, dash: l.dash ?? 'solid' },
      })),
    });
    (map.getSource('areas') as GeoJSONSource).setData({ type: 'FeatureCollection', features: this.visible.has('route') ? this.areas : [] });
  }

  private drawSites() {
    const s = getState();
    this.clear('sites');
    SITES.forEach(site => {
      const sel = site.id === s.site;
      const side = site.left === 'b' ? 'b' : site.left ? 'l' : '';
      const n = site.alerts.length;
      const pulse = n && isOn(s, 'network', 'alerts') ? '<span class="pu"></span>' : '';
      const alerts = n ? `${n} alert${n > 1 ? 's' : ''}` : 'no alerts';
      this.add('sites', htmlMarker(site.ll, `<div class="pin ${side} ${sel ? 'sel' : ''}">${pulse}<span class="pd"></span><div class="pc"><b>${site.name}</b><span>${site.type.split(' · ')[0]} · ${alerts}</span></div></div>`, sel ? 30 : 20, () => pinSite(site.id)));
    });
  }

  private drawXfers() {
    this.clear('xfer');
    XFERS.forEach(([a, b], i) => {
      const p = bez(SITE_BY_ID[a].ll, SITE_BY_ID[b].ll, .22);
      this.lines.push({ group: 'xfer', pts: p, color: '#FFFFFF', width: 2, opacity: .85, dash: 'dash' });
      this.mover('xfer', p, '', 8 + i * 2, i * .3);
    });
    this.flushLines();
  }

  private drawShips() {
    const s = getState();
    this.clear('ship');
    SHIPS.forEach((sh, i) => {
      const p = bez(SITE_BY_ID[sh.from].ll, SITE_BY_ID[sh.to].ll, .08);
      const on = i === s.ship;
      if (sh.hold) {
        const hold = sh.hold;
        let k = 0, best = Infinity;
        p.forEach((q, j) => { const d = (q[0] - hold[0]) ** 2 + (q[1] - hold[1]) ** 2; if (d < best) { best = d; k = j; } });
        this.lines.push({ group: 'ship', pts: p.slice(0, k + 1), color: '#1450F5', width: on ? 5 : 3 });
        this.lines.push({ group: 'ship', pts: p.slice(k), color: '#C8312B', width: 3, dash: 'dash' });
        this.add('ship', htmlMarker(p[k], '<span class="exc"><u></u><i></i></span>', 25));
        if (s.screen === 'shipments') {
          this.add('ship', htmlMarker(p[k], `<span class="tagm bad" style="left:-8rem;top:2.75rem"><b>E-way bill hold · Hubballi</b>${sh.carrier} · ${sh.id}</span>`, 24, () => selectShip(i)));
        }
      } else {
        const warn = sh.dot === '#C77700';
        this.lines.push({ group: 'ship', pts: p, color: on ? '#1450F5' : warn ? '#FFE141' : '#A1B9FB', width: on ? 5 : 2.5, opacity: on ? 1 : .9, dash: on ? 'solid' : 'dot' });
        this.mover('ship', p, (on ? 'big ' : '') + (warn ? 'warn' : ''), sh.dur ?? 10, i * .17);
      }
    });
    this.flushLines();
  }

  private routeGeom(g: 'road' | 'air' | 'rail'): LatLng[] {
    if (g === 'road') return this.roadGeom;
    if (g === 'rail') return RAIL;
    return [AIR.siteA, AIR.airportA, ...bez(AIR.airportA, AIR.airportB, -.12, 40), AIR.siteB];
  }

  private drawRoutes() {
    const s = getState();
    this.clear('route');
    // Draw the selected option last so it sits on top; options that share a geometry draw once.
    const order = ROUTES.map((_, i) => i).sort((a, b) => Number(a === s.route) - Number(b === s.route));
    const drawn = new Set<string>();
    order.forEach(i => {
      const r = ROUTES[i], on = i === s.route;
      if (drawn.has(r.geom) && !on) return;
      drawn.add(r.geom);
      const g = this.routeGeom(r.geom);
      this.lines.push(on ? { group: 'route', pts: g, color: '#1450F5', width: 6 } : { group: 'route', pts: g, color: '#FFFFFF', width: 3, opacity: .8, dash: 'dash' });
      if (on) this.mover('route', g, 'big', 10);
    });
    ROUTES.forEach((r, i) => {
      if (r.fr === undefined) return;
      const g = this.routeGeom(r.geom), p = g[Math.min(g.length - 1, Math.round((g.length - 1) * r.fr))];
      // The split option rides on the air leg, so its tag lights the air tag.
      const on = i === s.route || (ROUTES[s.route].fr === undefined && r.geom === ROUTES[s.route].geom);
      this.add('route', htmlMarker(p, `<span class="tagm ${on ? 'on' : ''}" style="left:${r.ox}px;top:${r.oy}px"><b>${r.mode}</b>${r.eta} · ${r.cost}</span>`, on ? 22 : 21, () => selectRoute(i)));
    });
    this.areas = [];
    if (isOn(s, 'routes', 'weather')) {
      this.areas.push({ type: 'Feature', properties: { color: '#FFE141' }, geometry: { type: 'Polygon', coordinates: [circle([16.9, 74.05], 75000)] } });
      this.add('route', htmlMarker([16.2, 72.4], '<span class="tagm warn"><b>Heavy rain alert · Western Ghats</b>Road leg +6 h risk</span>', 21));
    }
    this.flushLines();
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
    this.movers.forEach(({ m, p, d, o, group }) => {
      if (!this.visible.has(group)) return;
      const f = ((sec / d) + o) % 1, x = f * (p.length - 1), i = Math.floor(x), t = x - i;
      const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
      m.setLngLat([a[1] + (b[1] - a[1]) * t, a[0] + (b[0] - a[0]) * t]);
    });
  };

  layersFor(scr: ScreenId) {
    const map = this.map;
    if (!map) return;
    const s = getState();
    const want = new Set<Group>();
    if (scr !== 'network' || isOn(s, 'network', 'sites')) want.add('sites');
    if (scr === 'network' && isOn(s, 'network', 'xfer')) want.add('xfer');
    if ((scr === 'network' && isOn(s, 'network', 'ship')) || scr === 'shipments') want.add('ship');
    if (scr === 'routes') want.add('route');
    (Object.keys(this.markers) as Group[]).forEach(g => {
      const on = want.has(g);
      if (on !== this.visible.has(g)) this.markers[g].forEach(m => (on ? m.addTo(map) : m.remove()));
    });
    this.visible = want;
    this.flushLines();
  }

  /** Map padding so fitted content clears the rail, drawer and timeline. */
  private pad(): maplibregl.PaddingOptions {
    const H = document.documentElement, rem = parseFloat(getComputedStyle(H).fontSize);
    const portrait = H.classList.contains('portrait');
    const w = (id: string) => (document.getElementById(id) as HTMLElement | null)?.offsetWidth ?? 0;
    const h = (id: string) => (document.getElementById(id) as HTMLElement | null)?.offsetHeight ?? 0;
    const railw = H.classList.contains('rail-closed') || portrait ? 0 : w('rail') + rem;
    const dr = portrait || H.classList.contains('drawer-closed') ? 0 : w('drawer') + rem;
    const bot = h('timeline') + 2 * rem + (portrait ? h('drawer') + rem : 0);
    return { left: railw + rem * 2, top: rem * 4.5, right: dr + rem * 2, bottom: bot + rem };
  }

  private fit(pts: LatLng[], maxZoom?: number, duration = 1000) {
    const map = this.map!;
    // A hidden or not-yet-sized container has no room to fit into.
    if (!map.getContainer().clientWidth || !map.getContainer().clientHeight) return;
    const b = new maplibregl.LngLatBounds();
    pts.forEach(p => b.extend(lnglat(p)));
    // Only pass maxZoom when set: an explicit undefined overrides MapLibre's default and yields NaN.
    map.fitBounds(b, { padding: this.pad(), duration, ...(maxZoom ? { maxZoom } : {}), pitch: 0, bearing: 0 });
  }

  fitScreen() {
    if (!this.map) return;
    const s = getState();
    if (s.screen === 'network') this.fit(NETWORK_BOUNDS, undefined, 1200);
    if (s.screen === 'routes') this.fit([...NH48, ...RAIL], undefined, 800);
    if (s.screen === 'shipments') { const sh = SHIPS[s.ship]; this.fit([SITE_BY_ID[sh.from].ll, SITE_BY_ID[sh.to].ll], 10, 800); }
  }

  /** Map centre that puts `ll` at the centre of the stage's safe area (where the 3D view centres the site), flat and north-up. */
  private centreFor(ll: LatLng, zoom: number): LngLatLike {
    const [ox, oy] = safeCentreOffset(), world = 512 * 2 ** zoom;
    const m = maplibregl.MercatorCoordinate.fromLngLat(lnglat(ll));
    return new maplibregl.MercatorCoordinate(m.x - ox / world, m.y - oy / world).toLngLat();
  }

  /** Called whenever the map surface is visible: after a 3D handoff, then on map screens draw and frame. */
  show(scr: ScreenId) {
    const map = this.map;
    if (!map) return;
    map.resize();
    if (this.handoffFrom) {
      map.jumpTo({ center: this.centreFor(this.handoffFrom, HANDOFF_ZOOM), zoom: HANDOFF_ZOOM, pitch: 0, bearing: 0 });
      this.handoffFrom = null;
      if (MAP_SCREENS.includes(scr)) setTimeout(() => this.fitScreen(), 450);
    } else if (MAP_SCREENS.includes(scr)) this.fitScreen();
    if (!MAP_SCREENS.includes(scr)) return;
    this.drawSites();
    if (scr === 'routes') this.drawRoutes(); else this.drawShips();
    this.layersFor(scr);
  }

  invalidate() { this.map?.resize(); }
  /** Fly to a site at no less than `minZoom` (MapLibre zoom levels). */
  flyTo(ll: LatLng, minZoom: number) { this.map?.flyTo({ center: lnglat(ll), zoom: Math.max(this.map.getZoom(), minZoom), duration: 900 }); }
  zoomBy(d: number) { this.map?.easeTo({ zoom: this.map.getZoom() + d, duration: 300 }); }
  /** Fly down to the flat, north-up handoff view of a site; resolves when the map has settled. */
  flyToSite(ll: LatLng): Promise<void> {
    const map = this.map;
    if (!map) return Promise.resolve();
    const c = map.getCenter(), far = km([c.lat, c.lng], ll);
    return new Promise(done => {
      map.once('moveend', () => done());
      map.flyTo({ center: this.centreFor(ll, HANDOFF_ZOOM), zoom: HANDOFF_ZOOM, pitch: 0, bearing: 0, duration: flightSeconds(far) * 1000, essential: true });
    });
  }
}

export const mapEngine = new MapEngine();
