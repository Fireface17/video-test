// "Take my hand", close: a handful of people of light (full bodies, lib/people glowBodyMaterial) along a roof
// edge, each moving with their own captured clip; one after another they turn to their neighbour and take
// their hand (eased IK on top of the capture), their light turning gold where the hands meet, and a golden
// thread runs on through the joined hands — then jumps to the next roof.
import * as THREE from 'three';
import { clamp, ease, hash } from '../../engine/util';
import { RealFigure, glowBodyMaterial, type BodyKind } from '../lib/people';
import { applyLayers, type Motion } from '../lib/motion';
import { col } from '../lib/palette';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Threads } from './dawn-gfx';

export interface Spot { pos: THREE.Vector3; yaw: number }

export class LinkGroup extends THREE.Group {
  figs: RealFigure[] = [];
  private off: number[] = [];
  private rate: number[] = [];
  private mir: boolean[] = [];
  private turn: number[] = [];
  private gold = col('gold', 1.25).lerp(col('white', 1.25), 0.2);
  grips: THREE.Vector3[] = [];

  /** `tp(k)`: when the pair (k, k+1) join hands. */
  constructor(gltf: [GLTF, GLTF], public spots: Spot[], public clips: Motion[], seed: number, public tp: (k: number) => number, tints: THREE.Color[]) {
    super();
    spots.forEach((s, i) => {
      const h = (q: number) => hash(i, seed, q);
      const b = h(1) < 0.5 ? 0 : 1, kind: BodyKind = b ? 'michelle' : 'rpm';
      const c = tints[i % tints.length]!.clone();
      const f = new RealFigure(gltf[b]!, kind, c, glowBodyMaterial(c));
      f.scale.setScalar(0.94 + 0.12 * h(2));
      this.figs.push(f);
      this.add(f);
      this.off.push(h(3) * 30);
      this.rate.push(0.85 + 0.25 * h(4));
      this.mir.push(h(5) < 0.5);
      this.turn.push((h(6) - 0.5) * 0.5);
    });
  }

  /** Link weight of pair k at t. */
  w(k: number, t: number) { return ease.inOutCubic(clamp((t - this.tp(k)) / 0.38)); }

  update(t: number, k = 1) {
    const n = this.figs.length;
    // pose everyone from their own clip; they turn a little toward the one they are about to take by the hand
    this.figs.forEach((f, i) => {
      const s = this.spots[i]!, sc = f.scale.x;
      const wl = i > 0 ? this.w(i - 1, t) : 0, wr = i < n - 1 ? this.w(i, t) : 0;
      const yaw = s.yaw + this.turn[i]! * (1 - Math.max(wl, wr)) + 0.25 * (wr - wl) * (1 - Math.min(wl, wr));
      f.position.copy(s.pos).setY(s.pos.y + f.hipHeight * sc);
      f.rotation.set(0, yaw, 0);
      applyLayers(f, [{ m: this.clips[i % this.clips.length]!, t: this.off[i]! + t * this.rate[i]!, loop: true, mirror: this.mir[i], face: true }]);
    });
    // the joined hands: the hands nearest each other meet between their shoulders, a little forward, low
    this.grips.length = 0;
    const plan: { f: RealFigure; i: number; target: THREE.Vector3; w: number }[] = [];
    for (let k2 = 0; k2 < n - 1; k2++) {
      const a = this.figs[k2]!, b = this.figs[k2 + 1]!, w = this.w(k2, t);
      const pa = b.position, pb = a.position;
      const ia = a.hand(0).distanceTo(pa) < a.hand(1).distanceTo(pa) ? 0 : 1;
      const ib = b.hand(0).distanceTo(pb) < b.hand(1).distanceTo(pb) ? 0 : 1;
      const sa = a.spinePoint((ia ? 1 : -1) * 0.19, 0.44, 0), sb = b.spinePoint((ib ? 1 : -1) * 0.19, 0.44, 0);
      const fwd = new THREE.Vector3(Math.sin(this.spots[k2]!.yaw), 0, Math.cos(this.spots[k2]!.yaw));
      const m = sa.clone().lerp(sb, 0.5).add(new THREE.Vector3(0, -0.36, 0)).addScaledVector(fwd, 0.16);
      this.grips.push(m.clone());
      if (w <= 0) continue;
      const dir = sb.clone().sub(sa).normalize();
      plan.push({ f: a, i: ia, target: a.hand(ia).lerp(m.clone().addScaledVector(dir, -0.025), w), w });
      plan.push({ f: b, i: ib, target: b.hand(ib).lerp(m.clone().addScaledVector(dir, 0.025), w), w });
    }
    for (const p of plan) {
      p.f.reach(p.i, p.target, new THREE.Vector3(p.i ? 0.5 : -0.5, -0.75, -0.3));
      p.f.setHand(p.i, 0.2 + 0.35 * p.w);
    }
    // their light: brighter and gold from the moment they join
    this.figs.forEach((f, i) => {
      const wl = i > 0 ? this.w(i - 1, t) : 0, wr = i < n - 1 ? this.w(i, t) : 0, j = Math.max(wl, wr);
      const u = f.mat.uniforms;
      (u.tint!.value as THREE.Color).copy(this.gold);
      u.tintK!.value = 0.75 * j;
      u.level!.value = k * (0.75 + 0.45 * j + 0.6 * Math.exp(-((t - this.tp(Math.max(0, i - 1)) - 0.35) ** 2) / 0.02) * (i > 0 ? 1 : 0));
      f.time = t;
    });
  }

  /** The golden thread through the joined hands (grown pair by pair), from `from` (or the first grip). */
  thread(th: Threads, t: number, k = 1, from?: THREE.Vector3 | null, to?: THREE.Vector3 | null, sagTo = 1.5) {
    const g = this.gold;
    const pts = [...this.grips];
    if (from) {
      const u = clamp((t - this.tp(0) + 0.3) / 0.3);
      if (u > 0) th.sag(from, pts[0]!, 0.6, g, 1.6 * k, 0.025, ease.outCubic(u), 12);
    }
    for (let i = 0; i + 1 < pts.length; i++) {
      const u = clamp((t - this.tp(i + 1)) / 0.2);
      if (u > 0) th.sag(pts[i]!, pts[i + 1]!, 0.08, g, 1.8 * k * (1 + 1.5 * Math.exp(-((t - this.tp(i + 1) - 0.2) ** 2) / 0.01)), 0.018, u, 4);
    }
    if (to) {
      const last = this.tp(this.figs.length - 2) + 0.25;
      const u = clamp((t - last) / 0.45);
      if (u > 0) th.sag(pts[pts.length - 1]!, to, sagTo, g, 1.6 * k, 0.03, ease.outCubic(u), 16);
    }
  }
}
