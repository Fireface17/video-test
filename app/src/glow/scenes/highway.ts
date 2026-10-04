// Verse 1, "Night drive": a fast drive on a wet night highway toward a far city, until the sun comes up
// behind us. One continuous world (highway-road.ts, highway-env.ts) seen through cuts and snaps on the beat:
//   A  dive    the whip down out of the night sky onto the highway; a drone chases low over the lanes and
//              "WE WERE RUNNING ON AN EMPTY TANK" is painted across them as huge road lettering, word by
//              word as it is sung, rushing under the camera
//   B  gauge   (downbeat) macro on the fuel gauge: the needle sinks to E, the low-fuel lamp blinks
//   C  boards  low POV: calendar billboards (MONDAY, TUESDAY, WEDNESDAY) on both sides; the camera whips
//              from one to the next, the words brush-painted on in glowing paint, a smile on each day
//   D  mirror  inside the car: the dawn appears in the rear-view mirror with "NOW THE SUN'S"
//   E  sun     (whip around on "coming") the sun rises over the road behind us, the words fly out of it
//              onto an arc; the sky turns gold
//   F  station a filling station: the pylon spells AND I'D PAY, its price drums spin and land on
//              ANY / COST; the camera turns into the sun, which flares into the lens on the last beat
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, frameIdx, hash, lerp, noise1, prog, pulse, smoothstep, springStep } from '../../engine/util';
import { HU, ROAD, litMat } from './highway-common';
import { bakeTextures, type HwTextures } from './highway-tex';
import { City, Landscape, Sky } from './highway-env';
import { Furniture, Gantry, NWORDS, Reflection, RoadSurface, Streetlights, Traffic, wordAtlas } from './highway-road';
import { Gauge } from './highway-gauge';
import { BOARD_W, CalendarBoard } from './highway-boards';
import { Hood, Interior, SunArc } from './highway-props';
import { Station, VmsGantry } from './highway-station';
import { makeRT } from '../../engine/gl';
import { LensFlare } from './highway-flare';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const DEG = Math.PI / 180;

type Shot = 'dive' | 'gauge' | 'boards' | 'mirror' | 'sun' | 'station' | 'pylon' | 'reveal' | 'flare';
interface Cam { pos: THREE.Vector3; yaw: number; pitch: number; roll: number; fov: number }
interface WordRow { words: number[]; u: number; len: number }

const DBG = (): Record<string, boolean> => (globalThis as any).__HW ?? {};
export default class Highway extends Scene {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 12000);
  backCam = new THREE.PerspectiveCamera(12, 3.75, 0.5, 12000);
  tex!: HwTextures;
  sky!: Sky;
  city!: City;
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
  arc!: SunArc;
  interior!: Interior;
  hood!: Hood;
  mirrorRT = makeRT(768, 205);
  flare = new LensFlare();

  L: Line[] = [];
  S0 = 0; S1 = 0; W0 = 0; W1 = 0; lab = false;
  T = { gauge: 0, l1: 0, l2: 0, whip: 0, l3: 0, pylon: 0, reveal: 0, flare: 0 };
  downs: number[] = [];
  rows: WordRow[] = [];
  slots: { rect: THREE.Vector4; atlas: THREE.Vector4; word: number }[] = [];
  // travel table
  private tT0 = 0; private tDT = 1 / 500; private sTab = new Float32Array(0);
  private vDrone = 34;

  override async init() {
    const { renderer, lyrics, audio } = this.ctx;
    // ---- timing
    this.lab = this.ctx.id === 'lab';
    const sec = (n: string) => audio.sections.find((s) => s.name === n)!.start;
    this.S0 = this.lab ? sec('verse1') : this.ctx.start;
    this.S1 = this.lab ? sec('pre1') : this.ctx.end;
    this.W0 = this.S0 - 0.25; this.W1 = this.S1 + 0.35;
    this.L = [lyrics.get('We were running'), lyrics.get('Painting smiles'), lyrics.get('Now the sun'), lyrics.get('And I’d pay')];
    const [L0, L1, L2, L3] = this.L as [Line, Line, Line, Line];
    const beatBefore = (t: number) => audio.timeOfBeat(Math.floor(audio.beatAt(t + 0.03)));
    const nearestBeat = (t: number) => audio.timeOfBeat(Math.round(audio.beatAt(t)));
    this.downs = audio.downbeats.filter((d) => d > this.W0 && d < this.W1 + 0.5);
    const nextDown = (t: number) => this.downs.find((d) => d > t) ?? t + 1;
    const T = this.T;
    T.gauge = nextDown(L0.words[6]!.start + 0.2);
    T.l1 = beatBefore(L1.start);
    T.l2 = beatBefore(L2.start);
    T.whip = nearestBeat(L2.words[3]!.start);
    T.l3 = beatBefore(L3.start);
    T.pylon = nextDown(L3.words[2]!.start - 0.1);
    T.flare = Math.min(this.downs.find((x) => x > L3.words[4]!.start + 0.2) ?? this.S1 - 0.4, nearestBeat(this.S1 - 0.38));
    T.reveal = T.flare;

    // ---- world
    this.tex = bakeTextures(renderer);
    this.sky = new Sky(this.tex.clouds);
    this.city = new City();
    this.refl = new Reflection();
    const atlasWords = L0.words.map((w) => w.w);
    const atlas = wordAtlas(atlasWords);
    this.road = new RoadSurface(this.tex, this.refl, atlas.tex);
    this.furn = new Furniture(this.tex);
    this.lamps = new Streetlights();
    this.traffic = new Traffic();
    const steel = litMat({ color: C('#7d858f', 0.32), rough: 0.55, metal: 0.6, spec: 0.7, grime: 0.6 });
    this.gantries = [
      new Gantry([{ text: 'City Centre', sub: 'Harbour', arrow: 'up' }, { text: 'Airport', sub: 'Exit 24', arrow: 'right', exit: '24' }], steel),
      new Gantry([{ text: 'Riverside', sub: 'Old Town', arrow: 'up' }, { text: 'East', sub: 'Exit 25', arrow: 'right', exit: '25' }], steel),
    ];
    this.land = new Landscape();
    this.scene.add(this.sky, this.city, this.road, this.furn, this.lamps, this.traffic, this.land, ...this.gantries);
    this.scene.add(this.cam);
    // dark verticals smear into ghostly figures in the blurred reflection: keep them out of it
    this.noRefl = [this.lamps.poles, this.lamps.halos, this.furn.posts, ...this.gantries.map((g) => g.children[0]!)];
    HU.uLampCol.value.copy(C('#ff9a3c', 115));

    // ---- travel (the car), then everything placed along it
    this.buildTravel();
    this.buildRows(atlas.slots);
    // one gantry over the drone's run, one seen ahead through the windscreen at dawn
    this.gantryU = [this.sAt(T.gauge - 0.28), this.sAt(T.l3) + 160];

    this.gauge = new Gauge();

    // calendar billboards
    const w1 = L1.words;
    const specs = [
      { day: 'MONDAY', date: '13', words: [[0], [1]], smile: w1[1]!, side: 1, focus: [T.l1, nearestBeat(w1[2]!.start)] as [number, number], D: 40 },
      { day: 'TUESDAY', date: '14', words: [[2, 3], [4, 5]], smile: w1[4]!, side: -1, focus: [nearestBeat(w1[2]!.start), nearestBeat(w1[6]!.start)] as [number, number], D: 33 },
      { day: 'WEDNESDAY', date: '15', words: [[6, 7]], smile: w1[7]!, side: 1, focus: [nearestBeat(w1[6]!.start), T.l2 + 0.3] as [number, number], D: 44 },
    ];
    specs.forEach((s, i) => {
      const lines = s.words.map((row) => row.map((wi) => ({ text: w1[wi]!.w, t0: w1[wi]!.start, t1: Math.min(w1[wi]!.end, w1[wi]!.start + 0.55) })));
      const b = new CalendarBoard({ day: s.day, date: s.date, month: 'OCTOBER', lines, smile: [s.smile.start + 0.05, s.smile.start + 0.5], seed: 11 + i * 17 });
      const first = Math.min(...lines.flat().map((w) => w.t0));
      const u = this.sAt(first) + s.D;
      const x = s.side > 0 ? 21 : -18.5;
      b.position.set(x, 0, -u);
      b.rotation.y = s.side > 0 ? -0.45 : 0.45;
      this.scene.add(b);
      this.boards.push({ b, u, x, side: s.side, focus: s.focus });
      this.land.exclude.push({ x, u, r: 26 });
    });

    // the station: the pylon by the right shoulder, ~70 m ahead when "And" is sung
    this.station = new Station();
    this.stationU = this.sAt(L3.words[0]!.start) + 74;
    this.station.position.set(18.2, 0, -this.stationU);
    this.station.rotation.y = 0.35;
    this.scene.add(this.station);
    this.land.exclude.push({ x: 40, u: this.stationU + 20, r: 50 });
    // the overhead message sign that spells the first half of the line on the approach
    this.vms = new VmsGantry('AND I’D PAY', steel);
    this.vmsU = this.sAt(L3.words[0]!.start) + 46;
    this.vms.position.z = -this.vmsU;
    this.scene.add(this.vms);

    // the sun's words and the car interior (camera space)
    this.arc = new SunArc(L2);
    await this.arc.build();
    this.scene.add(this.arc);
    this.hood = new Hood(this.sky.u);
    this.scene.add(this.hood);
    this.interior = new Interior(this.mirrorRT.texture);
    this.cam.add(this.interior);
    this.backCam.layers.enableAll();
  }

  // ------------------------------------------------------------------------------------------- travel

  /** Car speed (m/s) at t: the drone chase, cruising, lunges on the downbeats, braking for the station. */
  private speed(t: number) {
    const T = this.T;
    let v = t < T.gauge ? this.vDrone : t < T.l2 ? 27 : t < T.l3 ? 31 : lerp(26, 9, prog(t, T.l3 + 0.2, T.pylon + 0.6, ease.inOutCubic));
    for (const d of this.downs) {
      const dt = t - d;
      if (dt > -0.02 && dt < 1.2 && t < T.l3) v += 5 * Math.exp(-Math.max(0, dt) / 0.25) * smoothstep(-0.02, 0.03, dt);
    }
    return v;
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
      const lag = last.u - (this.sAt(ws[g6(groups)]!.start) + DSTAR);
      if (lag < 4 || this.vDrone > 52) break;
      this.vDrone += Math.min(8, lag / 1.2);
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

  // ------------------------------------------------------------------------------------------- shots

  private shotAt(t: number): Shot {
    const T = this.T;
    if (t < T.gauge) return 'dive';
    if (t < T.l1) return 'gauge';
    if (t < T.l2) return 'boards';
    if (t < T.whip) return 'mirror';
    if (t < T.l3) return 'sun';
    if (t < T.pylon) return 'station';
    if (t < T.reveal) return 'pylon';
    if (t < T.flare) return 'reveal';
    return 'flare';
  }

  private camera(t: number, shot: Shot, f: Frame): Cam {
    const T = this.T, s = this.sAt(t);
    const kick = f.a.kick;
    const sway = (k: number, seed: number) => noise1(t * k, seed);
    switch (shot) {
      case 'dive': {
        const t0 = this.W0;
        const dive = prog(t, t0, t0 + 0.68, ease.inOutQuad);
        const tE = this.L[0]!.words[5]!.start;
        const low = prog(t, tE - 0.1, T.gauge, ease.inOutCubic);
        const h = lerp(lerp(20, 8.4, dive), 2.4, low);
        const pitch = lerp(lerp(64, -25, dive), -9, low) * DEG + 0.012 * kick;
        const pos = new THREE.Vector3(ROAD.laneX(1) + 0.6 * sway(0.3, 2) - 1.2 * low, h + 0.15 * sway(0.7, 3), -s);
        return { pos, yaw: 0.02 * sway(0.25, 4) - 0.03 * low, pitch, roll: 0.025 * sway(0.4, 5) + 0.04 * low * Math.sin(t * 2.1), fov: 54 + 6 * low };
      }
      case 'boards': {
        // lane changes toward the board being read (left lane for Tuesday)
        const bTue = this.boards[1]!, bWed = this.boards[2]!;
        const toL = prog(t, bTue.focus[0] - 0.45, bTue.focus[0] + 0.25, ease.inOutCubic) - prog(t, bWed.focus[0] - 0.1, bWed.focus[0] + 0.5, ease.inOutCubic);
        const x = lerp(ROAD.laneX(2), ROAD.laneX(0), toL);
        const pos = new THREE.Vector3(x + 0.1 * sway(0.5, 6), 1.05 + 0.02 * sway(3, 7) - 0.01 * kick, -s);
        // look at the board in focus; whip between boards on the beat
        let yaw = 0, pitch = 0;
        const aimAt = (b: (typeof this.boards)[number]) => {
          const dz = Math.max(4, b.u - s), dx = b.x - pos.x;
          const yw = clamp(Math.atan2(dx, dz), -1.1, 1.1);
          const pt = clamp(Math.atan2(6.3 - pos.y, Math.hypot(dx, dz)), 0, 0.45);
          return [yw, pt] as const;
        };
        const ws = this.boards.map((b) => prog(t, b.focus[0] - 0.13, b.focus[0] + 0.13, ease.inOutCubic) * (1 - prog(t, b.focus[1] - 0.13, b.focus[1] + 0.13, ease.inOutCubic)));
        const sum = ws.reduce((a, b) => a + b, 0) || 1;
        this.boards.forEach((b, i) => { const [yw, pt] = aimAt(b); yaw += yw * ws[i]! / sum; pitch += pt * ws[i]! / sum; });
        // the whip: a little overshoot
        for (const b of this.boards.slice(1)) {
          const ph = t - b.focus[0];
          if (ph > 0 && ph < 0.6) yaw += b.side * 0.06 * Math.sin(ph * 14) * Math.exp(-ph * 7);
        }
        // the lens racks in as each board comes close enough to read
        const near = this.boards.reduce((a, b, i) => a + ws[i]! / sum * clamp((b.u - s) / 40), 0);
        return { pos, yaw, pitch, roll: -yaw * 0.08 + 0.01 * sway(0.6, 8), fov: lerp(36, 24, near) };
      }
      case 'mirror': {
        const p = prog(t, T.l2, T.whip, ease.inOutCubic);
        const pos = new THREE.Vector3(ROAD.laneX(1) - 0.35, 1.18 + 0.006 * sway(4, 9), -s);
        return { pos, yaw: 0.06 + 0.01 * sway(0.4, 10), pitch: 0.035, roll: 0.006 * sway(0.5, 11), fov: lerp(40, 33, p) };
      }
      case 'sun': {
        const w = prog(t, T.whip, T.whip + 0.34, ease.inOutCubic);
        const pos = new THREE.Vector3(ROAD.laneX(1) - 0.35 + 0.3 * w, lerp(1.18, 1.65, w), -s);
        const settle = (1 - w) * 0 + springStep(t - T.whip - 0.34, 2.2, 0.5) - 1;
        const yaw = 0.06 * (1 - w) + w * (Math.PI - 0.12) + 0.04 * settle * (t > T.whip + 0.34 ? 1 : 0);
        return { pos, yaw, pitch: lerp(0.035, 0.13, w), roll: 0.12 * Math.sin(w * Math.PI) + 0.006 * sway(0.5, 12), fov: lerp(33, 54, w) };
      }
      case 'station': {
        // braking toward the services: a long lens on the message sign ahead, the station beyond it
        const p = prog(t, T.l3, T.pylon, ease.inOutQuad);
        const pos = new THREE.Vector3(ROAD.laneX(2) - 0.4 - 0.6 * p, 1.2 + 0.01 * sway(2, 13), -s);
        const dz = Math.max(8, this.vmsU - s);
        const yaw = Math.atan2(6.4 - pos.x, dz) * 0.8 + 0.03 * sway(0.5, 16);
        const pitch = clamp(Math.atan2(6.6 - pos.y, dz) * 0.85, 0.02, 0.3);
        return { pos, yaw, pitch, roll: -0.01 + 0.008 * sway(0.5, 14), fov: lerp(30, 27, p) - 1.2 * pulse(t, this.L[3]!.words[2]!.start, 0.1) };
      }
      case 'pylon': {
        // low by the shoulder, a long lens on the price windows; a slow push and a punch on each landing
        const p = prog(t, T.pylon, T.reveal, ease.linear);
        const base = new THREE.Vector3(18.2, 0, -this.stationU);
        const pos = new THREE.Vector3(base.x - 6.5 + 0.8 * p, 1.4 + 0.5 * p, base.z + 13 - 3 * p);
        const tgt = new THREE.Vector3(base.x + 0.3, this.station.panelY - 0.9, base.z);
        const d = tgt.clone().sub(pos);
        const w = this.L[3]!.words;
        const punch = 1.6 * (pulse(t, w[3]!.start, 0.12) + pulse(t, w[4]!.start, 0.12));
        return { pos, yaw: Math.atan2(d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)), roll: 0.035 + 0.01 * sway(0.4, 15), fov: lerp(30, 24, p) - punch };
      }
      case 'reveal': {
        // a drone climbing over the station, looking back down the highway into the sunrise
        const p = prog(t, T.reveal, T.flare, ease.inOutCubic);
        const base = new THREE.Vector3(18.2, 0, -this.stationU);
        const pos = new THREE.Vector3(lerp(9, 4, p), lerp(14, 34, p), base.z - lerp(30, 60, p));
        return { pos, yaw: Math.PI - 0.1, pitch: lerp(-0.2, -0.3, p), roll: 0.02 * Math.sin(p * 3), fov: 50 };
      }
      case 'flare': {
        // behind the pylon, looking into the sun: the camera slides so the sun bursts past the panel's edge
        const p = prog(t, T.flare, this.S1 - 0.04, ease.inOutCubic);
        const sd = this.sunDir(t);
        const pyl = new THREE.Vector3(18.2, 0, -this.stationU);
        const side = new THREE.Vector3().crossVectors(sd, new THREE.Vector3(0, 1, 0)).normalize();
        const q = pyl.clone().add(new THREE.Vector3(0, this.station.panelY + 1.2, 0)).addScaledVector(side, lerp(-0.4, 2.35, p));
        const pos = q.clone().addScaledVector(sd, -17);
        const yaw = Math.atan2(sd.x, -sd.z) + lerp(0.05, -0.02, p);
        return { pos, yaw, pitch: Math.asin(sd.y) + 0.02, roll: lerp(-0.05, 0.03, p), fov: lerp(34, 40, p) };
      }
      default:
        return { pos: new THREE.Vector3(ROAD.laneX(1), 1.2, -s), yaw: 0, pitch: 0, roll: 0, fov: 50 };
    }
  }

  /** The sun: rises where it sank (behind us, +z), rim on "sun's", up on "coming up", higher by the end. */
  sunDir(t: number) {
    const L2 = this.L[2]!;
    const tSun = L2.words[2]!.start, tUp = L2.words[4]!.start;
    const el = t < tSun ? -1.6 * DEG + 0.4 * DEG * prog(t, this.T.l2, tSun)
      : lerp(-0.9, 0.7, prog(t, tSun, tUp + 0.3, ease.inOutCubic)) * DEG + 1.8 * DEG * prog(t, tUp + 0.3, this.T.l3, ease.outQuad) + 3.5 * DEG * prog(t, this.T.l3, this.W1, ease.inOutQuad);
    return new THREE.Vector3(0.1, Math.sin(el), 1).normalize();
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
    if (DBG().empty) { renderer.setRenderTarget(out); renderer.setClearColor(0, 1); renderer.clear(); return {}; }

    const T = this.T;
    const shot = this.shotAt(t);
    const L2 = this.L[2]!, L3 = this.L[3]!;
    const ws0 = this.L[0]!.words;

    // ---- dawn and the sun (behind us: +z)
    const tSun = L2.words[2]!.start, tUp = L2.words[4]!.start;
    const dawn = clamp(0.16 * prog(t, T.l2 - 0.4, tSun, ease.inOutQuad) + 0.44 * prog(t, tSun, L2.end, ease.inOutCubic) + 0.4 * prog(t, L2.end, this.S1, ease.linear));
    const sunDir = this.sunDir(t);
    const sunK = clamp(0.25 + 0.75 * prog(t, tSun - 0.3, tUp, ease.inOutQuad)) * (t > T.l2 - 0.5 ? 1 : 0) + 2.0 * prog(t, T.flare + 0.15, this.W1, ease.inQuad);

    if (shot === 'gauge') return this.renderGauge(t, f, out);

    // ---- camera
    const cam = this.camera(t, shot, f);
    this.applyCam(cam);
    const pos = cam.pos;
    const s = this.sAt(t), v = this.speed(t);

    // ---- world state
    this.sky.update(pos, t, dawn, sunDir, sunK, t);
    this.city.update(t, dawn, HU.uHazeLo.value);
    HU.uTime.value = t;
    const pov = shot !== 'dive' && shot !== 'reveal' && shot !== 'pylon';
    HU.uHeadOn.value = pov ? 1 - dawn * 0.6 : 0;
    HU.uHeadPos.value.set(pos.x + 0.35, 0.65, -s - 1.2);
    HU.uLampCol.value.copy(C('#ff9a3c', 115 * (1 - 0.55 * dawn)));
    // at dawn the streetlights behind us switch off, one more on every beat once the sun is up
    let offU = -1e5;
    const tOff = L2.words[5]!.start;
    if (t > tOff) {
      const nb = Math.floor(audio.beatAt(t) - audio.beatAt(tOff)) + 1;
      offU = this.sAt(tOff) - 230 + ROAD.lampP * nb;
    }
    HU.uLampOffU.value = offU;
    this.road.follow(pos);
    this.furn.update(Math.max(s, -pos.z), pos.x, t, HU.uHeadOn.value, 1);
    const camU = -pos.z;
    this.lamps.update(camU, HU.uLampCol.value, offU, 1 - 0.7 * dawn);
    this.traffic.update(t, camU, shot === 'dive' ? this.vDrone : v, shot === 'pylon' || shot === 'reveal' ? 0.5 : 1);
    this.land.update(camU, t);
    this.gantries.forEach((g, i) => (g.position.z = -this.gantryU[i]!));

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
    this.station.visible = (shot === 'station' || shot === 'pylon' || shot === 'reveal' || shot === 'flare') && dSt > -80 && dSt < 600;
    if (this.station.visible) {
      this.station.updateMatrixWorld(true);
      this.updateStation(t);
      this.station.pool(1);
    } else HU.uPoolCol.value.setRGB(0, 0, 0);

    // ---- the message sign
    this.vms.visible = shot === 'station' || shot === 'pylon';
    if (this.vms.visible) {
      const w = this.L[3]!.words;
      const starts = [0, 4, 8];
      Array.from('AND I’D PAY').forEach((_, i) => {
        const wi = i < 3 ? 0 : i < 7 ? 1 : 2;
        const ci = i - starts[wi]!;
        this.vms.row.on[i] = i === 3 || i === 7 ? 0 : t >= w[wi]!.start + ci * 0.03 ? 1 : 0;
      });
      this.vms.flash(((audio.beatAt(t) % 1) + 1) % 1, 1);
    }

    // ---- sun words
    this.arc.visible = shot === 'sun' || shot === 'mirror';
    const arcCenter = (from: THREE.Vector3) => from.clone().add(new THREE.Vector3(sunDir.x, 0, sunDir.z).normalize().multiplyScalar(900)).add(new THREE.Vector3(0, 35, 0));
    // ---- our bonnet in the approach POV (fixed to the car, not the camera)
    this.hood.visible = shot === 'mirror' || (shot === 'sun' && t < T.whip + 0.1);
    if (this.hood.visible) { this.hood.position.set(ROAD.laneX(1), 1.18, -s); this.hood.rotation.set(0, 0, 0); }
    // ---- interior
    this.interior.visible = shot === 'mirror' || (shot === 'sun' && t < T.whip + 0.1);

    // ---- passes: the wet road's reflection, the rear-view mirror, the frame
    const hideStars = this.sky.stars.visible;
    if (this.interior.visible) {
      // the view behind, for the mirror
      this.backCam.position.set(pos.x, 1.3, pos.z);
      this.backCam.rotation.set(0.05, Math.PI, 0, 'YXZ');
      this.backCam.updateMatrixWorld(true);
      this.backCam.updateProjectionMatrix();
      this.arc.update(t, arcCenter(this.backCam.position).add(new THREE.Vector3(0, 22, 0)), this.backCam, 1, true, 0.5, true);
      const iv = this.interior.visible;
      this.interior.visible = false;
      this.hood.visible = false;
      for (const g of this.gantries) g.visible = false;
      this.road.u.reflK!.value = 0.8;
      this.refl.render(renderer, this.hideFor(() => this.scene), this.backCam);
      this.unhide();
      renderer.setRenderTarget(this.mirrorRT);
      renderer.setClearColor(0x000000, 1);
      renderer.clear(true, true, true);
      renderer.render(this.scene, this.backCam);
      this.interior.visible = iv;
      this.hood.visible = iv;
      for (const g of this.gantries) g.visible = true;
      this.interior.glassU.sweep!.value = ((s / ROAD.lampP) % 1 + 1) % 1;
    }
    this.arc.update(t, arcCenter(pos), this.cam, 1, false);
    this.road.u.reflK!.value = 1;
    const iv2 = this.interior.visible, hv = this.hood.visible;
    this.interior.visible = false;
    this.hood.visible = false;
    if (!DBG().norefl) this.refl.render(renderer, this.hideFor(() => this.scene), this.cam); else this.hideFor(() => this.scene);
    this.unhide();
    this.sky.stars.visible = hideStars;
    this.interior.visible = iv2;
    this.hood.visible = hv;
    renderer.setRenderTarget(out);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    { const D = DBG(); if (D.noland) this.land.visible = false; if (D.nocity) this.city.visible = false; if (D.notraffic) this.traffic.visible = false;
      if (D.noroad) this.road.visible = false; if (D.nolamps) this.lamps.visible = false; if (D.nofurn) this.furn.visible = false; if (D.nosky) this.sky.visible = false;
      if (D.notrees) this.land.trees.visible = false; if (D.nocones) this.lamps.cones.visible = false; this.road.u.dbg!.value = (D as any).rdbg ?? 0; }
    renderer.render(this.scene, this.cam);
    this.land.visible = this.city.visible = this.traffic.visible = this.road.visible = this.lamps.visible = this.furn.visible = this.sky.visible = this.land.trees.visible = this.lamps.cones.visible = true;

    // ---- the sun's lens flare (once it is up and in view)
    let flareK = 0;
    if (shot === 'sun') flareK = 0.25 * prog(t, L2.words[3]!.start, L2.words[4]!.start + 0.3);
    else if (shot === 'reveal') flareK = 0.3;
    else if (shot === 'flare') {
      this.station.updateMatrixWorld(true);
      const vis = this.station.sunVisible(pos, sunDir, 0.02);
      flareK = 0.12 + 1.1 * vis + 1.5 * prog(t, this.S1 - 0.1, this.W1, ease.inQuad);
    }
    if (flareK > 0) this.flare.render(renderer, out, this.cam, sunDir, flareK * clamp(sunK), 0.4 + 0.15 * (-pos.x * 0.05));

    // ---- post
    let shake: [number, number] = [0, 0];
    for (const d of this.downs) {
      const k = pulse(t, d, 0.06) * (shot === 'boards' || shot === 'station' ? 1 : 0.6);
      if (k > 0.01) shake = [shake[0] + (hash(d, 1) - 0.5) * 8 * k, shake[1] + (hash(d, 2) - 0.5) * 8 * k];
    }
    const flare = prog(t, T.flare + 0.1, this.W1, ease.inQuad);
    const rush = clamp((v - 26) / 20, 0, 1) * (shot === 'dive' ? 1 : 0.5);
    void audio; void frameIdx; void L3; void BOARD_W;
    return {
      bloom: 0.85 + 0.6 * flare, bloomThreshold: 0.8 - 0.2 * flare, bloomRadius: 0.8, halation: 0.14 + 0.1 * dawn,
      vignette: 0.42 - 0.2 * flare, grain: 0.045, ca: 0.7 + 1.5 * rush, exposure: 1 + 1.2 * flare,
      zoom: 1 + 0.01 * f.a.kick, shake, flash: 0.9 * prog(t, this.S1 - 0.12, this.W1, ease.inQuad),
    };
  }

  /** Hide what the reflection must not see (the road itself, the stars). */
  private hideFor(fn: () => THREE.Scene) {
    this.road.visible = false;
    this.sky.stars.visible = false;
    for (const o of this.noRefl) o.visible = false;
    return fn();
  }
  private unhide() { for (const o of this.noRefl) o.visible = true; this.road.visible = true; }

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
          // spinning (a fixed rate, flicking a whole glyph at a time)
          const turns = (t - tSpin) * (14 + 3 * i);
          p = g0 + Math.floor(turns * 4) / 4;
          // last approach: decelerate into the target
          const tot = (land - tSpin) * (14 + 3 * i);
          const target = g1 + NG * Math.ceil((g0 + tot - g1) / NG);
          const k = prog(t, land - 0.28, land, ease.outCubic);
          p = lerp(p, target - 0.6, k);
        } else {
          const tot = (land - tSpin) * (14 + 3 * i);
          const target = g1 + NG * Math.ceil((g0 + tot - g1) / NG);
          p = target - 0.6 * (1 - springStep(t - land, 3.5, 0.45));
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
    // the needle: already low, slams to E on the cut's downbeat with a spring, trembles on the kicks
    const settle = springStep(t - T.gauge, 2.4, 0.32);
    let fuel = lerp(0.16, 0.0, settle) + 0.004 * f.a.kick * Math.sin(t * 50);
    fuel = Math.max(-0.02, fuel);
    // low-fuel lamp: on since "empty", blinking with the beat
    const ph = audio.beatAt(t) % 1;
    const lamp = t < tEmpty ? 0 : ph < 0.5 ? 1 : 0.12;
    const sweep = ((t - T.gauge) / 0.62) % 1;
    const push = prog(t, T.gauge, T.l1, ease.outCubic);
    const sh = pulse(t, T.gauge, 0.05);
    this.gauge.update(fuel, lamp, sweep, push, [0.03 * sh * (hash(T.gauge, 1) - 0.5), 0.03 * sh], 0.04 + 0.02 * noise1(t, 3));
    this.gauge.render(this.ctx.renderer, out);
    void frameIdx;
    return { bloom: 1.0, bloomThreshold: 0.75, bloomRadius: 0.75, halation: 0.2, vignette: 0.55, grain: 0.05, ca: 1.2, zoom: 1 + 0.015 * f.a.kick };
  }
}

const glyph = (ch: string) => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.’ $'.indexOf(ch);
const g6 = (groups: number[][]) => groups[groups.length - 1]![0]!;
