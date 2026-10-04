// The location of the rooftop scenes (pre-chorus 1, chorus 1, the final chorus at dawn), built into the city of
// lib/city.ts: a crosstown street of walk-ups, HIS roof on the south side and HER roof straight across, 19 m
// away. The two hero buildings (and their neighbours in the gap we cleared) are the city's own kind
// (`city.slab`: the same facades, power, glows, moon and dawn), with fire escapes from the city's kit — theirs
// run up to a gap in the front parapet, where the bridge of light will start — and on their roofs everything
// that makes a roof lived in: his bulkhead with a mast and a red light, his garden with string lights, a table and
// two chairs, a dish, a skylight, a lemon tree; her water tower, laundry, a lawn chair, pots, chimneys with steam,
// pigeons on her parapet. All lit by the city's lighting (kitMaterial): blackout, power, dawn.
//
// World axes: the street runs along x with its centreline at z = 0 (the city group is shifted by CITY_OFF);
// his building south (z > 0), hers north (z < 0). The bridge crosses at x = GAP_X.
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';
import type { City } from '../lib/city';
import { KitBuilder, M, antennaGeometry, fireEscapeGeometry, kitBatch, kitMaterial, roofBoxGeometry, waterTowerGeometry, type KInst } from '../lib/city-build';

/** The city street (index j) we stand on, and the city's offset that puts its centreline at world z = 0. */
export const STREET_J = 1;
export const CITY_OFF = new THREE.Vector3(0, 0, -(40 + 80 * STREET_J));
/** Building lines of the street (19 m apart). */
export const LINE = 9.5;
export const GAP_X = 0;
/** Half-width of the two hero buildings. */
const HW = 6.2;

type Style = 'walkup' | 'prewar';
export interface Bld { x0: number; x1: number; z0: number; z1: number; h: number; gH: number; fH: number; floors: number; bayW: number; winW: number; winH: number; sill: number; pairs: number; style: Style; wall: [number, number, number]; seed: number; front: number }

/** Places on the hero buildings (world): fire-escape landings, window sills to sit on, windows. */
export interface SetAnchor { kind: 'window' | 'sill' | 'escape'; pos: THREE.Vector3; yaw: number; floor: number; who: 'his' | 'hers' }

const P = { walkup: { fH: 3.05, gH: 3.4, bayW: 2.4, winW: 0.42, winH: 0.56, sill: 0.26, pairs: 1 }, prewar: { fH: 3.15, gH: 4.6, bayW: 3.2, winW: 0.3, winH: 0.56, sill: 0.25, pairs: 2 } };

const IRON = [0.045, 0.045, 0.05, M.ALB];
const STONE = [0.36, 0.34, 0.31, M.ALB];
const WOOD = [0.2, 0.13, 0.08, M.ALB];
const LEAF = (r: () => number) => [0.03 + r() * 0.03, 0.075 + r() * 0.05, 0.03, M.ALB];

export class RoofSet extends THREE.Group {
  his!: Bld;
  hers!: Bld;
  /** Everything we built in the gaps (heroes and their neighbours). */
  blds: Bld[] = [];
  anchors: SetAnchor[] = [];
  /** His standing spot by the gap, hers (feet, world). */
  heSpot = new THREE.Vector3();
  sheSpot = new THREE.Vector3();
  /** The gap in each front parapet (centre of the opening, at the roof's walking level). */
  hisGap = new THREE.Vector3();
  herGap = new THREE.Vector3();
  steamFrom: THREE.Vector3[] = [];
  bulbs: THREE.Vector3[] = [];
  redLights: THREE.Vector3[] = [];
  perches: { p: THREE.Vector3; yaw: number }[] = [];
  laundry: { a: THREE.Vector3; b: THREE.Vector3; sag: number; items: { u: number; w: number; h: number; c: [number, number, number] }[] }[] = [];
  dish = { p: new THREE.Vector3(), n: new THREE.Vector3() };
  clothes!: THREE.Mesh;
  private clothInst: { a: THREE.Vector3; b: THREE.Vector3; sag: number; u: number; w: number; h: number; c: [number, number, number]; seed: number }[] = [];

  constructor(public city: City) {
    super();
    this.build();
  }

  /** The clear circles (city-local) that make room for the two hero buildings. */
  static clears(): [number, number, number][] {
    const z = 40 + 80 * STREET_J;
    return [[GAP_X - 4, z + LINE + 9, 6], [GAP_X + 4, z + LINE + 9, 6], [GAP_X - 4, z - LINE - 9, 6], [GAP_X + 4, z - LINE - 9, 6]];
  }

  /** Walking level of a building's roof (on top of the slab's cornice lip). */
  static roofTop(b: Bld) { return b.h + 0.3; }

  private build() {
    const city = this.city, U = city.U;
    const plan = city.plan, off = CITY_OFF;
    // the hole the clear circles left in each row: between the nearest neighbours either side
    const hole = (south: boolean) => {
      let xl = -Infinity, xr = Infinity, depth = 22;
      for (const b of plan.buildings) {
        const z0 = b.z0 + off.z, z1 = b.z1 + off.z;
        const inRow = south ? z0 < LINE + 2 && z0 > LINE - 2 : z1 > -LINE - 2 && z1 < -LINE + 2;
        if (!inRow) continue;
        const x0 = b.x0 + off.x, x1 = b.x1 + off.x;
        if (x1 <= GAP_X + 0.5 && x1 > xl) { xl = x1; depth = z1 - z0; }
        if (x0 >= GAP_X - 0.5 && x0 < xr) xr = x0;
      }
      if (!isFinite(xl)) xl = GAP_X - 14;
      if (!isFinite(xr)) xr = GAP_X + 14;
      return { xl, xr, depth: Math.min(Math.max(depth, 16), 26) };
    };
    const mk = (style: Style, storeys: number, x0: number, x1: number, z0: number, z1: number, wall: [number, number, number], seed: number, front: number): Bld => {
      const q = P[style];
      return { x0, x1, z0, z1, h: q.gH + storeys * q.fH + 0.5, ...q, floors: storeys, style, wall, seed, front };
    };
    // each row: [neighbour] hero [neighbour], filling the hole
    const row = (south: boolean) => {
      const h = hole(south), front = south ? -1 : 1;
      const z0 = south ? LINE : -LINE - h.depth, z1 = south ? LINE + h.depth : -LINE;
      const hero = south ? mk('walkup', 7, GAP_X - HW, GAP_X + HW, z0, z1, [0.27, 0.1, 0.065], 217, front) : mk('prewar', 6, GAP_X - HW, GAP_X + HW, z0, z1, [0.4, 0.3, 0.2], 431, front);
      const out = [hero];
      if (GAP_X - HW - h.xl > 2.5) out.push(south ? mk('walkup', 5, h.xl, GAP_X - HW, z0 + 0.6, z1, [0.2, 0.12, 0.08], 233, front) : mk('walkup', 5, h.xl, GAP_X - HW, z0, z1 - 0.6, [0.32, 0.12, 0.07], 251, front));
      else hero.x0 = h.xl;
      if (h.xr - GAP_X - HW > 2.5) out.push(south ? mk('prewar', 8, GAP_X + HW, h.xr, z0 - 0.3, z1, [0.45, 0.42, 0.36], 263, front) : mk('walkup', 4, GAP_X + HW, h.xr, z0, z1 + 0.4, [0.24, 0.16, 0.12], 277, front));
      else hero.x1 = h.xr;
      return out;
    };
    const south = row(true), north = row(false);
    this.his = south[0]!; this.hers = north[0]!;
    this.blds = [...south, ...north];
    for (const b of this.blds) {
      const g = city.slab(((b.x0 + b.x1) / 2) - off.x, ((b.z0 + b.z1) / 2) - off.z, b.x1 - b.x0, b.z1 - b.z0, b.h, { style: b.style, seed: b.seed, wall: b.wall, density: 0.32, cornice: true, shops: b !== this.his && b !== this.hers });
      g.position.copy(off);
      this.add(g);
    }
    const kit = kitMaterial(U), kit2 = kitMaterial(U, { side: THREE.DoubleSide, streetK: 1.2 });
    const K = new KitBuilder();
    const r = mulberry32(17);

    // ---- parapets with the gap and the fire escape's gooseneck rails, on both hero roofs ----
    for (const b of [this.his, this.hers]) {
      const y = RoofSet.roofTop(b), ph = 0.62, t = 0.3;
      const fz = b.front < 0 ? b.z0 : b.z1, bz = b.front < 0 ? b.z1 : b.z0;
      const brick = [b.wall[0] * 0.75, b.wall[1] * 0.75, b.wall[2] * 0.75, M.ALB];
      const wallSeg = (x0: number, x1: number, z0: number, z1: number) => {
        K.box((x0 + x1) / 2, y + ph / 2, (z0 + z1) / 2, Math.abs(x1 - x0), ph, Math.abs(z1 - z0), brick);
        K.box((x0 + x1) / 2, y + ph + 0.04, (z0 + z1) / 2, Math.abs(x1 - x0) + 0.1, 0.08, Math.abs(z1 - z0) + 0.12, STONE);
      };
      const zi = fz - b.front * t / 2;
      wallSeg(b.x0, GAP_X - 0.65, zi - t / 2, zi + t / 2);
      wallSeg(GAP_X + 0.65, b.x1, zi - t / 2, zi + t / 2);
      const zb = bz + b.front * t / 2;
      wallSeg(b.x0, b.x1, zb - t / 2, zb + t / 2);
      wallSeg(b.x0, b.x0 + t, Math.min(fz, bz), Math.max(fz, bz));
      wallSeg(b.x1 - t, b.x1, Math.min(fz, bz), Math.max(fz, bz));
      for (const x of [GAP_X - 0.62, GAP_X + 0.62]) {
        K.cyl(x, y + 0.5, fz + b.front * 0.08, 0.025, 0.025, 1.4, 6, IRON);
        K.box(x, y + 1.2, fz + b.front * 0.33, 0.04, 0.04, 0.55, IRON);
        K.cyl(x, y + 0.2, fz + b.front * 0.58, 0.025, 0.025, 2.0, 6, IRON);
      }
      for (let k = 0; k < 4; k++) K.box(GAP_X, y - 0.9 + k * 0.32, fz + b.front * 0.58, 1.24, 0.03, 0.03, IRON);
      const gap = new THREE.Vector3(GAP_X, y, fz);
      if (b === this.his) this.hisGap.copy(gap); else this.herGap.copy(gap);
    }
    this.heSpot.set(GAP_X + 0.1, RoofSet.roofTop(this.his), this.his.z0 + 1.25);
    this.sheSpot.set(GAP_X - 0.1, RoofSet.roofTop(this.hers), this.hers.z1 - 0.7);

    // ---- fire escapes under the gaps (two bays wide), and on the neighbours ----
    const fe: KInst[] = [];
    const escape = (b: Bld, xc: number, w: number, hero: boolean) => {
      const fz = b.front < 0 ? b.z0 : b.z1, yaw = Math.atan2(0, b.front);
      for (let f = 0; f < b.floors; f++) {
        const y = b.gH + f * b.fH;
        fe.push({ x: xc, y, z: fz, yaw, sx: w, sy: b.fH / 3.05, sz: 1, col: [1, 1, 1], k: 0 });
        if (!hero) continue;
        const who = b === this.his ? 'his' : 'hers', yawOut = b.front > 0 ? 0 : Math.PI;
        this.anchors.push({ kind: 'escape', pos: new THREE.Vector3(xc + w * 0.22, y, fz + b.front * 0.62), yaw: yawOut, floor: f + 1, who });
        this.anchors.push({ kind: 'sill', pos: new THREE.Vector3(xc - w * 0.27, y + 0.6, fz + b.front * 0.3), yaw: yawOut, floor: f + 1, who });
      }
    };
    escape(this.his, GAP_X, 4.6, true);
    escape(this.hers, GAP_X, 4.6, true);
    for (const b of this.blds) if (b !== this.his && b !== this.hers && b.style === 'walkup') escape(b, (b.x0 + b.x1) / 2, Math.min(4.4, b.x1 - b.x0 - 2), false);
    this.add(kitBatch(fireEscapeGeometry(), fe, kit2, new THREE.Vector3(GAP_X, 0, 0), 30));
    // windows of both hero street faces
    for (const b of [this.his, this.hers]) {
      const fz = b.front < 0 ? b.z0 : b.z1;
      for (const x of RoofSet.bayCentres(b)) for (let f = 0; f < b.floors; f++) {
        this.anchors.push({ kind: 'window', pos: new THREE.Vector3(x, b.gH + f * b.fH + b.sill * b.fH, fz), yaw: b.front > 0 ? 0 : Math.PI, floor: f + 1, who: b === this.his ? 'his' : 'hers' });
      }
    }

    // ---- his roof ----
    const H = this.his, hy = RoofSet.roofTop(H);
    // the bulkhead (stair house) at the back left, its door toward the street, a bulb over it; a mast on top
    const bx = H.x0 + 2.2, bz = H.z1 - 3.0;
    K.box(bx, hy + 1.5, bz, 3.4, 3.0, 4.0, [H.wall[0] * 0.85, H.wall[1] * 0.85, H.wall[2] * 0.85, M.ALB]);
    K.box(bx, hy + 3.05, bz, 3.6, 0.12, 4.2, STONE);
    K.box(bx + 0.5, hy + 1.05, bz - 2.02, 0.95, 2.1, 0.06, [0.04, 0.07, 0.05, M.ALB]);
    K.sphere(bx + 0.5, hy + 2.35, bz - 2.1, 0.07, [1, 0.75, 0.45, M.LAMP]);
    this.redLights.push(new THREE.Vector3(bx - 0.6, hy + 3.1 + 6.6, bz + 0.8));
    // the garden behind him: planters along the east parapet, tomatoes on canes, a watering can
    const gx = H.x1 - 1.0;
    for (let k = 0; k < 4; k++) {
      const z = H.z0 + 5.0 + k * 2.0;
      K.box(gx, hy + 0.28, z, 1.2, 0.56, 1.7, [0.16, 0.1, 0.06, M.ALB]);
      for (let j = 0; j < 6; j++) { const s = 0.2 + r() * 0.28; K.sphere(gx - 0.4 + r() * 0.8, hy + 0.6 + s * 0.6, z - 0.65 + r() * 1.3, s, LEAF(r), 1, 1.3, 1, 0); }
    }
    for (let j = 0; j < 5; j++) K.cyl(gx - 0.4 + j * 0.2, hy + 1.1, H.z0 + 13.6, 0.01, 0.01, 1.2, 4, WOOD);
    K.cyl(gx - 1.1, hy + 0.15, H.z0 + 4.4, 0.13, 0.15, 0.3, 10, [0.15, 0.35, 0.2, M.ALB]);
    // string lights between four posts around the table
    const tx = GAP_X + 2.4, tz = H.z0 + 8.5;
    const posts = [new THREE.Vector3(H.x1 - 0.4, hy, H.z0 + 3.0), new THREE.Vector3(H.x1 - 0.4, hy, H.z0 + 13.0), new THREE.Vector3(GAP_X + 0.4, hy, H.z0 + 13.0), new THREE.Vector3(GAP_X + 0.4, hy, H.z0 + 5.0)];
    for (const p of posts) K.cyl(p.x, hy + 1.2, p.z, 0.035, 0.04, 2.4, 6, [0.15, 0.12, 0.1, M.ALB]);
    for (let k = 0; k < posts.length; k++) {
      const a = posts[k]!.clone().setY(hy + 2.35), b = posts[(k + 1) % posts.length]!.clone().setY(hy + 2.35);
      const nb = Math.round(a.distanceTo(b) / 0.55);
      for (let j = 1; j < nb; j++) { const u = j / nb, q = a.clone().lerp(b, u); q.y -= Math.sin(u * Math.PI) * 0.35; this.bulbs.push(q.add(new THREE.Vector3(0, -0.06, 0))); }
    }
    K.cyl(tx, hy + 0.72, tz, 0.42, 0.42, 0.04, 16, [0.25, 0.25, 0.26, M.ALB]);
    K.cyl(tx, hy + 0.36, tz, 0.03, 0.03, 0.72, 6, IRON);
    for (const [cx, cz, ry] of [[tx - 0.8, tz - 0.4, 0.4], [tx + 0.7, tz + 0.6, -2.6]] as [number, number, number][]) {
      K.box(cx, hy + 0.44, cz, 0.44, 0.04, 0.44, [0.2, 0.08, 0.05, M.ALB], ry);
      K.box(cx - Math.sin(ry) * 0.2, hy + 0.68, cz - Math.cos(ry) * 0.2, 0.44, 0.44, 0.04, [0.2, 0.08, 0.05, M.ALB], ry);
      for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) K.box(cx + dx!, hy + 0.22, cz + dz!, 0.03, 0.44, 0.03, IRON);
    }
    K.cyl(tx + 0.1, hy + 0.8, tz + 0.1, 0.04, 0.035, 0.12, 8, [0.4, 0.4, 0.42, M.ALB]);
    // the dish (front left, aimed south and up)
    this.dish.p.set(H.x0 + 1.4, hy + 1.4, H.z0 + 2.4);
    this.dish.n.set(0.15, 0.7, 0.7).normalize();
    K.cyl(this.dish.p.x, hy + 0.7, this.dish.p.z, 0.04, 0.04, 1.4, 6, IRON);
    K.add(new THREE.SphereGeometry(0.55, 18, 6, 0, Math.PI * 2, 0, 0.6), new THREE.Matrix4().compose(this.dish.p.clone().addScaledVector(this.dish.n, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.dish.n), new THREE.Vector3(1, 1, 1)), [0.42, 0.42, 0.44, M.ALB]);
    K.cyl(this.dish.p.x + this.dish.n.x * 0.4, this.dish.p.y + this.dish.n.y * 0.4, this.dish.p.z + this.dish.n.z * 0.4, 0.012, 0.012, 0.8, 4, IRON);
    // skylight
    K.box(H.x0 + 2.4, hy + 0.25, H.z0 + 9.0, 2.4, 0.5, 2.4, [0.2, 0.2, 0.21, M.ALB]);
    K.add(new THREE.ConeGeometry(1.62, 0.6, 4, 1), new THREE.Matrix4().compose(new THREE.Vector3(H.x0 + 2.4, hy + 0.8, H.z0 + 9.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)), new THREE.Vector3(1, 1, 1)), [0.04, 0.05, 0.06, M.GLASS]);
    // a lemon tree in a pot by his gap, an old crate, a coiled hose, vent pipes
    K.cyl(GAP_X - 1.5, hy + 0.22, H.z0 + 1.0, 0.25, 0.19, 0.44, 10, [0.3, 0.12, 0.07, M.ALB]);
    for (let j = 0; j < 7; j++) K.sphere(GAP_X - 1.5 + (r() - 0.5) * 0.55, hy + 0.85 + r() * 0.55, H.z0 + 1.0 + (r() - 0.5) * 0.55, 0.18 + r() * 0.1, LEAF(r), 1, 1, 1, 0);
    for (let j = 0; j < 3; j++) K.sphere(GAP_X - 1.5 + (r() - 0.5) * 0.5, hy + 0.9 + r() * 0.4, H.z0 + 0.75, 0.045, [0.5, 0.42, 0.08, M.ALB]);
    K.box(GAP_X + 1.7, hy + 0.22, H.z0 + 1.3, 0.6, 0.44, 0.45, WOOD, 0.3);
    K.add(new THREE.TorusGeometry(0.3, 0.03, 5, 16), new THREE.Matrix4().compose(new THREE.Vector3(H.x0 + 1.2, hy + 0.05, H.z0 + 6.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)), [0.08, 0.2, 0.08, M.ALB]);
    for (const [px, pz, ph] of [[H.x0 + 4.5, H.z1 - 1.5, 1.4], [H.x0 + 5.0, H.z1 - 1.2, 0.9], [GAP_X + 3.0, H.z1 - 1.0, 1.1]] as [number, number, number][]) {
      K.cyl(px, hy + ph / 2, pz, 0.08, 0.08, ph, 8, [0.22, 0.22, 0.22, M.ALB]);
      K.cyl(px, hy + ph + 0.08, pz, 0.14, 0.1, 0.12, 8, [0.22, 0.22, 0.22, M.ALB]);
    }

    // ---- her roof ----
    const R = this.hers, sy = RoofSet.roofTop(R);
    K.box(R.x1 - 2.2, sy + 1.4, R.z0 + 3.0, 3.2, 2.8, 3.8, [R.wall[0] * 0.8, R.wall[1] * 0.8, R.wall[2] * 0.8, M.ALB]);
    K.box(R.x1 - 2.2, sy + 2.85, R.z0 + 3.0, 3.4, 0.12, 4.0, STONE);
    K.box(R.x1 - 2.7, sy + 1.05, R.z0 + 4.92, 0.95, 2.1, 0.06, [0.15, 0.06, 0.04, M.ALB]);
    const la = new THREE.Vector3(GAP_X + 1.9, sy + 2.0, R.z1 - 3.2), lb = new THREE.Vector3(R.x1 - 1.0, sy + 2.0, R.z1 - 8.5);
    for (const p of [la, lb]) { K.cyl(p.x, sy + 1.05, p.z, 0.04, 0.04, 2.1, 6, [0.2, 0.2, 0.2, M.ALB]); K.box(p.x, sy + 2.05, p.z, 0.8, 0.04, 0.04, [0.2, 0.2, 0.2, M.ALB], Math.atan2(lb.x - la.x, lb.z - la.z) + Math.PI / 2); }
    this.laundry.push({ a: la, b: lb, sag: 0.25, items: [{ u: 0.12, w: 0.55, h: 0.7, c: [0.5, 0.48, 0.45] }, { u: 0.27, w: 0.42, h: 0.5, c: [0.3, 0.08, 0.06] }, { u: 0.47, w: 1.2, h: 1.1, c: [0.55, 0.55, 0.58] }, { u: 0.67, w: 0.4, h: 0.75, c: [0.08, 0.12, 0.25] }, { u: 0.83, w: 0.5, h: 0.6, c: [0.45, 0.35, 0.15] }] });
    // a lawn chair facing the skyline, pots by the gap, a bench of bricks with a radio, chimneys
    const cx = GAP_X - 3.4, cz = R.z1 - 6.0;
    K.box(cx, sy + 0.37, cz, 0.6, 0.05, 1.0, [0.1, 0.25, 0.22, M.ALB], 0.3);
    K.box(cx + 0.15, sy + 0.7, cz + 0.5, 0.6, 0.65, 0.05, [0.1, 0.25, 0.22, M.ALB], 0.3, 0.35);
    for (const [dx, dz] of [[-0.25, -0.45], [0.25, -0.45], [-0.25, 0.45], [0.25, 0.45]]) K.box(cx + dx!, sy + 0.18, cz + dz!, 0.03, 0.36, 0.03, [0.4, 0.4, 0.42, M.ALB]);
    for (const [px, pz] of [[GAP_X - 1.4, R.z1 - 0.9], [GAP_X + 1.5, R.z1 - 0.8], [GAP_X + 2.1, R.z1 - 1.0], [R.x0 + 1.0, R.z1 - 1.0]] as [number, number][]) {
      K.cyl(px, sy + 0.2, pz, 0.22, 0.17, 0.4, 10, [0.3, 0.12, 0.07, M.ALB]);
      for (let j = 0; j < 4; j++) K.sphere(px + (r() - 0.5) * 0.25, sy + 0.55 + r() * 0.25, pz + (r() - 0.5) * 0.25, 0.18 + r() * 0.1, LEAF(r), 1, 1, 1, 0);
    }
    K.box(cx + 1.2, sy + 0.2, cz - 0.6, 0.9, 0.4, 0.45, [0.3, 0.12, 0.08, M.ALB]);
    K.box(cx + 1.2, sy + 0.5, cz - 0.6, 0.32, 0.2, 0.12, [0.1, 0.1, 0.11, M.ALB]);
    const chim = (x: number, y: number, z: number, h: number, wall: [number, number, number], steam: boolean) => {
      K.box(x, y + h / 2, z, 0.9, h, 0.7, [wall[0] * 0.85, wall[1] * 0.85, wall[2] * 0.85, M.ALB]);
      K.box(x, y + h + 0.06, z, 1.04, 0.12, 0.84, STONE);
      if (steam) this.steamFrom.push(new THREE.Vector3(x, y + h + 0.2, z));
    };
    chim(R.x0 + 0.9, sy, R.z0 + 9, 1.8, R.wall, true);
    chim(R.x0 + 0.9, sy, R.z0 + 11, 1.5, R.wall, false);
    chim(H.x0 + 0.9, hy, H.z1 - 7.0, 1.6, H.wall, false);
    // pigeons along her parapet, right of the gap; a few on his
    for (let k = 0; k < 5; k++) this.perches.push({ p: new THREE.Vector3(GAP_X + 1.8 + k * 0.42 + (k % 2) * 0.1, sy + 0.71, R.z1 - 0.15), yaw: k % 2 ? 0.5 : -0.7 });
    for (let k = 0; k < 3; k++) this.perches.push({ p: new THREE.Vector3(H.x0 + 2.5 + k * 0.5, hy + 0.71, H.z0 + 0.15), yaw: k % 2 ? 2.6 : -2.9 });

    this.add(kitBatch(K.geometry(), [{ x: 0, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.5 }], kit, new THREE.Vector3(0, 0, 0), 60));
    // her water tower (the city's kit), his mast, AC boxes and vents on all the roofs we built
    const wt: KInst[] = [{ x: R.x0 + 2.8, y: sy - 0.3, z: R.z0 + 3.6, yaw: 0.4, sx: 1.8, sy: 1.0, sz: 1.8, col: [1, 1, 1], k: 0 }];
    const boxes: KInst[] = [
      { x: GAP_X + 2.0, y: hy, z: H.z1 - 2.2, yaw: 0, sx: 1.3, sy: 1.0, sz: 0.9, col: [0.4, 0.4, 0.38], k: 0 },
      { x: GAP_X + 3.6, y: hy, z: H.z1 - 2.2, yaw: 0, sx: 1.3, sy: 1.0, sz: 0.9, col: [0.4, 0.4, 0.38], k: 0 },
      { x: GAP_X + 1.0, y: sy, z: R.z0 + 2.0, yaw: 0, sx: 1.2, sy: 0.9, sz: 0.9, col: [0.38, 0.38, 0.37], k: 0 },
    ];
    for (const b of this.blds) {
      if (b === this.his || b === this.hers) continue;
      const y = RoofSet.roofTop(b), cxb = (b.x0 + b.x1) / 2, czb = (b.z0 + b.z1) / 2;
      if (b.style === 'prewar' || b.floors >= 5) wt.push({ x: cxb + (r() - 0.5) * 3, y: y - 0.3, z: czb + (r() - 0.5) * 6, yaw: r() * 6, sx: 1.6 + r() * 0.5, sy: 0.9 + r() * 0.2, sz: 1.6, col: [1, 1, 1], k: 0 });
      for (let k = 0; k < 3; k++) boxes.push({ x: b.x0 + 2 + r() * (b.x1 - b.x0 - 4), y, z: Math.min(b.z0, b.z1) + 3 + r() * (Math.abs(b.z1 - b.z0) - 6), yaw: 0, sx: 0.8 + r() * 0.8, sy: 0.6 + r() * 0.8, sz: 0.8 + r() * 0.6, col: [0.3 + r() * 0.15, 0.3 + r() * 0.15, 0.3 + r() * 0.15], k: 0 });
    }
    this.add(kitBatch(waterTowerGeometry(), wt, kit, new THREE.Vector3(0, 0, 0), 30));
    this.add(kitBatch(antennaGeometry(), [{ x: bx - 0.6, y: hy + 3.1, z: bz + 0.8, yaw: 0, sx: 0.12, sy: 6.6, sz: 0.12, col: [1, 1, 1], k: 0 }], kit, new THREE.Vector3(bx, 0, bz), 2));
    this.add(kitBatch(roofBoxGeometry(), boxes, kit, new THREE.Vector3(0, 0, 0), 40));
    this.buildLaundry();
  }

  /** The windows of a building's street face as the city's facade lays them out (world; city Anchor shape). */
  static windows(b: Bld): { kind: 'window'; pos: THREE.Vector3; facing: THREE.Vector3; building: number; floor: number; size: [number, number] }[] {
    const fw = b.x1 - b.x0, pier = 0.55, avail = Math.max(fw - 2 * pier, 0.5);
    const nb = Math.max(1, Math.floor(avail / b.bayW + 0.5)), bw = avail / nb;
    const sub = b.pairs > 1.5 ? 2 : 1, ww = (Math.min(b.winW * sub, 0.96) * bw) / sub;
    const fz = b.front < 0 ? b.z0 : b.z1, cx = (b.x0 + b.x1) / 2;
    const f1 = Math.floor((b.h - 0.95 - b.gH) / b.fH - b.sill - b.winH + 1e-3);
    const out: ReturnType<typeof RoofSet.windows> = [];
    for (let f = 0; f <= f1; f++) for (let k = 0; k < nb; k++) for (let s = 0; s < sub; s++) {
      const u = -fw / 2 + pier + (k + (s + 0.5) / sub) * bw;
      out.push({ kind: 'window', pos: new THREE.Vector3(cx + u, b.gH + f * b.fH + b.sill * b.fH, fz), facing: new THREE.Vector3(0, 0, b.front), building: -1, floor: f + 1, size: [ww, b.winH * b.fH] });
    }
    return out;
  }

  /** Bay centres (world x) of a building's street face, as the city's facade lays them out. */
  static bayCentres(b: Bld) {
    const fw = b.x1 - b.x0, pier = 0.55, avail = Math.max(fw - 2 * pier, 0.5);
    const nb = Math.max(1, Math.floor(avail / b.bayW + 0.5)), bw = avail / nb;
    const out: number[] = [];
    for (let k = 0; k < nb; k++) out.push(b.x0 + pier + (k + 0.5) * bw);
    return out;
  }

  /** Laundry: cloth quads on the kit material, swaying (instance yaw updated per frame). */
  private buildLaundry() {
    const kit = kitMaterial(this.city.U, { side: THREE.DoubleSide });
    const g = new KitBuilder().quad(0, -0.5, 0, 1, 1, [1, 1, 1, M.TINT]).geometry();
    const list: KInst[] = [];
    this.laundry.forEach((l) => l.items.forEach((it) => {
      this.clothInst.push({ a: l.a, b: l.b, sag: l.sag, ...it, seed: list.length * 1.7 });
      list.push({ x: 0, y: 0, z: 0, yaw: 0, sx: it.w, sy: it.h, sz: 1, col: it.c, k: 0 });
    }));
    this.clothes = kitBatch(g, list, kit, new THREE.Vector3(0, 0, 0), 30);
    this.clothes.frustumCulled = false;
    this.add(this.clothes);
  }

  /** Per frame: the laundry sways in the breeze (wind 0..1). */
  update(t: number, wind = 0.5) {
    const g = this.clothes.geometry as THREE.InstancedBufferGeometry;
    const pos = g.getAttribute('iPos') as THREE.InstancedBufferAttribute;
    this.clothInst.forEach((c, i) => {
      const p = c.a.clone().lerp(c.b, c.u);
      p.y -= Math.sin(c.u * Math.PI) * c.sag;
      const yaw0 = Math.atan2(-(c.b.z - c.a.z), c.b.x - c.a.x);
      const sw = wind * (0.25 * Math.sin(t * 1.3 + c.seed) + 0.12 * Math.sin(t * 2.9 + c.seed * 2.1));
      pos.setXYZW(i, p.x, p.y, p.z, yaw0 + sw);
    });
    pos.needsUpdate = true;
  }
}
