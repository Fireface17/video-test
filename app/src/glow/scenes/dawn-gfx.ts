// Graphics for the final chorus at dawn (`dawn`): golden threads of light (glowing segments with a pixel floor, so
// a thread across the city stays a fine line at any distance), layers of morning mist the camera rises through,
// a flock of birds, the last stars of the night drifting down and melting into the sunlight, and steam from roof
// vents catching the low sun. Everything is a pure function of t.
import * as THREE from 'three';
import { SCALE } from '../../engine/gl';
import { clamp, hash, noise1, smoothstep } from '../../engine/util';
import { GlowPoints } from '../lib/points';

/**
 * Instanced glowing segments with a world half-width and a floor in pixels (a thread thinner than the floor is
 * drawn at the floor and dimmed instead). Additive, depth-tested, clipped at the near plane.
 */
export class Threads extends THREE.Mesh {
  declare geometry: THREE.InstancedBufferGeometry;
  declare material: THREE.ShaderMaterial;
  private A: Float32Array; private B: Float32Array; private C: Float32Array; private Wd: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  n = 0;

  constructor(public cap: number, minPx = 0.8) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const A = new Float32Array(cap * 3), B = new Float32Array(cap * 3), C = new Float32Array(cap * 3), Wd = new Float32Array(cap);
    const mk = (a: Float32Array, k: number) => new THREE.InstancedBufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage);
    const attrs = [mk(A, 3), mk(B, 3), mk(C, 3), mk(Wd, 1)];
    g.setAttribute('aA', attrs[0]!); g.setAttribute('aB', attrs[1]!); g.setAttribute('aC', attrs[2]!); g.setAttribute('aW', attrs[3]!);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { pxScale: { value: (1080 * SCALE) / 2 }, minPx: { value: minPx * SCALE } },
      vertexShader: /* glsl */ `
        attribute vec3 aA, aB, aC; attribute float aW;
        uniform float pxScale, minPx;
        varying vec3 vC; varying float vS;
        void main() {
          vec4 a = modelViewMatrix * vec4(aA, 1.0), b = modelViewMatrix * vec4(aB, 1.0);
          const float NZ = 0.06;
          if ((a.z > -NZ && b.z > -NZ) || aW <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0); vS = 0.0; return; }
          if (a.z > -NZ) a = mix(a, b, (a.z + NZ) / (a.z - b.z));
          if (b.z > -NZ) b = mix(b, a, (b.z + NZ) / (b.z - a.z));
          vec4 p = mix(a, b, position.x);
          vec3 d = b.xyz - a.xyz; float dl = length(d);
          vec3 dir = dl > 1e-6 ? d / dl : vec3(1.0, 0.0, 0.0);
          vec3 sd = cross(dir, normalize(-p.xyz + vec3(0.0, 0.0, 1e-6))); float sl = length(sd);
          sd = sl > 1e-6 ? sd / sl : vec3(0.0, 1.0, 0.0);
          float depth = max(-p.z, NZ);
          float px = aW * projectionMatrix[1][1] * pxScale / depth;
          float w = aW, dim = 1.0;
          if (px < minPx) { w = aW * minPx / max(px, 1e-4); dim = px / minPx; }
          p.xyz += sd * position.y * w;
          vC = aC * dim;
          vS = position.y;
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vS;
        void main() { float k = exp(-vS * vS * 6.0) + 0.35 * exp(-vS * vS * 1.2); gl_FragColor = vec4(vC * k, 1.0); }`,
    });
    super(g, mat);
    this.A = A; this.B = B; this.C = C; this.Wd = Wd; this.attrs = attrs;
    this.frustumCulled = false;
  }

  begin() { this.n = 0; }

  seg(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Color, k: number, w: number) {
    if (this.n >= this.cap || k <= 0.002) return;
    const i = this.n++;
    this.A[i * 3] = a.x; this.A[i * 3 + 1] = a.y; this.A[i * 3 + 2] = a.z;
    this.B[i * 3] = b.x; this.B[i * 3 + 1] = b.y; this.B[i * 3 + 2] = b.z;
    this.C[i * 3] = c.r * k; this.C[i * 3 + 1] = c.g * k; this.C[i * 3 + 2] = c.b * k;
    this.Wd[i] = w;
  }

  /** A sagging thread from a to b (grown to u 0..1 from a), in `n` segments. */
  sag(a: THREE.Vector3, b: THREE.Vector3, sag: number, c: THREE.Color, k: number, w: number, u = 1, n = 10) {
    if (u <= 0) return;
    let px = a.x, py = a.y, pz = a.z;
    const m = Math.max(1, Math.ceil(n * u));
    for (let i = 1; i <= m; i++) {
      const s = Math.min(u, i / n);
      const x = a.x + (b.x - a.x) * s, y = a.y + (b.y - a.y) * s - 4 * sag * s * (1 - s), z = a.z + (b.z - a.z) * s;
      this.seg({ x: px, y: py, z: pz }, { x, y, z }, c, k, w);
      px = x; py = y; pz = z;
    }
  }

  end() {
    this.geometry.instanceCount = this.n;
    for (const a of this.attrs) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, this.n * a.itemSize); }
  }
}

/**
 * Layers of morning mist: wide horizontal sheets at the given heights, soft noise, lit warm by the low sun; each
 * fades out as the camera gets near it, so rising through one is a soft wash, never a pane.
 */
export class Mist extends THREE.Group {
  mats: THREE.ShaderMaterial[] = [];
  constructor(public heights: number[], size = 6000) {
    super();
    for (const [i, h] of heights.entries()) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { t: { value: 0 }, k: { value: 1 }, seed: { value: i * 17.3 }, col: { value: new THREE.Color(1, 0.75, 0.55) }, sunDir: { value: new THREE.Vector3(1, 0.1, 0) }, sunCol: { value: new THREE.Color(1, 0.7, 0.4) } },
        vertexShader: /* glsl */ `
          varying vec3 vW;
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float t, k, seed; uniform vec3 col, sunDir, sunCol;
          varying vec3 vW;
          float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
          float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
          void main() {
            vec2 q = vW.xz / 260.0 + vec2(t * 0.012, t * 0.004) + seed;
            float d = fbm(q + 0.6 * vec2(fbm(q * 0.7 + 3.1), fbm(q * 0.7 - 1.7)));
            float a = smoothstep(0.42, 0.85, d);
            float dist = length(vW - cameraPosition);
            // near the camera the sheet thins away; far off it fades into the haze
            a *= smoothstep(6.0, 60.0, abs(vW.y - cameraPosition.y) + 0.02 * dist) * smoothstep(5000.0, 1200.0, dist);
            vec3 v = normalize(vW - cameraPosition);
            float fw = pow(max(dot(v, normalize(sunDir)), 0.0), 6.0);
            vec3 c = col * (0.55 + 0.45 * d) + sunCol * fw * 0.8;
            gl_FragColor = vec4(c, a * k);
          }`,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = h;
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.add(m);
      this.mats.push(mat);
    }
  }
  update(t: number, k: number, sunDir: THREE.Vector3, col: THREE.Color, sunCol: THREE.Color) {
    for (const m of this.mats) {
      m.uniforms.t!.value = t;
      m.uniforms.k!.value = k;
      (m.uniforms.sunDir!.value as THREE.Vector3).copy(sunDir);
      (m.uniforms.col!.value as THREE.Color).copy(col);
      (m.uniforms.sunCol!.value as THREE.Color).copy(sunCol);
    }
  }
}

/** A flock: dark birds with flapping wings, each on its own path (a function of t), silhouetted against the dawn. */
export class Birds extends THREE.Mesh {
  declare geometry: THREE.BufferGeometry;
  private pos: Float32Array;
  constructor(public n: number) {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 4 * 3 * 3); // 4 triangles: two per wing
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    super(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.01, 0.012), side: THREE.DoubleSide, fog: false }));
    this.pos = pos;
    this.frustumCulled = false;
    this.renderOrder = 6;
  }

  /**
   * Bird i at `p` heading `dir` (unit), size `s`, wing phase `ph` (radians). Writes two wings of two triangles
   * each (inner and outer panel, the outer one bending further).
   */
  set(i: number, p: THREE.Vector3, dir: THREE.Vector3, s: number, ph: number) {
    const f = dir, side = new THREE.Vector3(-f.z, 0, f.x).normalize(), up = new THREE.Vector3().crossVectors(side, f).normalize();
    const a1 = Math.sin(ph) * 0.55, a2 = a1 + Math.sin(ph - 0.6) * 0.35;
    const o = i * 36;
    const w = (k: number, sd: number) => {
      const root = p, mid = p.clone().addScaledVector(side, sd * Math.cos(a1) * 0.5 * s).addScaledVector(up, Math.sin(a1) * 0.5 * s);
      const tip = mid.clone().addScaledVector(side, sd * Math.cos(a2) * 0.5 * s).addScaledVector(up, Math.sin(a2) * 0.5 * s).addScaledVector(f, -0.15 * s);
      const fr = root.clone().addScaledVector(f, 0.18 * s), bk = root.clone().addScaledVector(f, -0.22 * s), mb = mid.clone().addScaledVector(f, -0.1 * s);
      const tri = (q: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => { this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], o + (k * 2 + q) * 9); };
      tri(0, fr, bk, mid);
      tri(1, mid, mb, tip);
    };
    w(0, 1);
    w(1, -1);
  }
  hide(i: number) { this.pos.fill(0, i * 36, i * 36 + 36); }
  commit() { (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; }
}

/** Birds taking off from the roofs at `t0` and wheeling out toward the sun (a pure function of t). */
export function flock(B: Birds, t: number, t0: number, from: THREE.Vector3, toward: THREE.Vector3, seed: number, spread = 14) {
  const T = new THREE.Vector3();
  for (let i = 0; i < B.n; i++) {
    const h = (k: number) => hash(i, seed, k);
    const ti = t0 + h(1) * 0.8, age = t - ti;
    if (age < 0) { B.hide(i); continue; }
    const start = from.clone().add(new THREE.Vector3((h(2) - 0.5) * spread, h(3) * 2, (h(4) - 0.5) * spread));
    const v = 6 + 3 * h(5);
    const dir = toward.clone().add(new THREE.Vector3((h(6) - 0.5) * 0.6, 0.15 + 0.25 * h(7), (h(8) - 0.5) * 0.6)).normalize();
    // up and away, curving gently (the flock turns together, each a little differently)
    const turn = 0.25 * Math.sin(age * 0.5 + h(9)) + 0.15 * noise1(age * 0.4, i + seed);
    const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
    const climb = Math.min(age, 1.2) * 2.5;
    T.copy(start).addScaledVector(d, v * age).add(new THREE.Vector3(0, climb + noise1(age * 1.3, i) * 0.5, 0));
    const vel = d.clone().add(new THREE.Vector3(0, age < 1.2 ? 0.4 : 0.05, 0)).normalize();
    B.set(i, T, vel, 0.32 + 0.12 * h(10), (t - ti) * (age < 1.5 ? 22 : 13) + h(11) * 6);
  }
  B.commit();
}

/**
 * The last stars of the night: points in the western sky (around `c` at radius R) that come loose and drift down,
 * turning gold and melting into the light as they sink into the dawn. `t0` they begin, over `span` s.
 */
export class LastStars extends GlowPoints {
  private dirs: Float32Array;
  constructor(n: number, seed: number) {
    super(n, 1);
    this.dirs = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const h = (k: number) => hash(i, seed, k);
      // the western half of the sky, higher up more of them
      const az = Math.PI * (0.55 + 0.9 * h(1)), el = 0.12 + Math.pow(h(2), 0.7) * 1.1;
      this.dirs.set([Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el), h(3)], i * 4);
    }
    this.renderOrder = 4;
  }
  update(t: number, c: THREE.Vector3, R: number, t0: number, span: number, k: number, white: THREE.Color, gold: THREE.Color) {
    const col = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      const h = (q: number) => hash(i, 77, q);
      const dx = this.dirs[i * 4]!, dy = this.dirs[i * 4 + 1]!, dz = this.dirs[i * 4 + 2]!, r = this.dirs[i * 4 + 3]!;
      const tl = t0 + r * span * 0.7, age = Math.max(0, t - tl);
      const fall = age * (0.06 + 0.06 * h(1)) + age * age * 0.02;
      const el = Math.asin(clamp(dy)) - fall;
      if (el < -0.02) { this.hide(i); continue; }
      const az = Math.atan2(dz, dx) + noise1(age * 0.6, i) * 0.03 * age;
      const p = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).multiplyScalar(R).add(c);
      const g = smoothstep(0, 1.2, age);
      const melt = smoothstep(0.2, 2.6, age + 0.6 * h(2)) * (1 - smoothstep(0.05, 0.22, el) * 0.3);
      col.copy(white).lerp(gold, g);
      const tw = 0.75 + 0.25 * Math.sin(t * (3 + 4 * h(3)) + i);
      // twinkle, then a brief swell as it turns gold, then gone
      const kk = k * tw * (0.5 + 0.9 * h(4)) * (1 + 1.4 * g * (1 - melt)) * (1 - melt);
      this.set(i, p.x, p.y, p.z, col, kk, R * (0.0035 + 0.004 * h(5)) * (1 + 1.5 * g * (1 - melt)));
    }
    this.commit();
  }
}

/** Steam from roof vents, lit gold from the side by the low sun. */
export class Steam extends GlowPoints {
  constructor(public from: THREE.Vector3[], public per = 28) { super(from.length * per, 1); this.renderOrder = 3; }
  update(t: number, k: number, col: THREE.Color) {
    let n = 0;
    this.from.forEach((s, si) => {
      for (let j = 0; j < this.per; j++) {
        const life = 3.6, ph = hash(j, si) * life, cyc = Math.floor((t + ph) / life), age = (t + ph - cyc * life) / life;
        const x = s.x + age * 2.2 + noise1(t * 0.5 + j, si) * 0.35 * age, y = s.y + age * 2.8, z = s.z - age * 0.6 + noise1(t * 0.4 + j, si + 9) * 0.35 * age;
        this.set(n++, x, y, z, col, k * Math.sin(Math.PI * age) * (0.5 + 0.5 * hash(j, cyc + si)), 0.45 + age * 1.3);
      }
    });
    this.commit(n);
  }
}
