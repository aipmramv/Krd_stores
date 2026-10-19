import { binId } from '../data/storeModel';
import type { Bin, ColorMode, ScreenId } from '../data/types';
import { globe } from '../globe/globe';
import { loadPhotos } from '../services/photos';
import { threeEngine } from '../three/engine';
import { getState, GLOBE_SCREENS, setState, SITE_SCREENS, stageFor, storeToken, type AppState } from './store';

const isSiteScreen = (s: ScreenId) => SITE_SCREENS.includes(s);

/** Switch screen. Map and site screens share the Cesium globe, so moving between them is one camera flight. */
export function go(screen: ScreenId) {
  const s = getState();
  setState({ overlay: null });
  if (isSiteScreen(screen)) loadPhotos(s.site);
  setState({ screen, stage: stageFor(screen) });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  setState(s => ({ toast: { msg, n: (s.toast?.n ?? 0) + 1 } }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3600);
}

/** Select a site. On a site screen the globe flies straight across to it. */
export function selectSite(id: string) {
  loadPhotos(id);
  setState({ site: id, bld: null });
}
/** Map pin click: select the site and return to the network view if needed. */
export function pinSite(id: string) {
  setState({ site: id });
  loadPhotos(id);
  if (getState().screen !== 'network') go('network');
}
export const selectRoute = (i: number) => setState({ route: i });
export function selectShip(i: number) { setState({ ship: i }); globe.fitScreen(); }
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
export function focusBuilding(k: string) { selectBuilding(k); globe.focus(k); }
export const toggleRail = () => setState(s => ({ railOpen: !s.railOpen }));
export const toggleDrawer = () => setState(s => ({ drawerOpen: !s.drawerOpen }));
export const cycleSheet = () => setState(s => ({ sheet: ({ peek: 'half', half: 'full', full: 'peek' } as const)[s.sheet] }));
export const setTime = (t: number) => setState({ t });
export const goLive = () => setState({ t: 0, tod: null });
export const setTimeOfDay = (tod: number | null) => setState({ tod });
export const toggleMapTilt = () => setState(s => ({ mapTilt: !s.mapTilt }));
export const toggleTour = () => setState(s => ({ tour: !s.tour }));
export function togglePhotoreal() {
  const s = getState();
  if (!s.cesiumToken) { toast('Add your Cesium ion token in Display to use photorealistic 3D'); return; }
  setState({ photoreal: !s.photoreal });
}
/** Save the Cesium ion token on this device and restart, so every globe layer loads with it. */
export function setCesiumToken(t: string) {
  storeToken(t.trim());
  location.reload();
}
export const setKiosk = (on: boolean) => { setState({ kiosk: on, overlay: null }); requestAnimationFrame(() => threeEngine.refreshRadial()); };
export const openPalette = (q = '') => setState({ overlay: { kind: 'palette', q } });
export const openDisplayMenu = (r: DOMRect) => setState({ overlay: { kind: 'display', top: r.bottom + 6, right: innerWidth - r.right } });
export const openPhoto = (site: string, i: number) => setState({ overlay: { kind: 'photo', site, i } });
export const closeOverlay = () => setState({ overlay: null });
export function viewPhotoIn3D(site: string, i: number) { closeOverlay(); globe.viewPhoto(site, i); }

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

const onGlobe = () => GLOBE_SCREENS.includes(getState().screen);
export function zoom(d: 1 | -1) {
  if (onGlobe()) globe.zoomBy(d);
  else threeEngine.zoomBy(d);
}
export function resetView() {
  if (onGlobe()) globe.fitScreen();
  else threeEngine.enter();
}
/** Store: 2D/3D camera. Site screens: straight-down or oblique view (the globe re-frames on change). */
export function toggleDim() {
  setState(s => ({ dim: s.dim === '3D' ? '2D' : '3D' }));
  if (!onGlobe()) threeEngine.applyDim();
}

export function escape() {
  closeOverlay();
  if (getState().moveFrom) setState({ moveFrom: null });
}
