// PRE-CHORUS in phosphor: stickers in the dark become the words, then the light turns gold and ignites.
//   params.n = 1 (pre-chorus 1, green -> gold)   |   2 (pre-chorus 2: stronger, cyan/violet -> gold, denser, more UV)
//   "Put your hands up..."  the line assembles from stickers flying in out of the dark and rises; "(felt low)" echoes and sinks
//   "Tonight we let it all go (all go)"  the stickers peel off the letters and float up; "(all go)" is a small ghost that rises
//   "Turn the pain into gold"  a gold wave sweeps across the frame; everything it passes is recharged gold
//   "Here we go, here we go"  a six-segment dial counts the words, the field implodes into one white-gold star at the
//   centre (960, 540, r 140) which is where the chorus scene starts (phos-chorus opens with it bursting).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import type { Line, Word } from '../../engine/lyrics';
import { W, H } from '../../engine/gl';
import { clamp, ease, hash, lerp, noise1, prog, smoothstep, TAU } from '../../engine/util';
import { inOutSine, PhosphorStage, StickerWord, glowAt, uvEvents, uvPulse, layoutWords, drawWord, loadPhosphorFont, mixTone, phosphorCss, starPath, PH, PHOS_FONT, type Charge, type Tone, type Glow } from '../lib/phosphor';

const CX = W / 2, CY = H / 2;
export const IGNITE = { x: CX, y: CY, r: 140 };

interface Var { base: Tone; ring: Tone; bg: number; uvThr: number; sizeA: number; sizeB: number; sizeC: number; peelVy: number; uvK: number }
const VARS: Record<number, Var> = {
  1: { base: 'green', ring: 'gold', bg: 520, uvThr: 0.8, sizeA: 150, sizeB: 170, sizeC: 165, peelVy: -240, uvK: 0.2 },
  2: { base: 'cyan', ring: 'violet', bg: 1100, uvThr: 0.62, sizeA: 160, sizeB: 180, sizeC: 172, peelVy: -380, uvK: 0.34 },
};

interface Grp {
  words: Word[];
  boxes: { x: number; y: number; w: number; text: string }[];
  sw: StickerWord[];
  cx: number;
  cy: (t: number) => number;
  seed: number;
  size: number;
  ch: Charge[][];
  peel?: { t0: number; span: number; vx: number; vy: number; ay: number; tau: number };
  exit?: { t0: number };
}

export default class PhosPre extends Scene {
  st!: PhosphorStage;
  v!: Var;
  n = 1;
  uv: Charge[] = [];
  put!: Line; ton!: Line; turn!: Line; here!: Line;
  echoLow?: Line; echoGo?: Line;
  A!: Grp; B!: Grp; C!: Grp;
  tInto = 0; tGold = 0; tWaveEnd = 0;
  tIgn = 0; // implosion start
  bg: { x: number; y: number; s: number; r: number; k: number; vx: number; vy: number }[] = [];

  override async init() {
    await loadPhosphorFont();
    const { lyrics, audio, params, start, end } = this.ctx;
    this.n = Number(params.n ?? 1) === 2 ? 2 : 1;
    this.v = VARS[this.n]!;
    this.st = new PhosphorStage(this.ctx, this.n === 2 ? 7500 : 5600);
    const L = lyrics.linesIn(start - 0.3, end + 0.2).filter((l) => !l.kind);
    const f = (re: RegExp) => L.find((l) => re.test(l.text))!;
    this.put = f(/^put your hands/i); this.ton = f(/^tonight/i); this.turn = f(/^turn the pain/i); this.here = f(/^here we go/i);
    const E = lyrics.linesIn(start - 0.3, end + 0.2).filter((l) => l.kind === 'echo');
    this.echoLow = E.find((l) => /felt/i.test(l.text)); this.echoGo = E.find((l) => /all/i.test(l.text));
    this.uv = uvEvents(audio, start - 1, end + 0.5, { thr: this.v.uvThr });

    const mk = (line: Line, size: number, seed: number, cx: number, cy: (t: number) => number, maxW: number, ch: (w: Word) => Charge[]): Grp => {
      const lay = layoutWords(line.words.map((w) => w.w), size, { maxW });
      return {
        words: line.words, boxes: lay.boxes.map((b) => ({ x: b.x, y: b.y - lay.height * 0.5 + size * 0.4, w: b.w, text: b.text })),
        sw: line.words.map((w, i) => new StickerWord(w.w, size, size / 12, seed + i)), cx, cy, seed, size, ch: line.words.map(ch),
      };
    };
    const uvAfter = (w: Word): Charge[] => [{ t: w.start, s: 1 }, ...this.uv.filter((e) => e.t > w.start && e.t < w.start + 4).map((e) => ({ t: e.t, s: e.s! * 0.7 }))];
    const { sizeA, sizeB, sizeC } = this.v;
    // A rises through its line
    this.A = mk(this.put, sizeA, 11, CX, (t) => lerp(660, 400, inOutSine(prog(t, this.put.start, this.put.end))), 1560, uvAfter);
    this.A.exit = { t0: this.ton.start - 0.04 };
    this.B = mk(this.ton, sizeB, 31, CX, (t) => lerp(560, 520, prog(t, this.ton.start, this.ton.end)), 1500, uvAfter);
    const wAll = this.ton.words.find((w) => /^let$/i.test(w.w)) ?? this.ton.words[2]!;
    this.B.peel = { t0: wAll.start, span: this.ton.end - wAll.start - 0.5, vx: 0, vy: this.v.peelVy, ay: this.v.peelVy * 0.5, tau: 1.0 };
    this.C = mk(this.turn, sizeC, 51, CX, () => 500, 1560, uvAfter);
    this.C.exit = { t0: this.here.start - 0.12 };
    const into = this.turn.words.find((w) => /^into$/i.test(w.w))!, gold = this.turn.words.find((w) => /^gold/i.test(w.w))!;
    this.tInto = into.start - 0.05; this.tGold = gold.start; this.tWaveEnd = gold.start + 0.45;
    this.tIgn = this.here.words[this.here.words.length - 1]!.start - 0.1;

    // the field of stickers in the dark
    const N = this.v.bg;
    for (let i = 0; i < N; i++) this.bg.push({
      x: hash(i, 1, 9) * W, y: hash(i, 2, 9) * H, s: 5 + 15 * Math.pow(hash(i, 3, 9), 2.4), r: hash(i, 4, 9) * TAU, k: 0.35 + 0.65 * hash(i, 5, 9),
      vx: (hash(i, 6, 9) - 0.5) * 12, vy: (hash(i, 7, 9) - 0.5) * 12,
    });
  }

  /** sticker colour: base tone, gold behind the wave front */
  private tone(x: number, t: number): Tone {
    const m = this.waveM(x, t);
    return m <= 0 ? this.v.base : m >= 1 ? 'gold' : mixTone(this.v.base, 'gold', m);
  }
  private front(t: number) { return lerp(-260, W + 260, inOutSine(prog(t, this.tInto, this.tWaveEnd))); }
  private waveM(x: number, t: number) { return t < this.tInto ? 0 : smoothstep(-70, 70, this.front(t) - x - 0); }
  /** time the front passes x */
  private tPass(x: number) {
    const s = clamp((x + 260) / (W + 520));
    return this.tInto + (Math.acos(1 - 2 * s) / Math.PI) * (this.tWaveEnd - this.tInto);
  }

  private group(g: Grp, t: number, idx: number, tau = 1.7): number {
    const st = this.st, c = st.L.ctx, cy = g.cy(t);
    const step = g.size / 12, rad = step * 0.8;
    const total = g.boxes.reduce((m, b) => Math.max(m, b.x + b.w), 0) - g.boxes.reduce((m, b) => Math.min(m, b.x), 1e9);
    const x0 = g.boxes.reduce((m, b) => Math.min(m, b.x), 1e9);
    g.words.forEach((w, wi) => {
      const bx = g.boxes[wi]!, sw = g.sw[wi]!;
      const gl = glowAt(t, g.ch[wi]!, { tau });
      const ox = g.cx + bx.x, oy = cy + bx.y;
      let fade = 1;
      if (g.exit) fade = 1 - smoothstep(g.exit.t0, g.exit.t0 + 0.5, t);
      if (g.peel) fade = Math.min(fade, 1 - smoothstep(g.peel.t0, g.peel.t0 + g.peel.span + 0.3, t));
      for (let k = 0; k < sw.pts.length; k++) {
        const p = sw.pts[k]!;
        const arr = w.start - 0.05 + 0.18 * p.a, D = 0.85 - 0.3 * p.b, dk = arr - D;
        if (t < dk) continue;
        const u = clamp((t - dk) / D), e = ease.outCubic(u);
        const tx = ox + p.x, ty = oy + p.y;
        const hx = hash(g.seed, wi, k, 5) * W, hy = hash(g.seed, wi, k, 6) * H;
        const dx = tx - hx, dy = ty - hy, dl = Math.hypot(dx, dy) || 1;
        const arc = Math.sin(Math.PI * u) * (p.b - 0.5) * 340 * (1 - u * 0.3);
        let x = lerp(hx, tx, e) - (dy / dl) * arc, y = lerp(hy, ty, e) + (dx / dl) * arc;
        let size = rad * (0.85 + 0.3 * p.a) * lerp(0.45, 1, e), rot = (1 - e) * (p.a - 0.5) * 9 + (p.b - 0.5) * 0.16;
        let level = u < 1 ? 0.5 * e + 0.15 : gl.level, flash = u < 1 ? 0 : gl.flash;
        if (g.peel) {
          const tp = g.peel.t0 + g.peel.span * (0.55 * clamp((bx.x + p.x - x0) / total) + 0.45 * p.b), tt = t - tp;
          if (tt > 0) {
            x += g.peel.vx * tt + 70 * noise1(tt * 1.1 + k * 0.7, wi) * tt;
            y += g.peel.vy * tt + g.peel.ay * tt * tt * 0.4 + 18 * Math.sin(tt * 3 + k);
            level *= Math.exp(-tt / g.peel.tau) * 0.9 + 0.1 * Math.exp(-tt / 3);
            flash = 0;
            rot += tt * (p.a - 0.5) * 3;
            size *= 1 - 0.25 * clamp(tt / 2);
          }
        }
        if (g.exit) {
          const tt = Math.max(0, t - g.exit.t0 - 0.25 * p.b);
          if (tt > 0) { y -= 700 * tt * tt + 120 * tt; x += (p.a - 0.5) * 260 * tt; level *= Math.exp(-tt / 0.5); flash = 0; }
        }
        if (level < 0.012 && flash < 0.012) continue;
        const tone = this.tone(x, t);
        st.stars.set(idx++, x, y, size, rot, { level: level * (0.82 + 0.18 * Math.sin(t * 1.7 + k * 1.3)), flash }, tone, 0.2);
      }
      // the lit lettering on top once its stickers have landed
      const fl = gl.level * 0.38 * smoothstep(w.start + 0.25, w.start + 0.7, t) * fade;
      if (fl > 0.01) drawWord(c, bx.text, ox, oy, g.size, { level: fl, flash: gl.flash * 0.35 * fade }, this.tone(ox + bx.w / 2, t));
    });
    return idx;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { audio } = this.ctx, st = this.st, t = f.t, c = st.L.ctx, V = this.v;
    st.begin(out);
    const lt = f.lt;
    let idx = 0;
    const ign = prog(t, this.tIgn, this.ctx.end - 0.02, ease.inCubic); // implosion 0..1
    const hereW = this.here.words;
    const word = (i: number) => hereW[i]!;
    // the dial: countdown segments, one per word of "Here we go, here we go"
    const nSung = hereW.filter((w) => t >= w.start).length;
    const starR = lerp(46 + 14 * nSung, IGNITE.r, ign);

    // ---- background field: dead stickers that the UV flashes and the wave charge
    const wordHits: Charge[] = [...this.ton.words, ...this.here.words].map((w) => ({ t: w.start, s: 0.35 }));
    const body = smoothstep(0.1, 1.4, lt) * 0.55;
    const gather = ign;
    for (const b of this.bg) {
      let x = (b.x + b.vx * t + W * 40) % W, y = (b.y + b.vy * t + H * 40) % H;
      const ev: Charge[] = [];
      let level = 0, flash = 0;
      const gl1 = glowAt(t, this.uv.map((e) => ({ t: e.t, s: e.s! * b.k * V.uvK * 1.8 })), { tau: 1.3 });
      level = gl1.level; flash = gl1.flash * 0.25;
      const gl2 = glowAt(t, wordHits.map((e) => ({ t: e.t, s: e.s! * b.k })), { tau: 0.9 });
      level = Math.max(level, gl2.level * 0.7);
      // the wave recharges whatever it passes
      const tp = this.tPass(x);
      if (t >= tp && t < tp + 4.5) {
        const wg = glowAt(t, [{ t: tp, s: 0.85 * b.k }], { tau: 1.4 });
        level = Math.max(level, wg.level); flash = Math.max(flash, wg.flash * 0.5);
      }
      if (gather > 0) {
        const q = ease.inCubic(clamp(gather * 1.15 - 0.15 * b.k));
        x = lerp(x, IGNITE.x, q); y = lerp(y, IGNITE.y, q);
        level = lerp(level, 0.9, q * 0.8) * (1 - smoothstep(0.82, 1, q));
        if (q >= 1) continue;
      }
      if (level < 0.01 && body < 0.01) continue;
      st.stars.set(idx++, x, y, b.s * (1 - gather * 0.4), b.r + t * 0.02 * (b.k - 0.5), { level, flash }, this.tone(x, t), body * (1 - gather));
    }

    // ---- A: Put your hands up if you've ever felt low
    if (t < this.ton.start + 1.2) idx = this.group(this.A, t, idx);
    // "(felt low)": the last two words echo and sink
    if (this.echoLow && t >= this.echoLow.start - 0.02) {
      const wl = this.put.words, a = this.A, bxs = a.boxes;
      const iF = wl.length - 2, bf = bxs[iF]!, bl = bxs[iF + 1]!;
      const mx = a.cx + (bf.x + bl.x + bl.w) / 2, y0 = a.cy(this.echoLow.start) + bf.y;
      for (let k = 0; k < 3; k++) {
        const te = this.echoLow.start + k * 0.3, tt = t - te;
        if (tt < 0) continue;
        const lv = 0.85 * Math.pow(0.5, k) * Math.exp(-tt / 0.55);
        const y = y0 + 90 + k * 8 + 60 * tt + 240 * tt * tt;
        c.save(); c.globalAlpha = 1; c.textAlign = 'center';
        drawWord(c, '(felt low)', mx, y, a.size * (0.62 - 0.07 * k), { level: lv, flash: k === 0 ? Math.pow(0.5, tt / 0.1) * 0.6 : 0 }, 'cyan', { align: 'center' });
        c.restore();
      }
    }

    // ---- B: Tonight we let it all go
    if (t >= this.ton.start - 1 && t < this.turn.start + 1.5) idx = this.group(this.B, t, idx, 1.4);
    if (this.echoGo && t >= this.echoGo.start - 0.02) {
      const y0 = 330, tt = t - this.echoGo.start;
      const lv = 0.8 * Math.exp(-tt / 0.6) * (1 - smoothstep(this.turn.start + 0.3, this.turn.start + 1.0, t));
      drawWord(c, '(all go)', CX, y0 - 70 * tt - 30 * tt * tt, 78, { level: lv, flash: Math.pow(0.5, tt / 0.1) * 0.6 }, 'cyan', { align: 'center' });
    }

    // ---- C: Turn the pain into gold, oh
    if (t >= this.turn.start - 1 && t < this.here.start + 1.5) idx = this.group(this.C, t, idx, 2.2);
    if (t >= this.tInto - 0.3 && t < this.tWaveEnd + 1.0) this.drawFront(t);

    // ---- D: Here we go, here we go
    if (t >= this.here.start - 0.5) idx = this.ignition(f, idx, starR, ign, nSung);

    st.stars.commit(idx);
    const pulse = uvPulse(audio, t, { thr: V.uvThr });
    return st.end(out, { gain: 1.55, uv: pulse * (this.n === 2 ? 0.32 : 0.18), uvColor: this.n === 2 ? [0.4, 0.25, 1] : undefined });
  }

  private drawFront(t: number) {
    const c = this.st.L.ctx, x = this.front(t), a = 1 - smoothstep(this.tWaveEnd, this.tWaveEnd + 1.0, t);
    const sk = 0.24, w = 220;
    c.save();
    c.beginPath();
    c.moveTo(x - w + sk * 0, -10); c.lineTo(x, -10); c.lineTo(x - sk * H, H + 10); c.lineTo(x - w - sk * H, H + 10); c.closePath();
    const g = c.createLinearGradient(x - w, 0, x, 0);
    g.addColorStop(0, 'rgba(255,194,71,0)'); g.addColorStop(0.75, `rgba(255,194,71,${0.22 * a})`); g.addColorStop(1, `rgba(255,236,170,${0.85 * a})`);
    c.fillStyle = g; c.fill();
    c.restore();
  }

  private ignition(f: Frame, idx: number, starR: number, ign: number, nSung: number): number {
    const { audio } = this.ctx, st = this.st, c = st.L.ctx, t = f.t, V = this.v;
    const ws = this.here.words;
    const ring: Tone = V.ring === 'gold' ? 'gold' : V.ring;
    // words: one per beat, flashing in a row near the bottom
    const lay = layoutWords(ws.map((w) => w.w), 120, { maxW: 1700 });
    const wf = 1 - smoothstep(this.tIgn - 0.1, this.tIgn + 0.3, t);
    lay.boxes.forEach((b, i) => {
      const gl = glowAt(t, [{ t: ws[i]!.start }, ...this.uv.filter((e) => e.t > ws[i]!.start).map((e) => ({ t: e.t, s: e.s! * 0.6 }))], { tau: 1.0 });
      drawWord(c, b.text, CX + b.x, 905 + b.y, 120, { level: gl.level * wf, flash: gl.flash * wf }, 'gold');
    });
    // the dial: six arc segments
    const R = lerp(250, IGNITE.r * 0.9, ign), k = ws.length;
    for (let i = 0; i < k; i++) {
      const gl = glowAt(t, [{ t: ws[i]!.start }], { tau: 2.5 });
      const a0 = -Math.PI / 2 + (i / k) * TAU + 0.07, a1 = -Math.PI / 2 + ((i + 1) / k) * TAU - 0.07;
      c.save();
      c.lineWidth = lerp(14, 10, ign); c.lineCap = 'round';
      c.strokeStyle = phosphorCss({ level: Math.max(0.1, gl.level) * (1 - smoothstep(0.85, 1, ign)), flash: gl.flash }, i === k - 1 ? 'gold' : ring);
      c.beginPath(); c.arc(IGNITE.x, IGNITE.y, R, a0, a1); c.stroke();
      c.restore();
    }
    // the star in the dial's centre: one step bigger per word, a kick of size on each
    const last = ws.filter((w) => t >= w.start).pop();
    const kick = last ? Math.pow(0.5, (t - last.start) / 0.09) : 0;
    const r = starR * (1 + 0.18 * kick) * (nSung ? 1 : 0.0);
    const lvl = lerp(0.55 + 0.1 * nSung, 1.6, ign);
    if (r > 1) st.stars.set(idx++, IGNITE.x, IGNITE.y, r, Math.sin(t * 0.8) * 0.06 * (1 - ign), { level: lvl, flash: Math.max(kick * 0.6, ign * 0.9) }, ign > 0.6 ? mixTone('gold', 'white', (ign - 0.6) / 0.4) : 'gold', 0.1);
    // a ring of sparks leaving the star on each word
    for (const [i, w] of ws.entries()) {
      const tt = t - w.start;
      if (tt < 0 || tt > 1.1 || ign > 0.5) continue;
      for (let s = 0; s < 14; s++) {
        const a = TAU * (s / 14) + hash(i, s, 3) * 0.5, d = (70 + 260 * ease.outCubic(tt / 1.1)) * (0.7 + 0.5 * hash(i, s, 4)) + starR;
        const lv = 0.9 * Math.exp(-tt / 0.4);
        st.stars.set(idx++, IGNITE.x + Math.cos(a) * d, IGNITE.y + Math.sin(a) * d, 9 * (1 - tt / 1.4), a + tt * 3, { level: lv, flash: 0 }, i % 2 ? ring : 'gold', 0);
      }
    }
    // the glow of the implosion
    if (ign > 0) {
      const g = c.createRadialGradient(IGNITE.x, IGNITE.y, 0, IGNITE.x, IGNITE.y, 620);
      g.addColorStop(0, `rgba(255,240,200,${0.55 * ign})`); g.addColorStop(1, 'rgba(255,200,80,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    }
    void audio; void PH; void PHOS_FONT; void starPath;
    return idx;
  }
}
