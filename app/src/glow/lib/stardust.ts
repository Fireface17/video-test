// People of stardust: a realistic body (lib/people.ts) drawn as tens of thousands of tiny stars sampled over
// its skin, so a figure reads as a real person — shoulders, hair, hands, the line of the back — made of
// light, with a few brighter stars in the dust, a slow shimmer, and dust shed from its edges as it moves.
//
// A figure is driven by the same 13 star joints as the constellation figures (lib/stars.ts `starJoints`), so
// any pose pipeline that produces joints can draw stardust people: every particle belongs to one of ten rigid
// segments (head, torso, upper/lower arms, thighs, shins) and is carried from the body's rest pose by that
// segment's swing. The segment matrices of every figure in a frame go into one float texture; one instanced
// draw per body kind does the rest on the GPU, with fewer stars (each brighter) for far figures.
import * as THREE from 'three';
import { SCALE } from '../../engine/gl';
import { mulberry32 } from '../../engine/util';
import type { RealFigure } from './people';
import { GlowPoints } from './points';
import { starJoints } from './stars';

const NSEG = 10;
/** Segment ends as star-joint indices (lib/stars STAR_JOINTS); -1 / -2 are the hip joints, derived from the torso. */
const SEG: [number, number][] = [[1, 0], [8, 1], [2, 4], [4, 6], [3, 5], [5, 7], [-1, 9], [9, 11], [-2, 10], [10, 12]];
const COLS = 34; // texels per figure: 10 segments × 3 rows, colour, look, second colour, pelvis

function segOf(name: string) {
  const n = name.replace(/^mixamorig:?/, '');
  if (/^(Head|LeftEye|RightEye)/.test(n)) return 0;
  for (const [side, o] of [['Left', 0], ['Right', 2]] as const) {
    if (n === `${side}Arm`) return 2 + o;
    if (n === `${side}ForeArm` || n.startsWith(`${side}Hand`)) return 3 + o;
    if (n === `${side}UpLeg`) return 6 + o;
    if (n === `${side}Leg` || n.startsWith(`${side}Foot`) || n.startsWith(`${side}Toe`)) return 7 + o;
  }
  return 1;
}

/** Torso basis from joints: y pelvis → neck, x toward the body's left shoulder, z = front. */
function torsoBasis(j: THREE.Vector3[], out: THREE.Matrix3) {
  const y = _a.subVectors(j[1]!, j[8]!).normalize();
  const x = _b.subVectors(j[2]!, j[3]!);
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = _c.crossVectors(x, y);
  return out.set(x.x, y.x, z.x, x.y, y.y, z.y, x.z, y.z, z.z);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/** One body kind's cloud of stars in its rest pose, with the segment each star rides on. */
export class StardustBody {
  geometry: THREE.BufferGeometry;
  restJ: THREE.Vector3[];
  hips: [THREE.Vector3, THREE.Vector3];
  restBasisT = new THREE.Matrix3();
  torso: number;
  restA: THREE.Vector3[] = [];
  restDir: THREE.Vector3[] = [];

  /** `fig` should be a fresh figure (rest pose); it is moved to the origin while sampling. */
  constructor(fig: RealFigure, public n = 16000, seed = 1) {
    fig.position.set(0, 0, 0);
    fig.quaternion.identity();
    fig.scale.setScalar(1);
    fig.updateMatrixWorld(true);
    this.restJ = starJoints(fig).map((v) => v.clone());
    this.hips = [fig.bone('LeftUpLeg').getWorldPosition(new THREE.Vector3()), fig.bone('RightUpLeg').getWorldPosition(new THREE.Vector3())];
    this.restBasisT.copy(torsoBasis(this.restJ, new THREE.Matrix3())).transpose();
    this.torso = this.restJ[1]!.distanceTo(this.restJ[8]!);
    for (const [a, b] of SEG) {
      const A = this.joint(this.restJ, a), B = this.restJ[b]!;
      this.restA.push(A.clone());
      this.restDir.push(B.clone().sub(A).normalize());
    }

    // the skin in the rest pose (CPU skinning, figure space), triangles with their areas
    const tris: { P: Float32Array; N: Float32Array; S: Uint8Array; idx: ArrayLike<number> }[] = [];
    const areas: number[] = [];
    let total = 0;
    const inv = new THREE.Matrix4().copy(fig.matrixWorld).invert();
    for (const m of fig.meshes) {
      const src = m.geometry;
      const pos = src.attributes.position as THREE.BufferAttribute, nor = src.attributes.normal as THREE.BufferAttribute;
      const si = src.attributes.skinIndex as THREE.BufferAttribute, sw = src.attributes.skinWeight as THREE.BufferAttribute;
      m.skeleton.update();
      const bm = m.skeleton.boneMatrices!;
      const toFig = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld).multiply(m.bindMatrixInverse);
      const segOfBone = m.skeleton.bones.map((b) => segOf(b.name));
      const P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3), S = new Uint8Array(pos.count);
      const M = new THREE.Matrix4(), K = new THREE.Matrix4(), v = new THREE.Vector3(), nv = new THREE.Vector3(), nm = new THREE.Matrix3();
      for (let i = 0; i < pos.count; i++) {
        K.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        let best = 0, bw = -1;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          if (w === 0) continue;
          const bi = si.getComponent(i, k);
          if (w > bw) { bw = w; best = bi; }
          M.fromArray(bm, bi * 16);
          for (let e = 0; e < 16; e++) K.elements[e]! += w * M.elements[e]!;
        }
        K.multiply(m.bindMatrix).premultiply(toFig);
        v.fromBufferAttribute(pos, i).applyMatrix4(K);
        nv.fromBufferAttribute(nor, i).applyMatrix3(nm.getNormalMatrix(K)).normalize();
        P.set([v.x, v.y, v.z], i * 3);
        N.set([nv.x, nv.y, nv.z], i * 3);
        S[i] = segOfBone[best]!;
      }
      const idx = src.index ? src.index.array : Array.from({ length: pos.count }, (_, i) => i);
      const t = { P, N, S, idx };
      tris.push(t);
      for (let f = 0; f + 2 < idx.length; f += 3) {
        const i0 = idx[f]! * 3, i1 = idx[f + 1]! * 3, i2 = idx[f + 2]! * 3;
        _a.set(P[i1]! - P[i0]!, P[i1 + 1]! - P[i0 + 1]!, P[i1 + 2]! - P[i0 + 2]!);
        _b.set(P[i2]! - P[i0]!, P[i2 + 1]! - P[i0 + 1]!, P[i2 + 2]! - P[i0 + 2]!);
        total += _c.crossVectors(_a, _b).length() * 0.5;
        areas.push(total);
      }
    }
    const meshOf: number[] = [];
    tris.forEach((t, mi) => { for (let f = 0; f + 2 < t.idx.length; f += 3) meshOf.push(mi); });
    const triStart: number[] = [];
    let acc = 0;
    tris.forEach((t) => { triStart.push(acc); acc += Math.floor(t.idx.length / 3); });

    // sample: area-weighted points on the skin, a third pushed a little inside (the body has some volume)
    const r = mulberry32(seed * 7919 + 13);
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), aP = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = r() * total;
      let lo = 0, hi = areas.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (areas[mid]! < x) lo = mid + 1; else hi = mid; }
      const mi = meshOf[lo]!, t = tris[mi]!, f = (lo - triStart[mi]!) * 3;
      const ia = t.idx[f]!, ib = t.idx[f + 1]!, ic = t.idx[f + 2]!;
      const s1 = Math.sqrt(r()), u = 1 - s1, v = r() * s1, w = 1 - u - v;
      const seg = u >= v && u >= w ? t.S[ia]! : v >= w ? t.S[ib]! : t.S[ic]!;
      const nx = t.N[ia * 3]! * u + t.N[ib * 3]! * v + t.N[ic * 3]! * w;
      const ny = t.N[ia * 3 + 1]! * u + t.N[ib * 3 + 1]! * v + t.N[ic * 3 + 1]! * w;
      const nz = t.N[ia * 3 + 2]! * u + t.N[ib * 3 + 2]! * v + t.N[ic * 3 + 2]! * w;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const depth = r() < 0.33 ? r() * r() * 0.045 : 0;
      for (let k = 0; k < 3; k++) {
        pos[i * 3 + k] = t.P[ia * 3 + k]! * u + t.P[ib * 3 + k]! * v + t.P[ic * 3 + k]! * w - ([nx, ny, nz][k]! / nl) * depth;
      }
      nrm.set([nx / nl, ny / nl, nz / nl], i * 3);
      aP.set([seg, r(), r(), r()], i * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('aP', new THREE.BufferAttribute(aP, 4));
    this.geometry = g;
  }

  /** A joint by index; -1 / -2 are the hip joints, carried rigidly by the torso. */
  private joint(j: THREE.Vector3[], i: number) { return i >= 0 ? j[i]! : this.hips[-1 - i]!; }

  private R = new THREE.Matrix3();
  private Rs = new THREE.Matrix3();
  private Bc = new THREE.Matrix3();
  private q = new THREE.Quaternion();
  private m4 = new THREE.Matrix4();
  private hA = new THREE.Vector3();
  private d = new THREE.Vector3();
  private e = new THREE.Vector3();

  /** Write the 10 segment matrices (3 texels each: rows of [s·R | t]) for posed joints `j` at `o`; returns the scale. */
  segments(j: THREE.Vector3[], out: Float32Array, o: number): number {
    const s = j[1]!.distanceTo(j[8]!) / this.torso;
    const R = this.R.multiplyMatrices(torsoBasis(j, this.Bc), this.restBasisT);
    for (let k = 0; k < NSEG; k++) {
      const [ia, ib] = SEG[k]!;
      let A: THREE.Vector3;
      if (ia < 0) A = this.hA.copy(this.hips[-1 - ia]!).sub(this.restJ[8]!).applyMatrix3(R).multiplyScalar(s).add(j[8]!);
      else A = j[ia]!;
      const A0 = k === 1 ? j[8]! : A;
      let Rk = R;
      if (k !== 1) {
        const db = this.d.copy(this.restDir[k]!).applyMatrix3(R);
        const dc = this.e.subVectors(j[ib]!, A);
        const len = dc.length();
        if (len > 1e-6) {
          this.q.setFromUnitVectors(db.normalize(), dc.divideScalar(len));
          Rk = this.Rs.setFromMatrix4(this.m4.makeRotationFromQuaternion(this.q)).multiply(R);
        }
      }
      // p = A0 + s·Rk·(p_rest − A_rest)
      const Ar = this.restA[k]!, el = Rk.elements; // column-major
      for (let row = 0; row < 3; row++) {
        const r0 = el[row]! * s, r1 = el[row + 3]! * s, r2 = el[row + 6]! * s;
        const t = A0.getComponent(row) - (r0 * Ar.x + r1 * Ar.y + r2 * Ar.z);
        out.set([r0, r1, r2, t], o + (k * 3 + row) * 4);
      }
    }
    return s;
  }
}

export interface DustLook {
  /** Second colour (the dimmer stars, deep in the body); defaults to the main colour. */
  color2?: THREE.Color;
  /** 0..1 reveal: stars fly in from around the body and settle. */
  draw?: number;
  /** 0..1: the body breaks into pieces, each piece pulls together into one star and flies off (up). */
  shatter?: number;
  /** Star size multiplier. */
  size?: number;
  /** Brightness of the constellation stars at the joints (0 = none). */
  joints?: number;
  /** Variation seed (shimmer phase). */
  seed?: number;
}

/** Levels of detail: the share of a body's stars drawn for near, middle and far figures. */
const LEVELS = [1, 0.14, 0.02];

interface Cloud { data: Float32Array; tex: THREE.DataTexture; pts: THREE.Points; mat: THREE.ShaderMaterial; n: number; cap: number }

/**
 * Every stardust figure of a frame: `begin(camera)`, `figure(j, body, color, k, look)` per person, `star()` for
 * extra glints, `end()`. `time` drives the shimmer. Positions are in this object's parent space, like
 * GlowPoints. With a camera, small figures on screen are drawn from fewer (brighter) stars.
 */
export class Stardust extends THREE.Group {
  points: GlowPoints;
  private clouds: Cloud[][] = []; // [body][level]
  private np = 0;
  private cam?: THREE.Camera;
  private camPos = new THREE.Vector3();
  private proj = 1;
  private hv = new THREE.Vector3();
  private ws = new THREE.Vector3();

  /** `size`: star size in world units for a person of normal height; `gain`: brightness per star; `caps`: figures per level. */
  constructor(public bodies: StardustBody[], caps: number | [number, number, number], opts: { size?: number; gain?: number; extras?: number } = {}) {
    super();
    const cap3 = typeof caps === 'number' ? [caps, caps, caps] : caps;
    for (const b of bodies) {
      const row: Cloud[] = [];
      LEVELS.forEach((frac, l) => {
        const cap = cap3[l]!;
        const data = new Float32Array(COLS * Math.max(1, cap) * 4);
        const tex = new THREE.DataTexture(data, COLS, Math.max(1, cap), THREE.RGBAFormat, THREE.FloatType);
        tex.minFilter = tex.magFilter = THREE.NearestFilter;
        tex.needsUpdate = true;
        const g = new THREE.InstancedBufferGeometry();
        for (const k of ['position', 'normal', 'aP']) g.setAttribute(k, b.geometry.getAttribute(k));
        g.setDrawRange(0, Math.max(1, Math.round(b.n * frac)));
        g.instanceCount = 0;
        const mat = dustMaterial(tex, opts.size ?? 0.0105, opts.gain ?? 0.09, frac);
        const pts = new THREE.Points(g, mat);
        pts.frustumCulled = false;
        pts.visible = false;
        this.add(pts);
        row.push({ data, tex, pts, mat, n: 0, cap });
      });
      this.clouds.push(row);
    }
    this.points = new GlowPoints(opts.extras ?? cap3[0]! * 14 + 256, 1);
    this.add(this.points);
  }

  private each(fn: (c: Cloud) => void) { for (const r of this.clouds) for (const c of r) fn(c); }
  set time(t: number) { this.each((c) => (c.mat.uniforms.time!.value = t)); }
  set gain(g: number) { this.each((c) => (c.mat.uniforms.gain!.value = g)); }

  begin(camera?: THREE.Camera) {
    this.each((c) => (c.n = 0));
    this.np = 0;
    this.cam = camera;
    if (camera) {
      camera.updateMatrixWorld();
      this.updateMatrixWorld();
      this.camPos.setFromMatrixPosition(camera.matrixWorld);
      this.proj = (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5]!;
    }
  }

  /** One person from world joints `j` (13, lib/stars order) of body kind `body`, in `color` × `k`. */
  figure(j: THREE.Vector3[], body: number, color: THREE.Color, k: number, look: DustLook = {}) {
    if (k <= 0.002) return;
    const bi = body % this.bodies.length, B = this.bodies[bi]!;
    let level = 0;
    if (this.cam) {
      const s0 = (j[1]!.distanceTo(j[8]!) / B.torso) * this.ws.setFromMatrixScale(this.matrixWorld).x;
      const d = this.hv.copy(j[8]!).applyMatrix4(this.matrixWorld).distanceTo(this.camPos);
      const need = (s0 * 1.75 * this.proj * 540) / Math.max(d, 1e-3) / 520 * (1 + (look.shatter ?? 0) * 2);
      while (level < LEVELS.length - 1 && LEVELS[level + 1]! >= need) level++;
    }
    // a full level passes the figure on to the next, coarser one (drawn with fewer, brighter stars)
    while (level < LEVELS.length - 1 && this.clouds[bi]![level]!.n >= this.clouds[bi]![level]!.cap) level++;
    const C = this.clouds[bi]![level]!;
    if (C.n >= C.cap) return;
    const D = C.data, o = C.n * COLS * 4;
    const s = B.segments(j, D, o);
    const c2 = look.color2 ?? color;
    D.set([color.r * k, color.g * k, color.b * k, look.draw ?? 1], o + 30 * 4);
    D.set([s, look.seed ?? C.n * 0.618, look.size ?? 1, 0], o + 31 * 4);
    D.set([c2.r * k, c2.g * k, c2.b * k, 0], o + 32 * 4);
    D.set([j[8]!.x, j[8]!.y, j[8]!.z, look.shatter ?? 0], o + 33 * 4);
    C.n++;
    const jk = (look.joints ?? 0) * k * Math.min(1, (look.draw ?? 1) * 1.5) * (1 - (look.shatter ?? 0));
    if (jk > 0.003) {
      for (let i = 0; i < 13; i++) {
        const p = j[i]!;
        this.star(p, color, jk, s * 0.05 * (i === 0 ? 1.5 : i === 6 || i === 7 ? 1.3 : 1));
      }
    }
  }

  /** An extra glint (a flash where hands meet, a joint star). */
  star(p: THREE.Vector3Like, c: THREE.Color, k = 1, size = 1) {
    if (this.np >= this.points.n || k <= 0.002) return;
    this.points.set(this.np++, p.x, p.y, p.z, c, k, size);
  }

  end() {
    this.each((c) => {
      (c.pts.geometry as THREE.InstancedBufferGeometry).instanceCount = c.n;
      c.pts.visible = c.n > 0;
      c.tex.needsUpdate = true;
    });
    this.points.commit(this.np);
  }
}

function dustMaterial(tex: THREE.DataTexture, size: number, gain: number, frac: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { tFig: { value: tex }, time: { value: 0 }, size: { value: size }, gain: { value: gain }, frac: { value: frac }, pxScale: { value: (1080 * SCALE) / 2 } },
    vertexShader: /* glsl */ `
      attribute vec4 aP; // segment, rank, r2, r3
      uniform sampler2D tFig; uniform float time, size, gain, frac, pxScale;
      varying vec3 vC;
      vec3 hash3(vec3 c) { return fract(sin(vec3(dot(c, vec3(12.9898, 78.233, 37.719)), dot(c, vec3(39.346, 11.135, 83.155)), dot(c, vec3(73.156, 52.235, 9.151)))) * 43758.5453); }
      void main() {
        int f = gl_InstanceID, s = int(aP.x + 0.5);
        vec4 C = texelFetch(tFig, ivec2(30, f), 0), D = texelFetch(tFig, ivec2(31, f), 0);
        vec4 E = texelFetch(tFig, ivec2(32, f), 0), H = texelFetch(tFig, ivec2(33, f), 0);
        // (sc is in this object's units; ws is how big those are in the world, e.g. inside a scaled group)
        float ws = length(modelMatrix[0].xyz);
        float sc = D.x, seed = D.y, br = H.w;
        // fewer, brighter stars for small figures on screen (this level holds the first frac of the stars)
        vec4 hv = modelViewMatrix * vec4(H.xyz, 1.0);
        float figPx = sc * ws * 1.75 * projectionMatrix[1][1] * pxScale / max(-hv.z, 1e-3);
        float eff = min(clamp(figPx / 520.0 * (1.0 + 2.0 * br), 0.004, 1.0), frac);
        float reveal = smoothstep(aP.y * 0.8, aP.y * 0.8 + 0.2, C.a);
        if (aP.y * frac > eff || reveal <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vC = vec3(0.0); return; }
        vec4 r0 = texelFetch(tFig, ivec2(s * 3, f), 0), r1 = texelFetch(tFig, ivec2(s * 3 + 1, f), 0), r2 = texelFetch(tFig, ivec2(s * 3 + 2, f), 0);
        // a slow shimmer, and dust leaving the body's edges
        vec3 ph = aP.yzw * 6.2831 + seed;
        vec3 rp = position + vec3(sin(time * 1.3 + ph.x * 3.0), sin(time * 1.1 + ph.y * 3.0), sin(time * 1.7 + ph.z * 3.0)) * 0.005;
        float shed = step(0.94, aP.z);
        float u = fract(time * 0.3 + aP.w * 7.0 + seed);
        rp += (normal * 0.8 + vec3(0.0, 0.45, 0.0)) * shed * u * 0.3;
        float glow = 1.0;
        if (br > 0.0) {
          // pieces of ~15 cm: each pulls together into one star and flies off, up and out
          vec3 cell = floor(position * 6.5);
          vec3 h = hash3(cell + seed);
          float b1 = clamp((br - h.x * 0.35) / 0.65, 0.0, 1.0);
          vec3 cc = (cell + 0.5) / 6.5;
          rp = mix(rp, cc, smoothstep(0.05, 0.55, b1));
          rp += normalize(h - 0.5 + vec3(0.0, 0.7, 0.0)) * (b1 * b1 * 3.2 + b1 * 0.25);
          glow = 1.0 + 1.5 * smoothstep(0.2, 0.7, b1);
        }
        vec3 p = vec3(dot(r0, vec4(rp, 1.0)), dot(r1, vec4(rp, 1.0)), dot(r2, vec4(rp, 1.0)));
        // stars fly in from around the body while it is revealed
        vec3 sd = vec3(aP.z - 0.5, aP.w - 0.5, fract(aP.y * 13.7) - 0.5);
        p += normalize(sd + 1e-4) * sc * 1.4 * (1.0 - reveal) * (1.0 - reveal);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        float big = step(0.965, aP.w), haze = step(aP.z, 0.08) * (1.0 - step(0.001, br));
        // the outline glows (stars on the skin seen edge-on), the inside stays translucent
        vec3 nw = vec3(dot(r0.xyz, normal), dot(r1.xyz, normal), dot(r2.xyz, normal));
        vec3 nv = normalize(mat3(modelViewMatrix) * nw + 1e-6);
        float fres = mix(1.0 - abs(dot(nv, normalize(-mv.xyz))), 0.7, smoothstep(0.0, 0.3, br));
        float ps = size * pow(sc * ws, 0.6) * D.z * (0.55 + 0.9 * aP.z) * (1.0 + 1.6 * big) * (1.0 + 3.5 * haze);
        float px = ps * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
        float m = clamp(px, 1.5, 96.0 * pxScale / 540.0);
        float tw = mix(1.0, 0.35 + 0.65 * (0.5 + 0.5 * sin(time * (2.5 + 5.0 * aP.z) + aP.w * 40.0)), step(0.55, aP.w));
        vec3 c = mix(E.rgb, C.rgb, smoothstep(0.15, 0.85, aP.z));
        c = mix(c, (C.rgb + vec3(dot(C.rgb, vec3(0.3333)))) * 0.9, big);
        c *= (0.5 + 0.5 * aP.w) * (1.0 + 2.5 * big) * mix(tw, 0.07, haze) * mix(0.4, 1.9, fres * fres) * reveal * (1.0 - shed * u) * glow * gain / eff;
        c *= min(1.0, (px * px) / (m * m)) * smoothstep(0.25, 0.9, d);
        vC = c;
        gl_PointSize = m;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vC * (exp(-r2 * 5.0) + 0.7 * exp(-r2 * 28.0)), 1.0);
      }`,
  });
}
