// A night city: thousands of instanced buildings whose windows are drawn in the shader (lit at random per
// floor and column, warm and cold, a few flickering TVs), streetlights along a street grid, and headlights /
// tail lights moving along the streets. Everything fogs with distance. `wake` (0..1) sets how many windows
// are lit, and `wakeFrom` / `wakeR` light them in a wave spreading from a point (for "wake the whole town").
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';
import { GlowPoints } from './points';

export interface CityOpts {
  seed?: number;
  /** Half-size of the city (m). */
  half?: number;
  /** Block pitch and street width (m). */
  block?: number;
  street?: number;
  /** Downtown centre (x, z) and its radius (m): buildings are taller there. */
  centre?: [number, number];
  downtownR?: number;
  /** Keep this circle (x, z, r) free of generated buildings (e.g. the hero's own block). */
  clear?: [number, number, number];
  fog?: number;
  fogColor?: THREE.Color;
}

export class City extends THREE.Group {
  buildings: THREE.InstancedMesh;
  mat: THREE.ShaderMaterial;
  lamps: GlowPoints;
  cars: GlowPoints;
  carPaths: { x0: number; z0: number; dx: number; dz: number; len: number; speed: number; off: number; dir: number }[] = [];
  /** Building footprints (x, z, w, d, h) — e.g. to put things on roofs. */
  boxes: [number, number, number, number, number][] = [];

  constructor(o: CityOpts = {}) {
    super();
    const r = mulberry32(o.seed ?? 3);
    const half = o.half ?? 1600, block = o.block ?? 110, street = o.street ?? 22;
    const [cx, cz] = o.centre ?? [0, -700];
    const dR = o.downtownR ?? 450;
    const clear = o.clear;
    // buildings: each block is split into 1-4 lots
    for (let bx = -half; bx < half; bx += block) {
      for (let bz = -half; bz < half; bz += block) {
        const inner = block - street;
        const n = 1 + Math.floor(r() * 3.2);
        for (let k = 0; k < n; k++) {
          const w = inner / (n > 2 ? 2 : n) * (0.75 + r() * 0.2), d = inner * (n > 2 ? 0.45 : 0.85) * (0.8 + r() * 0.2);
          const x = bx + street / 2 + (n > 2 ? (k % 2) * inner / 2 : k * inner / n) + w / 2 + (r() - 0.5) * 4;
          const z = bz + street / 2 + (n > 2 ? Math.floor(k / 2) * inner / 2 : 0) + d / 2 + (r() - 0.5) * 4;
          if (clear && Math.hypot(x - clear[0], z - clear[1]) < clear[2]) continue;
          const dist = Math.hypot(x - cx, z - cz);
          const down = Math.exp(-(dist * dist) / (dR * dR));
          let h = 9 + Math.pow(r(), 2.2) * 30 + down * (40 + Math.pow(r(), 1.5) * 190);
          if (r() < 0.02) h += 60;
          this.boxes.push([x, z, w, d, h]);
        }
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const fogC = o.fogColor ?? new THREE.Color(0.012, 0.016, 0.05);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        fogD: { value: o.fog ?? 0.0009 }, fogC: { value: fogC },
        wake: { value: 1 }, wakeFrom: { value: new THREE.Vector3(0, 0, 0) }, wakeR: { value: 1e9 }, wakeSoft: { value: 120 },
        gold: { value: 0 }, goldFrom: { value: new THREE.Vector3() }, goldR: { value: 1e9 }, t: { value: 0 }, gain: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aB; // building seed, density, warmth, unused
        varying vec3 vL; varying vec3 vN; varying vec3 vW; varying vec4 vB; varying vec3 vS;
        void main() {
          vec3 s = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vS = s; vL = position * s; vN = normal; vB = aB;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float fogD, wake, wakeR, wakeSoft, gold, goldR, t, gain; uniform vec3 fogC, wakeFrom, goldFrom;
        varying vec3 vL; varying vec3 vN; varying vec3 vW; varying vec4 vB; varying vec3 vS;
        float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          vec3 base = vec3(0.012, 0.014, 0.024);
          vec3 c = base;
          if (abs(vN.y) < 0.5) {
            // side face: a window grid (floors 3.3 m, bays 3.6 m); frames and spandrels stay dark
            float u = abs(vN.x) > 0.5 ? vL.z : vL.x;
            vec2 g = vec2((u + 200.0) / 3.6, vL.y / 3.3);
            float fl = floor(g.y), bay = floor(g.x);
            vec2 f = fract(g);
            // windows shrink to their average once a cell is only a few pixels (no shimmer in the distance)
            vec2 fw = fwidth(g);
            float px = max(fw.x, fw.y);
            float sharp = step(0.18, f.x) * step(f.x, 0.82) * step(0.28, f.y) * step(f.y, 0.86);
            float win = mix(sharp, 0.37, smoothstep(0.12, 0.45, px));
            float side = vN.x + vN.z * 2.0;
            float rnd = h(vec3(vB.x * 91.0 + side, fl, bay));
            float lit = step(rnd, vB.y * wake) * step(1.5, vL.y) * step(vL.y, vS.y - 1.5);
            float dw = length(vW.xz - wakeFrom.xz);
            lit *= 1.0 - smoothstep(wakeR - wakeSoft, wakeR, dw);
            float kind = h(vec3(vB.x * 13.0 + side, fl * 1.7, bay * 3.1));
            vec3 warm = vec3(1.0, 0.62, 0.3), cool = vec3(0.55, 0.7, 1.0), tv = vec3(0.35, 0.5, 1.0);
            vec3 wc = kind < 0.62 + 0.3 * vB.z ? warm : kind < 0.93 ? cool : tv * (0.6 + 0.4 * sin(t * 7.0 + rnd * 40.0));
            float dg = length(vW.xz - goldFrom.xz);
            float gIn = 1.0 - smoothstep(goldR - 80.0, goldR, dg);
            wc = mix(wc, vec3(1.0, 0.68, 0.18), gold * gIn);
            float gq = (dg - goldR) / 80.0;
            wc *= 1.0 + 2.5 * exp(-gq * gq) * gold * step(goldR, 1e8);
            float bright = 0.3 + 0.7 * h(vec3(fl, bay, vB.x));
            c += wc * win * lit * bright * 1.9 * gain;
            // the wave front flares as it passes
            float wq = (dw - wakeR) / max(wakeSoft, 1.0);
            c += wc * win * step(rnd, vB.y) * exp(-wq * wq) * 2.0 * step(0.0, wakeR - 1.0) * (1.0 - step(1e8, wakeR));
          } else {
            c = base * 0.7;
          }
          float d = length(vW - cameraPosition);
          float fog = exp(-fogD * fogD * d * d);
          gl_FragColor = vec4(mix(fogC, c, fog), 1.0);
        }`,
    });
    this.buildings = new THREE.InstancedMesh(geo, this.mat, this.boxes.length);
    const aB = new Float32Array(this.boxes.length * 4);
    const m = new THREE.Matrix4();
    this.boxes.forEach(([x, z, w, d, hgt], i) => {
      m.makeScale(w, hgt, d).setPosition(x, 0, z);
      this.buildings.setMatrixAt(i, m);
      const kind = r();
      aB.set([r() * 100, kind < 0.15 ? 0.03 + r() * 0.06 : kind > 0.9 ? 0.55 + r() * 0.3 : 0.1 + r() * 0.3, r(), 0], i * 4);
    });
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
    this.buildings.frustumCulled = false;
    this.add(this.buildings);

    // streetlights along every street line
    const lampPos: number[] = [];
    for (let s = -half; s <= half; s += block) {
      for (let a = -half; a <= half; a += 32) {
        lampPos.push(s + 2, a, a, s + 2);
      }
    }
    this.lamps = new GlowPoints(lampPos.length, 1.2, { fogDensity: o.fog ?? 0.0009 });
    for (let i = 0; i < lampPos.length; i += 2) {
      const k = i / 2;
      const c = new THREE.Color(1, 0.55, 0.2).multiplyScalar(0.5 + r() * 0.4);
      this.lamps.set(k, lampPos[i]!, 6, lampPos[i + 1]!, c, 1, 1);
    }
    this.lamps.commit();
    this.add(this.lamps);
    // cars: head/tail lights moving along random streets
    const nCars = 1400;
    this.cars = new GlowPoints(nCars, 0.9, { fogDensity: o.fog ?? 0.0009 });
    for (let i = 0; i < nCars; i++) {
      const alongX = r() < 0.5, line = -half + Math.floor(r() * (2 * half / block)) * block + street / 2 + (r() < 0.5 ? -3 : 3);
      this.carPaths.push({ x0: alongX ? -half : line, z0: alongX ? line : -half, dx: alongX ? 1 : 0, dz: alongX ? 0 : 1, len: 2 * half, speed: 9 + r() * 9, off: r() * 2 * half, dir: r() < 0.5 ? 1 : -1 });
    }
    this.add(this.cars);
  }

  /** Per frame: car positions (deterministic in t), the gold tint, the window clock. */
  update(t: number, camPos: THREE.Vector3) {
    this.mat.uniforms.t!.value = t;
    const g = this.mat.uniforms.gold!.value as number;
    this.carPaths.forEach((p, i) => {
      const s = (((p.off + p.dir * p.speed * t) % p.len) + p.len) % p.len;
      const x = p.x0 + p.dx * s, z = p.z0 + p.dz * s;
      const toward = (camPos.x - x) * p.dx * p.dir + (camPos.z - z) * p.dz * p.dir > 0;
      const c = toward ? new THREE.Color(1, 0.95, 0.85) : new THREE.Color(1, 0.08, 0.04);
      if (g > 0) c.lerp(new THREE.Color(1, 0.65, 0.2), g);
      this.cars.set(i, x, 1.2, z, c, toward ? 1.1 : 0.7, 1);
    });
    this.cars.commit();
  }

  set gold(k: number) { this.mat.uniforms.gold!.value = k; }
  /** A golden wave: inside radius `r` (m) around `from` the windows turn gold; the front flares. */
  goldWave(from: THREE.Vector3, r: number) { (this.mat.uniforms.goldFrom!.value as THREE.Vector3).copy(from); this.mat.uniforms.goldR!.value = r; }
  set wake(k: number) { this.mat.uniforms.wake!.value = k; }
}
