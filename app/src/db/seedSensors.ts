// Seed for the sensor side of the demo: cameras and tracker tags in the modelled stores, and a
// month of camera, scan and dock events run through the real rules engine. Most events confirm
// recorded movements (and become their evidence); a few are the exceptions the rules exist for.
import { camerasSeeing, pointOf, storeCameras } from '../services/cameras';
import { evaluate, retain, type Context } from '../services/rules';
import type { Alert, Camera, Movement, SensorEvent, Shipment, StockLot, Tracker, User } from './schema';

export function sensors(T0: string, d: { users: User[]; movements: Movement[]; shipments: Shipment[]; stockLots: StockLot[] }, rng: () => number) {
  const now = Date.parse(T0), at = (ms: number) => new Date(ms).toISOString();
  const stamp = <T extends object>(x: T) => ({ ...x, createdAt: T0, updatedAt: T0 });
  const cameras: Camera[] = ['ktec', 'isu'].flatMap(site => storeCameras(site, c => stamp(c)));
  const camFor = (site: string, loc?: string) => { const p = pointOf(loc); return p ? camerasSeeing(p, cameras.filter(c => c.site === site))[0] : undefined; };

  const trackers: Tracker[] = [
    ...[1, 2, 3, 4].map(n => ({ _id: `ktec:T-0${n}`, site: 'ktec', label: `Trolley T-0${n}`, kind: 'trolley' as const, tech: 'UWB' as const, battery: 92 - n * 7, x: -18 + n * 2.4, z: 15.5 })),
    { _id: 'ktec:FL-01', site: 'ktec', label: 'Forklift FL-01', kind: 'forklift', tech: 'UWB', battery: 64, x: 20, z: 13 },
    ...['si', 'dj', 'lp', 'mk'].map((u, i) => ({ _id: `ktec:B-${u.toUpperCase()}`, site: 'ktec', label: `Badge · ${d.users.find(x => x._id === u)?.name}`, kind: 'badge' as const, tech: 'BLE' as const, user: u, battery: 80 - i * 9 })),
    { _id: 'ktec:A-118', site: 'ktec', label: 'Controller boards · RFID', kind: 'asset', tech: 'RFID', partNo: 'KM-MS-CTL-118', battery: 100 },
    { _id: 'isu:T-11', site: 'isu', label: 'Trolley T-11', kind: 'trolley', tech: 'UWB', battery: 71, x: -15, z: 15.5 },
    { _id: 'isu:A-040', site: 'isu', label: 'Escalator drive · RFID', kind: 'asset', tech: 'RFID', partNo: 'KM-ESC-DRV-040', battery: 100 },
  ].map(t => stamp({ ...t, lastSeen: T0 } as Tracker));

  const events: SensorEvent[] = [], alerts: Alert[] = [];
  const ctx: Context = { movements: d.movements, users: d.users, shipments: d.shipments, cameras, lots: d.stockLots, events };
  const add = (e: Omit<SensorEvent, '_id' | 'outcome' | 'note'>, status: Alert['status'] = 'closed') => {
    const id = `EV-${String(events.length + 1).padStart(4, '0')}`, ev = { ...e, _id: id, createdAt: e.at, updatedAt: e.at } as SensorEvent;
    if (ev.camera && !ev.clip) ev.clip = { camera: ev.camera, from: at(Date.parse(ev.at) - 10000), to: at(Date.parse(ev.at) + 15000) };
    const o = evaluate(ev, ctx);
    Object.assign(ev, { outcome: o.outcome, note: o.note, matched: o.matched });
    if (o.alert) {
      const a: Alert = { _id: `${ev.site}-R${alerts.length + 1}`, site: ev.site, ...o.alert, status, at: ev.at, eventId: id, loc: ev.loc, createdAt: ev.at, updatedAt: ev.at };
      alerts.push(a); ev.alert = a._id;
      if (ev.clip) ev.clip.held = true;
    }
    const m = o.matched && d.movements.find(x => x._id === o.matched);
    if (m) m.evidence = [...(m.evidence ?? []), id];
    events.push(retain(ev, now));
    return ev;
  };

  // Cameras confirm part of the recorded work (where a camera covers the bin).
  for (const m of d.movements) {
    if (m.status !== 'done' || !m.updatedAt || rng() > .4 || !['pick', 'putaway', 'move'].includes(m.type)) continue;
    const take = m.type !== 'putaway', loc = take ? m.from : m.to, cam = camFor(m.site, loc);
    if (!cam) continue;
    add({ site: m.site, at: at(Date.parse(m.updatedAt) - 90000), source: 'cctv', kind: take ? 'bin_take' : 'bin_put', camera: cam._id, loc, qty: m.qty, conf: .82 + rng() * .16, person: m.assignee ?? undefined });
  }
  // A camera-confirmed start on the move in progress.
  const doing = d.movements.find(m => m._id === 'MR-26-1191');
  if (doing) add({ site: 'ktec', at: at(now - 20 * 60000), source: 'cctv', kind: 'bin_take', camera: camFor('ktec', doing.from)?._id, loc: doing.from, qty: doing.qty, conf: .93, person: 'dj' });

  // The exceptions: unrecorded removals (one still open), access, ESD coat, after hours, forklift.
  const ktecBins = d.stockLots.filter(l => l.site === 'ktec' && /:[A-D]-\d\d-\d\d$/.test(l.locationId) && camFor('ktec', l.locationId));
  const quiet = (loc: string, t: number) => !d.movements.some(m => (m.from === loc || m.to === loc) && Math.abs(Date.parse(m.updatedAt ?? '') - t) < 3600000);
  [[26, 'closed'], [17, 'closed'], [9, 'closed'], [3, 'ack'], [0.08, 'open']].forEach(([back, status], i) => {
    const t = now - (back as number) * 86400000 - 3600000 * (i + 1);
    const l = ktecBins.filter(x => quiet(x.locationId, t))[(i * 17 + 5) % ktecBins.length];
    add({ site: 'ktec', at: at(t), source: 'cctv', kind: 'bin_take', camera: camFor('ktec', l.locationId)?._id, loc: l.locationId, qty: 1 + (i % 3), conf: .88 + i * .02 }, status as Alert['status']);
  });
  const h = (back: number, hour: number) => { const day = Math.floor((now + 5.5 * 3600000) / 86400000) - back; return day * 86400000 - 5.5 * 3600000 + hour * 3600000; };
  add({ site: 'ktec', at: at(h(12, 10.4)), source: 'cctv', kind: 'zone_entry', camera: 'ktec:CAM-05', loc: 'ktec:Hazmat H-01', person: 'mk', conf: .95 });
  add({ site: 'ktec', at: at(h(6, 15.2)), source: 'cctv', kind: 'zone_entry', camera: 'ktec:CAM-06', loc: 'ktec:Quarantine Q-01', person: 'si', conf: .91 }, 'ack');
  add({ site: 'ktec', at: at(h(19, 13.7)), source: 'cctv', kind: 'zone_entry', camera: 'ktec:CAM-05', loc: 'ktec:Hazmat H-01', conf: .86 });
  add({ site: 'ktec', at: at(h(4, 11.1)), source: 'cctv', kind: 'no_esd_coat', camera: 'ktec:CAM-02', loc: 'ktec:A-04-02', conf: .84 });
  add({ site: 'ktec', at: at(now - 40 * 60000), source: 'cctv', kind: 'no_esd_coat', camera: 'ktec:CAM-02', loc: 'ktec:A-07-01', person: 'lp', conf: .9 }, 'open');
  add({ site: 'ktec', at: at(h(3, 23.6)), source: 'cctv', kind: 'motion', camera: 'ktec:CAM-01', loc: 'ktec:Inbound staging', conf: .97 });
  add({ site: 'ktec', at: at(h(8, 16.4)), source: 'cctv', kind: 'forklift_speed', camera: 'ktec:CAM-03', loc: 'ktec:B-06-01', tag: 'Forklift FL-01', value: 11, qty: 2, conf: .9 });
  // Dock: vehicles for today's deliveries and pick-ups, with a box count.
  for (const s of d.shipments.filter(x => (x.to === 'ktec' || x.from === 'ktec') && !['Delivered', 'Cancelled'].includes(x.status)).slice(0, 3)) {
    const t = Math.min(now - 30 * 60000, Date.parse((s.to === 'ktec' ? s.etaAt : s.pickupAt) ?? T0));
    add({ site: 'ktec', at: at(t), source: 'cctv', kind: 'vehicle_arrived', camera: 'ktec:CAM-01', loc: 'ktec:Inbound staging', carrier: s.carrier, plate: `TN ${10 + events.length} AB ${4000 + events.length * 37}`, conf: .94 });
  }
  // Scans on the floor: one confirms the move in progress.
  if (doing) add({ site: 'ktec', at: at(now - 18 * 60000), source: 'scan', kind: 'scan', device: 'Phone · D. Joseph', loc: doing.from, code: `KONE:LOT:${doing.lotId}`, person: 'dj' });
  return { cameras, trackers, events: events.sort((a, b) => b.at.localeCompare(a.at)), alerts };
}

