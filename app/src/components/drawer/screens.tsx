import { useEffect } from 'react';
import { primary, SITE_BY_ID, SITES } from '../../data/sites';
import { loadPhotos } from '../../services/photos';
import { binId, rnd } from '../../data/storeModel';
import { useDoc, useQuery } from '../../db/hooks';
import { MoveForm, MoveList } from './moves';
import { ScrapCaseView, ScrapList, ScrapNew } from './scrap';
import { BinTaskPanel } from './storeTasks';
import { binAction, enterFloor, exitFloor, focusBuilding, go, newScrap, openPhoto, selectSite, setBinTask, startMove, toast, toggleWalk } from '../../state/actions';
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

export { RoutesDrawer, ShipmentsDrawer } from './shipments';

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
  const bin = useApp(s => s.bin), site = useApp(s => s.site), draft = useApp(s => s.moveDraft), scrapNew = useApp(s => s.scrapNew), task = useApp(s => s.binTask), id = binId(bin);
  const loc = `${site}:${id}`;
  const lots = useQuery('stockLots', { locationId: loc }).data, parts = useQuery('parts').data;
  const location = useDoc('locations', loc).data;
  const inbound = useQuery('movements', { to: loc, status: { $in: ['requested', 'approved'] } }).data;
  const last = useQuery('movements', { $or: [{ from: loc }, { to: loc }], status: 'done' }, { sort: { updatedAt: -1 }, limit: 1 }).data[0];
  if (scrapNew) return <ScrapNew />;
  if (draft) return <DrawerFrame title="Move request"><MoveForm /></DrawerFrame>;
  if (task) return <DrawerFrame title="Bin task" foot={<button className="btn" onClick={() => setBinTask(null)}>Back to bin {id}</button>}><BinTaskPanel task={task} loc={loc} /></DrawerFrame>;
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
  const site = SITE_BY_ID[useApp(s => s.site)], scrapId = useApp(s => s.scrapId), scrapNew = useApp(s => s.scrapNew);
  const name = (k: string) => site.facilities.find(f => f.k === k)?.n ?? k;
  if (scrapNew) return <ScrapNew />;
  if (scrapId) return <ScrapCaseView id={scrapId} />;
  return (
    <DrawerFrame title="Movements and scrap" foot={<>
      <button className="btn primary" onClick={() => newScrap()}>New scrap case</button>
      <button className="btn" onClick={() => { go('store'); toast('Press and hold a bin, then drag it to the destination'); }}>Request move</button>
    </>}>
      <div className="st"><span className="eb ink">{`Scrap cases · ${site.short}`}</span></div>
      <ScrapList site={site.id} />
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">{`Move requests · ${site.short}`}</span></div>
      <MoveList filter={{ site: site.id }} empty="No move requests at this site yet. Press and hold a bin in the store twin to start one." />
      {site.flows.length > 0 && <>
        <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">{`Flows on the site map · ${site.short}`}</span></div>
        <div className="rows">
          {site.flows.map(([from, to, col, label]) => (
            <div key={label}><span><b>{name(from)} → {name(to)}</b><small>{label}</small></span><span className="dot" style={{ background: col }} /></div>
          ))}
        </div>
      </>}
    </DrawerFrame>
  );
}
