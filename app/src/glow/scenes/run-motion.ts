// Motion helpers for the street scenes (run, citydrop, overpass): running people that really run (one clean
// stride cycle of a captured run, looped seamlessly, travelling at the speed the feet carry them), routes through
// the streets with arc length, hand holding, and the moments when two hands meet.
import * as THREE from 'three';
import { Motion, type PlayOpts } from '../lib/motion';
import type { RealFigure } from '../lib/people';
import { clamp, mod } from '../../engine/util';

/**
 * A span of a clip [c0, c0 + P] with its travel taken out linearly (the body stays in place; the scene moves it
 * along its route at `speed(fig)`), looped without a crossfade (`loop`) or clamped to its ends.
 * Looped, it is one stride cycle of a run: the short captured runs are only ~1.2 s long, and the generic loop
 * (a 0.6 s crossfade over the last part of the clip) blends two different phases of the stride while the
 * low-passed root drifts, so the legs go soft and the body slides. Here the cycle [c0, c0 + P] was measured from
 * the clip (the pose at its end matches its start), so nothing is blended. Clamped, it is a move (a jump) whose
 * own travel the scene replaces with its path. Works with lib/crowd.ts (Crowd.addMotion): its joint tables cover
 * exactly one cycle.
 */
export class CycleMotion extends Motion {
  c0: number;
  P: number;
  private ra = new THREE.Vector3();
  private rb = new THREE.Vector3();

  constructor(name: string, text: string, startFrame: number, periodFrames: number, public looped = true) {
    super(name, text);
    this.c0 = startFrame / this.fps;
    this.P = periodFrames / this.fps;
    const W: THREE.Quaternion[] = [];
    this.sampleRaw(this.c0, W, this.ra, false);
    this.sampleRaw(this.c0 + this.P, W, this.rb, false);
    // (lib/motion's joint tables and loops run over duration − 0.6 s: make that exactly one cycle)
    this.duration = this.P + 0.6;
  }

  override sample(t: number, W: THREE.Quaternion[], root: THREE.Vector3, _o: PlayOpts = {}) {
    const ph = this.looped ? mod(t, this.P) : clamp(t, 0, this.P), k = ph / this.P;
    this.sampleRaw(this.c0 + ph, W, root, false);
    root.x -= this.ra.x + (this.rb.x - this.ra.x) * k;
    root.z -= this.ra.z + (this.rb.z - this.ra.z) * k;
  }

  /** Ground speed (m/s) of `fig`'s body kind running this cycle at clip speed 1. */
  speed(fig: RealFigure) {
    return (Math.hypot(this.rb.x - this.ra.x, this.rb.z - this.ra.z) / this.P) * this.rig(fig).scale;
  }
}

/** Measured stride cycles: [first frame, period in frames] (30 fps). */
export const CYCLES: Record<string, [number, number]> = {
  '09_01': [0, 22], // run, 0.73 s
  '16_35': [13, 24], // jog, 0.8 s
};

const cycles = new Map<string, Promise<CycleMotion>>();
/** A clip's stride cycle (see CYCLES), cached. Its id for a Crowd is `<clip>c`. */
export function loadCycle(id: string): Promise<CycleMotion> {
  const [a, n] = CYCLES[id] ?? [0, 20];
  return loadSpan(id, a, n, true);
}
/** A span of a clip (frames [a, a + n] at 30 fps) with its travel taken out, looped or clamped (see CycleMotion). */
export function loadSpan(id: string, a: number, n: number, looped = false): Promise<CycleMotion> {
  const key = `${id}|${a}|${n}|${looped}`;
  let p = cycles.get(key);
  if (!p) {
    p = fetch(`mocap/${id}.bvh`).then((r) => r.text()).then((txt) => new CycleMotion(looped ? `${id}c` : `${id}s${a}`, txt, a, n, looped));
    cycles.set(key, p);
  }
  return p;
}

/** A route through the streets: a 3D polyline (y = ground height, for steps and bridges) by arc length. */
export class Route {
  pts: THREE.Vector3[];
  L: number[] = [0];
  constructor(pts: (THREE.Vector3 | [number, number, number])[]) {
    this.pts = pts.map((p) => (Array.isArray(p) ? new THREE.Vector3(...p) : p.clone()));
    for (let i = 1; i < this.pts.length; i++) this.L.push(this.L[i - 1]! + this.pts[i]!.distanceTo(this.pts[i - 1]!));
  }
  get length() { return this.L[this.L.length - 1]!; }
  private seg(s: number) {
    const L = this.L;
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m]! <= s) lo = m; else hi = m; }
    return lo;
  }
  /** How far before its start people may still be placed (the route runs on straight back). */
  extendBack = 400;
  /** The point at arc length s (extrapolated straight on past the ends). */
  at(s: number, out = new THREE.Vector3()) {
    const i = this.seg(clamp(s, 0, this.length)), a = this.pts[i]!, b = this.pts[i + 1] ?? a;
    const l = this.L[i + 1]! - this.L[i]!;
    return out.copy(a).lerp(b, l > 1e-6 ? (s - this.L[i]!) / l : 0);
  }
  /** The horizontal heading at s (unit, y = 0), smoothed over ±r metres so corners are rounded. */
  dir(s: number, out = new THREE.Vector3(), r = 2.5) {
    const a = this.at(s - r, _a), b = this.at(s + r, _b);
    out.subVectors(b, a).setY(0);
    const l = out.length();
    return l > 1e-6 ? out.multiplyScalar(1 / l) : out.set(0, 0, 1);
  }
  /** Yaw (rotation about +y, 0 = facing +z) of the heading at s. */
  yaw(s: number, r = 2.5) { const d = this.dir(s, _c, r); return Math.atan2(d.x, d.z); }
  /** The point at s, offset sideways by `side` metres (to the right of the heading). */
  side(s: number, side: number, out = new THREE.Vector3(), r = 2.5) {
    const d = this.dir(s, _c, r);
    // (the corner-smoothed point, so people offset to the side cut the corners like people do)
    this.at(s, out);
    return out.add(_d.set(-d.z, 0, d.x).multiplyScalar(side));
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

/**
 * Two people holding hands: hand `ia` of `a` and hand `ib` of `b` meet halfway, weighted by k (0 = their own
 * motion, 1 = holding). Call after both are posed by their motion.
 */
export function holdHands(a: RealFigure, ia: number, b: RealFigure, ib: number, k: number, lift = 0) {
  if (k <= 0.001) return;
  const ha = a.hand(ia, new THREE.Vector3()), hb = b.hand(ib, new THREE.Vector3());
  const m = ha.clone().lerp(hb, 0.5);
  m.y += lift;
  const pa = new THREE.Vector3(ia === 0 ? -0.6 : 0.6, -0.8, -0.2), pb = new THREE.Vector3(ib === 0 ? -0.6 : 0.6, -0.8, -0.2);
  a.reach(ia, ha.lerp(m, k), pa);
  b.reach(ib, hb.lerp(m, k), pb);
  a.setHand(ia, 0.55 * k + 0.2 * (1 - k));
  b.setHand(ib, 0.55 * k + 0.2 * (1 - k));
}

/** A smooth 0 → 1 → 0 window: in over [t0, t0 + a], out over [t1 − b, t1]. */
export function inOut(t: number, t0: number, t1: number, a = 0.3, b = 0.3) {
  const u = clamp((t - t0) / a), v = clamp((t1 - t) / b);
  const e = (x: number) => x * x * (3 - 2 * x);
  return Math.min(e(u), e(v));
}
