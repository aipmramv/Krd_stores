// Move request form (from the store twin) and the list of move requests with the actions the
// signed-in user may take: approve or reject, confirm the move on the floor, or cancel.
import { useEffect, useState } from 'react';
import { binId, binOf } from '../../data/storeModel';
import { useDoc, useQuery } from '../../db/hooks';
import { ROLE_LABEL, type Movement, type StockLot } from '../../db/schema';
import { available, canCancel, canExecute, checkMove, nextApproval } from '../../services/moves';
import { cancelMove, cancelMoveRequest, confirmMove, decideMove, setMoveArea, setMoveTarget, submitMove } from '../../state/actions';
import { useApp } from '../../state/store';

/** Used when the Movement purposes master has no active move purposes. */
const FALLBACK = ['Re-slot for faster picking', 'Other'];
const code = (loc?: string) => loc?.split(':').pop() ?? '—';

export function MoveForm() {
  const d = useApp(s => s.moveDraft)!, site = useApp(s => s.site);
  const from = `${site}:${binId(d.from)}`, to = d.to ? `${site}:${binId(d.to)}` : d.toArea ? `${site}:${d.toArea}` : null;
  const lots = useQuery('stockLots', { locationId: from }).data, parts = useQuery('parts').data;
  const dest = useDoc('locations', to).data;
  const purposes = useQuery('purposes', { kind: 'move', active: true }, { sort: { name: 1 } }).data.map(p => p.name);
  const REASONS = purposes.length ? [...purposes, 'Other'] : FALLBACK;
  const [lotId, setLot] = useState<string>(''), [qty, setQty] = useState(1), [picked, setReason] = useState('');
  const reason = picked || REASONS[0];
  const [free, setFree] = useState<number | null>(null), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const lot = lots.find(l => l._id === lotId) ?? lots[0] ?? null;

  useEffect(() => { if (lot && lot._id !== lotId) setLot(lot._id); }, [lot, lotId]);
  useEffect(() => {
    let live = true;
    if (lot) void available(lot).then(n => { if (live) { setFree(n); setQty(q => Math.max(1, Math.min(q, n || 1))); } });
    return () => { live = false; };
  }, [lot]);
  useEffect(() => {
    let live = true;
    void checkMove({ site, lotId: lot?._id ?? '', to: to ?? '', qty, reason }, lot, dest).then(e => { if (live) setErr(e); });
    return () => { live = false; };
  }, [site, lot, dest, to, qty, reason]);

  const name = (l: StockLot) => parts.find(p => p._id === l.partNo)?.description ?? l.partNo;
  const bins = useQuery('locations', { site, store: 'electronics' }, { sort: { code: 1 } }).data;
  const areas = useQuery('locations', { site, store: 'areas' }, { sort: { code: 1 } }).data;
  const siteLots = useQuery('stockLots', { site }).data;
  const used = new Map<string, number>();
  for (const l of siteLots) used.set(l.locationId, (used.get(l.locationId) ?? 0) + l.qty);
  return (
    <div className="moveform">
      <div className="st"><span className="eb ink">New move request</span></div>
      <div className="kv">
        <div><span>From</span><b>{binId(d.from)}</b></div>
      </div>
      <label className="fld"><span>To · tap or drag in the store, or choose</span>
        <select value={d.to ? binId(d.to) : d.toArea ?? ''} onChange={e => { const b = binOf(e.target.value); if (b) setMoveTarget(b); else setMoveArea(e.target.value); }}>
          <option value="" disabled>Choose a destination bin or area</option>
          <optgroup label="Bins">
            {bins.filter(b => b.code !== binId(d.from)).map(b => {
              const free = b.capacity - (used.get(b._id) ?? 0);
              return <option key={b._id} value={b.code} disabled={free < 1}>{b.code} · {free} free</option>;
            })}
          </optgroup>
          <optgroup label="Floor areas">
            {areas.map(a => <option key={a._id} value={a.code}>{a.code} · {a.zone} · {a.capacity - (used.get(a._id) ?? 0)} free</option>)}
          </optgroup>
        </select>
      </label>
      {lots.length === 0 ? <p className="note">This bin is empty, so there is nothing to move.</p> : <>
        <label className="fld"><span>Stock</span>
          <select value={lot?._id} onChange={e => setLot(e.target.value)}>
            {lots.map(l => <option key={l._id} value={l._id}>{l.partNo} · {name(l)} · lot {l.lot} · {l.qty} on hand</option>)}
          </select>
        </label>
        <label className="fld"><span>Quantity{free !== null ? ` · ${free} free to move` : ''}</span>
          <span className="stepper">
            <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Fewer">−</button>
            <input type="number" min={1} max={free ?? undefined} value={qty} onChange={e => setQty(Math.max(1, Math.floor(+e.target.value || 1)))} />
            <button type="button" onClick={() => setQty(q => (free ? Math.min(free, q + 1) : q + 1))} aria-label="More">+</button>
            {free ? <button type="button" className="all" onClick={() => setQty(free)}>All</button> : null}
          </span>
        </label>
        <label className="fld"><span>Reason</span>
          <select value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(r => <option key={r}>{r}</option>)}</select>
        </label>
      </>}
      {err && to && <p className="note bad" role="alert">{err}</p>}
      <div className="grid2">
        <button className="btn primary" disabled={!lot || !to || !!err || busy} onClick={async () => { setBusy(true); await submitMove(lot!._id, qty, reason); setBusy(false); }}>Send request</button>
        <button className="btn" onClick={cancelMove}>Cancel</button>
      </div>
    </div>
  );
}

const STATUS: Record<Movement['status'], [string, string]> = {
  requested: ['Awaiting approval', '#C77700'], approved: ['Approved · to move', '#1450F5'], done: ['Done', '#1B7F4E'],
  rejected: ['Rejected', '#C8312B'], cancelled: ['Cancelled', '#767A82'],
};

export function MoveRow({ m }: { m: Movement }) {
  const me = useDoc('users', useApp(s => s.user)).data;
  const users = useQuery('users').data;
  const next = nextApproval(m, me), pending = m.approvals.find(a => a.decision === 'pending');
  const who = (id?: string) => users.find(u => u._id === id)?.name ?? id ?? '—';
  const [label, col] = STATUS[m.status];
  return (
    <div className="mvrow">
      <div className="mvhd">
        <span><b>{m._id}</b><small>{m.qty} × {m.partNo} · {code(m.from)} → {code(m.to)}</small></span>
        <span className="chip" style={{ color: col, boxShadow: `inset 0 0 0 1px ${col}` }}>{label}</span>
      </div>
      <small className="mvmeta">{m.reason} · by {who(m.requestedBy)}{pending ? ` · waiting for ${ROLE_LABEL[pending.role]}` : ''}
        {m.approvals.filter(a => a.decision !== 'pending').map(a => ` · ${a.decision} by ${who(a.user)}`).join('')}</small>
      {(next || canExecute(m, me) || canCancel(m, me)) && (
        <div className="mvact">
          {next && <button className="btn primary" onClick={() => void decideMove(m._id, 'approved')}>Approve</button>}
          {next && <button className="btn" onClick={() => void decideMove(m._id, 'rejected')}>Reject</button>}
          {canExecute(m, me) && <button className="btn primary" onClick={() => void confirmMove(m._id)}>Confirm moved</button>}
          {canCancel(m, me) && <button className="btn" onClick={() => void cancelMoveRequest(m._id)}>Cancel</button>}
        </div>
      )}
    </div>
  );
}

/** Move requests matching a filter, open ones first. */
export function MoveList({ filter, empty }: { filter: Record<string, unknown>; empty: string }) {
  const list = useQuery('movements', { type: 'move', ...filter }, { sort: { createdAt: -1 }, limit: 30 }).data;
  const open = list.filter(m => m.status === 'requested' || m.status === 'approved'), closed = list.filter(m => !open.includes(m));
  if (!list.length) return <p className="note">{empty}</p>;
  return <div className="mvlist">{[...open, ...closed.slice(0, 6)].map(m => <MoveRow key={m._id} m={m} />)}</div>;
}
