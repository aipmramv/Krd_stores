// Scrap cases in the Moves & scrap drawer: the list, one case with its current step, and the
// tagging form (also opened from a bin in the store twin).
import { useState, type ReactNode } from 'react';
import { useDoc, useQuery } from '../../db/hooks';
import { ROLE_LABEL, type ScrapCase, type User } from '../../db/schema';
import { canAct, DISPOSALS, nextApproval, photoToDataUrl, REASONS, STEPS } from '../../services/scrap';
import * as A from '../../state/actions';
import { useApp } from '../../state/store';
import { DrawerFrame } from './Frame';

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const STEP_LABEL: Record<ScrapCase['step'], string> = {
  tag: 'Tagging', reason: 'Needs a reason', approval: 'Awaiting approval', move: 'Approved · move to scrap yard',
  dispose: 'Awaiting disposal', writeoff: 'Awaiting write-off', closed: 'Closed',
};
const OUTCOME: Record<NonNullable<ScrapCase['outcome']>, [string, string]> = {
  'written-off': ['Written off', '#1B7F4E'], rejected: ['Rejected', '#C8312B'], cancelled: ['Withdrawn', '#767A82'],
};

function Chip({ c }: { c: ScrapCase }) {
  const [label, col] = c.outcome ? OUTCOME[c.outcome] : [STEP_LABEL[c.step], c.step === 'approval' ? '#C77700' : '#1450F5'];
  return <span className="chip" style={{ color: col, boxShadow: `inset 0 0 0 1px ${col}` }}>{label}</span>;
}

export function ScrapList({ site }: { site: string }) {
  const list = useQuery('scrapCases', { site }, { sort: { createdAt: -1 } }).data, parts = useQuery('parts').data;
  if (!list.length) return <p className="note">No scrap cases at this site.</p>;
  const open = list.filter(c => c.step !== 'closed'), closed = list.filter(c => c.step === 'closed');
  return (
    <div className="rows">
      {[...open, ...closed.slice(0, 5)].map(c => (
        <button key={c._id} className="rowbtn" onClick={() => A.openScrap(c._id)}>
          <span><b>{c._id} · {c.qty} × {parts.find(p => p._id === c.partNo)?.description ?? c.partNo}</b><small>{inr(c.value)}{c.reason ? ` · ${c.reason}` : ''}</small></span><Chip c={c} />
        </button>
      ))}
    </div>
  );
}

/** Pick image files (or the camera on phones) and hand back downsized data URLs. */
function PhotoPicker({ onPick, label = 'Add photo' }: { onPick: (urls: string[]) => void; label?: string }) {
  return (
    <label className="btn photo-pick">
      {label}
      <input type="file" accept="image/*" capture="environment" multiple hidden
        onChange={async e => { const files = [...(e.target.files ?? [])].slice(0, 4); e.target.value = ''; if (files.length) onPick(await Promise.all(files.map(f => photoToDataUrl(f)))); }} />
    </label>
  );
}

function Photos({ urls }: { urls: string[] }) {
  if (!urls.length) return <p className="note">No photos yet.</p>;
  return <div className="grid3" style={{ paddingTop: 0 }}>{urls.map((u, i) => <a key={i} href={u} target="_blank" rel="noreferrer"><img className="thumb sq-img" src={u} alt={`Scrap photo ${i + 1}`} /></a>)}</div>;
}

/** New case: choose the stock (or arrive with it from a bin), quantity, photos and a note. */
export function ScrapNew() {
  const draft = useApp(s => s.scrapNew)!, site = useApp(s => s.site);
  const lots = useQuery('stockLots', draft.lotId ? { _id: draft.lotId } : { site }).data.filter(l => l.qty > l.reserved);
  const parts = useQuery('parts').data;
  const [lotId, setLot] = useState(draft.lotId ?? ''), [qty, setQty] = useState(1), [note, setNote] = useState(''), [photos, setPhotos] = useState<string[]>([]);
  const lot = lots.find(l => l._id === lotId) ?? lots[0];
  const part = parts.find(p => p._id === lot?.partNo);
  const free = lot ? lot.qty - lot.reserved : 0;
  return (
    <DrawerFrame title="New scrap case" foot={<>
      <button className="btn primary" disabled={!lot} onClick={() => void A.tagScrap(lot!._id, qty, photos, note)}>Tag for scrap</button>
      <button className="btn" onClick={A.closeScrap}>Cancel</button>
    </>}>
      <div className="dh"><span className="eb">Step 1 · Tag</span><h2>{part?.description ?? 'Choose the stock'}</h2>
        <p>Tagged units are held at once so nobody issues them while the case is decided.</p></div>
      <label className="fld"><span>Stock</span>
        <select value={lot?._id ?? ''} onChange={e => setLot(e.target.value)}>
          {lots.map(l => <option key={l._id} value={l._id}>{l.locationId.split(':')[1]} · {l.partNo} · lot {l.lot} · {l.qty - l.reserved} free</option>)}
        </select>
      </label>
      <label className="fld"><span>Quantity · {free} free · value {inr(qty * (part?.unitCost ?? 0))}</span>
        <span className="stepper">
          <button type="button" onClick={() => setQty(q => Math.max(1, q - 1))} aria-label="Fewer">−</button>
          <input type="number" min={1} max={free} value={qty} onChange={e => setQty(Math.max(1, Math.floor(+e.target.value || 1)))} />
          <button type="button" onClick={() => setQty(q => Math.min(free, q + 1))} aria-label="More">+</button>
        </span>
      </label>
      <label className="fld"><span>What happened</span><textarea rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. cracked housing after drop test TC-114" /></label>
      <div className="st"><span className="eb ink">Photos</span></div>
      <Photos urls={photos} />
      <div className="grid2" style={{ paddingTop: 0 }}><PhotoPicker onPick={u => setPhotos(p => [...p, ...u].slice(0, 4))} /></div>
    </DrawerFrame>
  );
}

function StepPanel({ c, me, users }: { c: ScrapCase; me: User | null; users: User[] }) {
  const [reason, setReason] = useState(c.reason || REASONS[0]), [detail, setDetail] = useState(c.detail);
  const [note, setNote] = useState('');
  const [disposal, setDisposal] = useState(c.disposal ?? DISPOSALS[0]), [vendor, setVendor] = useState(c.vendor ?? ''), [pickup, setPickup] = useState(c.pickupDate ?? new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10));
  const [cert, setCert] = useState(''), [certFile, setCertFile] = useState<string | undefined>();
  const name = (id?: string) => users.find(u => u._id === id)?.name ?? '—';
  const can = canAct(c, me), waiting = (who: string) => <p className="note">Waiting for {who}.</p>;
  let body: ReactNode = null;
  if (c.step === 'reason') body = can ? <>
    <label className="fld"><span>Reason</span><select value={reason} onChange={e => setReason(e.target.value)}>{REASONS.map(r => <option key={r}>{r}</option>)}</select></label>
    <label className="fld"><span>Detail</span><textarea rows={3} value={detail} onChange={e => setDetail(e.target.value)} /></label>
    <div className="grid2" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => void A.scrapReason(c._id, reason, detail)}>Send for approval</button></div>
  </> : waiting(`${name(c.owner)} to give the reason`);
  if (c.step === 'approval') {
    const next = nextApproval(c, me), pending = c.approvals.find(a => a.decision === 'pending');
    body = next ? <>
      <label className="fld"><span>Note (optional)</span><input value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="grid2" style={{ paddingTop: 0 }}>
        <button className="btn primary" onClick={() => void A.scrapDecide(c._id, 'approved', note)}>Approve</button>
        <button className="btn" onClick={() => void A.scrapDecide(c._id, 'rejected', note)}>Reject</button>
      </div>
    </> : waiting(pending ? ROLE_LABEL[pending.role] : 'approval');
  }
  if (c.step === 'move') body = can
    ? <div className="grid2"><button className="btn primary" onClick={() => void A.scrapMove(c._id)}>Confirm moved to scrap yard</button></div>
    : waiting('store staff to move the units to the scrap yard');
  if (c.step === 'dispose') body = can ? <>
    <label className="fld"><span>Disposal route</span><select value={disposal} onChange={e => setDisposal(e.target.value)}>{DISPOSALS.map(d => <option key={d}>{d}</option>)}</select></label>
    <label className="fld"><span>Vendor</span><input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Authorised vendor name" /></label>
    <label className="fld"><span>Pick-up date</span><input type="date" value={pickup} onChange={e => setPickup(e.target.value)} /></label>
    <div className="grid2" style={{ paddingTop: 0 }}><button className="btn primary" onClick={() => void A.scrapDispose(c._id, disposal, vendor, pickup)}>Record disposal</button></div>
  </> : waiting('EHS or a store manager to record disposal');
  if (c.step === 'writeoff') body = can ? <>
    <label className="fld"><span>Disposal certificate number</span><input value={cert} onChange={e => setCert(e.target.value)} placeholder="e.g. RCY/2026/10/0457" /></label>
    <div className="grid2" style={{ paddingTop: 0 }}>
      <label className="btn photo-pick">{certFile ? 'Certificate attached ✓' : 'Attach certificate'}
        <input type="file" accept="image/*,application/pdf" hidden onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          if (f.type.startsWith('image/')) setCertFile(await photoToDataUrl(f, 1200));
          else if (f.size < 600_000) setCertFile(await new Promise<string>(r => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(f); }));
          else A.toast('Attach a PDF under 600 KB, or a photo of the certificate');
        }} />
      </label>
      <button className="btn primary" onClick={() => void A.scrapWriteOff(c._id, cert, certFile)}>Post write-off</button>
    </div>
  </> : waiting('the finance controller to post the write-off');
  if (c.step === 'closed') body = <div className="kv">
    {c.writeOffRef && <div><span>Write-off</span><b>{c.writeOffRef}</b></div>}
    {c.certificate && <div><span>Certificate</span><span>{c.certificateFile ? <a href={c.certificateFile} target="_blank" rel="noreferrer">{c.certificate}</a> : c.certificate}</span></div>}
  </div>;
  return <>{body}</>;
}

export function ScrapCaseView({ id }: { id: string }) {
  const c = useDoc('scrapCases', id).data, me = useDoc('users', useApp(s => s.user)).data;
  const users = useQuery('users').data, part = useDoc('parts', c?.partNo).data;
  if (!c) return <DrawerFrame title="Scrap case"><p className="note">Loading…</p></DrawerFrame>;
  const name = (uid?: string) => users.find(u => u._id === uid)?.name ?? '—';
  const at = STEPS.findIndex(([s]) => s === c.step);
  const withdrawable = ['reason', 'approval'].includes(c.step) && (me?._id === c.owner || me?.role === 'admin');
  return (
    <DrawerFrame title="Scrap case" foot={<>
      <button className="btn" onClick={A.closeScrap}>All cases</button>
      {withdrawable && <button className="btn" onClick={() => void A.scrapCancel(c._id)}>Withdraw</button>}
    </>}>
      <div className="dh">
        <span className="eb">Scrap case · {c.outcome ? OUTCOME[c.outcome][0] : STEP_LABEL[c.step]}</span><h2>{c._id}</h2>
        <p>{c.qty} × {c.partNo}{part ? ` · ${part.description}` : ''}{c.detail ? ` · ${c.detail}` : ''}</p>
      </div>
      <div className="steps">{STEPS.map(([s, label], i) => <div key={s} className={c.step === 'closed' ? (c.outcome === 'written-off' ? 'done' : i <= 2 ? 'done' : '') : i < at ? 'done' : i === at ? 'cur' : ''}><i />{label}</div>)}</div>
      <div className="kv">
        <div><span>Write-off value</span><b>{inr(c.value)}</b></div>
        <div><span>Reason</span><span>{c.reason || '—'}</span></div>
        <div><span>Owner</span><span>{name(c.owner)}</span></div>
        {c.disposal && <div><span>Disposal</span><span>{c.disposal}{c.vendor ? ` · ${c.vendor}` : ''}</span></div>}
      </div>
      <StepPanel key={c.step + (c.updatedAt ?? '')} c={c} me={me} users={users} />
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">Photos</span></div>
      <Photos urls={c.photos} />
      {c.step !== 'closed' && c.photos.length < 4 && <div className="grid2" style={{ paddingTop: 0 }}><PhotoPicker onPick={u => void A.scrapPhotos(c._id, u)} /></div>}
      {c.approvals.length > 0 && <>
        <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">Approval chain{c.value > 200000 ? ' · over ₹2,00,000' : ''}</span></div>
        <div className="rows">
          {c.approvals.map(a => (
            <div key={a.role} className={a.decision === 'pending' && nextApproval(c, me)?.role === a.role ? 'sel' : ''}>
              <span>{ROLE_LABEL[a.role]}{a.user ? ` · ${name(a.user)}` : ''}{a.note ? ` · “${a.note}”` : ''}</span>
              <span style={{ color: a.decision === 'approved' ? '#1B7F4E' : a.decision === 'rejected' ? '#C8312B' : '#767A82' }}>{a.decision === 'pending' ? 'Waiting' : a.decision === 'approved' ? 'Approved' : 'Rejected'}</span>
            </div>
          ))}
        </div>
      </>}
      <div className="st" style={{ borderTop: '1px solid #DEE0E4' }}><span className="eb ink">History</span></div>
      <div className="rows">
        {[...(c.history ?? [])].reverse().map((h, i) => (
          <div key={i}><span><b>{h.note}</b><small>{name(h.user)} · {new Date(h.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</small></span></div>
        ))}
      </div>
    </DrawerFrame>
  );
}
