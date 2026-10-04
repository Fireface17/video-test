// Highway scene, procedural textures baked once on the GPU at init (tileable, mipmapped, anisotropic):
//   asphalt  2048² over 1.6 m: aggregate stones in bitumen (albedo, height, roughness, stone id)
//   asphaltN 2048²: its normal map (+ cavity)
//   macro    1024×4096 over 32 m × 128 m: patches, tyre-polished wheel paths, puddles, sealed cracks, paint wear
//   clouds   1024²: tileable cloud layer (density, lit-underside term)
//   concrete 1024² over 2 m: board-formed concrete with pits and stains (barriers, pylons)
import * as THREE from 'three';
import { FSPass } from '../../engine/gl';

const PERIODIC = /* glsl */ `
vec2 ph22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float ph12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// periodic gradient noise, period per (cells)
float pnoise(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = ph22(mod(i, per)) * 2.0 - 1.0, g10 = ph22(mod(i + vec2(1, 0), per)) * 2.0 - 1.0;
  vec2 g01 = ph22(mod(i + vec2(0, 1), per)) * 2.0 - 1.0, g11 = ph22(mod(i + vec2(1, 1), per)) * 2.0 - 1.0;
  float a = dot(g00, f), b = dot(g10, f - vec2(1, 0)), c = dot(g01, f - vec2(0, 1)), d = dot(g11, f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4;
}
float pfbm(vec2 x, vec2 per, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; s += a * pnoise(x, per); x *= 2.0; per *= 2.0; a *= 0.5; }
  return s;
}
// periodic worley: x = F1, y = F2, z = cell hash, w = second hash
vec4 pworley(vec2 x, vec2 per, float jit) {
  vec2 i = floor(x), f = fract(x);
  float F1 = 9.0, F2 = 9.0; float id = 0.0, id2 = 0.0;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 o = vec2(float(xx), float(yy));
    vec2 c = mod(i + o, per);
    vec2 r = o + 0.5 + (ph22(c) - 0.5) * jit - f;
    float d = length(r);
    if (d < F1) { F2 = F1; F1 = d; id = ph12(c + 7.1); id2 = ph12(c + 3.3); } else if (d < F2) F2 = d;
  }
  return vec4(F1, F2, id, id2);
}
`;

function rt(w: number, h: number, wrap = THREE.RepeatWrapping, mip = true, aniso = 16) {
  const r = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false,
    generateMipmaps: mip, minFilter: mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: wrap, wrapT: wrap, anisotropy: aniso,
  });
  return r;
}

function bake(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, frag: string, uniforms: Record<string, THREE.IUniform> = {}) {
  const p = new FSPass(PERIODIC + frag, uniforms);
  const prev = renderer.getRenderTarget();
  p.render(renderer, target);
  renderer.setRenderTarget(prev);
  p.mat.dispose();
  return target.texture;
}

export interface HwTextures {
  asphalt: THREE.Texture;
  asphaltN: THREE.Texture;
  macro: THREE.Texture;
  clouds: THREE.Texture;
  concrete: THREE.Texture;
}

export function bakeTextures(renderer: THREE.WebGLRenderer): HwTextures {
  const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  // ---- asphalt aggregate (tile 1.6 m)
  const A = rt(2048, 2048, THREE.RepeatWrapping, true, aniso);
  bake(renderer, A, /* glsl */ `
    void main() {
      vec2 uv = vUv;
      // coarse stones ~11 mm, medium ~6 mm, fine grit
      vec4 w1 = pworley(uv * 144.0, vec2(144.0), 0.9);
      vec4 w2 = pworley(uv * 288.0 + 0.37, vec2(288.0), 1.0);
      float n = pfbm(uv * 8.0, vec2(8.0), 5);
      float r1 = 0.30 + 0.16 * w1.w;                      // stone radius (cell units)
      float s1 = smoothstep(r1 + 0.06, r1 - 0.06, w1.x) * smoothstep(0.02, 0.10, w1.y - w1.x) * step(0.2, w1.z + 0.15);
      float h1 = s1 * sqrt(max(0.0, 1.0 - pow(w1.x / (r1 + 0.06), 2.0)));
      float r2 = 0.26 + 0.12 * w2.w;
      float s2 = smoothstep(r2 + 0.05, r2 - 0.05, w2.x) * smoothstep(0.02, 0.08, w2.y - w2.x) * (1.0 - s1);
      float h2 = s2 * sqrt(max(0.0, 1.0 - pow(w2.x / (r2 + 0.05), 2.0))) * 0.6;
      float grit = pnoise(uv * 900.0, vec2(900.0)) * 0.5 + 0.5;
      float binder = 0.18 + 0.12 * grit + 0.1 * n;
      float h = max(max(h1 * (0.85 + 0.3 * w1.w), h2 + 0.12), binder * 0.55);
      // tone: stones vary from dark basalt to pale quartzite; binder near black
      float tone1 = mix(0.18, 0.62, pow(w1.z, 1.6)) + (w1.z > 0.93 ? 0.3 : 0.0);
      float tone2 = mix(0.14, 0.5, pow(w2.z, 1.4));
      float alb = mix(0.07 + 0.05 * grit, tone2 * (0.85 + 0.15 * grit), s2);
      alb = mix(alb, tone1 * (0.8 + 0.2 * grit), s1);
      alb *= 0.85 + 0.3 * n;
      float rough = mix(0.75, 0.35, max(s1, s2 * 0.8)); // polished stone tops
      fragColor = vec4(alb, h, rough, max(s1 * w1.z, s2 * w2.z));
    }`);
  // ---- its normal map
  const N = rt(2048, 2048, THREE.RepeatWrapping, true, aniso);
  bake(renderer, N, /* glsl */ `
    uniform sampler2D H;
    void main() {
      ivec2 p = ivec2(gl_FragCoord.xy);
      float hl = texelFetch(H, (p + ivec2(-1, 0)) & 2047, 0).g, hr = texelFetch(H, (p + ivec2(1, 0)) & 2047, 0).g;
      float hd = texelFetch(H, (p + ivec2(0, -1)) & 2047, 0).g, hu = texelFetch(H, (p + ivec2(0, 1)) & 2047, 0).g;
      float h = texelFetch(H, p, 0).g;
      vec3 n = normalize(vec3((hl - hr) * 3.2, (hd - hu) * 3.2, 1.0));
      // cavity: lower than the neighbourhood average (water collects there: smoother, darker)
      float avg = 0.0;
      for (int i = -3; i <= 3; i += 2) for (int j = -3; j <= 3; j += 2) avg += texelFetch(H, (p + ivec2(i, j) * 2) & 2047, 0).g;
      avg /= 16.0;
      float cav = clamp(0.5 + (h - avg) * 2.5, 0.0, 1.0);
      vec4 a = texelFetch(H, p, 0);
      // packed: albedo, roughness (cavities wetter), normal xy
      fragColor = vec4(a.r, mix(a.b * 0.8, a.b, cav), n.x * 0.5 + 0.5, n.y * 0.5 + 0.5);
    }`, { H: { value: A.texture } });

  // ---- macro (32 m across x in [-16, 16], 128 m along the road)
  const M = rt(1024, 4096, THREE.RepeatWrapping, true, aniso);
  bake(renderer, M, /* glsl */ `
    void main() {
      vec2 m = vec2(vUv.x * 32.0 - 16.0, vUv.y * 128.0);     // metres
      vec2 per = vec2(1.0, 4.0);
      vec2 q = vUv * vec2(8.0, 32.0);                         // 4 m cells
      float n1 = pfbm(q * 0.5, per * 4.0, 5);
      float n2 = pfbm(q * 2.0 + 3.1, per * 16.0, 4);
      float ax = abs(m.x);
      // wheel paths in each lane (polished, slightly rutted, holding water)
      float lx = mod(ax - 1.0, 3.6);
      float wp = exp(-pow((lx - 0.95) / 0.32, 2.0)) + exp(-pow((lx - 2.65) / 0.32, 2.0));
      wp *= step(1.0, ax) * step(ax, 11.8);
      // patches: rectangular repairs (darker, newer binder)
      vec2 pc = floor(vec2(m.x / 3.6, m.y / 9.0));
      float ph = ph12(mod(pc, vec2(9.0, 14.2)) + 5.0);
      vec2 pf = fract(vec2(m.x / 3.6, m.y / 9.0));
      float rep = step(0.86, ph) * step(0.08, pf.x) * step(pf.x, 0.92 - 0.3 * ph12(pc + 1.0)) * step(0.1, pf.y) * step(pf.y, 0.5 + 0.4 * ph12(pc + 2.0));
      float tone = 0.5 + 0.22 * n1 + 0.08 * n2 - 0.18 * rep + 0.1 * wp;
      // puddles: low spots, mostly along the wheel paths and the edges
      float edge = smoothstep(10.6, 11.9, ax) + smoothstep(1.6, 0.9, ax);
      float wetv = n1 * 0.9 + n2 * 0.45 + wp * 0.15 + edge * 0.5;
      float puddle = smoothstep(0.18, 0.42, wetv);
      // sealed cracks: thin wiggly tar lines along cell borders
      vec4 cw = pworley(vUv * vec2(6.0, 24.0) + vec2(pnoise(vUv * vec2(24.0, 96.0), vec2(24.0, 96.0)) * 0.12, 0.0), vec2(6.0, 24.0), 0.85);
      float crack = smoothstep(0.012, 0.0, cw.y - cw.x) * step(0.7, cw.z);
      // paint wear (used on the markings): tyre scuffs where wheels cross the lines
      float wear = clamp(0.55 + 0.5 * pfbm(q * 3.0 + 9.0, per * 24.0, 4) + 0.35 * wp, 0.0, 1.0);
      fragColor = vec4(clamp(tone, 0.0, 1.0), puddle, wear, crack);
    }`);

  // ---- clouds (tileable, density in r, a softer "lit underside" term in g)
  const C = rt(1024, 1024, THREE.RepeatWrapping, true, 4);
  bake(renderer, C, /* glsl */ `
    void main() {
      vec2 p = vUv * 6.0;
      vec2 w = vec2(pfbm(p + 1.7, vec2(6.0), 4), pfbm(p + 8.3, vec2(6.0), 4));
      float d = pfbm(p + w * 1.2, vec2(6.0), 7);
      float big = pfbm(vUv * 2.0 + 4.0, vec2(2.0), 3);
      float dens = smoothstep(-0.05, 0.55, d + big * 0.6);
      float soft = smoothstep(-0.3, 0.7, d + big * 0.6);
      fragColor = vec4(dens, soft, pfbm(p * 3.0, vec2(18.0), 4) * 0.5 + 0.5, 1.0);
    }`);

  // ---- concrete (2 m tile): pits, stains, faint board marks
  const K = rt(1024, 1024, THREE.RepeatWrapping, true, aniso);
  bake(renderer, K, /* glsl */ `
    void main() {
      vec2 uv = vUv;
      float n = pfbm(uv * 6.0, vec2(6.0), 6);
      float fine = pnoise(uv * 400.0, vec2(400.0));
      vec4 pit = pworley(uv * 90.0, vec2(90.0), 1.0);
      float pits = smoothstep(0.12, 0.05, pit.x) * step(0.7, pit.z);
      float stain = smoothstep(0.1, 0.5, pfbm(vec2(uv.x * 3.0, uv.y * 0.8) + 2.0, vec2(3.0, 1.0), 4)) * smoothstep(0.6, 0.0, uv.y);
      float alb = 0.42 + 0.12 * n + 0.04 * fine - 0.18 * pits - 0.16 * stain;
      fragColor = vec4(alb, 0.5 + 0.5 * n - 0.3 * pits, 0.0, 1.0);
    }`);

  return { asphalt: A.texture, asphaltN: N.texture, macro: M.texture, clouds: C.texture, concrete: K.texture };
}

/** Canvas → mipmapped, anisotropic texture (sRGB colour by default). */
export function canvasTex(cv: HTMLCanvasElement, o: { srgb?: boolean; aniso?: number; repeat?: boolean; mip?: boolean } = {}) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.generateMipmaps = o.mip ?? true;
  t.minFilter = o.mip === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = o.aniso ?? 8;
  if (o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}
