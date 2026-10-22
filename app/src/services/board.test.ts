import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { Movement } from '../db/schema';
import { assign, dropError, laneOf, moveTo, slaOf, span } from './board';
import { binSeries, busyHours, flows, nodeOf } from './flow';

const get = async (id: string) => (await db.get('movements', id))!;

describe('task board', () => {
  beforeEach(async () => { await db.reset(); });

  it('puts the seeded floor work in lanes', async () => {
    expect(laneOf(await get('MR-26-1192'))).toBe('approval');
    expect(laneOf(await get('MR-26-1190'))).toBe('todo');
    expect(laneOf(await get('MR-26-1191'))).toBe('doing');
    expect(laneOf(await get('MR-26-1194'))).toBe('todo');
    expect(laneOf(await get('MR-26-1181'))).toBe('approval'); // count variance
    expect(laneOf(await get('MV-H-0001'))).toBeNull(); // history, not today
  });

  it('runs approve → start → done by dragging, with role checks', async () => {
    const mk = await db.get('users', 'mk'), si = await db.get('users', 'si');
    const m = await get('MR-26-1192');
    expect(dropError(m, 'todo', si)).toMatch(/store manager/);
    expect(dropError(m, 'doing', mk)).toMatch(/Approve it first/);
    expect((await moveTo(m._id, 'todo', 'mk'))!.status).toBe('approved');
    const started = (await moveTo(m._id, 'doing', 'si'))!;
    expect(started.startedAt).toBeTruthy();
    expect(started.assignee).toBe('si');
    expect(laneOf(started)).toBe('doing');
    const lot = (await db.get('stockLots', m.lotId!))!;
    expect((await moveTo(m._id, 'done', 'si'))!.status).toBe('done');
    expect((await db.get('stockLots', lot._id))?.qty ?? 0).toBe(lot.qty - m.qty);
    await expect(moveTo(m._id, 'todo', 'si')).rejects.toThrow(/closed/);
    // Back from In progress to To do clears the start.
    expect(laneOf((await moveTo('MR-26-1191', 'todo', 'si'))!)).toBe('todo');
  });

  it('posts a count variance only for the store manager, and finishes put-aways into their bin', async () => {
    await expect(moveTo('MR-26-1181', 'done', 'si')).rejects.toThrow(/store manager/);
    expect((await moveTo('MR-26-1181', 'done', 'mk'))!.status).toBe('done');
    const pa = await get('MR-26-1194');
    const before = (await db.find('stockLots', { locationId: pa.to })).reduce((n, l) => n + l.qty, 0);
    await moveTo(pa._id, 'done', 'si');
    expect((await db.find('stockLots', { locationId: pa.to })).reduce((n, l) => n + l.qty, 0)).toBe(before + 12);
    // A planned receipt cannot start before it arrives.
    expect(dropError(await get('MR-26-1180'), 'doing', await db.get('users', 'si'))).toMatch(/not arrived/);
  });

  it('lets managers assign anyone and clerks only themselves', async () => {
    expect((await assign('MR-26-1190', 'lp', 'mk')).assignee).toBe('lp');
    await expect(assign('MR-26-1190', 'dj', 'si')).rejects.toThrow(/store manager/);
    expect((await assign('MR-26-1190', 'si', 'si')).assignee).toBe('si');
    await expect(assign('MR-26-1190', 'rv', 'mk')).rejects.toThrow(/not store staff/);
  });

  it('runs the SLA clock from when work can start', () => {
    const now = Date.parse('2026-10-22T10:00:00Z');
    const m = { type: 'move', status: 'approved', createdAt: '2026-10-22T06:30:00Z' } as Movement;
    expect(slaOf(m, now)).toMatchObject({ state: 'soon', left: .5 * 3600000 });
    expect(slaOf({ ...m, createdAt: '2026-10-22T05:00:00Z' }, now).state).toBe('late');
    expect(slaOf({ ...m, type: 'putaway', due: '2026-10-24T00:00:00Z' }, now).state).toBe('planned');
    expect(slaOf({ ...m, status: 'done', updatedAt: '2026-10-22T09:00:00Z' }, now).state).toBe('met');
    expect(span(65 * 60000)).toBe('1 h 05 m');
    expect(span(-35 * 60000)).toBe('35 m');
  });
});

describe('material flow', () => {
  const mv = (p: Partial<Movement>) => ({ status: 'done', updatedAt: '2026-10-20T05:00:00Z', qty: 1, ...p }) as Movement;
  it('groups locations into nodes and sums flows', () => {
    expect(nodeOf('ktec:A-01-02', 'from', 'pick')).toBe('Rack A');
    expect(nodeOf(undefined, 'to', 'pick')).toBe('Picked out');
    expect(nodeOf('ktec:Lab L-03', 'to', 'issue')).toBe('Lab and test');
    const f = flows([mv({ type: 'pick', from: 'k:A-01-01', qty: 3 }), mv({ type: 'pick', from: 'k:A-02-01', qty: 2 }), mv({ type: 'putaway', from: 'k:Inbound staging', to: 'k:B-01-01', qty: 9 }),
      mv({ type: 'move', from: 'k:A-01-01', to: 'k:A-03-01' }), mv({ type: 'pick', from: 'k:C-01-01', updatedAt: '2026-01-01T00:00:00Z' })], Date.parse('2026-10-01'));
    expect(f).toEqual([{ source: 'Inbound', target: 'Rack B', qty: 9, n: 1 }, { source: 'Rack A', target: 'Picked out', qty: 5, n: 2 }]);
  });
  it('counts busy hours in IST and steps a bin back through time', () => {
    const g = busyHours([mv({ type: 'pick' })], 0); // 05:00 UTC Tuesday = 10:30 IST
    expect(g[1][10]).toBe(1);
    const loc = 'k:A-01-01';
    const s = binSeries([mv({ type: 'pick', from: loc, qty: 3, updatedAt: '2026-10-20T05:00:00Z' }), mv({ type: 'putaway', to: loc, qty: 10, updatedAt: '2026-10-18T05:00:00Z' })],
      loc, 7, Date.parse('2026-10-15T00:00:00Z'), Date.parse('2026-10-22T00:00:00Z'));
    expect(s[0][1]).toBe(0);
    expect(s.map(p => p[1])).toEqual([0, 0, 10, 10, 7, 7]);
  });
});
