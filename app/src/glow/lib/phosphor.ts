// PHOSPHOR: the shared look of the middle of "Glowing In The Dark" (pre-choruses, choruses, drop 1).
//
// Black space. Light CHARGES things; they glow green-white at the hit, then decay (exponential afterglow,
// green -> dim teal); a UV flash (violet-white) on strong kicks recharges whatever is on screen. Words
// appear when they are sung. Everything is a pure function of time (stateless scenes): the afterglow is
// analytic (a list of charge events per object), never accumulated in a buffer.
//
// ---------------------------------------------------------------------------------------------- API
// Palette / colour
//   PH                     hex + linear colours: green (#B6FF6A), gold, violet (UV), cyan, white, dim
//   Tone                   'green' | 'gold' | 'violet' | 'cyan' | [r,g,b] linear   (what hue a charge has)
//   phosphorLin(g, tone)   linear rgb (HDR, may exceed 1) for a Glow {level, flash}
//   phosphorCss(g, tone)   Canvas2D rgb() string (clamped 0..1 sRGB) for the same
// Charge model (analytic afterglow)
//   interface Charge       { t: number; s?: number }   an event at song time t of strength s (default 1)
//   glowAt(t, events, o)   -> Glow { level, flash }: level = max over events of s*exp(-(t-t_k)/tau)
//                          (o.tau 1.5 s, o.attack 0.05 s rise, o.flashHl 0.11 s white-hot flash); events sorted by t
//   wordCharges(word, extra?)   the Charge list of a lyric word: sung at word.start, + extra (UV flashes)
//   uvEvents(audio, t0, t1, o)  strong kicks in [t0,t1) as Charge[]   (o.thr 0.7)
//   uvPulse(audio, t, o)        0..1 decaying pulse of the last strong kick  -> stage.end({ uv })
// Typography (Tilt Neon, the video's display face)
//   await loadPhosphorFont()    once, in Scene.init (registers FontFace 'TiltNeon' for Canvas2D)
//   PHOS_FONT                   'TiltNeon'
//   layoutWords(words, size, o) -> { boxes:[{i,text,x,y,w}], width, height }: words of a line set in rows (greedy wrap
//                               to o.maxW), centred on x = 0, first baseline y = 0 (y down), spaced by o.gap
//   drawWord(c, text, x, y, size, glow, tone, o)  fill one word / glyph with phosphor colour (o.align, o.alpha, o.rot)
//   textPoints (re-exported)    jittered sample points inside text, for words made of stickers
// Stars / stickers
//   starPath(c, x, y, r, rot, inner)   Canvas2D 5-pointed star path (chubby sticker proportions)
//   class StarField(max)    thousands of 5-pointed stickers, instanced quads, one draw call:
//                           set(i, x, y, size, rot, glow, tone, body?)   (logical px, y down; size = outer radius)
//                           setRaw(i, x, y, size, rot, rgbLinear, body?)  commit(n)  draw(renderer, rt)
//                           `body` (0..1, default 0.35): how much of the dead sticker body shows in the dark
// Stage (the composite)
//   class PhosphorStage(ctx, maxStars)   L (Layer2D, draw text/vectors here), stars (StarField)
//       begin(out)        clear out + L
//       end(out, o)       draws stars, then L (gain o.gain), then the UV wash (o.uv 0..1) and returns PostOverrides;
//                         o.stars=false skips the star draw, o.uvColor tints the wash
//   PHOS_POST             bloom / grain defaults for the look; spread into PostOverrides
//
// Rules of the look: no hands/people/cities; the green is #B6FF6A, gold only for earned moments, a little
// violet (UV) and cyan; unsung words are invisible (or at most a 4 % ghost), sung words charge, glow, decay.
import * as THREE from 'three';
import type { SceneCtx, PostOverrides } from '../../engine/scene';
import type { AudioData } from '../../engine/audio';
import type { Word } from '../../engine/lyrics';
import { Layer2D, W, H } from '../../engine/gl';
import { FSPass } from '../../engine/gl';
import { measure, textPoints } from '../../engine/type';
import { clamp } from '../../engine/util';
import { lin } from './palette';

export { textPoints };

// ------------------------------------------------------------------------------------------ palette
export const PH = {
  green: '#B6FF6A', gold: '#FFC247', violet: '#9B5CFF', cyan: '#33E6FF', white: '#FFFFFF', pink: '#FF3FA4',
  /** the dead sticker body (daylight-pale, barely visible) */
  dead: '#0F1A12',
  lin: {
    green: lin('phosphor'), gold: lin('gold'), violet: lin('violet'), cyan: lin('cyan'), white: [1, 1, 1] as [number, number, number], pink: lin('pink'),
  },
} as const;
export type Tone = 'green' | 'gold' | 'violet' | 'cyan' | 'pink' | [number, number, number];
const toneLin = (t: Tone): [number, number, number] => (typeof t === 'string' ? PH.lin[t] : t);

export interface Glow { level: number; flash: number }
export interface Charge { t: number; s?: number }

const GLOW_TAU = 1.5;

/**
 * Afterglow at time t of an object charged at `events` (sorted by t). level: 0..1 (rises over `attack` s, then
 * decays exponentially with time constant `tau`; stronger/later charges recharge it). flash: the white-hot
 * 0..1 pulse right at each charge (decays in `flashHl`).
 */
export function glowAt(t: number, events: Charge[], o: { tau?: number; attack?: number; flashHl?: number } = {}): Glow {
  const tau = o.tau ?? GLOW_TAU, att = o.attack ?? 0.05, hl = o.flashHl ?? 0.11;
  let level = 0, flash = 0;
  // events sorted: walk backwards from the last one at or before t
  let lo = 0, hi = events.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (events[m]!.t <= t) lo = m + 1; else hi = m; }
  for (let i = lo - 1, n = 0; i >= 0 && n < 10; i--, n++) {
    const e = events[i]!, s = e.s ?? 1, dt = t - e.t;
    if (dt > tau * 7 && n > 0) break;
    const rise = att > 0 ? 1 - Math.exp(-dt / (att * 0.5)) : 1;
    level = Math.max(level, s * Math.exp(-dt / tau) * rise);
    flash = Math.max(flash, s * Math.pow(0.5, dt / hl) * rise);
  }
  return { level, flash };
}

/** The charges of a lyric word: it is sung at word.start (strength 1); `extra` are later recharges (UV flashes). */
export function wordCharges(w: Pick<Word, 'start'>, extra: Charge[] = []): Charge[] {
  return [{ t: w.start, s: 1 }, ...extra.filter((e) => e.t > w.start)];
}

/** Strong kicks in [t0, t1) as charge events (strength = kick strength scaled to 0.5..1). */
export function uvEvents(audio: AudioData, t0: number, t1: number, o: { thr?: number } = {}): Charge[] {
  const thr = o.thr ?? 0.7;
  return audio.events('kick', t0, t1).filter(([, s]) => s >= thr).map(([t, s]) => ({ t, s: clamp(0.5 + s * 0.5, 0.5, 1) }));
}

/** 0..1 UV flash: decaying pulse of the strongest recent kick above `thr`. */
export function uvPulse(audio: AudioData, t: number, o: { thr?: number; hl?: number } = {}): number {
  const thr = o.thr ?? 0.7, hl = o.hl ?? 0.13;
  let v = 0;
  for (const [kt, s] of audio.events('kick', t - hl * 6, t + 1e-4)) if (s >= thr) v = Math.max(v, s * Math.pow(0.5, (t - kt) / hl));
  return Math.min(1, v);
}

/** Linear (HDR) colour of a glow: dim afterglow teal -> phosphor -> white-hot at the charge. */
export function phosphorLin(g: Glow, tone: Tone = 'green'): [number, number, number] {
  const c = toneLin(tone);
  const L = Math.pow(clamp(g.level, 0, 1.2), 1.15);
  // the afterglow cools: low levels drift to a deeper, bluer green
  const cool = 1 - clamp(g.level * 1.3, 0, 1);
  const r = c[0] * (1 - 0.55 * cool), gg = c[1] * (1 - 0.1 * cool), b = c[2] * (1 + 0.35 * cool) + 0.05 * cool;
  const f = clamp(g.flash, 0, 1);
  return [r * L * 1.15 + f * 0.9, gg * L * 1.15 + f * 0.9, b * L * 1.15 + f * 0.8];
}
/** Canvas2D colour of a glow (sRGB, clamped; the stage's gain lifts it into HDR). */
export function phosphorCss(g: Glow, tone: Tone = 'green', alpha = 1): string {
  const [r, gg, b] = phosphorLin(g, tone);
  const e = (x: number) => Math.round(255 * Math.pow(clamp(x, 0, 1), 1 / 2.2));
  return `rgba(${e(r)},${e(gg)},${e(b)},${alpha})`;
}

// ---------------------------------------------------------------------------------------- typography
export const PHOS_FONT = 'TiltNeon';
let fontP: Promise<void> | null = null;
/** Registers Tilt Neon for Canvas2D (await in Scene.init). */
export function loadPhosphorFont(): Promise<void> {
  fontP ??= fetch('fonts/glow/TiltNeon.woff').then((r) => r.arrayBuffer()).then(async (b) => {
    const ff = new FontFace(PHOS_FONT, b);
    await ff.load();
    document.fonts.add(ff);
  });
  return fontP;
}

export interface WordBox { i: number; text: string; x: number; y: number; w: number }
/**
 * Words of a line set in rows: greedy wrap to `maxW` px (default 1500), rows `lead` x size apart, each row centred
 * on x = 0; first baseline at y = 0, y down. `x` is the word's left edge.
 */
export function layoutWords(words: string[], size: number, o: { maxW?: number; lead?: number; gap?: number; tracking?: number; align?: 'center' | 'left' } = {}) {
  const maxW = o.maxW ?? 1500, lead = o.lead ?? 1.12, gap = (o.gap ?? 0.26) * size, tr = o.tracking ?? 0;
  const ws = words.map((t) => measure(t, PHOS_FONT, size, tr));
  const rows: number[][] = [[]];
  let rw = 0;
  words.forEach((_, i) => {
    const add = (rows[rows.length - 1]!.length ? gap : 0) + ws[i]!;
    if (rw + add > maxW && rows[rows.length - 1]!.length) { rows.push([]); rw = 0; }
    rows[rows.length - 1]!.push(i);
    rw += (rows[rows.length - 1]!.length > 1 ? gap : 0) + ws[i]!;
  });
  const boxes: WordBox[] = [];
  let width = 0;
  rows.forEach((r, ri) => {
    const tw = r.reduce((s, i) => s + ws[i]!, 0) + gap * (r.length - 1);
    width = Math.max(width, tw);
    let x = o.align === 'left' ? 0 : -tw / 2;
    for (const i of r) { boxes.push({ i, text: words[i]!, x, y: ri * size * lead, w: ws[i]! }); x += ws[i]! + gap; }
  });
  return { boxes, width, height: (rows.length - 1) * size * lead + size * 0.8 };
}

/** Fill one word (or glyph) with its phosphor colour. (x, y) = left edge / baseline unless o.align = 'center'. */
export function drawWord(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, g: Glow, tone: Tone = 'green',
  o: { align?: 'left' | 'center'; alpha?: number; rot?: number; scale?: number } = {}) {
  if (g.level < 0.004 && g.flash < 0.004) return;
  c.save();
  c.font = `${size}px "${PHOS_FONT}"`;
  c.textBaseline = 'alphabetic';
  c.textAlign = o.align === 'center' ? 'center' : 'left';
  c.translate(x, y);
  if (o.rot) c.rotate(o.rot);
  if (o.scale && o.scale !== 1) c.scale(o.scale, o.scale);
  c.fillStyle = phosphorCss(g, tone, o.alpha ?? 1);
  c.fillText(text, 0, 0);
  c.restore();
}

// ---------------------------------------------------------------------------------------------- stars
/** Canvas2D path of a chubby 5-pointed sticker star (outer radius r, point up at rot = 0). */
export function starPath(c: CanvasRenderingContext2D | Path2D, x: number, y: number, r: number, rot = 0, inner = 0.46) {
  for (let k = 0; k < 10; k++) {
    const a = rot - Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * inner : r;
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (k === 0) c.moveTo(px, py); else c.lineTo(px, py);
  }
  c.closePath();
}

/** Thousands of star stickers in one instanced draw (logical px, y down). */
export class StarField {
  mesh: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.Camera();
  private aP: THREE.InstancedBufferAttribute; // x, y, size, rot
  private aC: THREE.InstancedBufferAttribute; // emissive rgb, body
  private geo: THREE.InstancedBufferGeometry;
  constructor(public max: number) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.aP = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aC = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aP', this.aP);
    g.setAttribute('aC', this.aC);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { res: { value: new THREE.Vector2(W, H) } },
      vertexShader: /* glsl */ `
        attribute vec4 aP; attribute vec4 aC; uniform vec2 res;
        varying vec2 vQ; varying vec4 vC;
        void main() {
          vQ = position.xy * 1.9;                       // quad covers the star plus a halo
          float s = aP.z, a = aP.w; float ca = cos(a), sa = sin(a);
          vec2 q = vec2(position.x * ca - position.y * sa, position.x * sa + position.y * ca) * s * 1.9;
          vec2 px = aP.xy + q;
          gl_Position = vec4(px.x / res.x * 2.0 - 1.0, 1.0 - px.y / res.y * 2.0, 0.0, 1.0);
          vC = aC;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ; varying vec4 vC;
        float sdStar5(vec2 p, float r, float rf) {
          const vec2 k1 = vec2(0.809016994375, -0.587785252292);
          const vec2 k2 = vec2(-k1.x, k1.y);
          p.x = abs(p.x);
          p -= 2.0 * max(dot(k1, p), 0.0) * k1;
          p -= 2.0 * max(dot(k2, p), 0.0) * k2;
          p.x = abs(p.x);
          p.y -= r;
          vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
          float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
          return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
        }
        void main() {
          vec2 p = vec2(vQ.x, -vQ.y);                   // y up for the sdf, point up
          float d = sdStar5(p, 0.9, 0.52) - 0.09;       // rounded points: a sticker, not a spike
          float body = 1.0 - smoothstep(-0.015, 0.02, d);
          // sticker: a faint bevel (lighter toward the rim), centre slightly raised
          float rim = smoothstep(-0.3, 0.0, d);
          float halo = exp(-max(d, 0.0) * 5.5) * 0.35 * (1.0 - body);
          vec3 emit = vC.rgb * (body * (0.78 + 0.35 * rim) + halo);
          vec3 dead = vec3(0.025, 0.045, 0.03) * vC.a * body * (0.7 + 0.5 * rim);
          gl_FragColor = vec4(emit + dead, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  /** Sticker i from a Glow. `size` = outer radius (px). */
  set(i: number, x: number, y: number, size: number, rot: number, g: Glow, tone: Tone = 'green', body = 0.35) {
    const c = phosphorLin(g, tone);
    this.setRaw(i, x, y, size, rot, c, body);
  }
  setRaw(i: number, x: number, y: number, size: number, rot: number, rgb: [number, number, number], body = 0.35) {
    const p = this.aP.array as Float32Array, c = this.aC.array as Float32Array;
    p[i * 4] = x; p[i * 4 + 1] = y; p[i * 4 + 2] = size; p[i * 4 + 3] = rot;
    c[i * 4] = rgb[0]; c[i * 4 + 1] = rgb[1]; c[i * 4 + 2] = rgb[2]; c[i * 4 + 3] = body;
  }
  commit(n: number) {
    this.geo.instanceCount = Math.min(n, this.max);
    this.aP.needsUpdate = this.aC.needsUpdate = true;
  }
  /** Adds the stickers to `rt` (no clear). */
  draw(renderer: THREE.WebGLRenderer, rt: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(rt);
    renderer.render(this.scene, this.cam);
  }
  dispose() { this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}

// ------------------------------------------------------------------------------------------- stage
/** Bloom / grain defaults of the look. */
export const PHOS_POST: PostOverrides = { bloom: 0.8, bloomThreshold: 0.55, bloomKnee: 0.5, bloomRadius: 0.8, halation: 0.12, ca: 0.8, grain: 0.05, vignette: 0.5 };

const WASH = /* glsl */ `
  uniform float k; uniform vec3 col;
  void main() {
    vec2 p = vUv - 0.5; p.x *= 1.78;
    float v = 0.35 + 0.65 * exp(-dot(p, p) * 1.6);
    fragColor = vec4(col * k * v, 1.0);
  }`;

export class PhosphorStage {
  L = new Layer2D();
  stars: StarField;
  private wash = new FSPass(WASH, { k: { value: 0 }, col: { value: new THREE.Vector3(0.34, 0.18, 0.9) } }, { blending: THREE.AdditiveBlending, transparent: true });
  constructor(private ctx: SceneCtx, maxStars = 4000) {
    this.stars = new StarField(maxStars);
  }
  begin(out: THREE.WebGLRenderTarget) {
    const r = this.ctx.renderer;
    r.setRenderTarget(out);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    this.L.clear();
  }
  end(out: THREE.WebGLRenderTarget, o: { gain?: number; uv?: number; uvColor?: [number, number, number]; stars?: boolean } = {}): PostOverrides {
    const r = this.ctx.renderer;
    if (o.stars !== false) this.stars.draw(r, out);
    const g = o.gain ?? 1.5;
    this.ctx.comp.draw(r, this.L.upload(), out, { mode: 'add', tint: [g, g, g] });
    const uv = o.uv ?? 0;
    if (uv > 0.002) {
      this.wash.u.k!.value = uv * 0.5;
      (this.wash.u.col!.value as THREE.Vector3).set(...(o.uvColor ?? [0.34, 0.2, 0.95]));
      this.wash.render(r, out);
    }
    return { ...PHOS_POST, flash: uv * 0.12 };
  }
  dispose() { this.stars.dispose(); }
}
