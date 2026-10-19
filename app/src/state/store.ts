import { useSyncExternalStore } from 'react';
import { FEATURED_BIN } from '../data/storeModel';
import type { Bin, ColorMode, ScreenId } from '../data/types';

export type Stage = 'map' | 'three' | 'page';
export type Overlay = null | { kind: 'palette'; q: string } | { kind: 'display'; top: number; right: number } | { kind: 'photo'; site: string; i: number };

export interface Photo { id: string; title: string; thumb: string; full: string; page: string; credit: string; licence: string; ll: [number, number] | null; source: 'Wikimedia Commons' | 'Mapillary' | 'Google Places' | 'Google Street View' }
export type PhotoState = { status: 'loading' } | { status: 'ready'; items: Photo[] } | { status: 'error' };
export interface SiteStats { buildings: number; trees: number; roads: number; source: 'osm' | 'stylised'; imagery: 'loading' | 'ok' | 'unavailable' }

export interface AppState {
  screen: ScreenId;
  /** Which surface is visible. Normally follows the screen, but stays on the map while flying into a site. */
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
  base: 'sat' | 'osm';
  toast: { msg: string; n: number } | null;
  overlay: Overlay;
  loading: boolean;
  /** Time of day in hours IST for the sun; null follows the live clock. */
  tod: number | null;
  /** Map cross-fade during the map ↔ 3D handoff. */
  fade: 'in' | 'out' | null;
  /** Cinematic auto-orbit in the 3D site. */
  tour: boolean;
  /** Render the site from Google Photorealistic 3D Tiles (needs a key). */
  photoreal: boolean;
  googleKey: string;
  /** Cesium ion access token: Google Photorealistic 3D Tiles through Cesium, no Google billing needed. */
  cesiumToken: string;
  photos: Record<string, PhotoState>;
  siteStats: Record<string, SiteStats>;
  /** Bumped on every edit so subscribers can cheaply detect changes. */
  rev: number;
}

export const MAP_SCREENS: ScreenId[] = ['network', 'routes', 'shipments'];
export const THREE_SCREENS: ScreenId[] = ['site', 'movements', 'store'];
export const stageFor = (s: ScreenId): Stage => (MAP_SCREENS.includes(s) ? 'map' : THREE_SCREENS.includes(s) ? 'three' : 'page');

const KEY_STORE = { google: 'ktec-twin.googleKey', cesium: 'ktec-twin.cesiumToken' };
type KeyName = keyof typeof KEY_STORE;
export function readStoredKey(name: KeyName = 'google'): string {
  try { return localStorage.getItem(KEY_STORE[name]) ?? ''; } catch { return ''; }
}
export function storeKey(k: string, name: KeyName = 'google') {
  try { if (k) localStorage.setItem(KEY_STORE[name], k); else localStorage.removeItem(KEY_STORE[name]); } catch { /* private mode */ }
}

/** Where photorealistic tiles come from: Cesium ion first (works without Google billing), else a Google key. */
export type TileSource = { kind: 'ion'; token: string } | { kind: 'google'; key: string };
export const tileSource = (s: AppState): TileSource | null =>
  s.cesiumToken ? { kind: 'ion', token: s.cesiumToken } : s.googleKey ? { kind: 'google', key: s.googleKey } : null;

function initialState(): AppState {
  const p = new URLSearchParams(location.search);
  const screen = (p.get('screen') as ScreenId) || 'network';
  const site = p.get('site') ?? '';
  const googleKey = readStoredKey() || (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? '');
  const cesiumToken = readStoredKey('cesium') || (import.meta.env.VITE_CESIUM_ION_TOKEN ?? '');
  const w = innerWidth, h = innerHeight;
  const portrait = h > w * 1.05 || w < 820;
  return {
    screen, stage: stageFor(screen), site: ['ktec', 'isu', 'dhl', 'pnq'].includes(site) ? site : 'ktec', route: 0, ship: 0, mode: 'occupancy', t: 0, off: {},
    bin: { ...FEATURED_BIN }, bld: null, peel: true, dim: '3D', moveFrom: null,
    kiosk: p.get('mode') === 'kiosk', sheet: 'half', railOpen: !(portrait || w < 1180), drawerOpen: true,
    base: 'sat', toast: null, overlay: null, loading: false, rev: 0,
    tod: null, fade: null, tour: false, photoreal: !!(googleKey || cesiumToken), googleKey, cesiumToken,
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
