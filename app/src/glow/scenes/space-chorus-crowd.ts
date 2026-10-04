// Space chorus: the people of stars. Three rings of star-figures around the Earth (in the plane z = 0, heads
// out, facing +z). In the first lines only the front of each ring exists, as three rows dancing above the
// horizon (row k pulled back to z = -8k); later every ring fills up and the rows swing out into concentric
// rings holding hands around the planet. Each figure is born from a light: rising from the planet, or a star
// that was a piece of the glass heart. Two hero figures in front are posed live (reaching for each other).
import * as THREE from 'three';
import { clamp, ease, hash, lerp, prog, pulse, smoothstep } from '../../engine/util';
import { RealFigure, bend, limbDir } from '../lib/people';
import { GlowLines, StarFigures, starJoints } from '../lib/stars';
import { GlowPoints } from '../lib/points';
import { HIPS, LHAND, NECK, NJ, NJ3, PoseBank, RHAND, mixPose, newJoints, placeJoints, type Frame3 } from './space-chorus-figs';
import { R } from './space-chorus-space';

export const RINGS = [{ r: R + 3.5, n: 38 }, { r: R + 8.5, n: 46 }, { r: R + 13.5, n: 54 }];
export const FIG_S = 2.2;
/** Formation rows (A): radius and depth of row k. */
export const ROW = [{ r: R + 3.5, z: 0 }, { r: R + 4.6, z: -8 }, { r: R + 5.8, z: -16 }];
const FORM_TH = [0.78, 0.74, 0.7];

export interface Fig {
  ring: number; i: number; th0: number; body: number; style: number; phase: number; hue: number;
  formA: boolean; hero: number;
  /** When the figure appears (its last light arrives) and where it blooms from. */
  born: number; src: 'rise' | 'shard' | 'star'; shard: number; seed: THREE.Vector3;
  /** Its rising lights (one per joint for formation figures, one for the others). */
  lights: { from: THREE.Vector3; t0: number }[];
  j: THREE.Vector3[]; vis: number;
}

export interface CrowdLook { star: THREE.Color; line: THREE.Color; accent: THREE.Color; hero: [THREE.Color, THREE.Color] }

/** Everything the crowd does, as functions of song time (filled in by the scene from the lyrics and beats). */
export interface CrowdTimes {
  /** Formation → rings (the rows swing out), and the rings' spin. */
  form0: number; form1: number;
  /** Hero pair: take / my / hand; the chain of joined hands runs out from them. */
  take: number; my: number; hand: number;
  /** Dance energy and the hand-holding weight over time. */
  energy: (t: number) => number; chain: (t: number) => number; chainUp: (t: number) => number;
  /** Ring spin (rad) per ring. */
  spin: (t: number, ring: number) => number;
  glow: (t: number) => number;
  /** 0..1 implosion toward `implodeAt`. */
  implode: (t: number) => number;
  /** Stutter hits: extra brightness (0..). */
  flash: (t: number) => number;
}

const _F: Frame3 = { p: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), s: 1 };
const Z = new THREE.Vector3(0, 0, 1);

export class Crowd {
  figs: Fig[] = [];
  sf: StarFigures;
  links: GlowLines;
  lights: GlowPoints;
  heroes: RealFigure[];
  private J = new Float32Array(NJ3);
  private J2 = new Float32Array(NJ3);
  private hj = [newJoints(), newJoints()];
  T!: CrowdTimes;
  beatAt!: (t: number) => number;
  implodeAt = new THREE.Vector3();

  constructor(public banks: PoseBank[], heroes: RealFigure[], public look: CrowdLook, seed: number) {
    this.heroes = heroes;
    let n = 0;
    RINGS.forEach((rg, ring) => {
      for (let i = 0; i < rg.n; i++) {
        let th0 = (2 * Math.PI * (i + 0.5)) / rg.n - Math.PI;
        if (ring > 0) th0 += (Math.PI / rg.n) * (ring === 1 ? 0.5 : -0.5); // (rows don't line up behind each other)
        const formA = Math.abs(th0) < FORM_TH[ring]!;
        const hero = ring === 0 && (i === rg.n / 2 - 1 || i === rg.n / 2) ? (i === rg.n / 2 - 1 ? 0 : 1) : -1;
        this.figs.push({
          ring, i, th0, body: hash(seed, n, 1) < 0.5 ? 0 : 1, style: Math.floor(hash(seed, n, 2) * 4), phase: Math.floor(hash(seed, n, 3) * 4),
          hue: hash(seed, n, 4), formA, hero, born: Infinity, src: 'rise', shard: -1, seed: new THREE.Vector3(), lights: [], j: newJoints(), vis: 0,
        });
        n++;
      }
    });
    for (const f of this.figs) if (f.hero >= 0) f.body = f.hero;
    this.sf = new StarFigures(this.figs.length, 0.3, 0.05);
    this.links = new GlowLines(this.figs.length + 8, 0.05);
    this.lights = new GlowPoints(this.figs.length * NJ + 64, 0.12);
  }

  /** Frame (pelvis, axes, scale) of figure f at time t. */
  frame(f: Fig, t: number, out: Frame3 = _F) {
    const T = this.T;
    const k = ease.inOutCubic(prog(t, T.form0, T.form1));
    const row = ROW[f.ring]!, rg = RINGS[f.ring]!;
    let r = lerp(row.r, rg.r, k), z = lerp(row.z, 0, k), s = FIG_S;
    if (f.hero >= 0) { z = lerp(5, 0, k); s = lerp(2.9, FIG_S, k); r += 0.4 * (1 - k); }
    const th = f.th0 + T.spin(t, f.ring);
    const up = out.y.set(Math.sin(th), Math.cos(th), 0);
    out.x.set(Math.cos(th), -Math.sin(th), 0);
    out.z.copy(Z);
    out.p.set(up.x * r, up.y * r, z);
    out.s = s;
    const imp = T.implode(t);
    if (imp > 0) { out.p.lerp(this.implodeAt, imp); out.s *= 1 - 0.85 * imp; }
    return out;
  }

  /** Local joints of figure f at time t into this.J (dance, holding hands, cheering). */
  private pose(f: Fig, t: number) {
    const T = this.T, bank = this.banks[f.body]!, J = this.J;
    const beat = this.beatAt(t);
    const e = T.energy(t);
    // rings dance as one: neighbours share a style, a wave runs round the ring
    const style = t > T.form1 ? (f.ring === 1 ? 0 : 1) : f.style;
    const ph = t > T.form1 ? (style === 1 ? f.i * 0.35 : 0) : f.phase;
    const bounce = bank.dance(style, beat + ph, J, e, bank.pose('float'));
    const c = T.chain(t);
    if (c > 0) {
      // holding hands: a living chain — sways with the bar, lifts on the beat
      const up = T.chainUp(t);
      const sway = Math.sin((beat + f.i * 0.5) * Math.PI * 0.5);
      this.J2.set(bank.pose('chain'));
      mixPose(this.J2, bank.pose('chainUp'), clamp(up + 0.12 * Math.exp(-(beat % 1) * 5) * (1 - up)));
      for (let j = 0; j < NJ; j++) {
        const y = this.J2[j * 3 + 1]!;
        this.J2[j * 3] = this.J2[j * 3]! + sway * 0.05 * Math.max(0, y);
      }
      mixPose(J, this.J2, c);
    }
    return bounce * (1 - c);
  }

  /** Pose the two hero figures (live bodies): one dances then reaches; the other is low, looks up, reaches back. */
  private poseHeroes(t: number) {
    const T = this.T;
    const beat = this.beatAt(t);
    const fa = this.figs.find((f) => f.hero === 0)!, fb = this.figs.find((f) => f.hero === 1)!;
    const Fa = this.frame(fa, t, { p: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), s: 1 });
    const Fb = this.frame(fb, t, { p: new THREE.Vector3(), x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), s: 1 });
    const meet = Fa.p.clone().lerp(Fb.p, 0.5).addScaledVector(Fa.y.clone().add(Fb.y).normalize(), 0.05 * Fa.s);
    const reachA = ease.inOutCubic(prog(t, T.take - 0.25, T.hand));
    const reachB = ease.inOutCubic(prog(t, T.my - 0.2, T.hand));
    const joined = smoothstep(T.hand, T.hand + 0.15, t);
    const after = ease.inOutCubic(prog(t, T.hand + 0.2, T.hand + 0.9));
    [[this.heroes[0]!, Fa, reachA, 0] as const, [this.heroes[1]!, Fb, reachB, 1] as const].forEach(([h, F, rk, who]) => {
      h.position.copy(F.p);
      h.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(F.x, F.y, F.z));
      h.scale.setScalar(F.s);
      const s = (i: number) => (i ? 1 : -1);
      const arm = (i: number, raise: number, fwd: number, elbow: number) => { const u = limbDir(s(i), raise, fwd); h.setArm(i, u, bend(u, new THREE.Vector3(-s(i) * 0.3, 0.1, 1), elbow)); };
      const legs = (spread: number, fwd: number, knee: number) => { for (const i of [0, 1]) { const th = limbDir(s(i), spread, fwd); h.setLeg(i, th, bend(th, new THREE.Vector3(0, 0, -1), knee)); } };
      const free = ease.inOutCubic(prog(t, T.hand + 0.1, T.hand + 0.8));
      const up = T.chainUp(t);
      if (who === 0) {
        // he dances (an overhead wave), then turns to her and reaches out with his left hand (+x)
        const sw = Math.sin(beat * Math.PI * 0.5);
        h.setSpine(-0.05 + 0.1 * rk - 0.1 * after, 0.12 * sw * (1 - rk) + 0.12 * rk, -0.2 + 0.15 * rk - 0.2 * after, 0.12 * sw * (1 - rk) - 0.15 * rk);
        arm(0, lerp(lerp(2.5 + 0.35 * sw, 1.0, rk), 1.3 + 0.9 * up, free), 0.15, lerp(0.4, 0.15, free));
        arm(1, 2.5 - 0.35 * sw, 0.15, 0.4);
        legs(0.08, 0.1, 0.2);
        h.setHand(0, 0.2); h.setHand(1, 0.15 - 0.1 * rk);
      } else {
        // she stands low (head down, arms hanging), then looks up and reaches back with her right hand (-x)
        const low = 1 - rk;
        h.setSpine(0.35 * low - 0.08 * after, -0.06 * rk, lerp(0.75, -0.15 - 0.2 * after, ease.outCubic(prog(t, T.my - 0.3, T.hand))), 0.1 * low - 0.12 * rk);
        arm(0, 0.08 + 0.2 * rk, 0.3, 0.35);
        arm(1, lerp(0.08, 1.3 + 0.9 * up, free), lerp(0.3 - 0.1 * rk, 0.15, free), lerp(0.35, 0.15, free));
        legs(0.06, 0.12 * low, 0.3 * low);
        h.setHand(0, 0.45 - 0.35 * rk); h.setHand(1, lerp(0.45, 0.1, free));
      }
      // the reaching hand (his left = 1, her right = 0) goes for the meeting point; after the touch, both lift it
      const i = who === 0 ? 1 : 0;
      if (rk > 0.001) {
        h.updateMatrixWorld(true);
        const rest = h.hand(i);
        const tgt = rest.clone().lerp(meet.clone().addScaledVector(F.y, 1.2 * F.s * after), Math.max(rk, joined));
        h.reach(i, tgt, new THREE.Vector3(-s(i) * 0.4, -0.6, 0.6));
      }
      starJoints(h, this.hj[who]!);
    });
    return { fa, fb, meet };
  }

  /** Pose and draw everything for time t; `camDist` sets line widths. Returns the meeting point of the heroes. */
  update(t: number, camDist: number, sources: { shardPos: (i: number, t: number, out: THREE.Vector3) => THREE.Vector3 | null }) {
    const T = this.T, L = this.look;
    const sf = this.sf;
    sf.begin();
    const glow = T.glow(t), fl = T.flash(t);
    const w = clamp(camDist * 0.0021, 0.025, 0.4);
    sf.lines.material.uniforms.width!.value = w;
    this.links.material.uniforms.width!.value = w * 1.3;
    sf.points.material.uniforms.size!.value = clamp(0.08 + camDist * 0.0014, 0.1, 0.42);
    const heroes = this.poseHeroes(t);
    const star = new THREE.Color(), line = new THREE.Color();
    let nl = 0, np = 0;
    const lp = new THREE.Vector3();
    for (const f of this.figs) {
      const F = this.frame(f, t);
      f.seed.copy(F.p).addScaledVector(F.y, 0.35 * F.s);
      if (f.hero >= 0) {
        const hj = this.hj[f.hero]!;
        for (let j = 0; j < NJ; j++) f.j[j]!.copy(hj[j]!);
        const imp = T.implode(t);
        if (imp > 0) for (const v of f.j) v.lerp(this.implodeAt, imp);
      } else {
        const b = this.pose(f, t);
        placeJoints(this.J, F, f.j, b);
      }
      // lights on their way to this figure
      const age = t - f.born;
      for (let k = 0; k < f.lights.length; k++) {
        const L0 = f.lights[k]!;
        if (t < L0.t0 || age > 0) continue;
        const u = clamp((t - L0.t0) / Math.max(0.05, f.born - L0.t0));
        const tgt = f.src === 'rise' && f.lights.length > 1 ? f.j[k]! : f.seed;
        const ctrl = L0.from.clone().multiplyScalar(1 + 0.25 * (1 - 0.5 * u)).lerp(tgt, 0.35);
        const e = ease.inOutCubic(u);
        lp.copy(L0.from).multiplyScalar((1 - e) * (1 - e)).addScaledVector(ctrl, 2 * e * (1 - e)).addScaledVector(tgt, e * e);
        this.lights.set(np++, lp.x, lp.y, lp.z, f.src === 'shard' ? L.accent : L.star, (0.45 + 0.6 * u) * glow, 0.8 + 0.6 * u);
      }
      if (age < 0) { f.vis = 0; continue; }
      // bloom from the seed point (stars that arrive as one), or appear where the lights landed
      const bloom = f.src === 'rise' && f.lights.length > 1 ? 1 : ease.outCubic(clamp(age / 0.45));
      if (bloom < 1) for (const v of f.j) v.lerp(f.seed, 1 - bloom);
      const draw = clamp(age / 0.5);
      const hot = pulse(t, f.born, 0.15);
      f.vis = 1;
      // colour: a little variety round the scheme, the low hero greyer until her hand is taken
      star.copy(L.star).lerp(L.accent, f.hue * 0.25);
      line.copy(L.line).lerp(L.accent, f.hue * 0.3);
      let k = glow * (1 + 1.6 * hot) + fl;
      if (f.hero === 1) {
        const lit = smoothstep(T.hand - 0.05, T.hand + 0.2, t);
        star.lerp(new THREE.Color(0.35, 0.4, 0.55), 0.6 * (1 - lit)).lerp(L.hero[1], lit * 0.5);
        k *= lerp(0.45, 1, lit) * (1 + 1.5 * pulse(t, T.hand, 0.25));
      } else if (f.hero === 0) {
        star.lerp(L.hero[0], 0.4);
        k *= 1 + 1.2 * pulse(t, T.hand, 0.25);
      }
      sf.figure(f.j, star, line, k, draw, (F.s / FIG_S) * (f.hero >= 0 ? 1.15 : 1));
    }
    // joined hands: the heroes on "hand", then the chain runs out along the rows; everyone else when they are born
    const ringFigs = RINGS.map((_, r) => this.figs.filter((f) => f.ring === r));
    const lc = new THREE.Color();
    ringFigs.forEach((rf, r) => {
      const n = rf.length;
      for (let i = 0; i < n; i++) {
        const a = rf[i]!, b = rf[(i + 1) % n]!;
        if (!a.vis || !b.vis) continue;
        const tl = this.linkTime(a, b);
        if (t < tl) continue;
        const u = clamp((t - tl) / 0.12);
        const pa = a.j[LHAND]!, pb = b.j[RHAND]!;
        if (pa.distanceTo(pb) > FIG_S * 2.2 * (1 - T.implode(t) * 0.8)) continue; // (rows not yet in their rings)
        const hit = pulse(t, tl, 0.18);
        lc.copy(L.accent).lerp(L.star, 0.5);
        this.links.set(nl++, pa, pa.clone().lerp(pb, u), lc, (glow + fl) * (0.9 + 2.5 * hit));
        if (hit > 0.02) sf.star(pa.clone().lerp(pb, 0.5), L.star, hit * 2.5 * glow, 2.2);
      }
      void r;
    });
    // the heroes' touch
    const touch = pulse(t, T.hand, 0.3);
    if (touch > 0.01) {
      sf.star(heroes.meet, new THREE.Color(1, 1, 1), touch * 6, 9);
      sf.star(heroes.meet, L.accent, touch * 2, 30);
    }
    sf.end();
    this.links.commit(nl);
    this.lights.commit(np);
    void HIPS; void NECK;
  }

  /** When the hands of neighbours a → b join. */
  linkTime(a: Fig, b: Fig) {
    const T = this.T;
    if (a.hero === 0 && b.hero === 1) return T.hand;
    if (a.formA && b.formA) {
      // the chain runs out from the heroes: one link per 70 ms per step, back rows a beat later
      const step = Math.min(Math.abs(a.i + 0.5 - RINGS[a.ring]!.n / 2), Math.abs(b.i + 0.5 - RINGS[b.ring]!.n / 2));
      return T.hand + 0.12 + step * 0.07 + a.ring * 0.3;
    }
    return Math.max(a.born, b.born) + 0.25;
  }
}
