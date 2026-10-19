import { useSyncExternalStore } from 'react';
import { FEATURED_BIN } from '../data/storeModel';
import type { Bin, ColorMode, ScreenId } from '../data/types';

/** 'globe' is the Cesium map and site view; 'three' is the store interior; 'page' is a full-screen page. */
export type Stage = 'globe' | 'three' | 'page';
export type Overlay = null | { kind: 'palette'; q: string } | { kind: 'display'; top: number; right: number } | { kind: 'photo'; site: string; i: number };

export interface Photo { id: string; title: string; thumb: string; full: string; page: string; credit: string; licence: string; ll: [number, number] | null; source: 'Wikimedia Commons' | 'Mapillary' }
export type PhotoState = { status: 'loading' } | { status: 'ready'; items: Photo[] } | { status: 'error' };

export interface AppState {
  screen: ScreenId;
  /** Which surface is visible. */
  stage: Stage;
  site: string;
  route: number;
  ship: number;
  mode: ColorMode;
  /** Timeline offset in days from today (-30 replay … +28 forecast). */
  t: number;
  /** Layers switched off, per screen. */
  off: Partial<Record<ScreenId, Record<string, boolean>>>;
  bin: Bin;
  bld: string | null;
  peel: boolean;
  dim: '3D' | '2D';
  moveFrom: Bin | null;
  kiosk: boolean;
  sheet: 'peek' | 'half' | 'full';
  railOpen: boolean;
  drawerOpen: boolean;
  base: 'sat' | 'roads';
  toast: { msg: string; n: number } | null;
  overlay: Overlay;
  loading: boolean;
  /** Time of day in hours IST for the sun; null follows the live clock. */
  tod: number | null;
  /** Globe camera tilted into an oblique 3D view (false: looking straight down). */
  mapTilt: boolean;
  /** Cinematic auto-orbit in the 3D site. */
  tour: boolean;
  /** Show Google Photorealistic 3D Tiles when zoomed in (otherwise Cesium OSM Buildings). */
  photoreal: boolean;
  /** Cesium ion access token: imagery, terrain, buildings and photorealistic tiles all come through it. */
  cesiumToken: string;
  /** Status of the Cesium ion services, for messages and the Display menu. */
  ion: 'none' | 'loading' | 'ok' | 'error';
  photos: Record<string, PhotoState>;
  /** Bumped on every edit so subscribers can cheaply detect changes. */
  rev: number;
}

export const MAP_SCREENS: ScreenId[] = ['network', 'routes', 'shipments'];
export const SITE_SCREENS: ScreenId[] = ['site', 'movements'];
/** Screens drawn on the Cesium globe. */
export const GLOBE_SCREENS: ScreenId[] = [...MAP_SCREENS, ...SITE_SCREENS];
export const stageFor = (s: ScreenId): Stage => (GLOBE_SCREENS.includes(s) ? 'globe' : s === 'store' ? 'three' : 'page');

const TOKEN_STORE = 'ktec-twin.cesiumToken';
export function readStoredToken(): string {
  try { return localStorage.getItem(TOKEN_STORE) ?? ''; } catch { return ''; }
}
export function storeToken(t: string) {
  try { if (t) localStorage.setItem(TOKEN_STORE, t); else localStorage.removeItem(TOKEN_STORE); } catch { /* private mode */ }
}

function initialState(): AppState {
  const p = new URLSearchParams(location.search);
  const screen = (p.get('screen') as ScreenId) || 'network';
  const site = p.get('site') ?? '';
  const cesiumToken = readStoredToken() || (import.meta.env.VITE_CESIUM_ION_TOKEN ?? '');
  const w = innerWidth, h = innerHeight;
  const portrait = h > w * 1.05 || w < 820;
  return {
    screen, stage: stageFor(screen), site: ['ktec', 'isu', 'dhl', 'pnq'].includes(site) ? site : 'ktec', route: 0, ship: 0, mode: 'occupancy', t: 0, off: {},
    bin: { ...FEATURED_BIN }, bld: null, peel: true, dim: '3D', moveFrom: null,
    kiosk: p.get('mode') === 'kiosk', sheet: 'half', railOpen: !(portrait || w < 1180), drawerOpen: true,
    base: 'sat', toast: null, overlay: null, loading: false, rev: 0,
    tod: null, tour: false, mapTilt: false, photoreal: true, cesiumToken, ion: cesiumToken ? 'loading' : 'none',
    photos: {},
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
