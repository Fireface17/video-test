// CHORUS 3, the climax, in the language of the whole middle of the clip (phosphor stickers in the dark, type that slams
// in on its sung onset, a camera that is never at rest and cuts on the hits), escalated to gold. Each line is its own
// idea and none repeats chorus 1 (phos-chorus) move for move.
//
//  1 "We don't gotta be okay to dance": it opens on the gold the bridge ends in; WE / DON'T / GOTTA are punched out
//    of it as black full-frame stamps. On BE the drums come in and the gold SHATTERS: it was a carpet of gold
//    stickers, and they blow out from the centre and leave the dark. OKAY. TO DANCE: the survivors of the blast fly
//    back in, one batch per snare, and assemble DANCE left to right; the camera rolls in.
//  2 "We'll be glowing in the dark, take my hand": a flight THROUGH the line. The words stand one behind the other in
//    depth; the camera rushes forward and lands on each one as it is sung (the one before flies past us); GLOWING
//    burns white then green, IN THE DARK cools; on HAND the flight stops and the field takes the gold.
//  3 "Every broken piece becomes a star": BROKEN is made of stickers and is blown apart on the kick; the pieces
//    scatter (PIECE), swirl (BECOMES) and slam together into one GIANT STAR on STAR, the word punched through it.
//  4 "Look how beautiful we are": the camera pulls back from the giant star in steps on the hits, and the star is the
//    dot of the i of a huge "beautiful" in gold; WE ARE lands under it.
//  5 "We'll be glowing in the dark!": GLOWING slams in, made of stickers; when the band drops out it glows on alone
//    and fades to its green afterglow (glow in the dark, literally); the rebuild's hits each cut hard and recharge it
//    white-hot, throwing sparks; IN THE DARK! slams, and the last kick blows the frame to gold-white into drop 3.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import type { Line, Word } from '../../engine/lyrics';
import { W, H } from '../../engine/gl';
import { layout, measure } from '../../engine/type';
import { clamp, ease, hash, lerp, prog, smoothstep, TAU } from '../../engine/util';
import { hitFx, PhosphorStage, StickerWord, glowAt, uvPulse, loadPhosphorFont, mixTone, PHOS_FONT, type Glow, type Tone } from '../lib/phosphor';
import { cam, camXf, CX, CY, Field, flood, mixCam, pulses, shotAt, slamK, starW, txt, useXf, type Cam, type Shot, type Xf } from '../lib/phos-cut';

const UP = (s: string) => s.toUpperCase().replace(/[,.?]/g, '');
const S = (t0: number, t1: number, a: Cam, b: Cam, fn: (x: number) => number = ease.linear): Shot => ({ t: t0, cam: (t: number) => mixCam(a, b, prog(t, t0, t1, fn)) });
const GOLD_SOFT = mixTone('gold', 'white', 0.18);
const RG = 420; // the giant star's outer radius (world px)

interface P2 { x: number; y: number }

export default class PhosFinal extends Scene {
  st!: PhosphorStage;
  field!: Field;
  L: Line[] = [];
  shots: Shot[] = [];
  onsets: number[] = [];
  lineT: number[] = [];
  curZ = 1;
  // 1
  tBe = 0; tOk = 0; tTo = 0; carpet: { x: number; y: number; k: number; s: number; r: number }[] = []; surv: number[] = [];
  dance!: StickerWord; danceX = 0; danceY = 0; batches: number[] = []; danceB: number[] = [];
  // 2
  depth: { w: Word; text: string; z: number; ox: number; oy: number; size: number; tone: Tone }[] = []; deep: { x: number; y: number; z: number; s: number; r: number }[] = [];
  // 3
  broken!: StickerWord; brX = 0; brY = 0; tBreak = 0; tBecome = 0; tStar = 0; giant: P2[] = [];
  // 4
  beau = { size: 300, K: 14, x0: 0, y0: 0, dot: { x: 0, y: -200, r: 20 }, w: 0, steps: [] as number[], zEnd: 0.09 };
  // 5
  glow!: StickerWord; glX = 0; glY = 0; tGlow = 0; tOut = 0; tBack = 0; hits: number[] = []; tDark = 0; tLast = 0;

  override async init() {
    await loadPhosphorFont();
    const { lyrics, audio, start, end } = this.ctx;
    this.st = new PhosphorStage(this.ctx, 7000);
    this.field = new Field(520, 31);
    this.L = lyrics.linesIn(start - 0.3, end + 0.2).filter((l) => !l.kind && l.start >= start - 0.4 && l.start < end - 0.2);
    const L = this.L;
    const on = (li: number, re: RegExp) => L[li]!.words.find((w) => re.test(w.w))!.start;
    const kicks = (a: number, b: number, thr: number) => audio.events('kick', a, b).filter(([, s]) => s >= thr).map(([t]) => t);
    const snares = (a: number, b: number, thr: number) => audio.events('snare', a, b).filter(([, s]) => s >= thr).map(([t]) => t);
    const dedupe = (ts: number[], gap: number) => ts.sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1]! > gap);
    const sh: Shot[] = [];
    this.onsets = L.flatMap((l) => l.words.map((w) => w.start));
    this.lineT = L.map((l, i) => (i === 0 ? start : l.start));

    // ------------------------------------------------------------------ 1
    this.tBe = on(0, /^be$/i); this.tOk = on(0, /^okay/i); this.tTo = on(0, /^to$/i);
    for (let gy = -1; gy < 34; gy++) for (let gx = -1; gx < 58; gx++) {
      const i = (gy + 1) * 60 + gx + 1;
      this.carpet.push({ x: gx * 34 + 17 + (gy % 2) * 17 + (hash(i, 1, 9) - 0.5) * 10, y: gy * 32 + 16 + (hash(i, 2, 9) - 0.5) * 10, k: hash(i, 3, 9), s: 19 + 6 * hash(i, 4, 9), r: hash(i, 5, 9) * TAU });
    }
    this.carpet.forEach((c, i) => { if (c.k < 0.17 && c.x > 0 && c.x < W && c.y > 0 && c.y < H) this.surv.push(i); });
    this.dance = new StickerWord('DANCE', 440, 440 / 12, 5);
    this.danceX = CX - this.dance.width / 2; this.danceY = 790;
    const tDance = on(0, /^dance/i);
    this.batches = dedupe(snares(tDance + 0.1, L[1]!.start - 0.12, 0.6), 0.15);
    if (!this.batches.length) this.batches = [tDance + 0.3];
    const lay = layout('DANCE', PHOS_FONT, 440);
    this.danceB = this.dance.pts.map((p) => Math.min(this.batches.length - 1, Math.floor(clamp(p.x / lay.width) * this.batches.length)));
    sh.push(S(start, this.tOk, cam(), cam(CX, CY, 1.05, 0)));
    sh.push(S(this.tOk, this.tTo, cam(CX, CY, 1.08, -0.04), cam(CX, CY, 1.15, -0.04)));
    sh.push(S(this.tTo, L[1]!.start, cam(CX, 600, 0.84, 0), cam(CX, 640, 1.06, 0.04), ease.inQuad));

    // ------------------------------------------------------------------ 2: the corridor of words
    const sizes: Record<string, number> = { GLOWING: 430, 'DARK,': 470, DARK: 470, HAND: 540, TAKE: 280, MY: 280 };
    const offs: [number, number][] = [[-360, -170], [380, 150], [0, 30], [-420, -190], [420, -160], [0, 40], [-340, -60], [360, 60], [0, 40]];
    L[1]!.words.forEach((w, i) => {
      const text = UP(w.w), big = /^(GLOWING|DARK|HAND)/.test(text);
      const tone: Tone = /^GLOW/.test(text) ? mixTone('green', 'white', 0.25) : /^(IN|THE|DARK)/.test(text) ? mixTone('green', 'cyan', 0.45) : /^(TAKE|MY)/.test(text) ? mixTone('gold', 'green', 0.35) : /^HAND/.test(text) ? 'gold' : 'green';
      this.depth.push({ w, text, z: i * 1000, ox: offs[i % offs.length]![0] * (big ? 0 : 1), oy: big ? 40 : offs[i % offs.length]![1], size: sizes[text] ?? 210, tone });
    });
    for (let i = 0; i < 260; i++) this.deep.push({ x: (hash(i, 1, 44) - 0.5) * 4200, y: (hash(i, 2, 44) - 0.5) * 2600, z: hash(i, 3, 44) * 10000 - 500, s: 9 + 12 * hash(i, 4, 44), r: hash(i, 5, 44) * TAU });
    sh.push(S(L[1]!.start, L[2]!.start, cam(), cam()));

    // ------------------------------------------------------------------ 3: the giant star
    this.broken = new StickerWord('BROKEN', 360, 360 / 13, 23);
    this.brX = CX - this.broken.width / 2; this.brY = 690;
    const tb = on(2, /^broken/i);
    this.tBreak = kicks(tb + 0.05, tb + 0.45, 0.85)[0] ?? tb + 0.15;
    this.tBecome = on(2, /^becomes/i); this.tStar = on(2, /^star/i);
    const poly: [number, number][] = [];
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? RG * 0.46 : RG; poly.push([Math.cos(a) * r, Math.sin(a) * r]); }
    const inside = (x: number, y: number) => { let c = false; for (let i = 0, j = 9; i < 10; j = i++) { const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    for (let i = 0, n = 0; n < this.broken.pts.length && i < 40000; i++) {
      const x = (hash(i, 1, 71) - 0.5) * 2 * RG, y = (hash(i, 2, 71) - 0.5) * 2 * RG;
      if (inside(x, y)) { this.giant.push({ x: CX + x, y: CY + y }); n++; }
    }
    sh.push(S(L[2]!.start, this.tBreak, cam(CX, 520, 1.12, 0), cam(CX, 525, 1.2, 0)));
    sh.push(S(this.tBreak, this.tBecome, cam(CX, 560, 0.86, -0.05), cam(CX, 560, 0.8, -0.05), ease.outCubic));
    sh.push(S(this.tBecome, this.tStar, cam(CX, 540, 0.9, 0.03), cam(CX, 540, 0.96, 0.03)));
    sh.push(S(this.tStar, L[3]!.start, cam(CX, CY, 1.02, 0), cam(CX, CY, 1.14, 0), ease.outQuad));

    // ------------------------------------------------------------------ 4: the star is the dot of the i
    this.initBeau();
    const bw = L[3]!.words.find((w) => /^beaut/i.test(w.w))!, tWe = on(3, /^we$/i);
    this.beau.steps = dedupe([...kicks(bw.start - 0.05, tWe - 0.1, 0.85), ...snares(bw.start - 0.05, tWe - 0.1, 0.95)], 0.17).slice(0, 7);
    if (!this.beau.steps.length) this.beau.steps = [bw.start];
    sh.push(S(L[3]!.start, bw.start, cam(CX, CY, 1.14, 0), cam(CX, CY, 1.2, 0)));
    sh.push({ t: bw.start, cam: (t) => this.beauCam(t) });

    // ------------------------------------------------------------------ 5
    this.glow = new StickerWord('GLOWING', 420, 420 / 12.5, 61);
    this.glX = CX - this.glow.width / 2; this.glY = 700;
    this.tGlow = on(4, /^glow/i); this.tDark = on(4, /^dark/i);
    // the drop-out: the quietest stretch after GLOWING lands; the rebuild: the hits after it
    let qt = this.tGlow + 0.6, qv = 9;
    for (let x = this.tGlow + 0.3; x < this.tDark - 1; x += 0.05) { const v = audio.env('bass', x); if (v < qv) { qv = v; qt = x; } }
    this.tOut = audio.events('kick', this.tGlow, qt).length ? Math.max(this.tGlow + 0.35, qt - 0.5) : qt - 0.5;
    this.hits = dedupe(kicks(qt + 0.1, on(4, /^in$/i) - 0.06, 0.95), 0.12);
    this.tBack = this.hits[0] ?? qt + 0.6;
    this.tLast = kicks(this.tDark + 0.1, end + 0.05, 0.9)[0] ?? end - 0.03;
    sh.push(S(L[4]!.start, this.tGlow, cam(CX, 420, 1.15, 0.02), cam(CX, 425, 1.2, 0.02)));
    sh.push(S(this.tGlow, this.tBack, cam(CX, 600, 0.92, 0), cam(CX, 600, 1.03, 0), ease.inOutQuad));
    // (every framing keeps the whole of GLOWING readable: it is being sung)
    const crops = [cam(CX, 610, 1.0, -0.05), cam(CX, 600, 0.9, 0.05), cam(CX, 620, 1.04, 0), cam(CX, 610, 0.94, -0.03)];
    this.hits.forEach((h, i) => { const a = crops[i % crops.length]!; sh.push(S(h, this.tDark, a, { ...a, z: a.z * 1.05 })); });
    const tIn = on(4, /^in$/i);
    sh.push(S(tIn, this.tDark, cam(CX, 640, 0.9, 0), cam(CX, 640, 0.95, 0)));
    sh.push(S(this.tDark, end, cam(CX, CY, 1.0, 0), cam(CX, CY, 1.1, 0), ease.inQuad));
    this.shots = sh.sort((a, b) => a.t - b.t);
  }

  /** lowercase "beautiful": find the i's dot, and scale the word so that the dot is the giant star (at the centre) */
  private initBeau() {
    const B = this.beau, size = B.size;
    const lay = layout('beautiful', PHOS_FONT, size);
    const gi = lay.glyphs.findIndex((g) => g.ch === 'i');
    const g = lay.glyphs[gi]!;
    const cw = Math.ceil(g.w + 20), ch = Math.ceil(size * 1.2);
    const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    const c = cv.getContext('2d', { willReadFrequently: true })!;
    c.font = `${size}px "${PHOS_FONT}"`; c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
    const base = Math.round(size * 1.0);
    c.fillText('i', 10, base);
    const d = c.getImageData(0, 0, cw, ch).data, col = Math.round(10 + g.w / 2);
    let top = -1, bot = -1;
    for (let y = 0; y < ch; y++) { const a = d[(y * cw + col) * 4 + 3]! > 128; if (a && top < 0) top = y; if (top >= 0 && !a) { bot = y; break; } }
    if (top < 0) { top = base - size * 0.8; bot = top + size * 0.12; }
    B.dot = { x: g.x + g.w / 2, y: (top + bot) / 2 - base, r: (bot - top) / 2 };
    B.K = (RG * 0.62) / Math.max(4, B.dot.r);
    B.w = lay.width;
    // text origin (left, baseline) in world so that the dot lands on the frame centre
    B.x0 = CX - B.K * B.dot.x; B.y0 = CY - B.K * B.dot.y;
    // the whole word framed at the end (width ~84 % of the frame)
    B.zEnd = (W * 0.84) / (B.w * B.K);
  }
  private beauCam(t: number): Cam {
    const B = this.beau, n = B.steps.length;
    let k = 0;
    for (let i = 0; i < n; i++) k += ease.outExpo(prog(t, B.steps[i]!, B.steps[i]! + 0.12));
    const u = k / n;
    const z = Math.exp(lerp(Math.log(1.2), Math.log(B.zEnd), u));
    const wx = B.x0 + (B.w * B.K) / 2, wy = B.y0 - B.size * B.K * 0.12;
    // the frame centre moves off the star only as fast as the zoom reveals the word (the star stays in shot)
    const pu = (1 / z - 1 / 1.2) / (1 / B.zEnd - 1 / 1.2);
    return { x: lerp(CX, wx, pu), y: lerp(CY, wy, pu), z: z * (1 + 0.03 * prog(t, B.steps[n - 1]!, this.L[4]!.start)), r: 0 };
  }

  // ----------------------------------------------------------------------------------------- helpers
  private wg(t: number, on: number, sus = 0.62): Glow {
    if (t < on) return { level: 0, flash: 0 };
    const dt = t - on, k = uvPulse(this.ctx.audio, t, { thr: 0.8, hl: 0.1 });
    return { level: sus + (1.15 - sus) * Math.exp(-dt / 0.3) + 0.2 * k, flash: 0.9 * Math.pow(0.5, dt / 0.05) };
  }
  private say(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, on: number, t: number, tone: Tone, o: { from?: number; sus?: number; ink?: boolean; level?: number } = {}) {
    const k = slamK(t, on, { from: o.from ?? 1.55, tau: 0.04 });
    if (!k) return;
    c.save(); c.translate(x, y - size * 0.36); c.scale(k, k);
    if (o.ink) { c.font = `${size}px "${PHOS_FONT}"`; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#000'; c.fillText(text, 0, size * 0.36); }
    else { const g = this.wg(t, on, o.sus); const l = o.level ?? 1; txt(c, text, 0, size * 0.36, size, { level: g.level * l, flash: g.flash * l }, tone); }
    c.restore();
  }
  private fit(text: string, w: number, max: number) { return Math.min(max, (100 * w) / measure(text, PHOS_FONT, 100)); }
  private lineAt(t: number) { let li = 0; this.lineT.forEach((s, i) => { if (t >= s) li = i; }); return li; }

  // ------------------------------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { audio, end } = this.ctx, st = this.st, t = f.t, c = st.L.ctx;
    st.begin(out);
    const li = this.lineAt(t);
    const k0 = shotAt(this.shots, t).cam(t);
    const punch = li === 1 ? 0 : pulses(t, this.onsets, 0.07, 0.035) + 0.025 * uvPulse(audio, t, { thr: 0.8, hl: 0.08 });
    const k: Cam = { ...k0, z: k0.z * (1 + punch) };
    const m = camXf(k);
    this.curZ = k.z;
    let idx = 0, inv = false, goldOpen = false;
    if (li !== 1 && !(li === 0 && t < this.tBe)) idx = this.drawField(t, k, li, idx);
    useXf(c, m);
    switch (li) {
      case 0: { const r = this.line1(c, t, m, idx); idx = r.idx; goldOpen = r.gold; break; }
      case 1: c.setTransform(1, 0, 0, 1, 0, 0); idx = this.line2(c, t, idx); break;
      case 2: idx = this.line3(c, t, m, idx); break;
      case 3: idx = this.line4(c, t, m, idx); break;
      case 4: { const r = this.line5(c, t, m, idx); idx = r.idx; inv = r.inv; break; }
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    st.stars.commit(inv || goldOpen ? (goldOpen ? idx : 0) : idx);
    const uv = inv || goldOpen ? 0 : uvPulse(audio, t, { thr: 0.85 }) * 0.1;
    const o = st.end(out, { gain: goldOpen ? 1.15 : 1.5, uv });
    const fx = hitFx(audio, t, { zoom: 0, shake: 4, flash: 0.05 });
    let shake = fx.shake as [number, number];
    const hard = Math.max(pulses(t, [this.tBe], 0.09), pulses(t, [this.tBreak], 0.08) * 0.9, pulses(t, this.hits, 0.07) * 0.8);
    if (hard > 0.01) { const ph = Math.round(t * 60); shake = [shake[0] + 24 * hard * Math.sin(ph * 2.1), shake[1] + 18 * hard * Math.cos(ph * 1.7)]; }
    // the last kick blows the frame to gold-white: the hard way into drop 3
    const blow = t >= this.tLast ? smoothstep(this.tLast, Math.min(end, this.tLast + 0.05), t) : 0;
    const post: PostOverrides = { ...o, zoom: 1 + 0.25 * ease.inQuad(blow), shake, flash: Math.max(fx.flash as number, 1.6 * blow), bloom: 0.55, bloomThreshold: 0.75, halation: 0.06 };
    if (inv || goldOpen) { post.bloom = 0.25; post.halation = 0.04; if (!blow) post.flash = 0; }
    return post;
  }

  // -------------------------------------------------------------------------------------------- field
  private drawField(t: number, k: Cam, li: number, idx: number): number {
    const st = this.st, start = this.ctx.start;
    const D = [0.55, 0, 0.5, 0.6, 0.65][li]!;
    const gold = li >= 2 ? 0.6 : 0.25;
    for (const s of this.field.stars) {
      if (s.k > D) continue;
      const [x, y, z] = this.field.place(s, k, -20 * (t - start), -36 * (t - start));
      if (!z) continue;
      const g = glowAt(t, this.uvList(), { tau: 1.0 });
      let level = 0.05 + 0.4 * g.level * (0.4 + 0.6 * s.d), flash = g.flash * 0.1;
      if (li === 4 && t >= this.tOut && t < this.tBack) level *= 0.3;
      st.stars.set(idx++, x, y, s.s * z * 0.85, s.r + k.r, { level, flash }, s.k < gold * D ? 'gold' : 'green', 0.4);
    }
    return idx;
  }
  private _uv: { t: number; s: number }[] | null = null;
  private uvList() {
    this._uv ??= this.ctx.audio.events('kick', this.ctx.start - 1, this.ctx.end + 0.5).filter(([, s]) => s >= 0.85).map(([t, s]) => ({ t, s: 0.5 + 0.5 * s }));
    return this._uv;
  }

  // ------------------------------------------------------------------------------------------- line 1
  private line1(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): { idx: number; gold: boolean } {
    const st = this.st, L = this.L[0]!, ws = L.words;
    if (t < this.tBe) {
      // the bridge's gold, and the words punched out of it as black stamps (one full frame each)
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = 'rgb(236,168,48)'; c.fillRect(-4, -4, W + 8, H + 8); c.restore();
      let i = -1;
      ws.forEach((w, j) => { if (j < 3 && t >= w.start) i = j; });
      if (i >= 0) {
        const text = UP(ws[i]!.w), size = this.fit(text, 1400, 640);
        this.say(c, text, CX, CY + size * 0.36, size, ws[i]!.start, t, 'gold', { ink: true, from: 1.35 });
      }
      return { idx, gold: true };
    }
    // the shatter: the gold was a carpet of stickers; it blows out from the centre
    const tt = t - this.tBe;
    const tDance = this.batches[0]! - 0.3;
    for (let i = 0; i < this.carpet.length; i++) {
      const p = this.carpet[i]!, dx = p.x - CX, dy = p.y - CY, d = Math.hypot(dx, dy) || 1;
      const v = (d * 2.4 + 500) * (0.7 + 0.6 * p.k), D = v * 0.32 * (1 - Math.exp(-tt / 0.32));
      const x = p.x + (dx / d) * D, y = p.y + (dy / d) * D;
      const survivor = p.k < 0.17;
      let level = 0.85 * Math.exp(-tt / 0.16);
      if (survivor) level = Math.max(level, 0.3);
      if (level < 0.02) continue;
      if (survivor && t >= tDance) continue; // these are flying into DANCE
      idx = starW(st.stars, idx, m, x, y, p.s * lerp(1, 0.55, clamp(tt / 0.5)), p.r + tt * (p.k - 0.5) * 6, { level, flash: 0.35 * Math.pow(0.5, tt / 0.04) }, 'gold', 0);
    }
    const ok = t >= this.tOk, to = t >= this.tTo;
    if (!ok) { const s = this.fit('BE', 1000, 640); this.say(c, 'BE', CX, CY + s * 0.36, s, this.tBe, t, GOLD_SOFT, { from: 1.9, sus: 0.8 }); }
    else if (!to) { const s = this.fit('OKAY', 1400, 560); this.say(c, 'OKAY', CX, CY + s * 0.36, s, this.tOk, t, 'gold', { from: 1.6, sus: 0.75 }); }
    else {
      this.say(c, 'TO', CX, 380, 170, this.tTo, t, 'green');
      // DANCE assembles from the survivors, one batch per snare, left to right
      const pts = this.dance.pts, ns = this.surv.length, rad = (440 / 12) * 0.62;
      const srcAt = (i: number, tq: number) => { const p = this.carpet[i]!, dx = p.x - CX, dy = p.y - CY, d = Math.hypot(dx, dy) || 1, q = tq - this.tBe; const D = (d * 2.4 + 500) * (0.7 + 0.6 * p.k) * 0.32 * (1 - Math.exp(-q / 0.32)); return [p.x + (dx / d) * D, p.y + (dy / d) * D] as const; };
      for (let j = 0; j < pts.length; j++) {
        const p = pts[j]!, b = this.danceB[j]!, tb = this.batches[b]!, tf = tb - 0.24 - 0.04 * p.b;
        const [sx, sy] = srcAt(this.surv[j % ns]!, Math.min(t, tf));
        if (t < tf) { if (j < ns) idx = starW(st.stars, idx, m, sx, sy, 12, p.a * 6, { level: 0.3, flash: 0 }, 'gold', 0); continue; }
        const u = ease.inOutCubic(prog(t, tf, tb));
        const tx = this.danceX + p.x, ty = this.danceY + p.y;
        const landed = t >= tb, age = t - tb;
        const g = landed ? glowAt(t, [{ t: tb, s: 1.15 }, ...this.uvList().filter((e) => e.t > tb)], { tau: 1.4 }) : { level: 0.7, flash: 0 };
        idx = starW(st.stars, idx, m, lerp(sx, tx, u), lerp(sy, ty, u), rad * (0.85 + 0.3 * p.a) * (landed ? 1 + 0.9 * Math.pow(0.5, age / 0.05) : lerp(0.6, 1, u)), p.a * TAU + (1 - u) * 4, { level: Math.max(0.6, g.level), flash: g.flash }, mixTone('gold', 'white', 0.2 * p.b), 0);
      }
      // the neon of each letter once its batch has landed
      const lay = layout('DANCE', PHOS_FONT, 440);
      lay.glyphs.forEach((gl, i) => {
        const b = Math.min(this.batches.length - 1, Math.floor(clamp((gl.x + gl.w / 2) / lay.width) * this.batches.length)), tb = this.batches[b]!;
        if (t < tb) return;
        const g = this.wg(t, tb, 0.4);
        txt(c, gl.ch, this.danceX + gl.x + gl.w / 2, this.danceY, 440, { level: g.level * 0.5, flash: g.flash * 0.4 }, 'gold');
      });
    }
    return { idx, gold: false };
  }

  // ------------------------------------------------------------------------------------------- line 2
  /** the camera's depth: rests on each word, rushes to the next one just before it is sung */
  private camZ(t: number): number {
    const D = this.depth;
    let z = D[0]!.z - 1000 - 300 * (1 - prog(t, this.L[1]!.start - 0.05, D[0]!.w.start, ease.outCubic));
    for (let i = 1; i < D.length; i++) {
      const tn = D[i]!.w.start, tp = D[i - 1]!.w.start;
      const ta = Math.max(tp + 0.05, tn - 0.2);
      z += (D[i]!.z - D[i - 1]!.z) * ease.inOutCubic(prog(t, ta, tn));
    }
    const tH = D[D.length - 1]!.w.start;
    return z + 60 * prog(t, tH, this.L[2]!.start);
  }
  private line2(c: CanvasRenderingContext2D, t: number, idx: number): number {
    const st = this.st, zc = this.camZ(t), D = this.depth, F = 1000;
    const tH = D[D.length - 1]!.w.start;
    // the deep field streaming past
    const hand = t >= tH ? glowAt(t, [{ t: tH, s: 1 }], { tau: 1.2 }) : null;
    for (const s of this.deep) {
      let dz = s.z - zc;
      dz = ((dz % 10000) + 10000) % 10000;
      if (dz < 60) continue;
      const sc = F / dz, x = CX + s.x * sc, y = CY + s.y * sc;
      if (x < -50 || x > W + 50 || y < -50 || y > H + 50) continue;
      const near = smoothstep(9000, 6000, dz);
      let level = (0.08 + 0.5 * smoothstep(3000, 300, dz)) * near, tone: Tone = 'green';
      if (hand && hand.level > level) { level = hand.level * near; tone = 'gold'; }
      st.stars.set(idx++, x, y, s.s * Math.min(3, sc), s.r, { level, flash: 0 }, tone, 0);
    }
    // the words, far to near (the nearer ones drawn last)
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i]!, dz = d.z - zc;
      if (t < d.w.start - 0.12 || dz < 140) continue;
      const sc = F / dz;
      const passing = 1 - smoothstep(1.2, 1.9, sc);
      if (passing <= 0.01) continue;
      const g = t >= d.w.start ? this.wg(t, d.w.start, 0.66) : { level: 0.18, flash: 0 };
      const x = CX + d.ox * sc, y = CY + d.oy * sc, size = d.size * sc;
      txt(c, d.text, x, y + size * 0.36, size, { level: g.level * passing, flash: g.flash * passing }, d.tone);
    }
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 3
  private line3(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    const st = this.st, L = this.L[2]!, ws = L.words, tb = this.tBreak, tB = this.tBecome, tS = this.tStar;
    const tPiece = ws.find((w) => /^piece/i.test(w.w))!.start, tA = ws.find((w) => /^a$/i.test(w.w))?.start ?? tS - 0.1;
    if (t < tPiece) this.say(c, 'EVERY', CX, 330, 200, ws[0]!.start, t, 'gold');
    if (t >= tPiece && t < tB) this.say(c, 'PIECE', CX, 560, 190, tPiece, t, 'green');
    if (t >= tB && t < tS) { this.say(c, 'BECOMES', CX - 60, 230, 170, tB, t, mixTone('green', 'gold', 0.4)); this.say(c, 'A', CX + 420, 230, 170, tA, t, mixTone('green', 'gold', 0.4)); }
    const pts = this.broken.pts, rad = (360 / 13) * 0.62, bw = ws.find((w) => /^broken/i.test(w.w))!.start;
    const bc = { x: CX, y: this.brY - 130 };
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j]!, hx = this.brX + p.x, hy = this.brY + p.y;
      if (t < bw - 0.02) continue;
      // the blast: decelerating flight, spin
      const tt = Math.max(0, Math.min(t, tB + 0.2) - tb);
      const dx = hx - bc.x + (p.a - 0.5) * 120, dy = hy - bc.y + (p.b - 0.5) * 120, dl = Math.hypot(dx, dy) || 1;
      const v = 1500 + 1700 * p.b, Dd = t >= tb ? v * 0.38 * (1 - Math.exp(-tt / 0.38)) : 0;
      let x = hx + (dx / dl) * Dd, y = hy + (dy / dl) * Dd * 0.8;
      let level = t < tb ? Math.max(0.6, this.wg(t, bw, 0.6).level) : 0.55 + 0.6 * Math.exp(-tt / 0.2);
      let flash = t < tb ? this.wg(t, bw).flash : Math.pow(0.5, tt / 0.05) * 0.8;
      let size = rad * (0.85 + 0.3 * p.a), rot = p.a * TAU + (t >= tb ? tt * (p.b - 0.5) * 10 : 0);
      // BECOMES: they swirl into the giant star and slam together on STAR
      if (t >= tB) {
        const gq = this.giant[j % this.giant.length]!;
        const u = ease.inOutCubic(prog(t, tB, tS));
        const a0 = Math.atan2(y - CY, x - CX), r0 = Math.hypot(x - CX, y - CY), a1 = Math.atan2(gq.y - CY, gq.x - CX), r1 = Math.hypot(gq.x - CX, gq.y - CY);
        let da = a1 - a0; da = ((da + Math.PI) % TAU + TAU) % TAU - Math.PI;
        const aa = a0 + (da + 1.2 * (1 - u)) * u, rr = lerp(r0, r1, u);
        x = CX + Math.cos(aa) * rr; y = CY + Math.sin(aa) * rr;
        if (t >= tS) {
          const g = glowAt(t, [{ t: tS, s: 1.3 }, ...this.uvList().filter((e) => e.t > tS)], { tau: 1.4 });
          level = Math.max(0.7, g.level); flash = g.flash; size *= 1 + 0.9 * Math.pow(0.5, (t - tS) / 0.05);
        } else { level = 0.6 + 0.3 * u; flash = 0; }
        rot += (1 - u) * 3;
      }
      const tone = t >= tS ? mixTone('gold', 'white', 0.15 + 0.2 * p.b) : t >= tb ? mixTone('green', 'gold', 0.5 + 0.5 * prog(t, tB, tS)) : mixTone('green', 'gold', 0.3);
      idx = starW(st.stars, idx, m, x, y, size, rot, { level, flash }, tone, 0);
    }
    if (t >= bw && t < tb) txt(c, 'BROKEN', CX, this.brY, 360, { level: this.wg(t, bw, 0.4).level * 0.45, flash: 0 }, mixTone('green', 'gold', 0.3));
    if (t >= tS) {
      // the word punched through the giant star
      const k = slamK(t, tS, { from: 1.5 });
      c.save(); c.translate(CX, CY + 20); c.scale(k, k); c.font = `200px "${PHOS_FONT}"`; c.textAlign = 'center'; c.fillStyle = '#000'; c.fillText('STAR', 0, 72); c.restore();
    }
    return idx;
  }
  /** a short white-gold flare at the centre (screen space) */
  private flare(t: number, t0: number, idx: number) {
    const q = prog(t, t0, t0 + 0.14);
    if (q < 1) this.st.stars.set(idx++, CX, CY, lerp(120, 700, ease.outExpo(q)), 0, { level: 0.9 * (1 - q) * (1 - q), flash: (1 - q) * (1 - q) * 0.8 }, mixTone('gold', 'white', 0.6), 0);
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 4
  private line4(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): number {
    const st = this.st, L = this.L[3]!, B = this.beau, ws = L.words;
    const bw = ws.find((w) => /^beaut/i.test(w.w))!.start, tWe = ws.find((w) => /^we$/i.test(w.w))!.start, tAre = ws.find((w) => /^are/i.test(w.w))!.start;
    // LOOK HOW around the star (before the pull)
    this.say(c, 'LOOK', CX, 200, 170, ws[0]!.start, t, 'gold');
    this.say(c, 'HOW', CX, 1000, 170, ws[1]!.start, t, 'gold');
    // the giant star: stickers while we are close, one solid sticker once we are far
    const solid = smoothstep(0.55, 0.3, this.curZ);
    const g = glowAt(t, [{ t: L.start - 1.3, s: 1 }, ...this.uvList().filter((e) => e.t > L.start - 1.3)], { tau: 1.6 });
    if (solid < 1) for (let j = 0; j < this.giant.length; j++) {
      const p = this.giant[j]!, pp = this.broken.pts[j]!;
      idx = starW(st.stars, idx, m, p.x, p.y, (360 / 13) * 0.62 * (0.85 + 0.3 * pp.a), pp.a * TAU, { level: Math.max(0.7, g.level) * (1 - solid), flash: g.flash * (1 - solid) }, mixTone('gold', 'white', 0.15 + 0.2 * pp.b), 0);
    }
    if (solid > 0) idx = starW(st.stars, idx, m, CX, CY, RG * 0.98, 0, { level: 1.0 * solid, flash: 0.2 * solid }, mixTone('gold', 'white', 0.2), 0);
    // "beautiful": the dot of the i is the star (the dot is clipped out of the type)
    if (t >= bw) {
      const gw = this.wg(t, bw, 0.7);
      c.save();
      c.beginPath(); c.rect(-1e5, -1e5, 2e5, 2e5); c.arc(CX, CY, B.dot.r * B.K * 1.25, 0, TAU, true); c.clip();
      c.translate(B.x0, B.y0); c.scale(B.K, B.K);
      txt(c, 'beautiful', 0, 0, B.size, gw, 'gold', { align: 'left' });
      c.restore();
    }
    // WE ARE under it, at the final scale
    const s = 200 / B.zEnd, y = B.y0 + B.size * B.K * 0.2 + s * 0.95, cxw = B.x0 + (B.w * B.K) / 2;
    const wW = measure('WE', PHOS_FONT, s), aW = measure('ARE', PHOS_FONT, s), gap = s * 0.3, x0 = cxw - (wW + aW + gap) / 2;
    this.say(c, 'WE', x0 + wW / 2, y, s, tWe, t, mixTone('green', 'gold', 0.5));
    this.say(c, 'ARE', x0 + wW + gap + aW / 2, y, s, tAre, t, mixTone('green', 'gold', 0.5));
    return idx;
  }

  // ------------------------------------------------------------------------------------------- line 5
  private line5(c: CanvasRenderingContext2D, t: number, m: Xf, idx: number): { idx: number; inv: boolean } {
    const st = this.st, L = this.L[4]!, ws = L.words, tg = this.tGlow;
    const tIn = ws.find((w) => /^in$/i.test(w.w))!.start, tThe = ws.find((w) => /^the$/i.test(w.w))!.start;
    if (t >= this.tDark) {
      // DARK! full frame, ink on gold for a beat, then gold on black
      const inv = t < this.tDark + 0.14;
      if (inv) flood(c, { level: 0.85, flash: 0.3 * Math.pow(0.5, (t - this.tDark) / 0.04) }, 'gold');
      useXf(c, m);
      const s = this.fit('DARK!', 1500, 640);
      this.say(c, 'DARK!', CX, CY + s * 0.36, s, this.tDark, t, 'gold', { ink: inv, from: 1.6, sus: 0.85 });
      if (inv) return { idx, inv: true };
      return { idx, inv: false };
    }
    if (t < tg) { this.say(c, "WE'LL", CX - 190, 420, 200, ws[0]!.start, t, 'green'); this.say(c, 'BE', CX + 250, 420, 200, ws[1]!.start, t, 'green'); return { idx, inv: false }; }
    // GLOWING: lands; dies to its green afterglow when the band drops out; every hit of the rebuild recharges it
    const ev = [{ t: tg, s: 1.3 }, ...this.hits.map((h) => ({ t: h, s: 1.3 }))];
    const g0 = glowAt(t, ev, { tau: 0.9 });
    const out = t >= this.tOut && t < this.tBack;
    const after = out ? Math.exp(-(t - this.tOut) / 0.5) : 1;
    const lvl = (x: number) => out ? lerp(0.18, x, after) : Math.max(0.55, x);
    const pts = this.glow.pts, rad = (420 / 12.5) * 0.62;
    const lastHit = this.hits.filter((h) => h <= t).pop();
    for (let j = 0; j < pts.length; j++) {
      const p = pts[j]!, x = this.glX + p.x, y = this.glY + p.y, age = t - tg;
      const pop = 1 + 0.9 * Math.pow(0.5, age / 0.05) + (lastHit !== undefined ? 0.6 * Math.pow(0.5, (t - lastHit) / 0.05) : 0);
      const tone = out ? mixTone('green', 'cyan', 0.3 * (1 - after)) : mixTone('gold', 'white', 0.15 * p.b + 0.4 * g0.flash);
      idx = starW(st.stars, idx, m, x, y, rad * (0.85 + 0.3 * p.a) * pop, p.a * TAU, { level: lvl(g0.level), flash: g0.flash }, tone, 0);
      // sparks thrown off on every hit
      if (lastHit !== undefined && j % 3 === 0) {
        const a = t - lastHit;
        if (a < 0.6) {
          const ang = TAU * hash(j, Math.round(lastHit * 10), 3), d = 520 * (1 - Math.exp(-a / 0.15)) * (0.4 + p.b);
          idx = starW(st.stars, idx, m, x + Math.cos(ang) * d, y + Math.sin(ang) * d, rad * 0.8, ang + a * 6, { level: 1.1 * Math.exp(-a / 0.18), flash: 0 }, 'gold', 0);
        }
      }
    }
    const gn = this.wg(t, tg, 0.4);
    txt(c, 'GLOWING', CX, this.glY, 420, { level: lvl(Math.max(gn.level, g0.level)) * 0.5, flash: g0.flash * 0.5 }, out ? mixTone('green', 'cyan', 0.3) : 'gold');
    if (t < this.tOut) { this.say(c, "WE'LL", CX - 190, 330, 160, ws[0]!.start, t, 'green', { level: 0.8 }); this.say(c, 'BE', CX + 230, 330, 160, ws[1]!.start, t, 'green', { level: 0.8 }); }
    this.say(c, 'IN', CX - 200, 960, 170, tIn, t, 'gold');
    this.say(c, 'THE', CX + 140, 960, 170, tThe, t, 'gold');
    void H;
    return { idx, inv: false };
  }
}
