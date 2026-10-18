// DOM labels pinned to 3D positions. They are kept inside the "safe area" (the part of the
// stage not covered by panels), de-overlapped by priority, and hidden under the radial menu.
import * as THREE from 'three';

export interface Rect { l: number; t: number; r: number; b: number }

export interface LabelOpts {
  cls?: string;
  tag?: 'button' | 'span' | 'div';
  onClick?: () => void;
  show?: () => boolean;
  /** Anchor as a fraction of the label size: x 0 = left edge at point, -.5 centred, -1 right edge. */
  ax?: number;
  /** Anchor y: 0 = top at point, -.5 centred, -1 bottom at point (default). */
  ay?: number;
  dx?: number;
  dy?: number;
  /** Higher priority labels are placed first and win overlaps. */
  pri?: number;
  /** Keep visible even when the radial menu covers it. */
  keep?: boolean;
}

interface Label extends LabelOpts { el: HTMLElement; pos: () => THREE.Vector3; w: number; h: number }

const v3 = new THREE.Vector3();

export class Labels {
  private items: Label[] = [];
  private frame = 0;
  constructor(private root: HTMLElement) {}

  clear() { this.root.innerHTML = ''; this.items = []; }

  add(pos: THREE.Vector3 | (() => THREE.Vector3), html: string, o: LabelOpts = {}) {
    const el = document.createElement(o.tag ?? 'button');
    el.className = 'lbl ' + (o.cls ?? '');
    el.innerHTML = html;
    if (o.onClick) el.addEventListener('click', o.onClick);
    this.root.appendChild(el);
    const fixed = pos instanceof THREE.Vector3 ? pos.clone() : null;
    const l: Label = { ...o, el, pos: fixed ? () => fixed : pos as () => THREE.Vector3, w: 0, h: 0 };
    this.items.push(l);
    return el;
  }

  update(cam: THREE.Camera, w: number, h: number, sa: Rect, ring: { x: number; y: number; r: number } | null) {
    this.frame++;
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const cand: { l: Label; x: number; y: number }[] = [];
    for (const l of this.items) {
      const vis = l.show ? l.show() : true;
      v3.copy(l.pos()).project(cam);
      if (v3.z > 1 || !vis || Math.abs(v3.x) > 1.3 || Math.abs(v3.y) > 1.3) { l.el.style.display = 'none'; continue; }
      l.el.style.display = '';
      if (!l.w || this.frame % 30 === 0) { l.w = l.el.offsetWidth; l.h = l.el.offsetHeight; }
      const ax = l.ax ?? -.5, ay = l.ay ?? -1, dx = l.dx ?? 0;
      const px = (v3.x * .5 + .5) * w, py = (-v3.y * .5 + .5) * h;
      if (px < sa.l || px > sa.r || py < sa.t || py > sa.b) { l.el.style.display = 'none'; continue; }
      let x = px + dx + ax * l.w;
      const y = py + (l.dy ?? 0) + ay * l.h;
      // Flip to the other side of the anchor when it would run past the safe area.
      if (x + l.w > sa.r) x = px - dx - l.w;
      if (x < sa.l) x = px + Math.abs(dx);
      if (x + l.w > sa.r) x = sa.r - l.w;
      cand.push({ l, x, y });
    }
    cand.sort((a, b) => ((b.l.pri ?? 0) - (a.l.pri ?? 0)) || (a.y - b.y));
    for (const { l, x, y: y0 } of cand) {
      let y = y0;
      for (let n = 0; n < 8; n++) {
        const hit = placed.find(p => x < p.x + p.w + 4 && x + l.w + 4 > p.x && y < p.y + p.h + 4 && y + l.h + 4 > p.y);
        if (!hit) break;
        y = hit.y - l.h - 6;
      }
      let hide = y < sa.t || y + l.h > sa.b || x < sa.l - 1;
      if (!hide && ring && !l.keep) {
        const cx = Math.max(x, Math.min(ring.x, x + l.w)), cy = Math.max(y, Math.min(ring.y, y + l.h));
        if (Math.hypot(cx - ring.x, cy - ring.y) < ring.r) hide = true;
      }
      if (hide) { l.el.style.display = 'none'; continue; }
      placed.push({ x, y, w: l.w, h: l.h });
      l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  }
}
