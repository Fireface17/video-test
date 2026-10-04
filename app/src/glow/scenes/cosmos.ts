// The drops (params.n = 1, 3): inside the galaxy of people (lib/galaxy.ts). Every star you fly past is a
// person of stardust (lib/stardust.ts) moving like a real person (motion capture, cosmos-motion.ts); along
// the middle of each spiral arm people hold hands in a chain.
//
// Drop 1 (cyan / white). "Glo-o-owing in the dark": fast flights low over the arms, past the chains, a new
// angle on every bar; on each sung "Glo-" a wave of raised hands races along the arm. "Da-a-ance, da-a-ance":
// two giants of stardust dance in front of the bright core, dust flying off their hands. "Glo-o-owing" again:
// the waves run out from the core along both arms. The instrumental bars: flights, the core pulsing on every
// kick, rings of light running out through the people. "Take my hand" (1): there is a gap in a chain; the
// two people at its ends reach for each other, their hands join in a flash and the light runs along the whole
// arm. "Take my hand" (2): the giants join hands over the core; we rush into the light of their hands.
// Drop 3 (gold, the finale). The golden galaxy at full power, wave after wave of raised hands; at its centre
// the giant pair dance, he carrying his star sticker and she her paper lantern. On "take my hand" their
// hands — and the two lights — meet and merge into one star; the star swells into the sun; then everything
// slows down and converges into that single point (the outro starts from a star).
// Shots are a list on the section's bar grid (bar k = k-th downbeat of the drop section), so the entry can
// start later than the section (the drop's first bars may be another scene) and still land on its shots.
// Break 2 (n = 2) is the old scene (cosmos-break.ts) for now.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { RealFigure, bend, limbDir, loadBody } from '../lib/people';
import { starJoints } from '../lib/stars';
import { Stardust, StardustBody } from '../lib/stardust';
import { Galaxy } from '../lib/galaxy';
import { Flares, place, type Pose } from './cosmos-gfx';
import { densityMap, nebula, starField } from './cosmos-sky';
import { Crowd, type CrowdLook } from './cosmos-crowd';
import { DANCE, IDLE, Moves, type Mover } from './cosmos-motion';
import { SunDisc, dustLaneMaterial } from './cosmos-lights';
import { PaperLantern, StarSticker, heColor, sheColor } from '../lib/heroes';
import { CosmosBreak } from './cosmos-break';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
const TAU = Math.PI * 2;
const sine = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x));
type V3 = [number, number, number];

type Kind = 'fly' | 'giants' | 'wide' | 'gap' | 'sun' | 'converge';
interface Shot { t0: number; t1: number; kind: Kind; o: Record<string, any>; seed: number }
/** A wave of raised hands: from link L0 of `arm` (−1 = every arm) at t0, along +dir (0 = both ways), v links/s. */
interface Wave { t0: number; arm: number; L0: number; dir: number; v: number; amp: number; glow?: number }
interface Look {
  crowd: CrowdLook;
  hero: [THREE.Color, THREE.Color]; heroDeep: THREE.Color;
  core: THREE.Color; flash: THREE.Color; accent: THREE.Color;
  gas: THREE.Color; fil: THREE.Color; far: THREE.Color;
  armStar: THREE.Color; coreStar: THREE.Color; diskWarm: V3; diskArm: V3; knot: THREE.Color;
}

/** The pair's frame: heads toward U, facing F (= +y, out of the disk), his left/her right along X. */
const U = V(0, 0, -1), F = V(0, 1, 0), X = new THREE.Vector3().crossVectors(U, F);
const GS = 8; // the giants' scale
const GK = 4; // and their brightness
/** Where the giants are: their chest line 18 above the core, he at −X, she at +X; where their hands meet. */
const GC = V(0, 18, 0);
const HE = GC.clone().addScaledVector(U, -0.3 * GS).addScaledVector(X, -0.62 * GS);
const SHE = GC.clone().addScaledVector(U, -0.3 * GS).addScaledVector(X, 0.62 * GS);
const GRIP = GC.clone().addScaledVector(U, 0.12 * GS).addScaledVector(F, 0.22 * GS);
const QG = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, U, F));

export default class Cosmos extends Scene {
  private legacy: CosmosBreak | null = null;
  st = new Stage(55, 0.1, 6000);
  n = 1;
  sec0 = 0;
  downs: number[] = [];
  beats: number[] = [];
  chops: [number, number][] = [];
  T = { g1: 0, d: 0, g2: 0, take1: 0, hand1: 0, take2: 0, hand2: 0 };
  shots: Shot[] = [];
  look!: Look;
  gal!: Galaxy;
  crowd!: Crowd;
  moves!: Moves;
  D!: Stardust;
  flares = new Flares(96);
  /** Glows behind the people (the core): drawn before the giants' dark bodies. */
  bgFlares = new Flares(8);
  neb!: THREE.Mesh;
  far!: THREE.Points;
  /** The giants (he, she) and the two people at the ends of a chain (by body kind). */
  he!: RealFigure;
  she!: RealFigure;
  ends: RealFigure[] = [];
  heM: Mover = { clip: 0, body: 0, off: 0, rate: 1, mirror: false };
  sheM: Mover = { clip: 0, body: 1, off: 0, rate: 1, mirror: true };
  sticker = new StarSticker(0.05 * GS * 1.5);
  sunDisc = new SunDisc();
  lantern = new PaperLantern(0.11 * GS * 1.2);
  /** Drop 1's gap: arm, the link before it, its tangent. */
  gap = { arm: 0, link: 120, tan: V(1, 0, 0), pos: V() };
  private tangents: THREE.Vector3[] = [];
  // per frame
  private kick = 0;
  private flash = 0;
  private shake = 0;
  private waves: Wave[] = [];
  private rings = 0;
  private tNow = 0;
  private js: THREE.Vector3[] = [];
  private jA: THREE.Vector3[] = [];
  private jB: THREE.Vector3[] = [];
  private pose: Pose = new Float32Array(39);

  override async init() {
    const { audio, params } = this.ctx;
    this.n = params.n ?? 1;
    if (this.n === 2) {
      this.legacy = new CosmosBreak(this.ctx);
      return this.legacy.init();
    }
    this.sec0 = audio.sections.find((s) => s.name === (this.n === 3 ? 'drop3' : 'drop1'))?.start ?? this.ctx.start;
    const w0 = Math.min(this.sec0, this.ctx.start) - 2, w1 = this.ctx.end + 3;
    this.downs = audio.downbeats.filter((d) => d >= w0 - 2 && d <= w1 + 2);
    this.beats = audio.beats.filter((b) => b >= w0 - 3 && b <= w1 + 1);
    this.chops = audio.events('chop', w0, w1);
    this.findTimes();
    this.look = this.makeLook();
    const L = this.look, S = this.st;
    S.bg.copy(col('night', 0.25));
    this.neb = nebula(densityMap(512, 256, 5 + this.n * 13), 2800);
    const nm = (this.neb.material as THREE.ShaderMaterial).uniforms;
    (nm.gas!.value as THREE.Color).copy(L.gas);
    (nm.fil!.value as THREE.Color).copy(L.fil);
    this.far = starField(3500, 2600, 11 + this.n, L.far, 0.3);

    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    const white = col('white');
    const fresh = () => [new RealFigure(rp!, 'rpm', white), new RealFigure(mi!, 'michelle', white)];
    this.D = new Stardust(fresh().map((f, i) => new StardustBody(f, 22000, i + 1)), [16, 700, 2600], { extras: 9000 });
    this.gal = new Galaxy(fresh(), 7);
    this.moves = await Moves.load([...DANCE, ...IDLE], fresh());
    const clips: [string, number][] = [...DANCE.map((c) => [c, 1] as [string, number]), ...IDLE.map((c) => [c, 0.35] as [string, number])];
    this.crowd = new Crowd(this.gal, this.moves, 11 + this.n, clips, L.crowd);
    // the giants: their bodies are dark dust lanes under the stardust
    const lane = () => dustLaneMaterial(col('night', 0.15), 0.55);
    this.he = new RealFigure(rp!, 'rpm', white, lane(), { prepass: false });
    this.she = new RealFigure(mi!, 'michelle', white, lane(), { prepass: false });
    for (const f of [this.he, this.she]) { f.visible = false; f.renderOrder = 3; }
    this.ends = fresh();
    // the giants dance with their arms held high (clip times chosen so "Da-a-ance" lands on the big moves)
    this.heM = { clip: this.moves.index('49_09'), body: 0, off: (this.n === 3 ? 6.0 : 0.4) - this.T.d, rate: 1, mirror: false };
    this.sheM = { clip: this.moves.index('49_12'), body: 1, off: (this.n === 3 ? 1.2 : 0.3) - this.T.d, rate: 1, mirror: true };
    this.tint();
    S.add(this.neb, this.far, this.gal.group, this.bgFlares, this.he, this.she, this.D, this.flares, this.sticker, this.lantern, this.sunDisc);
    this.D.renderOrder = 4;

    // the gap in drop 1's chain (arm 0, about halfway out) and the tangents of the chains
    const P = this.gal.people;
    this.tangents = P.map(() => V(1, 0, 0));
    for (const ch of this.crowd.chains) ch.forEach((i, k) => {
      const a = P[ch[Math.max(0, k - 1)]!]!.p, b = P[ch[Math.min(ch.length - 1, k + 1)]!]!.p;
      this.tangents[i]!.subVectors(b, a).normalize();
    });
    const ch0 = this.crowd.chains[0]!;
    const gl = ch0.findIndex((i) => Math.hypot(P[i]!.p.x, P[i]!.p.z) > 46);
    this.gap.link = gl;
    this.gap.tan.copy(this.tangents[ch0[gl]!]!);
    this.gap.pos.copy(P[ch0[gl]!]!.p).lerp(P[ch0[gl + 1]!]!.p, 0.5);
    this.shots = this.makeShots();
  }

  /** The vocal phrases from the chops (clusters) and the "Take my hand" lines. */
  private findTimes() {
    const cl: number[][] = [];
    for (const [t] of this.chops) {
      if (t < this.sec0 + 0.05) continue;
      const last = cl[cl.length - 1];
      if (last && t - last[last.length - 1]! < 0.95) last.push(t); else cl.push([t]);
    }
    const B = (k: number) => this.bar(k);
    const first = (i: number, d: number) => cl[i]?.[0] ?? d;
    this.T.g1 = first(0, B(0) + 0.4);
    this.T.d = first(1, B(3) + 0.8);
    this.T.g2 = first(2, B(5) + 0.8);
    if (this.n === 1) {
      const lines = this.ctx.lyrics.linesIn(this.sec0, this.sec0 + 26).filter((l) => /^take my hand/i.test(l.text));
      const w = (l: (typeof lines)[number] | undefined, i: number, d: number) => l?.words[i]?.start ?? d;
      this.T.take1 = w(lines[0], 0, B(11) + 0.7); this.T.hand1 = w(lines[0], 2, B(11) + 1.3);
      this.T.take2 = w(lines[1], 0, B(13) + 0.7); this.T.hand2 = w(lines[1], 2, B(13) + 1.45);
    } else {
      const c = cl[3];
      this.T.take2 = c?.[0] ?? B(12); this.T.hand2 = c?.[1] ?? B(12) + 0.58;
    }
  }

  private makeLook(): Look {
    const v3 = (c: THREE.Color): V3 => [c.r, c.g, c.b];
    if (this.n === 3) {
      const gold = col('gold', 1.4), white = col('white', 1.4);
      return {
        crowd: { chain: col('#fff1c8', 1.5), a: gold.clone().lerp(white, 0.3), b: col('gold', 1.4).lerp(col('ember', 1.4), 0.3).lerp(white, 0.2), deep: col('ember', 1.0).lerp(col('gold', 1.0), 0.3) },
        hero: [col('gold', 1.25).lerp(col('white', 1.25), 0.25).lerp(heColor(), 0.2), col('gold', 1.25).lerp(col('white', 1.25), 0.25).lerp(sheColor(), 0.25)], heroDeep: col('ember', 0.9).lerp(col('gold', 0.9), 0.4),
        core: col('#fff3d6', 2.2), flash: col('#fff1c8', 2.5), accent: col('gold', 1.6),
        gas: col('ember', 0.035).lerp(col('gold', 0.035), 0.5), fil: col('gold', 0.08).lerp(col('white', 0.08), 0.2), far: col('gold', 1),
        armStar: col('gold', 1).lerp(col('white', 1), 0.45), coreStar: col('#fff1d0', 1), diskWarm: v3(col('gold', 1).lerp(col('white', 1), 0.35)), diskArm: v3(col('gold', 1).lerp(col('ember', 1), 0.3)), knot: col('ember', 0.4).lerp(col('gold', 0.4), 0.4),
      };
    }
    const cyan = col('cyan', 1.4), white = col('white', 1.4);
    return {
      crowd: { chain: col('white', 1.5).lerp(col('cyan', 1.5), 0.25), a: cyan.clone().lerp(white, 0.3), b: col('white', 1.4).lerp(col('blue', 1.4), 0.2), deep: col('blue', 1.1).lerp(col('cyan', 1.1), 0.25) },
      hero: [heColor().lerp(col('white', 1.2), 0.3), sheColor().lerp(col('white', 1.2), 0.3)], heroDeep: col('blue', 0.9).lerp(col('violet', 0.9), 0.3),
      core: col('#eefaff', 2.2), flash: col('#e8fbff', 2.5), accent: col('cyan', 1.6),
      gas: col('blue', 0.18).lerp(col('cyan', 0.18), 0.2), fil: col('cyan', 0.15), far: col('cyan', 1),
      armStar: col('white', 1).lerp(col('cyan', 1), 0.45), coreStar: col('white', 1).lerp(col('gold', 1), 0.12), diskWarm: v3(col('white', 1).lerp(col('gold', 1), 0.15)), diskArm: v3(col('cyan', 1).lerp(col('blue', 1), 0.35)), knot: col('blue', 0.35).lerp(col('cyan', 0.35), 0.4),
    };
  }

  /** Colour the galaxy's own light for this drop: stars, disk, core, nebula knots. */
  private tint() {
    const g = this.gal, L = this.look, C = g.stars.colors, c = new THREE.Color();
    for (let i = 0; i < g.stars.n; i++) {
      const r = C[i * 3]!, gg = C[i * 3 + 1]!, b = C[i * 3 + 2]!;
      const lum = (r + gg + b) / 3, warm = clamp((r - b) / Math.max(r, 1e-3) / 0.55);
      c.copy(L.armStar).lerp(L.coreStar, warm);
      const cl = (c.r + c.g + c.b) / 3;
      const k = (lum / cl) * (1 - 0.6 * warm); // (the bulge is dense: dimmer stars, or it burns out)
      C.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    g.stars.commit();
    const u = (g.disk.material as THREE.ShaderMaterial).uniforms;
    (u.warm!.value as THREE.Vector3).set(...L.diskWarm);
    (u.blue!.value as THREE.Vector3).set(...L.diskArm);
    g.knots.forEach((s, i) => s.material.color.copy(L.knot).multiplyScalar(0.6 + 0.8 * hash(i, 3)));
    const cc = [L.accent.clone().multiplyScalar(0.3), L.coreStar.clone().multiplyScalar(0.75), col('white', 1.25)];
    g.cores.forEach((s, i) => s.material.color.copy(cc[i] ?? cc[2]!));
  }

  /** Time of the k-th downbeat of the drop section (k may be fractional: beats within the bar). */
  bar(k: number) {
    const i0 = this.downs.findIndex((d) => d >= this.sec0 - 0.05);
    const kk = Math.floor(k), d = this.downs[i0 + kk] ?? this.sec0 + kk * 1.6;
    if (k === kk) return d;
    const a = this.ctx.audio;
    return a.timeOfBeat(Math.round(a.beatAt(d)) + (k - kk) * 4);
  }

  /** The beat nearest t. */
  private snap(t: number) { const a = this.ctx.audio; return a.timeOfBeat(Math.round(a.beatAt(t))); }

  // ---- the edit ----

  private makeShots(): Shot[] {
    const B = (k: number) => this.bar(k), T = this.T, end = this.ctx.end + 2;
    const sh = (t0: number, t1: number, kind: Kind, o: Record<string, any> = {}): Shot => ({ t0, t1, kind, o, seed: Math.round(t0 * 10) });
    if (this.n === 3) {
      const D0 = Math.min(this.snap(T.d), B(4)), G2 = this.snap(T.g2);
      return [
        sh(-Infinity, B(1), 'wide', { d0: 360, d1: 70, el0: 0.15, el1: 0.55, az0: 0.4, az1: 1.1, roll0: 0.6, roll1: -0.1, dive: true, waves: 'core' }),
        sh(B(1), B(2), 'fly', { arm: 1, r0: 38, vr: 4.5, c0: [-3.5, 1.6, 5.2], c1: [-3.5, 1.0, 4.6], g0: [3.5, 0.2, 0], roll0: 0.15, roll1: -0.05, waves: 'cam' }),
        sh(B(2), B(3), 'fly', { arm: 0, r0: 70, vr: 1.0, c0: [-5, -10, 7.5], c1: [-3, 9, 5], g0: [3, -4, 0], g1: [3, 3.5, 0], roll0: -0.35, roll1: 0.3, waves: 'cam' }),
        sh(B(3), D0, 'giants', { d0: 70, d1: 34, el0: 0.75, el1: 0.45, az0: 0.15, az1: 0.05, tu: 0.15, reveal: true }),
        sh(D0, B(5), 'giants', { d0: 27, d1: 22, el0: 0.55, el1: 0.6, az0: -0.45, az1: -0.2, tu: 0.1, roll0: -0.1, roll1: 0.05 }),
        sh(B(5), G2, 'giants', { d0: 19, d1: 24, el0: 0.35, el1: 0.5, az0: 2.6, az1: 2.25, tu: 0.2, roll0: 0.12, roll1: -0.06 }),
        sh(G2, B(7), 'wide', { d0: 34, d1: 150, el0: 0.12, el1: 0.38, az0: 2.1, az1: 2.5, roll0: 0.2, roll1: 0.6, waves: 'core' }),
        sh(B(7), B(8), 'fly', { arm: 0, r0: 30, vr: 5, c0: [-3, -1.8, 5.2], g0: [4, -0.4, 0], roll0: -0.1, roll1: 0.12, waves: 'cam' }),
        sh(B(8), B(9), 'fly', { arm: 1, r0: 88, vr: -2.5, c0: [3, 8, 11], c1: [1.5, -1.5, 5], g0: [-4, 0, 0], g1: [-5, -0.5, 0], roll0: 0.5, roll1: -0.15, rings: true, waves: 'downs' }),
        sh(B(9), B(10), 'fly', { arm: 0, r0: 60, vr: -5.5, burst: -4, c0: [4, 1.5, 8], c1: [-2, -1.5, -3], g0: [-9, 0, -1], g1: [-11, 0, -4], roll0: -0.25, roll1: 0.3, rings: true, waves: 'downs' }),
        sh(B(10), B(11), 'wide', { d0: 120, d1: 95, el0: 0.95, el1: 0.85, az0: -0.6, az1: -0.2, roll0: 0, roll1: 0.15, rings: true, waves: 'core', off: [0, 0, 0] }),
        sh(B(11), B(12), 'giants', { d0: 30, d1: 24, el0: 0.4, el1: 0.3, az0: 0.6, az1: 0.25, tu: 0.12, lights: 1 }),
        sh(B(12), B(13), 'giants', { d0: 17, d1: 12, el0: 0.2, el1: 0.12, az0: -0.15, az1: 0, tu: 0.3, aim: 'grip', join: true }),
        sh(B(13), B(14), 'sun', {}),
        sh(B(14), end, 'converge', {}),
      ];
    }
    const D0 = this.snap(T.d), G2 = this.snap(T.g2), D1 = this.snap(D0 + (G2 - D0) / 2);
    return [
      sh(-Infinity, B(1), 'fly', { arm: 0, r0: 52, vr: 1.4, c0: [-6, 0, 42], c1: [-2.5, 0.8, 7], g0: [4, 0, 0], g1: [4, 0.2, 0], roll0: 0.5, roll1: 0.05, dive: true, fov0: 62, fov1: 55, waves: 'cam' }),
      sh(B(1), B(2), 'fly', { arm: 1, r0: 40, vr: 4, c0: [-3.5, 1.2, 5.5], c1: [-3.5, 0.8, 5.0], g0: [3, 0, 0], roll0: 0.15, roll1: -0.05, waves: 'cam' }),
      sh(B(2), B(3), 'fly', { arm: 0, r0: 76, vr: 0.8, c0: [-4, -9, 7], c1: [-3, 7, 5.5], g0: [3, -4, 0], g1: [3, 3, 0], roll0: -0.35, roll1: 0.3, waves: 'cam' }),
      sh(B(3), D0, 'fly', { arm: 1, r0: 44, vr: -7, accel: 2.5, c0: [3, 1.5, 6.5], c1: [3, 1.5, 12], g0: [-8, 0, 0], roll0: 0.05, roll1: -0.35, fov0: 58, fov1: 72, lookCore: 0.8 }),
      sh(D0, D1, 'giants', { d0: 32, d1: 25, el0: 0.55, el1: 0.45, az0: 2.95, az1: 3.1, tu: -0.05 }),
      sh(D1, G2, 'giants', { d0: 17, d1: 22, el0: 0.5, el1: 0.62, az0: 0.35, az1: 0.1, tu: 0.15, roll0: -0.12, roll1: 0.05 }),
      sh(G2, B(6), 'wide', { d0: 30, d1: 105, el0: 0.1, el1: 0.35, az0: 0.8, az1: 1.2, roll0: -0.1, roll1: 0.35, waves: 'core' }),
      sh(B(6), B(7), 'fly', { arm: 1, r0: 62, vr: -4.5, c0: [3, 2.2, 5.2], c1: [3, 1.4, 4.4], g0: [-4, 0, 0], roll0: -0.12, roll1: 0.1, waves: 'cam' }),
      sh(B(7), B(8), 'fly', { arm: 0, r0: 40, vr: 3.2, c0: [-4, -1.5, 9], c1: [3, 1.5, -2.5], g0: [10, 0, -1], g1: [12, 0, -4], roll0: 0.3, roll1: -0.4, waves: 'cam', through: true }),
      sh(B(8), B(9), 'wide', { d0: 330, d1: 120, el0: 1.05, el1: 0.82, az0: -0.9, az1: -0.55, roll0: -0.2, roll1: 0.1, rings: true }),
      sh(B(9), B(10), 'fly', { arm: 1, r0: 90, vr: -5, burst: -5, c0: [2.5, 1.6, 5.5], g0: [-4, 0.2, 0], roll0: 0.2, roll1: -0.15, rings: true }),
      sh(B(10), B(11), 'fly', { arm: 0, r0: 66, vr: 2.0, c0: [-2, 6, 10], c1: [-1.5, -1, 6], g0: [2, 0, 0], g1: [3, 0, 0], roll0: -0.45, roll1: 0.12, rings: true }),
      sh(B(11), B(12), 'gap', {}),
      sh(B(12), B(13), 'fly', { arm: 0, rg: true, vr: 0, c0: [-0.5, 0.4, 3.2], c1: [-10, -18, 125], g0: [0, 0.3, 0], g1: [0, -40, 0], roll0: 0, roll1: 0.3, ease: 'outExpo', fov0: 52, fov1: 60 }),
      sh(B(13), B(14), 'giants', { d0: 28, d1: 15, el0: 0.5, el1: 0.25, az0: 2.8, az1: 3.0, tu: 0.1, aim: 'grip', join: true }),
      sh(B(14), B(15), 'wide', { d0: 26, d1: 120, el0: 0.08, el1: 0.3, az0: 0.0, az1: 0.5, roll0: 0, roll1: 0.4, waves: 'core', join: true }),
      sh(B(15), end, 'giants', { d0: 60, d1: 3, el0: 0.1, el1: 0.0, az0: 0, az1: 0, tu: 0.3, aim: 'grip', join: true, rush: true }),
    ];
  }

  /**
   * When the entry starts inside the drop (after the city's lights rise into the sky), the people of the galaxy
   * assemble from flying stars over its first second.
   */
  private reveal(t: number) {
    if (this.ctx.start < this.sec0 + 1) return 1;
    return smoothstep(this.ctx.start - 0.45, this.ctx.start + 1.2, t);
  }

  // ---- time helpers ----

  /** Beat pulse on the grid, sharpened by the detected kicks. */
  private kickAt(t: number) {
    const a = this.ctx.audio, b = a.timeOfBeat(Math.floor(a.beatAt(t) + 1e-4));
    return Math.max(pulse(t, b, 0.09) * 0.85, a.hit('kick', t, 0.08));
  }

  /** Chop launch times in [t0, t1]: the strong ones, at least `gap` apart (and the phrase starts). */
  private launches(t0: number, t1: number, min = 0.45, gap = 0.5) {
    const out: number[] = [];
    for (const [t, k] of this.chops) {
      if (t < t0 || t > t1) continue;
      const phrase = [this.T.g1, this.T.g2, this.T.d].some((p) => Math.abs(p - t) < 0.02);
      if (k < min && !phrase) continue;
      if (out.length && t - out[out.length - 1]! < gap) continue;
      out.push(t);
    }
    return out;
  }

  // ---- render ----

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    if (this.legacy) return this.legacy.render(f, out);
    const t = f.t;
    this.tNow = t;
    // (the lead-in of the transition into the entry belongs to its first shot)
    const ts = Math.max(t, this.ctx.start);
    const sh = this.shots.find((s) => ts < s.t1) ?? this.shots[this.shots.length - 1]!;
    this.kick = this.kickAt(t);
    this.flash = 0;
    this.shake = 0;
    this.waves = [];
    this.rings = 0;
    this.flares.begin();
    this.bgFlares.begin();
    this.sticker.visible = this.lantern.visible = this.sunDisc.visible = false;
    this.he.visible = this.she.visible = false;
    const cam = this.st.cam, L = this.look;
    cam.fov = 55;
    this.gal.group.scale.setScalar(1);
    this.gal.group.rotation.set(0, 0, 0);
    // the sky turns with each shot, so every cut lands on a new piece of it
    this.neb.rotation.set(hash(sh.seed, 1) * 1.2 - 0.6, hash(sh.seed, 2) * TAU, hash(sh.seed, 3) * 0.6 - 0.3);
    this.far.rotation.copy(this.neb.rotation);

    const chop = this.ctx.audio.hit('chop', t, 0.1);
    const st: DrawState = { k: 1 + 0.22 * chop, core: 1 + 0.45 * this.kick, scale: 1, twist: 0, clock: t, heroes: false, post: {} };
    switch (sh.kind) {
      case 'fly': this.fly(t, sh, st); break;
      case 'giants': this.giants(t, sh, st); break;
      case 'wide': this.wide(t, sh, st); break;
      case 'gap': this.gapShot(t, sh, st); break;
      case 'sun': this.sunShot(t, sh, st); break;
      case 'converge': this.converge(t, sh, st); break;
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    for (const o of [this.neb, this.far]) o.position.copy(cam.position);

    // the galaxy's own light; the core pulses on the kicks
    this.crowd.sky(cam, st.core, st.disk ?? 1);
    if (st.scale !== 1 || st.twist) { this.gal.group.scale.setScalar(st.scale); this.gal.group.rotation.y = -st.twist; }
    const ck = (st.coreK ?? 1) * st.scale;
    if (ck > 0.01) {
      this.bgFlares.glow(V(), L.core, (0.35 + 0.5 * this.kick) * ck, 3.5 * st.scale, 1, 4);
      this.bgFlares.glow(V(), L.accent, 0.05 * (1 + this.kick) * ck, 30 * st.scale, 1, 3);
    }
    // the people
    const D = this.D;
    D.time = t * 3;
    D.begin(cam);
    this.crowd.draw(D, cam, {
      t: st.clock, k: st.k, scale: st.scale, twist: st.twist, near: st.near, range: st.range,
      wave: (arm, lk) => this.waveAt(arm, lk, t),
      light: (arm, lk, p) => this.lightAt(arm, lk, p, t),
      hide: st.hide, shift: st.shift, draw: this.reveal(t),
    });
    st.extra?.();
    D.end();
    this.flares.end();
    this.bgFlares.end();
    this.bgFlares.renderOrder = 1;
    this.st.render(this.ctx.renderer, out);
    const k = this.kick, sk = this.shake;
    return {
      bloom: 0.9 + 0.2 * k, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12 + (this.n === 3 ? 0.06 : 0), vignette: 0.45, grain: 0.05,
      ca: 0.6 + 1.0 * k + 2 * sk, zoom: 1 + 0.012 * k, flash: this.flash + 0.03 * chop,
      shake: [noise1(t * 37, 1) * 9 * sk, noise1(t * 37, 2) * 9 * sk] as [number, number],
      ...st.post,
    };
  }

  // ---- waves of raised hands, light through the people ----

  /** Raised hands 0..1 for a person of `arm` at link coordinate lk. */
  private waveAt(arm: number, lk: number, t: number) {
    let w = 0;
    for (const W of this.waves) {
      if (W.arm >= 0 && W.arm !== arm) continue;
      const d = W.dir === 0 ? Math.abs(lk - W.L0) : (lk - W.L0) * W.dir;
      if (d < 0) continue;
      const tau = t - (W.t0 + d / W.v);
      if (tau <= 0 || tau > 1.4) continue;
      w = Math.max(w, W.amp * smoothstep(0, 0.32, tau) * (1 - smoothstep(0.55, 1.35, tau)));
    }
    return w;
  }

  /** Brightness: a bright front where a wave passes, rings of light out from the core on the kicks. */
  private lightAt(arm: number, lk: number, p: THREE.Vector3, t: number) {
    let k = 1;
    for (const W of this.waves) {
      if (W.arm >= 0 && W.arm !== arm) continue;
      const d = W.dir === 0 ? Math.abs(lk - W.L0) : (lk - W.L0) * W.dir;
      if (d < 0) continue;
      const tau = t - (W.t0 + d / W.v);
      if (tau > -0.15 && tau < 0.6) k += 0.65 * W.amp * Math.exp(-(tau * tau) / 0.012);
      // (a wave that lights the arm for good: everyone it passed keeps glowing)
      if (W.glow && tau > 0) k += W.glow * smoothstep(0, 0.25, tau) * (0.55 + 0.45 * Math.exp(-tau / 1.5));
    }
    if (this.rings > 0) {
      const r = Math.hypot(p.x, p.z);
      for (const b of this.beats) {
        const age = t - b;
        if (age < 0) break;
        if (age > 2.2) continue;
        const R = 75 * age, x = (r - R) / 7;
        k += this.rings * 0.9 * Math.exp(-x * x) * (1 - age / 2.2);
      }
    }
    return k;
  }

  /** Waves for a shot: on the chop launches (or the downbeats), from `L0(tc)` along `dir`. */
  private addWaves(t: number, sh: Shot, mode: string | undefined, L0: (tc: number) => number, dir: number, arm = -1, v = 42) {
    if (!mode) return;
    const times = mode === 'downs' ? this.downs.filter((d) => d >= sh.t0 - 1.2 && d <= t) : this.launches(Math.max(sh.t0 - 1.2, this.sec0), t);
    for (const tc of times) this.waves.push({ t0: tc, arm, L0: L0(tc), dir, v, amp: 1 });
  }

  // ---- shots ----

  /** The chain line of arm a at radius r: point, outward normal (the people's up), tangent (outward along the arm). */
  private af(a: number, r: number) { return this.gal.armPoint(a, Math.max(6.5, r), 0); }

  /**
   * A flight relative to a point moving along an arm: camera and target offsets [along, out, up] in the arm's
   * frame there, eased from the start to the end of the shot; people upright on screen.
   */
  private fly(t: number, sh: Shot, st: DrawState) {
    const o = sh.o, cam = this.st.cam;
    const tau = t - Math.max(sh.t0, this.ctx.start - 0.5), dur = sh.t1 - Math.max(sh.t0, this.ctx.start - 0.5);
    const u = clamp(tau / dur), e = o.ease === 'outCubic' ? ease.outCubic(u) : o.ease === 'outExpo' ? ease.outExpo(u) : sine(u);
    const land = o.dive ? ease.outExpo(clamp(tau / 1.3)) : e;
    const r0 = o.rg ? Math.hypot(this.gap.pos.x, this.gap.pos.z) : o.r0;
    const r = r0 + o.vr * (tau + (o.accel ?? 0) * tau * tau / 2) + (o.burst ?? 0) * (1 - Math.exp(-tau / 0.3));
    const A = this.af(o.arm, r);
    const lc = (a: V3, b: V3 | undefined, k: number): V3 => [lerp(a[0], (b ?? a)[0], k), lerp(a[1], (b ?? a)[1], k), lerp(a[2], (b ?? a)[2], k)];
    const c = lc(o.c0, o.c1, o.dive ? land : e), g = lc(o.g0, o.g1, e);
    const pos = A.p.clone().addScaledVector(A.t, c[0]).addScaledVector(A.n, c[1]).addScaledVector(Y, c[2]);
    const tgt = A.p.clone().addScaledVector(A.t, g[0]).addScaledVector(A.n, g[1]).addScaledVector(Y, g[2]);
    // (rushing in: the eye goes to the light of the core)
    if (o.lookCore) tgt.lerp(V(0, 0, 0), ease.inOutCubic(clamp(u * 1.4)) * o.lookCore);
    pos.add(V(noise1(t * 0.9, 3), noise1(t * 0.8, 4), noise1(t * 0.7, 5)).multiplyScalar(0.12));
    aim(cam, pos, tgt, lerp(o.roll0 ?? 0, o.roll1 ?? 0, e) + 0.02 * Math.sin(t * 1.3), A.n);
    cam.fov = lerp(o.fov0 ?? 56, o.fov1 ?? o.fov0 ?? 56, e);
    st.near = pos;
    st.range = o.dive ? 140 : 90;
    if (o.rings) this.rings = 1;
    // the waves start just behind the camera and race away along the arm
    const dir = g[0] >= c[0] ? 1 : -1;
    this.addWaves(t, sh, o.waves, (tc) => {
      const rc = r0 + o.vr * (tc - sh.t0);
      return this.crowd.lkAt(o.arm, rc) + dir * (c[0] - 3);
    }, dir, o.arm);
    if (o.rg) this.joined(t, st, true);
  }

  /** Giants in front of the core: orbit (distance d, elevation el from straight in front, azimuth az). */
  private giants(t: number, sh: Shot, st: DrawState) {
    const o = sh.o, cam = this.st.cam, L = this.look;
    const t0 = Math.max(sh.t0, this.ctx.start - 0.5), t1 = Math.min(sh.t1, this.ctx.end), u = clamp((t - t0) / (t1 - t0));
    const e = o.rush ? ease.inOutCubic(u) : sine(u), land = ease.outExpo(clamp((t - t0) / 0.6));
    const d = lerp(o.d0, o.d1, e) * (1 + 0.25 * (1 - land) * (o.rush ? 0 : 1));
    const el = lerp(o.el0, o.el1, e), az = lerp(o.az0, o.az1, e);
    const Gc = GC.clone();
    const J = this.poseGiants(t, sh, st);
    const target = o.aim === 'grip' ? Gc.clone().lerp(J.grip, sine(prog(t, t0, t0 + 0.8))) : Gc.clone().addScaledVector(U, (o.tu ?? 0) * GS);
    const dirv = F.clone().multiplyScalar(Math.cos(el)).add(U.clone().multiplyScalar(-Math.cos(az) * Math.sin(el))).add(X.clone().multiplyScalar(Math.sin(az) * Math.sin(el)));
    const pos = target.clone().addScaledVector(dirv, d);
    pos.add(V(noise1(t * 0.6, 7), noise1(t * 0.5, 8), noise1(t * 0.55, 9)).multiplyScalar(0.25));
    aim(cam, pos, target, lerp(o.roll0 ?? 0, o.roll1 ?? 0, e) + 0.03 * Math.sin(t * 0.9), U);
    cam.fov = o.rush ? lerp(52, 75, ease.inQuart(u)) : 50;
    // (the core shines behind them, but not so bright that it washes them out)
    st.core = (o.reveal ? 1.0 : 0.45) * (1 + 0.45 * this.kick);
    st.coreK = o.reveal ? 0.8 : 0.3;
    st.disk = 0.45;
    if (o.rush) {
      // into the light of their joined hands
      const k = ease.inQuart(u);
      this.flares.glow(J.grip, L.flash, 0.6 + 3 * k, GS * (0.12 + 1.2 * k));
      st.post.exposure = 1 + 0.6 * k;
      this.flash = Math.max(this.flash, 0.6 * smoothstep(0.82, 1, u));
    }
    this.addWaves(t, sh, 'chops', () => 0, 1, -1, 46);
  }

  /** The whole galaxy: an orbit about the core (d, el from straight above, az), people as its stars. */
  private wide(t: number, sh: Shot, st: DrawState) {
    const o = sh.o, cam = this.st.cam;
    const t0 = Math.max(sh.t0, this.ctx.start - 0.5), u = clamp((t - t0) / (sh.t1 - t0));
    const e = o.dive ? ease.outCubic(u) : ease.outCubic(u);
    const d = lerp(o.d0, o.d1, e), el = lerp(o.el0, o.el1, e), az = lerp(o.az0, o.az1, sine(u));
    const pos = V(Math.sin(el) * Math.cos(az) * d, Math.cos(el) * d, Math.sin(el) * Math.sin(az) * d);
    const tgt = V(0, 0, 0);
    // screen-up: toward the far side of the disk, rolled
    const up = V(-Math.cos(az), 0, -Math.sin(az));
    aim(cam, pos, tgt, lerp(o.roll0 ?? 0, o.roll1 ?? 0, sine(u)), up);
    cam.fov = 55;
    if (o.rings) this.rings = 1;
    this.addWaves(t, sh, o.waves === 'core' ? 'chops' : undefined, () => 0, 1, -1, 46);
    if (o.rings) for (const b of this.downs) if (b >= sh.t0 - 1 && b <= t) this.waves.push({ t0: b, arm: -1, L0: 0, dir: 1, v: 60, amp: 1 });
    if (o.join) { this.poseGiants(t, sh, st, true); st.heroes = true; }
  }

  // ---- the giants ----

  /**
   * Pose the giant pair (and draw them in st.extra): dancing (motion capture); in a `join` shot, or after
   * drop 1's second "take my hand", their inner hands reach for each other and hold. Returns the grip.
   */
  private poseGiants(t: number, sh: Shot, st: DrawState, held = false) {
    const T = this.T, L = this.look;
    const join = sh.o.join || held;
    const reach = join ? prog(t, T.take2 - 0.05, T.hand2, ease.inOutCubic) : 0;
    const grip = GRIP.clone();
    const pose = (fig: RealFigure, m: Mover, pos: THREE.Vector3, inner: number, out: THREE.Vector3[]) => {
      fig.visible = true;
      fig.position.copy(pos);
      fig.quaternion.copy(QG);
      fig.scale.setScalar(GS);
      this.moves.apply(fig, m, t);
      if (reach > 0) {
        const h = fig.hand(inner);
        fig.reach(inner, h.lerp(grip.clone().addScaledVector(X, inner ? -0.03 * GS : 0.03 * GS), reach), V(0, -0.6, -0.6));
        fig.setHand(inner, 0.15 + 0.45 * reach);
      }
      return starJoints(fig, out);
    };
    // he on the left (his left hand is the inner one), she on the right
    const jA = pose(this.he, this.heM, HE, 1, this.jA), jB = pose(this.she, this.sheM, SHE, 0, this.jB);
    const gripNow = jA[6]!.clone().lerp(jB[7]!, 0.5);
    const hold = smoothstep(T.hand2 - 0.06, T.hand2 + 0.02, t) * (join ? 1 : 0);
    if (hold > 0) this.waves.push({ t0: T.hand2, arm: -1, L0: 0, dir: 1, v: 50, amp: 1 });
    st.heroes = true;
    const prev = st.extra;
    st.extra = () => {
      prev?.();
      const D = this.D;
      const [ca, cb] = L.hero;
      const hk = (1 + 0.25 * this.kick) * (st.heroK ?? 1);
      // (a figure's stardust holds the same light at any size: spread over a giant it needs more of it)
      for (const f of [this.he, this.she]) f.mat.uniforms.alpha!.value = 0.75 * Math.min(1, st.heroK ?? 1);
      D.figure(jA, 0, ca, GK * hk, { color2: L.heroDeep, seed: 1.3, size: 1.1, shatter: st.heroShatter ?? 0 });
      D.figure(jB, 1, cb, GK * hk, { color2: L.heroDeep, seed: 4.1, size: 1.1, shatter: st.heroShatter ?? 0 });
      this.giantDust(t, jA, jB, st.heroK ?? 1);
      if (hold > 0) {
        // the join: a flash where the hands meet
        const fl = pulse(t, T.hand2, 0.25);
        this.flares.glow(gripNow, L.flash, (0.5 + 2.0 * fl) * hold, GS * (0.03 + 0.08 * fl));
        this.flares.glow(gripNow, L.accent, 0.3 * fl, GS * 0.35, 4, 6);
        D.star(gripNow, L.flash, 2 + 4 * fl, GS * 0.05);
        if (t - T.hand2 < 0.15 && t >= T.hand2) this.shake = Math.max(this.shake, 1 - (t - T.hand2) / 0.15);
        this.flash = Math.max(this.flash, 0.08 * fl);
      }
      if (this.n === 3) this.carried(t, jA, jB, gripNow, st);
    };
    return { grip: hold > 0.5 ? gripNow : grip.lerp(gripNow, reach), jA, jB };
  }

  /** Stardust shed by the giants' hands and feet as they dance: trails along the way the limbs moved. */
  private giantDust(t: number, jA: THREE.Vector3[], jB: THREE.Vector3[], k = 1) {
    const D = this.D, L = this.look, em = [6, 7, 11, 12, 4, 5];
    const step = 1 / 30, span = 1.1;
    ([[this.heM, HE, L.hero[0], jA], [this.sheM, SHE, L.hero[1], jB]] as const).forEach(([mv, pos, c, jNow], gi) => {
      for (let n = Math.ceil((t - span) / step); n * step <= t; n++) {
        const tb = n * step, age = t - tb;
        const j = place(this.moves.pose(mv, tb, this.pose), pos, QG, GS, mv.mirror, this.js);
        // (the newest dust leaves from where the hand is now, IK and all)
        const fresh = 1 - smoothstep(0, 0.12, age);
        em.forEach((ji, e) => {
          const h = (q: number) => hash(n, gi * 7 + e, q);
          const p = j[ji]!.clone().lerp(jNow[ji]!, fresh);
          p.addScaledVector(V(h(1) - 0.5, h(2) - 0.5, h(3) - 0.5), GS * 0.5 * age).addScaledVector(F, GS * 0.08 * age);
          D.star(p, c, k * 0.9 * Math.pow(1 - age / span, 2) * (0.4 + h(4)), GS * (0.012 + 0.02 * h(5)));
        });
      }
    });
  }

  /** Drop 3: his star sticker and her paper lantern, carried in their inner hands; one star once the hands meet. */
  private carried(t: number, jA: THREE.Vector3[], jB: THREE.Vector3[], grip: THREE.Vector3, st: DrawState) {
    const L = this.look, T = this.T, cam = this.st.cam;
    const merge = smoothstep(T.hand2 - 0.12, T.hand2 + 0.05, t);
    // in their inner hands, so the hands bring them together: the lantern hanging from his, the star above her palm
    const pL = jA[6]!.clone().lerp(jA[4]!, -0.1).addScaledVector(U, -0.17 * GS * (1 - merge)).lerp(grip, merge);
    const pS = jB[7]!.clone().lerp(jB[5]!, -0.25).lerp(grip, merge);
    const k = (st.lightK ?? 1) * (1 - merge);
    if (k > 0.01) {
      // (since the break they carry each other's: she has his star, he has her lantern)
      this.sticker.visible = true;
      this.sticker.position.copy(pS);
      this.sticker.quaternion.copy(cam.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0.3 * Math.sin(t * 0.8)));
      this.sticker.level = 1.4 * k;
      this.lantern.visible = true;
      this.lantern.position.copy(pL);
      this.lantern.quaternion.setFromUnitVectors(V(0, 1, 0), U);
      this.lantern.lit = k;
      this.lantern.time = t;
      this.lantern.update();
    }
    // one star
    if (merge > 0) {
      const fl = pulse(t, T.hand2, 0.35);
      this.star(grip, merge * (1 + 1.5 * fl), GS * 0.035, 1 + 1.2 * fl);
    }
    void L;
  }

  /** A star point: a hot core, a soft glow and four thin rays (`rays` scales their length). */
  private star(p: THREE.Vector3, k: number, size: number, rays = 1) {
    const L = this.look, w = col('#fff7e6', 2.6);
    this.flares.glow(p, w, 1.2 * k, size);
    this.flares.glow(p, L.accent, 0.3 * k, size * 5, 1, 3);
    const len = size * 26 * rays;
    this.flares.glow(p, L.accent, 0.35 * k, Math.sqrt((len * size * 0.25) / 1.4), len / Math.sqrt((len * size * 0.25) / 1.4), 7);
    this.flares.glow(p, L.accent, 0.35 * k, len * 0.8, (size * 0.25) / (len * 0.8), 7);
  }

  /** Drop 1's "take my hand" (1): the gap in the chain closes; the two at its ends join hands. */
  private gapShot(t: number, sh: Shot, st: DrawState) {
    const cam = this.st.cam, T = this.T;
    const t0 = Math.max(sh.t0, this.ctx.start - 0.5), u = clamp((t - t0) / (sh.t1 - t0)), e = sine(u);
    const g = this.gap, r = Math.hypot(g.pos.x, g.pos.z);
    const A = this.af(g.arm, r);
    const c: V3 = [lerp(-3.8, -0.8, e), lerp(1.0, 0.45, e), lerp(4.6, 3.1, e)];
    const pos = g.pos.clone().addScaledVector(A.t, c[0]).addScaledVector(A.n, c[1]).addScaledVector(Y, c[2]);
    const tgt = g.pos.clone().addScaledVector(A.n, 0.25).addScaledVector(A.t, lerp(-0.6, 0, e));
    aim(cam, pos, tgt, lerp(0.12, -0.04, e) + 0.02 * Math.sin(t * 1.1), A.n);
    cam.fov = lerp(50, 44, ease.inOutCubic(prog(t, T.take1 - 0.3, T.hand1 + 0.4)));
    st.near = g.pos;
    st.range = 60;
    this.joined(t, st, false);
  }

  /**
   * The gap and its two people: the chain halves are held apart until "hand"; the end people reach for each
   * other on "take" and grip on "hand" (flash, the light runs along the arm both ways). Drawn in st.extra.
   */
  private joined(t: number, st: DrawState, after: boolean) {
    const T = this.T, L = this.look, g = this.gap, ch = this.crowd.chains[g.arm]!, P = this.gal.people;
    const close = after ? 1 : ease.inOutCubic(prog(t, T.hand1 - 0.5, T.hand1));
    const open = 0.65 * (1 - close);
    const ia = ch[g.link]!, ib = ch[g.link + 1]!;
    st.hide = (i) => i === ia || i === ib;
    st.shift = (i, Pp, p) => {
      if (!Pp.chain || this.crowd.arm[i] !== g.arm || open <= 0) return;
      const d = Pp.link - (g.link + 0.5);
      p.addScaledVector(this.tangents[i]!, Math.sign(d) * open * Math.exp(-(Math.abs(d) - 0.5) / 10));
    };
    const reach = after ? 1 : ease.inOutCubic(prog(t, T.take1 - 0.05, T.hand1));
    const M = g.pos.clone().addScaledVector(P[ia]!.up, 0.32).addScaledVector(Y, 0.22);
    const hold = after ? 1 : smoothstep(T.hand1 - 0.06, T.hand1 + 0.02, t);
    if (hold > 0) this.waves.push({ t0: T.hand1, arm: g.arm, L0: g.link + 0.5, dir: 0, v: 60, amp: 1, glow: after ? 1.1 : 0.45 });
    const q = new THREE.Quaternion();
    const draw = (i: number, sgn: number, out: THREE.Vector3[]) => {
      const Pp = P[i]!, fig = this.ends[Pp.body % 2]!;
      const pos = Pp.p.clone().addScaledVector(this.tangents[i]!, sgn * open);
      const front = Y, up = Pp.up;
      q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(up, front), up, front));
      fig.setMocap(null);
      fig.position.set(0, 0, 0);
      fig.quaternion.identity();
      const w = this.waveAt(g.arm, Pp.link, t), e = w * w * (3 - 2 * w);
      for (const k of [0, 1]) {
        const sd = k ? 1 : -1, ua = limbDir(sd, 0.8 + (2.34 - 0.8) * e, 0.1);
        fig.setArm(k, ua, bend(ua, V(-sd * 0.2, 0.3, 1), 0.14), 0);
        fig.setHand(k, 0.25);
        const th = limbDir(sd, 0.05, 0.02);
        fig.setLeg(k, th, bend(th, V(0, 0, -1), 0.06 + 0.1 * (1 - e)));
        fig.setFoot(k, 0.15 * e);
      }
      fig.setSpine(0.04 - 0.14 * e + 0.1 * reach * (1 - hold), 0, 0.12 - 0.35 * e - 0.25 * reach * (1 - hold), 0);
      // the free hand: the one toward the gap
      const xw = V(1, 0, 0).applyQuaternion(q);
      const free = (xw.dot(this.tangents[i]!) * -sgn > 0) ? 1 : 0;
      const local = M.clone().sub(pos).applyQuaternion(q.clone().invert());
      local.x += free ? -0.025 : 0.025;
      const rest = fig.hand(free);
      const hang = rest.clone().lerp(V(free ? 0.45 : -0.45, -0.25, 0.2), 0.5);
      fig.reach(free, hang.lerp(local, reach), V(0, -0.6, -0.6));
      fig.setHand(free, 0.5 - 0.35 * reach + 0.3 * hold);
      starJoints(fig, out);
      for (const v of out) v.applyQuaternion(q).add(pos);
      return out;
    };
    const jA = draw(ia, -1, this.jA), jB = draw(ib, 1, this.jB);
    const prev = st.extra;
    st.extra = () => {
      prev?.();
      const D = this.D, C = L.crowd.chain;
      const k = 1.05 + 0.6 * pulse(t, T.hand1, 0.35) * hold;
      D.figure(jA, P[ia]!.body, C, k, { color2: L.crowd.deep, seed: 2.2 });
      D.figure(jB, P[ib]!.body, C, k, { color2: L.crowd.deep, seed: 5.7 });
      if (hold > 0) {
        const fl = pulse(t, T.hand1, 0.22);
        this.flares.glow(M, L.flash, (0.3 + 1.5 * fl) * hold, 0.05 + 0.12 * fl);
        this.flares.glow(M, L.accent, 0.25 * fl, 0.4, 4, 6);
        D.star(M, L.flash, 1.5 + 3 * fl, 0.1);
        this.flash = Math.max(this.flash, 0.035 * fl);
        if (t >= T.hand1 && t - T.hand1 < 0.14) this.shake = Math.max(this.shake, 0.8 * (1 - (t - T.hand1) / 0.14));
      } else if (reach > 0) {
        // the light between the reaching hands
        this.flares.glow(M, L.accent, 0.25 * reach, 0.25);
      }
    };
  }

  /** Drop 3: the star swells into the sun; pulling back over the golden galaxy, wave after wave of hands. */
  private sunShot(t: number, sh: Shot, st: DrawState) {
    const cam = this.st.cam;
    const t0 = Math.max(sh.t0, this.ctx.start - 0.5), u = clamp((t - t0) / (sh.t1 - t0));
    const J = this.poseGiants(t, { ...sh, o: { join: true } }, st, true);
    const grow = ease.inOutCubic(prog(t, t0 - 0.1, sh.t1 - 0.25));
    // the two dissolve into stars that fly off into the light
    st.heroK = 1 - 0.6 * grow;
    st.heroShatter = ease.inQuad(prog(t, t0 + 0.2, sh.t1 + 0.2)) * 0.9;
    st.lightK = 0;
    const S = J.grip;
    const d = lerp(18, 120, ease.inOutCubic(u));
    const pos = S.clone().addScaledVector(F, d * Math.cos(0.3 * (1 - u))).addScaledVector(U, -d * Math.sin(0.3 * (1 - u)));
    aim(cam, pos, S, 0.2 * u, U);
    cam.fov = 55;
    this.sun(S, grow, t);
    st.core = 1.2 + 0.4 * this.kick;
    // wave after wave out from the centre, on every beat
    for (const b of this.beats) if (b >= sh.t0 - 0.9 && b <= t) this.waves.push({ t0: b, arm: -1, L0: 0, dir: 1, v: 55, amp: 1, glow: 0.25 });
    st.k = (st.k ?? 1) * (1 + 0.35 * grow);
  }

  /** The sun at `p`: a disc with a corona and rays; g = 0 (still a star) … 1 (the sun, radius 6). */
  private sun(p: THREE.Vector3, g: number, t: number, point = 1) {
    const R = lerp(0.15, 6, g);
    if (g > 0.03) {
      const D = this.sunDisc;
      D.visible = true;
      D.position.copy(p);
      D.quaternion.copy(this.st.cam.quaternion);
      D.scale.setScalar(R);
      D.set(col('gold', 1).lerp(col('ember', 1), 0.2), 1.5 * smoothstep(0.03, 0.2, g), t);
      this.flares.glow(p, col('gold', 1).lerp(col('white', 1), 0.3), 0.55 * g, R * 2.0, 1, 3);
      this.flares.glow(p, col('ember', 1).lerp(col('gold', 1), 0.6), 0.22 * g, R * 5, 1, 2.2);
    }
    this.star(p, point * (1 + 0.15 * this.kick), 0.28 + 0.5 * g, 1 + 1.5 * g);
  }

  /** Drop 3's end: everything slows down and converges into one star point, centre frame. */
  private converge(t: number, sh: Shot, st: DrawState) {
    const cam = this.st.cam;
    const t0 = sh.t0, tEnd = this.ctx.end;
    // slow down: the clock's rate falls from 1 to 0 over 2.4 s
    const Ts = 2.4, x = clamp((t - t0) / Ts);
    st.clock = t0 + Ts * (x - (x * x) / 2);
    const c = ease.inOutCubic(prog(t, t0 + 0.2, tEnd - 0.25));
    st.scale = Math.max(0.002, 1 - c);
    st.twist = 1.8 * ease.inCubic(prog(t, t0, tEnd));
    // the sun gathers it all, and shrinks to a single star
    const g = 1 - ease.inOutCubic(prog(t, t0 + 0.3, tEnd - 0.35));
    const S = GRIP.clone().applyAxisAngle(Y, -st.twist).multiplyScalar(st.scale);
    this.sun(S, g, t, 1);
    // the camera stays on the axis, high above, drifting to a stop
    const d = 120 - 12 * ease.outCubic(prog(t, t0, tEnd));
    aim(cam, V(0, d, 0).addScaledVector(U, -10 * (1 - x) * (1 - x)), V(0, 0, 0), 0.2 + 0.15 * (1 - (1 - x) * (1 - x)), U);
    cam.fov = 55;
    st.core = (1 - c) * 1.1;
    st.coreK = 1 - c;
    st.disk = 1 - 0.6 * c;
    st.k = (st.k ?? 1) * (1 - 0.4 * c);
    for (const b of this.beats) if (b >= t0 - 0.9 && b <= Math.min(t, t0 + 1.2)) this.waves.push({ t0: b, arm: -1, L0: 0, dir: 1, v: 55 * (1 - 0.5 * x), amp: 1 - x });
    st.post.exposure = 1 - 0.1 * c;
  }
}

interface DrawState {
  k?: number; core: number; coreK?: number; disk?: number; scale: number; twist: number; clock: number;
  near?: THREE.Vector3; range?: number; heroes: boolean; heroK?: number; heroShatter?: number; lightK?: number;
  hide?: (i: number) => boolean; shift?: (i: number, P: import('../lib/galaxy').GalaxyPerson, p: THREE.Vector3) => void;
  extra?: () => void; post: Record<string, any>;
}
