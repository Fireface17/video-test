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

/** The spiral's disk bulges a little at its centre. */
const rfDip = (r: number) => 12 * Math.exp(-r / 40);

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

/**
 * Sparks rising off people and streaming up into a spiral above the city: soft round glows with a short
 * fading tail (a few dimmer points along the way they came), tinted by the person they left, curling up in
 * one stream per person.
 */
export class Lifts extends THREE.Group {
  heads: GlowPoints;
  sparks: { s: number; tb: number; sp: number; size: number; jx: number; jz: number }[] = [];
  /** The spiral's axis (x, z) and height, and how fast it turns (rad/s). */
  axis = new THREE.Vector3(0, 260, 0);
  spin = 0.06;
  gain = 1;
  /** Points per spark: the head and its tail. */
  static TAIL = 4;

  /** Per source: the curl's phase and radius, a drift, where its stream lands in the spiral (arm, radius). */
  src: { th: number; R: number; dx: number; dz: number; arm: number; rf: number }[] = [];

  constructor(public sources: LiftSource[]) {
    super();
    const r = mulberry32(911);
    sources.forEach((s, si) => {
      this.src.push({ th: r() * Math.PI * 2, R: 1.2 + r() * 2.2, dx: r() - 0.5, dz: r() - 0.5, arm: si % 2, rf: 16 + 125 * Math.pow(r(), 0.75) });
      for (let i = 0; i < s.n; i++) {
        this.sparks.push({ s: si, tb: s.t0 + (i / s.n) * s.dur + r() * 0.05, sp: 0.92 + r() * 0.16, size: 0.7 + r() * r() * 1.3, jx: (r() - 0.5) * 0.25, jz: (r() - 0.5) * 0.25 });
      }
    });
    this.heads = new GlowPoints(this.sparks.length * Lifts.TAIL, 0.32);
    this.add(this.heads);
  }

  /** Where spark i is at age a (s): off the body, curling up faster and faster, into a turning two-armed spiral. */
  at(i: number, a: number, out: THREE.Vector3, t = 0) {
    const k = this.sparks[i]!, src = this.sources[k.s]!, S = this.src[k.s]!, p = src.pos;
    const u = a * k.sp;
    // up: slow off the body, then faster and faster
    const y = p.y + 0.6 * u + 3 * u * u + 6 * u * u * u;
    // a stream per person: curling up round a slowly widening helix, drifting a little
    const R = S.R * Math.min(1, u * 0.9) * (1 + 0.6 * u), w = S.th + u * 2.6;
    let x = p.x + Math.cos(w) * R - Math.cos(S.th) * S.R * Math.min(1, u * 0.9) + k.jx + S.dx * 2.5 * u * u;
    let z = p.z + Math.sin(w) * R - Math.sin(S.th) * S.R * Math.min(1, u * 0.9) + k.jz + S.dz * 2.5 * u * u;
    // its place in the spiral (one of two arms, a log spiral, turning slowly); a stream lays itself along its arm
    const q = clamp((u - 1.2) / 1.65), qe = q * q * (3 - 2 * q);
    const A = this.axis;
    if (qe > 0) {
      const rf = S.rf * (1 + 0.25 * (k.tb - src.t0) / Math.max(src.dur, 0.1));
      const th = S.arm * Math.PI + 2.3 * Math.log(rf / 16) + this.spin * t + k.jx * 0.4;
      x += (A.x + Math.cos(th) * rf - x) * qe;
      z += (A.z + Math.sin(th) * rf - z) * qe;
    }
    const yc = A.y + k.jz * 20 - rfDip(S.rf);
    return out.set(x, y < yc ? y : yc, z);
  }

  private _a = new THREE.Vector3();

  update(t: number, cam?: THREE.Vector3) {
    const H = this.heads, NT = Lifts.TAIL;
    let n = 0;
    for (let i = 0; i < this.sparks.length; i++) {
      const k = this.sparks[i]!, a = t - k.tb;
      if (a <= 0 || a > 9) continue;
      const c = this.sources[k.s]!.color;
      const tw = 0.8 + 0.2 * Math.sin(t * 7 + i * 1.7);
      for (let j = 0; j < NT; j++) {
        const aj = a - j * 0.045;
        if (aj <= 0) break;
        this.at(i, aj, this._a, t - j * 0.045);
        // (never a big blur right at the lens)
        const near = cam ? clamp((this._a.distanceTo(cam) - 4) / 14) : 1;
        const fade = clamp(aj / 0.25) * clamp((9 - aj) / 1.5) * near;
        const tail = j === 0 ? 1 : 0.45 * Math.pow(0.55, j - 1);
        H.set(n++, this._a.x, this._a.y, this._a.z, c, 1.5 * fade * tw * tail * this.gain, k.size * (j === 0 ? 1 : 0.8 - 0.12 * j) * (1 + 0.8 * clamp(a / 3)));
      }
    }
    H.commit(n);
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
      c.mat.uniforms.color!.value.copy(colors[ci]!).multiplyScalar(k * (0.1 + 0.16 * hit));
    });
  }
}

/** The spiral's own glow: two soft log-spiral arms and a core (a disc seen from below), turning with the sparks. */
export class SpiralGlow extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  constructor(radius: number, color: THREE.Color) {
    super(new THREE.CircleGeometry(radius, 64), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { k: { value: 0 }, rot: { value: 0 }, color: { value: color.clone() }, R: { value: radius } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform float k, rot, R; uniform vec3 color; varying vec2 vP;
        void main() {
          float r = length(vP), rn = r / R;
          float a = atan(vP.y, vP.x + 1e-5) - rot;
          // two arms of a log spiral r = 16 e^(θ/2.3)
          float th = 2.3 * log(max(r, 1.0) / 16.0);
          float d = abs(fract((a - th) / 6.2831853 * 2.0) - 0.5) * 2.0; // 0 on an arm
          float arm = exp(-d * d * 18.0) * smoothstep(0.05, 0.2, rn) * (1.0 - smoothstep(0.55, 1.0, rn));
          float core = exp(-rn * rn * 60.0) * 1.4 + exp(-rn * 9.0) * 0.35;
          gl_FragColor = vec4(color * k * (arm * 0.5 + core), 1.0);
        }`,
    }));
    this.rotation.x = Math.PI / 2;
    this.frustumCulled = false;
  }
  update(t: number, k: number, spin: number) { this.material.uniforms.k!.value = k; this.material.uniforms.rot!.value = -spin * t; }
}
