// Break — the quiet. The scope's last screen collapses the way a tube does (to a line, to a dot) and the dot's
// afterglow opens into one star sticker in the dark. It decays and is recharged on a slow pulse; each recharge sends
// a ring of light outwards that charges the dust and a few faint ghost phrases of the chorus, which then fade;
// a heartbeat runs along the bottom, one beat per bar. In the last bar the star shivers, lets go and falls: the
// bridge's fall takes over from it.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { clamp, ease, lerp, mulberry32, prog, smoothstep, TAU } from '../../engine/util';
import { W, H } from '../../engine/gl';
import { measure } from '../../engine/type';
import { Glow2D, PHOS, VIOLET, WHITE, CYAN, lit, setFont, drawSticker, FAM } from './phos-b-kit';
import { ScopeRenderer } from './phos-scope';

const fallEase = (t: number, a: number, b: number) => ease.inCubic(prog(t, a, b));
const CX = 960, CY = 500, R = 205;
const PHRASES = ['take my hand', 'every broken piece', 'becomes a star', 'look how beautiful', 'never coming down', 'wake the whole town', 'glowing in the dark'];

export default class PhosBreak extends Scene {
  g = new Glow2D();
  g2 = new Glow2D();
  sr!: ScopeRenderer;
  dust: { x: number; y: number; r: number; vx: number; vy: number; ph: number }[] = [];
  ghosts: { x: number; y: number; size: number; rot: number; text: string; pk: number }[] = [];
  charges: number[] = [];
  beats: number[] = [];
  tFall = 0;

  override init() {
    const { audio, start, end } = this.ctx;
    this.sr = new ScopeRenderer(this.ctx);
    this.sr.init();
    const rnd = mulberry32(147);
    for (let i = 0; i < 120; i++) this.dust.push({ x: rnd() * W, y: rnd() * H, r: 0.9 + rnd() * 2.1, vx: (rnd() - 0.5) * 6, vy: -3 - rnd() * 7, ph: rnd() * 60 });
    PHRASES.forEach((text, i) => {
      const a = (i / PHRASES.length) * TAU + 0.35 + (rnd() - 0.5) * 0.25;
      const rx = 640 + rnd() * 120, ry = 330 + rnd() * 70;
      const text0 = text, size0 = 56 + rnd() * 30, hw = measure(text0, FAM(), size0) / 2 + 70;
      this.ghosts.push({ x: clamp(CX + Math.cos(a) * rx, hw, W - hw), y: CY + 20 + Math.sin(a) * ry, size: size0, rot: (rnd() - 0.5) * 0.16, text, pk: i % 3 });
    });
    this.beats = audio.downbeats.filter((d) => d >= start - 0.1 && d < end + 0.1);
    this.tFall = end - 1.6;
    // the recharges: the star's own emergence, then every second bar, then the last one before it lets go
    const bars = this.beats.filter((d) => d > start + 3.2 && d < this.tFall - 1.4);
    this.charges = [start + 1.3, ...bars.filter((_, i) => i % 2 === 1), this.tFall - 0.05];
  }

  private Q(t: number) {
    let q = 0.16;
    for (const tk of this.charges) {
      const rise = smoothstep(tk - 0.55, tk, t);
      const decay = t >= tk ? Math.exp(-(t - tk) / 1.55) : 1;
      q = Math.max(q, 0.16 + 0.84 * rise * decay);
    }
    return q;
  }
  private heart(tau: number) {
    let v = 0;
    const G = (x: number, s: number) => Math.exp(-(x * x) / (2 * s * s));
    for (const b of this.beats) {
      const k = this.charges.some((c) => Math.abs(c - b) < 0.3) ? 1.5 : 1;
      v += k * (0.14 * G(tau - b + 0.2, 0.05) - 0.18 * G(tau - b + 0.035, 0.012) + 1.0 * G(tau - b, 0.016) - 0.28 * G(tau - b - 0.04, 0.016) + 0.24 * G(tau - b - 0.3, 0.07));
      v += 0.45 * k * G(tau - b - 0.52, 0.02) - 0.1 * G(tau - b - 0.56, 0.015);   // the second beat of the pair
    }
    return v;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp, audio } = this.ctx;
    const g = this.g, c = g.c, t = f.t, lt = f.lt;
    g.begin();

    c.save();
    { const a = smoothstep(0.8, 1.6, lt), zz = 1 + a * (0.03 + 0.02 * Math.sin(t * 0.4)) + 0.01 * (1 - fallEase(t, this.tFall, this.ctx.end)) * 0;
      c.translate(W / 2 + a * 18 * Math.sin(t * 0.3), H / 2 + a * 10 * Math.cos(t * 0.37)); c.rotate(a * 0.012 * Math.sin(t * 0.25)); c.scale(zz, zz); c.translate(-W / 2, -H / 2); }
    // --- the scope's last screen goes out
    if (lt < 0.8) {
      const sy = 1 - ease.inCubic(prog(lt, 0, 0.34));
      const sx = 1 - ease.inOutCubic(prog(lt, 0.34, 0.74));
      if (sy > 0.02) {
        this.g2.begin();
        this.sr.draw(this.g2, null, t);
        c.save();
        c.globalAlpha = 1;
        c.drawImage(this.g2.main.canvas, 0, 0, W, H, W / 2 * (1 - sx), H / 2 * (1 - sy), W * sx, H * sy);
        c.restore();
      }
      const lineA = smoothstep(0.2, 0.34, lt) * (1 - smoothstep(0.62, 0.78, lt));
      if (lineA > 0.01) {
        const half = (W / 2) * (sx * 0.98 + 0.02);
        c.lineWidth = 4 + 6 * (1 - sx); c.strokeStyle = lit(WHITE, 0.95 * lineA, 0.9);
        c.beginPath(); c.moveTo(W / 2 - half, H / 2); c.lineTo(W / 2 + half, H / 2); c.stroke();
      }
    }
    // the dot: the last of the beam, burning in
    if (lt > 0.6 && lt < 3.2) {
      const a = lt - 0.74;
      const I = a < 0 ? smoothstep(0.6, 0.74, lt) : Math.exp(-a / 0.8);
      const r = 11 + 14 * (1 - Math.exp(-Math.max(a, 0) * 3));
      const gr = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, r * 2.4);
      gr.addColorStop(0, lit(WHITE, I, 1)); gr.addColorStop(0.3, lit(PHOS, 0.8 * I, 0.4)); gr.addColorStop(1, lit(PHOS, 0));
      c.fillStyle = gr; c.fillRect(W / 2 - r * 2.4, H / 2 - r * 2.4, r * 4.8, r * 4.8);
    }

    // --- the star's charge and the rings of light it sends out
    const Q = this.Q(t);
    const tSt = this.charges[0]!;
    const emerge = ease.outCubic(prog(t, tSt - 0.45, tSt + 1.1));
    const beatNear = this.beats.reduce((m, b) => Math.max(m, Math.exp(-Math.pow((t - b - 0.02) / 0.09, 2))), 0);
    const fall = ease.inCubic(prog(t, this.tFall, this.ctx.end + 0.05));
    const shiver = smoothstep(this.tFall - 0.5, this.tFall, t) * (1 - fall);
    const sy = CY + fall * 1400 + 4 * Math.sin(t * 0.7);
    const sx = CX + shiver * 5 * Math.sin(t * 61) + 3 * Math.sin(t * 0.5);

    // dust: charged when a ring passes it, then it decays; during the fall it streams upward
    const speedUp = 1 + 160 * fall;
    for (const d of this.dust) {
      const x = ((d.x + d.vx * t) % W + W) % W;
      const y = (((d.y + d.vy * t * speedUp - 40 * fall * (this.ctx.end - t) * 0) % H) + H) % H;
      const dist = Math.hypot(x - CX, y - CY);
      let I = 0.05 + 0.03 * Math.sin(t * 1.3 + d.ph);
      for (const tk of this.charges) {
        const arr = tk + Math.max(0, dist - R) / 520;
        if (t >= arr) I = Math.max(I, 0.8 * Math.exp(-(t - arr) / 1.5) * (1 - fall * 0.4));
      }
      if (I < 0.01) continue;
      const sz = d.r * (1 + 0.6 * I);
      c.fillStyle = lit(PHOS, I, 0.25);
      c.beginPath(); c.arc(x, y, sz, 0, TAU); c.fill();
    }
    // ghost phrases of the chorus, waking when a ring passes
    for (const gh of this.ghosts) {
      const dist = Math.hypot(gh.x - CX, gh.y - CY);
      let I = 0.028;
      this.charges.forEach((tk, k) => {
        if (k % 3 !== gh.pk && k !== 0) return;
        const arr = tk + Math.max(0, dist - R) / 520;
        if (t >= arr) I = Math.max(I, 0.17 * Math.exp(-(t - arr) / 2.1) * smoothstep(0, 0.35, t - arr));
      });
      I *= 1 - fall;
      if (I < 0.008) continue;
      c.save();
      c.translate(gh.x, gh.y); c.rotate(gh.rot);
      setFont(c, gh.size);
      c.fillStyle = lit(PHOS, I);
      c.fillText(gh.text, -measure(gh.text, FAM(), gh.size) / 2, 0);
      c.restore();
    }
    for (const tk of this.charges.slice(1)) {
      const a = t - tk;
      if (a < 0 || a > 3) continue;
      const r = R * 0.9 + a * 520;
      c.lineWidth = 3 * (1 - a / 3) + 1; c.strokeStyle = lit(a < 0.4 ? WHITE : VIOLET, 0.5 * Math.exp(-a / 1.1), 0.3);
      c.beginPath(); c.arc(CX, CY, r, 0, TAU); c.stroke();
      c.lineWidth = 1.5; c.strokeStyle = lit(CYAN, 0.18 * Math.exp(-a / 1.1));
      c.beginPath(); c.arc(CX, CY, r * 0.985, 0, TAU); c.stroke();
    }

    // --- the sticker
    if (emerge > 0.001) {
      const rot = (1 - emerge) * -0.7 + 0.02 * Math.sin(t * 0.4);
      const sz = R * emerge * (1 + 0.012 * beatNear);
      // trail while it falls (persistence)
      if (fall > 0.002) {
        for (let n = 7; n >= 1; n--) {
          const ft = ease.inCubic(prog(t - n * 0.03, this.tFall, this.ctx.end + 0.05));
          drawSticker(c, sx, CY + ft * 1400, sz * (1 - n * 0.02), Math.min(1, Q) * 0.5 * Math.exp(-n * 0.3), rot);
        }
      }
      // the halo of its charge
      const hr = sz * (1.5 + 1.8 * Q);
      const gr = c.createRadialGradient(sx, sy, sz * 0.5, sx, sy, hr);
      gr.addColorStop(0, lit(PHOS, 0.16 * Q)); gr.addColorStop(1, lit(PHOS, 0));
      c.fillStyle = gr; c.fillRect(sx - hr, sy - hr, hr * 2, hr * 2);
      drawSticker(c, sx, sy, sz, Math.min(0.8, Q * 0.8 + 0.1 * beatNear), rot);
    }

    // --- the heartbeat, one beat per bar, with its own persistence
    {
      const period = 6, x0 = 640, x1 = 1280, yc = 975, A = 52;
      const u0 = ((t / period) % 1 + 1) % 1;
      const vis = smoothstep(tSt + 0.4, tSt + 1.4, t) * (1 - smoothstep(this.tFall - 0.3, this.tFall + 0.2, t));
      if (vis > 0.01) {
        const N = 150;
        c.lineWidth = 2.4;
        for (let i = 0; i < N; i++) {
          const u = i / N, u2 = (i + 1) / N;
          const age = ((u0 - u) % 1 + 1) % 1 * period;
          if (age < 0.12 && ((u0 - u2) % 1 + 1) % 1 * period > age) continue;
          const I = (0.08 + 0.8 * Math.exp(-age / 1.7)) * vis;
          c.strokeStyle = lit(PHOS, I, 0.4 * Math.exp(-age / 0.2));
          c.beginPath();
          c.moveTo(lerp(x0, x1, u), yc - A * this.heart(t - age));
          c.lineTo(lerp(x0, x1, u2), yc - A * this.heart(t - age + period / N));
          c.stroke();
        }
        const hx = lerp(x0, x1, u0), hy = yc - A * this.heart(t);
        const gr = c.createRadialGradient(hx, hy, 0, hx, hy, 16);
        gr.addColorStop(0, lit(WHITE, vis, 1)); gr.addColorStop(1, lit(PHOS, 0));
        c.fillStyle = gr; c.fillRect(hx - 16, hy - 16, 32, 32);
      }
    }

    // a faint UV breath on the bass
    const kick = audio.hit('kick', t, 0.12) * 0.5;
    if (kick > 0.02) {
      const vg = c.createRadialGradient(W / 2, H / 2, 500, W / 2, H / 2, 1200);
      vg.addColorStop(0, lit(VIOLET, 0)); vg.addColorStop(1, lit(VIOLET, 0.08 * kick));
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
    }
    c.restore();
    g.present(renderer, comp, out, { glow: 1.0 + 0.4 * Q });
    return { bloom: 0.95, bloomThreshold: 0.7, bloomRadius: 0.85, vignette: 0.55, grain: 0.06, ca: 0.4, halation: 0.12 };
  }
}
