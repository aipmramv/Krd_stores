// Seed documents for the demo database and for `npm run seed` on the server, built from the
// sample data so the 3D twins, the drawers and the data store all tell the same story.
import { PARTS, SHIPS } from '../data/sample';
import { SITES } from '../data/sites';
import { BAYS, binId, FEATURED_BIN, isReserved, LEVELS, partInBin, rnd, ROWS } from '../data/storeModel';
import type { Bin } from '../data/types';
import type { Alert, ApprovalRule, Carrier, Coll, Collections, Location, Milestone, Movement, Part, ScrapCase, Shipment, StockLot, User, Zone } from './schema';

const T0 = '2026-10-18T09:00:00.000Z';
const stamp = <T extends object>(d: T) => ({ ...d, createdAt: T0, updatedAt: T0 });
const days = (n: number) => new Date(Date.parse(T0) + n * 86400000).toISOString();

/** Unit cost in ₹ per unit of measure. */
const COST: Record<string, number> = {
  'KM-DX-ACT-220': 18500, 'KM-MS-CTL-118': 42000, 'KM-ESC-DRV-040': 210000, 'KM-BAT-LI-500': 65000,
  'KM-SNS-LDR-077': 28000, 'KM-RPE-HSR-210': 1800, 'KM-GUI-RAL-016': 9500, 'KM-CAB-PNL-301': 75000,
  'KM-LUB-SYN-005': 1200, 'KM-MOT-PM-150': 340000, 'KM-PCB-IOT-022': 8200, 'KM-SFT-BRK-090': 71333,
};

const AREAS: [string, Zone][] = [['Hazmat H-01', 'Hazmat'], ['Hazmat H-02', 'Hazmat'], ['Quarantine Q-01', 'Quarantine'], ['Heavy L0', 'Heavy'],
  ['Lab L-03', 'Lab'], ['Test tower', 'Test'], ['Scrap yard', 'Yard'], ['Yard Y-02', 'Yard']];

const SITE_OF: Record<string, string> = { Chennai: 'ktec', Pune: 'pnq' };

export function seed(): { [C in Coll]: Collections[C][] } {
  const users: User[] = [
    { _id: 'rv', name: 'R. Venkat', initials: 'RV', email: 'r.venkat@example.com', role: 'logistics', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
    { _id: 'mk', name: 'M. Krishnan', initials: 'MK', email: 'm.krishnan@example.com', role: 'storeManager', sites: ['ktec', 'isu'] },
    { _id: 'si', name: 'S. Iyer', initials: 'SI', email: 's.iyer@example.com', role: 'clerk', sites: ['ktec'] },
    { _id: 'pr', name: 'P. Raman', initials: 'PR', email: 'p.raman@example.com', role: 'engineer', sites: ['ktec', 'isu'] },
    { _id: 'ak', name: 'A. Khan', initials: 'AK', email: 'a.khan@example.com', role: 'ehs', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
    { _id: 'mr', name: 'M. Rao', initials: 'MR', email: 'm.rao@example.com', role: 'finance', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
    { _id: 'kn', name: 'K. Nair', initials: 'KN', email: 'k.nair@example.com', role: 'leadership', sites: ['ktec', 'isu', 'dhl', 'pnq'] },
  ].map(u => stamp(u as User));

  const parts: Part[] = PARTS.map(([partNo, rev, description, category, uom, hazard, exportClass, , , , project]) =>
    stamp({ _id: partNo, partNo, rev, description, category, uom, hazard, exportClass, project, unitCost: COST[partNo] ?? 1000 }));

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
    const site = SITE_OF[city] ?? 'ktec';
    stockLots.push(stamp({ _id: `${site}:${code}:${partNo}`, site, partNo, locationId: `${site}:${code}`, lot: `26-AREA-${partNo.slice(3, 6)}`, qty: onHand, reserved, status, project, receivedAt: days(-40) }));
  });

  const movements: Movement[] = [
    stamp({ _id: 'MR-26-1180', site: 'ktec', type: 'putaway', partNo: 'KM-DX-ACT-220', qty: 20, to: 'ktec:D-05-04', ref: 'PO 4500182', reason: 'Planned inbound · 21 Oct', status: 'requested', requestedBy: 'mk', approvals: [] }),
    stamp({ _id: 'MR-26-1181', site: 'ktec', type: 'count', partNo: 'KM-PCB-IOT-022', qty: 40, counted: 36, from: 'ktec:C-10-04', reason: 'Cycle count variance · recount today', status: 'requested', requestedBy: 'si', approvals: [{ role: 'storeManager', decision: 'pending' }] }),
    stamp({ _id: 'MR-26-1182', site: 'ktec', type: 'issue', partNo: 'KM-DX-ACT-220', qty: 4, from: 'ktec:D-05-04', to: 'ktec:Lab L-03', ref: 'DX Class 2027', reason: 'Issue to lab · 20 Oct', status: 'approved', requestedBy: 'pr', approvals: [{ role: 'storeManager', user: 'mk', decision: 'approved', at: days(0) }] }),
    stamp({ _id: 'MR-26-1183', site: 'isu', type: 'transfer', partNo: 'KM-MOT-PM-150', qty: 1, from: 'isu:Heavy L0', to: 'isu:Test tower', reason: 'Tower test · 2 drives', status: 'done', requestedBy: 'pr', approvals: [{ role: 'storeManager', user: 'mk', decision: 'approved', at: days(-1) }] }),
  ];

  const scrapCases: ScrapCase[] = [
    stamp({ _id: 'SC-2026-0418', site: 'isu', partNo: 'KM-SFT-BRK-090', qty: 6, value: 428000, reason: 'Destructive test · not reusable', detail: 'Consumed in test campaign TC-114 drop test', step: 'approval', photos: [], owner: 'pr', disposal: 'Recycle · authorised metals vendor',
      approvals: [{ role: 'engineer', user: 'pr', decision: 'approved', at: days(-1) }, { role: 'ehs', decision: 'pending' }, { role: 'finance', decision: 'pending' }] }),
    stamp({ _id: 'SC-2026-0421', site: 'ktec', partNo: 'KM-PCB-IOT-022', qty: 12, value: 98400, reason: 'E-waste · failed burn-in', detail: 'Boards failed 72 h burn-in on Floor 3 lab', step: 'tag', photos: [], owner: 'pr', approvals: [] }),
  ];

  const MS = ['Booked', 'Picked up', 'In transit', 'Out for delivery', 'Delivered'];
  const reached: Record<string, number> = { 'E-way bill hold': 2, 'In transit': 2, 'Out for delivery': 3, 'Delay risk': 2 };
  const shipments: Shipment[] = SHIPS.map((s, n) => {
    const upto = reached[s.status] ?? 2;
    const milestones: Milestone[] = MS.map((label, i) => ({ label, done: i <= upto, at: i <= upto ? days(i - upto - 1) : undefined }));
    const part = PARTS[(n * 5) % PARTS.length];
    return stamp({
      _id: s.id, site: s.from, carrier: s.carrier, mode: /Blue Dart|DHL/.test(s.carrier) ? 'air' as const : 'road' as const, from: s.from, to: s.to, eta: s.eta, status: s.status, dir: s.dir,
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

  return { users, parts, locations, stockLots, movements, scrapCases, shipments, carriers, approvalRules, alerts, auditLog: [] };
}
