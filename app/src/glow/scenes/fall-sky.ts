// The far sky of the bridge (`fall`): soft nebulae of blue, violet and a little pink painted once into an
// equirectangular texture (seamless 3D noise sampled on the sphere) and drawn on a sphere that follows the
// camera, so it sits at infinity like real distant nebulae: one cheap layer, tinted per frame.
import * as THREE from 'three';
import { clamp, noise3, smoothstep } from '../../engine/util';

const fbm3 = (x: number, y: number, z: number, oct: number, seed: number) => {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 7); f *= 2.03; a *= 0.5; }
  return s;
};

/** Equirectangular nebula map (linear colour / `scale`, so the shader multiplies it back up). */
export function nebulaMap(w = 512, h = 256, scale = 4): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!, img = c.createImageData(w, h);
  const blue = [0.047, 0.147, 1.0], violet = [0.33, 0.1, 1.0], pink = [1.0, 0.05, 0.37];
  for (let y = 0; y < h; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      const dx = cl * Math.sin(lon), dy = sl, dz = cl * Math.cos(lon);
      // domain-warped density: broad clouds with wisps and darker lanes
      const wx = fbm3(dx * 1.3 + 4.1, dy * 1.3, dz * 1.3, 3, 11), wy = fbm3(dx * 1.3, dy * 1.3 - 2.7, dz * 1.3 + 1.3, 3, 23);
      const px = dx * 2.1 + wx * 1.4, py = dy * 2.1 + wy * 1.4, pz = dz * 2.1 + (wx - wy) * 0.8;
      const den = smoothstep(-0.22, 0.5, fbm3(px, py, pz, 5, 37));
      const lane = smoothstep(0.1, 0.45, fbm3(px * 2.3 + 9, py * 2.3, pz * 2.3, 3, 51));
      const hueN = fbm3(dx * 1.1 - 3, dy * 1.1 + 5, dz * 1.1, 2, 61), pinkN = fbm3(dx * 2.2 + 7, dy * 2.2, dz * 2.2 - 4, 3, 71);
      const kv = smoothstep(-0.12, 0.25, hueN), kp = smoothstep(0.18, 0.45, pinkN) * 0.8;
      const d = Math.pow(den, 1.6) * (1 - 0.6 * lane);
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const col = (blue[ch]! * (1 - kv) + violet[ch]! * kv) * (1 - kp) + pink[ch]! * kp;
        img.data[o + ch] = Math.round(clamp((col * d * 0.12) * scale) * 255);
      }
      img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter; // no mips: the longitude seam would pick a tiny mip and draw a line
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** A sphere at infinity carrying the nebula map; `gain`, `tint` and `gk` (toward `gold`) per frame. Additive over the sky dome. */
export function nebulaSphere(map: THREE.Texture, scale = 4, radius = 480) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true, // (behind the figures and the lettering, which write depth)
    transparent: true,
    blending: THREE.AdditiveBlending,
    uniforms: { map: { value: map }, gain: { value: 1 }, tint: { value: new THREE.Color(1, 1, 1) }, scale: { value: 1 / scale }, gold: { value: new THREE.Color(1, 0.55, 0.08) }, gk: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float gain, scale, gk; uniform vec3 tint, gold;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec2 uv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
        vec3 c = texture2D(map, uv).rgb * scale;
        // re-hued toward gold by intensity (a blue nebula times a gold tint would only go dark and muddy)
        c = mix(c * tint, gold * max(c.r, max(c.g, c.b)), gk);
        gl_FragColor = vec4(c * gain, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -9;
  return m;
}
