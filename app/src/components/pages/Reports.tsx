import { STATUS_DOT } from '../../data/sample';
import { SITE_BY_ID } from '../../data/sites';
import type { PartStatus } from '../../data/types';
import { db } from '../../db';
import { useQuery } from '../../db/hooks';
import type { Part, StockLot } from '../../db/schema';

/** A part with its stock summed over lots: the largest lot gives the location and status. */
interface PartRow { p: Part; onHand: number; reserved: number; where: string; status: PartStatus }
function rows(parts: Part[], lots: StockLot[]): PartRow[] {
  return parts.map(p => {
    const mine = lots.filter(l => l.partNo === p.partNo);
    const top = mine.reduce<StockLot | null>((m, l) => (!m || l.qty > m.qty ? l : m), null);
    const flagged = mine.find(l => l.status !== 'Available');
    return {
      p, onHand: mine.reduce((n, l) => n + l.qty, 0), reserved: mine.reduce((n, l) => n + l.reserved, 0),
      where: top ? `${top.locationId.split(':')[1]} · ${SITE_BY_ID[top.site]?.short ?? top.site}${mine.length > 1 ? ` +${mine.length - 1}` : ''}` : '—',
      status: flagged?.status ?? (top ? 'Available' : 'Planned'),
    };
  });
}

const NAV: [string, string[]][] = [
  ['Masters', ['Sites and locations', 'Parts', 'Carriers', 'Movement purposes', 'Area templates', 'Approval rules', 'Users and roles']],
  ['Configuration', ['Layout configurator', 'Units and cost centres']],
  ['Reports', ['Stock by project', 'Space utilisation', 'Shipment SLA', 'Scrap and write-off']],
];
const SELECTED = [1, 4, 10];
/** Row showing the inline on-hand edit in progress. */
const EDITING = 2;
const muted = { color: '#4A4D55' };

export function Reports({ hidden }: { hidden: boolean }) {
  const parts = useQuery('parts', {}, { sort: { partNo: 1 } }).data, lots = useQuery('stockLots').data;
  const list = rows(parts, lots);
  return (
    <section className={`page${hidden ? ' hidden' : ''}`}>
      <div className="rep">
        <nav>
          {NAV.map(([group, items]) => [
            <span key={group} className="eb">{group}</span>,
            ...items.map(it => <a key={it} href="#" className={it === 'Parts' ? 'on' : ''} onClick={e => e.preventDefault()}>{it}</a>),
          ])}
        </nav>
        <main>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h1>Parts master</h1>
              <div style={{ fontSize: '.8125rem', color: '#4A4D55', marginTop: '.25rem' }}>{parts.length} parts · {lots.length} stock lots · {db.kind === 'demo' ? 'demo data in this browser' : 'live database'}</div>
            </div>
            <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
              <button className="btn">Import Excel/CSV</button><button className="btn">Export</button><button className="btn primary">New part</button>
            </div>
          </div>
          <div className="toolbar">
            <div className="field" style={{ margin: 0 }}><span>Saved view</span>&nbsp;&nbsp;<b>R&amp;D active parts</b></div>
            <div className="field" style={{ margin: 0, width: '16rem' }}><span>Filter by part no., description</span></div>
            <span className="chip dark">Site · KTEC Chennai</span><span className="chip">Hazard · any</span><span className="chip">Export control · any</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: '.75rem', color: '#4A4D55' }}>3 rows selected · <a href="#" onClick={e => e.preventDefault()}>Bulk edit</a></span>
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr>
                <th /><th>Part no.</th><th>Rev</th><th>Description</th><th>Category</th><th>UoM</th><th>Hazard</th><th>Export</th>
                <th className="num">On hand</th><th className="num">Reserved</th><th>Location</th><th>Owner project</th><th>Status</th>
              </tr></thead>
              <tbody>
                {list.map(({ p, onHand, reserved, where, status }, i) => (
                  <tr key={p._id} className={SELECTED.includes(i) ? 'sel' : ''}>
                    <td><span className="cb" /></td>
                    <td style={{ color: '#1450F5', fontWeight: 600 }}>{p.partNo}</td>
                    <td>{p.rev}</td><td>{p.description}</td>
                    <td style={muted}>{p.category}</td><td style={muted}>{p.uom}</td><td style={muted}>{p.hazard}</td><td style={muted}>{p.exportClass}</td>
                    <td className="num">{i === EDITING ? <span className="edit">{onHand}</span> : onHand.toLocaleString('en-IN')}</td>
                    <td className="num">{reserved.toLocaleString('en-IN')}</td><td>{where}</td><td>{p.project}</td>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: '.375rem' }}><span className="dot" style={{ background: STATUS_DOT[status] }} />{status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', fontSize: '.75rem', color: '#4A4D55' }}>
            <span>Inline edit: on-hand for KM-ESC-DRV-040 changed 3 → 4 · posts as a count adjustment with audit trail</span>
            <span>1–{list.length} of {list.length}</span>
          </div>
        </main>
      </div>
    </section>
  );
}
