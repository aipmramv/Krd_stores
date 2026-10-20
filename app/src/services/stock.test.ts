import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { count, decideCount, openPutaways, pick, putAway, receive, release, reserve } from './stock';

const lotAt = async (loc: string) => (await db.find('stockLots', { locationId: loc }))[0];

describe('store actions', () => {
  beforeEach(async () => { await db.reset(); });

  it('picks free units, or reserved ones against the reservation', async () => {
    const l = await lotAt('ktec:D-05-04'); // 12 on hand, 4 reserved
    await expect(pick({ lotId: l._id, qty: 9, purpose: 'Lab', againstReservation: false }, 'si')).rejects.toThrow(/Only 8/);
    await expect(pick({ lotId: l._id, qty: 1, purpose: 'Lab', againstReservation: false }, 'pr')).rejects.toThrow(/store staff/);
    await pick({ lotId: l._id, qty: 3, purpose: 'Issue to Lab L-03', againstReservation: true }, 'si');
    expect(await db.get('stockLots', l._id)).toMatchObject({ qty: 9, reserved: 1 });
  });

  it('completes the planned PO put-away, creating the lot on arrival', async () => {
    const [task] = (await openPutaways('ktec')).filter(t => t.ref === 'PO 4500182');
    expect(task.qty).toBe(20);
    await expect(putAway(task._id, 'ktec:Hazmat H-01', 20, 'si')).rejects.toThrow(/ESD/);
    const before = (await db.find('stockLots', { locationId: 'ktec:A-01-03' })).reduce((n, x) => n + x.qty, 0);
    await putAway(task._id, 'ktec:A-01-03', 15, 'si');
    const after = (await db.find('stockLots', { locationId: 'ktec:A-01-03' })).reduce((n, x) => n + x.qty, 0);
    expect(after - before).toBe(15);
    const rest = (await openPutaways('ktec')).filter(t => t.ref === 'PO 4500182');
    expect(rest).toHaveLength(1);
    expect(rest[0].qty).toBe(5);
  });

  it('receives without a task into a bin with room', async () => {
    const m = await receive({ site: 'ktec', partNo: 'KM-PCB-IOT-022', qty: 10, to: 'ktec:B-02-02', lot: 'GRN-77', ref: 'DC 991' }, 'si');
    expect(m.status).toBe('done');
    expect((await db.find('stockLots', { locationId: 'ktec:B-02-02', lot: 'GRN-77' }))[0].qty).toBe(10);
  });

  it('posts matching counts, holds variances for the store manager, then adjusts', async () => {
    const l = await lotAt('ktec:C-10-04'); // 40 IoT boards, seeded variance pending
    const [same] = await count([{ lotId: l._id, counted: 40 }], 'si');
    expect(same.status).toBe('done');
    const [v] = await count([{ lotId: l._id, counted: 36 }], 'si');
    expect(v.status).toBe('requested');
    await expect(decideCount(v._id, 'approved', 'si')).rejects.toThrow(/store staff|Only/);
    await decideCount(v._id, 'approved', 'mk');
    expect((await db.get('stockLots', l._id))!.qty).toBe(36);
    // A store manager's own count posts at once.
    const [own] = await count([{ lotId: l._id, counted: 35 }], 'mk');
    expect(own.status).toBe('done');
    expect((await db.get('stockLots', l._id))!.qty).toBe(35);
  });

  it('reserves free units for a project and releases them', async () => {
    const l = await lotAt('ktec:A-02-01');
    await db.update('stockLots', l._id, { reserved: 0 });
    await reserve({ lotId: l._id, qty: 2, project: 'DX Class 2027', until: '2026-11-15' }, 'rv');
    expect((await db.get('stockLots', l._id))!.reserved).toBe(2);
    await expect(release(l._id, 3, 'rv')).rejects.toThrow(/Only 2/);
    await release(l._id, 2, 'rv');
    expect((await db.get('stockLots', l._id))!.reserved).toBe(0);
  });
});
