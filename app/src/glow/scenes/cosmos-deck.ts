// DROP 3 (gold, the finale): space computed per pixel, nothing flat in it. Three worlds, driven by the kicks, all in
// gold, each one a continuous flight (its downbeats whip the camera, they never cut), and real transitions between
// them, timed to land on a downbeat:
//   WARP    a star tunnel: stars on nested cylinders around our path, streaked by our speed, a tunnel of gold gas
//           (3D noise) rushing past, a white-gold glow at the vanishing point. Each kick surges the speed.
//   NEBULA  a raymarched gold nebula (3D noise texture, emission and absorption, front to back): we fly down a
//           corridor between cloud walls lit from within by stars; each kick surges us forward and the stars inside
//           the clouds flare. (Half resolution, upsampled; the stars behind it full resolution.)
//   HOLE    a black hole: every pixel's ray is integrated through its gravity (bent light), crossing a hot accretion
//           disk (Doppler-beamed, sheared by Keplerian rotation), the lensed sky behind, the photon ring. Each kick
//           flares the disk; on its downbeats the camera swoops around it to the next angle.
// Transitions (XF): IRIS — the warp's vanishing point opens onto the next world and we fly through it; COLLAPSE — the
// nebula's light is pulled into one point and spirals in (the core collapsing) as the black hole appears around it;
// LENS — the hole's shadow grows over the frame, bending the world around it (an Einstein ring), and the next world
// is inside it.
// The end: we fall into the hole; inside, a warp; its vanishing point opens onto the Earth (lib/earth.ts, the
// intro's), at night, a dawn on its far limb; it grows and we dive at New York (where the intro dived), the city
// lights coming up at us — which the ceiling outro's stickers cross-fade into, the ceiling pushing in the same way.
// No words in the drops.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { FSPass, W, H, makeRT } from '../../engine/gl';
import { clamp, ease, hash, lerp, smoothstep, frameIdx, mulberry32 } from '../../engine/util';
import { Earth } from '../lib/earth';
import { prewarm } from '../lib/prewarm';
import { aim } from '../lib/stage';
import { diveAlt, diveBars } from '../lib/dive';
import { stickerLayout, outroView, CEIL_Y } from './ceiling';

const AS = 16 / 9;
type World = 'warp' | 'neb' | 'hole' | 'earth';
type XK = 'iris' | 'collapse' | 'lens';
interface HoleKey { t: number; d0: number; d1: number; el: number; az: number; daz: number; roll: number; fall?: boolean }
interface Run {
  w: World; t0: number; t1: number; seed: number;
  /** warp/neb: base speed at the start and the end of the run */
  v0?: number; v1?: number; rr?: number;
  keys?: HoleKey[];
  /** the transition into this run (it ends at t0 + 0.1) */
  x?: XK; xd?: number; flash?: number;
  inside?: boolean;
}

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
  for (int i = 0; i < 34; i++) {
    float st = 0.4 + tt * 0.08;
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
  for (int i = 0; i < 80; i++) {
    float r = length(x);
    rmin = min(rmin, r);
    float dt = clamp(0.15 * r * r / (r + 2.5), 0.025, 4.0);
    vec3 xn = x + v * dt;
    float r2 = r * r;
    v += -1.5 * h2 * x / (r2 * r2 * r) * dt;
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

// (transitions below)
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


// the transitions: A (outgoing) and B (incoming), u 0..1
const XF_FRAG = /* glsl */ `
uniform sampler2D uA, uB; uniform float uU; uniform int uK; uniform vec2 uC;
const float ASP = ${AS.toFixed(5)};
// (a sample from outside the frame fades out softly: clamping smeared the frame's edge into streaks)
vec3 at(sampler2D t, vec2 s) { vec2 uv = vec2(s.x / (2.0 * ASP) + 0.5, s.y * 0.5 + 0.5); vec2 o = max(-uv, uv - 1.0); float w = 1.0 - smoothstep(0.0, 0.12, max(o.x, o.y)); return texture(t, clamp(uv, vec2(0.0005), vec2(0.9995))).rgb * w; }
void main() {
  vec2 s = (vUv - 0.5) * vec2(2.0 * ASP, 2.0);
  float u = uU, e = u * u * (3.0 - 2.0 * u);
  vec3 col;
  if (uK == 0) {
    // IRIS: we fly into the vanishing point; it opens onto the next world, which comes at us
    float R = 2.3 * pow(e, 1.6);
    float r = length(s);
    vec3 a = vec3(0.0);
    // (a radial zoom blur of A: we accelerate through it)
    for (int i = 0; i < 6; i++) a += at(uA, s / (1.0 + (0.6 + 0.12 * float(i)) * e));
    a /= 6.0;
    vec3 b = at(uB, s * mix(2.2, 1.0, e));
    float m = 1.0 - smoothstep(R * 0.55, R + 0.02, r);
    col = mix(a, b, m) + vec3(1.0, 0.8, 0.5) * exp(-pow((r - R * 0.8) / (0.08 + 0.2 * R), 2.0)) * 0.35 * (1.0 - e) * step(0.001, R);
  } else if (uK == 1) {
    // COLLAPSE: A's light is pulled into one point and spirals in; the hole (B) appears around it
    vec2 d = s - uC;
    float r = length(d);
    float k = 1.0 + 4.0 * e * e;
    float sw = 2.2 * e / (r + 0.25);
    vec2 da = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * d * k;
    vec3 a = at(uA, uC + da) * (1.0 + 0.7 * e) * (1.0 - smoothstep(0.5, 0.95, u));
    vec3 b = at(uB, s) * smoothstep(0.35, 1.0, u);
    col = a + b + vec3(1.0, 0.85, 0.6) * exp(-r * r / (0.002 + 0.02 * e)) * 1.6 * sin(3.14159 * u);
  } else {
    // LENS: the shadow grows over the frame, A bent around it (a point lens: an Einstein ring at its edge); the next
    // world is inside
    vec2 d = s - uC;
    float r = max(length(d), 1e-4);
    float Rl = 2.6 * pow(e, 1.7);
    float re = Rl * 1.25;
    vec2 da = d * (1.0 - re * re / (r * r + 1e-4) * 0.5);
    vec3 a = at(uA, uC + da);
    // B inside, the shadow (a soft dark band) around it, A bent outside, a faint Einstein brightening at the edge
    float inside = 1.0 - smoothstep(Rl * 0.45, Rl * 0.8, r);
    vec3 b = at(uB, uC + d * mix(1.8, 1.0, e)) * smoothstep(0.2, 0.7, u);
    float outside = smoothstep(Rl * 0.85, Rl * 1.15, r);
    float ring = exp(-pow((r - Rl * 1.2) / (0.05 + 0.12 * Rl), 2.0));
    col = a * outside * (1.0 + 0.5 * ring) + b * inside;
  }
  fragColor = vec4(col, 1.0);
}`;

// the city's lights becoming the ceiling's stickers: soft warm lights exactly where the outro's stickers will be
// (projected through the outro's own camera), each first a little cluster of lights that resolves into one
const LIGHTS_FRAG = /* glsl */ `
uniform vec4 uP[50]; uniform int uN; uniform float uRes, uK;
uniform vec3 cW;
const float ASP = ${AS.toFixed(5)};
void main() {
  vec2 s = (vUv - 0.5) * vec2(2.0 * ASP, 2.0);
  vec3 col = vec3(0.0);
  for (int i = 0; i < 50; i++) {
    if (i >= uN) break;
    vec4 p = uP[i];
    float R = max(p.z, 0.0008);
    for (int j = 0; j < 4; j++) {
      float a = float(i) * 2.4 + float(j) * 1.9;
      vec2 o = j == 0 ? vec2(0.0) : vec2(cos(a), sin(a)) * R * 2.6 * uRes;
      float d = length(s - p.xy - o);
      float w = j == 0 ? 1.0 : 0.45 * uRes;
      float rc = R * 0.55, rh = R * 4.5;
      float g = max(exp(-d * d / (rh * rh) * 6.0) - exp(-6.0), 0.0);
      col += cW * w * p.w * (exp(-d * d / (rc * rc)) * 1.4 + g * 0.35);
    }
  }
  fragColor = vec4(col * uK, 1.0);
}`;

/** New York, on the globe (object space of lib/earth), as in the intro */
const SITE = (() => { const lat = 40.7 * Math.PI / 180, lon = -74.0 * Math.PI / 180; const th = Math.PI / 2 - lat, ph = lon + Math.PI; return new THREE.Vector3(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)); })();
const ezIO = (x: number) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

export default class CosmosDeck extends Scene {
  private warp: FSPass; private neb: FSPass; private nebC: FSPass; private hole: FSPass; private xf: FSPass;
  private volRT = makeRT(W / 2, H / 2, { depthBuffer: false });
  /** the black hole is marched at 3/4 resolution (its rays are the costly part), then scaled up */
  private holeRT = makeRT(W * 0.75, H * 0.75, { depthBuffer: false });
  /** the two worlds of a transition */
  private rtA = makeRT(W, H); private rtB = makeRT(W, H);
  private tex = noiseTex();
  private earth = new Earth();
  private eScene = new THREE.Scene();
  private eCam = new THREE.PerspectiveCamera(50, AS, 0.01, 4000);
  private lights: FSPass;
  private stickers = stickerLayout().pts;
  private oCam = new THREE.PerspectiveCamera(60, AS, 0.05, 500);
  private dive: [number, number, number] = [0, 0, 0];
  private runs: Run[] = [];
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
    this.lights = new FSPass(LIGHTS_FRAG, { uP: { value: Array.from({ length: 50 }, () => new THREE.Vector4()) }, uN: { value: 0 }, uRes: v2(), uK: v2(), cW: { value: new THREE.Color('#FFB45A').multiplyScalar(1.1) } }, { blending: THREE.AdditiveBlending, transparent: true });
    this.xf = new FSPass(XF_FRAG, { uA: { value: this.rtA.texture }, uB: { value: this.rtB.texture }, uU: v2(), uK: { value: 0 }, uC: { value: new THREE.Vector2() } });
    const au = ctx.audio;
    this.kicks = au.events('kick', this.t0 - 1, this.t1 + 2);
    let i0 = 0, best = 1e9;
    au.downbeats.forEach((d, i) => { if (Math.abs(d - this.t0) < best) { best = Math.abs(d - this.t0); i0 = i; } });
    this.bars = au.downbeats.slice(i0, i0 + 20);
    this.dive = diveBars(au.downbeats, this.t1);
    this.plan();
  }

  override async init() {
    await this.earth.init();
    this.eScene.add(this.earth);
    // (everything compiled and uploaded now: the preview must not stall when the drop comes on)
    const ps = [this.warp, this.neb, this.nebC, this.hole, this.xf, this.lights];
    prewarm(this.ctx.renderer, [...ps.map((p) => ({ scene: p.scene, cam: p.cam })), { scene: this.eScene, cam: this.eCam }], [this.tex]);
  }

  private bar(k: number) { return this.bars[k] ?? this.bars[this.bars.length - 1]! + (k - this.bars.length + 1) * 1.58; }

  /** the worlds, each a continuous flight, and the transitions into them (landing on downbeats) */
  private plan() {
    const B = (k: number) => this.bar(k);
    const tE = B(14) + 0.9;
    this.runs = [
      { w: 'warp', t0: B(0), t1: B(2), seed: 0, v0: 26, v1: 38, rr: 0.15 },
      { w: 'neb', t0: B(2), t1: B(6), seed: 0, v0: 9, v1: 15, rr: 0.05, x: 'iris', xd: 0.65 },
      {
        w: 'hole', t0: B(6), t1: B(9), seed: 0, x: 'collapse', xd: 0.75, flash: 0.22, keys: [
          { t: B(6), d0: 34, d1: 26, el: 9, az: 20, daz: 14, roll: 0.12 },
          { t: B(7), d0: 20, d1: 16, el: 32, az: 110, daz: 22, roll: -0.2 },
          { t: B(8), d0: 13, d1: 11, el: 4, az: 190, daz: 30, roll: 0.35 },
        ],
      },
      { w: 'warp', t0: B(9), t1: B(10), seed: 2, v0: 44, v1: 52, rr: 0.4, x: 'lens', xd: 0.7 },
      { w: 'neb', t0: B(10), t1: B(11), seed: 9.9, v0: 17, v1: 19, rr: 0.15, x: 'iris', xd: 0.6 },
      { w: 'hole', t0: B(11), t1: B(12), seed: 0, x: 'collapse', xd: 0.6, keys: [{ t: B(11), d0: 24, d1: 18, el: -14, az: 300, daz: -24, roll: -0.3 }] },
      { w: 'neb', t0: B(12), t1: B(13), seed: 12.4, v0: 18, v1: 21, rr: -0.2, x: 'lens', xd: 0.6 },
      { w: 'hole', t0: B(13), t1: B(14), seed: 0, x: 'collapse', xd: 0.6, flash: 0.15, keys: [{ t: B(13), d0: 17, d1: 2.4, el: 7, az: 60, daz: 50, roll: 0.1, fall: true }] },
      { w: 'warp', t0: B(14), t1: tE, seed: 3, v0: 60, v1: 8, rr: 0.5, x: 'lens', xd: 0.45, inside: true },
      { w: 'earth', t0: tE, t1: this.t1 + 2, seed: 0, x: 'iris', xd: 0.7 },
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

  /** the downbeats inside a run whip the roll (half a turn's worth of lean, alternating), eased into the beat */
  private whips(run: Run, t: number) {
    let r = 0, sg = 1;
    for (const b of this.bars) if (b > run.t0 + 0.2 && b < run.t1 - 0.2) { r += sg * 0.5 * ezIO((t - (b - 0.32)) / 0.36); sg = -sg; }
    return r;
  }
  /** distance travelled in a run with its speed ramping v0 -> v1 */
  private travel(run: Run, t: number) {
    const L = Math.max(0.1, run.t1 - run.t0), a = t - run.t0, v0 = run.v0 ?? 30, v1 = run.v1 ?? v0;
    return v0 * a + (v1 - v0) * a * Math.abs(a) / (2 * L);
  }
  private speed(run: Run, t: number) { const v0 = run.v0 ?? 30, v1 = run.v1 ?? v0; return Math.max(1, v0 + (v1 - v0) * clamp((t - run.t0) / (run.t1 - run.t0))); }

  /** the hole's camera at t: on each key, an orbit drifting in; in the last 0.45 s before the next key a swoop to it */
  private holeCam(run: Run, t: number) {
    const ks = run.keys!;
    const at = (k: HoleKey, tt: number, end: number) => {
      // (not clamped: before its key and after its end the orbit keeps moving at the same rate — a transition
      //  renders the outgoing and incoming worlds outside their own spans, and they must keep flying)
      const u = (tt - k.t) / Math.max(0.1, end - k.t);
      const d = k.fall ? k.d0 * Math.pow(k.d1 / k.d0, u < 0 ? u : Math.pow(u, 1.6)) : k.d0 * Math.pow(k.d1 / k.d0, u);
      return { d, el: k.el * (k.fall ? 1 - 0.6 * u : 1), az: k.az + k.daz * u, roll: k.roll + (k.fall ? 0.6 * u * u : 0.05 * u), u };
    };
    let i = 0;
    while (i < ks.length - 1 && t >= ks[i + 1]!.t) i++;
    const k = ks[i]!, nx = ks[i + 1], end = nx ? nx.t : run.t1;
    let st = at(k, t, end);
    if (nx && t > nx.t - 0.45) {
      const a = at(k, nx.t - 0.45, end), b = at(nx, nx.t, ks[i + 2]?.t ?? run.t1), e = ezIO((t - (nx.t - 0.45)) / 0.45);
      st = { d: Math.exp(lerp(Math.log(a.d), Math.log(b.d), e)), el: lerp(a.el, b.el, e), az: lerp(a.az, b.az, e), roll: lerp(a.roll, b.roll, e), u: 0 };
    }
    const el = st.el * Math.PI / 180, az = st.az * Math.PI / 180, d = st.d;
    const ro = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(d);
    // look a little off the hole (the composition: the shadow off-centre, the disk across the frame)
    const off = new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)).multiplyScalar((k.fall ? 0.4 : 0.25) * d * 0.25);
    const fw = off.sub(ro).normalize();
    return { ro, fw, roll: st.roll, fall: !!k.fall, u: st.u };
  }
  /** where the hole is on screen (ndc, x scaled by the aspect) for a hole camera */
  private holeOnScreen(c: { ro: THREE.Vector3; fw: THREE.Vector3; roll: number }): [number, number] {
    const f = c.fw.clone().normalize(), up = Math.abs(f.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const r = new THREE.Vector3().crossVectors(f, up).normalize(), u = new THREE.Vector3().crossVectors(r, f);
    const cs = Math.cos(c.roll), sn = Math.sin(c.roll);
    const R = r.clone().multiplyScalar(cs).addScaledVector(u, sn), U = r.clone().multiplyScalar(-sn).addScaledVector(u, cs);
    const v = c.ro.clone().negate(), z = Math.max(1e-3, v.dot(f));
    return [clamp(v.dot(R) / z / 0.7, -2, 2), clamp(v.dot(U) / z / 0.7, -1.2, 1.2)];
  }

  /** the Earth's altitude (1 unit = 1000 km) over the dive (shared with the ceiling outro: lib/dive.ts) */
  private alt(t: number) { return diveAlt(t, this.dive); }

  /** renders run `run` at t into target */
  private world(run: Run, t: number, target: THREE.WebGLRenderTarget, kick: number, I: number, px: number) {
    const r = this.ctx.renderer;
    const age = t - run.t0;
    if (run.w === 'warp' || run.w === 'earth') {
      const U = this.warp.u;
      if (run.w === 'warp') {
        U.uTrav!.value = run.seed * 500 + this.travel(run, t) + 40 * I; U.uSpeed!.value = this.speed(run, t) + 40 * kick;
        U.uRoll!.value = (run.rr ?? 0) * age + run.seed + this.whips(run, t);
        U.uGlow!.value = 0.9 + 0.8 * kick; U.uGas!.value = 1; U.uSky!.value = 0;
        U.uDim!.value = run.inside ? smoothstep(run.t0 - 0.25, run.t0 + 0.1, t) : 1;
      } else {
        // the sky behind the Earth: the same stars, still
        U.uTrav!.value = 0; U.uSpeed!.value = 0; U.uRoll!.value = 0; U.uGlow!.value = 0; U.uGas!.value = 0; U.uSky!.value = 1; U.uSkyA!.value = 0.3; U.uDim!.value = 1;
      }
      U.uExpo!.value = 1 + 0.3 * kick; U.uPx!.value = px;
      this.warp.render(r, target);
      if (run.w === 'earth') this.renderEarth(t, target);
    } else if (run.w === 'neb') {
      const U = this.neb.u, C = this.nebC.u;
      const z = 40 + run.seed * 300 + this.travel(run, t) + 30 * I;
      const pathXY = (zz: number) => [Math.sin(zz * 0.05 + run.seed * 1.3) * 6 + Math.sin(zz * 0.023 + 1) * 9, Math.cos(zz * 0.041 + run.seed) * 4 + Math.sin(zz * 0.017) * 3];
      const p0 = pathXY(z), p1 = pathXY(z + 7);
      const ro = new THREE.Vector3(p0[0]!, p0[1]!, z), fw = new THREE.Vector3(p1[0]! - p0[0]!, p1[1]! - p0[1]!, 7).normalize();
      const roll = (run.rr ?? 0) * age + 0.3 * (p1[0]! - p0[0]!) / 7 + this.whips(run, t);
      (U.uRo!.value as THREE.Vector3).copy(ro); (U.uFw!.value as THREE.Vector3).copy(fw);
      U.uRoll!.value = roll; U.uT!.value = t; U.uSeed!.value = run.seed; U.uFlash!.value = 1.6 * kick;
      // stars inside the clouds, along the corridor (every 18 units, off to the sides)
      const L = U.uL!.value as THREE.Vector4[];
      const k0 = Math.floor(z / 18);
      for (let j = 0; j < 3; j++) {
        const k = k0 + j + 1, zz = k * 18 + 9 * hash(k, 3), pp = pathXY(zz);
        const side = hash(k, 1) > 0.5 ? 1 : -1;
        L[j]!.set(pp[0]! + side * (5 + 4 * hash(k, 2)), pp[1]! + (hash(k, 4) - 0.5) * 6, zz, (1.6 + 2.4 * hash(k, 5)) * smoothstep(z + 60, z + 30, zz));
      }
      this.neb.render(r, this.volRT);
      (C.uFw!.value as THREE.Vector3).copy(fw); C.uRoll!.value = roll; C.uPx!.value = px; C.uExpo!.value = 1 + 0.35 * kick;
      C.uTrav!.value = z * 1.2; C.uSpeed!.value = this.speed(run, t) + 30 * kick;
      this.nebC.render(r, target);
    } else {
      const U = this.hole.u;
      const c = this.holeCam(run, t);
      (U.uRo!.value as THREE.Vector3).copy(c.ro); (U.uFw!.value as THREE.Vector3).copy(c.fw);
      U.uRoll!.value = c.roll; U.uT!.value = t; U.uPx!.value = px / 0.75; U.uExpo!.value = 1 + 0.35 * kick;
      U.uDisk!.value = 1.0 + 1.3 * kick; U.uRing!.value = 1 + 2 * kick;
      U.uInside!.value = 0; U.uTrav!.value = 0; U.uSpeed!.value = 0;
      this.hole.render(r, this.holeRT);
      this.ctx.comp.draw(r, this.holeRT.texture, target, { mode: 'replace' });
    }
  }

  /** the night Earth ahead, New York facing us, a gold dawn on the far limb; over the sky already in target */
  private renderEarth(t: number, target: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer, e = this.earth, cam = this.eCam;
    const R = e.radius, alt = this.alt(t);
    cam.position.set(0, 0, 0); cam.quaternion.identity();
    cam.near = Math.max(0.0004, alt * 0.2); cam.far = 4000; cam.fov = 50; cam.aspect = AS;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    e.position.set(0, 0, -(R + alt));
    // the site faces us, north toward the frame's top, turned a little (and turning slowly)
    const n0 = new THREE.Vector3(0, 1, 0).addScaledVector(SITE, -SITE.y).normalize();
    const mObj = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(n0, SITE), n0, SITE);
    const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.5 + 0.04 * (t - 212));
    const back = new THREE.Vector3(0, 0, 1);
    const mW = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, back), up, back);
    e.quaternion.setFromRotationMatrix(mW.multiply(mObj.transpose()));
    e.time = t;
    const u = e.surface.material.uniforms;
    // (the city's own lights and the moonlit ground go dark as the lights that become the stickers take over)
    const [, b15, b16] = this.dive;
    const over = smoothstep(b16 - 0.75, b16 + 0.1, t);
    u.cityGain!.value = 1.2 * (1 - 0.9 * over); u.moonK!.value = 0.35 * (1 - 0.85 * over);
    e.clouds.material.uniforms.k!.value = 1 - 0.8 * over; e.clouds.material.uniforms.moonK!.value = 0.45 * (1 - 0.85 * over);
    e.air.material.uniforms.k!.value = 1;
    const sun = new THREE.Vector3(0.62, 0.42, -0.66).normalize();
    const dawn = 1 - smoothstep(b15 + 0.5, b15 + 1.2, t);
    (u.sun!.value as THREE.Vector3).copy(sun); u.dawn!.value = dawn;
    (e.air.material.uniforms.sun!.value as THREE.Vector3).copy(sun); e.air.material.uniforms.dawn!.value = dawn;
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(target);
    r.clearDepth();
    r.render(this.eScene, cam);
    r.autoClear = ac;
    // the lights that become the ceiling's stickers (where the outro's camera will see them)
    const on = smoothstep(b16 - 1.0, b16 - 0.2, t);
    if (on > 0) {
      const au = this.ctx.audio, tEndO = au.downbeats.filter((d) => d <= au.duration - 0.3).pop() ?? au.duration - 1.5;
      const v = outroView(t, b16, tEndO, this.dive), oc = this.oCam;
      aim(oc, v.pos, v.look, v.roll, v.up);
      oc.fov = v.fov; oc.aspect = AS; oc.updateProjectionMatrix(); oc.updateMatrixWorld();
      const P = this.lights.u.uP!.value as THREE.Vector4[];
      const tanH = Math.tan((v.fov / 2) * Math.PI / 180);
      let n = 0;
      const q = new THREE.Vector3();
      for (const st of this.stickers) {
        q.set(st.u, CEIL_Y - 0.012, st.v);
        const dist = q.distanceTo(v.pos);
        q.project(oc);
        if (q.z > 1 || n >= 50) continue;
        P[n++]!.set(q.x * AS, q.y, st.r / dist / tanH, 1.0 + 0.06 * Math.sin(t * 3 + n));
      }
      this.lights.u.uN!.value = n;
      this.lights.u.uRes!.value = 1 - smoothstep(b16 - 0.8, b16 + 0.2, t);
      this.lights.u.uK!.value = on;
      this.lights.render(r, target);
    }
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, r = this.ctx.renderer;
    const { s: kick, I } = this.surge(t);
    const px = 2 / out.height;
    let i = 0;
    while (i < this.runs.length - 1 && t >= this.runs[i + 1]!.t0 + 0.1 - (this.runs[i + 1]!.xd ?? 0)) i++;
    const run = this.runs[i]!, nx = this.runs[i + 1];
    // inside a transition into run i? (it runs from t0 + 0.1 - xd to t0 + 0.1)
    const inX = run.x && t < run.t0 + 0.1 && i > 0;
    if (inX) {
      const prev = this.runs[i - 1]!;
      const u = clamp((t - (run.t0 + 0.1 - run.xd!)) / run.xd!);
      this.world(prev, t, this.rtA, kick, I, px);
      this.world(run, t, this.rtB, kick, I, px);
      const X = this.xf.u;
      X.uU!.value = u; X.uK!.value = run.x === 'iris' ? 0 : run.x === 'collapse' ? 1 : 2;
      const c: [number, number] = run.x === 'collapse' ? this.holeOnScreen(this.holeCam(run, run.t0)) : run.x === 'lens' ? this.holeOnScreen(this.holeCam(prev, t)) : [0, 0];
      (X.uC!.value as THREE.Vector2).set(c[0], c[1]);
      this.xf.render(r, out);
    } else this.world(run, t, out, kick, I, px);
    void nx;

    const fi = frameIdx(t);
    let shake = 5 * kick, zoom = 1 + 0.035 * kick, flash = 0;
    if (run.flash && t >= run.t0) flash += run.flash * Math.exp(-(t - run.t0) / 0.1);
    // the drop opens out of chorus 3's gold-white: the first frames are still that light
    flash += 0.6 * (1 - smoothstep(this.t0, this.t0 + 0.35, t));
    if (run.w === 'earth') { shake *= 1 - smoothstep(this.bar(15) + 0.6, this.bar(16), t); zoom = 1 + 0.02 * kick; }
    return {
      zoom,
      shake: [(hash(fi, 1) - 0.5) * 2 * shake, (hash(fi, 2) - 0.5) * 2 * shake],
      flash,
      ca: 0.8 + 0.8 * kick,
      bloom: 0.7,
    };
  }

  override dispose() {
    for (const p of [this.warp, this.neb, this.nebC, this.hole, this.xf, this.lights]) p.mat.dispose();
    for (const rt of [this.volRT, this.holeRT, this.rtA, this.rtB]) rt.dispose();
    this.tex.dispose();
  }
}
