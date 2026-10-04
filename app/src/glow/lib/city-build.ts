// Meshes of the night city's buildings and small things, all instanced:
// - building tiers (boxes whose facades are drawn by FACADE_GLSL),
// - rings: parapets and cornices around roof edges (a profile swept round the box, mitred at the corners),
// - kits: any small thing built from boxes / cylinders / cones (water towers, AC units, chimneys, antennas,
//   fire escapes, lamp posts, hydrants, cars…) with per-vertex materials and per-instance position, yaw,
//   scale, colour and light level.
import * as THREE from 'three';
import { CITY_GLSL, FACADE_GLSL, FACADE_VS, OPEN_GLSL, ROOF_GLSL, type CityUniforms } from './city-glsl';

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

const BUILDING_VS_HEAD = /* glsl */ `
  varying vec3 vW, vN; varying vec4 vF0, vF1, vF2, vF3;
  ${CITY_GLSL}
  ${FACADE_VS}
`;

/** Facade material (side faces only): `lod` 0 close, 1 mid, 2 far; `glass` for curtain walls. */
export function facadeMaterial(U: CityUniforms, lod: number, glass: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    defines: { FAC_LOD: lod, FAC_GLASS: glass ? 1 : 0 },
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute vec3 aSize; attribute vec4 aF0, aF1, aF2, aF3;
      ${BUILDING_VS_HEAD}
      void main() {
        vec4 w = modelMatrix * vec4(aPos + position * aSize, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vF0 = aF0; vF1 = aF1; vF2 = aF2; vF3 = aF3;
        facadeVertex(vW, vN, (modelMatrix * vec4(aPos, 1.0)).xyz, aSize, aF0, aF1, aF3);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW, vN; varying vec4 vF0, vF1, vF2, vF3;
      ${CITY_GLSL}
      ${OPEN_GLSL}
      ${FACADE_GLSL}
      void main() {
        openCut(vW);
        vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
        vec3 c = facade(vW, N, V, vF0, vF1, vF2, vF3);
        gl_FragColor = vec4(cityFog(c, vW, vPG.x), 1.0);
      }`,
  });
}

/** Roofs (top faces of the tiers). */
export function roofMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute vec3 aSize; attribute vec4 aF0;
      varying vec3 vW, vC, vS; varying float vSeed, vP;
      ${CITY_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(aPos + position * aSize, 1.0);
        vW = w.xyz; vC = (modelMatrix * vec4(aPos, 1.0)).xyz; vS = aSize; vSeed = aF0.x; vP = power(vW.xz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW, vC, vS; varying float vSeed, vP;
      ${CITY_GLSL}
      ${ROOF_GLSL}
      void main() { gl_FragColor = vec4(cityFog(roofShade(vW, vC, vS, vSeed, vP), vW, vP), 1.0); }`,
  });
}

/** Rooftop bulkheads and mechanical floors: painted brick / louvres, a lit door with a bulb on some. */
export function plantMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      attribute vec3 aPos; attribute vec3 aSize; attribute vec4 aF0, aF1, aF2;
      varying vec3 vW, vN, vC; varying vec4 vF0, vF1, vF2; varying float vP;
      ${CITY_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(aPos + position * aSize, 1.0);
        vW = w.xyz; vN = normal; vC = (modelMatrix * vec4(aPos, 1.0)).xyz; vF0 = aF0; vF1 = aF1; vF2 = aF2; vP = power(vW.xz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW, vN, vC; varying vec4 vF0, vF1, vF2; varying float vP;
      ${CITY_GLSL}
      void main() {
        vec3 N = normalize(vN);
        vec3 T = vec3(N.z, 0.0, -N.x);
        float u = dot(vW.xz - vC.xz, T.xz), v = vW.y - vC.y;
        vec3 alb = vF2.rgb * (0.85 + 0.3 * h12(floor(vec2(u, v) * 2.0) + vF0.x)) * (1.0 - step(0.5, vF1.x) * step(0.5, fract(v * 3.0)) * 0.5);
        vec3 c = alb * (ambient(N) * 1.2 + streetLight(vW.xz + N.xz * 2.0, vW.y, vP) * 0.4 + sunLit(N, 1.0));
        float doorFace = step(0.5, vF1.y) * step(0.5, abs(N.z)) * step(0.0, N.z * (h11(vF0.x) - 0.5)) * step(abs(N.y), 0.5);
        float door = doorFace * step(abs(u), 0.45) * step(v, 2.1);
        float lit = step(0.35, vP) * step(0.3, h11(vF0.x * 3.0));
        c = mix(c, vec3(0.03, 0.028, 0.025) + vec3(1.0, 0.7, 0.4) * 0.05 * lit, door);
        c += vec3(1.0, 0.75, 0.45) * (exp(-(u * u + (v - 2.35) * (v - 2.35)) * 30.0) * 2.5 + 0.04 * exp(-max(v - 2.3, 0.0) - abs(u) * 0.5)) * doorFace * lit;
        gl_FragColor = vec4(cityFog(c, vW, vP), 1.0);
      }`,
  });
}

/** Everything in one (the old City API: an InstancedMesh of unit boxes with aB/aTop, or batches with aPos..aF3). */
export function buildingMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    defines: { FAC_LOD: 1, FAC_GLASS: 0 },
    vertexShader: /* glsl */ `
      #ifdef USE_INSTANCING
        // the old City API: an InstancedMesh of a unit box (y 0..1) with aB = (seed, density, warmth, type 0 home / 1 office / 2-3 plant), aTop
        attribute vec4 aB; attribute float aTop;
      #else
        attribute vec3 aPos; attribute vec3 aSize; attribute vec4 aF0, aF1, aF2, aF3;
      #endif
      varying vec3 vC, vS;
      ${BUILDING_VS_HEAD}
      void main() {
        #ifdef USE_INSTANCING
          vec3 P0 = instanceMatrix[3].xyz;
          vec3 SZ = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          float office = step(0.5, aB.w) * step(aB.w, 1.5), plant = step(1.5, aB.w);
          vF0 = vec4(aB.x, plant > 0.5 ? 7.0 : office > 0.5 ? 3.0 : 1.0, office > 0.5 ? 3.9 : 3.15, office > 0.5 ? 6.0 : 4.6);
          vF1 = office > 0.5 ? vec4(1.6, 0.62, 0.72, 0.2) : vec4(3.2, 0.3, 0.56, 0.25);
          vF2 = vec4(office > 0.5 ? vec3(0.05, 0.055, 0.06) : mix(vec3(0.44, 0.34, 0.22), vec3(0.3, 0.12, 0.08), aB.z), clamp(aB.y * 1.1, 0.0, 1.0));
          vF3 = vec4(15.0, aTop, office > 0.5 ? 4.0 : 8.0, aB.z);
        #else
          vec3 P0 = aPos, SZ = aSize;
          vF0 = aF0; vF1 = aF1; vF2 = aF2; vF3 = aF3;
        #endif
        vec4 w = modelMatrix * vec4(P0 + position * SZ, 1.0);
        vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vC = (modelMatrix * vec4(P0, 1.0)).xyz; vS = SZ;
        facadeVertex(vW, vN, vC, SZ, vF0, vF1, vF3);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW, vN, vC, vS; varying vec4 vF0, vF1, vF2, vF3;
      ${CITY_GLSL}
      ${OPEN_GLSL}
      ${FACADE_GLSL}
      ${ROOF_GLSL}
      void main() {
        openCut(vW);
        vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
        vec3 c = N.y > 0.5 ? roofShade(vW, vC, vS, vF0.x, vPG.x) : vF0.y > 6.5 ? vF2.rgb * (ambient(N) + streetLight(vW.xz + N.xz * 2.0, vW.y, vPG.x) * 0.4) : facade(vW, N, V, vF0, vF1, vF2, vF3);
        gl_FragColor = vec4(cityFog(c, vW, vPG.x), 1.0);
      }`,
  });
}

/** Unit box faces: 'sides' (4 vertical faces), 'top', or 'all5' (no bottom). y in [0, 1]. */
export function boxPart(part: 'sides' | 'top' | 'all5') {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const nor = g.attributes.normal as THREE.BufferAttribute, idx = g.index!.array, keep: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const ny = nor.getY(idx[i]!);
    if (part === 'sides' ? Math.abs(ny) < 0.5 : part === 'top' ? ny > 0.5 : ny > -0.5) keep.push(idx[i]!, idx[i + 1]!, idx[i + 2]!);
  }
  g.setIndex(keep);
  g.deleteAttribute('uv');
  return g;
}

export interface BInst { x: number; y0: number; z: number; w: number; h: number; d: number; f0: number[]; f1: number[]; f2: number[]; f3: number[] }

/** A batch of building boxes around an origin (one draw call). */
export function buildingBatch(list: BInst[], mat: THREE.Material, origin: THREE.Vector3, part: 'sides' | 'top' | 'all5' = 'all5') {
  const base = boxPart(part);
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
export const MERGE = false;

/** A LOD whose level can be forced for every instance at once (the mirror pass draws the far level). */
export class CityLOD extends THREE.LOD {
  static force = -1;
  override update(camera: THREE.Camera) {
    if (CityLOD.force < 0) { super.update(camera); return; }
    const k = Math.min(CityLOD.force, this.levels.length - 1);
    this.levels.forEach((l, i) => (l.object.visible = i === k));
  }
}

/** Buildings' boxes as facades in three levels of detail (one geometry, three shaders) and their roofs. */
export function buildingMeshes(list: BInst[], origin: THREE.Vector3, facM: THREE.Material[], dist: [number, number]) {
  const sides = buildingBatch(list, facM[0]!, origin, 'sides');
  const lod = new CityLOD();
  lod.position.copy(origin);
  facM.forEach((m, i) => {
    const mesh = new THREE.Mesh(sides.geometry, m);
    mesh.position.set(0, 0, 0);
    mesh.frustumCulled = true;
    lod.addLevel(mesh, i === 0 ? 0 : dist[i - 1]!);
  });
  return lod;
}

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
      varying vec3 vL, vW; varying vec4 vCol; varying float vY; varying vec2 vU, vFk; varying float vP;
      ${CITY_GLSL}
      void main() {
        // iPos: centre x, y0, centre z; iSize: half x, half z, height, projection
        float off = aOff.x * iSize.w + aOff.y;
        vec3 p = vec3(iPos.x + position.x * (iSize.x + off), iPos.y + position.y * iSize.z, iPos.z + position.z * (iSize.y + off));
        vec4 w = modelMatrix * vec4(p, 1.0);
        vec3 N = normal;
        vP = power(w.xz);
        // lit per vertex: sky, moon (a rim on the top edge), the street from below, the sun, glowing people
        vL = ambient(N) * 1.4 + streetLight(w.xz + N.xz * 2.0, w.y, vP) * (0.6 + 0.8 * max(-N.y, 0.0)) + sunLow(w.xyz, N) + peopleGlow(w.xyz, N)
           + uMoonCol * 1.2 * step(0.92, aY) * (1.0 - uDawn);
        vW = w.xyz; vCol = iCol; vY = aY; vFk = fogK(w.xyz);
        vU = vec2(abs(normal.x) > 0.5 ? p.z : p.x, p.y);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vL, vW; varying vec4 vCol; varying float vY; varying vec2 vU, vFk; varying float vP;
      ${CITY_GLSL}
      void main() {
        vec3 alb = vCol.rgb;
        // dentils and brackets on cornices
        float px = fwidth(vU.x);
        float dent = vCol.a * step(0.25, vY) * step(vY, 0.42) * step(0.5, fract(vU.x / 0.32)) * smoothstep(0.2, 0.05, px);
        float brk = vCol.a * step(0.42, vY) * step(vY, 0.72) * step(0.82, fract(vU.x / 1.1)) * smoothstep(0.4, 0.1, px);
        alb *= 1.0 - 0.45 * dent + 0.25 * brk;
        gl_FragColor = vec4(applyFog(alb * vL, vFk, vP), 1.0);
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
export const M = { TINT: 0, ALB: 1, LAMP: 2, GLASS: 3, LIGHT: 4, BARS: 5, SLATS: 6, WOOD: 7, STRIPES: 8, SIGNAL: 9, LEAVES: 10, LATTICE: 11, TIES: 12 } as const;

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
  sphere(cx: number, cy: number, cz: number, r: number, v: number[], sx = 1, sy = 1, sz = 1, detail = 1, jit = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion(), new THREE.Vector3(r * sx, r * sy, r * sz));
    const g = new THREE.IcosahedronGeometry(1, detail);
    if (jit) {
      // lumpy: push each vertex in or out by a hash of where it is (shared corners move together)
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const h = Math.sin(Math.round(x * 97) * 12.9898 + Math.round(y * 97) * 78.233 + Math.round(z * 97) * 37.719 + cx * 3.1) * 43758.5453;
        const k = 1 + jit * ((h - Math.floor(h)) - 0.5);
        pos.setXYZ(i, x * k, y * k, z * k);
      }
      g.computeVertexNormals();
    }
    return this.add(g, m, v);
  }
  quad(cx: number, cy: number, cz: number, w: number, h: number, v: number[], rotY = 0, rotX = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, 0, 'YXZ')), new THREE.Vector3(w, h, 1));
    return this.add(new THREE.PlaneGeometry(1, 1), m, v);
  }
  /** a triangle (counter-clockwise seen from its front) */
  tri(a: number[], b: number[], c: number[], v: number[]) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), C = new THREE.Vector3(...c);
    const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).normalize();
    const base = this.P.length / 3;
    for (const p of [A, B, C]) this.push(p, n, v, p);
    this.I.push(base, base + 1, base + 2);
    return this;
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

/** The kit material: lit per vertex by sky, moon, sun, the street light map and the glowing people. */
export function kitMaterial(U: CityUniforms, o: { side?: THREE.Side; streetK?: number; extraVert?: string; extraHead?: string } = {}) {
  return new THREE.ShaderMaterial({
    defines: { SIG_P: '30.0' },
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    side: o.side ?? THREE.FrontSide,
    vertexShader: /* glsl */ `
      attribute vec4 aV; attribute vec3 aL;
      attribute vec4 iPos; attribute vec3 iScale; attribute vec4 iCol; attribute vec4 iX;
      varying vec3 vW, vN, vL, vLight; varying vec4 vV, vCol, vX; varying vec2 vFk; varying float vP, vOn;
      ${CITY_GLSL}
      ${o.extraHead ?? ''}
      void main() {
        vec4 ip = iPos; vec3 isc = iScale; vec4 icol = iCol;
        ${o.extraVert ?? ''}
        vec3 lp = position * isc;
        float c = cos(ip.w), s = sin(ip.w);
        vec3 rp = vec3(c * lp.x + s * lp.z, lp.y, -s * lp.x + c * lp.z);
        vec3 n = normal / isc;
        n = normalize(vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z));
        vec4 w = modelMatrix * vec4(rp + ip.xyz, 1.0);
        vW = w.xyz; vN = n; vV = aV; vCol = icol; vL = aL * isc; vX = iX;
        vP = power(w.xz);
        vLight = ambient(n) * 1.3 + streetLight(w.xz, w.y, vP) * ${(o.streetK ?? 1).toFixed(2)} + sunLow(w.xyz, n) + peopleGlow(w.xyz, n);
        // powered lamps: each switches on at its own threshold, flickering, warming from red
        float th = 0.1 + 0.5 * fract(icol.a * 7.31), d = vP - th;
        vOn = step(0.0, d) * mix(step(0.5, h12(vec2(icol.a * 99.0, floor(uTime * 15.0)))), 1.0, smoothstep(0.03, 0.1, d)) * (1.0 - 0.9 * uDawn) * (0.25 + 0.75 * smoothstep(0.0, 0.3, d));
        vFk = fogK(w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW, vN, vL, vLight; varying vec4 vV, vCol, vX; varying vec2 vFk; varying float vP, vOn;
      ${CITY_GLSL}
      void main() {
        float mode = vV.a;
        // cut-outs: iron bars (vertical, with a top and bottom rail) / stair treads (horizontal)
        float ry = vL.y - 0.05;
        if (mode > 4.5 && mode < 5.5 && fract((vL.x + vL.z) * 8.0) > 0.2 && ry > 0.06 && ry < 0.82) discard;
        if (mode > 5.5 && mode < 6.5 && fract(vL.y * 4.2) > 0.3) discard;
        // lattice girders (an X web between flanges), open ties of the el's deck
        if (mode > 10.5 && mode < 11.5) {
          float a1 = abs(fract((vL.z + vL.y) * 0.85) - 0.5), a2 = abs(fract((vL.z - vL.y) * 0.85) - 0.5);
          float web = step(min(a1, a2), 0.07);
          float flange = step(vL.y, 0.12) + step(0.88, vL.y);
          if (web + flange < 0.5) discard;
        }
        if (mode > 11.5 && fract(vL.z / 0.62) > 0.42) discard;
        // leaves: a ragged canopy (holes where the noise is low), lighter and darker clumps
        float leafN = vnoise(vL.xz * 2.2 + vL.y * 1.7 + vCol.a * 9.0);
        if (mode > 9.5 && leafN < 0.36) discard;
        vec3 alb = mode < 0.5 ? vCol.rgb * vV.rgb : vV.rgb;
        alb *= mix(1.0, 0.8 + 0.4 * h11(floor(vL.z / 0.62) + 2.0), step(11.5, mode));
        alb *= mix(1.0, 0.6 + 0.8 * leafN, step(9.5, mode));
        // stripes (awnings with k > 0.5; Con Ed stacks: orange and white bands)
        float stripeM = step(7.5, mode) * step(mode, 8.5);
        float isBand = step(vV.g, 0.9);
        alb = mix(alb, mix(vCol.rgb, mix(vCol.rgb, vec3(0.8, 0.78, 0.72), step(0.5, fract(vL.x * 1.4))), step(0.5, fract(vCol.a))), stripeM * (1.0 - isBand));
        alb = mix(alb, mix(vec3(0.9, 0.3, 0.04), vec3(0.85, 0.84, 0.8), step(0.5, fract(vL.y * 1.6))), stripeM * isBand);
        // the wooden barrel of a water tank: staves, iron hoops
        float sv = (vL.x * 3.0 + vL.z * 7.0);
        float wood = step(6.5, mode);
        alb *= mix(1.0, (0.8 + 0.35 * h11(floor(sv) + 3.0)) * (1.0 - 0.8 * step(abs(fract(vL.y / 0.78) - 0.5), 0.05)), wood);
        vec3 c = alb * vLight;
        // emissive: powered lamps, unpowered car / aviation lights; glass reflects the sky
        float lampM = step(1.5, mode) * step(mode, 2.5), lightM = step(3.5, mode) * step(mode, 4.5), glassM = step(2.5, mode) * step(mode, 3.5);
        c += vV.rgb * mix(vec3(1.0, 0.25, 0.1), vec3(1.0), vOn) * vOn * fract(vCol.a) * 4.0 * lampM;
        c = mix(c, vV.rgb * vCol.a, lightM);
        vec3 V = normalize(vW - cameraPosition), N = normalize(vN);
        c = mix(c, alb * vLight * 0.4 + skyRefl(reflect(V, N)) * (0.15 + 0.6 * pow(1.0 - clamp(abs(dot(V, N)), 0.0, 1.0), 3.0)) + vLight * 0.02, glassM);
        // traffic-signal lenses: the cycle (vX.x = this intersection's offset), the power
        float sigM = step(8.5, mode) * step(mode, 9.5);
        float ph = mod(uTime - vX.x, SIG_P);
        float stA = ph < 16.0 ? 2.0 : ph < 19.0 ? 1.0 : 0.0, stS = ph >= 20.0 && ph < 27.0 ? 2.0 : ph >= 27.0 && ph < 29.0 ? 1.0 : 0.0;
        float lensId = vV.r * 2.0;
        float st = vV.g < 0.25 ? stA : vV.g > 0.75 ? stS : -5.0;
        vec3 lc = lensId > 1.5 ? vec3(0.15, 1.0, 0.55) : lensId > 0.5 ? vec3(1.0, 0.55, 0.05) : vec3(1.0, 0.07, 0.03);
        float pOn = step(0.0, vP - 0.12 - 0.3 * fract(vX.x * 0.37));
        float lit = step(abs(st - lensId), 0.1) * pOn;
        // the walk signal: a white figure while the avenue is green, the orange hand otherwise
        float walk = step(abs(vV.g - 0.5), 0.1);
        vec3 pedC = stA > 1.5 ? vec3(0.9, 0.95, 1.0) : vec3(1.0, 0.45, 0.08);
        c = mix(c, mix(lc * (lit * 3.2 + 0.03), pedC * pOn * 1.6, walk), sigM);
        gl_FragColor = vec4(applyFog(c, vFk, vP), 1.0);
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

/** Instances of each kind of thing, gathered per tile. */
export class TileSet<T> {
  map = new Map<string, { origin: THREE.Vector3; lists: Map<string, T[]> }>();
  constructor(public sx: number, public sz: number) {}
  add(kind: string, x: number, z: number, item: T) {
    const a = Math.floor(x / this.sx), b = Math.floor(z / this.sz), k = `${a},${b}`;
    let t = this.map.get(k);
    if (!t) { t = { origin: new THREE.Vector3((a + 0.5) * this.sx, 0, (b + 0.5) * this.sz), lists: new Map() }; this.map.set(k, t); }
    let l = t.lists.get(kind);
    if (!l) t.lists.set(kind, (l = []));
    l.push(item);
  }
  /** Build every tile into a LOD (drawn within `dist`) using make(kind, list, origin) → mesh. */
  build(parent: THREE.Object3D, dist: number, make: (kind: string, list: T[], origin: THREE.Vector3) => THREE.Object3D | null, lods: THREE.Object3D[]) {
    for (const t of this.map.values()) {
      const g = new THREE.Group();
      for (const [kind, list] of t.lists) { const m = make(kind, list, t.origin); if (m) g.add(m); }
      if (!g.children.length) continue;
      const lod = new THREE.LOD();
      lod.position.copy(t.origin);
      g.position.set(-t.origin.x, 0, -t.origin.z);
      lod.addLevel(g, 0);
      lod.addLevel(new THREE.Object3D(), dist);
      parent.add(lod);
      lods.push(lod);
    }
  }
}

