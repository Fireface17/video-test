// Small life in the galaxy: comets that cross on the beat, a pulsar that blinks in time, supernovae that
// bloom on big hits (world-anchored, so the camera flies past them). Screen-space glow points.
import * as THREE from 'three';
import { clamp, hash } from '../../engine/util';
import { GlowPoints } from '../lib/points';

export interface Proj { uv(x: number, y: number): [number, number]; z: number }
export interface Nova { t: number; at: [number, number]; scale: number }

export class Details {
  pts = new GlowPoints(1500, 1);
  private n = 0;
  constructor(private beats: number[], private t0: number, private t1: number, private tint: THREE.Color, private hot: THREE.Color, private rate: number) {
    this.pts.renderOrder = 4;
  }
  private put(x: number, y: number, c: THREE.Color, k: number, s: number) { if (this.n < this.pts.n && k > 0.003) this.pts.set(this.n++, x, y, 0.015, c, k, s); }

  update(t: number, beatPhase: number, kick: number, pr: Proj, novae: Nova[], pulsar: [number, number]) {
    this.n = 0;
    // comets: one per chosen beat, crossing the frame in 0.9 s, tail behind
    const bs = this.beats;
    for (let i = 0; i < bs.length; i++) {
      const tb = bs[i]!;
      if (tb > t) break;
      const age = t - tb;
      if (age > 1.0 || tb < this.t0 - 1 || tb > this.t1 || hash(i, 91) > this.rate) continue;
      const dir = hash(i, 92) > 0.5 ? 1 : -1, y0 = -0.35 + 1.3 * hash(i, 93), sl = (hash(i, 94) - 0.5) * 0.9;
      const e = 1 - Math.pow(1 - clamp(age / 0.9), 2.2);
      const fade = 1 - clamp((age - 0.6) / 0.4);
      for (let j = 0; j < 46; j++) {
        const f = j / 46, ee = Math.max(0, e - f * 0.22);
        const x = dir * (-2.2 + 4.4 * ee), y = y0 + sl * (x * dir);
        this.put(x, y + Math.sin(j * 1.7 + i) * 0.006 * f, this.hot.clone().lerp(this.tint, f), Math.pow(1 - f, 1.6) * 2.4 * fade, 0.03 * (1.1 - f * 0.7));
      }
    }
    // pulsar: a star that blinks on every beat, beams turning
    {
      const [x, y] = pr.uv(pulsar[0], pulsar[1]);
      if (Math.abs(x) < 2.2 && Math.abs(y) < 1.3) {
        const k = Math.pow(1 - beatPhase, 3) + 0.15, a = t * 0.9;
        this.put(x, y, this.hot, 2.2 * k, 0.09);
        for (let b = 0; b < 2; b++) for (let j = 1; j < 24; j++) {
          const f = j / 24, s = b ? -1 : 1;
          this.put(x + Math.cos(a) * s * f * 0.32, y + Math.sin(a) * s * f * 0.32, this.tint, (1 - f) * 1.6 * k, 0.014);
        }
      }
    }
    // supernovae
    for (const nv of novae) {
      const age = t - nv.t;
      if (age < -0.05 || age > 3.2) continue;
      const [x, y] = pr.uv(nv.at[0], nv.at[1]);
      const sc = nv.scale, a0 = Math.max(age, 0);
      const fl = Math.exp(-a0 * 5);
      this.put(x, y, this.hot, 5 * fl + 0.5 * Math.exp(-a0 * 0.8), (0.9 * fl + 0.12) * sc);
      const R = (1 - Math.exp(-a0 * 2.2)) * 0.75 * sc;
      for (let j = 0; j < 100; j++) {
        const an = (j / 100) * 6.2832;
        this.put(x + Math.cos(an) * R, y + Math.sin(an) * R * 0.9, this.tint, 1.4 * Math.exp(-a0 * 1.1), 0.016);
      }
      for (let s = 0; s < 12; s++) for (let j = 1; j < 16; j++) {
        const an = (s / 12) * 6.2832 + 0.2, f = j / 16, L = (1 - Math.exp(-a0 * 4)) * (s % 2 ? 0.45 : 0.9) * sc;
        this.put(x + Math.cos(an) * L * f, y + Math.sin(an) * L * f, this.hot, (1 - f) * 2 * Math.exp(-a0 * 1.6), 0.012);
      }
    }
    for (let i = this.n; i < this.pts.n; i++) this.pts.hide(i);
    this.pts.commit(Math.max(1, this.n));
  }
}
