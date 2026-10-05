// Cars for the lens (the run's hero cab, the cars parked and passing right by the camera): the city's detailed
// car (lib/city-cars) refined for close-ups — a dense loft (48 stations, a 33-point section) so the vertex-lit
// paint reads round, side glass with a little curve and A/C pillars, a black belt trim, round tyres with
// shoulders, five-spoke rims over brake discs, dark arch liners, mirrors on stalks, wipers, a slatted grille,
// head- and taillight clusters with their lamps, bumpers with rounded corners, plates; the taxi's roof sign
// lettered TAXI. Same conventions as lib/city-cars: one unit car per type pointing +z, y = 0 on the road, door
// seams and handles by the kit shader's PAINT mode (instance colour), lights by M.LIGHT (instance k).
import * as THREE from 'three';
import { KitBuilder, M } from '../lib/city-build';

interface Spec {
  L: number; W: number; wheelZ: number; wheelR: number; bodyBottom: number;
  cowl: number; wsTop: number; roofEnd: number; tailTop: number;
  belt: number; roof: number; nose: number; tail: number; tumble: number; boxy: number;
}

// (lib/city-cars' proportions, so a car swapped in for the city's keeps its footprint)
const SPECS: Record<number, Spec> = {
  0: { L: 4.75, W: 1.84, wheelZ: 1.42, wheelR: 0.33, bodyBottom: 0.27, cowl: 0.95, wsTop: 0.15, roofEnd: -0.95, tailTop: -1.62, belt: 0.95, roof: 1.45, nose: 0.74, tail: 0.92, tumble: 0.17, boxy: 0 },
  1: { L: 4.9, W: 1.95, wheelZ: 1.48, wheelR: 0.38, bodyBottom: 0.36, cowl: 1.05, wsTop: 0.35, roofEnd: -1.95, tailTop: -2.25, belt: 1.12, roof: 1.78, nose: 0.92, tail: 1.05, tumble: 0.14, boxy: 0.6 },
  3: { L: 5.3, W: 2.0, wheelZ: 1.78, wheelR: 0.35, bodyBottom: 0.3, cowl: 1.75, wsTop: 1.25, roofEnd: -2.55, tailTop: -2.62, belt: 1.15, roof: 2.15, nose: 0.95, tail: 1.1, tumble: 0.05, boxy: 1 },
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** Strokes of the letters T, A, X, I on a unit cell (x 0..1, y 0..1): [x0, y0, x1, y1]. */
const GLYPH: Record<string, [number, number, number, number][]> = {
  T: [[0, 1, 1, 1], [0.5, 1, 0.5, 0]],
  A: [[0, 0, 0.5, 1], [0.5, 1, 1, 0], [0.22, 0.4, 0.78, 0.4]],
  X: [[0, 0, 1, 1], [0, 1, 1, 0]],
  I: [[0.5, 0, 0.5, 1]],
};

const cache = new Map<number, THREE.BufferGeometry>();

/** The refined car body of a type (0 sedan, 1 SUV, 2 taxi, 3 van), cached. */
export function heroCarGeometry(type: number) {
  let g = cache.get(type);
  if (!g) { g = build(type); cache.set(type, g); }
  return g;
}

function build(type: number) {
  const s = SPECS[type === 2 ? 0 : type] ?? SPECS[0]!;
  const k = new KitBuilder();
  const H = s.L / 2, hw0 = s.W / 2;
  const paint = [1, 1, 1, M.PAINT], glass = [0.018, 0.022, 0.028, M.GLASS], dark = [0.016, 0.016, 0.018, M.ALB], plastic = [0.03, 0.03, 0.033, M.ALB];
  const chrome = [0.42, 0.43, 0.45, M.ALB], rubber = [0.012, 0.012, 0.013, M.ALB];
  const halfW = (z: number) => {
    const e = Math.max(0, Math.abs(z) - (H - 0.55)) / 0.55;
    return hw0 * (1 - 0.18 * (1 - s.boxy * 0.6) * e * e) * (1 - 0.015 * (1 - s.boxy) * (z / H) * (z / H));
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
  const top = (z: number) => {
    if (z >= s.cowl) return s.nose + (s.belt - 0.02 - s.nose) * Math.pow(smooth(H, s.cowl, z), 0.55);
    if (z >= s.wsTop) return s.belt - 0.02 + (s.roof - s.belt + 0.02) * Math.pow((s.cowl - z) / (s.cowl - s.wsTop), 0.85);
    if (z >= s.roofEnd) return s.roof + 0.02 * Math.sin(((z - s.roofEnd) / (s.wsTop - s.roofEnd)) * Math.PI);
    if (z >= s.tailTop) return s.roof - (s.roof - s.belt - 0.03) * Math.pow((s.roofEnd - z) / (s.roofEnd - s.tailTop), 1.1);
    return s.belt + 0.03 - (s.belt + 0.03 - s.tail) * smooth(s.tailTop, -H, z);
  };
  const cabin = (z: number) => z < s.cowl - 0.02 && z > s.tailTop + 0.02;
  const sideGlass = (z: number) => z < s.cowl - 0.12 && z > s.tailTop + 0.12;
  const glassTop = (z: number) => (z < s.cowl - 0.05 && z > s.wsTop + 0.03) || (z < s.roofEnd - 0.03 && z > s.tailTop + 0.05);
  // ---- stations ----
  const NZ = 48, zs: number[] = [];
  for (let i = 0; i <= NZ; i++) { const u = i / NZ; zs.push(-H + s.L * (0.5 - 0.5 * Math.cos(u * Math.PI))); }
  for (const e of [s.cowl, s.wsTop, s.roofEnd, s.tailTop, s.cowl - 0.12, s.tailTop + 0.12]) zs.push(e - 0.012, e + 0.012);
  for (const wz of [s.wheelZ, -s.wheelZ]) for (let a = -6; a <= 6; a++) zs.push(wz + (a / 6) * (s.wheelR + 0.1));
  zs.sort((a, b) => a - b);
  const Z = zs.filter((z, i) => z >= -H && z <= H && (i === 0 || z - zs[i - 1]! > 0.015));
  // the half section (outside, from the rocker up to the roof's centre), each segment tagged
  type Tag = 'paint' | 'side' | 'top' | 'pillar' | 'dark';
  const half = (z: number): { p: [number, number][]; tags: Tag[] } => {
    const hw = halfW(z), yB = bottom(z), yt = top(z), c = cabin(z);
    const belt = c ? s.belt + 0.03 * (s.cowl - z) / s.L : Math.min(s.belt, yt - 0.025);
    const wTop = c ? hw - s.tumble : hw - 0.05;
    const crown = c ? 0.035 : 0.03;
    const p: [number, number][] = [
      [-hw * 0.92, yB], [-hw * 0.975, yB + 0.025], [-hw, yB + 0.075],
      [-hw * 1.008, yB + (belt - yB) * 0.3], [-hw * 1.013, yB + (belt - yB) * 0.52], [-hw * 1.008, yB + (belt - yB) * 0.74],
      [-hw * 0.998, belt - 0.06], [-hw + 0.012, belt - 0.02], [-hw + 0.032, belt],
    ];
    const tags: Tag[] = ['dark', 'paint', 'paint', 'paint', 'paint', 'paint', 'paint', 'paint'];
    // the side glass (or the body's shoulder before and after the cabin), bowed a little
    for (const u of [0.34, 0.67, 1]) {
      const x = -hw + 0.032 + (hw - 0.032 - wTop) * u - 0.022 * Math.sin(Math.PI * u) * (c ? 1 : 0.3), y = belt + (yt - belt) * u;
      p.push([x, y]); tags.push(c && sideGlass(z) ? 'side' : 'paint');
    }
    // the roof (or hood / trunk), crowned: its outer strip is the pillar where the top is glass
    for (const [u, f] of [[0.82, 0.42], [0.58, 0.78], [0.3, 0.95], [0, 1]] as const) {
      p.push([-wTop * u, yt + crown * f]);
      tags.push(u === 0.82 ? 'pillar' : 'top');
    }
    return { p, tags };
  };
  const sections = Z.map((z) => {
    const { p, tags } = half(z);
    const full = [...p, ...p.slice(0, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
    const ftags = [...tags, ...tags.slice().reverse()];
    return { pts: full.map(([x, y]) => V(x, y, z)), tags: ftags };
  });
  const S = sections.map((q) => q.pts), NP = S[0]!.length;
  const segMat = (j: number, zMid: number) => {
    const tag = sections[0]!.tags[j]!;
    if (tag === 'dark') return plastic;
    if (tag === 'side') return sideGlass(zMid) ? glass : paint;
    if (tag === 'top') return glassTop(zMid) ? glass : paint;
    return paint;
  };
  const nrm = (i: number, j: number) => {
    const a = S[Math.min(i + 1, S.length - 1)]![j]!, b = S[Math.max(i - 1, 0)]![j]!;
    const c = S[i]![Math.min(j + 1, NP - 1)]!, d = S[i]![Math.max(j - 1, 0)]!;
    const n = new THREE.Vector3().subVectors(c, d).cross(new THREE.Vector3().subVectors(a, b));
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
    return n.normalize();
  };
  for (let i = 0; i + 1 < S.length; i++) {
    const zm = (Z[i]! + Z[i + 1]!) / 2;
    for (let j = 0; j + 1 < NP; j++) k.quadN(S[i]![j]!, S[i]![j + 1]!, S[i + 1]![j + 1]!, S[i + 1]![j]!, nrm(i, j), nrm(i, j + 1), nrm(i + 1, j + 1), nrm(i + 1, j), segMat(j, zm));
  }
  for (const [i, sg] of [[0, -1], [S.length - 1, 1]] as const) {
    const sec = S[i]!, c = V(0, (bottom(Z[i]!) + top(Z[i]!)) / 2, Z[i]! + sg * 0.025);
    for (let j = 0; j + 1 < NP; j++) {
      if (sg > 0) k.tri([c.x, c.y, c.z], [sec[j]!.x, sec[j]!.y, sec[j]!.z], [sec[j + 1]!.x, sec[j + 1]!.y, sec[j + 1]!.z], paint);
      else k.tri([c.x, c.y, c.z], [sec[j + 1]!.x, sec[j + 1]!.y, sec[j + 1]!.z], [sec[j]!.x, sec[j]!.y, sec[j]!.z], paint);
    }
  }
  k.quad(0, s.bodyBottom - 0.01, 0, s.W * 0.9, s.L * 0.92, dark, 0, Math.PI / 2);
  // ---- trim: B-pillars, the belt line, mirrors, wipers ----
  const yP = s.belt + 0.04;
  for (const sx of [-1, 1]) {
    const zb = type === 3 ? s.cowl - 0.9 : (s.wsTop + s.roofEnd) / 2 + 0.1;
    const x0 = sx * (halfW(zb) + 0.004), x1 = sx * (halfW(zb) - s.tumble + 0.012);
    const P = (x: number, y: number, z: number) => [x, y, z];
    const quad = (z0: number, z1: number) => (sx > 0
      ? k.poly4(P(x0, yP, z1), P(x0, yP, z0), P(x1, s.roof - 0.03, z0), P(x1, s.roof - 0.03, z1), plastic)
      : k.poly4(P(x0, yP, z0), P(x0, yP, z1), P(x1, s.roof - 0.03, z1), P(x1, s.roof - 0.03, z0), plastic));
    quad(zb - 0.075, zb + 0.075);
    // the black belt trim under the side glass
    for (let z = s.tailTop + 0.16; z < s.cowl - 0.1; z += 0.2) {
      const zz = Math.min(z + 0.2, s.cowl - 0.1), zc = (z + zz) / 2;
      k.box(sx * (halfW(zc) - 0.022), s.belt + 0.012, zc, 0.02, 0.025, zz - z + 0.01, dark);
    }
    // the mirror: a rounded housing on a stalk, its glass facing back
    const mz = s.cowl - 0.16, mx = sx * (halfW(mz) - 0.03);
    k.box(mx + sx * 0.04, s.belt + 0.05, mz, 0.1, 0.035, 0.07, plastic);
    k.box(mx + sx * 0.13, s.belt + 0.1, mz, 0.17, 0.11, 0.07, plastic, sx * 0.12);
    k.sphere(mx + sx * 0.13, s.belt + 0.1, mz + 0.03, 1, plastic, 0.085, 0.055, 0.035, 1);
    k.quad(mx + sx * 0.13, s.belt + 0.1, mz - 0.037, 0.15, 0.09, [0.2, 0.22, 0.26, M.GLASS], Math.PI + sx * 0.12);
    k.box(mx + sx * 0.2, s.belt + 0.075, mz + 0.01, 0.03, 0.015, 0.05, [1.0, 0.45, 0.05, M.LIGHT]);
  }
  for (const sx of [-0.32, 0.28]) k.box(sx, top(s.cowl - 0.08) + 0.015, s.cowl - 0.08, 0.55, 0.018, 0.02, dark, sx * 0.3, 0.4);
  // ---- wheels: tyres with shoulders, rims with five spokes, brake discs; arch liners ----
  for (const wz of [s.wheelZ, -s.wheelZ]) for (const sx of [-1, 1]) {
    const x = sx * (halfW(wz) - 0.135), R = s.wheelR, wd = 0.23;
    const axis = (geo: THREE.BufferGeometry, ox: number, v: number[]) => {
      const m = new THREE.Matrix4().compose(V(x + sx * ox, R, wz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), V(1, 1, 1));
      k.add(geo, m, v);
    };
    axis(new THREE.CylinderGeometry(R, R, wd - 0.06, 28, 1, true), 0, rubber);
    // the shoulders: a slope from the tread in to the sidewall, each side
    for (const e of [-1, 1]) { const d = sx * e; axis(new THREE.CylinderGeometry(d > 0 ? R : R * 0.9, d > 0 ? R * 0.9 : R, 0.03, 28, 1, true), e * (wd / 2 - 0.015), rubber); }
    const disc = (r: number, ox: number, v: number[], seg = 28) => {
      const m = new THREE.Matrix4().compose(V(x + sx * ox, R, wz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (sx * Math.PI) / 2, 0)), V(r, r, 1));
      k.add(new THREE.CircleGeometry(1, seg), m, v);
    };
    disc(R * 0.9, wd / 2, rubber);
    disc(R * 0.64, wd / 2 + 0.002, [0.025, 0.025, 0.028, M.ALB]);
    disc(R * 0.5, wd / 2 - 0.04, [0.12, 0.11, 0.1, M.ALB]);
    // the rim's lip and five spokes, the hub and its nuts
    const lip = new THREE.RingGeometry(R * 0.58, R * 0.65, 28);
    { const m = new THREE.Matrix4().compose(V(x + sx * (wd / 2 + 0.006), R, wz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (sx * Math.PI) / 2, 0)), V(1, 1, 1)); k.add(lip, m, chrome); }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + wz;
      k.box(x + sx * (wd / 2 + 0.008), R + Math.sin(a) * R * 0.33, wz + Math.cos(a) * R * 0.33, 0.02, 0.055, R * 0.5, chrome, 0, -a);
    }
    disc(R * 0.13, wd / 2 + 0.014, chrome, 12);
    // the arch liner: a dark half-drum over the wheel
    const lg = new THREE.CylinderGeometry(R + 0.1, R + 0.1, 0.34, 20, 1, true, 0, Math.PI);
    const m = new THREE.Matrix4().compose(V(sx * (halfW(wz) - 0.17), R - 0.03, wz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), V(1, 1, 1));
    k.add(lg, m, dark);
  }
  // ---- front and back: bumpers with rounded corners, grille, plates, lights ----
  const fz = H + 0.02, bz = -H - 0.02, bw = s.W * 0.92;
  for (const [zz, y0, sg] of [[fz - 0.07, s.bodyBottom + 0.12, 1], [bz + 0.07, s.bodyBottom + 0.16, -1]] as const) {
    k.box(0, y0, zz, bw - 0.16, 0.18, 0.15, plastic);
    for (const sx of [-1, 1]) k.cyl(sx * (bw / 2 - 0.08), y0, zz - sg * 0.0, 0.08, 0.08, 0.18, 12, plastic);
    k.box(0, y0 + 0.03, zz + sg * 0.076, bw - 0.3, 0.012, 0.004, chrome);
  }
  // the grille: a dark recess with chrome slats, the badge
  const gy = s.nose - 0.16, gw = s.W * (type === 3 ? 0.5 : 0.4);
  k.quad(0, gy, fz - 0.008, gw, 0.17, [0.008, 0.008, 0.01, M.ALB]);
  for (let i = 0; i < 4; i++) k.box(0, gy - 0.06 + i * 0.04, fz - 0.002, gw - 0.02, 0.01, 0.012, chrome);
  k.cyl(0, gy + 0.005, fz + 0.004, 0.035, 0.035, 0.01, 12, chrome, false, Math.PI / 2);
  k.quad(0, s.bodyBottom + 0.27, fz + 0.012, 0.32, 0.11, [0.55, 0.55, 0.52, M.ALB]);
  k.quad(0, s.tail - 0.24, bz - 0.006, 0.32, 0.15, [0.6, 0.57, 0.48, M.ALB], Math.PI);
  for (const sx of [-1, 1]) {
    const hx = sx * (hw0 * 0.63);
    // the headlight cluster wrapping the corner: housing, a projector, the running-light strip
    k.poly4([hx - 0.21, s.nose - 0.07, fz - 0.035], [hx + 0.21, s.nose - 0.07, fz - 0.035], [hx + 0.21, s.nose - 0.18, fz - 0.006], [hx - 0.21, s.nose - 0.18, fz - 0.006], [0.12, 0.12, 0.13, M.GLASS]);
    k.cyl(hx - sx * 0.07, s.nose - 0.125, fz - 0.012, 0.045, 0.045, 0.01, 14, [1.0, 0.95, 0.85, M.LIGHT], false, Math.PI / 2);
    k.cyl(hx + sx * 0.08, s.nose - 0.125, fz - 0.014, 0.035, 0.035, 0.01, 14, [0.9, 0.85, 0.75, M.LIGHT], false, Math.PI / 2);
    k.box(hx, s.nose - 0.08, fz - 0.03, 0.36, 0.012, 0.01, [0.9, 0.92, 1.0, M.LIGHT], 0, -0.6);
    k.box(sx * (hw0 * 0.86), s.bodyBottom + 0.17, fz - 0.06, 0.12, 0.05, 0.01, [0.9, 0.55, 0.12, M.LIGHT]);
    // taillights: a red cluster, its reverse lamp, a reflector low on the bumper
    k.quad(sx * (hw0 * 0.68), s.tail - 0.08, bz + 0.008, 0.44, 0.14, [1.0, 0.04, 0.02, M.LIGHT], Math.PI);
    k.quad(sx * (hw0 * 0.6), s.tail - 0.08, bz + 0.0095, 0.1, 0.06, [0.9, 0.9, 0.85, M.ALB], Math.PI);
    k.quad(sx * (hw0 * 0.86), s.tail - 0.08, bz + 0.03, 0.12, 0.13, [0.8, 0.03, 0.02, M.LIGHT], Math.PI);
    k.quad(sx * (hw0 * 0.7), s.bodyBottom + 0.12, bz - 0.08, 0.14, 0.04, [0.3, 0.02, 0.01, M.ALB], Math.PI);
  }
  // the third brake light under the rear glass, the exhaust
  k.box(0, s.belt + 0.06, s.tailTop + 0.02, 0.3, 0.025, 0.02, [0.8, 0.03, 0.02, M.LIGHT]);
  k.cyl(-hw0 * 0.6, s.bodyBottom + 0.02, bz + 0.05, 0.035, 0.035, 0.12, 10, [0.15, 0.15, 0.15, M.ALB], true, Math.PI / 2);
  // ---- the taxi's roof sign, lettered both sides ----
  if (type === 2) {
    const sy = s.roof + 0.18, sz = -0.35, L = 0.82, Hs = 0.24, Ws = 0.28;
    k.box(0, s.roof + 0.04, sz, 0.55, 0.05, 0.2, plastic);
    k.box(0, sy, sz, L - Ws, Hs, Ws, [1.05, 0.9, 0.55, M.LIGHT]);
    for (const e of [-1, 1]) k.add(new THREE.CylinderGeometry(Ws / 2, Ws / 2, Hs, 14, 1, false, e > 0 ? 0 : Math.PI, Math.PI), new THREE.Matrix4().makeTranslation(e * (L - Ws) / 2, sy, sz), [1.05, 0.9, 0.55, M.LIGHT]);
    k.box(0, sy + Hs / 2 + 0.012, sz, L - 0.04, 0.025, Ws - 0.02, [0.06, 0.06, 0.06, M.ALB]);
    // the letters on its lit faces (front and back), dark on the panel, reading left to right from either side
    for (const sf of [-1, 1]) {
      const word = 'TAXI', cw = 0.1, ch = 0.12, gap = 0.035, w0 = -((word.length * cw + (word.length - 1) * gap) / 2);
      [...word].forEach((ch_, i) => {
        for (const [a0, b0, a1, b1] of GLYPH[ch_]!) {
          const xA = sf * (w0 + i * (cw + gap) + a0 * cw), xB = sf * (w0 + i * (cw + gap) + a1 * cw), v0 = sy - ch / 2 + b0 * ch, v1 = sy - ch / 2 + b1 * ch;
          const len = Math.hypot(xB - xA, v1 - v0) + 0.018, ang = Math.atan2(v1 - v0, xB - xA);
          k.box((xA + xB) / 2, (v0 + v1) / 2, sz + sf * (Ws / 2 + 0.003), len, 0.018, 0.006, [0.03, 0.025, 0.02, M.ALB], 0, 0, ang);
        }
      });
    }
  }
  return k.geometry();
}
