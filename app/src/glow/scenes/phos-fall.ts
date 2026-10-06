// Bridge: a fall through space. Two stars, the phosphor sticker and a gold one, fall side by side tied by a thread of
// light; the lead star writes the words in light (script, one line at a time, never overlapping, nothing wobbles).
// The space we fall through is a shader of nebula sheets rushing up past us in depth with crisp star streaks and
// sticker debris over it: violet night for "And if you fall", every colour for "through the colors", deep blue for
// "and the blue", gold for "golden", the fall gathering speed toward a gold light below which, at the very end,
// takes the frame (chorus 3 starts from that gold). Pure function of song time.
import { prewarm } from '../lib/prewarm';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { Layer2D, FSPass, makeRT, W, H } from '../../engine/gl';
import { strokeText, writtenLength, type StrokeText } from '../../engine/stroke';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, mulberry32, prog, smoothstep, TAU } from '../../engine/util';

export const CX = 960, CY = 540;

/** The space of the fall: nebula sheets in depth (parallax with the fall distance uD), coloured by the phase. */
const SPACE = /* glsl */ `
uniform float uD, uT, uC, uB, uG, uM, uKick;
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fb(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * vn(p); p = rot2(0.6) * p * 2.03 + 11.0; a *= 0.5; } return s / 0.984; }
vec3 pal(float h) {
  // the phase palettes: night (violet / indigo), colors (magenta / teal / gold / violet), blue, gold
  vec3 night = mix(vec3(0.16, 0.08, 0.42), vec3(0.05, 0.16, 0.5), h);
  float hh = fract(h * 2.2); vec3 colr = hh < 0.33 ? mix(vec3(1.0, 0.08, 0.5), vec3(0.0, 0.8, 0.85), hh * 3.0) : hh < 0.66 ? mix(vec3(0.0, 0.8, 0.85), vec3(1.0, 0.65, 0.05), hh * 3.0 - 1.0) : mix(vec3(1.0, 0.65, 0.05), vec3(0.55, 0.1, 1.0), hh * 3.0 - 2.0);
  vec3 blue = mix(vec3(0.02, 0.18, 0.85), vec3(0.1, 0.6, 1.0), h);
  vec3 gold = mix(vec3(1.0, 0.36, 0.02), vec3(1.0, 0.78, 0.32), h * h);
  vec3 c = mix(night, colr, uC);
  c = mix(c, blue, uB);
  return mix(c, gold, uG);
}
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.7778, 1.0);
  vec3 col = mix(vec3(0.004, 0.004, 0.016), vec3(0.01, 0.012, 0.04), vUv.y);
  col = mix(col, vec3(0.02, 0.01, 0.002), uG);
  // three sheets of gas at three depths, moving up at their own speeds (we fall)
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float depth = 0.35 + 0.45 * fk;
    vec2 q = p * (1.6 - 0.35 * fk) + vec2(fk * 7.3, -uD * depth * 1.15);
    vec2 w = vec2(fb(q * 0.7 + 3.0 + fk), fb(q * 0.7 + 9.0 - fk)) - 0.5;
    float n = fb(q + w * 1.4);
    float dens = smoothstep(0.42, 0.85, n);
    float hue = fb(q * 0.5 + 21.0 + fk * 4.0);
    float lit = 0.25 + 0.75 * fb(q * 2.4 + 5.0);
    float sat = 1.0 + 0.6 * uC;
    vec3 pc = pal(hue); pc = max(mix(vec3(dot(pc, vec3(0.33))), pc, sat), 0.0);
    float dd = mix(dens * dens, dens * dens * dens * 1.6, uG);
    vec3 c = pc * dd * lit * (0.55 - 0.12 * fk) * (1.0 + 0.25 * uKick) * (1.0 + 0.6 * uC);
    // dark dust threads in the gas
    float dust = smoothstep(0.55, 0.7, fb(q * 3.0 + 13.0)) * dens;
    col = col * (1.0 - 0.6 * dust) + c * (1.0 - 0.5 * dust);
  }
  // the gold light below we fall toward; it grows into the end
  float below = exp(-length((vUv - vec2(0.5, -0.25)) * vec2(1.4, 1.0)) * mix(3.2, 1.2, uM));
  col += vec3(1.0, 0.62, 0.2) * below * (0.12 * uG + 1.6 * uM * uM);
  fragColor = vec4(col, 1.0);
}`;
export const PHOS: [number, number, number] = [182, 255, 106];
export const GOLD: [number, number, number] = [255, 194, 71];
export const rgba = (c: [number, number, number], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const mix3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] =>
  [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** The gold that fills the frame at the bridge's end and the final chorus's start (same value both sides). */
export const FLARE_OPACITY = 1.05;

/** Path of a rounded-ish 5-point star (outer radius R). */
export function starPath(c: CanvasRenderingContext2D | Path2D, x: number, y: number, R: number, rot = 0, inner = 0.46) {
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? R : R * inner;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
}

export function radial(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: [number, number, number], a: number, hard = 0.0) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(col, a));
  g.addColorStop(0.25 + hard, rgba(col, a * 0.45));
  g.addColorStop(0.6, rgba(col, a * 0.1));
  g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

/** The sticker: phosphor body with a lighter inner face, a darker rim, round joins; `charge` 0..1 brightness. */
export function drawSticker(P: CanvasRenderingContext2D, L: CanvasRenderingContext2D, x: number, y: number, R: number, rot: number, col: [number, number, number], charge = 1, G = 1) {
  P.save();
  P.lineJoin = 'round';
  P.beginPath(); starPath(P, x + R * 0.06, y + R * 0.1, R, rot); P.fillStyle = 'rgba(0,0,0,0.45)'; P.fill();
  P.beginPath(); starPath(P, x, y, R, rot);
  P.fillStyle = rgba(mix3([20, 40, 20], col, 0.75 * charge + 0.1), 1); P.fill();
  P.lineWidth = R * 0.12; P.strokeStyle = rgba(mix3(col, [0, 0, 0], 0.35), 1); P.stroke();
  P.beginPath(); starPath(P, x, y, R * 0.62, rot); P.fillStyle = rgba(mix3(col, [255, 255, 255], 0.55), 0.9 * charge); P.fill();
  P.restore();
  L.save();
  L.globalAlpha = G;
  L.globalCompositeOperation = 'lighter';
  radial(L, x, y, R * 5.5, col, 0.5 * charge);
  radial(L, x, y, R * 1.8, mix3(col, [255, 255, 255], 0.6), 0.7 * charge);
  L.restore();
}


interface Row { st: StrokeText; ox: number; oy: number; sc: number; times: [number, number][]; words: { a: number; b: number; w: number }[]; ch: number[] }
interface LineSet { line: Line; rows: Row[]; kind: number }
type V = { x: number; y: number };

function rowTimes(ws: Line['words']) {
  const times: [number, number][] = [], words: Row['words'] = [], ch: number[] = [];
  let ci = 0;
  ws.forEach((w, wi) => {
    const n = Array.from(w.w).length;
    for (let j = 0; j < n; j++) { times.push([lerp(w.start, w.end, j / n), lerp(w.start, w.end, (j + 1) / n)]); ch.push(wi); }
    words.push({ a: ci, b: ci + n, w: wi });
    ci += n;
    if (wi + 1 < ws.length) { times.push([w.end, ws[wi + 1]!.start]); ch.push(wi); ci++; }
  });
  return { times, words, ch };
}

function headAt(st: StrokeText, len: number): V {
  for (let i = 0; i < st.strokes.length; i++) {
    const s0 = st.startLen[i]!;
    const pts = st.strokes[i]!, L = st.lens[i]!;
    const tot = L[L.length - 1] ?? 0;
    if (pts.length < 2) { if (len <= s0 || i === st.strokes.length - 1) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0 }; continue; }
    if (len <= s0 + tot || i === st.strokes.length - 1) {
      const r = clamp(len - s0, 0, tot);
      let j = 1;
      while (j < pts.length - 1 && L[j]! < r) j++;
      const a = pts[j - 1]!, b = pts[j]!;
      const u = clamp((r - L[j - 1]!) / Math.max(1e-6, L[j]! - L[j - 1]!));
      return { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) };
    }
  }
  return { x: 0, y: 0 };
}

const hsl = (h: number, s = 0.95, l = 0.6) => hslRgb(((h % 360) + 360) % 360, s, l);
const BLUE: [number, number, number] = [90, 160, 255];
const CYAN: [number, number, number] = [120, 230, 255];

export default class PhosFall extends Scene {
  P = new Layer2D();
  L = new Layer2D();
  sets: LineSet[] = [];
  tStart = 0; tEnd = 0;
  tCol = 0; tBlue = 0; tG = 0; tWith = 0; tM = 0;
  bg!: FSPass;
  bgRT = makeRT(W / 2, H / 2);
  sky: { x: number; y: number; d: number; m: number; h: number }[] = [];
  streaks: { x: number; y: number; d: number; l: number; h: number }[] = [];
  debris: { x: number; y: number; d: number; r: number; spin: number; k: number; ph: number }[] = [];

  override init() {
    const { lyrics, start, end } = this.ctx;
    this.tStart = start; this.tEnd = end;
    const lines = lyrics.linesIn(start - 0.2, end + 0.01).filter((l) => l.start >= start - 0.3 && l.end <= end + 0.3);
    const splits = [4, 3, 3, 3];
    lines.forEach((line, li) => {
      const sp = splits[li] ?? Math.ceil(line.words.length / 2);
      const parts = [line.words.slice(0, sp), line.words.slice(sp)].filter((p) => p.length);
      const rows: Row[] = parts.map((ws) => {
        const text = ws.map((w) => w.w).join(' ');
        const st = strokeText(text, 'script', 100);
        const sc = Math.min(1.9, 1300 / st.width) * (li === 3 ? 1.08 : 1);
        const { times, words, ch } = rowTimes(ws);
        return { st, ox: CX - (st.width * sc) / 2, oy: 0, sc, times, words, ch };
      });
      rows.forEach((r, i) => { r.oy = 500 + i * 190; });
      this.sets.push({ line, rows, kind: li });
    });
    const find = (re: RegExp, li = 0) => lines[li]!.words.find((w) => re.test(w.w))!;
    this.tCol = find(/^colors/i, 1).start - 0.15;
    this.tBlue = find(/^blue/i, 1).start - 0.2;
    this.tG = lines[2]!.words[2]!.start - 0.25;
    this.tWith = find(/^with$/i, 0).start;
    this.tM = lines[3]!.start;
    const r = mulberry32(21);
    for (let i = 0; i < 110; i++) this.streaks.push({ x: r() * 2100 - 100, y: r() * 1500, d: 0.15 + r() * 0.85, l: 0.5 + r(), h: r() * 360 });
    for (let i = 0; i < 260; i++) { const d = r(); this.sky.push({ x: r() * 1920, y: r(), d: 0.15 + 0.85 * d * d, m: 0.35 + 0.65 * r(), h: r() }); }
    for (let i = 0; i < 9; i++) this.debris.push({ x: r() * 2000 - 40, y: r() * 1500, d: 0.3 + r() * 0.8, r: 8 + r() * 26, spin: (r() - 0.5) * 6, k: r(), ph: r() * 6 });
    this.bg = new FSPass(SPACE, { uD: { value: 0 }, uT: { value: 0 }, uC: { value: 0 }, uB: { value: 0 }, uG: { value: 0 }, uM: { value: 0 }, uKick: { value: 0 } });

    // (compiled now: the preview must not stall when the bridge comes on)
    prewarm(this.ctx.renderer, [{ scene: this.bg.scene, cam: this.bg.cam }]);
  }

  /** Where the pen (the lead star) is while a row is being written. */
  penAt(i: number, t: number, from: V): V {
    const set = this.sets[i]!;
    const at = (row: Row, len: number) => { const h = headAt(row.st, len); return { x: row.ox + h.x * row.sc + 26, y: row.oy + h.y * row.sc - 34 }; };
    const [r1, r2] = [set.rows[0]!, set.rows[1]];
    const l1 = writtenLength(r1.st, r1.times, t), l2 = r2 ? writtenLength(r2.st, r2.times, t) : 0;
    if (r2 && l2 > 0) return at(r2, l2);
    if (l1 > 0) {
      if (r2 && l1 >= r1.st.total - 0.5) {
        const tEnd1 = r1.times[r1.times.length - 1]![1], tS2 = r2.times[0]![0];
        const q = prog(t, tEnd1, Math.max(tS2, tEnd1 + 0.2), ease.inOutCubic);
        const a = at(r1, r1.st.total), b = at(r2, 0);
        return { x: lerp(a.x, b.x, q), y: lerp(a.y, b.y, q) + Math.sin(q * Math.PI) * 60 };
      }
      return at(r1, l1);
    }
    const q = prog(t, set.line.start - 0.6, set.line.start, ease.inOutCubic);
    const s = at(r1, 0);
    return { x: lerp(from.x, s.x, q), y: lerp(from.y, s.y, q) };
  }

  penCentre(t: number): V {
    const park = { x: CX + Math.sin(t * 0.7) * 20, y: 400 + Math.sin(t * 1.3) * 10 };
    let i = -1;
    this.sets.forEach((s, j) => { if (t >= s.line.start - 0.6) i = j; });
    if (i < 0) return park;
    const prevEnd = i > 0 ? this.penAt(i - 1, 1e9, park) : park;
    const p = this.penAt(i, t, prevEnd);
    return { x: p.x + Math.sin(t * 3.1 + i) * 4, y: p.y + Math.sin(t * 2.3) * 5 };
  }

  /** The two stars: A (phosphor) leads the pen, B (gold) falls beside it, dives on "with you", orbits in the gold. */
  stars(t: number): { A: V; B: V } {
    const c = this.penCentre(t);
    const dive = ease.inOutCubic(prog(t, this.tWith - 0.1, this.tWith + 0.45));
    const lag = 1 - dive;
    const offB = { x: 250 * lag + 120 * (1 - lag), y: -210 * lag + 55 * (1 - lag) };
    const sway = { x: Math.sin(t * 1.9) * 16, y: Math.cos(t * 1.6) * 14 };
    const ok = smoothstep(this.tG - 0.2, this.tG + 0.5, t);
    const phi = (t - this.tG) * 3.4;
    const orb = { x: Math.cos(phi) * 120, y: Math.sin(phi) * 58 };
    const A = { x: c.x + orb.x * ok, y: c.y + orb.y * ok };
    const B = { x: lerp(c.x + offB.x + sway.x, c.x - orb.x, ok), y: lerp(c.y + offB.y + sway.y, c.y - orb.y, ok) };
    return { A, B };
  }

  /** how fast we fall (frame heights per second): a steady fall that gathers speed into the gold */
  private vel(t: number) {
    const k: [number, number][] = [[this.tStart - 1, 0.9], [this.tCol, 1.1], [this.tBlue, 1.25], [this.tG, 1.1], [this.tM, 1.6], [this.tEnd + 1, 2.6]];
    if (t <= k[0]![0]) return k[0]![1];
    for (let i = 1; i < k.length; i++) if (t <= k[i]![0]) return lerp(k[i - 1]![1], k[i]![1], (t - k[i - 1]![0]) / (k[i]![0] - k[i - 1]![0]));
    return k[k.length - 1]![1];
  }
  private distTab: Float64Array = new Float64Array(0);
  /** how far we have fallen since the start (frame heights), integrated once */
  private dist(t: number) {
    const t0 = this.tStart - 1, dt = 1 / 240;
    if (!this.distTab.length) {
      const n = Math.ceil((this.tEnd + 2 - t0) / dt);
      this.distTab = new Float64Array(n + 1);
      for (let i = 1; i <= n; i++) this.distTab[i] = this.distTab[i - 1]! + this.vel(t0 + (i - 0.5) * dt) * dt;
    }
    const x = clamp((t - t0) / dt, 0, this.distTab.length - 1.001), i = Math.floor(x);
    return lerp(this.distTab[i]!, this.distTab[i + 1]!, x - i);
  }

  override render(f: Frame, out: import('three').WebGLRenderTarget): PostOverrides | void {
    const { renderer, comp } = this.ctx;
    const t = f.t, tau = t - this.tStart;
    const P = this.P.ctx, Lc = this.L.ctx;
    const kick = f.a.kick;
    const flare = smoothstep(this.tEnd - 0.75, this.tEnd - 0.04, t) ** 1.6;
    const G = 1 - flare;
    const intro = smoothstep(0, 0.8, tau);
    // the colours of the space we fall through: violet night, then every colour ("through the colors"), the blue,
    // then gold ("golden"), the gold light below growing until it takes the frame
    const sC = smoothstep(this.tCol - 0.3, this.tCol + 0.4, t) * (1 - smoothstep(this.tBlue - 0.2, this.tBlue + 0.4, t));
    const sB = smoothstep(this.tBlue - 0.2, this.tBlue + 0.4, t) * (1 - smoothstep(this.tG - 0.3, this.tG + 0.6, t));
    const sG = smoothstep(this.tG - 0.3, this.tG + 0.9, t);
    const sM = smoothstep(this.tM - 0.2, this.tEnd, t);
    const v = this.vel(t), D = this.dist(t);
    const star = this.stars(t);

    // ---- the space itself (a shader): nebula sheets rushing up past us in depth
    const U = this.bg.u;
    U.uD!.value = D; U.uT!.value = tau;
    U.uC!.value = sC; U.uB!.value = sB; U.uG!.value = sG; U.uM!.value = sM; U.uKick!.value = kick;
    // (the gas is soft: painted at half resolution, scaled up)
    this.bg.render(renderer, this.bgRT);
    comp.draw(renderer, this.bgRT.texture, out, { mode: 'replace' });

    this.P.clear();
    this.L.clear('#000');
    const zoom = 1 + 0.012 * kick + 0.015 * Math.sin(tau * 0.5);
    for (const c of [P, Lc]) { c.save(); c.translate(CX, CY); c.rotate(0.012 * Math.sin(tau * 0.31)); c.scale(zoom, zoom); c.translate(-CX, -CY); }

    Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G;
    // the stars rushing past: crisp points streaked by the speed, in depth; tinted by the space
    const tint: [number, number, number] = mix3(mix3(mix3([175, 200, 255], [255, 235, 245], sC), [140, 190, 255], sB), [255, 225, 160], sG);
    for (const s of this.sky) {
      const H2 = 1180;
      const y = ((s.y * H2 - D * 1080 * s.d * 0.9) % H2 + H2) % H2 - 50;
      const len = Math.max(2, v * 1080 * s.d * 0.018);
      const col = mix3(tint, [255, 255, 255], s.h * 0.6);
      // a motion-blurred star: the bright point leads (at the top: we fall, the stars rise), the trail fades out
      const a = Math.min(1, s.m * intro * (0.35 + 0.65 * s.d)), wd = 0.8 + 1.8 * s.d;
      const g = Lc.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, rgba(col, a)); g.addColorStop(0.25, rgba(col, a * 0.45)); g.addColorStop(1, rgba(col, 0));
      Lc.fillStyle = g; Lc.fillRect(s.x, y, wd, len);
    }
    // a few big near stars sweeping past with a flare
    for (let i = 0; i < 7; i++) {
      const d = 1.6 + 0.6 * hash(i, 61), x = hash(i, 62) * 2000 - 40;
      const y = ((hash(i, 63) * 1500 - D * 1080 * d) % 1500 + 1500) % 1500 - 200;
      const col = mix3(tint, [255, 255, 255], 0.5);
      radial(Lc, x, y, 60, col, 0.5 * intro);
      Lc.fillStyle = rgba(col, 0.55 * intro); Lc.fillRect(x - 1.5, y, 3, Math.max(4, v * 1080 * d * 0.03));
    }
    Lc.restore();
    // sticker debris (the clip's stars) tumbling past
    for (const d of this.debris) {
      const y = ((d.y - D * 1080 * d.d * 1.1) % 1450 + 1450) % 1450 - 120;
      const x = d.x + Math.sin(tau * 0.8 + d.ph) * 24;
      const col = mix3(mix3(mix3(PHOS, [150, 180, 255], d.k), hsl(d.k * 360), sC), GOLD, sG);
      const R = d.r * d.d;
      const rot = d.ph + tau * d.spin * 0.5;
      P.save(); P.globalAlpha = intro * G * (0.35 + 0.5 * d.d);
      P.beginPath(); starPath(P, x, y, R, rot); P.fillStyle = rgba(mix3(col, [20, 30, 40], 0.5), 1); P.fill();
      P.beginPath(); starPath(P, x, y, R * 0.55, rot); P.fillStyle = rgba(col, 0.8); P.fill();
      P.restore();
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; radial(Lc, x, y, R * 3, col, 0.22 * intro * G); Lc.restore();
    }

    // the lyric, written by the lead star
    this.drawLyric(Lc, t, G, sC, sB);

    // the two stars, their trails and the thread of light between them
    const tail = (fn: (tt: number) => V, col: [number, number, number]) => {
      Lc.save(); Lc.globalCompositeOperation = 'lighter';
      for (let k = 1; k <= 22; k++) {
        const p = fn(t - k * 0.03), q = 1 - k / 23;
        Lc.globalAlpha = G * q * q * 0.75;
        radial(Lc, p.x, p.y, 8 + 36 * q, col, 0.85);
      }
      Lc.restore();
    };
    const colA = mix3(mix3([210, 230, 255], PHOS, 0.55), [255, 226, 150], sG);
    const colB = mix3(GOLD, [255, 240, 190], sG * 0.5);
    tail((tt) => this.stars(tt).A, colA);
    tail((tt) => this.stars(tt).B, colB);
    {
      const { A, B } = star;
      const mx = (A.x + B.x) / 2 + Math.sin(t * 2.3) * 18, my = (A.y + B.y) / 2 + 34 + 14 * Math.sin(t * 3.1);
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G; Lc.lineCap = 'round';
      for (const [w, a, col] of [[12, 0.12, colA], [5, 0.3, colB], [2, 0.95, [255, 255, 245]]] as [number, number, [number, number, number]][]) {
        Lc.lineWidth = w; Lc.strokeStyle = rgba(col, a); Lc.beginPath(); Lc.moveTo(A.x, A.y); Lc.quadraticCurveTo(mx, my, B.x, B.y); Lc.stroke();
      }
      Lc.restore();
    }
    const R = 42 * (1 + 0.1 * kick) * (0.4 + 0.6 * intro);
    drawSticker(P, Lc, star.B.x, star.B.y, R * 0.9, -tau * 0.35 + 1, colB, 1, G);
    drawSticker(P, Lc, star.A.x, star.A.y, R, 0.25 * Math.sin(t * 0.9) + tau * 0.25, colA, 1, G);

    for (const c of [P, Lc]) c.restore();
    // the ending: everything pours into one warm gold (chorus 3 starts from gold light)
    if (flare > 0) { Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = 1; Lc.fillStyle = rgba(GOLD, flare); Lc.fillRect(0, 0, 1920, 1080); Lc.restore(); }

    comp.draw(renderer, this.P.upload(), out, { mode: 'normal', opacity: 1 - flare });
    comp.draw(renderer, this.L.upload(), out, { mode: 'add', opacity: FLARE_OPACITY });
    return { bloom: 0.75, bloomThreshold: 0.75, vignette: 0.42, ca: 0.6, grain: 0.04, halation: 0.08 };
  }

  drawLyric(Lc: CanvasRenderingContext2D, t: number, G: number, sP: number, sW: number) {
    Lc.save();
    Lc.globalCompositeOperation = 'lighter';
    Lc.lineCap = 'round'; Lc.lineJoin = 'round';
    this.sets.forEach((set, li) => {
      if (t < set.line.start - 0.7) return;
      const next = this.sets[li + 1];
      const a = (next ? 1 - smoothstep(next.line.start - 0.6, next.line.start - 0.15, t) : 1) * G;
      if (a <= 0) return;
      set.rows.forEach((row, ri) => {
        const len = writtenLength(row.st, row.times, t);
        if (len <= 0) return;
        const bubble = false;
        Lc.save();
        Lc.translate(row.ox, row.oy); Lc.scale(row.sc, row.sc);
        const wsc = 1 / row.sc;
        for (let i = 0; i < row.st.strokes.length; i++) {
          const s0 = row.st.startLen[i]!;
          if (s0 >= len) break;
          const pts = row.st.strokes[i]!, Ls = row.st.lens[i]!;
          const ci = row.st.charOf[i]!;
          const gi = (row.ch[ci] ?? 0) + (ri === 1 ? set.rows[0]!.words.length : 0);
          const tw = row.times[ci]?.[1] ?? t;
          const age = Math.max(0, t - tw);
          const heat = Math.exp(-age / 1.5);
          let c: [number, number, number] = li === 3 ? mix3(GOLD, [255, 236, 170], 0.25) : PHOS;
          if (li === 0) c = mix3([200, 235, 255], PHOS, 0.5);
          if (li === 1) c = ri === 0 ? hsl((ci * 29 + t * 30) + (gi === 2 ? 0 : 120), 0.95, 0.66) : mix3(BLUE, [200, 230, 255], 0.35);
          if (li === 2) c = gi === 2 ? mix3(GOLD, [255, 240, 190], 0.2) : mix3(PHOS, GOLD, 0.4);
          const pen = clamp((len - s0) / Math.max(1, Ls[Ls.length - 1] ?? 1)) < 1 ? 1 : 0;
          const br = a * (0.45 + 0.55 * heat + 0.4 * pen);
          Lc.save();

          const remain = len - s0;
          if (bubble) {
            const sp = 11 * wsc;
            let dd = 0; const tot = Math.min(remain, Ls[Ls.length - 1] ?? 0);
            for (let j = 1; j < pts.length && dd <= tot; j++) {
              const seg = Ls[j]! - Ls[j - 1]!;
              while (dd <= Ls[j]! && dd <= tot) {
                const u = seg > 0 ? (dd - Ls[j - 1]!) / seg : 0;
                const x = lerp(pts[j - 1]!.x, pts[j]!.x, u), y = lerp(pts[j - 1]!.y, pts[j]!.y, u) - (1 - heat) * 12 * wsc * Math.sin(dd * 0.3);
                const r = (5.5 + 2 * Math.sin(dd * 0.7)) * wsc;
                Lc.lineWidth = 2 * wsc; Lc.strokeStyle = rgba(mix3(CYAN, [255, 255, 255], 0.3), 0.8 * br); Lc.beginPath(); Lc.arc(x, y, r, 0, TAU); Lc.stroke();
                Lc.fillStyle = rgba([255, 255, 255], 0.35 * br); Lc.beginPath(); Lc.arc(x - r * 0.3, y - r * 0.3, r * 0.25, 0, TAU); Lc.fill();
                dd += sp;
              }
            }
          } else {
            Lc.beginPath();
            Lc.moveTo(pts[0]!.x, pts[0]!.y);
            let j = 1;
            for (; j < pts.length && Ls[j]! <= remain; j++) Lc.lineTo(pts[j]!.x, pts[j]!.y);
            if (j < pts.length) {
              const p0 = pts[j - 1]!, p1 = pts[j]!, u = (remain - Ls[j - 1]!) / Math.max(1e-6, Ls[j]! - Ls[j - 1]!);
              Lc.lineTo(lerp(p0.x, p1.x, u), lerp(p0.y, p1.y, u));
            }
            for (const [w, k, hot] of [[26, 0.07, 0], [13, 0.16, 0], [6.5, 0.45, 0.2], [3.2, 1, 0.75]] as const) {
              Lc.lineWidth = w * wsc * 1.35;
              Lc.strokeStyle = rgba(mix3(c, [255, 255, 255], hot), Math.min(1, k * br));
              Lc.stroke();
            }
          }
          Lc.restore();
        }
        Lc.restore();
      });
    });
    Lc.restore();
  }
}

export function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
