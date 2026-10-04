// A night city in the Manhattan manner: thousands of instanced buildings (towers with setbacks, residential
// blocks, rooftop plant) whose facades are drawn in the shader — every window is a little lit room seen through
// the glass (interior mapping: floor, ceiling, lamp, back wall, furniture, curtains, office ceiling panels), so
// windows have depth and parallax as the camera moves; brick and concrete lit from the street below, dark glass
// towers reflecting the sky, LED crowns on the tallest. Lit streets with sodium pools, long-exposure traffic
// streaks, blinking aviation lights, a warm haze and an optional glow-lit cloud deck. `wake` (0..1) sets how many
// windows are lit; `wakeFrom`/`wakeR` light them in a wave; `gold` / `goldWave` turn them gold.
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';
import { GlowPoints } from './points';
import { GlowLines } from './stars';

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
  /** Keep these circles (x, z, r) free of generated buildings (the hero's block, landmarks). */
  clear?: [number, number, number] | [number, number, number][];
  fog?: number;
  fogColor?: THREE.Color;
  /** A low cloud deck lit from below by the city (height in m), or none. */
  clouds?: number;
}

/** Shared GLSL: the facade of a building (interior-mapped windows), used by the city and by the landmarks. */
export const FACADE_GLSL = /* glsl */ `
  float hh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  // a room seen through a window: ro in room space (x across, y up, z into the room), rd the view ray
  vec3 roomColor(vec3 ro, vec3 rd, vec3 R, vec3 L, float seed, float office) {
    float tx = rd.x > 0.0 ? (R.x - ro.x) / rd.x : (rd.x < 0.0 ? -ro.x / rd.x : 1e9);
    float ty = rd.y > 0.0 ? (R.y - ro.y) / rd.y : (rd.y < 0.0 ? -ro.y / rd.y : 1e9);
    float tz = R.z / max(rd.z, 1e-4);
    float t = min(tx, min(ty, tz));
    vec3 p = ro + rd * t;
    vec3 lamp = vec3(R.x * (0.35 + 0.3 * hh(vec3(seed, 1.0, 2.0))), R.y * 0.95, R.z * 0.55);
    float fall = 0.25 + 0.75 * exp(-dot(p - lamp, p - lamp) / (R.x * R.x * 0.5 + 4.0));
    vec3 c;
    if (t == tz) {
      // back wall: paint colour, a sofa / desk / shelf silhouette, sometimes a picture
      vec3 paint = mix(vec3(0.85, 0.8, 0.7), vec3(0.6, 0.7, 0.85), hh(vec3(seed, 3.0, 1.0)));
      c = paint * fall * 0.75;
      float fx = p.x / R.x;
      float furn = step(p.y, R.y * (0.22 + 0.18 * hh(vec3(seed, 5.0, 1.0)))) * step(0.15 + 0.3 * hh(vec3(seed, 6.0, 1.0)), fx) * step(fx, 0.55 + 0.4 * hh(vec3(seed, 7.0, 1.0)));
      c *= 1.0 - 0.8 * furn;
      float pic = step(abs(fx - 0.5 - 0.2 * (hh(vec3(seed, 8.0, 1.0)) - 0.5)), 0.12) * step(abs(p.y / R.y - 0.6), 0.1) * step(0.5, hh(vec3(seed, 9.0, 1.0)));
      c = mix(c, vec3(0.9, 0.5, 0.3) * fall, pic * 0.6);
    } else if (t == ty) {
      if (rd.y > 0.0) {
        // ceiling: the lamp, or rows of office panels
        float panel = office > 0.5 ? step(0.62, fract(p.x / 1.6)) * step(0.55, fract(p.z / 2.4)) : 0.0;
        c = vec3(0.9) * (fall * 0.9 + 2.5 * exp(-dot(p.xz - lamp.xz, p.xz - lamp.xz) * 3.0) * (1.0 - office) + panel * 2.2);
      } else {
        c = vec3(0.45, 0.32, 0.22) * fall * 0.45 * (office > 0.5 ? 0.7 : 1.0);
      }
    } else {
      c = vec3(0.8, 0.76, 0.68) * fall * 0.55;
    }
    // depth darkening
    c *= 1.0 - 0.35 * clamp(t / (R.z * 1.5), 0.0, 1.0);
    return c * L;
  }
  // facade colour of a side face (N axis-aligned, world space); returns colour, writes the window coverage
  vec3 facade(vec3 W, vec3 N, vec3 V, vec4 B, float topY, float wake, vec3 skyTop, vec3 skyHor, out float winA) {
    vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
    float u = dot(W, T), v = W.y;
    float office = step(0.5, B.w) * step(B.w, 1.5);
    vec2 cell = office > 0.5 ? vec2(1.55, 3.9) : vec2(3.2, 3.2);
    vec2 g = vec2(u, v) / cell; vec2 id = floor(g); vec2 f = fract(g);
    vec2 lo = office > 0.5 ? vec2(0.06, 0.22) : vec2(0.3, 0.3), hi = office > 0.5 ? vec2(0.94, 0.95) : vec2(0.7, 0.84);
    vec2 fw = fwidth(g); float px = max(fw.x, fw.y);
    float aa = 0.5 * px;
    float inWin = smoothstep(lo.x - aa, lo.x + aa, f.x) * smoothstep(hi.x + aa, hi.x - aa, f.x) * smoothstep(lo.y - aa, lo.y + aa, f.y) * smoothstep(hi.y + aa, hi.y - aa, f.y);
    float floorsUp = step(1.0, id.y);
    // rooms: per bay (homes) or per 6-bay stretch of a floor (offices)
    // offices light whole floors (sometimes half a floor); homes room by room
    vec2 rid = office > 0.5 ? vec2(floor(id.x / 18.0) * step(0.8, hh(vec3(B.x, id.y, 7.0))), id.y) : id;
    float seed = hh(vec3(B.x * 7.13 + dot(N, vec3(1.0, 2.0, 3.0)), rid));
    float lit = step(seed, B.y * wake) * floorsUp;
    float kind = hh(vec3(seed * 31.0, B.x, 3.0));
    vec3 warm = vec3(1.0, 0.66, 0.36), cool = vec3(0.78, 0.86, 1.0), tv = vec3(0.4, 0.55, 1.0);
    vec3 fluo = vec3(0.82, 0.92, 0.88);
    vec3 Lc = office > 0.5 ? mix(fluo, warm, step(0.75, kind)) : (kind < 0.55 + 0.35 * B.z ? warm : kind < 0.9 ? mix(warm, cool, 0.6) : tv);
    float Li = (office > 0.5 ? 0.55 + 0.25 * hh(vec3(seed, 4.0, 4.0)) : 0.8 + 0.6 * hh(vec3(seed, 4.0, 4.0)));
    // interior
    vec3 rd = vec3(dot(V, T), V.y, dot(V, -N));
    vec3 R = office > 0.5 ? vec3(cell.x * 6.0, cell.y, 9.0) : vec3(cell.x, cell.y, 4.5);
    vec2 fr = office > 0.5 ? vec2(fract(g.x / 6.0) * 6.0, f.y) * cell : f * cell;
    // the room itself only up close; further away a window is just its light
    float detail = smoothstep(0.08, 0.035, px);
    vec3 inside = (detail > 0.0 ? mix(Lc * Li * 0.5, roomColor(vec3(fr, 0.0), normalize(rd), R, Lc * Li, seed * 91.0, office), detail) : Lc * Li * 0.5) * lit;
    // unlit rooms: a TV, or nearly black
    inside += (1.0 - lit) * step(0.93, kind) * tv * 0.12 * floorsUp;
    // curtains / blinds just behind the glass
    float cur = office > 0.5 ? 0.0 : step(0.62, hh(vec3(seed, 11.0, 1.0)));
    float side = hh(vec3(seed, 12.0, 1.0)) < 0.5 ? f.x : 1.0 - f.x;
    float cover = cur * step(side, lo.x + (hi.x - lo.x) * (0.25 + 0.6 * hh(vec3(seed, 13.0, 1.0))));
    vec3 fabric = mix(vec3(0.9, 0.55, 0.35), vec3(0.7, 0.75, 0.9), hh(vec3(seed, 14.0, 1.0)));
    inside = mix(inside, fabric * Lc * Li * 0.38 * lit, cover);
    float blinds = office > 0.5 ? step(0.85, hh(vec3(seed, 15.0, 1.0))) * (0.5 + 0.5 * step(0.5, fract(f.y * 14.0))) : 0.0;
    inside *= 1.0 - 0.55 * blinds;
    // glass: a little sky in it, more at grazing angles
    float fres = pow(1.0 - clamp(rd.z, 0.0, 1.0), 4.0);
    vec3 refl = mix(skyHor, skyTop, clamp(reflect(V, N).y * 2.0, 0.0, 1.0));
    vec3 glass = inside + refl * (0.08 + 0.5 * fres);
    // wall between windows: brick/concrete or spandrel glass; lit from the street below and by the sky
    vec3 wall = office > 0.5 ? vec3(0.006, 0.008, 0.013) + refl * (0.03 + 0.2 * fres) : mix(vec3(0.016, 0.012, 0.01), vec3(0.014, 0.014, 0.016), B.z);
    wall += vec3(1.0, 0.55, 0.25) * 0.05 * exp(-v / 9.0) + vec3(0.02, 0.025, 0.05) * 0.15;
    // sills and lintels: a lighter ledge under each window (homes)
    float sill = (1.0 - office) * smoothstep(lo.y - 0.07, lo.y - 0.04, f.y) * smoothstep(lo.y + 0.0, lo.y - 0.03, f.y) * step(lo.x - 0.06, f.x) * step(f.x, hi.x + 0.06);
    wall += vec3(0.05, 0.045, 0.04) * sill;
    // far away a window is a few pixels: keep its average, not a flickering sample
    float far = smoothstep(0.3, 0.7, px); // (the window's shape holds down to a few pixels per cell)
    float area = (hi.x - lo.x) * (hi.y - lo.y);
    vec3 avgWin = Lc * Li * 0.42 * step(seed, B.y * wake) * floorsUp + refl * 0.05;
    vec3 near = mix(wall, glass, inWin);
    vec3 farC = mix(wall, avgWin, area);
    winA = inWin;
    return mix(near, farC, far);
  }
`;

export class City extends THREE.Group {
  buildings: THREE.InstancedMesh;
  mat: THREE.ShaderMaterial;
  groundMat: THREE.ShaderMaterial;
  lamps: GlowPoints;
  traffic: GlowLines;
  beacons: GlowPoints;
  carPaths: { x0: number; z0: number; dx: number; dz: number; len: number; speed: number; off: number; dir: number }[] = [];
  /** Building footprints (x, z, w, d, h) — e.g. to put things on roofs. */
  boxes: [number, number, number, number, number][] = [];
  private beaconSpots: [number, number, number, number][] = [];
  cloudMat?: THREE.ShaderMaterial;

  constructor(o: CityOpts = {}) {
    super();
    const r = mulberry32(o.seed ?? 3);
    const half = o.half ?? 1600, block = o.block ?? 110, street = o.street ?? 22;
    const [cx, cz] = o.centre ?? [0, -700];
    const dR = o.downtownR ?? 450;
    const clears = !o.clear ? [] : Array.isArray(o.clear[0]) ? (o.clear as [number, number, number][]) : [o.clear as [number, number, number]];
    // instances: x, z, w, d, base y, height, seed, density, warmth, type, top y
    const inst: number[][] = [];
    for (let bx = -half; bx < half; bx += block) {
      for (let bz = -half; bz < half; bz += block) {
        const inner = block - street;
        const n = 1 + Math.floor(r() * 3.2);
        for (let k = 0; k < n; k++) {
          const w = inner / (n > 2 ? 2 : n) * (0.78 + r() * 0.18), d = inner * (n > 2 ? 0.46 : 0.86) * (0.82 + r() * 0.16);
          const x = bx + street / 2 + (n > 2 ? (k % 2) * inner / 2 : k * inner / n) + w / 2 + (r() - 0.5) * 3;
          const z = bz + street / 2 + (n > 2 ? Math.floor(k / 2) * inner / 2 : 0) + d / 2 + (r() - 0.5) * 3;
          if (clears.some(([qx, qz, qr]) => Math.hypot(x - qx, z - qz) < qr)) continue;
          const dist = Math.hypot(x - cx, z - cz);
          const down = Math.exp(-(dist * dist) / (dR * dR));
          let h = 12 + Math.pow(r(), 2.0) * 34 + down * (40 + Math.pow(r(), 1.4) * 210);
          if (r() < 0.02) h += 70;
          h = Math.round(h / 3.2) * 3.2 + 0.6;
          const office = h > 70 ? r() < 0.75 : r() < 0.15;
          const seed = r() * 100, kind = r();
          const dens = kind < 0.12 ? 0.04 + r() * 0.06 : office ? 0.35 + r() * 0.45 : 0.18 + r() * 0.32;
          const warmth = r();
          this.boxes.push([x, z, w, d, h]);
          // towers step back: a base, then one or two narrower tiers
          const tiers = h > 90 ? (r() < 0.6 ? 3 : 2) : h > 50 && r() < 0.5 ? 2 : 1;
          let y0 = 0, tw = w, td = d;
          for (let ti = 0; ti < tiers; ti++) {
            const th = ti === tiers - 1 ? h - y0 : Math.round((h * (ti === 0 ? 0.35 + r() * 0.2 : 0.3 + r() * 0.2)) / 3.2) * 3.2;
            inst.push([x, z, tw, td, y0, th, seed, dens, warmth, office ? 1 : 0, h]);
            y0 += th;
            tw *= 0.72 + r() * 0.12; td *= 0.72 + r() * 0.12;
          }
          // rooftop plant: a penthouse box, a water tank on older low buildings
          if (r() < 0.7) inst.push([x + (r() - 0.5) * tw * 0.4, z + (r() - 0.5) * td * 0.4, tw * (0.25 + r() * 0.2), td * (0.25 + r() * 0.2), h, 2.5 + r() * 3, seed, 0, warmth, 2, h]);
          if (!office && h < 60 && r() < 0.35) inst.push([x + (r() - 0.5) * tw * 0.5, z + (r() - 0.5) * td * 0.5, 3.2, 3.2, h + 2.5, 3.5, seed, 0, warmth, 3, h]);
          if (h > 120) this.beaconSpots.push([x, h + 1, z, r()]);
        }
      }
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const fogC = o.fogColor ?? new THREE.Color(0.016, 0.018, 0.045);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        fogD: { value: o.fog ?? 0.0009 }, fogC: { value: fogC },
        wake: { value: 1 }, wakeFrom: { value: new THREE.Vector3(0, 0, 0) }, wakeR: { value: 1e9 }, wakeSoft: { value: 120 },
        gold: { value: 0 }, goldFrom: { value: new THREE.Vector3() }, goldR: { value: 1e9 }, t: { value: 0 }, gain: { value: 1 },
        skyTop: { value: new THREE.Color(0.003, 0.004, 0.012) }, skyHor: { value: new THREE.Color(0.04, 0.03, 0.035) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aB; attribute float aTop;
        varying vec3 vN; varying vec3 vW; varying vec4 vB; varying float vTop;
        void main() {
          vN = normal; vB = aB; vTop = aTop;
          vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float fogD, wake, wakeR, wakeSoft, gold, goldR, t, gain; uniform vec3 fogC, wakeFrom, goldFrom, skyTop, skyHor;
        varying vec3 vN; varying vec3 vW; varying vec4 vB; varying float vTop;
        ${FACADE_GLSL}
        void main() {
          vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
          vec3 c;
          float dw = length(vW.xz - wakeFrom.xz);
          float wk = wake * (1.0 - smoothstep(wakeR - wakeSoft, wakeR, dw));
          if (abs(N.y) > 0.5) {
            // roof: gravel, a lighter parapet line at the edge
            c = vec3(0.012, 0.012, 0.016) * (0.8 + 0.4 * hh(vec3(floor(vW.xz * 3.0), 2.0)));
          } else if (vB.w > 1.5) {
            // rooftop plant and water tanks: dark, lit a little from below
            c = vec3(0.018, 0.016, 0.016) + vec3(1.0, 0.6, 0.3) * 0.02 * step(vW.y, vTop + 0.5);
          } else {
            float wa;
            c = facade(vW, N, V, vB, vTop, wk, skyTop, skyHor, wa);
            // LED crowns on the tallest towers
            float crown = step(150.0, vTop) * step(0.55, fract(vB.x * 1.37)) * smoothstep(vTop - 2.2, vTop - 1.8, vW.y) * step(vW.y, vTop - 1.2);
            vec3 crownC = mix(vec3(1.0, 0.8, 0.55), vec3(0.55, 0.8, 1.0), step(0.5, fract(vB.x * 3.7)));
            c += crownC * crown * 0.7;
            // the waking wave's front flares; gold spreads from a point
            float wq = (dw - wakeR) / max(wakeSoft, 1.0);
            c += vec3(1.0, 0.7, 0.4) * wa * exp(-wq * wq) * 1.5 * step(wakeR, 1e8);
            float dg = length(vW.xz - goldFrom.xz);
            float gIn = (1.0 - smoothstep(goldR - 80.0, goldR, dg)) * gold;
            float lum = max(c.r, max(c.g, c.b));
            c = mix(c, vec3(1.0, 0.68, 0.2) * lum * 1.15, gIn * wa);
            float gq = (dg - goldR) / 80.0;
            c *= 1.0 + 2.0 * exp(-gq * gq) * gold * step(goldR, 1e8);
          }
          c *= gain;
          float d = length(vW - cameraPosition);
          c = mix(fogC, c, exp(-fogD * fogD * d * d));
          float haze = (1.0 - exp(-d * 0.0016)) * exp(-max(vW.y, 0.0) / 30.0);
          c = mix(c, vec3(0.06, 0.04, 0.032) * (1.0 - gold) + vec3(0.1, 0.06, 0.02) * gold, clamp(haze, 0.0, 0.8));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.buildings = new THREE.InstancedMesh(geo, this.mat, inst.length);
    const aB = new Float32Array(inst.length * 4), aTop = new Float32Array(inst.length);
    const m = new THREE.Matrix4();
    inst.forEach(([x, z, w, d, y0, hgt, seed, dens, warmth, type, top], i) => {
      m.makeScale(w!, hgt!, d!).setPosition(x!, y0!, z!);
      this.buildings.setMatrixAt(i, m);
      aB.set([seed!, dens!, warmth!, type!], i * 4);
      aTop[i] = top!;
    });
    geo.setAttribute('aB', new THREE.InstancedBufferAttribute(aB, 4));
    geo.setAttribute('aTop', new THREE.InstancedBufferAttribute(aTop, 1));
    this.buildings.frustumCulled = false;
    this.add(this.buildings);

    // the ground: dark lots, asphalt streets with pools of sodium light under the lamps, the same haze
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: this.mat.uniforms,
      vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `
        uniform float fogD, gold, t; uniform vec3 fogC;
        varying vec3 vW;
        const float BLOCK = ${block.toFixed(1)}, STREET = ${street.toFixed(1)}, HALF = ${half.toFixed(1)};
        void main() {
          vec2 q = vW.xz + HALF;
          vec2 m = mod(q, BLOCK);
          vec2 dc = min(m, BLOCK - m);
          float onX = 1.0 - smoothstep(STREET * 0.5 - 1.0, STREET * 0.5 + 1.0, dc.x);
          float onZ = 1.0 - smoothstep(STREET * 0.5 - 1.0, STREET * 0.5 + 1.0, dc.y);
          float street = max(onX, onZ);
          vec3 c = vec3(0.006, 0.007, 0.012);
          c = mix(c, vec3(0.02, 0.02, 0.024), street);
          float ax = abs(mod(vW.z + HALF, 32.0) - 16.0), az = abs(mod(vW.x + HALF, 32.0) - 16.0);
          float poolX = exp(-(dc.x * dc.x) / 60.0) * (0.35 + exp(-(16.0 - ax) * (16.0 - ax) / 40.0));
          float poolZ = exp(-(dc.y * dc.y) / 60.0) * (0.35 + exp(-(16.0 - az) * (16.0 - az) / 40.0));
          vec3 sodium = mix(vec3(1.0, 0.5, 0.17), vec3(1.0, 0.68, 0.2), gold);
          c += sodium * (poolX * onX + poolZ * onZ) * 0.38;
          float dash = step(0.5, fract(vW.z / 9.0)) * (1.0 - smoothstep(0.15, 0.3, dc.x)) * onX + step(0.5, fract(vW.x / 9.0)) * (1.0 - smoothstep(0.15, 0.3, dc.y)) * onZ;
          c += vec3(0.05, 0.045, 0.04) * dash;
          // sidewalks glow a little from shop windows
          float walk = (smoothstep(STREET * 0.5 - 1.0, STREET * 0.5, max(dc.x, dc.y)) - smoothstep(STREET * 0.5 + 2.5, STREET * 0.5 + 3.5, min(dc.x, dc.y))) ;
          c += vec3(1.0, 0.75, 0.45) * 0.03 * clamp(walk, 0.0, 1.0);
          float d = length(vW - cameraPosition);
          c = mix(fogC, c, exp(-fogD * fogD * d * d));
          float haze = (1.0 - exp(-d * 0.0022));
          c = mix(c, vec3(0.08, 0.052, 0.04) * (1.0 - gold) + vec3(0.12, 0.07, 0.02) * gold, clamp(haze, 0.0, 0.85));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(half * 2.4, half * 2.4), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.02;
    this.add(ground);

    // streetlights along every street line
    const lampPos: number[] = [];
    for (let s = -half; s <= half; s += block) for (let a = -half; a <= half; a += 32) lampPos.push(s + 3, a, a, s + 3);
    this.lamps = new GlowPoints(lampPos.length / 2, 1.1, { fogDensity: o.fog ?? 0.0009 });
    for (let i = 0; i < lampPos.length; i += 2) {
      this.lamps.set(i / 2, lampPos[i]!, 6, lampPos[i + 1]!, new THREE.Color(1, 0.55, 0.2).multiplyScalar(0.5 + r() * 0.4), 1, 1);
    }
    this.lamps.commit();
    this.add(this.lamps);
    // traffic: head and tail lights as long-exposure streaks
    const nCars = 1600;
    this.traffic = new GlowLines(nCars, 0.45);
    for (let i = 0; i < nCars; i++) {
      const alongX = r() < 0.5, line = -half + Math.floor(r() * (2 * half / block)) * block + (r() < 0.5 ? -3.5 : 3.5);
      this.carPaths.push({ x0: alongX ? -half : line, z0: alongX ? line : -half, dx: alongX ? 1 : 0, dz: alongX ? 0 : 1, len: 2 * half, speed: 8 + r() * 10, off: r() * 2 * half, dir: r() < 0.5 ? 1 : -1 });
    }
    this.add(this.traffic);
    // aviation lights on the tall ones
    this.beacons = new GlowPoints(this.beaconSpots.length * 2, 1.6, { fogDensity: (o.fog ?? 0.0009) * 0.6 });
    this.add(this.beacons);

    if (o.clouds) {
      // a low cloud deck, lit from below by the city's glow
      this.cloudMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { t: { value: 0 }, gold: this.mat.uniforms.gold, fogD: this.mat.uniforms.fogD, fogC: this.mat.uniforms.fogC },
        vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: /* glsl */ `
          uniform float t, gold, fogD; uniform vec3 fogC; varying vec3 vW;
          float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
          float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
          void main() {
            vec2 p = vW.xz / 900.0 + vec2(t * 0.004, t * 0.002);
            float d = fbm(p + fbm(p * 0.7) * 0.8);
            float a = smoothstep(0.42, 0.75, d);
            float dist = length(vW.xz - cameraPosition.xz);
            vec3 c = mix(vec3(0.06, 0.033, 0.026), vec3(0.1, 0.06, 0.02), gold) * (0.35 + 0.9 * d);
            a *= smoothstep(9000.0, 2500.0, dist) * 0.55 * smoothstep(0.5, 0.8, d + 0.2);
            gl_FragColor = vec4(c, a);
          }`,
      });
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(26000, 26000), this.cloudMat);
      deck.rotation.x = -Math.PI / 2;
      deck.position.y = o.clouds;
      deck.renderOrder = -2;
      this.add(deck);
    }
  }

  /** Per frame: traffic (deterministic in t), beacons, the window clock. */
  update(t: number, camPos: THREE.Vector3) {
    this.mat.uniforms.t!.value = t;
    if (this.cloudMat) this.cloudMat.uniforms.t!.value = t;
    const g = this.mat.uniforms.gold!.value as number;
    const head = new THREE.Color(1, 0.93, 0.8), tail = new THREE.Color(1, 0.06, 0.03), gc = new THREE.Color(1, 0.66, 0.2);
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this.carPaths.forEach((p, i) => {
      const s = (((p.off + p.dir * p.speed * t) % p.len) + p.len) % p.len;
      const x = p.x0 + p.dx * s, z = p.z0 + p.dz * s;
      const trail = p.speed * 0.6; // a 0.6 s exposure
      a.set(x, 1.1, z);
      b.set(x - p.dx * p.dir * trail, 1.1, z - p.dz * p.dir * trail);
      const toward = (camPos.x - x) * p.dx * p.dir + (camPos.z - z) * p.dz * p.dir > 0;
      const c = (toward ? head : tail).clone();
      if (g > 0) c.lerp(gc, g);
      this.traffic.set(i, a, b, c, toward ? 0.9 : 0.75);
    });
    this.traffic.commit(this.carPaths.length);
    this.beaconSpots.forEach(([x, y, z, ph], i) => {
      const on = Math.sin((t + ph * 2) * Math.PI * 0.75) > 0.55 ? 1 : 0.08;
      this.beacons.set(i, x, y, z, new THREE.Color(1, 0.08, 0.04), on * 2.2, 1);
    });
    this.beacons.commit(this.beaconSpots.length);
  }

  set gold(k: number) { this.mat.uniforms.gold!.value = k; }
  set wake(k: number) { this.mat.uniforms.wake!.value = k; }
  /** A golden wave: inside radius `r` (m) around `from` the windows turn gold; the front flares. */
  goldWave(from: THREE.Vector3, r: number) { (this.mat.uniforms.goldFrom!.value as THREE.Vector3).copy(from); this.mat.uniforms.goldR!.value = r; }
}
