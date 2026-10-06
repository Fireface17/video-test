// The small life over drop 1's galaxy, all in one analytic screen-space shader (additive, a pure function of
// its uniforms): comets crossing on the beat, a pulsar blinking in time with its two beams, and "Take my hand"
// — two soft stars, each trailing a stream of light along a curve, that meet; on "hand" a burst of sparks and
// the merged star hanging in the sky. (Formerly GlowPoints and star meshes: the streams read as beads, the
// rings as dotted lines, the stars had hard polygon edges and the big glows clipped at their point-sprite
// discs — all visible as things pasted over the sky. Here every term is a smooth falloff to zero.)
import * as THREE from 'three';
import { clamp, hash, smoothstep } from '../../engine/util';

type V2 = [number, number];
export interface Join {
  /** the moment they meet */
  t: number; dur: number;
  L: { S: V2; C: V2 }; R: { S: V2; C: V2 }; M: V2;
  cL: THREE.Color; cR: THREE.Color; cJ: THREE.Color;
  /** seconds the merged star stays */
  keep: number;
  size?: number;
}
export interface Fx { sun: [number, number, number, number]; shock: [number, number, number, number] }

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uPx, uT;
uniform vec4 uCo[4];      // comet: head xy, tail vector zw
uniform vec4 uCoK[4];     // comet: strength, width
uniform vec4 uPul;        // pulsar: xy, beam angle, strength
uniform vec4 uBA[2], uBB[2]; // streams: sub-bezier A (xy) B (zw); C (xy), strength, width
uniform vec4 uHd[2];      // heads: xy, size, rotation
uniform vec4 uHk[2];      // heads: strength (x), glow (y)
uniform vec3 cS[2];
uniform vec4 uJ;          // join: xy, age, on
uniform vec4 uJs;         // merged star: size, strength, rotation, glow
uniform vec3 cJ, cHot, cTint;
// the words: a line set in light (R crisp glyphs, G near glow, B wide glow; zero at the texture's borders)
uniform sampler2D uTx; uniform vec2 uTC, uTS; uniform float uTOn;
uniform vec4 uTW[4];      // per word: x0, x1 (texture u), reveal 0..1, brightness
uniform float uTH[4];     // per word: heat (1 while sung)
uniform vec3 cTxt, cTxtGlow;

float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
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
// distance to a quadratic bezier and the curve parameter of the closest point (after Inigo Quilez)
vec2 sdBez(vec2 pos, vec2 A, vec2 B, vec2 C) {
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / max(dot(b, b), 1e-9);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float p = ky - kx * kx, p3 = p * p * p;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p3;
  float res, tt;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    tt = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 qv = d + (c + b * tt) * tt;
    res = dot(qv, qv);
  } else {
    float z = sqrt(-p);
    float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
    float m = cos(v), n = sin(v) * 1.732050808;
    vec3 t3 = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    vec2 qx = d + (c + b * t3.x) * t3.x; float dx = dot(qx, qx);
    vec2 qy = d + (c + b * t3.y) * t3.y; float dy = dot(qy, qy);
    if (dx < dy) { res = dx; tt = t3.x; } else { res = dy; tt = t3.y; }
  }
  return vec2(sqrt(res), tt);
}
// a soft star: a filled five-pointed star with an anti-aliased edge and a glow, all fading to zero
vec3 softStar(vec2 p, vec2 c, float s, float rot, vec3 col, float k, float glow) {
  vec2 q = rot2(p - c, -rot);
  float r = length(q);
  if (r > s * 6.0 + 0.4) return vec3(0.0);
  float d = sdStar5(q, s, 0.42);
  float fill = 1.0 - smoothstep(-uPx, uPx, d);
  float halo = exp(-max(d, 0.0) / (0.35 * s)) * 0.6;
  vec3 o = mix(col, vec3(1.0), 0.45) * fill * k + col * halo * k * 0.6;
  o += col * glow * (exp(-r * r / (0.25 * s * s * 9.0)) * 0.7 + 0.25 * exp(-r / (1.2 * s)));
  return o;
}
void main() {
  vec2 p = vUv;
  vec3 col = vec3(0.0);
  // comets
  for (int i = 0; i < 4; i++) {
    float k = uCoK[i].x;
    if (k <= 0.0) continue;
    vec2 h = uCo[i].xy, tv = uCo[i].zw;
    float L2 = max(dot(tv, tv), 1e-8);
    float f = clamp(dot(p - h, tv) / L2, 0.0, 1.0);
    float d = length(p - h - tv * f);
    float w = uCoK[i].y * (1.1 - 0.7 * f) + uPx;
    float along = pow(1.0 - f, 1.6);
    vec3 c = mix(cHot, cTint, f);
    col += c * k * along * (exp(-d * d / (w * w)) + 0.15 * exp(-d / (3.0 * w)));
    float dh = length(p - h);
    col += cHot * k * 0.5 * exp(-dh * dh / (9.0 * w * w));
  }
  // the pulsar
  if (uPul.w > 0.0) {
    vec2 q = p - uPul.xy;
    float r = length(q);
    col += cHot * uPul.w * (exp(-r * r / 0.0004) * 1.6 + 0.15 * exp(-r / 0.03));
    vec2 dir = vec2(cos(uPul.z), sin(uPul.z));
    float al = dot(q, dir), ac = abs(dot(q, vec2(-dir.y, dir.x)));
    float f = clamp(abs(al) / 0.32, 0.0, 1.0);
    float w = 0.003 + uPx;
    col += cTint * uPul.w * (1.0 - f) * (1.0 - f) * (exp(-ac * ac / (w * w)) + 0.2 * exp(-ac / (4.0 * w))) * 0.9;
  }
  // the two streams and their stars
  for (int s = 0; s < 2; s++) {
    float k = uBB[s].z;
    if (k <= 0.0) continue;
    vec2 bz = sdBez(p, uBA[s].xy, uBA[s].zw, uBB[s].xy);
    float f = 1.0 - bz.y;          // 0 at the head
    float w = uBB[s].w * (1.1 - 0.5 * f) + uPx;
    float fl = 0.75 + 0.25 * sin(bz.y * 40.0 - uT * 9.0 + float(s) * 2.0);
    vec3 c = mix(cS[s], vec3(1.0), pow(1.0 - f, 4.0) * 0.8);
    float along = pow(1.0 - f, 1.4) * smoothstep(1.0, 0.85, f);
    col += c * k * along * fl * (exp(-bz.x * bz.x / (w * w)) + 0.18 * exp(-bz.x / (3.0 * w)));
    if (uHk[s].x > 0.0) col += softStar(p, uHd[s].xy, uHd[s].z, uHd[s].w, cS[s], uHk[s].x, uHk[s].y);
  }
  // the join: sparks bursting out, and the merged star
  if (uJ.w > 0.0) {
    vec2 q = p - uJ.xy; q.y /= 0.9;
    float age = uJ.z, r = length(q), th = atan(q.y, q.x);
    float N = 120.0, sec = th / 6.2831853 * N + 0.5 * N, sid = floor(sec), sf = fract(sec) - 0.5;
    float sp = 0.5 + 1.3 * hash11(sid * 1.7 + 2.0);
    float rr = sp * (1.0 - exp(-age * 2.6)) / 2.6;
    float off = (hash11(sid + 9.0) - 0.5) * 0.4;
    float ad = abs(sf - off) * 6.2831853 / N * r;
    float edgeD = (0.5 - abs(sf - off)) * 6.2831853 / N * r;
    float sw = 0.003 + 0.003 * hash11(sid + 4.0) + uPx;
    float tail = 0.01 + 0.05 * exp(-age * 2.0);
    float rad = smoothstep(rr - tail, rr, r) * exp(-max(r - rr, 0.0) * max(r - rr, 0.0) / (sw * sw));
    float kk = exp(-age * 1.3) * (0.4 + 1.2 * hash11(sid + 3.0));
    col += cJ * kk * exp(-ad * ad / (sw * sw)) * rad * smoothstep(sw, 2.5 * sw, edgeD) * 1.6;
    if (uJs.y > 0.0) col += softStar(p, uJ.xy, uJs.x, uJs.z, cJ, uJs.y, uJs.w);
  }
  if (uTOn > 0.0) {
    vec2 tu = (p - uTC) / uTS + 0.5;
    if (tu.x > 0.0 && tu.x < 1.0 && tu.y > 0.0 && tu.y < 1.0) {
      vec3 g = texture2D(uTx, tu).rgb;
      vec3 add = vec3(0.0);
      for (int i = 0; i < 4; i++) {
        vec4 w = uTW[i];
        if (w.w <= 0.0) continue;
        float pad = 0.03;
        float inW = smoothstep(w.x - pad, w.x, tu.x) * (1.0 - smoothstep(w.y, w.y + pad, tu.x));
        // written in light, left to right, with a hot edge
        float edge = mix(w.x - pad, w.y + pad, w.z);
        float rev = 1.0 - smoothstep(edge - 0.012, edge, tu.x);
        float spark = exp(-pow((tu.x - edge) / 0.01, 2.0)) * step(w.z, 0.999);
        vec3 core = mix(cTxt, vec3(1.0), 0.35 + 0.5 * uTH[i]);
        add += inW * w.w * (rev * (g.r * core * (1.3 + 0.9 * uTH[i]) + g.g * cTxtGlow * (0.55 + 0.5 * uTH[i]) + g.b * cTxtGlow * 0.25) + spark * (g.g + g.b) * vec3(1.0) * 1.2);
      }
      col += add * uTOn;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const ease = (x: number) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const bez = (a: V2, c: V2, b: V2, u: number): V2 => {
  const v = 1 - u;
  return [v * v * a[0] + 2 * v * u * c[0] + u * u * b[0], v * v * a[1] + 2 * v * u * c[1] + u * u * b[1]];
};

const TW = 2048, TH = 384;
interface TxtLine { tex: THREE.DataTexture; words: { x0: number; x1: number; start: number; end: number }[]; t0: number; t1: number }

/** a line of words set in Tilt Neon, as three channels: crisp, near glow, wide glow (borders left empty) */
function lineTexture(words: string[], font: string): { tex: THREE.DataTexture; xs: [number, number][] } {
  const size = 190, gap = size * 0.32;
  const mk = () => { const c = document.createElement('canvas'); c.width = TW; c.height = TH; return c.getContext('2d')!; };
  const m = mk();
  m.font = `${size}px "${font}"`;
  const ws = words.map((w) => m.measureText(w).width);
  const total = ws.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
  let x = (TW - total) / 2;
  const xs: [number, number][] = ws.map((w) => { const r: [number, number] = [x / TW, (x + w) / TW]; x += w + gap; return r; });
  const layer = (blur: number) => {
    const c = mk();
    c.font = `${size}px "${font}"`; c.textBaseline = 'middle'; c.fillStyle = '#fff';
    if (blur) c.filter = `blur(${blur}px)`;
    words.forEach((w, i) => c.fillText(w, xs[i]![0] * TW, TH * 0.52));
    return c.getImageData(0, 0, TW, TH).data;
  };
  const a = layer(0), b = layer(9), g = layer(30);
  const data = new Uint8Array(TW * TH * 4);
  for (let y = 0; y < TH; y++) for (let xx = 0; xx < TW; xx++) {
    const i = (y * TW + xx) * 4, o = ((TH - 1 - y) * TW + xx) * 4; // (flipped: row 0 at the bottom)
    data[o] = a[i + 3]!; data[o + 1] = b[i + 3]!; data[o + 2] = g[i + 3]!; data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, TW, TH, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, xs };
}

export class CosmosFx {
  private lines: TxtLine[] = [];
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  constructor(asp: number, hot: THREE.Color, tint: THREE.Color, private rate: number) {
    const v4 = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uPx: { value: 2 / 1080 }, uT: { value: 0 },
        uCo: { value: v4(4) }, uCoK: { value: v4(4) }, uPul: { value: new THREE.Vector4() },
        uBA: { value: v4(2) }, uBB: { value: v4(2) }, uHd: { value: v4(2) }, uHk: { value: v4(2) },
        cS: { value: [new THREE.Color(), new THREE.Color()] },
        uJ: { value: new THREE.Vector4() }, uJs: { value: new THREE.Vector4() },
        cJ: { value: new THREE.Color() }, cHot: { value: hot }, cTint: { value: tint },
        uTx: { value: null }, uTC: { value: new THREE.Vector2(0, -0.45) }, uTS: { value: new THREE.Vector2(2.3, 2.3 * TH / TW) }, uTOn: { value: 0 },
        uTW: { value: v4(4) }, uTH: { value: [0, 0, 0, 0] }, cTxt: { value: new THREE.Color('#BFF4FF') }, cTxtGlow: { value: new THREE.Color('#2FB8FF') },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * asp, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  /** comets on the chosen beats (screen space), and the pulsar at its projected point */
  update(t: number, hPx: number, beats: number[], t0: number, t1: number, beatPhase: number, pulsar: V2 | null) {
    const U = this.mat.uniforms;
    U.uPx!.value = 2 / hPx; U.uT!.value = t;
    const co = U.uCo!.value as THREE.Vector4[], ck = U.uCoK!.value as THREE.Vector4[];
    let n = 0;
    for (let i = 0; i < beats.length && n < 4; i++) {
      const tb = beats[i]!;
      if (tb > t) break;
      const age = t - tb;
      if (age > 1.0 || tb < t0 - 1 || tb > t1 || hash(i, 91) > this.rate) continue;
      const dir = hash(i, 92) > 0.5 ? 1 : -1, y0 = -0.35 + 1.3 * hash(i, 93), sl = (hash(i, 94) - 0.5) * 0.9;
      const e = 1 - Math.pow(1 - clamp(age / 0.9), 2.2);
      const fade = 1 - clamp((age - 0.6) / 0.4);
      const P = (ee: number): V2 => { const x = dir * (-2.2 + 4.4 * ee); return [x, y0 + sl * (x * dir)]; };
      const h = P(e), tl = P(Math.max(0, e - 0.22));
      co[n]!.set(h[0], h[1], tl[0] - h[0], tl[1] - h[1]);
      ck[n]!.set(2.0 * fade, 0.006, 0, 0);
      n++;
    }
    for (; n < 4; n++) ck[n]!.set(0, 0, 0, 0);
    const pu = U.uPul!.value as THREE.Vector4;
    if (pulsar && Math.abs(pulsar[0]) < 2.3 && Math.abs(pulsar[1]) < 1.4) pu.set(pulsar[0], pulsar[1], t * 0.9, Math.pow(1 - beatPhase, 3) + 0.15);
    else pu.w = 0;
  }

  /** begins a frame of joins: nothing drawn */
  begin() {
    const U = this.mat.uniforms;
    for (const v of U.uBB!.value as THREE.Vector4[]) v.z = 0;
    for (const v of U.uHk!.value as THREE.Vector4[]) v.x = 0;
    (U.uJ!.value as THREE.Vector4).w = 0;
  }

  /** "Take my hand": the streams closing in, then the join; returns the lights it adds to the sky */
  join(ev: Join, t: number, fx: Fx) {
    const U = this.mat.uniforms;
    const t0 = ev.t - ev.dur, tau = t - ev.t;
    if (t < t0 - 0.05 || tau > ev.keep + 0.8) return;
    if (tau < 0) {
      const e = ease((t - t0) / ev.dur);
      const trail = 0.62 * Math.min(1, e / 0.12 + 0.25);
      for (const side of [0, 1]) {
        const d = side ? ev.R : ev.L, c = side ? ev.cR : ev.cL;
        const u1 = e, u0 = Math.max(0, e - trail);
        const A = bez(d.S, d.C, ev.M, u0), Cc = bez(d.S, d.C, ev.M, u1);
        const du = u1 - u0;
        const dv: V2 = [2 * ((1 - u0) * (d.C[0] - d.S[0]) + u0 * (ev.M[0] - d.C[0])), 2 * ((1 - u0) * (d.C[1] - d.S[1]) + u0 * (ev.M[1] - d.C[1]))];
        // (nudged off the straight line: the closest-point solve is degenerate for a straight bezier)
        const B: V2 = [A[0] + dv[0] * du * 0.5 + 1e-4, A[1] + dv[1] * du * 0.5 - 1e-4];
        (U.uBA!.value as THREE.Vector4[])[side]!.set(A[0], A[1], B[0], B[1]);
        (U.uBB!.value as THREE.Vector4[])[side]!.set(Cc[0], Cc[1], du > 1e-3 ? 2.2 : 0, 0.007);
        (U.cS!.value as THREE.Color[])[side]!.copy(c);
        (U.uHd!.value as THREE.Vector4[])[side]!.set(Cc[0], Cc[1], 0.08, t * (side ? -1.3 : 1.3) + side);
        (U.uHk!.value as THREE.Vector4[])[side]!.set(2.0, 0.9, 0, 0);
      }
      fx.sun = [ev.M[0], ev.M[1], smoothstep(0.55, 1, e) * 0.35, 0.8];
      return;
    }
    const age = tau;
    const flash = Math.exp(-age * 7);
    fx.sun = [ev.M[0], ev.M[1], 0.35 * Math.exp(-age * 3) + 2.2 * flash + 0.25 * Math.max(0, 1 - age / ev.keep), 0.9 + age * 0.4];
    fx.shock = [ev.M[0], ev.M[1], age * 2.6, 1.3 * Math.exp(-age * 2.4)];
    const grow = 1 - Math.pow(1 - clamp(age / 0.35), 3);
    const fade = 1 - smoothstep(ev.keep - 0.5, ev.keep + 0.4, age);
    const big = (ev.size ?? 0.11) * 0.8;
    const sz = big * (0.35 + 0.65 * grow) * (1 + 0.8 * flash);
    (U.uJ!.value as THREE.Vector4).set(ev.M[0], ev.M[1] + 0.012 * age, age, 1);
    (U.uJs!.value as THREE.Vector4).set(sz, (1.6 + 1.4 * flash) * fade, age * 0.35, 1.2 * fade);
    (U.cJ!.value as THREE.Color).copy(ev.cJ);
  }

  /** the lines to write (each word lights as it is sung), set once fonts are loaded */
  setLines(ls: { words: { w: string; start: number; end: number }[] }[], font: string) {
    ls.forEach((l, i) => {
      const { tex, xs } = lineTexture(l.words.map((w) => w.w), font);
      const next = ls[i + 1];
      const end = l.words[l.words.length - 1]!.end;
      this.lines.push({ tex, words: l.words.map((w, j) => ({ x0: xs[j]![0], x1: xs[j]![1], start: w.start, end: w.end })), t0: l.words[0]!.start, t1: Math.min(end + 1.1, next ? next.words[0]!.start - 0.1 : 1e9) });
    });
  }
  textures() { return this.lines.map((l) => l.tex); }

  /** the line on screen at t */
  text(t: number, kick: number) {
    const U = this.mat.uniforms;
    const L = this.lines.find((l) => t > l.t0 - 0.1 && t < l.t1 + 0.4);
    U.uTOn!.value = 0;
    if (!L) return;
    U.uTx!.value = L.tex;
    U.uTOn!.value = 1 - smoothstep(L.t1, L.t1 + 0.4, t);
    const tw = U.uTW!.value as THREE.Vector4[], th = U.uTH!.value as number[];
    for (let i = 0; i < 4; i++) {
      const w = L.words[i];
      if (!w || t < w.start - 0.02) { tw[i]!.set(0, 0, 0, 0); th[i] = 0; continue; }
      const age = t - (w.start - 0.02);
      const sung = t < w.end + 0.05;
      th[i] = sung ? 1 : Math.exp(-(t - w.end - 0.05) / 0.35);
      tw[i]!.set(w.x0, w.x1, clamp(age / Math.min(0.22, Math.max(0.1, (w.end - w.start) * 0.6))), (0.9 + 0.25 * kick * th[i]!) * smoothstep(0, 0.06, age));
    }
  }

  dispose() { this.mat.dispose(); this.mesh.geometry.dispose(); for (const l of this.lines) l.tex.dispose(); }
}
