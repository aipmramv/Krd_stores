// Live events: the log of everything the cameras, scanners, tags and sensors reported and what the
// rules made of it, a wall of the store's cameras, the tracker tags, and the demo simulator with
// a trigger for every detection.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useDoc, useQuery } from '../../db/hooks';
import type { Camera, EventKind, SensorEvent } from '../../db/schema';
import { canView } from '../../services/privacy';
import { RULE_LABEL } from '../../services/rules';
import { getSim, onSim, SCENARIOS, startSim, stopSim, trigger } from '../../services/simulator';
import { loadStoreView } from '../../services/storeView';
import { openCamera, openEventClip, openScanner, toast } from '../../state/actions';
import { useApp } from '../../state/store';
import { drawCctv } from '../../three/cctv';

export const EVENT_LABEL: Record<EventKind, string> = {
  bin_take: 'Taken from a bin', bin_put: 'Put into a bin', zone_entry: 'Restricted area entry', motion: 'Motion', no_esd_coat: 'No ESD coat',
  forklift_speed: 'Forklift speed', aisle_blocked: 'Blocked aisle', smoke: 'Smoke', vehicle_arrived: 'Vehicle at the dock', boxes_counted: 'Boxes counted',
  scan: 'Scan', tag_exit: 'Tag at the door gate', temperature: 'Temperature',
};
const SOURCE: Record<SensorEvent['source'], string> = { cctv: 'Camera', scan: 'Scanner', rfid: 'RFID gate', ble: 'BLE tag', sensor: 'Sensor' };
const OUT: Record<NonNullable<SensorEvent['outcome']>, [string, string]> = {
  matched: ['Matched', '#1B7F4E'], alert: ['Alert', '#C8312B'], logged: ['Logged', '#4A4D55'], ignored: ['Below threshold', '#767A82'],
};
const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function OutcomeChip({ e }: { e: SensorEvent }) {
  const [label, col] = OUT[e.outcome ?? 'logged'];
  return <span className="chip" style={{ color: col, boxShadow: `inset 0 0 0 1px ${col}` }}>{label}{e.matched ? ` · ${e.matched}` : ''}</span>;
}

type Filter = 'all' | 'alert' | 'matched' | 'devices';
function Feed({ site }: { site: string }) {
  const events = useQuery('events', { site }, { sort: { at: -1 }, limit: 80 }).data;
  const [f, setF] = useState<Filter>('all');
  const shown = events.filter(e => f === 'all' || (f === 'devices' ? e.source !== 'cctv' : e.outcome === f));
  return (
    <div className="cpanel feed">
      <div className="ch"><b>Event log</b><small>Every detection, scan and reading, with what the rules made of it</small></div>
      <div className="seg">{(['all', 'alert', 'matched', 'devices'] as Filter[]).map(k => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{{ all: 'All', alert: 'Alerts', matched: 'Matched', devices: 'Scans, tags, sensors' }[k]}</button>)}</div>
      <ol className="evlist">{shown.slice(0, 60).map(e => (
        <li key={e._id} className={e.outcome}>
          <span className="src">{SOURCE[e.source]}</span>
          <span className="body"><b>{EVENT_LABEL[e.kind]}{e.loc ? ` · ${e.loc.split(':')[1]}` : ''}</b><small>{e.note}</small><small>{time(e.at)}{e.camera ? ` · ${e.camera.split(':')[1]}` : ''}{e.device ? ` · ${e.device}` : ''}{e.simulated ? ' · simulated' : ''}</small></span>
          <span className="end"><OutcomeChip e={e} />{e.clip ? <button className="link" onClick={() => void openEventClip(e._id)}>▶ Clip</button> : e.camera ? <small className="gone">Clip deleted</small> : null}</span>
        </li>
      ))}</ol>
    </div>
  );
}

/** Tiles of every camera, drawn a few times a second in turn. */
function Wall({ cams, allowed }: { cams: Camera[]; allowed: boolean }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    if (!allowed || !cams.length) return;
    let i = 0, alive = true;
    const t = setInterval(() => {
      if (!alive || document.hidden) return;
      const c = cams[i % cams.length], el = refs.current[i % cams.length];
      i++;
      const ctx = el?.getContext('2d');
      if (ctx && el!.offsetParent) drawCctv(ctx, { camera: c, blur: true, at: new Date(), small: true });
    }, 140);
    return () => { alive = false; clearInterval(t); };
  }, [cams, allowed]);
  return (
    <div className="cpanel">
      <div className="ch"><b>Cameras</b><small>{allowed ? 'Tap a camera for the live view · faces blurred' : 'Your role sees detections, not footage'}</small></div>
      <div className="wall">{cams.map((c, n) => (
        <button key={c._id} className="tile" onClick={() => openCamera(c._id)} aria-label={`${c.code} · ${c.name}`}>
          {allowed ? <canvas ref={el => { refs.current[n] = el; }} width={320} height={180} /> : <span className="nofeed">Footage restricted</span>}
          <span className="cap"><b>{c.code}</b> {c.name}</span>
        </button>
      ))}</div>
    </div>
  );
}

function Trackers({ site }: { site: string }) {
  const tags = useQuery('trackers', { site }, { sort: { kind: 1, label: 1 } }).data;
  const ago = (iso?: string) => { if (!iso) return '—'; const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`; };
  return (
    <div className="cpanel">
      <div className="ch"><b>Tracker tags</b><small>UWB on trolleys and the forklift, BLE badges, RFID on high-value stock</small></div>
      <table className="report"><thead><tr><th>Tag</th><th>Tech</th><th>Zone</th><th className="num">Battery</th><th>Last seen</th></tr></thead>
        <tbody>{tags.map(t => <tr key={t._id}><td>{t.label}</td><td>{t.tech}</td><td>{t.kind === 'asset' ? 'In stock' : t.zone ?? '—'}</td><td className="num">{t.battery}%</td><td>{t.kind === 'asset' ? 'At the gate only' : ago(t.lastSeen)}</td></tr>)}</tbody></table>
    </div>
  );
}

function Rules({ site }: { site: string }) {
  const alerts = useQuery('alerts', { site, rule: { $exists: true } }).data;
  const since = Date.now() - 30 * 864e5;
  const by = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const a of alerts) if (Date.parse(a.at) >= since) { const v = m.get(a.rule!) ?? [0, 0]; v[0]++; if (a.status !== 'closed') v[1]++; m.set(a.rule!, v); }
    return m;
  }, [alerts, since]);
  return (
    <div className="cpanel">
      <div className="ch"><b>Rules · last 30 days</b><small>Alerts raised, and still open or acknowledged</small></div>
      <div className="rows">{(Object.keys(RULE_LABEL) as (keyof typeof RULE_LABEL)[]).map(r => {
        const [n, open] = by.get(r) ?? [0, 0];
        return <div key={r}><span>{RULE_LABEL[r]}</span><span>{n}{open ? <small style={{ display: 'inline', color: '#C8312B' }}> · {open} open</small> : null}</span></div>;
      })}</div>
    </div>
  );
}

export function LiveEvents({ site }: { site: string }) {
  const me = useDoc('users', useApp(s => s.user)).data;
  const cams = useQuery('cameras', { site }, { sort: { code: 1 } }).data;
  const sim = useSyncExternalStore(onSim, getSim);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { void loadStoreView(site); }, [site]);
  const groups = [...new Set(SCENARIOS.map(s => s.group))];
  const run = async (id: string) => {
    setBusy(id);
    try {
      const ev = await trigger(id, site);
      toast(`${EVENT_LABEL[ev.kind]} · ${ev.outcome === 'alert' ? 'alert raised' : ev.note}`, ev.clip ? { label: 'Watch clip', run: () => void openEventClip(ev._id) } : undefined);
    } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
  };
  if (!cams.length) return <p className="note">No cameras are set up at this site. The modelled stores at KTEC Chennai and ISU Sriperumbudur have them.</p>;
  return <>
    <div className="simbar">
      <span><b>{sim.on && sim.site === site ? 'Simulation running' : 'Simulation off'}</b><small>Demo devices: cameras, scanners, tags and a hazmat sensor · {sim.count} events this session</small></span>
      <div className="seg">
        <button className={sim.on && sim.site === site ? 'on' : ''} onClick={() => startSim(site, sim.speed)}>On</button>
        <button className={!sim.on ? 'on' : ''} onClick={stopSim}>Off</button>
      </div>
      <div className="seg">{([1, 5] as const).map(v => <button key={v} className={sim.speed === v ? 'on' : ''} onClick={() => startSim(site, v)}>{v}×</button>)}</div>
      <button className="btn" onClick={openScanner}>Scan a QR label</button>
    </div>
    <div className="scen">
      {groups.map(g => (
        <div key={g}><span className="eb">{g}</span>
          <div>{SCENARIOS.filter(s => s.group === g).map(s => <button key={s.id} className="btn" disabled={!!busy} onClick={() => void run(s.id)}>{busy === s.id ? '…' : s.label}</button>)}</div>
        </div>
      ))}
    </div>
    <div className="evgrid">
      <Feed site={site} />
      <div className="evside">
        <Wall cams={cams} allowed={canView(me)} />
        <Trackers site={site} />
        <Rules site={site} />
      </div>
    </div>
  </>;
}
