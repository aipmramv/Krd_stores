import type { ReactNode } from 'react';
import { toggleDrawer } from '../../state/actions';

/** Header, scrolling body and sticky action footer shared by every drawer screen. */
export function DrawerFrame({ title, foot, children }: { title: string; foot?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="hd"><span className="eb ink">{title}</span><button className="x" onClick={toggleDrawer} aria-label="Close details">›</button></div>
      <div className="scroll">{children}</div>
      {foot && <div className="foot">{foot}</div>}
    </>
  );
}
