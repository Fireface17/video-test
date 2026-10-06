// Bridge, "phosphor" edition: a vertical FALL through layers of cut coloured paper. Every sheet is a
// shadow-box layer (two papers, a torn/scissor-cut hole, punched-out stars, grain, a soft shadow on the
// paper beneath), lit only by the sticker star that falls with us. The star writes the lyric in light as it
// falls (single-stroke script, per-word colours: phosphor -> rainbow "colors" -> deep "blue" -> gold),
// and on "golden" gold spreads from the star over every sheet; the frame ends in warm gold, which is where
// the final chorus (phos-final) begins.
// Everything is a pure function of song time (Canvas2D layers: paper = normal, light = additive HDR).
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { Layer2D, clearRT } from '../../engine/gl';
import { strokeText, writtenLength, type StrokeText } from '../../engine/stroke';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, lerp, mulberry32, prog, smoothstep } from '../../engine/util';

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

/** Char times of a row of words: each char is written while its word is sung, spaces in the gaps. */
function rowTimes(ws: Line['words']): { times: [number, number][]; words: Row['words']; ch: number[] } {
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

function headAt(st: StrokeText, len: number): { x: number; y: number } {
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

interface Sheet { k: number; d: number; T: number; cols: { top: string; under: string; gold: boolean }; h: [number, number]; R: number; hole: [number, number][]; hole2: [number, number][]; punch: { x: number; y: number; r: number; a: number }[]; roll: number }
interface Scrap { x: number; y: number; v: number; s: number; rot: number; spin: number; hue: number; sway: number; ph: number; depth: number }

const V0 = 0.7, GG = 0.22; // fall: depth(τ) = V0 τ + GG τ²/2 (units)
const SPACING = 0.9;
const U_MAX = 5.6, U_MIN = 0.27;

export default class PhosFall extends Scene {
  P = new Layer2D();
  L = new Layer2D();
  grain!: CanvasPattern;
  sheets: Sheet[] = [];
  scraps: Scrap[] = [];
  sets: LineSet[] = [];
  tGold = 0; tBlue = 0; tColors = 0;
  tStart = 0; tEnd = 0;

  depthAt(t: number) { const s = Math.max(0, t - this.tStart); return V0 * s + 0.5 * GG * s * s; }
  timeOfDepth(d: number) { return this.tStart + (-V0 + Math.sqrt(V0 * V0 + 2 * GG * d)) / GG; }

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
        let st = strokeText(text, 'script', 100);
        const sc = Math.min(1.75, 1240 / st.width) * (li === 3 ? 1.08 : 1);
        st = strokeText(text, 'script', 100);
        const { times, words, ch } = rowTimes(ws);
        return { st, ox: CX - (st.width * sc) / 2, oy: 0, sc, times, words, ch };
      });
      rows.forEach((r, i) => { r.oy = 500 + i * 190; });
      this.sets.push({ line, rows, kind: li });
    });
    const find = (re: RegExp) => lines.flatMap((l) => l.words).find((w) => re.test(w.w))!;
    this.tColors = find(/colors/i).start;
    this.tBlue = find(/blue/i).start;
    this.tGold = find(/golden/i).start;

    // paper grain tile
    const tile = document.createElement('canvas'); tile.width = tile.height = 256;
    const tc = tile.getContext('2d')!;
    const id = tc.createImageData(256, 256), rnd = mulberry32(5);
    for (let i = 0; i < 256 * 256; i++) {
      const v = rnd(), a = Math.abs(v - 0.5) * 2;
      const w = v > 0.5 ? 255 : 0;
      id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = w; id.data[i * 4 + 3] = a * a * 46;
    }
    tc.putImageData(id, 0, 0);
    tc.lineWidth = 1;
    for (let i = 0; i < 160; i++) {
      const x = rnd() * 256, y = rnd() * 256, a = rnd() * Math.PI, l = 6 + rnd() * 16;
      tc.strokeStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.12)';
      tc.beginPath(); tc.moveTo(x, y); tc.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.5, y + Math.sin(a + 0.5) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); tc.stroke();
    }
    this.grain = this.P.ctx.createPattern(tile, 'repeat')!;

    // the sheets of paper
    const dEnd = this.depthAt(end) + U_MAX + 1;
    const nS = Math.ceil((dEnd - 2.6) / SPACING);
    for (let k = 0; k < nS; k++) {
      const r = mulberry32(100 + k * 31);
      const d = 2.6 + k * SPACING;
      const T = this.timeOfDepth(d);
      const R = 390 + r() * 150;
      const h: [number, number] = [Math.sin(k * 0.83 + 1) * 0.5 * R * (0.5 + r() * 0.5), Math.cos(k * 0.61) * 0.34 * R];
      const poly = (n: number, rr: number, rot: number): [number, number][] => Array.from({ length: n }, (_, i) => {
        const a = rot + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.3;
        const m = rr * (0.74 + r() * 0.42);
        return [h[0] + Math.cos(a) * m, h[1] + Math.sin(a) * m] as [number, number];
      });
      const punch = Array.from({ length: 9 }, () => {
        const a = r() * Math.PI * 2, rad = R * 1.35 + r() * 1100;
        return { x: Math.cos(a) * rad, y: Math.sin(a) * rad * 0.75, r: 16 + r() * 34, a: r() * 6 };
      });
      this.sheets.push({ k, d, T, cols: this.paperCols(k, T, r), h, R, hole: poly(11 + ((r() * 6) | 0), R, r() * 6), hole2: poly(10 + ((r() * 5) | 0), R * 0.8, r() * 6), punch, roll: (r() - 0.5) * 0.08 });
    }
    // falling scraps
    const rs = mulberry32(77);
    for (let i = 0; i < 46; i++) this.scraps.push({ x: rs() * 2200 - 140, y: rs() * 1500, v: 120 + rs() * 520, s: 6 + rs() * 22, rot: rs() * 6, spin: (rs() - 0.5) * 3, hue: rs() * 360, sway: 10 + rs() * 40, ph: rs() * 6, depth: rs() });
  }

  /** Sheet colours by the time it passes the camera: night blue, rainbow, deep blue, gold. */
  paperCols(k: number, T: number, r: () => number) {
    const hsl = (h: number, s: number, l: number) => `hsl(${h % 360} ${s}% ${l}%)`;
    if (T < this.tColors - 0.5) return { top: hsl(224 + r() * 14, 52, 15 + r() * 6), under: hsl(232, 50, 10), gold: false };
    if (T < this.tBlue - 0.15) { const h = (k * 53 + r() * 30) % 360; return { top: hsl(h, 72, 33 + r() * 8), under: hsl(h + 38, 66, 22), gold: false }; }
    if (T < this.tGold) return { top: hsl(218 + r() * 12, 88, 30 + r() * 10), under: hsl(226, 82, 20), gold: false };
    return { top: hsl(39 + r() * 6, 100, 44 + r() * 8), under: hsl(28 + r() * 8, 95, 30), gold: true };
  }

  /** The star's centre at time t (pen head while a row is being written). */
  penAt(i: number, t: number, from: { x: number; y: number }): { x: number; y: number } {
    const set = this.sets[i]!;
    const at = (row: Row, len: number) => { const h = headAt(row.st, len); return { x: row.ox + h.x * row.sc + 26, y: row.oy + h.y * row.sc - 34 }; };
    const [r1, r2] = [set.rows[0]!, set.rows[1]];
    const l1 = writtenLength(r1.st, r1.times, t), l2 = r2 ? writtenLength(r2.st, r2.times, t) : 0;
    const startP = at(r1, 0);
    if (r2 && l2 > 0) return at(r2, l2);
    if (l1 > 0) {
      if (r2 && l1 >= r1.st.total - 0.5) {
        const tEnd1 = r1.times[r1.times.length - 1]![1], tS2 = r2.times[0]![0];
        const q = prog(t, tEnd1, Math.max(tS2, tEnd1 + 0.2), ease.inOutCubic);
        return { x: lerp(at(r1, r1.st.total).x, at(r2, 0).x, q), y: lerp(at(r1, r1.st.total).y, at(r2, 0).y, q) + Math.sin(q * Math.PI) * 60 };
      }
      return at(r1, l1);
    }
    const q = prog(t, set.line.start - 0.6, set.line.start, ease.inOutCubic);
    return { x: lerp(from.x, startP.x, q), y: lerp(from.y, startP.y, q) };
  }

  starPos(t: number): { x: number; y: number } {
    const park = { x: CX + Math.sin(t * 0.7) * 20, y: 380 + Math.sin(t * 1.3) * 10 };
    let i = -1;
    this.sets.forEach((s, j) => { if (t >= s.line.start - 0.6) i = j; });
    if (i < 0) return park;
    const prevEnd = i > 0 ? this.penAt(i - 1, 1e9, park) : park;
    const p = this.penAt(i, t, prevEnd);
    return { x: p.x + Math.sin(t * 3.1 + i) * 4, y: p.y + Math.sin(t * 2.3) * 5 };
  }

  override render(f: Frame, out: import('three').WebGLRenderTarget): PostOverrides | void {
    const { renderer, comp } = this.ctx;
    const t = f.t, tau = t - this.tStart;
    const P = this.P.ctx, Lc = this.L.ctx;
    this.P.clear('#05060f');
    this.L.clear('#000');

    const flare = smoothstep(this.tEnd - 1.15, this.tEnd - 0.04, t) ** 1.6;
    const G = 1 - flare;
    const intro = smoothstep(0.0, 1.5, tau);
    const star = this.starPos(t);
    const goldK = prog(t, this.tGold, this.tGold + 1.7, ease.inOutCubic);
    const goldR = goldK * 1800;
    const starCol = mix3(PHOS, [255, 226, 150], goldK);
    const lightCol = mix3([150, 255, 120], GOLD, goldK);
    const D = this.depthAt(t);
    const camx = (star.x - CX) * 0.22 + Math.sin(t * 0.9) * 26, camy = (star.y - 400) * 0.18;
    const roll = Math.sin(t * 0.55) * 0.035 + Math.sin(t * 1.7) * 0.01;
    const cosR = Math.cos(-roll), sinR = Math.sin(-roll);

    // --- sheets, far to near
    const vis = this.sheets.filter((s) => s.d - D < U_MAX && s.d - D > U_MIN).sort((a, b) => b.d - a.d);
    P.save();
    for (const s of vis) {
      const u = s.d - D, sc = 1 / u;
      const edgeFade = smoothstep(U_MIN, U_MIN + 0.05, u);
      const fog = clamp(1 - Math.exp(-u * 0.34), 0, 0.92);
      // star position in this sheet's space
      const dx = star.x - CX, dy = star.y - CY;
      const sx = (dx * cosR - dy * sinR) / sc + camx, sy = (dx * sinR + dy * cosR) / sc + camy;
      const mk = (hole: [number, number][], punch: boolean) => {
        const p = new Path2D();
        p.rect(-9000, -9000, 18000, 18000);
        p.moveTo(hole[0]![0], hole[0]![1]);
        for (let i = 1; i < hole.length; i++) p.lineTo(hole[i]![0], hole[i]![1]);
        p.closePath();
        if (punch) for (const q of s.punch) starPath(p, q.x, q.y, q.r, q.a);
        return p;
      };
      const holeOnly = (hole: [number, number][]) => {
        const p = new Path2D();
        p.moveTo(hole[0]![0], hole[0]![1]);
        for (let i = 1; i < hole.length; i++) p.lineTo(hole[i]![0], hole[i]![1]);
        p.closePath();
        return p;
      };
      const light = clamp(0.95 * Math.exp(-Math.max(0, u - 0.8) * 0.42), 0.06, 0.95) * intro;
      const drawPaper = (hole: [number, number][], top: string, punch: boolean, isTop: boolean) => {
        const path = mk(hole, punch), hp = holeOnly(hole);
        P.save();
        P.translate(CX, CY); P.rotate(roll + s.roll * (1 - 1 / (1 + sc))); P.scale(sc, sc); P.translate(-camx, -camy);
        // the shadow this paper throws into its own hole, onto the layers beneath
        P.save();
        P.clip(hp);
        P.lineJoin = 'round';
        P.translate(0, 16 + 6 * sc);
        for (const [w, a] of [[110, 0.09], [64, 0.1], [34, 0.12], [14, 0.16]] as const) { P.lineWidth = w; P.strokeStyle = `rgba(0,0,6,${a * (isTop ? 1 : 0.7)})`; P.stroke(hp); }
        P.restore();
        P.globalAlpha = edgeFade;
        P.fillStyle = top; P.fill(path, 'evenodd');
        if (s.cols.gold || goldK > 0) {
          const gcol = isTop ? 'hsl(41 100% 49%)' : 'hsl(27 94% 33%)';
          if (s.cols.gold) { P.fillStyle = gcol; P.fill(path, 'evenodd'); }
          else if (goldR > 0) {
            P.save(); P.beginPath(); P.arc(sx, sy, goldR / sc, 0, Math.PI * 2); P.clip();
            P.fillStyle = gcol; P.fill(path, 'evenodd'); P.restore();
          }
        }
        P.fillStyle = this.grain; P.globalAlpha = edgeFade * (isTop ? 0.9 : 0.7); P.fill(path, 'evenodd');
        P.globalAlpha = edgeFade * fog; P.fillStyle = 'rgb(5,6,15)'; P.fill(path, 'evenodd');
        // the star's light on the paper
        P.save(); P.clip(path, 'evenodd');
        P.globalCompositeOperation = 'lighter'; P.globalAlpha = edgeFade;
        const rl = (isTop ? 1000 : 800) / sc;
        const g = P.createRadialGradient(sx, sy, 0, sx, sy, rl);
        g.addColorStop(0, rgba(lightCol, 0.5 * light)); g.addColorStop(0.35, rgba(lightCol, 0.18 * light)); g.addColorStop(1, rgba(lightCol, 0));
        P.fillStyle = g; P.fillRect(-9000, -9000, 18000, 18000);
        P.restore();
        // cut edge: the paper's thickness catches the light
        P.globalAlpha = edgeFade * (0.25 + 0.7 * light);
        P.lineJoin = 'miter'; P.lineWidth = 2.6; P.strokeStyle = isTop ? 'rgba(255,248,230,0.55)' : 'rgba(255,240,220,0.35)';
        P.stroke(hp);
        P.restore();
      };
      drawPaper(s.hole2, s.cols.under, false, false);
      drawPaper(s.hole, s.cols.top, true, true);
      // gold shock ring on the light layer
    }
    P.restore();
    // gold front where it spreads from the star
    if (goldK > 0 && goldK < 1) {
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * (1 - goldK * 0.6);
      Lc.lineWidth = 16; Lc.strokeStyle = rgba(GOLD, 0.55); Lc.beginPath(); Lc.arc(star.x, star.y, goldR, 0, Math.PI * 2); Lc.stroke();
      Lc.lineWidth = 5; Lc.strokeStyle = rgba([255, 244, 214], 0.8); Lc.stroke();
      Lc.restore();
    }

    // --- falling scraps (cut-offs), screen-space, vertical streaks of parallax
    for (const c of this.scraps) {
      const speed = c.v * (0.35 + 0.65 * smoothstep(0, 6, tau) + 0.4 * goldK);
      const y = 1180 - (((c.y + speed * tau * 0.6 * (0.6 + c.depth)) % 1400) + 1400) % 1400 + 100;
      const x = c.x + Math.sin(tau * 0.9 + c.ph) * c.sway;
      const a = intro * (0.25 + 0.55 * c.depth);
      const col = tau < this.tColors - this.tStart - 0.5 ? `hsl(228 50% ${24 + c.depth * 14}%)` : t < this.tBlue ? `hsl(${c.hue} 70% ${40 + c.depth * 12}%)` : t < this.tGold ? `hsl(220 85% ${34 + c.depth * 14}%)` : `hsl(42 100% ${52 + c.depth * 10}%)`;
      const sz = c.s * (0.7 + c.depth * 0.9);
      P.save(); P.translate(x, y); P.rotate(c.rot + c.spin * tau); P.globalAlpha = a;
      P.fillStyle = 'rgba(0,0,6,0.4)'; P.beginPath(); P.moveTo(-sz + 4, -sz * 0.6 + 6); P.lineTo(sz + 4, -sz * 0.3 + 6); P.lineTo(sz * 0.4 + 4, sz * 0.8 + 6); P.lineTo(-sz * 0.7 + 4, sz * 0.5 + 6); P.fill();
      P.fillStyle = col; P.beginPath(); P.moveTo(-sz, -sz * 0.6); P.lineTo(sz, -sz * 0.3); P.lineTo(sz * 0.4, sz * 0.8); P.lineTo(-sz * 0.7, sz * 0.5); P.closePath(); P.fill();
      P.fillStyle = this.grain; P.globalAlpha = a * 0.8; P.fill();
      P.restore();
    }

    // --- the lyric, written in light
    const aliveLine = (li: number) => {
      const set = this.sets[li]!;
      const next = this.sets[li + 1];
      const age = next ? t - (next.line.start - 0.3) : -1;
      const lift = next ? ease.inOutCubic(clamp(age / 0.8)) : 0;
      const gone = li + 2 < this.sets.length ? t > this.sets[li + 2]!.line.start - 0.3 : false;
      return { lift, a: gone ? 0 : lerp(1, 0.38, lift) };
    };
    Lc.save();
    Lc.globalCompositeOperation = 'lighter';
    Lc.lineCap = 'round'; Lc.lineJoin = 'round';
    this.sets.forEach((set, li) => {
      if (t < set.line.start - 0.7) return;
      const { lift, a } = aliveLine(li);
      if (a <= 0) return;
      for (const row of set.rows) {
        const len = writtenLength(row.st, row.times, t);
        if (len <= 0) continue;
        Lc.save();
        Lc.translate(row.ox, row.oy - lift * 330); Lc.scale(row.sc, row.sc);
        for (let i = 0; i < row.st.strokes.length; i++) {
          const s0 = row.st.startLen[i]!;
          if (s0 >= len) break;
          const pts = row.st.strokes[i]!, Ls = row.st.lens[i]!;
          const ci = row.st.charOf[i]!;
          const wi = row.ch[ci] ?? 0;
          const tw = row.times[ci]?.[1] ?? t;
          const heat = Math.exp(-Math.max(0, t - tw) / 1.5);
          const wtxt = set.line.words[wi + (row === set.rows[1] ? row.words.length ? set.rows[0]!.words.length : 0 : 0)]?.w ?? '';
          // colour per word
          let c: [number, number, number] = PHOS;
          if (li === 1) {
            const gi = wi + (row === set.rows[1] ? set.rows[0]!.words.length : 0);
            if (gi === 2) { const hue = ((ci * 41) % 360); c = hslRgb(hue, 0.95, 0.62); }
            else if (gi >= 3) c = [90, 140, 255];
            else c = [210, 255, 190];
          } else if (li === 2) {
            const gi = wi + (row === set.rows[1] ? set.rows[0]!.words.length : 0);
            c = gi === 2 ? mix3(GOLD, [255, 240, 190], 0.2) : PHOS;
          } else if (li === 3) c = mix3(GOLD, [255, 236, 170], 0.25);
          void wtxt;
          const frac = clamp((len - s0) / Math.max(1, Ls[Ls.length - 1] ?? 1));
          const pen = frac < 1 ? 1 : 0;
          const br = a * (0.42 + 0.58 * heat + 0.4 * pen);
          Lc.beginPath();
          Lc.moveTo(pts[0]!.x, pts[0]!.y);
          const remain = len - s0;
          let j = 1;
          for (; j < pts.length && Ls[j]! <= remain; j++) Lc.lineTo(pts[j]!.x, pts[j]!.y);
          if (j < pts.length) {
            const p0 = pts[j - 1]!, p1 = pts[j]!, u = (remain - Ls[j - 1]!) / Math.max(1e-6, Ls[j]! - Ls[j - 1]!);
            Lc.lineTo(lerp(p0.x, p1.x, u), lerp(p0.y, p1.y, u));
          }
          const wsc = 1 / row.sc;
          for (const [w, k, hot] of [[26, 0.07, 0], [13, 0.16, 0], [6.5, 0.45, 0.2], [3.2, 1, 0.75]] as const) {
            Lc.lineWidth = w * wsc * 1.35;
            Lc.strokeStyle = rgba(mix3(c, [255, 255, 255], hot), Math.min(1, k * br));
            Lc.stroke();
          }
        }
        Lc.restore();
      }
    });
    Lc.restore();

    // --- the star: tail of light, then the sticker
    const tailCol = starCol;
    Lc.save(); Lc.globalCompositeOperation = 'lighter';
    for (let k = 1; k <= 26; k++) {
      const p = this.starPos(t - k * 0.03);
      const q = 1 - k / 27;
      Lc.globalAlpha = G * q * q * 0.8;
      radial(Lc, p.x, p.y, 8 + 46 * q, tailCol, 0.9);
    }
    Lc.restore();
    const kick = f.a.kick;
    const rot = Math.sin(t * 1.1) * 0.35 + tau * 0.35;
    const R = 46 * (1 + 0.14 * kick) * (0.4 + 0.6 * intro);
    drawSticker(P, Lc, star.x, star.y, R, rot, starCol, 1, G);
    // gold warms the whole frame from the star once "golden" lands
    if (goldK > 0) {
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * 0.5 * goldK;
      radial(Lc, star.x, star.y, 1100, GOLD, 0.5);
      Lc.restore();
    }
    // the ending: everything pours into one warm gold (phos-final starts on exactly this)
    if (flare > 0) { Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = 1; Lc.fillStyle = rgba(GOLD, flare); Lc.fillRect(0, 0, 1920, 1080); }

    clearRT(renderer, out, [0, 0, 0], 1);
    comp.draw(renderer, this.P.upload(), out, { mode: 'normal', opacity: 1 - flare });
    comp.draw(renderer, this.L.upload(), out, { mode: 'add', opacity: FLARE_OPACITY });
    return { bloom: 0.8, vignette: 0.35, ca: 0.8, grain: 0.05 };
  }
}

export function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
