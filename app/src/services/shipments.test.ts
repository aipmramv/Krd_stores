import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { advance, approveHazmat, book, cancelShipment, clearHold, quote, raiseClaim } from './shipments';

const parts = async () => new Map((await db.find('parts')).map(p => [p._id, p]));
const freeAt = async (site: string, partNo: string) => (await db.find('stockLots', { site, partNo })).reduce((n, l) => n + l.qty - l.reserved, 0);

describe('shipments', () => {
  beforeEach(async () => { await db.reset(); });

  it('quotes long and short lanes and blocks Li-ion by courier', async () => {
    const p = await parts();
    const long = quote('ktec', 'pnq', [{ partNo: 'KM-DX-ACT-220', qty: 6 }], p);
    expect(long.map(o => o.id)).toEqual(expect.arrayContaining(['ftl', 'rail', 'air', 'courier']));
    expect(long.find(o => o.tag === 'Fastest')?.id).toBe('air');
    const short = quote('ktec', 'isu', [{ partNo: 'KM-DX-ACT-220', qty: 2 }], p);
    expect(short.map(o => o.id)).toContain('shuttle');
    const li = quote('ktec', 'pnq', [{ partNo: 'KM-BAT-LI-500', qty: 2 }], p).find(o => o.id === 'courier')!;
    expect(li.allowed).toBe(false);
    expect(li.why).toMatch(/UN3480/);
  });

  it('books with FIFO allocation, picks up, delivers into staging with put-away tasks', async () => {
    const before = await freeAt('ktec', 'KM-DX-ACT-220');
    const s = await book({ from: 'ktec', to: 'pnq', lines: [{ partNo: 'KM-DX-ACT-220', qty: 6 }], optionId: 'ftl' }, 'rv');
    expect(s.status).toBe('Booked');
    expect(s.docs).toEqual(['Invoice', 'E-way bill', 'Packing list']);
    expect(await freeAt('ktec', 'KM-DX-ACT-220')).toBe(before - 6);
    await expect(book({ from: 'ktec', to: 'pnq', lines: [{ partNo: 'KM-DX-ACT-220', qty: 100000 }], optionId: 'ftl' }, 'rv')).rejects.toThrow(/Not enough|limit/);
    await expect(advance(s._id, 'pr')).rejects.toThrow(/logistics/);
    const onHand = async () => (await db.find('stockLots', { site: 'ktec', partNo: 'KM-DX-ACT-220' })).reduce((n, l) => n + l.qty, 0);
    const qBefore = await onHand();
    expect((await advance(s._id, 'rv')).status).toBe('Picked up');
    expect(await onHand()).toBe(qBefore - 6);
    await advance(s._id, 'rv'); await advance(s._id, 'rv');
    const d = await advance(s._id, 'rv');
    expect(d.status).toBe('Delivered');
    expect(d.docs).toContain('POD');
    expect((await db.find('stockLots', { locationId: 'pnq:Inbound staging' }))[0].qty).toBe(6);
    expect((await db.find('movements', { site: 'pnq', type: 'putaway', ref: s._id })).length).toBe(1);
    await expect(advance(s._id, 'rv')).rejects.toThrow(/No further/);
  });

  it('holds dangerous goods for EHS and releases stock when cancelled', async () => {
    const site = (await db.find('stockLots', { partNo: 'KM-BAT-LI-500' }))[0].site;
    const lot = (await db.find('stockLots', { partNo: 'KM-BAT-LI-500' }))[0];
    await db.update('stockLots', lot._id, { status: 'Available', reserved: 0 });
    const to = site === 'pnq' ? 'ktec' : 'pnq';
    const s = await book({ from: site, to, lines: [{ partNo: 'KM-BAT-LI-500', qty: 2 }], optionId: 'ftl' }, 'rv');
    expect(s.status).toBe('Awaiting EHS approval');
    expect(s.docs).toContain('DG declaration');
    await expect(advance(s._id, 'rv')).rejects.toThrow();
    await expect(approveHazmat(s._id, 'rv')).rejects.toThrow(/EHS/);
    expect((await approveHazmat(s._id, 'ak')).status).toBe('Booked');
    const reservedBefore = (await db.get('stockLots', lot._id))!.reserved;
    expect((await cancelShipment(s._id, 'rv')).status).toBe('Cancelled');
    expect((await db.get('stockLots', lot._id))!.reserved).toBe(reservedBefore - 2);
  });

  it('clears an e-way bill hold and records claims', async () => {
    const held = (await db.find('shipments', { status: 'E-way bill hold' }))[0];
    await expect(advance(held._id, 'rv')).rejects.toThrow(/hold/);
    expect((await clearHold(held._id, 'rv', 'Part B corrected')).status).toBe('In transit');
    await expect(raiseClaim(held._id, { kind: 'Delay', amount: 0, note: '' }, 'rv')).rejects.toThrow(/amount/);
    expect((await raiseClaim(held._id, { kind: 'Delay', amount: 12000, note: '2 days late' }, 'rv')).claims).toHaveLength(1);
  });
});
