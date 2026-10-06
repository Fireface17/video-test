// CHORUS 1 in phosphor: eight lines, eight ideas, cut like the sister clip. The camera is never at rest and jumps on hard
// cuts (on the sung onsets and the downbeats); every word SLAMS in on its onset (big -> set in ~0.1 s, white-hot, then its
// phosphor afterglow); nothing jiggles: motion is camera, cuts and the type turning into things.
//
//   open    the pre-chorus's ignition point (screen centre) DETONATES on the cut: shrapnel of stickers, the field is
//           charged by the shock front as it passes.
//   1 "We don't gotta be okay to dance"   a poster set row by row, a cut per row; OKAY is struck through on the snare;
//           TO DANCE pulls out to the whole poster, then the CAMERA dances: hard cuts between crops of DANCE on the
//           hits, the last one an inversion (ink on gold).
//   2 "We'll be glowing in the dark, take my hand"   in the dark the words are barely charged; on GLOWING (downbeat) a
//           UV flash charges everything; on TAKE a whip pan to the right, HAND lands in gold and the field answers.
//   3 "Every broken piece becomes a star"   BROKEN shatters on the downbeat (shards fly, the frame shakes); on BECOMES
//           every shard snaps into a gold star; on STAR they burst into stickers that fly into the word STAR, landing
//           on the next downbeat.
//   4 "Look how beautiful we are"   BEAUTIFUL is a word of dead stickers; its letters ignite one per eighth as the
//           note is held while the camera pulls back from an extreme close-up of the B.
//   5 "So sing it like we're never coming down"   the words climb a column, the camera jumps up a step per word; on
//           DOWN the world rolls 180 degrees: DOWN, set upside down, lands upright, the climb hangs below.
//   6 "Loud enough to wake the whole town"   LOUD full frame with a hard shake; WAKE: a town of dead stickers wakes, a
//           charge front runs out of the word; TOWN in gold, a second front, the camera pulls out over it all.
//   7 "We don't gotta be okay to dance" (again, harder)   one full-frame slam per word, alternating ink-on-phosphor
//           inversions; OKAY struck through; DANCE cut between crops on the eighths.
//   8 "We'll be glowing in the dark"   on the held GLOWING the whole field streams into the word, which charges up;
//           the drums stop and it glows alone; IN THE DARK: it drains to afterglow, and everything collapses into the
//           centre point that drop 1 (phos-drop) bursts out of.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import type { Line, Word } from '../../engine/lyrics';
import { W, H } from '../../engine/gl';
import { layout, measure } from '../../engine/type';
import { clamp, ease, hash, lerp, prog, smoothstep, TAU } from '../../engine/util';
import { hitFx, PhosphorStage, StickerWord, glowAt, uvEvents, uvPulse, loadPhosphorFont, mixTone, phosphorCss, PHOS_FONT, type Charge, type Tone, type Glow } from '../lib/phosphor';
import { apply, cam, camXf, CX, CY, Field, flood, mixCam, pulses, shotAt, slamK, starW, txt, useXf, type Cam, type Shot, type Xf } from '../lib/phos-cut';

interface Item { text: string; x: number; y: number; size: number; on: number; w: number }
interface Shard { poly: [number, number][]; cx: number; cy: number; area: number; vx: number; vy: number; w: number }

/** Sutherland-Hodgman: polygon clipped to the half-plane (p - a) . n >= 0. */
function clipHalf(poly: [number, number][], a: [number, number], n: [number, number]): [number, number][] {
  const out: [number, number][] = [];
  const side = (p: [number, number]) => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!, sp = side(p), sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) { const u = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]); }
  }
  return out;
}
const UP = (s: string) => s.toUpperCase().replace(/[,.!?]/g, '');
const S = (t0: number, t1: number, a: Cam, b: Cam, fn: (x: number) => number = ease.outQuad, id = ''): Shot =>
  ({ t: t0, id, cam: (t: number) => mixCam(a, b, prog(t, t0, t1, fn)) });

export default class PhosChorus extends Scene {
  st!: PhosphorStage;
  field!: Field;
  L: Line[] = [];
  shots: Shot[] = [];
  lineT: number[] = []; // the cut that starts each line
  curZ = 1;
  uv: Charge[] = [];
  onsets: number[] = []; // every slam (camera punch)
  // per line
  poster: Item[] = []; strike1 = 0; dance1: number[] = [];
  l2: Item[] = []; tGlow = 0; tWhip = 0;
  l3: Item[] = []; shards: Shard[] = []; tShatter = 0; tBecome = 0; tStar = 0; tLand = 0; star!: StickerWord; starX = 0; starY = 0; brokenBox = { x: 0, y: 0, w: 0, h: 0 };
  l4: Item[] = []; beau!: StickerWord; beauX = 0; beauY = 0; beauG: number[] = []; beauT: number[] = []; beauGX: number[] = [];
  l5: Item[] = []; tRoll = 0;
  l6: Item[] = []; town: { x: number; y: number; s: number; r: number; k: number }[] = []; tWake = 0; tTown = 0;
  l7: Item[] = []; inv7: boolean[] = []; strike7 = 0; dance7: number[] = [];
  l8: Item[] = []; glow!: StickerWord; glowX = 0; glowY = 0; tHeld = 0; tDark = 0; tQuiet = 0;

  override async init() {
    await loadPhosphorFont();
    const { lyrics, audio, start, end } = this.ctx;
    this.st = new PhosphorStage(this.ctx, 5200);
    this.field = new Field(900, 4);
    this.L = lyrics.linesIn(start - 0.3, end + 0.2).filter((l) => !l.kind && l.start >= start - 0.4 && l.start < end - 0.2);
    this.uv = uvEvents(audio, start - 1, end + 0.5, { thr: 0.62 });
    const L = this.L, D = audio.downbeats;
    const db = (t: number) => D.reduce((b, d) => (Math.abs(d - t) < Math.abs(b - t) ? d : b), D[0]!);
    const w = (li: number, re: RegExp | number): Word => typeof re === 'number' ? L[li]!.words[re]! : L[li]!.words.find((x) => re.test(x.w))!;
    const on = (li: number, re: RegExp | number) => w(li, re).start;
    const kicks = (a: number, b: number, thr = 0.5) => audio.events('kick', a, b).filter(([, s]) => s >= thr).map(([t]) => t);
    const snares = (a: number, b: number, thr = 0.6) => audio.events('snare', a, b).filter(([, s]) => s >= thr).map(([t]) => t);
    /** a row of words centred on x = 960 at baseline y */
    const row = (li: number, idx: number[], size: number, y: number, x = CX): Item[] => {
      const texts = idx.map((i) => UP(L[li]!.words[i]!.w)), ws = texts.map((s) => measure(s, PHOS_FONT, size)), gap = size * 0.3;
      const tw = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
      let x0 = x - tw / 2;
      return idx.map((i, k) => { const it = { text: texts[k]!, x: x0 + ws[k]! / 2, y, size, on: L[li]!.words[i]!.start, w: ws[k]! }; x0 += ws[k]! + gap; return it; });
    };
    const sh: Shot[] = [];

    // ---------------------------------------------------------------- 1: the poster
    {
      this.poster = [...row(0, [0, 1], 210, 300), ...row(0, [2, 3], 230, 560), ...row(0, [4], 330, 850), ...row(0, [5, 6], 250, 1110)];
      const dn = this.poster[6]!, tDance = dn.on;
      this.strike1 = snares(on(0, /^okay/i) + 0.05, on(0, /^okay/i) + 0.4)[0] ?? on(0, /^okay/i) + 0.12;
      const hits = [...kicks(tDance + 0.2, L[1]!.start - 0.1, 0.4), ...snares(tDance + 0.2, L[1]!.start - 0.1, 0.75)].sort((a, b) => a - b);
      this.dance1 = hits.filter((t, i) => i === 0 || t - hits[i - 1]! > 0.12).slice(-4);
      const dx0 = dn.x - dn.w / 2;
      sh.push(S(start, on(0, 2), cam(CX, 245, 1.36, 0), cam(CX + 20, 240, 1.48, 0.0), ease.linear, 'L1a'));
      sh.push(S(on(0, 2), on(0, 4), cam(CX - 40, 500, 1.3, -0.035), cam(CX + 20, 505, 1.38, -0.035), ease.linear));
      const tB = db(on(0, 3));
      if (Math.abs(tB - on(0, 3)) < 0.15) sh.push(S(tB, on(0, 4), cam(CX + 60, 510, 1.12, 0.03), cam(CX + 30, 505, 1.17, 0.03), ease.linear));
      sh.push(S(on(0, 4), on(0, 5), cam(CX, 735, 1.45, 0), cam(CX - 20, 740, 1.52, 0.012), ease.linear));
      sh.push(S(on(0, 5), this.dance1[0] ?? tDance + 0.4, cam(CX, 700, 0.8, 0), cam(CX, 690, 0.74, 0), ease.outCubic));
      const crops: Cam[] = [cam(dx0 + dn.w * 0.22, 1060, 2.5, -0.1), cam(dx0 + dn.w * 0.8, 1050, 2.3, 0.09), cam(dn.x, 1030, 1.42, 0), cam(dn.x, 1030, 1.62, 0)];
      this.dance1.forEach((t, i) => { const a = crops[i]!; sh.push(S(t, L[1]!.start, a, { ...a, z: a.z * 1.06 }, ease.linear)); });
    }
    // ---------------------------------------------------------------- 2: glowing in the dark, take my hand
    {
      this.tGlow = on(1, /^glow/i); this.tWhip = on(1, /^take/i);
      this.l2 = [...row(1, [0, 1], 130, 340), ...row(1, [2], 380, 640), ...row(1, [3, 4, 5], 150, 830),
        ...row(1, [6, 7], 190, 430, CX + 2400), ...row(1, [8], 470, 820, CX + 2400)];
      const tg = db(this.tGlow);
      sh.push(S(L[1]!.start, tg, cam(CX, 520, 1.24, 0.02), cam(CX, 530, 1.4, 0.02), ease.inQuad, 'L2'));
      sh.push(S(tg, this.tWhip, cam(CX, 610, 1.0, 0), cam(CX - 10, 620, 0.9, -0.02), ease.outCubic));
      const t0 = this.tWhip, t1 = t0 + 0.24;
      const A = cam(CX - 10, 620, 0.9, -0.02), B = cam(CX + 2400, 610, 1.0, 0), Bz = cam(CX + 2400, 625, 1.12, 0);
      sh.push({ t: t0, cam: (t) => t < t1 ? mixCam(A, B, ease.inOutCubic(prog(t, t0, t1))) : mixCam(B, Bz, prog(t, t1, L[2]!.start, ease.outQuad)) });
    }
    // ---------------------------------------------------------------- 3: broken piece becomes a star
    {
      this.l3 = [...row(2, [0], 190, 330), ...row(2, [1], 330, 650), ...row(2, [2], 170, 600), ...row(2, [3, 4], 150, 300)];
      const br = this.l3[1]!;
      this.brokenBox = { x: br.x - br.w / 2, y: br.y - br.size * 0.78, w: br.w, h: br.size * 1.0 };
      this.tShatter = db(on(2, /^broken/i));
      if (this.tShatter < on(2, /^broken/i) + 0.05) this.tShatter = on(2, /^broken/i) + 0.12;
      this.tBecome = on(2, /^becomes/i); this.tStar = on(2, /^star/i); this.tLand = db(this.tStar + 0.35);
      this.makeShards();
      this.star = new StickerWord('STAR', 440, 440 / 13, 71);
      this.starX = CX - this.star.width / 2; this.starY = 830;
      sh.push(S(L[2]!.start, this.tShatter, cam(CX, 470, 1.18, 0), cam(CX, 480, 1.28, 0), ease.linear, 'L3'));
      sh.push(S(this.tShatter, on(2, /^piece/i), cam(CX, 600, 0.98, -0.05), cam(CX, 600, 0.92, -0.05), ease.outCubic));
      sh.push(S(on(2, /^piece/i), this.tBecome, cam(CX, 560, 0.9, 0.04), cam(CX, 560, 0.95, 0.04), ease.linear));
      sh.push(S(this.tBecome, this.tLand, cam(CX, 540, 0.84, 0), cam(CX, 560, 0.9, 0), ease.linear));
      sh.push(S(this.tLand, L[3]!.start, cam(CX, 690, 1.12, 0), cam(CX, 690, 1.3, 0), ease.outQuad));
    }
    // ---------------------------------------------------------------- 4: look how beautiful we are
    {
      this.l4 = [...row(3, [0, 1], 170, 290), ...row(3, [3, 4], 200, 900)];
      const bw = w(3, /^beaut/i), size = 280;
      this.beau = new StickerWord('BEAUTIFUL', size, size / 12.5, 83);
      this.beauX = CX - this.beau.width / 2; this.beauY = 700;
      const lay = layout('BEAUTIFUL', PHOS_FONT, size);
      this.beauGX = lay.glyphs.map((g) => g.x + g.w / 2);
      this.beauG = this.beau.pts.map((p) => Math.max(0, lay.glyphs.findIndex((g, i) => p.x < g.x + g.w || i === lay.glyphs.length - 1)));
      const n = lay.glyphs.length, span = Math.min(0.215 * (n - 1), bw.end - bw.start - 0.25);
      this.beauT = lay.glyphs.map((_, i) => bw.start + (span * i) / (n - 1));
      const tB = db(bw.start), tWe = on(3, /^we$/i);
      sh.push(S(L[3]!.start, tB, cam(CX, 260, 1.5, -0.03), cam(CX + 20, 265, 1.62, -0.03), ease.linear, 'L4'));
      const xB = this.beauX + this.beauGX[0]!;
      sh.push({ t: tB, cam: (t) => { const u = prog(t, tB, tWe, ease.inOutCubic); return { x: lerp(xB, CX, u), y: lerp(640, 620, u), z: Math.exp(lerp(Math.log(3.0), Math.log(1.0), u)), r: lerp(0.07, 0, u) }; } });
      sh.push(S(tWe, L[4]!.start, cam(CX, 640, 0.9, 0), cam(CX, 640, 0.96, 0), ease.linear));
    }
    // ---------------------------------------------------------------- 5: never coming down (the column, the roll)
    {
      const P: [number, number, number][] = [[690, 1010, 150], [1180, 870, 200], [640, 710, 150], [900, 710, 150], [1200, 560, 170], [780, 400, 240], [1150, 210, 240]];
      this.l5 = L[4]!.words.slice(0, 7).map((x, i) => ({ text: UP(x.w), x: P[i]![0], y: P[i]![1], size: P[i]![2], on: x.start, w: measure(UP(x.w), PHOS_FONT, P[i]![2]) }));
      const dw = w(4, /^down/i);
      this.l5.push({ text: 'DOWN', x: CX, y: -120, size: 420, on: dw.start, w: measure('DOWN', PHOS_FONT, 420) });
      this.tRoll = db(dw.start); if (this.tRoll > dw.start) this.tRoll = dw.start - 0.08;
      const ws = this.l5.slice(0, 7);
      ws.forEach((it, i) => {
        const nx = i + 1 < 7 ? ws[i + 1]!.on : this.tRoll;
        const a = cam(lerp(CX, it.x, 0.35), it.y - it.size * 0.3 - 40, 1.22, 0);
        const prev = i ? cam(lerp(CX, ws[i - 1]!.x, 0.35), ws[i - 1]!.y - ws[i - 1]!.size * 0.3 - 40, 1.22, 0) : { ...a, y: a.y + 120 };
        sh.push({ t: it.on, id: i ? '' : 'L5', cam: (t) => { const u = ease.outExpo(prog(t, it.on, it.on + 0.14)); const c = mixCam(prev, a, u); return { ...c, y: c.y - 60 * prog(t, it.on, nx) }; } });
      });
      const last = cam(lerp(CX, ws[6]!.x, 0.35), ws[6]!.y - ws[6]!.size * 0.3 - 100, 1.22, 0), tr = this.tRoll;
      sh.push({ t: tr, cam: (t) => { const u = ease.inOutCubic(prog(t, tr, tr + 0.42)); const c = mixCam(last, cam(CX, -150, 1.0, Math.PI), u); return { ...c, z: c.z * (1 + 0.07 * prog(t, tr + 0.42, L[5]!.start)) }; } });
    }
    // ---------------------------------------------------------------- 6: loud enough to wake the whole town
    {
      this.l6 = [{ text: 'LOUD', x: CX, y: 720, size: 560, on: L[5]!.words[0]!.start, w: measure('LOUD', PHOS_FONT, 560) },
        ...row(5, [1, 2], 230, 610), ...row(5, [3], 300, 690), ...row(5, [4, 5], 160, 430), ...row(5, [6], 420, 760)];
      this.tWake = on(5, /^wake/i); this.tTown = on(5, /^town/i);
      const tT = Math.abs(db(this.tTown) - this.tTown) < 0.1 ? db(this.tTown) : this.tTown;
      sh.push(S(L[5]!.start, on(5, 1), cam(CX, 540, 1.12, 0.02), cam(CX, 545, 1.2, 0.02), ease.linear, 'L6'));
      sh.push(S(on(5, 1), this.tWake, cam(CX - 60, 540, 1.25, -0.04), cam(CX - 30, 540, 1.32, -0.04), ease.linear));
      sh.push(S(this.tWake, tT, cam(CX, 580, 1.05, 0), cam(CX, 575, 0.86, 0), ease.outCubic));
      sh.push(S(tT, L[6]!.start, cam(CX, 620, 1.25, 0), cam(CX, 600, 0.72, 0), ease.outCubic));
      for (let gx = 0; gx < 64; gx++) for (let gy = 0; gy < 36; gy++) {
        const i = gx * 36 + gy;
        this.town.push({ x: CX + (gx - 31.5) * 52 + (hash(i, 1, 66) - 0.5) * 40, y: CY + 60 + (gy - 17.5) * 52 + (hash(i, 2, 66) - 0.5) * 40, s: 6 + 8 * hash(i, 3, 66), r: hash(i, 4, 66) * TAU, k: hash(i, 5, 66) });
      }
    }
    // ---------------------------------------------------------------- 7: the poster again, one full-frame slam per word
    {
      const ws = L[6]!.words;
      this.l7 = ws.map((x, i) => {
        const text = UP(x.w), m = measure(text, PHOS_FONT, 100), size = Math.min(640, (100 * (i === ws.length - 1 ? 1500 : 1380)) / m);
        return { text, x: CX, y: CY + size * 0.36, size, on: x.start, w: m * size / 100 };
      });
      this.inv7 = ws.map((_, i) => i % 2 === 1);
      const tOk = on(6, /^okay/i);
      this.strike7 = snares(tOk + 0.05, tOk + 0.4)[0] ?? tOk + 0.12;
      const dn = this.l7[this.l7.length - 1]!;
      const hits = [...snares(dn.on + 0.15, L[7]!.start - 0.12, 0.6)].filter((t, i, a) => i === 0 || t - a[i - 1]! > 0.15);
      this.dance7 = hits.slice(0, 5);
      const rolls = [-0.05, 0.04, -0.02, 0.06, 0, -0.04, 0];
      ws.forEach((x, i) => {
        const nx = ws[i + 1]?.start ?? this.dance7[0] ?? L[7]!.start;
        sh.push(S(x.start, nx, cam(CX, CY, 1.0, rolls[i]!), cam(CX, CY, 1.07, rolls[i]!), ease.linear, i ? '' : 'L7'));
      });
      const x0 = dn.x - dn.w / 2, cy = dn.y - dn.size * 0.36;
      const crops = [cam(x0 + dn.w * 0.18, cy, 2.3, -0.08), cam(x0 + dn.w * 0.84, cy, 2.1, 0.08), cam(dn.x, cy, 0.8, 0), cam(x0 + dn.w * 0.5, cy, 2.8, 0), cam(dn.x, cy, 1.1, -0.03)];
      this.dance7.forEach((t, i) => { const a = crops[i % crops.length]!; sh.push(S(t, L[7]!.start, a, { ...a, z: a.z * 1.05 }, ease.linear)); });
    }
    // ---------------------------------------------------------------- 8: glowing in the dark -> the point
    {
      this.l8 = [...row(7, [0, 1], 170, 380), ...row(7, [3, 4, 5], 150, 930)];
      const gw = w(7, /^glow/i);
      this.tHeld = gw.start; this.tDark = on(7, /^in$/i);
      this.tQuiet = audio.downbeats.find((d) => d > gw.start + 1.2 && d < this.tDark) ?? gw.start + 1.7;
      this.glow = new StickerWord('GLOWING', 380, 380 / 13, 97);
      this.glowX = CX - this.glow.width / 2; this.glowY = 700;
      sh.push(S(L[7]!.start, this.tHeld, cam(CX, 400, 1.35, 0.02), cam(CX, 405, 1.45, 0.02), ease.linear, 'L8'));
      sh.push(S(this.tHeld, this.tDark, cam(CX, 600, 0.95, 0), cam(CX, 590, 1.22, 0), ease.inOutQuad));
      sh.push(S(this.tDark, end, cam(CX, 700, 0.95, 0), cam(CX, 700, 1.02, 0), ease.linear));
    }
    this.shots = sh.sort((a, b) => a.t - b.t);
    this.lineT = L.map((_, i) => (i === 0 ? start : L[i]!.start));
    this.onsets = L.flatMap((l) => l.words.map((x) => x.start));
    void H;
  }

  // ----------------------------------------------------------------------------------- setup helpers
  private makeShards() {
    const b = this.brokenBox, seeds: [number, number][] = [];
    const n = 11;
    for (let i = 0; i < n; i++) seeds.push([b.x + b.w * ((i + 0.15 + 0.7 * hash(i, 77)) / n), b.y + b.h * (0.15 + 0.7 * hash(i, 78))]);
    seeds.forEach((s, i) => {
      let poly: [number, number][] = [[b.x - 30, b.y - 40], [b.x + b.w + 30, b.y - 40], [b.x + b.w + 30, b.y + b.h + 60], [b.x - 30, b.y + b.h + 60]];
      seeds.forEach((o, j) => {
        if (i === j) return;
        const mid: [number, number] = [(s[0] + o[0]) / 2 + (hash(i, j, 5) - 0.5) * 16, (s[1] + o[1]) / 2], nn: [number, number] = [s[0] - o[0], s[1] - o[1]];
        poly = clipHalf(poly, mid, nn);
      });
      const cx = poly.reduce((a, p) => a + p[0], 0) / Math.max(1, poly.length), cy = poly.reduce((a, p) => a + p[1], 0) / Math.max(1, poly.length);
      let area = 0;
      poly.forEach((p, k) => { const q = poly[(k + 1) % poly.length]!; area += p[0] * q[1] - q[0] * p[1]; });
      const dx = cx - (b.x + b.w / 2), dy = cy - (b.y + b.h / 2), dl = Math.hypot(dx, dy * 2) || 1;
      const sp = 1500 + 1300 * hash(i, 9);
      this.shards.push({ poly, cx, cy, area: Math.abs(area) / 2, vx: (dx / dl) * sp + (hash(i, 3) - 0.5) * 400, vy: (dy * 2 / dl) * sp * 0.7 + (hash(i, 4) - 0.6) * 500, w: (hash(i, 5) - 0.5) * 7 });
    });
  }

  // ----------------------------------------------------------------------------------------- helpers
  /** glow of a word slammed at `on`: white-hot, settles to `sus`, recharged by the strong kicks */
  private wg(t: number, on: number, sus = 0.62): Glow {
    if (t < on) return { level: 0, flash: 0 };
    const dt = t - on, k = uvPulse(this.ctx.audio, t, { thr: 0.6, hl: 0.12 });
    return { level: sus + (1.15 - sus) * Math.exp(-dt / 0.3) + 0.22 * k, flash: 0.9 * Math.pow(0.5, dt / 0.05) };
  }
  /** a word that slams in (centred on its x, baseline y) */
  private say(c: CanvasRenderingContext2D, it: Item, t: number, tone: Tone, o: { sus?: number; from?: number; level?: number; family?: string } = {}) {
    const k = slamK(t, it.on, { from: o.from ?? 1.55, tau: 0.04 });
    if (!k) return;
    const g = this.wg(t, it.on, o.sus);
    if (o.level !== undefined) { g.level *= o.level; g.flash *= o.level; }
    c.save(); c.translate(it.x, it.y - it.size * 0.36); c.scale(k, k);
    txt(c, it.text, 0, it.size * 0.36, it.size, g, tone, { family: o.family });
    c.restore();
  }
  private lineAt(t: number) { let li = 0; this.lineT.forEach((s, i) => { if (t >= s) li = i; }); return li; }

  // ------------------------------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { audio, start, end } = this.ctx, st = this.st, t = f.t, c = st.L.ctx;
    st.begin(out);
    const li = this.lineAt(t);
    const shot = shotAt(this.shots, t);
    const k0 = shot.cam(t);
    // camera punch on every sung onset and the strong kicks (the frame breathes with the slams)
    const punch = pulses(t, this.onsets, 0.07, 0.035) + 0.025 * uvPulse(audio, t, { thr: 0.55, hl: 0.08 });
    const k: Cam = { ...k0, z: k0.z * (1 + punch) };
    const m = camXf(k);
    this.curZ = k.z;
    let idx = 0;
    let inverted = 0;
    let shake: [number, number] = [0, 0];

    idx = this.drawField(t, k, li, idx);
    useXf(c, m);
    switch (li) {
      case 0: idx = this.line1(c, t, m, idx); break;
      case 1: idx = this.line2(c, t, m, idx); break;
      case 2: { const r = this.line3(c, t, m, idx); idx = r; break; }
      case 3: idx = this.line4(c, t, m, idx); break;
      case 4: this.line5(c, t); break;
      case 5: idx = this.line6(c, t, m, idx); break;
      case 6: inverted = this.line7(c, t); break;
      case 7: idx = this.line8(c, t, m, idx); break;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (li === 0) {
      inverted = Math.max(inverted, this.dance1.length >= 4 && t >= this.dance1[3]! ? 1 : 0);
    }
    // the detonation that opens the chorus (screen space: where the pre-chorus left its point)
    idx = this.detonation(t, idx);

    st.stars.commit(inverted ? 0 : idx);
    const det = Math.pow(0.5, Math.max(0, t - start) / 0.035);
    const bigUV = t >= this.tGlow && li === 1 ? Math.pow(0.5, (t - this.tGlow) / 0.18) : 0;
    const uv = Math.max(uvPulse(audio, t, { thr: 0.72 }) * 0.12, bigUV * 0.22);
    const o = st.end(out, { gain: 1.5, uv: inverted ? 0 : uv });
    // dynamics: kick punch + light shake, snare flash; LOUD and the shatter shake the camera hard
    const fx = hitFx(audio, t, { zoom: 0.0, shake: 3, flash: 0.06 });
    shake = fx.shake as [number, number];
    const hard = Math.max(pulses(t, [this.l6[0]!.on], 0.09), pulses(t, [this.tShatter], 0.08) * 0.8);
    if (hard > 0.01) { const ph = Math.round(t * 60); shake = [shake[0] + 26 * hard * Math.sin(ph * 2.1), shake[1] + 20 * hard * Math.cos(ph * 1.7)]; }
    const flash = Math.max(o.flash ?? 0, fx.flash as number, 0, bigUV * 0.25);
    const post: PostOverrides = { ...o, zoom: 1, shake, flash };
    if (inverted) { post.bloom = 0.25; post.halation = 0.04; post.flash = 0; }
    // the collapse into drop 1's point
    void end;
    return post;
  }

  // -------------------------------------------------------------------------------------------- field
  private drawField(t: number, k: Cam, li: number, idx: number): number {
    const st = this.st, start = this.ctx.start;
    const D = [0.75, 0.6, 0.6, 0.45, 0.7, 0.25, 0.55, 0.85][li]!;
    if (li === 6) return idx; // the full-frame slams own the frame
    const glowLine = li === 1 && t >= this.tGlow;
    // drop 1 bursts out of the centre: everything collapses into it in the last 0.35 s
    const col = li === 7 ? ease.inCubic(prog(t, this.ctx.end - 0.4, this.ctx.end - 0.02)) : 0;
    const absorb = li === 7 ? 1 : 0;
    const dx = -18 * (t - start), dy = -32 * (t - start);
    const fs = this.field.stars;
    for (let i = 0; i < fs.length; i++) {
      const s = fs[i]!;
      if (s.k > D) continue;
      if (absorb && i < this.glow.pts.length) continue; // these became GLOWING
      let [x, y, z] = this.field.place(s, k, dx, dy);
      if (!z && !col) continue;
      // the detonation's shock front charges the field as it passes
      const dist = Math.hypot(x - CX, y - CY), tf = start + dist / 2600;
      const g1 = t >= tf ? glowAt(t, [{ t: tf, s: 0.95 }], { tau: 0.9 }) : { level: 0, flash: 0 };
      const g2 = glowAt(t, this.uv.map((e) => ({ t: e.t, s: e.s! * (0.35 + 0.5 * s.d) })), { tau: 1.2 });
      let level = 0.05 + 0.45 * g2.level, flash = g2.flash * 0.1;
      level = Math.max(level, g1.level); flash = Math.max(flash, g1.flash * 0.6);
      if (glowLine) { const g = glowAt(t, [{ t: this.tGlow, s: 0.6 + 0.4 * s.d }], { tau: 2.4 }); level = Math.max(level, g.level); flash = Math.max(flash, g.flash * 0.7); }
      if (li === 1 && t < this.tGlow) level *= 0.4;
      let tone: Tone = s.gold ? 'gold' : 'green';
      if (li === 1 && t >= this.tWhip) {
        const th = this.l2[this.l2.length - 1]!.on, g = t >= th ? glowAt(t, [{ t: th, s: 0.8 }], { tau: 1.0 }) : { level: 0, flash: 0 };
        if (g.level > level) { level = g.level; tone = 'gold'; }
      }
      if (li === 2 && t >= this.tLand) { const g = glowAt(t, [{ t: this.tLand, s: 0.55 * s.d }], { tau: 0.8 }); if (g.level > level) { level = g.level; tone = 'gold'; } }
      if (col > 0) { x = lerp(x, CX, col); y = lerp(y, CY, col); level *= 1 + col; }
      st.stars.set(idx++, x, y, s.s * z * (1 - 0.7 * col), s.r + k.r + t * 0.05 * (s.k - 0.5), { level, flash }, tone, 0.45);
    }
    return idx;
  }

  // ------------------------------------------------------------------------------------ the detonation
  private detonation(t: number, idx: number): number {
    const st = this.st, start = this.ctx.start, tt = t - start;
    if (tt < 0 || tt > 1.3) return idx;
    for (let i = 0; i < 190; i++) {
      const a = TAU * hash(i, 1, 31) + 0.15 * Math.sin(i), R = 260 + 1300 * Math.pow(hash(i, 2, 31), 0.7), tau = 0.08 + 0.1 * hash(i, 3, 31);
      const d = R * (1 - Math.exp(-tt / tau)), lv = 1.3 * Math.exp(-tt / (0.25 + 0.35 * hash(i, 4, 31)));
      if (lv < 0.02) continue;
      const sz = (7 + 20 * Math.pow(hash(i, 5, 31), 2)) * (1 - 0.4 * clamp(tt / 1.2));
      const tone: Tone = i % 5 === 0 ? 'white' : i % 3 === 0 ? 'green' : 'gold';
      st.stars.set(idx++, CX + Math.cos(a) * d * 1.25, CY + Math.sin(a) * d * 0.85, sz, a * 3 + tt * (hash(i, 6, 31) - 0.5) * 8, { level: lv, flash: Math.pow(0.5, tt / 0.06) }, tone, 0);
    }
    // the core: one white-gold star that blows up and is gone in a few frames
    const q = prog(tt, 0, 0.1);
    if (q < 0.7) st.stars.set(idx++, CX, CY, lerp(60, 340, ease.outExpo(q)), 0, { level: 1.3 * (1 - q) * (1 - q), flash: (1 - q) * (1 - q) }, mixTone('gold', 'white', 1 - q), 0);
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 1
  private line1(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    const P = this.poster, inv = this.dance1.length >= 4 && t >= this.dance1[3]!;
    if (inv) {
      // the last hit: ink on gold, the flood drains toward the next line
      const u = prog(t, this.dance1[3]!, this.L[1]!.start);
      flood(c, { level: 0.95 - 0.35 * u, flash: 0.3 * Math.pow(0.5, (t - this.dance1[3]!) / 0.05) }, 'gold');
      const d = P[6]!;
      c.save(); c.translate(d.x, d.y); c.font = `${d.size}px "${PHOS_FONT}"`; c.textAlign = 'center'; c.fillStyle = '#000'; c.fillText(d.text, 0, 0); c.restore();
      return idx;
    }
    // in the dance crops only TO DANCE is on the sheet (the crops stay clean)
    const crops = this.dance1.length > 0 && t >= this.dance1[0]!;
    P.forEach((it, i) => { if (!crops || i >= 5) this.say(c, it, t, i === 6 ? mixTone('green', 'gold', 0.55) : 'green', { sus: 0.6 }); });
    // OKAY struck through on the snare: a neon slash, left to right in 70 ms
    const ok = P[4]!, u = prog(t, this.strike1, this.strike1 + 0.07, ease.outCubic);
    if (u > 0 && !crops) {
      const x0 = ok.x - ok.w / 2 - 50, x1 = ok.x + ok.w / 2 + 50, y0 = ok.y - ok.size * 0.24, y1 = ok.y - ok.size * 0.4;
      const g = { level: 0.75 + 0.5 * Math.exp(-(t - this.strike1) / 0.25), flash: 0.8 * Math.pow(0.5, (t - this.strike1) / 0.06) };
      c.save(); c.lineCap = 'round'; c.lineWidth = 26; c.strokeStyle = phosphorCss(g, 'pink');
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(lerp(x0, x1, u), lerp(y0, y1, u)); c.stroke(); c.restore();
    }
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 2
  private line2(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    const it = this.l2, tg = this.tGlow;
    const big = t >= tg ? glowAt(t, [{ t: tg, s: 1.25 }], { tau: 2.2 }) : null;
    it.forEach((x, i) => {
      if (i >= 6) { this.say(c, x, t, i === 8 ? 'gold' : mixTone('green', 'gold', 0.3), { sus: 0.7, from: i === 8 ? 1.8 : 1.55 }); return; }
      // in the dark the words only just charge; the UV flash at GLOWING lights everything that has been sung
      const k = slamK(t, x.on, { from: 1.4, tau: 0.04 });
      if (!k) return;
      const g = this.wg(t, x.on, i < 2 ? 0.3 : 0.62);
      if (i < 2 && t < tg) { g.level *= 0.55; }
      if (big && x.on <= tg + 0.02) { g.level = Math.max(g.level, big.level); g.flash = Math.max(g.flash, big.flash * 0.8); }
      const tone: Tone = i === 2 ? mixTone('green', 'white', 0.2) : i >= 3 ? mixTone('green', 'cyan', 0.5) : 'green';
      c.save(); c.translate(x.x, x.y - x.size * 0.36); c.scale(k, k); txt(c, x.text, 0, x.size * 0.36, x.size, g, tone); c.restore();
    });
    void m;
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 3
  private line3(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    const st = this.st, it = this.l3, ts = this.tShatter, tb = this.tBecome, tS = this.tStar, tL = this.tLand;
    const piece = this.L[2]!.words.find((w) => /^piece/i.test(w.w))!.start;
    if (t < piece) this.say(c, it[0]!, t, 'green');
    if (t < ts) this.say(c, it[1]!, t, 'green', { from: 1.7 });
    if (t >= piece && t < tb) this.say(c, it[2]!, t, 'green');
    if (t >= tb && t < tL) { this.say(c, it[3]!, t, mixTone('green', 'gold', 0.3)); this.say(c, it[4]!, t, mixTone('green', 'gold', 0.3)); }
    // the shards: fly (decelerating), spin; on BECOMES each snaps into a gold star; on STAR they burst into the word
    const br = it[1]!;
    const sh = this.shards, nS = sh.length;
    const pos = (s: Shard, i: number, tt: number) => {
      const e = 0.32 * (1 - Math.exp(-tt / 0.32)) + 0.35 * tt;
      return { x: s.cx + s.vx * e, y: s.cy + s.vy * e + 140 * tt * tt, a: s.w * e + (hash(i, 8) - 0.5) * 0.3 * tt };
    };
    if (t >= ts) {
      const tt = t - ts;
      sh.forEach((s, i) => {
        const tsn = tb + 0.025 * i;
        const p = pos(s, i, Math.min(tt, tS - ts));
        if (t < tsn) {
          const g = { level: 0.95 * Math.exp(-tt / 1.2) + 0.25, flash: 0.9 * Math.pow(0.5, tt / 0.05) };
          c.save();
          c.translate(p.x - s.cx, p.y - s.cy);
          c.translate(s.cx, s.cy); c.rotate(p.a); c.translate(-s.cx, -s.cy);
          c.beginPath(); s.poly.forEach((q, k) => (k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]))); c.closePath(); c.clip();
          txt(c, br.text, br.x, br.y, br.size, g, 'green');
          c.restore();
        } else if (t < tS) {
          const r = Math.sqrt(s.area) * 0.3 + 18, age = t - tsn;
          idx = starW(st.stars, idx, m, p.x, p.y, r * (1 + 0.9 * Math.pow(0.5, age / 0.05)), p.a + age * 0.6, { level: 1.0, flash: Math.pow(0.5, age / 0.06) }, 'gold', 0);
        }
      });
    }
    // STAR: the stars burst into stickers that fly into the word and land on the downbeat
    if (t >= tS) {
      const pts = this.star.pts;
      const fly = (j: number) => prog(t, tS + 0.03 * (j % 7) / 7, tL - 0.02, ease.inOutCubic);
      for (let j = 0; j < pts.length; j++) {
        const p = pts[j]!, s = sh[j % nS]!, i = j % nS, sp = pos(s, i, tS - ts);
        const u = fly(j);
        const tx = this.starX + p.x, ty = this.starY + p.y;
        const ang = TAU * p.a, burst = 70 * Math.sin(Math.PI * u) * p.b;
        const x = lerp(sp.x, tx, u) + Math.cos(ang) * burst, y = lerp(sp.y, ty, u) + Math.sin(ang) * burst;
        const landed = t >= tL;
        const g = landed ? glowAt(t, [{ t: tL, s: 1.15 }, ...this.uv.filter((e) => e.t > tL).map((e) => ({ t: e.t, s: 0.8 }))], { tau: 1.6 }) : { level: 0.85, flash: 0 };
        const size = (440 / 13) * 0.62 * (0.85 + 0.3 * p.a) * (landed ? 1 + 0.8 * Math.pow(0.5, (t - tL) / 0.05) : lerp(0.7, 1, u));
        idx = starW(st.stars, idx, m, x, y, size, ang + (1 - u) * 3, { level: Math.max(0.55, g.level), flash: g.flash }, mixTone('gold', 'white', 0.15 * p.b), 0);
      }
      if (t >= tL) {
        const g = this.wg(t, tL, 0.42);
        txt(c, 'STAR', CX, this.starY, 440, { level: g.level * 0.55, flash: g.flash * 0.6 }, 'gold');
      }
    }
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 4
  private line4(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    const st = this.st, it = this.l4;
    const tB = this.beauT[0]! - 0.1, tWe = this.l4[2]!.on;
    it.forEach((x, i) => { if (i >= 2 || t < tB || t >= tWe) this.say(c, x, t, i < 2 ? 'green' : mixTone('green', 'gold', 0.4)); });
    const zk = Math.min(1, 1.5 / this.curZ); // in the extreme close-up the stickers would bloom into a blob
    const pts = this.beau.pts, size0 = (280 / 12.5) * 0.6;
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j]!, gi = this.beauG[j]!, tg = this.beauT[gi]!;
      const x = this.beauX + p.x, y = this.beauY + p.y;
      if (t < tg) { idx = starW(st.stars, idx, m, x, y, size0 * 0.9, p.a * TAU, { level: 0.012, flash: 0 }, 'green', 0.9); continue; }
      const age = t - tg, g = glowAt(t, [{ t: tg + 0.02 * p.b, s: 1.2 }], { tau: 2.4 });
      idx = starW(st.stars, idx, m, x, y, size0 * (1 + 1.1 * Math.pow(0.5, age / 0.06)) * (0.85 + 0.3 * p.a), p.a * TAU, { level: Math.max(0.6, g.level) * zk, flash: g.flash * zk }, mixTone('gold', 'white', 0.25 + 0.3 * p.b), 0);
    }
    // the neon of each letter under its stickers (legibility), lit with it
    const lay = layout('BEAUTIFUL', PHOS_FONT, 280);
    lay.glyphs.forEach((gl, i) => {
      const tg = this.beauT[i]!;
      if (t < tg) return;
      const g = this.wg(t, tg, 0.3);
      txt(c, gl.ch, this.beauX + gl.x + gl.w / 2, this.beauY, 280, { level: g.level * 0.5 * zk, flash: g.flash * 0.4 * zk }, 'gold');
    });
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 5
  private line5(c: CanvasRenderingContext2D, t: number) {
    const it = this.l5, n = it.length;
    it.forEach((x, i) => {
      const last = i === n - 1;
      if (!last) { this.say(c, x, t, i >= 5 ? mixTone('green', 'gold', 0.25 * (i - 4)) : 'green', { sus: 0.55 }); return; }
      // DOWN is set upside down: the camera's half-turn lands it upright
      const k = slamK(t, x.on, { from: 1.9, tau: 0.045 });
      if (!k) return;
      const g = this.wg(t, x.on, 0.75);
      c.save(); c.translate(x.x, x.y - x.size * 0.36); c.rotate(Math.PI); c.scale(k, k); txt(c, x.text, 0, x.size * 0.36, x.size, g, 'gold'); c.restore();
    });
  }

  // ------------------------------------------------------------------------------------------- line 6
  private line6(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    const st = this.st, it = this.l6, tw = this.tWake, tt = this.tTown;
    const enough = it[1]!.on;
    if (t < enough) { this.say(c, it[0]!, t, mixTone('green', 'white', 0.1), { from: 2.0, sus: 0.75 }); return idx; }
    if (t < tw) { this.say(c, it[1]!, t, 'green'); this.say(c, it[2]!, t, 'green'); return idx; }
    // the town of dead stickers wakes: a charge front runs out of WAKE, a second, gold, out of TOWN
    const [wx, wy] = [it[3]!.x, it[3]!.y - 100], [tx, ty] = [it[6]!.x, it[6]!.y - 150];
    for (const s of this.town) {
      const d1 = Math.hypot(s.x - wx, s.y - wy), t1 = tw + d1 / 2300;
      const d2 = Math.hypot(s.x - tx, s.y - ty), t2 = tt + d2 / 2600;
      const ev: Charge[] = [];
      if (t >= t1) ev.push({ t: t1, s: 0.75 + 0.25 * s.k });
      if (t >= t2) ev.push({ t: t2, s: 0.9 });
      const g = ev.length ? glowAt(t, ev, { tau: 1.6 }) : { level: 0.012, flash: 0 };
      const gold = t >= t2;
      idx = starW(st.stars, idx, m, s.x, s.y, s.s * (1 + 0.6 * g.flash), s.r, { level: Math.max(0.012, g.level * (0.55 + 0.45 * s.k)), flash: g.flash * 0.7 }, gold ? mixTone('gold', 'green', 0.3 * s.k) : 'green', 0.9);
    }
    if (t < tt) { this.say(c, it[3]!, t, 'green', { from: 1.8 }); this.say(c, it[4]!, t, 'green'); this.say(c, it[5]!, t, 'green'); }
    else this.say(c, it[6]!, t, 'gold', { from: 1.8, sus: 0.8 });
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 7
  private line7(c: CanvasRenderingContext2D, t: number): number {
    const it = this.l7, n = it.length;
    let i = 0;
    it.forEach((x, k) => { if (t >= x.on) i = k; });
    const x = it[i]!;
    const inDance = i === n - 1 && this.dance7.length && t >= this.dance7[0]!;
    let hitN = -1;
    this.dance7.forEach((h, k) => { if (t >= h) hitN = k; });
    const inv = inDance ? hitN === 2 : this.inv7[i]!;
    const tone: Tone = i === n - 1 ? mixTone('green', 'gold', 0.5) : i % 4 === 1 ? 'gold' : 'green';
    if (inv) {
      const t0 = inDance ? this.dance7[hitN]! : x.on;
      flood(c, { level: 0.85, flash: 0.35 * Math.pow(0.5, (t - t0) / 0.05) }, typeof tone === 'string' ? tone : 'gold');
      const k = slamK(t, x.on, { from: 1.5, tau: 0.04 });
      c.save();
      c.translate(x.x, x.y - x.size * 0.36); c.scale(k, k);
      c.font = `${x.size}px "${PHOS_FONT}"`; c.textAlign = 'center'; c.fillStyle = '#000'; c.fillText(x.text, 0, x.size * 0.36);
      c.restore();
    } else this.say(c, x, t, tone, { from: 1.5, sus: 0.8 });
    // OKAY struck again
    if (/^OKAY/.test(x.text) && t >= this.strike7) {
      const u = prog(t, this.strike7, this.strike7 + 0.06, ease.outCubic), g = { level: 1.0, flash: 0.8 * Math.pow(0.5, (t - this.strike7) / 0.06) };
      const x0 = x.x - x.w / 2 - 60, x1 = x.x + x.w / 2 + 60, y0 = x.y - x.size * 0.22, y1 = x.y - x.size * 0.42;
      c.save(); c.lineCap = 'round'; c.lineWidth = 40; c.strokeStyle = this.inv7[i] ? '#000' : phosphorCss(g, 'pink');
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(lerp(x0, x1, u), lerp(y0, y1, u)); c.stroke(); c.restore();
    }
    return inv ? 1 : 0;
  }

  // ------------------------------------------------------------------------------------------- line 8
  private line8(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    const st = this.st, it = this.l8, end = this.ctx.end;
    const th = this.tHeld, td = this.tDark, tq = this.tQuiet;
    const col = ease.inCubic(prog(t, end - 0.4, end - 0.02));
    if (t < th) { this.say(c, it[0]!, t, 'green'); this.say(c, it[1]!, t, 'green'); return idx; }
    // GLOWING: the field streams into the word; its charge climbs through the held note; IN THE DARK it drains
    const pts = this.glow.pts, k = this.field.place.bind(this.field);
    const kk = shotAt(this.shots, t).cam(t);
    const drain = t >= td ? Math.exp(-(t - td) / 0.25) : 1;
    const charge = prog(t, th, tq, ease.outQuad);
    const size0 = (380 / 13) * 0.62;
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j]!, fs = this.field.stars[j]!;
      const ta = th + 0.05 + 1.3 * p.b * p.b;
      const u = prog(t, ta, ta + 0.5, ease.inOutCubic);
      const [fx, fy] = k(fs, kk, -18 * (t - this.ctx.start), -32 * (t - this.ctx.start));
      // field position is in screen space: bring it to world through the inverse of m
      const det = m.a * m.d - m.b * m.c, sx = fx - m.e, sy = fy - m.f;
      const wx0 = (m.d * sx - m.c * sy) / det, wy0 = (-m.b * sx + m.a * sy) / det;
      let x = lerp(wx0, this.glowX + p.x, u), y = lerp(wy0, this.glowY + p.y, u);
      const landed = u >= 1;
      let level = landed ? lerp(0.55, 1.05, charge) * (0.85 + 0.15 * p.a) : 0.25 + 0.4 * u, flash = landed ? 0.8 * Math.pow(0.5, (t - ta - 0.5) / 0.05) : 0;
      let tone: Tone = mixTone('green', 'white', 0.35 * charge * p.a);
      if (t >= td) { level = 0.12 + (level - 0.12) * drain; flash = 0; tone = mixTone('green', 'cyan', 0.6 * (1 - drain)); }
      if (col > 0) { const [sx2, sy2] = apply(m, x, y); const ws = this.toWorld(m, lerp(sx2, CX, col), lerp(sy2, CY, col)); x = ws[0]; y = ws[1]; level *= 1 + 1.5 * col; }
      idx = starW(st.stars, idx, m, x, y, size0 * (0.85 + 0.3 * p.a) * (landed ? 1 : lerp(0.6, 1, u)) * (1 - 0.6 * col), p.a * TAU, { level, flash }, tone, 0);
    }
    const g = this.wg(t, th, 0.4);
    const lv = (0.35 + 0.45 * charge) * (t >= td ? 0.25 + 0.75 * drain : 1) * (1 - col);
    txt(c, 'GLOWING', CX, this.glowY, 380, { level: g.level * lv, flash: g.flash * 0.5 }, t >= td ? mixTone('green', 'cyan', 0.5) : 'green');
    if (t >= td) for (const x of it.slice(2)) {
      const kx = slamK(t, x.on, { from: 1.3 });
      if (!kx) continue;
      const gg = this.wg(t, x.on, 0.5);
      c.save(); c.translate(x.x, x.y - x.size * 0.36); c.scale(kx * (1 - col), kx * (1 - col)); txt(c, x.text, 0, x.size * 0.36, x.size, { level: gg.level * 0.8, flash: gg.flash }, 'green'); c.restore();
    }
    if (col > 0) idx = this.point(t, idx, col);
    return idx;
  }
  private toWorld(m: Xf, x: number, y: number): [number, number] {
    const det = m.a * m.d - m.b * m.c, sx = x - m.e, sy = y - m.f;
    return [(m.d * sx - m.c * sy) / det, (-m.b * sx + m.a * sy) / det];
  }
  /** the point everything collapses into (screen centre) */
  private point(t: number, idx: number, col: number): number {
    this.st.stars.set(idx++, CX, CY, lerp(4, 46, col), t * 2, { level: 0.6 + 1.0 * col, flash: col }, mixTone('gold', 'white', col), 0);
    return idx;
  }
}
// keep the sticker body tone helper referenced for future lines
void smoothstep;
