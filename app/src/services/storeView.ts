// What the store twin shows for the current site's electronics store: stock lots per bin, the
// parts they hold and the open move requests. Reloaded whenever that data changes, and re-derived
// when the timeline moves (replay or forecast), so the store shows stock as of that date.
import { db, onChange } from '../db';
import type { Location, Movement, Part, Shipment, StockLot } from '../db/schema';
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
}

interface Raw { site: string; lots: StockLot[]; movements: Movement[]; shipments: Shipment[]; locs: Location[]; parts: Part[] }
let raw: Raw | null = null;
let view: StoreView | null = null;
let req = 0;
const subs = new Set<(v: StoreView) => void>();
export const getStoreView = () => view;
export const onStoreView = (f: (v: StoreView) => void) => { subs.add(f); return () => { subs.delete(f); }; };

const code = (locationId: string) => locationId.split(':')[1];

function derive(r: Raw, t: number): StoreView {
  const lots = t === 0 ? r.lots : stockAsOf(r.lots, r.movements, r.shipments, asOfDate(t).getTime());
  const byCode = new Map<string, StockLot[]>();
  for (const l of lots) { const c = code(l.locationId); byCode.set(c, [...(byCode.get(c) ?? []), l]); }
  const open = (type: Movement['type'], st: Movement['status'][]) => r.movements.filter(m => m.type === type && st.includes(m.status));
  return {
    site: r.site, lots: byCode, locs: new Map(r.locs.filter(l => l.store === 'electronics').map(l => [l.code, l])), parts: new Map(r.parts.map(p => [p._id, p])),
    moves: open('move', ['requested', 'approved']).filter(isOpen), counts: open('count', ['requested']),
    putaways: open('putaway', ['requested']).sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')), t,
  };
}

/** Load (or reload) a site's store; only the latest request is published. */
export async function loadStoreView(site: string, force = false): Promise<StoreView> {
  if (view?.site === site && !force) return view;
  const n = ++req;
  const [locs, lots, parts, movements, shipments] = await Promise.all([
    db.find('locations', { site }), db.find('stockLots', { site }), db.find('parts'),
    db.find('movements', { site }), db.find('shipments', { $or: [{ from: site }, { to: site }] }),
  ]);
  if (n !== req) return view!;
  raw = { site, lots, movements, shipments, locs, parts };
  view = derive(raw, getState().t);
  subs.forEach(f => f(view!));
  return view;
}

onChange(c => {
  if (view && ['stockLots', 'movements', 'parts', 'locations', 'shipments'].includes(c)) void loadStoreView(view.site, true);
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
