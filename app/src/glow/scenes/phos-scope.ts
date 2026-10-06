// Chorus 2: an oscilloscope. A phosphor beam draws the outline of every word as it is sung and the screen remembers it
// (two-component persistence: a white-green flash gone in a tenth of a second, a green afterglow of a couple of
// seconds, a dim tail). Every line is a different mode of the instrument, cut hard on its first word; kicks punch the
// frame and flare the graticule, snares flash it; a Lissajous burst marks each line change.
//
//  1 "We don't gotta be okay to dance"   POWER ON / Y-GAIN: the tube lights from a flat line; each word opens out of
//      a flat trace (the vertical gain snapped open); the camera cuts tight / wide on the downbeats; on the held
//      "dance" the beam keeps circling the word's outline, once a beat.
//  2 "We'll be glowing in the dark, take my hand"   TIME BASE: a sweep runs across the screen and writes each word as
//      it passes it (the sweep reaches every word exactly when it is sung) above the vocal's own trace; "take my hand":
//      two channels' traces converge and lock into one on "hand".
//  3 "Every broken piece becomes a star"   SPLIT SCREEN (hard cut): a Lissajous figure breaks on "broken", its
//      pieces fly, and on "star" the beam pulls it into the sticker star.
//  4 "Look how beautiful we are"   X-Y ROTATION: "beautiful" turns once round its vertical axis on each snare of the
//      held note, the persistence keeping a fan of its earlier angles; a rosette turns behind.
//  5 "So sing it like we're never coming down"   the drums arrive: graticule flares on every kick, hard cuts on the
//      downbeats between a wide and a tight framing of the word being sung.
//  6 "Loud enough to wake the whole town"   THREE CHANNELS (vocal, drums, bass), the traces clipping hard on the
//      strong kicks.
//  7 "We don't gotta be okay to dance"   one framing per word, cut on the word: centred, rotated 90 degrees, tiny in
//      a huge graticule, inverted (a flooded screen and a black trace), split into four channels; "dance" brings the
//      whole line back.
//  8 "We'll be glo-glo-glo-glowing in the dark"   three freeze frames, one per "glo-" (left, inverted centre, right),
//      then "glowing" in full at full intensity, and "in the dark" while the screen goes dark.
// The renderer is stateless and exported: the break draws this same screen collapsing to a dot.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides, type SceneCtx } from '../../engine/scene';
import type { Line, Word } from '../../engine/lyrics';
import { clamp, ease, lerp, noise1, prog, smoothstep, TAU, hash } from '../../engine/util';
import { W, H } from '../../engine/gl';
import { textPathCommands } from '../../engine/type';
import { Glow2D, PHOS, VIOLET, WHITE, lit, setFont, starPoints, drawSticker, FAM_THIN, FAM_MONO } from './phos-b-kit';

type Pt = [number, number];
type TF = (x: number, y: number) => Pt;
/** A word as vector outlines, local px (left edge x = 0, baseline y = 0). */
interface Piece { text: string; size: number; contours: Pt[][]; cum: number[][]; len: number; width: number }
interface Cam { x: number; y: number; z: number; r: number }
const RATIOS: Pt[] = [[3, 2], [5, 4], [3, 4], [4, 5], [2, 3], [5, 6], [1, 2]];

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

const intensity = (a: number) => 0.95 * Math.exp(-a / 0.09) + 0.78 * Math.exp(-a / 1.5) + 0.12 * Math.exp(-a / 6.5);

/** Placed word: piece + where (x = left edge, y = baseline, screen px of the line's own layout) and when */
interface PW { w: Word; p: Piece; x: number; y: number; t0: number; t1: number }

export class ScopeRenderer {
  lines: Line[] = [];
  fam = '';
  cache = new Map<string, Piece>();
  L: PW[][] = [];
  freezes: [number, number][] = [];
  glo: { p: Piece; t: number }[] = [];
  gloAll!: Piece;
  sweep: Pt[] = [];   // (t, x) knots of line 2's time base

  constructor(private ctx: SceneCtx) {}

  piece(text: string, size: number): Piece {
    const key = `${text}|${size}`;
    let p = this.cache.get(key);
    if (p) return p;
    const contours = flatten(textPathCommands(text, this.fam, size, 0, 0, 3) as any);
    const cum = contours.map((c) => { const a = [0]; for (let k = 1; k < c.length; k++) a.push(a[k - 1]! + Math.hypot(c[k]![0] - c[k - 1]![0], c[k]![1] - c[k - 1]![1])); return a; });
    let len = 0;
    const off = contours.map((_, k) => { const o = len; len += cum[k]![cum[k]!.length - 1]!; return o; });
    cum.forEach((a, k) => { for (let j = 0; j < a.length; j++) a[j] = a[j]! + off[k]!; });
    let x1 = 0;
    for (const c of contours) for (const [px] of c) x1 = Math.max(x1, px);
    p = { text, size, contours, cum, len: Math.max(1, len), width: x1 };
    this.cache.set(key, p);
    return p;
  }
  /** words in rows (counts), each row centred on cx; rows `lead` x size apart around cy */
  private rows(ws: Word[], counts: number[], size: number, cx: number, cy: number, lead = 1.2): PW[] {
    const out: PW[] = [];
    let wi = 0;
    const gap = size * 0.3;
    counts.forEach((n, r) => {
      const row = ws.slice(wi, wi + n);
      wi += n;
      const ps = row.map((w) => this.piece(w.w, size));
      const tot = ps.reduce((a, p) => a + p.width, 0) + gap * (ps.length - 1);
      let x = cx - tot / 2;
      const y = cy + (r - (counts.length - 1) / 2) * size * lead + size * 0.36;
      row.forEach((w, i) => { out.push({ w, p: ps[i]!, x, y, t0: w.start, t1: w.start + Math.max(0.1, Math.min((w.end - w.start) * 0.8, 0.5)) }); x += ps[i]!.width + gap; });
    });
    return out;
  }

  init() {
    const ly = this.ctx.lyrics;
    const first = ly.lines.indexOf(ly.get('We don’t gotta be okay', 2));
    this.lines = ly.lines.slice(first, first + 8);
    this.fam = FAM_THIN();
    const L = this.lines;
    this.L = [
      this.rows(L[0]!.words, [3, 4], 176, W / 2, 520),
      this.rows(L[1]!.words, [6, 3], 116, W / 2, 470, 2.6),
      this.rows(L[2]!.words, [2, 2, 2], 108, 1440, 520),
      this.rows(L[3]!.words, [2, 1, 2], 150, W / 2, 530, 1.25),
      this.rows(L[4]!.words, [3, 3, 2], 150, W / 2, 540),
      this.rows(L[5]!.words, [4, 3], 124, W / 2, 545),
      L[6]!.words.map((w) => { const p = this.piece(w.w, 300); return { w, p, x: W / 2 - p.width / 2, y: 540 + 300 * 0.34, t0: w.start, t1: w.start + 0.09 }; }),
      this.rows(L[7]!.words.slice(0, 2), [2], 110, W / 2, 230),
    ];
    // line 2: words written by the time base, the beam's x reaching each word when it is sung
    const r1 = this.L[1]!.slice(0, 6);
    const kn: Pt[] = [[L[1]!.start - 0.25, -40]];
    for (const pw of r1) { kn.push([pw.w.start, pw.x - 6]); kn.push([Math.max(pw.w.start + 0.08, pw.w.end - 0.02), pw.x + pw.p.width + 6]); }
    kn.push([L[1]!.words[6]!.start - 0.05, W + 60]);
    this.sweep = kn;
    // line 8: the stutter
    const w8 = L[7]!.words[2]!;
    const on = [w8.start, 144.42, 145.04, 145.42];
    this.glo = on.slice(0, 3).map((t) => ({ p: this.piece('glo-', 300), t }));
    this.gloAll = this.piece('glo-glo-glo-glowing', 150);
    for (const t of on.slice(0, 3)) this.freezes.push([t + 0.1, t + 0.36]);
    void on;
  }

  /** decay time: stands still during the freeze frames */
  tD(t: number) {
    let s = t;
    for (const [a, b] of this.freezes) s -= clamp(t - a, 0, b - a);
    return s;
  }

  /**
   * Draw a word's outline through `tf`. `when(frac, X)` = the time the beam reached that point (Infinity: not yet).
   * Persistence from the age of each stretch; `hold` keeps it lit while its line lasts; `loop` (0..1 or <0) is a
   * retrace head running round the outline.
   */
  trace(c: CanvasRenderingContext2D, P: Piece, tf: TF, when: (frac: number, X: number) => number, t: number,
    o: { hold?: number; kick?: number; alpha?: number; loop?: number; ink?: boolean; width?: number } = {}) {
    const td = this.tD(t), hold = o.hold ?? 0, kick = o.kick ?? 0, al = o.alpha ?? 1;
    if (al <= 0.003) return;
    c.lineWidth = (o.width ?? 4.6) + 3 * kick;
    const prevOp = c.globalCompositeOperation;
    if (o.ink) c.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < P.contours.length; k++) {
      const pts = P.contours[k]!, cum = P.cum[k]!;
      const K = 8;
      for (let i0 = 0; i0 < pts.length - 1; i0 += K) {
        const i1 = Math.min(pts.length - 1, i0 + K);
        let started = false, any = false;
        let tv = -1e9;
        const path: Pt[] = [];
        for (let i = i0; i <= i1; i++) {
          const q = tf(pts[i]![0], pts[i]![1]);
          const tw = when(cum[i]! / P.len, q[0]);
          if (tw > t) {
            if (started && i > i0) {
              // partial segment up to the head (beam mode)
              const tp = when(cum[i - 1]! / P.len, path[path.length - 1]![0]);
              const u = clamp((t - tp) / Math.max(1e-5, tw - tp));
              const qa = path[path.length - 1]!;
              path.push([lerp(qa[0], q[0], u), lerp(qa[1], q[1], u)]);
            }
            break;
          }
          path.push(q); started = true; any = true; tv = Math.max(tv, tw);
        }
        if (!any || path.length < 2) continue;
        const age = Math.max(0, td - this.tD(Math.min(tv, t)));
        let I = Math.min(1.4, Math.max(intensity(age), hold * smoothstep(0, 0.05, age)) + 0.25 * kick * Math.exp(-age / 2));
        let hot = Math.max(Math.exp(-age / 0.14), 0.45 * hold * smoothstep(0, 0.05, age));
        if (o.loop !== undefined && o.loop >= 0) {
          const s = cum[Math.min(i1, cum.length - 1)]! / P.len;
          const d = ((o.loop - s) % 1 + 1) % 1;
          I += 0.9 * Math.exp(-d / 0.16);
          hot = Math.max(hot, Math.exp(-d / 0.05));
        }
        c.strokeStyle = o.ink ? `rgba(0,0,0,${Math.min(1, al * (0.6 + 0.4 * I))})` : lit(PHOS, I * al, 0.1 + 0.85 * hot);
        c.beginPath();
        path.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.stroke();
      }
    }
    c.globalCompositeOperation = prevOp;
  }
  /** the beam head: where the drawing is now */
  head(c: CanvasRenderingContext2D, P: Piece, tf: TF, frac: number, k = 1) {
    if (frac <= 0 || frac >= 1 || k <= 0.01) return;
    const s = frac * P.len;
    for (let j = 0; j < P.contours.length; j++) {
      const cum = P.cum[j]!;
      if (cum[cum.length - 1]! < s) continue;
      for (let i = 1; i < cum.length; i++) if (cum[i]! >= s) {
        const u = (s - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
        const a = P.contours[j]![i - 1]!, b = P.contours[j]![i]!;
        const [hx, hy] = tf(lerp(a[0], b[0], u), lerp(a[1], b[1], u));
        const gr = c.createRadialGradient(hx, hy, 0, hx, hy, 22);
        gr.addColorStop(0, lit(WHITE, k, 1)); gr.addColorStop(0.25, lit(PHOS, 0.8 * k, 0.5)); gr.addColorStop(1, lit(PHOS, 0));
        c.fillStyle = gr; c.fillRect(hx - 22, hy - 22, 44, 44);
        return;
      }
    }
  }
  /** beam-drawn word (progress over [t0, t1]) */
  beamWord(c: CanvasRenderingContext2D, pw: PW, tf: TF, t: number, o: { hold?: number; kick?: number; alpha?: number; loop?: number; ink?: boolean; width?: number } = {}) {
    if (t < pw.t0) return;
    this.trace(c, pw.p, tf, (fr) => pw.t0 + (pw.t1 - pw.t0) * fr, t, o);
    if (!o.ink) this.head(c, pw.p, tf, (t - pw.t0) / (pw.t1 - pw.t0), o.alpha ?? 1);
  }

  // ------------------------------------------------------------------------------------------ camera, furniture
  private camTF(cam: Cam, place: (x: number, y: number) => Pt = (x, y) => [x, y]): TF {
    const cs = Math.cos(cam.r), sn = Math.sin(cam.r);
    return (x, y) => {
      const [px, py] = place(x, y);
      const dx = (px - cam.x) * cam.z, dy = (py - cam.y) * cam.z;
      return [W / 2 + dx * cs - dy * sn, H / 2 + dx * sn + dy * cs];
    };
  }
  private graticule(c: CanvasRenderingContext2D, cam: Cam, amp: number, step = 160) {
    if (amp <= 0.003) return;
    c.save();
    c.translate(W / 2, H / 2); c.rotate(cam.r); c.scale(cam.z, cam.z); c.translate(-cam.x, -cam.y);
    const z = cam.z, R = Math.hypot(W, H) / 2 / z;
    const x0 = cam.x - R, x1 = cam.x + R, y0 = cam.y - R, y1 = cam.y + R;
    c.lineWidth = 1.4 / z;
    c.strokeStyle = lit(PHOS, 0.07 * amp);
    c.beginPath();
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) { c.moveTo(x, y0); c.lineTo(x, y1); }
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { c.moveTo(x0, y); c.lineTo(x1, y); }
    c.stroke();
    c.strokeStyle = lit(PHOS, 0.12 * amp);
    c.beginPath();
    const yy = Math.round(540 / step) * step, xx = Math.round(960 / step) * step;
    for (let x = Math.floor(x0 / 32) * 32; x <= x1; x += 32) { c.moveTo(x, yy - 6); c.lineTo(x, yy + 6); }
    for (let y = Math.floor(y0 / 32) * 32; y <= y1; y += 32) { c.moveTo(xx - 6, y); c.lineTo(xx + 6, y); }
    c.stroke();
    c.restore();
  }
  private wave(c: CanvasRenderingContext2D, name: string, x0: number, x1: number, yc: number, amp: number, hz: number, td: number, I: number, win = 0.9, clip = 1e9) {
    const au = this.ctx.audio, N = 420;
    c.beginPath();
    for (let i = 0; i <= N; i++) {
      const u = i / N, tau = td - (1 - u) * win;
      const e = au.env(name, tau);
      let y = amp * Math.pow(e, 0.8) * (0.72 * Math.sin(TAU * hz * tau) + 0.28 * Math.sin(TAU * hz * 2.03 * tau + 1.3));
      y = clamp(y, -clip, clip);
      if (i) c.lineTo(x0 + (x1 - x0) * u, yc - y); else c.moveTo(x0, yc - y);
    }
    c.lineWidth = 2.4; c.strokeStyle = lit(PHOS, I, 0.25); c.stroke();
  }
  private liss(c: CanvasRenderingContext2D, cx: number, cy: number, A: number, ratio: Pt, td: number, I: number, o: { jitter?: number; gaps?: number; morph?: number; star?: Pt[]; rot?: number } = {}) {
    if (I <= 0.004) return;
    const N = 360, [a, b] = ratio, d = td * 0.55;
    const cs = Math.cos(o.rot ?? 0), sn = Math.sin(o.rot ?? 0);
    c.beginPath();
    let pen = false;
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      let x = Math.sin(a * TAU * u + d), y = Math.sin(b * TAU * u);
      if (o.morph && o.star) {
        const f = u * 10, k = Math.floor(f) % 10, sp = o.star[k]!, sq = o.star[(k + 1) % 10]!, e = f - Math.floor(f);
        x = lerp(x, (lerp(sp[0], sq[0], e) - cx) / A, o.morph); y = lerp(y, (lerp(sp[1], sq[1], e) - cy) / A, o.morph);
      }
      const j = o.jitter ?? 0;
      const rx = x * cs - y * sn, ry = x * sn + y * cs;
      const px = cx + rx * A + j * (noise1(i * 0.35 + td * 6, 1) * 60), py = cy + ry * A + j * (noise1(i * 0.35 + td * 6, 2) * 60);
      const gap = o.gaps ? noise1(i * 0.09 + 5, 3) > 0.35 - o.gaps * 0.8 : false;
      if (gap) { pen = false; continue; }
      if (!pen) { c.moveTo(px, py); pen = true; } else c.lineTo(px, py);
    }
    c.lineWidth = 2.6; c.strokeStyle = lit(PHOS, I, 0.2); c.stroke();
  }
  private readouts(c: CanvasRenderingContext2D, mode: string, state: string, inv = false) {
    c.save();
    setFont(c, 19, FAM_MONO());
    c.fillStyle = inv ? 'rgba(0,0,0,0.8)' : lit(PHOS, 0.42);
    if (inv) c.globalCompositeOperation = 'destination-out';
    c.fillText(mode, 70, 64);
    c.fillText(state, W - 70 - 110, 64);
    c.restore();
  }

  // ------------------------------------------------------------------------------------------ the screen at t
  draw(g: Glow2D, f: Frame | null, t: number) {
    const c = g.c, au = this.ctx.audio, L = this.lines;
    const kick = au.hit('kick', t, 0.12), td = this.tD(t);
    let li = 0;
    for (let k = 1; k < L.length; k++) if (t >= L[k]!.start - 0.02) li = k;
    const Lc = L[li]!;
    const ended = (i: number) => (t < L[i]!.end + 0.3 ? 1 : Math.exp(-(t - L[i]!.end - 0.3) / 0.6));
    const bar = au.barAt(t);
    const db = au.downbeats[Math.floor(bar)] ?? t;
    // the line change: a Lissajous burst
    const tCut = Lc.start;
    const burst = li > 0 && t >= tCut ? Math.exp(-(t - tCut) / 0.22) : 0;
    let mode = 'CH1  VOCAL  500mV   50ms/div', state = 'TRIG’D';
    const hold = (i: number) => (t < L[i]!.end + 0.3 ? 1 : 0);

    if (li === 0) {
      // ---- 1 power on, Y-gain slams, cuts on the downbeats, the held "dance" retraced every beat
      const on = smoothstep(L[0]!.start - 0.12, L[0]!.start + 0.02, t);
      const ws = this.L[0]!;
      const dance = ws[6]!;
      const tight = Math.floor(bar) % 2 === 1 && t > au.downbeats.find((d) => d > L[0]!.start)!;
      const cur = [...ws].reverse().find((pw) => t >= pw.t0) ?? ws[0]!;
      const cam: Cam = tight ? { x: cur.x + cur.p.width / 2, y: cur.y - 60, z: 1.5, r: 0 } : { x: W / 2, y: 540, z: 1 + 0.04 * prog(t, db, db + 1.6), r: 0 };
      this.graticule(c, cam, on * (1 + 2.2 * kick));
      for (const pw of ws) {
        if (t < pw.t0) continue;
        const gy = ease.outBack(prog(t, pw.t0, pw.t0 + 0.09), 2.2);
        const yb = pw.y - pw.p.size * 0.35;
        const tf = this.camTF(cam, (x, y) => [pw.x + x, yb + (pw.y + y - yb) * Math.max(0.02, gy)]);
        const loop = pw === dance && t > pw.t1 ? ((t - pw.t1) / (60 / 151)) % 1 : -1;
        this.beamWord(c, pw, tf, t, { hold: hold(0), kick, loop });
      }
      // the power-on line
      if (t < L[0]!.start + 0.25) {
        const a = Math.exp(-Math.max(0, t - L[0]!.start) / 0.08) * on;
        c.fillStyle = lit(WHITE, a, 1); c.fillRect(0, 538, W, 4);
      }
    } else if (li === 1) {
      // ---- 2 the time base
      mode = 'CH1  VOCAL   Y-T   20ms/div';
      const ws = this.L[1]!;
      const cam: Cam = { x: W / 2, y: 540, z: 1, r: 0 };
      this.graticule(c, cam, 1 + 2.2 * kick, 135);
      const kn = this.sweep;
      const xs = (tt: number) => {
        if (tt <= kn[0]![0]) return kn[0]![1];
        for (let i = 1; i < kn.length; i++) if (tt <= kn[i]![0]) return lerp(kn[i - 1]![1], kn[i]![1], (tt - kn[i - 1]![0]) / Math.max(1e-4, kn[i]![0] - kn[i - 1]![0]));
        return kn[kn.length - 1]![1];
      };
      const tCross = (x: number) => {
        for (let i = 1; i < kn.length; i++) if (x <= kn[i]![1]) return lerp(kn[i - 1]![0], kn[i]![0], clamp((x - kn[i - 1]![1]) / Math.max(1e-4, kn[i]![1] - kn[i - 1]![1])));
        return 1e9;
      };
      const X = xs(t);
      const row2 = ws.slice(6);
      const t2 = row2[0]!.w.start;
      // the sweep column and the vocal trace it leaves
      if (t < t2) {
        c.fillStyle = lit(WHITE, 0.55, 1); c.fillRect(X - 1.5, 0, 3, H);
        const gr = c.createLinearGradient(X - 160, 0, X, 0);
        gr.addColorStop(0, lit(PHOS, 0)); gr.addColorStop(1, lit(PHOS, 0.12));
        c.fillStyle = gr; c.fillRect(X - 160, 0, 160, H);
      }
      {
        const N = 260, x0 = 0, x1 = Math.min(W, X);
        c.beginPath();
        for (let i = 0; i <= N; i++) {
          const x = x0 + (x1 - x0) * (i / N);
          const tt = tCross(x);
          const e = au.env('vocal', tt);
          const y = 640 - 90 * Math.pow(e, 0.8) * Math.sin(TAU * 38 * tt);
          if (i) c.lineTo(x, y); else c.moveTo(x, y);
        }
        c.lineWidth = 2.4; c.strokeStyle = lit(PHOS, 0.55 * ended(1), 0.3); c.stroke();
      }
      for (const pw of ws.slice(0, 6)) this.trace(c, pw.p, (x, y) => [pw.x + x, pw.y + y], (_, Xp) => tCross(Xp), t, { hold: hold(1), kick });
      // "take my hand": two traces converge and lock on "hand"
      const hand = row2[2]!;
      const lock = prog(t, row2[0]!.w.start, hand.w.start, ease.inOutCubic);
      const k2 = smoothstep(t2 - 0.3, t2, t);
      if (k2 > 0) {
        for (const [ch, y0, nm, hz] of [[0, 820, 'vocal', 31], [1, 960, 'bass', 23]] as const) {
          const yc = lerp(y0, 890, lock);
          c.globalAlpha = k2;
          this.wave(c, nm, 0, W, yc, 60 * (1 - 0.6 * lock), hz, td + ch * 0.13 * (1 - lock), 0.7 + 0.3 * lock, 0.9);
          c.globalAlpha = 1;
        }
        for (const pw of row2) this.beamWord(c, pw, (x, y) => [pw.x + x, pw.y + y + 70], t, { hold: hold(1), kick });
      }
    } else if (li === 2) {
      // ---- 3 split screen: the broken Lissajous becomes the sticker star
      mode = 'CH1 / CH2   X-Y   DUAL';
      const L3 = L[2]!, w = L3.words;
      const cam: Cam = { x: W / 2, y: 540, z: 1, r: 0 };
      c.save(); c.beginPath(); c.rect(960, 0, 960, H); c.clip();
      this.graticule(c, { x: W / 2, y: 540, z: 1, r: 0 }, 1 + 2 * kick, 120);
      for (const pw of this.L[2]!) this.beamWord(c, pw, this.camTF(cam, (x, y) => [pw.x + x, pw.y + y]), t, { hold: hold(2), kick });
      c.restore();
      c.save(); c.beginPath(); c.rect(0, 0, 960, H); c.clip();
      c.lineWidth = 1.4; c.strokeStyle = lit(PHOS, 0.07 * (1 + 2 * kick)); c.beginPath();
      for (let x = 0; x <= 960; x += 120) { c.moveTo(x, 0); c.lineTo(x, H); }
      for (let y = 60; y <= H; y += 120) { c.moveTo(0, y); c.lineTo(960, y); }
      c.stroke();
      const cx = 480, cy = 520;
      const broke = prog(t, w[1]!.start, w[1]!.start + 0.12), pieceT = prog(t, w[2]!.start, w[3]!.start), star = ease.inOutCubic(prog(t, w[4]!.start - 0.1, w[5]!.start + 0.12));
      const sPts = starPoints(cx, cy + 10, 300, 0.46);
      const burstP = pieceT * (1 - star);
      this.liss(c, cx, cy, 300, [3, 2], td, 0.85, { jitter: broke * (1 + 2 * burstP), gaps: broke * 0.8 * (1 - star), morph: star, star: sPts });
      if (broke > 0 && t < w[1]!.start + 0.08) { c.fillStyle = lit(WHITE, 0.5, 1); c.fillRect(0, 0, 960, H); }
      if (burstP > 0.01) {
        for (let k = 0; k < 9; k++) {
          const a = k * 0.7 + 0.3, r = 120 + 300 * Math.sin(Math.PI * clamp(pieceT)) * (0.6 + 0.4 * noise1(k, 4));
          c.fillStyle = lit(PHOS, 0.75 * burstP, 0.4);
          c.beginPath(); c.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.8, 5, 0, TAU); c.fill();
        }
      }
      if (star > 0.9) {
        const q = 0.5 + 0.5 * Math.exp(-(t - w[5]!.start) / 1.4);
        c.globalAlpha = smoothstep(0.9, 1, star);
        drawSticker(c, cx, cy + 10, 276, q * 0.4);
        c.globalAlpha = 1;
      }
      c.restore();
      c.strokeStyle = lit(PHOS, 0.9, 0.4); c.lineWidth = 3;
      c.beginPath(); c.moveTo(960, 0); c.lineTo(960, H); c.stroke();
    } else if (li === 3) {
      // ---- 4 X-Y rotation: "beautiful" turns once on each snare of the held note, its earlier angles persisting
      mode = 'X-Y   ROT   Z-AXIS';
      const ws = this.L[3]!;
      const cam: Cam = { x: W / 2, y: 540, z: 1 + 0.06 * prog(t, L[3]!.start, L[3]!.end), r: 0 };
      this.graticule(c, cam, 1 + 2.2 * kick, 160);
      const bt = ws[2]!;
      const spins = au.events('snare', bt.w.start + 0.25, bt.w.end - 0.1).filter(([, s]) => s >= 0.75).map(([x]) => x).filter((x, i, a) => i === 0 || x - a[i - 1]! > 0.45);
      const th = (tt: number) => { let a = 0; for (const s of spins) a += TAU * ease.inOutCubic(prog(tt, s, s + 0.26)); return a; };
      // the rosette behind
      const rr = RATIOS[Math.floor(bar) % RATIOS.length]!;
      this.liss(c, W / 2, 540, 360 * (0.9 + 0.3 * au.env('bass', t)), rr, td, 0.18 + 0.25 * kick, { rot: t * 0.3 });
      for (const pw of ws) {
        const cxw = pw.x + pw.p.width / 2;
        const tfAt = (a: number): TF => this.camTF(cam, (x, y) => [cxw + (pw.x + x - cxw) * Math.cos(a), pw.y + y + 0 * Math.sin(a)]);
        if (pw === bt) {
          // the fan of earlier angles, while it turns
          for (let k = 3; k >= 1; k--) {
            const a = th(t - k * 0.05);
            if (Math.abs(a - th(t)) < 0.01) continue;
            this.beamWord(c, pw, tfAt(a), t, { hold: hold(3), alpha: 0.4 * (1 - k / 4) * Math.abs(Math.cos(a)), kick });
          }
        }
        const a0 = pw === bt ? th(t) : 0;
        this.beamWord(c, pw, tfAt(a0), t, { hold: hold(3), kick, alpha: 0.25 + 0.75 * Math.abs(Math.cos(a0)) });
      }
    } else if (li === 4) {
      // ---- 5 the drums arrive: cuts on the downbeats between wide and tight on the word being sung
      mode = 'CH1  VOCAL  500mV   AUTO';
      const ws = this.L[4]!;
      const cur = [...ws].reverse().find((pw) => t >= pw.t0) ?? ws[0]!;
      const bi = Math.floor(bar);
      const kind = bi % 3;
      const cam: Cam = kind === 0 ? { x: W / 2, y: 540, z: 1.02 + 0.05 * prog(t, db, db + 1.6), r: 0 }
        : kind === 1 ? { x: cur.x + cur.p.width / 2, y: cur.y - 50, z: 1.55, r: 0 }
          : { x: W / 2, y: 540, z: 0.82, r: -0.04 };
      this.graticule(c, cam, 1 + 3 * kick);
      for (const pw of ws) this.beamWord(c, pw, this.camTF(cam, (x, y) => [pw.x + x, pw.y + y]), t, { hold: hold(4), kick });
      this.wave(c, 'vocal', 150, W - 150, 985, 60, 38, td, 0.6, 0.9);
    } else if (li === 5) {
      // ---- 6 three channels, clipping on the strong kicks
      mode = 'CH1 VOCAL  CH2 DRUMS  CH3 BASS';
      const ws = this.L[5]!;
      const cam: Cam = { x: W / 2, y: 540, z: 1, r: 0 };
      this.graticule(c, cam, 0.6 + 1.5 * kick);
      c.strokeStyle = lit(PHOS, 0.3); c.lineWidth = 1.5;
      for (const y of [363, 717]) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      const clipK = au.hit('kick', t, 0.08);
      const amp = 1 + 1.6 * clipK;
      this.wave(c, 'vocal', 0, W, 182, 150 * amp, 36, td, 0.9, 1.1, 150);
      this.wave(c, 'drums', 0, W, 540, 120 * amp, 52, td, 0.35, 1.1, 150);
      this.wave(c, 'bass', 0, W, 900, 150 * amp, 24, td, 0.9, 1.1, 150);
      if (clipK > 0.3) for (const y of [32, 332, 390, 690, 750, 1050]) { c.fillStyle = lit(WHITE, 0.5 * clipK, 1); c.fillRect(0, y - 1, W, 2); }
      for (const pw of ws) this.beamWord(c, pw, (x, y) => [pw.x + x, pw.y + y], t, { hold: hold(5), kick });
    } else if (li === 6) {
      // ---- 7 one framing per word
      const ws = this.L[6]!;
      const ci = Math.max(0, ws.findLastIndex((pw) => t >= pw.t0 - 0.01));
      const pw = ws[ci]!;
      const last = ci === ws.length - 1;
      if (!last) {
        const kind = ci % 5;
        const cxw = W / 2, cyw = pw.y - pw.p.size * 0.36;
        const sc = Math.min(1, 1600 / pw.p.width);
        let cam: Cam = { x: cxw, y: cyw, z: sc, r: 0 }, inv = false, quad = false, step = 160;
        if (kind === 1) cam = { x: cxw, y: cyw, z: Math.min(1, 920 / pw.p.width), r: -Math.PI / 2 };
        if (kind === 2) { cam = { x: cxw, y: cyw, z: 0.3, r: 0 }; step = 40; }
        if (kind === 3) inv = true;
        if (kind === 4) quad = true;
        if (inv) { c.fillStyle = lit(PHOS, 0.42, 0); c.fillRect(0, 0, W, H); }
        this.graticule(c, cam, (inv ? 0 : 1) * (1 + 2.5 * kick), step);
        const draw = (cm: Cam, a = 1) => this.beamWord(c, pw, this.camTF(cm, (x, y) => [pw.x + x, pw.y + y]), t, { hold: 1, kick, ink: inv, alpha: a, width: inv ? 12 : 4.6 });
        if (quad) {
          for (const [qx, qy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            c.save(); c.beginPath(); c.rect(qx < 0 ? 0 : W / 2, qy < 0 ? 0 : H / 2, W / 2, H / 2); c.clip();
            draw({ x: cxw - qx * 480 / (sc * 0.5), y: cyw - qy * 270 / (sc * 0.5), z: sc * 0.5, r: 0 });
            c.restore();
          }
          c.strokeStyle = lit(PHOS, 0.6); c.lineWidth = 2; c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
        } else draw(cam);
        if (kind === 2) { c.strokeStyle = lit(PHOS, 0.5); c.lineWidth = 1.5; c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, 540); c.lineTo(W, 540); c.stroke(); }
        mode = ['CH1  VOCAL  500mV', 'CH1  ROT 90°', 'CH1  ×0.3   2s/div', 'CH1  INV', 'CH1–4  QUAD'][kind]!;
        this.readouts(c, mode, 'TRIG’D', inv);
        return this.finish(c, t, kick, burst, li, true);
      }
      // "dance": the whole line comes back, the beam circling "dance"
      const all = this.rows(L[6]!.words, [3, 4], 176, W / 2, 520);
      const cam: Cam = { x: W / 2, y: 540, z: 1 + 0.05 * prog(t, pw.t0, L[6]!.end), r: 0 };
      this.graticule(c, cam, 1 + 3 * kick);
      all.forEach((q, i) => {
        const tf = this.camTF(cam, (x, y) => [q.x + x, q.y + y]);
        if (i < 6) this.trace(c, q.p, tf, () => pw.t0 - 0.02, t, { hold: 1, kick });
        else this.beamWord(c, { ...q, t0: pw.t0, t1: pw.t0 + 0.14 }, tf, t, { hold: 1, kick, loop: t > pw.t0 + 0.14 ? ((t - pw.t0 - 0.14) / (60 / 151)) % 1 : -1 });
      });
    } else {
      // ---- 8 glo- / glo- / glo- / glowing in the dark
      const L8 = L[7]!;
      const ws8 = L8.words;
      const cam: Cam = { x: W / 2, y: 540, z: 1, r: 0 };
      const frozen = this.freezes.some(([a, b]) => t >= a && t < b);
      const gi = this.glo.findLastIndex((x) => t >= x.t - 0.01);
      const tAll = 145.42;
      const inv = gi === 1 && t < this.glo[2]!.t;
      const dark = smoothstep(ws8[3]!.start, L8.end + 0.2, t);
      if (inv) { c.fillStyle = lit(PHOS, 0.42, 0); c.fillRect(0, 0, W, H); }
      this.graticule(c, cam, (inv ? 0 : 1) * (1 + 2.5 * kick + (frozen ? 0.8 : 0)) * (1 - 0.8 * dark));
      for (const pw of this.L[7]!) this.beamWord(c, pw, (x, y) => [pw.x + x, pw.y + y], t, { hold: 1 - dark * 0.7, kick, ink: inv });
      if (t < tAll) {
        if (gi >= 0) {
          const g0 = this.glo[gi]!;
          const xs = [480, 960, 1440][gi]!, ys = [600, 600, 600][gi]!;
          const pw: PW = { w: ws8[2]!, p: g0.p, x: xs - g0.p.width / 2, y: ys + 100, t0: g0.t, t1: g0.t + 0.1 };
          this.beamWord(c, pw, (x, y) => [pw.x + x, pw.y + y], t, { hold: 1, kick, ink: inv, width: inv ? 13 : 5 });
          // the earlier freezes stay as afterimages
          for (let k = 0; k < gi; k++) {
            if (inv) break;
            const gk = this.glo[k]!;
            const pk: PW = { w: ws8[2]!, p: gk.p, x: [480, 960, 1440][k]! - gk.p.width / 2, y: 700, t0: gk.t, t1: gk.t + 0.1 };
            this.beamWord(c, pk, (x, y) => [pk.x + x, pk.y + y], t, { hold: 0.25, kick, alpha: 0.6 });
          }
        }
      } else {
        // "glowing": the whole word at once, at full intensity
        const P = this.gloAll;
        const pw: PW = { w: ws8[2]!, p: P, x: W / 2 - P.width / 2, y: 610, t0: tAll, t1: tAll + 0.16 };
        this.beamWord(c, pw, (x, y) => [pw.x + x, pw.y + y], t, { hold: 1 - 0.75 * dark, kick: kick + 0.4 * Math.exp(-(t - tAll) / 0.3) });
        const rest = this.rows(ws8.slice(3), [3], 120, W / 2, 820);
        for (const q of rest) this.beamWord(c, q, (x, y) => [q.x + x, q.y + y], t, { hold: 1 - 0.6 * dark, kick });
        const fl = Math.exp(-(t - tAll) / 0.12);
        if (fl > 0.02) { c.fillStyle = lit(WHITE, 0.22 * fl, 1); c.fillRect(0, 0, W, H); }
        this.liss(c, W / 2, 540, 420 + 300 * (1 - Math.exp(-(t - tAll) / 0.3)), [5, 4], td, 0.9 * Math.exp(-(t - tAll) / 0.5));
      }
      // freeze frames: a flash and a tearing line
      for (const [a, b] of this.freezes) {
        const ra = a - 0.1;
        if (t >= ra && t < b) {
          const fl = Math.exp(-(t - ra) / 0.06);
          c.fillStyle = lit(WHITE, 0.2 * fl, 0.6); c.fillRect(0, 0, W, H);
          if (!inv) { const ty = 140 + ((Math.floor((t - ra) * 60) * 977) % 800); c.fillStyle = lit(PHOS, 0.25); c.fillRect(0, ty, W, 3); }
        }
      }
      mode = frozen ? 'CH1  SINGLE  HOLD' : 'CH1  VOCAL  500mV';
      state = frozen ? 'HOLD' : t > L8.end ? 'AUTO' : 'TRIG’D';
      this.readouts(c, mode, state, inv);
      return this.finish(c, t, kick, burst, li, true);
    }
    this.readouts(c, mode, state);
    void f;
    return this.finish(c, t, kick, burst, li, false);
  }

  private finish(c: CanvasRenderingContext2D, t: number, kick: number, burst: number, li: number, skipLiss: boolean) {
    const bar = this.ctx.audio.barAt(t);
    if (burst > 0.02 && !skipLiss) this.liss(c, W / 2, 540, 420 * (1 + 0.5 * (1 - burst)), RATIOS[Math.floor(bar + 2) % RATIOS.length]!, this.tD(t), 0.9 * burst);
    if (kick > 0.02) {
      const vg = c.createRadialGradient(W / 2, H / 2, 400, W / 2, H / 2, 1200);
      vg.addColorStop(0, lit(VIOLET, 0)); vg.addColorStop(1, lit(VIOLET, 0.12 * kick));
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
    }
    void li; void hash;
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
    const k = f.a.kick, sn = f.a.snare, fi = Math.round(f.t * 60);
    // the first half (half-time drums) punches on the snares, the second on the kicks
    const full = f.t > this.sr.lines[4]!.start ? 1 : 0;
    const p = full ? k : Math.max(k * 0.6, sn * 0.8);
    const hx = Math.sin(fi * 12.9898) * 43758.5453, hy = Math.sin(fi * 78.233) * 12345.678;
    let cut = 0;
    for (const l of this.sr.lines) if (f.t >= l.start) cut = Math.exp(-(f.t - l.start) / 0.07);
    return { zoom: 1 + 0.04 * p + 0.04 * cut, shake: [(hx - Math.floor(hx) - 0.5) * 14 * p, (hy - Math.floor(hy) - 0.5) * 14 * p], flash: 0.1 * Math.max(0, sn - 0.6) + 0.04 * cut, bloom: 0.95, bloomThreshold: 0.7, bloomRadius: 0.8, vignette: 0.5, grain: 0.05, ca: 0.8 + 1.2 * cut, halation: 0.1 };
  }
}
