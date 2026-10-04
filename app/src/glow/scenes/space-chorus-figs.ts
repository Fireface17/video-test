// Space chorus: star-figures (people drawn as constellations, lib/stars.ts) in numbers. Posing a realistic body
// costs CPU, so the dances and a few still poses are baked once into a PoseBank (the 13 star joints of each body
// kind, sampled 16 times per beat over the 4-beat cycle of lib/people.ts `dance`) and every figure on screen
// reads its joints from the bank: hundreds of dancers for the cost of a table lookup.
import * as THREE from 'three';
import { RealFigure, bend, dance, limbDir } from '../lib/people';
import { starJoints } from '../lib/stars';

export const NJ = 13;
export const NJ3 = NJ * 3;
const SPB = 16, CYC = 4, NS = SPB * CYC, STRIDE = NJ3 + 1;
export const HEAD = 0, NECK = 1, LHAND = 6, RHAND = 7, HIPS = 8;

export type StillPose = 'rest' | 'float' | 'slump' | 'chain' | 'chainUp' | 'cheer';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Joint positions of a body kind in its own frame: pelvis at the origin, facing +z, y up, its left at +x. */
export class PoseBank {
  private dances: Float32Array[] = [];
  private stills = new Map<StillPose, Float32Array>();
  readonly hipHeight: number;
  private v: THREE.Vector3[] = [];

  constructor(public fig: RealFigure) {
    this.hipHeight = fig.hipHeight;
    fig.position.set(0, 0, 0);
    fig.quaternion.identity();
    fig.scale.setScalar(1);
    for (let s = 0; s < 4; s++) {
      const a = new Float32Array(NS * STRIDE);
      for (let k = 0; k < NS; k++) {
        const b = dance(fig, k / SPB, s, 1, 0);
        this.grab(a, k * STRIDE);
        a[k * STRIDE + NJ3] = b;
      }
      this.dances.push(a);
    }
    const arm = (i: number, raise: number, fwd: number, elbow: number, twist = 0, toward = V(0, 0.1, 1)) => {
      const s = i ? 1 : -1, u = limbDir(s, raise, fwd);
      fig.setArm(i, u, bend(u, toward.clone().setX(toward.x * s), elbow), twist);
    };
    const legs = (spread: number, fwd: number, knee: number) => {
      for (const i of [0, 1]) { const s = i ? 1 : -1, th = limbDir(s, spread, fwd); fig.setLeg(i, th, bend(th, V(0, 0, -1), knee)); }
    };
    const hands = (c: number) => { fig.setHand(0, c); fig.setHand(1, c); fig.setFoot(0, 0); fig.setFoot(1, 0); };
    const still = (name: StillPose, fn: () => void) => { fn(); const a = new Float32Array(NJ3); this.grab(a, 0); this.stills.set(name, a); };
    still('rest', () => { fig.setSpine(0, 0, -0.08, 0); arm(0, 0.14, 0.04, 0.2); arm(1, 0.14, 0.04, 0.2); legs(0.05, 0, 0); hands(0.3); });
    still('float', () => { fig.setSpine(-0.08, 0, -0.12, 0); arm(0, 0.75, 0.15, 0.45); arm(1, 0.75, 0.15, 0.45); legs(0.12, 0.25, 0.55); hands(0.2); });
    still('slump', () => { fig.setSpine(0.38, 0.05, 0.75, 0.1); arm(0, 0.08, 0.3, 0.35); arm(1, 0.08, 0.3, 0.35); legs(0.06, 0.12, 0.3); hands(0.45); });
    still('chain', () => { fig.setSpine(-0.04, 0, -0.08, 0); arm(0, 1.3, 0.1, 0.12); arm(1, 1.3, 0.1, 0.12); legs(0.1, 0, 0); hands(0.1); });
    still('chainUp', () => { fig.setSpine(-0.16, 0, -0.35, 0); arm(0, 2.25, 0.12, 0.1); arm(1, 2.25, 0.12, 0.1); legs(0.16, 0, 0); hands(0.1); });
    still('cheer', () => { fig.setSpine(-0.2, 0, -0.4, 0); arm(0, 2.75, 0.2, 0.2); arm(1, 2.75, 0.2, 0.2); legs(0.14, 0.15, 0.25); hands(0.05); });
  }

  private grab(out: Float32Array, o: number) {
    starJoints(this.fig, this.v);
    for (let j = 0; j < NJ; j++) {
      const p = this.v[j]!;
      out[o + j * 3] = p.x; out[o + j * 3 + 1] = p.y; out[o + j * 3 + 2] = p.z;
    }
  }

  pose(name: StillPose): Float32Array { return this.stills.get(name)!; }

  /** Dance `style` (0..3) at continuous beat `b` into `out`, blended from `base` by `energy`; returns the bounce. */
  dance(style: number, b: number, out: Float32Array, energy = 1, base: Float32Array = this.pose('float')): number {
    const x = (((b % CYC) + CYC) % CYC) * SPB, i0 = Math.floor(x) % NS, f = x - Math.floor(x), i1 = (i0 + 1) % NS;
    const a = this.dances[style & 3]!, o0 = i0 * STRIDE, o1 = i1 * STRIDE;
    for (let j = 0; j < NJ3; j++) {
      const d = a[o0 + j]! * (1 - f) + a[o1 + j]! * f;
      out[j] = base[j]! + (d - base[j]!) * energy;
    }
    return (a[o0 + NJ3]! * (1 - f) + a[o1 + NJ3]! * f) * energy;
  }
}

/** out = mix(out, b, k) over the joints. */
export function mixPose(out: Float32Array, b: Float32Array, k: number) {
  if (k <= 0) return out;
  for (let j = 0; j < NJ3; j++) out[j] = out[j]! + (b[j]! - out[j]!) * k;
  return out;
}

/** A figure's frame in the world: pelvis position, right (its left, +x), up and facing directions, scale. */
export interface Frame3 { p: THREE.Vector3; x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3; s: number }

/** World joints from local joints `J` (pelvis frame) through `F`, into the vectors of `out`. */
export function placeJoints(J: Float32Array, F: Frame3, out: THREE.Vector3[], lift = 0) {
  for (let j = 0; j < NJ; j++) {
    const v = out[j] ?? (out[j] = new THREE.Vector3());
    const lx = J[j * 3]!, ly = J[j * 3 + 1]! + lift, lz = J[j * 3 + 2]!;
    v.set(
      F.p.x + F.s * (lx * F.x.x + ly * F.y.x + lz * F.z.x),
      F.p.y + F.s * (lx * F.x.y + ly * F.y.y + lz * F.z.y),
      F.p.z + F.s * (lx * F.x.z + ly * F.y.z + lz * F.z.z),
    );
  }
  return out;
}

export function newJoints(): THREE.Vector3[] { return Array.from({ length: NJ }, () => new THREE.Vector3()); }
