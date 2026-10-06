// Final chorus, "phosphor" edition: golden. It opens on the gold the bridge ended in, which drains away and
// leaves the dark with its afterglow; then every material of the clip comes back as a memory, line by line:
// "okay to dance" the letters dance, "take my hand" two halves of a plate lock with a gold seam,
// "every broken piece" shatters and its shards turn into stars, which fly into the "beautiful" constellation,
// and on "glowing in the dark!" every word of the song lights at once and the frame flares gold into the
// gold galaxy drop. Pure function of song time (Canvas2D: paper layer = normal, light layer = additive HDR).
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { Layer2D, clearRT } from '../../engine/gl';
import { F, font, plain } from '../../engine/type';
import { strokeText } from '../../engine/stroke';
import type { Line, Word } from '../../engine/lyrics';
import { clamp, ease, lerp, mulberry32, prog, smoothstep, TAU, springStep } from '../../engine/util';
import { loadDisplayFont } from '../lib/fonts';
import { CX, CY, GOLD, PHOS, FLARE_OPACITY, rgba, mix3, starPath, radial } from './phos-fall';

interface GlyphP { p: Path2D; x: number; w: number }
interface WordRun { w: Word; g: GlyphP[]; width: number; x: number }
interface RowRun { words: WordRun[]; width: number; size: number; y: number }

const WHITE: [number, number, number] = [255, 250, 232];
const VIOLET: [number, number, number] = [150, 110, 255];

export default class PhosFinal extends Scene {
  P = new Layer2D();
  L = new Layer2D();
  lines: Line[] = [];
  rows: RowRun[][] = [];
  otf: any;
  // M3 shards / stars, M4 constellation, M5 wall
  tris: { c: [number, number]; pts: [number, number][]; dir: [number, number]; rot: number; amp: number; rest: [number, number]; r: number; ts: number }[] = [];
  cons: { x: number; y: number; r: number; ph: number }[] = [];
  consLinks: [number, number][] = [];
  wall: { w: string; x: number; y: number; gi: number }[] = [];
  wallFont = '';
  t = 0;
  bg: { x: number; y: number; r: number; ph: number; k: number; col: [number, number, number] }[] = [];

  override async init() {
    const { lyrics, start, end } = this.ctx;
    this.otf = await loadDisplayFont('tiltneon');
    this.lines = lyrics.linesIn(start - 0.05, end + 0.01).filter((l) => l.start >= start - 0.1).slice(0, 5);
    const L = this.lines;
    // rows: [first word, past-last word, size, baseline]
    const spec: [number, number, number, number, number?][][] = [
      [[0, 5, 170, 450], [5, 7, 270, 740]],
      [[0, 6, 112, 380], [6, 9, 215, 700, 80]],
      [[0, 3, 190, 440], [3, 6, 190, 690]],
      [[0, 2, 100, 250], [2, 3, 20, 0], [3, 5, 100, 880]],
      [[0, 3, 215, 480], [3, 6, 215, 740]],
    ];
    this.rows = L.map((l, li) => (spec[li] ?? []).filter((s) => s[3] > 0 || s[0] >= 0).map(([a, b, size, y, gp]) => this.run(l.words.slice(a, b), size, y, gp)));
    // shards of "Every broken piece" (line 2, row 0)
    const r0 = this.rows[2]![0]!;
    const bx0 = CX - r0.width / 2 - 20, bx1 = CX + r0.width / 2 + 20, by0 = r0.y - r0.size * 0.85, by1 = r0.y + r0.size * 0.25;
    const rr = mulberry32(11);
    const cols = Math.round((bx1 - bx0) / 175), rws = 2;
    const gx = (i: number, j: number): [number, number] => [lerp(bx0, bx1, i / cols) + (i > 0 && i < cols ? (rr() - 0.5) * 60 : 0), lerp(by0, by1, j / rws) + (j > 0 && j < rws ? (rr() - 0.5) * 36 : 0)];
    const grid: [number, number][][] = [];
    for (let j = 0; j <= rws; j++) { grid.push([]); for (let i = 0; i <= cols; i++) grid[j]!.push(gx(i, j)); }
    const tri = (a: [number, number], b: [number, number], c: [number, number]) => {
      const cc: [number, number] = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      const ang = Math.atan2(cc[1] - (r0.y - r0.size * 0.3), cc[0] - CX * 0.0 - ((r0.words[1]!.x + r0.words[1]!.width / 2) + CX - r0.width / 2));
      this.tris.push({ c: cc, pts: [a, b, c], dir: [Math.cos(ang) * 0.6 + (rr() - 0.5) * 0.8, Math.sin(ang) * 0.6 + (rr() - 0.5) * 0.8], rot: (rr() - 0.5) * 0.16, amp: 10 + rr() * 26, rest: [0, 0], r: 0, ts: rr() });
    };
    for (let j = 0; j < rws; j++) for (let i = 0; i < cols; i++) {
      const a = grid[j]![i]!, b = grid[j]![i + 1]!, c = grid[j + 1]![i + 1]!, d = grid[j + 1]![i]!;
      if ((i + j) % 2) { tri(a, b, d); tri(b, c, d); } else { tri(a, b, c); tri(a, c, d); }
    }
    // constellation "beautiful"
    const st0 = strokeText('beautiful', 'readable', 100);
    const csc = 1560 / st0.width, step = 38;
    const cx0 = CX - (st0.width * csc) / 2, cy0 = 640 + st0.capHeight * csc * 0.35;
    st0.strokes.forEach((pl, si) => {
      const Lc = st0.lens[si]!, tot = (Lc[Lc.length - 1] ?? 0) * csc;
      const n = Math.max(1, Math.round(tot / step));
      let prev = -1;
      for (let q = 0; q <= n; q++) {
        const d = (q / n) * (Lc[Lc.length - 1] ?? 0);
        let j = 1; while (j < pl.length - 1 && Lc[j]! < d) j++;
        const A = pl[j - 1]!, B = pl[j]!, u = clamp((d - Lc[j - 1]!) / Math.max(1e-6, Lc[j]! - Lc[j - 1]!));
        this.cons.push({ x: cx0 + lerp(A.x, B.x, u) * csc, y: cy0 + lerp(A.y, B.y, u) * csc, r: 0, ph: rr() * 6 });
        const cur = this.cons.length - 1;
        if (prev >= 0) this.consLinks.push([prev, cur]);
        prev = cur;
      }
    });
    this.tris.forEach((t, i) => {
      const k = this.cons[Math.floor((i * this.cons.length) / this.tris.length) % this.cons.length]!;
      t.r = 8 + rr() * 8; t.rest = [t.c[0] + (rr() - 0.5) * 260, 120 + rr() * 250]; void k;
    });
    // the wall of every word of the song
    const P = this.P.ctx;
    const all = this.ctx.lyrics.words;
    let size = 46, rowsN = 99;
    for (; size > 18 && rowsN * size * 1.34 > 1000; size -= 2) {
      this.wallFont = font(F.archivo(100, 700), size);
      P.font = this.wallFont;
      const sp = P.measureText(' ').width * 1.3;
      let x = 0, rws2 = 1;
      for (const wd of all) { const wi = P.measureText(wd.w).width; if (x + wi > 1800) { rws2++; x = 0; } x += wi + sp; }
      rowsN = rws2;
    }
    P.font = this.wallFont;
    const sp = P.measureText(' ').width * 1.3;
    let x = 0, y = 0;
    const rowsW: { w: string; x: number; y: number; gi: number }[][] = [[]];
    for (const wd of all) {
      const wi = P.measureText(wd.w).width;
      if (x + wi > 1800) { rowsW.push([]); x = 0; y++; }
      rowsW[y]!.push({ w: wd.w, x, y, gi: wd.gi }); x += wi + sp;
    }
    const lh = size * 1.34;
    rowsW.forEach((row, ri) => {
      const rowW = row.length ? row[row.length - 1]!.x + P.measureText(row[row.length - 1]!.w).width : 0;
      for (const o of row) this.wall.push({ w: o.w, x: CX - rowW / 2 + o.x, y: CY - (rowsW.length * lh) / 2 + (ri + 0.8) * lh, gi: o.gi });
    });
    for (let i = 0; i < 150; i++) this.bg.push({ x: rr() * 1920, y: rr() * 1080, r: 0.8 + rr() * 2.2, ph: rr() * 6, k: rr(), col: rr() > 0.7 ? PHOS : rr() > 0.4 ? GOLD : WHITE });
  }

  run(words: Word[], size: number, y: number, gap = 28): RowRun {
    const sc = size / 100;
    const wr: WordRun[] = [];
    let x = 0;
    for (const w of words) {
      const text = plain(w.w);
      const gl = this.otf.stringToGlyphs(text) as any[];
      const g: GlyphP[] = [];
      let gx = 0;
      gl.forEach((gg, i) => {
        const d = gg.getPath(0, 0, 100).toPathData(2);
        g.push({ p: new Path2D(d), x: gx, w: (gg.advanceWidth ?? 0) * (100 / this.otf.unitsPerEm) });
        gx += g[g.length - 1]!.w + (gl[i + 1] ? this.otf.getKerningValue(gg, gl[i + 1]) * (100 / this.otf.unitsPerEm) : 0);
      });
      wr.push({ w, g, width: gx * sc, x });
      x += gx * sc + gap * sc;
    }
    const width = x - gap * sc;
    return { words: wr, width, size, y };
  }

  /** One word of Tilt Neon in light. `heat` 1 = just struck (white-hot), decays to the held glow. */
  drawWord(c: CanvasRenderingContext2D, wr: WordRun, ox: number, oy: number, size: number, heat: number, col: [number, number, number], a: number, fn?: (gi: number) => { dx: number; dy: number; rot: number; s: number }) {
    void 0;
    const sc = size / 100;
    const hot = mix3(col, WHITE, 0.25 + 0.7 * heat);
    const sage = this.t - wr.w.start;
    const slam = sage < 0 ? 0 : 1 + 1.5 * Math.exp(-sage / 0.09) - 0 * a;
    if (sage >= 0 && sage < 0.25) a = a * clamp(sage / 0.04);
    const slamX = sage >= 0 ? 1 : 1;
    void slamX;
    wr.g.forEach((g, gi) => {
      let o = fn ? fn(gi) : { dx: 0, dy: 0, rot: 0, s: 1 };
      if (o.s <= 0.001) return;
      o = { ...o, s: o.s * (slam || 1) };
      c.save();
      c.translate(ox + wr.x + (g.x + g.w / 2) * sc + o.dx, oy + o.dy);
      c.rotate(o.rot); c.scale(sc * o.s, sc * o.s); c.translate(-g.w / 2, 0);
      c.lineJoin = 'round';
      for (const [w, k] of [[26, 0.05], [12, 0.12], [5, 0.3]] as const) { c.lineWidth = w; c.strokeStyle = rgba(col, k * a * (0.6 + heat)); c.stroke(g.p); }
      c.fillStyle = rgba(hot, a * (0.62 + 0.38 * heat)); c.fill(g.p);
      c.lineWidth = 2; c.strokeStyle = rgba(WHITE, 0.5 * a * (0.4 + heat)); c.stroke(g.p);
      c.restore();
    });
  }

  miniStar(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, col: [number, number, number], a: number) {
    c.save();
    c.globalAlpha = a;
    radial(c, x, y, r * 5, col, 0.55);
    c.beginPath(); starPath(c, x, y, r, rot); c.fillStyle = rgba(mix3(col, WHITE, 0.55), 1); c.fill();
    c.restore();
  }

  override render(f: Frame, out: import('three').WebGLRenderTarget): PostOverrides | void {
    const { renderer, comp, audio: au } = this.ctx;
    const t = f.t, lt = t - this.ctx.start;
    const P = this.P.ctx, Lc = this.L.ctx;
    this.P.clear('#1c0c03'); 
    // a faint moving speck: a canvas that is one flat colour is not re-uploaded reliably
    P.fillStyle = 'rgb(6,7,17)'; P.fillRect(Math.floor(t * 60) % 97, 0, 2, 2);
    this.L.clear('#000');
    const Ls = this.lines;
    if (Ls.length < 5) { clearRT(renderer, out); return; }
    const fs = Math.exp(-lt / 0.45), fe = smoothstep(this.ctx.end - 0.52, this.ctx.end - 0.02, t) ** 1.4;
    const flare = Math.max(fs * smoothstep(-0.02, 0.0, 1), fe);
    const G = 1 - flare;
    const kick = f.a.kick, snare = f.a.snare;
    this.t = t;
    const L4s = Ls[4]!;
    const build = smoothstep(L4s.start, L4s.words[5]!.start, t);
    const bar = Math.floor(f.bar);
    const FR: [number, number, number, number][] = [[1, 0, 0, 0], [1.05, -40, 20, 0.03], [0.95, 30, -20, -0.025], [1.07, 10, 26, -0.02], [1.02, -26, -24, 0.04]];
    const fr = FR[((bar % FR.length) + FR.length) % FR.length]!;
    const drift = 1 + 0.04 * f.barPhase + 0.02 * build;
    const camS = fr[0] * drift * (1 + (0.05 + 0.05 * build) * kick);
    const shk = (3 + 9 * build) * kick;
    const camX = fr[1] * (1 - f.barPhase * 0.5) + Math.sin(t * 43) * shk, camY = fr[2] + Math.cos(t * 39) * shk, camR = fr[3] * (1 - f.barPhase) + 0.01 * Math.sin(t * 0.9);
    const win = (i: number) => smoothstep(Ls[i]!.start - 0.4, Ls[i]!.start - 0.05, t) * (i + 1 < Ls.length ? 1 - smoothstep(Ls[i + 1]!.start - 0.35, Ls[i + 1]!.start - 0.02, t) : 1);
    const heatOf = (w: Word) => (t < w.start ? 0 : Math.exp(-(t - w.start) / 0.55));
    const goldOf = (w: Word): [number, number, number] => mix3(PHOS, GOLD, smoothstep(w.start, w.start + 0.6, t));

    for (const c of [P, Lc]) { c.save(); c.translate(CX + camX, CY + camY); c.rotate(camR); c.scale(camS, camS); c.translate(-CX, -CY); }
    // --- night sky of gold dust, a UV breath on every kick
    Lc.save();
    Lc.globalCompositeOperation = 'lighter';
    Lc.globalAlpha = G;
    for (const s of this.bg) {
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + s.k * 2) + s.ph);
      const y = (s.y - lt * (6 + s.k * 14) + 1080 * 4) % 1080;
      Lc.fillStyle = rgba(s.col, 0.25 + 0.6 * tw * s.k);
      Lc.beginPath(); Lc.arc(s.x, y, s.r * 1.8, 0, TAU); Lc.fill();
    }
    Lc.fillStyle = rgba(GOLD, 0.06 * kick); Lc.fillRect(0, 0, 1920, 1080);
    const warm = 0.5 + 0.35 * smoothstep(0, 16, lt) + 0.2 * kick;
    radial(Lc, CX, CY, 1700, [255, 150, 40], warm * 0.55);
    radial(Lc, CX, 1080, 1300, GOLD, warm * 0.5);
    radial(Lc, CX, CY, 700, [255, 220, 150], 0.12 + 0.1 * kick);
    Lc.restore();

    // --- 1: "okay to dance": letters that dance, their afterglow trailing
    {
      const a = win(0);
      if (a > 0) {
        Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * a;
        const L0 = Ls[0]!;
        this.rows[0]!.forEach((row, ri) => {
          const ox = CX - row.width / 2;
          row.words.forEach((wr, wi) => {
            const w = wr.w;
            if (t < w.start - 0.02) return;
            const gwi = (ri === 0 ? 0 : 5) + wi;
            const big = gwi >= 5 ? 1.5 : 0.8;
            const pop = ease.outBack(prog(t, w.start, w.start + 0.3));
            const mk = (tt: number) => (gi: number) => {
              const ph = au.beatAt(tt) + gi * 0.07 + gwi * 0.11;
              const hop = Math.pow(Math.abs(Math.sin(Math.PI * ph)), 1.7);
              return { dx: Math.sin(TAU * ph * 0.5) * 9 * big, dy: -hop * 52 * big, rot: Math.sin(TAU * ph * 0.5 + gi * 0.9) * 0.15 * big, s: 1 + 0.1 * hop * big };
            };
            for (let k = 3; k >= 1; k--) this.drawWord(Lc, wr, ox, row.y, row.size, 0, mix3(PHOS, GOLD, 0.25), 0.2 * (1 - k / 4), mk(t - k * 0.07));
            this.drawWord(Lc, wr, ox, row.y, row.size, heatOf(w), GOLD, 1, mk(t));
          });
        });
        void L0;
        Lc.restore();
      }
    }

    // --- 2: "glowing in the dark, take my hand": the two halves of the plate lock with a gold seam
    {
      const a = win(1);
      if (a > 0) {
        const L1 = Ls[1]!;
        const [ra, rb] = this.rows[1] as [RowRun, RowRun];
        Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * a;
        const oxa = CX - ra.width / 2;
        ra.words.forEach((wr) => {
          if (t < wr.w.start - 0.02) return;
          const glow = wr.w.w.toLowerCase().startsWith('glowing');
          const wave = glow ? 1 : 0;
          this.drawWord(Lc, wr, oxa, ra.y, ra.size, heatOf(wr.w) + wave * 0.15, glow ? PHOS : mix3(PHOS, GOLD, 0.4), 1, (gi) => ({ dx: 0, dy: glow ? Math.sin(t * 5 - gi * 0.7) * 5 : 0, rot: 0, s: 1 }));
        });
        Lc.restore();
        // plate
        const hand = L1.words[8]!, take = L1.words[6]!;
        const tHit = hand.start + 0.04;
        const g = 760 * (1 - ease.inOutCubic(prog(t, L1.start - 0.1, tHit))) + (t > tHit ? 16 * Math.exp(-(t - tHit) / 0.12) * Math.cos((t - tHit) * 38) : 0);
        const ox = CX - rb.width / 2;
        const xs = ox + rb.words[2]!.x - 40 * (rb.size / 100); // the seam, between "my" and "hand"
        const y0 = rb.y - rb.size * 0.95, y1 = rb.y + rb.size * 0.3;
        const teeth = 7, amp = 24;
        const seam = (dx: number, side: number) => {
          const p = new Path2D();
          const lx = ox - 70 + (side < 0 ? 0 : 0);
          if (side < 0) { p.moveTo(lx + dx, y0); p.lineTo(xs + dx, y0); for (let i = 0; i <= teeth; i++) p.lineTo(xs + dx + (i % 2 ? amp : -amp * 0.4), lerp(y0, y1, i / teeth)); p.lineTo(lx + dx, y1); p.closePath(); }
          else { const rx = ox + rb.width + 70; p.moveTo(rx + dx, y0); p.lineTo(xs + dx, y0); for (let i = 0; i <= teeth; i++) p.lineTo(xs + dx + (i % 2 ? amp : -amp * 0.4), lerp(y0, y1, i / teeth)); p.lineTo(rx + dx, y1); p.closePath(); }
          return p;
        };
        const gl = smoothstep(L1.start - 0.35, L1.start + 0.1, t) * a;
        Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * gl;
        
        // gold seam where they lock
        const lock = t >= tHit ? 1 : 0, hit = t < tHit ? 0 : Math.exp(-(t - tHit) / 0.5);
        if (lock) {
          const sp = new Path2D();
          sp.moveTo(xs, y0); for (let i = 0; i <= teeth; i++) sp.lineTo(xs + (i % 2 ? amp : -amp * 0.4), lerp(y0, y1, i / teeth));
          for (const [w, k] of [[26, 0.12], [11, 0.3], [4, 1]] as const) { Lc.lineWidth = w; Lc.strokeStyle = rgba(mix3(GOLD, WHITE, k > 0.9 ? 0.5 : 0), (0.45 + 0.7 * hit) * k); Lc.stroke(sp); }
          Lc.globalAlpha = G * a * hit; Lc.lineWidth = 4; Lc.strokeStyle = rgba(GOLD, 0.7);
          Lc.beginPath(); Lc.arc(xs, (y0 + y1) / 2, 40 + (1 - hit) * 700, 0, TAU); Lc.stroke();
          radial(Lc, xs, (y0 + y1) / 2, 520, GOLD, 0.7);
        }
        Lc.globalAlpha = G * a; Lc.globalCompositeOperation = 'lighter';
        rb.words.forEach((wr, wi) => {
          if (t < wr.w.start - 0.02) return;
          const dx = (wi === 2 ? 1 : -1) * g;
          this.drawWord(Lc, wr, ox + dx, rb.y, rb.size, heatOf(wr.w), GOLD, 1);
        });
        void take;
        Lc.restore();
      }
    }

    // --- 3: "every broken piece": it shatters; the shards turn into stars
    {
      const L2 = Ls[2]!;
      const a = win(2);
      const tb = L2.words[1]!.start, tbec = L2.words[3]!.start, tstar = L2.words[5]!.start;
      const [ra, rb] = this.rows[2] as [RowRun, RowRun];
      if (a > 0) {
        Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * a;
        const oxb = CX - rb.width / 2;
        rb.words.forEach((wr) => { if (t >= wr.w.start - 0.02) this.drawWord(Lc, wr, oxb, rb.y, rb.size, heatOf(wr.w), wr.w.w.toLowerCase() === 'star' ? WHITE : GOLD, 1); });
        const oxa = CX - ra.width / 2;
        const drawRowA = () => ra.words.forEach((wr) => { if (t >= wr.w.start - 0.02) this.drawWord(Lc, wr, oxa, ra.y, ra.size, heatOf(wr.w), GOLD, 1); });
        if (t < tb) drawRowA();
        else {
          const sh = ease.outCubic(prog(t, tb, tb + 0.55));
          const conv = ease.inCubic(prog(t, tbec, tbec + 0.7));
          for (const tr of this.tris) {
            Lc.save();
            const ox = tr.dir[0] * tr.amp * sh, oy = tr.dir[1] * tr.amp * sh + 18 * sh * sh;
            const sc = 1 - 0.85 * conv;
            Lc.translate(tr.c[0] + ox, tr.c[1] + oy); Lc.rotate(tr.rot * sh); Lc.scale(sc, sc); Lc.translate(-tr.c[0], -tr.c[1]);
            Lc.beginPath(); Lc.moveTo(tr.pts[0]![0], tr.pts[0]![1]); Lc.lineTo(tr.pts[1]![0], tr.pts[1]![1]); Lc.lineTo(tr.pts[2]![0], tr.pts[2]![1]); Lc.closePath();
            Lc.save(); Lc.clip();
            Lc.globalAlpha = G * a * (1 - 0.8 * conv);
            drawRowA();
            Lc.restore();
            Lc.globalAlpha = G * a * sh * (1 - conv) * 0.7; Lc.lineWidth = 2.5; Lc.strokeStyle = rgba(GOLD, 0.8); Lc.stroke();
            Lc.restore();
          }
        }
        // the sticker-star beside "star"
        const sw = rb.words[2]!;
        const sp = springStep(t - tstar, 3, 0.4);
        if (t > tstar) this.miniStar(Lc, oxb + sw.x + sw.width + 70, rb.y - rb.size * 0.3, 44 * sp, t * 0.5, WHITE, G * a);
        Lc.restore();
      }
    }
    // the stars the shards became (fly up, then into the "beautiful" constellation)
    {
      const L2 = Ls[2]!, L3 = Ls[3]!, L4 = Ls[4]!;
      const tbec = L2.words[3]!.start;
      const tFly = L3.start - 1.0, tArr = L3.words[2]!.start - 0.15;
      const out5 = 1 - smoothstep(L4.start - 0.05, L4.start + 0.25, t);
      if (t > tbec && out5 > 0) {
        Lc.save(); Lc.globalCompositeOperation = 'lighter';
        const N = this.tris.length;
        this.tris.forEach((tr, i) => {
          const born = tbec + tr.ts * 0.5;
          if (t < born) return;
          const up = ease.outCubic(prog(t, born, born + 1.5));
          let x = lerp(tr.c[0], tr.rest[0], up), y = lerp(tr.c[1], tr.rest[1], up);
          const k = this.cons[Math.floor((i * this.cons.length) / N) % this.cons.length]!;
          const fl = ease.inOutCubic(prog(t, tFly + tr.ts * 0.5, tArr));
          x = lerp(x, k.x, fl) + Math.sin(t * 1.3 + i) * 5 * (1 - fl); y = lerp(y, k.y, fl) + Math.cos(t * 1.1 + i) * 5 * (1 - fl);
          const pop = ease.outBack(prog(t, born, born + 0.35));
          const tw = 0.75 + 0.25 * Math.sin(t * 4 + i * 2);
          this.miniStar(Lc, x, y, tr.r * pop * (1 - 0.25 * fl), t * 0.4 + i, mix3(WHITE, GOLD, 0.3 + 0.7 * fl), G * out5 * tw);
        });
        Lc.restore();
      }
    }

    // --- 4: "look how beautiful we are": the constellation
    {
      const L3 = Ls[3]!;
      const a = win(3);
      if (a > 0) {
        const [r1, , r3] = this.rows[3] as [RowRun, RowRun, RowRun];
        const tb = L3.words[2]!.start;
        Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G * a;
        for (const [row, ox] of [[r1, 120], [r3, 1920 - 120 - r3.width]] as const) row.words.forEach((wr) => { if (t >= wr.w.start - 0.02) this.drawWord(Lc, wr, ox, row.y, row.size, heatOf(wr.w), mix3(GOLD, WHITE, 0.2), 1); });
        // lines draw in as the word is sung
        const lk = prog(t, tb - 0.1, tb + 0.9, ease.outCubic);
        Lc.lineWidth = 1.8;
        const hot = Math.exp(-Math.max(0, t - tb) / 0.9);
        this.consLinks.forEach(([i, j], n) => {
          const q = clamp(lk * 1.6 - (n / this.consLinks.length) * 0.6);
          if (q <= 0) return;
          const A = this.cons[i]!, B = this.cons[j]!;
          Lc.strokeStyle = rgba(mix3(GOLD, WHITE, 0.4), (0.22 + 0.35 * hot) * q);
          Lc.beginPath(); Lc.moveTo(A.x, A.y); Lc.lineTo(lerp(A.x, B.x, q), lerp(A.y, B.y, q)); Lc.stroke();
        });
        const N = this.tris.length;
        const mapped = new Set(this.tris.map((_, i) => Math.floor((i * this.cons.length) / N) % this.cons.length));
        this.cons.forEach((k, i) => {
          const born = clamp(prog(t, L3.start - 1.0, tb) * 2 - (i / this.cons.length));
          if (t < tb - 0.3 && mapped.has(i)) return; // those are the arriving stickers
          this.miniStar(Lc, k.x, k.y, (6 + 5 * (0.5 + 0.5 * Math.sin(t * 3 + k.ph)) + 5 * hot) * ease.outBack(born), t * 0.3 + k.ph, mix3(WHITE, GOLD, 0.35), (0.45 + 0.55 * hot) * born);
        });
        Lc.restore();
        // "beautiful" glows as it is sung
        radial(Lc, CX, 640, 900, GOLD, 0.16 * hot * G * a);
      }
    }

    // --- 5: "glowing in the dark!": every word of the song lights at once
    {
      const L4 = Ls[4]!;
      const tD = L4.words[5]!.start;
      const a = smoothstep(L4.start - 0.6, L4.start + 0.1, t);
      if (a > 0) {
        P.save();
        P.font = this.wallFont; P.textBaseline = 'alphabetic';
        const charge = smoothstep(L4.start + 0.3, tD - 0.1, t);
        const lit = smoothstep(tD - 0.02, tD + 0.1, t);
        const lastGi = this.ctx.lyrics.words.length;
        for (const w of this.wall) {
          const wave = clamp(charge * 1.5 - 0.5 * (w.gi / lastGi) * 0 - Math.abs(w.x - CX) / 2400);
          const al = (0.3 + 0.65 * wave) * (1 - lit) + lit;
          const col = mix3([255, 214, 120], GOLD, lit);
          P.fillStyle = rgba(col, al * a);
          P.fillText(w.w, w.x, w.y);
        }
        P.restore();
        // dark backing so the title reads over the wall
        P.save();
        const bk = P.createRadialGradient(CX, 610, 60, CX, 610, 900);
        bk.addColorStop(0, `rgba(28,12,3,${0.8 * a * (1 - 0.5 * lit)})`); bk.addColorStop(0.55, `rgba(28,12,3,${0.6 * a * (1 - 0.5 * lit)})`); bk.addColorStop(1, 'rgba(28,12,3,0)');
        P.fillStyle = bk; P.save(); P.translate(0, 610); P.scale(1, 0.46); P.translate(0, -610); P.fillRect(0, 0, 1920, 1500); P.restore();
        P.restore();
        Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G;
        if (charge > 0) {
          Lc.font = this.wallFont; Lc.textBaseline = 'alphabetic';
          for (const w of this.wall) { Lc.fillStyle = rgba(GOLD, 0.3 * charge * a * (1 - lit)); Lc.fillText(w.w, w.x, w.y); }
        }
        if (lit > 0) {
          Lc.font = this.wallFont; Lc.textBaseline = 'alphabetic';
          for (const w of this.wall) { Lc.fillStyle = rgba(GOLD, 0.42 * lit * a * (0.6 + 0.4 * Math.exp(-(t - tD) / 0.6))); Lc.fillText(w.w, w.x, w.y); }
          const rr2 = (t - tD) * 3600;
          Lc.lineWidth = 22; Lc.strokeStyle = rgba(GOLD, 0.5 * Math.exp(-(t - tD) / 0.3)); Lc.beginPath(); Lc.arc(CX, 610, rr2, 0, TAU); Lc.stroke();
          radial(Lc, CX, CY, 1500, GOLD, 0.5 * lit * (0.6 + 0.4 * Math.exp(-(t - tD) / 0.5)));
        }
        const ox0 = CX;
        this.rows[4]!.forEach((row) => {
          const ox = ox0 - row.width / 2;
          row.words.forEach((wr) => {
            if (t < wr.w.start - 0.02) return;
            const pop = ease.outBack(prog(t, wr.w.start, wr.w.start + 0.3));
            const big = wr.w === L4.words[5] ? 1 + 0.12 * Math.exp(-(t - tD) / 0.4) : 1;
            const live = wr.w === L4.words[2] ? 1 : 0;
            this.drawWord(Lc, wr, ox, row.y, row.size * big, heatOf(wr.w) + live * 0.25 * (0.5 + 0.5 * Math.sin(t * 6)), GOLD, a, (gi) => ({ dx: 0, dy: live * Math.sin(t * 5 - gi * 0.8) * 9, rot: live * Math.sin(t * 4 + gi) * 0.03, s: 1 }));
          });
        });
        Lc.restore();
      }
    }

    // gold particles burst on every beat (bigger on downbeats), strobes on snares, a build into the flare
    {
      const au = this.ctx.audio;
      Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = G;
      const b0 = Math.floor(au.beatAt(t));
      for (let k = 0; k < 3; k++) {
        const bi = b0 - k, tb = au.timeOfBeat(bi), age = t - tb;
        if (tb < this.ctx.start || age > 1.1) continue;
        const rr = mulberry32(bi * 97 + 3);
        const down = bi % 4 === 0 ? 1 : 0;
        const n = 22 + 26 * down + ((60 * build) | 0);
        const ox = CX + (rr() - 0.5) * 900, oy = CY + (rr() - 0.5) * 360;
        for (let i = 0; i < n; i++) {
          const ang = rr() * TAU, v = 250 + rr() * 1100 * (1 + 0.6 * down), sz = 2 + rr() * 6;
          const d = 1 - Math.exp(-age * 3.2);
          const x = ox + Math.cos(ang) * v * d * 0.45, y = oy + Math.sin(ang) * v * d * 0.45 + 260 * age * age;
          Lc.fillStyle = rgba(rr() > 0.5 ? GOLD : [255, 236, 170], 0.9 * Math.exp(-age / 0.5));
          Lc.beginPath(); Lc.arc(x, y, sz * (1 - age * 0.5), 0, TAU); Lc.fill();
        }
      }
      // strobe on the snare, faster and harder as it builds
      Lc.fillStyle = rgba([255, 226, 150], 1); Lc.globalAlpha = G * (0.18 + 0.25 * build) * snare; Lc.fillRect(-400, -400, 2720, 1880);
      Lc.restore();
    }
    for (const c of [P, Lc]) c.restore();
    // gold: the bridge's last frame, draining; and the flare into the drop
    if (flare > 0) { Lc.save(); Lc.globalCompositeOperation = 'lighter'; Lc.globalAlpha = 1; Lc.fillStyle = rgba(GOLD, flare); Lc.fillRect(0, 0, 1920, 1080); Lc.restore(); }

    clearRT(renderer, out, [0, 0, 0], 1);
    comp.draw(renderer, this.P.upload(), out, { mode: 'normal', opacity: 1 - flare });
    comp.draw(renderer, this.L.upload(), out, { mode: 'add', opacity: FLARE_OPACITY });
    return { bloom: 0.85 + 0.4 * build, vignette: 0.35, ca: 0.8 + 3 * snare + 2 * build * kick, grain: 0.05, zoom: 1 + 0.012 * kick, flash: 0.1 * snare + 0.12 * Math.max(0, kick - 0.7) * build };
  }
}
