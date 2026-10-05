// The drops (params.n = 1, 3): inside the galaxy of people (lib/galaxy.ts). Every star you fly past is a
// person of stardust (lib/stardust.ts) moving like a real person (motion capture, cosmos-motion.ts); along
// the middle of each spiral arm people hold hands in a chain, each one their own person (cosmos-crowd.ts). At
// the core float the two the story follows, HIM and HER (lib/heroes.ts colours), as giants of stardust over
// dark dust-lane bodies.
//
// Drop 1 (cyan / white), the galaxy half (the city's lights stream up into it on bar 9): the galaxy assembles
// out of flying stars; the instrumental bars go inside it — at eye level among the dancers, a crane past a
// chain — with waves of raised hands running along the arms on the downbeats, the core pulsing and rings of
// light running out through the people on every kick. "Take my hand" (1): a gap in a chain; on "take" a light
// runs down the arms of the two at its ends as they reach for each other, on "hand" their hands join with a
// flash and a ring of light, and the light runs out along the whole chain; we race beside it. "Take my hand"
// (2): he and she, reaching across the core, join hands the same way; a slow orbit round them as the waves
// run out through the galaxy; then we rush into the light of their hands (the bright end for the cut).
// If the entry starts with the drop itself, its first eight bars are galaxy shots too.
// Drop 3 (gold, the finale): the golden galaxy at full power, wave after wave of raised hands; at its centre
// the two dance, he carrying her paper lantern and she his star sticker (they swapped them in the break). On
// "take my hand" their hands meet; the two lights glide together and on the next downbeat merge into one star
// with a shockwave; the star swells into the sun rising over the galaxy; then everything slows down and
// converges into that single point (the outro starts from a star).
// Shots are a list on the section's bar grid (bar k = k-th downbeat of the drop section), so the entry can
// start later than the section and still land on its shots; the first shot moves through the lead-in.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { GlowPoints } from '../lib/points';
import { col } from '../lib/palette';
import { RealFigure, loadBody } from '../lib/people';
import { starJoints } from '../lib/stars';
import { Stardust, StardustBody } from '../lib/stardust';
import { Galaxy } from '../lib/galaxy';
import { Flares, place, type Pose } from './cosmos-gfx';
import { densityMap, nebula, starField } from './cosmos-sky';
import { Crowd, type ChainGap, type CrowdLook } from './cosmos-crowd';
import { CHAIN, DANCE, IDLE, Moves, SIT, type Mover } from './cosmos-motion';
import { SunDisc, dustLaneMaterial } from './cosmos-lights';
import { PaperLantern, StarSticker, heColor, sheColor } from '../lib/heroes';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
const TAU = Math.PI * 2;
const sine = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x));
type V3 = [number, number, number];

type Kind = 'fly' | 'portrait' | 'giants' | 'wide' | 'gap' | 'sun' | 'converge';
interface Shot { t0: number; t1: number; kind: Kind; o: Record<string, any>; seed: number }
/**
 * A wave of raised hands: from link L0 of `arm` (−1 = every arm) at t0, along +dir (0 = both ways), v links/s;
 * people raise their hands in groups, one group after another; `glow` leaves the people it passed lit.
 */
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
const GK = 5; // and their brightness
/** Where the giants are: their chest line 18 above the core, he at −X, she at +X; where their hands meet. */
const GC = V(0, 18, 0);
const HE = GC.clone().addScaledVector(U, -0.3 * GS).addScaledVector(X, -0.62 * GS);
const SHE = GC.clone().addScaledVector(U, -0.3 * GS).addScaledVector(X, 0.62 * GS);
const GRIP = GC.clone().addScaledVector(U, 0.12 * GS).addScaledVector(F, 0.22 * GS);
const QG = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, U, F));
const GROUP = 5; // people per group in a wave of raised hands

export default class Cosmos extends Scene {
  st = new Stage(55, 0.1, 6000);
  n = 1;
  sec0 = 0;
  downs: number[] = [];
  beats: number[] = [];
  chops: [number, number][] = [];
  T = { g1: 0, d: 0, g2: 0, take1: 0, hand1: 0, take2: 0, hand2: 0, merge: 0 };
  shots: Shot[] = [];
  look!: Look;
  gal!: Galaxy;
  crowd!: Crowd;
  moves!: Moves;
  D!: Stardust;
  flares = new Flares(96);
  /** Glows behind the people (the core): drawn before the giants' dark bodies. */
  bgFlares = new Flares(8);
  /** Drifting dust around the camera (sparkles of stardust in the air between the people). */
  motes = new GlowPoints(420, 1);
  neb!: THREE.Mesh;
  far!: THREE.Points;
  /** The giants (he, she). */
  he!: RealFigure;
  she!: RealFigure;
  heM: Mover = { clip: 0, body: 0, off: 0, rate: 1, mirror: false };
  sheM: Mover = { clip: 0, body: 1, off: 0, rate: 1, mirror: true };
  sticker = new StarSticker(0.05 * GS * 1.5);
  sunDisc = new SunDisc();
  lantern = new PaperLantern(0.11 * GS * 1.2);
  /** Drop 1's gap in a chain: arm, its index in the chain (the gap is after it), the two people, its middle. */
  gap = { arm: 0, k: 0, a: 0, b: 1, pos: V() };
  // per frame
  private kick = 0;
  private flash = 0;
  private shake = 0;
  private waves: Wave[] = [];
  private rings = 0;
  private js: THREE.Vector3[] = [];
  private jA: THREE.Vector3[] = [];
  private jB: THREE.Vector3[] = [];
  private jC: THREE.Vector3[] = [];
  private pose: Pose = new Float32Array(39);

  override async init() {
    const { audio, params } = this.ctx;
    this.n = params.n ?? 1;
    this.sec0 = audio.sections.find((s) => s.name === (this.n === 3 ? 'drop3' : 'drop1'))?.start ?? this.ctx.start;
    const w0 = Math.min(this.sec0, this.ctx.start) - 2, w1 = this.ctx.end + 3;
    this.downs = audio.downbeats.filter((d) => d >= w0 - 2 && d <= w1 + 2);
    this.beats = audio.beats.filter((b) => b >= w0 - 3 && b <= w1 + 1);
    this.chops = audio.events('chop', w0, w1);
    this.findTimes();
    this.look = this.makeLook();
    const L = this.look, S = this.st;
    S.bg.copy(col('night', 0.2));
    this.neb = nebula(densityMap(512, 256, 5 + this.n * 13), 2800);
    this.far = starField(3500, 2600, 11 + this.n, L.far, 0.3);

    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    const white = col('white');
    const fresh = () => [new RealFigure(rp!, 'rpm', white), new RealFigure(mi!, 'michelle', white)];
    this.D = new Stardust(fresh().map((f, i) => new StardustBody(f, 22000, i + 1)), [16, 700, 2600], { extras: 9000 });
    this.gal = new Galaxy(fresh(), 7);
    const names = [...new Set([...DANCE, ...IDLE, ...CHAIN.map(([c]) => c), ...SIT])];
    this.moves = await Moves.load(names, fresh());
    const clips: [string, number][] = [...DANCE.map((c) => [c, 1] as [string, number]), ...IDLE.map((c) => [c, 0.35] as [string, number])];
    this.crowd = new Crowd(this.gal, this.moves, 11 + this.n, clips, CHAIN, SIT, L.crowd);
    // the giants: their bodies are dark dust lanes under the stardust
    const lane = () => dustLaneMaterial(col('night', 0.15), 0.55);
    this.he = new RealFigure(rp!, 'rpm', white, lane(), { prepass: false });
    this.she = new RealFigure(mi!, 'michelle', white, lane(), { prepass: false });
    for (const f of [this.he, this.she]) { f.visible = false; f.renderOrder = 3; }
    // the giants dance with their arms held high (clip times chosen so "Da-a-ance" lands on the big moves)
    this.heM = { clip: this.moves.index('49_09'), body: 0, off: (this.n === 3 ? 6.0 : 0.4) - this.T.d, rate: 1, mirror: false };
    this.sheM = { clip: this.moves.index('49_12'), body: 1, off: (this.n === 3 ? 1.2 : 0.3) - this.T.d, rate: 1, mirror: true };
    this.tint();
    S.add(this.neb, this.far, this.gal.group, this.motes, this.bgFlares, this.he, this.she, this.D, this.flares, this.sticker, this.lantern, this.sunDisc);
    this.D.renderOrder = 4;

    // the gap in drop 1's chain: arm 0, about halfway out
    const ch0 = this.crowd.chains[0]!, P = this.crowd.people;
    const k = ch0.findIndex((i) => Math.hypot(P[i]!.p.x, P[i]!.p.z) > 46);
    this.gap = { arm: 0, k, a: ch0[k]!, b: ch0[k + 1]!, pos: P[ch0[k]!]!.p.clone().lerp(P[ch0[k + 1]!]!.p, 0.5) };
    this.shots = this.makeShots();
    for (const s of this.shots) if (s.kind === 'portrait') s.o.pi = this.dancerNear(s.o.arm, s.o.r, s.o.w);
  }

  /** A dancer near a point beside arm a (radius r, w across the arm), in the thick of the crowd. */
  private dancerNear(a: number, r: number, w: number) {
    const q = this.gal.armPoint(a, r, w).p, ppl = this.crowd.people;
    let best = 0, bs = -Infinity;
    ppl.forEach((P, i) => {
      if (P.chain || Math.abs(P.p.y) > 0.5 || P.p.distanceToSquared(q) > 36) return;
      let n = 0;
      for (const Q of ppl) if (Q !== P && Q.p.distanceToSquared(P.p) < 9) n++;
      const sc = n - 0.3 * P.p.distanceTo(q);
      if (sc > bs) { bs = sc; best = i; }
    });
    return best;
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
      // the two lights become one on the next downbeat
      this.T.merge = this.downs.find((d) => d > this.T.hand2 + 0.3) ?? B(13);
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
        gas: col('ember', 0.025).lerp(col('gold', 0.025), 0.5), fil: col('gold', 0.06).lerp(col('white', 0.06), 0.2), far: col('gold', 1),
        armStar: col('gold', 1).lerp(col('white', 1), 0.45), coreStar: col('#fff1d0', 1), diskWarm: v3(col('gold', 1).lerp(col('white', 1), 0.35)), diskArm: v3(col('gold', 1).lerp(col('ember', 1), 0.3)), knot: col('ember', 0.35).lerp(col('gold', 0.35), 0.4),
      };
    }
    const cyan = col('cyan', 1.4), white = col('white', 1.4);
    return {
      crowd: { chain: col('white', 1.5).lerp(col('cyan', 1.5), 0.25), a: cyan.clone().lerp(white, 0.3), b: col('white', 1.4).lerp(col('blue', 1.4), 0.2), deep: col('blue', 1.1).lerp(col('cyan', 1.1), 0.25) },
      hero: [heColor().lerp(col('white', 1.2), 0.3), sheColor().lerp(col('white', 1.2), 0.3)], heroDeep: col('blue', 0.9).lerp(col('violet', 0.9), 0.3),
      core: col('#eefaff', 2.2), flash: col('#e8fbff', 2.5), accent: col('cyan', 1.6),
      gas: col('blue', 0.14).lerp(col('cyan', 0.14), 0.2), fil: col('cyan', 0.12), far: col('cyan', 1),
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
      const k = (lum / cl) * (1 - 0.6 * warm) * 0.8; // (the bulge is dense: dimmer stars, or it burns out)
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

  /** When a shot's motion starts: the entry's first shot already moves through the transition into it. */
  private from(sh: Shot) { return sh.t0 <= this.ctx.start + 0.01 ? this.ctx.start - 0.5 : sh.t0; }

  /** The beat nearest t. */
  private snap(t: number) { const a = this.ctx.audio; return a.timeOfBeat(Math.round(a.beatAt(t))); }

  // ---- the edit ----
  //
  // fly: a camera moving with a point on an arm (radius r0, + vr per second): camera c and target g as
  // [along the arm, out (the people's up), in front (+y)], eased from c0/g0 to c1/g1; people upright on screen.
  // giants: an orbit round the pair (distance d, el from straight in front, az round their up), eased.
  // wide: the whole galaxy (opening reveal only). gap: drop 1's first "take my hand". sun, converge: drop 3's end.

  private makeShots(): Shot[] {
    const B = (k: number) => this.bar(k), T = this.T, end = this.ctx.end + 2;
    const sh = (t0: number, t1: number, kind: Kind, o: Record<string, any> = {}): Shot => ({ t0, t1, kind, o, seed: Math.round(t0 * 10) });
    if (this.n === 3) {
      const D0 = Math.min(this.snap(T.d), B(4)), G2 = this.snap(T.g2);
      return [
        sh(-Infinity, B(1), 'wide', { d0: 360, d1: 70, el0: 0.15, el1: 0.55, az0: 0.4, az1: 1.1, roll0: 0.6, roll1: -0.1, dive: true, waves: 'core' }),
        // among the dancers at eye level, the core ahead along the arm
        sh(B(1), B(2), 'portrait', { arm: 1, r: 40, w: 1.6, d0: 2.7, d1: 2.2, az0: 0.5, az1: 0.25, h0: 0.55, h1: 0.75, look: 0.7, off: -0.2, waves: 'cam' }),
        // a crane up past a chain, the wave running away along it
        sh(B(2), B(3), 'fly', { arm: 0, r0: 70, vr: 0.5, c0: [-5, -3.5, 4.6], c1: [-5, 3, 3.8], g0: [3, -1.2, 0], g1: [3, 1.0, 0], roll0: -0.15, roll1: 0.12, waves: 'cam' }),
        sh(B(3), D0, 'giants', { d0: 70, d1: 34, el0: 0.75, el1: 0.45, az0: 0.15, az1: 0.05, tu: 0.15, reveal: true }),
        sh(D0, B(5), 'giants', { d0: 27, d1: 22, el0: 0.55, el1: 0.6, az0: -0.45, az1: -0.2, tu: 0.1, roll0: -0.1, roll1: 0.05 }),
        // a slow orbit round the two, dancing with their lights
        sh(B(5), G2, 'giants', { d0: 24, d1: 22, el0: 1.0, el1: 1.05, az0: 0.7, az1: 1.7, tu: 0.15, roll0: 0.05, roll1: -0.05 }),
        // racing beside a chain as the waves run along it
        sh(G2, B(7), 'fly', { arm: 1, r0: 42, vr: 3.2, c0: [-1.5, 0.9, 2.3], c1: [-1, 0.6, 2.1], g0: [12, 0.3, -0.4], roll0: 0.06, roll1: -0.04, waves: 'cam', fov0: 62 }),
        // close on three people hand in hand, raising their hands as a wave goes by
        sh(B(7), B(8), 'fly', { arm: 0, r0: 50, vr: 0.12, c0: [-1.6, 0.4, 2.4], c1: [-1.0, 0.7, 2.1], g0: [0.9, 0.35, 0], g1: [1.1, 0.4, 0], roll0: 0.08, roll1: -0.03, waves: 'downs', fov0: 46 }),
        sh(B(8), B(9), 'portrait', { arm: 1, r: 86, w: -1.6, d0: 2.2, d1: 2.8, az0: -0.3, az1: -0.55, h0: 0.95, h1: 0.8, look: 0.75, off: 0.2, roll0: -0.04, roll1: 0.04, rings: true, waves: 'downs', dir: -1 }),
        // low along the inner chain toward the core
        sh(B(9), B(10), 'fly', { arm: 0, r0: 34, vr: -2.4, c0: [5, -3.2, 2.4], c1: [5, 1.8, 2.2], g0: [-10, -0.5, 0], g1: [-10, 0.8, 0], roll0: 0.12, roll1: -0.1, rings: true, waves: 'downs' }),
        sh(B(10), B(11), 'fly', { arm: 1, r0: 64, vr: 3.6, c0: [-1.5, -0.8, 2.4], c1: [-1, -0.5, 2.1], g0: [12, -0.2, -0.4], roll0: -0.05, roll1: 0.05, rings: true, waves: 'downs', fov0: 62 }),
        sh(B(11), B(12), 'giants', { d0: 30, d1: 22, el0: 1.0, el1: 1.05, az0: 2.7, az1: 2.4, tu: 0.12, core: 0.25 }),
        sh(B(12), B(13), 'giants', { d0: 26, d1: 20, el0: 1.08, el1: 1.15, az0: -0.35, az1: -0.12, tu: 0.3, aim: 'grip', join: true, core: 0.1 }),
        sh(B(13), B(14), 'sun', {}),
        sh(B(14), end, 'converge', {}),
      ];
    }
    const D0 = this.snap(T.d), G2 = this.snap(T.g2), D1 = this.snap(D0 + (G2 - D0) / 2);
    return [
      // (the drop's first eight bars, when the entry starts with the drop)
      sh(-Infinity, B(1), 'fly', { arm: 0, r0: 52, vr: 1.4, c0: [-6, 0, 42], c1: [-2.5, 0.8, 7], g0: [4, 0, 0], g1: [4, 0.2, 0], roll0: 0.5, roll1: 0.05, dive: true, fov0: 62, fov1: 55, waves: 'cam' }),
      sh(B(1), B(2), 'portrait', { arm: 1, r: 40, w: 1.6, d0: 2.7, d1: 2.2, az0: 0.5, az1: 0.25, h0: 0.55, h1: 0.75, look: 0.7, off: -0.2, waves: 'cam' }),
      sh(B(2), B(3), 'fly', { arm: 0, r0: 76, vr: 0.5, c0: [-5, -3.5, 4.6], c1: [-5, 3, 3.8], g0: [3, -1.2, 0], g1: [3, 1.0, 0], roll0: -0.15, roll1: 0.12, waves: 'cam' }),
      sh(B(3), D0, 'fly', { arm: 1, r0: 44, vr: -7, accel: 2.5, c0: [3, 1.5, 6.5], c1: [3, 1.5, 12], g0: [-8, 0, 0], roll0: 0.05, roll1: -0.35, fov0: 58, fov1: 72, lookCore: 0.8 }),
      sh(D0, D1, 'giants', { d0: 32, d1: 25, el0: 0.55, el1: 0.45, az0: 2.95, az1: 3.1, tu: -0.05 }),
      sh(D1, G2, 'giants', { d0: 17, d1: 22, el0: 0.5, el1: 0.62, az0: 0.35, az1: 0.1, tu: 0.15, roll0: -0.12, roll1: 0.05 }),
      sh(G2, B(6), 'fly', { arm: 1, r0: 42, vr: 3.2, c0: [-1.5, 0.9, 2.3], c1: [-1, 0.6, 2.1], g0: [12, 0.3, -0.4], roll0: 0.06, roll1: -0.04, waves: 'cam', fov0: 62 }),
      sh(B(6), B(7), 'fly', { arm: 0, r0: 30, vr: -2.4, c0: [5, -3.2, 2.4], c1: [5, 1.8, 2.2], g0: [-10, -0.5, 0], g1: [-10, 0.8, 0], roll0: 0.12, roll1: -0.1, waves: 'cam' }),
      sh(B(7), B(8), 'portrait', { arm: 1, r: 70, w: -1.6, d0: 2.2, d1: 2.8, az0: -0.3, az1: -0.55, h0: 0.95, h1: 0.8, look: 0.75, off: 0.2, waves: 'cam', dir: -1 }),
      // ---- bar 9: the galaxy half of the drop ----
      sh(B(8), B(9), 'wide', { d0: 330, d1: 120, el0: 1.05, el1: 0.82, az0: -0.9, az1: -0.55, roll0: -0.2, roll1: 0.1, rings: true }),
      // inside an arm at eye level among the dancers, waves of hands on the downbeats
      sh(B(9), B(10), 'portrait', { arm: 1, r: 62, w: 1.6, d0: 3.6, d1: 3.0, az0: 0.5, az1: 0.25, h0: 0.5, h1: 0.65, look: 0.6, off: -0.2, roll0: 0.06, roll1: -0.03, rings: true, waves: 'downs' }),
      // a crane up past a chain, a wave running away along it
      sh(B(10), B(11), 'fly', { arm: 0, r0: 64, vr: 0.5, c0: [-5, -3.5, 4.6], c1: [-5, 3, 3.8], g0: [3, -1.2, 0], g1: [3, 1.0, 0], roll0: -0.15, roll1: 0.12, rings: true, waves: 'downs' }),
      sh(B(11), B(12), 'gap', {}),
      // racing beside the chain as the light runs out along it
      sh(B(12), B(13), 'fly', { arm: 0, rg: true, vr: 3.0, c0: [-3, 1.0, 4.4], c1: [-3, 0.8, 4.0], g0: [5, 0.3, -0.3], roll0: 0.05, roll1: -0.05, fov0: 58, joined: true }),
      // he and she reach across the core; framed from their feet, the core below the frame
      sh(B(13), B(14), 'giants', { d0: 22, d1: 16, el0: 1.08, el1: 1.16, az0: 0.4, az1: 0.12, tu: 0.1, aim: 'grip', join: true, core: 0.1 }),
      // a slow orbit round the two holding hands, the waves running out through the galaxy
      sh(B(14), B(15), 'giants', { d0: 20, d1: 24, el0: 1.25, el1: 1.3, az0: 0.6, az1: 1.5, tu: 0.1, aim: 'grip', join: true, waves: 'core', core: 0.2 }),
      sh(B(15), end, 'giants', { d0: 24, d1: 3, el0: 0.85, el1: 0.8, az0: 0.15, az1: 0.1, tu: 0.3, aim: 'grip', join: true, rush: true, core: 0.15 }),
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
    const t = f.t;
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
    const st: DrawState = { k: 1 + 0.18 * chop, core: 1 + 0.45 * this.kick, scale: 1, twist: 0, clock: t, post: {} };
    switch (sh.kind) {
      case 'fly': this.fly(t, sh, st); break;
      case 'portrait': this.portrait(t, sh, st); break;
      case 'giants': this.giants(t, sh, st); break;
      case 'wide': this.wide(t, sh, st); break;
      case 'gap': this.gapShot(t, sh, st); break;
      case 'sun': this.sunShot(t, sh, st); break;
      case 'converge': this.converge(t, sh, st); break;
    }
    if (this.n === 3) this.shockwave(t, st);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    for (const o of [this.neb, this.far]) o.position.copy(cam.position);
    const nm = (this.neb.material as THREE.ShaderMaterial).uniforms;
    (nm.gas!.value as THREE.Color).copy(L.gas).multiplyScalar(st.neb ?? 1);
    (nm.fil!.value as THREE.Color).copy(L.fil).multiplyScalar(st.neb ?? 1);

    // the galaxy's own light; the core pulses on the kicks
    this.crowd.sky(cam, st.core, st.disk ?? 1);
    ((this.gal.disk.material as THREE.ShaderMaterial).uniforms.warm!.value as THREE.Vector3).set(...L.diskWarm).multiplyScalar(st.warmK ?? 1);
    (this.gal.stars.material.uniforms.fogDensity!.value as number) = st.starFog ?? 0;
    if (st.scale !== 1 || st.twist) { this.gal.group.scale.setScalar(st.scale); this.gal.group.rotation.y = -st.twist; }
    const ck = (st.coreK ?? 1) * st.scale;
    if (ck > 0.01) {
      this.bgFlares.glow(V(), L.core, (0.35 + 0.5 * this.kick) * ck, 3.5 * st.scale, 1, 4);
      this.bgFlares.glow(V(), L.accent, 0.05 * (1 + this.kick) * ck, 30 * st.scale, 1, 3);
    }
    // the dust in the air: around the camera, drifting slowly, sparkling (in the shots among the people)
    const mL = st.motes ?? 0;
    this.motes.visible = mL > 0;
    if (mL > 0) this.dust(t, mL);
    // the people
    const D = this.D;
    D.time = t * 3;
    D.begin(cam);
    this.crowd.draw(D, cam, {
      t: st.clock, k: st.k, scale: st.scale, twist: st.twist, near: st.near, range: st.range,
      wave: (arm, lk) => this.waveAt(arm, lk, t),
      light: (arm, lk, p) => this.lightAt(arm, lk, p, t),
      hide: st.hide, gap: st.gap, draw: this.reveal(t), edge: this.n === 3 ? 0.9 : 0.5,
    });
    st.extra?.();
    D.end();
    this.flares.end();
    this.bgFlares.end();
    this.bgFlares.renderOrder = 1;
    this.st.render(this.ctx.renderer, out);
    const k = this.kick, sk = this.shake;
    return {
      bloom: 0.8 + 0.15 * k, bloomThreshold: 0.85, bloomRadius: 0.8, halation: 0.1 + (this.n === 3 ? 0.04 : 0), vignette: 0.45, grain: 0.05,
      ca: 0.6 + 0.8 * k + 2 * sk, zoom: 1 + 0.01 * k + (st.zoom ?? 0), flash: Math.min(0.12, this.flash) + 0.02 * chop,
      shake: [noise1(t * 37, 1) * 9 * sk, noise1(t * 37, 2) * 9 * sk] as [number, number],
      ...st.post,
    };
  }

  // ---- waves of raised hands, light through the people ----

  /** Where wave W is along the arm for a person at link coordinate lk: seconds since it reached their group. */
  private waveTau(W: Wave, lk: number, t: number, grouped: boolean) {
    const lq = grouped ? (Math.floor(lk / GROUP) + 0.5) * GROUP : lk;
    const d = W.dir === 0 ? Math.abs(lq - W.L0) : (lq - W.L0) * W.dir;
    if (d < -GROUP) return -1e9;
    // (within a group a small ripple, so even a group doesn't move as one)
    const ripple = grouped ? hash(Math.floor(lk * 7.3), 3) * 0.08 : 0;
    return t - (W.t0 + Math.max(0, d) / W.v) - ripple;
  }

  /** Raised hands 0..1 for a person of `arm` at link coordinate lk. */
  private waveAt(arm: number, lk: number, t: number) {
    let w = 0;
    for (const W of this.waves) {
      if (W.arm >= 0 && W.arm !== arm) continue;
      const tau = this.waveTau(W, lk, t, true);
      if (tau <= 0 || tau > 1.5) continue;
      w = Math.max(w, W.amp * smoothstep(0, 0.34, tau) * (1 - smoothstep(0.62, 1.45, tau)));
    }
    return w;
  }

  /** Brightness: the light pulse that carries a wave, rings of light out from the core on the kicks. */
  private lightAt(arm: number, lk: number, p: THREE.Vector3, t: number) {
    let k = 1;
    for (const W of this.waves) {
      if (W.arm >= 0 && W.arm !== arm) continue;
      const tau = this.waveTau(W, lk, t, false);
      if (tau > -0.2 && tau < 0.7) k += 0.6 * W.amp * Math.exp(-(tau * tau) / 0.02);
      // (a wave that lights the arm for good: everyone it passed keeps glowing)
      if (W.glow && tau > 0) k += W.glow * smoothstep(0, 0.25, tau) * (0.5 + 0.5 * Math.exp(-tau / 1.5));
    }
    if (this.rings > 0) {
      const r = Math.hypot(p.x, p.z);
      for (const b of this.beats) {
        const age = t - b;
        if (age < 0) break;
        if (age > 2.2) continue;
        const R = 75 * age, x = (r - R) / 7;
        k += this.rings * 0.55 * Math.exp(-x * x) * (1 - age / 2.2);
      }
    }
    return k;
  }

  /** Waves for a shot: on the chop launches (or the downbeats), from `L0(tc)` along `dir`. */
  private addWaves(t: number, sh: Shot, mode: string | undefined, L0: (tc: number) => number, dir: number, arm = -1, v = 24) {
    if (!mode) return;
    const times = mode === 'downs' ? this.downs.filter((d) => d >= sh.t0 - 1.5 && d <= t) : this.launches(Math.max(sh.t0 - 1.5, this.sec0), t);
    for (const tc of times) this.waves.push({ t0: tc, arm, L0: L0(tc), dir, v, amp: 1 });
  }

  // ---- the moments ----

  /** A ring of light expanding from c (in the camera's plane) at t0: radius R, `n` stars. */
  private ring(c: THREE.Vector3, t0: number, t: number, R: number, color: THREE.Color, k = 1, n = 150, life = 1.0) {
    const age = t - t0;
    if (age < 0 || age > life) return;
    const q = this.st.cam.quaternion, rx = V(1, 0, 0).applyQuaternion(q), ry = V(0, 1, 0).applyQuaternion(q);
    const e = ease.outExpo(clamp(age / (life * 0.8))), fade = Math.pow(1 - age / life, 1.6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + hash(i, 7) * 0.04, rr = R * e * (0.95 + 0.1 * hash(i, 3));
      const p = c.clone().addScaledVector(rx, Math.cos(a) * rr).addScaledVector(ry, Math.sin(a) * rr);
      this.D.star(p, color, k * fade * (0.5 + 0.9 * hash(i, 5)), R * (0.006 + 0.008 * hash(i, 9)));
    }
  }

  /** A light running down an arm (shoulder → elbow → hand) over [t0, t1]; lights the hand when it gets there. */
  private armLight(j: THREE.Vector3[], arm: 0 | 1, t0: number, t1: number, t: number, color: THREE.Color, size: number) {
    const u = prog(t, t0, t1, ease.inOutQuad);
    if (t < t0 || u >= 1) return;
    const S = j[2 + arm]!, E = j[4 + arm]!, H = j[6 + arm]!;
    const at = (x: number) => (x < 0.5 ? S.clone().lerp(E, x * 2) : E.clone().lerp(H, x * 2 - 1));
    for (let i = 0; i < 6; i++) {
      const x = u - i * 0.05;
      if (x < 0) break;
      this.D.star(at(x), color, (1.6 - i * 0.24) * smoothstep(0, 0.1, u), size * (1 - i * 0.1));
    }
    this.flares.glow(at(u), color, 0.35, size * 2.5, 1, 4);
  }

  /** The beat of a hand-join: a sharp flash, a ring from the hands, a tiny camera kick. */
  private join(M: THREE.Vector3, tH: number, t: number, st: DrawState, scale: number, k = 1) {
    const L = this.look, fl = pulse(t, tH, 0.12), glow = smoothstep(tH - 0.05, tH + 0.02, t);
    if (glow <= 0) return;
    // (sharp, not blinding: a hot point and a short streak, the ring does the rest)
    this.flares.glow(M, L.flash, (0.3 + 0.7 * fl) * glow * k, scale * (0.03 + 0.04 * fl));
    this.flares.glow(M, L.accent, 0.15 * fl * k, scale * 0.35, 4, 6);
    this.D.star(M, L.flash, (0.8 + 1.2 * fl) * glow, scale * 0.04);
    this.ring(M, tH, t, scale * 3.5, L.flash, 1.1 * k, 150, 0.9);
    this.ring(M, tH + 0.07, t, scale * 2.2, L.accent, 0.6 * k, 110, 0.7);
    this.flash = Math.max(this.flash, 0.012 * fl * k);
    st.zoom = (st.zoom ?? 0) + 0.03 * pulse(t, tH, 0.1);
    if (t >= tH && t - tH < 0.12) this.shake = Math.max(this.shake, 0.6 * (1 - (t - tH) / 0.12));
  }

  /** Motes in a box of side mL around the camera, each drifting on its own; faded near the box's edges. */
  private dust(t: number, mL: number) {
    const cp = this.st.cam.position, M = this.motes, c = new THREE.Color(), L = this.look;
    for (let i = 0; i < M.n; i++) {
      const h = (k: number) => hash(i, 41, k);
      const rel = [0, 1, 2].map((a) => {
        const b = h(a) * mL + (h(a + 3) - 0.5) * 0.35 * t + noise1(t * 0.2 + i, a) * 0.6;
        const q = cp.getComponent(a);
        return ((((b - q) % mL) + mL) % mL) - mL / 2;
      });
      const r = Math.hypot(rel[0]!, rel[1]!, rel[2]!);
      const fade = 1 - smoothstep(mL * 0.3, mL * 0.5, r);
      const tw = 0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(t * (2 + 3 * h(7)) + i), 3);
      c.copy(h(8) < 0.6 ? L.crowd.a : L.crowd.chain);
      M.set(i, cp.x + rel[0]!, cp.y + rel[1]!, cp.z + rel[2]!, c, 0.35 * fade * tw, mL * (0.0016 + 0.0024 * h(9)));
    }
    M.commit();
  }

  // ---- shots ----

  /** The chain line of arm a at radius r: point, outward normal (the people's up), tangent (outward along the arm). */
  private af(a: number, r: number) { return this.gal.armPoint(a, Math.max(6.5, r), 0); }

  private fly(t: number, sh: Shot, st: DrawState) {
    const o = sh.o, cam = this.st.cam;
    const t0s = this.from(sh), tau = t - t0s, dur = sh.t1 - t0s;
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
    pos.add(V(noise1(t * 0.9, 3), noise1(t * 0.8, 4), noise1(t * 0.7, 5)).multiplyScalar(0.08));
    aim(cam, pos, tgt, lerp(o.roll0 ?? 0, o.roll1 ?? 0, e) + 0.02 * Math.sin(t * 1.3), A.n);
    cam.fov = lerp(o.fov0 ?? 56, o.fov1 ?? o.fov0 ?? 56, e);
    st.near = pos;
    st.range = o.dive ? 140 : 90;
    st.motes = o.dive ? 0 : 14;
    // (inside the disk: true blacks behind the people)
    st.disk = 0.6;
    st.neb = 0.75;
    st.core = 0.8 + 0.4 * this.kick;
    if (o.rings) this.rings = 1;
    // the waves start just behind the camera and run away along the arm
    const dir = g[0] >= c[0] ? 1 : -1;
    this.addWaves(t, sh, o.waves, (tc) => {
      const rc = r0 + o.vr * (tc - t0s);
      return this.crowd.lkAt(o.arm, rc) + dir * (c[0] - 4);
    }, dir, o.arm);
    if (o.joined) this.joined(t, st, true);
  }

  /**
   * Among the dancers: close on one of them (o.pi), at their own eye level — distance d, round them by az from
   * their face, at height h along their body, looking at height `look`; the others float around and behind.
   */
  private portrait(t: number, sh: Shot, st: DrawState) {
    const o = sh.o, cam = this.st.cam, P = this.crowd.people[o.pi as number]!;
    const t0 = this.from(sh), u = clamp((t - t0) / (sh.t1 - t0)), e = sine(u);
    // (which way they face as the shot begins: the camera keeps to that, whatever they do next)
    o.face ??= (() => {
      const j = this.crowd.peek(o.pi, t0 + 0.3, []);
      const f = V().crossVectors(V().subVectors(j[2]!, j[3]!), P.up).normalize();
      return f.lengthSq() > 0.5 && f.y > -0.2 ? f : Y.clone();
    })();
    const up = P.up, face = (o.face as THREE.Vector3).clone().addScaledVector(Y, 0.6).addScaledVector(up, -(o.face as THREE.Vector3).dot(up)).normalize(), side = V().crossVectors(up, face);
    const d = lerp(o.d0, o.d1, e), az = lerp(o.az0, o.az1, e), h = lerp(o.h0, o.h1, e);
    const pos = P.p.clone().addScaledVector(up, h).addScaledVector(face, Math.cos(az) * d).addScaledVector(side, Math.sin(az) * d);
    const tgt = P.p.clone().addScaledVector(up, o.look ?? 0.7).addScaledVector(side, (o.off ?? 0) * d);
    pos.add(V(noise1(t * 0.7, 11), noise1(t * 0.6, 12), noise1(t * 0.65, 13)).multiplyScalar(0.05));
    aim(cam, pos, tgt, lerp(o.roll0 ?? 0, o.roll1 ?? 0, e), up);
    cam.fov = o.fov ?? 46;
    st.near = pos;
    st.range = 80;
    st.motes = 10;
    st.disk = 0.5;
    st.neb = 0.7;
    st.core = 0.6 + 0.3 * this.kick;
    if (o.rings) this.rings = 1;
    // (nobody floats between us and them)
    const a = pos.clone(), b = P.p.clone().addScaledVector(up, 0.8), ab = V().subVectors(b, a), L2 = ab.lengthSq(), ppl = this.crowd.people;
    st.hide = (i) => {
      if (i === o.pi) return false;
      const q = ppl[i]!.p, x = clamp(V().subVectors(q, a).dot(ab) / L2);
      return q.distanceToSquared(a.clone().addScaledVector(ab, x)) < 0.9 * 0.9;
    };
    const lk = P.lk, dir = o.dir ?? 1;
    this.addWaves(t, sh, o.waves, () => lk - dir * 12, dir, P.arm);
  }

  /** The giants: orbit (distance d, elevation el from straight in front, azimuth az). */
  private giants(t: number, sh: Shot, st: DrawState) {
    const o = sh.o, cam = this.st.cam, L = this.look;
    const t0 = this.from(sh), t1 = Math.min(sh.t1, this.ctx.end), u = clamp((t - t0) / (t1 - t0));
    const e = o.rush ? ease.inOutCubic(u) : sine(u), land = ease.outExpo(clamp((t - t0) / 0.6));
    const d = lerp(o.d0, o.d1, e) * (1 + 0.2 * (1 - land) * (o.rush ? 0 : 1));
    const el = lerp(o.el0, o.el1, e), az = lerp(o.az0, o.az1, e);
    const J = this.poseGiants(t, sh, st);
    const target = o.aim === 'grip' ? GC.clone().lerp(J.grip, sine(prog(t, t0, t0 + 0.8))) : GC.clone().addScaledVector(U, (o.tu ?? 0) * GS);
    const dirv = F.clone().multiplyScalar(Math.cos(el)).add(U.clone().multiplyScalar(-Math.cos(az) * Math.sin(el))).add(X.clone().multiplyScalar(Math.sin(az) * Math.sin(el)));
    const pos = target.clone().addScaledVector(dirv, d);
    pos.add(V(noise1(t * 0.6, 7), noise1(t * 0.5, 8), noise1(t * 0.55, 9)).multiplyScalar(0.25));
    aim(cam, pos, target, lerp(o.roll0 ?? 0, o.roll1 ?? 0, e) + 0.03 * Math.sin(t * 0.9), U);
    cam.fov = o.rush ? lerp(52, 75, ease.inQuart(u)) : 50;
    // (the core shines behind them, but never so bright that it washes them out; dark behind a join)
    const ck = o.core ?? (o.reveal ? 0.75 : 0.3);
    st.core = ck * (1 + 0.45 * this.kick);
    st.coreK = ck;
    st.motes = o.rush ? 0 : 40;
    st.disk = this.n === 1 ? 0.4 : 0.15;
    st.neb = 0.7;
    st.starFog = o.reveal ? 0.012 : this.n === 1 ? 0.016 : 0.028;
    // (drop 1's last bars: the people and the arms lifted, so every frame shows them clearly up to the cut)
    if (this.n === 1) { st.k = (st.k ?? 1) * 1.3; st.heroGain = 1.3; }
    if (o.rush) {
      // into the light of their joined hands
      const k = ease.inCubic(u);
      this.flares.glow(J.grip, L.flash, 0.6 + 2.2 * k, GS * (0.06 + 0.9 * k));
      this.flares.glow(J.grip, L.accent, 0.5 * k, GS * (0.5 + 3 * k), 1, 2.5);
      st.post.exposure = 1 + 0.4 * k;
      this.flash = Math.max(this.flash, 0.12 * smoothstep(0.85, 1, u));
    }
    if (o.waves === 'core') {
      for (const b of this.downs) if (b >= sh.t0 - 1.5 && b <= t) this.waves.push({ t0: b, arm: -1, L0: 0, dir: 1, v: 40, amp: 1 });
    } else this.addWaves(t, sh, 'chops', () => 0, 1, -1, 40);
  }

  /** The whole galaxy (the opening reveal): an orbit about the core (d, el from straight above, az). */
  private wide(t: number, sh: Shot, st: DrawState) {
    const o = sh.o, cam = this.st.cam;
    const t0 = this.from(sh), u = clamp((t - t0) / (sh.t1 - t0));
    const e = ease.outCubic(u);
    const d = lerp(o.d0, o.d1, e), el = lerp(o.el0, o.el1, e), az = lerp(o.az0, o.az1, sine(u));
    const pos = V(Math.sin(el) * Math.cos(az) * d, Math.cos(el) * d, Math.sin(el) * Math.sin(az) * d);
    const tgt = V(0, 0, 0);
    // screen-up: toward the far side of the disk, rolled
    const up = V(-Math.cos(az), 0, -Math.sin(az));
    // opening the entry out of the city's rising lights (a zoom centred high in the frame): the core starts
    // up there, where the lights went, and settles to the middle
    if (this.reveal(t) < 1 && sh.t0 <= this.ctx.start + 0.01) {
      const lift = 0.06 * (1 - ease.inOutCubic(prog(t, this.ctx.start - 0.35, this.ctx.start + 1.1)));
      const f = tgt.clone().sub(pos).normalize(), uu = up.clone().addScaledVector(f, -up.dot(f)).normalize();
      tgt.addScaledVector(uu, -lift * d);
    }
    aim(cam, pos, tgt, lerp(o.roll0 ?? 0, o.roll1 ?? 0, sine(u)), up);
    cam.fov = 55;
    // (the core glows, but never as a white blob: the arms made of people must read)
    st.core = 0.4 * (1 + 0.4 * this.kick);
    st.coreK = 0.35;
    st.warmK = 0.45;
    st.k = (st.k ?? 1) * 1.2;
    if (o.rings) this.rings = 1;
    this.addWaves(t, sh, o.waves === 'core' ? 'chops' : undefined, () => 0, 1, -1, 40);
    if (o.rings) for (const b of this.downs) if (b >= sh.t0 - 1 && b <= t) this.waves.push({ t0: b, arm: -1, L0: 0, dir: 1, v: 60, amp: 1 });
  }

  // ---- the giants ----

  /**
   * Pose the giant pair (and draw them in st.extra): dancing (motion capture); in a `join` shot their inner
   * hands reach for each other on "take" (a light runs down their arms) and hold on "hand". Returns the grip.
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
    const hold = join ? smoothstep(T.hand2 - 0.06, T.hand2 + 0.02, t) : 0;
    // after the join the light runs out from their hands through the whole galaxy
    if (hold > 0) this.waves.push({ t0: T.hand2, arm: -1, L0: 0, dir: 1, v: 45, amp: 1, glow: this.n === 1 ? 0.35 : 0.2 });
    const prev = st.extra;
    st.extra = () => {
      prev?.();
      const D = this.D;
      const [ca, cb] = L.hero;
      const hk = (1 + 0.25 * this.kick) * (st.heroK ?? 1) * (st.heroGain ?? 1);
      // (a figure's stardust holds the same light at any size: spread over a giant it needs more of it)
      for (const f of [this.he, this.she]) f.mat.uniforms.alpha!.value = 0.5 * Math.min(1, st.heroK ?? 1);
      D.figure(jA, 0, ca, GK * hk, { color2: L.heroDeep, seed: 1.3, size: 1.1, shatter: st.heroShatter ?? 0, edge: 0.6 });
      D.figure(jB, 1, cb, GK * hk, { color2: L.heroDeep, seed: 4.1, size: 1.1, shatter: st.heroShatter ?? 0, edge: 0.6 });
      this.giantDust(t, jA, jB, st.heroK ?? 1);
      if (join && (st.heroK ?? 1) > 0.5) {
        // "take": a light runs down their reaching arms; "hand": the flash, the ring, the kick
        this.armLight(jA, 0, T.take2, T.hand2, t, L.flash, GS * 0.03);
        this.armLight(jB, 1, T.take2, T.hand2, t, L.flash, GS * 0.03);
        if (hold > 0) this.join(gripNow, T.hand2, t, st, GS, this.n === 3 ? 0.7 : 1);
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

  /**
   * Drop 3: her paper lantern in his inner hand, his star sticker in hers. After their hands meet the two lights
   * glide together and become one star on the next downbeat (the shockwave is `shockwave`).
   */
  private carried(t: number, jA: THREE.Vector3[], jB: THREE.Vector3[], grip: THREE.Vector3, st: DrawState) {
    const T = this.T, cam = this.st.cam;
    const m = ease.inOutCubic(prog(t, T.hand2, T.merge - 0.04));
    const pL0 = jA[6]!.clone().lerp(jA[4]!, -0.1).addScaledVector(U, -0.17 * GS);
    const pS0 = jB[7]!.clone().lerp(jB[5]!, -0.25);
    const mid = grip.clone().addScaledVector(F, 0.15 * GS);
    const pL = pL0.lerp(mid, m), pS = pS0.lerp(mid, m);
    const one = t >= T.merge;
    const k = (st.lightK ?? 1) * (one ? 0 : 1);
    if (k > 0.01) {
      this.sticker.visible = true;
      this.sticker.position.copy(pS);
      this.sticker.quaternion.copy(cam.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), 0.3 * Math.sin(t * 0.8) + 2 * m));
      this.sticker.level = (1.4 + 1.2 * m) * k;
      this.lantern.visible = true;
      this.lantern.position.copy(pL);
      this.lantern.quaternion.setFromUnitVectors(V(0, 1, 0), U);
      this.lantern.lit = (1 + 0.6 * m) * k;
      this.lantern.time = t;
      this.lantern.update();
      // the light between them gathers as they come together
      if (m > 0) this.flares.glow(mid, this.look.accent, 0.4 * m * m, GS * (0.3 + 0.3 * m), 1, 3.5);
    }
  }

  /** Drop 3's climax on the downbeat: the two lights become one star — a flash, a shockwave, rays. */
  private shockwave(t: number, st: DrawState) {
    const T = this.T, L = this.look, tm = T.merge;
    if (t < tm - 0.05 || t > tm + 1.6) return;
    const S = GRIP.clone().addScaledVector(F, 0.15 * GS);
    const fl = pulse(t, tm, 0.14);
    const prev = st.extra;
    st.extra = () => {
      prev?.();
      this.ring(S, tm, t, GS * 4.5, col('#fff6dc', 2.4), 2.0, 240, 1.4);
      this.ring(S, tm + 0.06, t, GS * 3, L.accent, 1.3, 180, 1.2);
      this.ring(S, tm + 0.14, t, GS * 1.8, L.accent, 1.0, 140, 1.0);
      this.star(S, 1 + 2.5 * fl, GS * 0.05, 1.5 + 3 * fl);
    };
    this.flash = Math.max(this.flash, 0.06 * fl);
    st.zoom = (st.zoom ?? 0) + 0.05 * pulse(t, tm, 0.12);
    if (t >= tm && t - tm < 0.18) this.shake = Math.max(this.shake, 1 - (t - tm) / 0.18);
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

  /**
   * Drop 1's "take my hand" (1): close on the two at the ends of the gap, from along the chain on the inner side,
   * so behind their hands is the dark outer arm.
   */
  private gapShot(t: number, sh: Shot, st: DrawState) {
    const cam = this.st.cam, T = this.T;
    const t0 = this.from(sh), u = clamp((t - t0) / (sh.t1 - t0)), e = sine(u);
    const g = this.gap, r = Math.hypot(g.pos.x, g.pos.z);
    const A = this.af(g.arm, r);
    const c: V3 = [lerp(-3.0, -2.2, e), lerp(0.15, 0.5, e), lerp(1.9, 1.6, e)];
    const pos = g.pos.clone().addScaledVector(A.t, c[0]).addScaledVector(A.n, c[1]).addScaledVector(Y, c[2]);
    const tgt = g.pos.clone().addScaledVector(A.n, 0.3).addScaledVector(A.t, lerp(0.6, 0.2, e)).addScaledVector(Y, 0.15);
    aim(cam, pos, tgt, lerp(0.1, -0.04, e) + 0.02 * Math.sin(t * 1.1), A.n);
    cam.fov = lerp(48, 42, ease.inOutCubic(prog(t, T.take1 - 0.3, T.hand1 + 0.4)));
    st.near = g.pos;
    st.range = 70;
    st.motes = 9;
    st.disk = 0.4;
    st.neb = 0.6;
    st.core = 0.4;
    this.joined(t, st, false);
  }

  /**
   * The gap and its two people: the chain halves are held apart until "hand"; on "take" the end people reach
   * for each other and a light runs down their arms; on "hand" they hold (flash, ring, kick) and the light runs
   * out along the whole chain both ways.
   */
  private joined(t: number, st: DrawState, after: boolean) {
    const T = this.T, L = this.look, g = this.gap, P = this.crowd.people;
    const close = after ? 1 : ease.inOutCubic(prog(t, T.hand1 - 0.45, T.hand1));
    const reach = after ? 1 : ease.inOutCubic(prog(t, T.take1 - 0.05, T.hand1 - 0.08));
    const hold = after ? 1 : smoothstep(T.hand1 - 0.06, T.hand1 + 0.02, t);
    st.gap = { arm: g.arm, k: g.k, open: 0.55 * (1 - close), reach, hold } satisfies ChainGap;
    // (nobody floats in front of the two: the space between their hands stays clear)
    if (!after) st.hide = (i) => !P[i]!.chain && P[i]!.p.distanceToSquared(g.pos) < 3.5 * 3.5;
    if (hold > 0) this.waves.push({ t0: T.hand1, arm: g.arm, L0: g.k + 0.5, dir: 0, v: 30, amp: 1, glow: 0.45 });
    const prev = st.extra;
    st.extra = () => {
      prev?.();
      const ja = this.crowd.joints(g.a, this.jA), jb = this.crowd.joints(g.b, this.jC);
      if (!ja || !jb) return;
      // the hand each holds out to the other
      const pa = jb[8]!, pb = ja[8]!;
      const ha = ja[6]!.distanceTo(pa) < ja[7]!.distanceTo(pa) ? 0 : 1, hb = jb[6]!.distanceTo(pb) < jb[7]!.distanceTo(pb) ? 0 : 1;
      this.armLight(ja, ha as 0 | 1, T.take1, T.hand1, t, L.flash, 0.035);
      this.armLight(jb, hb as 0 | 1, T.take1, T.hand1, t, L.flash, 0.035);
      const M = ja[6 + ha]!.clone().lerp(jb[6 + hb]!, 0.5);
      if (!after) this.join(M, T.hand1, t, st, 1);
      else this.D.star(M, L.flash, 1.2, 0.06);
    };
  }

  /**
   * Drop 3: the star swells into the sun, rising over the galaxy seen from inside its disk; wave after wave of
   * raised hands out from the centre on every beat.
   */
  private sunShot(t: number, sh: Shot, st: DrawState) {
    const cam = this.st.cam;
    const t0 = this.from(sh), u = clamp((t - t0) / (sh.t1 - t0));
    const J = this.poseGiants(t, { ...sh, o: { join: true } }, st, true);
    const grow = ease.inOutCubic(prog(t, t0 + 0.05, sh.t1 - 0.2));
    // the two dissolve into stars that fly off into the light
    st.heroK = 1 - 0.7 * grow;
    st.heroShatter = ease.inQuad(prog(t, t0, sh.t1 + 0.2)) * 0.9;
    st.lightK = 0;
    const S = J.grip.clone().addScaledVector(F, 0.15 * GS);
    // low over the disk, out along an arm, looking back at the sun rising over the core
    const az = 0.9 + 0.25 * u, d = lerp(46, 64, ease.outCubic(u));
    const pos = V(Math.cos(az) * d, lerp(5, 7.5, u), Math.sin(az) * d);
    aim(cam, pos, S.clone().lerp(V(0, 0, 0), 0.25), 0.04 * Math.sin(t * 0.7) - 0.05 * u, Y);
    cam.fov = 58;
    this.sun(S, grow, t);
    st.core = 0.45 + 0.2 * this.kick;
    st.coreK = 0.4;
    st.disk = 0.3;
    st.neb = 0.6;
    st.near = pos;
    st.range = 120;
    for (const b of this.beats) if (b >= sh.t0 - 1.5 && b <= t) this.waves.push({ t0: b, arm: -1, L0: 0, dir: 1, v: 45, amp: 1, glow: 0.2 });
    st.k = (st.k ?? 1) * (1 + 0.25 * grow);
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
      this.flares.glow(p, col('gold', 1).lerp(col('white', 1), 0.3), 0.5 * g, R * 2.0, 1, 3);
      this.flares.glow(p, col('ember', 1).lerp(col('gold', 1), 0.6), 0.18 * g, R * 5, 1, 2.2);
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
    const S = GRIP.clone().addScaledVector(F, 0.15 * GS).applyAxisAngle(Y, -st.twist).multiplyScalar(st.scale);
    this.sun(S, g, t, 1);
    // the camera stays on the axis, high above, drifting to a stop
    const d = 120 - 12 * ease.outCubic(prog(t, t0, tEnd));
    aim(cam, V(0, d, 0).addScaledVector(U, -10 * (1 - x) * (1 - x)), V(0, 0, 0), 0.2 + 0.15 * (1 - (1 - x) * (1 - x)), U);
    cam.fov = 55;
    st.core = (1 - c) * 1.1;
    st.coreK = 1 - c;
    st.disk = 1 - 0.6 * c;
    st.k = (st.k ?? 1) * (1 - 0.4 * c);
    for (const b of this.beats) if (b >= t0 - 0.9 && b <= Math.min(t, t0 + 1.2)) this.waves.push({ t0: b, arm: -1, L0: 0, dir: 1, v: 45 * (1 - 0.5 * x), amp: 1 - x });
    st.post.exposure = 1 - 0.1 * c;
    st.neb = 1 - 0.9 * c;
  }
}

interface DrawState {
  k?: number; core: number; coreK?: number; disk?: number; neb?: number; scale: number; twist: number; clock: number;
  near?: THREE.Vector3; range?: number; heroK?: number; heroShatter?: number; lightK?: number; zoom?: number; starFog?: number; heroGain?: number; warmK?: number; motes?: number;
  hide?: (i: number) => boolean; gap?: ChainGap;
  extra?: () => void; post: Record<string, any>;
}
