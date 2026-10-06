// The ending (after drop 3, to the end of the song): the flight through the cosmos ends at the Earth. We fall at it
// (the night side; the Namib's coast of dunes under the moon), the disc grows past the frame, the scale changes, we
// drop through a deck of moonlit cloud and come down over the dunes, slowing, and land at night on the sand. On the
// sand lie the two figures made of stars (the same constellation as the ceiling: J and PATH in ceiling.ts), star
// stickers fallen around them, all glowing and lighting the sand; the light trails of the figures shine on the sand.
// From here the ceiling outro's timing: the scattered stars go out on the beat, the light joins the two hands on
// "take my hand", the figures' stars go out on the beat (feet first, hands last), the two hands drift together,
// merge and go out on the final downbeat. Above: the moon, the Milky Way, the dunes' crests against the sky.
// The words sung here are written in light: the "da da da" stutter as syllables over the Earth, "Take my hand" and
// the two "Go-o-old"s in the sky over the dunes.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../../engine/gl';
import { clamp, ease, hash, lerp, mulberry32, prog, pulse, smoothstep, noise1 } from '../../engine/util';
import { Earth } from '../lib/earth';
import { aim } from '../lib/stage';
import { strokeText, type StrokeText } from '../../engine/stroke';
import { loadPhosphorFont, PHOS_FONT } from '../lib/phosphor';

/** The two figures, in ceiling coordinates (u right, v toward the heads; metres) — as in ceiling.ts. */
const J: Record<string, [number, number]> = {
  aHead: [-0.52, 0.74], aNeck: [-0.52, 0.52], aShL: [-0.72, 0.46], aShR: [-0.32, 0.46], aElL: [-0.86, 0.2], aHaL: [-0.92, -0.06],
  aElR: [-0.27, 0.22], aHaR: [-0.15, 0.06], aHip: [-0.52, -0.08], aKnL: [-0.66, -0.46], aFtL: [-0.72, -0.84], aKnR: [-0.4, -0.47], aFtR: [-0.36, -0.85],
  bHead: [0.52, 0.76], bNeck: [0.52, 0.54], bShL: [0.32, 0.48], bShR: [0.72, 0.48], bElL: [0.27, 0.24], bHaL: [0.15, 0.06],
  bElR: [0.86, 0.72], bHaR: [0.94, 0.98], bHip: [0.52, -0.06], bKnL: [0.4, -0.45], bFtL: [0.35, -0.83], bKnR: [0.65, -0.44], bFtR: [0.72, -0.82],
};
const PATH = [
  ['aFtL', 'aKnL', 'aHip', 'aKnR', 'aFtR'], ['aHip', 'aNeck', 'aHead'], ['aHaL', 'aElL', 'aShL', 'aNeck', 'aShR', 'aElR', 'aHaR'],
  ['bHaL', 'bElL', 'bShL', 'bNeck', 'bShR', 'bElR', 'bHaR'], ['bHead', 'bNeck', 'bHip'], ['bFtL', 'bKnL', 'bHip', 'bKnR', 'bFtR'],
];
const FIG_OUT = ['aFtL', 'bFtR', 'aFtR', 'bFtL', 'aKnL', 'bKnR', 'aKnR', 'bKnL', 'aHip', 'bHip', 'aHaL', 'bHaR', 'aElL', 'bElR', 'aHead', 'bHead', 'aShL', 'bShR', 'aNeck', 'bNeck', 'aShR', 'bShL', 'aElR', 'bElL'];
/** sand metres per ceiling unit (the figures a little larger than life on the sand) */
const S = 1.25;
const sandXZ = (u: number, v: number): [number, number] => [u * S, -v * S];

// ------------------------------------------------------------------------------------------ the Earth fall
/** The landing site: the Namib's coast (dunes meeting the Atlantic), at night. */
const SITE = (() => { const lat = -24.6 * Math.PI / 180, lon = 14.9 * Math.PI / 180; const th = Math.PI / 2 - lat, ph = lon + Math.PI; return new THREE.Vector3(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)); })();
/** altitude above the site (Earth radii are 6.371 units: 1 unit = 1000 km) through the fall: log-space keys */
const ALT: [number, number][] = [[211.4, 500], [212.6, 70], [213.6, 22], [214.6, 7], [215.6, 1.6], [216.3, 0.12], [216.75, 0.01]];
function altAt(t: number) {
  if (t <= ALT[0]![0]) return ALT[0]![1];
  for (let i = 1; i < ALT.length; i++) if (t <= ALT[i]![0]) {
    const [t0, a0] = ALT[i - 1]!, [t1, a1] = ALT[i]!;
    return Math.exp(lerp(Math.log(a0), Math.log(a1), (t - t0) / (t1 - t0)));
  }
  return ALT[ALT.length - 1]![1];
}
const _v = new THREE.Vector3();
/** Put the Earth in front of `cam` so that the landing site faces it, at the fall's altitude for t (drop 3's last
 *  seconds and the ending share this, so the cut between them is seamless). */
export const EARTH_END = {
  place(earth: Earth, cam: THREE.Camera, t: number, k = 1) {
    const R = earth.radius, alt = altAt(t);
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    earth.position.copy(cam.position).addScaledVector(fwd, R + alt);
    // the site (object space) faces the camera, the Earth's north toward the frame's top (turned by a slow spin):
    // fixed to the camera's own frame, so any camera (drop 3's or ours) sees the same Earth
    const n0 = new THREE.Vector3(0, 1, 0).addScaledVector(SITE, -SITE.y).normalize();
    const mObj = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(n0, SITE), n0, SITE);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion).applyAxisAngle(fwd, -(0.5 + 0.03 * (t - 213)));
    const back = fwd.clone().negate();
    const mW = new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(camUp, back), camUp, back);
    earth.quaternion.setFromRotationMatrix(mW.multiply(mObj.transpose()));
    earth.scale.setScalar(1);
    earth.time = t;
    const u = earth.surface.material.uniforms;
    u.cityGain!.value = k; u.moonK!.value = 0.35 * k;
    earth.clouds.material.uniforms.k!.value = k;
    earth.clouds.material.uniforms.moonK!.value = 0.45 * k;
    earth.air.material.uniforms.k!.value = k;
    // a sunrise on the far limb while we are still out in space (gold, like the drop): gone before we reach the site
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const sun = right.multiplyScalar(0.62).addScaledVector(up, 0.42).addScaledVector(fwd, 0.66).normalize();
    const dawn = k * (1 - smoothstep(214.9, 215.7, t));
    (u.sun!.value as THREE.Vector3).copy(sun); u.dawn!.value = dawn;
    (earth.air.material.uniforms.sun!.value as THREE.Vector3).copy(sun); earth.air.material.uniforms.dawn!.value = dawn;
  },
};

// ------------------------------------------------------------------------------------------ the dunes (a shader)
const SAND = /* glsl */ `
uniform vec3 cPos, cR, cU, cF; uniform float tanY;
uniform vec4 uS[64]; uniform vec4 uSC[64]; uniform int nS;
uniform vec4 uSeg[32]; uniform vec2 uSegK[32]; uniform int nSeg;
uniform vec4 uJoin; uniform vec2 uJoinK;
uniform float uT, uMoon, uSky;
uniform sampler2D uLow; uniform vec2 uLowPx;
const vec3 MOON = normalize(vec3(-0.34, 0.21, -0.92));

float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fb(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vn(p); p = rot2(0.7) * p * 2.07 + 13.0; a *= 0.5; } return s / 0.9375; }
// dunes: long crests across the wind, warped; flat where the figures lie
float Hd(vec2 p) {
  float r = length(p);
  float near = 0.08 * sin(p.x * 0.35 + 1.0) * sin(p.y * 0.28) + 0.06 * (vn(p * 0.6) - 0.5);
  if (r < 8.0) return near - 0.1;
  float flat0 = smoothstep(8.0, 45.0, r);
  vec2 q = p + 40.0 * vec2(vn(p * 0.004) - 0.5, vn(p * 0.004 + 7.0) - 0.5);
  float ph = dot(q, normalize(vec2(0.8, 0.6))) * 0.022 + 3.0 * vn(q * 0.006);
  float crest = pow(0.5 + 0.5 * sin(ph), 2.2);
  float h = 22.0 * crest + 9.0 * vn(q * 0.011) + 3.0 * vn(q * 0.05) * smoothstep(400.0, 100.0, r);
  // a great dune behind the figures, its crest against the sky
  h += 17.0 * exp(-pow((p.y + 190.0 + 40.0 * sin(p.x * 0.012)) / 70.0, 2.0)) * smoothstep(-400.0, -100.0, p.y);
  return h * flat0 + near * (1.0 - flat0) - 0.1;
}
vec3 skyBase(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 c = mix(vec3(0.012, 0.022, 0.06), vec3(0.002, 0.004, 0.014), pow(y, 0.45));
  float md = acos(clamp(dot(d, MOON), -1.0, 1.0));
  c += vec3(0.85, 0.9, 1.0) * (exp(-md / 0.3) * 0.06 + exp(-md / 0.9) * 0.02) * uMoon;
  return c + vec3(0.03, 0.04, 0.07) * exp(-y / 0.06);
}
vec3 sky(vec3 d) {
  float y = max(d.y, 0.0);
  vec3 c = mix(vec3(0.012, 0.022, 0.06), vec3(0.002, 0.004, 0.014), pow(y, 0.45));
  // the Milky Way: a band across the sky with dark rifts
  vec3 g = normalize(vec3(0.8, 0.25, 0.3));
  float band = exp(-pow(dot(d, g) / 0.2, 2.0));
  vec2 sp = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
  float mw = band * (0.45 + 0.8 * fb(sp * 6.0 + 3.0)) * (1.0 - 0.7 * smoothstep(0.55, 0.75, fb(sp * 14.0 + 9.0)) * band);
  c += vec3(0.11, 0.1, 0.13) * mw * uSky + vec3(0.04, 0.03, 0.05) * band * uSky;
  // stars
  for (int k = 0; k < 2; k++) {
    float sc = k == 0 ? 220.0 : 520.0;
    vec2 g2 = sp * sc / vec2(1.0, 1.0); vec2 id = floor(g2), f = fract(g2);
    float hh = hash12(id + float(k) * 17.0);
    float dens = k == 0 ? 0.035 : 0.03 + 0.3 * band;
    if (hh < dens) {
      vec2 pp = 0.25 + 0.5 * hash22(id + 3.0);
      float dd = length((f - pp) / sc * vec2(cos(sp.y), 1.0));      // angular distance (rad)
      float m = hash12(id + 9.0);
      float sz = (k == 0 ? 0.0011 : 0.0008) * (0.8 + 0.6 * m);
      c += mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.85, 0.65), m) * exp(-dd * dd / (sz * sz)) * (k == 0 ? 0.8 + 3.0 * m * m * m : 0.3) * uSky * (0.85 + 0.15 * sin(uT * 3.0 + m * 40.0));
    }
  }
  // the moon and its halo
  float md = acos(clamp(dot(d, MOON), -1.0, 1.0));
  c += vec3(0.85, 0.9, 1.0) * (smoothstep(0.0105, 0.0095, md) * 6.0 + exp(-md / 0.05) * 0.25 + exp(-md / 0.3) * 0.06) * uMoon;
  // a low haze over the horizon
  c += vec3(0.03, 0.04, 0.07) * exp(-y / 0.06);
  return c;
}
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292), k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2; p.x = abs(p.x); p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0); float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
float segD(vec2 p, vec2 a, vec2 b, float rv) { vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, rv); return length(pa - ba * h); }
void main() {
  vec2 s = (vUv - 0.5) * 2.0;
  vec3 rd = normalize(cF + s.x * tanY * 1.77778 * cR + s.y * tanY * cU);
  vec3 ro = cPos;
  float t = 0.05, hit = 0.0, tp = 0.05, dp = 1.0;
#if PASS == 1
  // start from the quarter-resolution pass's distance (the nearest of the four texels around, minus a margin)
  float tl = 1e9;
  for (int j = 0; j < 9; j++) { vec2 o = vec2(float(j % 3) - 1.0, float(j / 3) - 1.0) * 1.5 * uLowPx; tl = min(tl, texture(uLow, vUv + o).r); }
  if (tl > 5000.0 && rd.y > 0.12) { fragColor = vec4(sky(rd), 1.0); return; }
  // (by the horizon a dune's edge can fall between the coarse samples: march those pixels in full)
  bool edge = tl > 5000.0;
  float tStart = 0.0;
  t = edge ? 20.0 : max(0.05, tl * 0.86 - 0.2); tp = t; dp = (ro + rd * t).y - Hd((ro + rd * t).xz);
  for (int i = 0; i < 64; i++) {
    if (i == 30) edge = true;   // (not there yet: past a crest; go on in coarse steps)
#else
  for (int i = 0; i < 96; i++) {
#endif
    vec3 p = ro + rd * t;
    float dh = p.y - Hd(p.xz);
    if (dh < 0.002 * t) {
      // refine between the last two samples
      t = tp + (t - tp) * dp / max(dp - dh, 1e-4);
      hit = 1.0; break;
    }
    tp = t; dp = dh;
#if PASS == 1
    t += edge ? clamp(dh * 0.5, 0.02 * t, 6.0 + 0.05 * t) : clamp(dh * 0.7, 0.005 + 0.012 * t, 2.0 + 0.03 * t);
#else
    t += clamp(dh * 0.5, 0.02 + 0.03 * t, 8.0 + 0.06 * t);
#endif
    if (t > 3000.0) break;
  }
  // (a grazing ray that runs out of steps is ground near the horizon, not sky)
#if PASS == 0
  if (hit < 0.5 && t < 3000.0) hit = 1.0;
#else
  if (hit < 0.5 && t < 3000.0 && rd.y < 0.0) hit = 1.0;
#endif
#if PASS == 0
  fragColor = vec4(hit > 0.5 ? t : 1e4, 0.0, 0.0, 1.0); return;
#endif
  vec3 col;
  if (hit < 0.5) { col = sky(rd); }
  else {
    vec3 p = ro + rd * t;
    float e = 0.02 + 0.004 * t;
    vec3 N = normalize(vec3(Hd(p.xz - vec2(e, 0.0)) - Hd(p.xz + vec2(e, 0.0)), 2.0 * e, Hd(p.xz - vec2(0.0, e)) - Hd(p.xz + vec2(0.0, e))));
    // wind ripples, only where they can be resolved
    float rk = smoothstep(18.0, 3.0, t);
    vec2 wd = normalize(vec2(0.8, 0.6));
    float rph = dot(p.xz, wd) * 38.0 + 6.0 * vn(p.xz * 0.5) + 2.5 * vn(p.xz * 2.3);
    N = normalize(N + rk * 0.16 * vec3(wd.x, 0.0, wd.y) * cos(rph) * (0.3 + 0.7 * vn(p.xz * 0.7)));
    float ml = max(dot(N, MOON), 0.0);
    vec3 alb = vec3(0.62, 0.48, 0.33) * (0.85 + 0.3 * vn(p.xz * 0.2));
    vec3 moonC = vec3(0.42, 0.5, 0.78) * 0.16 * uMoon;
    col = alb * (moonC * ml + vec3(0.006, 0.009, 0.02));
    // moon glints on single grains (resolved only near)
    vec2 gc = floor(p.xz * 90.0);
    float gh = hash12(gc);
    vec3 gN = normalize(vec3(hash12(gc + 3.0) - 0.5, 1.2, hash12(gc + 7.0) - 0.5));
    vec2 gf = fract(p.xz * 90.0) - 0.5;
    float glint = step(0.99, gh) * exp(-dot(gf, gf) / 0.03) * pow(max(dot(reflect(-MOON, gN), -rd), 0.0), 60.0) * smoothstep(4.0, 1.2, t);
    col += vec3(0.7, 0.8, 1.0) * glint * 1.5 * uMoon;
    // silver sheen toward the moon: the ripples' crests catch it (forward scattering off the grains)
    float sheen = pow(max(dot(reflect(rd, N), MOON), 0.0), 10.0);
    col += vec3(0.55, 0.62, 0.85) * sheen * 0.09 * uMoon * (0.4 + 0.6 * smoothstep(400.0, 20.0, t));
    // wider, fainter sparkle further out
    vec2 gc2 = floor(p.xz * 30.0);

    // the stars lying on the sand: their light on the sand, and themselves
    if (length(p.xz) < 6.0) {
      vec3 light = vec3(0.0), em = vec3(0.0);
      for (int i = 0; i < 64; i++) {
        if (i >= nS) break;
        vec4 st = uS[i]; vec4 sc = uSC[i];
        if (st.w <= 0.001) continue;
        vec2 dq = p.xz - st.xy;
        float d2 = dot(dq, dq);
        if (d2 > 1.5) continue;
        light += sc.rgb * st.w * (0.0016 / (0.002 + d2) + 0.25 * exp(-d2 / 0.006));
        if (d2 < st.z * st.z * 4.0) {
          vec2 lq = rot2(sc.w) * dq;
          float dd = sdStar5(vec2(lq.x, -lq.y), st.z, 0.46) - st.z * 0.12;
          float body = 1.0 - smoothstep(-0.003, 0.004, dd);
          em = max(em, sc.rgb * st.w * body * (0.9 + 1.4 * smoothstep(0.0, -st.z * 0.5, dd)));
          em += sc.rgb * st.w * exp(-max(dd, 0.0) / 0.008) * 0.25 * (1.0 - body);
        }
      }
      // the figures' light trails on the sand
      vec3 tr = vec3(0.0);
      for (int i = 0; i < 32; i++) {
        if (i >= nSeg) break;
        vec2 k = uSegK[i];
        if (k.y <= 0.001 || k.x <= 0.0) continue;
        vec4 sg = uSeg[i];
        if (p.x < min(sg.x, sg.z) - 0.4 || p.x > max(sg.x, sg.z) + 0.4 || p.z < min(sg.y, sg.w) - 0.4 || p.z > max(sg.y, sg.w) + 0.4) continue;
        float d = segD(p.xz, uSeg[i].xy, uSeg[i].zw, k.x);
        tr += vec3(0.62, 1.0, 0.45) * k.y * (exp(-d / 0.006) * 1.2 + exp(-d / 0.05) * 0.15);
      }
      if (uJoinK.y > 0.001) {
        float d = segD(p.xz, uJoin.xy, uJoin.zw, uJoinK.x);
        tr += vec3(1.0, 0.72, 0.25) * uJoinK.y * (exp(-d / 0.007) * 1.6 + exp(-d / 0.06) * 0.25);
      }
      col += alb * light * 0.9 + light * 0.03 + tr;
      col = max(col, em) + em * 0.15;
    }
    // distance haze
    col = mix(col, skyBase(normalize(vec3(rd.x, 0.02, rd.z))) * 0.9, 1.0 - exp(-t / 700.0));
  }
  fragColor = vec4(col, 1.0);
}`;

// the cloud deck we drop through (over whatever is behind, premultiplied)
const CLOUD = /* glsl */ `
uniform float uK, uZ, uT;
float vn(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fb(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = rot2(0.6) * p * 2.03 + 11.0; a *= 0.5; } return s / 0.97; }
void main() {
  vec2 s = (vUv - 0.5) * vec2(1.7778, 1.0);
  float a = 0.0; vec3 c = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    // sheets rushing at us: each grows from the centre as we fall through it
    float ph = fract(uZ * 0.9 + fk * 0.25);
    float sc = mix(0.3, 4.0, ph * ph);
    float n = fb(s / sc * 1.6 + fk * 7.1);
    float d = smoothstep(0.45, 0.8, n) * sin(3.14159 * ph);
    vec3 cc = mix(vec3(0.16, 0.2, 0.32), vec3(0.5, 0.56, 0.75), fb(s / sc * 3.0 + 4.0 + fk));
    c = c * (1.0 - d) + cc * d;
    a = a + d * (1.0 - a);
  }
  a *= uK;
  fragColor = vec4(c * uK, a);
}`;

interface Star { key: string; u: number; v: number; r: number; rot: number; tOff: number }

export default class CosmosEnding extends Scene {
  earth = new Earth();
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(62, W / H, 0.001, 4000);
  sand!: FSPass;
  sandLow!: FSPass;
  /** the dunes are painted at 3/4 resolution (they are soft; the stars on them are lights) and scaled up */
  midRT = makeRT(W * 0.75, H * 0.75);
  lowRT = makeRT(W / 4, H / 4, { pxScale: 1, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  cloud!: FSPass;
  stars: Star[] = [];
  byKey = new Map<string, Star>();
  segs: [string, string][] = [];
  tHand = 0; tEnd = 0; tLand = 0;
  bgPts!: THREE.Points;
  TL = new Layer2D();
  words: { st: StrokeText; x: number; y: number; sc: number; t0: number; t1: number; times: [number, number][]; gold: boolean; out: number }[] = [];
  das: { t: number; x: number }[] = [];

  beatT(k: number) {
    const a = this.ctx.audio, b0 = Math.ceil(a.beatAt(this.ctx.start) - 0.05);
    return a.timeOfBeat(b0 + k);
  }

  override async init() {
    const { audio, lyrics, start, end } = this.ctx;
    await this.earth.init();
    await loadPhosphorFont();
    this.scene.add(this.earth);
    // a deep star field behind the Earth
    const r = mulberry32(3), n = 3000, pos = new Float32Array(n * 3), colr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, rr = 3000;
      pos.set([Math.sqrt(1 - u * u) * Math.cos(a) * rr, u * rr, Math.sqrt(1 - u * u) * Math.sin(a) * rr], i * 3);
      const k = 0.3 + Math.pow(r(), 4) * 2.5;
      colr.set([k, k * 0.95, k * 0.9], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
    this.bgPts = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, depthWrite: false }));
    this.scene.add(this.bgPts);

    const sandU = () => ({
      cPos: { value: new THREE.Vector3() }, cR: { value: new THREE.Vector3() }, cU: { value: new THREE.Vector3() }, cF: { value: new THREE.Vector3() }, tanY: { value: 0.5 },
      uS: { value: Array.from({ length: 64 }, () => new THREE.Vector4()) }, uSC: { value: Array.from({ length: 64 }, () => new THREE.Vector4()) }, nS: { value: 0 },
      uSeg: { value: Array.from({ length: 32 }, () => new THREE.Vector4()) }, uSegK: { value: Array.from({ length: 32 }, () => new THREE.Vector2()) }, nSeg: { value: 0 },
      uJoin: { value: new THREE.Vector4() }, uJoinK: { value: new THREE.Vector2() },
      uT: { value: 0 }, uMoon: { value: 1 }, uSky: { value: 1 },
      uLow: { value: this.lowRT.texture }, uLowPx: { value: new THREE.Vector2(4 / W, 4 / H) },
    });
    this.sandLow = new FSPass('#define PASS 0\n' + SAND, sandU());
    this.sand = new FSPass('#define PASS 1\n' + SAND, sandU());
    this.sandLow.u.uLow!.value = null;
    this.cloud = new FSPass(CLOUD, { uK: { value: 0 }, uZ: { value: 0 }, uT: { value: 0 } }, { blending: THREE.CustomBlending, transparent: true });
    const cm = this.cloud.mat;
    cm.blendSrc = THREE.OneFactor; cm.blendDst = THREE.OneMinusSrcAlphaFactor; cm.blendEquation = THREE.AddEquation;

    // ---- the stars on the sand: the two figures and fallen stickers around them
    const rnd = mulberry32(42);
    for (const [key, [u, v]] of Object.entries(J)) this.stars.push({ key, u, v, r: 0.075 + rnd() * 0.025, rot: rnd() * 6.28, tOff: Infinity });
    for (let tries = 0; this.stars.length < 60 && tries < 6000; tries++) {
      const rr = 0.045 + Math.pow(rnd(), 2) * 0.07;
      const u = (rnd() * 2 - 1) * 2.4, v = (rnd() * 2 - 1) * 1.5;
      if (this.stars.every((p) => Math.hypot(p.u - u, p.v - v) > (p.r + rr) * 1.6 + 0.1)) this.stars.push({ key: `s${this.stars.length}`, u, v, r: rr, rot: rnd() * 6.28, tOff: Infinity });
    }
    for (const s of this.stars) this.byKey.set(s.key, s);
    for (const pl of PATH) for (let i = 0; i + 1 < pl.length; i++) this.segs.push([pl[i]!, pl[i + 1]!]);
    // timing (the ceiling outro's): scattered stars out over two bars after we land, the figures over two bars
    // after "take my hand", the hands together, merged, out on the final downbeat
    const lines = lyrics.linesIn(start - 1, end);
    const hand = lines.find((l) => /take my hand/i.test(l.text));
    this.tHand = hand ? hand.words[2]?.start ?? hand.start : this.beatT(14);
    this.tEnd = audio.downbeats.filter((d) => d <= end - 0.3).pop() ?? end - 1.5;
    this.tLand = this.beatT(10);
    const scattered = this.stars.filter((s) => s.key.startsWith('s'));
    scattered.forEach((s, i) => { s.tOff = this.beatT(11 + Math.floor((i * 5) / scattered.length)) + (i % 3) * 0.05; });
    FIG_OUT.forEach((k, i) => { const s = this.byKey.get(k); if (s) s.tOff = this.beatT(16 + Math.floor((i * 8) / FIG_OUT.length)) + (i % 3) * 0.05; });

    // ---- the words: "da"s over the Earth, "Take my hand" and the "Go-o-old"s written in the sky
    for (const l of lines) {
      if (/^da\b/i.test(l.words[0]?.w ?? '')) {
        l.words.forEach((w, i) => this.das.push({ t: w.start, x: W / 2 + (i - (l.words.length - 1) / 2) * 120 }));
        continue;
      }
      if (l.start < start + 3) continue;
      const text = l.words.map((w) => w.w).join(' ');
      const st = strokeText(text, 'script', 100);
      const times: [number, number][] = [];
      l.words.forEach((w, wi) => {
        const nch = Array.from(w.w).length;
        for (let j = 0; j < nch; j++) times.push([lerp(w.start, Math.min(w.end, w.start + 1.1), j / nch), lerp(w.start, Math.min(w.end, w.start + 1.1), (j + 1) / nch)]);
        if (wi + 1 < l.words.length) times.push([w.end, l.words[wi + 1]!.start]);
      });
      const sc = Math.min(1.5, 900 / st.width);
      const next = lines.find((x) => x.start > l.start + 0.1);
      this.words.push({ st, x: W / 2 - (st.width * sc) / 2, y: 230, sc, t0: l.start, t1: l.end, times, gold: /gold/i.test(text), out: next ? next.start - 0.2 : this.tEnd + 0.3 });
    }
  }

  /** the camera over the sand: down from the cloud deck, slowing, pitching up to the figures; then a slow push in */
  private sandCam(t: number) {
    const tA = 216.55, tL = this.tLand;
    const k = prog(t, tA, tL, ease.outCubic);
    const h = Math.exp(lerp(Math.log(420), Math.log(1.3), k));
    const tilt = ease.inOutCubic(prog(t, tA + 0.35, tL));
    const pitch = lerp(-Math.PI / 2 + 0.02, -0.19, tilt);
    const back = lerp(0, 2.7, tilt);
    const mid: [number, number] = sandXZ((J.aHaR![0] + J.bHaL![0]) / 2, (J.aHaR![1] + J.bHaL![1]) / 2);
    // after landing: a slow push in toward the two hands, keeping them in the frame
    const push = ease.inOutQuad(prog(t, tL, this.tEnd + 0.8));
    const pos = new THREE.Vector3(0.12 * Math.sin(t * 0.3) + mid[0] * push, h - 0.42 * push, back - 0.95 * push);
    const free = pos.clone().add(new THREE.Vector3(0, Math.sin(pitch) * 3, -Math.cos(pitch) * 3));
    // the hands' point, a little below the centre of the frame
    const aimAt = new THREE.Vector3(mid[0], 0.0, mid[1]);
    const toH = aimAt.clone().sub(pos).normalize();
    const want = pos.clone().add(toH.add(new THREE.Vector3(0, 0.1, 0)).normalize().multiplyScalar(3));
    const look = free.lerp(want, 0.0);
    const up = new THREE.Vector3(0, 0, -1).lerp(new THREE.Vector3(0, 1, 0), smoothstep(-1.4, -0.6, pitch)).normalize();
    return { pos, look, up, roll: 0.02 * Math.sin(t * 0.25) };
  }

  private writeWords(t: number) {
    const c = this.TL.ctx;
    this.TL.clear('#000');
    c.globalCompositeOperation = 'lighter';
    c.lineCap = 'round'; c.lineJoin = 'round';
    let any = false;
    // the "da"s: gold syllables lighting one by one over the Earth
    for (const d of this.das) {
      if (t < d.t - 0.02 || t > 216.9) continue;
      any = true;
      const age = t - d.t, hot = Math.exp(-age / 0.2), a = 1 - smoothstep(216.3, 216.85, t);
      c.save();
      c.font = `${70}px "${PHOS_FONT}"`; c.textAlign = 'center';
      c.shadowColor = 'rgba(255,170,50,0.9)'; c.shadowBlur = 20 + 20 * hot;
      c.fillStyle = `rgba(255,${Math.round(lerp(205, 250, hot))},${Math.round(lerp(120, 230, hot))},${a})`;
      const cy = 960, s = 1 + 0.25 * Math.pow(1 - clamp(age / 0.14), 3);
      c.translate(d.x, cy - 24); c.scale(1, s); c.translate(-d.x, -(cy - 24));
      c.fillText('da', d.x, cy);
      c.restore();
    }
    // the sung lines, written in light in the sky (one at a time)
    for (const w of this.words) {
      if (t < w.t0 - 0.05 || t > w.out + 0.4) continue;
      any = true;
      const a = 1 - smoothstep(w.out, w.out + 0.4, t);
      let len = 0;
      for (let i = 0; i < w.times.length; i++) { const [a0, b0] = w.times[i]!; if (t >= b0) len = i + 1; else if (t > a0) { len = i + (t - a0) / (b0 - a0); break; } else break; }
      const total = w.st.total * clamp(len / Math.max(1, w.times.length));
      c.save();
      c.translate(w.x, w.y); c.scale(w.sc, w.sc);
      const col = w.gold ? [255, 196, 90] : [210, 255, 170];
      let acc = 0;
      for (let i = 0; i < w.st.strokes.length; i++) {
        const pts = w.st.strokes[i]!, Ls = w.st.lens[i]!;
        const s0 = w.st.startLen[i]!;
        if (s0 >= total) break;
        const remain = total - s0;
        c.beginPath(); c.moveTo(pts[0]!.x, pts[0]!.y);
        let j = 1;
        for (; j < pts.length && Ls[j]! <= remain; j++) c.lineTo(pts[j]!.x, pts[j]!.y);
        if (j < pts.length) { const p0 = pts[j - 1]!, p1 = pts[j]!, u = (remain - Ls[j - 1]!) / Math.max(1e-6, Ls[j]! - Ls[j - 1]!); c.lineTo(lerp(p0.x, p1.x, u), lerp(p0.y, p1.y, u)); }
        for (const [lw, k, hot] of [[22, 0.06, 0], [10, 0.16, 0], [5, 0.45, 0.25], [2.4, 1, 0.75]] as const) {
          c.lineWidth = lw / w.sc;
          const cc = col.map((x) => Math.round(x + (255 - x) * hot));
          c.strokeStyle = `rgba(${cc[0]},${cc[1]},${cc[2]},${Math.min(1, k * a)})`;
          c.stroke();
        }
        acc++;
      }
      void acc;
      c.restore();
    }
    this.TL.upload();
    return any;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, r = this.ctx.renderer;
    const tSand = 216.6;
    if (t < tSand) {
      // ---- the fall at the Earth: straight at the site, a slow roll
      const cam = this.cam;
      aim(cam, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1), 0.3 * Math.sin(t * 0.2));
      cam.fov = 62; cam.near = Math.max(0.0005, altAt(t) * 0.2); cam.far = 4000;
      cam.updateProjectionMatrix();
      EARTH_END.place(this.earth, cam, t, 1);
      this.bgPts.position.copy(cam.position);
      r.setRenderTarget(out);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, true);
      r.render(this.scene, cam);
    } else {
      // ---- the dunes
      const { pos, look, roll, up } = this.sandCam(t);
      const cam = this.cam;
      aim(cam, pos, look, roll, up);
      const U = this.sand.u;
      const e = cam.matrixWorld.elements;
      (U.cPos!.value as THREE.Vector3).copy(pos);
      (U.cR!.value as THREE.Vector3).set(e[0]!, e[1]!, e[2]!);
      (U.cU!.value as THREE.Vector3).set(e[4]!, e[5]!, e[6]!);
      (U.cF!.value as THREE.Vector3).set(-e[8]!, -e[9]!, -e[10]!);
      U.tanY!.value = Math.tan((50 / 2) * Math.PI / 180);
      U.uT!.value = t;
      U.uMoon!.value = 1 - 0.5 * smoothstep(this.tEnd - 0.5, this.tEnd + 1.2, t);
      U.uSky!.value = 1;
      // stars: lit (with a breath), out on their beat; the two hands drift together, merge, out on the final downbeat
      const S4 = U.uS!.value as THREE.Vector4[], SC = U.uSC!.value as THREE.Vector4[];
      const meet = ease.inOutCubic(prog(t, this.beatT(22), this.tEnd - 0.8));
      const ha = this.byKey.get('aHaR')!, hb = this.byKey.get('bHaL')!;
      const mid = [(J.aHaR![0] + J.bHaL![0]) / 2, (J.aHaR![1] + J.bHaL![1]) / 2];
      const chop = this.ctx.audio.hit('vocal', t, 0.2) * smoothstep(this.beatT(22), this.beatT(26), t);
      this.stars.forEach((s, i) => {
        let u = s.u, v = s.v, k: number;
        const off = t < s.tOff ? 1 : Math.max(0, 1 - (t - s.tOff) / 0.18) * 0.6 * Math.pow(0.5, (t - s.tOff) / 0.25);
        k = (1.0 + 0.06 * noise1(t * 0.7, i)) * off;
        let rad = s.r;
        if (s === ha || s === hb) {
          const tgt = mid;
          u = lerp(s.u, tgt[0]!, meet); v = lerp(s.v, tgt[1]!, meet);
          const flare = 1 + 1.2 * pulse(t, this.tHand, 0.6) + 0.5 * smoothstep(this.tHand, this.tHand + 0.4, t) * (1 - meet);
          const last = t < this.tEnd ? 1 : Math.pow(0.5, (t - this.tEnd) / 0.12);
          k = (1.0 + 0.4 * chop) * flare * last * (1 + 0.6 * meet);
          rad = s.r * (1 - 0.35 * meet) * (s === hb ? 1 - meet * 0.999 : 1);
          if (s === hb && meet > 0.98) k = 0;
        }
        // (a gentle settle as we land: the stars brighten as the sand comes up)
        k *= 0.4 + 0.6 * smoothstep(tSand, this.tLand, t);
        const [x, z] = sandXZ(u, v);
        S4[i]!.set(x, z, rad * S, k);
        const tint = s.key.startsWith('s') ? [0.6, 1.0, 0.42] : [0.72, 1.0, 0.55];
        SC[i]!.set(tint[0]! * 1.1, tint[1]! * 1.1, tint[2]! * 1.1, s.rot);
      });
      U.nS!.value = this.stars.length;
      // the figures' trails fade with their stars; the hands' line draws on "take my hand" and fades as they meet
      const figGone = prog(t, this.beatT(16), this.beatT(24));
      const SG = U.uSeg!.value as THREE.Vector4[], SK = U.uSegK!.value as THREE.Vector2[];
      this.segs.forEach(([a, b], i) => {
        const [ax, az] = sandXZ(...J[a]!), [bx, bz] = sandXZ(...J[b]!);
        SG[i]!.set(ax, az, bx, bz);
        SK[i]!.set(1, 0.5 * (1 - figGone) * smoothstep(tSand, this.tLand, t));
      });
      U.nSeg!.value = this.segs.length;
      const [hx, hz] = sandXZ(...J.aHaR!), [gx, gz] = sandXZ(...J.bHaL!);
      (U.uJoin!.value as THREE.Vector4).set(hx, hz, gx, gz);
      (U.uJoinK!.value as THREE.Vector2).set(prog(t, this.tHand, this.tHand + 0.7), (1.2 + 1.5 * pulse(t, this.tHand + 0.7, 0.4)) * (1 - prog(t, this.beatT(22), this.beatT(26))));
      // the terrain's distances at quarter resolution first, then the full-resolution pass refines from them
      for (const k of Object.keys(U)) if (k !== 'uLow') this.sandLow.u[k]!.value = U[k]!.value;
      this.sandLow.render(r, this.lowRT);
      this.sand.render(r, this.midRT);
      this.ctx.comp.draw(r, this.midRT.texture, out, { mode: 'replace' });
    }
    // the cloud deck between the two
    const ck = smoothstep(216.05, 216.45, t) * (1 - smoothstep(216.62, 216.95, t));
    if (ck > 0.002) {
      const U = this.cloud.u;
      U.uK!.value = ck; U.uZ!.value = (t - 216.0) * 2.4; U.uT!.value = t;
      this.cloud.render(r, out);
    }
    // the words, in light
    if (this.writeWords(t)) this.ctx.comp.draw(r, this.TL.texture, out, { mode: 'add', tint: [1.3, 1.3, 1.3] });
    const land = pulse(t, this.tLand, 0.25);
    return {
      bloom: 0.85, bloomThreshold: 0.7, bloomRadius: 0.85, halation: 0.12, vignette: 0.5, grain: 0.04, ca: 0.5,
      exposure: 1 - smoothstep(this.tEnd + 0.6, this.ctx.end, t) * 0.85, zoom: 1 + 0.01 * land,
    };
  }

  override dispose() { this.sand.mat.dispose(); this.cloud.mat.dispose(); }
}
void hash; void H;
