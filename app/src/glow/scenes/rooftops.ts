// Chorus 1 on the rooftops (docs/glow/TREATMENT.md, «припев 1»: «Дотянуться»). No words on screen. The same street
// as the pre-chorus, still in the blackout; the neighbours who lit up are still glowing on their fire escapes.
//   C1  43.6  the star's light rains down; on the roof across the street SHE stands by the gap in her parapet,
//             barely glowing, her paper lantern unlit
//   C2  44.8  "okay to dance": side view across the canyon — a pane of light settles in front of her (a neighbour
//             on her fire escape lit it), she takes a hesitant step onto it; he mirrors it
//   C3  46.4  "glowing in the dark": from the street, looking up: people on both facades light up one by one and
//             each sends a pane of their light up — the bridge builds itself just ahead of the two of them
//   C4  48.0  high side view: the last steps; on "take" he holds out his hand, palm up
//   C5  49.6  wide, backlit by the moon: "my hand" — their hands meet over the street; he lifts his star to her
//             lantern and it lights
//   C6  51.2  "every broken piece": low under them, looking up: the dark sky cracks like black glass, the pieces
//             come loose and fold into five-pointed stars ("star")
//   C7  52.8  the stars rise; the camera rises with them
//   C8  54.4  "beautiful": from high above — threads of light join every glowing person in the dark city, out
//             from the two of them: a constellation drawn across the map
//   C9  57.6  "never coming down": higher still, the whole constellation
//   C10 60.8  "wake the whole town": a wave runs out from them — the city's power comes back, windows popping on
//             floor by floor, the streets, the signs
//   C11 64.0  "okay to dance": back in the street, the woken city; the neighbours wave from their fire escapes, the
//             pigeons have flown, his string lights are on; the two of them sway on the bridge, hand in hand
//   C12 67.2  "glowing in the dark": the camera pulls back and up from them over the lit city, into the drop's flash
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, keys, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { GlowLines } from '../lib/stars';
import { Crowd, type Person } from '../lib/crowd';
import { applyLayers, loadMotion, type Motion } from '../lib/motion';
import { PaperLantern, StarSticker, heColor, holdIn, makeHeroes, sheColor } from '../lib/heroes';
import type { RealFigure } from '../lib/people';
import { MOON_DIR, RoofWorld, type Glow } from './rooftop-world';
import { RoofSet } from './rooftop-set';
import { bikeMesh, farPeople, litK, overShoulder, placeKit, raiseHand, tint, type FarPerson } from './rooftop-people';
import { LightBridge, Path, Walk } from './rooftops-bridge';
import { SkyShards } from './rooftops-sky';
import { Threads } from './rooftops-threads';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Cast { p: Person; dust?: Person; color: THREE.Color; chest: () => THREE.Vector3; lit: number; pos: THREE.Vector3 }

export default class Rooftops extends Scene {
  st = new Stage(46, 0.1, 16000);
  w!: RoofWorld;
  he!: RealFigure;
  she!: RealFigure;
  star = new StarSticker(0.06);
  lantern = new PaperLantern(0.12);
  walkM!: Motion;
  idleHe!: Motion;
  idleShe!: Motion;
  swayHe!: Motion;
  swayShe!: Motion;
  walkV = 1.3;
  walkYaw = 0;
  pathHe!: Path;
  pathShe!: Path;
  wHe!: Walk;
  wShe!: Walk;
  bridge!: LightBridge;
  shards!: SkyShards;
  threads!: Threads;
  crowd = new Crowd({ dust: [40, 260, 1100], dustGain: 0.2, face: true });
  cast: Cast[] = [];
  far: FarPerson[] = [];
  rain = new GlowPoints(110, 1);
  flash = new GlowPoints(4, 1);
  /** the ring of light that runs out over the street when their hands meet */
  ring = new GlowLines(144, 0.06);
  L: Line[] = [];
  M = new THREE.Vector3();
  T: Record<string, number> = {};
  near = 1;

  override async init() {
    const S = this.st, { lyrics } = this.ctx;
    S.bg.setRGB(0.002, 0.003, 0.008);
    this.L = lyrics.linesIn(this.ctx.start - 0.3, this.ctx.end).filter((l) => l.start >= this.ctx.start - 0.4);
    const W = (li: number, wi: number) => this.L[li]!.words[wi]!.start;
    this.T = {
      okay: W(0, 4), dance: W(0, 6), glowing: W(1, 2), take: W(1, 6), my: W(1, 7), hand: W(1, 8),
      every: W(2, 0), broken: W(2, 1), piece: W(2, 2), star: W(2, 5), look: W(3, 0), beautiful: W(3, 2),
      sing: W(4, 0), down: W(4, 7), loud: W(5, 0), wake: W(5, 3), town: W(5, 6), okay2: W(6, 4), glow2: W(7, 2), dark2: W(7, 5),
    };
    this.w = new RoofWorld();
    S.add(this.w);
    const w = this.w, set = w.set;
    w.power = 0;
    const [{ he, she }, walkM, idleHe, idleShe, swayHe, swayShe] = await Promise.all([makeHeroes(), loadMotion('02_01'), loadMotion('111_28'), loadMotion('77_02'), loadMotion('05_02'), loadMotion('05_12')]);
    Object.assign(this, { he, she, walkM, idleHe, idleShe, swayHe, swayShe });
    S.add(he, she, this.star, this.lantern, this.rain, this.flash);

    // the clip's walking speed and its direction in the body's frame (so feet don't slide)
    {
      const fig = he;
      fig.position.set(0, 0, 0); fig.rotation.set(0, 0, 0); fig.updateMatrixWorld(true);
      const T = walkM.duration - 0.8;
      const hips = (tt: number) => { walkM.apply(fig, tt, { inPlace: false, face: true }); fig.updateMatrixWorld(true); return fig.bone('Hips').getWorldPosition(new THREE.Vector3()); };
      const a = hips(0.1), b = hips(0.1 + T);
      const d = b.sub(a).setY(0);
      this.walkV = Math.max(0.6, d.length() / T);
      this.walkYaw = Math.atan2(d.x, d.z);
    }

    // the bridge between the gaps, and the two paths to its middle
    const g0 = set.hisGap.clone(), g1 = set.herGap.clone();
    this.bridge = new LightBridge(g0, g1, 0.9, 16);
    S.add(this.bridge);
    this.M = this.bridge.at(0.5);
    const arc = (s0: number, s1: number) => Array.from({ length: 41 }, (_, i) => this.bridge.at(lerp(s0, s1, i / 40)));
    this.pathHe = new Path([set.heSpot.clone(), g0.clone().setX(set.heSpot.x), ...arc(0, 0.5)]);
    this.pathShe = new Path([set.sheSpot.clone(), g1.clone().setX(set.sheSpot.x), ...arc(1, 0.5)]);
    const gapHalf = 0.46;
    const T = this.T;
    const bump = (t: number, a: number, b: number, d: number) => (t > a && t < b ? (d / (b - a)) * 2 * Math.sin(Math.PI * (t - a) / (b - a)) ** 2 : 0);
    const walkV = (t: number, a: number, b: number, v: number) => v * smoothstep(a, a + 0.5, t) * (1 - smoothstep(b - 0.35, b, t));
    const vShe = (t: number) => bump(t, T.okay - 0.05, T.okay + 0.55, 0.6) + walkV(t, T.dance + 0.05, T.take - 0.12, 1.35);
    const vHe = (t: number) => bump(t, T.okay + 0.45, T.okay + 1.05, 0.6) + walkV(t, T.dance + 0.3, T.take - 0.08, 1.35);
    const t0 = this.ctx.start - 1, t1 = this.ctx.end + 1, cut = 48.0;
    const fit = (v: (t: number) => number, path: Path) => { const base = new Walk(t0, t1, v); return new Walk(t0, t1, v, [[cut, Math.max(0, path.total - gapHalf - base.total)]]); };
    this.wShe = fit(vShe, this.pathShe);
    this.wHe = fit(vHe, this.pathHe);

    // ---- people ----
    await this.crowd.init(['13_04', '77_02', '111_28', '79_74', '79_69', '79_71', '141_16', '80_43', '05_12', '94_01']);
    S.add(this.crowd);
    this.castPrechorus();
    this.castBridge();
    this.castWindows();
    this.far = farPeople(w, this.crowd, {
      c: V(0, 0, 0), r0: 30, r1: 760, n: 280, seed: 21, litFrom: 40, litSpan: 0.1, clips: ['79_71', '141_16'], spacing: 12,
      k: (t, _lit, i) => (0.55 + 0.25 * hash(i, 4)) * (1 + 0.6 * smoothstep(T.beautiful - 0.3 + (i % 9) * 0.05, T.beautiful + 1.5, t)) * (1 - 0.35 * smoothstep(T.wake, T.town + 1, t)),
      upAt: (i) => T.town + 0.3 + (i % 11) * 0.12,
    });
    // the constellation: everyone glowing, out from the two of them
    const pts = [this.M.clone().add(V(0, 1.2, 0.45)), this.M.clone().add(V(0, 1.2, -0.45)), ...this.cast.map((c) => c.pos.clone().add(V(0, 1.2, 0))), ...this.far.map((f) => f.pos.clone().add(V(0, 1.2, 0)))];
    this.threads = new Threads(pts, [0, 1], T.beautiful - 0.05, 0.1, 3, 1.4);
    S.add(this.threads);
    // the sky that breaks
    this.shards = new SkyShards(this.M.clone().add(V(0, -6, -8)), 72, 0.45, 140, 7, V(0.05, 1, -0.25).normalize(), { cam: this.M.clone().add(V(2.3, 0.4, 3.6)), look: this.M.clone().add(V(-6, 55, -22)), n: 7 });
    S.add(this.ring);
    S.add(this.shards);
    this.bike = bikeMesh(w);
    placeKit(this.bike, V(-6.4, 0.02, -3.0), Math.PI / 2 + 0.15);
    S.add(this.bike);
  }
  bike!: THREE.Mesh;

  /** The neighbours from the pre-chorus, in the same places, still glowing, watching; they wave when the power is back. */
  private castPrechorus() {
    const w = this.w, set = w.set, H = set.hers, T = this.T;
    const near = (pos: THREE.Vector3, yaw: number, body: 0 | 1, color: THREE.Color, k: number, clips: { clip: string; from: number; at?: number; speed?: number }[], offset: number, mirror = false) => {
      const kk = (t: number) => k * (1 + 0.4 * smoothstep(T.beautiful, T.beautiful + 1, t));
      const p = this.crowd.addPerson({ pos, yaw, body, color, look: 'light', offset, mirror, clips, fade: 1.0, k: (t) => this.near * kk(t) });
      const dust = this.crowd.addPerson({ pos, yaw, body, color, look: 'dust', offset, mirror, clips, fade: 1.0, k: (t) => (1 - this.near) * kk(t) });
      this.cast.push({ p, dust, color, pos, lit: 0, chest: () => (p.fig && p.fig.visible ? p.fig.spinePoint(0, 0.3, 0.1) : pos.clone().add(V(0, 1.3, 0))) });
    };
    const fz = H.z1, yG = H.gH + 2 * H.fH;
    near(V(-1.25, yG + 0.02, fz + 0.42), 0.15, 1, tint(3, 1.05), 1.1, [{ clip: '13_04', from: 0, at: 20, speed: 0.6 }, { clip: '141_16', from: T.town + 0.2, speed: 0.8 }], 0);
    w.catPose.p.set(-0.45, yG, fz + 0.62); w.catPose.yaw = 0.6;
    const L1 = set.blds.find((b) => b.z1 <= -9 && b.x1 <= -6)!;
    near(V((L1.x0 + L1.x1) / 2 + 0.5, L1.gH + L1.fH, L1.z1 + 0.62), 0.25, 0, tint(4, 0.95), 1.05, [{ clip: '111_28', from: 0 }, { clip: '141_16', from: T.town + 0.5, speed: 0.7 }], 3);
    const R1 = set.blds.find((b) => b.z1 <= -9 && b.x0 >= 6)!;
    const yC = R1.gH + 2 * R1.fH, zC = R1.z1 + 0.62, xC = (R1.x0 + R1.x1) / 2;
    near(V(xC - 0.42, yC, zC), 0.3, 0, tint(1, 0.95), 1.05, [{ clip: '77_02', from: 0 }, { clip: '79_69', from: T.town + 0.1 }], 1.5);
    near(V(xC + 0.48, yC, zC), -0.35, 1, tint(5, 0.95), 1.05, [{ clip: '79_74', from: 0 }, { clip: '05_12', from: T.okay2 - 0.3 }], 4.2, true);
    near(V(-6.6, 0.02, -4.1), 0.6, 0, tint(2, 1.0), 1.15, [{ clip: '79_71', from: 0 }, { clip: '79_69', from: T.wake + 0.3 }], 2);
    near(V(18.6, 0.12, -7.4), -0.25, 1, tint(4, 1.0), 1.1, [{ clip: '77_02', from: 0 }, { clip: '141_16', from: T.town }], 0.7);
    const edge = w.anchors(-26, -12, 10, ['roofEdge'], { seed: 2, from: V(0, 27, 10) })[0];
    near(edge ? edge.pos.clone().addScaledVector(edge.facing, -0.5) : V(-26, 16.4, -11), 0.2, 0, tint(7, 0.95), 1.05, [{ clip: '79_71', from: 0 }, { clip: '94_01', from: T.okay2 }], 6);
    const fe = w.anchors(18, -9, 3, ['fireEscape'], { seed: 1, minY: 9, maxY: 13.5 })[0];
    near(fe ? fe.pos.clone() : V(18, 12.4, -8.9), -0.4, 1, tint(6, 0.95), 1.05, [{ clip: '79_74', from: 0 }, { clip: '141_16', from: T.town + 0.4 }], 8, true);
  }

  /** People in open windows of both hero buildings: their rooms light when the power comes back, they wave. */
  private castWindows() {
    const set = this.w.set, T = this.T;
    const pick = (b: typeof set.his, floors: number[], xs: number[]) => RoofSet.windows(b).filter((a) => floors.includes(a.floor) && xs.some((x) => Math.abs(a.pos.x - x) < 0.9)).slice(0, 2);
    const wins = [...pick(set.hers, [5, 6], [3.4, -3.6]), ...pick(set.his, [6, 7], [3.9, -3.9])].slice(0, 4);
    wins.forEach((a, i) => {
      const b = i < 2 ? set.hers : set.his;
      this.w.openWindow(i, a, { light: new THREE.Color(1.0, 0.66, 0.38).multiplyScalar(0.45), depth: 3.6 });
      const pos = a.pos.clone().setY(a.pos.y - b.sill * b.fH + 0.02).addScaledVector(a.facing, -0.5);
      const color = tint(i * 2 + 1, 1.0);
      const lit = T.wake + 0.35 + i * 0.22;
      const k = (t: number) => litK(t, lit, 1.0, [], 0.4);
      const p = this.crowd.addPerson({ pos, yaw: a.facing.z > 0 ? 0 : Math.PI, body: (i % 2) as 0 | 1, color, look: 'light', offset: i * 1.7, mirror: i % 2 === 1, clips: [{ clip: '77_02', from: 0 }, { clip: '80_43', from: T.town + 0.1 + i * 0.3 }], fade: 0.7, k: (t) => this.near * k(t) * (1 + 0.4 * smoothstep(T.town, T.town + 1, t)),
        // a big wave over the head, side to side (the other hand on the sill)
        pose: (fig, t) => { const kk = ease.inOutCubic(clamp((t - T.town - 0.2 - i * 0.25) / 0.6)); if (kk > 0) raiseHand(fig, i % 2, kk, overShoulder(fig, i % 2, 0.72, 0.22 + 0.2 * Math.sin((t - T.town) * 6.5 + i), 0.15)); } });
      this.cast.push({ p, color, pos, lit, chest: () => (p.fig && p.fig.visible ? p.fig.spinePoint(0, 0.3, 0.1) : pos.clone().add(V(0, 1.3, 0))) });
    });
  }

  /** The people whose light becomes the steps: on both hero buildings' fire escapes and the neighbours'. */
  private castBridge() {
    const set = this.w.set, br = this.bridge, T = this.T;
    // her side (steps from her gap inward), his side (from his gap inward)
    const sideSpots = (who: 'his' | 'hers') => {
      const own = set.anchors.filter((a) => a.who === who && a.kind === 'escape').sort((a, b) => b.pos.y - a.pos.y);
      const b = who === 'his' ? set.his : set.hers;
      const zf = who === 'his' ? b.z0 : b.z1, s = who === 'his' ? -1 : 1;
      // the neighbours' fire escapes along the street, on the same side
      const extra = this.w.anchors(0, zf + s * 0.6, 26, ['fireEscape'], { seed: who === 'his' ? 4 : 5, spacing: 3 })
        .filter((a) => Math.sign(a.facing.z) === s && Math.abs(a.pos.x) > 7).slice(0, 4)
        .map((a) => ({ pos: a.pos.clone(), yaw: a.facing.z > 0 ? 0 : Math.PI }));
      return [...own.slice(0, 5).map((a) => ({ pos: a.pos.clone(), yaw: a.yaw })), ...extra];
    };
    const hisS = sideSpots('his'), herS = sideSpots('hers');
    const N = 16;
    const r = mulberry32(12);
    const clips = ['77_02', '79_74', '111_28', '79_71'];
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N;
      const pos = br.at(s);
      const hersSide = s > 0.5;
      // when the walker gets within ~1.4 m of it, the step must be there
      const walk = hersSide ? this.wShe : this.wHe, path = hersSide ? this.pathShe : this.pathHe;
      let dd = 0, best = 1e9;
      for (let k = 0; k <= 200; k++) { const d = (k / 200) * path.total, q = path.at(d); const e = q.distanceTo(pos); if (e < best) { best = e; dd = d; } }
      let tStep = walk.timeOf(Math.max(0, dd - 1.5));
      tStep = Math.min(Math.max(tStep, hersSide ? T.okay - 0.2 : T.okay + 0.3), T.take - 0.3);
      // (the steps beyond the walker's jump at the cut are already there when the next shot starts)
      const spot = (hersSide ? herS : hisS)[hersSide ? (N - 1 - i) % Math.max(1, herS.length) : i % Math.max(1, hisS.length)]!;
      const ci = i * 3 + 1;
      const color = tint(ci, 1.0);
      const lit = tStep - 0.85;
      const light = (hersSide ? N - 1 - i : i) < 4;
      const k = (t: number) => litK(t, lit, 1.05, [], 0.45) * (1 + 0.5 * pulse(t, lit + 0.1, 0.25));
      const cl = clips[i % clips.length]!;
      const p = this.crowd.addPerson({ pos: spot.pos.clone().add(V((r() - 0.5) * 0.6, 0, 0)), yaw: spot.yaw + (r() - 0.5) * 0.6, body: (i % 2) as 0 | 1, color, look: light ? 'light' : 'dust', offset: r() * 8, mirror: r() < 0.5, clips: [{ clip: cl, from: 0 }, { clip: '79_69', from: lit + 0.15, at: 3.2 }, { clip: '141_16', from: T.town + 0.2 + r() }], fade: 0.8, k: light ? (t) => this.near * k(t) : k });
      if (light) this.crowd.addPerson({ pos: p.pos, yaw: p.yaw, body: p.body, color, look: 'dust', offset: p.offset, mirror: p.mirror, clips: p.clips, fade: 0.8, k: (t) => (1 - this.near) * k(t) });
      this.cast.push({ p, color, pos: p.pos, lit, chest: () => (p.fig && p.fig.visible ? p.fig.spinePoint(0, 0.3, 0.1) : p.pos.clone().add(V(0, 1.3, 0))) });
      br.steps.push({ s, pos, yaw: 0, t: tStep, from: p.pos.clone().add(V(0, 1.3, 0)), color: color.clone().lerp(new THREE.Color(1, 0.8, 0.55), 0.6) });
    }
  }

  /** Pose a walker: walking along the path while moving, standing idle when not; returns the yaw it faces. */
  private walker(fig: RealFigure, path: Path, walk: Walk, idle: Motion, t: number, off: number, mirror: boolean) {
    const d = walk.at(t), v = Math.abs(walk.speed(t));
    const p = path.at(d), dir = path.dir(Math.min(d + 0.2, path.total - 0.01));
    const yaw = Math.atan2(dir.x, dir.z);
    fig.position.copy(p).setY(p.y + fig.hipHeight);
    fig.rotation.set(0, yaw - this.walkYaw, 0);
    const ww = smoothstep(0.05, 0.6, v);
    const tau = d / this.walkV + off;
    applyLayers(fig, [{ m: idle, t: t * 0.8 + off, w: 1 - ww, loop: true, mirror, face: true }, { m: this.walkM, t: tau, w: ww, loop: true, mirror, face: true }]);
    return yaw;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, cam = S.cam, w = this.w, set = w.set, T = this.T;
    const M = this.M;
    const start = this.ctx.start, end = this.ctx.end;

    // ---------------- camera ----------------
    const pos = V(0, 0, 0), tgt = V(0, 0, 0);
    let fov = 46, roll = 0, shot = 1;
    const cuts = [start, 44.8, 46.4, 48.0, 49.6, 51.2, 52.79, 54.39, 57.59, 60.79, 63.99, 67.18];
    for (let i = 0; i < cuts.length; i++) if (t >= cuts[i]! - (i === 0 ? 1 : 0)) shot = i + 1;
    const k = (a: number, b: number, e = ease.inOutQuad) => e(prog(t, a, b));
    const hs = set.heSpot, ss = set.sheSpot;
    switch (shot) {
      case 1: { const u = k(start - 0.3, 44.8); pos.copy(hs).add(V(1.1 - 0.2 * u, 2.0 - 0.1 * u, 3.8 - 0.4 * u)); tgt.copy(ss).add(V(0.1, 1.0, 0)); fov = 19 - 3 * u; break; }
      case 2: { const u = k(44.8, 46.4); pos.copy(ss).add(V(-1.3 + 0.2 * u, 1.85, -3.4 + 0.3 * u)); tgt.copy(hs).add(V(0.2, 0.9, 0)).lerp(M, 0.25 * u); fov = 26 - 2 * u; break; }
      case 3: {
        // following her out onto the bridge, from behind and above: the steps appear ahead of her, the panes fly up
        const u = k(46.4, 48.0), sp = this.pathShe.at(this.wShe.at(t));
        pos.copy(sp).add(V(-2.2 + 0.6 * u, 2.6 - 0.3 * u, -3.6 - 0.4 * u)); tgt.copy(sp).add(V(0.3, -0.6, 6.0)); fov = 58; roll = -0.03; break;
      }
      case 4: { const u = k(48.0, 49.6); pos.set(11 - 1.5 * u, 29.6 - 1.0 * u, 5.5 - 0.8 * u); tgt.copy(M).add(V(0, 0.8, 0)); fov = 42 - 4 * u; break; }
      case 5: {
        // a slow push that all but stops as their hands meet (a held breath), then drifts on and tilts up to the sky
        const u = keys(t, [[49.6, 0], [49.98, 0.5, ease.outCubic], [50.34, 0.56, ease.linear], [51.2, 1, ease.inOutCubic]]);
        pos.set(-10.5 + 1.6 * u, 26.2 - 0.2 * u, 4.4 - 0.6 * u); tgt.copy(M).add(V(0, 2.2 + 4.2 * k(50.75, 51.2, ease.inOutCubic), -2.4)); fov = 34 - 3 * u; break;
      }
      case 6: { const u = k(51.2, 52.79); pos.copy(M).add(V(2.6 - 0.6 * u, 0.4, 3.6)); tgt.copy(M).add(V(-6, 55, -22)); fov = 70; roll = -0.05; break; }
      case 7: { const u = k(52.79, 54.39, ease.inOutCubic); pos.copy(M).add(V(lerp(1.5, 6, u), lerp(1.6, 26, u), lerp(5, 16, u))); tgt.copy(M).add(V(0, lerp(55, 90, u), lerp(-14, -30, u))); fov = 62; roll = 0.05 * u; break; }
      case 8: { const u = k(54.39, 57.59, ease.linear); const a = 0.3 * u; pos.copy(M).add(V(Math.sin(a) * 60, 360 + 50 * u, 40 + Math.cos(a) * 40)); tgt.copy(M).add(V(0, 0, -40)); fov = 52; roll = 0.2 * u; break; }
      case 9: { const u = k(57.59, 60.79, ease.inOutQuad); pos.copy(M).add(V(80 + 40 * u, 520 + 200 * u, 380 + 120 * u)); tgt.copy(M).add(V(0, 0, -260)); fov = 50; break; }
      case 10: { const u = k(60.79, 63.99, ease.inOutQuad); pos.copy(M).add(V(lerp(-300, -170, u), lerp(250, 120, u), lerp(330, 210, u))); tgt.copy(M).add(V(0, lerp(10, 20, u), -120)); fov = 50; break; }
      case 11: { const u = k(63.99, 67.18); pos.copy(M).add(V(4.2 - 1.8 * u, 2.4 - 0.4 * u, 6.8 - 0.8 * u)); tgt.copy(M).add(V(0.0, -2.2 + 0.6 * u, -3.0)); fov = 54; roll = 0.02; break; }
      default: { const u = k(67.18, end + 0.25, ease.inOutCubic); pos.copy(M).add(V(lerp(3.5, 45, u), lerp(1.4, 75, u), lerp(4.5, 95, u))); tgt.copy(M).add(V(0, lerp(1.2, -10, u), lerp(0, -40, u))); fov = lerp(48, 56, u); break; }
    }
    pos.x += noise1(t * 0.5, 31) * 0.06; pos.y += noise1(t * 0.45, 32) * 0.05;
    aim(cam, pos, tgt, roll);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    this.near = shot >= 8 && shot <= 10 ? 0 : 1;

    // ---------------- the city: blackout until "wake", then the power runs out from them ----------------
    const wake0 = T.wake - 0.12;
    const pr = t < wake0 ? 0 : lerp(0, 3200, ease.inQuad(prog(t, wake0, T.town + 1.4)));
    if (t < wake0) { w.power = 0; w.powerWave(0, null); }
    else if (pr < 3200) { w.power = 0; w.powerWave(0, M, pr, 1, 160); }
    else { w.power = 1; w.powerWave(0, null); }
    w.gold(0, M, 1e9);
    w.pigeonsFly = T.wake + 0.1;

    // ---------------- the two of them ----------------
    const he = this.he, she = this.she;
    const yHe = this.walker(he, this.pathHe, this.wHe, this.idleHe, t, 0.3, false);
    const yShe = this.walker(she, this.pathShe, this.wShe, this.idleShe, t, 1.1, true);
    void yHe; void yShe;
    // C11/C12: they dance a little on the bridge, hand in hand (a dance clip blended over the idle, eased in)
    const sway = smoothstep(T.okay2 - 0.8, T.okay2 + 0.9, t);
    if (sway > 0) {
      const dw = 0.8 * sway;
      applyLayers(he, [{ m: this.idleHe, t: t * 0.8 + 0.3, w: 1 - dw, loop: true, face: true }, { m: this.swayHe, t: (t - T.okay2) * 0.85 + 6.3, w: dw, loop: true, face: true }]);
      applyLayers(she, [{ m: this.idleShe, t: t * 0.8 + 1.1, w: 1 - dw, loop: true, mirror: true, face: true }, { m: this.swayShe, t: (t - T.okay2) * 0.85 + 4.0, w: dw, loop: true, face: true }]);
    }
    // where the dance puts their free hands (before we take them over)
    const freeShe = she.hand(0), freeHe = he.hand(1);
    // her lantern in her right hand, held a little forward; his star in his left hand at his chest
    const ease2 = (a: number, d: number) => ease.inOutCubic(clamp((t - a) / d));
    const offer = ease2(T.take - 0.1, 0.45);           // he holds out his right hand, palm up
    const meet = ease2(T.my - 0.05, T.hand - T.my + 0.05); // she reaches with her left; they meet on "hand"
    const lift = ease2(T.hand + 0.05, 0.35) * (1 - ease2(T.hand + 0.85, 0.5)); // the star to the lantern, then back
    // the joined hands: over the middle of the bridge; while they dance, between their chests (they move together)
    const mid = he.spinePoint(0, 0.15, 0).lerp(she.spinePoint(0, 0.15, 0), 0.5);
    const contact = M.clone().add(V(0.24, 1.08, 0)).lerp(mid.add(V(0.28, -0.12 + 0.06 * Math.sin((t - T.okay2) * 4.2), 0)), sway);
    const pHe = he.hand(0), pShe = she.hand(1);
    const heOffer = he.spinePoint(-0.24, 0.12, 0.42);
    const heTgt = pHe.clone().lerp(heOffer, offer).lerp(contact.clone().add(V(0, 0, 0.06)), meet);
    if (offer > 0.001) { he.reach(0, heTgt, V(-0.6, -0.8, -0.2)); he.setHand(0, 0.15 + 0.2 * meet); }
    if (meet > 0.001) { she.reach(1, pShe.lerp(contact.clone().add(V(0, 0.02, -0.06)), meet), V(0.6, -0.8, -0.2)); she.setHand(1, 0.35); }
    // the lantern: in her right hand (index 0), lifted between them when he brings the star; it swings with her dance
    const lanHold = she.spinePoint(-0.2, 0.02, 0.27).lerp(M.clone().add(V(-0.26, 1.18, -0.12)), lift).lerp(freeShe, 0.75 * sway);
    she.reach(0, lanHold, V(-0.5, -0.7, -0.3));
    she.setHand(0, 0.75);
    holdIn(she, 0, this.lantern, 0.27);
    // his star in his left hand (index 1)
    const starHold = he.spinePoint(0.16, 0.28, 0.3).lerp(this.lantern.position.clone().add(V(0.02, 0.06, 0.16)), lift).lerp(freeHe, 0.8 * sway);
    he.reach(1, starHold, V(0.6, -0.7, -0.3));
    he.setHand(1, 0.25);
    holdIn(he, 1, this.star, -0.02);
    // the lantern lights from his star
    const tLit = T.hand + 0.38;
    // it catches: a flare as the flame takes, then a steady warm light
    this.lantern.lit = ease.outCubic(prog(t, tLit, tLit + 0.45)) + 0.9 * pulse(t, tLit + 0.05, 0.22);
    this.lantern.time = t;
    this.lantern.update();
    this.star.level = 0.9 + 1.2 * smoothstep(start - 0.3, start + 0.6, t) * (1 - smoothstep(start + 0.6, start + 2.0, t)) + 2.5 * pulse(t, tLit, 0.2) + 0.15 * Math.sin(t * 3);
    he.time = she.time = t;
    // she is barely glowing until he reaches her; then brighter, and both warm a little where their hands meet
    const herLevel = lerp(0.35, 0.75, smoothstep(T.okay, T.take, t)) + 0.35 * smoothstep(T.hand, T.hand + 1, t) + 0.25 * smoothstep(T.wake, T.town, t);
    she.mat.uniforms.level!.value = herLevel + 0.6 * pulse(t, T.hand, 0.3);
    he.mat.uniforms.level!.value = 0.95 + 0.2 * smoothstep(T.hand, T.hand + 1, t) + 0.6 * pulse(t, T.hand, 0.3);
    for (const [fig, o] of [[he, contact], [she, contact]] as [RealFigure, THREE.Vector3][]) {
      const u = fig.mat.uniforms;
      (u.gold!.value as THREE.Color).copy(col('gold', 1.15));
      (u.goldO!.value as THREE.Vector3).copy(o);
      u.goldR!.value = t > T.hand ? lerp(-0.2, 0.55, ease.outCubic(prog(t, T.hand, T.hand + 1.2))) + 1.2 * pulse(t, T.hand, 0.35) : -1;
    }

    // ---------------- the bridge, the light rain, the flash where hands meet ----------------
    this.bridge.update(t, 1 + 0.4 * smoothstep(T.beautiful, T.beautiful + 1, t), V(0, 0, -1), { p: this.lantern.position, k: Math.min(1.5, this.lantern.lit), r: 3.5 });
    const tRain = start - 0.2;
    for (let i = 0; i < this.rain.n; i++) {
      const life = 2.4, a = t - tRain - hash(i, 2) * 1.0;
      if (a < 0 || a > life) { this.rain.hide(i); continue; }
      const x = M.x + (hash(i, 3) - 0.5) * 16 + noise1(t * 0.5 + i, 1) * 0.6, z = M.z + 6 + (hash(i, 4) - 0.5) * 22;
      const y = M.y + 8 - a * (3.0 + 3 * hash(i, 5)) + noise1(t + i, 2) * 0.3;
      this.rain.set(i, x, y, z, col('gold', 1).lerp(col('white', 1), 0.4), 1.8 * Math.sin(Math.PI * a / life) * (0.4 + 0.6 * hash(i, 6)), 0.08 + 0.1 * hash(i, 7));
    }
    this.rain.commit();
    // "hand": a warm burst from the joined hands, and a soft ring of light running out over the street
    const fl = pulse(t, T.hand, 0.25);
    this.flash.set(0, contact.x, contact.y, contact.z, col('white', 2).lerp(col('gold', 2), 0.45), fl * 2.4, 0.8 + 2.6 * fl);
    this.flash.set(2, contact.x, contact.y, contact.z, col('gold', 1).lerp(col('ember', 1), 0.2), fl * 0.8, 6 + 10 * (1 - fl));
    let nr = 0;
    for (const [d0, amp, dy] of [[0, 0.8, 0], [0.04, 0.3, 0.25], [0.24, 0.4, -0.1]] as [number, number, number][]) {
      const u = prog(t, T.hand + d0, T.hand + d0 + 1.6);
      if (u <= 0 || u >= 1) continue;
      const rad = 0.4 + 26 * ease.outCubic(u), kk = amp * (1 - u) * (1 - u);
      for (let i = 0; i < 48; i++) {
        const a0 = (i / 48) * Math.PI * 2, a1 = ((i + 1) / 48) * Math.PI * 2;
        const pa = V(contact.x + Math.cos(a0) * rad, contact.y - 0.2 + dy, contact.z + Math.sin(a0) * rad), pb = V(contact.x + Math.cos(a1) * rad, contact.y - 0.2 + dy, contact.z + Math.sin(a1) * rad);
        this.ring.set(nr++, pa, pb, col('gold', 1).lerp(col('white', 1), 0.3), kk);
      }
    }
    this.ring.commit(nr);
    const lp = this.lantern.position;
    this.flash.set(1, lp.x, lp.y, lp.z, col('gold', 2).lerp(col('ember', 2), 0.3), pulse(t, tLit, 0.3) * 1.5, 1 + 2 * pulse(t, tLit, 0.3));
    this.flash.commit(3);

    // ---------------- the sky breaks into stars ----------------
    this.shards.update(t, T.broken, T.piece, T.star, cam, MOON_DIR, 1.0);
    this.shards.visible = this.shards.visible && shot >= 5 && shot <= 9;

    // ---------------- the people, the threads ----------------
    this.crowd.update(t, cam);
    const thK = smoothstep(T.beautiful - 0.2, T.beautiful + 0.3, t) * (1 - smoothstep(T.wake + 0.3, T.town + 1.0, t));
    const colOf = (i: number) => (i === 0 ? heColor() : i === 1 ? sheColor() : i < 2 + this.cast.length ? this.cast[i - 2]!.color : (this.far[i - 2 - this.cast.length]!.p.color));
    this.threads.visible = thK > 0.002;
    if (this.threads.visible) this.threads.update(t, thK * (shot >= 8 ? 1.6 : 1), colOf, shot >= 8 ? 16 : 3);
    w.cat.visible = shot <= 6 || shot >= 11;

    // ---------------- light on the walls ----------------
    const glows: Glow[] = [
      { pos: he.spinePoint(0, 0.5, 0.2), color: heColor().multiplyScalar(0.28), radius: 2.4 },
      { pos: she.spinePoint(0, 0.5, 0.2), color: sheColor().multiplyScalar(0.22 * herLevel), radius: 2.2 },
    ];
    if (this.lantern.lit > 0.01) glows.push({ pos: lp.clone(), color: col('gold', 1).lerp(col('ember', 1), 0.3).multiplyScalar(2.2 * this.lantern.lit), radius: 5 });
    if (fl > 0.02) glows.push({ pos: contact, color: col('gold', 1).lerp(col('white', 1), 0.4).multiplyScalar(4 * fl), radius: 7 });
    glows.push(...this.bridge.glows(t, cam.position, 4));
    const ppl = this.cast.map((c) => ({ c, k: (typeof c.p.k === 'number' ? c.p.k : c.p.k(t)) + (c.dust ? (typeof c.dust.k === 'number' ? c.dust.k : c.dust.k(t)) : 0) })).filter((x) => x.k > 0.02)
      .sort((a, b) => a.c.pos.distanceTo(cam.position) - b.c.pos.distanceTo(cam.position)).slice(0, 16 - glows.length);
    for (const { c, k: kk } of ppl) glows.push({ pos: c.chest(), color: c.color.clone().multiplyScalar(0.38 * kk), radius: 2.6 });
    w.glows(glows);
    w.update(t, cam, { wind: 0.6 + 0.3 * smoothstep(T.wake, T.town, t) });

    S.render(this.ctx.renderer, out);
    const endFlash = prog(t, end - 0.35, end + 0.1);
    return {
      bloom: 0.95 + 0.2 * smoothstep(T.wake, T.town, t), bloomThreshold: 0.72, bloomRadius: 0.85, halation: 0.14, vignette: 0.45, grain: 0.05, ca: 0.6,
      exposure: 1.15, flash: endFlash * endFlash * 0.45 + 0.06 * pulse(t, T.wake, 0.2),
    };
  }
}
