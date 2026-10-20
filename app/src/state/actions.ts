import { SITE_BY_ID } from '../data/sites';
import { binId } from '../data/storeModel';
import type { Bin, ColorMode, ScreenId } from '../data/types';
import { mapEngine } from '../map/mapEngine';
import { loadPhotos } from '../services/photos';
import { threeEngine } from '../three/engine';
import { db } from '../db';
import * as moves from '../services/moves';
import { getState, MAP_SCREENS, setState, stageFor, USER_KEY } from './store';

const isMap = (s: ScreenId) => MAP_SCREENS.includes(s);
const isSiteScreen = (s: ScreenId) => s === 'site' || s === 'movements';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** Map opacity cross-fade length; matches the .fade-in / .fade-out CSS. */
const FADE_MS = 900;
let busy = false;

/** Map → site: fly the map down while the 3D scene builds, then cross-fade into a matching 3D camera. */
async function flyIntoSite(screen: 'site' | 'movements') {
  const site = SITE_BY_ID[getState().site];
  setState({ screen, overlay: null, loading: true });
  loadPhotos(site.id);
  busy = true;
  try {
    await Promise.all([mapEngine.flyToSite(site.ll), threeEngine.prepare(site.id)]);
  } finally { busy = false; }
  if (getState().screen !== screen) { setState({ loading: false }); return; }
  setState({ stage: 'three', fade: 'out', loading: false });
  setTimeout(() => setState({ fade: null }), FADE_MS);
}

/** Site → map: rise to the matching overhead view, cross-fade to the map, then zoom out. */
async function riseOutOfSite(next: ScreenId) {
  const site = SITE_BY_ID[getState().site];
  busy = true;
  try { await threeEngine.toOverhead(900); } finally { busy = false; }
  mapEngine.handoffFrom = site.ll;
  setState({ screen: next, stage: 'map', fade: 'in' });
  setTimeout(() => setState({ fade: null }), FADE_MS);
}

export function go(screen: ScreenId) {
  const s = getState();
  if (busy) return;
  setState({ overlay: null });
  if (isSiteScreen(screen) && isMap(s.screen) && mapEngine.ready) { void flyIntoSite(screen); return; }
  if (isMap(screen) && isSiteScreen(s.screen) && s.stage === 'three') { void riseOutOfSite(screen); return; }
  if (isSiteScreen(screen)) loadPhotos(s.site);
  setState({ screen, stage: stageFor(screen), ...(screen === 'site' || screen === 'store' ? {} : { floor: null, walk: false }) });
}

/** Open one floor of the primary building: the storeys above lift away and the camera glides in. */
export function enterFloor(i: number) {
  setState({ bld: 'main', floor: i, walk: false });
  threeEngine.showFloor();
}
export function exitFloor() {
  if (getState().floor === null) return;
  setState({ floor: null, walk: false });
  threeEngine.showFloor();
}
/** Step inside the opened floor at eye level, or back out to the cutaway. */
export function toggleWalk() {
  setState(s => ({ walk: !s.walk }));
  threeEngine.showFloor();
}

/** Switch site from inside the 3D twin: up to the map, across to the new site, and back down. */
async function travel(id: string) {
  const s = getState(), from = SITE_BY_ID[s.site], screen = s.screen as 'site' | 'movements';
  busy = true;
  try {
    await threeEngine.toOverhead(800);
    mapEngine.handoffFrom = from.ll;
    setState({ stage: 'map', fade: 'in' });
    await sleep(FADE_MS);
    setState({ fade: null, site: id, bld: null, floor: null, walk: false });
  } finally { busy = false; }
  await flyIntoSite(screen);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  setState(s => ({ toast: { msg, n: (s.toast?.n ?? 0) + 1 } }));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 3600);
}

export function selectSite(id: string) {
  const s = getState();
  if (busy || id === s.site && isSiteScreen(s.screen)) return;
  loadPhotos(id);
  if (isSiteScreen(s.screen) && s.stage === 'three') { void travel(id); return; }
  setState({ site: id, bld: null, floor: null, walk: false });
  if (isMap(s.screen)) mapEngine.flyTo(SITE_BY_ID[id].ll, 8);
}
/** Map pin click: select the site and return to the network view if needed. */
export function pinSite(id: string) {
  setState({ site: id });
  loadPhotos(id);
  if (getState().screen !== 'network') go('network');
  else mapEngine.flyTo(SITE_BY_ID[id].ll, 8);
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
export const togglePeel = () => setState(s => ({ peel: !s.peel }));
export const selectBuilding = (k: string) => setState({ bld: k });
export function focusBuilding(k: string) { selectBuilding(k); threeEngine.focus(k); }
export const toggleRail = () => setState(s => ({ railOpen: !s.railOpen }));
export const toggleDrawer = () => setState(s => ({ drawerOpen: !s.drawerOpen }));
export const cycleSheet = () => setState(s => ({ sheet: ({ peek: 'half', half: 'full', full: 'peek' } as const)[s.sheet] }));
export const setTime = (t: number) => setState({ t });
export const goLive = () => setState({ t: 0, tod: null });
export const setTimeOfDay = (tod: number | null) => setState({ tod });
export const toggleTour = () => setState(s => ({ tour: !s.tour }));
export const setKiosk = (on: boolean) => { setState({ kiosk: on, overlay: null }); requestAnimationFrame(() => threeEngine.refreshRadial()); };
export const openPalette = (q = '') => setState({ overlay: { kind: 'palette', q } });
export const openUserMenu = (r: DOMRect) => setState({ overlay: { kind: 'user', top: r.bottom + 6, right: innerWidth - r.right } });
export function setUser(id: string) {
  setState({ user: id, overlay: null });
  try { localStorage.setItem(USER_KEY, id); } catch { /* private mode: not remembered */ }
}
export async function resetDemoData() {
  setState({ overlay: null });
  await db.reset();
  toast('Demo data reset to the starting sample');
}
export const openDisplayMenu = (r: DOMRect) => setState({ overlay: { kind: 'display', top: r.bottom + 6, right: innerWidth - r.right } });
export const openPhoto = (site: string, i: number) => setState({ overlay: { kind: 'photo', site, i } });
export const closeOverlay = () => setState({ overlay: null });
export function viewPhotoIn3D(site: string, i: number) { closeOverlay(); threeEngine.viewPhoto(site, i); }

export function selectBin(b: Bin) { setState({ bin: b }); }

export function binAction(a: string) {
  const { bin } = getState(), id = binId(bin);
  if (a === 'Move') { startMove(bin); return; }
  const what = a === 'Scrap' ? 'scrap case started, add reason and photo'
    : a === 'Count' ? 'cycle count task sent to scanner'
    : a === 'Reserve' ? 'reserved 4 for DX Class 2027' : 'opened';
  toast(`${a} · ${id} · ${what}`);
}
// ---------- Move requests ----------
/** Start drawing a move from a bin: the destination comes from a tap, a drag or the form. */
export function startMove(from: Bin, to: Bin | null = null) {
  setState({ moveDraft: { from: { ...from }, to: to && binId(to) !== binId(from) ? { ...to } : null }, bin: { ...from } });
  threeEngine.hideRadial();
  threeEngine.drawMoves();
}
export function setMoveTarget(to: Bin) {
  const d = getState().moveDraft;
  if (!d) return;
  if (binId(to) === binId(d.from)) { toast('Choose a different bin as the destination'); return; }
  setState({ moveDraft: { ...d, to: { ...to } } });
  threeEngine.drawMoves();
}
export function cancelMove() { setState({ moveDraft: null }); threeEngine.drawMoves(); threeEngine.showRadial(); }

const fail = (e: unknown) => { toast((e as Error).message); return null; };

export async function submitMove(lotId: string, qty: number, reason: string) {
  const s = getState(), d = s.moveDraft;
  if (!d?.to) { toast('Choose the destination bin'); return; }
  const mv = await moves.requestMove({ site: s.site, lotId, to: `${s.site}:${binId(d.to)}`, qty, reason }, s.user).catch(fail);
  if (!mv) return;
  setState({ moveDraft: null });
  threeEngine.drawMoves();
  threeEngine.showRadial();
  toast(mv.status === 'approved' ? `${mv._id} approved · ${qty} × ${mv.partNo} ${binId(d.from)} → ${binId(d.to)} · ready to move` : `${mv._id} sent to the store manager for approval`);
}
export async function decideMove(id: string, decision: 'approved' | 'rejected') {
  const mv = await moves.decide(id, decision, getState().user).catch(fail);
  if (mv) toast(`${id} ${decision === 'approved' ? (mv.status === 'approved' ? 'approved · ready to move' : 'approved · next approver notified') : 'rejected · requester notified'}`);
}
export async function confirmMove(id: string) {
  const mv = await moves.complete(id, getState().user).catch(fail);
  if (mv) toast(`${id} done · stock moved and bins updated`);
}
export async function cancelMoveRequest(id: string) {
  const mv = await moves.cancel(id, getState().user).catch(fail);
  if (mv) toast(`${id} cancelled`);
}

export function zoom(d: 1 | -1) {
  if (isMap(getState().screen)) mapEngine.zoomBy(d);
  else threeEngine.zoomBy(d);
}
export function resetView() {
  if (isMap(getState().screen)) mapEngine.fitScreen();
  else { setState({ floor: null, walk: false }); void threeEngine.enter({ reset: true }); }
}
export function toggleDim() {
  setState(s => ({ dim: s.dim === '3D' ? '2D' : '3D' }));
  threeEngine.applyDim();
}

export function escape() {
  const s = getState();
  closeOverlay();
  if (s.moveDraft) cancelMove();
  else if (!s.overlay && s.screen === 'site' && s.floor !== null) { if (s.walk) toggleWalk(); else exitFloor(); }
}
