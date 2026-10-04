// Space chorus: the city (the New York of the pre-chorus, with the Empire State, the Chrysler and One WTC).
// Chorus 1 opens here: the lanterns' star bursts above the hero's roof and lights rise from every window into
// the sky. Part C comes back down to it: a star falls into the hands of someone sitting alone on a roof edge in
// a dark city; she stands, lifts it, and on "wake the whole town" it bursts — windows and streets light up in a
// wave from her, rings of light run along the ground on the kicks, and the lights rise from every window again.
import * as THREE from 'three';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, skyDome } from '../lib/stage';
import { col } from '../lib/palette';
import { City } from '../lib/city';
import { Landmarks } from '../lib/landmarks';
import { GlowPoints } from '../lib/points';
import { LightMotes, RealFigure, bend, limbDir, loadBody } from '../lib/people';

export const ROOF = 48;
export const HERO = new THREE.Vector3(0, ROOF, -10);
/** Landmark spots (x, z, clear radius), as in the pre-chorus: Empire State, Chrysler, One WTC. */
export const LM: [number, number, number][] = [[-280, -1150, 95], [360, -1480, 60], [820, -2050, 75]];
const HALF = 1700, BLOCK = 110, STREET = 22;

export interface Spot { x: number; z: number; h: number; face: number }

export interface CityTimes {
  /** Chorus 1: the lanterns' star bursts at `burst`; lights rise from the windows from riseA. */
  burst: number; riseA: number;
  /** C: the falling star enters the sky at fall0 and lands in her hands at land; she stands, lifts it, wakes the town. */
  fall0: number; land: number; stand: number; raise: number; wake: number; town: number;
  /** D: lights rise from every window. */
  riseD: number;
  /** Beat times for the rings on the ground (after the wake). */
  ringBeats: number[];
  beatAt: (t: number) => number;
}

/** A flat raw colour (MeshBasicMaterial's output is colour-managed; this one is not). */
function flat(c: THREE.Color) {
  return new THREE.ShaderMaterial({ uniforms: { c: { value: c } }, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'uniform vec3 c; void main(){ gl_FragColor = vec4(c, 1.0); }' });
}

interface Riser { o: THREE.Vector3; t0: number; v: number; a: number; seed: number; ep: number }

export class CityWorld {
  st = new Stage(50, 0.3, 12000);
  city!: City;
  lm!: Landmarks;
  sky!: THREE.Mesh;
  stars = new GlowPoints(2200, 1.4);
  hero?: RealFigure;
  sitter!: RealFigure;
  motes = new LightMotes(120, 0.035, 1.6);
  overlay!: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  risers: Riser[] = [];
  lights!: GlowPoints;
  sparks = new GlowPoints(700, 0.45);
  /** Lights streaming up past the camera while it rises with them: windows [t0, t1], the path they follow, colour. */
  escort = new GlowPoints(900, 1.3, { fogDensity: 0.0005 });
  escorts: { a: number; b: number; path: (t: number) => THREE.Vector3; c: THREE.Color }[] = [];
  roofMat!: THREE.ShaderMaterial;
  lampBase!: Float32Array;
  lmWake: THREE.IUniform<number>[] = [];
  T!: CityTimes;
  /** The light in her hands (world), for the camera. */
  light = new THREE.Vector3();
  sitPos = new THREE.Vector3();

  constructor(public n: number, public spot: Spot, public tint: THREE.Color) {}

  async init() {
    const S = this.st, sp = this.spot;
    S.bg.copy(col('night', 0.4));
    this.sky = skyDome(new THREE.Color(0.003, 0.004, 0.012), new THREE.Color(0.045, 0.03, 0.032), new THREE.Color(0.02, 0.014, 0.018), 9000);
    const sr = mulberry32(21);
    for (let i = 0; i < this.stars.n; i++) {
      const a = sr() * Math.PI * 2, u = 0.05 + Math.pow(sr(), 0.7) * 0.95, Rr = 8000;
      this.stars.set(i, Math.cos(a) * Math.sqrt(1 - u * u) * Rr, u * Rr, Math.sin(a) * Math.sqrt(1 - u * u) * Rr, col('white', 0.5 + sr() * 1.5), 1, 0.5 + sr() * sr() * 2.5);
    }
    this.stars.commit();
    S.add(this.sky, this.stars);
    const clear: [number, number, number][] = [[0, -10, 40], [sp.x, sp.z, 34], ...LM];
    this.city = new City({ seed: 11, half: HALF, centre: [80, -950], downtownR: 520, clear, fog: 0.00075, clouds: 750 });
    S.add(this.city);
    this.lm = new Landmarks(this.city);
    this.lm.esb.position.set(LM[0]![0], 0, LM[0]![1]);
    this.lm.esb.rotation.y = 0.12;
    this.lm.chrysler.position.set(LM[1]![0], 0, LM[1]![1]);
    this.lm.chrysler.rotation.y = -0.3;
    this.lm.wtc.position.set(LM[2]![0], 0, LM[2]![1]);
    this.lm.wtc.rotation.y = 0.2;
    // (each landmark wakes when the wave reaches it, not with the whole city)
    for (const m of this.lm.mats) { const u = { value: 1 }; m.uniforms.wake = u; this.lmWake.push(u); }
    S.add(this.lm);
    const lamps = this.city.lamps;
    this.lampBase = lamps.colors.slice();

    // roofs: the hero's (chorus 1) and hers, slabs with the city's facades and a gravel top lit by the person on it
    this.roofMat = new THREE.ShaderMaterial({
      uniforms: { p: { value: new THREE.Vector3() }, c: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `uniform vec3 p, c; varying vec3 vW;
        float h(vec2 q){ q = mod(q, 97.0); return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){ float g = 0.6 + 0.6 * h(floor(vW.xz * 7.0)); float d = length(vW.xz - p.xz);
          vec3 col = vec3(0.008, 0.009, 0.013) * g + c * g * (0.5 * exp(-d * d / 4.0) + 0.1 * exp(-d / 5.0));
          gl_FragColor = vec4(col, 1.0); }`,
    });
    const slab = (x: number, z: number, w: number, d: number, h: number, seed: number) => {
      const sg = new THREE.BoxGeometry(1, 1, 1);
      sg.translate(0, 0.5, 0);
      sg.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array([seed, 0.3, 0.7, 0]), 4));
      sg.setAttribute('aTop', new THREE.InstancedBufferAttribute(new Float32Array([h]), 1));
      const m = new THREE.InstancedMesh(sg, this.city.mat, 1);
      m.setMatrixAt(0, new THREE.Matrix4().makeScale(w, h, d).setPosition(x, 0, z));
      m.frustumCulled = false;
      const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 0.3, d + 0.2), this.roofMat);
      top.position.set(x, h + 0.15, z);
      const rim = flat(new THREE.Color(0.012, 0.013, 0.02));
      const g = new THREE.Group();
      g.add(m, top);
      for (const [pw, pd, px, pz] of [[w, 0.4, 0, -d / 2], [w, 0.4, 0, d / 2], [0.4, d, -w / 2, 0], [0.4, d, w / 2, 0]] as const) {
        const pm = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.9, pd), rim);
        pm.position.set(x + px, h + 0.45, z + pz);
        g.add(pm);
      }
      S.add(g);
    };
    const [rpm, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    if (this.n === 1) {
      slab(0, -12, 34, 30, ROOF, 42);
      this.hero = new RealFigure(rpm, 'rpm', col('cyan', 1.1).lerp(col('blue', 1.3), 0.35));
      this.hero.position.copy(HERO).setY(ROOF + 0.3 + this.hero.hipHeight);
      this.hero.rotation.y = Math.PI;
      S.add(this.hero);
    }
    slab(sp.x, sp.z, 26, 24, sp.h, 57);
    this.sitPos.set(sp.x, sp.h, sp.z).addScaledVector(this.fwd(), 11.95);
    this.sitter = this.n === 2 ? new RealFigure(rpm, 'rpm', col('blue', 0.9).lerp(col('violet', 0.9), 0.3)) : new RealFigure(mi, 'michelle', col('blue', 0.9).lerp(col('cyan', 0.7), 0.3));
    S.add(this.sitter, this.motes);

    // the ground glow: the streets lit inside the wave, its front, rings on the kicks
    this.overlay = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2.4, HALF * 2.4), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { from: { value: new THREE.Vector3() }, R: { value: -1 }, c: { value: this.tint.clone() }, rings: { value: new Array(8).fill(-100) }, t: { value: 0 }, k: { value: 1 } },
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `
        uniform vec3 from, c; uniform float R, rings[8], t, k; varying vec3 vW;
        const float BLOCK = ${BLOCK.toFixed(1)}, STREET = ${STREET.toFixed(1)}, HALF = ${HALF.toFixed(1)};
        void main() {
          vec2 m = mod(vW.xz + HALF, BLOCK);
          vec2 dc = min(m, BLOCK - m);
          float st = max(1.0 - smoothstep(STREET * 0.5 - 1.5, STREET * 0.5 + 1.5, dc.x), 1.0 - smoothstep(STREET * 0.5 - 1.5, STREET * 0.5 + 1.5, dc.y));
          float centre = max(exp(-dc.x * dc.x / 8.0), exp(-dc.y * dc.y / 8.0));
          float d = length(vW.xz - from.xz);
          float inW = R < 0.0 ? 0.0 : 1.0 - smoothstep(R - 150.0, R, d);
          float fq = (d - R) / 60.0;
          float front = R < 0.0 ? 0.0 : exp(-fq * fq);
          vec3 col = c * (st * (0.1 + 0.25 * centre) * inW + (0.2 + st * 1.6) * front);
          for (int i = 0; i < 8; i++) {
            float age = t - rings[i];
            if (age < 0.0 || age > 2.5) continue;
            float rr = 30.0 + age * 900.0 - 160.0 * age * age;
            float q = (d - rr) / (14.0 + age * 30.0);
            col += c * exp(-q * q) * (0.6 + 1.6 * st) * exp(-age * 1.3) * 1.6;
          }
          float dist = length(vW - cameraPosition);
          gl_FragColor = vec4(col * k * exp(-dist * 0.00035), 1.0);
        }`,
    }));
    this.overlay.rotation.x = -Math.PI / 2;
    this.overlay.position.y = 0.1;
    this.overlay.renderOrder = 2;
    S.add(this.overlay);

    // risers: lights from windows (A: round the hero's roof, chorus 1; D: everywhere, in a wave from her)
    const rr = mulberry32(this.n * 17 + 5);
    const boxes = this.city.boxes;
    const near = (cx: number, cz: number, rad: number) => boxes.filter(([x, z]) => Math.hypot(x - cx, z - cz) < rad);
    const addRisers = (ep: number, list: typeof boxes, count: number) => {
      for (let i = 0; i < count; i++) {
        const [x, z, w, d, h] = list[Math.floor(rr() * list.length)]!;
        const side = rr();
        const ox = side < 0.5 ? x + (rr() - 0.5) * w : x + (side < 0.75 ? -w / 2 - 0.5 : w / 2 + 0.5);
        const oz = side < 0.5 ? z + (rr() < 0.5 ? -d / 2 - 0.5 : d / 2 + 0.5) : z + (rr() - 0.5) * d;
        this.risers.push({ o: new THREE.Vector3(ox, 6 + rr() * Math.max(4, h - 8), oz), t0: rr(), v: 20 + rr() * 40, a: 110 + rr() * 480, seed: rr() * 100, ep });
      }
    };
    addRisers(0, this.n === 1 ? near(0, -500, 1300) : near(sp.x, sp.z - 500, 1300), 1800);
    addRisers(1, near(sp.x, sp.z - 400, 1700), 2600);
    this.lights = new GlowPoints(this.risers.length, 1.5, { fogDensity: 0.00045 });
    S.add(this.lights, this.sparks, this.escort);
  }

  /** Per frame: everything but the camera. */
  update(t: number) {
    const T = this.T, sp = this.spot, cam = this.st.cam, tint = this.tint;
    this.city.update(t, cam.position);
    this.sky.position.copy(cam.position);
    this.stars.position.copy(cam.position);
    const n1 = this.n === 1;
    // chorus 1 opens on the golden city of the pre-chorus, cooling as we rise
    const goldK = n1 ? 0.9 * (1 - smoothstep(T.riseA + 0.4, T.riseA + 2.2, t)) * (t < T.fall0 - 2 ? 1 : 0) : 0;
    this.city.gold = goldK;
    this.city.goldWave(HERO, goldK > 0 ? 4000 : 1e9);
    this.lm.update(t, new THREE.Color(0.9, 0.88, 0.8).lerp(new THREE.Color(1.0, 0.7, 0.25), goldK).lerp(tint, smoothstep(T.wake, T.town, t) * 0.6));
    // the waking: a dark town (a few windows), then the wave from her
    const u = this.city.mat.uniforms;
    const inC = t > T.fall0 - 2.5;
    const R = t < T.wake ? -1 : 3400 * ease.outCubic(prog(t, T.wake, T.town + 0.6)) + 40;
    (u.wakeFrom!.value as THREE.Vector3).set(sp.x, 0, sp.z);
    if (!inC) { this.city.wake = 1; u.wakeR!.value = 1e9; }
    else if (t < T.wake) { this.city.wake = 0.1; u.wakeR!.value = 1e9; }
    else { this.city.wake = 1; u.wakeR!.value = R; u.wakeSoft!.value = 140; }
    LM.forEach(([x, z], i) => { const d = Math.hypot(x - sp.x, z - sp.z); this.lmWake[i]!.value = !inC ? 1 : t < T.wake ? 0.15 : 0.15 + 0.85 * smoothstep(d - 150, d, R); });
    const ou = this.overlay.material.uniforms;
    (ou.from!.value as THREE.Vector3).set(sp.x, 0, sp.z);
    ou.R!.value = inC ? R : -1;
    this.overlay.visible = inC && t > T.wake - 0.1;
    ou.t!.value = t;
    const rings = ou.rings!.value as number[];
    const rb = T.ringBeats.filter((b) => b <= t + 0.01).slice(-8);
    for (let i = 0; i < 8; i++) rings[i] = rb[i] ?? -100;
    // streetlights brighten inside the wave
    const L = this.city.lamps, base = this.lampBase;
    for (let i = 0; i < L.n; i++) {
      const x = L.pos[i * 3]!, z = L.pos[i * 3 + 2]!;
      const inW = R < 0 ? 0 : 1 - smoothstep(R - 150, R, Math.hypot(x - sp.x, z - sp.z));
      const g = 1 + 1.2 * inW;
      L.colors[i * 3] = base[i * 3]! * g + tint.r * 0.4 * inW; L.colors[i * 3 + 1] = base[i * 3 + 1]! * g + tint.g * 0.4 * inW; L.colors[i * 3 + 2] = base[i * 3 + 2]! * g + tint.b * 0.4 * inW;
    }
    L.commit();
    this.roofMat.uniforms.p!.value.copy(this.sitter.position);

    // ---- chorus 1's hero, both arms up, gold fading to his own blue ----
    if (this.hero) {
      const h = this.hero;
      h.visible = t < T.fall0 - 2;
      const s = (i: number) => (i ? 1 : -1);
      for (const i of [0, 1]) { const ua = limbDir(s(i), 2.7 + 0.08 * Math.sin(t * 2 + i), 0.25); h.setArm(i, ua, bend(ua, new THREE.Vector3(-s(i) * 0.3, 0.2, 1), 0.25)); h.setHand(i, 0.15); }
      h.setSpine(-0.16, 0.03 * Math.sin(t * 0.7), -0.5, 0);
      const gu = h.mat.uniforms;
      (gu.gold!.value as THREE.Color).copy(col('gold', 1.6));
      (gu.goldO!.value as THREE.Vector3).copy(h.position);
      gu.goldR!.value = 3 * (1 - smoothstep(T.riseA + 0.5, T.riseA + 2, t));
      gu.level!.value = 1 + 1.5 * pulse(t, T.burst, 0.3);
      h.time = t;
    }

    // ---- her ----
    this.poseSitter(t);

    // ---- risers ----
    const lp = this.lights;
    const lantern = new THREE.Color(1.0, 0.82, 0.55);
    this.risers.forEach((r, i) => {
      let t0: number;
      if (r.ep === 0) t0 = T.riseA + r.t0 * 1.6 + Math.hypot(r.o.x - (this.n === 1 ? 0 : sp.x), r.o.z - (this.n === 1 ? -400 : sp.z - 500)) / 2500;
      else t0 = T.riseD + Math.hypot(r.o.x - sp.x, r.o.z - sp.z) / 3000 + r.t0 * 0.9;
      const age = t - t0;
      if (age < 0 || (r.ep === 0 && t > T.fall0 - 2) || (r.ep === 1 && t < T.riseD - 0.1)) { lp.hide(i); return; }
      const y = r.o.y + r.v * age + 0.5 * r.a * age * age;
      const wx = noise1(r.seed + age * 0.6, 3) * 8 * age, wz = noise1(r.seed + age * 0.5, 7) * 8 * age;
      const c = r.ep === 0 ? lantern.clone().lerp(col('gold', 1.4), goldK * 0.6) : lantern.clone().lerp(tint, 0.35);
      const flick = 0.8 + 0.2 * noise1(t * 3 + r.seed, 11);
      lp.set(i, r.o.x + wx, y, r.o.z + wz, c, smoothstep(0, 0.25, age) * flick * 3.2, 1.2 + (r.seed % 1) * 1.6);
    });
    lp.commit();

    // ---- escorts: a column of lights rising faster than the camera, round its path ----
    let ne = 0;
    const es = this.escorts.find((e) => t > e.a - 0.05 && t < e.b + 0.4);
    if (es) {
      const ctr = es.path(Math.min(t, es.b)), H = 900;
      const fade = smoothstep(es.a - 0.05, es.a + 0.35, t) * (1 - smoothstep(es.b, es.b + 0.4, t));
      for (let i = 0; i < this.escort.n; i++) {
        const a = hash(i, 1) * Math.PI * 2, rad = 6 + Math.pow(hash(i, 2), 0.8) * 260;
        const v = 140 + hash(i, 3) * 260;
        const y = ((hash(i, 4) * H + v * (t - es.a)) % H) - H * 0.4;
        const edge = smoothstep(-H * 0.4, -H * 0.3, y) * (1 - smoothstep(H * 0.45, H * 0.6, y));
        const x = ctr.x + Math.cos(a) * rad + noise1(t * 0.7 + i, 5) * 4, z = ctr.z + Math.sin(a) * rad + noise1(t * 0.6 + i, 9) * 4;
        const flick = 0.8 + 0.2 * noise1(t * 3 + i, 11);
        this.escort.set(ne++, x, ctr.y + y, z, es.c, fade * edge * flick * 2.6, 0.8 + hash(i, 6) * 1.4);
      }
    }
    this.escort.commit(ne);

    // ---- sparks: chorus 1's burst; her star falling; its burst on "wake" ----
    const spk = this.sparks;
    let ns = 0;
    if (n1 && t < T.riseA + 3) {
      const c0 = new THREE.Vector3(0, ROOF + 9, -11);
      const bt = t - T.burst;
      if (bt > -0.4) {
        const pre = clamp(1 + bt / 0.4);
        spk.set(ns++, c0.x, c0.y, c0.z, col('white', 3).lerp(col('gold', 3), 0.4), (bt < 0 ? pre * 3 : 4 * Math.pow(0.5, bt / 0.15)), 20 + 50 * clamp(bt * 4));
        if (bt > 0) for (let i = 0; i < 420; i++) {
          const a = hash(i, 1) * Math.PI * 2, z = hash(i, 2) * 2 - 1, sp2 = 30 + hash(i, 3) * 90;
          const dir = new THREE.Vector3(Math.sqrt(1 - z * z) * Math.cos(a), z * 0.6 + 0.5, Math.sqrt(1 - z * z) * Math.sin(a));
          const dd = sp2 * (1 - Math.exp(-bt * 2.2)) / 2.2;
          const p = c0.clone().addScaledVector(dir, dd);
          p.y += 12 * bt * bt;
          spk.set(ns++, p.x, p.y, p.z, col('gold', 2).lerp(col('white', 2), hash(i, 4)), Math.exp(-bt * 0.9) * (0.6 + hash(i, 5)), 0.7 + hash(i, 6) * 0.8);
        }
      }
    }
    // her star: falls out of the sky and comes down in her hands, glows there, lifted, then bursts on "wake"
    const hands = this.sitter.hand(0).add(this.sitter.hand(1)).multiplyScalar(0.5);
    if (t > T.fall0 - 0.2 && t < T.wake + 2.5) {
      const top = new THREE.Vector3(sp.x + 260, 1900, sp.z + 520);
      const k = ease.outCubic(prog(t, T.fall0, T.land));
      const p = t < T.land ? top.clone().lerp(hands, k) : hands.clone();
      if (t < T.land) p.x += Math.sin(k * Math.PI) * 60;
      this.light.copy(p);
      const glowK = t < T.wake ? 1 + 0.8 * pulse(t, T.land, 0.3) + 0.6 * smoothstep(T.raise, T.wake, t) : 0;
      spk.set(ns++, p.x, p.y, p.z, col('white', 3).lerp(tint, 0.3), glowK * 2.5, 0.5 + 0.4 * smoothstep(T.raise, T.wake, t));
      spk.set(ns++, p.x, p.y, p.z, tint, glowK * 0.9, 2.5 + 1.5 * smoothstep(T.raise, T.wake, t));
      if (t < T.land) for (let k2 = 1; k2 < 14; k2++) { // its tail
        const q = top.clone().lerp(hands, ease.outCubic(prog(t - k2 * 0.02, T.fall0, T.land)));
        spk.set(ns++, q.x, q.y, q.z, tint, (1 - k2 / 14) * 1.2, 1.4 - k2 * 0.06);
      }
      const bt = t - T.wake;
      if (bt > 0) {
        spk.set(ns++, p.x, p.y, p.z, col('white', 4), 5 * Math.pow(0.5, bt / 0.12), 3 + 60 * clamp(bt * 3));
        for (let i = 0; i < 240; i++) {
          const a = hash(i, 11) * Math.PI * 2, z = hash(i, 12) * 2 - 1, v = 6 + hash(i, 13) * 40;
          const dir = new THREE.Vector3(Math.sqrt(1 - z * z) * Math.cos(a), Math.abs(z) * 0.8 + 0.2, Math.sqrt(1 - z * z) * Math.sin(a));
          const q = p.clone().addScaledVector(dir, v * (1 - Math.exp(-bt * 2)) / 2);
          q.y -= 2 * bt * bt;
          spk.set(ns++, q.x, q.y, q.z, col('white', 2).lerp(tint, hash(i, 14)), Math.exp(-bt * 1.2) * 1.4, 0.15 + hash(i, 15) * 0.25);
        }
      }
    }
    spk.commit(ns);
    this.st.scene.fog = null;
  }

  /** The way she faces (toward the skyline). */
  fwd() { return new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + this.spot.face); }

  /** Where the falling star is (before it lands; after, roughly her hands) — a pure function of t, for the camera. */
  fallPos(t: number, out = new THREE.Vector3()) {
    const T = this.T, sp = this.spot;
    const top = new THREE.Vector3(sp.x + 260, 1900, sp.z + 520), hands = this.sitPos.clone().add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(this.fwd(), 0.25);
    const k = ease.outCubic(prog(t, T.fall0, T.land));
    out.copy(top).lerp(hands, k);
    if (t < T.land) out.x += Math.sin(k * Math.PI) * 60;
    return out;
  }

  /** She sits on the roof edge, head down; the star lands in her hands; she looks up, stands, lifts it, and it bursts. */
  private poseSitter(t: number) {
    const T = this.T, sp = this.spot, h = this.sitter;
    const inC = t > T.fall0 - 2.5;
    h.visible = inC;
    this.motes.visible = inC && t > T.land - 0.2;
    if (!inC) return;
    const s = (i: number) => (i ? 1 : -1);
    const stand = ease.inOutCubic(prog(t, T.stand - 0.1, T.stand + 0.55));
    const hold = ease.inOutCubic(prog(t, T.land - 0.5, T.land + 0.1));
    const lift = ease.inOutCubic(prog(t, T.raise - 0.1, T.wake - 0.05));
    const burst = ease.outExpo(prog(t, T.wake, T.wake + 0.5));
    const look = ease.inOutCubic(prog(t, T.land, T.land + 0.8));
    // facing the skyline (-z rotated by face); she sits at the roof edge
    h.rotation.y = Math.PI + sp.face;
    const fwd = this.fwd(), edge = this.sitPos;
    const sitP = edge.clone().addScaledVector(fwd, -0.05).setY(sp.h + 0.3 + 0.9 + 0.1);
    const standP = edge.clone().addScaledVector(fwd, -1.1).setY(sp.h + 0.3 + h.hipHeight);
    h.position.copy(sitP).lerp(standP, stand);
    h.position.y += Math.sin(Math.PI * stand) * 0.06;
    // legs: over the edge (thighs forward, shins hanging) → standing
    for (const i of [0, 1]) {
      const th = limbDir(s(i), 0.1, lerp(1.45, 0.02, stand)), sh = limbDir(s(i), 0.05, lerp(0.1 + 0.08 * Math.sin(t * 1.3 + i * 2), 0, stand));
      h.setLeg(i, th, sh);
    }
    const slump = 1 - Math.max(look * 0.6, stand);
    h.setSpine(0.32 * slump - 0.18 * lift - 0.1 * burst, 0.02 * Math.sin(t * 0.6), lerp(0.75, -0.1, Math.max(look * 0.7, stand)) - 0.45 * lift, 0.08 * slump);
    // arms: in the lap → cupping the light at the chest → overhead → flung open on the burst
    for (const i of [0, 1]) {
      const lap = limbDir(s(i), 0.18, 0.55), open = limbDir(s(i), 2.5, 0.25);
      const ua = lap.clone().lerp(open, burst).normalize();
      h.setArm(i, ua, bend(ua, new THREE.Vector3(-s(i) * 0.5, 0.3, 1), lerp(1.2, 0.2, burst)));
      h.setHand(i, lerp(0.35, 0.1, burst));
    }
    if (burst < 1 && hold > 0) {
      h.updateMatrixWorld(true);
      const chest = h.spinePoint(0, 0.22, 0.32), over = h.spinePoint(0, 1.25, 0.15);
      const c = chest.lerp(over, lift);
      for (const i of [0, 1]) {
        const tgt = c.clone().add(new THREE.Vector3(s(i) * 0.07, 0, 0).applyQuaternion(h.quaternion));
        const rest = h.hand(i);
        h.reach(i, rest.lerp(tgt, hold * (1 - burst)), new THREE.Vector3(s(i) * 0.6, -0.5, 0.2));
      }
    }
    // her light: dim and grey until the star lands; then it spreads from her hands through her
    const gu = h.mat.uniforms;
    (gu.gold!.value as THREE.Color).copy(this.tint).multiplyScalar(1.1).lerp(new THREE.Color(1, 1, 1), 0.25);
    h.updateMatrixWorld(true);
    (gu.goldO!.value as THREE.Vector3).copy(h.hand(0).add(h.hand(1)).multiplyScalar(0.5));
    gu.goldR!.value = t < T.land ? -1 : 3.5 * ease.outCubic(prog(t, T.land, T.land + 1.2));
    gu.level!.value = (t < T.land ? 0.35 : 0.35 + 0.65 * smoothstep(T.land, T.land + 0.8, t)) * (1 + 1.2 * pulse(t, T.wake, 0.25));
    h.time = t;
    this.motes.update(h, t, this.tint, t < T.land ? 0 : 1.2);
    (this.roofMat.uniforms.c!.value as THREE.Color).copy(this.tint).multiplyScalar(t < T.land ? 0.02 : 0.12 * (1 + 3 * pulse(t, T.wake, 0.3)));
  }
}
