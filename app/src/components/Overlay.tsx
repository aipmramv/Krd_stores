// Command palette (Ctrl K) and the Display / touch-density menu.
import { useEffect, useRef } from 'react';
import { SITES } from '../data/sample';
import type { ScreenId } from '../data/types';
import { closeOverlay, go, openPalette, selectSite, setKiosk } from '../state/actions';
import { useApp } from '../state/store';

interface PalItem { title: string; sub: string; hint: string; run: () => void }
const toScreen = (s: ScreenId) => () => go(s);
const PAL: [string, PalItem[]][] = [
  ['Parts', [
    { title: 'KM-DX-ACT-220 rev C · Door operator actuator', sub: 'Bin D-05-04 · Electronics store · KTEC Chennai', hint: 'Fly to bin', run: toScreen('store') },
    { title: 'KM-PCB-IOT-022 · IoT gateway PCB', sub: 'Bin C-10-04 · count variance', hint: 'Fly to bin', run: toScreen('store') },
  ]],
  ['Shipments', [
    { title: 'DEL 2210 9934 7781 · Delhivery', sub: 'E-way bill hold at Hubballi · KTEC Chennai → Bhiwandi', hint: 'Track', run: toScreen('shipments') },
  ]],
  ['Sites', SITES.map(s => ({ title: s.name, sub: s.type, hint: 'Fly to site', run: () => selectSite(s.id) }))],
  ['Commands', [
    { title: 'Plan a route between sites', sub: 'Road, air, rail and courier options', hint: 'R', run: toScreen('routes') },
    { title: 'Open scrap approvals', sub: '1 case awaiting you', hint: 'S', run: toScreen('movements') },
    { title: 'Parts master', sub: 'Reports and masters', hint: 'P', run: toScreen('reports') },
  ]],
];

function Palette({ q }: { q: string }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const ql = q.toLowerCase();
  const groups = PAL.map(([g, items]) => [g, items.filter(it => !ql || (it.title + it.sub).toLowerCase().includes(ql))] as const).filter(g => g[1].length);
  const run = (it: PalItem) => { closeOverlay(); it.run(); };
  return (
    <div className="pal" role="dialog" aria-label="Search">
      <div className="in">
        <input ref={input} placeholder="Search part no., serial, PO, AWB, project, person" value={q}
          onChange={e => openPalette(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && groups[0]) run(groups[0][1][0]); }} />
        <kbd>Esc</kbd>
      </div>
      {groups.length ? groups.map(([g, items]) => (
        <div className="grp" key={g}>
          <span className="eb">{g}</span>
          {items.map(it => (
            <button key={it.title} className="it" onClick={() => run(it)}>
              <span><b>{it.title}</b><small>{it.sub}</small></span><kbd>{it.hint}</kbd>
            </button>
          ))}
        </div>
      )) : <div style={{ padding: '1.25rem', fontSize: '.875rem', color: '#767A82' }}>No results</div>}
      <div className="ft"><span>Enter · fly to result</span><span>1–8 · switch module</span><span>Esc · close</span></div>
    </div>
  );
}

function DisplayMenu({ top, right }: { top: number; right: number }) {
  const kiosk = useApp(s => s.kiosk);
  return (
    <div className="menu" style={{ top, right }} role="menu">
      <span className="eb">Touch density</span>
      <button role="menuitemradio" aria-checked={!kiosk} onClick={() => setKiosk(false)}><span>Standard · 13–27 in screens</span>{!kiosk && <b>On</b>}</button>
      <button role="menuitemradio" aria-checked={kiosk} onClick={() => setKiosk(true)}><span>Kiosk touch · 32–55 in screens</span>{kiosk && <b>On</b>}</button>
      <span className="eb">Preview</span>
      <button onClick={() => { closeOverlay(); window.open('layouts.html', '_blank'); }}><span>All screen sizes side by side</span><span>↗</span></button>
    </div>
  );
}

export function Overlay() {
  const o = useApp(s => s.overlay);
  if (!o) return null;
  return (
    <div className="overlay" style={o.kind === 'display' ? { background: 'transparent' } : undefined}
      onClick={e => { if (e.target === e.currentTarget) closeOverlay(); }}>
      {o.kind === 'palette' ? <Palette q={o.q} /> : <DisplayMenu top={o.top} right={o.right} />}
    </div>
  );
}
