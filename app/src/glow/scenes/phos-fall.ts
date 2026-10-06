// Bridge, "Prism": a fall. Two stars, the phosphor sticker and a gold one, fall side by side tied by a thread of
// light (speed streaks and sticker debris rush up past us, the frame rocks); the words are written by their
// trails. "Through the colors": they plunge through a giant glass prism and white light fans out as a rainbow;
// "and the blue": into deep water (splash, bubbles, caustics, words written in bubbles); "golden": gold
// rises from below, the stars spiral round each other, and the second time they surface into molten gold,
// which floods the frame (phos-final starts on exactly that gold). Pure function of song time (Canvas2D).
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { Layer2D, clearRT } from '../../engine/gl';
import { strokeText, writtenLength, type StrokeText } from '../../engine/stroke';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, mulberry32, prog, smoothstep, TAU } from '../../engine/util';

export const CX = 960, CY = 540;
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
  tPrism = 0; tWater = 0; tG = 0; tWith = 0; tM = 0;
  sky: { x: number; y: number; d: number; m: number; h: number }[] = [];
  streaks: { x: number; y: number; d: number; l: number; h: number }[] = [];
  debris: { x: number; y: number; d: number; r: number; spin: number; k: number; ph: number }[] = [];
  bubbles: { x: number; y: number; r: number; v: number; ph: number }[] = [];
  embers: { x: number; y: number; v: number; r: number; ph: number }[] = [];
  drops: { a: number; v: number; r: number }[] = [];

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
    this.tPrism = find(/^through/i, 1).start - 0.35;
    this.tWater = find(/^and$/i, 1).start;
    this.tG = lines[2]!.words[2]!.start - 0.25;
    this.tWith = find(/^with$/i, 0).start;
    this.tM = lines[3]!.start;
    const r = mulberry32(21);
    for (let i = 0; i < 110; i++) this.streaks.push({ x: r() * 2100 - 100, y: r() * 1500, d: 0.15 + r() * 0.85, l: 0.5 + r(), h: r() * 360 });
    for (let i = 0; i < 260; i++) { const d = r(); this.sky.push({ x: r() * 1920, y: r(), d: 0.15 + 0.85 * d * d, m: 0.35 + 0.65 * r(), h: r() }); }
    for (let i = 0; i < 9; i++) this.debris.push({ x: r() * 2000 - 40, y: r() * 1500, d: 0.3 + r() * 0.8, r: 8 + r() * 26, spin: (r() - 0.5) * 6, k: r(), ph: r() * 6 });
    for (let i = 0; i < 80; i++) this.bubbles.push({ x: r() * 1920, y: r() * 1300, r: 4 + r() * r() * 34, v: 60 + r() * 220, ph: r() * 6 });
    for (let i = 0; i < 70; i++) this.embers.push({ x: r() * 1920, y: r() * 1300, v: 90 + r() * 330, r: 2 + r() * 5, ph: r() * 6 });
    for (let i = 0; i < 44; i++) this.drops.push({ a: -Math.PI * (0.1 + 0.8 * r()), v: 300 + r() * 900, r: 2 + r() * 5 });
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

  /** how fast we fall (frame heights per second; negative: rising) */
  private vel(t: number) {
    const k: [number, number][] = [[this.tStart - 1, 1.0], [this.tPrism, 1.3], [this.tWater, 1.7], [this.tWater + 0.7, 0.12], [this.tG, 0.08], [this.tG + 1.4, -0.42], [this.tM - 0.2, -0.6], [this.tM + 0.35, -1.5], [this.tEnd + 1, -0.9]];
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
    const [tP, tW, tG, tM] = [this.tPrism, this.tWater, this.tG, this.tM];
    const flare = smoothstep(this.tEnd - 1.15, this.tEnd - 0.04, t) ** 1.6;
    const G = 1 - flare;
    const intro = smoothstep(0, 0.8, tau);
    const sP = smoothstep(tP, tP + 0.35, t) * (1 - smoothstep(tW - 0.05, tW + 0.08, t));
    const sW = smoothstep(tW - 0.05, tW + 0.08, t);
    const sG = smoothstep(tG, tG + 1.6, t);
    const ySurf = lerp(-80, 1250, prog(t, tM - 0.12, tM + 0.32, ease.inCubic));   // the surface passing down the frame as we rise through it
    const sM = t > tM - 0.12 ? 1 : 0;
    const v = this.vel(t), D = this.dist(t);
    const star = this.stars(t);

    // ---- background (paper layer): night, the prism's dark, deep water, gold from above; the sky once surfaced
    this.P.clear('#020309');
    const grad = (top: [number, number, number], bot: [number, number, number], y0 = 0, y1 = 1080) => {
      const g = P.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, rgba(top, 1)); g.addColorStop(1, rgba(bot, 1)); return g;
    };
    let top: [number, number, number] = [3, 4, 16], bot: [number, number, number] = [10, 14, 44];
    top = mix3(top, [4, 3, 12], sP); bot = mix3(bot, [9, 6, 22], sP);
    top = mix3(top, [8, 52, 128], sW); bot = mix3(bot, [1, 7, 30], sW);
    top = mix3(top, [12, 30, 70], sG); top = mix3(top, [120, 60, 10], sG * sG * sG); bot = mix3(bot, [2, 7, 24], sG);
    P.fillStyle = grad(top, bot); P.fillRect(0, 0, 1920, 1080);
    if (sM && ySurf > 0) {
      // above the surface: a warm sky, darker high up, glowing toward the water below
      P.fillStyle = grad([40, 16, 3], [214, 120, 26], 0, 1080);
      P.fillRect(0, 0, 1920, Math.min(1080, ySurf));
    }
    this.L.clear('#000');

    // ---- camera: no rocking; a slow drift with the pen and a breath on the beat
    const zoom = 1 + 0.012 * kick + 0.015 * Math.sin(tau * 0.5);
    for (const c of [P, Lc]) { c.save(); c.translate(CX, CY); c.rotate(0.012 * Math.sin(tau * 0.31)); c.scale(zoom, zoom); c.translate(-CX, -CY); }

    Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G;
    // 1) the stars rushing past (falling): crisp points, streaked by the speed, in depth
    const air = (1 - sW) * intro;
    if (air > 0.01) {
      for (const s of this.sky) {
        const H2 = 1180;
        const y = ((s.y * H2 - D * 1080 * s.d * 0.9) % H2 + H2) % H2 - 50;
        const len = Math.max(1.5, Math.abs(v) * 1080 * s.d * 0.018);
        const col = mix3([170, 200, 255], [255, 240, 220], s.h);
        Lc.fillStyle = rgba(col, Math.min(1, s.m * air * (0.35 + 0.65 * s.d)));
        Lc.fillRect(s.x, y - (v > 0 ? 0 : len), 0.8 + 1.8 * s.d, len);
      }
    }
    // the prism
    if (sP > 0.001) this.prism(Lc, P, t, sP, star);
    // 2) water: shafts of light from the surface, caustics, bubbles, motes
    const wet = sW * (1 - sM * smoothstep(tM - 0.1, tM + 0.3, t));
    if (wet > 0.01) {
      const shaftCol = mix3([110, 210, 255], GOLD, sG);
      // shafts of light fanning down from the bright window of the surface above
      const wx = CX + 140 * Math.sin(t * 0.21), wy = -260;
      for (let i = 0; i < 11; i++) {
        const a = Math.PI / 2 + (i - 5) * 0.13 + 0.03 * Math.sin(t * 0.6 + i * 1.7);
        const hw = 0.012 + 0.018 * hash(i, 41);
        const len = 1700;
        const sg = Lc.createLinearGradient(wx, wy, wx + Math.cos(a) * len, wy + Math.sin(a) * len);
        sg.addColorStop(0.1, rgba(shaftCol, (0.2 + 0.2 * sG) * wet * (0.5 + 0.5 * hash(i, 42)))); sg.addColorStop(1, rgba(shaftCol, 0));
        Lc.fillStyle = sg; Lc.beginPath(); Lc.moveTo(wx, wy); Lc.lineTo(wx + Math.cos(a - hw) * len, wy + Math.sin(a - hw) * len); Lc.lineTo(wx + Math.cos(a + hw) * len, wy + Math.sin(a + hw) * len); Lc.closePath(); Lc.fill();
      }
      // Snell's window: the sky seen from below, a bright ellipse of light up at the surface
      {
        const wc = mix3([170, 230, 255], [255, 220, 140], sG);
        Lc.save(); Lc.translate(wx, 10); Lc.scale(1, 0.22);
        const wg = Lc.createRadialGradient(0, 0, 0, 0, 0, 1000);
        wg.addColorStop(0, rgba(wc, (0.35 + 0.5 * sG) * wet)); wg.addColorStop(0.55, rgba(wc, (0.18 + 0.25 * sG) * wet)); wg.addColorStop(0.62, rgba(wc, 0.04 * wet)); wg.addColorStop(1, rgba(wc, 0));
        Lc.fillStyle = wg; Lc.fillRect(-1000, -1000, 2000, 2000);
        Lc.restore();
      }
      // caustic net near the surface
      Lc.lineWidth = 2.2;
      for (let i = 0; i < 18; i++) {
        Lc.strokeStyle = rgba(mix3([140, 225, 255], [255, 220, 140], sG), (0.05 + 0.04 * Math.sin(t * 2 + i)) * wet * (1 + 1.5 * sG));
        Lc.beginPath();
        for (let x = -40; x <= 1960; x += 40) {
          const y = 30 + i * 22 + Math.sin(x * 0.011 + t * 1.6 + i) * 18 + Math.sin(x * 0.029 - t * 2.1 + i * 3) * 9;
          if (x === -40) Lc.moveTo(x, y); else Lc.lineTo(x, y);
        }
        Lc.stroke();
      }
      // the bright gold surface above, once the light up there turns gold
      if (sG > 0) {
        const gg = Lc.createLinearGradient(0, -40, 0, 420);
        gg.addColorStop(0, rgba([255, 214, 130], 0.55 * sG * wet)); gg.addColorStop(0.3, rgba(GOLD, 0.18 * sG * wet)); gg.addColorStop(1, rgba(GOLD, 0));
        Lc.fillStyle = gg; Lc.fillRect(-400, -40, 2720, 460);
      }
      const age = t - tW;
      for (const b of this.bubbles) {
        if (age < 0) break;
        const yy = ((b.y - b.v * age) % 1400 + 1400) % 1400 - 60;
        const x = b.x + Math.sin(t * 1.7 + b.ph) * (10 + b.r * 0.6);
        const al = wet * smoothstep(0, 0.6, age);
        const bc = mix3([170, 235, 255], [255, 225, 150], sG);
        Lc.lineWidth = 1.6; Lc.strokeStyle = rgba(bc, 0.5 * al); Lc.beginPath(); Lc.arc(x, yy, b.r, 0, TAU); Lc.stroke();
        Lc.fillStyle = rgba([255, 255, 255], 0.45 * al); Lc.beginPath(); Lc.arc(x - b.r * 0.35, yy - b.r * 0.35, b.r * 0.2, 0, TAU); Lc.fill();
      }
    }
    // the splash when they hit the water
    if (t >= tW && t < tW + 1.6) {
      const age = t - tW, o = this.stars(tW).A;
      for (let k = 0; k < 3; k++) {
        const a2 = age - k * 0.1;
        if (a2 <= 0) continue;
        Lc.lineWidth = 10 - k * 3; Lc.strokeStyle = rgba(k ? [140, 220, 255] : [255, 255, 255], 0.75 * Math.exp(-a2 / 0.5));
        Lc.beginPath(); Lc.ellipse(o.x, o.y + 50, a2 * 1100, a2 * 330, 0, 0, TAU); Lc.stroke();
      }
      for (const d of this.drops) {
        const x = o.x + Math.cos(d.a) * d.v * age, y = o.y + Math.sin(d.a) * d.v * age + 700 * age * age;
        Lc.fillStyle = rgba([220, 250, 255], 0.9 * Math.exp(-age / 0.6)); Lc.beginPath(); Lc.arc(x, y, d.r, 0, TAU); Lc.fill();
      }
      Lc.fillStyle = rgba([200, 235, 255], 0.35 * Math.exp(-age / 0.1)); Lc.fillRect(-400, -400, 2720, 1880);
    }
    // 3) rising: gold embers come up with us
    if (sG > 0.01) {
      const age = Math.max(0, t - tG);
      for (const e of this.embers) {
        const yy = ((e.y - e.v * age * (1 + sM * 1.5)) % 1400 + 1400) % 1400 - 60;
        const x = e.x + Math.sin(t * 1.3 + e.ph) * 18;
        Lc.fillStyle = rgba([255, 214, 130], 0.75 * sG * (0.55 + 0.45 * Math.sin(t * 5 + e.ph)));
        Lc.beginPath(); Lc.arc(x, yy, e.r * 0.8, 0, TAU); Lc.fill();
      }
    }
    // 4) surfacing: the bright line of the surface sweeps down past us; then the gold sea glitters below
    if (sM) {
      if (ySurf > -40 && ySurf < 1130) {
        const sl = Lc.createLinearGradient(0, ySurf - 60, 0, ySurf + 60);
        sl.addColorStop(0, rgba(GOLD, 0)); sl.addColorStop(0.5, rgba([255, 244, 210], 0.95)); sl.addColorStop(1, rgba(GOLD, 0));
        Lc.fillStyle = sl; Lc.fillRect(-400, ySurf - 60, 2720, 120);
      }
      const hz = lerp(1250, 930, prog(t, tM + 0.25, this.tEnd, ease.outCubic));
      if (hz < 1080) {
        Lc.fillStyle = rgba([255, 236, 190], 0.8); Lc.fillRect(-400, hz - 1, 2720, 2);
        for (let i = 0; i < 90; i++) {
          const gy = hz + 6 + Math.pow(hash(i, 1), 1.6) * 200;
          const gx = hash(i, 2) * 2100 - 90 + Math.sin(t * 0.7 + i) * 10;
          const tw = Math.pow(0.5 + 0.5 * Math.sin(t * (3 + 4 * hash(i, 3)) + i), 3);
          const w = 6 + 50 * hash(i, 4) * (1 - (gy - hz) / 260);
          Lc.fillStyle = rgba([255, 226, 150], 0.85 * tw); Lc.fillRect(gx, gy, w, 2);
        }
      }
      radial(Lc, CX, 1080, 1100, [255, 170, 50], 0.35);
      // the sun high above, out of frame: long soft beams across the gold air
      const up = smoothstep(tM, tM + 0.6, t);
      for (let i = 0; i < 7; i++) {
        const ox = -300 + 260 * i, a = 1.05 + 0.04 * i + 0.02 * Math.sin(t * 0.4 + i), hw = 0.03 + 0.03 * hash(i, 51), len = 2600;
        const g = Lc.createLinearGradient(ox, -200, ox + Math.cos(a) * len, -200 + Math.sin(a) * len);
        g.addColorStop(0, rgba([255, 230, 170], 0.16 * up)); g.addColorStop(1, rgba(GOLD, 0));
        Lc.fillStyle = g; Lc.beginPath(); Lc.moveTo(ox, -200); Lc.lineTo(ox + Math.cos(a - hw) * len, -200 + Math.sin(a - hw) * len); Lc.lineTo(ox + Math.cos(a + hw) * len, -200 + Math.sin(a + hw) * len); Lc.closePath(); Lc.fill();
      }
    }
    // sticker debris in the fall (the clip's stars, tumbling past)
    Lc.restore();
    if (air > 0.01) for (const d of this.debris) {
      const y = ((d.y - D * 1080 * d.d * 1.1) % 1450 + 1450) % 1450 - 120;
      const x = d.x + Math.sin(tau * 0.8 + d.ph) * 24;
      const col = sP > 0.5 ? hsl(d.k * 360) : mix3(PHOS, [150, 180, 255], d.k);
      const R = d.r * d.d;
      const rot = d.ph + tau * d.spin * 0.5;
      P.save(); P.globalAlpha = air * G * (0.35 + 0.5 * d.d);
      P.beginPath(); starPath(P, x, y, R, rot); P.fillStyle = rgba(mix3(col, [20, 30, 40], 0.5), 1); P.fill();
      P.beginPath(); starPath(P, x, y, R * 0.55, rot); P.fillStyle = rgba(col, 0.8); P.fill();
      P.restore();
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; radial(Lc, x, y, R * 3, col, 0.22 * air * G); Lc.restore();
    }

    // 5) the lyric, written by the lead star
    this.drawLyric(Lc, t, G, sP, sW);

    // 6) the two stars, their trails and the thread between them
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
    // the ending: everything pours into one warm gold (phos-final starts on exactly this)
    if (flare > 0) { Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = 1; Lc.fillStyle = rgba(GOLD, flare); Lc.fillRect(0, 0, 1920, 1080); Lc.restore(); }

    clearRT(renderer, out, [0, 0, 0], 1);
    comp.draw(renderer, this.P.upload(), out, { mode: 'normal', opacity: 1 - flare });
    comp.draw(renderer, this.L.upload(), out, { mode: 'add', opacity: FLARE_OPACITY });
    return { bloom: 0.7, bloomThreshold: 0.75, vignette: 0.42, ca: 0.6, grain: 0.04, halation: 0.08 };
  }

  /** A giant glass prism we plunge through: white light in, a sweeping rainbow fan out. */
  prism(Lc: CanvasRenderingContext2D, P: CanvasRenderingContext2D, t: number, k: number, star: { A: V; B: V }) {
    const tP = this.tPrism, tW = this.tWater;
    const s = prog(t, tP, tW + 0.15, ease.inQuad);
    const R = lerp(150, 2300, s ** 1.5);
    const cx = CX + (1 - s) * 0, cy = CY + 30;
    const tri: V[] = [0, 1, 2].map((i) => ({ x: cx + Math.cos(-Math.PI / 2 + (i * TAU) / 3) * R, y: cy + Math.sin(-Math.PI / 2 + (i * TAU) / 3) * R }));
    // glass body
    P.save(); P.globalAlpha = k * 0.9;
    P.beginPath(); P.moveTo(tri[0]!.x, tri[0]!.y); P.lineTo(tri[1]!.x, tri[1]!.y); P.lineTo(tri[2]!.x, tri[2]!.y); P.closePath();
    const gl = P.createLinearGradient(tri[2]!.x, tri[2]!.y, tri[1]!.x, tri[0]!.y);
    gl.addColorStop(0, 'rgba(120,150,255,0.30)'); gl.addColorStop(0.5, 'rgba(210,230,255,0.16)'); gl.addColorStop(1, 'rgba(150,100,255,0.28)');
    P.fillStyle = gl; P.fill();
    P.restore();
    Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = k; Lc.lineJoin = 'miter';
    for (const [w, a, o] of [[18, 0.1, 0], [7, 0.3, 0], [2.5, 0.95, 0], [2, 0.4, 0.07]] as const) {
      Lc.lineWidth = w; Lc.strokeStyle = rgba([225, 240, 255], a);
      Lc.beginPath();
      const m = 1 - o;
      const cc = { x: cx, y: cy + R * 0.0 };
      tri.forEach((p, i) => { const x = cc.x + (p.x - cc.x) * m, y = cc.y + (p.y - cc.y) * m; if (i) Lc.lineTo(x, y); else Lc.moveTo(x, y); });
      Lc.closePath(); Lc.stroke();
    }
    // white beam in from the left, to the left edge
    const e0 = { x: lerp(tri[0]!.x, tri[2]!.x, 0.42), y: lerp(tri[0]!.y, tri[2]!.y, 0.42) };
    const e1 = { x: lerp(tri[0]!.x, tri[1]!.x, 0.5), y: lerp(tri[0]!.y, tri[1]!.y, 0.5) };
    const bs = star.A;
    for (const [w, a] of [[40, 0.12], [14, 0.35], [4, 1]] as const) { Lc.lineWidth = w; Lc.strokeStyle = rgba([255, 255, 255], a * k); Lc.beginPath(); Lc.moveTo(bs.x, bs.y); Lc.lineTo(e0.x, e0.y); Lc.lineTo(e1.x, e1.y); Lc.stroke(); }
    // dispersion fan
    const sweep = Math.sin(t * 2.2) * 0.14 + (t - tP) * 0.05;
    const base = 0.05 + sweep;
    const spread = 0.085 * (0.7 + 0.5 * Math.min(1, s * 2));
    for (let i = 0; i < 7; i++) {
      const hue = [0, 28, 55, 120, 190, 235, 285][i]!;
      const a0 = base - spread * 3.5 + i * spread, a1 = a0 + spread * 1.02;
      const col = hsl(hue, 1, 0.58);
      const L = 3600;
      const gr = Lc.createLinearGradient(e1.x, e1.y, e1.x + Math.cos((a0 + a1) / 2) * L, e1.y + Math.sin((a0 + a1) / 2) * L);
      gr.addColorStop(0, rgba(col, 0.8 * k)); gr.addColorStop(0.45, rgba(col, 0.3 * k)); gr.addColorStop(1, rgba(col, 0.04 * k));
      Lc.fillStyle = gr;
      Lc.beginPath(); Lc.moveTo(e1.x, e1.y); Lc.lineTo(e1.x + Math.cos(a0) * L, e1.y + Math.sin(a0) * L); Lc.lineTo(e1.x + Math.cos(a1) * L, e1.y + Math.sin(a1) * L); Lc.closePath(); Lc.fill();
    }
    radial(Lc, e1.x, e1.y, 300, [255, 255, 255], 0.55 * k);
    Lc.restore();
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
        const bubble = li === 1 && ri === 1;
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
          if (li === 1) c = ri === 0 ? hsl((ci * 29 + t * 30) + (gi === 2 ? 0 : 120), 0.95, 0.62) : BLUE;
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
