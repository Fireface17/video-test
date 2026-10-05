// Cars (and a trash can) near the camera in the street scenes, rounded and real instead of the city's boxy
// stand-ins: the city's parked cars in the places our cameras go are hidden and replaced by these (same spot,
// heading, paint), and the moving traffic near the lens is redrawn with them every frame. A car is a side profile
// extruded across with rounded edges (wheel arches cut as arcs), a narrower glass cabin, roof and pillars, tyres
// with rims, bumpers, a chrome belt line, door seams, mirrors, head/tail lights (lit by the instance's k).
import * as THREE from 'three';
import { KitBuilder, M, kitBatch } from '../lib/city-build';
import type { City } from '../lib/city';
import { cityKitMat } from './run-props';

/** The city's parked-car paints (lib/city-life.ts CAR_COLORS), so a replaced car keeps its colour. */
const PAINTS: [number, number, number][] = [
  [0.02, 0.02, 0.022], [0.5, 0.5, 0.52], [0.3, 0.31, 0.33], [0.6, 0.6, 0.6], [0.08, 0.1, 0.16], [0.25, 0.03, 0.03], [0.04, 0.04, 0.05], [0.35, 0.33, 0.3],
  [0.62, 0.45, 0.04], [0.62, 0.45, 0.04], [0.1, 0.14, 0.12], [0.45, 0.45, 0.47], [0.02, 0.025, 0.04], [0.15, 0.15, 0.16], [0.62, 0.45, 0.04], [0.55, 0.55, 0.56],
];
export const TAXI_PAINT: [number, number, number] = [0.66, 0.46, 0.03];

function sideExtrude(pts: [number, number][], w: number, bevel: number, curve = 6) {
  const sh = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: w - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curve });
  g.translate(0, 0, -(w - 2 * bevel) / 2);
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}
const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 8): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number]; });

/**
 * A car, nose toward local +x, wheels on y = 0, painted by the instance colour: 0 sedan, 1 SUV, 2 cab (sedan
 * with a roof sign), 3 van. Lights glow with the instance's k (parked: 0).
 */
export function carKit(type: 0 | 1 | 2 | 3) {
  const k = new KitBuilder(), I = new THREE.Matrix4();
  const P = [1, 1, 1, M.TINT], dark = [0.015, 0.015, 0.017, M.ALB], chrome = [0.4, 0.4, 0.42, M.ALB], glass = [0.015, 0.017, 0.02, M.GLASS], rubber = [0.02, 0.02, 0.022, M.ALB];
  const suv = type === 1, van = type === 3;
  const W = van ? 2.0 : suv ? 1.95 : 1.86, R = suv ? 0.42 : 0.38, wx = van ? 1.75 : 1.5, half = van ? 2.6 : suv ? 2.4 : 2.45;
  const belt = van ? 1.2 : suv ? 1.12 : 0.95, top = van ? 2.15 : suv ? 1.75 : 1.42;
  const body: [number, number][] = [
    [-half, 0.3], [-wx - R - 0.06, 0.3], ...arc(-wx, R - 0.02, R + 0.06, Math.PI, 0, 9), [wx - R - 0.06, 0.3], ...arc(wx, R - 0.02, R + 0.06, Math.PI, 0, 9), [half, 0.3],
    [half + 0.05, 0.5], [half, belt - 0.2], [half - 0.18, belt - 0.12], [van ? half - 0.4 : half - 1.2, belt], [-half + 0.8, belt + 0.01], [-half + 0.12, belt - 0.04], [-half - 0.03, belt - 0.2], [-half - 0.05, 0.52],
  ];
  k.add(sideExtrude(body, W, 0.09), I, P);
  // the cabin (glass), its roof and pillars
  const fx = van ? half - 0.45 : suv ? half - 1.15 : half - 1.3, rx = van ? -half + 0.08 : suv ? -half + 0.25 : -half + 0.75;
  const cab: [number, number][] = van
    ? [[fx, belt], [fx - 0.55, top - 0.05], [rx + 0.05, top - 0.05], [rx, belt]]
    : [[fx, belt], [fx - (suv ? 0.75 : 0.85), top - 0.04], [rx + (suv ? 0.15 : 0.8), top - 0.02], [rx, belt]];
  k.add(sideExtrude(cab, W - 0.3, 0.05, 2), I, glass);
  const r0 = cab[1]!, r1 = cab[2]!;
  k.add(sideExtrude([[r0[0] + 0.04, r0[1] - 0.02], [r0[0] - 0.04, r0[1] + 0.06], [r1[0] + 0.04, r1[1] + 0.06], [r1[0] - 0.04, r1[1] - 0.02]], W - 0.26, 0.05, 2), I, P);
  const pillar = (x0: number, y0: number, x1: number, y1: number, wd: number) => {
    const L = Math.hypot(x1 - x0, y1 - y0), ang = Math.atan2(y1 - y0, x1 - x0);
    for (const z of [-(W - 0.3) / 2 - 0.005, (W - 0.3) / 2 + 0.005]) k.box((x0 + x1) / 2, (y0 + y1) / 2, z, L, wd, 0.05, P, 0, 0, ang);
  };
  pillar(cab[0]![0], belt, r0[0], r0[1], 0.07);
  pillar((r0[0] + r1[0]) / 2 + 0.2, belt, (r0[0] + r1[0]) / 2 + 0.2, top, 0.1);
  pillar(cab[3]![0], belt, r1[0], r1[1], van ? 0.1 : 0.14);
  if (van) for (const z of [W / 2 + 0.003, -W / 2 - 0.003]) k.box(-0.5, belt + 0.4, z, 2.6, 0.75, 0.01, P); // the van's panel sides
  // wheels
  for (const x of [wx, -wx]) for (const z of [W / 2 - 0.16, -(W / 2 - 0.16)]) {
    k.cyl(x, R - 0.02, z, R - 0.02, R - 0.02, 0.26, 16, rubber, false, Math.PI / 2);
    k.cyl(x, R - 0.02, z + Math.sign(z) * 0.06, R * 0.58, R * 0.58, 0.15, 12, chrome, false, Math.PI / 2);
  }
  // bumpers, grille, belt line, seams, handles, mirrors
  const bar = new THREE.CapsuleGeometry(0.09, W - 0.22, 2, 8).rotateX(Math.PI / 2);
  k.add(bar, new THREE.Matrix4().makeTranslation(half + 0.08, 0.42, 0), chrome).add(bar, new THREE.Matrix4().makeTranslation(-half - 0.08, 0.42, 0), chrome);
  k.box(half + 0.05, belt - 0.32, 0, 0.04, 0.16, 0.9, dark);
  for (const z of [W / 2 + 0.002, -W / 2 - 0.002]) {
    k.box(0, belt - 0.07, z, 2 * half - 0.8, 0.02, 0.01, chrome);
    for (const x of [fx - 0.1, (r0[0] + r1[0]) / 2 + 0.2]) k.box(x, (belt + 0.35) / 2, z, 0.012, belt - 0.4, 0.012, dark);
    k.box(fx - 0.5, belt - 0.15, z, 0.15, 0.035, 0.03, chrome);
  }
  for (const z of [W / 2 + 0.08, -W / 2 - 0.08]) k.box(fx - 0.15, belt + 0.07, z, 0.1, 0.1, 0.16, P);
  for (const z of [0.6, -0.6]) {
    k.sphere(half + 0.01, belt - 0.27, z, 0.1, [1.6, 1.5, 1.25, M.LIGHT], 0.5, 1, 1.4, 1);
    k.box(-half - 0.03, belt - 0.2, z * 1.05, 0.05, 0.15, 0.32, [1.3, 0.06, 0.03, M.LIGHT]);
  }
  if (type === 2) {
    // the cab's checker band and roof sign
    for (const z of [W / 2 + 0.006, -W / 2 - 0.006]) for (let i = 0; i < 14; i++) k.box(-1.4 + i * 0.2, belt - 0.27, z, 0.1, 0.06, 0.006, i % 2 ? dark : [0.6, 0.6, 0.6, M.ALB]);
    k.add(new THREE.CapsuleGeometry(0.11, 0.8, 2, 8).rotateX(Math.PI / 2).scale(1.4, 1, 1), new THREE.Matrix4().makeTranslation((r0[0] + r1[0]) / 2, top + 0.17, 0), [1.25, 1.0, 0.55, M.LIGHT]);
  }
  return k;
}

/**
 * Instances of the city's kits (anything drawn with kitBatch: parked cars, props) that sit at the given places
 * get scale 0 (hidden). `at`: [x, y, z] (world), matched within 5 cm.
 */
export function hideCityInstances(city: City, at: [number, number, number][]) {
  if (!at.length) return 0;
  city.updateMatrixWorld(true);
  let n = 0;
  const v = new THREE.Vector3();
  city.traverse((o) => {
    const m = o as THREE.Mesh;
    const g = m.geometry as THREE.InstancedBufferGeometry | undefined;
    if (!g || !(g as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) return;
    const ip = g.getAttribute('iPos') as THREE.InstancedBufferAttribute | undefined, is = g.getAttribute('iScale') as THREE.InstancedBufferAttribute | undefined;
    if (!ip || !is || ip.itemSize !== 4) return;
    let hit = false;
    for (let i = 0; i < ip.count; i++) {
      v.set(ip.getX(i), ip.getY(i), ip.getZ(i)).applyMatrix4(m.matrixWorld);
      for (const [x, y, z] of at) {
        if (Math.abs(v.x - x) < 0.05 && Math.abs(v.z - z) < 0.05 && Math.abs(v.y - y) < 0.05) { is.setXYZ(i, 0, 0, 0); hit = true; n++; break; }
      }
    }
    if (hit) is.needsUpdate = true;
  });
  return n;
}

interface MovingBuf { mesh: THREE.Mesh; iPos: THREE.InstancedBufferAttribute; iCol: THREE.InstancedBufferAttribute }

/**
 * The street's cars in our cameras' places: the city's parked cars inside `zones` (x, z, r) replaced by rounded
 * ones; per frame (after city.update) the moving traffic within `near` m of the camera too.
 */
export class StreetCars extends THREE.Group {
  private moving: { type: number; buf: MovingBuf; cap: number }[] = [];

  constructor(public city: City, zones: [number, number, number][], public near = 45) {
    super();
    const plan = city.plan, mat = cityKitMat(city);
    const lists: Record<number, { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number; col: [number, number, number]; k: number }[]> = { 0: [], 1: [], 2: [], 3: [] };
    const hide: [number, number, number][] = [];
    for (const p of plan.parked) {
      if (!zones.some(([x, z, r]) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r)) continue;
      const paint = PAINTS[p.color % PAINTS.length]!, yellow = paint[0] > 0.6 && paint[2] < 0.1;
      const type = p.type === 1 ? 1 : p.type === 3 ? 3 : yellow ? 2 : 0;
      lists[type]!.push({ x: p.x, y: 0, z: p.z, yaw: Math.atan2(-p.dz, p.dx), sx: 1, sy: 1, sz: 1, col: yellow ? TAXI_PAINT : paint, k: 0 });
      hide.push([p.x, 0, p.z]);
    }
    hideCityInstances(city, hide);
    for (const t of [0, 1, 2, 3] as const) {
      const geo = carKit(t).geometry();
      if (lists[t]!.length) {
        const b = kitBatch(geo, lists[t]!, mat, new THREE.Vector3(0, 0, 0), 6);
        b.frustumCulled = false;
        this.add(b);
      }
      // a dynamic batch for the moving cars of this type near the lens
      const cap = 16;
      const blank = Array.from({ length: cap }, () => ({ x: 0, y: -1e4, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1] as [number, number, number], k: 1 }));
      const mb = kitBatch(geo, blank, mat, new THREE.Vector3(0, 0, 0), 6);
      mb.frustumCulled = false;
      const g = mb.geometry as THREE.InstancedBufferGeometry;
      const iPos = g.getAttribute('iPos') as THREE.InstancedBufferAttribute, iCol = g.getAttribute('iCol') as THREE.InstancedBufferAttribute;
      iPos.setUsage(THREE.DynamicDrawUsage); iCol.setUsage(THREE.DynamicDrawUsage);
      g.instanceCount = 0;
      this.add(mb);
      this.moving.push({ type: t, buf: { mesh: mb, iPos, iCol }, cap });
    }
  }

  /** After city.update: take the moving cars near the camera out of the city's buffers and draw them rounded. */
  update(cam: THREE.Vector3) {
    // (lib/city-life.ts keeps the traffic in `carMeshes`: near/far buffers of poses; if that changes, we do nothing)
    const life = this.city.life as unknown as { carMeshes?: { type: number; near: MovingBuf; far: MovingBuf }[] };
    const cms = life.carMeshes;
    const cnt = [0, 0, 0, 0];
    if (cms) {
      const o = this.city.U.uOrigin.value, r2 = this.near * this.near;
      for (const cm of cms) {
        const mine = this.moving.find((m) => m.type === (cm.type === 2 ? 2 : cm.type === 1 ? 1 : cm.type === 3 ? 3 : 0));
        if (!mine) continue;
        for (const b of [cm.near, cm.far]) {
          const g = b.mesh.geometry as THREE.InstancedBufferGeometry, n = g.instanceCount;
          const ip = b.iPos.array as Float32Array, ic = b.iCol.array as Float32Array;
          for (let i = 0; i < n; i++) {
            const x = ip[i * 4]! + o.x, z = ip[i * 4 + 2]! + o.z;
            if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > r2 || ip[i * 4 + 1]! < -100) continue;
            const t = mine.type, c = cnt[t]!;
            if (c >= mine.cap) continue;
            const yaw = ip[i * 4 + 3]!; // atan2(dx, dz): the car's nose along (sin yaw, cos yaw)
            const mp = mine.buf.iPos.array as Float32Array, mc = mine.buf.iCol.array as Float32Array;
            mp.set([x, ip[i * 4 + 1]!, z, yaw - Math.PI / 2], c * 4);
            mc.set([ic[i * 4]!, ic[i * 4 + 1]!, ic[i * 4 + 2]!, 1], c * 4);
            cnt[t] = c + 1;
            ip[i * 4 + 1] = -1e4; // (out of the city's draw for this frame)
          }
          b.iPos.needsUpdate = true;
        }
      }
    }
    for (const m of this.moving) {
      (m.buf.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = cnt[m.type]!;
      m.buf.iPos.needsUpdate = m.buf.iCol.needsUpdate = true;
    }
  }
}

/** A New York litter basket (green wire mesh, a rim) with two smooth black bags by it. Base at y = 0. */
export function trashKit() {
  const k = new KitBuilder();
  const green = [0.06, 0.12, 0.07, M.BARS], rim = [0.06, 0.12, 0.07, M.ALB], bag = [0.012, 0.012, 0.015, M.GLASS];
  k.cyl(0, 0.45, 0, 0.3, 0.26, 0.9, 16, green, true);
  k.cyl(0, 0.9, 0, 0.31, 0.31, 0.05, 16, rim, true);
  k.cyl(0, 0.03, 0, 0.26, 0.26, 0.06, 16, rim);
  k.sphere(0.6, 0.3, 0.1, 0.36, bag, 1, 0.82, 1.1, 3);
  k.sphere(0.95, 0.24, -0.22, 0.28, bag, 1.1, 0.85, 1, 3);
  k.cyl(0.6, 0.62, 0.1, 0.02, 0.07, 0.12, 6, bag);
  return k;
}
