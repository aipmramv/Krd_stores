import logo from '../assets/kone-logo-primary.png';
import { MODULES } from '../data/sample';
import { go, openDisplayMenu, openPalette, toast } from '../state/actions';
import { useApp } from '../state/store';

export function ModuleTabs({ dock }: { dock?: boolean }) {
  const screen = useApp(s => s.screen);
  return (
    <nav className={dock ? 'dock' : 'tabs'} id={dock ? 'dock' : 'tabs'} aria-label="Modules">
      {MODULES.map(([id, label]) => (
        <button key={id} className={dock ? (id === screen ? 'on' : '') : `tab ${id === screen ? 'on' : ''}`} onClick={() => go(id)}>{label}</button>
      ))}
    </nav>
  );
}

export function TopBar() {
  const kiosk = useApp(s => s.kiosk);
  return (
    <header className="bar">
      <div className="brand"><img src={logo} alt="KONE" /><span className="div" /><span className="product">KTEC Materials Twin</span></div>
      <ModuleTabs />
      <div className="grow" />
      <button className="search" aria-label="Search" onClick={() => openPalette()}><span>Search part, serial, PO, AWB, project</span><kbd>Ctrl K</kbd></button>
      <button className="pill" onClick={e => openDisplayMenu(e.currentTarget.getBoundingClientRect())}>
        <span className="k">Display</span><b>{kiosk ? 'Kiosk touch' : 'Standard'}</b>
      </button>
      <div className="pill role"><span className="k">Role</span><b>Logistics coordinator</b></div>
      <button className="sq" aria-label="7 alerts" onClick={() => toast('7 alerts · 4 at KTEC Chennai, 2 in transit, 1 at Bhiwandi')}>7<span className="dot" /></button>
      <div className="avatar">RV</div>
    </header>
  );
}
