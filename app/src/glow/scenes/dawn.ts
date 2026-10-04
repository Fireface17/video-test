// The final chorus at dawn (docs/glow/TREATMENT.md, «финальный припев»: «Слиться»). No words on screen. The same
// rooftop as the pre-chorus (rooftop-world.ts, read-only): his roof, sunrise straight down the crosstown street
// (the sun's disc between the buildings at the end of it), mist in the canyons, steam catching the low sun.
// He and she stand together at his parapet, hand in hand — since the break they carry each other's things: he
// her lit paper lantern, she his star sticker (lib/heroes.ts). Over the chorus their light turns gold.
//   A 171.69  close on their joined hands against the sunrise
//   B 172.49  "okay to dance": side view along his parapet — they begin to dance, hand in hand; pigeons take off
//   C 174.07  "dance": in front of them, the night still in the western sky behind them
//   D 175.66  "glowing in the dark": high behind them, down the street to the sun — the whole city is out on the
//             roofs; on "take" they raise their joined hands and a golden pulse leaves their hands
//   E 177.24  "my hand": from above the street — the wave runs out over the city and, as it reaches them, people
//             take their neighbours' hands one after another along every roof edge and across the street below;
//             a golden thread runs through the joined hands, steps roof to roof, spans the streets
//   F 178.82  "every broken piece becomes a star": low behind them, looking west — the last stars of the night
//             come loose, drift down and melt into the gold light
//   G 180.41  "look how": the two of them, close, against the sun
//   H 181.99  "beautiful": the camera rises from them along the golden threads, over the golden city, through the
//             mist and the clouds into the sky; "glowing in the dark!": everything flares gold (into drop 3)
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, lerp, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { Stardust, StardustBody } from '../lib/stardust';
import { RealFigure, loadBody } from '../lib/people';
import { applyLayers, loadMotion, type Motion } from '../lib/motion';
import { PaperLantern, StarSticker, heColor, holdIn, makeHeroes, sheColor } from '../lib/heroes';
import { RoofWorld, type Glow } from './rooftop-world';
import { Flares } from './cosmos-gfx';
import { CityChains } from './dawn-chains';
import { Birds, LastStars, Mist, Steam, Threads, flock } from './dawn-gfx';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
const sine = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x));

/** Where they stand on his roof (feet), facing east down the street to the sunrise. */
const HE = V(-0.4, 0, 11.85), SHE = V(-0.4, 0, 11.0);
const FACE = Math.PI / 2; // yaw: +x

export default class Dawn extends Scene {
  st = new Stage(46, 0.1, 16000);
  w!: RoofWorld;
  he!: RealFigure;
  she!: RealFigure;
  lantern = new PaperLantern(0.12);
  star = new StarSticker(0.06);
  M: Record<string, Motion> = {};
  chains!: CityChains;
  dust!: Stardust;
  pts = new GlowPoints(16000, 1);
  threads = new Threads(14000, 0.9);
  stars = new LastStars(420, 9);
  mist = new Mist([70, 135, 220, 340]);
  birds = new Birds(26);
  birds2 = new Birds(34);
  steam!: Steam;
  flares = new Flares(16);
  T: Record<string, number> = {};
  roof = 25.55;
  grip = V();
  sun = V(1, 0.05, 0);

  override async init() {
    const S = this.st, { lyrics } = this.ctx;
    S.bg.setRGB(0.02, 0.015, 0.02);
    const L = lyrics.linesIn(this.ctx.start - 0.5, this.ctx.end).filter((l) => l.start >= this.ctx.start - 0.5);
    const W = (li: number, wi: number, d: number) => L[li]?.words[wi]?.start ?? d;
    const s0 = this.ctx.start;
    this.T = {
      okay: W(0, 4, s0 + 1.16), dance: W(0, 6, s0 + 2.16), glowing: W(1, 2, s0 + 4.0), take: W(1, 6, s0 + 5.3), my: W(1, 7, s0 + 5.7), hand: W(1, 8, s0 + 6.07),
      broken: W(2, 1, s0 + 7.0), star: W(2, 5, s0 + 8.43), look: W(3, 0, s0 + 9.74), beautiful: W(3, 2, s0 + 10.8), glow2: W(4, 2, s0 + 13.4), dark2: W(4, 5, s0 + 16.27),
    };
    this.w = new RoofWorld({ clouds: 520 });
    S.add(this.w);
    const w = this.w, set = w.set;
    this.roof = set.heSpot.y;
    HE.y = SHE.y = this.roof;
    w.power = 1;
    const [{ he, she }, ...ms] = await Promise.all([makeHeroes(), ...['77_02', '111_28', '61_02', '60_02', '79_69'].map((c) => loadMotion(c))]);
    this.he = he; this.she = she;
    ['idleHe', 'idleShe', 'danceHe', 'danceShe', 'joy'].forEach((k, i) => (this.M[k] = ms[i]!));
    S.add(he, she, this.lantern, this.star);

    // the city's people (they take hands from the two of them outward)
    this.grip.copy(HE).lerp(SHE, 0.5).add(V(0.15, 1.0, 0));
    const T = this.T;
    this.chains = await CityChains.build(w, {
      c: this.grip, R: 430, seed: 5, tTake: T.hand - 0.25, v: 85, tUp: T.glow2 - 0.1, vUp: 140,
      avoid: (x, z) => Math.abs(x) < 7.5 && Math.abs(z) < 32,
      clips: ['77_02', '111_28', '140_06', '80_43', '141_16', '79_69', '113_04'],
    });
    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    this.dust = new Stardust([new StardustBody(new RealFigure(rp!, 'rpm', col('white')), 22000, 1), new StardustBody(new RealFigure(mi!, 'michelle', col('white')), 22000, 2)], [28, 420, 1600], { gain: 0.15 });
    // steam from her chimneys and a few vents on the roofs around
    const vents = [...set.steamFrom, ...w.anchors(10, 0, 70, ['roof'], { seed: 4, spacing: 18, max: 5 }).map((a) => a.pos.clone().add(V(0, 1.4, 0)))];
    this.steam = new Steam(vents, 26);
    S.add(this.dust, this.pts, this.threads, this.stars, this.mist, this.birds, this.birds2, this.steam, this.flares);
  }

  // ---- the two of them ----

  private pose(t: number) {
    const T = this.T, he = this.he, she = this.she, M = this.M;
    const place = (f: RealFigure, p: THREE.Vector3) => { f.position.copy(p).setY(p.y + f.hipHeight); f.rotation.set(0, FACE, 0); };
    place(he, HE); place(she, SHE);
    // they dance from "okay" (eased in), quieter while the city takes hands, again in the climax
    const d = smoothstep(T.okay - 0.2, T.dance + 0.3, t) * (1 - 0.55 * smoothstep(T.glowing, T.take, t)) + 0.35 * smoothstep(T.look, T.beautiful, t);
    const dk = clamp(d) * 0.72;
    applyLayers(he, [{ m: M.idleHe!, t: t * 0.8 + 3.1, w: 1 - dk, loop: true, face: true }, { m: M.danceHe!, t: (t - T.okay) * 0.85 + 6.0, w: dk, loop: true, face: true }]);
    applyLayers(she, [{ m: M.idleShe!, t: t * 0.8 + 1.4, w: 1 - dk, loop: true, mirror: true, face: true }, { m: M.danceShe!, t: (t - T.okay) * 0.85 + 9.0, w: dk, loop: true, mirror: true, face: true }]);
    // their inner hands joined (his left, her right); on "take" lifted together, lowered after "star"
    const lift = ease.inOutCubic(prog(t, T.take - 0.12, T.take + 0.4)) * (1 - ease.inOutCubic(prog(t, T.broken + 0.2, T.broken + 0.9)))
      + ease.inOutCubic(prog(t, T.glow2 - 0.2, T.glow2 + 0.5));
    const hs = he.spinePoint(0.19, 0.44, 0), ss = she.spinePoint(-0.19, 0.44, 0);
    const g = hs.clone().lerp(ss, 0.5).add(V(0.16 + 0.1 * clamp(lift), lerp(-0.45, 0.5, clamp(lift)), 0));
    this.grip.copy(g);
    he.reach(1, g.clone().add(V(0, 0, 0.03)), V(0.5, -0.7, -0.3));
    he.setHand(1, 0.45);
    she.reach(0, g.clone().add(V(0, 0, -0.03)), V(-0.5, -0.7, -0.3));
    she.setHand(0, 0.45);
    // he carries her lantern (right hand), she his star (left hand, held up a little on "star")
    const show = pulse(t, T.star, 0.9) * smoothstep(T.star - 0.5, T.star, t);
    he.reach(0, he.spinePoint(-0.27, 0.02, 0.24), V(-0.5, -0.7, -0.2));
    he.setHand(0, 0.75);
    holdIn(he, 0, this.lantern, 0.27);
    she.reach(1, she.spinePoint(0.17, 0.28 + 0.2 * show, 0.3 + 0.1 * show), V(0.5, -0.7, -0.3));
    she.setHand(1, 0.25);
    holdIn(she, 1, this.star, -0.02);
    this.lantern.lit = 1;
    this.lantern.time = t;
    this.lantern.update();
    this.star.level = 1.1 + 0.3 * Math.sin(t * 3) + 1.5 * show + 1.2 * pulse(t, T.hand, 0.3);
    // their light turns gold: from their joined hands outward, then all of them
    const gk = smoothstep(T.take, T.beautiful + 1.5, t);
    for (const [f, c] of [[he, heColor()], [she, sheColor()]] as [RealFigure, THREE.Color][]) {
      const u = f.mat.uniforms;
      (u.color!.value as THREE.Color).copy(c);
      (u.tint!.value as THREE.Color).copy(col('gold', 1.2).lerp(col('white', 1.2), 0.15));
      u.tintK!.value = 0.85 * gk;
      (u.gold!.value as THREE.Color).copy(col('gold', 1.3));
      (u.goldO!.value as THREE.Vector3).copy(g);
      u.goldR!.value = t > T.take ? lerp(0, 2.5, ease.outCubic(prog(t, T.take, T.hand + 1.0))) : -1;
      u.level!.value = 1.0 + 0.4 * pulse(t, T.hand, 0.4);
      f.time = t;
    }
    return g;
  }

  // ---- the camera ----

  private camera(t: number) {
    const g = this.grip, cam = this.st.cam, s0 = this.ctx.start;
    const cuts = [s0, 172.487, 174.072, 175.656, 177.239, 178.822, 180.405, 181.989];
    let shot = 0;
    for (let i = 0; i < cuts.length; i++) if (t >= cuts[i]! - (i === 0 ? 1 : 0)) shot = i;
    const k = (a: number, b: number, e = sine) => e(prog(t, a, b));
    const pos = V(), tgt = V();
    let fov = 46, roll = 0, up = Y;
    const m = HE.clone().lerp(SHE, 0.5);
    switch (shot) {
      case 0: { // A: their joined hands against the sunrise
        const u = k(s0 - 0.4, cuts[1]!);
        pos.copy(g).add(V(1.0 - 0.15 * u, -0.1 + 0.04 * u, -0.8 + 0.12 * u));
        tgt.copy(g).add(V(0, 0.08, 0.05));
        fov = 36;
        break;
      }
      case 1: { // B: side view along the parapet, her building across the street, the sun to the right
        const u = k(cuts[1]!, cuts[2]!);
        pos.copy(m).add(V(-2.4 + 0.6 * u, 1.3 + 0.1 * u, 4.2 - 0.3 * u));
        tgt.copy(m).add(V(0.3 + 0.2 * u, 0.95, -0.6));
        fov = 40;
        break;
      }
      case 2: { // C: in front of them (east, over the street), the night still in the western sky behind
        const u = k(cuts[2]!, cuts[3]!);
        pos.copy(m).add(V(4.6 - 0.6 * u, 0.55 + 0.2 * u, -1.6 + 1.0 * u));
        tgt.copy(m).add(V(0, 1.15, 0.1));
        fov = 40;
        roll = 0.02;
        break;
      }
      case 3: { // D: high behind them, down the street to the sun; the roofs full of people
        const u = k(cuts[3]!, cuts[4]!);
        pos.copy(m).add(V(-13 - 3 * u, 9 + 2 * u, -8.5));
        tgt.set(70, 17, -1);
        fov = 52;
        break;
      }
      case 4: { // E: over the street, along the roof edges across it: the wave of hands runs away from us, person by person
        const u = k(cuts[4]!, cuts[5]!);
        pos.set(lerp(5, 11, u), lerp(31.5, 32.5, u), lerp(5, 4, u));
        tgt.set(lerp(42, 50, u), 22, -10.5);
        fov = 46;
        roll = -0.03;
        break;
      }
      case 5: { // F: low behind them, looking up to the west: the last stars come loose and melt into the light
        const u = k(cuts[5]!, cuts[6]!);
        pos.copy(m).add(V(3.1 - 0.3 * u, 0.35, -0.5 + 0.2 * u));
        tgt.copy(m).add(V(-20, 12 + 4 * u, 0.5));
        fov = 58;
        roll = -0.03;
        break;
      }
      case 6: { // G: the two of them, close, against the sun
        const u = k(cuts[6]!, cuts[7]!);
        pos.copy(m).add(V(-3.2 + 0.5 * u, 1.05, 1.9 - 0.4 * u));
        tgt.copy(m).add(V(0, 1.1, -0.15));
        fov = 38;
        break;
      }
      default: { // H: the rise — along the golden threads, over the golden city, through the mist and the clouds
        const u = prog(t, cuts[7]!, this.ctx.end + 0.4);
        const h = ease.inOutCubic(u), hh = Math.pow(h, 1.6);
        pos.copy(m).add(V(lerp(-4.0, -150, h), lerp(1.6, 760, hh), lerp(-0.9, 40, h)));
        // the eye: past them toward the sun, then out over the city, then the horizon
        const look = smoothstep(0.1, 0.6, u);
        tgt.copy(m).add(V(6, 1.0, 0)).lerp(V(500, lerp(0, pos.y * 0.8, smoothstep(0.35, 1, u)), -20), look);
        fov = lerp(44, 58, smoothstep(0, 0.6, u));
        roll = 0.08 * Math.sin(u * Math.PI);
        break;
      }
    }
    pos.add(V(noise1(t * 0.5, 31) * 0.05, noise1(t * 0.45, 32) * 0.04, noise1(t * 0.4, 33) * 0.04));
    aim(cam, pos, tgt, roll, up);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    return shot;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, cam = S.cam, w = this.w, T = this.T;
    const g = this.pose(t);
    const shot = this.camera(t);
    const u = prog(t, this.ctx.start - 0.5, this.ctx.end);

    // ---- the morning: the sun rising at the end of the street, the city turning gold from their hands ----
    const el = lerp(0.03, 0.085, u);
    this.sun.set(Math.cos(el), Math.sin(el), -0.04).normalize();
    const sunC = new THREE.Color(1.0, 0.6, 0.3).lerp(new THREE.Color(1.0, 0.78, 0.45), u);
    w.setSun(this.sun, sunC);
    w.dawn = lerp(0.72, 1, smoothstep(this.ctx.start - 0.5, T.beautiful + 2, t));
    w.power = 1;
    const gr = t < T.hand ? 0 : (t - T.hand) * 130;
    w.gold(0.85 * smoothstep(T.hand, T.hand + 0.6, t), g, gr);
    w.pigeonsFly = T.okay - 0.1;

    // ---- the city's people and the golden threads ----
    const D = this.dust;
    D.time = t * 3;
    D.begin(cam);
    this.threads.begin();
    const crane = shot === 7 ? smoothstep(this.T.beautiful, this.T.beautiful + 2.5, t) : 0;
    this.chains.draw(t, cam, D, this.pts, this.threads, {
      k: 1, ptK: 2.6, near: shot === 7 ? lerp(70, 25, crane) : shot === 3 || shot === 4 ? 90 : 60, maxNear: shot === 3 || shot === 4 ? 70 : 30,
      ptSize: lerp(0.7, 2.6, crane), threadK: 1 + 0.6 * crane,
    });
    D.end();
    this.threads.end();

    // ---- the last stars of the night, birds, steam, mist ----
    this.stars.visible = t > T.broken - 1.2 && t < T.look + 0.6;
    if (this.stars.visible) this.stars.update(t, g, 600, T.broken - 0.15, 1.6, 1.4, col('white', 1.2), col('gold', 1.4).lerp(col('white', 1.4), 0.2));
    flock(this.birds, t, T.okay - 0.15, V(9, this.roof + 0.5, -16), V(1, 0.15, -0.2).normalize(), 3, 8);
    flock(this.birds2, t, T.glowing - 0.3, V(45, 32, 8), V(1, 0.05, 0.15).normalize(), 7, 30);
    this.steam.update(t, 0.35, new THREE.Color(0.32, 0.2, 0.11));
    this.mist.visible = true;
    this.mist.update(t, 0.5 + 0.3 * crane, this.sun, new THREE.Color(1.0, 0.66, 0.46).multiplyScalar(0.95 + 0.3 * crane), sunC.clone().multiplyScalar(1.6));

    // ---- light: their glow on the walls, the flash of "hand", the sun's glare, the flare into the drop ----
    this.flares.begin();
    const fl = pulse(t, T.hand, 0.18);
    if (t > T.take - 0.1) this.flares.glow(g, col('#fff4dc', 2.2), 0.4 * smoothstep(T.take - 0.1, T.take + 0.2, t) + 1.8 * fl + 1.0 * pulse(t, T.take, 0.2), 0.08 + 0.3 * fl);
    const sunP = cam.position.clone().addScaledVector(this.sun, 3000);
    const end = smoothstep(T.glow2 + 1.5, this.ctx.end - 0.25, t);
    this.flares.glow(sunP, col('#fff1d8', 1.6), 0.55 + 2.0 * end * end, 70 + 700 * end * end);
    this.flares.glow(sunP, col('gold', 1.2), 0.12 + 0.6 * end, 900, 8, 6);
    // the flare into the drop: the whole frame floods with gold from the sun
    if (end > 0.01) this.flares.glow(cam.position.clone().addScaledVector(cam.getWorldDirection(V()), 40), col('gold', 1).lerp(col('ember', 1), 0.15), 0.9 * Math.pow(end, 2.2), 80, 1, 1.2);
    this.flares.end();
    const glows: Glow[] = [
      { pos: this.he.spinePoint(0, 0.5, 0.2), color: heColor().lerp(col('gold', 1), 0.6 * smoothstep(T.take, T.beautiful, t)).multiplyScalar(0.25), radius: 2.4 },
      { pos: this.she.spinePoint(0, 0.5, 0.2), color: sheColor().lerp(col('gold', 1), 0.6 * smoothstep(T.take, T.beautiful, t)).multiplyScalar(0.22), radius: 2.2 },
      { pos: this.lantern.position.clone(), color: col('gold', 1).lerp(col('ember', 1), 0.3).multiplyScalar(1.2), radius: 3.2 },
    ];
    if (fl > 0.02) glows.push({ pos: g.clone(), color: col('white', 1.2 * fl), radius: 3 });
    w.glows(glows);
    w.cat.visible = false;
    w.update(t, cam, { wind: 0.45 });

    S.render(this.ctx.renderer, out);
    return {
      bloom: 0.85 + 0.4 * end, bloomThreshold: 0.8 - 0.2 * end, bloomRadius: 0.85, halation: 0.14, vignette: 0.42 - 0.2 * end, grain: 0.04, ca: 0.5,
      exposure: 0.88 + 0.3 * end * end, flash: 0.03 * fl + 0.04 * Math.pow(end, 3),
    };
  }
}
