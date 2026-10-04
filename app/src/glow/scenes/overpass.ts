// Break 2 — the overpass by the river at the blue hour before dawn: quiet after the run. On the walkway at the
// railing, looking down the street they ran along (street 1, its handprints still glowing far below) and over
// the city, still lit and warm, the sky behind them over the river paling. They catch their breath (it steams).
// They swap their things, slow and close, hands only: his star to her, her lantern to him. They stand together
// and look out — a tug slides down the river behind them, birds wake and cross the sky, a siren's light far off
// in the streets — then they look at each other, take hands (the star between their palms), and step up onto
// the edge, hand in hand: the bridge (scenes/fall.ts) is their jump.
//
// Bars from the downbeat at 147.05: 0–1 breath at the railing (wide, drifting); 2 the star (close on hands);
// 3 the lantern (close); 4–5 together, the camera circling slowly; 6–7 a look, hands, the step up.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, mulberry32, noise1, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { City } from '../lib/city';
import type { RealFigure } from '../lib/people';
import { PaperLantern, StarSticker, heColor, holdIn, makeHeroes, sheColor } from '../lib/heroes';
import { applyLayers, loadMotion, type Motion } from '../lib/motion';
import { GlowPoints } from '../lib/points';
import { loadSpan, type CycleMotion } from './run-motion';
import { Pigeons, mirrorOnly, placeKit, shiftRender } from './run-props';
import { Handprints } from './run-prints';
import { Breath, Tug, walkwayKit } from './overpass-props';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

export default class Overpass extends Scene {
  st = new Stage(42, 0.2, 9000);
  /** Everything in the world (the city and all), shifted to a floating origin for the draw (run-props shiftRender). */
  world = new THREE.Group();
  city!: City;
  he!: RealFigure;
  she!: RealFigure;
  idleA!: Motion;
  idleB!: Motion;
  hop!: CycleMotion;
  star = new StarSticker(0.06);
  lantern = new PaperLantern();
  breath = new Breath(260);
  prints = new Handprints(160);
  tug!: Tug;
  birds!: Pigeons;
  siren = new GlowPoints(2, 0.6);
  lamps = new GlowPoints(4, 0.5);
  lampPos: THREE.Vector3[] = [];
  D: number[] = [];
  T: Record<string, number> = {};
  /** The walkway: deck height, the west railing's x; where they stand; which way they look (F) and their right (R). */
  deckY = 8.5;
  railX = 1135;
  spot = V(1135.75, 8.5, 121);
  F = V(-1, 0, 0);
  R = V(0, 0, -1);
  yaw0 = -Math.PI / 2;

  override async init() {
    const { audio, start } = this.ctx;
    const S = this.st;
    S.bg.copy(col('night', 0.4));
    this.D = audio.downbeats.filter((d) => d >= start - 0.05).slice(0, 9);
    while (this.D.length < 9) this.D.push(this.D[this.D.length - 1]! + 1.59);
    const D = this.D, T = this.T;
    T.end = this.ctx.end;
    T.face = D[2]! - 0.35; T.give = D[2]! + 0.85; T.lantern = D[3]! + 0.95; T.back = D[4]! - 0.1;
    T.look = D[6]!; T.hands = D[6]! + 0.9; T.hop = D[7]!;

    // ---- the city at the blue hour ----
    this.city = new City({});
    S.add(this.world);
    this.world.add(this.city);
    // (the moon low in the west over the city; the sun still under the eastern horizon behind them)
    this.city.setMoon(V(-0.75, 0.22, 0.45));
    const ov = this.city.overpass as ({ y: number; walk?: [number, number] }) | null;
    if (ov) { this.deckY = ov.y; this.railX = ov.walk?.[0] ?? 1135; }
    this.spot.set(this.railX + 0.75, this.deckY, 121);
    // (until the city's overpass has its walkway: our own strip of it, with the gap in the railing)
    this.world.add(placeKit(this.city, walkwayKit(this.railX, this.deckY, 60, 200, this.spot.z), 0, 0, 0));
    for (const z of [103, 139]) this.lampPos.push(V(this.railX + 3.0, this.deckY + 6.6, z));
    this.world.add(this.lamps);
    // their handprints, still glowing down there along the street they ran
    const pc = [col('cyan', 0.8), col('white', 0.8).lerp(col('cyan', 0.8), 0.4), col('violet', 0.8).lerp(col('white', 0.8), 0.4), heColor().multiplyScalar(0.7), sheColor().multiplyScalar(0.7)];
    this.prints.scatter(80, V(645, 0, 129.47), V(1100, 0, 129.47), V(0, 0, -1), 0, 1, pc, 61, 0.8, 2.0);
    this.prints.scatter(60, V(645, 0, 110.53), V(1100, 0, 110.53), V(0, 0, 1), 0, 1, pc, 62, 0.8, 2.0);
    this.prints.build();
    this.prints.time = 100;
    this.prints.material.uniforms.gain!.value = 0.5;
    this.world.add(this.prints);

    // ---- the two of them ----
    const [{ he, she }, a, b, hop] = await Promise.all([makeHeroes(), loadMotion('111_28'), loadMotion('77_02'), loadSpan('13_11', 50, 26)]);
    this.he = he; this.she = she; this.idleA = a; this.idleB = b; this.hop = hop;
    this.world.add(he, she, this.star, this.lantern, this.breath);
    this.lantern.lit = 1;

    // ---- small life: a tug on the river behind them, birds waking, a siren far off ----
    this.tug = new Tug(this.city, 1215, 60, 2.2);
    this.world.add(this.tug);
    const r = mulberry32(31);
    const birds: { p: THREE.Vector3; t0: number; away: THREE.Vector3 }[] = [];
    for (let i = 0; i < 16; i++) birds.push({ p: V(this.railX + 0.05 + r() * 0.2, this.deckY + 1.15 + r() * 0.05, 126 + r() * 10), t0: D[4]! + 0.4 + r() * 0.5, away: V(-1 - r() * 0.5, 0, -0.4 + r() * 0.6) });
    this.birds = new Pigeons(birds, col('#9fb4e0', 1));
    this.world.add(this.birds, this.siren);
    mirrorOnly(this.city, [this.breath, this.birds, this.siren, this.prints]);
  }

  /** A point in their frame: `side` to his right (toward her), `fwd` toward the railing, `up`. */
  private P(side: number, fwd: number, up: number, o = this.spot) {
    return o.clone().addScaledVector(this.R, side).addScaledVector(this.F, fwd).addScaledVector(UP, up);
  }

  /** Breathing (rad of spine arch): fast and deep at first, slowing as they get their breath back. */
  private breathe(t: number, seed: number) {
    const a = t - this.ctx.start;
    const ph = a * 1.25 - 0.18 * a * a + seed; // ~1.25 Hz slowing to ~0.4 Hz
    const depth = 0.07 * Math.exp(-a / 6) + 0.025;
    return { v: Math.sin(ph * Math.PI * 2) * depth, ph };
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, T = this.T, D = this.D;
    const { he, she } = this;
    const u = (a: number, b: number, fn = ease.inOutCubic) => fn(clamp((t - a) / (b - a)));

    // ---- where they stand, which way they face ----
    // side by side at the railing, looking west over the city, she on his right; they turn to each other for the swap
    const turn = u(T.face, T.face + 0.8) * (1 - u(T.back, T.back + 0.9));
    const lookK = u(T.look, T.look + 0.7) * (1 - u(T.hop - 0.25, T.hop + 0.1));
    const gap = 0.55 - 0.12 * turn + 0.05 * u(T.hands, T.hands + 0.5);
    const hop = clamp((t - T.hop + 0.12) / 0.86);
    const lift = hop > 0 ? Math.sin(Math.PI * Math.min(1, hop / 0.82)) * 0.3 + 0.25 * smoothstep(0.35, 0.8, hop) : 0;
    const fwd = smoothstep(0.1, 0.8, hop) * 0.6;
    he.position.copy(this.P(-gap, fwd, he.hipHeight + lift));
    she.position.copy(this.P(gap, fwd, she.hipHeight + lift));
    he.rotation.y = this.yaw0 - (Math.PI / 2) * turn - 0.35 * lookK;
    she.rotation.y = this.yaw0 + (Math.PI / 2) * turn + 0.35 * lookK;
    // ---- motion: standing (their own idles), breathing, the hop up onto the edge ----
    const hopK = smoothstep(0, 0.15, hop) * (1 - smoothstep(0.85, 1, hop));
    applyLayers(he, [{ m: this.idleA, t: t + 3.0, w: 1 - hopK, loop: true }, { m: this.hop, t: hop * this.hop.P, w: hopK }]);
    applyLayers(she, [{ m: this.idleB, t: t + 1.0, w: 1 - hopK, loop: true, mirror: true }, { m: this.hop, t: hop * this.hop.P, w: hopK, mirror: true }]);
    const bh = this.breathe(t, 0), bs = this.breathe(t, 0.37);
    // he leans on the railing at first, getting his breath; she stands, chest heaving
    const lean = 1 - u(D[1]!, D[2]! - 0.2);
    he.setSpine(0.12 + 0.45 * lean + bh.v * 2, 0, 0.15 + 0.35 * lean + bh.v, 0);
    she.setSpine(0.06 + bs.v * 2.2, 0.02, 0.05 + bs.v * 0.8, 0);
    he.updateMatrixWorld(true); she.updateMatrixWorld(true);
    he.time = she.time = t;
    if (lean > 0.01) {
      const railTop = this.deckY + 1.08, rx = this.railX + 0.08;
      const hp = he.position.clone();
      he.reach(0, hp.clone().addScaledVector(this.R, 0.3).setY(railTop).setX(rx), V(-0.5, -0.2, -0.6));
      he.reach(1, hp.clone().addScaledVector(this.R, -0.3).setY(railTop).setX(rx), V(0.5, -0.2, -0.6));
    }
    // ---- the swap: his star to her (his right hand to her left), her lantern to him (her right to his left) ----
    const mid = he.position.clone().lerp(she.position, 0.5);
    const g1 = u(T.give - 0.75, T.give, ease.inOutQuad) * (1 - u(T.give + 0.35, T.give + 1.0));
    const pStar = mid.clone().addScaledVector(this.F, -0.28).setY(this.deckY + 1.22);
    if (g1 > 0.001) {
      he.reach(0, he.hand(0).lerp(pStar, g1), V(-0.5, -0.6, -0.3)); he.setHand(0, 0.1);
      const kS = u(T.give - 0.45, T.give - 0.05);
      she.reach(1, she.hand(1).lerp(pStar.clone().add(V(0, 0.05, 0)), kS), V(0.5, -0.6, -0.3)); she.setHand(1, 0.25 + 0.4 * u(T.give, T.give + 0.2));
    }
    const g2 = u(T.lantern - 0.8, T.lantern, ease.inOutQuad) * (1 - u(T.lantern + 0.4, T.lantern + 1.1));
    const pLan = mid.clone().addScaledVector(this.F, 0.26).setY(this.deckY + 1.18);
    if (g2 > 0.001) {
      she.reach(0, she.hand(0).lerp(pLan, g2), V(-0.5, -0.6, -0.3)); she.setHand(0, 0.7);
      const kH = u(T.lantern - 0.5, T.lantern - 0.08);
      he.reach(1, he.hand(1).lerp(pLan.clone().add(V(0, 0.02, 0)), kH * g2), V(0.5, -0.6, -0.3)); he.setHand(1, 0.3 + 0.4 * u(T.lantern, T.lantern + 0.2));
    }
    // her hand to her chest with the star (her gesture), between the swap and the end
    const chest = u(T.give + 0.6, T.give + 1.3) * (1 - u(T.lantern - 1.0, T.lantern - 0.6)) + u(T.lantern + 0.9, T.lantern + 1.6) * (1 - u(T.hands - 0.6, T.hands - 0.1));
    if (chest > 0.001) { she.reach(1, she.hand(1).lerp(she.spinePoint(0.03, 0.42, 0.2), chest), V(0.4, -0.7, -0.2)); she.setHand(1, 0.45); }
    // hands: his right with her left (the star between their palms)
    const hk = u(T.hands - 0.5, T.hands);
    if (hk > 0.001) {
      const hm = he.hand(0).lerp(she.hand(1), 0.5);
      hm.y = Math.max(hm.y, this.deckY + lift + 0.98);
      he.reach(0, he.hand(0).lerp(hm, hk), V(-0.5, -0.8, -0.2)); he.setHand(0, 0.5 * hk);
      she.reach(1, she.hand(1).lerp(hm, hk), V(0.5, -0.8, -0.2)); she.setHand(1, 0.5 * hk);
    }
    // the things in their hands
    if (t > T.give - 0.05) holdIn(she, 1, this.star, -0.02); else holdIn(he, 0, this.star, -0.02);
    if (hk > 0.5) this.star.position.copy(he.hand(0)).lerp(she.hand(1), 0.5);
    if (t > T.lantern) holdIn(he, 1, this.lantern, 0.26); else holdIn(she, 0, this.lantern, 0.26);
    const touch = Math.exp(-Math.abs(t - T.give) * 5) + Math.exp(-Math.abs(t - T.lantern) * 5) + 1.5 * Math.exp(-Math.abs(t - T.hands) * 3) * (t > T.hands - 0.2 ? 1 : 0);
    this.star.level = 1.0 + 0.8 * touch;
    this.lantern.time = t;
    this.lantern.update();

    // ---- the morning coming ----
    const dawn = 0.04 + 0.08 * clamp((t - this.ctx.start) / (T.end - this.ctx.start));
    this.city.dawn = dawn;
    this.city.power.level = 1;
    this.city.windowGain = 0.85;
    this.breath.update(t, [[he, bh.ph, 1.0], [she, bs.ph, 0.85]]);
    this.tug.update(t);
    this.birds.update(t);
    const sOn = Math.sin(t * Math.PI * 3.1) > 0;
    this.siren.set(0, 905, 1.6, 300, sOn ? col('#ff2a2a', 1) : col('#2a5cff', 1), 1.6, 1);
    this.siren.set(1, 905.6, 1.6, 300, sOn ? col('#2a5cff', 1) : col('#ff2a2a', 1), 0.9, 1);
    this.siren.commit();
    this.lampPos.forEach((p, i) => this.lamps.set(i, p.x, p.y, p.z, col('#ffd6a8', 1), 1.4 * (1 - 0.5 * dawn), 1));
    this.lamps.commit(this.lampPos.length);

    this.camera(t, mid);
    this.city.setGlows([
      { pos: he.position.clone(), color: heColor().multiplyScalar(0.14), radius: 3 },
      { pos: she.position.clone(), color: sheColor().multiplyScalar(0.14), radius: 3 },
      { pos: this.lantern.position.clone(), color: col('gold', 0.25), radius: 2.5 },
      { pos: this.star.position.clone(), color: col('phosphor', 0.12), radius: 1.5 },
      ...this.lampPos.map((p) => ({ pos: p.clone().add(V(-0.8, -0.3, 0)), color: col('#ffd6a8', 0.5), radius: 9 })),
    ]);
    this.city.update(t, S.cam.position);
    shiftRender(this.ctx.renderer, S.scene, S.cam, this.world, this.city, out, S.bg);
    return { bloom: 0.85, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.05, ca: 0.6 };
  }

  private camera(t: number, mid: THREE.Vector3) {
    const S = this.st, D = this.D, T = this.T;
    let pos: THREE.Vector3, tgt: THREE.Vector3, fov = 42, roll = 0;
    const bar = (k: number) => D[k]!;
    const ground = mid.clone().setY(this.deckY);
    if (t < bar(2)) {
      // wide along the walkway: the two at the railing, the street they ran along going away below them
      const k = ease.inOutQuad(clamp((t - this.ctx.start) / (bar(2) - this.ctx.start)));
      pos = this.P(-8.5 + 2.5 * k, -1.9, 1.9 - 0.3 * k, ground);
      tgt = this.P(0.6, 6, -1.2, ground);
      fov = 50 - 4 * k;
    } else if (t < bar(3)) {
      // close on the hands: the star, from the walkway side, the city's lights behind
      const k = ease.inOutQuad(clamp((t - bar(2)) / (bar(3) - bar(2))));
      const h = mid.clone().addScaledVector(this.F, -0.28).setY(this.deckY + 1.2);
      pos = h.clone().addScaledVector(this.F, -1.25 + 0.15 * k).addScaledVector(this.R, 0.35 - 0.2 * k).add(V(0, 0.12 - 0.04 * k, 0));
      tgt = h.clone().add(V(0, -0.02, 0));
      fov = 26 - 3 * k;
    } else if (t < bar(4)) {
      // close: the lantern, from beyond the railing, the river and the paling sky behind
      const k = ease.inOutQuad(clamp((t - bar(3)) / (bar(4) - bar(3))));
      const h = mid.clone().addScaledVector(this.F, 0.26).setY(this.deckY + 1.1);
      pos = h.clone().addScaledVector(this.F, 1.3 - 0.15 * k).addScaledVector(this.R, -0.4 + 0.25 * k).add(V(0, 0.1, 0));
      tgt = h.clone().add(V(0, -0.08, 0));
      fov = 27 - 3 * k;
    } else if (t < bar(6)) {
      // together at the railing, the camera circling slowly from behind them round to their side
      const k = ease.inOutCubic(clamp((t - bar(4)) / (bar(6) - bar(4))));
      const a = Math.PI * (0.95 - 0.55 * k), Rr = 4.4 - 0.8 * k;
      pos = ground.clone().addScaledVector(this.F, Math.cos(a) * Rr).addScaledVector(this.R, Math.sin(a) * Rr).add(V(0, 1.75 + 0.4 * Math.sin(k * 3), 0));
      tgt = ground.clone().addScaledVector(this.F, 1.5).add(V(0, 1.2, 0));
      fov = 44;
    } else {
      // behind them, low: they look at each other, take hands, and step up onto the edge, the city before them
      const k = ease.inOutQuad(clamp((t - bar(6)) / (T.end - bar(6))));
      pos = this.P(0.35, -3.4 + 0.6 * k, 1.1 - 0.15 * k, ground);
      tgt = this.P(0, 7, 1.0 + 0.6 * k, ground);
      fov = 48;
      roll = 0.01 * Math.sin(t * 0.7);
    }
    pos.add(V(noise1(t * 0.3, 1) * 0.03, noise1(t * 0.3, 2) * 0.02, noise1(t * 0.3, 3) * 0.03));
    S.cam.fov = fov;
    S.cam.updateProjectionMatrix();
    aim(S.cam, pos, tgt, roll);
  }
}
