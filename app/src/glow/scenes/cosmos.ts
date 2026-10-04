// Drops and the break (params.n = 1, 2, 3): people become stars, in space. A cosmic festival where every
// dancer is a constellation — a star on each joint — and a sky full of them dances on the beat.
// Drop 1 (cool, icy white-cyan): a warp through a tunnel of rings of dancing star-people that surges on
// every kick; giants dancing across the sky; a galaxy whose arms are made of people; a ring of dancers round
// a star. The vocal chops fire supernova rings whose light ripples through the figures. "Take my hand" (×2):
// two giant figures reach out and their hands join in a flash (the gold link of the intro's constellation);
// the second time the whole sky joins hands, ring after ring, round the pair. Cuts every 1–2 bars.
// Break 2 (calm, blue): floating above the night Earth among slow dancers, then rising, faster and faster,
// toward a bright point in deep blue space (the zoom into the bridge is centred on it).
// Drop 3 (golden, the biggest): the sun rises over the Earth's limb and people rise from it as golden
// stars; the warp, golden giants, a galaxy and a halo of dancers round the sun, the sky joining hands; at
// the end everything slows and converges into the two figures holding hands, laid out exactly as the star
// stickers on the bedroom ceiling the outro crossfades to (stars to stars).
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim, skyDome } from '../lib/stage';
import { col } from '../lib/palette';
import { RealFigure, loadBody, limbDir, bend, dance } from '../lib/people';
import { starJoints } from '../lib/stars';
import { Earth } from '../lib/earth';
import { StarStreaks } from './fall-stars';
import { CLAP, HOLD, STARJUMP, Flares, FigureBatch, J, NJ, PoseBank, StarLines, frame, place, ring, type FigLook, type Pose } from './cosmos-gfx';
import { armAt, densityMap, galaxy, nebula, starField } from './cosmos-sky';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const ID = new THREE.Quaternion();
const N_STREAK = 2200;

type Kind = 'tunnel' | 'giant' | 'field' | 'halo' | 'pair' | 'chain' | 'earth' | 'float' | 'duet' | 'rise' | 'converge';
interface Shot { t0: number; t1: number; kind: Kind; seed: number; o: Record<string, any> }
interface Look {
  star: THREE.Color; line: THREE.Color; accent: THREE.Color; join: THREE.Color;
  skyTop: THREE.Color; skyHor: THREE.Color; gas: THREE.Color; fil: THREE.Color; streak: THREE.Color; streak2: THREE.Color;
}
interface Ripple { c: THREE.Vector3; t0: number; v: number; w: number; k: number }

/** The bedroom ceiling's two figures (ceiling.ts, u right / v up, metres) — the outro's first frame. */
const CEIL_J: Record<string, [number, number]> = {
  aHead: [-0.52, 0.74], aNeck: [-0.52, 0.52], aShL: [-0.72, 0.46], aShR: [-0.32, 0.46], aElL: [-0.86, 0.2], aHaL: [-0.92, -0.06],
  aElR: [-0.27, 0.22], aHaR: [-0.15, 0.06], aHip: [-0.52, -0.08], aKnL: [-0.66, -0.46], aFtL: [-0.72, -0.84], aKnR: [-0.4, -0.47], aFtR: [-0.36, -0.85],
  bHead: [0.52, 0.76], bNeck: [0.52, 0.54], bShL: [0.32, 0.48], bShR: [0.72, 0.48], bElL: [0.27, 0.24], bHaL: [0.15, 0.06],
  bElR: [0.86, 0.72], bHaR: [0.94, 0.98], bHip: [0.52, -0.06], bKnL: [0.4, -0.45], bFtL: [0.35, -0.83], bKnR: [0.65, -0.44], bFtR: [0.72, -0.82],
};
/** Star-joint order (lib/stars) → ceiling key suffix, for a figure facing the viewer (its left is screen right). */
const CEIL_OF = ['Head', 'Neck', 'ShR', 'ShL', 'ElR', 'ElL', 'HaR', 'HaL', 'Hip', 'KnR', 'KnL', 'FtR', 'FtL'];
/** The scattered stickers round the figures, generated exactly as ceiling.ts does. */
function ceilingStickers(): { u: number; v: number; r: number }[] {
  const rnd = mulberry32(5);
  const pts = Object.entries(CEIL_J).map(([, [u, v]]) => ({ u, v, r: 0.075 + rnd() * 0.03 }));
  const out: { u: number; v: number; r: number }[] = [];
  for (let tries = 0; pts.length < 50 && tries < 6000; tries++) {
    const r = 0.05 + Math.pow(rnd(), 2) * 0.09;
    const u = (rnd() * 2 - 1) * 2.1, v = (rnd() * 2 - 1) * 1.15;
    if (pts.every((p) => Math.hypot(p.u - u, p.v - v) > (p.r + r) * 1.6 + 0.08)) { pts.push({ u, v, r }); out.push({ u, v, r }); }
  }
  return out;
}

export default class Cosmos extends Scene {
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
  stickers = ceilingStickers();
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
    const { audio, lyrics, params } = this.ctx;
    this.n = params.n ?? 1;
    const w0 = this.ctx.start - 2, w1 = this.ctx.end + 2;
    this.beats = audio.beats.filter((b) => b >= w0 - 4 && b <= w1);
    this.downs = audio.downbeats.filter((d) => d >= w0 - 4 && d <= w1 + 2);
    this.chops = audio.events('chop', w0, w1);
    if (this.n === 1) {
      // (the two "Take my hand" lines of the drop; the chorus lines also contain the words)
      const [a, b] = lyrics.linesIn(this.ctx.start, this.ctx.end).filter((l) => /^take my hand/i.test(l.text));
      const w = (l: typeof a, i: number, d: number) => l?.words[i]?.start ?? d;
      this.T = { take1: w(a, 0, this.bar(11) + 1.0), hand1: w(a, 2, this.bar(11) + 1.3), take2: w(b, 0, this.bar(13) + 1.0), hand2: w(b, 2, this.bar(13) + 1.45) };
    }
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
    if (this.n === 3) return {
      star: col('#fff3d6', 2.4), line: col('gold', 0.5).lerp(col('ember', 0.5), 0.25), accent: col('gold', 1.6).lerp(col('white', 1.6), 0.15), join: col('#fff1c8', 3),
      skyTop: col('ember', 0.012), skyHor: col('ember', 0.05).lerp(col('gold', 0.05), 0.3), gas: col('ember', 0.13).lerp(col('gold', 0.13), 0.45), fil: col('gold', 0.22),
      streak: col('#fff0c8', 1.1), streak2: col('gold', 1),
    };
    if (this.n === 2) return {
      star: col('white', 2.0).lerp(col('#9fb4ff', 2.0), 0.3), line: col('violet', 0.36).lerp(col('blue', 0.42), 0.55), accent: col('blue', 1.3).lerp(col('white', 1.3), 0.45), join: col('gold', 2.4),
      skyTop: col('night', 0.7), skyHor: col('dusk', 0.6).lerp(col('blue', 0.06), 0.4), gas: col('blue', 0.15).lerp(col('violet', 0.15), 0.3), fil: col('violet', 0.12).lerp(col('blue', 0.12), 0.5),
      streak: col('#dfe6ff', 1), streak2: col('blue', 1),
    };
    return {
      star: col('white', 2.2).lerp(col('cyan', 2.2), 0.2), line: col('cyan', 0.42).lerp(col('blue', 0.5), 0.35), accent: col('cyan', 1.5).lerp(col('white', 1.5), 0.35), join: col('gold', 2.6),
      skyTop: col('night', 0.6), skyHor: col('dusk', 0.5), gas: col('blue', 0.2).lerp(col('cyan', 0.2), 0.15), fil: col('cyan', 0.17),
      streak: col('#e6f6ff', 1), streak2: col('cyan', 1),
    };
  }

  /** The edit: shot kinds on downbeats (bar k of the entry = this.bar(k)). */
  private makeShots(): Shot[] {
    const B = (k: number) => this.bar(k);
    const s = (t0: number, t1: number, kind: Kind, o: Record<string, any> = {}, seed = 0): Shot => ({ t0, t1, kind, o, seed: seed || Math.round(t0 * 10) });
    const end = this.ctx.end + 3;
    if (this.n === 2) return [
      s(this.ctx.start - 1, B(3), 'float'),
      s(B(3), B(5), 'duet'),
      s(B(5), end, 'rise'),
    ];
    if (this.n === 3) return [
      s(this.ctx.start - 1, B(2), 'earth'),
      s(B(2), B(3), 'tunnel', { styles: [STARJUMP, 0], roll0: 0.3, spin: 1 }),
      s(B(3), B(4), 'giant', { count: 2, styles: [CLAP, 2], th0: -0.25, side: 1, sun: true }),
      s(B(4), B(6), 'field', { styles: [0, STARJUMP, 1, 2] }),
      s(B(6), B(7), 'giant', { count: 1, styles: [STARJUMP, 3], th0: 0.35, side: -1, sun: true }),
      s(B(7), B(8), 'tunnel', { styles: [CLAP, 2], roll0: -0.5, spin: -1, back: true }),
      s(B(8), B(10), 'halo', { styles: [STARJUMP, 0, 1, CLAP] }),
      s(B(10), B(11), 'tunnel', { styles: [0, STARJUMP], roll0: 0.9, spin: 1, fast: true }),
      s(B(11), B(12), 'giant', { count: 2, styles: [STARJUMP, 0], th0: 0.15, side: -1, sun: true, low: true }),
      s(B(12), B(14), 'chain', { hold: [B(12) + 0.2, B(13)] }),
      s(B(14), end, 'converge'),
    ];
    return [
      s(this.ctx.start - 1, B(2), 'tunnel', { styles: [0, CLAP], roll0: 0, spin: 1 }),
      s(B(2), B(3), 'giant', { count: 1, styles: [0, 3], th0: -0.3, side: 1 }),
      s(B(3), B(4), 'giant', { count: 2, styles: [STARJUMP, STARJUMP], th0: 0.25, side: -1, low: true }),
      s(B(4), B(6), 'field', { styles: [1, 0, CLAP, 2] }),
      s(B(6), B(8), 'tunnel', { styles: [CLAP, 2], roll0: 0.6, spin: -1, back: true }),
      s(B(8), B(10), 'halo', { styles: [0, STARJUMP, 1, CLAP] }),
      s(B(10), B(11), 'giant', { count: 1, styles: [2, CLAP], th0: 0.4, side: -1, low: true }),
      s(B(11), B(13), 'pair', {}),
      s(B(13), end, 'chain', { hold: [this.T.take2, this.T.hand2] }),
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

  /** Forward travel since the shot began: a steady speed with a surge on every beat. */
  private travel(t: number, t0: number, v0: number, surge: number, tau = 0.16) {
    let s = v0 * (t - t0), v = v0;
    for (const b of this.beats) {
      if (b < t0 - 0.01) continue;
      if (b > t) break;
      const e = Math.exp(-(t - b) / tau);
      s += surge * tau * (1 - e);
      v += surge * e;
    }
    return { s, v };
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

    const PT0 = performance.now();
    switch (sh.kind) {
      case 'tunnel': this.tunnel(t, sh); break;
      case 'giant': this.giant(t, sh); break;
      case 'field': this.field(t, sh); break;
      case 'halo': this.halo(t, sh); break;
      case 'pair': this.pair(t, sh); break;
      case 'chain': this.chain(t, sh); break;
      case 'earth': this.earthShot(t, sh); break;
      case 'float': this.float(t, sh); break;
      case 'duet': this.duet(t, sh); break;
      case 'rise': post = this.rise(t, sh); break;
      case 'converge': post = this.converge(t, sh); break;
    }

    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    for (const o of [this.sky, this.neb, this.far]) o.position.copy(cam.position);
    this.figs.end();
    this.fx.end();
    this.flares.end();
    (this as any)._pt = ((this as any)._pt ?? 0) + performance.now() - PT0; (this as any)._pn = ((this as any)._pn ?? 0) + 1; (this as any)._pp = Math.max((this as any)._pp ?? 0, this.bank.posed);
    if ((this as any)._pn % 20 === 0) console.warn(`PERFJS ${sh.kind} ${((this as any)._pt / 20).toFixed(1)}ms posed<=${(this as any)._pp} figs=${this.figs.np / 13 | 0} lines=${this.figs.lines.n + this.fx.n}`), (this as any)._pt = 0, (this as any)._pp = 0;
    this.st.render(this.ctx.renderer, out);
    const k = this.kick, sk = this.shake;
    return {
      bloom: 0.95 + 0.25 * k, bloomThreshold: 0.75, bloomRadius: 0.85, halation: 0.14 + (this.n === 3 ? 0.08 : 0), vignette: 0.45, grain: 0.05,
      ca: 0.6 + 1.2 * k + 2 * sk, zoom: 1 + 0.018 * k, flash: this.flash,
      shake: [noise1(t * 37, 1) * 10 * sk, noise1(t * 37, 2) * 10 * sk] as [number, number],
      ...post,
    };
  }

  /** Cut punch: 0 → 1 over the first moments of a shot (strong ease), for whip-ins. */
  private land(t: number, sh: Shot, dur = 0.45) { return ease.outExpo(clamp((t - sh.t0) / dur)); }

  /** The roll steps a quarter turn on every downbeat of the shot (snapping in with a strong ease). */
  private rollSteps(t: number, sh: Shot, step: number) {
    let r = 0;
    for (const d of this.downs) {
      if (d <= sh.t0 + 0.05 || d > t) continue;
      r += step * ease.outExpo(clamp((t - d) / 0.4));
    }
    return r;
  }

  private skyGlow(dir: THREE.Vector3, c: THREE.Color) {
    const u = (this.sky.material as THREE.ShaderMaterial).uniforms;
    (u.glowDir!.value as THREE.Vector3).copy(dir).normalize();
    (u.glow!.value as THREE.Color).copy(c);
  }

  // ---- shots ----

  /** Warp: flying down a tunnel of rings of dancers, surging on every kick; rings of light on the chops. */
  private tunnel(t: number, sh: Shot) {
    const o = sh.o, L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const { s: S, v } = this.travel(t, sh.t0, o.fast ? 46 : 34, o.fast ? 150 : 110);
    const beat = a.beatAt(t), bars = this.bars(t, sh.t0);
    const land = this.land(t, sh, 0.55);
    const yaw = 0.14 * Math.sin((t - sh.t0) * 0.8 + sh.seed) + (o.back ? Math.PI : 0), pitch = 0.07 * Math.sin((t - sh.t0) * 0.63 + 2);
    const dir = V(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const roll = (o.roll0 ?? 0) + (o.spin ?? 1) * (this.rollSteps(t, sh, Math.PI / 4) + 0.8 * (1 - land));
    const pos = V(noise1(t * 0.7, 3) * 0.6, noise1(t * 0.6, 4) * 0.6, 0);
    aim(cam, pos, pos.clone().add(dir), roll);
    cam.fov = 66 + 7 * this.kick + 22 * (1 - land);
    // rings of dancers: heads outward, facing down the tunnel (toward the camera when it looks ahead)
    const D = 11, NR = 16, j0 = Math.floor(S / D);
    const styles: number[] = o.styles;
    for (let jj = -1; jj < NR; jj++) {
      const j = o.back ? j0 - jj : j0 + 1 + jj, z = S - j * D; // (camera-relative; ahead is -z)
      const dist = o.back ? z : -z;
      const fade = smoothstep(NR * D, NR * D * 0.6, dist) * smoothstep(-1, 6, dist);
      if (fade <= 0.001) continue;
      const m = j % 3 === 0 ? 12 : 10, R = 8 + 4 * hash(j, 1), sc = 1.9 + 0.7 * hash(j, 2);
      const spin = hash(j, 3) * TAU + (j % 2 ? 1 : -1) * 0.35 * (t - sh.t0);
      const style = styles[(((j % styles.length) + Math.floor(bars / 2)) % styles.length + styles.length) % styles.length]!;
      const off = (((j % 3) + 3) % 3) * 0.08;
      for (let i = 0; i < m; i++) {
        const an = spin + (i * TAU) / m;
        const up = V(Math.cos(an), Math.sin(an), 0);
        const p = up.clone().multiplyScalar(R).setZ(z);
        const pose = this.bank.get(i % 2, beat - off, style, 1, 0);
        this.put(pose, p, frame(up, V(0, 0, o.back ? -1 : 1)), sc, i % 2 === 1, { star: L.star, line: L.line, k: fade * (0.85 + 0.9 * this.kick) });
      }
    }
    // the light at the end of the tunnel
    const ahead = V(0, 0, o.back ? 1 : -1);
    this.flares.glow(ahead.clone().multiplyScalar(900), col('#f4fbff', 2.5), 0.5 + 0.5 * this.kick, 9);
    this.flares.glow(ahead.clone().multiplyScalar(900), L.accent, 0.12 + 0.2 * this.kick, 70, 1, 3);
    this.flares.glow(ahead.clone().multiplyScalar(900), L.star, 0.04 + 0.08 * this.kick, 36, 9, 6);
    this.warpStreaks(S, v, V(0, 0, 1));
    this.chopBursts(t, sh, (tc, k) => {
      const s0 = this.travel(tc, sh.t0, o.fast ? 46 : 34, o.fast ? 150 : 110).s;
      return { c: V(0, 0, (S - s0) + (o.back ? 20 : -45)), n: V(0, 0, 1), R: 15 + 7 * k };
    });
  }

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

  /** Giant dancers across the sky, the camera low and orbiting; a wall of dancers far behind them. */
  private giant(t: number, sh: Shot) {
    const o = sh.o, L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const G = o.count === 2 ? 11 : 15, beat = a.beatAt(t), bars = this.bars(t, sh.t0);
    const land = this.land(t, sh, 0.5);
    const th = (o.th0 ?? 0) + (o.side ?? 1) * (0.55 * (1 - land) + 0.07 * (t - sh.t0));
    const dist = (o.count === 2 ? 2.5 : 1.9) * G * (1 + 0.35 * (1 - land));
    const h = (o.low ? -0.6 : -0.3) * G;
    const pos = V(Math.sin(th) * dist, h, Math.cos(th) * dist);
    const target = V(0, (o.low ? 0.35 : 0.2) * G, 0).add(V(noise1(t * 0.8, 5), noise1(t * 0.7, 6), 0).multiplyScalar(0.06 * G));
    aim(cam, pos, target, (o.side ?? 1) * (0.12 + 0.35 * (1 - land)) + 0.04 * Math.sin(t * 1.3));
    cam.fov = 52 + 6 * this.kick;
    const styles: number[] = o.styles;
    const style = styles[Math.floor(Math.max(0, bars) * 2) % styles.length]!; // a new step every half bar
    const n = o.count ?? 1;
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : (i - 0.5) * 1.15 * G;
      const pose = this.bank.get(i % 2, beat, style, 1, i);
      const q = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), n === 1 ? 0 : (i - 0.5) * -0.35);
      this.put(pose, V(x, 0, 0), q, G, i === 1, { star: L.star, line: L.line, k: 1.1 + 0.9 * this.kick, lineK: 1.3 });
    }
    // a wall of dancers behind (a different step, a beat apart in two halves)
    const wallStyle = styles[(Math.floor(Math.max(0, bars) * 2) + 1) % styles.length]!;
    for (let i = 0; i < 34; i++) {
      const u = i / 33 - 0.5;
      const an = u * 2.2 + Math.PI;
      const R = 6.5 * G * (1 + 0.15 * hash(i, sh.seed));
      const p = V(Math.sin(an) * R, (hash(i, 9) * 2.4 - 0.6) * G, Math.cos(an) * R);
      const pose = this.bank.get(i % 2, beat - (i % 2) * 0.1, wallStyle, 1, 0);
      this.put(pose, p, frame(V(0, 1, 0), V(-p.x, 0, -p.z)), G * (0.4 + 0.2 * hash(i, 4)), i % 3 === 0, { star: L.star, line: L.line, k: 0.75 + 0.5 * this.kick });
    }
    // behind everything: a galaxy, or (drop 3) the sun
    if (o.sun) {
      const sd = V(-Math.sin(th) * 0.9 + 0.2, 0.35, -Math.cos(th)).normalize();
      this.sun(sd.clone().multiplyScalar(2200), 1 + 0.3 * this.kick);
    } else this.showGalaxy(V(-Math.sin(th) * 30 * G, 6 * G, -Math.cos(th) * 30 * G), 22 * G, V(0.5, 1, 0.2), t * 0.03);
    this.chopBursts(t, sh, (_tc, k, i) => ({ c: V((n === 1 ? 0 : (i % 2 - 0.5) * 1.15 * G), 0.3 * G, 0), n: pos.clone().sub(target), R: (1.6 + 0.8 * k) * G }));
  }

  private sun(p: THREE.Vector3, k: number) {
    const L = this.look;
    const cp = this.st.cam.position;
    const w = p.clone().add(cp);
    this.flares.glow(w, col('#fff6dd', 3), k, 60);
    this.flares.glow(w, col('gold', 1.2), k * 0.45, 260, 1, 3.5);
    this.flares.glow(w, L.accent, k * 0.12, 900, 1, 3);
    this.flares.glow(w, col('#fff1c8', 1.2), k * 0.12, 90, 12, 6);
    this.skyGlow(p, col('gold', 0.6).multiplyScalar(k));
  }

  private showGalaxy(pos: THREE.Vector3, scale: number, normal: THREE.Vector3, spin: number) {
    const g = this.gal;
    g.visible = true;
    g.position.copy(pos);
    g.scale.setScalar(scale);
    g.quaternion.setFromUnitVectors(V(0, 1, 0), normal.clone().normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), spin));
    g.material.uniforms.size!.value = scale;
    // its bright bulge
    this.flares.glow(pos, col('#fff4e0', 1.1), 0.55, scale * 0.06, 1, 4);
    this.flares.glow(pos, this.look.accent, 0.08, scale * 0.2, 1, 3);
  }

  /** A galaxy whose arms are made of people, seen from above as the camera descends into it. */
  private field(t: number, sh: Shot) {
    const o = sh.o, L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const Rg = 200, beat = a.beatAt(t), bars = this.bars(t, sh.t0), lt = t - sh.t0;
    const spin = 0.05 * lt + 0.4;
    this.showGalaxy(V(0, 0, 0), Rg * 1.15, V(0, 1, 0), spin);
    const land = this.land(t, sh, 0.6);
    const k = prog(t, sh.t0, sh.t1, ease.inOutCubic);
    const el = lerp(58, 24, k) * DEG + 0.3 * (1 - land), az = 0.6 + 0.45 * k + 0.4 * (1 - land), R = lerp(260, 105, k);
    const pos = V(Math.cos(el) * Math.sin(az) * R, Math.sin(el) * R, Math.cos(el) * Math.cos(az) * R);
    aim(cam, pos, V(0, -8, 0).lerp(V(Math.sin(az) * 30, 0, Math.cos(az) * 30), k), 0.15 * Math.sin(lt * 0.9) - 0.4 * (1 - land));
    cam.fov = 55 + 5 * this.kick;
    const styles: number[] = o.styles;
    const nPer = 38, cs = Math.cos(spin), sn = Math.sin(spin);
    for (let arm = 0; arm < 2; arm++) {
      const style = styles[(arm + Math.floor(bars / 2) * 2) % styles.length]!;
      for (let i = 0; i < nPer; i++) {
        const u = 0.16 + 0.84 * ((i + hash(i, arm)) / nPer);
        const [ax, az2] = armAt(u, arm);
        const x0 = ax * Rg * 1.15 + (hash(i, arm, 2) - 0.5) * 10, z0 = az2 * Rg * 1.15 + (hash(i, arm, 3) - 0.5) * 10;
        const x = x0 * cs + z0 * sn, z = -x0 * sn + z0 * cs; // (same turn as the galaxy's points)
        const p = V(x, (hash(i, arm, 4) - 0.5) * 30 * (1.2 - u), z);
        const off = Math.round(u * 3) * 0.08; // the step travels out along the arm
        const pose = this.bank.get(i % 2, beat - off, style, 1, 0);
        const up = V(x, 0, z).normalize();
        this.put(pose, p, frame(up, V(0, 1, 0)), 13 + 5 * hash(i, arm, 5) - 6 * u, i % 2 === 1, { star: L.star, line: L.line, k: 0.9 + 0.8 * this.kick });
      }
    }
    this.flares.glow(V(0, 0, 0), L.star, 0.06 + 0.1 * this.kick, 30, 7, 6);
    this.chopBursts(t, sh, (_tc, kk) => ({ c: V(0, 0, 0), n: V(0, 1, 0), R: Rg * (0.45 + 0.4 * kk) }), 1.2);
  }

  /** A ring of dancers orbiting a star, an inner ring the other way; the camera swoops through. */
  private halo(t: number, sh: Shot) {
    const o = sh.o, L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const beat = a.beatAt(t), bars = this.bars(t, sh.t0), lt = t - sh.t0;
    const nrm = V(0.18, 1, 0.12).normalize();
    const qn = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), nrm);
    const { s: turn } = this.travel(t, sh.t0, 0.12, 0.5, 0.2);
    const k = prog(t, sh.t0, sh.t1, ease.inOutQuad);
    const land = this.land(t, sh, 0.5);
    // swoop: from outside and above, down through the ring plane, rolling
    const az = lerp(-0.3, 0.9, k), el = lerp(55, 16, k) * DEG, R = lerp(190, 105, k) * (1 + 0.3 * (1 - land));
    const pos = V(Math.cos(el) * Math.sin(az) * R, Math.sin(el) * R, Math.cos(el) * Math.cos(az) * R).applyQuaternion(qn);
    aim(cam, pos, V(0, 4, 0), lerp(-0.15, 0.45, k) + 0.5 * (1 - land), nrm);
    cam.fov = 56 + 6 * this.kick;
    const styles: number[] = o.styles;
    const rings = [{ R: 70, m: 56, s: 5.5, dir: 1 }, { R: 42, m: 34, s: 4.2, dir: -1 }];
    rings.forEach((rg, ri) => {
      const style = styles[(ri + Math.floor(bars / 2) * 2) % styles.length]!;
      for (let i = 0; i < rg.m; i++) {
        const an = (i / rg.m) * TAU + rg.dir * turn * (ri ? 1.4 : 1);
        const up = V(Math.cos(an), 0, Math.sin(an)).applyQuaternion(qn);
        const p = up.clone().multiplyScalar(rg.R).addScaledVector(nrm, Math.sin(an * 3 + lt) * 2);
        const pose = this.bank.get(i % 2, beat - (i % 2) * 0.12, style, 1, 0);
        this.put(pose, p, frame(up, nrm), rg.s, i % 4 === 1, { star: L.star, line: L.line, k: 0.9 + 0.8 * this.kick });
      }
    });
    // the star
    const sk = 1 + 0.5 * this.kick;
    {
      if (this.n === 3) this.skyGlow(V(0, 4, 0).sub(cam.position), col('gold', 0.25));
      this.flares.glow(V(0, 4, 0), this.n === 3 ? col('#fff4d8', 3) : col('#f4fbff', 3), sk, 3.5);
      this.flares.glow(V(0, 4, 0), L.accent, 0.3 * sk, 22, 1, 4);
      this.flares.glow(V(0, 4, 0), L.star, 0.05 * sk, 16, 10, 6);
    }
    ring(this.fx, V(0, 0, 0), nrm, 70, L.line, 0.3 + 0.3 * this.kick, 0.1, 120);
    ring(this.fx, V(0, 0, 0), nrm, 42, L.line, 0.25 + 0.3 * this.kick, 0.08, 96);
    this.chopBursts(t, sh, () => ({ c: V(0, 4, 0), n: nrm, R: 75 }));
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

  /** "Take my hand" (1): two giant figures; on "take" they reach, on "hand" the hands join in a flash. */
  private pair(t: number, sh: Shot) {
    const L = this.look, cam = this.st.cam, a = this.ctx.audio, T = this.T;
    const beat = a.beatAt(t), P = 12;
    const reach = prog(t, T.take1 - 0.05, T.hand1, ease.inOutCubic);
    const hold = reach;
    const sep = lerp(1.7, 1.02, prog(t, sh.t0, T.hand1, ease.inOutQuad));
    const grip = V(0, lerp(0.42, 0.12, prog(t, T.hand1 + 0.2, T.hand1 + 1.2, ease.inOutCubic)), 0.18);
    const joined = t >= T.hand1;
    const styleA = joined ? 0 : bars2(this.bars(t, sh.t0), [0, 2]);
    this.posePair(beat, sep, hold, grip, V(0, 0, 0), ID, P, [styleA, styleA], joined ? 1 : 0.2 + 0.8 * reach, joined ? 0.7 : 1, 0.15 + 0.25 * reach);
    const kf = 1.15 + 0.8 * this.kick;
    const gripW = this.jA[J.haL]!.clone().add(this.jB[J.haR]!).multiplyScalar(0.5);
    this.figs.figure(this.jA, P, { star: L.star, line: L.line, k: kf, lineK: 1.3 });
    this.figs.figure(this.jB, P, { star: L.star, line: L.line, k: kf, lineK: 1.3 });
    // the join: a gold link between the hands, a flash, a ring of light through the sky of dancers
    const jk = smoothstep(T.hand1 - 0.06, T.hand1 + 0.02, t);
    if (jk > 0) {
      this.fx.seg(this.jA[J.haL]!, this.jB[J.haR]!, L.join, (0.8 + 2.5 * pulse(t, T.hand1, 0.3)) * jk, 0.05 * P);
      this.flares.glow(gripW, L.join, 0.45 * jk + 1.1 * pulse(t, T.hand1, 0.2), P * (0.1 + 0.2 * pulse(t, T.hand1, 0.3)));
      this.flares.glow(gripW, col('#fff6e0', 2), 0.3 * pulse(t, T.hand1, 0.3) + 0.04 * jk, P * 1.2, 10, 6);
      this.flash = 0.1 * pulse(t, T.hand1, 0.08);
      if (t - T.hand1 < 0.15) this.shake = 1 - (t - T.hand1) / 0.15;
      const age = t - T.hand1;
      ring(this.fx, gripW, V(0, 0, 1), P * 6 * ease.outExpo(clamp(age / 0.9)), L.join, 2 * Math.pow(0.5, age / 0.35), P * 0.03, 96);
      this.rip.push({ c: gripW, t0: T.hand1, v: P * 9, w: P * 1.2, k: 3 });
    }
    // round them, a wreath of dancers (lit by the ripple)
    this.wreath(t, beat, V(0, 0.25 * P, 0), P, [2.4, 3.8], -1, 0, jk);
    // camera: close on the reaching hands, pulling back as they join
    const back = prog(t, T.hand1, T.hand1 + 1.6, ease.outCubic);
    const land = this.land(t, sh, 0.5);
    const d = lerp(2.3, 4.3, back) * P * (1 + 0.4 * (1 - land));
    const th = lerp(-0.22, 0.12, prog(t, sh.t0, sh.t1, ease.inOutQuad));
    const tgt = V(0, lerp(0.25, 0.3, back) * P, 0);
    const pos = V(Math.sin(th) * d, tgt.y - lerp(0.25, 0.6, back) * P, Math.cos(th) * d);
    aim(cam, pos, tgt, -0.06 + 0.3 * (1 - land) + 0.03 * Math.sin(t * 1.1));
    cam.fov = 50 + 5 * this.kick;
  }

  /**
   * Rings of dancers round the pair (centre c, scale unit P): radii in P; `hold` (time, or -1) when they open
   * their arms and join hands, ring by ring, the links travelling round from the top. Returns nothing.
   */
  private wreath(t: number, beat: number, c: THREE.Vector3, P: number, radii: number[], tHold: number, tLink: number, lit = 0, normal = V(0, 0, 1)) {
    const L = this.look;
    const qn = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), normal);
    radii.forEach((rr, ri) => {
      const R = rr * P, s = 0.5 * P * (1 + 0.2 * ri);
      // as many as fit hand to hand (arms out: hands ~0.78 from the centre, 0.45 above the pelvis)
      const m = Math.max(8, Math.round((TAU * (R + 0.45 * s)) / (1.62 * s)));
      const open = tHold < 0 ? 0 : prog(t, tHold + ri * 0.08, tHold + 0.45 + ri * 0.08, ease.outCubic);
      const tl = tLink + ri * 0.22;
      const hands: THREE.Vector3[][] = [];
      const style = bars2(this.bars(t, this.ctx.start), [0, CLAP, 1, STARJUMP]);
      for (let i = 0; i < m; i++) {
        const an = (i / m) * TAU + Math.PI / 2 + ri * 0.13 + (tHold < 0 ? 0.04 * (t - this.ctx.start) * (ri % 2 ? 1 : -1) : 0);
        const up = V(Math.cos(an), Math.sin(an), 0).applyQuaternion(qn);
        const p = c.clone().addScaledVector(up, R);
        const pose = open > 0.01 ? this.bank.get(i % 2, beat, HOLD, 1, 0, open) : this.bank.get(i % 2, beat - (ri % 2) * 0.1, style, 1, 0);
        // link timing: from the top (i = 0) both ways round, reaching the bottom after 0.5 s
        const di = Math.min(i, m - i) / (m / 2);
        const linkK = tLink > 0 ? smoothstep(tl + di * 0.5, tl + di * 0.5 + 0.06, t) : 0;
        const ringFlash = tLink > 0 ? pulse(t, tl + 0.55, 0.3) : 0;
        const j = this.put(pose, p, frame(up, normal), s, false, { star: L.star, line: L.line, k: (0.8 + 0.6 * this.kick) * (1 + 0.3 * lit + 1.5 * ringFlash) + 0.6 * linkK * pulse(t, tl + di * 0.5, 0.25) });
        hands.push([j[J.haL]!.clone(), j[J.haR]!.clone(), V(linkK, 0, 0)]);
      }
      if (tLink <= 0) return;
      for (let i = 0; i < m; i++) {
        const h0 = hands[i]!, h1 = hands[(i + 1) % m]!;
        // figure i's body-left hand (+x, counter-clockwise) meets figure i+1's body-right hand
        const lk = Math.min(h0[2]!.x, h1[2]!.x);
        if (lk <= 0) continue;
        const mid = h0[0]!.clone().lerp(h1[1]!, 0.5);
        this.fx.seg(h0[0]!, h1[1]!, L.join, lk * (0.7 + 1.2 * pulse(t, tl + 0.55, 0.3)), s * 0.011);
        this.figs.star(mid, L.join, lk * (1 + 1.5 * pulse(t, tl + 0.55, 0.3)), s * 0.1);
      }
    });
  }

  /** "Take my hand" (2) — and drop 3's chain: the pair holds on; ring after ring round them joins hands. */
  private chain(t: number, sh: Shot) {
    const L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const beat = a.beatAt(t), P = 10;
    const [tHold, tLink] = sh.o.hold as [number, number];
    const grip = V(0, 0.14 + 0.03 * Math.sin(beat * Math.PI * 0.5), 0.18);
    this.posePair(beat, 1.02, 1, grip, V(0, 0, 0), ID, P, [0, 0], 1, 0.75, 0.3);
    const kf = 1.2 + 0.8 * this.kick;
    this.figs.figure(this.jA, P, { star: L.star, line: L.line, k: kf, lineK: 1.3 });
    this.figs.figure(this.jB, P, { star: L.star, line: L.line, k: kf, lineK: 1.3 });
    const gripW = this.jA[J.haL]!.clone().add(this.jB[J.haR]!).multiplyScalar(0.5);
    this.fx.seg(this.jA[J.haL]!, this.jB[J.haR]!, L.join, 1 + 1.5 * pulse(t, tLink, 0.3), 0.05 * P);
    this.flares.glow(gripW, L.join, 0.45 + 1.0 * pulse(t, tLink, 0.3), P * 0.14);
    this.flares.glow(gripW, col('#fff6e0', 2), 0.04 + 0.3 * pulse(t, tLink, 0.4), P * 1.2, 10, 6);
    const radii = this.n === 3 ? [2.5, 4.0, 5.6, 7.3] : [2.5, 4.0, 5.6];
    this.wreath(t, beat, V(0, 0.25 * P, 0), P, radii, tHold, tLink, 0);
    if (t > tLink) {
      this.rip.push({ c: gripW, t0: tLink, v: P * 8, w: P * 1.4, k: 2 });
      this.flash = 0.1 * pulse(t, tLink, 0.08);
      if (t - tLink < 0.12) this.shake = 1 - (t - tLink) / 0.12;
    }
    // camera: straight on, pulling back to show the whole mandala, slowly turning; the last half bar pushes in
    const land = this.land(t, sh, 0.5);
    const pull = prog(t, sh.t0, tLink + 1.2, ease.inOutCubic);
    const push = this.n === 1 ? prog(t, this.bar(15), this.ctx.end + 0.3, ease.inCubic) : prog(t, sh.t1 - 0.8, sh.t1, ease.inCubic);
    const d = lerp(4.2, radii[radii.length - 1]! * 1.55, pull) * P * (1 - 0.8 * push) * (1 + 0.3 * (1 - land));
    const tgt = V(0, 0.25 * P, 0);
    const th = 0.1 * Math.sin((t - sh.t0) * 0.5) - 0.25 * (1 - land);
    aim(cam, V(Math.sin(th) * d, tgt.y - 0.12 * d, Math.cos(th) * d), tgt, 0.25 * (t - sh.t0) * 0.3 + 0.4 * (1 - land) + 0.6 * push);
    cam.fov = 54 + 6 * this.kick + 20 * push;
    // the push ends in the light of their joined hands
    this.flares.glow(gripW, L.join, 2.5 * push * push, P * (0.2 + 1.5 * push * push), 1, 3);
    if (this.n === 3) this.sun(V(0, 0.3, -1).multiplyScalar(2200), 0.6 + 0.2 * this.kick);
    this.chopBursts(t, sh, (_tc, k) => ({ c: gripW.clone(), n: V(0, 0, 1), R: (5 + 3 * k) * P }));
  }

  /** Drop 3 opens: the sun rises over the Earth's limb and people rise from it as golden stars. */
  private earthShot(t: number, sh: Shot) {
    const L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const beat = a.beatAt(t), bars = this.bars(t, sh.t0), lt = t - sh.t0;
    const R = 420, h0 = 55, dip = Math.acos(R / (R + h0));
    const land = this.land(t, sh, 0.8);
    // high over the limb, drifting toward the sunrise; the horizon a little below the middle of the frame
    const pos = V(0, h0 + 10 * (1 - land), -lt * 5);
    const pitch = -dip + 7 * DEG - 0.12 * (1 - land) + 0.03 * Math.sin(lt * 0.5);
    aim(cam, pos, pos.clone().add(V(0.04 * Math.sin(lt * 0.4), Math.sin(pitch), -Math.cos(pitch))), 0.05 * Math.sin(lt * 0.7) - 0.18 * (1 - land));
    cam.fov = 58 + 5 * this.kick;
    const sunDir = V(0.08, Math.sin(-dip + (4 + 1.2 * lt) * DEG), -1).normalize();
    this.useEarth(R, sunDir, 1, 1, 0.45);
    this.sun(sunDir.clone().multiplyScalar(2400), (0.55 + 0.45 * smoothstep(sh.t0 - 0.3, sh.t0 + 0.4, t)) * (1 + 0.2 * this.kick));
    // people rise from the lit Earth: each a point of light at first, unfolding into a dancing star-figure
    const style = [STARJUMP, 0][Math.floor(Math.max(0, bars) * 2) % 2]!;
    this.risers(t, beat, { n: 64, t0: sh.t0 - 3, span: sh.t1 - sh.t0 + 2.2, R, from: V(0, h0, 0), speed: 9, scale: 2.6, style, k: 0.85 + 0.8 * this.kick, seed: 3, dmin: 45, dmax: 230 });
    this.chopBursts(t, sh, (_tc, k, i) => ({ c: V((hash(i, 8) - 0.5) * 60, h0 + 10 + hash(i, 9) * 30, pos.z - 90 - hash(i, 10) * 60), n: V(0, 0.3, 1), R: 24 + 12 * k }));
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

  /**
   * Drop 3's end: the music dies away; everything slows and converges into the two figures holding hands,
   * laid out exactly like the stickers on the bedroom ceiling of the outro, in the outro's camera.
   */
  private converge(t: number, sh: Shot) {
    const L = this.look, cam = this.st.cam, a = this.ctx.audio;
    const beat = a.beatAt(t), lt = t - sh.t0;
    const tEnd = this.ctx.end;
    // the outro's camera: looking up (screen up = +z), fov 60, the constellation 1.9 m above, scaled up
    const Sc = 34, D = 1.9 * Sc;
    const settle = prog(t, sh.t0 + 0.6, tEnd - 0.35, ease.inOutCubic);
    const slow = prog(t, sh.t0, tEnd - 0.2, ease.outCubic); // 0 → 1 as everything stops
    const land = this.land(t, sh, 0.6);
    const roll = 0.05 * Math.sin(t * 0.2);
    const pos = V(noise1(t * 0.3, 1) * 0.6 * (1 - settle), -D * 0.9 * (1 - settle) * (1 - slow * 0.3) - 20 * (1 - land), noise1(t * 0.27, 2) * 0.6);
    aim(cam, pos, pos.clone().add(V(0, 1, 0)), roll + 0.5 * (1 - settle) * (1 - land * 0.5), V(0, 0, 1));
    cam.fov = 60 + 10 * (1 - settle);
    // the pair, dancing ever slower, hands held; B's outer hand up
    const qP = frame(V(0, 0, 1), V(0, -1, 0));
    const P = Sc * 1.02;
    const grip = V(0, 0.14, 0.12);
    this.posePair(beat, 1.02, 1, grip, V(0, D, 0.02 * Sc), qP, P, [0, 0], 1, 1 - slow, 0.3 * (1 - settle));
    // morph onto the ceiling layout
    const tgt = (key: string) => { const [u, v] = CEIL_J[key]!; return V(u * Sc, D, (v + 0.1) * Sc); };
    for (let i = 0; i < NJ; i++) {
      this.jA[i]!.lerp(tgt('a' + CEIL_OF[i]), settle);
      this.jB[i]!.lerp(tgt('b' + CEIL_OF[i]), settle);
    }
    const cool = smoothstep(sh.t0 + 0.8, tEnd, t);
    const starC = L.star.clone().lerp(col('phosphor', 1.6).lerp(col('white', 1.6), 0.45), cool);
    const lineC = L.line.clone().lerp(col('phosphor', 0.6).lerp(col('white', 0.6), 0.25), cool);
    const kf = 1.1 + 0.6 * this.kick * (1 - slow);
    this.figs.figure(this.jA, P * (1 + 0.6 * settle), { star: starC, line: lineC, k: kf });
    this.figs.figure(this.jB, P * (1 + 0.6 * settle), { star: starC, line: lineC, k: kf });
    // their joined hands: the gold link fades as the stars cool
    this.fx.seg(this.jA[J.haL]!, this.jB[J.haR]!, L.join, 1.2 * (1 - cool), 0.05 * P);
    // the crowd swirls in round them, slowing, and settles as the ceiling's scattered stars
    const swirl = (1 - slow) * 1.4;
    const nSt = this.stickers.length;
    for (let i = 0; i < 90; i++) {
      const r0 = (1.6 + 2.6 * hash(i, 1)) * Sc, an = hash(i, 2) * TAU + lt * swirl * (0.6 + 0.4 * hash(i, 3)) * (i % 2 ? 1 : -1);
      const pIn = lerp(1, 0.35, slow);
      const p = V(Math.cos(an) * r0 * pIn, D * (1.4 + 0.8 * hash(i, 4)) * lerp(1, 0.75, slow), Math.sin(an) * r0 * pIn * 0.7);
      const fade = 1 - smoothstep(sh.t0 + 0.8, tEnd - 0.6, t + hash(i, 5) * 0.6);
      if (i < nSt) {
        // these become the scattered stickers
        const st = this.stickers[i]!;
        const home = V(st.u * Sc, D, (st.v + 0.1) * Sc);
        const kk = smoothstep(0.1, 0.9, settle + 0.2 * hash(i, 6));
        const q = p.clone().lerp(home, kk);
        this.figs.star(q, starC, 1.2 + 0.4 * this.kick * (1 - slow), lerp(0.12, st.r * 2.2, kk) * Sc);
        if (kk < 0.95 && fade > 0.01) {
          const pose = this.bank.get(i % 2, beat - (i % 3) * 0.1, i % 3 === 0 ? STARJUMP : 0, 1 - slow, 0);
          this.put(pose, p, frame(V(Math.cos(an), 0, Math.sin(an)), V(0, -1, 0)), 1.2 * Sc / 12, i % 2 === 1, { star: starC, line: lineC, k: (1 - kk) * fade * 0.9 });
        }
      } else if (fade > 0.01) {
        const pose = this.bank.get(i % 2, beat - (i % 3) * 0.1, i % 3 === 0 ? STARJUMP : 0, 1 - slow, 0);
        this.put(pose, p, frame(V(Math.cos(an), 0, Math.sin(an)), V(0, -1, 0)), 1.2 * Sc / 12, i % 2 === 1, { star: starC, line: lineC, k: fade * 0.9 });
      }
    }
    // the warp slows to a stop
    const vel = 60 * (1 - slow);
    const { s: S } = this.travel(t, sh.t0, 0, 0);
    void S;
    const dist = 60 * (lt - (lt * lt) / (2 * Math.max(0.01, tEnd - 0.2 - sh.t0)) * 0.9);
    this.warpStreaks(dist, vel, V(0, -1, 0), 1 - slow);
    // the sky goes dark and quiet
    const nm = (this.neb.material as THREE.ShaderMaterial).uniforms;
    (nm.gas!.value as THREE.Color).copy(L.gas).multiplyScalar(1 - 0.85 * cool);
    (nm.fil!.value as THREE.Color).copy(L.fil).multiplyScalar(1 - 0.85 * cool);
    this.sun(V(0.3, 0.2, 1).normalize().multiplyScalar(2400), 0.6 * (1 - cool));
    this.chopBursts(t, sh, (_tc, k) => ({ c: V(0, D, 0.1 * Sc), n: V(0, 1, 0), R: (1.5 + k) * Sc }), 0.6 * (1 - cool));
    return { bloom: 0.95, exposure: 1 - 0.1 * cool };
  }
}

/** The step for this point of a shot: a new one every two bars. */
function bars2(bars: number, styles: number[]) { return styles[Math.floor(Math.max(0, bars) / 2) % styles.length]!; }
