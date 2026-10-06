// DROP 3 (gold, the finale): space computed per pixel, nothing flat in it. Three worlds, cut on the downbeats and
// driven by the kicks, all in gold:
//   WARP    a star tunnel: stars on nested cylinders around our path, streaked by our speed, a tunnel of gold gas
//           (3D noise) rushing past, a white-gold glow at the vanishing point. Each kick surges the speed.
//   NEBULA  a raymarched gold nebula (3D noise texture, emission and absorption, front to back): we fly down a
//           corridor between cloud walls lit from within by stars; each kick surges us forward and the stars inside
//           the clouds flare. (Half resolution, upsampled; the stars behind it are full resolution, dimmed by its
//           transmittance.)
//   HOLE    a black hole: every pixel's ray is integrated through its gravity (bent light), crossing a hot accretion
//           disk (Doppler-beamed, sheared by Keplerian rotation), the lensed sky behind, the photon ring. Each kick
//           flares the disk. At the end we fall in: the disk sweeps up around us, the sky shrinks to a ring, and
//           inside, the roll is a warp that slows into a quiet field of stars, which the ceiling outro's stars
//           cross-fade into.
// No words in the drops. Shots: see `plan()`.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { FSPass, W, H, makeRT } from '../../engine/gl';
import { clamp, hash, smoothstep, frameIdx, mulberry32 } from '../../engine/util';

const AS = 16 / 9;
type World = 'warp' | 'neb' | 'hole' | 'calm';
interface Shot {
  t: number; w: World; seed: number;
  /** hole: camera distance at the cut and at the shot's end, elevation, azimuth (deg), roll */
  d0?: number; d1?: number; el?: number; az?: number; daz?: number; roll?: number;
  /** warp/neb: base speed, roll rate */
  v?: number; rr?: number;
}

// ---------- shared GLSL ----------
const SKY = /* glsl */ `
precision highp sampler3D;
uniform sampler3D uNoise;
float n3(vec3 p) { return texture(uNoise, p).r; }
// stars by direction: a jittered grid on each cube face, every star faded out well inside its own cell
vec3 starLayer(vec3 d, float N, float px, float seed) {
  vec3 a = abs(d);
  vec2 f; float face;
  if (a.x >= a.y && a.x >= a.z) { f = d.yz / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
  else if (a.y >= a.z) { f = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
  else { f = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
  vec2 g = (f * 0.5 + 0.5) * N;
  vec2 id = floor(g), fr = fract(g);
  vec3 h = hash33(vec3(id, face * 7.0 + seed));
  if (h.x > 0.35) return vec3(0.0);
  float cpx = 1.0 / (N * 0.5 * px);            // cell size in px (roughly)
  vec2 dv = (fr - (0.3 + 0.4 * h.yz)) * cpx;
  float rad = 0.7 + 1.3 * h.y * h.y;
  float m = (0.15 + 2.2 * pow(h.z, 6.0)) * smoothstep(3.0, 8.0, cpx);
  float win = 1.0 - smoothstep(0.18 * cpx, 0.28 * cpx, length(dv));
  vec3 c = mix(vec3(1.0, 0.86, 0.62), vec3(1.0, 0.97, 0.9), h.z);
  float e = dot(dv, dv) / (rad * rad);
  return c * m * win * (exp(-e) + 0.06 * exp(-e / 10.0));
}
vec3 sky(vec3 d, float px) {
  vec3 c = starLayer(d, 90.0, px, 1.0) + starLayer(d, 260.0, px, 2.0) * 0.6;
  // a faint gold milky band
  float b = exp(-pow(dot(d, normalize(vec3(0.3, 1.0, 0.2))) / 0.35, 2.0));
  float n = n3(d * 0.45 + 0.3) * 0.6 + n3(d * 1.3 + 0.7) * 0.4;
  c += vec3(0.5, 0.3, 0.1) * b * smoothstep(0.35, 0.8, n) * 0.25;
  return c;
}
mat3 camBasis(vec3 fw, float roll) {
  vec3 f = normalize(fw), up = abs(f.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 r = normalize(cross(f, up)), u = cross(r, f);
  float c = cos(roll), s = sin(roll);
  return mat3(c * r + s * u, -s * r + c * u, f);
}
`;

// a star tunnel: streaks on nested cylinders, by angle and axial distance (s: screen ndc, rolled)
const TUNNEL = /* glsl */ `
vec3 tunnel(vec2 s, float trav, float speed, float px, float gain) {
  float r = max(length(s), 1e-4), a = atan(s.y, s.x);
  vec3 col = vec3(0.0);
  for (int k = 0; k < 3; k++) {
    float R = k == 0 ? 1.0 : (k == 1 ? 2.2 : 4.6);
    float N = k == 0 ? 70.0 : (k == 1 ? 130.0 : 230.0);
    float Dc = k == 0 ? 2.0 : (k == 1 ? 3.0 : 5.0);
    float d = 1.1 * R / r;                         // axial distance seen at this pixel
    float u = (a / 6.2831853 + 0.5) * N + float(k) * 0.37;
    float w = (d + trav) / Dc;
    vec2 id = vec2(floor(u), floor(w));
    vec3 h = hash33(vec3(id, float(k) * 13.0 + 3.0));
    if (h.x > 0.55) continue;
    float cellPx = 6.2831853 * r / N / px;          // the angular cell's width in px here
    float au = (fract(u) - (0.3 + 0.4 * h.y)) * cellPx;
    // the streak: from the star's axial spot back along our motion, kept inside its cell
    float L = clamp(speed * 0.045 / Dc, 0.002, 0.5);
    float z0 = 0.05 + (0.9 - L - 0.08) * fract(h.z * 7.31 + h.y * 3.7);
    float fw = fract(w);
    float along = smoothstep(z0 - 0.02, z0, fw) * (1.0 - smoothstep(z0 + L, z0 + L + 0.04, fw));
    float wid = 0.8 + 1.4 * h.z;
    float win = 1.0 - smoothstep(0.2 * cellPx, 0.3 * cellPx, abs(au));
    float dim = 1.0 / (1.0 + 0.02 * d * d) * smoothstep(5.0, 12.0, cellPx) * smoothstep(0.04, 0.25, r);
    float head = exp(-pow((fw - z0 - L) * Dc * 4.0, 2.0));
    vec3 c = mix(vec3(1.0, 0.72, 0.32), vec3(1.0, 0.95, 0.85), h.z);
    col += c * exp(-au * au / (wid * wid)) * win * (along * (0.35 + 0.65 * fw / max(z0 + L, 1e-3)) + head) * dim * (0.6 + 1.6 * h.z * h.z);
  }
  return col * gain;
}
vec3 tunnelGas(vec2 s, float trav, float gain) {
  float r = max(length(s), 1e-4), a = atan(s.y, s.x);
  float d = 2.4 / r;
  vec3 p = vec3(cos(a) * 0.35, sin(a) * 0.35, (d + trav) * 0.018);
  float n = n3(p) * 0.6 + n3(p * 2.7 + 0.31) * 0.3 + n3(p * 7.1 + 0.67) * 0.1;
  float g = smoothstep(0.42, 0.85, n) * exp(-d * 0.05) * smoothstep(0.0, 0.25, r);
  vec3 c = mix(vec3(0.4, 0.12, 0.01), vec3(1.0, 0.62, 0.2), smoothstep(0.6, 0.9, n));
  return c * g * g * gain * 1.4;
}
`;

const WARP_FRAG = /* glsl */ `
${SKY}
${TUNNEL}
uniform float uTrav, uSpeed, uRoll, uExpo, uGlow, uGas, uPx, uDim, uSky, uSkyA;
void main() {
  vec2 s = (vUv - 0.5) * vec2(2.0 * ${AS.toFixed(5)}, 2.0);
  s = rot2(uRoll) * s;
  vec3 col = tunnel(s, uTrav, uSpeed, uPx, 1.0 - uSky) + tunnelGas(s, uTrav * 0.7, uGas);
  if (uSky > 0.0) col += sky(camBasis(vec3(sin(uSkyA), 0.2, cos(uSkyA)), uRoll) * normalize(vec3(s * 0.7, 1.0)), uPx * 0.7) * uSky * 1.3;
  float r = length(s);
  col += vec3(1.0, 0.85, 0.6) * uGlow * (exp(-r * r / 0.004) * 2.0 + exp(-r / 0.12) * 0.5 + exp(-r / 0.6) * 0.08);
  fragColor = vec4(col * uExpo * uDim, 1.0);
}`;

// the nebula volume (half res): rgb = emission, a = transmittance
const NEB_FRAG = /* glsl */ `
${SKY}
uniform vec3 uRo, uFw; uniform float uRoll, uT, uSeed, uFlash, uZ;
uniform vec4 uL[3];  // lights: xyz, strength
float path(float z, out float y) { y = cos(z * 0.041 + uSeed) * 4.0 + sin(z * 0.017) * 3.0; return sin(z * 0.05 + uSeed * 1.3) * 6.0 + sin(z * 0.023 + 1.0) * 9.0; }
float dens(vec3 p, out float n) {
  vec3 q = p + vec3(uSeed * 37.0, uSeed * 19.0, 0.0);
  n = n3(q * 0.021) * 0.55 + n3(q * 0.057 + 0.3) * 0.3 + n3(q * 0.16 + 0.7) * 0.15;
  float py; float px = path(p.z, py);
  float cor = length(p.xy - vec2(px, py));
  return smoothstep(0.5, 0.72, n) * smoothstep(2.0, 6.0, cor) * 1.6;
}
void main() {
  vec2 s = (vUv - 0.5) * vec2(2.0 * ${AS.toFixed(5)}, 2.0);
  mat3 B = camBasis(uFw, uRoll);
  vec3 rd = normalize(B * vec3(s * 0.75, 1.0));
  vec3 col = vec3(0.0);
  float T = 1.0;
  float j = hash12(gl_FragCoord.xy + fract(uT * 7.13) * 91.0);
  float tt = 0.4 + 0.4 * j;
  for (int i = 0; i < 40; i++) {
    float st = 0.35 + tt * 0.07;
    vec3 p = uRo + rd * tt;
    float n; float d = dens(p, n);
    if (d > 0.001) {
      vec3 li = vec3(0.0);
      for (int k = 0; k < 3; k++) {
        vec3 dl = uL[k].xyz - p;
        li += vec3(1.0, 0.78, 0.45) * uL[k].w / (1.0 + dot(dl, dl) * 0.06);
      }
      vec3 base = mix(vec3(0.22, 0.06, 0.01), vec3(1.0, 0.5, 0.1), smoothstep(0.52, 0.82, n));
      vec3 em = base * (0.04 + 0.6 * pow(smoothstep(0.55, 0.85, n), 2.0)) + li * base * (0.4 + 1.4 * smoothstep(0.55, 0.8, n)) * (1.0 + uFlash);
      float a = 1.0 - exp(-d * st * 0.55);
      col += T * a * em;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
    tt += st;
  }
  // the lights themselves, as glows along the ray (dimmed by what lies before them, roughly)
  for (int k = 0; k < 3; k++) {
    vec3 dl = uL[k].xyz - uRo;
    float along = dot(dl, rd);
    if (along > 0.0) {
      float dd = length(dl - rd * along);
      float sz = 0.004 * along + 0.02;
      col += vec3(1.0, 0.9, 0.7) * uL[k].w * (exp(-dd * dd / (sz * sz)) * 1.5 + 0.12 * exp(-dd / (sz * 6.0))) * (1.0 + uFlash) * mix(1.0, T, 0.5);
    }
  }
  fragColor = vec4(col, T);
}`;

// the nebula's composite (full res): sky and near stars streaking past, dimmed by the volume, plus the volume
const NEBC_FRAG = /* glsl */ `
${SKY}
${TUNNEL}
uniform sampler2D uVol;
uniform vec3 uFw; uniform float uRoll, uPx, uExpo, uTrav, uSpeed;
void main() {
  vec2 s = (vUv - 0.5) * vec2(2.0 * ${AS.toFixed(5)}, 2.0);
  mat3 B = camBasis(uFw, uRoll);
  vec3 rd = normalize(B * vec3(s * 0.75, 1.0));
  // (a small blur of the half-res volume: its dithered march steps average out instead of reading as grain)
  vec2 tx = 1.0 / vec2(textureSize(uVol, 0));
  vec4 v = 0.4 * texture(uVol, vUv) + 0.15 * (texture(uVol, vUv + tx * vec2(1.3, 0.6)) + texture(uVol, vUv + tx * vec2(-0.6, 1.3)) + texture(uVol, vUv - tx * vec2(1.3, 0.6)) + texture(uVol, vUv - tx * vec2(-0.6, 1.3)));
  vec3 col = sky(rd, uPx * 0.75) * v.a;
  col += tunnel(rot2(uRoll) * s, uTrav, uSpeed, uPx, 0.22) * v.a;
  col += v.rgb;
  fragColor = vec4(col * uExpo, 1.0);
}`;

// the black hole: rays integrated through its gravity (units of the horizon radius)
const HOLE_FRAG = /* glsl */ `
${SKY}
${TUNNEL}
uniform vec3 uRo, uFw; uniform float uRoll, uT, uPx, uExpo, uDisk, uRing, uInside, uTrav, uSpeed;
vec3 disk(vec3 pc, vec3 v, out float alpha) {
  float rc = length(pc.xz);
  float ph = atan(pc.z, pc.x);
  float om = uT * 1.6 * pow(3.0 / rc, 1.5);
  vec2 q = vec2(cos(ph + om), sin(ph + om)) * rc;
  float n = n3(vec3(q * 0.09, rc * 0.07)) * 0.6 + n3(vec3(q * 0.27, rc * 0.3) + 0.5) * 0.4;
  float rings = 0.75 + 0.25 * sin(rc * 3.1 + n * 9.0) * sin(rc * 7.3 + n * 5.0);
  float I = pow(2.6 / rc, 2.0) * rings * (0.4 + 1.2 * n);
  vec3 vel = normalize(vec3(-pc.z, 0.0, pc.x)) * sqrt(0.5 / rc);
  float beam = pow(clamp(1.0 + 1.7 * dot(vel, -normalize(v)), 0.15, 2.6), 3.0);
  float fade = smoothstep(2.4, 3.1, rc) * (1.0 - smoothstep(9.0, 14.0, rc));
  alpha = clamp(I * 1.4, 0.0, 0.92) * fade;
  float k = I * beam * uDisk;
  vec3 c = mix(vec3(0.6, 0.18, 0.03), vec3(1.0, 0.62, 0.2), smoothstep(0.2, 1.0, k));
  c = mix(c, vec3(1.0, 0.95, 0.85), smoothstep(1.2, 3.5, k));
  return c * k * fade * 1.4;
}
void main() {
  vec2 s = (vUv - 0.5) * vec2(2.0 * ${AS.toFixed(5)}, 2.0);
  mat3 B = camBasis(uFw, uRoll);
  vec3 rd = normalize(B * vec3(s * 0.7, 1.0));
  vec3 x = uRo, v = rd;
  vec3 hc = cross(x, v);
  float h2 = dot(hc, hc);
  vec3 col = vec3(0.0);
  float a = 0.0, rmin = 1e9;
  bool hor = false;
  for (int i = 0; i < 110; i++) {
    float r = length(x);
    rmin = min(rmin, r);
    float dt = clamp(0.09 * r * r / (r + 2.0), 0.02, 2.5);
    vec3 xn = x + v * dt;
    v += -1.5 * h2 * x / pow(r, 5.0) * dt;
    if (x.y * xn.y < 0.0) {
      vec3 pc = mix(x, xn, x.y / (x.y - xn.y));
      float rc = length(pc.xz);
      if (rc > 2.3 && rc < 14.0) {
        float al; vec3 e = disk(pc, v, al);
        col += (1.0 - a) * e;
        a += (1.0 - a) * al;
        if (a > 0.985) break;
      }
    }
    x = xn;
    if (length(x) < 1.0) { hor = true; break; }
    if (r > 70.0 && dot(x, v) > 0.0) break;
  }
  if (!hor) col += (1.0 - a) * sky(normalize(v), uPx * 0.7) * 1.2;
  // the photon ring: rays that grazed r = 1.5
  col += vec3(1.0, 0.8, 0.5) * (1.0 - a) * exp(-pow((rmin - 1.55) / 0.12, 2.0)) * 0.12 * uRing;
  // inside: the roll's warp
  if (uInside > 0.0) col = mix(col, tunnel(rot2(uRoll) * s, uTrav, uSpeed, uPx, 1.0), uInside);
  fragColor = vec4(col * uExpo, 1.0);
}`;

// ---------- the 3D noise texture (tileable, smooth) ----------
function noiseTex(N = 64) {
  const rnd = mulberry32(1337);
  const data = new Uint8Array(N * N * N);
  const oct = [{ L: 4, a: 0.55 }, { L: 8, a: 0.3 }, { L: 16, a: 0.15 }];
  const lat = oct.map((o) => Float32Array.from({ length: o.L ** 3 }, () => rnd()));
  const sm = (x: number) => x * x * (3 - 2 * x);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0;
    oct.forEach((o, k) => {
      const g = lat[k]!, L = o.L, s = L / N;
      const fx = x * s, fy = y * s, fz = z * s;
      const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
      const ux = sm(fx - ix), uy = sm(fy - iy), uz = sm(fz - iz);
      const at = (i: number, j: number, l: number) => g[((i % L) + L) % L + (((j % L) + L) % L) * L + (((l % L) + L) % L) * L * L]!;
      const lx = (j: number, l: number) => at(ix, j, l) + (at(ix + 1, j, l) - at(ix, j, l)) * ux;
      const ly = (l: number) => lx(iy, l) + (lx(iy + 1, l) - lx(iy, l)) * uy;
      v += o.a * (ly(iz) + (ly(iz + 1) - ly(iz)) * uz);
    });
    data[x + y * N + z * N * N] = Math.round(clamp(v) * 255);
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

export default class CosmosDeck extends Scene {
  private warp: FSPass; private neb: FSPass; private nebC: FSPass; private hole: FSPass;
  private volRT = makeRT(W / 2, H / 2, { depthBuffer: false });
  private tex = noiseTex();
  private shots: Shot[] = [];
  private kicks: [number, number][] = [];
  private bars: number[] = [];
  private t0: number; private t1: number;

  constructor(ctx: ConstructorParameters<typeof Scene>[0]) {
    super(ctx);
    this.t0 = ctx.start; this.t1 = ctx.end;
    const nz = { value: this.tex };
    const v2 = () => ({ value: 0 });
    this.warp = new FSPass(WARP_FRAG, { uNoise: nz, uTrav: v2(), uSpeed: v2(), uRoll: v2(), uExpo: v2(), uGlow: v2(), uGas: v2(), uPx: v2(), uDim: { value: 1 }, uSky: v2(), uSkyA: v2() });
    this.neb = new FSPass(NEB_FRAG, {
      uNoise: nz, uRo: { value: new THREE.Vector3() }, uFw: { value: new THREE.Vector3() }, uRoll: v2(), uT: v2(), uSeed: v2(), uFlash: v2(), uZ: v2(),
      uL: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    });
    this.nebC = new FSPass(NEBC_FRAG, { uNoise: nz, uVol: { value: this.volRT.texture }, uFw: { value: new THREE.Vector3() }, uRoll: v2(), uPx: v2(), uExpo: v2(), uTrav: v2(), uSpeed: v2() });
    this.hole = new FSPass(HOLE_FRAG, {
      uNoise: nz, uRo: { value: new THREE.Vector3() }, uFw: { value: new THREE.Vector3() }, uRoll: v2(), uT: v2(), uPx: v2(), uExpo: v2(),
      uDisk: v2(), uRing: v2(), uInside: v2(), uTrav: v2(), uSpeed: v2(),
    });
    const au = ctx.audio;
    this.kicks = au.events('kick', this.t0 - 1, this.t1 + 2);
    let i0 = 0, best = 1e9;
    au.downbeats.forEach((d, i) => { if (Math.abs(d - this.t0) < best) { best = Math.abs(d - this.t0); i0 = i; } });
    this.bars = au.downbeats.slice(i0, i0 + 20);
    this.plan();
  }

  private bar(k: number) { return this.bars[k] ?? this.bars[this.bars.length - 1]! + (k - this.bars.length + 1) * 1.58; }

  /** the shots, cut on downbeats (bar k of the drop) */
  private plan() {
    const B = (k: number) => this.bar(k);
    this.shots = [
      { t: B(0), w: 'warp', seed: 0, v: 26, rr: 0.15 },
      { t: B(1), w: 'warp', seed: 1, v: 34, rr: -0.25 },
      { t: B(2), w: 'neb', seed: 0.0, v: 9 },
      { t: B(3), w: 'neb', seed: 2.1, v: 10, rr: 0.1 },
      { t: B(4), w: 'neb', seed: 4.7, v: 11 },
      { t: B(5), w: 'neb', seed: 7.3, v: 14, rr: -0.12 },
      { t: B(6), w: 'hole', seed: 0, d0: 34, d1: 27, el: 9, az: 20, daz: 14, roll: 0.12 },
      { t: B(7), w: 'hole', seed: 1, d0: 20, d1: 16, el: 32, az: 120, daz: 22, roll: -0.2 },
      { t: B(8), w: 'hole', seed: 2, d0: 13, d1: 11, el: 4, az: 210, daz: 30, roll: 0.35 },
      { t: B(9), w: 'warp', seed: 2, v: 44, rr: 0.4 },
      { t: B(10), w: 'neb', seed: 9.9, v: 17, rr: 0.15 },
      { t: B(11), w: 'hole', seed: 3, d0: 24, d1: 18, el: -14, az: 300, daz: -24, roll: -0.3 },
      { t: B(12), w: 'neb', seed: 12.4, v: 18, rr: -0.2 },
      { t: B(13), w: 'hole', seed: 4, d0: 18, d1: 11, el: 6, az: 60, daz: 18, roll: 0.1 },
      // the fall: from the disk's edge to the horizon, faster and faster
      { t: B(14), w: 'hole', seed: 5, d0: 11, d1: 2.0, el: 3, az: 100, daz: 40, roll: 0.0 },
      // inside: the roll is a warp, slowing into a calm field of stars
      { t: B(15), w: 'warp', seed: 3, v: 60, rr: 0.5 },
      { t: B(15) + 0.95, w: 'calm', seed: 4, v: 0 },
    ];
  }

  /** the kicks' surges at t (0..~1.3) and their integral (for travel) */
  private surge(t: number) {
    let s = 0, I = 0;
    for (const [te, k] of this.kicks) {
      const a = t - te;
      if (a < 0) break;
      const kk = Math.min(1, k);
      if (a < 1.2) s += kk * Math.exp(-a / 0.22);
      I += kk * 0.22 * (1 - Math.exp(-a / 0.22));
    }
    return { s: Math.min(1.3, s), I };
  }

  private shotAt(t: number) {
    let i = 0;
    while (i < this.shots.length - 1 && t >= this.shots[i + 1]!.t) i++;
    const sh = this.shots[i]!, nx = this.shots[i + 1];
    return { sh, i, age: t - sh.t, len: (nx ? nx.t : this.t1 + 0.8) - sh.t };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, r = this.ctx.renderer;
    const { sh, age, len } = this.shotAt(t);
    const { s: kick, I } = this.surge(t);
    const px = 2 / out.height;
    const cutK = Math.exp(-age / 0.12);             // the slam of a cut
    let expo = 1 + 0.35 * kick + 0.5 * cutK;
    const fi = frameIdx(t);
    let shake = 5 * kick + 9 * cutK, zoom = 1 + 0.035 * kick + 0.05 * cutK, flash = 0.05 * cutK;
    // the drop opens out of chorus 3's gold-white: the first frames are still that light
    const open = 1 - smoothstep(this.t0, this.t0 + 0.35, t);
    flash += 0.6 * open;

    if (sh.w === 'warp' || sh.w === 'calm') {
      const U = this.warp.u;
      const v = sh.v ?? 30;
      // travel: base speed, every kick a surge (speed 40 units/s per surge unit)
      let trav = sh.seed * 500 + v * age + 40 * I, speed = v + 40 * kick;
      let glow = 0.9 + 0.8 * kick, gas = 1.0, dim = 1;
      if (sh.w === 'calm') {
        // the warp has slowed to stillness: stars only, drifting; the gas and the glow gone
        const e = smoothstep(0, 0.5, age);
        trav = 1700 + 3 * age; speed = 6 * (1 - e) + 0.5; glow = 0.4 * (1 - e); gas = 0.5 * (1 - e);
        this.warp.u.uSky!.value = e; this.warp.u.uSkyA!.value = 0.04 * age;
        expo = 1; shake = 0; zoom = 1; flash = 0.15 * Math.exp(-age / 0.15);
      } else if (sh.seed === 3) {
        // the roll inside the hole: hits on every roll step, then it slows
        speed = v * (1 - 0.8 * smoothstep(sh.t + 0.4, sh.t + 0.95, t)) + 40 * kick;
        dim = smoothstep(sh.t, sh.t + 0.15, t);
      }
      U.uTrav!.value = trav; U.uSpeed!.value = speed; U.uRoll!.value = (sh.rr ?? 0) * age + sh.seed;
      if (sh.w !== 'calm') U.uSky!.value = 0;
      U.uExpo!.value = expo; U.uGlow!.value = glow; U.uGas!.value = gas; U.uPx!.value = px; U.uDim!.value = dim;
      this.warp.render(r, out);
    } else if (sh.w === 'neb') {
      const U = this.neb.u, C = this.nebC.u;
      const v = sh.v ?? 10;
      const z = 40 + sh.seed * 300 + v * age + 30 * I;
      const pathXY = (zz: number) => [Math.sin(zz * 0.05 + sh.seed * 1.3) * 6 + Math.sin(zz * 0.023 + 1) * 9, Math.cos(zz * 0.041 + sh.seed) * 4 + Math.sin(zz * 0.017) * 3];
      const p0 = pathXY(z), p1 = pathXY(z + 7);
      const ro = new THREE.Vector3(p0[0]!, p0[1]!, z), fw = new THREE.Vector3(p1[0]! - p0[0]!, p1[1]! - p0[1]!, 7).normalize();
      const roll = (sh.rr ?? 0) * age + 0.3 * (p1[0]! - p0[0]!) / 7;
      (U.uRo!.value as THREE.Vector3).copy(ro); (U.uFw!.value as THREE.Vector3).copy(fw);
      U.uRoll!.value = roll; U.uT!.value = t; U.uSeed!.value = sh.seed; U.uFlash!.value = 1.6 * kick;
      // stars inside the clouds, along the corridor (every 18 units, off to the sides)
      const L = U.uL!.value as THREE.Vector4[];
      const k0 = Math.floor(z / 18);
      for (let j = 0; j < 3; j++) {
        const k = k0 + j + 1, zz = k * 18 + 9 * hash(k, 3), pp = pathXY(zz);
        const side = hash(k, 1) > 0.5 ? 1 : -1;
        L[j]!.set(pp[0]! + side * (5 + 4 * hash(k, 2)), pp[1]! + (hash(k, 4) - 0.5) * 6, zz, (1.6 + 2.4 * hash(k, 5)) * smoothstep(z + 60, z + 30, zz));
      }
      this.neb.render(r, this.volRT);
      (C.uFw!.value as THREE.Vector3).copy(fw); C.uRoll!.value = roll; C.uPx!.value = px; C.uExpo!.value = expo;
      C.uTrav!.value = z * 1.2; C.uSpeed!.value = v + 30 * kick;
      this.nebC.render(r, out);
    } else {
      const U = this.hole.u;
      const u = clamp(age / len);
      const fall = sh.seed === 5;
      // the distance eases in (the fall accelerates)
      const d = fall ? sh.d0! * Math.pow(sh.d1! / sh.d0!, Math.pow(u, 1.6)) : sh.d0! + (sh.d1! - sh.d0!) * (1 - Math.pow(1 - u, 2));
      const el = (sh.el ?? 0) * Math.PI / 180 * (fall ? 1 - 0.6 * u : 1), az = ((sh.az ?? 0) + (sh.daz ?? 0) * u) * Math.PI / 180;
      const ro = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(d);
      // look a little off the hole (the composition: the shadow off-centre, the disk across the frame)
      const off = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)).multiplyScalar((fall ? 0.4 : 0.25) * d * 0.25);
      const fw = off.sub(ro).normalize();
      (U.uRo!.value as THREE.Vector3).copy(ro); (U.uFw!.value as THREE.Vector3).copy(fw);
      U.uRoll!.value = (sh.roll ?? 0) + (fall ? 0.6 * u * u : 0.05 * u); U.uT!.value = t; U.uPx!.value = px; U.uExpo!.value = expo;
      U.uDisk!.value = 1.0 + 1.3 * kick; U.uRing!.value = 1 + 2 * kick;
      U.uInside!.value = 0; U.uTrav!.value = 0; U.uSpeed!.value = 0;
      if (fall) zoom += 0.04 * u;
      this.hole.render(r, out);
    }
    return {
      zoom,
      shake: [(hash(fi, 1) - 0.5) * 2 * shake, (hash(fi, 2) - 0.5) * 2 * shake],
      flash,
      ca: 0.8 + 2 * cutK,
      bloom: 0.7,
    };
  }

  override dispose() {
    for (const p of [this.warp, this.neb, this.nebC, this.hole]) p.mat.dispose();
    this.volRT.dispose(); this.tex.dispose();
  }
}
