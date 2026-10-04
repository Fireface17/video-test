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
import { FLOOR_Y, boxG, canvasTex, glowMat, litMat, moonMat, skyMat, type LightU } from './train-gfx';

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
  x0: -10, x1: 24, zWall: -9.2, zEdge: -1.56, canopy: FLOOR_Y + 3.9,
  stairX: 6.5, stairN: 49, run: 0.305, sz0: -8.6, sz1: -4.4,
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
  tower!: THREE.InstancedMesh;
  towerBeacon = new GlowPoints(2, 1.2);
  lamps: GlowPoints;
  lampPoles: THREE.InstancedMesh;
  lampX: number[] = [];
  signs: THREE.Group = new THREE.Group();

  constructor(U: LightU, ride: Ride, moonDir: THREE.Vector3) {
    super();
    this.moonDir = moonDir.clone().normalize();
    // the city: a street grid whose avenue runs under the line (z = 0) and a cross street at the station (x = 0);
    // on the moon side (+z) a stretch of empty blocks so the moon can be seen low over the far roofs
    const OFF = new THREE.Vector3(-50, 0, -50);
    const clear: [number, number, number][] = [];
    for (let x = -230; x <= 300; x += 55) for (let z = 45; z <= 330; z += 55) clear.push([x - OFF.x, z - OFF.z, 48]);
    this.city = new City({ seed: 29, half: 1600, block: 110, street: 30, centre: [-420 - OFF.x, 1000 - OFF.z], downtownR: 520, clear, fog: 0.00105 });
    this.city.position.copy(OFF);
    this.add(this.city);
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
    const zf = 210;
    const c = camAt(tCover);
    const k = (zf - c.z) / this.moonDir.z;
    const xEdge = c.x + this.moonDir.x * k;
    const w = 46, d = 40, h = 138;
    const g = new THREE.BoxGeometry(1, 1, 1);
    g.translate(0, 0.5, 0);
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array([73.1, 0.015, 0.3, 1]), 4));
    g.setAttribute('aTop', new THREE.InstancedBufferAttribute(new Float32Array([h]), 1));
    this.tower = new THREE.InstancedMesh(g, this.city.mat, 1);
    // the leading (+x… the line runs +x, so the tower slides toward -x in view) edge is its -x face
    this.tower.setMatrixAt(0, new THREE.Matrix4().makeScale(w, h, d).setPosition(xEdge + w / 2, 0, zf + d / 2));
    this.tower.frustumCulled = false;
    this.add(this.tower);
    this.towerBeacon.set(0, xEdge + w / 2, h + 3, zf + d / 2, new THREE.Color(1, 0.08, 0.04), 2.5, 1);
    this.towerBeacon.commit(1);
    this.add(this.towerBeacon);
    return xEdge;
  }

  /** Per frame: the city's clock, the sky and moon around the camera, the beacon's blink. */
  update(t: number, cam: THREE.Camera, moonK: number) {
    this.city.update(t, cam.position);
    this.sky.position.copy(cam.position);
    const D = 2600, R = 0.03 * D;
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
  const blade = (bg: string, fg: string, txt: string) => canvasTex(256, 640, (c) => {
    c.fillStyle = bg; c.fillRect(0, 0, 256, 640); c.fillStyle = fg; c.font = font(F.archivo(62, 900), 120); c.textAlign = 'center';
    Array.from(txt).forEach((ch, i) => c.fillText(ch, 128, 130 + i * 112));
  });
  return [t1, t2, t3, blade('#200008', '#ff4060', 'HOTEL'), blade('#001a10', '#30ff9a', 'BAR'), blade('#1a1000', '#ffb030', 'OPEN')];
}

// ------------------------------------------------------------------------------------------------- the station

export class Station extends THREE.Group {
  lightsOn = new Float32Array(8);
  fixtures: THREE.InstancedMesh;
  lampPos: THREE.Vector3[] = [];
  riserMat: THREE.ShaderMaterial;

  constructor(U: LightU, riser: { sharp: THREE.Texture; glow: THREE.Texture; boxes: THREE.Vector4[] }) {
    super();
    const Y = FLOOR_Y;
    const concrete = litMat(U, { color: new THREE.Color(0.12, 0.12, 0.125), pattern: 5 });
    const tiles = litMat(U, { color: new THREE.Color(0.55, 0.55, 0.52), pattern: 4 });
    const steel = litMat(U, { color: new THREE.Color(0.07, 0.075, 0.085), spec: 0.6, shin: 40 });
    const yellow = litMat(U, { color: new THREE.Color(0.6, 0.42, 0.03), pattern: 5 });
    const band = litMat(U, { color: new THREE.Color(0.03, 0.12, 0.3) });
    // platform (with the stairwell cut out of it)
    const { x0, x1, zWall, zEdge, stairX, sz0, sz1 } = ST;
    const pf: THREE.BufferGeometry[] = [
      boxG(x0, x1, Y - 0.3, Y, sz1, zEdge - 0.5),
      boxG(x0, stairX, Y - 0.3, Y, zWall, sz1),
      boxG(x0, x1, Y - 0.3, Y, zWall, sz0),
    ];
    this.add(new THREE.Mesh(mergeGeometries(pf), concrete));
    this.add(new THREE.Mesh(boxG(x0, x1, Y - 0.3, Y + 0.004, zEdge - 0.5, zEdge), yellow));
    // the wall: tiles, a blue band; it runs down to the street (the station's side)
    this.add(new THREE.Mesh(boxG(x0, x1, 0, ST.canopy, zWall - 0.3, zWall), tiles));
    this.add(new THREE.Mesh(boxG(x0, x1, Y + 0.95, Y + 1.12, zWall + 0.0, zWall + 0.02), band));
    // the canopy and its light fixtures (four rows of tubes in segments that switch on one after another)
    this.add(new THREE.Mesh(boxG(x0, x1, ST.canopy, ST.canopy + 0.25, zWall, zEdge + 0.4), steel));
    const nSeg = 8, segL = (x1 - x0) / nSeg;
    this.fixtures = new THREE.InstancedMesh(new THREE.BoxGeometry(segL * 0.8, 0.05, 0.16), new THREE.MeshBasicMaterial({ color: 0xffffff }), nSeg * 2);
    for (let i = 0; i < nSeg; i++) for (let r = 0; r < 2; r++) {
      const x = x0 + (i + 0.5) * segL, z = r ? -6.4 : -3.0;
      this.fixtures.setMatrixAt(i * 2 + r, new THREE.Matrix4().makeTranslation(x, ST.canopy - 0.03, z));
      this.fixtures.setColorAt(i * 2 + r, new THREE.Color(0, 0, 0));
      if (r === 0) this.lampPos.push(new THREE.Vector3(x, ST.canopy - 0.3, -4.6));
    }
    this.add(this.fixtures);
    // canopy columns against the wall and at the platform's back
    const cols: THREE.BufferGeometry[] = [];
    for (let x = x0 + 2; x < x1; x += 8) cols.push(boxG(x - 0.12, x + 0.12, Y, ST.canopy, zWall + 0.05, zWall + 0.3));
    // the structure under the platform
    for (let x = x0 + 1; x < x1; x += 7) for (const z of [-3.0, -8.9]) cols.push(boxG(x - 0.25, x + 0.25, 0, Y - 0.3, z - 0.25, z + 0.25));
    this.add(new THREE.Mesh(mergeGeometries(cols), steel));
    // benches and a bin on the platform
    const furn: THREE.BufferGeometry[] = [];
    for (const x of [-6.5, -1.5]) furn.push(boxG(x - 0.9, x + 0.9, Y + 0.42, Y + 0.48, zWall + 0.3, zWall + 0.75), boxG(x - 0.9, x + 0.9, Y + 0.48, Y + 0.9, zWall + 0.3, zWall + 0.36), boxG(x - 0.8, x - 0.7, Y, Y + 0.42, zWall + 0.4, zWall + 0.7), boxG(x + 0.7, x + 0.8, Y, Y + 0.42, zWall + 0.4, zWall + 0.7));
    this.add(new THREE.Mesh(mergeGeometries(furn), steel));
    // the stair: solid steps whose risers carry the painted words
    this.riserMat = riserMaterial(U, riser);
    const steps: THREE.BufferGeometry[] = [];
    for (let i = 0; i < ST.stairN - 1; i++) {
      const xa = stairX + i * ST.run, xb = xa + ST.run, yTop = Y - (i + 1) * RISE;
      steps.push(boxG(xa, xb, Math.max(0, yTop - RISE - 0.3), yTop, sz0, sz1));
    }
    this.add(new THREE.Mesh(mergeGeometries(steps), this.riserMat));
    // the stairwell: the balustrade toward the line follows the slope; nosings
    const L = Math.hypot(STAIR_FOOT - stairX, Y), ang = Math.atan2(Y, STAIR_FOOT - stairX);
    const bal = new THREE.Mesh(boxG(-L / 2, L / 2, 0, 1.05, -0.08, 0.08), steel);
    bal.position.set((stairX + STAIR_FOOT) / 2, Y / 2, sz1 - 0.08);
    bal.rotation.z = -ang;
    const rail = new THREE.Mesh(boxG(-L / 2, L / 2, 0.95, 1.02, -0.05, 0.05), litMat(U, { color: new THREE.Color(0.4, 0.4, 0.42), spec: 1.2, shin: 50 }));
    rail.position.set((stairX + STAIR_FOOT) / 2, Y / 2, sz0 + 0.12);
    rail.rotation.z = -ang;
    this.add(bal, rail);
    // the railing around the opening on the platform
    this.add(new THREE.Mesh(boxG(stairX, x1, Y, Y + 1.05, sz1 - 0.04, sz1 + 0.04), steel));
  }

  /** Station lights: segment levels 0..1 (the canopy fixtures in pairs). */
  update() {
    const c = new THREE.Color();
    for (let i = 0; i < this.lightsOn.length; i++) for (let r = 0; r < 2; r++) this.fixtures.setColorAt(i * 2 + r, c.setRGB(0.85, 0.92, 1.0).multiplyScalar(0.03 + 2.2 * this.lightsOn[i]!));
    this.fixtures.instanceColor!.needsUpdate = true;
  }
}

/**
 * Concrete steps whose risers (the faces toward +x) carry words painted in light: the words are laid out in the
 * stair's elevation (z across, y up), so seen from the foot of the stair they read as one image.
 */
function riserMaterial(U: LightU, riser: { sharp: THREE.Texture; glow: THREE.Texture; boxes: THREE.Vector4[] }) {
  const m = litMat(U, { color: new THREE.Color(0.1, 0.1, 0.105), pattern: 5 });
  const boxes = riser.boxes.slice(0, 8);
  while (boxes.length < 8) boxes.push(new THREE.Vector4());
  m.uniforms.uSharp = { value: riser.sharp };
  m.uniforms.uGlowT = { value: riser.glow };
  m.uniforms.uBox = { value: boxes };
  m.uniforms.uLv = { value: new Float32Array(8) };
  m.uniforms.uWC = { value: new THREE.Color(0.2, 0.9, 1.0) };
  m.fragmentShader = m.fragmentShader
    .replace('void main() {', /* glsl */ `
      uniform sampler2D uSharp, uGlowT; uniform vec4 uBox[8]; uniform float uLv[8]; uniform vec3 uWC;
      void main() {`)
    .replace('gl_FragColor = vec4(fogged(c, vW), 1.0);', /* glsl */ `
        // the painted words: elevation coordinates (u across the stair, v up)
        vec2 e = vec2((${ST.sz1.toFixed(3)} - vW.z) / ${(ST.sz1 - ST.sz0).toFixed(3)}, vW.y / ${FLOOR_Y.toFixed(3)});
        if (e.x > 0.0 && e.x < 1.0 && e.y > 0.0 && e.y < 1.0) {
          float lv = 0.0;
          for (int i = 0; i < 8; i++) { vec4 b = uBox[i]; if (e.x > b.x && e.x < b.z && e.y > b.y && e.y < b.w) lv = uLv[i]; }
          float riser = smoothstep(0.5, 0.8, n.x);
          float s = texture2D(uSharp, e).r, g = texture2D(uGlowT, e).r;
          c += uWC * lv * (s * 2.4 * riser + g * 0.5 * (0.35 + 0.65 * riser)) + vec3(lv * s * riser * 0.6);
        }
        gl_FragColor = vec4(fogged(c, vW), 1.0);`);
  return m;
}

export { hash };
