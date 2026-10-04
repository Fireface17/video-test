// Verse 1, "Night drive": a low camera over a wet night highway, lane dashes and cat's eyes streaming
// toward us, a dusk-blue haze and the glow of a far city on the horizon. Each sung line is a modest neon
// sign; the props of each line carry the picture:
//   L00 "We were running on an empty tank"   we start in the car: the fuel needle sinks to E, the
//                                             low-fuel lamp blinks amber on the beat; the sign is on a
//                                             gantry ahead; at the end we fly out of the car under it
//   L01 "Painting smiles on the days…"       calendar billboards (MON, TUE, WED) pass on both sides, a
//                                             smiley painted on each in phosphor as the words are sung
//   L02 "Now the sun's coming up where it sank"  the horizon turns gold and the sun rises ahead, its
//                                             gold path on the wet asphalt (the only gold of the scene)
//   L03 "And I'd pay any cost"               we drift right toward a gas station; the pylon's price
//                                             drums roll on "pay" and stop on ANY / COST as they're sung
// The sign gantries live in the "sign world" the camera travels through slowly while a line is sung
// (so the sign stays readable) and fast between lines (each sign sweeps overhead); the road streams by
// a steady 11.5 m/s faster (highway-env.ts).
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, frameIdx, hash, lerp, noise1, prog, pulse, smoothstep, springStep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { flickerOn } from '../lib/neon';
import { ROAD, Road, Roadside, makeSky, skyPoints, skyUniforms, type SkyU } from './highway-env';
import { Billboard, Dashboard, Gantry, Station, makeSun } from './highway-props';

const FOG = 0.013;
const EYE = 1.1;
const V_BASE = 2.0; // sign-world speed while a line is sung (m/s)
const V_ROAD = 11.5; // the road world streams this much faster
const FOV = 40;
const DEG = Math.PI / 180;
const DASH_PITCH = 3.6 * DEG; // camera pitch the dashboard was laid out for

interface Whoosh { t0: number; t1: number; A: number }
interface Board { b: Billboard; u: number; side: number; strokes: [number, number][] }

export default class Highway extends Scene {
  st = new Stage(FOV, 0.05, 4000);
  sky!: SkyU;
  skyMesh!: THREE.Mesh;
  stars!: THREE.Points;
  road!: Road;
  side!: Roadside;
  lines: Line[] = [];
  gantries: Gantry[] = [];
  /** sign-world positions (distance along the road) of the gantries and the pylon */
  S: number[] = [];
  tw: number[] = []; // whoosh start per line
  ta: number[] = []; // arrival (next line's start)
  downbeats: number[] = [];
  whooshes: Whoosh[] = [];
  // travel tables
  private T0 = 0;
  private DT = 1 / 1000;
  private sTab = new Float32Array(0);
  dash!: Dashboard;
  boards: Board[] = [];
  station!: Station;
  sun!: THREE.Mesh;
  spill!: THREE.PointLight;
  hemi!: THREE.HemisphereLight;
  pylonX = 10.2;
  stationLine!: Line;

  override async init() {
    const { lyrics, audio, start, end } = this.ctx;
    const S = this.st.scene;
    this.lines = [lyrics.get('We were running'), lyrics.get('Painting smiles'), lyrics.get('Now the sun'), lyrics.get('And I’d pay')];
    this.stationLine = this.lines[3]!;
    this.downbeats = audio.downbeats.filter((d) => d > start + 0.2 && d < end);
    // whoosh windows: from when the line's last word has lit (or near the line's end) to the next line
    for (let i = 0; i < 4; i++) {
      const l = this.lines[i]!, last = l.words[l.words.length - 1]!;
      this.tw.push(Math.max(last.start + 0.38, l.end - 0.5));
      // (the last one runs on through the burn-out transition into the pre-chorus)
      this.ta.push(i < 3 ? this.lines[i + 1]!.start - 0.03 : end + 0.4);
    }

    this.st.bg.copy(col('night'));
    this.st.fog(col('dusk', 1.45), FOG);
    S.add(this.st.cam);
    this.sky = skyUniforms();
    this.skyMesh = makeSky(this.sky);
    this.stars = skyPoints();
    this.road = new Road(this.sky);
    this.road.u.fogD!.value = FOG;
    this.side = new Roadside(FOG);
    S.add(this.skyMesh, this.stars, this.road, this.side);
    this.hemi = new THREE.HemisphereLight(new THREE.Color('#4a5cb0'), new THREE.Color('#0a0c1a'), 1.1);
    this.spill = new THREE.PointLight(col('pink'), 0, 24, 1.6);
    S.add(this.hemi, this.spill);

    const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2e3658'), roughness: 0.5, metalness: 0.45 });
    const panel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0c1028'), roughness: 0.85 });
    const board = new THREE.MeshStandardMaterial({ color: new THREE.Color('#151b3a'), roughness: 0.8 });
    const slab = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c2238'), roughness: 0.95 });

    // the three sign gantries
    const specs = [
      { rows: [[0, 1, 2], [3, 4, 5, 6]], color: col('pink', 2.3), inkWidth: 10.2, centerY: 5.4 },
      { rows: [[0, 1, 2], [3, 4, 5, 6, 7]], color: col('phosphor', 2.0), inkWidth: 10.8, centerY: 5.5 },
      { rows: [[0, 1, 2, 3], [4, 5, 6, 7]], color: col('cyan', 2.3), inkWidth: 11.0, centerY: 5.9 },
    ];
    specs.forEach((sp, i) => {
      const g = new Gantry(this.lines[i]!, { ...sp, sx: 0.88, font: 'script' }, steel, panel);
      this.gantries.push(g);
      S.add(g);
    });

    this.buildTravel();
    this.gantries.forEach((g, i) => (g.position.z = -this.S[i]!));

    // dashboard (in the car for the first line)
    this.dash = new Dashboard(0.17);
    this.st.cam.add(this.dash);

    // calendar billboards, in the road world, painted on the words of L01
    const l1 = this.lines[1]!, w = l1.words;
    const plan: { day: string; side: number; strokes: [number, number][] }[] = [
      { day: 'MON', side: 1, strokes: [[w[0]!.start, w[0]!.end], [w[1]!.start, w[1]!.start + 0.12], [w[1]!.start + 0.1, w[1]!.start + 0.22], [w[1]!.start + 0.22, w[1]!.end]] },
      { day: 'TUE', side: -1, strokes: [[w[2]!.start, w[3]!.end], [w[4]!.start, w[4]!.start + 0.07], [w[4]!.start + 0.06, w[4]!.start + 0.13], [w[4]!.start + 0.13, w[4]!.end]] },
      { day: 'WED', side: 1, strokes: [[w[5]!.start, w[6]!.end], [w[7]!.start, w[7]!.start + 0.1], [w[7]!.start + 0.09, w[7]!.start + 0.19], [w[7]!.start + 0.19, w[7]!.start + 0.6]] },
      { day: 'THU', side: -1, strokes: [] },
    ];
    plan.forEach((p, i) => {
      const b = new Billboard(p.day, 31 + i * 7, { board, steel });
      const t0 = p.strokes[0]?.[0] ?? w[7]!.start;
      // the board is ~38 m ahead when its first stroke starts (the last, unpainted one trails WED)
      const u = this.sRoad(t0) + 38 + (i === 3 ? 20 : 0);
      b.rotation.y = -p.side * 0.42;
      S.add(b);
      this.boards.push({ b, u, side: p.side, strokes: p.strokes });
    });

    // gas station: pylon at the right roadside, the canopy behind it
    this.station = new Station(this.stationLine, { steel, board, slab });
    this.station.position.set(this.pylonX, 0, -this.S[3]!);
    this.station.canopy.position.set(12.5, 0, -15);
    S.add(this.station);

    this.sun = makeSun();
    S.add(this.sun);
  }

  // ---------------------------------------------------------------- travel

  /** Sign-world speed without whooshes: cruise plus a lunge on every downbeat. */
  private vBase(t: number) {
    let v = V_BASE;
    for (const d of this.downbeats) {
      const dt = t - d;
      if (dt > -0.03 && dt < 1.5) v += 3.2 * Math.exp(-Math.max(0, dt) / 0.22) * smoothstep(-0.03, 0.04, dt);
    }
    return v;
  }

  private vSign(t: number) {
    let v = this.vBase(t);
    for (const w of this.whooshes) {
      if (t > w.t0 && t < w.t1) {
        const u = (t - w.t0) / (w.t1 - w.t0);
        v += w.A * Math.pow(u, 1.6) * Math.pow(1 - u, 2.2);
      }
    }
    return v;
  }

  private integrate() {
    const n = this.sTab.length;
    let s = 0;
    this.sTab[0] = 0;
    for (let i = 1; i < n; i++) {
      const t = this.T0 + i * this.DT;
      s += 0.5 * (this.vSign(t - this.DT) + this.vSign(t)) * this.DT;
      this.sTab[i] = s;
    }
  }

  /** Sign-world travel at t. */
  sSign(t: number) {
    const x = (t - this.T0) / this.DT, n = this.sTab.length;
    if (x <= 0) return this.sTab[0]! + (t - this.T0) * V_BASE;
    if (x >= n - 1) return this.sTab[n - 1]! + (t - (this.T0 + (n - 1) * this.DT)) * V_BASE;
    const i = Math.floor(x), f = x - i;
    return this.sTab[i]! * (1 - f) + this.sTab[i + 1]! * f;
  }
  /** Road-world travel at t. */
  sRoad(t: number) { return this.sSign(t) + this.off(t); }
  off(t: number) { return V_ROAD * (t - this.ctx.start); }

  private buildTravel() {
    const { start, end } = this.ctx;
    this.T0 = start - 1;
    this.sTab = new Float32Array(Math.ceil((end + 1.5 - this.T0) / this.DT) + 2);
    const D0 = [28, 28, 28, 26];
    const PASS = 3.5;
    const bellInt = (() => { let s = 0; const N = 2000; for (let i = 0; i < N; i++) { const u = (i + 0.5) / N; s += Math.pow(u, 1.6) * Math.pow(1 - u, 2.2) / N; } return s; })();
    this.integrate();
    for (let i = 0; i < 4; i++) {
      this.S[i] = this.sSign(this.lines[i]!.start) + D0[i]!;
      // how far the whoosh must carry us: past this sign (or, for the pylon, alongside it)
      const target = i < 3 ? this.S[i]! + PASS : this.S[i]! + 1.5;
      const need = target - this.sSign(this.ta[i]!);
      const T = this.ta[i]! - this.tw[i]!;
      this.whooshes.push({ t0: this.tw[i]!, t1: this.ta[i]!, A: Math.max(0, need) / (bellInt * T) });
      this.integrate();
    }
  }

  /** Index of the line whose stretch of road we're on (0..3). */
  private seg(t: number) {
    for (let i = 0; i < 3; i++) if (t < this.ta[i]!) return i;
    return 3;
  }

  // ---------------------------------------------------------------- camera

  private camera(t: number, f: Frame) {
    const { audio } = this.ctx;
    const sS = this.sSign(t);
    const i = this.seg(t);
    // lateral: gentle sway, a lane drift in each whoosh, and a move to the right lane for the station
    const toStation = prog(t, this.tw[2]! - 0.1, this.lines[3]!.start + 0.9, ease.inOutCubic);
    let x = noise1(t * 0.23, 3) * 0.35 + toStation * ROAD.lane;
    for (let k = 0; k < 2; k++) {
      const p = prog(t, this.tw[k]!, this.ta[k]! + 0.4, ease.inOutCubic);
      x += Math.sin(p * Math.PI) * (k % 2 ? -0.7 : 0.7);
    }
    // vertical: road bumps on the kicks, a dip under each sign
    let y = EYE - 0.018 * f.a.kick + noise1(t * 1.7, 5) * 0.012;
    for (let k = 0; k < 3; k++) y -= 0.12 * Math.sin(prog(t, this.tw[k]!, this.ta[k]!) * Math.PI);
    const pos = new THREE.Vector3(x, y, -sS);

    // pitch follows the current sign (rising as it comes overhead), then hands over to the next one
    const pitchFor = (k: number) => {
      if (k >= 3) {
        const d = Math.max(this.S[3]! - sS, 4);
        return clamp(Math.atan2(this.station.panelY + 0.6 - y, d) * 0.5, 3 * DEG, 9 * DEG);
      }
      const g = this.gantries[k]!, d = Math.max(this.S[k]! - sS, 3);
      return clamp(Math.atan2(g.cy - y, d) * 0.42, 2.5 * DEG, 12 * DEG);
    };
    let pitch = pitchFor(i);
    if (i < 3) pitch = lerp(pitch, pitchFor(i + 1), smoothstep(this.tw[i]! + 0.55 * (this.ta[i]! - this.tw[i]!), this.ta[i]! + 0.08, t));
    // the opening: the camera tilts down out of the night sky onto the road
    pitch += 40 * DEG * (1 - prog(t, this.ctx.start - 0.26, this.lines[0]!.start + 0.04, ease.outCubic));
    // yaw: a glance toward the board being painted (L01), toward the pylon (L03)
    let yaw = noise1(t * 0.17, 8) * 0.012;
    for (const bd of this.boards) {
      if (!bd.strokes.length) continue;
      const k = smoothstep(bd.strokes[0]![0] - 0.25, bd.strokes[0]![0] + 0.25, t) * (1 - smoothstep(bd.strokes[3]![1] - 0.1, bd.strokes[3]![1] + 0.35, t));
      yaw += bd.side * 0.05 * k;
    }
    const dP = this.S[3]! - sS;
    const yP = Math.atan2(this.pylonX - x, Math.max(dP, 2));
    yaw += toStation * clamp(yP * 0.6, 0, 0.5) * (1 - smoothstep(this.tw[3]!, this.ctx.end + 0.3, t) * 0.5);
    // roll: slow sway, a lean through each whoosh, a kick on downbeats
    let roll = noise1(t * 0.31, 11) * 0.008;
    for (let k = 0; k < 3; k++) roll += (k % 2 ? 1 : -1) * 0.035 * Math.sin(prog(t, this.tw[k]!, this.ta[k]! + 0.2, ease.inOutQuad) * Math.PI);
    for (const d of this.downbeats) if (t > d && t < d + 1) roll += 0.006 * Math.sin((t - d) * 18) * Math.exp(-(t - d) * 5) * (hash(d, 3) > 0.5 ? 1 : -1);
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    aim(this.st.cam, pos, pos.clone().add(dir), roll);
    this.dash.rotation.set(DASH_PITCH - pitch, 0, roll, 'ZXY');
    // lens: widen with speed, a small punch on kicks
    const speed = this.vSign(t);
    this.st.cam.fov = FOV + clamp((speed - 6) / 60, 0, 1) * 9 - 0.6 * f.a.kick;
    this.st.cam.updateProjectionMatrix();
    return { pos, sS, i, speed };
  }

  // ---------------------------------------------------------------- frame

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, { audio } = this.ctx;
    const { pos, sS, i: seg, speed } = this.camera(t, f);
    const sR = this.sRoad(t), off = this.off(t);
    const cam = this.st.cam;
    const fogAt = (d: number) => Math.exp(-((FOG * d) ** 2));

    // sky, stars, road
    this.skyMesh.position.copy(pos);
    this.stars.position.copy(pos);
    this.road.follow(pos);
    this.road.u.off!.value = off;
    this.side.update(pos.z, sR, off, 1);

    // ---- the sun (L02 onward): rises where it sank, the horizon turns gold
    const l2 = this.lines[2]!, w2 = l2.words;
    const warm = smoothstep(w2[0]!.start, w2[2]!.start + 0.6, t) * 0.75 + smoothstep(w2[4]!.start, l2.end, t) * 0.25;
    const rise = keysRise(t, w2[2]!.start, w2[3]!.start, w2[4]!.end, l2.end, this.ctx.end);
    const SUN_R = 0.06; // angular radius
    const sunEl = (rise - 1) * SUN_R; // centre elevation: -R (hidden) .. above
    const sunDir = new THREE.Vector3(0, Math.sin(sunEl), -Math.cos(sunEl));
    (this.sky.uSunDir.value as THREE.Vector3).copy(sunDir);
    this.sky.uSun.value.copy(col('gold', 1.25 * warm)).lerp(col('ember', 1.25 * warm), 0.35);
    this.sky.uWarm.value = warm;
    this.sun.visible = rise > 0.001;
    if (this.sun.visible) {
      const D = 1500;
      this.sun.position.copy(pos).addScaledVector(sunDir, D);
      this.sun.quaternion.copy(cam.quaternion);
      this.sun.scale.setScalar(Math.tan(SUN_R) * D);
      (this.sun.material as THREE.ShaderMaterial).uniforms.k!.value = smoothstep(0, 0.25, rise);
    }
    this.road.setGlint(2, pos.x, Math.max(sunEl, 0.004) * 1500, pos.z - 1500, SUN_R * 1500, SUN_R * 1500 * 0.6, col('gold'), 1.5 * warm * smoothstep(0.0, 0.5, rise) + 0.25 * warm);
    // the far city: a broad faint bluish sheen
    this.road.setGlint(3, pos.x, 6, pos.z - 1500, 360, 6, col('blue'), 0.07);
    // headlights: on in the car, a little softer once we fly free
    this.road.u.headK!.value = 1.15 - 0.35 * smoothstep(this.tw[0]!, this.ta[0]!, t);

    // ---- gantries: karaoke, spill light, reflections on the wet road
    this.spill.intensity = 0;
    this.road.clearGlint(0);
    this.road.clearGlint(1);
    this.gantries.forEach((g, k) => {
      const d = this.S[k]! - sS;
      g.visible = d > -8 && d < 260;
      if (!g.visible) return;
      // flown past: the light dies with the line (it's behind us anyway)
      const lit = g.update(t, fogAt(d));
      if (k === seg || (k === seg - 1 && d > -6)) {
        const c = (g.sign.rows[0]!.sign.words[0]!.mat.uniforms.color!.value as THREE.Color);
        this.road.setGlint(k === seg ? 0 : 1, 0, g.cy, g.position.z + 0.9, g.inkW * 0.3, g.inkH / 2, c, 0.22 * lit * fogAt(Math.max(d, 0)));
        if (k === seg) {
          this.spill.color.copy(c).multiplyScalar(1 / Math.max(c.r, c.g, c.b));
          this.spill.position.set(0, g.cy - 0.4, g.position.z + 4.5);
          this.spill.intensity = 22 * lit;
        }
      }
    });

    // ---- L00: the dashboard (we're in the car until the first sign flies over us)
    const l0 = this.lines[0]!, w0 = l0.words;
    const exit = prog(t, this.tw[0]! + 0.05, this.tw[0]! + 0.42, ease.inCubic);
    this.dash.visible = exit < 1;
    if (this.dash.visible) {
      const tEmpty = w0[5]!.start, tTank = w0[6]!.start;
      let fuel = 0.36 - 0.08 * prog(t, w0[0]!.start, tEmpty, ease.inOutQuad);
      fuel -= 0.2 * springStep(t - tEmpty, 2.0, 0.45);
      fuel -= 0.085 * springStep(t - tTank, 2.6, 0.38);
      fuel += 0.006 * f.a.kick * Math.sin(t * 40);
      const ph = audio.beatAt(t) % 1;
      const lamp = t < tEmpty ? 0 : t < tEmpty + 0.12 ? flickerOn(t, tEmpty, 5) : ph < 0.55 ? 1 : 0.1;
      this.dash.update(fuel, lamp, 1);
      this.dash.position.set(0, -0.8 * exit + 0.004 * noise1(t * 6, 2), 0.6 * exit);
    }

    // ---- L01: calendar billboards pass on both sides, smiles painted on the words
    for (const bd of this.boards) {
      const z = off - bd.u, d = bd.u - sR;
      bd.b.visible = d > -10 && d < 200;
      if (!bd.b.visible) continue;
      bd.b.position.set(bd.side * 11.6, 0, z);
      const p = bd.strokes.map(([a, b]) => prog(t, a, b, ease.inOutQuad)) as number[];
      while (p.length < 4) p.push(0);
      bd.b.update(fogAt(Math.max(d, 0)) * (0.9 + 0.1 * noise1(t * 7, bd.u)), p as [number, number, number, number], 1);
    }
    // the painted smile currently in progress reflects on the road
    const painting = this.boards.find((bd) => bd.strokes.length && t > bd.strokes[0]![0] && t < bd.strokes[3]![1] + 0.8);
    if (painting) this.road.setGlint(5, painting.b.position.x, 3.2, painting.b.position.z, 1.6, 1.6, col('phosphor'), 0.05);
    else this.road.clearGlint(5);

    // ---- L03: the gas station
    const dP = this.S[3]! - sS;
    this.station.visible = dP > -30 && dP < 300;
    if (this.station.visible) {
      const l3 = this.stationLine, w3 = l3.words;
      const power = 0.15 + 0.85 * smoothstep(this.tw[2]! - 0.6, this.lines[3]!.start, t);
      this.station.update(t, (k) => flickerOn(t, w3[k]!.start, k * 7 + l3.i), w3[2]!.start, [w3[3]!.start, w3[4]!.start], power);
      this.station.fascia.color.copy(col('cyan', 1.7 * power));
      this.station.under.color.copy(col('#dff3ff', 1.5 * power));
      this.station.light.intensity = 140 * power;
      const cz = this.station.position.z + this.station.canopy.position.z;
      this.road.setGlint(4, this.pylonX + 12.5, 5.9, cz + 9.5, 7.5, 0.5, col('cyan'), 0.35 * power * fogAt(Math.max(dP, 0)));
      this.road.u.pool!.value.set(this.pylonX + 12.5, cz, 14, 0);
      this.road.u.poolCol!.value.copy(col('#cfe9ff', 2.2 * power));
      const hd = this.station.header.words.reduce((s, w) => s + (w.mat.uniforms.on!.value as number), 0) / 3;
      this.road.setGlint(1, this.pylonX, this.station.panelY + 3.3, this.station.position.z + 0.3, 3.8, 1.0, col('pink'), 0.4 * hd * fogAt(Math.max(dP, 0)));
    } else {
      this.road.clearGlint(4);
      this.road.u.poolCol!.value.setRGB(0, 0, 0);
    }

    this.st.render(this.ctx.renderer, out);

    // ---- post: hits on downbeats, a rush in the whooshes
    let shake: [number, number] = [0, 0];
    for (const d of this.downbeats) {
      const k = pulse(t, d, 0.07);
      if (k > 0.01) shake = [shake[0] + (hash(d, 1) - 0.5) * 7 * k, shake[1] + (hash(d, 2) - 0.5) * 7 * k];
    }
    const rush = clamp((speed - 8) / 70, 0, 1);
    return {
      bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85 - 0.1 * warm, halation: 0.12,
      vignette: 0.45 + 0.1 * rush, grain: 0.05, ca: 0.8 + 2.2 * rush,
      zoom: 1 + 0.012 * f.a.kick + 0.02 * rush, shake,
    };
  }
}

/** Sun rise 0 (hidden) .. 1 (centre on the horizon) .. ~1.75: rim at "sun's", up on "coming up", slow after. */
function keysRise(t: number, tSun: number, tComing: number, tUpEnd: number, tLineEnd: number, tEnd: number) {
  if (t < tSun) return 0;
  if (t < tComing) return 0.3 * prog(t, tSun, tComing, ease.outQuad);
  if (t < tUpEnd + 0.15) return lerp(0.3, 1.05, prog(t, tComing, tUpEnd + 0.15, ease.inOutCubic));
  if (t < tLineEnd) return lerp(1.05, 1.4, prog(t, tUpEnd + 0.15, tLineEnd, ease.outQuad));
  return lerp(1.4, 1.65, prog(t, tLineEnd, tEnd, ease.linear));
}
