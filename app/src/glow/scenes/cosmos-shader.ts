// The galaxy of the drops as one analytic fragment shader: a real logarithmic spiral (two main arms, spurs, a
// bulge), dust lanes on the inner edge of the arms, nebulae and star clusters along them, and resolved stars
// in layers that fade in as you zoom (so the same galaxy holds from the whole disk down to single stars),
// with five-pointed phosphor star stickers scattered through it. Flat and graphic: the camera is a 2D
// (centre, zoom, roll, tilt) in the plane of the disk.
// The JS half (galaxyAt) repeats the shader's spiral and cluster maths so shots can be composed on real arms.
import * as THREE from 'three';

// ---------- JS port of the shader's structure (for composing shots) ----------
const fr = (x: number) => x - Math.floor(x);
export function hash12(x: number, y: number) {
  let a = fr(x * 0.1031), b = fr(y * 0.1031), c = fr(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fr((a + b) * c);
}
function hash22(x: number, y: number): [number, number] {
  let a = fr(x * 0.1031), b = fr(y * 0.103), c = fr(x * 0.0973);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return [fr((a + b) * c), fr((a + c) * b)];
}
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash12(ix, iy), b = hash12(ix + 1, iy), c = hash12(ix, iy + 1), d = hash12(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const fbm3 = (x: number, y: number) => (0.5 * noise(x, y) + 0.25 * noise(x * 2 + 17, y * 2 + 9) + 0.125 * noise(x * 4 + 31, y * 4 + 3)) / 0.875;
export interface Cfg { seedX: number; seedY: number; pat: number }
/** Arm phase at plane point (x, y): the arms lie where cos(2 ph) = 1. */
export function armPhase(c: Cfg, x: number, y: number) {
  const r = Math.hypot(x, y), th = Math.atan2(y, x);
  const warp = (fbm3(x * 2.3 + c.seedX, y * 2.3 + c.seedY) - 0.5) * 0.9 * sm(0.05, 0.6, r);
  return th - 2.3 * Math.log(r + 0.03) + c.pat + warp * 0.6;
}
/** The centre line of arm `k` (0 or 1) at radius r: plane point and its tangent angle. */
export function armAt(c: Cfg, r: number, k: number) {
  const find = (rr: number) => {
    let best = 0, bv = -9;
    for (let i = 0; i < 720; i++) {
      const th = (i / 720) * Math.PI * 2;
      const v = Math.cos(2 * armPhase(c, rr * Math.cos(th), rr * Math.sin(th)));
      // arm k: the two arms are half a turn apart (cos 2ph has two maxima per turn)
      if (v > bv) { bv = v; best = th; }
    }
    // collect both maxima
    const cand: number[] = [];
    for (let i = 0; i < 720; i++) {
      const th = (i / 720) * Math.PI * 2;
      const v = Math.cos(2 * armPhase(c, rr * Math.cos(th), rr * Math.sin(th)));
      const vp = Math.cos(2 * armPhase(c, rr * Math.cos(th - 0.00873), rr * Math.sin(th - 0.00873)));
      const vn = Math.cos(2 * armPhase(c, rr * Math.cos(th + 0.00873), rr * Math.sin(th + 0.00873)));
      if (v > 0.9 && v >= vp && v > vn) cand.push(th);
    }
    cand.sort((a, b) => a - b);
    return cand.length ? cand[Math.min(k, cand.length - 1)]! : best;
  };
  const p = (rr: number) => { const th = find(rr); return [rr * Math.cos(th), rr * Math.sin(th)] as [number, number]; };
  const a = p(r - 0.02), b = p(r + 0.02), m = p(r);
  return { x: m[0], y: m[1], ang: Math.atan2(b[1] - a[1], b[0] - a[0]) };
}
/** Strongest star cluster (cell 0.11 grid, as in the shader) near (x, y). */
export function clusterNear(x: number, y: number, reach = 0.2) {
  let best: { x: number; y: number; rc: number; d: number } | null = null;
  const cx = Math.floor(x / 0.11), cy = Math.floor(y / 0.11), n = Math.ceil(reach / 0.11) + 1;
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const gx = cx + i, gy = cy + j;
    if (hash12(gx + 5, gy + 5) < 0.8) continue;
    const [hx, hy] = hash22(gx + 31, gy + 31);
    const px = (gx + 0.2 + 0.6 * hx) * 0.11, py = (gy + 0.2 + 0.6 * hy) * 0.11, rc = 0.012 + 0.02 * hash12(gx + 9, gy + 9);
    const d = Math.hypot(px - x, py - y);
    if (d < reach && (!best || d < best.d)) best = { x: px, y: py, rc, d };
  }
  return best;
}

// ---------- the shader ----------
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes, uC, uSeed;
uniform float uZ, uRot, uCt, uT, uPat, uExpo, uKick, uPulseR, uPulseA, uGalaxy;
uniform vec3 cCore, cArm, cNeb1, cNeb2, cStarA, cStarB, cHot, cStk1, cStk2, cBg, cUv;
uniform vec4 uScrim;      // centre xy, half-size zw (ndc units)
uniform float uScrimK;
uniform vec4 uSun;        // xy centre (ndc), z strength, w radius scale
uniform vec3 cSun;
uniform vec4 uShock;      // xy centre (ndc), z radius, w amplitude
uniform vec3 cShock;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1, 0)), c = hash12(i + vec2(0, 1)), d = hash12(i + vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm3(vec2 p) { return (0.5 * noise(p) + 0.25 * noise(p * 2.0 + 17.0) + 0.125 * noise(p * 4.0 + vec2(31.0, 3.0))) / 0.875; }
float fbm5(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + vec2(17.0, 9.0); a *= 0.5; }
  return s / 0.96875;
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292), k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

void main() {
  vec2 uv = vUv;
  vec2 pr = rot2(uv, uRot) * uZ;
  vec2 P = uC + pr;                              // plane coords (upright, for the stickers)
  vec2 q = uC + vec2(pr.x, pr.y / uCt);          // plane coords of the tilted disk
  float pxw = 2.0 * uZ / uRes.y;                 // world units per pixel
  float deep = 1.0 - smoothstep(0.08, 0.3, uZ);  // 1 when zoomed far in

  // ---- structure of the disk
  float r = length(q);
  float arm = 0.0, edge = 0.0, disk = 0.0, bulge = 0.0, dens = 0.0, dust = 0.0, ab = 1.0, cl = 0.0, neb = 0.0, hue = 0.0;
  if (r < 1.25) {
  float th = atan(q.y, q.x);
  float warp = (fbm3(q * 2.3 + uSeed) - 0.5) * 0.9 * smoothstep(0.05, 0.6, r);
  float ph = th - 2.3 * log(r + 0.03) + uPat + warp * 0.6;
  float armA = pow(0.5 + 0.5 * cos(2.0 * ph), 2.5);
  float armB = pow(0.5 + 0.5 * cos(4.0 * ph + 1.7 + 2.0 * warp), 3.0) * smoothstep(0.25, 0.55, r);
  arm = clamp(armA + 0.35 * armB, 0.0, 1.0);
  edge = 1.0 - smoothstep(0.75, 1.2, r);
  disk = exp(-r * 2.4) * edge;
  bulge = 1.0 * exp(-r * 16.0) + 0.5 * exp(-r * r * 500.0);
  dens = (disk * (0.15 + 1.1 * arm) + bulge) * uGalaxy;

  // dust lanes along the inner edge of the arms
  float lane = pow(0.5 + 0.5 * cos(2.0 * ph - 0.9), 5.0);
  float dFine = fbm3(rot2(q, -uT * 0.05 / (r + 0.25)) * 20.0 + uSeed * 3.0);
  dust = lane * clamp((dFine - 0.22) * 2.6, 0.0, 1.0) * smoothstep(0.06, 0.22, r) * edge;
  if (deep > 0.0) dust *= mix(1.0, 0.25 + 1.5 * fbm5(q * 170.0 + 5.0), deep);
  ab = exp(-2.8 * dust);

  // clusters
  vec2 cc = q / 0.11; vec2 cid = floor(cc) + step(0.5, fract(cc)) - 1.0;
  for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
    vec2 g = cid + vec2(float(i), float(j));
    if (hash12(g + 5.0) < 0.8) continue;
    vec2 hh = hash22(g + 31.0);
    vec2 cp = (g + 0.2 + 0.6 * hh) * 0.11;
    float rc = 0.012 + 0.02 * hash12(g + 9.0);
    vec2 dd = q - cp;
    cl += exp(-dot(dd, dd) / (rc * rc));
  }
  cl *= smoothstep(0.25, 0.6, arm) * edge * smoothstep(0.08, 0.2, r) * uGalaxy;

  // gas and nebulae
  float gas = fbm3(rot2(q, uT * 0.03 / (r + 0.3)) * 7.0 + uSeed * 2.0);
  neb = pow(arm, 1.5) * smoothstep(0.45, 0.8, gas) * (1.0 - 0.85 * dust) * smoothstep(0.1, 0.3, r) * (1.0 - smoothstep(0.7, 1.0, r));
  if (deep > 0.0) neb *= mix(1.0, 0.3 + 1.5 * fbm5(q * 75.0 + 11.0), deep);
  neb *= uGalaxy;
  hue = noise(q * 3.0 + 9.0);

  }

  vec3 diff = vec3(0.0);
  vec3 diskCol = mix(cCore * 0.8, cArm, smoothstep(0.04, 0.45, r));
  diff += diskCol * dens * 0.5 * ab * mix(1.0, 0.22, deep);
  diff += mix(cNeb1, cNeb2, smoothstep(0.3, 0.7, hue)) * neb * 1.15;
  diff += cHot * cl * 0.55 * ab * (0.7 + 0.5 * sin(uT * 5.0 + floor(q.x * 9.0) * 1.7 + floor(q.y * 9.0) * 2.3));
  diff += cCore * bulge * 0.6 * ab * uGalaxy * mix(1.0, 0.5, deep);
  // a wave of light running out along the arms on the beat
  float wv = exp(-pow((r - uPulseR) / 0.08, 2.0)) * uPulseA;
  diff += cArm * wv * (0.3 + arm) * disk * 2.2;
  diff += cUv * uKick * 0.05 * (neb + arm * disk + bulge * 0.2);

  // nebulae in the shapes of the clip's motifs: a star sticker, and two stars joined by a thread of gas
  {
    vec2 a = q - vec2(-0.62, 0.42);
    if (dot(a, a) < 0.1) {
      float d = sdStar5(rot2(a, 0.3), 0.16, 0.45);
      float f = 0.4 + 0.9 * fbm3(rot2(q, uT * 0.05) * 28.0 + 3.0);
      diff += mix(cNeb1, cNeb2, 0.3) * (exp(-abs(d) / 0.010) * 1.1 + exp(-max(d, 0.0) / 0.05) * 0.25 * step(d, 0.0) + 0.25 * exp(-max(d, 0.0) / 0.04)) * f * (1.0 - 0.7 * deep) * uGalaxy;
    }
    vec2 b1 = q - vec2(0.5, -0.55), b2 = q - vec2(0.78, -0.36);
    if (dot(b1, b1) < 0.3) {
      float d1 = sdStar5(rot2(b1, 0.1), 0.08, 0.45), d2 = sdStar5(rot2(b2, -0.2), 0.06, 0.45);
      vec2 ab2 = vec2(0.28, 0.19); float hh = clamp(dot(b1, ab2) / dot(ab2, ab2), 0.0, 1.0);
      float d3 = length(b1 - ab2 * hh + vec2(0.0, 0.03 * sin(hh * 3.14159))) - 0.004;
      float dd = min(min(d1, d2), d3);
      float f = 0.4 + 0.9 * fbm3(rot2(q, -uT * 0.05) * 30.0 + 8.0);
      diff += mix(cNeb2, cHot, 0.35) * (exp(-abs(dd) / 0.008) * 1.0 + 0.3 * exp(-max(dd, 0.0) / 0.035)) * f * (1.0 - 0.7 * deep) * uGalaxy;
    }
    // distant galaxies
    for (int k = 0; k < 2; k++) {
      vec2 c0 = k == 0 ? vec2(2.3, 0.95) : vec2(-2.4, -1.05);
      vec2 g = q - c0;
      if (dot(g, g) < 0.5) {
        g = rot2(g, k == 0 ? 0.6 : -0.4); g.y /= (k == 0 ? 0.45 : 0.6);
        float gr = length(g), gt = atan(g.y, g.x);
        float ga = exp(-gr * 7.0) * (0.25 + 0.9 * pow(0.5 + 0.5 * cos(2.0 * (gt - 2.6 * log(gr + 0.04))), 2.0)) + 1.5 * exp(-gr * gr * 700.0);
        diff += mix(cArm, cCore, 0.4) * ga * 0.5 * (1.0 - 0.8 * deep);
      }
    }
  }
  diff = (1.0 - exp(-diff * 1.3)) * 1.35;
  vec3 col = cBg + diff;

  // ---- stars in layers
  float sd = dens * ab * (1.0 + 10.0 * cl);
  vec3 stars = vec3(0.0);
  float i0s = max(0.0, ceil(log(0.3 / (1000.0 * pxw)) / log(3.0)));
  if (sd > 0.002) for (int k = 0; k < 5; k++) {
    float i = i0s + float(k);
    float cell = 0.3 * pow(0.3333333, i);
    float cpx = cell / pxw;
    float w = smoothstep(7.0, 18.0, cpx) * (1.0 - smoothstep(400.0, 1000.0, cpx));
    if (w <= 0.0) continue;
    vec2 pc = q / cell + vec2(i * 13.7, i * 7.3);
    vec2 id = floor(pc), f = fract(pc);
    vec3 hh = vec3(hash12(id), hash12(id + 17.1), hash12(id + 43.7));
    float kk = cpx > 40.0 ? 1.0 : 0.7;
    if (hh.x < clamp(sd * kk, 0.0, 1.0)) {
      vec2 sp = 0.3 + 0.4 * hash22(id + 3.3);
      vec2 dv = (f - sp) * cpx;
      float d2 = dot(dv, dv);
      float rad = mix(0.9, 2.4, hh.y * hh.y) * (1.0 + 0.7 * smoothstep(20.0, 200.0, cpx));
      float mag = 0.25 + 3.0 * pow(hh.z, 4.0);
      float tw = 0.82 + 0.18 * sin(uT * 3.0 + hh.z * 40.0);
      vec3 sc = mix(cStarA, cStarB, hh.y);
      sc = mix(sc, cHot, clamp(cl * 0.8, 0.0, 0.85));
      float core = exp(-d2 / (rad * rad));
      float halo = 0.10 * exp(-d2 / (rad * rad * 16.0));
      float spk = 0.0;
      if (hh.z > 0.9) {
        float L = min(34.0, cpx * 0.4) * (hh.z - 0.8) * 5.0;
        vec2 a = abs(dv);
        spk = 0.5 * (exp(-a.y * 2.0) * exp(-a.x * 3.0 / L) + exp(-a.x * 2.0) * exp(-a.y * 3.0 / L));
      }
      stars += sc * (core + halo + spk * 0.8) * mag * tw * w * (1.0 + 0.8 * uKick * hh.y);
    }
  }
  col += stars;

  // ---- the deep field behind (parallax: it follows the camera at a fraction)
  {
    float bs = pow(uZ, 0.3);
    vec2 pb = uC * 0.15 + rot2(uv, uRot) * bs;
    float pxb = 2.0 * bs / uRes.y;
    for (int i = 0; i < 2; i++) {
      float cell = i == 0 ? 0.045 : 0.016;
      float cpx = cell / pxb;
      float w = smoothstep(7.0, 16.0, cpx);
      vec2 pc = pb / cell + float(i) * 5.1, id = floor(pc), f = fract(pc);
      vec3 hh = vec3(hash12(id + 2.0), hash12(id + 19.1), hash12(id + 41.7));
      if (hh.x < 0.12) {
        vec2 dv = (f - (0.3 + 0.4 * hash22(id + 8.8))) * cpx;
        float d2 = dot(dv, dv);
        float m = 0.25 + 0.9 * hh.z * hh.z;
        col += mix(cStarA, cStarB, hh.y) * exp(-d2 / 1.6) * m * w * (0.85 + 0.15 * sin(uT * 2.0 + hh.y * 50.0));
      }
    }
  }

  // ---- star stickers: the motif, scattered through the galaxy
  float i0k = max(0.0, ceil(log(1.2 / (520.0 * pxw)) / log(2.5)));
  for (int k = 0; k < 3; k++) {
    float i = i0k + float(k);
    float cell = 1.2 * pow(0.4, i);
    float cpx = cell / pxw;
    float w = smoothstep(120.0, 190.0, cpx) * (1.0 - smoothstep(360.0, 520.0, cpx));
    if (w <= 0.0) continue;
    vec2 pc = P / cell + vec2(i * 3.3, i * 9.1);
    vec2 id = floor(pc), f = fract(pc);
    vec3 hh = vec3(hash12(id + 61.0), hash12(id + 12.3), hash12(id + 77.7));
    float gal = clamp(dens * 2.0, 0.0, 1.0);
    if (hh.x < 0.03 + 0.13 * gal) {
      vec2 sp = 0.5 + 0.22 * (hash22(id + 5.5) - 0.5) * 2.0;
      vec2 dv = (f - sp) * cpx;
      float ang = hh.y * 6.2832 + uT * 0.25 * (hh.z - 0.5);
      vec2 sv = rot2(dv, ang);
      float rS = 0.15 * cpx * (0.75 + 0.5 * hh.z);
      float d = sdStar5(sv, rS, 0.42);
      float charge = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uT * (0.5 + hh.y) + hh.z * 31.0), 2.0) + uKick * (hh.y > 0.5 ? 1.2 : 0.5);
      vec3 sc = hh.z > 0.4 ? cStk1 : cStk2;
      float fill = 1.0 - smoothstep(-1.2, 1.0, d);
      float rim = exp(-abs(d) * 0.35) * 0.0 + (1.0 - smoothstep(0.0, 2.5, abs(d))) * 0.6;
      float halo = exp(-max(d, 0.0) / (0.5 * rS)) * 0.55;
      vec3 add = sc * ((0.85 + rim) * charge * fill + halo * charge);
      col = col * (1.0 - 0.75 * fill * w) + add * w * 1.4;
      // a glint crossing the sticker
      vec2 gv = dv; float ga = abs(gv.x), gb = abs(gv.y);
      float gl = (exp(-ga * 0.06) * exp(-gb * 1.6) + exp(-gb * 0.06) * exp(-ga * 1.6)) * pow(max(0.0, sin(uT * 1.3 + hh.z * 20.0)), 24.0);
      col += sc * gl * 0.7 * w * exp(-length(gv) / (rS * 3.0));
    }
  }

  // ---- text legibility: the sky dims behind the line being sung
  {
    vec2 sv = (uv - uScrim.xy) / uScrim.zw;
    float scr = 1.0 - uScrimK * (1.0 - smoothstep(0.45, 1.0, length(sv)));
    col *= scr;
  }

  // ---- events: the sun and the shockwave
  {
    float d = length(uv - uSun.xy);
    float sr = uSun.w;
    col += cSun * uSun.z * (exp(-d * d / (0.012 * sr * sr)) * 1.6 + 0.45 * exp(-d / (0.22 * sr)) + 0.06 * exp(-d / (0.9 * sr)));
    float ds = length(uv - uShock.xy);
    float wd = 0.03 + 0.07 * uShock.z;
    col += cShock * uShock.w * exp(-pow((ds - uShock.z) / wd, 2.0)) * (0.5 + 0.5 * exp(-ds * 0.6));
  }

  col *= uExpo * (1.0 - 0.28 * dot(uv * vec2(0.5, 0.9), uv * vec2(0.5, 0.9)));
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Look {
  core: string; arm: string; neb1: string; neb2: string; starA: string; starB: string; hot: string;
  stk1: string; stk2: string; bg: string; uv: string; sun: string; shock: string;
  seed: [number, number]; pat: number;
  gain: { core: number; arm: number; neb: number; star: number };
}

export function galaxyMaterial(look: Look) {
  const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
  const g = look.gain;
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false, transparent: false,
    uniforms: {
      uRes: { value: new THREE.Vector2(1920, 1080) }, uC: { value: new THREE.Vector2() }, uSeed: { value: new THREE.Vector2(...look.seed) },
      uZ: { value: 1 }, uRot: { value: 0 }, uCt: { value: 1 }, uT: { value: 0 }, uPat: { value: look.pat }, uExpo: { value: 1 }, uKick: { value: 0 },
      uPulseR: { value: 0 }, uPulseA: { value: 0 }, uGalaxy: { value: 1 },
      cCore: { value: C(look.core, g.core) }, cArm: { value: C(look.arm, g.arm) }, cNeb1: { value: C(look.neb1, g.neb) }, cNeb2: { value: C(look.neb2, g.neb) },
      cStarA: { value: C(look.starA, g.star) }, cStarB: { value: C(look.starB, g.star) }, cHot: { value: C(look.hot, g.star) },
      cStk1: { value: C(look.stk1) }, cStk2: { value: C(look.stk2) }, cBg: { value: C(look.bg) }, cUv: { value: C(look.uv) },
      uScrim: { value: new THREE.Vector4(0, -0.6, 1, 0.3) }, uScrimK: { value: 0 },
      uSun: { value: new THREE.Vector4(0, 0, 0, 1) }, cSun: { value: C(look.sun) },
      uShock: { value: new THREE.Vector4(0, 0, 0, 0) }, cShock: { value: C(look.shock) },
    },
  });
}
