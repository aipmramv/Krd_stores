// What the store twin shows for the current site's electronics store: stock lots per bin, the
// parts they hold and the open move requests. Reloaded whenever that data changes, and re-derived
// when the timeline moves (replay or forecast), so the store shows stock as of that date.
import { db, onChange } from '../db';
import type { Alert, Camera, Location, Movement, Part, Shipment, StockLot, Tracker } from '../db/schema';
import { getState, subscribe } from '../state/store';
import { isOpen } from './moves';
import { asOfDate, stockAsOf } from './timeline';

export interface StoreView {
  site: string;
  /** Lots by bin code (A-05-04), as of the timeline date. */
  lots: Map<string, StockLot[]>;
  locs: Map<string, Location>;
  parts: Map<string, Part>;
  /** Open move requests that start or end in this store. */
  moves: Movement[];
  /** Count variances waiting for the store manager, and put-away tasks waiting at the site. */
  counts: Movement[];
  putaways: Movement[];
  /** Timeline offset in days the lots were derived for (0 = live). */
  t: number;
  /** Movements at each bin over the last 30 days (activity heatmap). */
  activity: Map<string, number>;
  /** Areas of the site (quarantine, hazmat, staging…) by code. */
  areas: Map<string, Location>;
  /** All movements of the site (task board, bin timelines, flows). */
  movements: Movement[];
  /** Cameras and tracker tags in this store, and open alerts raised by the rules engine. */
  cameras: Camera[]; trackers: Tracker[]; alerts: Alert[];
}

interface Raw { site: string; lots: StockLot[]; movements: Movement[]; shipments: Shipment[]; locs: Location[]; parts: Part[]; cameras: Camera[]; trackers: Tracker[]; alerts: Alert[] }
let raw: Raw | null = null;
let view: StoreView | null = null;
let req = 0;
const subs = new Set<(v: StoreView) => void>();
export const getStoreView = () => view;
export const onStoreView = (f: (v: StoreView) => void) => { subs.add(f); return () => { subs.delete(f); }; };

const code = (locationId: string) => locationId.split(':')[1];

function activityOf(movements: Movement[]) {
  const since = Date.now() - 30 * 86400000, m = new Map<string, number>();
  for (const mv of movements) {
    if (mv.status !== 'done' || Date.parse(mv.updatedAt ?? '') < since) continue;
    for (const loc of [mv.from, mv.to]) if (loc) { const c = code(loc); m.set(c, (m.get(c) ?? 0) + 1); }
  }
  return m;
}

function derive(r: Raw, t: number): StoreView {
  const lots = t === 0 ? r.lots : stockAsOf(r.lots, r.movements, r.shipments, asOfDate(t).getTime());
  const byCode = new Map<string, StockLot[]>();
  for (const l of lots) { const c = code(l.locationId); byCode.set(c, [...(byCode.get(c) ?? []), l]); }
  const open = (type: Movement['type'], st: Movement['status'][]) => r.movements.filter(m => m.type === type && st.includes(m.status));
  return {
    site: r.site, lots: byCode, locs: new Map(r.locs.filter(l => l.store === 'electronics').map(l => [l.code, l])), parts: new Map(r.parts.map(p => [p._id, p])),
    moves: open('move', ['requested', 'approved']).filter(isOpen), counts: open('count', ['requested']),
    putaways: open('putaway', ['requested']).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')), t,
    activity: activityOf(r.movements), areas: new Map(r.locs.filter(l => l.store !== 'electronics').map(l => [l.code, l])), movements: r.movements,
    cameras: r.cameras, trackers: r.trackers, alerts: r.alerts,
  };
}

/** Load (or reload) a site's store; only the latest request is published. */
export async function loadStoreView(site: string, force = false): Promise<StoreView> {
  if (view?.site === site && !force) return view;
  const n = ++req;
  const [locs, lots, parts, movements, shipments, cameras, trackers, alerts] = await Promise.all([
    db.find('locations', { site }), db.find('stockLots', { site }), db.find('parts'),
    db.find('movements', { site }), db.find('shipments', { $or: [{ from: site }, { to: site }] }),
    db.find('cameras', { site }), raw?.site === site ? Promise.resolve(raw.trackers) : db.find('trackers', { site }),
    db.find('alerts', { site, status: { $in: ['open', 'ack'] }, eventId: { $exists: true } }, { sort: { at: -1 } }),
  ]);
  if (n !== req) return view!;
  raw = { site, lots, movements, shipments, locs, parts, cameras, trackers, alerts };
  view = derive(raw, getState().t);
  subs.forEach(f => f(view!));
  return view;
}

onChange(c => {
  // Tracker readings are not reloaded: positions come from services/live.ts.
  if (view && ['stockLots', 'movements', 'parts', 'locations', 'shipments', 'cameras', 'alerts'].includes(c)) void loadStoreView(view.site, true);
});

// Moving the timeline re-derives the stock without reloading.
let lastT = getState().t;
subscribe(() => {
  const t = getState().t;
  if (t === lastT) return;
  lastT = t;
  if (raw) { view = derive(raw, t); subs.forEach(f => f(view!)); }
});

/** Lots in one bin as of the timeline, for the drawer (null until the store is loaded). */
export const lotsAt = (binCode: string) => view?.lots.get(binCode) ?? null;
