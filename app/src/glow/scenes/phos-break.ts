// Break — the breath. The scope's last screen collapses the way a tube does (to a line, to a dot) and the dot's
// afterglow is the first glow-in-the-dark sticker stuck on the dark (the bedroom ceiling of the intro). Then, on the
// beat, more stickers are SLAPPED on around it, one hit at a time (each pops in white-hot and settles to its glow,
// crooked like real ones), growing outward while the camera pulls back: they are the pieces of one giant star.
// When the band drops out for a beat the whole ceiling goes dead; on the hit after it every sticker is recharged at
// once (the giant star blazes), then they draw together into one star sticker, which shivers, lets go and falls:
// the bridge's fall takes over from it.
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
  kicks: [number, number][] = [];
  pieces: { x: number; y: number; r: number; rot: number; t: number; col: [number, number, number] }[] = [];
  tOut = 0; tIn = 0; tIn0 = 0; // the drop-out and the hit after it

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
    // the fall starts on the strong kick nearest 1.6 s before the bridge (on the beat, not between)
    const fk = audio.events('kick', end - 2.1, end - 1.0).filter(([, k]) => k >= 0.8).map(([k]) => k);
    this.tFall = fk.length ? fk.reduce((b, k) => (Math.abs(k - (end - 1.6)) < Math.abs(b - (end - 1.6)) ? k : b)) : end - 1.6;
    this.kicks = audio.events('kick', start + 0.5, this.tFall).filter(([, k]) => k >= 0.7);
    // the band drops out for a beat before the last bars: find the quietest moment, and the hit after it
    let qt = this.tFall - 1.5, qv = 9;
    for (let x = start + 6; x < this.tFall - 0.4; x += 0.05) { const v = audio.env('rms', x); if (v < qv) { qv = v; qt = x; } }
    this.tOut = qt - 0.12;
    this.tIn0 = 0;
    this.tIn = (audio.events('kick', qt, this.tFall).filter(([, k]) => k >= 0.8)[0]?.[0]) ?? qt + 0.5;
    // the recharges: the star's own emergence, then every second bar, then the last one before it lets go
    const bars = this.beats.filter((d) => d > start + 3.2 && d < this.tFall - 1.4);
    const first = audio.events('kick', start + 0.9, start + 2.0).filter(([, k]) => k >= 0.85)[0]?.[0] ?? start + 1.3;
    this.charges = [first, ...bars.filter((_, i) => i % 2 === 1), this.tFall - 0.05];
  }

  private Q(t: number) {
    let q = 0.16;
    for (const [k, sK] of this.kicks) if (t >= k && t - k < 3) q = Math.max(q, 0.3 + 0.5 * sK * Math.exp(-(t - k) / 0.5));
    for (const tk of this.charges) {
      const rise = smoothstep(tk - 0.55, tk, t);
      const decay = t >= tk ? Math.exp(-(t - tk) / 1.55) : 1;
      q = Math.max(q, 0.16 + 0.84 * rise * decay);
    }
    return q;
  }
  /** the giant star's pieces: points of a hex grid inside a five-pointed star, slapped on in order of distance */
  private build() {
    const { audio } = this.ctx;
    const Rg = 430, inner = 0.46, pts: { x: number; y: number; d: number }[] = [];
    const poly: [number, number][] = [];
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? Rg * inner : Rg; poly.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const inside = (x: number, y: number) => { let c = false; for (let i = 0, j = 9; i < 10; j = i++) { const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const st = 46, rnd = mulberry32(5);
    for (let gy = -Rg; gy <= Rg; gy += st * 0.87) for (let gx = -Rg; gx <= Rg; gx += st) {
      const x = gx + ((Math.round(gy / (st * 0.87)) % 2) ? st / 2 : 0) + (rnd() - 0.5) * 14, y = gy + (rnd() - 0.5) * 14;
      if (inside(x, y) && Math.hypot(x, y) > 30) pts.push({ x, y, d: Math.hypot(x, y) + rnd() * 60 });
    }
    pts.sort((a, b) => a.d - b.d);
    this.pieces.push({ x: CX, y: CY, r: 30, rot: 0.1, t: this.charges[0]!, col: PHOS });
    const t0 = this.charges[0]! + 0.9, t1 = this.tOut - 0.15;
    const hits = [...audio.events('kick', t0, t1).filter(([, k]) => k >= 0.45), ...audio.events('snare', t0, t1).filter(([, k]) => k >= 0.88)].map(([x]) => x).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1]! > 0.09);
    const per = Math.ceil(pts.length / Math.max(1, hits.length));
    const tones: [number, number, number][] = [PHOS, PHOS, PHOS, [210, 255, 170], [255, 222, 150]];
    pts.forEach((p, i) => {
      const h = hits[Math.min(hits.length - 1, Math.floor(i / per))] ?? t0;
      this.pieces.push({ x: CX + p.x, y: CY + p.y, r: 15 + 12 * rnd(), rot: (rnd() - 0.5) * 1.2, t: h + 0.012 * (i % per), col: tones[Math.floor(rnd() * tones.length)]! });
    });
  }
  private ceiling(c: CanvasRenderingContext2D, t: number) {
    if (!this.pieces.length) this.build();
    const out = t > this.tOut && t < this.tIn;
    const gather = ease.inOutCubic(prog(t, this.tIn + 0.1, this.tFall));
    const blaze = t >= this.tIn ? Math.exp(-(t - this.tIn) / 0.6) : 0;
    const kick = this.kicks.reduce((v, [k, sK]) => Math.max(v, t >= k ? sK * Math.pow(0.5, (t - k) / 0.12) : 0), 0);
    for (const p of this.pieces) {
      if (t < p.t) continue;
      const age = t - p.t;
      let q = 0.42 + 0.58 * Math.exp(-age / 0.35) + 0.2 * kick;
      if (out) q = 0.04;
      q = Math.max(q, blaze * 1.2);
      const pop = 1 + 0.8 * Math.pow(0.5, age / 0.05);
      const x = lerp(p.x, CX + (p.x - CX) * 0.42, gather), y = lerp(p.y, CY + (p.y - CY) * 0.42, gather);
      const fade = 1 - smoothstep(0.75, 1, gather);
      if (fade < 0.01) continue;
      drawSticker(c, x, y, p.r * pop * lerp(1, 0.6, gather), Math.min(1, q) * fade, p.rot, p.col);
    }
  }

  /** the companion's position at time x (world px), its orbit radius shrinking to nothing as it merges */
  private comp(x: number): [number, number] {
    const bar = 1.6, w = TAU / bar, prec = TAU / 9.5;
    const e = 0.42 + 0.08 * Math.sin(x * 0.21), a = 410;
    const phi = w * x + 0.35 * Math.sin(w * x), pw = prec * x;
    const merge = ease.inCubic(prog(x, this.tIn, this.tFall - 0.02));
    const r = a * (1 - e * e) / (1 + e * Math.cos(phi - pw)) * (1 - merge);
    const ph = phi + merge * merge * 9;
    return [CX + r * Math.cos(ph), CY + r * Math.sin(ph) * 0.78];
  }
  private orbit(c: CanvasRenderingContext2D, t: number, fall: number) {
    const t0 = this.charges[0]! + 0.6; // it is caught once the star has emerged
    if (t < t0 || fall > 0.02) return;
    const born = smoothstep(t0, t0 + 0.8, t);
    const out = this.tOut && t > this.tOut && t < this.tIn ? 1 : 0;
    const kick = this.kicks.reduce((v, [k, sK]) => Math.max(v, t >= k ? sK * Math.pow(0.5, (t - k) / 0.1) : 0), 0);
    const bar = this.beats.filter((b) => b <= t).length;
    const tones: [number, number, number][] = [PHOS, CYAN, [200, 170, 255], [255, 210, 120]];
    const col = tones[bar % tones.length]!;
    // the trail: the last 2.4 s of the path, decaying (the recharge of a kick lifts all of it)
    const N = 220, span = 2.4;
    c.save(); c.lineCap = 'round';
    for (let i = N - 1; i >= 0; i--) {
      const a0 = (i / N) * span, a1 = ((i + 1) / N) * span, x0 = t - a0, x1 = t - a1;
      if (x1 < t0) continue;
      if (this.tOut && x0 > this.tOut && x0 < this.tIn) continue; // the drop-out wrote nothing
      let I = Math.exp(-a0 / 0.75) * (1 + 1.2 * kick) * born * (1 - out * 0.9);
      if (this.tOut && t >= this.tIn && x0 < this.tOut) I *= 0; // the trail from before the drop-out is gone
      if (I < 0.01) continue;
      const [ax, ay] = this.comp(x0), [bx, by] = this.comp(x1);
      c.lineWidth = 2 + 4.5 * Math.exp(-a0 / 0.4);
      c.strokeStyle = lit(col, Math.min(1, I), 0.6 * Math.exp(-a0 / 0.12));
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    }
    c.restore();
    // beads: a sticker stamped where the companion was on each kick, decaying slowly
    for (const [k, sK] of this.kicks) {
      if (k < t0 || k > t || (this.tOut && k < this.tOut && t >= this.tIn)) continue;
      const age = t - k, q = sK * (0.25 + 0.75 * Math.exp(-age / 0.35)) * Math.exp(-age / 4.5);
      if (q < 0.03) continue;
      const [x, y] = this.comp(k);
      drawSticker(c, x, y, 9 + 9 * sK * (1 + 1.2 * Math.pow(0.5, age / 0.08)), Math.min(1, q), k * 3, col);
    }
    // the companion itself
    if (!out) {
      const [x, y] = this.comp(t);
      const merge = prog(t, this.tIn, this.tFall - 0.02);
      drawSticker(c, x, y, (34 + 10 * kick) * (1 - 0.6 * merge) * born, 0.75 + 0.25 * kick, t * 1.3, WHITE);
    }
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
    { const a = smoothstep(0.8, 1.6, lt), zz = (1 + a * (0.03 + 0.02 * Math.sin(t * 0.4))) * lerp(1, lerp(2.3, 1.0, ease.inOutQuad(prog(t, this.charges[0]!, this.tOut))), smoothstep(0.7, 1.3, lt)) + 0.01 * (1 - fallEase(t, this.tFall, this.ctx.end)) * 0;
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
    const emerge = ease.outCubic(prog(t, this.tFall - 0.22, this.tFall)); void tSt;
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
      void dist;
      I += 0.25 * this.Q(t) * 0.4;
      if (I < 0.01) continue;
      const sz = d.r * (1 + 0.6 * I);
      c.fillStyle = lit(PHOS, I, 0.25);
      c.beginPath(); c.arc(x, y, sz, 0, TAU); c.fill();
    }
    this.ceiling(c, t);

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

    // a faint UV breath on the bass
    const kick = audio.hit('kick', t, 0.12) * 0.5;
    if (kick > 0.02) {
      const vg = c.createRadialGradient(W / 2, H / 2, 500, W / 2, H / 2, 1200);
      vg.addColorStop(0, lit(VIOLET, 0)); vg.addColorStop(1, lit(VIOLET, 0.08 * kick));
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
    }
    c.restore();
    g.present(renderer, comp, out, { glow: 1.0 + 0.4 * Q });
    // light shakes and punches on the beat (kicks; snares a little less), none once the star falls
    const kk = audio.hit('kick', t, 0.07), sn = audio.hit('snare', t, 0.06) * 0.5, hk = Math.max(kk, sn) * (1 - fall) * smoothstep(0.6, 1.2, lt);
    const ph = Math.round(t * 60), jx = Math.sin(ph * 12.9898) * 43758.5453, jy = Math.sin(ph * 78.233) * 12543.31;
    const shake: [number, number] = [((jx - Math.floor(jx)) * 2 - 1) * 7 * hk, ((jy - Math.floor(jy)) * 2 - 1) * 5 * hk];
    return { bloom: 0.95, bloomThreshold: 0.7, bloomRadius: 0.85, vignette: 0.55, grain: 0.06, ca: 0.4, halation: 0.12, shake, zoom: 1 + 0.018 * kk * (1 - fall) };
  }
}
