// Move requests: a store-to-store relocation of part of a stock lot.
//   requested → (approval chain from approvalRules 'move') → approved → done (moved on the floor)
//                                                          ↘ rejected     ↘ cancelled by the requester
// Requesters who hold every approval role in the chain (a store manager moving stock) are
// approved straight away. The stock only moves when the move is confirmed as done.
import { db } from '../db';
import type { Approval, Location, Movement, Role, StockLot, User } from '../db/schema';

export interface MoveInput { site: string; lotId: string; to: string; qty: number; reason: string }

const OPEN: Movement['status'][] = ['requested', 'approved'];
export const isOpen = (m: Movement) => OPEN.includes(m.status);

async function me(userId: string) {
  const u = await db.get('users', userId);
  if (!u) throw new Error('Unknown user');
  return u;
}

async function chain(): Promise<Role[]> {
  const rule = (await db.find('approvalRules', { kind: 'move' }, { sort: { minValue: -1 }, limit: 1 }))[0];
  return rule?.chain ?? ['storeManager'];
}

/** Units of a lot that are free to move: on hand less reserved less already in open moves. */
export async function available(lot: StockLot) {
  const pending = await db.find('movements', { lotId: lot._id, status: { $in: OPEN } });
  return lot.qty - lot.reserved - pending.reduce((n, m) => n + m.qty, 0);
}

/** Why a move can't be made, or null when it can. */
export async function checkMove(input: MoveInput, lot: StockLot | null, dest: Location | null): Promise<string | null> {
  if (!lot) return 'Choose the stock to move';
  if (!dest) return 'Choose the destination bin';
  if (dest._id === lot.locationId) return 'The destination is the bin the stock is already in';
  if (dest.site !== input.site) return 'Moves between sites are transfers and need a shipment';
  if (!Number.isInteger(input.qty) || input.qty < 1) return 'Enter a quantity of at least 1';
  const free = await available(lot);
  if (input.qty > free) return `Only ${free} ${free === 1 ? 'unit is' : 'units are'} free to move (the rest is reserved or already moving)`;
  const part = await db.get('parts', lot.partNo);
  if (part && /UN\d|Flammable/.test(part.hazard) && dest.zone !== 'Hazmat') return `${part.description} is hazmat and must stay in a hazmat area`;
  if (part?.hazard === 'ESD' && !['ESD', 'Lab', 'Test', 'Quarantine'].includes(dest.zone)) return `${part.description} is ESD sensitive; choose a bin in the ESD protected area`;
  const there = await db.find('stockLots', { locationId: dest._id });
  const incoming = await db.find('movements', { to: dest._id, status: { $in: OPEN } });
  const used = there.reduce((n, l) => n + l.qty, 0) + incoming.reduce((n, m) => n + m.qty, 0);
  if (used + input.qty > dest.capacity) return `${dest.code} has room for ${Math.max(0, dest.capacity - used)} more`;
  return null;
}

export async function requestMove(input: MoveInput, userId: string): Promise<Movement> {
  const [lot, dest, user] = await Promise.all([db.get('stockLots', input.lotId), db.get('locations', input.to), me(userId)]);
  const err = await checkMove(input, lot, dest);
  if (err) throw new Error(err);
  const roles = await chain();
  const now = new Date().toISOString();
  // A requester who holds every role in the chain approves their own request.
  const self = roles.every(r => r === user.role);
  const approvals: Approval[] = roles.map(role => (self ? { role, user: user._id, decision: 'approved', at: now, note: 'Requested by approver' } : { role, decision: 'pending' }));
  return db.insert('movements', {
    site: input.site, type: 'move', partNo: lot!.partNo, qty: input.qty, lotId: lot!._id, from: lot!.locationId, to: dest!._id,
    reason: input.reason, status: self ? 'approved' : 'requested', requestedBy: user._id, approvals,
  }, 'MR');
}

/** The approval this user can give next, if any. */
export function nextApproval(m: Movement, user: User | null): Approval | null {
  if (!user || m.status !== 'requested') return null;
  const next = m.approvals.find(a => a.decision === 'pending');
  return next && (next.role === user.role || user.role === 'admin') ? next : null;
}

export async function decide(id: string, decision: 'approved' | 'rejected', userId: string, note?: string) {
  const [m, user] = await Promise.all([db.get('movements', id), me(userId)]);
  if (!m) throw new Error('Move request not found');
  const next = nextApproval(m, user);
  if (!next) throw new Error(`Waiting for ${m.approvals.find(a => a.decision === 'pending')?.role ?? 'nobody'}, not ${user.role}`);
  const approvals = m.approvals.map(a => (a === next ? { ...a, user: user._id, decision, at: new Date().toISOString(), note } : a));
  const status = decision === 'rejected' ? 'rejected' : approvals.every(a => a.decision === 'approved') ? 'approved' : 'requested';
  return db.update('movements', id, { approvals, status });
}

/** Who may confirm the physical move: store staff. */
export const canExecute = (m: Movement, user: User | null) => !!user && m.status === 'approved' && ['clerk', 'storeManager', 'admin'].includes(user.role);
export const canCancel = (m: Movement, user: User | null) => !!user && isOpen(m) && (m.requestedBy === user._id || user.role === 'storeManager' || user.role === 'admin');

/** Confirm the move happened: the stock leaves the source lot and lands in the destination bin. */
export async function complete(id: string, userId: string) {
  const [m, user] = await Promise.all([db.get('movements', id), me(userId)]);
  if (!m || !m.lotId || !m.to) throw new Error('Move request not found');
  if (!canExecute(m, user)) throw new Error('Only approved moves can be confirmed, by store staff');
  const lot = await db.get('stockLots', m.lotId);
  if (!lot || lot.qty - lot.reserved < m.qty) throw new Error('The source bin no longer holds enough stock');
  const there = (await db.find('stockLots', { locationId: m.to, partNo: lot.partNo, lot: lot.lot }))[0];
  if (there) await db.update('stockLots', there._id, { qty: there.qty + m.qty });
  else if (m.qty === lot.qty) await db.update('stockLots', lot._id, { locationId: m.to });
  else await db.insert('stockLots', { ...strip(lot), locationId: m.to, qty: m.qty, reserved: 0, status: 'Available' }, 'LOT');
  if (there || m.qty < lot.qty) {
    if (lot.qty - m.qty <= 0) await db.remove('stockLots', lot._id);
    else await db.update('stockLots', lot._id, { qty: lot.qty - m.qty });
  }
  return db.update('movements', id, { status: 'done' });
}

export async function cancel(id: string, userId: string) {
  const [m, user] = await Promise.all([db.get('movements', id), me(userId)]);
  if (!m || !canCancel(m, user)) throw new Error('This move request cannot be cancelled by you');
  return db.update('movements', id, { status: 'cancelled' });
}

function strip(l: StockLot) {
  const { _id, createdAt, updatedAt, ...rest } = l;
  void _id; void createdAt; void updatedAt;
  return rest;
}
