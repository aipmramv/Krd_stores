import { useSyncExternalStore } from 'react';
import { FEATURED_BIN } from '../data/storeModel';
import type { Bin, ColorMode, ScreenId } from '../data/types';

export type Stage = 'map' | 'three' | 'page';
export type Overlay = null | { kind: 'palette'; q: string } | { kind: 'display'; top: number; right: number };

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
  /** Bumped on every edit so subscribers can cheaply detect changes. */
  rev: number;
}

export const MAP_SCREENS: ScreenId[] = ['network', 'routes', 'shipments'];
export const THREE_SCREENS: ScreenId[] = ['site', 'movements', 'store'];
export const stageFor = (s: ScreenId): Stage => (MAP_SCREENS.includes(s) ? 'map' : THREE_SCREENS.includes(s) ? 'three' : 'page');

function initialState(): AppState {
  const p = new URLSearchParams(location.search);
  const screen = (p.get('screen') as ScreenId) || 'network';
  const w = innerWidth, h = innerHeight;
  const portrait = h > w * 1.05 || w < 820;
  return {
    screen, stage: stageFor(screen), site: 'ktec', route: 0, ship: 0, mode: 'occupancy', t: 0, off: {},
    bin: { ...FEATURED_BIN }, bld: null, peel: true, dim: '3D', moveFrom: null,
    kiosk: p.get('mode') === 'kiosk', sheet: 'half', railOpen: !(portrait || w < 1180), drawerOpen: true,
    base: 'sat', toast: null, overlay: null, loading: false, rev: 0,
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
