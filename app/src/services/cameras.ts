// Camera coverage in the store twin: which cameras see a bin or an area, so a tap on a bin can
// open "the camera watching this bin" and every event gets the right camera and clip.
import { binOf } from '../data/storeModel';
import type { Camera } from '../db/schema';
import { AREA_XZ, binX, ROWZ } from './storeOps';

export type V3 = [number, number, number];
const LV = 1.55;

/** A location id or code as a point in the store (bin centre or area centre at waist height). */
export function pointOf(loc?: string): V3 | null {
  const b = binOf(loc);
  if (b) return [binX(b), .95 + b.k * LV, ROWZ[b.r]];
  const a = AREA_XZ[loc?.split(':').pop() ?? ''];
  return a ? [a[0], 1, a[1]] : null;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: V3) => Math.hypot(...a);

/** Cameras whose view cone holds the point, best view (closest to the centre of the image) first. */
export function camerasSeeing(p: V3, cams: Camera[], aspect = 16 / 9): Camera[] {
  return cams
    .filter(c => c.status === 'online')
    .map(c => {
      const d = sub(p, c.pos), f = sub(c.look, c.pos), dist = len(d);
      const ang = Math.acos(Math.max(-1, Math.min(1, (d[0] * f[0] + d[1] * f[1] + d[2] * f[2]) / (dist * len(f) || 1)))) * 180 / Math.PI;
      // Horizontal half-angle of the view (fov is vertical).
      const half = Math.atan(Math.tan((c.fov / 2) * Math.PI / 180) * aspect) * 180 / Math.PI;
      return { c, k: ang / half, dist };
    })
    .filter(x => x.k <= .95 && x.dist < 45)
    .sort((a, b) => a.k - b.k)
    .map(x => x.c);
}

/** Default camera set for a modelled store: entrance and dock, three aisles, hazmat and quarantine. */
export function storeCameras(site: string, stamp: (d: Camera) => Camera): Camera[] {
  const cam = (n: number, name: string, pos: V3, look: V3, fov: number, analytics: Camera['analytics']) =>
    stamp({ _id: `${site}:CAM-0${n}`, site, code: `CAM-0${n}`, name, pos, look, fov, status: 'online', analytics });
  return [
    cam(1, 'Dock door and inbound staging', [-23, 7, 16.5], [-2, 0, 11], 62, ['vehicle_arrived', 'boxes_counted', 'bin_put', 'motion', 'aisle_blocked']),
    cam(2, 'Aisle A · ESD area', [-23.5, 7.5, -16.5], [2, 1, -9], 56, ['bin_take', 'bin_put', 'no_esd_coat', 'motion']),
    cam(3, 'Centre aisle · racks B and C', [23, 7.5, 0], [-8, 1.5, 0], 50, ['bin_take', 'bin_put', 'forklift_speed', 'aisle_blocked']),
    cam(4, 'Aisle D', [23, 7.5, 16], [-4, 1, 9], 54, ['bin_take', 'bin_put', 'motion']),
    cam(5, 'Hazmat cabinet', [23.5, 6, 9.5], [19, 0, 3.5], 64, ['zone_entry', 'smoke', 'motion']),
    cam(6, 'Quarantine cage', [23.5, 6, -16], [19, 0, -8.5], 64, ['zone_entry', 'motion']),
  ];
}
