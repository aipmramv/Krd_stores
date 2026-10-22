// Search across the data store for the Ctrl K palette: parts, bins and lots, shipments (AWB),
// requests and POs, scrap cases, people and sites. Uses the same MongoDB-style regex queries
// against the demo database or the server.
import { SITES } from '../data/sites';
import { db } from '../db';

export type Target =
  | { kind: 'part'; partNo: string } | { kind: 'bin'; site: string; code: string } | { kind: 'ship'; id: string; site: string }
  | { kind: 'move'; id: string; site: string; type: string } | { kind: 'scrap'; id: string; site: string } | { kind: 'site'; site: string } | { kind: 'user'; id: string };
export interface Hit { group: string; title: string; sub: string; hint: string; target: Target }

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function searchAll(q: string, limit = 5): Promise<Hit[]> {
  const t = q.trim();
  if (t.length < 2) return [];
  const re = { $regex: esc(t), $options: 'i' };
  const [parts, bins, lots, ships, moves, cases, users] = await Promise.all([
    db.find('parts', { $or: [{ partNo: re }, { description: re }, { project: re }] }, { limit }),
    db.find('locations', { code: re }, { limit }),
    db.find('stockLots', { lot: re }, { limit }),
    db.find('shipments', { $or: [{ _id: re }, { carrier: re }] }, { limit }),
    db.find('movements', { $or: [{ _id: re }, { ref: re }] }, { limit, sort: { createdAt: -1 } }),
    db.find('scrapCases', { $or: [{ _id: re }, { reason: re }, { partNo: re }] }, { limit }),
    db.find('users', { $or: [{ name: re }, { email: re }] }, { limit }),
  ]);
  const site = (id: string) => SITES.find(s => s.id === id)?.short ?? id;
  const hits: Hit[] = [
    ...parts.map(p => ({ group: 'Parts', title: `${p.partNo} rev ${p.rev} · ${p.description}`, sub: `${p.category} · ${p.project}${p.hazard !== '—' ? ` · ${p.hazard}` : ''}`, hint: 'Open', target: { kind: 'part' as const, partNo: p.partNo } })),
    ...bins.map(b => ({ group: 'Bins and lots', title: `${b.store === 'electronics' ? 'Bin' : 'Area'} ${b.code}`, sub: `${site(b.site)} · ${b.zone}`, hint: 'Fly to', target: { kind: 'bin' as const, site: b.site, code: b.code } })),
    ...lots.map(l => ({ group: 'Bins and lots', title: `Lot ${l.lot} · ${l.partNo}`, sub: `${l.qty} in ${l.locationId.split(':')[1]} · ${site(l.site)}`, hint: 'Fly to', target: { kind: 'bin' as const, site: l.site, code: l.locationId.split(':')[1] } })),
    ...ships.map(s => ({ group: 'Shipments', title: `${s._id} · ${s.carrier}`, sub: `${site(s.from)} → ${site(s.to)} · ${s.status} · ${s.eta}`, hint: 'Track', target: { kind: 'ship' as const, id: s._id, site: s.from } })),
    ...moves.map(m => ({ group: 'Requests and POs', title: `${m.ref ?? m._id} · ${m.type}`, sub: `${m.qty} × ${m.partNo} · ${site(m.site)} · ${m.status}`, hint: 'Open', target: { kind: 'move' as const, id: m._id, site: m.site, type: m.type } })),
    ...cases.map(c => ({ group: 'Scrap cases', title: `${c._id} · ${c.qty} × ${c.partNo}`, sub: `${site(c.site)} · ${c.reason || 'reason pending'} · ₹${c.value.toLocaleString('en-IN')}`, hint: 'Open', target: { kind: 'scrap' as const, id: c._id, site: c.site } })),
    ...users.map(u => ({ group: 'People', title: u.name, sub: `${u.email} · ${u.sites.map(site).join(', ')}`, hint: 'Open', target: { kind: 'user' as const, id: u._id } })),
    ...SITES.filter(s => new RegExp(esc(t), 'i').test(s.name + s.address)).map(s => ({ group: 'Sites', title: s.name, sub: s.address, hint: 'Fly to', target: { kind: 'site' as const, site: s.id } })),
  ];
  // A lot found by number and its bin found by code are the same place; keep one.
  const seen = new Set<string>();
  return hits.filter(h => { const k = h.group + JSON.stringify(h.target); if (seen.has(k)) return false; seen.add(k); return true; });
}
