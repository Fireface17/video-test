// Streaking stars for the bridge (`fall`): soft additive points drawn as short screen-space capsules from
// where each star was `tau` seconds ago to where it is now, so a star field rushing past reads as speed even
// in a single frame (far stars stay dots, near ones become streaks). Positions are written from the CPU each
// frame (pure functions of t); depth-tested against the figures, no depth writes.
import * as THREE from 'three';
import { PH, PW, SCALE } from '../../engine/gl';

export class StarStreaks extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  declare geometry: THREE.InstancedBufferGeometry;
  pos: Float32Array;
  col: Float32Array;
  siz: Float32Array;
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aSiz: THREE.InstancedBufferAttribute;

  /**
   * `size` is the world diameter at distance 1 (as GlowPoints); `vel` (uniform) is the stars' velocity in
   * the camera's frame of motion and `tau` the streak's exposure (s).
   */
  constructor(public n: number, size = 0.03, opts: { fade?: number; maxPx?: number } = {}) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n);
    const aPos = new THREE.InstancedBufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    const aCol = new THREE.InstancedBufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
    const aSiz = new THREE.InstancedBufferAttribute(siz, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', aPos);
    geo.setAttribute('iCol', aCol);
    geo.setAttribute('iSiz', aSiz);
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        vel: { value: new THREE.Vector3() },
        tau: { value: 1 / 40 },
        size: { value: size },
        pxScale: { value: (1080 * SCALE) / 2 },
        res: { value: new THREE.Vector2(PW, PH) },
        fade: { value: opts.fade ?? 0 },
        maxPx: { value: (opts.maxPx ?? 26) * SCALE },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec3 iCol; attribute float iSiz;
        uniform vec3 vel; uniform float tau, size, pxScale, fade, maxPx; uniform vec2 res;
        varying vec3 vC; varying vec2 vL; varying float vLen; varying float vHW;
        void main() {
          vec4 mh = modelViewMatrix * vec4(iPos, 1.0);
          vec4 mt = modelViewMatrix * vec4(iPos - vel * tau, 1.0);
          if (mh.z > -0.08 || iSiz <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec3(0.0); return; }
          if (mt.z > -0.08) mt = mix(mh, mt, (mh.z + 0.08) / (mh.z - mt.z));
          vec4 ch = projectionMatrix * mh, ct = projectionMatrix * mt;
          vec2 h = ch.xy / ch.w * 0.5 * res, tl = ct.xy / ct.w * 0.5 * res;
          float d = -mh.z;
          float px = size * iSiz * projectionMatrix[1][1] * pxScale / d;
          float hw = clamp(px * 0.5, 0.75, maxPx);
          vec2 dv = h - tl; float len = length(dv);
          vec2 dir = len > 1e-3 ? dv / len : vec2(1.0, 0.0);
          vec2 nrm = vec2(-dir.y, dir.x);
          float along = mix(-hw, len + hw, position.x);
          vec2 p = tl + dir * along + nrm * position.y * hw;
          float z = mix(ct.z / ct.w, ch.z / ch.w, position.x);
          gl_Position = vec4(p / (0.5 * res), z, 1.0);
          vL = vec2(along, position.y * hw); vLen = len; vHW = hw;
          float f = exp(-fade * fade * d * d);
          // tiny stars keep a minimum footprint and lose brightness instead; a streak spreads the light
          vC = iCol * f * min(1.0, (px * px) / (4.0 * hw * hw)) * (2.2 * hw / (2.2 * hw + len * 0.5));
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying vec2 vL; varying float vLen; varying float vHW;
        void main() {
          float x = clamp(vL.x, 0.0, vLen);
          float r = length(vec2(vL.x - x, vL.y)) / vHW;
          if (r > 1.0) discard;
          float head = vLen > 0.5 ? mix(0.25, 1.0, x / vLen) : 1.0;
          float a = (exp(-r * r * 4.0) + 0.6 * exp(-r * r * 24.0)) * head;
          gl_FragColor = vec4(vC * a, 1.0);
        }`,
    });
    super(geo, mat);
    this.pos = pos;
    this.col = col;
    this.siz = siz;
    this.aPos = aPos;
    this.aCol = aCol;
    this.aSiz = aSiz;
    this.frustumCulled = false;
  }

  set(i: number, x: number, y: number, z: number, c: THREE.Color, k = 1, size = 1) {
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 3] = c.r * k; this.col[i * 3 + 1] = c.g * k; this.col[i * 3 + 2] = c.b * k;
    this.siz[i] = size;
  }

  hide(i: number) { this.siz[i] = 0; }

  setMotion(vel: THREE.Vector3, tau: number) {
    (this.material.uniforms.vel!.value as THREE.Vector3).copy(vel);
    this.material.uniforms.tau!.value = tau;
  }

  commit() { this.aPos.needsUpdate = this.aCol.needsUpdate = this.aSiz.needsUpdate = true; }
}
