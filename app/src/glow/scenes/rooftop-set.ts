// The location of the rooftop scenes (pre-chorus 1, chorus 1, the final chorus at dawn), built into the city of
// lib/city.ts: a crosstown street of walk-ups, HIS roof on the south side and HER roof straight across, 19 m
// away. The two hero buildings are the city's own kind (`city.slab`: the same facades, power, glows, moon and
// dawn), with their fire escapes (the city's kit), and on their roofs everything that makes a roof lived in:
// parapets with a gap where the fire escape's ladder arrives (where the bridge of light will start), a bulkhead,
// a water tower, an antenna with a red light, his garden with string lights, a dish, a skylight, a table and two
// chairs; her laundry line, a lawn chair, pots; chimneys with steam, pigeons on her parapet. All lit by the city's
// lighting (kitMaterial), so it reads the same in the blackout, when the power comes back and at dawn.
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

export interface Hero { x0: number; x1: number; z0: number; z1: number; h: number; gH: number; fH: number; floors: number; bayW: number; winW: number; winH: number; sill: number; pairs: number; style: 'walkup' | 'prewar'; wall: [number, number, number]; seed: number; front: number }

/** Window / place anchors on the hero buildings (world). */
export interface SetAnchor { kind: 'window' | 'sill' | 'escape' | 'roof'; pos: THREE.Vector3; yaw: number; floor: number; who: 'his' | 'hers' }

const P = { walkup: { fH: 3.05, gH: 3.4, bayW: 2.4, winW: 0.42, winH: 0.56, sill: 0.26, pairs: 1 }, prewar: { fH: 3.15, gH: 4.6, bayW: 3.2, winW: 0.3, winH: 0.56, sill: 0.25, pairs: 2 } };

const IRON = [0.045, 0.045, 0.05, M.ALB];
const STONE = [0.36, 0.34, 0.31, M.ALB];
const WOOD = [0.2, 0.13, 0.08, M.ALB];

export class RoofSet extends THREE.Group {
  his!: Hero;
  hers!: Hero;
  anchors: SetAnchor[] = [];
  /** His standing spot by the gap, hers (feet, world). */
  heSpot = new THREE.Vector3();
  sheSpot = new THREE.Vector3();
  /** The gap in each front parapet (centre of the opening at roof level). */
  hisGap = new THREE.Vector3();
  herGap = new THREE.Vector3();
  steamFrom: THREE.Vector3[] = [];
  bulbs: THREE.Vector3[] = [];
  redLights: THREE.Vector3[] = [];
  perches: { p: THREE.Vector3; yaw: number }[] = [];
  laundry: { a: THREE.Vector3; b: THREE.Vector3; sag: number; items: { u: number; w: number; h: number; c: [number, number, number] }[] }[] = [];
  dish = { p: new THREE.Vector3(), n: new THREE.Vector3() };
  /** The cat's sill and the girl's seat on her fire escape. */
  catSpot = new THREE.Vector3();
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
      if (!isFinite(xl)) xl = GAP_X - 11;
      if (!isFinite(xr)) xr = GAP_X + 11;
      return { xl: Math.max(xl, GAP_X - 16), xr: Math.min(xr, GAP_X + 16), depth: Math.min(Math.max(depth, 16), 26) };
    };
    const hs = hole(true), hn = hole(false);
    const mk = (style: 'walkup' | 'prewar', storeys: number, x0: number, x1: number, z0: number, z1: number, wall: [number, number, number], seed: number, front: number): Hero => {
      const q = P[style];
      return { x0, x1, z0, z1, h: q.gH + storeys * q.fH + 0.5, ...q, floors: storeys, style, wall, seed, front };
    };
    this.his = mk('walkup', 7, hs.xl, hs.xr, LINE, LINE + hs.depth, [0.27, 0.1, 0.065], 217, -1);
    this.hers = mk('prewar', 6, hn.xl, hn.xr, -LINE - hn.depth, -LINE, [0.4, 0.3, 0.2], 431, 1);
    for (const b of [this.his, this.hers]) {
      const g = city.slab(((b.x0 + b.x1) / 2) - off.x, ((b.z0 + b.z1) / 2) - off.z, b.x1 - b.x0, b.z1 - b.z0, b.h, { style: b.style, seed: b.seed, wall: b.wall, density: 0.32, cornice: true, shops: false });
      g.position.copy(off);
      this.add(g);
    }
    const kit = kitMaterial(U), kit2 = kitMaterial(U, { side: THREE.DoubleSide, streetK: 1.2 });
    const K = new KitBuilder();
    const r = mulberry32(17);

    // ---- parapets with the gap, coping, on both hero roofs ----
    for (const b of [this.his, this.hers]) {
      const y = b.h + 0.3, ph = 0.7, t = 0.3;
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
      wallSeg(b.x0 + t / 2 - t / 2, b.x0 + t, Math.min(fz, bz), Math.max(fz, bz));
      wallSeg(b.x1 - t, b.x1, Math.min(fz, bz), Math.max(fz, bz));
      // the gooseneck rails of the fire-escape ladder at the gap
      for (const x of [GAP_X - 0.62, GAP_X + 0.62]) {
        K.cyl(x, y + 0.5, fz, 0.025, 0.025, 1.4, 6, IRON);
        K.box(x, y + 1.2, fz + b.front * 0.25, 0.04, 0.04, 0.55, IRON);
        K.cyl(x, y + 0.6, fz + b.front * 0.5, 0.025, 0.025, 1.2, 6, IRON);
      }
      for (let k = 0; k < 4; k++) K.box(GAP_X, y - 0.9 + k * 0.32, fz + b.front * 0.5, 1.2, 0.03, 0.03, IRON);
      const gap = new THREE.Vector3(GAP_X, y, fz);
      if (b === this.his) this.hisGap.copy(gap); else this.herGap.copy(gap);
    }
    this.heSpot.set(GAP_X + 0.15, this.his.h + 0.3, this.his.z0 + 1.3);
    this.sheSpot.set(GAP_X - 0.1, this.hers.h + 0.3, this.hers.z1 - 1.3);

    // ---- fire escapes on both street faces (left of the gap on hers, right on his) ----
    const fe: KInst[] = [];
    const escape = (b: Hero, xc: number, w: number) => {
      const fz = b.front < 0 ? b.z0 : b.z1, yaw = Math.atan2(0, b.front);
      for (let f = 0; f < b.floors; f++) {
        const y = b.gH + f * b.fH;
        fe.push({ x: xc, y, z: fz, yaw, sx: w, sy: b.fH / 3.05, sz: 1, col: [1, 1, 1], k: 0 });
        this.anchors.push({ kind: 'escape', pos: new THREE.Vector3(xc + w * 0.25, y, fz + b.front * 0.62), yaw: b.front > 0 ? 0 : Math.PI, floor: f + 1, who: b === this.his ? 'his' : 'hers' });
        this.anchors.push({ kind: 'sill', pos: new THREE.Vector3(xc - w * 0.28, y + 0.62, fz + b.front * 0.3), yaw: b.front > 0 ? 0 : Math.PI, floor: f + 1, who: b === this.his ? 'his' : 'hers' });
      }
    };
    const hisW = this.bayCentres(this.his), herW = this.bayCentres(this.hers);
    const pick = (xs: number[], side: number) => xs.filter((x) => side * (x - GAP_X) > 3.5);
    const hisFE = pick(hisW, 1), herFE = pick(herW, -1);
    if (hisFE.length >= 2) escape(this.his, (hisFE[0]! + hisFE[1]!) / 2, Math.abs(hisFE[1]! - hisFE[0]!) + 1.6);
    if (herFE.length >= 2) escape(this.hers, (herFE.at(-1)! + herFE.at(-2)!) / 2, Math.abs(herFE.at(-1)! - herFE.at(-2)!) + 1.6);
    if (fe.length) this.add(kitBatch(fireEscapeGeometry(), fe, kit2, new THREE.Vector3(GAP_X, 0, 0), 4));
    // windows of both street faces (people stand behind them)
    for (const b of [this.his, this.hers]) {
      const fz = b.front < 0 ? b.z0 : b.z1;
      for (const x of this.bayCentres(b)) for (let f = 0; f < b.floors; f++) {
        this.anchors.push({ kind: 'window', pos: new THREE.Vector3(x, b.gH + f * b.fH + b.sill * b.fH, fz), yaw: b.front > 0 ? 0 : Math.PI, floor: f + 1, who: b === this.his ? 'his' : 'hers' });
      }
    }

    // ---- his roof: bulkhead, antenna, garden with string lights, dish, skylight, table and chairs ----
    const hy = this.his.h + 0.3, H = this.his;
    const bulkX = H.x0 + 3.2, bulkZ = H.z1 - 4.5;
    K.box(bulkX, hy + 1.5, bulkZ, 3.4, 3.0, 4.2, [H.wall[0] * 0.8, H.wall[1] * 0.8, H.wall[2] * 0.8, M.ALB]);
    K.box(bulkX, hy + 3.05, bulkZ, 3.6, 0.12, 4.4, STONE);
    K.box(bulkX + 0.4, hy + 1.05, bulkZ - 2.12, 0.95, 2.1, 0.06, [0.05, 0.08, 0.06, M.ALB]);
    K.sphere(bulkX + 0.4, hy + 2.35, bulkZ - 2.2, 0.07, [1, 0.75, 0.45, M.LAMP]);
    this.redLights.push(new THREE.Vector3(bulkX - 0.6, hy + 3.1 + 6.6, bulkZ + 0.8));
    // the garden along the east parapet
    const gx = H.x1 - 1.4;
    for (let k = 0; k < 4; k++) {
      const z = H.z0 + 3.5 + k * 2.2;
      K.box(gx, hy + 0.28, z, 1.3, 0.56, 1.8, [0.16, 0.1, 0.06, M.ALB]);
      for (let j = 0; j < 6; j++) {
        const s = 0.22 + r() * 0.3;
        K.sphere(gx - 0.45 + r() * 0.9, hy + 0.6 + s * 0.6, z - 0.7 + r() * 1.4, s, [0.03 + r() * 0.03, 0.075 + r() * 0.05, 0.03, M.ALB], 1, 1.3, 1, 0);
      }
    }
    // tomatoes on canes, a watering can
    for (let j = 0; j < 5; j++) K.cyl(gx - 0.4 + j * 0.2, hy + 1.1, H.z0 + 12.3, 0.01, 0.01, 1.2, 4, WOOD);
    K.cyl(gx - 1.2, hy + 0.15, H.z0 + 5, 0.13, 0.15, 0.3, 10, [0.15, 0.35, 0.2, M.ALB]);
    // string lights on posts around the garden and the table
    const posts = [new THREE.Vector3(H.x1 - 0.5, hy, H.z0 + 1.8), new THREE.Vector3(H.x1 - 0.5, hy, H.z0 + 12.5), new THREE.Vector3(H.x1 - 6.0, hy, H.z0 + 12.5), new THREE.Vector3(H.x1 - 6.0, hy, H.z0 + 4.5)];
    for (const p of posts) K.cyl(p.x, hy + 1.2, p.z, 0.035, 0.04, 2.4, 6, [0.15, 0.12, 0.1, M.ALB]);
    for (let k = 0; k < posts.length; k++) {
      const a = posts[k]!.clone().setY(hy + 2.35), b = posts[(k + 1) % posts.length]!.clone().setY(hy + 2.35);
      const nb = Math.round(a.distanceTo(b) / 0.6);
      for (let j = 1; j < nb; j++) {
        const u = j / nb, q = a.clone().lerp(b, u);
        q.y -= Math.sin(u * Math.PI) * 0.35;
        this.bulbs.push(q.clone().add(new THREE.Vector3(0, -0.06, 0)));
      }
    }
    // the table and two chairs
    const tx = H.x1 - 3.4, tz = H.z0 + 8.2;
    K.cyl(tx, hy + 0.72, tz, 0.42, 0.42, 0.04, 16, [0.25, 0.25, 0.26, M.ALB]);
    K.cyl(tx, hy + 0.36, tz, 0.03, 0.03, 0.72, 6, IRON);
    for (const [cx, cz, ry] of [[tx - 0.8, tz - 0.4, 0.4], [tx + 0.7, tz + 0.6, -2.6]] as [number, number, number][]) {
      K.box(cx, hy + 0.44, cz, 0.44, 0.04, 0.44, [0.2, 0.08, 0.05, M.ALB], ry);
      K.box(cx + Math.sin(ry) * -0.2, hy + 0.68, cz + Math.cos(ry) * -0.2, 0.44, 0.44, 0.04, [0.2, 0.08, 0.05, M.ALB], ry);
      for (const [dx, dz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) K.box(cx + dx!, hy + 0.22, cz + dz!, 0.03, 0.44, 0.03, IRON);
    }
    K.cyl(tx + 0.1, hy + 0.8, tz + 0.1, 0.04, 0.035, 0.12, 8, [0.4, 0.4, 0.42, M.ALB]);
    // the dish, aimed south-up
    this.dish.p.set(H.x0 + 2.0, hy + 1.4, H.z0 + 3.0);
    this.dish.n.set(0.15, 0.7, 0.7).normalize();
    K.cyl(this.dish.p.x, hy + 0.7, this.dish.p.z, 0.04, 0.04, 1.4, 6, IRON);
    {
      const g = new THREE.SphereGeometry(0.55, 18, 6, 0, Math.PI * 2, 0, 0.6);
      const m = new THREE.Matrix4().compose(this.dish.p.clone().addScaledVector(this.dish.n, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.dish.n), new THREE.Vector3(1, 1, 1));
      K.add(g, m, [0.42, 0.42, 0.44, M.ALB]);
    }
    // skylight: a frame and dark glass
    K.box(GAP_X - 4.5, hy + 0.25, H.z0 + 7.5, 2.6, 0.5, 2.6, [0.2, 0.2, 0.21, M.ALB]);
    K.add(new THREE.ConeGeometry(1.75, 0.7, 4, 1), new THREE.Matrix4().compose(new THREE.Vector3(GAP_X - 4.5, hy + 0.85, H.z0 + 7.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)), new THREE.Vector3(1, 1, 1)), [0.04, 0.05, 0.06, M.GLASS]);
    // a potted lemon tree by his gap, an old crate
    K.cyl(GAP_X - 1.5, hy + 0.22, H.z0 + 1.0, 0.25, 0.19, 0.44, 10, [0.3, 0.12, 0.07, M.ALB]);
    for (let j = 0; j < 6; j++) K.sphere(GAP_X - 1.5 + (r() - 0.5) * 0.5, hy + 0.85 + r() * 0.5, H.z0 + 1.0 + (r() - 0.5) * 0.5, 0.2 + r() * 0.1, [0.03, 0.09, 0.035, M.ALB], 1, 1, 1, 0);
    K.box(GAP_X + 1.8, hy + 0.22, H.z0 + 1.3, 0.6, 0.44, 0.45, WOOD, 0.3);

    // ---- her roof: water tower (kit), laundry, lawn chair, pots, chimneys ----
    const sy = this.hers.h + 0.3, R = this.hers;
    K.box(R.x1 - 3.0, sy + 1.4, R.z0 + 4.0, 3.2, 2.8, 3.8, [R.wall[0] * 0.8, R.wall[1] * 0.8, R.wall[2] * 0.8, M.ALB]);
    K.box(R.x1 - 3.0, sy + 2.85, R.z0 + 4.0, 3.4, 0.12, 4.0, STONE);
    const la = new THREE.Vector3(GAP_X + 2.2, sy + 2.0, R.z1 - 3.0), lb = new THREE.Vector3(R.x1 - 2.2, sy + 2.0, R.z1 - 7.0);
    for (const p of [la, lb]) { K.cyl(p.x, sy + 1.05, p.z, 0.04, 0.04, 2.1, 6, [0.2, 0.2, 0.2, M.ALB]); K.box(p.x, sy + 2.05, p.z, 0.8, 0.04, 0.04, [0.2, 0.2, 0.2, M.ALB], Math.atan2(lb.x - la.x, lb.z - la.z)); }
    this.laundry.push({ a: la, b: lb, sag: 0.25, items: [{ u: 0.12, w: 0.6, h: 0.7, c: [0.5, 0.48, 0.45] }, { u: 0.27, w: 0.45, h: 0.55, c: [0.3, 0.08, 0.06] }, { u: 0.46, w: 1.3, h: 1.1, c: [0.55, 0.55, 0.58] }, { u: 0.66, w: 0.4, h: 0.8, c: [0.08, 0.12, 0.25] }, { u: 0.82, w: 0.55, h: 0.6, c: [0.45, 0.35, 0.15] }] });
    K.box(GAP_X - 3.5, sy + 0.37, R.z1 - 5.0, 0.6, 0.05, 1.0, [0.1, 0.25, 0.22, M.ALB], 0.3);
    K.box(GAP_X - 3.6, sy + 0.7, R.z1 - 5.5, 0.6, 0.65, 0.05, [0.1, 0.25, 0.22, M.ALB], 0.3, -0.35);
    for (const [dx, dz] of [[-0.25, -0.45], [0.25, -0.45], [-0.25, 0.45], [0.25, 0.45]]) K.box(GAP_X - 3.5 + dx!, sy + 0.18, R.z1 - 5.0 + dz!, 0.03, 0.36, 0.03, [0.4, 0.4, 0.42, M.ALB]);
    for (const [px, pz] of [[GAP_X - 1.4, R.z1 - 0.9], [GAP_X + 1.5, R.z1 - 0.8], [GAP_X + 2.1, R.z1 - 1.0]] as [number, number][]) {
      K.cyl(px, sy + 0.2, pz, 0.22, 0.17, 0.4, 10, [0.3, 0.12, 0.07, M.ALB]);
      for (let j = 0; j < 4; j++) K.sphere(px + (r() - 0.5) * 0.25, sy + 0.55 + r() * 0.25, pz + (r() - 0.5) * 0.25, 0.18 + r() * 0.1, [0.03, 0.09, 0.035, M.ALB], 1, 1, 1, 0);
    }
    const chim = (x: number, y: number, z: number, h: number, wall: [number, number, number], steam: boolean) => {
      K.box(x, y + h / 2, z, 0.9, h, 0.7, [wall[0] * 0.85, wall[1] * 0.85, wall[2] * 0.85, M.ALB]);
      K.box(x, y + h + 0.06, z, 1.04, 0.12, 0.84, STONE);
      if (steam) this.steamFrom.push(new THREE.Vector3(x, y + h + 0.2, z));
    };
    chim(R.x0 + 1.2, sy, R.z0 + 7, 1.8, R.wall, true);
    chim(H.x0 + 1.0, hy, H.z1 - 1.0, 1.6, H.wall, false);
    chim(R.x0 + 1.2, sy, R.z0 + 9, 1.5, R.wall, false);
    // pigeons along her parapet, right of the gap
    const pz = R.z1 - 0.15;
    for (let k = 0; k < 5; k++) this.perches.push({ p: new THREE.Vector3(GAP_X + 2.0 + k * 0.45 + (k % 2) * 0.12, sy + 0.79, pz), yaw: k % 2 ? 0.5 : -0.7 });
    for (let k = 0; k < 3; k++) this.perches.push({ p: new THREE.Vector3(H.x0 + 3 + k * 0.5, hy + 0.79, H.z0 + 0.15), yaw: k % 2 ? 2.6 : -2.9 });

    this.add(kitBatch(K.geometry(), [{ x: 0, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.5 }], kit, new THREE.Vector3(0, 0, 0), 60));
    // water tower on her roof (the city's kit), an antenna on his bulkhead, AC boxes
    const wt = waterTowerGeometry();
    this.add(kitBatch(wt, [{ x: R.x0 + 4.0, y: sy - 0.3, z: R.z0 + 4.5, yaw: 0.4, sx: 1.9, sy: 1.0, sz: 1.9, col: [1, 1, 1], k: 0 }], kit, new THREE.Vector3(R.x0 + 4, 0, R.z0 + 4.5), 8));
    this.add(kitBatch(antennaGeometry(), [{ x: bulkX - 0.6, y: hy + 3.1, z: bulkZ + 0.8, yaw: 0, sx: 0.12, sy: 6.6, sz: 0.12, col: [1, 1, 1], k: 0 }], kit, new THREE.Vector3(bulkX, 0, bulkZ), 2));
    this.add(kitBatch(roofBoxGeometry(), [
      { x: H.x0 + 6, y: hy, z: H.z1 - 2.5, yaw: 0, sx: 1.3, sy: 1.0, sz: 0.9, col: [0.4, 0.4, 0.38], k: 0 },
      { x: H.x0 + 7.6, y: hy, z: H.z1 - 2.5, yaw: 0, sx: 1.3, sy: 1.0, sz: 0.9, col: [0.4, 0.4, 0.38], k: 0 },
      { x: R.x0 + 8, y: sy, z: R.z0 + 2.0, yaw: 0, sx: 1.2, sy: 0.9, sz: 0.9, col: [0.38, 0.38, 0.37], k: 0 },
    ], kit, new THREE.Vector3(0, 0, 0), 30));
    this.buildLaundry();
    this.catSpot.set(0, 0, 0);
    void kit2;
  }

  /** Bay centres (world x) of a hero building's street face, as the city's facade lays them out. */
  bayCentres(b: Hero) {
    const fw = b.x1 - b.x0, pier = 0.55, avail = Math.max(fw - 2 * pier, 0.5);
    const nb = Math.max(1, Math.floor(avail / b.bayW + 0.5)), bw = avail / nb;
    const out: number[] = [];
    // (a street face toward +z runs left to right in +x; toward -z the tangent flips, the centres are the same)
    for (let k = 0; k < nb; k++) out.push(b.x0 + pier + (k + 0.5) * bw);
    return out;
  }

  /** Laundry: cloth quads on the kit material, swaying (instance yaw/offset updated per frame). */
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
