import { SITE_BY_ID } from '../data/sample';
import { binId } from '../data/storeModel';
import type { Bin, ColorMode, ScreenId } from '../data/types';
import { mapEngine } from '../map/mapEngine';
import { threeEngine } from '../three/engine';
import { getState, MAP_SCREENS, setState, stageFor, type AppState } from './store';

const isMap = (s: ScreenId) => MAP_SCREENS.includes(s);

export function go(screen: ScreenId) {
  const from = getState().screen;
  setState({ overlay: null });
  // From a map screen, fly the map down to the site before swapping to the 3D twin.
  if (screen === 'site' && isMap(from) && mapEngine.ready) {
    setState({ screen });
    mapEngine.flyToSite(SITE_BY_ID[getState().site].ll, () => {
      if (getState().screen === 'site') setState({ stage: 'three' });
    });
    return;
  }
  setState({ screen, stage: stageFor(screen) });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  setState(s => ({ toast: { msg, n: (s.toast?.n ?? 0) + 1 } }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3200);
}

export function selectSite(id: string) {
  setState({ site: id, bld: null });
  mapEngine.flyTo(SITE_BY_ID[id].ll, 7);
}
/** Map pin click: select the site and return to the network view if needed. */
export function pinSite(id: string) {
  setState({ site: id });
  if (getState().screen !== 'network') go('network');
  else mapEngine.flyTo(SITE_BY_ID[id].ll, 6);
}
export const selectRoute = (i: number) => setState({ route: i });
export function selectShip(i: number) { setState({ ship: i }); mapEngine.fitScreen(); }
export function setMode(mode: ColorMode) { setState({ mode }); threeEngine.recolorBins(); }
export function toggleLayer(id: string) {
  setState(s => {
    const scr = s.screen, cur = s.off[scr] ?? {};
    return { off: { ...s.off, [scr]: { ...cur, [id]: !cur[id] } } };
  });
  if (getState().screen === 'store') threeEngine.recolorBins();
}
export const setBase = (base: AppState['base']) => setState({ base });
export const togglePeel = () => setState(s => ({ peel: !s.peel }));
export const selectBuilding = (k: string) => setState({ bld: k });
export const toggleRail = () => setState(s => ({ railOpen: !s.railOpen }));
export const toggleDrawer = () => setState(s => ({ drawerOpen: !s.drawerOpen }));
export const cycleSheet = () => setState(s => ({ sheet: ({ peek: 'half', half: 'full', full: 'peek' } as const)[s.sheet] }));
export const setTime = (t: number) => setState({ t });
export const goLive = () => setState({ t: 0 });
export const setKiosk = (on: boolean) => { setState({ kiosk: on, overlay: null }); requestAnimationFrame(() => threeEngine.refreshRadial()); };
export const openPalette = (q = '') => setState({ overlay: { kind: 'palette', q } });
export const openDisplayMenu = (r: DOMRect) => setState({ overlay: { kind: 'display', top: r.bottom + 6, right: innerWidth - r.right } });
export const closeOverlay = () => setState({ overlay: null });

export function selectBin(b: Bin) { setState({ bin: b }); }

export function binAction(a: string) {
  const { bin } = getState(), id = binId(bin);
  if (a === 'Move') { setState({ moveFrom: { ...bin } }); threeEngine.hideRadial(); return; }
  const what = a === 'Scrap' ? 'scrap case started, add reason and photo'
    : a === 'Count' ? 'cycle count task sent to scanner'
    : a === 'Reserve' ? 'reserved 4 for DX Class 2027' : 'opened';
  toast(`${a} · ${id} · ${what}`);
}
export function cancelMove() { setState({ moveFrom: null }); threeEngine.showRadial(); }
export function completeMove(a: Bin, b: Bin) {
  setState({ moveFrom: null, bin: b });
  toast(`Move request MR-26-1184 created · ${binId(a)} → ${binId(b)} · sent to stores for scan confirmation`);
}

export function zoom(d: 1 | -1) {
  if (isMap(getState().screen)) mapEngine.zoomBy(d);
  else threeEngine.zoomBy(d);
}
export function resetView() {
  if (isMap(getState().screen)) mapEngine.fitScreen();
  else threeEngine.enter(true);
}
export function toggleDim() {
  setState(s => ({ dim: s.dim === '3D' ? '2D' : '3D' }));
  threeEngine.applyDim();
}

export function escape() {
  closeOverlay();
  if (getState().moveFrom) setState({ moveFrom: null });
}
