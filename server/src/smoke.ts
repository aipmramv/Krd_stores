// npm run smoke: end-to-end check of a running API (used in CI against a MongoDB container).
//   API_URL=http://localhost:8080 npm run smoke
import assert from 'node:assert/strict';

const API = (process.env.API_URL ?? 'http://localhost:8080') + '/api';
const call = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${API}/${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-user': 'smoke', ...init.headers } });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

assert.equal((await call('health')).status, 200);
assert.equal((await call('_reset', { method: 'POST' })).status, 200, 'reset (ALLOW_RESET=true)');

const parts = await call(`parts?sort=${encodeURIComponent('{"partNo":1}')}`);
assert.equal(parts.status, 200);
assert.equal(parts.body.length, 12);
assert.equal(parts.body[0].partNo, 'KM-BAT-LI-500');

const ktecBins = await call(`locations?filter=${encodeURIComponent(JSON.stringify({ site: 'ktec', store: 'electronics' }))}`);
assert.equal(ktecBins.body.length, 192);

const big = await call(`stockLots?filter=${encodeURIComponent(JSON.stringify({ site: 'ktec', qty: { $gte: 30 } }))}&limit=5`);
assert.ok(big.body.length > 0 && big.body.every((l: { qty: number }) => l.qty >= 30));

const ins = await call('movements', { method: 'POST', body: JSON.stringify({ _id: 'MR-SMOKE', site: 'ktec', type: 'move', partNo: 'KM-DX-ACT-220', qty: 1, status: 'requested', requestedBy: 'smoke', approvals: [] }) });
assert.equal(ins.status, 201);
assert.equal((await call('movements', { method: 'POST', body: JSON.stringify({ _id: 'MR-SMOKE' }) })).status, 409, 'duplicate _id');
const upd = await call('movements/MR-SMOKE', { method: 'PATCH', body: JSON.stringify({ $set: { status: 'done' } }) });
assert.equal(upd.body.status, 'done');
const audit = await call(`auditLog?filter=${encodeURIComponent(JSON.stringify({ docId: 'MR-SMOKE' }))}`);
assert.equal(audit.body.length, 2);
assert.equal((await call(`parts?filter=${encodeURIComponent('{"$where":"1"}')}`)).status, 400, 'banned operator');
assert.equal((await call('movements/MR-SMOKE', { method: 'DELETE' })).status, 204);
assert.equal((await call('movements/MR-SMOKE')).status, 404);
console.log('smoke ok');
