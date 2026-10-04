// A spiral galaxy whose stars are people. Far away it is a galaxy — a warm core, blue arms, a smooth glow of
// unresolved stars, knots of pink nebula; close up every bright star in the arms is a person of stardust
// (lib/stardust.ts): along the middle of each arm they hold hands in a chain, around them they dance.
// The disk lies in the xz plane (y up) about the origin; people lie in the disk facing +y, heads outward.
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';
import { bend, limbDir, type RealFigure } from './people';
import { starJoints } from './stars';
import { GlowPoints } from './points';
import { col } from './palette';
import type { Stardust } from './stardust';
import { PoseBank, frame, place } from '../scenes/cosmos-gfx';

export interface GalaxyPerson {
  /** Disk position (y = height), the arm's outward normal in the disk (the person's up), scale. */
  p: THREE.Vector3; up: THREE.Vector3; s: number;
  /** Chain people: index along their arm's chain (-1 for dancers). */
  chain: boolean; link: number; body: number; style: number; seed: number; phase: number; hue: number; mirror: boolean;
}

export interface GalaxyOpts { radius?: number; arms?: number; pitch?: number; dancers?: number; stars?: number }

export class Galaxy {
  group = new THREE.Group();
  stars: GlowPoints;
  glow = new THREE.Group();
  disk: THREE.Mesh;
  people: GalaxyPerson[] = [];
  knots: THREE.Sprite[] = [];
  cores: THREE.Sprite[] = [];
  bank: PoseBank;
  R: number;
  arms: number;
  pitch: number;
  r0 = 6;
  /** Person colours (chain, dancers a / b) and the dim colour inside the bodies. */
  colors = { chain: col('white', 1.5).lerp(col('cyan', 1.5), 0.3), a: col('cyan', 1.4).lerp(col('white', 1.4), 0.3), b: col('pink', 1.4).lerp(col('white', 1.4), 0.25), deep: col('blue', 1.1).lerp(col('violet', 1.1), 0.4) };
  private q = new THREE.Quaternion();
  private js: THREE.Vector3[] = [];
  private _up = new THREE.Vector3();
  private _p = new THREE.Vector3();

  constructor(bodies: RealFigure[], seed = 1, o: GalaxyOpts = {}) {
    this.R = o.radius ?? 120;
    this.arms = o.arms ?? 2;
    this.pitch = o.pitch ?? 0.26;
    this.bank = new PoseBank(bodies);
    const r = mulberry32(seed * 977 + 3);
    const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += r(); return (s - 2) / 0.577; };

    // the people: a hand-holding chain along the middle of every arm, dancers scattered about it
    const span = this.handSpan();
    for (let a = 0; a < this.arms; a++) {
      let link = 0;
      for (let rr = 10; rr < this.R * 0.95; rr += span * Math.sin(this.pitch)) {
        const { p, n } = this.armPoint(a, rr, 0);
        this.people.push({ p, up: n, s: 1, chain: true, link: link++, body: this.people.length % 2, style: -1, seed: 0, phase: 0, hue: r(), mirror: false });
      }
    }
    const nd = o.dancers ?? 900;
    for (let i = 0; i < nd; i++) {
      const a = i % this.arms;
      const rr = 10 + Math.sqrt(r()) * (this.R - 10);
      const w = (2.5 + rr * 0.05) * gauss();
      const { p, n } = this.armPoint(a, rr, w);
      p.y += gauss() * 0.8;
      const tilt = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.9);
      this.people.push({ p, up: n.clone().add(tilt).normalize(), s: 0.9 + r() * 0.2, chain: false, link: -1, body: i % 2, style: Math.floor(r() * 6), seed: Math.floor(r() * 2), phase: Math.floor(r() * 2) * 0.5, hue: r(), mirror: r() < 0.5 });
    }

    // ordinary stars: arms, a bulge, a thin disk
    const ns = o.stars ?? 60000;
    this.stars = new GlowPoints(ns, 1);
    const warm = col('gold', 1).lerp(col('white', 1), 0.5), blue = col('white', 1).lerp(col('cyan', 1), 0.35);
    for (let i = 0; i < ns; i++) {
      const u = r();
      let p: THREE.Vector3, c: THREE.Color, k: number, size: number;
      if (u < 0.62) {
        const rr = 6 + Math.pow(r(), 0.8) * this.R * 1.05;
        p = this.armPoint(i % this.arms, rr, (3 + rr * 0.07) * gauss()).p;
        p.y += gauss() * 0.9;
        c = blue.clone().lerp(warm, Math.max(0, 1 - rr / 40) * 0.8);
        k = 0.4 + r() * 1.2; size = 0.05 + r() * r() * 0.22;
      } else if (u < 0.82) {
        const rr = Math.abs(gauss()) * 12;
        const v = new THREE.Vector3(gauss(), gauss() * 0.55, gauss()).normalize().multiplyScalar(rr);
        p = v; c = warm.clone(); k = 0.5 + r() * 1.0; size = 0.06 + r() * 0.16;
      } else {
        const rr = Math.sqrt(r()) * this.R * 1.2, th = r() * Math.PI * 2;
        p = new THREE.Vector3(Math.cos(th) * rr, gauss() * 1.5, Math.sin(th) * rr);
        c = blue.clone().lerp(warm, 0.3); k = 0.25 + r() * 0.6; size = 0.05 + r() * 0.12;
      }
      this.stars.set(i, p.x, p.y, p.z, c, k, size);
    }
    this.stars.commit();

    // the smooth glow of the disk (unresolved stars), the core, nebula knots
    this.disk = new THREE.Mesh(new THREE.PlaneGeometry(this.R * 2.6, this.R * 2.6), diskMaterial(this.R, this.r0, this.pitch, this.arms));
    this.disk.rotation.x = -Math.PI / 2;
    this.glow.add(this.disk);
    const tex = glowTexture();
    const core = (scale: number, c: THREE.Color) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.scale.setScalar(scale);
      this.glow.add(s);
      this.cores.push(s);
    };
    core(this.R * 0.55, col('gold', 0.5).lerp(col('ember', 0.5), 0.3));
    core(this.R * 0.22, col('gold', 0.8).lerp(col('white', 0.8), 0.5));
    core(this.R * 0.07, col('white', 1.3));
    for (let i = 0; i < 70; i++) {
      const rr = 18 + r() * this.R * 0.85;
      const p = this.armPoint(i % this.arms, rr, (2 + rr * 0.04) * gauss()).p;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: col('pink', 0.25 + r() * 0.3).lerp(col('violet', 0.3), r() * 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.position.copy(p);
      s.scale.setScalar(3 + r() * 7);
      this.knots.push(s);
      this.glow.add(s);
    }
    this.group.add(this.glow, this.stars);
  }

  /** A point of arm `a` at radius r, offset w across the arm; n = the arm's outward normal in the disk. */
  armPoint(a: number, r: number, w: number) {
    const th = (a * 2 * Math.PI) / this.arms + Math.log(r / this.r0) / Math.tan(this.pitch);
    const radial = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    const tang = new THREE.Vector3(-Math.sin(th), 0, Math.cos(th));
    // the curve's tangent leans out by the pitch angle; its normal in the disk points away from the centre
    const t = tang.clone().multiplyScalar(Math.cos(this.pitch)).addScaledVector(radial, Math.sin(this.pitch)).normalize();
    const n = new THREE.Vector3(t.z, 0, -t.x);
    if (n.dot(radial) < 0) n.negate();
    return { p: radial.multiplyScalar(r).addScaledVector(n, w), n, t };
  }

  private handSpan() {
    const pose = this.chainPose(0, 0);
    return Math.abs(pose[6 * 3]! - pose[7 * 3]!) * 1.02;
  }

  private chainCache = new Map<number, Float32Array>();
  private cj: THREE.Vector3[] = [];

  /**
   * Holding hands in a chain: arms down and out (w = 0) or up in a V (w = 1). Both reach the same span, so the
   * hands stay joined while a wave of raised hands runs along the arm.
   */
  chainPose(body: number, w: number): Float32Array {
    const qw = Math.round(Math.min(1, Math.max(0, w)) * 16), key = body * 100 + qw;
    let pose = this.chainCache.get(key);
    if (pose) return pose;
    const fig = this.bank.bodies[body % this.bank.bodies.length]!;
    const x = qw / 16, e = x * x * (3 - 2 * x);
    fig.position.set(0, 0, 0);
    fig.quaternion.identity();
    for (const i of [0, 1]) {
      const sd = i ? 1 : -1, u = limbDir(sd, 0.8 + (2.34 - 0.8) * e, 0.1);
      fig.setArm(i, u, bend(u, new THREE.Vector3(-sd * 0.2, 0.3, 1), 0.14), 0);
      fig.setHand(i, 0.25);
      const th = limbDir(sd, 0.05, 0.02);
      fig.setLeg(i, th, bend(th, new THREE.Vector3(0, 0, -1), 0.06 + 0.1 * (1 - e)));
      fig.setFoot(i, 0.15 * e);
    }
    fig.setSpine(0.04 - 0.14 * e, 0, 0.12 - 0.35 * e, 0);
    starJoints(fig, this.cj);
    pose = new Float32Array(39);
    for (let i = 0; i < 13; i++) { const v = this.cj[i]!; pose[i * 3] = v.x; pose[i * 3 + 1] = v.y; pose[i * 3 + 2] = v.z; }
    this.chainCache.set(key, pose);
    return pose;
  }

  /**
   * Draw the people for beat `beat` and time `t` (rotation). `spin` turns the whole galaxy (rad); `k` dims
   * them; `only` limits drawing to people within `range` of a point (close shots).
   */
  draw(D: Stardust, beat: number, t: number, o: { spin?: number; k?: number; near?: THREE.Vector3; range?: number; energy?: number; cam?: THREE.Camera; wave?: (link: number, beat: number) => number } = {}) {
    this.bank.begin();
    if (o.cam) {
      // inside the disk its smooth glow and the nebula knots would only fog the view
      const h = Math.abs(o.cam.position.y) + Math.max(0, o.cam.position.length() - this.R * 1.1);
      const g = THREE.MathUtils.smoothstep(h, 4, 45);
      (this.disk.material as THREE.ShaderMaterial).uniforms.gain!.value = 0.08 + 0.92 * g;
      for (const s of this.knots) s.material.opacity = 0.25 + 0.75 * g;
      for (const s of this.cores) s.material.opacity = 0.35 + 0.65 * g;
    }
    const spin = o.spin ?? t * 0.02, k = o.k ?? 1;
    this.group.rotation.y = -spin;
    const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -spin);
    const front = new THREE.Vector3(0, 1, 0);
    const C = this.colors;
    // default: a wave of raised hands runs out along each arm, one person after another, over 8 beats
    const wave = o.wave ?? ((i: number, b: number) => Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * (b / 8 - i / 28)), 2));
    for (const P of this.people) {
      const p = this._p.copy(P.p).applyQuaternion(rot);
      if (o.near && p.distanceToSquared(o.near) > (o.range ?? 60) ** 2) continue;
      const up = this._up.copy(P.up).applyQuaternion(rot);
      frame(up, front, this.q);
      const pose = P.chain ? this.chainPose(P.body, wave(P.link, beat)) : this.bank.get(P.body, beat + P.phase, P.style, o.energy ?? 1, P.seed, 1);
      const j = place(pose, p, this.q, P.s, P.mirror, this.js);
      const c = P.chain ? C.chain : P.hue < 0.5 ? C.a : C.b;
      D.figure(j, P.body, c, k * (P.chain ? 1.15 : 0.85), { color2: C.deep, seed: P.hue * 10 });
    }
  }
}

function glowTexture() {
  const n = 128, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, r2 = dx * dx + dy * dy;
    const v = Math.max(0, Math.exp(-r2 * 4) * 0.8 + Math.exp(-r2 * 16) * 0.6 - 0.02) * (r2 < 1 ? 1 : 0);
    const b = Math.min(255, Math.round(v * 255));
    data.set([b, b, b, b], (y * n + x) * 4);
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  return t;
}

function diskMaterial(R: number, r0: number, pitch: number, arms: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { R: { value: R }, r0: { value: r0 }, cotP: { value: 1 / Math.tan(pitch) }, arms: { value: arms }, gain: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float R, r0, cotP, arms, gain;
      varying vec2 vP;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        vec2 q = vec2(vP.x, -vP.y);
        float r = length(q) + 1e-3, th = atan(q.y, q.x);
        float ph = th - log(max(r, 0.5) / r0) * cotP;
        float arm = pow(0.5 + 0.5 * cos(arms * ph), 6.0);
        float n = vnoise(q * 0.08) * 0.6 + vnoise(q * 0.21) * 0.4;
        float disk = exp(-r / (R * 0.32));
        float bulge = exp(-r * r / (R * R * 0.012));
        vec3 warm = vec3(1.0, 0.72, 0.42), blue = vec3(0.45, 0.62, 1.0);
        vec3 c = warm * bulge * 0.9 + mix(warm, blue, smoothstep(0.08, 0.45, r / R)) * disk * (0.08 + 0.55 * arm * (0.5 + n));
        c *= smoothstep(R * 1.25, R * 0.7, r) * gain;
        gl_FragColor = vec4(c * 0.55, 1.0);
      }`,
  });
}
