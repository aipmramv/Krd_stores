// Shown wherever data follows the timeline: what date is shown and that actions apply to today.
import { asOfDate } from '../services/timeline';
import { goLive } from '../state/actions';
import { useApp } from '../state/store';

export const when = (d: Date) => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function TimeNotice({ what }: { what: string }) {
  const t = useApp(s => s.t);
  if (!t) return null;
  return (
    <div className={`timenote ${t < 0 ? 'replay' : 'forecast'}`} role="status">
      <span><b>{t < 0 ? 'Replay' : 'Forecast'} · {when(asOfDate(t))}</b>
        <small>{t < 0 ? `${what} as it was then. Actions are off while replaying.` : `${what} as expected then, from planned receipts, bookings and ETAs. Actions are off in a forecast.`}</small></span>
      <button className="btn" onClick={goLive}>Back to live</button>
    </div>
  );
}
