// Bridge — "If you fall": they jump. On the overpass's edge at the blue hour (where scenes/overpass.ts leaves
// them), HE (blue light, her lantern in his free hand) and SHE (rose-peach) hold hands with his star between their
// palms. "And if you fall": they crouch and leap out over the avenue together; the camera falls with them, the
// railing and the deck lamps whip up past the lens, pigeons burst off the coping, the street's lights spread below.
// "I'll fall with you": instead of the street, the city below dissolves into light — a front runs out from under
// them, each window it reaches goes dark and leaves its light hanging in the air as a star, the buildings melt into
// the night — and they fall on through the window-stars, turning together like skydivers. "Through the colors and
// the blue": into a nebula of many colours (things drift past: their glowing handprints from the run, paper
// lanterns rising, five-pointed stars, the ribbons of their own trail), then out into a vast blue. "We'll be golden,
// me and you" (twice): gold spreads from their joined hands (the star between them flares) through both bodies, the
// lantern blazes, a golden light opens below them and the whole world turns gold for the dawn. The lyrics are
// written in light by a spark peeling off their trail, word by word as they are sung, in the lower third.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import type { Line } from '../../engine/lyrics';
import { Stage, aim, skyDome } from '../lib/stage';
import { col } from '../lib/palette';
import { City } from '../lib/city';
import { GlowPoints } from '../lib/points';
import { LightTrail, lineText } from '../lib/lightpaint';
import { PaperLantern, StarSticker, heColor, makeHeroes, sheColor } from '../lib/heroes';
import type { RealFigure } from '../lib/people';
import { loadSpan } from './run-motion';
import { Pigeons } from './run-props';
import { Handprints } from './run-prints';
import { standardDeck, type DeckDress } from './overpass-deck';
import { Pair } from './fall-pair';
import { CloudPuffs, puffAtlas, type PuffLook, type PuffSpec } from './fall-clouds';
import { StarStreaks } from './fall-stars';
import { nebulaMap, nebulaSphere } from './fall-sky';
import { Drifters, Ribbons } from './fall-things';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
const N_STARS = 4200, STAR_R0 = 3.5, STAR_R1 = 70, STAR_Y0 = -230, STAR_LEN = 300; // the star column, relative to them
const N_FAR = 1500;
const SPARK_DT = 0.02, SPARK_LIFE = 1.1;
const N_SPARK = 3 * Math.ceil(SPARK_LIFE / SPARK_DT + 2) + 8;
const N_WIN = 2600; // windows that become stars
const COLORS = 1, BLUE = 2, GOLD = 3, BACKDROP = 0; // nebula groups
/** The jump: CMU 13_11 from standing (frame 30) through the crouch to the top of the leap (frame 64), 30 fps,
 * played a little fast (they leave the edge on "fall,"). */
const JUMP_F0 = 30, JUMP_N = 34, JUMP_RATE = 1.3, TAKEOFF = (57 - JUMP_F0) / 30 / JUMP_RATE;

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
const splineV = (t: number, ks: [number, THREE.Vector3][]) =>
  V(spline(t, ks.map(([k, v]) => [k, v.x])), spline(t, ks.map(([k, v]) => [k, v.y])), spline(t, ks.map(([k, v]) => [k, v.z])));

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

/** Draw `scene` with the world shifted so the camera sits near the origin (precision far from it; as run-props). */
function shiftRender(renderer: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, root: THREE.Object3D, city: City | null, out: THREE.WebGLRenderTarget, bg: THREE.Color) {
  const O = V(Math.round(cam.position.x), 0, Math.round(cam.position.z));
  root.position.sub(O);
  cam.position.sub(O);
  root.updateMatrixWorld(true);
  cam.updateMatrixWorld();
  if (city) {
    const U = city.U;
    U.uOrigin.value.setFromMatrixPosition(city.matrixWorld);
    for (let i = 0; i < U.uPGlowN.value; i++) { const p = U.uPGlowP.value[i]!; p.x -= O.x; p.z -= O.z; }
  }
  renderer.setRenderTarget(out);
  renderer.setClearColor(bg, 1);
  renderer.clear(true, true, true);
  renderer.render(scene, cam);
  root.position.add(O);
  cam.position.add(O);
  root.updateMatrixWorld(true);
  cam.updateMatrixWorld();
  if (city) city.U.uOrigin.value.setFromMatrixPosition(city.matrixWorld);
}

interface Lyric { line: Line; trail: LightTrail; t0: number; t1: number; last: boolean; pen: THREE.Vector3 }
interface Win { p: THREE.Vector3; n: THREE.Vector3; c: THREE.Color; d: number; seed: number }

export default class Fall extends Scene {
  st = new Stage(50, 0.1, 9000);
  world = new THREE.Group();
  city!: City;
  he!: RealFigure;
  she!: RealFigure;
  pair!: Pair;
  star = new StarSticker(0.06);
  lantern = new PaperLantern();
  T!: Record<string, number>;
  private tab!: Float32Array;
  private tab0 = 0;
  /** The overpass: the walkway's west edge, the deck, the coping's top. */
  railX = 1135; deckY = 8.5; copeY = 8.75;
  /** Where they stand at the start (centre between them) and their mean pelvis height above the soles. */
  O0 = V();
  hip = 0.95;
  sky!: THREE.Mesh;
  nebSky!: THREE.Mesh;
  space = new THREE.Group();
  halos: THREE.Mesh[] = [];
  flare!: THREE.Mesh;
  sun!: THREE.Mesh;
  sunCore!: THREE.Mesh;
  neb!: CloudPuffs;
  stars!: StarStreaks;
  starSeed!: Float32Array;
  far!: GlowPoints;
  sparks!: StarStreaks;
  wins: Win[] = [];
  winStars!: GlowPoints;
  ring!: THREE.Mesh;
  dust!: GlowPoints;
  dustP!: Float32Array; // x, z, d, seed
  birds!: Pigeons;
  deck!: DeckDress;
  prints = new Handprints(160);
  drift!: Drifters;
  ribbons!: Ribbons;
  lyr: Lyric[] = [];
  penPts = new GlowPoints(8, 0.05);

  override async init() {
    const { lyrics, start, end } = this.ctx;
    const L = [lyrics.get('And if you fall'), lyrics.get('Through the colors'), lyrics.get('We’ll be golden', 0), lyrics.get('We’ll be golden', 1)] as const;
    const w = (l: Line, i: number) => l.words[Math.min(i, l.words.length - 1)]!.start;
    const T = (this.T = {
      s: start, e: end,
      fall1: w(L[0], 3), // "fall,": they leave the edge
      ill: w(L[0], 4), // "I'll": the city begins to dissolve
      with: w(L[0], 6), you: w(L[0], 7), l1end: L[0].end,
      through: w(L[1], 0), colors: w(L[1], 2), and: w(L[1], 3), blue: w(L[1], 5), l2end: L[1].end,
      g1: L[2].start, golden1: w(L[2], 2), g1end: L[2].end, me1: w(L[2], 3),
      g2: L[3].start, golden2: w(L[3], 2), me2: w(L[3], 3),
      jump0: start - 0.0, // clip time 0 (the crouch)
    } as Record<string, number>);
    T.takeoff = T.jump0 + TAKEOFF;
    T.peak = T.jump0 + JUMP_N / 30 / JUMP_RATE;
    T.dis0 = T.ill + 0.25; T.dis1 = T.you + 0.35; // the dissolve
    T.space = T.dis1;
    T.cityOff = T.you + 0.2; // the dark, fogged city is gone; space shows through
    // the cut to the second shot: the first downbeat (on "fall,")
    T.cut = this.ctx.audio.downbeats.find((d) => d > start + 0.3) ?? T.fall1;

    // ---- the city at the blue hour, as the overpass leaves it ----
    const S = this.st.scene;
    S.add(this.world);
    this.city = new City({ mirror: false, traffic: 0.6 });
    this.world.add(this.city);
    this.city.setMoon(V(-0.75, 0.22, 0.45));
    const U = this.city.U;
    U.skyTop.value.setRGB(0.004, 0.009, 0.032);
    U.skyHor.value.setRGB(0.045, 0.06, 0.12);
    U.uHazeCol.value.setRGB(0.05, 0.055, 0.09);
    U.uHazeNight.value.setRGB(0.015, 0.022, 0.05);
    const ov = this.city.overpass;
    if (ov) { this.deckY = ov.y; this.railX = ov.walk[0]; this.copeY = ov.coping; }
    // the deck dressed as in the break (paving, coping, railing, lamps, signs, the far bank)
    this.deck = standardDeck(this.city);
    this.world.add(this.deck);
    // their handprints along the street they ran, still glowing below
    const pc = [col('cyan', 0.8), col('white', 0.8).lerp(col('cyan', 0.8), 0.4), col('violet', 0.8).lerp(col('white', 0.8), 0.4), heColor().multiplyScalar(0.7), sheColor().multiplyScalar(0.7)];
    this.prints.scatter(80, V(645, 0, 129.47), V(1100, 0, 129.47), V(0, 0, -1), 0, 1, pc, 61, 0.8, 2.0);
    this.prints.scatter(60, V(645, 0, 110.53), V(1100, 0, 110.53), V(0, 0, 1), 0, 1, pc, 62, 0.8, 2.0);
    this.prints.build();
    this.prints.time = 100;
    this.prints.material.uniforms.gain!.value = 0.5;
    this.world.add(this.prints);

    // ---- the two of them ----
    const [{ he, she }, jump] = await Promise.all([makeHeroes(), loadSpan('13_11', JUMP_F0, JUMP_N, false)]);
    this.he = he; this.she = she;
    this.hip = (he.hipHeight + she.hipHeight) / 2;
    this.O0.set(this.railX + 0.15, this.copeY + this.hip, 121);
    this.pair = new Pair(he, she, jump, this.star, this.lantern);
    this.lantern.lit = 1;
    this.world.add(he, she, this.star, this.lantern);
    for (const c of [heColor(), sheColor()]) {
      const h = softSprite(c.clone().multiplyScalar(0.05), 3.0);
      h.renderOrder = 5;
      this.halos.push(h);
      this.world.add(h);
    }
    this.flare = softSprite(new THREE.Color(0, 0, 0), 9);
    this.flare.renderOrder = 6;
    (this.flare.material as THREE.ShaderMaterial).depthTest = false;
    this.world.add(this.flare);
    // pigeons along the coping burst away as they leap
    const r = mulberry32(41);
    const birds: { p: THREE.Vector3; t0: number; away: THREE.Vector3 }[] = [];
    for (let i = 0; i < 11; i++) {
      const z = i < 6 ? 112 + r() * 6.5 : 123.5 + r() * 7;
      birds.push({ p: V(this.railX + 0.12, this.copeY + 0.04, z), t0: T.takeoff - 0.35 + r() * 0.35 + Math.abs(z - 121) * 0.03, away: V(-0.6 - r(), 0, (z - 121) * 0.12 + (r() - 0.5) * 0.6) });
    }
    this.birds = new Pigeons(birds, col('#9fb4e0', 1));
    this.world.add(this.birds);

    // ---- the fall: distance table (D(start) = 0) ----
    const dt = 1 / 200;
    this.tab0 = start - 1;
    const n = Math.ceil((end + 2 - this.tab0) / dt) + 2;
    this.tab = new Float32Array(n);
    for (let i = 1; i < n; i++) this.tab[i] = this.tab[i - 1]! + this.speed(this.tab0 + (i - 0.5) * dt) * dt;
    const d0 = this.drop(start);
    for (let i = 0; i < n; i++) this.tab[i] = this.tab[i]! - d0;

    // ---- the windows that become stars: lit windows around where they fall ----
    const ws = this.city.anchors({ x: 1040, z: 120, r: 330, kinds: ['window'], max: 40000, seed: 5, spacing: 2.2 });
    const wr = mulberry32(77);
    const O0 = this.O0;
    const cand = ws.filter((a) => a.pos.y > 2 && a.pos.y < 140 && wr() < 0.8);
    cand.sort((a, b) => a.pos.distanceToSquared(O0) - b.pos.distanceToSquared(O0));
    for (const a of cand.slice(0, N_WIN)) {
      const warm = wr();
      const c = warm < 0.62 ? col('#ffd9a0', 1) : warm < 0.85 ? col('#fff2dc', 1) : warm < 0.93 ? col('#9fc4ff', 1) : col('#ffb36b', 1);
      this.wins.push({ p: a.pos.clone().add(V(0, a.size[1] * 0.5, 0)).addScaledVector(a.facing, 0.15), n: a.facing.clone(), c, d: Math.hypot(a.pos.x - O0.x, a.pos.z - O0.z), seed: wr() });
    }
    // street lamps near them too
    for (const l of this.city.plan.lamps) {
      const d = Math.hypot(l.x - O0.x, l.z - O0.z);
      if (d > 260 || this.wins.length >= N_WIN + 160) continue;
      this.wins.push({ p: V(l.x + (l.ax ?? 0) * 1.5, l.h ?? 8.5, l.z + (l.az ?? 0) * 1.5), n: V(0, 1, 0), c: col('#ffb060', 1.2), d, seed: wr() });
    }
    this.winStars = new GlowPoints(this.wins.length, 0.16);
    this.winStars.renderOrder = 4;
    this.world.add(this.winStars);
    // the ground under and around them: it will come apart into a dust of light where the front passes
    {
      const dr = mulberry32(83), pts: number[] = [];
      const fx = this.O0.x - 1.6, fz = this.O0.z, RR = 80;
      const inBox = (x: number, z: number) => this.city.boxes.some(([bx, bz, bw, bd]) => Math.abs(x - bx) < bw / 2 && Math.abs(z - bz) < bd / 2);
      const near = this.city.boxes.filter(([bx, bz, bw, bd]) => Math.hypot(bx - fx, bz - fz) < RR + Math.hypot(bw, bd));
      void inBox;
      for (let gx = -RR; gx <= RR; gx += 0.9) for (let gz = -RR; gz <= RR; gz += 0.9) {
        const x = fx + gx + (dr() - 0.5) * 0.9, z = fz + gz + (dr() - 0.5) * 0.9, d = Math.hypot(x - fx, z - fz);
        if (d > RR || dr() > 0.75 - 0.4 * (d / RR)) continue;
        if (near.some(([bx, bz, bw, bd]) => Math.abs(x - bx) < bw / 2 && Math.abs(z - bz) < bd / 2)) continue;
        pts.push(x, z, d, dr());
      }
      this.dustP = new Float32Array(pts);
      this.dust = new GlowPoints(pts.length / 4, 0.065);
      this.dust.renderOrder = 4;
      this.world.add(this.dust);
    }
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { R: { value: 0 }, k: { value: 0 }, col: { value: col('#cfe4ff', 1.6) } },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 col; uniform float R, k; varying vec3 vW;
        float h(vec2 p) { return fract(sin(dot(floor(p), vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          float d = length(vW.xz), w = 0.6 + R * 0.012;
          float x = (d - R) / w;
          // a thin bright front with a soft glow running ahead of it, and a faint light left behind it
          float ring = exp(-x * x) + 0.25 * exp(-x * x / 16.0) * step(0.0, x);
          gl_FragColor = vec4(col * k * ring * 0.45, 1.0);
        }`,
    }));
    // (centred under where they fall; its shader works in the plane's own coordinates)
    this.ring.position.set(this.O0.x - 1.6, 0.3, this.O0.z);
    this.ring.renderOrder = 3;
    this.world.add(this.ring);

    // ---- space below the city ----
    this.world.add(this.space);
    this.space.visible = false;
    this.sky = skyDome(col('night'), col('dusk', 0.7), col('night'), 500);
    this.nebSky = nebulaSphere(nebulaMap(512, 256, 4), 4, 470);
    this.space.add(this.sky, this.nebSky);
    this.sun = softSprite(new THREE.Color(0, 0, 0), 3.2);
    this.sun.renderOrder = -5;
    this.sunCore = softSprite(new THREE.Color(0, 0, 0), 14);
    this.sunCore.renderOrder = -4;
    this.space.add(this.sun, this.sunCore);
    this.far = new GlowPoints(N_FAR, 1.1);
    this.far.renderOrder = -6;
    const fr = mulberry32(3);
    for (let i = 0; i < N_FAR; i++) {
      const u = fr() * 2 - 1, th = fr() * TAU, R = 330;
      const c = fr() < 0.1 ? col('cyan') : fr() < 0.18 ? col('pink') : fr() < 0.3 ? col('violet') : col('#e8ecff');
      this.far.set(i, Math.sqrt(1 - u * u) * Math.cos(th) * R, u * R, Math.sqrt(1 - u * u) * Math.sin(th) * R, c, 0.35 + fr() * 0.9, 0.6 + Math.pow(fr(), 3) * 2.2);
    }
    this.far.commit();
    this.space.add(this.far);

    // nebulae at the depths they pass at the right words (world y; x, z around the line of the fall)
    const yAt = (tt: number) => this.O0.y - this.drop(tt);
    const cx = this.O0.x - 1.5, cz = this.O0.z;
    const rnd = mulberry32(23), specs: PuffSpec[] = [];
    const add = (x: number, y: number, z: number, size: number, color: THREE.Color, alpha: number, group: number) =>
      specs.push({ x: cx + x, y, z: cz + z, size, rot: rnd() * TAU, color, alpha, cell: Math.floor(rnd() * 4), group, seed: rnd() });
    const hue = (k: number) => (k < 0.5 ? col('blue') : k < 0.85 ? col('violet') : col('pink'));
    // far clouds of colour well off the line, all the way down
    for (let y = yAt(T.dis0) - 40; y > yAt(end) - 300; y -= 26) {
      const a0 = rnd() * TAU, r0 = 75 + rnd() * 70, h0 = rnd();
      for (let k = 0; k < 4; k++) {
        const a = a0 + (rnd() - 0.5) * 0.7, rr = r0 + (rnd() - 0.5) * 30, big = k === 0;
        add(Math.cos(a) * rr, y + (rnd() - 0.5) * 26, Math.sin(a) * rr, big ? 80 + rnd() * 50 : 25 + rnd() * 35,
          hue(clamp(h0 + (rnd() - 0.5) * 0.3)).multiplyScalar(big ? 0.06 + 0.05 * rnd() : 0.08 + 0.1 * rnd()), big ? 0.35 : 0.3 + 0.2 * rnd(), BACKDROP);
      }
    }
    // "Through the colors": a many-coloured nebula across the fall (pink and violet first, blue at its bottom)
    const yc0 = yAt(T.through - 0.2), yc1 = yAt(T.blue);
    for (let i = 0; i < 230; i++) {
      const a = rnd() * TAU, rr = 1.2 + Math.pow(rnd(), 1.1) * 22, u = rnd();
      const c = (rnd() < 0.5 - 0.4 * u ? col('pink') : rnd() < 0.6 ? col('violet') : rnd() < 0.7 ? col('blue') : col('cyan', 0.75)).multiplyScalar(0.12 + 0.24 * rnd());
      add(Math.cos(a) * rr, lerp(yc0, yc1, u) + (rnd() - 0.5) * 8, Math.sin(a) * rr, 3.5 + rnd() * 9, c, 0.22 + 0.3 * rnd(), COLORS);
    }
    // "and the blue": a vast blue below it
    for (let i = 0; i < 46; i++) {
      const a = rnd() * TAU, rr = 16 + rnd() * 50;
      add(Math.cos(a) * rr, yc1 - 10 - rnd() * 150, Math.sin(a) * rr, 22 + rnd() * 30, col('blue', 0.08 + 0.1 * rnd()), 0.28 + 0.15 * rnd(), BLUE);
    }
    // the golden reach below (dark gas until "golden")
    const yg = yAt(T.g1);
    for (let i = 0; i < 90; i++) {
      const a = rnd() * TAU, rr = 7 + Math.pow(rnd(), 0.9) * 42;
      add(Math.cos(a) * rr, yg - 10 - rnd() * (yg - yAt(end) + 160), Math.sin(a) * rr, 10 + rnd() * 20, col('gold').lerp(col('ember'), rnd() * 0.6).multiplyScalar(0.07 + 0.1 * rnd()), 0.28 + 0.2 * rnd(), GOLD);
    }
    this.neb = new CloudPuffs(specs, puffAtlas(128));
    this.neb.renderOrder = 1;
    (this.neb.material.uniforms.nearFade!.value as THREE.Vector2).set(1.0, 4.2);
    this.space.add(this.neb);

    // the star column streaming up past them
    this.stars = new StarStreaks(N_STARS, 0.03, { fade: 0.006, maxPx: 7 });
    this.stars.renderOrder = 2;
    this.starSeed = new Float32Array(N_STARS * 5);
    const sr = mulberry32(5);
    for (let i = 0; i < N_STARS; i++) {
      const a = sr() * TAU, rr = STAR_R0 + Math.pow(sr(), 2.2) * (STAR_R1 - STAR_R0);
      this.starSeed.set([Math.cos(a) * rr, sr() * STAR_LEN, Math.sin(a) * rr, 0.5 + Math.pow(sr(), 6) * 3, sr()], i * 5);
    }
    this.space.add(this.stars);
    // sparks off their bodies, the star and the lantern
    this.sparks = new StarStreaks(N_SPARK, 0.02, { maxPx: 6 });
    this.sparks.renderOrder = 3;
    this.world.add(this.sparks);
    // things drifting past in the colours, and the ribbons of their trail
    this.drift = new Drifters(yc0 + 6, yAt(T.g2), V(cx, 0, cz), T, (tt) => this.O0.y - this.drop(tt));
    this.space.add(this.drift);
    this.ribbons = new Ribbons(2, 40, 0.035);
    this.ribbons.renderOrder = 3;
    this.world.add(this.ribbons);

    // ---- lyrics: light-painted script in the lower third, written as each word is sung ----
    const cool = col('white', 1.0).lerp(col('cyan', 1.0), 0.35).multiplyScalar(1.15);
    const goldC = col('gold', 1.25).lerp(col('ember', 1.25), 0.1);
    L.forEach((line, i) => {
      const trail = LightTrail.text(lineText(line), 'script', 0.3, { width: 0.0105, color: i < 2 ? cool : goldC, tipLen: 0.35, seed: i * 3 + 1 });
      trail.visible = false;
      trail.renderOrder = 10;
      (trail.material as THREE.ShaderMaterial).depthTest = false;
      this.world.add(trail);
      this.lyr.push({ line, trail, t0: line.words[0]!.start, t1: line.end, last: i === 3, pen: V() });
    });
    this.penPts.renderOrder = 11;
    (this.penPts.material as THREE.ShaderMaterial).depthTest = false;
    this.world.add(this.penPts);
  }

  /** Fall speed (m/s, down): nothing on the edge; the crouch and leap are captured; from the top of the leap a
   * slow-motion fall (dream gravity), then faster through the dissolve, steady in the colours, gathering for the dawn. */
  private speed(t: number) {
    const T = this.T;
    if (t <= T.peak) return 0;
    const g = 5.2 * (t - T.peak);
    const fast = 15 + 5 * smoothstep(T.blue, T.g1 + 1, t) + 8 * smoothstep(T.golden2, T.e, t);
    return lerp(g, fast, smoothstep(T.dis0, T.dis1 + 0.8, t));
  }

  /** How far they have fallen from the top of their leap. */
  drop(t: number) {
    const tab = this.tab, n = tab.length, x = (t - this.tab0) * 200;
    if (x <= 0) return tab[0]!;
    if (x >= n - 1) return tab[n - 1]! + ((x - n + 1) / 200) * this.speed(this.tab0 + (n - 1) / 200);
    const i = Math.floor(x), f = x - i;
    return tab[i]! * (1 - f) + tab[i + 1]! * f;
  }

  /** The dissolve's front: its radius (m) around the point under them, -1 before it starts. */
  private front(t: number) {
    const T = this.T;
    if (t < T.dis0) return -1;
    return spline(t, [[T.dis0, 0], [T.with - 0.1, 55], [T.you, 150], [T.dis1 + 0.1, 420]]);
  }

  /** The centre between them (world). */
  private centre(t: number) {
    const T = this.T;
    // out over the edge after the push, then a slow drift
    const out = smoothstep(T.takeoff - 0.08, T.takeoff + 0.8, t) * 2.2 + Math.max(0, t - T.takeoff - 0.8) * 0.35;
    return this.O0.clone().add(V(-out + 0.15 * noise1(t * 0.2, 1) * smoothstep(T.dis0, T.space, t), -this.drop(t), 0.15 * noise1(t * 0.17, 2) * smoothstep(T.dis0, T.space, t)));
  }

  /** Their common orientation: upright facing west on the edge; tipping forward, belly to the ground, after the
   * leap; then turning slowly together. */
  private orient(t: number) {
    const T = this.T;
    const pitch = spline(t, [[T.peak - 0.1, 0], [T.dis0, 0.55], [T.space, 1.12], [T.colors, 1.25], [T.g1, 1.2], [T.e, 1.05]]);
    const yaw = spline(t, [[T.dis0, 0], [T.space, 0.3], [T.blue, 0.95], [T.g2, 1.45], [T.e, 1.7]]);
    const roll = 0.12 * Math.sin((t - T.space) * 0.6) * smoothstep(T.dis0, T.space, t) + 0.05 * noise1(t * 0.3, 3);
    const Q0 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(0, 1, 0), V(-1, 0, 0)));
    const qp = new THREE.Quaternion().setFromAxisAngle(V(0, 0, -1), -pitch);
    const qy = new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), yaw);
    const qr = new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), roll);
    return qy.multiply(qp).multiply(Q0).multiply(qr);
  }

  /** Gold: how far it has spread through them (m from the hands) and how warm the world is (0..1). */
  private gold(t: number) {
    const T = this.T;
    const spread = t < T.golden1 - 0.05 ? -1 : lerp(0, 3.4, prog(t, T.golden1 - 0.05, T.golden1 + 1.4, ease.outCubic));
    const warm = 0.35 * prog(t, T.golden1, T.g1end + 0.3, ease.inOutCubic) + 0.65 * smoothstep(T.g2 - 0.4, T.e - 0.1, t);
    return { spread, warm };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T, { audio } = this.ctx;
    const pad = audio.env('other', t), voc = audio.env('vocal', t);
    const { spread, warm } = this.gold(t);
    const blue = prog(t, T.blue - 0.6, T.blue + 0.8, ease.inOutCubic) * (1 - prog(t, T.g1, T.g2 + 1, ease.inOutQuad));
    const dis = smoothstep(T.dis0, T.dis1, t); // the city dissolving
    const v = this.speed(t);
    const cam = this.st.cam;

    // ---- the two of them ----
    const O = this.centre(t), Q = this.orient(t);
    const floatK = smoothstep(T.peak - 0.15, T.peak + 1.1, t);
    const open = 0.6 * prog(t, T.golden1, T.golden1 + 1.6, ease.inOutCubic) + 0.4 * prog(t, T.golden2, T.golden2 + 1.4, ease.inOutCubic);
    const look = Math.max(prog(t, T.me1 - 0.3, T.me1 + 1, ease.inOutCubic) * (1 - prog(t, T.g2 - 0.5, T.g2, ease.inOutCubic)), prog(t, T.me2 - 0.3, T.me2 + 1, ease.inOutCubic));
    const gap = lerp(0.6, 0.66, smoothstep(T.peak, T.space, t));
    const grip = V(0, lerp(-0.42, -0.04, floatK), lerp(0.16, 0.12, floatK));
    const windK = smoothstep(T.peak, T.dis0, t);
    this.pair.pose({ O, Q, gap, jumpT: clamp((t - T.jump0) * JUMP_RATE, 0, JUMP_N / 30), floatK, open, look, grip, wind: V(0, 1, 0), windK, t });
    const { he, she } = this;

    // ---- the camera ----
    this.camera(t, O, Q);

    // ---- light on them: their colours, gold spreading from the hands ----
    const hands = this.star.position.clone();
    const goldCol = col('gold', 1.25).lerp(col('ember', 1.2), 0.15);
    const colIn = prog(t, T.through - 0.5, T.through + 0.2) * (1 - prog(t, T.blue - 0.2, T.blue + 0.5));
    const tint = col('violet', 1.3).lerp(col('pink', 1.1), 0.5 + 0.5 * Math.sin(t * 2.1)).lerp(col('blue', 1.5), prog(t, T.colors + 0.3, T.blue));
    const breathe = 1 + 0.06 * pad + 0.04 * noise1(t * 1.3, 130);
    ([he, she] as RealFigure[]).forEach((fig, i) => {
      const u = fig.mat.uniforms;
      (u.tint!.value as THREE.Color).copy(tint);
      u.tintK!.value = 0.3 * colIn + 0.12 * blue;
      (u.gold!.value as THREE.Color).copy(goldCol).multiplyScalar(1 + 0.25 * warm);
      (u.goldO!.value as THREE.Vector3).copy(hands);
      u.goldR!.value = spread;
      u.level!.value = breathe * (1 + 0.1 * warm);
      const chest = fig.spinePoint(0, 0.25, 0);
      const h = this.halos[i]!;
      h.position.copy(chest).addScaledVector(V().subVectors(chest, cam.position).normalize(), 0.5);
      h.quaternion.copy(cam.quaternion);
      h.scale.setScalar(2.6 + 0.8 * warm);
      const base = (u.color!.value as THREE.Color).clone().lerp(tint, u.tintK!.value as number).lerp(goldCol, clamp(spread / 1.6));
      spriteColor(h).copy(base).multiplyScalar((0.03 + 0.05 * dis) * (1 + 0.8 * warm) * breathe);
      this.neb.setLight(i, chest, base.clone().multiplyScalar(0.6 + 0.6 * warm), 3.5 + 2 * warm);
    });
    // the star between their palms and the lantern: they flare on "golden"
    const g1 = pulse(t, T.golden1, 0.5), g2 = pulse(t, T.golden2, 0.6);
    this.star.level = 1.1 + 0.5 * dis + 2.2 * g1 + 1.6 * g2 + 1.2 * warm;
    this.lantern.lit = 1 + 1.2 * g1 + 1.4 * g2 + 0.8 * warm;
    this.lantern.time = t;
    this.lantern.update();
    const flareK = 0.25 * dis + 0.9 * g1 + 0.7 * g2 + 0.5 * warm + 0.25 * clamp(spread);
    const flareC = col('#e9ffd0').lerp(col('gold', 1.4), clamp(spread + 0.2)).multiplyScalar(flareK);
    this.flare.position.copy(hands).addScaledVector(V().subVectors(cam.position, hands).normalize(), 0.12);
    this.flare.quaternion.copy(cam.quaternion);
    this.flare.scale.setScalar(0.7 + 0.6 * warm + 0.5 * g1 + 0.4 * g2);
    spriteColor(this.flare).copy(flareC);
    this.neb.setLight(2, hands, flareC.clone().multiplyScalar(0.3).add(col('gold', 0.3 * this.lantern.lit * warm)), 2.0);

    // ---- the city: blue hour; under them a front runs out, windows going dark into stars; then it melts away ----
    const city = this.city, U = city.U;
    const cityOn = t < T.cityOff;
    city.visible = cityOn;
    if (cityOn) {
      city.dawn = 0;
      city.windowGain = 0.85;
      const R = this.front(t);
      city.power.level = 1;
      city.power.wave(0, R > 0 ? { x: this.O0.x - 1.6, z: this.O0.z, r: R, soft: 22, to: 0 } : null);
      // the night swallowing the dark city: fog thickening to the colour of the space below
      const bgC = col('night').lerp(col('blue', 0.04), 0.5);
      const fogK = Math.pow(smoothstep(T.with - 0.2, T.cityOff - 0.05, t), 2.2);
      U.fogD.value = lerp(0.0005, 0.6, fogK);
      U.fogC.value.copy(bgC);
      U.uHazeCol.value.setRGB(0.05, 0.055, 0.09).lerp(bgC, dis);
      U.uHazeNight.value.setRGB(0.015, 0.022, 0.05).lerp(bgC, dis);
      U.skyTop.value.setRGB(0.004, 0.009, 0.032).lerp(bgC, dis);
      U.skyHor.value.setRGB(0.045, 0.06, 0.12).lerp(bgC, dis);
      const fl = lerp(0.00054, 0.6, fogK);
      (city.lamps.material as THREE.ShaderMaterial).uniforms.fogDensity!.value = fl;
      (city.lampHalos.material as THREE.ShaderMaterial).uniforms.fogDensity!.value = fl;
      city.setGlows([
        { pos: he.position.clone(), color: heColor().multiplyScalar(0.14), radius: 3 },
        { pos: she.position.clone(), color: sheColor().multiplyScalar(0.14), radius: 3 },
        { pos: this.lantern.position.clone(), color: col('gold', 0.25), radius: 2.5 },
        { pos: this.star.position.clone(), color: col('phosphor', 0.12), radius: 1.5 },
        ...this.deck.lampHeads.filter((p) => Math.abs(p.z - 121) < 60).map((p) => ({ pos: p.clone().add(V(0, -0.3, 0)), color: col('#ffd6a8', 0.5), radius: 9 })),
      ]);
      const dk = this.deck, fr = dk.free;
      dk.update(t, 0);
      dk.lights.set(fr, this.lantern.position, col('gold', 0.9), 1.6);
      dk.lights.set(fr + 1, this.star.position, col('phosphor', 0.35), 0.8);
      dk.lights.set(fr + 2, he.position, heColor().multiplyScalar(0.25), 1.8);
      dk.lights.set(fr + 3, she.position, sheColor().multiplyScalar(0.25), 1.8);
      city.update(t, cam.position);
      this.birds.update(t);
    }
    this.birds.visible = t < T.dis1 - 0.25;
    this.prints.visible = this.deck.visible = cityOn;
    // the front of the dissolve, a ring of light running out across the streets from under them
    this.ring.visible = cityOn && t > T.dis0;
    if (this.ring.visible) {
      const ru = (this.ring.material as THREE.ShaderMaterial).uniforms;
      ru.R!.value = this.front(t);
      ru.k!.value = 1 - smoothstep(T.with, T.cityOff, t);
    }

    // ---- window stars: each window's light left hanging when the front passes it ----
    const W = this.winStars;
    const R = this.front(t);
    const tmp = new THREE.Color();
    this.wins.forEach((wn, i) => {
      const passed = R - wn.d; // m since the front passed it
      if (passed < 0 || t > T.g1 + 1) { W.hide(i); return; }
      const age = passed / 130; // ~s at the front's speed
      const flareW = 3.0 * Math.exp(-age * 3.5);
      // drifting off the facade, slowly
      const p = wn.p.clone().addScaledVector(wn.n, age * 0.6).add(V(noise1(wn.seed * 50 + t * 0.3, 1) * 0.3 * age, 0, noise1(wn.seed * 50 + t * 0.3, 2) * 0.3 * age));
      tmp.copy(wn.c).lerp(col('#dfe6ff'), smoothstep(0.3, 2, age) * 0.5);
      const fade = 1 - smoothstep(T.through, T.g1, t);
      W.set(i, p.x, p.y, p.z, tmp, (0.8 + 0.8 * wn.seed + flareW) * fade, (1.0 + 1.6 * Math.pow(wn.seed, 3)) * (1 + 1.6 * Math.exp(-age * 2.5)));
    });
    W.commit();
    W.visible = t > T.dis0 - 0.1;
    // the ground's dust of light: flaring where the front passes, then drifting up a little, twinkling
    const DP = this.dustP, Dn = this.dust;
    const dWarm = col('#ffcf96', 1), dCool = col('#d6e6ff', 1), dBlue = col('#8fb0ff', 1);
    const fadeD = 1 - smoothstep(T.colors, T.blue, t);
    for (let i = 0; i < Dn.n; i++) {
      const x = DP[i * 4]!, z = DP[i * 4 + 1]!, d = DP[i * 4 + 2]!, sd = DP[i * 4 + 3]!;
      const passed = R - d;
      if (passed < 0 || fadeD <= 0) { Dn.hide(i); continue; }
      const age = passed / 110;
      const y = 0.08 + age * (0.15 + 0.5 * sd);
      const c = sd < 0.2 ? dWarm : sd < 0.6 ? dCool : dBlue;
      const tw = 0.75 + 0.25 * Math.sin(t * (5 + 7 * sd) + sd * 40);
      Dn.set(i, x + noise1(sd * 30 + t * 0.4, 3) * 0.4 * age, y, z + noise1(sd * 30 + t * 0.4, 5) * 0.4 * age, c, (0.8 + 0.9 * sd + 3.0 * Math.exp(-age * 5)) * tw * fadeD, 1.0 + 1.6 * sd * sd);
    }
    Dn.commit();
    Dn.visible = t > T.dis0 && fadeD > 0;

    // ---- space ----
    const spaceOn = t > T.cityOff - 0.02;
    this.space.visible = spaceOn;
    const spaceK = smoothstep(T.cityOff - 0.05, T.cityOff + 0.75, t);
    if (spaceOn) this.spaceFrame(t, O, spaceK, blue, warm, pad, colIn);

    // ---- sparks off their bodies, the star and the lantern ----
    this.sparkFrame(t, O, v, spread, goldCol, tint, colIn);

    // ---- ribbons of their trail (her free hand, his lantern, their joined hands, their feet) ----
    const rk = smoothstep(T.cityOff, T.cityOff + 0.8, t) * 0.45;
    [
      { p: this.pair.freeHand, c: sheColor().multiplyScalar(0.55).lerp(goldCol.clone().multiplyScalar(0.55), clamp(spread / 1.2)) },
      { p: hands, c: col('#d8ffc0', 0.45).lerp(col('gold', 0.6), clamp(spread + 0.2)) },
    ].forEach((em, r) => {
      // where this point of them was a moment ago (in their own frame it barely moves): the light it left there
      const local = em.p.clone().sub(O).applyQuaternion(Q.clone().invert());
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < this.ribbons.k; i++) {
        const te = Math.max(T.cityOff - 0.3, t - i * 0.014), a = t - te;
        // (the light left in the air curls and drifts as it fades)
        // (a corkscrew: the light left in the air winds round the line of the fall, widening as it fades)
        const ph = te * 7.5 + r * 2.4, rad = 0.55 * Math.min(1, a / 0.25) + 0.4 * a;
        const curl = V(Math.cos(ph) * rad, 0, Math.sin(ph) * rad).add(V(noise1(te * 1.7 + r * 3, 61 + r), 0, noise1(te * 1.5 + r * 5, 71 + r)).multiplyScalar(0.8 * a * a));
        pts.push(local.clone().applyQuaternion(this.orient(te)).add(this.centre(te)).add(curl));
      }
      this.ribbons.set(r, pts, em.c.clone().multiplyScalar(rk));
    });
    this.ribbons.commit();

    // ---- the lyrics ----
    this.lyrics(t, voc);

    // (the city wants a floating origin; once it's gone, plain world coordinates — the gold front is in them)
    if (cityOn) shiftRender(this.ctx.renderer, this.st.scene, cam, this.world, city, out, this.st.bg);
    else this.st.render(this.ctx.renderer, out);
    return {
      bloom: 0.85 + 0.35 * warm, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12 + 0.16 * warm,
      vignette: 0.45 - 0.15 * warm, grain: 0.05, ca: 0.6, exposure: 1 + 0.06 * warm * warm,
    };
  }

  /**
   * Camera. Shot 1 (to the first downbeat): from in front of them, low, hanging in the air over the avenue — the
   * two on the edge against the paling sky, the railing and a deck lamp behind them; they crouch and leap toward
   * us. Shot 2 (the downbeat, on "fall"): above and behind them, falling with them over the edge (the railing and
   * the coping whip up past the lens), looking down street 1 — the street, its lights and the windows on both sides
   * spread below and stream up; it stays with them as the city dissolves and on into the colours, circling slowly.
   */
  private camera(t: number, O: THREE.Vector3, Q: THREE.Quaternion) {
    const T = this.T, cam = this.st.cam;
    let pos: THREE.Vector3, u: number, v: number, fov: number;
    // the subject: the point between them, a little toward their joined hands
    const subj = O.clone().lerp(this.star.position, 0.3);
    if (t < T.cut) {
      // shot 1: in front of them, low, hanging over the avenue
      const k = smoothstep(T.s, T.cut, t), lift = smoothstep(T.takeoff - 0.25, T.cut, t);
      pos = this.O0.clone().add(V(-3.6 - 0.3 * k - 0.4 * lift, -0.75 - 0.15 * lift, -3.3 - 0.2 * k));
      u = 0.12 - 0.1 * lift; v = 0.18;
      fov = 48;
    } else {
      // shot 2: behind them over the walkway; over the edge with them; falling with them a little behind, above and
      // to her side (the street, its shops and windows below); then above them, slowly circling, as they turn
      const posA = splineV(t, [
        [T.cut, V(1137.7, 10.55, 120.1)],
        [T.peak + 0.2, V(1136.5, 10.95, 119.6)],
      ]);
      const off = splineV(t, [
        [T.peak + 0.2, V(1.3, 1.4, -1.4)],
        [T.dis0 + 0.3, V(1.2, 2.0, -2.4)],
        [T.you, V(1.0, 2.7, -2.6)],
        [T.space + 0.6, V(0.8, 3.9, -2.2)],
        [T.colors, V(0.5, 4.3, -2.5)],
        [T.g1, V(-0.6, 4.0, -2.8)],
        [T.e, V(-1.9, 3.2, -2.8)],
      ]);
      // (in the colours it circles them slowly, the other way to their own turn)
      off.applyAxisAngle(V(0, 1, 0), spline(t, [[T.space, 0], [T.blue, -0.55], [T.g2, -0.95], [T.e, -1.1]]));
      const kB = ease.inOutCubic(clamp((t - T.peak) / 0.55));
      pos = posA.lerp(O.clone().add(off), kB);
      // where they sit in the frame: high and right of centre (the words have the lower left)
      u = spline(t, [[T.cut, 0.0], [T.peak + 0.3, 0.12], [T.dis0, 0.2], [T.space, 0.16], [T.e, 0.12]]);
      v = spline(t, [[T.cut, -0.1], [T.peak + 0.3, 0.05], [T.dis0, 0.18], [T.space, 0.24], [T.e, 0.2]]);
      fov = spline(t, [[T.cut, 56], [T.dis0, 60], [T.space + 0.6, 58], [T.e, 50]]);
    }
    pos.add(V(noise1(t * 0.3, 11), noise1(t * 0.27, 12), noise1(t * 0.33, 13)).multiplyScalar(0.06));
    cam.fov = fov;
    cam.updateProjectionMatrix();
    void Q;
    // aim so the subject lands at (u, v) on screen (-1..1 across, -1..1 up)
    aim(cam, pos, subj, 0);
    const r = V(1, 0, 0).applyQuaternion(cam.quaternion), up = V(0, 1, 0).applyQuaternion(cam.quaternion);
    const tanV = Math.tan((fov / 2) * DEG), tanH = tanV * cam.aspect;
    const d = subj.clone().sub(pos).normalize();
    const f = d.clone().addScaledVector(r, -u * tanH).addScaledVector(up, -v * tanV).normalize();
    aim(cam, pos, pos.clone().add(f), noise1(t * 0.19, 14) * 0.025);
    cam.updateMatrixWorld();
  }

  private spaceFrame(t: number, O: THREE.Vector3, spaceK: number, blue: number, warm: number, pad: number, colIn: number) {
    const T = this.T, cam = this.st.cam;
    this.sky.position.copy(cam.position);
    this.nebSky.position.copy(cam.position);
    this.far.position.copy(cam.position);
    // (fading in under the dissolving city)
    const sunDir = V(0.1, -1, 0.15).normalize();
    const sunK = smoothstep(T.g1 - 0.2, T.golden1 + 1.5, t) * 0.3 + 0.7 * smoothstep(T.g2 - 0.5, T.e, t);
    const su = (this.sky.material as THREE.ShaderMaterial).uniforms;
    const w2 = warm * warm, amber = col('ember', 0.05).lerp(col('gold', 0.07), w2);
    const deep = col('night').lerp(col('blue', 0.06), blue).multiplyScalar(1 - 0.85 * smoothstep(0.25, 0.75, warm)).add(amber.clone().multiplyScalar(smoothstep(0.3, 0.95, warm)));
    (su.top!.value as THREE.Color).copy(deep);
    (su.bottom!.value as THREE.Color).copy(deep).lerp(col('blue', 0.05), 0.4 * (1 - warm));
    (su.horizon!.value as THREE.Color).copy(col('dusk', 0.7).lerp(col('blue', 0.1), blue)).multiplyScalar(1 - 0.85 * smoothstep(0.25, 0.75, warm)).add(col('ember', 0.16).lerp(col('gold', 0.2), w2).multiplyScalar(smoothstep(0.3, 0.95, warm)));
    (su.glowDir!.value as THREE.Vector3).copy(sunDir);
    (su.glow!.value as THREE.Color).copy(col('gold', 1.4)).multiplyScalar(sunK * 0.9);
    this.st.bg.copy(deep).multiplyScalar(spaceK);
    const sunPos = sunDir.clone().multiplyScalar(300).add(cam.position);
    this.sun.position.copy(sunPos);
    this.sun.quaternion.copy(cam.quaternion);
    this.sun.scale.setScalar(lerp(50, 360, sunK));
    spriteColor(this.sun).copy(col('gold', 0.55).lerp(col('ember', 0.55), 0.3)).multiplyScalar(sunK * (0.7 + 0.5 * warm));
    this.sunCore.position.copy(sunPos);
    this.sunCore.quaternion.copy(cam.quaternion);
    this.sunCore.scale.setScalar(lerp(10, 46, sunK));
    spriteColor(this.sunCore).copy(col('#fff2cc', 2.2)).multiplyScalar(sunK);
    const nu = (this.nebSky.material as THREE.ShaderMaterial).uniforms;
    nu.gain!.value = (1.5 + 0.5 * blue + 1.6 * warm) * spaceK;
    (nu.tint!.value as THREE.Color).setRGB(1, 1, 1).lerp(new THREE.Color(0.6, 0.8, 1.4), blue);
    nu.gk!.value = smoothstep(0.1, 0.75, warm);
    (this.far.material as THREE.ShaderMaterial).uniforms.size!.value = 1.1 * spaceK;
    const fogC = deep.clone().lerp(col('ember', 0.05), warm);
    this.neb.setFog(fogC, 0.0065, 0.85);
    this.neb.setAmbient(new THREE.Color(0, 0, 0), col('gold', 0.5).multiplyScalar(sunK), sunDir.clone().negate());
    // nebulae
    const darkGas = col('blue', 0.05), warmGas = col('gold', 0.13).lerp(col('ember', 0.13), 0.35), blueGas = col('blue', 0.13), pc = new THREE.Color();
    const kGold = 0.12 + 2.2 * warm, kDark = 1 - smoothstep(0, 0.25, warm), kWarm = smoothstep(0.15, 0.9, warm);
    this.neb.update(cam, V(), (s, _p, o: PuffLook) => {
      let k = spaceK;
      if (s.group === GOLD) { k *= kGold; pc.copy(s.color).lerp(darkGas, kDark); }
      else if (s.group === COLORS) { k *= 1 + 0.3 * pad; pc.copy(s.color); }
      else pc.copy(s.color).lerp(blueGas, 0.75 * blue).lerp(warmGas, kWarm);
      o.r = pc.r * k; o.g = pc.g * k; o.b = pc.b * k; o.a = s.alpha * spaceK;
    }, 420);
    // the star column, streaming up past them
    const ss = this.starSeed, D = this.drop(t);
    const cWhite = col('#dfe6ff', 1.0), cBlue = col('#7f9cff', 1.0), cGold = col('gold', 1.2), cEmber = col('ember', 1.1);
    const cCyan = col('cyan', 0.9), cPink = col('pink', 0.9), cViolet = col('violet', 1.0);
    const tmp = new THREE.Color();
    const cx = this.O0.x - 1.5, cz = this.O0.z;
    for (let i = 0; i < N_STARS; i++) {
      const o = i * 5, h = ss[o + 4]!;
      const rel = STAR_Y0 + ((((ss[o + 1]! + D) % STAR_LEN) + STAR_LEN) % STAR_LEN);
      const edge = smoothstep(STAR_Y0, STAR_Y0 + 40, rel) * (1 - smoothstep(STAR_Y0 + STAR_LEN - 15, STAR_Y0 + STAR_LEN, rel));
      tmp.copy(h < 0.08 ? cCyan : h < 0.14 ? cPink : h < 0.2 ? cViolet : cWhite);
      tmp.lerp(cBlue, blue * 0.5);
      const gk = smoothstep(h * 0.7, h * 0.7 + 0.3, warm);
      tmp.lerp(h < 0.6 ? cGold : cEmber, gk);
      this.stars.set(i, cx + ss[o]!, O.y + rel, cz + ss[o + 2]!, tmp, (0.5 + 0.9 * h) * edge * (1 + 0.3 * gk) * spaceK, ss[o + 3]!);
    }
    this.stars.setMotion(V(0, this.speed(t), 0), 1 / 45);
    this.stars.commit();
    // things drifting past
    this.drift.update(t, cam, warm, colIn, blue);
  }

  private sparkFrame(t: number, O: THREE.Vector3, v: number, spread: number, goldCol: THREE.Color, tint: THREE.Color, colIn: number) {
    const T = this.T;
    let k = 0;
    const drag = (age: number, te: number) => this.drop(te + age) - this.drop(te); // left behind: they keep falling
    const emitters: { p: THREE.Vector3; c: THREE.Color; on: number }[] = [
      { p: this.lantern.position.clone(), c: col('gold', 1.0).lerp(col('ember', 1), 0.2), on: 1 },
      { p: this.star.position.clone(), c: col('phosphor', 0.9).lerp(goldCol, clamp(spread + 0.2)), on: 1 },
      { p: this.he.foot(t % 0.2 < 0.1 ? 0 : 1), c: heColor().multiplyScalar(0.8).lerp(tint, 0.35 * colIn).lerp(goldCol, clamp(spread / 1.2)), on: smoothstep(T.peak, T.dis0, t) },
    ];
    emitters.forEach((em, ei) => {
      const b0 = Math.ceil((t - SPARK_LIFE - T.s) / SPARK_DT), b1 = Math.floor((t - T.s) / SPARK_DT);
      for (let b = b0; b <= b1 && k < N_SPARK; b++) {
        const r = mulberry32(b * 7919 + ei * 104729 + 3);
        const te = T.s + b * SPARK_DT + r() * SPARK_DT, age = t - te;
        if (age < 0 || age > SPARK_LIFE) continue;
        // (the emitter's position at birth ≈ now, raised by how far they have fallen since)
        const q = em.p.clone().add(V((r() - 0.5) * 0.12, drag(age, te), (r() - 0.5) * 0.12));
        q.x += (r() - 0.5) * 0.5 * age; q.z += (r() - 0.5) * 0.5 * age;
        const fade = Math.pow(1 - age / SPARK_LIFE, 1.6) * smoothstep(0, 0.05, age) * em.on * (0.4 + 0.6 * smoothstep(T.takeoff, T.peak, te));
        this.sparks.set(k++, q.x, q.y, q.z, em.c, (0.5 + 0.7 * r()) * fade, 0.7 + 1.0 * r());
      }
    });
    for (; k < N_SPARK; k++) this.sparks.hide(k);
    this.sparks.setMotion(V(0, v, 0), 1 / 45);
    this.sparks.commit();
    void O;
  }

  /** Each line written in light in the lower third, word by word as it is sung; a spark is the pen. */
  private lyrics(t: number, voc: number) {
    const cam = this.st.cam;
    const dist = 4.0, halfH = dist * Math.tan((cam.fov / 2) * DEG), halfW = halfH * cam.aspect;
    let pk = 0;
    for (const ly of this.lyr) {
      const appear = ly.t0 - 0.05, gone = ly.last ? Infinity : ly.t1 + 0.7;
      const vis = t >= appear && t < gone;
      ly.trail.visible = vis;
      if (!vis) continue;
      const tr = ly.trail;
      // a gentle drift up as it is written, fading as the next line comes
      const age = t - ly.t0;
      const sc = Math.min(halfH / 1.6, (1.25 * halfW) / Math.max(tr.st!.width * tr.textScale, 1e-3));
      const wid = tr.st!.width * tr.textScale * sc;
      const p = V(-0.8 * halfW + wid / 2 + 0.012 * age, (-0.7 + 0.02 * age) * halfH, -dist).applyQuaternion(cam.quaternion).add(cam.position);
      tr.position.copy(p);
      tr.quaternion.copy(cam.quaternion);
      tr.scale.setScalar(sc);
      tr.reveal = tr.writtenAt(ly.line, t, 0.55);
      const fade = ly.last ? 1 : 1 - smoothstep(ly.t1 + 0.1, gone, t);
      tr.gain = fade * (1 + 0.08 * voc);
      // the pen: a bright spark at the writing point while words are being written
      const writing = tr.reveal < tr.total - 1e-4 && t > ly.t0;
      const head = tr.pointAt(tr.reveal).applyMatrix4(tr.matrixWorld);
      tr.updateMatrixWorld();
      if (writing && pk < 8) this.penPts.set(pk++, head.x, head.y, head.z, ly.last || this.lyr.indexOf(ly) >= 2 ? col('gold', 2.2) : col('#e6f6ff', 2.2), fade, 1.2);
    }
    for (; pk < 8; pk++) this.penPts.hide(pk);
    this.penPts.commit();
  }
}
