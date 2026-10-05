// The final chorus at dawn (docs/glow/TREATMENT.md, «финальный припев»: «Слиться»). No words on screen. The same
// rooftop as the pre-chorus (rooftop-world.ts, read-only): his roof, sunrise straight down the crosstown street
// (the sun's disc between the buildings at the end of it), mist in the canyons, steam catching the low sun.
// He and she stand together at his parapet, hand in hand — since the break they carry each other's things: he
// her lit paper lantern, she his star sticker (lib/heroes.ts). Over the chorus their light turns gold.
//   A 171.69  close on their joined hands against the sunrise (they arrive from the bridge already warm gold)
//   B 172.49  "okay to dance": side view along his parapet — they begin to dance, hand in hand; pigeons take off
//   C 174.07  "dance": low, from beyond the parapet, looking up at them against the morning sky
//   D 175.66  "glowing in the dark": high behind them, down the street to the sun — the city is out on the roofs;
//             on "take" they raise their joined hands and a golden pulse leaves their hands
//   E 177.24  "my hand": the neighbours on the next roof turn to each other and take hands one after another, a
//             golden thread running on through their hands and jumping across the street to
//   E'178.03  the people on the roof across, who do the same
//   E"178.82  "broken piece": wide over the golden city — the threads spread from roof to roof, across the streets
//   F 179.61  "becomes a star": low behind them, looking west — the last stars of the night, five-pointed glints,
//             come loose, drift down past us, turn gold and melt into the light
//   G 180.41  "look how": the two of them, close, against the sun
//   H 181.99  "beautiful": the camera rises from them along the golden threads, over the golden city, through the
//             mist and the clouds into the sky; "glowing in the dark!": everything flares gold (into drop 3)
// Golden hour: a strong low sun, the scene graded (cool shadows, warm highlights, contrast) with shafts of light
// from the sun through the haze (dawn-grade.ts).
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep } from '../../engine/util';
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
import { Grade } from './dawn-grade';
import { LinkGroup, type Spot } from './dawn-people';
import { RoofSet, type Bld } from './rooftop-set';
import { CityLOD } from '../lib/city-build';
import { tint } from './rooftop-people';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const sine = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x));

/** Where they stand on his roof (feet), facing east down the street to the sunrise. */
const HE = V(3.2, 0, 11.85), SHE = V(3.2, 0, 11.0);
const FACE = Math.PI / 2; // yaw: +x

export default class Dawn extends Scene {
  st = new Stage(46, 0.1, 7000);
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
  stars = new LastStars(110, 10, 9);
  grade = new Grade();
  g1!: LinkGroup;
  g2!: LinkGroup;
  b1!: Bld;
  b2!: Bld;
  mist = new Mist([150, 300]);
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
    // (cheaper: the facades switch to their simpler levels of detail sooner — the morning haze hides it)
    w.city.traverse((o) => { if (o instanceof CityLOD) for (const l of o.levels) l.distance *= 0.42; });
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
    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    // close: the neighbours on the next roof east (his side) and on the roof west of hers (across the street)
    this.b1 = set.blds.filter((b) => b.z0 > 0 && b.x0 >= 6).sort((a, b) => a.x0 - b.x0)[0]!;
    this.b2 = set.blds.filter((b) => b.z1 < 0 && b.x1 <= -6).sort((a, b) => b.x1 - a.x1)[0]!;
    const row = (b: Bld, south: boolean, n: number, seed: number): Spot[] => {
      const y = RoofSet.roofTop(b), z = south ? b.z0 + 0.8 : b.z1 - 0.8, out: Spot[] = [];
      let x = south ? b.x0 + 1.0 : b.x1 - 1.0;
      for (let k = 0; k < n; k++) {
        out.push({ pos: V(x, y, z + (hash(k, seed, 1) - 0.5) * 0.25), yaw: south ? Math.PI : 0 });
        x += (south ? 1 : -1) * (0.88 + 0.22 * hash(k, seed, 2));
      }
      return out;
    };
    const gm = await Promise.all(['77_02', '111_28', '140_06', '80_43', '113_04', '141_12'].map((c) => loadMotion(c)));
    const tints = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => tint(i, 1.0).lerp(col('gold', 1), 0.35));
    const t1 = T.hand - 0.32, t2 = t1 + 0.72;
    this.g1 = new LinkGroup([rp!, mi!], row(this.b1, true, 6, 1), gm, 21, (k) => t1 + k * 0.1, tints);
    this.g2 = new LinkGroup([rp!, mi!], row(this.b2, false, 6, 2), [gm[3]!, gm[0]!, gm[5]!, gm[1]!, gm[4]!, gm[2]!], 22, (k) => t2 + k * 0.1, tints.slice(3));
    S.add(this.g1, this.g2);
    this.chains = await CityChains.build(w, {
      c: this.grip, R: 340, seed: 5, tTake: T.hand - 0.25, v: 55, tUp: T.glow2 - 0.1, vUp: 140,
      avoid: (x, z) => Math.abs(x) < 7.5 && Math.abs(z) < 32,
      clips: ['77_02', '111_28', '140_06', '80_43', '141_16', '79_69', '113_04'],
      skip: [this.b1, this.b2],
    });
    this.dust = new Stardust([new StardustBody(new RealFigure(rp!, 'rpm', col('white')), 22000, 1), new StardustBody(new RealFigure(mi!, 'michelle', col('white')), 22000, 2)], [12, 300, 1200], { gain: 0.15 });
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
    this.lantern.lit = t < 172.487 ? 0.55 : 1;
    this.lantern.time = t;
    this.lantern.update();
    this.star.level = 1.1 + 0.3 * Math.sin(t * 3) + 1.5 * show + 1.2 * pulse(t, T.hand, 0.3);
    // their light turns gold: from their joined hands outward, then all of them
    // (they arrive from the bridge already warm gold; it deepens as the city takes hands)
    const gk = 0.62 + 0.38 * smoothstep(T.take, T.beautiful + 1.5, t);
    const shot0 = t < 172.487;
    for (const [f, c] of [[he, heColor()], [she, sheColor()]] as [RealFigure, THREE.Color][]) {
      const u = f.mat.uniforms;
      (u.color!.value as THREE.Color).copy(c);
      (u.tint!.value as THREE.Color).copy(col('gold', 1.2).lerp(col('white', 1.2), 0.15));
      u.tintK!.value = 0.88 * gk;
      (u.gold!.value as THREE.Color).copy(col('gold', 1.3));
      (u.goldO!.value as THREE.Vector3).copy(g);
      u.goldR!.value = lerp(0.5, 2.5, ease.outCubic(prog(t, T.take, T.hand + 1.0)));
      u.level!.value = (shot0 ? 0.42 : 0.62) + 0.3 * pulse(t, T.hand, 0.4);
      f.time = t;
    }
    return g;
  }

  // ---- the camera ----

  private camera(t: number) {
    const g = this.grip, cam = this.st.cam, s0 = this.ctx.start;
    const cuts = [s0, 172.487, 174.072, 175.656, 177.239, 178.03, 178.822, 179.614, 180.405, 181.989];
    let shot = 0;
    for (let i = 0; i < cuts.length; i++) if (t >= cuts[i]! - (i === 0 ? 1 : 0)) shot = i;
    const k = (a: number, b: number, e = sine) => e(prog(t, a, b));
    const pos = V(), tgt = V();
    let fov = 46, roll = 0;
    const m = HE.clone().lerp(SHE, 0.5);
    const s1 = this.g1.spots, s2 = this.g2.spots;
    switch (shot) {
      case 0: { // A: their joined hands, the sunlit street behind
        const u = k(s0 - 0.4, cuts[1]!);
        pos.copy(g).add(V(-1.0 + 0.15 * u, -0.12 + 0.04 * u, 0.95 - 0.1 * u));
        tgt.copy(g).add(V(0.9, 0.1, -0.75));
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
      case 2: { // C: low, from beyond the parapet, looking up at them against the morning sky
        const u = k(cuts[2]!, cuts[3]!);
        pos.copy(m).add(V(1.6 - 0.5 * u, 0.5, -5.0 + 0.3 * u));
        tgt.copy(m).add(V(0, 1.4, 0.3));
        fov = 42;
        roll = 0.03;
        break;
      }
      case 3: { // D: high behind them, down the street to the sun; the roofs full of people
        const u = k(cuts[3]!, cuts[4]!);
        pos.copy(m).add(V(-13 - 3 * u, 9 + 2 * u, -8.5));
        tgt.set(70, 17, -1);
        fov = 52;
        break;
      }
      case 4: { // E: the neighbours on the next roof take hands, one after another
        const u = k(cuts[4]!, cuts[5]!);
        const a = s1[0]!.pos, b = s1[s1.length - 1]!.pos;
        pos.set(a.x - 1.6 + 0.9 * u, a.y + 1.5, a.z - 4.2 + 0.3 * u);
        tgt.copy(a).lerp(b, 0.55).add(V(0, 1.0, 0));
        fov = 44;
        roll = -0.02;
        break;
      }
      case 5: { // E': the thread jumps the street; the people on the roof across take hands
        const u = k(cuts[5]!, cuts[6]!);
        const a = s2[0]!.pos, b = s2[s2.length - 1]!.pos;
        pos.set(a.x + 1.9 - 0.7 * u, a.y + 1.6, a.z + 4.4 - 0.3 * u);
        tgt.copy(a).lerp(b, 0.55).add(V(0, 1.0, 0));
        fov = 44;
        roll = 0.02;
        break;
      }
      case 6: { // E": wide over the golden city (sun behind us), the threads spreading roof to roof
        const u = k(cuts[6]!, cuts[7]!);
        pos.set(lerp(58, 50, u), lerp(58, 64, u), lerp(16, 22, u));
        tgt.set(-30, 16, -12);
        fov = 54;
        break;
      }
      case 7: { // F: low behind them, looking up to the west: the last stars come loose and melt into the light
        const u = k(cuts[7]!, cuts[8]!);
        pos.copy(m).add(V(2.6 - 0.3 * u, 0.35, -0.4 + 0.2 * u));
        tgt.copy(m).add(V(-20, 15 + 4 * u, 0.5));
        fov = 58;
        roll = -0.03;
        break;
      }
      case 8: { // G: the two of them, close, against the sun
        const u = k(cuts[8]!, cuts[9]!);
        pos.copy(m).add(V(-3.0 + 0.5 * u, 1.05, 1.0 - 0.3 * u));
        tgt.copy(m).add(V(0, 1.1, -0.15));
        fov = 38;
        break;
      }
      default: { // H: the rise — along the golden threads, over the golden city, through the mist and the clouds
        const u = prog(t, cuts[9]!, this.ctx.end + 0.4);
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
    aim(cam, pos, tgt, roll);
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
    const sunC = new THREE.Color(1.0, 0.55, 0.22).lerp(new THREE.Color(1.0, 0.7, 0.36), u);
    // golden hour: a strong low sun (lit faces gold, the rest in cool shadow), warm haze in the canyons
    w.setSun(this.sun, sunC.clone().multiplyScalar(2.3));
    w.dawn = lerp(0.82, 1, smoothstep(this.ctx.start - 0.5, T.beautiful + 2, t));
    const U = w.city.U as unknown as Record<string, THREE.IUniform>;
    (U.fogC!.value as THREE.Color).setRGB(0.5, 0.3, 0.16);
    U.uHazeD!.value = 0.0007;
    // rising, the electric city goes out in the daylight (no street lights or headlights under the mist)
    const rise = shot === 9 ? smoothstep(T.beautiful - 0.3, T.beautiful + 1.2, t) : 0;
    w.power = 1 - rise;
    for (const c of w.city.life.children) if ((c as THREE.Points).isPoints) c.visible = rise < 0.5;
    w.city.lamps.visible = rise < 0.5;
    const gr = t < T.hand ? 0 : (t - T.hand) * 130;
    w.gold(0.85 * smoothstep(T.hand, T.hand + 0.6, t), g, gr);
    w.pigeonsFly = T.okay - 0.1;

    // ---- the city's people and the golden threads ----
    const D = this.dust;
    D.time = t * 3;
    D.begin(cam);
    this.threads.begin();
    const crane = shot === 9 ? smoothstep(this.T.beautiful, this.T.beautiful + 2.5, t) : 0;
    if (false) this.chains.draw(t, cam, D, this.pts, this.threads, {
      k: 1, ptK: 2.6 - 1.4 * crane, near: shot === 9 ? lerp(70, 25, crane) : shot === 3 || shot === 6 ? 90 : 60, maxNear: shot === 3 || shot === 6 ? 24 : 14,
      ptSize: lerp(0.7, 1.6, crane), threadK: 1 - 0.75 * crane, far: crane,
    });
    D.end();

    // ---- the last stars of the night, birds, steam, mist ----
    // the close groups: the neighbours (his side), across the street (west of hers)
    const gv1 = shot >= 3 && shot <= 5, gv2 = shot >= 4 && shot <= 5;
    this.g1.visible = gv1; this.g2.visible = gv2;
    if (gv1) this.g1.update(t);
    if (gv2) this.g2.update(t);
    this.threads.begin2();
    if (gv1) this.g1.thread(this.threads, t, 1, g, this.g2.grips[0] ?? null, 3.5);
    if (gv2) this.g2.thread(this.threads, t, 1, null, null);
    this.threads.end(); this.pts.commit(0);
    this.stars.visible = t > T.broken - 0.6 && t < T.look + 0.6;
    if (this.stars.visible) this.stars.update(t, g, 600, T.broken - 0.1, 1.5, 0.6, col('white', 1.3), col('gold', 1.5).lerp(col('white', 1.5), 0.2), g.clone().add(V(-4, 0, 0)), 3.5);
    flock(this.birds, t, T.okay - 0.15, V(9, this.roof + 0.5, -16), V(1, 0.15, -0.2).normalize(), 3, 8);
    flock(this.birds2, t, T.glowing - 0.3, V(45, 32, 8), V(1, 0.05, 0.15).normalize(), 7, 30);
    this.steam.update(t, 0.35, new THREE.Color(0.32, 0.2, 0.11));
    // (the mist only matters once we rise toward it)
    this.mist.visible = shot === 9 && t > this.T.beautiful - 0.2;
    if (this.mist.visible) this.mist.update(t, 0.55 + 0.4 * crane, this.sun, new THREE.Color(1.0, 0.66, 0.46).multiplyScalar(0.95 + 0.3 * crane), sunC.clone().multiplyScalar(1.6));

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

    S.render(this.ctx.renderer, this.grade.scene);
    // (shafts: strong in the wide shots, gentle close up and among the stars; only the sun and the sky make them)
    const rays = [0.2, 0.8, 0.7, 1.1, 0.8, 0.8, 1.1, 0.35, 0.6, 0.9][shot]!;
    this.grade.render(this.ctx.renderer, cam, this.sun, out, { warm: 1, contrast: 1.18 - 0.1 * end, rays: rays + 0.6 * end, lift: 0.35, thr: shot === 9 || shot === 7 ? 2.2 : 1.1 });
    return {
      bloom: 0.85 + 0.4 * end, bloomThreshold: 0.8 - 0.2 * end, bloomRadius: 0.85, halation: 0.14, vignette: 0.45 - 0.2 * end, grain: 0.04, ca: 0.5,
      exposure: 0.95 + 0.3 * end * end, flash: 0.03 * fl + 0.04 * Math.pow(end, 3),
    };
  }
}
