import { useEffect } from 'react';
import { ROUTES, SHIPS } from '../../data/sample';
import { primary, SITE_BY_ID, SITES } from '../../data/sites';
import { loadPhotos } from '../../services/photos';
import { binId, partInBin, rnd } from '../../data/storeModel';
import { binAction, focusBuilding, go, openPhoto, selectRoute, selectShip, selectSite, toast } from '../../state/actions';
import { useApp } from '../../state/store';
import { DrawerFrame } from './Frame';

const Dot = ({ c }: { c: string }) => <span className="dot" style={{ background: c }} />;
const Eb = ({ children }: { children: string }) => <div className="st"><span className="eb ink">{children}</span></div>;

function Photos({ site, max = 6 }: { site: string; max?: number }) {
  const ph = useApp(s => s.photos[site]);
  useEffect(() => { loadPhotos(site); }, [site]);
  if (!ph || ph.status === 'loading') return <p className="note">Finding photos near the site…</p>;
  if (ph.status === 'error') return <p className="note">Photos are unavailable right now (Wikimedia Commons could not be reached).</p>;
  if (!ph.items.length) return <p className="note">No geotagged photos within 2 km yet.</p>;
  return (
    <>
      <div className="photos">
        {ph.items.slice(0, max).map((p, i) => (
          <button key={p.id} onClick={() => openPhoto(site, i)} aria-label={p.title}>
            <img src={p.thumb} alt="" loading="lazy" onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} /><span className="src">{p.credit}</span>
          </button>
        ))}
      </div>
      <p className="note">{ph.items.length} photos within 2 km · {[...new Set(ph.items.map(p => p.source))].join(' and ')}</p>
    </>
  );
}

export function NetworkDrawer() {
  const id = useApp(s => s.site), site = SITE_BY_ID[id];
  const alerts = site.alerts.filter(a => a[2] === '#C8312B').length;
  return (
    <DrawerFrame title="Site" foot={<>
      <button className="btn primary" onClick={() => go('site')}>Enter site in 3D</button>
      <button className="btn" onClick={() => toast('Compare mode · pick a second site on the map')}>Compare</button>
      <button className="btn" onClick={() => go('routes')}>Plan route</button>
    </>}>
      <div className="dh">
        <span className="eb">{site.type}</span><h2>{site.name}</h2>
        <p className="addr">{site.address}</p>
        <p>{site.ll[0].toFixed(4)}° N, {site.ll[1].toFixed(4)}° E · IST (UTC+5:30)</p>
      </div>
      <div className="kpis">
        <div><span>Stock value</span><b>{site.value}</b></div>
        <div><span>Space used</span><b>{site.space}%</b></div>
        <div><span>Open shipments</span><b>{site.ship}</b></div>
        <div><span>Alerts</span><b style={{ color: alerts ? '#C8312B' : '#141414' }}>{site.alerts.length}</b></div>
      </div>
      <Eb>Key KONE sites in India</Eb>
      <div className="rows">
        {SITES.map(x => (
          <button key={x.id} className={`rowbtn ${x.id === id ? 'sel' : ''}`} onClick={() => selectSite(x.id)}>
            <span><b>{x.name}</b><small>{x.type}</small></span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>{x.space}%{x.alerts.length ? <Dot c={x.alerts[0][2]} /> : null}</span>
          </button>
        ))}
      </div>
      {site.alerts.length > 0 && <>
        <Eb>Alerts at this site</Eb>
        <div className="rows">
          {site.alerts.map(([t, d, c]) => <div key={t}><span><b>{t}</b><small>{d}</small></span><Dot c={c} /></div>)}
        </div>
      </>}
      <Eb>Photos near this site</Eb>
      <Photos site={id} max={6} />
    </DrawerFrame>
  );
}

export function RoutesDrawer() {
  const sel = useApp(s => s.route);
  return (
    <DrawerFrame title="Route planner" foot={<>
      <button className="btn primary" onClick={() => toast(`Booked · ${ROUTES[sel].carrier} · pickup tomorrow 09:00`)}>Book selected option</button>
      <button className="btn" onClick={() => toast('Split shipment · choose pallets per leg')}>Split shipment</button>
    </>}>
      <div className="dh">
        <span className="eb">KTEC Chennai → KTEC Pune</span><h2>6 pallets for DX Class 2027 build</h2>
        <div className="chips" style={{ marginTop: '.75rem' }}>
          <span className="chip">2.4 t</span><span className="chip">8.6 m³</span>
          <span className="chip" style={{ background: '#FFCDD7' }}>Li-ion UN3480</span><span className="chip">Need by 22 Oct</span>
        </div>
      </div>
      <Eb>Best options · live traffic and weather</Eb>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', padding: '0 1.25rem 1rem' }}>
        {ROUTES.map((r, i) => (
          <button key={i} className={`opt ${i === sel ? 'on' : ''}`} onClick={() => selectRoute(i)} aria-pressed={i === sel}>
            <div className="top"><b style={{ fontSize: '.9375rem' }}>{r.mode}</b><span className="chip" style={{ background: r.tagBg }}>{r.tag}</span></div>
            <span style={{ fontSize: '.75rem', color: '#4A4D55' }}>{r.carrier}</span>
            <div className="m">
              <div><span>ETA</span><b>{r.eta}</b></div><div><span>Cost</span><b>{r.cost}</b></div><div><span>CO₂e</span><b>{r.co2}</b></div>
            </div>
          </button>
        ))}
      </div>
    </DrawerFrame>
  );
}

type Milestone = [string, string, 0 | 1 | 2]; // 0 pending, 1 done, 2 exception

export function ShipmentsDrawer() {
  const sel = useApp(s => s.ship), sh = SHIPS[sel];
  const ms: Milestone[] = sh.hold
    ? [['Picked up · ' + SITE_BY_ID[sh.from].name, '16 Oct, 18:20', 1], ['Departed Chennai hub', '17 Oct, 06:05', 1],
      ['E-way bill mismatch · held at Hubballi', '18 Oct, 08:40 · delay risk high', 2], ['Delivered · ' + SITE_BY_ID[sh.to].name, 'ETA 21 Oct (was 19 Oct)', 0]]
    : [['Picked up · ' + SITE_BY_ID[sh.from].name, '17 Oct, 15:10', 1], ['In transit', 'Last scan 18 Oct, 07:55', 1], ['Delivered · ' + SITE_BY_ID[sh.to].name, sh.eta, 0]];
  return (
    <DrawerFrame title="Shipment tracker" foot={<>
      <button className="btn primary" onClick={() => toast('Receiver notified · Teams and email')}>Notify receiver</button>
      <button className="btn" onClick={() => toast('Opening POD and documents')}>Docs</button>
      <button className="btn" onClick={() => go('routes')}>Re-route</button>
      <button className="btn" onClick={() => toast('Claim draft created')}>Claim</button>
    </>}>
      <div className="dh">
        <span className="eb">All carriers · India</span>
        <div className="chips" style={{ marginTop: '.75rem' }}>
          <span className="chip dark">All 142</span><span className="chip">Inbound 88</span><span className="chip">Outbound 54</span>
          <span className="chip" style={{ background: '#FFCDD7' }}>Exceptions 5</span>
        </div>
      </div>
      <div className="rows">
        {SHIPS.map((x, i) => (
          <button key={x.id} className={`rowbtn ${i === sel ? 'sel' : ''}`} onClick={() => selectShip(i)}>
            <span><b>{x.carrier} · {x.id}</b><small>{SITE_BY_ID[x.from].name} → {SITE_BY_ID[x.to].name}</small></span>
            <span className="rt">
              <span style={{ display: 'flex', alignItems: 'center', gap: '.375rem', justifyContent: 'flex-end' }}><Dot c={x.dot} />{x.status}</span>
              <small>{x.eta}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="st"><span className="eb ink">Milestones · {sh.id}</span></div>
      {ms.map(([a, b, c], i) => (
        <div className="ms" key={i}>
          <div className="rail2">
            <i style={c === 2 ? { background: '#C8312B', boxShadow: '0 0 0 4px #FFCDD7' } : c === 0 ? { background: '#fff', border: '2px solid #C4C7CD' } : undefined} />
            {i < ms.length - 1 && <u style={c === 2 || ms[i + 1][2] === 0 ? { background: '#DEE0E4' } : undefined} />}
          </div>
          <div className="txt"><b style={c === 2 ? { color: '#C8312B' } : c === 0 ? { color: '#767A82' } : undefined}>{a}</b><small>{b}</small></div>
        </div>
      ))}
    </DrawerFrame>
  );
}

function Sources({ site }: { site: string }) {
  const st = useApp(s => s.siteStats[site]);
  if (!st) return <p className="note">Loading OpenStreetMap buildings and satellite imagery…</p>;
  return (
    <div className="srcs">
      <span className="chip">{st.source === 'osm' ? `OpenStreetMap · ${st.buildings} buildings` : 'Stylised campus (OSM unavailable)'}</span>
      <span className="chip">{st.trees} trees</span>
      <span className="chip">{st.imagery === 'ok' ? 'OpenStreetMap ground' : st.imagery === 'loading' ? 'Imagery loading' : 'Imagery unavailable · map ground'}</span>
      <span className="chip">Blender models · test tower, trucks, trees</span>
    </div>
  );
}

export function SiteDrawer() {
  const b = useApp(s => s.bld), id = useApp(s => s.site), site = SITE_BY_ID[id];
  const main = primary(site), f = b ? site.facilities.find(x => x.k === b) : null;
  return (
    <DrawerFrame title="Site twin" foot={<>
      <button className="btn primary" onClick={() => go('store')}>Enter electronics store</button>
      <button className="btn" onClick={() => go('movements')}>Show moves</button>
    </>}>
      <div className="dh">
        <span className="eb">{f ? 'Facility' : site.type}</span><h2>{f ? f.n : site.name}</h2>
        <p className={f ? '' : 'addr'}>{f ? f.info : site.address}</p>
      </div>
      {!f && <Sources site={id} />}
      {(!f || f.floors) && main.floors && <>
        <Eb>{`Floors · ${main.n}`}</Eb>
        <div className="rows">
          {main.floors.map((_, i) => i).reverse().map(i => {
            const [n, space] = main.floors![i], isStore = i === main.storeFloor;
            return (
              <button key={n} className={`rowbtn ${isStore ? 'sel' : ''}`} onClick={() => (isStore ? go('store') : toast(`${n} · coming in the next drill-down`))}>
                <span><b>{n}</b><small>{isStore ? 'ESD area · 4 rack rows · 192 bins' : 'Opens in the next drill-down'}</small></span><b>{space}</b>
              </button>
            );
          })}
        </div>
      </>}
      {f && !f.floors && (
        <div className="kpis">
          <div><span>Stock units</span><b>{Math.round(rnd(f.k.length, 2, 3) * 400 + 40)}</b></div>
          <div><span>Open tasks</span><b>{Math.round(rnd(f.k.length, 5, 1) * 12 + 1)}</b></div>
        </div>
      )}
      <Eb>Facilities</Eb>
      <div className="rows">
        {site.facilities.map(x => (
          <button key={x.k} className={`rowbtn ${x.k === b ? 'sel' : ''}`} onClick={() => focusBuilding(x.k)}>
            <span><b>{x.n}</b><small>{x.s}</small></span>{x.alert ? <Dot c="#C8312B" /> : <span className="dot" style={{ background: x.col, border: '1px solid rgba(0,0,0,.15)' }} />}
          </button>
        ))}
      </div>
      <Eb>Photos near this site</Eb>
      <Photos site={id} max={9} />
    </DrawerFrame>
  );
}

export function StoreDrawer() {
  const bin = useApp(s => s.bin), id = binId(bin);
  const { part: p, featured } = partInBin(bin);
  const occ = Math.round(45 + rnd(bin.r, bin.i, bin.k) * 55);
  return (
    <DrawerFrame title="Bin">
      <div className="dh">
        <span className="eb">Bin {id} · Electronics store</span>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '.75rem' }}>
          <div className="thumb" style={{ width: '5.5rem', height: '5.5rem', flex: 'none' }}>Part image</div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem' }}>{p[2]}</h2>
            <p>{p[0]} · rev {p[1]}</p>
            <div className="chips" style={{ marginTop: '.5rem' }}>
              {p[5] !== '—' && <span className="chip" style={{ background: '#D2F5FF' }}>{p[5]}</span>}
              <span className="chip">{p[10]}</span>
            </div>
          </div>
        </div>
      </div>
      <div className="kpis k3">
        <div><span>On hand</span><b>{p[7]}</b></div><div><span>Reserved</span><b>{p[8]}</b></div><div><span>Inbound</span><b>{featured ? '+20' : '—'}</b></div>
      </div>
      <div className="kv">
        <div><span>Owner project</span><span>{p[10]}</span></div>
        <div><span>Last movement</span><span>Put-away · 14 Oct · S. Iyer</span></div>
        <div><span>Next event</span><span>{featured ? 'Issue 4 to Lab L-03 · 20 Oct' : 'None planned'}</span></div>
        <div style={{ flexDirection: 'column', gap: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Volume used</span><span style={{ color: '#141414' }}>{occ}%</span></div>
          <div className="bar6"><i style={{ width: `${occ}%` }} /></div>
        </div>
      </div>
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">Stock units</span></div>
      <div className="rows">
        <div><span>Lot 26-0912-A</span><span>8</span><span style={{ color: '#1B7F4E' }}>Available</span></div>
        <div><span>Lot 26-0912-B</span><span>4</span><span style={{ color: '#1450F5' }}>Reserved</span></div>
        {featured && <div><span>PO 4500182</span><span>20</span><span style={{ color: '#767A82' }}>Planned · 21 Oct</span></div>}
      </div>
      <div className="grid3">
        {['Pick', 'Put-away', 'Reserve', 'Count', 'Relocate', 'Label'].map((a, j) => (
          <button key={a} className={`btn ${j === 0 ? 'primary' : ''}`} onClick={() => binAction(a === 'Relocate' ? 'Move' : a)}>{a}</button>
        ))}
      </div>
    </DrawerFrame>
  );
}

export function MovementsDrawer() {
  const site = SITE_BY_ID[useApp(s => s.site)];
  const name = (k: string) => site.facilities.find(f => f.k === k)?.n ?? k;
  const steps = ['Tag', 'Reason', 'Approval', 'Move', 'Dispose', 'Write-off'];
  return (
    <DrawerFrame title="Movements and scrap" foot={<>
      <button className="btn primary" onClick={() => toast('Approved · forwarded to finance controller')}>Approve</button>
      <button className="btn" onClick={() => toast('Rejected · returned to lab owner')}>Reject</button>
      <button className="btn" onClick={() => toast('Move request form opened')}>Request move</button>
    </>}>
      <div className="dh">
        <span className="eb">Scrap case · awaiting your approval</span><h2>SC-2026-0418</h2>
        <p>6 × KM-SFT-BRK-090 safety brake · consumed in test campaign TC-114 drop test</p>
      </div>
      <div className="steps">{steps.map((x, i) => <div key={x} className={i < 2 ? 'done' : i === 2 ? 'cur' : ''}><i />{x}</div>)}</div>
      <div className="kv">
        <div><span>Reason</span><span>Destructive test · not reusable</span></div>
        <div><span>Write-off value</span><b>₹4,28,000</b></div>
        <div><span>Disposal</span><span>Recycle · authorised metals vendor</span></div>
      </div>
      <div className="grid3" style={{ paddingTop: 0 }}>{[1, 2, 3].map(n => <div key={n} className="thumb" style={{ aspectRatio: '1' }}>Photo {n}</div>)}</div>
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">Approval chain · over ₹2,00,000</span></div>
      <div className="rows">
        <div><span>Lab owner · P. Raman</span><span style={{ color: '#1B7F4E' }}>Approved</span></div>
        <div className="sel"><b>EHS · you</b><b>Pending</b></div>
        <div><span>Finance controller</span><span style={{ color: '#767A82' }}>Waiting</span></div>
      </div>
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">{`Moves today · ${site.short}`}</span></div>
      <div className="rows">
        {site.flows.map(([from, to, col, label]) => (
          <div key={label}><span><b>{name(from)} → {name(to)}</b><small>{label}</small></span><span className="dot" style={{ background: col }} /></div>
        ))}
        <div><span><b>KTEC Chennai → KTEC Pune</b><small>Loan to site · 2 crates</small></span><span className="chip">Inter-site</span></div>
      </div>
    </DrawerFrame>
  );
}
