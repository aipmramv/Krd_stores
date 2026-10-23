import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import type { Movement, SensorEvent, User } from '../db/schema';
import { camerasSeeing, pointOf } from './cameras';
import { applyRetention, holdClip, ingest } from './events';
import { livePositions, zoneOf } from './live';
import { evaluate, inHours, retain, type Context } from './rules';
import { SCENARIOS, trigger } from './simulator';

const users = [{ _id: 'mk', name: 'M. Krishnan', role: 'storeManager' }, { _id: 'si', name: 'S. Iyer', role: 'clerk' }] as User[];
const ctx = (movements: Movement[] = []): Context => ({ movements, users, shipments: [] });
const ev = (p: Partial<SensorEvent>) => ({ _id: 'E1', site: 'ktec', at: '2026-10-21T05:00:00Z', source: 'cctv', conf: .9, ...p }) as SensorEvent;

describe('rules engine', () => {
  it('matches a camera-seen take to a recorded pick, and alerts when nothing explains it', () => {
    const pick = { _id: 'MV1', type: 'pick', status: 'done', from: 'ktec:A-01-01', qty: 2, partNo: 'P', updatedAt: '2026-10-21T05:06:00Z' } as Movement;
    expect(evaluate(ev({ kind: 'bin_take', loc: 'ktec:A-01-01' }), ctx([pick]))).toMatchObject({ outcome: 'matched', matched: 'MV1' });
    const late = { ...pick, updatedAt: '2026-10-21T06:00:00Z' };
    const o = evaluate(ev({ kind: 'bin_take', loc: 'ktec:A-01-01', qty: 2 }), ctx([late]));
    expect(o.outcome).toBe('alert');
    expect(o.alert).toMatchObject({ rule: 'unrecorded', severity: 'high', title: 'Unrecorded removal from A-01-01' });
    // Work in progress on the board explains it too.
    const doing = { ...pick, status: 'approved', startedAt: '2026-10-21T04:50:00Z', updatedAt: '2026-10-21T04:00:00Z' } as Movement;
    expect(evaluate(ev({ kind: 'bin_take', loc: 'ktec:A-01-01' }), ctx([doing])).outcome).toBe('matched');
    // Low confidence is logged, never alerted.
    expect(evaluate(ev({ kind: 'bin_take', loc: 'ktec:A-01-01', conf: .4 }), ctx()).outcome).toBe('logged');
  });

  it('applies access, hours, safety and sensor thresholds', () => {
    expect(evaluate(ev({ kind: 'zone_entry', loc: 'ktec:Hazmat H-01', person: 'mk' }), ctx()).outcome).toBe('logged');
    expect(evaluate(ev({ kind: 'zone_entry', loc: 'ktec:Hazmat H-01', person: 'si' }), ctx()).alert?.severity).toBe('medium');
    expect(evaluate(ev({ kind: 'zone_entry', loc: 'ktec:Hazmat H-01' }), ctx()).alert?.severity).toBe('high');
    expect(inHours('2026-10-21T05:00:00Z')).toBe(true);   // Wed 10:30 IST
    expect(inHours('2026-10-20T20:00:00Z')).toBe(false);  // Wed 01:30 IST
    expect(inHours('2026-10-25T05:00:00Z')).toBe(false);  // Sunday
    expect(evaluate(ev({ kind: 'motion', at: '2026-10-20T20:00:00Z' }), ctx()).alert?.rule).toBe('after_hours');
    expect(evaluate(ev({ kind: 'forklift_speed', value: 7 }), ctx()).outcome).toBe('ignored');
    expect(evaluate(ev({ kind: 'forklift_speed', value: 12, qty: 2 }), ctx()).alert?.severity).toBe('high');
    expect(evaluate(ev({ kind: 'temperature', source: 'sensor', value: 31.5 }), ctx()).alert?.rule).toBe('temperature');
    expect(evaluate(ev({ kind: 'aisle_blocked', value: 2 }), ctx()).outcome).toBe('ignored');
  });

  it('confirms work from scans and flags a lot in the wrong bin', () => {
    const doing = { _id: 'MV2', type: 'move', status: 'approved', startedAt: '2026-10-21T04:50:00Z', assignee: 'si', lotId: 'L1', from: 'ktec:A-01-01', to: 'ktec:B-01-01' } as Movement;
    const lots = [{ _id: 'L1', lot: '26-1', locationId: 'ktec:A-01-01' }, { _id: 'L2', lot: '26-2', locationId: 'ktec:C-01-01' }] as never;
    const c = { ...ctx([doing]), lots };
    expect(evaluate(ev({ source: 'scan', kind: 'scan', code: 'KONE:LOT:L1', loc: 'ktec:A-01-01', person: 'si' }), c)).toMatchObject({ outcome: 'matched', matched: 'MV2' });
    expect(evaluate(ev({ source: 'scan', kind: 'scan', code: 'KONE:BIN:ktec:A-01-01', person: 'si' }), c).outcome).toBe('matched');
    // Another lot scanned at the task's bin is not the task, and it is not where the system has it.
    expect(evaluate(ev({ source: 'scan', kind: 'scan', code: 'KONE:LOT:L2', loc: 'ktec:A-01-01', person: 'si' }), c).alert?.rule).toBe('wrong_bin');
  });

  it('checks dock arrivals and box counts against shipments', () => {
    const s = { _id: 'SH1', carrier: 'Gati', from: 'dhl', to: 'ktec', status: 'In transit', etaAt: '2026-10-21T08:00:00Z', items: [{ partNo: 'P', qty: 10 }] };
    const c = { ...ctx(), shipments: [s] } as unknown as Context;
    expect(evaluate(ev({ kind: 'vehicle_arrived', carrier: 'Gati' }), c)).toMatchObject({ outcome: 'matched', matched: 'SH1' });
    expect(evaluate(ev({ kind: 'vehicle_arrived', carrier: 'Porter' }), c).alert?.rule).toBe('dock_vehicle');
    expect(evaluate(ev({ kind: 'boxes_counted', ref: 'SH1', qty: 10 }), c).outcome).toBe('matched');
    expect(evaluate(ev({ kind: 'boxes_counted', ref: 'SH1', qty: 8 }), c).alert?.title).toBe('Short delivery · SH1');
  });

  it('deletes clips after 30 days unless held', () => {
    const clip = { camera: 'c', from: '', to: '' };
    const now = Date.parse('2026-10-22T00:00:00Z');
    expect(retain(ev({ at: '2026-09-01T00:00:00Z', clip }), now).clip).toBeNull();
    expect(retain(ev({ at: '2026-09-01T00:00:00Z', clip: { ...clip, held: true } }), now).clip?.held).toBe(true);
    expect(retain(ev({ at: '2026-10-10T00:00:00Z', clip }), now).clip).toBe(clip);
  });
});

describe('cameras and live positions', () => {
  beforeEach(async () => { await db.reset(); });
  it('finds the cameras watching a bin or area', async () => {
    const cams = await db.find('cameras', { site: 'ktec' });
    expect(cams).toHaveLength(6);
    expect(camerasSeeing(pointOf('ktec:Hazmat H-01')!, cams)[0].code).toBe('CAM-05');
    expect(camerasSeeing(pointOf('ktec:A-03-01')!, cams).map(c => c.code)).toContain('CAM-02');
  });
  it('puts trolleys on started work with the assignee beside them', async () => {
    const [trackers, work] = await Promise.all([db.find('trackers', { site: 'ktec' }), db.find('movements', { site: 'ktec' })]);
    const pos = livePositions(trackers, work, 100);
    const t1 = pos.find(p => p.id === 'ktec:T-01')!, dj = pos.find(p => p.id === 'ktec:B-DJ')!;
    expect(t1.task).toBe('MR-26-1191');
    expect(Math.hypot(t1.x - dj.x, t1.z - dj.z)).toBeLessThan(1.2);
    expect(pos.find(p => p.kind === 'forklift')).toBeTruthy();
    expect(zoneOf(19.5, 4)).toBe('Hazmat cabinet');
  });
});

describe('event backbone', () => {
  beforeEach(async () => { await db.reset(); });
  it('seeds a month of events with evidence and rule alerts', async () => {
    const evs = await db.find('events', { site: 'ktec' });
    expect(evs.length).toBeGreaterThan(80);
    const alerts = await db.find('alerts', { rule: 'unrecorded' });
    expect(alerts.filter(a => a.status === 'open')).toHaveLength(1);
    expect((await db.get('movements', 'MR-26-1191'))!.evidence!.length).toBeGreaterThan(0);
  });
  it('ingests: an unrecorded take raises an alert with a held clip; a matched one becomes evidence', async () => {
    const bad = await trigger('unrecorded');
    expect(bad.outcome).toBe('alert');
    expect(bad.camera).toMatch(/CAM-0\d/);
    expect(bad.clip?.held).toBe(true);
    const a = await db.get('alerts', bad.alert!);
    expect(a).toMatchObject({ rule: 'unrecorded', status: 'open', eventId: bad._id });
    const good = await trigger('recorded');
    expect(good.outcome).toBe('matched');
    expect((await db.get('movements', good.matched!))!.evidence).toContain(good._id);
  });
  it('runs every scenario through the rules', async () => {
    const outcomes: Record<string, string> = {};
    for (const s of SCENARIOS) outcomes[s.id] = (await trigger(s.id)).outcome!;
    expect(outcomes).toMatchObject({ recorded: 'matched', unrecorded: 'alert', wrong_bin: 'alert', hazmat: 'alert', quarantine: 'alert', after_hours: 'alert', esd: 'alert', forklift: 'alert', aisle: 'alert', smoke: 'alert', truck: 'alert', boxes: 'alert', temperature: 'alert', asset: 'alert' });
  });
  it('holds clips as evidence and applies retention', async () => {
    const e = await ingest({ site: 'ktec', at: new Date(Date.now() - 40 * 864e5).toISOString(), source: 'cctv', kind: 'zone_entry', camera: 'ktec:CAM-05', loc: 'ktec:Hazmat H-01', person: 'mk', conf: .9 });
    const f = await ingest({ site: 'ktec', at: new Date(Date.now() - 41 * 864e5).toISOString(), source: 'cctv', kind: 'zone_entry', camera: 'ktec:CAM-05', loc: 'ktec:Hazmat H-01', person: 'mk', conf: .9 });
    await holdClip(f._id);
    expect(await applyRetention()).toBeGreaterThanOrEqual(1);
    expect((await db.get('events', e._id))!.clip).toBeNull();
    expect((await db.get('events', f._id))!.clip?.held).toBe(true);
  });
});
