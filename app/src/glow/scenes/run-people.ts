// People of the run (chorus 2): the two heroes running (a real run, jumps, hands reaching and holding) and
// everyone they pass — grey ghosts who light up as the two go by, turn, and run after them — and the stream of
// glowing people behind them, growing all chorus long. Everything is a pure function of the song time.
import * as THREE from 'three';
import { applyLayers, type Layer } from '../lib/motion';
import type { RealFigure } from '../lib/people';
import { Crowd, type Person } from '../lib/crowd';
import { GlowPoints } from '../lib/points';
import { col } from '../lib/palette';
import { clamp, hash, noise1, smoothstep } from '../../engine/util';
import type { CycleMotion, Route } from './run-motion';

const V = () => new THREE.Vector3();

/** How a hero moves at a moment (filled by the scene each frame). */
export interface Stride {
  /** Feet position (world) and facing. */
  pos: THREE.Vector3;
  yaw: number;
  /** Run clip time (the scene keeps it continuous: distance / stride speed). */
  clipT: number;
  /** A jump: blend weight 0..1, progress 0..1 through the jump clip, extra lift of the pelvis (m). */
  jumpK?: number;
  jumpU?: number;
  lift?: number;
  /** A lean of the upper body (forward, rad), e.g. running down steps. */
  lean?: number;
}

/** Pose a hero from a stride: the run cycle, blended into the jump while airborne. */
export function poseStride(fig: RealFigure, run: CycleMotion, jump: CycleMotion | null, st: Stride, mirror = false) {
  const layers: Layer[] = [{ m: run, t: st.clipT, w: 1 - (st.jumpK ?? 0), mirror }];
  if (jump && (st.jumpK ?? 0) > 0.001) layers.push({ m: jump, t: clamp(st.jumpU ?? 0) * jump.P, w: st.jumpK!, mirror });
  applyLayers(fig, layers);
  fig.position.copy(st.pos);
  fig.position.y += fig.hipHeight + (st.lift ?? 0);
  fig.rotation.set(0, st.yaw, 0);
  fig.updateMatrixWorld(true);
}

/** A hand reaching to a world point (IK on top of the motion), weight k; pole = elbow hint (spine frame). */
export function reachTo(fig: RealFigure, i: number, target: THREE.Vector3, k: number, pole = new THREE.Vector3(i === 0 ? -0.5 : 0.5, -0.6, -0.3), curl = 0.3) {
  if (k <= 0.001) return;
  const h = fig.hand(i, V());
  fig.reach(i, h.lerp(target, k), pole);
  fig.setHand(i, curl);
}

/** A bystander: a grey ghost standing near the route who lights up when the two pass, then runs after them. */
export interface Joiner {
  look: 'light' | 'dust';
  body: 0 | 1;
  color: THREE.Color;
  /** Standing clip and its mirror. */
  idle: string;
  mirror?: boolean;
  /** Which leg (shot) they belong to; their spot: arc length on that leg's route, side offset, facing (abs. yaw). */
  leg: number;
  s: number;
  side: number;
  face: number;
  /** When they light up (set by the scene from when the two pass), and how long until they start running. */
  tj: number;
  go?: number;
  /** Where the light first touches them (local to the figure: x right, y up, z forward), for people of light. */
  touch?: THREE.Vector3;
  /** Their lane when running (side offset), and their pace (×). */
  lane: number;
  pace?: number;
  /** Keep running behind them in later shots, at this gap (m) — the first ones who joined. */
  stay?: number;
  p?: Person;
  grey?: THREE.Color;
}

export interface LegView {
  route: Route;
  /** The heroes' arc length on the route now. */
  sH: number;
  /** Stream speed (m/s). */
  v: number;
  index: number;
  /** Leave the companions out of this shot. */
  hideKept?: boolean;
  /** Keep the stream this much further back (m). */
  gapExtra?: number;
}

/**
 * Everyone but the heroes: bystanders per shot and the stream behind. One Crowd (lib/crowd.ts) draws them:
 * people of light near the camera, stardust further back.
 */
export class Folk {
  crowd: Crowd;
  joiners: Joiner[] = [];
  /** The stream: members with a gap behind the heroes, a lane, a time they are there from. */
  stream: { gap: number; lane: number; from: number; p: Person; ph: number; c: THREE.Color }[] = [];
  private grey = col('#a9b6cc', 0.75);
  private runs: CycleMotion[] = [];

  /** Far away a person is a soft point of light (so the stream reads from high up). */
  beacons = new GlowPoints(700, 0.8);

  constructor(dust: [number, number, number]) {
    this.crowd = new Crowd({ dust, dustGain: 0.1 });
    this.crowd.add(this.beacons);
  }

  async init(idles: string[], runs: CycleMotion[]) {
    await this.crowd.init(idles);
    this.runs = runs;
    runs.forEach((m, i) => this.crowd.addMotion(`run${i}`, m));
  }

  /** Clip speed for a runner of body b to cover v m/s. */
  rate(b: 0 | 1, k: number, v: number, figs: [RealFigure, RealFigure]) {
    const m = this.runs[k % this.runs.length]!;
    return v / m.speed(figs[b]);
  }

  addJoiner(j: Joiner, figs: [RealFigure, RealFigure], v: number) {
    const k = this.joiners.length;
    const run = k % this.runs.length, go = j.tj + (j.go ?? 0.35);
    j.grey = this.grey.clone().lerp(j.color, 0.12);
    const c = j.color.clone();
    j.p = this.crowd.addPerson({
      pos: V(), yaw: j.face, look: j.look, body: j.body, color: c, k: 0, mirror: j.mirror, offset: hash(k, 3) * 5,
      fade: 0.45,
      clips: [{ clip: j.idle, from: -1e9 }, { clip: `run${run}`, from: go, speed: this.rate(j.body, run, v * (j.pace ?? 1), figs), at: hash(k, 5) }],
      pose: j.look === 'light' ? (fig, t) => this.glowUp(j, fig, t) : undefined,
    });
    this.joiners.push(j);
    return j;
  }

  /** The stream: n members over gaps [g0, g1] behind, lanes ±w, appearing from times in `from(i)`. */
  addStream(n: number, g0: number, g1: number, w: number, from: (i: number) => number, colors: THREE.Color[], figs: [RealFigure, RealFigure], v: number) {
    for (let i = 0; i < n; i++) {
      const b = (hash(i, 11) < 0.5 ? 0 : 1) as 0 | 1, run = i % this.runs.length;
      const c = colors[Math.floor(hash(i, 12) * colors.length)]!.clone();
      const gap = g0 + (g1 - g0) * Math.pow((i + hash(i, 13)) / n, 1.5);
      const p = this.crowd.addPerson({
        pos: V(), yaw: 0, look: 'dust', body: b, color: c, k: 0, mirror: hash(i, 14) < 0.5, offset: hash(i, 15) * 3,
        clips: [{ clip: `run${run}`, from: -1e9, speed: this.rate(b, run, v * (0.97 + 0.06 * hash(i, 16)), figs), at: hash(i, 17) }],
      });
      this.stream.push({ gap, lane: (hash(i, 18) * 2 - 1) * w, from: from(i), p, ph: hash(i, 19) * 100, c });
    }
  }

  /** Light spreading over a person of light from where they were touched (the body material's gold wave). */
  private glowUp(j: Joiner, fig: RealFigure, t: number) {
    const u = fig.mat.uniforms as Record<string, THREE.IUniform>;
    const a = t - j.tj;
    (u.color!.value as THREE.Color).copy(j.grey!);
    (u.gold!.value as THREE.Color).copy(j.color);
    fig.updateMatrixWorld(true);
    const o = fig.localToWorld((j.touch ?? new THREE.Vector3(0, 0.35, 0.1)).clone());
    (u.goldO!.value as THREE.Vector3).copy(o);
    u.goldR!.value = a < 0 ? -1 : 0.05 + 2.6 * smoothstep(0, 0.9, a);
  }

  private _d = V();

  /** Place and light everyone for leg L at time t; returns the glows near (x, z) for the city lights. */
  update(t: number, leg: LegView, cam: THREE.Camera) {
    const R = leg.route;
    // bystanders of this leg
    for (const j of this.joiners) {
      const p = j.p!;
      const here = j.leg === leg.index, kept = j.stay !== undefined && leg.index > j.leg;
      if ((!here && !kept) || (kept && leg.hideKept)) { p.k = 0; continue; }
      const a = t - j.tj, go = j.tj + (j.go ?? 0.35);
      let s: number, side: number, yaw: number;
      if (kept) {
        s = leg.sH - j.stay! + 0.6 * noise1(t * 0.4, j.leg * 7 + j.s);
        side = j.lane;
        yaw = R.yaw(s);
      } else if (t < go) {
        s = j.s; side = j.side; yaw = j.face;
      } else {
        // off they go: accelerating to the stream's pace, drifting into their lane, turning to the route
        const g = t - go, tau = 0.45;
        s = j.s + leg.v * (j.pace ?? 1) * (g - tau * (1 - Math.exp(-g / tau)));
        const k = smoothstep(0, 1.1, g);
        side = j.side + (j.lane - j.side) * k;
        const ry = R.yaw(s);
        let dy = ry - j.face;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        yaw = j.face + dy * smoothstep(0, 0.55, g);
      }
      R.side(s, side, p.pos);
      p.yaw = yaw;
      // ghost → glowing: dim grey, then a flash and their own colour
      const lit = a < 0 ? 0 : 1;
      const flash = a < 0 ? 0 : Math.exp(-a * 3.5);
      if (j.look === 'dust') {
        p.color.copy(j.grey!).lerp(j.color, smoothstep(0, 0.5, a));
        p.k = (0.32 + 0.68 * lit * smoothstep(0, 0.5, a) + 1.6 * flash) * (kept ? 1 : 1);
      } else p.k = 0.5 + 0.5 * smoothstep(0, 0.6, Math.max(a, 0)) + 0.9 * flash;
    }
    // the stream
    for (const m of this.stream) {
      const p = m.p;
      if (t < m.from) { p.k = 0; continue; }
      const s = leg.sH - m.gap - (leg.gapExtra ?? 0) - 1.2 * noise1(t * 0.3 + m.ph, 3);
      if (s < -R.extendBack) { p.k = 0; continue; }
      R.side(s, m.lane + 0.5 * noise1(t * 0.25 + m.ph, 5), p.pos);
      p.yaw = R.yaw(s);
      p.k = smoothstep(m.from, m.from + 0.6, t) * (0.85 + 0.15 * Math.sin(t * 3 + m.ph));
    }
    this.crowd.update(t, cam);
    // far people: a soft glow at the chest
    const cp = cam.position, B = this.beacons;
    let n = 0;
    for (const p of this.crowd.people) {
      const k = typeof p.k === 'number' ? p.k : 0;
      if (k < 0.05 || n >= B.n) continue;
      const d = p.pos.distanceTo(cp);
      const f = smoothstep(14, 45, d);
      if (f <= 0) continue;
      B.set(n++, p.pos.x, p.pos.y + 1.15, p.pos.z, p.color, 1.3 * k * f, 1.2);
    }
    B.commit(n);
  }

  /** The brightest people near a point, as lights for the city's walls (max n). */
  glows(near: THREE.Vector3, n: number) {
    const out: { pos: THREE.Vector3; color: THREE.Color; radius: number; d: number }[] = [];
    for (const p of this.crowd.people) {
      const k = typeof p.k === 'number' ? p.k : 0;
      if (k < 0.3) continue;
      const d = p.pos.distanceTo(near);
      if (d > 60) continue;
      out.push({ pos: p.pos.clone().setY(p.pos.y + 1.2), color: p.color.clone().multiplyScalar(0.07 * Math.min(k, 1.5)), radius: 3, d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, n);
  }
}

export { clamp };
