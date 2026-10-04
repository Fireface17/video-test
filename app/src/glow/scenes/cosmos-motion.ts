// How the people of the drops move. Every person's joints come from ONE place: `Motion.pose(mover, beat)`
// (13 star joints in the figure frame: pelvis at the origin, +y up, facing +z). A mover is a clip, a body,
// an offset into the clip and a mirror flag, so no two people move alike.
//
// A clip is a loop of motion on the beat grid (`beats` long). It is defined by a function that poses a real
// body (lib/people RealFigure) for a phase of the loop; at init every clip is baked into a table of joints
// (`samples` poses per loop) and sampled with Catmull-Rom splines, so motion is smooth and continuous at any
// time — no snapping, no hits. The clips here are hand-made (weight shifts with planted feet, follow-through
// in the arms, the head lagging the body); motion capture plugs in the same way: a clip whose function poses
// the body from a captured take (`Motion.apply` poses a RealFigure directly, for figures that also need IK).
import * as THREE from 'three';
import { bend, limbDir, type RealFigure } from '../lib/people';
import { starJoints } from '../lib/stars';
import type { Pose } from './cosmos-gfx';

const TAU = Math.PI * 2;
const S = (x: number) => Math.sin(TAU * x);
const C = (x: number) => Math.cos(TAU * x);
/** 0..1 cosine bump, 1 at x = 0 (mod 1). */
const B1 = (x: number) => 0.5 + 0.5 * C(x);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** A person's motion: which clip, which body, where in the clip (beats), mirrored or not. */
export interface Mover { clip: number; body: number; off: number; mirror: boolean }

/** Posing helpers on one body (figure frame; i = 0 is the -x side, the body's right). */
export class Rig {
  hip: THREE.Vector3[] = [];
  L1: number;
  L2: number;
  private qi = new THREE.Quaternion();
  constructor(public fig: RealFigure) {
    fig.position.set(0, 0, 0);
    fig.quaternion.identity();
    fig.scale.setScalar(1);
    fig.updateMatrixWorld(true);
    this.hip = [fig.bone('RightUpLeg').getWorldPosition(V()), fig.bone('LeftUpLeg').getWorldPosition(V())];
    this.L1 = fig.thigh;
    this.L2 = fig.shin;
  }

  reset() {
    const f = this.fig;
    f.position.set(0, 0, 0);
    f.quaternion.identity();
    f.setSpine(0, 0, 0, 0);
    for (const i of [0, 1]) { f.setFoot(i, 0); f.setHand(i, 0.3); }
  }

  /** The pelvis: offset and turn (yaw about y, then pitch, then roll). */
  root(x: number, y: number, z: number, yaw = 0, pitch = 0, roll = 0) {
    this.fig.position.set(x, y, z);
    this.fig.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  }

  spine(arch: number, lean: number, nod: number, tilt: number) { this.fig.setSpine(arch, lean, nod, tilt); }

  /** Arm i: upper arm raised by `raise` (0 down, π/2 out to the side, π up), tilted forward by `fwd`; elbow bent by `elbow` toward `toward`. */
  arm(i: number, raise: number, fwd: number, elbow: number, toward?: THREE.Vector3, twist = 0) {
    const s = i ? 1 : -1;
    const u = limbDir(s, raise, fwd);
    this.fig.setArm(i, u, bend(u, toward ?? V(-s * 0.4, 0.15, 1), elbow), twist);
  }

  /** Leg i hanging free: thigh spread/forward, knee bent by `knee`. */
  leg(i: number, spread: number, fwd: number, knee: number) {
    const s = i ? 1 : -1, th = limbDir(s, spread, fwd);
    this.fig.setLeg(i, th, bend(th, V(0, 0, -1), knee));
  }

  /** Leg i planted: the ankle at `x` (across), `y` (up from the neutral stance), `z` (forward) in the world frame of the clip. */
  plant(i: number, x: number, y: number, z: number) {
    const f = this.fig, s = i ? 1 : -1, H = this.hip[i]!;
    const L = this.L1 + this.L2;
    const F = V(H.x + s * x, H.y - L * 0.965 + y, z).sub(f.position).applyQuaternion(this.qi.copy(f.quaternion).invert());
    const D = F.clone().sub(H);
    const d = THREE.MathUtils.clamp(D.length(), 0.1, L * 0.999);
    D.normalize();
    const a = Math.acos(THREE.MathUtils.clamp((this.L1 * this.L1 + d * d - this.L2 * this.L2) / (2 * this.L1 * d), -1, 1));
    const pole = V(s * 0.15, 0, 1);
    const n = pole.addScaledVector(D, -pole.dot(D)).normalize();
    const u1 = D.clone().multiplyScalar(Math.cos(a)).addScaledVector(n, Math.sin(a)).normalize();
    const E = H.clone().addScaledVector(u1, this.L1);
    const u2 = F.sub(E);
    if (u2.lengthSq() < 1e-8) u2.copy(D);
    f.setLeg(i, u1, u2.normalize());
  }

  hands(a: number, b = a) { this.fig.setHand(0, a); this.fig.setHand(1, b); }
}

interface ClipDef { name: string; beats: number; samples: number; pose: (r: Rig, b: number) => void }

/** The clips. `b` runs over [0, beats); everything is periodic in it, and smooth. */
const CLIPS: ClipDef[] = [
  {
    // a relaxed groove: knees give a little on every beat, the weight goes from foot to foot over two beats,
    // the shoulders turn, the bent arms swing in opposition, the head lags the body
    name: 'groove', beats: 4, samples: 64, pose: (r, b) => {
      const dip = 0.04 * B1(b - 0.04), shift = 0.045 * S(b / 2 - 0.08);
      r.root(shift, -dip, 0, 0.16 * S(b / 4 + 0.05));
      r.spine(0.07 + 0.03 * B1(b - 0.1), -0.08 * S(b / 2 - 0.18), 0.1 + 0.09 * B1(b - 0.22), 0.06 * S(b / 2 - 0.3));
      for (const i of [0, 1]) {
        const o = i ? 0.5 : 0;
        r.arm(i, 0.32 + 0.16 * B1(b / 2 + o - 0.12), 0.5 + 0.14 * S(b / 2 + o - 0.05), 1.5 + 0.22 * B1(b - 0.18), V(-(i ? 1 : -1) * 0.5, 0.7, 1));
        r.plant(i, 0.06, 0.012 * Math.max(0, S(b / 2 + o)), i ? 0.04 : -0.02);
      }
      r.hands(0.45);
    },
  },
  {
    // hands up in a wide V, swaying together from side to side over a bar, a soft bounce
    name: 'handsup', beats: 4, samples: 64, pose: (r, b) => {
      const sw = S(b / 4), dip = 0.03 * B1(b - 0.05);
      r.root(-0.035 * sw, -dip, 0, 0.08 * S(b / 4 + 0.2));
      r.spine(-0.12, 0.11 * S(b / 4 - 0.08), -0.28 + 0.06 * B1(b - 0.2), 0.07 * S(b / 4 - 0.15));
      for (const i of [0, 1]) {
        const s = i ? 1 : -1;
        r.arm(i, 2.45 - s * 0.3 * S(b / 4 - 0.06), 0.18, 0.28 + 0.12 * B1(b - 0.15 + 0.1 * s), V(-s, 0.3, 0.6));
        r.plant(i, 0.08, 0, i ? 0.03 : -0.03);
      }
      r.hands(0.1);
    },
  },
  {
    // one hand up, waving slowly from side to side; the other loose at the waist; weight shifting
    name: 'wave', beats: 4, samples: 64, pose: (r, b) => {
      const shift = 0.04 * S(b / 2 + 0.2);
      r.root(shift, -0.03 * B1(b - 0.05), 0, -0.12 * S(b / 4));
      r.spine(0.02, -0.09 * S(b / 2 + 0.1), -0.12 + 0.06 * B1(b - 0.2), 0.08 * S(b / 4 - 0.1));
      r.arm(1, 2.62 + 0.08 * S(b / 2), 0.28, 0.32 + 0.1 * B1(b / 2), V(-0.8 * S(b / 2 - 0.08), 0.3, 1));
      r.arm(0, 0.3 + 0.1 * B1(b / 2 - 0.15), 0.3, 1.0 + 0.25 * B1(b / 2 - 0.25), V(0.6, 0.5, 1));
      for (const i of [0, 1]) r.plant(i, 0.07, 0.01 * Math.max(0, S(b / 2 + (i ? 0.5 : 0) + 0.2)), i ? -0.03 : 0.04);
      r.hands(0.6, 0.12);
    },
  },
  {
    // jumping with the crowd: down into the knees, up onto the toes with the arms rising, every two beats
    name: 'hop', beats: 2, samples: 48, pose: (r, b) => {
      const up = Math.pow(0.5 - 0.5 * C(b / 2), 1.6); // 0 at the beat, 1 a beat later
      const y = -0.075 + 0.16 * up;
      r.root(0, y, 0, 0.1 * S(b / 4 + 0.1));
      r.spine(0.16 * (1 - up) - 0.05, 0.04 * S(b / 4), 0.1 - 0.3 * up, 0.04 * S(b / 4 - 0.2));
      const arms = Math.pow(0.5 - 0.5 * C(b / 2 - 0.06), 1.3);
      for (const i of [0, 1]) {
        r.arm(i, 0.7 + 1.85 * arms, 0.42 - 0.15 * arms, 0.75 - 0.45 * arms, V(-(i ? 1 : -1) * 0.3, 0.5, 1));
        r.plant(i, 0.07, Math.max(0, y + 0.02) * 0.8, i ? 0.02 : -0.02);
        r.fig.setFoot(i, 0.5 * up);
      }
      r.hands(0.25 + 0.4 * (1 - arms));
    },
  },
  {
    // clapping overhead: the hands meet up high every two beats and open wide between
    name: 'clap', beats: 2, samples: 48, pose: (r, b) => {
      const c = Math.pow(B1(b / 2), 1.4); // 1 at the clap
      r.root(0.025 * S(b / 4), -0.035 * B1(b - 0.04), 0, 0.1 * S(b / 4 + 0.3));
      r.spine(-0.1, 0.06 * S(b / 4 - 0.1), -0.3 + 0.08 * c, 0.05 * S(b / 4));
      for (const i of [0, 1]) {
        const s = i ? 1 : -1;
        r.arm(i, 2.2 + 0.55 * c, 0.3 - 0.1 * c, 0.25 + 0.5 * c, V(-s, 0.2, 0.4));
        r.plant(i, 0.07, 0, i ? 0.02 : -0.02);
      }
      r.hands(0.05);
    },
  },
  {
    // turning slowly on the spot, arms out and flowing, a full turn every two bars
    name: 'turn', beats: 8, samples: 96, pose: (r, b) => {
      r.root(0, -0.03 * B1(b - 0.05), 0, TAU * (b / 8));
      r.spine(-0.06, 0.1 * S(b / 4), -0.15 + 0.08 * S(b / 4 + 0.2), 0.1 * S(b / 8));
      for (const i of [0, 1]) {
        const s = i ? 1 : -1;
        r.arm(i, 1.35 + 0.4 * S(b / 4 + 0.25 * s), 0.15 * S(b / 2 + s * 0.2), 0.3 + 0.25 * B1(b / 4 + 0.3 * s), V(-s * 0.2, 0.5, 1));
        r.leg(i, 0.07 + 0.03 * S(b / 4 + s * 0.25), 0.08 * S(b / 4 + s * 0.25), 0.15 + 0.1 * B1(b / 2 + s * 0.25));
      }
      r.hands(0.15);
    },
  },
  {
    // a slow sway: weight from side to side over a bar, arms loose, the head tilting with it
    name: 'sway', beats: 8, samples: 96, pose: (r, b) => {
      const sw = S(b / 8);
      r.root(0.05 * sw, -0.02 * B1(b / 2 - 0.05), 0, 0.12 * S(b / 8 + 0.15));
      r.spine(0.05, -0.1 * S(b / 8 - 0.06), 0.18 + 0.06 * S(b / 4), 0.1 * S(b / 8 - 0.12));
      for (const i of [0, 1]) {
        const s = i ? 1 : -1;
        r.arm(i, 0.22 + 0.14 * B1(b / 8 + 0.25 * s + 0.25), 0.25 + 0.08 * S(b / 4 + s * 0.2), 0.55 + 0.25 * B1(b / 4 + s * 0.3), V(-s * 0.3, 0.5, 1));
        r.plant(i, 0.05, 0.02 * Math.max(0, -s * S(b / 8 - 0.05)), i ? 0.03 : -0.02);
      }
      r.hands(0.35);
    },
  },
  {
    // floating in zero gravity: limbs drifting as if underwater, the body slowly turning and tilting
    name: 'float', beats: 16, samples: 128, pose: (r, b) => {
      const u = b / 16;
      r.root(0, 0.03 * S(u), 0, 0.35 * S(u + 0.1), 0.12 * S(u * 2 + 0.3), 0.1 * S(u - 0.2));
      r.spine(-0.04 + 0.14 * S(u), 0.07 * S(u * 2 + 0.2), 0.12 * S(u - 0.3), 0.1 * S(u + 0.4));
      for (const i of [0, 1]) {
        const s = i ? 1 : -1;
        r.arm(i, 1.0 + 0.45 * S(u + s * 0.13), 0.35 + 0.25 * S(u * 2 + s * 0.3), 0.45 + 0.35 * B1(u - 0.2 + s * 0.2), V(-s * 0.3, 0.6, 1));
        r.leg(i, 0.09 + 0.05 * S(u + s * 0.2), 0.15 + 0.3 * S(u + s * 0.25), 0.2 + 0.4 * B1(u + s * 0.25 + 0.1));
        r.fig.setFoot(i, 0.5 + 0.2 * S(u + s * 0.1));
      }
      r.hands(0.25 + 0.15 * B1(u));
    },
  },
  {
    // floating, one hand reaching slowly out and up, the other held at the chest, looking up at the hand
    name: 'reach', beats: 16, samples: 128, pose: (r, b) => {
      const u = b / 16;
      r.root(0, 0.02 * S(u), 0, 0.25 * S(u + 0.3), 0.08 * S(u * 2), 0.08 * S(u));
      r.spine(-0.14 + 0.06 * S(u), 0.1 * S(u + 0.1), -0.25 + 0.1 * S(u * 2), 0.12 * S(u - 0.1));
      r.arm(1, 2.0 + 0.45 * S(u), 0.55 + 0.2 * S(u * 2 + 0.1), 0.15 + 0.15 * B1(u * 2), V(-0.3, 0.3, 1));
      r.arm(0, 0.5 + 0.1 * S(u), 0.9, 1.6 + 0.2 * S(u + 0.3), V(1, 0.4, 0.3));
      for (const i of [0, 1]) {
        const s = i ? 1 : -1;
        r.leg(i, 0.08, 0.12 + 0.25 * S(u + s * 0.25 + 0.4), 0.25 + 0.35 * B1(u + s * 0.25));
        r.fig.setFoot(i, 0.6);
      }
      r.hands(0.15, 0.6);
    },
  },
  {
    // big and strong but round: a deep bounce, the weight thrown from side to side, arms swinging up in turn
    name: 'power', beats: 4, samples: 96, pose: (r, b) => {
      const dip = 0.09 * B1(b - 0.06), shift = 0.075 * S(b / 2 - 0.1);
      r.root(shift, -dip, 0, 0.32 * S(b / 4 + 0.05));
      r.spine(0.12 + 0.08 * B1(b - 0.12), -0.13 * S(b / 2 - 0.2), 0.12 + 0.14 * B1(b - 0.24), 0.1 * S(b / 2 - 0.3));
      for (const i of [0, 1]) {
        const s = i ? 1 : -1, o = i ? 0 : 0.5;
        const up = B1(b / 2 + o - 0.1);
        r.arm(i, 0.8 + 1.75 * up, 0.35 + 0.1 * S(b / 2 + o), 0.85 - 0.6 * up, V(-s * 0.4, 0.6, 1));
        r.plant(i, 0.12, 0.03 * Math.max(0, S(b / 2 + o + 0.25)), i ? 0.05 : -0.05);
      }
      r.hands(0.3, 0.3);
    },
  },
  {
    // arms rising overhead and opening like wings over two beats, the body rising with them
    name: 'rise', beats: 4, samples: 96, pose: (r, b) => {
      const w = Math.pow(0.5 - 0.5 * C(b / 2 - 0.05), 1.2);
      r.root(0.03 * S(b / 4), -0.07 + 0.08 * w, 0, -0.22 * S(b / 4 + 0.1));
      r.spine(0.1 - 0.25 * w, 0.08 * S(b / 4 - 0.1), 0.2 - 0.45 * w, 0.06 * S(b / 4));
      for (const i of [0, 1]) {
        const s = i ? 1 : -1;
        r.arm(i, 0.55 + 2.0 * w, 0.55 - 0.4 * w, 0.9 - 0.65 * w + 0.1 * S(b / 4 + s * 0.25), V(-s * 0.6, 0.6, 1));
        r.plant(i, 0.1, 0.02 * w, i ? 0.03 : -0.03);
        r.fig.setFoot(i, 0.25 * w);
      }
      r.hands(0.35 * (1 - w) + 0.05);
    },
  },
];

export const CLIP = Object.fromEntries(CLIPS.map((c, i) => [c.name, i])) as Record<string, number>;
export const clipBeats = (c: number) => CLIPS[c]!.beats;

const NJ = 13;

export class Motion {
  private tables: Float32Array[][] = []; // [body][clip]
  rigs: Rig[];

  /** `bodies`: one RealFigure per body kind, used to bake the clips (it is left posed). */
  constructor(bodies: RealFigure[]) {
    this.rigs = bodies.map((f) => new Rig(f));
    const js: THREE.Vector3[] = [];
    for (const rig of this.rigs) {
      const row: Float32Array[] = [];
      for (const c of CLIPS) {
        const tab = new Float32Array(c.samples * NJ * 3);
        for (let k = 0; k < c.samples; k++) {
          rig.reset();
          c.pose(rig, (k / c.samples) * c.beats);
          starJoints(rig.fig, js);
          for (let i = 0; i < NJ; i++) tab.set([js[i]!.x, js[i]!.y, js[i]!.z], (k * NJ + i) * 3);
        }
        row.push(tab);
      }
      this.tables.push(row);
    }
  }

  /**
   * THE pose function: a person's 13 joints (figure frame) at beat position `beat` (continuous; pass a
   * slowed clock to slow everyone down). Mirroring is left to `place` (cosmos-gfx).
   */
  pose(m: Mover, beat: number, out: Pose = new Float32Array(NJ * 3)): Pose {
    const c = CLIPS[m.clip]!, tab = this.tables[m.body % this.tables.length]![m.clip]!;
    const n = c.samples;
    let x = (((beat + m.off) / c.beats) % 1) * n;
    if (x < 0) x += n;
    const i1 = Math.floor(x) % n, f = x - Math.floor(x);
    const i0 = (i1 + n - 1) % n, i2 = (i1 + 1) % n, i3 = (i1 + 2) % n;
    const f2 = f * f, f3 = f2 * f;
    const w0 = -0.5 * f3 + f2 - 0.5 * f, w1 = 1.5 * f3 - 2.5 * f2 + 1, w2 = -1.5 * f3 + 2 * f2 + 0.5 * f, w3 = 0.5 * f3 - 0.5 * f2;
    const a = i0 * NJ * 3, b = i1 * NJ * 3, d = i2 * NJ * 3, e = i3 * NJ * 3;
    for (let k = 0; k < NJ * 3; k++) out[k] = w0 * tab[a + k]! + w1 * tab[b + k]! + w2 * tab[d + k]! + w3 * tab[e + k]!;
    return out;
  }

  /** Pose a RealFigure itself (at the origin, figure frame) with a clip — for figures that also get IK on top. */
  apply(rig: Rig, m: Mover, beat: number) {
    const c = CLIPS[m.clip]!;
    let b = (beat + m.off) % c.beats;
    if (b < 0) b += c.beats;
    rig.reset();
    c.pose(rig, b);
  }
}

/** a + (b − a)·w, joint by joint. */
export function blendPose(a: Pose, b: Pose, w: number, out: Pose) {
  for (let k = 0; k < a.length; k++) out[k] = a[k]! + (b[k]! - a[k]!) * w;
  return out;
}
