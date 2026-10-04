// Meshes of the night city's buildings and small things, all instanced:
// - building tiers (boxes whose facades are drawn by FACADE_GLSL),
// - rings: parapets and cornices around roof edges (a profile swept round the box, mitred at the corners),
// - kits: any small thing built from boxes / cylinders / cones (water towers, AC units, chimneys, antennas,
//   fire escapes, lamp posts, hydrants, cars…) with per-vertex materials and per-instance position, yaw,
//   scale, colour and light level.
import * as THREE from 'three';
import { CITY_GLSL, FACADE_GLSL, type CityUniforms } from './city-glsl';

// ---------------------------------------------------------------- merging

/**
 * Expand an instanced geometry into one static geometry (every instance attribute repeated per vertex, same
 * names, so the same shaders work). SwiftShader (the cloud renderer) handles instanced draws instance by
 * instance, which is slow for thousands of small instances; merged buffers are drawn in one go.
 */
export function mergeInstanced(g: THREE.InstancedBufferGeometry): THREE.BufferGeometry {
  const n = g.instanceCount;
  const out = new THREE.BufferGeometry();
  const base = g.index;
  const vCount = g.attributes.position!.count;
  for (const [name, attr] of Object.entries(g.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const isInst = (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute;
    const sz = a.itemSize, src = a.array as Float32Array;
    const dst = new Float32Array(n * vCount * sz);
    if (isInst) {
      for (let i = 0; i < n; i++) {
        const off = i * vCount * sz;
        for (let v = 0; v < vCount; v++) for (let c = 0; c < sz; c++) dst[off + v * sz + c] = src[i * sz + c]!;
      }
    } else {
      for (let i = 0; i < n; i++) dst.set(src.subarray(0, vCount * sz), i * vCount * sz);
    }
    const ba = new THREE.BufferAttribute(dst, sz);
    ba.onUpload(function (this: THREE.BufferAttribute) { (this as { array: unknown }).array = new Float32Array(0); });
    out.setAttribute(name, ba);
  }
  if (base) {
    const bi = base.array, m = bi.length;
    const idx = n * vCount > 65535 ? new Uint32Array(n * m) : new Uint16Array(n * m);
    for (let i = 0; i < n; i++) for (let k = 0; k < m; k++) idx[i * m + k] = bi[k]! + i * vCount;
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  out.boundingSphere = g.boundingSphere?.clone() ?? null;
  return out;
}

// ---------------------------------------------------------------- buildings

/** A box without its bottom: x, z in [-0.5, 0.5], y in [0, 1]. */
export function boxGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  // drop the bottom face (group 3: -y)
  const idx = g.index!.array as Uint16Array, keep: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i]!, ny = (g.attributes.normal as THREE.BufferAttribute).getY(a);
    if (ny > -0.5) keep.push(idx[i]!, idx[i + 1]!, idx[i + 2]!);
  }
  g.setIndex(keep);
  g.clearGroups();
  g.deleteAttribute('uv');
  return g;
}

export function buildingMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      #ifdef USE_INSTANCING
        // the old City API: an InstancedMesh of a unit box (y 0..1) with aB = (seed, density, warmth, type 0 home / 1 office / 2-3 plant), aTop
        attribute vec4 aB; attribute float aTop;
      #else
        attribute vec3 aPos; attribute vec3 aSize; attribute vec4 aF0, aF1, aF2, aF3;
      #endif
      varying vec3 vW, vN, vC, vS; varying vec4 vF0, vF1, vF2, vF3;
      void main() {
        #ifdef USE_INSTANCING
          vec3 P0 = instanceMatrix[3].xyz;
          vec3 SZ = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          float office = step(0.5, aB.w) * step(aB.w, 1.5), plant = step(1.5, aB.w);
          vF0 = vec4(aB.x, plant > 0.5 ? 7.0 : office > 0.5 ? 2.0 : 1.0, office > 0.5 ? 4.0 : 3.15, office > 0.5 ? 8.0 : 4.6);
          vF1 = office > 0.5 ? vec4(1.52, 1.0, 0.72, 0.28) : vec4(3.2, 0.3, 0.56, 0.25);
          vF2 = vec4(office > 0.5 ? vec3(0.025, 0.03, 0.036) : mix(vec3(0.44, 0.34, 0.22), vec3(0.3, 0.12, 0.08), aB.z), clamp(aB.y * 1.1, 0.0, 1.0));
          vF3 = vec4(15.0, aTop, office > 0.5 ? 4.0 : 8.0, aB.z);
        #else
          vec3 P0 = aPos, SZ = aSize;
          vF0 = aF0; vF1 = aF1; vF2 = aF2; vF3 = aF3;
        #endif
        vec4 w = modelMatrix * vec4(P0 + position * SZ, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vC = (modelMatrix * vec4(P0, 1.0)).xyz; vS = SZ;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      ${FACADE_GLSL}
      uniform vec4 uOpenA[6]; uniform vec4 uOpenB[6];
      varying vec3 vW, vN, vC, vS; varying vec4 vF0, vF1, vF2, vF3;
      void main() {
        vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
        vec3 c; float p = 1.0;
        c = N * 0.1 + 0.1;
        for (int dbg = 0; dbg < (uDebug > 0.5 ? 0 : 1); dbg++) {
        p = power(vW.xz);
        if (N.y > 0.5) c = roofShade(vW, vC, vS, vF0, vF2, p);
        else if (vF0.y > 6.5) {
          // bulkheads and mechanical floors: painted brick / louvres, a lit door on some
          vec3 T = vec3(N.z, 0.0, -N.x);
          float u = dot(vW.xz - vC.xz, T.xz), v = vW.y - vC.y;
          vec3 alb = vF2.rgb * (0.8 + 0.2 * vnoise(vec2(u, v) * 0.8 + vF0.x));
          float louvre = step(0.5, vF1.x) * step(0.5, fract(v * 3.0)) * 0.5;
          alb *= 1.0 - louvre;
          vec3 L = ambient(N, p) + streetLight(vW.xz + N.xz * 2.0, vW.y, p) * 0.4 + sunLight(vW, N) + peopleGlow(vW, N);
          c = alb * L;
          float doorFace = step(0.5, vF1.y) * step(abs(N.z * 2.0 + N.x - (h11(vF0.x) < 0.5 ? 1.0 : -1.0) * 2.0), 0.1);
          float door = doorFace * step(abs(u), 0.45) * step(v, 2.1);
          float bulb = doorFace * exp(-(u * u + (v - 2.35) * (v - 2.35)) * 30.0);
          float lit = step(0.35, p) * step(0.3, h11(vF0.x * 3.0));
          c = mix(c, vec3(0.03, 0.028, 0.025) + vec3(1.0, 0.7, 0.4) * 0.05 * lit, door);
          c += vec3(1.0, 0.75, 0.45) * (bulb * 2.5 + doorFace * 0.04 * exp(-max(v - 2.3, 0.0) - abs(u) * 0.5)) * lit;
        } else {
          float wa;
          c = facade(vW, N, V, vC, vS, vF0, vF1, vF2, vF3, p, wa);
        }
        }
        c = cityFog(c, vW, p);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export interface BInst { x: number; y0: number; z: number; w: number; h: number; d: number; f0: number[]; f1: number[]; f2: number[]; f3: number[] }

/** A batch of building boxes around an origin (one draw call). */
export function buildingBatch(list: BInst[], mat: THREE.Material, origin: THREE.Vector3) {
  const base = boxGeometry();
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.attributes.position!);
  g.setAttribute('normal', base.attributes.normal!);
  const n = list.length;
  const aPos = new Float32Array(n * 3), aSize = new Float32Array(n * 3), f0 = new Float32Array(n * 4), f1 = new Float32Array(n * 4), f2 = new Float32Array(n * 4), f3 = new Float32Array(n * 4);
  let r2 = 0;
  list.forEach((b, i) => {
    aPos.set([b.x - origin.x, b.y0, b.z - origin.z], i * 3);
    aSize.set([b.w, b.h, b.d], i * 3);
    f0.set(b.f0, i * 4); f1.set(b.f1, i * 4); f2.set(b.f2, i * 4); f3.set(b.f3, i * 4);
    r2 = Math.max(r2, (b.x - origin.x) ** 2 + (b.z - origin.z) ** 2 + (b.w * b.w + b.d * b.d) / 4 + 2 * Math.hypot(b.x - origin.x, b.z - origin.z) * Math.hypot(b.w, b.d) / 2);
  });
  g.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  g.setAttribute('aSize', new THREE.InstancedBufferAttribute(aSize, 3));
  g.setAttribute('aF0', new THREE.InstancedBufferAttribute(f0, 4));
  g.setAttribute('aF1', new THREE.InstancedBufferAttribute(f1, 4));
  g.setAttribute('aF2', new THREE.InstancedBufferAttribute(f2, 4));
  g.setAttribute('aF3', new THREE.InstancedBufferAttribute(f3, 4));
  g.instanceCount = n;
  const hMax = list.reduce((m, b) => Math.max(m, b.y0 + b.h), 0);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, hMax / 2, 0), Math.sqrt(r2) + hMax / 2 + 1);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-1e4, 0, -1e4), new THREE.Vector3(1e4, hMax, 1e4));
  const m = new THREE.Mesh(MERGE ? mergeInstanced(g) : g, mat);
  m.position.copy(origin);
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

/** merge instances into static buffers (see mergeInstanced) */
export const MERGE = true;

/** A depth-only copy of a building batch drawn first, so each pixel of the facades is shaded once. */
export function depthPrepass(m: THREE.Mesh, mat: THREE.ShaderMaterial) {
  const d = new THREE.ShaderMaterial({ vertexShader: mat.vertexShader, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0); }', colorWrite: false });
  const pm = new THREE.Mesh(m.geometry, d);
  pm.position.copy(m.position);
  pm.matrixAutoUpdate = false;
  pm.updateMatrix();
  pm.renderOrder = -5;
  return pm;
}

// ---------------------------------------------------------------- rings (parapets, cornices)

/**
 * A profile swept round a box's top edge. `prof`: [y (0..1 of the ring's height), out (in units of the
 * projection), outM (metres)] from the bottom of the outer face to its top; then a cap inward to `inner` metres
 * inside the wall line, and (if `inside`) the inner face down.
 */
export function ringGeometry(prof: [number, number, number][], inner: number, inside: boolean) {
  const P: number[] = [], Nn: number[] = [], O: number[] = [], Y: number[] = [], idx: number[] = [];
  const sides: [[number, number], [number, number], [number, number]][] = [
    [[-1, 1], [1, 1], [0, 1]], [[1, 1], [1, -1], [1, 0]], [[1, -1], [-1, -1], [0, -1]], [[-1, -1], [-1, 1], [-1, 0]],
  ];
  const quad = (a: [number, number], b: [number, number], y0: number, o0: [number, number], y1: number, o1: [number, number], n: [number, number, number], py0: number, py1: number) => {
    const k = P.length / 3;
    P.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    O.push(o0[0], o0[1], o0[0], o0[1], o1[0], o1[1], o1[0], o1[1]);
    Y.push(py0, py0, py1, py1);
    for (let i = 0; i < 4; i++) Nn.push(n[0], n[1], n[2]);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
  };
  const ref = 0.8; // a typical projection (m) for the normals' slope
  for (const [a, b, [nx, nz]] of sides) {
    for (let s = 0; s + 1 < prof.length; s++) {
      const [y0, o0, m0] = prof[s]!, [y1, o1, m1] = prof[s + 1]!;
      const dOut = (o1 - o0) * ref + (m1 - m0), dy = (y1 - y0) * 1.2;
      const l = Math.hypot(dOut, dy) || 1;
      quad(a, b, y0, [o0, m0], y1, [o1, m1], [nx * dy / l, -dOut / l, nz * dy / l], y0, y1);
    }
    const [yt, ot, mt] = prof[prof.length - 1]!;
    // the top cap (wound so it faces up)
    quad(a, b, yt, [ot, mt], yt, [0, -inner], [0, 1, 0], 1.0, 1.0);
    if (inside) quad(b, a, yt, [0, -inner], 0, [0, -inner], [-nx, 0, -nz], 1.0, 0.0);
  }
  // fix winding of the top caps: make every triangle face its normal
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('aOff', new THREE.Float32BufferAttribute(O, 2));
  g.setAttribute('aY', new THREE.Float32BufferAttribute(Y, 1));
  g.setIndex(idx);
  return g;
}

export function ringMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec2 aOff; attribute float aY;
      attribute vec4 iPos; attribute vec4 iSize; attribute vec4 iCol;
      varying vec3 vW, vN; varying vec4 vCol; varying float vY; varying vec2 vU;
      void main() {
        // iPos: centre x, y0, centre z, kind; iSize: half x, half z, height, projection
        float off = aOff.x * iSize.w + aOff.y;
        vec3 p = vec3(iPos.x + position.x * (iSize.x + off), iPos.y + position.y * iSize.z, iPos.z + position.z * (iSize.y + off));
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz; vN = normal; vCol = iCol; vY = aY;
        vU = vec2(abs(normal.x) > 0.5 ? p.z : p.x, p.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      varying vec3 vW, vN; varying vec4 vCol; varying float vY; varying vec2 vU;
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float p = power(vW.xz);
        vec3 alb = vCol.rgb;
        // dentils and brackets on cornices, close up
        float px = fwidth(vU.x);
        float dent = vCol.a > 0.5 ? step(0.25, vY) * step(vY, 0.42) * step(0.5, fract(vU.x / 0.32)) * smoothstep(0.2, 0.05, px) : 0.0;
        float brk = vCol.a > 0.5 ? step(0.42, vY) * step(vY, 0.72) * step(0.82, fract(vU.x / 1.1)) * smoothstep(0.4, 0.1, px) : 0.0;
        alb *= 1.0 - 0.45 * dent + 0.25 * brk;
        vec3 L = ambient(N, p) * 1.4 + streetLight(vW.xz + N.xz * 2.0, vW.y, p) * (0.6 + 0.8 * max(-N.y, 0.0)) + sunLight(vW, N) + peopleGlow(vW, N);
        // moonlit rim on the top edge
        L += uMoonCol * 1.2 * smoothstep(0.92, 1.0, vY) * (1.0 - uDawn);
        vec3 c = alb * L;
        c = cityFog(c, vW, p);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export interface RInst { x: number; y0: number; z: number; hx: number; hz: number; h: number; proj: number; col: [number, number, number]; fancy: number }

export function ringBatch(geo: THREE.BufferGeometry, list: RInst[], mat: THREE.Material, origin: THREE.Vector3) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = geo.index;
  for (const k of ['position', 'normal', 'aOff', 'aY']) g.setAttribute(k, geo.attributes[k]!);
  const n = list.length, iPos = new Float32Array(n * 4), iSize = new Float32Array(n * 4), iCol = new Float32Array(n * 4);
  let r = 0, hMax = 0;
  list.forEach((q, i) => {
    iPos.set([q.x - origin.x, q.y0, q.z - origin.z, 0], i * 4);
    iSize.set([q.hx, q.hz, q.h, q.proj], i * 4);
    iCol.set([...q.col, q.fancy], i * 4);
    r = Math.max(r, Math.hypot(q.x - origin.x, q.z - origin.z) + Math.hypot(q.hx, q.hz) + 2);
    hMax = Math.max(hMax, q.y0 + q.h);
  });
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
  g.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 4));
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(iCol, 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, hMax / 2, 0), r + hMax / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(origin);
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

// ---------------------------------------------------------------- kits

/**
 * Per-vertex material mode (aV.a):
 * 0 instance colour × rgb, 1 fixed albedo rgb, 2 emissive rgb × instance light × power, 3 glass,
 * 4 emissive rgb × instance light (no power: car lights), 5 iron bars (cut out), 6 slats (cut out).
 */
export const M = { TINT: 0, ALB: 1, LAMP: 2, GLASS: 3, LIGHT: 4, BARS: 5, SLATS: 6, WOOD: 7 } as const;

/** A unit box (x, z in [-0.5, 0.5], y in [0, 1]) without its bottom face. */
export function boxNoBottom() {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const nor = g.attributes.normal as THREE.BufferAttribute, idx = g.index!.array, keep: number[] = [];
  for (let i = 0; i < idx.length; i += 3) if (nor.getY(idx[i]!) > -0.5) keep.push(idx[i]!, idx[i + 1]!, idx[i + 2]!);
  g.setIndex(keep);
  return g;
}

/** Builds a small mesh from primitives with per-vertex material. */
export class KitBuilder {
  P: number[] = []; N: number[] = []; V: number[] = []; L: number[] = []; I: number[] = [];
  private push(p: THREE.Vector3, n: THREE.Vector3, v: number[], l: THREE.Vector3) {
    this.P.push(p.x, p.y, p.z); this.N.push(n.x, n.y, n.z); this.V.push(...v); this.L.push(l.x, l.y, l.z);
  }
  /** add a three geometry transformed by m with material v = [r, g, b, mode] */
  add(src: THREE.BufferGeometry, m: THREE.Matrix4, v: number[]) {
    const g = src.index ? src.toNonIndexed() : src;
    const pos = g.attributes.position as THREE.BufferAttribute, nor = g.attributes.normal as THREE.BufferAttribute;
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const base = this.P.length / 3;
    const p = new THREE.Vector3(), n = new THREE.Vector3(), l = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      l.fromBufferAttribute(pos, i);
      p.copy(l).applyMatrix4(m);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
      this.push(p, n, v, l);
      this.I.push(base + i);
    }
    return this;
  }
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, v: number[], rotY = 0, rotX = 0, rotZ = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')), new THREE.Vector3(sx, sy, sz));
    return this.add(new THREE.BoxGeometry(1, 1, 1), m, v);
  }
  cyl(cx: number, cy: number, cz: number, rTop: number, rBot: number, h: number, seg: number, v: number[], open = false, rotX = 0, rotZ = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, rotZ)), new THREE.Vector3(1, 1, 1));
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open), m, v);
  }
  sphere(cx: number, cy: number, cz: number, r: number, v: number[], sx = 1, sy = 1, sz = 1, detail = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion(), new THREE.Vector3(r * sx, r * sy, r * sz));
    return this.add(new THREE.IcosahedronGeometry(1, detail), m, v);
  }
  quad(cx: number, cy: number, cz: number, w: number, h: number, v: number[], rotY = 0, rotX = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ')), new THREE.Vector3(w, h, 1));
    return this.add(new THREE.PlaneGeometry(1, 1), m, v);
  }
  /** a quad from four corners (a, b, c, d counter-clockwise seen from its front), both sides drawn by the material */
  poly4(a: number[], b: number[], c: number[], d: number[], v: number[]) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), C = new THREE.Vector3(...c), D = new THREE.Vector3(...d);
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).normalize();
    const base = this.P.length / 3;
    for (const p of [A, B, C, D]) this.push(p, n, v, p);
    this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return this;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('aV', new THREE.Float32BufferAttribute(this.V, 4));
    g.setAttribute('aL', new THREE.Float32BufferAttribute(this.L, 3));
    g.setIndex(this.I);
    return g;
  }
}

/** The kit material: lit by sky, moon, sun, the street light map and the glowing people. */
export function kitMaterial(U: CityUniforms, o: { side?: THREE.Side; streetK?: number; extraVert?: string; extraHead?: string } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    side: o.side ?? THREE.FrontSide,
    vertexShader: /* glsl */ `
      attribute vec4 aV; attribute vec3 aL;
      attribute vec4 iPos; attribute vec3 iScale; attribute vec4 iCol; attribute vec4 iX;
      uniform float uTime;
      varying vec3 vW, vN, vL; varying vec4 vV, vCol, vX;
      ${o.extraHead ?? ''}
      void main() {
        vec4 ip = iPos; vec3 isc = iScale; vec4 icol = iCol;
        ${o.extraVert ?? ''}
        vec3 lp = position * isc;
        float c = cos(ip.w), s = sin(ip.w);
        vec3 rp = vec3(c * lp.x + s * lp.z, lp.y, -s * lp.x + c * lp.z);
        vec3 n = normal / isc;
        n = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
        vec4 w = modelMatrix * vec4(rp + ip.xyz, 1.0);
        vW = w.xyz; vN = n; vV = aV; vCol = icol; vL = aL * isc; vX = iX;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      varying vec3 vW, vN, vL; varying vec4 vV, vCol, vX;
      void main() {
        float mode = vV.a;
        if (mode > 4.5 && mode < 6.5) {
          // cut-outs: iron bars (vertical, with a top and bottom rail) / stair treads (horizontal)
          if (mode < 5.5) { float ry = vL.y - 0.05; if (fract((vL.x + vL.z) * 8.0) > 0.2 && ry > 0.06 && ry < 0.82) discard; }
          else if (fract(vL.y * 4.2) > 0.3) discard;
        }
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        float p = power(vW.xz);
        vec3 alb = mode < 0.5 ? vCol.rgb * vV.rgb : vV.rgb;
        if (mode > 6.5) {
          // the wooden barrel of a water tank: staves, iron hoops, weathering
          float ang = atan(vL.z, vL.x + 1e-4);
          float sv = ang * 3.82;
          alb *= (0.82 + 0.3 * h11(floor(sv) + 3.0)) * (1.0 - 0.35 * smoothstep(0.42, 0.5, abs(fract(sv) - 0.5)));
          float hoop = step(abs(fract(vL.y / 0.78) - 0.5), 0.05);
          alb = mix(alb * (0.85 + 0.3 * vnoise(vec2(ang * 3.0, vL.y * 0.6))), vec3(0.06, 0.055, 0.05), hoop);
        }
        vec3 L = ambient(N, p) * 1.3 + streetLight(vW.xz, vW.y, p) * ${(o.streetK ?? 1).toFixed(2)} + sunLight(vW, N) + peopleGlow(vW, N);
        vec3 c = alb * L;
        if (mode > 1.5 && mode < 2.5) {
          float th = 0.1 + 0.5 * fract(vCol.a * 7.31);
          float d = p - th;
          float on = step(0.0, d) * mix(step(0.5, h12(vec2(vCol.a * 99.0, floor(uTime * 15.0)))), 1.0, smoothstep(0.03, 0.1, d));
          vec3 warm = mix(vec3(1.0, 0.25, 0.1), vec3(1.0), smoothstep(0.0, 0.3, d));
          c += vV.rgb * warm * on * fract(vCol.a) * 4.0 * (1.0 - 0.9 * uDawn);
        } else if (mode > 2.5 && mode < 3.5) {
          vec3 V = normalize(vW - cameraPosition);
          float fres = pow(1.0 - clamp(abs(dot(V, N)), 0.0, 1.0), 3.0);
          c = alb * L * 0.4 + envRefl(reflect(V, N), 0.0) * (0.15 + 0.6 * fres) + streetLight(vW.xz, vW.y, p) * 0.03;
        } else if (mode > 3.5 && mode < 4.5) {
          c = vV.rgb * vCol.a;
        }
        c = cityFog(c, vW, p);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export interface KInst { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number; col: [number, number, number]; k: number; x4?: [number, number, number, number] }

export function kitBatch(geo: THREE.BufferGeometry, list: KInst[], mat: THREE.Material, origin: THREE.Vector3, radius = 4) {
  const g = new THREE.InstancedBufferGeometry();
  g.index = geo.index;
  for (const k of ['position', 'normal', 'aV', 'aL']) g.setAttribute(k, geo.attributes[k]!);
  const n = list.length, iPos = new Float32Array(n * 4), iScale = new Float32Array(n * 3), iCol = new Float32Array(n * 4), iX = new Float32Array(n * 4);
  let r = 0, hMax = 0;
  list.forEach((q, i) => {
    iPos.set([q.x - origin.x, q.y, q.z - origin.z, q.yaw], i * 4);
    iScale.set([q.sx, q.sy, q.sz], i * 3);
    iCol.set([...q.col, q.k], i * 4);
    if (q.x4) iX.set(q.x4, i * 4);
    r = Math.max(r, Math.hypot(q.x - origin.x, q.z - origin.z) + radius * Math.max(q.sx, q.sz));
    hMax = Math.max(hMax, q.y + radius * q.sy);
  });
  g.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
  g.setAttribute('iScale', new THREE.InstancedBufferAttribute(iScale, 3));
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(iCol, 4));
  g.setAttribute('iX', new THREE.InstancedBufferAttribute(iX, 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, hMax / 2, 0), r + hMax / 2 + 2);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(origin);
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  return m;
}

// ---------------------------------------------------------------- kit geometries

const IRON = [0.05, 0.05, 0.055, M.ALB], STEEL = [0.16, 0.16, 0.17, M.ALB];

/** A rooftop water tank: a stand of steel legs, a wooden barrel (planks and hoops drawn by the shader), a conical roof. r = 1. */
export function waterTowerGeometry() {
  const k = new KitBuilder();
  for (const [x, z] of [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] as const) k.cyl(x, 1.25, z, 0.07, 0.07, 2.5, 3, IRON, true);
  k.cyl(0, 2.55, 0, 1.12, 1.12, 0.1, 8, IRON);
  k.cyl(0, 2.6 + 1.9, 0, 0.98, 1.02, 3.8, 10, [0.34, 0.25, 0.17, M.WOOD], true);
  k.cyl(0, 6.4 + 0.5, 0, 0.05, 1.12, 1.0, 10, [0.2, 0.18, 0.16, M.ALB], true);
  return k.geometry();
}

/** A box unit for roof props (AC, vents, chimneys): 1×1×1 tinted, with a grille band on top. */
export function roofBoxGeometry() {
  const k = new KitBuilder();
  k.add(boxNoBottom(), new THREE.Matrix4(), [1, 1, 1, M.TINT]);
  return k.geometry();
}

/** A fire-escape landing: the platform, railings, the stair down to the landing below. Unit width 1 (x), the facade at z = 0, out to +z; y = 0 the landing's floor, the stair reaches y = -3.05 (scaled by the floor height). */
export function fireEscapeGeometry() {
  const k = new KitBuilder();
  const d = 1.15, H = 3.05, IR = [0.045, 0.045, 0.05, M.ALB], BARS = [0.045, 0.045, 0.05, M.BARS];
  k.box(0, -0.03, d / 2, 1, 0.06, d, IR);
  k.quad(0, 0.5, d, 1, 0.9, BARS);
  k.quad(-0.5, 0.5, d / 2, d, 0.9, BARS, Math.PI / 2);
  k.quad(0.5, 0.5, d / 2, d, 0.9, BARS, Math.PI / 2);
  // the stair: a slanted plane of treads along the facade from this landing to the one below, and its rail
  const zc = d * 0.42, hw = 0.26;
  k.poly4([0.32, 0, zc - hw], [0.32, 0, zc + hw], [-0.32, -H, zc + hw], [-0.32, -H, zc - hw], [0.045, 0.045, 0.05, M.SLATS]);
  k.poly4([0.32, 0.9, zc + hw], [0.32, 0.0, zc + hw], [-0.32, -H, zc + hw], [-0.32, -H + 0.9, zc + hw], BARS);
  return k.geometry();
}

/** A balcony: a slab and a glass/steel railing. Unit width 1, the facade at z = 0. */
export function balconyGeometry() {
  const k = new KitBuilder();
  k.box(0, 0, 0.75, 1, 0.18, 1.5, [0.32, 0.32, 0.31, M.ALB]);
  k.quad(0, 0.55, 1.49, 1, 0.9, [0.03, 0.035, 0.04, M.GLASS]);
  k.quad(-0.5, 0.55, 0.75, 1.5, 0.9, [0.16, 0.16, 0.17, M.BARS], Math.PI / 2).quad(0.5, 0.55, 0.75, 1.5, 0.9, [0.16, 0.16, 0.17, M.BARS], Math.PI / 2);
  return k.geometry();
}

/** An antenna mast (unit height 1) with its red light on top (instance k = light). */
export function antennaGeometry() {
  const k = new KitBuilder();
  k.cyl(0, 0.5, 0, 0.5, 1, 1, 5, STEEL);
  k.sphere(0, 1.0, 0, 1.3, [1, 0.06, 0.03, M.LIGHT], 1, 0.02, 1, 0);
  return k.geometry();
}
