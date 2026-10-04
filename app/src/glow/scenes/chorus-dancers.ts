// The chorus floor's life: dancers made of light (glowing silhouettes with bright rims) moving on the beat,
// and stage-light beams sweeping through the haze.
import * as THREE from 'three';
import { figureGeometry } from '../lib/shapes';
import { hash } from '../../engine/util';

/** Luminous body: dim core, bright fresnel rim, per-instance colour (instanceColor). */
export function lightBodyMaterial(gain = 1) {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { gain: { value: gain } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vV = normalize(-mvPosition.xyz);
        vC = instanceColor;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float gain;
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN + vec3(0.0, 0.0, 1e-5)), normalize(vV)));
        vec3 c = vC * gain * (0.12 + 1.6 * pow(f, 2.2) + 2.5 * pow(f, 8.0));
        gl_FragColor = vec4(c, 1.0);
        #include <fog_fragment>
      }`,
  });
}

export class Dancers extends THREE.Group {
  poses: THREE.InstancedMesh[] = [];
  spots: { x: number; z: number; ry: number; c: THREE.Color; s: number; style: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  constructor(spots: { x: number; z: number }[], colors: THREE.Color[]) {
    super();
    const mat = lightBodyMaterial(1);
    for (const a of [0.08, 0.55, 1]) {
      const im = new THREE.InstancedMesh(figureGeometry(a), mat, spots.length);
      im.frustumCulled = false;
      this.poses.push(im);
      this.add(im);
    }
    spots.forEach((p, i) => this.spots.push({ ...p, ry: (hash(i, 1) - 0.5) * 1.6, c: colors[i % colors.length]!.clone(), s: 0.95 + hash(i, 2) * 0.15, style: Math.floor(hash(i, 3) * 3) }));
  }

  /** Dance at beat position `beat` (continuous); `energy` 0..1 scales the moves and the light. */
  pose(beat: number, energy = 1, gain = 1) {
    const b = Math.floor(beat), ph = beat - b;
    this.spots.forEach((p, i) => {
      // style 0: arms up on every other beat; 1: pump on each beat; 2: wave (arms up, sway)
      const pose = p.style === 2 ? 2 : p.style === 1 ? (ph < 0.5 ? 1 : 0) : ((b + i) % 2 ? 2 : 0);
      const bounce = Math.abs(Math.sin((beat + hash(i, 4) * 0.2) * Math.PI)) * 0.18 * energy;
      const jump = (b % 4 === 0 && hash(i, b) > 0.6 ? Math.sin(ph * Math.PI) * 0.5 : 0) * energy;
      const sway = Math.sin(beat * Math.PI * 0.5 + i) * 0.25 * (p.style === 2 ? 1 : 0.4);
      this.q.setFromEuler(new THREE.Euler(0, p.ry + sway, sway * 0.25));
      this.poses.forEach((im, k) => {
        const s = k === pose ? p.s : 1e-4;
        this.m.compose(new THREE.Vector3(p.x, bounce + jump, p.z), this.q, new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, this.m);
        im.setColorAt(i, p.c.clone().multiplyScalar(gain * (0.8 + 0.4 * energy)));
      });
    });
    for (const im of this.poses) { im.instanceMatrix.needsUpdate = true; im.instanceColor!.needsUpdate = true; }
  }
}

/** Stage-light beams: soft additive cones from above that sweep on the beat. */
export class Beams extends THREE.Group {
  cones: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; x: number; z: number; ph: number }[] = [];

  constructor(n: number, colors: THREE.Color[], height = 14) {
    super();
    const geo = new THREE.ConeGeometry(1.6, height, 32, 1, true);
    geo.translate(0, -height / 2, 0); // apex at the origin, opening downward
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { color: { value: colors[i % colors.length]!.clone() }, k: { value: 1 }, H: { value: height } },
        vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
          void main(){ vY = -position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform vec3 color; uniform float k, H; varying float vY; varying vec3 vN; varying vec3 vV;
          void main(){ float along = clamp(vY / H, 0.0, 1.0);
            float soft = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
            gl_FragColor = vec4(color * k * soft * (1.0 - along) * (0.25 + 0.75 * smoothstep(0.0, 0.08, along)) * 0.22, 1.0); }`,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      const x = (i / Math.max(1, n - 1) - 0.5) * 16;
      this.cones.push({ mesh, mat, x, z: -4 - (i % 2) * 2, ph: i * 1.3 });
      this.add(mesh);
    }
  }

  pose(beat: number, energy = 1, top = 12) {
    for (const c of this.cones) {
      const a = Math.sin(beat * Math.PI * 0.25 + c.ph) * 0.55, b = Math.cos(beat * Math.PI * 0.125 + c.ph) * 0.35;
      c.mesh.position.set(c.x, top, c.z);
      c.mesh.rotation.set(b, 0, a);
      c.mat.uniforms.k!.value = energy * (0.6 + 0.4 * Math.abs(Math.sin((beat + c.ph) * Math.PI * 0.5)));
    }
  }
}
