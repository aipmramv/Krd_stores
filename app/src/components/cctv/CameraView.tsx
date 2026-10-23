// Camera viewer: the live view from a camera (virtual CCTV rendered from the twin) or the clip of
// an event, with its detections. Access by role, every opening audited, faces blurred unless an
// authorised viewer unblurs them (with a reason, audited), and clips can be held as evidence.
import { useEffect, useRef, useState } from 'react';
import { SITE_BY_ID } from '../../data/sites';
import { auditAccess } from '../../db';
import { useDoc, useQuery } from '../../db/hooks';
import { ROLE_LABEL, type SensorEvent } from '../../db/schema';
import { holdClip } from '../../services/events';
import { canHold, canUnblur, canView, PRIVACY_NOTE } from '../../services/privacy';
import { RULE_LABEL } from '../../services/rules';
import { loadStoreView } from '../../services/storeView';
import { closeOverlay, findInStore, openCamera, openEventClip, setAlertStatus, toast } from '../../state/actions';
import { useApp } from '../../state/store';
import { drawCctv } from '../../three/cctv';
import { EVENT_LABEL, OutcomeChip } from './EventFeed';

const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

function Screen({ camId, ev, blur }: { camId: string; ev: SensorEvent | null; blur: boolean }) {
  const cam = useDoc('cameras', camId).data, ref = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true), [t, setT] = useState(0), tRef = useRef(0), [failed, setFailed] = useState(false);
  const total = ev?.clip ? Math.round((Date.parse(ev.clip.to) - Date.parse(ev.clip.from)) / 1000) : 0;
  useEffect(() => { tRef.current = 0; setT(0); }, [ev?._id]);
  useEffect(() => {
    if (!cam) return;
    void loadStoreView(cam.site);
    let raf = 0, last = 0, prev = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 66) return; // about 15 fps
      const dt = (now - prev) / 1000; prev = now; last = now;
      const ctx = ref.current?.getContext('2d');
      if (!ctx) return;
      if (ev?.clip && playing) { tRef.current = (tRef.current + dt) % total; setT(tRef.current); }
      const at = ev?.clip ? new Date(Date.parse(ev.clip.from) + tRef.current * 1000) : new Date();
      const label = ev ? (ev.alert ? `${EVENT_LABEL[ev.kind]} · ALERT` : EVENT_LABEL[ev.kind]) : '';
      // The detection box shows from the moment of the event (10 s into the clip).
      const showBox = ev?.clip ? Math.abs(tRef.current - 10) < 6 || !playing : false;
      if (!drawCctv(ctx, { camera: cam, blur, at, clip: ev?.clip ? { label, loc: showBox ? ev.loc : undefined, t: tRef.current, total } : undefined })) setFailed(true);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cam, ev, blur, playing, total]);
  if (failed) return <p className="note">This browser cannot render the camera view (WebGL is off).</p>;
  return <>
    <canvas ref={ref} width={960} height={540} className="cctv" aria-label={`${cam?.code} ${ev ? 'clip' : 'live view'}`} />
    {ev?.clip && (
      <div className="clipbar">
        <button className="btn" onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        <input type="range" min={0} max={total} step={.1} value={t} aria-label="Clip position" onChange={e => { tRef.current = +e.target.value; setT(+e.target.value); setPlaying(false); }} />
        <span>{Math.floor(t)} s / {total} s · event at 10 s</span>
      </div>
    )}
  </>;
}

export function CameraView({ id, eventId }: { id: string; eventId?: string }) {
  const me = useDoc('users', useApp(s => s.user)).data;
  const cam = useDoc('cameras', id).data, ev = useDoc('events', eventId ?? null).data ?? null;
  const alert = useDoc('alerts', ev?.alert ?? null).data;
  const others = useQuery('cameras', { site: cam?.site ?? '-' }, { sort: { code: 1 } }).data;
  const recent = useQuery('events', { camera: id }, { sort: { at: -1 }, limit: 8 }).data;
  const [blur, setBlur] = useState(true);
  const allowed = canView(me);
  // Opening footage is audited (who, which camera or clip, when).
  useEffect(() => {
    if (allowed && cam) void auditAccess('view', ev ? 'events' : 'cameras', ev?._id ?? cam._id, { mode: ev ? 'clip' : 'live' });
  }, [allowed, cam?._id, ev?._id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!cam) return null;
  const unblur = async () => {
    const reason = window.prompt('Reason for unblurring faces (kept in the audit log)');
    if (!reason?.trim()) return;
    await auditAccess('unblur', ev ? 'events' : 'cameras', ev?._id ?? cam._id, { reason: reason.trim() });
    setBlur(false);
    toast('Faces unblurred · recorded in the audit log');
  };
  const retention = ev?.clip && (ev.clip.held ? 'Held as evidence · kept past the 30-day period' : `Deleted on ${new Date(Date.parse(ev.at) + 30 * 864e5).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} unless held`);
  return (
    <div className="camview" role="dialog" aria-label={`${cam.code} · ${cam.name}`}>
      <div className="cv-main">
        {allowed ? <Screen camId={cam._id} ev={ev?.clip ? ev : null} blur={blur} /> : (
          <div className="cv-deny"><b>Footage is restricted</b><span>{me ? ROLE_LABEL[me.role] : 'Your role'} can see detections and the event log, not camera footage. Ask the store manager or EHS.</span></div>
        )}
        <div className="cv-cams">{others.map(c => <button key={c._id} className={`btn${c._id === cam._id ? ' on' : ''}`} onClick={() => openCamera(c._id)}>{c.code}</button>)}</div>
      </div>
      <aside className="cv-side">
        <div className="cv-hd"><span className="eb">{SITE_BY_ID[cam.site]?.short} · {cam.code} · {cam.status}</span><button className="x" onClick={closeOverlay} aria-label="Close">×</button></div>
        <h2>{ev ? EVENT_LABEL[ev.kind] : cam.name}</h2>
        {ev ? <>
          <p className="cv-sub">{fmt(ev.at)} · {cam.name}</p>
          <OutcomeChip e={ev} />
          <p className="cv-note">{alert?.detail ?? ev.note}</p>
          {alert && <div className="acts">
            {alert.status === 'open' && <button className="btn" onClick={() => void setAlertStatus(alert._id, 'ack')}>Acknowledge</button>}
            {alert.status !== 'closed' && <button className="btn" onClick={() => void setAlertStatus(alert._id, 'closed')}>Close alert</button>}
            {alert.rule && <span className="chip">{RULE_LABEL[alert.rule]}</span>}
          </div>}
          {ev.loc && <button className="link" onClick={() => { closeOverlay(); findInStore(ev.site, ev.loc); }}>Show {ev.loc.split(':')[1]} in the store twin</button>}
          {retention && <p className="cv-ret">{retention}</p>}
          {ev.clip && canHold(me) && <button className="btn" onClick={() => void holdClip(ev._id, !ev.clip!.held).then(() => toast(ev.clip!.held ? 'Hold released · normal retention applies' : 'Clip held as evidence'))}>{ev.clip.held ? 'Release hold' : 'Hold as evidence'}</button>}
          <button className="btn" onClick={() => openCamera(cam._id)}>Live view</button>
        </> : <>
          <p className="cv-sub">Analytics: {cam.analytics.map(k => EVENT_LABEL[k]).join(' · ')}</p>
        </>}
        {allowed && (blur ? (canUnblur(me) ? <button className="btn" onClick={() => void unblur()}>Unblur faces…</button> : null) : <button className="btn" onClick={() => setBlur(true)}>Blur faces again</button>)}
        <div className="st"><span className="eb ink">Recent on this camera</span></div>
        <div className="cv-recent">{recent.map(e => (
          <button key={e._id} className={`task${e._id === ev?._id ? ' on' : ''}`} onClick={() => void openEventClip(e._id)} disabled={!e.clip}>
            <span className={`dot ${e.outcome}`} /><span><b>{EVENT_LABEL[e.kind]}</b><small>{fmt(e.at)} · {e.note}</small></span><span aria-hidden>{e.clip ? '▶' : ''}</span>
          </button>
        ))}</div>
        <p className="cv-priv">{PRIVACY_NOTE}</p>
      </aside>
    </div>
  );
}
