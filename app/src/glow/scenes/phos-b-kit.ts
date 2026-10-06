// Small shared kit for the phosphor plates phos-verse / phos-scope / phos-break: an additive Canvas2D layer with a soft
// blurred glow copy, composited onto the HDR target; the sticker star; word layout; exponential afterglow colours.
import * as THREE from 'three';
import type { Compositor } from '../../engine/gl';
import { Layer2D, W, H, clearRT } from '../../engine/gl';
import { F, font, measure } from '../../engine/type';
import type { Line } from '../../engine/lyrics';

export type RGB = [number, number, number];
export const PHOS: RGB = [182, 255, 106];
export const GOLD: RGB = [255, 194, 71];
export const VIOLET: RGB = [155, 92, 255];
export const CYAN: RGB = [51, 230, 255];
export const WHITE: RGB = [235, 255, 240];
export const DUSK: RGB = [14, 18, 48];

/** rgba() string of colour c mixed `hot` of the way to white, scaled by intensity i (used with 'lighter'). */
export function lit(c: RGB, i: number, hot = 0): string {
  const k = Math.max(0, i);
  const r = c[0] + (255 - c[0]) * hot, g = c[1] + (255 - c[1]) * hot, b = c[2] + (255 - c[2]) * hot;
  return `rgba(${r | 0},${g | 0},${b | 0},${Math.min(1, k).toFixed(3)})`;
}

export const FAM = () => F.archivo(100, 700);
export const FAM_THIN = () => F.archivo(100, 500);
export const FAM_MONO = () => F.mono(500);

/** Additive 2D surface with a blurred glow copy; draw into `c`, then `present`. */
export class Glow2D {
  main = new Layer2D();
  glow = new Layer2D(W / 2, H / 2, 1);
  get c() { return this.main.ctx; }
  begin() {
    this.main.clear('#000');
    this.c.globalCompositeOperation = 'lighter';
    this.c.lineCap = 'round';
    this.c.lineJoin = 'round';
  }
  present(renderer: THREE.WebGLRenderer, comp: Compositor, out: THREE.WebGLRenderTarget, o: { glow?: number; bg?: RGB; blur?: number } = {}) {
    const g = this.glow.ctx;
    this.glow.clear('#000');
    g.globalCompositeOperation = 'lighter';
    const b = o.blur ?? 1;
    g.filter = `blur(${5 * b}px)`;
    g.drawImage(this.main.canvas, 0, 0, W / 2, H / 2);
    g.filter = `blur(${20 * b}px)`;
    g.drawImage(this.main.canvas, 0, 0, W / 2, H / 2);
    g.filter = 'none';
    this.main.upload(); this.glow.upload();
    const bg = o.bg ?? [0.004, 0.005, 0.012];
    clearRT(renderer, out, bg, 1);
    comp.draw(renderer, this.main.texture, out, { mode: 'add' });
    comp.draw(renderer, this.glow.texture, out, { mode: 'add', opacity: o.glow ?? 1.4 });
  }
}

/** Rounded five-pointed sticker star centred on (x, y), outer radius r, point up. */
export function starPath(c: CanvasRenderingContext2D, x: number, y: number, r: number, inner = 0.46, rot = 0) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + rot + (i * Math.PI) / 5, rr = i % 2 ? r * inner : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i) c.lineTo(px, py); else c.moveTo(px, py);
  }
  c.closePath();
}
export function starPoints(x: number, y: number, r: number, inner = 0.46, rot = 0): [number, number][] {
  return Array.from({ length: 10 }, (_, i) => {
    const a = -Math.PI / 2 + rot + (i * Math.PI) / 5, rr = i % 2 ? r * inner : r;
    return [x + Math.cos(a) * rr, y + Math.sin(a) * rr] as [number, number];
  });
}

/** A sticker star lit to intensity q: filled (dim to bright), a rounded rim, a hot core when freshly charged. */
export function drawSticker(c: CanvasRenderingContext2D, x: number, y: number, r: number, q: number, rot = 0, tint: RGB = PHOS) {
  c.save();
  c.lineJoin = 'round';
  starPath(c, x, y, r, 0.46, rot);
  c.fillStyle = lit(tint, 0.1 + 0.62 * q, 0.15 * q);
  c.fill();
  c.lineWidth = r * 0.12;
  c.strokeStyle = lit(tint, 0.15 + 0.7 * q, 0.35 * q);
  c.stroke();
  // inner star: the brighter centre of a charged sticker
  starPath(c, x, y, r * 0.55, 0.46, rot);
  c.fillStyle = lit(tint, 0.35 * q, 0.7 * q);
  c.fill();
  c.restore();
}

/**
 * Word boxes of a lyric line set in rows (`rows` = word counts per row), centred on (cx, cy), in `size` px.
 * Each word's x is its left edge, y its baseline.
 */
export interface Placed { w: string; x: number; y: number; size: number; word: Line['words'][number] }
export function placeLine(line: Line, rows: number[], size: number, cx: number, cy: number, family = FAM(), track = 0): Placed[] {
  const out: Placed[] = [];
  const gap = measure(' ', family, size, track) * 0.9;
  const lh = size * 1.18;
  let wi = 0;
  rows.forEach((n, r) => {
    const ws = line.words.slice(wi, wi + n);
    wi += n;
    const widths = ws.map((w) => measure(w.w, family, size, track));
    const tot = widths.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
    let x = cx - tot / 2;
    const y = cy + (r - (rows.length - 1) / 2) * lh + size * 0.34;
    ws.forEach((w, i) => { out.push({ w: w.w, x, y, size, word: w }); x += widths[i]! + gap; });
  });
  return out;
}

export function setFont(c: CanvasRenderingContext2D, size: number, family = FAM()) {
  c.font = font(family, size);
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
}
