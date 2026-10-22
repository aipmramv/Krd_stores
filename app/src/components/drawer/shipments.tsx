// Route planner (plan a shipment from stock, compare options, book, confirmation) and the
// shipment tracker (list, milestones, documents, receiver, claims, holds, cancellation).
import { useEffect, useMemo, useState } from 'react';
import { SITE_BY_ID, SITES } from '../../data/sites';
import { useDoc, useQuery } from '../../db/hooks';
import type { Part, Shipment } from '../../db/schema';
import { canHandle, nextMilestone, quote, weight } from '../../services/shipments';
import { asOfDate, shipmentAsOf } from '../../services/timeline';
import { TimeNotice } from '../TimeNotice';
import * as A from '../../state/actions';
import { useApp } from '../../state/store';
import { DrawerFrame } from './Frame';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const HAZ = /UN\d/;
const TAG_BG: Record<string, string> = { Recommended: '#AAE1C8', Fastest: '#D2F5FF', 'Lowest CO₂': '#EFF1F4' };

function Confirmation({ id }: { id: string }) {
  const s = useDoc('shipments', id).data;
  if (!s) return null;
  const held = s.status === 'Awaiting EHS approval';
  return (
    <DrawerFrame title="Route planner" foot={<>
      <button className="btn primary" onClick={() => { A.selectShip(s._id); A.go('shipments'); }}>Track shipment</button>
      <button className="btn" onClick={() => A.setPlan({})}>Plan another</button>
    </>}>
      <div className="dh">
        <span className="eb" style={{ color: held ? '#C77700' : '#1B7F4E' }}>{held ? 'Booked · waiting for EHS approval' : 'Booking confirmed'}</span>
        <h2>{s._id}</h2>
        <p>{s.carrier} · {s.option} · {SITE_BY_ID[s.from].short} → {SITE_BY_ID[s.to].short}</p>
      </div>
      <div className="kv">
        <div><span>Pick-up</span><b>{when(s.pickupAt)}</b></div>
        <div><span>ETA</span><b>{when(s.etaAt)}</b></div>
        <div><span>Cost</span><span>{inr(s.cost ?? 0)}</span></div>
        <div><span>CO₂e</span><span>{s.co2}</span></div>
        <div><span>Weight</span><span>{s.weightKg} kg</span></div>
        <div><span>Stock</span><span>{s.alloc?.reduce((n, a) => n + a.qty, 0)} units held at {SITE_BY_ID[s.from].short} until pick-up</span></div>
      </div>
      <div className="st"><span className="eb ink">Documents</span></div>
      <div className="grid2" style={{ paddingTop: 0 }}>{s.docs.map(d => <button key={d} className="btn" onClick={() => void A.openShipDoc(s._id, d)}>{d}</button>)}</div>
    </DrawerFrame>
  );
}

export function RoutesDrawer() {
  const plan = useApp(s => s.plan), booked = useApp(s => s.booked), me = useDoc('users', useApp(s => s.user)).data;
  const parts = useQuery('parts', {}, { sort: { partNo: 1 } }).data;
  const lots = useQuery('stockLots', { site: plan.from }).data;
  const pmap = useMemo(() => new Map(parts.map(p => [p._id, p])), [parts]);
  const free = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lots) if (!l.locationId.endsWith(':Scrap yard') && l.status !== 'Quarantined') m.set(l.partNo, (m.get(l.partNo) ?? 0) + l.qty - l.reserved);
    return m;
  }, [lots]);
  const options = useMemo(() => (parts.length && plan.from !== plan.to ? quote(plan.from, plan.to, plan.lines, pmap) : []), [plan.from, plan.to, plan.lines, pmap, parts.length]);
  useEffect(() => { A.setPlanOptions(options.map(o => ({ id: o.id, mode: o.mode, eta: o.eta, cost: o.cost, kind: o.kind, tag: o.tag, allowed: o.allowed }))); }, [options]);
  if (booked) return <Confirmation id={booked} />;
  const sel = options.find(o => o.id === plan.option);
  const hazmat = plan.lines.some(l => HAZ.test(pmap.get(l.partNo)?.hazard ?? ''));
  const value = plan.lines.reduce((n, l) => n + (pmap.get(l.partNo)?.unitCost ?? 0) * l.qty, 0);
  const setLine = (i: number, patch: Partial<{ partNo: string; qty: number }>) => A.setPlan({ lines: plan.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const short = plan.lines.find(l => l.qty > (free.get(l.partNo) ?? 0));
  const mixed = hazmat && plan.lines.some(l => !HAZ.test(pmap.get(l.partNo)?.hazard ?? ''));
  return (
    <DrawerFrame title="Route planner" foot={<>
      <button className="btn primary" disabled={!sel?.allowed || !!short || !canHandle(me)} onClick={() => void A.bookPlan()}>Book {sel ? sel.mode.split(' · ')[0].toLowerCase() : 'option'}</button>
      <button className="btn" disabled={!mixed || !canHandle(me)} title={mixed ? 'Li-ion by road, the rest by the selected option' : 'Splits when some items are dangerous goods'} onClick={() => void A.splitPlan()}>Split shipment</button>
    </>}>
      <div className="dh">
        <span className="eb">Plan a shipment from stock</span>
        <div className="grid2" style={{ padding: '.75rem 0 0' }}>
          <label className="fld" style={{ padding: 0 }}><span>From</span><select value={plan.from} onChange={e => A.setPlan({ from: e.target.value })}>{SITES.map(s => <option key={s.id} value={s.id}>{s.short}</option>)}</select></label>
          <label className="fld" style={{ padding: 0 }}><span>To</span><select value={plan.to} onChange={e => A.setPlan({ to: e.target.value })}>{SITES.map(s => <option key={s.id} value={s.id} disabled={s.id === plan.from}>{s.short}</option>)}</select></label>
        </div>
        <div className="chips" style={{ marginTop: '.75rem' }}>
          <span className="chip">{Math.round(weight(plan.lines, pmap))} kg</span><span className="chip">{inr(value)}</span>
          {hazmat && <span className="chip" style={{ background: '#FFCDD7' }}>Li-ion UN3480 · EHS approval</span>}
        </div>
      </div>
      <div className="st"><span className="eb ink">Items</span></div>
      {plan.lines.map((l, i) => (
        <div key={i} className="line">
          <select value={l.partNo} onChange={e => setLine(i, { partNo: e.target.value })} aria-label="Part">
            {parts.map(p => <option key={p._id} value={p._id} disabled={!(free.get(p._id) ?? 0)}>{p.partNo} · {p.description} · {free.get(p._id) ?? 0} free</option>)}
          </select>
          <input type="number" min={1} value={l.qty} aria-label="Quantity" onChange={e => setLine(i, { qty: Math.max(1, Math.floor(+e.target.value || 1)) })} />
          <button className="x" aria-label="Remove item" onClick={() => A.setPlan({ lines: plan.lines.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}
      {short && <p className="note bad">Only {free.get(short.partNo) ?? 0} {short.partNo} free at {SITE_BY_ID[plan.from].short}.</p>}
      <div className="grid2" style={{ paddingTop: 0 }}>
        <button className="btn" onClick={() => A.setPlan({ lines: [...plan.lines, { partNo: parts.find(p => (free.get(p._id) ?? 0) > 0 && !plan.lines.some(l => l.partNo === p._id))?._id ?? parts[0]._id, qty: 1 }] })}>Add item</button>
      </div>
      <div className="st"><span className="eb ink">{`Options · ${SITE_BY_ID[plan.from].short} → ${SITE_BY_ID[plan.to].short}`}</span></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', padding: '0 1.25rem 1rem' }}>
        {options.map(o => (
          <button key={o.id} className={`opt ${o.id === plan.option ? 'on' : ''}`} disabled={!o.allowed} onClick={() => A.selectRoute(o.id)} aria-pressed={o.id === plan.option}>
            <div className="top"><b style={{ fontSize: '.9375rem' }}>{o.mode}</b>{o.tag && <span className="chip" style={{ background: TAG_BG[o.tag] }}>{o.tag}</span>}</div>
            <span style={{ fontSize: '.75rem', color: o.why && !o.allowed ? '#C8312B' : '#4A4D55' }}>{o.carrier}{o.why ? ` · ${o.why}` : ''}</span>
            <div className="m"><div><span>ETA</span><b>{o.eta}</b></div><div><span>Cost</span><b>{inr(o.cost)}</b></div><div><span>CO₂e</span><b>{o.co2.toFixed(2)} t</b></div></div>
          </button>
        ))}
      </div>
    </DrawerFrame>
  );
}

const DOT: Record<string, string> = { 'E-way bill hold': '#C8312B', 'Delay risk': '#C77700', 'Out for delivery': '#1B7F4E', Delivered: '#1B7F4E', Cancelled: '#767A82', 'Awaiting EHS approval': '#C77700' };
const dot = (s: Shipment) => DOT[s.status] ?? '#1450F5';
const isException = (s: Shipment) => s.status === 'E-way bill hold' || s.status === 'Delay risk' || s.status === 'Awaiting EHS approval' || (s.claims?.some(c => c.status === 'Open') ?? false);

function ShipmentDetail({ s, parts }: { s: Shipment; parts: Map<string, Part> }) {
  const me = useDoc('users', useApp(x => x.user)).data;
  const [claim, setClaim] = useState(false), [kind, setKind] = useState<'Damage' | 'Shortage' | 'Delay'>('Damage'), [amount, setAmount] = useState(0), [note, setNote] = useState('');
  const [holdNote, setHoldNote] = useState('');
  const t = useApp(x => x.t), next = t ? null : nextMilestone(s), can = canHandle(me) && !t;
  const doneUpTo = s.milestones.reduce((n, m, i) => (m.done ? i : n), -1);
  return <>
    <div className="st"><span className="eb ink">Milestones · {s._id}</span></div>
    {s.milestones.map((m, i) => {
      const exc = s.status === 'E-way bill hold' && i === doneUpTo + 1;
      const c = m.done ? 1 : exc ? 2 : 0;
      const label = exc ? 'E-way bill mismatch · held' : `${m.label}${i === 0 ? ` · ${SITE_BY_ID[s.from].short}` : i === s.milestones.length - 1 ? ` · ${SITE_BY_ID[s.to].short}` : ''}`;
      return (
        <div className="ms" key={m.label}>
          <div className="rail2">
            <i style={c === 2 ? { background: '#C8312B', boxShadow: '0 0 0 4px #FFCDD7' } : c === 0 ? { background: '#fff', border: '2px solid #C4C7CD' } : undefined} />
            {i < s.milestones.length - 1 && <u style={!s.milestones[i + 1].done ? { background: '#DEE0E4' } : undefined} />}
          </div>
          <div className="txt"><b style={c === 2 ? { color: '#C8312B' } : c === 0 ? { color: '#767A82' } : undefined}>{label}</b>
            <small>{m.at ? when(m.at) : i === s.milestones.length - 1 ? s.eta : 'Pending'}{m.note ? ` · ${m.note}` : ''}</small></div>
        </div>
      );
    })}
    <div className="kv">
      <div><span>Items</span><span>{s.items.map(l => `${l.qty} × ${parts.get(l.partNo)?.description ?? l.partNo}`).join(', ')}</span></div>
      {s.cost ? <div><span>Cost · CO₂e</span><span>{inr(s.cost)}{s.co2 ? ` · ${s.co2}` : ''}</span></div> : null}
      {s.notifiedAt && <div><span>Receiver</span><span>Notified {when(s.notifiedAt)}</span></div>}
    </div>
    {!t && s.status === 'Awaiting EHS approval' && (me?.role === 'ehs' || me?.role === 'admin') && <div className="grid2" style={{ paddingTop: 0 }}>
      <button className="btn primary" onClick={() => void A.shipApprove(s._id)}>Approve dangerous goods</button>
      <button className="btn" onClick={() => void A.shipApprove(s._id, 'rejected')}>Reject</button>
    </div>}
    {s.status === 'E-way bill hold' && can && <>
      <label className="fld"><span>Clear the hold · what was corrected</span><input value={holdNote} onChange={e => setHoldNote(e.target.value)} placeholder="e.g. Part B regenerated with the right vehicle number" /></label>
      <div className="grid2" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => void A.shipClearHold(s._id, holdNote)}>Clear hold</button></div>
    </>}
    {next && can && <div className="grid2" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => void A.shipAdvance(s._id)}>Record · {next}</button>
      {['Booked', 'Awaiting EHS approval'].includes(s.status) && <button className="btn" onClick={() => void A.shipCancel(s._id)}>Cancel booking</button>}</div>}
    <div className="st"><span className="eb ink">Documents</span></div>
    <div className="grid2" style={{ paddingTop: 0 }}>{s.docs.map(d => <button key={d} className="btn" onClick={() => void A.openShipDoc(s._id, d)}>{d}</button>)}</div>
    {(s.claims?.length ?? 0) > 0 && <>
      <div className="st"><span className="eb ink">Claims</span></div>
      <div className="rows">{s.claims!.map((c, i) => <div key={i}><span><b>{c.kind} · {inr(c.amount)}</b><small>{c.note || '—'} · {when(c.at)}</small></span><span className="chip">{c.status}</span></div>)}</div>
    </>}
    {claim && <>
      <div className="st"><span className="eb ink">New claim</span></div>
      <label className="fld"><span>Type</span><select value={kind} onChange={e => setKind(e.target.value as typeof kind)}>{['Damage', 'Shortage', 'Delay'].map(k => <option key={k}>{k}</option>)}</select></label>
      <label className="fld"><span>Amount, ₹</span><input type="number" min={0} value={amount || ''} onChange={e => setAmount(+e.target.value)} /></label>
      <label className="fld"><span>Details</span><textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="grid2" style={{ paddingTop: 0 }}>
        <button className="btn primary" onClick={() => void A.shipClaim(s._id, kind, amount, note).then(() => setClaim(false))}>Raise claim</button>
        <button className="btn" onClick={() => setClaim(false)}>Cancel</button>
      </div>
    </>}
    {!claim && can && <div className="grid2" style={{ paddingTop: 0 }}><button className="btn" onClick={() => setClaim(true)}>Claim</button></div>}
  </>;
}

export function ShipmentsDrawer() {
  const selId = useApp(s => s.ship), t = useApp(s => s.t), parts = useQuery('parts').data;
  const stored = useQuery('shipments', {}, { sort: { createdAt: -1 } }).data;
  const list = useMemo(() => (t ? stored.map(s => shipmentAsOf(s, asOfDate(t).getTime())).filter((s): s is NonNullable<typeof s> => !!s) : stored), [stored, t]);
  const pmap = useMemo(() => new Map(parts.map(p => [p._id, p])), [parts]);
  const [f, setF] = useState<'all' | 'in' | 'out' | 'exc'>('all');
  const shown = list.filter(s => (f === 'all' ? true : f === 'exc' ? isException(s) : s.dir === f));
  const sel = list.find(s => s._id === selId) ?? list.find(s => !['Delivered', 'Cancelled'].includes(s.status)) ?? list[0];
  return (
    <DrawerFrame title="Shipment tracker" foot={sel && !t ? <>
      <button className="btn primary" onClick={() => void A.shipNotify(sel._id)}>Notify receiver</button>
      <button className="btn" onClick={() => { A.setPlan({ from: sel.from, to: sel.to, lines: sel.items }); A.go('routes'); }}>Re-route</button>
    </> : undefined}>
      <TimeNotice what="Shipments" />
      <div className="dh">
        <span className="eb">All carriers · India</span>
        <div className="chips" style={{ marginTop: '.75rem' }}>
          {([['all', `All ${list.length}`], ['in', `Inbound ${list.filter(s => s.dir === 'in').length}`], ['out', `Outbound ${list.filter(s => s.dir === 'out').length}`], ['exc', `Exceptions ${list.filter(isException).length}`]] as const).map(([k, label]) => (
            <button key={k} className={`chip ${f === k ? 'dark' : ''}`} style={k === 'exc' && f !== k ? { background: '#FFCDD7' } : undefined} onClick={() => setF(k)} aria-pressed={f === k}>{label}</button>
          ))}
        </div>
      </div>
      <div className="rows">
        {shown.map(x => (
          <button key={x._id} className={`rowbtn ${x === sel ? 'sel' : ''}`} onClick={() => A.selectShip(x._id)}>
            <span><b>{x.carrier} · {x._id}</b><small>{SITE_BY_ID[x.from]?.name} → {SITE_BY_ID[x.to]?.name}</small></span>
            <span className="rt">
              <span style={{ display: 'flex', alignItems: 'center', gap: '.375rem', justifyContent: 'flex-end' }}><span className="dot" style={{ background: dot(x) }} />{x.status}{'projected' in x && x.projected ? ' · expected' : ''}</span>
              <small>{x.eta}</small>
            </span>
          </button>
        ))}
      </div>
      {sel && <ShipmentDetail key={sel._id + (sel.updatedAt ?? '')} s={sel} parts={pmap} />}
    </DrawerFrame>
  );
}
