// Verse 2 and pre-chorus 2, "We've been ghosts in a crowded room": the next night, the power is back but closeness
// isn't. A night elevated train: the city's windows and signs streaming past, the lamp posts passing on the beat,
// rain on the glass. Inside, passengers are see-through ghosts lit only by their phones; he (blue light) and she
// (rose-peach) are among them, dim.
//   A  "We've been ghosts in a crowded room"   the words wiped by a finger into the fogged window above a bench
//                                              of ghosts on their phones; slow push-in
//   B  "Holding on to the friends that we've got"  down the aisle to the amber info display, which spells the line;
//                                              hands on the straps and the pole, two friends sharing one phone
//   C  "If the night's gonna swallow the moon"  the reflection shot: over his shoulder at the window; in the glass
//                                              he and she see each other; outside the moon over the roofs, and the
//                                              words are the stops of the LED line map. A black tower slides over
//                                              the moon; at a gap in the rails the car's lights flicker and die
//   D  "Then we'll light up the spot"          the dark car from its end: the line hangs in small lights; the two
//                                              light up, then the ghosts one by one, phones forgotten; the train
//                                              pulls in and the station's lights come on with them
//   E  "Put your hands up"                     the doors slide open on the neon wall of the station; hands go up
//   F  "if you've ever felt low"               on the platform: they pour out under the neon, hands up; whip pan
//   G  "Tonight we let it all go"              the stair: the words painted in light on the risers; crane down
//   H  "Turn the pain into gold, oh"           high above the avenue: neon on the asphalt turns gold, and the city
//   I  "Here we go, here we go"                street level: they burst into the avenue under the neon
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { norm, type Line } from '../../engine/lyrics';
import { clamp, ease, frameIdx, hash, lerp, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { RealFigure, glowBodyMaterial, loadBody, type BodyKind } from '../lib/people';
import { loadMotion, type Motion } from '../lib/motion';
import { NeonLine, flickerOn } from '../lib/neon';
import { displayTextGeometry, loadDisplayFont } from '../lib/fonts';
import { PaperLantern, StarSticker, holdIn, makeHeroes } from '../lib/heroes';
import { GlowPoints } from '../lib/points';
import { F } from '../../engine/type';
import { FLOOR_Y, MAXL, lightUniforms } from './train-gfx';
import { CAR, Car } from './train-car';
import { Outside, Ride, ST, STAIR_FOOT, Station } from './train-world';
import { Headphones, Phone, blendReach, clipFacing, facingDir, lerpAngle, lighten, passengerMaterial, playCues, prepassMeshes, type Cue } from './train-people';
import { DotMatrix, FogWriting, LineMap, MoteLetters, subLine, wordCanvas } from './train-text';

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const GHOST = () => new THREE.Color(0.4, 0.5, 0.72).multiplyScalar(0.3);
const PHONE_C = new THREE.Color(0.55, 0.75, 1.0);

interface Spec {
  id: string; body?: BodyKind; hat?: boolean; hero?: 'he' | 'she';
  seat?: [number, number]; stand?: [number, number, number];
  clip: string; seg?: [number, number]; standAt?: [string, number]; mirror: boolean; off: number;
  phone: 0 | 1 | null; hold?: 0 | 1; extra?: 'sleep' | 'headphones' | 'shareA' | 'shareB' | 'strap' | 'pole'; glow: string; dy?: number;
}
const SPECS: Spec[] = [
  { id: 'G1', body: 'rpm', seat: [-2.9, -1], clip: '13_04', seg: [3.6, 7.8], standAt: ['13_04', 7.75], mirror: false, off: 0.7, phone: 0, glow: '#ffc48a' },
  { id: 'G2', body: 'rpm', hat: true, seat: [-1.75, -1], clip: '13_05', seg: [3.2, 10.2], standAt: ['13_05', 10.1], mirror: true, off: 2.3, phone: 1, extra: 'headphones', glow: '#b8d4ff' },
  { id: 'SHE', hero: 'she', seat: [-0.35, -1], clip: '13_05', seg: [17.0, 23.9], standAt: ['13_05', 23.8], mirror: false, off: 1.1, phone: 0, glow: '' },
  { id: 'G3', body: 'michelle', seat: [1.4, -1], clip: '13_04', seg: [12.2, 17.9], standAt: ['13_04', 17.9], mirror: true, off: 0.4, phone: null, extra: 'sleep', glow: '#ffb0c8' },
  { id: 'G6', body: 'michelle', seat: [2.6, 1], clip: '13_05', seg: [30.0, 36.0], standAt: ['13_05', 10.1], mirror: true, off: 3.3, phone: 0, glow: '#c8ffd8' },
  { id: 'FR1', body: 'michelle', seat: [6.45, 1], clip: '13_04', seg: [23.0, 26.2], standAt: ['13_04', 26.2], mirror: false, off: 1.6, phone: 0, extra: 'shareA', glow: '#ffe2a8' },
  { id: 'FR2', body: 'rpm', seat: [7.05, 1], clip: '13_04', seg: [32.6, 38.0], standAt: ['13_04', 38.0], mirror: true, off: 2.0, phone: null, extra: 'shareB', glow: '#d4c0ff' },
  { id: 'HE', hero: 'he', stand: [0.55, 0.45, 0], clip: '79_71', mirror: false, off: 2.0, phone: null, hold: 0, extra: 'strap', glow: '' },
  { id: 'G7', body: 'michelle', stand: [5.12, -0.62, Math.PI], clip: '77_02', mirror: true, off: 1.0, phone: 1, hold: 0, extra: 'pole', glow: '#ffd0a0' },
  { id: 'G8', body: 'rpm', hat: true, stand: [4.06, -0.6, Math.PI], clip: '111_28', mirror: false, off: 4.0, phone: 0, hold: 1, extra: 'pole', glow: '#a8e8ff' },
];
/** Who leaves first. */
const EXIT = ['G8', 'G7', 'FR1', 'FR2', 'HE', 'SHE', 'G6', 'G3', 'G2', 'G1'];
/** Who lights up after the two, in order. */
const CHAIN = ['G3', 'G2', 'G6', 'G1', 'G8', 'G7', 'FR1', 'FR2'];

interface P {
  s: Spec; fig: RealFigure; mat: THREE.ShaderMaterial; hero: boolean; cues: Cue[];
  home: THREE.Vector3; homeYaw: number; seated: boolean;
  phone: Phone | null; tLight: number; glowC: THREE.Color; prepass: THREE.Object3D[];
  path: { t: number[]; p: THREE.Vector3[] }; tRun: number; tUp: number; tRaise: number; strap: number; seed: number;
  phones?: Headphones;
}
interface Shot { pos: THREE.Vector3; tgt: THREE.Vector3; fov: number; roll: number; local: boolean }

export default class Train extends Scene {
  st = new Stage(50, 0.03, 9000);
  U = lightUniforms();
  T: Record<string, number> = {};
  L: Record<string, Line> = {};
  ride!: Ride;
  car!: Car;
  out!: Outside;
  station!: Station;
  people: P[] = [];
  byId = new Map<string, P>();
  star = new StarSticker(0.05);
  lantern = new PaperLantern(0.1);
  // reflections in the +z window glass
  mirror = new THREE.Group();
  twins: { src: P; fig: RealFigure }[] = [];
  mirrorPts = new GlowPoints(12, 0.02);
  // lyrics
  fogW!: FogWriting;
  display!: DotMatrix;
  lineMap!: LineMap;
  motes!: MoteLetters;
  moteGrp = new THREE.Group();
  wallNeon!: NeonLine;
  roadNeon!: NeonLine;
  riserBoxes: THREE.Vector4[] = [];
  hereGo: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t0: number }[] = [];
  lights: { p: THREE.Vector3; r: number; c: THREE.Color; k: number }[] = [];
  bars: number[] = [];

  override async init() {
    (globalThis as { __train?: Train }).__train = this; // (for profiling scripts)
    const { lyrics, audio } = this.ctx;
    const S = this.st.scene, U = this.U;
    this.st.bg.copy(col('night'));
    // ---- timing
    const L = this.L;
    const after = (q: string, t: number) => { const l = lyrics.find(q).find((x) => x.start > t); if (!l) throw new Error(`lyric not found after ${t}: ${q}`); return l; };
    L.l1 = lyrics.get('We’ve been ghosts');
    L.l2 = lyrics.get('Holding on to the friends');
    L.l3 = lyrics.get('swallow the moon');
    L.l4 = lyrics.get('light up the spot');
    L.p1 = after('Put your hands up', L.l4.start);
    L.p2 = after('Tonight we let it all go', L.p1.start);
    L.p3 = after('Turn the pain into gold', L.p2.start);
    L.p4 = after('Here we go, here we go', L.p3.start);
    const wd = (l: Line, w: string, nth = 0) => l.words.filter((x) => norm(x.w) === norm(w))[nth]!.start;
    const beatBefore = (t: number) => audio.timeOfBeat(Math.floor(audio.beatAt(t))); // (never after the first word)
    const downAfter = (t: number) => audio.downbeats.find((d) => d >= t - 0.06) ?? t;
    const T = this.T;
    T.cB = beatBefore(L.l2.start);
    T.cC = beatBefore(L.l3.start);
    T.cD = beatBefore(L.l4.start);
    T.cE = audio.downbeats.filter((d) => d < L.p1.start - 0.1).at(-1)!;
    T.cF = downAfter(wd(L.p1, 'up'));
    T.cG = beatBefore(L.p2.start);
    T.cH = beatBefore(L.p3.start);
    T.cI = beatBefore(L.p4.start);
    T.nights = wd(L.l3, 'night’s'); T.swallow = wd(L.l3, 'swallow'); T.moon = wd(L.l3, 'moon');
    T.light = wd(L.l4, 'light'); T.spot = wd(L.l4, 'spot');
    T.put = L.p1.start; T.hands = wd(L.p1, 'hands'); T.up = wd(L.p1, 'up');
    T.gold = L.p3.words.find((w) => /gold/i.test(w.w))!.start;
    T.here1 = L.p4.words[0]!.start; T.here2 = L.p4.words[3]!.start;
    T.gap0 = T.moon + 0.35; T.gap1 = T.cD - 0.05; // the gap in the rails: the lights stutter and die
    T.doors = T.put - 0.3;
    this.bars = audio.downbeats.filter((d) => d > this.ctx.start - 1 && d < this.ctx.end + 1);
    this.ride = new Ride(audio, T.cD, T.doors - 0.02);

    // ---- lights, the car, the world
    U.uAmb.value.setRGB(0.004, 0.005, 0.009);
    U.uCeilC.value.setRGB(0.5, 0.56, 0.7).multiplyScalar(0.55);
    U.uFogC.value.setRGB(0.012, 0.014, 0.03);
    U.uFogD.value = 0.004;
    const az = 0.44, el = 0.15;
    const moonDir = V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    U.uMoonD.value.copy(moonDir);
    this.car = new Car(U);
    this.out = new Outside(U, this.ride, moonDir);
    // the riser words: TONIGHT / WE LET / IT ALL / GO
    const pw = L.p2.words.map((w) => w.w.replace(/[,.]/g, '').toUpperCase());
    const riser = wordCanvas([{ words: [pw[0]!], size: 300 }, { words: [pw[1]!, pw[2]!], size: 330 }, { words: [pw[3]!, pw[4]!], size: 330 }, { words: [pw[5]!], size: 440 }], 920, 1990, F.archivo(62, 900));
    this.riserBoxes = riser.boxes;
    this.station = new Station(U, riser);
    S.add(this.car, this.out, this.station);
    this.out.placeTower((t) => this.shotC(t).pos.clone().add(this.carPos(t)), (T.swallow + T.moon) / 2 + 0.1);

    // ---- people
    const [{ he, she }, twinsH, rpm, mi] = await Promise.all([makeHeroes(), makeHeroes(), loadBody('rpm'), loadBody('michelle')]);
    const clipIds = [...new Set(SPECS.flatMap((s) => [s.clip, s.standAt?.[0] ?? s.clip]).concat(['79_69', '16_35', '09_01']))];
    const full = new Map<string, Motion>();
    await Promise.all(clipIds.map(async (c) => full.set(c, await loadMotion(c))));
    const segs = await Promise.all(SPECS.map((s) => (s.seg ? loadMotion(s.clip, { from: s.seg[0], to: s.seg[1] }) : Promise.resolve(full.get(s.clip)!))));
    const order = (id: string) => EXIT.indexOf(id);
    SPECS.forEach((s, i) => {
      let fig: RealFigure, mat: THREE.ShaderMaterial;
      if (s.hero) {
        fig = s.hero === 'he' ? he : she;
        mat = fig.mat;
        mat.uniforms.level!.value = 0.3;
      } else {
        mat = passengerMaterial(GHOST(), col(s.glow, 0.85));
        fig = new RealFigure(s.body === 'rpm' ? rpm : mi, s.body!, col('white'), mat, { prepass: true, hat: s.hat });
      }
      lighten(fig, 0.012, fig.kind === 'michelle' ? 0.45 : 1);
      const seated = !!s.seat;
      const home = seated ? V3(s.seat![0], 0, s.seat![1] * (CAR.hw - 0.3)) : V3(s.stand![0], 0, s.stand![1]);
      const homeYaw = seated ? (s.seat![1] < 0 ? 0 : Math.PI) : s.stand![2];
      const seed = i * 7 + 3;
      // motion: the seated / standing loop, standing up, very happy, the run
      const m0 = segs[i]!;
      const cues: Cue[] = [{ m: m0, from: 0, at: s.off, loop: true, mirror: s.mirror, yaw0: clipFacing(fig, m0, 0, Math.min(m0.duration, 4), s.mirror, true) }];
      const r = order(s.id);
      const tUp = this.ctx.start + (T.doors - 0.25 - this.ctx.start) + 0.09 * ((r * 3) % 10);
      if (seated) {
        const [sc, st] = s.standAt!;
        const ms = full.get(sc)!;
        cues.push({ m: ms, from: tUp, at: st - 0.35, loop: false, mirror: s.mirror, fade: 0.35, yaw0: clipFacing(fig, ms, st - 0.3, st + 0.9, s.mirror, false) });
      }
      const happy = full.get('79_69')!;
      const tHappy = tUp + (seated ? 1.05 : 0.2);
      const hm = (i % 2) === 1;
      cues.push({ m: happy, from: tHappy, at: 0.3 + (i * 0.37) % 1.2, loop: true, mirror: hm, fade: 0.55, yaw0: clipFacing(fig, happy, 0, 3, hm, true) });
      const p: P = {
        s, fig, mat, hero: !!s.hero, cues, home, homeYaw, seated, phone: s.phone !== null || s.id === 'FR1' ? new Phone() : null,
        tLight: 0, glowC: s.hero ? (mat.uniforms.color!.value as THREE.Color).clone() : col(s.glow, 0.85), prepass: prepassMeshes(fig),
        path: { t: [], p: [] }, tRun: 0, tUp, tRaise: T.hands - 0.05 + 0.05 * ((r * 7) % 6), strap: -1, seed,
      };
      if (!s.hero) {
        for (const o of p.prepass) o.visible = false;
        // (the eyes and teeth would float as rings inside a see-through head)
        for (const m of fig.meshes) if (/Eye|Teeth/.test(m.name)) for (const o of m.parent!.children) if ((o as THREE.Mesh).geometry === m.geometry) o.visible = false;
        p.prepass = p.prepass.filter((o) => o.visible !== false || !fig.meshes.some((m) => /Eye|Teeth/.test(m.name) && (o as THREE.Mesh).geometry === m.geometry));
      }
      this.people.push(p);
      this.byId.set(s.id, p);
      this.car.add(fig);
      if (p.phone) S.add(p.phone);
      if (s.extra === 'headphones') { p.phones = new Headphones(fig, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.02, 0.025) })); S.add(p.phones); }
      if (s.extra === 'strap') p.strap = this.car.strapNear(home.x + (s.id === 'HE' ? -0.12 : 0.05), s.id === 'HE' ? CAR.barZ : -CAR.barZ);
    });
    // light-up times: the two on "light", then the chain
    const tl0 = T.light;
    this.byId.get('HE')!.tLight = tl0; this.byId.get('SHE')!.tLight = tl0 + 0.03;
    const sixteenth = (k: number) => audio.timeOfBeat(Math.round(audio.beatAt(tl0)) + 0.5 + k * 0.5);
    CHAIN.forEach((id, k) => (this.byId.get(id)!.tLight = sixteenth(k <= 2 ? k : 2 + (k - 2) * 0.5)));
    // exit paths (car-local; the car stands at x = 0 when the doors open)
    EXIT.forEach((id, r) => this.buildPath(this.byId.get(id)!, r));
    // the run clips
    const runs = [full.get('16_35')!, full.get('09_01')!];
    for (const p of this.people) {
      const k = order(p.s.id), m = runs[k % 2]!, mir = k % 3 === 1;
      p.cues.push({ m, from: p.tRun + 0.05, at: (k * 0.29) % 0.6, speed: 1.05 + 0.04 * (k % 3), loop: true, mirror: mir, fade: 0.35, yaw0: clipFacing(p.fig, m, 0, 0.6, mir, true) });
      p.cues.sort((a, b) => a.from - b.from);
    }
    // his star, her lantern
    this.star.level = 0.3;
    S.add(this.star, this.lantern);
    // the reflections: him and her (and the car's lights and the phones) mirrored in the +z glass
    this.mirror.position.z = 2 * 1.445;
    this.mirror.scale.z = -1;
    for (const [src, fig] of [[this.byId.get('HE')!, twinsH.he], [this.byId.get('SHE')!, twinsH.she]] as const) {
      lighten(fig, 0.012, fig.kind === 'michelle' ? 0.45 : 1);
      fig.updateMatrixWorld(true);
      fig.mat.uniforms.level!.value = 0.2;
      for (const o of prepassMeshes(fig)) o.visible = false;
      this.mirror.add(fig);
      this.twins.push({ src, fig });
    }
    const fixTwin = new THREE.InstancedMesh(this.car.fix.geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.12, 0.12), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), 20);
    fixTwin.instanceMatrix = this.car.fix.instanceMatrix;
    fixTwin.instanceColor = this.car.fix.instanceColor;
    this.mirror.add(fixTwin, this.mirrorPts);
    this.car.add(this.mirror);

    // ---- the lyrics
    // L1: wiped into the fog on the middle window of the -z side
    const l1 = L.l1, s1 = l1.words.findIndex((w) => norm(w.w) === 'in');
    this.fogW = new FogWriting(2.03, CAR.win1 - CAR.win0, [{ line: subLine(l1, 0, s1), x: -0.02, y: 0.17 }, { line: subLine(l1, s1, l1.words.length), x: 0.04, y: -0.08 }], 0.25, 'script');
    this.fogW.position.set(-2.175, (CAR.win0 + CAR.win1) / 2, -1.436);
    this.car.add(this.fogW);
    // L2: the amber display over the front gangway door
    const w2 = L.l2.words.map((w) => w.w.replace(/[,.]/g, ''));
    const ids = (ws: string[], first: number) => ws.flatMap((w, k) => [...Array.from(w).map(() => first + k), first + k]).slice(0, -1);
    this.display = new DotMatrix(1.72, [
      [{ text: 'NEXT STOP', ids: Array(9).fill(15) }, { text: '14 ST', ids: Array(5).fill(15) }],
      [{ text: `${w2[0]} ${w2[1]}`, ids: ids([w2[0]!, w2[1]!], 1) }, { text: `${w2[2]} ${w2[3]}`, ids: ids([w2[2]!, w2[3]!], 3) }],
      [{ text: `${w2[4]} ${w2[5]}`, ids: ids([w2[4]!, w2[5]!], 5) }, { text: `${w2[6]} ${w2[7]}`, ids: ids([w2[6]!, w2[7]!], 7) }],
    ], 80);
    this.display.position.set(8.94, 2.03, 0);
    this.display.rotation.y = -Math.PI / 2;
    this.car.add(this.display);
    // L3: the line map on the +z cove over the middle window: the stops are the words
    const w3 = L.l3.words.map((w) => w.w.replace(/[,.]/g, '').toUpperCase());
    this.lineMap = new LineMap(3.3, 0.42, [
      { words: [w3[0]!], above: true }, { words: [w3[1]!, w3[2]!], above: false }, { words: [w3[3]!], above: true }, { words: [w3[4]!], above: false }, { words: [w3[5]!, w3[6]!], above: true },
    ]);
    const cy = (CAR.top + CAR.ceil) / 2;
    this.lineMap.position.set(-0.2, cy, 1.19 - 0.012);
    this.lineMap.lookAt(V3(-0.2, cy - 0.38, 1.19 - 0.2 - 0.012));
    this.car.add(this.lineMap);
    // L4: letters of small lights over the aisle at the rear of the car
    const l4 = L.l4, s4 = l4.words.findIndex((w) => norm(w.w) === 'light');
    this.motes = new MoteLetters([{ line: subLine(l4, 0, s4), y: 0.27 }, { line: subLine(l4, s4, l4.words.length), y: 0 }], 'hscript', 0.28, 0.0075, 0.01);
    this.moteGrp.add(this.motes);
    this.moteGrp.position.set(-2.3, 1.76, 0.1);
    this.moteGrp.rotation.y = -Math.PI / 2;
    this.car.add(this.moteGrp);
    // P1: neon script on the station wall, facing the doors
    this.wallNeon = new NeonLine(L.p1, [[0, 1, 2, 3], [4, 5, 6, 7, 8]], { font: 'script', size: 0.72, color: col('pink', 2.2).lerp(col('white', 2.2), 0.12), leading: 0.8, radius: 0.015 });
    this.wallNeon.position.set(4.6, FLOOR_Y + 1.2, ST.zWall + 0.06);
    S.add(this.wallNeon);
    // P3: neon lying on the asphalt of the avenue past the stair, readable from the crane
    this.roadNeon = new NeonLine(L.p3, [[0, 1, 2], [3, 4, 5]], { font: 'readable', size: 1.9, color: col('violet', 2.0).lerp(col('blue', 2.0), 0.3), leading: 2.4, radius: 0.06 });
    const hc = this.shotH(this.T.cH + 0.5);
    const fwd = hc.tgt.clone().sub(hc.pos).setY(0).normalize(), right = V3(-fwd.z, 0, fwd.x);
    this.roadNeon.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, fwd, UP));
    this.roadNeon.position.set(31.0, 0.06, -6.8);
    S.add(this.roadNeon);
    // P4: HERE WE GO, twice, in Tilt Neon on the station's end, over the avenue
    const tilt = await loadDisplayFont('tiltneon');
    const p4 = L.p4;
    [[0, 1, 2], [3, 4, 5]].forEach((row, ri) => {
      const geos = row.map((wi) => displayTextGeometry(tilt, p4.words[wi]!.w.replace(/[.]/g, '').toUpperCase(), 1.9, { curveSegments: 8 }));
      const ws = geos.map((g) => g.boundingBox!.max.x - g.boundingBox!.min.x);
      const gap = 0.6, total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
      let x = -total / 2;
      row.forEach((wi, k) => {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geos[k]!, mat);
        mesh.rotation.y = Math.PI / 2;
        mesh.position.set(ST.x1 + 0.35, FLOOR_Y + (ri ? 2.5 : 4.75), -5.6 - (x + ws[k]! / 2));
        x += ws[k]! + gap;
        this.hereGo.push({ mesh, mat, t0: p4.words[wi]!.start });
        S.add(mesh);
      });
    });
  }

  // -------------------------------------------------------------------------------------------------- paths

  /** The run out: door, platform, down the stair, into the avenue (car-local; y = height above the car floor). */
  private buildPath(p: P, r: number) {
    const T = this.T;
    const lane = [0, 1, -1][r % 3]!;
    const lz = -6.5 + 0.72 * lane;
    const street = p.hero ? (p.s.id === 'HE' ? -8.3 : -7.5) : -6.5 + [0.0, -2.2, 1.6, -3.6, 0.9, -1.2, -4.6, 2.2, -2.9, -0.4][r]!;
    const pts: THREE.Vector3[] = [
      p.home.clone(),
      V3(4.6 + 0.18 * lane, 0, -0.85),
      V3(4.6 + 0.25 * lane, 0, -2.3),
      V3(6.0, 0, lz + 0.6),
      V3(6.8, 0, lz),
      V3(STAIR_FOOT + 0.4, -FLOOR_Y, lz),
      V3(STAIR_FOOT + 7, -FLOOR_Y, lerp(lz, street, 0.6)),
      V3(160, -FLOOR_Y, street),
    ];
    const hero = p.hero;
    const speed = [3.2, 3.6, 4.0, 4.0, 3.7, hero ? 5.4 : 4.1, hero ? 6.2 : 4.1];
    // arrival at the door spaced out in exit order
    const dDoor = Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.z - pts[0]!.z);
    const arrive = T.cF + 0.25 + 0.27 * r;
    p.tRun = Math.max(p.tUp + (p.seated ? 1.25 : 0.6), arrive - dDoor / speed[0]! - 0.25);
    const ts = [p.tRun];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!;
      ts.push(ts[i - 1]! + Math.max(0.05, Math.hypot(b.x - a.x, b.z - a.z) / speed[i - 1]!));
    }
    p.path = { t: ts, p: pts };
  }

  /** Position on the run at song time t (car-local), the start eased in and the corners rounded. */
  private runPos(p: P, t: number, out = new THREE.Vector3()) {
    const at = (tt: number, o: THREE.Vector3) => {
      const { t: ts, p: ps } = p.path;
      let u = tt - p.tRun;
      u = u < 0 ? 0 : u < 0.5 ? (u * u) / 1.0 : u - 0.25;
      const x = p.tRun + u;
      let i = 0;
      while (i < ts.length - 2 && ts[i + 1]! < x) i++;
      const k = clamp((x - ts[i]!) / Math.max(1e-3, ts[i + 1]! - ts[i]!));
      return o.copy(ps[i]!).lerp(ps[i + 1]!, k);
    };
    const a = at(t - 0.16, new THREE.Vector3()), b = at(t, new THREE.Vector3()), c = at(t + 0.16, new THREE.Vector3());
    out.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    out.y = b.y;
    return out;
  }

  // -------------------------------------------------------------------------------------------------- camera

  private carPos(t: number) { return V3(this.ride.x(t), FLOOR_Y, 0); }

  private shotA(t: number): Shot {
    const k = ease.inOutQuad(prog(t, this.ctx.start - 0.2, this.T.cB));
    return { pos: V3(-2.0, 1.3, 1.0).lerp(V3(-2.12, 1.34, 0.5), k), tgt: V3(-2.17, 1.46, -1.44), fov: 42, roll: 0.004, local: true };
  }
  private shotB(t: number): Shot {
    const k = ease.inOutQuad(prog(t, this.T.cB, this.T.cC));
    return { pos: V3(1.2, 1.5, -0.02).lerp(V3(2.05, 1.5, -0.04), k), tgt: V3(8.95, 1.88, 0.1), fov: 31, roll: -0.006, local: true };
  }
  shotC(t: number): Shot {
    const k = ease.inOutQuad(prog(t, this.T.cC, this.T.cD));
    return { pos: V3(-1.05, 1.16, -0.62).lerp(V3(-0.92, 1.2, -0.45), k), tgt: V3(0.32, 1.8, 1.44), fov: 52, roll: 0.0, local: true };
  }
  private shotD(t: number): Shot {
    const k = ease.inOutQuad(prog(t, this.T.cD, this.T.cE));
    return { pos: V3(-4.55, 1.86, 0.45).lerp(V3(-4.1, 1.8, 0.35), k), tgt: V3(3.0, 1.2, -0.15), fov: 54, roll: -0.01, local: true };
  }
  private shotE(t: number): Shot {
    const k = ease.inOutQuad(prog(t, this.T.cE, this.T.cF));
    return { pos: V3(4.55, 1.05, 1.2).lerp(V3(4.55, 1.08, 0.95), k), tgt: V3(4.6, 2.05, -6.0), fov: 50, roll: 0.0, local: true };
  }
  private shotF(t: number): Shot {
    const T = this.T, k = ease.inOutQuad(prog(t, T.cF, T.cG));
    // low on the platform by the doors, the neon wall ahead; panning right after the runners; whip at the end
    const pos = V3(3.0, FLOOR_Y + 0.75, -2.15).lerp(V3(3.6, FLOOR_Y + 0.8, -2.3), k);
    const tgt = V3(4.6, FLOOR_Y + 2.0, ST.zWall).lerp(V3(6.6, FLOOR_Y + 1.6, ST.zWall), k);
    const w = ease.inQuad(prog(t, T.cG - 0.24, T.cG));
    const yaw = -1.2 * w;
    const d = tgt.clone().sub(pos).applyAxisAngle(UP, yaw);
    d.y -= 4 * w;
    return { pos, tgt: pos.clone().add(d), fov: 52, roll: -0.15 * w, local: false };
  }
  private shotG(t: number): Shot {
    const T = this.T, k = ease.inOutCubic(prog(t, T.cG, T.cH));
    const pos = V3(25.5, 8.4, -6.6).lerp(V3(24.6, 2.0, -6.5), k);
    const tgt = V3(8, 7.6, -6.5).lerp(V3(10, 5.6, -6.5), k);
    // landing from the whip
    const w = 1 - ease.outCubic(prog(t, T.cG, T.cG + 0.3));
    const d = tgt.clone().sub(pos).applyAxisAngle(UP, 0.9 * w);
    d.y += 3 * w;
    return { pos, tgt: pos.clone().add(d), fov: 52, roll: 0.12 * w, local: false };
  }
  shotH(t: number): Shot {
    const T = this.T, k = ease.inOutQuad(prog(t, T.cH, T.cI));
    const up = ease.inOutCubic(prog(t, T.gold - 0.1, T.cI));
    const pos = V3(45, 19, -15.5).lerp(V3(42, 17.5, -15), k);
    pos.y += 3 * up;
    const tgt = V3(28.5, 0, -6.5).add(V3(-4, 6.5, 2).multiplyScalar(up));
    return { pos, tgt, fov: 50, roll: 0.0, local: false };
  }
  private shotI(t: number): Shot {
    const T = this.T, k = ease.inOutQuad(prog(t, T.cI, this.ctx.end + 0.2));
    const pos = V3(38, 1.25, -9.4).lerp(V3(50, 1.5, -9.0), k);
    const tgt = V3(20, 9.4, -6.2).lerp(V3(24, 10.0, -6.2), k);
    return { pos, tgt, fov: 54, roll: 0.02, local: false };
  }

  /** The shot at t, in world coordinates. */
  camAt(t: number): Shot & { id: string } {
    const T = this.T;
    let s: Shot, id: string;
    if (t < T.cB!) { s = this.shotA(t); id = 'A'; }
    else if (t < T.cC!) { s = this.shotB(t); id = 'B'; }
    else if (t < T.cD!) { s = this.shotC(t); id = 'C'; }
    else if (t < T.cE!) { s = this.shotD(t); id = 'D'; }
    else if (t < T.cF!) { s = this.shotE(t); id = 'E'; }
    else if (t < T.cG!) { s = this.shotF(t); id = 'F'; }
    else if (t < T.cH!) { s = this.shotG(t); id = 'G'; }
    else if (t < T.cI!) { s = this.shotH(t); id = 'H'; }
    else { s = this.shotI(t); id = 'I'; }
    if (s.local) { const c = this.carPos(t); s.pos.add(c); s.tgt.add(c); }
    // handheld, and the ride's rumble while moving
    const v = this.ride.v(t) / 15;
    s.pos.x += noise1(t * 0.4, 3) * 0.02;
    s.pos.y += noise1(t * 0.35, 5) * 0.015 + noise1(t * 9, 7) * 0.004 * v;
    s.tgt.x += noise1(t * 0.45, 11) * 0.03;
    s.tgt.y += noise1(t * 0.38, 12) * 0.025 + noise1(t * 7, 13) * 0.01 * v;
    s.roll += noise1(t * 6, 17) * 0.003 * v;
    return { ...s, id };
  }

  // -------------------------------------------------------------------------------------------------- people

  private posePerson(p: P, t: number, beat: number) {
    const T = this.T, f = p.fig, s = p.s;
    const yaw0 = playCues(f, p.cues, t);
    // where and which way
    let pos = p.home.clone(), yaw = p.homeYaw;
    if (t > p.tRun) {
      pos = this.runPos(p, t);
      const a = this.runPos(p, t - 0.1), b = this.runPos(p, t + 0.1);
      const dir = b.sub(a);
      const ry = dir.lengthSq() > 1e-6 ? Math.atan2(dir.x, dir.z) : p.homeYaw;
      yaw = lerpAngle(p.homeYaw, ry, ease.inOutQuad(prog(t, p.tRun, p.tRun + 0.45)));
    } else if (t > p.tUp + 0.8 && !p.seated) {
      // standing people turn toward the doors a little as the others get up
      yaw = lerpAngle(p.homeYaw, -2.4, 0.25 * ease.inOutQuad(prog(t, p.tUp + 0.8, p.tRun)));
    }
    f.position.set(pos.x, f.hipHeight + pos.y + (p.s.dy ?? 0), pos.z);
    f.rotation.set(0, yaw - yaw0, 0);
    f.updateMatrixWorld(true);
    // overrides
    const lit = ease.inOutCubic(prog(t, p.tLight, p.tLight + 0.4));
    // she looks up from her phone at the window — at him, in the glass
    const look = s.id === 'SHE' ? ease.inOutCubic(prog(t, T.nights - 0.2, T.nights + 0.7)) : 0;
    const phoneK = p.phone || s.extra === 'shareB' ? (1 - ease.inOutCubic(prog(t, p.tLight + 0.1, p.tLight + 0.8))) * (t < p.tUp ? 1 : 0) * (1 - 0.65 * look) : 0;
    let nod = 0, tilt = 0, lean = 0;
    if (p.phone || s.extra === 'shareB') nod = 0.38 * phoneK;
    if (s.id === 'SHE') nod = lerp(0.38, -0.1, look) * (1 - lit) - 0.08 * lit;
    if (s.extra === 'sleep' && t < p.tLight) {
      const P = 3.6, u = (((t + p.s.off * 2) % P) + P) % P / P;
      nod = 0.12 + 0.5 * smoothstep(0, 0.88, u) * (1 - smoothstep(0.9, 0.97, u));
      tilt = 0.18 * smoothstep(0, 0.88, u) * (1 - smoothstep(0.9, 0.97, u));
    }
    if (s.extra === 'shareB') { lean = 0.22 * phoneK; tilt = 0.25 * phoneK; }
    if (s.extra === 'shareA') { lean = -0.08 * phoneK; tilt = -0.12 * phoneK; }
    if (lit > 0 && t < p.tUp) nod -= 0.12 * lit; // chins up
    if (Math.abs(nod) + Math.abs(tilt) + Math.abs(lean) > 1e-3) f.setSpine(0, lean, nod, tilt);
    const fd = facingDir(f), side = V3(fd.z, 0, -fd.x); // side: the figure's left (+x)
    const head = f.headPoint();
    const raise = ease.inOutCubic(prog(t, p.tRaise, p.tRaise + 0.45));
    const pump = t > p.tRun ? 0.07 * Math.sin((beat + p.seed * 0.13) * Math.PI) : 0.04 * Math.sin((beat + p.seed * 0.13) * Math.PI);
    // the phone in one hand (or shared: FR1 holds it out between them)
    let phonePos: THREE.Vector3 | null = null;
    const hand = s.phone ?? 0;
    if (p.phone && phoneK > 0.001) {
      const share = s.extra === 'shareA';
      const tgt = head.clone().addScaledVector(fd, share ? 0.3 : 0.27).addScaledVector(UP, p.seated ? -0.36 : -0.3).addScaledVector(side, share ? -0.17 : (hand ? 0.05 : -0.05));
      tgt.x += 0.01 * noise1(t * 0.7 + p.seed, 2); tgt.y += 0.01 * noise1(t * 0.6 + p.seed, 3);
      blendReach(f, hand, tgt, phoneK * (1 - raise), fd.clone().multiplyScalar(-0.3).addScaledVector(side, hand ? 1 : -1).addScaledVector(UP, -1));
      f.setHand(hand, 0.55);
    }
    // hands on the strap / the pole
    if ((s.extra === 'strap' || s.extra === 'pole') && t < p.tUp + 0.6) {
      const hk = 1 - ease.inOutCubic(prog(t, p.tUp, p.tUp + 0.6));
      const i = s.hold ?? 0;
      const tgt = s.extra === 'pole' ? this.car.localToWorld(V3(p.home.x < 4.6 ? 3.84 : 5.36, 1.42, -0.93)) : this.car.strapHandle(p.strap);
      blendReach(f, i, tgt, hk, side.clone().multiplyScalar(i ? 1 : -1).addScaledVector(UP, -0.6).addScaledVector(fd, -0.4));
      f.setHand(i, 0.75);
    }
    // hands up
    if (raise > 0) for (const i of [0, 1]) {
      const sg = i ? 1 : -1;
      const tgt = head.clone().addScaledVector(UP, 0.4 + pump * (i ? 1 : -1)).addScaledVector(side, sg * 0.26).addScaledVector(fd, 0.08);
      blendReach(f, i, tgt, raise * (t > p.tRun ? 0.92 : 1), side.clone().multiplyScalar(sg).addScaledVector(UP, -0.3).addScaledVector(fd, -0.5));
      f.setHand(i, 0.15);
    }
    f.time = t;
    // the phone itself
    if (p.phone) {
      const shown = t < p.tUp;
      p.phone.visible = shown;
      if (shown) {
        const hp = f.hand(hand);
        const faceAt = s.extra === 'shareA' ? head.clone().lerp(this.byId.get('FR2')!.fig.headPoint(), 0.5) : head;
        phonePos = p.phone.hold(hp, faceAt, phoneK, t, p.seed).clone();
      }
    }
    // material
    const u = p.mat.uniforms;
    if (p.hero) {
      u.level!.value = lerp(0.3, 1.1, lit) * (1 + 2.2 * pulse(t, p.tLight, 0.14)) * (1 + 0.15 * pulse(t, T.here1, 0.2) + 0.15 * pulse(t, T.here2, 0.2));
    } else {
      u.lit!.value = lit;
      u.level!.value = (1 + 2.6 * pulse(t, p.tLight, 0.13)) * (lit > 0 ? 1 : 0.95);
      u.time!.value = t;
      const pp = phonePos ?? (s.extra === 'shareB' ? this.byId.get('FR1')!.phone!.position : null);
      if (pp && phoneK > 0) (u.phone!.value as THREE.Vector4).set(pp.x, pp.y, pp.z, 1.3 * phoneK);
      else (u.phone!.value as THREE.Vector4).w = 0;
      for (const o of p.prepass) o.visible = lit > 0.5;
    }
    if (p.phones) p.phones.follow();
    return { lit, phonePos, phoneK };
  }

  // -------------------------------------------------------------------------------------------------- render

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T, U = this.U, cam = this.st.cam;
    U.uTime.value = t;
    // ---- the ride
    const cx = this.ride.x(t);
    this.car.position.set(cx, FLOOR_Y, 0);
    this.car.updateWorldMatrix(true, false);
    U.uCarX.value = cx;
    // doors (the -z pair by the stair) open on "Put"
    const dk = ease.inOutCubic(prog(t, T.doors, T.doors + 0.45));
    this.car.doorOpen[1] = dk;
    this.car.doorOpen[0] = ease.inOutCubic(prog(t, T.doors + 0.04, T.doors + 0.5));
    // the ceiling lights: on; at the gap in the rails they stutter and die
    const fi = frameIdx(t);
    for (let i = 0; i < 10; i++) {
      let l = 1;
      if (t > T.gap0) {
        const g = prog(t, T.gap0, T.gap1);
        const on = hash(Math.floor(fi / 3), i, 5) > 0.25 + 0.75 * g;
        l = t > T.gap1 ? 0 : on ? 0.6 + 0.4 * hash(fi, i) : 0.04;
      }
      this.car.fixLevel[i] = l;
    }
    (U.uFix.value as number[]).splice(0, 10, ...this.car.fixLevel);
    this.car.update(t, this.ride.acc(t), this.ride.v(t));
    const ceil = this.car.fixLevel.reduce((a, b) => a + b, 0) / 10;

    // ---- camera
    const shot = this.camAt(t);
    cam.fov = shot.fov;
    cam.updateProjectionMatrix();
    aim(cam, shot.pos, shot.tgt, shot.roll);

    // ---- the moon: swallowed by the tower (seen from the reflection shot), then gone
    const moonK = t < T.cD ? 1 : 0;
    const moonLight = (1 - prog(t, T.swallow + 0.1, T.moon + 0.15)) * moonK;
    U.uMoonC.value.setRGB(0.3, 0.33, 0.45).multiplyScalar(0.12 * moonLight);
    const street = shot.id === 'G' || shot.id === 'H' || shot.id === 'I';
    this.out.city.mirrorOn = street;
    this.out.update(t, cam, moonK, street);

    // ---- people
    const beat = this.ctx.audio.beatAt(t);
    const lights: Train['lights'] = [];
    const states = new Map<P, ReturnType<Train['posePerson']>>();
    // FR1 before FR2 (the shared phone), the heroes before their twins
    for (const p of this.people) states.set(p, this.posePerson(p, t, beat));
    for (const p of this.people) {
      const s = states.get(p)!;
      if (s.phonePos && s.phoneK > 0.02) lights.push({ p: s.phonePos, r: 0.22, c: PHONE_C, k: 0.5 * s.phoneK });
      const glow = p.hero ? 0.25 + 0.75 * s.lit : s.lit;
      if (glow > 0.01) lights.push({ p: p.fig.spinePoint(0, 0.25, 0.1), r: 0.75, c: p.glowC, k: 0.55 * glow * (1 + 2 * pulse(t, p.tLight, 0.15)) });
    }
    // his star in his hand, her lantern in hers
    const he = this.byId.get('HE')!.fig, she = this.byId.get('SHE')!.fig;
    holdIn(he, 1, this.star, 0.0);
    this.star.level = 0.28 + 0.9 * ease.inOutCubic(prog(t, T.light, T.light + 0.5)) + 0.6 * pulse(t, T.light, 0.2);
    holdIn(she, 1, this.lantern, 0.24);
    this.lantern.lit = 0;
    this.lantern.time = t;
    this.lantern.update();
    // reflections: twins copy the pose
    const showMirror = t > T.cB - 0.5 && t < T.cE;
    this.mirror.visible = showMirror;
    if (showMirror) {
      for (const tw of this.twins) {
        copyPose(tw.src.fig, tw.fig);
        tw.fig.position.copy(tw.src.fig.position);
        tw.fig.quaternion.copy(tw.src.fig.quaternion);
        tw.fig.mat.uniforms.level!.value = (tw.src.mat.uniforms.level!.value as number) * 0.2;
        tw.fig.time = t;
      }
      let mp = 0;
      for (const p of this.people) {
        const s = states.get(p)!;
        if (!s.phonePos || s.phoneK < 0.02 || p.home.z > 0) continue;
        const lp = this.car.worldToLocal(s.phonePos.clone());
        this.mirrorPts.set(mp++, lp.x, lp.y, lp.z, PHONE_C, 0.5 * s.phoneK, 2.5);
      }
      this.mirrorPts.commit(mp);
    }
    // the lamps outside sweep through the car; the station's lights come on with the chain of people
    if (cx < ST.x0 + 6) for (const lp of this.out.nearLamps(cam.position.x, 4)) lights.push({ p: lp, r: -2.8, c: new THREE.Color(1.0, 0.6, 0.3), k: 2.4 });
    const chainEnd = Math.max(...this.people.map((p) => p.tLight));
    for (let i = 0; i < this.station.lightsOn.length; i++) {
      const t0 = lerp(T.light + 0.25, chainEnd + 0.15, i / (this.station.lightsOn.length - 1));
      this.station.lightsOn[i] = Math.min(1, flickerOn(t, t0, i * 3 + 2));
    }
    this.station.update();
    this.station.lampPos.forEach((lp, i) => lights.push({ p: lp, r: -3.0, c: new THREE.Color(0.8, 0.88, 1.0), k: 0.6 * this.station.lightsOn[i]! }));
    // the wall's neon throws pink on the tiles and the people
    const nOn = L4lit(this.L.p1!, t);
    if (nOn > 0) lights.push({ p: V3(4.6, FLOOR_Y + 1.7, ST.zWall + 0.9), r: -2.6, c: col('pink', 1), k: 0.35 * nOn });
    // the display
    const dispOn = t > T.cB - 0.6 && t < T.cC + 0.2;
    if (dispOn) lights.push({ p: this.car.localToWorld(V3(8.6, 2.0, 0)), r: 0.6, c: new THREE.Color(1.0, 0.45, 0.1), k: 0.6 });
    this.applyLights(lights, cam.position);
    U.uCeilC.value.setRGB(0.5, 0.56, 0.7).multiplyScalar(0.2);
    U.uAmb.value.setRGB(0.004, 0.005, 0.009).multiplyScalar(1 + 2 * ceil);

    // ---- glass: rain, the city's light on it
    const gu = this.car.glass.uniforms;
    gu.uSpeed!.value = this.ride.v(t);
    gu.uOut!.value.setRGB(0.55, 0.45, 0.38).multiplyScalar(0.8);

    // ---- lyrics
    this.poseLyrics(t, ceil);

    this.st.render(this.ctx.renderer, out);
    const flash = 0.04 * pulse(t, T.light, 0.1) + 0.05 * pulse(t, T.gold, 0.15);
    const db = this.bars.reduce((a, d) => a + pulse(t, d, 0.16), 0);
    const punch = this.L.p4!.words.reduce((z, w) => z + 0.012 * pulse(t, w.start, 0.09), 0);
    return {
      bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.05, ca: 0.8,
      flash, zoom: 1 + (t > T.cE ? 0.006 * db : 0) + punch,
    };
  }

  private applyLights(ls: Train['lights'], camPos: THREE.Vector3) {
    const scored = ls.filter((l) => l.k > 0.005).map((l) => ({ l, s: l.k * Math.abs(l.r) / (1 + l.p.distanceToSquared(camPos) / 60) })).sort((a, b) => b.s - a.s).slice(0, MAXL);
    const P = this.U.uPts.value, C = this.U.uPtC.value;
    for (let i = 0; i < MAXL; i++) {
      const e = scored[i];
      if (!e) { P[i]!.set(0, -1e4, 0, 0.01); C[i]!.set(0, 0, 0); continue; }
      P[i]!.set(e.l.p.x, e.l.p.y, e.l.p.z, e.l.r);
      C[i]!.set(e.l.c.r * e.l.k, e.l.c.g * e.l.k, e.l.c.b * e.l.k);
    }
  }

  private poseLyrics(t: number, ceil: number) {
    const T = this.T, L = this.L;
    // L1: the finger in the fog
    this.fogW.visible = t < T.cC;
    this.fogW.update(t, 0.2 + 0.8 * ceil);
    // L2: the display
    this.display.visible = t < T.cD;
    const l2 = L.l2!;
    this.display.page = t < l2.words[0]!.start ? 0 : t < l2.words[4]!.start ? 1 : 2;
    this.display.lv.fill(0);
    this.display.lv[15] = this.display.page === 0 ? 1 : 0;
    l2.words.forEach((w, i) => (this.display.lv[i + 1] = flickerOn(t, w.start, i + 3)));
    this.display.sync();
    // L3: the line map
    const l3 = L.l3!, lv = this.lineMap.material.uniforms.uLv!.value as Float32Array;
    l3.words.forEach((w, i) => (lv[i] = flickerOn(t, w.start, i + 11) * (1 - 0.85 * prog(t, T.gap0 + 0.15, T.gap1))));
    const stopOf = [0, 1, 1, 2, 3, 4, 4];
    let here = -1;
    l3.words.forEach((w, i) => { if (t >= w.start) here = stopOf[i]!; });
    const mu = this.lineMap.material.uniforms;
    mu.uHere!.value = here >= 0 ? this.lineMap.stopsU[here]! : -1;
    mu.uTime!.value = t;
    mu.uPrint!.value = 0.35 + 0.65 * ceil;
    this.lineMap.visible = t < T.cD + 0.2;
    // L4: the small lights
    const l4 = L.l4!;
    this.moteGrp.visible = t > l4.start - 0.1 && t < T.cE;
    this.motes.update(t, new THREE.Color(0.75, 0.82, 1.0).multiplyScalar(1.6), 1.0, new THREE.Color(1.0, 0.8, 0.55).multiplyScalar(2.0), prog(t, T.light, T.light + 0.6));
    // P1: the neon wall
    singHidden(this.wallNeon, t, 1.0);
    // P2: the risers
    const rl = this.station.riserMat.uniforms.uLv!.value as Float32Array;
    L.p2!.words.forEach((w, i) => (rl[i] = flickerOn(t, w.start, i + 21) * (1 + 0.4 * pulse(t, w.start, 0.15)) * (1 - prog(t, T.cH + 0.3, T.cH + 1.1))));
    // P3: the asphalt neon, turning gold on "gold"
    const gk = ease.inOutCubic(prog(t, T.gold - 0.05, T.gold + 0.5));
    this.roadNeon.setColor(col('violet', 2.0).lerp(col('blue', 2.0), 0.3).lerp(col('gold', 2.4), gk));
    singHidden(this.roadNeon, t, 1 + 0.6 * pulse(t, T.gold, 0.2));
    this.out.city.gold = gk > 0 ? 0.9 : 0;
    this.out.city.goldWave(V3(STAIR_FOOT, 0, -6.5).sub(this.out.city.position), gk > 0 ? lerp(0, 2600, ease.outQuad(prog(t, T.gold - 0.05, T.gold + 1.5))) : 1e9);
    // P4: HERE WE GO
    for (const h of this.hereGo) {
      const on = flickerOn(t, h.t0, 5);
      h.mesh.visible = t >= h.t0 - 0.005;
      h.mesh.scale.setScalar(1 + 0.25 * pulse(t, h.t0, 0.08));
      h.mat.color.copy(col('white', 2.4).lerp(col('gold', 2.4), 0.45 * gk)).multiplyScalar(on);
    }
    void subLine;
  }
}

/** How much of a line is lit (0..1, by words sung). */
function L4lit(l: Line, t: number) { return l.words.filter((w) => t >= w.start).length / l.words.length; }

/** Neon karaoke where a word not yet sung is not there at all (dark tubes would read on a lit wall). */
function singHidden(n: NeonLine, t: number, gain: number) {
  n.sing(t, gain);
  for (const { sign, ids } of n.rows) ids.forEach((wi, k) => { const w = sign.words[k]; if (w) w.mesh.visible = t >= n.line.words[wi]!.start - 0.005; });
}

/** Copy the bones' local pose of one figure onto another of the same body kind. */
function copyPose(src: RealFigure, dst: RealFigure) {
  src.updateMatrixWorld(true);
  const D = dst.boneMap;
  for (const [n, b] of src.boneMap) { const d = D.get(n); if (d) { d.quaternion.copy(b.quaternion); d.position.copy(b.position); } }
}
