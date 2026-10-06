// The supernova of drop 1: an explosion that reads as one. Screen-space, additive, a pure function of its age:
//   -0.14..0 s  the star swells
//   0           a hard white core flash (core, glow over the whole frame, an anamorphic streak), gone in ~0.1 s
//   then        a crisp shock shell racing out (fast, then slowing), a sharp bright rim, limb-brightened and
//               filamentary behind the edge, turbulent gas inside; ejecta fingers poking past the shell with bright
//               heads; thin light-echo rings racing ahead; debris sparks flung out on straight streaks.
import * as THREE from 'three';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uC; uniform float uS, uA, uPx;
uniform vec3 cHot, cShell, cGas, cGas2;
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 17.0; a *= 0.5; } return s / 0.97; }
void main() {
  vec2 p = (vUv - uC) / uS;
  float r = length(p), th = atan(p.y, p.x);
  float a = uA, px = uPx / uS;
  vec3 col = vec3(0.0);
  float pre = smoothstep(-0.14, 0.0, a) * step(a, 0.0);
  col += cHot * exp(-r * r / (0.0005 + 0.002 * pre)) * (1.5 + 10.0 * pre);
  if (a >= 0.0) {
    float F = exp(-a / 0.05);
    col += cHot * F * (exp(-r * r / 0.003) * 30.0 + exp(-r / 0.12) * 3.0 + exp(-r / 0.7) * 0.45);
    col += cHot * F * exp(-abs(p.y) / (0.008 + px)) * exp(-abs(p.x) / 1.6) * 3.0;
    vec2 cs = vec2(cos(th), sin(th));
    float edgeN = vn(cs * 3.5 + 3.0) - 0.5 + 0.5 * (vn(cs * 9.0 + 11.0) - 0.5);
    float Rs = 0.95 * (1.0 - exp(-a / 0.5)) * (1.0 + 0.07 * edgeN);
    float inside = smoothstep(Rs + 1.5 * px, Rs - 1.5 * px, r);
    float d = max(Rs - r, 0.0);
    float decay = exp(-a / 2.4);
    // the shell: thin, limb-brightened, filamentary just behind the edge
    float thick = 0.012 + 0.03 * a;
    if (inside > 0.0) {
      float fil = pow(1.0 - abs(2.0 * vn(p * 11.0 + 7.0) - 1.0), 5.0) + 0.6 * pow(1.0 - abs(2.0 * vn(p * 27.0 + 3.0) - 1.0), 8.0);
      col += cShell * inside * exp(-d / thick) * (0.6 + 1.8 * fil) * decay * 1.2;
      // turbulent gas inside
      float gas = fbm(p * 4.5 + vec2(a * 0.25, -a * 0.2));
      col += mix(cGas, cGas2, smoothstep(0.35, 0.7, gas)) * inside * exp(-d / 0.22) * (0.04 + 0.7 * pow(gas, 3.0)) * decay;
    }
    // the rim: a sharp bright edge
    col += cHot * exp(-abs(r - Rs) / (1.1 * px + 0.0012)) * decay * 1.1;
    // ejecta fingers poking past the shell, with bright heads
    float N = 150.0, sec = th / 6.2831853 * N, sid = floor(sec), sf = fract(sec) - 0.5;
    if (hash11(sid * 1.31 + 4.0) > 0.8) {
      float Lk = Rs * (1.03 + 0.2 * hash11(sid + 2.0));
      float w = 0.003 + 0.005 * hash11(sid + 5.0);
      float ad = abs(sf) * 6.2831853 / N * r;
      float along = smoothstep(Rs * 0.75, Rs * 0.98, r) * smoothstep(Lk + px, Lk - 0.03, r);
      float tang = exp(-pow(ad / w, 2.0));
      col += cShell * tang * along * decay * 0.7;
      col += cHot * exp(-pow(ad / (w * 1.8), 2.0) - pow((r - Lk) / 0.014, 2.0)) * decay * 2.0;
    }
    // light echoes: thin faint rings racing ahead
    for (int k = 0; k < 2; k++) {
      float Re = a * (k == 0 ? 1.9 : 1.35) + 0.05;
      float w2 = 0.004 + 0.005 * a;
      col += cShell * exp(-pow((r - Re) / w2, 2.0)) * 0.32 * exp(-a / 1.4) * (0.55 + 0.45 * vn(cs * 8.0 + float(k) * 5.0));
    }
    // debris: sparks on straight streaks
    float M = 70.0, s2 = th / 6.2831853 * M, id2 = floor(s2), f2 = fract(s2) - 0.5;
    if (hash11(id2 + 17.0) > 0.3) {
      float v = 0.9 + 1.5 * hash11(id2 + 11.0);
      float rp = v * (1.0 - exp(-a / 0.8)) * 1.1;
      float off = (hash11(id2 + 13.0) - 0.5) * 0.6;
      float ad2 = abs(f2 - off) * 6.2831853 / M * r;
      float tail = 0.03 + 0.14 * exp(-a / 0.6);
      float streak = smoothstep(rp - tail, rp, r) * smoothstep(rp + 2.0 * px, rp - px, r);
      col += cHot * exp(-pow(ad2 / (1.4 * px + 0.0008), 2.0)) * streak * exp(-a / 1.6) * 2.2;
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class NovaFx {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  constructor(asp: number, cols: { hot: THREE.Color; shell: THREE.Color; gas: THREE.Color; gas2: THREE.Color }) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uC: { value: new THREE.Vector2() }, uS: { value: 1 }, uA: { value: -1 }, uPx: { value: 2 / 1080 },
        cHot: { value: cols.hot }, cShell: { value: cols.shell }, cGas: { value: cols.gas }, cGas2: { value: cols.gas2 },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * asp, 2), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 30;
    this.mesh.visible = false;
  }
  /** centre (ndc: x ±asp, y ±1), scale (ndc units of the final shell radius), age (s), output height in px */
  update(c: [number, number], s: number, age: number, hPx: number) {
    const on = age > -0.16 && age < 6;
    this.mesh.visible = on;
    if (!on) return;
    const U = this.mat.uniforms;
    (U.uC!.value as THREE.Vector2).set(c[0], c[1]);
    U.uS!.value = s; U.uA!.value = age; U.uPx!.value = 2 / hPx;
  }
  dispose() { this.mat.dispose(); this.mesh.geometry.dispose(); }
}
