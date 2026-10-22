// The four standard reports, computed from the data store (pure functions, so they are tested).
import type { Location, Part, ScrapCase, Shipment, StockLot } from '../db/schema';

export interface ProjectRow { project: string; qty: number; value: number; lots: number; parts: number }
export function stockByProject(lots: StockLot[], parts: Map<string, Part>): ProjectRow[] {
  const m = new Map<string, ProjectRow & { pset: Set<string> }>();
  for (const l of lots) {
    const k = l.project || 'Unassigned';
    const r = m.get(k) ?? { project: k, qty: 0, value: 0, lots: 0, parts: 0, pset: new Set<string>() };
    r.qty += l.qty; r.value += l.qty * (parts.get(l.partNo)?.unitCost ?? 0); r.lots++; r.pset.add(l.partNo);
    m.set(k, r);
  }
  return [...m.values()].map(({ pset, ...r }) => ({ ...r, parts: pset.size })).sort((a, b) => b.value - a.value);
}

export interface SpaceRow { key: string; bins: number; capacity: number; used: number; empty: number; nearFull: number }
/** Utilisation of bins grouped by site (or by rack row within one site). */
export function spaceUtilisation(locs: Location[], lots: StockLot[], by: 'site' | 'rack'): SpaceRow[] {
  const used = new Map<string, number>();
  for (const l of lots) used.set(l.locationId, (used.get(l.locationId) ?? 0) + l.qty);
  const m = new Map<string, SpaceRow>();
  for (const b of locs.filter(x => x.store === 'electronics')) {
    const k = by === 'site' ? b.site : `Rack ${'ABCD'[b.rack ?? 0]}`;
    const r = m.get(k) ?? { key: k, bins: 0, capacity: 0, used: 0, empty: 0, nearFull: 0 };
    const u = used.get(b._id) ?? 0;
    r.bins++; r.capacity += b.capacity; r.used += Math.min(u, b.capacity);
    if (!u) r.empty++;
    if (u / b.capacity > .92) r.nearFull++;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface SlaRow { carrier: string; shipments: number; delivered: number; onTime: number; late: number; overdue: number; exceptions: number; onTimePct: number | null }
/** On time = delivered no later than the booked ETA; overdue = not delivered and past ETA. */
export function shipmentSla(list: Shipment[], now = Date.now()): SlaRow[] {
  const m = new Map<string, SlaRow>();
  for (const s of list.filter(x => x.status !== 'Cancelled')) {
    const r = m.get(s.carrier) ?? { carrier: s.carrier, shipments: 0, delivered: 0, onTime: 0, late: 0, overdue: 0, exceptions: 0, onTimePct: null };
    r.shipments++;
    const eta = s.etaAt ? Date.parse(s.etaAt) : null;
    const done = s.milestones.at(-1);
    if (s.status === 'Delivered') {
      r.delivered++;
      if (eta === null || !done?.at || Date.parse(done.at) <= eta) r.onTime++; else r.late++;
    } else if (eta !== null && now > eta) r.overdue++;
    if (s.status === 'E-way bill hold' || s.status === 'Delay risk' || (s.claims?.length ?? 0) > 0) r.exceptions++;
    m.set(s.carrier, r);
  }
  return [...m.values()].map(r => ({ ...r, onTimePct: r.delivered ? Math.round(r.onTime / r.delivered * 100) : null })).sort((a, b) => b.shipments - a.shipments);
}

export interface ScrapRow { reason: string; cases: number; units: number; writtenOff: number; open: number; rejected: number }
export function scrapWriteOff(cases: ScrapCase[]): ScrapRow[] {
  const m = new Map<string, ScrapRow>();
  for (const c of cases) {
    const k = c.reason || 'Reason not given yet';
    const r = m.get(k) ?? { reason: k, cases: 0, units: 0, writtenOff: 0, open: 0, rejected: 0 };
    r.cases++; r.units += c.qty;
    if (c.outcome === 'written-off') r.writtenOff += c.value;
    else if (c.outcome) r.rejected += c.value;
    else r.open += c.value;
    m.set(k, r);
  }
  return [...m.values()].sort((a, b) => b.writtenOff + b.open - (a.writtenOff + a.open));
}
