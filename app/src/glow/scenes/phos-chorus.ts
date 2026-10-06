// CHORUS in phosphor: every line is its own material. The scene opens on the star the pre-chorus ignited
// (960, 540, r 140): it bursts into the field of stickers that stays all chorus, charged by the kicks.
//   dance          "okay to dance"            letters jump crooked on every kick (earlier poses afterglow behind them)
//   lock           "glowing in the dark, take my hand"  two rows slide in from opposite sides and lock into a chain link
//   crack          "broken piece becomes a star"   the word cracks into shards that become stars and rise
//   constellation  "Look how beautiful we are"   stroke-font letters drawn as stars joined by lines
//   rise           "never coming down"        words climb a zig-zag stair, the camera follows, stars stream by
//   wave           "wake the whole town"      a huge waveform of the vocal sweeps the frame; the words are lit where it passes
//   charge         "glowing in the dark"      a UV flash charges everything; the held note lights the letters one by one
//
// params.moments: names per sung line of the window, in order (default: chorus 1's eight lines). The final chorus can
// pass e.g. ['dance','lock','crack','constellation','charge'] (or any other order) for its five lines.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import type { Line, Word } from '../../engine/lyrics';
import { W, H } from '../../engine/gl';
import { layout, type TextLayout } from '../../engine/type';
import { strokeText, type StrokeText } from '../../engine/stroke';
import { clamp, ease, hash, lerp, prog, smoothstep, TAU } from '../../engine/util';
import { inOutSine, PhosphorStage, glowAt, uvEvents, uvPulse, layoutWords, drawWord, loadPhosphorFont, mixTone, phosphorCss, starPath, wordCharges, PHOS_FONT, type Charge, type Tone, type Glow } from '../lib/phosphor';
import { charTimes } from '../lib/lightpaint';

const CX = W / 2, CY = H / 2;
export type Moment = 'dance' | 'lock' | 'crack' | 'constellation' | 'rise' | 'wave' | 'charge';
export const CHORUS1_MOMENTS: Moment[] = ['dance', 'lock', 'crack', 'constellation', 'rise', 'wave', 'dance', 'charge'];
const IGN = { x: CX, y: CY, r: 140 }; // phos-pre's ignition star

interface Shard { poly: [number, number][]; cx: number; cy: number; area: number; dir: [number, number] }

/** Sutherland-Hodgman: polygon clipped to the half-plane (p - a) . n >= 0. */
function clipHalf(poly: [number, number][], a: [number, number], n: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  const side = (p: [number, number]) => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!, sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) { const u = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]); }
  }
  return out;
}

export default class PhosChorus extends Scene {
  st!: PhosphorStage;
  uv: Charge[] = [];
  kicks: Charge[] = [];
  lines: Line[] = [];
  moments: Moment[] = [];
  kick: [number, number][] = [];
  bg: { x: number; y: number; s: number; r: number; k: number; vx: number; vy: number; gold: boolean }[] = [];
  lay = new Map<Line, { boxes: { i: number; text: string; x: number; y: number; w: number }[]; height: number; tl: TextLayout[] }>();
  size = 150;
  // per-moment data
  shards: Shard[] = [];
  crackBox = { x: 0, y: 0, w: 0, h: 0 };
  con?: { st: StrokeText; stars: { x: number; y: number; s: number; len: number; stroke: number }[]; ct: [number, number][]; ox: number; oy: number };
  stair: { x: number; y: number }[] = [];
  vNorm = 1;
  tBig = 0; // the big UV flash of the last line

  override async init() {
    await loadPhosphorFont();
    const { lyrics, audio, params, start, end } = this.ctx;
    this.st = new PhosphorStage(this.ctx, 3600);
    this.lines = lyrics.linesIn(start - 0.3, end + 0.2).filter((l) => !l.kind && l.start >= start - 0.4 && l.start < end - 0.2);
    this.moments = (params.moments as Moment[] | undefined) ?? CHORUS1_MOMENTS;
    this.uv = uvEvents(audio, start - 1, end + 0.5, { thr: 0.7 });
    this.kick = audio.events('kick', start - 1, end + 0.5).filter(([, s]) => s >= 0.45);
    this.size = 150;

    for (const [li, l] of this.lines.entries()) {
      const m = this.moments[li];
      const words = l.words.map((w) => w.w);
      if (m === 'dance' || m === 'crack' || m === 'charge') {
        const size = m === 'charge' ? 190 : 156;
        const lay = layoutWords(words, size, { maxW: 1560 });
        this.lay.set(l, { boxes: lay.boxes.map((b) => ({ ...b, y: b.y - lay.height * 0.5 + size * 0.34 })), height: lay.height, tl: words.map((w) => layout(w, PHOS_FONT, size)) });
      }
      if (m === 'crack') {
        const b = this.lay.get(l)!.boxes[l.words.findIndex((w) => /^broken/i.test(w.w))]!;
        const sz = this.lay.get(l)!.tl[0]!.size;
        this.crackBox = { x: CX + b.x, y: CY + b.y - sz * 0.85, w: b.w, h: sz * 1.15 };
        this.makeShards(li);
      }
      if (m === 'constellation') this.makeConstellation(l);
      if (m === 'rise') this.makeStair(l);
      if (m === 'wave') this.vNorm = Math.max(0.2, ...Array.from({ length: 80 }, (_, i) => audio.env('vocal', l.start + ((l.end - l.start) * i) / 79)));
      if (m === 'charge') this.tBig = (l.words.find((w) => /^glo/i.test(w.w)) ?? l.words[0]!).start;
    }

    for (let i = 0; i < 620; i++) this.bg.push({
      x: hash(i, 1, 4) * W, y: hash(i, 2, 4) * H, s: 5 + 17 * Math.pow(hash(i, 3, 4), 2.4), r: hash(i, 4, 4) * TAU, k: 0.3 + 0.7 * hash(i, 5, 4),
      vx: (hash(i, 6, 4) - 0.5) * 10, vy: -6 - hash(i, 7, 4) * 10, gold: hash(i, 8, 4) < 0.07,
    });
  }

  // ----------------------------------------------------------------------------------- setup helpers
  private makeShards(li: number) {
    const b = this.crackBox;
    const seeds: [number, number][] = [];
    for (let i = 0; i < 6; i++) seeds.push([b.x + b.w * (0.08 + 0.84 * ((i + 0.2 + 0.6 * hash(i, 77)) / 6)), b.y + b.h * (0.2 + 0.6 * hash(i, 78))]);
    seeds.forEach((s, i) => {
      let poly: [number, number][] = [[b.x - 20, b.y - 30], [b.x + b.w + 20, b.y - 30], [b.x + b.w + 20, b.y + b.h + 40], [b.x - 20, b.y + b.h + 40]];
      seeds.forEach((o, j) => {
        if (i === j) return;
        const mid: [number, number] = [(s[0] + o[0]) / 2, (s[1] + o[1]) / 2], n: [number, number] = [s[0] - o[0], s[1] - o[1]];
        // wobble the bisector so the cracks are jagged: shift the plane per pair
        mid[0] += (hash(i, j, 5) - 0.5) * 14;
        poly = clipHalf(poly, mid, n);
      });
      const cx = poly.reduce((a, p) => a + p[0], 0) / Math.max(1, poly.length), cy = poly.reduce((a, p) => a + p[1], 0) / Math.max(1, poly.length);
      let area = 0;
      poly.forEach((p, k) => { const q = poly[(k + 1) % poly.length]!; area += p[0] * q[1] - q[0] * p[1]; });
      const dl = Math.hypot(cx - (b.x + b.w / 2), cy - (b.y + b.h / 2)) || 1;
      this.shards.push({ poly, cx, cy, area: Math.abs(area) / 2, dir: [(cx - (b.x + b.w / 2)) / dl * 0.6 + (hash(i, 3) - 0.5), (cy - (b.y + b.h / 2)) / dl * 0.6 - 0.5] });
    });
    void li;
  }

  private makeConstellation(l: Line) {
    const text = l.words.map((w) => w.w).join(' ');
    let st = strokeText(text, 'readable', 190);
    if (st.width > 1640) st = strokeText(text, 'readable', 190 * 1640 / st.width);
    const ox = CX - st.width / 2, oy = CY + st.capHeight * 0.5;
    const stars: { x: number; y: number; s: number; len: number; stroke: number }[] = [];
    st.strokes.forEach((pts, si) => {
      let run = 0, last = 0;
      pts.forEach((p, k) => {
        if (k) run += Math.hypot(p.x - pts[k - 1]!.x, p.y - pts[k - 1]!.y);
        const end = k === 0 || k === pts.length - 1;
        if (end || run - last > 34) { last = run; stars.push({ x: ox + p.x, y: oy + p.y, s: 4 + 7 * hash(si, k, 6) + (end ? 2 : 0), len: st.startLen[si]! + run, stroke: si }); }
      });
    });
    this.con = { st, stars, ct: charTimes(st, l, 0.5), ox, oy };
  }

  private makeStair(l: Line) {
    this.stair = l.words.map((_, i) => ({ x: CX + (i % 2 ? 1 : -1) * (230 + 120 * hash(i, 12)), y: 1000 - i * 165 }));
  }

  // ----------------------------------------------------------------------------------------- helpers
  private extra(from: number, k = 0.7): Charge[] { return this.uv.filter((e) => e.t > from).map((e) => ({ t: e.t, s: e.s! * k })); }
  private wg(w: Word, t: number, tau = 1.8, k = 0.7): Glow { return glowAt(t, wordCharges(w, this.extra(w.start, k)), { tau }); }
  /** last kick at or before t, `back` kicks earlier: [time, strength, index] */
  private kickAt(t: number, back = 0): [number, number, number] | null {
    let lo = 0, hi = this.kick.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.kick[m]![0] <= t) lo = m + 1; else hi = m; }
    const i = lo - 1 - back;
    return i >= 0 ? [this.kick[i]![0], this.kick[i]![1], i] : null;
  }
  private fade(li: number, t: number) {
    const nx = this.lines[li + 1];
    return nx ? 1 - smoothstep(nx.start - 0.05, nx.start + 0.4, t) : 1;
  }
  private camY(t: number) {
    const li = this.moments.indexOf('rise');
    if (li < 0) return 0;
    const l = this.lines[li]!, y = this.stair;
    let cam = y[0]!.y - 760;
    for (let i = 1; i < y.length; i++) cam += (y[i]!.y - y[i - 1]!.y) * ease.inOutCubic(prog(t, l.words[i]!.start - 0.05, l.words[i]!.start + 0.65));
    const tl = l.words[l.words.length - 1]!.start;
    return cam - 520 * prog(t, tl, (this.lines[li + 1]?.start ?? l.end) + 0.8, ease.inOutQuad);
  }

  // ------------------------------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { audio, start } = this.ctx, st = this.st, t = f.t, c = st.L.ctx;
    st.begin(out);
    let idx = 0;
    const cam = this.camY(t);
    idx = this.field(t, idx, cam);
    // the opening: the pre-chorus's star bursts
    const q = prog(t, start, start + 0.55, ease.outCubic);
    if (q < 1) {
      const r = IGN.r * (1 - q * 0.9) * (1 + 0.5 * Math.pow(q, 2));
      st.stars.set(idx++, IGN.x, IGN.y, r, 0, { level: 1.6 * (1 - q), flash: 0.9 * (1 - q) }, mixTone('gold', 'white', 1 - q), 0);
      const rr = 40 + 1300 * ease.outExpo(prog(t, start, start + 0.9));
      c.save(); c.lineWidth = 10 * (1 - q) + 2; c.strokeStyle = phosphorCss({ level: 0.9 * (1 - q), flash: 0.4 * (1 - q) }, 'gold');
      c.beginPath(); c.arc(IGN.x, IGN.y, rr, 0, TAU); c.stroke(); c.restore();
    }

    this.lines.forEach((l, li) => {
      const m = this.moments[li], fd = this.fade(li, t);
      if (!m || t < l.start - 0.45 || fd <= 0.003) return;
      switch (m) {
        case 'dance': idx = this.dance(l, li, t, idx, fd, li > 3 ? 'cyan' : 'green'); break;
        case 'lock': idx = this.lock(l, t, idx, fd); break;
        case 'crack': idx = this.crack(l, li, t, idx, fd); break;
        case 'constellation': idx = this.constellation(l, t, idx, fd); break;
        case 'rise': idx = this.rise(l, t, idx, fd, cam); break;
        case 'wave': this.wave(l, t, fd); break;
        case 'charge': idx = this.charge(l, li, t, idx, fd); break;
      }
    });

    st.stars.commit(idx);
    // the last line ends in the dark right before the drop
    const out0 = 1 - smoothstep(this.ctx.end - 0.35, this.ctx.end - 0.02, t);
    const bigUV = this.tBig ? Math.pow(0.5, Math.max(0, t - this.tBig) / 0.22) * (t >= this.tBig ? 1 : 0) : 0;
    const uv = Math.max(uvPulse(audio, t, { thr: 0.8 }) * 0.2, bigUV * 0.95);
    const o = st.end(out, { gain: 1.5 * out0, uv: uv * out0 });
    if (out0 < 1) o.fade = 1 - out0;
    return o;
  }

  /** the field of stickers in the dark: charged by the kicks, parallax with the camera */
  private field(t: number, idx: number, cam: number): number {
    const st = this.st, start = this.ctx.start;
    const burst = ease.outExpo(prog(t, start, start + 1.3));
    const big = this.tBig && t >= this.tBig ? [{ t: this.tBig, s: 1 }] : [];
    for (const b of this.bg) {
      const dep = 0.25 + 0.75 * (b.s / 25);
      let x = (b.x + b.vx * t + W * 40) % W, y = (b.y + b.vy * t - cam * dep * 0.6 + H * 400) % H;
      const bq = ease.outExpo(prog(t, start + 0.18 * b.k, start + 1.3));
      if (bq < 1) { x = lerp(IGN.x, x, bq); y = lerp(IGN.y, y, bq); }
      const g = glowAt(t, this.uv.map((e) => ({ t: e.t, s: e.s! * (0.35 + 0.65 * b.k) })), { tau: 1.5 });
      let level = 0.045 + g.level * 0.5, flash = g.flash * 0.15;
      if (big.length) { const gb = glowAt(t, [{ t: this.tBig, s: 0.55 + 0.45 * b.k }], { tau: 3.2 }); level = Math.max(level, gb.level); flash = Math.max(flash, gb.flash * 0.7); }
      if (burst < 1) level += 0.45 * (1 - burst);
      st.stars.set(idx++, x, y, b.s * lerp(0.3, 1, bq), b.r + t * 0.05 * (b.k - 0.5), { level, flash }, b.gold ? 'gold' : 'green', 0.5);
    }
    return idx;
  }

  // --------------------------------------------------------------------------------------- dance
  private dance(l: Line, li: number, t: number, idx: number, fd: number, tone: Tone): number {
    const c = this.st.L.ctx, lay = this.lay.get(l)!, S = lay.tl[0]!.size;
    const ghosts = li > 3 ? 3 : 1;
    l.words.forEach((w, wi) => {
      const b = lay.boxes[wi]!, tl = lay.tl[wi]!, gl = this.wg(w, t);
      if (gl.level < 0.004 && gl.flash < 0.004) return;
      const isDance = /^dance/i.test(w.w);
      for (let gh = ghosts - 1; gh >= 0; gh--) {
        const k = this.kickAt(t, gh);
        if (!k) continue;
        const age = t - k[0], p = Math.pow(0.5, age / 0.13) * clamp(0.4 + k[1] * 0.8, 0, 1.2);
        const aGh = gh === 0 ? 1 : Math.exp(-age / 0.5) * 0.4 / gh;
        if (aGh < 0.02) continue;
        tl.glyphs.forEach((g, gi) => {
          if (g.ch === ' ') return;
          const id = wi * 41 + gi;
          const rot = (hash(k[2], id, 1) - 0.5) * (0.06 + 0.42 * p) * (isDance ? 1.4 : 1);
          const dy = -(4 + hash(k[2], id, 2) * 30) * p * (isDance ? 1.5 : 1);
          const sc = 1 + 0.1 * p;
          const lv = (gl.level * 0.95 + 0.3 * p) * fd * aGh, fl = gl.flash * fd * aGh + p * 0.18 * (gh === 0 ? 1 : 0);
          c.save();
          c.translate(CX + b.x + g.x + g.w / 2, CY + b.y + dy);
          c.rotate(rot); c.scale(sc, sc);
          drawWord(c, g.ch, 0, 0, S, { level: lv, flash: fl }, isDance ? mixTone(tone, 'gold', 0.5) : tone, { align: 'center' });
          c.restore();
        });
      }
    });
    return idx;
  }

  // ---------------------------------------------------------------------------------------- lock
  private lock(l: Line, t: number, idx: number, fd: number): number {
    const st = this.st, c = st.L.ctx;
    const ti = l.words.findIndex((w) => /^take/i.test(w.w));
    const A = l.words.slice(0, ti), B = l.words.slice(ti);
    const la = layoutWords(A.map((w) => w.w), 124, { maxW: 1800 }), lb = layoutWords(B.map((w) => w.w), 200, { maxW: 1800 });
    const hand = B[B.length - 1]!, take = B[0]!;
    const eA = ease.outCubic(prog(t, l.start - 0.35, hand.start + 0.02)), eB = ease.outBack(prog(t, take.start - 0.25, hand.start + 0.06), 1.1);
    const yA = 370, yB = 700;
    const xA = -(1 - eA) * 760, xB = (1 - eB) * 980;
    const tLock = hand.start + 0.1;
    const lockK = t >= tLock ? Math.pow(0.5, (t - tLock) / 0.12) : 0;
    const shake = lockK * 6 * Math.sin((t - tLock) * 90);
    A.forEach((w, i) => { const b = la.boxes[i]!; drawWord(c, b.text, CX + b.x + xA + shake, yA + b.y, 124, { level: this.wg(w, t).level * fd, flash: this.wg(w, t).flash * fd }, 'green'); });
    B.forEach((w, i) => { const b = lb.boxes[i]!; drawWord(c, b.text, CX + b.x + xB - shake, yB + b.y, 200, { level: this.wg(w, t).level * fd, flash: this.wg(w, t).flash * fd }, 'gold'); });
    // the two ends reach for each other: light threads from the end of the top row and the start of the bottom row
    const ax = CX + la.boxes[la.boxes.length - 1]!.x + la.boxes[la.boxes.length - 1]!.w + xA, bx = CX + lb.boxes[0]!.x + xB;
    const reach = smoothstep(take.start - 0.3, tLock, t) * fd;
    if (reach > 0.01 && t < tLock + 0.4) {
      c.save(); c.lineWidth = 5; c.lineCap = 'round';
      c.strokeStyle = phosphorCss({ level: 0.75 * reach, flash: lockK }, 'cyan');
      c.beginPath(); c.moveTo(ax, yA + 18); c.bezierCurveTo(ax + 100, yA + 100, bx - 100, yB - 280, bx, yB - 170); c.stroke(); c.restore();
    }
    // the lock: a chain link (two interlocked rings) lights between the rows, a ring of stickers bursts
    if (t >= tLock) {
      const tt = t - tLock, lv = 1.0 * Math.exp(-tt / 1.6) * fd;
      c.save(); c.lineWidth = 12; c.translate(CX, 500);
      const pop = 1 + 0.5 * lockK;
      for (const s of [-1, 1]) { c.strokeStyle = phosphorCss({ level: lv, flash: lockK * 0.8 }, s < 0 ? 'green' : 'gold'); c.beginPath(); c.ellipse(s * 38 * pop, 0, 68 * pop, 38 * pop, 0, 0, TAU); c.stroke(); }
      c.restore();
      for (let i = 0; i < 26; i++) {
        const a = TAU * hash(i, 9, 1), d = (40 + 520 * ease.outCubic(clamp(tt / 0.9))) * (0.5 + 0.7 * hash(i, 9, 2));
        const lv2 = Math.exp(-tt / 0.5) * 1.1 * fd;
        if (lv2 > 0.02) st.stars.set(idx++, CX + Math.cos(a) * d * 1.5, 500 + Math.sin(a) * d * 0.8, 9 + 8 * hash(i, 9, 3), a + tt * 4, { level: lv2, flash: 0 }, i % 3 ? 'gold' : 'green', 0);
      }
    }
    return idx;
  }

  // --------------------------------------------------------------------------------------- crack
  private crack(l: Line, li: number, t: number, idx: number, fd: number): number {
    const st = this.st, c = st.L.ctx, lay = this.lay.get(l)!, S = lay.tl[0]!.size;
    const bi = l.words.findIndex((w) => /^broken/i.test(w.w));
    const tCrack = l.words[bi + 1]!.start + 0.05, tStar = l.words[bi + 2]!.start; // "piece" / "becomes"
    const bx = this.crackBox;
    l.words.forEach((w, wi) => {
      const b = lay.boxes[wi]!, gl = this.wg(w, t);
      const isStar = /^star/i.test(w.w);
      if (wi === bi) return;
      drawWord(c, b.text, CX + b.x, CY + b.y, S, { level: gl.level * fd, flash: gl.flash * fd }, isStar ? 'gold' : 'green');
    });
    // the broken word
    const wb = l.words[bi]!, b = lay.boxes[bi]!, gl = this.wg(wb, t, 1.4);
    const ck = prog(t, tCrack, tCrack + 0.7, ease.outCubic), gone = smoothstep(tStar - 0.1, tStar + 0.55, t);
    // a hairline crack grows through the word while "broken" is still being sung, then it falls apart
    if (ck <= 0) drawWord(c, b.text, CX + b.x, CY + b.y, S, { level: gl.level * fd, flash: gl.flash * fd }, 'green');
    else {
      this.shards.forEach((sh, i) => {
        const away = ck * (30 + 60 * hash(i, 4)), rot = ck * (hash(i, 5) - 0.5) * 0.5;
        const lv = gl.level * (1 - gone) * fd;
        if (lv > 0.005) {
          c.save();
          c.translate(sh.dir[0] * away, sh.dir[1] * away + 40 * ck * ck);
          c.translate(sh.cx, sh.cy); c.rotate(rot); c.translate(-sh.cx, -sh.cy);
          c.beginPath(); sh.poly.forEach((p, k) => (k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.clip();
          drawWord(c, b.text, CX + b.x, CY + b.y, S, { level: lv, flash: gl.flash * fd * 0.4 }, 'green');
          c.restore();
        }
        // each shard becomes a star, which rises into the sky (where the next line's constellation begins)
        if (t >= tStar - 0.1) {
          const u = prog(t, tStar - 0.1, tStar + 1.2, ease.inOutCubic), nxt = this.lines[li + 1];
          const sx = sh.cx + sh.dir[0] * 90, sy = sh.cy + sh.dir[1] * 90 + 40;
          const tx = CX + (i - 2.5) * 230, ty = 150 + 70 * hash(i, 6);
          const r = Math.sqrt(sh.area) * 0.22 + 14;
          const lv = (0.5 + 0.9 * gone) * Math.exp(-Math.max(0, t - (nxt?.start ?? t) - 0.6) / 0.9) * (1 - 0.0) * (t < (nxt?.start ?? 1e9) + 3 ? 1 : 0);
          if (lv > 0.01) st.stars.set(idx++, lerp(sx, tx, u), lerp(sy, ty, u), r * lerp(0.7, 1.15, u), (i - 2.5) * 0.2 + u * 1.2, { level: lv * (gone > 0 ? 1 : 0) * fd, flash: Math.pow(0.5, (t - tStar) / 0.15) * 0.8 * gone }, 'gold', 0);
        }
      });
      void bx;
    }
    return idx;
  }

  // ---------------------------------------------------------------------------------- constellation
  private constellation(l: Line, t: number, idx: number, fd: number): number {
    const con = this.con!, st = this.st, c = st.L.ctx;
    // written length of the pen, per char times
    let len = 0;
    for (let i = 0; i < con.st.charRange.length; i++) {
      const [a, b] = con.st.charRange[i]!, [t0, t1] = con.ct[i] ?? [Infinity, Infinity];
      if (t >= t1) len = b; else if (t > t0) { len = a + (b - a) * ((t - t0) / Math.max(1e-3, t1 - t0)); break; } else break;
    }
    // faint chart lines along the strokes
    c.save(); c.lineWidth = 2.2; c.lineJoin = 'round';
    con.st.strokes.forEach((pts, si) => {
      const s0 = con.st.startLen[si]!;
      if (s0 >= len) return;
      const age = t - this.penTime(con, s0);
      c.strokeStyle = phosphorCss({ level: (0.55 * Math.exp(-age / 2.6) + 0.12) * fd, flash: 0 }, 'cyan');
      c.beginPath();
      const L = con.st.lens[si]!;
      pts.forEach((p, k) => { if (s0 + L[k]! > len) return; (k ? c.lineTo : c.moveTo).call(c, con.ox + p.x, con.oy + p.y); });
      c.stroke();
    });
    c.restore();
    for (const s of con.stars) {
      if (s.len > len + 4) continue;
      const age = t - this.penTime(con, s.len);
      const lv = (0.85 * Math.exp(-age / 3.2) + 0.25) * fd, fl = Math.pow(0.5, age / 0.12) * 0.9 * fd;
      st.stars.set(idx++, s.x, s.y, s.s * (1 + 0.5 * Math.pow(0.5, age / 0.2)), s.x * 0.01, { level: lv, flash: fl * 0.5 }, 'white', 0);
    }
    return idx;
  }
  /** song time at which the pen reaches arc length `len` (inverse of the char-time map) */
  private penTime(con: NonNullable<PhosChorus['con']>, len: number): number {
    const n = con.st.charRange.length;
    for (let i = 0; i < n; i++) {
      const [a, b] = con.st.charRange[i]!, [t0, t1] = con.ct[i] ?? [0, 0];
      if (len <= b || i === n - 1) return t0 + (t1 - t0) * clamp((len - a) / Math.max(1e-3, b - a));
    }
    return 0;
  }

  // ------------------------------------------------------------------------------------------ rise
  private rise(l: Line, t: number, idx: number, fd: number, cam: number): number {
    const st = this.st, c = st.L.ctx, size = 180;
    // the ladder of light joining the words
    c.save(); c.lineWidth = 4; c.lineCap = 'round'; c.setLineDash([2, 18]);
    for (let i = 1; i < this.stair.length; i++) {
      const w = l.words[i]!, a = this.stair[i - 1]!, b = this.stair[i]!, u = prog(t, w.start - 0.35, w.start);
      if (u <= 0) continue;
      c.strokeStyle = phosphorCss({ level: 0.6 * fd * Math.exp(-Math.max(0, t - w.start) / 3), flash: 0 }, 'cyan');
      c.beginPath(); c.moveTo(a.x, a.y - cam - 60); c.lineTo(lerp(a.x, b.x, u), lerp(a.y, b.y, u) - cam - 60); c.stroke();
    }
    c.restore();
    l.words.forEach((w, i) => {
      const gl = this.wg(w, t, 2.5), p = this.stair[i]!;
      const sy = p.y - cam;
      if (sy < -300 || sy > H + 300) return;
      const rise = 1 - ease.outCubic(prog(t, w.start, w.start + 0.5));
      drawWord(c, w.w, p.x, sy + 60 * rise, size * (i === l.words.length - 1 ? 1.25 : 1), { level: gl.level * fd, flash: gl.flash * fd }, i >= l.words.length - 3 ? mixTone('green', 'gold', 0.35 * (i - l.words.length + 3)) : 'green', { align: 'center' });
      // lifting sparks from the word
      const tt = t - w.start;
      if (tt > 0 && tt < 1.4) for (let s = 0; s < 8; s++) {
        const a = hash(i, s, 21), lv = 0.9 * Math.exp(-tt / 0.5) * fd;
        if (lv > 0.03) st.stars.set(idx++, p.x + (a - 0.5) * 360, sy - 60 - tt * (120 + 160 * hash(i, s, 22)), 7 + 6 * hash(i, s, 23), tt * 2 + s, { level: lv, flash: 0 }, 'gold', 0);
      }
    });
    return idx;
  }

  // ------------------------------------------------------------------------------------------ wave
  private wave(l: Line, t: number, fd: number) {
    const { audio } = this.ctx, c = this.st.L.ctx, S = 168;
    const ws = l.words, k = Math.ceil(ws.length * 4 / 7); // first row: "Loud enough to wake"
    const rows = [ws.slice(0, k), ws.slice(k)];
    const phase = [[ws[0]!.start - 0.1, ws[k]!.start - 0.1], [ws[k]!.start - 0.1, l.end + 0.1]] as const;
    const y = [CY - 150, CY + 150];
    const BW = 8, NB = Math.ceil(W / BW);
    rows.forEach((row, ri) => {
      const lay = layoutWords(row.map((w) => w.w), S, { maxW: 1800 });
      const [ta, tb] = phase[ri]!;
      const xp = W * prog(t, ta, tb);
      // bars: amplitude of the vocal at the moment the pen passed
      const buckets: { path: Path2D; lv: number }[] = Array.from({ length: 6 }, (_, i) => ({ path: new Path2D(), lv: (i + 0.5) / 6 }));
      for (let b = 0; b < NB; b++) {
        const x = b * BW;
        if (x > xp) break;
        const tp = ta + (x / W) * (tb - ta);
        const env = clamp(audio.env('vocal', tp) / this.vNorm), amp = (30 + 330 * Math.pow(env, 0.85)) * (0.72 + 0.28 * hash(b, ri, 31));
        const age = t - tp, lv = Math.exp(-age / 1.15) * (0.5 + 0.5 * env) * fd * (1 - ri * 0.0);
        if (lv < 0.03) continue;
        const bk = buckets[Math.min(5, Math.floor(lv * 6))]!;
        bk.path.rect(x, y[ri]! - amp * 0.62, BW - 1, amp * 1.24);
        c.fillStyle = phosphorCss({ level: lv * 0.26, flash: 0 }, ri ? 'cyan' : 'green', 0.9);
        c.fillRect(x, y[ri]! - amp * 0.62, BW - 1, amp * 1.24);
      }
      // the words: ghosts everywhere, charged where the waveform covers them
      const draw = (g: Glow, tone: Tone) => lay.boxes.forEach((b) => drawWord(c, b.text, CX + b.x, y[ri]! + S * 0.34, S, g, tone));
      c.save(); draw({ level: 0.06 * fd, flash: 0 }, 'green'); c.restore();
      for (const bk of buckets) {
        c.save(); c.clip(bk.path); draw({ level: Math.min(1.3, bk.lv * 1.25 + 0.1) * fd, flash: bk.lv > 0.8 ? 0.3 : 0 }, ri ? 'cyan' : 'green'); c.restore();
      }
      // the pen of the wave: a bright bar at the head
      if (xp > 0 && xp < W) { c.fillStyle = phosphorCss({ level: 0.9 * fd, flash: 0.6 * fd }, 'white', 0.9); c.fillRect(xp, y[ri]! - 380, 4, 760); }
    });
  }

  // ---------------------------------------------------------------------------------------- charge
  private charge(l: Line, li: number, t: number, idx: number, fd: number): number {
    const st = this.st, c = st.L.ctx, lay = this.lay.get(l)!, S = lay.tl[0]!.size;
    const gi = l.words.findIndex((w) => /^glo/i.test(w.w));
    l.words.forEach((w, wi) => {
      const b = lay.boxes[wi]!, tl = lay.tl[wi]!;
      const held = wi === gi, wd = Math.max(0.2, w.end - w.start);
      // the big UV flash recharges everything at "glowing"; the held note lights its letters one by one
      const base = glowAt(t, [{ t: w.start, s: 1 }, ...(t >= this.tBig && w.start <= this.tBig ? [{ t: this.tBig, s: 1 }] : [])], { tau: 3.0 });
      tl.glyphs.forEach((g, ci) => {
        if (g.ch === ' ') return;
        const tg = held ? w.start + (wd * 0.85 * ci) / Math.max(1, tl.glyphs.length - 1) : w.start;
        const gl = glowAt(t, [{ t: tg, s: 1 }, ...(t >= this.tBig && tg <= this.tBig + 0.01 ? [{ t: this.tBig, s: 1 }] : []), ...(t > tg ? this.extra(tg, 0.8) : [])], { tau: held ? 3.4 : 3.0 });
        const lv = (held ? gl.level : base.level) * fd, fl = (held ? gl.flash : base.flash) * fd;
        const wob = held ? Math.sin(t * 5 + ci) * 3 * gl.level : 0;
        drawWord(c, g.ch, CX + b.x + g.x + g.w / 2, CY + b.y + wob, S * (1 + (held ? 0.04 * gl.flash : 0)), { level: lv, flash: fl }, w.w.match(/dark/i) ? mixTone('green', 'white', 0.4) : 'green', { align: 'center' });
      });
    });
    void idx; void li; void st; void starPath;
    return idx;
  }
}
