import { useSyncExternalStore } from 'react';
import { FEATURED_BIN } from '../data/storeModel';
import type { Bin, ColorMode, ScreenId } from '../data/types';

export type Stage = 'map' | 'three' | 'page';
export type Overlay = null | { kind: 'palette'; q: string } | { kind: 'display'; top: number; right: number } | { kind: 'user'; top: number; right: number } | { kind: 'photo'; site: string; i: number };

export interface Photo { id: string; title: string; thumb: string; full: string; page: string; credit: string; licence: string; ll: [number, number] | null; source: 'Wikimedia Commons' | 'Mapillary' }
export type PhotoState = { status: 'loading' } | { status: 'ready'; items: Photo[] } | { status: 'error' };
export interface SiteStats { buildings: number; trees: number; roads: number; source: 'osm' | 'stylised'; imagery: 'loading' | 'ok' | 'unavailable'; modelled?: string[] }

export interface AppState {
  screen: ScreenId;
  /** Which surface is visible. Normally follows the screen, but stays on the map while flying into a site. */
  stage: Stage;
  site: string;
  /** Shipment selected in the tracker (a shipments document id); null selects the first. */
  ship: string | null;
  /** Shipment being planned in the route planner, its quoted options and the last booking made. */
  plan: { from: string; to: string; lines: { partNo: string; qty: number }[]; option: string | null };
  planOptions: { id: string; mode: string; eta: string; cost: number; kind: 'road' | 'air' | 'rail' | 'courier'; tag?: string; allowed: boolean }[];
  booked: string | null;
  mode: ColorMode;
  /** Timeline offset in days from today (-30 replay … +28 forecast). */
  t: number;
  /** Layers switched off, per screen. */
  off: Partial<Record<ScreenId, Record<string, boolean>>>;
  bin: Bin;
  bld: string | null;
  /** Signed-in user (a `users` document id). In the demo anyone can switch user. */
  user: string;
  peel: boolean;
  /** Opened floor of the primary building, as an index into its `floors`; null shows the whole tower. */
  floor: number | null;
  /** Inside the opened floor at eye level rather than looking into it from above. */
  walk: boolean;
  dim: '3D' | '2D';
  /** A move request being drawn in the store twin: from a bin, to a bin once chosen. */
  moveDraft: { from: Bin; to: Bin | null } | null;
  /** Open scrap case in Moves & scrap, or a new one being tagged (optionally from a lot). */
  scrapId: string | null;
  scrapNew: { lotId?: string } | null;
  /** Task open on the selected bin in the store twin. */
  binTask: 'pick' | 'putaway' | 'count' | 'reserve' | 'history' | null;
  /** Page open in Reports & masters, and a filter to open it with (from search). */
  reportPage: string;
  reportQuery: string;
  kiosk: boolean;
  sheet: 'peek' | 'half' | 'full';
  railOpen: boolean;
  drawerOpen: boolean;
  toast: { msg: string; n: number } | null;
  overlay: Overlay;
  loading: boolean;
  /** Time of day in hours IST for the sun; null follows the live clock. */
  tod: number | null;
  /** Map cross-fade during the map ↔ 3D handoff. */
  fade: 'in' | 'out' | null;
  /** Cinematic auto-orbit in the 3D site. */
  tour: boolean;
  photos: Record<string, PhotoState>;
  siteStats: Record<string, SiteStats>;
  /** Bumped on every edit so subscribers can cheaply detect changes. */
  rev: number;
}

export const MAP_SCREENS: ScreenId[] = ['network', 'routes', 'shipments'];
export const THREE_SCREENS: ScreenId[] = ['site', 'movements', 'store'];
export const stageFor = (s: ScreenId): Stage => (MAP_SCREENS.includes(s) ? 'map' : THREE_SCREENS.includes(s) ? 'three' : 'page');

/** The demo remembers who you last acted as, in this browser only. */
export const USER_KEY = 'ktec-twin:user';
function savedUser() { try { return localStorage.getItem(USER_KEY); } catch { return null; } }

function initialState(): AppState {
  const p = new URLSearchParams(location.search);
  const screen = (p.get('screen') as ScreenId) || 'network';
  const site = p.get('site') ?? '';
  const w = innerWidth, h = innerHeight;
  const portrait = h > w * 1.05 || w < 820;
  return {
    screen, stage: stageFor(screen), site: ['ktec', 'isu', 'dhl', 'pnq'].includes(site) ? site : 'ktec', ship: null, plan: { from: 'ktec', to: 'pnq', lines: [{ partNo: 'KM-DX-ACT-220', qty: 6 }], option: null }, planOptions: [], booked: null, mode: 'occupancy', t: 0, off: {},
    bin: { ...FEATURED_BIN }, bld: null, user: p.get('user') ?? savedUser() ?? 'rv', peel: true, floor: null, walk: false, dim: '3D', moveDraft: null, scrapId: null, scrapNew: null, binTask: null, reportPage: 'Parts', reportQuery: '',
    kiosk: p.get('mode') === 'kiosk', sheet: 'half', railOpen: !(portrait || w < 1180), drawerOpen: true,
    toast: null, overlay: null, loading: false, rev: 0,
    tod: null, fade: null, tour: false,
    photos: {}, siteStats: {},
  };
}

let state = initialState();
const subs = new Set<() => void>();

export const getState = () => state;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p, rev: state.rev + 1 };
  subs.forEach(f => f());
}
export function subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }

export function useApp<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

export const isOn = (s: AppState, scr: ScreenId, id: string) => !s.off[scr]?.[id];
