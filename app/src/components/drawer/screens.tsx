import { useEffect } from 'react';
import { ROUTES, SHIPS } from '../../data/sample';
import { primary, SITE_BY_ID, SITES } from '../../data/sites';
import { loadPhotos } from '../../services/photos';
import { binId, rnd } from '../../data/storeModel';
import { useDoc, useQuery } from '../../db/hooks';
import { MoveForm, MoveList } from './moves';
import { binAction, enterFloor, exitFloor, focusBuilding, go, openPhoto, selectRoute, selectShip, selectSite, startMove, toast, toggleWalk } from '../../state/actions';
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
      {st.modelled?.length ? <span className="chip">Modelled in Blender · {st.modelled.join(', ')}</span> : null}
      <span className="chip">Blender models · test tower, trucks, trees</span>
    </div>
  );
}

/** Sites whose primary tower is modelled storey by storey: only the KTEC floors, each one enterable. */
function TowerDrawer() {
  const id = useApp(s => s.site), fl = useApp(s => s.floor), walk = useApp(s => s.walk), site = SITE_BY_ID[id];
  const main = primary(site), floors = main.floors!;
  const isStore = fl === main.storeFloor;
  const tower = main.n.split(' · ')[0];
  if (fl === null) return (
    <DrawerFrame title="Site twin" foot={<>
      <button className="btn primary" onClick={() => enterFloor(main.storeFloor ?? 0)}>Enter {floors[main.storeFloor ?? 0][0]}</button>
      <button className="btn" onClick={() => go('store')}>Electronics store</button>
    </>}>
      <div className="dh">
        <span className="eb">{site.type}</span><h2>{site.name}</h2>
        <p className="addr">{site.address}</p>
      </div>
      <Sources site={id} />
      <Eb>{`KTEC floors · ${tower}`}</Eb>
      <div className="rows">
        {floors.map((_, i) => i).reverse().map(i => (
          <button key={i} className="rowbtn" onClick={() => enterFloor(i)}>
            <span><b>{floors[i][0]}</b><small>KTEC</small></span><b>Enter ›</b>
          </button>
        ))}
      </div>
      <Eb>Photos near this site</Eb>
      <Photos site={id} max={9} />
    </DrawerFrame>
  );
  return (
    <DrawerFrame title="Floor" foot={<>
      <button className="btn primary" onClick={toggleWalk}>{walk ? 'View from above' : 'Walk in'}</button>
      {isStore && <button className="btn" onClick={() => go('store')}>Open electronics store</button>}
      <button className="btn" onClick={exitFloor}>Back to tower</button>
    </>}>
      <div className="dh">
        <span className="eb">{`${tower} · Kosmo One`}</span><h2>{`${floors[fl][0]} · KTEC`}</h2>
      </div>
      <Eb>Other KTEC floors</Eb>
      <div className="rows">
        {floors.map((_, i) => i).reverse().filter(i => i !== fl).map(i => (
          <button key={i} className="rowbtn" onClick={() => enterFloor(i)}>
            <span><b>{floors[i][0]}</b></span><b>Go ›</b>
          </button>
        ))}
      </div>
    </DrawerFrame>
  );
}

export function SiteDrawer() {
  const b = useApp(s => s.bld), id = useApp(s => s.site), site = SITE_BY_ID[id];
  const main = primary(site), f = b ? site.facilities.find(x => x.k === b) : null;
  if (main.levels) return <TowerDrawer />;
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
  const bin = useApp(s => s.bin), site = useApp(s => s.site), draft = useApp(s => s.moveDraft), id = binId(bin);
  const loc = `${site}:${id}`;
  const lots = useQuery('stockLots', { locationId: loc }).data, parts = useQuery('parts').data;
  const location = useDoc('locations', loc).data;
  const inbound = useQuery('movements', { to: loc, status: { $in: ['requested', 'approved'] } }).data;
  const last = useQuery('movements', { $or: [{ from: loc }, { to: loc }], status: 'done' }, { sort: { updatedAt: -1 }, limit: 1 }).data[0];
  if (draft) return <DrawerFrame title="Move request"><MoveForm /></DrawerFrame>;
  const main = lots[0], part = parts.find(p => p._id === main?.partNo);
  const onHand = lots.reduce((n, l) => n + l.qty, 0), reserved = lots.reduce((n, l) => n + l.reserved, 0);
  const into = inbound.reduce((n, m) => n + m.qty, 0), cap = location?.capacity ?? 60;
  const occ = Math.round(Math.min(1, onHand / cap) * 100);
  return (
    <DrawerFrame title="Bin">
      <div className="dh">
        <span className="eb">Bin {id} · Electronics store{location ? ` · ${location.zone}` : ''}</span>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '.75rem' }}>
          <div className="thumb" style={{ width: '5.5rem', height: '5.5rem', flex: 'none' }}>{part ? 'Part image' : 'Empty'}</div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.125rem' }}>{part?.description ?? 'Empty bin'}</h2>
            <p>{part ? `${part.partNo} · rev ${part.rev}` : 'Free for put-away'}</p>
            {part && <div className="chips" style={{ marginTop: '.5rem' }}>
              {part.hazard !== '—' && <span className="chip" style={{ background: '#D2F5FF' }}>{part.hazard}</span>}
              <span className="chip">{main.project}</span>
            </div>}
          </div>
        </div>
      </div>
      <div className="kpis k3">
        <div><span>On hand</span><b>{onHand}</b></div><div><span>Reserved</span><b>{reserved}</b></div><div><span>Inbound</span><b>{into ? `+${into}` : '—'}</b></div>
      </div>
      <div className="kv">
        <div><span>Last movement</span><span>{last ? `${last.type} · ${last.qty} · ${new Date(last.updatedAt ?? '').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'None recorded'}</span></div>
        <div><span>Next event</span><span>{inbound[0] ? `${inbound[0]._id} · ${inbound[0].reason ?? inbound[0].type}` : 'None planned'}</span></div>
        <div style={{ flexDirection: 'column', gap: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Volume used</span><span style={{ color: '#141414' }}>{occ}% of {cap}</span></div>
          <div className="bar6"><i style={{ width: `${occ}%` }} /></div>
        </div>
      </div>
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">Stock units</span></div>
      <div className="rows">
        {lots.length ? lots.map(l => (
          <div key={l._id}><span>Lot {l.lot}</span><span>{l.qty}</span><span style={{ color: l.reserved ? '#1450F5' : '#1B7F4E' }}>{l.reserved ? `${l.reserved} reserved` : l.status}</span></div>
        )) : <div><span style={{ color: '#767A82' }}>No stock in this bin</span></div>}
      </div>
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">Move requests</span></div>
      <MoveList filter={{ $or: [{ from: loc }, { to: loc }] }} empty="No move requests for this bin." />
      <div className="grid3">
        {['Pick', 'Put-away', 'Reserve', 'Count', 'Relocate', 'Label'].map((a, j) => (
          <button key={a} className={`btn ${j === 0 ? 'primary' : ''}`} onClick={() => (a === 'Relocate' ? startMove(bin) : binAction(a))}>{a}</button>
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
      <button className="btn" onClick={() => { go('store'); toast('Press and hold a bin, then drag it to the destination'); }}>Request move</button>
    </>}>
      <div className="st"><span className="eb ink">{`Move requests · ${site.short}`}</span></div>
      <MoveList filter={{ site: site.id }} empty="No move requests at this site yet. Press and hold a bin in the store twin to start one." />
      <div className="dh" style={{ borderTop: '1px solid #DEE0E4' }}>
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
