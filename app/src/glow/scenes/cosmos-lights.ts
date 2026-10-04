// Light and shade for the giants of the drops: their dark, dust-lane bodies under the stardust, and the sun the
// finale's star becomes. (His star sticker and her paper lantern are the shared props of lib/heroes.ts.)
import * as THREE from 'three';

/**
 * For the giants' bodies under their stardust: a dark, half-transparent skin (like the dust lanes of a galaxy),
 * so a giant in front of the bright core reads as a body against the light; clear at the silhouette, where the
 * stardust glows. Skinned; normal blending, no depth writes. `alpha` uniform.
 */
export function dustLaneMaterial(color: THREE.Color, alpha = 0.5) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { color: { value: color.clone() }, alpha: { value: alpha } },
    vertexShader: /* glsl */ `
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main() {
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vN = normalMatrix * objectNormal; vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float alpha;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float ln = length(vN), lv = length(vV);
        vec3 n = ln > 1e-5 ? vN / ln : vec3(0.0, 0.0, 1.0), v = lv > 1e-5 ? vV / lv : vec3(0.0, 0.0, 1.0);
        float f = clamp(abs(dot(n, v)), 0.0, 1.0);
        gl_FragColor = vec4(color, alpha * smoothstep(0.1, 0.6, f));
      }`,
  });
}

/**
 * The sun the merged star becomes: a camera-facing disc (set `quaternion` to the camera's), limb-darkened
 * white-gold with a granular shimmer; additive. Radius 1 at scale 1; `set(colour, k, time)`.
 */
export class SunDisc extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  constructor() {
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { color: { value: new THREE.Color(1, 0.8, 0.5) }, k: { value: 1 }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float k, time;
        varying vec2 vP;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          float r = length(vP);
          if (r > 1.0) discard;
          float mu = sqrt(max(0.0, 1.0 - r * r));
          float limb = 0.45 + 0.55 * mu;
          float gran = 0.9 + 0.1 * n2(vP * 18.0 + time * 0.7) + 0.06 * n2(vP * 41.0 - time);
          vec3 c = mix(color, vec3(1.0, 0.97, 0.9), mu * 0.7) * limb * gran;
          gl_FragColor = vec4(c * k * smoothstep(1.0, 0.985, r), 1.0);
        }`,
    });
    super(new THREE.PlaneGeometry(2, 2), mat);
    this.frustumCulled = false;
    this.renderOrder = 6;
  }
  set(c: THREE.Color, k: number, time: number) {
    (this.material.uniforms.color!.value as THREE.Color).copy(c);
    this.material.uniforms.k!.value = k;
    this.material.uniforms.time!.value = time;
  }
}
