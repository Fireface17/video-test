// Props of the overpass break: the overpass deck's edge where they stand (concrete parapet, a steel pipe
// railing, lamp posts), their breath steaming in the cold, a tug sliding down the river with its lights.
import * as THREE from 'three';
import { KitBuilder, M } from '../lib/city-build';
import type { City } from '../lib/city';
import type { RealFigure } from '../lib/people';
import { GlowPoints } from '../lib/points';
import { hash } from '../../engine/util';
import { placeKit } from './run-props';

/**
 * (Stand-in until the city's overpass has its walkway.) The overpass's walkway along its west side: a strip of
 * deck from the railing at `railX` to a jersey barrier 3 m in, the steel railing on a low curb (with a missing
 * panel at `gapZ`, the edge open), lamp posts on the barrier; z from z0 to z1 (world coordinates).
 */
export function walkwayKit(railX: number, y: number, z0: number, z1: number, gapZ: number) {
  const k = new KitBuilder();
  const conc = [0.2, 0.2, 0.195, M.ALB], walk = [0.13, 0.13, 0.13, M.ALB], steel = [0.12, 0.13, 0.14, M.ALB];
  const L = z1 - z0, zc = (z0 + z1) / 2;
  k.box(railX + 1.5, y - 0.12, zc, 3.1, 0.24, L, walk); // the walkway
  k.box(railX - 0.1, y - 0.7, zc, 0.5, 1.4, L, conc); // the edge beam
  k.box(railX + 0.08, y + 0.12, zc, 0.22, 0.24, L, conc); // the curb under the railing
  k.box(railX + 3.15, y + 0.42, zc, 0.35, 0.84, L, conc); // the jersey barrier
  for (let z = z0 + 1; z < z1; z += 1.8) {
    if (Math.abs(z - gapZ) < 1.6) continue;
    k.box(railX + 0.08, y + 0.68, z, 0.05, 0.9, 0.05, steel);
  }
  for (const [a, b] of [[z0, gapZ - 1.5], [gapZ + 1.5, z1]] as const) {
    for (const yy of [y + 0.6, y + 1.1]) k.box(railX + 0.08, yy, (a + b) / 2, 0.05, 0.05, b - a, steel);
  }
  for (const z of [103, 139]) {
    k.box(railX + 3.15, y + 3.7, z, 0.16, 6.6, 0.16, steel);
    k.box(railX + 2.6, y + 6.95, z, 1.2, 0.1, 0.12, steel);
    k.box(railX + 2.1, y + 6.85, z, 0.45, 0.1, 0.28, [1.6, 1.3, 0.9, M.LIGHT]);
  }
  return k;
}

/** Breath steaming: on every out-breath a soft puff leaves the mouth, drifts and spreads, fading. */
export class Breath extends GlowPoints {
  constructor(n: number) { super(n, 0.07); }

  /** figs: [figure, breathing phase (cycles), strength]. */
  update(t: number, figs: [RealFigure, number, number][]) {
    let j = 0;
    const per = Math.floor(this.n / figs.length);
    figs.forEach(([fig, ph, k], fi) => {
      const head = fig.headPoint(new THREE.Vector3());
      const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(fig.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      const mouth = head.addScaledVector(fw, 0.11).add(new THREE.Vector3(0, -0.07, 0));
      // the last four out-breaths (each at phase n + 0.5), each a puff of particles
      const cur = Math.floor(ph - 0.5);
      for (let b = 0; b < 4; b++) {
        const n = cur - b, age = (ph - (n + 0.5)) / Math.max(0.3, 1.2 - 0.0); // in breath cycles
        for (let i = 0; i < per / 4; i++, j++) {
          if (j >= this.n) return;
          if (age < 0 || age > 1.6) { this.hide(j); continue; }
          const r1 = hash(fi, n, i, 1), r2 = hash(fi, n, i, 2), r3 = hash(fi, n, i, 3);
          const a = age;
          const p = mouth.clone().addScaledVector(fw, 0.25 * a + 0.05 * r1).add(new THREE.Vector3((r2 - 0.5) * 0.18 * a, 0.06 * a + (r3 - 0.5) * 0.12 * a, (r1 - 0.5) * 0.18 * a));
          p.x += 0.12 * a * a; // the river wind
          const fade = Math.min(1, a * 6) * Math.max(0, 1 - a / 1.6);
          this.set(j, p.x, p.y, p.z, [0.55, 0.62, 0.8], 0.05 * k * fade, 1.2 + 3 * a);
        }
      }
    });
    for (; j < this.n; j++) this.hide(j);
    this.commit();
  }
}

/** A tug pushing down the river in the half-light: dark hull, lit wheelhouse, its mast lights and wake. */
export class Tug extends THREE.Group {
  lights = new GlowPoints(40, 0.35);
  body: THREE.Mesh;
  constructor(city: City, public x = 1232, public z0 = 120, public v = 2.2) {
    super();
    const k = new KitBuilder();
    const hull = [0.04, 0.035, 0.035, M.ALB], deck = [0.12, 0.1, 0.08, M.ALB], white = [0.35, 0.35, 0.33, M.ALB];
    k.box(0, 0.6, 0, 3.6, 1.6, 9, hull);
    k.box(0, 1.5, 0.5, 3.4, 0.2, 8.4, deck);
    k.box(0, 2.6, -1.2, 2.6, 2.0, 3.2, white);
    k.box(0, 4.1, -1.4, 2.0, 1.1, 1.9, white);
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.box(s * 1.31, 2.9, -2.2 + i * 1.0, 0.02, 0.6, 0.6, [1.4, 1.0, 0.6, M.LIGHT]);
    k.box(0, 4.15, -0.43, 1.6, 0.5, 0.02, [1.3, 1.0, 0.7, M.LIGHT]);
    k.box(0, 5.8, -1.6, 0.12, 2.4, 0.12, [0.1, 0.1, 0.1, M.ALB]);
    this.body = placeKit(city, k, 0, 0, 0);
    this.add(this.body, this.lights);
  }

  update(t: number) {
    const z = this.z0 + this.v * t - this.v * 147;
    this.body.position.set(this.x, 0, z);
    this.body.updateMatrix();
    const L = this.lights;
    let j = 0;
    L.set(j++, this.x, 7.1, z - 1.6, [1, 0.95, 0.85], 1.6, 1);
    L.set(j++, this.x - 1.7, 3.6, z + 0.2, [0.1, 1, 0.3], 1.2, 0.8);
    L.set(j++, this.x + 1.7, 3.6, z + 0.2, [1, 0.1, 0.05], 1.2, 0.8);
    // the wake: reflections trailing behind, rocking
    for (let i = 0; i < 30; i++) {
      const d = 4.5 + i * 1.6, sx = (i % 2 ? 1 : -1) * (0.6 + i * 0.12);
      L.set(j++, this.x + sx, 0.05, z - d, [1, 0.8, 0.55], 0.25 * (1 - i / 30) * (0.6 + 0.4 * Math.sin(t * 5 + i)), 1.4);
    }
    L.commit(j);
  }
}

/**
 * The night ending: a pale band along the eastern horizon (behind the river) and a lift of deep blue above it,
 * growing with `k` (0..1). A big dome around the camera (keep its centre on the camera), additive over the sky,
 * hidden by anything in front of it.
 */
export class DawnBand extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  constructor(east = new THREE.Vector3(1, 0, -0.15).normalize(), radius = 6500) {
    super(new THREE.SphereGeometry(radius, 64, 32), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      // (premultiplied: the glow adds, the clouds cover the sky behind them)
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: { k: { value: 0 }, east: { value: east } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float k; uniform vec3 east; varying vec3 vD;
        float hh(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hh(i), hh(i + vec2(1.0, 0.0)), f.x), mix(hh(i + vec2(0.0, 1.0)), hh(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p) { return 0.5 * vn(p) + 0.27 * vn(p * 2.07 + 5.3) + 0.15 * vn(p * 4.3 + 1.7) + 0.08 * vn(p * 8.9 + 9.1); }
        void main() {
          vec3 d = normalize(vD);
          float h = max(d.y, -0.02);
          vec2 dh = d.xz; float l = length(dh); dh = l > 1e-4 ? dh / l : vec2(0.0);
          float toE = max(dot(dh, normalize(east.xz)), 0.0);
          float side = 0.25 + 0.75 * pow(toE, 2.0);
          // a thin pale band right on the horizon, a soft rose-gold glow toward the sun under it, a lift of blue above
          float band = exp(-pow(h / 0.035, 2.0)) * side;
          float glow = exp(-h / 0.12) * pow(toE, 6.0);
          float lift = exp(-h / 0.5) * (0.3 + 0.7 * toE);
          vec3 c = vec3(0.55, 0.62, 0.78) * band * 0.22 + vec3(0.6, 0.38, 0.3) * glow * 0.12 + vec3(0.03, 0.05, 0.11) * lift;
          // long thin stratus low over the horizon all round, thickest in the east: slate bodies, their undersides
          // lit rose and gold by the sun still under the horizon (brighter the lower and the more to the east)
          float az = atan(d.z, d.x);
          vec2 q = vec2(az * 6.0, h * 60.0 - az * 2.0);
          float n = fbm(q + vec2(0.0, fbm(q * 0.5) * 1.5));
          float win = smoothstep(0.03, 0.06, h) * (1.0 - smoothstep(0.16, 0.32, h));
          float cov = mix(0.62, 0.5, toE);
          float dens = smoothstep(cov, cov + 0.16, n) * win;
          float under = clamp((n - fbm(q + vec2(0.0, 1.2) + vec2(0.0, fbm((q + vec2(0.0, 1.2)) * 0.5) * 1.5))) * 4.0 + 0.3, 0.0, 1.0);
          float litK = (0.25 + 0.75 * pow(toE, 3.0)) * (1.0 - smoothstep(0.05, 0.3, h));
          vec3 body = vec3(0.02, 0.026, 0.05) + vec3(0.05, 0.06, 0.11) * (0.4 + 0.6 * toE);
          vec3 lit = mix(vec3(0.5, 0.3, 0.32), vec3(0.85, 0.5, 0.3), pow(toE, 4.0)) * 0.3;
          vec3 cc = body + lit * litK * under * k;
          float a = dens * 0.85;
          gl_FragColor = vec4((c * k * (1.0 - a) + cc * a) * step(-0.02, d.y), a * step(-0.02, d.y));
        }`,
    }));
    this.frustumCulled = false;
    this.renderOrder = 5;
  }
  set k(v: number) { this.material.uniforms.k!.value = v; }
}
