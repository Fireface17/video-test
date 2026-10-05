// Chorus 2 — «заразить» (spread): the two of them run through the night city, and everyone they touch or pass
// lights up — grey ghost → glowing — turns, and runs after them; behind them a stream of glowing people that
// grows all chorus long; glowing handprints stay wherever glowing hands touched. No words on screen.
//
// Shots (cuts on beats; the city is lib/city.ts with its defaults: the el on avenue 1, the river at x = 1160):
//  A  "We don't gotta be okay to dance"  down the el station's stairs with the train's crowd, out along the avenue
//     under the el; ghosts under the el light up as they pass (he slaps a column: a handprint).
//  B  round the corner into the side street: pigeons burst up, her fingers trail along a lobby's glass.
//  C  "We'll be glowing in the dark"      he vaults the hood of a parked cab (a handprint on the hood)…
//  D  "take my hand"                      …turns, reaches back across it; she takes his hand and he pulls her up
//     and over. From here on they run hand in hand.
//  E  "Every broken piece becomes a star"  his star touches a smashed shop window: the shards rise and turn into stars.
//  F  "Look how beautiful we are"        a crane up: the stream of lights winding back through the streets.
//  G  "So sing it like we're never coming down"  across the avenue in front of stopped cabs; from above, the stream
//     floods the intersection.
//  I  "Loud enough to wake the whole town"  down the long street to the river: every window switches on in a wave.
//  J  "We don't gotta be okay to dance"  up the steel stairs onto the highway overpass by the river.
//  K  "We'll be glo-glo-glo…"            three freeze-frames, one on each stutter (time stops, a flash, a new angle).
//  L  "…glowing in the dark"             release: the stream pours along the overpass, hands up, the camera lifts.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, hash, keys, lerp, mulberry32, noise1, smoothstep, type Key } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { City } from '../lib/city';
import type { RealFigure } from '../lib/people';
import { PaperLantern, StarSticker, heColor, holdIn, makeHeroes, sheColor } from '../lib/heroes';
import { loadMotion, type Motion, applyLayers } from '../lib/motion';
import { GlowLines } from '../lib/stars';
import { CycleMotion, Route, holdHands, inOut, loadCycle, loadSpan } from './run-motion';
import { Folk, type Joiner, poseStride, reachTo, type Stride } from './run-people';
import { Handprints } from './run-prints';
import { BrokenWindow, Pigeons, Splashes, cityKitMat, mirrorOnly, placeKit, shiftRender, stairKit, windowBand } from './run-props';
import { StreetCars, TAXI_PAINT, hideCityInstances } from './run-cars';
import { kitBatch } from '../lib/city-build';
import { heroCarGeometry } from './run-carbody';

/** The two cabs stopped at the red light on avenue 2 (leg G), noses north. */
const CABS_G = [{ x: 619.6, z: 112.5, yaw: 0 }, { x: 624.4, z: 111.4, yaw: 0 }];
/** A point on a detailed cab (city-cars, sedan body) at (cx, cz) turned by yaw: lz along it (+ toward the nose), lx across; on the hood or the roof. */
function onCab(cx: number, cz: number, yaw: number, lz: number, lx: number) {
  const H = 2.375, cowl = 0.95, u = Math.min(1, Math.max(0, (lz - H) / (cowl - H))), sm = u * u * (3 - 2 * u);
  const y = lz > cowl ? 0.74 + 0.19 * Math.pow(sm, 0.55) + 0.012 : 1.475;
  return new THREE.Vector3(cx + lz * Math.sin(yaw) + lx * Math.cos(yaw), y, cz + lz * Math.cos(yaw) - lx * Math.sin(yaw));
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
/** Running pace of the two (m/s). */
const PACE = 4.3;

interface Leg {
  id: string;
  t0: number;
  t1: number;
  route: Route;
  /** The heroes' arc length on the route at t0 (they run on at PACE). */
  s0: number;
  /** Holding hands. */
  hold: number;
}

interface HeroTrack { s: Key[]; side?: Key[]; turn?: Key[]; lift?: Key[]; jumpK?: Key[]; jumpT?: [number, number] }

export default class Run extends Scene {
  st = new Stage(50, 0.08, 9000);
  /** Everything in the world (the city and all), shifted to a floating origin for the draw (run-props shiftRender). */
  world = new THREE.Group();
  city!: City;
  he!: RealFigure;
  she!: RealFigure;
  run!: CycleMotion;
  runB!: CycleMotion;
  jump!: CycleMotion;
  idle!: Motion;
  star = new StarSticker(0.06);
  lantern = new PaperLantern();
  trails = new GlowLines(48, 0.025);
  folk = new Folk([10, 60, 320]);
  prints = new Handprints(700);
  splashes = new Splashes(9);
  pigeons!: Pigeons;
  window!: BrokenWindow;
  legs: Leg[] = [];
  T: Record<string, number> = {};
  R1!: Route;
  R2!: Route;
  R3!: Route;
  taxi = V(413.6, 0, 124.0);
  hood = V(412.0, 0.89, 123.6);
  tracks: { he: HeroTrack; she: HeroTrack } | null = null;
  freezes: [number, number][] = [];
  street!: StreetCars;
  heC = heColor();
  sheC = sheColor();

  override async init() {
    const { lyrics, audio } = this.ctx;
    const S = this.st;
    S.bg.copy(col('night', 0.3));
    // ---- time: the cuts on the beat grid, the words that matter ----
    const beat = (t: number) => audio.timeOfBeat(Math.round(audio.beatAt(t)));
    const T = this.T;
    T.c0 = this.ctx.start;
    const l2 = lyrics.linesIn(this.ctx.start - 0.5, this.ctx.end);
    const line = (re: RegExp, k = 0) => l2.filter((l) => re.test(l.text))[k]!;
    T.take = line(/take my hand/i).words.find((x) => /take/i.test(x.w))!.start;
    T.hand = line(/take my hand/i).words.find((x) => /hand/i.test(x.w))!.start;
    T.every = line(/broken piece/i).words[0]!.start;
    T.piece = line(/broken piece/i).words[2]!.start;
    T.star = line(/broken piece/i).words[5]!.start;
    T.look = line(/beautiful/i).words[0]!.start;
    T.wake = line(/wake the whole/i).words[3]!.start;
    T.town = line(/wake the whole/i).words[5]!.start;
    const gloLine = line(/glo-glo/i);
    T.glo = gloLine.words[2]!.start;
    // the stutter: the sung onsets of "glo-glo-glo" (then "-glowing" releases)
    const ons = audio.events('vocal', T.glo - 0.15, T.glo + 1.6).map(([t]) => t);
    const g = [ons[0] ?? T.glo, ons[1] ?? T.glo + 0.42, ons[2] ?? T.glo + 0.83, ons[3] ?? T.glo + 1.22];
    this.freezes = [[g[0]!, g[1]! - 0.12], [g[1]!, g[2]! - 0.12], [g[2]!, g[3]!]];
    T.release = g[3]!;
    T.A = T.c0; T.B = beat(123.1); T.C = beat(124.7); T.E = beat(T.every); T.F = beat(T.look); T.G1 = beat(133.9); T.G2 = beat(135.48);
    T.I = beat(line(/wake the whole/i).start); T.J = beat(line(/okay to dance/i, 1).start); T.K = beat(gloLine.start); T.L = beat(T.release);

    // ---- the city ----
    this.city = new City({});
    S.add(this.world);
    this.world.add(this.city);
    this.city.power.level = 1;

    // ---- the routes ----
    // R1: down the el station's stairs, south along avenue 1, round the corner east into street 1, across it over
    // the cab's hood, east along its south pavement
    this.R1 = new Route([
      [388.6, 4.6, 48], [388.6, 4.6, 55.5], [388.6, 0.15, 64.2], [388.3, 0.15, 104], [389.6, 0.15, 110.6], [395, 0.15, 112.7],
      [406, 0.15, 112.7], [409.3, 0, 115.4], [411.3, 0, 121.6], [413.1, 0.15, 126.9], [418.5, 0.15, 127.4], [606, 0.15, 127.4],
    ]);
    // R2: across avenue 2 and east along street 1 toward the river
    this.R2 = new Route([[560, 0.15, 127.4], [609, 0.15, 127.4], [614.5, 0, 127.0], [635.5, 0, 127.0], [641, 0.15, 127.4], [1105, 0.15, 127.4]]);
    // R3: across the riverside avenue, up the steel stairs onto the overpass deck, north along it
    const ov = this.city.overpass, oy = ov?.y ?? 8.5;
    this.R3 = new Route([[1060, 0.15, 127.4], [1108, 0.15, 127.4], [1113, 0, 128.5], [1131.5, 0, 131], [1133.6, 0.15, 132.5], [1133.6, oy, 147.5], [1135.6, oy, 149.5], [1136.5, oy, 155], [1136.5, oy, 420]]);
    const sAt = (R: Route, p: THREE.Vector3) => { let best = 0, bd = Infinity; for (let s = 0; s <= R.length; s += 0.1) { const d = R.at(s).distanceToSquared(p); if (d < bd) { bd = d; best = s; } } return best; };
    const sCar = sAt(this.R1, V(411.3, 0, 121.6));
    const sWin = sAt(this.R1, V(434.7, 0.15, 127.4));
    T.sCar = sCar;
    // ---- the legs ----
    const L = (id: string, t0: number, t1: number, route: Route, s0: number, hold = 0): Leg => ({ id, t0, t1, route, s0, hold });
    const sE0 = sWin - PACE * (T.piece - T.E) - 0.3;
    this.legs = [
      L('A', T.A, T.B, this.R1, 2.5),
      L('B', T.B, T.C, this.R1, sAt(this.R1, V(389.6, 0.15, 110.6)) - 2.0),
      L('C', T.C, T.E, this.R1, sCar - 0.4),
      L('E', T.E, T.F, this.R1, sE0, 1),
      L('F', T.F, T.G1, this.R1, sE0 + PACE * (T.F - T.E), 1),
      L('G1', T.G1, T.G2, this.R2, sAt(this.R2, V(612, 0, 127.2)) - PACE * 0.5, 1),
      L('G2', T.G2, T.I, this.R2, sAt(this.R2, V(626, 0, 127.0)) - PACE * 0.4, 1),
      L('I', T.I, T.J, this.R2, sAt(this.R2, V(676, 0.15, 127.4)), 1),
      L('J', T.J, T.K, this.R3, sAt(this.R3, V(1128, 0, 130.5)), 1),
      L('K', T.K, T.L, this.R3, sAt(this.R3, V(1136.5, oy, 155)) + 4, 1),
      L('L', T.L, this.ctx.end + 1, this.R3, sAt(this.R3, V(1136.5, oy, 155)) + 4 + PACE * (T.L - T.K), 1),
    ];

    // ---- the heroes, their things, their motion ----
    const [{ he, she }, run, runB, jump, idle] = await Promise.all([makeHeroes(), loadCycle('09_01'), loadCycle('16_35'), loadSpan('13_11', 50, 26), loadMotion('77_02')]);
    this.he = he; this.she = she; this.run = run; this.runB = runB; this.jump = jump; this.idle = idle;
    this.world.add(he, she, this.star, this.lantern, this.trails);
    this.lantern.lit = 1;

    // C/D, the cab: he vaults it, turns, reaches back; she takes his hand and he pulls her up and over
    const sV = sCar;
    const tv0 = T.C + 0.36, tv1 = tv0 + 0.5;
    this.T.tv0 = tv0; this.T.tv1 = tv1;
    const grip = (T.take + T.hand) / 2 + 0.05;
    this.T.grip = grip;
    const off = T.hand + 0.38; // she's down beside him, they run on
    this.T.off = off;
    // (along the diagonal over the cab: its north edge at sV + 1.75, its south edge at sV + 3.9, the curb at sV + 4.2)
    this.tracks = {
      he: {
        s: [[T.C, sV - 0.4], [tv0, sV + 1.2, ease.linear], [tv1, sV + 4.6, ease.linear], [tv1 + 0.4, sV + 5.9, ease.outCubic], [off, sV + 6.0], [off + 0.6, sV + 6.0 + PACE * 0.32, ease.inQuad], [T.E, sV + 6.0 + PACE * 0.32 + PACE * (T.E - off - 0.6), ease.linear]],
        turn: [[tv1 + 0.05, 0], [tv1 + 0.5, 1], [off - 0.15, 1], [off + 0.3, 0]],
        lift: [[tv0, 0], [(tv0 + tv1) / 2, 0.8, ease.outQuad], [tv1, 0.15, ease.inQuad]],
        jumpK: [[tv0 - 0.16, 0], [tv0 - 0.02, 1], [tv1, 1], [tv1 + 0.16, 0]],
        jumpT: [tv0 - 0.24, tv1 + 0.18],
      },
      she: {
        s: [[T.C, sV - 0.4 - 3.8], [T.take - 0.15, sV + 0.25, ease.linear], [T.take + 0.12, sV + 0.55, ease.outCubic], [grip, sV + 0.6], [grip + 0.3, sV + 2.5, ease.inOutCubic], [T.hand + 0.05, sV + 2.8], [off, sV + 5.1, ease.inOutQuad], [off + 0.6, sV + 5.1 + PACE * 0.32, ease.inQuad], [T.E, sV + 5.1 + PACE * 0.32 + PACE * (T.E - off - 0.6), ease.linear]],
        lift: [[grip + 0.02, 0], [grip + 0.3, 0.95, ease.outQuad], [T.hand + 0.05, 0.95], [off - 0.04, 0.15, ease.inQuad]],
        jumpK: [[grip - 0.06, 0], [grip + 0.08, 1], [off - 0.02, 1], [off + 0.12, 0]],
        jumpT: [grip - 0.12, off + 0.12],
      },
    };

    // ---- props ----
    // the hero cab (the city's detailed car: a lofted body, glass, arches, seams, mirrors, its lit roof sign), its
    // nose toward −x; two cabs stopped at the red light on avenue 2, noses north, headlights on the crossing
    const cabs = [{ x: this.taxi.x, z: this.taxi.z, yaw: -Math.PI / 2 }, ...CABS_G];
    const cabMesh = kitBatch(heroCarGeometry(2), cabs.map((c) => ({ x: c.x, y: 0, z: c.z, yaw: c.yaw, sx: 1, sy: 1, sz: 1, col: TAXI_PAINT, k: 1 })), cityKitMat(this.city), V(this.taxi.x, 0, this.taxi.z), 6);
    cabMesh.frustumCulled = false;
    this.world.add(cabMesh);
    // the litter baskets where our cameras go (rounded, real), and the city's cab where the hero cab parks hidden
    // (the city's parked car right behind the hero cab would touch it: gone)
    const byCab = this.city.plan.parked.filter((p) => Math.hypot(p.x - this.taxi.x, p.z - this.taxi.z) < 5.5);
    this.street = new StreetCars(this.city, [[388, 70, 45], [400, 112, 30], [415, 122, 35], [440, 127, 35], [620, 118, 35], [700, 122, 70], [1120, 135, 40]], { exclude: byCab.map((p) => [p.x, p.z] as [number, number]) });
    this.world.add(this.street);
    hideCityInstances(this.city, byCab.map((p) => [p.x, 0, p.z] as [number, number, number]));
    // the steel stairs up to the overpass (the el station's stairs are the city's)
    this.world.add(placeKit(this.city, stairKit(V(1133.6, oy, 147.5), V(1133.6, 0.15, 132.5), 1.8), 0, 0, 0));
    // the smashed window (FOR RENT, street 1 south side)
    this.window = new BrokenWindow(this.city, V(434.7, 0.55, 129.5), V(0, 0, -1), 4.6, 2.5, T.piece - 0.15, T.star + 0.25, 80);
    this.world.add(this.window);
    // the bank next door: its window's frosted band and lettering, by the lens in E
    this.world.add(windowBand(440.9, 1.45, 129.36, V(0, 0, -1), 4.9, 'ATM  ·  24 HOUR LOBBY', 'Lobby hours  Mon – Fri  9 am – 5 pm   ·   Sat 9 am – 1 pm'));


    // ---- people ----
    const figs: [RealFigure, RealFigure] = [he, she];
    const idles = ['77_02', '111_28', '142_15', '79_71', '13_04', '13_05', '140_06'];
    await this.folk.init(idles, [run, runB]);
    this.world.add(this.folk.crowd);
    const pal = [col('cyan', 1.1), col('violet', 1.0).lerp(col('white', 1.0), 0.2), col('#ff7fb6', 1.0), col('blue', 1.1).lerp(col('cyan', 1.1), 0.4), col('gold', 1.0).lerp(col('white', 1.0), 0.3), col('#9dff8a', 0.9), col('#ff9a6b', 1.0)];
    // the stream: the train's crowd first (they come down the stairs behind them), then more and more
    const nS = 260;
    // near them, people of light, each in their own colour (the train's crowd); stardust only further back
    const lightPal = [col('cyan', 1.0), col('violet', 1.0).lerp(col('white', 1.0), 0.25), col('#ff7fb6', 1.0), col('gold', 1.0).lerp(col('white', 1.0), 0.3), col('blue', 1.1).lerp(col('cyan', 1.1), 0.4), col('#9dff8a', 0.95), col('#ff9a6b', 1.0), col('#b9a6ff', 1.0)];
    this.folk.addStream(9, 3.2, 15, 1.4, (k) => (k < 6 ? T.c0 - 1 : T.B + k * 0.5), lightPal, figs, PACE, 'light', 5000);
    this.folk.addStream(nS, 15, 240, 1.3, (i) => (i < 16 ? T.c0 - 1 : T.c0 + Math.pow((i - 16) / (nS - 16), 0.75) * (T.L - T.c0 - 2)), pal, figs, PACE);
    this.addJoiners(figs, pal);

    // ---- prints, pigeons, splashes ----
    this.addPrints();
    this.world.add(this.prints);
    const pr = mulberry32(17);
    const birds: { p: THREE.Vector3; t0: number; away: THREE.Vector3 }[] = [];
    const legB = this.legs[1]!;
    for (let i = 0; i < 14; i++) {
      const s = legB.s0 + 6 + pr() * 9, side = (pr() - 0.5) * 3;
      const p = this.R1.side(s, side).setY(0.17);
      birds.push({ p, t0: legB.t0 + (s - legB.s0 - 3.5) / PACE + pr() * 0.2, away: V(pr() - 0.5, 0, -1 - pr()) });
    }
    this.pigeons = new Pigeons(birds, col('#ffb070', 1));
    this.world.add(this.pigeons);
    this.addSplashes();
    this.world.add(this.splashes);
    // the wet street's reflection (the city renders the scene again, mirrored): only the two of them in it
    // (the people draw after the shop interior seen through the broken window: run-props BrokenWindow)
    for (const o of [this.he, this.she, this.star, this.lantern, this.folk.crowd]) o.traverse((q) => { q.renderOrder = Math.max(q.renderOrder, 3); });
    mirrorOnly(this.city, [this.folk.crowd, this.prints, this.splashes, this.pigeons, this.trails, this.window]);
  }

  // ------------------------------------------------------------------ setup helpers

  private addJoiners(figs: [RealFigure, RealFigure], pal: THREE.Color[]) {
    const F = this.folk;
    const leg = (id: string) => this.legs.findIndex((l) => l.id === id);
    const passT = (li: number, s: number) => { const l = this.legs[li]!; return l.t0 + (s - l.s0) / PACE; };
    const add = (id: string, ds: number, side: number, face: number, o: Partial<Joiner> = {}) => {
      const li = leg(id), l = this.legs[li]!, s = l.s0 + ds;
      const j: Joiner = {
        look: 'dust', body: 0, color: pal[Math.floor(hash(li, ds) * pal.length)]!, idle: '77_02', leg: li, s, side, face: l.route.yaw(s) + face,
        tj: passT(li, s) + 0.1, lane: Math.sign(side) * 0.9 + (hash(ds, side) - 0.5) * 0.6,
      };
      for (const [k, v] of Object.entries(o)) if (v !== undefined) (j as unknown as Record<string, unknown>)[k] = v;
      return F.addJoiner(j, figs, PACE);
    };
    // A: under the el — a man against a column (his hand on it), a woman with her phone, a couple at a door,
    // two across the avenue; the first two stay with them all night
    add('A', 13.5, 2.1, -Math.PI / 2, { look: 'light', body: 0, idle: '111_28', color: col('cyan', 1.15).lerp(col('white', 1.15), 0.3), stay: 5.2, lane: -0.9, touch: V(-0.25, 0.4, 0.05) });
    add('A', 17.5, 1.5, -Math.PI / 2 + 0.3, { look: 'light', body: 1, idle: '79_71', color: col('violet', 1.1).lerp(col('white', 1.1), 0.5), stay: 6.5, lane: 0.9, mirror: true });
    add('A', 20, 1.6, -Math.PI / 2, { body: 0, idle: '142_15' });
    add('A', 20.8, 1.9, -Math.PI / 2 - 0.4, { body: 1, idle: '77_02', mirror: true });
    add('A', 24, -9, Math.PI / 2, { body: 1, idle: '140_06', go: 0.7 });
    add('A', 27, -10.5, Math.PI / 2 - 0.3, { body: 0, idle: '111_28', go: 0.9 });
    // B: on a stoop, at a lobby door, at the curb
    add('B', 7.5, 1.6, -Math.PI / 2, { look: 'light', body: 1, idle: '13_04', go: 0.55, color: col('violet', 1.1).lerp(col('white', 1.1), 0.45) });
    add('B', 10, 1.5, -Math.PI / 2 + 0.2, { body: 0, idle: '77_02' });
    add('B', 12, -1.8, Math.PI / 2, { body: 1, idle: '142_15' });
    // C: a woman waiting at the far corner
    add('C', 9.5, 1.4, -Math.PI / 2, { body: 1, idle: '79_71', go: 0.5 });
    // E: in the deli's light, a man sitting on a crate, a kid by the door
    add('E', 1.0, 1.8, -Math.PI / 2, { look: 'light', body: 0, idle: '13_05', go: 0.6, color: col('gold', 1.1).lerp(col('white', 1.1), 0.5) });
    add('E', 9.0, 1.9, -Math.PI / 2 + 0.3, { body: 1, idle: '77_02' });
    add('E', 12.5, -2.2, Math.PI / 2, { body: 0, idle: '79_71' });
    // G: on the corners of avenue 2
    for (let k = 0; k < 5; k++) add('G1', 3 + k * 4.2, (k % 2 ? 1 : -1) * (2.5 + hash(k, 2) * 2), (k % 2 ? -1 : 1) * Math.PI / 2, { body: (k % 2) as 0 | 1, idle: ['77_02', '111_28', '142_15'][k % 3]!, look: k === 1 ? 'light' : 'dust', color: k === 1 ? col('cyan', 1.15) : undefined as unknown as THREE.Color });
    // I: along the street to the river
    for (let k = 0; k < 6; k++) add('I', 6 + k * 3.5, (k % 2 ? 1 : -1) * 1.6, (k % 2 ? -1 : 1) * Math.PI / 2, { body: (k % 2) as 0 | 1, idle: ['111_28', '79_71', '77_02'][k % 3]! });
  }

  private addPrints() {
    const P = this.prints, T = this.T;
    const pc = [this.heC.clone().multiplyScalar(1.1), this.sheC.clone().multiplyScalar(1.1)];
    const cols = [col('cyan', 1.0), col('white', 1.0).lerp(col('cyan', 1.0), 0.4), col('pink', 1.0).lerp(col('white', 1.0), 0.4), col('violet', 1.0).lerp(col('white', 1.0), 0.4)];
    // A: his hand on the el column; the crowd's hands on the stair rails and the next columns
    P.print({ pos: V(385.75, 1.35, 72.5), normal: V(1, 0, 0), up: V(0, 1, 0.2), t: this.legs[0]!.t0 + (72.5 - 53.5) / PACE, color: pc[0]! });
    P.scatter(10, V(387.6, 0.15, 56), V(387.6, -4.2, 64), V(1, 0, 0), T.c0 + 0.3, T.B, cols, 3, 4.4, 5.0);
    for (const z of [80, 92, 104]) P.scatter(5, V(385.75, 0, z - 0.4), V(385.75, 0, z + 0.4), V(1, 0, 0), T.c0 + (z - 50) / PACE, T.c0 + (z - 50) / PACE + 3, cols, z, 0.9, 1.8);
    // B: her fingers on the lobby glass of street 1 (north side), then everyone's
    P.print({ pos: V(399.5, 1.25, 110.52), normal: V(0, 0, 1), up: V(0.4, 1, 0), t: this.legs[1]!.t0 + 0.75, color: pc[1]! });
    P.scatter(18, V(395, 0, 110.52), V(408, 0, 110.52), V(0, 0, 1), this.legs[1]!.t0 + 0.9, this.T.E + 2, cols, 21, 0.9, 1.9);
    // C: his palm on the cab's hood, hers on its roof, then the crowd's all over it
    P.print({ pos: this.hood.clone(), normal: V(0, 1, 0), up: V(0.5, 0, 0.8), t: this.T.tv0 + 0.1, color: pc[0]!, size: 0.2 });
    P.print({ pos: onCab(this.taxi.x, this.taxi.z, -Math.PI / 2, -0.75, 0.2), normal: V(0, 1, 0), up: V(0.6, 0, 0.8), t: this.T.grip + 0.1, color: pc[1]!, size: 0.18 });
    const pr = mulberry32(5);
    for (let i = 0; i < 26; i++) {
      const onRoof = pr() < 0.4, lz = onRoof ? -0.6 - pr() * 0.3 : 1.05 + pr() * 1.0, lx = (pr() - 0.5) * 1.2;
      P.print({ pos: onCab(this.taxi.x, this.taxi.z, -Math.PI / 2, lz, lx), normal: V(0, 1, 0), up: V(pr() - 0.5, 0, 1), t: this.T.E + 0.5 + pr() * 6, color: cols[i % 4]!, size: 0.16 + pr() * 0.05, left: pr() < 0.5 });
    }
    // E: his star hand on the window's frame; the crowd's along the shopfronts
    P.print({ pos: V(432.2, 1.4, 129.47), normal: V(0, 0, -1), up: V(0.3, 1, 0), t: T.piece - 0.2, color: pc[0]! });
    P.scatter(40, V(420, 0, 129.47), V(470, 0, 129.47), V(0, 0, -1), T.piece + 0.4, T.G1 + 1, cols, 33, 0.8, 1.9);
    // G: the cabs at the light
    for (let i = 0; i < 18; i++) {
      const c = CABS_G[i % 2]!, onRoof = pr() < 0.4, lz = onRoof ? -0.6 - pr() * 0.3 : 1.05 + pr() * 1.0, lx = (pr() - 0.5) * 1.2;
      P.print({ pos: onCab(c.x, c.z, c.yaw, lz, lx), normal: V(0, 1, 0), up: V(pr() - 0.5, 0, 1), t: T.G1 + 0.6 + pr() * 3, color: cols[i % 4]!, size: 0.17, left: pr() < 0.5 });
    }
    // I: the shopfronts of the long street
    P.scatter(70, V(645, 0, 129.47), V(700, 0, 129.47), V(0, 0, -1), T.I + 0.5, T.J + 1, cols, 44, 0.8, 2.0);
    P.scatter(50, V(645, 0, 125.4), V(700, 0, 125.4), V(0, 0, 1), T.I + 0.8, T.J + 1, cols, 45, 0.6, 1.0);
    // J–L: the overpass stair rails and the deck's railing, a long line of hands
    P.scatter(40, V(1132.65, 0.15, 132.5), V(1132.65, this.R3.at(9999).y, 147.5), V(1, 0, 0), T.J + 0.6, T.L + 1, cols, 51, 0.9, 1.0);
    const ov = this.city.overpass as ({ y: number; walk?: [number, number] }) | null, ox = (ov?.walk?.[0] ?? 1135) + 0.1, oy = ov?.y ?? 8.5;
    P.scatter(120, V(ox, oy, 152), V(ox, oy, 215), V(1, 0, 0), T.J + 1.4, T.L + 2.2, cols, 52, 0.85, 1.05);
    P.build();
  }

  /** Splashes under the heroes' feet: one per footfall (two per stride), precomputed over the chorus. */
  private addSplashes() {
    const S = this.splashes;
    const stride = this.run.P / (PACE / this.run.speed(this.he)); // seconds per stride cycle
    for (const leg of this.legs) {
      for (let t = leg.t0; t < leg.t1; t += stride / 2) {
        for (const [who, side] of [[0, 0.5], [1, -0.5]] as const) {
          const s = leg.s0 + PACE * (t - leg.t0) + (who ? -0.4 : 0.4);
          const p = leg.route.side(s, side + (Math.floor((t - leg.t0) / (stride / 2)) % 2 ? 0.12 : -0.12));
          if (p.y > 0.5) continue;
          const c = this.city.lightAt(p.x, p.z).multiplyScalar(2.2).add(col('#ffd2a0', 0.25));
          S.hit(p, t + (who ? 0.13 : 0), c, 1.2);
        }
      }
    }
    S.build();
  }

  // ------------------------------------------------------------------ per frame

  private legAt(t: number) {
    let i = 0;
    for (let k = 0; k < this.legs.length; k++) if (this.legs[k]!.t0 <= t) i = k;
    return i;
  }

  /** Motion time: during the three freezes time stands still (stop motion). */
  private tau(t: number) {
    for (const [a, b] of this.freezes) if (t >= a && t < b) return a;
    return t;
  }

  private heroStride(who: 0 | 1, li: number, t: number): Stride & { side: number; turn: number } {
    const leg = this.legs[li]!, fig = who ? this.she : this.he;
    const m = who ? this.runB : this.run;
    const tr = (leg.id === 'C' && this.tracks) ? (who ? this.tracks.she : this.tracks.he) : null;
    let s = leg.s0 + PACE * (t - leg.t0) + (who ? -0.35 : 0.35);
    let side = who ? -0.5 : 0.5, turn = 0, lift = 0, jumpK = 0, jumpU = 0;
    if (tr) {
      s = keys(t, tr.s);
      if (tr.turn) turn = keys(t, tr.turn);
      if (tr.lift) lift = keys(t, tr.lift);
      if (tr.jumpK) jumpK = keys(t, tr.jumpK);
      if (tr.jumpT) jumpU = clamp((t - tr.jumpT[0]) / (tr.jumpT[1] - tr.jumpT[0]));
    }
    // A: coming down the stairs, she's a step behind; side by side once on the street
    const pos = leg.route.side(s, side);
    // the stride: distance over the stride's own speed keeps the feet planted
    const clipT = s / m.speed(fig) * 1.0 + (who ? 0.21 : 0);
    let yaw = leg.route.yaw(s);
    if (turn > 0) yaw += turn * (who ? -Math.PI : Math.PI) * 0.92;
    return { pos, yaw, clipT, jumpK, jumpU, lift, side, turn };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, T = this.T;
    const tm = this.tau(t);
    const li = this.legAt(t), leg = this.legs[li]!;
    const { he, she } = this;

    // ---- the heroes ----
    const sh = [this.heroStride(0, li, tm), this.heroStride(1, li, tm)];
    const speedOf = (who: 0 | 1) => {
      const a = this.heroStride(who, li, tm - 0.05), b = this.heroStride(who, li, tm + 0.05);
      return a.pos.distanceTo(b.pos) / 0.1;
    };
    [he, she].forEach((fig, who) => {
      const st = sh[who]!;
      const v = speedOf(who as 0 | 1);
      const runW = smoothstep(0.6, 2.4, v) + (st.jumpK ?? 0);
      const m = who ? this.runB : this.run;
      const layers = [{ m, t: st.clipT, w: Math.min(1, runW) * (1 - (st.jumpK ?? 0)), mirror: who === 1 }, { m: this.idle, t: tm + who * 3.1, w: 1 - Math.min(1, runW), loop: true }];
      if ((st.jumpK ?? 0) > 0.001) layers.push({ m: this.jump, t: (st.jumpU ?? 0) * this.jump.P, w: st.jumpK!, mirror: who === 1 });
      applyLayers(fig, layers);
      fig.position.copy(st.pos);
      fig.position.y += fig.hipHeight + (st.lift ?? 0);
      fig.rotation.set(0, st.yaw, 0);
      fig.updateMatrixWorld(true);
      fig.time = t;
    });
    // C: his palm on the hood as he vaults; reaching back across the cab; the pull
    if (leg.id === 'C') {
      reachTo(he, 0, this.hood, inOut(tm, T.tv0 - 0.12, T.tv0 + 0.26, 0.1, 0.12), V(-0.4, -0.3, -0.6), 0.1);
      const k = inOut(tm, T.take - 0.05, T.E + 1, 0.4, 0.1);
      holdHands(he, 1, she, 0, k, 0.05);
    } else if (leg.hold > 0) {
      // (on the release, "glowing in the dark", their joined hands go up, and his other hand with the star)
      const up = leg.id === 'L' ? inOut(tm, T.release + 0.05, this.ctx.end + 2, 0.45, 0.3) : 0;
      holdHands(he, 1, she, 0, leg.hold, 0.85 * up);
      if (up > 0.001) reachTo(he, 0, he.spinePoint(-0.35, 0.95, 0.25), up, V(-0.6, -0.3, 0), 0.4);
    }
    // his star in his right hand, her lantern in her left
    holdIn(he, 0, this.star, -0.01);
    holdIn(she, 1, this.lantern, 0.26);
    const touch = leg.id === 'E' ? Math.exp(-Math.abs(tm - (T.piece - 0.2)) * 6) : 0;
    this.star.level = 1.1 + 0.5 * f.a.kick + 2.5 * touch;
    this.lantern.time = t;
    this.lantern.update();
    this.updateTrails(li, tm);

    // ---- the city ----
    const cam = this.camera(li, t, tm);
    S.cam.updateMatrixWorld();
    this.city.windowGain = 1 + 0.25 * f.a.kick;
    this.city.lampGain = 1 + 0.3 * f.a.kick;
    // the town asleep until "wake": then every window switches on in a wave from them down the street
    const wakeK = t < T.I ? 1 : 0;
    const hp = this.he.position;
    if (leg.id === 'I' || leg.id === 'J' || leg.id === 'K' || leg.id === 'L') {
      const a = Math.max(0, t - T.wake);
      const r = t < T.wake ? 0 : 25 * (1 - Math.exp(-a * 6)) + 110 * a + 45 * a * a;
      this.city.power.level = 0.1;
      const wp = this.legs[this.legs.findIndex((l) => l.id === 'I')]!;
      const w0 = wp.route.at(wp.s0 + PACE * (T.wake - wp.t0));
      this.city.power.wave(0, { x: w0.x, z: w0.z, r: Math.max(1, r), soft: 45, to: 1 });
      void wakeK;
    } else {
      this.city.power.level = 1;
      this.city.power.wave(0, null);
    }
    void hp;
    const glows = [
      { pos: he.position.clone().setY(he.position.y + 0.3), color: this.heC.clone().multiplyScalar(0.16), radius: 3.5 },
      { pos: she.position.clone().setY(she.position.y + 0.3), color: this.sheC.clone().multiplyScalar(0.16), radius: 3.5 },
      { pos: this.lantern.position.clone(), color: col('gold', 0.18), radius: 2.5 },
    ];
    // ---- everyone else ----
    const lv = { route: leg.route, sH: leg.s0 + PACE * (tm - leg.t0), v: PACE, index: li, hideKept: leg.id === 'I' || leg.id === 'C', gapExtra: leg.id === 'C' ? 9 : leg.id === 'I' ? 7 : 0 };
    if (leg.id === 'C') lv.sH = Math.max(keys(tm, this.tracks!.he.s), keys(tm, this.tracks!.she.s));
    this.folk.update(tm, lv, S.cam);
    // (the wet street's reflection only where the street is in the picture)
    this.city.mirrorOn = !(leg.id === 'K' || leg.id === 'L');
    this.city.setGlows([...glows, ...this.folk.glows(S.cam.position, 9)]);
    this.city.update(t, S.cam.position);
    this.street.update(S.cam.position);
    this.prints.time = t;
    this.window.update(tm, S.cam);
    this.window.visible = leg.id === 'E' || leg.id === 'F';

    this.pigeons.update(tm);
    this.pigeons.visible = leg.id === 'B' || leg.id === 'A';
    this.splashes.update(tm);

    shiftRender(this.ctx.renderer, S.scene, S.cam, this.world, this.city, out, S.bg);
    // ---- post ----
    let flash = 0;
    for (const [a] of this.freezes) flash = Math.max(flash, t >= a ? Math.exp(-(t - a) * 28) * 0.7 : 0);
    flash = Math.max(flash, t >= T.release ? Math.exp(-(t - T.release) * 8) * 0.35 : 0);
    void cam;
    return { bloom: 0.95, bloomThreshold: 0.75, bloomRadius: 0.85, halation: 0.14, vignette: 0.42, grain: 0.05, ca: 0.8, flash, shake: [0, 0] as [number, number] };
  }

  /** Light trails behind his star and her lantern: where they were, carried back along their run. */
  private updateTrails(li: number, tm: number) {
    const G = this.trails, n = 24;
    let k = 0;
    for (const [who, obj, c] of [[0, this.star, col('phosphor', 1.1)], [1, this.lantern, col('gold', 1.2)]] as const) {
      const now = this.heroStride(who, li, tm).pos;
      let prev = obj.position.clone();
      for (let i = 1; i <= n; i++) {
        const back = this.heroStride(who, li, tm - i * 0.018).pos;
        const p = obj.position.clone().sub(now).add(back);
        p.y += Math.sin(i * 0.9 + tm * 10) * 0.004 * i;
        G.set(k++, prev, p, c, 0.9 * (1 - i / n) ** 1.5);
        prev = p;
      }
    }
    G.commit(k);
  }

  // ------------------------------------------------------------------ the camera

  private camera(li: number, t: number, tm: number) {
    const S = this.st, leg = this.legs[li]!, T = this.T, R = leg.route;
    const u = clamp((t - leg.t0) / (leg.t1 - leg.t0));
    const sH = leg.s0 + PACE * (tm - leg.t0);
    const mid = this.he.position.clone().lerp(this.she.position, 0.5);
    mid.y -= this.he.hipHeight;
    const d = R.dir(sH, V(), 4), r = V(-d.z, 0, d.x);
    const at = (p: THREE.Vector3, fwd: number, right: number, up: number) => p.clone().addScaledVector(d, fwd).addScaledVector(r, right).addScaledVector(UP, up);
    let pos: THREE.Vector3, tgt: THREE.Vector3, fov = 50, roll = 0;
    switch (leg.id) {
      case 'A': {
        // ahead of them, low in the parking lane under the el; they come down the stairs and run at us
        // (on the pavement ahead, looking back up the station's stairs: they come down at us with the crowd)
        // (at the foot of the stairs, looking up: they come down at us, the crowd behind them)
        pos = V(387.2, 1.35, 68.5 + 3.5 * ease.inOutQuad(u));
        tgt = mid.clone().add(V(0, 1.1, 0)).lerp(V(388.6, 5.5, 52), 0.25 * (1 - u));
        fov = 42;
        roll = 0.03 * Math.sin(t * 1.3);
        break;
      }
      case 'B': {
        // side-on from the street, running with them; pigeons burst up between us
        pos = at(mid, 1.6 - 0.8 * u, 4.6, 1.15);
        tgt = at(mid, 0.6, 0, 1.05);
        fov = 46;
        break;
      }
      case 'C': {
        // the cab in the middle of the frame, from the street side ahead of its nose
        // (the cab's nose toward us, headlights on: she on the left on the street side, he lands on the right)
        // (from the front-left, a little above: the hood between them)
        pos = V(407.4, 2.2, 120.0).lerp(V(407.9, 2.0, 120.4), ease.inOutQuad(u));
        tgt = V(412.4, 1.0, 124.1).lerp(V(412.6, 1.1, 124.3), ease.inOutQuad(u));
        fov = 36 - 3 * ease.inOutQuad(u);
        break;
      }
      case 'E': {
        // low on the pavement past the smashed window: they run at us, the shards rise into the frame
        const tilt = smoothstep(T.star - 0.2, leg.t1, t);
        pos = V(442 - 1.5 * u, 0.6 + 0.8 * tilt, 125.7);
        tgt = V(433.0, 1.0 + 3.5 * tilt * tilt, 128.6).lerp(V(436, 7, 124.5), tilt * 0.6);
        fov = 50;
        break;
      }
      case 'F': {
        // the crane: from just behind them up high, looking back over the stream winding through the streets
        const k = ease.inOutCubic(smoothstep(0.02, 0.98, u));
        const p0 = at(mid, -3.5, -1.2, 1.5), p1 = V(458, 34, 121);
        pos = p0.lerp(p1, k);
        tgt = at(mid, 4, 0, 1.0).lerp(V(396, 0, 118.5), k);
        fov = 48 + 8 * k;
        roll = -0.05 * Math.sin(Math.PI * k);
        break;
      }
      case 'G1': {
        // on the crossing, low between the cabs' headlights: they cross the avenue in front of us
        pos = V(617.0, 0.8, 123.4).lerp(V(618.2, 0.85, 123.2), u);
        tgt = mid.clone().setY(1.15).lerp(V(606, 1.6, 121), 0.15);
        fov = 50;
        break;
      }
      case 'G2': {
        // from above the corner: the stream floods across (a whip pan in on the beat)
        const whip = 1 - ease.outExpo(clamp(u * 3));
        pos = V(642, 13, 140);
        tgt = V(622, 0, 124).add(V(-30 * whip, 0, 18 * whip));
        fov = 50;
        roll = -0.25 * whip;
        break;
      }
      case 'I': {
        // low behind them, down the long street to the river; the windows wake in a wave ahead of them
        // (low in the parking lane behind them, under the trees; after "wake" the camera lifts to the facades)
        const wk = smoothstep(T.wake - 0.2, T.wake + 1.6, t);
        pos = at(mid, -4.5, 0.8, 1.6 + 0.6 * wk);
        tgt = at(mid, 30, -2.5, 1.9 + 5 * wk);
        fov = 60;
        roll = 0.02 * Math.sin(t * 2.1);
        break;
      }
      case 'J': {
        // from the deck, by the railing: they climb the stairs and come up onto the overpass, the city behind
        // (on the walkway past the top of the stairs: they come up toward us and run by, the city behind them)
        const oy = this.R3.at(9999).y;
        // (at the top of the stairs, looking down them: they climb at us, the crowd pouring up behind, the city below)
        // (from the street beside the stairs: they climb them in profile, the crowd pouring up behind, the deck above)
        pos = V(1112.5 + 2 * u, 3.6 + 1.2 * u, 135.5 + 3 * u);
        tgt = mid.clone().add(V(0, 0.9, 0)).lerp(V(1133.6, 5, 141), 0.4);
        fov = 50;
        void oy;
        break;
      }
      case 'K': {
        // three freeze-frames, three angles
        const oy = this.R3.at(9999).y;
        const fi = this.freezes.findIndex(([a, b]) => t >= a && t < b + 0.12);
        const k = fi < 0 ? (t < this.freezes[0]![0] ? -1 : 2) : fi;
        if (k <= 0) { pos = at(mid, 3.5, -4.5, 2.0); tgt = at(mid, -2, 1.5, 1.2); fov = 48; }
        else if (k === 1) { pos = at(mid, 1.5, -1.3, 1.35); tgt = at(mid, 0, 0, 1.15); fov = 40; }
        else { pos = at(mid, 3.4, 0.4, 0.4); tgt = at(mid, 0, 0, 1.5); fov = 58; roll = 0.12; }
        void oy;
        break;
      }
      default: {
        // L: release — the camera lifts and pulls back over the river, the stream pours along the deck
        const k = ease.inOutCubic(u);
        pos = at(mid, 4 + 4 * k, -6 - 8 * k, 2 + 9 * k);
        tgt = at(mid, -6 * k, 4, 1.0);
        fov = 50 + 6 * k;
        break;
      }
    }
    S.cam.fov = fov;
    S.cam.updateProjectionMatrix();
    aim(S.cam, pos, tgt, roll);
    return { pos, tgt };
  }
}

void lerp; void noise1; void poseStride;
