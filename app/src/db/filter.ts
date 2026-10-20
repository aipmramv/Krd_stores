// The subset of MongoDB query and sort syntax the app uses, evaluated in memory by the demo
// database. The server passes the same objects straight to MongoDB / Cosmos DB, so a query that
// works in the demo works against the real database.
export type Filter = Record<string, unknown>;
export type Sort = Record<string, 1 | -1>;
export interface FindOpts { sort?: Sort; limit?: number; skip?: number }

const get = (doc: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v == null ? undefined : (v as Record<string, unknown>)[k]), doc);

const cmp = (a: unknown, b: unknown) => (a === b ? 0 : a === undefined || a === null ? -1 : b === undefined || b === null ? 1 : (a as number) < (b as number) ? -1 : 1);

const isOps = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).some(k => k.startsWith('$'));

/** Equality as MongoDB does it: an array field matches when any element matches. */
const eq = (field: unknown, v: unknown) => (Array.isArray(field) && !Array.isArray(v) ? field.includes(v) : JSON.stringify(field) === JSON.stringify(v));

function test(field: unknown, cond: unknown): boolean {
  if (!isOps(cond)) return eq(field, cond);
  return Object.entries(cond).every(([op, v]) => {
    switch (op) {
      case '$eq': return eq(field, v);
      case '$ne': return !eq(field, v);
      case '$in': return (v as unknown[]).some(x => eq(field, x));
      case '$nin': return !(v as unknown[]).some(x => eq(field, x));
      case '$gt': return field != null && cmp(field, v) > 0;
      case '$gte': return field != null && cmp(field, v) >= 0;
      case '$lt': return field != null && cmp(field, v) < 0;
      case '$lte': return field != null && cmp(field, v) <= 0;
      case '$exists': return (field !== undefined) === !!v;
      case '$regex': return typeof field === 'string' && new RegExp(v as string, (cond.$options as string) ?? '').test(field);
      case '$options': return true;
      case '$not': return !test(field, v);
      default: throw new Error(`Unsupported query operator ${op}`);
    }
  });
}

export function matches(doc: unknown, filter: Filter = {}): boolean {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$and') return (v as Filter[]).every(f => matches(doc, f));
    if (k === '$or') return (v as Filter[]).some(f => matches(doc, f));
    if (k === '$nor') return !(v as Filter[]).some(f => matches(doc, f));
    return test(get(doc, k), v);
  });
}

export function applyOpts<T>(docs: T[], { sort, skip = 0, limit }: FindOpts = {}): T[] {
  let out = docs;
  if (sort) {
    const keys = Object.entries(sort);
    out = [...out].sort((a, b) => { for (const [k, d] of keys) { const c = cmp(get(a, k), get(b, k)); if (c) return c * d; } return 0; });
  }
  return out.slice(skip, limit ? skip + limit : undefined);
}
