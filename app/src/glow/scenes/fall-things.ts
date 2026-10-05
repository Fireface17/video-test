// Small things in the bridge's colours (`fall`): their glowing handprints from the run drifting like leaves, paper
// lanterns rising, five-pointed stars tumbling — placed along the depth they fall through, so they stream up past
// them — and the ribbons of light their trail leaves in the air.
import * as THREE from 'three';
import { mulberry32, noise1, smoothstep } from '../../engine/util';
import { col } from '../lib/palette';
import { starGeometry } from '../lib/shapes';
import { PaperLantern, heColor, sheColor } from '../lib/heroes';
import { GlowPoints } from '../lib/points';
import { Handprints } from './run-prints';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

interface Item { p: THREE.Vector3; seed: number; spin: THREE.Vector3; size: number; c: THREE.Color; rise: number }

export class Drifters extends THREE.Group {
  prints = new Handprints(60);
  printItems: Item[] = [];
  lanterns: PaperLantern[] = [];
  lanternItems: Item[] = [];
  stars: THREE.InstancedMesh;
  starMat: THREE.MeshBasicMaterial;
  starItems: Item[] = [];
  glow = new GlowPoints(80, 0.6);
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();
  private _e = new THREE.Euler();

  /** Spread between world heights yTop (the colours begin) and yBot, around the line of the fall through `axis`. */
  constructor(yTop: number, yBot: number, axis: THREE.Vector3, public T: Record<string, number>, public yAt: (t: number) => number) {
    super();
    const r = mulberry32(91);
    const around = (rMin: number, rMax: number) => { const a = r() * Math.PI * 2, rr = rMin + r() * (rMax - rMin); return [axis.x + Math.cos(a) * rr, axis.z + Math.sin(a) * rr] as const; };
    const span = yTop - yBot;
    // handprints, in their colours and the run's
    const pc = [col('cyan', 0.9), col('white', 0.9).lerp(col('cyan', 0.9), 0.4), col('violet', 0.9).lerp(col('white', 0.9), 0.4), heColor().multiplyScalar(0.8), sheColor().multiplyScalar(0.8)];
    for (let i = 0; i < 46; i++) {
      const [x, z] = around(1.6, 9);
      const it: Item = { p: V(x, yTop - r() * span * 0.75, z), seed: r(), spin: V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(2.2), size: 0.42 + r() * 0.35, c: pc[Math.floor(r() * pc.length)]!, rise: 0.3 + r() * 0.5 };
      this.printItems.push(it);
      this.prints.print({ pos: it.p.clone(), normal: V(0, 0, 1), up: V(0, 1, 0), t: 0, color: it.c, size: it.size, left: r() < 0.5 });
    }
    this.prints.build();
    this.prints.time = 50;
    this.prints.material.uniforms.fogD!.value = 0.012;
    this.add(this.prints);
    // paper lanterns rising
    for (let i = 0; i < 9; i++) {
      const [x, z] = around(2.4, 10);
      const L = new PaperLantern(0.13 + r() * 0.07);
      L.lit = 0.55 + r() * 0.5;
      this.lanterns.push(L);
      this.lanternItems.push({ p: V(x, yTop - 6 - r() * span * 0.85, z), seed: r(), spin: V(0, (r() - 0.5) * 0.6, 0), size: 1, c: col('gold'), rise: 1.2 + r() * 1.3 });
      this.add(L);
    }
    // five-pointed stars
    this.starMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const n = 44;
    this.stars = new THREE.InstancedMesh(starGeometry(0.15, 0.05), this.starMat, n);
    this.stars.frustumCulled = false;
    const sc = [col('phosphor', 1.4), col('#fff6d8', 1.6), col('gold', 1.5), col('cyan', 1.3).lerp(col('white', 1.3), 0.5), col('pink', 1.3).lerp(col('white', 1.3), 0.5)];
    for (let i = 0; i < n; i++) {
      const [x, z] = around(1.2, 11);
      const it: Item = { p: V(x, yTop + 4 - r() * (span + 30), z), seed: r(), spin: V(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(3), size: 0.07 + Math.pow(r(), 2) * 0.16, c: sc[Math.floor(r() * sc.length)]!, rise: r() * 0.4 };
      this.starItems.push(it);
      this.stars.setColorAt(i, it.c);
    }
    this.add(this.stars, this.glow);
  }

  update(t: number, cam: THREE.Camera, warm: number, colIn: number, blue: number) {
    const T = this.T, life = t - T.through;
    const gold = col('gold', 1.6);
    // prints: tumbling slowly like leaves, a gentle rise; fading in with the colours, out as gold comes
    const pk = smoothstep(T.through - 0.6, T.through + 0.4, t) * (1 - smoothstep(T.g1 + 0.5, T.g2, t));
    this.prints.material.uniforms.gain!.value = 0.85 * pk;
    this.printItems.forEach((it, i) => {
      const p = it.p.clone().add(V(Math.sin(t * 0.7 + it.seed * 9) * 0.4, life * it.rise, Math.cos(t * 0.6 + it.seed * 7) * 0.4));
      this._q.setFromEuler(this._e.set(it.spin.x * t + it.seed * 6, it.spin.y * t, Math.sin(t * 1.3 + it.seed * 5) * 0.8));
      this._m.compose(p, this._q, V(it.size * (it.seed < 0.5 ? -1 : 1), it.size, 1));
      this.prints.setMatrixAt(i, this._m);
    });
    this.prints.instanceMatrix.needsUpdate = true;
    // lanterns rise, sway, flicker; they turn to gold with the world
    this.lanterns.forEach((L, i) => {
      const it = this.lanternItems[i]!;
      L.position.copy(it.p).add(V(Math.sin(t * 0.5 + it.seed * 7) * 0.3, life * it.rise, Math.cos(t * 0.4 + it.seed * 5) * 0.3));
      L.rotation.set(0.12 * Math.sin(t * 0.9 + it.seed * 4), it.spin.y * t, 0.12 * Math.cos(t * 0.8 + it.seed * 3));
      L.time = t + it.seed * 10;
      L.lit = (0.55 + 0.5 * it.seed) * (1 + 0.8 * warm) * smoothstep(T.through - 0.8, T.through, t);
      L.update();
    });
    // stars tumble and twinkle
    const sk = smoothstep(T.through - 1.2, T.through, t);
    this.starItems.forEach((it, i) => {
      const p = it.p.clone().add(V(0, life * it.rise, 0));
      this._q.setFromEuler(this._e.set(it.spin.x * t, it.spin.y * t + it.seed * 6, it.spin.z * t));
      this._m.compose(p, this._q, V(1, 1, 1).multiplyScalar(it.size));
      this.stars.setMatrixAt(i, this._m);
      const tw = 0.8 + 0.2 * noise1(t * 3 + it.seed * 40, i);
      this.stars.setColorAt(i, it.c.clone().lerp(gold, warm * 0.8).multiplyScalar(tw * sk));
      this.glow.set(i, p.x, p.y, p.z, it.c.clone().lerp(gold, warm * 0.8).multiplyScalar(0.12 * sk), tw, 1 + it.size * 6);
    });
    this.stars.instanceMatrix.needsUpdate = true;
    if (this.stars.instanceColor) this.stars.instanceColor.needsUpdate = true;
    this.glow.commit(this.starItems.length);
    void cam; void colIn; void blue;
  }
}

/** Ribbons of light (camera-facing strips) along polylines given each frame: M ribbons × K points. */
export class Ribbons extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  private pos: Float32Array;
  private tan: Float32Array;
  private colA: Float32Array;

  constructor(public m: number, public k: number, width = 0.03) {
    const nv = m * k * 2;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(nv * 3), tan = new Float32Array(nv * 3), side = new Float32Array(nv), u = new Float32Array(nv), colA = new Float32Array(nv * 3);
    const idx: number[] = [];
    for (let r = 0; r < m; r++) for (let i = 0; i < k; i++) {
      const v = (r * k + i) * 2;
      side[v] = -1; side[v + 1] = 1;
      u[v] = u[v + 1] = i / (k - 1);
      if (i < k - 1) idx.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aTan', new THREE.BufferAttribute(tan, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    g.setAttribute('aCol', new THREE.BufferAttribute(colA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { width: { value: width } },
      vertexShader: /* glsl */ `
        attribute vec3 aTan; attribute float aSide, aU; attribute vec3 aCol;
        uniform float width;
        varying float vSide, vU; varying vec3 vC;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 tv = (modelViewMatrix * vec4(aTan, 0.0)).xyz;
          float tl = length(tv);
          tv = tl > 1e-6 ? tv / tl : vec3(1.0, 0.0, 0.0);
          vec3 sd = cross(tv, normalize(-mv.xyz));
          float sl = length(sd);
          sd = sl > 1e-6 ? sd / sl : vec3(0.0, 1.0, 0.0);
          // thinning toward the old end
          mv.xyz += sd * aSide * width * (1.0 - 0.7 * aU);
          vSide = aSide; vU = aU; vC = aCol;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vSide, vU; varying vec3 vC;
        void main() {
          // a soft silky band, brightest at its centre line, fading along its length
          float a = (exp(-vSide * vSide * 5.0) * 0.8 + 0.2 * (1.0 - vSide * vSide)) * pow(1.0 - vU, 1.4) * smoothstep(0.0, 0.06, vU);
          gl_FragColor = vec4(vC * a, 1.0);
        }`,
    });
    super(g, mat);
    this.pos = pos; this.tan = tan; this.colA = colA;
    this.frustumCulled = false;
  }

  /** Ribbon r: points from the newest (index 0) to the oldest, its colour. */
  set(r: number, pts: THREE.Vector3[], c: THREE.Color) {
    const k = this.k;
    for (let i = 0; i < k; i++) {
      const p = pts[Math.min(i, pts.length - 1)]!, a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
      const v = (r * k + i) * 2;
      for (const s of [0, 1]) {
        this.pos.set([p.x, p.y, p.z], (v + s) * 3);
        this.tan.set([b.x - a.x, b.y - a.y, b.z - a.z], (v + s) * 3);
        this.colA.set([c.r, c.g, c.b], (v + s) * 3);
      }
    }
  }

  commit() {
    const g = this.geometry;
    for (const n of ['position', 'aTan', 'aCol']) (g.getAttribute(n) as THREE.BufferAttribute).needsUpdate = true;
  }
}
