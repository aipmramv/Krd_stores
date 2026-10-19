// Responsive layout: classes on <html> drive the CSS scale and panel arrangement
// from a 13 in laptop up to a 40 in kiosk, in landscape and portrait.
import { useLayoutEffect } from 'react';
import { globe } from './globe/globe';
import { useApp } from './state/store';

export function useLayout() {
  const kiosk = useApp(s => s.kiosk), sheet = useApp(s => s.sheet);
  const railOpen = useApp(s => s.railOpen), drawerOpen = useApp(s => s.drawerOpen);

  useLayoutEffect(() => {
    const H = document.documentElement;
    let t: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const w = innerWidth, h = innerHeight;
      const portrait = h > w * 1.05 || w < 820;
      H.classList.toggle('portrait', portrait);
      H.classList.toggle('narrow', !portrait && w < 1500);
      H.classList.toggle('kiosk', kiosk);
      H.classList.toggle('docked', kiosk || portrait || w < 1150);
      H.classList.toggle('sheet-peek', portrait && sheet === 'peek');
      H.classList.toggle('sheet-full', portrait && sheet === 'full');
      H.classList.toggle('rail-closed', !railOpen);
      H.classList.toggle('drawer-closed', !drawerOpen);
      // Panels animate for .24s; let the globe re-measure once they settle.
      clearTimeout(t);
      t = setTimeout(() => globe.resize(), 260);
    };
    apply();
    addEventListener('resize', apply);
    return () => { removeEventListener('resize', apply); clearTimeout(t); };
  }, [kiosk, sheet, railOpen, drawerOpen]);
}
