// The small things on the two roofs, modelled properly (they hold up in daylight, at dawn): leafy plants made of
// many leaf cards on stems, weathered terracotta pots and wooden planters with soil, tomatoes on stakes, a lemon
// tree, a folding deck chair (open, or folded against a wall), a crate of bottles, a kettle grill, a bike, AC
// condensers with fans, a watering can, the wire of the string lights. Built into KitBuilders (lib/city-build.ts:
// lit like the city — moon, people's glow, power, dawn): `K` for solid parts, `Lf` for leaves (drawn two-sided).
import * as THREE from 'three';
import { KitBuilder, M } from '../lib/city-build';

type C = number[];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const IRON: C = [0.045, 0.045, 0.05, M.ALB];
const SOIL: C = [0.05, 0.035, 0.022, M.ALB];

/** A kit builder with a parent transform (props are built in their own frame, then placed). */
export class Kit {
  m = new THREE.Matrix4();
  constructor(public K: KitBuilder) {}
  at(x: number, y: number, z: number, yaw = 0, tilt = 0) {
    this.m.compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, yaw, 0, 'YXZ')), V(1, 1, 1));
    return this;
  }
  private put(g: THREE.BufferGeometry, l: THREE.Matrix4, v: C) { this.K.add(g, this.m.clone().multiply(l), v); return this; }
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, v: C, ry = 0, rx = 0, rz = 0) {
    return this.put(new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4().compose(V(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(sx, sy, sz)), v);
  }
  cyl(cx: number, cy: number, cz: number, rt: number, rb: number, h: number, seg: number, v: C, rx = 0, rz = 0, open = false) {
    return this.put(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), new THREE.Matrix4().compose(V(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), V(1, 1, 1)), v);
  }
  geo(g: THREE.BufferGeometry, x: number, y: number, z: number, v: C, rx = 0, ry = 0, rz = 0, s = 1) {
    return this.put(g, new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), V(s, s, s)), v);
  }
  /** A round bar between two local points. */
  bar(a: number[], b: number[], r: number, v: C, seg = 5) {
    const A = V(a[0]!, a[1]!, a[2]!), B = V(b[0]!, b[1]!, b[2]!), d = B.clone().sub(A), L = d.length();
    if (L < 1e-5) return this;
    return this.put(new THREE.CylinderGeometry(r, r, L, seg, 1), new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1)), v);
  }
  /** A local point in world space. */
  world(x: number, y: number, z: number) { return V(x, y, z).applyMatrix4(this.m); }
}

/** A leaf card (a diamond, slightly folded) from `p` along `dir`, `len` long; into `Lf`. */
function leaf(Lf: KitBuilder, p: THREE.Vector3, dir: THREE.Vector3, len: number, wid: number, col: C, r: () => number) {
  const d = dir.clone().normalize();
  let side = V(0, 1, 0).cross(d);
  if (side.lengthSq() < 1e-4) side = V(1, 0, 0);
  side.normalize().applyAxisAngle(d, (r() - 0.5) * 1.6);
  const up = d.clone().cross(side).normalize();
  const tip = p.clone().addScaledVector(d, len);
  const mid = p.clone().addScaledVector(d, len * 0.45).addScaledVector(up, len * 0.08);
  const a = mid.clone().addScaledVector(side, wid / 2), b = mid.clone().addScaledVector(side, -wid / 2);
  // two halves meeting at the midrib (a slight V)
  Lf.poly4([p.x, p.y, p.z], [a.x, a.y, a.z], [tip.x, tip.y, tip.z], [mid.x, mid.y + 0.002, mid.z], col);
  Lf.poly4([p.x, p.y, p.z], [mid.x, mid.y + 0.002, mid.z], [tip.x, tip.y, tip.z], [b.x, b.y, b.z], col);
}

const green = (r: () => number, dark = 0) => [0.03 + r() * 0.035 - dark * 0.01, 0.075 + r() * 0.07 - dark * 0.02, 0.02 + r() * 0.03, M.ALB];

/** A leafy plant (herbs, geraniums, a fern) growing from (x, y, z): stems to a crown of leaf cards, maybe flowers. */
export function plant(K: KitBuilder, Lf: KitBuilder, r: () => number, x: number, y: number, z: number, o: { h?: number; w?: number; stems?: number; leaves?: number; flower?: C | null; droop?: number } = {}) {
  const h = o.h ?? 0.5, w = o.w ?? 0.35, ns = o.stems ?? 9, nl = o.leaves ?? 16, droop = o.droop ?? 0.3;
  const base = V(x, y, z), k = new Kit(K).at(0, 0, 0);
  for (let s = 0; s < ns; s++) {
    const a = r() * Math.PI * 2, lean = 0.25 + r() * 0.7;
    const end = base.clone().add(V(Math.cos(a) * w * lean, h * (0.55 + 0.45 * r()), Math.sin(a) * w * lean));
    const midP = base.clone().lerp(end, 0.5).add(V(0, h * 0.08, 0));
    k.bar([base.x, base.y, base.z], [midP.x, midP.y, midP.z], 0.006, [0.05, 0.08, 0.03, M.ALB], 3);
    k.bar([midP.x, midP.y, midP.z], [end.x, end.y, end.z], 0.005, [0.05, 0.08, 0.03, M.ALB], 3);
    const out = V(Math.cos(a), 0, Math.sin(a));
    for (let j = 0; j < nl; j++) {
      const u = 0.35 + 0.65 * (j / nl);
      const p = u < 0.5 ? base.clone().lerp(midP, u * 2) : midP.clone().lerp(end, (u - 0.5) * 2);
      const dir = out.clone().applyAxisAngle(V(0, 1, 0), (r() - 0.5) * 2.4).add(V(0, 0.6 - droop * (1 - u) + (r() - 0.5) * 0.6, 0));
      leaf(Lf, p, dir, 0.08 + 0.1 * r() * (1.2 - u * 0.4), 0.05 + 0.04 * r(), green(r), r);
    }
    if (o.flower && r() < 0.6) for (let f = 0; f < 5; f++) K.sphere(end.x + (r() - 0.5) * 0.06, end.y + 0.02 + r() * 0.04, end.z + (r() - 0.5) * 0.06, 0.018, o.flower, 1, 0.7, 1, 0);
  }
}

/** A weathered terracotta pot with a rolled rim and soil; returns the soil level. */
export function pot(K: KitBuilder, r: () => number, x: number, y: number, z: number, rad = 0.2, h = 0.36) {
  const tc = 0.85 + 0.3 * r();
  const clay: C = [0.36 * tc, 0.14 * tc, 0.075 * tc, M.ALB], bloom: C = [0.42, 0.3, 0.24, M.ALB];
  const prof = [new THREE.Vector2(rad * 0.62, 0), new THREE.Vector2(rad * 0.95, h * 0.82), new THREE.Vector2(rad, h * 0.82)];
  K.add(new THREE.LatheGeometry(prof, 16), new THREE.Matrix4().makeTranslation(x, y, z), clay);
  K.add(new THREE.LatheGeometry([new THREE.Vector2(rad * 0.99, h * 0.8), new THREE.Vector2(rad * 1.1, h * 0.82), new THREE.Vector2(rad * 1.1, h), new THREE.Vector2(rad * 0.96, h), new THREE.Vector2(rad * 0.94, h * 0.9)], 16), new THREE.Matrix4().makeTranslation(x, y, z), r() < 0.5 ? bloom : clay);
  K.cyl(x, y + h * 0.88, z, rad * 0.94, rad * 0.94, 0.02, 14, SOIL);
  K.cyl(x, y + 0.01, z, rad * 0.62, rad * 0.62, 0.02, 12, clay);
  return y + h * 0.89;
}

/** A wooden planter of weathered boards with soil; w along x, d along z; returns the soil level. */
export function planter(K: KitBuilder, r: () => number, x: number, y: number, z: number, w: number, d: number, h = 0.5) {
  const board = () => { const g = 0.7 + 0.5 * r(); return [0.2 * g, 0.15 * g, 0.1 * g, M.ALB]; };
  const nb = 3, bh = h / nb;
  for (let i = 0; i < nb; i++) {
    const yy = y + bh * (i + 0.5);
    K.box(x, yy, z - d / 2, w, bh - 0.012, 0.03, board());
    K.box(x, yy, z + d / 2, w, bh - 0.012, 0.03, board());
    K.box(x - w / 2, yy, z, 0.03, bh - 0.012, d, board());
    K.box(x + w / 2, yy, z, 0.03, bh - 0.012, d, board());
  }
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) K.box(x + (px! * (w / 2 - 0.03)), y + h / 2 + 0.02, z + (pz! * (d / 2 - 0.03)), 0.06, h + 0.04, 0.06, [0.17, 0.12, 0.08, M.ALB]);
  K.box(x, y + h - 0.06, z, w - 0.04, 0.02, d - 0.04, SOIL);
  return y + h - 0.05;
}

/** Tomatoes on stakes in a planter: canes, leaves, red and green fruit. */
export function tomatoes(K: KitBuilder, Lf: KitBuilder, r: () => number, x: number, y: number, z: number, n = 3, span = 1.2) {
  const k = new Kit(K).at(0, 0, 0);
  for (let i = 0; i < n; i++) {
    const px = x + (i - (n - 1) / 2) * (span / n), pz = z + (r() - 0.5) * 0.15;
    k.bar([px, y - 0.1, pz], [px, y + 1.3, pz], 0.009, [0.25, 0.2, 0.12, M.ALB], 4);
    for (let j = 0; j < 60; j++) {
      const u = j / 60, py = y + 0.1 + u * 1.1;
      const p = V(px + (r() - 0.5) * 0.18, py, pz + (r() - 0.5) * 0.18);
      leaf(Lf, p, V(r() - 0.5, 0.2 - r() * 0.5, r() - 0.5), 0.09 + 0.07 * r(), 0.07, green(r, 1), r);
    }
    for (let j = 0; j < 6; j++) {
      const ripe = r() < 0.55;
      K.sphere(px + (r() - 0.5) * 0.16, y + 0.3 + r() * 0.7, pz + (r() - 0.5) * 0.16, 0.025 + r() * 0.012, ripe ? [0.45, 0.04, 0.02, M.ALB] : [0.12, 0.2, 0.04, M.ALB], 1, 0.9, 1, 1);
    }
  }
}

/** A potted lemon tree: a trunk, branches, a dense crown of leaves, a few lemons. */
export function lemonTree(K: KitBuilder, Lf: KitBuilder, r: () => number, x: number, y: number, z: number) {
  const soil = pot(K, r, x, y, z, 0.26, 0.46);
  const k = new Kit(K).at(0, 0, 0);
  const top = V(x + 0.03, soil + 0.6, z);
  k.bar([x, soil, z], [top.x, top.y, top.z], 0.025, [0.16, 0.12, 0.08, M.ALB], 6);
  for (let b = 0; b < 6; b++) {
    const a = b * 1.05 + r() * 0.5, end = top.clone().add(V(Math.cos(a) * 0.3, 0.15 + r() * 0.35, Math.sin(a) * 0.3));
    k.bar([top.x, top.y, top.z], [end.x, end.y, end.z], 0.012, [0.16, 0.12, 0.08, M.ALB], 4);
    for (let j = 0; j < 34; j++) {
      const c = end.clone().add(V((r() - 0.5) * 0.36, (r() - 0.5) * 0.3, (r() - 0.5) * 0.36));
      leaf(Lf, c, c.clone().sub(top).add(V(0, 0.2, 0)), 0.07 + 0.04 * r(), 0.035, green(r, 1), r);
    }
  }
  for (let j = 0; j < 5; j++) K.sphere(x + (r() - 0.5) * 0.6, top.y + 0.05 + r() * 0.35, z + (r() - 0.5) * 0.6, 0.04, [0.55, 0.45, 0.06, M.ALB], 1, 1.3, 1, 1);
}

/** A wooden folding deck chair with a striped canvas sling (open), or folded flat and leaning against a wall. */
export function deckChair(K: KitBuilder, x: number, y: number, z: number, yaw: number, folded = false) {
  const k = new Kit(K).at(x, y, z, yaw, folded ? -1.2 : 0);
  const wood: C = [0.32, 0.22, 0.13, M.ALB];
  const stripes: C[] = [[0.42, 0.08, 0.06, M.ALB], [0.55, 0.52, 0.45, M.ALB]];
  if (folded) {
    for (const sx of [-0.27, 0.27]) k.box(sx, 0, 0.55, 0.035, 0.025, 1.15, wood);
    for (const zz of [0.05, 1.05]) k.box(0, 0, zz, 0.58, 0.025, 0.035, wood);
    for (let i = 0; i < 6; i++) k.box(0, 0.015, 0.15 + i * 0.13, 0.5, 0.004, 0.13, stripes[i % 2]!);
    return;
  }
  // the long rails from the front feet up and back to the top, the rear legs, the cross bars; the sling sags
  for (const sx of [-0.28, 0.28]) {
    k.bar([sx, 0, 0.38], [sx, 0.95, -0.45], 0.018, wood, 5);
    k.bar([sx, 0, -0.62], [sx, 0.52, -0.08], 0.018, wood, 5);
    k.bar([sx, 0.42, 0.3], [sx, 0.5, -0.12], 0.015, wood, 5);
  }
  k.bar([-0.3, 0.95, -0.45], [0.3, 0.95, -0.45], 0.016, wood, 5);
  k.bar([-0.3, 0.42, 0.3], [0.3, 0.42, 0.3], 0.016, wood, 5);
  k.bar([-0.3, 0.02, -0.62], [0.3, 0.02, -0.62], 0.014, wood, 5);
  const top = [0.92, -0.42], low = [0.24, 0.02], front = [0.42, 0.3];
  for (let i = 0; i < 5; i++) {
    const x0 = -0.26 + (i / 5) * 0.52, x1 = -0.26 + ((i + 1) / 5) * 0.52;
    const pa = k.world(x0, top[0]!, top[1]!), pb = k.world(x1, top[0]!, top[1]!), pc = k.world(x1, low[0]!, low[1]!), pd = k.world(x0, low[0]!, low[1]!);
    K.poly4([pa.x, pa.y, pa.z], [pb.x, pb.y, pb.z], [pc.x, pc.y, pc.z], [pd.x, pd.y, pd.z], stripes[i % 2]!);
    const qa = k.world(x0, low[0]!, low[1]!), qb = k.world(x1, low[0]!, low[1]!), qc = k.world(x1, front[0]!, front[1]!), qd = k.world(x0, front[0]!, front[1]!);
    K.poly4([qa.x, qa.y, qa.z], [qb.x, qb.y, qb.z], [qc.x, qc.y, qc.z], [qd.x, qd.y, qd.z], stripes[i % 2]!);
  }
}

/** A slatted wooden crate, with a few bottles in it. */
export function crate(K: KitBuilder, r: () => number, x: number, y: number, z: number, yaw: number, bottles = 6) {
  const k = new Kit(K).at(x, y, z, yaw);
  const w = 0.5, d = 0.34, h = 0.3, wood: C = [0.3, 0.22, 0.13, M.ALB];
  k.box(0, 0.01, 0, w, 0.02, d, wood);
  for (const yy of [0.07, 0.21]) {
    k.box(0, yy, d / 2, w, 0.08, 0.015, wood).box(0, yy, -d / 2, w, 0.08, 0.015, wood);
    k.box(w / 2, yy, 0, 0.015, 0.08, d, wood).box(-w / 2, yy, 0, 0.015, 0.08, d, wood);
  }
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(px! * (w / 2 - 0.02), h / 2, pz! * (d / 2 - 0.02), 0.035, h, 0.035, [0.26, 0.18, 0.1, M.ALB]);
  for (let i = 0; i < bottles; i++) {
    const bx = -0.17 + (i % 3) * 0.17, bz = i < 3 ? -0.08 : 0.08;
    const glass: C = r() < 0.5 ? [0.02, 0.08, 0.03, M.GLASS] : [0.12, 0.06, 0.02, M.GLASS];
    k.cyl(bx, 0.13, bz, 0.035, 0.035, 0.24, 10, glass).cyl(bx, 0.28, bz, 0.013, 0.035, 0.07, 10, glass).cyl(bx, 0.35, bz, 0.013, 0.013, 0.07, 8, glass);
    k.cyl(bx, 0.39, bz, 0.015, 0.015, 0.012, 8, [0.4, 0.38, 0.3, M.ALB]);
  }
}

/** A kettle grill: bowl, lid, three legs, wheels, an ash pan. */
export function grill(K: KitBuilder, x: number, y: number, z: number, yaw: number) {
  const k = new Kit(K).at(x, y, z, yaw);
  const black: C = [0.03, 0.03, 0.032, M.ALB];
  k.geo(new THREE.SphereGeometry(0.28, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0, 0.72, 0, black);
  k.geo(new THREE.SphereGeometry(0.285, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.73, 0, black, 0.08);
  k.cyl(0, 1.03, 0.02, 0.035, 0.035, 0.03, 8, [0.15, 0.12, 0.1, M.ALB]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.bar([Math.cos(a) * 0.18, 0.55, Math.sin(a) * 0.18], [Math.cos(a) * 0.26, 0.0, Math.sin(a) * 0.26], 0.012, [0.3, 0.3, 0.31, M.ALB], 5);
  }
  k.cyl(0, 0.25, 0, 0.17, 0.17, 0.01, 14, [0.3, 0.3, 0.31, M.ALB]);
  for (const s of [-1, 1]) k.cyl(s * 0.26, 0.05, 0, 0.05, 0.05, 0.03, 12, black, 0, Math.PI / 2);
}

/** A city bike (a delivery box on the rack if `box`), standing on its wheels, along +x in its frame. */
export function bike(K: KitBuilder, x: number, y: number, z: number, yaw: number, lean = 0, box = false) {
  const k = new Kit(K);
  k.m.compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, yaw, 0, 'YXZ')), V(1, 1, 1));
  const tyre: C = [0.02, 0.02, 0.02, M.ALB], frame: C = [0.32, 0.05, 0.04, M.ALB], steel: C = [0.3, 0.3, 0.31, M.ALB];
  for (const wx of [-0.52, 0.52]) {
    k.geo(new THREE.TorusGeometry(0.33, 0.022, 6, 28), wx, 0.35, 0, tyre);
    k.geo(new THREE.TorusGeometry(0.31, 0.008, 4, 28), wx, 0.35, 0, steel);
    for (let s = 0; s < 8; s++) k.box(wx, 0.35, 0, 0.004, 0.6, 0.004, steel, 0, 0, (s / 8) * Math.PI);
    k.cyl(wx, 0.35, 0, 0.03, 0.03, 0.08, 8, steel, Math.PI / 2);
  }
  const fb = (a: number[], b: number[], v: C) => k.bar(a, b, 0.018, v);
  fb([-0.52, 0.35, 0], [-0.05, 0.4, 0], frame);
  fb([-0.05, 0.4, 0], [0.38, 0.82, 0], frame);
  fb([-0.52, 0.35, 0], [-0.18, 0.85, 0], frame);
  fb([-0.05, 0.4, 0], [-0.2, 0.9, 0], frame);
  fb([-0.18, 0.85, 0], [0.38, 0.82, 0], frame);
  fb([0.38, 0.82, 0], [0.52, 0.35, 0], steel);
  fb([0.38, 0.82, 0], [0.33, 1.02, 0], steel);
  fb([0.33, 1.02, -0.25], [0.33, 1.02, 0.25], steel);
  k.box(-0.22, 0.94, 0, 0.24, 0.05, 0.1, [0.03, 0.03, 0.03, M.ALB]);
  k.cyl(-0.05, 0.4, 0, 0.08, 0.08, 0.02, 14, steel, Math.PI / 2);
  fb([-0.6, 0.7, 0], [-0.2, 0.7, 0], steel);
  if (box) k.box(-0.42, 0.98, 0, 0.42, 0.5, 0.42, [0.5, 0.36, 0.06, M.ALB]);
  k.geo(new THREE.SphereGeometry(0.035, 8, 6), 0.4, 0.95, 0, [1, 0.95, 0.85, M.LIGHT]);
}

/** An AC condenser: a louvred box, a fan under a round grille on top, little feet. */
export function acUnit(K: KitBuilder, x: number, y: number, z: number, yaw: number, w = 0.9, h = 0.75, d = 0.8) {
  const k = new Kit(K).at(x, y, z, yaw);
  const body: C = [0.42, 0.42, 0.4, M.ALB], dark: C = [0.07, 0.07, 0.075, M.ALB];
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.box(px! * (w / 2 - 0.06), 0.04, pz! * (d / 2 - 0.06), 0.08, 0.08, 0.08, dark);
  k.box(0, 0.08 + h / 2, 0, w, h, d, body);
  // louvres on the long sides (darker bands), the fan grille on top
  for (let i = 0; i < 7; i++) {
    const yy = 0.16 + i * (h - 0.16) / 7;
    k.box(0, 0.08 + yy, d / 2 + 0.006, w - 0.12, 0.035, 0.01, dark).box(0, 0.08 + yy, -d / 2 - 0.006, w - 0.12, 0.035, 0.01, dark);
  }
  const R = Math.min(w, d) * 0.4;
  k.cyl(0, 0.08 + h + 0.005, 0, R, R, 0.01, 20, dark);
  for (let i = 0; i < 4; i++) k.box(0, 0.08 + h + 0.03, 0, 0.06, 0.012, R * 1.6, [0.15, 0.15, 0.16, M.ALB], (i / 4) * Math.PI + 0.3);
  k.geo(new THREE.TorusGeometry(R * 0.6, 0.006, 4, 24), 0, 0.08 + h + 0.035, 0, [0.5, 0.5, 0.5, M.ALB], Math.PI / 2);
  k.geo(new THREE.TorusGeometry(R * 0.98, 0.008, 4, 24), 0, 0.08 + h + 0.035, 0, [0.5, 0.5, 0.5, M.ALB], Math.PI / 2);
  // the copper pipes out of the side
  k.bar([w / 2, 0.3, 0.1], [w / 2 + 0.25, 0.3, 0.1], 0.012, [0.4, 0.2, 0.1, M.ALB]).bar([w / 2 + 0.25, 0.3, 0.1], [w / 2 + 0.25, 0.0, 0.1], 0.012, [0.4, 0.2, 0.1, M.ALB]);
}

/** A galvanised watering can. */
export function wateringCan(K: KitBuilder, x: number, y: number, z: number, yaw: number) {
  const k = new Kit(K).at(x, y, z, yaw);
  const zinc: C = [0.38, 0.4, 0.4, M.ALB];
  k.cyl(0, 0.13, 0, 0.11, 0.12, 0.26, 16, zinc);
  k.bar([0.09, 0.08, 0], [0.32, 0.3, 0], 0.012, zinc);
  k.cyl(0.33, 0.31, 0, 0.03, 0.015, 0.04, 8, zinc, 0, -0.9);
  k.geo(new THREE.TorusGeometry(0.1, 0.012, 5, 12, Math.PI), -0.02, 0.27, 0, zinc);
}

/** The string lights' wire through the bulb positions (sagging between posts). */
export function wire(K: KitBuilder, pts: THREE.Vector3[]) {
  const k = new Kit(K).at(0, 0, 0);
  for (let i = 1; i < pts.length; i++) k.bar([pts[i - 1]!.x, pts[i - 1]!.y + 0.06, pts[i - 1]!.z], [pts[i]!.x, pts[i]!.y + 0.06, pts[i]!.z], 0.004, [0.03, 0.03, 0.03, M.ALB], 3);
}

export { IRON };
