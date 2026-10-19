// Write the key sites and their facilities to ../blender/sites.json for the Blender site pipeline
// (blender/site_from_osm.py), so Blender and the app agree on facility keys and roles.
//   node scripts/export-sites.ts
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITES } from '../src/data/sites.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'blender', 'sites.json');
const sites = SITES.map(s => ({
  id: s.id, name: s.name, kind: s.kind, ll: s.ll,
  facilities: s.facilities.map(f => ({ k: f.k, n: f.n, facade: f.facade, col: f.col, floors: f.floors?.length ?? 0, modelled: f.modelled ?? null })),
}));
writeFileSync(out, JSON.stringify(sites, null, 2) + '\n');
console.log(`wrote ${out} · ${sites.length} sites`);
