// Detailed cars for close range: a lofted body (rounded nose and tail in plan, bulging sides, a shoulder line, a
// crowned hood and roof, tumblehome), a greenhouse of glass (sloped windshield and rear window, side windows with
// a dark B-pillar), wheel arches with tyres and rims, bumpers, a grille, head- and taillight clusters, mirrors,
// plates; door seams and handles are drawn by the shader (mode PAINT). Taxis carry their lit roof sign.
// One unit car per type points +z, y = 0 on the road. (Far away the cheap profile car in city-life.ts is used.)
import * as THREE from 'three';
import { KitBuilder, M } from './city-build';

interface CarSpec {
  L: number; W: number; wheelZ: number; wheelR: number; bodyBottom: number;
  /** z where the windshield starts (at the cowl) and meets the roof, where the roof ends and the rear glass meets the tail */
  cowl: number; wsTop: number; roofEnd: number; tailTop: number;
  belt: number; roof: number; nose: number; tail: number; tumble: number; boxy: number;
}

const SPECS: Record<number, CarSpec> = {
  // sedan / taxi
  0: { L: 4.75, W: 1.84, wheelZ: 1.42, wheelR: 0.33, bodyBottom: 0.27, cowl: 0.95, wsTop: 0.15, roofEnd: -0.95, tailTop: -1.62, belt: 0.95, roof: 1.45, nose: 0.74, tail: 0.92, tumble: 0.17, boxy: 0 },
  // SUV
  1: { L: 4.9, W: 1.95, wheelZ: 1.48, wheelR: 0.38, bodyBottom: 0.36, cowl: 1.05, wsTop: 0.35, roofEnd: -1.95, tailTop: -2.25, belt: 1.12, roof: 1.78, nose: 0.92, tail: 1.05, tumble: 0.14, boxy: 0.6 },
  // van
  3: { L: 5.3, W: 2.0, wheelZ: 1.78, wheelR: 0.35, bodyBottom: 0.3, cowl: 1.75, wsTop: 1.25, roofEnd: -2.55, tailTop: -2.62, belt: 1.15, roof: 2.15, nose: 0.95, tail: 1.1, tumble: 0.05, boxy: 1 },
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function carDetailGeometry(type: number) {
  const s = SPECS[type === 2 ? 0 : type] ?? SPECS[0]!;
  const k = new KitBuilder();
  const H = s.L / 2, hw0 = s.W / 2;
  const paint = [1, 1, 1, M.PAINT], glass = [0.02, 0.025, 0.03, M.GLASS], dark = [0.018, 0.018, 0.02, M.ALB], plastic = [0.035, 0.035, 0.038, M.ALB];
  // ---- the body's functions of z ----
  const halfW = (z: number) => {
    const e = Math.max(0, Math.abs(z) - (H - 0.5)) / 0.5; // rounded corners in plan
    return hw0 * (1 - 0.18 * (1 - s.boxy * 0.6) * e * e);
  };
  const arch = (z: number) => {
    let y = 0;
    for (const wz of [s.wheelZ, -s.wheelZ]) {
      const d = Math.abs(z - wz), r = s.wheelR + 0.1;
      if (d < r) y = Math.max(y, s.wheelR + Math.sqrt(r * r - d * d) - 0.04);
    }
    return y;
  };
  const bottom = (z: number) => Math.max(s.bodyBottom + 0.06 * smooth(H - 0.4, H, Math.abs(z)), arch(z));
  // the top line: nose → hood → windshield → roof → rear glass → trunk → tail
  const top = (z: number) => {
    if (z >= s.cowl) return s.nose + (s.belt - 0.02 - s.nose) * Math.pow(smooth(H, s.cowl, z), 0.55);
    if (z >= s.wsTop) return s.belt - 0.02 + (s.roof - s.belt + 0.02) * Math.pow((s.cowl - z) / (s.cowl - s.wsTop), 0.85);
    if (z >= s.roofEnd) return s.roof + 0.02 * Math.sin(((z - s.roofEnd) / (s.wsTop - s.roofEnd)) * Math.PI);
    if (z >= s.tailTop) return s.roof - (s.roof - s.belt - 0.03) * Math.pow((s.roofEnd - z) / (s.roofEnd - s.tailTop), 1.1);
    return s.belt + 0.03 - (s.belt + 0.03 - s.tail) * smooth(s.tailTop, -H, z);
  };
  const cabin = (z: number) => z < s.cowl - 0.02 && z > s.tailTop + 0.02;
  const glassTop = (z: number) => (z < s.cowl - 0.05 && z > s.wsTop + 0.03) || (z < s.roofEnd - 0.03 && z > s.tailTop + 0.05);
  // ---- stations along z, a section of 13 points at each ----
  const NZ = 30, zs: number[] = [];
  for (let i = 0; i <= NZ; i++) { const u = i / NZ; zs.push(-H + s.L * (0.5 - 0.5 * Math.cos(u * Math.PI))); }
  for (const extra of [s.cowl, s.wsTop, s.roofEnd, s.tailTop, s.wheelZ - s.wheelR - 0.1, s.wheelZ + s.wheelR + 0.1, -s.wheelZ - s.wheelR - 0.1, -s.wheelZ + s.wheelR + 0.1]) zs.push(extra);
  zs.sort((a, b) => a - b);
  const Z = zs.filter((z, i) => i === 0 || z - zs[i - 1]! > 0.04);
  const section = (z: number) => {
    const hw = halfW(z), yB = bottom(z), yt = top(z), c = cabin(z);
    const belt = c ? s.belt + 0.03 * (s.cowl - z) / s.L : Math.min(s.belt, yt - 0.025);
    const wTop = c ? hw - s.tumble : hw - 0.05;
    const crown = c ? 0.03 : 0.025;
    const P: [number, number][] = [
      [-hw * 0.93, yB], [-hw, yB + 0.07], [-hw * 1.012, (yB + belt) * 0.5], [-hw, belt - 0.05], [-hw + 0.035, belt],
      [-wTop, yt - (c ? 0.0 : 0.005)], [-wTop * 0.45, yt + crown * 0.8], [0, yt + crown],
    ];
    const full = [...P, ...P.slice(0, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
    return full.map(([x, y]) => new THREE.Vector3(x, y, z));
  };
  const S = Z.map(section), NP = S[0]!.length;
  // material of segment j between stations i, i+1
  const segMat = (j: number, zMid: number) => {
    const side = j === 4 || j === NP - 6; // shoulder → top corner
    const top_ = j === 5 || j === 6 || j === NP - 7 || j === NP - 8;
    if (side && cabin(zMid)) return glass;
    if (top_ && glassTop(zMid)) return glass;
    return paint;
  };
  // normals from neighbours
  const nrm = (i: number, j: number) => {
    const a = S[Math.min(i + 1, S.length - 1)]![j]!, b = S[Math.max(i - 1, 0)]![j]!;
    const c = S[i]![Math.min(j + 1, NP - 1)]!, d = S[i]![Math.max(j - 1, 0)]!;
    const n = new THREE.Vector3().subVectors(c, d).cross(new THREE.Vector3().subVectors(a, b));
    if (n.lengthSq() < 1e-10) n.set(0, 1, 0);
    return n.normalize();
  };
  for (let i = 0; i + 1 < S.length; i++) {
    const zm = (Z[i]! + Z[i + 1]!) / 2;
    for (let j = 0; j + 1 < NP; j++) {
      const v = segMat(j, zm);
      k.quadN(S[i]![j]!, S[i]![j + 1]!, S[i + 1]![j + 1]!, S[i + 1]![j]!, nrm(i, j), nrm(i, j + 1), nrm(i + 1, j + 1), nrm(i + 1, j), v);
    }
  }
  // the ends: fan the first and last sections to their centre
  for (const [i, sg] of [[0, -1], [S.length - 1, 1]] as const) {
    const sec = S[i]!, c = new THREE.Vector3(0, (bottom(Z[i]!) + top(Z[i]!)) / 2, Z[i]! + sg * 0.03);
    for (let j = 0; j + 1 < NP; j++) {
      if (sg > 0) k.tri([c.x, c.y, c.z], [sec[j]!.x, sec[j]!.y, sec[j]!.z], [sec[j + 1]!.x, sec[j + 1]!.y, sec[j + 1]!.z], paint);
      else k.tri([c.x, c.y, c.z], [sec[j + 1]!.x, sec[j + 1]!.y, sec[j + 1]!.z], [sec[j]!.x, sec[j]!.y, sec[j]!.z], paint);
    }
  }
  // the underside (dark) so the car isn't hollow from low angles
  k.quad(0, s.bodyBottom - 0.01, 0, s.W * 0.9, s.L * 0.92, dark, 0, Math.PI / 2);
  // B-pillars (and the van's C-pillar)
  const yP = s.belt + 0.04;
  for (const sx of [-1, 1]) {
    const zb = type === 3 ? s.cowl - 0.9 : (s.wsTop + s.roofEnd) / 2 + 0.1;
    const x0 = sx * (halfW(zb) + 0.004), x1 = sx * (halfW(zb) - s.tumble + 0.012);
    const P = (x: number, y: number, z: number) => [x, y, z];
    const quad = (z0: number, z1: number) => (sx > 0
      ? k.poly4(P(x0, yP, z1), P(x0, yP, z0), P(x1, s.roof - 0.03, z0), P(x1, s.roof - 0.03, z1), plastic)
      : k.poly4(P(x0, yP, z0), P(x0, yP, z1), P(x1, s.roof - 0.03, z1), P(x1, s.roof - 0.03, z0), plastic));
    quad(zb - 0.07, zb + 0.07);
    // mirrors at the base of the windshield
    k.box(sx * (halfW(s.cowl) + 0.1), s.belt + 0.1, s.cowl - 0.12, 0.2, 0.13, 0.09, paint, sx * 0.2);
  }
  // wheels: tyres, rims
  for (const wz of [s.wheelZ, -s.wheelZ]) for (const sx of [-1, 1]) {
    const x = sx * (halfW(wz) - 0.13);
    k.cyl(x, s.wheelR, wz, s.wheelR, s.wheelR, 0.23, 12, dark, false, 0, Math.PI / 2);
    k.cyl(x + sx * 0.118, s.wheelR, wz, s.wheelR * 0.62, s.wheelR * 0.62, 0.012, 10, [0.32, 0.32, 0.34, M.ALB], false, 0, Math.PI / 2);
    k.cyl(x + sx * 0.122, s.wheelR, wz, s.wheelR * 0.18, s.wheelR * 0.18, 0.012, 6, [0.1, 0.1, 0.11, M.ALB], false, 0, Math.PI / 2);
  }
  // bumpers, grille, plates
  const fz = H + 0.02, bz = -H - 0.02;
  k.box(0, s.bodyBottom + 0.12, fz - 0.06, s.W * 0.92, 0.17, 0.14, plastic);
  k.box(0, s.bodyBottom + 0.16, bz + 0.06, s.W * 0.92, 0.17, 0.14, plastic);
  k.quad(0, s.nose - 0.17, fz - 0.005, s.W * 0.4, 0.16, [0.01, 0.01, 0.012, M.ALB]);
  k.quad(0, s.bodyBottom + 0.24, fz + 0.012, 0.32, 0.11, [0.5, 0.5, 0.48, M.ALB]);
  k.quad(0, s.tail - 0.22, bz - 0.005, 0.32, 0.15, [0.55, 0.52, 0.45, M.ALB], Math.PI);
  // lights: wide clusters wrapping the corners
  for (const sx of [-1, 1]) {
    const hx = sx * (hw0 * 0.62);
    k.poly4([hx - 0.2, s.nose - 0.07, fz - 0.03], [hx + 0.2, s.nose - 0.07, fz - 0.03], [hx + 0.2, s.nose - 0.17, fz - 0.005], [hx - 0.2, s.nose - 0.17, fz - 0.005], [1.0, 0.92, 0.8, M.LIGHT]);
    k.quad(sx * (hw0 * 0.68), s.tail - 0.08, bz + 0.008, 0.42, 0.13, [1.0, 0.04, 0.02, M.LIGHT], Math.PI);
    k.quad(sx * (hw0 * 0.68), s.tail - 0.17, bz + 0.009, 0.18, 0.04, [0.9, 0.9, 0.9, M.ALB], Math.PI);
  }
  if (type === 2) {
    k.box(0, s.roof + 0.14, -0.35, 0.82, 0.25, 0.3, [1.0, 0.85, 0.5, M.LIGHT]);
    k.box(0, s.roof + 0.03, -0.35, 0.6, 0.04, 0.2, plastic);
  }
  return k.geometry();
}
