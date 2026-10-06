// "Take my hand" without hands: two stars, each trailing a long stream of light from outside the frame, curve
// toward each other and reach; on "hand" they join — a flash, a ring of light, a burst of sparks — and the
// merged star hangs in the sky for a moment before it fades into the galaxy. Also the lone star the whole
// galaxy converges into at the end of drop 3. Screen space (ndc: x ±16/9, y ±1).
import * as THREE from 'three';
import { clamp, hash, smoothstep } from '../../engine/util';
import { GlowPoints } from '../lib/points';

type V2 = [number, number];
export interface Join {
  /** the moment they meet */
  t: number; dur: number;
  L: { S: V2; C: V2 }; R: { S: V2; C: V2 }; M: V2;
  cL: THREE.Color; cR: THREE.Color; cJ: THREE.Color;
  /** seconds the merged star stays */
  keep: number;
  /** the merged star's final size (ndc half-height units) */
  size?: number;
}
export interface Fx { sun: [number, number, number, number]; shock: [number, number, number, number] }

const ease = (x: number) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const bez = (a: V2, c: V2, b: V2, u: number): V2 => {
  const v = 1 - u;
  return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
};

function starGeo(inner = 0.42) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 === 0 ? 1 : inner;
    if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(sh);
}

export class Motif {
  group = new THREE.Group();
  pts: GlowPoints;
  stars: THREE.Mesh[] = [];
  private N = 1400;

  constructor() {
    this.pts = new GlowPoints(this.N, 1);
    this.pts.renderOrder = 7;
    this.group.add(this.pts);
    const g = starGeo();
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      m.renderOrder = 8;
      m.visible = false;
      this.stars.push(m);
      this.group.add(m);
    }
  }

  private n = 0;
  private put(x: number, y: number, c: THREE.Color, k: number, size: number) {
    if (this.n < this.N && k > 0.002) this.pts.set(this.n++, x, y, 0.02, c, k, size);
  }
  private star(i: number, x: number, y: number, s: number, c: THREE.Color, k: number, rot: number) {
    const m = this.stars[i]!;
    m.visible = k > 0.002 && s > 0;
    m.position.set(x, y, 0.03);
    m.scale.setScalar(s);
    m.rotation.z = rot;
    (m.material as THREE.MeshBasicMaterial).color.copy(c).multiplyScalar(k);
  }

  begin() { this.n = 0; for (const m of this.stars) m.visible = false; }
  end() {
    for (let i = this.n; i < this.N; i++) this.pts.hide(i);
    this.pts.commit(Math.max(this.n, 1));
  }

  /** Draws one join at time t; returns the lights it adds to the sky (sun, shockwave) */
  join(ev: Join, t: number, slot: number, fx: Fx) {
    const t0 = ev.t - ev.dur, tau = t - ev.t;
    if (t < t0 - 0.05 || tau > ev.keep + 0.8) return;
    const S = (x: number) => Math.max(x, 0);
    if (tau < 0) {
      const e = ease((t - t0) / ev.dur);
      const trail = 0.62;
      for (const side of [0, 1]) {
        const d = side ? ev.R : ev.L, c = side ? ev.cR : ev.cL;
        const head = bez(d.S, d.C, ev.M, e);
        const N = 120;
        for (let j = 0; j < N; j++) {
          const f = j / N;
          const u = e - f * trail * Math.min(1, e / 0.12 + 0.25);
          if (u < 0) continue;
          const p = bez(d.S, d.C, ev.M, u), q = bez(d.S, d.C, ev.M, Math.min(1, u + 0.02));
          let nx = -(q[1] - p[1]), ny = q[0] - p[0];
          const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
          const wob = Math.sin(u * 21 - t * 7 + side * 2) * 0.02 * f + Math.sin(u * 9 + j * 0.9) * 0.006 * f;
          const kk = Math.pow(1 - f, 1.4) * 2.4;
          const cc = c.clone().lerp(new THREE.Color(1, 1, 1), Math.pow(1 - f, 4) * 0.8);
          this.put(p[0] + nx * wob, p[1] + ny * wob, cc, kk, 0.034 * (1.1 - 0.5 * f));
          // fine sparks shed by the stream
          if (j % 3 === 0) {
            const hx = hash(j, side, 5), hy = hash(j, side, 6);
            this.put(p[0] + (hx - 0.5) * 0.07 * (0.2 + f), p[1] + (hy - 0.5) * 0.07 * (0.2 + f), c, 1.4 * (1 - f) * (0.5 + 0.5 * Math.sin(t * 9 + j)), 0.012);
          }
        }
        const rot = t * (side ? -1.3 : 1.3) + side;
        this.star(slot + side, head[0], head[1], 0.12, c.clone().lerp(new THREE.Color(1, 1, 1), 0.45), 2.4, rot);
        this.put(head[0], head[1], c, 1.4, 0.22);
      }
      // the sky brightens a little as they close in
      const near = smoothstep(0.55, 1, e);
      fx.sun = [ev.M[0], ev.M[1], near * 0.35, 0.8];
      return;
    }
    // joined
    const age = tau;
    const flash = Math.exp(-age * 7);
    fx.sun = [ev.M[0], ev.M[1], 0.35 * Math.exp(-age * 3) + 2.2 * flash + 0.25 * S(1 - age / ev.keep), 0.9 + age * 0.4];
    fx.shock = [ev.M[0], ev.M[1], age * 2.6, 1.3 * Math.exp(-age * 2.4)];
    // a ring of sparks and a burst
    const NB = 150;
    for (let j = 0; j < NB; j++) {
      const a = (j / NB) * Math.PI * 2 + hash(j, 1) * 0.3, sp = 0.5 + 1.3 * hash(j, 2);
      const rr = sp * (1 - Math.exp(-age * 2.6)) / 2.6;
      const k = Math.exp(-age * 1.3) * (0.4 + 1.2 * hash(j, 3));
      this.put(ev.M[0] + Math.cos(a) * rr, ev.M[1] + Math.sin(a) * rr * 0.9, ev.cJ, k, 0.009 + 0.01 * hash(j, 4));
    }
    for (let j = 0; j < 60; j++) {
      const a = (j / 60) * Math.PI * 2, rr = age * 2.6;
      this.put(ev.M[0] + Math.cos(a) * rr, ev.M[1] + Math.sin(a) * rr, ev.cJ, 1.3 * Math.exp(-age * 2.4) * (0.6 + 0.4 * hash(j, 7)), 0.02);
    }
    // the merged star: swells, then hangs and fades
    const grow = 1 - Math.pow(1 - clamp(age / 0.35), 3);
    const fade = 1 - smoothstep(ev.keep - 0.5, ev.keep + 0.4, age);
    const big = ev.size ?? 0.11;
    const sz = big * (0.35 + 0.65 * grow) * (1 + 0.8 * flash);
    this.star(slot, ev.M[0], ev.M[1] + 0.012 * age, sz, ev.cJ, (1.6 + 1.4 * flash) * fade, age * 0.35);
    this.put(ev.M[0], ev.M[1] + 0.012 * age, ev.cJ, 1.8 * fade, 0.34 * (0.7 + grow * 0.3));
    this.stars[slot + 1]!.visible = false;
  }

  /** a lone star at a point: the end of drop 3 */
  lone(x: number, y: number, s: number, c: THREE.Color, k: number, t: number, slot = 3) {
    this.star(slot, x, y, s, c, k, t * 0.2);
    this.put(x, y, c, 1.2 * k, 0.3);
  }
}
