// REST API for the Materials Twin. The app's ApiAdapter (app/src/db/adapters.ts) is the client:
//   GET    /api/:coll?filter=<json>&sort=<json>&limit=&skip=   list
//   GET    /api/:coll/:id                                       one document
//   POST   /api/:coll                                           insert
//   PATCH  /api/:coll/:id   { "$set": { … } }                   update fields
//   DELETE /api/:coll/:id                                       remove
//   POST   /api/_reset                                          reseed (only with ALLOW_RESET=true)
//   POST   /api/_ingest     a sensor event (camera, scanner, tag, sensor); runs the rules engine
//   GET    /api/_stream     server-sent events: { coll } after every write, for live updates
//   GET    /api/health
// Every write is recorded in auditLog with the x-user header. Sign-in (Microsoft Entra ID) goes in
// front of this when it is deployed for real users; see README.md.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Document, Filter as MFilter, Sort } from 'mongodb';
import type { Alert, Camera, Movement, SensorEvent, Shipment, StockLot, User } from '../../app/src/db/schema.ts';
import { evaluate } from '../../app/src/services/rules.ts';
import { connect, ensureIndexes, env, isColl, reseed } from './store.ts';

const db = await connect();
await ensureIndexes(db);

/** Operators that run code or scan unboundedly are never accepted from clients. */
const BANNED = new Set(['$where', '$function', '$accumulator', '$expr']);
function clean(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => {
      if (BANNED.has(k)) throw Object.assign(new Error(`Operator ${k} is not allowed`), { status: 400 });
      return [k, clean(x)];
    }));
  }
  return v;
}

const json = (res: ServerResponse, status: number, body?: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2_000_000) throw Object.assign(new Error('Body too large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

const parse = (s: string | null, fallback: unknown) => (s ? clean(JSON.parse(s)) : fallback);

// Live updates: every connected browser hears which collection changed.
const streams = new Set<ServerResponse>();
const announce = (coll: string) => { for (const s of streams) s.write(`data: ${JSON.stringify({ coll })}\n\n`); };
setInterval(() => { for (const s of streams) s.write(': keep-alive\n\n'); }, 25000).unref();

const newId = (p: string) => `${p}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

/** Sensor events are their own log; auditing them (and tag readings) would flood the audit log. */
const UNAUDITED = new Set(['auditLog', 'events', 'trackers']);
async function audit(user: string, action: 'insert' | 'update' | 'remove', coll: string, docId: string, change?: unknown) {
  if (UNAUDITED.has(coll)) return;
  const at = new Date().toISOString();
  await db.collection('auditLog').insertOne({ _id: `AU-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at, user, action, coll, docId, change } as Document);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('access-control-allow-origin', env.cors);
  res.setHeader('access-control-allow-headers', 'content-type, x-user, authorization');
  res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return json(res, 204);
  const url = new URL(req.url ?? '/', 'http://x');
  const [, api, coll, rawId] = url.pathname.split('/');
  if (api !== 'api') return json(res, 404, { error: 'Not found' });
  if (coll === 'health') return json(res, 200, { ok: true, db: env.db });
  if (coll === '_reset' && req.method === 'POST') {
    if (!env.allowReset) return json(res, 403, { error: 'Reset is disabled' });
    const out = await reseed(db);
    announce('*');
    return json(res, 200, out);
  }
  if (coll === '_stream' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n');
    streams.add(res);
    req.on('close', () => streams.delete(res));
    return;
  }
  if (coll === '_ingest' && req.method === 'POST') return json(res, 201, await ingest(clean(await body(req)) as SensorEvent, String(req.headers['x-user'] ?? 'device')));
  if (!coll || !isColl(coll)) return json(res, 404, { error: `Unknown collection ${coll}` });
  type Row = Document & { _id: string };
  const c = db.collection<Row>(coll);
  const id = rawId ? decodeURIComponent(rawId) : null;
  const user = String(req.headers['x-user'] ?? 'anonymous');

  if (req.method === 'GET' && !id) {
    const filter = parse(url.searchParams.get('filter'), {}) as MFilter<Row>;
    const sort = parse(url.searchParams.get('sort'), undefined) as Sort | undefined;
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000) || 1000, 5000);
    const skip = Number(url.searchParams.get('skip') ?? 0) || 0;
    let cur = c.find(filter).skip(skip).limit(limit);
    if (sort) cur = cur.sort(sort);
    return json(res, 200, await cur.toArray());
  }
  if (req.method === 'GET' && id) {
    const doc = await c.findOne({ _id: id });
    return doc ? json(res, 200, doc) : json(res, 404, { error: 'Not found' });
  }
  if (req.method === 'POST' && !id) {
    const doc = clean(await body(req)) as Row;
    if (typeof doc._id !== 'string') return json(res, 400, { error: '_id (string) is required' });
    await c.insertOne(doc);
    await audit(user, 'insert', coll, doc._id, doc);
    announce(coll);
    return json(res, 201, doc);
  }
  if (req.method === 'PATCH' && id) {
    const { $set } = clean(await body(req)) as { $set?: Partial<Row> };
    if (!$set || typeof $set !== 'object') return json(res, 400, { error: 'Body must be { "$set": { … } }' });
    delete $set._id;
    const out = await c.findOneAndUpdate({ _id: id }, { $set }, { returnDocument: 'after' });
    if (!out) return json(res, 404, { error: 'Not found' });
    await audit(user, 'update', coll, id, $set);
    announce(coll);
    return json(res, 200, out);
  }
  if (req.method === 'DELETE' && id) {
    await c.deleteOne({ _id: id });
    await audit(user, 'remove', coll, id);
    announce(coll);
    return json(res, 204);
  }
  return json(res, 405, { error: 'Method not allowed' });
}

/**
 * A device or edge box reports an event: the rules engine (shared with the app) decides what it
 * means, using the records of the last hour around it, and the outcome is stored with it.
 */
async function ingest(input: SensorEvent, user: string): Promise<SensorEvent> {
  if (!input?.site || !input.kind || !input.source) throw Object.assign(new Error('site, source and kind are required'), { status: 400 });
  const ev: SensorEvent = { ...input, _id: typeof input._id === 'string' ? input._id : newId('EV'), at: input.at ?? new Date().toISOString() };
  const since = new Date(Date.parse(ev.at) - 3600000).toISOString();
  const col = <T,>(n: string) => db.collection<T & Document>(n);
  const [movements, users, shipments, cameras, lots, events] = await Promise.all([
    col<Movement>('movements').find({ site: ev.site }).toArray(), col<User>('users').find({}).toArray(),
    col<Shipment>('shipments').find({ $or: [{ from: ev.site }, { to: ev.site }] }).toArray(), col<Camera>('cameras').find({ site: ev.site }).toArray(),
    col<StockLot>('stockLots').find({ site: ev.site }).toArray(), col<SensorEvent>('events').find({ site: ev.site, at: { $gte: since } }).toArray(),
  ]);
  const o = evaluate(ev, { movements, users, shipments, cameras, lots, events } as unknown as Parameters<typeof evaluate>[1]);
  Object.assign(ev, { outcome: o.outcome, note: o.note, matched: o.matched, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  if (o.alert) {
    const a: Alert = { _id: newId('AL'), site: ev.site, ...o.alert, status: 'open', at: ev.at, eventId: ev._id, loc: ev.loc, createdAt: ev.createdAt, updatedAt: ev.createdAt };
    await col<Alert>('alerts').insertOne(a as Alert & Document);
    await audit(user, 'insert', 'alerts', a._id, a);
    ev.alert = a._id;
    if (ev.clip) ev.clip = { ...ev.clip, held: true };
    announce('alerts');
  }
  const m = o.matched ? movements.find(x => x._id === o.matched) : undefined;
  if (m) { await col<Movement>('movements').updateOne({ _id: m._id }, { $set: { evidence: [...(m.evidence ?? []), ev._id] } }); announce('movements'); }
  await col<SensorEvent>('events').insertOne(ev as SensorEvent & Document);
  announce('events');
  return ev;
}

createServer((req, res) => {
  handle(req, res).catch(e => {
    const status = (e as { status?: number }).status ?? ((e as { code?: number }).code === 11000 ? 409 : 500);
    if (status === 500) console.error(e);
    json(res, status, { error: (e as Error).message });
  });
}).listen(env.port, () => console.log(`Materials Twin API on :${env.port} · database ${env.db}`));
