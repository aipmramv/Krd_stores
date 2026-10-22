import { describe, expect, it } from 'vitest';
import { seed } from '../db/seed';
import { parseCsv, toCsv } from './csv';
import { scrapWriteOff, shipmentSla, spaceUtilisation, stockByProject } from './reports';

const d = seed();
const parts = new Map(d.parts.map(p => [p._id, p]));

describe('reports', () => {
  it('values stock by project and ranks by value', () => {
    const r = stockByProject(d.stockLots, parts);
    expect(r.reduce((n, x) => n + x.qty, 0)).toBe(d.stockLots.reduce((n, l) => n + l.qty, 0));
    expect(r[0].value).toBeGreaterThanOrEqual(r[r.length - 1].value);
  });
  it('measures bin utilisation per site and per rack', () => {
    const sites = spaceUtilisation(d.locations, d.stockLots, 'site');
    expect(sites.map(s => s.key).sort()).toEqual(['dhl', 'isu', 'ktec', 'pnq']);
    expect(sites.every(s => s.bins === 192 && s.used <= s.capacity)).toBe(true);
    const ktec = spaceUtilisation(d.locations.filter(l => l.site === 'ktec'), d.stockLots, 'rack');
    expect(ktec.map(r => r.key)).toEqual(['Rack A', 'Rack B', 'Rack C', 'Rack D']);
    expect(ktec.find(r => r.key === 'Rack A')!.empty).toBe(0); // KTEC fills every bin
  });
  it('scores on-time delivery against the booked ETA', () => {
    const base = d.shipments[0];
    const ship = (etaAt: string, deliveredAt?: string) => ({ ...base, carrier: 'X', etaAt, status: deliveredAt ? 'Delivered' : 'In transit',
      milestones: [{ label: 'Delivered', done: !!deliveredAt, at: deliveredAt }] });
    const [r] = shipmentSla([ship('2026-10-20T10:00:00Z', '2026-10-20T09:00:00Z'), ship('2026-10-20T10:00:00Z', '2026-10-21T09:00:00Z'), ship('2026-10-19T10:00:00Z')], Date.parse('2026-10-22T00:00:00Z'));
    expect(r).toMatchObject({ shipments: 3, delivered: 2, onTime: 1, late: 1, overdue: 1, onTimePct: 50 });
  });
  it('splits scrap value into open, written off and rejected', () => {
    const r = scrapWriteOff(d.scrapCases);
    expect(r.reduce((n, x) => n + x.open, 0)).toBe(428000 + 98400);
  });
});

describe('CSV', () => {
  it('round-trips quotes, commas and line breaks, and reads semicolon files', () => {
    const csv = toCsv(['a', 'b'], [['x, "y"', 'line\nbreak'], [1, '']]);
    expect(parseCsv(csv)).toEqual([['a', 'b'], ['x, "y"', 'line\nbreak'], ['1', '']]);
    expect(parseCsv('﻿part;qty\r\nKM-1;4\r\n')).toEqual([['part', 'qty'], ['KM-1', '4']]);
  });
});
