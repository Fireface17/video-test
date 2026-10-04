// People in the `train` scene: passengers as see-through ghosts lit only by their phone screens, who turn into
// people of light (passengerMaterial: ghost → glow); real motion capture played as a schedule of cues with
// crossfades (seated loops, standing up, the very-happy arms, the run), each figure turned so the clip's own
// facing lands where it should; limbs overridden on top (a phone held up, a hand on a strap, arms raised).
import * as THREE from 'three';
import { RealFigure } from '../lib/people';
import { applyLayers, type Layer, type Motion } from '../lib/motion';
import { clamp, noise1 } from '../../engine/util';

const SKIN_VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  #include <fog_pars_vertex>
  varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vWN;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 w = modelMatrix * vec4(transformed, 1.0);
    vW = w.xyz;
    vWN = normalize(mat3(modelMatrix) * objectNormal);
    vec4 mvPosition = viewMatrix * w;
    vN = normalMatrix * objectNormal; vV = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

/**
 * A passenger: a ghost (faint body, pale rim) whose face and hands catch the blue light of the phone at `phone`
 * (xyz, w = brightness); `lit` 0..1 turns them into a person of light in `glow` (light rising through the body
 * in bands, a bright rim, glints). Additive; `level` scales everything.
 */
export function passengerMaterial(ghost: THREE.Color, glow: THREE.Color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      color: { value: ghost.clone() }, glow: { value: glow.clone() }, lit: { value: 0 }, level: { value: 1 }, time: { value: 0 },
      phone: { value: new THREE.Vector4(0, -100, 0, 0) }, phoneC: { value: new THREE.Color(0.55, 0.75, 1.0) },
      fill: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: SKIN_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 color, glow, phoneC, fill; uniform float lit, level, time; uniform vec4 phone;
      varying vec3 vN; varying vec3 vV; varying vec3 vW; varying vec3 vWN;
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n3(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      void main() {
        float ln = length(vN), lv = length(vV);
        vec3 n = ln > 1e-5 ? vN / ln : vec3(0.0, 0.0, 1.0), v = lv > 1e-5 ? vV / lv : vec3(0.0, 0.0, 1.0);
        float f = clamp(abs(dot(n, v)), 0.0, 1.0), rim = 1.0 - f;
        // the ghost, lit by its phone (and a little by the car)
        vec3 g = color * (0.05 + 0.3 * pow(rim, 1.5) + 0.8 * pow(rim, 4.0));
        vec3 wn = normalize(vWN);
        vec3 d = phone.xyz - vW; float dd = dot(d, d);
        float pl = phone.w * 0.03 / (0.02 + dd) * (max(dot(wn, d * inversesqrt(max(dd, 1e-5))), 0.0) * 0.9 + 0.1);
        g += phoneC * pl * (0.35 + 0.65 * f);
        g += fill * (0.3 + 0.7 * rim);
        // the person of light
        float lum = max(glow.r, max(glow.g, glow.b));
        float flow = n3(vec3(vW.x * 3.0, vW.y * 2.2 - time * 1.1, vW.z * 3.0));
        float bands = smoothstep(0.55, 0.9, flow);
        float glint = step(0.985, h3(floor(vW * 90.0) + floor(time * 8.0))) * f;
        float r2 = rim * rim, r4 = r2 * r2;
        vec3 L = glow * (0.07 + 0.35 * bands + 0.9 * r2 + 2.2 * r4 * r2) + mix(glow, vec3(lum), 0.6) * 1.6 * r4 * r4 + vec3(lum) * (0.12 * pow(f, 8.0) + 1.5 * glint);
        gl_FragColor = vec4(mix(g, L, lit) * level, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------------------------------------- lighter bodies

interface Decimated { meshes: { pos: Float32Array; nor: Float32Array; rep: Int32Array; index: Uint32Array }[]; count: number }

/** Cluster each skinned mesh's vertices on a grid in bind space (`cell` m), keeping one member's skinning. */
function decimate(fig: RealFigure, cell: number, hair: number): Decimated {
  const out: Decimated = { meshes: [], count: 0 };
  fig.updateMatrixWorld(true);
  for (const m of fig.meshes) {
    const g = m.geometry, pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
    const toW = new THREE.Matrix4().multiplyMatrices(m.matrixWorld, m.bindMatrixInverse).multiply(m.bindMatrix);
    const sc = new THREE.Vector3().setFromMatrixScale(toW).x || 1;
    const c = cell / sc;
    const key = new Map<string, number>();
    const cl: number[] = [];
    const sums: number[][] = [];
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.floor(pos.getX(i) / c)},${Math.floor(pos.getY(i) / c)},${Math.floor(pos.getZ(i) / c)}`;
      let id = key.get(k);
      if (id === undefined) { id = sums.length; key.set(k, id); sums.push([0, 0, 0, 0, 0, 0, 0, i]); }
      const S = sums[id]!;
      S[0]! += pos.getX(i); S[1]! += pos.getY(i); S[2]! += pos.getZ(i);
      S[3]! += nor.getX(i); S[4]! += nor.getY(i); S[5]! += nor.getZ(i); S[6]! += 1;
      cl.push(id);
    }
    const n = sums.length;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), R = new Int32Array(n);
    sums.forEach((S, j) => {
      P.set([S[0]! / S[6]!, S[1]! / S[6]!, S[2]! / S[6]!], j * 3);
      const l = Math.hypot(S[3]!, S[4]!, S[5]!) || 1;
      N.set([S[3]! / l, S[4]! / l, S[5]! / l], j * 3);
      R[j] = S[7]!;
    });
    const idx: number[] = [];
    const src = g.index;
    const tri = src ? src.count : pos.count;
    const seen = new Set<string>();
    for (let t = 0; t < tri; t += 3) {
      const a = cl[src ? src.getX(t) : t]!, b = cl[src ? src.getX(t + 1) : t + 1]!, d = cl[src ? src.getX(t + 2) : t + 2]!;
      if (a === b || b === d || a === d) continue;
      const k = [a, b, d].sort((x, y) => x - y).join(',');
      if (seen.has(k)) continue;
      seen.add(k);
      idx.push(a, b, d);
    }
    if (hair < 1) shrinkHair(m, P, R, sc, hair);
    out.meshes.push({ pos: P, nor: N, rep: R, index: new Uint32Array(idx) });
    out.count += n;
  }
  return out;
}

/** Give a live figure lighter skinned meshes (new geometries; the shared model is untouched). */
export function lighten(fig: RealFigure, cell = 0.012, hair = 1) {
  const dec = decimate(fig, cell, hair);
  fig.meshes.forEach((m, mi) => {
    const D = dec.meshes[mi]!, src = m.geometry;
    const si = src.attributes.skinIndex as THREE.BufferAttribute, sw = src.attributes.skinWeight as THREE.BufferAttribute;
    const SI = new Uint16Array(D.rep.length * 4), SW = new Float32Array(D.rep.length * 4);
    D.rep.forEach((i, j) => { for (let k = 0; k < 4; k++) { SI[j * 4 + k] = si.getComponent(i, k); SW[j * 4 + k] = sw.getComponent(i, k); } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(D.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(D.nor, 3));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    g.setIndex(new THREE.BufferAttribute(D.index, 1));
    for (const o of m.parent!.children) if ((o as THREE.SkinnedMesh).geometry === src) (o as THREE.SkinnedMesh).geometry = g;
  });
  return dec.count;
}

/** Pull Michelle's big hair buns back toward the skull (bind space), so she reads as a person with her hair up. */
function shrinkHair(m: THREE.SkinnedMesh, P: Float32Array, R: Int32Array, sc: number, k: number) {
  const names = m.skeleton.bones.map((b) => b.name.replace(/^mixamorig:?/, ''));
  const hi = names.indexOf('Head'), ti = names.indexOf('HeadTop_End');
  if (hi < 0 || ti < 0) return;
  const si = m.geometry.attributes.skinIndex as THREE.BufferAttribute, sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
  const headW = (i: number) => { let w = 0; for (let q = 0; q < 4; q++) { const b = si.getComponent(i, q); if (b === hi || b === ti) w += sw.getComponent(i, q); } return w; };
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let j = 0; j < R.length; j++) {
    if (headW(R[j]!) < 0.9) continue;
    for (let q = 0; q < 3; q++) { mn[q] = Math.min(mn[q]!, P[j * 3 + q]!); mx[q] = Math.max(mx[q]!, P[j * 3 + q]!); }
  }
  if (mn[0]! > mx[0]!) return;
  const c = new THREE.Vector3((mn[0]! + mx[0]!) / 2, mn[1]! + 0.13 / sc, (mn[2]! + mx[2]!) / 2);
  const r0 = 0.125 / sc, v = new THREE.Vector3();
  for (let j = 0; j < R.length; j++) {
    if (headW(R[j]!) < 0.6) continue;
    v.fromArray(P, j * 3).sub(c);
    const d = v.length();
    if (d <= r0) continue;
    v.multiplyScalar((r0 + (d - r0) * k) / d).add(c);
    P[j * 3] = v.x; P[j * 3 + 1] = v.y; P[j * 3 + 2] = v.z;
  }
}

/** The depth-prepass twins of a figure's meshes (for see-through ghosts they are switched off). */
export function prepassMeshes(fig: RealFigure) {
  const out: THREE.Object3D[] = [];
  fig.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && (o as THREE.Mesh).material !== fig.mat) out.push(o); });
  return out;
}

// ------------------------------------------------------------------------------------------------- motion cues

export const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

/** Which way a clip faces (yaw, 0 = +z) over clip times [t0, t1] on this body, mirrored or not. */
export function clipFacing(fig: RealFigure, m: Motion, t0: number, t1: number, mirror: boolean, loop: boolean) {
  const save = { p: fig.position.clone(), q: fig.quaternion.clone() };
  fig.position.set(0, 0, 0); fig.quaternion.identity();
  let sx = 0, sz = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    applyLayers(fig, [{ m, t: t0 + ((t1 - t0) * (i + 0.5)) / 6, mirror, loop }]);
    fig.updateMatrixWorld(true);
    fig.bone('LeftUpLeg').getWorldPosition(a);
    fig.bone('RightUpLeg').getWorldPosition(b);
    const lx = a.x - b.x, lz = a.z - b.z; // the body's left; facing = left × up
    sx += -lz; sz += lx;
  }
  fig.position.copy(save.p); fig.quaternion.copy(save.q);
  fig.setMocap(null);
  return Math.atan2(sx, sz);
}

/** A clip taking over at song time `from` (crossfading over `fade` s), playing from clip time `at`. */
export interface Cue { m: Motion; from: number; at: number; speed?: number; mirror?: boolean; loop?: boolean; fade?: number; yaw0: number }

/**
 * Pose `fig` from its cues at song time t; returns the effective facing of the blend (to subtract from the
 * figure's yaw). Cues sorted by `from`.
 */
export function playCues(fig: RealFigure, cues: Cue[], t: number): number {
  let i = 0;
  for (let k = 0; k < cues.length; k++) if (cues[k]!.from <= t) i = k;
  const ct = (c: Cue) => c.at + (t - c.from) * (c.speed ?? 1);
  const cur = cues[i]!;
  const layers: Layer[] = [{ m: cur.m, t: ct(cur), loop: cur.loop ?? true, mirror: cur.mirror, w: 1 }];
  let yaw = cur.yaw0;
  if (i > 0) {
    const w = clamp((t - cur.from) / (cur.fade ?? 0.4));
    const e = w * w * (3 - 2 * w);
    if (e < 1) {
      const prev = cues[i - 1]!;
      layers[0]!.w = e;
      layers.unshift({ m: prev.m, t: ct(prev), loop: prev.loop ?? true, mirror: prev.mirror, w: 1 - e });
      yaw = lerpAngle(prev.yaw0, cur.yaw0, e);
    }
  }
  applyLayers(fig, layers);
  return yaw;
}

const SIDE = ['Right', 'Left'] as const;

/**
 * Move hand `i` from where the motion capture has it toward `target` (world) by k (0..1) with IK, the elbow
 * bending the way the captured arm bends (blended toward `pole` (world) as k grows).
 */
export function blendReach(fig: RealFigure, i: number, target: THREE.Vector3, k: number, pole?: THREE.Vector3) {
  if (k <= 1e-3) return;
  const hand = fig.hand(i);
  const sh = fig.bone(`${SIDE[i]}Arm`).getWorldPosition(new THREE.Vector3());
  const el = fig.bone(`${SIDE[i]}ForeArm`).getWorldPosition(new THREE.Vector3());
  const mid = sh.clone().add(hand).multiplyScalar(0.5);
  const pw = el.sub(mid);
  if (pw.lengthSq() < 1e-6) pw.set(i ? 1 : -1, -0.3, -0.5);
  pw.normalize();
  if (pole) pw.lerp(pole.clone().normalize(), k).normalize();
  const tgt = hand.clone().lerp(target, k);
  // the pole is read in the spine frame: near enough the figure's own frame
  const qi = fig.getWorldQuaternion(new THREE.Quaternion()).invert();
  fig.reach(i, tgt, pw.applyQuaternion(qi));
}

/** World direction the figure faces (yaw) and its up. */
export function facingDir(fig: RealFigure, out = new THREE.Vector3()) {
  return out.set(0, 0, 1).applyQuaternion(fig.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
}

// ------------------------------------------------------------------------------------------------- props

/** A phone: dark slab with a glowing screen; place with `hold(handPos, facePos, k)`. */
export class Phone extends THREE.Group {
  screen: THREE.MeshBasicMaterial;
  constructor() {
    super();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.148, 0.009), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.006, 0.008) }));
    this.screen = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.75, 1.0) });
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.136), this.screen);
    s.position.z = 0.0048;
    this.add(body, s);
  }
  /** Screen toward `face`, long side roughly up; `k` screen brightness. */
  hold(hand: THREE.Vector3, face: THREE.Vector3, k: number, t: number, seed: number) {
    const n = face.clone().sub(hand).normalize();
    this.position.copy(hand).addScaledVector(n, 0.03);
    const up = new THREE.Vector3(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, n).normalize();
    const y = new THREE.Vector3().crossVectors(n, x).normalize();
    this.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
    // scrolling: the screen brightness wavers a little
    const fl = 0.85 + 0.15 * noise1(t * 1.7 + seed, 5);
    this.screen.color.setRGB(0.55, 0.75, 1.0).multiplyScalar(0.15 + 2.2 * k * fl);
    return this.position;
  }
}

/** Headphones: a band over the head and two cups, following the head bone. */
export class Headphones extends THREE.Group {
  private restQ = new THREE.Quaternion();
  private off = new THREE.Vector3();
  constructor(private fig: RealFigure, mat: THREE.Material) {
    super();
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 6, 20, Math.PI), mat);
    band.position.y = 0.0;
    const cupG = new THREE.CylinderGeometry(0.045, 0.045, 0.035, 14);
    cupG.rotateZ(Math.PI / 2);
    const a = new THREE.Mesh(cupG, mat), b = new THREE.Mesh(cupG, mat);
    a.position.set(-0.098, -0.035, 0); b.position.set(0.098, -0.035, 0);
    this.add(band, a, b);
    // rest: the head bone's world rotation and the head centre relative to it, with the figure at identity
    const save = { p: fig.position.clone(), q: fig.quaternion.clone() };
    fig.position.set(0, 0, 0); fig.quaternion.identity();
    fig.setMocap(null);
    fig.updateMatrixWorld(true);
    const hb = fig.bone('Head');
    hb.getWorldQuaternion(this.restQ);
    const hp = fig.headPoint();
    this.off.copy(hp).add(new THREE.Vector3(0, 0.05, -0.01)).sub(hb.getWorldPosition(new THREE.Vector3())).applyQuaternion(this.restQ.clone().invert());
    fig.position.copy(save.p); fig.quaternion.copy(save.q);
  }
  /** Follow the head (world). */
  follow() {
    const hb = this.fig.bone('Head');
    const q = hb.getWorldQuaternion(new THREE.Quaternion());
    const rel = q.clone().multiply(this.restQ.clone().invert());
    this.quaternion.copy(rel);
    this.position.copy(this.off).applyQuaternion(q).add(hb.getWorldPosition(new THREE.Vector3()));
  }
}
