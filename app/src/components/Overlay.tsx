// Command palette (Ctrl K) and the Display / touch-density menu.
import { useEffect, useRef, useState } from 'react';
import { SITE_BY_ID, SITES } from '../data/sites';
import type { ScreenId } from '../data/types';
import { closeOverlay, go, openPalette, openPhoto, selectSite, setCesiumToken, setGoogleKey, setTilesUrl, setKiosk, viewPhotoIn3D } from '../state/actions';
import { useApp } from '../state/store';

interface PalItem { title: string; sub: string; hint: string; run: () => void }
const toScreen = (s: ScreenId) => () => go(s);
const PAL: [string, PalItem[]][] = [
  ['Parts', [
    { title: 'KM-DX-ACT-220 rev C · Door operator actuator', sub: 'Bin D-05-04 · Electronics store · KTEC Chennai', hint: 'Fly to bin', run: toScreen('store') },
    { title: 'KM-PCB-IOT-022 · IoT gateway PCB', sub: 'Bin C-10-04 · count variance', hint: 'Fly to bin', run: toScreen('store') },
  ]],
  ['Shipments', [
    { title: 'DEL 2210 9934 7781 · Delhivery', sub: 'E-way bill hold at Hubballi · KONE ISU → KTEC Pune', hint: 'Track', run: toScreen('shipments') },
  ]],
  ['Sites', SITES.map(s => ({ title: s.name, sub: s.address, hint: 'Fly to site', run: () => selectSite(s.id) }))],
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
  const kiosk = useApp(s => s.kiosk), key = useApp(s => s.googleKey), ion = useApp(s => s.cesiumToken);
  const tilesUrl = useApp(s => s.tilesUrl);
  const [draft, setDraft] = useState(key), [ionDraft, setIonDraft] = useState(ion), [urlDraft, setUrlDraft] = useState(tilesUrl);
  return (
    <div className="menu" style={{ top, right }} role="menu">
      <span className="eb">Touch density</span>
      <button role="menuitemradio" aria-checked={!kiosk} onClick={() => setKiosk(false)}><span>Standard · 13–27 in screens</span>{!kiosk && <b>On</b>}</button>
      <button role="menuitemradio" aria-checked={kiosk} onClick={() => setKiosk(true)}><span>Kiosk touch · 32–55 in screens</span>{kiosk && <b>On</b>}</button>
      <span className="eb">Photorealistic 3D</span>
      <form className="keyform" onSubmit={e => { e.preventDefault(); setCesiumToken(ionDraft); }}>
        <label htmlFor="iontoken">Cesium ion access token (Google Photorealistic 3D Tiles through Cesium). Used first. Stored only on this device.</label>
        <div><input id="iontoken" type="password" autoComplete="off" value={ionDraft} onChange={e => setIonDraft(e.target.value)} placeholder="eyJ…" />
          <button type="submit" className="btn primary">{ionDraft ? 'Save' : 'Clear'}</button></div>
      </form>
      <form className="keyform" onSubmit={e => { e.preventDefault(); setGoogleKey(draft); }}>
        <label htmlFor="gkey">Google Maps Platform key with Map Tiles API, Places API (New) and Street View Static API. Stored only on this device.</label>
        <div><input id="gkey" type="password" autoComplete="off" value={draft} onChange={e => setDraft(e.target.value)} placeholder="AIza…" />
          <button type="submit" className="btn primary">{draft ? 'Save' : 'Clear'}</button></div>
      </form>
      <form className="keyform" onSubmit={e => { e.preventDefault(); setTilesUrl(urlDraft); }}>
        <label htmlFor="tilesurl">Own 3D capture (drone survey) as a 3D Tiles tileset.json URL. Used before Cesium and Google.</label>
        <div><input id="tilesurl" type="url" autoComplete="off" value={urlDraft} onChange={e => setUrlDraft(e.target.value)} placeholder="https://…/tileset.json" />
          <button type="submit" className="btn primary">{urlDraft ? 'Save' : 'Clear'}</button></div>
      </form>
      <span className="eb">Preview</span>
      <button onClick={() => { closeOverlay(); window.open('layouts.html', '_blank'); }}><span>All screen sizes side by side</span><span>↗</span></button>
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
    <div className={`overlay${o.kind === 'photo' ? ' dark' : ''}`} style={o.kind === 'display' ? { background: 'transparent' } : undefined}
      onClick={e => { if (e.target === e.currentTarget) closeOverlay(); }}>
      {o.kind === 'palette' ? <Palette q={o.q} /> : o.kind === 'display' ? <DisplayMenu top={o.top} right={o.right} /> : <PhotoViewer site={o.site} i={o.i} />}
    </div>
  );
}
