// OpenStreetMap features around a site from the Overpass API, projected to local metres
// (x east, y north, origin at the site). Cached in localStorage so revisits load instantly.

export type Pt = [number, number];
export interface OsmBuilding { id: number; pts: Pt[]; area: number; c: Pt; h: number; d: number; tag: string }
export interface OsmWay { pts: Pt[]; kind: string }
export interface OsmData { buildings: OsmBuilding[]; roads: OsmWay[]; green: Pt[][]; water: Pt[][]; trees: Pt[] }

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const CACHE_V = 'ktec-twin.osm.v3.';
const R_BLD = 750, R_CTX = 1000;

interface El { type: 'way' | 'node'; id: number; lat?: number; lon?: number; geometry?: { lat: number; lon: number }[]; tags?: Record<string, string> }

export const projector = (lat0: number, lon0: number) => {
  const mLat = 111320, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  return (lat: number, lon: number): Pt => [(lon - lon0) * mLon, (lat - lat0) * mLat];
};

/** Inverse of `projector`: local metres back to latitude/longitude. */
export const unprojector = (lat0: number, lon0: number) => {
  const mLat = 111320, mLon = 111320 * Math.cos(lat0 * Math.PI / 180);
  return ([x, y]: Pt): [number, number] => [lat0 + y / mLat, lon0 + x / mLon];
};

/** Shoelace area (signed) and centroid. */
export function polyStats(pts: Pt[]): { a: number; c: Pt } {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], k = x0 * y1 - x1 * y0;
    a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
  }
  a /= 2;
  return { a, c: Math.abs(a) < 1e-6 ? pts[0] : [cx / (6 * a), cy / (6 * a)] };
}

export function inside([x, y]: Pt, pts: Pt[]) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function heightOf(tags: Record<string, string>, area: number, id: number) {
  const h = parseFloat(tags.height) || parseFloat(tags['building:height']);
  if (h) return h;
  const lv = parseFloat(tags['building:levels']);
  if (lv) return lv * 3.5 + 1;
  // No height in OSM: a stable estimate from type and footprint so the skyline stays plausible.
  const r = Math.abs(Math.sin(id * 12.9898)) % 1;
  const t = tags.building;
  if (t === 'industrial' || t === 'warehouse' || t === 'factory') return 9 + r * 5;
  if (t === 'office' || t === 'commercial') return area > 1500 ? 28 + r * 30 : 12 + r * 10;
  if (t === 'house' || t === 'residential' || t === 'apartments') return area > 600 ? 12 + r * 9 : 6 + r * 4;
  return area > 2500 ? 10 + r * 8 : 5 + r * 6;
}

/** The Overpass query for one site. Shared with scripts/fetch-osm.ts, which bundles the answers at deploy time. */
export function overpassQuery(lat: number, lon: number) {
  return `[out:json][timeout:90];(
    way["building"](around:${R_BLD},${lat},${lon});
    way["highway"](around:${R_CTX},${lat},${lon});
    way["landuse"~"grass|meadow|forest|recreation_ground|village_green|orchard"](around:${R_CTX},${lat},${lon});
    way["leisure"~"park|garden|pitch"](around:${R_CTX},${lat},${lon});
    way["natural"~"water|wood|scrub"](around:${R_CTX},${lat},${lon});
    node["natural"="tree"](around:${R_BLD},${lat},${lon});
  );out geom;`;
}

/** Ask the public Overpass mirrors in turn. They are often busy, so each gets a generous timeout. */
export async function queryOverpass(lat: number, lon: number, timeoutMs = 30000): Promise<{ elements?: El[] } | null> {
  const body = 'data=' + encodeURIComponent(overpassQuery(lat, lon));
  for (const ep of ENDPOINTS) {
    try {
      const ac = new AbortController(), to = setTimeout(() => ac.abort(), timeoutMs);
      const r = await fetch(ep, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ac.signal });
      clearTimeout(to);
      if (!r.ok) continue;
      const j = (await r.json()) as { elements?: El[] };
      if (j.elements?.length) return j;
    } catch { /* next mirror */ }
  }
  return null;
}

/** OSM data bundled with the app at deploy time (public/osm/<site>.json), if present. */
async function bundled(siteId: string): Promise<{ elements?: El[] } | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}osm/${siteId}.json`);
    if (!r.ok) return null;
    const j = (await r.json()) as { elements?: El[] };
    return j.elements?.length ? j : null;
  } catch { return null; }
}

export async function fetchOsm(siteId: string, lat: number, lon: number): Promise<OsmData | null> {
  try {
    const hit = localStorage.getItem(CACHE_V + siteId);
    if (hit) return JSON.parse(hit) as OsmData;
  } catch { /* storage unavailable */ }
  // Bundled data first (instant, no dependency on busy public servers), then the live mirrors.
  const j = (await bundled(siteId)) ?? (await queryOverpass(lat, lon));
  if (!j) return null;
  const xy = projector(lat, lon);
  const out: OsmData = { buildings: [], roads: [], green: [], water: [], trees: [] };
  for (const e of j.elements ?? []) {
    const t = e.tags ?? {};
    if (e.type === 'node') { if (e.lat !== undefined && e.lon !== undefined) out.trees.push(xy(e.lat, e.lon)); continue; }
    if (!e.geometry || e.geometry.length < 2) continue;
    const pts = e.geometry.map(g => xy(g.lat, g.lon));
    if (t.building) {
      if (pts.length < 4) continue;
      const { a, c } = polyStats(pts);
      if (Math.abs(a) < 12) continue;
      const area = Math.abs(a);
      out.buildings.push({ id: e.id, pts, area, c, h: Math.min(heightOf(t, area, e.id), 180), d: Math.hypot(c[0], c[1]), tag: t.building });
    } else if (t.highway) out.roads.push({ pts, kind: t.highway });
    else if (t.natural === 'water') out.water.push(pts);
    else out.green.push(pts);
  }
  try { localStorage.setItem(CACHE_V + siteId, JSON.stringify(out)); } catch { /* quota */ }
  return out;
}
