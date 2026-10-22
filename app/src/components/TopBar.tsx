import logo from '../assets/kone-logo-primary.png';
import { MODULES } from '../data/sample';
import { useDoc } from '../db/hooks';
import { useInbox } from './Inbox';
import { ROLE_LABEL } from '../db/schema';
import { go, openAlerts, openDisplayMenu, openPalette, openUserMenu } from '../state/actions';
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
  const { tasks, open } = useInbox();
  const n = tasks.length + open.length, urgent = tasks.some(x => x.urgent) || open.some(a => a.severity === 'high');
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
      <button className="sq" aria-label={`${tasks.length} tasks waiting for you and ${open.length} open alerts`} aria-haspopup="dialog"
        onClick={e => openAlerts(e.currentTarget.getBoundingClientRect())}>
        {n}{urgent && <span className="dot" />}
      </button>
      <div className="avatar" title={me?.name}>{me?.initials ?? '··'}</div>
    </header>
  );
}
