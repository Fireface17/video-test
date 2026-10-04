// The elevated line and the riverside highway. The el: steel columns at the curbs of one avenue, cross girders,
// lattice girders, an open-tie deck with rails, lamps hanging under it; a station (side platforms, canopies with
// fluorescent tubes, windscreens, name signs) with stairs down to both pavements; trains of lit cars that stop at
// the station. The overpass: a concrete deck on columns along the river, jersey barriers, a pedestrian walkway
// with a railing (a gap for a stair), tall lamps, its own traffic.
import * as THREE from 'three';
import { CITY_GLSL, type CityUniforms } from './city-glsl';
import { KitBuilder, M, kitBatch, kitMaterial, type KInst } from './city-build';
import { SCALE } from '../../engine/gl';

export interface ElInfo { x: number; y: number; z0: number; z1: number; station: number; tracks: [number, number]; platformY: number; platforms: [number, number][]; stationZ: [number, number] }
export interface OverpassInfo { x: number; y: number; z0: number; z1: number; lanes: number[]; walk: [number, number]; /** the coping on the walkway's west edge: top height */ coping: number; gaps: [number, number][] }

const STEEL = [0.11, 0.13, 0.12, M.ALB], RUST = [0.13, 0.08, 0.06, M.ALB], CONC = [0.3, 0.29, 0.28, M.ALB];

/** One unit box (y 0..1) of a material, for kitBatch with per-instance scale. */
function unitBox(v: number[]) { return new KitBuilder().box(0, 0.5, 0, 1, 1, 1, v).geometry(); }

// ---------------------------------------------------------------- trains

/** Where the el's train `i` is along z at time t (it stops at the station). Shared by the shader and scenes. */
export function elTrainZ(i: number, t: number, el: ElInfo) {
  const L = el.z1 - el.z0 + 1200, v = 13, dwell = 22, acc = 1.0;
  const dir = i % 2 ? -1 : 1;
  const T = L / v + dwell + v / acc; // cruise + dwell + the time lost braking and accelerating
  const st = dir > 0 ? el.station - el.z0 + 600 : el.z1 + 600 - el.station; // the station along the loop
  const ph = (((t + i * 37.3) % T) + T) % T;
  // s(ph): arrive at the station at ph = st/v + v/(2acc), wait, leave
  const ta = st / v + v / (2 * acc), td = ta + dwell;
  let s: number;
  const db = (v * v) / (2 * acc);
  if (ph < ta - v / acc) s = v * ph;
  else if (ph < ta) { const u = ta - ph; s = st - 0.5 * acc * u * u; }
  else if (ph < td) s = st;
  else if (ph < td + v / acc) { const u = ph - td; s = st + 0.5 * acc * u * u; }
  else s = st + db + v * (ph - td - v / acc);
  s = ((s % L) + L) % L;
  return { z: dir > 0 ? el.z0 - 600 + s : el.z1 + 600 - s, dir, track: el.tracks[i % 2]!, stopped: ph >= ta && ph < td };
}

function trainCarGeometry() {
  const k = new KitBuilder();
  const L = 15, W = 2.9, H = 3.4;
  k.box(0, 0.35 + H / 2, 0, W, H, L, [0.42, 0.43, 0.45, M.ALB]);
  // a band of lit windows each side, doors, the ends
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) k.quad(sx * (W / 2 + 0.01), 2.25, -L / 2 + 1.6 + i * 2.35, 1.5, 1.0, [0.85, 0.95, 0.9, M.LIGHT], sx * Math.PI / 2);
    for (const z of [-4.5, 0, 4.5]) k.quad(sx * (W / 2 + 0.012), 1.6, z, 1.25, 2.3, [0.2, 0.21, 0.22, M.ALB], sx * Math.PI / 2);
  }
  k.quad(0, 2.3, L / 2 + 0.01, 1.2, 0.9, [0.85, 0.95, 0.9, M.LIGHT]);
  k.quad(0, 2.3, -L / 2 - 0.01, 1.2, 0.9, [0.85, 0.95, 0.9, M.LIGHT], Math.PI);
  k.box(0, 0.3, -L / 2 + 2.5, 2.2, 0.6, 2.6, [0.04, 0.04, 0.04, M.ALB]).box(0, 0.3, L / 2 - 2.5, 2.2, 0.6, 2.6, [0.04, 0.04, 0.04, M.ALB]);
  return k.geometry();
}

// ---------------------------------------------------------------- the deck of the overpass

function deckMaterial(U: CityUniforms, o: OverpassInfo) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    vertexShader: 'varying vec3 vW, vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      varying vec3 vW, vN;
      void main() {
        vec3 N = normalize(vN);
        vec2 xz = vW.xz - uOrigin.xz;
        float p = power(vW.xz);
        float x = xz.x - ${o.walk[0].toFixed(1)};
        float walk = step(x, 3.0);
        // asphalt, lane dashes, edge lines; the walkway's concrete
        vec3 alb = mix(vec3(0.07, 0.07, 0.075), vec3(0.26, 0.255, 0.25), walk);
        float lane = step(abs(mod(x - 3.0, 4.0) - 2.0), 0.08) * step(fract(xz.y / 12.0), 0.3) * (1.0 - walk) * step(x, 21.5) * step(4.5, x);
        float cen = smoothstep(0.14, 0.1, abs(x - 11.0)) * (1.0 - walk);
        alb = mix(alb, vec3(0.55, 0.42, 0.1), cen);
        alb = mix(alb, vec3(0.6), lane);
        alb *= mix(1.0, 0.85 + 0.15 * step(fract(xz.y / 1.5), 0.04), walk);
        // pools of the deck lamps (every 40 m on the east barrier), their sodium colour
        float dz = mod(xz.y + 20.0, 40.0) - 20.0, dxl = x - 20.0;
        vec3 pool = vec3(1.0, 0.55, 0.22) * (0.7 * exp(-(dz * dz + dxl * dxl) / 70.0) + 0.12 * exp(-(dz * dz + dxl * dxl) / 400.0)) * step(0.15, p);
        vec3 L = ambient(N) + pool + sunLit(N, 1.0) + peopleGlow(vW, N);
        vec3 c = alb * L * (N.y > 0.5 ? 1.0 : 0.6);
        // wet: the sky and the lamps in it
        vec3 V = normalize(vW - cameraPosition);
        float fres = 0.04 + 0.96 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
        c += (skyRefl(reflect(V, N)) * 0.5 + pool * 0.15) * fres * step(0.5, N.y) * 0.8;
        gl_FragColor = vec4(cityFog(c, vW, p), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- building both

export class Rail extends THREE.Group {
  el: ElInfo | null = null;
  overpass: OverpassInfo | null = null;
  /** objects to keep out of the wet-street reflection */
  mirrorHide: THREE.Object3D[] = [];
  trains: THREE.Mesh | null = null;
  private trainPos: THREE.InstancedBufferAttribute | null = null;
  private nTrains = 0;
  extraLight: { x: number; z: number; c: [number, number, number]; s: number; k: number }[] = [];
  glows: [number, number, number, number, number, number][] = []; // x, y, z, r, g, b (lamps to add to the city's lamp sprites)

  constructor(U: CityUniforms, o: { elX: number | null; stationZ: number; z0: number; z1: number; river: number | null; trains: number; avRoadH: number; streetsZ: (z: number) => boolean }) {
    super();
    const kit = kitMaterial(U), kit2 = kitMaterial(U, { side: THREE.DoubleSide });
    // ---------------- the el ----------------
    if (o.elX !== null) {
      const X = o.elX, z0 = o.z0, z1 = o.z1, S = o.stationZ;
      const tracks: [number, number] = [X - 2.1, X + 2.1];
      this.el = { x: X, y: 9.6, z0, z1, station: S, tracks, platformY: 8.4, platforms: [[X - 7.6, X - 4.4], [X + 4.4, X + 7.6]], stationZ: [S - 75, S + 75] };
      const cols: KInst[] = [], beams: KInst[] = [], gird: KInst[] = [], ties: KInst[] = [], rails: KInst[] = [], plat: KInst[] = [], canopy: KInst[] = [], tubes: KInst[] = [], posts: KInst[] = [], screens: KInst[] = [], steps: KInst[] = [];
      const add = (l: KInst[], x: number, y: number, z: number, sx: number, sy: number, sz: number, col: [number, number, number] = [1, 1, 1], k = 0, yaw = 0) => l.push({ x, y, z, yaw, sx, sy, sz, col, k });
      const span = 15;
      for (let z = z0; z < z1; z += span) {
        const atStreet = o.streetsZ(z);
        if (!atStreet) {
          for (const sx of [-1, 1]) {
            add(cols, X + sx * 7.8, 0, z, 0.55, 7.9, 0.45);
            add(cols, X + sx * 7.8, 0, z, 0.9, 0.7, 0.8);
          }
          add(beams, X, 7.9, z, 16.4, 0.75, 0.6);
        }
        for (const tx of tracks) for (const gx of [-0.85, 0.85]) add(gird, tx + gx, 8.0, z + span / 2, 0.3, 1.0, span);
        for (const tx of tracks) {
          add(ties, tx, 9.06, z + span / 2, 2.5, 0.16, span);
          for (const rx of [-0.72, 0.72]) add(rails, tx + rx, 9.22, z + span / 2, 0.08, 0.18, span);
        }
      }
      // the station: platforms, canopies, tubes, posts, windscreens; stairs to both pavements
      const pz0 = S - 75, pz1 = S + 75;
      for (const [a, b] of this.el.platforms) {
        add(plat, (a + b) / 2, 7.95, S, b - a, 0.45, pz1 - pz0);
        const outer = Math.abs(a - X) > Math.abs(b - X) ? a : b, sgn = Math.sign(outer - X);
        add(screens, outer + sgn * 0.08, 8.4, S, 0.12, 1.15, pz1 - pz0);
        for (let z = pz0 + 4; z < pz1; z += 7) { add(posts, outer - sgn * 0.4, 8.4, z, 0.14, 3.0, 0.14); }
        add(canopy, (a + b) / 2 + sgn * 0.3, 11.35, S, b - a + 1.2, 0.18, pz1 - pz0 - 10);
        for (let z = pz0 + 8; z < pz1 - 6; z += 5) add(tubes, (a + b) / 2, 11.25, z, 0.12, 0.05, 2.6, [1, 1, 1], 0.9);
        for (let z = pz0 + 8; z < pz1 - 6; z += 10) this.extraLight.push({ x: (a + b) / 2, z, c: [0.8, 0.92, 0.9], s: 4, k: 0.0 });
      }
      // stairs: a bridge from the platform to the pavement, two flights with a landing (east and west)
      const sideK = new KitBuilder();
      for (const sgn of [1, -1]) {
        const xs = X + sgn * 13.6, outer = X + sgn * 7.6;
        add(plat, (outer + xs + sgn * 0.8) / 2, 7.95, S + 2, Math.abs(xs - outer) + 1.6, 0.45, 4);
        add(screens, (outer + xs) / 2, 8.4, S, Math.abs(xs - outer), 1.1, 0.1);
        const flight = (y0: number, y1: number, za: number, zb: number) => {
          const n = Math.max(2, Math.round((y0 - y1) / 0.18)), dz = (zb - za) / n, dy = (y0 - y1) / n;
          for (let i = 0; i < n; i++) add(steps, xs, y0 - (i + 1) * dy, za + (i + 0.5) * dz, 1.7, dy + 0.06, Math.abs(dz) + 0.02);
          // the stair's sides: sheet-steel panels with a handrail on top
          for (const rx of [-0.9, 0.9]) {
            const x = xs + rx - X;
            sideK.poly4([x, y0 + 1.0, za - S], [x, y0 - 0.25, za - S], [x, y1 - 0.25, zb - S], [x, y1 + 1.0, zb - S], RUST);
            sideK.box(x, (y0 + y1) / 2 + 1.02, (za + zb) / 2 - S, 0.06, 0.06, Math.hypot(zb - za, y0 - y1), RUST, 0, Math.atan2(y0 - y1, zb - za));
          }
        };
        flight(8.4, 4.6, S + 4, S + 12);
        add(plat, xs, 4.35, S + 13.75, 1.9, 0.3, 3.5);
        flight(4.6, 0.15, S + 15.5, S + 24.2);
        for (const zz of [S + 4, S + 12, S + 15.5]) add(cols, xs, 0, zz, 0.25, zz < S + 13 ? 7.8 - (zz - S - 4) * 0.47 : 4.4, 0.25);
      }
      const segs = (list: KInst[], geo: THREE.BufferGeometry, mat: THREE.Material, r = 10) => {
        // in 300 m pieces along z (for culling)
        const by = new Map<number, KInst[]>();
        for (const q of list) { const k = Math.floor(q.z / 300); if (!by.has(k)) by.set(k, []); by.get(k)!.push(q); }
        for (const [k, l] of by) this.add(kitBatch(geo, l, mat, new THREE.Vector3(X, 0, (k + 0.5) * 300), r));
      };
      segs(cols, unitBox(STEEL), kit);
      segs(beams, unitBox(STEEL), kit);
      segs(gird, unitBox([0.1, 0.12, 0.11, M.LATTICE]), kit2, 16);
      segs(ties, new KitBuilder().quad(0, 0.08, 0, 1, 1, [0.09, 0.07, 0.05, M.TIES], 0, -Math.PI / 2).box(0, 0, 0, 1, 0.5, 1, [0.08, 0.065, 0.05, M.TIES]).geometry(), kit2, 16);
      segs(rails, unitBox([0.3, 0.3, 0.32, M.ALB]), kit, 16);
      segs(plat, unitBox(CONC), kit, 80);
      segs(screens, unitBox([0.12, 0.13, 0.13, M.ALB]), kit, 80);
      segs(posts, unitBox(STEEL), kit);
      segs(canopy, unitBox([0.15, 0.16, 0.17, M.ALB]), kit2, 80);
      segs(tubes, unitBox([0.9, 1.0, 0.95, M.LAMP]), kit);
      segs(steps, unitBox(CONC), kit);
      this.add(kitBatch(sideK.geometry(), [{ x: X, y: 0, z: S, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0 }], kit2, new THREE.Vector3(X, 0, S), 40));
      // trains: lit cars, stopping at the station
      const n = o.trains;
      if (n > 0) {
        const cars = 6, base = trainCarGeometry();
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        for (const k of ['position', 'normal', 'aV', 'aL']) geo.setAttribute(k, base.attributes[k]!);
        const iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * cars * 4), 4).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('iPos', iPos);
        geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(new Float32Array(n * cars * 3).fill(1), 3));
        geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(n * cars * 4).fill(1), 4));
        geo.setAttribute('iX', new THREE.InstancedBufferAttribute(new Float32Array(n * cars * 4), 4));
        geo.instanceCount = n * cars;
        this.trains = new THREE.Mesh(geo, kitMaterial(U));
        this.trains.frustumCulled = false;
        this.trainPos = iPos; this.nTrains = n;
        this.add(this.trains);
      }
    }
    // ---------------- the overpass ----------------
    if (o.river !== null) {
      const wx = o.river - 25, X = wx + 11, z0 = o.z0 - 600, z1 = o.z1 + 600, Y = 8.5;
      this.overpass = { x: X, y: Y, z0, z1, lanes: [wx + 5.5, wx + 9.5, wx + 13.5, wx + 17.5], walk: [wx, wx + 3], coping: Y + 0.25, gaps: [[119.5, 122.5], [145, 150]] };
      const deckGeo = new THREE.BoxGeometry(22, 0.9, z1 - z0).translate(X, Y - 0.45, (z0 + z1) / 2);
      const deck = new THREE.Mesh(deckGeo, deckMaterial(U, this.overpass));
      deck.frustumCulled = false;
      this.add(deck);
      const cols: KInst[] = [], beams: KInst[] = [], bar: KInst[] = [], rails: KInst[] = [], lampP: KInst[] = [];
      const add = (l: KInst[], x: number, y: number, z: number, sx: number, sy: number, sz: number, k = 0) => l.push({ x, y, z, yaw: 0, sx, sy, sz, col: [1, 1, 1], k });
      for (let z = z0 + 15; z < z1; z += 30) {
        for (const cx of [wx + 3, wx + 19]) add(cols, cx, 0, z, 1.1, 6.6, 1.1);
        add(beams, X, 6.6, z, 21, 0.5, 1.4);
      }
      for (const gx of [wx + 4, X, wx + 18]) add(beams, gx, 6.9, (z0 + z1) / 2, 1.0, 0.7, z1 - z0);
      add(bar, wx + 3.2, Y, (z0 + z1) / 2, 0.45, 0.9, z1 - z0);
      add(bar, wx + 21.8, Y, (z0 + z1) / 2, 0.45, 0.9, z1 - z0);
      // the walkway's railing on the west edge (on a low coping), with gaps: a stair at z 145–150, a missing panel at 119.5–122.5
      for (const [a, b] of [[z0, 119.5], [122.5, 145], [150, z1]] as const) add(rails, wx + 0.1, Y + 0.25, (a + b) / 2, 0.06, 1.1, b - a);
      add(bar, wx + 0.2, Y, (z0 + z1) / 2, 0.4, 0.25, z1 - z0);
      for (let z = z0 + 20; z < z1; z += 40) {
        add(lampP, wx + 21.9, Y, z, 1, 1, 1, 0.5 + ((z * 0.37) % 1) * 0.49);
        this.glows.push([wx + 20.0, Y + 9.6, z, 1.0, 0.55, 0.22]);
      }
      const segs = (list: KInst[], geo: THREE.BufferGeometry, mat: THREE.Material, r = 10) => {
        const by = new Map<number, KInst[]>();
        for (const q of list) { const k = Math.floor(q.z / 300); if (!by.has(k)) by.set(k, []); by.get(k)!.push(q); }
        for (const [k, l] of by) this.add(kitBatch(geo, l, mat, new THREE.Vector3(X, 0, (k + 0.5) * 300), r));
      };
      segs(cols, unitBox(CONC), kit);
      for (const q of beams) this.add(kitBatch(unitBox(CONC), [q], kit, new THREE.Vector3(q.x, 0, q.z), Math.max(q.sz, 30)));
      for (const q of bar) { const m = kitBatch(unitBox([0.36, 0.35, 0.34, M.ALB]), [q], kit, new THREE.Vector3(q.x, 0, q.z), q.sz); m.frustumCulled = false; this.add(m); }
      for (const q of rails) { const m = kitBatch(unitBox([0.08, 0.1, 0.09, M.BARS]), [q], kit2, new THREE.Vector3(q.x, 0, q.z), q.sz); m.frustumCulled = false; this.add(m); }
      const lamp = new KitBuilder().cyl(0, 5, 0, 0.1, 0.15, 10, 6, [0.25, 0.25, 0.26, M.ALB], true).box(-1, 9.9, 0, 2.2, 0.12, 0.12, [0.25, 0.25, 0.26, M.ALB]).box(-1.9, 9.8, 0, 0.8, 0.22, 0.4, [0.15, 0.15, 0.16, M.ALB]).quad(-1.9, 9.68, 0, 0.6, 0.3, [1, 0.8, 0.55, M.LAMP], 0, Math.PI / 2).geometry();
      segs(lampP, lamp, kit, 12);
    }
  }

  /** Per frame: the trains. */
  update(t: number) {
    if (!this.el || !this.trains || !this.trainPos) return;
    const cars = 6, a = this.trainPos.array as Float32Array;
    for (let i = 0; i < this.nTrains; i++) {
      const tr = elTrainZ(i, t, this.el);
      for (let c = 0; c < cars; c++) {
        const k = (i * cars + c) * 4;
        a[k] = tr.track; a[k + 1] = 9.25; a[k + 2] = tr.z - tr.dir * (c * 15.3 + 7.5); a[k + 3] = 0;
      }
    }
    this.trainPos.needsUpdate = true;
  }
}

/** Overpass traffic: the cars' lane coordinate is x, they run along z at highway speed (handled by CityLife's traffic shader with type 2). */
export function overpassCars(o: OverpassInfo, r: () => number) {
  const out: { L: number[]; S: number[]; type: number }[] = [];
  o.lanes.forEach((x, i) => {
    const dir = i < 2 ? -1 : 1;
    for (let s = 0; s < o.z1 - o.z0; s += 25 + r() * 70) out.push({ L: [2, x, dir, s], S: [19 + r() * 4, o.y, o.z0, o.z1 - o.z0], type: r() < 0.2 ? 1 : r() < 0.06 ? 3 : 0 });
  });
  return out;
}
void SCALE;
