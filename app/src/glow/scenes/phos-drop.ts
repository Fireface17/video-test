// DROP 1, bars 1-8 (no words in the drops): THE LIGHT SWITCH. The phosphor idea at full power, on the beat.
// Chorus 1 ends "in the dark", collapsed into one point; the drop hits and the LIGHT GOES ON: we are on our back
// looking up at a ceiling covered in glow-in-the-dark star stickers, pale and dead in the lamp light. Off: the
// stickers blaze, charged by the light, and their glow decays. Every hard kick of the drop is the switch (a few frames
// of light, then the dark and the glow); the vocal chops recharge them a little; on every downbeat the framing cuts
// (wide, a cluster, a quarter turn, one sticker in macro, a slow spin...). In bar 7 the lamp is gone: the stickers come
// off the ceiling, and in bar 8 they swirl into the two arms of a spiral around a white-gold core: the star-dust
// spiral the galaxy scene (cosmos) opens on.
//   params.n is unused (kept for symmetry with the other phos scenes).
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { W, H } from '../../engine/gl';
import { clamp, ease, hash, lerp, prog, smoothstep, TAU } from '../../engine/util';
import { PhosphorStage, glowAt, mixTone, phosphorLin, type Charge, type Tone } from '../lib/phosphor';
import { clearRT } from '../../engine/gl';
import { apply, cam, camXf, CX, CY, scaleOf, rotOf, mixCam, type Cam, type Xf } from '../lib/phos-cut';

interface Sticker { x: number; y: number; r: number; rot: number; k: number; gold: boolean; arm: number; sr: number; sth: number }

export default class PhosDrop extends Scene {
  st!: PhosphorStage;
  stickers: Sticker[] = [];
  lights: number[] = [];   // the switch: strong kicks
  chops: Charge[] = [];
  bars: number[] = [];
  cams: Cam[] = [];
  tLift = 0; tSpiral = 0;

  override async init() {
    const { audio, start, end } = this.ctx;
    this.st = new PhosphorStage(this.ctx, 2000);
    this.bars = audio.downbeats.filter((d) => d >= start - 0.05 && d < end - 0.05);
    this.tLift = this.bars[6] ?? end - 3.2; // bar 7
    this.tSpiral = this.bars[7] ?? end - 1.6; // bar 8
    this.lights = [start, ...audio.events('kick', start + 0.3, this.tLift - 0.05).filter(([, s]) => s >= 0.8).map(([t]) => t)];
    this.chops = audio.events('chop', start, end + 0.2).filter(([, s]) => s >= 0.3).map(([t, s]) => ({ t, s: 0.35 + 0.4 * s }));
    // the ceiling: a kid's sky of stickers, a few big ones and many small, never overlapping much
    const n = 120;
    for (let i = 0, tries = 0; this.stickers.length < n && tries < 6000; tries++, i++) {
      const big = hash(i, 9, 3) < 0.12;
      const r = big ? 60 + 70 * hash(i, 1, 3) : 14 + 30 * Math.pow(hash(i, 2, 3), 1.6);
      const x = (hash(i, 3, 3) - 0.5) * 3000, y = (hash(i, 4, 3) - 0.5) * 1900;
      if (this.stickers.some((s) => Math.hypot(s.x - x, s.y - y) < (s.r + r) * 1.15)) continue;
      const k = hash(i, 5, 3), arm = this.stickers.length % 2;
      const sr = 40 + 560 * Math.pow(hash(i, 6, 3), 0.8);
      this.stickers.push({ x, y, r, rot: (hash(i, 7, 3) - 0.5) * 1.4, k, gold: hash(i, 8, 3) < 0.08, arm, sr, sth: arm * Math.PI + 3.3 * Math.log(1 + sr / 70) + (hash(i, 10, 3) - 0.5) * 0.5 });
    }
    // the framings, one per bar (world: the ceiling, centred on 0, 0)
    this.cams = [
      cam(0, 0, 0.78, 0.04), cam(-420, -160, 1.7, -0.12), cam(260, 120, 1.05, Math.PI / 2), cam(0, 0, 0.9, 0),
      cam(300, -200, 2.2, 0.3), cam(-200, 180, 1.25, -0.2), cam(0, 0, 0.85, 0), cam(0, 0, 0.85, 0),
    ];
    // the macro shot: frame the biggest sticker
    const bigS = this.stickers.reduce((a, b) => (b.r > a.r ? b : a));
    this.cams[3] = cam(bigS.x, bigS.y, (H * 0.36) / bigS.r, -bigS.rot);
  }

  /** the bar's framing, drifting (the camera never rests); bar 5 spins slowly */
  private camAt(t: number): Cam {
    let b = 0;
    this.bars.forEach((d, i) => { if (t >= d) b = i; });
    const k = this.cams[Math.min(b, this.cams.length - 1)]!, t0 = this.bars[b] ?? this.ctx.start, u = t - t0;
    const spin = b === 4 ? 0.35 * u : b === 6 ? 0.12 * u : 0.025 * u * (b % 2 ? -1 : 1);
    return { x: k.x + 30 * u, y: k.y - 20 * u, z: k.z * (1 + 0.045 * u), r: k.r + spin };
  }

  /** 0..1: the lamp. A hard switch: on for a few frames on each strong kick (the drop's first hit a little longer) */
  private lamp(t: number): number {
    let v = 0;
    for (const [i, k] of this.lights.entries()) {
      const on = i === 0 ? 0.11 : 0.05, dt = t - k;
      if (dt < -0.004 || dt > on + 0.03) continue;
      v = Math.max(v, smoothstep(-0.004, 0.004, dt) * (1 - smoothstep(on, on + 0.02, dt)));
    }
    return v;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { audio, start, end } = this.ctx, st = this.st, t = f.t, c = st.L.ctx;
    st.begin(out);
    const k = this.camAt(t);
    const m = camXf(k);
    const lamp = t < this.tLift ? this.lamp(t) : 0;
    const lift = ease.inOutCubic(prog(t, this.tLift, this.tSpiral + 0.2));
    const g = ease.inOutCubic(prog(t, this.tSpiral - 0.1, end - 0.05)); // the spiral
    const ev: Charge[] = [...this.lights.map((x) => ({ t: x + 0.05, s: 1.2 })), ...this.chops].sort((a, b) => a.t - b.t);

    // ---- lamp light: the ceiling plaster (cleared straight into the target: no canvas involved)
    if (lamp > 0.01) clearRT(this.ctx.renderer, out, [0.27 * lamp, 0.225 * lamp, 0.16 * lamp]);
    let idx = 0;
    const z = scaleOf(m), rr = rotOf(m);
    for (let i = 0; i < this.stickers.length; i++) {
      const s = this.stickers[i]!;
      let [x, y] = apply(m, s.x, s.y);
      let size = s.r * z, rot = s.rot + rr;
      // bar 7: off the ceiling, drifting inward and turning (depth: the small ones move more)
      if (lift > 0) {
        const d = 0.35 + 0.65 * (1 - s.r / 130);
        x = lerp(x, CX + (x - CX) * 0.7, lift * d); y = lerp(y, CY + (y - CY) * 0.7, lift * d);
        rot += lift * (s.k - 0.5) * 4; size *= lerp(1, 0.75, lift);
      }
      // bar 8: the spiral (screen space, tilted disc)
      let tone: Tone = s.gold ? 'gold' : mixTone('green', 'white', 0.08 * s.k);
      if (g > 0) {
        const th = s.sth + 0.6 * (t - this.tSpiral) / Math.sqrt(s.sr / 120 + 0.6);
        const tx = CX + s.sr * Math.cos(th) * 1.05, ty = CY + s.sr * Math.sin(th) * 0.62;
        const a0 = Math.atan2((y - CY) / 0.62, x - CX), r0 = Math.hypot(x - CX, (y - CY) / 0.62);
        let da = th - a0; da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
        const e = clamp(g * 1.2 - 0.2 * s.k), rq = lerp(r0, s.sr, e), aq = a0 + da * e + (1 - e) * e * 2.0;
        x = CX + rq * Math.cos(aq) * 1.05; y = CY + rq * Math.sin(aq) * 0.62;
        size = lerp(size, 5 + 9 * (1 - s.sr / 620), e);
        tone = mixTone(tone, s.sr < 140 ? 'white' : s.arm ? 'cyan' : mixTone('cyan', 'violet', 0.4), e);
      }
      if (x < -size * 2 - 40 || x > W + size * 2 + 40 || y < -size * 2 - 40 || y > H + size * 2 + 40) continue;
      // the glow: charged by every switch of the lamp, recharged a little by the chops, decaying in the dark
      const gl = glowAt(t, ev, { tau: 0.85 + 0.5 * s.k });
      let level = Math.max(0.1, gl.level) * (1 - 0.85 * lamp), flash = gl.flash * 0.25 * (1 - lamp);
      if (lift > 0) level = Math.max(level, 0.45 * lift);
      if (g > 0) { level = lerp(level, 0.35 + 0.55 * (1 - s.sr / 640), g); flash *= 1 - g; }
      if (lamp > 0.01) {
        // in the lamp light: a pale, matte sticker on the plaster (its glow drowned by the room light)
        const gc = phosphorLin({ level, flash }, tone), pale: [number, number, number] = s.gold ? [0.5, 0.45, 0.28] : [0.42, 0.48, 0.34];
        st.stars.setRaw(idx++, x, y, size, rot, [lerp(gc[0], pale[0], lamp), lerp(gc[1], pale[1], lamp), lerp(gc[2], pale[2], lamp)], 0);
      } else st.stars.set(idx++, x, y, size, rot, { level, flash }, tone, 0.35);
    }
    // a little star dust joins the spiral in bar 8 (the arms need more than the ceiling had)
    if (g > 0) {
      for (let i = 0; i < 520; i++) {
        const sr = 30 + 600 * Math.pow(hash(i, 1, 8), 0.75), arm = i % 2;
        const th = arm * Math.PI + 3.3 * Math.log(1 + sr / 70) + (hash(i, 2, 8) - 0.5) * 0.6 + 0.6 * (t - this.tSpiral) / Math.sqrt(sr / 120 + 0.6);
        const e = clamp(g * 1.4 - 0.4 * hash(i, 3, 8));
        if (e <= 0) continue;
        const x = CX + sr * Math.cos(th) * 1.05 * (2 - e), y = CY + sr * Math.sin(th) * 0.62 * (2 - e);
        st.stars.set(idx++, x, y, 2.5 + 5 * (1 - sr / 640), th, { level: e * (0.25 + 0.5 * (1 - sr / 640)), flash: 0 }, sr < 140 ? 'white' : arm ? 'cyan' : mixTone('cyan', 'violet', 0.4), 0);
      }
      const r = lerp(30, 340, ease.outCubic(g)), a = 0.8 * g;
      const gr = c.createRadialGradient(CX, CY, 0, CX, CY, r);
      gr.addColorStop(0, `rgba(255,248,225,${a})`); gr.addColorStop(0.2, `rgba(255,214,140,${a * 0.5})`); gr.addColorStop(1, 'rgba(255,200,120,0)');
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.translate(0, CY); c.scale(1, 0.62); c.translate(0, -CY); c.fillStyle = gr; c.fillRect(CX - r, CY - r, r * 2, r * 2); c.restore();
    }
    st.stars.commit(idx);

    const o = st.end(out, { gain: 1.5, uv: 0 });
    // the hit: each switch punches the frame (and shakes it a little); the drop's first hit hardest
    let kk = 0;
    for (const [i, x] of this.lights.entries()) if (t >= x) kk = Math.max(kk, (i === 0 ? 1.6 : 1) * Math.pow(0.5, (t - x) / 0.08));
    const ph = Math.round(t * 60), jx = Math.sin(ph * 12.9898) * 43758.5453, jy = Math.sin(ph * 78.233) * 12543.31;
    const shake: [number, number] = [((jx - Math.floor(jx)) * 2 - 1) * 9 * kk, ((jy - Math.floor(jy)) * 2 - 1) * 7 * kk];
    const post: PostOverrides = { ...o, zoom: 1 + 0.05 * kk + 0.06 * g * g, shake, flash: 0, bloom: lamp > 0.3 ? 0.2 : 0.6, bloomThreshold: 0.68, halation: lamp > 0.3 ? 0.02 : 0.07, vignette: 0.55 };
    void start; void mixCam;
    return post;
  }
}
