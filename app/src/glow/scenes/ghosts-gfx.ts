// Graphics for the `ghosts` scene: the hall (polished floor, panelled walls, a tall arched window), the
// moon and the night sky outside, the ghost figures, the moonlight shafts, the spotlight cones and the
// mirror ball. All lighting is analytic in the shaders (moonlight through the window, the spot pool, the
// mirror-ball spots, the warm glow of linked hands), so the scene needs no three.js lights at all.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_GLOW_PALETTE } from '../lib/palette';

/** The arched window in the back wall (z = WIN.z), in metres. */
export const WIN = { x: 0, hw: 2.3, y0: 1.0, ys: 6.0, z: -12, depth: 0.7, mull: 0.065, cols: [-0.767, 0.767], rows: [2.7, 4.4, 6.0] };
/** Hall extents: side walls at x0/x1, front wall at z1, ceiling height h. */
export const HALL = { x0: -12, x1: 12, z1: 12, h: 9.5 };
/** Direction toward the moon for the light falling through the window (steeper than the visible moon). */
export const MOON_L = new THREE.Vector3(-0.25, 0.5, -0.85).normalize();

// ---------------------------------------------------------------------------------------------------
// shared uniforms + GLSL helpers

export function worldUniforms() {
  return {
    uTime: { value: 0 },
    uFrame: { value: 0 },
    uKick: { value: 0 },
    uAmb: { value: 0.1 },
    uFogCol: { value: new THREE.Color() },
    uFogD: { value: 0.045 },
    uMoonL: { value: MOON_L.clone() },
    uMoonCol: { value: new THREE.Color() },
    uMoonK: { value: 1 },
    uMoonPos: { value: new THREE.Vector3() },
    uMoonR: { value: 4 },
    uBall: { value: new THREE.Vector3() },
    uBallRot: { value: 0 },
    uDisco: { value: 0 },
    uPool: { value: new THREE.Vector4(0, 0, 1, 0) },
    uPoolCol: { value: new THREE.Color() },
    uHand0: { value: new THREE.Vector3() },
    uHand1: { value: new THREE.Vector3() },
    uHandK: { value: new THREE.Vector2() },
    uHandCol: { value: new THREE.Color() },
  };
}
export type WorldU = ReturnType<typeof worldUniforms>;

const f = (x: number) => x.toFixed(4);

export const GLSL_WORLD = /* glsl */ `
${GLSL_GLOW_PALETTE}
#define PI 3.14159265
uniform float uTime, uFrame, uKick, uAmb;
uniform vec3 uFogCol; uniform float uFogD;
uniform vec3 uMoonL, uMoonCol, uMoonPos; uniform float uMoonK, uMoonR;
uniform vec3 uBall; uniform float uBallRot, uDisco;
uniform vec4 uPool; uniform vec3 uPoolCol;
uniform vec3 uHand0, uHand1, uHandCol; uniform vec2 uHandK;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

const float WX = ${f(WIN.x)}, WHW = ${f(WIN.hw)}, WY0 = ${f(WIN.y0)}, WYS = ${f(WIN.ys)}, WZ = ${f(WIN.z)}, MULL = ${f(WIN.mull)};
/** 1 inside the glazing of the arched window (wall-plane coordinates), 0 on the wall and the mullions. */
float winMask(vec2 q, float soft) {
  float dx = WHW - abs(q.x - WX);
  float dy = q.y - WY0;
  float da = q.y > WYS ? WHW - length(q - vec2(WX, WYS)) : 1e3;
  float m = smoothstep(-soft, soft, min(min(dx, dy), da));
  float mv = min(abs(q.x - (WX + ${f(WIN.cols[0]!)})), abs(q.x - (WX + ${f(WIN.cols[1]!)}))) - MULL;
  float mh = min(min(abs(q.y - ${f(WIN.rows[0]!)}), abs(q.y - ${f(WIN.rows[1]!)})), abs(q.y - ${f(WIN.rows[2]!)})) - MULL;
  return m * smoothstep(-soft, soft, mv) * smoothstep(-soft, soft, mh);
}
/** Moonlight reaching p through the window (soft-edged window-shaped patch / shaft). */
float moonAt(vec3 p) {
  if (p.z <= WZ) return 1.0;
  float s = (WZ - p.z) / uMoonL.z;
  vec2 q = p.xy + uMoonL.xy * s;
  return winMask(q, 0.04 + 0.025 * s);
}
float fogK(vec3 p) { vec3 d = p - cameraPosition; return exp(-uFogD * uFogD * dot(d, d)); }

/** Mirror-ball spots at p (rings of facets, rotating about y). */
vec3 disco(vec3 p, vec3 N) {
  if (uDisco <= 0.0005) return vec3(0.0);
  vec3 d = p - uBall; float r = length(d); d /= r;
  float c = cos(uBallRot), s = sin(uBallRot);
  vec3 q = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
  const float NR = 17.0;
  float dl = PI / NR;
  float lat = asin(clamp(q.y, -1.0, 1.0));
  float j = floor((lat + 0.5 * PI) / dl);
  float latc = -0.5 * PI + (j + 0.5) * dl;
  float n = max(1.0, floor(2.0 * PI * cos(latc) / dl));
  float lon = atan(q.z, q.x);
  float k = floor((lon + PI) / (2.0 * PI) * n);
  float lonc = -PI + (k + 0.5) * 2.0 * PI / n;
  vec3 cc = vec3(cos(latc) * cos(lonc), sin(latc), cos(latc) * sin(lonc));
  float hs = h12(vec2(j * 3.1 + 1.0, k + 0.5));
  float rad = dl * (0.1 + 0.05 * hs);
  float a = dot(q, cc);
  float spot = smoothstep(cos(rad), cos(rad * 0.7), a) * step(0.14, hs);
  vec3 sc = hs < 0.55 ? vec3(1.0, 0.96, 0.93) : hs < 0.67 ? G_PINK : hs < 0.78 ? G_CYAN : hs < 0.89 ? G_VIOLET : G_PHOSPHOR;
  float facing = 0.25 + 0.75 * max(dot(N, -d), 0.0);
  return sc * spot * facing * uDisco * (1.6 / (1.0 + 0.012 * r * r));
}
/** The spotlight pool on the floor (xz centre, radius, intensity). */
float pool(vec3 p) {
  float r = length(p.xz - uPool.xy) / uPool.z;
  return uPool.w * (1.0 - smoothstep(0.78, 1.0, r)) * (0.8 + 0.2 * (1.0 - r * r));
}
/** Warm light of the clasped hands. */
vec3 handGlow(vec3 p, vec3 N) {
  vec3 d0 = uHand0 - p, d1 = uHand1 - p;
  float a = uHandK.x * (0.3 + 0.7 * max(dot(N, normalize(d0)), 0.0)) / (1.0 + 9.0 * dot(d0, d0));
  float b = uHandK.y * (0.3 + 0.7 * max(dot(N, normalize(d1)), 0.0)) / (1.0 + 9.0 * dot(d1, d1));
  return uHandCol * (a + b);
}
`;

/** JS twin of winMask/moonAt (dust motes). */
export function moonAtJS(x: number, y: number, z: number): number {
  if (z <= WIN.z) return 1;
  const s = (WIN.z - z) / MOON_L.z;
  const qx = x + MOON_L.x * s - WIN.x, qy = y + MOON_L.y * s;
  if (qy < WIN.y0 || Math.abs(qx) > WIN.hw) return 0;
  if (qy > WIN.ys && Math.hypot(qx, qy - WIN.ys) > WIN.hw) return 0;
  return 1;
}

const VS_WORLD = /* glsl */ `
  varying vec3 vWP; varying vec3 vN;
  void main() {
    mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = m * instanceMatrix;
  #endif
    vec4 wp = m * vec4(position, 1.0);
    vWP = wp.xyz; vN = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

// ---------------------------------------------------------------------------------------------------
// the hall

/** Floor (0), walls (1), ceiling (2), window frame (3). */
export function roomMaterial(U: WorldU, kind: 0 | 1 | 2 | 3, base: THREE.Color) {
  return new THREE.ShaderMaterial({
    defines: { KIND: kind },
    uniforms: { ...U, uBase: { value: base } },
    vertexShader: VS_WORLD,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      uniform vec3 uBase;
      varying vec3 vWP; varying vec3 vN;
      void main() {
        vec3 N = normalize(vN), p = vWP;
        vec3 V = normalize(cameraPosition - p);
        vec3 base = uBase;
        float gloss = 0.0;
      #if KIND == 0
        // parquet: planks along z, staggered
        float bw = 0.24, bl = 2.1;
        float row = floor(p.x / bw);
        float zz = p.z + h12(vec2(row, 3.0)) * bl;
        float pl = floor(zz / bl);
        float hv = h12(vec2(row, pl));
        vec2 fr = vec2(fract(p.x / bw), fract(zz / bl));
        vec2 fw = fwidth(vec2(p.x / bw, zz / bl)) + 1e-4;
        float sx = smoothstep(0.0, 1.5 * fw.x + 0.02, min(fr.x, 1.0 - fr.x));
        float sz = smoothstep(0.0, 1.5 * fw.y + 0.006, min(fr.y, 1.0 - fr.y));
        float seam = mix(1.0, sx * sz, clamp(1.0 - 3.0 * fw.x, 0.0, 1.0));
        float grain = 0.92 + 0.08 * sin(p.z * 23.0 + hv * 40.0 + sin(p.z * 3.0 + row) * 2.0);
        base *= (0.72 + 0.56 * hv) * grain * (0.5 + 0.5 * seam);
        gloss = 0.55 * (0.7 + 0.3 * hv) * seam;
      #elif KIND == 1
        // panelled walls: pilasters, a dado rail, a cornice
        float u = abs(N.x) > 0.5 ? p.z : p.x;
        float pu = fract(u / 3.2 + 0.5);
        float pil = smoothstep(0.42, 0.44, abs(pu - 0.5)) * 0.0 + (1.0 - smoothstep(0.06, 0.075, abs(pu - 0.5)));
        float dado = 1.0 - smoothstep(0.02, 0.035, abs(p.y - 1.05));
        float corn = smoothstep(7.9, 7.95, p.y) * (1.0 - smoothstep(8.25, 8.3, p.y));
        float panel = (p.y < 1.0 ? 0.85 : 1.0);
        base *= panel * (1.0 + 0.35 * pil + 0.5 * dado + 0.35 * corn);
      #elif KIND == 2
        base *= 0.8 + 0.2 * smoothstep(0.45, 0.5, abs(fract(p.x / 3.2) - 0.5));
      #endif
        vec3 c = base * uAmb;
        // moonlight through the window (direct light on the reveal and mullions, a window-shaped patch inside)
        float ml = (p.z < WZ - 0.005 ? 1.0 : moonAt(p)) * max(dot(N, uMoonL), 0.0) * uMoonK;
        c += base * uMoonCol * ml;
        c += base * disco(p, N);
        c += base * uPoolCol * pool(p) * max(N.y, 0.0);
        c += base * handGlow(p, N);
      #if KIND == 0
        // the polished floor reflects the window (the night sky and the moon), blurred
        vec3 R = reflect(-V, N);
        if (R.z < -0.02 && uMoonK > 0.001) {
          float s = (WZ - p.z) / R.z;
          vec3 q = p + R * s;
          float m = winMask(q.xy, 0.06 + 0.06 * s);
          float fres = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 md = normalize(uMoonPos - p);
          float ang = acos(clamp(dot(R, md), -1.0, 1.0)) * length(uMoonPos - p) / uMoonR;
          float moonR = exp(-ang * ang * 0.6) * 1.6 + exp(-ang * 0.35) * 0.25;
          vec3 sky = G_DUSK * 0.6 + uMoonCol * moonR * uMoonK;
          c += m * sky * fres * gloss;
        }
        // and the pool / the clasped hands, as glossy smears
        c += uPoolCol * pool(p) * 0.15 * gloss;
      #endif
        c = mix(uFogCol, c, fogK(p));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** Back wall with the arched opening, extruded (so the opening has a deep reveal). */
export function backWallGeometry() {
  const { x0, x1, h } = HALL;
  const sh = new THREE.Shape();
  sh.moveTo(x0, 0); sh.lineTo(x1, 0); sh.lineTo(x1, h); sh.lineTo(x0, h); sh.closePath();
  const hole = new THREE.Path();
  hole.moveTo(WIN.x - WIN.hw, WIN.y0);
  hole.lineTo(WIN.x + WIN.hw, WIN.y0);
  hole.lineTo(WIN.x + WIN.hw, WIN.ys);
  hole.absarc(WIN.x, WIN.ys, WIN.hw, 0, Math.PI, false);
  hole.lineTo(WIN.x - WIN.hw, WIN.y0);
  sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: WIN.depth, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, 0, WIN.z - WIN.depth);
  return g;
}

/** Mullions and transoms of the window (thin boxes inside the opening). */
export function mullionGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const w = WIN.mull * 2, d = 0.12, zc = WIN.z - WIN.depth * 0.45;
  for (const cx of WIN.cols) {
    const top = WIN.ys + Math.sqrt(Math.max(0, WIN.hw * WIN.hw - cx * cx));
    const g = new THREE.BoxGeometry(w, top - WIN.y0, d);
    g.translate(WIN.x + cx, (top + WIN.y0) / 2, zc);
    parts.push(g);
  }
  for (const y of WIN.rows) {
    const g = new THREE.BoxGeometry(WIN.hw * 2, w, d);
    g.translate(WIN.x, y, zc);
    parts.push(g);
  }
  // sill
  const s = new THREE.BoxGeometry(WIN.hw * 2 + 0.3, 0.1, WIN.depth + 0.25);
  s.translate(WIN.x, WIN.y0 - 0.05, WIN.z - WIN.depth / 2 + 0.12);
  parts.push(s);
  for (const p of parts) { p.deleteAttribute('uv'); }
  return mergeGeometries(parts, false)!;
}

// ---------------------------------------------------------------------------------------------------
// outside: sky, moon, halo

export function skyMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    depthWrite: false,
    vertexShader: VS_WORLD,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      varying vec3 vWP; varying vec3 vN;
      void main() {
        vec3 dir = normalize(vWP - cameraPosition);
        float el = dir.y;
        vec3 c = mix(G_DUSK * 1.1, G_NIGHT * 0.9, smoothstep(-0.02, 0.5, el));
        // stars (cells on the plane), twinkling
        vec2 g = vWP.xy * 1.7;
        vec2 id = floor(g), fp = fract(g) - 0.5;
        float hs = h12(id);
        vec2 off = vec2(h12(id + 3.7), h12(id + 9.1)) - 0.5;
        float st = step(0.86, hs) * exp(-dot(fp - off * 0.6, fp - off * 0.6) * 160.0) * (0.4 + 0.6 * h12(id + 1.3));
        st *= 0.7 + 0.3 * sin(uTime * (2.0 + 3.0 * hs) + hs * 40.0);
        c += vec3(0.8, 0.85, 1.0) * st * 1.4;
        // moon glow in the sky, swallowed with the moon
        vec3 md = normalize(uMoonPos - cameraPosition);
        float a = acos(clamp(dot(dir, md), -1.0, 1.0));
        c += uMoonCol * uMoonK * (0.10 * exp(-a * 9.0) + 0.05 * exp(-a * 2.5));
        // a thin cloud band low in the sky
        float cl = smoothstep(0.0, 1.0, sin(vWP.x * 0.13 + 1.7) * 0.5 + 0.5) * exp(-pow((vWP.y - 6.0 - 1.5 * sin(vWP.x * 0.07)) / 2.2, 2.0));
        c = mix(c, G_DUSK * 0.6 + uMoonCol * uMoonK * 0.03, cl * 0.6);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** The moon disc with a darkness that swallows it (uEat 0..1 from the direction uEatDir). */
export function moonMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uEat: { value: 0 }, uEatDir: { value: new THREE.Vector2(-0.7, 0.72).normalize() } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      uniform float uEat; uniform vec2 uEatDir;
      varying vec2 vUv;
      float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length(p);
        float disc = 1.0 - smoothstep(0.985, 1.0, r);
        if (disc <= 0.0) discard;
        float n = vn(p * 2.2 + 3.0) * 0.6 + vn(p * 5.0 + 11.0) * 0.3 + vn(p * 11.0) * 0.1;
        float maria = smoothstep(0.45, 0.7, n);
        float limb = 0.72 + 0.28 * sqrt(max(0.0, 1.0 - r * r));
        vec3 c = uMoonCol * 2.6 * limb * (1.0 - 0.32 * maria);
        // the darkness: a disc with a wavering edge sliding over the moon
        vec2 sc = uEatDir * 2.25 * (1.0 - uEat);
        vec2 dp = p - sc;
        float ang = atan(dp.y, dp.x);
        float edge = 1.06 + 0.035 * sin(ang * 7.0 + uTime * 1.3) + 0.02 * sin(ang * 13.0 - uTime * 2.1);
        float sd = length(dp) - edge;
        float dark = 1.0 - smoothstep(-0.05, 0.03, sd);
        float rimL = exp(-abs(sd) * 28.0) * (1.0 - dark) * 0.5;
        c = c * (1.0 - dark) + uMoonCol * rimL * step(0.001, uEat) * (1.0 - uEat);
        vec3 nightC = G_NIGHT * 0.9;
        gl_FragColor = vec4(mix(c, nightC, dark), disc);
      }`,
  });
}

export function haloMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uK: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      uniform float uK;
      varying vec2 vUv;
      void main() {
        float r = length(vUv * 2.0 - 1.0) * 4.0; // in moon radii
        float g = r < 1.0 ? 0.0 : exp(-(r - 1.0) * 1.6) * 0.5 + exp(-(r - 1.0) * 0.45) * 0.12;
        g *= 1.0 - smoothstep(3.0, 4.0, r);
        gl_FragColor = vec4(uMoonCol * g * uK, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------------------------------
// ghosts

/** Figure without arms (same proportions as toolkit's figureGeometry), feet at y = 0, facing +z. */
export function bodyGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const cap = (r: number, len: number, x: number, y: number, z: number) => {
    const g = new THREE.CapsuleGeometry(r, len, 3, 8);
    g.deleteAttribute('uv');
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
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

/** Arm hanging from its shoulder pivot at the origin along -y (hand at y = -ARM_LEN). */
export const ARM_LEN = 0.665;
export function armGeometry() {
  const g = new THREE.CapsuleGeometry(0.055, 0.56, 3, 8);
  g.deleteAttribute('uv');
  g.translate(0, -(0.28 + 0.05), 0);
  return g;
}

/**
 * Translucent ghost: a faint body with a glowing fresnel rim, dissolving toward the feet, wisps drifting
 * up; lit by the moon shafts, the spot pool and the mirror-ball spots. Additive. Per instance:
 * aG = (warmth, seed, gain, hand glow), aTint = the warm colour.
 */
export function ghostMaterial(U: WorldU, cold: THREE.Color, arm = false) {
  return new THREE.ShaderMaterial({
    defines: arm ? { ARM: 1 } : {},
    uniforms: { ...U, uCold: { value: cold } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec4 aG; attribute vec3 aTint;
      varying vec3 vWP, vN, vL, vTint; varying vec4 vG;
      void main() {
        mat4 m = modelMatrix;
      #ifdef USE_INSTANCING
        m = m * instanceMatrix;
      #endif
        vec4 wp = m * vec4(position, 1.0);
        float ph = aG.y * 37.0;
        wp.x += 0.011 * sin(wp.y * 6.5 - uTime * 2.6 + ph);
        wp.z += 0.011 * sin(wp.y * 5.3 - uTime * 2.1 + ph * 1.7);
        vWP = wp.xyz; vN = normalize(mat3(m) * normal); vL = position; vG = aG; vTint = aTint;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      uniform vec3 uCold;
      varying vec3 vWP, vN, vL, vTint; varying vec4 vG;
      float vn3(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = h12(i.xy + i.z * 17.0), b = h12(i.xy + vec2(1, 0) + i.z * 17.0), c = h12(i.xy + vec2(0, 1) + i.z * 17.0), d = h12(i.xy + vec2(1, 1) + i.z * 17.0);
        float e = h12(i.xy + (i.z + 1.0) * 17.0), g = h12(i.xy + vec2(1, 0) + (i.z + 1.0) * 17.0), h = h12(i.xy + vec2(0, 1) + (i.z + 1.0) * 17.0), k = h12(i.xy + vec2(1, 1) + (i.z + 1.0) * 17.0);
        return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z);
      }
      void main() {
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWP);
        float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
        float rim = pow(1.0 - ndv, 1.7);
      #ifdef ARM
        float along = clamp(-vL.y / ${f(ARM_LEN)}, 0.0, 1.0);
        float h = 1.36 - along * 0.6;
      #else
        float h = vL.y;
      #endif
        // dissolving into mist below the waist, a little brighter at the head and shoulders
        float legs = smoothstep(0.05, 1.15, h);
        legs *= legs;
        float mist = vn3(vWP * vec3(3.2, 2.2, 3.2) + vec3(0.0, -uTime * 0.55, vG.y * 13.0));
        mist = 0.55 + 0.75 * mist;
        vec3 tint = mix(uCold, vTint, vG.x);
        float body = (0.035 + 0.62 * rim + 0.05 * smoothstep(1.3, 1.62, h)) * mist * legs;
        vec3 c = tint * body * vG.z;
        float ml = moonAt(vWP) * uMoonK * (0.25 + 0.75 * max(dot(N, uMoonL), 0.0));
        c += uMoonCol * ml * (0.04 + 0.42 * rim) * legs * mist;
        c += uPoolCol * pool(vWP) * (0.3 + 0.7 * max(N.y, 0.0)) * (0.15 + 0.6 * rim) * legs * 0.6;
        c += disco(vWP, N) * (0.3 + 0.7 * rim) * legs * 0.8;
        c += handGlow(vWP, N) * (0.3 + rim) * 0.35 * (0.25 + 0.75 * legs);
      #ifdef ARM
        c += uHandCol * vG.w * smoothstep(0.4, 1.0, along) * (0.35 + 1.1 * rim);
      #endif
        float fl = 1.0 - 0.4 * step(0.972, h12(vec2(uFrame, vG.y * 97.0 + 1.0)));
        gl_FragColor = vec4(c * fl * fogK(vWP), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------------------------------
// light shafts and cones

/** Axial-billboard shafts (positions rewritten each frame): aUV = (across -1..1, along 0..1), aK = gain. */
export class Shafts extends THREE.Mesh {
  pos: Float32Array;
  declare material: THREE.ShaderMaterial;
  constructor(public n: number, U: WorldU, color: 'moon' | 'pool') {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 4 * 3), uv = new Float32Array(n * 4 * 2), k = new Float32Array(n * 4);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      uv.set([-1, 0, 1, 0, -1, 1, 1, 1], i * 8);
      const b = i * 4;
      idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aK', new THREE.BufferAttribute(k, 1).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      defines: color === 'moon' ? { MOON: 1 } : {},
      uniforms: { ...U },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec2 aUV; attribute float aK;
        varying vec2 vUV; varying float vK; varying vec3 vWP;
        void main() { vUV = aUV; vK = aK; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: /* glsl */ `
        ${GLSL_WORLD}
        varying vec2 vUV; varying float vK; varying vec3 vWP;
        void main() {
          float a = 1.0 - vUV.x * vUV.x; a *= a;
          float along = smoothstep(0.0, 0.05, vUV.y) * pow(1.0 - vUV.y, 1.2);
          float dust = 0.72 + 0.28 * sin(vWP.y * 2.6 + vWP.x * 1.3 - uTime * 0.45) * sin(vWP.z * 1.7 + uTime * 0.3 + vWP.y);
          float near = smoothstep(0.8, 3.2, length(vWP - cameraPosition));
        #ifdef MOON
          vec3 c = uMoonCol * uMoonK;
        #else
          vec3 c = uPoolCol;
        #endif
          gl_FragColor = vec4(c * (vK * a * along * dust * near) * fogK(vWP), 1.0);
        }`,
    });
    super(g, mat);
    this.pos = pos;
    this.frustumCulled = false;
  }

  /** Shaft i from a (width wa) to b (width wb), turned to face the camera around its axis. */
  set(i: number, a: THREE.Vector3, b: THREE.Vector3, wa: number, wb: number, k: number, cam: THREE.Vector3) {
    const ax = _v1.subVectors(b, a).normalize();
    const mid = _v2.addVectors(a, b).multiplyScalar(0.5);
    const view = _v3.subVectors(mid, cam).normalize();
    const side = _v4.crossVectors(ax, view);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    side.normalize();
    const P = this.pos, o = i * 12;
    P[o] = a.x - side.x * wa; P[o + 1] = a.y - side.y * wa; P[o + 2] = a.z - side.z * wa;
    P[o + 3] = a.x + side.x * wa; P[o + 4] = a.y + side.y * wa; P[o + 5] = a.z + side.z * wa;
    P[o + 6] = b.x - side.x * wb; P[o + 7] = b.y - side.y * wb; P[o + 8] = b.z - side.z * wb;
    P[o + 9] = b.x + side.x * wb; P[o + 10] = b.y + side.y * wb; P[o + 11] = b.z + side.z * wb;
    const K = (this.geometry.getAttribute('aK') as THREE.BufferAttribute).array as Float32Array;
    K[i * 4] = K[i * 4 + 1] = K[i * 4 + 2] = K[i * 4 + 3] = k;
  }

  commit() {
    (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aK') as THREE.BufferAttribute).needsUpdate = true;
  }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

/** Open cone from apex (top, uv.y = 1) to base, along +y before transform; aK per vertex. */
export function coneGeometry(r0: number, r1: number, len: number, radial = 28, k = 1) {
  const g = new THREE.CylinderGeometry(r0, r1, len, radial, 1, true);
  g.translate(0, -len / 2, 0); // apex at the origin, opening toward -y
  const n = g.getAttribute('position').count;
  g.setAttribute('aK', new THREE.Float32BufferAttribute(new Array(n).fill(k), 1));
  return g;
}

/** Volumetric cone: bright core (view-facing), fading along its length. */
export function coneMaterial(U: WorldU, color: THREE.Color) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: color }, uK: { value: 0 }, uFall: { value: 0.6 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aK;
      varying vec3 vWP, vN; varying float vAlong, vK;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vAlong = 1.0 - uv.y; vK = aK;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      uniform vec3 uColor; uniform float uK, uFall;
      varying vec3 vWP, vN; varying float vAlong, vK;
      void main() {
        vec3 V = normalize(cameraPosition - vWP);
        float ndv = abs(dot(normalize(vN), V));
        float core = pow(ndv, 2.2);
        float along = smoothstep(0.0, 0.04, vAlong) * pow(1.0 - 0.95 * vAlong, uFall) * (1.0 - smoothstep(0.9, 1.0, vAlong));
        float near = smoothstep(0.4, 2.0, length(vWP - cameraPosition));
        gl_FragColor = vec4(uColor * (uK * vK * core * along * near) * fogK(vWP), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------------------------------
// the mirror ball

export function ballMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uLit: { value: 0 }, uSrc: { value: new THREE.Vector3() } },
    vertexShader: /* glsl */ `
      varying vec3 vON, vWP;
      void main() { vON = normal; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      uniform float uLit; uniform vec3 uSrc;
      varying vec3 vON, vWP;
      void main() {
        vec3 n = normalize(vON);
        const float NR = 22.0;
        float dl = PI / NR;
        float lat = asin(clamp(n.y, -1.0, 1.0));
        float j = floor((lat + 0.5 * PI) / dl);
        float latc = -0.5 * PI + (j + 0.5) * dl;
        float cnt = max(1.0, floor(2.0 * PI * cos(latc) / dl));
        float lon = atan(n.z, n.x);
        float u = (lon + PI) / (2.0 * PI) * cnt;
        float k = floor(u);
        float lonc = -PI + (k + 0.5) * 2.0 * PI / cnt;
        vec3 fn = vec3(cos(latc) * cos(lonc), sin(latc), cos(latc) * sin(lonc));
        float cr = cos(uBallRot), sr = sin(uBallRot);
        vec3 wn = vec3(cr * fn.x + sr * fn.z, fn.y, -sr * fn.x + cr * fn.z); // the ball turns about y by uBallRot
        float fu = fract((lat + 0.5 * PI) / dl), fv = fract(u);
        float grout = smoothstep(0.0, 0.1, min(fu, 1.0 - fu)) * smoothstep(0.0, 0.1, min(fv, 1.0 - fv));
        vec3 V = normalize(cameraPosition - vWP);
        vec3 R = reflect(-V, wn);
        float hs = h12(vec2(j, k));
        vec3 env = vec3(0.025, 0.03, 0.06) * (0.4 + hs) + uMoonCol * uMoonK * pow(max(dot(R, normalize(uMoonPos - vWP)), 0.0), 40.0) * 1.5;
        vec3 L = normalize(uSrc - vWP);
        float glint = pow(max(dot(R, L), 0.0), 24.0) * 5.0;
        float spark = step(0.88, h12(vec2(j * 7.0 + k, floor(uFrame / 4.0)))) * 2.5;
        vec3 lit = vec3(0.22, 0.22, 0.25) * (0.3 + hs) + vec3(1.0, 0.97, 0.95) * (glint + spark * (0.3 + 0.7 * hs));
        vec3 c = (env + lit * uLit) * grout;
        gl_FragColor = vec4(c * fogK(vWP), 1.0);
      }`,
  });
}

/** Directions of the mirror ball's spot cells (ball frame), matching disco() in GLSL_WORLD. */
export function discoDirections(pick: (j: number, k: number) => boolean): THREE.Vector3[] {
  const NR = 17, dl = Math.PI / NR, out: THREE.Vector3[] = [];
  for (let j = 0; j < NR; j++) {
    const latc = -Math.PI / 2 + (j + 0.5) * dl;
    const n = Math.max(1, Math.floor((2 * Math.PI * Math.cos(latc)) / dl));
    for (let k = 0; k < n; k++) {
      if (!pick(j, k)) continue;
      const lonc = -Math.PI + ((k + 0.5) * 2 * Math.PI) / n;
      out.push(new THREE.Vector3(Math.cos(latc) * Math.cos(lonc), Math.sin(latc), Math.cos(latc) * Math.sin(lonc)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// auras: a soft additive glow around each ghost (vertical billboard, turned toward the camera)

export class Auras extends THREE.InstancedMesh {
  declare material: THREE.ShaderMaterial;
  aC: Float32Array;
  constructor(n: number, U: WorldU) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0); // origin at the feet
    const aC = new Float32Array(n * 4);
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(aC, 4).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 aC;
        varying vec2 vUv; varying vec3 vC; varying vec3 vWP;
        void main() {
          vec3 c = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 sx = vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]);
          vec3 sy = vec3(instanceMatrix[1][0], instanceMatrix[1][1], instanceMatrix[1][2]);
          vec3 toCam = cameraPosition - c; toCam.y = 0.0;
          vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
          vec3 wp = c + right * position.x * length(sx) + vec3(0.0, 1.0, 0.0) * position.y * length(sy);
          vUv = uv; vC = aC.rgb * aC.a; vWP = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_WORLD}
        varying vec2 vUv; varying vec3 vC; varying vec3 vWP;
        void main() {
          float x = (vUv.x - 0.5) * 2.0;
          float y = vUv.y;
          float a = exp(-x * x * 4.5) * smoothstep(0.0, 0.45, y) * (1.0 - smoothstep(0.62, 1.0, y));
          float ml = moonAt(vWP) * uMoonK;
          float near = smoothstep(0.6, 2.2, length(vWP - cameraPosition));
          gl_FragColor = vec4(vC * a * (1.0 + 1.6 * ml) * near * fogK(vWP), 1.0);
        }`,
    });
    super(g, mat, n);
    this.aC = aC;
    this.frustumCulled = false;
    this.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  /** Aura i at the feet position p, w wide and h tall, colour c times k. */
  setAura(i: number, p: THREE.Vector3, w: number, h: number, c: THREE.Color, k: number) {
    _m.makeScale(w, h, 1).setPosition(p);
    this.setMatrixAt(i, _m);
    this.aC.set([c.r, c.g, c.b, k], i * 4);
  }

  commit() {
    this.instanceMatrix.needsUpdate = true;
    (this.geometry.getAttribute('aC') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}
const _m = new THREE.Matrix4();
