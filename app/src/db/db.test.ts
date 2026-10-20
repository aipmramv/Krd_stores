import { describe, expect, it } from 'vitest';
import { DemoAdapter } from './adapters';
import { applyOpts, matches } from './filter';
import { seed } from './seed';

describe('Mongo-style filters', () => {
  const doc = { _id: 'a', site: 'ktec', qty: 12, tags: ['esd', 'hot'], loc: { rack: 2 }, name: 'Door operator' };
  it('matches equality, operators and dotted paths', () => {
    expect(matches(doc, { site: 'ktec' })).toBe(true);
    expect(matches(doc, { site: 'isu' })).toBe(false);
    expect(matches(doc, { qty: { $gte: 10, $lt: 13 } })).toBe(true);
    expect(matches(doc, { qty: { $in: [1, 2] } })).toBe(false);
    expect(matches(doc, { 'loc.rack': 2 })).toBe(true);
    expect(matches(doc, { tags: 'esd' })).toBe(true);
    expect(matches(doc, { name: { $regex: 'door', $options: 'i' } })).toBe(true);
    expect(matches(doc, { $or: [{ site: 'isu' }, { qty: 12 }] })).toBe(true);
    expect(matches(doc, { missing: { $exists: false } })).toBe(true);
    expect(() => matches(doc, { qty: { $where: '1' } })).toThrow();
  });
  it('sorts, skips and limits', () => {
    const rows = [{ n: 3 }, { n: 1 }, { n: 2 }];
    expect(applyOpts(rows, { sort: { n: 1 } }).map(r => r.n)).toEqual([1, 2, 3]);
    expect(applyOpts(rows, { sort: { n: -1 }, skip: 1, limit: 1 }).map(r => r.n)).toEqual([2]);
  });
});

class MemoryStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

describe('demo database', () => {
  it('seeds, queries, writes, persists and resets', async () => {
    const store = new MemoryStorage() as unknown as Storage;
    const a = new DemoAdapter(async () => seed(), store);
    expect((await a.find('locations', { site: 'ktec', store: 'electronics' })).length).toBe(192);
    expect((await a.find('parts')).length).toBe(12);
    await a.update('movements', 'MR-26-1180', { status: 'done' });
    expect((await a.get('movements', 'MR-26-1180'))?.status).toBe('done');
    await expect(a.insert('parts', (await a.get('parts', 'KM-DX-ACT-220'))!)).rejects.toThrow(/exists/);
    await new Promise(r => setTimeout(r, 200));
    // A new adapter on the same storage sees the saved change.
    const b = new DemoAdapter(async () => seed(), store);
    expect((await b.get('movements', 'MR-26-1180'))?.status).toBe('done');
    await b.reset();
    expect((await b.get('movements', 'MR-26-1180'))?.status).toBe('requested');
  });
  it('returns copies, so callers cannot change stored documents by accident', async () => {
    const a = new DemoAdapter(async () => seed(), new MemoryStorage() as unknown as Storage);
    const p = (await a.get('parts', 'KM-DX-ACT-220'))!;
    p.description = 'changed';
    expect((await a.get('parts', 'KM-DX-ACT-220'))!.description).toBe('Door operator actuator');
  });
  it('keeps the seed consistent: every lot points at a known location and part', () => {
    const d = seed();
    const locs = new Set(d.locations.map(l => l._id)), parts = new Set(d.parts.map(p => p._id));
    for (const l of d.stockLots) { expect(locs.has(l.locationId)).toBe(true); expect(parts.has(l.partNo)).toBe(true); }
    expect(new Set(d.stockLots.map(l => l._id)).size).toBe(d.stockLots.length);
  });
});
