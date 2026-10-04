// Soft fog for the `snap` scene: a few large drifting sheets of noise that only show where light reaches
// them (the light-painting pen, the room's haze), so the dark stays dark but has depth.
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';
import type { LightU } from './snap-stick';

/** Tileable value-noise fbm in a canvas texture (deterministic). */
function noiseTexture(n = 256, seed = 9): THREE.Texture {
  const rnd = mulberry32(seed);
  const grids = [8, 16, 32, 64].map((g) => ({ g, v: Array.from({ length: g * g }, () => rnd()) }));
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d')!, img = c.createImageData(n, n);
  const sm = (x: number) => x * x * (3 - 2 * x);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 0, a = 0.5, s = 0;
      for (const { g, v: gv } of grids) {
        const fx = (x / n) * g, fy = (y / n) * g;
        const ix = Math.floor(fx), iy = Math.floor(fy), tx = sm(fx - ix), ty = sm(fy - iy);
        const at = (i: number, j: number) => gv[((j % g) + g) % g * g + (((i % g) + g) % g)]!;
        const top = at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx, bot = at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx;
        v += a * (top * (1 - ty) + bot * ty);
        s += a;
        a *= 0.5;
      }
      const q = Math.max(0, Math.min(255, Math.round(Math.pow(v / s, 2.2) * 255 * 1.6)));
      const k = (y * n + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = q;
      img.data[k + 3] = 255;
    }
  c.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

const VERT = /* glsl */ `
varying vec2 vUv; varying vec3 vWP;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform sampler2D tex; uniform vec2 drift; uniform float scale, base, gain, fillK;
uniform vec3 uLightPos; uniform vec3 uLightCol; uniform vec3 uFillPos; uniform vec3 uFillCol; uniform vec3 uRimCol;
varying vec2 vUv; varying vec3 vWP;
void main() {
  vec2 p = vWP.xy * scale;
  float n = texture2D(tex, p + drift).r * texture2D(tex, p * 0.43 - drift * 0.6 + 0.37).r * 1.6;
  vec2 e = abs(vUv - 0.5) * 2.0;
  float edge = (1.0 - smoothstep(0.55, 1.0, e.x)) * (1.0 - smoothstep(0.5, 1.0, e.y));
  vec3 L = uLightPos - vWP; float a1 = 0.06 / (0.06 + dot(L, L));
  vec3 F = uFillPos - vWP; float a2 = 0.2 / (0.2 + dot(F, F));
  vec3 c = (uLightCol * a1 * 0.5 + uFillCol * a2 * fillK + uRimCol * base) * n * edge * gain;
  gl_FragColor = vec4(c, 1.0);
}`;

/** Fog sheets facing +z at the given depths (world), additive. Call `update(t, center)` each frame. */
export class FogSheets extends THREE.Group {
  mats: THREE.ShaderMaterial[] = [];
  constructor(light: LightU, o: { depths: number[]; size: [number, number]; scale?: number; base?: number; gain?: number; fill?: number }) {
    super();
    const tex = noiseTexture();
    o.depths.forEach((z, i) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          ...light, tex: { value: tex }, drift: { value: new THREE.Vector2() }, scale: { value: (o.scale ?? 1.2) * (1 + i * 0.3) },
          base: { value: o.base ?? 0.6 }, gain: { value: o.gain ?? 1 }, fillK: { value: o.fill ?? 0.6 },
        } as unknown as Record<string, THREE.IUniform>,
        vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(o.size[0] * (1 + i * 0.4), o.size[1] * (1 + i * 0.4)), mat);
      m.position.z = z;
      m.renderOrder = 1;
      m.frustumCulled = false;
      this.add(m);
      this.mats.push(mat);
    });
  }

  /** Drift with time; the sheets follow `center` in x/y (keeps them in view as the camera travels). */
  update(t: number, center: THREE.Vector3) {
    this.children.forEach((m, i) => {
      m.position.x = center.x;
      m.position.y = center.y;
      (this.mats[i]!.uniforms.drift!.value as THREE.Vector2).set(t * (0.012 + i * 0.004), t * (0.006 - i * 0.002));
    });
  }
}
