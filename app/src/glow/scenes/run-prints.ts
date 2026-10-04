// Glowing handprints: where a glowing hand touches something (a wall, a railing, a bus shelter, the roof of a
// car) it leaves its print in light, which flares when it lands and then keeps glowing. All prints are known up
// front (a list of where and when), drawn in one instanced, additive draw; `time` reveals them.
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';

let tex: THREE.CanvasTexture | null = null;
/** A right hand's print, fingers up (+v), palm toward the viewer (soft-edged, white on black). */
function printTexture() {
  if (tex) return tex;
  const n = 256, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000';
  c.fillRect(0, 0, n, n);
  const draw = (blur: number, a: number, grow: number) => {
    c.save();
    c.filter = `blur(${blur}px)`;
    c.fillStyle = `rgba(255,255,255,${a})`;
    c.strokeStyle = `rgba(255,255,255,${a})`;
    c.lineCap = 'round';
    // palm
    c.beginPath();
    c.ellipse(128, 164, 46 + grow, 52 + grow, 0, 0, Math.PI * 2);
    c.fill();
    // fingers: base x, base y, angle, length, width
    const F: [number, number, number, number, number][] = [[94, 128, -0.2, 62, 20], [118, 116, -0.06, 76, 21], [142, 118, 0.06, 72, 20], [164, 130, 0.2, 56, 18], [80, 176, -1.05, 50, 22]];
    for (const [x, y, ang, len, w] of F) {
      c.lineWidth = w + grow * 2;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.sin(ang) * len, y - Math.cos(ang) * len);
      c.stroke();
    }
    c.restore();
  };
  draw(10, 0.5, 6);
  draw(2.5, 1, 0);
  // the skin's lines and the gaps of the fingers' joints: a little darker
  c.globalCompositeOperation = 'multiply';
  c.strokeStyle = 'rgba(150,150,150,1)';
  c.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[96, 150, 160, 158], [92, 172, 156, 190], [118, 132, 112, 196]]) {
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo((x0 + x1) / 2 + 6, (y0 + y1) / 2 - 8, x1, y1); c.stroke();
  }
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

export interface Print {
  /** Where (world), the surface's outward normal, and the direction the fingers point (along the surface). */
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  up: THREE.Vector3;
  /** When the hand touches. */
  t: number;
  color: THREE.Color;
  /** Hand length (m), default 0.19; left hands are mirrored. */
  size?: number;
  left?: boolean;
}

export class Handprints extends THREE.InstancedMesh {
  declare material: THREE.ShaderMaterial;
  list: Print[] = [];

  constructor(public cap = 600) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.setAttribute('aT', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
    g.setAttribute('aC', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { map: { value: printTexture() }, time: { value: 0 }, gain: { value: 1 }, fogD: { value: 0.02 } },
      vertexShader: /* glsl */ `
        attribute float aT; attribute vec3 aC;
        uniform float time, fogD;
        varying vec2 vUv; varying vec3 vC; varying float vAge;
        void main() {
          vUv = uv;
          float age = time - aT;
          vAge = age;
          // flare on touch, then a steady glow that breathes a little
          float k = age < 0.0 ? 0.0 : 0.75 + 4.0 * exp(-age * 5.0) + 0.12 * sin(time * 2.3 + aT * 7.0);
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          float d = -mv.z;
          vC = aC * k * exp(-fogD * fogD * d * d);
          gl_Position = age < 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform float gain;
        varying vec2 vUv; varying vec3 vC; varying float vAge;
        void main() {
          // the print grows into the surface as the hand presses (first 80 ms)
          vec2 uv = (vUv - 0.5) / mix(0.75, 1.0, clamp(vAge / 0.08, 0.0, 1.0)) + 0.5;
          float a = texture2D(map, uv).r * step(abs(uv.x - 0.5), 0.5) * step(abs(uv.y - 0.5), 0.5);
          gl_FragColor = vec4(vC * a * gain, 1.0);
        }`,
    });
    super(g, m, cap);
    this.count = 0;
    this.frustumCulled = false;
    this.renderOrder = 2;
  }

  add(p: Print) {
    if (this.list.length >= this.cap) return;
    this.list.push(p);
  }

  /** Scatter prints over time [t0, t1] along a wall: base point a → b, normal n, heights h0..h1. */
  scatter(n: number, a: THREE.Vector3, b: THREE.Vector3, normal: THREE.Vector3, t0: number, t1: number, colors: THREE.Color[], seed = 1, h0 = 0.9, h1 = 1.7) {
    const r = mulberry32(seed);
    for (let i = 0; i < n; i++) {
      const u = r();
      const pos = a.clone().lerp(b, u);
      pos.y += h0 + r() * (h1 - h0);
      const up = new THREE.Vector3(0, 1, 0).applyAxisAngle(normal, (r() - 0.5) * 0.9);
      this.add({ pos, normal: normal.clone(), up, t: t0 + (t1 - t0) * u + (r() - 0.5) * 0.3, color: colors[Math.floor(r() * colors.length)]!, size: 0.17 + r() * 0.05, left: r() < 0.5 });
    }
  }

  /** Upload the list (after all `add`s). */
  build() {
    const m = new THREE.Matrix4(), q = new THREE.Matrix4(), x = new THREE.Vector3(), y = new THREE.Vector3(), z = new THREE.Vector3();
    const aT = this.geometry.getAttribute('aT') as THREE.InstancedBufferAttribute;
    const aC = this.geometry.getAttribute('aC') as THREE.InstancedBufferAttribute;
    this.list.forEach((p, i) => {
      z.copy(p.normal).normalize();
      y.copy(p.up).addScaledVector(z, -p.up.dot(z)).normalize();
      x.crossVectors(y, z);
      const s = p.size ?? 0.19;
      q.makeBasis(x.multiplyScalar(p.left ? -s : s), y.multiplyScalar(s), z);
      m.copy(q).setPosition(p.pos.x + z.x * 0.006, p.pos.y + z.y * 0.006, p.pos.z + z.z * 0.006);
      this.setMatrixAt(i, m);
      aT.setX(i, p.t);
      aC.setXYZ(i, p.color.r, p.color.g, p.color.b);
    });
    this.count = this.list.length;
    this.instanceMatrix.needsUpdate = true;
    aT.needsUpdate = aC.needsUpdate = true;
  }

  set time(t: number) { this.material.uniforms.time!.value = t; }
}
