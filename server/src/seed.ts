// npm run seed: load the sample data into MongoDB / Cosmos DB (replaces existing documents).
import { close, connect, env, reseed } from './store.ts';

const counts = await reseed(await connect());
console.log(`Seeded ${env.db}:`, counts);
await close();
