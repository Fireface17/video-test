// Highway scene, the car from the inside (the mirror shot and the last shot): the windscreen with rain and
// two wipers, the A-pillars and roof lining, the dashboard, the instrument cluster (dim: the glow on the dash
// is his, not theirs), the steering wheel with HIS hands on it — a man of light (lib/people RealFigure,
// glowBodyMaterial, cyan; only the forearms and hands are ever in frame) — the rear-view mirror that shows the
// city behind going dark, the dash-top radio display, the passenger seat with a phone on 0%, and the bonnet.
//
// Car space: the driver's eye at the origin, x right, y up, -z forward (the car is axis-aligned with the road,
// so world = car space + the eye's world position).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { F, font } from '../../engine/type';
import { clamp } from '../../engine/util';
import { RealFigure, glowBodyMaterial, loadBody } from '../lib/people';
import { boxAt, merge, rod } from './highway-common';
import { canvasTex } from './highway-tex';
import { LedRow, glyphIndex, ledGlyphs } from './highway-station';
import { Hood } from './highway-props';
import type { SkyU } from './highway-env';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const DEG = Math.PI / 180;

/** Cabin light rig (shared by every cabin material). World space. */
export const CU = {
  cHandA: { value: new THREE.Vector3(0, -100, 0) },
  cHandB: { value: new THREE.Vector3(0, -100, 0) },
  cHandCol: { value: new THREE.Color(0, 0, 0) },
  cAmb: { value: new THREE.Color(0, 0, 0) },
  cFrontCol: { value: new THREE.Color(0, 0, 0) },
  cFrontDir: { value: new THREE.Vector3(0, 0.3, -1).normalize() },
  cTopCol: { value: new THREE.Color(0, 0, 0) },
  cTopDir: { value: new THREE.Vector3(0, 1, 0) },
  cDash: { value: new THREE.Color(0, 0, 0) }, // the instruments' own faint glow (on the wheel and the dash hood)
  cDashPos: { value: new THREE.Vector3() },
};

const CAB_GLSL = /* glsl */ `
uniform vec3 cHandA, cHandB, cHandCol, cAmb, cFrontCol, cFrontDir, cTopCol, cTopDir, cDash, cDashPos;
vec3 cabPoint(vec3 P, vec3 N, vec3 L0, vec3 col, float r0) {
  vec3 L = L0 - P; float d2 = dot(L, L); vec3 l = L * inversesqrt(max(d2, 1e-6));
  float ndl = dot(N, l);
  // wrapped diffuse: a soft light that creeps round the edges of things
  return col * (max(ndl, 0.0) * 0.8 + 0.2 * max(ndl + 0.5, 0.0)) / (d2 / (r0 * r0) + 1.0);
}
vec3 cabLight(vec3 P, vec3 N, vec3 V, float shine, out vec3 spec) {
  vec3 c = cAmb * (0.55 + 0.45 * N.y);
  c += cabPoint(P, N, cHandA, cHandCol, 0.24) + cabPoint(P, N, cHandB, cHandCol, 0.24);
  c += cabPoint(P, N, cDashPos, cDash, 0.12);
  c += cFrontCol * max(dot(N, cFrontDir), 0.0) + cTopCol * max(dot(N, cTopDir), 0.0);
  spec = vec3(0.0);
  if (shine > 0.0) {
    for (int i = 0; i < 2; i++) {
      vec3 Hp = i == 0 ? cHandA : cHandB;
      vec3 L = Hp - P; float d2 = dot(L, L); vec3 l = L * inversesqrt(max(d2, 1e-6));
      vec3 h = l + V; h *= inversesqrt(max(dot(h, h), 1e-8));
      spec += cHandCol * pow(max(dot(N, h), 0.0), 30.0) * shine / (d2 / 0.06 + 1.0);
    }
    vec3 h2 = cTopDir + V; h2 *= inversesqrt(max(dot(h2, h2), 1e-8));
    spec += cTopCol * pow(max(dot(N, h2), 0.0), 24.0) * shine * 2.0;
  }
  return c;
}`;

/** Cabin surface material: albedo × the cabin rig, optional emissive (uniform `emis`). */
export function cabMat(color: THREE.Color, shine = 0.3, opts: { side?: THREE.Side; emis?: THREE.Color; map?: THREE.Texture } = {}) {
  return new THREE.ShaderMaterial({
    side: opts.side ?? THREE.FrontSide,
    defines: opts.map ? { USE_M: '' } : {},
    uniforms: { ...CU, alb: { value: color.clone() }, shine: { value: shine }, emis: { value: (opts.emis ?? new THREE.Color(0, 0, 0)).clone() }, map: { value: opts.map ?? null } },
    vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: CAB_GLSL + /* glsl */ `
      uniform vec3 alb, emis; uniform float shine; uniform sampler2D map;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        vec3 V = normalize(cameraPosition - vW);
        vec3 spec; vec3 d = cabLight(vW, N, V, shine, spec);
        vec3 a = alb;
        #ifdef USE_M
        a *= texture2D(map, vUv).rgb;
        #endif
        gl_FragColor = vec4(a * d + spec + emis, 1.0);
      }`,
  });
}

// ------------------------------------------------------------------------------------------- the windscreen

const GL_BL = new THREE.Vector3(-0.47, -0.235, -0.86);
const GL_BR = new THREE.Vector3(1.21, -0.235, -0.86);
const GL_TL = new THREE.Vector3(-0.42, 0.215, -0.4);
const GL_TR = new THREE.Vector3(1.16, 0.215, -0.4);
const GLASS_W = GL_BR.distanceTo(GL_BL), GLASS_H = GL_TL.distanceTo(GL_BL);
/** Wiper pivots (glass 2D coordinates, metres from the bottom-left corner), blade lengths, rest angle, sweep. */
export const WIPER = { pivots: [[0.33, 0.035], [1.0, 0.035]] as [number, number][], len: [0.66, 0.58], a0: 0.07, amp: 1.72, dur: 0.66 };

const RAIN_FRAG = /* glsl */ `
uniform float uT, uTau, uW0, uW1, uDur, uFill, uSpeed, uRain;
uniform vec3 uDropLight, uDropSpec;
uniform vec2 uPiv0, uPiv1; uniform vec2 uLen;
varying vec2 vG; // glass coords (m)
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// the last time (s) a blade swept the point, or -1e4
float lastWipe(vec2 g, vec2 piv, float len) {
  vec2 d = g - piv; float r = length(d);
  if (r > len || r < 0.06) return -1e4;
  float phi = atan(d.y, d.x);
  float sg = (phi - ${WIPER.a0.toFixed(3)}) / ${WIPER.amp.toFixed(3)};
  if (sg < 0.0 || sg > 1.0) return -1e4;
  float u1 = acos(clamp(1.0 - 2.0 * sg, -1.0, 1.0)) / 6.2831853, u2 = 1.0 - u1;
  // current sweep (started uW1) and the previous (uW0); compare in wiper time uTau
  float last = -1e4;
  if (uTau >= uW1 + u1 * uDur) last = uW1 + u1 * uDur;
  if (uTau >= uW1 + u2 * uDur) last = uW1 + u2 * uDur;
  if (last < -1e3) last = uW0 + u2 * uDur;
  return last;
}
void main() {
  vec2 g = vG;
  float lw = max(lastWipe(g, uPiv0, uLen.x), lastWipe(g, uPiv1, uLen.y));
  float since = uT - lw;
  vec3 col = vec3(0.0); float al = 0.0;
  // two layers of drops (fine and coarse)
  for (int L = 0; L < 2; L++) {
    float cs = L == 0 ? 0.0085 : 0.019;
    vec2 q = g / cs;
    vec2 id = floor(q);
    float hA = h2(id + float(L) * 17.0), hB = h2(id + 3.1 + float(L) * 5.0), hC = h2(id + 9.7);
    if (hA > uRain * (L == 0 ? 0.85 : 0.55)) continue;
    // arrival: drops land at a steady rate after the wipe
    float arr = hB * uFill;
    if (since < arr) continue;
    float age = since - arr;
    vec2 c = (id + 0.5 + (vec2(hB, hC) - 0.5) * 0.5) * cs;
    // the wind of the drive pushes the bigger drops up the glass
    c.y += min(age, 3.0) * uSpeed * 0.0006 * float(L) * hC;
    float r = cs * (L == 0 ? 0.16 + 0.18 * hC : 0.14 + 0.2 * hC);
    vec2 d = g - c;
    float dd = length(d);
    float a = smoothstep(r, r * 0.8, dd) * smoothstep(0.0, 0.05, age);
    if (a <= 0.0) continue;
    // a drop is a tiny lens: dark rim, the light from above gathered at its bottom, a glint
    vec2 n = d / r;
    float lens = smoothstep(0.2, 0.95, -n.y) * 0.9 + 0.12;
    float glint = smoothstep(0.42, 0.12, length(n - vec2(-0.3, 0.35)));
    vec3 cc = uDropLight * lens + uDropSpec * glint;
    col = col * (1.0 - a) + cc * a;
    al = al + a * (1.0 - al);
  }
  // fine mist that the wipers clear, and a faint film everywhere
  float mist = clamp(since / 3.0, 0.0, 1.0) * 0.12 * uRain;
  col += uDropLight * 0.15 * mist;
  al = max(al * 0.85, mist * 0.6);
  gl_FragColor = vec4(col, al);
}`;

export interface CabinState {
  t: number;
  /** wiper time (= t until the engine stalls, then frozen) and the two last sweep starts */
  tau: number; w0: number; w1: number;
  speed: number;
  dash: number; // instruments' power 0..1
  kmh: number; rpm: number; fuel: number;
  radio: number; phone: number;
  hand: number; // his glow 0..1
  dropLight: THREE.Color; dropSpec: THREE.Color;
  grip: number; // 0..1 squeeze on the beat
}

export class Cabin extends THREE.Group {
  fig!: RealFigure;
  glassU: Record<string, THREE.IUniform>;
  wipers: THREE.Group[] = [];
  mirror = new THREE.Group();
  mirrorU: Record<string, THREE.IUniform>;
  wheel = new THREE.Group();
  wheelC = new THREE.Vector3(0, -0.33, -0.47);
  wheelR = 0.185;
  wheelTilt = 24 * DEG;
  needles: { m: THREE.Object3D; a0: number; a1: number }[] = [];
  dialMat!: THREE.MeshBasicMaterial;
  radio: LedRow[] = [];
  phoneMat!: THREE.MeshBasicMaterial;
  phoneLight!: THREE.Mesh;
  hood: Hood;
  glassToCar = new THREE.Matrix4();
  private hidden: THREE.Object3D[] = [];

  constructor(mirrorTex: THREE.Texture, skyU: SkyU) {
    super();
    // ---- windscreen glass (rain) in its own plane
    this.glassU = {
      uT: { value: 0 }, uTau: { value: 0 }, uW0: { value: -10 }, uW1: { value: -9 }, uDur: { value: WIPER.dur }, uFill: { value: 1.1 }, uSpeed: { value: 30 }, uRain: { value: 1 },
      uDropLight: { value: new THREE.Color() }, uDropSpec: { value: new THREE.Color() },
      uPiv0: { value: new THREE.Vector2(...WIPER.pivots[0]!) }, uPiv1: { value: new THREE.Vector2(...WIPER.pivots[1]!) }, uLen: { value: new THREE.Vector2(WIPER.len[0], WIPER.len[1]) },
    };
    const gg = new THREE.BufferGeometry();
    const gp = [GL_BL, GL_BR, GL_TR, GL_TL];
    gg.setAttribute('position', new THREE.Float32BufferAttribute(gp.flatMap((v) => [v.x, v.y, v.z]), 3));
    gg.setAttribute('gl', new THREE.Float32BufferAttribute([0, 0, GLASS_W, 0, GLASS_W, GLASS_H, 0, GLASS_H], 2));
    gg.setIndex([0, 1, 2, 0, 2, 3]);
    const glass = new THREE.Mesh(gg, new THREE.ShaderMaterial({
      uniforms: this.glassU, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */ `attribute vec2 gl; varying vec2 vG; void main(){ vG = gl; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: RAIN_FRAG.replace('gl_FragColor = vec4(col, al);', 'gl_FragColor = vec4(col * al, al);'),
    }));
    glass.renderOrder = 30;
    glass.frustumCulled = false;
    this.add(glass);
    // glass 2D → car space
    const ex = GL_BR.clone().sub(GL_BL).normalize(), ey = GL_TL.clone().sub(GL_BL).normalize();
    const ez = new THREE.Vector3().crossVectors(ex, ey).normalize();
    this.glassToCar.makeBasis(ex, ey, ez).setPosition(GL_BL);

    // ---- wipers: an arm and a blade, rotating about pivots in the glass plane (just inside it, dark)
    const wiperMat = cabMat(C('#0b0c0e'), 0.2);
    WIPER.pivots.forEach(([px, py], i) => {
      const pivot = new THREE.Group();
      const L = WIPER.len[i]!;
      const arm = new THREE.Mesh(merge([boxAt(L * 0.55, 0.012, 0.012, L * 0.3, 0, -0.016), boxAt(0.035, 0.035, 0.03, 0, 0, -0.016)]), wiperMat);
      const blade = new THREE.Mesh(boxAt(L * 0.82, 0.018, 0.016, L * 0.58, 0.004, -0.01), wiperMat);
      pivot.add(arm, blade);
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(this.glassToCar).multiply(new THREE.Matrix4().makeTranslation(px, py, -0.004));
      holder.add(pivot);
      this.add(holder);
      this.wipers.push(pivot);
    });

    // ---- body: roof lining, A-pillars, dashboard, binnacle, centre stack, doors, seats
    const plastic = cabMat(C('#3a3d44'), 0.04);
    const soft = cabMat(C('#2a2c31'), 0.02);
    const trim = cabMat(C('#1c1d21'), 0.08);
    const roof = new THREE.Mesh(merge([
      boxAt(2.0, 0.04, 1.4, 0.37, 0.28, 0.1),
      rod(GL_TL.clone().add(new THREE.Vector3(-0.02, 0.03, 0)), GL_TR.clone().add(new THREE.Vector3(0.02, 0.03, 0)), 0.05, 0.05, 6),
    ]), trim);
    const pillars = new THREE.Mesh(merge([
      rod(GL_BL.clone().add(new THREE.Vector3(-0.03, -0.02, 0)), GL_TL.clone().add(new THREE.Vector3(-0.03, 0.04, 0.02)), 0.055, 0.045, 8),
      rod(GL_BR.clone().add(new THREE.Vector3(0.03, -0.02, 0)), GL_TR.clone().add(new THREE.Vector3(0.03, 0.04, 0.02)), 0.055, 0.045, 8),
    ]), trim);
    // the dash: a soft top under the glass, a rounded front edge, the face falling to the footwell
    const dash = new THREE.Mesh(merge([
      new RoundedBoxGeometry(2.0, 0.07, 0.46, 3, 0.03).rotateX(-0.06).translate(0.37, -0.262, -0.68),
      new RoundedBoxGeometry(2.0, 0.34, 0.1, 3, 0.04).rotateX(0.22).translate(0.37, -0.44, -0.47),
    ]), soft);
    // instrument binnacle: a visor over the cluster, with cheeks
    const binn = new THREE.Mesh(merge([
      new RoundedBoxGeometry(0.52, 0.03, 0.15, 3, 0.012).rotateX(-0.12).translate(0, -0.152, -0.68),
      boxAt(0.02, 0.09, 0.14, -0.25, -0.2, -0.68), boxAt(0.02, 0.09, 0.14, 0.25, -0.2, -0.68),
      boxAt(0.5, 0.12, 0.02, 0, -0.235, -0.735), // the cluster's back panel
    ]), plastic);
    // centre stack with two vents and the gear selector on the console
    const stack = new THREE.Mesh(merge([
      boxAt(0.32, 0.36, 0.08, 0.42, -0.48, -0.5, 0, 0, 0.18),
      boxAt(0.26, 0.12, 0.6, 0.42, -0.62, -0.12),
      new THREE.CylinderGeometry(0.018, 0.022, 0.1, 10).translate(0.42, -0.52, -0.18),
      new THREE.SphereGeometry(0.03, 12, 8).translate(0.42, -0.46, -0.18),
    ]), plastic);
    const vents = new THREE.Mesh(merge([boxAt(0.11, 0.05, 0.012, 0.35, -0.33, -0.535, 0, 0, 0.18), boxAt(0.11, 0.05, 0.012, 0.49, -0.33, -0.535, 0, 0, 0.18), boxAt(0.12, 0.05, 0.012, -0.36, -0.29, -0.585, 0.2, 0, 0.1)]), trim);
    // the passenger seat (cushion, back, headrest) and the door panels
    const seatMat = cabMat(C('#3a3c44'), 0.02);
    const seat = new THREE.Mesh(merge([
      new RoundedBoxGeometry(0.52, 0.13, 0.56, 3, 0.05).translate(0.76, -0.66, -0.1),
      new RoundedBoxGeometry(0.52, 0.66, 0.13, 3, 0.05).rotateX(-0.22).translate(0.76, -0.32, 0.25),
      new RoundedBoxGeometry(0.28, 0.2, 0.1, 3, 0.04).translate(0.76, 0.1, 0.32),
    ]), seatMat);
    const doors = new THREE.Mesh(merge([boxAt(0.06, 0.4, 1.2, -0.62, -0.45, -0.1), boxAt(0.06, 0.4, 1.2, 1.36, -0.45, -0.1)]), soft);
    this.add(roof, pillars, dash, binn, stack, vents, seat, doors);

    // ---- the instrument cluster: two dials with dim backlit graphics and orange needles, facing his eyes
    const dialTex = canvasTex(dialCanvas(), { aniso: 8 });
    this.dialMat = new THREE.MeshBasicMaterial({ map: dialTex, color: C('#ffffff', 0.3) });
    for (const [x, kind] of [[-0.11, 0], [0.11, 1]] as const) {
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.068, 48), this.dialMat);
      const uvs = d.geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let i = 0; i < uvs.count; i++) uvs.setX(i, uvs.getX(i) * 0.5 + 0.5 * kind);
      d.position.set(x, -0.232, -0.725);
      d.rotation.x = -0.3;
      this.add(d);
      const needle = new THREE.Mesh(boxAt(0.058, 0.0035, 0.002, 0.024, 0, 0.002), new THREE.MeshBasicMaterial({ color: C('#ff5a1e', 1.6) }));
      const piv = new THREE.Group();
      piv.position.copy(d.position).add(new THREE.Vector3(0, 0.001, 0.003));
      piv.rotation.x = -0.3;
      piv.add(needle);
      this.add(piv);
      this.needles.push({ m: needle, a0: 225 * DEG, a1: -45 * DEG });
    }

    // ---- the dash-top display: radio (amber dot matrix, two rows)
    const disp = new THREE.Group();
    const frame = new THREE.Mesh(new RoundedBoxGeometry(0.21, 0.09, 0.02, 3, 0.008), trim);
    disp.add(frame);
    for (let i = 0; i < 2; i++) {
      const r = new LedRow(10, 0.018, C('#ffb347', 1.6), ledGlyphs());
      r.position.set(0, 0.016 - i * 0.03, 0.0105);
      r.scale.setScalar(1);
      disp.add(r);
      this.radio.push(r);
    }
    this.radio[0]!.setText('FM 101.7  ');
    disp.position.set(0.42, -0.19, -0.68);
    disp.rotation.x = -0.25;
    disp.rotation.y = -0.22;
    this.add(disp);

    // ---- the phone on the passenger seat: 0%, the empty battery blinking
    const ph = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.009, 0.155, 3, 0.004), cabMat(C('#111216'), 0.6));
    this.phoneMat = new THREE.MeshBasicMaterial({ map: canvasTex(phoneCanvas()), color: C('#ffffff', 0.9) });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.146), this.phoneMat);
    scr.rotation.x = -Math.PI / 2;
    scr.position.y = 0.0048;
    // the screen's light on the seat
    this.phoneLight = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.4), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { k: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float k; varying vec2 vUv; void main(){ vec2 p = (vUv - 0.5) * vec2(1.0, 1.15); float a = exp(-dot(p, p) * 22.0); gl_FragColor = vec4(vec3(0.9, 0.25, 0.2) * a * k, 1.0); }`,
    }));
    this.phoneLight.rotation.x = -Math.PI / 2;
    this.phoneLight.position.y = -0.002;
    ph.add(body, scr, this.phoneLight);
    ph.position.set(0.85, -0.587, -0.28);
    ph.rotation.set(0.0, 0.62, 0.0);
    this.add(ph);

    // ---- the rear-view mirror (housing, stem, glass showing the view behind, flipped)
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.085, 0.045, 4, 0.028), trim);
    housing.position.z = -0.02;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.12, 8), trim);
    stem.position.set(0, 0.075, -0.03);
    this.mirrorU = { tex: { value: mirrorTex }, k: { value: 1 }, sweep: { value: 0 } };
    const mg = new THREE.Mesh(new THREE.PlaneGeometry(0.245, 0.066), new THREE.ShaderMaterial({
      uniforms: this.mirrorU,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform sampler2D tex; uniform float k, sweep; varying vec2 vUv;
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          vec2 q = abs(p) - vec2(0.9, 0.62);
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.34;
          if (d > 0.0) discard;
          vec2 uv = vec2(1.0 - vUv.x, vUv.y);
          uv = (uv - 0.5) * vec2(0.94, 0.92) + 0.5;
          vec3 c = texture2D(tex, uv).rgb * 0.85 * k;
          float bev = smoothstep(-0.06, 0.0, d);
          c += vec3(0.25, 0.27, 0.3) * bev * (0.08 + 0.3 * exp(-pow(p.x - (sweep * 3.0 - 1.5), 2.0) * 6.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    mg.position.z = 0.004;
    this.mirror.add(housing, stem, mg);
    this.mirror.position.set(0.35, 0.08, -0.465);
    this.mirror.rotation.set(0.06, -0.33, 0.012, 'YXZ');
    this.add(this.mirror);

    // ---- the bonnet, seen through the glass
    this.hood = new Hood(skyU);
    this.hood.position.x = 0.37;
    this.add(this.hood);
  }

  /** Load his body, measure it, and build the wheel where his hands rest on it naturally. */
  async loadFigure() {
    const gltf = await loadBody('rpm');
    const cyan = C('#5fd8ff', 1.0);
    const fig = new RealFigure(gltf, 'rpm', cyan, glowBodyMaterial(cyan.clone().lerp(C('#ffffff'), 0.15)));
    // the head is never in frame (the camera is his eyes): hide it, and its depth twins
    const hideGeo = new Set<THREE.BufferGeometry>();
    for (const m of fig.meshes) if (/Head|Eye|Teeth|Beard|Hair/.test(m.name)) { m.visible = false; hideGeo.add(m.geometry); }
    fig.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && hideGeo.has(m.geometry)) { m.visible = false; this.hidden.push(m); } });
    fig.rotation.y = Math.PI; // facing -z
    fig.setSpine(-0.05, 0, 0.1, 0);
    fig.setLeg(0, new THREE.Vector3(0.08, -0.15, 1).normalize(), new THREE.Vector3(0.02, -1, 0.3).normalize());
    fig.setLeg(1, new THREE.Vector3(-0.08, -0.15, 1).normalize(), new THREE.Vector3(-0.02, -1, 0.3).normalize());
    this.add(fig);
    this.updateMatrixWorld(true);
    // put his eyes at the origin
    const hp = this.worldToLocal(fig.headPoint(new THREE.Vector3()));
    fig.position.sub(hp).add(new THREE.Vector3(0, -0.02, 0.06));
    this.updateMatrixWorld(true);
    this.fig = fig;
    this.buildWheel();
  }

  private buildWheel() {
    // place the wheel so that his hands at ten and two hold it with the elbows a little bent
    const fig = this.fig;
    fig.updateMatrixWorld(true);
    const sh = this.worldToLocal(fig.bone('RightArm').getWorldPosition(new THREE.Vector3()));
    const arm = fig.upper + fig.fore;
    let best = -0.4, err = 1e9;
    for (let z = -0.28; z > -0.62; z -= 0.005) {
      this.wheelC.set(0, -0.3, z);
      const g = this.rimPoint(30 * DEG);
      const e = Math.abs(g.distanceTo(sh) - 0.86 * arm);
      if (e < err) { err = e; best = z; }
    }
    this.wheelC.set(0, -0.3, best);
    const g = this.wheel;
    const R = this.wheelR;
    const leather = cabMat(C('#4a4c52'), 0.5);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.017, 12, 64), leather);
    const spokes = new THREE.Mesh(merge([
      boxAt(R * 1.7, 0.035, 0.024, 0, -0.012, 0.004),
      boxAt(0.05, R * 0.9, 0.024, 0, -R * 0.5, 0.004),
      new RoundedBoxGeometry(0.15, 0.11, 0.05, 3, 0.02).translate(0, -0.01, 0.014),
    ]), leather);
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 12).rotateX(Math.PI / 2).translate(0, 0, -0.16), cabMat(C('#1c1d21'), 0.1));
    g.add(rim, spokes, column);
    g.position.copy(this.wheelC);
    g.rotation.x = this.wheelTilt; // the top of the rim away from him
    this.add(g);
  }

  /** Rim point at clock angle (radians from +x, CCW, in the wheel's plane), car space. */
  rimPoint(a: number, out = new THREE.Vector3()) {
    out.set(Math.cos(a) * this.wheelR, Math.sin(a) * this.wheelR, 0.02);
    out.applyEuler(new THREE.Euler(this.wheelTilt, 0, 0));
    return out.add(this.wheelC);
  }

  update(s: CabinState) {
    const t = s.t;
    // ---- wipers
    WIPER.pivots.forEach((_, i) => {
      const u = (s.tau - s.w1) / WIPER.dur;
      const k = u >= 0 && u <= 1 ? 0.5 - 0.5 * Math.cos(2 * Math.PI * u) : 0;
      this.wipers[i]!.rotation.z = WIPER.a0 + WIPER.amp * k;
    });
    const gu = this.glassU;
    gu.uT!.value = t; gu.uTau!.value = s.tau; gu.uW0!.value = s.w0; gu.uW1!.value = s.w1; gu.uSpeed!.value = s.speed;
    gu.uDropLight!.value.copy(s.dropLight); gu.uDropSpec!.value.copy(s.dropSpec);
    // ---- instruments
    this.dialMat.color.copy(C('#ffffff', 0.32 * s.dash));
    const nd = [s.kmh / 240, s.rpm / 8000];
    this.needles.forEach((n, i) => {
      const parent = n.m.parent!;
      parent.rotation.z = n.a0 + (n.a1 - n.a0) * clamp(nd[i]!, 0, 1);
      (n.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.color.copy(C('#ff5a1e', 1.6 * Math.max(0.12, s.dash)));
    });
    CU.cDash.value.copy(C('#b8d4ff', 0.05 * s.dash));
    CU.cDashPos.value.set(0, -0.27, -0.58).applyMatrix4(this.matrixWorld);
    // ---- radio: the station and a scrolling line
    const msg = '   NIGHT RADIO 101.7   03.14   ';
    const off = Math.floor(t * 6);
    const r2 = this.radio[1]!;
    for (let i = 0; i < 10; i++) r2.pos[i] = glyphIndex(msg[(off + i) % msg.length]!);
    for (const r of this.radio) { r.on.fill(1); r.material.uniforms.k!.value = s.radio; }
    // ---- phone: the empty battery blinks
    const blink = ((t % 1.6) < 0.8 ? 1 : 0.18) * s.phone;
    this.phoneMat.color.copy(C('#ffffff', 0.85 * blink));
    (this.phoneLight.material as THREE.ShaderMaterial).uniforms.k!.value = 0.14 * blink;
    // ---- his hands on the wheel (2-bone IK every frame: the car moves), a squeeze on the beat
    const fig = this.fig;
    if (fig) {
      fig.time = t;
      fig.mat.uniforms.level!.value = s.hand;
      const L = this.localToWorld(this.rimPoint(150 * DEG)), R = this.localToWorld(this.rimPoint(30 * DEG));
      fig.reach(1, L, new THREE.Vector3(0.7, -0.6, -0.3));
      fig.reach(0, R, new THREE.Vector3(-0.7, -0.6, -0.3));
      fig.setHand(0, 0.62 + 0.12 * s.grip);
      fig.setHand(1, 0.62 + 0.08 * s.grip);
      fig.updateMatrixWorld(true);
      CU.cHandA.value.copy(fig.hand(0));
      CU.cHandB.value.copy(fig.hand(1));
      CU.cHandCol.value.copy(C('#5fd8ff', 1.3 * s.hand));
    }
  }
}

function dialCanvas() {
  const W = 1024, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  for (let k = 0; k < 2; k++) {
    const cx = 256 + k * 512, cy = 256, R = 240;
    const n = k === 0 ? 12 : 8;
    for (let i = 0; i <= n * 4; i++) {
      const a = (225 - (270 * i) / (n * 4)) * DEG;
      const major = i % 4 === 0;
      const r0 = major ? R * 0.78 : R * 0.86;
      c.strokeStyle = k === 1 && i > n * 4 * 0.78 ? '#ff4a3a' : '#dfeaff';
      c.lineWidth = major ? 7 : 3;
      c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy - Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * R * 0.93, cy - Math.sin(a) * R * 0.93); c.stroke();
      if (major) {
        c.fillStyle = '#dfeaff';
        c.font = font(F.archivo(100, 600), 34);
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(String(k === 0 ? (i / 4) * 20 : i / 4), cx + Math.cos(a) * R * 0.6, cy - Math.sin(a) * R * 0.6);
      }
    }
    c.font = font(F.archivo(100, 500), 26);
    c.fillText(k === 0 ? 'km/h' : 'x1000 rpm', cx, cy + R * 0.42);
  }
  return cv;
}

function phoneCanvas() {
  const W = 256, H = 550;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  // an empty battery, outlined in red, and 0%
  c.strokeStyle = '#ff3b30'; c.lineWidth = 9;
  c.strokeRect(58, 200, 140, 70);
  c.fillStyle = '#ff3b30'; c.fillRect(198, 220, 14, 30);
  c.fillRect(66, 208, 8, 54);
  c.fillStyle = '#f2f2f2';
  c.font = font(F.archivo(100, 700), 54);
  c.textAlign = 'center';
  c.fillText('0%', 128, 340);
  c.font = font(F.archivo(100, 500), 20);
  c.fillStyle = '#9a9a9a';
  c.fillText('connect charger', 128, 380);
  return cv;
}
