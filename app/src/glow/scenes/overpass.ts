// Break 2 — the overpass by the river at the blue hour before dawn: quiet after the run. They catch their
// breath at the railing (their breath steams), the city behind them still lit and warm, the sky over the river
// paling. They swap their things, slow and close, hands only: his star to her, her lantern to him. They stand
// together and look out — a tug slides down the river, birds wake and cross the sky, a siren's light far off
// in the streets — then they look at each other, take hands (the star between their palms), and step up onto
// the edge, hand in hand: the bridge (scenes/fall.ts) is their jump.
//
// Bars from the downbeat at 147.05: 0–1 breath at the railing (wide, drifting); 2 the star (close on hands);
// 3 the lantern (close); 4–5 together, the camera circling slowly; 6–7 a look, hands, the step up.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, hash, keys, mulberry32, noise1, smoothstep, type Key } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { City } from '../lib/city';
import type { RealFigure } from '../lib/people';
import { PaperLantern, StarSticker, heColor, holdIn, makeHeroes, sheColor } from '../lib/heroes';
import { applyLayers, loadMotion, type Motion } from '../lib/motion';
import { GlowPoints } from '../lib/points';
import { loadSpan, type CycleMotion } from './run-motion';
import { Pigeons, mirrorOnly } from './run-props';
import { Breath, Tug, deckKit } from './overpass-props';
import { placeKit } from './run-props';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export default class Overpass extends Scene {
  st = new Stage(42, 0.2, 9000);
  city!: City;
  he!: RealFigure;
  she!: RealFigure;
  idleA!: Motion;
  idleB!: Motion;
  hop!: CycleMotion;
  star = new StarSticker(0.06);
  lantern = new PaperLantern();
  breath = new Breath(260);
  tug!: Tug;
  birds!: Pigeons;
  siren = new GlowPoints(2, 0.6);
  lamps = new GlowPoints(4, 0.5);
  lampPos: THREE.Vector3[] = [];
  D: number[] = [];
  T: Record<string, number> = {};
  /** The deck: its height, the east edge (the railing's inner face), where they stand. */
  deckY = 8.5;
  edgeX = 1152.0;
  spot = V(1151.2, 8.5, 230);

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
    S.add(this.city);
    // (the moon low in the west, behind the city; the sun still under the eastern horizon)
    this.city.setMoon(V(-0.55, 0.3, 0.75));
    const ov = this.city.overpass;
    if (ov) { this.deckY = ov.y; this.edgeX = ov.x + 8.0; }
    this.spot.set(this.edgeX - 0.8, this.deckY, 230);
    // (the overpass's deck, the parapet and railing along its east edge where they stand)
    S.add(placeKit(this.city, deckKit(this.edgeX, this.deckY, 150, 320, this.spot.z), 0, 0, 0));
    for (const z of [212, 248]) this.lampPos.push(V(this.edgeX - 0.3, this.deckY + 7.6, z));
    S.add(this.lamps);

    // ---- the two of them ----
    const [{ he, she }, a, b, hop] = await Promise.all([makeHeroes(), loadMotion('111_28'), loadMotion('77_02'), loadSpan('13_11', 50, 26)]);
    this.he = he; this.she = she; this.idleA = a; this.idleB = b; this.hop = hop;
    S.add(he, she, this.star, this.lantern, this.breath);
    this.lantern.lit = 1;

    // ---- small life: a tug on the river, birds waking, a siren far off ----
    this.tug = new Tug(this.city);
    S.add(this.tug);
    const r = mulberry32(31);
    const birds: { p: THREE.Vector3; t0: number; away: THREE.Vector3 }[] = [];
    for (let i = 0; i < 16; i++) birds.push({ p: V(this.edgeX + 0.2 + r() * 0.3, this.deckY + 1.2 + r() * 0.1, 236 + r() * 14), t0: D[4]! + 0.4 + r() * 0.5, away: V(1 + r() * 0.5, 0, -0.3 + r() * 0.6) });
    this.birds = new Pigeons(birds, col('#9fb4e0', 1));
    S.add(this.birds, this.siren);
    mirrorOnly(this.city, [this.breath, this.birds, this.siren]);
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
    // side by side facing the river (east, yaw π/2), she on his right (+z); they turn to each other for the swap
    const turn = u(T.face, T.face + 0.8) * (1 - u(T.back, T.back + 0.9));
    const lookK = u(T.look, T.look + 0.7) * (1 - u(T.hop - 0.25, T.hop + 0.1));
    const sp = this.spot;
    const gap = 0.55 - 0.12 * turn + 0.05 * u(T.hands, T.hands + 0.5);
    const hop = clamp((t - T.hop + 0.12) / 0.86);
    const lift = hop > 0 ? Math.sin(Math.PI * Math.min(1, hop / 0.82)) * 0.32 + 0.6 * smoothstep(0.35, 0.8, hop) : 0;
    const fwd = smoothstep(0.1, 0.8, hop) * 0.75;
    he.position.set(sp.x + fwd, this.deckY + he.hipHeight + lift, sp.z - gap);
    she.position.set(sp.x + fwd, this.deckY + she.hipHeight + lift, sp.z + gap);
    he.rotation.y = Math.PI / 2 - (Math.PI / 2) * turn - 0.35 * lookK;
    she.rotation.y = Math.PI / 2 + (Math.PI / 2) * turn + 0.35 * lookK;
    // ---- motion: standing (their own idles), breathing, the hop up onto the edge ----
    const hopK = smoothstep(0, 0.15, hop) * (1 - smoothstep(0.85, 1, hop));
    applyLayers(he, [{ m: this.idleA, t: t + 3.0, w: 1 - hopK, loop: true }, { m: this.hop, t: hop * this.hop.P, w: hopK }]);
    applyLayers(she, [{ m: this.idleB, t: t + 1.0, w: 1 - hopK, loop: true, mirror: true }, { m: this.hop, t: hop * this.hop.P, w: hopK, mirror: true }]);
    const bh = this.breathe(t, 0), bs = this.breathe(t, 0.37);
    // he leans on the railing at first, getting his breath; she stands, hands at her sides, chest heaving
    const lean = 1 - u(D[1]!, D[2]! - 0.2);
    he.setSpine(0.12 + 0.45 * lean + bh.v * 2, 0, 0.15 + 0.35 * lean + bh.v, 0);
    she.setSpine(0.06 + bs.v * 2.2, 0.02, 0.05 + bs.v * 0.8, 0);
    he.updateMatrixWorld(true); she.updateMatrixWorld(true);
    he.time = she.time = t;
    // his hands on the railing while he leans
    if (lean > 0.01) {
      const rail = this.deckY + 1.08;
      he.reach(0, he.position.clone().setY(rail).add(V(0.55, 0, 0.32)), V(-0.5, -0.2, -0.6));
      he.reach(1, he.position.clone().setY(rail).add(V(0.55, 0, -0.32)), V(0.5, -0.2, -0.6));
      void lean;
    }
    // ---- the swap: his star to her (his right hand to her left), her lantern to him (her right to his left) ----
    const mid = he.position.clone().lerp(she.position, 0.5);
    const g1 = u(T.give - 0.75, T.give, ease.inOutQuad) * (1 - u(T.give + 0.35, T.give + 1.0));
    const pStar = mid.clone().add(V(-0.28, -0.98 + 1.25 - he.hipHeight * 0 + 0.0, 0)).setY(this.deckY + 1.22);
    if (g1 > 0.001) {
      he.reach(0, pStar.clone().add(V(0, -0.02, -0.05)), V(-0.5, -0.6, -0.3)); he.setHand(0, 0.1);
      const kS = u(T.give - 0.45, T.give - 0.05);
      she.reach(1, she.hand(1).lerp(pStar.clone().add(V(0, 0.05, 0.06)), kS), V(-0.5, -0.6, -0.3)); she.setHand(1, 0.25 + 0.4 * u(T.give, T.give + 0.2));
    }
    const g2 = u(T.lantern - 0.8, T.lantern, ease.inOutQuad) * (1 - u(T.lantern + 0.4, T.lantern + 1.1));
    const pLan = mid.clone().add(V(0.26, 0, 0)).setY(this.deckY + 1.18);
    if (g2 > 0.001) {
      she.reach(0, she.hand(0).lerp(pLan.clone().add(V(0, 0, 0.04)), g2), V(0.5, -0.6, -0.3)); she.setHand(0, 0.7);
      const kH = u(T.lantern - 0.5, T.lantern - 0.08);
      he.reach(1, he.hand(1).lerp(pLan.clone().add(V(0, 0.02, -0.05)), kH * g2), V(0.5, -0.6, -0.3)); he.setHand(1, 0.3 + 0.4 * u(T.lantern, T.lantern + 0.2));
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
    const starWithHer = t > T.give - 0.05;
    if (starWithHer) holdIn(she, 1, this.star, -0.02); else holdIn(he, 0, this.star, -0.02);
    if (hk > 0.5) this.star.position.copy(he.hand(0)).lerp(she.hand(1), 0.5);
    const lanWithHim = t > T.lantern;
    if (lanWithHim) holdIn(he, 1, this.lantern, 0.26); else holdIn(she, 0, this.lantern, 0.26);
    const touch = Math.exp(-Math.abs(t - T.give) * 5) + Math.exp(-Math.abs(t - T.lantern) * 5) + 1.5 * Math.exp(-Math.abs(t - T.hands) * 3) * (t > T.hands - 0.2 ? 1 : 0);
    this.star.level = 1.0 + 0.8 * touch;
    this.lantern.time = t;
    this.lantern.update();

    // ---- the morning coming ----
    const dawn = 0.04 + 0.08 * clamp((t - this.ctx.start) / (T.end - this.ctx.start));
    this.city.dawn = dawn;
    this.city.power.level = 1;
    this.city.windowGain = 0.85;
    // breath: a puff on every out-breath, in front of their mouths, drifting off the river wind
    this.breath.update(t, [[he, bh.ph, 1.0], [she, bs.ph, 0.85]]);
    this.tug.update(t);
    this.birds.update(t);
    const sOn = Math.sin(t * Math.PI * 3.1) > 0;
    this.siren.set(0, 998, 1.6, 300, sOn ? col('#ff2a2a', 1) : col('#2a5cff', 1), 1.6, 1);
    this.siren.set(1, 998.6, 1.6, 300, sOn ? col('#2a5cff', 1) : col('#ff2a2a', 1), 0.9, 1);
    this.siren.commit();
    this.lampPos.forEach((p, i) => this.lamps.set(i, p.x, p.y, p.z, col('#ffd6a8', 1), 1.4 * (1 - 0.5 * dawn), 1));
    this.lamps.commit(this.lampPos.length);

    this.camera(t);
    this.city.setGlows([
      { pos: he.position.clone(), color: heColor().multiplyScalar(0.14), radius: 3 },
      { pos: she.position.clone(), color: sheColor().multiplyScalar(0.14), radius: 3 },
      { pos: this.lantern.position.clone(), color: col('gold', 0.25), radius: 2.5 },
      { pos: this.star.position.clone(), color: col('phosphor', 0.12), radius: 1.5 },
      ...this.lampPos.map((p) => ({ pos: p.clone().add(V(-0.8, 0, 0)), color: col('#ffd6a8', 0.5), radius: 9 })),
    ]);
    this.city.update(t, S.cam.position);
    S.render(this.ctx.renderer, out);
    return { bloom: 0.85, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.05, ca: 0.6 };
  }

  private camera(t: number) {
    const S = this.st, D = this.D, T = this.T, sp = this.spot;
    const mid = this.he.position.clone().lerp(this.she.position, 0.5);
    let pos: THREE.Vector3, tgt: THREE.Vector3, fov = 42, roll = 0;
    const bar = (k: number) => D[k]!;
    if (t < bar(2)) {
      // wide along the deck, from the north: the two at the railing, the river and the paling sky beyond
      const k = ease.inOutQuad(clamp((t - this.ctx.start) / (bar(2) - this.ctx.start)));
      pos = V(sp.x - 4.2 + 1.2 * k, this.deckY + 1.9 - 0.3 * k, sp.z + 8.5 - 2.5 * k);
      tgt = V(sp.x + 1.2, this.deckY + 1.15, sp.z - 0.8);
      fov = 44 - 4 * k;
    } else if (t < bar(3)) {
      // close on the hands: the star, from the city side (the river behind)
      const k = ease.inOutQuad(clamp((t - bar(2)) / (bar(3) - bar(2))));
      const h = V(mid.x - 0.28, this.deckY + 1.2, mid.z);
      pos = h.clone().add(V(-1.25 + 0.15 * k, 0.12 - 0.04 * k, 0.35 - 0.2 * k));
      tgt = h.clone().add(V(0, -0.02, 0));
      fov = 26 - 3 * k;
    } else if (t < bar(4)) {
      // close: the lantern, from the river side (the city's lights behind)
      const k = ease.inOutQuad(clamp((t - bar(3)) / (bar(4) - bar(3))));
      const h = V(mid.x + 0.26, this.deckY + 1.1, mid.z);
      pos = h.clone().add(V(1.3 - 0.15 * k, 0.1, -0.4 + 0.25 * k));
      tgt = h.clone().add(V(0, -0.08, 0));
      fov = 27 - 3 * k;
    } else if (t < bar(6)) {
      // together at the railing, the camera circling slowly from behind them round to their side
      const k = ease.inOutCubic(clamp((t - bar(4)) / (bar(6) - bar(4))));
      const a = -2.5 + 1.25 * k, R = 4.6 - 0.8 * k;
      pos = V(mid.x + Math.cos(a) * R, this.deckY + 1.75 + 0.4 * Math.sin(k * 3), mid.z + Math.sin(a) * R);
      tgt = mid.clone().add(V(0.8, 0.4, 0)).setY(this.deckY + 1.35);
      fov = 44;
    } else {
      // behind them, low: they look at each other, take hands, and step up onto the edge against the sky
      const k = ease.inOutQuad(clamp((t - bar(6)) / (T.end - bar(6))));
      pos = V(mid.x - 3.6 + 0.6 * k, this.deckY + 1.15 - 0.15 * k, mid.z + 0.35);
      tgt = V(mid.x + 6, this.deckY + 1.8 + 0.6 * k, mid.z);
      fov = 48;
      roll = 0.01 * Math.sin(t * 0.7);
    }
    pos.add(V(noise1(t * 0.3, 1) * 0.03, noise1(t * 0.3, 2) * 0.02, noise1(t * 0.3, 3) * 0.03));
    S.cam.fov = fov;
    S.cam.updateProjectionMatrix();
    aim(S.cam, pos, tgt, roll);
  }
}

void hash; void keys; void ({} as Key);
