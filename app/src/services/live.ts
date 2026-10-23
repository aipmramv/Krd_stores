// Live positions of tracked things on the store floor (UWB trolleys and forklift, BLE badges),
// as a pure function of time and the work in progress. The store twin draws them, the virtual
// CCTV detects people from them and the simulator reports them as tag readings, so all three agree.
// With real tags this is replaced by the latest reading per tag.
import { binOf } from '../data/storeModel';
import type { Movement, Tracker } from '../db/schema';
import { accessPoint, AREA_XZ, route, type P } from './storeOps';

export interface LivePos {
  id: string; label: string; kind: Tracker['kind']; x: number; z: number; zone: string;
  user?: string; task?: string; moving: boolean;
}

const SPEED = 1.1; // m/s walking with a trolley
const PAUSE = 8;   // s at each end (picking, putting away)

const pointOf = (loc?: string): P | null => {
  const b = binOf(loc);
  if (b) return accessPoint(b);
  return AREA_XZ[loc?.split(':').pop() ?? ''] ?? null;
};

function along(pts: P[], d: number): P {
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i], l = Math.hypot(x1 - x0, z1 - z0);
    if (d <= l) return [x0 + (x1 - x0) * d / (l || 1), z0 + (z1 - z0) * d / (l || 1)];
    d -= l;
  }
  return pts[pts.length - 1];
}

/** Back and forth along a route: pause, go, pause, come back. */
function shuttle(pts: P[], len: number, t: number, phase = 0): { p: P; moving: boolean } {
  const go = len / SPEED, cycle = 2 * (go + PAUSE), k = ((t + phase) % cycle + cycle) % cycle;
  if (k < PAUSE) return { p: pts[0], moving: false };
  if (k < PAUSE + go) return { p: along(pts, (k - PAUSE) * SPEED), moving: true };
  if (k < 2 * PAUSE + go) return { p: pts[pts.length - 1], moving: false };
  return { p: along(pts, len - (k - 2 * PAUSE - go) * SPEED), moving: true };
}

/** Which part of the store a floor point is in. */
export function zoneOf(x: number, z: number): string {
  if (x > 16.5) return z < -3 ? 'Quarantine cage' : z < 9 ? 'Hazmat cabinet' : 'East cross aisle';
  if (z > 11.2) return 'Inbound staging';
  if (z < -11) return 'Aisle A · ESD';
  if (Math.abs(z) < 1.5) return 'Centre aisle';
  if (z > 10) return 'Aisle D';
  if (x < -16.5) return 'West cross aisle';
  return `Rack ${z < -6 ? 'A' : z < 0 ? 'B' : z < 6 ? 'C' : 'D'}`;
}

const IDLE: P[] = [[-20, 15], [-14, 15.5], [-9, 15], [-4, 15.8], [2, 15.2]];

/**
 * Where every tracker is at time `t` (seconds). Trolleys take the started work in order, with the
 * assignee's badge walking beside; other badges stand near inbound staging; the forklift patrols
 * the back aisle.
 */
export function livePositions(trackers: Tracker[], work: Movement[], t: number): LivePos[] {
  const out: LivePos[] = [];
  const tasks = work.filter(m => m.startedAt && m.status !== 'done' && pointOf(m.from) && pointOf(m.to)).sort((a, b) => a._id.localeCompare(b._id));
  const trolleys = trackers.filter(x => x.kind === 'trolley').sort((a, b) => a._id.localeCompare(b._id));
  const walking = new Map<string, LivePos>();
  trolleys.forEach((tr, i) => {
    const m = tasks[i];
    if (m) {
      const r = route(pointOf(m.from)!, pointOf(m.to)!), { p, moving } = shuttle(r.pts, r.len, t, i * 23);
      const pos: LivePos = { id: tr._id, label: tr.label, kind: 'trolley', x: p[0], z: p[1], zone: zoneOf(p[0], p[1]), task: m._id, user: m.assignee ?? undefined, moving };
      out.push(pos);
      if (m.assignee) walking.set(m.assignee, pos);
    } else {
      const [x, z] = IDLE[i % IDLE.length];
      out.push({ id: tr._id, label: tr.label, kind: 'trolley', x, z: z - 1.2, zone: zoneOf(x, z), moving: false });
    }
  });
  let idle = 0;
  for (const b of trackers.filter(x => x.kind === 'badge')) {
    const w = b.user ? walking.get(b.user) : undefined;
    if (w) { out.push({ id: b._id, label: b.label, kind: 'badge', x: w.x - .9, z: w.z + .5, zone: w.zone, user: b.user, task: w.task, moving: w.moving }); continue; }
    const [x, z] = IDLE[(idle++ + 2) % IDLE.length], sway = Math.sin(t / 7 + idle) * .6;
    out.push({ id: b._id, label: b.label, kind: 'badge', x: x + sway, z, zone: zoneOf(x, z), user: b.user, moving: false });
  }
  for (const f of trackers.filter(x => x.kind === 'forklift')) {
    const pts: P[] = [[-18.5, 12], [18.5, 12]], { p, moving } = shuttle(pts, 37, t, 11);
    out.push({ id: f._id, label: f.label, kind: 'forklift', x: p[0], z: p[1], zone: zoneOf(p[0], p[1]), moving });
  }
  return out;
}
