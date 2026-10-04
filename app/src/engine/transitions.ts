// Transitions between two rendered frames (linear HDR textures): the outgoing frame A and the incoming
// frame B, at progress k (0 = all A, 1 = all B). Used by the engine for timeline entries that declare a
// `transition` (their windows then overlap the cut by `dur`), and by scenes that cut between their own
// sub-scenes. Every effect is a pure function of (A, B, k, seed), so motion blur and seeking work.
import * as THREE from 'three';
import { FSPass, W, H } from './gl';

export type TransitionKind = 'crossfade' | 'zoom' | 'whip' | 'light' | 'iris' | 'glitch' | 'sparks' | 'shatter';

export interface TransitionSpec {
  kind: TransitionKind;
  /** Overlap in seconds, centred on the cut. */
  dur: number;
  /** whip: direction of travel in screen units (x right, y up), default [1, 0]. zoom / iris: centre (0..1 uv). */
  dir?: [number, number];
  centre?: [number, number];
  /** Linear colour of the light / glow edges (light, iris, sparks, shatter). */
  color?: [number, number, number];
  seed?: number;
}

const HEAD = /* glsl */ `
uniform sampler2D A; uniform sampler2D B; uniform float k; uniform float seed; uniform vec3 tint; uniform vec2 dirc;
const float ASPECT = ${(W / H).toFixed(6)};
float ease(float x) { x = sat(x); return x * x * (3.0 - 2.0 * x); }
`;

const FRAGS: Record<Exclude<TransitionKind, 'shatter'>, string> = {
  crossfade: `void main() { fragColor = mix(texture(A, vUv), texture(B, vUv), ease(k)); }`,
  // punch through: A rushes toward the camera with radial blur into a burst of light, B pulls out of it
  zoom: `
    vec3 radial(sampler2D T, vec2 uv, float s, float blur) {
      vec3 acc = vec3(0.0);
      float j = hash12(gl_FragCoord.xy + seed * 97.0); // per-pixel jitter: noise instead of stepped copies
      for (int i = 0; i < 20; i++) { float f = 1.0 - blur * (float(i) + j) / 20.0; acc += texture(T, dirc + (uv - dirc) * s * f).rgb; }
      return acc / 20.0;
    }
    void main() {
      float ka = ease(k / 0.55), kb = ease((k - 0.45) / 0.55);
      vec3 a = radial(A, vUv, 1.0 / (1.0 + 5.0 * ka * ka), 0.35 * ka);
      vec3 b = radial(B, vUv, 1.0 / (1.0 + 2.5 * (1.0 - kb) * (1.0 - kb)), 0.3 * (1.0 - kb));
      float flash = exp(-pow((k - 0.5) / 0.1, 2.0));
      vec3 c = mix(a * (1.0 + 2.0 * ka), b * (1.0 + 2.0 * (1.0 - kb)), smoothstep(0.42, 0.58, k));
      fragColor = vec4(c + tint * flash * 2.5, 1.0);
    }`,
  // whip pan: both frames slide along dirc with heavy motion blur, crossing in the middle
  whip: `
    vec3 blurAlong(sampler2D T, vec2 uv, vec2 d) {
      vec3 acc = vec3(0.0);
      float j = hash12(gl_FragCoord.xy + seed * 97.0);
      for (int i = 0; i < 24; i++) acc += texture(T, uv + d * ((float(i) + j) / 24.0 - 0.5)).rgb;
      return acc / 24.0;
    }
    void main() {
      vec2 d = normalize(dirc) * vec2(1.0, ASPECT) / ASPECT;
      float e = ease(k);
      float speed = sin(3.14159 * sat(k));
      vec3 a = blurAlong(A, vUv - d * e * 1.1, d * 0.45 * speed);
      vec3 b = blurAlong(B, vUv + d * (1.0 - e) * 1.1, d * 0.45 * speed);
      fragColor = vec4(mix(a, b, smoothstep(0.38, 0.62, k)), 1.0);
    }`,
  // light: A's light swells and floods to the tint, B emerges from it
  light: `
    void main() {
      float f = exp(-pow((k - 0.5) / 0.16, 2.0));
      vec3 a = texture(A, vUv).rgb * (1.0 + 6.0 * ease(k / 0.5));
      vec3 b = texture(B, vUv).rgb * (1.0 + 5.0 * (1.0 - ease((k - 0.5) / 0.5)));
      fragColor = vec4(mix(a, b, smoothstep(0.46, 0.54, k)) + tint * f * 3.0, 1.0);
    }`,
  // iris: B opens inside a turning five-pointed star with a glowing rim
  iris: `
    float sdStar5(vec2 p, float r, float rf) {
      const vec2 k1 = vec2(0.809016994375, -0.587785252292), k2 = vec2(-k1.x, k1.y);
      p.x = abs(p.x); p -= 2.0 * max(dot(k1, p), 0.0) * k1; p -= 2.0 * max(dot(k2, p), 0.0) * k2;
      p.x = abs(p.x); p.y -= r;
      vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
      float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
      return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
    }
    void main() {
      vec2 p = (vUv - dirc) * vec2(ASPECT, 1.0);
      p = rot2(k * 1.6 + seed) * p;
      float r = pow(ease(k), 1.6) * 2.4;
      float d = sdStar5(p, r, 0.45);
      float inside = 1.0 - smoothstep(-0.004, 0.004, d);
      float rim = exp(-abs(d) / 0.012) * (1.0 - smoothstep(0.85, 1.0, k)) * step(0.001, k);
      fragColor = vec4(mix(texture(A, vUv).rgb, texture(B, vUv).rgb, inside) + tint * rim * 3.0, 1.0);
    }`,
  // glitch: blocks of B tear into A with an RGB split, then A's last blocks tear away
  glitch: `
    void main() {
      float t = floor(k * 18.0);
      vec2 blk = floor(vUv * vec2(12.0, 22.0) + vec2(hash11(t + seed) * 3.0, 0.0));
      float h = hash12(blk + t * 7.13 + seed);
      float useB = step(h, ease(k * 1.15 - 0.075));
      vec2 off = vec2((hash12(blk + 3.1 + t) - 0.5) * 0.08 * sin(3.14159 * k), 0.0);
      float split = 0.012 * sin(3.14159 * k);
      vec3 a = vec3(texture(A, vUv + off + vec2(split, 0.0)).r, texture(A, vUv + off).g, texture(A, vUv + off - vec2(split, 0.0)).b);
      vec3 b = vec3(texture(B, vUv + off + vec2(split, 0.0)).r, texture(B, vUv + off).g, texture(B, vUv + off - vec2(split, 0.0)).b);
      fragColor = vec4(mix(a, b, useB), 1.0);
    }`,
  // sparks: A burns away along a noise front with glowing embers at the edge, revealing B
  sparks: `
    void main() {
      vec2 p = vUv * vec2(ASPECT, 1.0) * 3.0;
      float n = 0.5 + 0.5 * fbm(p + seed, 4);
      n = mix(n, vUv.y, 0.35);
      float front = mix(-0.15, 1.15, ease(k));
      float d = n - front;
      float showA = smoothstep(-0.01, 0.01, d);
      float edge = exp(-abs(d) / 0.025) * step(0.001, k) * step(k, 0.999);
      float ember = step(0.86, hash12(floor(vUv * vec2(W_PX, H_PX) / 3.0) + floor(k * 30.0))) * exp(-abs(d) / 0.06);
      vec3 c = mix(texture(B, vUv).rgb, texture(A, vUv + vec2(0.0, max(0.0, -d) * 0.0)).rgb, showA);
      fragColor = vec4(c + tint * (edge * 2.5 + ember * 3.0), 1.0);
    }`,
};

/** Shatter: A as a pane of glass that cracks and flies apart in pieces toward the camera, over B. */
class Shatter {
  scene = new THREE.Scene();
  cam: THREE.PerspectiveCamera;
  mat: THREE.ShaderMaterial;
  back: FSPass;

  constructor() {
    // the pane fills the view at z = 0 for a camera at z = D
    const fov = 40, D = 1 / Math.tan(((fov / 2) * Math.PI) / 180);
    this.cam = new THREE.PerspectiveCamera(fov, W / H, 0.01, 50);
    this.cam.position.set(0, 0, D);
    const a = W / H, NX = 14, NY = 8;
    const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    const grid: [number, number][][] = [];
    for (let j = 0; j <= NY; j++) {
      grid.push([]);
      for (let i = 0; i <= NX; i++) {
        const edge = i === 0 || j === 0 || i === NX || j === NY;
        grid[j]!.push([(i + (edge ? 0 : (rnd() - 0.5) * 0.75)) / NX, (j + (edge ? 0 : (rnd() - 0.5) * 0.75)) / NY]);
      }
    }
    const pos: number[] = [], uv: number[] = [], ctr: number[] = [], rnds: number[] = [], bary: number[] = [];
    const tri = (p: [number, number][]) => {
      const cx = (p[0]![0] + p[1]![0] + p[2]![0]) / 3, cy = (p[0]![1] + p[1]![1] + p[2]![1]) / 3;
      const r = [rnd(), rnd(), rnd()];
      p.forEach(([u, v], k) => {
        pos.push((u * 2 - 1) * a, v * 2 - 1, 0);
        uv.push(u, v);
        ctr.push((cx * 2 - 1) * a, cy * 2 - 1);
        rnds.push(...r);
        bary.push(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0);
      });
    };
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const p00 = grid[j]![i]!, p10 = grid[j]![i + 1]!, p01 = grid[j + 1]![i]!, p11 = grid[j + 1]![i + 1]!;
        if (rnd() < 0.5) { tri([p00, p10, p11]); tri([p00, p11, p01]); } else { tri([p00, p10, p01]); tri([p10, p11, p01]); }
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('ctr', new THREE.Float32BufferAttribute(ctr, 2));
    g.setAttribute('rnd', new THREE.Float32BufferAttribute(rnds, 3));
    g.setAttribute('bary', new THREE.Float32BufferAttribute(bary, 3));
    this.mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { A: { value: null }, k: { value: 0 }, tint: { value: new THREE.Vector3(1, 1, 1) }, origin: { value: new THREE.Vector2(0, 0) } },
      vertexShader: /* glsl */ `
        attribute vec2 ctr; attribute vec3 rnd; attribute vec3 bary;
        uniform float k; uniform vec2 origin;
        varying vec2 vUv; varying vec3 vB; varying float vFace; varying float vDist;
        vec3 rotA(vec3 v, vec3 ax, float an) { ax = normalize(ax); float c = cos(an), s = sin(an); return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1.0 - c); }
        void main() {
          vUv = uv; vB = bary;
          // cracks spread from the origin, then each piece is knocked toward the camera and outward
          float dist = length(ctr - origin);
          vDist = dist;
          float go = clamp((k - 0.12 - dist * 0.08) / 0.75, 0.0, 1.0);
          float g = go * go;
          vec3 local = position - vec3(ctr, 0.0);
          vec3 axis = rnd - 0.5 + vec3(0.0, 0.0, 0.2);
          local = rotA(local, axis, g * (2.0 + 6.0 * rnd.x));
          vec2 out2 = normalize(ctr - origin + 1e-4) * (0.4 + 1.6 * rnd.y);
          vec3 p = vec3(ctr, 0.0) + local + vec3(out2 * g * 1.6, g * (1.2 + 2.2 * rnd.z)) + vec3(0.0, -g * g * 1.5, 0.0);
          vFace = normalize(rotA(vec3(0.0, 0.0, 1.0), axis, g * (2.0 + 6.0 * rnd.x))).z;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D A; uniform float k; uniform vec3 tint;
        varying vec2 vUv; varying vec3 vB; varying float vFace; varying float vDist;
        void main() {
          vec3 c = texture2D(A, vUv).rgb;
          float e = min(vB.x, min(vB.y, vB.z));
          // cracks run outward from the impact, brightest where they have just arrived
          float reach = (k - 0.02) * 9.0 - vDist;
          float crack = (1.0 - smoothstep(0.0, 0.014, e)) * smoothstep(0.0, 0.25, reach) * (0.12 + exp(-reach * 3.0)) * (1.0 - smoothstep(0.25, 0.5, k));
          float glint = pow(abs(vFace), 30.0) * smoothstep(0.15, 0.3, k) * 0.6;
          float fade = 1.0 - smoothstep(0.7, 1.0, k);
          gl_FragColor = vec4((c + tint * (crack * 0.9 + glint)) * fade, 1.0);
        }`,
    });
    const mesh = new THREE.Mesh(g, this.mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.back = new FSPass(`uniform sampler2D B; void main(){ fragColor = texture(B, vUv); }`, { B: { value: null } });
  }

  render(r: THREE.WebGLRenderer, a: THREE.Texture, b: THREE.Texture, k: number, tint: THREE.Vector3, origin: [number, number], out: THREE.WebGLRenderTarget) {
    this.back.u.B!.value = b;
    this.back.render(r, out);
    this.mat.uniforms.A!.value = a;
    this.mat.uniforms.k!.value = k;
    (this.mat.uniforms.tint!.value as THREE.Vector3).copy(tint);
    (this.mat.uniforms.origin!.value as THREE.Vector2).set((origin[0] * 2 - 1) * (W / H), origin[1] * 2 - 1);
    r.setRenderTarget(out);
    r.clearDepth();
    r.render(this.scene, this.cam);
  }
}

export class Transitions {
  private passes = new Map<string, FSPass>();
  private shatter: Shatter | null = null;

  private pass(kind: Exclude<TransitionKind, 'shatter'>) {
    let p = this.passes.get(kind);
    if (!p) {
      const src = (HEAD + FRAGS[kind]).replace(/W_PX/g, String(W.toFixed(1))).replace(/H_PX/g, String(H.toFixed(1)));
      p = new FSPass(src, {
        A: { value: null }, B: { value: null }, k: { value: 0 }, seed: { value: 0 },
        tint: { value: new THREE.Vector3(1, 1, 1) }, dirc: { value: new THREE.Vector2(0.5, 0.5) },
      });
      this.passes.set(kind, p);
    }
    return p;
  }

  /** Composite A → B at progress k (0..1) into `out`. */
  render(r: THREE.WebGLRenderer, spec: TransitionSpec, a: THREE.Texture, b: THREE.Texture, k: number, out: THREE.WebGLRenderTarget) {
    const c = spec.color ?? [1, 0.95, 0.9];
    if (spec.kind === 'shatter') {
      this.shatter ??= new Shatter();
      this.shatter.render(r, a, b, k, new THREE.Vector3(...c), spec.centre ?? [0.5, 0.5], out);
      return;
    }
    const p = this.pass(spec.kind);
    p.u.A!.value = a;
    p.u.B!.value = b;
    p.u.k!.value = Math.min(1, Math.max(0, k));
    p.u.seed!.value = spec.seed ?? 0;
    (p.u.tint!.value as THREE.Vector3).set(c[0], c[1], c[2]);
    const d = spec.kind === 'whip' ? spec.dir ?? [1, 0] : spec.centre ?? [0.5, 0.5];
    (p.u.dirc!.value as THREE.Vector2).set(d[0], d[1]);
    p.render(r, out);
  }
}
