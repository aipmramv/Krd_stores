// Material flow analytics from finished movements: where stock comes from and goes to (for the
// Sankey), when the store is busy (day × hour in IST), and the units in one bin over time.
import type { Movement } from '../db/schema';

const DAY = 86400000, IST = 5.5 * 3600000;
const ts = (iso?: string | null) => (iso ? Date.parse(iso) : 0);

/** A location as a flow node: racks by row, areas by kind. */
export function nodeOf(loc: string | undefined, side: 'from' | 'to', type: Movement['type']): string {
  if (!loc) return side === 'to' && type === 'pick' ? 'Picked out' : 'Inbound';
  const code = loc.split(':').pop()!;
  const rack = /^([A-D])-\d\d-\d\d$/.exec(code);
  if (rack) return `Rack ${rack[1]}`;
  if (/Inbound/.test(code)) return 'Inbound';
  if (/^Lab|Test/.test(code)) return 'Lab and test';
  if (/Quarantine/.test(code)) return 'Quarantine';
  if (/Hazmat/.test(code)) return 'Hazmat';
  if (/Yard|Scrap/.test(code)) return 'Scrap yard';
  return code;
}

export interface Flow { source: string; target: string; qty: number; n: number }
/** Units moved between nodes by work finished since `since`. */
export function flows(movements: Movement[], since: number): Flow[] {
  const m = new Map<string, Flow>();
  for (const mv of movements) {
    if (mv.status !== 'done' || ts(mv.updatedAt) < since || !['pick', 'putaway', 'move', 'issue', 'transfer'].includes(mv.type)) continue;
    const source = nodeOf(mv.from, 'from', mv.type), target = nodeOf(mv.to, 'to', mv.type);
    if (source === target) continue;
    const k = `${source}→${target}`, f = m.get(k) ?? { source, target, qty: 0, n: 0 };
    f.qty += Math.abs(mv.qty); f.n++;
    m.set(k, f);
  }
  return [...m.values()].sort((a, b) => b.qty - a.qty);
}

/** Finished movements by weekday (0 = Monday) and hour of day, IST. */
export function busyHours(movements: Movement[], since: number): number[][] {
  const g = Array.from({ length: 7 }, () => Array(24).fill(0) as number[]);
  for (const mv of movements) {
    const t = ts(mv.updatedAt);
    if (mv.status !== 'done' || t < since) continue;
    const d = new Date(t + IST);
    g[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++;
  }
  return g;
}

/** Signed change in units at a location from one finished movement. */
export function delta(mv: Movement, loc: string): number {
  if (mv.status !== 'done') return 0;
  if (mv.type === 'count') return mv.from === loc && mv.counted !== undefined ? mv.counted - mv.qty : 0;
  if (mv.type === 'reserve') return 0;
  return (mv.to === loc ? mv.qty : 0) - (mv.from === loc ? mv.qty : 0);
}

/** Units in a location over time, stepping back from what it holds now: [time, units] from `since` to `now`. */
export function binSeries(movements: Movement[], loc: string, unitsNow: number, since: number, now = Date.now()): [number, number][] {
  const evs = movements.filter(m => delta(m, loc) && ts(m.updatedAt) >= since && ts(m.updatedAt) <= now).sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt));
  const pts: [number, number][] = [[now, unitsNow]];
  let q = unitsNow;
  for (const m of evs) { pts.push([ts(m.updatedAt), q]); q -= delta(m, loc); pts.push([ts(m.updatedAt), q]); }
  pts.push([since, q]);
  return pts.reverse();
}

/** Median minutes from raising work to finishing it, by type, since a date. */
export function cycleMinutes(movements: Movement[], since: number): Partial<Record<Movement['type'], number>> {
  const by = new Map<Movement['type'], number[]>();
  for (const m of movements) if (m.status === 'done' && ts(m.updatedAt) >= since && m.createdAt) by.set(m.type, [...(by.get(m.type) ?? []), (ts(m.updatedAt) - ts(m.createdAt)) / 60000]);
  const out: Partial<Record<Movement['type'], number>> = {};
  for (const [k, v] of by) { v.sort((a, b) => a - b); out[k] = v[Math.floor(v.length / 2)]; }
  return out;
}

export const daysAgo = (n: number, now = Date.now()) => now - n * DAY;
