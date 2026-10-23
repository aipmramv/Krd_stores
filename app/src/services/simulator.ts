// Demo stand-in for the real devices: produces camera detections, scans and tag readings for the
// modelled stores, so the event backbone, rules and alerts can be seen working without hardware.
// Background activity is mostly ordinary (work in progress seen by cameras, scans, authorised
// entries) with the occasional exception; every scenario can also be triggered on demand.
// Real cameras, scanners and tags replace this by posting the same events.
import { binId, binOf } from '../data/storeModel';
import { db } from '../db';
import type { SensorEvent } from '../db/schema';
import { camerasSeeing, pointOf } from './cameras';
import { ingest, applyRetention, type NewEvent } from './events';
import { livePositions } from './live';

export interface SimState { on: boolean; speed: 1 | 5; site: string; count: number }
let state: SimState = { on: false, speed: 1, site: 'ktec', count: 0 };
const subs = new Set<() => void>();
export const getSim = () => state;
export const onSim = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const set = (p: Partial<SimState>) => { state = { ...state, ...p }; subs.forEach(f => f()); };

type Listener = (e: SensorEvent) => void;
const evSubs = new Set<Listener>();
/** Every event the simulator (or a scenario) produced, after the rules ran. */
export const onSimEvent = (f: Listener) => { evSubs.add(f); return () => { evSubs.delete(f); }; };

const now = () => new Date().toISOString();
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const base = (site: string): Pick<NewEvent, 'site' | 'at' | 'simulated'> => ({ site, at: now(), simulated: true });

async function quietBin(site: string) {
  const [lots, cams, mv] = await Promise.all([db.find('stockLots', { site }), db.find('cameras', { site }), db.find('movements', { site, status: { $in: ['requested', 'approved'] } })]);
  const busy = new Set(mv.flatMap(m => [m.from, m.to]));
  const ok = lots.filter(l => binOf(l.locationId) && l.qty > 2 && !busy.has(l.locationId) && camerasSeeing(pointOf(l.locationId)!, cams).length);
  return ok.length ? pick(ok) : null;
}
const inProgress = async (site: string) => (await db.find('movements', { site, status: { $in: ['requested', 'approved'] } })).filter(m => m.startedAt);

export interface Scenario { id: string; label: string; group: 'Movements' | 'Access' | 'Safety' | 'Dock' | 'Tags and sensors'; make: (site: string) => Promise<NewEvent | null> }
export const SCENARIOS: Scenario[] = [
  { id: 'recorded', label: 'Recorded pick (matches)', group: 'Movements', make: async site => {
    const m = pick(await inProgress(site));
    return m ? { ...base(site), source: 'cctv', kind: 'bin_take', loc: m.from, qty: m.qty, conf: .93, person: m.assignee ?? undefined } : null;
  } },
  { id: 'unrecorded', label: 'Unrecorded removal', group: 'Movements', make: async site => {
    const l = await quietBin(site);
    return l ? { ...base(site), source: 'cctv', kind: 'bin_take', loc: l.locationId, qty: 1 + Math.floor(Math.random() * 3), conf: .91 } : null;
  } },
  { id: 'wrong_bin', label: 'Lot scanned in the wrong bin', group: 'Movements', make: async site => {
    const l = await quietBin(site), b = binOf(l?.locationId);
    if (!l || !b) return null;
    const other = `${site}:${binId({ ...b, k: (b.k + 1) % 4 })}`;
    return { ...base(site), source: 'scan', kind: 'scan', device: 'Phone scanner', loc: other, code: `KONE:LOT:${l._id}` };
  } },
  { id: 'hazmat', label: 'Unbadged entry · hazmat', group: 'Access', make: async site => ({ ...base(site), source: 'cctv', kind: 'zone_entry', loc: `${site}:Hazmat H-01`, camera: `${site}:CAM-05`, conf: .89 }) },
  { id: 'quarantine', label: 'Clerk enters quarantine', group: 'Access', make: async site => ({ ...base(site), source: 'cctv', kind: 'zone_entry', loc: `${site}:Quarantine Q-01`, camera: `${site}:CAM-06`, person: 'dj', conf: .9 }) },
  { id: 'after_hours', label: 'Motion after hours', group: 'Access', make: async site => {
    const d = new Date(Date.now() + 5.5 * 3600000); d.setUTCHours(2, 10, 0, 0);
    return { ...base(site), at: new Date(d.getTime() - 5.5 * 3600000).toISOString(), source: 'cctv', kind: 'motion', loc: `${site}:Inbound staging`, camera: `${site}:CAM-01`, conf: .95 };
  } },
  { id: 'esd', label: 'No ESD coat', group: 'Safety', make: async site => ({ ...base(site), source: 'cctv', kind: 'no_esd_coat', loc: `${site}:A-0${2 + Math.floor(Math.random() * 7)}-01`, camera: `${site}:CAM-02`, person: pick(['si', 'dj', 'lp']), conf: .87 }) },
  { id: 'forklift', label: 'Forklift speeding', group: 'Safety', make: async site => ({ ...base(site), source: 'cctv', kind: 'forklift_speed', loc: `${site}:B-06-01`, camera: `${site}:CAM-03`, tag: 'Forklift FL-01', value: 10 + Math.floor(Math.random() * 4), qty: Math.floor(Math.random() * 3), conf: .9 }) },
  { id: 'aisle', label: 'Blocked aisle', group: 'Safety', make: async site => ({ ...base(site), source: 'cctv', kind: 'aisle_blocked', loc: `${site}:C-05-01`, camera: `${site}:CAM-03`, value: 7, conf: .88 }) },
  { id: 'smoke', label: 'Smoke', group: 'Safety', make: async site => ({ ...base(site), source: 'cctv', kind: 'smoke', loc: `${site}:Hazmat H-01`, camera: `${site}:CAM-05`, conf: .83 }) },
  { id: 'truck', label: 'Unexpected truck', group: 'Dock', make: async site => ({ ...base(site), source: 'cctv', kind: 'vehicle_arrived', loc: `${site}:Inbound staging`, camera: `${site}:CAM-01`, carrier: 'Porter', plate: `TN 09 BX ${1000 + Math.floor(Math.random() * 8999)}`, conf: .92 }) },
  { id: 'boxes', label: 'Short delivery', group: 'Dock', make: async site => {
    const s = (await db.find('shipments', { to: site })).find(x => !['Delivered', 'Cancelled'].includes(x.status));
    if (!s) return null;
    const n = s.items.reduce((k, i) => k + i.qty, 0);
    return { ...base(site), source: 'cctv', kind: 'boxes_counted', loc: `${site}:Inbound staging`, camera: `${site}:CAM-01`, ref: s._id, qty: Math.max(0, n - 2), conf: .9 };
  } },
  { id: 'temperature', label: 'Hazmat 32 °C', group: 'Tags and sensors', make: async site => ({ ...base(site), source: 'sensor', kind: 'temperature', device: 'TH-02 · hazmat cabinet', loc: `${site}:Hazmat H-01`, value: 32.4 }) },
  { id: 'asset', label: 'Tagged asset leaves', group: 'Tags and sensors', make: async site => ({ ...base(site), source: 'rfid', kind: 'tag_exit', device: 'Door gate G-1', loc: `${site}:Inbound staging`, tag: 'Controller boards · RFID', ref: 'KM-MS-CTL-118' }) },
];

/** Run one scenario now. */
export async function trigger(id: string, site = state.site) {
  const s = SCENARIOS.find(x => x.id === id);
  const input = s && await s.make(site);
  if (!input) throw new Error(`${s?.label ?? id}: nothing suitable in this store right now`);
  return emit(input);
}
async function emit(input: NewEvent) {
  const ev = await ingest(input);
  set({ count: state.count + 1 });
  evSubs.forEach(f => f(ev));
  return ev;
}

/** Ordinary background activity: work seen by cameras, scans, authorised entries, motion. */
async function ordinary(site: string): Promise<NewEvent | null> {
  const r = Math.random(), work = await inProgress(site);
  if (r < .45 && work.length) { const m = pick(work); return { ...base(site), source: 'cctv', kind: Math.random() < .7 ? 'bin_take' : 'bin_put', loc: Math.random() < .7 ? m.from : m.to, qty: m.qty, conf: .8 + Math.random() * .18, person: m.assignee ?? undefined }; }
  if (r < .6 && work.length) { const m = pick(work); return { ...base(site), source: 'scan', kind: 'scan', device: 'Phone scanner', loc: m.from, code: `KONE:LOT:${m.lotId}`, person: m.assignee ?? undefined }; }
  if (r < .7) return { ...base(site), source: 'cctv', kind: 'zone_entry', loc: `${site}:Hazmat H-01`, camera: `${site}:CAM-05`, person: 'mk', conf: .94 };
  if (r < .8) return { ...base(site), source: 'sensor', kind: 'temperature', device: 'TH-02 · hazmat cabinet', loc: `${site}:Hazmat H-01`, value: Math.round((24 + Math.random() * 4) * 10) / 10 };
  return { ...base(site), source: 'cctv', kind: 'motion', loc: `${site}:Inbound staging`, camera: `${site}:CAM-01`, conf: .9 };
}

/** Tag readings: positions of trolleys, badges and the forklift (see services/live.ts). */
async function readTags(site: string) {
  const [trackers, work] = await Promise.all([db.find('trackers', { site }), inProgress(site)]);
  const at = now();
  for (const p of livePositions(trackers, work, Date.now() / 1000)) {
    await db.update('trackers', p.id, { x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, zone: p.zone, lastSeen: at });
  }
}

/** Keep the demo log bounded: drop the oldest ordinary events beyond `max`. */
async function trim(max = 700) {
  const all = await db.find('events', {}, { sort: { at: -1 } });
  for (const e of all.slice(max)) if (!e.alert && !e.clip?.held) await db.remove('events', e._id);
}

let timers: ReturnType<typeof setInterval>[] = [];
let busy = false;
export function startSim(site = state.site, speed: SimState['speed'] = state.speed) {
  stopSim();
  set({ on: true, site, speed });
  void applyRetention().then(() => trim());
  const step = async () => {
    if (busy || document.hidden) return;
    busy = true;
    try {
      // About one exception in eight; the rest is ordinary work.
      const input = Math.random() < .12 ? await pick(SCENARIOS.filter(s => !['recorded', 'smoke', 'after_hours'].includes(s.id))).make(site) : await ordinary(site);
      if (input) await emit(input);
    } catch (e) { console.warn('simulator', e); } finally { busy = false; }
  };
  timers = [setInterval(() => void step(), 10000 / speed), setInterval(() => { if (!document.hidden) void readTags(site); }, 5000)];
  void readTags(site);
}
export function stopSim() { timers.forEach(clearInterval); timers = []; if (state.on) set({ on: false }); }
export const setSimSite = (site: string) => { if (state.on && site !== state.site) startSim(site); else set({ site }); };
