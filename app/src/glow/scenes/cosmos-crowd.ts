// The people of the galaxy (lib/galaxy.ts) as the drops draw them: every person moves with their own clip
// and offset (cosmos-motion.ts); along the middle of each arm they hold hands in a chain whose raised hands
// can run along it in waves; the nearest people are drawn in full detail, people off screen not at all.
import * as THREE from 'three';
import { hash, smoothstep } from '../../engine/util';
import type { Galaxy, GalaxyPerson } from '../lib/galaxy';
import type { Stardust } from '../lib/stardust';
import { frame, place, type Pose } from './cosmos-gfx';
import { CLIP, Motion, blendPose, clipBeats, type Mover } from './cosmos-motion';

export interface CrowdLook { chain: THREE.Color; a: THREE.Color; b: THREE.Color; deep: THREE.Color }

export interface CrowdDraw {
  /** Beat clock for the motion (continuous). */
  beat: number;
  /** Song time (the chain's slow sway). */
  t: number;
  /** Overall brightness. */
  k?: number;
  /** Only people within `range` of `near` (world). */
  near?: THREE.Vector3;
  range?: number;
  /** Raised hands 0..1 for a person of arm `arm` at link coordinate `lk` (chain index; dancers by radius). */
  wave?: (arm: number, lk: number) => number;
  /** Brightness multiplier per person (kick rings, flashes). */
  light?: (arm: number, lk: number, p: THREE.Vector3) => number;
  /** Skip person i (drawn by the scene itself). */
  hide?: (i: number) => boolean;
  /** Move person i (world position `p`, in place). */
  shift?: (i: number, P: GalaxyPerson, p: THREE.Vector3) => void;
  /** Collapse toward the centre: positions and sizes × scale, turned by `twist` (rad) more the closer in. */
  scale?: number;
  twist?: number;
  /** How hard the dancers dance (0 = standing still in their clip's first pose... kept for slow-downs). */
  energy?: number;
}

const _p = new THREE.Vector3(), _up = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Sphere();
const FRONT = new THREE.Vector3(0, 1, 0);

export class Crowd {
  movers: Mover[] = [];
  hands: Mover[] = [];
  arm: Int16Array;
  lk: Float32Array;
  cols: number[];
  seeds: Float32Array;
  /** Per arm: chain people's indices in link order. */
  chains: number[][] = [];
  /** Link coordinate per unit radius (dancers) — r0 and dr per arm. */
  private r0: number[] = [];
  private dr: number[] = [];
  private pa: Pose = new Float32Array(39);
  private pb: Pose = new Float32Array(39);
  private pc: Pose = new Float32Array(39);
  private js: THREE.Vector3[] = [];
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private order: number[] = [];
  private dist: Float32Array;
  private wpos: Float32Array;
  look: CrowdLook;

  /** `clips`: the dancers' clips with weights; `bouncy` clips keep their offsets near whole beats. */
  constructor(public gal: Galaxy, public motion: Motion, seed: number, clips: [string, number][], look: CrowdLook) {
    this.look = look;
    const N = gal.people.length;
    this.arm = new Int16Array(N);
    this.lk = new Float32Array(N);
    this.cols = new Array(N).fill(0);
    this.seeds = new Float32Array(N);
    this.dist = new Float32Array(N);
    this.wpos = new Float32Array(N * 3);
    let arm = -1;
    gal.people.forEach((P, i) => {
      if (P.chain) {
        if (P.link === 0) { arm++; this.chains.push([]); }
        this.chains[arm]!.push(i);
        this.arm[i] = arm;
        this.lk[i] = P.link;
      }
    });
    for (const ch of this.chains) {
      const r = (i: number) => Math.hypot(gal.people[i]!.p.x, gal.people[i]!.p.z);
      this.r0.push(r(ch[0]!));
      this.dr.push((r(ch[ch.length - 1]!) - r(ch[0]!)) / Math.max(1, ch.length - 1));
    }
    const total = clips.reduce((a, [, w]) => a + w, 0);
    let di = 0;
    gal.people.forEach((P, i) => {
      const h = (k: number) => hash(i, seed, k);
      this.seeds[i] = h(9) * 10;
      if (P.chain) {
        this.movers.push({ clip: CLIP.sway!, body: P.body, off: h(1) * 8, mirror: h(2) < 0.5 });
        this.hands.push({ clip: CLIP.handsup!, body: P.body, off: h(3) * 4, mirror: false });
        this.cols[i] = 0;
        return;
      }
      const a = di++ % gal.arms;
      this.arm[i] = a;
      this.lk[i] = (Math.hypot(P.p.x, P.p.z) - this.r0[a]!) / this.dr[a]!;
      let x = h(4) * total, clip = clips[0]![0];
      for (const [c, w] of clips) { if (x < w) { clip = c; break; } x -= w; }
      const id = CLIP[clip]!, nb = clipBeats(id);
      // the bouncy clips stay near the grid (a whole number of beats plus a little); slow ones anywhere
      const off = nb <= 4 ? Math.floor(h(5) * nb) + (h(6) - 0.5) * 0.24 : h(5) * nb;
      this.movers.push({ clip: id, body: P.body, off, mirror: h(7) < 0.5 });
      this.hands.push({ clip: CLIP.handsup!, body: P.body, off: Math.floor(h(8) * 4) + (h(6) - 0.5) * 0.3, mirror: false });
      this.cols[i] = h(10) < 0.55 ? 1 : 2;
    });
  }

  /** World position of person i at the current draw's collapse (before any shift). */
  posOf(i: number, out = new THREE.Vector3(), scale = 1, twist = 0) {
    const P = this.gal.people[i]!;
    out.copy(P.p);
    if (scale !== 1 || twist) this.collapse(out, scale, twist);
    return out;
  }

  private collapse(p: THREE.Vector3, scale: number, twist: number) {
    const r = Math.hypot(p.x, p.z);
    const a = twist * (1 - smoothstep(0, this.gal.R, r) * 0.6);
    const c = Math.cos(a), s = Math.sin(a);
    const x = p.x * c - p.z * s, z = p.x * s + p.z * c;
    p.set(x * scale, p.y * scale, z * scale);
  }

  /** Link coordinate of a radius on arm `a`. */
  lkAt(a: number, r: number) { return (r - this.r0[a]!) / this.dr[a]!; }

  /**
   * The joints of person i (figure frame) at beat `beat` with raised hands `w`: the ONE place a galaxy person's
   * pose comes from.
   */
  poseOf(i: number, beat: number, w: number): Pose {
    const P = this.gal.people[i]!;
    if (P.chain) {
      // the chain pose between its cached steps (so a slow wave rises smoothly)
      const x = Math.min(1, Math.max(0, w)) * 16, i0 = Math.floor(x), f = x - i0;
      const a = this.gal.chainPose(P.body, i0 / 16);
      if (f < 1e-3) return a;
      const b = this.gal.chainPose(P.body, Math.min(16, i0 + 1) / 16);
      return blendPose(a, b, f, this.pc);
    }
    const a = this.motion.pose(this.movers[i]!, beat, this.pa);
    if (w <= 0.002) return a;
    const b = this.motion.pose(this.hands[i]!, beat, this.pb);
    return blendPose(a, b, 0.9 * w, this.pc);
  }

  colorOf(i: number) { const c = this.cols[i]!; return c === 0 ? this.look.chain : c === 1 ? this.look.a : this.look.b; }

  /** Draw the people (call between D.begin and D.end; the camera's matrices must be current). */
  draw(D: Stardust, cam: THREE.PerspectiveCamera, o: CrowdDraw) {
    const g = this.gal, ppl = g.people, N = ppl.length;
    const k0 = o.k ?? 1, sc = o.scale ?? 1, tw = o.twist ?? 0;
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const cp = cam.position, order = this.order;
    order.length = 0;
    for (let i = 0; i < N; i++) {
      if (o.hide?.(i)) continue;
      const P = ppl[i]!;
      const p = _p.copy(P.p);
      if (sc !== 1 || tw) this.collapse(p, sc, tw);
      o.shift?.(i, P, p);
      if (o.near && p.distanceToSquared(o.near) > (o.range ?? 60) ** 2) continue;
      if (!this.frustum.intersectsSphere(_s.set(p, 1.3 * P.s * sc))) continue;
      this.dist[i] = p.distanceToSquared(cp);
      this.wpos.set([p.x, p.y, p.z], i * 3);
      order.push(i);
    }
    order.sort((a, b) => this.dist[a]! - this.dist[b]!);
    const L = this.look;
    for (const i of order) {
      const P = ppl[i]!, a = this.arm[i]!, lk = this.lk[i]!;
      const p = _p.fromArray(this.wpos, i * 3);
      const d = Math.sqrt(this.dist[i]!);
      const near = smoothstep(1.0 * sc, 3.2 * sc, d); // (a body at the lens would fill the frame)
      if (near <= 0.003) continue;
      const w = o.wave ? o.wave(a, lk) : 0;
      const pose = this.poseOf(i, o.beat, w);
      // the chain sways a little, a slow swell running along it (neighbours stay hand in hand)
      _up.copy(P.up);
      if (P.chain) {
        const sw = 0.05 * Math.sin(o.t * 1.3 - lk * 0.33 + a * 2);
        _up.applyAxisAngle(FRONT, sw);
        p.addScaledVector(P.up, 0.06 * Math.sin(o.t * 1.1 - lk * 0.21 + a));
      }
      if (tw) _up.applyAxisAngle(FRONT, tw * (1 - smoothstep(0, g.R, Math.hypot(P.p.x, P.p.z)) * 0.6));
      frame(_up, FRONT, _q);
      const j = place(pose, p, _q, P.s * sc, this.movers[i]!.mirror && !P.chain, this.js);
      const lit = o.light ? o.light(a, lk, p) : 1;
      const k = k0 * near * lit * (P.chain ? 1.0 + 0.55 * w : 0.78 + 0.3 * w);
      D.figure(j, P.body, this.colorOf(i), k, { color2: L.deep, seed: this.seeds[i]! });
    }
  }

  /** The galaxy's own light (disk glow, core, nebula knots) for this camera; `core` scales the core's glow. */
  sky(cam: THREE.Camera, core = 1, disk = 1) {
    const g = this.gal;
    const h = Math.abs(cam.position.y) + Math.max(0, cam.position.length() - g.R * 1.1);
    const v = THREE.MathUtils.smoothstep(h, 4, 45);
    (g.disk.material as THREE.ShaderMaterial).uniforms.gain!.value = (0.08 + 0.92 * v) * disk;
    for (const s of g.knots) s.material.opacity = 0.25 + 0.75 * v;
    g.cores.forEach((s, i) => {
      s.material.opacity = Math.min(1, (0.35 + 0.65 * v) * core);
      s.scale.setScalar(g.R * [0.55, 0.22, 0.07][i]! * (0.85 + 0.15 * core));
    });
  }
}
