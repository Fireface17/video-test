// Verse 2 "We've been ghosts in a crowded room" — phosphor plate. Everything is a word that was charged and is
// decaying. 1: the sung line is a ghost that will not hold its charge (flickers, double image) while every
// sung word leaves faint afterimages all over the screen, the chatter of a crowded room. 2: "friends" and "we've"
// cling (a bright tether, they slide together and hold their charge) while the rest of the room decays. 3: a night
// sky of dust stars and a flat phosphor moon; an ink blot grows over it, putting the stars out one by one.
// 4: in the dark a spotlight snaps on at "light", and recharges every ghost it touches; it opens to the pre-chorus.
import type * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, lerp, mulberry32, noise1, prog, smoothstep } from '../../engine/util';
import { W, H } from '../../engine/gl';
import { Glow2D, PHOS, VIOLET, WHITE, CYAN, lit, placeLine, setFont, FAM, drawSticker, starPath, type Placed } from './phos-b-kit';
import { measure } from '../../engine/type';

interface Ghost { x: number; y: number; size: number; rot: number; t0: number; i0: number; tau: number; text: string; phase: number }
interface Blot { x: number; y: number; r: number; t0: number; t1: number; seed: number }

const MOON = { x: 960, y: 360, r: 168 };
const SPOT = { x: 960, y: 520 };

export default class PhosVerse extends Scene {
  g = new Glow2D();
  L: Line[] = [];
  l1: Placed[] = [];
  l2: Placed[] = [];
  l3: Placed[] = [];
  l4: Placed[] = [];
  ghosts: Ghost[] = [];
  dust: { x: number; y: number; r: number; ph: number }[] = [];
  sky: { x: number; y: number; r: number; ph: number }[] = [];
  blots: Blot[] = [];
  tSpot = 0;
  pair!: { f: Placed; w: Placed; got: Placed; that: Placed; fx: number; wx: number; gx: number };

  override init() {
    const ly = this.ctx.lyrics;
    this.L = [ly.get('ghosts in a crowded'), ly.get('Holding on to the friends'), ly.get('swallow the moon'), ly.get('light up the spot')];
    const [a, b, c, d] = this.L as [Line, Line, Line, Line];
    this.l1 = placeLine(a, [3, 4], 150, 960, 500);
    this.l2 = placeLine(b, [4, 4], 118, 960, 470);
    this.l3 = placeLine(c, [4, 3], 92, 960, 770);
    this.l4 = placeLine(d, [3, 3], 128, 960, 540);
    this.tSpot = d.words[2]!.start;

    // the chatter of the room: afterimages of the sung words and of earlier lyrics
    const rnd = mulberry32(95);
    const chat = ly.words.filter((w) => w.start < a.start - 4 && w.w.replace(/[^A-Za-z]/g, '').length >= 3);
    const sung = a.words;
    for (let i = 0; i < 96; i++) {
      const t0 = a.start + 0.12 + (a.end - a.start - 0.1) * Math.pow(rnd(), 0.85);
      const soFar = sung.filter((w) => w.start <= t0 + 0.05);
      const useSung = rnd() < 0.45 && soFar.length > 0;
      const w = useSung ? soFar[Math.floor(rnd() * soFar.length)]! : chat[Math.floor(rnd() * chat.length)]!;
      this.ghosts.push({
        x: 90 + rnd() * (W - 180), y: 90 + rnd() * (H - 180), size: 30 + Math.pow(rnd(), 1.6) * 95, rot: (rnd() - 0.5) * 0.4,
        t0, i0: 0.2 + rnd() * 0.22, tau: 1.9 + rnd() * 1.4, text: w.w.replace(/[,.]/g, ''), phase: rnd() * 100,
      });
    }
    for (let i = 0; i < 90; i++) this.dust.push({ x: rnd() * W, y: rnd() * H, r: 0.8 + rnd() * 1.6, ph: rnd() * 50 });
    for (let i = 0; i < 34; i++) {
      // keep the sky stars off the moon and the sung line
      const x = 60 + rnd() * (W - 120), y = 60 + rnd() * 560;
      if (Math.hypot(x - MOON.x, y - MOON.y) < MOON.r + 60) { i--; continue; }
      this.sky.push({ x, y, r: 3 + rnd() * 6, ph: rnd() * 40 });
    }
    const t0 = c.words[1]!.start, tm = c.words[6]!.start;
    this.blots = [
      { x: 1960, y: 330, r: 1150, t0: t0 - 0.2, t1: tm + 0.7, seed: 1 },
      { x: -60, y: 640, r: 1100, t0: t0 + 0.05, t1: tm + 0.75, seed: 2 },
      { x: 700, y: -80, r: 760, t0: t0 + 0.3, t1: tm + 0.6, seed: 3 },
      { x: 1250, y: 1100, r: 1000, t0: t0 + 0.2, t1: tm + 0.8, seed: 4 },
      { x: MOON.x, y: MOON.y, r: 330, t0: tm - 0.1, t1: tm + 0.55, seed: 5 },
    ];
    // the pair that clings in line 2
    const p = (w: string) => this.l2.find((q) => q.w === w)!;
    this.pair = { f: p('friends'), w: p('we’ve'), got: p('got'), that: p('that'), fx: 0, wx: 0, gx: 0 };
  }

  private blotR(b: Blot, t: number) { return b.r * ease.inOutCubic(prog(t, b.t0, b.t1)); }
  private blotPath(c: CanvasRenderingContext2D, b: Blot, t: number) {
    const R = this.blotR(b, t);
    c.beginPath();
    const n = 56;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 1 + 0.16 * noise1(Math.cos(a) * 2.2 + Math.sin(a) * 2.2 + b.seed * 9, b.seed) + 0.07 * noise1(a * 5.5 + b.seed * 3, b.seed + 4);
      const x = b.x + Math.cos(a) * R * k, y = b.y + Math.sin(a) * R * k;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
  }
  private covered(x: number, y: number, t: number) {
    for (const b of this.blots) if (Math.hypot(x - b.x, y - b.y) < this.blotR(b, t) * 0.9) return true;
    return false;
  }

  private word(c: CanvasRenderingContext2D, p: { w: string; x: number; y: number; size: number }, i: number, hot = 0, col = PHOS, dx = 0, dy = 0) {
    if (i < 0.004) return;
    setFont(c, p.size);
    c.fillStyle = lit(col, i, hot);
    c.fillText(p.w, p.x + dx, p.y + dy);
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const { renderer, comp } = this.ctx;
    const g = this.g, c = g.c, t = f.t;
    const [a, b, cc, d] = this.L as [Line, Line, Line, Line];
    g.begin();
    const kick = f.a.kick;

    // --- galaxy dust: the afterglow of the previous scene, going out
    const dustA = 0.55 * (1 - smoothstep(0, 2.6, f.lt)) + 0.05;
    for (const s of this.dust) {
      const tw = 0.6 + 0.4 * Math.sin(t * 2 + s.ph);
      if (this.covered(s.x, s.y, t)) continue;
      c.fillStyle = lit(WHITE, dustA * tw, 0.2);
      c.fillRect(s.x, s.y, s.r, s.r);
    }

    // --- line 3's sky: dusk wash, dust stars, the moon
    const skyA = smoothstep(cc.start - 0.5, cc.start + 0.5, t) * (1 - smoothstep(this.tSpot - 0.9, this.tSpot - 0.25, t));
    if (skyA > 0.001) {
      const gr = c.createRadialGradient(MOON.x, MOON.y, 80, MOON.x, MOON.y, 1100);
      gr.addColorStop(0, lit([40, 52, 140], 0.95 * skyA)); gr.addColorStop(1, lit([26, 34, 96], 0.5 * skyA));
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
      for (const s of this.sky) {
        if (this.covered(s.x, s.y, t)) continue;
        const tw = 0.7 + 0.3 * Math.sin(t * 1.7 + s.ph);
        starPath(c, s.x, s.y, s.r, 0.46, 0.2);
        c.fillStyle = lit(PHOS, 0.75 * skyA * tw, 0.3);
        c.fill();
      }
      // flat phosphor moon: a charged disc, craters, a terminator that the ink eats
      const cover = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].filter(([dx, dy]) => this.covered(MOON.x + dx! * MOON.r * 0.8, MOON.y + dy! * MOON.r * 0.8, t)).length / 5;
      const mi = skyA * (1 - 0.7 * cover) * (0.92 + 0.08 * Math.sin(t * 9) * cover);
      const mg = c.createRadialGradient(MOON.x - 40, MOON.y - 40, 10, MOON.x, MOON.y, MOON.r);
      mg.addColorStop(0, lit(PHOS, 0.95 * mi, 0.55)); mg.addColorStop(0.8, lit(PHOS, 0.8 * mi, 0.15)); mg.addColorStop(1, lit(PHOS, 0.55 * mi));
      c.fillStyle = mg;
      c.beginPath(); c.arc(MOON.x, MOON.y, MOON.r, 0, Math.PI * 2); c.fill();
      c.globalCompositeOperation = 'source-over';
      for (const [dx, dy, r] of [[-60, -30, 34], [50, 56, 46], [74, -62, 22], [-34, 78, 20], [-98, 38, 14]] as const) {
        c.fillStyle = `rgba(20,60,10,${0.28 * mi})`;
        c.beginPath(); c.arc(MOON.x + dx, MOON.y + dy, r, 0, Math.PI * 2); c.fill();
      }
      // the ink blots: black, with a faint blue rim where the night is wet
      for (const bl of this.blots) {
        if (t < bl.t0) continue;
        c.filter = 'blur(9px)';
        this.blotPath(c, bl, t);
        c.fillStyle = '#000'; c.fill();
        // tendrils creeping ahead of the mass
        const R = this.blotR(bl, t), gr = ease.outCubic(prog(t, bl.t0, bl.t1));
        c.strokeStyle = '#000'; c.lineCap = 'round';
        for (let k = 0; k < 9; k++) {
          const a = k * 0.7 + bl.seed * 1.3, r0 = R * (0.82 + 0.1 * noise1(k + bl.seed, 7)), L = (60 + 160 * noise1(k * 3 + bl.seed, 8) ** 2 + 90) * gr;
          const sx = bl.x + Math.cos(a) * r0, sy = bl.y + Math.sin(a) * r0, side = (k % 2 ? 1 : -1) * L * 0.4;
          c.lineWidth = 8 + 16 * noise1(k + 2, bl.seed);
          c.beginPath(); c.moveTo(sx, sy);
          c.quadraticCurveTo(sx + Math.cos(a) * L * 0.5 - Math.sin(a) * side, sy + Math.sin(a) * L * 0.5 + Math.cos(a) * side, sx + Math.cos(a) * L, sy + Math.sin(a) * L);
          c.stroke();
        }
        c.filter = 'none';
      }
      c.globalCompositeOperation = 'lighter';
    }

    // --- the chatter ghosts (afterimages)
    const spotR = this.spotRadius(t);
    const spotCharge = smoothstep(this.tSpot - 0.02, this.tSpot + 0.12, t) * Math.exp(-Math.max(0, t - (this.tSpot + 0.9)) / 4);
    const hide = smoothstep(cc.start - 0.3, cc.start + 0.4, t) * (1 - smoothstep(this.tSpot - 0.05, this.tSpot, t));
    for (const gh of this.ghosts) {
      const age = t - gh.t0;
      if (age < 0) continue;
      let I = gh.i0 * Math.exp(-age / gh.tau) * smoothstep(0, 0.1, age) * (0.78 + 0.22 * Math.sin(t * 3 + gh.phase)) * (1 - 0.9 * hide);
      I += 0.1 * kick * Math.exp(-age / gh.tau) * (1 - hide);
      const dd = Math.hypot(gh.x - SPOT.x, gh.y - SPOT.y);
      const inside = 1 - smoothstep(spotR - 40, spotR + 10, dd);
      I = Math.max(I, 0.2 * spotCharge * inside);
      if (t > d.start - 0.3 && Math.abs(gh.y - 540) < 210 && Math.abs(gh.x - 960) < 760) I *= 0.08;
      if (I < 0.006) continue;
      c.save();
      c.translate(gh.x, gh.y); c.rotate(gh.rot);
      setFont(c, gh.size);
      c.fillStyle = lit(PHOS, I, spotCharge * inside * 0.3);
      c.fillText(gh.text, -measure(gh.text, FAM(), gh.size) / 2, gh.size * 0.34);
      c.restore();
    }

    // --- line 1: the line is a ghost that will not hold its charge
    {
      const gone = 1 - smoothstep(b.start - 0.1, b.start + 1.2, t);
      for (const p of this.l1) {
        const age = t - p.word.start;
        if (age < 0 || gone < 0.004) continue;
        const flick = 0.55 + 0.45 * Math.max(0, noise1(t * 11 + p.word.gi * 3.7, 2) + 0.25);
        const I = (0.14 + 0.86 * Math.exp(-age / 0.8)) * flick * gone;
        const wob = Math.min(9, age * 5);
        const hot = 0.8 * Math.exp(-age / 0.12);
        this.word(c, p, I, hot);
        this.word(c, p, I * 0.45, 0, PHOS, -wob * 0.8, wob * 0.2);
        this.word(c, p, I * 0.3, 0, CYAN, wob, -wob * 0.15);
      }
    }

    // --- line 2: holding on
    if (t > b.start - 0.1) this.drawLine2(c, t, b, cc);

    // --- line 3 words (above the ink)
    for (const p of this.l3) {
      const age = t - p.word.start;
      if (age < 0) continue;
      const out3 = 1 - smoothstep(d.start - 0.4, d.start + 0.05, t);
      const I = (0.35 + 0.65 * Math.exp(-age / 1.4)) * out3;
      this.word(c, p, I, 0.5 * Math.exp(-age / 0.15), p.w === 'moon' ? PHOS : [200, 190, 255]);
    }

    // --- line 4: darkness, the spot snaps on
    this.drawLine4(c, t, d, spotR, spotCharge);

    // --- UV recharge on the kick, a violet breath at the edges
    if (kick > 0.02) {
      const vg = c.createRadialGradient(W / 2, H / 2, 300, W / 2, H / 2, 1200);
      vg.addColorStop(0, lit(VIOLET, 0)); vg.addColorStop(1, lit(VIOLET, 0.16 * kick));
      c.fillStyle = vg; c.fillRect(0, 0, W, H);
    }
    g.present(renderer, comp, out, { glow: 1.5 });
    return { bloom: 0.9, bloomThreshold: 0.7, bloomRadius: 0.8, vignette: 0.45, grain: 0.05, ca: 0.6, halation: 0.1 };
  }

  private spotRadius(t: number) {
    if (t < this.tSpot) return 0;
    const snap = ease.outBack(prog(t, this.tSpot, this.tSpot + 0.22));
    const open = ease.inCubic(prog(t, this.L[3]!.end, this.ctx.end + 0.2));
    return 430 * snap + 40 * prog(t, this.tSpot, this.ctx.end) + 900 * open;
  }

  private drawLine2(c: CanvasRenderingContext2D, t: number, b: Line, cc: Line) {
    const P = this.pair;
    const m = ease.inOutCubic(prog(t, 100.4, 101.35));
    const gap = measure(' ', FAM(), 118) * 0.9;
    const wf = measure(P.f.w, FAM(), 118), ww = measure(P.w.w, FAM(), 118), wg = measure(P.got.w, FAM(), 118);
    const tot = wf + ww + wg + gap * 2;
    const cx0 = 960 - tot / 2;
    const fx = lerp(P.f.x, cx0, m), wx = lerp(P.w.x, cx0 + wf + gap * 0.55, m), gx = lerp(P.got.x, cx0 + wf + ww + gap * 1.1, m);
    // after line 3 begins the pair shrinks to the bottom: still holding on, the one thing that keeps its charge
    const s3 = ease.inOutCubic(prog(t, cc.start + 0.05, cc.start + 0.9));
    const sc = lerp(1, 0.46, s3);
    const ox = 960, oy = lerp(P.f.y, 985, s3);
    const X = (x: number) => ox + (x - 960) * sc;
    const size = 118 * sc;
    const fade = 1 - 0.0 * s3;
    const rest = 1 - smoothstep(this.tSpot - 1, this.tSpot - 0.4, t) * 0.0;
    const pairI = 0.62 + 0.12 * Math.sin(t * 3.1);
    const pulse = (w: Placed) => ({ w: w.w, y: oy, size });
    // the room's other words: charge, then decay
    for (const p of this.l2) {
      if (p === P.f || p === P.w || p === P.got) continue;
      const age = t - p.word.start;
      if (age < 0) continue;
      let I = (0.1 + 0.9 * Math.exp(-age / 1.0));
      if (p === P.that) I *= 1 - m;
      I *= 1 - smoothstep(b.end - 0.6, b.end + 0.5, t) * (p === P.that ? 1 : 1);
      this.word(c, p, I, 0.7 * Math.exp(-age / 0.12));
    }
    // the clinging words
    const draw = (p: Placed, x: number, started: number, extra = 0) => {
      const age = t - started;
      if (age < 0) return;
      const I = pairI * (p === P.got ? 0.75 + 0.25 * Math.exp(-age / 0.5) : 1) + extra;
      this.word(c, { ...pulse(p), x }, Math.min(1, I), 0.6 * Math.exp(-age / 0.15) + 0.1);
    };
    draw(P.f, X(fx), P.f.word.start);
    draw(P.w, X(wx), P.w.word.start);
    draw(P.got, X(gx), P.got.word.start);
    // the tether between friends and we've: a bright arc that draws itself, pulses, and becomes a bond
    const ta = prog(t, P.w.word.start - 0.1, P.w.word.start + 0.5);
    if (ta > 0) {
      const x0 = X(fx) + wf * sc * 0.55, x1 = X(wx) + ww * sc * 0.35;
      const top = oy - size * 0.95;
      c.save();
      c.lineWidth = 3.5 * (0.7 + 0.3 * Math.sin(t * 6)); c.strokeStyle = lit(PHOS, 0.85, 0.5); c.beginPath();
      const n = 28, upto = Math.floor(n * ta);
      for (let i = 0; i <= upto; i++) {
        const u = i / n;
        const x = lerp(x0, x1, u), y = top - Math.sin(u * Math.PI) * size * 0.28 * (1 - 0.5 * m);
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
      for (const x of [x0, x1]) { c.fillStyle = lit(PHOS, 1, 0.6); c.beginPath(); c.arc(x, top, 5.5, 0, Math.PI * 2); c.fill(); }
      c.restore();
    }
    void fade; void rest;
  }

  private drawLine4(c: CanvasRenderingContext2D, t: number, d: Line, R: number, charge: number) {
    const start = d.start;
    if (t < start - 0.05) return;
    // before the light: "Then we'll" in the dark at a low charge
    const hold = 1 - smoothstep(this.ctx.end - 0.4, this.ctx.end + 0.2, t) * 0;
    if (R > 1) {
      const gr = c.createRadialGradient(SPOT.x, SPOT.y, R * 0.55, SPOT.x, SPOT.y, R);
      const wash = 0.13 + 0.07 * Math.sin(t * 2.4);
      gr.addColorStop(0, lit(PHOS, wash)); gr.addColorStop(0.85, lit(PHOS, wash * 0.9)); gr.addColorStop(1, lit(PHOS, 0.02));
      c.fillStyle = gr;
      c.beginPath(); c.arc(SPOT.x, SPOT.y, R, 0, Math.PI * 2); c.fill();
      // hard rim and a ring of recharge running outwards
      const ringAge = t - this.tSpot;
      c.lineWidth = 4; c.strokeStyle = lit(PHOS, 0.9 * (1 - 0.5 * smoothstep(0.3, 2, ringAge)), 0.5);
      c.beginPath(); c.arc(SPOT.x, SPOT.y, Math.min(R, 440 + 40 * prog(t, this.tSpot, this.ctx.end)), 0, Math.PI * 2); c.stroke();
      if (ringAge < 1.2) {
        const rr = 440 + ringAge * 1500;
        c.lineWidth = 7 * (1 - ringAge / 1.2); c.strokeStyle = lit(VIOLET, 0.8 * (1 - ringAge / 1.2), 0.3);
        c.beginPath(); c.arc(SPOT.x, SPOT.y, rr, 0, Math.PI * 2); c.stroke();
      }
      if (ringAge < 0.2) { c.fillStyle = lit(WHITE, 0.4 * (1 - ringAge / 0.2), 0.5); c.fillRect(0, 0, W, H); }
    }
    for (const p of this.l4) {
      const age = t - p.word.start;
      if (age < 0) continue;
      const lit0 = p.word.start >= this.tSpot - 0.01 ? 1 : 0.42 + 0.58 * charge;
      const I = lit0 * (0.78 + 0.22 * Math.exp(-age / 0.5)) * hold;
      this.word(c, p, Math.min(1, I), 0.6 * Math.exp(-age / 0.14) + (charge * 0.15), PHOS);
    }
    // the light's star: a sticker that wakes at the spot's centre, small and charged
    const sa = smoothstep(this.tSpot + 0.2, this.tSpot + 0.7, t) * (1 - smoothstep(this.ctx.end - 0.7, this.ctx.end - 0.2, t));
    if (sa > 0.01) drawSticker(c, SPOT.x, 880, 30 * clamp(sa + 0.001, 0, 1), 0.8 * sa);
  }
}
