// Procedural PBR facades. Each texture tile covers a fixed real-world size so it can be mapped
// with the world-space UVs that ExtrudeGeometry gives building walls (metres along the wall, metres up).
import * as THREE from 'three';
import type { Facade } from '../data/types';

/** Real-world size of one texture tile in metres: [width, height]. */
export const TILE: Record<Facade, [number, number]> = { glass: [12, 14.4], metal: [12, 12], concrete: [12, 13.2] };
const PX = 512;

function canvas(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = PX;
  draw(c.getContext('2d')!);
  return c;
}

/** Stable pseudo-random value in [0,1) for texture details. */
const rand = (n: number) => { const x = Math.sin(n * 91.345 + 7.13) * 47453.5453; return x - Math.floor(x); };

function draw(kind: Facade, lit: boolean) {
  return canvas(g => {
    g.fillStyle = lit ? '#000' : '#888';
    g.fillRect(0, 0, PX, PX);
    if (kind === 'glass') {
      // 4 bays × 4 floors of curtain wall: glazing, spandrel band, mullions.
      const bw = PX / 4, fh = PX / 4;
      for (let f = 0; f < 4; f++) for (let b = 0; b < 4; b++) {
        const x = b * bw, y = f * fh, n = f * 4 + b;
        if (lit) {
          if (rand(n) > .62) { g.fillStyle = rand(n + 9) > .5 ? '#FFE7B0' : '#F4F1E8'; g.fillRect(x + 3, y + 3, bw - 6, fh * .78 - 6); }
          continue;
        }
        const grad = g.createLinearGradient(x, y, x + bw * .6, y + fh);
        grad.addColorStop(0, '#8FA6B9'); grad.addColorStop(1, '#4A6074');
        g.fillStyle = grad; g.fillRect(x, y, bw, fh * .78);
        g.fillStyle = '#5B6672'; g.fillRect(x, y + fh * .78, bw, fh * .22);
        g.fillStyle = '#C9CED3'; g.fillRect(x, y, 3, fh); g.fillRect(x, y + fh * .78, bw, 3);
        g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x + bw * .5, y, 2, fh * .78);
      }
    } else if (kind === 'metal') {
      // Ribbed cladding with a high-level strip window and a band of dock doors at the bottom.
      if (!lit) {
        g.fillStyle = '#C3C7CB'; g.fillRect(0, 0, PX, PX);
        for (let x = 0; x < PX; x += 16) { g.fillStyle = '#A9AEB3'; g.fillRect(x, 0, 4, PX); g.fillStyle = '#D4D8DB'; g.fillRect(x + 4, 0, 2, PX); }
        g.fillStyle = '#9EA4AA'; g.fillRect(0, PX * .1, PX, 6);
      }
      g.fillStyle = lit ? '#FFF2CC' : '#3B4652'; g.fillRect(0, PX * .16, PX, PX * .07);
      for (let i = 0; i < 2; i++) {
        const x = 40 + i * 256;
        if (!lit) { g.fillStyle = '#7C8288'; g.fillRect(x, PX * .72, 150, PX * .28); g.fillStyle = '#6A7076'; for (let y = PX * .72; y < PX; y += 12) g.fillRect(x, y, 150, 2); }
        else if (rand(i) > .4) { g.fillStyle = '#FFE0A0'; g.fillRect(x, PX * .72, 150, PX * .28); }
      }
    } else {
      // Rendered concrete with punched windows, 3 floors.
      if (!lit) { g.fillStyle = '#C9C2B6'; g.fillRect(0, 0, PX, PX); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${rand(i) * .05})`; g.fillRect(rand(i + 1) * PX, rand(i + 2) * PX, 3, 3); } }
      const fh = PX / 3;
      for (let f = 0; f < 3; f++) for (let b = 0; b < 4; b++) {
        const x = b * PX / 4 + 22, y = f * fh + 26, n = f * 4 + b;
        if (lit) { if (rand(n + 3) > .68) { g.fillStyle = '#FFE7B0'; g.fillRect(x, y, PX / 4 - 44, fh * .5); } continue; }
        g.fillStyle = '#34404C'; g.fillRect(x, y, PX / 4 - 44, fh * .5);
        g.fillStyle = '#B1AA9E'; g.fillRect(x - 4, y + fh * .5, PX / 4 - 36, 6);
      }
    }
  });
}

function tex(c: HTMLCanvasElement, srgb: boolean, size: [number, number]) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / size[0], 1 / size[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared wall material for a facade type. `tint` gives facility buildings their own copy. */
export function facadeMaterial(kind: Facade, tint?: string): THREE.MeshStandardMaterial {
  const key = kind + (tint ?? '');
  const hit = cache.get(key);
  if (hit) return hit;
  const base = cache.get(kind);
  let m: THREE.MeshStandardMaterial;
  if (base) m = base.clone();
  else {
    const size = TILE[kind];
    m = new THREE.MeshStandardMaterial({
      map: tex(draw(kind, false), true, size),
      emissiveMap: tex(draw(kind, true), true, size),
      emissive: new THREE.Color('#FFD9A0'), emissiveIntensity: 0,
      roughness: kind === 'glass' ? .2 : kind === 'metal' ? .45 : .85,
      metalness: kind === 'glass' ? .35 : kind === 'metal' ? .3 : 0,
      envMapIntensity: kind === 'glass' ? 1.7 : .9,
    });
  }
  if (tint) m.color.set(tint).lerp(new THREE.Color('#ffffff'), .55);
  cache.set(key, m);
  return m;
}

/** All facade materials, so night lighting can switch their windows on together. */
export const allFacades = () => [...cache.values()];

let roof: THREE.MeshStandardMaterial | null = null;
export function roofMaterial(tint?: string) {
  if (!roof) {
    const c = canvas(g => {
      g.fillStyle = '#A7A49E'; g.fillRect(0, 0, PX, PX);
      for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${rand(i) > .5 ? '255,255,255' : '0,0,0'},${rand(i + 5) * .06})`; g.fillRect(rand(i + 1) * PX, rand(i + 2) * PX, 4, 4); }
      g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 2;
      for (let x = 0; x < PX; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, PX); g.stroke(); }
    });
    roof = new THREE.MeshStandardMaterial({ map: tex(c, true, [20, 20]), roughness: .9 });
  }
  if (!tint) return roof;
  const m = roof.clone();
  m.color.set(tint);
  return m;
}
