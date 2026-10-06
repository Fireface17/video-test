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
import { clamp, ease, lerp, mulberry32, prog, smoothstep, TAU } from '../../engine/util';

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
  tPrism = 0; tWater = 0; tG = 0; tWith = 0;
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
    const r = mulberry32(21);
    for (let i = 0; i < 110; i++) this.streaks.push({ x: r() * 2100 - 100, y: r() * 1500, d: 0.15 + r() * 0.85, l: 0.5 + r(), h: r() * 360 });
    for (let i = 0; i < 26; i++) this.debris.push({ x: r() * 2000 - 40, y: r() * 1500, d: 0.3 + r() * 0.8, r: 8 + r() * 26, spin: (r() - 0.5) * 6, k: r(), ph: r() * 6 });
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

  override render(f: Frame, out: import('three').WebGLRenderTarget): PostOverrides | void {
    const { renderer, comp } = this.ctx;
    const t = f.t, tau = t - this.tStart;
    const P = this.P.ctx, Lc = this.L.ctx;
    const kick = f.a.kick, snare = f.a.snare;
    const [tP, tW, tG] = [this.tPrism, this.tWater, this.tG];
    const L4 = this.sets[3]!.line;
    const flare = smoothstep(this.tEnd - 1.15, this.tEnd - 0.04, t) ** 1.6;
    const G = 1 - flare;
    const intro = smoothstep(0, 1.0, tau);
    // phases
    const sP = smoothstep(tP, tP + 0.5, t) * (1 - smoothstep(tW - 0.05, tW + 0.1, t));
    const sW = smoothstep(tW - 0.05, tW + 0.1, t) * (1 - smoothstep(tG, tG + 0.9, t));
    const sG = smoothstep(tG, tG + 1.0, t);
    const molten = smoothstep(L4.start - 0.1, L4.start + 0.5, t);

    // ---- background
    const c3 = (a: [number, number, number], b: [number, number, number], k: number) => mix3(a, b, k);
    let top: [number, number, number] = [6, 8, 30], bot: [number, number, number] = [14, 22, 66];
    const sPr = smoothstep(tP, tP + 0.7, t), sWa = smoothstep(tW - 0.05, tW + 0.1, t), sGo = sG;
    top = c3(top, [8, 6, 26], sPr); bot = c3(bot, [24, 10, 56], sPr);
    top = c3(top, [14, 86, 190], sWa); bot = c3(bot, [3, 16, 78], sWa);
    top = c3(top, [255, 190, 64], sGo * 0.0); bot = c3(bot, [120, 52, 4], sGo);
    this.P.clear('#05060f');
    P.save();
    const bg = P.createLinearGradient(0, 0, 0, 1080);
    bg.addColorStop(0, rgba(top, 1)); bg.addColorStop(1, rgba(bot, 1));
    P.fillStyle = bg; P.fillRect(-400, -400, 2720, 1880);
    P.restore();
    this.L.clear('#000');

    // ---- camera: the frame rocks, kicks shake it
    const rock = (0.035 + 0.02 * sP) * Math.sin(t * 1.25) + 0.012 * Math.sin(t * 3.3) + 0.01 * kick * Math.sin(t * 40);
    const sh = [Math.sin(t * 51) * 9 * kick, Math.cos(t * 47) * 9 * kick];
    const zoom = 1 + 0.025 * kick + 0.02 * Math.sin(t * 0.8);
    for (const c of [P, Lc]) { c.save(); c.translate(CX + sh[0]!, CY + sh[1]!); c.rotate(rock); c.scale(zoom, zoom); c.translate(-CX, -CY); }

    // ---- speed: how far we have fallen
    const dist = 0.8 * tau + 0.12 * tau * tau;
    const star = this.stars(t);
    const hueOf = (x: number) => (x / 1920) * 300;
    const phaseCol = (x: number, h: number): [number, number, number] =>
      sP > 0.5 ? hsl(hueOf(x) + t * 40, 0.9, 0.62) : sW > 0.5 ? mix3(CYAN, [255, 255, 255], 0.3) : sG > 0.5 ? mix3(GOLD, [255, 240, 190], 0.4) : mix3([160, 190, 255], [255, 255, 255], h * 0.001 + 0.2);

    // 1) light behind the frame: prism / water / gold
    Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G;
    // gold rising from below
    if (sG > 0) {
      const rise = prog(t, tG, tG + 2.2, ease.outCubic);
      const topY = lerp(1500, -250, rise) * (1 - molten) + -400 * molten;
      const gg = Lc.createLinearGradient(0, topY, 0, topY + 900);
      gg.addColorStop(0, rgba(GOLD, 0)); gg.addColorStop(0.35, rgba(GOLD, 0.4)); gg.addColorStop(1, rgba([255, 214, 120], 0.6));
      Lc.fillStyle = gg; Lc.fillRect(-400, topY, 2720, 2400);
      // a wavy bright surface line
      Lc.beginPath();
      for (let x = -50; x <= 1970; x += 40) { const y = topY + Math.sin(x * 0.012 + t * 2.4) * 18 + Math.sin(x * 0.031 - t * 3.1) * 8; if (x === -50) Lc.moveTo(x, y); else Lc.lineTo(x, y); }
      Lc.lineWidth = 7; Lc.strokeStyle = rgba([255, 244, 200], 0.7 * (1 - molten)); Lc.stroke();
    }
    if (molten > 0) {
      for (let i = 0; i < 7; i++) {
        const bx = CX + Math.sin(t * 0.7 + i * 1.9) * 720, by = CY + Math.cos(t * 0.9 + i * 2.7) * 380;
        radial(Lc, bx, by, 520 + 120 * Math.sin(t + i), i % 2 ? GOLD : [255, 150, 40], 0.26 * molten);
      }
    }
    // the prism
    if (sP > 0.001) this.prism(Lc, P, t, sP, star);
    // water: light shafts and caustics
    if (sW > 0.001) {
      const wa = sW * (1 - 0.5 * sG);
      for (let i = 0; i < 6; i++) {
        const x = 200 + i * 300 + Math.sin(t * 0.6 + i * 2) * 90;
        const sg = Lc.createLinearGradient(x, 0, x - 160, 1080);
        sg.addColorStop(0, rgba(CYAN, 0.2 * wa)); sg.addColorStop(1, rgba(CYAN, 0));
        Lc.fillStyle = sg; Lc.beginPath(); Lc.moveTo(x - 60, -20); Lc.lineTo(x + 70, -20); Lc.lineTo(x - 80, 1100); Lc.lineTo(x - 300, 1100); Lc.closePath(); Lc.fill();
      }
      Lc.lineWidth = 3;
      for (let i = 0; i < 26; i++) {
        Lc.strokeStyle = rgba(CYAN, (0.07 + 0.05 * Math.sin(t * 2 + i)) * wa);
        Lc.beginPath();
        for (let x = -40; x <= 1960; x += 50) {
          const y = (i * 46 + (t * 30 * (0.5 + (i % 3) * 0.3))) % 1200 - 60 + Math.sin(x * 0.01 + t * 1.6 + i) * 34 + Math.sin(x * 0.027 - t * 2.1 + i * 3) * 16;
          if (x === -40) Lc.moveTo(x, y); else Lc.lineTo(x, y);
        }
        Lc.stroke();
      }
    }
    Lc.restore();

    // 2) speed streaks rushing up, debris tumbling
    const sp = 0.35 + 0.65 * intro;
    Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G; Lc.lineCap = 'round';
    for (const s of this.streaks) {
      const px = 520 * dist * s.d * (1 + 0.5 * kick);
      const len = (40 + 260 * s.d * s.l) * (0.6 + 0.5 * Math.min(1.8, 0.3 + dist * 0.12) + 0.8 * kick);
      const y = 1180 + len - ((s.y + px) % (1180 + len * 2));
      const col = phaseCol(s.x, s.h);
      const a = (0.1 + 0.35 * s.d) * sp * (sW > 0.5 ? 0.45 : 1) * (0.7 + 0.5 * kick);
      Lc.lineWidth = 1 + 2.4 * s.d;
      Lc.strokeStyle = rgba(col, a); Lc.beginPath(); Lc.moveTo(s.x, y); Lc.lineTo(s.x, y + len); Lc.stroke();
      Lc.strokeStyle = rgba(mix3(col, [255, 255, 255], 0.6), a * 1.4); Lc.beginPath(); Lc.moveTo(s.x, y + len * 0.7); Lc.lineTo(s.x, y + len); Lc.stroke();
    }
    Lc.restore();
    for (const d of this.debris) {
      const px = 700 * dist * d.d;
      const y = 1250 - ((d.y + px) % 1450);
      const x = d.x + Math.sin(tau * 1.1 + d.ph) * 30;
      const col = sP > 0.5 ? hsl(d.k * 360) : sW > 0.5 ? CYAN : sG > 0.5 ? GOLD : mix3(PHOS, [140, 170, 255], d.k);
      const rot = d.ph + tau * d.spin;
      const R = d.r * d.d;
      P.save(); P.globalAlpha = intro * G * (0.4 + 0.5 * d.d);
      P.beginPath(); starPath(P, x + 4, y + 6, R, rot); P.fillStyle = 'rgba(0,0,0,0.35)'; P.fill();
      P.beginPath(); starPath(P, x, y, R, rot); P.fillStyle = rgba(mix3(col, [20, 30, 40], 0.45), 1); P.fill();
      P.beginPath(); starPath(P, x, y, R * 0.55, rot); P.fillStyle = rgba(col, 0.8); P.fill();
      P.restore();
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; radial(Lc, x, y, R * 3, col, 0.28 * intro * G); Lc.restore();
    }
    // bubbles (water) and embers (gold)
    if (sW > 0.001 || sG > 0) {
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G;
      for (const b of this.bubbles) {
        const age = t - tW;
        if (age < 0) continue;
        const y = 1250 - ((1250 - b.y) + b.v * age) % 1400 + 0;
        const yy = ((b.y - b.v * age) % 1400 + 1400) % 1400 - 60;
        const x = b.x + Math.sin(t * 1.7 + b.ph) * (10 + b.r * 0.6);
        const al = sW * (1 - sG * 0.8) * smoothstep(0, 0.6, age);
        if (al <= 0.01) continue;
        Lc.lineWidth = 2; Lc.strokeStyle = rgba(CYAN, 0.55 * al); Lc.beginPath(); Lc.arc(x, yy, b.r, 0, TAU); Lc.stroke();
        Lc.fillStyle = rgba([255, 255, 255], 0.5 * al); Lc.beginPath(); Lc.arc(x - b.r * 0.35, yy - b.r * 0.35, b.r * 0.2, 0, TAU); Lc.fill();
        void y;
      }
      for (const e of this.embers) {
        const age = Math.max(0, t - tG);
        const yy = ((e.y - e.v * age) % 1400 + 1400) % 1400 - 60;
        const x = e.x + Math.sin(t * 2 + e.ph) * 24;
        Lc.fillStyle = rgba([255, 220, 130], 0.7 * sG * (0.6 + 0.4 * Math.sin(t * 7 + e.ph)));
        Lc.beginPath(); Lc.arc(x, yy, e.r, 0, TAU); Lc.fill();
      }
      Lc.restore();
    }
    // the splash when they hit the water
    if (t >= tW && t < tW + 1.6) {
      const age = t - tW, o = this.stars(tW).A;
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G;
      for (let k = 0; k < 3; k++) {
        const a2 = age - k * 0.1;
        if (a2 <= 0) continue;
        Lc.lineWidth = 12 - k * 3; Lc.strokeStyle = rgba(k ? CYAN : [255, 255, 255], 0.8 * Math.exp(-a2 / 0.5));
        Lc.beginPath(); Lc.ellipse(o.x, o.y + 50, a2 * 1100, a2 * 330, 0, 0, TAU); Lc.stroke();
      }
      for (const d of this.drops) {
        const x = o.x + Math.cos(d.a) * d.v * age, y = o.y + Math.sin(d.a) * d.v * age + 700 * age * age;
        Lc.fillStyle = rgba([220, 250, 255], 0.9 * Math.exp(-age / 0.6)); Lc.beginPath(); Lc.arc(x, y, d.r, 0, TAU); Lc.fill();
      }
      Lc.fillStyle = rgba([255, 255, 255], 0.55 * Math.exp(-age / 0.12)); Lc.fillRect(-400, -400, 2720, 1880);
      Lc.restore();
    }
    // gold ripples (the second "golden": we surface into molten gold)
    if (molten > 0) {
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G;
      const ctr = this.penCentre(t);
      const au = this.ctx.audio;
      const b0 = Math.floor(au.beatAt(t));
      for (let k = 0; k < 4; k++) {
        const tb = au.timeOfBeat(b0 - k);
        if (tb < L4.start - 0.05) continue;
        const age = t - tb;
        Lc.lineWidth = 10 * Math.exp(-age / 0.8) + 2; Lc.strokeStyle = rgba([255, 230, 150], 0.65 * Math.exp(-age / 0.7));
        Lc.beginPath(); Lc.ellipse(ctr.x, ctr.y, age * 900 + 20, age * 480 + 10, 0, 0, TAU); Lc.stroke();
      }
      Lc.restore();
    }

    // 3) the lyric, written by the trails
    this.drawLyric(Lc, t, G, sP, sW);

    // 4) the two stars, the thread, trails
    const tail = (fn: (tt: number) => V, col: [number, number, number]) => {
      Lc.save(); Lc.globalCompositeOperation = 'lighter';
      for (let k = 1; k <= 22; k++) {
        const p = fn(t - k * 0.03), q = 1 - k / 23;
        Lc.globalAlpha = G * q * q * 0.8;
        radial(Lc, p.x, p.y, 8 + 40 * q, col, 0.9);
      }
      Lc.restore();
    };
    const colA = mix3(PHOS, [255, 226, 150], sG);
    const colB = mix3(GOLD, [255, 240, 190], sG * 0.5);
    tail((tt) => this.stars(tt).A, colA);
    tail((tt) => this.stars(tt).B, colB);
    // thread of light, sagging with the fall
    {
      const { A, B } = star;
      const mx = (A.x + B.x) / 2 + Math.sin(t * 2.3) * 24, my = (A.y + B.y) / 2 + 40 + 20 * Math.sin(t * 3.1);
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G; Lc.lineCap = 'round';
      for (const [w, a, col] of [[14, 0.12, colA], [6, 0.3, colB], [2.2, 0.95, [255, 255, 245]]] as [number, number, [number, number, number]][]) {
        Lc.lineWidth = w; Lc.strokeStyle = rgba(col, a); Lc.beginPath(); Lc.moveTo(A.x, A.y); Lc.quadraticCurveTo(mx, my, B.x, B.y); Lc.stroke();
      }
      Lc.restore();
    }
    const R = 44 * (1 + 0.14 * kick) * (0.4 + 0.6 * intro);
    drawSticker(P, Lc, star.B.x, star.B.y, R * 0.92, -tau * 0.5 + 1, colB, 1, G);
    drawSticker(P, Lc, star.A.x, star.A.y, R, Math.sin(t * 1.1) * 0.35 + tau * 0.35, colA, 1, G);
    if (sG > 0) { Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * 0.5 * sG; radial(Lc, star.A.x, star.A.y, 1100, GOLD, 0.5); Lc.restore(); }
    // snare flash on hits
    if (snare > 0.05) { Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * 0.12 * snare * intro; Lc.fillStyle = rgba(sG > 0.5 ? GOLD : [200, 220, 255], 1); Lc.fillRect(-400, -400, 2720, 1880); Lc.restore(); }

    for (const c of [P, Lc]) c.restore();
    // the ending: everything pours into one warm gold (phos-final starts on exactly this)
    if (flare > 0) { Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = 1; Lc.fillStyle = rgba(GOLD, flare); Lc.fillRect(0, 0, 1920, 1080); Lc.restore(); }

    clearRT(renderer, out, [0, 0, 0], 1);
    comp.draw(renderer, this.P.upload(), out, { mode: 'normal', opacity: 1 - flare });
    comp.draw(renderer, this.L.upload(), out, { mode: 'add', opacity: FLARE_OPACITY });
    return { bloom: 0.8, vignette: 0.35, ca: 0.8 + 1.5 * snare, grain: 0.05 };
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
    const bs = { x: -300, y: e0.y + 120 + 40 * Math.sin(t * 2) };
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
      gr.addColorStop(0, rgba(col, 0.9 * k)); gr.addColorStop(0.5, rgba(col, 0.42 * k)); gr.addColorStop(1, rgba(col, 0.2 * k));
      Lc.fillStyle = gr;
      Lc.beginPath(); Lc.moveTo(e1.x, e1.y); Lc.lineTo(e1.x + Math.cos(a0) * L, e1.y + Math.sin(a0) * L); Lc.lineTo(e1.x + Math.cos(a1) * L, e1.y + Math.sin(a1) * L); Lc.closePath(); Lc.fill();
    }
    radial(Lc, e1.x, e1.y, 380, [255, 255, 255], 0.8 * k);
    Lc.restore();
    void star;
  }

  drawLyric(Lc: CanvasRenderingContext2D, t: number, G: number, sP: number, sW: number) {
    Lc.save();
    Lc.globalCompositeOperation = 'lighter';
    Lc.lineCap = 'round'; Lc.lineJoin = 'round';
    this.sets.forEach((set, li) => {
      if (t < set.line.start - 0.7) return;
      const next = this.sets[li + 1];
      const lift = next ? ease.inOutCubic(clamp((t - (next.line.start - 0.3)) / 0.8)) : 0;
      const gone = li + 2 < this.sets.length ? t > this.sets[li + 2]!.line.start - 0.3 : false;
      const a = gone ? 0 : lerp(1, 0.38, lift) * G;
      if (a <= 0) return;
      set.rows.forEach((row, ri) => {
        const len = writtenLength(row.st, row.times, t);
        if (len <= 0) return;
        const bubble = li === 1 && ri === 1;
        Lc.save();
        Lc.translate(row.ox, row.oy - lift * 330); Lc.scale(row.sc, row.sc);
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
          const tum = Math.exp(-age / 0.45);
          let c: [number, number, number] = li === 3 ? mix3(GOLD, [255, 236, 170], 0.25) : PHOS;
          if (li === 0) c = mix3([200, 235, 255], PHOS, 0.5);
          if (li === 1) c = ri === 0 ? hsl((ci * 29 + t * 30) + (gi === 2 ? 0 : 120), 0.95, 0.62) : BLUE;
          if (li === 2) c = gi === 2 ? mix3(GOLD, [255, 240, 190], 0.2) : mix3(PHOS, GOLD, 0.4);
          const pen = clamp((len - s0) / Math.max(1, Ls[Ls.length - 1] ?? 1)) < 1 ? 1 : 0;
          const br = a * (0.45 + 0.55 * heat + 0.4 * pen);
          Lc.save();
          if (tum > 0.02 && pts[0]) {
            Lc.translate(pts[0].x, pts[0].y);
            Lc.rotate(0.9 * tum * Math.sin(ci * 2.3));
            Lc.translate(0, 70 * tum * Math.cos(ci * 1.7) * wsc);
            Lc.translate(-pts[0].x, -pts[0].y);
          }
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
