// What is waiting for the signed-in user, worked out from the data rather than stored, so it is
// always current: approvals that are theirs to give, count variances, scrap steps their role
// performs, dangerous goods for EHS, shipments on hold, and put-aways waiting at their sites.
import type { Movement, ScrapCase, Shipment, User } from '../db/schema';
import { canAct, nextApproval as scrapNext } from './scrap';

export type TaskKind = 'move' | 'count' | 'scrap' | 'ehs' | 'hold' | 'putaway' | 'delay';
export interface Task { kind: TaskKind; id: string; site: string; title: string; detail: string; urgent: boolean }

export function tasksFor(user: User | null, d: { movements: Movement[]; scrapCases: ScrapCase[]; shipments: Shipment[] }): Task[] {
  if (!user) return [];
  const mine = (site: string) => user.sites.includes(site) || user.role === 'admin';
  const role = user.role, out: Task[] = [];
  for (const m of d.movements) {
    if (!mine(m.site) || m.status !== 'requested') continue;
    const next = m.approvals.find(a => a.decision === 'pending');
    if (m.type === 'move' && next && (next.role === role || role === 'admin'))
      out.push({ kind: 'move', id: m._id, site: m.site, title: `Approve move ${m._id}`, detail: `${m.qty} × ${m.partNo} · ${m.from?.split(':')[1]} → ${m.to?.split(':')[1]}`, urgent: false });
    if (m.type === 'count' && (role === 'storeManager' || role === 'admin'))
      out.push({ kind: 'count', id: m._id, site: m.site, title: `Count variance ${m.from?.split(':')[1]}`, detail: `${m.partNo} · system ${m.qty}, counted ${m.counted}`, urgent: true });
  }
  if (role === 'clerk' || role === 'storeManager' || role === 'admin') {
    for (const m of d.movements) if (mine(m.site) && m.type === 'move' && m.status === 'approved')
      out.push({ kind: 'move', id: m._id, site: m.site, title: `Make move ${m._id}`, detail: `${m.qty} × ${m.partNo} · ${m.from?.split(':')[1]} → ${m.to?.split(':')[1]} · approved`, urgent: false });
    const bySite = new Map<string, Movement[]>();
    for (const m of d.movements) if (mine(m.site) && m.type === 'putaway' && m.status === 'requested') bySite.set(m.site, [...(bySite.get(m.site) ?? []), m]);
    for (const [site, list] of bySite) {
      const overdue = list.some(m => m.due && Date.parse(m.due) < Date.now());
      out.push({ kind: 'putaway', id: list[0]._id, site, title: `${list.length} put-away task${list.length > 1 ? 's' : ''}`, detail: list.map(m => `${m.qty} × ${m.partNo}`).slice(0, 3).join(', '), urgent: overdue });
    }
  }
  for (const c of d.scrapCases) {
    if (!mine(c.site) || c.step === 'closed') continue;
    const approving = c.step === 'approval' && !!scrapNext(c, user);
    if (approving || (c.step !== 'approval' && canAct(c, user)))
      out.push({ kind: 'scrap', id: c._id, site: c.site, title: approving ? `Approve scrap ${c._id}` : `Scrap ${c._id} · ${c.step === 'reason' ? 'give the reason' : c.step === 'move' ? 'move to scrap yard' : c.step === 'dispose' ? 'record disposal' : 'post write-off'}`,
        detail: `${c.qty} × ${c.partNo} · ₹${c.value.toLocaleString('en-IN')}`, urgent: approving && c.value > 200000 });
  }
  for (const s of d.shipments) {
    if (!mine(s.from) && !mine(s.to)) continue;
    if (s.status === 'Awaiting EHS approval' && (role === 'ehs' || role === 'admin'))
      out.push({ kind: 'ehs', id: s._id, site: s.from, title: `Dangerous goods · ${s._id}`, detail: `${s.carrier} · ${s.items.map(i => `${i.qty} × ${i.partNo}`).join(', ')}`, urgent: true });
    if (['logistics', 'storeManager', 'admin'].includes(role)) {
      if (s.status === 'E-way bill hold') out.push({ kind: 'hold', id: s._id, site: s.from, title: `E-way bill hold · ${s._id}`, detail: `${s.carrier} · clear the hold to release it`, urgent: true });
      if (s.status === 'Delay risk') out.push({ kind: 'delay', id: s._id, site: s.to, title: `Delay risk · ${s._id}`, detail: `${s.carrier} · ${s.eta}`, urgent: false });
    }
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
}
