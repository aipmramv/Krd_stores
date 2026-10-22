// Reports & masters: editable grids for every master, the cost centres, and the four reports.
import { useMemo, useState, type ReactNode } from 'react';
import { STATUS_DOT } from '../../data/sample';
import { SITE_BY_ID, SITES } from '../../data/sites';
import type { PartStatus } from '../../data/types';
import { db } from '../../db';
import { useDoc, useQuery } from '../../db/hooks';
import { ROLE_LABEL, type Part, type Role, type StockLot, type User, type Zone } from '../../db/schema';
import { download, toCsv } from '../../services/csv';
import { scrapWriteOff, shipmentSla, spaceUtilisation, stockByProject } from '../../services/reports';
import { openReport } from '../../state/actions';
import { useApp } from '../../state/store';
import { MasterGrid, type Col } from './MasterGrid';

const NAV: [string, string[]][] = [
  ['Masters', ['Sites and locations', 'Parts', 'Carriers', 'Movement purposes', 'Area templates', 'Approval rules', 'Users and roles']],
  ['Configuration', ['Layout configurator', 'Units and cost centres']],
  ['Reports', ['Stock by project', 'Space utilisation', 'Shipment SLA', 'Scrap and write-off']],
];
const PROJECTS = ['DX Class 2027', 'MonoSpace retrofit', 'Escalator drive test', 'People flow sensing', '24/7 Connected', 'UltraRope trial', '—'];
const ZONES: Zone[] = ['ESD', 'General', 'Hazmat', 'Quarantine', 'Heavy', 'Yard', 'Lab', 'Test'];
const ROLES = Object.keys(ROLE_LABEL) as Role[];
const MASTER_EDIT: Role[] = ['admin', 'storeManager', 'logistics'];
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Stock summed over lots; the largest lot gives the location, any flagged lot the status. */
function stockOf(p: Part, lots: StockLot[]) {
  const mine = lots.filter(l => l.partNo === p.partNo);
  const top = mine.reduce<StockLot | null>((m, l) => (!m || l.qty > m.qty ? l : m), null);
  const flagged = mine.find(l => l.status !== 'Available');
  return {
    onHand: mine.reduce((n, l) => n + l.qty, 0), reserved: mine.reduce((n, l) => n + l.reserved, 0),
    where: top ? `${top.locationId.split(':')[1]} · ${SITE_BY_ID[top.site]?.short ?? top.site}${mine.length > 1 ? ` +${mine.length - 1}` : ''}` : '—',
    status: (flagged?.status ?? (top ? 'Available' : 'Planned')) as PartStatus,
  };
}

function Parts({ me, q }: { me: User | null; q: string }) {
  const lots = useQuery('stockLots').data;
  const stock = useMemo(() => { const m = new Map<string, ReturnType<typeof stockOf>>(); return (p: Part) => { if (!m.has(p._id)) m.set(p._id, stockOf(p, lots)); return m.get(p._id)!; }; }, [lots]);
  const cols: Col<Part>[] = [
    { key: 'partNo', label: 'Part no.', fixed: true, required: true },
    { key: 'rev', label: 'Rev', width: '3rem' },
    { key: 'description', label: 'Description', required: true },
    { key: 'category', label: 'Category' },
    { key: 'uom', label: 'UoM', type: 'select', options: ['pcs', 'm', 'L', 'kg', 'set'] },
    { key: 'hazard', label: 'Hazard', type: 'select', options: ['—', 'ESD', 'UN3480', 'Flammable'] },
    { key: 'exportClass', label: 'Export', type: 'select', options: ['—', 'EAR99', '5A991', '5A992'] },
    { key: 'project', label: 'Owner project', type: 'select', options: PROJECTS },
    { key: 'unitCost', label: 'Unit cost ₹', type: 'number', min: 0 },
    { key: 'weightKg', label: 'Weight kg', type: 'number', min: 0 },
    { key: 'onHand', label: 'On hand', num: true, value: p => stock(p).onHand },
    { key: 'reserved', label: 'Reserved', num: true, value: p => stock(p).reserved },
    { key: 'where', label: 'Location', value: p => stock(p).where },
    { key: 'status', label: 'Status', value: p => stock(p).status, render: p => <span className="st-dot"><span className="dot" style={{ background: STATUS_DOT[stock(p).status] }} />{stock(p).status}</span> },
  ];
  return <MasterGrid coll="parts" title="Parts master" sortKey="partNo" cols={cols} canEdit={!!me && MASTER_EDIT.includes(me.role)} who={me?.name ?? ''} initialQuery={q}
    subtitle={<>{lots.length} stock lots across 4 sites · {db.kind === 'demo' ? 'demo data in this browser' : 'live database'} · on hand and status come from the stock lots</>}
    prepare={d => (typeof d.partNo === 'string' ? { ...d, partNo: d.partNo.trim().toUpperCase() } : d)}
    idOf={d => String(d.partNo).trim().toUpperCase()} defaults={{ rev: 'A', category: 'Electronics', uom: 'pcs', hazard: '—', exportClass: '—', project: '—', unitCost: 0, weightKg: 1 }} />;
}

function Locations({ me }: { me: User | null }) {
  const [site, setSite] = useState(useApp(s => s.site));
  const lots = useQuery('stockLots', { site }).data;
  const used = useMemo(() => { const m = new Map<string, number>(); for (const l of lots) m.set(l.locationId, (m.get(l.locationId) ?? 0) + l.qty); return m; }, [lots]);
  const cols: Col<import('../../db/schema').Location>[] = [
    { key: 'code', label: 'Code', fixed: true, required: true },
    { key: 'store', label: 'Store', type: 'select', options: ['electronics', 'areas'] },
    { key: 'zone', label: 'Zone', type: 'select', options: ZONES },
    { key: 'capacity', label: 'Capacity', type: 'number', min: 1 },
    { key: 'used', label: 'Units held', num: true, value: l => used.get(l._id) ?? 0 },
    { key: 'free', label: 'Free', num: true, value: l => Math.max(0, l.capacity - (used.get(l._id) ?? 0)) },
  ];
  return <MasterGrid key={site} coll="locations" filter={{ site }} title="Sites and locations" sortKey="code" cols={cols} canEdit={!!me && MASTER_EDIT.includes(me.role)} who={me?.name ?? ''}
    prepare={d => (typeof d.code === 'string' ? { ...d, code: d.code.trim() } : d)}
    subtitle={SITE_BY_ID[site].address} idOf={d => `${site}:${String(d.code).trim()}`} defaults={{ site, store: 'areas', zone: 'General', capacity: 100 }}
    extraActions={<select value={site} onChange={e => setSite(e.target.value)} aria-label="Site">{SITES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>} />;
}

function Simple({ which, me }: { which: string; me: User | null }) {
  const centres = useQuery('costCentres').data.map(c => c.code), users = useQuery('users').data;
  const edit = !!me && MASTER_EDIT.includes(me.role), admin = me?.role === 'admin', who = me?.name ?? '';
  switch (which) {
    case 'Carriers': return <MasterGrid coll="carriers" title="Carriers" sortKey="name" canEdit={edit} who={who} idOf={d => String(d.name).toLowerCase().replace(/\W+/g, '-')} defaults={{ modes: ['road'] }}
      cols={[{ key: 'name', label: 'Carrier', fixed: true, required: true }, { key: 'modes', label: 'Modes', type: 'multi', options: ['road', 'air', 'rail', 'courier'], required: true }, { key: 'contact', label: 'Booking contact' }]} />;
    case 'Movement purposes': return <MasterGrid coll="purposes" title="Movement purposes" sortKey="name" canEdit={edit} who={who} idOf={d => String(d.name).toLowerCase().replace(/\W+/g, '-')}
      subtitle="Offered as reasons in move requests and as purposes when picking" defaults={{ kind: 'move', active: true }}
      cols={[{ key: 'name', label: 'Purpose', required: true }, { key: 'kind', label: 'Used for', type: 'select', options: ['move', 'pick', 'issue', 'transfer'] }, { key: 'costCentre', label: 'Cost centre', type: 'select', options: centres }, { key: 'active', label: 'Active', type: 'bool' }]} />;
    case 'Area templates': return <MasterGrid coll="areaTemplates" title="Area templates" sortKey="name" canEdit={edit} who={who} idOf={d => String(d.name).toLowerCase().replace(/\W+/g, '-')} defaults={{ zone: 'General', racks: 1, bays: 4, levels: 3, binCapacity: 50 }}
      subtitle="Standard store layouts for the layout configurator"
      cols={[{ key: 'name', label: 'Template', required: true }, { key: 'zone', label: 'Zone', type: 'select', options: ZONES }, { key: 'racks', label: 'Rack rows', type: 'number', min: 1 }, { key: 'bays', label: 'Bays', type: 'number', min: 1 }, { key: 'levels', label: 'Levels', type: 'number', min: 1 }, { key: 'binCapacity', label: 'Bin capacity', type: 'number', min: 1 }, { key: 'note', label: 'Note' }]} />;
    case 'Approval rules': return <MasterGrid coll="approvalRules" title="Approval rules" sortKey="kind" canEdit={admin} who={who} defaults={{ kind: 'scrap', minValue: 0, chain: ['ehs'] }}
      subtitle="The highest threshold at or below a case's value decides its approval chain · administrators edit"
      cols={[{ key: 'kind', label: 'Applies to', type: 'select', options: ['scrap', 'move', 'shipment'], required: true }, { key: 'minValue', label: 'From value ₹', type: 'number', min: 0 },
        { key: 'chain', label: 'Approval chain (in order)', type: 'multi', options: ROLES, required: true }, { key: 'note', label: 'Note' }]} />;
    case 'Users and roles': return <MasterGrid coll="users" title="Users and roles" sortKey="name" canEdit={admin} who={who} idOf={d => String(d.initials).toLowerCase()} defaults={{ role: 'clerk', sites: ['ktec'] }}
      subtitle="Sign-in comes from Microsoft Entra ID in production · administrators edit"
      cols={[{ key: 'name', label: 'Name', required: true }, { key: 'initials', label: 'Initials', fixed: true, required: true, width: '5rem' }, { key: 'email', label: 'Email', required: true },
        { key: 'role', label: 'Role', type: 'select', options: ROLES, render: u => ROLE_LABEL[u.role] }, { key: 'sites', label: 'Sites', type: 'multi', options: SITES.map(s => s.id) }]} />;
    case 'Units and cost centres': return <MasterGrid coll="costCentres" title="Units and cost centres" sortKey="code" canEdit={edit} who={who} idOf={d => String(d.code).trim().toUpperCase()} defaults={{ site: 'ktec' }}
      cols={[{ key: 'code', label: 'Code', fixed: true, required: true }, { key: 'name', label: 'Name', required: true }, { key: 'site', label: 'Site', type: 'select', options: SITES.map(s => s.id) },
        { key: 'owner', label: 'Owner', type: 'select', options: users.map(u => u._id), render: c => users.find(u => u._id === c.owner)?.name ?? c.owner }]} />;
    default: return null;
  }
}

// ---------- Reports ----------
/** A report table whose value column carries an inline bar: the table is the chart and its table view. */
function ReportTable({ title, sub, head, rows, bar, file, filters }: { title: string; sub: ReactNode; head: string[]; rows: (string | number)[][]; bar: { col: number; max: number; fmt: (n: number) => string; color?: string }; file: string; filters?: ReactNode }) {
  return <>
    <div className="rep-hd">
      <div><h1>{title}</h1><div className="sub">{sub}</div></div>
      <div className="acts"><button className="btn" onClick={() => download(`${file}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(head, rows))}>Export</button></div>
    </div>
    {filters}
    <div className="tablewrap">
      <table className="report">
        <thead><tr>{head.map((h, i) => <th key={h} className={i ? 'num' : ''}>{h}</th>)}<th className="barcol" aria-hidden /></tr></thead>
        <tbody>{rows.map((r, i) => {
          const v = Number(r[bar.col]) || 0;
          return (
            <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'num' : ''}>{typeof c === 'number' ? (j === bar.col ? bar.fmt(c) : c.toLocaleString('en-IN')) : c}</td>)}
              <td className="barcol"><span className="hbar" title={`${r[0]} · ${head[bar.col]} ${bar.fmt(v)}`}><i style={{ width: `${bar.max ? Math.max(1, v / bar.max * 100) : 0}%`, background: bar.color ?? '#1450F5' }} /></span></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  </>;
}

function SiteFilter({ site, set }: { site: string; set: (s: string) => void }) {
  return <div className="toolbar">{[['all', 'All sites'], ...SITES.map(s => [s.id, s.short])].map(([id, n]) => <button key={id} className={`chip ${site === id ? 'dark' : ''}`} onClick={() => set(id)} aria-pressed={site === id}>{n}</button>)}</div>;
}

function Report({ which }: { which: string }) {
  const [site, setSite] = useState('all');
  const f = site === 'all' ? {} : { site };
  const lots = useQuery('stockLots', f).data, parts = useQuery('parts').data, locs = useQuery('locations', f).data;
  const ships = useQuery('shipments').data, cases = useQuery('scrapCases', f).data;
  const pmap = useMemo(() => new Map(parts.map(p => [p._id, p])), [parts]);
  if (which === 'Stock by project') {
    const r = stockByProject(lots, pmap), max = Math.max(0, ...r.map(x => x.value));
    return <ReportTable title="Stock by project" file="stock-by-project" sub={`${inr(r.reduce((n, x) => n + x.value, 0))} of stock on hand · valued at unit cost`}
      head={['Project', 'Parts', 'Lots', 'Units', 'Value']} rows={r.map(x => [x.project, x.parts, x.lots, x.qty, x.value])} bar={{ col: 4, max, fmt: inr }} filters={<SiteFilter site={site} set={setSite} />} />;
  }
  if (which === 'Space utilisation') {
    const r = spaceUtilisation(locs, lots, site === 'all' ? 'site' : 'rack');
    return <ReportTable title="Space utilisation" file="space-utilisation" sub="Electronics store bins · units held against bin capacity"
      head={[site === 'all' ? 'Site' : 'Rack row', 'Bins', 'Empty', 'Near full', 'Used %']} rows={r.map(x => [site === 'all' ? SITE_BY_ID[x.key]?.short ?? x.key : x.key, x.bins, x.empty, x.nearFull, Math.round(x.used / x.capacity * 100)])}
      bar={{ col: 4, max: 100, fmt: n => `${n}%` }} filters={<SiteFilter site={site} set={setSite} />} />;
  }
  if (which === 'Shipment SLA') {
    const r = shipmentSla(ships);
    return <ReportTable title="Shipment SLA" file="shipment-sla" sub="On time: delivered by the booked ETA · overdue: not delivered and past ETA · exceptions: holds, delay risk or claims"
      head={['Carrier', 'Shipments', 'Delivered', 'Late', 'Overdue', 'Exceptions', 'On time %']} rows={r.map(x => [x.carrier, x.shipments, x.delivered, x.late, x.overdue, x.exceptions, x.onTimePct ?? '—'])}
      bar={{ col: 6, max: 100, fmt: n => `${n}%` }} />;
  }
  const r = scrapWriteOff(cases), max = Math.max(0, ...r.map(x => x.writtenOff + x.open));
  return <ReportTable title="Scrap and write-off" file="scrap-write-off" sub={`${inr(r.reduce((n, x) => n + x.writtenOff, 0))} written off · ${inr(r.reduce((n, x) => n + x.open, 0))} in open cases`}
    head={['Reason', 'Cases', 'Units', 'Open ₹', 'Written off ₹']} rows={r.map(x => [x.reason, x.cases, x.units, x.open, x.writtenOff])} bar={{ col: 4, max, fmt: inr, color: '#C8312B' }} filters={<SiteFilter site={site} set={setSite} />} />;
}

function Configurator() {
  const t = useQuery('areaTemplates').data;
  return <>
    <div className="rep-hd"><div><h1>Layout configurator</h1><div className="sub">2D floor-plan editor that generates the 3D store · planned in phase 3</div></div></div>
    <p className="sub" style={{ maxWidth: '40rem' }}>You will draw a store's outline, drop area templates onto it and the bins and the 3D store twin are generated from it. The templates it will use are already editable under Area templates:</p>
    <div className="rows" style={{ maxWidth: '40rem' }}>{t.map(x => <div key={x._id}><span><b>{x.name}</b><small>{x.zone} · {x.racks} × {x.bays} × {x.levels} bins of {x.binCapacity}</small></span></div>)}</div>
    <button className="btn" style={{ marginTop: '1rem' }} onClick={() => openReport('Area templates')}>Edit area templates</button>
  </>;
}

export function Reports({ hidden }: { hidden: boolean }) {
  const page = useApp(s => s.reportPage), q = useApp(s => s.reportQuery), me = useDoc('users', useApp(s => s.user)).data;
  return (
    <section className={`page${hidden ? ' hidden' : ''}`}>
      <div className="rep">
        <nav>
          {NAV.map(([group, items]) => [
            <span key={group} className="eb">{group}</span>,
            ...items.map(it => <a key={it} href="#" className={it === page ? 'on' : ''} aria-current={it === page ? 'page' : undefined} onClick={e => { e.preventDefault(); openReport(it); }}>{it}</a>),
          ])}
        </nav>
        <main>
          {page === 'Parts' ? <Parts key={q} me={me} q={q} />
            : page === 'Sites and locations' ? <Locations me={me} />
            : page === 'Layout configurator' ? <Configurator />
            : NAV[2][1].includes(page) ? <Report key={page} which={page} />
            : <Simple key={page} which={page} me={me} />}
        </main>
      </div>
    </section>
  );
}
