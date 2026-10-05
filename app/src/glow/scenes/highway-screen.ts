// Highway scene, line 3 ("Now the sun's coming up where it sank"): the sunrise is not the sun. It is a giant
// LED billboard straddling the highway far ahead, playing a painted sunrise over a painted road (fake light).
// The words of the line are part of its picture: first in one big line, then born from the painted sun and
// flown out onto an arc around it. On "sank" the picture glitches (tearing rows, scanlines, a dead block of
// modules, colour-swapped modules), the painted sun sinks back, the modules die in a cascade and the screen
// is a dark slab against the night sky that was there all along.
//
// The picture is rendered every frame into its own target (an orthographic 2D scene: the painting shader
// and the word meshes); the LED face samples it through a pixel grid, the glitch and the module cascade.
import * as THREE from 'three';
import type { Line } from '../../engine/lyrics';
import { makeRT } from '../../engine/gl';
import { clamp, ease, lerp, prog } from '../../engine/util';
import { displayTextGeometry, loadDisplayFont } from '../lib/fonts';
import { GlowPoints } from '../lib/points';
import { HW_GLSL, HU, boxAt, litMat, merge, rod } from './highway-common';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const DEG = Math.PI / 180;

export const SCR = { w: 170, h: 74, y0: 7.5 } as const;
const ASPECT = SCR.w / SCR.h;
/** the painted horizon (content y, 0 = bottom of the screen) */
const HOR = 0.13;

// ------------------------------------------------------------------------------------------- the painting

const PAINT_FRAG = /* glsl */ `
uniform float uSunY, uBright, uTime, uDawn;
varying vec2 vUv;
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1, 0)), f.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), f.x), f.y); }
float fb(vec2 p) { return vn(p) * 0.55 + vn(p * 2.03 + 7.1) * 0.3 + vn(p * 4.1 + 3.3) * 0.15; }
vec3 band(float y) {
  // a painted dawn: indigo, violet, rose, orange, gold at the horizon
  vec3 c = vec3(0.003, 0.004, 0.016);
  c = mix(c, vec3(0.04, 0.018, 0.09), smoothstep(0.98, 0.66, y));
  c = mix(c, vec3(0.42, 0.07, 0.16), smoothstep(0.66, 0.40, y));
  c = mix(c, vec3(1.15, 0.32, 0.08), smoothstep(0.42, 0.22, y));
  c = mix(c, vec3(1.9, 1.05, 0.35), smoothstep(0.24, ${HOR.toFixed(3)} + 0.005, y));
  return c;
}
void main() {
  vec2 p = vec2((vUv.x - 0.5) * ${ASPECT.toFixed(4)}, vUv.y);
  // brush strokes: long horizontal dabs that bend the gradient a little
  float stroke = fb(vec2(p.x * 2.2, p.y * 34.0)) - 0.5;
  float stroke2 = vn(vec2(p.x * 7.0 + 3.0, p.y * 90.0)) - 0.5;
  float y = p.y + stroke * 0.035 + stroke2 * 0.01;
  vec3 c = band(y);
  // the night version (before the dawn): the same sky, cold and dim
  vec3 night = mix(vec3(0.006, 0.008, 0.03), vec3(0.04, 0.03, 0.09), smoothstep(0.7, ${HOR.toFixed(3)}, y));
  c = mix(night, c, uDawn);
  // the sun: a painted disc with a soft corona and brushed rays, rising from the horizon
  vec2 sc = vec2(0.0, ${HOR.toFixed(3)} + uSunY);
  vec2 d = p - sc; float r = length(d);
  float a = atan(d.y, d.x + 1e-5);
  float rays = pow(abs(cos(a * 7.0 + sin(a * 3.0) * 0.8 + sin(a * 11.0) * 0.4)), 10.0) * exp(-r / 0.35) * smoothstep(0.1, 0.16, r);
  float disc = smoothstep(0.112, 0.104, r + sin(a * 9.0 + r * 40.0) * 0.002);
  vec3 sunC = vec3(2.3, 1.85, 1.15);
  vec3 glow = vec3(1.7, 0.85, 0.32) * (exp(-r / 0.09) * 0.8 + exp(-r / 0.32) * 0.35);
  float above = smoothstep(${HOR.toFixed(3)} - 0.004, ${HOR.toFixed(3)} + 0.004, p.y);
  c += (glow + vec3(1.6, 0.9, 0.4) * rays * 0.35) * uDawn * mix(0.4, 1.0, above);
  c = mix(c, sunC, disc * above * uDawn);
  // painted clouds: a few long streaks, dark bodies with lit undersides
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float cy = 0.34 + 0.13 * fi + 0.02 * sin(fi * 3.1);
    if (abs(p.y - cy) > 0.09) continue;
    float cl = fb(vec2(p.x * (1.2 + 0.3 * fi) + fi * 9.0, (p.y - cy) * 24.0));
    float body = smoothstep(0.58, 0.72, cl) * exp(-pow((p.y - cy) / 0.03, 2.0)) * smoothstep(1.15, 0.4, abs(p.x + 0.3 * sin(fi * 2.0)));
    float rim = smoothstep(0.0, -0.025, p.y - cy) * body;
    c = mix(c, vec3(0.05, 0.02, 0.06) * (1.0 + uDawn), body * 0.8);
    c += vec3(1.6, 0.6, 0.2) * rim * uDawn * exp(-abs(p.x - sc.x) * 0.8) * 0.9;
  }
  // the painted land: a hill line, and the road running to the sun with its wet gold reflection
  float hill = ${HOR.toFixed(3)} + 0.012 * sin(p.x * 3.0 + 1.0) + 0.008 * sin(p.x * 7.3) + 0.02 * smoothstep(0.4, 1.1, abs(p.x));
  if (p.y < hill) {
    vec3 land = vec3(0.025, 0.012, 0.03) * (0.7 + 0.6 * fb(p * vec2(9.0, 40.0)));
    float depth = clamp((hill - p.y) / hill, 0.0, 1.0);
    float rw = 0.015 + 0.9 * depth;
    float road = smoothstep(rw, rw * 0.94, abs(p.x));
    vec3 rc = vec3(0.03, 0.02, 0.035);
    float refl = exp(-pow(p.x / (0.012 + 0.08 * depth), 2.0)) * (0.6 + 0.4 * fb(vec2(p.x * 30.0, p.y * 200.0 - uTime * 0.5)));
    rc += vec3(2.2, 1.2, 0.45) * refl * uDawn * smoothstep(-0.05, 0.08, uSunY);
    // lane dashes running toward the horizon
    float dash = step(0.5, fract(1.0 / max(depth, 0.02) * 0.9 + uTime * 0.0)) * exp(-pow(abs(p.x) / (rw * 0.02 + 0.001), 2.0)) * depth;
    rc += vec3(0.5, 0.4, 0.3) * dash * 0.3 * (0.3 + uDawn);
    land = mix(land, rc, road);
    c = land;
  }
  // the edges of the picture fall off into the night (from afar the screen melts into the sky)
  float vig = smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x) * smoothstep(1.0, 0.62, vUv.y);
  c *= mix(0.06, 1.0, vig);
  gl_FragColor = vec4(c * uBright, 1.0);
}`;

/** One word of the line on the screen: line slot (D) and arc slot (E). */
interface SWord { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t0: number; w: number; line: THREE.Vector3; arcA: number }

/** The picture on the screen: the painting and the words, rendered into `rt` each frame. */
export class ScreenPicture {
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-ASPECT / 2, ASPECT / 2, 1, 0, -1, 1);
  rt = makeRT(640, Math.round(640 / ASPECT));
  u = { uSunY: { value: -0.2 }, uBright: { value: 1 }, uTime: { value: 0 }, uDawn: { value: 0 } };
  words: SWord[] = [];
  R = 0.8;
  sArc = 0.08;

  constructor(public line: Line) {
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(ASPECT, 1), new THREE.ShaderMaterial({
      uniforms: this.u, depthTest: false, depthWrite: false,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: PAINT_FRAG,
    }));
    bg.position.set(0, 0.5, -0.5);
    bg.renderOrder = -1;
    this.scene.add(bg);
  }

  async build() {
    const font = await loadDisplayFont('tiltneon');
    const L = this.line.words;
    // ---- line layout (all words in one row, big, above the sun)
    const sLine = 0.205;
    const gLine = L.map((w) => displayTextGeometry(font, w.w.toUpperCase(), 1, { tracking: 0.03 }));
    const wLine = gLine.map((g) => g.boundingBox!.max.x - g.boundingBox!.min.x);
    // the first three words ("NOW THE SUN'S") are the ones shown in a line; the arc holds all of them
    const nLine = 3;
    const gap = 0.5;
    const totL = wLine.slice(0, nLine).reduce((a, b) => a + b, 0) + gap * (nLine - 1);
    const scaleL = Math.min(sLine, (ASPECT * 0.86) / totL);
    // ---- arc layout around the sun
    const gapA = 0.45;
    // the arc: a half circle over the risen sun, R fixed, the size fitted to it
    this.R = 0.6;
    const units = wLine.reduce((a, b) => a + b, 0) + gapA * (L.length - 1);
    const sArc = (this.R * 132 * DEG) / units;
    this.sArc = sArc;
    const span = 132 * DEG;
    let accL = -totL / 2, accA = 0;
    L.forEach((w, i) => {
      const mat = new THREE.MeshBasicMaterial({ color: C('#fff3e0', 0), transparent: true, depthTest: false, depthWrite: false });
      const mesh = new THREE.Mesh(gLine[i]!, mat);
      this.scene.add(mesh);
      const lineX = (accL + wLine[i]! / 2) * scaleL;
      if (i < nLine) accL += wLine[i]! + gap;
      const mid = accA + (wLine[i]! * sArc) / 2;
      accA += wLine[i]! * sArc + gapA * sArc;
      const arcA = Math.PI / 2 + span / 2 - mid / this.R;
      this.words.push({ mesh, mat, t0: w.start, w: wLine[i]!, line: new THREE.Vector3(lineX, 0.56, scaleL), arcA });
    });
  }

  /**
   * Pose at t. `arcK` 0 = line layout, 1 = arc layout (the line's words glide to their arc slots; words
   * born after the switch are born at the sun and fly out). `k` = brightness, `fade` = words' level.
   */
  update(t: number, sunY: number, dawn: number, bright: number, arcK: number, tArc: number, fade: number) {
    this.u.uSunY.value = sunY;
    this.u.uDawn.value = dawn;
    this.u.uBright.value = bright;
    this.u.uTime.value = t;
    const sun = new THREE.Vector2(0, HOR + 0.13);
    void sunY;
    const R = this.R;
    for (const w of this.words) {
      const born = t >= w.t0;
      w.mesh.visible = born;
      if (!born) continue;
      // (the words lean with the arc, but never more than ~50 degrees: the last ones stay readable)
      const arcSlot = (r: number, a: number) => new THREE.Vector3(sun.x + Math.cos(a) * r, sun.y + Math.sin(a) * r, clamp(a - Math.PI / 2, -0.85, 0.85));
      let pos: THREE.Vector3, rot: number, scale: number;
      if (w.t0 >= tArc - 0.02) {
        // born at the sun, flies out along its ray to the arc
        const p = prog(t, w.t0, w.t0 + 0.42, ease.outExpo);
        const a = w.arcA + (1 - p) * (w.arcA > Math.PI / 2 ? 0.16 : -0.16);
        const s = arcSlot(R * (0.45 + 0.55 * p), a);
        pos = new THREE.Vector3(s.x, s.y, 0); rot = s.z; scale = this.sArc * (0.7 + 0.3 * p);
      } else {
        const s = arcSlot(R, w.arcA);
        const k = ease.inOutCubic(clamp(arcK));
        // the line's words rise into the line from just above the sun when sung
        const pin = prog(t, w.t0, w.t0 + 0.45, ease.outExpo);
        const lp = new THREE.Vector3(w.line.x, lerp(sun.y + 0.08, w.line.y, pin), 0);
        pos = lp.lerp(new THREE.Vector3(s.x, s.y, 0), k);
        rot = lerp(0, s.z, k);
        scale = lerp(w.line.z * (0.55 + 0.45 * pin), this.sArc, k);
      }
      w.mesh.position.set(pos.x, pos.y, 0);
      w.mesh.rotation.z = rot;
      w.mesh.scale.setScalar(scale);
      const flash = Math.exp(-Math.max(0, t - w.t0) / 0.2);
      w.mat.color.copy(C('#fff1dc', fade * (1.6 + 2.6 * flash)));
      w.mat.opacity = 1;
    }
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.cam);
  }
}

// ------------------------------------------------------------------------------------------- the screen

/**
 * The screen's failure, all 0..1 unless noted: tear (rows sliding), scan (scan-line stutter), shift (RGB split,
 * uv units), blocks (share of dead pixel blocks), roll (vertical slip, uv), flash (the last bright frame),
 * off (black), after (the faint after-glow once black), stuck (stuck pixels).
 */
export interface GlitchState { tear: number; scan: number; shift: number; blocks: number; roll: number; flash: number; off: number; after: number; stuck: number }

export class GiantScreen extends THREE.Group {
  faceU: Record<string, THREE.IUniform>;
  beacons: GlowPoints;
  face: THREE.Mesh;

  constructor(pic: ScreenPicture) {
    super();
    const W = SCR.w, H = SCR.h, y0 = SCR.y0;
    this.faceU = {
      ...HU,
      pic: { value: pic.rt.texture }, uTear: { value: 0 }, uScan: { value: 0 }, uShift: { value: 0 }, uBlocks: { value: 0 }, uRoll: { value: 0 },
      uFlash: { value: 0 }, uOff: { value: 0 }, uAfter: { value: 0 }, uStuck: { value: 0 }, uT: { value: 0 },
      res: { value: new THREE.Vector2(720, Math.round(720 / ASPECT)) },
    };
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.ShaderMaterial({
      uniforms: this.faceU,
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: HW_GLSL + /* glsl */ `
        uniform sampler2D pic; uniform float uTear, uScan, uShift, uBlocks, uRoll, uFlash, uOff, uAfter, uStuck, uT; uniform vec2 res;
        varying vec2 vUv; varying vec3 vW;
        float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 uv = vUv;
          vec3 c;
          if (uTear + uScan + uShift + uBlocks + uRoll + uFlash + uOff + uAfter < 1e-4) {
            c = texture2D(pic, uv).rgb;
          } else {
            float q = floor(uT * 20.0);                          // the noise of the failure changes 20 times a second
            // ---- tearing: wide horizontal bands slide sideways, the whole picture slips
            float bandI = floor(uv.y * 14.0);
            float tear = step(1.0 - 0.5 * uTear, h2(vec2(bandI, q))) * (h2(vec2(bandI, q + 3.0)) - 0.5) * 0.3 * uTear;
            uv.x += tear;
            uv.y = fract(uv.y + uRoll);
            // ---- colour channels pulled apart
            c = vec3(texture2D(pic, uv + vec2(uShift, 0.0)).r, texture2D(pic, uv).g, texture2D(pic, uv - vec2(uShift, -0.35 * uShift)).b);
            // ---- scan lines: coarse lines, single lines dropping out, a dark bar rolling through
            float ln = vUv.y * 130.0;
            float line = 0.5 + 0.5 * cos(ln * 6.2832);
            float drop = step(h2(vec2(floor(ln), q)), 0.22 * uScan);
            c *= mix(1.0, (0.3 + 0.85 * line) * (1.0 - 0.9 * drop), uScan);
            float bar = exp(-pow((fract(vUv.y * 1.0 - uT * 1.7) - 0.5) / 0.05, 2.0));
            c *= 1.0 - 0.75 * uScan * bar;
            // ---- dead pixel blocks (black, with a burnt magenta / green rim) and blocks frozen in one channel
            vec2 bg = vec2(14.0, 6.0);
            vec2 bi = floor(vUv * bg), bf = fract(vUv * bg);
            float bh = h2(bi + 11.3);
            float deadB = step(bh, uBlocks);
            // (a burnt fringe on some edges only, ragged, with dead pixels speckled in from it)
            float ed = min(min(bf.x, 1.0 - bf.x), min(bf.y, 1.0 - bf.y) * 2.3);
            float rag = h2(floor(vUv * res * 0.5) + bi);
            float rim = deadB * step(0.55, h2(bi + 6.6)) * (1.0 - step(0.025 + 0.03 * rag, ed));
            deadB = max(deadB, step(rag, 0.35 * uBlocks) * step(ed, 0.2) * step(0.5, h2(bi + 8.2)));
            float frozen = step(1.0 - 0.6 * uBlocks, h2(bi + 4.7)) * (1.0 - deadB);
            c = mix(c, vec3(c.r * 1.4, 0.0, c.b * 1.6), frozen * step(0.5, h2(bi + 9.1)));
            c = mix(c, vec3(0.0, c.g * 1.5, 0.0), frozen * step(h2(bi + 9.1), 0.5));
            c = mix(c, vec3(0.0), deadB);
            c += mix(vec3(1.0, 0.1, 0.8), vec3(0.15, 1.0, 0.4), step(0.5, h2(bi + 2.0))) * rim * 0.7 * (1.0 - uOff);
            // ---- the last bright frame: everything still alive blows out
            c = mix(c, c * 3.5 + vec3(1.7, 1.45, 1.1), uFlash * (1.0 - deadB));
            // ---- black, then only a faint warm after-glow of the last picture, banded by the scan lines
            vec3 ghost = texture2D(pic, vUv).rgb * vec3(1.0, 0.75, 0.55) * (0.45 + 0.55 * line);
            c = mix(c, ghost * 0.05 * uAfter, uOff);
          }
          // ---- LED structure: round diodes on a black mask, faded where they get smaller than a pixel
          vec2 lp = vUv * res;
          vec2 fw = fwidth(lp);
          float sub = smoothstep(0.18, 0.5, max(fw.x, fw.y));
          float diode = smoothstep(0.5, 0.28, length(fract(lp) - 0.5));
          c *= mix(0.78 + 0.4 * diode, 1.0, sub);
          // ---- stuck pixels after the death
          if (uStuck > 0.0) {
            float sp = step(0.9975, h2(floor(lp) + 0.3));
            vec3 spc = mix(vec3(1.0, 0.1, 0.05), vec3(0.1, 1.0, 0.3), step(0.5, h2(floor(lp) + 1.7)));
            c += spc * sp * uStuck * 2.0 * (1.0 - sub * 0.7);
          }
          // module seams
          vec2 mf = fract(vUv * vec2(28.0, 12.0));
          vec2 mfw = fwidth(vUv * vec2(28.0, 12.0));
          float seam = (1.0 - smoothstep(0.0, mfw.x * 1.5 + 1e-4, min(mf.x, 1.0 - mf.x))) + (1.0 - smoothstep(0.0, mfw.y * 1.5 + 1e-4, min(mf.y, 1.0 - mf.y)));
          c *= 1.0 - 0.22 * clamp(seam, 0.0, 1.0) * (1.0 - sub * 0.8);
          // a dead screen is a black glossy slab: the streetlights and the sky glance off it a little
          // the slab itself: module seams catch the streetlights, rain runs down its glossy face
          float sx = fract(vUv.x * 28.0), sy = fract(vUv.y * 12.0);
          float seamL = (1.0 - smoothstep(0.0, 0.02, min(sx, 1.0 - sx))) + (1.0 - smoothstep(0.0, 0.04, min(sy, 1.0 - sy)));
          float col = floor(vUv.x * 520.0);
          float run = step(0.93, h2(vec2(col, 1.7))) * smoothstep(0.75, 1.0, fract(vUv.y * 2.0 + uT * (0.15 + 0.25 * h2(vec2(col, 3.1))) + h2(vec2(col, 5.3))));
          float sheen = 0.5 + 0.5 * smoothstep(0.0, 1.0, vUv.y);
          vec3 slab = uAmbHi * (0.25 + 0.2 * sheen) + uLampCol * 0.00005 * (1.0 + 2.5 * clamp(seamL, 0.0, 1.0) + 6.0 * run);
          vec3 base = hwFog(slab, vW, cameraPosition);
          // its own light reaches us through the haze better than the haze hides it
          float dist = length(vW - cameraPosition);
          gl_FragColor = vec4(base + c * exp(-dist * uFogD * 0.22), 1.0);
        }`,
    }));
    face.position.set(0, y0 + H / 2, 0.6);
    this.face = face;
    this.add(face);
    // ---- the structure: a bezel, a box truss behind, two lattice towers and a catwalk
    const steel = litMat({ color: C('#596069', 0.35), rough: 0.6, metal: 0.5, spec: 0.5, grime: 0.6 });
    const parts: THREE.BufferGeometry[] = [];
    parts.push(boxAt(W + 2.4, 1.2, 1.6, 0, y0 - 0.6, 0), boxAt(W + 2.4, 1.2, 1.6, 0, y0 + H + 0.6, 0));
    parts.push(boxAt(1.2, H + 2.4, 1.6, -W / 2 - 0.6, y0 + H / 2, 0), boxAt(1.2, H + 2.4, 1.6, W / 2 + 0.6, y0 + H / 2, 0));
    parts.push(boxAt(W, H, 0.4, 0, y0 + H / 2, -0.6)); // the back of the cabinets
    // the truss behind (three chords) and the towers
    for (const y of [y0 + 4, y0 + H / 2, y0 + H - 4]) parts.push(boxAt(W, 0.6, 0.6, 0, y, -5));
    for (const sx of [-1, 1]) {
      const cx = sx * (W / 2 - 18);
      const top = y0 + H + 1;
      for (const [dx, dz] of [[-2.2, -3], [2.2, -3], [-2.2, -7.5], [2.2, -7.5]] as const) parts.push(rod(new THREE.Vector3(cx + dx * 1.6, 0, dz - (dz < -5 ? 2 : 0)), new THREE.Vector3(cx + dx, top, dz), 0.35, 0.25, 6));
      for (let y = 4; y < top; y += 7) {
        parts.push(rod(new THREE.Vector3(cx - 2.2, y, -3), new THREE.Vector3(cx + 2.2, y + 7, -3), 0.12, 0.12, 4));
        parts.push(rod(new THREE.Vector3(cx + 2.2, y, -3), new THREE.Vector3(cx - 2.2, y + 7, -3), 0.12, 0.12, 4));
        parts.push(rod(new THREE.Vector3(cx - 2.2, y, -7.5), new THREE.Vector3(cx - 2.2, y + 7, -3), 0.1, 0.1, 4));
        parts.push(rod(new THREE.Vector3(cx + 2.2, y, -7.5), new THREE.Vector3(cx + 2.2, y + 7, -3), 0.1, 0.1, 4));
      }
      // the arms from the tower to the screen's back
      for (const y of [y0 + 4, y0 + H / 2, y0 + H - 4]) parts.push(rod(new THREE.Vector3(cx, y, -3), new THREE.Vector3(cx, y, -0.6), 0.3, 0.3, 6));
    }
    // catwalk under the screen with a railing
    parts.push(boxAt(W, 0.12, 1.4, 0, y0 - 1.6, 1.2));
    for (let x = -W / 2; x <= W / 2; x += 4) parts.push(boxAt(0.06, 1.1, 0.06, x, y0 - 1.05, 1.85));
    parts.push(boxAt(W, 0.06, 0.06, 0, y0 - 0.5, 1.85));
    this.add(new THREE.Mesh(merge(parts), steel));
    // aviation lights on the top corners and the tower heads, maintenance lamps on the catwalk
    this.beacons = new GlowPoints(14, 1);
    this.add(this.beacons);
  }

  /** Per frame: the picture's state, the glitch, the blinking beacons. `power` 0 kills the beacons too. */
  update(t: number, gs: GlitchState, power: number) {
    const u = this.faceU;
    u.uTear!.value = gs.tear; u.uScan!.value = gs.scan; u.uShift!.value = gs.shift; u.uBlocks!.value = gs.blocks; u.uRoll!.value = gs.roll;
    u.uFlash!.value = gs.flash; u.uOff!.value = gs.off; u.uAfter!.value = gs.after; u.uStuck!.value = gs.stuck; u.uT!.value = t;
    const W = SCR.w, H = SCR.h, y0 = SCR.y0;
    const blink = (ph: number) => (((t * 0.8 + ph) % 1) < 0.5 ? 1 : 0.04);
    const red = C('#ff2a1a');
    let n = 0;
    for (const sx of [-1, 1]) {
      this.beacons.set(n++, sx * (W / 2 + 0.6), y0 + H + 1.6, 0.6, red, 3.2 * blink(sx > 0 ? 0 : 0.5) * power, 1.6);
      this.beacons.set(n++, sx * (W / 2 - 18), y0 + H + 2.2, -5, red, 2.4 * blink(0.25) * power, 1.4);
    }
    for (let i = 0; i < 8; i++) {
      const x = -W / 2 + 10 + i * ((W - 20) / 7);
      const fl = 0.85 + 0.15 * Math.sin(t * 37 + i * 2.1);
      this.beacons.set(n++, x, y0 - 1.0, 1.6, C('#cfe6ff'), 0.45 * fl * power, 0.6);
    }
    for (let i = n; i < this.beacons.n; i++) this.beacons.hide(i);
    this.beacons.commit();
  }
}

/** The world light of the screen (for HU / the sky): warm, ∝ its brightness. */
export function screenLightColor(k: number) { return C('#ff9a52', k); }
export { HOR as SCREEN_HORIZON };
void DEG;
