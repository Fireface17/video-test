// The world around the `train` scene's car: the ride (position along the line as a function of song time —
// locked to the beat grid so the lamp posts pass on the beats, then braking into the station), the elevated
// line (deck, parapets, rails, columns, lamp posts), the night city (lib/city.ts) with a cleared lot on the moon
// side, the moon and the black tower that swallows it, billboards and signs streaming past, and the station:
// platform, tiled wall, canopy with its lights, the long stair down to the avenue.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AudioData } from '../../engine/audio';
import { hash, mulberry32 } from '../../engine/util';
import { F, font } from '../../engine/type';
import { City } from '../lib/city';
import { GlowPoints } from '../lib/points';
import { FLOOR_Y, ST_LIGHT, boxG, canvasTex, glowMat, litMat, moonMat, skyMat, type LightU } from './train-gfx';

/** Lamp posts along the line: one per beat, sides alternating. */
export const PITCH = 6;

/** The ride: car position x(t) (the car's local origin), its speed and acceleration. Stops at x = 0. */
export class Ride {
  dB: number;
  v0: number;
  bB: number;
  constructor(private audio: AudioData, public tB: number, public tS: number) {
    this.bB = audio.beatAt(tB);
    const per = audio.timeOfBeat(Math.floor(this.bB) + 1) - audio.timeOfBeat(Math.floor(this.bB));
    this.v0 = PITCH / per;
    this.dB = (this.v0 * (tS - tB)) / 3;
  }
  x(t: number) {
    if (t <= this.tB) return -this.dB - PITCH * (this.bB - this.audio.beatAt(t));
    const D = this.tS - this.tB, u = Math.min(1, (t - this.tB) / D);
    return -this.dB + (this.v0 * D * (1 - Math.pow(1 - u, 3))) / 3;
  }
  v(t: number) {
    if (t <= this.tB) return this.v0;
    const u = Math.min(1, (t - this.tB) / (this.tS - this.tB));
    return this.v0 * (1 - u) * (1 - u);
  }
  /** Deceleration (m/s², positive while braking). */
  acc(t: number) {
    if (t <= this.tB || t >= this.tS) return 0;
    const u = (t - this.tB) / (this.tS - this.tB);
    return (2 * this.v0 * (1 - u)) / (this.tS - this.tB);
  }
  /** Where (mod PITCH) the car's origin is on every beat before the brakes: the lamp posts stand there. */
  beatPhaseX() { const x = this.x(this.audio.timeOfBeat(Math.floor(this.bB))); return ((x % PITCH) + PITCH) % PITCH; }
}

/** Station layout (world). */
export const ST = {
  x0: ST_LIGHT.x0, x1: ST_LIGHT.x1, zWall: -9.2, zEdge: -1.56, canopy: FLOOR_Y + 3.9,
  stairX: 6.5, stairN: 49, run: 0.305, sz0: -8.8, sz1: -3.2,
  /** the painted words on the risers span this part of the stair's width (the near side is the runners' lane) */
  tz0: -8.75, tz1: -4.55,
};
export const RISE = FLOOR_Y / ST.stairN;
/** World x of the stair foot. */
export const STAIR_FOOT = ST.stairX + (ST.stairN - 1) * ST.run;

// ------------------------------------------------------------------------------------------------- outside

export class Outside extends THREE.Group {
  city: City;
  sky: THREE.Mesh;
  skyM: THREE.ShaderMaterial;
  moon: THREE.Mesh;
  moonM: THREE.ShaderMaterial;
  moonDir: THREE.Vector3;
  tower!: THREE.Mesh;
  backdrop: Backdrop;
  towerBeacon = new GlowPoints(2, 1.2);
  lamps: GlowPoints;
  lampPoles: THREE.InstancedMesh;
  lampX: number[] = [];
  signs: THREE.Group = new THREE.Group();

  constructor(U: LightU, ride: Ride, moonDir: THREE.Vector3) {
    super();
    this.moonDir = moonDir.clone().normalize();
    // the city (lib/city.ts), for the street shots at the end: the line runs over one of its wide cross streets
    // (local z = 40, along x). Its own sky and elevated line are left out.
    const OFF = new THREE.Vector3(-50, 0, -44);
    this.city = new City({
      // (seen only from the street at the station: the avenue toward -x and the blocks around it)
      seed: 29, bounds: [-560 - OFF.x, -260 - OFF.z, 260 - OFF.x, 240 - OFF.z], centre: [-420 - OFF.x, 1000 - OFF.z], downtownR: 520, fog: 0.00105,
      el: null, sky: false, park: null, river: null, detail: 0.35, traffic: 0.25, lod: 0.4,
    });
    this.city.position.copy(OFF);
    this.add(this.city);
    // the cheap stand-in seen from the train (the full city is drawn only in the street shots)
    this.backdrop = new Backdrop(U);
    this.add(this.backdrop);
    // sky and moon
    this.skyM = skyMat();
    this.skyM.uniforms.uMoonD!.value.copy(this.moonDir);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 16), this.skyM);
    this.sky.renderOrder = -20;
    this.sky.frustumCulled = false;
    this.moonM = moonMat();
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.moonM);
    this.moon.renderOrder = -15;
    this.moon.frustumCulled = false;
    this.add(this.sky, this.moon);

    // the elevated line
    const deck = litMat(U, { color: new THREE.Color(0.05, 0.05, 0.055), pattern: 5 });
    const steel = litMat(U, { color: new THREE.Color(0.06, 0.065, 0.075), spec: 0.4, shin: 30 });
    const railM = litMat(U, { color: new THREE.Color(0.3, 0.3, 0.32), spec: 1.5, shin: 60 });
    const X0 = -460, X1 = 330;
    const dg: THREE.BufferGeometry[] = [boxG(X0, X1, 7.3, 8.0, -2.45, 2.45)];
    for (const z of [-2.45, 2.45]) dg.push(boxG(X0, ST.x0, 8.0, 8.85, z - 0.08, z + 0.08), boxG(ST.x1, X1, 8.0, 8.85, z - 0.08, z + 0.08));
    this.add(new THREE.Mesh(mergeGeometries(dg), deck));
    const rails: THREE.BufferGeometry[] = [];
    for (const z of [-0.72, 0.72]) rails.push(boxG(X0, X1, 8.0, 8.17, z - 0.035, z + 0.035));
    for (let x = X0; x < X1; x += 0.65) rails.push(boxG(x, x + 0.22, 7.98, 8.06, -1.25, 1.25));
    this.add(new THREE.Mesh(mergeGeometries(rails), railM));
    const cols: THREE.BufferGeometry[] = [];
    for (let x = X0 + 4; x < X1; x += 14) {
      for (const z of [-2.2, 2.2]) cols.push(boxG(x - 0.28, x + 0.28, 0, 7.3, z - 0.28, z + 0.28));
      cols.push(boxG(x - 0.25, x + 0.25, 6.6, 7.3, -2.6, 2.6));
    }
    this.add(new THREE.Mesh(mergeGeometries(cols), steel));
    // lamp posts on the parapets, one per beat (sides alternating), up to the station
    const phase = ride.beatPhaseX();
    for (let x = phase - 76 * PITCH; x < ST.x0 - 6; x += PITCH) this.lampX.push(x);
    const pole = new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6);
    pole.translate(0, 8.85 + 2.1, 0);
    const arm = boxG(-0.04, 0.04, 12.9, 12.98, 0, 0.75);
    const head = boxG(-0.12, 0.12, 12.82, 12.92, 0.5, 0.95);
    const lg = mergeGeometries([pole, arm, head].map((g) => { g.deleteAttribute('uv'); return g; }));
    lg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(lg.attributes.position!.count * 2), 2));
    this.lampPoles = new THREE.InstancedMesh(lg, steel, this.lampX.length);
    this.lamps = new GlowPoints(this.lampX.length * 2, 0.5);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    this.lampX.forEach((x, k) => {
      const side = k % 2 ? 1 : -1;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), side > 0 ? Math.PI : 0);
      m.compose(new THREE.Vector3(x, 0, side * 2.55), q, new THREE.Vector3(1, 1, 1));
      this.lampPoles.setMatrixAt(k, m);
      const hz = side * (2.55 - 0.72);
      this.lamps.set(k * 2, x, 12.8, hz, new THREE.Color(1.0, 0.62, 0.3), 2.6, 1.0);
      this.lamps.set(k * 2 + 1, x, 12.8, hz, new THREE.Color(1.0, 0.5, 0.2), 0.5, 5.0);
    });
    this.lamps.commit();
    this.add(this.lampPoles, this.lamps);

    // billboards and signs along the avenue, at the train's height, facing the line
    const boards = billboardTextures();
    const r = mulberry32(7);
    for (let x = -330; x < -20; x += 30 + r() * 25) {
      const side = r() < 0.5 ? -1 : 1;
      const id = Math.floor(r() * boards.length);
      const big = id < 3;
      const w = big ? 9 : 2.2, h = big ? 4.2 : 5.5;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat(U, new THREE.Color(1, 1, 1).multiplyScalar(big ? 0.9 : 1.6), boards[id]));
      mesh.position.set(x, big ? 13.5 + r() * 4 : 9 + r() * 5, side * (big ? 15.2 : 14.6));
      mesh.rotation.y = side > 0 ? Math.PI : 0;
      this.signs.add(mesh);
      if (big) {
        const frame = new THREE.Mesh(boxG(-w / 2 - 0.15, w / 2 + 0.15, -h / 2 - 0.15, h / 2 + 0.15, -0.3, -0.05), steel);
        frame.position.copy(mesh.position); frame.rotation.copy(mesh.rotation);
        const legs = new THREE.Mesh(boxG(-0.12, 0.12, -mesh.position.y, -h / 2, -0.4, -0.2), steel);
        legs.position.copy(mesh.position); legs.rotation.copy(mesh.rotation);
        this.signs.add(frame, legs);
      }
    }
    this.add(this.signs);
  }

  /**
   * The black tower: a dark glass office tower (the city's own facade shader, almost no lit windows) placed so
   * that, seen from `camAt(tCover)`, its leading edge crosses the moon at `tCover`.
   */
  placeTower(camAt: (t: number) => THREE.Vector3, tCover: number) {
    const zf = 210, w = 46, d = 40, h = 138;
    const c = camAt(tCover);
    // the silhouette edge the moon goes behind is the tower's far left corner (the moon is up and to the +x side)
    const k = (zf + d - c.z) / this.moonDir.z;
    const xEdge = c.x + this.moonDir.x * k;
    this.tower = this.backdrop.tower(xEdge + w / 2, zf + d / 2, w, d, h);
    this.tower.frustumCulled = false;
    this.add(this.tower);
    this.towerBeacon.set(0, xEdge + w / 2, h + 3, zf + d / 2, new THREE.Color(1, 0.08, 0.04), 2.5, 1);
    this.towerBeacon.commit(1);
    this.add(this.towerBeacon);
    return xEdge;
  }

  /** Per frame: the city's clock, the sky and moon around the camera, the beacon's blink. */
  update(t: number, cam: THREE.Camera, moonK: number, full: boolean) {
    this.city.visible = full;
    this.backdrop.visible = !full;
    if (full) this.city.update(t, cam.position);
    this.sky.position.copy(cam.position);
    const D = 2600, R = 0.036 * D;
    this.moon.position.copy(cam.position).addScaledVector(this.moonDir, D);
    this.moon.quaternion.copy(cam.quaternion);
    this.moon.scale.setScalar(R * 8);
    this.moonM.uniforms.uK!.value = moonK;
    this.skyM.uniforms.uMoonK!.value = moonK;
    const on = Math.sin(t * Math.PI * 0.9) > 0.5 ? 1 : 0.06;
    this.towerBeacon.colors[0] = 2.5 * on; this.towerBeacon.colors[1] = 0.2 * on; this.towerBeacon.colors[2] = 0.1 * on;
    this.towerBeacon.commit(1);
  }

  /** The lamp posts nearest x (world), with their light positions. */
  nearLamps(x: number, n: number) {
    const out: THREE.Vector3[] = [];
    const sorted = this.lampX.map((lx, k) => ({ lx, k })).sort((a, b) => Math.abs(a.lx - x) - Math.abs(b.lx - x)).slice(0, n);
    for (const { lx, k } of sorted) { const side = k % 2 ? 1 : -1; out.push(new THREE.Vector3(lx, 12.6, side * 1.9)); }
    return out;
  }
}

/**
 * A cheap night city for the shots from the train: blocks of buildings along the line's street and beyond
 * (instanced boxes; the facades drawn in the shader as a grid of windows, some lit warm or cool, some with
 * curtains or a TV's blue), a far skyline, and the black tower. It follows the real city's plan loosely: the
 * same street the line runs over, the cleared lot on the moon side.
 */
export class Backdrop extends THREE.Group {
  mat: THREE.ShaderMaterial;
  constructor(U: LightU) {
    super();
    const r = mulberry32(41);
    const inst: number[][] = [];
    const clearAt = (x: number, z: number) => z > 0 && z < 380 && x > -280 && x < 350;
    const avenue = (x: number) => [-175, 75, 325].some((a) => Math.abs(x - a) < 18);
    // building lines along the street (z = -18.5 and +10.5 from the road's middle at z = -4), and the blocks behind
    for (const side of [-1, 1]) for (let row = 0; row < 4; row++) {
      const z0 = side < 0 ? -18.5 - row * 42 : 10.5 + row * 42;
      for (let x = -520; x < 420;) {
        const w = 7 + r() * 16;
        const cx = x + w / 2;
        x += w + (r() < 0.12 ? 3 + r() * 6 : 0.2);
        if (avenue(cx)) continue;
        const d = 12 + r() * 14, zc = z0 + side * (d / 2 + (row ? r() * 8 : 0));
        if (clearAt(cx, zc)) continue;
        if (side < 0 && row === 0 && cx > ST.x0 - 4 && cx < ST.x1 + 4) { /* behind the station: lower */ }
        const h = row === 0 ? 12 + Math.pow(r(), 1.6) * 30 : 15 + Math.pow(r(), 1.3) * 45;
        inst.push([cx, zc, w, d, h, r() * 100, r(), r() < 0.25 ? 1 : 0]);
      }
    }
    // the far skyline: towers beyond the lot, a midtown cluster to the left of the moon
    for (let i = 0; i < 260; i++) {
      const a = (r() - 0.5) * 2.4, dist = 420 + r() * 900;
      const cx = Math.sin(a) * dist - 60, cz = Math.cos(a) * dist + 40;
      const dm = Math.hypot(cx + 420, cz - 1000), down = Math.exp(-(dm * dm) / (420 * 420));
      const h = 20 + Math.pow(r(), 2) * 40 + down * (60 + r() * 190);
      inst.push([cx, cz, 18 + r() * 30, 18 + r() * 30, h, r() * 100, r(), h > 70 ? 1 : 0]);
    }
    for (let i = 0; i < 160; i++) {
      const cx = -600 + r() * 1100, cz = -60 - r() * 700;
      if (Math.abs(cz + 4) < 30) continue;
      inst.push([cx, cz, 15 + r() * 25, 15 + r() * 25, 15 + Math.pow(r(), 1.5) * 60, r() * 100, r(), r() < 0.3 ? 1 : 0]);
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const aB = new Float32Array(inst.length * 4);
    this.mat = facadeMat(U);
    const mesh = new THREE.InstancedMesh(geo, this.mat, inst.length);
    const m = new THREE.Matrix4();
    inst.forEach(([x, z, w, d, h, seed, warm, office], i) => {
      mesh.setMatrixAt(i, m.makeScale(w!, h!, d!).setPosition(x!, 0, z!));
      aB.set([seed!, warm!, office!, 0.18 + 0.32 * hash(i, 7)], i * 4);
    });
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
    mesh.frustumCulled = false;
    this.add(mesh);
    // the ground: dark lots and the lit street under the line
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), groundMat(U));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0.01, 0);
    this.add(ground);
    // street lamps along the street below the line, and in the lot
    const lamps = new GlowPoints(400, 0.7, { fogDensity: 0.0012 });
    let n = 0;
    for (let x = -520; x < 420 && n < 398; x += 22) for (const z of [-15, 7]) lamps.set(n++, x + (z > 0 ? 11 : 0), 6.5, z, new THREE.Color(1, 0.55, 0.22), 1.2, 1);
    for (let i = 0; n < 400; i++) lamps.set(n++, -260 + r() * 600, 6, 50 + r() * 320, new THREE.Color(1, 0.6, 0.3), 0.8 + r() * 0.6, 1);
    lamps.commit();
    this.add(lamps);
  }

  /** The black tower: dark glass, a few lit windows. */
  tower(cx: number, cz: number, w: number, d: number, h: number) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    g.setAttribute('aB', new THREE.Float32BufferAttribute(new Array(g.attributes.position!.count).fill(0).flatMap(() => [77.7, 0.2, 1, 0.012]), 4));
    const t = new THREE.Mesh(g, facadeMat(this.mat.uniforms as unknown as LightU, true));
    t.position.set(cx, 0, cz);
    return t;
  }
}

/** Facades: a grid of windows on each side face (homes 3.2 m cells, offices 1.6 x 3.9), lit by chance. */
function facadeMat(U: LightU, glassTower = false) {
  return new THREE.ShaderMaterial({
    defines: glassTower ? { TOWER: 1 } : {},
    uniforms: { ...U },
    vertexShader: /* glsl */ `
      attribute vec4 aB; varying vec3 vW; varying vec3 vN; varying vec4 vB; varying vec3 vS;
      void main() {
        vec4 lp = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        lp = instanceMatrix * lp;
        vS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      #else
        vS = vec3(1.0);
      #endif
        vec4 w = modelMatrix * lp; vW = w.xyz; vN = normal; vB = aB;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogC; uniform float uFogD, uTime;
      varying vec3 vW; varying vec3 vN; varying vec4 vB; varying vec3 vS;
      float hh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 N = normalize(vN);
        vec3 c;
        float office = vB.z;
        if (abs(N.y) > 0.5) c = vec3(0.01, 0.01, 0.013);
        else {
          vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
          float u = dot(vW, T), v = vW.y;
          vec2 cell = office > 0.5 ? vec2(1.6, 3.9) : vec2(3.2, 3.2);
          vec2 g = vec2(u, v) / cell, id = floor(g), f = fract(g);
          vec2 lo = office > 0.5 ? vec2(0.08, 0.2) : vec2(0.28, 0.28), hi = office > 0.5 ? vec2(0.92, 0.95) : vec2(0.72, 0.85);
          vec2 fw = fwidth(g); float px = max(fw.x, fw.y);
          float aa = 0.5 * px;
          float inWin = smoothstep(lo.x - aa, lo.x + aa, f.x) * smoothstep(hi.x + aa, hi.x - aa, f.x) * smoothstep(lo.y - aa, lo.y + aa, f.y) * smoothstep(hi.y + aa, hi.y - aa, f.y);
          float seed = hh(vec3(vB.x + dot(N, vec3(1.0, 2.0, 3.0)) * 7.0, id));
          float lit = step(seed, vB.w) * step(1.0, id.y);
          float kind = hh(vec3(seed * 31.0, vB.x, 3.0));
          vec3 warm = vec3(1.0, 0.64, 0.34), cool = vec3(0.75, 0.85, 1.0), tv = vec3(0.35, 0.5, 1.0);
          vec3 Lc = kind < 0.55 + 0.35 * vB.y ? warm : kind < 0.9 ? mix(warm, cool, 0.6) : tv;
          float Li = 0.28 + 0.42 * hh(vec3(seed, 4.0, 4.0));
          // a room: the lamp's pool on the ceiling, darker below, a curtain on one side, the window's cross bars
          vec2 wf = (f - lo) / (hi - lo);
          float lamp = 0.45 + 0.9 * exp(-pow(wf.x - 0.3 - 0.4 * hh(vec3(seed, 5.0, 2.0)), 2.0) * 9.0) * smoothstep(0.2, 0.95, wf.y);
          float cur = step(0.6, hh(vec3(seed, 11.0, 1.0))) * step(wf.x, 0.25 + 0.3 * hh(vec3(seed, 12.0, 1.0)));
          float bars = office > 0.5 ? 0.0 : max(step(abs(wf.x - 0.5), 0.03), step(abs(wf.y - 0.62), 0.03));
          vec3 glass = vec3(0.012, 0.014, 0.022) + vec3(0.03, 0.035, 0.05) * wf.y;
          vec3 win = (Lc * Li * lamp * lit * (1.0 - 0.6 * cur) + glass + (1.0 - lit) * step(0.95, kind) * tv * 0.1) * (1.0 - 0.85 * bars);
          vec3 wall = office > 0.5 ? vec3(0.008, 0.01, 0.016) : mix(vec3(0.03, 0.017, 0.012), vec3(0.022, 0.021, 0.024), step(0.6, vB.y));
          wall += vec3(1.0, 0.55, 0.25) * 0.05 * exp(-v / 8.0);
          float far = smoothstep(0.25, 0.6, px);
          vec3 avg = mix(wall, Lc * Li * 0.4 * step(seed, vB.w), (hi.x - lo.x) * (hi.y - lo.y));
          c = mix(mix(wall, win, inWin), avg, far);
        #ifdef TOWER
          c = mix(vec3(0.004, 0.005, 0.009), c, 0.6) + vec3(0.01, 0.012, 0.02) * (1.0 - inWin);
        #endif
        }
        float d = length(vW - cameraPosition);
        c = mix(vec3(0.03, 0.025, 0.03), c, exp(-0.0011 * 0.0011 * d * d));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** The ground under the backdrop: dark lots, the street under the line with sodium pools and lane marks. */
function groundMat(U: LightU) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: /* glsl */ `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        float zs = abs(vW.z + 4.0);
        float street = 1.0 - smoothstep(13.0, 14.0, zs);
        vec3 c = mix(vec3(0.006, 0.007, 0.01), vec3(0.018, 0.017, 0.02), street);
        float pool = exp(-pow(mod(vW.x, 22.0) - 11.0, 2.0) / 30.0) * exp(-pow(zs - 9.0, 2.0) / 40.0);
        c += vec3(1.0, 0.5, 0.17) * pool * 0.25 * street;
        c += vec3(0.6, 0.45, 0.1) * 0.12 * step(abs(zs - 0.15), 0.08) * step(0.5, fract(vW.x / 6.0)) * street;
        float d = length(vW - cameraPosition);
        c = mix(vec3(0.03, 0.025, 0.03), c, exp(-0.0012 * 0.0012 * d * d));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

function billboardTextures() {
  const W = 1024, H = 480;
  const t1 = canvasTex(W, H, (c) => {
    const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1c3cff'); g.addColorStop(1, '#00c2ff'); c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = '#0a0f2a'; c.fillRect(620, 40, 220, 400); c.fillStyle = '#bfe8ff'; c.fillRect(636, 70, 188, 340);
    c.fillStyle = '#fff'; c.font = font(F.archivo(125, 900), 110); c.fillText('NEW', 60, 200); c.font = font(F.archivo(100, 500), 48); c.fillText('brighter than ever', 64, 290);
  });
  const t2 = canvasTex(W, H, (c) => {
    c.fillStyle = '#ffd23a'; c.fillRect(0, 0, W, H); c.strokeStyle = '#111'; c.lineWidth = 40;
    c.beginPath(); c.arc(W / 2, 170, 210, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
    c.fillStyle = '#111'; c.beginPath(); c.arc(W / 2 - 110, 120, 30, 0, 7); c.arc(W / 2 + 110, 120, 30, 0, 7); c.fill();
  });
  const t3 = canvasTex(W, H, (c) => {
    c.fillStyle = '#111'; c.fillRect(0, 0, W, H); c.fillStyle = '#ff2d55'; c.font = font(F.archivo(75, 900), 230); c.fillText('24/7', 120, 330);
  });
  // blade signs with symbols, not words (the words on screen are the song's)
  const glyph = (bg: string, fg: string, kind: 'cross' | 'cup' | 'arrow') => canvasTex(256, 640, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, 256, 640); c.fillStyle = fg; c.strokeStyle = fg; c.lineWidth = 22;
    if (kind === 'cross') { c.fillRect(98, 120, 60, 200); c.fillRect(28, 190, 200, 60); c.fillRect(98, 400, 60, 120); }
    if (kind === 'cup') { c.beginPath(); c.moveTo(50, 200); c.lineTo(80, 420); c.lineTo(176, 420); c.lineTo(206, 200); c.closePath(); c.stroke(); c.beginPath(); c.arc(210, 290, 40, -1.2, 1.2); c.stroke(); for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(90 + i * 38, 170); c.bezierCurveTo(70 + i * 38, 130, 110 + i * 38, 110, 90 + i * 38, 70); c.stroke(); } }
    if (kind === 'arrow') { for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(60, 120 + i * 120); c.lineTo(128, 60 + i * 120); c.lineTo(196, 120 + i * 120); c.stroke(); } }
  });
  return [t1, t2, t3, glyph('#001a10', '#30ff9a', 'cross'), glyph('#200008', '#ff4060', 'cup'), glyph('#1a1000', '#ffb030', 'arrow')];
}
