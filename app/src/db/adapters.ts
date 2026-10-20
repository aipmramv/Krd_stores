// Two interchangeable back-ends behind one interface:
// - demo: documents live in this browser (localStorage), seeded from the sample data; used on
//   GitHub Pages so every action works without a server
// - api:  the Node server in /server, which stores them in MongoDB or Azure Cosmos DB (MongoDB API)
import { applyOpts, matches, type Filter, type FindOpts } from './filter';
import { COLLECTIONS, type Coll, type Collections } from './schema';

export interface Adapter {
  readonly kind: 'demo' | 'api';
  find<C extends Coll>(c: C, filter?: Filter, opts?: FindOpts): Promise<Collections[C][]>;
  get<C extends Coll>(c: C, id: string): Promise<Collections[C] | null>;
  insert<C extends Coll>(c: C, doc: Collections[C]): Promise<Collections[C]>;
  update<C extends Coll>(c: C, id: string, set: Partial<Collections[C]>): Promise<Collections[C]>;
  remove(c: Coll, id: string): Promise<void>;
  /** Back to the seed data. */
  reset(): Promise<void>;
}

// ---------- demo: in this browser ----------
/** Bump when the seed or the document shapes change, so old demo data is replaced. */
export const DEMO_VERSION = 4;
const KEY = (c: Coll) => `ktec-twin:v${DEMO_VERSION}:${c}`;

function storage(): Storage | null {
  try { const s = window.localStorage; s.getItem('x'); return s; } catch { return null; }
}

export class DemoAdapter implements Adapter {
  readonly kind = 'demo' as const;
  private data: Partial<Record<Coll, Map<string, Collections[Coll]>>> = {};
  private ready: Promise<void> | null = null;
  private dirty = new Set<Coll>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private seed: () => Promise<{ [C in Coll]: Collections[C][] }>, private store: Storage | null = storage()) {}

  private load() {
    return (this.ready ??= (async () => {
      const missing = COLLECTIONS.filter(c => {
        try {
          const raw = this.store?.getItem(KEY(c));
          if (!raw) return true;
          this.data[c] = new Map((JSON.parse(raw) as Collections[Coll][]).map(d => [d._id, d]));
          return false;
        } catch { return true; }
      });
      if (missing.length) {
        const seed = await this.seed();
        for (const c of missing) { this.data[c] = new Map(seed[c].map(d => [d._id, d])); this.dirty.add(c); }
        this.flush();
      }
    })());
  }

  private coll<C extends Coll>(c: C) { return this.data[c] as Map<string, Collections[C]>; }

  private touch(c: Coll) {
    this.dirty.add(c);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  private flush() {
    for (const c of this.dirty) {
      try { this.store?.setItem(KEY(c), JSON.stringify([...this.coll(c).values()])); } catch { /* full or blocked: keep in memory */ }
    }
    this.dirty.clear();
  }

  async find<C extends Coll>(c: C, filter?: Filter, opts?: FindOpts) {
    await this.load();
    return structuredClone(applyOpts([...this.coll(c).values()].filter(d => matches(d, filter)), opts));
  }
  async get<C extends Coll>(c: C, id: string) {
    await this.load();
    const d = this.coll(c).get(id);
    return d ? structuredClone(d) : null;
  }
  async insert<C extends Coll>(c: C, doc: Collections[C]) {
    await this.load();
    if (this.coll(c).has(doc._id)) throw new Error(`${c}/${doc._id} already exists`);
    this.coll(c).set(doc._id, structuredClone(doc));
    this.touch(c);
    return structuredClone(doc);
  }
  async update<C extends Coll>(c: C, id: string, set: Partial<Collections[C]>) {
    await this.load();
    const cur = this.coll(c).get(id);
    if (!cur) throw new Error(`${c}/${id} not found`);
    const next = { ...cur, ...structuredClone(set), _id: id };
    this.coll(c).set(id, next);
    this.touch(c);
    return structuredClone(next);
  }
  async remove(c: Coll, id: string) {
    await this.load();
    this.coll(c).delete(id);
    this.touch(c);
  }
  async reset() {
    for (const c of COLLECTIONS) { try { this.store?.removeItem(KEY(c)); } catch { /* ignore */ } }
    this.data = {}; this.ready = null;
    await this.load();
  }
}

// ---------- api: MongoDB / Cosmos DB through the server ----------
export class ApiAdapter implements Adapter {
  readonly kind = 'api' as const;
  constructor(private base: string, private headers: () => Record<string, string> = () => ({})) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${this.base}/api/${path}`, { ...init, headers: { 'content-type': 'application/json', ...this.headers(), ...init.headers } });
    if (r.status === 404 && (init.method ?? 'GET') === 'GET') return null as T;
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${r.status} ${await r.text()}`);
    return (r.status === 204 ? null : await r.json()) as T;
  }

  find<C extends Coll>(c: C, filter: Filter = {}, opts: FindOpts = {}) {
    const q = new URLSearchParams({ filter: JSON.stringify(filter) });
    if (opts.sort) q.set('sort', JSON.stringify(opts.sort));
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.skip) q.set('skip', String(opts.skip));
    return this.call<Collections[C][]>(`${c}?${q}`);
  }
  get<C extends Coll>(c: C, id: string) { return this.call<Collections[C] | null>(`${c}/${encodeURIComponent(id)}`); }
  insert<C extends Coll>(c: C, doc: Collections[C]) { return this.call<Collections[C]>(c, { method: 'POST', body: JSON.stringify(doc) }); }
  update<C extends Coll>(c: C, id: string, set: Partial<Collections[C]>) {
    return this.call<Collections[C]>(`${c}/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ $set: set }) });
  }
  async remove(c: Coll, id: string) { await this.call(`${c}/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  async reset() { await this.call('_reset', { method: 'POST' }); }
}
