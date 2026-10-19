import { useEffect, useRef } from 'react';
import { Drawer } from './components/drawer/Drawer';
import { Overlay } from './components/Overlay';
import { Mobile } from './components/pages/Mobile';
import { Reports } from './components/pages/Reports';
import { Controls, Crumbs, Loading, MoveBanner, Rail, Timeline, Toast } from './components/StageChrome';
import { ModuleTabs, TopBar } from './components/TopBar';
import { MODULES } from './data/sample';
import { globe } from './globe/globe';
import { escape, go, openPalette } from './state/actions';
import { getState, useApp } from './state/store';
import { threeEngine } from './three/engine';
import { useLayout } from './useLayout';

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
  const screen = useApp(s => s.screen), stage = useApp(s => s.stage);
  const globeRef = useRef<HTMLDivElement>(null), globeOvRef = useRef<HTMLDivElement>(null), creditsRef = useRef<HTMLDivElement>(null);
  const threeRef = useRef<HTMLDivElement>(null), labelsRef = useRef<HTMLDivElement>(null), radialRef = useRef<HTMLDivElement>(null);
  useLayout();
  useKeyboard();

  useEffect(() => {
    // Each engine starts independently, so a WebGL or network failure in one never blanks the app.
    try { globe.init(globeRef.current!, globeOvRef.current!, creditsRef.current!); } catch (e) { console.error('Globe failed to start', e); }
    try { threeEngine.init(threeRef.current!, labelsRef.current!, radialRef.current!); } catch (e) { console.error('Store view failed to start', e); }
  }, []);

  // Drive the imperative engines once the visible surface has been committed to the DOM.
  useEffect(() => {
    if (stage === 'globe') { threeEngine.leave(); globe.show(screen); }
    else if (stage === 'three') threeEngine.enter();
    else threeEngine.leave();
  }, [screen, stage]);

  const isPage = stage === 'page';
  return (
    <div id="app">
      <TopBar />
      <main id="stage">
        <div id="globe" ref={globeRef} className={`view${stage === 'globe' ? '' : ' hidden'}`} />
        <div id="globe-ov" ref={globeOvRef} className={stage === 'globe' ? '' : 'hidden'} />
        <div id="three" ref={threeRef} className={`view${stage === 'three' ? '' : ' hidden'}`} />
        <div id="labels" ref={labelsRef} className={stage === 'three' ? '' : 'hidden'} />
        <div id="radial" ref={radialRef} className="hidden" />
        <Loading />
        <MoveBanner />
        <Crumbs hidden={isPage} />
        <Rail hidden={isPage} />
        <Controls hidden={isPage} />
        <Drawer hidden={isPage} />
        <Timeline hidden={isPage} />
        <Reports hidden={screen !== 'reports'} />
        <Mobile hidden={screen !== 'mobile'} />
        <div id="credits" ref={creditsRef} className={`credits${stage === 'globe' ? '' : ' hidden'}`} aria-label="Map data credits" />
        <Toast />
      </main>
      <ModuleTabs dock />
      <Overlay />
    </div>
  );
}
