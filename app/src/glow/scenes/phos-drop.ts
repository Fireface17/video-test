// DROP 1, bars 1-8, in phosphor: the vocal chops are the lettering. Each chop of "Glo-o-owing", "Da-a-ance" ignites its
// letters; the held vowels and hyphens STRETCH in time, every chop onset bursts stars out of the word and every strong kick is
// a UV flash that recharges the field. In bar 8 the last line's stickers leave the letters and, with the whole field, stream into
// two spiral arms around a white-gold core: the star-dust spiral the galaxy scene (cosmos) opens on.
//   params.n is unused (kept for symmetry with the other phos scenes).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import type { Line, Word } from '../../engine/lyrics';
import { W, H } from '../../engine/gl';
import { layout, type TextLayout } from '../../engine/type';
import { clamp, ease, hash, lerp, prog, smoothstep, TAU } from '../../engine/util';
import { PhosphorStage, StickerWord, glowAt, uvEvents, uvPulse, drawWord, loadPhosphorFont, mixTone, phosphorCss, PHOS_FONT, type Charge, type Tone } from '../lib/phosphor';

const CX = W / 2, CY = H / 2;
const SIZE = 196;
const VOW = /[aeiou-]/i;

interface Group {
  w: Word;
  row: number;
  lay: TextLayout;
  sw: StickerWord;
  /** glyph index each sticker belongs to */
  gOf: number[];
  /** reveal time of each glyph (a chop onset) */
  rev: number[];
  onsets: number[];
  stretch: number;
}
interface Spiral { x: number; y: number; r: number; th: number }

export default class PhosDrop extends Scene {
  st!: PhosphorStage;
  lines: Line[] = [];
  groups: Group[][] = [];
  uv: Charge[] = [];
  chops: [number, number][] = [];
  bg: { x: number; y: number; s: number; r: number; k: number; u: number; arm: number; th: number; vx: number; vy: number }[] = [];
  tSpiral = 0;
  bars: number[] = [];

  override async init() {
    await loadPhosphorFont();
    const { lyrics, audio, start, end } = this.ctx;
    this.st = new PhosphorStage(this.ctx, 4300);
    this.lines = lyrics.linesIn(start, end + 0.1).filter((l) => l.kind === 'chop' && l.start >= start - 0.1 && l.start < end);
    this.uv = uvEvents(audio, start - 0.5, end + 0.5, { thr: 0.75 });
    this.chops = audio.events('chop', start - 0.2, end + 0.5);
    this.bars = audio.downbeats.filter((d) => d >= start - 0.01 && d <= end + 0.01);
    this.tSpiral = this.bars[7] ?? end - 1.6; // bar 8
    for (const l of this.lines) {
      const gs: Group[] = l.words.map((w, wi) => {
        const lay = layout(w.w, PHOS_FONT, SIZE);
        const sw = new StickerWord(w.w, SIZE, SIZE / 12, 17 + wi * 5 + l.i);
        const gOf = sw.pts.map((p) => Math.max(0, lay.glyphs.findIndex((g, i) => p.x < g.x + g.w || i === lay.glyphs.length - 1)));
        let onsets = this.chops.filter(([t]) => t >= w.start - 0.06 && t < w.end - 0.02).map(([t]) => t);
        if (!onsets.length || onsets[0]! > w.start + 0.05) onsets = [w.start, ...onsets];
        if (w.w.includes('-')) onsets = onsets.slice(0, 5);
        const n = lay.glyphs.length, m = onsets.length;
        const rev = lay.glyphs.map((_, i) => onsets[Math.min(m - 1, Math.floor((i * m) / n))]!);
        return { w, row: l.words.length > 1 && wi > 0 && /in|the|dark/i.test(w.w) ? 1 : wi === 0 ? 0 : 1, lay, sw, gOf, rev, onsets, stretch: w.w.includes('-') ? (/^da/i.test(w.w) ? 2.6 : 2.0) : 1 };
      });
      this.groups.push(gs);
    }
    for (let i = 0; i < 2300; i++) {
      const u = Math.pow(hash(i, 3, 6), 0.8), arm = i % 2;
      const bulge = hash(i, 9, 6) < 0.16;
      const r = bulge ? 15 + 95 * Math.pow(hash(i, 10, 6), 1.4) : 70 + 560 * u;
      this.bg.push({
        x: hash(i, 1, 6) * W, y: hash(i, 2, 6) * H, s: 4 + 16 * Math.pow(hash(i, 4, 6), 2.6), r: hash(i, 5, 6) * TAU, k: 0.3 + 0.7 * hash(i, 5, 7), u,
        arm, th: bulge ? hash(i, 11, 6) * TAU : arm * Math.PI + 3.3 * Math.log(1 + r / 70) + (hash(i, 12, 6) - 0.5) * (0.5 + 0.5 * u), vx: (hash(i, 6, 6) - 0.5) * 14, vy: (hash(i, 7, 6) - 0.5) * 14,
      });
      this.bg[i]!.u = r; // reuse: radius in the spiral
    }
  }

  private spiral(b: (typeof this.bg)[number], t: number): Spiral {
    const th = b.th + 0.5 * (t - this.tSpiral) / Math.sqrt(b.u / 120 + 0.6);
    return { x: CX + b.u * Math.cos(th) * 1.05, y: CY + b.u * Math.sin(th) * 0.64, r: b.u, th };
  }

  /** width of word group at time t (glyph stretch) and per-glyph x offsets */
  private glyphX(g: Group, t: number) {
    const xs: number[] = [], ss: number[] = [];
    let x = 0;
    g.lay.glyphs.forEach((gl, i) => {
      const s = VOW.test(gl.ch) && g.stretch > 1 ? 1 + (g.stretch - 1) * ease.outCubic(prog(t, g.rev[i]!, g.rev[i]! + 0.55)) * (1 - 0.0) : 1;
      xs.push(x); ss.push(s); x += gl.w * s;
    });
    return { xs, ss, w: x };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { audio, start, end } = this.ctx, st = this.st, t = f.t, c = st.L.ctx;
    st.begin(out);
    let idx = 0;
    const g = ease.inOutCubic(prog(t, this.tSpiral - 0.35, end - 0.05)); // the gathering of the galaxy
    // ---- the field: stickers in the dark, recharged by every strong kick; in bar 8 it forms the spiral
    const burst = (b: { k: number }) => ease.outExpo(prog(t, start + 0.3 + 0.2 * b.k, start + 1.6));
    const rot = 0.5;
    for (const b of this.bg) {
      const q = burst(b);
      let x = (b.x + b.vx * t + W * 40) % W, y = (b.y + b.vy * t + H * 40) % H;
      x = lerp(CX, x, q); y = lerp(CY, y, q);
      const gl = glowAt(t, this.uv.map((e) => ({ t: e.t, s: e.s! * (0.4 + 0.6 * b.k) })), { tau: 1.1 });
      const vis = b.k > 0.64 ? 1 : 0;
      let level = (0.04 + 0.55 * gl.level) * vis, flash = gl.flash * 0.25 * vis, size = b.s * lerp(0.3, 1, q) * (0.6 + 0.4 * vis);
      let tone: Tone = b.k > 0.9 ? 'gold' : 'green';
      const gt = clamp(g * 1.25 - 0.25 * b.k);
      if (gt > 0) {
        const sp = this.spiral(b, t), e = ease.inOutCubic(gt);
        // swirl in: interpolate in polar coordinates around the centre
        const dx = x - CX, dy = (y - CY) / 0.64, r0 = Math.hypot(dx, dy), a0 = Math.atan2(dy, dx);
        let da = sp.th - a0; da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI; da -= 1.4 * (1 - e) * (b.arm ? 1 : -1) * 0 + 0; // shortest turn
        const rr = lerp(r0, sp.r, e), aa = a0 + da * e + (1 - e) * e * 1.6;
        x = CX + rr * Math.cos(aa) * 1.05; y = CY + rr * Math.sin(aa) * 0.64;
        size *= lerp(1, 0.55, e);
        level = lerp(level, 0.35 + 0.55 * b.k * (1 - sp.r / 700), e) + 0.25 * e * gl.level;
        tone = mixTone(b.k > 0.9 ? 'gold' : 'green', sp.r < 140 ? 'white' : b.arm ? 'cyan' : mixTone('cyan', 'violet', 0.5), e);
      }
      st.stars.set(idx++, x, y, size, b.r + rot * t * 0.1 * (b.k - 0.5), { level, flash }, tone, 0.45);
    }

    // ---- the lettering
    this.lines.forEach((l, li) => {
      const next = this.lines[li + 1];
      const gone = next ? smoothstep(next.start - 0.15, next.start + 0.35, t) : 0;
      if (t < l.start - 0.1 || gone >= 1) return;
      idx = this.line(l, this.groups[li]!, li, t, idx, gone, g);
    });

    // ---- the core of the spiral
    if (g > 0.001) {
      const r = lerp(30, 360, ease.outCubic(g)), a = 0.9 * g;
      const gr = c.createRadialGradient(CX, CY, 0, CX, CY, r);
      gr.addColorStop(0, `rgba(255,248,225,${a})`); gr.addColorStop(0.18, `rgba(255,214,140,${a * 0.55})`); gr.addColorStop(1, 'rgba(255,200,120,0)');
      c.save(); c.scale(1, 0.64); c.translate(0, CY / 0.64 - CY); c.fillStyle = gr; c.fillRect(CX - r, CY - r, r * 2, r * 2); c.restore();
    }
    st.stars.commit(idx);

    // the drop's hit (a white UV flash at the first chop), a flash on every strong kick
    const hit = Math.pow(0.5, Math.max(0, t - (start - 0.04)) / 0.16);
    const uv = Math.max(uvPulse(audio, t, { thr: 0.75 }) * 0.3, hit * 0.9);
    return st.end(out, { gain: 1.5, uv, uvColor: [0.4, 0.28, 1] });
  }

  private line(l: Line, gs: Group[], li: number, t: number, idx: number, gone: number, gather: number): number {
    const st = this.st, c = st.L.ctx;
    // rows: the stretched width of each row decides where its words sit
    const rowW = [0, 0], gap = SIZE * 0.26;
    const gx = gs.map((g) => this.glyphX(g, t));
    const rows: number[][] = [[], []];
    gs.forEach((g, i) => rows[g.row]!.push(i));
    rows.forEach((r, ri) => { rowW[ri] = r.reduce((s, i) => s + gx[i]!.w, 0) + gap * Math.max(0, r.length - 1); });
    const rowY = [CY - 66, CY + 170];
    const kick = uvPulse(this.ctx.audio, t, { thr: 0.5, hl: 0.1 });
    const spiralLine = li === this.lines.length - 1;
    gs.forEach((g, wi) => {
      const rr = rows[g.row]!;
      let x0 = CX - rowW[g.row]! / 2;
      for (const i of rr) { if (i === wi) break; x0 += gx[i]!.w + gap; }
      const y0 = rowY[g.row]! + SIZE * 0.34, X = gx[wi]!;
      const k = 1 + 0.05 * kick;
      // letters + stickers
      g.lay.glyphs.forEach((gl, i) => {
        const tr = g.rev[i]!;
        if (t < tr - 0.02 || gl.ch === ' ') return;
        const age = t - tr;
        const gg = glowAt(t, [{ t: tr, s: 1 }, ...this.uv.filter((e) => e.t > tr).map((e) => ({ t: e.t, s: e.s! * 0.8 }))], { tau: 1.6 });
        const fade = (1 - gone) * (spiralLine ? 1 - smoothstep(this.tSpiral - 0.1, this.tSpiral + 0.6, t) : 1);
        if (fade <= 0.003) return;
        c.save();
        c.translate(x0 + X.xs[i]!, y0);
        c.scale(X.ss[i]! * k, k);
        drawWord(c, gl.ch, 0, 0, SIZE, { level: gg.level * 0.9 * fade, flash: gg.flash * fade }, mixTone('green', 'white', 0.15 * Math.pow(0.5, age / 0.2)));
        c.restore();
      });
      // stickers on the letters: sparkle, and in the last bar the dust that leaves for the spiral
      for (let p = 0; p < g.sw.pts.length; p++) {
        const pt = g.sw.pts[p]!, gi = g.gOf[p]!, tr = g.rev[gi]!;
        if (t < tr || g.lay.glyphs[gi]!.ch === ' ') continue;
        const lx = pt.x - g.lay.glyphs[gi]!.x;
        let x = x0 + X.xs[gi]! + lx * X.ss[gi]! * k, y = y0 + pt.y * k;
        const age = t - tr;
        let level = (0.4 + 0.6 * Math.exp(-age / 1.0)) * (0.6 + 0.4 * Math.sin(t * 2.2 + p * 1.7)), size = SIZE / 12 * 0.62 * (0.85 + 0.3 * pt.a) * (1 + 0.8 * Math.pow(0.5, age / 0.1)), flash = Math.pow(0.5, age / 0.12) * 0.8;
        let tone: Tone = 'green';
        if (spiralLine) {
          const td = this.tSpiral - 0.1 + 1.1 * pt.b, u = prog(t, td, td + 1.5, ease.inOutCubic);
          if (u > 0) {
            const th0 = Math.atan2((y - CY) / 0.64, x - CX), r0 = Math.hypot(x - CX, (y - CY) / 0.64);
            const arm = p % 2, rt = 60 + 520 * Math.pow(pt.a, 0.85), tht = arm * Math.PI + 3.3 * Math.log(1 + rt / 70) + (pt.b - 0.5) * 0.6 + 0.5 * (t - this.tSpiral) / Math.sqrt(rt / 120 + 0.6);
            let da = tht - th0; da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
            const rr = lerp(r0, rt, u), aa = th0 + da * u + (1 - u) * u * 2.2;
            x = CX + rr * Math.cos(aa) * 1.05; y = CY + rr * Math.sin(aa) * 0.64;
            size *= lerp(1, 0.6, u); level = Math.max(level, 0.5 * u); tone = mixTone('green', arm ? 'cyan' : 'white', u);
          }
        } else level *= 1 - gone;
        void gather;
        if (level < 0.01 && flash < 0.01) continue;
        st.stars.set(idx++, x, y, size, pt.a * TAU + age * (pt.b - 0.5), { level, flash }, tone, 0);
      }
      // a spray of stars on every chop onset of the word
      g.onsets.forEach((to, oi) => {
        const age = t - to;
        if (age < 0 || age > 1.0 || gone > 0.5) return;
        const gi = Math.min(g.lay.glyphs.length - 1, Math.floor((oi * g.lay.glyphs.length) / g.onsets.length));
        const ox = x0 + X.xs[gi]! + g.lay.glyphs[gi]!.w * X.ss[gi]! * 0.5, oy = y0 - SIZE * 0.3;
        for (let s = 0; s < 14; s++) {
          const a = TAU * hash(wi, oi, s, 3), d = (30 + 420 * ease.outCubic(age)) * (0.5 + 0.8 * hash(wi, oi, s, 4));
          const lv = Math.exp(-age / 0.32) * 1.0;
          if (lv > 0.03) st.stars.set(idx++, ox + Math.cos(a) * d * 1.3, oy + Math.sin(a) * d * 0.9, 8 + 8 * hash(wi, oi, s, 5), a + age * 4, { level: lv, flash: 0 }, s % 3 === 0 ? 'gold' : s % 3 === 1 ? 'cyan' : 'green', 0);
        }
      });
    });
    void phosphorCss;
    return idx;
  }
}
