// DROP 3 (gold, the finale): a deck of cosmic plates, cut on the kicks. Every strong kick lands on a new, still,
// painted plate (cosmos-plates.ts: black hole, spiral galaxy, pillars, pulsar, binary, ringed planet, cluster, cosmic
// web, remnant, gas ribbon, eclipse, the "eye", the star nebula), each in a framing of its own (wide / close / off
// centre, mirrored, rolled), so consecutive shots differ in scale, brightness and colour. A cut slams in (a short
// overshoot of zoom, a radial streak, an exposure flash) and the shot then drifts (push, pull, roll) until the next.
//
// Build: the chop phrases (bars 1-9) cut on the strong kicks only, with the words pinned to plates ("Glo-" lands on
// the star nebula, "dark" on the black hole / the eclipse); from bar 9 every beat cuts and the drift speeds up; in the
// last bar the kicks roll (a cut every 8th) into the final shot: a globular cluster pulling back and dimming, which the
// outro's ceiling of glow stickers crossfades in over ("stars to stars").
//
// The chop lines ("Glo-o-owing in the dark") stay on screen over the switching plates, rock steady: each syllable
// ignites on its chop onset (a slam: big -> set, white-hot -> gold) and stays; a soft darkness is cut out of the
// plate behind the letters so they read on any plate.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { FSPass, Layer2D, W, H } from '../../engine/gl';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, smoothstep, frameIdx } from '../../engine/util';
import { PlateDeck, PLATE } from './cosmos-plates';
import { loadPhosphorFont, PHOS_FONT } from '../lib/phosphor';

const AS = 16 / 9;
/** framings per plate: [x, y, zoom] in plate units (x in ±16/9, y in ±1, y up) */
const FR: Record<number, [number, number, number][]> = {
  [PLATE.BLACKHOLE]: [[0, 0, 1.05], [-0.32, 0.04, 1.75], [0.05, 0.16, 1.4]],
  [PLATE.SPIRAL]: [[0, 0, 1.0], [0.08, 0.04, 1.7], [-0.3, -0.12, 1.9]],
  [PLATE.PILLARS]: [[0, -0.05, 1.0], [-0.72, 0.36, 1.8], [0.9, 0.12, 1.6]],
  [PLATE.PULSAR]: [[0, 0, 1.0], [0, 0, 1.9], [0.35, 0.2, 1.45]],
  [PLATE.BINARY]: [[0, 0, 1.0], [0.5, 0.15, 1.9], [-0.45, 0, 1.4]],
  [PLATE.PLANET]: [[0, 0, 1.0], [-0.12, 0.12, 1.65], [0.3, -0.1, 1.25]],
  [PLATE.CLUSTER]: [[0.1, 0, 1.0], [0.1, 0.02, 2.0], [0.02, 0, 1.4]],
  [PLATE.WEB]: [[0, 0, 1.0], [0.5, 0.3, 1.7], [-0.6, -0.2, 1.5]],
  [PLATE.REMNANT]: [[0, 0, 1.0], [0.3, 0.3, 1.9], [0, 0, 1.35]],
  [PLATE.AURORA]: [[0, 0, 1.0], [-0.6, 0.0, 1.6], [0.7, 0.2, 1.5]],
  [PLATE.ECLIPSE]: [[0, 0, 1.0], [0.16, 0.16, 2.1], [0, 0, 1.45]],
  [PLATE.EYE]: [[0, 0, 1.0], [0, 0, 1.6], [0.22, 0.2, 2.0]],
  [PLATE.STARNEB]: [[0, 0, 1.0], [0, 0.32, 1.7], [0, -0.05, 1.3]],
};
/** plates whose up/down must stay (they have a horizon or rising light) */
const UPRIGHT = new Set<number>([PLATE.PILLARS, PLATE.AURORA, PLATE.PLANET]);
/** the order the deck deals in (consecutive cards differ in scale, colour and brightness) */
const DEAL = [PLATE.PULSAR, PLATE.WEB, PLATE.BINARY, PLATE.CLUSTER, PLATE.PILLARS, PLATE.EYE, PLATE.PLANET, PLATE.REMNANT, PLATE.AURORA, PLATE.SPIRAL, PLATE.ECLIPSE, PLATE.BLACKHOLE, PLATE.STARNEB];
/** gentle grades, cycled */
const GRADES: [number, number, number][] = [[1, 1, 1], [1.12, 0.98, 0.82], [0.9, 0.97, 1.12], [1.2, 1.02, 0.74], [1, 1, 1], [1.05, 0.95, 0.9]];

interface Shot { t: number; end: number; plate: number; x: number; y: number; z: number; rot: number; fx: number; fy: number; grade: [number, number, number]; drift: number; roll: number; pan: [number, number]; e: number }
interface Piece { text: string; x: number; t: number }
interface TLine { line: Line; rows: { pieces: Piece[]; y: number; size: number }[]; t0: number; t1: number }

const COMP = /* glsl */ `
uniform sampler2D P, TL, TD;
uniform vec2 C; uniform float Z, R; uniform vec2 F;
uniform float expo, blur, textK, darkK, fade, warp, wT;
uniform vec3 grade;
const float ASP = ${AS.toFixed(6)};
vec3 plateAt(vec2 s) {
  // s: screen point in plate units relative to the frame centre
  vec2 q = rot2(R) * s / Z;
  q *= F;
  vec2 pp = C + q;
  return texture(P, vec2(pp.x / (2.0 * ASP) + 0.5, pp.y * 0.5 + 0.5)).rgb;
}
void main() {
  vec2 s = (vUv - 0.5) * vec2(2.0 * ASP, 2.0);
  vec3 col = vec3(0.0);
  if (blur > 0.002) {
    float j = hash12(gl_FragCoord.xy);
    for (int i = 0; i < 10; i++) col += plateAt(s * (1.0 - blur * (float(i) + j) / 10.0));
    col /= 10.0;
  } else col = plateAt(s);
  col *= grade * expo;
  // the warp: thin gold streaks racing out from the centre (the build of the drop's last bars)
  if (warp > 0.002) {
    float rr = length(s), aa = atan(s.y, s.x);
    float N = 240.0, u = (aa / 6.2831853 + 0.5) * N, cell = floor(u), fc = fract(u) - 0.5;
    if (hash11(cell + 11.0) > 0.45) {
      float sp = 0.7 + 1.6 * hash11(cell + 3.1);
      float head = fract(hash11(cell * 1.7) + wT * sp * 0.55) * 2.6;
      float len = 0.06 + 0.45 * warp * head;
      float ad = abs(fc - (hash11(cell + 7.0) - 0.5) * 0.5) * 6.2831853 / N * rr;
      float st = smoothstep(head - len, head, rr) * step(rr, head) * exp(-ad * ad / (0.0016 * 0.0016));
      col += vec3(1.0, 0.82, 0.55) * st * warp * 1.6 * smoothstep(0.15, 0.5, rr) * (0.4 + 0.6 * hash11(cell + 5.0));
    }
  }
  // the darkness cut out behind the words: highlights compressed, then pulled down
  float m = clamp(texture(TD, vUv).r * 1.3, 0.0, 1.0) * darkK;
  col = col / (1.0 + col * 3.0 * m);
  col *= 1.0 - 0.9 * m;
  col += texture(TL, vUv).rgb * textK;
  fragColor = vec4(col * fade, 1.0);
}`;

export default class CosmosDeck extends Scene {
  deck!: PlateDeck;
  comp!: FSPass;
  TL = new Layer2D();
  TD = new Layer2D(W / 2, H / 2, 1);
  shots: Shot[] = [];
  lines: TLine[] = [];
  tEnd = 0;

  override async init() {
    const { audio: au, lyrics, start, end, renderer } = this.ctx;
    await loadPhosphorFont();
    this.deck = new PlateDeck(renderer);
    this.comp = new FSPass(COMP, {
      P: { value: null }, TL: { value: this.TL.texture }, TD: { value: this.TD.texture },
      C: { value: new THREE.Vector2() }, Z: { value: 1 }, R: { value: 0 }, F: { value: new THREE.Vector2(1, 1) },
      expo: { value: 1 }, blur: { value: 0 }, warp: { value: 0 }, wT: { value: 0 }, textK: { value: 1 }, darkK: { value: 0.8 }, fade: { value: 1 }, grade: { value: new THREE.Vector3(1, 1, 1) },
    });
    this.tEnd = end;

    // ---- the chop lines and their syllables
    const chops = lyrics.linesIn(start - 0.1, end).filter((l) => l.start >= start - 0.2);
    const onsets = (au.onsets.chop ?? au.onsets.vocal ?? []).map(([t]) => t);
    const mc = document.createElement('canvas').getContext('2d')!;
    const meas = (s: string, size: number) => { mc.font = `${size}px "${PHOS_FONT}"`; return mc.measureText(s).width; };
    chops.forEach((l, li) => {
      const [w0, ...rest] = l.words;
      if (!w0) return;
      const ons = onsets.filter((o) => o >= w0.start - 0.03 && o < w0.end - 0.02);
      const SYL = ons.length >= 5 ? ['Glo', '-o', '-o', 'w', 'ing'] : ['Glo', '-o', '-o', 'wing'];
      const pieces1: Piece[] = [];
      const s1 = 200, s2 = 118;
      let x = -meas(SYL.join(''), s1) / 2;
      SYL.forEach((txt, k) => { pieces1.push({ text: txt, x, t: ons[k] ?? lerp(w0.start, w0.end, k / SYL.length) }); x += meas(txt, s1); });
      const r2txt = rest.map((w) => w.w.replace(/[.,!]/g, ''));
      const gap = meas(' ', s2);
      const tot = r2txt.reduce((a, s) => a + meas(s, s2), 0) + gap * (r2txt.length - 1);
      let x2 = -tot / 2;
      const pieces2 = rest.map((w, k) => { const p = { text: r2txt[k]!, x: x2, t: w.start }; x2 += meas(r2txt[k]!, s2) + gap; return p; });
      const next = chops[li + 1];
      this.lines.push({ line: l, rows: [{ pieces: pieces1, y: 858, size: s1 }, { pieces: pieces2, y: 1000, size: s2 }], t0: w0.start - 0.04, t1: Math.min(l.end + 1.2, next ? next.start - 0.3 : 1e9) });
    });

    // ---- the cuts
    const strong = au.events('kick', start - 0.05, end).filter(([, s]) => s >= 0.85).map(([t]) => t);
    const beats = au.beats.filter((b) => b > start + 0.1 && b < end);
    const tBeats = au.downbeats.find((d) => d > start + 13.0) ?? start + 13.5;   // bar 9: every beat from here
    const tRoll = au.downbeats.filter((d) => d < end - 0.5).pop() ?? end - 1.6;   // the last bar: the roll
    const tLast = au.beats.filter((b) => b < end - 0.2).pop() ?? end - 0.4;       // the final shot
    const pins: { t: number; plate: number; f: number }[] = [{ t: start, plate: PLATE.SPIRAL, f: 0 }];
    for (const tl of this.lines) {
      const w = tl.line.words;
      pins.push({ t: w[0]!.start, plate: PLATE.STARNEB, f: this.lines.indexOf(tl) === 0 ? 0 : 2 });
      const dark = w[w.length - 1]!;
      pins.push({ t: dark.start, plate: this.lines.indexOf(tl) === 0 ? PLATE.BLACKHOLE : PLATE.ECLIPSE, f: 0 });
    }
    pins.push({ t: tLast, plate: PLATE.CLUSTER, f: 0 });
    let cuts: number[] = [];
    let prev = -9;
    for (const k of strong) if (k > start + 0.15 && k < tBeats - 0.1 && k - prev >= 0.3) { cuts.push(k); prev = k; }
    for (const b of beats) if (b >= tBeats - 0.1 && b < tRoll - 0.1) cuts.push(b);
    prev = -9;
    for (const k of au.events('kick', tRoll - 0.05, tLast - 0.1)) if (k[1] >= 0.8 && k[0] - prev >= 0.15) { cuts.push(k[0]); prev = k[0]; }
    cuts = cuts.filter((c) => pins.every((p) => Math.abs(p.t - c) > 0.22));
    const all = [...cuts.map((t) => ({ t, plate: -1, f: -1 })), ...pins].sort((a, b) => a.t - b.t);
    // deal
    let di = 0, n = 0;
    const used = new Map<number, number>();
    all.forEach((c, i) => {
      let plate = c.plate;
      if (plate < 0) {
        const nextPin = all.slice(i + 1).find((x) => x.plate >= 0)?.plate;
        const prevPlate = this.shots[this.shots.length - 1]?.plate;
        for (let tries = 0; tries < DEAL.length; tries++) {
          plate = DEAL[di++ % DEAL.length]!;
          if (plate !== prevPlate && plate !== nextPin && plate !== PLATE.STARNEB) break;
        }
      }
      const k = used.get(plate) ?? 0;
      used.set(plate, k + 1);
      const frs = FR[plate]!;
      const f = c.f >= 0 ? frs[c.f]! : frs[(k + Math.floor(hash(i, 5) * 2)) % frs.length]!;
      const h1 = hash(i, 11), h2 = hash(i, 12), h3 = hash(i, 13);
      const e = c.t < tBeats ? 0.5 : c.t < tRoll ? 0.75 + 0.25 * (c.t - tBeats) / Math.max(1, tRoll - tBeats) : 1;
      const rot = c.f >= 0 ? 0 : (h1 - 0.5) * 0.12 * (0.5 + e);
      this.shots.push({
        t: c.t, end: all[i + 1]?.t ?? end + 1, plate, x: f[0], y: f[1], z: f[2], rot,
        fx: c.f < 0 && h2 > 0.55 ? -1 : 1, fy: c.f < 0 && h3 > 0.7 && !UPRIGHT.has(plate) ? -1 : 1,
        grade: GRADES[n++ % GRADES.length]!, drift: (h1 > 0.4 ? 1 : -0.7) * (0.03 + 0.05 * e), roll: (h2 - 0.5) * 0.05 * e,
        pan: [(h3 - 0.5) * 0.08 * e, (hash(i, 14) - 0.5) * 0.05 * e], e,
      });
    });
    // paint every plate now (deterministic, and the first frames don't stall)
    for (const s of new Set(this.shots.map((s) => s.plate))) this.deck.get(s);
  }

  private shotAt(t: number) {
    let s = this.shots[0]!;
    for (const x of this.shots) if (x.t <= t) s = x; else break;
    return s;
  }

  private drawText(t: number) {
    const L = this.TL.ctx, D = this.TD.ctx;
    this.TL.clear('#000');
    this.TD.clear('#000');
    let any = false;
    for (const tl of this.lines) {
      if (t < tl.t0 || t > tl.t1 + 0.35) continue;
      const out = 1 - smoothstep(tl.t1, tl.t1 + 0.35, t);
      any = true;
      // darkness behind the whole line (only once it has started)
      D.save();
      D.globalAlpha = out * smoothstep(tl.t0, tl.t0 + 0.08, t);
      D.filter = 'blur(20px)';
      D.fillStyle = '#fff';
      D.font = `${tl.rows[0]!.size / 2}px "${PHOS_FONT}"`;
      // a broad soft band under both rows, then the letters themselves (thick)
      D.filter = 'blur(40px)';
      D.globalAlpha *= 0.55;
      D.beginPath(); D.ellipse(W / 4, (tl.rows[0]!.y + tl.rows[1]!.y) / 4 - 30, 520, 150, 0, 0, Math.PI * 2); D.fill();
      D.globalAlpha /= 0.55;
      D.filter = 'blur(14px)';
      D.lineWidth = 16; D.strokeStyle = '#fff'; D.lineJoin = 'round';
      for (const row of tl.rows) {
        D.font = `${row.size / 2}px "${PHOS_FONT}"`;
        for (const p of row.pieces) if (t >= p.t - 0.02) D.strokeText(p.text, (W / 2 + p.x) / 2, row.y / 2);
        for (const p of row.pieces) if (t >= p.t - 0.02) D.fillText(p.text, (W / 2 + p.x) / 2, row.y / 2);
      }
      D.filter = 'none';
      D.restore();
      for (const row of tl.rows) for (const p of row.pieces) {
        const age = t - p.t;
        if (age < -0.02) continue;
        const a = clamp(age / 0.03 + 1) * out;
        const slam = 1 + 0.22 * Math.pow(1 - clamp(age / 0.16), 3);
        const hot = Math.exp(-Math.max(age, 0) / 0.22);
        L.save();
        L.font = `${row.size}px "${PHOS_FONT}"`;
        L.textBaseline = 'alphabetic';
        // the syllable scales about its own centre (letters never move once set)
        const wdt = L.measureText(p.text).width;
        const cx = W / 2 + p.x + wdt / 2, cy = row.y - row.size * 0.33;
        L.translate(cx, cy); L.scale(slam, slam); L.translate(-cx, -cy);
        L.globalAlpha = a;
        L.shadowColor = `rgba(255,170,50,${0.9})`;
        L.shadowBlur = 28 + 30 * hot;
        const r = 255, g = Math.round(lerp(200, 250, hot)), b = Math.round(lerp(110, 230, hot));
        L.fillStyle = `rgb(${r},${g},${b})`;
        L.fillText(p.text, W / 2 + p.x, row.y);
        L.shadowBlur = 0;
        L.restore();
      }
    }
    this.TL.upload(); this.TD.upload();
    return any;
  }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    const s = this.shotAt(t);
    const age = t - s.t, dur = Math.max(0.15, s.end - s.t);
    const U = this.comp.u;
    // the framing: slam in, then drift
    const slam = Math.exp(-age / 0.075);
    const u = clamp(age / dur);
    let z = s.z * (1 + s.drift * age) * (1 + (0.05 + 0.06 * s.e) * slam);
    const rot = s.rot + s.roll * age;
    // never show past the plate's edge: zoom enough for the roll, keep the centre inside
    z = Math.max(z, Math.cos(Math.abs(rot)) + AS * Math.sin(Math.abs(rot)) + 0.002);
    const hx = AS - AS / z, hy = 1 - 1 / z;
    const cx = clamp(s.x + s.pan[0] * age, -hx, hx), cy = clamp(s.y + s.pan[1] * age, -hy, hy);
    (U.C!.value as THREE.Vector2).set(cx, cy);
    U.Z!.value = z; U.R!.value = rot;
    (U.F!.value as THREE.Vector2).set(s.fx, s.fy);
    U.P!.value = this.deck.get(s.plate);
    U.blur!.value = (0.05 + 0.07 * s.e) * Math.exp(-age / 0.05);
    const kick = f.a.kick;
    let expo = 1 + (0.45 + 0.5 * s.e) * Math.exp(-age / 0.06) + 0.08 * kick;
    // the last shot pulls back and dims into the outro
    const last = s === this.shots[this.shots.length - 1];
    if (last) expo *= 1 - 0.45 * smoothstep(s.t + 0.2, this.tEnd + 0.6, t);
    U.expo!.value = expo;
    (U.grade!.value as THREE.Vector3).set(...s.grade);
    const txt = this.drawText(t);
    U.textK!.value = txt ? 1.25 : 0;
    U.darkK!.value = txt ? 1 : 0;
    U.fade!.value = 1;
    // the warp builds through the every-beat section and peaks in the roll
    U.warp!.value = s.e <= 0.5 ? 0 : clamp((s.e - 0.6) / 0.4) * 0.75 + (s.e >= 1 ? 0.25 : 0);
    U.wT!.value = t;
    this.comp.render(this.ctx.renderer, out);
    void u;
    const fi = frameIdx(t), sh = (2 + 6 * s.e) * slam;
    return {
      bloom: 0.75, bloomThreshold: 0.75, bloomRadius: 0.75, vignette: 0.42, grain: 0.035, ca: 0.6 + 1.2 * slam, halation: 0.08,
      zoom: 1 + 0.02 * kick, shake: [(hash(fi, 1) - 0.5) * 2 * sh, (hash(fi, 2) - 0.5) * 2 * sh], flash: 0.0,
    };
  }

  override dispose() { this.deck.dispose(); this.comp.mat.dispose(); }
}
void ease;
