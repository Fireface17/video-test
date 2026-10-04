// Bridge — "If you fall": a figure made of light (cyan-blue) flies through deep space, stars streaming
// past. "And if you fall, I'll fall with you": a second one (pink) catches up, flies alongside, and on
// "I'll fall with you" they reach out and join hands. "Through the colors and the blue": they fly through a
// soft, many-coloured nebula and out into a vast blue. "We'll be golden, me and you" (twice): gold spreads
// from their joined hands through both bodies, a golden light rises ahead, the stars and the gas turn gold
// and the frame ends warm gold for the final chorus. One continuous tracking shot; the lyrics are small
// neon script in the lower third.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import type { Line } from '../../engine/lyrics';
import { Stage, aim, skyDome } from '../lib/stage';
import { col } from '../lib/palette';
import { NeonLine } from '../lib/neon';
import { GlowPoints } from '../lib/points';
import { RealFigure, bend, limbDir, loadBody } from '../lib/people';
import { CloudPuffs, puffAtlas, type PuffLook, type PuffSpec } from './fall-clouds';
import { StarStreaks } from './fall-stars';
import { nebulaMap, nebulaSphere } from './fall-sky';

const FOV = 50;
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const TEXT_DIST = 4.0; // the lyric line floats this far in front of the camera
const TEXT_SIZE = 0.125;
const N_STARS = 4600, STAR_R0 = 4.5, STAR_R1 = 80, STAR_Z0 = -215, STAR_LEN = 265; // flying-frame z in [-215, 50]
const N_FAR = 1500;
const SPARK_DT = 0.016, SPARK_LIFE = 1.0, SPARK_DRAG = 7; // sparks shed by the bodies drift back at 7 m/s
const N_SPARK = 2 * Math.ceil(SPARK_LIFE / SPARK_DT + 2) + 24;
const BACKDROP = 0, COLORS = 1, BLUE = 2, GOLD = 3; // nebula groups
/** A figure (built standing, facing +z) turned to fly head first along -z, belly down. */
const FLYING = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, Math.PI, 0, 'XYZ'));

/** C1 interpolation through keys (Catmull-Rom tangents, flat at both ends). */
function spline(t: number, ks: [number, number][]): number {
  const n = ks.length;
  if (t <= ks[0]![0]) return ks[0]![1];
  if (t >= ks[n - 1]![0]) return ks[n - 1]![1];
  let i = 0;
  while (i < n - 2 && t > ks[i + 1]![0]) i++;
  const [t0, p0] = ks[i]!, [t1, p1] = ks[i + 1]!;
  const m = (k: number) => (k <= 0 || k >= n - 1 ? 0 : (ks[k + 1]![1] - ks[k - 1]![1]) / (ks[k + 1]![0] - ks[k - 1]![0]));
  const h = t1 - t0, u = (t - t0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * m(i) + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * m(i + 1);
}

/** Additive soft disc (halo / flare / sun), a unit quad. */
function softSprite(c: THREE.Color, fall = 5) {
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { c: { value: c.clone() }, fall: { value: fall } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 c; uniform float fall; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(c * (exp(-r * r * fall) + 0.25 * exp(-r * fall * 0.6)) * (1.0 - smoothstep(0.6, 1.0, r)), 1.0); }`,
  }));
}
const spriteColor = (m: THREE.Mesh) => (m.material as THREE.ShaderMaterial).uniforms.c!.value as THREE.Color;

interface CamPose { pos: THREE.Vector3; target: THREE.Vector3; q: THREE.Quaternion; roll: number }
interface Lyric { line: Line; neon: NeonLine; t0: number; t1: number; last: boolean; glass: THREE.Color }

export default class Fall extends Scene {
  st = new Stage(FOV, 0.05, 600);
  T!: { s: number; e: number; reach: number; touch: number; through: number; colors: number; blue: number; g1: number; golden1: number; g1end: number; g2: number; golden2: number; me1: number; me2: number };
  private tab!: Float32Array;
  private tab0 = 0;
  sky!: THREE.Mesh;
  nebSky!: THREE.Mesh;
  fog = new THREE.FogExp2(0x000000, 0.004);
  pair = new THREE.Group();
  figs: RealFigure[] = []; // 0 = pink (left, arrives), 1 = cyan-blue (the hero)
  halos: THREE.Mesh[] = [];
  flare!: THREE.Mesh;
  sun!: THREE.Mesh;
  sunCore!: THREE.Mesh;
  neb!: CloudPuffs;
  stars!: StarStreaks;
  starSeed!: Float32Array;
  far!: GlowPoints;
  sparks!: StarStreaks;
  lyr: Lyric[] = [];

  override async init() {
    const { lyrics, start, end } = this.ctx;
    const L = [lyrics.get('And if you fall'), lyrics.get('Through the colors'), lyrics.get('We’ll be golden', 0), lyrics.get('We’ll be golden', 1)] as const;
    const w = (l: Line, i: number) => l.words[Math.min(i, l.words.length - 1)]!.start;
    this.T = {
      s: start, e: end,
      reach: w(L[0], 4), // "I'll"
      touch: w(L[0], 7), // "you": the hands meet
      through: w(L[1], 0), colors: w(L[1], 2), blue: w(L[1], 5),
      g1: L[2].start, golden1: w(L[2], 2), g1end: L[2].end, me1: w(L[2], 3),
      g2: L[3].start, golden2: w(L[3], 2), me2: w(L[3], 3),
    };
    // the flight: distance table (S(start) = 0), so every position is a pure function of t
    const dt = 1 / 200;
    this.tab0 = start - 3;
    const n = Math.ceil((end + 3 - this.tab0) / dt) + 2;
    this.tab = new Float32Array(n);
    for (let i = 1; i < n; i++) this.tab[i] = this.tab[i - 1]! + this.speed(this.tab0 + (i - 0.5) * dt) * dt;
    const s0 = this.travel(start);
    for (let i = 0; i < n; i++) this.tab[i] = this.tab[i]! - s0;

    const S = this.st.scene;
    this.st.bg.copy(col('night'));
    S.fog = this.fog;
    this.sky = skyDome(col('night'), col('dusk', 0.7), col('night'), 500);
    this.nebSky = nebulaSphere(nebulaMap(512, 256, 4), 4, 470);
    S.add(this.sky, this.nebSky);

    // the golden light ahead (dark until "golden")
    this.sun = softSprite(new THREE.Color(0, 0, 0), 3.2);
    this.sun.renderOrder = -5;
    this.sunCore = softSprite(new THREE.Color(0, 0, 0), 14);
    this.sunCore.renderOrder = -4;
    S.add(this.sun, this.sunCore);

    // the two figures of light in one group (the formation banks as a whole)
    S.add(this.pair);
    const bodies = await Promise.all([loadBody('michelle'), loadBody('rpm')]);
    for (const [k, c] of [col('pink', 1.2), col('cyan', 1.15).lerp(col('blue', 1.3), 0.3)].entries()) {
      const f = new RealFigure(bodies[k]!, k === 0 ? 'michelle' : 'rpm', c);
      this.figs.push(f);
      this.pair.add(f);
      const h = softSprite(c.clone().multiplyScalar(0.1), 3.0);
      h.renderOrder = 5;
      this.halos.push(h);
      S.add(h);
    }
    this.flare = softSprite(new THREE.Color(0, 0, 0), 9);
    this.flare.renderOrder = 6;
    (this.flare.material as THREE.ShaderMaterial).depthTest = false; // a light at the hands: never cut by the arms
    S.add(this.flare);

    // nebulae along the route (world z; the flight moves them past at the travel distance)
    const total = this.travel(end);
    const rnd = mulberry32(23), specs: PuffSpec[] = [];
    const add = (x: number, y: number, z: number, size: number, color: THREE.Color, alpha: number, group: number) =>
      specs.push({ x, y, z, size, rot: rnd() * TAU, color, alpha, cell: Math.floor(rnd() * 4), group, seed: rnd() });
    const hue = (k: number) => (k < 0.5 ? col('blue') : k < 0.85 ? col('violet') : col('pink'));
    // far backdrop: big soft clouds of colour well off the route, all along it (in clumps, so the sky has
    // shapes: a few large glows with smaller knots around them)
    for (let z = 90; z > -total - 330; z -= 30) {
      const a0 = rnd() * TAU, r0 = 70 + rnd() * 70, h0 = rnd();
      for (let k = 0; k < 4; k++) {
        const a = a0 + (rnd() - 0.5) * 0.7, r = r0 + (rnd() - 0.5) * 30;
        const big = k === 0;
        add(Math.cos(a) * r, Math.sin(a) * r * 0.8, z + (rnd() - 0.5) * 30, big ? 80 + rnd() * 50 : 25 + rnd() * 35,
          hue(clamp(h0 + (rnd() - 0.5) * 0.3)).multiplyScalar(big ? 0.06 + 0.05 * rnd() : 0.08 + 0.1 * rnd()), big ? 0.35 : 0.3 + 0.2 * rnd(), BACKDROP);
      }
    }
    // "Through the colors": a many-coloured nebula across the route
    const zc = -this.travel((this.T.through + this.T.blue) / 2), len = this.travel(this.T.blue) - this.travel(this.T.through) + 20;
    for (let i = 0; i < 210; i++) {
      const a = rnd() * TAU, r = 1.2 + Math.pow(rnd(), 1.1) * 22;
      // colour drifts along the nebula: violet and pink first, blue at the far end
      const zz = (rnd() - 0.5) * len, u = zz / len + 0.5;
      const c = (rnd() < 0.5 - 0.4 * u ? col('pink') : rnd() < 0.6 ? col('violet') : rnd() < 0.7 ? col('blue') : col('cyan', 0.75)).multiplyScalar(0.12 + 0.24 * rnd());
      add(Math.cos(a) * r, Math.sin(a) * r * 0.85, zc - zz, 3.5 + rnd() * 9, c, 0.22 + 0.3 * rnd(), COLORS);
    }
    // "and the blue": a vast blue beyond it
    for (let i = 0; i < 46; i++) {
      const a = rnd() * TAU, r = 16 + rnd() * 50;
      add(Math.cos(a) * r, Math.sin(a) * r * 0.8, zc - len / 2 - rnd() * 140, 22 + rnd() * 30, col('blue', 0.08 + 0.1 * rnd()), 0.28 + 0.15 * rnd(), BLUE);
    }
    // the golden reach ahead (dark gas until "golden")
    const zg = -this.travel(this.T.g1);
    for (let i = 0; i < 90; i++) {
      const a = rnd() * TAU, r = 7 + Math.pow(rnd(), 0.9) * 42;
      add(Math.cos(a) * r, Math.sin(a) * r * 0.8, zg - 10 - rnd() * (total - (-zg) + 170), 10 + rnd() * 20, col('gold').lerp(col('ember'), rnd() * 0.6).multiplyScalar(0.07 + 0.1 * rnd()), 0.28 + 0.2 * rnd(), GOLD);
    }
    this.neb = new CloudPuffs(specs, puffAtlas(128));
    this.neb.renderOrder = 1;
    (this.neb.material.uniforms.nearFade!.value as THREE.Vector2).set(1.0, 4.2); // big near puffs fade out early (and cost nothing)
    S.add(this.neb);

    // stars: a deep column streaming past, and a field at infinity
    this.stars = new StarStreaks(N_STARS, 0.03, { fade: 0.006, maxPx: 7 });
    this.stars.renderOrder = 2;
    this.starSeed = new Float32Array(N_STARS * 5);
    const sr = mulberry32(5);
    for (let i = 0; i < N_STARS; i++) {
      const a = sr() * TAU, r = STAR_R0 + Math.pow(sr(), 2.2) * (STAR_R1 - STAR_R0);
      this.starSeed.set([Math.cos(a) * r, Math.sin(a) * r, sr() * STAR_LEN, 0.5 + Math.pow(sr(), 6) * 3, sr()], i * 5);
    }
    S.add(this.stars);
    this.far = new GlowPoints(N_FAR, 1.1);
    this.far.renderOrder = -6;
    const fr = mulberry32(3);
    for (let i = 0; i < N_FAR; i++) {
      const u = fr() * 2 - 1, th = fr() * TAU, R = 330;
      const c = fr() < 0.1 ? col('cyan') : fr() < 0.18 ? col('pink') : fr() < 0.3 ? col('violet') : col('#e8ecff');
      this.far.set(i, Math.sqrt(1 - u * u) * Math.cos(th) * R, u * R, Math.sqrt(1 - u * u) * Math.sin(th) * R, c, 0.35 + fr() * 0.9, 0.6 + Math.pow(fr(), 3) * 2.2);
    }
    this.far.commit();
    S.add(this.far);
    this.sparks = new StarStreaks(N_SPARK, 0.02, { maxPx: 6 });
    this.sparks.renderOrder = 3;
    S.add(this.sparks);

    // lyrics: small neon script, one row, in the lower third; cool white first, gold for "golden"
    const cool = col('white').lerp(col('cyan'), 0.35).multiplyScalar(2.1);
    const goldC = col('gold', 2.4);
    L.forEach((line, i) => {
      const c = i < 2 ? cool : goldC;
      const neon = new NeonLine(line, [line.words.map((_, k) => k)], { font: 'script', size: TEXT_SIZE, color: c, radius: TEXT_SIZE * 0.022 });
      neon.visible = false;
      neon.renderOrder = 10;
      S.add(neon);
      this.lyr.push({ line, neon, t0: line.words[0]!.start, t1: line.end, last: i === 3, glass: col('#9fb8ff', 0.03) });
    });
  }

  /** Flight speed (m/s): steady, a touch faster through the colours, gathering into the finale. */
  private speed(t: number) {
    const T = this.T;
    return 17 + 4 * smoothstep(T.reach, T.through, t) - 3 * smoothstep(T.blue, T.g1, t) + 9 * smoothstep(T.golden1, T.e, t);
  }

  /** Distance flown since the scene started. */
  travel(t: number) {
    const tab = this.tab, n = tab.length, x = (t - this.tab0) * 200;
    if (x <= 0) return tab[0]! + (x / 200) * this.speed(this.tab0);
    if (x >= n - 1) return tab[n - 1]! + ((x - n + 1) / 200) * this.speed(this.tab0 + (n - 1) / 200);
    const i = Math.floor(x), f = x - i;
    return tab[i]! * (1 - f) + tab[i + 1]! * f;
  }

  /** Where the pink one is (flying frame): catching up from behind and below, then alongside. */
  private pinkPos(t: number) {
    const T = this.T, k = prog(t, T.s - 0.25, T.reach - 0.05, ease.outCubic);
    const p = new THREE.Vector3(-4.6, -1.8, 9.5).lerp(new THREE.Vector3(-0.95, 0, 0.1), k);
    p.y -= Math.sin(Math.PI * k) * 0.5;
    return p;
  }

  /**
   * Camera without the handheld float (flying frame: the pair at the origin flying toward -z, bellies down).
   * It orbits the line of flight from below: `phi` is the angle round the flight axis from straight below
   * toward their right, `beta` how far it hangs back. Screen-up is the direction of flight, so they climb
   * up through the frame, the stars streaming down past them.
   */
  private camBase(t: number): CamPose {
    const T = this.T;
    const K = (vals: number[]) => spline(t, [T.s - 0.45, T.s + 0.5, T.reach, T.touch, T.through, T.colors, T.blue, T.g1, T.golden2, T.e].map((k, i) => [k, vals[i]!] as [number, number]));
    const phi = K([50, 46, 34, 22, 26, 32, 20, 12, 6, 2]) * DEG;
    const beta = K([22, 24, 30, 34, 38, 40, 34, 30, 34, 38]) * DEG;
    const R = K([5.2, 5.0, 4.7, 4.3, 4.6, 4.8, 4.6, 4.2, 3.75, 4.2]);
    const radial = new THREE.Vector3(Math.sin(phi), -Math.cos(phi), 0);
    const pos = radial.clone().multiplyScalar(R * Math.cos(beta)).add(new THREE.Vector3(0, 0, R * Math.sin(beta)));
    const hero = new THREE.Vector3(0.9, 0, -0.3), mid = new THREE.Vector3(0, 0, -0.3);
    const target = hero.lerp(mid, prog(t, T.s, T.touch, ease.inOutCubic));
    // the pair sits in the upper part of the frame, the lyrics have the lower third
    const FWD = { x: 0, y: 0, z: -1 };
    aim(this.st.cam, pos, target, 0, FWD);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.st.cam.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.st.cam.quaternion);
    const hh = pos.distanceTo(target) * Math.tan((FOV / 2) * DEG);
    target.addScaledVector(up, -0.24 * hh).addScaledVector(right, -0.1 * hh);
    // rolled so the flight runs diagonally up and to the right
    const roll = K([-0.5, -0.5, -0.48, -0.45, -0.42, -0.4, -0.4, -0.42, -0.4, -0.38]);
    aim(this.st.cam, pos, target, roll, FWD);
    return { pos, target, q: this.st.cam.quaternion.clone(), roll };
  }

  /** Gold: how far it has spread through the figures (m from the hands) and how warm the world is (0..1). */
  private gold(t: number) {
    const T = this.T;
    const spread = t < T.golden1 - 0.05 ? -1 : lerp(0, 3.4, prog(t, T.golden1 - 0.05, T.golden1 + 1.4, ease.outCubic));
    const warm = 0.35 * prog(t, T.golden1, T.g1end + 0.3, ease.inOutCubic) + 0.65 * smoothstep(T.g2 - 0.4, T.e - 0.1, t);
    return { spread, warm };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T, { audio } = this.ctx;
    const pad = audio.env('other', t), voc = audio.env('vocal', t);
    const S = this.travel(t), v = this.speed(t);
    const { spread, warm } = this.gold(t);
    const blue = prog(t, T.blue - 0.6, T.blue + 0.8, ease.inOutCubic) * (1 - prog(t, T.g1, T.g2 + 1, ease.inOutQuad));
    const cam = this.st.cam;

    // ---- camera: flies with them, a slow float on top ----
    const cb = this.camBase(t);
    const drift = new THREE.Vector3(noise1(t * 0.3, 11), noise1(t * 0.27, 12), noise1(t * 0.33, 13)).multiplyScalar(0.12);
    aim(cam, cb.pos.clone().add(drift), cb.target, cb.roll + noise1(t * 0.19, 14) * 0.025, { x: 0, y: 0, z: -1 });
    this.sky.position.copy(cam.position);
    this.nebSky.position.copy(cam.position);
    this.far.position.copy(cam.position);

    // ---- the formation: banks slowly, noses up a little ----
    const holdK = prog(t, T.reach, T.touch, ease.inOutCubic);
    const arrive = prog(t, T.s - 0.25, T.reach - 0.05, ease.outCubic);
    const meK = Math.max(prog(t, T.me1 - 0.3, T.me1 + 1, ease.inOutCubic) * (1 - prog(t, T.g2 - 0.5, T.g2, ease.inOutCubic)), prog(t, T.me2 - 0.3, T.me2 + 1, ease.inOutCubic));
    const open = prog(t, T.golden1, T.golden1 + 1.6, ease.inOutCubic) * 0.6 + 0.4 * prog(t, T.golden2, T.golden2 + 1.4, ease.inOutCubic);
    this.pair.rotation.set(0.1 + 0.05 * noise1(t * 0.3, 1), 0.05 * noise1(t * 0.25, 2), 0.16 * Math.sin(t * 0.55 + 1) + 0.08 * noise1(t * 0.4, 3), 'ZXY');
    const sep = lerp(1.9, 1.3, prog(t, T.reach, T.touch + 0.05, ease.inOutCubic)) + 0.025 * Math.sin(t * 1.7) * holdK;
    this.figs.forEach((fig, i) => {
      const s = i === 0 ? -1 : 1; // world side; the partner is toward -s
      const nz = (fq: number, sd: number) => noise1(t * fq, sd + 37 * i);
      const p = i === 0 ? this.pinkPos(t) : new THREE.Vector3(sep / 2, 0, 0);
      if (i === 0 && t >= T.reach - 0.05) p.x = -sep / 2;
      p.y += nz(0.45, 20) * 0.08 * (1 - 0.6 * holdK);
      p.z += nz(0.35, 30) * 0.12 * (1 - 0.5 * holdK);
      fig.position.copy(p);
      const late = i === 0 ? 1 - arrive : 0; // the pink one climbs and banks in
      // flying: head toward -z, front (belly) toward -y, so local +X is world -x; small pitch / yaw / bank
      fig.quaternion.setFromEuler(new THREE.Euler(0.06 * nz(0.3, 40) + 0.35 * late, 0.06 * nz(0.25, 50) - s * 0.04 * holdK, 0.06 * nz(0.22, 60) - 0.4 * late, 'YXZ')).multiply(FLYING);
      // gliding: back arched a little, head up looking ahead
      fig.setSpine(-0.08 + 0.05 * nz(0.45, 70), s * 0.04 * holdK, -0.12 + 0.08 * nz(0.38, 80), s * 0.22 * meK);
      // legs trail behind, soft knees, a slow flutter
      for (const k of [0, 1]) {
        const ls = k === 0 ? -1 : 1;
        const u1 = limbDir(ls, 0.07 + 0.03 * nz(0.5, 90 + k), -0.14 - 0.08 * nz(0.41, 95 + k));
        fig.setLeg(k, u1, bend(u1, new THREE.Vector3(0, 0, -1), 0.22 + 0.16 * (0.5 + 0.5 * Math.sin(t * 4.2 + k * 2.4 + i)) + (ls === s ? 0.15 : 0)));
        fig.setFoot(k, 0.85);
      }
      // outer arm reaches forward (superman); it opens out to the side once they are golden
      const inner = s > 0 ? 1 : 0, outer = 1 - inner;
      const ua = limbDir(-s, lerp(2.75, 1.95, open) + 0.08 * nz(0.43, 101), 0.12 + 0.06 * nz(0.39, 103));
      fig.setArm(outer, ua, bend(ua, new THREE.Vector3(0, 0.2, 1), 0.12 + 0.1 * open));
      // inner arm: along the side while alone, opening toward the partner, then the IK takes it to the grip
      const openIn = i === 1 ? prog(t, T.s + 0.3, T.reach, ease.inOutQuad) : 0.8 + 0.2 * arrive;
      const ui = limbDir(s, lerp(0.35, 1.45, openIn) + 0.08 * nz(0.44, 107), lerp(-0.1, 0.25, openIn));
      fig.setArm(inner, ui, bend(ui, new THREE.Vector3(0, 0.3, 1), 0.35));
      fig.setHand(outer, 0.1);
      fig.setHand(inner, 0.15 + 0.45 * holdK);
    });
    // the hands meet between the inner shoulders, a little ahead and below
    this.pair.updateMatrixWorld(true);
    const meet = new THREE.Vector3(0, -0.08 + noise1(t * 0.5, 120) * 0.03, -0.38).applyMatrix4(this.pair.matrixWorld);
    const handPos: THREE.Vector3[] = [];
    this.figs.forEach((fig, i) => {
      const s = i === 0 ? -1 : 1, inner = s > 0 ? 1 : 0;
      const relaxed = fig.hand(inner);
      const grip = meet.clone().add(new THREE.Vector3(s * 0.035, 0, 0).applyQuaternion(this.pair.quaternion));
      fig.reach(inner, relaxed.lerp(grip, holdK), new THREE.Vector3(0, -0.5, -0.7));
      handPos.push(fig.hand(inner));
    });
    const hands = handPos[0]!.clone().add(handPos[1]!).multiplyScalar(0.5);

    // ---- light: their colours, tinted in the nebula; gold spreads from the hands ----
    const colIn = prog(t, T.through - 0.5, T.through + 0.2) * (1 - prog(t, T.blue - 0.2, T.blue + 0.5));
    const tint = col('violet', 1.3).lerp(col('pink', 1.1), 0.5 + 0.5 * Math.sin(t * 2.1)).lerp(col('blue', 1.5), prog(t, T.colors + 0.3, T.blue));
    const goldCol = col('gold', 1.25).lerp(col('ember', 1.2), 0.15);
    const breathe = 1 + 0.06 * pad + 0.04 * noise1(t * 1.3, 130);
    this.figs.forEach((fig, i) => {
      const u = fig.mat.uniforms;
      (u.tint!.value as THREE.Color).copy(tint);
      u.tintK!.value = 0.35 * colIn + 0.15 * blue;
      (u.gold!.value as THREE.Color).copy(goldCol).multiplyScalar(1 + 0.25 * warm);
      (u.goldO!.value as THREE.Vector3).copy(hands);
      u.goldR!.value = spread;
      u.level!.value = breathe * (1 + 0.1 * warm) * (i === 0 ? smoothstep(T.s - 0.25, T.s + 0.25, t) : 1);
      const chest = fig.spinePoint(0, 0.2, 0);
      const h = this.halos[i]!;
      h.position.copy(chest).addScaledVector(new THREE.Vector3().subVectors(chest, cam.position).normalize(), 0.5);
      h.quaternion.copy(cam.quaternion);
      h.scale.setScalar(3.2 + 0.8 * warm);
      const base = (u.color!.value as THREE.Color).clone().lerp(tint, u.tintK!.value as number).lerp(goldCol, clamp(spread / 1.6));
      spriteColor(h).copy(base).multiplyScalar(0.08 * (1 + 0.8 * warm) * breathe);
      this.neb.setLight(i, chest, base.clone().multiplyScalar(0.6 + 0.6 * warm), 3.5 + 2 * warm);
    });
    // the touch: a soft bloom of light where the hands meet, steady while they hold on
    const touchK = smoothstep(T.touch - 0.12, T.touch + 0.25, t);
    const flareK = touchK * (0.5 + 0.9 * pulse(t, T.touch, 0.45) + 0.4 * warm) + 0.8 * pulse(t, T.golden1, 0.6) + 0.5 * pulse(t, T.golden2, 0.7);
    const flareBase = col('#f2d9ff').lerp(col('gold', 1.4), clamp(spread + 0.2));
    const flareC = flareBase.clone().multiplyScalar(flareK);
    this.flare.position.copy(hands).addScaledVector(new THREE.Vector3().subVectors(cam.position, hands).normalize(), 0.15);
    this.flare.quaternion.copy(cam.quaternion);
    this.flare.scale.setScalar(0.85 + 0.5 * warm + 0.25 * pulse(t, T.touch, 0.5));
    spriteColor(this.flare).copy(flareC);
    this.neb.setLight(2, hands, flareC.clone().multiplyScalar(0.3), 2.0);

    // ---- space: night-blue, a blue glow beyond the nebula, then the golden light ahead ----
    // the golden light rises ahead of them, above their heads in the frame
    const sunDir = new THREE.Vector3(0.04, 0.55, -1).normalize();
    const sunK = smoothstep(T.g1 - 0.2, T.golden1 + 1.5, t) * 0.3 + 0.7 * smoothstep(T.g2 - 0.5, T.e, t);
    const su = (this.sky.material as THREE.ShaderMaterial).uniforms;
    // (the warm sky arrives late, through a dark amber rather than a purple mix of blue and gold)
    const w2 = warm * warm, amber = col('ember', 0.05).lerp(col('gold', 0.07), w2);
    const deep = col('night').lerp(col('blue', 0.06), blue).multiplyScalar(1 - 0.85 * smoothstep(0.25, 0.75, warm)).add(amber.clone().multiplyScalar(smoothstep(0.3, 0.95, warm)));
    (su.top!.value as THREE.Color).copy(deep);
    (su.bottom!.value as THREE.Color).copy(deep);
    (su.horizon!.value as THREE.Color).copy(col('dusk', 0.7).lerp(col('blue', 0.1), blue)).multiplyScalar(1 - 0.85 * smoothstep(0.25, 0.75, warm)).add(col('ember', 0.16).lerp(col('gold', 0.2), w2).multiplyScalar(smoothstep(0.3, 0.95, warm)));
    (su.glowDir!.value as THREE.Vector3).copy(sunDir);
    (su.glow!.value as THREE.Color).copy(col('gold', 1.4)).multiplyScalar(sunK * 0.9);
    this.st.bg.copy(deep);
    const sunPos = sunDir.clone().multiplyScalar(300).add(cam.position);
    this.sun.position.copy(sunPos);
    this.sun.quaternion.copy(cam.quaternion);
    this.sun.scale.setScalar(lerp(50, 360, sunK));
    spriteColor(this.sun).copy(col('gold', 0.55).lerp(col('ember', 0.55), 0.3)).multiplyScalar(sunK * (0.7 + 0.5 * warm));
    this.sunCore.position.copy(sunPos);
    this.sunCore.quaternion.copy(cam.quaternion);
    this.sunCore.scale.setScalar(lerp(10, 46, sunK));
    spriteColor(this.sunCore).copy(col('#fff2cc', 2.2)).multiplyScalar(sunK);
    const fogC = deep.clone().lerp(col('ember', 0.05), warm);
    const nu = (this.nebSky.material as THREE.ShaderMaterial).uniforms;
    nu.gain!.value = 1.5 + 0.5 * blue + 1.6 * warm;
    (nu.tint!.value as THREE.Color).setRGB(1, 1, 1).lerp(new THREE.Color(0.6, 0.8, 1.4), blue);
    nu.gk!.value = smoothstep(0.1, 0.75, warm);
    this.fog.color.copy(fogC);
    this.neb.setFog(fogC, 0.0065, 0.85);
    this.neb.setAmbient(new THREE.Color(0, 0, 0), col('gold', 0.5).multiplyScalar(sunK), sunDir);

    // ---- nebulae ----
    const off = new THREE.Vector3(0, 0, S);
    const darkGas = col('blue', 0.05), warmGas = col('gold', 0.13).lerp(col('ember', 0.13), 0.35), pc = new THREE.Color();
    const kGold = 0.12 + 2.2 * warm, kDark = 1 - smoothstep(0, 0.25, warm), kWarm = smoothstep(0.15, 0.9, warm);
    this.neb.update(cam, off, (s, _p, o: PuffLook) => {
      let k = 1;
      if (s.group === GOLD) { k = kGold; pc.copy(s.color).lerp(darkGas, kDark); }
      else if (s.group === COLORS) { k = 1 + 0.3 * pad; pc.copy(s.color); }
      else pc.copy(s.color).lerp(warmGas, kWarm);
      o.r = pc.r * k; o.g = pc.g * k; o.b = pc.b * k; o.a = s.alpha;
    }, 420);

    // ---- stars streaming past ----
    const ss = this.starSeed;
    const cWhite = col('#dfe6ff', 1.0), cBlue = col('#7f9cff', 1.0), cGold = col('gold', 1.2), cEmber = col('ember', 1.1);
    const cCyan = col('cyan', 0.9), cPink = col('pink', 0.9), cViolet = col('violet', 1.0);
    const tmp = new THREE.Color();
    for (let i = 0; i < N_STARS; i++) {
      const o = i * 5, h = ss[o + 4]!;
      const z = STAR_Z0 + ((((ss[o + 2]! + S) % STAR_LEN) + STAR_LEN) % STAR_LEN); // (S < 0 before the cut)
      const edge = smoothstep(STAR_Z0, STAR_Z0 + 40, z) * (1 - smoothstep(STAR_Z0 + STAR_LEN - 12, STAR_Z0 + STAR_LEN, z));
      tmp.copy(h < 0.08 ? cCyan : h < 0.14 ? cPink : h < 0.2 ? cViolet : cWhite);
      tmp.lerp(cBlue, blue * 0.5);
      const gk = smoothstep(h * 0.7, h * 0.7 + 0.3, warm);
      tmp.lerp(h < 0.6 ? cGold : cEmber, gk);
      this.stars.set(i, ss[o]!, ss[o + 1]!, z, tmp, (0.5 + 0.9 * h) * edge * (1 + 0.3 * gk), ss[o + 3]!);
    }
    this.stars.setMotion(new THREE.Vector3(0, 0, v), 1 / 45);
    this.stars.commit();

    // ---- sparks shed by the bodies, trailing back like comet tails ----
    let k = 0;
    for (let i = 0; i < 2; i++) {
      const fig = this.figs[i]!;
      const baseC = (fig.mat.uniforms.color!.value as THREE.Color).clone().lerp(tint, 0.35 * colIn).lerp(goldCol, clamp(spread / 1.2));
      // contrails: most sparks leave the two feet, the rest anywhere on the body
      const feet = [0, 1].map((f) => fig.foot(f));
      const b0 = Math.ceil((t - SPARK_LIFE - T.s) / SPARK_DT), b1 = Math.floor((t - T.s) / SPARK_DT);
      for (let b = b0; b <= b1 && k < N_SPARK - 24; b++) {
        const r = mulberry32(b * 7919 + i * 104729 + 3);
        const te = T.s + b * SPARK_DT + r() * SPARK_DT, age = t - te;
        if (age < 0 || age > SPARK_LIFE) continue;
        const pick = r();
        const q = pick < 0.7 ? feet[pick < 0.35 ? 0 : 1]!.clone()
          : new THREE.Vector3((r() - 0.5) * 0.36, -0.9 + r() * 1.4, (r() - 0.5) * 0.2).applyMatrix4(fig.matrixWorld);
        q.z += SPARK_DRAG * age;
        q.x += (r() - 0.5) * 0.35 * age;
        q.y += (r() - 0.5) * 0.35 * age;
        // (the pink one's trail grows in with it)
        const fade = Math.pow(1 - age / SPARK_LIFE, 1.6) * smoothstep(0, 0.05, age) * (i === 0 ? smoothstep(T.s - 0.25, T.s + 0.25, te) : 1);
        this.sparks.set(k++, q.x, q.y, q.z, baseC, (0.7 + 0.7 * r()) * fade, (pick < 0.7 ? 1.3 : 0.8) + 0.8 * r());
      }
    }
    for (let b = 0; b < 24 && k < N_SPARK; b++) {
      const r = mulberry32(5000 + b);
      const te = T.touch + r() * 0.3 + b * 0.25, age = t - te;
      const cyc = age >= 0 ? age % 1.4 : -1;
      if (cyc < 0) { this.sparks.hide(k++); continue; }
      const q = hands.clone();
      q.z += SPARK_DRAG * cyc;
      q.x += (r() - 0.5) * 0.9 * cyc;
      q.y += (r() - 0.5) * 0.9 * cyc;
      this.sparks.set(k++, q.x, q.y, q.z, flareBase, 0.8 * Math.pow(1 - cyc / 1.4, 2) * touchK, 1 + r());
    }
    for (; k < N_SPARK; k++) this.sparks.hide(k);
    this.sparks.setMotion(new THREE.Vector3(0, 0, SPARK_DRAG), 1 / 45);
    this.sparks.commit();

    // ---- lyrics: one small neon line in the lower third, drifting up as it is sung (the next one comes in
    // below it); words light as they are sung ----
    const halfH = TEXT_DIST * Math.tan((FOV / 2) * DEG), halfW = halfH * (16 / 9);
    for (const ly of this.lyr) {
      const appear = ly.t0 - 0.4, gone = ly.last ? Infinity : ly.t1 + 0.7;
      const vis = t >= appear && t < gone;
      ly.neon.visible = vis;
      if (!vis) continue;
      const age = t - appear;
      const p = new THREE.Vector3((-0.44 - 0.01 * age) * halfW + noise1(t * 0.3, 200 + ly.line.i) * 0.01, (-0.74 + 0.035 * age) * halfH, -TEXT_DIST).applyQuaternion(cb.q).add(cb.pos);
      ly.neon.position.copy(p);
      ly.neon.quaternion.copy(cb.q).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, noise1(t * 0.17, 220 + ly.line.i) * 0.06, noise1(t * 0.23, 230 + ly.line.i) * 0.01)));
      const fadeOut = ly.last ? 1 : 1 - smoothstep(ly.t1 + 0.15, gone, t);
      ly.neon.sing(t, fadeOut * (1 + 0.06 * voc));
      const glass = smoothstep(appear, ly.t0, t) * fadeOut;
      for (const r of ly.neon.rows) for (const wd of r.sign.words) (wd.mat.uniforms.glass!.value as THREE.Color).copy(ly.glass).multiplyScalar(glass);
    }

    this.st.render(this.ctx.renderer, out);
    return {
      bloom: 0.9 + 0.3 * warm, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12 + 0.16 * warm,
      vignette: 0.5 - 0.15 * warm, grain: 0.05, ca: 0.6, exposure: 1 + 0.06 * warm * warm,
    };
  }
}
