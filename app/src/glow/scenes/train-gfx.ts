// The `train` scene's materials: one lighting model shared by everything solid (the car, the viaduct, the
// station) — the car's ceiling strips as two line lights, up to MAXL point lights picked per frame (phone
// screens, people of light, the viaduct lamps sweeping through the car, the station lamps), moonlight and fog —
// plus the window glass (rain), the sky and the moon.
import * as THREE from 'three';

/** World height of the car floor (the car's local origin is on the floor, x along the car, z across). */
export const FLOOR_Y = 9.1;
export const MAXL = 10;

export function lightUniforms() {
  return {
    uPts: { value: Array.from({ length: MAXL }, () => new THREE.Vector4(0, -1e4, 0, 1)) },
    uPtC: { value: Array.from({ length: MAXL }, () => new THREE.Vector3()) },
    uN: { value: 0 },
    uCarX: { value: 0 },
    uCarY: { value: FLOOR_Y },
    uFix: { value: new Array(10).fill(1) as number[] },
    uCeilC: { value: new THREE.Color() },
    uMoonD: { value: new THREE.Vector3(0, 0.2, 1).normalize() },
    uMoonC: { value: new THREE.Color() },
    uAmb: { value: new THREE.Color() },
    uFogC: { value: new THREE.Color() },
    uFogD: { value: 0.01 },
    uTime: { value: 0 },
  };
}
export type LightU = ReturnType<typeof lightUniforms>;

export const GLSL_LIGHT = /* glsl */ `
  uniform vec4 uPts[${MAXL}]; uniform vec3 uPtC[${MAXL}]; uniform int uN;
  uniform float uCarX, uCarY; uniform float uFix[10]; uniform vec3 uCeilC;
  uniform vec3 uMoonD, uMoonC, uAmb, uFogC; uniform float uFogD, uTime;
  // diffuse light at p (world) with normal n; spec adds a highlight toward the viewer v
  vec3 lightAt(vec3 p, vec3 n, vec3 v, float spec, float shin) {
    vec3 L = uAmb;
    vec3 S = vec3(0.0);
    vec3 q = p - vec3(uCarX, uCarY, 0.0);
    bool inCar = abs(q.z) < 1.43 && q.y > -0.2 && q.y < 2.4 && abs(q.x) < 9.05;
    if (inCar) {
      // the ceiling strips: two line lights along the car
      float xc = clamp(q.x, -8.85, 8.85);
      int fi = int(clamp(floor((xc + 9.0) / 1.8), 0.0, 9.0));
      float lv = uFix[fi];
      for (int s = 0; s < 2; s++) {
        vec3 d = vec3(xc, 2.17, s == 0 ? -0.55 : 0.55) - q;
        float dd = dot(d, d);
        vec3 l = d * inversesqrt(max(dd, 1e-4));
        float ndl = max(dot(n, l), 0.0) * 0.75 + 0.25;
        vec3 c = uCeilC * lv / (1.0 + dd * 0.7);
        L += c * ndl;
        S += c * pow(max(dot(reflect(-l, n), v), 0.0), shin);
      }
    }
    for (int i = 0; i < ${MAXL}; i++) {
      if (i >= uN) break;
      vec4 P = uPts[i];
      vec3 d = P.xyz - p;
      float dd = dot(d, d), r2 = P.w * P.w;
      // (a negative radius marks a light outside the car: inside, only what comes in through the windows)
      float att = r2 / (r2 + dd) * clamp(1.0 - dd / (r2 * 12.0), 0.0, 1.0) * (P.w < 0.0 && inCar ? 0.22 : 1.0);
      if (att <= 0.0) continue;
      vec3 l = d * inversesqrt(max(dd, 1e-5));
      L += uPtC[i] * att * (max(dot(n, l), 0.0) * 0.85 + 0.15);
      S += uPtC[i] * att * pow(max(dot(reflect(-l, n), v), 0.0), shin);
    }
    L += uMoonC * (max(dot(n, uMoonD), 0.0) * 0.8 + 0.2);
    return L + S * spec;
  }
  vec3 fogged(vec3 c, vec3 p) {
    float d = length(p - cameraPosition);
    return mix(uFogC, c, exp(-uFogD * uFogD * d * d));
  }
`;

const LIT_VERT = /* glsl */ `
  varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vC;
  #ifdef VCOL
  attribute vec3 color;
  #endif
  void main() {
    vec4 lp = vec4(position, 1.0);
    vec3 n = normal;
  #ifdef USE_INSTANCING
    lp = instanceMatrix * lp;
    n = mat3(instanceMatrix) * n;
  #endif
    vec4 w = modelMatrix * lp;
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * n); vUv = uv;
  #ifdef VCOL
    vC = color;
  #else
    vC = vec3(1.0);
  #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export interface LitOpts {
  color: THREE.Color;
  map?: THREE.Texture;
  /** Procedural pattern: 1 floor, 2 seats, 3 steel flutes (car skin), 4 wall tiles, 5 concrete, 6 asphalt-free deck. */
  pattern?: number;
  spec?: number;
  shin?: number;
  emissive?: THREE.Color;
  vcol?: boolean;
  side?: THREE.Side;
}

/** A surface lit by the scene's lights (uniforms shared by reference with `U`). */
export function litMat(U: LightU, o: LitOpts) {
  const defines: Record<string, number> = { PATTERN: o.pattern ?? 0 };
  if (o.map) defines.USE_TEX = 1;
  if (o.vcol) defines.VCOL = 1;
  return new THREE.ShaderMaterial({
    defines,
    side: o.side ?? THREE.FrontSide,
    uniforms: {
      ...U,
      uBase: { value: o.color.clone() },
      uMap: { value: o.map ?? null },
      uSpec: { value: o.spec ?? 0.05 },
      uShin: { value: o.shin ?? 24 },
      uEmis: { value: o.emissive?.clone() ?? new THREE.Color(0, 0, 0) },
    },
    vertexShader: LIT_VERT,
    fragmentShader: /* glsl */ `
      ${GLSL_LIGHT}
      uniform vec3 uBase, uEmis; uniform sampler2D uMap; uniform float uSpec, uShin;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vC;
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        if (dot(n, v) < 0.0 && ${o.side === THREE.DoubleSide ? 'true' : 'false'}) n = -n;
        vec3 base = uBase * vC;
      #ifdef USE_TEX
        base *= texture2D(uMap, vUv).rgb;
      #endif
        float spec = uSpec;
      #if PATTERN == 1
        // ribbed rubber floor: fine speckle and a darker strip down the middle
        vec3 q = vW - vec3(uCarX, 0.0, 0.0);
        base *= 0.85 + 0.3 * hsh(floor(q.xz * 60.0)) * 0.5 + 0.1 * step(0.5, fract(q.x * 5.0));
        base *= 1.0 - 0.25 * smoothstep(0.32, 0.3, abs(q.z));
      #elif PATTERN == 2
        // moulded bucket seats: a groove between seats
        float sx = fract((vW.x - uCarX) / 0.46);
        base *= 0.75 + 0.35 * smoothstep(0.0, 0.12, min(sx, 1.0 - sx));
        spec = 0.25;
      #elif PATTERN == 3
        // fluted stainless skin
        float fl = 0.5 + 0.5 * sin(vW.y * 90.0);
        base *= 0.75 + 0.35 * fl;
      #elif PATTERN == 4
        // white subway tiles with dark grout
        vec2 tq = vec2(vW.x + vW.z, vW.y) * vec2(1.0 / 0.15, 1.0 / 0.075);
        tq.x += step(1.0, mod(floor(tq.y), 2.0)) * 0.5;
        vec2 g = abs(fract(tq) - 0.5);
        base *= mix(0.35, 1.0, smoothstep(0.47, 0.44, max(g.x * 1.0, g.y)));
        base *= 0.9 + 0.2 * hsh(floor(tq));
        spec = 0.35;
      #elif PATTERN == 5
        // concrete
        base *= 0.75 + 0.5 * hsh(floor(vW.xz * 7.0 + vW.y * 3.0)) * 0.6;
      #endif
        vec3 c = base * lightAt(vW, n, v, spec, uShin) + uEmis;
        gl_FragColor = vec4(fogged(c, vW), 1.0);
      }`,
  });
}

/** An emissive surface (fog only): MeshBasic-like, colour from uniform `uC` (linear, >1 blooms). */
export function glowMat(U: LightU, c: THREE.Color, map?: THREE.Texture) {
  return new THREE.ShaderMaterial({
    defines: map ? { USE_TEX: 1 } : {},
    uniforms: { ...U, uC: { value: c.clone() }, uMap: { value: map ?? null } },
    vertexShader: LIT_VERT,
    fragmentShader: /* glsl */ `
      ${GLSL_LIGHT}
      uniform vec3 uC; uniform sampler2D uMap;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vC;
      void main() {
        vec3 c = uC * vC;
      #ifdef USE_TEX
        c *= texture2D(uMap, vUv).rgb;
      #endif
        gl_FragColor = vec4(fogged(c, vW), 1.0);
      }`,
  });
}

/**
 * Window glass (additive, both faces): a faint cool sheen, rain drops and streaks running back along the glass
 * (the train moves +x), catching the light from outside (`uOut`). `uRain` 0..1.
 */
export function glassMat(U: LightU) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { ...U, uOut: { value: new THREE.Color(0.5, 0.42, 0.35) }, uRain: { value: 1 }, uSpeed: { value: 0 }, uK: { value: 1 } },
    vertexShader: LIT_VERT,
    fragmentShader: /* glsl */ `
      ${GLSL_LIGHT}
      uniform vec3 uOut; uniform float uRain, uSpeed, uK;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec3 vC;
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 v = normalize(cameraPosition - vW);
        float f = 1.0 - abs(dot(normalize(vN), v));
        // glass coordinates: along the car (u) and up (y)
        float u = vW.x - uCarX + vW.z * 0.0;
        float y = vW.y;
        float c = 0.0;
        // rain: drops driven back along the glass by the wind of the ride, each with a short tail
        for (int k = 0; k < 2; k++) {
          float sc = k == 0 ? 18.0 : 31.0;
          vec2 q = vec2(u + uTime * uSpeed * 0.035 + y * 0.6, y);
          vec2 g = q * vec2(sc, sc * 0.5);
          vec2 id = floor(g);
          float h = hsh(id + float(k) * 17.0);
          vec2 fr = fract(g) - vec2(0.3 + 0.4 * hsh(id + 3.0), 0.5);
          float along = fr.x, across = fr.y * 2.0;
          float head = smoothstep(0.06, 0.0, length(vec2(along, across * 0.8)));
          float tail = smoothstep(0.03, 0.0, abs(across)) * smoothstep(-0.02, 0.0, along) * smoothstep(0.32, 0.0, along) * 0.5;
          c += (head + tail) * step(0.62, h) * (0.5 + 0.5 * hsh(id + 5.0)) * (k == 0 ? 1.0 : 0.6);
        }
        // still beads
        vec2 gb = vec2(u, y) * 70.0;
        vec2 ib = floor(gb);
        float hb = hsh(ib + 31.0);
        float bead = smoothstep(0.2, 0.05, length(fract(gb) - 0.5 - 0.25 * (vec2(hsh(ib + 1.0), hsh(ib + 2.0)) - 0.5))) * step(0.86, hb);
        c = c * uRain + bead * uRain * 0.4;
        vec3 col = uOut * c * 0.3 + vec3(0.02, 0.028, 0.04) * (0.25 + 1.5 * f * f);
        gl_FragColor = vec4(col * uK, 1.0);
      }`,
  });
}

/** The night sky (world-space dome around the camera): deep blue, lighter at the horizon, a moon glow. */
export function skyMat() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uMoonD: { value: new THREE.Vector3(0, 0.1, 1).normalize() }, uMoonK: { value: 1 }, uGold: { value: 0 } },
    vertexShader: /* glsl */ `varying vec3 vD; void main() { vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uMoonD; uniform float uMoonK, uGold; varying vec3 vD;
      float hsh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vD);
        float y = d.y;
        vec3 top = vec3(0.004, 0.006, 0.018), hor = vec3(0.045, 0.034, 0.042);
        vec3 c = mix(hor, top, pow(clamp(y, 0.0, 1.0), 0.45));
        if (y < 0.0) c = hor * 0.6;
        c = mix(c, c * vec3(1.6, 1.1, 0.5), uGold * smoothstep(0.4, 0.0, y));
        float m = max(dot(d, uMoonD), 0.0);
        c += vec3(0.5, 0.55, 0.7) * uMoonK * (0.05 * pow(m, 30.0) + 0.06 * pow(m, 300.0));
        // stars
        vec3 s = floor(d * 380.0);
        float st = step(0.9985, hsh(s)) * smoothstep(0.02, 0.2, y);
        c += vec3(0.8, 0.85, 1.0) * st * (0.4 + 0.6 * hsh(s + 3.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** The moon: a disc with maria and limb darkening, and a soft halo; `uK` its light (0 = gone). */
export function moonMat() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uK: { value: 1 }, uC: { value: new THREE.Color(1.0, 0.93, 0.8) } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uK; uniform vec3 uC; varying vec2 vUv;
      float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        // the plane spans 8 moon radii: the disc in the middle, the halo around
        vec2 p = (vUv - 0.5) * 8.0;
        float r = length(p);
        float disc = smoothstep(1.0, 0.97, r);
        float mu = sqrt(max(0.0, 1.0 - r * r));
        float maria = 0.0;
        maria += smoothstep(0.55, 0.75, n2(p * 2.2 + 3.0)) * 0.35;
        maria += smoothstep(0.6, 0.8, n2(p * 4.5 + 9.0)) * 0.15;
        vec3 c = uC * (0.55 + 0.45 * mu) * (1.0 - maria) * 2.6 * disc;
        float halo = exp(-max(r - 1.0, 0.0) * 1.6) * 0.18 + exp(-max(r - 1.0, 0.0) * 6.0) * 0.25;
        c += uC * vec3(0.75, 0.82, 1.0) * halo * (1.0 - disc) * smoothstep(4.0, 2.5, r);
        gl_FragColor = vec4(c * uK, 1.0);
      }`,
  });
}

/** A canvas texture (sRGB) drawn by `draw`. */
export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, o: { srgb?: boolean; mip?: boolean } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  if (o.srgb ?? true) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (o.mip === false) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}

/** An axis-aligned box geometry from extents (UVs 0..1 per face). */
export function boxG(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}
