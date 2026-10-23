// The app's single entry point to data. Picks the server when VITE_API_URL is set and the
// in-browser demo database otherwise, stamps documents, writes the audit log and tells
// subscribers which collection changed so views refresh.
import { ApiAdapter, DemoAdapter, type Adapter } from './adapters';
import type { Filter, FindOpts } from './filter';
import { COLLECTIONS, type Coll, type Collections } from './schema';

const API = import.meta.env.VITE_API_URL as string | undefined;

let actor = () => 'system';
/** Who is acting, for the audit log and the server's x-user header. */
export const setActor = (fn: () => string) => { actor = fn; };

const adapter: Adapter = API
  ? new ApiAdapter(API.replace(/\/$/, ''), () => ({ 'x-user': actor() }))
  : new DemoAdapter(() => import('./seed').then(m => m.seed()));

type Listener = (c: Coll) => void;
const listeners = new Set<Listener>();
export const onChange = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const changed = (c: Coll) => listeners.forEach(f => f(c));

/**
 * Short time-ordered id with a readable prefix, e.g. MR-26-K3F9Q2. A counter within the same
 * millisecond keeps ids from one browser unique; the server answers 409 on a clash between users.
 */
let lastMs = 0, seq = 0;
export function newId(prefix: string) {
  const yy = String(new Date().getFullYear()).slice(2), now = Date.now();
  seq = now === lastMs ? seq + 1 : Math.floor(Math.random() * 600);
  lastMs = now;
  return `${prefix}-${yy}-${now.toString(36).slice(-4).toUpperCase()}${(seq % 1296).toString(36).padStart(2, '0').toUpperCase()}`;
}

/** Sensor events and tracker readings are their own log; auditing them would flood the audit log. */
export const UNAUDITED: Coll[] = ['auditLog', 'events', 'trackers'];

async function audit(action: 'insert' | 'update' | 'remove', coll: Coll, docId: string, change?: Record<string, unknown>) {
  if (UNAUDITED.includes(coll)) return;
  const at = new Date().toISOString();
  // On the server the audit entry is written by the API itself.
  if (adapter.kind === 'api') return;
  await adapter.insert('auditLog', { _id: newId('AU'), at, user: actor(), action, coll, docId, change });
  changed('auditLog');
}

export type NewDoc<C extends Coll> = Omit<Collections[C], '_id' | 'createdAt' | 'updatedAt'> & { _id?: string };

adapter.subscribe?.(changed);

/** Record that someone looked at (or unblurred) footage: viewing is audited even though it changes nothing. */
export async function auditAccess(action: 'view' | 'unblur', coll: Coll, docId: string, change?: Record<string, unknown>) {
  await adapter.insert('auditLog', { _id: newId('AU'), at: new Date().toISOString(), user: actor(), action, coll, docId, change });
  changed('auditLog');
}

export const db = {
  get kind() { return adapter.kind; },
  /** The server's ingest endpoint, when there is one. */
  get ingest() { return adapter.ingest?.bind(adapter); },
  find<C extends Coll>(c: C, filter?: Filter, opts?: FindOpts) { return adapter.find(c, filter, opts); },
  get<C extends Coll>(c: C, id: string) { return adapter.get(c, id); },
  async insert<C extends Coll>(c: C, doc: NewDoc<C>, prefix = c.slice(0, 2).toUpperCase()) {
    const now = new Date().toISOString();
    const full = { ...doc, _id: doc._id ?? newId(prefix), createdAt: now, updatedAt: now } as Collections[C];
    const out = await adapter.insert(c, full);
    await audit('insert', c, out._id, doc as Record<string, unknown>);
    changed(c);
    return out;
  },
  async update<C extends Coll>(c: C, id: string, set: Partial<Collections[C]>) {
    const out = await adapter.update(c, id, { ...set, updatedAt: new Date().toISOString() });
    await audit('update', c, id, set as Record<string, unknown>);
    changed(c);
    return out;
  },
  async remove(c: Coll, id: string) {
    await adapter.remove(c, id);
    await audit('remove', c, id);
    changed(c);
  },
  async reset() {
    await adapter.reset();
    COLLECTIONS.forEach(changed);
  },
};
