// Space chorus: the world above the Earth. The night Earth (lib/earth.ts) scaled to radius R at the origin,
// a city-light shell on top of it that can flare in a wave spreading over the planet ("the whole planet
// glows"), aurora curtains, a star field and a nebula at infinity, and (final chorus) the sun rising over the
// limb. Rings of star-figures live in the plane z = 0 around the Earth; the scene adds them to `st`.
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';
import { Stage } from '../lib/stage';
import { col } from '../lib/palette';
import { Earth } from '../lib/earth';
import { GlowPoints } from '../lib/points';
import { nebulaMap, nebulaSphere } from './fall-sky';

export const R = 20;
const ER = 6.371;

/** Object-space direction of a point on the Earth texture (same convention as the intro's dive). */
export function latLon(lat: number, lon: number) {
  const th = Math.PI / 2 - (lat * Math.PI) / 180, ph = (lon * Math.PI) / 180 + Math.PI;
  return new THREE.Vector3(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
}

export interface SpaceLook {
  /** Nebula tint and gain. */
  neb: THREE.Color; nebGain: number;
  /** Aurora colours (bottom, top). */
  aurora: [THREE.Color, THREE.Color];
  /** Tint of the waking city-light shell. */
  shell: THREE.Color;
  /** Rim (air) colour. */
  air: THREE.Color;
}

export class SpaceWorld {
  st = new Stage(50, 0.05, 9000);
  earth = new Earth(ER);
  shell!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  aurora!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  field = new GlowPoints(4000, 1);
  neb!: THREE.Mesh;
  sun!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  sky = new THREE.Group();
  /** World directions of the two cities (formation city at +y, the dive city). */
  dirA = new THREE.Vector3(0, 1, 0);
  dirC = new THREE.Vector3(0, 0, 1);

  constructor(public look: SpaceLook) {}

  async init(a: [number, number], c: [number, number], cWorld: THREE.Vector3) {
    const S = this.st;
    S.bg.copy(col('night', 0.12));
    await this.earth.init();
    this.earth.scale.setScalar(R / ER);
    // orient: city A straight up, city C toward cWorld (as near as the globe allows)
    const A = latLon(...a), C = latLon(...c);
    const q1 = new THREE.Quaternion().setFromUnitVectors(A, new THREE.Vector3(0, 1, 0));
    const c1 = C.clone().applyQuaternion(q1).setY(0), cw = cWorld.clone().setY(0);
    const ang = Math.atan2(c1.x, c1.z) - Math.atan2(cw.x, cw.z);
    const q2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ang);
    this.earth.quaternion.copy(q2.multiply(q1));
    this.dirC.copy(C).applyQuaternion(this.earth.quaternion).normalize();
    (this.earth.air.material.uniforms.color!.value as THREE.Color).copy(this.look.air);
    // the city-light shell: the lights texture again, additive, flaring in a wave
    const lights = this.earth.surface.material.uniforms.lights!.value as THREE.Texture;
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(ER * 1.0015, 128, 64), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        lights: { value: lights }, tint: { value: this.look.shell.clone() }, gain: { value: 0 },
        waveDir: { value: new THREE.Vector3(0, 1, 0) }, waveA: { value: 0 }, waveSoft: { value: 0.12 }, front: { value: 1 }, pulse: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vO; varying vec3 vN; varying vec3 vV;
        void main() { vUv = uv; vO = normalize(position); vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D lights; uniform vec3 tint, waveDir; uniform float gain, waveA, waveSoft, front, pulse;
        varying vec2 vUv; varying vec3 vO; varying vec3 vN; varying vec3 vV;
        void main() {
          float L = texture2D(lights, vUv).r;
          float ang = acos(clamp(dot(vO, normalize(waveDir)), -1.0, 1.0));
          float inW = 1.0 - smoothstep(waveA - waveSoft, waveA, ang);
          float q = (ang - waveA) / max(waveSoft, 1e-3);
          float fr = exp(-q * q) * step(0.001, waveA) * front;
          float limb = clamp(dot(normalize(vN), vV), 0.0, 1.0);
          vec3 c = tint * (L * L * 2.5 + L * 0.35) * (gain * inW + pulse) + tint * (L * 3.0 + 0.04) * fr;
          gl_FragColor = vec4(c * (0.35 + 0.65 * limb), 1.0);
        }`,
    }));
    this.earth.add(this.shell);
    S.add(this.earth);

    // aurora: curtains on an oval round an axis that leans away from the formation, so they stand on the horizon
    const N = 360, axis = new THREE.Vector3(0.15, 0.62, -0.77).normalize();
    const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 0, 1)).normalize(), w = new THREE.Vector3().crossVectors(axis, u);
    const P: number[] = [], UV: number[] = [], idx: number[] = [];
    const alpha = 0.42;
    for (let i = 0; i <= N; i++) {
      const phi = (i / N) * Math.PI * 2;
      const d = axis.clone().multiplyScalar(Math.cos(alpha)).addScaledVector(u, Math.sin(alpha) * Math.cos(phi)).addScaledVector(w, Math.sin(alpha) * Math.sin(phi));
      for (const [h, v] of [[R + 0.25, 0], [R + 2.6, 1]] as const) { P.push(d.x * h, d.y * h, d.z * h); UV.push(i / N, v); }
      if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
    }
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    ag.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    ag.setIndex(idx);
    this.aurora = new THREE.Mesh(ag, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { t: { value: 0 }, k: { value: 0 }, c0: { value: this.look.aurora[0].clone() }, c1: { value: this.look.aurora[1].clone() } },
      vertexShader: /* glsl */ `
        uniform float t; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          // folds: the curtain sways sideways along the oval
          float s = sin(uv.x * 37.0 + t * 0.7) * 0.35 + sin(uv.x * 91.0 - t * 1.3) * 0.12;
          vec3 side = normalize(cross(normalize(p), vec3(0.0, 1.0, 0.0)) + vec3(1e-4));
          p += side * s * (0.4 + uv.y);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float t, k; uniform vec3 c0, c1; varying vec2 vUv;
        float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }
        float n(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }
        void main() {
          float x = vUv.x * 420.0;
          float rays = 0.35 + 0.65 * n(x + t * 3.0) * n(x * 0.23 - t * 0.8);
          float band = smoothstep(0.0, 0.07, vUv.y) * exp(-vUv.y * 2.6);
          float big = 0.4 + 0.6 * n(vUv.x * 12.0 + t * 0.15);
          vec3 c = mix(c0, c1, smoothstep(0.1, 0.8, vUv.y));
          gl_FragColor = vec4(c * rays * band * big * k, 1.0);
        }`,
    }));
    S.add(this.aurora);

    // stars at infinity and a nebula, both following the camera
    const sr = mulberry32(31);
    for (let i = 0; i < this.field.n; i++) {
      const z = sr() * 2 - 1, a = sr() * Math.PI * 2, Rr = 4000, rr = Math.sqrt(1 - z * z);
      const band = Math.exp(-Math.pow((z - 0.3 * Math.sin(a * 2 + 1)) / 0.2, 2));
      const c = col('white', 0.35 + sr() * 1.2 + band * sr() * 1.4).lerp(col(sr() < 0.5 ? 'blue' : 'gold', 1), sr() * 0.25);
      this.field.set(i, rr * Math.cos(a) * Rr, z * Rr, rr * Math.sin(a) * Rr, c, 1, 0.3 + sr() * sr() * 2.2);
    }
    this.field.commit();
    this.field.material.uniforms.size!.value = 7;
    this.neb = nebulaSphere(nebulaMap(512, 256, 4), 4, 4500);
    this.sky.add(this.field, this.neb);
    S.add(this.sky);

    // the sun: a far billboard behind the limb (the Earth hides its core until it rises)
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { k: { value: 0 }, core: { value: col('white', 1) }, glow: { value: col('gold', 1) }, t: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float k, t; uniform vec3 core, glow; varying vec2 vUv;
        void main() {
          float r = length(vUv);
          float a = abs(vUv.x) + abs(vUv.y) < 1e-5 ? 0.0 : atan(vUv.y, vUv.x);
          float rays = 0.75 + 0.25 * sin(a * 18.0 + t * 0.3) * sin(a * 7.0 - t * 0.2);
          vec3 c = core * smoothstep(0.035, 0.028, r) * 6.0 + glow * (exp(-r * 9.0) * 2.5 + exp(-r * 3.0) * 0.6 * rays + exp(-r * r * 2.0) * 0.08);
          c += glow * exp(-abs(vUv.y) * 160.0) * exp(-abs(vUv.x) * 2.5) * 1.2; // anamorphic streak
          c *= 1.0 - smoothstep(0.8, 1.0, r);
          gl_FragColor = vec4(c * k, 1.0);
        }`,
    }));
    this.sun.frustumCulled = false;
    this.sun.visible = false;
    S.add(this.sun);
  }

  /** Per frame: sky follows the camera; Earth clock. */
  update(t: number) {
    const cam = this.st.cam;
    this.sky.position.copy(cam.position);
    this.earth.time = t;
    this.aurora.material.uniforms.t!.value = t;
    this.sun.material.uniforms.t!.value = t;
  }

  /** Place the sun far away along `dir` (world), facing the camera, at intensity k; the Earth's dawn follows. */
  setSun(dir: THREE.Vector3, k: number, dawn: number, size = 900) {
    this.sun.visible = k > 0;
    const cam = this.st.cam;
    this.sun.position.copy(cam.position).addScaledVector(dir, 3000);
    this.sun.quaternion.copy(cam.quaternion);
    this.sun.scale.setScalar(size);
    this.sun.material.uniforms.k!.value = k;
    // (both of the Earth's dawn uniforms are world-space directions)
    (this.earth.surface.material.uniforms.sun!.value as THREE.Vector3).copy(dir);
    this.earth.surface.material.uniforms.dawn!.value = dawn;
    (this.earth.air.material.uniforms.sun!.value as THREE.Vector3).copy(dir);
    this.earth.air.material.uniforms.dawn!.value = dawn;
  }

  /** The waking wave of the light shell: from world direction `dir`, out to `angle` rad. */
  wave(dir: THREE.Vector3, angle: number, gain: number, pulse = 0, soft = 0.12) {
    const u = this.shell.material.uniforms;
    (u.waveDir!.value as THREE.Vector3).copy(dir).applyQuaternion(this.earth.quaternion.clone().invert());
    u.waveA!.value = angle;
    u.waveSoft!.value = soft;
    u.gain!.value = gain;
    u.pulse!.value = pulse;
  }
}
