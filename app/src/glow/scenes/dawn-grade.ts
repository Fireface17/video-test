// Golden hour for the final chorus (`dawn`): the scene is rendered into its own target, then
//   1. a bright pass at a quarter of the resolution (the sun, the bright sky between the buildings, sunlit edges),
//   2. a radial blur of it toward the sun's place on screen — shafts of light through the haze and the gaps,
//   3. the grade: cool shadows, warm gold highlights, more contrast (deep shadows, no grey wash), plus the shafts.
// All passes are cheap (the blur runs on a 480 × 270 target).
import * as THREE from 'three';
import { FSPass, makeRT } from '../../engine/gl';

export class Grade {
  scene = makeRT();
  private small = makeRT(480, 270, { pxScale: 1, depthBuffer: false });
  private rays = makeRT(480, 270, { pxScale: 1, depthBuffer: false });
  private bright = new FSPass(/* glsl */ `
    uniform sampler2D tScene; uniform float thr;
    void main() {
      vec2 px = vec2(1.0 / 480.0, 1.0 / 270.0) * 0.5;
      vec3 c = (texture(tScene, vUv + vec2(-px.x, -px.y)).rgb + texture(tScene, vUv + vec2(px.x, -px.y)).rgb
              + texture(tScene, vUv + vec2(-px.x, px.y)).rgb + texture(tScene, vUv + vec2(px.x, px.y)).rgb) * 0.25;
      c = min(c, vec3(40.0));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      fragColor = vec4(c * smoothstep(thr, thr * 2.5, l), 1.0);
    }`, { tScene: { value: null }, thr: { value: 0.6 } });
  private blur = new FSPass(/* glsl */ `
    uniform sampler2D tBright; uniform vec2 sun; uniform float len;
    void main() {
      vec2 d = (vUv - sun) * len / 40.0;
      vec2 p = vUv;
      float decay = 1.0;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) {
        p -= d;
        vec2 q = clamp(p, vec2(0.0), vec2(1.0));
        acc += texture(tBright, q).rgb * decay;
        decay *= 0.955;
      }
      fragColor = vec4(acc / 16.0, 1.0);
    }`, { tBright: { value: null }, sun: { value: new THREE.Vector2(0.5, 0.5) }, len: { value: 0.8 } });
  private comp = new FSPass(/* glsl */ `
    uniform sampler2D tScene, tRays; uniform float warm, contrast, rayK, lift; uniform vec3 rayCol, shadowCol, highCol;
    void main() {
      vec3 c = min(texture(tScene, vUv).rgb, vec3(60.0));
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // split toning: cool shadows, warm highlights
      float w = smoothstep(0.01, 0.4, l);
      vec3 g = c * mix(mix(vec3(1.0), shadowCol, warm), mix(vec3(1.0), highCol, warm), w);
      // contrast about mid grey, in log space (deep shadows, bright gold highlights)
      float lg = log2(max(dot(g, vec3(0.2126, 0.7152, 0.0722)), 1e-5));
      float lc = (lg + 2.47) * contrast - 2.47;
      g *= exp2(clamp(lc - lg, -6.0, 3.0));
      // grey lifted toward gold: low-saturation midtones take on the light's colour
      float sat = (max(g.r, max(g.g, g.b)) - min(g.r, min(g.g, g.b))) / max(max(g.r, max(g.g, g.b)), 1e-4);
      g = mix(g, dot(g, vec3(0.333)) * highCol, lift * (1.0 - smoothstep(0.1, 0.5, sat)) * smoothstep(0.02, 0.3, l));
      g += texture(tRays, vUv).rgb * rayK * rayCol;
      fragColor = vec4(max(g, vec3(0.0)), 1.0);
    }`, {
    tScene: { value: null }, tRays: { value: null }, warm: { value: 1 }, contrast: { value: 1.15 }, rayK: { value: 1 }, lift: { value: 0.3 },
    rayCol: { value: new THREE.Color(1.0, 0.62, 0.3) }, shadowCol: { value: new THREE.Color(0.8, 0.9, 1.15) }, highCol: { value: new THREE.Color(1.14, 0.97, 0.74) },
  });

  /** Post the scene (already rendered into `scene`) into `out`; `sunDir` world direction of the sun. */
  render(renderer: THREE.WebGLRenderer, cam: THREE.PerspectiveCamera, sunDir: THREE.Vector3, out: THREE.WebGLRenderTarget, o: { warm?: number; contrast?: number; rays?: number; lift?: number; thr?: number }) {
    // where the sun is on screen (rays fade when it is behind us)
    const p = cam.position.clone().addScaledVector(sunDir, 1000).project(cam);
    const facing = cam.getWorldDirection(new THREE.Vector3()).dot(sunDir);
    const sx = THREE.MathUtils.clamp(p.x * 0.5 + 0.5, -1.5, 2.5), sy = THREE.MathUtils.clamp(p.y * 0.5 + 0.5, -1.5, 2.5);
    const rk = (o.rays ?? 1) * THREE.MathUtils.smoothstep(facing, -0.1, 0.45);
    const S = this.bright.u, B = this.blur.u, C = this.comp.u;
    S.tScene!.value = this.scene.texture;
    S.thr!.value = o.thr ?? 0.6;
    this.bright.render(renderer, this.small);
    if (rk > 0.002 && Number.isFinite(sx) && Number.isFinite(sy)) {
      B.tBright!.value = this.small.texture;
      (B.sun!.value as THREE.Vector2).set(sx, sy);
      this.blur.render(renderer, this.rays);
    }
    C.tScene!.value = this.scene.texture;
    C.tRays!.value = this.rays.texture;
    C.warm!.value = o.warm ?? 1;
    C.contrast!.value = o.contrast ?? 1.15;
    C.rayK!.value = rk > 0.002 ? rk : 0;
    C.lift!.value = o.lift ?? 0.3;
    this.comp.render(renderer, out);
  }
}
