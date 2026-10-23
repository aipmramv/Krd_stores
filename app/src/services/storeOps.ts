// Store-floor logic for the store twin, kept free of three.js so it is tested on its own:
// aisle routing, whether stock fits a bin (for the drag preview), nearest free bins for group
// moves, and the walking order of a pick list.
import { BAYS, binId, LEVELS, ROWS } from '../data/storeModel';
import type { Bin } from '../data/types';
import type { Location, Part, StockLot } from '../db/schema';

// Store floor plan in metres (matches three/store3d.ts): rack rows along x, aisles along x between
// rows, cross aisles at both ends, the entrance at inbound staging.
export const BAY = 2.7, ROWZ = [-9, -3, 3, 9], X0 = -16.2;
/** Aisle each rack row is picked from (row A from the front aisle, D from the back, B and C share the middle). */
const ACCESS_Z = [-12, 0, 0, 12];
const CROSS_X = [X0 - 2.3, X0 + BAYS * BAY + 2.3];
export const ENTRANCE: P = [-17, 13.5];
/** Floor areas of the store (centres, metres), matching three/store3d.ts. */
export const AREA_XZ: Record<string, P> = { 'Quarantine Q-01': [19.5, -9], 'Hazmat H-01': [19.5, 4], 'Inbound staging': [-1.5, 13.5] };
export type P = [number, number];

export const binX = (b: Bin) => X0 + b.i * BAY + BAY / 2;
/** Where a picker stands to reach a bin. */
export const accessPoint = (b: Bin): P => [binX(b), ACCESS_Z[b.r]];

/** Walking route between two floor points along the aisles (points to draw, metres walked). */
export function route(a: P, b: P): { pts: P[]; len: number } {
  if (Math.abs(a[1] - b[1]) < .01) return { pts: [a, b], len: Math.abs(a[0] - b[0]) };
  // Different aisles: go round whichever end of the racks is shorter.
  const via = CROSS_X.map(x => ({ x, len: Math.abs(a[0] - x) + Math.abs(a[1] - b[1]) + Math.abs(b[0] - x) }))
    .sort((p, q) => p.len - q.len)[0];
  return { pts: [a, [via.x, a[1]], [via.x, b[1]], b], len: via.len };
}

/** Visit order for a pick list: nearest-neighbour from the entrance, then a 2-opt pass. */
export function pickOrder(bins: Bin[], start: P = ENTRANCE): { order: Bin[]; pts: P[]; len: number } {
  const left = [...bins], order: Bin[] = [];
  let at = start;
  while (left.length) {
    let bi = 0, best = Infinity;
    left.forEach((b, i) => { const d = route(at, accessPoint(b)).len; if (d < best) { best = d; bi = i; } });
    order.push(left[bi]); at = accessPoint(left[bi]); left.splice(bi, 1);
  }
  const total = (o: Bin[]) => o.reduce((n, b, i) => n + route(i ? accessPoint(o[i - 1]) : start, accessPoint(b)).len, 0);
  for (let improved = true; improved;) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
      const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
      if (total(cand) + 1e-6 < total(order)) { order.splice(0, order.length, ...cand); improved = true; }
    }
  }
  const pts: P[] = [start];
  let len = 0, prev = start;
  for (const b of order) { const r = route(prev, accessPoint(b)); pts.push(...r.pts.slice(1)); len += r.len; prev = accessPoint(b); }
  return { order, pts, len };
}

export type Fit = 'ok' | 'partial' | 'no';
export interface FitResult { fit: Fit; free: number; reason: string }

/** Whether `qty` units of the given parts fit a destination: capacity, zone and hazmat rules. */
export function fitFor(dest: Location | undefined, used: number, incoming: number, parts: Part[], qty: number): FitResult {
  if (!dest) return { fit: 'no', free: 0, reason: 'Not a storage location' };
  const free = Math.max(0, dest.capacity - used - incoming);
  const hazmat = parts.some(p => /UN\d|Flammable/.test(p.hazard)), esd = parts.some(p => p.hazard === 'ESD');
  if (hazmat && dest.zone !== 'Hazmat') return { fit: 'no', free, reason: 'Hazmat must stay in a hazmat area' };
  if (!hazmat && dest.zone === 'Hazmat') return { fit: 'no', free, reason: 'Hazmat area is for dangerous goods only' };
  if (esd && !['ESD', 'Lab', 'Test', 'Quarantine'].includes(dest.zone)) return { fit: 'no', free, reason: 'ESD parts need an ESD zone' };
  if (!free) return { fit: 'no', free, reason: `${dest.code} is full` };
  if (free < qty) return { fit: 'partial', free, reason: `Room for ${free} of ${qty}` };
  return { fit: 'ok', free, reason: `Room for ${free}` };
}

/** Free bins nearest a target (by walking distance from the target's aisle point), for group moves. */
export function nearestFree(target: Bin, need: { code: string; qty: number }[], locs: Map<string, Location>, used: Map<string, number>, exclude: Set<string>): Map<string, string> {
  const all: Bin[] = [];
  for (let r = 0; r < ROWS.length; r++) for (let i = 0; i < BAYS; i++) for (let k = 0; k < LEVELS; k++) all.push({ r, i, k });
  const at = accessPoint(target);
  const ranked = all.filter(b => !exclude.has(binId(b)))
    .map(b => ({ b, d: route(at, accessPoint(b)).len + Math.abs(b.k - target.k) * .5 + (binId(b) === binId(target) ? -1 : 0) }))
    .sort((p, q) => p.d - q.d);
  const room = new Map<string, number>();
  const out = new Map<string, string>();
  for (const n of need) {
    for (const { b } of ranked) {
      const code = binId(b), loc = locs.get(code);
      if (!loc) continue;
      const free = room.get(code) ?? loc.capacity - (used.get(code) ?? 0);
      if (free >= n.qty) { out.set(n.code, code); room.set(code, free - n.qty); break; }
    }
  }
  return out;
}

export const sumQty = (lots: StockLot[]) => lots.reduce((n, l) => n + l.qty, 0);
export const freeQty = (lots: StockLot[]) => lots.reduce((n, l) => n + l.qty - l.reserved, 0);
