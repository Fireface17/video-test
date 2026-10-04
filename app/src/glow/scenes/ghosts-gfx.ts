// Graphics for the `ghosts` scene: the hall (polished floor, panelled walls, a coffered ceiling that opens to the
// sky, a tall arched window), the night sky dome, the moon and the night that swallows it, the moonlight shafts,
// and the warm light map (a small top-down render of everyone who glows, which lights the floor and the walls).
// All lighting is analytic in the shaders, so the scene uses no three.js lights.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLSL_GLOW_PALETTE } from '../lib/palette';

/** The arched window in the back wall (z = WIN.z), in metres. */
export const WIN = { x: 0, hw: 2.4, y0: 1.0, ys: 6.0, z: -12, depth: 0.7, mull: 0.042, cols: [-0.92, 0.92], rows: [2.3, 6.0] };
/** z of the glass inside the reveal. */
export const GLASS_Z = WIN.z - WIN.depth * 0.45 + 0.07;
/** Hall extents: side walls at x0/x1, front wall at z1, ceiling height h. */
export const HALL = { x0: -12, x1: 12, z1: 12, h: 9.5 };
/** The moon, seen through the window (high in the middle panes from inside the hall). */
export const MOON = { pos: new THREE.Vector3(-0.5, 23.0, -41.5), r: 3.45 };
/** Direction toward the moon for the light falling through the window. */
export const MOON_L = new THREE.Vector3(-0.015, 0.545, -0.84).normalize();
/** The light map covers the hall floor: x, z in [-MAP_S/2, MAP_S/2]. */
export const MAP_S = 24;
/** Ceiling coffers: CEIL_N x CEIL_N panels. */
export const CEIL_N = 6;

// ---------------------------------------------------------------------------------------------------
// shared uniforms + GLSL helpers

export function worldUniforms() {
  return {
    uTime: { value: 0 },
    uFrame: { value: 0 },
    uAmb: { value: 0.1 },
    uFogCol: { value: new THREE.Color() },
    uFogD: { value: 0.04 },
    uMoonL: { value: MOON_L.clone() },
    uMoonCol: { value: new THREE.Color() },
    uMoonK: { value: 1 },
    uMoonPos: { value: MOON.pos.clone() },
    uMoonR: { value: MOON.r },
    uHand0: { value: new THREE.Vector3() },
    uHand1: { value: new THREE.Vector3() },
    uHandK: { value: new THREE.Vector2() },
    uHandCol: { value: new THREE.Color() },
    uMap: { value: null as THREE.Texture | null },
    uMapK: { value: 0 },
    /** Average warm light in the hall (fills the far walls and the ceiling). */
    uFill: { value: new THREE.Color(0, 0, 0) },
    /** 0..1: how far the roof has opened (starlight from above). */
    uOpen: { value: 0 },
  };
}
export type WorldU = ReturnType<typeof worldUniforms>;

const f = (x: number) => x.toFixed(4);

export const GLSL_WORLD = /* glsl */ `
${GLSL_GLOW_PALETTE}
#define PI 3.14159265
uniform float uTime, uFrame, uAmb;
uniform vec3 uFogCol; uniform float uFogD;
uniform vec3 uMoonL, uMoonCol, uMoonPos; uniform float uMoonK, uMoonR;
uniform vec3 uHand0, uHand1, uHandCol; uniform vec2 uHandK;
uniform sampler2D uMap; uniform float uMapK; uniform vec3 uFill; uniform float uOpen;

float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vn3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

const float WX = ${f(WIN.x)}, WHW = ${f(WIN.hw)}, WY0 = ${f(WIN.y0)}, WYS = ${f(WIN.ys)}, WZ = ${f(WIN.z)}, MULL = ${f(WIN.mull)};
/** 1 inside the glazing of the arched window (wall-plane coordinates), 0 on the wall and the mullions. */
float winMask(vec2 q, float soft) {
  float dx = WHW - abs(q.x - WX);
  float dy = q.y - WY0;
  float da = q.y > WYS ? WHW - length(q - vec2(WX, WYS)) : 1e3;
  float m = smoothstep(-soft, soft, min(min(dx, dy), da));
  float mv = min(abs(q.x - (WX + ${f(WIN.cols[0]!)})), abs(q.x - (WX + ${f(WIN.cols[1]!)}))) - MULL;
  float mh = min(abs(q.y - ${f(WIN.rows[0]!)}), abs(q.y - ${f(WIN.rows[1]!)})) - MULL;
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
/** The warm light of the people of light around p (from the top-down light map). */
vec3 mapAt(vec3 p) {
  vec2 uv = vec2(p.x / ${f(MAP_S)} + 0.5, 0.5 - p.z / ${f(MAP_S)});
  return texture2D(uMap, clamp(uv, 0.0, 1.0)).rgb * uMapK;
}
/** Warm light of the clasped hands. */
vec3 handGlow(vec3 p, vec3 N) {
  vec3 d0 = uHand0 - p, d1 = uHand1 - p;
  float l0 = length(d0), l1 = length(d1);
  float a = uHandK.x * (0.3 + 0.7 * max(dot(N, d0 / max(l0, 1e-4)), 0.0)) / (1.0 + 7.0 * l0 * l0);
  float b = uHandK.y * (0.3 + 0.7 * max(dot(N, d1 / max(l1, 1e-4)), 0.0)) / (1.0 + 7.0 * l1 * l1);
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
  varying vec3 vWP; varying vec3 vN; varying vec3 vOP;
  void main() {
    mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
    m = m * instanceMatrix;
  #endif
    vec4 wp = m * vec4(position, 1.0);
    vWP = wp.xyz; vN = normalize(mat3(m) * normal); vOP = position;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

// ---------------------------------------------------------------------------------------------------
// the hall

/** Floor (0), walls (1), ceiling panels (2), window frame and columns (3). */
export function roomMaterial(U: WorldU, kind: 0 | 1 | 2 | 3, base: THREE.Color) {
  return new THREE.ShaderMaterial({
    defines: { KIND: kind },
    uniforms: { ...U, uBase: { value: base } },
    side: kind === 2 ? THREE.DoubleSide : THREE.FrontSide,
    vertexShader: VS_WORLD,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      uniform vec3 uBase;
      varying vec3 vWP; varying vec3 vN; varying vec3 vOP;
      void main() {
        vec3 N = normalize(vN), p = vWP;
        if (!gl_FrontFacing) N = -N;
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
        float pil = 1.0 - smoothstep(0.06, 0.075, abs(pu - 0.5));
        float dado = 1.0 - smoothstep(0.02, 0.035, abs(p.y - 1.05));
        float corn = smoothstep(7.9, 7.95, p.y) * (1.0 - smoothstep(8.25, 8.3, p.y));
        float panel = (p.y < 1.0 ? 0.85 : 1.0);
        base *= panel * (1.0 + 0.35 * pil + 0.5 * dado + 0.35 * corn);
      #elif KIND == 2
        // coffered panel: a sunken square with a moulded rim (object coordinates, panel 4 x 4 m)
        vec2 cq = abs(vOP.xz) / 2.0;
        float e = max(cq.x, cq.y);
        base *= mix(0.75, 1.0, smoothstep(0.78, 0.8, e)) * (1.0 + 0.4 * (1.0 - smoothstep(0.0, 0.02, abs(e - 0.79))));
      #endif
        vec3 c = base * uAmb;
        // moonlight through the window (direct light on the reveal and mullions, a window-shaped patch inside)
        float ml = (p.z < WZ - 0.005 ? 1.0 : moonAt(p)) * max(dot(N, uMoonL), 0.0) * uMoonK;
        c += base * uMoonCol * ml;
        c += base * handGlow(p, N);
        // the warm light of the people of light: from the light map near the floor, and the fill
        vec3 wm = mapAt(p);
      #if KIND == 0
        c += base * wm * 1.4;
      #elif KIND == 2
        c += base * (uFill * 0.3 + wm * 0.2) * max(-N.y, 0.25);
      #else
        c += base * wm * exp(-max(p.y - 1.2, 0.0) / 3.5) * (0.4 + 0.6 * max(dot(N, normalize(vec3(-p.x, 1.0, -p.z) + 1e-4)), 0.0));
        c += base * uFill * (0.15 + 0.85 * exp(-max(p.y - 0.8, 0.0) / 3.2));
      #endif
      #if KIND == 0
        c += base * uFill * 0.6;
        // the polished floor reflects the window (the night sky and the moon), blurred
        vec3 R = reflect(-V, N);
        float fres = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        if (R.z < -0.02 && uMoonK > 0.001) {
          float s = (WZ - p.z) / R.z;
          vec3 q = p + R * s;
          float m = winMask(q.xy, 0.06 + 0.06 * s);
          vec3 md = normalize(uMoonPos - p);
          float ang = acos(clamp(dot(R, md), -1.0, 1.0)) * length(uMoonPos - p) / uMoonR;
          float moonR = exp(-ang * ang * 0.6) * 1.6 + exp(-ang * 0.35) * 0.25;
          vec3 sky = G_DUSK * 0.6 + uMoonCol * moonR * uMoonK;
          c += m * sky * fres * gloss;
        }
        // and the warm glow, as a glossy smear
        c += wm * 0.35 * gloss * (0.3 + fres) + uHandCol * (uHandK.x + uHandK.y) * 0.0;
      #endif
        c = mix(uFogCol * (0.6 + 0.4 * uMoonK) + uFill * 0.08, c, fogK(p));
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
  const g = new THREE.ExtrudeGeometry(sh, { depth: WIN.depth, bevelEnabled: false, curveSegments: 32 });
  g.translate(0, 0, WIN.z - WIN.depth);
  return g;
}

/** Mullions and transoms of the window (thin boxes inside the opening), and the sill. */
export function mullionGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const w = WIN.mull * 2, d = 0.1, zc = GLASS_Z - 0.02;
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
  const s = new THREE.BoxGeometry(WIN.hw * 2 + 0.3, 0.1, WIN.depth + 0.25);
  s.translate(WIN.x, WIN.y0 - 0.05, WIN.z - WIN.depth / 2 + 0.12);
  parts.push(s);
  for (const p of parts) p.deleteAttribute('uv');
  return mergeGeometries(parts, false)!;
}

/** Coffered ceiling panels (one box, 4 x 4 m, instanced CEIL_N^2 times; moved per frame as the roof opens). */
export function ceilingPanelGeometry() {
  const s = (HALL.x1 - HALL.x0) / CEIL_N;
  const g = new THREE.BoxGeometry(s - 0.02, 0.3, s - 0.02);
  g.deleteAttribute('uv');
  return g;
}

// ---------------------------------------------------------------------------------------------------
// outside: the sky dome (stars, a cloud band, the moon's glow), the moon and its halo

export function skyMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      varying vec3 vD;
      float pow2s(float x) { return x * x; }
      vec3 stars(vec3 d, float scale, float thr) {
        // a jittered star per 3D cell around the unit sphere (round everywhere)
        vec3 p = d * scale;
        vec3 id = floor(p);
        float hs = h13(id + 17.0);
        vec3 sp = id + 0.2 + 0.6 * vec3(h13(id + 3.7), h13(id + 9.1), h13(id + 5.3));
        vec3 q = p - sp; q -= d * dot(q, d);
        float st = step(thr, hs) * exp(-dot(q, q) * 90.0) * (0.35 + 0.65 * h13(id + 1.3));
        st *= 0.65 + 0.35 * sin(uTime * (1.5 + 3.0 * hs) + hs * 40.0);
        float warm = h13(id + 5.5);
        return mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.7), step(0.8, warm)) * st;
      }
      void main() {
        vec3 dir = normalize(vD);
        float el = dir.y;
        vec3 c = mix(G_DUSK * 0.9, G_NIGHT * 0.7, smoothstep(-0.05, 0.6, el));
        // a faint band of the galaxy across the sky, denser stars in it
        vec3 gn = normalize(vec3(0.35, 0.5, 0.79));
        float band = exp(-dot(dir, gn) * dot(dir, gn) * 14.0);
        c += vec3(0.07, 0.065, 0.1) * band * (0.6 + 0.4 * vn3(dir * 9.0)) * smoothstep(-0.1, 0.2, el);
        c += stars(dir, 70.0, 0.8 - 0.12 * band) * 1.5 + stars(dir, 150.0, 0.86 - 0.1 * band) * 0.8;
        // the moon's glow, swallowed with the moon
        vec3 md = normalize(uMoonPos - cameraPosition);
        float a = acos(clamp(dot(dir, md), -1.0, 1.0));
        c += uMoonCol * uMoonK * (0.10 * exp(-a * 9.0) + 0.04 * exp(-a * 2.5));
        // a thin cloud band low in the sky
        float cl = smoothstep(0.0, 1.0, sin(dir.x * 6.0 + 1.7) * 0.5 + 0.5) * exp(-pow2s((el - 0.12 - 0.04 * sin(dir.x * 3.0)) / 0.07));
        c = mix(c, G_DUSK * 0.55 + uMoonCol * uMoonK * 0.03, cl * 0.6);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** GLSL: the night that swallows the moon, in moon-plane units (moon radius 1): 1 = dark. */
export const GLSL_EAT = /* glsl */ `
uniform float uEat; uniform vec2 uEatDir;
float eatMask(vec2 p, float t) {
  // a dark mass with a billowing edge sliding in from uEatDir, then closing over everything
  vec2 c = uEatDir * mix(8.2, -0.8, uEat);
  vec2 d = p - c;
  float r = length(d);
  float ang = atan(d.y, d.x + 1e-6);
  float edge = 3.0 + 0.16 * sin(ang * 5.0 + t * 0.9) + 0.09 * sin(ang * 11.0 - t * 1.7) + 0.05 * sin(ang * 23.0 + t * 2.3);
  return 1.0 - smoothstep(-0.08, 0.06, r - edge);
}`;

/** The moon disc, swallowed by the night (uEat 0..1 from the direction uEatDir). */
export function moonMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uEat: { value: 0 }, uEatDir: { value: new THREE.Vector2(-0.8, 0.6).normalize() } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      ${GLSL_EAT}
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
        float dark = eatMask(p, uTime);
        gl_FragColor = vec4(mix(c, G_NIGHT * 0.6, dark), disc);
      }`,
  });
}

export function haloMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uK: { value: 1 }, uEat: { value: 0 }, uEatDir: { value: new THREE.Vector2(-0.8, 0.6).normalize() } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      ${GLSL_EAT}
      uniform float uK;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv * 2.0 - 1.0) * 4.0; // in moon radii
        float r = length(p);
        float g = r < 1.0 ? 0.0 : exp(-(r - 1.0) * 1.6) * 0.5 + exp(-(r - 1.0) * 0.45) * 0.12;
        g *= 1.0 - smoothstep(3.0, 4.0, r);
        gl_FragColor = vec4(uMoonCol * g * uK * (1.0 - eatMask(p, uTime)), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------------------------------
// moonlight shafts

/** Axial-billboard shafts (positions rewritten each frame): aUV = (across -1..1, along 0..1), aK = gain. */
export class Shafts extends THREE.Mesh {
  pos: Float32Array;
  declare material: THREE.ShaderMaterial;
  constructor(public n: number, U: WorldU) {
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
          // one wide shaft: the window's own shape (panes and bars) projected back along the moonlight
          float m = moonAt(vWP);
          float along = smoothstep(0.0, 0.04, vUV.y) * (1.0 - smoothstep(0.75, 1.0, vUV.y)) * (1.0 - 0.55 * vUV.y);
          float dust = 0.75 + 0.25 * sin(vWP.y * 2.6 + vWP.x * 1.3 - uTime * 0.45) * sin(vWP.z * 1.7 + uTime * 0.3 + vWP.y);
          float near = smoothstep(0.8, 3.2, length(vWP - cameraPosition));
          float side = 1.0 - smoothstep(0.75, 1.0, abs(vUV.x));
          gl_FragColor = vec4(uMoonCol * uMoonK * (vK * m * along * dust * near * side) * fogK(vWP), 1.0);
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

// ---------------------------------------------------------------------------------------------------
// the window glass: a faint cold sheen with condensation gathering low on each pane

export function glassMaterial(U: WorldU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uK: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: VS_WORLD,
    fragmentShader: /* glsl */ `
      ${GLSL_WORLD}
      uniform float uK;
      varying vec3 vWP; varying vec3 vN; varying vec3 vOP;
      void main() {
        float m = winMask(vWP.xy, 0.01);
        if (m <= 0.0) discard;
        // pane-local height: condensation thickest at the bottom of each pane
        float y = vWP.y;
        float pb = y < ${f(WIN.rows[0]!)} ? ${f(WIN.y0)} : y < ${f(WIN.rows[1]!)} ? ${f(WIN.rows[0]!)} : ${f(WIN.rows[1]!)};
        float low = exp(-(y - pb) * 2.2);
        float n = vn3(vec3(vWP.xy * vec2(7.0, 9.0), 1.0)) * 0.6 + vn3(vec3(vWP.xy * 23.0, 2.0)) * 0.4;
        float fog = (0.25 + 0.75 * low) * (0.55 + 0.45 * n);
        // droplets
        vec2 g = vWP.xy * 26.0; vec2 id = floor(g); vec2 fp = fract(g) - 0.5;
        float dr = step(0.86, h12(id)) * exp(-dot(fp, fp) * 40.0) * (0.3 + low);
        vec3 c = uMoonCol * uMoonK * (0.018 * fog + 0.05 * dr) + G_DUSK * 0.05 * fog;
        gl_FragColor = vec4(c * m * uK * fogK(vWP), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------------------------------
// the light map: a top-down render of soft warm blobs (people of light, the clasped hands), sampled by the
// room and the bodies

export class LightMap {
  rt = new THREE.WebGLRenderTarget(128, 128, { type: THREE.HalfFloatType, depthBuffer: false });
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-MAP_S / 2, MAP_S / 2, MAP_S / 2, -MAP_S / 2, 0.1, 50);
  blobs: THREE.InstancedMesh;
  private col: Float32Array;
  private m = new THREE.Matrix4();
  n = 0;

  constructor(public max: number) {
    this.cam.position.set(0, 20, 0);
    this.cam.up.set(0, 0, -1);
    this.cam.lookAt(0, 0, 0);
    this.cam.updateMatrixWorld();
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateX(-Math.PI / 2);
    this.col = new Float32Array(max * 3);
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `attribute vec3 aC; varying vec3 vC; varying vec2 vUv;
        void main() { vC = aC; vUv = uv; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `varying vec3 vC; varying vec2 vUv;
        void main() { vec2 p = vUv * 2.0 - 1.0; float r2 = dot(p, p); gl_FragColor = vec4(vC * (exp(-r2 * 4.0) - 0.0183) * step(r2, 1.0), 1.0); }`,
    });
    this.blobs = new THREE.InstancedMesh(g, mat, max);
    this.blobs.frustumCulled = false;
    this.blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.blobs);
  }

  begin() { this.n = 0; }

  /** A blob of light at (x, z), radius r (m), colour c times k. */
  add(x: number, z: number, r: number, c: THREE.Color, k: number) {
    if (this.n >= this.max || k <= 0) return;
    this.m.makeScale(r * 2, 1, r * 2).setPosition(x, 0, z);
    this.blobs.setMatrixAt(this.n, this.m);
    this.col.set([c.r * k, c.g * k, c.b * k], this.n * 3);
    this.n++;
  }

  render(renderer: THREE.WebGLRenderer) {
    this.blobs.count = Math.max(this.n, 0);
    this.blobs.instanceMatrix.needsUpdate = true;
    (this.blobs.geometry.getAttribute('aC') as THREE.InstancedBufferAttribute).needsUpdate = true;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, false, false);
    if (this.n > 0) renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }
}
