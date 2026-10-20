import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { available, cancel, complete, decide, requestMove } from './moves';

const lotAt = async (loc: string) => (await db.find('stockLots', { locationId: loc }))[0];

describe('move requests', () => {
  beforeEach(async () => { await db.reset(); });

  it('runs request → approve → confirm and moves the stock', async () => {
    const src = await lotAt('ktec:D-05-04');
    expect(src.qty).toBe(12);
    expect(await available(src)).toBe(8); // 4 reserved
    const dest = 'ktec:A-01-01', destBefore = (await db.find('stockLots', { locationId: dest })).reduce((n, l) => n + l.qty, 0);
    const mv = await requestMove({ site: 'ktec', lotId: src._id, to: dest, qty: 5, reason: 'Re-slot' }, 'si');
    expect(mv.status).toBe('requested');
    expect(await available(src)).toBe(3); // 5 now held by the open move
    await expect(decide(mv._id, 'approved', 'si')).rejects.toThrow(/Waiting for storeManager/);
    await expect(complete(mv._id, 'si')).rejects.toThrow(/approved/);
    expect((await decide(mv._id, 'approved', 'mk')).status).toBe('approved');
    expect((await complete(mv._id, 'si')).status).toBe('done');
    expect((await db.get('stockLots', src._id))!.qty).toBe(7);
    const destAfter = (await db.find('stockLots', { locationId: dest })).reduce((n, l) => n + l.qty, 0);
    expect(destAfter - destBefore).toBe(5);
    expect((await db.find('auditLog', { docId: mv._id })).length).toBe(3);
  });

  it('auto-approves when the requester is the approver, and moves a whole lot by relocating it', async () => {
    const src = await lotAt('ktec:A-02-02');
    await db.update('stockLots', src._id, { reserved: 0 });
    const mv = await requestMove({ site: 'ktec', lotId: src._id, to: 'ktec:A-03-03', qty: src.qty, reason: 'Consolidate' }, 'mk');
    expect(mv.status).toBe('approved');
    await complete(mv._id, 'mk');
    expect((await db.get('stockLots', src._id))!.locationId).toBe('ktec:A-03-03');
  });

  it('refuses moves that break the rules', async () => {
    const src = await lotAt('ktec:D-05-04');
    await expect(requestMove({ site: 'ktec', lotId: src._id, to: 'ktec:A-01-01', qty: 9, reason: 'x' }, 'si')).rejects.toThrow(/Only 8 units/);
    await expect(requestMove({ site: 'ktec', lotId: src._id, to: 'ktec:D-05-04', qty: 1, reason: 'x' }, 'si')).rejects.toThrow(/already in/);
    await expect(requestMove({ site: 'ktec', lotId: src._id, to: 'ktec:Scrap yard', qty: 1, reason: 'x' }, 'si')).rejects.toThrow(/ESD sensitive/);
    const liion = (await db.find('stockLots', { partNo: 'KM-BAT-LI-500' }))[0];
    await db.update('stockLots', liion._id, { reserved: 0 });
    await expect(requestMove({ site: liion.site, lotId: liion._id, to: `${liion.site}:A-01-01`, qty: 1, reason: 'x' }, 'si')).rejects.toThrow(/hazmat/);
  });

  it('lets the requester cancel and frees the stock again', async () => {
    const src = await lotAt('ktec:D-05-04');
    const mv = await requestMove({ site: 'ktec', lotId: src._id, to: 'ktec:A-01-01', qty: 2, reason: 'x' }, 'si');
    await expect(cancel(mv._id, 'pr')).rejects.toThrow();
    expect((await cancel(mv._id, 'si')).status).toBe('cancelled');
    expect(await available(src)).toBe(8);
  });
});
