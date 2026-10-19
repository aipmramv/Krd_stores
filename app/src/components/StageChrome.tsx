// Floating chrome over the map / 3D stage: breadcrumbs, layers rail, view controls, timeline,
// move banner, loading indicator and toast.
import { Fragment } from 'react';
import { COLOR_MODES, LAYERS, LEGENDS } from '../data/sample';
import { primary, SITE_BY_ID } from '../data/sites';
import { binId } from '../data/storeModel';
import type { ScreenId } from '../data/types';
import {
  cancelMove, go, goLive, toggleMapTilt, resetView, setBase, setMode, setTime, setTimeOfDay, toggleDim, toggleLayer, togglePeel, togglePhotoreal, toggleRail, toggleTour, zoom,
} from '../state/actions';
import { isOn, MAP_SCREENS, THREE_SCREENS, useApp } from '../state/store';

export function Crumbs({ hidden }: { hidden: boolean }) {
  const s = useApp(x => x);
  const site = SITE_BY_ID[s.site], main = primary(site);
  const india: [string, ScreenId] = ['India', 'network'];
  const bld = s.bld ? site.facilities.find(f => f.k === s.bld) : null;
  const storeFloor = main.floors?.[main.storeFloor ?? 0]?.[0].split(' · ')[0] ?? 'Store floor';
  const cr: [string, ScreenId][] = ({
    network: [india],
    routes: [india, ['Route plan · Chennai → Pune', 'routes']],
    shipments: [india, ['Shipments · 142 live', 'shipments']],
    site: [india, [site.name, 'site'], ...(bld ? [[bld.n, 'site'] as [string, ScreenId]] : [])],
    movements: [india, [site.name, 'site'], ['Movements and scrap', 'movements']],
    store: [india, [site.short, 'site'], [main.n, 'site'], [storeFloor, 'site'], ['Electronics store', 'store'], ['Rack ' + 'ABCD'[s.bin.r], 'store'], ['Bin ' + binId(s.bin), 'store']],
  } as Partial<Record<ScreenId, [string, ScreenId][]>>)[s.screen] ?? [];
  return (
    <div className={`crumbs${hidden ? ' hidden' : ''}`} id="crumbs">
      <div className="in" id="crumbsIn">
        {cr.map(([label, target], i) => {
          const cur = i === cr.length - 1;
          return (
            <Fragment key={i}>
              {i > 0 && <span className="sep">›</span>}
              <button className={cur ? 'cur' : ''} onClick={cur ? undefined : () => go(target)} aria-current={cur ? 'page' : undefined}>{label}</button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function Rail({ hidden }: { hidden: boolean }) {
  const s = useApp(x => x);
  const scr = s.screen, ls = LAYERS[scr] ?? [];
  return (
    <>
      <button className={`btn rail-open${hidden ? ' hidden' : ''}`} onClick={toggleRail}>Layers</button>
      <aside className={`panel rail${hidden ? ' hidden' : ''}`} id="rail" aria-label="Layers and filters">
        <div className="hd"><span className="eb">Layers and filters</span><button className="x" onClick={toggleRail} aria-label="Close layers">×</button></div>
        <div className="body">
          {MAP_SCREENS.includes(scr) && <>
            <div className="sec"><span className="eb ink">Base map</span></div>
            <div className="seg">
              <button className={s.base === 'sat' ? 'on' : ''} onClick={() => setBase('sat')}>Satellite</button>
              <button className={s.base === 'osm' ? 'on' : ''} onClick={() => setBase('osm')}>Streets</button>
            </div>
          </>}
          <div className="sec"><span className="eb ink">Layers</span></div>
          {ls.map(([id, label]) => (
            <button key={id} className={`tgl ${isOn(s, scr, id) ? 'on' : ''}`} onClick={() => toggleLayer(id)} aria-pressed={isOn(s, scr, id)}>
              <span>{label}</span><span className="sw" />
            </button>
          ))}
          {scr === 'store' && <>
            <div className="sec"><span className="eb ink">Colour by</span></div>
            <div className="seg">
              {COLOR_MODES.map(([id, label]) => <button key={id} className={s.mode === id ? 'on' : ''} onClick={() => setMode(id)}>{label}</button>)}
            </div>
            <div className="legend">
              {LEGENDS[s.mode].map(([c, l]) => <div key={l}><i style={{ background: c }} />{l}</div>)}
              <div><i style={{ background: '#fff', border: '1.5px dashed #1450F5' }} />Reserved / planned</div>
              <div><i style={{ background: '#C8312B' }} />Exception</div>
            </div>
          </>}
          {scr === 'site' && <>
            <div className="sec"><span className="eb ink">{primary(SITE_BY_ID[s.site]).n}</span></div>
            <button className={`tgl ${s.peel ? 'on' : ''}`} onClick={togglePeel} aria-pressed={s.peel}><span>Peel floors open</span><span className="sw" /></button>
          </>}
          {(scr === 'site' || scr === 'movements') && <SunAndView />}
          <div className="sec"><span className="eb ink">Filters</span></div>
          <div className="field"><span>Project</span><b>All projects</b></div>
          <div className="field"><span>Hazard class</span><b>Any</b></div>
          <div className="field"><span>Owner</span><b>Anyone</b></div>
        </div>
      </aside>
    </>
  );
}

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const istNow = () => { const d = new Date(); return (d.getUTCHours() + d.getUTCMinutes() / 60 + 5.5) % 24; };

/** Sun position by time of day, cinematic tour and the optional photorealistic mode. */
function SunAndView() {
  const tod = useApp(s => s.tod), tour = useApp(s => s.tour), photoreal = useApp(s => s.photoreal), key = useApp(s => s.googleKey || s.cesiumToken);
  const h = tod ?? istNow();
  return <>
    <div className="sec"><span className="eb ink">Sun and time of day · IST</span></div>
    <div className="sun">
      <input type="range" min={5} max={20} step={.25} value={Math.min(20, Math.max(5, h))} aria-label="Time of day" onChange={e => setTimeOfDay(+e.target.value)} />
      <b>{hhmm(h)}</b>
    </div>
    <div className="seg" style={{ marginTop: '.375rem' }}>
      <button className={tod === null ? 'on' : ''} onClick={() => setTimeOfDay(null)}>Now</button>
      <button className={tod === 19.5 ? 'on' : ''} onClick={() => setTimeOfDay(19.5)}>Evening</button>
    </div>
    <div className="sec"><span className="eb ink">View</span></div>
    <button className={`tgl ${tour ? 'on' : ''}`} onClick={toggleTour} aria-pressed={tour}><span>Cinematic tour</span><span className="sw" /></button>
    <button className={`tgl ${photoreal ? 'on' : ''}`} onClick={togglePhotoreal} aria-pressed={photoreal}>
      <span>Photorealistic 3D{key ? '' : ' · needs a token (Display)'}</span><span className="sw" />
    </button>
  </>;
}

export function Controls({ hidden }: { hidden: boolean }) {
  const screen = useApp(s => s.screen), dim = useApp(s => s.dim), tilt = useApp(s => s.mapTilt);
  const isMap = MAP_SCREENS.includes(screen);
  return (
    <div className={`ctrls${hidden ? ' hidden' : ''}`} id="ctrls">
      <button onClick={() => zoom(1)} aria-label="Zoom in">+</button>
      <button onClick={() => zoom(-1)} aria-label="Zoom out">−</button>
      <button className="t" onClick={resetView} aria-label="Reset view">Fit</button>
      {isMap
        ? <button className={`t${tilt ? ' on' : ''}`} onClick={toggleMapTilt} aria-pressed={tilt} title="Tilt the map into 3D: buildings and terrain">3D</button>
        : <button className={`t${THREE_SCREENS.includes(screen) ? '' : ' hidden'}`} onClick={toggleDim}>{dim}</button>}
    </div>
  );
}

const TODAY = new Date(2026, 9, 18);
const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function Timeline({ hidden }: { hidden: boolean }) {
  const t = useApp(s => s.t);
  const d = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + t);
  return (
    <div className={`panel timeline${hidden ? ' hidden' : ''}`} id="timeline">
      <button className="btn" onClick={goLive}>Live</button>
      <div className="tl-l">
        <span className="eb">{t < 0 ? 'Replay' : t > 0 ? 'Forecast' : 'Live'}</span>
        <b>{t === 0 ? 'Today · ' + fmt(d) : fmt(d)}</b>
      </div>
      <div className="tl-m">
        <input type="range" min={-30} max={28} step={1} value={t} aria-label="Time travel" onChange={e => setTime(+e.target.value)} />
        <div className="tl-ticks">
          <span style={{ left: 0 }}>18 Sep · replay 30 days</span>
          <span style={{ left: '51.7%', transform: 'translateX(-50%)', color: '#141414', fontWeight: 600 }}>Today</span>
          <span style={{ right: 0 }}>15 Nov · forecast 4 weeks</span>
        </div>
      </div>
      <div className="tl-meta"><span>Live latency 1.2 s</span><span id="fps">60 fps</span></div>
    </div>
  );
}

export function MoveBanner() {
  const from = useApp(s => s.moveFrom), screen = useApp(s => s.screen);
  if (!from || screen !== 'store') return null;
  return (
    <div className="banner">
      <span>Tap the destination bin for {binId(from)}</span>
      <button className="btn" onClick={cancelMove}>Cancel</button>
    </div>
  );
}

export function Loading() {
  const loading = useApp(s => s.loading);
  return loading ? <div className="loading">Building 3D site from satellite imagery and OSM footprints<i /></div> : null;
}

export function Toast() {
  const t = useApp(s => s.toast);
  return t ? <div className="toast" role="status">{t.msg}</div> : null;
}
