// Live board: the store floor's work as cards in lanes. Drag a card to the next lane to approve,
// start or finish it, or onto a person to give it to them (press and hold on touch screens). Every
// card also has its next step as a button. Below: where material flowed and when the store is busy.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import { SITE_BY_ID } from '../../data/sites';
import { useDoc, useQuery } from '../../db/hooks';
import { ROLE_LABEL, type Movement, type User } from '../../db/schema';
import { assignError, dropError, LANES, laneOf, slaOf, span, type Lane } from '../../services/board';
import { busyHours, cycleMinutes, daysAgo, flows } from '../../services/flow';
import { boardAssign, boardMove, findInStore, goTo } from '../../state/actions';
import { useApp } from '../../state/store';
import { BusyHours, Sankey } from './FlowCharts';

const KIND: Partial<Record<Movement['type'], string>> = { move: 'Move', putaway: 'Put-away', count: 'Count', issue: 'Issue', transfer: 'Transfer' };
const NEXT: Record<Lane, [Lane, string] | null> = { approval: ['todo', 'Approve'], todo: ['doing', 'Start'], doing: ['done', 'Done'], done: null };
const STAFF = ['clerk', 'storeManager'];
const code = (loc?: string) => loc?.split(':').pop() ?? '—';
const BOARD_SITES = ['ktec', 'isu'];

type Target = { lane: Lane } | { user: User };
interface DragState { id: string; target: Target | null; err: string | null; label: string }

function Sla({ m, now }: { m: Movement; now: number }) {
  const s = slaOf(m, now);
  const [icon, text] = {
    ok: ['◷', `${span(s.left)} left`], soon: ['◷', `${span(s.left)} left`], late: ['!', `${span(s.left)} late`],
    planned: ['▷', `arrives in ${span(s.left)}`], met: ['✓', 'on time'], missed: ['!', `${span(s.left)} late`],
  }[s.state];
  return <span className={`sla ${s.state}`} title={`SLA due ${new Date(s.due).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`}><b aria-hidden>{icon}</b>{text}</span>;
}

const Avatar = ({ u, size = 'sm' }: { u?: User | null; size?: 'sm' | 'lg' }) =>
  <span className={`av ${size}${u ? '' : ' none'}`} title={u ? `${u.name} · ${ROLE_LABEL[u.role]}` : 'Unassigned'}>{u?.initials ?? '+'}</span>;

/** Press-and-drag for cards: mouse drags after a few pixels, touch after a short hold (so lanes still scroll). */
function useCardDrag(resolve: (id: string, t: Target | null) => { err: string | null; label: string }, drop: (id: string, t: Target) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const st = useRef<{ id: string; x: number; y: number; live: boolean; timer?: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => {
    const block = (e: TouchEvent) => { if (st.current?.live) e.preventDefault(); };
    document.addEventListener('touchmove', block, { passive: false });
    return () => document.removeEventListener('touchmove', block);
  }, []);
  const targetAt = (x: number, y: number): Target | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-lane],[data-user]');
    if (!el) return null;
    return el.dataset.lane ? { lane: el.dataset.lane as Lane } : { user: JSON.parse(el.dataset.user!) as User };
  };
  const place = (x: number, y: number) => { if (ghost.current) ghost.current.style.transform = `translate(${x + 14}px, ${y + 10}px)`; };
  const begin = (id: string, x: number, y: number) => {
    st.current!.live = true;
    navigator.vibrate?.(12);
    setDrag({ id, target: null, ...resolve(id, null) });
    requestAnimationFrame(() => place(x, y));
  };
  const onPointerDown = (id: string) => (e: RPE) => {
    if ((e.target as HTMLElement).closest('button,select,a') || e.button > 0) return;
    st.current = { id, x: e.clientX, y: e.clientY, live: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.pointerType !== 'mouse') st.current.timer = setTimeout(() => begin(id, e.clientX, e.clientY), 300);
  };
  const onPointerMove = (e: RPE) => {
    const s = st.current;
    if (!s) return;
    const far = Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6;
    if (!s.live) {
      if (far && e.pointerType === 'mouse') begin(s.id, e.clientX, e.clientY);
      else if (far) { clearTimeout(s.timer); st.current = null; }
      return;
    }
    place(e.clientX, e.clientY);
    const t = targetAt(e.clientX, e.clientY);
    setDrag(d => {
      if (!d) return d;
      const same = JSON.stringify(t) === JSON.stringify(d.target);
      return same ? d : { ...d, target: t, ...resolve(d.id, t) };
    });
  };
  const onPointerUp = (e: RPE) => {
    const s = st.current;
    st.current = null;
    if (!s) return;
    clearTimeout(s.timer);
    if (!s.live) return;
    const t = targetAt(e.clientX, e.clientY), r = resolve(s.id, t);
    setDrag(null);
    if (t && !r.err) drop(s.id, t);
  };
  const onPointerCancel = () => { clearTimeout(st.current?.timer); st.current = null; setDrag(null); };
  return { drag, ghost, bind: (id: string) => ({ onPointerDown: onPointerDown(id), onPointerMove, onPointerUp, onPointerCancel }) };
}

export function Board({ hidden }: { hidden: boolean }) {
  const site = useApp(s => s.site), meId = useApp(s => s.user), me = useDoc('users', meId).data ?? null;
  const all = useQuery('movements', { site }).data, users = useQuery('users').data, parts = useQuery('parts').data;
  const [now, setNow] = useState(Date.now()), [range, setRange] = useState(30);
  useEffect(() => { if (hidden) return; const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, [hidden]);
  const who = (id?: string | null) => users.find(u => u._id === id) ?? null;
  const team = users.filter(u => STAFF.includes(u.role) && u.sites.includes(site));
  const lanes = useMemo(() => {
    const by: Record<Lane, Movement[]> = { approval: [], todo: [], doing: [], done: [] };
    for (const m of all) { const l = laneOf(m, now); if (l) by[l].push(m); }
    const urgency = (m: Movement) => slaOf(m, now).left;
    for (const l of ['approval', 'todo', 'doing'] as Lane[]) by[l].sort((a, b) => urgency(a) - urgency(b));
    by.done.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return by;
  }, [all, now]);
  const since = daysAgo(range, now);
  const fl = useMemo(() => flows(all, since), [all, since]);
  const grid = useMemo(() => busyHours(all, since), [all, since]);
  const cyc = useMemo(() => cycleMinutes(all, daysAgo(30, now)), [all, now]);
  const open = lanes.approval.length + lanes.todo.length + lanes.doing.length;
  const late = [...lanes.approval, ...lanes.todo, ...lanes.doing].filter(m => slaOf(m, now).state === 'late').length;
  const done30 = all.filter(m => m.status === 'done' && KIND[m.type] && Date.parse(m.updatedAt ?? '') >= daysAgo(30, now));
  const met = done30.filter(m => slaOf(m, now).state === 'met').length;

  const byId = (id: string) => all.find(m => m._id === id)!;
  const resolve = (id: string, t: Target | null) => {
    const m = byId(id);
    if (!t) return { err: null, label: 'Drop on a lane or a person' };
    if ('user' in t) { const err = assignError(m, t.user, me); return { err, label: err ?? `Give to ${t.user.name}` }; }
    const err = dropError(m, t.lane, me, now), from = laneOf(m, now);
    const label = from === t.lane ? 'Already here' : from === 'approval' ? (m.type === 'count' ? 'Post the adjustment' : 'Approve') : t.lane === 'doing' ? 'Start' : t.lane === 'done' ? 'Finish · stock moves now' : 'Put back to To do';
    return { err: from === t.lane ? null : err, label: err && from !== t.lane ? err : label };
  };
  const { drag, ghost, bind } = useCardDrag(resolve, (id, t) => {
    if ('user' in t) void boardAssign(id, t.user._id);
    else if (laneOf(byId(id), now) !== t.lane) void boardMove(id, t.lane);
  });
  const isTarget = (t: Target) => drag?.target && JSON.stringify(drag.target) === JSON.stringify(t);
  const dragged = drag ? byId(drag.id) : null;

  const card = (m: Movement, lane: Lane) => {
    const part = parts.find(p => p._id === m.partNo), next = NEXT[lane];
    const step = next && (m.type === 'count' && lane === 'approval' ? (['done', 'Post'] as [Lane, string]) : next);
    const err = step ? dropError(m, step[0], me, now) : null;
    const s = slaOf(m, now).state;
    return (
      <article key={m._id} className={`bcard ${s}${drag?.id === m._id ? ' lifted' : ''}`} {...bind(m._id)} aria-label={`${KIND[m.type]} ${m._id}`}>
        <header><span className="kind">{KIND[m.type]}</span><b>{m._id}</b><Sla m={m} now={now} /></header>
        <div className="what">{m.type === 'count' ? `Counted ${m.counted} of ${m.qty}` : `${m.qty} ×`} {m.partNo}<small>{part?.description ?? ''}</small></div>
        <div className="where">{code(m.from)}{m.to ? ` → ${code(m.to)}` : ''}{m.ref ? <small> · {m.ref}</small> : null}</div>
        <footer>
          <Avatar u={who(m.assignee)} />
          <small className="who">{who(m.assignee)?.name ?? (lane === 'approval' ? `by ${who(m.requestedBy)?.name ?? m.requestedBy}` : 'Unassigned')}</small>
          <button className="link" onClick={() => findInStore(m.site, m.from && /[A-D]-\d\d/.test(m.from) ? m.from : m.to)} aria-label={`Find ${m._id} in the store`}>Find</button>
          {step && <button className="btn primary" disabled={!!err} title={err ?? undefined} onClick={() => void boardMove(m._id, step[0])}>{step[1]}</button>}
        </footer>
      </article>
    );
  };

  return (
    <section className={`page${hidden ? ' hidden' : ''}`}>
      <div className="board">
        <div className="rep-hd">
          <div><span className="eb">Live board · store floor</span><h1>{SITE_BY_ID[site].name}</h1>
            <p className="sub">Drag a card to approve, start or finish it, or onto a person to give it to them. On touch screens, press and hold first.</p></div>
          <div className="acts">{BOARD_SITES.map(id => <button key={id} className={`btn${site === id ? ' on' : ''}`} onClick={() => goTo(id, 'board')}>{SITE_BY_ID[id].short}</button>)}</div>
        </div>

        <div className="kpis k4 bk">
          <div><span>Open tasks</span><b>{open}</b></div>
          <div><span>Past SLA</span><b className={late ? 'bad' : ''}>{late}</b></div>
          <div><span>Done today</span><b>{lanes.done.length}</b></div>
          <div><span>Moves · median time</span><b>{cyc.move ? span(cyc.move * 60000) : '—'}</b><small>{done30.length ? `${Math.round((met / done30.length) * 100)}% of 30-day work on time` : ''}</small></div>
        </div>

        <div className="team" aria-label="Team · drop a card on a person to assign it">
          {team.map(u => {
            const t: Target = { user: u }, busy = lanes.doing.filter(m => m.assignee === u._id).length, queued = lanes.todo.filter(m => m.assignee === u._id).length;
            return (
              <div key={u._id} className={`mate${isTarget(t) ? (drag!.err ? ' no' : ' ok') : ''}`} data-user={JSON.stringify(u)}>
                <Avatar u={u} size="lg" /><span><b>{u.name}</b><small>{ROLE_LABEL[u.role]} · {busy} in progress · {queued} queued</small></span>
              </div>
            );
          })}
        </div>

        <div className="lanes">
          {LANES.map(([id, label]) => {
            const t: Target = { lane: id };
            return (
              <div key={id} className={`lane${isTarget(t) ? (drag!.err ? ' no' : ' ok') : ''}${dragged && laneOf(dragged, now) === id ? ' home' : ''}`} data-lane={id}>
                <div className="lh"><b>{label}</b><span>{lanes[id].length}</span></div>
                <div className="lc">{lanes[id].length ? lanes[id].map(m => card(m, id)) : <p className="note">{id === 'done' ? 'Nothing finished yet today.' : 'Nothing here.'}</p>}</div>
              </div>
            );
          })}
        </div>

        <div className="rep-hd" style={{ marginTop: '1rem' }}>
          <div><span className="eb">Material flow</span><h2 style={{ margin: 0 }}>Where stock went and when</h2></div>
          <div className="seg">{[7, 30].map(d => <button key={d} className={range === d ? 'on' : ''} onClick={() => setRange(d)}>Last {d} days</button>)}</div>
        </div>
        <div className="charts">
          <div className="cpanel"><div className="ch"><b>Flow between racks and areas</b><small>Units in finished movements · ribbon width is units</small></div><Sankey flows={fl} /></div>
          <div className="cpanel"><div className="ch"><b>Busy hours</b><small>Finished movements by weekday and hour, IST</small></div><BusyHours grid={grid} /></div>
        </div>
      </div>
      {drag && dragged && (
        <div ref={ghost} className={`bghost${drag.target ? (drag.err ? ' no' : ' ok') : ''}`} aria-live="polite">
          <b>{KIND[dragged.type]} · {dragged._id}</b><span>{drag.label}</span>
        </div>
      )}
    </section>
  );
}
