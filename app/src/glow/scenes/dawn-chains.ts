// "Take my hand" at dawn: the whole city takes hands. People of light stand along the roof edges of every block
// (out to watch the sunrise) and across the street below; from the two of them a wave runs out over the city and,
// as it reaches each person, they take their neighbours' hands — one after another along each roof edge — and a
// golden thread runs through the joined hands, steps from roof to roof and spans the streets.
//
// Every person moves with their own captured clip, offset, rate and mirror (lib/motion JointTables, `face` so
// their yaw is where they look); joined hands are eased in with two-bone IK on the 13 star joints. People near
// the camera are drawn as stardust (lib/stardust), the thousands further away as single points of light.
import * as THREE from 'three';
import { clamp, ease, hash, smoothstep } from '../../engine/util';
import { RealFigure, loadBody } from '../lib/people';
import { col } from '../lib/palette';
import { loadMotion, type JointTable } from '../lib/motion';
import { F, faceNormal } from '../lib/city-plan';
import type { Stardust } from '../lib/stardust';
import type { GlowPoints } from '../lib/points';
import { CITY_OFF } from './rooftop-set';
import type { RoofWorld } from './rooftop-world';
import { tint } from './rooftop-people';
import { ik } from './cosmos-crowd';
import type { Threads } from './dawn-gfx';

export interface CityPerson {
  pos: THREE.Vector3; yaw: number; s: number; body: 0 | 1; mirror: boolean;
  clip: number; off: number; rate: number; color: THREE.Color; seed: number;
  chain: number; k: number;
  /** When they take their neighbours' hands; when their raised hands go up (the climax). */
  tl: number; tu: number;
  /** Facing (unit, horizontal) and up of the chain. */
  face: THREE.Vector3;
}
export interface Chain { people: number[]; dir: THREE.Vector3; ground: boolean }
/** A thread between two people of different chains (roof to roof, across a street). */
export interface Bridge { a: number; b: number; sag: number; t: number }

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export class CityChains {
  people: CityPerson[] = [];
  chains: Chain[] = [];
  bridges: Bridge[] = [];
  private tables: JointTable[][][] = []; // [clip][body][mirror]
  private hip = [1, 1];
  private jw: Float32Array;
  private stamp: Int32Array;
  private frame = 0;
  private js: THREE.Vector3[] = [];
  private pose = new Float32Array(39);
  private q = new THREE.Quaternion();
  private gold = col('gold', 1.25).lerp(col('white', 1.25), 0.25);

  private constructor() { this.jw = new Float32Array(0); this.stamp = new Int32Array(0); }

  /**
   * Chains along the roof edges facing the streets within R of `c` (world), two across the street below; link
   * times out from `c` at v m/s from `tTake`, raised hands from `tUp` at vUp m/s.
   */
  static async build(w: RoofWorld, o: { c: THREE.Vector3; R: number; seed: number; tTake: number; v: number; tUp: number; vUp: number; avoid: (x: number, z: number) => boolean; clips: string[]; skip?: unknown[] }) {
    const C = new CityChains();
    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    const figs = [new RealFigure(rp!, 'rpm', col('white')), new RealFigure(mi!, 'michelle', col('white'))];
    C.hip = figs.map((f) => f.hipHeight);
    const ms = await Promise.all(o.clips.map((c) => loadMotion(c)));
    C.tables = ms.map((m) => figs.map((f) => [m.joints(f, { face: true }), m.joints(f, { face: true, mirror: true })]));
    const nClips = ms.length;

    const add = (pos: THREE.Vector3, face: THREE.Vector3, chain: number, k: number, i: number) => {
      const h = (q: number) => hash(i, o.seed, q);
      const d = Math.hypot(pos.x - o.c.x, pos.z - o.c.z);
      const body = (h(1) < 0.5 ? 0 : 1) as 0 | 1;
      C.people.push({
        pos, yaw: Math.atan2(face.x, face.z) + (h(2) - 0.5) * 0.35, s: h(3) < 0.06 ? 0.78 : 0.93 + 0.14 * h(4), body, mirror: h(5) < 0.5,
        clip: Math.floor(h(6) * nClips), off: h(7) * 40, rate: 0.85 + 0.3 * h(8), color: tint(Math.floor(h(9) * 8), 0.9 + 0.3 * h(10)), seed: h(11) * 10,
        chain, k, tl: o.tTake + d / o.v + (h(12) - 0.5) * 0.12, tu: o.tUp + d / o.vUp + h(13) * 0.1, face: face.clone(),
      });
    };

    // roof edges facing the streets (north and south faces of the rows)
    const city = w.city;
    let n = 0;
    const roofChains: { ci: number; x0: number; x1: number; z: number; y: number; nz: number }[] = [];
    for (const b of city.plan.buildings) {
      const cx = (b.x0 + b.x1) / 2 + CITY_OFF.x, cz = (b.z0 + b.z1) / 2 + CITY_OFF.z;
      if (Math.hypot(cx - o.c.x, cz - o.c.z) > o.R) continue;
      const top = b.tiers.reduce((m, t) => (t.y0 + t.h > m.y0 + m.h ? t : m), b.tiers[0]!);
      const y = top.y0 + top.h;
      if (y > 95 || top.w < 7.5) continue;
      for (const fb of [F.N, F.S]) {
        const [nx, nz] = faceNormal(fb);
        const z = top.cz + nz * (top.d / 2 - 0.75) + CITY_OFF.z;
        const xa = top.cx - top.w / 2 + 0.9 + CITY_OFF.x, xb = top.cx + top.w / 2 - 0.9 + CITY_OFF.x;
        if (o.avoid((xa + xb) / 2, z)) continue;
        const ci = C.chains.length, ch: Chain = { people: [], dir: new THREE.Vector3(1, 0, 0), ground: false };
        // irregular spacing, a few gaps (someone stepped back)
        let x = xa + hash(b.id, fb, 1) * 0.4, k = 0;
        while (x <= xb) {
          const h = (q: number) => hash(b.id * 31 + fb, k, q);
          add(new THREE.Vector3(x, y + 0.02, z + (h(1) - 0.5) * 0.25), new THREE.Vector3(nx, 0, nz), ci, k, n++);
          ch.people.push(C.people.length - 1);
          x += 0.86 + 0.28 * h(2);
          k++;
        }
        if (ch.people.length >= 2) { C.chains.push(ch); roofChains.push({ ci, x0: xa, x1: xb, z, y, nz }); }
        else { for (const _ of ch.people) C.people.pop(); }
      }
    }
    // the street's own buildings (the location's, not the city's): their street-side roof edges
    for (const b of w.set.blds) {
      if (b === w.set.his || o.skip?.includes(b)) continue;
      const y = b.h + 0.3, south = b.z0 > 0;
      const nz = south ? -1 : 1, z = (south ? b.z0 + 0.75 : b.z1 - 0.75);
      const xa = b.x0 + 0.8, xb = b.x1 - 0.8;
      if (xb - xa < 3) continue;
      const ci = C.chains.length, ch: Chain = { people: [], dir: new THREE.Vector3(1, 0, 0), ground: false };
      // (on her roof, a gap where she would stand)
      let x = xa + hash(b.x0, 7, 1) * 0.3, k = 0;
      while (x <= xb) {
        const h = (q: number) => hash(Math.round(b.x0 * 10), k, q);
        if (!(b === w.set.hers && Math.abs(x) < 1.6)) {
          add(new THREE.Vector3(x, y + 0.02, z + (h(1) - 0.5) * 0.2), new THREE.Vector3(0, 0, nz), ci, ch.people.length, n++);
          ch.people.push(C.people.length - 1);
        }
        x += 0.86 + 0.28 * h(2);
        k++;
      }
      if (ch.people.length >= 2) { C.chains.push(ch); roofChains.push({ ci, x0: xa, x1: xb, z, y, nz }); }
      else { for (const _ of ch.people) C.people.pop(); }
    }
    // across the street below: two lines of people from sidewalk to sidewalk
    for (const [x0, s] of [[34, 1], [-41, 2], [86, 3]] as [number, number][]) {
      const ci = C.chains.length, ch: Chain = { people: [], dir: new THREE.Vector3(0, 0, 1), ground: true };
      for (let z = -8.2, k = 0; z <= 8.2; k++) {
        const h = (q: number) => hash(s * 97, k, q);
        add(new THREE.Vector3(x0 + (h(1) - 0.5) * 0.4, 0.05, z), new THREE.Vector3(1, 0, 0), ci, k, n++);
        ch.people.push(C.people.length - 1);
        z += 0.85 + 0.25 * h(2);
      }
      C.chains.push(ch);
    }
    // people waving from the fire escapes and window sills of the street (each on their own)
    const wave = o.clips.indexOf('141_16'), joy = o.clips.indexOf('79_69');
    w.set.anchors.filter((a) => a.kind !== 'window').forEach((a, j) => {
      if (j % 2) return;
      const ci = C.chains.length;
      add(a.pos.clone(), new THREE.Vector3(Math.sin(a.yaw), 0, Math.cos(a.yaw)), ci, 0, n++);
      const P = C.people[C.people.length - 1]!;
      P.yaw = a.yaw + (hash(j, 3) - 0.5) * 0.5;
      P.clip = j % 3 === 0 && joy >= 0 ? joy : Math.max(0, wave);
      C.chains.push({ people: [C.people.length - 1], dir: new THREE.Vector3(1, 0, 0), ground: false });
    });
    // threads: roof to roof along a row (the next building's chain), and across the streets
    for (const A of roofChains) for (const B of roofChains) {
      if (A === B) continue;
      const ca = C.chains[A.ci]!, cb = C.chains[B.ci]!;
      if (A.nz === B.nz && Math.abs(A.z - B.z) < 6 && B.x0 > A.x1 && B.x0 - A.x1 < 4) {
        const a = ca.people[ca.people.length - 1]!, b = cb.people[0]!;
        C.bridges.push({ a, b, sag: 0.25, t: Math.max(C.people[a]!.tl, C.people[b]!.tl) + 0.1 });
      }
      if (A.nz === -1 && B.nz === 1 && A.z - B.z > 12 && A.z - B.z < 32 && Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) > 3) {
        // (the facing rows across a street: one thread from the middle of their overlap)
        const xm = (Math.min(A.x1, B.x1) + Math.max(A.x0, B.x0)) / 2;
        const near = (ch: Chain) => ch.people.reduce((m, i) => (Math.abs(C.people[i]!.pos.x - xm) < Math.abs(C.people[m]!.pos.x - xm) ? i : m), ch.people[0]!);
        const a = near(ca), b = near(cb);
        C.bridges.push({ a, b, sag: 2.5 + 0.1 * (A.z - B.z), t: Math.max(C.people[a]!.tl, C.people[b]!.tl) + 0.15 });
      }
    }
    C.jw = new Float32Array(C.people.length * 39);
    C.stamp = new Int32Array(C.people.length).fill(-1);
    return C;
  }

  /** Link 0..1 of person i at t; raised hands 0..1. */
  link(i: number, t: number) { const P = this.people[i]!; return ease.inOutCubic(clamp((t - P.tl) / 0.4)); }
  up(i: number, t: number) { const P = this.people[i]!; return ease.inOutCubic(clamp((t - P.tu) / 0.55)); }

  /** Person i's own motion, placed (world joints into jw). */
  private base(i: number, t: number) {
    if (this.stamp[i] === this.frame) return;
    const P = this.people[i]!;
    this.tables[P.clip]![P.body]![P.mirror ? 1 : 0]!.at(P.off + t * P.rate, this.pose);
    this.q.setFromAxisAngle(Y, P.yaw);
    const hip = this.hip[P.body]! * P.s, o = i * 39;
    for (let k = 0; k < 13; k++) {
      _a.set(this.pose[k * 3]!, this.pose[k * 3 + 1]!, this.pose[k * 3 + 2]!).multiplyScalar(P.s).applyQuaternion(this.q);
      this.jw[o + k * 3] = _a.x + P.pos.x; this.jw[o + k * 3 + 1] = _a.y + P.pos.y + hip; this.jw[o + k * 3 + 2] = _a.z + P.pos.z;
    }
    this.stamp[i] = this.frame;
  }
  private J(i: number, k: number, out: THREE.Vector3) { return out.fromArray(this.jw, i * 39 + k * 3); }

  /** Where the hands of i and its neighbour j meet (from their shoulders; low, or raised by `up`). */
  grip(i: number, j: number, t: number, out = new THREE.Vector3()) {
    const P = this.people[i]!, Q = this.people[j]!;
    if (this.stamp[i] !== this.frame || this.stamp[j] !== this.frame) {
      // (far away: from where they stand)
      return out.addVectors(P.pos, Q.pos).multiplyScalar(0.5).addScaledVector(Y, 1.0 * (P.s + Q.s) / 2 + 0.75 * Math.max(this.up(i, t), this.up(j, t))).addScaledVector(P.face, 0.15);
    }
    const si = this.side(i, Q.pos), sj = this.side(j, P.pos);
    this.J(i, 2 + si, _a); this.J(j, 2 + sj, _b);
    const u = Math.max(this.up(i, t), this.up(j, t)), s = (P.s + Q.s) / 2;
    const hang = -0.42 * s * (1 - u) + 0.42 * s * u;
    return out.addVectors(_a, _b).multiplyScalar(0.5).addScaledVector(Y, hang).addScaledVector(P.face, 0.14 * s * (1 - 0.5 * u));
  }

  /** Which arm (0 left, 1 right) of person i is on the side of q. */
  private side(i: number, q: THREE.Vector3) {
    this.J(i, 2, _a); this.J(i, 3, _b);
    return _c.subVectors(_a, _b).dot(_e.subVectors(q, _b.lerp(_a, 0.5))) > 0 ? 0 : 1;
  }

  /** Bend arm s of person i toward target T by w (two-bone IK blended over the captured arm). */
  private reach(i: number, s: number, T: THREE.Vector3, w: number) {
    if (w <= 0.001) return;
    const o = i * 39, P = this.people[i]!;
    const S = this.J(i, 2 + s, new THREE.Vector3()), E0 = this.J(i, 4 + s, new THREE.Vector3()), H0 = this.J(i, 6 + s, new THREE.Vector3());
    const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0);
    const away = new THREE.Vector3().subVectors(S, T).setY(0);
    if (away.lengthSq() < 1e-6) away.copy(P.face);
    const pole = away.normalize().multiplyScalar(0.5).addScaledVector(Y, -0.7).addScaledVector(P.face, -0.3);
    const E = new THREE.Vector3(), H = new THREE.Vector3();
    ik(S, L1, L2, T, pole, E, H);
    E0.lerp(E, w).toArray(this.jw, o + (4 + s) * 3);
    H0.lerp(H, w).toArray(this.jw, o + (6 + s) * 3);
  }

  /**
   * Draw: people within `near` of the camera (and in view) as stardust, the rest as points of light at the chest;
   * the threads through joined hands. `k` overall brightness, `goldK` how far everyone has turned gold (besides
   * their own link).
   */
  draw(t: number, cam: THREE.PerspectiveCamera, D: Stardust, pts: GlowPoints, th: Threads, o: { k: number; ptK?: number; near: number; maxNear?: number; ptSize?: number; threadK?: number; dustGain?: number }) {
    this.frame++;
    cam.updateMatrixWorld();
    const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const sph = new THREE.Sphere(), cp = cam.position;
    const near: number[] = [];
    let np = 0;
    const colr = new THREE.Color();
    const vis = new Uint8Array(this.people.length);
    this.people.forEach((P, i) => {
      sph.set(_a.copy(P.pos).addScaledVector(Y, 1), 1.4);
      if (!fr.intersectsSphere(sph)) return;
      vis[i] = 1;
      const d = P.pos.distanceTo(cp);
      if (d < o.near) near.push(i);
    });
    near.sort((a, b) => this.people[a]!.pos.distanceToSquared(cp) - this.people[b]!.pos.distanceToSquared(cp));
    if (o.maxNear && near.length > o.maxNear) near.length = o.maxNear;
    const isNear = new Uint8Array(this.people.length);
    for (const i of near) { isNear[i] = 1; this.base(i, t); }
    // (neighbours of near people are posed too, so hands meet)
    for (const i of near) {
      const P = this.people[i]!, ch = this.chains[P.chain]!.people;
      for (const j of [ch[P.k - 1], ch[P.k + 1]]) if (j !== undefined) this.base(j, t);
    }
    for (const i of near) {
      const P = this.people[i]!, ch = this.chains[P.chain]!.people;
      for (const j of [ch[P.k - 1], ch[P.k + 1]]) {
        if (j === undefined) continue;
        const w = Math.min(this.link(i, t), this.link(j, t));
        if (w <= 0) continue;
        const T = this.grip(i, j, t, new THREE.Vector3());
        T.addScaledVector(_c.subVectors(this.people[j]!.pos, P.pos).normalize(), -0.03);
        this.reach(i, this.side(i, this.people[j]!.pos), T, w);
      }
    }
    for (const i of near) {
      const P = this.people[i]!, l = this.link(i, t);
      for (let k = 0; k < 13; k++) (this.js[k] ??= new THREE.Vector3()).fromArray(this.jw, i * 39 + k * 3);
      colr.copy(P.color).lerp(this.gold, l * 0.85);
      const fade = smoothstep(0.6, 2.2, P.pos.distanceTo(cp));
      D.figure(this.js, P.body, colr, o.k * fade * (0.75 + 0.35 * l) * (1 + 0.6 * Math.exp(-((t - P.tl - 0.2) ** 2) / 0.02)), { seed: P.seed });
    }
    // far: one point of light each
    const sz = o.ptSize ?? 0.55;
    this.people.forEach((P, i) => {
      if (!vis[i] || isNear[i] || np >= pts.n) return;
      const l = this.link(i, t);
      colr.copy(P.color).lerp(this.gold, l * 0.85);
      pts.set(np++, P.pos.x, P.pos.y + 1.25 * P.s, P.pos.z, colr, o.k * (o.ptK ?? 1) * (0.6 + 0.5 * l) * (1 + 1.2 * Math.exp(-((t - P.tl - 0.2) ** 2) / 0.03)), sz);
    });
    pts.commit(np);
    // the threads through the joined hands (each grows from the earlier-linked side)
    const tk = o.threadK ?? 1;
    const g = this.gold, ga = new THREE.Vector3(), gb = new THREE.Vector3();
    for (const ch of this.chains) {
      for (let k = 0; k + 1 < ch.people.length; k++) {
        const i = ch.people[k]!, j = ch.people[k + 1]!;
        if (!vis[i] && !vis[j]) continue;
        const ts = Math.max(this.people[i]!.tl, this.people[j]!.tl) + 0.15;
        const u = clamp((t - ts) / 0.25);
        if (u <= 0) continue;
        this.grip(i, j, t, gb);
        const pi = ch.people[k - 1], pj = ch.people[k + 2];
        const a = pi !== undefined ? this.grip(pi, i, t, ga) : ga.copy(gb).addScaledVector(_c.subVectors(this.people[i]!.pos, this.people[j]!.pos), 1);
        // the thread from the previous grip through this one (passing in front of person i)
        const fl = 1 + 1.6 * Math.exp(-((t - ts - 0.15) ** 2) / 0.02);
        th.sag(a, gb, 0.06, g, tk * 1.6 * fl * u, 0.03, 1, 3);
        if (pj === undefined) th.seg(gb, _c.copy(gb).addScaledVector(_e.subVectors(this.people[j]!.pos, this.people[i]!.pos), 0.6), g, tk * 1.0 * u, 0.03);
      }
    }
    for (const B of this.bridges) {
      const u = clamp((t - B.t) / 0.6);
      if (u <= 0 || (!vis[B.a] && !vis[B.b] && B.sag < 1)) continue;
      const A = this.people[B.a]!, Bp = this.people[B.b]!;
      ga.copy(A.pos).addScaledVector(Y, 1.0 + 0.75 * this.up(B.a, t)).addScaledVector(A.face, 0.2);
      gb.copy(Bp.pos).addScaledVector(Y, 1.0 + 0.75 * this.up(B.b, t)).addScaledVector(Bp.face, 0.2);
      th.sag(ga, gb, B.sag, g, tk * (1.4 + 2.0 * Math.exp(-((t - B.t - 0.6) ** 2) / 0.05)), 0.04, ease.outCubic(u), 14);
    }
    void o.dustGain;
  }
}
