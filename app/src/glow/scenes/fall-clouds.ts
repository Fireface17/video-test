// Soft cloud / nebula puffs for the bridge (`fall`): camera-facing billboards over a baked noise atlas, sorted back
// to front every frame and blended "over" (premultiplied). Each puff is shaded as a soft sphere (a normal
// from the billboard coordinate), lit by a dim sky from above, a warm sun from below (the golden finale) and
// up to three point glows (the figures and their joined hands). Near the glows the puffs lose opacity but
// keep the light, so a figure inside a cloud reads as a lantern in fog instead of being sliced by the planes.
import * as THREE from 'three';
import { clamp, fbm2, smoothstep } from '../../engine/util';

/**
 * 2x2 atlas of soft puffs (density in the red channel), zero at every cell edge: 'cloud' is billowy
 * cumulus, 'nebula' is smooth gas with a domain-warped, wispy body.
 */
export function puffAtlas(n = 128, style: 'cloud' | 'nebula' = 'cloud'): THREE.Texture {
  const N = n * 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d')!, img = c.createImageData(N, N);
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * n, oy = Math.floor(cell / 2) * n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const u = ((x + 0.5) / n) * 2 - 1, v = ((y + 0.5) / n) * 2 - 1;
        const r = Math.hypot(u, v);
        let d: number;
        if (style === 'cloud') {
          const lump = fbm2(u * 1.6 + cell * 7.3, v * 1.6 - cell * 3.1, 4, 11 + cell);
          d = 1 - smoothstep(0.2, 0.92, r + 0.36 * lump);
          d *= 0.7 + 0.3 * (fbm2(u * 4.5 + 9, v * 4.5 - cell, 3, 40 + cell) * 0.5 + 0.5);
        } else {
          const wx = fbm2(u * 1.1 + cell * 5.1, v * 1.1 - cell * 2.3, 3, 21 + cell), wy = fbm2(u * 1.1 - 4.7, v * 1.1 + cell * 1.9, 3, 31 + cell);
          const rr = Math.hypot(u + 0.35 * wx, v + 0.35 * wy);
          d = Math.pow(1 - smoothstep(0.0, 0.92, rr), 1.7);
          const wisp = fbm2((u + wx) * 2.6, (v + wy) * 2.6, 4, 50 + cell) * 0.5 + 0.5;
          d *= 0.45 + 0.75 * wisp * wisp;
        }
        d *= 1 - smoothstep(0.8, 0.99, r);
        const k = Math.round(clamp(d) * 255);
        const o = ((oy + y) * N + ox + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = k;
        img.data[o + 3] = 255;
      }
  }
  c.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

export interface PuffSpec {
  x: number; y: number; z: number;
  size: number; rot: number;
  /** Base emission colour (linear) and opacity. */
  color: THREE.Color; alpha: number;
  cell: number;
  /** Free tag for the scene (which layer the puff belongs to). */
  group: number;
  seed: number;
}

export interface PuffLook { r: number; g: number; b: number; a: number }

export class CloudPuffs extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  declare geometry: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aSR: THREE.InstancedBufferAttribute;
  private order: number[] = [];
  private depth: Float32Array;
  private look: PuffLook[];

  constructor(public specs: PuffSpec[], map: THREE.Texture) {
    const n = specs.length;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const aPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const aCol = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const aSR = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', aPos);
    geo.setAttribute('iCol', aCol);
    geo.setAttribute('iSR', aSR);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        map: { value: map },
        camRight: { value: new THREE.Vector3(1, 0, 0) },
        camUp: { value: new THREE.Vector3(0, 1, 0) },
        camBack: { value: new THREE.Vector3(0, 0, 1) },
        fogCol: { value: new THREE.Color(0, 0, 0) },
        fogDen: { value: 0.03 },
        fogAlpha: { value: 0 },
        nearFade: { value: new THREE.Vector2(0.6, 3.2) },
        sky: { value: new THREE.Color(0, 0, 0) },
        sun: { value: new THREE.Color(0, 0, 0) },
        sunDir: { value: new THREE.Vector3(0, -1, 0) },
        lp: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
        lc: { value: [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)] },
        lr: { value: [1, 1, 1] },
        clearR: { value: 1.2 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iSR;
        uniform vec3 camRight, camUp;
        varying vec2 vUv; varying vec2 vQ; varying vec4 vCol; varying vec3 vW; varying float vDepth;
        void main() {
          float c = cos(iSR.y), s = sin(iSR.y);
          vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
          vQ = q * 2.0;
          vec3 w = iPos + (camRight * q.x + camUp * q.y) * iSR.x;
          vW = w;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
          float cell = iSR.z;
          vUv = (uv + vec2(mod(cell, 2.0), floor(cell / 2.0))) * 0.5;
          vCol = iCol;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform vec3 camRight, camUp, camBack;
        uniform vec3 fogCol, sky, sun, sunDir; uniform float fogDen, fogAlpha; uniform vec2 nearFade;
        uniform vec3 lp[3]; uniform vec3 lc[3]; uniform float lr[3]; uniform float clearR;
        varying vec2 vUv; varying vec2 vQ; varying vec4 vCol; varying vec3 vW; varying float vDepth;
        void main() {
          float d = texture2D(map, vUv).r;
          float a = d * vCol.a * smoothstep(nearFade.x, nearFade.y, vDepth);
          if (a < 0.002) discard;
          // soft-sphere normal from the billboard coordinate
          vec2 q = vQ * 1.15;
          vec3 n = normalize(camRight * q.x + camUp * q.y + camBack * sqrt(max(0.0, 1.0 - dot(q, q))));
          float up = n.y;
          vec3 light = sky * (0.55 + 0.45 * up) + sun * pow(clamp(0.5 + 0.5 * dot(n, sunDir), 0.0, 1.0), 1.5) * (1.4 - d);
          float clear = 1.0;
          for (int i = 0; i < 3; i++) {
            vec3 dv = lp[i] - vW;
            float r2 = dot(dv, dv);
            float q2 = r2 / (lr[i] * lr[i]);
            float wrap = 0.35 + 0.65 * max(dot(n, dv * inversesqrt(max(r2, 1e-4))), 0.0);
            light += lc[i] * wrap / ((1.0 + q2) * (1.0 + q2));
            if (dot(lc[i], vec3(1.0)) > 0.0) clear = min(clear, smoothstep(0.25, clearR, sqrt(r2)));
          }
          vec3 c = vCol.rgb * (0.55 + 0.45 * d) + light * (0.45 + 0.55 * d);
          float f = 1.0 - exp(-fogDen * fogDen * vDepth * vDepth);
          c = mix(c, fogCol, f);
          a *= 1.0 - f * fogAlpha;
          gl_FragColor = vec4(c * a, a * mix(0.3, 1.0, clear));
        }`,
    });
    super(geo, mat);
    this.aPos = aPos;
    this.aCol = aCol;
    this.aSR = aSR;
    this.depth = new Float32Array(n);
    this.look = specs.map(() => ({ r: 0, g: 0, b: 0, a: 0 }));
    this.frustumCulled = false;
  }

  /**
   * Pose for this frame: every puff is moved by `off` (the travel so far), `shade` sets its colour and
   * opacity (a <= 0 skips it), then the visible ones are sorted back to front and uploaded.
   */
  update(cam: THREE.PerspectiveCamera, off: THREE.Vector3, shade: (s: PuffSpec, p: THREE.Vector3, out: PuffLook) => void, maxDepth = 140) {
    cam.updateMatrixWorld();
    const fw = new THREE.Vector3();
    cam.getWorldDirection(fw);
    const cp = cam.position;
    // cull to the view cone (with the puff's radius as margin)
    const tanH = Math.tan((cam.fov / 2) * Math.PI / 180), tanW = tanH * cam.aspect;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const order = this.order;
    order.length = 0;
    const p = new THREE.Vector3();
    this.specs.forEach((s, i) => {
      p.set(s.x + off.x, s.y + off.y, s.z + off.z);
      const dx = p.x - cp.x, dy = p.y - cp.y, dz = p.z - cp.z;
      const dep = dx * fw.x + dy * fw.y + dz * fw.z;
      const rad = s.size * 0.5;
      if (dep < -rad || dep > maxDepth) return;
      const sx = Math.abs(dx * right.x + dy * right.y + dz * right.z), sy = Math.abs(dx * upv.x + dy * upv.y + dz * upv.z);
      const md = Math.max(dep, 0);
      if (sx > md * tanW + rad * 1.5 || sy > md * tanH + rad * 1.5) return;
      const lk = this.look[i]!;
      shade(s, p, lk);
      if (lk.a <= 0.002) return;
      this.depth[i] = dep;
      order.push(i);
    });
    order.sort((a, b) => this.depth[b]! - this.depth[a]!);
    const P = this.aPos.array as Float32Array, C = this.aCol.array as Float32Array, S = this.aSR.array as Float32Array;
    order.forEach((i, k) => {
      const s = this.specs[i]!, lk = this.look[i]!;
      P[k * 3] = s.x + off.x; P[k * 3 + 1] = s.y + off.y; P[k * 3 + 2] = s.z + off.z;
      C[k * 4] = lk.r; C[k * 4 + 1] = lk.g; C[k * 4 + 2] = lk.b; C[k * 4 + 3] = lk.a;
      S[k * 3] = s.size; S[k * 3 + 1] = s.rot; S[k * 3 + 2] = s.cell;
    });
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSR.needsUpdate = true;
    this.geometry.instanceCount = order.length;
    const u = this.material.uniforms;
    (u.camRight!.value as THREE.Vector3).copy(right);
    (u.camUp!.value as THREE.Vector3).copy(upv);
    (u.camBack!.value as THREE.Vector3).copy(fw).negate();
    return order.length;
  }

  /** Point glow `i` (0..2): world position, colour (linear, 0 = off) and radius. */
  setLight(i: number, p: THREE.Vector3, c: THREE.Color, r: number) {
    const u = this.material.uniforms;
    (u.lp!.value as THREE.Vector3[])[i]!.copy(p);
    (u.lc!.value as THREE.Color[])[i]!.copy(c);
    (u.lr!.value as number[])[i] = r;
  }

  /** Dim light from above and a directional "sun" (toward `sunDir`), linear colours. */
  setAmbient(sky: THREE.Color, sun: THREE.Color, sunDir?: THREE.Vector3) {
    (this.material.uniforms.sky!.value as THREE.Color).copy(sky);
    (this.material.uniforms.sun!.value as THREE.Color).copy(sun);
    if (sunDir) (this.material.uniforms.sunDir!.value as THREE.Vector3).copy(sunDir).normalize();
  }

  /** Distance haze; `alphaFade` 1 also thins the puffs with distance (space: far gas fades out, no wall). */
  setFog(c: THREE.Color, density: number, alphaFade = 0) {
    (this.material.uniforms.fogCol!.value as THREE.Color).copy(c);
    this.material.uniforms.fogDen!.value = density;
    this.material.uniforms.fogAlpha!.value = alphaFade;
  }
}
