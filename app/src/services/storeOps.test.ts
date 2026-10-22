import { describe, expect, it } from 'vitest';
import { binId } from '../data/storeModel';
import type { Location } from '../db/schema';
import { accessPoint, fitFor, nearestFree, pickOrder, route } from './storeOps';

const loc = (code: string, zone: Location['zone'] = 'ESD', capacity = 60): Location => ({ _id: `ktec:${code}`, site: 'ktec', store: 'electronics', code, zone, capacity });
const part = (hazard: string) => ({ _id: 'p', partNo: 'p', rev: 'A', description: 'x', category: 'x', uom: 'pcs', hazard, exportClass: '—', project: '—', unitCost: 1, weightKg: 1 });

describe('store floor', () => {
  it('routes along one aisle directly and round the shorter end otherwise', () => {
    expect(route([0, 0], [5, 0])).toEqual({ pts: [[0, 0], [5, 0]], len: 5 });
    const r = route(accessPoint({ r: 0, i: 0, k: 0 }), accessPoint({ r: 3, i: 0, k: 0 }));
    expect(r.pts).toHaveLength(4);
    expect(r.pts[1][0]).toBeLessThan(-16); // via the near (left) end
  });
  it('orders a pick list to walk less than the given order', () => {
    const bins = [{ r: 3, i: 11, k: 0 }, { r: 0, i: 0, k: 1 }, { r: 3, i: 0, k: 2 }, { r: 0, i: 11, k: 0 }];
    const best = pickOrder(bins);
    expect(best.order).toHaveLength(4);
    const naive = bins.reduce((n, b, i) => n + route(i ? accessPoint(bins[i - 1]) : [-17, 13.5], accessPoint(b)).len, 0);
    expect(best.len).toBeLessThanOrEqual(naive);
  });
  it('checks fit by zone, hazmat and capacity', () => {
    expect(fitFor(loc('A-01-01'), 50, 0, [part('ESD')], 5).fit).toBe('ok');
    expect(fitFor(loc('A-01-01'), 50, 0, [part('ESD')], 20)).toMatchObject({ fit: 'partial', free: 10 });
    expect(fitFor(loc('A-01-01'), 60, 0, [part('ESD')], 1).fit).toBe('no');
    expect(fitFor(loc('A-01-01'), 0, 0, [part('UN3480')], 1).reason).toMatch(/hazmat/i);
    expect(fitFor(loc('Hazmat H-01', 'Hazmat', 500), 0, 0, [part('ESD')], 1).fit).toBe('no');
    expect(fitFor(loc('Hazmat H-01', 'Hazmat', 500), 0, 0, [part('UN3480')], 1).fit).toBe('ok');
  });
  it('places a group into the nearest bins with room', () => {
    const locs = new Map([['A-01-01', loc('A-01-01')], ['A-02-01', loc('A-02-01')], ['A-03-01', loc('A-03-01')], ['D-12-04', loc('D-12-04')]]);
    const used = new Map([['A-01-01', 55]]);
    const out = nearestFree({ r: 0, i: 0, k: 0 }, [{ code: 'D-12-04', qty: 10 }, { code: 'X', qty: 30 }], locs, used, new Set(['D-12-04']));
    expect(out.get('D-12-04')).toBe('A-02-01'); // A-01-01 has only 5 free
    expect(out.get('X')).toBe('A-02-01');       // 50 - 10 = 40 left there
    expect(binId({ r: 0, i: 1, k: 0 })).toBe('A-02-01');
  });
});
