// Chorus ×3: "We don't gotta be okay to dance". Each chorus is a run of sub-scenes, two sung lines each,
// cut on the beat before their first line:
//   A  dance floor, the line slams down word by word in solid letters; two glow bracelets link on "take my hand"
//   B  a hanging mirror breaks on "broken", its pieces fly up and become stars that spell BEAUTIFUL
//   C  lights rising over a sleeping town, whose windows wake up and spell the words
//   D  the floor again, everything floods with phosphor on "glowing", white-out into the drop
//   E  (final chorus) "We'll be glowing in the dark!" over a golden sunrise
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, lerp, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { DanceFloor } from './chorus-floor';
import { SlamLine } from './chorus-slam';
import { Shatter } from './chorus-shatter';
import { Town } from './chorus-town';
import { Finale } from './chorus-finale';
import { GlowPoints } from '../lib/points';
import { hash } from '../../engine/util';

type Part = 'A' | 'B' | 'C' | 'D' | 'E';
interface Seg { part: Part; start: number; end: number; lines: Line[] }

/** Per-chorus colour scheme: [main, accent, floor colours]. */
const SCHEME: Record<number, { main: string; accent: string; floor: string[] }> = {
  1: { main: 'pink', accent: 'cyan', floor: ['pink', 'cyan', 'violet'] },
  2: { main: 'phosphor', accent: 'violet', floor: ['phosphor', 'violet', 'cyan'] },
  3: { main: 'gold', accent: 'pink', floor: ['gold', 'pink', 'cyan', 'phosphor'] },
};

export default class Chorus extends Scene {
  floorSt = new Stage(40, 0.1, 300);
  n = 1;
  segs: Seg[] = [];
  floor!: DanceFloor;
  slams = new Map<Line, SlamLine>();
  rings!: THREE.Group;
  dust!: GlowPoints;
  ringA!: THREE.Mesh;
  ringB!: THREE.Mesh;
  shatter?: Shatter;
  town?: Town;
  finale?: Finale;

  override async init() {
    const { lyrics, audio, params, start, end } = this.ctx;
    this.n = params.n ?? 1;
    const sc = SCHEME[this.n]!;
    // the sung lines of this chorus, in pairs
    const lines = lyrics.lines.filter((l) => l.words[0]!.start >= start - 0.05 && l.words[0]!.start < end - 0.3);
    const cutBefore = (l: Line) => audio.timeOfBeat(Math.floor(audio.beatAt(l.words[0]!.start + 0.03)));
    const parts: Part[] = this.n === 3 ? ['A', 'B', 'E'] : ['A', 'B', 'C', 'D'];
    for (let i = 0; i < parts.length; i++) {
      const ls = parts[i] === 'E' ? lines.slice(i * 2) : lines.slice(i * 2, i * 2 + 2);
      if (!ls.length) continue;
      this.segs.push({ part: parts[i]!, start: i === 0 ? start : cutBefore(ls[0]!), end, lines: ls });
    }
    for (let i = 0; i + 1 < this.segs.length; i++) this.segs[i]!.end = this.segs[i + 1]!.start;

    // A / D: the dance floor and the slammed lines
    const S = this.floorSt;
    S.bg.copy(col('night'));
    S.fog(col('dusk', 0.6), 0.045);
    this.floor = new DanceFloor(30, 1.0);
    S.add(this.floor);
    const face = col(sc.main, 1.25), side = col(sc.main, 0.22);
    const face2 = col(sc.accent, 1.25), side2 = col(sc.accent, 0.22);
    for (const seg of this.segs.filter((s) => s.part === 'A' || s.part === 'D')) {
      seg.lines.forEach((l, k) => {
        const rows = rowsFor(l);
        // a stuttered word (glo-glo-glo-glowing) slams piece by piece on the vocal onsets
        const pieces = new Map<number, { text: string; start: number; end: number }[]>();
        l.words.forEach((w, wi) => {
          const parts = w.w.split('-').filter(Boolean);
          if (parts.length < 3) return;
          const on = audio.events('vocal', w.start - 0.05, w.start + 2.2).map(([t]) => t).slice(0, parts.length);
          while (on.length < parts.length) on.push(audio.timeOfBeat(audio.beatAt(on[on.length - 1] ?? w.start) + 1));
          pieces.set(wi, parts.map((p, i) => ({ text: i < parts.length - 1 ? `${p}-` : p, start: on[i]!, end: i + 1 < parts.length ? on[i + 1]! : w.end })));
        });
        const sl = new SlamLine(l, rows, { size: rows.length > 2 ? 0.95 : 1.15, leading: 1.08, face: k ? face2 : face, side: k ? side2 : side, maxWidth: pieces.size ? 9.6 : 8.6, pieces });
        sl.position.z = k * 1.6;
        S.add(sl);
        sl.updateMatrixWorld(true);
        sl.userData.centre = new THREE.Box3().setFromObject(sl).getCenter(new THREE.Vector3());
        this.slams.set(l, sl);
      });
    }
    // the two glow bracelets that link on "take my hand"
    this.rings = new THREE.Group();
    const torus = new THREE.TorusGeometry(0.55, 0.055, 12, 64);
    this.ringA = new THREE.Mesh(torus, new THREE.MeshBasicMaterial({ color: col('pink', 2.2), fog: true }));
    this.ringB = new THREE.Mesh(torus, new THREE.MeshBasicMaterial({ color: col('cyan', 2.2), fog: true }));
    this.rings.add(this.ringA, this.ringB);
    S.add(this.rings);
    // dust in the air above the floor, catching the light
    this.dust = new GlowPoints(160, 0.035);
    S.add(this.dust);

    const B = this.segs.find((s) => s.part === 'B');
    if (B) this.shatter = new Shatter(this.ctx, B.lines, this.n);
    const C = this.segs.find((s) => s.part === 'C');
    if (C) this.town = new Town(this.ctx, C.lines, this.n);
    const E = this.segs.find((s) => s.part === 'E');
    if (E) this.finale = new Finale(this.ctx, E.lines);
    await Promise.all([this.shatter?.init(), this.town?.init(), this.finale?.init()]);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t;
    const seg = this.segs.find((s) => t >= s.start && t < s.end) ?? this.segs[this.segs.length - 1]!;
    let post: Record<string, any> = {};
    if (seg.part === 'A' || seg.part === 'D') post = this.renderFloor(f, seg, out);
    else if (seg.part === 'B') post = this.shatter!.render(f, seg.start, seg.end, out);
    else if (seg.part === 'C') post = this.town!.render(f, seg.start, seg.end, out);
    else post = this.finale!.render(f, seg.start, seg.end, out);
    // the snap's white-out carries over the first frames of the chorus
    const inFlash = this.n === 3 ? 0 : Math.pow(0.5, Math.max(0, t - this.ctx.start) / 0.09) * (t - this.ctx.start < 0.6 ? 1 : 0);
    // each cut between sub-scenes lands with a short flash
    const cutFlash = seg.start > this.ctx.start + 0.01 ? Math.pow(0.5, Math.max(0, t - seg.start) / 0.035) * 0.12 : 0;
    return {
      bloom: 0.95, bloomThreshold: 0.78, bloomRadius: 0.85, halation: 0.12, vignette: 0.42, grain: 0.05, ca: 0.9,
      ...post,
      flash: Math.max(post.flash ?? 0, inFlash, cutFlash),
    };
  }

  private renderFloor(f: Frame, seg: Seg, out: THREE.WebGLRenderTarget) {
    const t = f.t, { audio } = this.ctx, S = this.floorSt, sc = SCHEME[this.n]!;
    const isD = seg.part === 'D';
    // show only this segment's lines; the first line tips over when the second starts
    for (const [l, sl] of this.slams) sl.visible = seg.lines.includes(l);
    const [l0, l1] = seg.lines;
    const ripples: { t: number; x: number; z: number; c: THREE.Color }[] = [];
    let shake = 0;
    seg.lines.forEach((l, k) => {
      const sl = this.slams.get(l)!;
      const next = seg.lines[k + 1];
      const exit = next ? prog(t, next.words[0]!.start - 0.25, next.words[0]!.start + 0.15) : 0;
      // the held "glowing" of D's second line swells
      const glowWord = isD && k === 1 ? l.words.find((w) => /glo/i.test(w.w)) : undefined;
      const swell = glowWord ? 1 + 1.4 * smoothstep(glowWord.start, glowWord.end, t) : 1;
      sl.pose(t, 3.2, 0.12, exit, swell, swell);
      for (const w of sl.words) {
        if (t >= w.word.start && t - w.word.start < 1.2) {
          const p = sl.centre(w);
          ripples.push({ t: w.word.start, x: p.x, z: p.z + 0.6, c: col(k ? sc.accent : sc.main, 1.1) });
        }
        shake = Math.max(shake, pulse(t, w.word.start, 0.06));
      }
    });
    // floor
    const beat = audio.beatAt(t);
    const energy = 0.55 + 0.45 * audio.env('rms', t);
    const glowLine = isD ? l1 : undefined;
    const glowW = glowLine?.words.find((w) => /glo/i.test(w.w));
    const flood = glowW ? smoothstep(glowW.start - 0.1, glowW.start + 1.6, t) : 0;
    this.floor.light(t, beat, sc.floor.map((k) => col(k, 1.0)), energy, flood, col('phosphor', 1.2), ripples);
    for (let i = 0; i < this.dust.n; i++) {
      const x = (hash(i, 1) - 0.5) * 26, z = (hash(i, 2) - 0.5) * 22 - 2;
      const y = ((hash(i, 3) * 9 + t * (0.15 + 0.25 * hash(i, 4))) % 9) + 0.3;
      const c = col(sc.floor[i % sc.floor.length]!, 1);
      this.dust.set(i, x + Math.sin(t * 0.5 + i) * 0.3, y, z, c, 0.5 + 0.8 * audio.hit('kick', t, 0.15), 0.6 + hash(i, 5));
    }
    this.dust.commit();

    // bracelets: fly in from both sides and link on "hand" (A's second line)
    const hand = !isD && l1 ? l1.words.find((w) => /hand/i.test(w.w)) : undefined;
    const take = !isD && l1 ? l1.words.find((w) => /take/i.test(w.w)) : undefined;
    this.rings.visible = !!(hand && take && t > take.start - 0.4);
    if (hand && take && this.rings.visible) {
      const k = ease.outExpo(clamp((t - (take.start - 0.4)) / (hand.start - take.start + 0.4), 0, 1));
      const spin = (t - hand.start) * 1.4;
      this.rings.position.set(0, 4.35, 2.6);
      this.ringA.position.set(lerp(-7, -0.45, k), 0, 0);
      this.ringB.position.set(lerp(7, 0.45, k), 0, 0);
      this.ringA.rotation.set(0, -0.5, 0);
      this.ringB.rotation.set(0, Math.PI / 2 - 0.5, 0);
      this.rings.rotation.set(0.35 + 0.15 * Math.sin(t * 1.3), (t > hand.start ? spin : 0) + 0.55, 0.12);
      const hit = pulse(t, hand.start, 0.15);
      (this.ringA.material as THREE.MeshBasicMaterial).color.copy(col('pink', 2.2 + 3 * hit));
      (this.ringB.material as THREE.MeshBasicMaterial).color.copy(col('cyan', 2.2 + 3 * hit));
    }

    // camera: aimed at the line being sung
    const c0 = this.slams.get(l0!)!.userData.centre as THREE.Vector3;
    const c1 = l1 ? (this.slams.get(l1)!.userData.centre as THREE.Vector3) : c0;
    const sw = l1 ? ease.inOutCubic(prog(t, l1.words[0]!.start - 0.4, l1.words[0]!.start + 0.3)) : 0;
    const centre = c0.clone().lerp(c1, sw);
    const p = prog(t, seg.start, seg.end, ease.linear);
    const db = audio.downbeats.filter((d) => d <= t).pop() ?? seg.start;
    const punch = pulse(t, db, 0.12);
    const side = this.n === 2 ? -1 : 1;
    let pos: THREE.Vector3, tgt: THREE.Vector3;
    if (!isD) {
      pos = new THREE.Vector3(side * lerp(-2.5, 2.2, ease.inOutQuad(p)), lerp(1.1, 1.6, p), lerp(12.5, 9.2, ease.outCubic(p)));
      tgt = new THREE.Vector3(centre.x, centre.y + 0.15, centre.z);
    } else {
      const a = lerp(-0.5, 0.4, ease.inOutQuad(p)) * side;
      const r = lerp(11, 9.4, p);
      pos = new THREE.Vector3(Math.sin(a) * r, lerp(4.6, 2.6, ease.inOutQuad(p)), Math.cos(a) * r + centre.z);
      tgt = new THREE.Vector3(centre.x, centre.y + 0.1, centre.z);
    }
    pos.add(new THREE.Vector3(noise1(t * 0.7, 3) * 0.15, noise1(t * 0.7, 5) * 0.1, 0));
    pos.x += noise1(t * 40, 11) * 0.06 * shake;
    pos.y += noise1(t * 40, 12) * 0.06 * shake;
    aim(S.cam, pos, tgt, noise1(t * 0.3, 8) * 0.03);
    S.cam.fov = 40 - punch * 2.5;
    S.cam.updateProjectionMatrix();
    S.render(this.ctx.renderer, out);
    // D ends in a white-out into the drop
    const outFlash = isD ? smoothstep(this.ctx.end - 0.35, this.ctx.end, t) * 1.4 : 0;
    return { flash: outFlash, shake: [noise1(t * 50, 1) * 6 * shake, noise1(t * 50, 2) * 6 * shake] as [number, number] };
  }

  override dispose() {
    for (const sl of this.slams.values()) sl.dispose();
  }
}

/** Rows for a slammed line: short lines in two rows, long ones in three, split between words. */
function rowsFor(l: Line): number[][] {
  const n = l.words.length;
  const len = (a: number, b: number) => l.words.slice(a, b).reduce((s, w) => s + w.w.length + 1, 0);
  const total = len(0, n);
  const nr = total > 24 ? 3 : 2;
  const rows: number[][] = [];
  let a = 0;
  for (let r = 0; r < nr; r++) {
    const goal = (total * (r + 1)) / nr;
    let b = a + 1;
    while (b < n - (nr - 1 - r) && Math.abs(len(0, b + 1) - goal) < Math.abs(len(0, b) - goal)) b++;
    if (r === nr - 1) b = n;
    rows.push(Array.from({ length: b - a }, (_, i) => a + i));
    a = b;
  }
  return rows.filter((r) => r.length);
}
