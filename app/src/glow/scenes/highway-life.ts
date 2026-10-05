// Highway scene, the living details around the road: rain falling through the lamp light, steam rising from
// the storm drains, moths at the lamps, the power line along the highway (lattice pylons, sagging wires,
// blinking red lights) and one span crossing the road, an overpass with its own lamps and a car on it, and the
// roadside signs (exits, services, distance posts).
import * as THREE from 'three';
import { mulberry32, noise1 } from '../../engine/util';
import { SCALE } from '../../engine/gl';
import { F, font } from '../../engine/type';
import { GlowPoints } from '../lib/points';
import { HU, HW_GLSL, ROAD, boxAt, litMat, merge, rod } from './highway-common';
import { canvasTex } from './highway-tex';
import { Streaks } from './highway-env';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const wrap = (x: number, p: number) => ((x % p) + p) % p;
const AMB = new THREE.Color(0.02, 0.024, 0.034);
const h1 = (i: number, s: number) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };

// ------------------------------------------------------------------------------------------- rain

/** Rain around the camera: streaks lit by the streetlights (sodium), our headlights and the screen. */
export class Rain extends Streaks {
  static N = 900;
  constructor() { super(Rain.N); this.renderOrder = 4; }

  /**
   * cam: camera world position; carX / carU: our car (headlights), v: our speed; lampOffU: lamps behind this
   * road coordinate are dark; head: headlights on 0..1; glow: extra light (the screen) as a colour.
   */
  update(cam: THREE.Vector3, t: number, v: number, carX: number, carU: number, lampOffU: number, head: number, glow: THREE.Color, k = 1) {
    if (k <= 0) { this.commit(0); return; }
    const sod = C('#ff9a40'), wh = C('#fff4e6');
    const dt = 0.028;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Color();
    const camU = -cam.z;
    let n = 0;
    for (let i = 0; i < Rain.N; i++) {
      const hx = h1(i, 1), hz = h1(i, 2), hy = h1(i, 3), hv = h1(i, 4);
      const near = i < Rain.N * 0.45; // a dense shell close to the lens, the rest further out
      const X = near ? 9 : 26, Z = near ? 22 : 70;
      const x = cam.x - X / 2 + wrap(hx * X - cam.x, X);
      const u = camU - 4 + wrap(hz * Z - (camU - 4), Z);
      const fall = 7.5 + 2 * hv;
      const y = 10 - wrap(t * fall + hy * 10, 10);
      // light: the two nearest lamps on the median, our headlights ahead of us, the screen's glow
      let lk = 0;
      const k0 = Math.round(u / ROAD.lampP);
      for (let j = -1; j <= 1; j++) {
        const lu = (k0 + j) * ROAD.lampP;
        if (lu < lampOffU) continue;
        for (const sx of [-ROAD.lampArm, ROAD.lampArm]) {
          const d2 = (x - sx) * (x - sx) + (y - ROAD.lampH) * (y - ROAD.lampH) + (u - lu) * (u - lu);
          lk += 14 / (d2 + 6) * Math.max(0, (ROAD.lampH - y) / ROAD.lampH + 0.2);
        }
      }
      c.copy(sod).multiplyScalar(lk * 0.6);
      const ahead = u - carU;
      if (head > 0 && ahead > 1 && ahead < 45 && y < 2.2) {
        const spread = 1.2 + ahead * 0.22;
        const hk = Math.exp(-(((x - carX) / spread) ** 2)) * (1 - ahead / 45) * head;
        c.r += wh.r * hk * 0.8; c.g += wh.g * hk * 0.8; c.b += wh.b * hk * 0.8;
      }
      c.add(glow).add(AMB);
      const dist = Math.hypot(x - cam.x, y - cam.y, u - camU);
      const kk = k * Math.min(1, dist / 1.5);
      a.set(x, y, -u);
      b.set(x + 0.6 * dt, y + fall * dt, -u - v * dt * 0.9);
      this.set(n++, b, a, c, kk * 0.16, 0.0055 + dist * 0.0004);
    }
    this.commit(n);
  }
}

// ------------------------------------------------------------------------------------------- soft puffs

/** Very soft additive sprites (steam, haze blobs): no hot core. */
export class Puffs extends THREE.Points {
  pos: Float32Array; col: Float32Array; siz: Float32Array;
  constructor(public n: number) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(siz, 1).setUsage(THREE.DynamicDrawUsage));
    super(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { pxScale: { value: (1080 * SCALE) / 2 }, uFogD: HU.uFogD },
      vertexShader: /* glsl */ `attribute vec3 color; attribute float psize; uniform float pxScale, uFogD; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
          float px = psize * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
          float m = clamp(px, 1.0, 900.0);
          vC = color * min(1.0, px * px / (m * m)) * smoothstep(0.4, 2.0, d) * exp(-d * uFogD * 0.6);
          gl_PointSize = m; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `varying vec3 vC; void main(){ vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p); if (r2 > 1.0) discard;
          gl_FragColor = vec4(vC * exp(-r2 * 2.6) * (1.0 - r2), 1.0); }`,
    }));
    this.pos = pos; this.col = col; this.siz = siz;
    this.frustumCulled = false;
  }
  set(i: number, x: number, y: number, z: number, c: THREE.Color, k: number, size: number) {
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = c.r * k; this.col[i * 3 + 1] = c.g * k; this.col[i * 3 + 2] = c.b * k; this.siz[i] = size;
  }
  commit(n = this.n) {
    for (const k of ['position', 'color', 'psize']) (this.geometry.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }
}

/** Steam from the storm drains along both edges of our carriageway (and a manhole in the median). */
export class Steam extends THREE.Group {
  puffs = new Puffs(160);
  grates: THREE.InstancedMesh;
  static P = 130; // drain spacing along the road
  static PER = 14;
  constructor() {
    super();
    this.grates = new THREE.InstancedMesh(boxAt(0.9, 0.03, 0.5, 0, 0.012, 0), litMat({ color: C('#2a2c30', 0.5), rough: 0.4, metal: 0.7, spec: 0.8 }), 12);
    this.grates.frustumCulled = false;
    this.add(this.grates, this.puffs);
  }
  update(camU: number, t: number, lampOffU: number, extra: THREE.Color) {
    let n = 0, ng = 0;
    const m = new THREE.Matrix4();
    const k0 = Math.floor((camU - 20) / Steam.P);
    const sod = C('#ff9a40');
    for (let j = 0; j < 6 && n < this.puffs.n - Steam.PER; j++) {
      const k = k0 + j;
      const side = k % 3 === 0 ? 0 : k % 3 === 1 ? 1 : -1;
      const x = side === 0 ? 0.0 : side > 0 ? ROAD.outer + 1.4 : ROAD.inner + 0.5;
      const u = k * Steam.P + 37 + (k % 2) * 23;
      if (ng < 12) { m.makeTranslation(x, 0, -u); this.grates.setMatrixAt(ng++, m); }
      // light on the plume: the nearest lamp (if it is still on) and whatever else is around
      const lu = Math.round(u / ROAD.lampP) * ROAD.lampP;
      const lamp = lu >= lampOffU ? 1 / (1 + ((u - lu) / 18) ** 2) : 0;
      const col = sod.clone().multiplyScalar(0.05 * lamp + 0.004).add(extra.clone().multiplyScalar(0.3));
      for (let p = 0; p < Steam.PER; p++) {
        const age = wrap(t * 0.42 + p / Steam.PER + h1(k, 9), 1);
        const sw = noise1(t * 0.6 + p * 0.37 + k, 3) * 0.5;
        const y = 0.1 + age * 3.2 * (0.8 + 0.4 * h1(p, k));
        const fade = Math.min(1, age / 0.12) * (1 - age) ** 1.6;
        this.puffs.set(n++, x + age * 1.4 + sw * age, y, -u + (h1(p, 4) - 0.5) * 0.6 - age * 0.8, col, fade * (1.5 + 0.7 * h1(p, 5)), 0.3 + age * 1.7);
      }
    }
    for (let i = ng; i < 12; i++) { m.makeScale(0, 0, 0); this.grates.setMatrixAt(i, m); }
    this.grates.instanceMatrix.needsUpdate = true;
    this.puffs.commit(n);
  }
}

// ------------------------------------------------------------------------------------------- moths

export interface MothSource { p: THREE.Vector3; n: number; r: number; k: number; col?: THREE.Color }

/** Moths circling lamps: erratic loops, wings catching the light. */
export class Moths extends GlowPoints {
  constructor() { super(240, 1); }
  update(t: number, sources: MothSource[]) {
    let n = 0;
    sources.forEach((s, si) => {
      for (let j = 0; j < s.n && n < this.n; j++) {
        const sd = si * 31 + j;
        const w1 = 1.6 + 1.4 * h1(sd, 1), w2 = 2.1 + 1.7 * h1(sd, 2), w3 = 5 + 4 * h1(sd, 3);
        const r = s.r * (0.45 + 0.55 * h1(sd, 4));
        const jit = 0.25 * s.r;
        const x = Math.sin(t * w1 + sd) * r + noise1(t * 7 + sd, 1) * jit + Math.sin(t * w3 + sd * 2) * 0.12 * r;
        const y = Math.sin(t * w2 + sd * 3) * r * 0.55 + noise1(t * 6 + sd, 2) * jit;
        const z = Math.cos(t * w1 * 0.9 + sd * 5) * r + noise1(t * 8 + sd, 3) * jit;
        const flap = 0.35 + 0.65 * Math.abs(Math.sin(t * 38 + sd * 1.7));
        this.set(n++, s.p.x + x, s.p.y + y, s.p.z + z, s.col ?? C('#fff1d8'), s.k * flap, 0.035 + 0.02 * h1(sd, 6));
      }
    });
    for (let i = n; i < this.n; i++) this.hide(i);
    this.commit();
  }
}

// ------------------------------------------------------------------------------------------- power lines

/** A lattice transmission tower, 38 m: four legs, cross-bracing, three cross-arms and an earth peak. */
function towerGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const H = 38, base = 4.2, waist = 1.1;
  const leg = (sx: number, sz: number, y: number) => new THREE.Vector3(sx * (base + (waist - base) * Math.min(1, y / 26)), y, sz * (base + (waist - base) * Math.min(1, y / 26)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(rod(leg(sx, sz, 0), leg(sx, sz, 26), 0.16, 0.1, 5), rod(leg(sx, sz, 26), new THREE.Vector3(sx * 0.7, H - 2, sz * 0.7), 0.1, 0.08, 4));
  const levels = [0, 4, 8, 12, 16, 20, 23.5, 26];
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = levels[i]!, y1 = levels[i + 1]!;
    for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]] as const) {
      parts.push(rod(leg(ax, az, y0), leg(bx, bz, y1), 0.05, 0.05, 3), rod(leg(bx, bz, y0), leg(ax, az, y1), 0.05, 0.05, 3));
    }
  }
  // cross-arms (three, the middle one widest) and the earth peak
  for (const [y, w] of [[26, 7.5], [31, 9.5], [36, 6.5]] as const) {
    parts.push(boxAt(w * 2, 0.35, 0.5, 0, y, 0));
    parts.push(rod(new THREE.Vector3(-w, y, 0), new THREE.Vector3(-1.0, y + 2.2, 0), 0.06, 0.06, 3), rod(new THREE.Vector3(w, y, 0), new THREE.Vector3(1.0, y + 2.2, 0), 0.06, 0.06, 3));
    for (const s of [-1, 1]) parts.push(rod(new THREE.Vector3(s * w, y, 0), new THREE.Vector3(s * w, y - 2.4, 0), 0.07, 0.07, 4)); // insulator strings
  }
  parts.push(rod(new THREE.Vector3(0, H - 2, 0), new THREE.Vector3(0, H + 1.5, 0), 0.08, 0.04, 4));
  return merge(parts);
}
const ATTACH: [number, number][] = [[-7.5, 23.6], [7.5, 23.6], [-9.5, 28.6], [9.5, 28.6], [-6.5, 33.6], [6.5, 33.6], [0, 39.4]];

/** Thin camera-facing ribbons (wires), at least ~1.2 px wide with the coverage kept as alpha. */
export class Wires extends THREE.Mesh {
  aA: Float32Array; aB: Float32Array;
  declare geometry: THREE.InstancedBufferGeometry;
  constructor(public cap: number) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const aA = new Float32Array(cap * 3), aB = new Float32Array(cap * 3);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(aA, 3));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(aB, 3));
    super(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { ...HU, rad: { value: 0.016 } },
      vertexShader: /* glsl */ `attribute vec3 iA, iB; uniform float rad; varying float vCov; varying vec3 vW; varying float vY;
        void main(){
          vec3 P = mix(iA, iB, position.x);
          vec4 mv = viewMatrix * vec4(P, 1.0);
          vec3 ax = (viewMatrix * vec4(iB - iA, 0.0)).xyz;
          vec3 cr = cross(normalize(ax + vec3(1e-6)), normalize(mv.xyz)); vec3 side = cr / max(length(cr), 1e-6);
          float d = max(-mv.z, 0.1);
          float px = 2.4 * d / (projectionMatrix[1][1] * 1080.0);
          float w = max(rad, px);
          vCov = rad / w;
          vW = P; vY = position.y;
          mv.xyz += side * position.y * w;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: HW_GLSL + /* glsl */ `varying float vCov; varying vec3 vW; varying float vY;
        void main(){
          vec3 V = vW - cameraPosition; float d = length(V);
          float x = d * uFogD * 0.6; float f = 1.0 - exp(-x * sqrt(x) * 0.85 - x * 0.15);
          float a = vCov * (1.0 - abs(vY)) * 1.6 * (1.0 - f);
          gl_FragColor = vec4(vec3(0.004, 0.004, 0.006), clamp(a, 0.0, 1.0));
        }`,
    }));
    this.aA = aA; this.aB = aB;
    this.frustumCulled = false;
    this.renderOrder = 6;
  }
  setCount(n: number) {
    this.geometry.instanceCount = n;
    (this.geometry.getAttribute('iA') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('iB') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}

/**
 * The power line: pylons along the left verge every ~300 m (and one span crossing the highway at `crossU`),
 * each conductor a catenary between the cross-arms; red lights blink on the tall ones.
 */
export class PowerLine extends THREE.Group {
  towers: THREE.InstancedMesh;
  wires: Wires;
  beacons: GlowPoints;
  tops: THREE.Vector3[] = [];

  constructor(u0: number, u1: number, crossU: number) {
    super();
    const pts: { p: THREE.Vector3; ry: number }[] = [];
    const r = mulberry32(606);
    for (let u = u0; u < u1; u += 290 + r() * 40) pts.push({ p: new THREE.Vector3(-46 - r() * 8, 0, -u), ry: 0 });
    const tg = towerGeometry();
    const cross = [{ p: new THREE.Vector3(-62, 0, -crossU), ry: 0.25 }, { p: new THREE.Vector3(66, 0, -crossU - 34), ry: 0.25 }];
    const all = [...pts, ...cross];
    this.towers = new THREE.InstancedMesh(tg, litMat({ color: C('#6a717a', 0.35), rough: 0.6, metal: 0.5, spec: 0.5, grime: 0.4 }), all.length);
    const m = new THREE.Matrix4();
    all.forEach((t, i) => { m.makeRotationY(t.ry).setPosition(t.p); this.towers.setMatrixAt(i, m); });
    this.towers.frustumCulled = false;
    // wires: along the verge line (towers face the line direction: arms across x)... the line runs along z, so
    // the cross-arms (along x) carry conductors that run along z
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    const span = (A: THREE.Vector3, B: THREE.Vector3, sag: number) => {
      const N = 14;
      let prev = A.clone();
      for (let i = 1; i <= N; i++) {
        const f = i / N;
        const p = A.clone().lerp(B, f);
        p.y -= sag * 4 * f * (1 - f);
        segs.push([prev, p.clone()]);
        prev = p;
      }
    };
    for (let i = 0; i < pts.length - 1; i++) {
      for (const [ax, ay] of ATTACH) span(pts[i]!.p.clone().add(new THREE.Vector3(ax, ay, 0)), pts[i + 1]!.p.clone().add(new THREE.Vector3(ax, ay, 0)), ay > 39 ? 6 : 8.5);
    }
    // the crossing: the arms are turned, the wires run across the road
    const [c0, c1] = cross as [{ p: THREE.Vector3; ry: number }, { p: THREE.Vector3; ry: number }];
    const dir = c1.p.clone().sub(c0.p).normalize();
    const along = (base: THREE.Vector3, ry: number, ax: number, ay: number) => base.clone().add(new THREE.Vector3(ax, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry + Math.PI / 2)).add(new THREE.Vector3(0, ay, 0));
    for (const [ax, ay] of ATTACH) span(along(c0.p, c0.ry, ax, ay), along(c1.p, c1.ry, ax, ay), ay > 39 ? 4 : 6);
    void dir;
    this.wires = new Wires(segs.length);
    segs.forEach(([a, b], i) => { this.wires.aA.set([a.x, a.y, a.z], i * 3); this.wires.aB.set([b.x, b.y, b.z], i * 3); });
    this.wires.setCount(segs.length);
    // the crossing towers turned so their arms span along the wires
    all.forEach((t, i) => { if (i >= pts.length) { m.makeRotationY(t.ry + Math.PI / 2).setPosition(t.p); this.towers.setMatrixAt(i, m); } else { m.makeRotationY(Math.PI / 2).setPosition(t.p); this.towers.setMatrixAt(i, m); } });
    // (along the verge the arms must be across the line direction (z): rotate the tower so its arms lie along x)
    pts.forEach((t, i) => { m.makeRotationY(0).setPosition(t.p); this.towers.setMatrixAt(i, m); });
    this.tops = all.map((t) => t.p.clone().add(new THREE.Vector3(0, 40.2, 0)));
    this.beacons = new GlowPoints(this.tops.length, 1);
    this.add(this.towers, this.wires, this.beacons);
  }
  update(t: number) {
    this.tops.forEach((p, i) => {
      const on = ((t * 0.75 + i * 0.37) % 1) < 0.3 ? 1 : 0.02;
      this.beacons.set(i, p.x, p.y, p.z, C('#ff2a1a'), 2.6 * on, 2.2);
    });
    this.beacons.commit();
  }
}

// ------------------------------------------------------------------------------------------- the overpass

/** A concrete overpass crossing the highway: deck, parapets, piers, its own lamps and a car going over it. */
export class Bridge extends THREE.Group {
  lamps: GlowPoints;
  car: GlowPoints;
  lampXs: number[] = [];
  constructor(conc: THREE.Texture) {
    super();
    const mat = litMat({
      color: C('#8a8f99', 0.42), rough: 0.85, spec: 0.25, map: conc,
      frag: /* glsl */ `alb *= mix(0.5, 1.0, smoothstep(5.8, 6.4, vW.y)) * (0.85 + 0.15 * step(0.08, fract(vW.x / 4.0)));`,
    });
    const parts: THREE.BufferGeometry[] = [];
    const len = 110, deckY = 6.4, th = 1.5, wid = 13;
    parts.push(boxAt(len, th, wid, 0, deckY + th / 2, 0));
    for (const z of [-wid / 2 + 0.2, wid / 2 - 0.2]) parts.push(boxAt(len, 1.1, 0.35, 0, deckY + th + 0.55, z));
    // girders under the deck
    for (const z of [-4.5, -1.5, 1.5, 4.5]) parts.push(boxAt(len, 0.5, 0.7, 0, deckY - 0.2, z));
    // piers: in the median and beyond both verges, with a cap beam each
    for (const x of [0, -18.5, 18.5]) {
      for (const z of [-4, 0, 4]) parts.push(boxAt(1.1, deckY - 0.4, 1.1, x, (deckY - 0.4) / 2, z));
      parts.push(boxAt(1.6, 0.9, wid - 1, x, deckY - 0.85, 0));
    }
    // it carries on as a viaduct into the dark: more spans on piers, stepping down
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) {
        const x0 = s * (len / 2 + k * 40), y = deckY - k * 1.6;
        parts.push(boxAt(40, th, wid, x0 + s * 20, y + th / 2, 0));
        parts.push(boxAt(1.4, y - 0.2, 6, x0 + s * 40, (y - 0.2) / 2, 0));
      }
    }
    this.add(new THREE.Mesh(merge(parts), mat));
    // lamps on the parapet (sodium, like the highway's) and their posts
    const posts: THREE.BufferGeometry[] = [];
    this.lamps = new GlowPoints(16, 1);
    let n = 0;
    for (let x = -45; x <= 45; x += 22.5) {
      posts.push(rod(new THREE.Vector3(x, deckY + th, wid / 2 - 0.3), new THREE.Vector3(x, deckY + th + 6, wid / 2 - 0.3), 0.08, 0.06, 6));
      posts.push(rod(new THREE.Vector3(x, deckY + th + 6, wid / 2 - 0.3), new THREE.Vector3(x, deckY + th + 6.2, wid / 2 - 2.0), 0.05, 0.05, 4));
      this.lamps.set(n++, x, deckY + th + 6.0, wid / 2 - 2.0, C('#ff9a40'), 1.6, 1.4);
    }
    this.lamps.commit();
    this.lampXs = [];
    for (let x = -45; x <= 45; x += 22.5) this.lampXs.push(x);
    this.add(new THREE.Mesh(merge(posts), litMat({ color: C('#7a828e', 0.4), rough: 0.5, metal: 0.6, spec: 0.7 })));
    this.car = new GlowPoints(6, 1);
    this.add(this.lamps, this.car);
  }
  /** `on`: the grid's power at the bridge (its lamps die with the city). */
  update(t: number, on = 1) {
    const deckY = 6.4, th = 1.5, wid = 13;
    this.lampXs.forEach((x, i) => this.lamps.set(i, x, deckY + th + 6.0, wid / 2 - 2.0, C('#ff9a40'), 1.6 * on, 1.4));
    this.lamps.commit();
    // a car crossing from left to right, a van the other way
    const y = 6.4 + 1.5 + 0.7;
    const x1 = -70 + wrap(t * 17, 140), x2 = 70 - wrap(t * 14 + 50, 140);
    this.car.set(0, x1 + 2.3, y, -2.2, C('#fff4e6'), 1.4, 0.5);
    this.car.set(1, x1 + 2.3, y, -1.0, C('#fff4e6'), 1.4, 0.5);
    this.car.set(2, x1 - 2.3, y, -2.2, C('#ff1a10'), 0.9, 0.35);
    this.car.set(3, x2 - 2.5, y + 0.2, 2.2, C('#fff4e6'), 1.2, 0.5);
    this.car.set(4, x2 - 2.5, y + 0.2, 1.0, C('#fff4e6'), 1.2, 0.5);
    this.car.set(5, x2 + 2.5, y + 0.3, 1.6, C('#ff1a10'), 0.8, 0.35);
    this.car.commit();
  }
}

// ------------------------------------------------------------------------------------------- insects

/** Insects caught in our headlights: specks fluttering in the beam, streaking at us as we drive into them. */
export class Insects extends Streaks {
  static N = 70;
  constructor() { super(Insects.N); this.renderOrder = 4; }
  update(t: number, carX: number, carU: number, v: number, head: number) {
    if (head <= 0.01) { this.commit(0); return; }
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Color('#fff1d0');
    let n = 0;
    for (let i = 0; i < Insects.N; i++) {
      // world-anchored (we drive into them), fluttering
      const span = 34;
      const u = carU + 2.5 + wrap(h1(i, 1) * span - carU, span);
      const ahead = u - carU;
      const x = carX + (h1(i, 2) - 0.5) * (2.6 + ahead * 0.12) + noise1(t * 3 + i, 4) * 0.35;
      const y = 0.35 + h1(i, 3) * 1.5 + noise1(t * 2.5 + i * 3, 5) * 0.25;
      const spread = 1.1 + ahead * 0.2;
      const beam = Math.exp(-(((x - carX) / spread) ** 2)) * Math.min(1, ahead / 3) * (1 - ahead / span) * Math.exp(-Math.max(0, y - 1.1) * 1.5);
      const flap = 0.5 + 0.5 * Math.abs(Math.sin(t * 31 + i * 1.3));
      const k = head * beam * flap;
      if (k < 0.02) continue;
      a.set(x, y, -u);
      b.set(x + noise1(t * 5 + i, 6) * 0.02, y, -u + 0.012 * v);
      this.set(n++, a, b, c, 1.4 * k, 0.012);
    }
    this.commit(n);
  }
}

// ------------------------------------------------------------------------------------------- the truck stop

/** A truck stop far off the road: high-mast lights over a yard of parked lorries (marker lights), a lit canopy. */
export class TruckStop extends THREE.Group {
  lights: GlowPoints;
  data: { x: number; y: number; z: number; c: THREE.Color; k: number; s: number; grid: boolean }[] = [];
  constructor() {
    super();
    const r = mulberry32(919);
    const sod = C('#ffa64a'), amber = C('#ff9a2a'), red = C('#ff2a1a'), white = C('#eef4ff');
    // three masts, six lamps each in a ring
    for (const [mx, mz] of [[-60, 0], [10, -40], [70, 10]] as const) {
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; this.data.push({ x: mx + Math.cos(a) * 1.4, y: 30, z: mz + Math.sin(a) * 1.4, c: sod, k: 2.4, s: 3.2, grid: true }); }
      this.data.push({ x: mx, y: 31.5, z: mz, c: red, k: 1.2, s: 1.6, grid: true });
    }
    // rows of parked trucks: marker lights along the trailers, red at the back, cab lights
    for (let row = 0; row < 2; row++) for (let i = 0; i < 9; i++) {
      const x = -70 + i * 17 + (r() - 0.5) * 3, z = -10 + row * 28;
      for (let k = 0; k < 5; k++) this.data.push({ x: x + (r() - 0.5) * 0.3, y: 1.0, z: z - 6 + k * 3, c: amber, k: 0.6, s: 0.9, grid: false });
      this.data.push({ x: x - 1.2, y: 1.0, z: z + 7, c: red, k: 0.9, s: 1.0, grid: false }, { x: x + 1.2, y: 1.0, z: z + 7, c: red, k: 0.9, s: 1.0, grid: false });
      if (r() < 0.4) this.data.push({ x, y: 2.6, z: z - 8, c: white, k: 0.5, s: 1.2, grid: false }); // a cab with its light on
    }
    // the diesel canopy: a strip of white
    for (let k = 0; k < 14; k++) this.data.push({ x: 90 + k * 2.2, y: 5.5, z: -60, c: white, k: 1.1, s: 1.4, grid: true });
    this.lights = new GlowPoints(this.data.length, 1);
    this.add(this.lights);
    this.paint(-1e9, 0);
  }
  /** `frontU`: the blackout front (the yard's lamps die when it passes; the lorries keep their own lights). */
  paint(frontU: number, t: number) {
    const u0 = -this.position.z;
    this.data.forEach((d, i) => {
      const dead = d.grid && u0 - d.z < frontU;
      let k = dead ? 0 : d.k;
      if (d.grid && !dead && frontU > u0 - d.z - 40) k *= Math.sin(t * 47 + i) > 0 ? 1 : 0.1;
      this.lights.set(i, d.x, d.y, d.z, d.c, k, d.s);
    });
    this.lights.commit();
  }
}

// ------------------------------------------------------------------------------------------- road signs

export interface SignSpec { u: number; x: number; lines: string[]; color: string; w: number; h: number; exit?: string }

function signFace(sp: SignSpec) {
  const pw = 1024, ph = Math.round((pw * sp.h) / sp.w);
  const cv = document.createElement('canvas');
  cv.width = pw; cv.height = ph;
  const c = cv.getContext('2d')!;
  c.fillStyle = sp.color; c.fillRect(0, 0, pw, ph);
  c.strokeStyle = '#eef3ef'; c.lineWidth = 12; c.strokeRect(22, 22, pw - 44, ph - 44);
  c.fillStyle = '#eef3ef';
  const n = sp.lines.length;
  sp.lines.forEach((l, i) => {
    const big = i === 0;
    c.font = font(F.archivo(100, big ? 800 : 600), big ? ph * 0.26 : ph * 0.17);
    c.textAlign = 'left';
    c.fillText(l, 70, ph * (0.22 + (0.7 * (i + 0.8)) / n));
  });
  if (sp.exit) {
    c.fillStyle = '#f4d23a'; c.fillRect(pw - 290, 40, 230, 96);
    c.fillStyle = '#111'; c.font = font(F.archivo(87, 900), 66); c.textAlign = 'center'; c.fillText(sp.exit, pw - 175, 112);
  }
  return cv;
}

/** Ground-mounted signs on the verge (retroreflective, lit by headlights) and white distance posts. */
export class RoadSigns extends THREE.Group {
  posts: THREE.InstancedMesh;
  plates: GlowPoints;
  constructor(specs: SignSpec[], u0: number, u1: number) {
    super();
    const steel = litMat({ color: C('#8a929c', 0.4), rough: 0.5, metal: 0.6, spec: 0.7, grime: 0.5 });
    for (const sp of specs) {
      const g = new THREE.Group();
      const tex = canvasTex(signFace(sp), { aniso: 8 });
      const face = new THREE.Mesh(new THREE.PlaneGeometry(sp.w, sp.h), new THREE.ShaderMaterial({
        uniforms: { ...HU, map: { value: tex } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: HW_GLSL + /* glsl */ `uniform sampler2D map; varying vec2 vUv; varying vec3 vW;
          void main(){ vec3 a = texture2D(map, vUv).rgb; vec3 spec;
            vec3 d = hwLight(vW, vec3(0.0, 0.0, 1.0), normalize(cameraPosition - vW), 0.6, 0.0, spec);
            vec3 c = a * (d * 0.7 + 0.012) + a * hwHead(vW, vec3(0.0, 0.0, 1.0)) * 5.0;
            gl_FragColor = vec4(hwFog(c, vW, cameraPosition), 1.0); }`,
      }));
      const y = 2.3 + sp.h / 2;
      face.position.set(0, y, 0.08);
      g.add(face);
      g.add(new THREE.Mesh(merge([
        boxAt(0.14, y + sp.h / 2, 0.14, -sp.w * 0.32, (y + sp.h / 2) / 2, -0.06), boxAt(0.14, y + sp.h / 2, 0.14, sp.w * 0.32, (y + sp.h / 2) / 2, -0.06),
        boxAt(sp.w, sp.h, 0.06, 0, y, 0.02),
      ]), steel));
      g.position.set(sp.x, 0, -sp.u);
      g.rotation.y = sp.x > 0 ? -0.12 : 0.12;
      this.add(g);
    }
    // white distance posts every 100 m on the right verge, each with a small reflector
    const n = Math.ceil((u1 - u0) / 100);
    this.posts = new THREE.InstancedMesh(boxAt(0.12, 1.1, 0.12, 0, 0.55, 0), litMat({ color: C('#e6e8ea', 0.5), rough: 0.6, spec: 0.3 }), n);
    this.plates = new GlowPoints(n, 1);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const u = Math.ceil(u0 / 100) * 100 + i * 100;
      m.makeTranslation(ROAD.rail + 0.9, 0, -u);
      this.posts.setMatrixAt(i, m);
      this.plates.set(i, ROAD.rail + 0.9, 0.95, -u + 0.07, C('#ffb040'), 0.6, 0.12);
    }
    this.plates.commit();
    this.posts.frustumCulled = false;
    this.add(this.posts, this.plates);
    // every post carries a small green plate with the distance (km)
    for (let i = 0; i < n; i++) {
      const u = Math.ceil(u0 / 100) * 100 + i * 100;
      const cv = document.createElement('canvas');
      cv.width = 96; cv.height = 128;
      const c = cv.getContext('2d')!;
      c.fillStyle = '#0d5a33'; c.fillRect(0, 0, 96, 128);
      c.strokeStyle = '#e8efe9'; c.lineWidth = 5; c.strokeRect(5, 5, 86, 118);
      c.fillStyle = '#eef3ef'; c.textAlign = 'center';
      c.font = font(F.archivo(100, 700), 26); c.fillText('km', 48, 44);
      c.font = font(F.archivo(87, 800), 38); c.fillText((41 + u / 1000).toFixed(1), 48, 96);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.4), new THREE.ShaderMaterial({
        uniforms: { ...HU, map: { value: canvasTex(cv, { aniso: 4 }) } },
        vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: HW_GLSL + /* glsl */ `uniform sampler2D map; varying vec2 vUv; varying vec3 vW;
          void main(){ vec3 a = texture2D(map, vUv).rgb; vec3 spec;
            vec3 d = hwLight(vW, vec3(0.0, 0.0, 1.0), normalize(cameraPosition - vW), 0.6, 0.0, spec);
            vec3 c = a * (d * 0.7 + 0.01) + a * hwHead(vW, vec3(0.0, 0.0, 1.0)) * 5.0;
            gl_FragColor = vec4(hwFog(c, vW, cameraPosition), 1.0); }`,
      }));
      plate.position.set(ROAD.rail + 0.9, 1.3, -u + 0.08);
      plate.rotation.y = -0.25;
      this.add(plate);
    }
  }
}
