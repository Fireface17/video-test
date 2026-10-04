// Highway scene, environment: the night sky (dusk haze, city glow, the surreal sunrise), the wet asphalt
// (lane markings, headlight pool, coloured reflection streaks of the signs and the sun), and the roadside
// furniture that streams past (guardrail, median barrier, posts, cat's eyes and reflectors).
//
// Two worlds: the "sign world" (gantries, station) is where the camera really is (z = -sSign); the
// "road world" (asphalt, markings, rail, billboards) streams toward the camera a little faster, by the
// offset `off` (a road feature at road coordinate u sits at world z = off - u). The signs then read like
// giant, distant signs while the road rushes underneath.
import * as THREE from 'three';
import { col } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { mulberry32 } from '../../engine/util';

/** Road layout (metres, x to the right): three lanes in our direction, shoulders, rail and barrier. */
export const ROAD = {
  lane: 3.6,
  edgeL: -5.4, edgeR: 5.4, // solid edge lines
  asphaltL: -6.4, asphaltR: 7.9,
  railX: 8.4, barrierX: -7.0,
  dashP: 12, dashD: 3, // dash period / length
} as const;

/** Sky colour by direction, shared by the dome and the far haze of the road (so they meet seamlessly). */
export const SKY_GLSL = /* glsl */ `
uniform vec3 uTop, uHor, uCity, uSun, uSunDir;
uniform float uWarm;
vec3 skyCol(vec3 d) {
  float yy = max(d.y, 0.0);
  vec3 c = mix(uHor, uTop, pow(clamp(yy * 1.8, 0.0, 1.0), 0.55));
  c += uHor * 0.5 * exp(-yy * 28.0);                            // dusk haze hugging the horizon
  float az = atan(d.x, -d.z);
  c += uCity * exp(-az * az * 6.0) * exp(-yy * 16.0);            // the distant city ahead
  float g = max(dot(d, uSunDir), 0.0);
  c += uSun * (0.06 * pow(g, 24.0) + 0.3 * pow(g, 160.0) + 1.0 * pow(g, 1400.0));
  c += uSun * uWarm * (0.2 * exp(-az * az * 5.0) * exp(-yy * 26.0) + 0.05 * exp(-az * az * 1.5) * exp(-yy * 9.0)); // the horizon turns gold
  return c;
}`;

export type SkyU = ReturnType<typeof skyUniforms>;
export function skyUniforms() {
  return {
    uTop: { value: col('night') },
    uHor: { value: col('dusk', 1.05) },
    uCity: { value: col('blue', 0.05).add(col('violet', 0.02)) },
    uSun: { value: new THREE.Color(0, 0, 0) },
    uSunDir: { value: new THREE.Vector3(0, -0.06, -1).normalize() },
    uWarm: { value: 0 },
  };
}

/** Sky dome centred on the camera (move it with the camera). */
export function makeSky(u: SkyU, radius = 2400) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: u,
    vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_GLSL + /* glsl */ `
      varying vec3 vDir;
      void main(){ gl_FragColor = vec4(skyCol(normalize(vDir)), 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}

export const NG = 6; // reflection sources on the wet road

/**
 * The ground: one big plane under the camera, everything procedural from world position (road world for
 * the markings). Wet patches reflect up to NG light sources as long vertical streaks (horizontal segment
 * lights: position, half-width, half-height, colour).
 */
export class Road extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  u: Record<string, THREE.IUniform>;

  constructor(sky: SkyU) {
    const u = {
      ...sky,
      camPos: { value: new THREE.Vector3() },
      off: { value: 0 },
      fogD: { value: 0.013 },
      headK: { value: 1 },
      gPos: { value: Array.from({ length: NG }, () => new THREE.Vector3(0, -100, 0)) },
      gCol: { value: Array.from({ length: NG }, () => new THREE.Color(0, 0, 0)) },
      gSize: { value: Array.from({ length: NG }, () => new THREE.Vector2(1, 1)) },
      pool: { value: new THREE.Vector4(0, 0, 1, 0) },
      poolCol: { value: new THREE.Color(0, 0, 0) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: SKY_GLSL + /* glsl */ `
        #define NG ${NG}
        uniform vec3 camPos; uniform float off, fogD, headK;
        uniform vec3 gPos[NG]; uniform vec3 gCol[NG]; uniform vec2 gSize[NG];
        uniform vec4 pool; uniform vec3 poolCol;
        varying vec3 vW;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
        // box-filtered coverage of a stripe [c - hw, c + hw] over a pixel footprint fw
        float cov(float x, float fw, float c, float hw) { return clamp((min(x + 0.5 * fw, c + hw) - max(x - 0.5 * fw, c - hw)) / fw, 0.0, 1.0); }
        float dashI(float u) { return floor(u / ${ROAD.dashP}.0) * ${ROAD.dashD}.0 + min(mod(u, ${ROAD.dashP}.0), ${ROAD.dashD}.0); }
        float dashCov(float u, float fu) { return clamp((dashI(u + 0.5 * fu) - dashI(u - 0.5 * fu)) / fu, 0.0, 1.0); }
        void main() {
          vec3 P = vW;
          vec3 V = P - camPos; float dist = length(V); vec3 vd = V / dist;
          float x = P.x, u = off - P.z;
          float fx = max(fwidth(x), 1e-4), fu = max(fwidth(u), 1e-4);
          float road = cov(x, fx, ${((ROAD.asphaltL + ROAD.asphaltR) / 2).toFixed(2)}, ${((ROAD.asphaltR - ROAD.asphaltL) / 2).toFixed(2)});
          float dash = dashCov(u, fu);
          float m = cov(x, fx, ${ROAD.edgeL.toFixed(2)}, 0.1) + cov(x, fx, ${ROAD.edgeR.toFixed(2)}, 0.1)
                  + (cov(x, fx, ${(-ROAD.lane / 2).toFixed(2)}, 0.075) + cov(x, fx, ${(ROAD.lane / 2).toFixed(2)}, 0.075)) * dash;
          m = clamp(m, 0.0, 1.0) * road;
          // asphalt: patchy dark blue-grey with fine grain (faded with distance), the verge darker
          float n1 = vn(vec2(x * 0.31, u * 0.09)), n2 = vn(vec2(x * 2.7, u * 1.9)), n3 = vn(vec2(x * 0.9 + 7.0, u * 0.35));
          float grain = exp(-dist * 0.06);
          vec3 asph = vec3(0.010, 0.011, 0.017) * (0.7 + 0.6 * n1) * (1.0 + 0.5 * (n2 - 0.5) * grain);
          // tyre-polished lane centres are a touch darker and wetter
          float lanePos = abs(fract((x + ${(ROAD.lane / 2).toFixed(2)}) / ${ROAD.lane.toFixed(2)}) - 0.5);
          float track = smoothstep(0.08, 0.2, abs(lanePos - 0.25));
          asph *= mix(0.85, 1.0, track);
          vec3 verge = vec3(0.0035, 0.0045, 0.008) * (0.6 + 0.8 * n3);
          vec3 alb = mix(verge, asph, road);
          alb = mix(alb, vec3(0.38, 0.40, 0.46), m);
          // light: sky ambient + a headlight pool ahead of the camera (paint is retroreflective)
          float ahead = camPos.z - P.z, lat = x - camPos.x;
          float beam = headK * smoothstep(1.0, 8.0, ahead) * exp(-pow(lat / (0.24 * ahead + 1.7), 2.0)) / (1.0 + pow(ahead / 24.0, 2.0));
          vec3 light = vec3(0.09, 0.10, 0.16) + vec3(0.85, 0.92, 1.0) * beam * (1.0 + 3.0 * m);
          float pd = length(vec2(x - pool.x, P.z - pool.y)) / pool.z;
          light += poolCol * exp(-pd * pd * 1.6);
          vec3 c = alb * light;
          // wet reflections: long vertical streaks of every light source
          float wet = mix(0.08, mix(0.3, 1.0, smoothstep(0.3, 0.75, vn(vec2(x * 0.16 + 3.0, u * 0.045)))) * mix(0.8, 1.0, track), road) * (1.0 - 0.75 * m);
          // the sheen is streaky: stretched along the road, broken across it
          float streak = smoothstep(0.2, 0.85, vn(vec2(x * 1.6 + 11.0, u * 0.06))) * (0.75 + 0.25 * vn(vec2(x * 5.0, u * 0.3)));
          wet *= mix(0.15, 1.0, streak);
          float fres = 0.03 + 0.97 * pow(1.0 - clamp(-vd.y, 0.0, 1.0), 5.0);
          float azR = atan(vd.x, -vd.z), elR = asin(clamp(-vd.y, -1.0, 1.0));
          vec3 refl = vec3(0.0);
          for (int i = 0; i < NG; i++) {
            vec3 L = gPos[i] - P;
            float hz = -L.z;
            if (hz < 0.05) continue;
            float a0 = atan(L.x - gSize[i].x, hz), a1 = atan(L.x + gSize[i].x, hz);
            float da = max(max(a0 - azR, azR - a1), 0.0);
            float hd = length(L.xz);
            float e0 = atan(L.y - gSize[i].y, hd), e1 = atan(L.y + gSize[i].y, hd);
            float de = max(max(e0 - elR, elR - e1), 0.0);
            refl += gCol[i] * exp(-da * da * 700.0) * exp(-de * de * 34.0);
          }
          c += refl * fres * wet;
          // haze toward the sky's own horizon colour in this direction
          float f = 1.0 - exp(-fogD * fogD * dist * dist);
          c = mix(c, skyCol(vd), f);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    super(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    this.u = u;
    this.scale.set(1600, 1, 5200);
    this.frustumCulled = false;
  }

  /** Follow the camera (the plane is procedural, only its extent moves). */
  follow(cam: THREE.Vector3) {
    this.position.set(cam.x, 0, cam.z - 2400);
    (this.u.camPos!.value as THREE.Vector3).copy(cam);
  }

  setGlint(i: number, x: number, y: number, z: number, hw: number, hh: number, c: THREE.Color, k = 1) {
    (this.u.gPos!.value as THREE.Vector3[])[i]!.set(x, y, z);
    (this.u.gSize!.value as THREE.Vector2[])[i]!.set(hw, hh);
    (this.u.gCol!.value as THREE.Color[])[i]!.copy(c).multiplyScalar(k);
  }
  clearGlint(i: number) { (this.u.gCol!.value as THREE.Color[])[i]!.setRGB(0, 0, 0); }
}

/**
 * Roadside furniture in the road world: a W-beam guardrail on posts (right), a concrete median barrier
 * (left), cat's eyes in the lane lines and on the edges, reflectors on the rail and the barrier.
 */
export class Roadside extends THREE.Group {
  rail: THREE.Mesh;
  barrier: THREE.Mesh;
  posts: THREE.InstancedMesh;
  pts: GlowPoints;
  private m4 = new THREE.Matrix4();
  static POSTS = 64;

  constructor(fogD: number) {
    super();
    const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a6488'), roughness: 0.45, metalness: 0.55 });
    const concrete = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a4160'), roughness: 0.9 });
    // W-beam: a box with two shallow ribs
    const beam = new THREE.BoxGeometry(0.06, 0.34, 600);
    this.rail = new THREE.Mesh(beam, steel);
    this.rail.position.set(ROAD.railX, 0.62, 0);
    const bg = new THREE.BoxGeometry(0.55, 0.82, 600);
    this.barrier = new THREE.Mesh(bg, concrete);
    this.barrier.position.set(ROAD.barrierX, 0.41, 0);
    this.posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.8, 0.14), steel, Roadside.POSTS);
    this.posts.frustumCulled = false;
    this.pts = new GlowPoints(260, 1, { fogDensity: fogD });
    this.add(this.rail, this.barrier, this.posts, this.pts);
  }

  /**
   * camZ: camera world z; sRoad: road-world travel; off: road offset; k: overall reflector brightness.
   */
  update(camZ: number, sRoad: number, off: number, k = 1) {
    this.rail.position.z = camZ - 250;
    this.barrier.position.z = camZ - 250;
    const zOf = (u: number) => off - u; // road coordinate -> world z
    // posts every 4 m from 6 m behind to ~250 m ahead
    const p0 = Math.floor((sRoad - 6) / 4) * 4;
    for (let i = 0; i < Roadside.POSTS; i++) {
      const u = p0 + i * 4;
      this.m4.makeTranslation(ROAD.railX + 0.1, 0.4, zOf(u));
      this.posts.setMatrixAt(i, this.m4);
    }
    this.posts.instanceMatrix.needsUpdate = true;
    // reflectors
    const P = this.pts;
    let n = 0;
    const wht = col('#dff4ff'), pink = col('pink'), cyan = col('cyan');
    const bright = (u: number) => { const d = u - sRoad; return d < -3 ? 0 : 0.35 + 0.65 / (1 + (d / 20) ** 2); };
    const c0 = Math.floor((sRoad - 4) / ROAD.dashP) * ROAD.dashP;
    for (let i = 0; i < 22; i++) {
      const u = c0 + i * ROAD.dashP;
      // cat's eyes between the dashes, and on the edge lines
      for (const x of [-ROAD.lane / 2, ROAD.lane / 2]) if (n < P.n) P.set(n++, x, 0.03, zOf(u + 7.5), wht, 1.5 * k * bright(u + 7.5), 0.12);
      if (n < P.n) P.set(n++, ROAD.edgeR + 0.22, 0.03, zOf(u + 1.5), pink, 1.3 * k * bright(u + 1.5), 0.12);
      if (n < P.n) P.set(n++, ROAD.edgeL - 0.22, 0.03, zOf(u + 1.5), cyan, 1.1 * k * bright(u + 1.5), 0.12);
    }
    for (let i = 0; i < 64; i++) {
      const u = p0 + i * 4;
      if (n < P.n) P.set(n++, ROAD.railX - 0.06, 0.72, zOf(u), wht, 0.9 * k * bright(u), 0.1);
    }
    const b0 = Math.floor((sRoad - 6) / 8) * 8;
    for (let i = 0; i < 32; i++) {
      const u = b0 + i * 8 + 2;
      if (n < P.n) P.set(n++, ROAD.barrierX + 0.2, 0.86, zOf(u), cyan, 0.8 * k * bright(u), 0.1);
    }
    for (let i = n; i < P.n; i++) P.hide(i);
    P.commit();
  }
}

/** Stars and the faint lights of the distant city: points at "infinity" (move them with the camera). */
export function skyPoints() {
  const g = new GlowPoints(900, 1);
  const r = mulberry32(17);
  let i = 0;
  for (; i < 620; i++) {
    const az = (r() * 2 - 1) * Math.PI, el = 0.07 + Math.pow(r(), 0.8) * 1.4;
    const R = 2000;
    const c = r() < 0.1 ? col('cyan') : r() < 0.16 ? col('pink') : col('#e8ecff');
    g.set(i, Math.sin(az) * Math.cos(el) * R, Math.sin(el) * R, -Math.cos(az) * Math.cos(el) * R, c, (0.25 + r() * 0.9) * Math.min(1, (el - 0.07) * 6), (0.7 + Math.pow(r(), 3) * 2.2) * R / 300);
  }
  // city: a low band of tiny lights straight ahead, denser in the middle
  for (; i < g.n; i++) {
    const az = (r() + r() + r() - 1.5) * 0.42, el = Math.pow(r(), 2.2) * 0.012 + 0.0015;
    const R = 1900;
    const c = r() < 0.55 ? col('#cfe0ff') : r() < 0.5 ? col('cyan') : r() < 0.5 ? col('violet') : col('pink');
    g.set(i, Math.sin(az) * R, Math.sin(el) * R, -Math.cos(az) * R, c, 0.18 + r() * 0.5, (0.35 + r() * 0.5) * R / 300);
  }
  g.commit();
  return g;
}
