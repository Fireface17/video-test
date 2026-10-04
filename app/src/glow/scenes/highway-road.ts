// Highway scene, the road: wet asphalt (baked aggregate + macro wear, lane paint, road studs, the lyric
// lettering of the first line, light pools, planar reflections streaked by the wet surface), its furniture
// (concrete median, guardrails, posts, reflectors), the streetlights (poles, lenses, halos, haze cones),
// overhead gantries with direction signs, and the traffic.
import * as THREE from 'three';
import { GlowPoints } from '../lib/points';
import { FSPass, makeRT } from '../../engine/gl';
import { mulberry32 } from '../../engine/util';
import { F, font } from '../../engine/type';
import { HU, HW_GLSL, ROAD, boxAt, litMat, merge, rod } from './highway-common';
import { canvasTex, type HwTextures } from './highway-tex';
import { Streaks } from './highway-env';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
export const NWORDS = 8;

// ------------------------------------------------------------------------------------------- reflection

/** Planar reflection of the scene in the road (y = 0), plus a streaked copy for the damp asphalt. */
export class Reflection {
  cam = new THREE.PerspectiveCamera();
  rt = makeRT(640, 360);
  blur = makeRT(640, 360, { depthBuffer: false });
  texMat = new THREE.Matrix4();
  private pass: FSPass;

  constructor() {
    this.pass = new FSPass(/* glsl */ `
      uniform sampler2D src; uniform vec2 px;
      void main() {
        // long vertical streak with a bright core: the wet road smears every light toward the viewer
        vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = -22; i <= 22; i++) {
          float fi = float(i);
          float w = exp(-abs(fi) / 7.0) + 2.5 * exp(-fi * fi / 3.0);
          vec2 o = vec2(0.0, fi * 1.6) * px;
          acc += texture(src, vUv + o).rgb * w; wsum += w;
        }
        fragColor = vec4(acc / wsum, 1.0);
      }`, { src: { value: null }, px: { value: new THREE.Vector2() } });
  }

  /** Mirror `cam` in y = 0 and render `scene` (the road hidden by the caller). */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera) {
    const m = this.cam;
    m.copy(cam, false);
    const p = cam.position, q = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    m.position.set(p.x, -p.y, p.z);
    m.up.set(up.x, -up.y, up.z);
    m.lookAt(p.x + q.x, -p.y - q.y, p.z + q.z);
    m.projectionMatrix.copy(cam.projectionMatrix);
    m.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
    m.updateMatrixWorld();
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(scene, m);
    this.pass.u.src!.value = this.rt.texture;
    this.pass.u.px!.value.set(1 / this.rt.width, 1 / this.rt.height);
    this.pass.render(renderer, this.blur);
  }
}

// ------------------------------------------------------------------------------------------- road surface

export class RoadSurface extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  u: Record<string, THREE.IUniform>;

  constructor(tex: HwTextures, refl: Reflection, wordTex: THREE.Texture) {
    const u: Record<string, THREE.IUniform> = {
      ...HU,
      tA: { value: tex.asphalt }, tN: { value: tex.asphaltN }, tM: { value: tex.macro },
      tR: { value: refl.rt.texture }, tRB: { value: refl.blur.texture }, texMat: { value: refl.texMat },
      tW: { value: wordTex },
      wRect: { value: Array.from({ length: NWORDS }, () => new THREE.Vector4(0, -1e4, 0, -1e4)) },
      wAtlas: { value: Array.from({ length: NWORDS }, () => new THREE.Vector4()) },
      wState: { value: Array.from({ length: NWORDS }, () => new THREE.Vector4()) },
      wet: { value: 1 }, reflK: { value: 1 }, studK: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: HW_GLSL + /* glsl */ `
        #define NW ${NWORDS}
        uniform sampler2D tA, tN, tM, tR, tRB, tW;
        uniform mat4 texMat;
        uniform vec4 wRect[NW]; uniform vec4 wAtlas[NW]; uniform vec4 wState[NW];
        uniform float wet, reflK;
        varying vec3 vW;
        // box-filtered coverage of the stripe [c - hw, c + hw] over a pixel footprint fw
        float cov(float x, float fw, float c, float hw) { return clamp((min(x + 0.5 * fw, c + hw) - max(x - 0.5 * fw, c - hw)) / fw, 0.0, 1.0); }
        float dashI(float u) { return floor(u / ${ROAD.dashP.toFixed(1)}) * ${ROAD.dashL.toFixed(1)} + min(mod(u, ${ROAD.dashP.toFixed(1)}), ${ROAD.dashL.toFixed(1)}); }
        float dashCov(float u, float fu) { return clamp((dashI(u + 0.5 * fu) - dashI(u - 0.5 * fu)) / fu, 0.0, 1.0); }
        void main() {
          vec3 P = vW;
          vec3 Vd = P - cameraPosition; float dist = length(Vd); vec3 vd = Vd / dist; vec3 V = -vd;
          float x = P.x, u = -P.z, ax = abs(x);
          vec2 xu = vec2(x, u);
          vec2 dx = dFdx(xu), dy = dFdy(xu);
          float fx = max(abs(dx.x) + abs(dy.x), 1e-4), fu = max(abs(dx.y) + abs(dy.y), 1e-4);
          float asph = cov(ax, fx, (0.3 + ${ROAD.asphalt.toFixed(2)}) * 0.5, (${ROAD.asphalt.toFixed(2)} - 0.3) * 0.5);
          // ---- textures
          vec4 mac = texture2D(tM, vec2((x + 16.0) / 32.0, u / 128.0));
          vec4 mac2 = texture2D(tM, vec2((x + 16.0) / 32.0 + 0.5, u / 311.0 + 0.37));
          vec2 d1 = xu / 1.6;
          vec2 d2 = mat2(0.8, -0.6, 0.6, 0.8) * xu / 0.71 + 0.31;
          vec4 a1 = texture2D(tA, d1), a2 = texture2D(tA, d2);
          vec4 n1 = texture2D(tN, d1), n2 = texture2D(tN, d2);
          float tone = mac.r * 0.75 + mac2.r * 0.5 - 0.1;
          float alb = mix(a1.r, a2.r, 0.4) * (0.55 + 0.6 * tone) * 0.2;
          float cavity = mix(n1.a, n2.a, 0.4);
          vec3 tn = normalize(vec3((n1.xy * 2.0 - 1.0) + (n2.xy * 2.0 - 1.0) * 0.6, 1.0));
          float crack = mac.a * asph;
          alb *= 1.0 - 0.75 * crack;
          // wetness: puddles in the low spots, water held in the cavities everywhere else
          float puddle = clamp(max(mac.g, mac2.g * 0.8) * wet, 0.0, 1.0) * asph;
          float damp = wet * mix(0.55, 1.0, 1.0 - cavity) * asph + 0.25 * wet * (1.0 - asph);
          // ---- markings
          float mk = 0.0;
          mk += cov(ax, fx, ${ROAD.inner.toFixed(2)}, 0.075) + cov(ax, fx, ${ROAD.outer.toFixed(2)}, 0.1);
          float dsh = dashCov(u + (x < 0.0 ? 5.0 : 0.0), fu);
          mk += (cov(ax, fx, ${(ROAD.inner + ROAD.lane).toFixed(2)}, 0.075) + cov(ax, fx, ${(ROAD.inner + 2 * ROAD.lane).toFixed(2)}, 0.075)) * dsh;
          float wear = mix(a1.b, 1.0, 0.4) * mac.b;
          float paintCov = smoothstep(0.32, 0.5, wear + 0.25 * fu);
          mk = clamp(mk, 0.0, 1.0) * paintCov;
          // ---- the lyric lettering (fresh thermoplastic, painted when the word is sung)
          float word = 0.0, wglow = 0.0;
          for (int i = 0; i < NW; i++) {
            vec4 r = wRect[i];
            vec2 q = vec2((x - r.x) / (r.z - r.x), (u - r.y) / (r.w - r.y));
            if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue;
            vec4 st = wState[i];
            if (st.x <= 0.0) continue;
            vec4 ar = wAtlas[i];
            vec2 sc = (ar.zw - ar.xy) / (r.zw - r.xy);
            vec2 auv = mix(ar.xy, ar.zw, q);
            float c = textureGrad(tW, auv, dx * sc, dy * sc).r;
            // the paint rolls on from the near end; its leading edge glows
            float front = st.x * 1.15 - q.y;
            float on = smoothstep(0.0, 0.06, front);
            c *= on;
            word = max(word, c);
            wglow = max(wglow, c * (st.y + 2.2 * exp(-front * 14.0) * step(st.x, 1.0)));
          }
          word *= smoothstep(0.25, 0.42, mix(a1.b, 1.0, 0.65) * (0.7 + 0.3 * mac.b) + 0.3 * fu);
          // ---- surface
          float paint = max(mk, word);
          vec3 albedo = vec3(alb) * vec3(0.95, 0.97, 1.03);
          // the verge: dark grass and gravel
          vec3 verge = vec3(0.012, 0.014, 0.012) * (0.6 + 0.8 * a2.r);
          albedo = mix(verge, albedo, asph);
          albedo *= mix(1.0, 0.35, clamp(puddle * 0.8 + damp * 0.6, 0.0, 1.0)); // wet asphalt darkens
          albedo = mix(albedo, vec3(0.62, 0.62, 0.6), paint);
          float rough = mix(mix(a1.b, a2.b, 0.4), 0.65, paint);
          // normal: bumpy aggregate, smoothed by the water film and flat in the puddles
          vec3 nb = normalize(mix(tn, vec3(0.0, 0.0, 1.0), clamp(puddle * 0.92 + damp * 0.35, 0.0, 1.0)));
          vec3 N = normalize(vec3(nb.x, nb.z, -nb.y));
          vec3 spec;
          vec3 diff = hwLight(P, N, V, rough * (1.0 - 0.6 * damp), 0.35 + 0.65 * (1.0 - paint), spec);
          vec3 c = albedo * diff + spec * (1.0 - puddle) * 0.9;
          // retroreflective paint in our headlights
          c += paint * hwHead(P, vec3(0.0, 1.0, 0.0)) * 2.5;
          c += vec3(1.0, 0.98, 0.94) * wglow;
          // ---- reflections
          vec4 rp = texMat * vec4(P, 1.0);
          vec2 ruv = rp.xy / rp.w;
          float dk = clamp(6.0 / dist, 0.15, 1.0);
          vec2 dist1 = nb.xy * vec2(0.012, 0.02) * dk;
          vec3 rSharp = texture2D(tR, ruv + dist1 * 0.35 + vec2(0.0, sin(u * 2.3 + x * 0.7) * 0.0015 * dk)).rgb;
          vec3 rBlur = texture2D(tRB, ruv + dist1).rgb;
          float cosV = clamp(dot(vec3(0.0, 1.0, 0.0), V), 0.0, 1.0);
          float fres = 0.02 + 0.98 * pow(1.0 - cosV, 5.0);
          float fresR = 0.03 + 0.97 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
          vec3 refl = mix(rBlur * (0.7 + 0.3 * damp), mix(rBlur, rSharp, 0.6), puddle) * mix(fresR, fres, puddle * 0.7);
          refl *= (1.0 - paint * 0.7) * mix(0.35, 1.0, max(damp, puddle)) * reflK * mix(0.04, 1.0, asph);
          c += refl;
          c = hwFog(c, P, cameraPosition);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    super(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat);
    this.u = u;
    this.scale.set(3000, 1, 6000);
    this.frustumCulled = false;
    this.renderOrder = -5;
  }

  follow(cam: THREE.Vector3) {
    this.position.set(cam.x, 0, cam.z - 2700);
  }
}

// ------------------------------------------------------------------------------------------- the lettering atlas

export interface WordSlot { text: string; atlas: THREE.Vector4 }

/** Road-marking words drawn tall in a condensed grotesk, white on black (red channel = coverage). */
export function wordAtlas(words: string[]): { tex: THREE.Texture; slots: WordSlot[] } {
  const W = 2048, cellH = 256, H = cellH * Math.ceil(words.length / 2);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = Math.max(256, H);
  const c = cv.getContext('2d')!;
  c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
  const fam = F.archivo(62, 700);
  const slots: WordSlot[] = [];
  words.forEach((w, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x0 = col * (W / 2) + 16, y0 = row * cellH + 10, cw = W / 2 - 32, ch = cellH - 20;
    const txt = w.toUpperCase();
    // fit the cap height to the cell, keep the advance (stretched horizontally if needed)
    const px = ch / 0.72;
    c.font = font(fam, px);
    const m = c.measureText(txt);
    const sx = Math.min(1.4, cw / m.width);
    c.save();
    c.translate(x0 + (cw - m.width * sx) / 2, y0 + ch);
    c.scale(sx, 1);
    c.fillStyle = '#fff';
    c.fillText(txt, 0, 0);
    c.restore();
    const bx0 = (x0 + (cw - m.width * sx) / 2) / cv.width, bx1 = (x0 + (cw + m.width * sx) / 2) / cv.width;
    // y: canvas top-down → texture v up (flipY): the baseline is the near end
    const v0 = 1 - (y0 + ch) / cv.height, v1 = 1 - (y0 + ch - px * 0.73) / cv.height;
    slots.push({ text: txt, atlas: new THREE.Vector4(bx0, v0, bx1, v1) });
  });
  const tex = canvasTex(cv, { srgb: false, aniso: 16 });
  return { tex, slots };
}

// ------------------------------------------------------------------------------------------- furniture

function extrudeProfile(profile: [number, number][], length: number, tile = 2) {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  let acc = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const [x0, y0] = profile[i]!, [x1, y1] = profile[i + 1]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = (y1 - y0) / len, ny = -(x1 - x0) / len;
    const b = pos.length / 3;
    for (const [x, y, v] of [[x0, y0, acc], [x1, y1, acc + len]] as const) {
      pos.push(x, y, 0, x, y, -length);
      nor.push(nx, ny, 0, nx, ny, 0);
      uv.push(v / tile, 0, v / tile, length / tile);
    }
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    acc += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class Furniture extends THREE.Group {
  barrier: THREE.Mesh;
  rails: THREE.Mesh[] = [];
  posts: THREE.InstancedMesh;
  refl: GlowPoints;
  studs: GlowPoints;
  static LEN = 900;
  static NPOST = 220;

  constructor(tex: HwTextures) {
    super();
    // Jersey barrier on the median (concrete texture, dirty foot)
    const prof: [number, number][] = [[0.31, 0], [0.31, 0.075], [0.2, 0.33], [0.08, 0.82], [-0.08, 0.82], [-0.2, 0.33], [-0.31, 0.075], [-0.31, 0]];
    const bg = extrudeProfile(prof, Furniture.LEN, 2);
    const conc = litMat({
      color: C('#8a8f99', 0.55), rough: 0.85, spec: 0.25, map: tex.concrete,
      frag: /* glsl */ `alb *= mix(0.45, 1.0, smoothstep(0.0, 0.5, vW.y)); alb *= 0.85 + 0.3 * step(0.06, fract(vW.z / 6.0));`,
    });
    this.barrier = new THREE.Mesh(bg, conc);
    this.barrier.frustumCulled = false;
    // W-beam guardrails on both outer edges (galvanised steel)
    const wb: [number, number][] = [];
    const ys = [0, 0.03, 0.08, 0.13, 0.155, 0.18, 0.23, 0.28, 0.31], xs = [0, 0.06, 0.085, 0.06, 0.02, 0.06, 0.085, 0.06, 0];
    for (let i = 0; i < ys.length; i++) wb.push([xs[i]!, 0.47 + ys[i]!]);
    const steel = litMat({ color: C('#9aa3ad', 0.6), rough: 0.35, metal: 0.8, spec: 1.0, grime: 0.5, side: THREE.DoubleSide });
    for (const side of [1, -1]) {
      const g = extrudeProfile(side > 0 ? wb.map(([x, y]) => [-x, y] as [number, number]).reverse() : wb, Furniture.LEN, 4);
      const m = new THREE.Mesh(g, steel);
      m.position.x = side * ROAD.rail;
      m.frustumCulled = false;
      this.rails.push(m);
    }
    // posts (C-section with a blockout), both sides, every 2 m
    const pg = merge([boxAt(0.15, 0.82, 0.1, 0.12, 0.41, 0), boxAt(0.1, 0.33, 0.14, 0.04, 0.62, 0)]);
    this.posts = new THREE.InstancedMesh(pg, litMat({ color: C('#7d8590', 0.5), rough: 0.5, metal: 0.6, spec: 0.8, grime: 0.6 }), Furniture.NPOST);
    this.posts.frustumCulled = false;
    this.refl = new GlowPoints(400, 1);
    this.studs = new GlowPoints(600, 1);
    this.add(this.barrier, ...this.rails, this.posts, this.refl, this.studs);
  }

  /** camU: camera road coordinate; head: our headlights on (studs light up in them). */
  update(camU: number, camX: number, t: number, head: number, lampsOn: number) {
    const base = Math.floor((camU - 60) / 12) * 12;
    this.barrier.position.z = -base;
    for (const r of this.rails) r.position.z = -base;
    const m = new THREE.Matrix4();
    const p0 = Math.floor((camU - 30) / 2) * 2;
    for (let i = 0; i < Furniture.NPOST; i++) {
      const side = i % 2 ? 1 : -1, k = i >> 1;
      const u = p0 + k * 4 + (side > 0 ? 0 : 2);
      m.makeRotationY(side > 0 ? Math.PI : 0).setPosition(side * (ROAD.rail + 0.13), 0, -u);
      this.posts.setMatrixAt(i, m);
    }
    this.posts.instanceMatrix.needsUpdate = true;
    // reflectors on the rail (amber on the right, white on the left) and on the barrier top
    const R = this.refl;
    let n = 0;
    const r0 = Math.floor((camU - 20) / 8) * 8;
    const amber = C('#ffa13a'), white = C('#e8f1ff'), red = C('#ff2a20');
    const vis = (u: number, x: number) => {
      const d = Math.hypot(u - camU, x - camX);
      return (0.5 + 1.2 * head * Math.exp(-d / 60)) / (1 + d / 90) * smoothSign(u - camU + 4);
    };
    for (let k = 0; k < 90 && n < R.n - 3; k++) {
      const u = r0 + k * 8;
      R.set(n++, ROAD.rail - 0.05, 0.62, -u, amber, 1.6 * vis(u, ROAD.rail), 0.16);
      R.set(n++, -ROAD.rail + 0.05, 0.62, -u, white, 1.0 * vis(u, -ROAD.rail), 0.16);
      if (k % 2 === 0) R.set(n++, 0.0, 0.86, -(u + 4), white, 0.9 * vis(u + 4, 0), 0.14);
    }
    for (let i = n; i < R.n; i++) R.hide(i);
    R.commit();
    // road studs (cat's eyes): white on the lane lines, red on the outer edge, amber by the median
    const S = this.studs;
    n = 0;
    const s0 = Math.floor((camU - 10) / ROAD.dashP) * ROAD.dashP;
    for (let k = 0; k < 60 && n < S.n - 8; k++) {
      const u = s0 + k * ROAD.dashP + 7.5;
      const glint = (x: number) => {
        const d = Math.hypot(u - camU, x - camX);
        const f = frameFlick(u, x, t);
        return (0.35 * lampsOn + 2.4 * head * Math.exp(-d / 45)) / (1 + d / 70) * smoothSign(u - camU + 1) * f;
      };
      for (const x of [ROAD.inner + ROAD.lane, ROAD.inner + 2 * ROAD.lane]) S.set(n++, x, 0.02, -u, white, 0.9 * glint(x), 0.07);
      S.set(n++, ROAD.outer + 0.25, 0.02, -u, red, 1.2 * glint(ROAD.outer), 0.07);
      S.set(n++, ROAD.inner - 0.22, 0.02, -u, amber, 0.9 * glint(ROAD.inner), 0.07);
      for (const x of [-(ROAD.inner + ROAD.lane), -(ROAD.inner + 2 * ROAD.lane)]) S.set(n++, x, 0.02, -(u + 5), white, 0.5 * glint(x), 0.07);
    }
    for (let i = n; i < S.n; i++) S.hide(i);
    S.commit();
  }
}
const smoothSign = (x: number) => (x <= 0 ? 0 : x >= 4 ? 1 : x / 4);
function frameFlick(u: number, x: number, t: number) {
  // retroreflectors catch the light at slightly different angles: a sparse sparkle
  const h = Math.sin(u * 12.9898 + x * 78.233) * 43758.5453;
  const ph = h - Math.floor(h);
  return 0.75 + 0.5 * Math.max(0, Math.sin(t * 9 + ph * 40)) ** 8;
}

// ------------------------------------------------------------------------------------------- streetlights

export class Streetlights extends THREE.Group {
  poles: THREE.InstancedMesh;
  lenses: THREE.InstancedMesh;
  cones: THREE.InstancedMesh;
  halos: GlowPoints;
  lensMat: THREE.ShaderMaterial;
  coneU = { cCol: { value: new THREE.Color() }, cK: { value: 1 } };
  static N = 30; // poles with geometry
  static NC = 12; // poles with haze cones
  static NFAR = 60; // further poles: halos only

  constructor() {
    super();
    const A = ROAD.lampArm, H = ROAD.lampH;
    const parts: THREE.BufferGeometry[] = [];
    parts.push(rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, H - 0.5, 0), 0.16, 0.085, 10));
    parts.push(boxAt(0.5, 0.25, 0.5, 0, 0.12, 0)); // base plate
    for (const s of [-1, 1]) {
      const a = new THREE.Vector3(0, H - 0.9, 0), b = new THREE.Vector3(s * A * 0.45, H - 0.15, 0), c = new THREE.Vector3(s * (A - 0.35), H + 0.05, 0);
      parts.push(rod(a, b, 0.06, 0.05, 6), rod(b, c, 0.05, 0.045, 6));
      // cobra head
      const head = new THREE.CylinderGeometry(0.2, 0.26, 0.85, 10, 1);
      head.rotateZ(Math.PI / 2); head.scale(1, 0.45, 1); head.translate(s * A, H + 0.05, 0);
      parts.push(head);
    }
    this.poles = new THREE.InstancedMesh(merge(parts), litMat({ color: C('#7a828e', 0.5), rough: 0.45, metal: 0.6, spec: 0.8, grime: 0.4 }), Streetlights.N);
    this.poles.frustumCulled = false;
    // the lenses: hot sodium glass under each head
    const lg = merge([-1, 1].map((s) => { const g = new THREE.CylinderGeometry(0.17, 0.17, 0.04, 14); g.scale(1.8, 1, 1); g.translate(s * A, H - 0.07, 0); return g; }));
    this.lensMat = new THREE.ShaderMaterial({
      uniforms: { col: { value: new THREE.Color() } },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW; void main(){ mat4 m = modelMatrix * instanceMatrix; vec4 w = m * vec4(position, 1.0); vW = w.xyz; vN = mat3(m) * normal; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec3 col; varying vec3 vN; varying vec3 vW;
        void main(){ vec3 V = normalize(cameraPosition - vW); float f = abs(dot(normalize(vN), V)); gl_FragColor = vec4(col * (0.35 + 0.65 * f) * (vN.y < -0.5 ? 1.0 : 0.25), 1.0); }`,
    });
    this.lenses = new THREE.InstancedMesh(lg, this.lensMat, Streetlights.N);
    this.lenses.frustumCulled = false;
    // haze cones under the near lamps
    const cg = merge([-1, 1].map((s) => {
      const g = new THREE.CylinderGeometry(0.25, 7.5, H, 28, 1, true);
      g.translate(s * A, H / 2 - 0.1, 0);
      return g;
    }));
    const cm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...this.coneU, uFogD: HU.uFogD },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW; varying float vY;
        void main(){ mat4 m = modelMatrix * instanceMatrix; vec4 w = m * vec4(position, 1.0); vW = w.xyz; vY = position.y; vN = normalize(mat3(m) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform vec3 cCol; uniform float cK, uFogD; varying vec3 vN; varying vec3 vW; varying float vY;
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float f = abs(dot(normalize(vN), V));
          float k = pow(f, 2.2);
          float along = clamp(vY / ${H.toFixed(2)}, 0.0, 1.0);
          float fall = mix(0.25, 1.0, pow(along, 2.0)) * smoothstep(0.0, 0.25, along) * smoothstep(1.0, 0.94, along);
          float d = length(vW - cameraPosition);
          float near = smoothstep(1.5, 9.0, d);
          float below = smoothstep(9.0, 4.0, cameraPosition.y);
          gl_FragColor = vec4(cCol * k * fall * near * cK * below * exp(-d * 0.004), 1.0);
        }`,
    });
    this.cones = new THREE.InstancedMesh(cg, cm, Streetlights.NC);
    this.cones.frustumCulled = false;
    this.cones.renderOrder = 2;
    this.halos = new GlowPoints(2 * (Streetlights.N + Streetlights.NFAR), 1);
    this.halos.renderOrder = 3;
    this.add(this.poles, this.lenses, this.cones, this.halos);
  }

  update(camU: number, lampCol: THREE.Color, offU: number, coneK: number) {
    const P = ROAD.lampP;
    const k0 = Math.floor((camU - 30) / P);
    const m = new THREE.Matrix4();
    let nc = 0, nh = 0;
    for (let i = 0; i < Streetlights.N; i++) {
      const u = (k0 + i) * P;
      m.makeTranslation(0, 0, -u);
      this.poles.setMatrixAt(i, m);
      this.lenses.setMatrixAt(i, m);
      if (nc < Streetlights.NC && u > camU - 30) this.cones.setMatrixAt(nc++, m);
    }
    this.cones.count = nc;
    this.poles.instanceMatrix.needsUpdate = true;
    this.lenses.instanceMatrix.needsUpdate = true;
    this.cones.instanceMatrix.needsUpdate = true;
    this.lensMat.uniforms.col!.value.copy(lampCol).multiplyScalar(0.3);
    this.coneU.cCol.value.copy(lampCol).multiplyScalar(0.0011);
    this.coneU.cK.value = coneK;
    for (let i = 0; i < Streetlights.N + Streetlights.NFAR; i++) {
      const u = (k0 + i) * P;
      const on = u >= offU ? 1 : 0;
      for (const s of [-1, 1]) {
        const d = Math.abs(u - camU);
        this.halos.set(nh++, s * ROAD.lampArm, ROAD.lampH - 0.25, -u, lampCol, 0.016 * on * (1 + d / 500), 1.6 + d * 0.004);
      }
    }
    this.halos.commit(nh);
    // lamps switched off at dawn
    this.lensMat.uniforms.col!.value.multiplyScalar(1);
  }
}

// ------------------------------------------------------------------------------------------- gantries

function signCanvas(lines: { text: string; sub?: string; arrow?: 'up' | 'right' | 'down'; exit?: string }[], w = 2048, h = 640) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  const n = lines.length;
  for (let i = 0; i < n; i++) {
    const L = lines[i]!;
    const x0 = (i * w) / n, cw = w / n;
    // green retroreflective panel with a white border
    c.fillStyle = '#0d5a33'; c.fillRect(x0 + 12, 12, cw - 24, h - 24);
    c.strokeStyle = '#e8efe9'; c.lineWidth = 10; c.strokeRect(x0 + 30, 30, cw - 60, h - 60);
    c.fillStyle = '#eef3ef';
    if (L.exit) {
      c.fillStyle = '#f4d23a'; c.fillRect(x0 + cw - 300, 50, 240, 90);
      c.fillStyle = '#111'; c.font = font(F.archivo(87, 900), 64); c.textAlign = 'center'; c.fillText(L.exit, x0 + cw - 180, 118);
      c.fillStyle = '#eef3ef';
    }
    c.textAlign = 'left';
    c.font = font(F.archivo(100, 700), 150);
    c.fillText(L.text, x0 + 80, 300);
    if (L.sub) { c.font = font(F.archivo(100, 500), 110); c.fillText(L.sub, x0 + 80, 450); }
    // arrow
    const ax = x0 + cw - 190, ay = h - 190;
    c.save(); c.translate(ax, ay);
    c.rotate(L.arrow === 'right' ? Math.PI / 4 : L.arrow === 'down' ? Math.PI : 0);
    c.beginPath(); c.moveTo(0, -95); c.lineTo(62, -25); c.lineTo(20, -25); c.lineTo(20, 95); c.lineTo(-20, 95); c.lineTo(-20, -25); c.lineTo(-62, -25); c.closePath();
    c.fill(); c.restore();
  }
  return cv;
}

export class Gantry extends THREE.Group {
  signMat: THREE.ShaderMaterial;
  lcs: GlowPoints;
  constructor(signs: Parameters<typeof signCanvas>[0], steel: THREE.ShaderMaterial) {
    super();
    const span0 = -0.6, span1 = ROAD.rail + 1.0, top = 8.6, bot = 7.2, depth = 1.0;
    const parts: THREE.BufferGeometry[] = [];
    // legs (two posts each side) and the box truss
    for (const x of [span0, span1]) for (const z of [-depth / 2, depth / 2]) parts.push(rod(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, top + 0.2, z), 0.17, 0.15, 10));
    for (const x of [span0, span1]) for (let y = 1.2; y < top; y += 1.6) parts.push(boxAt(0.08, 0.08, depth, x, y, 0));
    for (const y of [bot, top]) for (const z of [-depth / 2, depth / 2]) parts.push(rod(new THREE.Vector3(span0, y, z), new THREE.Vector3(span1, y, z), 0.09, 0.09, 8));
    const nb = 12;
    for (let i = 0; i < nb; i++) {
      const x0 = span0 + ((span1 - span0) * i) / nb, x1 = span0 + ((span1 - span0) * (i + 1)) / nb;
      for (const z of [-depth / 2, depth / 2]) parts.push(rod(new THREE.Vector3(x0, i % 2 ? bot : top, z), new THREE.Vector3(x1, i % 2 ? top : bot, z), 0.035, 0.035, 5));
      parts.push(rod(new THREE.Vector3(x0, top, -depth / 2), new THREE.Vector3(x0, top, depth / 2), 0.03, 0.03, 4));
    }
    // catwalk
    parts.push(boxAt(span1 - span0, 0.05, 0.8, (span0 + span1) / 2, bot - 0.6, 0.9));
    const truss = new THREE.Mesh(merge(parts), steel);
    this.add(truss);
    // the sign panels (retroreflective, lit from the catwalk lights)
    const cv = signCanvas(signs);
    const tex = canvasTex(cv, { aniso: 8 });
    this.signMat = new THREE.ShaderMaterial({
      uniforms: { ...HU, map: { value: tex }, lightK: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: HW_GLSL + /* glsl */ `uniform sampler2D map; uniform float lightK; varying vec2 vUv; varying vec3 vW;
        void main(){
          vec3 a = texture2D(map, vUv).rgb;
          // lit from below by the sign lights: brighter at the bottom edge
          float lit = lightK * (0.55 + 0.45 * smoothstep(0.9, 0.0, vUv.y));
          vec3 spec;
          vec3 diff = hwLight(vW, vec3(0.0, 0.0, 1.0), normalize(cameraPosition - vW), 0.6, 0.0, spec);
          vec3 c = a * (diff * 0.6 + vec3(0.9, 0.95, 1.0) * 0.16 * lit) + a * hwHead(vW, vec3(0.0, 0.0, 1.0)) * 4.0;
          gl_FragColor = vec4(hwFog(c, vW, cameraPosition), 1.0);
        }`,
    });
    const sw = 12.5, sh = sw * (cv.height / cv.width);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), this.signMat);
    panel.position.set(1.5 + sw / 2, bot + 0.1 - sh / 2 + 1.55, depth / 2 + 0.12);
    this.add(panel);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), litMat({ color: C('#8f979f', 0.3), rough: 0.6, metal: 0.5 }));
    back.position.copy(panel.position); back.position.z -= 0.06; back.rotation.y = Math.PI;
    this.add(back);
    // lane control signals over each lane (green down arrows) — small glows
    this.lcs = new GlowPoints(12, 1);
    for (let i = 0; i < 3; i++) this.lcs.set(i, ROAD.laneX(i), bot - 0.55, depth / 2 + 0.1, C('#4dff9a'), 0.9, 0.35);
    for (let i = 3; i < 12; i++) this.lcs.hide(i);
    this.lcs.commit();
    this.add(this.lcs);
  }
}

// ------------------------------------------------------------------------------------------- traffic

/** A low-poly saloon: extruded side profile, cabin tapered, wheels; lights are separate glows. */
export function carGeometry() {
  const prof: [number, number][] = [
    [0.0, 0.32], [0.02, 0.62], [0.18, 0.9], [0.95, 0.98], [1.55, 1.38], [2.75, 1.42], [3.5, 1.0], [4.45, 0.84], [4.7, 0.6], [4.68, 0.32],
  ];
  const shape = new THREE.Shape();
  prof.forEach(([x, y], i) => (i ? shape.lineTo(x - 2.35, y) : shape.moveTo(x - 2.35, y)));
  shape.lineTo(prof[0]![0] - 2.35, prof[0]![1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1.7, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -0.85);
  // taper the cabin
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    const k = 1 - 0.2 * Math.min(1, Math.max(0, (y - 0.95) / 0.45));
    p.setZ(i, z * k);
  }
  g.rotateY(Math.PI / 2); // length along z, nose toward -z
  g.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [g];
  for (const z of [-1.45, 1.35]) for (const x of [-0.82, 0.82]) {
    const w = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14);
    w.rotateZ(Math.PI / 2); w.translate(x, 0.33, z);
    parts.push(w);
  }
  return merge(parts);
}

export interface Car { lane: number; dir: 1 | -1; v: number; phase: number; truck: boolean; tint: THREE.Color }

export class Traffic extends THREE.Group {
  bodies: THREE.InstancedMesh;
  lights: GlowPoints;
  trails: Streaks;
  cars: Car[] = [];
  static L = 900; // stream loop length (m)

  constructor() {
    super();
    const r = mulberry32(77);
    for (let i = 0; i < 26; i++) {
      const dir = i < 16 ? -1 : 1; // -1: oncoming
      this.cars.push({
        lane: Math.floor(r() * 3), dir, v: dir < 0 ? 27 + r() * 8 : 21 + r() * 5, phase: r() * Traffic.L,
        truck: dir > 0 && r() < 0.2, tint: C(['#1a1d24', '#3a3f47', '#0e1a2e', '#4a1515', '#d8d8dc', '#2b2b2b'][Math.floor(r() * 6)]!, 0.5),
      });
    }
    const paint = litMat({ color: C('#ffffff'), rough: 0.25, metal: 0.4, spec: 1.2 });
    this.bodies = new THREE.InstancedMesh(carGeometry(), paint, this.cars.length);
    this.bodies.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cars.length * 3), 3);
    this.cars.forEach((c, i) => this.bodies.setColorAt(i, c.tint));
    this.bodies.frustumCulled = false;
    this.lights = new GlowPoints(this.cars.length * 6, 1);
    this.trails = new Streaks(this.cars.length * 4);
    this.add(this.bodies, this.lights, this.trails);
  }

  /** Road coordinate of car i at t (relative streams wrap far ahead of the camera). */
  carU(c: Car, t: number, camU: number) {
    const raw = c.phase + c.dir * c.v * t * (c.dir < 0 ? 1 : 1);
    const rel = (((raw - camU + 60) % Traffic.L) + Traffic.L) % Traffic.L - 60;
    return camU + rel;
  }

  update(t: number, camU: number, camSpeed: number, trailK: number) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const white = C('#fff4e6'), red = C('#ff1a10'), amber = C('#ff9a2a');
    let nl = 0, nt = 0;
    const dt = 0.045; // trail exposure (s)
    this.cars.forEach((c, i) => {
      const u = this.carU(c, t, camU);
      const x = (c.dir < 0 ? -1 : 1) * ROAD.laneX(c.lane);
      const len = c.truck ? 2.4 : 1, hgt = c.truck ? 2.4 : 1;
      p.set(x, 0, -u);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.dir < 0 ? Math.PI : 0);
      s.set(c.truck ? 1.35 : 1, hgt, len);
      m.compose(p, q, s);
      this.bodies.setMatrixAt(i, m);
      const d = Math.abs(u - camU);
      const fade = 1 / (1 + d / 120) / (1 + Math.max(0, d - 300) / 100);
      const front = -u - c.dir * 2.35 * len; // world z of the nose
      const rear = -u + c.dir * 2.35 * len;
      // relative motion for the trails (what the camera sees move during the exposure)
      const rel = (c.dir * c.v - camSpeed) * dt;
      for (const sx of [-0.68, 0.68]) {
        const hx = x + sx * (c.truck ? 1.25 : 1);
        if (c.dir < 0) {
          // oncoming: headlights toward us
          this.lights.set(nl++, hx, 0.68, front, white, 1.1 * fade, 0.45);
          this.lights.set(nl++, hx, 0.62, rear, red, 0.25 * fade, 0.3);
          if (trailK > 0 && nt < this.trails.cap) this.trails.set(nt++, { x: hx, y: 0.68, z: front + rel }, { x: hx, y: 0.68, z: front }, white, 0.9 * trailK * fade, 0.09);
        } else {
          this.lights.set(nl++, hx, c.truck ? 1.0 : 0.75, rear, red, 1.4 * fade, 0.38);
          if (c.truck) this.lights.set(nl++, hx * 1.02, 3.2, rear, amber, 0.5 * fade, 0.18);
          this.lights.set(nl++, hx, 0.66, front, white, 0.8 * fade, 0.4);
          if (trailK > 0 && nt < this.trails.cap) this.trails.set(nt++, { x: hx, y: c.truck ? 1.0 : 0.75, z: rear + rel }, { x: hx, y: c.truck ? 1.0 : 0.75, z: rear }, red, 0.8 * trailK * fade, 0.08);
        }
      }
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    for (let i = nl; i < this.lights.n; i++) this.lights.hide(i);
    this.lights.commit();
    this.trails.commit(nt);
  }
}
