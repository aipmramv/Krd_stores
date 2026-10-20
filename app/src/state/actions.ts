import { SITE_BY_ID } from '../data/sites';
import { binId } from '../data/storeModel';
import type { Bin, ColorMode, ScreenId } from '../data/types';
import { mapEngine } from '../map/mapEngine';
import { loadPhotos } from '../services/photos';
import { threeEngine } from '../three/engine';
import { db } from '../db';
import * as moves from '../services/moves';
import * as scrap from '../services/scrap';
import * as ships from '../services/shipments';
import * as stock from '../services/stock';
import { getState, MAP_SCREENS, setState, stageFor, USER_KEY, type AppState } from './store';

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
export const selectRoute = (id: string) => setState(s => ({ plan: { ...s.plan, option: id } }));
export function selectShip(id: string) { setState({ ship: id }); mapEngine.fitScreen(); }
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

const TASK: Record<string, AppState['binTask']> = { Pick: 'pick', 'Put-away': 'putaway', Count: 'count', Reserve: 'reserve', History: 'history' };
export function setBinTask(t: AppState['binTask']) { setState({ binTask: t, moveDraft: null, scrapNew: null }); if (t) threeEngine.hideRadial(); else threeEngine.showRadial(); }

export function binAction(a: string) {
  const { bin } = getState(), id = binId(bin), loc = `${getState().site}:${id}`;
  if (a === 'Move') { startMove(bin); return; }
  if (TASK[a]) { setBinTask(TASK[a]); return; }
  if (a === 'Label') { void import('../components/drawer/storeTasks').then(m => m.printLabels(loc)); return; }
  if (a === 'Docs') { void import('../components/drawer/storeTasks').then(m => m.printPartSheet(loc)); return; }
  if (a === 'Scrap') { void db.find('stockLots', { locationId: `${getState().site}:${id}` }).then(l => newScrap(l.find(x => x.qty > x.reserved)?._id)); return; }
  toast(`${a} · ${id}`);
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
// ---------- Store actions ----------
const okToast = (msg: string) => (x: unknown) => { if (x) toast(msg); return x; };
export const binPick = (lotId: string, qty: number, purpose: string, againstReservation: boolean) =>
  stock.pick({ lotId, qty, purpose, againstReservation }, getState().user).catch(fail).then(okToast(`Picked ${qty} · ${purpose.toLowerCase()}`));
export const binPutAway = (taskId: string, to: string, qty: number) => stock.putAway(taskId, to, qty, getState().user).catch(fail).then(okToast(`Put away ${qty} in ${to.split(':')[1]}`));
export const binReceive = (partNo: string, qty: number, to: string, lot: string, ref: string) =>
  stock.receive({ site: getState().site, partNo, qty, to, lot, ref }, getState().user).catch(fail).then(okToast(`Received ${qty} × ${partNo} into ${to.split(':')[1]}`));
export async function binCount(entries: { lotId: string; counted: number }[]) {
  const out = await stock.count(entries, getState().user).catch(fail);
  if (!out) return;
  const v = out.filter(m => m.counted !== m.qty);
  toast(!v.length ? 'Count matches · posted' : v.every(m => m.status === 'done') ? `Variance posted · ${v.map(m => `${(m.counted ?? 0) - m.qty > 0 ? '+' : ''}${(m.counted ?? 0) - m.qty}`).join(', ')}` : `Variance sent to the store manager · ${v.map(m => m._id).join(', ')}`);
}
export const binDecideCount = (id: string, d: 'approved' | 'rejected') => stock.decideCount(id, d, getState().user).catch(fail).then(okToast(d === 'approved' ? `${id} posted · stock adjusted` : `${id} · recount requested`));
export const binReserve = (lotId: string, qty: number, project: string, until: string) => stock.reserve({ lotId, qty, project, until }, getState().user).catch(fail).then(okToast(`Reserved ${qty} for ${project} until ${until}`));
export const binRelease = (lotId: string, qty: number) => stock.release(lotId, qty, getState().user).catch(fail).then(okToast(`Released ${qty}`));

// ---------- Shipments ----------
type Plan = AppState['plan'];
export const setPlan = (p: Partial<Plan>) => setState(s => ({ plan: { ...s.plan, ...p }, booked: null }));
export const setPlanOptions = (planOptions: AppState['planOptions']) => setState(s => ({
  planOptions,
  plan: planOptions.some(o => o.id === s.plan.option && o.allowed) ? s.plan : { ...s.plan, option: planOptions.find(o => o.allowed)?.id ?? null },
}));
export async function bookPlan() {
  const s = getState();
  if (!s.plan.option) { toast('Choose a shipping option'); return; }
  const sh = await ships.book({ from: s.plan.from, to: s.plan.to, lines: s.plan.lines, optionId: s.plan.option }, s.user).catch(fail);
  if (!sh) return;
  setState({ booked: sh._id, ship: sh._id });
  toast(sh.status === 'Booked' ? `Booked ${sh._id} · ${sh.carrier} · pick-up ${new Date(sh.pickupAt!).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : `${sh._id} held for EHS approval · dangerous goods`);
}
/** Split: dangerous goods by road, everything else by the selected option. */
export async function splitPlan() {
  const s = getState(), parts = new Map((await db.find('parts')).map(p => [p._id, p]));
  const haz = s.plan.lines.filter(l => /UN\d/.test(parts.get(l.partNo)?.hazard ?? '')), rest = s.plan.lines.filter(l => !haz.includes(l));
  if (!haz.length || !rest.length) { toast('Nothing to split · all items can travel together'); return; }
  const road = ships.quote(s.plan.from, s.plan.to, haz, parts).find(o => o.allowed && o.kind === 'road');
  if (!road || !s.plan.option) { toast('No road option can carry the dangerous goods'); return; }
  const a = await ships.book({ from: s.plan.from, to: s.plan.to, lines: haz, optionId: road.id }, s.user).catch(fail);
  if (!a) return;
  const b = await ships.book({ from: s.plan.from, to: s.plan.to, lines: rest, optionId: s.plan.option }, s.user).catch(fail);
  if (!b) { toast(`${a._id} booked for the dangerous goods; the rest could not be booked`); return; }
  setState({ booked: b._id, ship: b._id });
  toast(`Split · ${a._id} (Li-ion, ${road.mode}) and ${b._id} (${b.option})`);
}
const shipDone = (msg: string) => (x: unknown) => { if (x) toast(msg); };
export const shipApprove = (id: string, d: 'approved' | 'rejected' = 'approved') => ships.approveHazmat(id, getState().user, d).catch(fail).then(shipDone(d === 'approved' ? `${id} approved by EHS · booked` : `${id} rejected · stock released`));
export const shipAdvance = (id: string) => ships.advance(id, getState().user).catch(fail).then(x => { if (x) toast(`${id} · ${x.status}${x.status === 'Delivered' ? ' · received into inbound staging, put-away tasks created' : x.status === 'Picked up' ? ' · stock left the source site' : ''}`); });
export const shipClearHold = (id: string, note: string) => ships.clearHold(id, getState().user, note).catch(fail).then(shipDone(`${id} hold cleared · back in transit`));
export const shipNotify = (id: string) => ships.notifyReceiver(id, getState().user).catch(fail).then(shipDone(`Receiver notified · Teams and email · ${id}`));
export const shipClaim = (id: string, kind: 'Damage' | 'Shortage' | 'Delay', amount: number, note: string) => ships.raiseClaim(id, { kind, amount, note }, getState().user).catch(fail).then(shipDone(`${kind} claim raised on ${id}`));
export const shipCancel = (id: string) => ships.cancelShipment(id, getState().user).catch(fail).then(shipDone(`${id} cancelled · stock released`));
export async function openShipDoc(id: string, kind: string) {
  const [s, parts] = await Promise.all([db.get('shipments', id), db.find('parts')]);
  if (!s) return;
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to open documents'); return; }
  w.document.write(ships.documentHtml(s, kind, new Map(parts.map(p => [p._id, p]))));
  w.document.close();
}

// ---------- Scrap cases ----------
export const openScrap = (id: string) => setState({ scrapId: id, scrapNew: null });
export const newScrap = (lotId?: string) => { setState({ scrapNew: { lotId }, scrapId: null }); threeEngine.hideRadial(); };
export const closeScrap = () => { setState({ scrapId: null, scrapNew: null }); if (getState().screen === 'store') threeEngine.showRadial(); };
const done = (msg: (c: { _id: string }) => string) => (c: { _id: string } | null) => { if (c) toast(msg(c)); return c; };
export async function tagScrap(lotId: string, qty: number, photos: string[], note: string) {
  const c = await scrap.tag({ lotId, qty, photos, note }, getState().user).catch(fail);
  if (!c) return;
  setState({ scrapNew: null, scrapId: c._id });
  if (getState().screen !== 'movements') go('movements');
  toast(`${c._id} tagged · ${qty} held · add the reason to send it for approval`);
}
export const scrapReason = (id: string, reason: string, detail: string) => scrap.submitReason(id, reason, detail, getState().user).catch(fail).then(done(c => `${c._id} sent for approval`));
export const scrapDecide = (id: string, d: 'approved' | 'rejected', note: string) => scrap.decide(id, d, getState().user, note).catch(fail)
  .then(done(c => `${c._id} ${d === 'rejected' ? 'rejected · units released' : 'approved'}`));
export const scrapMove = (id: string) => scrap.moveToYard(id, getState().user).catch(fail).then(done(c => `${c._id} · units in the scrap yard`));
export const scrapDispose = (id: string, disposal: string, vendor: string, pickupDate: string) => scrap.dispose(id, { disposal, vendor, pickupDate }, getState().user).catch(fail)
  .then(done(c => `${c._id} · disposal recorded · units left stock`));
export const scrapWriteOff = (id: string, certificate: string, certificateFile?: string) => scrap.writeOff(id, { certificate, certificateFile }, getState().user).catch(fail)
  .then(done(c => `${c._id} written off`));
export const scrapCancel = (id: string) => scrap.cancelCase(id, getState().user).catch(fail).then(done(c => `${c._id} withdrawn · units released`));
export const scrapPhotos = (id: string, photos: string[]) => scrap.addPhotos(id, photos, getState().user).catch(fail).then(done(() => 'Photo added'));

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
