import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { seed } from '../db/seed';
import { tasksFor } from './inbox';
import { book } from './shipments';
import { pick } from './stock';
import { shipmentAsOf, stockAsOf } from './timeline';

const DAY = 86400000;
const total = (lots: { qty: number }[]) => lots.reduce((n, l) => n + l.qty, 0);

describe('timeline', () => {
  beforeEach(async () => { await db.reset(); });

  it('replays: undoes later picks and hides lots received later', async () => {
    const lot = (await db.find('stockLots', { locationId: 'ktec:D-05-04' }))[0];
    await pick({ lotId: lot._id, qty: 3, purpose: 'Lab', againstReservation: false }, 'si');
    const [lots, moves, ships] = await Promise.all([db.find('stockLots', { site: 'ktec' }), db.find('movements', { site: 'ktec' }), db.find('shipments')]);
    const now = Date.now();
    const back = stockAsOf(lots, moves, ships, now - 60 * 60000, now);
    expect(back.find(l => l._id === lot._id)!.qty).toBe(12);
    const longAgo = stockAsOf(lots, moves, ships, now - 30 * DAY, now);
    expect(longAgo.every(l => Date.parse(l.receivedAt) <= now - 30 * DAY)).toBe(true);
    expect(total(longAgo)).toBeLessThan(total(lots));
  });

  it('forecasts the planned PO and booked pick-ups', async () => {
    const s = await book({ from: 'ktec', to: 'pnq', lines: [{ partNo: 'KM-DX-ACT-220', qty: 6 }], optionId: 'ftl' }, 'rv');
    const [lots, moves, ships] = await Promise.all([db.find('stockLots', { site: 'ktec' }), db.find('movements', { site: 'ktec' }), db.find('shipments')]);
    const now = Date.now(), week = stockAsOf(lots, moves, ships, now + 7 * DAY, now);
    const at = (ls: typeof lots, loc: string) => total(ls.filter(l => l.locationId === loc && l.partNo === 'KM-DX-ACT-220'));
    expect(at(week, 'ktec:D-05-04')).toBeGreaterThanOrEqual(at(lots, 'ktec:D-05-04') + 20 - 6);
    expect(total(week.filter(l => l.partNo === 'KM-DX-ACT-220'))).toBe(total(lots.filter(l => l.partNo === 'KM-DX-ACT-220')) + 20 - 6);
    expect(shipmentAsOf(s, now + 7 * DAY, now)).toMatchObject({ status: 'Delivered', projected: true });
    expect(shipmentAsOf(s, now - DAY, now)).toBeNull();
  });

  it('replays shipment milestones', () => {
    const s = seed().shipments.find(x => x.status === 'Out for delivery')!, now = Date.now();
    const r = shipmentAsOf(s, now - 2.5 * DAY, now)!;
    expect(r.milestones.filter(m => m.done).length).toBeLessThan(s.milestones.filter(m => m.done).length);
  });
});

describe('inbox', () => {
  const d = seed();
  const user = (id: string) => d.users.find(u => u._id === id)!;
  it('gives each role its own tasks', () => {
    const kinds = (id: string) => tasksFor(user(id), d).map(t => t.kind);
    expect(kinds('mk')).toEqual(expect.arrayContaining(['count', 'putaway']));
    expect(kinds('ak')).toContain('scrap');              // EHS approves SC-2026-0418
    expect(kinds('pr')).toContain('scrap');              // lab owner gives the reason on SC-2026-0421
    expect(kinds('rv')).toEqual(expect.arrayContaining(['hold', 'delay']));
    expect(kinds('kn')).toEqual([]);
    expect(tasksFor(user('mk'), d)[0].urgent).toBe(true);
  });
});

describe('search', () => {
  beforeEach(async () => { await db.reset(); });
  it('finds parts, bins, AWBs, POs, scrap cases and people', async () => {
    const { searchAll } = await import('./search');
    const groups = async (q: string) => (await searchAll(q)).map(h => h.group);
    expect(await groups('actuator')).toContain('Parts');
    expect((await searchAll('D-05-04')).some(h => h.target.kind === 'bin' && h.target.site === 'ktec')).toBe(true);
    expect(await groups('DEL 2210')).toContain('Shipments');
    expect(await groups('4500182')).toContain('Requests and POs');
    expect(await groups('SC-2026-0418')).toContain('Scrap cases');
    expect(await groups('Krishnan')).toContain('People');
    expect(await groups('Sriperumbudur')).toContain('Sites');
    expect(await searchAll('a')).toEqual([]);
    expect(await searchAll('(*')).toEqual([]); // regex characters are escaped
  });
});
