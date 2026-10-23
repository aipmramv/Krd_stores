// Rules engine: turns one sensor event into an outcome, using the records around it.
//   matched  the event confirms a recorded movement (it becomes evidence on that movement)
//   alert    something happened that the records do not explain, or a safety or access rule broke
//   logged   worth keeping in the log, nothing to do
//   ignored  below the thresholds
// Pure: no database access, so the browser simulator, the API's ingest endpoint and the tests all
// run the same rules. Thresholds are in RULES so they can move to a master later.
import type { Alert, Camera, Movement, RuleId, SensorEvent, Severity, Shipment, StockLot, User } from '../db/schema';

export const RULES = {
  /** A camera-seen take or put matches a record within this window. */
  matchMin: 15,
  /** Store hours, IST; motion outside them is after-hours. Sundays are closed. */
  openHour: 7, closeHour: 21,
  /** Who may enter restricted areas without an open task there. */
  areaRoles: { Hazmat: ['ehs', 'storeManager', 'admin'], Quarantine: ['storeManager', 'admin', 'engineer'], 'Scrap yard': ['storeManager', 'admin', 'ehs'] } as Record<string, string[]>,
  forkliftKmh: 8, aisleBlockedMin: 5, hazmatMaxC: 30,
  /** Camera detections below this confidence are logged, never alerted. */
  minConf: .6,
  /** Footage is kept this long unless it is evidence (held). */
  retentionDays: 30,
};

/** The event after the retention policy: clips past the period are deleted unless held as evidence. */
export function retain(ev: SensorEvent, now = Date.now()): SensorEvent {
  if (!ev.clip || ev.clip.held || now - Date.parse(ev.at) <= RULES.retentionDays * 86400000) return ev;
  return { ...ev, clip: null };
}

export interface Context {
  movements: Movement[]; users: User[]; shipments: Shipment[]; cameras?: Camera[];
  /** Recent events at the same site (scans that confirm a take, for instance). */
  events?: SensorEvent[];
  /** Stock lots of the site, for scans (is this lot where the system says?). */
  lots?: StockLot[];
}
export interface Outcome {
  outcome: NonNullable<SensorEvent['outcome']>; note: string;
  /** Movement or shipment the event confirms. */
  matched?: string;
  alert?: Pick<Alert, 'title' | 'detail' | 'severity' | 'rule'>;
}

const ts = (iso?: string | null) => (iso ? Date.parse(iso) : 0);
const code = (loc?: string) => loc?.split(':').pop() ?? '—';
const hhmm = (iso: string) => new Date(ts(iso) + 5.5 * 3600000).toISOString().slice(11, 16);
const alert = (rule: RuleId, severity: Severity, title: string, detail: string, note = title): Outcome => ({ outcome: 'alert', note, alert: { rule, severity, title, detail } });
const camName = (ev: SensorEvent, ctx: Context) => ctx.cameras?.find(c => c._id === ev.camera)?.code ?? ev.camera ?? 'A camera';
const who = (id: string | undefined, ctx: Context) => ctx.users.find(u => u._id === id);
const areaKind = (loc?: string) => (/Hazmat/.test(loc ?? '') ? 'Hazmat' : /Quarantine/.test(loc ?? '') ? 'Quarantine' : /Scrap yard|Yard/.test(loc ?? '') ? 'Scrap yard' : null);

/** Is this IST moment inside store hours? */
export function inHours(iso: string) {
  const d = new Date(ts(iso) + 5.5 * 3600000), h = d.getUTCHours() + d.getUTCMinutes() / 60;
  return d.getUTCDay() !== 0 && h >= RULES.openHour && h < RULES.closeHour;
}

/** A recorded movement at this place that explains a take (from) or a put (to) at this time. */
export function explaining(ev: SensorEvent, side: 'from' | 'to', ctx: Context): Movement | undefined {
  const t = ts(ev.at), win = RULES.matchMin * 60000;
  const types: Movement['type'][] = side === 'from' ? ['pick', 'move', 'issue', 'transfer', 'count'] : ['putaway', 'move', 'transfer'];
  const near = (m: Movement) =>
    (m.status === 'done' && Math.abs(ts(m.updatedAt) - t) <= win) ||
    // Work in progress on the board: started before (or just after) the camera saw it.
    (!!m.startedAt && m.status !== 'done' && ts(m.startedAt) <= t + win);
  return ctx.movements
    .filter(m => m[side] === ev.loc && types.includes(m.type) && near(m))
    .sort((a, b) => Math.abs(ts(a.updatedAt) - t) - Math.abs(ts(b.updatedAt) - t))[0];
}

export function evaluate(ev: SensorEvent, ctx: Context): Outcome {
  const conf = ev.conf ?? 1, cam = camName(ev, ctx);
  if (ev.source === 'cctv' && conf < RULES.minConf) return { outcome: 'logged', note: `Low-confidence detection (${Math.round(conf * 100)}%) · kept in the log` };
  switch (ev.kind) {
    case 'bin_take':
    case 'bin_put': {
      const side = ev.kind === 'bin_take' ? 'from' : 'to';
      const m = explaining(ev, side, ctx);
      if (m) return { outcome: 'matched', matched: m._id, note: `Matches ${m._id} · ${m.type} ${m.qty} × ${m.partNo}` };
      const scan = ctx.events?.find(e => e.kind === 'scan' && e.loc === ev.loc && Math.abs(ts(e.at) - ts(ev.at)) <= RULES.matchMin * 60000);
      if (scan) return { outcome: 'matched', matched: scan._id, note: `Confirmed by scan ${scan._id}` };
      const qty = ev.qty ? `about ${ev.qty} unit${ev.qty > 1 ? 's' : ''}` : 'stock';
      return ev.kind === 'bin_take'
        ? alert('unrecorded', 'high', `Unrecorded removal from ${code(ev.loc)}`, `${cam} saw ${qty} taken at ${hhmm(ev.at)} with no pick, move or scan. Count the bin and check the clip.`)
        : alert('unrecorded', 'medium', `Unrecorded put-away into ${code(ev.loc)}`, `${cam} saw ${qty} put in at ${hhmm(ev.at)} with no put-away or move recorded.`);
    }
    case 'zone_entry': {
      const area = areaKind(ev.loc);
      if (!area) return { outcome: 'logged', note: `Entry to ${code(ev.loc)}` };
      const u = who(ev.person, ctx);
      if (!u) return alert('zone', 'high', `Unbadged person in the ${area.toLowerCase()} area`, `${cam} saw someone enter ${code(ev.loc)} at ${hhmm(ev.at)} without a badge.`);
      const task = ctx.movements.find(m => (m.to === ev.loc || m.from === ev.loc) && m.status !== 'done' && (m.assignee === u._id || m.requestedBy === u._id) && ['requested', 'approved'].includes(m.status));
      if (RULES.areaRoles[area]?.includes(u.role) || task) return { outcome: 'logged', note: `${u.name} entered ${code(ev.loc)}${task ? ` for ${task._id}` : ''} · authorised` };
      return alert('zone', 'medium', `${u.name} entered the ${area.toLowerCase()} area`, `${u.name} is not authorised for ${code(ev.loc)} and has no open task there (${hhmm(ev.at)}).`);
    }
    case 'motion':
      return inHours(ev.at) ? { outcome: 'ignored', note: 'Motion in store hours' }
        : alert('after_hours', 'high', `Motion after hours · ${code(ev.loc)}`, `${cam} saw movement at ${hhmm(ev.at)}, outside store hours.`);
    case 'no_esd_coat':
      return alert('ppe', 'medium', 'No ESD coat in the ESD area', `${cam} saw a person without an ESD coat near ${code(ev.loc)} at ${hhmm(ev.at)}${who(ev.person, ctx) ? ` (${who(ev.person, ctx)!.name})` : ''}.`);
    case 'forklift_speed': {
      const v = ev.value ?? 0;
      if (v <= RULES.forkliftKmh) return { outcome: 'ignored', note: `Forklift at ${v} km/h` };
      return alert('forklift', ev.qty ? 'high' : 'medium', `Forklift at ${v} km/h${ev.qty ? ' near people' : ''}`, `${ev.tag ?? 'A forklift'} ran at ${v} km/h (limit ${RULES.forkliftKmh}) in ${code(ev.loc)}${ev.qty ? ` with ${ev.qty} pedestrian${ev.qty > 1 ? 's' : ''} nearby` : ''}.`);
    }
    case 'aisle_blocked':
      return (ev.value ?? 0) < RULES.aisleBlockedMin ? { outcome: 'ignored', note: 'Short stop in the aisle' }
        : alert('aisle', 'medium', `Aisle blocked · ${code(ev.loc)}`, `${cam} has seen an object in the aisle for ${ev.value} minutes.`);
    case 'smoke':
      return alert('smoke', 'high', `Smoke detected · ${code(ev.loc)}`, `${cam} detected smoke at ${hhmm(ev.at)}. Check the area and follow the fire procedure.`);
    case 'temperature':
      return (ev.value ?? 0) <= RULES.hazmatMaxC ? { outcome: 'ignored', note: `${ev.value} °C` }
        : alert('temperature', 'high', `Hazmat store at ${ev.value} °C`, `${ev.device ?? 'The sensor'} in ${code(ev.loc)} reads ${ev.value} °C (limit ${RULES.hazmatMaxC} °C). Li-ion stock is at risk.`);
    case 'vehicle_arrived': {
      const t = ts(ev.at);
      const s = ctx.shipments.find(x => !['Delivered', 'Cancelled'].includes(x.status) && (!ev.carrier || x.carrier === ev.carrier) &&
        ((x.to === ev.site && Math.abs(ts(x.etaAt) - t) < 1.5 * 86400000) || (x.from === ev.site && Math.abs(ts(x.pickupAt) - t) < 86400000)));
      if (s) return { outcome: 'matched', matched: s._id, note: `${ev.carrier ?? 'Vehicle'} ${ev.plate ?? ''} · ${s.to === ev.site ? 'delivery' : 'pick-up'} for ${s._id}`.replace(/\s+/g, ' ') };
      return alert('dock_vehicle', 'medium', `Unexpected vehicle at the dock`, `${ev.carrier ?? 'A vehicle'} ${ev.plate ?? ''} arrived at ${hhmm(ev.at)} with no delivery or pick-up due now.`.replace(/\s+/g, ' '));
    }
    case 'boxes_counted': {
      const s = ctx.shipments.find(x => x._id === ev.ref);
      if (!s) return { outcome: 'logged', note: `${ev.qty} boxes counted` };
      const expected = s.items.reduce((n, i) => n + i.qty, 0);
      if (ev.qty === expected) return { outcome: 'matched', matched: s._id, note: `${ev.qty} of ${expected} boxes · matches ${s._id}` };
      return alert('dock_count', 'high', `${(ev.qty ?? 0) < expected ? 'Short' : 'Over'} delivery · ${s._id}`, `The dock camera counted ${ev.qty} boxes; ${s._id} lists ${expected}. Check before signing the POD.`);
    }
    case 'scan': {
      const lotId = /^KONE:LOT:(.+)$/.exec(ev.code ?? '')?.[1];
      const binLoc = /^KONE:BIN:(.+)$/.exec(ev.code ?? '')?.[1] ?? ev.loc;
      // A lot scan confirms the task for that lot; a bin scan the task at that bin.
      const task = ctx.movements.find(m => m.startedAt && m.status !== 'done' && (!ev.person || m.assignee === ev.person) && (lotId ? m.lotId === lotId : m.from === binLoc || m.to === binLoc));
      if (task) return { outcome: 'matched', matched: task._id, note: `Scan confirms ${task._id} at ${code(binLoc)}` };
      const lot = lotId ? ctx.lots?.find(l => l._id === lotId) : undefined;
      if (lot && ev.loc && lot.locationId !== ev.loc)
        return alert('wrong_bin', 'medium', `Lot ${lot.lot} found in the wrong bin`, `Scanned in ${code(ev.loc)}; the system has it in ${code(lot.locationId)}. Move it back or record a move.`);
      return { outcome: 'logged', note: `Scanned ${lotId ? `lot ${lotId}` : code(binLoc)}` };
    }
    case 'tag_exit': {
      const m = ctx.movements.find(x => x.partNo === ev.ref && ['issue', 'transfer', 'pick'].includes(x.type) && Math.abs(ts(x.updatedAt) - ts(ev.at)) < 3600000);
      if (m) return { outcome: 'matched', matched: m._id, note: `Leaving for ${m._id}` };
      const s = ctx.shipments.find(x => x.from === ev.site && x.items.some(i => i.partNo === ev.ref) && Math.abs(ts(x.pickupAt) - ts(ev.at)) < 6 * 3600000);
      if (s) return { outcome: 'matched', matched: s._id, note: `Leaving on ${s._id}` };
      return alert('asset_exit', 'high', `Tagged asset left the store`, `${ev.tag ?? 'A tag'} (${ev.ref ?? 'asset'}) passed the door gate at ${hhmm(ev.at)} with no issue, transfer or shipment.`);
    }
  }
  return { outcome: 'logged', note: ev.kind };
}

/** What each rule is for, for the rules list and alert filters. */
export const RULE_LABEL: Record<RuleId, string> = {
  unrecorded: 'Unrecorded movement', zone: 'Restricted area', after_hours: 'After hours', ppe: 'ESD and PPE', forklift: 'Forklift speed',
  aisle: 'Blocked aisle', smoke: 'Smoke', dock_vehicle: 'Dock vehicle', dock_count: 'Dock box count', wrong_bin: 'Wrong bin', asset_exit: 'Asset exit', temperature: 'Temperature',
};
