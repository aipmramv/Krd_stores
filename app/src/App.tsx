import { useEffect, useRef } from 'react';
import { Drawer } from './components/drawer/Drawer';
import { Overlay } from './components/Overlay';
import { Board } from './components/pages/Board';
import { Mobile } from './components/pages/Mobile';
import { Reports } from './components/pages/Reports';
import { Controls, Crumbs, Loading, MoveBanner, Rail, Timeline, Toast } from './components/StageChrome';
import { SelectionBar } from './components/StoreTools';
import { ModuleTabs, TopBar } from './components/TopBar';
import { MODULES } from './data/sample';
import { mapEngine } from './map/mapEngine';
import { escape, go, openPalette } from './state/actions';
import { setActor } from './db';
import { getState, useApp } from './state/store';
import { threeEngine } from './three/engine';
import { useLayout } from './useLayout';

setActor(() => getState().user);

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
      if (e.key === 'Escape') { escape(); return; }
      if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement | null)?.tagName ?? '')) return;
      if (getState().overlay) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= MODULES.length) go(MODULES[n - 1][0]);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const screen = useApp(s => s.screen), stage = useApp(s => s.stage), fade = useApp(s => s.fade);
  const mapRef = useRef<HTMLDivElement>(null), threeRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null), radialRef = useRef<HTMLDivElement>(null);
  useLayout();
  useKeyboard();

  useEffect(() => {
    // Each engine starts independently, so a WebGL or network failure in one never blanks the app.
    try { mapEngine.init(mapRef.current!); } catch (e) { console.error('Map failed to start', e); }
    try { threeEngine.init(threeRef.current!, labelsRef.current!, radialRef.current!); } catch (e) { console.error('3D view failed to start', e); }
  }, []);

  // Drive the imperative engines once the visible surface has been committed to the DOM.
  useEffect(() => {
    if (stage === 'three') { void threeEngine.enter({ handoff: getState().fade === 'out' }); return; }
    if (getState().fade !== 'in') threeEngine.leave();
    if (stage === 'map') mapEngine.show(screen);
  }, [screen, stage]);
  useEffect(() => { if (stage === 'map' && !fade) threeEngine.leave(); }, [stage, fade]);

  const isPage = stage === 'page';
  return (
    <div id="app">
      <TopBar />
      <main id="stage">
        {/* During the map ↔ 3D handoff both surfaces are shown and the map cross-fades above the 3D view. */}
        <div id="three" ref={threeRef} className={`view${stage === 'three' || fade === 'in' ? '' : ' hidden'}`} />
        <div id="map" ref={mapRef} className={`view${stage === 'map' || fade === 'out' ? '' : ' hidden'}${fade ? ' fade-' + fade : ''}`} />
        <div id="labels" ref={labelsRef} className={stage === 'three' && !fade ? '' : 'hidden'} />
        <div id="radial" ref={radialRef} className="hidden" />
        <Loading />
        <MoveBanner />
        <SelectionBar />
        <Crumbs hidden={isPage} />
        <Rail hidden={isPage} />
        <Controls hidden={isPage} />
        <Drawer hidden={isPage} />
        <Timeline hidden={isPage} />
        <Reports hidden={screen !== 'reports'} />
        <Mobile hidden={screen !== 'mobile'} />
        <Board hidden={screen !== 'board'} />
        <Toast />
      </main>
      <ModuleTabs dock />
      <Overlay />
    </div>
  );
}
