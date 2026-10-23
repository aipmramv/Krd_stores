// Event backbone: every camera detection, scan and tag reading comes in here. The event gets its
// camera and clip, the rules engine decides what it means, and the outcome is written back:
// evidence on the movement it confirms, or an alert in the alerts centre with the clip attached.
// With a server (VITE_API_URL) the server runs the same rules (POST /api/_ingest); the demo runs
// them in the browser.
import { db, newId } from '../db';
import type { SensorEvent } from '../db/schema';
import { camerasSeeing, pointOf } from './cameras';
import { evaluate } from './rules';

export type NewEvent = Omit<SensorEvent, '_id' | 'outcome' | 'note' | 'matched' | 'alert'>;
const CLIP_BEFORE = 10000, CLIP_AFTER = 15000;

/** The evidence clip for an event seen by a camera: 10 s before to 15 s after. */
export const clipFor = (camera: string, at: string) => ({ camera, from: new Date(Date.parse(at) - CLIP_BEFORE).toISOString(), to: new Date(Date.parse(at) + CLIP_AFTER).toISOString() });

export async function ingest(input: NewEvent): Promise<SensorEvent> {
  const ev = { ...input, _id: newId('EV') } as SensorEvent;
  const cams = await db.find('cameras', { site: ev.site });
  if (ev.source === 'cctv' && !ev.camera) { const p = pointOf(ev.loc); ev.camera = p ? camerasSeeing(p, cams)[0]?._id : undefined; }
  if (ev.camera && ev.clip === undefined) ev.clip = clipFor(ev.camera, ev.at);
  if (db.ingest) return db.ingest(ev);

  const since = new Date(Date.parse(ev.at) - 3600000).toISOString();
  const [movements, users, shipments, lots, events] = await Promise.all([
    db.find('movements', { site: ev.site }), db.find('users'), db.find('shipments', { $or: [{ from: ev.site }, { to: ev.site }] }),
    db.find('stockLots', { site: ev.site }), db.find('events', { site: ev.site, at: { $gte: since } }),
  ]);
  const o = evaluate(ev, { movements, users, shipments, cameras: cams, lots, events });
  Object.assign(ev, { outcome: o.outcome, note: o.note, matched: o.matched });
  if (o.alert) {
    const a = await db.insert('alerts', { site: ev.site, ...o.alert, status: 'open', at: ev.at, eventId: ev._id, loc: ev.loc }, 'AL');
    ev.alert = a._id;
    if (ev.clip) ev.clip = { ...ev.clip, held: true };
  }
  const m = o.matched ? movements.find(x => x._id === o.matched) : undefined;
  if (m) await db.update('movements', m._id, { evidence: [...(m.evidence ?? []), ev._id] });
  return db.insert('events', ev);
}

/** Keep a clip past the retention period because it is evidence (a case, a claim, an investigation). */
export async function holdClip(id: string, held = true) {
  const ev = await db.get('events', id);
  if (!ev?.clip) throw new Error('This event has no clip (it may have passed the retention period)');
  return db.update('events', id, { clip: { ...ev.clip, held } });
}

/** Apply the retention policy: delete clips older than the period unless held. */
export async function applyRetention(days = 30, now = Date.now()) {
  const old = await db.find('events', { at: { $lt: new Date(now - days * 86400000).toISOString() } });
  let n = 0;
  for (const e of old) if (e.clip && !e.clip.held) { await db.update('events', e._id, { clip: null }); n++; }
  return n;
}
