// The sky of the drops (`cosmos`): a nebula painted once as density (two channels: broad gas and bright
// filaments) and coloured per frame from two palette colours, so each drop keeps one dominant hue; and a
// field of stars at infinity with a milky band.
import * as THREE from 'three';
import { clamp, mulberry32, noise3, smoothstep } from '../../engine/util';
import { GlowPoints } from '../lib/points';

const fbm3 = (x: number, y: number, z: number, oct: number, seed: number) => {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 7); f *= 2.03; a *= 0.5; }
  return s;
};

/** Equirectangular density map: R = gas, G = filaments / knots, B = dark lanes. */
export function densityMap(w = 512, h = 256, seed = 3): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!, img = c.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / h) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      const dx = cl * Math.sin(lon), dy = sl, dz = cl * Math.cos(lon);
      const wx = fbm3(dx * 1.2 + 4.1, dy * 1.2, dz * 1.2, 3, seed + 11), wy = fbm3(dx * 1.2, dy * 1.2 - 2.7, dz * 1.2 + 1.3, 3, seed + 23);
      const px = dx * 2.0 + wx * 1.6, py = dy * 2.0 + wy * 1.6, pz = dz * 2.0 + (wx - wy) * 0.9;
      // a band across the sky (the galactic plane) holds most of the gas
      const band = Math.exp(-Math.pow((dy - 0.3 * Math.sin(lon * 2 + 0.5)) / 0.42, 2));
      const den = smoothstep(-0.25, 0.55, fbm3(px, py, pz, 4, seed + 37)) * (0.3 + 0.7 * band);
      const fil = Math.pow(1 - Math.abs(fbm3(px * 2.2 + 3, py * 2.2, pz * 2.2, 4, seed + 41)) * 2.2, 6);
      const lane = smoothstep(0.08, 0.4, fbm3(px * 2.6 + 9, py * 2.6, pz * 2.6, 3, seed + 51));
      const o = (y * w + x) * 4;
      img.data[o] = Math.round(clamp(Math.pow(den, 1.5)) * 255);
      img.data[o + 1] = Math.round(clamp(fil * den * 1.6) * 255);
      img.data[o + 2] = Math.round(clamp(lane) * 255);
      img.data[o + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter; // (no mips: the seam would pick a tiny mip)
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

/** Sphere at infinity: gas in `gas`, filaments in `fil`, dark lanes cut out; additive over the sky dome. */
export function nebula(map: THREE.Texture, radius = 900) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: true, transparent: true, blending: THREE.AdditiveBlending,
    uniforms: { map: { value: map }, gas: { value: new THREE.Color(0, 0, 0) }, fil: { value: new THREE.Color(0, 0, 0) }, lane: { value: 0.7 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec3 gas, fil; uniform float lane;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        float lon = abs(d.x) + abs(d.z) < 1e-6 ? 0.0 : atan(d.x, d.z);
        vec2 uv = vec2(lon / 6.2831853 + 0.5, 0.5 + asin(clamp(d.y, -1.0, 1.0)) / 3.1415927);
        vec3 m = texture2D(map, uv).rgb;
        vec3 c = (gas * m.r + fil * m.g) * (1.0 - lane * m.b);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  m.frustumCulled = false;
  m.renderOrder = -9;
  return m;
}

/** Stars at infinity (radius R) with a milky band; colours lean toward `tint` by `tk`. */
export function starField(n: number, R: number, seed: number, tint: THREE.Color, tk = 0.25) {
  const p = new GlowPoints(n, 1);
  p.renderOrder = -8;
  const r = mulberry32(seed), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * Math.PI * 2;
    const band = Math.exp(-Math.pow((u - 0.3 * Math.sin(a * 2 + 0.5)) / 0.2, 2));
    const k = 0.25 + Math.pow(r(), 3) * 1.6 + band * r() * 1.2;
    c.setRGB(1, 1, 1).lerp(tint, r() * tk);
    p.set(i, Math.sqrt(1 - u * u) * Math.sin(a) * R, u * R, Math.sqrt(1 - u * u) * Math.cos(a) * R, c, k, (0.0012 + Math.pow(r(), 4) * 0.004) * R);
  }
  p.commit();
  return p;
}
