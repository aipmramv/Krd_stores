// The timeline: stock and shipments as they were (replay) or are expected to be (forecast) on a
// date. Pure functions over the documents, so every view (store twin, bin drawer, map, tracker)
// shows the same picture.
//   replay   later actions are undone: picks come back, put-aways and moves are reversed, count
//            adjustments restored, shipments picked up later return to stock; lots received
//            later are hidden
//   forecast planned receipts land on their due date, inbound shipments arrive in staging at
//            their ETA, booked outbound shipments leave at pick-up, approved moves are made,
//            reservations end on their date
import type { Movement, Shipment, StockLot } from '../db/schema';

const DAY = 86400000;
/** The moment the timeline shows: now shifted by whole days. */
export const asOfDate = (t: number, now = Date.now()) => new Date(now + t * DAY);

const ts = (iso?: string) => (iso ? Date.parse(iso) : 0);

function add(lots: StockLot[], lotLike: Partial<StockLot> & Pick<StockLot, 'site' | 'partNo' | 'locationId'>, qty: number, tag: string) {
  const at = lots.find(l => l.locationId === lotLike.locationId && l.partNo === lotLike.partNo && (!lotLike.lot || l.lot === lotLike.lot));
  if (at) { at.qty += qty; return; }
  if (qty <= 0) return;
  lots.push({ _id: `${tag}:${lotLike.locationId}:${lotLike.partNo}`, lot: lotLike.lot ?? tag, reserved: 0, status: 'Available', project: lotLike.project ?? '—', receivedAt: new Date(0).toISOString(), ...lotLike, qty } as StockLot);
}
function take(lots: StockLot[], locationId: string, partNo: string, qty: number) {
  for (const l of lots.filter(x => x.locationId === locationId && x.partNo === partNo)) {
    const n = Math.min(l.qty, qty);
    l.qty -= n; qty -= n;
    if (!qty) break;
  }
}

/**
 * Stock lots as of `asOf`. `movements` and `shipments` are everything touching the site; lots are
 * copies, never the stored documents.
 */
export function stockAsOf(current: StockLot[], movements: Movement[], shipments: Shipment[], asOf: number, now = Date.now()): StockLot[] {
  const lots = current.map(l => ({ ...l }));
  if (Math.abs(asOf - now) < 60000) return lots;
  if (asOf < now) {
    // Undo, newest first, everything that happened after asOf.
    const later = movements.filter(m => m.status === 'done' && ts(m.updatedAt) > asOf).sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt));
    for (const m of later) {
      const lot = m.lotId ? lots.find(l => l._id === m.lotId) : undefined;
      if (m.type === 'pick' && m.from) add(lots, lot ?? { site: m.site, partNo: m.partNo, locationId: m.from }, m.qty, 'replay');
      else if (m.type === 'putaway' && m.to) take(lots, m.to, m.partNo, m.qty);
      else if (m.type === 'move' && m.from && m.to) { take(lots, m.to, m.partNo, m.qty); add(lots, { site: m.site, partNo: m.partNo, locationId: m.from, lot: lot?.lot }, m.qty, 'replay'); }
      else if (m.type === 'count' && m.counted !== undefined && lot) lot.qty += m.qty - m.counted;
      else if (m.type === 'reserve' && lot) lot.reserved = Math.max(0, lot.reserved - m.qty);
    }
    for (const s of shipments) {
      const picked = s.milestones.find(x => x.label === 'Picked up');
      if (picked?.done && ts(picked.at) > asOf) for (const a of s.alloc ?? []) add(lots, lots.find(l => l._id === a.lotId) ?? { site: s.from, partNo: a.partNo, locationId: `${s.from}:Inbound staging` }, a.qty, 'replay');
    }
    return lots.filter(l => ts(l.receivedAt) <= asOf && l.qty > 0);
  }
  // Forecast.
  for (const m of movements) {
    if (m.type === 'putaway' && m.status === 'requested' && !m.lotId && m.due && ts(m.due) <= asOf) add(lots, { site: m.site, partNo: m.partNo, locationId: m.to ?? `${m.site}:Inbound staging`, lot: m.ref?.replace(/\W+/g, '').slice(-10) }, m.qty, 'forecast');
    if (m.type === 'move' && m.status === 'approved' && m.from && m.to) { take(lots, m.from, m.partNo, m.qty); add(lots, { site: m.site, partNo: m.partNo, locationId: m.to }, m.qty, 'forecast'); }
    if (m.type === 'reserve' && m.status === 'done' && m.qty > 0) {
      const until = /until (\d{4}-\d{2}-\d{2})/.exec(m.reason ?? '')?.[1];
      const lot = lots.find(l => l._id === m.lotId);
      if (until && lot && Date.parse(until) <= asOf) lot.reserved = Math.max(0, lot.reserved - m.qty);
    }
  }
  for (const s of shipments) {
    if (['Delivered', 'Cancelled'].includes(s.status)) continue;
    const picked = s.milestones.find(x => x.label === 'Picked up')?.done;
    if (!picked && s.pickupAt && ts(s.pickupAt) <= asOf) for (const a of s.alloc ?? []) {
      const l = lots.find(x => x._id === a.lotId);
      if (l) { l.qty -= a.qty; l.reserved = Math.max(0, l.reserved - a.qty); }
    }
    const site = current[0]?.site;
    if (s.to === site && s.etaAt && ts(s.etaAt) <= asOf) for (const it of s.items) add(lots, { site: s.to, partNo: it.partNo, locationId: `${s.to}:Inbound staging` }, it.qty, 'forecast');
  }
  return lots.filter(l => l.qty > 0);
}

/** A shipment's status and milestones as of a date (replay hides later milestones; forecast projects ETAs). */
export function shipmentAsOf(s: Shipment, asOf: number, now = Date.now()): (Shipment & { projected?: boolean }) | null {
  if (Math.abs(asOf - now) < 60000) return s;
  if (asOf < now) {
    if (ts(s.createdAt) > asOf && s.ref) return null; // booked later in the app
    const milestones = s.milestones.map(m => (m.done && ts(m.at) > asOf ? { ...m, done: false } : m));
    const last = [...milestones].reverse().find(m => m.done);
    const status = s.status === 'E-way bill hold' || s.status === 'Delay risk' ? s.status : last?.label ?? 'Booked';
    return { ...s, milestones, status };
  }
  // Held shipments stay held until someone clears the hold; the forecast does not assume it.
  if (['Delivered', 'Cancelled', 'E-way bill hold', 'Awaiting EHS approval'].includes(s.status)) return s;
  if (s.etaAt && ts(s.etaAt) <= asOf) return { ...s, status: 'Delivered', projected: true, milestones: s.milestones.map(m => ({ ...m, done: true })) };
  if (s.pickupAt && ts(s.pickupAt) <= asOf && s.status === 'Booked') return { ...s, status: 'In transit', projected: true, milestones: s.milestones.map((m, i) => (i <= 2 ? { ...m, done: true } : m)) };
  return s;
}
