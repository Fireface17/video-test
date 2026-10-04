// How the people of the drops move: real motion capture (lib/motion.ts, CMU clips retargeted onto our
// bodies). Every crowd person's joints come from ONE function, `Moves.pose(mover, t)`: their own clip, body,
// time offset, playback rate and mirror, so no two neighbours move alike. Heroes (the giants, the people who
// reach for each other) are posed on a RealFigure with `Moves.apply` and get IK on top for hand-holding.
import type { RealFigure } from '../lib/people';
import { loadMotion, type JointTable, type Motion } from '../lib/motion';
import type { Pose } from './cosmos-gfx';

/** Dancing clips (expressive, salsa, lambada, twist, happy with arms up…) and calmer ones (standing, idle). */
export const DANCE = ['05_02', '05_12', '49_09', '49_12', '55_01', '55_02', '60_02', '61_02', '111_05', '113_04', '141_12', '120_05', '79_69', '80_43', '94_01'];
export const IDLE = ['140_06', '77_02', '111_28'];

/** A person's motion: clip, body kind, where in the clip (s), how fast, mirrored or not (mirroring is done by `place`). */
export interface Mover { clip: number; body: number; off: number; rate: number; mirror: boolean }

export class Moves {
  private tables: JointTable[][] = []; // [clip][body]

  private constructor(public names: string[], public clips: Motion[], bodies: RealFigure[]) {
    for (const m of clips) this.tables.push(bodies.map((b) => m.joints(b)));
  }

  /** Load the clips and bake their joint tables for each body kind (one RealFigure per kind). */
  static async load(names: string[], bodies: RealFigure[]) {
    const clips = await Promise.all(names.map((n) => loadMotion(n)));
    return new Moves(names, clips, bodies);
  }

  index(name: string) { return this.names.indexOf(name); }

  /** THE pose function: a person's 13 star joints (pelvis frame, unmirrored) at song time `t`. */
  pose(m: Mover, t: number, out: Pose = new Float32Array(39)): Pose {
    return this.tables[m.clip]![m.body % this.tables[m.clip]!.length]!.at(m.off + t * m.rate, out);
  }

  /** Pose a hero's RealFigure (at its own transform) from the same mover. */
  apply(fig: RealFigure, m: Mover, t: number) {
    const clip = this.clips[m.clip]!;
    clip.apply(fig, m.off + t * m.rate, { loop: true, mirror: m.mirror });
  }
}
