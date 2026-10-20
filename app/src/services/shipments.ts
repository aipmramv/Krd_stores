// Shipments between KONE sites:
//   quote    options for a lane and a load (road, rail, air, courier, the KONE shuttle), with cost,
//            ETA and CO₂e; options that can't carry the load (Li-ion by courier) say why
//   book     allocates stock first-in first-out (held at the source), raises the documents and,
//            for hazmat, waits for EHS before it counts as booked
//   advance  carrier milestones: pick-up takes the stock out of the source site, delivery receives
//            it into inbound staging at the destination with put-away tasks for the store
//   plus holds, receiver notification, claims and cancellation before pick-up
import { db } from '../db';
import type { Allocation, Claim, Milestone, Part, Shipment, User } from '../db/schema';
import { SITE_BY_ID } from '../data/sites';
import { available } from './moves';

export interface Line { partNo: string; qty: number }
export interface Option {
  id: string; mode: string; carrier: string; kind: Shipment['mode']; hours: number; eta: string;
  cost: number; co2: number; tag?: 'Recommended' | 'Fastest' | 'Lowest CO₂'; allowed: boolean; why?: string;
}

export const MILESTONES = ['Booked', 'Picked up', 'In transit', 'Out for delivery', 'Delivered'] as const;
const HAZ = /UN\d/;
const R = 6371;
export function distanceKm(a: string, b: string) {
  const [la1, lo1] = SITE_BY_ID[a].ll, [la2, lo2] = SITE_BY_ID[b].ll, rad = Math.PI / 180;
  const h = Math.sin((la2 - la1) * rad / 2) ** 2 + Math.cos(la1 * rad) * Math.cos(la2 * rad) * Math.sin((lo2 - lo1) * rad / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.25; // road distance ≈ 1.25 × straight line
}
const days = (h: number) => (h < 30 ? `${Math.round(h)} h` : `${(h / 24).toFixed(h % 24 ? 1 : 0).replace('.0', '')} days`);

export function weight(lines: Line[], parts: Map<string, Part>) {
  return lines.reduce((w, l) => w + l.qty * (parts.get(l.partNo)?.weightKg ?? 1), 0);
}

/** Shipping options for a lane and load, cheapest allowed first, with Recommended/Fastest/Lowest CO₂ tags. */
export function quote(from: string, to: string, lines: Line[], parts: Map<string, Part>): Option[] {
  const km = distanceKm(from, to), w = Math.max(1, weight(lines, parts)), t = w / 1000;
  const hazmat = lines.some(l => HAZ.test(parts.get(l.partNo)?.hazard ?? ''));
  const o: Option[] = km > 400 ? [
    { id: 'ftl', mode: 'Road · full truckload', carrier: 'Delhivery', kind: 'road', hours: km / 38 + 6, eta: '', cost: 3200 + km * 27, co2: km * .00045, allowed: w <= 9000 },
    { id: 'rail', mode: 'Rail container', carrier: 'CONCOR', kind: 'rail', hours: km / 18 + 30, eta: '', cost: 9500 + km * 10, co2: t * km * .00005, allowed: w <= 20000 },
    { id: 'air', mode: 'Air cargo', carrier: 'Blue Dart', kind: 'air', hours: 22, eta: '', cost: Math.max(9500, w * 46.7), co2: t * km * .00055, allowed: w <= 3000 },
    { id: 'courier', mode: 'Express courier', carrier: 'DTDC', kind: 'courier', hours: 36, eta: '', cost: Math.max(1200, w * 85), co2: t * km * .00026, allowed: w <= 500 && !hazmat },
  ] : [
    { id: 'shuttle', mode: 'KONE shuttle · daily 15:00', carrier: 'Safexpress', kind: 'road', hours: 6, eta: '', cost: 1200, co2: km * .0003, allowed: w <= 1500 },
    { id: 'ptl', mode: 'Road · part truckload', carrier: 'Gati', kind: 'road', hours: 8, eta: '', cost: 3500 + km * 28, co2: km * .00035, allowed: w <= 9000 },
    { id: 'courier', mode: 'Express courier', carrier: 'DTDC', kind: 'courier', hours: 20, eta: '', cost: Math.max(800, w * 60), co2: t * km * .00026, allowed: w <= 500 && !hazmat },
  ];
  for (const x of o) {
    x.eta = days(x.hours);
    x.cost = Math.round(x.cost / 100) * 100;
    x.co2 = Math.max(.01, x.co2);
    if (!x.allowed) x.why = x.kind === 'courier' && hazmat ? 'Li-ion (UN3480) cannot travel by courier' : `Over the ${x.mode.toLowerCase()} weight limit`;
    else if (hazmat && x.kind === 'air') x.why = 'Dangerous-goods declaration and EHS approval needed';
  }
  const ok = o.filter(x => x.allowed);
  const by = (f: (x: Option) => number) => ok.reduce<Option | undefined>((m, x) => (!m || f(x) < f(m) ? x : m), undefined);
  const fast = by(x => x.hours), green = by(x => x.co2), cheap = by(x => x.cost + x.hours * 150);
  if (cheap) cheap.tag = 'Recommended';
  if (fast && !fast.tag) fast.tag = 'Fastest';
  if (green && !green.tag) green.tag = 'Lowest CO₂';
  return [...ok.sort((a, b) => a.cost - b.cost), ...o.filter(x => !x.allowed)];
}

const PREFIX: Record<string, string> = { Delhivery: 'DEL', CONCOR: 'CCR', 'Blue Dart': 'BD', DTDC: 'DTDC', Safexpress: 'SFX', Gati: 'GATI' };
const digits = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');

async function who(id: string) { const u = await db.get('users', id); if (!u) throw new Error('Unknown user'); return u; }
async function load(id: string) { const s = await db.get('shipments', id); if (!s) throw new Error('Shipment not found'); return s; }
const LOGISTICS = ['logistics', 'storeManager', 'clerk', 'admin'];
export const canHandle = (u: User | null) => !!u && LOGISTICS.includes(u.role);

/** Allocate lines to the source site's free stock, oldest lots first. */
async function allocate(site: string, lines: Line[]): Promise<Allocation[]> {
  const out: Allocation[] = [];
  for (const l of lines) {
    let need = l.qty;
    const lots = (await db.find('stockLots', { site, partNo: l.partNo, status: { $in: ['Available', 'Reserved'] } }, { sort: { receivedAt: 1 } }))
      .filter(x => !x.locationId.endsWith(':Scrap yard'));
    for (const lot of lots) {
      if (!need) break;
      const take = Math.min(need, await available(lot));
      if (take > 0) { out.push({ lotId: lot._id, partNo: l.partNo, qty: take }); need -= take; }
    }
    if (need) throw new Error(`Not enough free ${l.partNo} at ${SITE_BY_ID[site].short}: short by ${need}`);
  }
  return out;
}

export async function book(input: { from: string; to: string; lines: Line[]; optionId: string }, userId: string): Promise<Shipment> {
  const user = await who(userId);
  if (!canHandle(user)) throw new Error('Only logistics and store staff can book shipments');
  if (input.from === input.to) throw new Error('Choose two different sites');
  const lines = input.lines.filter(l => l.qty > 0);
  if (!lines.length) throw new Error('Add at least one item');
  const parts = new Map((await db.find('parts')).map(p => [p._id, p]));
  const opt = quote(input.from, input.to, lines, parts).find(o => o.id === input.optionId);
  if (!opt) throw new Error('Choose a shipping option');
  if (!opt.allowed) throw new Error(opt.why ?? 'This option cannot carry the load');
  const alloc = await allocate(input.from, lines);
  for (const a of alloc) {
    const lot = (await db.get('stockLots', a.lotId))!;
    await db.update('stockLots', lot._id, { reserved: lot.reserved + a.qty });
  }
  const hazmat = lines.some(l => HAZ.test(parts.get(l.partNo)?.hazard ?? ''));
  const now = new Date(), pickup = new Date(now); pickup.setDate(now.getDate() + (now.getHours() < 12 ? 0 : 1)); pickup.setHours(15, 0, 0, 0);
  const etaAt = new Date(pickup.getTime() + opt.hours * 3600000);
  const ref = `${PREFIX[opt.carrier] ?? 'KON'} ${digits(4)} ${digits(4)}`;
  const milestones: Milestone[] = MILESTONES.map((label, i) => ({ label, done: i === 0 && !hazmat, at: i === 0 && !hazmat ? now.toISOString() : undefined }));
  const doc: Omit<Shipment, 'createdAt' | 'updatedAt'> = {
    _id: ref, ref, site: input.from, carrier: opt.carrier, mode: opt.kind, from: input.from, to: input.to,
    eta: `ETA ${etaAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, etaAt: etaAt.toISOString(), pickupAt: pickup.toISOString(),
    status: hazmat ? 'Awaiting EHS approval' : 'Booked', dir: 'out', items: lines, alloc, milestones, option: opt.mode, cost: opt.cost,
    co2: `${opt.co2.toFixed(2)} t`, weightKg: Math.round(weight(lines, parts)), hazmat, bookedBy: user._id,
    approvals: hazmat ? [{ role: 'ehs', decision: 'pending' }] : [],
    docs: ['Invoice', 'E-way bill', 'Packing list', ...(hazmat ? ['DG declaration'] : [])], claims: [],
  };
  return db.insert('shipments', doc);
}

export async function approveHazmat(id: string, userId: string, decision: 'approved' | 'rejected' = 'approved') {
  const [s, user] = await Promise.all([load(id), who(userId)]);
  if (s.status !== 'Awaiting EHS approval') throw new Error('Not waiting for EHS');
  if (user.role !== 'ehs' && user.role !== 'admin') throw new Error('Only EHS can approve dangerous goods');
  const at = new Date().toISOString();
  const approvals = (s.approvals ?? []).map(a => (a.decision === 'pending' ? { ...a, user: user._id, decision, at } : a));
  if (decision === 'rejected') { await release(s); return db.update('shipments', id, { approvals, status: 'Cancelled' }); }
  return db.update('shipments', id, { approvals, status: 'Booked', milestones: s.milestones.map((m, i) => (i === 0 ? { ...m, done: true, at } : m)) });
}

const current = (s: Shipment) => s.milestones.reduce((n, m, i) => (m.done ? i : n), -1);
export const nextMilestone = (s: Shipment) => (['Cancelled', 'Awaiting EHS approval', 'E-way bill hold', 'Delivered'].includes(s.status) ? null : s.milestones[current(s) + 1]?.label ?? null);

/** Record the next carrier milestone (in production these arrive from carrier APIs). */
export async function advance(id: string, userId: string) {
  const [s, user] = await Promise.all([load(id), who(userId)]);
  if (!canHandle(user)) throw new Error('Only logistics and store staff can update milestones');
  const next = nextMilestone(s);
  if (!next) throw new Error(s.status === 'E-way bill hold' ? 'Clear the hold first' : 'No further milestone');
  const at = new Date().toISOString();
  if (next === 'Picked up') {
    for (const a of s.alloc ?? []) {
      const lot = await db.get('stockLots', a.lotId);
      if (!lot) continue;
      if (lot.qty - a.qty <= 0) await db.remove('stockLots', lot._id);
      else await db.update('stockLots', lot._id, { qty: lot.qty - a.qty, reserved: Math.max(0, lot.reserved - a.qty) });
    }
  }
  const patch: Partial<Shipment> = { status: next, milestones: s.milestones.map(m => (m.label === next ? { ...m, done: true, at } : m)) };
  if (next === 'Delivered') {
    patch.docs = [...s.docs, 'POD'];
    // Received into inbound staging at the destination, each line with a put-away task.
    for (const l of s.items) {
      const part = await db.get('parts', l.partNo);
      const lot = await db.insert('stockLots', {
        site: s.to, partNo: l.partNo, locationId: `${s.to}:Inbound staging`, lot: `${s._id.replace(/\s+/g, '')}`.slice(-10), qty: l.qty, reserved: 0,
        status: 'Available', project: part?.project ?? '—', receivedAt: at,
      }, 'LOT');
      await db.insert('movements', { site: s.to, type: 'putaway', partNo: l.partNo, qty: l.qty, lotId: lot._id, from: lot.locationId, ref: s._id, reason: `Received from ${SITE_BY_ID[s.from].short}`, status: 'requested', requestedBy: user._id, approvals: [] }, 'PA');
    }
  }
  return db.update('shipments', id, patch);
}

export async function clearHold(id: string, userId: string, note: string) {
  const [s, user] = await Promise.all([load(id), who(userId)]);
  if (!canHandle(user)) throw new Error('Only logistics staff can clear a hold');
  if (s.status !== 'E-way bill hold') throw new Error('This shipment is not on hold');
  const i = current(s);
  return db.update('shipments', id, { status: 'In transit', hold: undefined, milestones: s.milestones.map((m, j) => (j === i ? { ...m, note: `Hold cleared · ${note || 'documents corrected'}` } : m)) });
}

export async function notifyReceiver(id: string, userId: string) {
  await who(userId);
  return db.update('shipments', id, { notifiedAt: new Date().toISOString() });
}

export async function raiseClaim(id: string, c: Pick<Claim, 'kind' | 'amount' | 'note'>, userId: string) {
  const [s, user] = await Promise.all([load(id), who(userId)]);
  if (!canHandle(user)) throw new Error('Only logistics staff can raise claims');
  if (!(c.amount > 0)) throw new Error('Enter the claim amount');
  return db.update('shipments', id, { claims: [...(s.claims ?? []), { ...c, at: new Date().toISOString(), by: user._id, status: 'Open' }] });
}

export async function cancelShipment(id: string, userId: string) {
  const [s, user] = await Promise.all([load(id), who(userId)]);
  if (!canHandle(user)) throw new Error('Only logistics staff can cancel');
  if (!['Booked', 'Awaiting EHS approval'].includes(s.status)) throw new Error('Only shipments not yet picked up can be cancelled');
  await release(s);
  return db.update('shipments', id, { status: 'Cancelled' });
}

async function release(s: Shipment) {
  for (const a of s.alloc ?? []) {
    const lot = await db.get('stockLots', a.lotId);
    if (lot) await db.update('stockLots', lot._id, { reserved: Math.max(0, lot.reserved - a.qty) });
  }
}

/** A printable document for a shipment (invoice, e-way bill, packing list, DG declaration, POD). */
export function documentHtml(s: Shipment, kind: string, parts: Map<string, Part>) {
  const A = SITE_BY_ID[s.from], B = SITE_BY_ID[s.to];
  const rows = s.items.map(l => { const p = parts.get(l.partNo); return `<tr><td>${l.partNo}</td><td>${p?.description ?? ''}</td><td>${p?.hazard ?? ''}</td><td class="n">${l.qty} ${p?.uom ?? ''}</td><td class="n">${((p?.weightKg ?? 0) * l.qty).toFixed(1)} kg</td><td class="n">₹${((p?.unitCost ?? 0) * l.qty).toLocaleString('en-IN')}</td></tr>`; }).join('');
  const total = s.items.reduce((n, l) => n + (parts.get(l.partNo)?.unitCost ?? 0) * l.qty, 0);
  return `<!doctype html><meta charset="utf-8"><title>${kind} · ${s._id}</title>
<style>body{font:14px system-ui,sans-serif;margin:32px;color:#141414}h1{font-size:20px;margin:0 0 4px}small{color:#4A4D55}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border-bottom:1px solid #DEE0E4;padding:6px 8px;text-align:left}.n{text-align:right}.g{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.b{border:1px solid #DEE0E4;padding:12px}.k{color:#1450F5;font-weight:700;letter-spacing:.2em}</style>
<div class="k">KONE</div><h1>${kind}</h1><small>${s._id} · ${s.carrier} · ${s.option ?? s.mode} · ${new Date(s.createdAt ?? Date.now()).toLocaleDateString('en-GB')}${db.kind === 'demo' ? ' · demo document' : ''}</small>
<div class="g"><div class="b"><b>Consignor</b><br>${A.name}<br><small>${A.address}</small></div><div class="b"><b>Consignee</b><br>${B.name}<br><small>${B.address}</small></div></div>
<table><tr><th>Part</th><th>Description</th><th>Hazard</th><th class="n">Qty</th><th class="n">Weight</th><th class="n">Value</th></tr>${rows}<tr><td colspan="5"><b>Total</b></td><td class="n"><b>₹${total.toLocaleString('en-IN')}</b></td></tr></table>
${kind === 'DG declaration' ? '<p>Lithium-ion batteries, UN3480, Class 9, packed per IATA PI 965 / ADR SP 188. State of charge ≤ 30 %. Emergency contact: KONE EHS desk.</p>' : ''}
${kind === 'POD' ? `<p>Delivered ${new Date(s.milestones.at(-1)?.at ?? Date.now()).toLocaleString('en-GB')} · received into inbound staging at ${B.short}.</p>` : ''}
<script>window.onload=()=>window.print()</script>`;
}

