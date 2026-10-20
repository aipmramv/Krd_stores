import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { cancelCase, decide, dispose, moveToYard, submitReason, tag, writeOff } from './scrap';

describe('scrap cases', () => {
  beforeEach(async () => { await db.reset(); });

  it('runs a high-value case through every step and takes the units out of stock', async () => {
    const lot = (await db.find('stockLots', { locationId: 'ktec:A-01-02' }))[0];
    await db.update('stockLots', lot._id, { qty: 20, reserved: 0, partNo: 'KM-MS-CTL-118' });
    const c = await tag({ lotId: lot._id, qty: 6, photos: ['data:image/jpeg;base64,xx'] }, 'pr');
    expect(c.step).toBe('reason');
    expect(c.value).toBe(6 * 42000);
    expect((await db.get('stockLots', lot._id))!.reserved).toBe(6);
    const r = await submitReason(c._id, 'Failed QA or burn-in', 'Board 3 shorted', 'pr');
    expect(r.approvals.map(a => a.role)).toEqual(['engineer', 'ehs', 'finance']); // over ₹2,00,000
    await expect(decide(c._id, 'approved', 'ak')).rejects.toThrow(/Waiting for engineer/);
    await decide(c._id, 'approved', 'pr');
    await decide(c._id, 'approved', 'ak');
    expect((await decide(c._id, 'approved', 'mr')).step).toBe('move');
    await expect(moveToYard(c._id, 'mr')).rejects.toThrow(/store staff/);
    await moveToYard(c._id, 'si');
    expect((await db.get('stockLots', lot._id))!).toMatchObject({ qty: 14, reserved: 0 });
    expect((await db.find('stockLots', { locationId: 'ktec:Scrap yard', partNo: 'KM-MS-CTL-118' }))[0].qty).toBe(6);
    await expect(dispose(c._id, { disposal: 'E-waste recycler · CPCB authorised', vendor: ' ', pickupDate: '2026-10-25' }, 'ak')).rejects.toThrow(/vendor/);
    await dispose(c._id, { disposal: 'E-waste recycler · CPCB authorised', vendor: 'GreenTek Recyclers', pickupDate: '2026-10-25' }, 'ak');
    expect(await db.find('stockLots', { locationId: 'ktec:Scrap yard', partNo: 'KM-MS-CTL-118' })).toHaveLength(0);
    await expect(writeOff(c._id, { certificate: 'X' }, 'ak')).rejects.toThrow(/finance/);
    const closed = await writeOff(c._id, { certificate: 'RCY/2026/10/0457' }, 'mr');
    expect(closed).toMatchObject({ step: 'closed', outcome: 'written-off' });
    expect(closed.writeOffRef).toMatch(/^FI-WO-/);
    expect(closed.history!.length).toBe(8);
  });

  it('uses the short chain under ₹2,00,000 and releases the units on rejection', async () => {
    const r = await submitReason('SC-2026-0421', 'E-waste · end of life', 'burn-in', 'pr');
    expect(r.approvals.map(a => a.role)).toEqual(['engineer', 'ehs']);
    const lotId = r.lotId!;
    const before = (await db.get('stockLots', lotId))!.reserved;
    await decide(r._id, 'approved', 'pr');
    const rej = await decide(r._id, 'rejected', 'ak', 'Rework instead');
    expect(rej).toMatchObject({ step: 'closed', outcome: 'rejected' });
    expect((await db.get('stockLots', lotId))!.reserved).toBe(before - 12);
  });

  it('lets only the owner withdraw, and refuses tagging more than is free', async () => {
    await expect(cancelCase('SC-2026-0421', 'si')).rejects.toThrow(/owner/);
    expect((await cancelCase('SC-2026-0421', 'pr')).outcome).toBe('cancelled');
    const lot = (await db.find('stockLots', { locationId: 'ktec:D-05-04' }))[0];
    await expect(tag({ lotId: lot._id, qty: 9, photos: [] }, 'pr')).rejects.toThrow(/Only 8/);
  });

  it('confirms a case raised in the scrap yard without moving stock', async () => {
    await decide('SC-2026-0418', 'approved', 'ak');
    const c = await decide('SC-2026-0418', 'approved', 'mr');
    expect(c.step).toBe('move');
    const m = await moveToYard(c._id, 'mk');
    expect(m.yardLotId).toBe(c.lotId);
  });
});
