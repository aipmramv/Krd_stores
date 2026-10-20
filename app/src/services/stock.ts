// Store actions on stock lots, each recorded as a movement:
//   pick      take units out (issue to a lab, project or shipment), optionally against a reservation
//   put-away  planned receipts (a PO) and goods in inbound staging go to a bin; or a new receipt
//   count     a cycle count; a variance waits for the store manager before the stock is adjusted
//   reserve   hold units for a project until a date, and release them again
import { db } from '../db';
import type { Location, Movement, StockLot, User } from '../db/schema';
import { available, checkMove } from './moves';

const STORE = ['clerk', 'storeManager', 'admin'];
async function staff(userId: string, roles = STORE) {
  const u = await db.get('users', userId);
  if (!u) throw new Error('Unknown user');
  if (!roles.includes(u.role)) throw new Error('Only store staff can do this');
  return u;
}
async function lotOf(id: string) { const l = await db.get('stockLots', id); if (!l) throw new Error('Stock lot not found'); return l; }
const int = (n: number, what = 'quantity') => { if (!Number.isInteger(n) || n < 1) throw new Error(`Enter a ${what} of at least 1`); };
const log = (m: Omit<Movement, '_id' | 'createdAt' | 'updatedAt' | 'approvals'> & { approvals?: Movement['approvals'] }, prefix: string) =>
  db.insert('movements', { approvals: [], ...m }, prefix);

/** Units a pick may take: free units, or every unit when picking against a reservation. */
export async function pickable(lot: StockLot, againstReservation: boolean) {
  return againstReservation ? lot.qty - await movingOut(lot) : available(lot);
}
async function movingOut(lot: StockLot) {
  return (await db.find('movements', { lotId: lot._id, type: 'move', status: { $in: ['requested', 'approved'] } })).reduce((n, m) => n + m.qty, 0);
}

export async function pick(input: { lotId: string; qty: number; purpose: string; againstReservation: boolean }, userId: string) {
  const user = await staff(userId), lot = await lotOf(input.lotId);
  int(input.qty);
  const max = await pickable(lot, input.againstReservation);
  if (input.qty > max) throw new Error(`Only ${max} ${max === 1 ? 'unit' : 'units'} can be picked${input.againstReservation ? '' : ' (the rest is reserved or moving)'}`);
  const fromReserved = input.againstReservation ? Math.min(lot.reserved, input.qty) : 0;
  if (lot.qty - input.qty <= 0) await db.remove('stockLots', lot._id);
  else await db.update('stockLots', lot._id, { qty: lot.qty - input.qty, reserved: lot.reserved - fromReserved, status: lot.reserved - fromReserved > 0 ? lot.status : lot.status === 'Reserved' ? 'Available' : lot.status });
  return log({ site: lot.site, type: 'pick', partNo: lot.partNo, qty: input.qty, lotId: lot._id, from: lot.locationId, reason: input.purpose, status: 'done', requestedBy: user._id }, 'PK');
}

/** Open put-away tasks at a site: planned receipts and goods waiting in inbound staging. */
export const openPutaways = (site: string) => db.find('movements', { site, type: 'putaway', status: 'requested' }, { sort: { createdAt: 1 } });

async function fits(lot: Pick<StockLot, 'partNo' | 'site'> & { _id?: string; locationId?: string }, qty: number, dest: Location) {
  return checkMove({ site: lot.site, lotId: lot._id ?? '', to: dest._id, qty, reason: '' },
    { _id: lot._id ?? 'new', site: lot.site, partNo: lot.partNo, locationId: lot.locationId ?? 'staging', lot: '', qty, reserved: 0, status: 'Available', project: '', receivedAt: '' }, dest);
}

/** Complete a put-away task into a bin. Planned receipts (no lot yet) create the lot on arrival. */
export async function putAway(taskId: string, to: string, qty: number, userId: string) {
  const user = await staff(userId);
  const task = await db.get('movements', taskId);
  if (!task || task.type !== 'putaway' || task.status !== 'requested') throw new Error('Put-away task not found');
  int(qty);
  if (qty > task.qty) throw new Error(`The task is for ${task.qty}`);
  const dest = await db.get('locations', to);
  if (!dest) throw new Error('Choose the destination bin');
  if (task.lotId) {
    const lot = await lotOf(task.lotId);
    const err = await fits({ ...lot, _id: undefined }, qty, dest);
    if (err) throw new Error(err);
    const there = (await db.find('stockLots', { locationId: to, partNo: lot.partNo, lot: lot.lot }))[0];
    if (there) await db.update('stockLots', there._id, { qty: there.qty + qty });
    else if (qty === lot.qty) await db.update('stockLots', lot._id, { locationId: to });
    else await db.insert('stockLots', { site: lot.site, partNo: lot.partNo, locationId: to, lot: lot.lot, qty, reserved: 0, status: 'Available', project: lot.project, receivedAt: lot.receivedAt }, 'LOT');
    if (there || qty < lot.qty) { if (lot.qty - qty <= 0) await db.remove('stockLots', lot._id); else await db.update('stockLots', lot._id, { qty: lot.qty - qty }); }
  } else {
    const err = await fits({ site: task.site, partNo: task.partNo }, qty, dest);
    if (err) throw new Error(err);
    const part = await db.get('parts', task.partNo);
    await db.insert('stockLots', { site: task.site, partNo: task.partNo, locationId: to, lot: (task.ref ?? 'RCV').replace(/\W+/g, '').slice(-10), qty, reserved: 0, status: 'Available', project: part?.project ?? '—', receivedAt: new Date().toISOString() }, 'LOT');
  }
  const rest = task.qty - qty;
  await db.update('movements', task._id, { status: 'done', qty, to, reason: `${task.reason ?? 'Put-away'} · by ${user.name}` });
  if (rest > 0) await log({ site: task.site, type: 'putaway', partNo: task.partNo, qty: rest, lotId: task.lotId, from: task.from, ref: task.ref, reason: `${task.reason ?? 'Put-away'} · remainder`, status: 'requested', requestedBy: task.requestedBy }, 'PA');
  return db.get('movements', task._id);
}

/** A receipt without a task (e.g. a hand-carried delivery): straight into a bin. */
export async function receive(input: { site: string; partNo: string; qty: number; to: string; lot: string; ref: string }, userId: string) {
  const user = await staff(userId);
  int(input.qty);
  const dest = await db.get('locations', input.to);
  if (!dest) throw new Error('Choose the destination bin');
  const err = await fits({ site: input.site, partNo: input.partNo }, input.qty, dest);
  if (err) throw new Error(err);
  const part = await db.get('parts', input.partNo);
  if (!part) throw new Error('Unknown part');
  const lot = await db.insert('stockLots', { site: input.site, partNo: input.partNo, locationId: input.to, lot: input.lot || 'RCV', qty: input.qty, reserved: 0, status: 'Available', project: part.project, receivedAt: new Date().toISOString() }, 'LOT');
  return log({ site: input.site, type: 'putaway', partNo: input.partNo, qty: input.qty, lotId: lot._id, to: input.to, ref: input.ref, reason: 'Receipt without task', status: 'done', requestedBy: user._id }, 'PA');
}

/** Record a count for every lot in a bin. Matches post at once; variances go to the store manager. */
export async function count(entries: { lotId: string; counted: number }[], userId: string) {
  const user = await staff(userId);
  const out: Movement[] = [];
  for (const e of entries) {
    if (!Number.isInteger(e.counted) || e.counted < 0) throw new Error('Counts are whole numbers of 0 or more');
    const lot = await lotOf(e.lotId);
    const open = (await db.find('movements', { lotId: lot._id, type: 'count', status: 'requested' }))[0];
    if (open) await db.update('movements', open._id, { status: 'cancelled', reason: 'Superseded by a recount' });
    const variance = e.counted !== lot.qty;
    const self = user.role === 'storeManager' || user.role === 'admin';
    const m = await log({
      site: lot.site, type: 'count', partNo: lot.partNo, qty: lot.qty, counted: e.counted, lotId: lot._id, from: lot.locationId,
      reason: variance ? `Variance ${e.counted - lot.qty > 0 ? '+' : ''}${e.counted - lot.qty}` : 'Count matches', status: variance && !self ? 'requested' : 'done', requestedBy: user._id,
      approvals: variance ? [{ role: 'storeManager', decision: self ? 'approved' : 'pending', user: self ? user._id : undefined, at: self ? new Date().toISOString() : undefined }] : [],
    }, 'CC');
    if (variance && self) await adjust(lot, e.counted);
    out.push(m);
  }
  return out;
}

async function adjust(lot: StockLot, counted: number) {
  if (counted === 0) await db.remove('stockLots', lot._id);
  else await db.update('stockLots', lot._id, { qty: counted, reserved: Math.min(lot.reserved, counted) });
}

/** The store manager posts (adjusts stock) or rejects (asks for a recount) a count variance. */
export async function decideCount(id: string, decision: 'approved' | 'rejected', userId: string) {
  const user = await staff(userId, ['storeManager', 'admin']);
  const m = await db.get('movements', id);
  if (!m || m.type !== 'count' || m.status !== 'requested') throw new Error('Count variance not found');
  const at = new Date().toISOString();
  const approvals = m.approvals.map(a => (a.decision === 'pending' ? { ...a, decision, user: user._id, at } : a));
  if (decision === 'approved') {
    const lot = m.lotId ? await db.get('stockLots', m.lotId) : null;
    if (lot) await adjust(lot, m.counted ?? lot.qty);
  }
  return db.update('movements', id, { approvals, status: decision === 'approved' ? 'done' : 'rejected', reason: `${m.reason} · ${decision === 'approved' ? 'posted' : 'recount requested'}` });
}

export async function reserve(input: { lotId: string; qty: number; project: string; until: string }, userId: string) {
  const user = await staff(userId, [...STORE, 'logistics', 'engineer']);
  const lot = await lotOf(input.lotId);
  int(input.qty);
  const free = await available(lot);
  if (input.qty > free) throw new Error(`Only ${free} free to reserve`);
  if (!input.project.trim()) throw new Error('Enter the project');
  await db.update('stockLots', lot._id, { reserved: lot.reserved + input.qty, status: lot.reserved + input.qty >= lot.qty ? 'Reserved' : lot.status });
  return log({ site: lot.site, type: 'reserve', partNo: lot.partNo, qty: input.qty, lotId: lot._id, from: lot.locationId, ref: input.project.trim(), reason: `Reserved until ${input.until}`, status: 'done', requestedBy: user._id }, 'RS');
}

export async function release(lotId: string, qty: number, userId: string) {
  const user = await staff(userId, [...STORE, 'logistics', 'engineer']);
  const lot = await lotOf(lotId);
  int(qty);
  if (qty > lot.reserved) throw new Error(`Only ${lot.reserved} reserved in this lot`);
  await db.update('stockLots', lot._id, { reserved: lot.reserved - qty, status: lot.status === 'Reserved' ? 'Available' : lot.status });
  return log({ site: lot.site, type: 'reserve', partNo: lot.partNo, qty: -qty, lotId: lot._id, from: lot.locationId, reason: 'Reservation released', status: 'done', requestedBy: user._id }, 'RS');
}

export const isStoreStaff = (u: User | null) => !!u && STORE.includes(u.role);
