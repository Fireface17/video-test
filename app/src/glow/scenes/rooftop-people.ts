// People of the rooftop scenes: the neighbours who light up in the blackout (people of light near the camera, in
// their places in the architecture — fire escapes, window sills, roof edges, sidewalks, shop doors), the many
// far away all over the city (stardust), and the small things they carry (the courier's bike). Plus the posing
// helpers every scene here uses: a hand raised smoothly over the captured motion, a hand to the chest.
import * as THREE from 'three';
import { clamp, ease, hash, mulberry32, pulse, smoothstep } from '../../engine/util';
import type { RealFigure } from '../lib/people';
import type { Crowd, Person } from '../lib/crowd';
import { KitBuilder, M, kitBatch, kitMaterial } from '../lib/city-build';
import type { RoofWorld } from './rooftop-world';
import type { AnchorKind } from '../lib/city';

/** Soft tints for the people's own light (pale, each a little different; blue-white dominates). */
export const TINTS = [
  [0.45, 0.72, 1.0], [0.62, 0.62, 1.0], [0.35, 0.88, 0.9], [0.8, 0.6, 1.0], [1.0, 0.68, 0.55], [0.5, 0.95, 0.75], [0.75, 0.8, 1.0], [0.45, 0.58, 1.0],
] as const;
export const tint = (i: number, k = 1) => new THREE.Color(...(TINTS[((i % TINTS.length) + TINTS.length) % TINTS.length] as [number, number, number])).multiplyScalar(k);

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

/**
 * Raise hand i of `fig` (already posed by mocap) toward `up` (a world point), by k 0..1 (eased by the caller):
 * IK from where the captured hand is to the raised point, the elbow out to the side and down.
 */
export function raiseHand(fig: RealFigure, i: number, k: number, up: THREE.Vector3, curl = 0.15) {
  if (k <= 0.001) return;
  const now = fig.hand(i, _a);
  const side = i === 0 ? -1 : 1;
  fig.reach(i, _b.copy(now).lerp(up, k), new THREE.Vector3(side * 0.8, -0.6, -0.2));
  fig.setHand(i, curl * k + 0.3 * (1 - k));
}

/** A point above the shoulder of arm i (world): where a raised hand goes; `out`/`fwd`/`h` shape the gesture. */
export function overShoulder(fig: RealFigure, i: number, h = 0.62, out = 0.18, fwd = 0.1) {
  const side = i === 0 ? -1 : 1;
  return fig.spinePoint(side * (0.2 + out), 0.42 + h, fwd);
}

/** A hand on the chest (her gesture), by k. */
export function handToChest(fig: RealFigure, i: number, k: number) {
  if (k <= 0.001) return;
  const now = fig.hand(i, _a);
  const chest = fig.spinePoint((i === 0 ? -1 : 1) * 0.03, 0.36, 0.17);
  fig.reach(i, _b.copy(now).lerp(chest, k), new THREE.Vector3((i === 0 ? -1 : 1) * 0.5, -0.8, 0.0));
  fig.setHand(i, 0.25);
}

/** Brightness of someone who lights up at `t0` (from nothing to `k`), with the "felt low" echo pulses. */
export function litK(t: number, t0: number, k: number, echo: number[] = [], fade = 0.6) {
  if (t < t0 - 0.05) return 0;
  const on = ease.outCubic(clamp((t - t0) / fade));
  let e = 0;
  for (const te of echo) e += pulse(t, te, 0.18) * 0.9;
  // a flicker as the light catches
  const catchF = t - t0 < 0.4 ? 0.75 + 0.25 * Math.sin((t - t0) * 60) : 1;
  return k * on * catchF * (1 + e);
}

/** The far population: stardust people in the city's places within a ring around `c` (world). */
export interface FarPerson { pos: THREE.Vector3; yaw: number; d: number; seed: number; p: Person }
export function farPeople(w: RoofWorld, crowd: Crowd, o: { c: THREE.Vector3; r0: number; r1: number; n: number; seed: number; kinds?: AnchorKind[]; litFrom: number; litSpan: number; color?: (i: number, d: number) => THREE.Color; k?: (t: number, lit: number, i: number) => number; clips: [string, string]; upAt?: (i: number, d: number) => number; front?: THREE.Vector3; spacing?: number }) {
  const anchors = w.anchors(o.c.x, o.c.z, o.r1, o.kinds ?? ['roofEdge', 'roof', 'fireEscape', 'balcony'], { seed: o.seed, spacing: o.spacing ?? 9 });
  const r = mulberry32(o.seed);
  const out: FarPerson[] = [];
  for (const a of anchors) {
    const d = Math.hypot(a.pos.x - o.c.x, a.pos.z - o.c.z);
    if (d < o.r0) continue;
    if (o.front && (a.pos.x - o.c.x) * o.front.x + (a.pos.z - o.c.z) * o.front.z < 0) continue;
    if (out.length >= o.n) break;
    const i = out.length;
    const seed = r();
    // people at a roof edge or on a landing face out; on a roof, anywhere
    const yaw = Math.atan2(a.facing.x, a.facing.z) + (r() - 0.5) * 0.8;
    const lit = o.litFrom + o.litSpan * clamp((d - o.r0) / (o.r1 - o.r0)) * (0.7 + 0.6 * r());
    const color = o.color ? o.color(i, d) : tint(i, 1.0);
    const up = o.upAt ? o.upAt(i, d) : lit + 0.4 + r() * 0.8;
    const pos = a.pos.clone();
    if (a.kind === 'roofEdge') pos.addScaledVector(a.facing, -0.4);
    const p = crowd.addPerson({
      pos, yaw, look: 'dust', color, body: (i % 2) as 0 | 1, mirror: r() < 0.5, offset: r() * 10,
      k: o.k ? (t) => o.k!(t, lit, i) : (t) => litK(t, lit, 0.5 + 0.3 * seed),
      clips: [{ clip: o.clips[0], from: -10 }, { clip: o.clips[1], from: up }],
      fade: 0.9,
    });
    out.push({ pos, yaw, d, seed, p });
  }
  return out;
}

/** The courier's bike: a city bike with a delivery box, lit by the city (and by him). */
export function bikeMesh(w: RoofWorld) {
  const k = new KitBuilder();
  const IR = [0.05, 0.05, 0.055, M.ALB];
  const tyre = [0.02, 0.02, 0.02, M.ALB];
  for (const x of [-0.52, 0.52]) {
    k.add(new THREE.TorusGeometry(0.33, 0.025, 6, 24), new THREE.Matrix4().makeTranslation(x, 0.35, 0), tyre);
    for (let s = 0; s < 8; s++) k.box(x, 0.35, 0, 0.006, 0.62, 0.006, IR, 0, 0, (s / 8) * Math.PI);
  }
  const bar = (a: number[], b: number[], v = IR, r = 0.018) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
    k.add(new THREE.CylinderGeometry(r, r, d.length(), 5), new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(1, 1, 1)), v);
  };
  const red = [0.32, 0.05, 0.04, M.ALB];
  bar([-0.52, 0.35, 0], [-0.05, 0.4, 0], red); bar([-0.05, 0.4, 0], [0.38, 0.82, 0], red); bar([-0.52, 0.35, 0], [-0.18, 0.85, 0], red);
  bar([-0.05, 0.4, 0], [-0.2, 0.9, 0], red); bar([-0.18, 0.85, 0], [0.38, 0.82, 0], red); bar([0.38, 0.82, 0], [0.52, 0.35, 0]);
  bar([0.38, 0.82, 0], [0.33, 1.02, 0]); bar([0.33, 1.02, -0.25], [0.33, 1.02, 0.25]);
  k.box(-0.22, 0.94, 0, 0.24, 0.05, 0.1, [0.03, 0.03, 0.03, M.ALB]);
  // the delivery box on the rack
  bar([-0.6, 0.7, 0], [-0.2, 0.7, 0]);
  k.box(-0.42, 0.98, 0, 0.42, 0.5, 0.42, [0.5, 0.36, 0.06, M.ALB]);
  k.sphere(0.4, 0.95, 0, 0.035, [1, 0.95, 0.85, M.LIGHT]);
  return kitBatch(k.geometry(), [{ x: 0, y: -100, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.4 }], kitMaterial(w.city.U), new THREE.Vector3(0, 0, 0), 2);
}

/** Place an instanced kit mesh with one instance (x, y, z, yaw). */
export function placeKit(m: THREE.Mesh, p: THREE.Vector3, yaw: number) {
  const a = (m.geometry as THREE.InstancedBufferGeometry).getAttribute('iPos') as THREE.InstancedBufferAttribute;
  a.setXYZW(0, p.x, p.y, p.z, yaw);
  a.needsUpdate = true;
  m.frustumCulled = false;
}

export { hash, smoothstep };
