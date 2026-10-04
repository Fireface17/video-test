// Light effects of the drop in the city (scenes/citydrop.ts):
// - Lifts: each person's light lifting off them as sparks that rise above the roofs and stream up into a
//   slowly turning spiral high over the city (the galaxy of people starts here);
// - Veins: light pulses running down the avenues on the kicks, like blood through veins (ribbons on the
//   ground along the curbs and lane lines, beads of light on the lamps along them);
// - Beams: a rooftop DJ's moving lights (soft additive cones).
// Everything is a pure function of the song time.
import * as THREE from 'three';
import { clamp, hash, mulberry32 } from '../../engine/util';
import { GlowPoints } from '../lib/points';
import { GlowLines } from '../lib/stars';

export interface LiftSource {
  /** The person's chest (world); lights rise from here. */
  pos: THREE.Vector3;
  /** When their light starts to lift, and over how long it keeps leaving them. */
  t0: number;
  dur: number;
  color: THREE.Color;
  /** Number of sparks. */
  n: number;
}

/** Sparks rising off people and streaming up into a spiral above the city. */
export class Lifts extends THREE.Group {
  heads: GlowPoints;
  tails: GlowLines;
  sparks: { s: number; tb: number; th: number; sp: number; size: number; jx: number; jz: number }[] = [];
  /** The spiral's axis (x, z) and height. */
  axis = new THREE.Vector3(0, 260, 0);
  gain = 1;

  constructor(public sources: LiftSource[], o: { width?: number } = {}) {
    super();
    const r = mulberry32(911);
    sources.forEach((src, s) => {
      for (let i = 0; i < src.n; i++) {
        this.sparks.push({ s, tb: src.t0 + Math.pow(r(), 0.8) * src.dur, th: r() * Math.PI * 2, sp: 0.75 + r() * 0.5, size: 0.6 + r() * r() * 1.8, jx: r() - 0.5, jz: r() - 0.5 });
      }
    });
    this.heads = new GlowPoints(this.sparks.length, 0.09);
    this.tails = new GlowLines(this.sparks.length, o.width ?? 0.035);
    this.add(this.tails, this.heads);
  }

  /** Where spark i is at age a (s). */
  at(i: number, a: number, out: THREE.Vector3) {
    const k = this.sparks[i]!, src = this.sources[k.s]!, p = src.pos;
    const u = a * k.sp;
    // up: slow off the body, then faster and faster
    const y = p.y + 0.7 * u + 1.1 * u * u + 0.42 * u * u * u;
    // around the person first (a little curl), then drawn into the turning spiral over the city
    const curl = 0.25 * Math.min(u, 1.5);
    let x = p.x + Math.cos(k.th + u * 2.2) * curl + k.jx * 0.6 * u;
    let z = p.z + Math.sin(k.th + u * 2.2) * curl + k.jz * 0.6 * u;
    const q = clamp((u - 1.0) / 6.0);
    const qe = q * q * (3 - 2 * q);
    if (qe > 0) {
      const dx = p.x - this.axis.x, dz = p.z - this.axis.z;
      const r0 = Math.hypot(dx, dz), a0 = Math.atan2(dz, dx);
      const ang = a0 + 0.06 * u * u, rr = r0 * (1 - 0.55 * qe) + 30 * qe;
      x = x + (this.axis.x + Math.cos(ang) * rr - x) * qe;
      z = z + (this.axis.z + Math.sin(ang) * rr - z) * qe;
    }
    return out.set(x, Math.min(y, this.axis.y + 40 * Math.tanh((y - this.axis.y) / 40)), z);
  }

  private _a = new THREE.Vector3();
  private _b = new THREE.Vector3();

  update(t: number) {
    const H = this.heads, T = this.tails;
    let n = 0;
    for (let i = 0; i < this.sparks.length; i++) {
      const k = this.sparks[i]!, a = t - k.tb;
      if (a <= 0 || a > 9) { H.hide(i); continue; }
      const c = this.sources[k.s]!.color;
      const fade = clamp(a / 0.2) * clamp((9 - a) / 1.5);
      const tw = 0.75 + 0.25 * Math.sin(t * 9 + i * 1.7);
      this.at(i, a, this._a);
      H.set(i, this._a.x, this._a.y, this._a.z, c, 1.6 * fade * tw * this.gain, k.size * (1 + 0.4 * clamp(a / 3)));
      this.at(i, Math.max(0, a - 0.09), this._b);
      T.set(n++, this._a, this._b, c, 0.9 * fade * this.gain);
    }
    H.commit();
    T.commit(n);
  }
}

/**
 * Light running down the streets on the kicks: ribbons on the ground (curbs, lane lines) whose brightness is
 * a sum of pulses travelling along them from `origin` outward at `speed` m/s, each fired at a kick time.
 */
export class Veins extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  static MAXK = 24;

  /** `lines`: polylines on the ground (y included); `d0` per line = its distance along the network from the source. */
  constructor(lines: { pts: THREE.Vector3[]; d0: number; w: number }[], color: THREE.Color) {
    const pos: number[] = [], aD: number[] = [], aS: number[] = [], idx: number[] = [];
    for (const L of lines) {
      let d = L.d0;
      for (let i = 0; i < L.pts.length; i++) {
        const p = L.pts[i]!, a = L.pts[Math.max(0, i - 1)]!, b = L.pts[Math.min(L.pts.length - 1, i + 1)]!;
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l, nz = dx / l;
        if (i > 0) d += p.distanceTo(L.pts[i - 1]!);
        const base = pos.length / 3;
        pos.push(p.x + nx * L.w, p.y, p.z + nz * L.w, p.x - nx * L.w, p.y, p.z - nz * L.w);
        aD.push(d, d); aS.push(1, -1);
        if (i > 0) idx.push(base - 2, base - 1, base, base, base - 1, base + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aD', new THREE.Float32BufferAttribute(aD, 1));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
    g.setIndex(idx);
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      uniforms: { time: { value: 0 }, kicks: { value: new Array(Veins.MAXK).fill(-100) }, amps: { value: new Array(Veins.MAXK).fill(0) }, speed: { value: 160 }, color: { value: color.clone() }, base: { value: 0.04 }, fogD: { value: 0.004 } },
      vertexShader: /* glsl */ `
        attribute float aD, aS; varying float vD, vS, vFog;
        uniform float fogD;
        void main() { vD = aD; vS = aS; vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z; vFog = exp(-fogD * fogD * d * d); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform float time, speed, base; uniform float kicks[${Veins.MAXK}]; uniform float amps[${Veins.MAXK}]; uniform vec3 color;
        varying float vD, vS, vFog;
        void main() {
          float k = base;
          for (int i = 0; i < ${Veins.MAXK}; i++) {
            float age = time - kicks[i];
            if (age < 0.0 || age > 3.0) continue;
            float front = age * speed;
            float x = vD - front;
            // a bright head and a fading tail behind it
            float head = exp(-x * x / 18.0);
            float tail = x < 0.0 ? exp(x / 28.0) * 0.35 : 0.0;
            k += amps[i] * (head * 1.6 + tail) * exp(-age * 0.9);
          }
          float across = exp(-vS * vS * 2.5);
          gl_FragColor = vec4(color * k * across * vFog, 1.0);
        }`,
    });
    super(g, m);
    this.frustumCulled = false;
  }

  /** Kicks (times, strengths) to fire pulses on. */
  setKicks(ev: [number, number][]) {
    const u = this.material.uniforms;
    const K = u.kicks!.value as number[], A = u.amps!.value as number[];
    for (let i = 0; i < Veins.MAXK; i++) { K[i] = ev[i]?.[0] ?? -100; A[i] = ev[i]?.[1] ?? 0; }
  }

  /** The pulse brightness at network distance d (same as the shader), for lamps and signals along the lines. */
  level(d: number, t: number) {
    const u = this.material.uniforms, K = u.kicks!.value as number[], A = u.amps!.value as number[], sp = u.speed!.value as number;
    let k = 0;
    for (let i = 0; i < Veins.MAXK; i++) {
      const age = t - K[i]!;
      if (age < 0 || age > 3) continue;
      const x = d - age * sp;
      k += A[i]! * (Math.exp(-(x * x) / 18) * 1.6 + (x < 0 ? Math.exp(x / 28) * 0.35 : 0)) * Math.exp(-age * 0.9);
    }
    return k;
  }

  set time(t: number) { this.material.uniforms.time!.value = t; }
}

/** A rooftop DJ's moving heads: soft cones of light that sweep and change colour on the beat. */
export class Beams extends THREE.Group {
  cones: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; seed: number }[] = [];

  constructor(n: number, public len = 60, radius = 6) {
    super();
    const g = new THREE.CylinderGeometry(0.06, radius, len, 24, 1, true);
    g.translate(0, -len / 2, 0); // apex at the origin, opening toward −y
    g.rotateX(Math.PI / 2); // the cone opens along −z
    for (let i = 0; i < n; i++) {
      const mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { color: { value: new THREE.Color() }, len: { value: len } },
        vertexShader: /* glsl */ `
          varying float vL; varying vec3 vN; varying vec3 vV;
          uniform float len;
          void main() {
            vL = clamp(-position.z / len, 0.0, 1.0);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 color; varying float vL; varying vec3 vN; varying vec3 vV;
          void main() {
            float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
            float k = edge * pow(1.0 - vL, 1.4) * (0.35 + 0.65 * smoothstep(0.0, 0.06, vL));
            gl_FragColor = vec4(color * k, 1.0);
          }`,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      this.add(mesh);
      this.cones.push({ mesh, mat, seed: hash(i, 77) });
    }
  }

  /** Aim and colour the beams at time t; `beat` continuous beat index; colours cycle per bar. */
  update(t: number, beat: number, colors: THREE.Color[], k = 1) {
    this.cones.forEach((c, i) => {
      const s = c.seed;
      const pan = Math.sin(t * (0.9 + s * 0.8) + s * 9 + i * 1.3) * 0.9;
      const tilt = 0.55 + 0.35 * Math.sin(t * (1.3 + s) + i * 2.1);
      // pointing along −z of the group, swept left/right and up/down
      c.mesh.rotation.set(tilt, pan, 0, 'YXZ');
      const ci = (Math.floor(beat / 2) + i) % colors.length;
      const hit = Math.exp(-(beat - Math.floor(beat)) * 3.5);
      c.mat.uniforms.color!.value.copy(colors[ci]!).multiplyScalar(k * (0.35 + 0.45 * hit));
    });
  }
}
