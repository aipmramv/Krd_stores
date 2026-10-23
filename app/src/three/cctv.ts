// Virtual CCTV: renders the store twin from a camera's position, the way the camera would see it,
// with the overlays a video-analytics feed carries: detection boxes on people and the forklift,
// faces pixelated unless an authorised viewer unblurs them, the event box on a clip, and the
// on-screen display (camera, time, LIVE or CLIP). In the pilot the same viewer shows the WebRTC
// stream from the edge box instead of this render.
import * as THREE from 'three';
import type { Camera } from '../db/schema';
import { pointOf } from '../services/cameras';
import { buildStore, live } from './store3d';

const W = 640, H = 360;
let R: THREE.WebGLRenderer | null = null;
const cam = new THREE.PerspectiveCamera(50, W / H, .3, 140);
const pix = document.createElement('canvas');
pix.width = pix.height = 6;
const noise = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!, d = x.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  x.putImageData(d, 0, 0);
  return c;
})();

export interface CctvView {
  camera: Camera;
  /** Pixelate faces (default). */
  blur: boolean;
  /** Time shown on the display. */
  at: Date;
  /** For a clip: what to box, where, and the position in the clip (s of total s). */
  clip?: { label: string; loc?: string; t: number; total: number };
  /** Small tiles skip labels. */
  small?: boolean;
}

const hash = (s: string) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const ist = (d: Date) => new Date(d.getTime() + 5.5 * 3600000).toISOString().replace('T', ' ').slice(0, 19);

function project(v: THREE.Vector3, w: number, h: number): [number, number] | null {
  const p = v.clone().project(cam);
  if (p.z > 1 || p.z < -1) return null;
  return [(p.x + 1) / 2 * w, (1 - p.y) / 2 * h];
}

/** Draw one frame of a camera into a 2D canvas. Returns false when WebGL is unavailable. */
export function drawCctv(ctx: CanvasRenderingContext2D, o: CctvView): boolean {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  if (!R) {
    try {
      R = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
      R.setSize(W, H, false); R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.1;
    } catch { return false; }
  }
  const st = buildStore();
  (st.sc.userData.tick as ((t: number) => void) | undefined)?.(performance.now() / 1000);
  const c = o.camera;
  cam.fov = c.fov; cam.position.set(...c.pos); cam.lookAt(new THREE.Vector3(...c.look)); cam.updateProjectionMatrix();
  // Cameras do not see their own view cones.
  const shown = st.cams.visible; st.cams.visible = false;
  R.render(st.sc, cam);
  st.cams.visible = shown;

  ctx.save();
  ctx.filter = 'grayscale(.8) contrast(1.18) brightness(1.06)';
  ctx.drawImage(R.domElement, 0, 0, w, h);
  ctx.filter = 'none';
  ctx.globalAlpha = .07;
  ctx.drawImage(noise, -Math.random() * 64, -Math.random() * 64, w + 128, h + 128);
  ctx.globalAlpha = 1;
  const s = w / W, font = (px: number, weight = 600) => `${weight} ${Math.max(9, px * s)}px ui-monospace, SFMono-Regular, Menlo, monospace`;

  // Detections: people (BLE badges) and the forklift, from the positions the twin draws.
  for (const p of live) {
    if (p.kind === 'trolley') continue;
    const tall = p.kind === 'forklift' ? 2.6 : 1.85, half = p.kind === 'forklift' ? 1.1 : .32;
    const top = project(new THREE.Vector3(p.x, tall, p.z), w, h), foot = project(new THREE.Vector3(p.x, 0, p.z), w, h);
    if (!top || !foot) continue;
    const bh = foot[1] - top[1], bw = Math.max(6, bh * (half * 2 / tall) * 1.3), x = top[0] - bw / 2;
    if (bh < 6 || x > w || x + bw < 0 || top[1] > h || foot[1] < 0) continue;
    if (p.kind === 'badge' && o.blur) {
      const fy = top[1] + bh * .02, fs = Math.max(4, bw * .55);
      const g = pix.getContext('2d')!;
      g.drawImage(ctx.canvas, top[0] - fs / 2, fy, fs, fs, 0, 0, 6, 6);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pix, 0, 0, 6, 6, top[0] - fs / 2, fy, fs, fs);
      ctx.imageSmoothingEnabled = true;
    }
    const col = p.kind === 'forklift' ? '#F2B53A' : '#3DBE7E';
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.strokeRect(x, top[1], bw, bh);
    if (!o.small) {
      const conf = 88 + (hash(p.id) % 11), label = `${p.kind === 'forklift' ? 'Forklift' : 'Person'} ${conf}%${p.moving ? ' · moving' : ''}`;
      ctx.font = font(11);
      const tw = ctx.measureText(label).width + 8 * s;
      ctx.fillStyle = col; ctx.fillRect(x, top[1] - 15 * s, tw, 15 * s);
      ctx.fillStyle = '#141414'; ctx.fillText(label, x + 4 * s, top[1] - 4 * s);
    }
  }

  // The event on a clip: a pulsing box at the place it happened.
  if (o.clip?.loc) {
    const p = pointOf(o.clip.loc), at = p && project(new THREE.Vector3(...p), w, h);
    if (at) {
      const d = cam.position.distanceTo(new THREE.Vector3(...p!)), size = Math.max(26, 900 / d) * s, pulse = 1 + .08 * Math.sin(performance.now() / 120);
      ctx.strokeStyle = '#FF5A4F'; ctx.lineWidth = 2.5 * s;
      ctx.strokeRect(at[0] - size * pulse / 2, at[1] - size * pulse / 2, size * pulse, size * pulse);
      ctx.font = font(12);
      const tw = ctx.measureText(o.clip.label).width + 10 * s;
      ctx.fillStyle = '#FF5A4F'; ctx.fillRect(at[0] - size / 2, at[1] + size / 2 + 3 * s, tw, 17 * s);
      ctx.fillStyle = '#fff'; ctx.fillText(o.clip.label, at[0] - size / 2 + 5 * s, at[1] + size / 2 + 15 * s);
    }
  }

  // On-screen display.
  ctx.font = font(o.small ? 13 : 12);
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(0, 0, w, 22 * s);
  ctx.fillStyle = '#fff';
  ctx.fillText(o.small ? c.code : `${c.code} · ${c.name.toUpperCase()}`, 8 * s, 15 * s);
  const stamp = ist(o.at);
  ctx.fillText(stamp, w - ctx.measureText(stamp).width - 8 * s, 15 * s);
  if (!o.small) {
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, h - 22 * s, w, 22 * s);
    const rec = o.clip ? `CLIP ${String(Math.floor(o.clip.t)).padStart(2, '0')}s / ${o.clip.total}s · SIMULATED` : 'LIVE · SIMULATED';
    ctx.fillStyle = o.clip ? '#FFE141' : '#FF5A4F';
    ctx.beginPath(); ctx.arc(12 * s, h - 11 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(rec, 22 * s, h - 7 * s);
    const priv = o.blur ? 'FACES BLURRED' : 'UNBLURRED · VIEW AUDITED';
    ctx.fillStyle = o.blur ? '#fff' : '#FFE141';
    ctx.fillText(priv, w - ctx.measureText(priv).width - 8 * s, h - 7 * s);
  }
  ctx.restore();
  return true;
}
