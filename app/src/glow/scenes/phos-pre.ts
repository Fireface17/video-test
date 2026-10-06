// PRE-CHORUS in phosphor, two variations (params.n), both cut like the sister clip: a camera that is never at rest and
// jumps on hard cuts, words that slam in on their onsets, inversions on the hits.
//
// The backing echoes ("felt low", "all go" in lyrics.json, kind 'echo') are DELAY LINES, never brackets:
//   felt low  the echo is a copy that drops out of the line and falls through the floor of the frame, stamping a copy
//             of itself into the phosphor every 16th as it falls (gravity spreads the stamps; each decays: a trail that
//             fades with distance). n = 2: the camera dives after it.
//   all go    the echo leaves the word and recedes into the dark, a copy per delay tap, each smaller, higher and dimmer.
//
// n = 1 "the stickers" (pre-chorus 1, green -> gold)
//   PUT YOUR HANDS UP...   the line assembles from stickers that fly in and land on the onsets; hard cut per row
//   TONIGHT WE LET IT ALL GO   on "let it all go" the stickers peel off the letters and float up
//   TURN THE PAIN INTO GOLD    a cut on the strongest kick; on "into" a front sweeps the frame and everything it passes
//                              (stickers, letters, field) is recharged gold
//   HERE WE GO, HERE WE GO     PRESSURE: each word slams in as a new row of a justified slab of heavy grotesque; every
//                              stomp of the beat presses the slab (narrower width axis, heavier, tighter), the first is an
//                              ink-on-gold inversion; on the last GO the slab is crushed into one white-hot point at the
//                              frame centre, the field sucked in after it. The chorus (phos-chorus) opens by detonating it.
// n = 2 "the press" (pre-chorus 2: stronger, cyan/violet -> gold)
//   PUT / YOUR / HANDS / UP    one full-frame slam per word, a different framing each; UP is thrown up out of frame by a
//                              whip of the camera down onto IF YOU'VE EVER FELT LOW; LOW sits on the floor of the frame
//   TONIGHT ... GO             TONIGHT full frame; WE LET IT ALL slam in a row, GO under them; the echo recedes, 8 taps
//   TURN THE PAIN INTO GOLD    PAIN in heavy type; on "into" its letters roll like an odometer, P->G A->O I->L N->D,
//                              landing on GOLD with an inversion
//   HERE WE GO, HERE WE GO     THROUGH THE O: HERE WE GO with a huge GO; on the stomp the camera dives through the O's
//                              counter, inside which the next HERE WE GO waits; the last dive hits the light inside the
//                              last O on the downbeat of chorus 2.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import type { Line, Word } from '../../engine/lyrics';
import { W, H } from '../../engine/gl';
import { measure } from '../../engine/type';
import { clamp, ease, hash, lerp, prog, smoothstep, TAU } from '../../engine/util';
import { PhosphorStage, hitFx, StickerWord, glowAt, uvEvents, uvPulse, layoutWords, loadPhosphorFont, mixTone, phosphorCss, PHOS_FONT, type Charge, type Tone, type Glow } from '../lib/phosphor';
import { apply, arch, cam, camXf, CX, CY, Field, flood, mixCam, pulses, shotAt, slamK, starW, txt, useXf, type Cam, type Shot, type Xf } from '../lib/phos-cut';

/** where the ignition leaves its point: phos-chorus detonates it (screen centre) */
export const IGNITE = { x: CX, y: CY, r: 140 };

const UP = (s: string) => s.toUpperCase().replace(/[,.!?]/g, '');
const S = (t0: number, t1: number, a: Cam, b: Cam, fn: (x: number) => number = ease.linear): Shot => ({ t: t0, cam: (t: number) => mixCam(a, b, prog(t, t0, t1, fn)) });

interface Item { text: string; x: number; y: number; size: number; on: number; show: number; hide: number; tone: Tone; family?: string; rot?: number }
interface Grp { words: Word[]; boxes: { x: number; y: number; w: number; text: string }[]; sw: StickerWord[]; size: number; seed: number; peel?: number; exit?: number; hide: number }

interface Var { base: Tone; echo: Tone; fieldN: number; uvThr: number }
const VARS: Record<number, Var> = {
  1: { base: 'green', echo: 'cyan', fieldN: 650, uvThr: 0.8 },
  2: { base: 'cyan', echo: 'violet', fieldN: 800, uvThr: 0.75 },
};

export default class PhosPre extends Scene {
  st!: PhosphorStage;
  v!: Var;
  n = 1;
  field!: Field;
  uv: Charge[] = [];
  put!: Line; ton!: Line; turn!: Line; here!: Line;
  echoLow?: Line; echoGo?: Line;
  shots: Shot[] = [];
  items: Item[] = [];
  onsets: number[] = [];
  stomps: number[] = [];
  // n = 1
  A?: Grp; B?: Grp; C?: Grp;
  tInto = 0; tGold = 0; tWaveEnd = 0;
  // echoes: source text / world position
  eLow = { text: '', x: 0, y: 0, size: 0 };
  eGo = { text: '', x: 0, y: 0, size: 0 };
  // n = 2
  pain = { x: 0, y: 0, size: 0, t0: 0, t1: 0 };
  dive = { S0: 760, f: 0.2, ox: 0, oy: 0, cw: 0, ch: 0, gx: 0, levels: [] as { t: number; z: number; x: number; y: number }[] };
  tDive: [number, number][] = [];
  tUpWhip = 0;
  inv: [number, number, Tone][] = []; // inversion windows

  override async init() {
    await loadPhosphorFont();
    const { lyrics, audio, params, start, end } = this.ctx;
    this.n = Number(params.n ?? 1) === 2 ? 2 : 1;
    this.v = VARS[this.n]!;
    this.st = new PhosphorStage(this.ctx, 7000);
    this.field = new Field(this.v.fieldN, 7 + this.n);
    const L = lyrics.linesIn(start - 0.3, end + 0.2).filter((l) => !l.kind);
    const f = (re: RegExp) => L.find((l) => re.test(l.text))!;
    this.put = f(/^put your hands/i); this.ton = f(/^tonight/i); this.turn = f(/^turn the pain/i); this.here = f(/^here we go/i);
    const E = lyrics.linesIn(start - 0.3, end + 0.2).filter((l) => l.kind === 'echo');
    this.echoLow = E.find((l) => /felt/i.test(l.text)); this.echoGo = E.find((l) => /all/i.test(l.text));
    this.uv = uvEvents(audio, start - 1, end + 0.5, { thr: this.v.uvThr });
    this.stomps = audio.events('kick', this.here.start + 0.2, end + 0.05).filter(([, s]) => s >= 0.78).map(([t]) => t);
    this.onsets = [this.put, this.ton, this.turn, this.here].flatMap((l) => l.words.map((w) => w.start));
    if (this.n === 1) this.init1(); else this.init2();
  }

  // =========================================================================================== n = 1
  private init1() {
    const { start } = this.ctx;
    /** two rows, split before word `br` (the echoed words stay together on the second row) */
    const mk = (line: Line, size: number, seed: number, y: number, br: number): Grp => {
      const rows = [line.words.slice(0, br), line.words.slice(br)].map((ws) => layoutWords(ws.map((w) => w.w), size, { maxW: 3000 }));
      const lead = size * 1.12;
      return {
        words: line.words, size, seed, hide: 1e9,
        boxes: rows.flatMap((lay, ri) => lay.boxes.map((b) => ({ x: CX + b.x, y: y + (ri - 0.5) * lead + size * 0.35, w: b.w, text: b.text }))),
        sw: line.words.map((w, i) => new StickerWord(w.w, size, size / 12, seed + i)),
      };
    };
    const A = this.A = mk(this.put, 150, 11, 540, this.put.words.findIndex((w) => /^if$/i.test(w.w)));
    const B = this.B = mk(this.ton, 175, 31, 540, this.ton.words.findIndex((w) => /^let$/i.test(w.w)));
    const C = this.C = mk(this.turn, 165, 51, 540, this.turn.words.findIndex((w) => /^into$/i.test(w.w)));
    A.hide = this.ton.start; B.hide = this.turn.start; C.hide = this.here.start;
    const wLet = this.ton.words.find((w) => /^let$/i.test(w.w)) ?? this.ton.words[2]!;
    B.peel = wLet.start + 0.25;
    const into = this.turn.words.find((w) => /^into$/i.test(w.w))!, gold = this.turn.words.find((w) => /^gold/i.test(w.w))!;
    this.tInto = into.start - 0.05; this.tGold = gold.start; this.tWaveEnd = gold.start + 0.4;
    // echo sources
    const nA = A.boxes.length, bf = A.boxes[nA - 2]!, bl = A.boxes[nA - 1]!;
    this.eLow = { text: `${bf.text} ${bl.text}`, x: (bf.x + bl.x + bl.w) / 2, y: bl.y, size: A.size };
    const nB = B.boxes.length, ba = B.boxes[nB - 2]!, bg = B.boxes[nB - 1]!;
    this.eGo = { text: `${ba.text} ${bg.text}`, x: (ba.x + bg.x + bg.w) / 2, y: bg.y, size: B.size };

    const sh: Shot[] = [];
    const row2 = this.put.words.find((w, i) => i > 0 && Math.abs(A.boxes[i]!.y - A.boxes[0]!.y) > 10)?.start ?? this.put.words[4]!.start;
    const r1y = A.boxes[0]!.y - A.size * 0.35, r2y = A.boxes[nA - 1]!.y - A.size * 0.35;
    sh.push(S(start, row2, cam(CX, r1y + 60, 1.12, 0), cam(CX, r1y + 20, 1.22, 0)));
    const tE = this.echoLow?.start ?? this.ton.start - 0.7;
    sh.push(S(row2, tE, cam(CX + 30, r2y - 60, 1.22, -0.035), cam(CX + 10, r2y - 70, 1.3, -0.035)));
    sh.push(S(tE, this.ton.start, cam(CX, r2y + 90, 1.08, 0), cam(CX, r2y + 190, 1.0, 0), ease.inQuad));
    const b1 = B.boxes[0]!.y - B.size * 0.35;
    const tAll = this.ton.words.find((w) => /^all$/i.test(w.w))!.start;
    const kAll = this.ctx.audio.events('kick', tAll - 0.12, tAll + 0.05).filter(([, s]) => s > 0.6).map(([t]) => t)[0] ?? tAll;
    sh.push(S(this.ton.start, kAll, cam(CX - 40, b1 + 40, 1.3, 0.03), cam(CX - 10, b1 + 50, 1.4, 0.03)));
    sh.push(S(kAll, this.turn.start, cam(CX, 500, 0.95, 0), cam(CX, 380, 1.0, 0), ease.outQuad));
    const pain = this.turn.words.find((w) => /^pain/i.test(w.w))!.start;
    const kP = this.ctx.audio.events('kick', pain, pain + 0.4).filter(([, s]) => s > 0.85).map(([t]) => t)[0] ?? pain + 0.15;
    const c1 = C.boxes[0]!.y - C.size * 0.35;
    sh.push(S(this.turn.start, kP, cam(CX + 40, c1 + 30, 1.38, -0.025), cam(CX + 20, c1 + 30, 1.46, -0.025)));
    sh.push(S(kP, this.tGold, cam(CX, 540, 1.0, 0.02), cam(CX, 540, 1.08, 0.02)));
    const dbG = this.ctx.audio.downbeats.find((d) => d > this.tGold - 0.1 && d < this.here.start) ?? this.tGold;
    sh.push(S(dbG, this.here.start, cam(CX, 545, 1.2, 0), cam(CX, 540, 1.42, 0), ease.inQuad));
    sh.push(S(this.here.start, this.ctx.end, cam(), cam()));
    this.shots = sh.sort((a, b) => a.t - b.t);
  }

  // =========================================================================================== n = 2
  private init2() {
    const { start, audio } = this.ctx;
    const P = this.put.words, T = this.ton.words, U = this.turn.words;
    const sh: Shot[] = [];
    const it = (text: string, x: number, y: number, size: number, on: number, hide: number, tone: Tone, o: Partial<Item> = {}): Item => {
      const i: Item = { text, x, y, size, on, show: on, hide, tone, ...o }; this.items.push(i); return i;
    };
    const fit = (text: string, w: number, max: number, fam = PHOS_FONT) => Math.min(max, (100 * w) / measure(text, fam, 100));
    // ---- PUT / YOUR / HANDS / UP: one word a frame
    const rolls = [-0.04, 0.05, -0.02, 0];
    const tUp = P[3]!.start, tIf = P[4]!.start;
    P.slice(0, 4).forEach((w, i) => {
      const text = UP(w.w), size = fit(text, i === 3 ? 900 : 1300, i === 3 ? 700 : 520);
      it(text, CX, CY + size * 0.36, size, w.start, i < 3 ? P[i + 1]!.start : tIf, i === 3 ? 'white' : this.v.base, { rot: 0 });
      const nx = i < 3 ? P[i + 1]!.start : tIf;
      if (i < 3) sh.push(S(i ? w.start : start, nx, cam(CX, CY, 1.0, rolls[i]!), cam(CX, CY, 1.08, rolls[i]!)));
    });
    // UP is thrown up out of the frame: the camera whips down onto the rest of the line
    this.tUpWhip = tUp + 0.24;
    const yA2 = 1900, tw = this.tUpWhip;
    sh.push({ t: tUp, cam: (t) => { const u = ease.inOutCubic(prog(t, tw, tIf + 0.02)); return mixCam(cam(CX, CY, 1.0, 0), cam(CX, yA2 - 120, 1.0, 0.03), u); } });
    const rowY = yA2 - 260;
    const lay = layoutWords(P.slice(4, 7).map((w) => UP(w.w)), 150, { maxW: 1800 });
    P.slice(4, 7).forEach((w, i) => it(lay.boxes[i]!.text, CX + lay.boxes[i]!.x + lay.boxes[i]!.w / 2, rowY, 150, w.start, this.ton.start, 'white'));
    const felt = it('FELT', CX, rowY + 230, 230, P[7]!.start, this.ton.start, this.v.base);
    const low = it('LOW', CX, yA2 + 330, 520, P[8]!.start, this.ton.start, mixTone(this.v.base, 'white', 0.3));
    this.eLow = { text: 'LOW', x: CX, y: low.y, size: low.size };
    void felt;
    const tE = this.echoLow?.start ?? this.ton.start - 0.7;
    sh.push(S(tIf, P[8]!.start, cam(CX, yA2 - 120, 1.0, 0.03), cam(CX, yA2 - 100, 1.06, 0.03)));
    sh.push(S(P[8]!.start, tE, cam(CX, yA2 + 160, 1.0, -0.02), cam(CX, yA2 + 170, 1.05, -0.02)));
    // the dive after the falling echo
    sh.push({ t: tE, cam: (t) => { const tt = Math.max(0, t - tE); return cam(CX, yA2 + 170 + 0.3 * this.fall(tt), 1.05 - 0.1 * clamp(tt / 0.7), -0.02 + 0.03 * clamp(tt / 0.7)); } });
    // ---- TONIGHT / WE LET IT ALL / GO
    const tT = this.ton.start, tWe = T[1]!.start;
    const sT = fit('TONIGHT', 1500, 460);
    it('TONIGHT', CX, CY + sT * 0.36, sT, tT, tWe, 'white');
    sh.push(S(tT, tWe, cam(CX, CY, 1.12, 0.03), cam(CX, CY, 1.2, 0.03)));
    const lr = layoutWords(T.slice(1, 5).map((w) => UP(w.w)), 190, { maxW: 1800 });
    T.slice(1, 5).forEach((w, i) => it(lr.boxes[i]!.text, CX + lr.boxes[i]!.x + lr.boxes[i]!.w / 2, 330, 190, w.start, this.turn.start, this.v.base));
    const go = it('GO', CX, 880, 600, T[5]!.start, this.turn.start, mixTone(this.v.base, 'white', 0.35));
    this.eGo = { text: 'ALL GO', x: CX, y: go.y, size: 330 };
    const kAll = audio.events('kick', T[4]!.start - 0.15, T[4]!.start + 0.1).filter(([, s]) => s > 0.75).map(([t]) => t)[0] ?? T[4]!.start;
    sh.push(S(tWe, kAll, cam(CX, 420, 1.3, -0.03), cam(CX, 430, 1.38, -0.03)));
    sh.push(S(kAll, this.turn.start, cam(CX, 600, 1.0, 0), cam(CX, 520, 0.9, 0), ease.outQuad));
    // ---- TURN THE / PAIN -> GOLD
    const tTu = this.turn.start, pw = U.find((w) => /^pain/i.test(w.w))!, iw = U.find((w) => /^into/i.test(w.w))!, gw = U.find((w) => /^gold/i.test(w.w))!;
    const lt = layoutWords(U.slice(0, 2).map((w) => UP(w.w)), 170, { maxW: 1800 });
    U.slice(0, 2).forEach((w, i) => it(lt.boxes[i]!.text, CX + lt.boxes[i]!.x + lt.boxes[i]!.w / 2, 300, 170, w.start, this.here.start, 'white'));
    const iy = layoutWords(['INTO'], 150, {});
    it('INTO', CX, 1010, 150, iw.start, gw.start, this.v.base);
    void iy;
    this.pain = { x: CX, y: 800, size: 420, t0: iw.start, t1: gw.start };
    this.inv.push([gw.start, gw.start + 0.16, 'gold']);
    sh.push(S(tTu, pw.start, cam(CX, 380, 1.4, 0.03), cam(CX, 380, 1.48, 0.03)));
    sh.push(S(pw.start, iw.start, cam(CX, 640, 1.05, 0), cam(CX, 650, 1.18, 0)));
    sh.push(S(iw.start, gw.start, cam(CX, 700, 1.28, -0.03), cam(CX, 700, 1.36, -0.03)));
    sh.push(S(gw.start, this.here.start, cam(CX, 640, 1.12, 0), cam(CX, 620, 1.25, 0), ease.outQuad));
    // ---- HERE WE GO: the dive through the O
    this.initDive();
    const st = this.stomps, Hw = this.here.words;
    const d1 = st.find((x) => x > Hw[2]!.start + 0.2) ?? Hw[2]!.start + 0.45;
    const d2end = this.ctx.end - 0.01;
    this.tDive = [[d1, d1 + 0.3], [Math.max(Hw[5]!.start + 0.18, d2end - 0.36), d2end]];
    this.inv.push([Hw[2]!.start, Hw[2]!.start + 0.11, 'gold']);
    const mid = st.find((x) => x > d1 + 0.35 && x < this.tDive[1]![0]);
    if (mid) this.inv.push([mid, mid + 0.09, 'violet']);
    sh.push({ t: this.here.start, cam: (t) => this.diveCam(t) });
    this.shots = sh.sort((a, b) => a.t - b.t);
  }

  /** measure GO's O counter (Archivo 900, widest): the dive's geometry */
  private initDive() {
    const S0 = this.dive.S0, fam = arch(125, 900);
    const cv = document.createElement('canvas'), wpx = Math.ceil(measure('GO', fam, S0) + 40), hpx = Math.ceil(S0 * 1.2);
    cv.width = wpx; cv.height = hpx;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.font = `${S0}px "${fam}"`; c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
    const base = Math.round(S0 * 0.95);
    c.fillText('GO', 20, base);
    const gW = measure('G', fam, S0), oW = measure('GO', fam, S0) - gW;
    const ocx = 20 + gW + oW / 2, ocy = base - S0 * 0.343;
    const d = c.getImageData(0, 0, wpx, hpx).data, on = (x: number, y: number) => d[(Math.round(y) * wpx + Math.round(x)) * 4 + 3]! > 128;
    let l = ocx, r = ocx, u = ocy, b = ocy;
    while (l > 0 && !on(l, ocy)) l--; while (r < wpx - 1 && !on(r, ocy)) r++;
    while (u > 0 && !on(ocx, u)) u--; while (b < hpx - 1 && !on(ocx, b)) b++;
    const cxc = (l + r) / 2, cyc = (u + b) / 2;
    // local coords: origin at the counter's centre; GO's left edge / baseline
    this.dive.ox = 20 - cxc; this.dive.oy = base - cyc;
    this.dive.cw = (r - l) / 2; this.dive.ch = (b - u) / 2; this.dive.gx = gW;
    // the composition's box (GO + the HERE WE row above), relative to the counter centre
    const x0 = this.dive.ox, x1 = this.dive.ox + gW + oW, y0 = this.dive.oy - S0 * 0.686 - S0 * 0.42, y1 = this.dive.oy;
    const bw = x1 - x0, bh = y1 - y0;
    this.dive.f = 0.86 * Math.min((2 * this.dive.cw) / bw, (2 * this.dive.ch) / bh);
    // frames of level k: camera centred on the composition box's centre at zoom z_k (level 0 fills ~84 % of the width)
    const z0 = Math.min((W * 0.86) / bw, (H * 0.84) / bh);
    for (let k = 0; k < 4; k++) {
      const s = Math.pow(this.dive.f, k), off = this.levelOff(k);
      this.dive.levels.push({ t: 0, z: z0 / s, x: off[0] + s * (x0 + x1) / 2, y: off[1] + s * (y0 + y1) / 2 });
    }
  }
  /** world position of level k's counter centre (level 0's at the world origin; level k+1's box is centred in level k's counter) */
  private levelOff(k: number): [number, number] {
    let x = 0, y = 0;
    const S0 = this.dive.S0, x0 = this.dive.ox, x1 = this.dive.ox + this.dive.gx * 0 + measure('GO', arch(125, 900), S0), y0 = this.dive.oy - S0 * 1.106, y1 = this.dive.oy;
    const bcx = (x0 + x1) / 2, bcy = (y0 + y1) / 2;
    for (let i = 1; i <= k; i++) { const s = Math.pow(this.dive.f, i); x -= s * bcx; y -= s * bcy; }
    return [x, y];
  }
  /** the camera of the dive: holds on a level, zooms about the fixed point between two framings on each dive */
  private diveCam(t: number): Cam {
    const Lv = this.dive.levels, [a, b] = this.tDive;
    const hold = (k: number, t0: number) => { const l = Lv[k]!; const z = l.z * (1 + 0.06 * clamp(t - t0)); return cam(l.x, l.y, z, 0); };
    const through = (k: number, ta: number, tb: number, th: number) => {
      const p = Lv[k]!, q = Lv[k + 1]!, u = ease.inOutCubic(prog(t, ta, tb));
      const z0 = p.z * (1 + 0.06 * clamp(ta - th)), z1 = q.z;
      const Px = (z1 * q.x - z0 * p.x) / (z1 - z0), Py = (z1 * q.y - z0 * p.y) / (z1 - z0);
      const z = Math.exp(lerp(Math.log(z0), Math.log(z1), u));
      const hx = p.x, hy = p.y; // the hold framing's centre
      return cam(Px - (Px - hx) * z0 / z, Py - (Py - hy) * z0 / z, z, 0);
    };
    if (t < a![0]) return hold(0, this.here.start);
    if (t < a![1]) return through(0, a![0], a![1], this.here.start);
    if (t < b![0]) return hold(1, a![1]);
    return through(1, b![0], b![1], a![1]);
  }

  // ======================================================================================== drawing
  private wg(t: number, on: number, sus = 0.6): Glow {
    if (t < on) return { level: 0, flash: 0 };
    const dt = t - on, k = uvPulse(this.ctx.audio, t, { thr: 0.7, hl: 0.12 });
    return { level: sus + (1.15 - sus) * Math.exp(-dt / 0.3) + 0.2 * k, flash: 0.9 * Math.pow(0.5, dt / 0.05) };
  }
  /** a slammed word, scaled about its visual centre */
  private say(c: CanvasRenderingContext2D, it: { text: string; x: number; y: number; size: number; on: number; tone: Tone; family?: string; rot?: number }, t: number, o: { from?: number; sus?: number; ink?: boolean; sx?: number } = {}) {
    const k = slamK(t, it.on, { from: o.from ?? 1.55, tau: 0.04 });
    if (!k) return;
    const g = this.wg(t, it.on, o.sus);
    c.save(); c.translate(it.x, it.y - it.size * 0.36); if (it.rot) c.rotate(it.rot); c.scale(k * (o.sx ?? 1), k);
    if (o.ink) { c.font = `${it.size}px "${it.family ?? PHOS_FONT}"`; c.textAlign = 'center'; c.fillStyle = '#000'; c.fillText(it.text, 0, it.size * 0.36); }
    else txt(c, it.text, 0, it.size * 0.36, it.size, g, it.tone, { family: it.family });
    c.restore();
  }

  /** the fall of the "felt low" echo (px after tt s) */
  private fall(tt: number) { return 2700 * 0.5 * tt * tt + 520 * tt; }

  /** felt low: a copy drops out of the line, stamping itself into the phosphor every 16th as it falls */
  private echoFall(c: CanvasRenderingContext2D, t: number, family?: string) {
    const e = this.echoLow;
    if (!e || t < e.start - 0.02) return;
    const src = this.eLow, tt = t - e.start, step = 0.07;
    const hot = Math.max(...e.words.map((w) => (t >= w.start ? Math.pow(0.5, (t - w.start) / 0.07) : 0)));
    const tone = this.v.echo;
    // the stamps (each a charge at the moment it was laid, decaying: the trail fades with distance)
    for (let k = 1; k * step <= tt; k++) {
      const tk = k * step, age = tt - tk, lv = 0.75 * Math.exp(-age / 0.18) * Math.pow(0.86, k);
      if (lv < 0.015) continue;
      txt(c, src.text, src.x, src.y + this.fall(tk), src.size * (1 - 0.03 * k), { level: lv, flash: 0 }, tone, { family });
    }
    // the falling copy, stretched by its speed
    const v = 2700 * tt + 520, sy = 1 + Math.min(0.45, v / 6000);
    const lv = 0.95 * Math.exp(-Math.max(0, tt - 0.5) / 0.3);
    txt(c, src.text, src.x, src.y + this.fall(tt), src.size, { level: lv, flash: hot * 0.8 }, mixTone(tone, 'white', 0.3), { family, sy, sx: 1 / Math.sqrt(sy) });
  }

  /** all go: the echo leaves the word and recedes into the dark, a copy per delay tap */
  private echoRecede(c: CanvasRenderingContext2D, t: number, taps: number, family?: string) {
    const e = this.echoGo;
    if (!e || t < e.start - 0.02) return;
    const src = this.eGo, tt = t - e.start, dly = this.n === 2 ? 0.075 : 0.11;
    const vx = CX + (this.n === 2 ? 0 : 60), vy = this.n === 2 ? 120 : src.y - 900;
    for (let k = taps - 1; k >= 0; k--) {
      const tk = k * dly;
      if (tt < tk) continue;
      const age = tt - tk, s = Math.pow(0.74, k), q = 1 - Math.pow(0.7, k);
      const lv = 0.95 * Math.pow(0.8, k) * Math.exp(-age / (0.35 + 0.08 * k)), fl = Math.pow(0.5, age / 0.06) * 0.7;
      const tone: Tone = this.n === 2 ? (k % 2 ? 'violet' : 'cyan') : this.v.echo;
      txt(c, src.text, lerp(src.x, vx, q), lerp(src.y, vy, q), src.size * s, { level: lv, flash: fl }, tone, { family });
    }
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { audio } = this.ctx, st = this.st, t = f.t, c = st.L.ctx;
    st.begin(out);
    const k0 = shotAt(this.shots, t).cam(t);
    const inHere = t >= this.here.start;
    const punch = pulses(t, this.onsets, 0.07, inHere ? 0 : 0.03) + (inHere ? 0 : 0.02 * uvPulse(audio, t, { thr: 0.6, hl: 0.08 }));
    const k: Cam = { ...k0, z: k0.z * (1 + punch) };
    const m = camXf(k);
    let idx = 0;
    const inv = this.inv.find(([a, b]) => t >= a && t < b);
    // the field
    if (!inv) idx = this.drawField(t, k, idx);
    useXf(c, m);
    if (this.n === 1) idx = this.render1(c, t, m, idx);
    else idx = this.render2(c, t, m, idx, inv);
    c.setTransform(1, 0, 0, 1, 0, 0);
    st.stars.commit(inv ? 0 : idx);
    const pulse = uvPulse(audio, t, { thr: this.v.uvThr });
    const crushing = this.n === 1 && t >= this.here.words[5]!.start;
    const o = st.end(out, { gain: 1.5, uv: inv || crushing ? 0 : pulse * (this.n === 2 ? 0.16 : 0.1), uvColor: this.n === 2 ? [0.4, 0.25, 1] : undefined });
    const fx = hitFx(audio, t, { zoom: 0, shake: this.n === 2 ? 5 : 3, flash: 0.06, k: inHere ? 1.6 : 1 });
    const post: PostOverrides = { ...o, zoom: 1, shake: fx.shake, flash: Math.max(o.flash ?? 0, fx.flash as number), bloom: 0.6, bloomThreshold: 0.68, halation: 0.07 };
    if (inv || this.pressInv) { post.bloom = 0.22; post.halation = 0.04; post.flash = 0; }
    // the crush: the point is the only light (no wash, no flash)
    if (this.n === 1 && t >= this.here.words[5]!.start) { post.flash = 0; this.st.stars; }
    // pre 2 ends in the light inside the last O (chorus 2 comes in on a light transition)
    if (this.n === 2) { const [, b] = this.tDive; const u = prog(t, b![0] + (b![1] - b![0]) * 0.55, b![1]); post.flash = Math.max(post.flash ?? 0, 0.8 * u * u); }
    return post;
  }
  pressInv = false;

  private drawField(t: number, k: Cam, idx: number): number {
    const st = this.st, start = this.ctx.start, n = this.n;
    const gather = this.n === 1 ? ease.inCubic(prog(t, this.here.words[5]!.start, (this.stomps[3] ?? this.ctx.end) - 0.02)) : 0;
    const body = smoothstep(start, start + 1.2, t) * 0.5;
    const hits: Charge[] = this.onsets.map((x) => ({ t: x, s: 0.3 }));
    for (const s of this.field.stars) {
      let [x, y, z] = this.field.place(s, k, -14 * (t - start), -40 * (t - start));
      if (!z) continue;
      const g1 = glowAt(t, this.uv.map((e) => ({ t: e.t, s: e.s! * (0.3 + 0.5 * s.d) })), { tau: 1.2 });
      const g2 = glowAt(t, hits.map((e) => ({ t: e.t, s: e.s! * s.k })), { tau: 0.8 });
      let level = Math.max(g1.level * 0.6, g2.level * 0.6) + 0.02, flash = g1.flash * 0.15;
      let tone: Tone = n === 2 ? (s.k < 0.3 ? 'violet' : 'cyan') : 'green';
      if (n === 1 && t >= this.tInto) {
        const m = this.waveM(x, t);
        if (m > 0) { tone = mixTone(tone, 'gold', m); const tp = this.tPass(x); const g = glowAt(t, [{ t: tp, s: 0.8 * s.k + 0.2 }], { tau: 1.3 }); level = Math.max(level, g.level); flash = Math.max(flash, g.flash * 0.5); }
      }
      if (n === 2 && t >= this.pain.t1) { const g = glowAt(t, [{ t: this.pain.t1, s: 0.7 * s.d }], { tau: 1.0 }); if (g.level > level) { level = g.level; tone = 'gold'; } }
      if (gather > 0) {
        const q = clamp(gather * 1.2 - 0.2 * s.k);
        x = lerp(x, CX, q); y = lerp(y, CY, q); level = lerp(level, 0.9, q) * (1 - smoothstep(0.85, 1, q)); tone = mixTone(tone, 'gold', q);
        if (q >= 1) continue;
      }
      if (n === 2 && t >= this.here.start) { level *= 0.5; }
      st.stars.set(idx++, x, y, s.s * z * (1 - 0.5 * gather), s.r + k.r, { level, flash }, tone, body * (1 - gather));
    }
    return idx;
  }

  // ------------------------------------------------------------------------------------- n = 1 render
  private front(t: number) { return lerp(-300, W + 300, ease.inOutQuad(prog(t, this.tInto, this.tWaveEnd))); }
  private waveM(x: number, t: number) { return t < this.tInto ? 0 : smoothstep(-60, 60, this.front(t) - x); }
  private tPass(x: number) {
    const s = clamp((x + 300) / (W + 600));
    // inverse of inOutQuad
    const u = s < 0.5 ? Math.sqrt(s / 2) : 1 - Math.sqrt((1 - s) / 2);
    return this.tInto + u * (this.tWaveEnd - this.tInto);
  }

  private render1(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    if (t < this.ton.start) { idx = this.group(c, this.A!, t, m, idx); this.echoFall(c, t); }
    else if (t < this.turn.start) { idx = this.group(c, this.B!, t, m, idx); this.echoRecede(c, t, 6); }
    else if (t < this.here.start) {
      idx = this.group(c, this.C!, t, m, idx);
      // the front itself: a seam of white-gold stickers sweeping across
      if (t >= this.tInto && t < this.tWaveEnd + 0.05) {
        const fx = this.front(t);
        for (let i = 0; i < 46; i++) {
          const y = (i / 45) * (H + 200) - 100 + 18 * Math.sin(i * 1.7), x = fx + (y - CY) * 0.22 - 30 * hash(i, 3, 41);
          this.st.stars.set(idx++, x, y, 6 + 10 * hash(i, 1, 41), hash(i, 2, 41) * TAU, { level: 1.2, flash: 0.4 }, mixTone('gold', 'white', 0.4), 0);
        }
      }
    } else idx = this.press(c, t, idx);
    return idx;
  }

  /** a line of sticker words: stickers fly in and land on the onset; letters lit once landed */
  private group(c: CanvasRenderingContext2D, g: Grp, t: number, m: Xf, idx: number): number {
    const st = this.st, rad = (g.size / 12) * 0.8;
    g.words.forEach((w, wi) => {
      const bx = g.boxes[wi]!, sw = g.sw[wi]!;
      const gl = glowAt(t, [{ t: w.start, s: 1 }, ...this.uv.filter((e) => e.t > w.start).map((e) => ({ t: e.t, s: e.s! * 0.7 }))], { tau: 2.2 });
      const lv = Math.max(gl.level, t >= w.start ? 0.42 : 0);
      for (let k = 0; k < sw.pts.length; k++) {
        const p = sw.pts[k]!;
        const arr = w.start + 0.04 * p.a, D = 0.42 + 0.2 * p.b;
        if (t < arr - D) continue;
        const u = clamp((t - (arr - D)) / D), e = ease.outExpo(u);
        const tx = bx.x + p.x, ty = bx.y + p.y;
        const a = TAU * hash(g.seed, wi, k, 5), r = 380 + 520 * hash(g.seed, wi, k, 6);
        let x = lerp(tx + Math.cos(a) * r, tx, e), y = lerp(ty + Math.sin(a) * r * 0.7, ty, e);
        let size = rad * (0.85 + 0.3 * p.a) * lerp(0.4, 1, e) * (u >= 1 ? 1 + 0.7 * Math.pow(0.5, (t - arr) / 0.05) : 1), rot = (1 - e) * (p.a - 0.5) * 9 + (p.b - 0.5) * 0.16;
        let level = u < 1 ? 0.25 + 0.4 * e : lv, flash = u < 1 ? 0 : gl.flash;
        if (g.peel !== undefined) {
          const tp = Math.max(g.peel, w.start + 0.5) + 0.9 * p.b + 0.3 * ((tx - g.boxes[0]!.x) / 1400), tt = t - tp;
          if (tt > 0) { y -= 260 * tt + 160 * tt * tt; x += 60 * Math.sin(k * 1.3) * tt; level *= Math.exp(-tt / 1.0) * 0.9 + 0.1; flash = 0; rot += tt * (p.a - 0.5) * 3; }
        }
        let tone: Tone = this.v.base;
        if (g === this.C) { const [sx] = apply(m, x, y); const mm = this.waveM(sx, t); if (mm > 0) { tone = mixTone(tone, 'gold', mm); const g2 = glowAt(t, [{ t: this.tPass(sx), s: 1 }], { tau: 1.6 }); level = Math.max(level, g2.level); flash = Math.max(flash, g2.flash * 0.6); } }
        if (level < 0.012 && flash < 0.012) continue;
        idx = starW(st.stars, idx, m, x, y, size, rot, { level, flash }, tone, 0.2);
      }
      // the lit lettering on top once the stickers have landed
      const pk = g.peel !== undefined ? Math.max(g.peel, w.start + 0.5) : 0;
      const fade = g.peel !== undefined ? 1 - 0.75 * smoothstep(pk, pk + 1.3, t) : 1;
      const fl = lv * 0.4 * smoothstep(w.start - 0.02, w.start + 0.12, t) * fade;
      let tone: Tone = this.v.base;
      if (g === this.C) { const [sx] = apply(m, bx.x + bx.w / 2, bx.y); const mm = this.waveM(sx, t); if (mm > 0) tone = mixTone(tone, 'gold', mm); }
      if (fl > 0.01) txt(c, bx.text, bx.x, bx.y, g.size, { level: fl, flash: gl.flash * 0.4 * fade }, tone, { align: 'left' });
    });
    return idx;
  }

  /** HERE WE GO (n = 1): rows of a justified slab, pressed on every stomp, crushed into a point */
  private press(c: CanvasRenderingContext2D, t: number, idx: number): number {
    const ws = this.here.words, st = this.stomps, end = this.ctx.end;
    const tCrush = ws[5]!.start, tPoint = (st[3] ?? end) - 0.03;
    const rows = ws.filter((w) => t >= w.start).length;
    if (!rows) return idx;
    let press = 0;
    st.forEach((s) => { if (t >= s) press++; });
    const sp = st.reduce((v, s) => Math.max(v, t >= s ? Math.pow(0.5, (t - s) / 0.06) : 0), 0);
    const widths = [125, 112, 100, 87, 75, 62], weights = [700, 800, 900, 900, 900, 900];
    const wid = widths[Math.min(5, press + Math.max(0, rows - 3))]!, wt = weights[Math.min(5, press + rows - 1)]!;
    const fam = arch(wid, wt);
    const Hs = 860 * Math.pow(0.9, press), SW = 1560 * Math.pow(0.86, press);
    const gap = 0.14, h = Hs / (rows + gap * (rows - 1)), CAPH = 0.69;
    const crush = ease.inCubic(prog(t, tCrush + 0.08, tPoint));
    const sq = 1 - 0.1 * sp; // the stomp squashes the slab for a moment
    const invOn = st[0] !== undefined && t >= st[0]! && t < st[0]! + 0.12;
    this.pressInv = invOn;
    if (invOn) flood(c, { level: 0.85, flash: 0.3 * Math.pow(0.5, (t - st[0]!) / 0.04) }, 'gold');
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.translate(CX, CY); c.scale((1 - crush) * (1 + 0.02 * sp), (1 - crush) * sq); c.translate(-CX, -CY);
    const heat = crush;
    for (let i = 0; i < rows; i++) {
      const w = ws[i]!, text = UP(w.w), mw = measure(text, fam, 100);
      const size = h / CAPH, sx = SW / (mw * size / 100);
      const y = CY - Hs / 2 + i * h * (1 + gap) + h;
      const k = slamK(t, w.start, { from: 1.35, tau: 0.035 });
      const g = this.wg(t, w.start, 0.42 + 0.06 * press);
      g.level *= 0.85; g.flash *= 0.55;
      g.level = lerp(g.level, 1.3, heat); g.flash = Math.max(g.flash, heat * heat);
      c.save(); c.translate(CX, y - h / 2); c.scale(k * sx, k); c.translate(0, h / 2);
      if (invOn) { c.font = `${size}px "${fam}"`; c.textAlign = 'center'; c.fillStyle = '#000'; c.fillText(text, 0, 0); }
      else txt(c, text, 0, 0, size, g, mixTone('gold', 'white', 0.6 * heat), { family: fam });
      c.restore();
    }
    c.restore();
    // the point: white-hot, the frame's only light, until the chorus detonates it
    if (crush > 0.85 || t >= tPoint) {
      const q = smoothstep(0.85, 1, crush);
      this.st.stars.set(idx++, CX, CY, lerp(6, 26, q) * (1 + 0.3 * Math.sin(t * 90)), t * 3, { level: 1.6, flash: q }, mixTone('gold', 'white', 0.7), 0);
    }
    return idx;
  }

  // ------------------------------------------------------------------------------------- n = 2 render
  private render2(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number, inv?: [number, number, Tone]): number {
    if (inv) { flood(c, { level: 0.85, flash: 0.3 * Math.pow(0.5, (t - inv[0]) / 0.04) }, inv[2]); useXf(c, m); }
    if (t < this.here.start) {
      for (const it of this.items) {
        if (t < it.show || t >= it.hide) continue;
        // the echoed words become their echo: the original leaves with it
        if (this.echoGo && t >= this.echoGo.start && it.on > this.ton.start && it.on < this.turn.start) continue;
        if (this.echoLow && t >= this.echoLow.start && it.text === 'LOW') continue;
        const isUp = it.text === 'UP' && t >= this.tUpWhip;
        if (isUp) {
          // thrown: up out of the frame, stretched by its speed
          const tt = t - this.tUpWhip;
          c.save(); c.translate(0, -2600 * tt * tt - 300 * tt);
          this.say(c, it, t, { from: 1.8 }); c.restore();
          continue;
        }
        this.say(c, it, t, { from: it.size > 400 ? 1.6 : 1.45, sus: 0.66 });
      }
      if (t < this.ton.start) this.echoFall(c, t);
      else if (t < this.turn.start) this.echoRecede(c, t, 8);
      else this.odometer(c, t, !!inv);
    } else idx = this.diveDraw(c, t, idx, !!inv);
    return idx;
  }

  /** PAIN -> GOLD: four reels roll on "into" and land on "gold" */
  private odometer(c: CanvasRenderingContext2D, t: number, ink: boolean) {
    const p = this.pain, A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', src = 'PAIN', dst = 'GOLD';
    const fam = arch(100, 900), size = p.size, cw = size * 0.78, ch = size * 0.86;
    const pw = this.turn.words.find((w) => /^pain/i.test(w.w))!;
    const k0 = slamK(t, pw.start, { from: 1.6, tau: 0.04 });
    if (!k0) return;
    for (let i = 0; i < 4; i++) {
      const a = A.indexOf(src[i]!), b = A.indexOf(dst[i]!);
      const steps = ((b - a + 26) % 26) + 26; // one full turn and on to the target
      const t1 = p.t1 + 0.035 * i - 0.03;
      const u = prog(t, p.t0, t1, (x) => 1 - Math.pow(1 - x, 2.6));
      const pos = u * steps, base = Math.floor(pos), fr = pos - base;
      const x = p.x + (i - 1.5) * cw, y = p.y;
      const landed = t >= t1;
      const gl = landed ? this.wg(t, t1, 0.75) : t < p.t0 ? this.wg(t, pw.start, 0.6) : { level: 0.75, flash: 0 };
      const tone: Tone = landed ? 'gold' : u > 0 ? mixTone(this.v.base, 'gold', u * 0.6) : this.v.base;
      c.save();
      c.translate(p.x, p.y - size * 0.36); c.scale(k0, k0); c.translate(-p.x, -(p.y - size * 0.36));
      c.beginPath(); c.rect(x - cw / 2, y - ch * 0.92, cw, ch * 1.02); c.clip();
      for (let j = landed ? 0 : -1; j <= (landed ? 0 : 1); j++) {
        const ci = landed ? b : (a + base + j + 26 * 4) % 26, yy = landed ? y : y + (j - fr) * ch * 1.0;
        if (ink) { c.font = `${size}px "${fam}"`; c.textAlign = 'center'; c.fillStyle = '#000'; c.fillText(A[ci]!, x, yy); }
        else txt(c, A[ci]!, x, yy, size, gl, tone, { family: fam });
      }
      c.restore();
    }
  }

  /** HERE WE GO (n = 2): nested compositions, the camera dives through each O */
  private diveDraw(c: CanvasRenderingContext2D, t: number, idx: number, ink: boolean): number {
    const ws = this.here.words, d = this.dive, S0 = d.S0, fam = arch(125, 900), famS = arch(100, 900);
    const [a, b] = this.tDive;
    const level = (k: number, w0: number) => {
      const s = Math.pow(d.f, k), [ox, oy] = this.levelOff(k);
      c.save(); c.translate(ox, oy); c.scale(s, s);
      const lay = [{ text: UP(ws[w0]!.w), on: ws[w0]!.start }, { text: UP(ws[w0 + 1]!.w), on: ws[w0 + 1]!.start }];
      const goW = measure('GO', fam, S0), xc = d.ox + goW / 2;
      // HERE WE row above GO
      const rs = S0 * 0.4, rowW = measure(`${lay[0]!.text} ${lay[1]!.text}`, famS, rs), wh = measure(`${lay[0]!.text} `, famS, rs);
      const ry = d.oy - S0 * 0.686 - S0 * 0.1;
      const items = [
        { text: lay[0]!.text, x: xc - rowW / 2 + measure(lay[0]!.text, famS, rs) / 2, y: ry, size: rs, on: lay[0]!.on, tone: 'white' as Tone, family: famS },
        { text: lay[1]!.text, x: xc - rowW / 2 + wh + measure(lay[1]!.text, famS, rs) / 2, y: ry, size: rs, on: lay[1]!.on, tone: 'white' as Tone, family: famS },
        { text: 'GO', x: xc, y: d.oy, size: S0, on: ws[w0 + 2]!.start, tone: 'gold' as Tone, family: fam },
      ];
      for (const it of items) this.say(c, it, t, { from: 1.4, sus: 0.7, ink });
      c.restore();
    };
    if (t < a![1] + 0.02) level(0, 0);
    if (t >= a![0]) level(1, 3);
    // the light inside the last O: it grows with the last GO and floods the frame at the cut
    if (t >= ws[5]!.start) {
      const s = Math.pow(d.f, 2), [ox, oy] = this.levelOff(1);
      const u = prog(t, ws[5]!.start, b![1]), r = d.ch * Math.pow(d.f, 1) * 0.95;
      const g = c.createRadialGradient(ox, oy, 0, ox, oy, r);
      const lv = 0.25 + 0.75 * u * u;
      g.addColorStop(0, phosphorCss({ level: lv, flash: u * u }, mixTone('violet', 'white', 0.5)));
      g.addColorStop(0.7, phosphorCss({ level: lv * 0.6, flash: 0 }, 'violet', 0.8));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.save(); c.fillStyle = g; c.beginPath(); c.ellipse(ox, oy, d.cw * Math.pow(d.f, 1) * 0.96, r, 0, 0, TAU); c.fill(); c.restore();
      void s;
    }
    return idx;
  }
}
void hash; void W; void H;
