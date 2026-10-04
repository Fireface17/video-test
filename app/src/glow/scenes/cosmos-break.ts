// The old break (cosmos n = 2), kept as it was while break 2 is being rethought as a city scene: floating
// above the night Earth among slow star-figure dancers, two of them slow-dance, then the camera rises faster
// and faster toward a bright point in deep blue space (the zoom into the bridge is centred on it).
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim, skyDome } from '../lib/stage';
import { col } from '../lib/palette';
import { RealFigure, loadBody, limbDir, bend, dance } from '../lib/people';
import { starJoints } from '../lib/stars';
import { Earth } from '../lib/earth';
import { StarStreaks } from './fall-stars';
import { Flares, FigureBatch, J, PoseBank, StarLines, frame, place, ring, type FigLook, type Pose } from './cosmos-gfx';
import { densityMap, galaxy, nebula, starField } from './cosmos-sky';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const ID = new THREE.Quaternion();
const N_STREAK = 2200;

type Kind = 'float' | 'duet' | 'rise';
interface Shot { t0: number; t1: number; kind: Kind; seed: number; o: Record<string, any> }
interface Look {
  star: THREE.Color; line: THREE.Color; accent: THREE.Color; join: THREE.Color;
  skyTop: THREE.Color; skyHor: THREE.Color; gas: THREE.Color; fil: THREE.Color; streak: THREE.Color; streak2: THREE.Color;
}
interface Ripple { c: THREE.Vector3; t0: number; v: number; w: number; k: number }

export class CosmosBreak extends Scene {
  st = new Stage(55, 0.1, 6000);
  n = 1;
  shots: Shot[] = [];
  beats: number[] = [];
  downs: number[] = [];
  chops: [number, number][] = [];
  look!: Look;
  bank!: PoseBank;
  pairFigs: RealFigure[] = [];
  figs = new FigureBatch(9000, 7000);
  fx = new StarLines(2400, 0.7);
  flares = new Flares(64);
  streaks = new StarStreaks(N_STREAK, 0.05, { maxPx: 9 });
  streakSeed = new Float32Array(N_STREAK * 5);
  sky!: THREE.Mesh;
  neb!: THREE.Mesh;
  far!: THREE.Points;
  gal!: THREE.Points & { material: THREE.ShaderMaterial };
  earth = new Earth();
  earthOn = false;
  T = { take1: 0, hand1: 0, take2: 0, hand2: 0 };
  // per-frame
  private rip: Ripple[] = [];
  private kick = 0;
  private flash = 0;
  private shake = 0;
  private jt: THREE.Vector3[] = [];
  private jA: THREE.Vector3[] = [];
  private jB: THREE.Vector3[] = [];

  override async init() {
    const { audio, params } = this.ctx;
    this.n = params.n ?? 1;
    const w0 = this.ctx.start - 2, w1 = this.ctx.end + 2;
    this.beats = audio.beats.filter((b) => b >= w0 - 4 && b <= w1);
    this.downs = audio.downbeats.filter((d) => d >= w0 - 4 && d <= w1 + 2);
    this.chops = audio.events('chop', w0, w1);
    this.look = this.makeLook();
    const S = this.st;
    S.bg.copy(col('night', 0.4));
    this.sky = skyDome(this.look.skyTop, this.look.skyHor, this.look.skyTop, 3000);
    this.neb = nebula(densityMap(512, 256, 3 + this.n * 17), 2800);
    const nm = (this.neb.material as THREE.ShaderMaterial).uniforms;
    (nm.gas!.value as THREE.Color).copy(this.look.gas);
    (nm.fil!.value as THREE.Color).copy(this.look.fil);
    this.far = starField(4200, 2600, 11 + this.n, this.look.streak2, 0.35);
    this.gal = galaxy(9000, 40 + this.n) as THREE.Points & { material: THREE.ShaderMaterial };
    this.gal.renderOrder = -2;
    S.add(this.sky, this.neb, this.far, this.gal, this.figs, this.fx, this.flares, this.streaks);
    this.streaks.renderOrder = 2;
    const sr = mulberry32(77 + this.n);
    for (let i = 0; i < N_STREAK; i++) {
      const a = sr() * TAU, r = 2.5 + Math.pow(sr(), 1.7) * 60;
      this.streakSeed.set([Math.cos(a) * r, Math.sin(a) * r, sr() * 260, 0.6 + Math.pow(sr(), 5) * 3, sr()], i * 5);
    }
    // bodies: two for the pose bank (the crowd), two for the pair (posed with IK)
    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    const white = col('white');
    this.bank = new PoseBank([new RealFigure(rp!, 'rpm', white), new RealFigure(mi!, 'michelle', white)]);
    this.pairFigs = [new RealFigure(rp!, 'rpm', white), new RealFigure(mi!, 'michelle', white)];
    if (this.n !== 1) {
      await this.earth.init();
      S.add(this.earth);
    }
    this.shots = this.makeShots();
  }

  private makeLook(): Look {
    return {
      star: col('white', 2.0).lerp(col('#9fb4ff', 2.0), 0.3), line: col('violet', 0.36).lerp(col('blue', 0.42), 0.55), accent: col('blue', 1.3).lerp(col('white', 1.3), 0.45), join: col('gold', 2.4),
      skyTop: col('night', 0.7), skyHor: col('dusk', 0.6).lerp(col('blue', 0.06), 0.4), gas: col('blue', 0.15).lerp(col('violet', 0.15), 0.3), fil: col('violet', 0.12).lerp(col('blue', 0.12), 0.5),
      streak: col('#dfe6ff', 1), streak2: col('blue', 1),
    };
  }

  private makeShots(): Shot[] {
    const B = (k: number) => this.bar(k);
    const s = (t0: number, t1: number, kind: Kind, o: Record<string, any> = {}, seed = 0): Shot => ({ t0, t1, kind, o, seed: seed || Math.round(t0 * 10) });
    const end = this.ctx.end + 3;
    return [
      s(this.ctx.start, B(3), 'float'),
      s(B(3), B(5), 'duet'),
      s(B(5), end, 'rise'),
    ];
  }

  /** Time of the k-th downbeat of the entry (k = 0 at ctx.start). */
  bar(k: number) {
    const i0 = this.downs.findIndex((d) => d >= this.ctx.start - 0.05);
    const d = this.downs[i0 + k];
    return d ?? this.ctx.start + k * 1.6;
  }

  /** Continuous bars since t0 (downbeat grid). */
  private bars(t: number, t0: number) { return this.ctx.audio.barAt(t) - this.ctx.audio.barAt(t0); }

  /** Beat pulse on the grid (the four-on-the-floor kick), sharpened by the detected kicks. */
  private kickAt(t: number) {
    const a = this.ctx.audio, b = a.timeOfBeat(Math.floor(a.beatAt(t) + 1e-4));
    return Math.max(pulse(t, b, 0.09) * 0.85, a.hit('kick', t, 0.08));
  }

  // ---- figures ----

  private put(pose: Pose, pos: THREE.Vector3Like, q: THREE.Quaternion, s: number, mirror: boolean, L: FigLook) {
    const j = place(pose, pos, q, s, mirror, this.jt);
    L.k *= 1 + this.rippleAt(j[J.neck]!);
    this.figs.figure(j, s, L);
    return j;
  }

  private rippleAt(p: THREE.Vector3, t = this.tNow) {
    let k = 0;
    for (const r of this.rip) {
      const age = t - r.t0;
      if (age < 0) continue;
      const d = (p.distanceTo(r.c) - r.v * age) / r.w;
      k += r.k * Math.exp(-d * d) * Math.pow(0.5, age / 0.6);
    }
    return k;
  }
  private tNow = 0;

  /** Chop bursts in this shot: a ring of light at `at(tc)` and a ripple through the figures. */
  private chopBursts(t: number, sh: Shot, at: (tc: number, k: number, i: number) => { c: THREE.Vector3; n: THREE.Vector3; R: number }, gain = 1) {
    const L = this.look;
    this.chops.forEach(([tc, k], i) => {
      if (tc < sh.t0 - 0.02 || tc > t || t - tc > 1.8) return;
      const g = (0.55 + 0.6 * k) * gain;
      const { c, n, R } = at(tc, k, i);
      const age = t - tc, e = ease.outExpo(clamp(age / 0.7));
      const fade = Math.pow(0.5, age / 0.32);
      ring(this.fx, c, n, R * (0.08 + 0.92 * e), L.accent, 1.3 * g * fade, R * 0.0035 * (1 + 3 * (1 - e)), 96);
      ring(this.fx, c, n, R * 0.7 * e, L.star, 0.45 * g * fade * fade, R * 0.002, 80);
      this.flares.glow(c, L.accent, 1.1 * g * pulse(t, tc, 0.08), R * 0.16);
      this.flares.glow(c, L.star, 0.18 * g * pulse(t, tc, 0.15), R * 0.1, 7, 6);
      this.rip.push({ c, t0: tc, v: (R * 0.9) / 0.45, w: R * 0.22, k: 2.4 * g });
      // sparks thrown out along the ring
      const r = mulberry32(i * 31 + 7);
      const nn = n.clone().normalize(), a = Math.abs(nn.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
      const u = V().crossVectors(nn, a).normalize(), w = V().crossVectors(nn, u);
      for (let q = 0; q < 40; q++) {
        const th = r() * TAU, sp = 0.6 + 0.6 * r();
        const p = c.clone().addScaledVector(u, Math.cos(th) * R * e * sp).addScaledVector(w, Math.sin(th) * R * e * sp).addScaledVector(nn, (r() - 0.5) * R * 0.15 * e);
        this.figs.star(p, r() < 0.4 ? L.star : L.accent, 1.4 * g * fade, R * (0.006 + 0.01 * r()));
      }
      if (age < 0.12) this.shake = Math.max(this.shake, k * (1 - age / 0.12));
    });
  }

  // ---- render ----

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t;
    this.tNow = t;
    const sh = this.shots.find((s) => t < s.t1) ?? this.shots[this.shots.length - 1]!;
    this.kick = this.n === 2 ? 0.35 * this.kickAt(t) : this.kickAt(t);
    this.flash = 0;
    this.shake = 0;
    this.rip.length = 0;
    this.bank.begin();
    this.figs.begin();
    this.fx.begin();
    this.flares.begin();
    this.gal.visible = false;
    this.earth.visible = false;
    this.streaks.visible = false;
    const cam = this.st.cam;
    cam.fov = 55;
    // the sky turns with each shot, so every cut lands on a new piece of it
    const r = mulberry32(sh.seed);
    this.neb.rotation.set((r() - 0.5) * 1.4, r() * TAU + (t - sh.t0) * 0.02, (r() - 0.5) * 0.8);
    this.far.rotation.copy(this.neb.rotation);
    const sky = (this.sky.material as THREE.ShaderMaterial).uniforms;
    (sky.glow!.value as THREE.Color).setRGB(0, 0, 0);
    let post: Record<string, any> = {};

    switch (sh.kind) {
      case 'float': this.float(t, sh); break;
      case 'duet': this.duet(t, sh); break;
      case 'rise': post = this.rise(t, sh); break;
    }

    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    for (const o of [this.sky, this.neb, this.far]) o.position.copy(cam.position);
    this.figs.end();
    this.fx.end();
    this.flares.end();
    this.st.render(this.ctx.renderer, out);
    const k = this.kick, sk = this.shake;
    return {
      bloom: 0.95 + 0.25 * k, bloomThreshold: 0.75, bloomRadius: 0.85, halation: 0.14 + (this.n === 3 ? 0.08 : 0), vignette: 0.45, grain: 0.05,
      ca: 0.6 + 1.2 * k + 2 * sk, zoom: 1 + 0.018 * k, flash: this.flash,
      shake: [noise1(t * 37, 1) * 10 * sk, noise1(t * 37, 2) * 10 * sk] as [number, number],
      ...post,
    };
  }

  private skyGlow(dir: THREE.Vector3, c: THREE.Color) {
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    (u.glowDir!.value as THREE.Vector3).copy(dir).normalize();
    (u.glow!.value as THREE.Color).copy(c);
  }

  // ---- shots ----

  /** Stars streaming past along `axis` (camera-relative column round it), at speed v. */
  private warpStreaks(S: number, v: number, axis: THREE.Vector3, gain = 1) {
    if (v < 0.5) return;
    const ss = this.streakSeed, L = this.look;
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), axis.clone().normalize());
    const p = V(), c = new THREE.Color();
    for (let i = 0; i < N_STREAK; i++) {
      const o = i * 5, h = ss[o + 4]!;
      const z = -230 + ((((ss[o + 2]! + S) % 260) + 260) % 260);
      const edge = smoothstep(-230, -180, z) * (1 - smoothstep(20, 30, z));
      p.set(ss[o]!, ss[o + 1]!, z).applyQuaternion(q);
      c.copy(h < 0.3 ? L.streak2 : L.streak);
      this.streaks.set(i, p.x, p.y, p.z, c, (0.35 + 0.8 * h) * edge * gain * (1 + 0.6 * this.kick), ss[o + 3]!);
    }
    this.streaks.setMotion(axis.clone().normalize().multiplyScalar(v), 1 / 40);
    this.streaks.commit();
    this.streaks.visible = true;
  }

  /**
   * The pair (pair frame, unit scale: pelvis of A at -sep/2, B at +sep/2, facing +z): dancing, inner hands
   * reaching for each other (`hold` 0..1 to the grip at `grip`), B's outer hand raised (as on the ceiling).
   * Joints go to this.jA / this.jB, placed by (pos, q, P).
   */
  private posePair(beat: number, sep: number, hold: number, grip: THREE.Vector3, pos: THREE.Vector3, q: THREE.Quaternion, P: number, styles: [number, number], raise = 1, energy = 1, turn = 0.25) {
    const [A, B] = this.pairFigs as [RealFigure, RealFigure];
    const figs = [A, B];
    figs.forEach((fig, i) => {
      const s = i === 0 ? -1 : 1;
      fig.position.set((s * sep) / 2, 0, 0);
      fig.quaternion.setFromAxisAngle(V(0, 1, 0), -s * turn);
      for (const k of [0, 1]) fig.setFoot(k, 0);
      const style = styles[i]!;
      const bounce = style < 4 ? dance(fig, beat + i * 0.04, style, energy, i) : 0;
      fig.position.y = bounce;
      if (i === 1 && raise > 0) {
        // B's outer (left, +x) hand up high
        const u = limbDir(1, lerp(1.2, 2.75, raise), 0.15);
        fig.setArm(1, u, bend(u, V(-0.3, 0.2, 1), 0.2));
      }
    });
    figs.forEach((fig, i) => {
      const s = i === 0 ? -1 : 1, inner = i === 0 ? 1 : 0;
      const relaxed = fig.hand(inner);
      const target = grip.clone().add(V(-s * 0.035, 0, 0));
      fig.reach(inner, relaxed.lerp(target, hold), V(0, -0.6, -0.6));
      fig.setHand(inner, 0.15 + 0.45 * hold);
    });
    starJoints(A, this.jA);
    starJoints(B, this.jB);
    for (const j of [this.jA, this.jB]) for (const v of j) v.multiplyScalar(P).applyQuaternion(q).add(pos);
  }

  /**
   * People rising from the Earth (radius R, top at y = 0): born at random times in [t0, t0 + span] on the
   * surface ahead of `from` (dmin..dmax away), a point of light that rises and unfolds into a dancer.
   */
  private risers(t: number, beat: number, o: { n: number; t0: number; span: number; R: number; from: THREE.Vector3; speed: number; scale: number; style: number; k: number; seed: number; dmin: number; dmax: number; energy?: number }) {
    const L = this.look;
    for (let i = 0; i < o.n; i++) {
      const hs = (k: number) => hash(i, o.seed, k);
      const tb = o.t0 + hs(1) * o.span, age = t - tb;
      if (age < 0) continue;
      const d = o.dmin + (o.dmax - o.dmin) * Math.sqrt(hs(2)), az = (hs(3) - 0.5) * 1.5;
      const x = o.from.x + Math.sin(az) * d, z = o.from.z - Math.cos(az) * d;
      const ground = -(o.R - Math.sqrt(Math.max(0, o.R * o.R - x * x - z * z)));
      const v = o.speed * (0.7 + 0.6 * hs(4));
      const p = V(x + noise1(t * 0.3, i) * 2, ground + age * v + 0.15 * v * age * age, z);
      const grow = smoothstep(0.15, 1.6, age);
      const s = lerp(0.3, o.scale * (0.75 + 0.5 * hs(5)) * (0.6 + d / o.dmax), grow);
      const fade = smoothstep(0, 0.35, age);
      // the light it was born as, bright at first
      this.figs.star(V(p.x, p.y + 0.2 * s, p.z), L.star, fade * (1.6 * (1 - grow) + 0.2) * o.k, (0.25 + 0.4 * (1 - grow)) * (1 + d / 80));
      if (grow <= 0.01) continue;
      const pose = this.bank.get(i % 2, beat - (i % 3) * 0.1, o.style, o.energy ?? 1, 0);
      const up = V(noise1(t * 0.2, i + 9) * 0.25, 1, noise1(t * 0.2, i + 19) * 0.25);
      this.put(pose, p, frame(up, V(o.from.x - x, 0, o.from.z - z + 1e-3)), s, i % 2 === 1, { star: L.star, line: L.line, k: fade * o.k, draw: grow });
    }
  }

  /** The Earth below (radius R, top of the sphere at y = 0) with the sun toward `sun` and dawn `dawn`. */
  private useEarth(R: number, sun: THREE.Vector3, dawn: number, cityGain = 1, air = 1) {
    const e = this.earth;
    e.visible = true;
    e.scale.setScalar(R / e.radius);
    e.position.set(0, -R, 0);
    // (turned so lit cities sit under us)
    e.rotation.set(0.9, -0.2, 0.1);
    const su = e.surface.material.uniforms, au = e.air.material.uniforms;
    (su.sun!.value as THREE.Vector3).copy(sun).normalize();
    su.dawn!.value = dawn;
    su.cityGain!.value = cityGain;
    (au.sun!.value as THREE.Vector3).copy(sun).normalize();
    au.dawn!.value = dawn * 0.6;
    au.k!.value = air;
    // (the blue shell plus the orange dawn reads pink: at sunrise the air is gold)
    (au.color!.value as THREE.Color).setRGB(0.12, 0.3, 1.0).lerp(new THREE.Color(1.0, 0.6, 0.22), clamp(dawn) * 0.85);
    // (a thinner shell than the Earth's own: seen this close, 3.5% of the radius reads as a thick band)
    e.air.scale.setScalar(1.012 / 1.035);
    e.time = this.tNow;
  }

  /** Break: floating above the night Earth; lights rise from the cities and unfold into slow dancers. */
  private float(t: number, sh: Shot) {
    const cam = this.st.cam, a = this.ctx.audio;
    const lt = t - sh.t0, beat = a.beatAt(t) / 2; // half time
    const R = 420, h0 = 45, dip = Math.acos(R / (R + h0));
    this.useEarth(R, V(1, -0.3, 0.2), 0, 0.8, 0.4);
    const pos = V(Math.sin(lt * 0.1) * 3, h0 + lt * 1.5, -lt * 3);
    const pitch = lerp(-dip - 10 * DEG, -dip + 9 * DEG, prog(t, sh.t0 - 0.5, sh.t1, ease.inOutQuad));
    aim(cam, pos, pos.clone().add(V(0.08 * Math.sin(lt * 0.25), Math.sin(pitch), -Math.cos(pitch))), 0.06 * Math.sin(lt * 0.3) - 0.08);
    cam.fov = 54;
    this.risers(t, beat, { n: 56, t0: sh.t0 - 9, span: sh.t1 - sh.t0 + 9, R, from: V(0, h0, 0), speed: 3.4, scale: 4.8, style: bars2(this.bars(t, sh.t0), [1, 0]), k: 0.95, seed: 5, dmin: 22, dmax: 190, energy: 0.5 });
    this.chopBursts(t, sh, (_tc, k, i) => ({ c: V((hash(i, 8) - 0.5) * 60, h0 + 10 + hash(i, 9) * 20, pos.z - 60 - hash(i, 10) * 40), n: V(0, 0.4, 1), R: 10 + 8 * k }), 0.5);
  }

  /** Break: high above the Earth, two of them slow-dance facing each other; the others float up round them. */
  private duet(t: number, sh: Shot) {
    const L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const lt = t - sh.t0, beat = a.beatAt(t) / 2, P = 5;
    const R = 420, C = V(0, 55, -40);
    this.useEarth(R, V(1, -0.3, 0.2), 0, 0.8, 0.4);
    const sway = Math.sin(beat * Math.PI * 0.5);
    this.posePair(beat, 1.35 - 0.1 * prog(t, sh.t0, sh.t1), 0, V(0, 0.3, 0.2), C.clone().add(V(0, 0.4 * sway, 0)), new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0.06 * sway), P, [1, 1], 0.35, 0.45, 0.95);
    this.figs.figure(this.jA, P, { star: L.star, line: L.line, k: 1.2 });
    this.figs.figure(this.jB, P, { star: L.star, line: L.line, k: 1.2 });
    this.risers(t, beat, { n: 40, t0: sh.t0 - 12, span: sh.t1 - sh.t0 + 12, R, from: C.clone().setY(40), speed: 3.2, scale: 4, style: 1, k: 0.75, seed: 6, dmin: 30, dmax: 170, energy: 0.5 });
    // a slow orbit, a little above them, the Earth's limb curving behind
    const th = -0.55 + lt * 0.13, d = 20 - lt * 0.8;
    const pos = C.clone().add(V(Math.sin(th) * d, 6.5 - lt * 0.4, Math.cos(th) * d));
    aim(cam, pos, C.clone().add(V(0, 0.35 * P, 0)), 0.06 * Math.sin(lt * 0.5));
    cam.fov = 50;
    this.chopBursts(t, sh, (_tc, k) => ({ c: C.clone().add(V(0, 0.4 * P, 0)), n: pos.clone().sub(C), R: (4 + 2 * k) * P }), 0.6);
  }

  /** Break → bridge: the camera tilts up and rises faster and faster toward a bright point in deep blue. */
  private rise(t: number, sh: Shot) {
    const L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const lt = t - sh.t0, beat = a.beatAt(t) / 2;
    const tEnd = this.ctx.end;
    const R = 420, C = V(0, 55, -40);
    const tilt = prog(t, sh.t0, tEnd - 0.5, ease.inOutCubic);
    const pitch = lerp(-0.25, 1.2, tilt);
    const fwd = V(0, Math.sin(pitch), -Math.cos(pitch));
    // climbing, faster and faster (closed form: a steady drift plus a quartic surge)
    const T1 = tEnd + 0.45 - sh.t0, u = clamp(lt / T1);
    const dist = 3 * lt + 180 * Math.pow(u, 5);
    const speed = 3 + (900 / T1) * Math.pow(u, 4);
    const pos = C.clone().add(V(4, 6 + dist, 22 - dist * 0.25));
    aim(cam, pos, pos.clone().add(fwd), 0.12 * Math.sin(lt * 0.4) * (1 - tilt));
    cam.fov = 52 + 6 * ease.inCubic(prog(t, tEnd - 1.5, tEnd + 0.45));
    if (tilt < 0.7) this.useEarth(R, V(1, -0.3, 0.2), 0, 0.8, 0.4);
    // the bright point, where the zoom into the bridge is centred (uv 0.5, 0.62: above the frame centre)
    const ang = Math.atan(0.24 * Math.tan((cam.fov / 2) * DEG));
    const pt = fwd.clone().applyAxisAngle(V(1, 0, 0), ang);
    const glow = smoothstep(sh.t0 + 0.3, tEnd + 0.45, t);
    const pw = pos.clone().addScaledVector(pt, 1800);
    this.flares.glow(pw, col('#eef3ff', 3), 0.4 + 1.6 * glow, 8 + 14 * glow);
    this.flares.glow(pw, L.accent, 0.25 + 0.5 * glow, 60 + 220 * glow, 1, 4);
    this.flares.glow(pw, col('#dfe6ff', 1.5), glow * 0.2, 120, 10, 6);
    this.skyGlow(pt, col('blue', 0.3).multiplyScalar(glow));
    // the two and the others stay below as we rise
    const P = 5, sway = Math.sin(beat * Math.PI * 0.5);
    this.posePair(beat, 1.2, 0, V(0, 0.3, 0.2), C.clone().add(V(0, 0.4 * sway, 0)), ID, P, [1, 1], 0.35, 0.45, 0.95);
    this.figs.figure(this.jA, P, { star: L.star, line: L.line, k: 1.1 });
    this.figs.figure(this.jB, P, { star: L.star, line: L.line, k: 1.1 });
    this.risers(t, beat, { n: 40, t0: sh.t0 - 14, span: tEnd - sh.t0 + 14, R, from: C.clone().setY(40), speed: 3.2, scale: 4, style: 1, k: 0.75, seed: 6, dmin: 30, dmax: 170, energy: 0.5 });
    // stars begin to stream past
    this.warpStreaks(dist * 4, speed * 4, pt.clone().negate(), smoothstep(sh.t0 + 0.5, sh.t0 + 2.2, t));
    this.chopBursts(t, sh, (_tc, k) => ({ c: pos.clone().addScaledVector(pt, 140), n: pt, R: 30 + 20 * k }), 0.7);
    return { exposure: 1 + 0.12 * glow };
  }
}

/** The step for this point of a shot: a new one every two bars. */
function bars2(bars: number, styles: number[]) { return styles[Math.floor(Math.max(0, bars) / 2) % styles.length]!; }
