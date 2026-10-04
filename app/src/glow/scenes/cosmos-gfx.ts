// Graphics for the drops (`cosmos`): star-figures drawn in one batch at any scale (a star on each joint,
// glowing lines with a pixel floor so tiny far figures stay smooth and giants stay crisp), soft flares
// (flashes, suns, lens streaks), and a bank of dance poses: a few invisible realistic bodies are posed once
// per frame per distinct step and their joints reused (mirrored, scaled, turned) for hundreds of figures.
import * as THREE from 'three';
import { SCALE } from '../../engine/gl';
import { clamp } from '../../engine/util';
import { RealFigure, bend, dance, limbDir } from '../lib/people';
import { starJoints, STAR_EDGES } from '../lib/stars';
import { GlowPoints } from '../lib/points';

export const NJ = 13; // joints per figure (lib/stars STAR_JOINTS order)
/** Joint indices (lib/stars STAR_JOINTS): body-left = +x in the figure frame. */
export const J = { head: 0, neck: 1, shL: 2, shR: 3, elL: 4, elR: 5, haL: 6, haR: 7, hip: 8, knL: 9, knR: 10, ftL: 11, ftR: 12 } as const;
const MIRROR = [0, 1, 3, 2, 5, 4, 7, 6, 8, 10, 9, 12, 11];

/**
 * Instanced glowing segments with a per-segment world half-width and a floor in pixels (a line thinner than
 * the floor is drawn at the floor and dimmed instead, so far figures don't shimmer). Segments crossing the
 * near plane are clipped. Additive.
 */
export class StarLines extends THREE.Mesh {
  declare geometry: THREE.InstancedBufferGeometry;
  declare material: THREE.ShaderMaterial;
  private A: Float32Array; private B: Float32Array; private C: Float32Array; private Wd: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  n = 0;

  constructor(public cap: number, minPx = 0.6) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const A = new Float32Array(cap * 3), B = new Float32Array(cap * 3), C = new Float32Array(cap * 3), Wd = new Float32Array(cap);
    const mk = (a: Float32Array, k: number) => new THREE.InstancedBufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    const attrs = [mk(A, 3), mk(B, 3), mk(C, 3), mk(Wd, 1)];
    g.setAttribute('aA', attrs[0]!); g.setAttribute('aB', attrs[1]!); g.setAttribute('aC', attrs[2]!); g.setAttribute('aW', attrs[3]!);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { pxScale: { value: (1080 * SCALE) / 2 }, minPx: { value: minPx * SCALE }, fogDensity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aA, aB, aC; attribute float aW;
        uniform float pxScale, minPx, fogDensity;
        varying vec3 vC; varying float vS;
        void main() {
          vec4 a = modelViewMatrix * vec4(aA, 1.0), b = modelViewMatrix * vec4(aB, 1.0);
          const float NZ = 0.06;
          if ((a.z > -NZ && b.z > -NZ) || aW <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0); vS = 0.0; return; }
          if (a.z > -NZ) a = mix(a, b, (a.z + NZ) / (a.z - b.z));
          if (b.z > -NZ) b = mix(b, a, (b.z + NZ) / (b.z - a.z));
          vec4 p = mix(a, b, position.x);
          vec3 d = b.xyz - a.xyz; float dl = length(d);
          vec3 dir = dl > 1e-6 ? d / dl : vec3(1.0, 0.0, 0.0);
          vec3 sd = cross(dir, normalize(-p.xyz)); float sl = length(sd);
          sd = sl > 1e-6 ? sd / sl : vec3(0.0, 1.0, 0.0);
          float depth = max(-p.z, NZ);
          float px = aW * projectionMatrix[1][1] * pxScale / depth;
          float w = aW, dim = 1.0;
          if (px < minPx) { w = aW * minPx / max(px, 1e-4); dim = px / minPx; }
          p.xyz += sd * position.y * w;
          vC = aC * dim * exp(-fogDensity * fogDensity * depth * depth);
          vS = position.y;
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vS;
        void main() { float k = exp(-vS * vS * 6.0) + 0.35 * exp(-vS * vS * 1.2); gl_FragColor = vec4(vC * k, 1.0); }`,
    });
    super(g, mat);
    this.A = A; this.B = B; this.C = C; this.Wd = Wd; this.attrs = attrs;
    this.frustumCulled = false;
  }

  begin() { this.n = 0; }

  seg(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Color, k: number, w: number) {
    if (this.n >= this.cap || k <= 0) return;
    const i = this.n++;
    this.A[i * 3] = a.x; this.A[i * 3 + 1] = a.y; this.A[i * 3 + 2] = a.z;
    this.B[i * 3] = b.x; this.B[i * 3 + 1] = b.y; this.B[i * 3 + 2] = b.z;
    this.C[i * 3] = c.r * k; this.C[i * 3 + 1] = c.g * k; this.C[i * 3 + 2] = c.b * k;
    this.Wd[i] = w;
  }

  end() {
    this.geometry.instanceCount = this.n;
    for (const a of this.attrs) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); }
  }
}

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

/** Per-figure look for FigureBatch.figure. */
export interface FigLook { star: THREE.Color; line: THREE.Color; k: number; lineK?: number; draw?: number }

/** Every star-figure of a frame: stars on the joints (GlowPoints) and the limbs (StarLines), one draw each. */
export class FigureBatch extends THREE.Group {
  points: GlowPoints;
  lines: StarLines;
  np = 0;
  private tmp = new THREE.Vector3();

  constructor(maxPoints: number, maxLines: number) {
    super();
    this.points = new GlowPoints(maxPoints, 1);
    this.lines = new StarLines(maxLines, 0.55);
    this.points.renderOrder = 4;
    this.lines.renderOrder = 3;
    this.add(this.lines, this.points);
  }

  begin() { this.np = 0; this.lines.begin(); }

  /**
   * One figure from world joints `j`; `s` is its scale (1 = a person), which sets star size and line width.
   * `draw` (0..1) reveals the limbs in order.
   */
  figure(j: THREE.Vector3[], s: number, L: FigLook) {
    const k = L.k;
    if (k <= 0.002) return;
    const lk = (L.lineK ?? 1) * k, draw = L.draw ?? 1;
    for (let i = 0; i < NJ; i++) {
      const p = j[i]!;
      this.star(p, L.star, k, s * 0.085 * (i === 0 ? 1.7 : i === 6 || i === 7 ? 1.3 : i === 8 ? 1.15 : 1));
    }
    const shown = draw * STAR_EDGES.length;
    for (let e = 0; e < STAR_EDGES.length; e++) {
      const u = clamp(shown - e);
      if (u <= 0) break;
      const [a, b] = STAR_EDGES[e]!;
      const pb = u < 1 ? this.tmp.copy(j[a]!).lerp(j[b]!, u) : j[b]!;
      this.lines.seg(j[a]!, pb, L.line, lk, s * 0.011);
    }
  }

  star(p: THREE.Vector3Like, c: THREE.Color, k: number, size: number) {
    if (this.np >= this.points.n || k <= 0.002) return;
    this.points.set(this.np++, p.x, p.y, p.z, c, k, size);
  }

  end() {
    this.points.commit(this.np);
    this.lines.end();
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

/** A ring of light (circle of segments) of radius r about `c` in the plane with normal `n`. */
export function ring(L: StarLines, c: THREE.Vector3, n: THREE.Vector3, r: number, col: THREE.Color, k: number, w: number, segs = 72, wobble = 0, seed = 0) {
  if (r <= 0 || k <= 0.002) return;
  const nn = n.clone().normalize();
  const a = Math.abs(nn.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(nn, a).normalize(), v = new THREE.Vector3().crossVectors(nn, u);
  let prev = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const th = (i / segs) * Math.PI * 2;
    const rr = r * (1 + wobble * Math.sin(th * 7 + seed) * 0.5 + wobble * Math.sin(th * 13 - seed * 2) * 0.3);
    const p = c.clone().addScaledVector(u, Math.cos(th) * rr).addScaledVector(v, Math.sin(th) * rr);
    if (i > 0) L.seg(prev, p, col, k, w);
    prev = p;
  }
}
