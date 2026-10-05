// The people of the galaxy (lib/galaxy.ts) as the drops draw them. Every person moves with their own captured
// clip, time offset and mirror (cosmos-motion.ts). The dancers are the galaxy's own; the hand-holding chains
// along the middle of each arm are rebuilt here as individuals: irregular spacing, different sizes, some
// turned or leaning out, a few sitting, each on a standing / swaying / walking clip; their arms are solved
// in joint space (two-bone IK on the 13 star joints) so neighbours' hands meet, low and swinging, or raised
// in a V when a wave passes. Waves raise the dancers' hands too. The nearest people are drawn in full detail,
// people off screen or only a few pixels tall not at all.
import * as THREE from 'three';
import { hash, smoothstep } from '../../engine/util';
import type { Galaxy } from '../lib/galaxy';
import type { Stardust } from '../lib/stardust';
import { frame, place, type Pose } from './cosmos-gfx';
import type { Moves, Mover } from './cosmos-motion';

export interface CrowdLook { chain: THREE.Color; a: THREE.Color; b: THREE.Color; deep: THREE.Color }

/** A gap in a chain between its k-th and (k+1)-th person: held apart by `open` (m), reaching, then holding. */
export interface ChainGap { arm: number; k: number; open: number; reach: number; hold: number }

export interface CrowdDraw {
  /** Clock for the motion (song seconds; pass a slowed clock to slow everyone down). */
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
  /** Skip person i. */
  hide?: (i: number) => boolean;
  gap?: ChainGap;
  /** 0..1: the people assemble from stars flying in (lib/stardust `draw`). */
  draw?: number;
  /** 0..1: a stronger outline on everyone (lib/stardust `edge`). */
  edge?: number;
  /** Collapse toward the centre: positions and sizes × scale, turned by `twist` (rad). */
  scale?: number;
  twist?: number;
}

export interface Person {
  p: THREE.Vector3; up: THREE.Vector3; s: number;
  chain: boolean; arm: number; lk: number;
  /** Chain neighbours (indices into `people`), −1 at the ends; the outward tangent of the chain here. */
  prev: number; next: number; tan: THREE.Vector3;
  body: number; mover: Mover; yaw: number; roll: number; col: number; seed: number;
  /** Their hands: how low they hold them (m below the shoulders) and how far up they raise them in a wave. */
  low: number; high: number;
}

const FRONT = new THREE.Vector3(0, 1, 0);
const V = () => new THREE.Vector3();
const _p = V(), _q = new THREE.Quaternion(), _qy = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _s = new THREE.Sphere();
const _a = V(), _b = V(), _c = V(), _d = V(), _e = V(), _f = V(), _g = V(), _h = V(), _m = V(), _n = V(), _up = V();
const SH = [2, 3], EL = [4, 5], HA = [6, 7]; // star-joint indices of the left / right arm
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);

/** Two-bone IK in joint space: shoulder S, lengths L1 L2, hand target T, elbow toward `pole`; writes E and H. */
export function ik(S: THREE.Vector3, L1: number, L2: number, T: THREE.Vector3, pole: THREE.Vector3, E: THREE.Vector3, H: THREE.Vector3) {
  const D = _d.subVectors(T, S);
  let dl = D.length();
  if (dl < 1e-5) { D.copy(pole); dl = 1e-5; }
  D.divideScalar(dl);
  const d = Math.min(Math.max(dl, Math.abs(L1 - L2) + 0.02), (L1 + L2) * 0.999);
  const ca = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), a = Math.acos(Math.min(1, Math.max(-1, ca)));
  const n = _n.copy(pole).addScaledVector(D, -pole.dot(D));
  if (n.lengthSq() < 1e-8) n.crossVectors(D, Math.abs(D.x) < 0.9 ? _X : _Y);
  n.normalize();
  E.copy(S).addScaledVector(D, Math.cos(a) * L1).addScaledVector(n, Math.sin(a) * L1);
  H.copy(S).addScaledVector(D, d);
}

export class Crowd {
  people: Person[] = [];
  /** Per arm: chain people's indices in order (outward). */
  chains: number[][] = [];
  private r0: number[] = [];
  private dr: number[] = [];
  private frustum = new THREE.Frustum();
  private m4 = new THREE.Matrix4();
  private order: number[] = [];
  private dist: Float32Array;
  private wpos: Float32Array;
  /** World joints of this frame (39 per person) and the frame they were made in. */
  private jw: Float32Array;
  private stamp: Int32Array;
  private frameNo = 0;
  private wv: Float32Array;
  private pose: Pose = new Float32Array(39);
  private js: THREE.Vector3[] = [];
  private o: CrowdDraw = { t: 0 };
  private partner: Int32Array;
  private reachPh: Float32Array;
  look: CrowdLook;

  /**
   * `clips`: the dancers' clips (names in `moves`) with weights; `chainClips`: the chain's (standing, swaying,
   * walking hand in hand), `sitClips` for the few who sit.
   */
  constructor(public gal: Galaxy, public moves: Moves, seed: number, clips: [string, number][], chainClips: [string, number][], sitClips: string[], look: CrowdLook, extra = 450) {
    this.look = look;
    const pick = (list: [string, number][], x: number) => {
      const total = list.reduce((a, [, w]) => a + w, 0);
      let y = x * total;
      for (const [c, w] of list) { if (y < w) return c; y -= w; }
      return list[0]![0];
    };
    // the chains: along the middle of every arm, hand in hand, not quite evenly
    const sp = Math.sin(gal.pitch);
    for (let a = 0; a < gal.arms; a++) {
      const ch: number[] = [];
      let r = 10, k = 0;
      while (r < gal.R * 0.95) {
        const h = (q: number) => hash(a * 1000 + k, seed, q);
        const { p, n, t } = gal.armPoint(a, r, (h(1) - 0.5) * 0.35);
        p.y += (h(2) - 0.5) * 0.4;
        const up = n.clone().applyAxisAngle(FRONT, (h(3) - 0.5) * 0.12);
        const sits = h(4) < 0.035;
        const child = h(5) < 0.05;
        const s = child ? 0.74 + 0.08 * h(6) : 0.92 + 0.14 * h(6);
        const clip = sits ? sitClips[Math.floor(h(7) * sitClips.length)]! : pick(chainClips, h(7));
        const look = h(8);
        const i = this.people.length;
        this.people.push({
          p, up, s, chain: true, arm: a, lk: k, prev: ch.length ? ch[ch.length - 1]! : -1, next: -1, tan: t.clone(),
          body: h(9) < 0.5 ? 0 : 1, mover: { clip: Math.max(0, moves.index(clip)), body: 0, off: h(10) * 40, rate: 0.85 + 0.25 * h(11), mirror: h(12) < 0.5 },
          // most face out of the disk, some turn to a neighbour or look back over a shoulder; a few lean out
          yaw: look < 0.78 ? (h(13) - 0.5) * 0.55 : (h(13) < 0.5 ? -1 : 1) * (0.55 + 0.4 * h(14)),
          roll: h(15) < 0.1 ? (h(16) - 0.5) * 0.7 : (h(16) - 0.5) * 0.12,
          col: 0, seed: h(17) * 10, low: 0.3 + 0.2 * h(18), high: 0.28 + 0.2 * h(19),
        });
        this.people[i]!.mover.body = this.people[i]!.body;
        if (ch.length) this.people[ch[ch.length - 1]!]!.next = i;
        ch.push(i);
        r += (0.88 + 0.3 * h(20)) * sp;
        k++;
      }
      this.chains.push(ch);
      const rr = (i: number) => Math.hypot(this.people[i]!.p.x, this.people[i]!.p.z);
      this.r0.push(rr(ch[0]!));
      this.dr.push((rr(ch[ch.length - 1]!) - rr(ch[0]!)) / Math.max(1, ch.length - 1));
    }
    // the dancers: the galaxy's own, each with their own clip
    let di = 0;
    gal.people.forEach((P, gi) => {
      if (P.chain) return;
      const h = (q: number) => hash(gi, seed, q);
      const a = di++ % gal.arms;
      this.people.push({
        p: P.p.clone(), up: P.up.clone(), s: P.s * (0.92 + 0.16 * h(1)), chain: false, arm: a, lk: this.lkAt(a, Math.hypot(P.p.x, P.p.z)),
        prev: -1, next: -1, tan: new THREE.Vector3(),
        body: P.body, mover: { clip: Math.max(0, moves.index(pick(clips, h(4)))), body: P.body, off: h(5) * 30, rate: 0.9 + 0.2 * h(6), mirror: h(7) < 0.5 },
        yaw: (h(11) - 0.5) * 1.5, roll: (h(12) - 0.5) * 0.2, col: h(10) < 0.55 ? 1 : 2, seed: h(9) * 10, low: 0, high: 0.4 + 0.15 * h(13),
      });
    });
    // and more of them close round the chains, so the arms are crowded with people up close
    const gauss = (q: number, x: number) => (hash(x, seed, q) + hash(x, seed, q + 1) + hash(x, seed, q + 2) + hash(x, seed, q + 3) - 2) / 0.577;
    for (let i = 0; i < extra; i++) {
      const h = (q: number) => hash(i, seed + 77, q);
      const a = i % gal.arms, r = 10 + Math.sqrt(h(1)) * (gal.R * 0.95 - 10);
      const { p, n } = gal.armPoint(a, r, (1.2 + 0.03 * r) * gauss(10, i));
      // (floating in a thicker layer than the disk's own dancers: people in front of and behind each other)
      p.y += gauss(20, i) * 0.9;
      const up = n.clone().add(new THREE.Vector3(h(2) - 0.5, h(3) - 0.5, h(4) - 0.5).multiplyScalar(0.8)).normalize();
      const body = h(5) < 0.5 ? 0 : 1;
      this.people.push({
        p, up, s: 0.88 + 0.22 * h(6), chain: false, arm: a, lk: this.lkAt(a, r), prev: -1, next: -1, tan: new THREE.Vector3(),
        body, mover: { clip: Math.max(0, moves.index(pick(clips, h(7)))), body, off: h(8) * 30, rate: 0.9 + 0.2 * h(9), mirror: h(11) < 0.5 },
        yaw: (h(12) - 0.5) * 1.6, roll: (h(13) - 0.5) * 0.25, col: h(14) < 0.55 ? 1 : 2, seed: h(15) * 10, low: 0, high: 0.4 + 0.15 * h(16),
      });
    }
    const N = this.people.length;
    // a few dancers reach out to their nearest neighbour now and then (pairs, each with its own rhythm)
    this.partner = new Int32Array(N).fill(-1);
    this.reachPh = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const P = this.people[i]!;
      if (P.chain || this.partner[i]! >= 0 || hash(i, seed, 31) > 0.16) continue;
      let best = -1, bd = 2.6 * 2.6;
      for (let j = 0; j < N; j++) {
        if (j === i || this.people[j]!.chain || this.partner[j]! >= 0) continue;
        const d = this.people[j]!.p.distanceToSquared(P.p);
        if (d < bd) { bd = d; best = j; }
      }
      if (best < 0) continue;
      this.partner[i] = best; this.partner[best] = i;
      this.reachPh[i] = this.reachPh[best] = hash(i, seed, 32) * 9;
    }
    this.dist = new Float32Array(N);
    this.wpos = new Float32Array(N * 3);
    this.jw = new Float32Array(N * 39);
    this.stamp = new Int32Array(N).fill(-1);
    this.wv = new Float32Array(N);
  }

  /** Link coordinate of a radius on arm `a`. */
  lkAt(a: number, r: number) { return (r - this.r0[a]!) / this.dr[a]!; }

  /** Scale about the centre and turn by `twist` (the same as the galaxy group's rotation.y = −twist). */
  private collapse(p: THREE.Vector3, scale: number, twist: number) {
    const c = Math.cos(twist), s = Math.sin(twist);
    const x = p.x * c - p.z * s, z = p.x * s + p.z * c;
    p.set(x * scale, p.y * scale, z * scale);
  }

  /** Where person i is this frame (collapse, the gap held open, the chain's slow swell). */
  posOf(i: number, out = new THREE.Vector3()) {
    const P = this.people[i]!, o = this.o;
    out.copy(P.p);
    const gp = o.gap;
    if (gp && P.chain && P.arm === gp.arm && gp.open > 0) {
      const d = P.lk - (gp.k + 0.5);
      out.addScaledVector(P.tan, Math.sign(d) * gp.open * Math.exp(-(Math.abs(d) - 0.5) / 10));
    }
    if (P.chain) out.addScaledVector(P.up, 0.05 * Math.sin(o.t * 1.1 - P.lk * 0.21 + P.arm));
    const sc = o.scale ?? 1, tw = o.twist ?? 0;
    if (sc !== 1 || tw) this.collapse(out, sc, tw);
    return out;
  }

  /** Person i's world joints this frame (the captured motion, placed): the ONE place their pose comes from. */
  private base(i: number): Float32Array {
    const o3 = i * 39;
    if (this.stamp[i] === this.frameNo) return this.jw;
    const P = this.people[i]!, o = this.o, sc = o.scale ?? 1, tw = o.twist ?? 0;
    const pose = this.moves.pose(P.mover, o.t, this.pose);
    if (P.chain) {
      // (hand in hand, nobody turns their back: the shoulders face out of the disk within ±20°)
      const fx = -(pose[2 * 3 + 2]! - pose[3 * 3 + 2]!), fz = pose[2 * 3]! - pose[3 * 3]!;
      const hd = Math.atan2(fx, fz), corr = hd - Math.max(-0.35, Math.min(0.35, hd));
      if (Math.abs(corr) > 1e-4) {
        const c = Math.cos(-corr), s = Math.sin(-corr), px = pose[24]!, pz = pose[26]!;
        for (let k = 0; k < 13; k++) {
          const x = pose[k * 3]! - px, z = pose[k * 3 + 2]! - pz;
          pose[k * 3] = px + x * c + z * s; pose[k * 3 + 2] = pz - x * s + z * c;
        }
      }
    }
    const p = this.posOf(i, _p);
    _up.copy(P.up);
    if (tw) _up.applyAxisAngle(FRONT, -tw);
    frame(_up, FRONT, _q);
    if (P.yaw) _q.multiply(_qy.setFromAxisAngle(FRONT, P.yaw));
    if (P.roll) _q.multiply(_qr.setFromAxisAngle(_e.set(0, 0, 1), P.roll));
    const j = place(pose, p, _q, P.s * sc, P.mover.mirror, this.js);
    for (let k = 0; k < 13; k++) { this.jw[o3 + k * 3] = j[k]!.x; this.jw[o3 + k * 3 + 1] = j[k]!.y; this.jw[o3 + k * 3 + 2] = j[k]!.z; }
    this.stamp[i] = this.frameNo;
    return this.jw;
  }

  private J(i: number, k: number, out: THREE.Vector3) { this.base(i); return out.fromArray(this.jw, i * 39 + k * 3); }

  /** Which of person i's arms (0 left, 1 right) is on the side of point q. */
  private side(i: number, q: THREE.Vector3) {
    const l = this.J(i, 2, _a), r = this.J(i, 3, _b);
    return _c.subVectors(l, r).dot(_e.subVectors(q, r.lerp(l, 0.5))) > 0 ? 0 : 1;
  }

  /**
   * Solve the arm of chain person i toward neighbour j: the two hands meet between their shoulders, low and
   * swinging, or raised in a V by the wave (w); in a gap not yet held they reach for each other.
   */
  private armTo(i: number, j: number) {
    const P = this.people[i]!, Q = this.people[j]!;
    const pj = this.J(j, 8, _f);
    const si = this.side(i, pj), sj = this.side(j, this.J(i, 8, _g));
    const S = this.J(i, SH[si]!, V()), E0 = this.J(i, EL[si]!, V()), H0 = this.J(i, HA[si]!, V());
    const Sj = this.J(j, SH[sj]!, V());
    const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0), Lj = this.J(j, SH[sj]!, _g).distanceTo(this.J(j, EL[sj]!, _h)) + _h.distanceTo(this.J(j, HA[sj]!, _a));
    const L = Math.min(L1 + L2, Lj) * 0.96, sc = this.o.scale ?? 1;
    const lo = i < j ? i : j, PQ = this.people[lo]!;
    const upm = _m.addVectors(P.up, Q.up).normalize();
    const mid = _c.addVectors(S, Sj).multiplyScalar(0.5);
    const half = S.distanceTo(Sj) / 2, fwd = 0.1 * sc;
    const w = Math.max(this.wv[i]!, this.wv[j]!), e = w * w * (3 - 2 * w);
    const swing = 0.07 * sc * Math.sin(this.o.t * 1.6 + PQ.seed * 3) * (1 - e);
    let hang = (-(PQ.low * sc) + swing) * (1 - e) + PQ.high * sc * 1.1 * e;
    const room = Math.sqrt(Math.max(0, L * L - half * half - fwd * fwd));
    hang = Math.max(-room, Math.min(room, hang));
    const T = mid.clone().addScaledVector(upm, hang).addScaledVector(FRONT, fwd);
    // (the two hands side by side, not in one place)
    T.addScaledVector(_e.subVectors(S, Sj).normalize(), 0.025 * sc);
    let reach = 1;
    const g = this.o.gap;
    if (g && P.arm === g.arm && Math.min(P.lk, Q.lk) === g.k && g.hold < 0.5) {
      reach = g.reach;
      if (reach <= 0.001) return;
      // reaching across the gap: straight out toward the other's hand, a little above the hip
      T.copy(mid).addScaledVector(upm, -0.12 * sc).addScaledVector(FRONT, 0.15 * sc);
      T.lerpVectors(H0, T, reach);
    }
    const away = _e.subVectors(S, mid).normalize();
    const pole = _h.copy(away).multiplyScalar(0.55).addScaledVector(upm, -0.6 + 0.9 * e).addScaledVector(FRONT, -0.35);
    const E = V(), H = V();
    ik(S, L1, L2, T, pole, E, H);
    const o3 = i * 39;
    E.toArray(this.jw, o3 + EL[si]! * 3);
    H.toArray(this.jw, o3 + HA[si]! * 3);
  }

  /** A dancer's hands raised by the wave (w 0..1), blended over their own motion. */
  private raise(i: number, w: number) {
    const P = this.people[i]!, sc = this.o.scale ?? 1, e = w * w * (3 - 2 * w);
    const l = this.J(i, 2, V()), r = this.J(i, 3, V());
    const side = _f.subVectors(l, r).normalize();
    for (const s of [0, 1]) {
      const S = s ? r : l, E0 = this.J(i, EL[s]!, V()), H0 = this.J(i, HA[s]!, V());
      const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0);
      const T = S.clone().addScaledVector(P.up, P.high * sc * 1.25).addScaledVector(side, (s ? -1 : 1) * 0.22 * sc).addScaledVector(FRONT, 0.1 * sc);
      const pole = _h.copy(side).multiplyScalar(s ? -0.7 : 0.7).addScaledVector(FRONT, -0.3);
      const E = V(), H = V();
      ik(S, L1, L2, T, pole, E, H);
      E0.lerp(E, e).toArray(this.jw, i * 39 + EL[s]! * 3);
      H0.lerp(H, e).toArray(this.jw, i * 39 + HA[s]! * 3);
    }
  }

  /** How far a reaching pair reach for each other at t (0..1): out, a moment hand in hand, back (a 9 s cycle). */
  private reachW(i: number, t: number) {
    const u = (((t + this.reachPh[i]!) / 9) % 1 + 1) % 1;
    return smoothstep(0.08, 0.28, u) * (1 - smoothstep(0.5, 0.7, u));
  }

  /** Dancer i reaches the hand nearer j toward the point between their shoulders (j does the same). */
  private reach(i: number, j: number, w: number) {
    const sc = this.o.scale ?? 1, e = w * w * (3 - 2 * w);
    this.base(j);
    const pj = this.J(j, 1, _g), pi = this.J(i, 1, _h);
    const si = this.side(i, pj), sj = this.side(j, pi);
    const S = this.J(i, SH[si]!, V()), Sj = this.J(j, SH[sj]!, V());
    if (S.distanceTo(Sj) > 2.4 * sc) return;
    const E0 = this.J(i, EL[si]!, V()), H0 = this.J(i, HA[si]!, V());
    const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0);
    const T = S.clone().lerp(Sj, 0.5).addScaledVector(this.people[i]!.up, -0.08 * sc).addScaledVector(_e.subVectors(S, Sj).normalize(), 0.03 * sc);
    const pole = _a.subVectors(S, Sj).normalize().multiplyScalar(0.4).addScaledVector(this.people[i]!.up, -0.7);
    const E = V(), H = V();
    ik(S, L1, L2, T, pole, E, H);
    E0.lerp(E, e).toArray(this.jw, i * 39 + EL[si]! * 3);
    H0.lerp(H, e).toArray(this.jw, i * 39 + HA[si]! * 3);
  }

  /** Person i's own joints (their motion, placed; no hand-holding) at time t, outside a draw. */
  peek(i: number, t: number, out: THREE.Vector3[] = []): THREE.Vector3[] {
    const o = this.o;
    this.o = { t };
    this.frameNo++;
    this.base(i);
    const j = this.joints(i, out)!;
    this.o = o;
    return j;
  }

  /** The joints person i was drawn with this frame (after `draw`), or null. */
  joints(i: number, out: THREE.Vector3[] = []): THREE.Vector3[] | null {
    if (this.stamp[i] !== this.frameNo) return null;
    for (let k = 0; k < 13; k++) (out[k] ??= V()).fromArray(this.jw, i * 39 + k * 3);
    return out;
  }

  colorOf(i: number) { const c = this.people[i]!.col; return c === 0 ? this.look.chain : c === 1 ? this.look.a : this.look.b; }

  /** Draw the people (call between D.begin and D.end; the camera's matrices must be current). */
  draw(D: Stardust, cam: THREE.PerspectiveCamera, o: CrowdDraw) {
    this.o = o;
    this.frameNo++;
    const ppl = this.people, N = ppl.length;
    const k0 = o.k ?? 1, sc = o.scale ?? 1;
    if (sc < 0.02 || k0 <= 0.002) return;
    cam.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const cp = cam.position, order = this.order;
    order.length = 0;
    for (let i = 0; i < N; i++) {
      if (o.hide?.(i)) continue;
      const P = ppl[i]!;
      const p = this.posOf(i, _p);
      if (o.near && p.distanceToSquared(o.near) > (o.range ?? 60) ** 2) continue;
      if (!this.frustum.intersectsSphere(_s.set(p, 1.3 * P.s * sc))) continue;
      this.dist[i] = p.distanceToSquared(cp);
      this.wpos.set([p.x, p.y, p.z], i * 3);
      order.push(i);
    }
    order.sort((a, b) => this.dist[a]! - this.dist[b]!);
    const L = this.look, ph = cam.projectionMatrix.elements[5]! * 540;
    for (const i of order) this.wv[i] = o.wave ? o.wave(ppl[i]!.arm, ppl[i]!.lk) : 0;
    for (const i of order) {
      const P = ppl[i]!;
      const d = Math.sqrt(this.dist[i]!);
      // (a body at the lens would fill the frame; one a few pixels tall is just one of the galaxy's stars)
      const px = (1.75 * P.s * sc * ph) / Math.max(d, 1e-3);
      const near = smoothstep(1.0 * sc, 3.2 * sc, d) * smoothstep(2, 4.5, px);
      if (near <= 0.003) continue;
      this.base(i);
      const w = this.wv[i]!;
      if (P.chain) {
        // (a neighbour off screen still holds the hand: give them their wave too)
        for (const j of [P.prev, P.next]) if (j >= 0 && this.stamp[j] !== this.frameNo) this.wv[j] = o.wave ? o.wave(ppl[j]!.arm, ppl[j]!.lk) : 0;
        if (P.next >= 0) this.armTo(i, P.next);
        if (P.prev >= 0) this.armTo(i, P.prev);
      } else {
        if (w > 0.003) this.raise(i, w);
        const pj = this.partner[i]!;
        if (pj >= 0 && w < 0.6) {
          const rw = this.reachW(i, o.t) * (1 - w / 0.6);
          if (rw > 0.003) this.reach(i, pj, rw);
        }
      }
      const j = this.joints(i, this.js)!;
      const lit = o.light ? o.light(P.arm, P.lk, _p.fromArray(this.wpos, i * 3)) : 1;
      // (further away, dimmer: depth, and a chain seen along its length doesn't pile up into a white wall)
      const fog = 0.22 + 0.78 * Math.exp(-d / (18 * sc));
      const k = k0 * near * lit * fog * (P.chain ? 1.0 + 0.45 * w : 0.85 + 0.35 * w);
      D.figure(j, P.body, this.colorOf(i), k, { color2: L.deep, seed: P.seed, draw: o.draw ?? 1, edge: o.edge });
    }
  }

  /**
   * The galaxy's own light (disk glow, core, nebula knots) for this camera; `core` scales the core's glow. Inside
   * the disk its smooth glow would only fog the view, and near the core its glow would wash out the people.
   */
  sky(cam: THREE.Camera, core = 1, disk = 1) {
    const g = this.gal;
    const h = Math.abs(cam.position.y) + Math.max(0, cam.position.length() - g.R * 1.1);
    const v = THREE.MathUtils.smoothstep(h, 4, 45);
    const far = THREE.MathUtils.smoothstep(cam.position.length(), 20, 230);
    (g.disk.material as THREE.ShaderMaterial).uniforms.gain!.value = (0.05 + 0.95 * v) * (0.45 + 0.55 * far) * disk;
    for (const s of g.knots) s.material.opacity = (0.2 + 0.8 * v) * Math.min(1, disk * 1.5);
    g.cores.forEach((s, i) => {
      s.material.opacity = Math.min(1, (0.35 + 0.65 * v) * (0.3 + 0.7 * far) * core);
      s.scale.setScalar(g.R * [0.55, 0.22, 0.07][i]! * (0.85 + 0.15 * core));
    });
  }
}
