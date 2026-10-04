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
    skyTop: { value: new THREE.Color(0.0011, 0.0016, 0.0062) }, skyHor: { value: new THREE.Color(0.01, 0.009, 0.02) },
    // light
    uLightMap: { value: null as THREE.Texture | null }, uLMRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uMoonDir: { value: new THREE.Vector3(-0.35, 0.42, -0.84).normalize() }, uMoonCol: { value: new THREE.Color(0.05, 0.058, 0.08) },
    uSkyAmb: { value: new THREE.Color(0.008, 0.01, 0.018) }, uGlowAmb: { value: new THREE.Color(0.03, 0.019, 0.013) },
    uHazeCol: { value: new THREE.Color(0.072, 0.034, 0.016) }, uHazeNight: { value: new THREE.Color(0.005, 0.007, 0.014) },
    uHazeD: { value: 0.00042 }, uHazeH: { value: 80 },
    // wet ground reflections (filled by City's mirror)
    uMirror: { value: null as THREE.Texture | null }, uMirrorMat: { value: new THREE.Matrix4() }, uMirrorOn: { value: 0 },
    // windows cut open for people inside (x, y, z centre; w) and (half x, half y, half z)
    uOpenA: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -1e5, 0, 0)) },
    uOpenB: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uOpenN: { value: 0 },
    // glowing people light the walls, windows and streets near them: (x, y, z, radius), (r, g, b, -)
    uPGlowP: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, -1e5, 0, 1)) },
    uPGlowC: { value: Array.from({ length: 16 }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uPGlowN: { value: 0 }, uPGlowNi: { value: 0 },
    // dawn: a low warm sun, mist, the lights going out
    uFlash: { value: new THREE.Vector2(0, 0) },
    uDawn: { value: 0 }, uSunDir: { value: new THREE.Vector3(0.75, 0.16, -0.64).normalize() }, uSunCol: { value: new THREE.Color(1.0, 0.56, 0.26) },
  };
}
export type CityUniforms = ReturnType<typeof cityUniforms>;

/** Uniform declarations + helpers: hashes, noise, power, light map, ambient, haze, environment. (Lean: the
 * cloud renderer, SwiftShader, runs every instruction of a shader for every pixel, branches or not.) */
export const CITY_GLSL = /* glsl */ `
  uniform float uDebug;
  uniform float uTime, uPow, uGlowK, wake, wakeR, wakeSoft, gold, goldR, gain, fogD, uHazeD, uHazeH, uMirrorOn;
  uniform vec4 uWave[4]; uniform vec4 uWaveK[4];
  uniform sampler2D uBlockMask; uniform vec4 uMaskRect;
  uniform vec3 wakeFrom, goldFrom, fogC, skyTop, skyHor, uMoonDir, uMoonCol, uSkyAmb, uGlowAmb, uHazeCol, uHazeNight;
  uniform sampler2D uLightMap; uniform vec4 uLMRect; uniform vec3 uOrigin;
  uniform vec4 uPGlowP[16]; uniform vec4 uPGlowC[16]; uniform float uPGlowN; uniform int uPGlowNi;
  uniform float uDawn; uniform vec3 uSunDir, uSunCol; uniform vec2 uFlash;
  uniform vec4 uOpenA[6]; uniform vec4 uOpenB[6]; uniform int uOpenN;

  float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float h13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
  vec2 h22m(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), f.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm3(vec2 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3); }
  float bitOf(float m, float b) { return mod(floor(m / b + 0.001), 2.0); }

  // electric power at a place (world xz), 0..1
  float power(vec2 xzw) {
    vec2 xz = xzw - uOrigin.xz;
    float p = uPow;
    for (int i = 0; i < 4; i++) {
      vec4 w = uWave[i];
      float k = (1.0 - smoothstep(w.z - w.w, w.z, length(xz - w.xy))) * uWaveK[i].y;
      p = mix(p, uWaveK[i].x, k);
    }
    p *= texture2D(uBlockMask, (xz - uMaskRect.xy) * uMaskRect.zw).r;
    p *= clamp(wake, 0.0, 1.0) * (1.0 - smoothstep(wakeR - wakeSoft, wakeR, length(xz - wakeFrom.xz)));
    return clamp(p, 0.0, 1.0);
  }
  float goldAt(vec2 xz) { return gold * (1.0 - smoothstep(goldR - 80.0, goldR, length(xz - uOrigin.xz - goldFrom.xz))); }

  // static street light (lamps, shopfronts) baked on the ground, before power
  vec3 lightMap(vec2 xz) { vec3 s = texture2D(uLightMap, (xz - uOrigin.xz - uLMRect.xy) * uLMRect.zw).rgb; return s * s * 4.0; }
  // the street light reaching a point at height y above the street, its power applied (sodium warms up red)
  vec3 streetLight(vec2 xz, float y, float p) {
    vec3 tint = mix(vec3(1.0), vec3(1.6, 0.5, 0.25), (1.0 - smoothstep(0.0, 0.35, p)));
    return lightMap(xz) * p * tint * (0.5 + 0.5 * smoothstep(0.0, 4.0, y)) * exp(-max(y - 4.0, 0.0) * 0.2) * (1.0 - 0.85 * uDawn);
  }
  // sky and moon light on a surface with normal N (+ the dawn sky)
  vec3 ambient(vec3 N) {
    float up = N.y * 0.5 + 0.5;
    vec3 c = (uSkyAmb + uGlowAmb * uGlowK * (1.0 - uDawn)) * (0.3 + 0.7 * up);
    c += uMoonCol * max(dot(N, uMoonDir), 0.0) * (1.0 - uDawn);
    c += uDawn * mix(vec3(0.035, 0.04, 0.065), vec3(0.09, 0.09, 0.12), up);
    return c;
  }
  // the low sun at dawn: streets in the blocks' shadow, upper floors and roofs lit. The shadow height varies
  // slowly over the city (compute it per vertex: sunShadowH), the rest per pixel (sunLit).
  float sunShadowH(vec2 xz) { return 8.0 + 144.0 * vnoise(xz * 0.008 + 3.0) * vnoise(xz * 0.002 + 1.0); }
  vec3 sunLit(vec3 N, float lit) { return uSunCol * (uDawn * 1.6 * max(dot(N, uSunDir), 0.0) * lit); }
  vec3 sunLight(vec3 W, vec3 N) {
    float sh = sunShadowH(W.xz);
    return sunLit(N, max(step(0.5, N.y), smoothstep(sh - 8.0, sh + 8.0, W.y)));
  }
  // (small things near the ground: in the shadow below ~25 m)
  vec3 sunLow(vec3 W, vec3 N) { return sunLit(N, smoothstep(15.0, 35.0, W.y)); }
  // light from the glowing people near a point
  vec3 peopleGlow(vec3 W, vec3 N) {
    vec3 L = vec3(0.0);
    for (int i = 0; i < uPGlowNi; i++) {
      vec3 d = uPGlowP[i].xyz - W;
      float r = max(uPGlowP[i].w, 0.01), dd = dot(d, d);
      float ndl = dot(N, d) * inversesqrt(max(dd, 1e-4));
      L += uPGlowC[i].rgb * (0.2 + 0.8 * max(ndl, 0.0)) / (1.0 + dd / (r * r)) * (1.0 - smoothstep(9.0 * r * r, 25.0 * r * r, dd));
    }
    return L;
  }
  vec3 hazeColor(float p) {
    vec3 h = mix(uHazeNight, uHazeCol, mix(uGlowK, p, 0.4)) * (1.0 + gold * vec3(0.5, 0.15, -0.6));
    return mix(h, vec3(0.3, 0.2, 0.17), uDawn);
  }
  // how much haze between the camera and W (exponential in height, integrated along the ray), and the distance fog
  vec2 fogK(vec3 W) {
    vec3 ro = cameraPosition;
    float d = length(W - ro);
    float y0 = max(ro.y, 0.0), y1 = max(W.y, 0.0), dy = y1 - y0;
    float e0 = exp(-y0 / uHazeH), e1 = exp(-y1 / uHazeH);
    float integ = abs(dy) > 0.05 ? uHazeH * (e0 - e1) / dy : e0;
    return vec2(1.0 - exp(-uHazeD * d * max(integ, 0.0)), exp(-fogD * fogD * d * d));
  }
  vec3 applyFog(vec3 c, vec2 fk, float p) { vec3 h = hazeColor(p); return mix(mix(h, fogC, 0.25), mix(c, h, clamp(fk.x, 0.0, 1.0)), fk.y); }
  vec3 cityFog(vec3 c, vec3 W, float p) { return applyFog(c, fogK(W), p); }
  // the sky in a direction (for reflections)
  vec3 skyRefl(vec3 R) {
    vec3 night = mix(skyHor, skyTop, clamp(R.y * 1.8, 0.0, 1.0)) + uHazeCol * uGlowK * 0.5 * exp(-max(R.y, 0.0) * 7.0) + uMoonCol * pow(max(dot(R, uMoonDir), 0.0), 24.0) * 0.4;
    vec3 dawn = mix(vec3(0.55, 0.38, 0.3), vec3(0.3, 0.38, 0.55), clamp(R.y * 1.5, 0.0, 1.0)) + uSunCol * pow(max(dot(R, uSunDir), 0.0), 12.0) * 1.2;
    return mix(night, dawn, uDawn);
  }
  // what a glass pane reflects: the sky with the city's glow on the horizon, the moon, the lit neighbours
  vec3 envRefl(vec3 R, float jit) {
    vec3 c = skyRefl(R);
    float az = atan(R.z, R.x + 1e-5) + jit;
    vec2 q = vec2(az * 70.0, R.y * 110.0);
    vec2 cell = floor(q);
    float lit = step(0.78, h12(cell)) * step(0.25, fract(q.x)) * step(0.3, fract(q.y));
    float k = smoothstep(0.16, 0.05, R.y);
    c = mix(c, vec3(0.008, 0.008, 0.011) + uHazeCol * 0.15 * uGlowK, k);
    return c + mix(vec3(1.0, 0.72, 0.42), vec3(0.8, 0.88, 1.0), fract(lit * 7.0 + cell.x * 0.13)) * lit * k * 0.32 * uGlowK;
  }
`;

/**
 * Per-vertex part of a facade (in the building vertex shader, after W, N, C (centre x, y0, z), S (size) are known):
 * per-face constants (width, windows / shops on this face, the bay grid), u along the face, the power and the
 * gold at the vertex.
 */
export const FACADE_VS = /* glsl */ `
  varying vec4 vFace;  // face width, has windows, has shops, face id
  varying vec4 vGrid;  // corner pier, number of bays, bay width, floors
  varying vec4 vUVP;   // u along the face (m from its left corner), tier y0, tier top, units per apartment
  varying vec3 vPG;    // power, gold, the height of the dawn shadow here
  void facadeVertex(vec3 W, vec3 N, vec3 C, vec3 S, vec4 F0, vec4 F1, vec4 F3) {
    vec3 T = vec3(N.z, 0.0, -N.x);
    float faceW = abs(T.x) * S.x + abs(T.z) * S.z;
    float faceBit = N.x < -0.5 ? 1.0 : N.x > 0.5 ? 2.0 : N.z < -0.5 ? 4.0 : 8.0;
    float faceId = N.x < -0.5 ? 0.0 : N.x > 0.5 ? 1.0 : N.z < -0.5 ? 2.0 : 3.0;
    float masks = F3.x;
    float hasWin = bitOf(mod(masks, 16.0), faceBit) * step(abs(N.y), 0.5);
    float hasShop = bitOf(floor(masks / 16.0 + 0.001), faceBit) * step(C.y, 0.5);
    float glass = step(abs(F0.y - 2.0), 0.1);
    float pier = glass > 0.5 ? 0.0 : 0.55;
    float avail = max(faceW - 2.0 * pier, 0.5);
    float nb = max(1.0, floor(avail / F1.x + 0.5));
    vFace = vec4(faceW, hasWin, hasShop, faceId);
    vGrid = vec4(pier, nb, avail / nb, max(1.0, floor((F3.y - F0.w) / F0.z)));
    vUVP = vec4(dot(W.xz - C.xz, T.xz) + faceW * 0.5, C.y, C.y + S.y, 2.0 + floor(h11(F0.x * 5.5 + faceId) * 2.0));
    vPG = vec3(power(W.xz), goldAt(W.xz), sunShadowH(W.xz));
  }
`;

/**
 * The facade (fragment). #define FAC_LOD 0 (close: rooms behind the glass, reveals, brick), 1 (frames, curtains,
 * AC units, flat rooms), 2 (far: lit windows and their average); FAC_GLASS 1 for curtain walls.
 */
export const FACADE_GLSL = /* glsl */ `
  varying vec4 vFace, vGrid, vUVP; varying vec3 vPG;
  #ifndef FAC_LOD
  #define FAC_LOD 1
  #endif
  #ifndef FAC_GLASS
  #define FAC_GLASS 0
  #endif
  #if FAC_LOD == 0
  // a lit room seen through the glass: ro on the glass (room space: x across, y up, z into the room), rd the ray
  vec3 roomColor(vec3 ro, vec3 rd, vec3 R, vec3 Lc, float seed, float office) {
    vec3 tm = (mix(vec3(0.0), R, step(0.0, rd)) - ro) / (rd + sign(rd + 1e-6) * 1e-4);
    float t = min(tm.x, min(tm.y, tm.z));
    vec3 p = ro + rd * t;
    vec3 lamp = vec3(R.x * (0.2 + 0.6 * fract(seed * 7.1)), office > 0.5 ? R.y - 0.05 : R.y * 0.9, R.z * (0.35 + 0.45 * fract(seed * 5.7)));
    vec3 dl = p - lamp;
    float fall = 0.18 + 0.82 / (1.0 + dot(dl, dl) * (office > 0.5 ? 0.02 : 0.16));
    float hx = p.x / max(R.x, 0.1);
    float back = step(tm.z, t + 1e-4), ceil_ = step(tm.y, t + 1e-4) * step(0.0, rd.y), flo = step(tm.y, t + 1e-4) * step(rd.y, 0.0);
    vec3 paint = mix(vec3(0.85, 0.78, 0.66), mix(vec3(0.62, 0.7, 0.8), vec3(0.75, 0.55, 0.45), fract(seed * 2.9)), step(0.6, fract(seed * 1.7)));
    paint = mix(paint, vec3(0.55, 0.56, 0.58), office);
    // back wall: a sofa / desks, a picture, a bookcase
    float sofa = step(p.y, 0.85) * step(0.08 + 0.32 * fract(seed * 4.1), hx) * step(hx, 0.5 + 0.42 * fract(seed * 4.7));
    float pic = step(0.45, fract(seed * 9.7)) * step(abs(hx - 0.5), 0.13) * step(abs(p.y - 1.6), 0.28);
    float shelf = step(0.55, fract(seed * 8.3)) * step(abs(hx - 0.15 - 0.7 * fract(seed * 8.9)), 0.12) * step(p.y, 2.1) * step(0.5, fract(p.y * 3.2));
    vec3 cb = paint * 0.62 * (1.0 - 0.75 * sofa * (1.0 - office) - 0.5 * office * step(p.y, 1.3));
    cb = mix(cb, mix(vec3(0.75, 0.42, 0.25), vec3(0.3, 0.45, 0.7), fract(seed * 3.9)), pic * 0.7 * (1.0 - office));
    cb = mix(cb, vec3(0.45, 0.25, 0.15) * (0.6 + 0.6 * h12(floor(p.xy * vec2(14.0, 3.2)))), shelf * 0.8);
    // ceiling: the lamp or rows of office panels; floor: boards / carpet
    vec2 dc = p.xz - lamp.xz;
    float panel = office * step(0.66, fract(p.x / 1.5)) * step(0.5, fract(p.z / 2.4));
    vec3 cc = vec3(0.8) * (0.5 + 3.0 * exp(-dot(dc, dc) * 2.0) * (1.0 - office)) + panel * 3.0;
    vec3 cf = mix(vec3(0.4, 0.26, 0.15), vec3(0.12, 0.12, 0.13), office) * 0.7;
    vec3 cs = paint * 0.5;
    vec3 c = cb * back + cc * ceil_ + cf * flo + cs * (1.0 - min(back + ceil_ + flo, 1.0));
    return c * Lc * fall * (1.0 - 0.35 * clamp(t / (R.z * 1.6), 0.0, 1.0));
  }
  #endif


  #if FAC_LOD == 2
  // far away: the window grid, each window lit or dark (one hash), and beyond a pixel the average; no rooms
  vec3 facade(vec3 W, vec3 N, vec3 V, vec4 F0, vec4 F1, vec4 F2, vec4 F3) {
    float seed = F0.x, style = F0.y, fH = F0.z, gH = F0.w;
    float winW = F1.y, winH = F1.z, sill = F1.w;
    float density = F2.a, topY = F3.y, crown = mod(F3.z, 4.0), pairs = floor(F3.z * 0.25 + 0.001);
    float hasWin = vFace.y, faceId = vFace.w, pier = vGrid.x, nb = vGrid.y, bw = vGrid.z, nFl = vGrid.w;
    float tierY = vUVP.y, tierTop = vUVP.z, p = vPG.x, gl = vPG.y, v = W.y;
    vec2 q = vec2((vUVP.x - pier) / bw, (v - gH) / fH);
    vec2 cell = floor(q), f = fract(q), fw = fwidth(q) + 1e-4;
    float px = max(fw.x, fw.y);
    #if FAC_GLASS
      float ww = 1.0;
    #else
      float sub = pairs > 1.5 ? 2.0 : 1.0;
      float ww = min(winW * sub, 0.96);
      f.x = fract(f.x * sub); fw.x *= sub;
    #endif
    // the opening (antialiased), then its coverage when windows are smaller than a pixel
    vec2 d = abs(f - vec2(0.5, sill + winH * 0.5)) - vec2(ww, winH) * 0.5;
    float inW = clamp(0.5 - max(d.x / fw.x, d.y / fw.y), 0.0, 1.0);
    inW = mix(inW, ww * winH, smoothstep(0.6, 1.6, px));
    inW *= hasWin * step(0.0, q.y) * step(v, tierTop - 0.6) * step(0.0, q.x) * step(q.x, nb);
    // lit or not: occupied, powered (lower floors first), lights going out at dawn
    float h = h13(vec3(seed * 0.37 + faceId * 3.1, cell.y * 1.37 + 0.11, floor(cell.x / (FAC_GLASS > 0 ? 14.0 : 2.0)) * 0.71 + 0.3));
    float floorK = clamp((cell.y + 1.0) / (nFl + 1.0), 0.0, 1.0);
    float on = step(h, density) * step(0.04 + 0.5 * floorK + 0.4 * fract(h * 13.7), p) * step(uDawn * 0.85, fract(h * 23.0));
    on = mix(on, density * smoothstep(0.0, 0.3, p - 0.04 - 0.5 * floorK) * (1.0 - 0.85 * uDawn), smoothstep(1.2, 3.0, px));
    on = max(on, step(fract(h * 5.3 + uFlash.y * 1.618), uFlash.x));
    float k = fract(h * 3.1);
    vec3 Lc = FAC_GLASS > 0 ? vec3(0.82, 0.92, 0.9) * 0.6 : mix(vec3(1.0, 0.6, 0.3) * (0.55 + 0.6 * fract(h * 4.1)), vec3(0.85, 0.86, 0.9) * 0.55, step(0.62, k));
    Lc = mix(Lc, vec3(1.0, 0.7, 0.25), gl * 0.85);
    vec3 win = Lc * on * gain * 0.42;
    // the wall: sky light, moon, the street's glow low down, floodlit crowns
    vec3 Lw = ambient(N) + streetLight(W.xz + N.xz * 2.0, v, p) * 0.55 + sunLit(N, smoothstep(vPG.z - 8.0, vPG.z + 8.0, v));
    float crownK = step(0.5, crown) * step(crown, 1.5) * step(topY * 0.55, tierY + 0.1) * step(0.1, h11(seed * 3.7));
    Lw += mix(vec3(1.0, 0.86, 0.66), vec3(1.0, 0.7, 0.25), gl) * crownK * p * (0.3 + 1.6 * exp(-(v - tierY) / 9.0));
    vec3 alb = F2.rgb;
    #if FAC_GLASS == 0
      // stone bands over the ground floor and under the top floors, a stone base on the older styles
      float older = step(style, 1.1) + step(abs(style - 6.0), 0.1) + step(abs(style - 3.0), 0.1);
      float band = older * step(abs(v - gH - 0.12), 0.2) + step(abs(style - 1.0), 0.1) * step(abs(v - (topY - 3.0 * fH) - 0.12), 0.18);
      alb = mix(alb, mix(vec3(0.42, 0.38, 0.32), F2.rgb * 1.3, 0.3) * 1.1, max(band, (step(abs(style - 1.0), 0.1) + step(abs(style - 3.0), 0.1)) * step(v, gH + fH)));
      // a TV's blue in some of the dark windows
      win += vec3(0.05, 0.08, 0.2) * step(0.93, fract(h * 11.0)) * (1.0 - on) * step(0.3, p) * inW;
    #endif
    vec3 wall = alb * Lw;
    #if FAC_GLASS
      vec3 Rf = reflect(V, N);
      wall = F2.rgb * 0.6 + mix(skyHor, skyTop, clamp(Rf.y * 1.8, 0.0, 1.0)) * 0.3 + F2.rgb * Lw * 0.5;
      wall += vec3(0.6, 0.85, 1.0) * step(2.5, crown) * step(topY - 3.0 * fH, v) * step(fract(f.y * 2.0), 0.15) * p * 1.2;
      win += mix(skyHor, skyTop, clamp(Rf.y * 1.8, 0.0, 1.0)) * 0.3;
    #endif
    return mix(wall, win, inW);
  }
  #else
  vec3 facade(vec3 W, vec3 N, vec3 V, vec4 F0, vec4 F1, vec4 F2, vec4 F3) {
    float seed = F0.x, style = F0.y, fH = F0.z, gH = F0.w;
    float bayW = F1.x, winW = F1.y, winH = F1.z, sill = F1.w;
    vec3 wallAlb = F2.rgb; float density = F2.a;
    float topY = F3.y, crown = mod(F3.z, 4.0), pairs = floor(F3.z * 0.25 + 0.001), warmth = F3.w;
    float hasWin = vFace.y, hasShop = vFace.z, faceId = vFace.w;
    float pier = vGrid.x, nb = vGrid.y, bw = vGrid.z, nFl = vGrid.w;
    float u = vUVP.x, tierY = vUVP.y, tierTop = vUVP.z, unitBays = vUVP.w;
    float p = vPG.x, gl = vPG.y;
    float v = W.y;
    // ---- the grid ----
    float ub = (u - pier) / bw, bi = floor(ub), fu = fract(ub);
    float inBays = step(0.0, ub) * step(ub, nb);
    float ground = step(v, gH);
    float fq = (v - gH) / fH, fl = floor(fq), fv = fract(fq);
    float parapet = step(tierTop - 0.6, v);
    vec2 dd = vec2(fwidth(ub), fwidth(fq));
    float px = max(dd.x, dd.y);
    #if FAC_GLASS
      float sub = 1.0, fuo = fu, ww = 1.0;
      float wx0 = 0.0, wx1 = 1.0;
    #else
      float sub = pairs > 1.5 ? 2.0 : 1.0;
      float fuo = fract(fu * sub), ww = min(winW * sub, 0.96);
      float wx0 = 0.5 - ww * 0.5, wx1 = 0.5 + ww * 0.5;
    #endif
    vec2 aa = dd * vec2(sub, 1.0) * 0.7 + 1e-4;
    float inX = smoothstep(wx0 - aa.x, wx0 + aa.x, fuo) * smoothstep(wx1 + aa.x, wx1 - aa.x, fuo);
    float inY = smoothstep(sill - aa.y, sill + aa.y, fv) * smoothstep(sill + winH + aa.y, sill + winH - aa.y, fv);
    float isWin = inX * inY * inBays * hasWin * (1.0 - ground) * (1.0 - parapet) * step(0.0, fl);
    #if FAC_GLASS == 0 && FAC_LOD < 2
      // houses without shops have windows on the ground floor too (with grilles)
      float gWin = ground * (1.0 - hasShop) * hasWin * inBays * inX * smoothstep(0.32, 0.36, v / gH) * smoothstep(0.86, 0.82, v / gH);
      isWin = max(isWin, gWin);
    #else
      float gWin = 0.0;
    #endif
    // ---- who is awake: apartments (a few bays) or office floors ----
    float office = FAC_GLASS > 0 ? 1.0 : step(abs(style - 3.0), 0.1) * step(0.4, h11(seed * 2.3));
    float flId = mix(fl, -1.0, ground);
    float col = office > 0.5 ? floor(bi / 14.0) : floor(bi / unitBays);
    float unitH = h13(vec3(seed * 0.71 + faceId, flId * 0.93 + 2.0, col * 1.3 + 0.7));
    float roomSeed = h13(vec3(seed * 0.37 + faceId * 3.1, flId * 1.37 + 0.11, (office > 0.5 ? col : bi) * 0.71 + 0.3));
    float floorK = clamp((flId + 1.0) / (nFl + 1.0), 0.0, 1.0);
    float occ = max(step(unitH, density) * mix(step(0.3, fract(roomSeed * 17.0)), 1.0, office), step(fract(roomSeed * 5.3 + uFlash.y * 1.618), uFlash.x));
    occ *= step(uDawn * 0.85, fract(roomSeed * 23.0));
    float th = 0.04 + 0.5 * floorK + 0.4 * fract(roomSeed * 13.7);
    float dp = p - th;
    #if FAC_LOD < 2
      float flick = step(0.45, h12(vec2(roomSeed * 91.0, floor(uTime * 17.0))));
      float on = occ * step(0.0, dp) * mix(flick, 1.0, smoothstep(0.03, 0.09, dp));
      // a light coming on flares for a moment: the front of a returning wave sparkles
      float startle = occ * step(0.0, dp) * exp(-max(dp, 0.0) * 14.0);
    #else
      float on = occ * step(0.0, dp), startle = 0.0;
    #endif
    // the light: warm lamps, cool LEDs, TVs, kitchens, coloured strips; offices fluorescent
    float k = fract(roomSeed * 3.1);
    vec3 Lc;
    float tv = 0.0;
    if (office > 0.5) Lc = mix(vec3(0.82, 0.92, 0.9), vec3(1.0, 0.6, 0.3), step(0.8, k)) * (0.55 + 0.2 * fract(roomSeed * 4.1));
    else if (k < 0.5 + 0.2 * warmth) Lc = vec3(1.0, 0.6, 0.3) * (0.55 + 0.6 * fract(roomSeed * 4.1));
    else if (k < 0.72) Lc = vec3(0.85, 0.86, 0.9) * (0.45 + 0.4 * fract(roomSeed * 4.1));
    else if (k < 0.82) { Lc = vec3(0.35, 0.5, 1.0) * 0.16 * (0.7 + 0.3 * sin(uTime * 9.0 + roomSeed * 30.0) * sin(uTime * 4.3 + roomSeed * 11.0)); tv = 1.0; }
    else if (k < 0.97) Lc = vec3(0.95, 0.95, 0.8) * 0.6;
    else Lc = mix(vec3(0.75, 0.3, 1.0), vec3(1.0, 0.25, 0.35), fract(roomSeed * 9.1)) * 0.5;
    #if FAC_GLASS == 0 && FAC_LOD < 2
      // stairwells: one column of small windows, dim fluorescent on every floor
      float stair = step(abs(bi - floor(h11(seed * 9.9 + faceId) * nb)), 0.1) * step(0.5, h11(seed * 4.9 + faceId)) * (1.0 - office);
      Lc = mix(Lc, vec3(0.75, 0.85, 0.8) * 0.3, stair); on = mix(on, step(0.1 + 0.6 * floorK, p), stair); tv *= 1.0 - stair;
      // blackout: candles and phones in a few windows
      float candle = (1.0 - step(0.05, p)) * step(fract(roomSeed * 77.0), 0.02) * hasWin * (1.0 - office);
      vec3 candleC = mix(vec3(1.0, 0.45, 0.12) * (0.55 + 0.25 * sin(uTime * 11.0 + roomSeed * 50.0) * sin(uTime * 7.3 + roomSeed * 20.0)), vec3(0.3, 0.45, 1.0) * 0.25, step(0.5, fract(roomSeed * 5.0)));
    #else
      float candle = 0.0; vec3 candleC = vec3(0.0);
    #endif
    Lc = mix(Lc, vec3(1.0, 0.7, 0.25) * (0.8 + 0.4 * fract(roomSeed * 2.0)), gl * 0.85);
    vec3 Lroom = Lc * (1.0 + startle * 2.2) * on * gain + candleC * candle;
    // ---- light on the wall ----
    vec3 street = streetLight(W.xz + N.xz * 2.0, v, p);
    vec3 Lw = ambient(N) + street * 0.55 + sunLit(N, smoothstep(vPG.z - 8.0, vPG.z + 8.0, v));
    #if FAC_LOD == 0
      vec3 pg = peopleGlow(W, N);
      Lw += pg;
    #else
      vec3 pg = vec3(0.0);
    #endif
    // floodlit crowns: the upper tiers washed from their feet
    float crownK = step(0.5, crown) * step(crown, 1.5) * step(topY * 0.55, tierY + 0.1) * step(0.4, h11(seed * 3.7) + 0.5);
    vec3 floodC = mix(vec3(1.0, 0.86, 0.66), mix(vec3(0.6, 0.8, 1.0), vec3(1.0, 0.7, 0.35), h11(seed * 6.6)), step(0.6, h11(seed * 5.2)));
    Lw += mix(floodC, vec3(1.0, 0.7, 0.25), gl) * crownK * p * (0.3 + 1.6 * exp(-(v - tierY) / 9.0));
    // ---- wall albedo ----
    vec3 alb = wallAlb;
    #if FAC_GLASS == 0
      vec3 stone = mix(vec3(0.42, 0.38, 0.32), wallAlb * 1.3, 0.3);
      float older = step(style, 1.1) + step(abs(style - 6.0), 0.1) + step(abs(style - 3.0), 0.1);
      float band = older * step(abs(v - gH - 0.12), 0.2) + step(abs(style - 1.0), 0.1) * step(abs(v - (topY - 3.0 * fH) - 0.12), 0.18);
      float base = (step(abs(style - 1.0), 0.1) + step(abs(style - 3.0), 0.1)) * step(v, gH + fH);
      #if FAC_LOD == 0
        // brick courses, close up
        vec2 bq = vec2(u / 0.205, v / 0.077);
        bq.x += 0.5 * mod(floor(bq.y), 2.0);
        vec2 bf = fract(bq), bfw = fwidth(bq);
        float mortar = max(step(bf.y, 0.14), step(bf.x, 0.05)) * smoothstep(0.5, 0.15, max(bfw.x, bfw.y));
        float brick = (1.0 - base) * (1.0 - step(abs(style - 4.0), 0.1));
        alb = mix(alb, mix(alb * (0.82 + 0.36 * h12(floor(bq) + seed)), vec3(0.26, 0.24, 0.22), mortar), brick);
        alb *= 0.85 + 0.15 * vnoise(vec2(u * 0.35, v * 0.05) + seed);
      #endif
      alb = mix(alb, stone * (0.85 + 0.15 * step(0.12, fract(v / 0.5))), base);
      alb = mix(alb, stone * 1.15, band);
    #endif
    alb *= 1.0 - 0.1 * smoothstep(0.0, 1.0, v / max(topY, 1.0));
    vec3 wall = alb * Lw;
    #if FAC_GLASS
      // spandrels: dark glass that reflects; the slab edge glows on lit floors; an LED crown on some
      vec3 spand = wallAlb * 0.6 + skyRefl(reflect(V, N)) * (0.12 + 0.4 * pow(1.0 - clamp(abs(dot(V, N)), 0.0, 1.0), 4.0));
      wall = spand + wallAlb * Lw * 0.5 + Lroom * smoothstep(0.04, 0.0, abs(fv - sill - winH - 0.01)) * 0.18;
      wall += vec3(0.6, 0.85, 1.0) * step(2.5, crown) * step(topY - 3.0 * fH, v) * step(fract(fv * 2.0), 0.15) * p * 1.2;
      wall *= 1.0 - 0.7 * step(fuo, 0.04);
    #else
      // light spilling onto the wall around a lit window; sills and lintels; the coping
      vec2 qd = max(abs(vec2(fuo - 0.5, fv - sill - winH * 0.5)) * vec2(bw / sub, fH) - vec2(ww * bw / sub, winH * fH) * 0.5, 0.0);
      wall += Lroom * 0.1 * exp(-length(qd) * 4.0) * hasWin * (1.0 - ground);
      float lin = hasWin * inBays * (1.0 - ground) * (1.0 - parapet) * step(abs(fuo - 0.5), ww * 0.5 + 0.035) * clamp(step(abs(fv - sill - winH - 0.035), 0.035) + step(abs(fv - sill + 0.02), 0.022), 0.0, 1.0) * (1.0 - step(abs(style - 4.0), 0.1));
      wall = mix(wall, stone * 1.2 * Lw + Lroom * 0.06, lin);
    #endif
    wall *= 1.0 + 0.5 * step(tierTop - 0.1, v);
    wall *= 1.0 - 0.45 * hasShop * smoothstep(gH + 0.6, gH, v) * step(gH - 0.01, v);
    // ---- the window ----
    vec3 Rf = reflect(V, N);
    vec3 rd = vec3(dot(V, vec3(N.z, 0.0, -N.x)), V.y, dot(V, -N));
    float fres = pow(1.0 - clamp(rd.z, 0.0, 1.0), 4.0);
    #if FAC_LOD == 2
      vec3 refl = skyRefl(Rf) * (FAC_GLASS > 0 ? 0.3 + 0.6 * fres : 0.06 + 0.3 * fres);
      vec3 win = Lroom * 0.42 + refl;
      // smaller than a pixel: the floor's average light
      float fd = density * 0.7 * smoothstep(0.0, 0.25, p - 0.04 - 0.5 * floorK) * (1.0 - 0.85 * uDawn);
      vec3 avg = mix(vec3(1.0, 0.64, 0.34), vec3(0.8, 0.88, 1.0), 0.35 + 0.4 * office) * 0.6 * fd * 0.42 * gain + refl;
      float area = clamp(ww * winH, 0.05, 1.0) * hasWin * (1.0 - parapet) * (FAC_GLASS > 0 ? 0.75 : 1.0);
      float far = smoothstep(0.9, 2.2, px);
      vec3 c = mix(mix(wall, win, isWin), mix(wall, avg, area), far);
    #else
      float ow = ww * bw / sub, oh = winH * fH;
      vec2 wq = vec2((fuo - wx0) / max(wx1 - wx0, 1e-3) * ow, (fv - sill) / max(winH, 1e-3) * oh);
      #if FAC_GLASS
        vec3 refl = envRefl(normalize(Rf + vec3((h12(vec2(bi, fl) + seed) - 0.5) * 0.05, 0.0, 0.0)), 0.0) * (0.25 + 0.6 * fres);
      #else
        vec3 refl = envRefl(Rf, 0.0) * (0.07 + 0.4 * fres);
      #endif
      // the lit street below, reflected in the glass (lamps and shops across the way)
      refl += lightMap(W.xz + Rf.xz * min(W.y / max(-Rf.y, 0.05), 80.0)) * p * step(Rf.y, -0.02) * (0.04 + 0.25 * fres);
      vec3 inside = Lroom * 0.42;
      #if FAC_LOD == 0
        // the room itself, its depth and parallax (interior mapping), the reveal of the recess
        float depth = FAC_GLASS > 0 ? 0.06 : 0.2;
        vec3 rdn = normalize(rd);
        float rz = max(rdn.z, 0.05);
        vec3 R = office > 0.5 ? vec3(bw * 14.0, fH - 0.6, 11.0) : vec3(ow + 1.6, min(fH - 0.35, 2.75), 4.2);
        vec3 ro = vec3(clamp(wq.x + (office > 0.5 ? mod(bi, 14.0) * bw : 0.8), 0.02, R.x - 0.02), clamp(wq.y + sill * fH - 0.05, 0.02, R.y - 0.02), 0.0) + rdn * depth / rz;
        inside = mix(inside, roomColor(ro, rdn, R, Lroom, roomSeed * 91.0, office), smoothstep(0.1, 0.05, px) * step(0.001, on));
        inside += (1.0 - on) * (vec3(0.002, 0.002, 0.003) + street * 0.03 + pg * 0.3);
        float jx = depth * rdn.x / rz, jy = depth * rdn.y / rz;
        float reveal = (1.0 - float(FAC_GLASS)) * clamp(max(step(ow - max(jx, 0.0), wq.x) + step(wq.x, max(-jx, 0.0)), step(oh - max(jy, 0.0), wq.y) + step(wq.y, max(-jy, 0.0))), 0.0, 1.0);
      #else
        // a flat room: brighter towards the ceiling lamp, darker at the sill
        inside *= 0.75 + 0.5 * smoothstep(0.0, oh, wq.y);
        inside += (1.0 - on) * (vec3(0.002, 0.002, 0.003) + street * 0.03);
        float reveal = 0.0;
      #endif
      #if FAC_GLASS == 0
        // curtains, blinds, AC units in the lower sash, the frame and meeting rail
        float cur = (1.0 - office) * step(0.55, fract(roomSeed * 11.0));
        float side = fract(roomSeed * 12.0) < 0.5 ? wq.x / ow : 1.0 - wq.x / ow;
        float cover = cur * step(side, 0.2 + 0.6 * fract(roomSeed * 13.0));
        vec3 fabric = mix(vec3(0.95, 0.7, 0.45), mix(vec3(0.85, 0.85, 0.88), vec3(0.95, 0.88, 0.72), fract(roomSeed * 15.0)), fract(roomSeed * 14.0));
        inside = mix(inside, fabric * Lroom * 0.55 * (0.75 + 0.25 * sin(wq.x * 40.0 + roomSeed * 6.0)), cover);
        float blinds = step(0.82, fract(roomSeed * 16.0)) * (1.0 - cover) * step(oh * (1.0 - fract(roomSeed * 17.0) * 0.8), oh - wq.y);
        float slat = mix(smoothstep(0.35, 0.65, fract(wq.y * 12.0)), 0.5, smoothstep(0.2, 0.5, fwidth(wq.y * 12.0)));
        inside = mix(inside, mix(inside, Lroom * 0.32, slat), blinds);
        float ac = step(0.8, fract(roomSeed * 19.0)) * step(style, 1.1 + step(abs(style - 5.0), 0.1) * 9.0) * (1.0 - gWin) * step(abs(wq.x - ow * 0.5), ow * 0.36) * step(wq.y, oh * 0.32);
        vec3 acC = vec3(0.45, 0.43, 0.4) * (Lw + Lroom * 0.15) * (0.85 + 0.15 * step(0.5, fract(wq.x * 30.0)));
        float fr = clamp(max(step(abs(wq.y - oh * 0.52), 0.035), max(step(wq.x, 0.05) + step(ow - 0.05, wq.x), step(wq.y, 0.05) + step(oh - 0.05, wq.y))), 0.0, 1.0) * smoothstep(0.2, 0.08, px);
        vec3 frameC = mix(vec3(0.6, 0.58, 0.55), vec3(0.06, 0.05, 0.045), step(0.5, h11(seed * 8.8))) * (Lw + Lroom * 0.2);
        vec3 win = inside + refl;
        win *= 1.0 - gWin * 0.6 * step(0.8, fract(wq.x * 6.0));
        win = mix(win, frameC, fr);
        win = mix(win, acC, ac);
        win *= 1.0 - 0.35 * smoothstep(oh - 0.35, oh, wq.y);
      #else
        float blinds = step(0.85, fract(roomSeed * 16.0)) * (0.5 + 0.5 * step(0.5, fract(wq.y * 14.0)));
        vec3 win = inside * 0.8 * (1.0 - 0.55 * blinds) + refl;
      #endif
      win = mix(win, alb * Lw * 0.75 + Lroom * 0.15, reveal);
      vec3 c = mix(wall, win, isWin);
      // beyond a few px per window: the average of the cell
      float area = clamp(ww * winH, 0.05, 1.0) * hasWin * (1.0 - parapet);
      c = mix(c, mix(wall, Lroom * 0.42 + refl, area), smoothstep(0.4, 0.9, px));
    #endif
    return c;
  }
  #endif

`;

/** (fragment only) Cut the facade open where a window was opened for people inside (city.openWindow). */
export const OPEN_GLSL = /* glsl */ `
  // cut the facade open where a window was opened for people inside (city.openWindow)
  void openCut(vec3 W) {
    vec3 q = W - uOrigin;
    for (int i = 0; i < uOpenN; i++) { vec3 d = abs(q - uOpenA[i].xyz) - uOpenB[i].xyz; if (max(d.x, max(d.y, d.z)) < 0.0) discard; }
  }
`;

/** Roof surfaces. */
export const ROOF_GLSL = /* glsl */ `
  // roofs: tar and gravel, membrane seams; moonlit; the street light below the edges
  vec3 roofShade(vec3 W, vec3 C, vec3 S, float seed, float p) {
    float kind = h11(seed * 2.7);
    vec3 alb = kind < 0.25 ? vec3(0.28, 0.28, 0.27) : kind < 0.5 ? vec3(0.07, 0.07, 0.075) : kind < 0.8 ? vec3(0.13, 0.12, 0.11) : vec3(0.18, 0.2, 0.17);
    vec2 q = W.xz - C.xz;
    float px = max(fwidth(W.x), fwidth(W.z));
    float seams = smoothstep(0.3, 0.05, px) * step(fract((kind < 0.5 ? q.x : q.y) / 0.95), 0.04);
    alb *= 0.85 + 0.25 * vnoise(q * 0.6 + seed) - 0.15 * seams;
    vec2 e = S.xz * 0.5 - abs(q);
    alb *= 0.75 + 0.25 * smoothstep(0.0, 1.6, min(e.x, e.y));
    vec3 N = vec3(0.0, 1.0, 0.0);
    return alb * (ambient(N) * 1.3 + sunLit(N, 1.0) + peopleGlow(W, N) + streetLight(W.xz, W.y, p) * 0.05);
  }
`;
