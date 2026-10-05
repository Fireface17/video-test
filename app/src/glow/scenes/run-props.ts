// Things in the street that the run (chorus 2) touches: a parked taxi to leap over, a smashed shop window
// whose shards rise as stars, pigeons that scatter, water splashing from the wet street under running feet,
// steel stairs. Solid things are built with the city's kits (lib/city-build.ts) so the street light, the glow
// of the people and the fog fall on them like on everything else in the city.
import * as THREE from 'three';
import { KitBuilder, M, kitBatch, kitMaterial } from '../lib/city-build';
import type { City } from '../lib/city';
import { GlowPoints } from '../lib/points';
import { starGeometry } from '../lib/shapes';
import { clamp, hash, mulberry32, smoothstep } from '../../engine/util';

const kitMats = new WeakMap<City, THREE.ShaderMaterial>();
/** The city's kit material (one per city). */
export function cityKitMat(city: City) {
  let m = kitMats.get(city);
  if (!m) { m = kitMaterial(city.U, { side: THREE.DoubleSide }); kitMats.set(city, m); }
  return m;
}

/** One kit placed in the city at (x, y, z), turned by yaw (local +x → world (cos yaw, 0, −sin yaw)). */
export function placeKit(city: City, k: KitBuilder, x: number, y: number, z: number, yaw = 0, light = 1) {
  const m = kitBatch(k.geometry(), [{ x, y, z, yaw, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: light }], cityKitMat(city), new THREE.Vector3(x, 0, z), 6);
  m.frustumCulled = false;
  return m;
}

/**
 * Render with a floating origin: the scene's world (everything in `root`, which holds the city) is shifted so
 * the camera sits near the origin for the draw, then put back. People of light far from the origin (x ≈ 1150 m)
 * otherwise lose float precision in their skinning: their depth prepass and colour pass disagree and the glass
 * bodies show black holes. All scene logic stays in the city's (plan) coordinates.
 */
export function shiftRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, root: THREE.Object3D, city: City | null, out: THREE.WebGLRenderTarget, bg: THREE.Color) {
  const O = new THREE.Vector3(Math.round(cam.position.x), 0, Math.round(cam.position.z));
  root.position.sub(O);
  cam.position.sub(O);
  root.updateMatrixWorld(true);
  cam.updateMatrixWorld();
  if (city) {
    const U = city.U;
    U.uOrigin.value.setFromMatrixPosition(city.matrixWorld);
    for (let i = 0; i < U.uPGlowN.value; i++) { const p = U.uPGlowP.value[i]!; p.x -= O.x; p.z -= O.z; }
  }
  renderer.setRenderTarget(out);
  renderer.setClearColor(bg, 1);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);
  root.position.add(O);
  cam.position.add(O);
  root.updateMatrixWorld(true);
  cam.updateMatrixWorld();
  if (city) city.U.uOrigin.value.setFromMatrixPosition(city.matrixWorld);
}

/** Leave these out of the city's wet-street reflection (it renders the scene a second time; they are costly or tiny). */
export function mirrorOnly(city: City, hide: THREE.Object3D[]) {
  // (the reflection is rendered from inside an onBeforeRender of one of the city's children: wrap them all)
  const noop = THREE.Object3D.prototype.onBeforeRender;
  city.traverse((g) => {
    if (g.onBeforeRender === noop || (g as { __mo?: boolean }).__mo) return;
    const orig = g.onBeforeRender;
    (g as { __mo?: boolean }).__mo = true;
    g.onBeforeRender = function (this: THREE.Object3D, ...args: Parameters<THREE.Object3D['onBeforeRender']>) {
      const vis = hide.map((o) => o.visible);
      hide.forEach((o) => (o.visible = false));
      orig.apply(g, args);
      hide.forEach((o, i) => (o.visible = vis[i]!));
    };
  });
}

/** A side profile (x along the car, y up) extruded across it (width w, centred on z = 0), edges rounded. */
function sideExtrude(pts: [number, number][], w: number, bevel: number, curve = 6) {
  const sh = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: w - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: curve });
  g.translate(0, 0, -(w - 2 * bevel) / 2);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
/** Points along an arc (centre cx, cy; radius r; angles a0 → a1). */
function arc(cx: number, cy: number, r: number, a0: number, a1: number, n = 8): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number]; });
}

/**
 * A New York cab (a big sedan), nose toward local +x, 5.2 m long, wheels on y = 0: a rounded body with wheel
 * arches, a sloped windshield and rear window (glass reflecting the street), the cabin's pillars and roof, tyres
 * with rims, chrome bumpers and belt line, door seams, mirrors, head- and taillights, the lit roof sign.
 */
export function taxiKit(paint: [number, number, number] = [0.62, 0.4, 0.035]) {
  const k = new KitBuilder();
  const P = [...paint, M.ALB], dark = [0.015, 0.015, 0.017, M.ALB], chrome = [0.42, 0.42, 0.44, M.ALB], glass = [0.015, 0.017, 0.02, M.GLASS], rubber = [0.02, 0.02, 0.022, M.ALB];
  const I = new THREE.Matrix4();
  const W = 1.9, R = 0.4, wx = 1.6;
  // the body up to the belt line: the hood sloping down to the nose, the trunk, the arches cut out
  const body: [number, number][] = [
    [-2.6, 0.3], [-wx - R - 0.06, 0.3], ...arc(-wx, 0.36, R + 0.06, Math.PI, 0, 9), [wx - R - 0.06, 0.3], ...arc(wx, 0.36, R + 0.06, Math.PI, 0, 9), [2.6, 0.3],
    [2.66, 0.5], [2.6, 0.74], [2.42, 0.82], [1.25, 0.95], [0.9, 0.97], [-1.75, 0.98], [-2.48, 0.94], [-2.62, 0.78], [-2.64, 0.52],
  ];
  k.add(sideExtrude(body, W, 0.09), I, P);
  // the cabin: glass all round, then the roof and the pillars over it
  const cab: [number, number][] = [[1.18, 0.96], [0.32, 1.4], [-0.9, 1.42], [-1.72, 0.98]];
  k.add(sideExtrude(cab, W - 0.34, 0.05, 2), I, glass);
  k.add(sideExtrude([[0.38, 1.38], [0.3, 1.45], [-0.92, 1.47], [-0.98, 1.4]], W - 0.3, 0.05, 2), I, P);
  const pillar = (x0: number, y0: number, x1: number, y1: number, wdt: number) => {
    const L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0);
    for (const z of [-(W - 0.34) / 2 - 0.005, (W - 0.34) / 2 + 0.005]) k.box((x0 + x1) / 2, (y0 + y1) / 2, z, L, wdt, 0.05, P, 0, 0, ang);
  };
  pillar(1.18, 0.97, 0.32, 1.41, 0.07); // A
  pillar(-0.32, 0.98, -0.32, 1.43, 0.1); // B
  pillar(-1.72, 0.99, -0.92, 1.42, 0.12); // C
  // wheels: tyres, rims, hub caps
  for (const x of [wx, -wx]) for (const z of [W / 2 - 0.16, -(W / 2 - 0.16)]) {
    k.cyl(x, 0.36, z, 0.36, 0.36, 0.25, 18, rubber, false, Math.PI / 2);
    k.cyl(x, 0.36, z + Math.sign(z) * 0.06, 0.22, 0.22, 0.15, 14, chrome, false, Math.PI / 2);
    k.cyl(x, 0.36, z + Math.sign(z) * 0.13, 0.08, 0.1, 0.02, 10, [0.6, 0.6, 0.62, M.ALB], false, Math.PI / 2);
  }
  // bumpers (rounded bars), the grille, the belt line, door seams and handles, mirrors
  const bar = new THREE.CapsuleGeometry(0.1, W - 0.2, 3, 8).rotateX(Math.PI / 2);
  k.add(bar, new THREE.Matrix4().makeTranslation(2.68, 0.42, 0), chrome).add(bar, new THREE.Matrix4().makeTranslation(-2.68, 0.42, 0), chrome);
  k.box(2.66, 0.65, 0, 0.04, 0.16, 0.95, dark);
  for (let i = 0; i < 6; i++) k.box(2.675, 0.59 + i * 0.025, 0, 0.02, 0.008, 0.9, chrome);
  for (const z of [W / 2 + 0.002, -W / 2 - 0.002]) {
    k.box(-0.4, 0.88, z, 3.9, 0.025, 0.01, chrome);
    for (const x of [1.08, -0.33, -1.72]) k.box(x, 0.62, z, 0.012, 0.6, 0.012, dark);
    for (const x of [0.22, -1.1]) k.box(x, 0.8, z, 0.16, 0.035, 0.03, chrome);
    k.box(-0.35, 0.68, z, 2.8, 0.06, 0.008, [0.04, 0.04, 0.04, M.ALB]); // the checker band's base
    for (let i = 0; i < 14; i++) k.box(-1.5 + i * 0.2, 0.68, z + Math.sign(z) * 0.004, 0.1, 0.06, 0.006, i % 2 ? dark : [0.6, 0.6, 0.6, M.ALB]);
  }
  for (const z of [W / 2 + 0.08, -W / 2 - 0.08]) k.box(1.0, 1.03, z, 0.1, 0.1, 0.16, P);
  // head- and taillights, the indicator, the roof sign (lit: the cab is free)
  for (const z of [0.62, -0.62]) {
    k.sphere(2.62, 0.66, z, 0.1, [1.6, 1.5, 1.25, M.LIGHT], 0.5, 1, 1.4, 1);
    k.box(2.6, 0.5, z * 1.15, 0.05, 0.06, 0.18, [1.2, 0.55, 0.05, M.LIGHT]);
    k.box(-2.62, 0.72, z * 1.05, 0.05, 0.16, 0.34, [1.3, 0.06, 0.03, M.LIGHT]);
  }
  k.add(new THREE.CapsuleGeometry(0.12, 0.85, 3, 8).rotateX(Math.PI / 2).scale(1.4, 1, 1), new THREE.Matrix4().makeTranslation(-0.3, 1.6, 0), [1.25, 1.0, 0.55, M.LIGHT]);
  k.box(-0.3, 1.49, 0, 0.12, 0.06, 0.5, dark);
  return k;
}

/** A straight steel stair from a (top) to b (bottom), width w, with treads, stringers and railings. */
export function stairKit(a: THREE.Vector3, b: THREE.Vector3, w: number) {
  const k = new KitBuilder();
  const IR = [0.05, 0.055, 0.06, M.ALB], tread = [0.11, 0.11, 0.115, M.ALB];
  const d = new THREE.Vector3().subVectors(b, a), run = Math.hypot(d.x, d.z), rise = a.y - b.y;
  const yaw = Math.atan2(-d.z, d.x); // local +x along the run (a → b)
  const n = Math.max(2, Math.round(rise / 0.18)), sh = rise / n, sd = run / n;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (u: number, y: number, v: number): [number, number, number] => [a.x + c * u + s * v, a.y + y, a.z - s * u + c * v];
  for (let i = 0; i < n; i++) {
    const [x, y, z] = P((i + 0.5) * sd, -(i + 1) * sh + 0.02, 0);
    k.box(x, y, z, sd * 1.05, 0.04, w, tread, yaw);
    k.box(...P((i + 1) * sd, -(i + 1) * sh + 0.1 - 0.02, 0), 0.02, sh * 0.6, w * 0.98, IR, yaw);
  }
  const L = Math.hypot(run, rise), slope = Math.atan2(rise, run);
  for (const side of [-1, 1]) {
    const v = side * (w / 2 + 0.03);
    const [x, y, z] = P(run / 2, -rise / 2 - 0.12, v);
    k.box(x, y, z, L, 0.3, 0.04, IR, yaw, 0, -slope);
    const [rx, ry, rz] = P(run / 2, -rise / 2 + 0.95, v);
    k.box(rx, ry, rz, L, 0.05, 0.05, IR, yaw, 0, -slope);
    for (let i = 0; i <= 4; i++) {
      const u = (i / 4) * run, [px, py, pz] = P(u, -(u / run) * rise + 0.47, v);
      k.box(px, py, pz, 0.04, 0.95, 0.04, IR, yaw);
    }
  }
  return k;
}

/**
 * A smashed shop window: what is left of the pane (dark glass with a jagged hole), and the shards — some still
 * in the frame, most on the pavement — that rise, turn into glowing five-pointed stars, and float up.
 * The window faces `n` (outward), its bottom centre at `base`, size w × h.
 */
export class BrokenWindow extends THREE.Group {
  shards: THREE.InstancedMesh;
  stars: THREE.InstancedMesh;
  halos: GlowPoints;
  items: { p0: THREE.Vector3; r0: THREE.Euler; s: number; t0: number; drift: THREE.Vector3; spin: number }[] = [];
  private starMat: THREE.MeshBasicMaterial;

  constructor(city: City, public base: THREE.Vector3, public n: THREE.Vector3, w: number, h: number, public tLift: number, public tStar: number, count = 70, public color = new THREE.Color(1.6, 1.5, 1.2)) {
    super();
    const r = mulberry32(4242);
    const tx = new THREE.Vector3(n.z, 0, -n.x); // along the facade
    // the pane: a frame of glass around a jagged hole (a fan of triangles from the hole's outline to the frame)
    const k = new KitBuilder();
    const glass = [0.025, 0.028, 0.034, M.GLASS], frame = [0.06, 0.06, 0.065, M.ALB];
    const cx = 0, cy = h * 0.52, hole: [number, number][] = [];
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, rr = (0.45 + 0.55 * r()) * (i % 3 === 0 ? 1.15 : 0.85);
      hole.push([cx + Math.cos(a) * rr * w * 0.42, cy + Math.sin(a) * rr * h * 0.4]);
    }
    const W = (u: number, v: number): number[] => [base.x + tx.x * u + n.x * 0.14, base.y + v, base.z + tx.z * u + n.z * 0.14];
    for (let i = 0; i < N; i++) {
      const [u0, v0] = hole[i]!, [u1, v1] = hole[(i + 1) % N]!;
      // project each hole vertex out to the frame rectangle
      const out = (u: number, v: number) => { const s = Math.min((w / 2) / Math.max(Math.abs(u), 1e-3), (h / 2) / Math.max(Math.abs(v - cy), 1e-3)); return [u * s, cy + (v - cy) * s] as [number, number]; };
      const [U0, V0] = out(u0, v0), [U1, V1] = out(u1, v1);
      k.poly4(W(u0, v0), W(U0, V0), W(U1, V1), W(u1, v1), glass);
    }
    k.box(base.x + n.x * 0.04, base.y + h + 0.04, base.z + n.z * 0.04, Math.abs(tx.x) * w + Math.abs(n.x) * 0.1 + 0.08, 0.08, Math.abs(tx.z) * w + Math.abs(n.z) * 0.1 + 0.08, frame);
    k.box(base.x + n.x * 0.04, base.y - 0.04, base.z + n.z * 0.04, Math.abs(tx.x) * w + Math.abs(n.x) * 0.1 + 0.08, 0.08, Math.abs(tx.z) * w + Math.abs(n.z) * 0.1 + 0.08, frame);
    // behind the glass, the empty shop: dark walls, a little street light on its floor
    const inC = [0.012, 0.012, 0.014, M.ALB];
    const B = (u: number, v: number, dn: number): number[] => [base.x + tx.x * u - n.x * dn, base.y + v, base.z + tx.z * u - n.z * dn];
    k.poly4(B(-w / 2, 0, 0.0), B(w / 2, 0, 0.0), B(w / 2, 0, 3), B(-w / 2, 0, 3), [0.05, 0.045, 0.04, M.ALB]);
    k.poly4(B(-w / 2, h, 3), B(w / 2, h, 3), B(w / 2, 0, 3), B(-w / 2, 0, 3), inC);
    k.poly4(B(-w / 2, h, 0), B(-w / 2, h, 3), B(-w / 2, 0, 3), B(-w / 2, 0, 0), inC);
    k.poly4(B(w / 2, h, 3), B(w / 2, h, 0), B(w / 2, 0, 0), B(w / 2, 0, 3), inC);
    k.poly4(B(-w / 2, h, 0), B(w / 2, h, 0), B(w / 2, h, 3), B(-w / 2, h, 3), inC);
    const mesh = kitBatch(k.geometry(), [{ x: 0, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 1 }], cityKitMat(city), new THREE.Vector3(0, 0, 0), 8);
    mesh.frustumCulled = false;
    this.add(mesh);
    // shards: thin triangles of glass (catching the light), later stars
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.5, 0, -0.35, -0.4, 0, 0.42, -0.3, 0], 3));
    tri.computeVertexNormals();
    this.shards = new THREE.InstancedMesh(tri, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.16, 0.18, 0.22), side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), count);
    this.starMat = new THREE.MeshBasicMaterial({ color: color.clone() });
    this.stars = new THREE.InstancedMesh(starGeometry(0.15, 0.04), this.starMat, count);
    this.halos = new GlowPoints(count, 0.06);
    this.shards.frustumCulled = this.stars.frustumCulled = false;
    this.add(this.shards, this.stars, this.halos);
    for (let i = 0; i < count; i++) {
      const inFrame = i < count * 0.3;
      const p0 = inFrame
        ? W((r() - 0.5) * w * 0.9, h * (0.1 + r() * 0.8)).reduce((v, x, j) => (v.setComponent(j, x), v), new THREE.Vector3())
        : base.clone().addScaledVector(tx, (r() - 0.5) * w * 1.3).addScaledVector(n, 0.15 + Math.pow(r(), 1.5) * 2.4).setY(0.17);
      if (!inFrame) p0.y = base.y < 0.5 ? 0.17 : base.y;
      this.items.push({
        p0, r0: inFrame ? new THREE.Euler(0, Math.atan2(n.x, n.z), r() * 6) : new THREE.Euler(-Math.PI / 2 + (r() - 0.5) * 0.3, 0, r() * 6),
        s: 0.04 + r() * r() * 0.1, t0: tLift + r() * 0.9 + (inFrame ? 0.2 : 0),
        drift: new THREE.Vector3((r() - 0.5) * 1.2, 2.2 + r() * 2.5, (r() - 0.5) * 1.2).addScaledVector(n, 0.6 + r()),
        spin: (r() - 0.5) * 4,
      });
    }
  }

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _p = new THREE.Vector3();
  private _s = new THREE.Vector3();

  update(t: number, cam: THREE.Camera) {
    const camQ = cam.quaternion;
    this.items.forEach((it, i) => {
      const a = Math.max(0, t - it.t0);
      // lift: a slow start, then floating up and out, turning
      const up = smoothstep(0, 0.6, a);
      const p = this._p.copy(it.p0).addScaledVector(it.drift, (a * 0.35 + 0.08 * a * a) * up);
      p.y += Math.sin(a * 2 + i) * 0.05 * up;
      // shard → star: the glass fades as the star grows (by tStar all are stars)
      const k = clamp((t - (it.t0 + 0.35)) / Math.max(0.3, this.tStar - it.t0 - 0.35));
      const ks = k * k * (3 - 2 * k);
      this._q.setFromEuler(it.r0);
      if (a > 0) this._q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), it.spin * a)).slerp(camQ, ks * 0.85);
      this._m.compose(p, this._q, this._s.setScalar(it.s * 2.2 * (1 - ks) + 1e-4));
      this.shards.setMatrixAt(i, this._m);
      this._m.compose(p, this._q, this._s.setScalar(it.s * 0.9 * ks + 1e-4));
      this.stars.setMatrixAt(i, this._m);
      const tw = 0.7 + 0.3 * Math.sin(t * 7 + i * 2.3);
      this.halos.set(i, p.x, p.y, p.z, this.color, (0.1 * up * (1 - ks) + 0.8 * ks) * tw, 0.6 + it.s * 6);
    });
    this.shards.instanceMatrix.needsUpdate = this.stars.instanceMatrix.needsUpdate = true;
    this.halos.commit();
  }
}

/** Pigeons on the pavement that burst up and away when the runners come near (each at its own time). */
export class Pigeons extends THREE.Group {
  body: THREE.InstancedMesh;
  wings: THREE.InstancedMesh;
  birds: { p: THREE.Vector3; yaw: number; t0: number; dir: THREE.Vector3; seed: number }[] = [];

  constructor(list: { p: THREE.Vector3; t0: number; away: THREE.Vector3 }[], light: THREE.Color) {
    super();
    const bg = new THREE.SphereGeometry(1, 8, 6);
    bg.scale(0.09, 0.075, 0.16);
    const head = new THREE.SphereGeometry(0.045, 6, 5);
    head.translate(0, 0.07, 0.13);
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.08, 0, 0, -0.1, 0.32, 0, -0.05, 0, 0, 0.08, 0, 0, -0.1, -0.32, 0, -0.05], 3));
    wing.computeVertexNormals();
    const mat = new THREE.MeshBasicMaterial({ color: light.clone().multiplyScalar(0.08).add(new THREE.Color(0.012, 0.013, 0.016)), side: THREE.DoubleSide, fog: true });
    const merged = new THREE.BufferGeometry();
    const pos = [...(bg.toNonIndexed().attributes.position!.array as Float32Array), ...(head.toNonIndexed().attributes.position!.array as Float32Array)];
    merged.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.body = new THREE.InstancedMesh(merged, mat, list.length);
    this.wings = new THREE.InstancedMesh(wing, mat, list.length * 2);
    this.body.frustumCulled = this.wings.frustumCulled = false;
    this.add(this.body, this.wings);
    list.forEach((b, i) => this.birds.push({ p: b.p.clone(), yaw: hash(i, 3) * 6.28, t0: b.t0, dir: b.away.clone().normalize(), seed: hash(i, 9) }));
  }

  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler();

  update(t: number) {
    this.birds.forEach((b, i) => {
      const a = t - b.t0;
      const p = b.p.clone();
      let yaw = b.yaw + 0.3 * Math.sin(t * 1.3 + i), pitch = 0, flap = 0.15;
      if (a < 0) {
        // pecking about
        p.y += 0.0;
        pitch = 0.35 * Math.max(0, Math.sin(t * 3.1 + b.seed * 20)) ** 4;
      } else {
        const d = b.dir.clone().multiplyScalar(2.2 * a + 1.8 * a * a);
        d.y = 1.6 * a + 1.2 * a * a;
        p.add(d);
        yaw = Math.atan2(b.dir.x, b.dir.z);
        pitch = -0.5;
        flap = Math.sin(a * 38 + b.seed * 6) * 0.9;
      }
      this._q.setFromEuler(this._e.set(pitch, yaw, 0, 'YXZ'));
      this._m.compose(p, this._q, new THREE.Vector3(1, 1, 1));
      this.body.setMatrixAt(i, this._m);
      for (const s of [0, 1]) {
        const q = this._q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (s ? -1 : 1) * flap));
        this._m.compose(p, q, new THREE.Vector3(s ? -1 : 1, 1, 1).multiplyScalar(a < 0 ? 0.35 : 1));
        this.wings.setMatrixAt(i * 2 + s, this._m);
      }
    });
    this.body.instanceMatrix.needsUpdate = this.wings.instanceMatrix.needsUpdate = true;
  }
}

/** Water thrown up from the wet street by running feet: droplets in the street light (GlowPoints). */
export class Splashes extends GlowPoints {
  hits: { p: THREE.Vector3; t: number; c: THREE.Color; k: number }[] = [];
  constructor(public per = 10) { super(1, 0.03); }

  /** Register a footfall (place, time, the light it catches). */
  hit(p: THREE.Vector3, t: number, c: THREE.Color, k = 1) { this.hits.push({ p: p.clone(), t, c: c.clone(), k }); }

  build() {
    const n = this.hits.length * this.per;
    const g = this.geometry;
    for (const k of ['position', 'color', 'psize']) {
      const sz = k === 'psize' ? 1 : 3;
      g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n * sz), sz).setUsage(THREE.DynamicDrawUsage));
    }
    this.pos = g.getAttribute('position').array as Float32Array;
    this.colors = g.getAttribute('color').array as Float32Array;
    this.sizes = g.getAttribute('psize').array as Float32Array;
    this.n = n;
  }

  update(t: number) {
    let j = 0;
    this.hits.forEach((h, hi) => {
      const a = t - h.t;
      for (let i = 0; i < this.per; i++, j++) {
        if (a < 0 || a > 0.55) { this.hide(j); continue; }
        const r1 = hash(hi, i, 1), r2 = hash(hi, i, 2), r3 = hash(hi, i, 3);
        const ang = r1 * Math.PI * 2, sp = 0.6 + r2 * 1.3, up = 1.2 + r3 * 1.6;
        const x = h.p.x + Math.cos(ang) * sp * a, z = h.p.z + Math.sin(ang) * sp * a, y = h.p.y + 0.02 + up * a - 4.9 * a * a;
        if (y < h.p.y) { this.hide(j); continue; }
        this.set(j, x, y, z, h.c, h.k * (1 - a / 0.55), 0.6 + r2);
      }
    });
    this.commit(j);
  }
}
