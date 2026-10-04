// Highway scene, the lens flare of the sun: a starburst, a thin anamorphic streak and a few soft ghosts
// along the line through the frame centre, drawn additively over the frame. Restrained, one warm colour.
import * as THREE from 'three';
import { FSPass } from '../../engine/gl';

export class LensFlare {
  pass = new FSPass(/* glsl */ `
    uniform vec2 sun; uniform float k, aspect, rot; uniform vec3 col;
    float disc(vec2 p, vec2 c, float r, float soft) { return smoothstep(r, r * (1.0 - soft), length(p - c)); }
    void main() {
      vec2 p = vec2(vUv.x * aspect, vUv.y);
      vec2 s = vec2(sun.x * aspect, sun.y);
      vec2 d = p - s; float r = length(d);
      float a = atan(d.y, d.x);
      // starburst: a hot core, twelve uneven rays
      float core = exp(-r / 0.012) * 2.5 + exp(-r / 0.06) * 0.6;
      float rays = pow(abs(cos(a * 6.0 + rot)), 60.0) * 0.9 + pow(abs(cos(a * 6.0 + rot + 0.26)), 120.0) * 0.5;
      rays *= exp(-r / 0.22) * 0.9;
      // anamorphic streak
      float streak = exp(-abs(d.y) / 0.0035) * exp(-abs(d.x) / 0.5) * 0.7;
      // veil
      float veil = exp(-r / 0.5) * 0.12;
      // ghosts along the axis through the centre
      vec2 c = vec2(0.5 * aspect, 0.5);
      vec2 ax = c - s;
      float g = 0.0;
      g += disc(p, s + ax * 0.55, 0.035, 0.6) * 0.10;
      g += disc(p, s + ax * 1.25, 0.06, 0.25) * 0.06;
      g += disc(p, s + ax * 1.6, 0.022, 0.5) * 0.12;
      g += (disc(p, s + ax * 2.05, 0.12, 0.08) - disc(p, s + ax * 2.05, 0.105, 0.08)) * 0.08;
      vec3 c3 = col * (core + rays + streak + veil) + col * vec3(0.9, 1.0, 1.1) * g;
      fragColor = vec4(c3 * k, 1.0);
    }`, { sun: { value: new THREE.Vector2() }, k: { value: 0 }, aspect: { value: 16 / 9 }, rot: { value: 0 }, col: { value: new THREE.Color(1, 0.75, 0.45) } }, { blending: THREE.AdditiveBlending, transparent: true });

  /** Draw over `out` for a sun at world direction `dir` seen by `cam`, with visibility k. */
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, cam: THREE.PerspectiveCamera, dir: THREE.Vector3, k: number, rot: number) {
    if (k <= 0.001) return;
    const p = cam.position.clone().add(dir.clone().multiplyScalar(1000)).project(cam);
    if (p.z > 1) return;
    this.pass.u.sun!.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    this.pass.u.k!.value = k;
    this.pass.u.rot!.value = rot;
    this.pass.render(renderer, out);
  }
}
