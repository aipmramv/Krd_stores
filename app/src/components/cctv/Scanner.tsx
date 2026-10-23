// QR / barcode scanner for the store floor. Reads the labels the app prints (KONE:BIN:<site:bin>
// and KONE:LOT:<lot id>) with the phone camera where the browser has a barcode detector, or from
// typed input. Scan the bin first, then the lot: each scan goes through the event backbone, so it
// confirms the work in progress or flags a lot in the wrong bin.
import { useEffect, useRef, useState } from 'react';
import { binOf } from '../../data/storeModel';
import { db } from '../../db';
import { useDoc } from '../../db/hooks';
import type { SensorEvent } from '../../db/schema';
import { ingest } from '../../services/events';
import { closeOverlay, findInStore } from '../../state/actions';
import { useApp } from '../../state/store';
import { OutcomeChip } from './EventFeed';

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;

export function Scanner() {
  const site = useApp(s => s.site), me = useDoc('users', useApp(s => s.user)).data;
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<'off' | 'on' | 'none'>('off'), [code, setCode] = useState('');
  // The bin scanned last: a ref, because a lot scan can follow straight after in the same handler.
  const atBinRef = useRef<string | null>(null), [atBin, setAtBin] = useState<string | null>(null), [log, setLog] = useState<SensorEvent[]>([]);
  const last = useRef('');

  const scan = async (raw: string) => {
    const c = raw.trim();
    if (!c || c === last.current) return;
    last.current = c;
    setTimeout(() => { if (last.current === c) last.current = ''; }, 2500);
    const bin = /^KONE:BIN:(.+)$/.exec(c)?.[1], lotId = /^KONE:LOT:(.+)$/.exec(c)?.[1];
    if (!bin && !lotId) { setLog(l => [{ _id: c, note: `Not a KONE label: ${c}`, outcome: 'ignored', kind: 'scan' } as SensorEvent, ...l]); return; }
    const lot = lotId ? await db.get('stockLots', lotId) : null;
    const loc = bin ?? atBinRef.current ?? lot?.locationId;
    if (bin) { atBinRef.current = bin; setAtBin(bin); }
    navigator.vibrate?.(20);
    const ev = await ingest({ site: (loc ?? site).split(':')[0], at: new Date().toISOString(), source: 'scan', kind: 'scan', device: `Phone · ${me?.name ?? 'scanner'}`, code: c, loc, person: me?._id });
    setLog(l => [ev, ...l].slice(0, 6));
  };

  useEffect(() => {
    if (cam !== 'on') return;
    let stream: MediaStream | null = null, alive = true;
    const det = Detector ? new Detector({ formats: ['qr_code', 'code_128', 'ean_13'] }) : null;
    void navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' } }).then(s => {
      stream = s;
      if (!alive) { s.getTracks().forEach(t => t.stop()); return; }
      video.current!.srcObject = s; void video.current!.play();
      const tick = async () => {
        if (!alive) return;
        if (det && video.current && video.current.readyState >= 2) { try { const r = await det.detect(video.current); if (r[0]) await scan(r[0].rawValue); } catch { /* frame not ready */ } }
        setTimeout(() => void tick(), 250);
      };
      void tick();
    }).catch(() => setCam('none'));
    return () => { alive = false; stream?.getTracks().forEach(t => t.stop()); };
  }, [cam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quick scans for the demo: the move in progress, and a lot in the wrong bin.
  const demo = async (k: 'bin' | 'lot' | 'wrong') => {
    const work = (await db.find('movements', { site, status: { $in: ['requested', 'approved'] } })).find(m => m.startedAt && m.lotId && binOf(m.from));
    if (k === 'wrong') {
      const lot = (await db.find('stockLots', { site })).find(l => binOf(l.locationId) && l.locationId !== work?.from);
      const b = binOf(lot?.locationId)!, other = `${site}:${'ABCD'[b.r]}-${String(b.i + 1).padStart(2, '0')}-${String(((b.k + 1) % 4) + 1).padStart(2, '0')}`;
      await scan(`KONE:BIN:${other}`); last.current = ''; await scan(`KONE:LOT:${lot!._id}`);
      return;
    }
    if (!work) { setLog(l => [{ _id: 'none', note: 'No work in progress to scan · start a task on the Live board', outcome: 'ignored', kind: 'scan' } as SensorEvent, ...l]); return; }
    await scan(k === 'bin' ? `KONE:BIN:${work.from}` : `KONE:LOT:${work.lotId}`);
  };

  return (
    <div className="scanner" role="dialog" aria-label="Scan a QR label">
      <div className="cv-hd"><span className="eb">Scan · bin first, then the lot</span><button className="x" onClick={closeOverlay} aria-label="Close">×</button></div>
      <div className="sc-view">
        {cam === 'on' ? <video ref={video} playsInline muted /> : (
          <div className="sc-off">
            <b>{cam === 'none' ? 'The camera is not available here' : 'Point the camera at a KONE label'}</b>
            <span>{Detector ? 'This browser can read QR codes from the camera.' : 'This browser has no built-in QR reader: type the code, or use a quick scan below.'}</span>
            {cam === 'off' && Detector && <button className="btn primary" onClick={() => setCam('on')}>Start camera</button>}
          </div>
        )}
        {atBin && <span className="sc-at">At bin {atBin.split(':')[1]}</span>}
      </div>
      <form className="sc-type" onSubmit={e => { e.preventDefault(); void scan(code); setCode(''); }}>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="KONE:BIN:ktec:D-05-04 or KONE:LOT:…" aria-label="Code" />
        <button className="btn primary" type="submit">Scan</button>
      </form>
      <div className="acts">
        <button className="btn" onClick={() => void demo('bin')}>Quick scan · bin of the move in progress</button>
        <button className="btn" onClick={() => void demo('lot')}>Its lot</button>
        <button className="btn" onClick={() => void demo('wrong')}>A lot in the wrong bin</button>
      </div>
      <ol className="sc-log">{log.map((e, i) => (
        <li key={e._id + i}><OutcomeChip e={e} /><span>{e.note}</span>
          {e.loc && binOf(e.loc) && <button className="link" onClick={() => { closeOverlay(); findInStore(e.site, e.loc); }}>Open bin</button>}</li>
      ))}</ol>
    </div>
  );
}
