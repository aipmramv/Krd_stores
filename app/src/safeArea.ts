// The part of the stage not covered by floating panels, in stage-relative pixels. Shared by the
// map (to centre a site where the 3D view will centre it) and the 3D camera's view offset.
export interface Rect { l: number; t: number; r: number; b: number }

export function stageSafeArea(): Rect {
  const stage = document.getElementById('stage');
  if (!stage) return { l: 0, t: 0, r: innerWidth, b: innerHeight };
  const base = stage.getBoundingClientRect();
  const H = document.documentElement, g = parseFloat(getComputedStyle(H).fontSize);
  const a = { l: g * .5, t: g * .5, r: base.width - g * .5, b: base.height - g * .5 };
  const rel = (id: string) => {
    const e = document.getElementById(id);
    if (!e || e.classList.contains('hidden')) return null;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.right <= base.left + 2 || r.left >= base.right - 2) return null;
    return { l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top };
  };
  const rail = rel('rail'), dr = rel('drawer'), tl = rel('timeline'), ct = rel('ctrls'), cr = rel('crumbsIn');
  if (rail) a.l = Math.max(a.l, rail.r + g * .5);
  if (cr) a.t = Math.max(a.t, cr.b + g * .5);
  if (tl) a.b = Math.min(a.b, tl.t - g * .5);
  if (H.classList.contains('portrait')) { if (dr) a.b = Math.min(a.b, dr.t - g * .5); }
  else { if (dr) a.r = Math.min(a.r, dr.l - g * .5); if (ct) a.r = Math.min(a.r, ct.l - g * .5); }
  return a;
}

/** Offset of the safe-area centre from the stage centre. */
export function safeCentreOffset(): [number, number] {
  const stage = document.getElementById('stage');
  if (!stage) return [0, 0];
  const a = stageSafeArea();
  return [(a.l + a.r) / 2 - stage.clientWidth / 2, (a.t + a.b) / 2 - stage.clientHeight / 2];
}

/** MapLibre zoom level of the map at the moment of the map ↔ 3D handoff (same scale as zoom-17 raster tiles). */
export const HANDOFF_ZOOM = 16;
/** Ground metres per CSS pixel on a MapLibre (512 px world) Web Mercator map at this latitude and zoom. */
export const metresPerPixel = (lat: number, zoom: number) => 78271.51696 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
