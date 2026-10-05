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
import { Kit, acUnit, bike, crate, deckChair, grill, lemonTree, planter, plant, pot, tomatoes, wateringCan, wire } from './rooftop-props';

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
/** (modes added to the city's kit material here: brick in running bond, weathered stone; see brickify) */
const BRICK = 20, STONEM = 21;
const STONE = [0.36, 0.34, 0.31, STONEM];

/**
 * The kit material with brick and stone: parapets, bulkheads and chimneys up close are laid in running bond (each
 * brick its own shade, mortar joints, fading to the average far away), copings weathered. A guarded patch of the
 * city's shader text — if the shader changes shape, the surfaces simply stay plain.
 */
export function brickify(mat: THREE.ShaderMaterial) {
  const at = 'vec3 c = alb * vLight;';
  if (!mat.fragmentShader.includes(at)) return mat;
  mat.fragmentShader = mat.fragmentShader.replace(at, /* glsl */ `
    if (mode > 19.5 && mode < 21.5) {
      vec3 Nb = normalize(vN), base = vV.rgb;
      if (mode < 20.5 && abs(Nb.y) < 0.5) {
        float bu = abs(Nb.x) > 0.5 ? vW.z : vW.x;
        vec2 bq = vec2(bu / 0.225, vW.y / 0.0755);
        float brow = floor(bq.y), sh = 0.5 * mod(brow, 2.0);
        float bx = floor(bq.x + sh);
        vec2 bf = vec2(fract(bq.x + sh), fract(bq.y));
        float bpx = max(fwidth(bq.x), fwidth(bq.y)), near = 1.0 - smoothstep(0.3, 0.8, bpx);
        float mort = (1.0 - step(0.05, bf.x) * step(bf.x, 0.95) * step(0.13, bf.y) * step(bf.y, 0.87)) * near;
        alb = base * (0.72 + 0.56 * h12(vec2(bx, brow)) * near) * (0.82 + 0.36 * vnoise(vec2(bu, vW.y) * 0.45));
        alb = mix(alb, vec3(0.3, 0.29, 0.27), mort * 0.65);
        // soot and rain streaks down from the coping
        alb *= 0.85 + 0.15 * vnoise(vec2(bu * 1.7, vW.y * 0.08));
      } else {
        alb = base * (0.78 + 0.4 * vnoise(vW.xz * 4.0 + vW.y * 2.0)) * (0.88 + 0.24 * vnoise(vW.xz * 0.8 + 3.0));
      }
    }
    ${at}`);
  return mat;
}

/** The kit material with leaves that move in the wind (a small flutter, each leaf on its own phase). */
export function leafify(mat: THREE.ShaderMaterial) {
  const at = 'vec3 lp = position * isc;';
  if (!mat.vertexShader.includes(at)) return mat;
  mat.vertexShader = mat.vertexShader.replace(at, /* glsl */ `
    float lwA = sin(uTime * 2.3 + position.x * 4.1 + position.z * 3.3) + 0.6 * sin(uTime * 5.1 + position.y * 7.0 + position.x * 2.0);
    float lwB = cos(uTime * 1.9 + position.z * 4.7 - position.x * 1.3);
    vec3 lp = (position + vec3(0.016 * lwA + 0.012, 0.008 * lwB, 0.014 * lwB) * smoothstep(0.0, 0.2, fract(position.y * 1.37) + 0.2)) * isc;`);
  return mat;
}
const WOOD = [0.2, 0.13, 0.08, M.ALB];

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
  /** candle flames on window sills (lit in the blackout) */
  candles: THREE.Vector3[] = [];
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
      if (h.xr - GAP_X - HW > 2.5) out.push(south ? mk('prewar', 6, GAP_X + HW, h.xr, z0 - 0.3, z1, [0.45, 0.42, 0.36], 263, front) : mk('walkup', 4, GAP_X + HW, h.xr, z0, z1 + 0.4, [0.24, 0.16, 0.12], 277, front));
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
    const kitB = brickify(kitMaterial(U)), kitL = leafify(kitMaterial(U, { side: THREE.DoubleSide, streetK: 1.2 }));
    const K = new KitBuilder(), Lf = new KitBuilder();
    const r = mulberry32(17);

    // ---- parapets with the gap and the fire escape's gooseneck rails, on both hero roofs ----
    for (const b of [this.his, this.hers]) {
      const y = RoofSet.roofTop(b), ph = 0.62, t = 0.3;
      const fz = b.front < 0 ? b.z0 : b.z1, bz = b.front < 0 ? b.z1 : b.z0;
      const brick = [b.wall[0] * 0.75, b.wall[1] * 0.75, b.wall[2] * 0.75, BRICK];
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
    K.box(bx, hy + 1.5, bz, 3.4, 3.0, 4.0, [H.wall[0] * 0.85, H.wall[1] * 0.85, H.wall[2] * 0.85, BRICK]);
    K.box(bx, hy + 3.05, bz, 3.6, 0.12, 4.2, STONE);
    K.box(bx + 0.5, hy + 1.05, bz - 2.02, 0.95, 2.1, 0.06, [0.04, 0.07, 0.05, M.ALB]);
    K.sphere(bx + 0.5, hy + 2.35, bz - 2.1, 0.07, [1, 0.75, 0.45, M.LAMP]);
    this.redLights.push(new THREE.Vector3(bx - 0.6, hy + 3.1 + 6.6, bz + 0.8));
    // the garden behind him: wooden planters along the east parapet (herbs, geraniums, a fern), tomatoes on stakes,
    // a watering can
    const gx = H.x1 - 1.0;
    const flowers: (number[] | null)[] = [[0.5, 0.05, 0.06, M.ALB], null, [0.55, 0.45, 0.4, M.ALB], [0.45, 0.12, 0.3, M.ALB]];
    for (let k = 0; k < 4; k++) {
      const z = H.z0 + 5.0 + k * 2.0;
      const soil = planter(K, r, gx, hy, z, 1.1, 1.7, 0.5);
      if (k === 3) { tomatoes(K, Lf, r, gx, soil, z, 3, 1.0); continue; }
      for (let j = 0; j < 3; j++) plant(K, Lf, r, gx + (r() - 0.5) * 0.35, soil, z - 0.55 + j * 0.55, { h: 0.35 + r() * 0.3, w: 0.3, flower: flowers[(k + j) % 4] ?? null });
    }
    wateringCan(K, gx - 1.0, hy, H.z0 + 4.2, 0.6);
    // string lights between four posts around the table
    const tx = GAP_X + 2.4, tz = H.z0 + 8.5;
    const posts = [new THREE.Vector3(H.x1 - 0.4, hy, H.z0 + 3.0), new THREE.Vector3(H.x1 - 0.4, hy, H.z0 + 13.0), new THREE.Vector3(GAP_X + 0.4, hy, H.z0 + 13.0), new THREE.Vector3(GAP_X + 0.4, hy, H.z0 + 5.0)];
    for (const p of posts) K.cyl(p.x, hy + 1.2, p.z, 0.035, 0.04, 2.4, 6, [0.15, 0.12, 0.1, M.ALB]);
    for (let k = 0; k < posts.length; k++) {
      const a = posts[k]!.clone().setY(hy + 2.35), b = posts[(k + 1) % posts.length]!.clone().setY(hy + 2.35);
      const nb = Math.round(a.distanceTo(b) / 0.55);
      const seg = [a.clone().add(new THREE.Vector3(0, -0.06, 0))];
      for (let j = 1; j < nb; j++) { const u = j / nb, q = a.clone().lerp(b, u); q.y -= Math.sin(u * Math.PI) * 0.35; this.bulbs.push(q.add(new THREE.Vector3(0, -0.06, 0))); seg.push(q.clone()); }
      seg.push(b.clone().add(new THREE.Vector3(0, -0.06, 0)));
      wire(K, seg);
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
    K.box(H.x0 + 2.4, hy + 0.25, H.z0 + 9.0, 2.4, 0.5, 2.4, [0.27, 0.26, 0.24, STONEM]);
    K.add(new THREE.ConeGeometry(1.62, 0.6, 4, 1), new THREE.Matrix4().compose(new THREE.Vector3(H.x0 + 2.4, hy + 0.8, H.z0 + 9.0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)), new THREE.Vector3(1, 1, 1)), [0.1, 0.12, 0.13, M.GLASS]);
    {
      // its frame: ridges, a curb, glazing bars down each face (it reads as a skylight, not a dark slab)
      const sk = new Kit(K).at(H.x0 + 2.4, hy, H.z0 + 9.0), e = 1.15, ap = [0, 1.1, 0], fr: [number, number, number, number] = [0.22, 0.24, 0.22, M.ALB];
      const cs = [[-e, 0.5, -e], [e, 0.5, -e], [e, 0.5, e], [-e, 0.5, e]];
      cs.forEach((c, i) => { sk.bar(c, ap, 0.025, fr, 4); sk.bar(c, cs[(i + 1) % 4]!, 0.035, fr, 4); });
      cs.forEach((c, i) => {
        const d = cs[(i + 1) % 4]!;
        for (const f of [0.33, 0.67]) sk.bar([c[0]! + (d[0]! - c[0]!) * f, 0.5, c[2]! + (d[2]! - c[2]!) * f], ap, 0.015, fr, 3);
      });
    }
    // a lemon tree in a pot by his gap, a crate of empty bottles, a kettle grill, his bike against the bulkhead, a
    // deck chair folded against its door wall, a coiled hose, vent pipes
    lemonTree(K, Lf, r, GAP_X - 1.5, hy, H.z0 + 1.0);
    crate(K, r, GAP_X + 1.75, hy, H.z0 + 1.3, 0.3, 5);
    grill(K, tx + 1.7, hy, tz + 2.3, 0.5);
    bike(K, bx + 1.7 + 0.2, hy, bz + 0.4, Math.PI / 2, 0.12, false);
    deckChair(K, bx - 1.0, hy, bz - 2.0 - 0.46, 0, true);
    K.add(new THREE.TorusGeometry(0.3, 0.03, 5, 16), new THREE.Matrix4().compose(new THREE.Vector3(H.x0 + 1.2, hy + 0.05, H.z0 + 6.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)), [0.08, 0.2, 0.08, M.ALB]);
    for (const [px, pz, ph] of [[H.x0 + 4.5, H.z1 - 1.5, 1.4], [H.x0 + 5.0, H.z1 - 1.2, 0.9], [GAP_X + 3.0, H.z1 - 1.0, 1.1]] as [number, number, number][]) {
      K.cyl(px, hy + ph / 2, pz, 0.08, 0.08, ph, 8, [0.22, 0.22, 0.22, M.ALB]);
      K.cyl(px, hy + ph + 0.08, pz, 0.14, 0.1, 0.12, 8, [0.22, 0.22, 0.22, M.ALB]);
    }

    // a small deck of planks by the parapet (where he sits out on summer nights; at dawn they dance on it)
    K.box(GAP_X + 2.4, hy + 0.035, H.z0 + 2.45, 3.6, 0.07, 3.1, [0.34, 0.23, 0.14, M.PLANKS]);
    for (const dz of [-1.53, 1.53]) K.box(GAP_X + 2.4, hy + 0.04, H.z0 + 2.45 + dz, 3.64, 0.08, 0.06, [0.24, 0.16, 0.1, M.WOOD]);
    // his washing: a line from the bulkhead side to the garden (shirts, a towel, a sheet; at dawn they catch the sun)
    const ha = new THREE.Vector3(H.x0 + 4.2, hy + 2.0, H.z1 - 5.4), hb = new THREE.Vector3(GAP_X - 0.6, hy + 2.0, H.z0 + 4.3);
    for (const p of [ha, hb]) { K.cyl(p.x, hy + 1.05, p.z, 0.04, 0.04, 2.1, 6, [0.2, 0.2, 0.2, M.ALB]); K.box(p.x, hy + 2.05, p.z, 0.7, 0.04, 0.04, [0.2, 0.2, 0.2, M.ALB], Math.atan2(hb.x - ha.x, hb.z - ha.z) + Math.PI / 2); }
    this.laundry.push({ a: ha, b: hb, sag: 0.22, items: [{ u: 0.14, w: 0.5, h: 0.65, c: [0.33, 0.31, 0.27] }, { u: 0.32, w: 1.1, h: 1.0, c: [0.36, 0.36, 0.37] }, { u: 0.55, w: 0.45, h: 0.6, c: [0.07, 0.11, 0.22] }, { u: 0.72, w: 0.55, h: 0.75, c: [0.3, 0.09, 0.06] }, { u: 0.88, w: 0.35, h: 0.45, c: [0.27, 0.25, 0.12] }] });

    // ---- her roof ----
    const R = this.hers, sy = RoofSet.roofTop(R);
    K.box(R.x1 - 2.2, sy + 1.4, R.z0 + 3.0, 3.2, 2.8, 3.8, [R.wall[0] * 0.8, R.wall[1] * 0.8, R.wall[2] * 0.8, BRICK]);
    K.box(R.x1 - 2.2, sy + 2.85, R.z0 + 3.0, 3.4, 0.12, 4.0, STONE);
    K.box(R.x1 - 2.7, sy + 1.05, R.z0 + 4.92, 0.95, 2.1, 0.06, [0.15, 0.06, 0.04, M.ALB]);
    const la = new THREE.Vector3(GAP_X + 1.9, sy + 2.0, R.z1 - 3.2), lb = new THREE.Vector3(R.x1 - 1.0, sy + 2.0, R.z1 - 8.5);
    for (const p of [la, lb]) { K.cyl(p.x, sy + 1.05, p.z, 0.04, 0.04, 2.1, 6, [0.2, 0.2, 0.2, M.ALB]); K.box(p.x, sy + 2.05, p.z, 0.8, 0.04, 0.04, [0.2, 0.2, 0.2, M.ALB], Math.atan2(lb.x - la.x, lb.z - la.z) + Math.PI / 2); }
    this.laundry.push({ a: la, b: lb, sag: 0.25, items: [{ u: 0.12, w: 0.55, h: 0.7, c: [0.5, 0.48, 0.45] }, { u: 0.27, w: 0.42, h: 0.5, c: [0.3, 0.08, 0.06] }, { u: 0.47, w: 1.2, h: 1.1, c: [0.55, 0.55, 0.58] }, { u: 0.67, w: 0.4, h: 0.75, c: [0.08, 0.12, 0.25] }, { u: 0.83, w: 0.5, h: 0.6, c: [0.45, 0.35, 0.15] }] });
    // a lawn chair facing the skyline, pots by the gap, a bench of bricks with a radio, chimneys
    const cx = GAP_X - 3.4, cz = R.z1 - 6.0;
    deckChair(K, cx, sy, cz, Math.PI + 0.3, false);
    const fl2: number[][] = [[0.5, 0.05, 0.06, M.ALB], [0.55, 0.3, 0.45, M.ALB], [0.55, 0.5, 0.1, M.ALB]];
    [[GAP_X - 1.4, R.z1 - 0.9, 0.22], [GAP_X + 1.5, R.z1 - 0.8, 0.18], [GAP_X + 2.1, R.z1 - 1.0, 0.24], [R.x0 + 1.0, R.z1 - 1.0, 0.2], [cx - 0.9, cz + 0.2, 0.17]].forEach(([px, pz, pr], i) => {
      const soil = pot(K, r, px!, sy, pz!, pr!, pr! * 1.7);
      plant(K, Lf, r, px!, soil, pz!, { h: 0.3 + r() * 0.25, w: pr! * 1.6, flower: i === 3 ? null : fl2[i % 3]!, droop: i === 3 ? 0.9 : 0.3 });
    });
    crate(K, r, cx + 1.3, sy, cz + 0.9, -0.4, 3);
    K.box(cx + 1.2, sy + 0.2, cz - 0.6, 0.9, 0.4, 0.45, [0.3, 0.12, 0.08, M.ALB]);
    K.box(cx + 1.2, sy + 0.5, cz - 0.6, 0.32, 0.2, 0.12, [0.1, 0.1, 0.11, M.ALB]);
    const chim = (x: number, y: number, z: number, h: number, wall: [number, number, number], steam: boolean) => {
      K.box(x, y + h / 2, z, 0.9, h, 0.7, [wall[0] * 0.85, wall[1] * 0.85, wall[2] * 0.85, BRICK]);
      K.box(x, y + h + 0.06, z, 1.04, 0.12, 0.84, STONE);
      if (steam) this.steamFrom.push(new THREE.Vector3(x, y + h + 0.2, z));
    };
    chim(R.x0 + 0.9, sy, R.z0 + 9, 1.8, R.wall, true);
    chim(R.x0 + 0.9, sy, R.z0 + 11, 1.5, R.wall, false);
    chim(H.x0 + 0.9, hy, H.z1 - 7.0, 1.6, H.wall, false);
    // pigeons along her parapet, right of the gap; a few on his
    for (let k = 0; k < 5; k++) this.perches.push({ p: new THREE.Vector3(GAP_X + 1.8 + k * 0.42 + (k % 2) * 0.1, sy + 0.71, R.z1 - 0.15), yaw: k % 2 ? 0.5 : -0.7 });
    for (let k = 0; k < 3; k++) this.perches.push({ p: new THREE.Vector3(H.x0 + 2.5 + k * 0.5, hy + 0.71, H.z0 + 0.15), yaw: k % 2 ? 2.6 : -2.9 });

    acUnit(K, GAP_X + 2.0, hy, H.z1 - 2.2, 0);
    acUnit(K, GAP_X + 3.4, hy, H.z1 - 2.2, 0.05);
    acUnit(K, GAP_X + 1.0, sy, R.z0 + 2.0, Math.PI, 1.0, 0.8, 0.85);
    // ---- more life on the neighbours' roofs: masts with red lights, a dish, a laundry line, steam from a vent ----
    const ants: KInst[] = [{ x: bx - 0.6, y: hy + 3.1, z: bz + 0.8, yaw: 0, sx: 0.12, sy: 6.6, sz: 0.12, col: [1, 1, 1], k: 0 }];
    const nb = this.blds.filter((b) => b !== this.his && b !== this.hers);
    nb.forEach((b, i) => {
      const y = RoofSet.roofTop(b), cxb = (b.x0 + b.x1) / 2, czb = (b.z0 + b.z1) / 2;
      if (i % 2 === 0) { const hgt = 4.5 + 2 * r(); ants.push({ x: cxb + 1.5, y, z: czb + 2, yaw: 0, sx: 0.1, sy: hgt, sz: 0.1, col: [1, 1, 1], k: 0 }); this.redLights.push(new THREE.Vector3(cxb + 1.5, y + hgt + 0.05, czb + 2)); }
      if (i === 1) {
        const dp = new THREE.Vector3(b.x0 + 1.2, y + 1.1, czb), dn = new THREE.Vector3(0.6, 0.6, b.front * 0.5).normalize();
        K.cyl(dp.x, y + 0.55, dp.z, 0.035, 0.035, 1.1, 6, IRON);
        K.add(new THREE.SphereGeometry(0.42, 16, 6, 0, Math.PI * 2, 0, 0.6), new THREE.Matrix4().compose(dp.clone().addScaledVector(dn, 0.4), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dn), new THREE.Vector3(1, 1, 1)), [0.45, 0.45, 0.47, M.ALB]);
      }
      if (i === 2) {
        const a = new THREE.Vector3(b.x0 + 0.8, y + 1.9, czb - 3), c = new THREE.Vector3(b.x1 - 0.8, y + 1.9, czb + 2);
        for (const p of [a, c]) K.cyl(p.x, y + 0.95, p.z, 0.035, 0.035, 1.9, 6, [0.2, 0.2, 0.2, M.ALB]);
        this.laundry.push({ a, b: c, sag: 0.2, items: [{ u: 0.18, w: 0.5, h: 0.6, c: [0.5, 0.5, 0.52] }, { u: 0.4, w: 0.9, h: 0.9, c: [0.42, 0.12, 0.1] }, { u: 0.64, w: 0.45, h: 0.55, c: [0.15, 0.25, 0.45] }, { u: 0.84, w: 0.6, h: 0.7, c: [0.55, 0.5, 0.35] }] });
      }
      if (i === 3) { K.cyl(cxb - 2, y + 0.6, czb, 0.12, 0.12, 1.2, 8, [0.22, 0.22, 0.22, M.ALB]); this.steamFrom.push(new THREE.Vector3(cxb - 2, y + 1.3, czb)); }
    });
    // a steaming vent pipe on his roof
    this.steamFrom.push(new THREE.Vector3(H.x0 + 4.5, hy + 1.6, H.z1 - 1.5));
    // candles on a few window sills: in the blackout the neighbours have lit them
    const wins = [this.his, this.hers, ...nb].flatMap((b) => RoofSet.windows(b).filter((a) => a.floor >= 2));
    for (let k = 0; k < 9 && wins.length; k++) {
      const a = wins[Math.floor(r() * wins.length)]!;
      const p = a.pos.clone().addScaledVector(a.facing, 0.1).add(new THREE.Vector3((r() - 0.5) * a.size[0] * 0.6, 0.02, 0));
      K.cyl(p.x, p.y + 0.05, p.z, 0.025, 0.025, 0.1, 8, [0.6, 0.57, 0.5, M.ALB]);
      this.candles.push(p.clone().add(new THREE.Vector3(0, 0.13, 0)));
    }
    this.add(kitBatch(K.geometry(), [{ x: 0, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.5 }], kitB, new THREE.Vector3(0, 0, 0), 60));
    // the leaves, two-sided, moving in the wind
    this.add(kitBatch(Lf.geometry(), [{ x: 0, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.5 }], kitL, new THREE.Vector3(0, 0, 0), 60));
    void kit2;
    // her water tower (the city's kit), his mast, AC boxes and vents on all the roofs we built
    const wt: KInst[] = [{ x: R.x0 + 2.8, y: sy - 0.3, z: R.z0 + 3.6, yaw: 0.4, sx: 1.8, sy: 1.0, sz: 1.8, col: [1, 1, 1], k: 0 }];
    const boxes: KInst[] = [];
    for (const b of this.blds) {
      if (b === this.his || b === this.hers) continue;
      const y = RoofSet.roofTop(b), cxb = (b.x0 + b.x1) / 2, czb = (b.z0 + b.z1) / 2;
      if (b.style === 'prewar' || b.floors >= 5) wt.push({ x: cxb + (r() - 0.5) * 3, y: y - 0.3, z: czb + (r() - 0.5) * 6, yaw: r() * 6, sx: 1.6 + r() * 0.5, sy: 0.9 + r() * 0.2, sz: 1.6, col: [1, 1, 1], k: 0 });
      for (let k = 0; k < 3; k++) boxes.push({ x: b.x0 + 2 + r() * (b.x1 - b.x0 - 4), y, z: Math.min(b.z0, b.z1) + 3 + r() * (Math.abs(b.z1 - b.z0) - 6), yaw: 0, sx: 0.8 + r() * 0.8, sy: 0.6 + r() * 0.8, sz: 0.8 + r() * 0.6, col: [0.3 + r() * 0.15, 0.3 + r() * 0.15, 0.3 + r() * 0.15], k: 0 });
    }
    this.add(kitBatch(waterTowerGeometry(), wt, kit, new THREE.Vector3(0, 0, 0), 30));
    this.add(kitBatch(antennaGeometry(), ants, kit, new THREE.Vector3(0, 0, 0), 30));
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
    // (pleated: a few soft vertical folds, so the cloth shades like cloth instead of a flat card)
    const pg = new THREE.PlaneGeometry(1, 1, 6, 2);
    const pp = pg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i);
      pp.setXYZ(i, x, y - 0.5 + (y < 0 ? 0.03 * Math.sin(x * 9.0) : 0), 0.035 * Math.sin((x + 0.5) * 6 * Math.PI / 2) * (0.6 + 0.4 * (0.5 - y)));
    }
    pg.computeVertexNormals();
    const g = new KitBuilder().add(pg, new THREE.Matrix4(), [1, 1, 1, M.TINT]).geometry();
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
