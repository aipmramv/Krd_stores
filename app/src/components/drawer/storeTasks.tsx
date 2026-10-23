// Bin tasks in the store twin's drawer: pick, put-away (tasks and new receipts), blind cycle count
// with variance approval, reservations and the bin's history. Labels and part sheets print.
import { useState } from 'react';
import QRCode from 'qrcode';
import { SITE_BY_ID } from '../../data/sites';
import { db } from '../../db';
import { useDoc, useQuery } from '../../db/hooks';
import type { Movement, Part, StockLot } from '../../db/schema';
import { binSeries, delta } from '../../services/flow';
import * as A from '../../state/actions';
import { BinChart } from '../pages/FlowCharts';
import { useApp, type AppState } from '../../state/store';

export type BinTask = NonNullable<AppState['binTask']>;
const FALLBACK = ['Issue to lab', 'Pick for shipment'];
const PROJECTS = ['DX Class 2027', 'MonoSpace retrofit', 'Escalator drive test', 'People flow sensing', '24/7 Connected', 'UltraRope trial'];
const code = (loc?: string) => loc?.split(':').pop() ?? '—';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function Qty({ v, set, max }: { v: number; set: (n: number) => void; max?: number }) {
  return (
    <span className="stepper">
      <button type="button" onClick={() => set(Math.max(1, v - 1))} aria-label="Fewer">−</button>
      <input type="number" min={1} max={max} value={v} onChange={e => set(Math.max(1, Math.floor(+e.target.value || 1)))} />
      <button type="button" onClick={() => set(max ? Math.min(max, v + 1) : v + 1)} aria-label="More">+</button>
      {max ? <button type="button" className="all" onClick={() => set(max)}>All</button> : null}
    </span>
  );
}

function LotSelect({ lots, parts, value, set, show }: { lots: StockLot[]; parts: Part[]; value: string; set: (id: string) => void; show: (l: StockLot) => string }) {
  return (
    <label className="fld"><span>Stock</span>
      <select value={value} onChange={e => set(e.target.value)}>
        {lots.map(l => <option key={l._id} value={l._id}>{l.partNo} · {parts.find(p => p._id === l.partNo)?.description} · lot {l.lot} · {show(l)}</option>)}
      </select>
    </label>
  );
}

function Pick({ lots, parts }: { lots: StockLot[]; parts: Part[] }) {
  const listed = useQuery('purposes', { kind: { $in: ['pick', 'issue'] }, active: true }, { sort: { name: 1 } }).data.map(p => p.name);
  const PURPOSES = listed.length ? listed : FALLBACK;
  const [id, setId] = useState(lots[0]?._id ?? ''), [qty, setQty] = useState(1), [chosen, setPurpose] = useState(''), [res, setRes] = useState(false);
  const purpose = chosen || PURPOSES[0];
  const lot = lots.find(l => l._id === id) ?? lots[0];
  if (!lot) return <p className="note">Nothing to pick in this bin.</p>;
  return <>
    <LotSelect lots={lots} parts={parts} value={lot._id} set={setId} show={l => `${l.qty} on hand${l.reserved ? `, ${l.reserved} reserved` : ''}`} />
    <label className="fld"><span>Quantity</span><Qty v={qty} set={setQty} max={res ? lot.qty : lot.qty - lot.reserved} /></label>
    <label className="fld"><span>Purpose</span><select value={purpose} onChange={e => setPurpose(e.target.value)}>{PURPOSES.map(p => <option key={p}>{p}</option>)}</select></label>
    {lot.reserved > 0 && <label className="tgl" style={{ minHeight: 'auto', paddingBottom: '.75rem' }}><span>Against the reservation ({lot.reserved})</span>
      <input type="checkbox" checked={res} onChange={e => setRes(e.target.checked)} /></label>}
    <div className="grid2" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => void A.binPick(lot._id, qty, purpose, res)}>Pick {qty}</button></div>
  </>;
}

function PutAway({ loc, parts }: { loc: string; parts: Part[] }) {
  const site = loc.split(':')[0];
  const tasks = useQuery('movements', { site, type: 'putaway', status: 'requested' }, { sort: { createdAt: 1 } }).data;
  const [q, setQ] = useState<Record<string, number>>({});
  const [partNo, setPart] = useState(parts[0]?._id ?? ''), [qty, setQty] = useState(1), [lot, setLot] = useState(''), [ref, setRef] = useState('');
  return <>
    <div className="st"><span className="eb ink">Waiting to be put away · {SITE_BY_ID[site].short}</span></div>
    {tasks.length ? <div className="mvlist">{tasks.map(t => (
      <div key={t._id} className="mvrow">
        <div className="mvhd"><span><b>{t.qty} × {parts.find(p => p._id === t.partNo)?.description ?? t.partNo}</b><small>{t.ref ?? t._id} · {t.lotId ? `in ${code(t.from)}` : 'planned receipt'} · {t.reason}</small></span></div>
        <div className="mvact">
          <input className="qty" type="number" min={1} max={t.qty} value={q[t._id] ?? t.qty} aria-label="Quantity" onChange={e => setQ({ ...q, [t._id]: Math.max(1, Math.min(t.qty, Math.floor(+e.target.value || 1))) })} />
          <button className="btn primary" onClick={() => void A.binPutAway(t._id, loc, q[t._id] ?? t.qty)}>Put away in {code(loc)}</button>
        </div>
      </div>
    ))}</div> : <p className="note">No put-away tasks at this site.</p>}
    <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">New receipt into {code(loc)}</span></div>
    <label className="fld"><span>Part</span><select value={partNo} onChange={e => setPart(e.target.value)}>{parts.map(p => <option key={p._id} value={p._id}>{p.partNo} · {p.description}</option>)}</select></label>
    <label className="fld"><span>Quantity</span><Qty v={qty} set={setQty} /></label>
    <div className="grid2" style={{ padding: '0 1.25rem .875rem' }}>
      <label className="fld" style={{ padding: 0 }}><span>Lot</span><input value={lot} onChange={e => setLot(e.target.value)} placeholder="e.g. GRN-2611" /></label>
      <label className="fld" style={{ padding: 0 }}><span>Delivery note / PO</span><input value={ref} onChange={e => setRef(e.target.value)} /></label>
    </div>
    <div className="grid2" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => void A.binReceive(partNo, qty, loc, lot, ref)}>Receive {qty}</button></div>
  </>;
}

function Count({ lots, parts, loc }: { lots: StockLot[]; parts: Part[]; loc: string }) {
  const me = useDoc('users', useApp(s => s.user)).data;
  const open = useQuery('movements', { from: loc, type: 'count', status: 'requested' }).data;
  const [c, setC] = useState<Record<string, string>>({}), [show, setShow] = useState(false);
  return <>
    {open.length > 0 && <>
      <div className="st"><span className="eb ink">Variances waiting for the store manager</span></div>
      <div className="mvlist">{open.map(m => (
        <div key={m._id} className="mvrow">
          <div className="mvhd"><span><b>{m._id} · {m.partNo}</b><small>System {m.qty} · counted {m.counted} · {m.reason}</small></span>
            <span className="chip" style={{ color: '#C8312B', boxShadow: 'inset 0 0 0 1px #C8312B' }}>{(m.counted ?? 0) - m.qty > 0 ? '+' : ''}{(m.counted ?? 0) - m.qty}</span></div>
          {(me?.role === 'storeManager' || me?.role === 'admin') && <div className="mvact">
            <button className="btn primary" onClick={() => void A.binDecideCount(m._id, 'approved')}>Post adjustment</button>
            <button className="btn" onClick={() => void A.binDecideCount(m._id, 'rejected')}>Ask for recount</button>
          </div>}
        </div>
      ))}</div>
    </>}
    <div className="st"><span className="eb ink">Blind count · {code(loc)}</span></div>
    {lots.length ? lots.map(l => (
      <label key={l._id} className="fld"><span>{l.partNo} · {parts.find(p => p._id === l.partNo)?.description} · lot {l.lot}{show ? ` · system ${l.qty}` : ''}</span>
        <input type="number" min={0} inputMode="numeric" value={c[l._id] ?? ''} placeholder="Counted" onChange={e => setC({ ...c, [l._id]: e.target.value })} />
      </label>
    )) : <p className="note">Empty bin: nothing to count.</p>}
    <div className="grid2" style={{ paddingTop: 0 }}>
      <button className="btn primary" disabled={!lots.length || lots.some(l => c[l._id] === undefined || c[l._id] === '')}
        onClick={() => void A.binCount(lots.map(l => ({ lotId: l._id, counted: Math.floor(+c[l._id]) })))}>Submit count</button>
      {(me?.role === 'storeManager' || me?.role === 'admin') && <button className="btn" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'} system quantity</button>}
    </div>
  </>;
}

function Reserve({ lots, parts }: { lots: StockLot[]; parts: Part[] }) {
  const [id, setId] = useState(lots[0]?._id ?? ''), [qty, setQty] = useState(1), [project, setProject] = useState(PROJECTS[0]);
  const [until, setUntil] = useState(new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  const lot = lots.find(l => l._id === id) ?? lots[0];
  if (!lot) return <p className="note">Nothing to reserve in this bin.</p>;
  return <>
    <LotSelect lots={lots} parts={parts} value={lot._id} set={setId} show={l => `${l.qty - l.reserved} free`} />
    <label className="fld"><span>Quantity</span><Qty v={qty} set={setQty} max={lot.qty - lot.reserved} /></label>
    <label className="fld"><span>Project</span><select value={project} onChange={e => setProject(e.target.value)}>{PROJECTS.map(p => <option key={p}>{p}</option>)}</select></label>
    <label className="fld"><span>Until</span><input type="date" value={until} onChange={e => setUntil(e.target.value)} /></label>
    <div className="grid2" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => void A.binReserve(lot._id, qty, project, until)}>Reserve {qty}</button></div>
    {lots.some(l => l.reserved > 0) && <>
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">Reserved here</span></div>
      <div className="rows">{lots.filter(l => l.reserved > 0).map(l => (
        <div key={l._id}><span>{l.partNo} · lot {l.lot}</span><span>{l.reserved}</span><button className="btn" onClick={() => void A.binRelease(l._id, l.reserved)}>Release</button></div>
      ))}</div>
    </>}
  </>;
}

const VERB: Record<Movement['type'], string> = { move: 'Move', pick: 'Pick', putaway: 'Put-away', count: 'Count', reserve: 'Reservation', issue: 'Issue', transfer: 'Transfer' };
const MARK: Partial<Record<Movement['type'], string>> = { pick: '−', putaway: '+', move: '⇄', count: '#', reserve: 'R', issue: '−', transfer: '⇄' };
/** The bin's last 30 days: units over time, then every recorded action, newest first. */
function History({ loc }: { loc: string }) {
  const list = useQuery('movements', { $or: [{ from: loc }, { to: loc }] }, { sort: { updatedAt: -1 } }).data, users = useQuery('users').data;
  const lots = useQuery('stockLots', { locationId: loc }).data, place = useDoc('locations', loc).data;
  const units = lots.reduce((n, l) => n + l.qty, 0), now = Date.now();
  if (!list.length) return <p className="note">No recorded activity for this bin yet.</p>;
  const series = binSeries(list, loc, units, now - 30 * 864e5, now);
  return <>
    <div className="st"><span className="eb ink">Units in the bin · last 30 days</span></div>
    <div style={{ padding: '0 1.25rem .75rem' }}><BinChart series={series} capacity={place?.capacity ?? 60} /></div>
    <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">Timeline</span></div>
    <ol className="tline">{list.slice(0, 60).map(m => {
      const d = delta(m, loc), who = users.find(u => u._id === (m.assignee ?? m.requestedBy))?.name ?? m.requestedBy;
      return (
        <li key={m._id} className={m.status}>
          <i aria-hidden>{MARK[m.type] ?? '•'}</i>
          <span><b>{VERB[m.type]} · {m.qty} × {m.partNo}{d ? <em className={d > 0 ? 'in' : 'out'}>{d > 0 ? '+' : '−'}{Math.abs(d)}</em> : null}</b>
            <small>{m.from && m.from !== loc ? `from ${code(m.from)} · ` : ''}{m.to && m.to !== loc ? `to ${code(m.to)} · ` : ''}{m.reason ?? ''}{m.ref ? ` · ${m.ref}` : ''}</small>
            <small>{who} · {when(m.updatedAt)} · {m.status}{m.evidence?.length ? <> · <button className="link" onClick={() => void A.openEventClip(m.evidence![m.evidence!.length - 1])}>▶ Seen on camera</button></> : null}</small></span>
        </li>
      );
    })}</ol>
  </>;
}

const TITLES: Record<BinTask, string> = { pick: 'Pick', putaway: 'Put-away', count: 'Cycle count', reserve: 'Reserve', history: 'History' };

export function BinTaskPanel({ task, loc }: { task: BinTask; loc: string }) {
  const lots = useQuery('stockLots', { locationId: loc }).data, parts = useQuery('parts', {}, { sort: { partNo: 1 } }).data;
  return <>
    <div className="dh"><span className="eb">Bin {code(loc)} · {TITLES[task]}</span><h2>{TITLES[task]}</h2></div>
    {task === 'pick' && <Pick key={lots.length} lots={lots} parts={parts} />}
    {task === 'putaway' && <PutAway loc={loc} parts={parts} />}
    {task === 'count' && <Count lots={lots} parts={parts} loc={loc} />}
    {task === 'reserve' && <Reserve key={lots.length} lots={lots} parts={parts} />}
    {task === 'history' && <History loc={loc} />}
  </>;
}

/** Print QR labels for a bin and each lot in it (Brady/Zebra 100 × 50 mm). */
export async function printLabels(loc: string) {
  const [lots, parts] = await Promise.all([db.find('stockLots', { locationId: loc }), db.find('parts')]);
  const [site, bin] = loc.split(':');
  const card = async (qr: string, title: string, lines: string[]) =>
    `<div class="l"><img src="${await QRCode.toDataURL(qr, { margin: 0, width: 220 })}"><div><small>KONE · ${SITE_BY_ID[site].short}</small><b>${title}</b>${lines.map(x => `<span>${x}</span>`).join('')}</div></div>`;
  const cards = [await card(`KONE:BIN:${loc}`, `Bin ${bin}`, ['Electronics store · ESD'])];
  for (const l of lots) {
    const p = parts.find(x => x._id === l.partNo);
    cards.push(await card(`KONE:LOT:${l._id}`, l.partNo, [p?.description ?? '', `Lot ${l.lot} · ${l.qty} ${p?.uom ?? ''}`, p?.hazard && p.hazard !== '—' ? p.hazard : '']));
  }
  const w = window.open('', '_blank');
  if (!w) { A.toast('Allow pop-ups to print labels'); return; }
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Labels · ${bin}</title><style>
    @page{size:100mm 50mm;margin:0}body{margin:0;font:12px system-ui,sans-serif}
    .l{width:100mm;height:50mm;box-sizing:border-box;padding:4mm;display:flex;gap:4mm;align-items:center;page-break-after:always;border-bottom:1px dashed #ccc}
    .l img{width:40mm;height:40mm}.l div{display:flex;flex-direction:column;gap:1mm}.l b{font-size:18px}.l small{color:#1450F5;font-weight:700;letter-spacing:.1em}
  </style>${cards.join('')}<script>window.onload=()=>window.print()</script>`);
  w.document.close();
}

/** A one-page part sheet: master data and handling notes. */
export async function printPartSheet(loc: string) {
  const lot = (await db.find('stockLots', { locationId: loc }))[0];
  const p = lot ? await db.get('parts', lot.partNo) : null;
  if (!p) { A.toast('Empty bin: no part documents'); return; }
  const w = window.open('', '_blank');
  if (!w) { A.toast('Allow pop-ups to open documents'); return; }
  const rows = [['Part', `${p.partNo} · rev ${p.rev}`], ['Description', p.description], ['Category', p.category], ['Unit', p.uom], ['Hazard', p.hazard], ['Export class', p.exportClass],
    ['Owner project', p.project], ['Unit cost', `₹${p.unitCost.toLocaleString('en-IN')}`], ['Weight', `${p.weightKg} kg per ${p.uom}`]];
  const notes = p.hazard === 'ESD' ? 'Handle at an ESD workstation with a wrist strap; keep in shielding bags.' : /UN\d/.test(p.hazard) ? 'Lithium-ion: store in the hazmat cabinet, state of charge ≤ 30 %, ship as Class 9.' : 'General handling.';
  w.document.write(`<!doctype html><meta charset="utf-8"><title>${p.partNo}</title><style>body{font:14px system-ui,sans-serif;margin:32px}td{padding:6px 12px;border-bottom:1px solid #DEE0E4}td:first-child{color:#767A82}.k{color:#1450F5;font-weight:700;letter-spacing:.2em}</style>
    <div class="k">KONE</div><h1>${p.description}</h1><table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table><p><b>Handling.</b> ${notes}</p>`);
  w.document.close();
}
