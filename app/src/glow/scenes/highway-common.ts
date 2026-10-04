// Highway scene, shared foundation: the road's cross-section, the lighting rig every material shares
// (sodium streetlights repeating along the road, our headlights, the gas-station canopy, the dawn sun,
// sky ambient), the haze, and a small physically-flavoured material built on it.
//
// World: the road runs along -z (a road coordinate u = -z), x to the right, y up, metres. The median is at
// x = 0, our carriageway (3 lanes) on the right, the oncoming one mirrored on the left.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const ROAD = {
  lane: 3.6,
  inner: 1.0, // inner edge line (x), next to the median
  outer: 11.8, // outer edge line
  asphalt: 14.6, // asphalt (hard shoulder) ends
  rail: 15.1, // guardrail
  lampP: 42, // streetlight spacing along the road
  lampH: 11.2, // lamp head height
  lampArm: 2.6, // lamp heads at x = ±lampArm (double-arm poles on the median)
  dashL: 3.0,
  dashP: 12.0,
  laneX: (i: number) => 1.0 + 3.6 * (i + 0.5), // centre of lane i (0 = fast lane)
} as const;

/** Uniforms shared by every material of the scene (update once per frame). */
export const HU = {
  uLampCol: { value: new THREE.Color(1, 0.55, 0.18) },
  uLampOffU: { value: -1e5 }, // lamps at road coordinate < this are switched off (the dawn wave)
  uAmbHi: { value: new THREE.Color() },
  uAmbLo: { value: new THREE.Color() },
  uSunDir: { value: new THREE.Vector3(0, 0.05, 1) },
  uSunCol: { value: new THREE.Color(0, 0, 0) },
  uHeadPos: { value: new THREE.Vector3(0, -100, 0) },
  uHeadOn: { value: 0 },
  uPoolPos: { value: new THREE.Vector3(0, -100, 0) },
  uPoolCol: { value: new THREE.Color(0, 0, 0) },
  uPoolR: { value: 10 },
  uFogD: { value: 0.0042 },
  uHazeLo: { value: new THREE.Color() }, // haze colour at the horizon away from the city
  uHazeCity: { value: new THREE.Color() }, // extra sodium glow of the haze toward the city (ahead, -z)
  uHazeSun: { value: new THREE.Color() }, // dawn glow of the haze toward the sun
  uSunAz: { value: new THREE.Vector2(0, 1) }, // horizontal direction of the sun (x, z)
  uTime: { value: 0 },
};

/** GLSL: the shared uniforms, the light rig and the haze. */
export const HW_GLSL = /* glsl */ `
uniform vec3 uLampCol; uniform float uLampOffU;
uniform vec3 uAmbHi, uAmbLo;
uniform vec3 uSunDir, uSunCol;
uniform vec3 uHeadPos; uniform float uHeadOn;
uniform vec3 uPoolPos, uPoolCol; uniform float uPoolR;
uniform float uFogD;
uniform vec3 uHazeLo, uHazeCity, uHazeSun; uniform vec2 uSunAz;
uniform float uTime;
#define LAMP_P ${ROAD.lampP.toFixed(2)}
#define LAMP_H ${ROAD.lampH.toFixed(2)}
#define LAMP_ARM ${ROAD.lampArm.toFixed(2)}

float hwH12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

// cobra-head luminaire: wide along the road, cut off above ~70 degrees from the nadir
float hwLampDist(vec3 d) { float c = -d.y; return smoothstep(0.22, 0.62, c) * (0.45 + 0.55 * c * c); }

// GGX-ish specular lobe (normalised enough for our purposes)
float hwSpec(vec3 N, vec3 L, vec3 V, float rough) {
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0), a = max(rough * rough, 0.002), a2 = a * a;
  float d = nh * nh * (a2 - 1.0) + 1.0;
  return a2 / (3.14159 * d * d) * 0.25;
}

// streetlights (double-arm poles on the median every LAMP_P): diffuse irradiance + specular radiance
void hwLamps(vec3 P, vec3 N, vec3 V, float rough, float specK, inout vec3 diff, inout vec3 spec) {
  float u = -P.z;
  float k0 = floor(u / LAMP_P);
  float kc = floor(u / LAMP_P + 0.5);
  for (int j = -1; j <= 1; j++) {
    float lu = (kc + float(j)) * LAMP_P;
    float on = step(uLampOffU, lu);
    if (on < 0.5) continue;
    float flick = 0.92 + 0.08 * hwH12(vec2(lu, 3.0));
    for (int s = 0; s < 2; s++) {
      vec3 Lp = vec3(s == 0 ? -LAMP_ARM : LAMP_ARM, LAMP_H, -lu);
      vec3 Lv = Lp - P; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
      float ndl = max(dot(N, L), 0.0);
      float I = hwLampDist(-L) * flick / (d2 + 1.0);
      diff += uLampCol * (I * ndl);
      if (specK > 0.0 && j == 0) spec += uLampCol * (I * ndl * hwSpec(N, L, V, rough) * specK);
    }
  }
}

// our low-beam headlights: a wide flat beam ahead of the car with a sharp upper cut-off
vec3 hwHead(vec3 P, vec3 N) {
  if (uHeadOn <= 0.0) return vec3(0.0);
  vec3 acc = vec3(0.0);
  for (int s = 0; s < 2; s++) {
    vec3 Lp = uHeadPos + vec3(s == 0 ? -0.72 : 0.72, 0.0, 0.0);
    vec3 Lv = Lp - P; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
    vec3 d = -L;
    if (d.z > -0.05) continue;
    float ah = d.x / -d.z, av = d.y / -d.z;
    float beam = exp(-ah * ah * 5.0) * smoothstep(0.012, -0.03, av + 0.004 * sign(ah) - 0.01) + 0.25 * exp(-ah * ah * 1.2) * smoothstep(0.0, -0.08, av);
    acc += vec3(1.0, 0.96, 0.9) * beam * max(dot(N, L), 0.0) / (d2 * 0.04 + 1.0);
  }
  return acc * uHeadOn;
}

// everything but specular: ambient + lamps + headlights + canopy pool + sun
vec3 hwLight(vec3 P, vec3 N, vec3 V, float rough, float specK, out vec3 spec) {
  vec3 diff = mix(uAmbLo, uAmbHi, N.y * 0.5 + 0.5);
  spec = vec3(0.0);
  hwLamps(P, N, V, rough, specK, diff, spec);
  diff += hwHead(P, N) * 1.2;
  if (uPoolCol.r + uPoolCol.g + uPoolCol.b > 0.0) {
    vec3 Lv = uPoolPos - P; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
    float r = length((P - uPoolPos).xz) / uPoolR;
    diff += uPoolCol * max(dot(N, L), 0.0) * exp(-r * r * 1.4) * (0.35 + 0.65 * smoothstep(-0.2, 0.6, N.y));
    if (specK > 0.0) spec += uPoolCol * exp(-r * r * 1.4) * hwSpec(N, L, V, rough) * specK * max(dot(N, L), 0.0) * 4.0;
  }
  float sd = max(dot(N, uSunDir), 0.0);
  diff += uSunCol * sd;
  if (specK > 0.0) spec += uSunCol * sd * hwSpec(N, uSunDir, V, rough) * specK;
  return diff;
}

// haze colour seen in direction d (the sky's own horizon colour that way)
vec3 hwHaze(vec3 d) {
  vec2 h = normalize(d.xz + vec2(1e-5));
  float fz = max(-h.y, 0.0), fs = max(dot(h, uSunAz), 0.0);
  fs *= fs;
  return uHazeLo + uHazeCity * (fz * fz * fz) + uHazeSun * (fs * fs);
}
vec3 hwFog(vec3 c, vec3 P, vec3 camPos) {
  vec3 V = P - camPos; float d = length(V);
  // denser near the ground
  float hk = mix(1.0, 0.45, smoothstep(2.0, 60.0, P.y));
  float x = d * uFogD * hk;
  float f = 1.0 - exp(-x * sqrt(x) * 0.85 - x * 0.15);
  return mix(c, hwHaze(V / d), f);
}
`;

export interface LitOpts {
  color?: THREE.Color;
  rough?: number;
  metal?: number;
  spec?: number; // specular strength (dielectric ~0.5, polished ~1)
  emissive?: THREE.Color;
  map?: THREE.Texture | null; // albedo (sRGB) multiplied into color
  grime?: number; // world-space procedural grime amount
  vcolor?: boolean;
  side?: THREE.Side;
  /** custom GLSL appended to the fragment before lighting: may modify alb, rough, emis (vUv, vW, vN available) */
  frag?: string;
  uniforms?: Record<string, THREE.IUniform>;
  fog?: boolean;
}

/** The scene's standard lit material (instancing and instance colours supported). */
export function litMat(o: LitOpts = {}) {
  const defines: Record<string, string> = {};
  if (o.map) defines.USE_ALBMAP = '';
  if (o.vcolor) defines.USE_VC = '';
  if (o.fog !== false) defines.USE_HFOG = '';
  const mat = new THREE.ShaderMaterial({
    defines,
    side: o.side ?? THREE.FrontSide,
    uniforms: {
      ...HU,
      baseCol: { value: (o.color ?? new THREE.Color(0.1, 0.1, 0.1)).clone() },
      rough: { value: o.rough ?? 0.6 },
      metal: { value: o.metal ?? 0 },
      specK: { value: o.spec ?? 0.5 },
      emis: { value: (o.emissive ?? new THREE.Color(0, 0, 0)).clone() },
      albMap: { value: o.map ?? null },
      grime: { value: o.grime ?? 0 },
      ...(o.uniforms ?? {}),
    },
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vC;
      #ifdef USE_VC
      attribute vec3 color;
      #endif
      void main() {
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
        m = m * instanceMatrix;
        #endif
        vec4 w = m * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(m) * normal);
        vUv = uv;
        vC = vec3(1.0);
        #ifdef USE_VC
        vC *= color;
        #endif
        #ifdef USE_INSTANCING_COLOR
        vC *= instanceColor;
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: HW_GLSL + /* glsl */ `
      uniform vec3 baseCol, emis; uniform float rough, metal, specK, grime;
      uniform sampler2D albMap;
      ${Object.keys(o.uniforms ?? {}).length ? '' : ''}
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vC;
      ${o.uniforms ? Object.entries(o.uniforms).map(([k, u]) => `uniform ${glslType(u.value)} ${k};`).join('\n') : ''}
      void main() {
        vec3 alb = baseCol * vC;
        #ifdef USE_ALBMAP
        alb *= texture2D(albMap, vUv).rgb;
        #endif
        float rgh = rough;
        vec3 em = emis;
        if (grime > 0.0) {
          // streaky weathering: smooth value noise, stretched vertically (rain runs), darker low down
          vec3 q = vW * vec3(1.3, 0.25, 1.3);
          vec3 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
          float n00 = mix(hwH12(i.xz + i.y * 17.0), hwH12(i.xz + vec2(1.0, 0.0) + i.y * 17.0), f.x);
          float n01 = mix(hwH12(i.xz + vec2(0.0, 1.0) + i.y * 17.0), hwH12(i.xz + vec2(1.0, 1.0) + i.y * 17.0), f.x);
          float n10 = mix(hwH12(i.xz + (i.y + 1.0) * 17.0), hwH12(i.xz + vec2(1.0, 0.0) + (i.y + 1.0) * 17.0), f.x);
          float n11 = mix(hwH12(i.xz + vec2(0.0, 1.0) + (i.y + 1.0) * 17.0), hwH12(i.xz + vec2(1.0, 1.0) + (i.y + 1.0) * 17.0), f.x);
          float g = mix(mix(n00, n01, f.z), mix(n10, n11, f.z), f.y);
          alb *= 1.0 - grime * (0.4 * g + 0.25 * exp(-vW.y * 1.5));
          rgh = clamp(rgh + grime * 0.35 * (g - 0.3), 0.05, 1.0);
        }
        ${o.frag ?? ''}
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        vec3 spec;
        vec3 diff = hwLight(vW, N, V, rgh, specK, spec);
        vec3 c = alb * diff * (1.0 - metal * 0.85) + spec * mix(vec3(1.0), alb * 4.0, metal);
        c += em;
        #ifdef USE_HFOG
        c = hwFog(c, vW, cameraPosition);
        #endif
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  return mat;
}

function glslType(v: unknown) {
  if (typeof v === 'number') return 'float';
  if (v instanceof THREE.Color || v instanceof THREE.Vector3) return 'vec3';
  if (v instanceof THREE.Vector2) return 'vec2';
  if (v instanceof THREE.Vector4) return 'vec4';
  if (v instanceof THREE.Texture) return 'sampler2D';
  if (v instanceof THREE.Matrix4) return 'mat4';
  return 'float';
}

/** Merge geometries after converting to non-indexed (mixed index states merge cleanly). */
export function merge(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') q.deleteAttribute(k);
    if (!q.getAttribute('uv')) q.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((q.getAttribute('position').count) * 2), 2));
    return q;
  }), false)!;
  g.computeBoundingSphere();
  return g;
}

/** Box helper: centre (x,y,z), size (w,h,d). */
export function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rz = 0, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** Cylinder between two points. */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1 = r0, seg = 8) {
  const L = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1, false);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate(a.x, a.y, a.z);
  return g;
}

/** Soft additive glow material for billboarded sprites / cards (colour × k, gaussian falloff). */
export function glowMat(color: THREE.Color, opts: { soft?: number; depthTest?: boolean } = {}) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: opts.depthTest ?? true, blending: THREE.AdditiveBlending,
    uniforms: { color: { value: color.clone() }, soft: { value: opts.soft ?? 4 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 color; uniform float soft; varying vec2 vUv;
      void main(){ float r2 = dot(vUv, vUv); if (r2 > 1.0) discard; float a = exp(-r2 * soft) - exp(-soft); gl_FragColor = vec4(color * a, 1.0); }`,
  });
}
