// Pre-chorus 1, a rooftop in the blackout (docs/glow/TREATMENT.md, «пре-припев 1»). The city's power is out; the
// only light is the moon, the stars that came out with the blackout, and people: he stands on his roof by the gap
// in the parapet and looks at his own glowing palms (his star sticker glows faintly in his shirt pocket).
//   A  30.8  "Put your hands up": he lifts his palms and the light in them rises and writes the line in the air over
//            the street (light painting); across the street a girl with her cat on a fire escape lights up
//   B  32.0  "if you've ever felt low": wide over his shoulder — all along the dark street people begin to glow, each
//            in their own place and time (an old man on a fire escape, a couple, a courier by his bike, a barista at
//            her café door, a man at a roof edge, a woman on a landing; further away hundreds on the roofs, in
//            stardust) and raise their hands, each in their own way; on "felt low" their lights pulse like an echo
//   C  33.6  along the fire escapes: the people, close; lights lift off them like lanterns and rise
//   D  34.8  "Tonight we let it all go": low behind him, looking up — streams of light from all over the dark city
//            gather into the words in the sky, word by word; on "go" the words loosen and drift up
//   E  36.8  "Turn the pain": the camera cranes up; the lanterns regroup into the next line as it is sung
//   F  38.4  "into gold": high over the city: a gold wave runs out across the blocks from his roof — windows flash
//            gold, every person and every lantern turns gold
//   G  40.0  "oh — Here we go": coming down toward his roof: the gold line becomes HERE WE GO, streams of lanterns
//            flow toward a point above him where a star is forming
//   H  41.6  "here we go": low beside him, arms rising to it; each word flares as it is sung again; on the last
//            downbeat everything pulls into the star and it bursts (→ chorus 1, the `light` transition)
// Living details: the moon, laundry swaying on her roof, pigeons on her parapet, steam from her chimney, his garden
// and string lights (dark), the red light on his mast, the cat, a dish, a water tower; the traffic is dead.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { GlowLines } from '../lib/stars';
import { LightTrail, lineText, sampleStrokeText } from '../lib/lightpaint';
import { Crowd, type Person } from '../lib/crowd';
import { loadMotion, type Motion } from '../lib/motion';
import { StarSticker, heColor, makeHeroes } from '../lib/heroes';
import type { RealFigure } from '../lib/people';
import { RoofWorld, type Glow } from './rooftop-world';
import { bikeMesh, farPeople, litK, overShoulder, placeKit, raiseHand, tint, type FarPerson } from './rooftop-people';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const DBG = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('roofdbg') ?? '' : '';
const GOLD = col('gold', 1.0);
const LANTERN = new THREE.Color(1.0, 0.86, 0.62);

interface Near { name: string; p: Person; chest: () => THREE.Vector3; lit: number; color: THREE.Color }
interface Lantern {
  src: () => THREE.Vector3;
  launch: number;
  /** targets in the three texts (or null) and their word times */
  T: (THREE.Vector3 | null)[];
  at: number[];
  word: number[];
  seed: number;
  free: boolean;
}

export default class Rooftop extends Scene {
  st = new Stage(50, 0.1, 16000);
  w!: RoofWorld;
  he!: RealFigure;
  idle!: Motion;
  star = new StarSticker(0.06);
  crowd = new Crowd({ dust: [24, 220, 900], dustGain: 0.2 });
  near: Near[] = [];
  far: FarPerson[] = [];
  L: Record<string, Line> = {};
  rowA!: LightTrail;
  rowB!: LightTrail;
  lineA!: Line;
  lineB!: Line;
  textGrp = new THREE.Group();
  pen = new GlowPoints(24, 0.05);
  lan: Lantern[] = [];
  lp!: GlowPoints;
  sun = new GlowPoints(4, 1);
  spikes = new GlowLines(8, 0.035);
  bike!: THREE.Mesh;
  /** shown in this shot (near people of light) */
  nearVis = 1;
  S0 = new THREE.Vector3();
  C1 = new THREE.Vector3(0, 82, -150);
  C3 = new THREE.Vector3(0, 52, -48);
  TXT = new THREE.Vector3(-0.4, 19.5, -3.2);
  tGold = 39.77;

  override async init() {
    const { lyrics } = this.ctx;
    const S = this.st;
    S.bg.setRGB(0.002, 0.003, 0.008);
    this.L.put = lyrics.get('Put your hands up');
    this.L.ton = lyrics.get('Tonight we let it all go');
    this.L.turn = lyrics.get('Turn the pain into gold');
    this.L.here = lyrics.get('Here we go, here we go');
    this.tGold = this.L.turn.words.find((w) => /gold/i.test(w.w))!.start;

    this.w = new RoofWorld();
    S.add(this.w);
    const w = this.w, set = w.set;
    w.power = 0;
    const [{ he }, idle] = await Promise.all([makeHeroes(), loadMotion('111_28')]);
    this.he = he; this.idle = idle;
    S.add(he, this.star);
    this.S0.copy(set.heSpot).add(V(0, 8.5, -2.6));

    // ---- the people ----
    await this.crowd.init(['13_04', '77_02', '111_28', '142_15', '79_69', '79_71', '141_16', '80_43']);
    S.add(this.crowd);
    this.castNear();
    this.far = farPeople(w, this.crowd, {
      c: V(0, 0, -10), r0: 40, r1: 700, n: 230, seed: 5, litFrom: 32.3, litSpan: 1.4, front: V(0, 0, -1), clips: ['79_71', '79_69'],
      k: (t, lit, i) => this.farK(t, lit, i), upAt: (i) => 32.6 + (i % 9) * 0.21, spacing: 11,
    });
    // a few behind him too (seen from the aerial shots)
    this.far.push(...farPeople(w, this.crowd, { c: V(0, 0, 30), r0: 30, r1: 420, n: 50, seed: 9, litFrom: 32.6, litSpan: 1.2, front: V(0, 0, 1), clips: ['142_15', '79_69'], k: (t, lit, i) => this.farK(t, lit, i + 300), spacing: 12 }));

    // ---- "Put your hands up / if you've ever felt low", written in the air over the street by the light from his palms ----
    const put = this.L.put!;
    const split = put.words.findIndex((x) => /^if$/i.test(x.w));
    this.lineA = { ...put, words: put.words.slice(0, split) };
    this.lineB = { ...put, words: put.words.slice(split) };
    const pc = col('white', 1.1).lerp(col('cyan', 1.1), 0.25);
    this.rowA = LightTrail.text(lineText(this.lineA), 'script', 2.1, { width: 0.07, color: pc, tipLen: 1.6, seed: 1 });
    this.rowB = LightTrail.text(lineText(this.lineB), 'script', 1.75, { width: 0.06, color: pc, tipLen: 1.4, seed: 4 });
    this.rowB.position.set(0.9, -2.1, 0);
    this.rowB.rotation.z = -0.07;
    this.textGrp.add(this.rowA, this.rowB);
    // (in the canyon over the street, tilted up toward his roof)
    this.textGrp.position.copy(this.TXT);
    this.textGrp.rotation.x = -0.55;
    S.add(this.textGrp, this.pen);

    this.buildLanterns();
    this.sun.renderOrder = 5;
    S.add(this.sun, this.spikes);
    // the courier's bike
    this.bike = bikeMesh(w);
    placeKit(this.bike, V(-6.4, 0.02, -3.0), Math.PI / 2 + 0.15);
    S.add(this.bike);
  }

  private farK(t: number, lit: number, i: number) {
    const L = this.L;
    const d = 0.7 + 0.3 * hash(i, 3);
    // the echo of "felt low", rippling outward
    const fl = L.put!.words.at(-2)!.start, lo = L.put!.words.at(-1)!.start;
    const echo = [fl + 0.05 + (i % 7) * 0.03, lo + 0.12 + (i % 5) * 0.05, lo + 0.45 + (i % 4) * 0.06];
    let k = litK(t, lit, 0.8 * d, echo, 0.9);
    // they give their light away to the lanterns (dimmer), and glow again in gold
    k *= 1 - 0.45 * smoothstep(33.9, 35.5, t) + 0.5 * smoothstep(this.tGold, this.tGold + 1.2, t);
    return k;
  }

  /** The neighbours of light: each in their place, lighting up and raising their hands in their own way and time. */
  private castNear() {
    const set = this.w.set, H = set.hers, cr = this.crowd;
    const put = this.L.put!;
    const tHands = put.words[2]!.start, tUp = put.words[3]!.start, tIf = put.words[4]!.start, tEver = put.words[6]!.start, tFelt = put.words[7]!.start;
    const echo = [tFelt + 0.05, put.words[8]!.start + 0.1, put.words[8]!.start + 0.45];
    const add = (name: string, o: { pos: THREE.Vector3; yaw: number; body: 0 | 1; color: THREE.Color; lit: number; k: number; clips: { clip: string; from: number; at?: number; speed?: number }[]; mirror?: boolean; offset?: number; pose?: (fig: RealFigure, t: number) => void }) => {
      const p = cr.addPerson({ pos: o.pos, yaw: o.yaw, look: 'light', body: o.body, color: o.color, mirror: o.mirror, offset: o.offset, clips: o.clips, fade: 1.0, pose: o.pose, k: (t) => this.nearVis * litK(t, o.lit, o.k * 1.4, echo) * (1 - 0.35 * smoothstep(33.9, 35.3, t)) });
      this.near.push({ name, p, lit: o.lit, color: o.color, chest: () => (p.fig ? p.fig.spinePoint(0, 0.3, 0.1) : o.pos.clone().add(V(0, 1.3, 0))) });
      return p;
    };
    const ease2 = (t: number, a: number, d: number) => ease.inOutCubic(clamp((t - a) / d));
    // the girl with her cat, sitting on her fire escape (her building, third landing), chin in hand; one hand up, slowly
    const fz = H.z1, yG = H.gH + 2 * H.fH;
    add('girl', {
      pos: V(-1.25, yG + 0.02, fz + 0.42), yaw: 0.15, body: 1, color: tint(3, 1.05), lit: tHands - 0.05, k: 0.9, offset: 0,
      clips: [{ clip: '13_04', from: 0, at: 12, speed: 0.6 }],
      pose: (fig, t) => raiseHand(fig, 1, ease2(t, tUp - 0.1, 1.3) * (1 - 0.5 * ease2(t, 36.5, 2)), overShoulder(fig, 1, 0.55, 0.12, 0.2)),
    });
    this.w.catPose.p.set(-0.45, yG + 0.0, fz + 0.62);
    this.w.catPose.yaw = 0.35;
    // the old man on the walk-up's fire escape left of hers: one hand, slowly, a little unsure
    const L1 = set.blds.find((b) => b.z1 <= -9 && b.x1 <= -6)!;
    add('old', {
      pos: V((L1.x0 + L1.x1) / 2 + 0.5, L1.gH + 1 * L1.fH, L1.z1 + 0.62), yaw: 0.25, body: 0, color: tint(4, 0.95), lit: tIf + 0.1, k: 0.85, offset: 3,
      clips: [{ clip: '111_28', from: 0 }],
      pose: (fig, t) => raiseHand(fig, 0, ease2(t, tEver, 1.6) * (0.85 + 0.05 * Math.sin(t * 9)), overShoulder(fig, 0, 0.45, 0.2, 0.25)),
    });
    // the couple on the walk-up's fire escape right of hers: their joined hands go up together
    const R1 = set.blds.find((b) => b.z1 <= -9 && b.x0 >= 6)!;
    const yC = R1.gH + 2 * R1.fH, zC = R1.z1 + 0.62, xC = (R1.x0 + R1.x1) / 2;
    const joint = (t: number) => V(xC + 0.05, yC + 1.9 + 0.35 * ease2(t, tFelt - 0.3, 1.2), zC + 0.25);
    add('coupleA', {
      pos: V(xC - 0.42, yC, zC), yaw: 0.3, body: 0, color: tint(1, 0.95), lit: tIf + 0.3, k: 0.85, offset: 1.5,
      clips: [{ clip: '77_02', from: 0 }],
      pose: (fig, t) => raiseHand(fig, 1, ease2(t, tEver + 0.2, 1.1), joint(t), 0.5),
    });
    add('coupleB', {
      pos: V(xC + 0.48, yC, zC), yaw: -0.35, body: 1, color: tint(5, 0.95), lit: tIf + 0.45, k: 0.85, offset: 4.2, mirror: true,
      clips: [{ clip: '142_15', from: 0 }],
      pose: (fig, t) => raiseHand(fig, 0, ease2(t, tEver + 0.2, 1.1), joint(t), 0.5),
    });
    // the courier by his bike in the street: both arms straight up (a happy burst)
    add('courier', {
      pos: V(-6.6, 0.02, -4.1), yaw: 0.6, body: 0, color: tint(2, 1.0), lit: tIf - 0.1, k: 0.95, offset: 2,
      clips: [{ clip: '79_71', from: 0 }, { clip: '79_69', from: tEver - 0.4, at: 1.0, speed: 0.9 }],
    });
    // the barista at her café's door (a shop across the street): she waves
    add('barista', {
      pos: V(18.6, 0.12, -7.4), yaw: -0.25, body: 1, color: tint(4, 1.0), lit: tEver + 0.1, k: 0.9, offset: 0.7,
      clips: [{ clip: '77_02', from: 0 }, { clip: '141_16', from: tFelt, speed: 0.85 }],
    });
    // a man at a roof edge across the street, and a woman on a landing further along
    const edge = this.w.anchors(-26, -12, 10, ['roofEdge'], { seed: 2, from: V(0, 27, 10) })[0];
    add('roofman', {
      pos: edge ? edge.pos.clone().addScaledVector(edge.facing, -0.5) : V(-26, 16.4, -11), yaw: 0.2, body: 0, color: tint(7, 0.95), lit: tIf + 0.5, k: 0.85, offset: 6,
      clips: [{ clip: '79_71', from: 0 }, { clip: '79_69', from: tFelt - 0.2, at: 3.3, speed: 0.8 }],
    });
    const fe = this.w.anchors(18, -9, 3, ['fireEscape'], { seed: 1, minY: 9, maxY: 13.5 })[0];
    add('landing', {
      pos: fe ? fe.pos.clone() : V(18, 12.4, -8.9), yaw: -0.4, body: 1, color: tint(6, 0.95), lit: tEver - 0.1, k: 0.85, offset: 8, mirror: true,
      clips: [{ clip: '142_15', from: 0 }],
      pose: (fig, t) => { const k = ease2(t, tFelt - 0.2, 1.0); raiseHand(fig, 0, k, overShoulder(fig, 0, 0.6, 0.25)); raiseHand(fig, 1, k * 0.9, overShoulder(fig, 1, 0.6, 0.25)); },
    });
  }

  /** The lanterns: lights that leave the people and gather into the lines, then all into one star above him. */
  private buildLanterns() {
    const ton = this.L.ton!, turn = this.L.turn!, here = this.L.here!;
    const clean = (l: Line, n = 99) => l.words.slice(0, n).map((x) => x.w.replace(/[,.!?]/g, '').toUpperCase()).join(' ');
    const A = sampleStrokeText(clean(ton), 'readable', 17, 1.3);
    const B = sampleStrokeText(clean(turn), 'readable', 17, 1.3);
    const C = sampleStrokeText(clean(here, 3), 'readable', 7.5, 0.6);
    // the text planes face the cameras that read them (his roof, the crane, the aerial)
    const basis = (centre: THREE.Vector3, look: THREE.Vector3) => {
      const m = new THREE.Matrix4().lookAt(look, centre, V(0, 1, 0));
      const R = new THREE.Matrix4().extractRotation(m);
      return (p: THREE.Vector2) => V(p.x, p.y, 0).applyMatrix4(R).add(centre);
    };
    const toA = basis(this.C1, V(4, 60, 40)), toC = basis(this.C3, V(2, 30, 16));
    const rank = (pts: THREE.Vector2[]) => pts.map((_, i) => i).sort((a, b) => pts[a]!.x - pts[b]!.x);
    const rA = rank(A.pts), rB = rank(B.pts), rC = rank(C.pts);
    const N = Math.max(A.pts.length, B.pts.length, C.pts.length);
    // sources: the far people sorted by how far left they are seen from his roof
    const src = this.far.slice().sort((a, b) => Math.atan2(a.pos.x, -a.pos.z + 10) - Math.atan2(b.pos.x, -b.pos.z + 10));
    const chestOf = (f: FarPerson) => () => f.pos.clone().add(V(0, 1.3, 0));
    const r = mulberry32(31);
    for (let i = 0; i < N; i++) {
      const u = i / N;
      const ia = rA[Math.min(rA.length - 1, Math.floor(u * rA.length))]!, ib = rB[Math.min(rB.length - 1, Math.floor(u * rB.length))]!, ic = rC[Math.min(rC.length - 1, Math.floor(u * rC.length))]!;
      const wa = A.word[ia]!, wb = B.word[ib]!, wc = C.word[ic]!;
      const s = src[Math.min(src.length - 1, Math.floor(((u + (r() - 0.5) * 0.08 + 1) % 1) * src.length))]!;
      const at0 = ton.words[wa]!.start;
      this.lan.push({
        src: chestOf(s), launch: at0 - 1.05 - r() * 0.25, seed: r() * 100, free: false,
        T: [toA(A.pts[ia]!), toA(B.pts[ib]!), toC(C.pts[ic]!)],
        at: [at0, turn.words[wb]!.start, here.words[wc]!.start],
        word: [wa, wb, wc],
      });
    }
    // free lanterns: from the people near the street, rising slowly (they join the star at the end)
    this.near.forEach((nr, k) => {
      for (let j = 0; j < 7; j++) this.lan.push({ src: nr.chest, launch: 33.75 + k * 0.08 + j * 0.16 + r() * 0.1, seed: r() * 100, free: true, T: [null, null, null], at: [0, 0, 0], word: [0, 0, 0] });
    });
    this.lp = new GlowPoints(this.lan.length, 1);
    this.st.add(this.lp);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, cam = S.cam, w = this.w, set = w.set, L = this.L;
    const put = L.put!, ton = L.ton!, turn = L.turn!, here = L.here!;
    const tGold = this.tGold;
    const hereT = here.words[0]!.start, here2 = here.words[3]!.start;
    const burst = this.ctx.end;
    const goldK = ease.inOutCubic(prog(t, tGold - 0.1, tGold + 1.2));
    const goldR = goldK > 0 ? lerp(0, 1400, ease.inQuad(prog(t, tGold - 0.1, tGold + 2.2))) : -1;

    // ---------------- camera (first: everything else is drawn for it) ----------------
    const H = set.heSpot;
    const pos = V(0, 0, 0), tgt = V(0, 0, 0);
    let fov = 50, roll = 0;
    const cB = 32.0, cC = 33.6, cD = 34.8, cE = 36.8, cF = 38.4, cG = 40.0, cH = 41.6;
    let shot = 'A';
    if (t < cB) {
      // A: over his shoulder, from his palms up to the line being written over the street
      const k = ease.inOutCubic(prog(t, 30.75, 31.5));
      pos.copy(H).add(V(0.7 - 0.15 * k, 1.85 + 0.35 * k, 1.25 + 0.45 * prog(t, 30.6, cB)));
      tgt.copy(H).add(V(-0.05, 1.0, -0.8)).lerp(this.TXT.clone().add(V(0.5, -0.6, 0)), k);
      fov = lerp(40, 56, k);
    } else if (t < cC) {
      shot = 'B';
      const k = ease.inOutQuad(prog(t, cB, cC));
      pos.copy(H).add(V(lerp(-3.0, -1.2, k), lerp(5.5, 6.3, k), lerp(6.5, 5.6, k)));
      tgt.set(lerp(-2.5, 0.5, k), lerp(12.5, 13.5, k), -9.5);
      fov = 62;
    } else if (t < cD) {
      shot = 'C';
      const k = ease.inOutQuad(prog(t, cC, cD)), up = ease.inOutCubic(prog(t, cC + 0.5, cD + 0.1));
      pos.set(lerp(-4.2, 1.2, k), lerp(12.2, 12.9, k), lerp(-2.6, -2.0, k));
      tgt.set(lerp(-2.0, 0.6, k), lerp(11.2, 12.0, k) + up * 18, -9.5 - up * 8);
      fov = 46;
      roll = -0.02;
    } else if (t < cE) {
      shot = 'D';
      const k = ease.inOutQuad(prog(t, cD, cE));
      pos.copy(H).add(V(1.0 - 0.3 * k, 0.55 + 0.4 * k, 2.4 + 0.5 * k));
      tgt.copy(this.C1).add(V(-4 + 8 * k, -16 + 4 * k, 0));
      fov = 58 - 3 * k;
      roll = 0.03;
    } else if (t < cF) {
      shot = 'E';
      const k = ease.inOutCubic(prog(t, cE, cF));
      pos.copy(H).add(V(lerp(3, 10, k), lerp(4, 42, k), lerp(5, 38, k)));
      tgt.copy(this.C1).add(V(0, lerp(-6, -18, k), 0));
      fov = lerp(55, 48, k);
    } else if (t < cG) {
      shot = 'F';
      const k = ease.inOutQuad(prog(t, cF, cG));
      pos.set(lerp(70, 52, k), lerp(165, 175, k), lerp(150, 120, k));
      tgt.set(lerp(-10, -20, k), lerp(20, 30, k), -170);
      fov = 52;
      roll = 0.04 - 0.03 * k;
    } else if (t < cH) {
      shot = 'G';
      const k = ease.inOutCubic(prog(t, cG, cH));
      pos.set(lerp(-26, -12, k), lerp(70, 40, k), lerp(70, 36, k));
      tgt.copy(this.C3).lerp(this.S0, 0.35 * k).add(V(0, -6, 0));
      fov = 52;
    } else {
      shot = 'H';
      const k = ease.inOutQuad(prog(t, cH, burst)), push = ease.inCubic(prog(t, 42.9, burst));
      pos.copy(H).add(V(1.6 - 0.4 * k, 0.35 + 0.3 * k, 2.6 - 0.6 * k)).lerp(this.S0, push * 0.45);
      tgt.copy(this.S0).lerp(this.C3, 0.45 * (1 - push)).add(V(0, -1.5 * (1 - k), 0));
      fov = 56 - 14 * push;
      const sh = 0.04 * (pulse(t, here2, 0.1) + pulse(t, here.words[4]!.start, 0.1) + pulse(t, here.words[5]!.start, 0.1));
      pos.x += sh * noise1(t * 40, 3); pos.y += sh * noise1(t * 40, 4);
    }
    // a hand-held breath
    pos.x += noise1(t * 0.5, 31) * 0.06; pos.y += noise1(t * 0.45, 32) * 0.05;
    aim(cam, pos, tgt, roll);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    this.nearVis = shot === 'F' || shot === 'H' ? 0 : 1;

    // ---------------- the city: blackout, the gold wave ----------------
    w.power = 0;
    // "into gold": a ring of windows flashing gold runs out across the blocks from his roof
    if (goldK > 0 && goldR < 1500) {
      w.powerWave(0, H, goldR, 0.45, 90);
      w.powerWave(1, H, Math.max(0, goldR - 140), 0.0, 90);
    } else { w.powerWave(0, null); w.powerWave(1, null); }
    w.gold(goldK > 0 ? 1 : 0, H, goldR > 0 ? goldR : 1e9);

    // ---------------- him ----------------
    const he = this.he;
    he.position.copy(H).setY(H.y + he.hipHeight);
    he.rotation.y = Math.PI;
    this.idle.apply(he, t * 0.8 + 4, { loop: true });
    const lift = ease.inOutCubic(prog(t, put.words[0]!.start - 0.15, put.words[3]!.start + 0.1));
    const upR = ease.inOutCubic(prog(t, put.words[3]!.start - 0.2, put.words[4]!.start + 0.3)) * (1 - ease.inOutCubic(prog(t, 34.6, 35.8)));
    const both = ease.inOutCubic(prog(t, hereT - 0.3, hereT + 0.9));
    // palms up in front of him (looking at them), lifted as the line starts, the right hand up after the light
    const palmL = he.spinePoint(0.17, 0.12 + 0.3 * lift, 0.32 + 0.08 * lift), palmR = he.spinePoint(-0.15, 0.1 + 0.32 * lift, 0.33 + 0.06 * lift);
    const open = ease.inOutCubic(prog(t, 35.0, 36.4)) * (1 - both);
    const openL = he.spinePoint(0.45, 0.05, 0.25), openR = he.spinePoint(-0.45, 0.05, 0.25);
    const palms = 1 - ease.inOutCubic(prog(t, 33.4, 34.6));
    const handL = palmL.clone().lerp(openL, open * (1 - palms)), handR = palmR.clone().lerp(he.spinePoint(-0.25, 1.05, 0.25), upR).lerp(openR, open * (1 - palms));
    const restL = he.hand(1), restR = he.hand(0);
    const wL = Math.max(palms, open, 0.0001), wR = Math.max(palms, upR, open, 0.0001);
    he.reach(1, restL.clone().lerp(handL, Math.min(1, wL)), V(0.8, -0.7, -0.3));
    he.reach(0, restR.clone().lerp(handR, Math.min(1, wR)), V(-0.8, -0.7, -0.3));
    if (both > 0) {
      he.reach(1, he.hand(1).lerp(he.spinePoint(0.32, 1.12, 0.3), both), V(0.8, -0.3, -0.4));
      he.reach(0, he.hand(0).lerp(he.spinePoint(-0.32, 1.12, 0.3), both), V(-0.8, -0.3, -0.4));
    }
    he.setHand(0, 0.1); he.setHand(1, 0.1);
    he.time = t;
    const hu = he.mat.uniforms;
    (hu.gold!.value as THREE.Color).copy(col('gold', 1.25));
    (hu.goldO!.value as THREE.Vector3).copy(H).add(V(0, 1.2, 0));
    hu.goldR!.value = goldK > 0 ? lerp(-0.5, 2.5, goldK) : -1;
    hu.level!.value = 0.85 + 0.15 * lift + 0.25 * pulse(t, hereT, 0.3) + 0.25 * pulse(t, here2, 0.3) + 0.6 * prog(t, burst - 0.5, burst);
    // his star sticker, in his shirt pocket (it answers the star above him at the end)
    this.star.position.copy(he.spinePoint(0.1, 0.33, 0.13));
    this.star.quaternion.copy(he.quaternion);
    this.star.level = 0.35 + 0.2 * Math.sin(t * 2.1) ** 2 + 0.9 * smoothstep(hereT, burst, t) + 0.8 * pulse(t, here2, 0.25);

    // ---------------- the people ----------------
    for (const p of this.far) {
      // they turn gold as the wave passes
      const g = goldR > 0 ? smoothstep(-20, 30, goldR - Math.hypot(p.pos.x - H.x, p.pos.z - H.z)) : 0;
      const pp = p.p as Person & { base?: THREE.Color };
      pp.base ??= pp.color.clone();
      pp.color.copy(pp.base).lerp(GOLD, g * 0.85);
    }
    for (const n of this.near) {
      const u = n.p.fig!.mat.uniforms;
      (u.gold!.value as THREE.Color).copy(col('gold', 1.1));
      (u.goldO!.value as THREE.Vector3).copy(n.p.pos).add(V(0, 1, 0));
      u.goldR!.value = goldR > 0 ? clamp((goldR - n.p.pos.distanceTo(H)) * 0.1, -1, 3) : -1;
    }
    this.crowd.update(t, cam);
    w.cat.visible = shot === 'A' || shot === 'B' || shot === 'C';

    // ---------------- the line written by his light ----------------
    const rowA = this.rowA, rowB = this.rowB;
    rowA.reveal = rowA.writtenAt(this.lineA, t, 0.5);
    rowB.reveal = rowB.writtenAt(this.lineB, t, 0.5);
    const textOn = 1 - prog(t, cC - 0.15, cC + 0.1);
    const echoT = pulse(t, put.words[7]!.start + 0.05, 0.2) + pulse(t, put.words[8]!.start + 0.1, 0.2) * 0.8 + pulse(t, put.words[8]!.start + 0.45, 0.25) * 0.6;
    rowA.gain = textOn * (1 + 0.35 * echoT);
    rowB.gain = textOn * (1 + 0.5 * echoT);
    this.textGrp.visible = textOn > 0.001 && (shot === 'A' || shot === 'B');
    this.textGrp.updateMatrixWorld(true);
    const writeEnd = this.lineB.words.at(-1)!.end + 0.3;
    let pen: THREE.Vector3;
    const startA = rowA.localToWorld(rowA.pointAt(0));
    const palm = he.hand(0);
    if (t < put.words[0]!.start) pen = palm.clone().lerp(startA, ease.inOutCubic(prog(t, put.words[0]!.start - 0.3, put.words[0]!.start)));
    else if (rowB.reveal <= 0) pen = rowA.localToWorld(rowA.pointAt(rowA.reveal));
    else pen = rowB.localToWorld(rowB.pointAt(rowB.reveal));
    const penOn = (t < writeEnd ? 1 : Math.max(0, 1 - (t - writeEnd) / 0.4)) * (this.textGrp.visible ? 1 : 0);
    let np = 0;
    if (penOn > 0) {
      this.pen.set(np++, pen.x, pen.y, pen.z, col('white', 2.4), penOn, t < put.words[0]!.start - 0.25 ? 4 : 10);
      for (let k = 1; k < 14; k++) {
        const q = pen.clone().add(V(noise1(t * 5 + k, 1), noise1(t * 5 + k, 2) - k * 0.15, noise1(t * 5 + k, 3)).multiplyScalar(0.12 * k * 0.25));
        this.pen.set(np++, q.x, q.y, q.z, col('cyan', 1.2), penOn * (1 - k / 14) * 0.5, 3);
      }
    }
    // his palms glow (the light pools in them before it rises)
    const palmGlow = 1 - prog(t, put.words[0]!.start - 0.1, put.words[0]!.start + 0.3);
    for (const i of [0, 1]) { const q = he.hand(i); this.pen.set(np++, q.x, q.y + 0.04, q.z, heColor().multiplyScalar(0.9), palmGlow * (0.6 + 0.2 * Math.sin(t * 7 + i)), 3.5); }
    this.pen.commit(np);

    // ---------------- lanterns ----------------
    const lp = this.lp, star = this.S0;
    let li = 0;
    const tmp = V(0, 0, 0);
    const release = ease.inOutCubic(prog(t, ton.words.at(-1)!.start, ton.words.at(-1)!.start + 0.9));
    const scatter = ease.inOutCubic(prog(t, 37.0, 37.7));
    const toStar = (l: Lantern, i: number) => ease.inCubic(prog(t, l.free ? 40.4 + (i % 13) * 0.08 : burst - 0.45 - (i % 7) * 0.03, l.free ? 42.2 + (i % 11) * 0.1 : burst - 0.05));
    this.lan.forEach((l, i) => {
      if (t < l.launch) return;
      const s0 = l.src();
      const age = t - l.launch;
      const wob = V(noise1(l.seed + t * 0.5, 5), noise1(l.seed + t * 0.45, 7), noise1(l.seed + t * 0.4, 9));
      let p: THREE.Vector3;
      let bright = 1, size = 2.0;
      if (l.free) {
        // a lantern from a neighbour: rises slowly, swaying, drifting with the breeze
        p = s0.clone().add(V(wob.x * 0.6 * age + age * 0.3, age * (1.6 + (l.seed % 1) * 0.8) + 0.2 * age * age, wob.z * 0.6 * age - age * 0.4));
        size = 0.24 + (l.seed % 3) * 0.05;
        bright = 1.1 * smoothstep(0, 0.5, age);
        const k = toStar(l, i);
        if (k > 0) { p.lerp(star, k); bright *= 1 + k; }
      } else {
        // a light from far away: up, then gliding into its place in the word as it is sung
        const k1 = ease.outCubic(prog(t, l.launch, l.at[0]!));
        const rise = s0.clone().add(V(0, 18 * Math.min(1, age * 1.4), 0));
        p = rise.clone().lerp(l.T[0]!, k1);
        p.y += Math.sin(k1 * Math.PI) * 25;
        // "let it all go": the words loosen and drift up; then they scatter into a cloud
        p.y += 7 * release;
        p.addScaledVector(wob, 1.5 * release + 14 * scatter);
        // regroup into the next line as it is sung
        const k2 = ease.inOutCubic(prog(t, l.at[1]! - 0.55, l.at[1]!));
        if (k2 > 0) { tmp.copy(l.T[1]!).addScaledVector(wob, 0.3); p.lerp(tmp, k2); p.y += Math.sin(k2 * Math.PI) * 6; }
        // then HERE WE GO, closer to his roof
        const k3 = ease.inOutCubic(prog(t, l.at[2]! - 0.9 - (i % 5) * 0.05, l.at[2]! - 0.02));
        if (k3 > 0) { tmp.copy(l.T[2]!).addScaledVector(wob, 0.12); p.lerp(tmp, k3); }
        const k4 = toStar(l, i);
        if (k4 > 0) { p.lerp(star, k4); bright *= 1 + 1.5 * k4; }
        size = lerp(2.4, 1.1, k3) * (1 - 0.5 * k4);
        // second "here we go": each word flares as it is sung again
        const fw = l.word[2]!;
        bright *= 1 + 1.6 * pulse(t, here.words[3 + fw]!.start, 0.18) * k3;
        bright *= smoothstep(0, 0.3, age);
      }
      const g = goldR > 0 ? smoothstep(-25, 25, goldR - Math.hypot(p.x - H.x, p.z - H.z)) : 0;
      const flick = 0.8 + 0.2 * noise1(t * 3 + l.seed, 11);
      const c = LANTERN.clone().lerp(GOLD.clone().multiplyScalar(1.3), g).multiplyScalar(flick * 1.6 * bright);
      lp.set(li++, p.x, p.y, p.z, c, 1, size);
    });
    lp.commit(li);

    // ---------------- the star above him ----------------
    const sK = smoothstep(40.6, hereT + 0.4, t);
    const beat = this.ctx.audio.timeOfBeat(Math.floor(f.beat));
    const swell = prog(t, burst - 0.7, burst);
    const sc = GOLD.clone().lerp(col('white', 1), 0.35);
    this.sun.set(0, star.x, star.y, star.z, sc.clone().multiplyScalar(3), sK * (1 + 0.4 * pulse(t, beat, 0.15) + 3 * swell), 2.5 + 5 * swell);
    this.sun.set(1, star.x, star.y, star.z, sc, sK * (0.5 + swell), 14 + 30 * swell * swell);
    this.sun.commit(2);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI + t * 0.15, len = sK * (1.1 + 0.8 * pulse(t, beat, 0.2) + 4 * swell * swell) * (k % 2 ? 0.55 : 1);
      const d = V(Math.cos(a), Math.sin(a), 0).applyQuaternion(cam.quaternion).multiplyScalar(len);
      this.spikes.set(k, star.clone().sub(d), star.clone().add(d), sc, sK * 1.2);
    }
    this.spikes.commit(sK > 0 ? 6 : 0);

    // ---------------- light on the walls: him, the neighbours, the star ----------------
    const glows: Glow[] = [{ pos: he.spinePoint(0, 0.5, 0.2), color: heColor().multiplyScalar(0.3 * (hu.level!.value as number)).lerp(GOLD.clone().multiplyScalar(0.4), goldK), radius: 2.4 }];
    if (sK > 0) glows.push({ pos: star, color: sc.clone().multiplyScalar(1.2 * sK * (1 + 2 * swell)), radius: 9 });
    if (penOn > 0) glows.push({ pos: pen, color: col('white', 0.5 * penOn), radius: 4 });
    for (const n of this.near) {
      const k = typeof n.p.k === 'number' ? n.p.k : n.p.k(t);
      if (k > 0.01) glows.push({ pos: n.chest(), color: n.color.clone().lerp(GOLD, goldK * 0.8).multiplyScalar(0.4 * k), radius: 2.8 });
    }
    w.glows(glows);
    w.pigeonsFly = Infinity;
    w.update(t, cam, { wind: 0.6 });

    if (DBG.includes('nocity')) w.city.visible = false;
    if (DBG) {
      const c = w.city as any;
      if (DBG.includes('noground')) c.ground.visible = false;
      if (DBG.includes('nolife')) c.life.visible = false;
      if (DBG.includes('nosky') && c.sky) c.sky.visible = false;
      if (DBG.includes('noclouds') && c.cloudMat) c.children.forEach((o: any) => { if (o.material === c.cloudMat) o.visible = false; });
      if (DBG.includes('nobld')) c.children.forEach((o: any) => { if (o.isGroup && o !== c.life) o.visible = false; });
    }
    if (DBG.includes('nocrowd')) this.crowd.visible = false;
    if (DBG.includes('noset')) w.set.visible = false;
    S.render(this.ctx.renderer, out);
    const flash = prog(t, burst - 0.22, burst + 0.05);
    return {
      bloom: 0.95 + 0.25 * goldK, bloomThreshold: 0.72, bloomRadius: 0.85, halation: 0.14, vignette: 0.48, grain: 0.05, ca: 0.6,
      exposure: 1.15, flash: flash * flash * 0.8,
    };
  }
}
