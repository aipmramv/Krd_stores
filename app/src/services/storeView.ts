// What the store twin shows for the current site's electronics store: stock lots per bin, the
// parts they hold and the open move requests. Reloaded whenever that data changes.
import { db, onChange } from '../db';
import type { Location, Movement, Part, StockLot } from '../db/schema';
import { isOpen } from './moves';

export interface StoreView {
  site: string;
  /** Lots by bin code (A-05-04). */
  lots: Map<string, StockLot[]>;
  locs: Map<string, Location>;
  parts: Map<string, Part>;
  /** Open move requests that start or end in this store. */
  moves: Movement[];
}

let view: StoreView | null = null;
let req = 0;
const subs = new Set<(v: StoreView) => void>();
export const getStoreView = () => view;
export const onStoreView = (f: (v: StoreView) => void) => { subs.add(f); return () => { subs.delete(f); }; };

const code = (locationId: string) => locationId.split(':')[1];

/** Load (or reload) a site's store; only the latest request is published. */
export async function loadStoreView(site: string, force = false): Promise<StoreView> {
  if (view?.site === site && !force) return view;
  const n = ++req;
  const [locs, lots, parts, moves] = await Promise.all([
    db.find('locations', { site, store: 'electronics' }),
    db.find('stockLots', { site }),
    db.find('parts'),
    db.find('movements', { site, type: 'move', status: { $in: ['requested', 'approved'] } }),
  ]);
  const byCode = new Map<string, StockLot[]>();
  for (const l of lots) { const c = code(l.locationId); byCode.set(c, [...(byCode.get(c) ?? []), l]); }
  const v: StoreView = { site, lots: byCode, locs: new Map(locs.map(l => [l.code, l])), parts: new Map(parts.map(p => [p._id, p])), moves: moves.filter(isOpen) };
  if (n === req) { view = v; subs.forEach(f => f(v)); }
  return v;
}

onChange(c => {
  if (view && (c === 'stockLots' || c === 'movements' || c === 'parts' || c === 'locations')) {
    void loadStoreView(view.site, true);
  }
});
