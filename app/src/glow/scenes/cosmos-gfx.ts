// Graphics for the drops (`cosmos`): soft flares (flashes, suns, lens streaks); a bank of procedural dance
// poses (still used by lib/galaxy.ts for its own dancers: a few invisible bodies posed once per frame per
// distinct step, joints reused for many figures); placing 13-joint poses in the world.
import * as THREE from 'three';
import { clamp } from '../../engine/util';
import { RealFigure, bend, dance, limbDir } from '../lib/people';
import { starJoints } from '../lib/stars';

export const NJ = 13; // joints per figure (lib/stars STAR_JOINTS order)
/** Joint indices (lib/stars STAR_JOINTS): body-left = +x in the figure frame. */
export const J = { head: 0, neck: 1, shL: 2, shR: 3, elL: 4, elR: 5, haL: 6, haR: 7, hip: 8, knL: 9, knR: 10, ftL: 11, ftR: 12 } as const;
const MIRROR = [0, 1, 3, 2, 5, 4, 7, 6, 8, 10, 9, 12, 11];

/**
 * Soft camera-facing glows (flashes, suns, lens streaks): per instance a world position, colour, world size
 * and a horizontal stretch (1 = round, >1 = an anamorphic streak across the screen). Additive.
 */
export class Flares extends THREE.Mesh {
  declare geometry: THREE.InstancedBufferGeometry;
  declare material: THREE.ShaderMaterial;
  private P: Float32Array; private C: Float32Array; private S: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  n = 0;

  constructor(public cap = 32) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const P = new Float32Array(cap * 3), C = new Float32Array(cap * 3), S = new Float32Array(cap * 3);
    const mk = (a: Float32Array) => new THREE.InstancedBufferAttribute(a, 3).setUsage(THREE.DynamicDrawUsage);
    const attrs = [mk(P), mk(C), mk(S)];
    g.setAttribute('iPos', attrs[0]!); g.setAttribute('iCol', attrs[1]!); g.setAttribute('iShape', attrs[2]!);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec3 iPos, iCol, iShape; // shape: size, stretch, falloff
        varying vec3 vC; varying vec2 vP; varying float vF;
        void main() {
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          if (mv.z > -0.1 || iShape.x <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0); vP = vec2(0.0); vF = 1.0; return; }
          // (stretched: a thin anamorphic streak, as wide as size × stretch)
          mv.xy += position.xy * vec2(iShape.x * iShape.y, iShape.x * min(1.0, 1.4 / iShape.y));
          vC = iCol; vP = position.xy; vF = iShape.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying vec2 vP; varying float vF;
        void main() {
          float r2 = dot(vP, vP);
          if (r2 > 1.0) discard;
          float a = exp(-r2 * vF) + 0.22 * exp(-sqrt(r2) * vF * 0.55);
          a *= 1.0 - smoothstep(0.55, 1.0, r2);
          gl_FragColor = vec4(vC * a, 1.0);
        }`,
    });
    super(g, mat);
    this.P = P; this.C = C; this.S = S; this.attrs = attrs;
    this.frustumCulled = false;
    this.renderOrder = 20;
  }

  begin() { this.n = 0; }

  glow(p: THREE.Vector3Like, c: THREE.Color, k: number, size: number, stretch = 1, fall = 5) {
    if (this.n >= this.cap || k <= 0.001 || size <= 0) return;
    const i = this.n++;
    this.P.set([p.x, p.y, p.z], i * 3);
    this.C.set([c.r * k, c.g * k, c.b * k], i * 3);
    this.S.set([size, stretch, fall], i * 3);
  }

  end() {
    this.geometry.instanceCount = this.n;
    for (const a of this.attrs) a.needsUpdate = true;
  }
}

// ---- poses ----

/** A posed body's joints in the figure frame (pelvis origin, +y up, facing +z), 13 × xyz. */
export type Pose = Float32Array;

/** Extra steps on top of lib/people `dance` (0 pump, 1 wave, 2 jump, 3 point): 4 clap overhead, 5 star jump. */
export const CLAP = 4, STARJUMP = 5, HOLD = 6;

/**
 * Poses shared by many figures within a frame. `get` poses one of the invisible bodies for a step and caches
 * its joints until the next `begin()`; keep the number of distinct (body, step, beat, seed) per frame small.
 */
export class PoseBank {
  private cache = new Map<string, Pose>();
  private js: THREE.Vector3[] = [];
  posed = 0;

  constructor(public bodies: RealFigure[]) {}

  begin() { this.cache.clear(); this.posed = 0; }

  /** Pose for continuous beat position `beat` in `style`, `energy` 0..1; `open` (HOLD only) 0..1. */
  get(body: number, beat: number, style: number, energy = 1, seed = 0, open = 1): Pose {
    const key = `${body}|${style}|${Math.round(beat * 500)}|${Math.round(energy * 50)}|${seed}|${Math.round(open * 50)}`;
    let p = this.cache.get(key);
    if (p) return p;
    const fig = this.bodies[body % this.bodies.length]!;
    fig.position.set(0, 0, 0);
    fig.quaternion.identity();
    for (const i of [0, 1]) fig.setFoot(i, 0);
    let bounce = 0;
    if (style < 4) bounce = dance(fig, beat, style, energy, seed);
    else bounce = step(fig, beat, style, energy, seed, open);
    starJoints(fig, this.js);
    p = new Float32Array(NJ * 3);
    for (let i = 0; i < NJ; i++) { const v = this.js[i]!; p[i * 3] = v.x; p[i * 3 + 1] = v.y + bounce; p[i * 3 + 2] = v.z; }
    this.cache.set(key, p);
    this.posed++;
    return p;
  }
}

/** The extra steps (clap overhead, star jump, holding hands out to the sides). */
function step(fig: RealFigure, beat: number, style: number, energy: number, seed: number, open: number): number {
  const b = Math.floor(beat), ph = beat - b;
  const hit = Math.exp(-ph * 7);
  const sw = Math.sin((beat + seed) * Math.PI * 0.5);
  const e = energy;
  const arm = (i: number, raise: number, fwd: number, elbow: number, twist = 0, toward = new THREE.Vector3(-(i ? 1 : -1) * 0.4, 0.1, 1)) => {
    const s = i ? 1 : -1, u = limbDir(s, raise, fwd);
    fig.setArm(i, u, bend(u, toward, elbow), twist);
  };
  const leg = (i: number, spread: number, fwd: number, knee: number) => {
    const s = i ? 1 : -1, th = limbDir(s, spread, fwd);
    fig.setLeg(i, th, bend(th, new THREE.Vector3(0, 0, -1), knee));
  };
  let bounce = 0;
  if (style === CLAP) {
    // hands meet overhead on the beat, open to a wide V between beats
    const c = Math.pow(Math.max(0, Math.cos(ph * Math.PI * 2)), 2) * e; // 1 on the beat
    for (const i of [0, 1]) arm(i, 2.35 + 0.55 * c, 0.15 + 0.1 * c, 0.15 + 0.5 * c, 0, new THREE.Vector3(-(i ? 1 : -1), 0.2, 0.3));
    for (const i of [0, 1]) leg(i, 0.07, 0.04, 0.15 * hit * e);
    fig.setSpine(-0.12 * e, 0.05 * sw, -0.3 + 0.1 * c, 0.08 * sw);
    bounce = -0.05 * hit * e;
  } else if (style === STARJUMP) {
    // an X on the beat (a five-pointed star: head, two hands, two feet), closing between beats
    const x = (0.25 + 0.75 * Math.pow(Math.max(0, Math.cos(ph * Math.PI)), 1.5)) * e + (1 - e) * 0.6;
    for (const i of [0, 1]) arm(i, 0.35 + 2.0 * x, 0.08, 0.1 + 0.25 * (1 - x));
    for (const i of [0, 1]) leg(i, 0.06 + 0.42 * x, 0.02, 0.35 * (1 - x));
    for (const i of [0, 1]) fig.setFoot(i, 0.6 * x);
    fig.setSpine(-0.1 * x, 0.03 * sw, -0.15 - 0.15 * x, 0);
    bounce = 0.22 * Math.sin(Math.PI * clamp(1 - ph * 1.6)) * e;
  } else {
    // HOLD: holding the neighbours' hands, arms open to the sides; the joined hands swing up together on
    // every other beat (a crowd's "hands up"), a sway and a knee bounce in between
    const o = open;
    const up = Math.pow(Math.max(0, Math.cos((beat / 2 - Math.floor(beat / 2)) * Math.PI * 2)), 3) * e; // 1 on even beats
    for (const i of [0, 1]) arm(i, 0.35 + o * (0.85 + 0.75 * up) + 0.07 * sw * (i ? 1 : -1), 0.15, 0.45 - 0.25 * o, 0, new THREE.Vector3(-(i ? 1 : -1) * 0.3, 0.7, 1));
    for (const i of [0, 1]) leg(i, 0.07 + 0.02 * (i ? sw : -sw), 0.04, 0.3 * hit * e);
    fig.setSpine(-0.08 - 0.08 * up, 0.12 * sw * e, -0.15 - 0.15 * up, 0.12 * sw * e);
    bounce = -0.07 * hit * e + 0.04 * up;
  }
  for (const i of [0, 1]) fig.setHand(i, style === CLAP ? 0.05 : 0.2);
  return bounce;
}

// ---- placing poses in the world ----

const _v = new THREE.Vector3();

/** World joints of a pose: p = pos + q · (s · joint), mirrored left/right if asked. */
export function place(pose: Pose, pos: THREE.Vector3Like, q: THREE.Quaternion, s: number, mirror = false, out: THREE.Vector3[] = []): THREE.Vector3[] {
  for (let i = 0; i < NJ; i++) {
    const src = mirror ? MIRROR[i]! : i;
    const v = out[i] ?? (out[i] = new THREE.Vector3());
    v.set((mirror ? -1 : 1) * pose[src * 3]!, pose[src * 3 + 1]!, pose[src * 3 + 2]!).multiplyScalar(s).applyQuaternion(q);
    v.x += pos.x; v.y += pos.y; v.z += pos.z;
  }
  return out;
}

/** Quaternion of a figure frame with its up along `up` and its front toward `front` (orthogonalised). */
export function frame(up: THREE.Vector3Like, front: THREE.Vector3Like, out = new THREE.Quaternion()) {
  const y = new THREE.Vector3(up.x, up.y, up.z).normalize();
  const z = _v.set(front.x, front.y, front.z);
  z.addScaledVector(y, -z.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
