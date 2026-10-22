// Charts for the live board and the bin history: material flow (Sankey), busy hours (day × hour
// heatmap) and units in a bin over time (step chart). One blue hue throughout; text stays in ink.
import { useRef, useState, type ReactNode } from 'react';
import type { Flow } from '../../services/flow';

const BLUE = '#1450F5';
const RAMP = ['#D0DCFD', '#A1B9FB', '#5F88F8', BLUE];
const EMPTY = '#EFF1F4';

function useTip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const show = (e: { clientX: number; clientY: number }, body: ReactNode) => {
    const r = box.current!.getBoundingClientRect();
    setTip({ x: Math.min(e.clientX - r.left + 12, r.width - 200), y: e.clientY - r.top + 12, body });
  };
  const el = tip && <div className="ctip" style={{ left: Math.max(0, tip.x), top: tip.y }}>{tip.body}</div>;
  return { box, show, hide: () => setTip(null), el };
}

/** Where stock came from and went to: sources on the left, destinations on the right. */
export function Sankey({ flows }: { flows: Flow[] }) {
  const { box, show, hide, el } = useTip();
  const [hot, setHot] = useState<string | null>(null), [table, setTable] = useState(false);
  if (!flows.length) return <p className="note">No finished movements in this period.</p>;
  const W = 640, PAD = 6, GAP = 10, NW = 10, X0 = 150, X1 = W - 150;
  const sum = (k: 'source' | 'target') => {
    const m = new Map<string, number>();
    for (const f of flows) m.set(f[k], (m.get(f[k]) ?? 0) + f.qty);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const L = sum('source'), R = sum('target'), total = flows.reduce((n, f) => n + f.qty, 0);
  const H = Math.max(220, Math.max(L.length, R.length) * 34);
  const k = (H - PAD * 2 - GAP * (Math.max(L.length, R.length) - 1)) / total;
  const place = (side: [string, number][]) => {
    const pos = new Map<string, { y: number; h: number; off: number }>();
    let y = PAD + ((H - PAD * 2) - (side.reduce((n, [, q]) => n + q * k, 0) + GAP * (side.length - 1))) / 2;
    for (const [name, q] of side) { pos.set(name, { y, h: q * k, off: 0 }); y += q * k + GAP; }
    return pos;
  };
  const ls = place(L), rs = place(R);
  const ribbons = [...flows].sort((a, b) => (ls.get(a.source)!.y - ls.get(b.source)!.y) || (rs.get(a.target)!.y - rs.get(b.target)!.y)).map(f => {
    const s = ls.get(f.source)!, t = rs.get(f.target)!, h = f.qty * k;
    const sy = s.y + s.off, ty = t.y + t.off;
    s.off += h; t.off += h;
    const xa = X0 + NW, xb = X1, xm = (xa + xb) / 2;
    return { f, d: `M${xa},${sy}C${xm},${sy} ${xm},${ty} ${xb},${ty}L${xb},${ty + h}C${xm},${ty + h} ${xm},${sy + h} ${xa},${sy + h}Z` };
  });
  const on = (f: Flow) => !hot || hot === `${f.source}→${f.target}` || hot === `L:${f.source}` || hot === `R:${f.target}`;
  const tipFor = (f: Flow) => <><b>{f.source} → {f.target}</b><span>{f.qty.toLocaleString('en-IN')} units · {f.n} movements</span></>;
  return (
    <div className="chart" ref={box} onMouseLeave={() => { setHot(null); hide(); }}>
      {table ? (
        <table className="report"><thead><tr><th>From</th><th>To</th><th className="num">Units</th><th className="num">Movements</th></tr></thead>
          <tbody>{flows.map(f => <tr key={f.source + f.target}><td>{f.source}</td><td>{f.target}</td><td className="num">{f.qty}</td><td className="num">{f.n}</td></tr>)}</tbody></table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Material flow: ${flows.map(f => `${f.source} to ${f.target} ${f.qty} units`).join('; ')}`}>
          {ribbons.map(({ f, d }) => (
            <path key={f.source + f.target} d={d} fill={BLUE} opacity={hot ? (on(f) ? .5 : .06) : .2}
              onMouseMove={e => { setHot(`${f.source}→${f.target}`); show(e, tipFor(f)); }} />
          ))}
          {[...ls].map(([n, p]) => (
            <g key={'L' + n} onMouseMove={e => { setHot(`L:${n}`); show(e, <><b>{n}</b><span>{L.find(x => x[0] === n)![1]} units out</span></>); }}>
              <rect x={X0} y={p.y} width={NW} height={Math.max(2, p.h)} rx={2} fill={BLUE} />
              <text x={X0 - 8} y={p.y + p.h / 2} dy=".35em" textAnchor="end" className="ax"><tspan className="nm">{n}</tspan> {L.find(x => x[0] === n)![1]}</text>
            </g>
          ))}
          {[...rs].map(([n, p]) => (
            <g key={'R' + n} onMouseMove={e => { setHot(`R:${n}`); show(e, <><b>{n}</b><span>{R.find(x => x[0] === n)![1]} units in</span></>); }}>
              <rect x={X1} y={p.y} width={NW} height={Math.max(2, p.h)} rx={2} fill={BLUE} />
              <text x={X1 + NW + 8} y={p.y + p.h / 2} dy=".35em" className="ax"><tspan className="nm">{n}</tspan> {R.find(x => x[0] === n)![1]}</text>
            </g>
          ))}
        </svg>
      )}
      {el}
      <button className="link" onClick={() => setTable(!table)}>{table ? 'Show chart' : 'Show as table'}</button>
    </div>
  );
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Finished movements by weekday and hour; darker is busier. */
export function BusyHours({ grid }: { grid: number[][] }) {
  const { box, show, hide, el } = useTip();
  const max = Math.max(1, ...grid.flatMap(r => HOURS.map(h => r[h])));
  let best = { d: 0, h: 0, n: -1 };
  grid.forEach((r, d) => HOURS.forEach(h => { if (r[h] > best.n) best = { d, h, n: r[h] }; }));
  const col = (n: number) => (n ? RAMP[Math.min(3, Math.floor((n / max) * 4 - 1e-9))] : EMPTY);
  return (
    <div className="chart" ref={box} onMouseLeave={hide}>
      <p className="csub">Busiest: {DOW[best.d]} {hh(best.h)}–{hh(best.h + 1)} · {best.n} movements</p>
      <div className="heat" role="table" aria-label="Movements by weekday and hour">
        <span />{HOURS.map(h => <span key={h} className="hx" role="columnheader">{h % 2 ? '' : hh(h).slice(0, 2)}</span>)}
        {grid.map((r, d) => [
          <span key={'d' + d} className="hy" role="rowheader">{DOW[d]}</span>,
          ...HOURS.map(h => <i key={`${d}-${h}`} role="cell" aria-label={`${DOW[d]} ${hh(h)}: ${r[h]} movements`} style={{ background: col(r[h]) }}
            onMouseMove={e => show(e, <><b>{DOW[d]} {hh(h)}–{hh(h + 1)}</b><span>{r[h]} movement{r[h] === 1 ? '' : 's'}</span></>)} />),
        ])}
      </div>
      <div className="ramp"><span>Fewer</span>{[EMPTY, ...RAMP].map(c => <i key={c} style={{ background: c }} />)}<span>More</span></div>
      {el}
    </div>
  );
}

/** Units in a bin over time, with its capacity. */
export function BinChart({ series, capacity }: { series: [number, number][]; capacity: number }) {
  const { box, show, hide, el } = useTip();
  const [x, setX] = useState<number | null>(null);
  const W = 320, H = 120, T = 8, B = 18;
  const t0 = series[0][0], t1 = series[series.length - 1][0];
  const top = Math.max(capacity, ...series.map(p => p[1])) * 1.05 || 1;
  const sx = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W, sy = (q: number) => T + (1 - q / top) * (H - T - B);
  const line = series.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join('');
  const at = (t: number) => { let q = series[0][1]; for (const p of series) if (p[0] <= t) q = p[1]; return q; };
  const fmt = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div className="chart" ref={box} onMouseLeave={() => { setX(null); hide(); }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Units in the bin over 30 days, now ${series[series.length - 1][1]}`}
        onMouseMove={e => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
          const t = t0 + (px / W) * (t1 - t0);
          setX(px); show(e, <><b>{fmt(t)}</b><span>{at(t)} units</span></>);
        }}>
        <line x1={0} x2={W} y1={sy(capacity)} y2={sy(capacity)} stroke="#C4C7CD" strokeDasharray="4 3" />
        <text x={W} y={sy(capacity) - 4} textAnchor="end" className="ax">Capacity {capacity}</text>
        <path d={`${line}L${W},${H - B}L0,${H - B}Z`} fill={BLUE} opacity={.12} />
        <path d={line} fill="none" stroke={BLUE} strokeWidth={2} />
        <line x1={0} x2={W} y1={H - B} y2={H - B} stroke="#DEE0E4" />
        <text x={0} y={H - 4} className="ax">{fmt(t0)}</text>
        <text x={W} y={H - 4} textAnchor="end" className="ax">Now · {series[series.length - 1][1]} units</text>
        {x !== null && <line x1={x} x2={x} y1={T} y2={H - B} stroke="#4A4D55" strokeWidth={1} />}
      </svg>
      {el}
    </div>
  );
}
