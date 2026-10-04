// Highway scene, environment: the night sky (gradient, stars, city-lit clouds, the dawn and the sun), the
// distant city (instanced towers with thousands of lit windows, aviation lights), the hills, and generic
// helpers (soft light streaks). The road, its furniture and the traffic are in highway-road.ts.
import * as THREE from 'three';
import { GlowPoints } from '../lib/points';
import { mulberry32 } from '../../engine/util';
import { HU, HW_GLSL } from './highway-common';

// ------------------------------------------------------------------------------------------- sky

export interface SkyState {
  dawn: number; // 0 night .. 1 golden
  sunDir: THREE.Vector3;
  sunK: number; // sun disc brightness
}

export const SKY_GLSL = /* glsl */ `
uniform vec3 sZen, sHor, sCity, sDawnLo, sDawnHi, sSunCol, sSunDir;
uniform float sDawn, sSunK;
vec3 skyCol(vec3 d) {
  float y = d.y, yy = max(y, 0.0);
  vec2 h = normalize(d.xz + vec2(1e-6));
  vec3 c = mix(sHor, sZen, pow(clamp(yy * 1.7, 0.0, 1.0), 0.55));
  // light pollution of the city ahead (-z): a low sodium dome
  float city = pow(max(-h.y, 0.0), 8.0);
  c += sCity * (city * exp(-yy * 16.0) + 0.15 * pow(max(-h.y, 0.0), 2.0) * exp(-yy * 5.0));
  // dawn: a warm band low on the horizon toward the sun, the whole sky lifting
  vec2 sa2 = normalize(sSunDir.xz + vec2(1e-6));
  float sa = max(dot(h, sa2), 0.0);
  c += sDawnLo * (pow(sa, 2.5) * exp(-yy * 7.0) + 0.35 * exp(-yy * 4.0) * (0.15 + 0.85 * sa * sa)) * sDawn;
  c += sDawnHi * pow(sa, 1.5) * exp(-yy * 2.2) * sDawn;
  float g = max(dot(d, sSunDir), 0.0);
  c += sSunCol * sSunK * (smoothstep(0.99975, 0.99985, g) * 40.0 + pow(g, 900.0) * 6.0 + pow(g, 90.0) * 0.6 + pow(g, 12.0) * 0.12);
  // below the horizon: dark land haze
  c = mix(c, sHor * 0.5, smoothstep(0.0, -0.08, y));
  return c;
}`;

export function skyUniforms() {
  return {
    sZen: { value: new THREE.Color() }, sHor: { value: new THREE.Color() }, sCity: { value: new THREE.Color() },
    sDawnLo: { value: new THREE.Color() }, sDawnHi: { value: new THREE.Color() }, sSunCol: { value: new THREE.Color() },
    sSunDir: { value: new THREE.Vector3(0, -0.1, 1).normalize() }, sDawn: { value: 0 }, sSunK: { value: 0 },
  };
}
export type SkyU = ReturnType<typeof skyUniforms>;

const lerpC = (a: THREE.Color, b: THREE.Color, k: number) => a.clone().lerp(b, k);
const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

export class Sky extends THREE.Group {
  u = skyUniforms();
  dome: THREE.Mesh;
  cloudMesh: THREE.Mesh;
  stars: GlowPoints;
  plane: GlowPoints;
  cu: Record<string, THREE.IUniform>;

  constructor(cloudTex: THREE.Texture) {
    super();
    const dome = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.u,
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: SKY_GLSL + /* glsl */ `varying vec3 vDir; void main(){ gl_FragColor = vec4(skyCol(normalize(vDir)), 1.0); }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4600, 48, 24), dome);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;

    // stars: magnitude-distributed, a faint milky band, hidden by the clouds drawn after them
    const r = mulberry32(911);
    const N = 2600;
    this.stars = new GlowPoints(N, 1);
    const band = new THREE.Vector3(0.55, 0.62, -0.56).normalize();
    for (let i = 0; i < N; i++) {
      let x = r() * 2 - 1, y = r(), z = r() * 2 - 1;
      // a third of them crowd a band across the sky
      if (i % 3 === 0) {
        const t = new THREE.Vector3(x, y, z).normalize();
        const off = t.dot(band);
        x -= band.x * off * 0.85; y -= band.y * off * 0.85; z -= band.z * off * 0.85;
      }
      const v = new THREE.Vector3(x, Math.abs(y) + 0.02, z).normalize().multiplyScalar(4300);
      const mag = Math.pow(r(), 5.5);
      const tint = r();
      const c = tint < 0.15 ? C('#ffd7b0') : tint < 0.35 ? C('#cfe0ff') : C('#f4f6ff');
      const el = v.y / 4300;
      this.stars.set(i, v.x, v.y, v.z, c, (0.1 + 2.2 * mag) * Math.min(1, el * 4), 7 + 16 * mag);
    }
    this.stars.commit();
    this.stars.renderOrder = -9;
    (this.stars.material as THREE.ShaderMaterial).depthTest = true;

    // the cloud deck: a plane-projected tiling texture, its underside lit by the city's sodium glow
    this.cu = {
      ...this.u, tex: { value: cloudTex }, off: { value: new THREE.Vector2() }, cover: { value: 0.55 },
      litCity: { value: new THREE.Color() }, litAmb: { value: new THREE.Color() }, litSun: { value: new THREE.Color() },
    };
    const cm = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, transparent: true, fog: false, uniforms: this.cu,
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: SKY_GLSL + /* glsl */ `
        uniform sampler2D tex; uniform vec2 off; uniform float cover; uniform vec3 litCity, litAmb, litSun;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          if (d.y < 0.004) discard;
          vec2 p = d.xz / (d.y + 0.045) * 0.11 + off;
          vec4 a = texture2D(tex, p);
          vec4 b = texture2D(tex, p * 2.7 + 0.31);
          float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.45, a.r * 0.75 + b.r * 0.35);
          float fade = smoothstep(0.004, 0.09, d.y);
          vec2 h = normalize(d.xz + vec2(1e-6));
          float city = pow(max(-h.y, 0.0), 2.0);
          float low = exp(-d.y * 3.5);
          vec2 sa2 = normalize(sSunDir.xz + vec2(1e-6));
          float sun = pow(max(dot(h, sa2), 0.0), 3.0);
          // thicker cloud reads darker on top, brighter rims where thin
          float thin = 1.0 - smoothstep(0.3, 1.0, a.g);
          vec3 col = litAmb * (0.6 + 0.4 * b.b) + litCity * (city * 1.4 + 0.25) * low * (0.6 + 0.6 * a.g) + litSun * (sun * 1.6 + 0.2) * (0.4 + 0.9 * thin) * low;
          float al = dens * fade;
          gl_FragColor = vec4(col * al, al * 0.92);
        }`,
    });
    cm.blending = THREE.CustomBlending;
    cm.blendSrc = THREE.OneFactor; cm.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(4450, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), cm);
    this.cloudMesh.renderOrder = -8;
    this.cloudMesh.frustumCulled = false;
    this.plane = new GlowPoints(4, 1);
    this.plane.renderOrder = -7;
    this.add(this.dome, this.stars, this.cloudMesh, this.plane);
  }

  /** Night → dawn colours, also writes the haze and ambient into the shared lighting uniforms. */
  update(camPos: THREE.Vector3, t: number, dawn: number, sunDir: THREE.Vector3, sunK: number, cloudDrift: number) {
    this.position.copy(camPos);
    const u = this.u;
    const d = dawn, d2 = Math.min(1, d * 1.6);
    u.sZen.value.copy(lerpC(C('#03050f', 0.6), C('#1f3a78', 0.75), Math.pow(d, 1.5)));
    u.sHor.value.copy(lerpC(C('#13204a', 0.6), C('#8ea3c8', 0.6), Math.pow(d, 1.3)));
    u.sCity.value.copy(C('#ff8a3a', 0.016 * (1 - 0.6 * d)));
    u.sDawnLo.value.copy(C('#ffa23a', 2.0));
    u.sDawnHi.value.copy(C('#ffbe6a', 0.32));
    u.sSunCol.value.copy(lerpC(C('#ff7a2a'), C('#ffd27a'), Math.min(1, sunK)));
    u.sSunDir.value.copy(sunDir);
    u.sDawn.value = d;
    u.sSunK.value = sunK;
    // clouds
    this.cu.off!.value.set(cloudDrift * 0.004 + 0.13, cloudDrift * 0.0015 + 0.71);
    this.cu.litCity!.value.copy(C('#ff8a4a', 0.07 * (1 - 0.5 * d)));
    this.cu.litAmb!.value.copy(lerpC(C('#2a3460', 0.05), C('#5a6890', 0.45), d));
    this.cu.litSun!.value.copy(C('#ff9d5c', 1.4 * d2));
    // haze & ambient (shared with every lit material)
    HU.uHazeLo.value.copy(u.sHor.value).multiplyScalar(0.8 - 0.25 * d);
    HU.uHazeCity.value.copy(C('#ff7a30', 0.02 * (1 - 0.6 * d)));
    HU.uHazeSun.value.copy(C('#ffb050', 1.1 * d * d));
    HU.uSunAz.value.set(sunDir.x, sunDir.z).normalize();
    HU.uAmbHi.value.copy(lerpC(C('#2a3870', 0.05), C('#a8b0c8', 0.3), Math.pow(d, 1.2)));
    HU.uAmbLo.value.copy(lerpC(C('#120f14', 0.03), C('#5a4a40', 0.12), d));
    // an airliner crossing high overhead: red / green navigation lights, white strobes
    const pa = (t - 17) * 0.012;
    const px = -900 + 1800 * pa, pz = -300 - 400 * pa, py = 1500;
    const strobe = (Math.floor(t * 60) % 72) < 4 ? 1 : 0;
    this.plane.set(0, px - 18, py, pz, C('#ff2a1a'), 2.2, 30);
    this.plane.set(1, px + 18, py, pz + 4, C('#38ff7a'), 2.0, 30);
    this.plane.set(2, px, py - 1, pz - 10, C('#ffffff'), 6 * strobe, 34);
    this.plane.set(3, px, py + 2, pz + 12, C('#ff3a2a'), 3 * ((Math.floor(t * 60) % 60) < 8 ? 1 : 0), 24);
    this.plane.commit();
    HU.uSunDir.value.copy(sunDir);
    HU.uFogD.value = 0.0042 - 0.0019 * d;
    HU.uSunCol.value.copy(C('#ffb060', 1.6 * Math.max(0, sunK - 0.1) * smoothK(sunDir.y)));
    void t;
  }
}
const smoothK = (y: number) => Math.min(1, Math.max(0, (y + 0.01) / 0.08));

// ------------------------------------------------------------------------------------------- city

export const CITY = { x: -180, z: -1900 };

/** The far city: instanced towers with procedural windows, aviation lights, and the hills around. */
export class City extends THREE.Group {
  towers: THREE.InstancedMesh;
  lights: GlowPoints;
  hills: THREE.Mesh;
  hillLights: GlowPoints;
  avi: { p: THREE.Vector3; phase: number; k: number }[] = [];
  u = { cDawn: { value: 0 }, cGlow: { value: new THREE.Color() }, cHaze: { value: new THREE.Color() }, cFog: { value: 0.00028 }, cTime: { value: 0 } };

  constructor() {
    super();
    const r = mulberry32(4242);
    const N = 360;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute vec4 bInfo; // seed, lit ratio, warmth, crown
        varying vec3 vW; varying vec2 vF; varying float vFace; varying vec4 vInfo; varying float vY; varying float vH;
        void main() {
          mat4 m = modelMatrix * instanceMatrix;
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec4 w = m * vec4(position, 1.0);
          vW = w.xyz;
          vec3 lp = position * sc;
          vFace = abs(normal.y) > 0.5 ? 2.0 : abs(normal.x) > 0.5 ? 0.0 : 1.0;
          vF = vec2(vFace < 0.5 ? lp.z * sign(normal.x) : lp.x * sign(normal.z), lp.y);
          vInfo = bInfo; vY = position.y; vH = sc.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float cDawn, cFog, cTime; uniform vec3 cGlow, cHaze;
        varying vec3 vW; varying vec2 vF; varying float vFace; varying vec4 vInfo; varying float vY; varying float vH;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main() {
          float seed = vInfo.x;
          vec3 base = vec3(0.0015, 0.002, 0.004) + cGlow * (1.0 - vY) * 0.5;
          base *= vFace > 1.5 ? 0.5 : vFace > 0.5 ? 1.0 : 0.7;
          vec3 c = base;
          if (vFace < 1.5) {
            vec2 cell = vec2(3.0, 3.8);
            vec2 q = vF / cell;
            vec2 id = floor(q), f = fract(q);
            vec2 fw = fwidth(q);
            float floorLit = step(0.12, h12(vec2(id.y, seed * 91.0)));          // some floors dark
            float lit = step(h12(id + seed * 37.0), vInfo.y) * floorLit;
            float warm = step(h12(id * 1.3 + seed * 11.0), vInfo.z);
            vec3 wc = mix(vec3(0.55, 0.75, 1.0), vec3(1.0, 0.6, 0.26), warm) * (0.12 + 0.35 * h12(id + 3.7));
            float win = smoothstep(0.08, 0.16, f.x) * smoothstep(0.92, 0.84, f.x) * smoothstep(0.2, 0.3, f.y) * smoothstep(0.86, 0.78, f.y);
            float ground = step(1.0, id.y);
            vec3 detail = wc * lit * win * ground;
            vec3 avg = mix(vec3(0.55, 0.75, 1.0), vec3(1.0, 0.6, 0.26), vInfo.z) * vInfo.y * 0.88 * 0.4 * 0.3;
            float k = smoothstep(0.5, 1.2, max(fw.x, fw.y));
            c += mix(detail, avg, k) * (1.0 - 0.75 * cDawn);
            // a lit crown on a few towers
            float crown = vInfo.w * smoothstep(vH - 9.0, vH - 7.0, vY * vH) * step(vY * vH, vH - 1.0);
            c += crown * vec3(0.7, 0.85, 1.0) * 1.2;
          }
          // aerial perspective
          float d = length(vW - cameraPosition);
          float f = 1.0 - exp(-d * cFog);
          c = mix(c, cHaze, f);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.towers = new THREE.InstancedMesh(geo, mat, N);
    const info = new Float32Array(N * 4);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const tall: THREE.Vector3[] = [];
    for (let i = 0; i < N; i++) {
      // downtown core, then sprawl
      const core = i < 140;
      const a = r() * Math.PI * 2, rad = core ? Math.pow(r(), 0.8) * 520 : 450 + r() * 1500;
      const x = CITY.x + Math.cos(a) * rad * (core ? 1.3 : 1.6), z = CITY.z + Math.sin(a) * rad * (core ? 0.5 : 0.45) - (core ? 0 : 200);
      const hgt = core ? 60 + Math.pow(r(), 1.8) * 260 * (1 - rad / 700) + 30 : 14 + Math.pow(r(), 3) * 70;
      const w = core ? 26 + r() * 34 : 30 + r() * 60, dd = core ? 24 + r() * 30 : 25 + r() * 50;
      p.set(x, -2, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.5); s.set(w, hgt, dd);
      m.compose(p, q, s);
      this.towers.setMatrixAt(i, m);
      info[i * 4] = r() * 10; info[i * 4 + 1] = core ? 0.06 + r() * 0.22 : 0.04 + r() * 0.12; info[i * 4 + 2] = core ? 0.25 + r() * 0.4 : 0.75; info[i * 4 + 3] = core && hgt > 200 && r() < 0.5 ? 1 : 0;
      if (hgt > 150) tall.push(new THREE.Vector3(x, hgt - 2, z));
    }
    geo.setAttribute('bInfo', new THREE.InstancedBufferAttribute(info, 4));
    this.towers.frustumCulled = false;

    // aviation lights (blinking red) on the tall towers and a few masts on the hills
    this.lights = new GlowPoints(140, 1);
    for (const t of tall) this.avi.push({ p: t.clone().add(new THREE.Vector3(0, 3, 0)), phase: r(), k: 1 });
    // hills: a ridge ring around the origin, closer on the sides, far ahead and behind
    const S = 360;
    const pos: number[] = [], idx: number[] = [];
    const ridge = (az: number) => {
      let h = 0;
      for (let o = 0; o < 5; o++) h += Math.sin(az * (3 + o * 4.7) + o * 1.9) * (1 / (o + 1)) + Math.sin(az * (7 + o * 9.1) + o) * 0.35 / (o + 1);
      return 70 + 60 * h;
    };
    const radius = (az: number) => 2600 + 1700 * Math.pow(Math.abs(Math.cos(az)), 2);
    for (let i = 0; i <= S; i++) {
      const az = (i / S) * Math.PI * 2;
      const R = radius(az);
      const x = Math.sin(az) * R, z = -Math.cos(az) * R;
      let h = ridge(az);
      // lower in front of the city so the skyline stands clear
      const ca = Math.atan2(CITY.x, -CITY.z);
      h *= 0.35 + 0.65 * (1 - Math.exp(-Math.pow((az > Math.PI ? az - Math.PI * 2 : az) - ca, 2) / 0.05));
      pos.push(x, -30, z, x, h, z);
      if (i < S) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      if (i % 9 === 0 && h > 90) this.avi.push({ p: new THREE.Vector3(x * 0.995, h + 28, z * 0.995), phase: r(), k: 0.7 });
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    hg.setIndex(idx);
    this.hills = new THREE.Mesh(hg, new THREE.ShaderMaterial({
      side: THREE.DoubleSide, uniforms: this.u,
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec3 cHaze; uniform float cDawn; varying vec3 vW;
        void main(){ float k = smoothstep(-30.0, 160.0, vW.y); vec3 c = mix(cHaze * 0.55, cHaze * (0.38 + 0.2 * cDawn), k); gl_FragColor = vec4(c, 1.0); }`,
    }));
    this.hills.frustumCulled = false;
    // scattered house lights on the hillsides
    this.hillLights = new GlowPoints(700, 1);
    for (let i = 0; i < 700; i++) {
      const az = r() * Math.PI * 2;
      const R = radius(az) * (0.55 + 0.4 * r());
      const y = Math.max(2, ridge(az) * (R / radius(az)) * r() * 0.5);
      const c = r() < 0.7 ? C('#ffb066') : C('#dfe8ff');
      this.hillLights.set(i, Math.sin(az) * R, y, -Math.cos(az) * R, c, 0.25 + r() * 0.5, 2.2 + r() * 2.5);
    }
    this.hillLights.commit();
    this.add(this.towers, this.hills, this.hillLights, this.lights);
  }

  update(t: number, dawn: number, haze: THREE.Color) {
    this.u.cDawn.value = dawn;
    this.u.cGlow.value.copy(C('#ff8a40', 0.02 * (1 - dawn)));
    this.u.cHaze.value.copy(haze);
    this.u.cTime.value = t;
    // aviation lights: 1.5 s cycle, 0.5 s on, a few in sync
    let n = 0;
    for (const a of this.avi) {
      const ph = ((t / 1.5 + a.phase * (n % 3 === 0 ? 0 : 1)) % 1 + 1) % 1;
      const on = ph < 0.33 ? 1 : 0.03;
      this.lights.set(n++, a.p.x, a.p.y, a.p.z, C('#ff2a1a'), 2.4 * on * a.k * (1 - 0.6 * dawn), 9);
      if (n >= this.lights.n) break;
    }
    for (let i = n; i < this.lights.n; i++) this.lights.hide(i);
    this.lights.commit();
  }
}

// ------------------------------------------------------------------------------------------- streaks

/**
 * Soft additive light streaks: camera-facing ribbons between two world points (car light trails, motion
 * streaks of lamps). Set per frame with set(i, a, b, colour, width) then commit().
 */
export class Streaks extends THREE.Mesh {
  aA: Float32Array; aB: Float32Array; aC: Float32Array; aW: Float32Array;
  live = 0;
  declare geometry: THREE.InstancedBufferGeometry;

  constructor(public cap: number) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const aA = new Float32Array(cap * 3), aB = new Float32Array(cap * 3), aC = new Float32Array(cap * 3), aW = new Float32Array(cap);
    g.setAttribute('iA', new THREE.InstancedBufferAttribute(aA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iB', new THREE.InstancedBufferAttribute(aB, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iC', new THREE.InstancedBufferAttribute(aC, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iW', new THREE.InstancedBufferAttribute(aW, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { fogD: HU.uFogD },
      vertexShader: /* glsl */ `
        attribute vec3 iA, iB, iC; attribute float iW;
        uniform float fogD;
        varying vec2 vL; varying vec3 vC; varying float vLen;
        void main() {
          vec4 a = viewMatrix * vec4(iA, 1.0), b = viewMatrix * vec4(iB, 1.0);
          vec3 ax = b.xyz - a.xyz; float L = length(ax);
          vec3 dir = L > 1e-5 ? ax / L : vec3(1.0, 0.0, 0.0);
          vec3 mid = mix(a.xyz, b.xyz, position.x);
          vec3 side = normalize(cross(dir, normalize(mid) + vec3(0.0, 0.0, 1e-4)));
          vec3 p = mid + side * position.y * iW - dir * iW * (1.0 - 2.0 * position.x);
          vL = vec2((position.x * (L + 2.0 * iW) - iW) / max(L, 1e-4), position.y);
          vLen = L / max(iW, 1e-4);
          float d = length(mid);
          vC = iC * exp(-pow(d * fogD, 1.35) * 0.8);
          gl_Position = projectionMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vL; varying vec3 vC; varying float vLen;
        void main() {
          float across = exp(-vL.y * vL.y * 4.0);
          float along = smoothstep(-0.5 / max(vLen, 0.5), 0.0, vL.x) * smoothstep(1.0 + 0.5 / max(vLen, 0.5), 1.0, vL.x);
          // trails fade toward their tail (vL.x = 0)
          float tail = mix(0.25, 1.0, clamp(vL.x, 0.0, 1.0));
          gl_FragColor = vec4(vC * across * along * tail, 1.0);
        }`,
    });
    super(g, mat);
    this.aA = aA; this.aB = aB; this.aC = aC; this.aW = aW;
    this.frustumCulled = false;
  }

  set(i: number, a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Color, k: number, w: number) {
    this.aA.set([a.x, a.y, a.z], i * 3); this.aB.set([b.x, b.y, b.z], i * 3);
    this.aC.set([c.r * k, c.g * k, c.b * k], i * 3); this.aW[i] = w;
  }
  commit(n: number) {
    this.live = n;
    this.geometry.instanceCount = n;
    for (const k of ['iA', 'iB', 'iC', 'iW']) (this.geometry.getAttribute(k) as THREE.InstancedBufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------------------------------- landscape

/** Four tree silhouettes (alpha) drawn procedurally: trunk, recursive branches, leaf clumps. */
function treeAtlas() {
  const cw = 512, ch = 1024, cv = document.createElement('canvas');
  cv.width = cw * 4; cv.height = ch;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, cv.width, cv.height);
  const r = mulberry32(808);
  for (let v = 0; v < 4; v++) {
    const ox = v * cw + cw / 2;
    c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineCap = 'round';
    const tips: { x: number; y: number }[] = [];
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke();
      if (depth <= 0 || len < 12) { tips.push({ x: x2, y: y2 }); return; }
      const n = 2 + (r() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) branch(x2, y2, a + (r() - 0.5) * (v === 3 ? 0.7 : 1.3), len * (0.62 + r() * 0.2), w * 0.66, depth - 1);
    };
    const conifer = v === 3;
    branch(ox, ch - 10, -Math.PI / 2 + (r() - 0.5) * 0.08, conifer ? 240 : 300, conifer ? 22 : 30, conifer ? 5 : 6);
    // leaf clumps around every tip (and a dense crown), soft-edged discs
    const crown = conifer ? 0.0 : 1.0;
    for (const t of tips) {
      const k = 6 + Math.floor(r() * 6);
      for (let i = 0; i < k; i++) {
        const rad = (conifer ? 10 : 16) + r() * (conifer ? 18 : 30);
        c.beginPath(); c.arc(t.x + (r() - 0.5) * 60, t.y + (r() - 0.5) * 50, rad, 0, Math.PI * 2); c.fill();
      }
    }
    if (conifer) {
      // a spire of drooping tiers
      for (let y = 140; y < ch - 120; y += 18) {
        const w = (y - 100) * 0.34 * (0.8 + 0.4 * r());
        c.beginPath(); c.moveTo(ox, y - 30); c.lineTo(ox - w, y + 24); c.lineTo(ox + w, y + 24); c.closePath(); c.fill();
      }
    }
    void crown;
  }
  const t = new THREE.CanvasTexture(cv);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * The land beside the highway: tree lines that stream past (camera-facing silhouettes, looping around the
 * camera), scattered house and farm lights, and a parallel country road with its own lamps and a few cars.
 */
export class Landscape extends THREE.Group {
  trees: THREE.InstancedMesh;
  lights: GlowPoints;
  cars: GlowPoints;
  treeData: { x: number; u: number; s: number; v: number }[] = [];
  exclude: { x: number; u: number; r: number }[] = [];
  static NT = 300;
  static LOOP = 760;

  constructor() {
    super();
    const r = mulberry32(5150);
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...HU, atlas: { value: treeAtlas() } },
      vertexShader: /* glsl */ `
        attribute float variant;
        varying vec2 vUv; varying vec3 vW; varying float vH;
        void main() {
          vec3 c = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
          vec3 toCam = cameraPosition - c; toCam.y = 0.0;
          vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
          vec3 w = c + right * position.x * sx * 0.62 + vec3(0.0, position.y * sy, 0.0);
          vW = w; vH = position.y;
          vUv = vec2((uv.x + variant) / 4.0, uv.y);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: HW_GLSL + /* glsl */ `
        uniform sampler2D atlas;
        varying vec2 vUv; varying vec3 vW; varying float vH;
        void main() {
          float a = texture2D(atlas, vUv).a;
          if (a < 0.45) discard;
          // cheap: sky ambient, the sodium glow of the road nearby, the dawn sun on the crown
          float near = exp(-abs(abs(vW.x) - 8.0) / 25.0);
          vec3 d = uAmbHi * 1.4 + uLampCol * 0.0016 * near + uSunCol * 0.35 * vH;
          vec3 c = vec3(0.016, 0.022, 0.016) * d * (0.55 + 0.45 * vH);
          gl_FragColor = vec4(hwFog(c, vW, cameraPosition), 1.0);
        }`,
    });
    const variant = new Float32Array(Landscape.NT);
    for (let i = 0; i < Landscape.NT; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const u = r() * Landscape.LOOP;
      const clump = Math.sin(u * 0.021 + side * 2) * 0.5 + 0.5;
      const x = side * (21 + Math.pow(r(), 1.6) * 80 + (clump < 0.3 ? 45 : 0));
      const v = Math.floor(r() * 4);
      variant[i] = v;
      this.treeData.push({ x, u, s: (v === 3 ? 13 : 10) * (0.75 + r() * 0.6), v });
    }
    quad.setAttribute('variant', new THREE.InstancedBufferAttribute(variant, 1));
    this.trees = new THREE.InstancedMesh(quad, mat, Landscape.NT);
    this.trees.frustumCulled = false;
    // scattered lights out in the land (static world positions around the route)
    this.lights = new GlowPoints(900, 1);
    let n = 0;
    for (let i = 0; i < 520; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const x = side * (110 + Math.pow(r(), 0.7) * 1400), z = 300 - r() * 2600;
      const warm = r() < 0.75;
      this.lights.set(n++, x, 1.5 + r() * 6, z, warm ? C('#ffb36b') : C('#dfe9ff'), 0.25 + Math.pow(r(), 3) * 1.2, 1.4 + r() * 1.4);
    }
    // a parallel road on the right, ~420 m out: a row of sodium lamps
    for (let i = 0; i < 120; i++) {
      const z = 300 - i * 24;
      this.lights.set(n++, 420 + Math.sin(z * 0.002) * 60, 8, z, C('#ff9a3c'), 0.9, 2.6);
    }
    for (let i = n; i < this.lights.n; i++) this.lights.hide(i);
    this.lights.commit();
    this.cars = new GlowPoints(24, 1);
    this.add(this.trees, this.lights, this.cars);
  }

  update(camU: number, t: number) {
    const m = new THREE.Matrix4();
    const L = Landscape.LOOP;
    this.treeData.forEach((d, i) => {
      const rel = ((((d.u - camU + 140) % L) + L) % L) - 140;
      const u = camU + rel;
      let k = 1;
      for (const e of this.exclude) if (Math.hypot(d.x - e.x, u - e.u) < e.r) k = 0;
      m.makeScale(d.s * k, d.s * k, d.s * k).setPosition(d.x, 0, -u);
      this.trees.setMatrixAt(i, m);
    });
    this.trees.instanceMatrix.needsUpdate = true;
    // cars on the parallel road
    for (let i = 0; i < 12; i++) {
      const dir = i % 2 ? 1 : -1;
      const z = ((((i * 211 + dir * t * 22) % 2800) + 2800) % 2800) - 2500;
      const x = 420 + Math.sin(z * 0.002) * 60 + dir * 3;
      this.cars.set(i * 2, x, 1, z, dir > 0 ? C('#ff2a1a') : C('#fff2dd'), dir > 0 ? 0.6 : 1.2, 1.6);
      this.cars.set(i * 2 + 1, x + 1.4, 1, z, dir > 0 ? C('#ff2a1a') : C('#fff2dd'), dir > 0 ? 0.6 : 1.2, 1.6);
    }
    this.cars.commit();
  }
}
