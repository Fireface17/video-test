// Chorus 2 — an oscilloscope. A phosphor beam draws every word as it is sung (the outline of the letters as vector
// strokes) and the screen remembers it with real two-component persistence: a white-green flash that is gone in a
// tenth of a second, a green afterglow that takes a couple of seconds, and a dim tail that lingers. Between the lines
// Lissajous figures from the music swell; the vocal's waveform runs along the bottom. Eight framings, all eased:
// graticule, a tight follow along the trace, a split screen (broken Lissajous -> a sticker star), a rosette,
// a fall, three stacked channels, a close zoom, and "glo-glo-glo-glowing" in three freeze frames.
// The renderer is stateless and exported: the break draws the same screen collapsing to a dot.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides, type SceneCtx } from '../../engine/scene';
import type { Line, Word } from '../../engine/lyrics';
import { clamp, ease, lerp, noise1, prog, smoothstep, TAU } from '../../engine/util';
import { W, H } from '../../engine/gl';
import { textPathCommands } from '../../engine/type';
import { Glow2D, PHOS, VIOLET, WHITE, CYAN, lit, placeLine, setFont, starPoints, drawSticker, FAM_THIN, FAM_MONO, type Placed } from './phos-b-kit';

type Pt = [number, number];
interface Piece { contours: Pt[][]; cum: number[][]; len: number; t0: number; t1: number; x0: number; y0: number; x1: number; y1: number; line: number }
interface Cam { x: number; y: number; z: number; sx: number }
interface Spec { rows: number[]; size: number; cx: number; cy: number; zoom: number; ystretch?: number; sx?: number }

const SPECS: Spec[] = [
  { rows: [3, 4], size: 176, cx: 0, cy: 0, zoom: 1 },
  { rows: [5, 4], size: 124, cx: 1900, cy: 0, zoom: 1.1 },
  { rows: [2, 2, 2], size: 108, cx: 3600, cy: 0, zoom: 1, sx: 1440 },
  { rows: [2, 3], size: 176, cx: 5200, cy: 0, zoom: 1 },
  { rows: [3, 3, 2], size: 150, cx: 6900, cy: 0, zoom: 1, ystretch: 1.35 },
  { rows: [4, 3], size: 124, cx: 8700, cy: 0, zoom: 1 },
  { rows: [2, 2, 3], size: 170, cx: 10300, cy: 0, zoom: 1.3 },
  { rows: [2, 1, 3], size: 150, cx: 12400, cy: 0, zoom: 1 },
];
const RATIOS: Pt[] = [[3, 2], [5, 4], [3, 4], [4, 5], [2, 3], [5, 6], [1, 2]];
const LEAD = 0.4;

function flatten(cmds: { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [], px = 0, py = 0;
  for (const c of cmds) {
    if (c.type === 'M') { if (cur.length > 1) out.push(cur); cur = [[c.x!, c.y!]]; px = c.x!; py = c.y!; }
    else if (c.type === 'L') { cur.push([c.x!, c.y!]); px = c.x!; py = c.y!; }
    else if (c.type === 'Q') {
      for (let i = 1; i <= 4; i++) { const u = i / 4, v = 1 - u; cur.push([v * v * px + 2 * v * u * c.x1! + u * u * c.x!, v * v * py + 2 * v * u * c.y1! + u * u * c.y!]); }
      px = c.x!; py = c.y!;
    } else if (c.type === 'C') {
      for (let i = 1; i <= 5; i++) {
        const u = i / 5, v = 1 - u;
        cur.push([v * v * v * px + 3 * v * v * u * c.x1! + 3 * v * u * u * c.x2! + u * u * u * c.x!, v * v * v * py + 3 * v * v * u * c.y1! + 3 * v * u * u * c.y2! + u * u * u * c.y!]);
      }
      px = c.x!; py = c.y!;
    } else if (c.type === 'Z') { if (cur.length) { cur.push([cur[0]![0], cur[0]![1]]); out.push(cur); cur = []; } }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

export class ScopeRenderer {
  lines: Line[] = [];
  placed: Placed[][] = [];
  pieces: Piece[][] = [];
  freezes: [number, number][] = [];
  follow: { t: number; x: number; y: number }[][] = [];
  barT: number[] = [];

  constructor(private ctx: SceneCtx) {}

  init() {
    const ly = this.ctx.lyrics;
    const first = ly.lines.indexOf(ly.get('We don’t gotta be okay', 2));
    this.lines = ly.lines.slice(first, first + 8);
    const fam = FAM_THIN();
    this.lines.forEach((line, i) => {
      const s = SPECS[i]!;
      const pl = placeLine(line, s.rows, s.size, s.cx, s.cy, fam, 3);
      if (s.ystretch) for (const p of pl) p.y = s.cy + (p.y - s.cy) * s.ystretch;
      this.placed.push(pl);
      const ps: Piece[] = [];
      const add = (text: string, x: number, y: number, size: number, t0: number, t1: number) => {
        const contours = flatten(textPathCommands(text, fam, size, x, y, 3) as any);
        const cum = contours.map((c) => { const a = [0]; for (let k = 1; k < c.length; k++) a.push(a[k - 1]! + Math.hypot(c[k]![0] - c[k - 1]![0], c[k]![1] - c[k - 1]![1])); return a; });
        let len = 0;
        const off = contours.map((_, k) => { const o = len; len += cum[k]![cum[k]!.length - 1]!; return o; });
        cum.forEach((a, k) => { for (let j = 0; j < a.length; j++) a[j] = a[j]! + off[k]!; });
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const c of contours) for (const [px, py] of c) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
        ps.push({ contours, cum, len: Math.max(len, 1), t0, t1, x0, y0, x1, y1, line: i });
      };
      const fk: { t: number; x: number; y: number }[] = [];
      for (const p of pl) {
        const w = p.word;
        if (i === 7 && w.w.startsWith('glo-')) {
          // the stutter: three "glo-" in a flash each, then "glowing" drawn in earnest
          const on = [w.start, 144.42, 145.04, 145.42];
          const parts = ['glo-', 'glo-', 'glo-', 'glowing'];
          let x = p.x;
          parts.forEach((txt, k) => {
            const wd = this.measure(txt, p.size, fam);
            add(txt, x, p.y, p.size, on[k]!, on[k]! + (k < 3 ? 0.1 : 0.32));
            fk.push({ t: on[k]!, x: x + wd / 2, y: p.y });
            x += wd;
          });
          for (const k of [0, 1, 2]) this.freezes.push([on[k]! + 0.1, on[k]! + 0.36]);
        } else {
          const span = Math.min((w.end - w.start) * 0.85, 0.55);
          add(w.w, p.x, p.y, p.size, w.start, w.start + Math.max(0.1, span));
          const wd = this.measure(w.w, p.size, fam);
          fk.push({ t: (w.start + w.end) / 2, x: p.x + wd / 2, y: p.y - p.size * 0.3 });
        }
      }
      this.pieces.push(ps);
      this.follow.push(fk);
    });
  }
  private mc: CanvasRenderingContext2D | null = null;
  private measure(text: string, size: number, fam: string) {
    this.mc ??= document.createElement('canvas').getContext('2d')!;
    this.mc.font = `${size}px "${fam}"`;
    return this.mc.measureText(text).width + (text.length) * 3;
  }

  /** Decay time: stands still during the freeze frames. */
  tD(t: number) {
    let s = t;
    for (const [a, b] of this.freezes) s -= clamp(t - a, 0, b - a);
    return s;
  }
  private head(i: number, t: number) {
    const k = this.follow[i]!;
    const at = (tt: number) => {
      if (tt <= k[0]!.t) return k[0]!;
      for (let j = 1; j < k.length; j++) if (tt <= k[j]!.t) { const a = k[j - 1]!, b = k[j]!, u = ease.inOutQuad(prog(tt, a.t, b.t)); return { t: tt, x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u) }; }
      return k[k.length - 1]!;
    };
    let x = 0, y = 0;
    for (let j = -3; j <= 3; j++) { const p = at(t + j * 0.1); x += p.x / 7; y += p.y / 7; }
    return { x, y };
  }
  private camLine(i: number, t: number): Cam {
    const s = SPECS[i]!, L = this.lines[i]!;
    let x = s.cx, y = s.cy, z = s.zoom;
    const tt = Math.min(t, L.end);
    void tt;
    if (i === 4) y = s.cy + 50 * ease.inOutQuad(prog(t, L.start, L.end));
    if (i === 6) z = 1.3 + 0.06 * prog(t, L.start, L.end);
    if (i === 1) z = 1.1 + 0.05 * prog(t, L.start, L.end);
    if (i === 0) z = 1 + 0.05 * prog(t, L.start, L.end);
    if (i === 7) z = 1 + 0.08 * prog(t, L.start, L.end + 2);
    if (i === 3) z = 1 + 0.07 * ease.inOutQuad(prog(t, L.start, L.end));
    return { x, y, z, sx: s.sx ?? W / 2 };
  }
  cam(t: number): Cam {
    let i = 0;
    for (let k = 1; k < this.lines.length; k++) if (t >= this.lines[k]!.start - LEAD) i = k;
    const B = this.camLine(i, t);
    if (i === 0) return B;
    const w = ease.inOutCubic(prog(t, this.lines[i]!.start - LEAD, this.lines[i]!.start + 0.1));
    const A = this.camLine(i - 1, this.lines[i - 1]!.end);
    return { x: lerp(A.x, B.x, w), y: lerp(A.y, B.y, w), z: Math.exp(lerp(Math.log(A.z), Math.log(B.z), w)), sx: lerp(A.sx, B.sx, w) };
  }

  private intensity(a: number) { return 0.95 * Math.exp(-a / 0.09) + 0.78 * Math.exp(-a / 1.5) + 0.12 * Math.exp(-a / 6.5); }

  private drawPiece(c: CanvasRenderingContext2D, p: Piece, t: number, z: number, kick: number) {
    const td = this.tD(t);
    const L = this.lines[p.line]!;
    const tdEnd = this.tD(p.t1);
    if (t < p.t0 || td - tdEnd > 14) return;
    const active = t < L.end + 0.3 ? 1 : 0;
    const hold = 1.0 * (t < L.end + 0.3 ? 1 : Math.exp(-(t - L.end - 0.3) / 0.7));
    const prog01 = clamp((t - p.t0) / (p.t1 - p.t0));
    const drawnS = p.len * prog01;
    c.lineWidth = 4.8 / z;
    for (let k = 0; k < p.contours.length; k++) {
      const pts = p.contours[k]!, cum = p.cum[k]!;
      if (cum[0]! > drawnS) break;
      const K = 10;
      for (let i0 = 0; i0 < pts.length - 1; i0 += K) {
        const i1 = Math.min(pts.length - 1, i0 + K);
        if (cum[i0]! > drawnS) break;
        const tv = p.t0 + (p.t1 - p.t0) * (cum[Math.min(i1, pts.length - 1)]! / p.len);
        const age = td - this.tD(Math.min(tv, t));
        const I = Math.min(1.4, Math.max(this.intensity(age), hold * smoothstep(0, 0.05, age)) + 0.25 * kick * Math.exp(-age / 2));
        const hot = Math.max(Math.exp(-age / 0.14), 0.45 * active * smoothstep(0, 0.05, age));
        c.strokeStyle = lit(PHOS, I, 0.1 + 0.85 * hot);
        c.beginPath();
        c.moveTo(pts[i0]![0], pts[i0]![1]);
        for (let i = i0 + 1; i <= i1; i++) {
          if (cum[i]! > drawnS) {
            // the head: partial segment
            const u = (drawnS - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
            c.lineTo(lerp(pts[i - 1]![0], pts[i]![0], u), lerp(pts[i - 1]![1], pts[i]![1], u));
            break;
          }
          c.lineTo(pts[i]![0], pts[i]![1]);
        }
        c.stroke();
      }
    }
    // the beam head
    if (t - p.t0 < p.t1 - p.t0 + 0.04) {
      let s = 0, hx = p.contours[0]![0]![0], hy = p.contours[0]![0]![1];
      for (let k = 0; k < p.contours.length; k++) {
        const cum = p.cum[k]!;
        if (cum[cum.length - 1]! >= drawnS) {
          for (let i = 1; i < cum.length; i++) if (cum[i]! >= drawnS) { const u = (drawnS - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!); hx = lerp(p.contours[k]![i - 1]![0], p.contours[k]![i]![0], u); hy = lerp(p.contours[k]![i - 1]![1], p.contours[k]![i]![1], u); break; }
          break;
        }
        s = cum[cum.length - 1]!;
        hx = p.contours[k]![p.contours[k]!.length - 1]![0]; hy = p.contours[k]![p.contours[k]!.length - 1]![1];
      }
      const hr = 20 / z;
      const gr = c.createRadialGradient(hx, hy, 0, hx, hy, hr);
      gr.addColorStop(0, lit(WHITE, 1, 1)); gr.addColorStop(0.25, lit(PHOS, 0.8, 0.5)); gr.addColorStop(1, lit(PHOS, 0));
      c.fillStyle = gr; c.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    }
  }

  private graticule(c: CanvasRenderingContext2D, cam: Cam, amp: number) {
    const z = cam.z, step = 160;
    const x0 = cam.x - cam.sx / z, x1 = cam.x + (W - cam.sx) / z, y0 = cam.y - H / 2 / z, y1 = cam.y + H / 2 / z;
    c.lineWidth = 1.4 / z;
    c.strokeStyle = lit(PHOS, 0.07 * amp);
    c.beginPath();
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { c.moveTo(x, y0); c.lineTo(x, y1); }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { c.moveTo(x0, y); c.lineTo(x1, y); }
    c.stroke();
    // minor ticks on the centre axes of every cell row/column
    c.strokeStyle = lit(PHOS, 0.12 * amp);
    c.beginPath();
    for (let x = Math.floor(x0 / 32) * 32; x <= x1; x += 32) { const yy = Math.round(cam.y / step) * step; c.moveTo(x, yy - 6); c.lineTo(x, yy + 6); }
    for (let y = Math.floor(y0 / 32) * 32; y <= y1; y += 32) { const xx = Math.round(cam.x / step) * step; c.moveTo(xx - 6, y); c.lineTo(xx + 6, y); }
    c.stroke();
  }

  private wave(c: CanvasRenderingContext2D, name: string, x0: number, x1: number, yc: number, amp: number, hz: number, td: number, I: number, win = 0.9) {
    const au = this.ctx.audio, N = 420;
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N, tau = td - (1 - u) * win;
      const e = au.env(name, tau);
      const y = yc - amp * Math.pow(e, 0.8) * (0.72 * Math.sin(TAU * hz * tau) + 0.28 * Math.sin(TAU * hz * 2.03 * tau + 1.3));
      if (i) c.lineTo(x0 + (x1 - x0) * u, y); else c.moveTo(x0, y);
    }
    c.lineWidth = 2.4; c.strokeStyle = lit(PHOS, I, 0.25); c.stroke();
  }

  private liss(c: CanvasRenderingContext2D, cx: number, cy: number, A: number, ratio: Pt, td: number, I: number, o: { jitter?: number; gaps?: number; morph?: number; star?: Pt[] } = {}) {
    const N = 360, [a, b] = ratio, d = td * 0.55;
    c.beginPath();
    let pen = false;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      let x = Math.sin(a * TAU * u + d), y = Math.sin(b * TAU * u);
      if (o.morph && o.star) {
        const f = u * 10, k = Math.floor(f) % 10, sp = o.star[k]!, sn = o.star[(k + 1) % 10]!, e = f - Math.floor(f);
        x = lerp(x, ((lerp(sp[0], sn[0], e)) - cx) / A, o.morph); y = lerp(y, ((lerp(sp[1], sn[1], e)) - cy) / A, o.morph);
      }
      const j = o.jitter ?? 0;
      let px = cx + x * A + j * (noise1(i * 0.35 + td * 6, 1) * 60), py = cy + y * A + j * (noise1(i * 0.35 + td * 6, 2) * 60);
      const gap = o.gaps ? noise1(i * 0.09 + 5, 3) > 0.35 - o.gaps * 0.8 : false;
      if (gap) { pen = false; continue; }
      if (!pen) { c.moveTo(px, py); pen = true; } else c.lineTo(px, py);
    }
    c.lineWidth = 2.6; c.strokeStyle = lit(PHOS, I, 0.2); c.stroke();
  }

  /** Draw the whole screen at song time t (also valid past the chorus: the beam is idle, everything decays). */
  draw(g: Glow2D, f: Frame | null, t: number) {
    const c = g.c, au = this.ctx.audio;
    const kick = au.hit('kick', t, 0.12), td = this.tD(t);
    const cam = this.cam(t);
    const L = this.lines;
    const bar = au.barAt ? au.barAt(t) : 0;
    const frozen = this.freezes.some(([a, b]) => t >= a && t < b);

    c.save();
    c.setTransform(cam.z, 0, 0, cam.z, cam.sx - cam.x * cam.z, H / 2 - cam.y * cam.z);
    this.graticule(c, cam, 1 + 2.2 * kick + (frozen ? 0.6 : 0));
    // the glass is held for the split screen on line 3: nothing but its own panel on the left
    for (const ps of this.pieces) for (const p of ps) {
      const sx0 = (p.x0 - cam.x) * cam.z + cam.sx, sx1 = (p.x1 - cam.x) * cam.z + cam.sx;
      if (sx1 < -80 || sx0 > W + 80) continue;
      this.drawPiece(c, p, t, cam.z, kick);
    }
    c.restore();

    // screen space from here on
    const L3 = L[2]!;
    // line 6: three stacked channels
    const ch = smoothstep(L[5]!.start - 0.25, L[5]!.start + 0.25, t) * (1 - smoothstep(L[5]!.end - 0.3, L[5]!.end + 0.05, t));
    if (ch > 0.01) {
      c.strokeStyle = lit(PHOS, 0.25 * ch); c.lineWidth = 1.5;
      for (const y of [363, 717]) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      this.wave(c, 'vocal', 0, W, 190, 160 * ch, 36, td, 0.9 * ch, 1.1);
      this.wave(c, 'drums', 0, W, 540, 110 * ch, 52, td, 0.3 * ch, 1.1);
      this.wave(c, 'bass', 0, W, 900, 150 * ch, 24, td, 0.9 * ch, 1.1);
    }
    // the split screen of line 3: broken Lissajous that becomes the sticker star
    const sp = ease.inOutCubic(prog(t, L3.start - 0.2, L3.start + 0.3)) * (1 - ease.inOutCubic(prog(t, L3.end - 0.1, L3.end + 0.35)));
    if (sp > 0.003) {
      const wpx = 960 * sp;
      c.save();
      c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.fillRect(0, 0, wpx, H);
      c.globalCompositeOperation = 'lighter';
      c.beginPath(); c.rect(0, 0, wpx, H); c.clip();
      const cx = 480, cy = 500;
      c.lineWidth = 1.4; c.strokeStyle = lit(PHOS, 0.07); c.beginPath();
      for (let x = 0; x <= 960; x += 120) { c.moveTo(x, 0); c.lineTo(x, H); }
      for (let y = 20; y <= H; y += 120) { c.moveTo(0, y); c.lineTo(960, y); }
      c.stroke();
      const w = L3.words;
      const broke = prog(t, w[1]!.start, w[1]!.start + 0.35), pieceT = prog(t, w[2]!.start, w[3]!.start), star = ease.inOutCubic(prog(t, w[4]!.start - 0.1, w[5]!.start + 0.15));
      const sPts = starPoints(cx, cy + 10, 300, 0.46);
      const R = RATIOS[(Math.floor(bar) + 1) % RATIOS.length]!;
      const burst = pieceT * (1 - star);
      this.liss(c, cx, cy, 300, [3, 2], td, 0.8, { jitter: broke * (1 + 2 * burst), gaps: broke * 0.8 * (1 - star), morph: star, star: sPts });
      if (burst > 0.01) {
        // pieces fly apart and come back
        for (let k = 0; k < 7; k++) {
          const a = k * 0.9 + 0.3, r = 120 + 260 * Math.sin(Math.PI * clamp(pieceT)) * (0.6 + 0.4 * noise1(k, 4));
          c.fillStyle = lit(PHOS, 0.7 * burst, 0.3);
          c.beginPath(); c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 5, 0, TAU); c.fill();
        }
      }
      void R;
      if (star > 0.9) {
        const q = 0.5 + 0.5 * Math.exp(-(t - w[5]!.start) / 1.4);
        c.globalAlpha = smoothstep(0.9, 1, star);
        drawSticker(c, cx, cy + 10, 276, q * 0.4);
        c.globalAlpha = 1;
      }
      c.restore();
      // the divider
      c.strokeStyle = lit(PHOS, 0.9 * sp, 0.4); c.lineWidth = 3;
      c.beginPath(); c.moveTo(wpx, 0); c.lineTo(wpx, H); c.stroke();
    }
    // Lissajous backdrop (faint always), a rosette in line 4, and a burst at each line boundary
    {
      const rr = RATIOS[Math.floor(bar) % RATIOS.length]!;
      const bph = bar - Math.floor(bar);
      const env = Math.sin(Math.PI * clamp(bph * 1.0));
      const amp = 340 * (0.85 + 0.35 * au.env('bass', t));
      const l4 = smoothstep(L[3]!.start - 0.1, L[3]!.start + 0.4, t) * (1 - smoothstep(L[3]!.end - 0.3, L[3]!.end + 0.1, t));
      const inSplit = sp > 0.01 ? 0 : 1;
      if (inSplit) {
        this.liss(c, W / 2, H / 2, amp * (1 + 0.5 * l4), rr, td, (0.1 + 0.4 * l4) * (0.4 + 0.6 * env));
        let burst = 0;
        for (let k = 1; k < L.length; k++) { const tb = L[k]!.start - 0.22; if (t > tb) burst = Math.max(burst, Math.exp(-(t - tb) / 0.28)); }
        if (burst > 0.02) this.liss(c, W / 2, H / 2, 420 * (1 + 0.5 * (1 - burst)), RATIOS[Math.floor(bar + 2) % RATIOS.length]!, td, 0.9 * burst);
      }
    }
    // the vocal's waveform along the bottom (not while the three channels show it)
    const vis = (1 - ch) * (1 - 0.9 * sp);
    if (vis > 0.02) {
      this.wave(c, 'vocal', 150, W - 150, 985, 60, 38, td - 0.03, 0.2 * vis, 0.9);
      this.wave(c, 'vocal', 150, W - 150, 985, 60, 38, td, 0.75 * vis, 0.9);
    }
    // readouts
    c.save();
    setFont(c, 19, FAM_MONO());
    c.fillStyle = lit(PHOS, 0.42);
    const stateTxt = frozen ? 'HOLD' : t < L[7]!.end ? 'TRIG’D' : 'AUTO';
    c.fillText('CH1  VOCAL  500mV', 70, 64);
    c.fillText('TIME  50ms/div', 70, 92);
    c.fillText(stateTxt, W - 70 - 80, 64);
    if (frozen) { c.fillStyle = lit(WHITE, 0.9, 1); c.fillText('■', W - 70 - 110, 64); }
    c.restore();
    // freeze frames: a flash and a tearing line
    for (const [a, b] of this.freezes) {
      const ra = a - 0.1;
      if (t >= ra && t < b + 0.1) {
        const fl = Math.exp(-(t - ra) / 0.07);
        c.fillStyle = lit(WHITE, 0.3 * fl, 0.6); c.fillRect(0, 0, W, H);
        const vg = c.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 1100);
        vg.addColorStop(0, lit(VIOLET, 0)); vg.addColorStop(1, lit(VIOLET, 0.06 * (t < b ? 1 : 0.3)));
        c.fillStyle = vg; c.fillRect(0, 0, W, H);
        if (t < b) { const ty = 140 + ((Math.floor((t - ra) * 60) * 977) % 800); c.fillStyle = lit(CYAN, 0.18); c.fillRect(0, ty, W, 3); }
      }
    }
    // kick: the UV recharge breathes at the edges
    if (kick > 0.02) {
      const vg = c.createRadialGradient(W / 2, H / 2, 400, W / 2, H / 2, 1200);
      vg.addColorStop(0, lit(VIOLET, 0)); vg.addColorStop(1, lit(VIOLET, 0.12 * kick));
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
    }
    void f;
  }
}

export default class PhosScope extends Scene {
  g = new Glow2D();
  sr!: ScopeRenderer;
  override init() { this.sr = new ScopeRenderer(this.ctx); this.sr.init(); }
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    this.g.begin();
    this.sr.draw(this.g, f, f.t);
    this.g.present(this.ctx.renderer, this.ctx.comp, out, { glow: 1.5 });
    return { bloom: 0.95, bloomThreshold: 0.7, bloomRadius: 0.8, vignette: 0.5, grain: 0.05, ca: 0.8, halation: 0.1 };
  }
}
