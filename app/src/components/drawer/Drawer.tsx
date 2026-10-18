// Details drawer (right panel in landscape, bottom sheet in portrait). Content follows the screen.
import type { ComponentType } from 'react';
import type { ScreenId } from '../../data/types';
import { cycleSheet, toggleDrawer } from '../../state/actions';
import { useApp } from '../../state/store';
import { DrawerFrame } from './Frame';
import { MovementsDrawer, NetworkDrawer, RoutesDrawer, ShipmentsDrawer, SiteDrawer, StoreDrawer } from './screens';

const CONTENT: Partial<Record<ScreenId, ComponentType>> = {
  network: NetworkDrawer, routes: RoutesDrawer, shipments: ShipmentsDrawer, site: SiteDrawer, store: StoreDrawer, movements: MovementsDrawer,
};

export function Drawer({ hidden }: { hidden: boolean }) {
  const screen = useApp(s => s.screen);
  const Content = CONTENT[screen];
  return (
    <>
      <button className={`btn drawer-open${hidden ? ' hidden' : ''}`} onClick={toggleDrawer}>Details</button>
      <aside className={`panel drawer${hidden ? ' hidden' : ''}`} id="drawer" aria-label="Details and actions">
        <button className="handle" onClick={cycleSheet} aria-label="Resize panel" />
        {Content ? <Content key={screen} /> : <DrawerFrame title="Details" />}
      </aside>
    </>
  );
}
