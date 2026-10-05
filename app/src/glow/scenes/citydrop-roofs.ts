// The two roof parties of the city drop (scenes/citydrop.ts), dressed for the close shots: real roofs, not grey
// floors. Tar and gravel underfoot (membrane laps, gravel, puddles holding the lights), brick parapets and party
// walls with coping stones, the stair bulkhead clad in brick with its door open on the lit stairwell and a caged
// bulb over it, a chimney with its flue pots, AC units with louvres and fan guards. The kids' roof: an old couch,
// a lawn chair, a cooler, milk crates, tomato plants in buckets, pots, a ball, a hopscotch chalked on the tar,
// string lights on conduit poles. The DJ's roof: a folding table under a black cloth with two decks, a mixer and a
// laptop, PA speakers on tripods over subwoofers, a road case of moving heads (the beams), crates of records, a
// cooler, a couch, camping chairs, planters with small trees, strings of bulbs from the bulkhead to the parapet.
// The floors are lit by their bulbs, the gear and the people of light dancing on them (run-surfaces).
import * as THREE from 'three';
import { KitBuilder, M } from '../lib/city-build';
import type { City } from '../lib/city';
import type { Building } from '../lib/city-plan';
import { GlowPoints } from '../lib/points';
import { hash, mulberry32 } from '../../engine/util';
import { placeKit } from './run-props';
import { SURF, SurfLights, floorRect, surfBox, surfaceMaterial } from './run-surfaces';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
type Col = number[];
const c4 = (r: number, g: number, b: number, m: number = M.ALB): Col => [r, g, b, m];

/** Kit parts placed in a local frame: origin (x0, y0, z0), turned by yaw (local +x → world (cos, 0, −sin)). */
class Fr {
  constructor(public k: KitBuilder, public x0: number, public y0: number, public z0: number, public yaw = 0) {}
  p(lx: number, lz: number): [number, number] {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return [this.x0 + lx * c + lz * s, this.z0 - lx * s + lz * c];
  }
  at(lx: number, ly: number, lz: number) { const [x, z] = this.p(lx, lz); return V(x, this.y0 + ly, z); }
  box(lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, v: Col, rotY = 0, rotX = 0, rotZ = 0) {
    const [x, z] = this.p(lx, lz);
    this.k.box(x, this.y0 + ly, z, sx, sy, sz, v, this.yaw + rotY, rotX, rotZ);
    return this;
  }
  cyl(lx: number, ly: number, lz: number, rT: number, rB: number, h: number, seg: number, v: Col, open = false) {
    const [x, z] = this.p(lx, lz);
    this.k.cyl(x, this.y0 + ly, z, rT, rB, h, seg, v, open);
    return this;
  }
  /** a cylinder lying along local x (rolled about z) */
  cylX(lx: number, ly: number, lz: number, r: number, h: number, seg: number, v: Col) {
    const m = new THREE.Matrix4().compose(this.at(lx, ly, lz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.yaw, Math.PI / 2, 'YXZ')), V(1, 1, 1));
    this.k.add(new THREE.CylinderGeometry(r, r, h, seg), m, v);
    return this;
  }
  /** a cylinder lying along local z (rolled about x) */
  cylZ(lx: number, ly: number, lz: number, r: number, h: number, seg: number, v: Col, tilt = 0) {
    const m = new THREE.Matrix4().compose(this.at(lx, ly, lz), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + tilt, this.yaw, 0, 'YXZ')), V(1, 1, 1));
    this.k.add(new THREE.CylinderGeometry(r, r, h, seg), m, v);
    return this;
  }
  sphere(lx: number, ly: number, lz: number, r: number, v: Col, sx = 1, sy = 1, sz = 1, det = 1, jit = 0) {
    const [x, z] = this.p(lx, lz);
    this.k.sphere(x, this.y0 + ly, z, r, v, sx, sy, sz, det, jit);
    return this;
  }
  quad(lx: number, ly: number, lz: number, w: number, h: number, v: Col, rotY = 0, rotX = 0) {
    const [x, z] = this.p(lx, lz);
    this.k.quad(x, this.y0 + ly, z, w, h, v, this.yaw + rotY, rotX);
    return this;
  }
}

/** A thin rod (box) from a to b. */
function rod(k: KitBuilder, a: THREE.Vector3, b: THREE.Vector3, w: number, v: Col) {
  const d = b.clone().sub(a), l = d.length();
  if (l < 1e-4) return;
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().divideScalar(l));
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(w, l, w));
  k.add(new THREE.BoxGeometry(1, 1, 1), m, v);
}

// ---------------------------------------------------------------- furniture and gear

function couch(f: Fr, fab: Col, r: () => number) {
  const dark = c4(fab[0]! * 0.6, fab[1]! * 0.6, fab[2]! * 0.6);
  f.box(0, 0.2, 0, 1.95, 0.3, 0.86, dark);
  for (let i = -1; i <= 1; i++) f.box(i * 0.6, 0.43, 0.04, 0.58, 0.16, 0.74, fab, (r() - 0.5) * 0.04, (r() - 0.5) * 0.08, (r() - 0.5) * 0.06);
  f.box(0, 0.6, -0.35, 1.95, 0.55, 0.2, dark, 0, -0.1);
  for (let i = -1; i <= 1; i++) f.box(i * 0.6, 0.7, -0.22, 0.57, 0.42, 0.17, fab, 0, -0.18 + (r() - 0.5) * 0.08, (r() - 0.5) * 0.05);
  for (const s of [-1, 1]) { f.box(s * 0.9, 0.36, 0, 0.2, 0.42, 0.86, fab); f.cylZ(s * 0.9, 0.58, 0.0, 0.11, 0.86, 8, fab); }
  for (const sx of [-0.88, 0.88]) for (const sz of [-0.36, 0.36]) f.box(sx, 0.03, sz, 0.06, 0.06, 0.06, c4(0.03, 0.02, 0.015));
  // a throw blanket over one arm
  f.box(-0.75, 0.52, 0.12, 0.5, 0.05, 0.6, c4(0.22, 0.05, 0.04), 0.2, 0, 0.25);
}

function cooler(f: Fr, body: Col) {
  f.box(0, 0.19, 0, 0.62, 0.36, 0.38, body);
  f.box(0, 0.4, 0, 0.64, 0.06, 0.4, c4(0.55, 0.55, 0.52));
  f.box(0, 0.45, 0, 0.3, 0.03, 0.05, c4(0.4, 0.4, 0.38));
  for (const s of [-1, 1]) f.box(s * 0.33, 0.3, 0, 0.03, 0.05, 0.14, c4(0.45, 0.45, 0.42));
}

function crate(f: Fr, col: Col) {
  const s = 0.33, h = 0.28, t = 0.022;
  f.box(0, 0.012, 0, s, 0.024, s, col);
  for (const x of [-1, 1]) for (const z of [-1, 1]) f.box(x * (s / 2 - t / 2), h / 2, z * (s / 2 - t / 2), t, h, t, col);
  for (const y of [0.1, 0.19, h - 0.012]) {
    f.box(0, y, s / 2 - t / 2, s, 0.024, t, col); f.box(0, y, -s / 2 + t / 2, s, 0.024, t, col);
    f.box(s / 2 - t / 2, y, 0, t, 0.024, s, col); f.box(-s / 2 + t / 2, y, 0, t, 0.024, s, col);
  }
}

function records(f: Fr, n: number, r: () => number) {
  for (let i = 0; i < n; i++) {
    const lean = (r() - 0.5) * 0.25;
    f.box(0, 0.17, -0.13 + i * (0.26 / n), 0.3, 0.31, 0.006, i % 4 === 0 ? c4(0.3, 0.1, 0.05) : i % 3 === 0 ? c4(0.6, 0.55, 0.45) : c4(0.03, 0.03, 0.035), 0, lean);
  }
}

function bucketPlant(f: Fr, r: () => number) {
  f.cyl(0, 0.18, 0, 0.15, 0.13, 0.36, 12, r() < 0.5 ? c4(0.6, 0.18, 0.03) : c4(0.5, 0.5, 0.47), true);
  f.cyl(0, 0.33, 0, 0.14, 0.14, 0.02, 12, c4(0.05, 0.035, 0.02));
  f.box(0.04, 0.75, 0, 0.02, 0.9, 0.02, c4(0.2, 0.14, 0.07));
  for (let i = 0; i < 4; i++) f.sphere((r() - 0.5) * 0.18, 0.5 + i * 0.13, (r() - 0.5) * 0.18, 0.17 - i * 0.02, c4(0.06, 0.13, 0.04, M.LEAVES), 1, 0.9, 1, 1, 0.3);
  if (r() < 0.6) for (let i = 0; i < 3; i++) f.sphere((r() - 0.5) * 0.25, 0.45 + r() * 0.35, (r() - 0.5) * 0.25, 0.025, c4(0.5, 0.05, 0.02));
}

function pot(f: Fr, r: () => number) {
  f.cyl(0, 0.11, 0, 0.13, 0.1, 0.22, 10, c4(0.3, 0.11, 0.05), true);
  f.cyl(0, 0.2, 0, 0.12, 0.12, 0.02, 10, c4(0.04, 0.03, 0.02));
  f.sphere(0, 0.3, 0, 0.16 + r() * 0.06, c4(0.07, 0.14, 0.045, M.LEAVES), 1, 0.8 + r() * 0.5, 1, 1, 0.35);
}

function planterTree(f: Fr, r: () => number) {
  f.box(0, 0.25, 0, 0.62, 0.5, 0.62, c4(0.16, 0.09, 0.045, M.PLANKS));
  f.box(0, 0.49, 0, 0.56, 0.02, 0.56, c4(0.04, 0.03, 0.02));
  f.cyl(0, 0.95, 0, 0.025, 0.035, 0.9, 6, c4(0.1, 0.07, 0.04));
  for (let i = 0; i < 5; i++) f.sphere((r() - 0.5) * 0.45, 1.35 + r() * 0.45, (r() - 0.5) * 0.45, 0.24 + r() * 0.1, c4(0.06, 0.12, 0.04, M.LEAVES), 1, 0.85, 1, 1, 0.3);
}

function lawnChair(f: Fr, web: Col) {
  const al = c4(0.4, 0.41, 0.42);
  for (const s of [-1, 1]) {
    f.box(s * 0.27, 0.2, 0.05, 0.025, 0.025, 0.55, al, 0, 0.35);
    f.box(s * 0.27, 0.2, -0.05, 0.025, 0.025, 0.55, al, 0, -0.35);
    f.box(s * 0.27, 0.55, 0.0, 0.025, 0.025, 0.45, al);
    f.box(s * 0.27, 0.62, -0.28, 0.025, 0.65, 0.025, al, 0, -0.25);
  }
  f.box(0, 0.36, 0.02, 0.52, 0.02, 0.42, web, 0, -0.08);
  f.box(0, 0.68, -0.3, 0.52, 0.55, 0.02, web, 0, -0.25);
}

function campChair(f: Fr, col: Col) {
  const leg = c4(0.05, 0.05, 0.055);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * 0.24, 0.27, sz * 0.22, 0.02, 0.6, 0.02, leg, 0, sz * 0.25 * sx, sx * 0.15);
  f.box(0, 0.42, 0.02, 0.5, 0.06, 0.45, col, 0, -0.1);
  f.box(0, 0.72, -0.24, 0.5, 0.55, 0.05, col, 0, -0.22);
  for (const s of [-1, 1]) f.box(s * 0.27, 0.6, 0.0, 0.06, 0.04, 0.45, col);
  f.cyl(0.29, 0.62, 0.15, 0.035, 0.035, 0.12, 8, c4(0.5, 0.05, 0.03));
}

function speakerOnStand(f: Fr) {
  const blk = c4(0.018, 0.018, 0.02), steel = c4(0.06, 0.06, 0.065);
  f.cyl(0, 0.85, 0, 0.018, 0.018, 1.7, 6, steel);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const top = f.at(0, 0.55, 0), foot = f.at(Math.cos(a) * 0.55, 0.0, Math.sin(a) * 0.55);
    rod(f.k, top, foot, 0.02, steel);
  }
  f.box(0, 2.0, 0, 0.44, 0.68, 0.38, blk);
  f.box(0, 1.94, -0.192, 0.4, 0.5, 0.01, c4(0.04, 0.04, 0.045));
  f.cylZ(0, 1.94, -0.196, 0.15, 0.01, 16, c4(0.012, 0.012, 0.014));
  f.box(0, 2.27, -0.192, 0.3, 0.05, 0.012, c4(0.06, 0.06, 0.065));
  f.box(0.16, 2.26, -0.195, 0.015, 0.015, 0.006, c4(0.2, 0.6, 1.6, M.LIGHT));
}

function sub(f: Fr) {
  f.box(0, 0.32, 0, 0.62, 0.64, 0.66, c4(0.016, 0.016, 0.018));
  f.box(0, 0.32, -0.335, 0.56, 0.56, 0.01, c4(0.035, 0.035, 0.04));
  f.cylZ(0, 0.32, -0.34, 0.22, 0.01, 18, c4(0.01, 0.01, 0.012));
  for (const s of [-1, 1]) f.box(s * 0.31, 0.32, 0, 0.012, 0.14, 0.08, c4(0.06, 0.06, 0.06));
}

/** The DJ's table: local −z toward the dancers, the DJ on +z. Returns where its lights are. */
function djTable(f: Fr) {
  const blk = c4(0.012, 0.012, 0.014), steel = c4(0.08, 0.08, 0.085), cloth = c4(0.01, 0.01, 0.012);
  f.box(0, 0.9, 0, 1.9, 0.035, 0.76, steel);
  for (const sx of [-0.9, 0.9]) for (const sz of [-0.33, 0.33]) f.cyl(sx, 0.45, sz, 0.015, 0.015, 0.9, 6, steel);
  // the cloth over the front and the ends, hanging in folds
  for (let i = 0; i < 12; i++) f.box(-0.9 + (i + 0.5) * (1.8 / 12), 0.5, -0.39 - 0.012 * ((i % 2) * 2 - 1), 1.8 / 12 + 0.01, 0.82, 0.012, cloth, (i % 2 ? 0.08 : -0.08));
  for (const s of [-1, 1]) f.box(s * 0.96, 0.5, 0, 0.012, 0.82, 0.78, cloth);
  f.box(0, 0.925, 0, 1.92, 0.02, 0.8, cloth);
  // two decks: platters, tonearms, a jog ring glowing
  for (const s of [-1, 1]) {
    f.box(s * 0.56, 0.98, 0.02, 0.45, 0.1, 0.36, c4(0.03, 0.03, 0.035));
    f.cyl(s * 0.56 - 0.04, 1.035, 0.02, 0.15, 0.15, 0.012, 24, c4(0.015, 0.015, 0.017));
    f.cyl(s * 0.56 - 0.04, 1.03, 0.02, 0.152, 0.152, 0.008, 24, c4(0.25, 0.6, 1.5, M.LIGHT));
    f.cyl(s * 0.56 - 0.04, 1.045, 0.02, 0.012, 0.012, 0.012, 8, c4(0.4, 0.4, 0.4));
    f.box(s * 0.56 + 0.16, 1.05, -0.02, 0.012, 0.012, 0.22, c4(0.4, 0.4, 0.42), 0.25);
    f.box(s * 0.56 + 0.17, 1.04, 0.13, 0.03, 0.01, 0.06, c4(0.35, 0.35, 0.36));
  }
  // the mixer, its knobs; the LEDs are glow points (DjGlows)
  f.box(0, 0.99, 0.02, 0.3, 0.12, 0.38, c4(0.025, 0.025, 0.03));
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) f.cyl(-0.105 + i * 0.07, 1.057, -0.1 + j * 0.06, 0.012, 0.012, 0.016, 8, c4(0.3, 0.3, 0.32));
  for (let i = 0; i < 4; i++) f.box(-0.105 + i * 0.07, 1.052, 0.15, 0.01, 0.01, 0.06, c4(0.2, 0.2, 0.2));
  // a laptop on a stand to the right, its lid's back to us (a sticker on it)
  f.box(0.98, 0.98, 0.0, 0.08, 0.12, 0.2, steel, 0, 0.3);
  f.box(0.98, 1.05, 0.05, 0.34, 0.015, 0.24, c4(0.3, 0.31, 0.32), 0, 0.3);
  f.box(0.98, 1.17, -0.08, 0.34, 0.23, 0.012, c4(0.32, 0.33, 0.34), 0, -0.25);
  f.box(0.98, 1.17, -0.075, 0.32, 0.21, 0.004, c4(0.3, 0.45, 0.9, M.LIGHT), 0, -0.25);
  f.cylZ(0.98, 1.18, -0.088, 0.035, 0.004, 12, c4(0.8, 0.25, 0.4), -0.25);
  // headphones, a bottle, the cables down to the floor
  f.box(-0.95, 0.97, 0.22, 0.16, 0.05, 0.16, c4(0.02, 0.02, 0.02));
  f.cyl(-0.85, 1.03, -0.2, 0.035, 0.035, 0.22, 8, c4(0.03, 0.12, 0.05, M.GLASS));
  for (let i = 0; i < 5; i++) rod(f.k, f.at(-0.3 + i * 0.15, 0.92, 0.37), f.at(-0.5 + i * 0.3, 0.01, 0.75 + i * 0.05), 0.012, c4(0.01, 0.01, 0.01));
  return { decks: [f.at(-0.6, 1.05, 0.02), f.at(0.52, 1.05, 0.02)], mixer: f.at(0, 1.06, 0.02), laptop: f.at(0.98, 1.17, -0.07) };
}

/** A stack of road cases with the moving heads on top (the beams come from their heads). */
function roadCase(f: Fr, nHeads: number) {
  const blk = c4(0.02, 0.02, 0.022), al = c4(0.35, 0.35, 0.36);
  for (const y0 of [0, 0.56]) {
    f.box(0, y0 + 0.28, 0, 1.25, 0.54, 0.62, blk);
    for (const yy of [y0 + 0.015, y0 + 0.545]) { f.box(0, yy, 0.315, 1.27, 0.02, 0.012, al); f.box(0, yy, -0.315, 1.27, 0.02, 0.012, al); }
    for (const sx of [-0.63, 0.63]) for (const sz of [-0.31, 0.31]) f.box(sx, y0 + 0.28, sz, 0.03, 0.56, 0.03, al);
    f.box(0, y0 + 0.3, -0.32, 0.12, 0.05, 0.02, al);
  }
  for (let i = 0; i < nHeads; i++) {
    const x = -0.5 + i * (1.0 / Math.max(1, nHeads - 1));
    f.box(x, 1.16, 0, 0.22, 0.06, 0.2, blk);
    for (const s of [-1, 1]) f.box(x + s * 0.1, 1.27, 0, 0.025, 0.18, 0.06, blk);
    f.box(x, 1.3, 0, 0.16, 0.16, 0.2, blk, 0, 0.6);
    f.cylZ(x, 1.33, -0.07, 0.055, 0.012, 12, c4(0.9, 0.95, 1.2, M.LIGHT), 0.6);
  }
}

/** An AC unit (w along x, d along z): a casing, louvred sides, a fan guard on top, its pipes. */
function acUnit(f: Fr, w: number, h: number, d: number) {
  const body = c4(0.24, 0.25, 0.24), dark = c4(0.025, 0.027, 0.03);
  f.box(0, h / 2, 0, w + 0.05, h, d + 0.05, body);
  for (const s of [-1, 1]) {
    f.box(0, h * 0.48, s * (d / 2 + 0.03), w * 0.86, h * 0.7, 0.01, dark);
    for (let i = 0; i < 9; i++) f.box(0, h * 0.16 + i * h * 0.08, s * (d / 2 + 0.04), w * 0.86, 0.012, 0.03, body, 0, s * 0.5);
  }
  const fr = Math.min(w, d) * 0.38;
  f.cyl(0, h + 0.02, 0, fr, fr, 0.03, 20, dark);
  f.cyl(0, h + 0.05, 0, fr * 0.98, fr * 0.98, 0.012, 20, c4(0.18, 0.19, 0.19), true);
  for (let i = 0; i < 4; i++) f.box(0, h + 0.06, 0, fr * 2, 0.012, 0.012, c4(0.18, 0.19, 0.19), (i * Math.PI) / 4);
  f.cyl(0, h + 0.035, 0, fr * 0.2, fr * 0.2, 0.03, 10, c4(0.1, 0.1, 0.1));
  f.cyl(w / 2 + 0.06, 0.12, 0, 0.03, 0.03, 0.24, 8, c4(0.1, 0.09, 0.08));
  f.box(w / 2 + 0.06, 0.03, 0.4, 0.06, 0.06, 0.8, c4(0.1, 0.09, 0.08));
}

/** Coping stones along a parapet top from (x0, z0) to (x1, z1) at height y: each its own tone, open joints. */
function copingRun(k: KitBuilder, x0: number, z0: number, x1: number, z1: number, y: number, w: number, seed: number) {
  const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.61)), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  const yaw = Math.atan2(-dz, dx);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) * (len / n), h = hash(i, seed);
    const tone = 0.27 + 0.08 * h;
    k.box(x0 + dx * u, y + 0.04 + 0.006 * (hash(i, seed + 1) - 0.5), z0 + dz * u, len / n - 0.012, 0.075, w, c4(tone, tone * 0.96, tone * 0.9), yaw, 0, 0.004 * (hash(i, seed + 2) - 0.5));
  }
}

/** A brick wall from (x0, z0) to (x1, z1), thickness th, from y to y + h (axis-aligned runs). */
function brickWall(x0: number, z0: number, x1: number, z1: number, y: number, h: number, th: number, mat: THREE.Material) {
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  return alongX ? surfBox((x0 + x1) / 2, y + h / 2, z0, Math.abs(x1 - x0), h, th, mat) : surfBox(x0, y + h / 2, (z0 + z1) / 2, th, h, Math.abs(z1 - z0), mat);
}

/** A chalk hopscotch (and a sun, and names) drawn on a canvas, for a decal on the tar. */
function chalkTexture() {
  const W = 256, H = 860, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  c.lineWidth = 7; c.lineCap = 'round';
  const r = mulberry32(5);
  const sq = (x: number, y: number, s: number, n: string, col: string) => {
    c.strokeStyle = col;
    c.beginPath();
    c.moveTo(x + (r() - 0.5) * 4, y + (r() - 0.5) * 4); c.lineTo(x + s + (r() - 0.5) * 4, y + (r() - 0.5) * 4);
    c.lineTo(x + s + (r() - 0.5) * 4, y + s + (r() - 0.5) * 4); c.lineTo(x + (r() - 0.5) * 4, y + s + (r() - 0.5) * 4); c.closePath();
    c.stroke();
    c.fillStyle = col; c.font = 'bold 54px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(n, x + s / 2, y + s / 2 + 3);
  };
  const s = 110, cx = W / 2 - s / 2;
  const cols = ['#f4f1e8', '#ff9ec7', '#9fe3ff', '#fff3a0'];
  let y = H - s - 10, n = 1;
  for (const row of [1, 1, 2, 1, 2, 1]) {
    if (row === 1) sq(cx, y, s, String(n++), cols[n % 4]!);
    else { sq(cx - s / 2, y, s, String(n++), cols[n % 4]!); sq(cx + s / 2, y, s, String(n++), cols[n % 4]!); }
    y -= s;
  }
  c.strokeStyle = '#ffe08a'; c.beginPath(); c.arc(W / 2, 48, 36, Math.PI, 0); c.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- the parties

export class RoofParty extends THREE.Group {
  L = new SurfLights();
  bulbs: GlowPoints;
  bulbPos: THREE.Vector3[] = [];
  leds = new GlowPoints(40, 0.012);
  ledPos: THREE.Vector3[] = [];
  /** Lights for the city's glow list (lighting the kit props, which the surface lights don't reach). */
  keyLights: { pos: THREE.Vector3; color: THREE.Color; radius: number }[] = [];
  /** Fixed lights for the floors (the bulbs, the doorway, the gear), set again each frame before the people's. */
  fixed: { p: THREE.Vector3; c: THREE.Color; r: number; flick?: number }[] = [];
  centre = V();

  constructor(public city: City, nBulbs: number) {
    super();
    this.bulbs = new GlowPoints(Math.max(1, nBulbs), 0.1);
    this.add(this.bulbs, this.leds);
  }

  /** Per frame: the bulbs and LEDs, the floor lights (fixed, then the people near), returns how many are set. */
  update(t: number, kick: number, beat: number, feet: { p: THREE.Vector3; c: THREE.Color }[]) {
    const L = this.L;
    L.clear();
    let i = 0;
    for (const q of this.fixed) {
      const fl = q.flick ? 1 + q.flick * Math.sin(t * 11 + i * 3.7) * Math.sin(t * 7.3 + i) : 1;
      L.set(i++, q.p, q.c.clone().multiplyScalar(fl * (1 + 0.25 * kick)), q.r);
    }
    for (const f of feet) { if (i >= 16) break; L.set(i++, f.p, f.c, 1.1); }
    const B = this.bulbs;
    this.bulbPos.forEach((p, j) => {
      const c = [[1.0, 0.72, 0.38], [1.0, 0.55, 0.25], [1.0, 0.85, 0.6], [1.0, 0.45, 0.55]][j % 4]! as [number, number, number];
      B.set(j, p.x, p.y, p.z, c, 0.8 + 0.3 * Math.sin(t * 2.3 + j * 1.9) * (j % 5 === 0 ? 1 : 0.15) + 0.4 * kick, 1);
    });
    B.commit(this.bulbPos.length);
    const D = this.leds, ph = beat - Math.floor(beat);
    this.ledPos.forEach((p, j) => {
      const lvl = j % 8, on = (Math.exp(-ph * 4) * 8 + 2 * hash(Math.floor(beat * 4), j)) > lvl;
      const c: [number, number, number] = lvl < 5 ? [0.2, 1.4, 0.3] : lvl < 7 ? [1.4, 0.9, 0.1] : [1.6, 0.15, 0.1];
      D.set(j, p.x, p.y, p.z, c, on ? 1.2 : 0.06, 1);
    });
    D.commit(this.ledPos.length);
  }
}

/** The kids' roof: building b (a walkup in a row of them), the kids at `kids`, the string bulbs at bulbPos (3 strings). */
export function kidsRoof(city: City, b: Building, kids: THREE.Vector3, strings: THREE.Vector3[], perString: number, neighbours: Building[] = []) {
  const P = new RoofParty(city, 1);
  const t = b.tiers.reduce((m, q) => (q.y0 + q.h > m.y0 + m.h ? q : m), b.tiers[0]!);
  const y = t.y0 + t.h, x0 = t.cx - t.w / 2, x1 = t.cx + t.w / 2, z0 = t.cz - t.d / 2, z1 = t.cz + t.d / 2;
  P.centre.set(t.cx, y, kids.z + 2);
  const L = P.L;
  const tar = surfaceMaterial(city, SURF.TAR, L, { street: 1, wet: 0.85 });
  const brick = surfaceMaterial(city, SURF.BRICK, L, { street: 1, alb: new THREE.Color(0.2, 0.075, 0.045) });
  const brick2 = surfaceMaterial(city, SURF.BRICK, L, { street: 1, alb: new THREE.Color(0.16, 0.085, 0.06) });
  // the tar over the row's roofs (this one and its neighbours, the same height)
  const rx0 = x0 - 7.2, rx1 = x1 + 7.2, rz1 = Math.min(z1, z0 + 16.8);
  P.add(floorRect(rx0, z0 + 0.05, rx1, rz1, y + 0.015, tar));
  P.add(floorRect(x0, rz1 - 0.01, x1, z1 - 0.3, y + 0.015, tar));
  // the front parapet behind the cornice, the party walls, the back parapet
  P.add(brickWall(rx0, z0 + 0.27, rx1, z0 + 0.27, y, 0.55, 0.3, brick));
  for (const px of [x0, x1, rx0 + 0.15, rx1 - 0.15]) P.add(brickWall(px, z0 + 0.42, px, rz1, y, 0.42, 0.3, brick2));
  P.add(brickWall(x0, z1 - 0.15, x1, z1 - 0.15, y, 0.6, 0.3, brick));
  const k = new KitBuilder();
  copingRun(k, rx0, z0 + 0.27, rx1, z0 + 0.27, y + 0.55, 0.38, 11);
  for (const [i, px] of [x0, x1, rx0 + 0.15, rx1 - 0.15].entries()) copingRun(k, px, z0 + 0.45, px, rz1, y + 0.42, 0.36, 20 + i);
  copingRun(k, x0, z1 - 0.15, x1, z1 - 0.15, y + 0.6, 0.38, 30);
  // the stair bulkhead clad in brick, its door open on the lit stairs, a caged bulb, a hood over the door
  const pl = b.plant[0];
  if (pl) {
    P.add(surfBox(pl.cx, pl.y0 + pl.h / 2, pl.cz, pl.w + 0.06, pl.h, pl.d + 0.06, brick));
    const fz = pl.cz - pl.d / 2 - 0.03, dx = pl.cx - pl.w / 2 + 0.75;
    k.quad(dx, y + 1.03, fz - 0.004, 0.86, 2.02, c4(1.25, 0.82, 0.48, M.LIGHT), Math.PI);
    k.box(dx, y + 1.02, fz + 0.02, 0.84, 2.0, 0.02, c4(0.5, 0.33, 0.2, M.LIGHT));
    for (let s = 0; s < 6; s++) k.box(dx, y + 0.12 + s * 0.2, fz + 0.3 + s * 0.24, 0.8, 0.04, 0.25, c4(0.6, 0.4, 0.24, M.LIGHT));
    const steel = c4(0.05, 0.07, 0.06);
    k.box(dx - 0.46, y + 1.05, fz - 0.03, 0.06, 2.1, 0.08, steel).box(dx + 0.46, y + 1.05, fz - 0.03, 0.06, 2.1, 0.08, steel).box(dx, y + 2.12, fz - 0.03, 0.98, 0.07, 0.08, steel);
    const door = new Fr(k, dx - 0.43, y, fz - 0.03, 1.15);
    door.box(0.44, 1.02, -0.02, 0.86, 2.0, 0.045, c4(0.06, 0.1, 0.08));
    door.box(0.78, 1.0, -0.06, 0.03, 0.12, 0.04, c4(0.3, 0.3, 0.3));
    door.box(0.44, 0.3, -0.045, 0.7, 0.35, 0.01, c4(0.05, 0.085, 0.07));
    k.box(dx, y + 2.3, fz - 0.2, 1.25, 0.04, 0.42, c4(0.12, 0.12, 0.12), 0, 0.08);
    const bulb = V(dx + 0.65, y + 2.12, fz - 0.12);
    k.sphere(bulb.x, bulb.y, bulb.z, 0.045, c4(1.8, 1.3, 0.8, M.LIGHT));
    k.cyl(bulb.x, bulb.y, bulb.z, 0.07, 0.07, 0.16, 8, c4(0.06, 0.06, 0.06, M.BARS), true);
    k.box(bulb.x, bulb.y + 0.1, bulb.z + 0.06, 0.1, 0.04, 0.12, c4(0.06, 0.06, 0.06));
    P.fixed.push({ p: bulb.clone().add(V(0, -0.1, -0.2)), c: new THREE.Color(1.0, 0.7, 0.4).multiplyScalar(0.5), r: 2.4 });
    P.fixed.push({ p: V(dx, y + 1.3, fz - 0.5), c: new THREE.Color(1.0, 0.62, 0.32).multiplyScalar(0.55), r: 1.8 });
    P.keyLights.push({ pos: V(dx, y + 1.6, fz - 0.6), color: new THREE.Color(1, 0.65, 0.35).multiplyScalar(0.4), radius: 3 });
    // a satellite dish and a vent on the bulkhead's roof
    const dz = new Fr(k, pl.cx + 0.6, pl.y0 + pl.h + 0.4, pl.cz + 0.8, 0.6);
    dz.box(0, 0.15, 0, 0.05, 0.3, 0.05, c4(0.2, 0.2, 0.2)).sphere(0, 0.45, -0.1, 0.32, c4(0.4, 0.4, 0.4), 1, 1, 0.25, 2);
  }
  // the chimney (the city's roof box kind 2), its flue pots
  for (const a of b.roof) if (a.kind === 2) {
    P.add(surfBox(a.x, y + a.h / 2, a.z, a.w + 0.08, a.h, a.d + 0.08, brick2));
    k.box(a.x, y + a.h + 0.04, a.z, a.w + 0.16, 0.08, a.d + 0.16, c4(0.28, 0.27, 0.25));
    for (const s of [-1, 1]) k.cyl(a.x, y + a.h + 0.25, a.z + s * a.d * 0.22, 0.09, 0.11, 0.38, 10, c4(0.3, 0.12, 0.06), true);
  }
  // the kids' things
  const r = mulberry32(19);
  couch(new Fr(k, x0 + 1.0, y, kids.z + 2.9, Math.PI / 2), c4(0.2, 0.14, 0.05), r);
  lawnChair(new Fr(k, x0 + 1.1, y, kids.z + 0.6, Math.PI / 2 + 0.5), c4(0.08, 0.2, 0.25));
  cooler(new Fr(k, x1 - 0.8, y, kids.z + 2.7, -0.3), c4(0.45, 0.04, 0.03));
  crate(new Fr(k, x1 - 1.7, y, kids.z + 5.0, 0.1), c4(0.03, 0.08, 0.35));
  crate(new Fr(k, x1 - 1.33, y, kids.z + 5.05, -0.05), c4(0.4, 0.04, 0.03));
  crate(new Fr(k, x1 - 1.52, y + 0.29, kids.z + 5.02, 0.2), c4(0.04, 0.2, 0.06));
  for (let i = 0; i < 3; i++) bucketPlant(new Fr(k, x1 - 0.42, y, kids.z - 0.9 + i * 0.95, 0), r);
  for (const [px, pz] of [[x0 + 0.6, z0 + 0.75], [t.cx + 1.4, z0 + 0.72], [t.cx + 2.0, z0 + 0.78], [x0 + 1.9, z0 + 0.7]] as const) pot(new Fr(k, px, y, pz), r);
  k.sphere(t.cx + 1.2, y + 0.12, kids.z + 1.9, 0.11, c4(0.55, 0.06, 0.04), 1, 1, 1, 2);
  k.sphere(t.cx - 2.1, y + 0.05, kids.z - 0.8, 0.035, c4(0.6, 0.6, 0.55), 1, 1, 1, 1);
  // a bike against the bulkhead
  if (pl) {
    const bk = new Fr(k, pl.cx + pl.w / 2 - 0.5, y, pl.cz - pl.d / 2 - 0.25, 0.05);
    for (const s of [-1, 1]) bk.cylX(s * 0.38, 0.28, 0, 0.27, 0.035, 18, c4(0.02, 0.02, 0.02));
    rod(k, bk.at(-0.38, 0.28, 0), bk.at(0, 0.62, 0), 0.03, c4(0.5, 0.06, 0.1));
    rod(k, bk.at(0.38, 0.28, 0), bk.at(0, 0.62, 0), 0.03, c4(0.5, 0.06, 0.1));
    rod(k, bk.at(0, 0.62, 0), bk.at(0.3, 0.68, 0), 0.03, c4(0.5, 0.06, 0.1));
    rod(k, bk.at(-0.38, 0.28, 0), bk.at(-0.15, 0.3, 0), 0.03, c4(0.5, 0.06, 0.1));
    bk.box(0.32, 0.8, 0, 0.04, 0.04, 0.42, c4(0.05, 0.05, 0.05));
    bk.box(-0.04, 0.72, 0, 0.2, 0.05, 0.08, c4(0.03, 0.03, 0.03));
  }
  // the neighbours' roofs: a covered grill and a table one side, raised beds the other
  const gl = new Fr(k, x1 + 3.5, y, z0 + 5.0, 0.4);
  gl.box(0, 0.45, 0, 0.7, 0.4, 0.45, c4(0.03, 0.03, 0.035)).box(0, 0.7, 0, 0.72, 0.12, 0.47, c4(0.18, 0.18, 0.2)).box(0, 0.2, 0, 0.5, 0.02, 0.35, c4(0.05, 0.05, 0.05));
  for (const sx of [-0.3, 0.3]) gl.box(sx, 0.12, 0, 0.03, 0.25, 0.03, c4(0.05, 0.05, 0.05));
  const tb = new Fr(k, x1 + 4.6, y, z0 + 7.2, -0.2);
  tb.box(0, 0.72, 0, 0.9, 0.03, 0.9, c4(0.5, 0.5, 0.48)).cyl(0, 0.36, 0, 0.03, 0.03, 0.72, 6, c4(0.5, 0.5, 0.48));
  // the neighbours' bulkheads in brick too, their doors shut
  for (const nb of neighbours) for (const q of nb.plant) {
    P.add(surfBox(q.cx, q.y0 + q.h / 2, q.cz, q.w + 0.06, q.h, q.d + 0.06, brick2));
    const fz = q.cz - q.d / 2 - 0.035;
    k.box(q.cx - q.w / 2 + 0.7, q.y0 + 1.02, fz, 0.86, 2.0, 0.03, c4(0.07, 0.09, 0.08));
    k.box(q.cx - q.w / 2 + 0.7, q.y0 + 2.1, fz - 0.15, 1.1, 0.04, 0.35, c4(0.12, 0.12, 0.12));
  }
  // the string lights: conduit poles at the ends, the wire, the bulbs (their glow is citydrop's GlowPoints)
  const steel = c4(0.08, 0.08, 0.085), wire = c4(0.01, 0.01, 0.012);
  for (let s = 0; s * perString < strings.length; s++) {
    const pts = strings.slice(s * perString, (s + 1) * perString);
    for (let i = 0; i + 1 < pts.length; i++) rod(k, pts[i]!, pts[i + 1]!, 0.008, wire);
    for (const e of [pts[0]!, pts[pts.length - 1]!]) {
      const inBulk = pl && Math.abs(e.x - pl.cx) < pl.w / 2 + 0.1 && Math.abs(e.z - pl.cz) < pl.d / 2 + 0.5;
      if (inBulk) { k.box(e.x, e.y, pl.cz - pl.d / 2 - 0.05, 0.05, 0.05, 0.1, steel); continue; }
      k.cyl(e.x, (y + e.y + 0.1) / 2, e.z, 0.022, 0.022, e.y + 0.1 - y, 6, steel);
      k.box(e.x, y + 0.05, e.z, 0.3, 0.1, 0.3, c4(0.1, 0.1, 0.1));
    }
    pts.forEach((p, i) => {
      k.sphere(p.x, p.y - 0.06, p.z, 0.035, c4(1.5, 1.05, 0.6, M.LIGHT), 1, 1.3, 1, 1);
      k.cyl(p.x, p.y - 0.01, p.z, 0.012, 0.012, 0.04, 6, wire);
      if (i % 4 === 2) P.fixed.push({ p: p.clone().add(V(0, -0.2, 0)), c: new THREE.Color(1.0, 0.68, 0.36).multiplyScalar(0.22), r: 2.0, flick: 0.05 });
    });
  }
  P.keyLights.push({ pos: kids.clone().add(V(0, 2.0, 1.5)), color: new THREE.Color(1, 0.7, 0.4).multiplyScalar(0.35), radius: 6 });
  P.add(placeKit(city, k, 0, 0, 0, 0, 1));
  // the hopscotch, chalked on the tar behind them
  const chalk = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3.7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: chalkTexture(), transparent: true, depthWrite: false, color: new THREE.Color(0.24, 0.24, 0.24), fog: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  chalk.position.set(t.cx - 0.3, y + 0.04, kids.z + 3.1);
  chalk.renderOrder = 2;
  chalk.rotation.y = 0.06;
  P.add(chalk);
  return P;
}

/** The DJ's roof: building b's top tier, the DJ's spot `dj` (the dancers round it, the beams over it). */
export function djRoof(city: City, b: Building, dj: THREE.Vector3) {
  const t = b.tiers.reduce((m, q) => (q.y0 + q.h > m.y0 + m.h ? q : m), b.tiers[0]!);
  const y = t.y0 + t.h, x0 = t.cx - t.w / 2, x1 = t.cx + t.w / 2, z0 = t.cz - t.d / 2, z1 = t.cz + t.d / 2;
  const strings: [THREE.Vector3, THREE.Vector3, number][] = [
    [V(x0 + 0.9, y + 2.6, z1 - 0.6), V(dj.x + 4.4, y + 3.05, dj.z - 7.0), 0.5],
    [V(x1 - 1.0, y + 2.6, z1 - 0.6), V(dj.x - 4.1, y + 2.5, dj.z - 6.6), 0.45],
    [V(x0 + 0.9, y + 2.6, z1 - 0.6), V(x1 - 1.0, y + 2.6, z1 - 0.6), 0.6],
  ];
  const bulbs: THREE.Vector3[] = [];
  for (const [a, bb, sag] of strings) {
    const n = Math.round(a.distanceTo(bb) / 0.9);
    for (let i = 0; i <= n; i++) { const u = i / n; bulbs.push(a.clone().lerp(bb, u).add(V(0, -sag * 4 * u * (1 - u), 0))); }
  }
  const P = new RoofParty(city, bulbs.length);
  P.bulbPos = bulbs;
  P.centre.set(dj.x, y, dj.z - 1);
  const L = P.L;
  const tar = surfaceMaterial(city, SURF.TAR, L, { street: 0, wet: 0.6 });
  const brick = surfaceMaterial(city, SURF.BRICK, L, { street: 0, alb: new THREE.Color(0.15, 0.07, 0.045) });
  const ins = 0.33;
  P.add(floorRect(x0 + ins, z0 + ins, x1 - ins, z1 - ins, y + 0.015, tar));
  // the parapet's inner faces in brick, its coping stones
  const ph = 0.95, li = 0.325;
  P.add(brickWall(x0 + li, z1 - li, x1 - li, z1 - li, y, ph, 0.03, brick));
  P.add(brickWall(x0 + li, z0 + li, x1 - li, z0 + li, y, ph, 0.03, brick));
  P.add(brickWall(x0 + li, z0 + li, x0 + li, z1 - li, y, ph, 0.03, brick));
  P.add(brickWall(x1 - li, z0 + li, x1 - li, z1 - li, y, ph, 0.03, brick));
  const k = new KitBuilder();
  const cw = 0.48, co = 0.13;
  copingRun(k, x0 - 0.02, z1 - co, x1 + 0.02, z1 - co, y + ph, cw, 41);
  copingRun(k, x0 - 0.02, z0 + co, x1 + 0.02, z0 + co, y + ph, cw, 42);
  copingRun(k, x0 + co, z0 + 0.2, x0 + co, z1 - 0.2, y + ph, cw, 43);
  copingRun(k, x1 - co, z0 + 0.2, x1 - co, z1 - 0.2, y + ph, cw, 44);
  // the bulkheads in brick
  for (const pl of b.plant) P.add(surfBox(pl.cx, pl.y0 + pl.h / 2, pl.cz, pl.w + 0.06, pl.h, pl.d + 0.06, brick));
  // AC units over the city's boxes
  for (const a of b.roof) if (a.kind === 0) acUnit(new Fr(k, a.x, y, a.z, 0), a.w, a.h, a.d);
  // the DJ's table, speakers, subs, the road case of moving heads, the records
  const tbl = djTable(new Fr(k, dj.x, y, dj.z + 0.25, 0));
  for (const s of [-1, 1]) {
    speakerOnStand(new Fr(k, dj.x + s * 1.75, y, dj.z + 0.5, s * 0.25));
    sub(new Fr(k, dj.x + s * 1.75, y, dj.z + 0.45, s * 0.25));
  }
  roadCase(new Fr(k, dj.x, y, dj.z + 1.5, 0), 5);
  const r = mulberry32(23);
  for (const [i, ox] of [-1.7, -1.32].entries()) { const f = new Fr(k, dj.x + ox, y, dj.z + 1.55, 0.05 * i); crate(f, i ? c4(0.03, 0.08, 0.35) : c4(0.45, 0.3, 0.02)); records(f, 14, r); }
  crate(new Fr(k, dj.x + 1.55, y, dj.z + 1.6, -0.1), c4(0.04, 0.04, 0.045));
  cooler(new Fr(k, dj.x + 2.6, y, dj.z + 2.55, 0.2), c4(0.04, 0.12, 0.45));
  couch(new Fr(k, x0 + 1.6, y, dj.z - 1.6, Math.PI / 2), c4(0.06, 0.035, 0.02), r);
  campChair(new Fr(k, x0 + 2.3, y, dj.z - 4.2, Math.PI / 2 + 0.4), c4(0.04, 0.1, 0.2));
  campChair(new Fr(k, x1 - 2.0, y, dj.z - 2.6, -Math.PI / 2 - 0.3), c4(0.3, 0.05, 0.03));
  for (const [px, pz] of [[x0 + 1.75, z1 - 0.8], [x0 + 2.55, z1 - 0.85], [x1 - 1.9, z1 - 0.8], [x1 - 0.85, z1 - 1.9], [x0 + 0.85, z1 - 1.9]] as const) planterTree(new Fr(k, px, y, pz, r() * 3), r);
  for (let i = 0; i < 4; i++) pot(new Fr(k, x0 + 3.2 + i * 0.45, y, z1 - 0.7, 0), r);
  // poles for the strings, the wire, the bulbs
  const steel = c4(0.08, 0.08, 0.085), wire = c4(0.01, 0.01, 0.012);
  for (const [a, bb] of strings) for (const e of [a, bb]) { k.cyl(e.x, (y + e.y + 0.1) / 2, e.z, 0.025, 0.025, e.y + 0.1 - y, 6, steel); k.box(e.x, y + 0.06, e.z, 0.35, 0.12, 0.35, c4(0.1, 0.1, 0.1)); }
  let si = 0;
  for (const [a, bb] of strings) {
    const n = Math.round(a.distanceTo(bb) / 0.9);
    for (let i = 0; i < n; i++) rod(k, bulbs[si + i]!, bulbs[si + i + 1]!, 0.008, wire);
    si += n + 1;
  }
  bulbs.forEach((p, i) => {
    k.sphere(p.x, p.y - 0.06, p.z, 0.035, c4(1.5, 1.05, 0.6, M.LIGHT), 1, 1.3, 1, 1);
    if (i % 5 === 2) P.fixed.push({ p: p.clone().add(V(0, -0.2, 0)), c: new THREE.Color(1.0, 0.68, 0.36).multiplyScalar(0.22), r: 2.2, flick: 0.04 });
  });
  P.add(placeKit(city, k, 0, 0, 0, 0, 1));
  // the gear's own light on the floor and on the DJ; the mixer's meters
  P.fixed.unshift(
    { p: tbl.mixer.clone().add(V(0, 0.1, -0.3)), c: new THREE.Color(0.35, 0.6, 1.2).multiplyScalar(0.3), r: 1.4 },
    { p: tbl.laptop.clone().add(V(0, 0, 0.3)), c: new THREE.Color(0.5, 0.65, 1.2).multiplyScalar(0.4), r: 1.2 },
  );
  P.keyLights.push({ pos: tbl.mixer.clone().add(V(0, 0.3, 0.3)), color: new THREE.Color(0.4, 0.6, 1.2).multiplyScalar(0.3), radius: 2.5 });
  for (const s of [-1, 1]) for (let i = 0; i < 8; i++) P.ledPos.push(tbl.mixer.clone().add(V(s * 0.03, 0.002, -0.17 + i * 0.022)));
  for (const d of tbl.decks) for (let i = 0; i < 6; i++) P.ledPos.push(d.clone().add(V(-0.15 + i * 0.06, 0.0, -0.17)));
  return P;
}
