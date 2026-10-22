// Command palette (Ctrl K) and the Display / touch-density menu.
import { useEffect, useRef, useState } from 'react';
import { binOf } from '../data/storeModel';
import { searchAll, type Hit, type Target } from '../services/search';
import { AlertsPanel } from './Inbox';
import { SITE_BY_ID } from '../data/sites';
import type { ScreenId } from '../data/types';
import { db } from '../db';
import { useQuery } from '../db/hooks';
import { ROLE_LABEL } from '../db/schema';
import { closeOverlay, flashBeam, go, goTo, openPalette, openPhoto, openReport, openTask, resetDemoData, selectSite, setKiosk, setUser, viewPhotoIn3D } from '../state/actions';
import { useApp } from '../state/store';

interface PalItem { title: string; sub: string; hint: string; run: () => void }
const toScreen = (s: ScreenId) => () => go(s);
const COMMANDS: PalItem[] = [
  { title: 'Plan a shipment between sites', sub: 'Road, rail, air, courier and the KONE shuttle', hint: 'Routes', run: toScreen('routes') },
  { title: 'Scrap cases and move requests', sub: 'Moves & scrap', hint: 'Open', run: toScreen('movements') },
  { title: 'Parts master', sub: 'Reports & masters', hint: 'Open', run: () => openReport('Parts') },
  { title: 'Space utilisation report', sub: 'Bins used against capacity, by site', hint: 'Open', run: () => openReport('Space utilisation') },
];

function runHit(t: Target) {
  closeOverlay();
  switch (t.kind) {
    case 'part': openReport('Parts', t.partNo); break;
    case 'bin': { const b = binOf(t.code); if (b) { goTo(t.site, 'store', { bin: b, binTask: null, moveDraft: null, scrapNew: null }); flashBeam(t.code); } else openReport('Sites and locations'); break; }
    case 'ship': goTo(t.site, 'shipments', { ship: t.id }); break;
    case 'scrap': goTo(t.site, 'movements', { scrapId: t.id, scrapNew: null }); break;
    case 'move':
      if (t.type === 'putaway') goTo(t.site, 'store', { binTask: 'putaway', moveDraft: null });
      else if (t.type === 'count') void openTask({ kind: 'count', id: t.id, site: t.site });
      else goTo(t.site, 'movements', { scrapId: null, scrapNew: null });
      break;
    case 'site': selectSite(t.site); break;
    case 'user': openReport('Users and roles'); break;
  }
}

/** Ctrl K: live search across parts, bins and lots, shipments, requests and POs, scrap cases, people and sites. */
function Palette({ q }: { q: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [hits, setHits] = useState<Hit[]>([]), [busy, setBusy] = useState(false);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    let live = true;
    setBusy(true);
    const id = setTimeout(() => void searchAll(q).then(h => { if (live) { setHits(h); setBusy(false); } }), 120);
    return () => { live = false; clearTimeout(id); };
  }, [q]);
  const ql = q.trim().toLowerCase();
  const cmds = COMMANDS.filter(c => !ql || (c.title + c.sub).toLowerCase().includes(ql));
  const groups: [string, PalItem[]][] = [];
  for (const h of hits) {
    const g = groups.find(x => x[0] === h.group) ?? (groups.push([h.group, []]), groups[groups.length - 1]);
    g[1].push({ title: h.title, sub: h.sub, hint: h.hint, run: () => runHit(h.target) });
  }
  if (cmds.length) groups.push(['Commands', cmds]);
  const run = (it: PalItem) => { closeOverlay(); it.run(); };
  return (
    <div className="pal" role="dialog" aria-label="Search">
      <div className="in">
        <input ref={input} placeholder="Search part no., bin, lot, AWB, PO, MR or SC number, person, site" value={q}
          onChange={e => openPalette(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && groups[0]) run(groups[0][1][0]); }} />
        <kbd>Esc</kbd>
      </div>
      {groups.map(([g, items]) => (
        <div className="grp" key={g}>
          <span className="eb">{g}</span>
          {items.map((it, i) => (
            <button key={g + i + it.title} className="it" onClick={() => run(it)}>
              <span><b>{it.title}</b><small>{it.sub}</small></span><kbd>{it.hint}</kbd>
            </button>
          ))}
        </div>
      ))}
      {!hits.length && ql.length >= 2 && !busy && <div style={{ padding: '1rem 1.25rem', fontSize: '.875rem', color: '#767A82' }}>No records match “{q}”</div>}
      <div className="ft"><span>Enter · open the first result</span><span>1–8 · switch module</span><span>Esc · close</span></div>
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
      {db.kind === 'demo' && <>
        <span className="eb">Demo data</span>
        <button onClick={() => void resetDemoData()}><span>Reset to the starting sample</span><span>↺</span></button>
      </>}
    </div>
  );
}

function UserMenu({ top, right }: { top: number; right: number }) {
  const me = useApp(s => s.user), users = useQuery('users', {}, { sort: { name: 1 } }).data;
  return (
    <div className="menu" style={{ top, right }} role="menu">
      <span className="eb">{db.kind === 'demo' ? 'Demo · act as' : 'Signed in'}</span>
      {users.map(u => (
        <button key={u._id} role="menuitemradio" aria-checked={u._id === me} onClick={() => setUser(u._id)} disabled={db.kind !== 'demo' && u._id !== me}>
          <span>{u.name} · {ROLE_LABEL[u.role]}</span>{u._id === me && <b>On</b>}
        </button>
      ))}
    </div>
  );
}

function PhotoViewer({ site, i }: { site: string; i: number }) {
  const ph = useApp(s => s.photos[site]), screen = useApp(s => s.screen);
  if (ph?.status !== 'ready' || !ph.items[i]) return null;
  const p = ph.items[i], n = ph.items.length;
  return (
    <figure className="lightbox" role="dialog" aria-label={p.title}>
      <img src={p.full} alt={p.title} />
      <figcaption>
        <span><b>{p.title}</b><small>{p.source} · {p.credit} · {p.licence} · {SITE_BY_ID[site].name}</small></span>
        <span className="lb-actions">
          <button className="btn" onClick={() => openPhoto(site, (i + n - 1) % n)} aria-label="Previous photo">‹</button>
          <button className="btn" onClick={() => openPhoto(site, (i + 1) % n)} aria-label="Next photo">›</button>
          {p.ll && screen === 'site' && <button className="btn" onClick={() => viewPhotoIn3D(site, i)}>View in 3D</button>}
          <a className="btn" href={p.page} target="_blank" rel="noreferrer">Source ↗</a>
          <button className="btn primary" onClick={closeOverlay}>Close</button>
        </span>
      </figcaption>
    </figure>
  );
}

export function Overlay() {
  const o = useApp(s => s.overlay);
  if (!o) return null;
  return (
    <div className={`overlay${o.kind === 'photo' ? ' dark' : ''}`} style={o.kind === 'display' || o.kind === 'user' || o.kind === 'alerts' ? { background: 'transparent' } : undefined}
      onClick={e => { if (e.target === e.currentTarget) closeOverlay(); }}>
      {o.kind === 'palette' ? <Palette q={o.q} /> : o.kind === 'display' ? <DisplayMenu top={o.top} right={o.right} /> : o.kind === 'user' ? <UserMenu top={o.top} right={o.right} /> : o.kind === 'alerts' ? <AlertsPanel top={o.top} right={o.right} /> : <PhotoViewer site={o.site} i={o.i} />}
    </div>
  );
}
