// Props of the overpass break: the overpass deck's edge where they stand (concrete parapet, a steel pipe
// railing, lamp posts), their breath steaming in the cold, a tug sliding down the river with its lights.
import * as THREE from 'three';
import { KitBuilder, M } from '../lib/city-build';
import type { City } from '../lib/city';
import type { RealFigure } from '../lib/people';
import { GlowPoints } from '../lib/points';
import { hash } from '../../engine/util';
import { placeKit } from './run-props';

/**
 * (Stand-in until the city's overpass has its walkway.) The overpass's walkway along its west side: a strip of
 * deck from the railing at `railX` to a jersey barrier 3 m in, the steel railing on a low curb (with a missing
 * panel at `gapZ`, the edge open), lamp posts on the barrier; z from z0 to z1 (world coordinates).
 */
export function walkwayKit(railX: number, y: number, z0: number, z1: number, gapZ: number) {
  const k = new KitBuilder();
  const conc = [0.2, 0.2, 0.195, M.ALB], walk = [0.13, 0.13, 0.13, M.ALB], steel = [0.12, 0.13, 0.14, M.ALB];
  const L = z1 - z0, zc = (z0 + z1) / 2;
  k.box(railX + 1.5, y - 0.12, zc, 3.1, 0.24, L, walk); // the walkway
  k.box(railX - 0.1, y - 0.7, zc, 0.5, 1.4, L, conc); // the edge beam
  k.box(railX + 0.08, y + 0.12, zc, 0.22, 0.24, L, conc); // the curb under the railing
  k.box(railX + 3.15, y + 0.42, zc, 0.35, 0.84, L, conc); // the jersey barrier
  for (let z = z0 + 1; z < z1; z += 1.8) {
    if (Math.abs(z - gapZ) < 1.6) continue;
    k.box(railX + 0.08, y + 0.68, z, 0.05, 0.9, 0.05, steel);
  }
  for (const [a, b] of [[z0, gapZ - 1.5], [gapZ + 1.5, z1]] as const) {
    for (const yy of [y + 0.6, y + 1.1]) k.box(railX + 0.08, yy, (a + b) / 2, 0.05, 0.05, b - a, steel);
  }
  for (const z of [103, 139]) {
    k.box(railX + 3.15, y + 3.7, z, 0.16, 6.6, 0.16, steel);
    k.box(railX + 2.6, y + 6.95, z, 1.2, 0.1, 0.12, steel);
    k.box(railX + 2.1, y + 6.85, z, 0.45, 0.1, 0.28, [1.6, 1.3, 0.9, M.LIGHT]);
  }
  return k;
}

/** Breath steaming: on every out-breath a soft puff leaves the mouth, drifts and spreads, fading. */
export class Breath extends GlowPoints {
  constructor(n: number) { super(n, 0.07); }

  /** figs: [figure, breathing phase (cycles), strength]. */
  update(t: number, figs: [RealFigure, number, number][]) {
    let j = 0;
    const per = Math.floor(this.n / figs.length);
    figs.forEach(([fig, ph, k], fi) => {
      const head = fig.headPoint(new THREE.Vector3());
      const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(fig.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      const mouth = head.addScaledVector(fw, 0.11).add(new THREE.Vector3(0, -0.07, 0));
      // the last four out-breaths (each at phase n + 0.5), each a puff of particles
      const cur = Math.floor(ph - 0.5);
      for (let b = 0; b < 4; b++) {
        const n = cur - b, age = (ph - (n + 0.5)) / Math.max(0.3, 1.2 - 0.0); // in breath cycles
        for (let i = 0; i < per / 4; i++, j++) {
          if (j >= this.n) return;
          if (age < 0 || age > 1.6) { this.hide(j); continue; }
          const r1 = hash(fi, n, i, 1), r2 = hash(fi, n, i, 2), r3 = hash(fi, n, i, 3);
          const a = age;
          const p = mouth.clone().addScaledVector(fw, 0.25 * a + 0.05 * r1).add(new THREE.Vector3((r2 - 0.5) * 0.18 * a, 0.06 * a + (r3 - 0.5) * 0.12 * a, (r1 - 0.5) * 0.18 * a));
          p.x += 0.12 * a * a; // the river wind
          const fade = Math.min(1, a * 6) * Math.max(0, 1 - a / 1.6);
          this.set(j, p.x, p.y, p.z, [0.55, 0.62, 0.8], 0.05 * k * fade, 1.2 + 3 * a);
        }
      }
    });
    for (; j < this.n; j++) this.hide(j);
    this.commit();
  }
}

/** A tug pushing down the river in the half-light: dark hull, lit wheelhouse, its mast lights and wake. */
export class Tug extends THREE.Group {
  lights = new GlowPoints(40, 0.35);
  body: THREE.Mesh;
  constructor(city: City, public x = 1232, public z0 = 120, public v = 2.2) {
    super();
    const k = new KitBuilder();
    const hull = [0.04, 0.035, 0.035, M.ALB], deck = [0.12, 0.1, 0.08, M.ALB], white = [0.35, 0.35, 0.33, M.ALB];
    k.box(0, 0.6, 0, 3.6, 1.6, 9, hull);
    k.box(0, 1.5, 0.5, 3.4, 0.2, 8.4, deck);
    k.box(0, 2.6, -1.2, 2.6, 2.0, 3.2, white);
    k.box(0, 4.1, -1.4, 2.0, 1.1, 1.9, white);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.box(s * 1.31, 2.9, -2.2 + i * 1.0, 0.02, 0.6, 0.6, [1.4, 1.0, 0.6, M.LIGHT]);
    k.box(0, 4.15, -0.43, 1.6, 0.5, 0.02, [1.3, 1.0, 0.7, M.LIGHT]);
    k.box(0, 5.8, -1.6, 0.12, 2.4, 0.12, [0.1, 0.1, 0.1, M.ALB]);
    this.body = placeKit(city, k, 0, 0, 0);
    this.add(this.body, this.lights);
  }

  update(t: number) {
    const z = this.z0 + this.v * t - this.v * 147;
    this.body.position.set(this.x, 0, z);
    this.body.updateMatrix();
    const L = this.lights;
    let j = 0;
    L.set(j++, this.x, 7.1, z - 1.6, [1, 0.95, 0.85], 1.6, 1);
    L.set(j++, this.x - 1.7, 3.6, z + 0.2, [0.1, 1, 0.3], 1.2, 0.8);
    L.set(j++, this.x + 1.7, 3.6, z + 0.2, [1, 0.1, 0.05], 1.2, 0.8);
    // the wake: reflections trailing behind, rocking
    for (let i = 0; i < 30; i++) {
      const d = 4.5 + i * 1.6, sx = (i % 2 ? 1 : -1) * (0.6 + i * 0.12);
      L.set(j++, this.x + sx, 0.05, z - d, [1, 0.8, 0.55], 0.25 * (1 - i / 30) * (0.6 + 0.4 * Math.sin(t * 5 + i)), 1.4);
    }
    L.commit(j);
  }
}
