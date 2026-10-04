// People for the `ghosts` scene: realistic bodies (lib/people.ts) as translucent ghosts that turn into people of
// light. The crowd is baked: each body is posed three times (a lonely pose, a "linked" pose holding hands with the
// neighbours, the same with the joined hands raised) into one geometry with three vertex sets, and the instanced
// shader morphs between them per instance (each arm separately, so a person can reach first with one hand), while
// the warmth flows in from the hand that took the light. The friends are live RealFigures with a skinned twin of
// the same shader.
import * as THREE from 'three';
import { RealFigure, bend, limbDir, type BodyKind } from '../lib/people';
import { GLSL_WORLD, type WorldU } from './ghosts-gfx';

/** Where a linked person's hands are (floor coordinates of the figure: x to its left, y up, z forward). */
export const LINK = { x: 0.54, y: 0.98, z: 0.12 };
/** The same, joined hands raised. */
export const RAISE = { x: 0.53, y: 1.78, z: 0.17 };
/** Distance between neighbours in a chain (their hands meet in the middle). */
export const SPACING = LINK.x * 2;

export type Lonely = 'stand' | 'crossed' | 'phone' | 'pockets' | 'hug' | 'down';
export const LONELY: Lonely[] = ['stand', 'crossed', 'phone', 'pockets', 'hug', 'down'];

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** World point of a figure-frame point given in floor coordinates (origin between the feet). */
export function floorPt(f: RealFigure, x: number, y: number, z: number, out = new THREE.Vector3()) {
  f.updateMatrixWorld(true);
  return f.localToWorld(out.set(x, y - f.hipHeight, z));
}

/** Weight on leg `stand` (0 = -x, 1 = +x), the other knee softly bent. */
export function restLegs(f: RealFigure, stand: number, relax = 1) {
  for (const i of [0, 1]) {
    const s = i ? 1 : -1;
    if (i === stand) {
      const u = limbDir(s, 0.015, 0.0);
      f.setLeg(i, u, u);
    } else {
      const u = limbDir(s, 0.075 + 0.03 * relax, 0.1 * relax);
      f.setLeg(i, u, bend(u, V(0, 0, -1), 0.24 * relax));
      f.setFoot(i, 0.12 * relax);
    }
  }
}

function hang(f: RealFigure, i: number, raise: number, fwd: number, elbow: number, twist = 0) {
  const s = i ? 1 : -1;
  const u = limbDir(s, raise, fwd);
  f.setArm(i, u, bend(u, V(-s * 0.15, 0, 1), elbow), twist);
}

/**
 * A lonely pose (no one around them): `v` 0..1 varies it. The figure's transform must already be set.
 * Returns the phone (floor coordinates of the figure, screen centre and normal) for the phone pose.
 */
export interface LonelyPose { phone: { p: THREE.Vector3; n: THREE.Vector3 } | null; spine: [number, number, number, number]; stand: number; relax: number }

export function poseLonely(f: RealFigure, kind: Lonely, v = 0.5, legs = true): LonelyPose {
  const hip = f.hipHeight, a = v - 0.5;
  const stand = v > 0.5 ? 1 : 0, relax = kind === 'crossed' || kind === 'down' ? 0.4 : 1;
  const reach = (i: number, x: number, y: number, z: number, pole: THREE.Vector3) => f.reach(i, floorPt(f, x, y, z), pole);
  if (legs) restLegs(f, stand, relax);
  let phone: { p: THREE.Vector3; n: THREE.Vector3 } | null = null;
  let spine: [number, number, number, number] = [0, 0, 0, 0];
  const setSpine = (...s: [number, number, number, number]) => { spine = s; f.setSpine(...s); };
  switch (kind) {
    case 'stand':
      setSpine(0.05, 0.04 * Math.sign(a), 0.22 + 0.2 * Math.abs(a), 0.12 * a);
      hang(f, 0, 0.1 + 0.06 * a, 0.04, 0.3);
      hang(f, 1, 0.12 - 0.05 * a, 0.08, 0.4);
      f.setHand(0, 0.35); f.setHand(1, 0.45);
      break;
    case 'crossed':
      setSpine(0.0, 0.03 * a, 0.12 + 0.15 * v, 0.1 * a);
      reach(0, 0.15, hip + 0.29, 0.15, V(-0.6, -1, -0.25));
      reach(1, -0.14, hip + 0.33, 0.13, V(0.6, -1, -0.25));
      f.setHand(0, 0.45); f.setHand(1, 0.55);
      break;
    case 'phone': {
      setSpine(0.08, 0.02 * a, 0.62, 0.06);
      const p = V(-0.02 + 0.03 * a, hip + 0.37, 0.3);
      reach(0, p.x - 0.055, p.y - 0.03, p.z - 0.01, V(-0.5, -1, -0.4));
      if (v > 0.35) reach(1, p.x + 0.055, p.y - 0.035, p.z - 0.015, V(0.5, -1, -0.4));
      else hang(f, 1, 0.12, 0.08, 0.35);
      f.setHand(0, 0.5); f.setHand(1, v > 0.35 ? 0.5 : 0.35);
      // the screen faces the eyes
      f.updateMatrixWorld(true);
      const head = f.worldToLocal(f.headPoint()).add(V(0, hip, 0));
      phone = { p: p.clone().add(V(0, 0.02, 0.01)), n: head.clone().sub(p).normalize() };
      break;
    }
    case 'pockets':
      setSpine(-0.02, -0.05 * Math.sign(a), 0.14 + 0.1 * v, -0.12 * a);
      reach(0, -0.17, hip - 0.05, 0.08, V(-1, -0.2, -0.8));
      reach(1, 0.17, hip - 0.05, 0.08, V(1, -0.2, -0.8));
      f.setHand(0, 0.75); f.setHand(1, 0.75);
      break;
    case 'hug':
      setSpine(0.14, 0.02, 0.48, 0.12 * a);
      reach(0, 0.12, hip + 0.27, 0.14, V(-0.5, -1, 0));
      reach(1, -0.12, hip + 0.31, 0.15, V(0.5, -1, 0));
      f.setHand(0, 0.45); f.setHand(1, 0.45);
      break;
    case 'down':
      setSpine(0.1, 0.0, 0.66, 0.08 * a);
      reach(0, -0.03, hip - 0.13, 0.2, V(-0.3, -1, 0));
      reach(1, 0.03, hip - 0.13, 0.21, V(0.3, -1, 0));
      f.setHand(0, 0.55); f.setHand(1, 0.55);
      break;
  }
  return { phone, spine, stand, relax };
}

/** Linked with the neighbours on both sides (hands at ±LINK), `raise` 0..1 lifts the joined hands to RAISE. */
export function poseLinked(f: RealFigure, raise = 0) {
  const T = new THREE.Vector3();
  for (const i of [0, 1]) {
    const s = i ? 1 : -1;
    T.set(s * LINK.x, LINK.y, LINK.z).lerp(V(s * RAISE.x, RAISE.y, RAISE.z), raise);
    f.reach(i, floorPt(f, T.x, T.y, T.z), V(s * (0.25 + 0.6 * raise), -1, -0.5 + 0.2 * raise));
    f.setHand(i, 0.55);
  }
  for (const i of [0, 1]) { const u = limbDir(i ? 1 : -1, 0.05, 0); f.setLeg(i, u, bend(u, V(0, 0, -1), 0.06)); }
  f.setSpine(-0.07 * raise, 0, -0.05 - 0.3 * raise, 0);
}

// ---------------------------------------------------------------------------------------------------
// baking

export interface Baked { pos: Float32Array; nor: Float32Array }

/**
 * A lighter version of a body for the crowd: per mesh, vertices clustered on a grid in bind space (`cell` m on a
 * body of standard height); each cluster keeps its centroid, its averaged normal and one member's skinning.
 */
export interface Decimated { meshes: { pos: Float32Array; nor: Float32Array; rep: Int32Array; index: Uint32Array }[]; count: number }

export function decimate(fig: RealFigure, cell = 0.016, hair = 1): Decimated {
  const out: Decimated = { meshes: [], count: 0 };
  // bind-space units per metre: from the figure's scale and the meshes' bind transforms
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

/**
 * Give a live figure lighter skinned meshes (new geometries, the shared model is untouched): each mesh and its
 * depth-prepass twin get the clustered vertices with their representative's skinning.
 */
export function lighten(fig: RealFigure, cell = 0.011, hair = 1) {
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

/**
 * Pull whatever the head carries far out of the skull (Michelle's big double buns) back toward it, so she reads as
 * a person with her hair up rather than a cartoon: bind-space positions of head-skinned clusters beyond `r0`.
 */
function shrinkHair(m: THREE.SkinnedMesh, P: Float32Array, R: Int32Array, sc: number, k: number) {
  const names = m.skeleton.bones.map((b) => b.name.replace(/^mixamorig:?/, ''));
  const hi = names.indexOf('Head'), ti = names.indexOf('HeadTop_End');
  if (hi < 0 || ti < 0) return;
  const si = m.geometry.attributes.skinIndex as THREE.BufferAttribute, sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
  const headW = (i: number) => { let w = 0; for (let q = 0; q < 4; q++) { const b = si.getComponent(i, q); if (b === hi || b === ti) w += sw.getComponent(i, q); } return w; };
  // the skull: centred between the head's extremes in x and z, about 13 cm above its lowest point (the chin)
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
    const nd = r0 + (d - r0) * k;
    v.multiplyScalar(nd / d).add(c);
    P[j * 3] = v.x; P[j * 3 + 1] = v.y; P[j * 3 + 2] = v.z;
  }
}

/** The posed body as plain vertex arrays in the figure's floor coordinates (place the figure at (0, hip, 0)). */
export function bakeWorld(fig: RealFigure, dec: Decimated): Baked {
  fig.updateMatrixWorld(true);
  const P = new Float32Array(dec.count * 3), N = new Float32Array(dec.count * 3);
  const M = new THREE.Matrix4(), K = new THREE.Matrix4(), v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  let o = 0;
  fig.meshes.forEach((m, mi) => {
    const D = dec.meshes[mi]!;
    const src = m.geometry;
    const si = src.attributes.skinIndex as THREE.BufferAttribute, sw = src.attributes.skinWeight as THREE.BufferAttribute;
    m.skeleton.update();
    const bm = m.skeleton.boneMatrices!;
    const toW = new THREE.Matrix4().multiplyMatrices(m.matrixWorld, m.bindMatrixInverse);
    for (let j = 0; j < D.rep.length; j++) {
      const i = D.rep[j]!;
      K.elements.fill(0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w === 0) continue;
        M.fromArray(bm, si.getComponent(i, k) * 16);
        for (let e = 0; e < 16; e++) K.elements[e]! += w * M.elements[e]!;
      }
      K.multiply(m.bindMatrix).premultiply(toW);
      v.fromArray(D.pos, j * 3).applyMatrix4(K);
      n.fromArray(D.nor, j * 3).applyMatrix3(nm.getNormalMatrix(K)).normalize();
      P[o * 3] = v.x; P[o * 3 + 1] = v.y; P[o * 3 + 2] = v.z;
      N[o * 3] = n.x; N[o * 3 + 1] = n.y; N[o * 3 + 2] = n.z;
      o++;
    }
  });
  return { pos: P, nor: N };
}

/** Per vertex: how much it follows the left arm (+x) and the right arm (-x), from the skin weights. */
export function armWeights(fig: RealFigure, dec: Decimated): Float32Array {
  const A = new Float32Array(dec.count * 2);
  let o = 0;
  for (const [mi, m] of fig.meshes.entries()) {
    const reps = dec.meshes[mi]!.rep;
    const names = m.skeleton.bones.map((b) => b.name.replace(/^mixamorig:?/, ''));
    const side = names.map((nm) => (/^Left(Shoulder|Arm|ForeArm|Hand)/.test(nm) ? 1 : /^Right(Shoulder|Arm|ForeArm|Hand)/.test(nm) ? 2 : 0));
    const shoulder = names.map((nm) => /Shoulder$/.test(nm));
    const si = m.geometry.attributes.skinIndex as THREE.BufferAttribute, sw = m.geometry.attributes.skinWeight as THREE.BufferAttribute;
    for (const i of reps) {
      let l = 0, r = 0;
      for (let k = 0; k < 4; k++) {
        const b = si.getComponent(i, k), w = sw.getComponent(i, k) * (shoulder[b] ? 0.6 : 1);
        if (side[b] === 1) l += w; else if (side[b] === 2) r += w;
      }
      A[o * 2] = Math.min(1, l); A[o * 2 + 1] = Math.min(1, r);
      o++;
    }
  }
  return A;
}

export function mergedIndex(dec: Decimated): THREE.BufferAttribute {
  const idx: number[] = [];
  let ov = 0;
  for (const D of dec.meshes) {
    for (const k of D.index) idx.push(k + ov);
    ov += D.rep.length;
  }
  return new THREE.BufferAttribute(new Uint32Array(idx), 1);
}

export interface BodyBake {
  kind: BodyKind;
  hat: boolean;
  index: THREE.BufferAttribute;
  arm: THREE.BufferAttribute;
  B: { pos: THREE.BufferAttribute; nor: THREE.BufferAttribute };
  C: { pos: THREE.BufferAttribute; nor: THREE.BufferAttribute };
  A: Map<Lonely, { pos: THREE.BufferAttribute; nor: THREE.BufferAttribute; phone: { p: THREE.Vector3; n: THREE.Vector3 } | null }>;
}

/** Bake a body in every pose the crowd uses (the figure is only a poser; it is not added to the scene). */
export function bakeBody(fig: RealFigure, hat: boolean, variant = 0.5, cell = 0.016, hair = 1): BodyBake {
  const dec = decimate(fig, cell, hair);
  fig.position.set(0, fig.hipHeight, 0);
  fig.rotation.set(0, 0, 0);
  const at = (b: Baked) => ({ pos: new THREE.BufferAttribute(b.pos, 3), nor: new THREE.BufferAttribute(b.nor, 3) });
  const reset = () => { for (const i of [0, 1]) { fig.setFoot(i, 0); fig.setHand(i, 0.3); } fig.setSpine(0, 0, 0, 0); };
  reset();
  poseLinked(fig, 0);
  const B = at(bakeWorld(fig, dec));
  reset();
  poseLinked(fig, 1);
  const C = at(bakeWorld(fig, dec));
  const A = new Map<Lonely, { pos: THREE.BufferAttribute; nor: THREE.BufferAttribute; phone: { p: THREE.Vector3; n: THREE.Vector3 } | null }>();
  for (const k of LONELY) {
    reset();
    const { phone } = poseLonely(fig, k, variant);
    A.set(k, { ...at(bakeWorld(fig, dec)), phone });
  }
  return { kind: fig.kind, hat, index: mergedIndex(dec), arm: new THREE.BufferAttribute(armWeights(fig, dec), 2), B, C, A };
}

// ---------------------------------------------------------------------------------------------------
// shading (shared by the instanced crowd and the skinned friends)

export const GLSL_PERSON = /* glsl */ `
${GLSL_WORLD}
uniform vec3 uCold;
/** Light falling on a person: the moon, the warm light around, the friends' hands, a phone screen. */
vec3 personEnv(vec3 wp, vec3 N, vec3 phoneP, float phoneK) {
  vec3 e = mapAt(wp) * 0.55 + uFill * 0.35;
  if (uMoonK > 0.002) e += uMoonCol * moonAt(wp) * uMoonK * (0.15 + 0.85 * max(dot(N, uMoonL), 0.0));
  if (uHandK.x + uHandK.y > 0.0) e += handGlow(wp, N) * 1.2;
  if (phoneK > 0.0) {
    vec3 d = phoneP - wp; float l = length(d);
    e += vec3(0.62, 0.78, 1.0) * phoneK * (0.25 + 0.75 * max(dot(N, d / max(l, 1e-4)), 0.0)) / (1.0 + 90.0 * l * l) * 1.6;
  }
  return e;
}
/**
 * A ghost (cold, faint, a pale rim, misting toward the feet) that warms (tint) and turns into a person of light
 * (lightK): glowing glass, a rim running to white, light flowing up in bands, fine glints. band = the bright front
 * of the warmth flowing in.
 */
vec3 personShade(vec3 N, vec3 V, vec3 wp, float tint, float lightK, float band, vec3 warmC, float seed, vec3 env) {
  float f = clamp(abs(dot(N, V)), 0.0, 1.0), rim = 1.0 - f;
  float r2 = rim * rim, r4 = r2 * r2;
  float nz = vn3(wp * vec3(3.0, 2.2, 3.0) + vec3(0.0, -uTime * mix(0.5, 1.1, lightK), seed * 13.0));
  float mist = 0.55 + 0.75 * nz;
  float feet = 0.3 + 0.7 * smoothstep(0.0, 0.95, wp.y);
  vec3 c = vec3(0.0);
  if (lightK < 0.999) {
    vec3 gc = mix(uCold, warmC * 0.7, tint);
    c += gc * (0.03 + 0.42 * pow(rim, 1.6) + 0.95 * r4) * mist * feet * (1.0 - lightK);
  }
  if (lightK > 0.001) {
    float lum = max(warmC.r, max(warmC.g, warmC.b));
    float bands = smoothstep(0.55, 0.9, nz);
    float glint = step(0.991, h13(floor(wp * 210.0) + floor(uTime * 8.0))) * f;
    float f2 = f * f, f4 = f2 * f2;
    c += (warmC * (0.07 + 0.35 * bands + 0.9 * r2 + 2.2 * r4 * r2) + mix(warmC, vec3(lum), 0.6) * 1.6 * r4 * r4
      + vec3(lum) * (0.12 * f4 * f4 + 1.5 * glint)) * lightK;
  }
  c += warmC * band * (0.7 + 2.2 * rim);
  c += env * (0.1 + 0.9 * rim) * mix(feet * mist, 1.0, lightK);
  return c;
}
`;

const CROWD_VERT = /* glsl */ `
  uniform float uTime;
  uniform vec4 uPhone; // the phone (figure floor coordinates), w = 1 if this pose holds one
  attribute vec3 posB, posC, norB, norC;
  attribute vec2 arm;
  attribute vec4 aMorph; // whole body, left arm, right arm (lonely -> linked), raise (linked -> raised)
  attribute vec4 aState; // warmth flow 0..1, seed, gain, phone level
  attribute vec4 aWarm;  // warm colour, side the light comes in from (-1 = right hand, +1 = left hand)
  varying vec3 vWP, vN, vPhone; varying vec4 vState, vWarm; varying float vD;
  void main() {
    float k = aMorph.x * (1.0 - arm.x - arm.y) + aMorph.y * arm.x + aMorph.z * arm.y;
    vec3 p = mix(position, posB, k), n = mix(normal, norB, k);
    p = mix(p, posC, aMorph.w); n = mix(n, norC, aMorph.w);
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(p, 1.0);
    // a ghost wavers
    float g = 1.0 - smoothstep(0.0, 0.6, aState.x);
    float ph = aState.y * 37.0;
    wp.x += g * 0.009 * sin(wp.y * 6.5 - uTime * 2.6 + ph);
    wp.z += g * 0.009 * sin(wp.y * 5.3 - uTime * 2.1 + ph * 1.7);
    vWP = wp.xyz;
    vN = normalize(mat3(m) * n);
    vPhone = (m * vec4(uPhone.xyz, 1.0)).xyz;
    vState = aState; vWarm = aWarm;
    vD = distance(posB, vec3(aWarm.w * ${LINK.x.toFixed(3)}, ${LINK.y.toFixed(3)}, ${LINK.z.toFixed(3)}));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

/** Instanced crowd material (see CROWD_VERT for the per-instance attributes). */
export function crowdMaterial(U: WorldU, cold: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uCold: { value: cold }, uPhone: { value: new THREE.Vector4(0, 0, 0, 0) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: CROWD_VERT,
    fragmentShader: /* glsl */ `
      ${GLSL_PERSON}
      uniform vec4 uPhone;
      varying vec3 vWP, vN, vPhone; varying vec4 vState, vWarm; varying float vD;
      void main() {
        vec3 N = normalize(vN), V = normalize(cameraPosition - vWP);
        // the warmth flows in from the hand that took the light (2.4 m reaches the far foot)
        float w = vState.x, front = w * 2.5;
        float fm = 1.0 - smoothstep(front - 0.3, front, vD);
        float band = w > 0.0 ? exp(-(vD - front) * (vD - front) * 60.0) * (1.0 - smoothstep(0.8, 1.0, w)) : 0.0;
        vec3 env = personEnv(vWP, N, vPhone, vState.w * uPhone.w);
        vec3 c = personShade(N, V, vWP, fm, fm, band, vWarm.rgb, vState.y, env);
        float fl = 1.0 - 0.35 * step(0.975, h12(vec2(uFrame, vState.y * 97.0 + 1.0))) * (1.0 - fm);
        gl_FragColor = vec4(c * vState.z * fl * fogK(vWP), 1.0);
      }`,
  });
}

/** Depth-only twin of the crowd material (same morph), drawn first so a body shows only its nearest surface. */
export function crowdDepthMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uPhone: { value: new THREE.Vector4() } },
    colorWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 4,
    vertexShader: CROWD_VERT,
    fragmentShader: /* glsl */ `void main() { gl_FragColor = vec4(0.0); }`,
  });
}

/** Skinned twin of the crowd shading for the friends (RealFigure material; pass { prepass: true }). */
export function heroMaterial(U: WorldU, cold: THREE.Color, warm: THREE.Color, seed: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...U, uCold: { value: cold }, uWarmC: { value: warm.clone() }, uSeed: { value: seed },
      uFlowO: { value: new THREE.Vector3() }, uFlow: { value: 0 }, uTintMax: { value: 1 }, uLight: { value: 0 }, uGain: { value: 1 },
      uPhoneP: { value: new THREE.Vector4() }, time: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      uniform float uLight, uSeed, uTime;
      varying vec3 vWP, vN;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        // (no wavering here: the depth prepass draws the body unmoved)
        vec4 w = modelMatrix * vec4(transformed, 1.0);
        vWP = w.xyz;
        vN = normalize(mat3(modelMatrix) * objectNormal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_PERSON}
      uniform vec3 uWarmC, uFlowO; uniform float uFlow, uTintMax, uLight, uGain, uSeed; uniform vec4 uPhoneP;
      varying vec3 vWP, vN;
      void main() {
        float ln = length(vN);
        vec3 N = ln > 1e-5 ? vN / ln : vec3(0.0, 1.0, 0.0), V = normalize(cameraPosition - vWP);
        float d = distance(vWP, uFlowO), front = uFlow * 2.5;
        float fm = 1.0 - smoothstep(front - 0.3, front, d);
        float band = uFlow > 0.0 ? exp(-(d - front) * (d - front) * 60.0) * (1.0 - smoothstep(0.8, 1.0, uFlow)) : 0.0;
        vec3 env = personEnv(vWP, N, uPhoneP.xyz, uPhoneP.w);
        vec3 c = personShade(N, V, vWP, fm * uTintMax, uLight, band, uWarmC, uSeed, env);
        gl_FragColor = vec4(c * uGain * fogK(vWP), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------------------------------
// the instanced crowd

export interface CrowdSlot { body: number; pose: Lonely }

/**
 * All the baked people: one InstancedMesh (+ depth twin) per (body, lonely pose, level of detail). Each frame
 * every person is put into the near or the far version of their mesh (`begin`, `set`, `commit`).
 */
export class Crowd extends THREE.Group {
  groups: { mesh: THREE.InstancedMesh; depth: THREE.InstancedMesh; mat: THREE.ShaderMaterial; attrs: Record<string, THREE.InstancedBufferAttribute>; n: number }[] = [];
  /** person -> group index per level of detail */
  where: number[][] = [];
  phones: ({ p: THREE.Vector3; n: THREE.Vector3 } | null)[] = [];

  /** `lods[l][body]`: the bakes of each body at each level of detail (0 = finest). */
  constructor(lods: BodyBake[][], slots: CrowdSlot[], U: WorldU, cold: THREE.Color) {
    super();
    const depthMat = crowdDepthMaterial(U);
    const keyOf = (s: CrowdSlot) => `${s.body}:${s.pose}`;
    const keys = [...new Set(slots.map(keyOf))];
    slots.forEach((_, i) => (this.where[i] = []));
    lods.forEach((bakes, lod) => {
      for (const key of keys) {
        const ids = slots.map((s, i) => (keyOf(s) === key ? i : -1)).filter((i) => i >= 0);
        const s0 = slots[ids[0]!]!, bk = bakes[s0.body]!, A = bk.A.get(s0.pose)!;
        const g = new THREE.BufferGeometry();
        g.setIndex(bk.index);
        g.setAttribute('position', A.pos);
        g.setAttribute('normal', A.nor);
        g.setAttribute('posB', bk.B.pos);
        g.setAttribute('norB', bk.B.nor);
        g.setAttribute('posC', bk.C.pos);
        g.setAttribute('norC', bk.C.nor);
        g.setAttribute('arm', bk.arm);
        g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2);
        const n = ids.length;
        const attrs: Record<string, THREE.InstancedBufferAttribute> = {};
        for (const nm of ['aMorph', 'aState', 'aWarm']) {
          attrs[nm] = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
          g.setAttribute(nm, attrs[nm]!);
        }
        const mat = crowdMaterial(U, cold);
        if (A.phone) mat.uniforms.uPhone!.value.set(A.phone.p.x, A.phone.p.y, A.phone.p.z, 1);
        const mesh = new THREE.InstancedMesh(g, mat, n);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        const dm = depthMat.clone();
        dm.uniforms.uTime = U.uTime;
        dm.uniforms.uPhone = mat.uniforms.uPhone!;
        const depth = new THREE.InstancedMesh(g, dm, n);
        depth.instanceMatrix = mesh.instanceMatrix;
        depth.frustumCulled = false;
        depth.renderOrder = -10;
        this.add(depth, mesh);
        const gi = this.groups.length;
        ids.forEach((pid) => { this.where[pid]![lod] = gi; if (lod === 0) this.phones[pid] = A.phone; });
        this.groups.push({ mesh, depth, mat, attrs, n: 0 });
      }
    });
  }

  begin() { for (const G of this.groups) G.n = 0; }

  set(i: number, lod: number, m: THREE.Matrix4, morph: [number, number, number, number], state: [number, number, number, number], warm: THREE.Color, near: number) {
    const W = this.where[i]!;
    const G = this.groups[W[Math.min(lod, W.length - 1)]!]!, k = G.n++;
    G.mesh.setMatrixAt(k, m);
    G.attrs.aMorph!.array.set(morph, k * 4);
    G.attrs.aState!.array.set(state, k * 4);
    G.attrs.aWarm!.array.set([warm.r, warm.g, warm.b, near], k * 4);
  }

  commit() {
    for (const G of this.groups) {
      G.mesh.count = G.depth.count = G.n;
      G.mesh.visible = G.depth.visible = G.n > 0;
      G.mesh.instanceMatrix.needsUpdate = true;
      for (const a of Object.values(G.attrs)) a.needsUpdate = true;
    }
  }
}

/** Glowing phone screens (small instanced quads), one per person in the phone pose. */
export class Phones extends THREE.InstancedMesh {
  declare material: THREE.ShaderMaterial;
  aK: THREE.InstancedBufferAttribute;
  constructor(n: number) {
    const g = new THREE.PlaneGeometry(0.068, 0.135);
    const k = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aK', k);
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `attribute float aK; varying float vK; varying vec2 vUv;
        void main() { vK = aK; vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying float vK; varying vec2 vUv;
        void main() {
          vec2 e = min(vUv, 1.0 - vUv);
          float edge = smoothstep(0.0, 0.08, min(e.x, e.y * 0.5));
          float rows = 0.75 + 0.25 * step(0.5, fract(vUv.y * 9.0)) * step(0.15, vUv.x) * step(vUv.x, 0.8);
          gl_FragColor = vec4(vec3(0.75, 0.86, 1.0) * 1.7 * vK * edge * rows, 1.0);
        }`,
    });
    super(g, mat, n);
    this.aK = k;
    this.frustumCulled = false;
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
}
