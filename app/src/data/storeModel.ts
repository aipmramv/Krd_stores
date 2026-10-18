// Electronics store (Building B2, floor L1) model: 4 rack rows × 12 bays × 4 levels.
import { LEGENDS, PARTS } from './sample';
import type { Bin, ColorMode, Part } from './types';

export const ROWS = 'ABCD';
export const BAYS = 12;
export const LEVELS = 4;

/** Deterministic pseudo-random value in [0,1) for a bin; stands in for live occupancy, ageing and so on. */
export const rnd = (a: number, b: number, c: number) => {
  const x = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return x - Math.floor(x);
};

export const binId = ({ r, i, k }: Bin) => `${ROWS[r]}-${String(i + 1).padStart(2, '0')}-${String(k + 1).padStart(2, '0')}`;

export function binColor(mode: ColorMode, { r, i, k }: Bin): string {
  const v = rnd(r, i, k), L = LEGENDS[mode];
  if (mode === 'occupancy') return v < .25 ? L[0][0] : v < .5 ? L[1][0] : v < .75 ? L[2][0] : v < .92 ? L[3][0] : L[4][0];
  if (mode === 'ageing') { const a = rnd(r + 5, i, k); return a < .4 ? L[0][0] : a < .7 ? L[1][0] : a < .88 ? L[2][0] : L[3][0]; }
  if (mode === 'project') { if (v > .85) return L[3][0]; return i < 4 ? L[0][0] : i < 7 ? L[1][0] : i < 10 ? L[2][0] : L[3][0]; }
  if (r < 2) return L[0][0];
  if (r === 2 && i > 7) return L[1][0];
  if (r === 3 && k === 0 && i > 8) return L[2][0];
  return L[3][0];
}

export const isReserved = ({ r, i, k }: Bin) => r === 1 && i > 1 && i < 4 && k === 3;

/** Bin D-05-04 holds the actuator that the sample put-away task targets. */
export const FEATURED_BIN: Bin = { r: 3, i: 4, k: 3 };
/** Bin C-10-04 carries the count-variance exception. */
export const EXCEPTION_BIN: Bin = { r: 2, i: 9, k: 3 };

export function partInBin(b: Bin): { part: Part; featured: boolean } {
  const featured = binId(b) === binId(FEATURED_BIN);
  return { part: featured ? PARTS[0] : PARTS[Math.floor(rnd(b.r, b.i, b.k) * 11) + 1], featured };
}
