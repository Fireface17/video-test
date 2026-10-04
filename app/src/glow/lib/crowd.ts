// A population: people placed in the world (in windows, on balconies and roofs, in the street), each moving
// with real motion capture (lib/motion.ts) on their own clip, time offset and mirror, following a schedule of
// clips (e.g. standing low, then on "put your hands up" the hands go up) with smooth crossfades. Each person
// is drawn either as a person of LIGHT (a full RealFigure with the glowing glass material — for people near the
// camera) or of STARDUST (lib/stardust.ts, cheap, for the many further away); the scene decides per person.
//
//   const crowd = new Crowd({ light: 24, dust: [8, 120, 600] });
//   await crowd.init(['77_02', '79_69', …]);
//   crowd.addPerson({ pos, yaw, look: 'light', color, k: 0.4, clips: [{ clip: '79_71', from: 0 }, { clip: '79_69', from: 31.6 }] });
//   crowd.update(t, camera);   // every frame
import * as THREE from 'three';
import { RealFigure, glowBodyMaterial, loadBody } from './people';
import { Stardust, StardustBody } from './stardust';
import { applyLayers, loadMotion, type JointTable, type Motion } from './motion';
import { col } from './palette';

export interface ClipCue {
  /** Clip id (app/public/mocap/<id>.bvh). */
  clip: string;
  /** Song time this clip takes over (crossfading over `fade` s). */
  from: number;
  /** Clip time at `from` (default: the person's offset + from). */
  at?: number;
  /** Playback speed (default 1). */
  speed?: number;
}

export interface Person {
  /** Feet on the ground at `pos` (the pelvis is placed hipHeight above it), facing `yaw` (0 = +z). */
  pos: THREE.Vector3;
  yaw: number;
  look: 'light' | 'dust';
  /** 0 = the man's body (rpm), 1 = the woman's (michelle). */
  body?: 0 | 1;
  color: THREE.Color;
  /** Brightness 0..; a function of time for fades, flicker, the moment someone lights up. */
  k: number | ((t: number) => number);
  scale?: number;
  mirror?: boolean;
  /** Seconds added to the clip time (people never move in sync). */
  offset?: number;
  clips: ClipCue[];
  /** Crossfade length between cues (s). */
  fade?: number;
  /** Extra posing after the mocap (light people only): e.g. reach for something. */
  pose?: (fig: RealFigure, t: number) => void;
  /** Set by the crowd: the figure drawing a light person. */
  fig?: RealFigure;
}

export class Crowd extends THREE.Group {
  people: Person[] = [];
  dust!: Stardust;
  private motions = new Map<string, Motion>();
  private bodies: RealFigure[] = []; // joint-table bakers
  private dustBodies: StardustBody[] = [];
  private gltf: Awaited<ReturnType<typeof loadBody>>[] = [];
  private js: THREE.Vector3[] = [];
  private J0 = new Float32Array(39);
  private J1 = new Float32Array(39);
  private q = new THREE.Quaternion();

  constructor(public o: { light?: number; dust?: [number, number, number]; dustGain?: number } = {}) {
    super();
  }

  async init(clips: string[]) {
    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    this.gltf = [rp, mi];
    const ms = await Promise.all(clips.map((c) => loadMotion(c)));
    clips.forEach((c, i) => this.motions.set(c, ms[i]!));
    this.bodies = [new RealFigure(rp, 'rpm', col('white')), new RealFigure(mi, 'michelle', col('white'))];
    this.dustBodies = [new StardustBody(new RealFigure(rp, 'rpm', col('white')), 22000, 1), new StardustBody(new RealFigure(mi, 'michelle', col('white')), 22000, 2)];
    this.dust = new Stardust(this.dustBodies, this.o.dust ?? [8, 80, 400], { gain: this.o.dustGain ?? 0.09 });
    this.add(this.dust);
  }

  /** Register a motion under an id of your own (e.g. a looped stride cycle) for people's clip cues. */
  addMotion(id: string, m: Motion) {
    this.motions.set(id, m);
  }

  /** Add a person (light people get their own figure). */
  addPerson(p: Person) {
    p.body ??= this.people.length % 2 as 0 | 1;
    p.offset ??= (this.people.length * 2.731) % 17;
    p.mirror ??= this.people.length % 3 === 1;
    if (p.look === 'light') {
      const b = p.body ?? 0;
      p.fig = new RealFigure(this.gltf[b]!, b ? 'michelle' : 'rpm', p.color, glowBodyMaterial(p.color));
      this.add(p.fig);
    }
    this.people.push(p);
    return p;
  }

  private motion(id: string) {
    const m = this.motions.get(id);
    if (!m) throw new Error(`crowd: clip ${id} not loaded (pass it to init)`);
    return m;
  }

  /** The two cues around time t and the weight of the newer one. */
  private cues(p: Person, t: number): [ClipCue, ClipCue | null, number] {
    let i = 0;
    for (let k = 0; k < p.clips.length; k++) if (p.clips[k]!.from <= t) i = k;
    const cur = p.clips[i]!, prev = i > 0 ? p.clips[i - 1]! : null;
    const f = p.fade ?? 0.6, w = prev ? Math.min(1, (t - cur.from) / f) : 1;
    return [cur, prev, w * w * (3 - 2 * w)];
  }

  private clipTime(p: Person, c: ClipCue, t: number) {
    return (c.at ?? (p.offset ?? 0) + c.from) + (t - c.from) * (c.speed ?? 1);
  }

  /** Pose and draw everyone at song time t (call once per frame). */
  update(t: number, cam: THREE.Camera) {
    this.updateMatrixWorld();
    const D = this.dust;
    D.time = t * 3;
    D.begin(cam);
    for (const p of this.people) {
      const k = typeof p.k === 'number' ? p.k : p.k(t);
      const [cur, prev, w] = this.cues(p, t);
      const s = p.scale ?? 1;
      if (p.look === 'light') {
        const fig = p.fig!;
        fig.visible = k > 0.002;
        if (!fig.visible) continue;
        fig.position.copy(p.pos).add(new THREE.Vector3(0, fig.hipHeight * s, 0));
        fig.rotation.set(0, p.yaw, 0);
        fig.scale.setScalar(s);
        const layers = [{ m: this.motion(cur.clip), t: this.clipTime(p, cur, t), w, loop: true, mirror: p.mirror }];
        if (prev && w < 1) layers.unshift({ m: this.motion(prev.clip), t: this.clipTime(p, prev, t), w: 1 - w, loop: true, mirror: p.mirror });
        applyLayers(fig, layers);
        p.pose?.(fig, t);
        fig.time = t;
        const u = (fig.mat.uniforms as Record<string, THREE.IUniform>).level;
        if (u) u.value = k;
        continue;
      }
      if (k <= 0.002) continue;
      const fig = this.bodies[p.body ?? 0]!;
      const tb = (c: ClipCue): JointTable => this.motion(c.clip).joints(fig, { mirror: p.mirror });
      tb(cur).at(this.clipTime(p, cur, t), this.J1);
      if (prev && w < 1) {
        tb(prev).at(this.clipTime(p, prev, t), this.J0);
        for (let i = 0; i < 39; i++) this.J1[i] = this.J0[i]! + (this.J1[i]! - this.J0[i]!) * w;
      }
      // joints are in the pelvis frame (pelvis at the origin): stand the person on `pos`, turn by yaw
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
      const hip = fig.hipHeight * s;
      for (let i = 0; i < 13; i++) {
        const v = (this.js[i] ??= new THREE.Vector3()).set(this.J1[i * 3]!, this.J1[i * 3 + 1]!, this.J1[i * 3 + 2]!).multiplyScalar(s).applyQuaternion(this.q);
        v.x += p.pos.x; v.y += p.pos.y + hip; v.z += p.pos.z;
      }
      D.figure(this.js, p.body ?? 0, p.color, k, { seed: (p.offset ?? 0) * 3.1 });
    }
    D.end();
  }
}

