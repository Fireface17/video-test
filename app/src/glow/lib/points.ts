// Glowing points (sparks, star fields, dust): additive soft discs with per-point colour and size,
// positions written from the CPU each frame (deterministic functions of t).
import * as THREE from 'three';
import { SCALE } from '../../engine/gl';

export class GlowPoints extends THREE.Points {
  pos: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  declare material: THREE.ShaderMaterial;

  /** `size` is in world units at distance 1 (perspective-attenuated); per-point sizes multiply it. */
  constructor(public n: number, size = 0.05, opts: { fogDensity?: number; fogColor?: THREE.Color } = {}) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3), colors = new Float32Array(n * 3), sizes = new Float32Array(n).fill(1);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('psize', new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        size: { value: size },
        pxScale: { value: (1080 * SCALE) / 2 },
        fogDensity: { value: opts.fogDensity ?? 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 color; attribute float psize;
        uniform float size, pxScale, fogDensity;
        varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float d = -mv.z;
          float fog = exp(-fogDensity * fogDensity * d * d);
          vC = color * fog;
          // projected size in px; tiny points keep a minimum footprint and lose brightness instead
          float px = size * psize * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
          float m = max(px, 1.5);
          vC *= min(1.0, (px * px) / (m * m)) ;
          gl_PointSize = m;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          float a = exp(-r2 * 4.0) + 0.6 * exp(-r2 * 24.0);
          gl_FragColor = vec4(vC * a, 1.0);
        }`,
    });
    super(geo, mat);
    this.pos = pos;
    this.colors = colors;
    this.sizes = sizes;
    this.frustumCulled = false;
  }

  set(i: number, x: number, y: number, z: number, c: THREE.Color | [number, number, number], k = 1, size = 1) {
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    const r = Array.isArray(c) ? c[0] : c.r, g = Array.isArray(c) ? c[1] : c.g, b = Array.isArray(c) ? c[2] : c.b;
    this.colors[i * 3] = r * k; this.colors[i * 3 + 1] = g * k; this.colors[i * 3 + 2] = b * k;
    this.sizes[i] = size;
  }

  hide(i: number) { this.colors[i * 3] = this.colors[i * 3 + 1] = this.colors[i * 3 + 2] = 0; this.sizes[i] = 0; }

  /** Upload after a frame's set() calls. */
  commit(n = this.n) {
    const g = this.geometry;
    for (const k of ['position', 'color', 'psize']) (g.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, n);
  }
}
