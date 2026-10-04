// Space chorus B: a glass heart floating in space ("Every broken piece becomes a star"). The heart is a puffy
// glass solid (a heart outline inflated with a rounded profile) pre-cut into Voronoi pieces, so it can crack
// from one point (light leaking through the cracks), burst on the beat, and each piece can heat up, shrink and
// become a star. Glass is additive: dim inner light, a bright fresnel rim and sharp glints of a key light.
import * as THREE from 'three';
import { clamp, ease, mulberry32, pulse, smoothstep } from '../../engine/util';
import { GlowLines } from '../lib/stars';
import { GlowPoints } from '../lib/points';

type V2 = THREE.Vector2;
const v2 = (x: number, y: number) => new THREE.Vector2(x, y);

/** The heart outline (width 2, centred), clockwise from the notch at the top. */
function heartOutline(n = 150): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(v2(x / 16, (y + 2.5) / 16));
  }
  return pts;
}

function inside(p: V2, poly: V2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function segDist(p: V2, a: V2, b: V2) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const u = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1));
  return Math.hypot(p.x - a.x - abx * u, p.y - a.y - aby * u);
}

/** Keep the part of `poly` where (p - m)·n <= 0 (Sutherland–Hodgman against one half-plane). */
function clipHalf(poly: V2[], m: V2, n: V2): V2[] {
  const out: V2[] = [];
  const side = (p: V2) => (p.x - m.x) * n.x + (p.y - m.y) * n.y;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const sa = side(a), sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa <= 0) !== (sb <= 0)) { const u = sa / (sa - sb); out.push(v2(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)); }
  }
  return out;
}

function area(poly: V2[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i]!, b = poly[(i + 1) % poly.length]!; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

export interface HeartTimes {
  /** Cracks spread from the impact point between crack0 and crack1; the pieces burst at `shatter`. */
  crack0: number; crack1: number; shatter: number;
  /** Pieces ignite (heat up, shrink into stars) between ign0 and ign1. */
  ign0: number; ign1: number;
}

interface Piece {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial;
  c: V2; area: number; dir: THREE.Vector3; speed: number; axis: THREE.Vector3; spin: number; ign: number; rank: number;
}

export class GlassHeart extends THREE.Group {
  pieces: Piece[] = [];
  cracks: GlowLines;
  core = new GlowPoints(6, 1);
  private crackSegs: { a: THREE.Vector3; b: THREE.Vector3; d: number }[] = [];
  private shared: Record<string, THREE.IUniform>;
  impact = v2(-0.42, 0.42);
  H = 0.18;
  private outline = heartOutline();
  private dmax = 1;
  T: HeartTimes = { crack0: 0, crack1: 0, shatter: 0, ign0: 0, ign1: 0 };

  constructor(seed: number, inner: THREE.Color, rim: THREE.Color, crack: THREE.Color, nPieces = 64) {
    super();
    const rnd = mulberry32(seed);
    const O = this.outline;
    // the inflation profile: distance to the outline, rounded
    let dm = 0;
    for (let y = -1; y <= 1; y += 0.05) for (let x = -1; x <= 1; x += 0.05) { const p = v2(x, y); if (inside(p, O)) dm = Math.max(dm, this.dist(p)); }
    this.dmax = dm;
    // seeds: denser around the impact point
    const seeds: V2[] = [];
    for (let tries = 0; seeds.length < nPieces && tries < 20000; tries++) {
      const p = v2(rnd() * 2 - 1, rnd() * 1.9 - 0.95);
      if (!inside(p, O)) continue;
      const d = p.distanceTo(this.impact);
      if (rnd() > 0.25 + 0.75 * Math.exp(-d * d / 0.35)) continue;
      if (seeds.some((s) => s.distanceTo(p) < 0.07 + 0.1 * Math.min(d, 1.2))) continue;
      seeds.push(p);
    }
    this.shared = {
      inner: { value: inner.clone() }, rimC: { value: rim.clone() }, crackC: { value: crack.clone() },
      keyDir: { value: new THREE.Vector3(-0.4, 0.75, 0.5).normalize() }, level: { value: 1 },
      crackR: { value: -1 }, impact: { value: this.impact.clone() }, apart: { value: 0 },
    };
    const edgeKeys = new Set<string>();
    seeds.forEach((s, i) => {
      let cell = O.map((p) => p.clone());
      seeds.forEach((q, j) => {
        if (i === j || cell.length < 3) return;
        const m = s.clone().add(q).multiplyScalar(0.5), n = q.clone().sub(s);
        cell = clipHalf(cell, m, n);
      });
      // drop near-duplicate vertices
      cell = cell.filter((p, k) => p.distanceTo(cell[(k + 1) % cell.length]!) > 1e-4);
      if (cell.length < 3 || Math.abs(area(cell)) < 2e-4) return;
      this.addPiece(cell, rnd, edgeKeys);
    });
    // ignition order: from the impact outward
    const order = this.pieces.map((p, i) => [p.c.distanceTo(this.impact) + rnd() * 0.25, i] as const).sort((a, b) => a[0] - b[0]);
    order.forEach(([, i], k) => (this.pieces[i]!.rank = k / Math.max(1, order.length - 1)));
    this.cracks = new GlowLines(this.crackSegs.length, 0.011);
    this.add(this.cracks, this.core);
  }

  private dist(p: V2) {
    let d = 1e9;
    const O = this.outline;
    for (let i = 0; i < O.length; i++) d = Math.min(d, segDist(p, O[i]!, O[(i + 1) % O.length]!));
    return d;
  }

  /** Half-thickness of the glass at p. */
  h(p: V2) {
    const u = clamp(this.dist(p) / this.dmax);
    return this.H * Math.sqrt(u * (2 - u));
  }

  private addPiece(cell: V2[], rnd: () => number, edgeKeys: Set<string>) {
    const cw = area(cell) < 0;
    const c = cell.reduce((a, p) => a.add(p), v2(0, 0)).multiplyScalar(1 / cell.length);
    const P: number[] = [], N: number[] = [], Wl: number[] = [], Or: number[] = [];
    const e = 0.02;
    const push = (x: number, y: number, z: number, n: THREE.Vector3, wall: number) => {
      P.push(x - c.x, y - c.y, z); N.push(n.x, n.y, n.z); Wl.push(wall); Or.push(x, y);
    };
    const faceN = (p: V2, sgn: number) => {
      const hx = (this.h(v2(p.x + e, p.y)) - this.h(v2(p.x - e, p.y))) / (2 * e);
      const hy = (this.h(v2(p.x, p.y + e)) - this.h(v2(p.x, p.y - e))) / (2 * e);
      return new THREE.Vector3(-hx, -hy, sgn).normalize();
    };
    // faces: earcut triangles, each subdivided 3x3 so the inflated surface curves
    const tris = THREE.ShapeUtils.triangulateShape(cell, []);
    const L = 3;
    for (const [ia, ib, ic] of tris) {
      const A = cell[ia!]!, B = cell[ib!]!, C = cell[ic!]!;
      const at = (i: number, j: number) => v2(A.x + ((B.x - A.x) * i + (C.x - A.x) * j) / L, A.y + ((B.y - A.y) * i + (C.y - A.y) * j) / L);
      const sub: [V2, V2, V2][] = [];
      for (let i = 0; i < L; i++) for (let j = 0; j < L - i; j++) {
        sub.push([at(i, j), at(i + 1, j), at(i, j + 1)]);
        if (j < L - i - 1) sub.push([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]);
      }
      for (const tri of sub) for (const sgn of [1, -1]) {
        const vs = sgn > 0 ? tri : [tri[0], tri[2], tri[1]];
        for (const p of vs) push(p!.x, p!.y, sgn * this.h(p!), faceN(p!, sgn), 0);
      }
    }
    // walls along the cell's edges (degenerate where the glass is thin, at the outline)
    for (let k = 0; k < cell.length; k++) {
      const a = cell[k]!, b = cell[(k + 1) % cell.length]!;
      const len = a.distanceTo(b), m = Math.max(1, Math.ceil(len / 0.05));
      const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
      const n = cw ? new THREE.Vector3(-dy, dx, 0) : new THREE.Vector3(dy, -dx, 0);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const onOutline = this.dist(mid) < 0.006;
      for (let s = 0; s < m; s++) {
        const p = a.clone().lerp(b, s / m), q = a.clone().lerp(b, (s + 1) / m);
        const hp = this.h(p), hq = this.h(q);
        if (hp + hq < 0.01) continue;
        push(p.x, p.y, hp, n, 1); push(q.x, q.y, hq, n, 1); push(q.x, q.y, -hq, n, 1);
        push(p.x, p.y, hp, n, 1); push(q.x, q.y, -hq, n, 1); push(p.x, p.y, -hp, n, 1);
        // crack lines on both faces (internal edges only, each once)
        if (!onOutline) {
          const key = `${Math.round((p.x + q.x) * 500)},${Math.round((p.y + q.y) * 500)}`;
          if (!edgeKeys.has(key)) {
            edgeKeys.add(key);
            const dm = p.clone().add(q).multiplyScalar(0.5).distanceTo(this.impact);
            for (const sgn of [1, -1]) this.crackSegs.push({ a: new THREE.Vector3(p.x, p.y, sgn * (hp + 0.006)), b: new THREE.Vector3(q.x, q.y, sgn * (hq + 0.006)), d: dm });
          }
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('aWall', new THREE.Float32BufferAttribute(Wl, 1));
    g.setAttribute('aOrig', new THREE.Float32BufferAttribute(Or, 2));
    const S = this.shared;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...S, heat: { value: 0 }, hot: { value: (S.crackC!.value as THREE.Color).clone().multiplyScalar(0.5) } },
      vertexShader: /* glsl */ `
        attribute float aWall; attribute vec2 aOrig;
        varying vec3 vN; varying vec3 vV; varying float vWall; varying vec2 vOrig;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = mat3(modelMatrix) * normal; vV = cameraPosition - w.xyz; vWall = aWall; vOrig = aOrig;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 inner, rimC, crackC, keyDir, hot; uniform float level, crackR, apart, heat; uniform vec2 impact;
        varying vec3 vN; varying vec3 vV; varying float vWall; varying vec2 vOrig;
        void main() {
          float ln = length(vN), lv = length(vV);
          vec3 n = ln > 1e-5 ? vN / ln : vec3(0.0, 0.0, 1.0), v = lv > 1e-5 ? vV / lv : vec3(0.0, 0.0, 1.0);
          if (dot(n, v) < 0.0) n = -n;
          float nv = clamp(dot(n, v), 0.0, 1.0), f = 1.0 - nv;
          vec3 r = reflect(-v, n);
          float k1 = max(dot(r, keyDir), 0.0), k2 = max(dot(r, normalize(vec3(0.7, -0.2, 0.6))), 0.0);
          vec3 env = vec3(1.0, 0.97, 0.92) * (pow(k1, 60.0) * 5.0 + pow(k1, 8.0) * 0.12) + rimC * pow(k2, 16.0) * 1.0;
          vec3 glass = inner * (0.004 + 0.045 * nv * nv * nv * nv) + (rimC * 0.7 + inner * 0.3) * f * f * f * 0.7 + env * (0.12 + 0.6 * f);
          float dd = distance(vOrig, impact);
          float cq = (dd - crackR + 0.08) / 0.1;
          float cr = (smoothstep(crackR, crackR - 0.3, dd) * 0.07 + exp(-cq * cq) * 0.5) * step(0.0, crackR) * (1.0 - apart);
          vec3 c = mix(glass, glass * apart + crackC * cr, vWall);
          c = mix(c, hot * (0.25 + 0.6 * nv), heat);
          gl_FragColor = vec4(c * level, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false;
    this.add(mesh);
    const rr = () => rnd() * 2 - 1;
    const away = c.clone().sub(this.impact);
    const dir = new THREE.Vector3(away.x * 0.9 + c.x * 0.6 + rr() * 0.35, away.y * 0.9 + c.y * 0.6 + rr() * 0.35, 0.5 + rr() * 0.9).normalize();
    this.pieces.push({
      mesh, mat, c, area: Math.abs(area(cell)), dir, speed: 2.2 + rnd() * 3.2 + 0.6 / (0.2 + c.distanceTo(this.impact)),
      axis: new THREE.Vector3(rr(), rr(), rr()).normalize(), spin: (2.5 + rnd() * 6) * (rnd() < 0.5 ? -1 : 1), ign: 0, rank: 0,
    });
  }

  /** Local offset travelled by piece `i` at t (0 before the burst). */
  private travel(t: number) {
    const u = t - this.T.shatter, k = 2.4;
    return u <= 0 ? 0 : (1 - Math.exp(-k * u)) / k + 0.12 * u;
  }

  /** Local position of piece i's centre at time t. */
  pieceLocal(i: number, t: number, out = new THREE.Vector3()) {
    const p = this.pieces[i]!, T = this.T;
    const bulge = 0.025 * ease.outCubic(clamp((t - T.crack0) / Math.max(0.01, T.shatter - T.crack0))) * smoothstep(T.crack0, T.crack0 + 0.1, t);
    return out.set(p.c.x, p.c.y, 0).addScaledVector(p.dir, bulge + p.speed * this.travel(t));
  }

  /** Ignition time of piece i. */
  ignAt(i: number) { const T = this.T; return T.ign0 + (T.ign1 - T.ign0) * this.pieces[i]!.rank; }

  /** Brightness of the star piece i turns into (0 before it ignites). */
  starK(i: number, t: number) {
    const ti = this.ignAt(i);
    return t < ti - 0.05 ? 0 : smoothstep(ti - 0.05, ti + 0.15, t) * (1 + 2.5 * pulse(t, ti, 0.1));
  }

  /** Pose for time t; `beat` (continuous) drives the heartbeat of the light inside, `level` the overall light. */
  pose(t: number, beat: number, level: number) {
    const T = this.T, S = this.shared;
    S.level!.value = level;
    S.crackR!.value = t < T.crack0 ? -1 : 2.6 * ease.outCubic(clamp((t - T.crack0) / Math.max(0.05, T.shatter - T.crack0)));
    S.apart!.value = smoothstep(T.shatter, T.shatter + 0.25, t);
    const q = new THREE.Quaternion();
    const tmp = new THREE.Vector3();
    this.pieces.forEach((p, i) => {
      const ti = this.ignAt(i);
      const sc = 1 - smoothstep(ti + 0.02, ti + 0.4, t);
      p.mesh.visible = sc > 0.01;
      if (!p.mesh.visible) return;
      this.pieceLocal(i, t, tmp);
      p.mesh.position.copy(tmp);
      q.setFromAxisAngle(p.axis, p.spin * this.travel(t));
      p.mesh.quaternion.copy(q);
      p.mesh.scale.setScalar(sc);
      p.mat.uniforms.heat!.value = smoothstep(ti - 0.2, ti + 0.12, t);
    });
    // the cracks: drawn on both faces as they spread; gone once it bursts
    const cr = S.crackR!.value as number;
    let n = 0;
    if (t < T.shatter + 0.04 && cr > 0) {
      const c = (S.crackC!.value as THREE.Color);
      for (const s of this.crackSegs) {
        const k = smoothstep(cr, cr - 0.25, s.d);
        if (k <= 0) continue;
        this.cracks.set(n++, s.a, s.b, c, 0.9 * k * (1 + 1.5 * pulse(t, T.shatter - 0.02, 0.05)));
      }
    }
    this.cracks.commit(n);
    // the light inside: a slow heartbeat (two beats per bar), swelling while it cracks, bursting with it
    const ph = beat - Math.floor(beat / 2) * 2;
    const lub = Math.exp(-ph * 9) + 0.6 * Math.exp(-Math.max(0, ph - 0.28) * 11) * (ph > 0.28 ? 1 : 0);
    const swell = smoothstep(T.crack0, T.shatter, t);
    const gone = t < T.shatter ? 1 : Math.pow(0.5, (t - T.shatter) / 0.07);
    const inner = S.inner!.value as THREE.Color;
    this.core.set(0, 0, -0.05, 0, inner, (0.25 + 0.2 * lub + 0.45 * swell) * gone * level, 0.32 + 0.2 * swell);
    this.core.set(1, 0, -0.05, 0, inner, (0.035 + 0.03 * lub + 0.08 * swell) * gone * level, 1.5 + 0.8 * swell);
    const burst = t >= T.shatter ? Math.pow(0.5, (t - T.shatter) / 0.12) : 0;
    this.core.set(2, 0, -0.05, 0, new THREE.Color(1, 0.97, 0.92), burst * 2.2 * level, 1.5 + 8 * (1 - burst));
    this.core.commit(3);
  }
}
