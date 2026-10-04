// Shared GLSL and uniforms of the night city (lib/city.ts): hashes and noise, the power function (which parts of
// the city have electric light: a global level, waves from points, a block-by-block mask), the haze, the street
// light map, moonlight and sky light, reflections of the sky and the neighbours in glass, and the facade itself:
// brick, stone, glass curtain walls; recessed windows with rooms behind them (interior mapping), curtains,
// blinds, AC units, TVs; offices lit floor by floor; the shopfront band; parapets, bands, cornice shadows.
import * as THREE from 'three';

/** Uniforms every city material shares (one object; materials reference the same IUniforms). */
export function cityUniforms(o: { fog: number; fogColor: THREE.Color }) {
  const wave = () => new THREE.Vector4(0, 0, -1, 100);
  return {
    uTime: { value: 0 },
    uDebug: { value: 0 },
    /** the City group's world position (shaders look the plan up in city-local coordinates) */
    uOrigin: { value: new THREE.Vector3() },
    // power
    uPow: { value: 1 },
    uWave: { value: [wave(), wave(), wave(), wave()] },
    uWaveK: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uBlockMask: { value: null as THREE.Texture | null },
    uMaskRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uGlowK: { value: 1 },
    // the old City API (rooftop / space-chorus scenes)
    wake: { value: 1 }, wakeFrom: { value: new THREE.Vector3() }, wakeR: { value: 1e9 }, wakeSoft: { value: 120 },
    gold: { value: 0 }, goldFrom: { value: new THREE.Vector3() }, goldR: { value: 1e9 }, gain: { value: 1 }, t: { value: 0 },
    fogD: { value: o.fog }, fogC: { value: o.fogColor.clone() },
    skyTop: { value: new THREE.Color(0.002, 0.003, 0.009) }, skyHor: { value: new THREE.Color(0.03, 0.022, 0.026) },
    // light
    uLightMap: { value: null as THREE.Texture | null }, uLMRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMoonDir: { value: new THREE.Vector3(-0.35, 0.42, -0.84).normalize() }, uMoonCol: { value: new THREE.Color(0.05, 0.058, 0.08) },
    uSkyAmb: { value: new THREE.Color(0.012, 0.014, 0.024) }, uGlowAmb: { value: new THREE.Color(0.05, 0.03, 0.02) },
    uHazeCol: { value: new THREE.Color(0.075, 0.048, 0.036) }, uHazeNight: { value: new THREE.Color(0.006, 0.008, 0.016) },
    uHazeD: { value: 0.00075 }, uHazeH: { value: 70 },
    // wet ground reflections (filled by City's mirror)
    uMirror: { value: null as THREE.Texture | null }, uMirrorMat: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 },
    // windows cut open for people inside (x, y, z centre; w) and (half x, half y, half z)
    uOpenA: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -1e5, 0, 0)) },
    uOpenB: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    // glowing people light the walls, windows and streets near them: (x, y, z, radius), (r, g, b, -)
    uPGlowP: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, -1e5, 0, 1)) },
    uPGlowC: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uPGlowN: { value: 0 },
    // dawn: a low warm sun, mist, the lights going out
    uFlash: { value: new THREE.Vector2(0, 0) },
    uDawn: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.75, 0.16, -0.64).normalize() }, uSunCol: { value: new THREE.Color(1.0, 0.62, 0.32) },
  };
}
export type CityUniforms = ReturnType<typeof cityUniforms>;

/** Uniform declarations + helpers: hashes, noise, power, light map, ambient, haze, environment. */
export const CITY_GLSL = /* glsl */ `
  uniform float uDebug;
  uniform float uTime, uPow, uGlowK, wake, wakeR, wakeSoft, gold, goldR, gain, fogD, uHazeD, uHazeH, uMirrorOn;
  uniform vec4 uWave[4]; uniform vec4 uWaveK[4];
  uniform sampler2D uBlockMask; uniform vec4 uMaskRect;
  uniform vec3 wakeFrom, goldFrom, fogC, skyTop, skyHor, uMoonDir, uMoonCol, uSkyAmb, uGlowAmb, uHazeCol, uHazeNight;
  uniform sampler2D uLightMap; uniform vec4 uLMRect; uniform vec3 uOrigin;
  uniform vec4 uPGlowP[16]; uniform vec4 uPGlowC[16]; uniform float uPGlowN;
  uniform float uDawn; uniform vec3 uSunDir, uSunCol; uniform vec2 uFlash;

  float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  vec2 h22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm3(vec2 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3); }
  float bitOf(float m, float b) { return mod(floor(m / b + 0.001), 2.0); }

  // electric power at a place, 0..1
  float power(vec2 xzw) {
    vec2 xz = xzw - uOrigin.xz;
    float p = uPow;
    for (int i = 0; i < 4; i++) {
      vec4 w = uWave[i];
      if (uWaveK[i].y > 0.5) {
        float k = 1.0 - smoothstep(w.z - w.w, w.z, length(xz - w.xy));
        p = mix(p, uWaveK[i].x, k);
      }
    }
    vec2 mu = (xz - uMaskRect.xy) * uMaskRect.zw;
    p *= texture2D(uBlockMask, mu).r;
    float dw = length(xz - wakeFrom.xz);
    p *= clamp(wake, 0.0, 1.0) * (1.0 - smoothstep(wakeR - wakeSoft, wakeR, dw));
    return clamp(p, 0.0, 1.0);
  }
  // gold inside the gold wave
  float goldAt(vec2 xz) { return gold * (1.0 - smoothstep(goldR - 80.0, goldR, length(xz - uOrigin.xz - goldFrom.xz))); }

  // static street light (lamps, shopfronts) baked on the ground, before power
  vec3 lightMap(vec2 xz) { vec3 s = texture2D(uLightMap, (xz - uOrigin.xz - uLMRect.xy) * uLMRect.zw).rgb; return s * s * 4.0; }
  // the street light reaching a point at height y above the street, its power applied
  vec3 streetLight(vec2 xz, float y, float p) {
    vec3 l = lightMap(xz);
    vec3 sodium = mix(vec3(1.0), vec3(1.6, 0.5, 0.25), smoothstep(0.35, 0.0, p) * step(0.001, p)); // lamps warm up red
    return l * p * sodium * (0.6 + 0.4 * smoothstep(0.0, 3.0, y)) * exp(-max(y - 5.0, 0.0) / 6.0);
  }
  // sky and moon light on a surface with normal N
  vec3 ambient(vec3 N, float p) {
    float up = N.y * 0.5 + 0.5;
    vec3 c = uSkyAmb * (0.35 + 0.65 * up) + uGlowAmb * uGlowK * (0.25 + 0.75 * up) * (1.0 - uDawn);
    c += uMoonCol * max(dot(N, uMoonDir), 0.0) * (1.0 - uDawn);
    // dawn: the sky's blue-pink light from above
    c += uDawn * mix(vec3(0.05, 0.05, 0.075), vec3(0.11, 0.1, 0.13), up);
    return c;
  }
  // the low sun at dawn: streets in the shadow of the blocks, upper floors and roofs lit
  vec3 sunLight(vec3 W, vec3 N) {
    if (uDawn <= 0.0) return vec3(0.0);
    float ndl = max(dot(N, uSunDir), 0.0);
    float sh = 18.0 + 90.0 * vnoise(W.xz * 0.004 + 3.0) + 60.0 * vnoise(W.xz * 0.013);
    float lit = N.y > 0.5 ? 1.0 : smoothstep(sh - 12.0, sh + 12.0, W.y);
    return uSunCol * uDawn * ndl * lit * 0.9;
  }
  // light from the glowing people near a point
  vec3 peopleGlow(vec3 W, vec3 N) {
    vec3 L = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uPGlowN) break;
      vec3 d = uPGlowP[i].xyz - W;
      float r = max(uPGlowP[i].w, 0.01), dd = dot(d, d);
      float ndl = dot(N, d) * inversesqrt(max(dd, 1e-4));
      L += uPGlowC[i].rgb * (0.2 + 0.8 * max(ndl, 0.0)) / (1.0 + dd / (r * r)) * (1.0 - smoothstep(9.0 * r * r, 25.0 * r * r, dd));
    }
    return L;
  }
  vec3 hazeColor(float p) {
    vec3 h = mix(uHazeNight, uHazeCol, mix(uGlowK, p, 0.4)) * (1.0 + gold * vec3(0.5, 0.15, -0.6));
    return mix(h, vec3(0.42, 0.3, 0.26), uDawn);
  }
  // height haze (exponential in y, integrated along the view ray) and the scene's distance fog
  vec3 cityFog(vec3 c, vec3 W, float p) {
    vec3 ro = cameraPosition;
    float d = length(W - ro);
    float y0 = max(ro.y, 0.0), y1 = max(W.y, 0.0), dy = y1 - y0;
    float e0 = exp(-y0 / uHazeH), e1 = exp(-y1 / uHazeH);
    float integ = abs(dy) > 0.05 ? uHazeH * (e0 - e1) / dy : e0;
    float haze = 1.0 - exp(-uHazeD * d * max(integ, 0.0));
    c = mix(c, hazeColor(p), clamp(haze, 0.0, 1.0));
    return mix(fogC, c, exp(-fogD * fogD * d * d));
  }
  // what a glass pane reflects: the sky with the city's glow on the horizon, the moon, the lit neighbours
  vec3 envRefl(vec3 R, float jit) {
    float y = R.y;
    vec3 c = mix(skyHor, skyTop, clamp(y * 1.8, 0.0, 1.0)) + uHazeCol * uGlowK * exp(-max(y, 0.0) * 7.0) * 0.5;
    float m = max(dot(R, uMoonDir), 0.0);
    c += uMoonCol * (pow(m, 400.0) * 40.0 + pow(m, 24.0) * 0.4);
    if (y < 0.16) {
      float az = atan(R.z, R.x + 1e-5) + jit;
      vec2 q = vec2(az * 70.0, y * 110.0);
      vec2 cell = floor(q);
      float tower = step(h12(vec2(floor(az * 9.0), 3.0)) * 0.14, y + 0.02);
      float lit = step(0.78, h12(cell)) * step(0.25, fract(q.x)) * step(0.3, fract(q.y));
      float k = smoothstep(0.16, 0.05, y);
      c = mix(c, vec3(0.008, 0.008, 0.011) + uHazeCol * 0.15 * uGlowK, k * (1.0 - tower * 0.0));
      c += mix(vec3(1.0, 0.72, 0.42), vec3(0.8, 0.88, 1.0), h12(cell + 5.0)) * lit * k * 0.32 * uGlowK;
    }
    return c;
  }
`;

/**
 * The facade. Inputs per building instance (see City): seed, style, floor height fH, ground floor height gH,
 * bay width, window width / height / sill (fractions of a bay / floor), wall albedo, lit density, face masks
 * (windows, shops), the building's top, crown and paired windows, warmth.
 */
export const FACADE_GLSL = /* glsl */ `
  const float S_WALKUP = 0.0, S_PREWAR = 1.0, S_GLASS = 2.0, S_DECO = 3.0, S_MODERN = 4.0, S_POSTWAR = 5.0, S_LOFT = 6.0, S_PLANT = 7.0;

  // a lit room seen through the glass: ro on the glass (room space: x across, y up, z into the room), rd the ray
  vec3 roomColor(vec3 ro, vec3 rd, vec3 R, vec3 Lc, float seed, float office, float tv) {
    float tx = rd.x > 0.0 ? (R.x - ro.x) / rd.x : ro.x / max(-rd.x, 1e-4);
    float ty = rd.y > 0.0 ? (R.y - ro.y) / rd.y : ro.y / max(-rd.y, 1e-4);
    float tz = R.z / max(rd.z, 1e-4);
    float t = min(tx, min(ty, tz));
    vec3 p = ro + rd * t;
    vec3 lamp = vec3(R.x * mix(0.2, 0.8, h11(seed * 7.1)), office > 0.5 ? R.y - 0.05 : R.y * mix(0.45, 0.93, step(0.5, h11(seed * 3.3))), R.z * mix(0.35, 0.8, h11(seed * 5.7)));
    vec3 dl = p - lamp;
    float fall = 0.18 + 0.82 / (1.0 + dot(dl, dl) * (office > 0.5 ? 0.02 : 0.16));
    vec3 c;
    float hx = p.x / max(R.x, 0.1);
    if (t == tz) {
      // back wall
      vec3 paint = mix(vec3(0.85, 0.78, 0.66), mix(vec3(0.62, 0.7, 0.8), vec3(0.75, 0.55, 0.45), h11(seed * 2.9)), step(0.6, h11(seed * 1.7)));
      if (office > 0.5) paint = vec3(0.55, 0.56, 0.58);
      c = paint * 0.62;
      float sofa = step(p.y, 0.85) * step(mix(0.08, 0.4, h11(seed * 4.1)), hx) * step(hx, mix(0.5, 0.92, h11(seed * 4.7)));
      float shelf = step(0.55, h11(seed * 8.3)) * step(abs(hx - mix(0.15, 0.85, h11(seed * 8.9))), 0.12) * step(p.y, 2.1);
      float books = shelf * step(0.5, fract(p.y * 3.2)) * step(0.3, h12(floor(vec2(p.x * 14.0, p.y * 3.2))));
      float pic = step(0.45, h11(seed * 9.7)) * step(abs(hx - 0.5 - 0.25 * (h11(seed * 6.1) - 0.5)), 0.13) * step(abs(p.y - 1.6), 0.28);
      float door = step(0.65, h11(seed * 5.3)) * step(abs(hx - mix(0.12, 0.88, h11(seed * 2.2))), 0.09) * step(p.y, 2.05);
      c *= 1.0 - 0.75 * sofa * (1.0 - office);
      c = mix(c, mix(vec3(0.5, 0.25, 0.15), vec3(0.2, 0.3, 0.5), h12(floor(vec2(p.x * 14.0, p.y * 3.2)) + 1.0)), books * 0.8);
      c = mix(c, vec3(0.08, 0.06, 0.05), shelf * (1.0 - books) * 0.6);
      c = mix(c, mix(vec3(0.75, 0.42, 0.25), vec3(0.3, 0.45, 0.7), h11(seed * 3.9)), pic * 0.7 * (1.0 - office));
      c = mix(c, vec3(0.05, 0.04, 0.035), door * 0.85);
      // cubicle partitions and screens left on
      if (office > 0.5) {
        c *= 1.0 - 0.5 * step(p.y, 1.3);
      }
    } else if (t == ty) {
      if (rd.y > 0.0) {
        // ceiling: the lamp or rows of office panels
        float panel = office > 0.5 ? step(0.66, fract(p.x / 1.5)) * step(0.5, fract(p.z / 2.4)) : 0.0;
        vec2 dc = p.xz - lamp.xz;
        c = vec3(0.8) * (0.5 + 3.0 * exp(-dot(dc, dc) * 2.0) * (1.0 - office)) + panel * 3.0;
      } else {
        // floor: boards / carpet, a rug
        float boards = 0.85 + 0.15 * h11(floor(p.x * 5.0) + seed);
        c = (office > 0.5 ? vec3(0.12, 0.12, 0.13) : vec3(0.4, 0.26, 0.15) * boards) * 0.7;
        float rug = step(0.5, h11(seed * 1.9)) * step(abs(hx - 0.5), 0.3) * step(abs(p.z / R.z - 0.5), 0.25);
        c = mix(c, mix(vec3(0.5, 0.15, 0.12), vec3(0.2, 0.25, 0.4), h11(seed * 7.7)) * 0.6, rug);
        if (office > 0.5) c *= 1.0 - 0.6 * step(fract(p.x / 3.0), 0.08);
      }
    } else {
      // side wall
      vec3 paint = office > 0.5 ? vec3(0.5) : vec3(0.8, 0.75, 0.66);
      c = paint * 0.5;
      float art = step(0.6, h11(seed * 4.4)) * step(abs(p.z / R.z - 0.55), 0.18) * step(abs(p.y - 1.55), 0.3);
      c = mix(c, vec3(0.6, 0.35, 0.25), art * 0.6 * (1.0 - office));
    }
    c *= Lc * fall;
    // the TV's flicker on the walls
    c += tv * vec3(0.25, 0.4, 1.0) * (0.15 + 0.1 * sin(uTime * 7.0 + seed * 40.0) + 0.08 * sin(uTime * 13.0 + seed * 7.0));
    c *= 1.0 - 0.35 * clamp(t / (R.z * 1.6), 0.0, 1.0);
    return c;
  }

  // the light of a room (colour * level), its kind and whether it is on, given power p
  // returns rgb light, writes kind: 0 warm, 1 cool, 2 tv, 3 kitchen, 4 coloured
  vec3 roomLight(float seed, float rh, float density, float floorK, float p, float office, float warmth, out float on, out float tv, out float startle) {
    float occupied = max(step(rh, density), step(h11(seed * 5.3 + uFlash.y * 1.618), uFlash.x));
    // power threshold: lower floors first, a little random; flicker while the power is coming
    float th = 0.04 + 0.5 * floorK + 0.4 * h11(seed * 13.7);
    float d = p - th;
    float flick = step(0.45, h12(vec2(seed * 91.0, floor(uTime * 17.0))));
    on = occupied * step(0.0, d) * mix(flick, 1.0, smoothstep(0.03, 0.09, d));
    startle = occupied * exp(-max(d, 0.0) * 30.0) * step(0.0, d);
    float k = h11(seed * 3.1);
    vec3 warm = vec3(1.0, 0.6, 0.3), cool = vec3(0.78, 0.86, 1.0), kitchen = vec3(0.85, 1.0, 0.86), tvc = vec3(0.35, 0.5, 1.0);
    vec3 colr = mix(vec3(0.75, 0.3, 1.0), vec3(1.0, 0.25, 0.35), h11(seed * 9.1));
    vec3 Lc;
    tv = 0.0;
    if (office > 0.5) Lc = mix(vec3(0.82, 0.92, 0.9), warm, step(0.8, k)) * (0.55 + 0.2 * h11(seed * 4.1));
    else if (k < 0.42 + 0.25 * warmth) Lc = warm * (0.55 + 0.6 * h11(seed * 4.1));
    else if (k < 0.66) Lc = cool * (0.45 + 0.4 * h11(seed * 4.1));
    else if (k < 0.82) { Lc = tvc * 0.18; tv = 1.0; }
    else if (k < 0.94) Lc = kitchen * 0.6;
    else Lc = colr * 0.5;
    return Lc;
  }

  // facade colour of a side face. W world pos, N normal (axis-aligned), V view dir, C box centre (x, y0, z),
  // S box size, F0..F3 the building's parameters; p power here. Returns colour; writes window coverage.
  vec3 facade(vec3 W, vec3 N, vec3 V, vec3 C, vec3 S, vec4 F0, vec4 F1, vec4 F2, vec4 F3, float p, out float winA) {
    float seed = F0.x, style = F0.y, fH = F0.z, gH = F0.w;
    float bayW = F1.x, winW = F1.y, winH = F1.z, sill = F1.w;
    vec3 wallAlb = F2.rgb; float density = F2.a;
    float masks = F3.x, topY = F3.y, crown = mod(F3.z, 4.0), pairs = floor(F3.z / 4.0 + 0.001), warmth = F3.w;
    winA = 0.0;
    vec3 T = vec3(N.z, 0.0, -N.x);
    float faceW = abs(T.x) * S.x + abs(T.z) * S.z;
    float u = dot(W.xz - C.xz, T.xz) + faceW * 0.5;
    float v = W.y;
    float faceBit = N.x < -0.5 ? 1.0 : N.x > 0.5 ? 2.0 : N.z < -0.5 ? 4.0 : 8.0;
    float faceId = log2(faceBit);
    float hasWin = bitOf(mod(masks, 16.0), faceBit);
    float hasShop = bitOf(floor(masks / 16.0 + 0.001), faceBit) * step(C.y, 0.5);
    float glass = step(abs(style - S_GLASS), 0.1);
    float deco = step(abs(style - S_DECO), 0.1);
    float officeB = glass + deco * step(0.4, h11(seed * 2.3)) + step(abs(style - S_MODERN), 0.1) * step(0.75, h11(seed * 1.3));
    vec3 Rf = reflect(V, N);
    vec3 rd = vec3(dot(V, T), V.y, dot(V, -N));
    float gl = goldAt(W.xz);
    // ---- lighting of the wall ----
    vec3 street = streetLight(W.xz + N.xz * 2.5, v, p) * (1.0 - 0.8 * uDawn);
    vec3 pg = peopleGlow(W, N);
    vec3 Lw = ambient(N, p) + street + sunLight(W, N) + pg;
    // floodlit crowns: the upper tiers washed from their feet
    float tierY = C.y, tierTop = C.y + S.y;
    float crownK = step(0.5, crown) * step(1.5, -crown + 2.0) * step(topY * 0.55, tierY + 0.1);
    vec3 floodC = mix(vec3(1.0, 0.86, 0.66), mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.7, 0.35), h11(seed * 6.6)), step(0.6, h11(seed * 5.2)));
    floodC = mix(floodC, vec3(1.0, 0.7, 0.25), gl);
    Lw += floodC * crownK * p * (0.3 + 1.6 * exp(-(v - tierY) / 9.0)) * step(0.4, h11(seed * 3.7) + 0.5);
    // ---- the grid ----
    float pier = glass > 0.5 ? 0.0 : 0.55;
    float avail = max(faceW - 2.0 * pier, 0.5);
    float nb = max(1.0, floor(avail / bayW + 0.5));
    float bw = avail / nb;
    float ub = (u - pier) / bw;
    float bi = floor(ub), fu = fract(ub);
    float inBays = step(0.0, ub) * step(ub, nb);
    float ground = step(v, gH);
    float fl = floor((v - gH) / fH), fv = fract((v - gH) / fH);
    float parapet = step(tierTop - 0.95, v);
    float nFl = max(1.0, floor((topY - gH) / fH));
    // pixel footprint of a window cell (for detail levels)
    float px = max(fwidth(ub), fwidth(v / fH));
    // ---- wall albedo ----
    vec3 alb = wallAlb;
    float brickK = (1.0 - glass) * step(abs(style - S_MODERN), 0.1 - 1.0);
    // brick courses, close up
    float near = smoothstep(0.06, 0.015, px);
    if (near > 0.0 && glass < 0.5 && style != S_MODERN) {
      vec2 bq = vec2(u / 0.205, v / 0.077);
      float row = floor(bq.y);
      bq.x += 0.5 * mod(row, 2.0);
      vec2 bf = fract(bq);
      float mortar = max(step(bf.y, 0.14), step(bf.x, 0.05));
      vec2 bfw = fwidth(bq);
      float mk = smoothstep(0.5, 0.15, max(bfw.x, bfw.y));
      float bv = 0.82 + 0.36 * h12(floor(bq) + seed);
      alb = mix(alb, mix(alb * bv, vec3(0.32, 0.3, 0.27) * 0.8, mortar), mk * near);
    }
    // grime: darker towards the top and in streaks
    alb *= 0.82 + 0.18 * vnoise(vec2(u * 0.35, v * 0.05) + seed) - 0.08 * smoothstep(0.0, 1.0, v / max(topY, 1.0));
    // stone base, bands and lintels on the older styles
    float older = step(style, S_PREWAR + 0.1) + step(abs(style - S_LOFT), 0.1) + deco;
    vec3 stone = mix(vec3(0.42, 0.38, 0.32), wallAlb * 1.3, 0.3);
    float base = older * step(v, gH + (style == S_PREWAR || deco > 0.5 ? fH : 0.0)) * step(abs(style - S_WALKUP), 0.1 - 1.0);
    base = older * step(v, gH + fH) * (step(abs(style - S_PREWAR), 0.1) + deco);
    alb = mix(alb, stone * (0.85 + 0.15 * step(0.12, fract(v / 0.5))), base);
    float bandY = abs(v - gH - 0.12);
    float band = older * step(bandY, 0.2) + step(abs(style - S_PREWAR), 0.1) * step(abs(v - (topY - 3.0 * fH) - 0.12), 0.18);
    alb = mix(alb, stone * 1.15, band);
    // ---- windows ----
    vec3 col;
    float glassAmt = 0.0;
    vec3 inside = vec3(0.0), glassRefl = vec3(0.0);
    // window opening in this cell
    float sub = pairs > 1.5 ? 2.0 : 1.0;
    float fuo = fract(fu * sub);
    float ww = min(winW * sub, 0.96);
    float wx0 = 0.5 - ww * 0.5, wx1 = 0.5 + ww * 0.5;
    float wy0 = sill, wy1 = sill + winH;
    if (glass > 0.5) { wx0 = 0.0; wx1 = 1.0; }
    vec2 aa = vec2(fwidth(fuo), fwidth(fv)) * 0.7;
    float inX = smoothstep(wx0 - aa.x, wx0 + aa.x, fuo) * smoothstep(wx1 + aa.x, wx1 - aa.x, fuo);
    float inY = smoothstep(wy0 - aa.y, wy0 + aa.y, fv) * smoothstep(wy1 + aa.y, wy1 - aa.y, fv);
    float isWin = inX * inY * inBays * hasWin * (1.0 - ground) * (1.0 - parapet) * step(0.0, fl);
    // ground floor: houses without shops have windows there too (with grilles); shops are drawn by their own quads
    float gWin = ground * (1.0 - hasShop) * hasWin * inBays * inX * smoothstep(0.32, 0.36, v / max(gH, 1.0)) * smoothstep(0.86, 0.82, v / max(gH, 1.0)) * (1.0 - glass);
    isWin = max(isWin, gWin);
    // stairwell: one column of small windows, lit on every floor
    float stairBay = floor(h11(seed * 9.9 + faceId) * nb);
    float stair = step(abs(bi - stairBay), 0.1) * step(0.5, h11(seed * 4.9 + faceId)) * (1.0 - glass) * (1.0 - officeB);
    // the room behind
    float flId = ground > 0.5 ? -1.0 : fl;
    float unitBays = 2.0 + floor(h11(seed * 5.5 + faceId) * 2.0);
    float unitId = floor(bi / unitBays);
    float roomSeed = h13(vec3(seed * 0.37 + faceId * 3.1, flId * 1.37 + 0.11, (officeB > 0.5 ? floor(bi / 14.0) : bi) * 0.71 + 0.3));
    float unitH = h13(vec3(seed * 0.71 + faceId, flId * 0.93 + 2.0, (officeB > 0.5 ? floor(bi / 14.0) + 0.5 : unitId) * 1.3 + 0.7));
    float floorK = clamp((flId + 1.0) / (nFl + 1.0), 0.0, 1.0);
    float on, tv, startle;
    float dens = density * (officeB > 0.5 ? 0.8 : 1.0);
    vec3 Lc = roomLight(roomSeed, unitH, dens, floorK, p, officeB, warmth, on, tv, startle);
    // inside an occupied unit some rooms are dark
    on *= officeB > 0.5 ? 1.0 : step(0.3, h11(roomSeed * 17.0 + 3.0));
    // at dawn people switch their lights off
    on *= step(uDawn * 0.85, h11(roomSeed * 23.0));
    // stairwells: dim fluorescent on every floor
    float stairOn = stair * step(0.1 + 0.6 * floorK, p);
    Lc = mix(Lc, vec3(0.75, 0.85, 0.8) * 0.3, stair); on = max(on * (1.0 - stair), stairOn); tv *= 1.0 - stair;
    // blackout: candles and phones in a few windows
    float candle = (1.0 - step(0.05, p)) * step(h11(roomSeed * 77.0), 0.02) * hasWin * (1.0 - officeB);
    vec3 candleC = mix(vec3(1.0, 0.45, 0.12) * (0.55 + 0.25 * sin(uTime * 11.0 + roomSeed * 50.0) * sin(uTime * 7.3 + roomSeed * 20.0)), vec3(0.3, 0.45, 1.0) * 0.25, step(0.5, h11(roomSeed * 5.0)));
    Lc = mix(Lc, vec3(1.0, 0.7, 0.25) * (0.8 + 0.4 * h11(roomSeed)), gl * 0.85);
    vec3 Lroom = (Lc * (1.0 + startle * 1.5) * on + tv * on * vec3(0.12, 0.18, 0.4) * (0.6 + 0.4 * sin(uTime * 9.0 + roomSeed * 30.0))) * gain + candleC * candle;
    // ---- far: windows smaller than a few pixels: their average ----
    float far = smoothstep(0.35, 0.9, px);
    // ---- the window itself ----
    if (isWin > 0.001 && far < 0.999) {
      float ow = ww * bw / sub, oh = winH * fH;
      vec2 wq = vec2((fuo - wx0) / max(wx1 - wx0, 1e-3) * ow, (fv - wy0) / max(winH, 1e-3) * oh); // m in the opening
      if (gWin > 0.5) wq = vec2((fuo - wx0) / max(wx1 - wx0, 1e-3) * ow, (v - gH * 0.34) );
      float depth = glass > 0.5 ? 0.06 : style == S_MODERN ? 0.12 : 0.2;
      vec3 rdn = normalize(rd);
      float rz = max(rdn.z, 0.05);
      // the reveal: the jamb, sill or lintel the recess shows at this angle
      float jx = depth * rdn.x / rz, jy = depth * rdn.y / rz;
      float reveal = max(step(ow - max(jx, 0.0), wq.x) + step(wq.x, max(-jx, 0.0)), step(oh - max(jy, 0.0), wq.y) + step(wq.y, max(-jy, 0.0)));
      reveal = clamp(reveal, 0.0, 1.0) * (1.0 - glass);
      // room
      float detail = smoothstep(0.1, 0.05, px);
      vec3 R = officeB > 0.5 ? vec3(bw * 14.0, fH - 0.6, 11.0) : vec3(ow + 1.6, min(fH - 0.35, 2.75), 4.2);
      vec3 ro = vec3(wq.x + (officeB > 0.5 ? mod(bi, 14.0) * bw : 0.8), clamp(wq.y + (gWin > 0.5 ? 0.9 : sill * fH) - 0.05, 0.02, R.y - 0.02), 0.0) + rdn * depth / rz;
      ro.x = clamp(ro.x, 0.02, R.x - 0.02);
      vec3 flatC = Lroom * 0.42;
      inside = flatC;
      if (detail > 0.0 && on + tv > 0.0) inside = mix(flatC, roomColor(ro, rdn, R, Lroom, roomSeed * 91.0, officeB, tv * on), detail);
      // unlit rooms: very dark, a hint of the street light on the ceiling, a glowing neighbour's light
      inside += (1.0 - on) * (street * 0.03 + vec3(0.002, 0.002, 0.003) + pg * 0.3);
      // curtains, blinds, a plant on the sill
      float cur = (1.0 - officeB) * step(0.55, h11(roomSeed * 11.0)) * (1.0 - glass);
      float side = h11(roomSeed * 12.0) < 0.5 ? wq.x / ow : 1.0 - wq.x / ow;
      float cover = cur * step(side, 0.2 + 0.6 * h11(roomSeed * 13.0));
      float folds = 0.75 + 0.25 * sin(wq.x * 40.0 + h11(roomSeed) * 6.0);
      vec3 fabric = mix(vec3(0.95, 0.6, 0.35), mix(vec3(0.75, 0.8, 0.95), vec3(0.9, 0.85, 0.7), h11(roomSeed * 15.0)), h11(roomSeed * 14.0));
      inside = mix(inside, fabric * (Lroom * 0.55 + street * 0.05) * folds, cover);
      float blinds = step(0.82, h11(roomSeed * 16.0)) * (1.0 - cover) * (1.0 - glass * 0.6);
      float slat = smoothstep(0.35, 0.65, fract(wq.y * 12.0));
      inside = mix(inside, mix(inside, Lroom * 0.32 + street * 0.02, slat), blinds * step(oh * (1.0 - h11(roomSeed * 17.0) * 0.8), oh - wq.y));
      // AC units in the lower sash
      float acK = step(0.8, h11(roomSeed * 19.0)) * (1.0 - glass) * step(style, S_PREWAR + 0.1 + step(abs(style - S_POSTWAR), 0.1) * 9.0) * (1.0 - gWin);
      float ac = acK * step(abs(wq.x - ow * 0.5), ow * 0.36) * step(wq.y, oh * 0.32);
      vec3 acC = vec3(0.45, 0.43, 0.4) * (Lw + Lroom * 0.15) * (0.85 + 0.15 * step(0.5, fract(wq.x * 30.0)));
      // frames: a meeting rail on double-hung sashes, mullions on glass
      float fr = glass > 0.5 ? max(step(fuo, 0.03) + step(0.97, fuo), step(abs(fv - wy0), 0.012) + step(abs(fv - wy1), 0.012)) : max(step(abs(wq.y - oh * 0.52), 0.035), max(step(wq.x, 0.05) + step(ow - 0.05, wq.x), step(wq.y, 0.05) + step(oh - 0.05, wq.y)));
      fr = clamp(fr, 0.0, 1.0) * detail;
      vec3 frameC = (glass > 0.5 ? vec3(0.05, 0.055, 0.06) : mix(vec3(0.6, 0.58, 0.55), vec3(0.06, 0.05, 0.045), step(0.5, h11(seed * 8.8)))) * (Lw + Lroom * 0.2);
      // glass: reflection with Fresnel; glass towers are mirrors
      float fres = pow(1.0 - clamp(rdn.z, 0.0, 1.0), 4.0);
      float panelJit = (h12(vec2(bi, fl) + seed) - 0.5) * 0.05;
      glassRefl = envRefl(normalize(Rf + vec3(panelJit, panelJit * 0.5, 0.0)), panelJit * 3.0) * (glass > 0.5 ? 0.25 + 0.6 * fres : 0.07 + 0.4 * fres);
      vec3 win = inside * (glass > 0.5 ? 0.8 : 1.0) + glassRefl;
      // grilles on ground-floor windows
      win *= 1.0 - gWin * 0.6 * step(0.8, fract(wq.x * 6.0));
      win = mix(win, frameC, fr);
      win = mix(win, acC, ac);
      // lintel shadow inside the recess, and the reveal itself
      win *= 1.0 - (1.0 - glass) * 0.35 * smoothstep(oh - 0.35, oh, wq.y);
      win = mix(win, alb * Lw * 0.75 + Lroom * 0.15, reveal);
      inside = win;
      glassAmt = isWin;
    }
    // ---- the wall ----
    vec3 wall = alb * Lw;
    if (glass > 0.5) {
      // spandrels: dark glass that reflects; slab edges
      vec3 spand = wallAlb * 0.6 + envRefl(Rf, 0.0) * (0.12 + 0.4 * pow(1.0 - clamp(rd.z, 0.0, 1.0), 4.0));
      float slabLine = smoothstep(0.03, 0.0, abs(fv - wy1 - 0.01)) * on * 0.6;
      wall = spand + Lroom * slabLine * 0.3 + wallAlb * Lw * 0.5;
      // LED crown on the tallest
      float led = step(2.5, crown) * step(topY - 3.0 * fH, v) * step(fract(fv * 2.0), 0.15) * p;
      wall += vec3(0.6, 0.85, 1.0) * led * 1.2;
    }
    // light spilling onto the wall around a lit window
    vec2 qd = max(abs(vec2(fuo - 0.5, fv - (wy0 + wy1) * 0.5)) * vec2(bw / sub, fH) - vec2(ww * bw / sub, winH * fH) * 0.5, 0.0);
    wall += Lroom * 0.1 * exp(-length(qd) * 4.0) * hasWin * (1.0 - ground) * (1.0 - glass);
    // sills and lintels
    float lin = (1.0 - glass) * hasWin * inBays * (1.0 - ground) * (1.0 - parapet) * step(abs(fuo - 0.5), ww * 0.5 + 0.035) * (step(abs(fv - wy1 - 0.035), 0.035) + step(abs(fv - wy0 + 0.02), 0.022)) * step(abs(style - S_MODERN), 0.1 - 1.0);
    lin = (1.0 - glass) * hasWin * inBays * (1.0 - ground) * (1.0 - parapet) * step(abs(fuo - 0.5), ww * 0.5 + 0.035) * clamp(step(abs(fv - wy1 - 0.035), 0.035) + step(abs(fv - wy0 + 0.02), 0.022), 0.0, 1.0) * (1.0 - step(abs(style - S_MODERN), 0.1));
    wall = mix(wall, stone * 1.2 * Lw + Lroom * 0.06, lin);
    // the coping at the top of the parapet; a dark line under a cornice
    wall *= 1.0 + 0.6 * step(tierTop - 0.1, v);
    // the shop zone behind the shop quads, and the shop cornice's shadow above it
    wall *= 1.0 - 0.45 * hasShop * smoothstep(gH + 0.6, gH, v) * step(gH - 0.01, v);
    // ---- far: the average of a whole cell ----
    float area = clamp(ww * winH, 0.05, 1.0) * hasWin * (1.0 - parapet);
    vec3 avgRoom = Lroom * 0.42 + glassRefl;
    // (beyond a few px per window the per-window state is noise: average over the floor's density)
    float fd = dens * smoothstep(0.0, 0.25, p - 0.04 - 0.5 * floorK);
    vec3 avgLight = mix(Lroom * 0.42, (Lc * fd * 0.45 * gain + candleC * candle * 0.3), smoothstep(1.2, 3.0, px));
    vec3 farC = mix(wall, avgLight + envRefl(Rf, 0.0) * (glass > 0.5 ? 0.35 : 0.06), area * (glass > 0.5 ? 0.75 : 1.0));
    col = mix(wall, inside, glassAmt);
    col = mix(col, farC, far);
    winA = glassAmt * (1.0 - far) + area * far;
    return col;
  }

  // roofs: tar and gravel, membrane seams, skylights; moonlit
  vec3 roofShade(vec3 W, vec3 C, vec3 S, vec4 F0, vec4 F2, float p) {
    vec3 N = vec3(0.0, 1.0, 0.0);
    float seed = F0.x;
    float kind = h11(seed * 2.7);
    vec3 alb = kind < 0.25 ? vec3(0.28, 0.28, 0.27) : kind < 0.5 ? vec3(0.07, 0.07, 0.075) : kind < 0.8 ? vec3(0.13, 0.12, 0.11) : vec3(0.18, 0.2, 0.17);
    vec2 q = W.xz - C.xz;
    float px = max(fwidth(W.x), fwidth(W.z));
    float seams = smoothstep(0.3, 0.05, px) * step(fract((kind < 0.5 ? q.x : q.y) / 0.95), 0.04);
    alb *= 0.85 + 0.25 * vnoise(q * 0.6 + seed) - 0.15 * seams;
    // edge darkening near the parapet
    vec2 e = S.xz * 0.5 - abs(q);
    alb *= 0.75 + 0.25 * smoothstep(0.0, 1.6, min(e.x, e.y));
    vec3 c = alb * (ambient(N, p) * 1.3 + sunLight(W, N) + peopleGlow(W, N));
    // light from the street below the edges
    c += alb * streetLight(W.xz, W.y, p) * 0.05;
    return c;
  }
`;
