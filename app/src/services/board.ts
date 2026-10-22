// The live task board: store-floor work (moves, put-aways, counts, issues) in lanes
//   approval  waiting for the store manager
//   todo      approved (or a put-away that needs no approval), nobody on it yet
//   doing     someone started it on the floor
//   done      finished today
// with an SLA clock per kind of work. Dragging a card to another lane runs the matching step;
// `dropError` says why a drop is not allowed, so the board can show it while dragging.
import { db } from '../db';
import type { Movement, MovementType, User } from '../db/schema';
import * as moves from './moves';
import * as stock from './stock';

export type Lane = 'approval' | 'todo' | 'doing' | 'done';
export const LANES: [Lane, string][] = [['approval', 'Awaiting approval'], ['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done today']];

/** Hours from when the work could start to when it should be finished. */
export const SLA_H: Record<MovementType, number> = { move: 4, putaway: 8, count: 24, issue: 24, transfer: 48, pick: 2, reserve: 24 };
const BOARD_TYPES: MovementType[] = ['move', 'putaway', 'count', 'issue', 'transfer'];
const STAFF = ['clerk', 'storeManager', 'admin'];
const ts = (iso?: string | null) => (iso ? Date.parse(iso) : 0);

const startOfDayIst = (now: number) => { const ist = now + 5.5 * 3600000; return ist - (ist % 86400000) - 5.5 * 3600000; };

export function laneOf(m: Movement, now = Date.now()): Lane | null {
  if (!BOARD_TYPES.includes(m.type)) return null;
  if (m.status === 'done') return ts(m.updatedAt) >= startOfDayIst(now) ? 'done' : null;
  if (m.status === 'requested') return m.type === 'putaway' ? (m.startedAt ? 'doing' : 'todo') : 'approval';
  if (m.status === 'approved') return m.startedAt ? 'doing' : 'todo';
  return null;
}

export interface Sla { due: number; left: number; state: 'ok' | 'soon' | 'late' | 'met' | 'missed' | 'planned' }
/** The SLA clock starts when the work can start: when it was raised, or when planned stock arrives. */
export function slaOf(m: Movement, now = Date.now()): Sla {
  const start = Math.max(ts(m.createdAt), ts(m.due)), span = SLA_H[m.type] * 3600000, due = start + span;
  if (m.status === 'done') return { due, left: due - ts(m.updatedAt), state: ts(m.updatedAt) <= due ? 'met' : 'missed' };
  if (start > now) return { due, left: start - now, state: 'planned' };
  const left = due - now;
  return { due, left, state: left < 0 ? 'late' : left < span / 4 ? 'soon' : 'ok' };
}

/** 1 h 05 m, 35 m, 2 d 3 h. */
export function span(ms: number) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return `${m} m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`;
}

const isStaff = (u: User | null) => !!u && STAFF.includes(u.role);

/** Why this card cannot go to that lane for this user, or null if it can. */
export function dropError(m: Movement, to: Lane, user: User | null, now = Date.now()): string | null {
  const from = laneOf(m, now);
  if (!from || from === to) return from ? null : 'This task is closed';
  if (from === 'done') return 'Done tasks are closed';
  if (to === 'approval') return 'Approved work cannot go back for approval';
  if (from === 'approval') {
    if (m.type === 'count') return to === 'done' ? (user && ['storeManager', 'admin'].includes(user.role) ? null : 'Only the store manager posts count variances') : 'Drop a count variance on Done to post it';
    if (to !== 'todo') return 'Approve it first: drop it on To do';
    return moves.nextApproval(m, user) ? null : `Waiting for the ${m.approvals.find(a => a.decision === 'pending')?.role === 'storeManager' ? 'store manager' : 'next approver'}`;
  }
  if (!isStaff(user)) return 'Only store staff do floor work';
  if (to === 'doing' && ts(m.due) > now) return 'The stock has not arrived yet';
  if (to === 'done' && m.type === 'putaway' && !m.to) return 'Choose a bin for it in the store first';
  return null;
}

/** Who may give a task to whom: managers assign anyone, staff take tasks themselves. */
export function assignError(m: Movement, to: User, by: User | null): string | null {
  if (!laneOf(m) || laneOf(m) === 'done') return 'This task is closed';
  if (!isStaff(to)) return `${to.name} is not store staff`;
  if (!by) return 'Sign in first';
  if (['storeManager', 'admin'].includes(by.role) || (by._id === to._id && isStaff(by))) return null;
  return 'Only the store manager assigns work to others';
}

async function user(id: string) { const u = await db.get('users', id); if (!u) throw new Error('Unknown user'); return u; }

/** Run the step that takes a task to a lane. */
export async function moveTo(id: string, to: Lane, userId: string): Promise<Movement | null> {
  const [m, u] = await Promise.all([db.get('movements', id), user(userId)]);
  if (!m) throw new Error('Task not found');
  const err = dropError(m, to, u);
  if (err) throw new Error(err);
  const from = laneOf(m);
  if (from === to) return m;
  if (from === 'approval') return m.type === 'count' ? stock.decideCount(id, 'approved', userId) : moves.decide(id, 'approved', userId);
  if (to === 'todo') return db.update('movements', id, { startedAt: null });
  if (to === 'doing') return db.update('movements', id, { startedAt: new Date().toISOString(), assignee: m.assignee ?? u._id });
  // Done: the stock changes now.
  if (!m.assignee) await db.update('movements', id, { assignee: u._id });
  if (m.type === 'putaway') return stock.putAway(id, m.to!, m.qty, userId);
  if (m.type === 'move') return moves.complete(id, userId);
  // Issues and transfers: the units leave the source bin.
  const lot = m.lotId ? await db.get('stockLots', m.lotId) : (await db.find('stockLots', { locationId: m.from, partNo: m.partNo }))[0];
  if (lot) {
    if (lot.qty < m.qty) throw new Error(`${lot.locationId.split(':')[1]} holds only ${lot.qty}`);
    if (lot.qty === m.qty) await db.remove('stockLots', lot._id);
    else await db.update('stockLots', lot._id, { qty: lot.qty - m.qty, reserved: Math.min(lot.reserved, lot.qty - m.qty) });
  }
  return db.update('movements', id, { status: 'done' });
}

export async function assign(id: string, toId: string, byId: string) {
  const [m, to, by] = await Promise.all([db.get('movements', id), user(toId), db.get('users', byId)]);
  if (!m) throw new Error('Task not found');
  const err = assignError(m, to, by);
  if (err) throw new Error(err);
  return db.update('movements', id, { assignee: to._id });
}
