// Highway scene, environment: the night sky (gradient, stars, city-lit clouds, the dawn and the sun), the
// distant city (instanced towers with thousands of lit windows, aviation lights), the hills, and generic
// helpers (soft light streaks). The road, its furniture and the traffic are in highway-road.ts.
import * as THREE from 'three';
import { GlowPoints } from '../lib/points';
import { mulberry32 } from '../../engine/util';
import { HU, HW_GLSL } from './highway-zold-common';

// ------------------------------------------------------------------------------------------- sky

export interface SkyState {
  dawn: number; // 0 night .. 1 golden
  sunDir: THREE.Vector3;
  sunK: number; // sun disc brightness
}

export const SKY_GLSL = /* glsl */ `
uniform vec3 sZen, sHor, sCity, sDawnLo, sDawnHi, sSunCol, sSunDir, sScrDir, sScrCol;
uniform float sDawn, sSunK, sCityK;
float p8(float x) { x *= x; x *= x; return x * x; }
vec3 skyCol(vec3 d) {
  float y = d.y, yy = max(y, 0.0);
  vec2 h = normalize(d.xz + vec2(1e-6));
  float g0 = clamp(yy * 1.7, 0.0, 1.0);
  vec3 c = mix(sHor, sZen, sqrt(g0) * (1.1 - 0.1 * g0));
  // light pollution of the city ahead (-z): a low sodium dome
  float fz = max(-h.y, 0.0);
  c += sCity * sCityK * (p8(fz) * exp(-yy * 16.0) + 0.15 * fz * fz * exp(-yy * 5.0));
  // the giant screen's light scattered in the haze around it (it dies with the screen)
  if (sScrCol.r + sScrCol.g > 0.0) {
    vec2 hs = normalize(sScrDir.xz + vec2(1e-6));
    float daz = acos(clamp(dot(h, hs), -1.0, 1.0));
    float del = y - sScrDir.y;
    c += sScrCol * (exp(-daz * daz / 0.03 - del * del / 0.012) * 0.8 + exp(-daz * daz / 0.25) * exp(-yy * 7.0) * 0.25);
  }
  if (sDawn > 0.0) {
    // dawn: a warm band low on the horizon toward the sun, the whole sky lifting
    vec2 sa2 = normalize(sSunDir.xz + vec2(1e-6));
    float sa = max(dot(h, sa2), 0.0);
    float e4 = exp(-yy * 4.0);
    c += sDawnLo * (sa * sa * sqrt(sa) * exp(-yy * 7.0) + 0.35 * e4 * (0.15 + 0.85 * sa * sa)) * sDawn;
    c += sDawnHi * sa * sqrt(sa) * exp(-yy * 2.2) * sDawn;
  }
  if (sSunK > 0.0) {
    float g = max(dot(d, sSunDir), 0.0);
    float g12 = p8(g) * g * g * g * g;
    c += sSunCol * sSunK * (smoothstep(0.99975, 0.99985, g) * 40.0 + pow(g, 900.0) * 6.0 + pow(g, 90.0) * 0.6 + g12 * 0.12);
  }
  // below the horizon: dark land haze
  c = mix(c, sHor * 0.5, smoothstep(0.0, -0.08, y));
  return c;
}`;

export function skyUniforms() {
  return {
    sZen: { value: new THREE.Color() }, sHor: { value: new THREE.Color() }, sCity: { value: new THREE.Color() },
    sDawnLo: { value: new THREE.Color() }, sDawnHi: { value: new THREE.Color() }, sSunCol: { value: new THREE.Color() },
    sSunDir: { value: new THREE.Vector3(0, -0.1, 1).normalize() }, sDawn: { value: 0 }, sSunK: { value: 0 },
    sScrDir: { value: new THREE.Vector3(0, 0.05, -1).normalize() }, sScrCol: { value: new THREE.Color(0, 0, 0) }, sCityK: { value: 1 },
  };
}
export type SkyU = ReturnType<typeof skyUniforms>;

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
    this.dome.renderOrder = 20; // last of the opaques: only the visible sky is shaded
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
      ...this.u, tex: { value: cloudTex }, off: { value: new THREE.Vector2() }, cover: { value: 0.78 },
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
          vec2 p = d.xz / (d.y + 0.045) * 0.16 + off;
          vec4 a = texture2D(tex, p);
          vec4 b = texture2D(tex, p * 2.3 + 0.31);
          float dens = smoothstep(1.0 - cover, 1.0 - cover + 0.8, a.g * 0.8 + b.r * 0.25) * (0.75 + 0.25 * b.g);
          float fade = smoothstep(0.004, 0.09, d.y);
          vec2 h = normalize(d.xz + vec2(1e-6));
          float city = pow(max(-h.y, 0.0), 2.0);
          float low = exp(-d.y * 3.5);
          vec2 sa2 = normalize(sSunDir.xz + vec2(1e-6));
          float sun = pow(max(dot(h, sa2), 0.0), 3.0);
          // thicker cloud reads darker on top, brighter rims where thin
          float thin = 1.0 - smoothstep(0.3, 1.0, a.g);
          // the cloud base glows with the sodium light of the city and the highway below it
          vec3 col = litAmb * (0.6 + 0.4 * b.b) + litCity * (city * 1.4 * low + 0.35) * (0.5 + 0.7 * a.g) * (0.7 + 0.6 * b.b) + litSun * (sun * 1.6 + 0.2) * (0.4 + 0.9 * thin) * low;
          float al = dens * fade;
          gl_FragColor = vec4(col * al, al * 0.85);
        }`,
    });
    cm.blending = THREE.CustomBlending;
    cm.blendSrc = THREE.OneFactor; cm.blendDst = THREE.OneMinusSrcAlphaFactor;
    this.cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(4450, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), cm);
    this.cloudMesh.renderOrder = -8;
    this.cloudMesh.frustumCulled = false;
    this.plane = new GlowPoints(8, 1);
    this.plane.renderOrder = -7;
    this.add(this.dome, this.stars, this.cloudMesh, this.plane);
  }

  /** Night → dawn colours, also writes the haze and ambient into the shared lighting uniforms. */
  /**
   * Night sky. `o.scrDir` / `o.scrK`: direction and brightness (0..1) of the giant screen's fake dawn, which
   * lights the haze, the cloud undersides and every lit surface facing it; `o.cityK`: how much of the city's
   * sodium glow is left (the blackout dims the sky dome and lets the stars through).
   */
  update(camPos: THREE.Vector3, t: number, o: { scrDir: THREE.Vector3; scrK: number; cityK: number; cloudDrift: number; planeK?: number }) {
    this.position.copy(camPos);
    const u = this.u;
    const ck = o.cityK, sk = Math.max(0, o.scrK);
    u.sZen.value.copy(C('#060b22', 0.6));
    u.sHor.value.copy(C('#13204a', 0.6 * (0.7 + 0.3 * ck)));
    u.sCity.value.copy(C('#ff8a3a', 0.016));
    u.sCityK.value = ck;
    u.sSunCol.value.setRGB(0, 0, 0);
    u.sSunDir.value.copy(o.scrDir);
    u.sDawn.value = 0;
    u.sSunK.value = 0;
    u.sScrDir.value.copy(o.scrDir);
    u.sScrCol.value.copy(C('#ff8a4a', 0.05 * sk));
    // the stars come out as the city's glow dies
    (this.stars.material as THREE.ShaderMaterial).uniforms.size!.value = 1 + 0.35 * (1 - ck);
    // clouds: lit from below by the city, and by the screen while it plays
    this.cu.off!.value.set(o.cloudDrift * 0.004 + 0.13, o.cloudDrift * 0.0015 + 0.71);
    this.cu.litCity!.value.copy(C('#b98a7a', 0.065 * (0.25 + 0.75 * ck)));
    this.cu.litAmb!.value.copy(C('#2a3460', 0.05));
    this.cu.litSun!.value.copy(C('#ff8d5c', 0.35 * sk));
    // haze & ambient (shared with every lit material)
    HU.uHazeLo.value.copy(u.sHor.value).multiplyScalar(0.8);
    HU.uHazeCity.value.copy(C('#ff7a30', 0.02 * (0.3 + 0.7 * ck)));
    HU.uHazeSun.value.copy(C('#ff9a50', 0.09 * sk));
    HU.uSunAz.value.set(o.scrDir.x, o.scrDir.z).normalize();
    HU.uAmbHi.value.copy(C('#2a3870', 0.05 * (0.6 + 0.4 * ck)));
    HU.uAmbLo.value.copy(C('#120f14', 0.03 * (0.6 + 0.4 * ck)));
    HU.uSunDir.value.copy(o.scrDir);
    HU.uFogD.value = 0.0042;
    HU.uSunCol.value.copy(C('#ff9a5a', 0.05 * sk));
    // aircraft (they have their own power): an airliner crossing high overhead, and one on its approach to
    // the airport (Exit 24): landing lights, red / green navigation lights, white strobes, a red beacon
    const pk = o.planeK ?? 1;
    const strobe = (Math.floor(t * 60) % 72) < 4 ? 1 : 0;
    const beacon = (Math.floor(t * 60) % 60) < 8 ? 1 : 0;
    const pa = (t - 17) * 0.012;
    const px = -900 + 1800 * pa, pz = -300 - 400 * pa, py = 1500;
    this.plane.set(0, px - 18, py, pz, C('#ff2a1a'), 1.6 * pk, 7);
    this.plane.set(1, px + 18, py, pz + 4, C('#38ff7a'), 1.4 * pk, 7);
    this.plane.set(2, px, py - 1, pz - 10, C('#ffffff'), 5 * strobe * pk, 9);
    this.plane.set(3, px, py + 2, pz + 12, C('#ff3a2a'), 2.5 * beacon * pk, 6);
    // (on its approach: high on the right while the billboards go by, sinking slowly to the left)
    const qa = t - 21.6;
    const qx = 650 - 55 * qa, qy = 430 - 4 * qa, qz = -1150 + 12 * qa;
    const strobe2 = (Math.floor(t * 60 + 20) % 66) < 4 ? 1 : 0;
    this.plane.set(4, qx + 6, qy - 2, qz, C('#fff6e8'), 4.0 * pk, 10);
    this.plane.set(5, qx - 6, qy - 2, qz + 1, C('#fff6e8'), 3.0 * pk, 9);
    this.plane.set(6, qx, qy + 3, qz - 3, C('#ff3a2a'), 3.0 * ((Math.floor(t * 60 + 31) % 60) < 8 ? 1 : 0) * pk, 6);
    this.plane.set(7, qx - 2, qy, qz - 14, C('#ffffff'), 6 * strobe2 * pk, 8);
    this.plane.commit();
  }
}

// ------------------------------------------------------------------------------------------- city

export const CITY = { x: -420, z: -2150 };

export interface CityOpts { x: number; z: number; seed: number; n?: number; hills?: boolean; core?: number; spread?: number; facing?: number; lit?: number }

/**
 * A far city: instanced towers with procedural windows, a carpet of street lights, aviation lights, and (for the
 * main city) the hills around. `blackout(k)`: the power dies block by block in the order `ord` (0..1, per city
 * block of ~140 m, along `facing`): each block's towers go dark floor by floor from the top, the street lights
 * of the block with them, with a flicker on the way out.
 */
export class City extends THREE.Group {
  towers: THREE.InstancedMesh;
  lights: GlowPoints;
  carpet: GlowPoints;
  carpetData: { x: number; y: number; z: number; c: THREE.Color; k: number; ord: number; s: number }[] = [];
  hills: THREE.Mesh | null = null;
  hillLights: GlowPoints | null = null;
  avi: { p: THREE.Vector3; phase: number; k: number; ord: number }[] = [];
  u = { cDawn: { value: 0 }, cGlow: { value: new THREE.Color() }, cHaze: { value: new THREE.Color() }, cFog: { value: 0.00028 }, cTime: { value: 0 }, cBlack: { value: -1 } };
  black = -1;

  constructor(public o: CityOpts) {
    super();
    const r = mulberry32(o.seed);
    const N = o.n ?? 360;
    const core = o.core ?? 1, spread = o.spread ?? 1;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `
        attribute vec4 bInfo; // seed, lit ratio, warmth, crown
        attribute float bOrd;
        varying vec3 vW; varying vec2 vF; varying float vFace; varying vec4 vInfo; varying float vY; varying float vH; varying float vOrd;
        void main() {
          mat4 m = modelMatrix * instanceMatrix;
          vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vec4 w = m * vec4(position, 1.0);
          vW = w.xyz;
          vec3 lp = position * sc;
          vFace = abs(normal.y) > 0.5 ? 2.0 : abs(normal.x) > 0.5 ? 0.0 : 1.0;
          vF = vec2(vFace < 0.5 ? lp.z * sign(normal.x) : lp.x * sign(normal.z), lp.y);
          vInfo = bInfo; vY = position.y; vH = sc.y; vOrd = bOrd;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float cDawn, cFog, cTime, cBlack; uniform vec3 cGlow, cHaze;
        varying vec3 vW; varying vec2 vF; varying float vFace; varying vec4 vInfo; varying float vY; varying float vH; varying float vOrd;
        float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        void main() {
          float seed = vInfo.x;
          // the blackout: this tower's progress 0 (alive) .. 1 (dead), floors die from the top
          float dk = clamp((cBlack - vOrd) / 0.05, 0.0, 1.0);
          vec3 base = vec3(0.0015, 0.002, 0.004) + cGlow * (1.0 - vY) * 0.5 * (1.0 - dk);
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
            // floor by floor from the top: a floor is gone once the front has passed it, flickering as it goes
            float fy = 1.0 - (id.y * cell.y) / max(vH, 1.0);
            float front = dk * 1.1 - fy;
            float alive = 1.0 - step(0.0, front);
            float flick = step(-0.12, front) * alive;
            alive *= 1.0 - flick * step(0.5, h12(id + floor(cTime * 24.0)));
            vec3 detail = wc * lit * win * ground * alive;
            vec3 avg = mix(vec3(0.55, 0.75, 1.0), vec3(1.0, 0.6, 0.26), vInfo.z) * vInfo.y * 0.88 * 0.4 * 0.3 * clamp(1.0 - dk * 1.1, 0.0, 1.0);
            float k = smoothstep(0.5, 1.2, max(fw.x, fw.y));
            c += mix(detail, avg, k) * (1.0 - 0.75 * cDawn);
            // a lit crown on a few towers (the first thing to go)
            float crown = vInfo.w * smoothstep(vH - 9.0, vH - 7.0, vY * vH) * step(vY * vH, vH - 1.0) * (1.0 - step(0.01, dk));
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
    const info = new Float32Array(N * 4), ord = new Float32Array(N);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const tall: { p: THREE.Vector3; ord: number }[] = [];
    const facing = o.facing ?? 0;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    /** blackout order of a point: per block, swept along `facing`, with some disorder between blocks */
    const ordAt = (x: number, z: number) => {
      const bx = Math.floor((x - o.x) / 140), bz = Math.floor((z - o.z) / 140);
      const cx = (bx + 0.5) * 140, cz = (bz + 0.5) * 140;
      const along = (cx * fx + cz * fz) / (1400 * spread);
      const hb = Math.abs(Math.sin(bx * 12.9898 + bz * 78.233 + o.seed) * 43758.5453) % 1;
      return Math.min(0.97, Math.max(0, 0.5 + 0.45 * along + 0.18 * (hb - 0.5)));
    };
    for (let i = 0; i < N; i++) {
      // downtown core, then sprawl
      const isCore = i < N * 0.39;
      const a = r() * Math.PI * 2, rad = isCore ? Math.pow(r(), 0.8) * 520 * core : (450 + r() * 1500) * spread;
      const x = o.x + Math.cos(a) * rad * (isCore ? 1.3 : 1.6), z = o.z + Math.sin(a) * rad * (isCore ? 0.5 : 0.45) - (isCore ? 0 : 200 * Math.sign(o.z || -1));
      const hgt = isCore ? 60 + Math.pow(r(), 1.8) * 260 * (1 - rad / (700 * core)) + 30 : 14 + Math.pow(r(), 3) * 70;
      const w = isCore ? 26 + r() * 34 : 30 + r() * 60, dd = isCore ? 24 + r() * 30 : 25 + r() * 50;
      p.set(x, -2, z); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 0.5); s.set(w, Math.max(10, hgt), dd);
      m.compose(p, q, s);
      this.towers.setMatrixAt(i, m);
      info[i * 4] = r() * 10; info[i * 4 + 1] = Math.min(0.9, (isCore ? 0.06 + r() * 0.22 : 0.04 + r() * 0.12) * (o.lit ?? 1)); info[i * 4 + 2] = isCore ? 0.25 + r() * 0.4 : 0.75; info[i * 4 + 3] = isCore && hgt > 200 && r() < 0.5 ? 1 : 0;
      ord[i] = ordAt(x, z) + 0.015 * r();
      if (hgt > 150) tall.push({ p: new THREE.Vector3(x, hgt - 2, z), ord: ord[i]! });
    }
    geo.setAttribute('bInfo', new THREE.InstancedBufferAttribute(info, 4));
    geo.setAttribute('bOrd', new THREE.InstancedBufferAttribute(ord, 1));
    this.towers.computeBoundingSphere(); // (culled when we look away from the city)

    // the street grid: sodium lamps along the avenues, a few white ones, dense downtown
    const NC = 2200;
    this.carpet = new GlowPoints(NC, 1);
    for (let i = 0; i < NC; i++) {
      const rr = Math.pow(r(), 0.7) * 1500 * spread;
      const a = r() * Math.PI * 2;
      let x = o.x + Math.cos(a) * rr * 1.5, z = o.z + Math.sin(a) * rr * 0.55;
      // snap to a street grid (avenues one way, streets the other)
      if (r() < 0.5) x = Math.round(x / 70) * 70 + 4; else z = Math.round(z / 90) * 90 + 4;
      const white = r() < 0.18;
      const k = (0.25 + 0.5 * r()) * (rr < 600 ? 1 : 0.6);
      this.carpetData.push({ x, y: 4 + r() * 4, z, c: white ? C('#e8eeff') : C('#ff9a40'), k, ord: ordAt(x, z) + 0.01 * r(), s: 2.4 + r() * 1.8 });
    }
    // aviation lights (blinking red) on the tall towers and a few masts on the hills
    this.lights = new GlowPoints(140, 1);
    for (const t of tall) this.avi.push({ p: t.p.clone().add(new THREE.Vector3(0, 3, 0)), phase: r(), k: 1, ord: t.ord });
    this.add(this.towers, this.carpet, this.lights);
    if (o.hills) this.buildHills(r);
    this.paintCarpet(0);
  }

  private buildHills(r: () => number) {
    // hills: a ridge ring around the origin, closer on the sides, far ahead and behind
    const S = 360;
    const pos: number[] = [], idx: number[] = [];
    const ridge = (az: number) => {
      let h = 0;
      for (let o = 0; o < 5; o++) h += Math.sin(az * (3 + o * 4.7) + o * 1.9) * (1 / (o + 1)) + Math.sin(az * (7 + o * 9.1) + o) * 0.35 / (o + 1);
      return 70 + 60 * h;
    };
    const radius = (az: number) => 2600 + 1700 * Math.pow(Math.abs(Math.cos(az)), 2);
    const ca = Math.atan2(this.o.x, -this.o.z);
    for (let i = 0; i <= S; i++) {
      const az = (i / S) * Math.PI * 2;
      const R = radius(az);
      const x = Math.sin(az) * R, z = -Math.cos(az) * R;
      let h = ridge(az);
      // lower in front of the city so the skyline stands clear
      h *= 0.35 + 0.65 * (1 - Math.exp(-Math.pow((az > Math.PI ? az - Math.PI * 2 : az) - ca, 2) / 0.05));
      pos.push(x, -30, z, x, h, z);
      if (i < S) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      if (i % 9 === 0 && h > 90) this.avi.push({ p: new THREE.Vector3(x * 0.995, h + 28, z * 0.995), phase: r(), k: 0.7, ord: 0.98 });
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
    this.add(this.hills, this.hillLights);
  }

  private paintCarpet(t: number) {
    const b = this.black;
    this.carpetData.forEach((d, i) => {
      const dk = (b - d.ord) / 0.05;
      let k = dk >= 1 ? 0 : d.k;
      if (dk > -0.4 && dk < 1) k *= (Math.sin(t * 61 + i * 7.1) > 0.2 ? 1 : 0.15);
      this.carpet.set(i, d.x, d.y, d.z, d.c, k, d.s);
    });
    this.carpet.commit();
  }

  /** k: blackout progress (-1 = all lit, 1.1 = all dark). */
  blackout(k: number) { this.black = k; this.u.cBlack.value = k; }

  update(t: number, dawn: number, haze: THREE.Color, hillK = 1) {
    this.u.cDawn.value = dawn;
    this.u.cGlow.value.copy(C('#ff8a40', 0.02 * (1 - dawn)));
    this.u.cHaze.value.copy(haze);
    this.u.cTime.value = t;
    if (this.black > -0.5) this.paintCarpet(t);
    // aviation lights: 1.5 s cycle, 0.5 s on, a few in sync
    let n = 0;
    for (const a of this.avi) {
      const ph = ((t / 1.5 + a.phase * (n % 3 === 0 ? 0 : 1)) % 1 + 1) % 1;
      const on = ph < 0.33 ? 1 : 0.03;
      const alive = this.black > a.ord + 0.02 ? 0 : 1;
      this.lights.set(n++, a.p.x, a.p.y, a.p.z, C('#ff2a1a'), 2.4 * on * a.k * (1 - 0.6 * dawn) * alive, 9);
      if (n >= this.lights.n) break;
    }
    for (let i = n; i < this.lights.n; i++) this.lights.hide(i);
    this.lights.commit();
    if (this.hillLights) this.hillLights.visible = hillK > 0.5;
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
          vec3 cr = cross(dir, normalize(mid) + vec3(0.0, 0.0, 1e-4)); vec3 side = cr / max(length(cr), 1e-6);
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
    const conifer = v === 3;
    // grow the tree in its own units first, then fit it into the cell with a margin
    const segs: { x0: number; y0: number; x1: number; y1: number; w: number }[] = [];
    const tips: { x: number; y: number; r: number }[] = [];
    const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      segs.push({ x0: x, y0: y, x1: x2, y1: y2, w });
      if (depth <= 0 || len < 10) { for (let i = 0; i < 7; i++) tips.push({ x: x2 + (r() - 0.5) * 50, y: y2 + (r() - 0.5) * 40, r: 14 + r() * 26 }); return; }
      const n = 2 + (r() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) branch(x2, y2, a + (r() - 0.5) * 1.25, len * (0.6 + r() * 0.2), w * 0.66, depth - 1);
    };
    if (conifer) {
      segs.push({ x0: 0, y0: 0, x1: 0, y1: -900, w: 16 });
      for (let y = -880; y < -60; y += 16) {
        const w = (y + 900) * 0.3 * (0.8 + 0.4 * r());
        tips.push({ x: -w * 0.5, y: y + 20, r: w * 0.32 }); tips.push({ x: w * 0.5, y: y + 20, r: w * 0.32 });
      }
    } else branch(0, 0, -Math.PI / 2 + (r() - 0.5) * 0.08, 260, 28, 6);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const t of tips) { x0 = Math.min(x0, t.x - t.r); x1 = Math.max(x1, t.x + t.r); y0 = Math.min(y0, t.y - t.r); y1 = Math.max(y1, t.y + t.r); }
    for (const sg of segs) { x0 = Math.min(x0, sg.x1); x1 = Math.max(x1, sg.x1); y0 = Math.min(y0, sg.y1); }
    y1 = Math.max(y1, 0);
    const sc = Math.min((cw - 24) / (x1 - x0), (ch - 24) / (y1 - y0));
    c.save();
    c.beginPath(); c.rect(v * cw, 0, cw, ch); c.clip();
    c.translate(v * cw + cw / 2 - ((x0 + x1) / 2) * sc, ch - 4 - y1 * sc);
    c.scale(sc, sc);
    c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineCap = 'round';
    for (const sg of segs) { c.lineWidth = sg.w; c.beginPath(); c.moveTo(sg.x0, sg.y0); c.lineTo(sg.x1, sg.y1); c.stroke(); }
    for (const t of tips) {
      if (conifer) { c.beginPath(); c.moveTo(t.x - t.r * 1.6, t.y + t.r * 0.5); c.lineTo(t.x, t.y - t.r * 1.2); c.lineTo(t.x + t.r * 1.6, t.y + t.r * 0.5); c.closePath(); c.fill(); }
      else { c.beginPath(); c.arc(t.x, t.y, t.r, 0, Math.PI * 2); c.fill(); }
    }
    c.restore();
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
  lightData: { x: number; y: number; z: number; c: THREE.Color; k: number; s: number; h: number }[] = [];
  private front = 1e9;
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
    for (let i = 0; i < 520; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const x = side * (110 + Math.pow(r(), 0.7) * 1400), z = 300 - r() * 2600;
      const warm = r() < 0.75;
      this.lightData.push({ x, y: 1.5 + r() * 6, z, c: warm ? C('#ffb36b') : C('#dfe9ff'), k: 0.25 + Math.pow(r(), 3) * 1.2, s: 1.4 + r() * 1.4, h: r() });
    }
    // a parallel road on the right, ~420 m out: a row of sodium lamps
    for (let i = 0; i < 120; i++) {
      const z = 300 - i * 24;
      this.lightData.push({ x: 420 + Math.sin(z * 0.002) * 60, y: 8, z, c: C('#ff9a3c'), k: 0.9, s: 2.6, h: -1 });
    }
    this.front = -1e9;
    this.paint(-1e9, 0);
    this.cars = new GlowPoints(24, 1);
    this.add(this.trees, this.lights, this.cars);
  }

  /** The power dies along the land: lights at road coordinate u < `frontU` go out (a flicker as the front passes). */
  private paint(frontU: number, t: number) {
    this.lightData.forEach((d, i) => {
      const u = -d.z - (d.h < 0 ? 0 : (d.h - 0.5) * 300);
      const past = frontU - u;
      let k = past > 0 ? 0 : d.k;
      if (past > -60 && past <= 0) k *= Math.sin(t * 53 + i * 3.7) > 0 ? 1 : 0.1;
      this.lights.set(i, d.x, d.y, d.z, d.c, k, d.s);
    });
    for (let i = this.lightData.length; i < this.lights.n; i++) this.lights.hide(i);
    this.lights.commit();
  }

  /** Blackout front along the land (road coordinate; -1e9 = all lit). */
  power(frontU: number, t: number) {
    if (frontU < -1e8 && this.front < -1e8) return;
    this.front = frontU;
    this.paint(frontU < -1e8 ? -1e9 : frontU, t);
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
