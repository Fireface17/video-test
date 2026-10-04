// Props of the `snap` scene: a glow stick that bends, kinks (the vial snaps), cracks with gold and floods
// with light (hero version: translucent plastic over a glass vial; instanced version: opaque, per-instance
// bend/kink/flood/colour), a rim-lit dark silhouette material (instancing-aware) and a fist that holds a
// stick. All lighting is done by hand from one moving point light (the light-painting pen) plus a rim.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Shared light/fog uniforms: one point light (the pen head), a rim light direction, exp2 fog. */
export function lightUniforms() {
  return {
    uLightPos: { value: new THREE.Vector3() },
    uLightCol: { value: new THREE.Color(0, 0, 0) },
    uLightFall: { value: 0.04 },
    uFillPos: { value: new THREE.Vector3() },
    uFillCol: { value: new THREE.Color(0, 0, 0) },
    uRimCol: { value: new THREE.Color(0, 0, 0) },
    uRimDir: { value: new THREE.Vector3(0, 0.5, -1).normalize() },
    uFogCol: { value: new THREE.Color(0, 0, 0) },
    uFogD: { value: 0 },
  };
}
export type LightU = ReturnType<typeof lightUniforms>;

const LIGHT_GLSL = /* glsl */ `
uniform vec3 uLightPos; uniform vec3 uLightCol; uniform float uLightFall;
uniform vec3 uFillPos; uniform vec3 uFillCol;
uniform vec3 uRimCol; uniform vec3 uRimDir; uniform vec3 uFogCol; uniform float uFogD;
float fogK(vec3 wp) { float d = length(wp - cameraPosition); return 1.0 - exp(-uFogD * uFogD * d * d); }
// soft light from the written text (a broad source): wrapped diffuse and a broad sheen
vec3 fillLight(vec3 n, vec3 v, vec3 wp, float gloss) {
  vec3 L = uFillPos - wp; float d2 = dot(L, L); L *= inversesqrt(d2);
  float att = 0.25 / (0.25 + d2);
  float wrap = max(dot(n, L) * 0.6 + 0.4, 0.0);
  float sh = pow(max(dot(n, normalize(L + v)), 0.0), gloss);
  return uFillCol * att * (wrap * 0.35 + sh * 1.2);
}
`;

/**
 * The bend: the stick (along +y) curves toward +x with curvature k about the grip at y = gy, and
 * everything above y = ky turns a further `kink` radians about the centreline there (the snap).
 */
const BEND_GLSL = /* glsl */ `
vec3 bendPos(vec3 p, inout vec3 n, float k, float kink, float ky, float gy) {
  float s = p.y - gy;
  float kk = abs(k) < 1e-4 ? (k < 0.0 ? -1e-4 : 1e-4) : k;
  float phi = kk * s, sp = sin(phi), cp = cos(phi), sh = sin(0.5 * phi);
  vec2 q = vec2(2.0 * sh * sh / kk, sp / kk) + p.x * vec2(cp, -sp);
  vec3 r = vec3(q.x, q.y + gy, p.z);
  n = vec3(n.x * cp + n.y * sp, -n.x * sp + n.y * cp, n.z);
  float sk = ky - gy;
  float w = smoothstep(sk - 0.008, sk + 0.008, s);
  if (w > 0.0 && abs(kink) > 1e-4) {
    float pk = kk * sk, h2 = sin(0.5 * pk);
    vec2 ck = vec2(2.0 * h2 * h2 / kk, sin(pk) / kk + gy);
    float a = -kink * w, ca = cos(a), sa = sin(a);
    vec2 d = r.xy - ck;
    r.xy = ck + vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
    n.xy = vec2(n.x * ca - n.y * sa, n.x * sa + n.y * ca);
  }
  return r;
}`;

/** CPU twin of bendPos for a point on the centreline (local x = z = 0); returns [x, y, tangent angle]. */
export function bendCenter(y: number, k: number, kink: number, ky: number, gy: number): [number, number, number] {
  const s = y - gy;
  const kk = Math.abs(k) < 1e-4 ? (k < 0 ? -1e-4 : 1e-4) : k;
  const phi = kk * s, sh = Math.sin(0.5 * phi);
  let x = (2 * sh * sh) / kk, yy = Math.sin(phi) / kk + gy, ang = phi;
  const sk = ky - gy;
  const t = Math.min(1, Math.max(0, (s - (sk - 0.008)) / 0.016));
  const w = t * t * (3 - 2 * t);
  if (w > 0 && Math.abs(kink) > 1e-4) {
    const pk = kk * sk, h2 = Math.sin(0.5 * pk);
    const cx = (2 * h2 * h2) / kk, cy = Math.sin(pk) / kk + gy;
    const a = -kink * w, ca = Math.cos(a), sa = Math.sin(a);
    const dx = x - cx, dy = yy - cy;
    x = cx + dx * ca - dy * sa; yy = cy + dx * sa + dy * ca;
    ang += kink * w;
  }
  return [x, yy, ang];
}

const STICK_VERT = /* glsl */ `
${BEND_GLSL}
uniform float uBend, uKink, uKinkY, uGripY, uFlood;
uniform vec3 uColor;
#ifdef INST
attribute vec4 iP;   // bend, kink, flood, seed
attribute vec3 iC;   // colour
#endif
varying vec3 vWP; varying vec3 vWN; varying vec3 vLP; varying vec3 vCol; varying vec2 vPar;
void main() {
  float k = uBend, kink = uKink, flood = uFlood, seed = 0.0; vec3 col = uColor;
#ifdef INST
  k = iP.x; kink = iP.y; flood = iP.z; seed = iP.w; col = iC;
#endif
  vec3 n = normal;
  vec3 p = bendPos(position, n, k, kink, uKinkY, uGripY);
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  vec4 wp = m * vec4(p, 1.0);
  vWP = wp.xyz; vWN = normalize(mat3(m) * n); vLP = position; vCol = col; vPar = vec2(flood, seed);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** Light inside the tube: white-hot where we look through the most liquid, saturated at the edges. */
const GLOW_GLSL = /* glsl */ `
vec3 tubeGlow(vec3 col, float ndv) {
  float lum = max(col.r, max(col.g, col.b));
  return col * (0.75 + 1.25 * pow(ndv, 1.4)) * 2.3 + vec3(lum) * pow(ndv, 5.0) * 1.3;
}`;

// hero tube: translucent plastic (premultiplied alpha), gold crack, flood from the kink, stress glow
const TUBE_FRAG = /* glsl */ `
${LIGHT_GLSL}
${GLOW_GLSL}
uniform float uFloodR, uKinkY, uCrack, uCrackY0, uCrackY1, uStress, uTime, uRadius, uGold;
uniform vec3 uCrackCol;
varying vec3 vWP; varying vec3 vWN; varying vec3 vLP; varying vec3 vCol; varying vec2 vPar;
float zig(float x, float seed) {
  float i = floor(x), f = fract(x);
  float a = fract(sin(i * 12.9898 + seed) * 43758.5453) * 2.0 - 1.0;
  float b = fract(sin((i + 1.0) * 12.9898 + seed) * 43758.5453) * 2.0 - 1.0;
  return mix(a, b, f);
}
void main() {
  vec3 n = normalize(vWN); vec3 v = normalize(cameraPosition - vWP);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.5);
  vec3 Lv = uLightPos - vWP; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
  float att = uLightFall / (uLightFall + d2);
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 60.0);
  float rimL = 0.3 + 0.7 * max(dot(n, uRimDir), 0.0);
  // unlit: dull tinted plastic, a sheen from the pen light, a rim from the room
  vec3 tint = vCol * 0.035 + vec3(0.010, 0.011, 0.018);
  vec3 fill = fillLight(n, v, vWP, 24.0);
  float sheen = pow(max(dot(reflect(-v, n), normalize(vec3(-0.45, 0.75, 0.5))), 0.0), 36.0) * 0.16
              + pow(max(dot(reflect(-v, n), normalize(vec3(0.6, 0.2, 0.75))), 0.0), 18.0) * 0.035;
  vec3 col = vec3(0.75, 0.8, 1.0) * sheen + tint * (0.5 + 0.5 * fres) + uLightCol * att * (diff * 0.03 * (vCol + 0.2) + spec * 0.9) + uRimCol * fres * rimL + fill * (0.25 + 0.75 * fres);
  float a = 0.30 + 0.55 * fres + 0.4 * dot(fill, vec3(0.33)) + sheen * 2.0;
  // the liquid scatters a little of the pen light (translucency): faint colour where the light is close
  col += vCol * uLightCol * att * 0.012 * (0.4 + ndv);
  // stress: before the snap, light leaks around the bend centre
  float dk = abs(vLP.y - uKinkY);
  col += vCol * uStress * exp(-dk * 38.0) * (0.35 + 0.65 * ndv) * 1.8;
  // flood: lit from the kink outwards
  float lit = clamp(vPar.x, 0.0, 1.0) * (1.0 - smoothstep(uFloodR - 0.03, uFloodR, dk));
  col = mix(col, tubeGlow(vCol, ndv) * max(vPar.x, 1.0), lit);
  a = mix(a, 1.0, lit);
  // gold crack: a jagged line along the camera-facing side (local +z), written from y0 to y0 + (y1 - y0) * uCrack
  if (uCrack > 0.0) {
    float y = vLP.y;
    float th = atan(vLP.z, vLP.x);
    float tc = 1.35 + 0.32 * zig(y * 70.0, 3.1) + 0.12 * zig(y * 260.0, 7.7);
    float dist = abs(th - tc) * uRadius;
    float front = mix(uCrackY0, uCrackY1, uCrack);
    float inside = step(uCrackY0, y) * (1.0 - smoothstep(front - 0.004, front, y));
    float line = (1.0 - smoothstep(0.0006, 0.0016, dist)) * inside;
    float halo = exp(-dist * dist / (0.0045 * 0.0045)) * inside;
    float head = exp(-pow((y - front) / 0.008, 2.0)) * exp(-dist * dist / (0.004 * 0.004)) * step(uCrack, 0.999);
    // a short branch every few cm
    float bph = fract(y * 18.0);
    float br = (1.0 - smoothstep(0.0005, 0.0013, abs(th - tc - (bph - 0.15) * 1.6 * step(bph, 0.3)) * uRadius)) * step(bph, 0.3) * inside;
    float g = uGold * (line * 3.2 + br * 1.6 + halo * 0.55) + head * 4.0 * uGold;
    col += uCrackCol * g;
    a = max(a, clamp(line + halo * 0.6 + br, 0.0, 1.0));
  }
  float fk = fogK(vWP);
  col = mix(col, uFogCol * a, fk);
  gl_FragColor = vec4(col, a);
}`;

// the glass vial inside the hero stick: nearly invisible glass with sharp edge highlights
const VIAL_FRAG = /* glsl */ `
${LIGHT_GLSL}
${GLOW_GLSL}
uniform float uFloodR, uKinkY;
varying vec3 vWP; varying vec3 vWN; varying vec3 vLP; varying vec3 vCol; varying vec2 vPar;
void main() {
  vec3 n = normalize(vWN); vec3 v = normalize(cameraPosition - vWP);
  float ndv = clamp(abs(dot(n, v)), 0.0, 1.0);
  float edge = pow(1.0 - ndv, 4.0);
  vec3 Lv = uLightPos - vWP; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
  float att = uLightFall / (uLightFall + d2);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 120.0);
  float sheen = pow(max(dot(reflect(-v, n), normalize(vec3(-0.45, 0.75, 0.5))), 0.0), 50.0) * 0.12;
  vec3 col = vec3(0.75, 0.8, 1.0) * sheen + vCol * 0.012 + vec3(0.03, 0.035, 0.05) * edge + uLightCol * att * spec * 2.5 + uRimCol * edge * 0.8 + vec3(0.03) * pow(ndv, 60.0) + fillLight(n, v, vWP, 90.0) * (0.3 + edge);
  float a = 0.16 + 0.6 * edge + sheen * 2.0;
  float lit = clamp(vPar.x, 0.0, 1.0) * (1.0 - smoothstep(uFloodR - 0.03, uFloodR, abs(vLP.y - uKinkY)));
  col = mix(col, tubeGlow(vCol, ndv) * 1.2, lit);
  a = mix(a, 1.0, lit);
  col = mix(col, uFogCol * a, fogK(vWP));
  gl_FragColor = vec4(col, a);
}`;

// opaque sticks (caps of the hero stick, instanced crowd / lantern sticks)
const SOLID_FRAG = /* glsl */ `
${LIGHT_GLSL}
${GLOW_GLSL}
uniform float uCapDim, uDim, uTime;
varying vec3 vWP; varying vec3 vWN; varying vec3 vLP; varying vec3 vCol; varying vec2 vPar;
void main() {
  vec3 n = normalize(vWN); vec3 v = normalize(cameraPosition - vWP);
  if (dot(n, v) < 0.0) n = -n;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.5);
  vec3 Lv = uLightPos - vWP; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
  float att = uLightFall / (uLightFall + d2);
  float diff = max(dot(n, L), 0.0);
  float spec = pow(max(dot(n, normalize(L + v)), 0.0), 40.0);
  float rimL = 0.3 + 0.7 * max(dot(n, uRimDir), 0.0);
  vec3 base = vCol * uCapDim + vec3(0.008, 0.009, 0.014);
  vec3 col = base * (0.4 + 0.6 * fres) + uLightCol * att * (diff * 0.15 * (vCol * 0.5 + 0.3) + spec * 0.9) + uRimCol * fres * rimL + fillLight(n, v, vWP, 16.0) * 0.5;
  // flood (instanced: the whole stick); uDim = a faint glow everywhere (released lanterns)
  float lit = clamp(vPar.x, 0.0, 1.0);
  col = mix(col, tubeGlow(vCol, ndv) * max(vPar.x, 1.0), lit);
  col += tubeGlow(vCol, ndv) * uDim * (0.85 + 0.15 * sin(uTime * 3.0 + vPar.y * 40.0));
  col = mix(col, uFogCol, fogK(vWP));
  gl_FragColor = vec4(col, 1.0);
}`;

export interface StickU {
  uBend: THREE.IUniform<number>; uKink: THREE.IUniform<number>; uKinkY: THREE.IUniform<number>; uGripY: THREE.IUniform<number>;
  uFlood: THREE.IUniform<number>; uFloodR: THREE.IUniform<number>; uColor: THREE.IUniform<THREE.Color>;
  uCrack: THREE.IUniform<number>; uCrackY0: THREE.IUniform<number>; uCrackY1: THREE.IUniform<number>; uGold: THREE.IUniform<number>;
  uCrackCol: THREE.IUniform<THREE.Color>; uStress: THREE.IUniform<number>; uTime: THREE.IUniform<number>; uRadius: THREE.IUniform<number>;
  uCapDim: THREE.IUniform<number>; uDim: THREE.IUniform<number>;
}

/** The hero glow stick: translucent tube over a glass vial, opaque end caps. Built along +y, centred. */
export class HeroStick extends THREE.Group {
  u: StickU;
  tube: THREE.Mesh; vial: THREE.Mesh; caps: THREE.Mesh;

  constructor(public length: number, public radius: number, color: THREE.Color, light: LightU) {
    super();
    this.u = {
      uBend: { value: 0 }, uKink: { value: 0 }, uKinkY: { value: 0.02 * length }, uGripY: { value: -0.36 * length },
      uFlood: { value: 0 }, uFloodR: { value: 0 }, uColor: { value: color.clone() },
      uCrack: { value: 0 }, uCrackY0: { value: -0.3 * length }, uCrackY1: { value: 0.42 * length }, uGold: { value: 1 },
      uCrackCol: { value: new THREE.Color(1, 0.6, 0.15) }, uStress: { value: 0 }, uTime: { value: 0 }, uRadius: { value: radius },
      uCapDim: { value: 0.05 }, uDim: { value: 0 },
    };
    const uni = { ...light, ...this.u } as unknown as Record<string, THREE.IUniform>;
    const tubeGeo = new THREE.CapsuleGeometry(radius, length - 2 * radius, 6, 22, 64);
    const vialGeo = new THREE.CapsuleGeometry(radius * 0.42, length * 0.6, 4, 12, 40);
    const capH = length * 0.075;
    const caps: THREE.BufferGeometry[] = [-1, 1].map((s) => {
      const c = new THREE.CylinderGeometry(radius * 1.13, radius * 1.13, capH, 22, 4);
      c.translate(0, s * (length / 2 - capH / 2), 0);
      return c;
    });
    // a small ring at the top cap (the lanyard loop of a real stick)
    const ring = new THREE.TorusGeometry(radius * 0.9, radius * 0.22, 6, 18);
    ring.rotateY(Math.PI / 2);
    ring.translate(0, length / 2 + radius * 0.75, 0);
    caps.push(ring);
    for (const g of [tubeGeo, vialGeo, ...caps]) g.deleteAttribute('uv');
    const capsGeo = mergeGeometries(caps, false)!;
    const mk = (frag: string, transparent: boolean) => new THREE.ShaderMaterial({
      uniforms: uni, vertexShader: STICK_VERT, fragmentShader: frag,
      transparent, depthWrite: !transparent, premultipliedAlpha: transparent,
      blending: transparent ? THREE.CustomBlending : THREE.NormalBlending,
      ...(transparent ? { blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation } : {}),
    });
    this.vial = new THREE.Mesh(vialGeo, mk(VIAL_FRAG, true));
    this.tube = new THREE.Mesh(tubeGeo, mk(TUBE_FRAG, true));
    this.caps = new THREE.Mesh(capsGeo, mk(SOLID_FRAG, false));
    this.vial.renderOrder = 2;
    this.tube.renderOrder = 3;
    for (const m of [this.vial, this.tube, this.caps]) m.frustumCulled = false;
    this.add(this.caps, this.vial, this.tube);
  }

  /** Centreline point at local y (bent), in the stick's local frame, and the tangent angle. */
  center(y: number) { return bendCenter(y, this.u.uBend.value, this.u.uKink.value, this.u.uKinkY.value, this.u.uGripY.value); }
}

/** Instanced opaque glow sticks (crowd, released lanterns): per-instance bend/kink/flood/seed and colour. */
export class StickSwarm extends THREE.InstancedMesh {
  iP: THREE.InstancedBufferAttribute;
  iC: THREE.InstancedBufferAttribute;
  u: { uKinkY: THREE.IUniform<number>; uGripY: THREE.IUniform<number>; uDim: THREE.IUniform<number>; uTime: THREE.IUniform<number>; uCapDim: THREE.IUniform<number> };

  constructor(n: number, public length: number, radius: number, light: LightU, o: { gripY?: number; radial?: number } = {}) {
    const body = new THREE.CapsuleGeometry(radius, length - 2 * radius, 3, o.radial ?? 8, 12);
    body.deleteAttribute('uv');
    const geo = body;
    const iP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const iC = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iP', iP);
    geo.setAttribute('iC', iC);
    const u = { uKinkY: { value: 0 }, uGripY: { value: o.gripY ?? -0.3 * length }, uDim: { value: 0 }, uTime: { value: 0 }, uCapDim: { value: 0.06 } };
    const mat = new THREE.ShaderMaterial({
      defines: { INST: 1 },
      uniforms: { ...light, ...u, uBend: { value: 0 }, uKink: { value: 0 }, uFlood: { value: 0 }, uColor: { value: new THREE.Color() } } as unknown as Record<string, THREE.IUniform>,
      vertexShader: STICK_VERT, fragmentShader: SOLID_FRAG,
    });
    super(geo, mat, n);
    this.iP = iP; this.iC = iC; this.u = u;
    this.frustumCulled = false;
  }

  setStick(i: number, m: THREE.Matrix4, bend: number, kink: number, flood: number, seed: number, c: THREE.Color) {
    this.setMatrixAt(i, m);
    this.iP.setXYZW(i, bend, kink, flood, seed);
    this.iC.setXYZ(i, c.r, c.g, c.b);
  }

  commit(count = this.count) {
    this.count = count;
    this.instanceMatrix.needsUpdate = true;
    this.iP.needsUpdate = true;
    this.iC.needsUpdate = true;
  }
}

const SIL_VERT = /* glsl */ `
varying vec3 vWP; varying vec3 vWN;
void main() {
  mat4 m = modelMatrix;
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  vec4 wp = m * vec4(position, 1.0);
  vWP = wp.xyz; vWN = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SIL_FRAG = /* glsl */ `
${LIGHT_GLSL}
uniform vec3 uBase; uniform float uRimPow, uLightGain;
varying vec3 vWP; varying vec3 vWN;
void main() {
  vec3 n = normalize(vWN); vec3 v = normalize(cameraPosition - vWP);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float rim = pow(1.0 - ndv, uRimPow);
  float rimL = 0.25 + 0.75 * max(dot(n, uRimDir), 0.0);
  vec3 Lv = uLightPos - vWP; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
  float att = uLightFall / (uLightFall + d2);
  float wrap = max(dot(n, L) * 0.7 + 0.3, 0.0);
  vec3 col = uBase + uRimCol * rim * rimL + uLightCol * att * uLightGain * (wrap * 0.10 + rim * 0.5) + fillLight(n, v, vWP, 10.0) * uLightGain * (0.12 + 0.6 * rim);
  col = mix(col, uFogCol, fogK(vWP));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Dark, rim-lit silhouette (works for plain and instanced meshes). */
export function silhouetteMaterial(light: LightU, base = new THREE.Color(0.004, 0.0045, 0.008), rimPow = 3, lightGain = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { ...light, uBase: { value: base }, uRimPow: { value: rimPow }, uLightGain: { value: lightGain } } as unknown as Record<string, THREE.IUniform>,
    vertexShader: SIL_VERT, fragmentShader: SIL_FRAG,
  });
}

/**
 * A right fist gripping a stick that runs along local +y through the origin (the grip centre). The
 * curled fingers are on the far side (local -z), the back of the hand and the wrist face +z (the camera
 * in the writer's pose), the thumb wraps over the top. The forearm attaches at `FIST_WRIST`.
 */
export const FIST_WRIST = new THREE.Vector3(0.002, -0.03, 0.03);
export function fistGeometry(stickR: number) {
  const parts: THREE.BufferGeometry[] = [];
  // the fist mass: palm + curled fingers, the stick passing through its front third
  const box = new RoundedBoxGeometry(0.066, 0.086, 0.07, 3, 0.024);
  box.translate(0.0, -0.002, -0.006 - stickR * 0.3);
  parts.push(box);
  // the four curled fingers bulge on the far side, the knuckles ridge along the top-back edge
  for (let i = 0; i < 4; i++) {
    const y = 0.03 - i * 0.02;
    const f = new THREE.SphereGeometry(0.0118, 10, 8);
    f.scale(2.2, 0.95, 1.05);
    f.translate(-0.002, y, -0.038);
    parts.push(f);
    const k = new THREE.SphereGeometry(0.0105, 8, 6);
    k.translate(0.026, y, -0.012);
    parts.push(k);
  }
  // thumb over the top finger
  const th = new THREE.CapsuleGeometry(0.0118, 0.042, 3, 8);
  th.rotateZ(Math.PI / 2);
  th.rotateY(0.75);
  th.translate(-0.006, 0.046, -0.008);
  parts.push(th);
  // wrist, toward the forearm
  const wr = new THREE.CapsuleGeometry(0.025, 0.035, 3, 10);
  wr.rotateX(0.9);
  wr.translate(FIST_WRIST.x, FIST_WRIST.y + 0.012, FIST_WRIST.z - 0.012);
  parts.push(wr);
  for (const p of parts) if (p.getAttribute('uv')) p.deleteAttribute('uv');
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
}

/** A standing figure like the toolkit's figureGeometry (1.75 tall, feet at y = 0, facing +z) without its right arm. */
export function writerBodyGeometry(leftArmUp = 0.85) {
  const parts: THREE.BufferGeometry[] = [];
  const cap = (r: number, len: number, x: number, y: number, z: number, rz = 0) => {
    const g = new THREE.CapsuleGeometry(r, len, 3, 8);
    g.deleteAttribute('uv');
    g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(g);
  };
  cap(0.17, 0.42, 0, 1.12, 0);
  const head = new THREE.SphereGeometry(0.13, 12, 8);
  head.deleteAttribute('uv');
  head.translate(0, 1.6, 0);
  parts.push(head);
  cap(0.07, 0.62, -0.1, 0.42, 0);
  cap(0.07, 0.62, 0.1, 0.42, 0);
  // (facing +z the figure's left is +x)
  const a = THREE.MathUtils.lerp(0.12, Math.PI * 0.92, leftArmUp), L = 0.56;
  cap(0.055, L, 0.23 + Math.sin(a) * (L / 2 + 0.05), 1.36 - Math.cos(a) * (L / 2 + 0.05), 0, a);
  return mergeGeometries(parts, false)!;
}

/** A limb segment: a tapered cylinder from a to b (unit-height geometry scaled along y), with ball ends. */
export class Limb extends THREE.Group {
  body: THREE.Mesh;
  ballA: THREE.Mesh;
  constructor(ra: number, rb: number, mat: THREE.Material) {
    super();
    const g = new THREE.CylinderGeometry(rb, ra, 1, 14, 1, true);
    g.translate(0, 0.5, 0);
    g.deleteAttribute('uv');
    this.body = new THREE.Mesh(g, mat);
    const s = new THREE.SphereGeometry(ra, 14, 10);
    s.deleteAttribute('uv');
    this.ballA = new THREE.Mesh(s, mat);
    this.add(this.body, this.ballA);
    for (const m of [this.body, this.ballA]) m.frustumCulled = false;
  }
  /** Place between world points a (the thick end) and b. */
  span(a: THREE.Vector3, b: THREE.Vector3) {
    const d = new THREE.Vector3().subVectors(b, a);
    const L = d.length();
    this.body.position.copy(a);
    this.body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.body.scale.set(1, Math.max(1e-4, L), 1);
    this.ballA.position.copy(a);
  }
}
