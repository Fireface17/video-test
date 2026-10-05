// The overpass where they stand, dressed for the close shots of the break (scenes/overpass.ts): the walkway's
// paving, the coping and the deck's fascia in cast concrete (formwork joints, stains, rust under the posts), the
// jersey barrier with its amber reflectors, the asphalt of the lanes (lane paint, cracks, oil, an expansion
// joint, puddles), a proper railing (posts, base plates, a top rail), pedestrian lamps on the barrier with their
// halos, an overhead sign gantry, an emergency call box; across the river the far bank — a skyline of lit
// windows, its shore lights and their reflections in the water — and boats. All in the city's coordinates.
import * as THREE from 'three';
import { KitBuilder, M, kitBatch } from '../lib/city-build';
import type { City } from '../lib/city';
import { GlowPoints } from '../lib/points';
import { F, font } from '../../engine/type';
import { hash, mulberry32 } from '../../engine/util';
import { cityKitMat } from './run-props';
import { SURF, SurfLights, floorRect, profileRun, surfBox, surfaceMaterial } from './run-surfaces';
import { hideCityInstances } from './run-cars';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function signTexture(lines: [string, number][], w = 1024, h = 512, arrow = '') {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#0b5a2e';
  c.fillRect(0, 0, w, h);
  c.strokeStyle = '#e8efe8'; c.lineWidth = 10;
  c.strokeRect(14, 14, w - 28, h - 28);
  c.fillStyle = '#eef3ee';
  c.textBaseline = 'middle';
  let y = h * 0.3;
  for (const [s, px] of lines) { c.font = font(F.archivo(87.5, 700), px); c.fillText(s, 48, y); y += px * 1.25; }
  if (arrow) { c.font = font(F.archivo(100, 800), 150); c.textAlign = 'right'; c.fillText(arrow, w - 50, h * 0.55); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class DeckDress extends THREE.Group {
  lights = new SurfLights();
  halos = new GlowPoints(16, 1.0);
  heads = new GlowPoints(16, 0.25);
  shore = new GlowPoints(900, 1.2);
  boats = new GlowPoints(12, 0.6);
  callLight = new GlowPoints(1, 0.12);
  lampHeads: THREE.Vector3[] = [];
  private shoreList: { p: THREE.Vector3; c: THREE.Color; k: number; refl: boolean; seed: number }[] = [];
  private signMats: THREE.MeshBasicMaterial[] = [];

  /** The first index of SurfLights free for the caller (after the lamps). */
  get free() { return this.lampHeads.length; }
  private callZ: number;

  /**
   * railX: the walkway's west edge (the railing); y the deck; z0..z1 the stretch dressed; gaps in the railing;
   * where the pedestrian lamps, the sign gantry (its signs facing -z, the traffic coming north) and the call box go.
   */
  constructor(public city: City, public railX: number, public y: number, z0: number, z1: number, gaps: [number, number][], o: { lamps: number[]; gantry: number; call: number }) {
    super();
    this.callZ = o.call;
    const L = this.lights, Y = y, zc = (z0 + z1) / 2, len = z1 - z0;
    const conc = surfaceMaterial(city, SURF.CONCRETE, L, { street: 0, wet: 0.5, alb: new THREE.Color(0.17, 0.175, 0.18) });
    const slabs = surfaceMaterial(city, SURF.SLABS, L, { street: 0, wet: 0.55, alb: new THREE.Color(0.2, 0.2, 0.2) });
    const asph = surfaceMaterial(city, SURF.ASPHALT, L, { street: 0, wet: 0.6, lanesFrom: railX });
    // the walkway, the coping, the fascia, the barrier, the lanes
    this.add(floorRect(railX + 0.41, z0, railX + 2.97, z1, Y + 0.012, slabs));
    this.add(surfBox(railX + 0.2, Y + 0.127, zc, 0.43, 0.27, len, conc));
    this.add(surfBox(railX - 0.02, Y - 0.46, zc, 0.05, 0.94, len, conc));
    // the jersey barrier between the walkway and the lanes (in place of the city's box), its whole length
    const ovb = city.overpass as { z0: number; z1: number; walk?: [number, number] } | null;
    const bz0 = Math.min(z0, ovb?.z0 ?? z0), bz1 = Math.max(z1, ovb?.z1 ?? z1);
    if (ovb?.walk) hideCityInstances(city, [[ovb.walk[0] + 3.2, Y, (ovb.z0 + ovb.z1) / 2]]);
    const jersey: [number, number][] = [[-0.31, -0.01], [-0.31, 0.08], [-0.2, 0.33], [-0.09, 0.88], [-0.07, 0.92], [0.07, 0.92], [0.09, 0.88], [0.2, 0.33], [0.31, 0.08], [0.31, -0.01]];
    this.add(profileRun(jersey, railX + 3.2, Y, bz0, bz1, conc));
    this.add(floorRect(railX + 3.45, z0, railX + 21.55, z1, Y + 0.012, asph));
    // the railing (it replaces the city's bar panels on the coping): square posts on base plates every 2 m, a round
    // top rail, a bottom rail, pickets every 12.5 cm along the stretch dressed; beyond it posts, rails and the
    // city's bar pattern, out to the overpass's ends
    const k = new KitBuilder(), steel = [0.07, 0.085, 0.08, M.ALB], plate = [0.09, 0.09, 0.095, M.ALB], picket = [0.06, 0.07, 0.068, M.ALB];
    const ovi = city.overpass as { z0: number; z1: number; walk?: [number, number] } | null;
    const zA = Math.min(z0, ovi?.z0 ?? z0), zB = Math.max(z1, ovi?.z1 ?? z1);
    const sortedGaps = [...gaps].sort((p, q) => p[0] - q[0]);
    const runsOf = (a0: number, b0: number) => {
      const out: [number, number][] = [];
      let a = a0;
      for (const [g0, g1] of sortedGaps) { if (g1 <= a0 || g0 >= b0) continue; if (g0 > a) out.push([a, g0]); a = Math.max(a, g1); }
      if (b0 > a) out.push([a, b0]);
      return out;
    };
    if (ovi?.walk) hideCityInstances(city, runsOf(ovi.z0, ovi.z1).map(([a, b]) => [ovi.walk![0] + 0.1, Y + 0.25, (a + b) / 2] as [number, number, number]));
    const RX = railX + 0.1, base = Y + 0.25;
    for (const [r0, r1] of runsOf(zA, zB)) {
      if (r1 - r0 < 0.3) continue;
      const near = (z: number) => z > z0 - 2 && z < z1 + 2;
      for (let z = r0 + 0.04; z < r1; z += 2) {
        k.box(RX, base + 0.55, z, 0.07, 1.1, 0.07, steel);
        if (near(z)) k.box(RX, Y + 0.262, z, 0.18, 0.024, 0.18, plate);
      }
      const zc = (r0 + r1) / 2, len = r1 - r0;
      k.cyl(RX, base + 1.12, zc, 0.03, 0.03, len, 6, steel, false, Math.PI / 2);
      k.box(RX, base + 0.1, zc, 0.04, 0.04, len, steel);
      k.box(RX, base + 0.82, zc, 0.035, 0.035, len, steel);
      // pickets near, the city's bar pattern far
      const n0 = Math.max(r0, z0), n1 = Math.min(r1, z1);
      for (let z = n0 + 0.0625; z < n1; z += 0.125) k.box(RX, base + 0.55, z, 0.018, 0.9, 0.018, picket);
      for (const [f0, f1] of [[r0, Math.min(r1, z0)], [Math.max(r0, z1), r1]] as const) if (f1 - f0 > 0.5) {
        k.quad(RX - 0.01, base + 0.55, (f0 + f1) / 2, f1 - f0, 0.9, [0.06, 0.07, 0.068, M.BARS], -Math.PI / 2);
        k.quad(RX + 0.01, base + 0.55, (f0 + f1) / 2, f1 - f0, 0.9, [0.06, 0.07, 0.068, M.BARS], Math.PI / 2);
      }
      // the ends of the rail at a gap: a heavier post and a cap
      for (const ze of [r0, r1]) if (ze > zA + 0.1 && ze < zB - 0.1) { k.box(RX, base + 0.57, ze, 0.09, 1.14, 0.09, steel); k.sphere(RX, base + 1.16, ze, 0.05, steel, 1, 1, 1, 1); }
    }
    // amber reflectors on the barrier, every 6 m
    for (let z = z0 + 3; z < z1; z += 6) k.box(railX + 3.06, Y + 0.62, z, 0.012, 0.07, 0.12, [1.1, 0.55, 0.12, M.LIGHT], 0, 0, -0.2);
    // pedestrian lamps on the barrier, their arms over the walkway
    const lampSteel = [0.11, 0.12, 0.12, M.ALB];
    for (const z of o.lamps) {
      k.cyl(railX + 3.2, Y + 0.9 + 3.0, z, 0.06, 0.09, 6.0, 8, lampSteel);
      k.box(railX + 2.5, Y + 6.85, z, 1.4, 0.07, 0.07, lampSteel);
      k.box(railX + 1.85, Y + 6.8, z, 0.5, 0.12, 0.26, lampSteel);
      k.quad(railX + 1.85, Y + 6.735, z, 0.42, 0.2, [1.4, 1.1, 0.75, M.LIGHT], 0, Math.PI / 2);
      this.lampHeads.push(V(railX + 1.85, Y + 6.65, z));
    }
    // the sign gantry across the lanes, and its two signs (facing south, +z)
    const gz = o.gantry;
    for (const gx of [railX + 3.6, railX + 21.4]) { k.box(gx, Y + 3.3, gz, 0.3, 6.6, 0.3, lampSteel); k.box(gx, Y + 0.1, gz, 0.6, 0.2, 0.6, plate); }
    for (const yy of [Y + 6.2, Y + 6.9]) k.box(railX + 12.5, yy, gz, 18.1, 0.12, 0.12, lampSteel);
    for (let x = railX + 4; x < railX + 21; x += 1.2) k.box(x, Y + 6.55, gz, 0.04, 0.7, 0.04, lampSteel, 0, 0, x % 2.4 < 1.2 ? 0.8 : -0.8);
    // the emergency call box on its post by the barrier
    const cbz = o.call;
    k.box(railX + 2.8, Y + 0.7, cbz, 0.1, 1.4, 0.1, lampSteel);
    k.box(railX + 2.72, Y + 1.55, cbz, 0.28, 0.42, 0.32, [0.55, 0.16, 0.03, M.ALB]);
    k.box(railX + 2.575, Y + 1.58, cbz, 0.01, 0.16, 0.2, [0.02, 0.02, 0.02, M.ALB]);
    this.callLight.position.set(0, 0, 0);
    this.callLight.set(0, railX + 2.72, Y + 1.83, cbz, [0.3, 0.5, 1.6], 1, 1);
    this.callLight.commit();
    const kb = kitBatch(k.geometry(), [{ x: 0, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 1 }], cityKitMat(city), V(0, 0, 0), 8);
    kb.frustumCulled = false;
    this.add(kb);
    const signs: [number, [string, number][], string][] = [[railX + 8.0, [['EXIT 7', 70], ['E 34 St', 110], ['Midtown', 80]], '↗'], [railX + 16.5, [['Downtown', 105], ['Bridges', 88]], '↑']];
    for (const [sx, lines, arrow] of signs) {
      const m = new THREE.MeshBasicMaterial({ map: signTexture(lines, 1024, 512, arrow), color: new THREE.Color(0.2, 0.2, 0.2), fog: false });
      this.signMats.push(m);
      const q = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 3.0), m);
      q.position.set(sx, Y + 7.9, gz - 0.12); q.rotation.y = Math.PI;
      this.add(q);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(6.0, 3.0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.014, 0.016) }));
      back.position.set(sx, Y + 7.9, gz - 0.1);
      this.add(back);
    }
    this.add(this.halos, this.heads, this.callLight);
    // ---- across the river: the far bank's skyline, its shore lights, boats ----
    this.add(farBank(railX + 900, 380, -1300, 1300));
    const r = mulberry32(77);
    for (let i = 0; i < 300; i++) {
      const z = -900 + r() * 2000, warm = r() < 0.7;
      const c = warm ? new THREE.Color(1, 0.62, 0.28) : new THREE.Color(0.8, 0.88, 1);
      this.shoreList.push({ p: V(railX + 868 + r() * 25, 2 + r() * 7, z), c, k: 0.6 + r() * 1.2, refl: r() < 0.6, seed: r() * 100 });
    }
    this.add(this.shore, this.boats);
  }

  /** Per frame: the lamps (and the extra lights the caller adds after index 3), halos, shore lights, boats. */
  update(t: number, dawn: number) {
    const H = this.halos, Hd = this.heads, L = this.lights;
    L.clear();
    let i = 0;
    const warm = new THREE.Color(1.0, 0.8, 0.6);
    for (const p of this.lampHeads) {
      L.set(i, p, warm.clone().multiplyScalar(1.5), 4.5);
      H.set(i, p.x, p.y - 0.1, p.z, warm, 0.12 * (1 - 0.4 * dawn), 1);
      Hd.set(i, p.x, p.y, p.z, warm, 2.4, 1);
      i++;
    }
    H.commit(i); Hd.commit(this.lampHeads.length);
    // shore lights and their broken reflections on the water
    const S = this.shore;
    let n = 0;
    for (const s of this.shoreList) {
      if (n >= S.n - 3) break;
      const fl = 0.85 + 0.15 * Math.sin(t * 2 + s.seed);
      S.set(n++, s.p.x, s.p.y, s.p.z, s.c, s.k * fl, 1);
      // (a light's reflection is a column of broken glints coming toward the eye across the water)
      if (s.refl) for (let j = 1; j <= 3; j++) {
        const wob = Math.sin(t * 3 + s.seed + j * 2.1) * 0.8, on = 0.6 + 0.4 * Math.sin(t * 4.1 + s.seed * 3 + j);
        S.set(n++, s.p.x - 25 * j * j, -1.2, s.p.z + wob, s.c, s.k * 0.32 * fl * on / j, 1.6 + 0.6 * j);
      }
    }
    S.commit(n);
    // two boats: a slow barge and a ferry with lit windows
    const B = this.boats;
    const bz = -200 + ((t * 3.5) % 900), fz = 600 - ((t * 6) % 1100);
    B.set(0, this.railX + 260, 2.2, bz, [1, 0.95, 0.85], 1.5, 1); B.set(1, this.railX + 260, 2.0, bz - 30, [1, 0.1, 0.05], 1.0, 0.8);
    for (let j = 0; j < 8; j++) B.set(2 + j, this.railX + 420, 4.0, fz + j * 3, [1, 0.8, 0.5], 1.1, 0.9);
    B.set(10, this.railX + 420, 9, fz + 10, [0.2, 1, 0.3], 1.2, 0.8);
    B.commit(11);
    for (const m of this.signMats) m.color.setScalar(0.3 + 0.08 * (1 - dawn));
    const on = Math.sin(t * Math.PI * 0.9) > 0.6 ? 1.6 : 0.25;
    this.callLight.set(0, this.railX + 2.72, this.y + 1.83, this.callZ, [0.3, 0.5, 1.6], on, 1);
    this.callLight.commit();
  }
}

/**
 * The riverside overpass as both the run's end (chorus 2) and the break (overpass.ts) see it: the walkway dressed
 * from z 51 to 330, its lamps every 36 m, the sign gantry and the call box by where the two stop (z 121).
 */
export function standardDeck(city: City) {
  const ov = city.overpass as ({ y: number; walk?: [number, number]; gaps?: [number, number][] }) | null;
  const railX = ov?.walk?.[0] ?? 1135, y = ov?.y ?? 8.5, z = 121;
  const gaps = (ov?.gaps ?? [[119.5, 122.5], [145, 150]]) as [number, number][];
  const lamps: number[] = [];
  for (let lz = z - 50; lz < 330; lz += 36) lamps.push(lz);
  return new DeckDress(city, railX, y, z - 70, 330, gaps, { lamps, gantry: z + 11, call: z - 4.5 });
}

/**
 * The far bank: a wall of buildings across the river at x = xb (facing west), z0..z1: silhouettes of varied
 * heights, windows lit warm and cool, red lights on the tallest; hazy at the foot.
 */
export function farBank(xb: number, depth: number, z0: number, z1: number) {
  const m = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { k: { value: 1 } },
    vertexShader: 'varying vec2 vP; void main(){ vP = vec2(position.z, position.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */ `
      varying vec2 vP; uniform float k;
      float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
      float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float z = vP.x, y = vP.y;
        // two rows of buildings, the back row taller
        float c1 = floor(z / 26.0), c2 = floor((z + 9.0) / 38.0);
        float hFront = 18.0 + 45.0 * pow(h1(c1), 2.2), hBack = 40.0 + 120.0 * pow(h1(c2 + 31.0), 3.0);
        float front = step(y, hFront), back = step(y, hBack) * (1.0 - front);
        if (front + back < 0.5) discard;
        float cell = front > 0.5 ? c1 : c2 + 100.0;
        // windows: 3.4 m floors, 2.2 m bays; lit by chance (more low down), warm or cool
        vec2 g = vec2(z / 2.2, y / 3.4), gi = floor(g), gf = fract(g);
        float win = step(0.2, gf.x) * step(gf.x, 0.75) * step(0.25, gf.y) * step(gf.y, 0.8);
        float lit = step(h2(gi + cell * 7.0), 0.22 - 0.1 * (y / 200.0));
        vec3 wc = mix(vec3(1.0, 0.68, 0.36), vec3(0.75, 0.85, 1.0), step(0.7, h2(gi + 3.0)));
        vec3 wall = mix(vec3(0.006, 0.007, 0.012), vec3(0.003, 0.004, 0.008), back);
        vec3 c = wall + wc * win * lit * 0.55 * (back > 0.5 ? 0.6 : 1.0);
        // red aviation lights on the tall ones
        float top = back > 0.5 ? hBack : hFront;
        c += vec3(1.0, 0.06, 0.03) * 3.0 * step(95.0, top) * smoothstep(1.4, 0.0, length(vec2(fract(z / 38.0) * 38.0 - 19.0, y - top + 1.0)));
        // the haze at the foot, over the water
        c = mix(c, vec3(0.05, 0.055, 0.085), smoothstep(40.0, 0.0, y) * 0.75);
        gl_FragColor = vec4(c * k, 1.0);
      }`,
  });
  const g = new THREE.PlaneGeometry(z1 - z0, 320, 1, 1);
  g.rotateY(-Math.PI / 2);
  g.translate(xb, 160, (z0 + z1) / 2);
  // (positions: x = xb, y up, z along — the shader reads (z, y))
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  void depth;
  return mesh;
}

void hash;
