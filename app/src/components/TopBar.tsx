import logo from '../assets/kone-logo-primary.png';
import { MODULES } from '../data/sample';
import { useDoc, useQuery } from '../db/hooks';
import { ROLE_LABEL } from '../db/schema';
import { go, openDisplayMenu, openPalette, openUserMenu, toast } from '../state/actions';
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
  const kiosk = useApp(s => s.kiosk), me = useDoc('users', useApp(s => s.user)).data;
  const alerts = useQuery('alerts', { status: 'open' }).data;
  return (
    <header className="bar">
      <div className="brand"><img src={logo} alt="KONE" /><span className="div" /><span className="product">KTEC Materials Twin</span></div>
      <ModuleTabs />
      <div className="grow" />
      <button className="search" aria-label="Search" onClick={() => openPalette()}><span>Search part, serial, PO, AWB, project</span><kbd>Ctrl K</kbd></button>
      <button className="pill" onClick={e => openDisplayMenu(e.currentTarget.getBoundingClientRect())}>
        <span className="k">Display</span><b>{kiosk ? 'Kiosk touch' : 'Standard'}</b>
      </button>
      <button className="pill role" onClick={e => openUserMenu(e.currentTarget.getBoundingClientRect())} aria-haspopup="menu">
        <span className="k">Role</span><b>{me ? ROLE_LABEL[me.role] : '…'}</b>
      </button>
      <button className="sq" aria-label={`${alerts.length} open alerts`}
        onClick={() => toast(alerts.length ? `${alerts.length} open alerts · ${alerts.filter(a => a.severity === 'high').length} high` : 'No open alerts')}>
        {alerts.length}{alerts.some(a => a.severity === 'high') && <span className="dot" />}
      </button>
      <div className="avatar" title={me?.name}>{me?.initials ?? '··'}</div>
    </header>
  );
}
