// Fetch OpenStreetMap buildings, roads, trees and parks for each key site and save them as
// public/osm/<site>.json, so the app loads them from its own server instead of busy public
// Overpass mirrors. Runs in the Pages deploy (Node 22 runs this TypeScript directly):
//   node scripts/fetch-osm.ts
// Never fails the build: a site that cannot be fetched keeps using the live mirrors at runtime.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES } from '../src/data/sites.ts';
import { queryOverpass } from '../src/services/osm.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'osm');
mkdirSync(out, { recursive: true });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let ok = 0;
for (const site of SITES) {
  const [lat, lon] = site.ll;
  let data = null;
  for (let attempt = 1; attempt <= 3 && !data; attempt++) {
    data = await queryOverpass(lat, lon, 120000);
    if (!data) { console.log(`${site.id}: attempt ${attempt} failed`); await sleep(15000 * attempt); }
  }
  if (!data) { console.log(`${site.id}: no data, the app will use the live mirrors`); continue; }
  writeFileSync(join(out, `${site.id}.json`), JSON.stringify({ fetched: new Date().toISOString(), elements: data.elements }));
  const n = (data.elements ?? []).filter(e => e.tags?.building).length;
  console.log(`${site.id}: ${data.elements?.length} features, ${n} buildings`);
  ok++;
  await sleep(5000); // be gentle with the public servers
}
console.log(`OSM bundled for ${ok}/${SITES.length} sites`);
