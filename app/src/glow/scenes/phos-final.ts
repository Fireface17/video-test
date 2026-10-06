// Final chorus, the climax, in gold light on true black. Each line has its own idea; lines cut hard on their first
// word; nothing dances or shakes: motion is light, the camera and the cuts.
//
//  1 "We don't gotta be okay to dance": it opens on the very gold the bridge ended in, a full frame of it, and the
//    words are punched out of the gold as black stamps (ink on gold). On "be" (the first big kick) it inverts: black,
//    the words in gold. "to DANCE": the word fills the frame in front of a sunburst whose rays jump half a step on
//    every beat (the light dances, the letters stand still) while the camera steps in on the downbeats.
//  2 "We'll be glowing in the dark, take my hand": the dark; a searchlight from below finds each word as it is sung,
//    and each word it touches stays charged: white-hot, then the clip's phosphor green afterglow (glow in the dark).
//    "take" is caught by a beam from the left corner, "my" from the right, and on "hand" the two beams cross on it.
//  3 "Every broken piece becomes a star": kintsugi. The words are set in a black glass slab; on "broken" it cracks
//    from one point (a radial fracture, five main cracks at the angles of a star's points) and the shards jump apart;
//    on "piece" further; on "becomes" molten gold runs out along the cracks from the impact and pulls the shards
//    back together; on "star" the seams flare and a gold star sticker ignites at the impact point.
//  4 "Look how beautiful we are": sunrise. BEAUTIFUL stands on a hard horizon in black silhouette while a huge gold
//    sun rises behind it, its reflection broken into stripes below, god rays turning slowly.
//  5 "We'll be glowing in the dark!": the wall. Every word of the song, set as one wall of type; we start tight on
//    this very line inside it and on the beats of the held "glowing" the camera jumps back step by step while the
//    wall lights up around the line in waves; the line itself stays big in front. On "dark!" every word of the song
//    flashes and the frame burns to gold (the drop's way in).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { Layer2D, clearRT, W, H } from '../../engine/gl';
import { F, font } from '../../engine/type';
import type { Line, Word } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, mulberry32, prog, smoothstep, TAU, frameIdx } from '../../engine/util';
import { loadPhosphorFont, PHOS_FONT } from '../lib/phosphor';
import { FLARE_OPACITY, starPath } from './phos-fall';

type RGB = [number, number, number];
const GOLD: RGB = [255, 194, 71], HOT: RGB = [255, 246, 222], AMBER: RGB = [255, 138, 28], PHOS: RGB = [182, 255, 106];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const STAMP = () => F.archivo(100, 900);
const WIDE = () => F.archivo(125, 900);
const CX = W / 2;

interface Box { w: Word; text: string; x: number; y: number; size: number; fam: string; width: number }
interface Shard { poly: [number, number][]; c: [number, number]; ring: number; rot: number }
interface WallWord { text: string; x: number; y: number; gi: number }

export default class PhosFinal extends Scene {
  L = new Layer2D();
  G = new Layer2D(W / 2, H / 2, 1);
  lines: Line[] = [];
  mc = document.createElement('canvas').getContext('2d')!;
  // line layouts
  l1a: Box[] = []; l1dance: Box[] = [];
  l2: Box[] = [];
  l3a: Box[] = []; l3b: Box[] = [];
  l4: Box[] = [];
  l5: Box[] = [];
  // kintsugi
  imp: [number, number] = [CX, 470];
  rays: [number, number][][] = [];
  rings = [0, 130, 310, 560, 2400];
  shards: Shard[] = [];
  // the wall
  wall: WallWord[] = [];
  wallSize = 40;
  wallBox = { x0: 0, y0: 0, x1: W, y1: H };
  phrase = { x: CX, y: 540, w: 400 };

  private meas(text: string, fam: string, size: number) { this.mc.font = font(fam, size); return this.mc.measureText(text).width; }
  /** words in one row, centred on x = CX, baseline y; `up` uppercases */
  private row(ws: Word[], fam: string, size: number, y: number, up = true, gap = 0.28): Box[] {
    const texts = ws.map((w) => (up ? w.w.toUpperCase() : w.w));
    const widths = texts.map((s) => this.meas(s, fam, size));
    const g = gap * size;
    const tot = widths.reduce((a, b) => a + b, 0) + g * (ws.length - 1);
    let x = CX - tot / 2;
    return ws.map((w, i) => { const b = { w, text: texts[i]!, x, y, size, fam, width: widths[i]! }; x += widths[i]! + g; return b; });
  }
  /** largest size (<= max) at which the row fits `maxW` */
  private fit(ws: Word[], fam: string, maxW: number, max: number, up = true, gap = 0.28) {
    const texts = ws.map((w) => (up ? w.w.toUpperCase() : w.w));
    const at100 = texts.reduce((a, s) => a + this.meas(s, fam, 100), 0) + gap * 100 * (ws.length - 1);
    return Math.min(max, (maxW / at100) * 100);
  }

  override async init() {
    const { lyrics, start, end } = this.ctx;
    await loadPhosphorFont();
    this.lines = lyrics.linesIn(start - 0.05, end + 0.01).filter((l) => l.start >= start - 0.1).slice(0, 5);
    const [A, B, C, D, E] = this.lines as [Line, Line, Line, Line, Line];
    if (!E) return;
    // 1
    const s1 = this.fit(A.words.slice(0, 3), STAMP(), 1640, 190);
    this.l1a = [...this.row(A.words.slice(0, 3), STAMP(), s1, 480), ...this.row(A.words.slice(3, 5), STAMP(), s1, 480 + s1 * 1.08)];
    const sd = this.fit([A.words[6]!], WIDE(), 1700, 420);
    this.l1dance = [...this.row([A.words[5]!], STAMP(), 92, 330), ...this.row([A.words[6]!], WIDE(), sd, 640 + sd * 0.32)];
    // 2
    const s2 = this.fit(B.words.slice(0, 6), PHOS_FONT, 1700, 130, false, 0.3);
    this.l2 = [...this.row(B.words.slice(0, 6), PHOS_FONT, s2, 420, false, 0.3), ...this.row(B.words.slice(6), PHOS_FONT, 190, 760, false, 0.3)];
    // 3
    const s3 = this.fit(C.words.slice(0, 3), STAMP(), 1380, 150);
    this.l3a = this.row(C.words.slice(0, 3), STAMP(), s3, 470 + s3 * 0.36);
    this.l3b = this.row(C.words.slice(3), STAMP(), 112, 830);
    this.buildCracks();
    // 4
    const sb = this.fit([D.words[2]!], WIDE(), 1660, 300);
    this.l4 = [...this.row(D.words.slice(0, 2), F.archivo(110, 700), 70, 205, true, 0.5), ...this.row([D.words[2]!], WIDE(), sb, 735), ...this.row(D.words.slice(3), STAMP(), 120, 950)];
    // 5
    this.buildWall(E);
    // the line in front: exactly where the wall's own copy of it is at the start (so it can stay when the wall goes)
    const z0 = 1500 / Math.max(200, this.phrase.w);
    this.l5 = this.wall.filter((w) => w.gi >= E.words[0]!.gi && w.gi <= E.words[E.words.length - 1]!.gi).map((w) => {
      const word = lyrics.words[w.gi]!;
      const size = this.wallSize * z0;
      return { w: word, text: w.text, x: CX + (w.x - CX) * z0, y: 540 + (w.y - this.phrase.y) * z0, size, fam: PHOS_FONT, width: this.meas(w.text, PHOS_FONT, size) };
    });
  }

  private buildCracks() {
    const r = mulberry32(31);
    const [ix, iy] = this.imp;
    const n = 9;
    const angs: number[] = [];
    // five main cracks at the angles of a star's points, four lesser ones between some of them
    for (let k = 0; k < 5; k++) angs.push(-Math.PI / 2 + (k * TAU) / 5);
    for (const k of [0, 1, 3, 4]) angs.push(-Math.PI / 2 + ((k + 0.5) * TAU) / 5 + (r() - 0.5) * 0.25);
    angs.sort((a, b) => a - b);
    this.rays = angs.map((a) => {
      const pts: [number, number][] = [[ix, iy]];
      let rr = 0, ang = a;
      while (rr < 2400) {
        rr += 40 + r() * 70;
        ang = a + (r() - 0.5) * 0.12;
        pts.push([ix + Math.cos(ang) * rr, iy + Math.sin(ang) * rr]);
      }
      return pts;
    });
    void n;
    const at = (k: number, rad: number): [number, number] => {
      const pts = this.rays[k % this.rays.length]!;
      for (let i = 1; i < pts.length; i++) {
        const r0 = Math.hypot(pts[i - 1]![0] - ix, pts[i - 1]![1] - iy), r1 = Math.hypot(pts[i]![0] - ix, pts[i]![1] - iy);
        if (r1 >= rad) { const u = (rad - r0) / Math.max(1e-3, r1 - r0); return [lerp(pts[i - 1]![0], pts[i]![0], u), lerp(pts[i - 1]![1], pts[i]![1], u)]; }
      }
      return pts[pts.length - 1]!;
    };
    const along = (k: number, a: number, b: number) => {
      const pts = this.rays[k]!, out: [number, number][] = [at(k, a)];
      for (const p of pts) { const d = Math.hypot(p[0] - ix, p[1] - iy); if (d > a && d < b) out.push(p); }
      out.push(at(k, b));
      return out;
    };
    const N = this.rays.length;
    for (let j = 0; j < this.rings.length - 1; j++) for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N, a = this.rings[j]!, b = this.rings[j + 1]!;
      const poly: [number, number][] = [...along(k, a, b), ...along(k2, a, b).reverse()];
      let cx = 0, cy = 0;
      for (const p of poly) { cx += p[0]; cy += p[1]; }
      this.shards.push({ poly, c: [cx / poly.length, cy / poly.length], ring: j, rot: (r() - 0.5) * 0.05 });
    }
  }

  private buildWall(E: Line) {
    const all = this.ctx.lyrics.words;
    const first = E.words[0]!.gi, last = E.words[E.words.length - 1]!.gi;
    const lay = (size: number) => {
      const sp = this.meas(' ', PHOS_FONT, size) * 1.25;
      const rows: { w: string; x: number; gi: number }[][] = [[]];
      let x = 0;
      for (const wd of all) {
        const wi = this.meas(wd.w, PHOS_FONT, size);
        const brk = wd.gi === first || wd.gi === last + 1;
        if ((x + wi > 1840 || brk) && rows[rows.length - 1]!.length) { rows.push([]); x = 0; }
        rows[rows.length - 1]!.push({ w: wd.w, x, gi: wd.gi }); x += wi + sp;
      }
      return rows;
    };
    let size = 52, rows = lay(size);
    while (rows.length * size * 1.3 > 1020 && size > 20) { size -= 1; rows = lay(size); }
    this.wallSize = size;
    const lh = size * 1.3, top = (H - rows.length * lh) / 2;
    rows.forEach((row, ri) => {
      const last = row[row.length - 1]!;
      const rw = last ? last.x + this.meas(last.w, PHOS_FONT, size) : 0;
      for (const o of row) this.wall.push({ text: o.w, x: CX - rw / 2 + o.x, y: top + (ri + 0.78) * lh, gi: o.gi });
      if (row[0] && row[0].gi === first) this.phrase = { x: CX, y: top + (ri + 0.5) * lh, w: rw };
    });
    this.wallBox = { x0: 0, y0: top, x1: W, y1: top + rows.length * lh };
  }

  // ------------------------------------------------------------------------------------------ drawing helpers
  private heat(w: Word, t: number, tau = 0.35) { return t < w.start ? 0 : Math.exp(-(t - w.start) / tau); }
  private slam(w: Word, t: number, k = 0.16, d = 0.12) { const a = t - w.start; return a < 0 ? 1 : 1 + k * Math.pow(1 - clamp(a / d), 3); }
  /** fill a word (scaled about its centre by s) */
  private word(c: CanvasRenderingContext2D, b: Box, fill: string | CanvasGradient, s = 1, mode: 'fill' | 'cut' = 'fill', stroke = 0) {
    c.save();
    c.font = font(b.fam, b.size);
    c.textBaseline = 'alphabetic';
    const cx = b.x + b.width / 2, cy = b.y - b.size * 0.36;
    c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy);
    if (mode === 'cut') c.globalCompositeOperation = 'destination-out';
    if (stroke > 0) { c.lineWidth = stroke; c.lineJoin = 'round'; c.strokeStyle = fill; c.strokeText(b.text, b.x, b.y); }
    c.fillStyle = fill;
    c.fillText(b.text, b.x, b.y);
    c.restore();
  }
  private glowDot(c: CanvasRenderingContext2D, x: number, y: number, r: number, col: RGB, a: number) {
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, css(col, a)); g.addColorStop(0.3, css(col, a * 0.35)); g.addColorStop(1, css(col, 0));
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  /** a beam of light from o toward angle a, half-width hw (rad) */
  private beam(c: CanvasRenderingContext2D, o: [number, number], a: number, hw: number, len: number, col: RGB, k: number) {
    if (k <= 0.003) return;
    c.save();
    c.translate(o[0], o[1]); c.rotate(a);
    const g = c.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, css(col, 0.55 * k)); g.addColorStop(0.45, css(col, 0.22 * k)); g.addColorStop(1, css(col, 0));
    c.fillStyle = g;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(len, -Math.tan(hw) * len); c.lineTo(len, Math.tan(hw) * len); c.closePath(); c.fill();
    // the hard core of the beam
    const g2 = c.createLinearGradient(0, 0, len, 0);
    g2.addColorStop(0, css(mix(col, HOT, 0.6), 0.6 * k)); g2.addColorStop(0.6, css(col, 0.12 * k)); g2.addColorStop(1, css(col, 0));
    c.fillStyle = g2;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(len, -Math.tan(hw * 0.3) * len); c.lineTo(len, Math.tan(hw * 0.3) * len); c.closePath(); c.fill();
    c.restore();
  }
  private goldOf(h: number): RGB { return mix(GOLD, HOT, clamp(h)); }
  /** gold with a polished sheen: a bright diagonal band that crosses the frame after every downbeat */
  private sheen(c: CanvasRenderingContext2D, t: number, h: number, a = 1): string | CanvasGradient {
    const au = this.ctx.audio;
    const bi = Math.floor(au.barAt(t) + 0.01);
    const db = au.downbeats[bi] ?? t;
    const u = (t - db) / 0.42;
    const base = css(this.goldOf(h), a);
    if (u < 0 || u > 1) return base;
    const x = lerp(-500, W + 500, ease.inOutQuad(u));
    const g = c.createLinearGradient(x - 260, 0, x + 260, 180);
    const band = css(mix(this.goldOf(h), HOT, 0.85), a);
    g.addColorStop(0, base); g.addColorStop(0.42, base); g.addColorStop(0.5, band); g.addColorStop(0.58, base); g.addColorStop(1, base);
    return g;
  }

  // ------------------------------------------------------------------------------------------ the lines
  private line1(c: CanvasRenderingContext2D, t: number, A: Line) {
    const ws = A.words;
    const tInv = ws[3]!.start, tTo = ws[5]!.start;
    if (t < tInv) {
      // the bridge's gold, a full field; the words punched out of it in black
      const k = 1 - 0.18 * prog(t, A.start, tInv);
      const g = c.createRadialGradient(CX, 520, 100, CX, 520, 1200);
      g.addColorStop(0, css(GOLD, 1)); g.addColorStop(1, css(mix(GOLD, AMBER, 0.45), k));
      c.fillStyle = A.start + 0.06 > t ? css(GOLD, 1) : g;
      c.fillRect(0, 0, W, H);
      for (const b of this.l1a) if (t >= b.w.start - 0.01) this.word(c, b, '#000', this.slam(b.w, t, 0.12), 'cut');
      return;
    }
    if (t < tTo) {
      // inverted: black, the words in gold (the flash of the inversion is the post flash)
      for (const b of this.l1a) if (t >= b.w.start - 0.01) {
        const h = Math.max(this.heat(b.w, t), t - tInv < 0.12 ? 0.7 : 0);
        this.word(c, b, this.sheen(c, t, h), this.slam(b.w, t, 0.12));
      }
      return;
    }
    // "to DANCE": a sunburst whose rays jump half a step on every beat
    const au = this.ctx.audio;
    const beat = Math.floor(au.beatAt(t) + 0.02);
    const N = 18, o: [number, number] = [CX, 520];
    const rot = (t - tTo) * 0.22 + (beat % 2) * (Math.PI / N);
    const kick = this.ctx.audio.hit('kick', t, 0.1);
    const on = smoothstep(tTo - 0.02, tTo + 0.06, t);
    c.save();
    c.translate(o[0], o[1]);
    for (let i = 0; i < N; i++) {
      const a = rot + (i * TAU) / N, hw = 0.055;
      const len = 1500;
      const g = c.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      g.addColorStop(0, css(HOT, 0.75 * on)); g.addColorStop(0.18, css(GOLD, (0.42 + 0.25 * kick) * on)); g.addColorStop(1, css(AMBER, 0));
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a - hw) * len, Math.sin(a - hw) * len); c.lineTo(Math.cos(a + hw) * len, Math.sin(a + hw) * len); c.closePath(); c.fill();
    }
    c.restore();
    this.glowDot(c, o[0], o[1], 520, GOLD, 0.35 * on);
    for (const b of this.l1dance) {
      if (t < b.w.start - 0.01) continue;
      // a black margin cut round the letters, then the gold
      this.word(c, b, '#000', this.slam(b.w, t, 0.1), 'cut', b.size * 0.09);
      this.word(c, b, this.sheen(c, t, this.heat(b.w, t, 0.25) + 0.25 * kick), this.slam(b.w, t, 0.1));
    }
  }

  private line2(c: CanvasRenderingContext2D, t: number, B: Line) {
    const row1 = this.l2.slice(0, 6), row2 = this.l2.slice(6);
    const O: [number, number] = [CX, 1290];
    const tgt = (b: Box): [number, number] => [b.x + b.width / 2, b.y - b.size * 0.35];
    const ang = (o: [number, number], p: [number, number]) => Math.atan2(p[1] - o[1], p[0] - o[0]);
    // the searchlight finds each word of the first row as it is sung
    const aOf = (tt: number) => {
      const ts = row1.map((b) => b.w.start), as = row1.map((b) => ang(O, tgt(b)));
      if (tt <= ts[0]!) return as[0]! - 0.5 * (1 - prog(tt, ts[0]! - 0.35, ts[0]!, ease.outCubic));
      for (let i = 0; i < ts.length - 1; i++) if (tt < ts[i + 1]!) return lerp(as[i]!, as[i + 1]!, prog(tt, lerp(ts[i]!, ts[i + 1]!, 0.45), ts[i + 1]!, ease.inOutCubic));
      return as[as.length - 1]!;
    };
    const t1End = row2[0]!.w.start;
    const k1 = smoothstep(B.start - 0.4, B.start - 0.1, t) * (1 - smoothstep(t1End - 0.05, t1End + 0.2, t));
    this.beam(c, O, aOf(t), 0.05, 1900, GOLD, k1);
    // two beams from the corners for "take my hand", crossing on "hand"
    const [take, my, hand] = row2 as [Box, Box, Box];
    const OL: [number, number] = [-160, 1220], OR: [number, number] = [W + 160, 1220];
    const aL = lerp(ang(OL, tgt(take)), ang(OL, tgt(hand)), prog(t, hand.w.start - 0.22, hand.w.start, ease.inOutCubic));
    const aR = lerp(ang(OR, tgt(my)), ang(OR, tgt(hand)), prog(t, hand.w.start - 0.18, hand.w.start, ease.inOutCubic));
    const kL = smoothstep(take.w.start - 0.25, take.w.start - 0.02, t), kR = smoothstep(my.w.start - 0.22, my.w.start - 0.02, t);
    this.beam(c, OL, aL - 0.25 * (1 - kL), 0.04, 2300, GOLD, kL);
    this.beam(c, OR, aR + 0.25 * (1 - kR), 0.04, 2300, GOLD, kR);
    // the words: charged by the light, the first row then glows on in the clip's phosphor green
    for (const b of row1) {
      if (t < b.w.start - 0.01) continue;
      const age = t - b.w.start;
      const h = Math.exp(-age / 0.18);
      const col = mix(mix(GOLD, PHOS, smoothstep(0.05, 0.6, age)), HOT, h);
      const lvl = 0.75 + 0.25 * Math.exp(-age / 2.5);
      this.word(c, b, css(col, lvl), this.slam(b.w, t, 0.08));
      if (age < 0.4) this.glowDot(c, ...tgt(b), b.size * 1.6, HOT, 0.5 * h);
    }
    for (const b of row2) {
      if (t < b.w.start - 0.01) continue;
      const h = this.heat(b.w, t, 0.3);
      this.word(c, b, css(this.goldOf(h)), this.slam(b.w, t, b === hand ? 0.18 : 0.1));
    }
    // where the beams cross: a flare
    const fl = t < hand.w.start ? 0 : Math.exp(-(t - hand.w.start) / 0.35);
    if (fl > 0.01) {
      const [hx, hy] = tgt(hand);
      this.glowDot(c, hx, hy, 700, GOLD, 0.6 * fl);
      c.save(); c.translate(hx, hy);
      for (let i = 0; i < 4; i++) {
        c.rotate(Math.PI / 4);
        const g = c.createLinearGradient(-900, 0, 900, 0);
        g.addColorStop(0, css(GOLD, 0)); g.addColorStop(0.5, css(HOT, 0.8 * fl)); g.addColorStop(1, css(GOLD, 0));
        c.fillStyle = g; c.fillRect(-900, -2, 1800, 4);
      }
      c.restore();
    }
  }

  private line3(c: CanvasRenderingContext2D, t: number, C: Line) {
    const ws = C.words;
    const tBr = ws[1]!.start, tPc = ws[2]!.start, tBe = ws[3]!.start, tSt = ws[5]!.start;
    const [ix, iy] = this.imp;
    const slab = { x0: CX - 790, y0: iy - 175, x1: CX + 790, y1: iy + 175 };
    // how far the shards are apart: a jump on "broken", further on "piece", the gold pulls them back on "becomes"
    const apart = t < tBr ? 0 : (ease.outCubic(prog(t, tBr, tBr + 0.07)) + 0.7 * ease.outCubic(prog(t, tPc, tPc + 0.07))) * (1 - ease.inOutCubic(prog(t, tBe + 0.05, tBe + 0.55)));
    const broken = t >= tBr;
    const gold = prog(t, tBe, tBe + 0.5, ease.outCubic);
    const star = t < tSt ? 0 : 1;
    const drawSlab = (cc: CanvasRenderingContext2D) => {
      const g = cc.createLinearGradient(0, slab.y0, 0, slab.y1);
      g.addColorStop(0, 'rgba(16,10,5,1)'); g.addColorStop(0.5, 'rgba(7,4,2,1)'); g.addColorStop(1, 'rgba(3,2,1,1)');
      cc.fillStyle = g; cc.fillRect(slab.x0, slab.y0, slab.x1 - slab.x0, slab.y1 - slab.y0);
      cc.strokeStyle = css(GOLD, 0.6); cc.lineWidth = 1.5; cc.strokeRect(slab.x0 + 1, slab.y0 + 1, slab.x1 - slab.x0 - 2, slab.y1 - slab.y0 - 2);
      for (const b of this.l3a) if (t >= b.w.start - 0.01) this.word(cc, b, css(this.goldOf(this.heat(b.w, t, 0.3) * 0.9)), this.slam(b.w, t, 0.1));
    };
    if (!broken) drawSlab(c);
    else {
      for (const s of this.shards) {
        const dx = s.c[0] - ix, dy = s.c[1] - iy, dl = Math.hypot(dx, dy) || 1;
        const d = (7 + 9 * s.ring) * apart;
        c.save();
        c.translate(dx / dl * d, dy / dl * d);
        c.translate(s.c[0], s.c[1]); c.rotate(s.rot * apart); c.translate(-s.c[0], -s.c[1]);
        c.beginPath(); s.poly.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath();
        c.clip();
        drawSlab(c);
        c.restore();
      }
      // the crack flash, then gold running out along the cracks from the impact
      const fl = Math.exp(-(t - tBr) / 0.06) + 0.6 * (t >= tPc ? Math.exp(-(t - tPc) / 0.05) : 0);
      const reach = 1800 * gold;
      c.save();
      c.beginPath(); c.rect(slab.x0 - 4, slab.y0 - 4, slab.x1 - slab.x0 + 8, slab.y1 - slab.y0 + 8); c.clip();
      c.lineJoin = 'round'; c.lineCap = 'round';
      const path = (lim: number) => {
        const p = new Path2D();
        for (const ray of this.rays) {
          p.moveTo(ray[0]![0], ray[0]![1]);
          for (let i = 1; i < ray.length; i++) {
            const r0 = Math.hypot(ray[i - 1]![0] - ix, ray[i - 1]![1] - iy), r1 = Math.hypot(ray[i]![0] - ix, ray[i]![1] - iy);
            if (r1 <= lim) p.lineTo(ray[i]![0], ray[i]![1]);
            else { const u = clamp((lim - r0) / (r1 - r0)); p.lineTo(lerp(ray[i - 1]![0], ray[i]![0], u), lerp(ray[i - 1]![1], ray[i]![1], u)); break; }
          }
        }
        // ring cracks between neighbouring rays, once the gold has passed them
        for (let j = 1; j < this.rings.length - 1; j++) {
          if (this.rings[j]! > lim) break;
          for (let k = 0; k < this.rays.length; k++) {
            const a = this.shards[j * this.rays.length + k]?.poly;
            if (!a) continue;
            const s = this.shards[(j - 1) * this.rays.length + k]!.poly;
            const n = s.length;
            p.moveTo(s[Math.floor(n / 2) - 1]![0], s[Math.floor(n / 2) - 1]![1]); p.lineTo(s[Math.floor(n / 2)]![0], s[Math.floor(n / 2)]![1]);
          }
        }
        return p;
      };
      if (fl > 0.02) { c.strokeStyle = css(HOT, fl); c.lineWidth = 3; c.stroke(path(2400)); }
      if (gold > 0) {
        const p = path(reach);
        const hot = Math.exp(-Math.max(0, t - tBe - 0.5) / 0.6) + 1.2 * star * Math.exp(-(t - tSt) / 0.4);
        c.strokeStyle = css(AMBER, 0.9); c.lineWidth = 9; c.stroke(p);
        c.strokeStyle = css(GOLD, 1); c.lineWidth = 5; c.stroke(p);
        c.strokeStyle = css(HOT, clamp(0.4 + 0.6 * hot)); c.lineWidth = 2; c.stroke(p);
      }
      c.restore();
    }
    // "becomes a star" and the star sticker
    for (const b of this.l3b) if (t >= b.w.start - 0.01) this.word(c, b, this.sheen(c, t, this.heat(b.w, t, 0.3)), this.slam(b.w, t, 0.12));
    if (star) {
      const a = t - tSt;
      const R = 105 * ease.outCubic(clamp(a / 0.16));
      const sy = lerp(iy, 170, ease.outCubic(clamp(a / 0.32)));
      this.glowDot(c, ix, sy, 650, GOLD, 0.55 * Math.exp(-a / 0.5) + 0.2);
      // the seam it rose along
      c.fillStyle = css(HOT, 0.8 * Math.exp(-a / 0.4)); c.fillRect(ix - 1.5, sy, 3, Math.max(0, iy - sy - R * 0.4));
      c.save();
      c.beginPath(); starPath(c, ix, sy, R, 0, 0.46);
      c.fillStyle = css(this.goldOf(Math.exp(-a / 0.3))); c.fill();
      c.lineJoin = 'round'; c.lineWidth = 6; c.strokeStyle = css(HOT, 0.9); c.stroke();
      c.restore();
    }
  }

  private line4(c: CanvasRenderingContext2D, t: number, D: Line) {
    const hz = 742;
    const tB = D.words[2]!.start;
    const sy = lerp(1160, 640, prog(t, D.start - 0.1, tB + 0.6, ease.outCubic)) - 40 * prog(t, tB + 0.6, D.end + 0.4);
    const R = 360;
    // god rays
    c.save();
    c.beginPath(); c.rect(0, 0, W, hz); c.clip();
    c.translate(CX, sy);
    const rot = t * 0.05;
    for (let i = 0; i < 14; i++) {
      const a = rot + (i * TAU) / 14, hw = 0.035 + 0.02 * hash(i, 3), len = 1600;
      const g = c.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      g.addColorStop(0, css(GOLD, 0)); g.addColorStop(0.22, css(GOLD, 0.2)); g.addColorStop(1, css(AMBER, 0));
      c.fillStyle = g;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a - hw) * len, Math.sin(a - hw) * len); c.lineTo(Math.cos(a + hw) * len, Math.sin(a + hw) * len); c.closePath(); c.fill();
    }
    c.restore();
    // the sun above the horizon
    c.save();
    c.beginPath(); c.rect(0, 0, W, hz); c.clip();
    this.glowDot(c, CX, sy, R * 2.6, AMBER, 0.5);
    const g = c.createRadialGradient(CX, sy, 0, CX, sy, R);
    g.addColorStop(0, css(HOT, 1)); g.addColorStop(0.55, css(mix(GOLD, HOT, 0.4), 1)); g.addColorStop(0.92, css(GOLD, 1)); g.addColorStop(1, css(AMBER, 1));
    c.fillStyle = g; c.beginPath(); c.arc(CX, sy, R, 0, TAU); c.fill();
    c.restore();
    // its reflection: stripes on the water below the horizon
    for (let y = hz + 6, i = 0; y < H; y += 10 + i * 0.6, i++) {
      const my = hz - (y - hz) * 1.1;   // mirrored height on the sun
      const dy = my - sy;
      const half = Math.abs(dy) < R ? Math.sqrt(R * R - dy * dy) : 0;
      const wob = 0.75 + 0.5 * hash(i, 7);
      const hw = half * wob + 30 * (1 - Math.abs(dy) / (R * 3));
      if (hw <= 2) continue;
      const a = 0.85 * Math.exp(-(y - hz) / 260);
      const lg = c.createLinearGradient(CX - hw, 0, CX + hw, 0);
      lg.addColorStop(0, css(GOLD, 0)); lg.addColorStop(0.5, css(mix(GOLD, HOT, 0.5), a)); lg.addColorStop(1, css(GOLD, 0));
      c.fillStyle = lg; c.fillRect(CX - hw + (hash(i, 9) - 0.5) * 40, y, hw * 2, 3 + 2 * hash(i, 8));
    }
    // the horizon
    c.fillStyle = css(HOT, 0.9); c.fillRect(0, hz - 1, W, 2);
    this.glowDot(c, CX, hz, 900, GOLD, 0.25);
    // the words
    const [look, how, beau, we, are] = this.l4 as [Box, Box, Box, Box, Box];
    for (const b of [look, how]) if (t >= b.w.start - 0.01) this.word(c, b, css(this.goldOf(this.heat(b.w, t, 0.3))), this.slam(b.w, t, 0.1));
    if (t >= beau.w.start - 0.01) {
      const s = this.slam(beau.w, t, 0.06, 0.1);
      this.word(c, beau, '#000', s, 'cut', 10);
      // a thin gold rim so the silhouette holds outside the sun too
      c.save();
      c.font = font(beau.fam, beau.size);
      const cx = beau.x + beau.width / 2, cy = beau.y - beau.size * 0.36;
      c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy);
      c.lineWidth = 2.2; c.strokeStyle = css(mix(GOLD, HOT, this.heat(beau.w, t, 0.4)), 0.85); c.lineJoin = 'round';
      c.strokeText(beau.text, beau.x, beau.y);
      c.restore();
    }
    for (const b of [we, are]) if (t >= b.w.start - 0.01) {
      this.word(c, b, '#000', this.slam(b.w, t, 0.1), 'cut', 16);
      this.word(c, b, this.sheen(c, t, this.heat(b.w, t, 0.3)), this.slam(b.w, t, 0.1));
    }
  }

  /** the wall camera: zoom about the phrase, stepping back on beats during the held "glowing" */
  private wallCam(t: number, E: Line) {
    const au = this.ctx.audio;
    const tg = E.words[2]!.start;
    const z0 = 1500 / Math.max(200, this.phrase.w);
    const bs = au.beats.filter((b) => b > tg + 0.25 && b < E.words[3]!.start - 0.1);
    const steps = [z0, z0 * 0.55, z0 * 0.3, Math.max(1.6, z0 * 0.17), 1.0];
    const times = [bs[0], bs[2], bs[3], bs[5]].filter((x): x is number => x !== undefined);
    let z = steps[0]!;
    times.forEach((tb, i) => { const u = prog(t, tb, tb + 0.13, (x) => ease.outBack(x, 1.2)); z = Math.exp(lerp(Math.log(z), Math.log(steps[i + 1]!), u)); });
    if (t > E.words[5]!.start) z *= 1 - 0.04 * prog(t, E.words[5]!.start, E.end, ease.inCubic);
    const k = clamp((Math.log(z0) - Math.log(z)) / Math.max(1e-3, Math.log(z0)));
    const cy = lerp(this.phrase.y, (this.wallBox.y0 + this.wallBox.y1) / 2, k);
    return { z, cy, k, times };
  }

  private line5(c: CanvasRenderingContext2D, t: number, E: Line) {
    const { z, cy, times } = this.wallCam(t, E);
    const tDark = E.words[5]!.start;
    const all = this.ctx.lyrics.words;
    const first = E.words[0]!.gi;
    // wave fronts of charge from the line outward, one per camera step
    const fronts = times.map((tb) => (t > tb ? (t - tb) * 1900 : -1));
    const burst = t < tDark ? 0 : Math.exp(-(t - tDark) / 0.3);
    c.save();
    c.translate(CX, 540); c.scale(z, z); c.translate(-CX, -cy);
    c.font = font(PHOS_FONT, this.wallSize);
    c.textBaseline = 'alphabetic';
    const z0 = 1500 / Math.max(200, this.phrase.w);
    for (const w of this.wall) {
      const inLine = w.gi >= first && w.gi < first + E.words.length;
      if (inLine && z > z0 * 0.97) continue;
      const d = Math.hypot(w.x - CX, (w.y - this.phrase.y) * 1.6);
      let lit = 0, flash = 0;
      for (const f of fronts) if (f > 0 && d < f) { lit = 1; flash = Math.max(flash, Math.exp(-(f - d) / 160)); }
      if (inLine) { const ww = all[w.gi]!; lit = t >= ww.start ? 1 : 0; flash = this.heat(ww, t, 0.3); }
      const a = lit ? 0.62 + 0.38 * flash : 0.075 / Math.pow(z, 0.45);
      const col = mix(lit ? GOLD : AMBER, HOT, Math.max(flash, burst));
      c.fillStyle = css(col, Math.min(1, a + burst * 0.5));
      c.fillText(w.text, w.x, w.y);
    }
    c.restore();
    // the line itself stays big in front: darkness cut behind it, then the words
    const dk = smoothstep(times[0] ?? 999, (times[0] ?? 999) + 0.1, t);
    if (dk > 0) {
      c.save();
      c.globalCompositeOperation = 'destination-out';
      c.filter = 'blur(30px)';
      c.fillStyle = `rgba(0,0,0,${0.92 * dk})`;
      for (const b of this.l5) if (t >= b.w.start - 0.01) { c.font = font(b.fam, b.size); c.lineWidth = 50; c.lineJoin = 'round'; c.strokeStyle = c.fillStyle; c.strokeText(b.text, b.x, b.y); c.fillText(b.text, b.x, b.y); }
      c.restore();
    }
    for (const b of this.l5) {
      if (t < b.w.start - 0.01) continue;
      // before the first step the phrase is the wall's own line: the overlay fades in as the wall falls back
      const h = Math.max(this.heat(b.w, t, 0.3), burst);
      this.word(c, b, css(this.goldOf(h)), this.slam(b.w, t, b.w === E.words[5] ? 0.14 : 0.08));
    }
    // "dark!": the whole frame burns to gold
    const fl = smoothstep(tDark + 0.05, this.ctx.end + 0.02, t);
    if (fl > 0) { c.fillStyle = css(mix(GOLD, HOT, 0.5), fl * 0.9); c.fillRect(0, 0, W, H); }
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides | void {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t;
    const c = this.L.ctx;
    this.L.clear('#000');
    const Ls = this.lines;
    if (Ls.length < 5) { clearRT(renderer, out); return; }
    let li = 0;
    for (let i = 1; i < 5; i++) if (t >= Ls[i]!.start - 0.01) li = i;
    c.save();
    c.globalCompositeOperation = 'lighter';
    // camera: a slow push per line, a step in on each downbeat in "dance"
    const Lc = Ls[li]!;
    let z = 1 + 0.035 * prog(t, Lc.start, Lc.end + 0.3);
    if (li === 0 && t >= Lc.words[5]!.start) {
      const dbs = au.downbeats.filter((d) => d > Lc.words[5]!.start && d < Lc.end);
      z = 1 + 0.02 * prog(t, Lc.words[5]!.start, Lc.end);
      for (const d of dbs) z *= 1 + 0.06 * ease.outCubic(prog(t, d, d + 0.1));
    }
    if (li === 0 && t >= Lc.words[3]!.start && t < Lc.words[5]!.start) for (const w of Lc.words.slice(3, 5)) z *= 1 + 0.045 * ease.outCubic(prog(t, w.start, w.start + 0.09));
    if (li !== 4) { c.translate(CX, 540); c.scale(z, z); c.translate(-CX, -540); }
    if (li === 0) this.line1(c, t, Ls[0]!);
    else if (li === 1) this.line2(c, t, Ls[1]!);
    else if (li === 2) this.line3(c, t, Ls[2]!);
    else if (li === 3) this.line4(c, t, Ls[3]!);
    else this.line5(c, t, Ls[4]!);
    c.restore();
    // glow: a soft half-res copy
    const g = this.G.ctx;
    this.G.clear('#000');
    g.filter = 'blur(9px)';
    g.drawImage(this.L.canvas, 0, 0, W / 2, H / 2);
    g.filter = 'none';
    clearRT(renderer, out, [0, 0, 0], 1);
    comp.draw(renderer, this.L.upload(), out, { mode: 'add', tint: [FLARE_OPACITY, FLARE_OPACITY, FLARE_OPACITY] });
    comp.draw(renderer, this.G.upload(), out, { mode: 'add', opacity: li === 0 && t < Ls[0]!.words[3]!.start ? 0.2 : 0.55 });
    // punches: kicks push in, the line cuts and "broken" hit hard
    const kick = f.a.kick;
    const W3 = Ls[2]!.words;
    const brk = t >= W3[1]!.start ? Math.exp(-(t - W3[1]!.start) / 0.09) : 0;
    const inv = t >= Ls[0]!.words[3]!.start ? Math.exp(-(t - Ls[0]!.words[3]!.start) / 0.05) : 0;
    let cut = 0;
    for (const l of Ls) if (t >= l.start) cut = Math.exp(-(t - l.start) / 0.07);
    const fi = frameIdx(t), sh = 3 * kick + 16 * brk + 5 * cut;
    return {
      bloom: 0.5, bloomThreshold: 0.9, bloomRadius: 0.6, vignette: 0.4, grain: 0.035, halation: 0.08,
      ca: 0.6 + 1.5 * brk + 0.8 * cut,
      zoom: 1 + 0.014 * kick + 0.03 * cut + 0.04 * brk,
      shake: [(hash(fi, 1) - 0.5) * 2 * sh, (hash(fi, 2) - 0.5) * 2 * sh],
      flash: 0.25 * inv + 0.12 * brk,
    };
  }
}
