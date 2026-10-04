// Verse 1, "Night drive": a fast drive on a wet night highway. The city lives on fake light, and tonight it
// runs out: a blackout spreads behind him and catches up on the last beat. One continuous world
// (highway-road.ts, highway-env.ts, highway-life.ts) seen through cuts on the beat; within a shot every move
// eases (no lunges, no whips):
//   A  dive    the camera tilts down out of the night sky onto the highway; a drone chases low over the lanes
//              and "WE WERE RUNNING ON AN EMPTY TANK" is painted across them, word by word as it is sung;
//              traffic, a truck's marker lights, an overpass ahead with a car crossing it, rain in the lamps
//   B  gauge   (downbeat) macro on the fuel gauge: the needle sinks to E, the low-fuel lamp blinks
//   C  boards  low POV: calendar billboards (MONDAY, TUESDAY, WEDNESDAY), the camera pans from one to the
//              next, the words brush-painted on in glowing paint, a smile on each day; moths at the floods
//   D  mirror  inside the car: rain and wipers, HIS hands of light on the wheel (the cyan on the dash is his),
//              in the rear-view mirror the city behind goes dark block by block; far ahead through the glass a
//              sunrise comes up, "NOW THE SUN'S" in it — it is a giant LED billboard over the road
//   E  sun     (cut on "coming") from the roof: the painted sun rises, the words fly out onto an arc; on
//              "sank" the screen glitches (tearing, scanlines, a dead block) and dies module by module: the
//              sky behind it is still night
//   F  station the approach: an overhead sign spells AND I'D PAY, the services beyond
//   G  pylon   the price pylon spells it too, its drums land on ANY / COST
//   H  dark    (downbeat) inside again: the blackout catches up — the lamps die past us, the pylon's numbers
//              flicker out, the canopy and the city on the horizon go dark, the engine stalls and the dash dies.
//              The last frames are dark: only his hands glow, cool and faint, on the wheel.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, frameIdx, hash, keys, lerp, noise1, prog, pulse, smoothstep, springStep, type Key } from '../../engine/util';
import { HU, ROAD, litMat } from './highway-common';
import { bakeTextures, type HwTextures } from './highway-tex';
import { CITY, City, Landscape, Sky } from './highway-env';
import { Furniture, Gantry, NWORDS, Reflection, RoadSurface, Streetlights, Traffic, wordAtlas } from './highway-road';
import { Gauge } from './highway-gauge';
import { CalendarBoard } from './highway-boards';
import { Station, VmsGantry } from './highway-station';
import { makeRT } from '../../engine/gl';
import { LensFlare } from './highway-flare';
import { GiantScreen, SCR, SCREEN_HORIZON, ScreenPicture } from './highway-screen';
import { Cabin, CU, WIPER } from './highway-cabin';
import { Bridge, Moths, PowerLine, Rain, RoadSigns, Steam, type MothSource } from './highway-life';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const DEG = Math.PI / 180;

type Shot = 'dive' | 'gauge' | 'boards' | 'mirror' | 'sun' | 'station' | 'pylon' | 'dark';
interface Cam { pos: THREE.Vector3; yaw: number; pitch: number; roll: number; fov: number }
interface WordRow { words: number[]; u: number; len: number }
/** The eye inside the car: offset from the car's centre (x) and height. */
const EYE = { dx: -0.37, y: 1.2 };

export default class Highway extends Scene {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 12000);
  backCam = new THREE.PerspectiveCamera(12, 3.75, 0.5, 12000);
  tex!: HwTextures;
  sky!: Sky;
  city!: City;
  cityBack!: City;
  road!: RoadSurface;
  refl!: Reflection;
  furn!: Furniture;
  lamps!: Streetlights;
  gantries: Gantry[] = [];
  gantryU: number[] = [];
  traffic!: Traffic;
  land!: Landscape;
  noRefl: THREE.Object3D[] = [];
  gauge!: Gauge;
  boards: { b: CalendarBoard; u: number; x: number; side: number; focus: [number, number] }[] = [];
  station!: Station;
  stationU = 0;
  vms!: VmsGantry;
  vmsU = 0;
  pic!: ScreenPicture;
  screen!: GiantScreen;
  scrU = 0;
  cabin!: Cabin;
  mirrorRT = makeRT(768, 205);
  flare = new LensFlare();
  backRefl = new Reflection(320, 180);
  rain = new Rain();
  steam = new Steam();
  moths = new Moths();
  power!: PowerLine;
  bridge!: Bridge;
  bridgeU = 0;
  signs!: RoadSigns;

  L: Line[] = [];
  S0 = 0; S1 = 0; W0 = 0; W1 = 0; lab = false;
  T = { gauge: 0, l1: 0, l2: 0, sun: 0, sank: 0, dead: 0, l3: 0, pylon: 0, out: 0, stall: 0 };
  downs: number[] = [];
  beats: number[] = [];
  rows: WordRow[] = [];
  slots: { rect: THREE.Vector4; atlas: THREE.Vector4; word: number }[] = [];
  wipes: number[] = [];
  // travel table
  private tT0 = 0; private tDT = 1 / 500; private sTab = new Float32Array(0);
  private vDrone = 34;
  private vKeys: Key[] = [];

  override async init() {
    const { renderer, lyrics, audio } = this.ctx;
    // ---- timing
    this.lab = this.ctx.id === 'lab';
    const sec = (n: string) => audio.sections.find((s) => s.name === n)!.start;
    this.L = [lyrics.get('We were running'), lyrics.get('Painting smiles'), lyrics.get('Now the sun'), lyrics.get('And I’d pay')];
    const [L0, L1, L2, L3] = this.L as [Line, Line, Line, Line];
    const beatBefore = (t: number) => audio.timeOfBeat(Math.floor(audio.beatAt(t + 0.03)));
    const beatAfter = (t: number) => audio.timeOfBeat(Math.ceil(audio.beatAt(t - 0.03)));
    const nearestBeat = (t: number) => audio.timeOfBeat(Math.round(audio.beatAt(t)));
    this.S0 = this.lab ? beatBefore(L0.start) : this.ctx.start;
    this.S1 = this.lab ? beatBefore(lyrics.get('Put your hands up').start) : this.ctx.end;
    void sec;
    this.W0 = this.S0 - 0.25; this.W1 = this.S1 + 0.3;
    this.downs = audio.downbeats.filter((d) => d > this.W0 && d < this.W1 + 0.5);
    this.beats = [];
    for (let b = Math.floor(audio.beatAt(this.W0)); audio.timeOfBeat(b) < this.W1 + 0.5; b++) this.beats.push(audio.timeOfBeat(b));
    const nextDown = (t: number) => this.downs.find((d) => d > t) ?? t + 1;
    const T = this.T;
    T.gauge = nextDown(L0.words[6]!.start + 0.2);
    T.l1 = beatBefore(L1.start);
    T.l2 = beatBefore(L2.start);
    T.sun = nearestBeat(L2.words[3]!.start);
    T.sank = L2.words[7]!.start;
    T.l3 = beatBefore(L3.start);
    T.dead = T.l3 - 0.14; // (the screen is dead a moment before the cut: night all around it)
    T.pylon = nextDown(L3.words[2]!.start - 0.1);
    T.out = Math.min(this.downs.find((x) => x > L3.words[4]!.start + 0.2) ?? this.S1 - 0.4, this.S1 - 0.3);
    T.stall = T.out + 0.05;

    // ---- the drive: speed and lane keys (eased between keys: no sudden changes)
    this.buildKeys();

    // ---- world
    this.tex = bakeTextures(renderer);
    this.sky = new Sky(this.tex.clouds);
    this.city = new City({ x: CITY.x, z: CITY.z, seed: 4242, hills: true, facing: 0 });
    // the city we left behind (seen in the mirror): the blackout runs through it toward us
    this.cityBack = new City({ x: 160, z: 1350, seed: 777, n: 340, core: 0.8, spread: 0.55, facing: Math.PI * 0.5, lit: 2.2 });
    this.refl = new Reflection();
    const atlasWords = L0.words.map((w) => w.w);
    const atlas = wordAtlas(atlasWords);
    this.road = new RoadSurface(this.tex, this.refl, atlas.tex);
    this.furn = new Furniture(this.tex);
    this.lamps = new Streetlights();
    const steel = litMat({ color: C('#7d858f', 0.32), rough: 0.55, metal: 0.6, spec: 0.7, grime: 0.6 });
    this.gantries = [
      new Gantry([{ text: 'City Centre', sub: 'Harbour', arrow: 'up' }, { text: 'Airport', sub: 'Exit 24', arrow: 'right', exit: '24' }], steel),
      new Gantry([{ text: 'Riverside', sub: 'Old Town', arrow: 'up' }, { text: 'Services', sub: 'Exit 26', arrow: 'right', exit: '26' }], steel),
    ];
    this.land = new Landscape();
    this.scene.add(this.sky, this.city, this.cityBack, this.road, this.furn, this.lamps, this.land, ...this.gantries);
    this.scene.add(this.cam);
    HU.uLampCol.value.copy(C('#ff9a3c', 115));

    // ---- travel (the car), then everything placed along it
    this.buildTravel();
    this.buildRows(atlas.slots);
    this.gantryU = [this.sAt(T.gauge) + 30, this.sAt(T.l2) + 25];

    this.gauge = new Gauge();

    // calendar billboards
    const w1 = L1.words;
    const specs = [
      { day: 'MONDAY', date: '13', words: [[0], [1]], smile: w1[1]!, side: 1, focus: [T.l1, nearestBeat(w1[2]!.start)] as [number, number], D: 40 },
      { day: 'TUESDAY', date: '14', words: [[2, 3], [4, 5]], smile: w1[4]!, side: -1, focus: [nearestBeat(w1[2]!.start), nearestBeat(w1[6]!.start)] as [number, number], D: 33 },
      { day: 'WEDNESDAY', date: '15', words: [[6, 7]], smile: w1[7]!, side: 1, focus: [nearestBeat(w1[6]!.start), T.l2 + 0.3] as [number, number], D: 44 },
    ];
    specs.forEach((s, i) => {
      const lines = s.words.map((row) => row.map((wi) => ({ text: w1[wi]!.w, t0: w1[wi]!.start, t1: Math.min(w1[wi]!.end, w1[wi]!.start + 0.38) })));
      const b = new CalendarBoard({ day: s.day, date: s.date, month: 'OCTOBER', lines, smile: [s.smile.start + 0.04, s.smile.start + 0.42], seed: 11 + i * 17 });
      const first = Math.min(...lines.flat().map((w) => w.t0));
      const u = this.sAt(first) + s.D;
      const x = s.side > 0 ? 21 : -18.5;
      b.position.set(x, 0, -u);
      b.rotation.y = s.side > 0 ? -0.45 : 0.45;
      this.scene.add(b);
      this.boards.push({ b, u, x, side: s.side, focus: s.focus });
      this.land.exclude.push({ x, u, r: 26 });
    });

    // the station: the pylon by the right shoulder, ~30 m ahead of us when the blackout catches up
    this.station = new Station();
    this.stationU = this.sAt(T.out) + 30;
    this.station.position.set(18.2, 0, -this.stationU);
    this.station.rotation.y = 0.35;
    this.scene.add(this.station);
    this.land.exclude.push({ x: 45, u: this.stationU + 35, r: 60 });
    // the overhead message sign that spells the first half of the line on the approach
    this.vms = new VmsGantry('AND I’D PAY', steel);
    this.vmsU = this.stationU - 26;
    this.vms.position.z = -this.vmsU;
    this.scene.add(this.vms);

    // the giant screen over the road, far ahead when the mirror shot starts
    this.pic = new ScreenPicture(L2);
    await this.pic.build();
    this.screen = new GiantScreen(this.pic);
    this.scrU = this.sAt(T.l2) + 340;
    this.screen.position.set(0, 0, -this.scrU);
    this.scene.add(this.screen);
    this.land.exclude.push({ x: 0, u: this.scrU, r: 110 });

    // traffic: laid out once, out of our lane near us, and none left near us when it all goes dark
    this.traffic = new Traffic({
      s: (t) => this.sAt(t), x: (t) => this.carX(t), t0: this.W0, t1: this.W1,
      active: (t) => this.shotAt(t) !== 'gauge' && this.shotAt(t) !== 'pylon',
      quiet: [T.out - 0.1, this.W1],
      views: [
        ...this.boards.map((b, i) => ({
          t0: i === 0 ? T.l1 : b.focus[0] - 0.3, t1: i === 2 ? T.l2 : b.focus[1] + 0.3, eye: (t: number) => new THREE.Vector3(this.carX(t), 1.05, -this.sAt(t)),
          targets: [-5, 0, 5].map((dx) => new THREE.Vector3(b.x + dx * Math.cos(b.b.rotation.y), 6.3, -b.u + dx * Math.sin(b.b.rotation.y) * -1)),
        })),
        { t0: T.l2, t1: T.sun, eye: (t: number) => this.eyeAt(t), targets: [-50, 0, 50].map((dx) => new THREE.Vector3(dx, SCR.y0 + SCR.h * 0.56, -this.scrU)) },
        { t0: T.sun, t1: T.l3, eye: (t: number) => new THREE.Vector3(this.carX(t) + 0.25, 1.9, -this.sAt(t)), targets: [-55, 0, 55].map((dx) => new THREE.Vector3(dx, SCR.y0 + SCR.h * 0.45, -this.scrU)) },
        { t0: T.l3, t1: T.pylon, eye: (t: number) => new THREE.Vector3(this.carX(t), 1.25, -this.sAt(t)), targets: [new THREE.Vector3(6.4, 6.6, -this.vmsU)] },
      ],
    });
    this.scene.add(this.traffic);

    // living details
    this.power = new PowerLine(this.sAt(this.W0) - 300, this.sAt(this.W1) + 2600, this.scrU - 140);
    this.bridgeU = this.sAt(T.gauge) + 15; // (the drone flies under it during the gauge insert)
    this.bridge = new Bridge(this.tex.concrete);
    this.bridge.position.z = -this.bridgeU;
    this.signs = new RoadSigns([
      { u: this.sAt(19.2) + 70, x: 17.2, lines: ['Exit 24', 'Airport  1 mi'], color: '#0d5a33', w: 6.5, h: 3.2, exit: '24' },
      { u: this.sAt(T.l2) + 90, x: 17.6, lines: ['Exit 25', 'East  ½ mi'], color: '#0d5a33', w: 6, h: 3.0, exit: '25' },
      { u: this.stationU - 95, x: 17.6, lines: ['SERVICES', 'Fuel · Food · 24 h'], color: '#1d3f8f', w: 7, h: 3.4 },
    ], this.sAt(this.W0) - 50, this.sAt(this.W1) + 600);
    this.scene.add(this.rain, this.steam, this.moths, this.power, this.bridge, this.signs);
    this.land.exclude.push({ x: -50, u: this.scrU - 140, r: 30 }, { x: 0, u: this.bridgeU, r: 70 });

    // the car around his eyes, the mirror's view behind
    this.cabin = new Cabin(this.mirrorRT.texture, this.sky.u);
    await this.cabin.loadFigure();
    this.scene.add(this.cabin);
    this.backCam.layers.enableAll();
    // dark verticals smear into ghostly figures in the blurred reflection: keep them out of it
    this.noRefl = [this.lamps.poles, this.lamps.halos, this.furn.posts, ...this.gantries.map((g) => g.children[0]!), this.cabin, this.rain, this.power.wires, this.moths];
    // wipes: a sweep every ~1.25 s; in the mirror shot one ends before "Now" and the next starts after
    // "sun's" (the blades never cross the words as they are born); in the last shot the stall freezes one
    // high on the glass
    const dur = WIPER.dur, sun = L2.words[2]!.start;
    this.wipes = [];
    for (let t = T.l2 - dur * 0.5; t > this.W0 - 3; t -= 1.25) this.wipes.unshift(t);
    for (let t = sun + 0.2; t < T.stall - dur * 0.36 - 0.9; t += 1.25) this.wipes.push(t);
    this.wipes.push(T.stall - dur * 0.36);
  }

  // ------------------------------------------------------------------------------------------- travel

  private buildKeys() {
    const T = this.T;
    const vD = () => this.vDrone;
    // speed (m/s): the drone chase, cruising, a little faster toward the dawn, braking for the services,
    // and coasting when the engine dies
    this.vKeys = [
      [this.W0 - 1, vD()], [T.gauge - 0.15, vD(), ease.linear], [T.gauge + 0.35, 27],
      [T.l2 - 0.2, 27], [T.l2 + 0.6, 30.5], [T.l3 - 0.1, 30.5], [T.out - 0.05, 17], [T.stall, 16.5],
      [T.stall + 0.8, 9.5, ease.outQuad], [this.W1 + 2, 8],
    ];
  }

  /** Car speed (m/s) at t. */
  private speed(t: number) { return keys(t, this.vKeys); }

  /** Car centre x at t. */
  carX(t: number) {
    const T = this.T;
    const lx = ROAD.laneX;
    if (t < T.l1) return lx(1);
    if (t < T.l2) {
      const bTue = this.boards[1], bWed = this.boards[2];
      if (!bTue || !bWed) return lx(2);
      const toL = prog(t, bTue.focus[0] - 0.75, bTue.focus[0] + 0.45, ease.inOutCubic);
      const toM = prog(t, bWed.focus[0] - 0.55, bWed.focus[0] + 0.6, ease.inOutCubic);
      return lerp(lerp(lx(2), lx(0), toL), lx(1), toM);
    }
    if (t < T.l3) return lx(1);
    const toR = prog(t, T.l3 + 0.05, T.pylon + 0.3, ease.inOutCubic);
    const shoulder = prog(t, T.stall + 0.1, T.stall + 1.2, ease.inOutQuad);
    return lerp(lerp(lx(1), lx(2), toR), lx(2) + 1.2, shoulder);
  }

  private buildTravel() {
    this.tT0 = this.W0 - 1;
    const n = Math.ceil((this.W1 + 2 - this.tT0) / this.tDT) + 2;
    this.sTab = new Float32Array(n);
    let s = 0;
    for (let i = 1; i < n; i++) {
      const t = this.tT0 + i * this.tDT;
      s += 0.5 * (this.speed(t - this.tDT) + this.speed(t)) * this.tDT;
      this.sTab[i] = s;
    }
  }

  /** Car travel (road coordinate) at t. */
  sAt(t: number) {
    const x = (t - this.tT0) / this.tDT, n = this.sTab.length;
    if (x <= 0) return this.sTab[0]! + (t - this.tT0) * this.speed(this.tT0);
    if (x >= n - 1) return this.sTab[n - 1]! + (t - this.tT0 - (n - 1) * this.tDT) * this.speed(t);
    const i = Math.floor(x), f = x - i;
    return this.sTab[i]! * (1 - f) + this.sTab[i + 1]! * f;
  }

  /** The first line painted across the carriageway: rows of words, each painted when sung. */
  private buildRows(slots: { atlas: THREE.Vector4 }[]) {
    const ws = this.L[0]!.words;
    const groups = [[0, 1], [2], [3, 4], [5], [6]];
    const LEN = 11, PITCH = 14, DSTAR = 20;
    const tVis0 = this.W0 + 0.6;
    for (let iter = 0; iter < 6; iter++) {
      this.rows = [];
      let prev = -1e9;
      for (const g of groups) {
        const tv = Math.max(ws[g[0]!]!.start, tVis0);
        const u = Math.max(prev + PITCH, this.sAt(tv) + DSTAR);
        this.rows.push({ words: g, u, len: LEN });
        prev = u;
      }
      // speed the drone up if the line runs away from it (a late cut into the verse)
      const last = this.rows[this.rows.length - 1]!;
      const lag = last.u - (this.sAt(ws[groups[groups.length - 1]![0]!]!.start) + DSTAR);
      if (lag < 4 || this.vDrone > 52) break;
      this.vDrone += Math.min(8, lag / 1.2);
      this.buildKeys();
      this.buildTravel();
    }
    // slots: x extents per word across the carriageway (two-word rows split by letter count)
    const x0 = ROAD.inner + 0.7, x1 = ROAD.outer - 0.7;
    for (const r of this.rows) {
      const n = r.words.map((wi) => ws[wi]!.w.length);
      const gap = 0.9, total = n.reduce((a, b) => a + b, 0);
      let x = x0;
      r.words.forEach((wi, k) => {
        const w = ((x1 - x0 - gap * (n.length - 1)) * n[k]!) / total;
        this.slots.push({ rect: new THREE.Vector4(x, r.u, x + w, r.u + r.len), atlas: slots[wi]!.atlas, word: wi });
        x += w + gap;
      });
    }
    const bx = this.road.u.wBox!.value as THREE.Vector4;
    bx.set(Math.min(...this.slots.map((q) => q.rect.x)), Math.min(...this.slots.map((q) => q.rect.y)), Math.max(...this.slots.map((q) => q.rect.z)), Math.max(...this.slots.map((q) => q.rect.w)));
    this.slots.forEach((s, i) => {
      if (i >= NWORDS) return;
      (this.road.u.wRect!.value as THREE.Vector4[])[i]!.copy(s.rect);
      (this.road.u.wAtlas!.value as THREE.Vector4[])[i]!.copy(s.atlas);
    });
  }

  // ------------------------------------------------------------------------------------------- the story clock

  /** The blackout: distance behind the car where the power is dead (negative: it has passed us). */
  private blackBehind(t: number) {
    const T = this.T, hit = T.out + 0.03;
    if (t < T.l2 - 0.3) return 1e5;
    // in the mirror shot the lamps behind us die one after another, then it closes in until it catches up
    if (t < hit) return keys(t, [[T.l2 - 0.3, 900], [T.sun, 300, ease.linear], [hit, 0, ease.inOutQuad]]);
    const d = t - hit;
    return -(d * 900 + d * d * 8000);
  }

  /** Blackout of the city behind: a block or two dies on every beat from the mirror shot on. */
  private backCityK(t: number) {
    const T = this.T;
    if (t < T.l2 - 0.4) return -1;
    let k = 0.06;
    for (const b of this.beats) if (b >= T.l2 - 0.02) k += 0.15 * prog(t, b, b + 0.42, ease.inOutQuad);
    return Math.min(1.2, k);
  }

  /** The giant screen: picture brightness, dawn of the painting, sun height, glitch and death. */
  private screenState(t: number) {
    const T = this.T, w = this.L[2]!.words;
    const on = prog(t, T.l2 - 0.4, T.l2 + 0.1, ease.inOutQuad);
    const dawn = 0.12 + 0.3 * prog(t, w[0]!.start - 0.05, w[0]!.start + 0.4, ease.outQuad) + 0.58 * prog(t, w[2]!.start - 0.1, w[4]!.start + 0.2, ease.inOutCubic);
    const rise = -0.16 + 0.12 * prog(t, w[2]!.start - 0.05, w[3]!.start, ease.outQuad) + 0.21 * prog(t, w[3]!.start, w[4]!.start + 0.35, ease.inOutCubic) + 0.04 * prog(t, w[4]!.start + 0.35, T.sank, ease.linear);
    const sink = 0.42 * prog(t, T.sank + 0.15, T.dead, ease.inQuad);
    const glitch = clamp(prog(t, T.sank + 0.1, T.sank + 0.22, ease.outQuad) * 0.3 + 0.7 * prog(t, T.sank + 0.3, T.dead - 0.12, ease.inQuad));
    const off = prog(t, T.dead - 0.26, T.dead, ease.linear);
    const stuck = off >= 1 ? Math.max(0, 1 - (t - T.dead) / 0.9) : off > 0.5 ? 1 : 0;
    const bright = on * (0.55 + 0.45 * dawn);
    const light = on * dawn * (1 - off) * (1 - 0.35 * glitch);
    return { on, dawn, sunY: rise - sink, glitch, off, stuck, bright, light };
  }

  // ------------------------------------------------------------------------------------------- shots

  private shotAt(t: number): Shot {
    const T = this.T;
    if (t < T.gauge) return 'dive';
    if (t < T.l1) return 'gauge';
    if (t < T.l2) return 'boards';
    if (t < T.sun) return 'mirror';
    if (t < T.l3) return 'sun';
    if (t < T.pylon) return 'station';
    if (t < T.out) return 'pylon';
    return 'dark';
  }

  /** The eye in the car (world). */
  private eyeAt(t: number) { return new THREE.Vector3(this.carX(t) + EYE.dx, EYE.y, -this.sAt(t)); }

  private camera(t: number, shot: Shot): Cam {
    const T = this.T, s = this.sAt(t);
    const sway = (k: number, seed: number) => noise1(t * k, seed);
    switch (shot) {
      case 'dive': {
        const t0 = this.W0;
        const dive = prog(t, t0, t0 + 0.75, ease.inOutCubic);
        const tE = this.L[0]!.words[5]!.start;
        const low = prog(t, tE - 0.35, T.gauge + 0.1, ease.inOutCubic);
        const h = lerp(lerp(20, 8.4, dive), 2.6, low);
        const pitch = lerp(lerp(64, -25, dive), -9, low) * DEG;
        const pos = new THREE.Vector3(ROAD.laneX(1) + 0.5 * sway(0.3, 2) - 1.2 * low, h + 0.12 * sway(0.6, 3), -s);
        return { pos, yaw: 0.02 * sway(0.25, 4) - 0.03 * low, pitch, roll: 0.02 * sway(0.35, 5) + 0.03 * low * Math.sin(t * 1.4), fov: 54 + 6 * low };
      }
      case 'boards': {
        const pos = new THREE.Vector3(this.carX(t) + 0.08 * sway(0.4, 6), 1.05 + 0.015 * sway(2, 7), -s);
        // look at the board in focus; pan between boards over half a second, eased
        let yaw = 0, pitch = 0;
        const aimAt = (b: (typeof this.boards)[number]) => {
          const dz = Math.max(6, b.u - s), dx = b.x - pos.x;
          const yw = clamp(Math.atan2(dx, dz), -1.0, 1.0);
          const pt = clamp(Math.atan2(6.3 - pos.y, Math.hypot(dx, dz)), 0, 0.42);
          return [yw, pt] as const;
        };
        const ws = this.boards.map((b, i) => (i === 0 ? 1 : prog(t, b.focus[0] - 0.3, b.focus[0] + 0.32, ease.inOutCubic)) * (i === this.boards.length - 1 ? 1 : 1 - prog(t, b.focus[1] - 0.3, b.focus[1] + 0.32, ease.inOutCubic)));
        const sum = ws.reduce((a, b) => a + b, 0) || 1;
        this.boards.forEach((b, i) => { const [yw, pt] = aimAt(b); yaw += yw * ws[i]! / sum; pitch += pt * ws[i]! / sum; });
        const near = this.boards.reduce((a, b, i) => a + ws[i]! / sum * clamp((b.u - s) / 40), 0);
        return { pos, yaw, pitch, roll: -yaw * 0.06 + 0.008 * sway(0.5, 8), fov: lerp(36, 25, near) };
      }
      case 'mirror': {
        const p = prog(t, T.l2, T.sun, ease.inOutQuad);
        const pos = this.eyeAt(t).add(new THREE.Vector3(0.0, 0.004 * sway(3, 9), 0.02));
        return { pos, yaw: (10 - 1.0 * p) * DEG + 0.006 * sway(0.4, 10), pitch: (-8.5 + 0.8 * p) * DEG, roll: 0.004 * sway(0.5, 11), fov: lerp(52, 50, p) };
      }
      case 'sun': {
        // from the roof: a long lens into the sunrise over the road, slowly widening as the screen dies
        const p = prog(t, T.sun, T.dead + 0.1, ease.inOutCubic);
        const p2 = prog(t, T.dead, T.l3 + 0.3, ease.outQuad);
        const pos = new THREE.Vector3(this.carX(t) + 0.25, 1.75 + 0.45 * p + 0.004 * sway(3, 12), -s);
        const tgt = new THREE.Vector3(0, SCR.y0 + SCR.h * lerp(0.5, 0.45, p), -this.scrU);
        const d = tgt.clone().sub(pos);
        const yaw = Math.atan2(d.x, -d.z) + 0.004 * sway(0.4, 13);
        const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)) - lerp(1.0, 1.4, p) * DEG;
        return { pos, yaw, pitch, roll: 0.003 * sway(0.4, 14), fov: lerp(15.5, 24, p) + 1.5 * p2 };
      }
      case 'station': {
        // braking toward the services: a long lens on the message sign ahead, easing as we come closer
        const p = prog(t, T.l3, T.pylon, ease.inOutQuad);
        const pos = new THREE.Vector3(this.carX(t) - 0.2, 1.25 + 0.006 * sway(2, 15), -s);
        const tgt = new THREE.Vector3(lerp(6.4, 9.5, p), lerp(6.4, 5.6, p), -this.vmsU - lerp(0, 30, p));
        const d = tgt.clone().sub(pos);
        return { pos, yaw: Math.atan2(d.x, -d.z) + 0.004 * sway(0.5, 16), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.9, roll: -0.008 + 0.004 * sway(0.5, 17), fov: lerp(31, 29, p) };
      }
      case 'pylon': {
        // low by the shoulder, a long lens on the price windows; a slow push, a soft breath on each landing
        const p = prog(t, T.pylon, T.out, ease.inOutQuad);
        const base = new THREE.Vector3(18.2, 0, -this.stationU);
        const pos = new THREE.Vector3(base.x - 6.6 + 0.8 * p, 1.45 + 0.45 * p, base.z + 13 - 2.6 * p);
        const tgt = new THREE.Vector3(base.x + 0.3, this.station.panelY - 0.9 - 0.3 * p, base.z);
        const d = tgt.clone().sub(pos);
        const w = this.L[3]!.words;
        const bump = (t0: number) => smoothstep(t0 - 0.02, t0 + 0.08, t) * Math.exp(-Math.max(0, t - t0 - 0.08) / 0.35);
        const breath = 0.9 * (bump(w[3]!.start) + bump(w[4]!.start));
        return { pos, yaw: Math.atan2(d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), roll: 0.03 + 0.006 * sway(0.4, 18), fov: lerp(30, 25, p) - breath };
      }
      case 'dark': {
        // inside: his eyes turned to the station as we pass it; the stall pitches the car (and us) forward
        const p = prog(t, T.out, this.W1, ease.inOutQuad);
        const pos = this.eyeAt(t);
        // (a smooth bump: the car dips as the engine dies, then settles)
        const tau = t - T.stall;
        const lurch = 0.7 * DEG * smoothstep(0, 0.18, tau) * (1 - smoothstep(0.18, 0.7, tau));
        return { pos, yaw: (38 + 4 * p) * DEG + 0.004 * sway(0.4, 19), pitch: (-15.5 - 0.5 * p) * DEG - lurch, roll: 0.004 * sway(0.4, 20), fov: 66 };
      }
      default:
        return { pos: new THREE.Vector3(ROAD.laneX(1), 1.2, -s), yaw: 0, pitch: 0, roll: 0, fov: 50 };
    }
  }

  private applyCam(c: Cam) {
    this.cam.position.copy(c.pos);
    this.cam.rotation.set(c.pitch, -c.yaw, c.roll, 'YXZ');
    this.cam.fov = c.fov;
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------------------------------- frame

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, { renderer, audio } = this.ctx;
    const T = this.T;
    const shot = this.shotAt(t);
    const ws0 = this.L[0]!.words;

    if (shot === 'gauge') return this.renderGauge(t, f, out);

    // ---- camera
    const cam = this.camera(t, shot);
    this.applyCam(cam);
    const pos = cam.pos;
    const s = this.sAt(t), v = this.speed(t);
    const camU = -pos.z;

    // ---- the story clock: the screen, the blackout, our car's power
    const ss = this.screenState(t);
    const scrVisible = t > T.l2 - 0.5;
    const scrCenter = new THREE.Vector3(0, SCR.y0 + SCR.h * 0.45, -this.scrU);
    const scrDir = scrCenter.clone().sub(pos).normalize();
    const dB = this.blackBehind(t);
    const frontU = s - dB; // road coordinate of the blackout front (dead behind it)
    const after = t > T.out ? 1 : 0;
    const flickOut = (t0: number, dur: number, seed: number) => {
      if (t < t0) return 1;
      if (t > t0 + dur) return 0;
      return hash(Math.floor(t * 40), seed) > 0.45 ? 1 : 0.08;
    };
    const cityAheadK = after ? -0.05 + 1.25 * prog(t, T.out + 0.08, T.out + 0.26, ease.inQuad) : -1;
    const cityK = 1 - 0.45 * clamp((this.backCityK(t) + 0.2) / 1.4) * 0.6 - 0.55 * clamp(cityAheadK + 0.05);
    const carPower = 1 - smoothstep(T.stall - 0.01, T.stall + 0.06, t);

    // ---- world state
    this.sky.update(pos, t, { scrDir, scrK: scrVisible ? ss.light : 0, cityK, cloudDrift: t });
    this.city.blackout(cityAheadK);
    this.city.update(t, 0, HU.uHazeLo.value, cityAheadK > 0.55 ? 0 : cityAheadK > 0.35 ? (hash(Math.floor(t * 40), 31) > 0.5 ? 1 : 0) : 1);
    this.cityBack.blackout(this.backCityK(t));
    this.cityBack.update(t, 0, HU.uHazeLo.value);
    HU.uTime.value = t;
    HU.uHeadOn.value = carPower * (shot === 'dive' ? 0 : 1);
    HU.uHeadPos.value.set(this.carX(t) + 0.0, 0.65, -s - 2.2);
    HU.uLampCol.value.copy(C('#ff9a3c', 115));
    HU.uLampOffU.value = dB > 5e4 ? -1e5 : frontU;
    this.road.follow(pos);
    this.furn.update(Math.max(s, camU), pos.x, t, HU.uHeadOn.value, t > T.out + 0.1 ? 0 : 1);
    this.lamps.update(camU, HU.uLampCol.value, HU.uLampOffU.value, 1, t);
    this.traffic.update(t, camU, shot === 'dive' ? this.vDrone : shot === 'pylon' ? 0 : v, shot === 'pylon' ? 0.5 : 1);
    this.land.update(camU, t);
    this.land.power(dB > 5e4 ? -1e9 : frontU, t);
    this.gantries.forEach((g, i) => (g.position.z = -this.gantryU[i]!));
    this.power.update(t);
    this.bridge.update(t, this.bridgeU < frontU ? 0 : this.bridgeU < frontU + 30 ? (hash(Math.floor(t * 22), 7) > 0.45 ? 1 : 0) : 1);
    this.bridge.visible = Math.abs(this.bridgeU - camU) < 900;

    // ---- the first line on the road
    const wR = this.road.u.wState!.value as THREE.Vector4[];
    this.slots.forEach((sl, i) => {
      if (i >= NWORDS) return;
      const st = ws0[sl.word]!.start;
      wR[i]!.set(t >= st ? 0.02 + prog(t, st, st + 0.16, ease.outQuad) : 0, 1.1 * pulse(t, st, 0.12) + 0.08, 0, 0);
    });

    // ---- boards
    for (const b of this.boards) {
      const d = b.u - camU;
      b.b.visible = shot === 'boards' && d > -40 && d < 400;
      if (b.b.visible) b.b.update(t);
    }
    // ---- station
    const dSt = this.stationU - camU;
    this.station.visible = (shot === 'sun' || shot === 'station' || shot === 'pylon' || shot === 'dark') && dSt > -80 && dSt < 900;
    let stPow = 1;
    if (this.station.visible) {
      this.station.updateMatrixWorld(true);
      this.updateStation(t);
      const brown = t > T.out - 0.3 && t < T.out ? 1 - 0.25 * (hash(Math.floor(t * 30), 5) > 0.7 ? 1 : 0) : 1; // a brown-out shiver
      const leds = flickOut(T.out + 0.03, 0.13, 11);
      stPow = flickOut(T.out + 0.07, 0.1, 12);
      this.station.power({ box: brown * flickOut(T.out + 0.05, 0.09, 13), leds: brown * leds, canopy: brown * stPow, pumps: flickOut(T.out + 0.09, 0.07, 14), shop: flickOut(T.out + 0.11, 0.06, 15) });
      this.station.pool(brown * stPow);
    } else HU.uPoolCol.value.setRGB(0, 0, 0);

    // ---- the message sign
    this.vms.visible = shot === 'station' || shot === 'pylon' || shot === 'dark';
    if (this.vms.visible) {
      const w = this.L[3]!.words;
      const starts = [0, 4, 8];
      const vOn = flickOut(T.out + 0.01, 0.08, 16);
      Array.from('AND I’D PAY').forEach((_, i) => {
        const wi = i < 3 ? 0 : i < 7 ? 1 : 2;
        const ci = i - starts[wi]!;
        this.vms.row.on[i] = i === 3 || i === 7 ? 0 : t >= w[wi]!.start + ci * 0.03 ? vOn : 0;
      });
      this.vms.flash(((audio.beatAt(t) % 1) + 1) % 1, vOn);
    }

    // ---- the giant screen and its picture
    this.screen.visible = scrVisible;
    if (scrVisible) {
      const arcK = t >= T.sun ? 1 : 0; // (the layout changes on the cut)
      this.pic.update(t, ss.sunY, ss.dawn, ss.bright, arcK, T.sun, 1);
      this.pic.render(renderer);
      this.screen.update(t, { glitch: ss.glitch, off: ss.off, stuck: ss.stuck, seed: frameIdx(t) }, t > T.out + 0.2 ? 0 : 1);
    }

    // ---- the car around him (the mirror shot and the last shot)
    const inside = shot === 'mirror' || shot === 'dark';
    this.cabin.visible = inside;
    if (inside) {
      this.cabin.position.copy(this.eyeAt(t));
      this.cabin.updateMatrixWorld(true);
      // light in the car: the sky and the city's glow, the streetlight overhead as we pass, the screen ahead
      const lampAhead = this.lampSweep(s, frontU);
      CU.cAmb.value.copy(C('#22305a', 0.05 * (0.4 + 0.6 * cityK)));
      CU.cTopCol.value.copy(C('#ff9a40', 0.12 * lampAhead));
      CU.cTopDir.value.set(-0.2, 0.75, -0.6).normalize();
      CU.cFrontCol.value.copy(C('#ff9a52', 0.03 * ss.light * (scrVisible ? 1 : 0)));
      CU.cFrontDir.value.copy(scrDir);
      const wipe = this.wipeAt(t);
      const handK = shot === 'dark' ? lerp(0.95, 0.7, prog(t, T.stall, this.W1, ease.inOutQuad)) : 0.95;
      const dropLight = C('#ff9a40', 0.05 * lampAhead + 0.006).add(C('#ff9a52', 0.06 * ss.light * (scrVisible ? 1 : 0))).add(C('#5fd8ff', 0.012 * handK)).add(C('#fff4e6', 0.01 * carPower));
      this.cabin.update({
        t, tau: wipe.tau, w0: wipe.w0, w1: wipe.w1, speed: v,
        dash: shot === 'dark' ? flickOut(T.stall, 0.09, 21) : 1,
        kmh: v * 3.6 * (shot === 'dark' ? 1 - prog(t, T.stall, T.stall + 0.5, ease.inOutCubic) : 1),
        rpm: (shot === 'dark' ? 2100 * (1 - prog(t, T.stall - 0.02, T.stall + 0.3, ease.inOutCubic)) : 2400 + 40 * Math.sin(t * 9)),
        fuel: 0,
        radio: shot === 'dark' ? flickOut(T.stall + 0.02, 0.08, 22) : 1,
        phone: shot === 'dark' ? flickOut(T.stall + 0.06, 0.08, 23) : 1,
        hand: handK,
        dropLight, dropSpec: C('#ffd2a0', 0.2 * lampAhead + 0.02).add(C('#9fe6ff', 0.05 * handK)),
        grip: this.downs.reduce((a, d) => a + pulse(t, d, 0.18) * smoothstep(d - 0.05, d, t), 0),
      });
      this.cabin.mirrorU.sweep!.value = ((s / ROAD.lampP) % 1 + 1) % 1;
      this.cabin.mirrorU.k!.value = 1;
    }

    // ---- living details
    const glowOnRain = C('#ff9a52', 0.002 * ss.light * (scrVisible ? 1 : 0));
    this.rain.update(pos, t, shot === 'dive' ? this.vDrone : shot === 'pylon' ? 0 : v, this.carX(t), s, HU.uLampOffU.value, HU.uHeadOn.value, glowOnRain, shot === 'pylon' ? 0.8 : 1);
    this.steam.update(camU, t, HU.uLampOffU.value, glowOnRain);
    const moth: MothSource[] = [];
    if (shot === 'boards') for (const b of this.boards) if (Math.abs(b.u - camU) < 160) for (const p of b.b.floodSpots()) moth.push({ p, n: 6, r: 0.7, k: 2.2 });
    if ((shot === 'pylon' || shot === 'station' || shot === 'dark') && this.station.visible) {
      const sp = this.station.mothSpots();
      moth.push({ p: sp[0]!, n: 14, r: 1.1, k: 1.6 * flickOut(T.out + 0.05, 0.09, 13) }, { p: sp[1]!, n: 10, r: 0.9, k: 1.4 * stPow }, { p: sp[2]!, n: 8, r: 0.9, k: 1.4 * stPow });
    }
    this.moths.update(t, moth);

    // ---- passes: the wet road's reflection, the rear-view mirror, the frame
    const hideStars = this.sky.stars.visible;
    if (inside) {
      // the view behind, for the mirror (the city behind, the lamps dying toward us)
      const cx = this.carX(t);
      this.backCam.position.set(cx, 1.35, -s + 0.6);
      this.backCam.rotation.set(0.06, Math.PI - 0.04, 0, 'YXZ');
      this.backCam.updateMatrixWorld(true);
      this.backCam.updateProjectionMatrix();
      this.cabin.visible = false;
      for (const g of this.gantries) g.visible = false;
      this.road.u.reflK!.value = 0.8;
      this.road.u.tR!.value = this.backRefl.rt.texture; this.road.u.tRB!.value = this.backRefl.blur.texture; this.road.u.texMat!.value = this.backRefl.texMat;
      this.backRefl.render(renderer, this.hideFor(() => this.scene), this.backCam);
      this.unhide();
      renderer.setRenderTarget(this.mirrorRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.render(this.scene, this.backCam);
      this.cabin.visible = true;
      for (const g of this.gantries) g.visible = true;
    }
    this.road.u.reflK!.value = 1;
    this.road.u.tR!.value = this.refl.rt.texture; this.road.u.tRB!.value = this.refl.blur.texture; this.road.u.texMat!.value = this.refl.texMat;
    const cv = this.cabin.visible;
    this.cabin.visible = false;
    this.refl.render(renderer, this.hideFor(() => this.scene), this.cam);
    this.unhide();
    this.sky.stars.visible = hideStars;
    this.cabin.visible = cv;
    renderer.setRenderTarget(out);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.cam);

    // ---- a soft flare from the painted sun while the screen plays (it is bright enough to flare a lens)
    if (shot === 'sun' && ss.light > 0.05) {
      const sunW = new THREE.Vector3(0, SCR.y0 + SCR.h * (SCREEN_HORIZON + Math.max(0, ss.sunY)), -this.scrU + 0.7);
      const sd = sunW.sub(pos).normalize();
      this.flare.render(renderer, out, this.cam, sd, 0.07 * ss.light * (1 - ss.glitch * 0.7), 0.4);
    }

    // ---- post
    let shake: [number, number] = [0, 0];
    for (const d of this.downs) {
      const k = pulse(t, d, 0.06) * (shot === 'boards' || shot === 'station' ? 0.5 : 0.25) * smoothstep(d - 0.01, d + 0.03, t);
      if (k > 0.01) shake = [shake[0] + (hash(d, 1) - 0.5) * 3 * k, shake[1] + (hash(d, 2) - 0.5) * 3 * k];
    }
    const rush = clamp((v - 26) / 20, 0, 1) * (shot === 'dive' ? 1 : 0.4);
    const dark = shot === 'dark' ? prog(t, T.stall, T.stall + 0.4, ease.outQuad) : 0;
    const glit = shot === 'sun' ? ss.glitch * (1 - ss.off) : 0;
    return {
      bloom: 0.85 + 0.25 * dark, bloomThreshold: 0.8 - 0.15 * dark, bloomRadius: 0.8, halation: 0.14,
      vignette: 0.42 + 0.12 * dark, grain: 0.045 + 0.015 * dark, ca: 0.7 + 1.2 * rush + 2.5 * glit, exposure: 1,
      zoom: 1 + 0.006 * f.a.kick * (1 - dark), shake,
    };
  }

  /** Light from the streetlight just ahead of / above the car (0..1), if it is still on. */
  private lampSweep(s: number, frontU: number) {
    let k = 0;
    const k0 = Math.round(s / ROAD.lampP);
    for (let j = -1; j <= 2; j++) {
      const lu = (k0 + j) * ROAD.lampP;
      if (lu < frontU) continue;
      const d = lu - s - 6;
      k += Math.exp(-(d * d) / 120);
    }
    return Math.min(1, k);
  }

  /** The wipers: the current and previous sweep starts, and the wiper clock (frozen when the engine dies). */
  private wipeAt(t: number) {
    const T = this.T;
    let tau = t;
    if (t > T.stall) { const d = t - T.stall; tau = T.stall + (d < 0.16 ? d - (d * d) / 0.32 : 0.08); }
    let w1 = -100, w0 = -101;
    for (const w of this.wipes) if (w <= tau) { w0 = w1; w1 = w; }
    return { tau, w0, w1 };
  }

  /** Hide what the reflection must not see (the road itself, the stars). */
  private hideFor(fn: () => THREE.Scene) {
    this.road.visible = false;
    this.sky.stars.visible = false;
    for (const o of this.noRefl) o.visible = false;
    return fn();
  }
  private unhide() { for (const o of this.noRefl) if (o !== this.cabin) o.visible = true; this.road.visible = true; }

  private updateStation(t: number) {
    const w = this.L[3]!.words;
    const st = this.station;
    // marquee: AND I'D PAY, each word switching on when sung (a quick left-to-right wipe)
    const text = 'AND I’D PAY ';
    const wordOfChar = [0, 0, 0, -1, 1, 1, 1, -1, 2, 2, 2, -1];
    Array.from(text).forEach((_, i) => {
      const wi = wordOfChar[i]!;
      if (wi < 0) { st.marquee.on[i] = 0; return; }
      const ci = i - [0, 4, 8][wi]!;
      st.marquee.on[i] = t >= w[wi]!.start + ci * 0.035 ? 1 : 0;
    });
    // the price drums: spin from "pay", land row 0 on ANY, row 1 on COST
    const tSpin = w[2]!.start;
    const lands = [w[3]!.start, w[4]!.start];
    const from = ['3.89', '4.05'], to = ['ANY ', 'COST'];
    const NG = 40;
    st.rows.forEach((row, r) => {
      for (let i = 0; i < 4; i++) {
        const g0 = glyph(from[r]![i]!), g1 = glyph(to[r]![i]!);
        const land = lands[r]! + i * 0.045;
        let p: number;
        if (t < tSpin) p = g0;
        else if (t < land) {
          const turns = (t - tSpin) * (14 + 3 * i);
          p = g0 + Math.floor(turns * 4) / 4;
          const tot = (land - tSpin) * (14 + 3 * i);
          const target = g1 + NG * Math.ceil((g0 + tot + 1 - g1) / NG);
          const k = prog(t, land - 0.28, land, ease.outCubic);
          p = Math.min(lerp(p, target - 1, k), target - 1);
        } else {
          // the letter only rolls into the window once its word is sung
          const tot = (land - tSpin) * (14 + 3 * i);
          const target = g1 + NG * Math.ceil((g0 + tot + 1 - g1) / NG);
          p = target - (1 - prog(t, land, land + 0.12, ease.outCubic));
        }
        row.pos[i] = p;
        row.on[i] = 1;
      }
    });
    const hit = (lt: number) => pulse(t, lt, 0.1);
    st.rows.forEach((row, r) => (row.material.uniforms.k!.value = 1 + 1.8 * hit(lands[r]!)));
    st.marquee.material.uniforms.k!.value = 1;
  }

  private renderGauge(t: number, f: Frame, out: THREE.WebGLRenderTarget) {
    const T = this.T, audio = this.ctx.audio;
    const w = this.L[0]!.words;
    const tEmpty = w[5]!.start;
    // the needle: already low, sinks to E on the cut's downbeat (a damped spring, barely any overshoot)
    const settle = springStep(t - T.gauge, 1.6, 0.7);
    let fuel = lerp(0.16, 0.0, settle) + 0.003 * f.a.kick * Math.sin(t * 50);
    fuel = Math.max(-0.02, fuel);
    // low-fuel lamp: on since "empty", blinking with the beat
    const ph = ((audio.beatAt(t) % 1) + 1) % 1;
    const lamp = t < tEmpty ? 0 : ph < 0.5 ? 1 : 0.12;
    const sweep = ((t - T.gauge) / 0.62) % 1;
    const push = prog(t, T.gauge, T.l1, ease.inOutQuad);
    this.gauge.update(fuel, lamp, sweep, push, [0, 0], 0.04 + 0.015 * noise1(t * 0.8, 3), t);
    this.gauge.render(this.ctx.renderer, out);
    return { bloom: 1.0, bloomThreshold: 0.75, bloomRadius: 0.75, halation: 0.2, vignette: 0.55, grain: 0.05, ca: 1.2, zoom: 1 + 0.008 * f.a.kick };
  }
}

const glyph = (ch: string) => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.’ $'.indexOf(ch);
