// Seed documents for the demo database and for `npm run seed` on the server, built from the
// sample data so the 3D twins, the drawers and the data store all tell the same story.
import { PARTS, SHIPS } from '../data/sample';
import { SITES } from '../data/sites';
import { BAYS, binId, FEATURED_BIN, isReserved, LEVELS, partInBin, rnd, ROWS } from '../data/storeModel';
import type { Bin } from '../data/types';
import { sensors } from './seedSensors';
import type { Alert, ApprovalRule, AreaTemplate, CostCentre, Purpose, Carrier, Coll, Collections, Location, Milestone, Movement, Part, ScrapCase, Shipment, StockLot, User, Zone } from './schema';

/** Seed time: the start of the current hour, so dates in the demo stay relative to today. */
const T0 = new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
const stamp = <T extends object>(d: T) => ({ ...d, createdAt: T0, updatedAt: T0 });
const days = (n: number) => new Date(Date.parse(T0) + n * 86400000).toISOString();
const hours = (n: number) => new Date(Date.parse(T0) + n * 3600000).toISOString();

/** Deterministic random numbers for the generated history (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Store working hours (IST) weighted to the morning and afternoon peaks. */
const HOUR_W: [number, number][] = [[8, 2], [9, 6], [10, 8], [11, 7], [12, 3], [13, 2], [14, 6], [15, 8], [16, 6], [17, 4], [18, 2], [19, 1]];
const IST = 5.5 * 3600000;
/** A working moment `back` days before T0: weekdays mostly, Saturdays light, no Sundays. */
function workTime(r: () => number, back: number) {
  let day = Math.floor((Date.parse(T0) + IST) / 86400000) - back;
  // 0 = Sunday (1 Jan 1970 was a Thursday); Sunday work and most Saturday work moves to an earlier weekday.
  const dow = () => (day + 4) % 7;
  while (dow() === 0 || (dow() === 6 && r() < .6)) day -= 1 + Math.floor(r() * 5);
  const total = HOUR_W.reduce((n, [, w]) => n + w, 0);
  let x = r() * total, h = 8;
  for (const [hh, w] of HOUR_W) { if ((x -= w) < 0) { h = hh; break; } }
  return day * 86400000 - IST + (h + r()) * 3600000;
}
const PICK_PURPOSE = ['Lab test', 'Field repair', 'Prototype build', 'Customer site'];

/**
 * Thirty days of finished work in the electronics stores, made from the stock as it is now so the
 * timeline replay stays consistent: picks from lots, re-slotting moves into bins, put-aways of lots
 * received in the last month and issues to the lab.
 */
function history(stockLots: StockLot[]): Movement[] {
  const r = rng(26), out: Movement[] = [], staff = ['si', 'dj', 'lp'];
  const now = Date.parse(T0);
  const add = (m: Omit<Movement, '_id' | 'createdAt' | 'updatedAt' | 'status' | 'approvals' | 'requestedBy'> & Partial<Movement>, at: number) => {
    if (at >= now - 1800000) return;
    const who = staff[Math.floor(r() * staff.length)];
    out.push({ status: 'done', approvals: [], requestedBy: who, assignee: who, ...m, _id: `MV-H-${String(out.length + 1).padStart(4, '0')}`,
      createdAt: new Date(at - (1 + r() * 3) * 3600000).toISOString(), startedAt: new Date(at - r() * 1800000).toISOString(), updatedAt: new Date(at).toISOString() } as Movement);
  };
  const bins = stockLots.filter(l => (l.site === 'ktec' || l.site === 'isu') && /:[A-D]-\d\d-\d\d$/.test(l.locationId));
  for (const l of bins) {
    const base = { site: l.site, partNo: l.partNo, lotId: l._id };
    const received = Date.parse(l.receivedAt), recent = now - received < 30 * 86400000;
    if (recent) add({ ...base, type: 'putaway', qty: l.qty, from: `${l.site}:Inbound staging`, to: l.locationId, ref: `PO 45001${String(out.length).padStart(2, '0')}`, reason: 'Inbound · put-away' }, workTime(r, Math.max(1, Math.floor((now - received) / 86400000))));
    const after = recent ? Math.ceil((now - received) / 86400000) - 1 : 29;
    const picks = r() < .55 ? 1 + Math.floor(r() * 3) : 0;
    for (let i = 0; i < picks && after > 0; i++) add({ ...base, type: 'pick', qty: 1 + Math.floor(r() * 4), from: l.locationId, reason: PICK_PURPOSE[Math.floor(r() * 4)] }, workTime(r, 1 + Math.floor(r() * after)));
    if (!recent && r() < .14 && l.qty >= 3) {
      const src = bins[Math.floor(r() * bins.length)];
      if (src.site === l.site && src.locationId !== l.locationId)
        add({ ...base, type: 'move', qty: Math.min(l.qty, 2 + Math.floor(r() * 6)), from: src.locationId, to: l.locationId, reason: 'Re-slot for faster picking',
          approvals: [{ role: 'storeManager', user: 'mk', decision: 'approved', at: new Date(now - 30 * 86400000).toISOString() }] }, workTime(r, 1 + Math.floor(r() * 29)));
    }
    if (l.site === 'ktec' && r() < .05) add({ ...base, type: 'issue', qty: 1 + Math.floor(r() * 3), from: l.locationId, to: 'ktec:Lab L-03', reason: 'Issue to lab' }, workTime(r, 1 + Math.floor(r() * 29)));
    if (l.site === 'ktec' && r() < .03) add({ ...base, type: 'move', qty: 1, from: l.locationId, to: 'ktec:Quarantine Q-01', reason: 'Damaged in handling · hold',
      approvals: [{ role: 'storeManager', user: 'mk', decision: 'approved' }] }, workTime(r, 1 + Math.floor(r() * 29)));
  }
  return out;
}

/** Unit cost in ₹ per unit of measure. */
const COST: Record<string, number> = {
  'KM-DX-ACT-220': 18500, 'KM-MS-CTL-118': 42000, 'KM-ESC-DRV-040': 210000, 'KM-BAT-LI-500': 65000,
  'KM-SNS-LDR-077': 28000, 'KM-RPE-HSR-210': 1800, 'KM-GUI-RAL-016': 9500, 'KM-CAB-PNL-301': 75000,
  'KM-LUB-SYN-005': 1200, 'KM-MOT-PM-150': 340000, 'KM-PCB-IOT-022': 8200, 'KM-SFT-BRK-090': 71333,
};

/** Shipping weight per unit of measure, kg. */
const WEIGHT: Record<string, number> = {
  'KM-DX-ACT-220': 4.2, 'KM-MS-CTL-118': .9, 'KM-ESC-DRV-040': 135, 'KM-BAT-LI-500': 21, 'KM-SNS-LDR-077': .7, 'KM-RPE-HSR-210': .65,
  'KM-GUI-RAL-016': 48, 'KM-CAB-PNL-301': 26, 'KM-LUB-SYN-005': .95, 'KM-MOT-PM-150': 160, 'KM-PCB-IOT-022': .25, 'KM-SFT-BRK-090': 14,
};

const AREAS: [string, Zone][] = [['Inbound staging', 'General'], ['Hazmat H-01', 'Hazmat'], ['Hazmat H-02', 'Hazmat'], ['Quarantine Q-01', 'Quarantine'], ['Heavy L0', 'Heavy'],
  ['Lab L-03', 'Lab'], ['Test tower', 'Test'], ['Scrap yard', 'Yard'], ['Yard Y-02', 'Yard']];

const SITE_OF: Record<string, string> = { Chennai: 'ktec', Pune: 'pnq' };
/** Areas named in the sample that are at the ISU factory rather than KTEC. */
const AREA_SITE: Record<string, string> = { 'Test tower': 'isu', 'Scrap yard': 'isu', 'Heavy L0': 'isu' };

/** Open work on the KTEC store floor for the task board: moves at each stage and an inbound put-away. */
function liveTasks(stockLots: StockLot[]): Movement[] {
  const free = stockLots.filter(l => l.site === 'ktec' && /:[A-D]-\d\d-\d\d$/.test(l.locationId) && l.qty >= 8 && !l.reserved && !/C-10-04|D-05-04/.test(l.locationId));
  const [a, b, c, d, e, f, g] = [3, 11, 19, 27, 35, 43, 51].map(i => free[i % free.length]);
  const mgr = { role: 'storeManager' as const, user: 'mk', decision: 'approved' as const, at: hours(-2) };
  const mv = (id: string, lot: StockLot, to: StockLot, qty: number, at: number, extra: Partial<Movement>): Movement => ({
    _id: id, site: 'ktec', type: 'move', partNo: lot.partNo, qty, lotId: lot._id, from: lot.locationId, to: to.locationId, reason: 'Re-slot for faster picking',
    status: 'approved', requestedBy: 'mk', approvals: [mgr], createdAt: hours(at), updatedAt: hours(at), ...extra,
  });
  return [
    mv('MR-26-1190', a, b, 4, -1.5, {}),
    mv('MR-26-1191', c, d, 6, -2, { assignee: 'dj', startedAt: hours(-.4) }),
    mv('MR-26-1192', e, f, 3, -3, { status: 'requested', requestedBy: 'si', approvals: [{ role: 'storeManager', decision: 'pending' }], reason: 'Consolidate part-full bins' }),
    mv('MR-26-1193', g, a, 2, -6, { assignee: 'lp' }),
    { _id: 'MR-26-1194', site: 'ktec', type: 'putaway', partNo: 'KM-SNS-LDR-077', qty: 12, from: 'ktec:Inbound staging', to: g.locationId, ref: 'ASN 7781', reason: 'Inbound · ASN 7781 · Blue Dart',
      status: 'requested', requestedBy: 'mk', approvals: [], createdAt: hours(-1), updatedAt: hours(-1) },
  ];
}

export function seed(): { [C in Coll]: Collections[C][] } {
  const users: User[] = [
    { _id: 'rv', name: 'R. Venkat', initials: 'RV', email: 'r.venkat@example.com', role: 'logistics', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
    { _id: 'mk', name: 'M. Krishnan', initials: 'MK', email: 'm.krishnan@example.com', role: 'storeManager', sites: ['ktec', 'isu'] },
    { _id: 'si', name: 'S. Iyer', initials: 'SI', email: 's.iyer@example.com', role: 'clerk', sites: ['ktec'] },
    { _id: 'dj', name: 'D. Joseph', initials: 'DJ', email: 'd.joseph@example.com', role: 'clerk', sites: ['ktec'] },
    { _id: 'lp', name: 'L. Pillai', initials: 'LP', email: 'l.pillai@example.com', role: 'clerk', sites: ['ktec', 'isu'] },
    { _id: 'pr', name: 'P. Raman', initials: 'PR', email: 'p.raman@example.com', role: 'engineer', sites: ['ktec', 'isu'] },
    { _id: 'ak', name: 'A. Khan', initials: 'AK', email: 'a.khan@example.com', role: 'ehs', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
    { _id: 'mr', name: 'M. Rao', initials: 'MR', email: 'm.rao@example.com', role: 'finance', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
    { _id: 'kn', name: 'K. Nair', initials: 'KN', email: 'k.nair@example.com', role: 'leadership', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
    { _id: 'tm', name: 'T. Menon', initials: 'TM', email: 't.menon@example.com', role: 'admin', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
  ].map(u => stamp(u as User));

  const parts: Part[] = PARTS.map(([partNo, rev, description, category, uom, hazard, exportClass, , , , project]) =>
    stamp({ _id: partNo, partNo, rev, description, category, uom, hazard, exportClass, project, unitCost: COST[partNo] ?? 1000, weightKg: WEIGHT[partNo] ?? 1 }));

  // Every site has the modelled electronics store (4 rows × 12 bays × 4 levels) and the named areas.
  const locations: Location[] = [];
  const stockLots: StockLot[] = [];
  SITES.forEach((site, si) => {
    for (let r = 0; r < ROWS.length; r++) for (let i = 0; i < BAYS; i++) for (let k = 0; k < LEVELS; k++) {
      const b: Bin = { r, i, k }, code = binId(b);
      locations.push(stamp({ _id: `${site.id}:${code}`, site: site.id, store: 'electronics', code, zone: 'ESD', rack: r, bay: i, level: k, capacity: 60 }));
      // The primary site fills every bin; the others about two in three.
      if (si > 0 && rnd(r + si * 7, i, k) > .66) continue;
      const { part } = si === 0 ? partInBin(b) : partInBin({ r: (r + si) % 4, i: (i + si * 3) % BAYS, k });
      const featured = si === 0 && code === binId(FEATURED_BIN);
      const qty = featured ? 12 : 2 + Math.floor(rnd(r + si, i + 3, k) * 38);
      const reserved = featured ? 4 : si === 0 && isReserved(b) ? Math.min(qty, 6) : 0;
      stockLots.push(stamp({
        _id: `${site.id}:${code}:L1`, site: site.id, partNo: part[0], locationId: `${site.id}:${code}`, lot: `26-${String(9 + (i % 3)).padStart(2, '0')}${String(10 + r * 4 + k).padStart(2, '0')}-${'ABCD'[k]}`,
        qty, reserved, status: reserved >= qty ? 'Reserved' : 'Available', project: part[10], receivedAt: days(-Math.floor(rnd(r, i, k + 2) * 200)),
      }));
    }
    for (const [code, zone] of AREAS) locations.push(stamp({ _id: `${site.id}:${code}`, site: site.id, store: 'areas', code, zone, capacity: 500 }));
  });
  // Parts the sample data places in named areas, with their own status.
  PARTS.forEach(([partNo, , , , , , , onHand, reserved, where, project, status]) => {
    const [code, city] = where.split(' · ');
    if (/^[A-D]-\d\d-\d\d$/.test(code)) return;
    const site = AREA_SITE[code] ?? SITE_OF[city] ?? 'ktec';
    stockLots.push(stamp({ _id: `${site}:${code}:${partNo}`, site, partNo, locationId: `${site}:${code}`, lot: `26-AREA-${partNo.slice(3, 6)}`, qty: onHand, reserved, status, project, receivedAt: days(-40) }));
  });

  // The count-variance bin holds the 40 IoT gateway boards the system expects.
  const exc = stockLots.find(l => l._id === 'ktec:C-10-04:L1');
  if (exc) Object.assign(exc, { partNo: 'KM-PCB-IOT-022', qty: 40, reserved: 0, status: 'Available', project: '24/7 Connected' });
  // Units tagged on open scrap cases are held (reserved) where they are.
  const brakes = stockLots.find(l => l.partNo === 'KM-SFT-BRK-090')!;
  Object.assign(brakes, { reserved: 6, status: 'Scrap pending' });
  const boards = stockLots.find(l => l.site === 'ktec' && l.partNo === 'KM-PCB-IOT-022' && l.qty >= 12 && l._id !== 'ktec:C-10-04:L1' && !l.reserved)!;
  boards.reserved = 12;

  const movements: Movement[] = [
    stamp({ _id: 'MR-26-1180', site: 'ktec', type: 'putaway', partNo: 'KM-DX-ACT-220', qty: 20, to: 'ktec:D-05-04', ref: 'PO 4500182', reason: 'Planned inbound · PO 4500182', due: days(3), status: 'requested', requestedBy: 'mk', approvals: [] }),
    stamp({ _id: 'MR-26-1181', site: 'ktec', type: 'count', partNo: 'KM-PCB-IOT-022', qty: 40, counted: 36, from: 'ktec:C-10-04', reason: 'Cycle count variance · recount today', status: 'requested', requestedBy: 'si', approvals: [{ role: 'storeManager', decision: 'pending' }] }),
    stamp({ _id: 'MR-26-1182', site: 'ktec', type: 'issue', partNo: 'KM-DX-ACT-220', qty: 4, from: 'ktec:D-05-04', to: 'ktec:Lab L-03', ref: 'DX Class 2027', reason: 'Issue to lab · 20 Oct', status: 'approved', requestedBy: 'pr', approvals: [{ role: 'storeManager', user: 'mk', decision: 'approved', at: days(0) }] }),
    ...liveTasks(stockLots),
    stamp({ _id: 'MR-26-1183', site: 'isu', type: 'transfer', partNo: 'KM-MOT-PM-150', qty: 1, from: 'isu:Heavy L0', to: 'isu:Test tower', reason: 'Tower test · 2 drives', status: 'done', requestedBy: 'pr', approvals: [{ role: 'storeManager', user: 'mk', decision: 'approved', at: days(-1) }] }),
  ];

  movements.push(...history(stockLots));

  const scrapCases: ScrapCase[] = [
    stamp({ _id: 'SC-2026-0418', site: 'isu', partNo: 'KM-SFT-BRK-090', qty: 6, value: 428000, reason: 'Destructive test · not reusable', detail: 'Consumed in test campaign TC-114 drop test', step: 'approval', photos: [], owner: 'pr', lotId: brakes._id,
      history: [{ at: days(-2), user: 'pr', step: 'tag', note: 'Tagged 6 after TC-114' }, { at: days(-1), user: 'pr', step: 'reason', note: 'Destructive test · sent for approval' }],
      approvals: [{ role: 'engineer', user: 'pr', decision: 'approved', at: days(-1) }, { role: 'ehs', decision: 'pending' }, { role: 'finance', decision: 'pending' }] }),
    stamp({ _id: 'SC-2026-0421', site: 'ktec', partNo: 'KM-PCB-IOT-022', qty: 12, value: 98400, reason: 'E-waste · failed burn-in', detail: 'Boards failed 72 h burn-in on Floor 3 lab', step: 'reason', photos: [], owner: 'pr', approvals: [], lotId: boards._id,
      history: [{ at: days(0), user: 'pr', step: 'tag', note: `Tagged 12 in ${boards.locationId.split(':')[1]}` }] }),
  ];

  const MS = ['Booked', 'Picked up', 'In transit', 'Out for delivery', 'Delivered'];
  const reached: Record<string, number> = { 'E-way bill hold': 2, 'In transit': 2, 'Out for delivery': 3, 'Delay risk': 2 };
  const shipments: Shipment[] = SHIPS.map((s, n) => {
    const upto = reached[s.status] ?? 2;
    const milestones: Milestone[] = MS.map((label, i) => ({ label, done: i <= upto, at: i <= upto ? days(i - upto - 1) : undefined }));
    const part = PARTS[(n * 5) % PARTS.length];
    return stamp({
      etaAt: days(1 + (n % 3)), pickupAt: days(-1 - (n % 2)), eta: `ETA ${new Date(days(1 + (n % 3))).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
      _id: s.id, site: s.from, carrier: s.carrier, mode: /Blue Dart|DHL/.test(s.carrier) ? 'air' as const : 'road' as const, from: s.from, to: s.to, status: s.status, dir: s.dir,
      items: [{ partNo: part[0], qty: 2 + (n % 4) * 3 }], milestones, docs: ['Invoice', 'E-way bill', ...(upto >= 4 ? ['POD'] : [])], hold: s.hold,
    });
  });

  const carriers: Carrier[] = [
    ['Delhivery', ['road'], 'ops@delhivery.example'], ['Blue Dart', ['air', 'courier'], 'cargo@bluedart.example'], ['Gati', ['road'], 'desk@gati.example'],
    ['DTDC', ['courier'], 'b2b@dtdc.example'], ['TCI Freight', ['road'], 'south@tcifreight.example'], ['Safexpress', ['road'], 'chennai@safexpress.example'],
    ['DHL', ['air', 'road'], 'kone@dhl.example'], ['CONCOR', ['rail'], 'chennai@concor.example'],
  ].map(([name, modes, contact]) => stamp({ _id: (name as string).toLowerCase().replace(/\W+/g, '-'), name: name as string, modes: modes as Carrier['modes'], contact: contact as string }));

  const approvalRules: ApprovalRule[] = [
    stamp({ _id: 'scrap-high', kind: 'scrap', minValue: 200000, chain: ['engineer', 'ehs', 'finance'], note: 'Scrap over ₹2,00,000: lab owner, EHS, finance controller' }),
    stamp({ _id: 'scrap', kind: 'scrap', minValue: 0, chain: ['engineer', 'ehs'], note: 'Scrap up to ₹2,00,000: lab owner, EHS' }),
    stamp({ _id: 'move', kind: 'move', minValue: 0, chain: ['storeManager'], note: 'Moves between stores: store manager' }),
    stamp({ _id: 'shipment-hazmat', kind: 'shipment', minValue: 0, chain: ['ehs'], note: 'Shipments with hazmat: EHS' }),
  ];

  const alerts: Alert[] = SITES.flatMap(site => site.alerts.map(([title, detail, col], i) => stamp({
    _id: `${site.id}-${i + 1}`, site: site.id, title, detail, severity: col === '#C8312B' ? 'high' as const : col === '#C77700' ? 'medium' as const : 'info' as const, status: 'open' as const, at: days(0),
  })));

  const purposes: Purpose[] = [
    ['issue-lab', 'Issue to lab', 'issue', 'CC-KTEC-RD'], ['issue-build', 'Issue to project build', 'issue', 'CC-KTEC-PRJ'], ['pick-ship', 'Pick for shipment', 'pick', 'CC-LOG'],
    ['sample', 'Engineering sample', 'pick', 'CC-KTEC-RD'], ['reslot', 'Re-slot for faster picking', 'move', 'CC-STORES'], ['consolidate', 'Consolidate part-full bins', 'move', 'CC-STORES'],
    ['room', 'Make room for planned inbound', 'move', 'CC-STORES'], ['tower', 'Tower test', 'transfer', 'CC-ISU-TEST'],
  ].map(([_id, name, kind, costCentre]) => stamp({ _id, name, kind: kind as Purpose['kind'], costCentre, active: true }));
  const areaTemplates: AreaTemplate[] = [
    stamp({ _id: 'esd-store', name: 'Electronics store · ESD', zone: 'ESD', racks: 4, bays: 12, levels: 4, binCapacity: 60, note: 'Shelving with ESD bins, grounded floor' }),
    stamp({ _id: 'hazmat-cab', name: 'Hazmat cabinet', zone: 'Hazmat', racks: 1, bays: 2, levels: 3, binCapacity: 40, note: 'Li-ion and flammables, ventilated, 25 °C limit' }),
    stamp({ _id: 'heavy-floor', name: 'Heavy floor storage', zone: 'Heavy', racks: 2, bays: 6, levels: 1, binCapacity: 4, note: 'Gearboxes and motors on pallets, forklift aisle' }),
    stamp({ _id: 'quarantine', name: 'Quarantine cage', zone: 'Quarantine', racks: 1, bays: 4, levels: 2, binCapacity: 30, note: 'Locked; QA release required' }),
  ];
  const costCentres: CostCentre[] = [
    ['CC-KTEC-RD', 'KTEC R&D labs', 'ktec', 'pr'], ['CC-KTEC-PRJ', 'KTEC project builds', 'ktec', 'pr'], ['CC-STORES', 'Stores operations', 'ktec', 'mk'],
    ['CC-LOG', 'Logistics', 'ktec', 'rv'], ['CC-ISU-TEST', 'ISU test tower', 'isu', 'pr'], ['CC-ISU-PROD', 'ISU production', 'isu', 'mk'],
  ].map(([code, name, site, owner]) => stamp({ _id: code, code, name, site, owner }));

  const sense = sensors(T0, { users, movements, shipments, stockLots }, rng(7));
  alerts.push(...sense.alerts);
  return { users, parts, locations, stockLots, movements, scrapCases, shipments, carriers, approvalRules, alerts, auditLog: [], purposes, areaTemplates, costCentres, events: sense.events, cameras: sense.cameras, trackers: sense.trackers };
}
