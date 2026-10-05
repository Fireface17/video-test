// The street around the lens in the run (and the scenes that borrow it): the city's litter baskets replaced by
// real ones where our cameras go, and every frame the city's cars near the camera (parked and passing) drawn
// with the refined bodies of run-carbody instead of the city's own (same place, heading, paint, lights).
import * as THREE from 'three';
import { KitBuilder, M, kitBatch } from '../lib/city-build';
import type { City } from '../lib/city';
import { cityKitMat } from './run-props';
import { heroCarGeometry } from './run-carbody';

export const TAXI_PAINT: [number, number, number] = [0.66, 0.46, 0.03];

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
 * The street's cars and litter baskets where our cameras go: the baskets inside `zones` (x, z, r) replaced by
 * real ones (wire mesh, a knotted bag); and every frame (after city.update) the city's cars near the lens —
 * parked within `parked` m, moving within `near` m — taken out of its buffers and drawn with the refined bodies
 * of run-carbody (same place, heading, paint). Parked cars at `exclude` (x, z) are taken out and not redrawn.
 */
export class StreetCars extends THREE.Group {
  private bufs: (MovingBuf & { cap: number })[] = [];
  near: number;
  parked: number;
  exclude: [number, number][];

  constructor(public city: City, zones: [number, number, number][], public o: { near?: number; parked?: number; exclude?: [number, number][] } = {}) {
    super();
    this.near = o.near ?? 45;
    this.parked = o.parked ?? 40;
    this.exclude = o.exclude ?? [];
    const plan = city.plan, mat = cityKitMat(city);
    const hide: [number, number, number][] = [];
    const bins: { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number; col: [number, number, number]; k: number }[] = [];
    for (const p of plan.props) {
      if (p.kind !== 2 || !zones.some(([x, z, r]) => (p.x - x) ** 2 + (p.z - z) ** 2 < r * r)) continue;
      hide.push([p.x, 0.15, p.z]);
      bins.push({ x: p.x, y: 0.15, z: p.z, yaw: p.rot, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0 });
    }
    hideCityInstances(city, hide);
    if (bins.length) { const b = kitBatch(trashKit().geometry(), bins, mat, new THREE.Vector3(0, 0, 0), 3); b.frustumCulled = false; this.add(b); }
    for (const t of [0, 1, 2, 3]) {
      const cap = 40;
      const blank = Array.from({ length: cap }, () => ({ x: 0, y: -1e4, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1] as [number, number, number], k: 1 }));
      const mb = kitBatch(heroCarGeometry(t), blank, mat, new THREE.Vector3(0, 0, 0), 6);
      mb.frustumCulled = false;
      const g = mb.geometry as THREE.InstancedBufferGeometry;
      const iPos = g.getAttribute('iPos') as THREE.InstancedBufferAttribute, iCol = g.getAttribute('iCol') as THREE.InstancedBufferAttribute;
      iPos.setUsage(THREE.DynamicDrawUsage); iCol.setUsage(THREE.DynamicDrawUsage);
      g.instanceCount = 0;
      this.add(mb);
      this.bufs.push({ mesh: mb, iPos, iCol, cap });
    }
  }

  /** After city.update: the city's cars near the camera out of its buffers, drawn with the refined bodies. */
  update(cam: THREE.Vector3) {
    const cnt = [0, 0, 0, 0];
    const put = (t: number, x: number, y: number, z: number, yaw: number, c: ArrayLike<number>, k: number) => {
      const b = this.bufs[t]!, n = cnt[t]!;
      if (n >= b.cap) return false;
      (b.iPos.array as Float32Array).set([x, y, z, yaw], n * 4);
      (b.iCol.array as Float32Array).set([c[0]!, c[1]!, c[2]!, k], n * 4);
      cnt[t] = n + 1;
      return true;
    };
    const taxiLike = (r: number, g: number, b: number) => r > 0.5 && b < 0.12 && g > 0.3;
    // (lib/city-life.ts keeps the traffic in `carMeshes` and the detailed parked cars in `parkedNear`: buffers of
    // poses, yaw = atan2(dx, dz) as here; if those change, nothing is replaced)
    const life = this.city.life as unknown as {
      carMeshes?: { type: number; near: MovingBuf; far: MovingBuf }[];
      parkedNear?: { type: number; mesh: THREE.Mesh; iPos: THREE.InstancedBufferAttribute; iCol: THREE.InstancedBufferAttribute }[];
    };
    const o = this.city.U.uOrigin.value;
    const rM = this.near * this.near, rP = this.parked * this.parked;
    for (const cm of life.carMeshes ?? []) {
      for (const b of [cm.near, cm.far]) {
        const g = b.mesh.geometry as THREE.InstancedBufferGeometry, n = g.instanceCount;
        const ip = b.iPos.array as Float32Array, ic = b.iCol.array as Float32Array;
        let hit = false;
        for (let i = 0; i < n; i++) {
          const x = ip[i * 4]! + o.x, z = ip[i * 4 + 2]! + o.z;
          if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > rM || ip[i * 4 + 1]! < -100) continue;
          const t = cm.type === 2 || (cm.type === 0 && taxiLike(ic[i * 4]!, ic[i * 4 + 1]!, ic[i * 4 + 2]!)) ? 2 : cm.type === 1 ? 1 : cm.type === 3 ? 3 : 0;
          if (!put(t, x, ip[i * 4 + 1]!, z, ip[i * 4 + 3]!, [ic[i * 4]!, ic[i * 4 + 1]!, ic[i * 4 + 2]!], 1)) continue;
          ip[i * 4 + 1] = -1e4; // (out of the city's draw for this frame)
          hit = true;
        }
        if (hit) b.iPos.needsUpdate = true;
      }
    }
    for (const q of life.parkedNear ?? []) {
      const g = q.mesh.geometry as THREE.InstancedBufferGeometry, n = g.instanceCount;
      const ip = q.iPos.array as Float32Array, ic = q.iCol.array as Float32Array;
      let hit = false;
      for (let i = 0; i < n; i++) {
        const x = ip[i * 4]!, z = ip[i * 4 + 2]!;
        if (this.exclude.some(([ex, ez]) => Math.abs(ex - x) < 0.3 && Math.abs(ez - z) < 0.3)) { ip[i * 4 + 1] = -1e4; hit = true; continue; }
        if ((x - cam.x) ** 2 + (z - cam.z) ** 2 > rP) continue;
        const r = ic[i * 4]!, gg = ic[i * 4 + 1]!, bb = ic[i * 4 + 2]!, cab = q.type === 0 && taxiLike(r, gg, bb);
        if (!put(cab ? 2 : q.type, x, ip[i * 4 + 1]!, z, ip[i * 4 + 3]!, cab ? TAXI_PAINT : [r, gg, bb], 0)) continue;
        ip[i * 4 + 1] = -1e4;
        hit = true;
      }
      if (hit) q.iPos.needsUpdate = true;
    }
    this.bufs.forEach((b, t) => {
      (b.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = cnt[t]!;
      b.iPos.needsUpdate = b.iCol.needsUpdate = true;
    });
  }
}

/** A rod (thin box) from a to b. */
function rod(k: KitBuilder, a: THREE.Vector3, b: THREE.Vector3, w: number, v: number[]) {
  const d = b.clone().sub(a), l = d.length();
  if (l < 1e-4) return;
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.divideScalar(l)), new THREE.Vector3(w, l, w));
  k.add(new THREE.BoxGeometry(1, 1, 1), m, v);
}

/**
 * A New York litter basket: green steel wires flaring up from a base ring, hoops round them, a heavy rolled rim;
 * a black liner bag inside (lumpy, its edge folded over the rim, a sheen on it) and a full bag knotted on top.
 * Base at y = 0.
 */
export function trashKit() {
  const k = new KitBuilder();
  const green = [0.045, 0.1, 0.055, M.ALB], bag = [0.01, 0.01, 0.012, M.GLASS];
  const H = 0.88, r0 = 0.24, r1 = 0.31, rAt = (y: number) => r0 + (r1 - r0) * (y / H);
  const ring = (r: number, y: number, tube: number, v: number[], seg = 32) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1));
    k.add(new THREE.TorusGeometry(r, tube, 5, seg), m, v);
  };
  const NW = 30;
  for (let i = 0; i < NW; i++) {
    const a = (i / NW) * Math.PI * 2, a1 = a + (i % 2 ? 0.05 : -0.05);
    rod(k, new THREE.Vector3(Math.cos(a) * rAt(0.06), 0.06, Math.sin(a) * rAt(0.06)), new THREE.Vector3(Math.cos(a1) * rAt(H - 0.02), H - 0.02, Math.sin(a1) * rAt(H - 0.02)), 0.011, green);
  }
  for (const y of [0.06, 0.24, 0.44, 0.64]) ring(rAt(y), y, 0.011, green);
  ring(r1 + 0.005, H, 0.024, green);
  k.cyl(0, 0.035, 0, r0 - 0.01, r0 - 0.01, 0.025, 20, green);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2; k.box(Math.cos(a) * 0.18, 0.012, Math.sin(a) * 0.18, 0.06, 0.024, 0.06, green); }
  // the liner inside, its edge rolled over the rim
  k.sphere(0, 0.47, 0, 1, bag, r0 * 0.96, 0.42, r0 * 0.96, 3, 0.12);
  ring(r1 + 0.012, H - 0.025, 0.032, bag, 24);
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 0.3; k.sphere(Math.cos(a) * (r1 + 0.02), H - 0.07 - 0.03 * (i % 2), Math.sin(a) * (r1 + 0.02), 1, bag, 0.05, 0.07, 0.05, 1, 0.3); }
  // a full bag on top, knotted: lumpy, its knot and the two ears of the tie
  k.sphere(0.03, H + 0.11, -0.02, 1, bag, 0.23, 0.18, 0.21, 3, 0.35);
  k.sphere(0.05, H + 0.3, 0.0, 1, bag, 0.045, 0.06, 0.045, 2, 0.3);
  for (const s of [-1, 1]) k.sphere(0.05 + s * 0.05, H + 0.36, 0.01 * s, 1, bag, 0.05, 0.022, 0.03, 1, 0.2);
  // a coffee cup jammed in beside it
  k.cyl(-0.17, H + 0.06, 0.1, 0.04, 0.03, 0.12, 10, [0.55, 0.52, 0.45, M.ALB]);
  return k;
}
