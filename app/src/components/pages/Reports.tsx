import { PARTS, STATUS_DOT } from '../../data/sample';

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
              <div style={{ fontSize: '.8125rem', color: '#4A4D55', marginTop: '.25rem' }}>2,418 parts · synced with SAP S/4HANA and PLM 6 min ago</div>
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
                {PARTS.map((p, i) => (
                  <tr key={p[0]} className={SELECTED.includes(i) ? 'sel' : ''}>
                    <td><span className="cb" /></td>
                    <td style={{ color: '#1450F5', fontWeight: 600 }}>{p[0]}</td>
                    <td>{p[1]}</td><td>{p[2]}</td>
                    <td style={muted}>{p[3]}</td><td style={muted}>{p[4]}</td><td style={muted}>{p[5]}</td><td style={muted}>{p[6]}</td>
                    <td className="num">{i === EDITING ? <span className="edit">4</span> : p[7]}</td>
                    <td className="num">{p[8]}</td><td>{p[9]}</td><td>{p[10]}</td>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: '.375rem' }}><span className="dot" style={{ background: STATUS_DOT[p[11]] }} />{p[11]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', fontSize: '.75rem', color: '#4A4D55' }}>
            <span>Inline edit: on-hand for KM-ESC-DRV-040 changed 3 → 4 · posts as a count adjustment with audit trail</span>
            <span>1–12 of 2,418</span>
          </div>
        </main>
      </div>
    </section>
  );
}
