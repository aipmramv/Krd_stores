// The alerts centre behind the bell: what is waiting for you (worked out from the data for your
// role) and the site alerts, which can be acknowledged or closed.
import { useMemo, useState } from 'react';
import { SITE_BY_ID } from '../data/sites';
import { useDoc, useQuery } from '../db/hooks';
import { tasksFor } from '../services/inbox';
import { goTo, openEventClip, openTask, setAlertStatus } from '../state/actions';
import { useApp } from '../state/store';

export function useInbox() {
  const me = useDoc('users', useApp(s => s.user)).data;
  const movements = useQuery('movements', { status: { $in: ['requested', 'approved'] } }).data;
  const scrapCases = useQuery('scrapCases', { step: { $ne: 'closed' } }).data;
  const shipments = useQuery('shipments', { status: { $in: ['Awaiting EHS approval', 'E-way bill hold', 'Delay risk'] } }).data;
  const alerts = useQuery('alerts', { status: { $in: ['open', 'ack'] } }, { sort: { at: -1 } }).data;
  const tasks = useMemo(() => tasksFor(me, { movements, scrapCases, shipments }), [me, movements, scrapCases, shipments]);
  return { me, tasks, alerts, open: alerts.filter(a => a.status === 'open') };
}

const SEV = { high: '#C8312B', medium: '#C77700', info: '#1450F5' } as const;

export function AlertsPanel({ top, right }: { top: number; right: number }) {
  const { me, tasks, alerts } = useInbox();
  const [all, setAll] = useState(false);
  const shown = alerts.filter(a => all || a.status === 'open');
  return (
    <div className="menu inbox" style={{ top, right }} role="dialog" aria-label="Alerts and tasks">
      <span className="eb">Waiting for you · {tasks.length}</span>
      {tasks.length ? tasks.map(t => (
        <button key={t.kind + t.id} className="task" onClick={() => void openTask(t)}>
          <span className="dot" style={{ background: t.urgent ? '#C8312B' : '#1450F5' }} />
          <span><b>{t.title}</b><small>{SITE_BY_ID[t.site]?.short} · {t.detail}</small></span><span aria-hidden>›</span>
        </button>
      )) : <p className="note" style={{ padding: '.25rem 1rem .75rem' }}>Nothing is waiting for {me?.name ?? 'you'}.</p>}
      <span className="eb" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Site alerts · {alerts.filter(a => a.status === 'open').length} open</span>
        <button className="link" onClick={() => setAll(!all)}>{all ? 'Open only' : 'Include acknowledged'}</button>
      </span>
      {shown.length ? shown.map(a => (
        <div key={a._id} className="task alert">
          <span className="dot" style={{ background: SEV[a.severity] }} />
          <span><b>{a.title}</b><small>{SITE_BY_ID[a.site]?.short} · {a.detail}{a.status === 'ack' ? ' · acknowledged' : ''}</small>
            <span className="acts">
              {a.eventId ? <button className="btn" onClick={() => void openEventClip(a.eventId!)}>▶ Clip</button> : <button className="btn" onClick={() => goTo(a.site, 'site')}>View site</button>}
              {a.status === 'open' && <button className="btn" onClick={() => void setAlertStatus(a._id, 'ack')}>Acknowledge</button>}
              <button className="btn" onClick={() => void setAlertStatus(a._id, 'closed')}>Close</button>
            </span>
          </span>
        </div>
      )) : <p className="note" style={{ padding: '.25rem 1rem .75rem' }}>No open alerts.</p>}
    </div>
  );
}
