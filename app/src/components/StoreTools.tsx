// Store twin tools: select several bins (count them together, walk a pick path, move them as a
// group), follow a part through the racks, and x-ray the racking.
import { useState, useSyncExternalStore } from 'react';
import { binId, binOf } from '../data/storeModel';
import { getStoreView, onStoreView } from '../services/storeView';
import { freeQty, pickOrder, sumQty } from '../services/storeOps';
import { binCount, clearSel, setFollow, setSelectMode, togglePickPath, toggleXray } from '../state/actions';
import { useApp } from '../state/store';
import type { Bin } from '../data/types';

const useView = () => useSyncExternalStore(onStoreView, getStoreView);

/** Rail section: selection mode, x-ray, pick path and follow-a-part. */
export function StoreToolsRail() {
  const s = useApp(x => x), view = useView();
  const parts = view?.site === s.site ? [...new Set([...view.lots.values()].flat().map(l => l.partNo))].sort() : [];
  const tgl = (on: boolean, label: string, run: () => void, disabled = false) => (
    <button className={`tgl ${on ? 'on' : ''}`} onClick={run} aria-pressed={on} disabled={disabled}><span>{label}</span><span className="sw" /></button>
  );
  return <>
    <div className="sec"><span className="eb ink">Store tools</span></div>
    {tgl(s.selectMode, 'Select bins', () => setSelectMode(!s.selectMode))}
    {tgl(s.xray, 'X-ray racking', toggleXray)}
    {tgl(s.pickPath, `Pick path${s.storeSel.length < 2 ? ' · select 2+ bins' : ''}`, togglePickPath, s.storeSel.length < 2)}
    <label className="fld" style={{ padding: '.5rem 1.25rem 0' }}><span>Follow a part</span>
      <select value={s.follow ?? ''} onChange={e => setFollow(e.target.value || null)}>
        <option value="">None</option>
        {parts.map(p => <option key={p} value={p}>{p} · {view!.parts.get(p)?.description ?? ''}</option>)}
      </select>
    </label>
  </>;
}

/** Floating bar while selecting bins. */
export function SelectionBar() {
  const screen = useApp(s => s.screen), on = useApp(s => s.selectMode), sel = useApp(s => s.storeSel), path = useApp(s => s.pickPath);
  const draft = useApp(s => s.moveDraft);
  useView();
  if (screen !== 'store' || draft || (!on && !sel.length)) return null;
  const lots = sel.flatMap(c => getStoreView()?.lots.get(c) ?? []);
  return (
    <div className="selbar" role="toolbar" aria-label="Selected bins">
      <span><b>{sel.length ? `${sel.length} bin${sel.length > 1 ? 's' : ''} · ${sumQty(lots)} units` : 'Tap bins to select'}</b>
        <small>{sel.length > 1 ? 'Hold a selected bin and drag to move them all' : 'Tap again to deselect'}</small></span>
      <button className={`btn${path ? ' on' : ''}`} disabled={sel.length < 2} onClick={togglePickPath} aria-pressed={path}>Pick path</button>
      <button className="btn" onClick={clearSel}>{sel.length ? 'Clear' : 'Done'}</button>
    </div>
  );
}

/** Drawer when bins are selected: what they hold, a combined blind count and the walking order. */
export function SelectionPanel() {
  const sel = useApp(s => s.storeSel), path = useApp(s => s.pickPath), view = useView();
  const [counting, setCounting] = useState(false), [c, setC] = useState<Record<string, string>>({});
  if (!view) return null;
  const bins = sel.map(binOf).filter((b): b is Bin => !!b);
  const order = path && bins.length > 1 ? pickOrder(bins) : null;
  const list = order ? order.order.map(binId) : sel;
  const lots = list.flatMap(code => (view.lots.get(code) ?? []).map(l => ({ code, l })));
  return <>
    <div className="dh"><span className="eb">Selection · {sel.length} bins</span><h2>{sumQty(lots.map(x => x.l))} units · {freeQty(lots.map(x => x.l))} free</h2>
      {order && <p>Pick path · {Math.round(order.len)} m walk from the entrance, in this order</p>}</div>
    <div className="rows">
      {list.map((code, i) => {
        const ls = view.lots.get(code) ?? [];
        return <div key={code}><span><b>{order ? `${i + 1}. ` : ''}{code}</b><small>{ls.length ? ls.map(l => `${l.partNo} · lot ${l.lot}`).join(' · ') : 'Empty'}</small></span><span>{sumQty(ls)}</span></div>;
      })}
    </div>
    {counting ? <>
      <div className="st"><span className="eb ink">Blind count · {lots.length} lots</span></div>
      {lots.map(({ code, l }) => (
        <label key={l._id} className="fld"><span>{code} · {l.partNo} · lot {l.lot}</span>
          <input type="number" min={0} inputMode="numeric" value={c[l._id] ?? ''} placeholder="Counted" onChange={e => setC({ ...c, [l._id]: e.target.value })} />
        </label>
      ))}
      <div className="grid2" style={{ paddingTop: 0 }}>
        <button className="btn primary" disabled={!lots.length || lots.some(x => !c[x.l._id])}
          onClick={async () => { await binCount(lots.map(x => ({ lotId: x.l._id, counted: Math.floor(+c[x.l._id]) }))); setCounting(false); setC({}); }}>Submit count</button>
        <button className="btn" onClick={() => setCounting(false)}>Cancel</button>
      </div>
    </> : (
      <div className="grid2">
        <button className="btn primary" disabled={!lots.length} onClick={() => setCounting(true)}>Count all</button>
        <button className="btn" disabled={sel.length < 2} onClick={togglePickPath}>{path ? 'Hide pick path' : 'Pick path'}</button>
        <button className="btn" onClick={clearSel}>Clear selection</button>
      </div>
    )}
  </>;
}
