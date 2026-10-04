// Real human motion: motion-capture clips (BVH, the CMU Graphics Lab Motion Capture Database; see
// app/public/mocap/CREDITS.md) retargeted onto our realistic bodies (lib/people.ts), so people move like
// people — weight shifts, follow-through, no two alike — instead of being posed procedurally.
//
// Retargeting works on world rotations relative to the rest pose: the clip's skeleton stands in a T-pose with
// zero rotations, our bodies are first turned into the same T-pose (each bone aimed along the clip skeleton's
// rest direction), and then every frame each bone gets the clip bone's change of world rotation on top of that.
// Root motion is scaled by hip height; `inPlace` keeps the bob and sway but removes wandering across the floor.
//
//   const m = await loadMotion('dance-a');           // app/public/mocap/<name>.bvh
//   m.apply(fig, t, { loop: true });                  // pose a RealFigure at clip time t
//   applyLayers(fig, [{ m: idle, t, w: 1 - k }, { m: dance, t, w: k }]);   // blend clips
//   const J = m.joints(bodyFig);  J.at(t, out)        // 13 star joints, pelvis frame (cheap, for crowds)
import * as THREE from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import type { RealFigure } from './people';
import { starJoints } from './stars';

const SIDE = ['Left', 'Right'] as const;
/** [clip bone, body bone], parents before children. */
const MAP: [string, string][] = [
  ['Hips', 'Hips'], ['LowerBack', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Neck', 'Neck'], ['Head', 'Head'],
  ...SIDE.flatMap((s) => [[`${s}Shoulder`, `${s}Shoulder`], [`${s}Arm`, `${s}Arm`], [`${s}ForeArm`, `${s}ForeArm`], [`${s}Hand`, `${s}Hand`]] as [string, string][]),
  ...SIDE.flatMap((s) => [[`${s}UpLeg`, `${s}UpLeg`], [`${s}Leg`, `${s}Leg`], [`${s}Foot`, `${s}Foot`], [`${s}ToeBase`, `${s}ToeBase`]] as [string, string][]),
];
/** Bones aimed at the clip's rest directions: [body bone, body child, clip bone, clip child]. */
const AIM: [string, string, string, string][] = [
  ['Spine', 'Spine1', 'LowerBack', 'Spine'], ['Spine1', 'Spine2', 'Spine', 'Spine1'], ['Spine2', 'Neck', 'Spine1', 'Neck'], ['Neck', 'Head', 'Neck', 'Head'],
  ...SIDE.flatMap((s) => [
    [`${s}Shoulder`, `${s}Arm`, `${s}Shoulder`, `${s}Arm`], [`${s}Arm`, `${s}ForeArm`, `${s}Arm`, `${s}ForeArm`],
    [`${s}ForeArm`, `${s}Hand`, `${s}ForeArm`, `${s}Hand`], [`${s}Hand`, `${s}HandMiddle1`, `${s}Hand`, `${s}FingerBase`],
    [`${s}UpLeg`, `${s}Leg`, `${s}UpLeg`, `${s}Leg`], [`${s}Leg`, `${s}Foot`, `${s}Leg`, `${s}Foot`], [`${s}Foot`, `${s}ToeBase`, `${s}Foot`, `${s}ToeBase`],
  ] as [string, string, string, string][]),
];
const mirrorName = (n: string) => n.startsWith('Left') ? 'Right' + n.slice(4) : n.startsWith('Right') ? 'Left' + n.slice(5) : n;

export interface PlayOpts {
  /** Loop the clip (with a short crossfade over the seam); otherwise clamp to its ends. */
  loop?: boolean;
  /** Keep the bob and sway but not the travel across the floor (default true). */
  inPlace?: boolean;
  /** Left ↔ right (doubles the variety of a clip). */
  mirror?: boolean;
}
export interface Layer extends PlayOpts { m: Motion; t: number; w?: number }

const XFADE = 0.6; // s, the loop seam crossfade

/** One captured clip. */
export class Motion {
  fps: number;
  frames: number;
  duration: number;
  names: string[] = [];
  parent: number[] = [];
  private index = new Map<string, number>();
  private rot: Float32Array[] = []; // per bone: frames × xyzw (local)
  private root: Float32Array; // frames × xyz
  private smooth: Float32Array; // the root path low-passed (for inPlace)
  /** Rest (zero-rotation) world positions of the bones, and the standing pelvis height. */
  restPos: THREE.Vector3[] = [];
  hipHeight = 1;
  private rigs = new Map<string, Rig>();

  constructor(public name: string, text: string, o: { from?: number; to?: number } = {}) {
    const { skeleton, clip } = new BVHLoader().parse(text);
    const bones = skeleton.bones.filter((b) => b.name !== 'ENDSITE');
    bones.forEach((b, i) => { this.names.push(b.name); this.index.set(b.name, i); });
    bones.forEach((b) => this.parent.push(b.parent && (b.parent as THREE.Bone).isBone ? this.index.get(b.parent.name) ?? -1 : -1));
    const track = (n: string, k: string) => clip.tracks.find((t) => t.name === `${n}.${k}`)!;
    const times = track(this.names[0]!, 'quaternion').times;
    const dt = times.length > 1 ? times[1]! - times[0]! : 1 / 120;
    const f0 = Math.max(0, Math.round((o.from ?? 0) / dt)), f1 = Math.min(times.length, o.to !== undefined ? Math.round(o.to / dt) : times.length);
    this.fps = 1 / dt;
    this.frames = f1 - f0;
    this.duration = (this.frames - 1) * dt;
    for (const n of this.names) this.rot.push((track(n, 'quaternion').values as Float32Array).slice(f0 * 4, f1 * 4));
    this.root = (track(this.names[0]!, 'position').values as Float32Array).slice(f0 * 3, f1 * 3);
    // rest positions (offsets only), every bone incl. end sites for the height
    skeleton.bones[0]!.updateMatrixWorld(true);
    let minY = Infinity;
    const rp = new Map<THREE.Bone, THREE.Vector3>();
    const walk = (b: THREE.Object3D, p: THREE.Vector3) => {
      const q = p.clone().add(b.position);
      rp.set(b as THREE.Bone, q);
      minY = Math.min(minY, q.y);
      for (const c of b.children) walk(c, q);
    };
    walk(skeleton.bones[0]!, new THREE.Vector3(0, 0, 0).sub(skeleton.bones[0]!.position));
    this.restPos = bones.map((b) => rp.get(b)!);
    this.hipHeight = -minY;
    // the root path, low-passed over ±0.8 s
    const n = this.frames, w = Math.round(0.8 * this.fps);
    this.smooth = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      let sx = 0, sz = 0, c = 0;
      for (let j = Math.max(0, i - w); j <= Math.min(n - 1, i + w); j++) { sx += this.root[j * 3]!; sz += this.root[j * 3 + 2]!; c++; }
      this.smooth[i * 3] = sx / c; this.smooth[i * 3 + 2] = sz / c;
    }
  }

  bone(name: string) { return this.index.get(name); }

  private _qa = new THREE.Quaternion();
  private _qb = new THREE.Quaternion();

  /**
   * World rotations (relative to the rest pose, which is the identity) of every bone and the pelvis offset
   * from standing (clip units), at clip time t.
   */
  sampleRaw(t: number, W: THREE.Quaternion[], root: THREE.Vector3, inPlace: boolean) {
    const x = Math.min(Math.max(t * this.fps, 0), this.frames - 1.0001);
    const i = Math.floor(x), a = x - i;
    for (let b = 0; b < this.names.length; b++) {
      const r = this.rot[b]!;
      this._qa.fromArray(r, i * 4); this._qb.fromArray(r, (i + 1) * 4);
      const q = (W[b] ??= new THREE.Quaternion()).copy(this._qa).slerp(this._qb, a);
      const p = this.parent[b]!;
      if (p >= 0) q.premultiply(W[p]!);
    }
    const R = this.root, S = this.smooth;
    const lerp = (k: number) => R[i * 3 + k]! * (1 - a) + R[(i + 1) * 3 + k]! * a;
    root.set(lerp(0), lerp(1) - this.hipHeight, lerp(2));
    if (inPlace) { root.x -= S[i * 3]! * (1 - a) + S[(i + 1) * 3]! * a; root.z -= S[i * 3 + 2]! * (1 - a) + S[(i + 1) * 3 + 2]! * a; }
    else { root.x -= R[0]!; root.z -= R[2]!; }
  }

  private _W2: THREE.Quaternion[] = [];
  private _r2 = new THREE.Vector3();

  /** As sampleRaw, with looping (crossfading the last XFADE s into the start) or clamping. */
  sample(t: number, W: THREE.Quaternion[], root: THREE.Vector3, o: PlayOpts = {}) {
    const inPlace = o.inPlace ?? true;
    if (!o.loop) return this.sampleRaw(t, W, root, inPlace);
    const L = this.duration - XFADE, u = ((t % L) + L) % L;
    this.sampleRaw(u, W, root, inPlace);
    if (u < XFADE) {
      const k = u / XFADE, e = k * k * (3 - 2 * k);
      this.sampleRaw(u + L, this._W2, this._r2, inPlace);
      for (let b = 0; b < W.length; b++) W[b]!.copy(this._W2[b]!).slerp(W[b]!, e);
      root.lerp(this._r2.lerp(root, e), 1);
    }
  }

  /** The retargeting from this clip onto `fig`'s body kind (cached). */
  rig(fig: RealFigure): Rig {
    let r = this.rigs.get(fig.kind);
    if (!r) { r = new Rig(this, fig); this.rigs.set(fig.kind, r); }
    return r;
  }

  /** Pose `fig` at clip time t. */
  apply(fig: RealFigure, t: number, o: PlayOpts = {}) { applyLayers(fig, [{ m: this, t, ...o }]); }

  private tables = new Map<string, JointTable>();

  /** A table of the 13 star joints (pelvis frame) over the looped clip, for `fig`'s body kind — for crowds. */
  joints(fig: RealFigure, o: { mirror?: boolean; hz?: number } = {}): JointTable {
    const key = `${fig.kind}|${o.mirror ? 1 : 0}`;
    let tb = this.tables.get(key);
    if (!tb) { tb = new JointTable(this, fig, o.mirror ?? false, o.hz ?? 30); this.tables.set(key, tb); }
    return tb;
  }
}

/**
 * Clip skeleton → one body kind: the body's bones put into the clip's T-pose, and how they chain. Bones are
 * kept by name (any figure of the kind can be posed with it).
 */
export class Rig {
  bones: { name: string; src: number; srcM: number; aligned: THREE.Quaternion; up: number; chain: THREE.Quaternion }[] = [];
  hipsParent = new THREE.Quaternion();
  hipsParentInv = new THREE.Matrix4();
  hipsRest = new THREE.Vector3();
  scale: number;

  constructor(m: Motion, fig: RealFigure) {
    const B = fig.boneMap;
    // rest pose, figure at the origin
    const save = { p: fig.position.clone(), q: fig.quaternion.clone(), s: fig.scale.clone() };
    fig.position.set(0, 0, 0); fig.quaternion.identity(); fig.scale.setScalar(1);
    fig.setMocap({ q: new Map(), hips: null });
    fig.updateMatrixWorld(true);
    const hips = B.get('Hips')!;
    this.hipsRest.copy(hips.position);
    hips.parent!.getWorldQuaternion(this.hipsParent);
    this.hipsParentInv.copy(hips.parent!.matrixWorld).invert();
    this.scale = fig.hipHeight / m.hipHeight;
    // aim the body's bones along the clip's rest directions (parents first)
    const rot = (bone: THREE.Bone, q: THREE.Quaternion) => {
      const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
      bone.updateMatrixWorld(true);
    };
    for (const [bb, bc, cb, cc] of AIM) {
      const bone = B.get(bb), child = B.get(bc), i = m.bone(cb), j = m.bone(cc);
      if (!bone || !child || i === undefined || j === undefined) continue;
      const want = m.restPos[j]!.clone().sub(m.restPos[i]!).normalize();
      const have = child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3())).normalize();
      rot(bone, new THREE.Quaternion().setFromUnitVectors(have, want));
    }
    fig.updateMatrixWorld(true);
    const mapped = new Map<THREE.Bone, number>();
    for (const [cb, bb] of MAP) {
      const b = B.get(bb), src = m.bone(cb), srcM = m.bone(mirrorName(cb));
      if (!b || src === undefined || srcM === undefined) continue;
      // the nearest mapped ancestor, and the rest rotations of any bones in between
      let up = -1;
      const chain = new THREE.Quaternion();
      for (let p = b.parent; p && (p as THREE.Bone).isBone; p = p.parent) {
        const k = mapped.get(p as THREE.Bone);
        if (k !== undefined) { up = k; break; }
        chain.premultiply(p.quaternion);
      }
      mapped.set(b, this.bones.length);
      this.bones.push({ name: bb, src, srcM, aligned: b.getWorldQuaternion(new THREE.Quaternion()), up, chain });
    }
    // back to the figure's own pose
    fig.position.copy(save.p); fig.quaternion.copy(save.q); fig.scale.copy(save.s);
    fig.setMocap(null);
  }
}

const _W: THREE.Quaternion[] = [];
const _root = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qm = new THREE.Quaternion();
const _v = new THREE.Vector3();

/** Pose `fig` from weighted clip layers (weights are normalised). */
export function applyLayers(fig: RealFigure, layers: Layer[]) {
  const live = layers.filter((l) => (l.w ?? 1) > 1e-4);
  if (!live.length) return;
  const rig0 = live[0]!.m.rig(fig);
  const n = rig0.bones.length;
  const Wb: THREE.Quaternion[] = Array.from({ length: n }, () => new THREE.Quaternion());
  const root = new THREE.Vector3();
  let acc = 0;
  for (const l of live) {
    const w = l.w ?? 1, rig = l.m.rig(fig);
    l.m.sample(l.t, _W, _root, l);
    acc += w;
    const k = w / acc;
    rig.bones.forEach((e, i) => {
      // world rotation of the body bone = the clip bone's change of rotation · the aligned rest
      if (l.mirror) {
        const s = _W[e.srcM]!;
        _qm.set(s.x, -s.y, -s.z, s.w);
      } else _qm.copy(_W[e.src]!);
      _q.copy(_qm).multiply(e.aligned);
      if (acc === w) Wb[i]!.copy(_q);
      else Wb[i]!.slerp(_q, k);
    });
    _v.copy(_root).multiplyScalar(rig.scale);
    if (l.mirror) _v.x = -_v.x;
    root.lerp(_v, k);
  }
  const q = new Map<THREE.Bone, THREE.Quaternion>();
  rig0.bones.forEach((e, i) => {
    const parent = e.up >= 0 ? Wb[e.up]!.clone().multiply(e.chain) : rig0.hipsParent.clone().multiply(e.chain);
    q.set(fig.boneMap.get(e.name)!, parent.invert().multiply(Wb[i]!));
  });
  const hips = root.applyMatrix4(new THREE.Matrix4().copy(rig0.hipsParentInv).setPosition(0, 0, 0)).add(rig0.hipsRest);
  fig.setMocap({ q, hips });
}

/** The 13 star joints of a clip on one body kind, sampled over the loop; `at(t)` interpolates. */
export class JointTable {
  data: Float32Array;
  n: number;
  period: number;

  constructor(m: Motion, fig: RealFigure, mirror: boolean, public hz: number) {
    this.period = m.duration - XFADE;
    this.n = Math.max(2, Math.round(this.period * hz));
    this.data = new Float32Array(this.n * 39);
    const save = { p: fig.position.clone(), q: fig.quaternion.clone(), s: fig.scale.clone() };
    fig.position.set(0, 0, 0); fig.quaternion.identity(); fig.scale.setScalar(1);
    const js: THREE.Vector3[] = [];
    for (let i = 0; i < this.n; i++) {
      applyLayers(fig, [{ m, t: (i / this.n) * this.period, loop: true, mirror }]);
      starJoints(fig, js);
      js.forEach((v, j) => this.data.set([v.x, v.y, v.z], i * 39 + j * 3));
    }
    fig.position.copy(save.p); fig.quaternion.copy(save.q); fig.scale.copy(save.s);
    fig.setMocap(null);
  }

  /** Joints at clip time t (looped) into `out` (39 floats, pelvis frame). */
  at(t: number, out: Float32Array = new Float32Array(39)) {
    const x = ((((t / this.period) % 1) + 1) % 1) * this.n;
    const i = Math.floor(x) % this.n, j = (i + 1) % this.n, a = x - Math.floor(x);
    const D = this.data;
    for (let k = 0; k < 39; k++) out[k] = D[i * 39 + k]! * (1 - a) + D[j * 39 + k]! * a;
    return out;
  }
}

const cache = new Map<string, Promise<Motion>>();

/** Load app/public/mocap/<name>.bvh (optionally trimmed to [from, to] seconds). */
export function loadMotion(name: string, o: { from?: number; to?: number } = {}): Promise<Motion> {
  const key = `${name}|${o.from ?? ''}|${o.to ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`mocap/${name}.bvh`).then((r) => { if (!r.ok) throw new Error(`mocap/${name}.bvh: ${r.status}`); return r.text(); }).then((t) => new Motion(name, t, o));
    cache.set(key, p);
  }
  return p;
}
