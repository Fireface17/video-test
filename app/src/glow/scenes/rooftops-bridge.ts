// Chorus 1: the bridge between his roof and hers — not a beam: stepping stones of light, each one the light of a
// window, given by a person who lights up on the facades below (a pane of their light flies up and settles into
// the arc just ahead of the two walkers). Also the walk itself: their distance along the bridge over time (a
// hesitant first step, a pause, then walking toward each other; an ellipsis at a cut), and the path.
import * as THREE from 'three';
import { clamp, ease, hash, noise1, pulse, smoothstep } from '../../engine/util';
import { GlowPoints } from '../lib/points';

/** A walker's distance along their path over time: integrated from a speed profile, with jumps at cuts. */
export class Walk {
  private tab: Float32Array;
  constructor(private t0: number, private t1: number, speed: (t: number) => number, jumps: [number, number][] = [], private hz = 240) {
    const n = Math.ceil((t1 - t0) * hz) + 2;
    this.tab = new Float32Array(n);
    let d = 0;
    for (let i = 1; i < n; i++) {
      const ta = t0 + (i - 1) / hz, tb = t0 + i / hz;
      d += 0.5 * (speed(ta) + speed(tb)) / hz;
      for (const [tj, dj] of jumps) if (tj > ta && tj <= tb) d += dj;
      this.tab[i] = d;
    }
  }
  at(t: number) {
    const x = clamp((t - this.t0) * this.hz, 0, this.tab.length - 1.001);
    const i = Math.floor(x), a = x - i;
    return this.tab[i]! * (1 - a) + this.tab[i + 1]! * a;
  }
  /** Speed (m/s) at t (for the walk/idle blend). */
  speed(t: number) { return (this.at(t + 0.02) - this.at(t - 0.02)) / 0.04; }
  /** First time the distance reaches d. */
  timeOf(d: number) {
    for (let i = 0; i < this.tab.length; i++) if (this.tab[i]! >= d) return this.t0 + i / this.hz;
    return this.t1;
  }
  get total() { return this.tab[this.tab.length - 1]!; }
}

/** A polyline path with arc length (for walking along it). */
export class Path {
  pts: THREE.Vector3[];
  len: number[] = [0];
  constructor(pts: THREE.Vector3[]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) this.len.push(this.len[i - 1]! + pts[i]!.distanceTo(pts[i - 1]!));
  }
  get total() { return this.len[this.len.length - 1]!; }
  at(d: number, out = new THREE.Vector3()) {
    d = clamp(d, 0, this.total);
    let i = 1;
    while (i < this.pts.length - 1 && this.len[i]! < d) i++;
    const a = this.len[i - 1]!, b = this.len[i]!;
    return out.copy(this.pts[i - 1]!).lerp(this.pts[i]!, b > a ? (d - a) / (b - a) : 0);
  }
  dir(d: number, out = new THREE.Vector3()) {
    const a = this.at(d - 0.15), b = this.at(d + 0.15);
    return out.subVectors(b, a).setY(0).normalize();
  }
}

export interface Step {
  /** position along the bridge 0 (his gap) .. 1 (her gap) */
  s: number;
  pos: THREE.Vector3;
  /** the yaw of the plate (along the bridge) */
  yaw: number;
  /** when it settles, and where its light comes from (the person who lights up) */
  t: number;
  from: THREE.Vector3;
  color: THREE.Color;
}

const STEP_VERT = /* glsl */ `
  attribute vec4 iP; attribute vec4 iC;
  varying vec2 vUv; varying vec4 vC; varying vec3 vW;
  void main() {
    vUv = uv; vC = iC;
    float c = cos(iP.w), s = sin(iP.w);
    vec3 p = position;
    vec3 r = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
    vec4 w = modelMatrix * vec4(r + iP.xyz, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const STEP_FRAG = /* glsl */ `
  varying vec2 vUv; varying vec4 vC; varying vec3 vW;
  void main() {
    // a pane of window light: warm glass, a brighter rim, the shadow of a sash bar across it
    vec2 q = abs(vUv - 0.5) * 2.0;
    float edge = max(q.x, q.y);
    float rim = smoothstep(0.78, 0.97, edge);
    float bar = 1.0 - 0.35 * (1.0 - smoothstep(0.02, 0.06, abs(vUv.y - 0.5)));
    float core = (0.08 + 0.1 * (1.0 - edge * edge)) * bar;
    vec3 c = vC.rgb * (core + 0.5 * rim) * vC.a;
    gl_FragColor = vec4(c, 1.0);
  }`;

/** The steps of light, the panes flying up to them, their halos. */
export class LightBridge extends THREE.Group {
  steps: Step[] = [];
  plates: THREE.Mesh;
  halos: GlowPoints;
  fly: GlowPoints;
  private iP: THREE.InstancedBufferAttribute;
  private iC: THREE.InstancedBufferAttribute;

  /** The arc between the two gaps: his gap g0 (s = 0) to hers g1 (s = 1), bulging `rise` m up in the middle. */
  constructor(public g0: THREE.Vector3, public g1: THREE.Vector3, public rise = 0.9, n = 16) {
    super();
    const g = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(0.92, 1.1);
    base.rotateX(-Math.PI / 2);
    g.index = base.index;
    g.setAttribute('position', base.attributes.position!);
    g.setAttribute('uv', base.attributes.uv!);
    this.iP = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iC = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iP', this.iP); g.setAttribute('iC', this.iC);
    g.instanceCount = 0;
    this.plates = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: STEP_VERT, fragmentShader: STEP_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.plates.frustumCulled = false;
    this.halos = new GlowPoints(n * 2, 1);
    this.fly = new GlowPoints(n * 24, 1);
    this.add(this.plates, this.halos, this.fly);
  }

  /** A point on the bridge's walking surface (0..1 from his gap). */
  at(s: number, out = new THREE.Vector3()) {
    out.copy(this.g0).lerp(this.g1, s);
    out.y += this.rise * Math.sin(Math.PI * clamp(s));
    return out;
  }

  /** Per frame: plates settle (spring), panes fly from their people to the plates. `gain` dims/brightens all. */
  update(t: number, gain = 1, dir = new THREE.Vector3(0, 0, -1), heat: { p: THREE.Vector3; k: number; r: number } | null = null) {
    const yaw = Math.atan2(dir.x, dir.z);
    let n = 0, nh = 0, nf = 0;
    for (let i = 0; i < this.steps.length; i++) {
      const st = this.steps[i]!;
      const fly = clamp((t - (st.t - 0.65)) / 0.65);
      if (fly <= 0) continue;
      const settled = t >= st.t;
      // the flight: from the person up in an arc, a small trail
      if (!settled) {
        const k = ease.inOutCubic(fly);
        for (let j = 0; j < 24; j++) {
          const kj = Math.max(0, k - j * 0.009);
          const p = st.from.clone().lerp(st.pos, kj);
          p.y += Math.sin(kj * Math.PI) * 3.0;
          this.fly.set(nf++, p.x, p.y, p.z, st.color, (1 - j / 24) * (j === 0 ? 2.2 : 0.9) * gain, j === 0 ? 0.8 : 0.3);
        }
      }
      // the plate grows out from its centre and settles with a little bounce, glowing brighter as it lands
      const g = settled ? 1 : 0;
      const a = t - st.t;
      const grow = settled ? 1 - Math.exp(-a * 9) * Math.cos(a * 22) * 0.6 : 0;
      if (g > 0) {
        const bob = 0.02 * Math.sin(t * 2.0 + i * 1.7);
        const flash = 1 + 2.5 * pulse(t, st.t, 0.18);
        this.iP.setXYZW(n, st.pos.x, st.pos.y + bob, st.pos.z, yaw);
        // the lantern's warm light spills onto the steps near it
        const hk = heat ? heat.k * Math.max(0, 1 - st.pos.distanceTo(heat.p) / heat.r) : 0;
        const cr = st.color.r + (1.0 - st.color.r) * hk, cg = st.color.g + (0.62 - st.color.g) * hk, cb = st.color.b + (0.25 - st.color.b) * hk;
        this.iC.setXYZW(n, cr, cg, cb, gain * flash * (1 + 1.2 * hk) * (0.85 + 0.15 * noise1(t * 3 + i, 7)));
        n++;
        this.halos.set(nh++, st.pos.x, st.pos.y - 0.05, st.pos.z, st.color, 0.35 * gain * flash, 2.2 * clamp(grow, 0, 1.2));
      }
    }
    this.iP.needsUpdate = this.iC.needsUpdate = true;
    (this.plates.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
    this.halos.commit(nh);
    this.fly.commit(nf);
  }

  /** The glows of the brightest steps, for the walls (nearest the given point first). */
  glows(t: number, near: THREE.Vector3, max = 4, gain = 1) {
    return this.steps.filter((s) => t >= s.t - 0.2).sort((a, b) => a.pos.distanceTo(near) - b.pos.distanceTo(near)).slice(0, max)
      .map((s) => ({ pos: s.pos.clone().add(new THREE.Vector3(0, -0.2, 0)), color: s.color.clone().multiplyScalar(0.35 * gain * (1 + 2 * pulse(t, s.t, 0.2))), radius: 3.2 }));
  }
}

export { hash, smoothstep };
