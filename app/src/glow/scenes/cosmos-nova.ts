// The supernova of drop 1: an explosion that reads as one. Screen-space, additive, a pure function of its age:
//   -0.14..0 s  the star swells
//   0           a hard white core flash (core, glow over the whole frame, an anamorphic streak), gone in ~0.1 s
//   then        a soft, uneven shell of gas racing out (fast, then slowing), limb-brightened and filamentary,
//               turbulent gas inside, a faint wide glow ahead; everything fades to zero smoothly (no hard rim,
//               no thin rings, no streaks: over the galaxy they read as a picture or a dial pasted on the sky).
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
    col += cHot * F * exp(-abs(p.y) / (0.008 + px)) * exp(-abs(p.x) / 0.7) * 2.5;
    vec2 cs = vec2(cos(th), sin(th));
    // (all soft: a hard rim, cell-noise filaments and pin-like fingers read as a picture pasted over the sky)
    float edgeN = fbm(cs * 2.2 + 3.0) - 0.5;
    float Rs = 0.95 * (1.0 - exp(-a / 0.5)) * (1.0 + 0.2 * edgeN);
    float life = exp(-a / 1.0) * (1.0 - smoothstep(1.8, 3.0, a));
    float w = 0.025 + 0.09 * Rs;
    float inside = smoothstep(Rs + 0.6 * w, Rs - 0.8 * w, r);
    // the shell: a soft limb-brightened band of gas, filamentary
    float fil = fbm(p * 5.0 + vec2(0.3 * a, -0.2 * a));
    float rid = pow(1.0 - abs(2.0 * fbm(p * 9.0 + 7.0 + 0.2 * a) - 1.0), 3.0);
    float band = exp(-pow((r - Rs + 0.35 * w) / w, 2.0));
    col += cShell * band * (0.35 + 1.4 * rid * fil) * (0.6 + 0.6 * smoothstep(-0.6, 0.8, cs.x + 0.4 * cs.y)) * life * 1.3;
    col += cHot * exp(-pow((r - Rs + 0.1 * w) / (0.35 * w), 2.0)) * (0.3 + 0.7 * fil) * life * 0.55;
    // turbulent gas inside
    float gas = fbm(p * 3.2 + vec2(a * 0.25, -a * 0.2));
    col += mix(cGas, cGas2, smoothstep(0.35, 0.7, gas)) * inside * (0.05 + 0.8 * pow(gas, 3.0)) * smoothstep(0.0, Rs, r + 0.2 * Rs) * life;
    // a faint wide glow racing ahead (no thin rings, no radial debris streaks: they read as a dial drawn over the sky)
    float Re = a * 1.6 + 0.05, w2 = 0.05 + 0.12 * a;
    col += cShell * exp(-pow((r - Re) / w2, 2.0)) * 0.12 * exp(-a / 0.8) * (0.4 + 0.6 * fbm(cs * 2.5 + p * 2.0));
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
    const on = age > -0.16 && age < 3.2;
    this.mesh.visible = on;
    if (!on) return;
    const U = this.mat.uniforms;
    (U.uC!.value as THREE.Vector2).set(c[0], c[1]);
    U.uS!.value = s; U.uA!.value = age; U.uPx!.value = 2 / hPx;
  }
  dispose() { this.mat.dispose(); this.mesh.geometry.dispose(); }
}
