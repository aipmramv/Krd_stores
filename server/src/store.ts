// MongoDB access shared by the API and the seed script. Works unchanged against MongoDB and
// Azure Cosmos DB for MongoDB (RU or vCore): only the connection string differs.
import { MongoClient, type Db, type Document } from 'mongodb';
import { COLLECTIONS, INDEXES, type Coll } from '../../app/src/db/schema.ts';
import { seed } from '../../app/src/db/seed.ts';

export const env = {
  uri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017',
  db: process.env.MONGODB_DB ?? 'materials_twin',
  port: Number(process.env.PORT ?? 8080),
  cors: process.env.CORS_ORIGIN ?? '*',
  allowReset: process.env.ALLOW_RESET === 'true',
};

let client: MongoClient | null = null;
export async function connect(): Promise<Db> {
  client ??= new MongoClient(env.uri, { retryWrites: false }); // Cosmos DB (RU) does not support retryable writes
  await client.connect();
  return client.db(env.db);
}
export const close = () => client?.close();

export const isColl = (c: string): c is Coll => (COLLECTIONS as string[]).includes(c);

/** Indexes for the queries the app runs. Cosmos DB needs an index for every sorted field. */
export async function ensureIndexes(db: Db) {
  for (const [c, list] of Object.entries(INDEXES)) {
    for (const keys of list ?? []) {
      try { await db.collection(c).createIndex(keys); } catch (e) { console.warn(`index ${c} ${JSON.stringify(keys)}:`, (e as Error).message); }
    }
  }
}

/** Replace every collection with the seed documents. */
export async function reseed(db: Db) {
  const data = seed();
  for (const c of COLLECTIONS) {
    const coll = db.collection<Document>(c);
    await coll.deleteMany({});
    const docs = data[c] as unknown as Document[];
    // Batches keep each request under Cosmos DB's request-size and RU limits.
    for (let i = 0; i < docs.length; i += 200) await coll.insertMany(docs.slice(i, i + 200), { ordered: false });
  }
  await ensureIndexes(db);
  return Object.fromEntries(COLLECTIONS.map(c => [c, data[c].length]));
}
