// Highway scene, the bonnet of our car seen through the windscreen in the interior shots (highway-cabin.ts).
import * as THREE from 'three';
import { HU, HW_GLSL } from './highway-common';
import { SKY_GLSL, type SkyU } from './highway-env';

/**
 * The bonnet of our car at the bottom of the POV frame: dark blue-black paint under a clearcoat that
 * mirrors the sky and slides the streetlights over itself. Car space: x right, -z forward, the driver's eye
 * at the origin.
 */
export class Hood extends THREE.Mesh {
  constructor(skyU: SkyU) {
    const g = new THREE.PlaneGeometry(1.95, 1.8, 24, 16);
    g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i); // z in [-0.9, 0.9]
      const f = (z + 0.9) / 1.8; // 0 at the windscreen, 1 at the nose (z grows toward the camera here)
      const crown = -0.07 * Math.pow(x / 0.97, 2);
      const fall = -0.2 * Math.pow(1 - f, 1.6);
      const edge = -0.12 * Math.pow(Math.max(0, Math.abs(x) - 0.75) / 0.22, 2);
      p.setY(i, crown + fall + edge);
    }
    g.computeVertexNormals();
    g.translate(0, -0.24, -1.75);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...HU, ...skyU },
      vertexShader: /* glsl */ `varying vec3 vW; varying vec3 vN; varying vec2 vUv;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: HW_GLSL + SKY_GLSL + /* glsl */ `
        varying vec3 vW; varying vec3 vN; varying vec2 vUv;
        void main() {
          vec3 N = normalize(vN), V = normalize(cameraPosition - vW);
          vec3 R = reflect(-V, N);
          float fr = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 env = skyCol(normalize(vec3(R.x, max(R.y, 0.02), R.z)));
          vec3 spec;
          vec3 diff = hwLight(vW, N, V, 0.07, 2.2, spec);
          vec3 base = vec3(0.006, 0.008, 0.016);
          // fine metallic flake
          float fl = fract(sin(dot(floor(vUv * 900.0), vec2(12.9898, 78.233))) * 43758.5453);
          vec3 c = base * diff * (0.8 + 0.4 * fl) + env * fr * 0.9 + spec * 0.6;
          // the bonnet's edges fall off into shadow
          c *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    super(g, mat);
    this.frustumCulled = false;
  }
}
