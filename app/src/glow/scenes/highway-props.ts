// Highway scene, props for line 3 ("Now the sun's coming up where it sank"): the words born from the rising
// sun, flying out along a great arc over it (Tilt Neon, warm white), and the car interior around the rear-view
// mirror in which the dawn first appears.
import * as THREE from 'three';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, prog } from '../../engine/util';
import { displayTextGeometry, loadDisplayFont } from '../lib/fonts';
import { glowMat } from './highway-common';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const DEG = Math.PI / 180;

/**
 * The line as words on an arc around the sun. The group sits at `dist` in the direction of the sun's rise
 * point (on the horizon), facing the camera; word i is born at the sun when sung and flies out to its slot.
 */
export class SunArc extends THREE.Group {
  words: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; slot: number; w: number }[] = [];
  halo: THREE.Mesh;
  R = 235;
  constructor(public line: Line) { super(); this.halo = new THREE.Mesh(); }

  async build() {
    const font = await loadDisplayFont('tiltneon');
    const size = 50;
    const geos = this.line.words.map((w) => displayTextGeometry(font, w.w.toUpperCase(), size, { tracking: 0.02 }));
    const widths = geos.map((g) => g.boundingBox!.max.x - g.boundingBox!.min.x);
    const gap = size * 0.55;
    const total = widths.reduce((a, b) => a + b, 0) + gap * (widths.length - 1);
    this.R = total / (150 * DEG);
    const R = this.R;
    const span = total / R; // radians of arc used
    let acc = 0;
    geos.forEach((g, i) => {
      const mid = acc + widths[i]! / 2;
      acc += widths[i]! + gap;
      const slot = Math.PI / 2 + span / 2 - mid / R; // left (larger angle) to right
      const mat = new THREE.MeshBasicMaterial({ color: C('#fff3e0', 0), transparent: true, depthWrite: false, fog: false });
      const mesh = new THREE.Mesh(g, mat);
      this.add(mesh);
      this.words.push({ mesh, mat, slot, w: widths[i]! });
    });
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat(C('#ffb35a', 1), { soft: 3.5 }));
    this.add(this.halo);
  }

  /**
   * Pose at time t. `center` = world position of the arc centre, `cam` faces it; `rise` 0..1 global lift;
   * `k` overall brightness.
   */
  update(t: number, center: THREE.Vector3, cam: THREE.Camera, k: number, mirror = false, size = 1) {
    this.position.copy(center);
    this.quaternion.copy(cam.quaternion);
    this.scale.set(mirror ? -size : size, size, size);
    const R = this.R;
    this.words.forEach((w, i) => {
      const s = this.line.words[i]!.start;
      const p = prog(t, s, s + 0.7, ease.outExpo);
      const born = t >= s ? 1 : 0;
      // born just above the sun, flies out along its ray to the slot on the arc
      const r = R * (0.22 + 0.78 * p);
      const a = w.slot + (1 - p) * (w.slot > Math.PI / 2 ? 0.25 : -0.25);
      w.mesh.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      w.mesh.rotation.z = a - Math.PI / 2;
      w.mesh.scale.setScalar(0.35 + 0.65 * p);
      const flash = Math.exp(-Math.max(0, t - s) / 0.18);
      w.mat.color.copy(C('#fff1dc', born * k * (1.25 + 2.5 * flash)));
      w.mat.opacity = born;
    });
    this.halo.scale.setScalar(R * 0.9);
    (this.halo.material as THREE.ShaderMaterial).uniforms.color!.value.copy(C('#ff9a40', 0.0));
  }
}

/**
 * The car around the driver's eye for the mirror shot: windscreen header and A-pillars, the dash top, and
 * the rear-view mirror whose glass shows `mirrorTex` (the view behind, flipped like a real mirror).
 * Built in camera space: parent it to the camera.
 */
export class Interior extends THREE.Group {
  glassU: Record<string, THREE.IUniform>;
  mirror: THREE.Group;
  constructor(mirrorTex: THREE.Texture) {
    super();
    const plastic = (c: string, k = 1) => new THREE.MeshBasicMaterial({ color: C(c, k) });
    // header (roof lining) across the top, the two A-pillars, the dash top (camera space: -z forward)
    const header = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.5), plastic('#08090c'));
    header.position.set(0, 0.46, -0.62);
    header.rotation.x = 0.35;
    const pillarG = new THREE.PlaneGeometry(0.16, 1.4);
    const pl = new THREE.Mesh(pillarG, plastic('#040506')); pl.position.set(-0.43, -0.05, -0.55); pl.rotation.set(0, 0.5, -0.38);
    const pr = new THREE.Mesh(pillarG, plastic('#040506')); pr.position.set(0.62, -0.05, -0.62); pr.rotation.set(0, -0.5, 0.34);
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.3), plastic('#030304'));
    dash.position.set(0, -0.36, -0.62); dash.rotation.x = -1.2;
    this.add(header, pl, pr, dash);
    // the mirror: housing, stem, glass
    this.mirror = new THREE.Group();
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.285, 0.088, 0.05, 4, 0.03), plastic('#0a0a0c'));
    housing.position.z = -0.022;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.09, 8), plastic('#0a0a0c'));
    stem.position.set(0, 0.06, -0.01);
    this.glassU = { tex: { value: mirrorTex }, k: { value: 1 }, sweep: { value: 0 } };
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.255, 0.068), new THREE.ShaderMaterial({
      uniforms: this.glassU,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform sampler2D tex; uniform float k, sweep; varying vec2 vUv;
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          // rounded-rectangle glass with a thin bright bevel
          vec2 q = abs(p) - vec2(0.9, 0.62);
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.34;
          if (d > 0.0) discard;
          vec2 uv = vec2(1.0 - vUv.x, vUv.y);
          uv = (uv - 0.5) * vec2(0.92, 0.9) + 0.5;
          vec3 c = texture2D(tex, uv).rgb * 0.82 * k;
          float bev = smoothstep(-0.06, 0.0, d);
          c += vec3(0.25, 0.27, 0.3) * bev * (0.15 + 0.5 * exp(-pow(p.x - (sweep * 3.0 - 1.5), 2.0) * 6.0));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    glass.position.z = 0.0045;
    this.mirror.add(housing, stem, glass);
    this.mirror.position.set(0.065, 0.062, -0.43);
    this.mirror.rotation.set(0.05, -0.16, 0.015);
    this.add(this.mirror);
  }
}

/** Arc lift helper for the sun: elevation (radians) of the sun's centre over the shot. */
export function sunElevation(t: number, tSun: number, tUp: number, tEnd: number) {
  if (t < tSun) return -1.6 * DEG + 0.5 * DEG * prog(t, tSun - 1.2, tSun, ease.inOutQuad);
  const a = -1.1 * DEG + 1.6 * DEG * prog(t, tSun, tUp, ease.inOutCubic);
  return a + 2.2 * DEG * clamp((t - tUp) / Math.max(0.1, tEnd - tUp));
}
