// Light painting: text (or any polylines) drawn as long-exposure light trails, revealed progressively by a
// moving point of light — the video's recurring motif, the glow that writes. Camera-facing ribbons with a
// gaussian core and round caps, built once; per frame you set `reveal` (arc length drawn so far) and read
// the pen's position with `pointAt`. Text comes from the single-stroke fonts (engine/stroke.ts).
import * as THREE from 'three';
import { strokeText, writtenLength, type StrokeFontName, type StrokeText } from '../../engine/stroke';
import type { Line } from '../../engine/lyrics';

type P2 = { x: number; y: number };

export interface TrailOpts {
  /** Half-width of the ribbon (world units). */
  width?: number;
  color?: THREE.Color;
  /** Length (world units) behind the pen that is still white-hot. */
  tipLen?: number;
  seed?: number;
}

export class LightTrail extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  /** Polylines (local XY) and their cumulative lengths; `start[i]` = arc length where stroke i begins. */
  strokes: P2[][] = [];
  lens: number[][] = [];
  start: number[] = [];
  total = 0;
  /** For text trails: the layout, its world scale, and its offset. */
  st: StrokeText | null = null;
  textScale = 1;
  ox = 0;
  private times: [number, number][] | null = null;

  constructor(strokes: P2[][], o: TrailOpts = {}) {
    const pos: number[] = [], tan: number[] = [], side: number[] = [], along: number[] = [], cap: number[] = [], idx: number[] = [];
    const lensAll: number[][] = [], starts: number[] = [];
    let acc = 0;
    for (const s of strokes) {
      if (s.length < 2) { lensAll.push([0]); starts.push(acc); continue; }
      const L = [0];
      for (let i = 1; i < s.length; i++) L.push(L[i - 1]! + Math.hypot(s[i]!.x - s[i - 1]!.x, s[i]!.y - s[i - 1]!.y));
      lensAll.push(L);
      starts.push(acc);
      const n = s.length;
      const T = (i: number) => {
        const a = s[Math.max(0, i - 1)]!, b = s[Math.min(n - 1, i + 1)]!;
        const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1;
        return [dx / l, dy / l];
      };
      const base = pos.length / 3;
      // start cap pair, the body pairs, end cap pair
      const push = (p: P2, t: number[], a: number, c: number) => {
        for (const sd of [-1, 1]) { pos.push(p.x, p.y, 0); tan.push(t[0]!, t[1]!, 0); side.push(sd); along.push(a); cap.push(c); }
      };
      push(s[0]!, T(0), acc, -1);
      for (let i = 0; i < n; i++) push(s[i]!, T(i), acc + L[i]!, 0);
      push(s[n - 1]!, T(n - 1), acc + L[n - 1]!, 1);
      const pairs = n + 2;
      for (let k = 0; k < pairs - 1; k++) {
        const a = base + k * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
      acc += L[n - 1]!;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 3));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
    g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
    g.setAttribute('aCap', new THREE.Float32BufferAttribute(cap, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        color: { value: (o.color ?? new THREE.Color(1, 0.6, 0.9)).clone() },
        width: { value: o.width ?? 0.012 },
        reveal: { value: 0 },
        gain: { value: 1 },
        tipLen: { value: o.tipLen ?? 0.25 },
        seed: { value: o.seed ?? 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aTan; attribute float aSide, aAlong, aCap;
        uniform float width;
        varying float vSide, vAlong, vCap;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 tv = (modelViewMatrix * vec4(aTan, 0.0)).xyz;
          float tl = length(tv);
          tv = tl > 1e-6 ? tv / tl : vec3(1.0, 0.0, 0.0);
          vec3 sd = cross(tv, normalize(-mv.xyz));
          float sl = length(sd);
          sd = sl > 1e-6 ? sd / sl : vec3(0.0, 1.0, 0.0);
          mv.xyz += sd * aSide * width + tv * aCap * width;
          vSide = aSide; vAlong = aAlong; vCap = aCap;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float reveal, gain, tipLen, seed;
        varying float vSide, vAlong, vCap;
        void main() {
          if (vAlong > reveal) discard;
          float r2 = vSide * vSide + vCap * vCap;
          if (r2 > 1.0) discard;
          float core = exp(-r2 * 10.0), halo = exp(-r2 * 2.6) * 0.42;
          float d = reveal - vAlong;
          float hot = exp(-d / max(tipLen, 1e-4));
          // a hand-held light never moves at a constant speed: the trail breathes along its length
          float wob = 0.82 + 0.1 * sin(vAlong * 31.0 + seed) + 0.08 * sin(vAlong * 83.0 + seed * 1.7);
          vec3 c = color * (core * 1.5 + halo) * wob + vec3(1.0) * core * (0.25 + 1.6 * hot);
          gl_FragColor = vec4(c * gain, 1.0);
        }`,
    });
    super(g, mat);
    this.strokes = strokes;
    this.lens = lensAll;
    this.start = starts;
    this.total = acc;
    this.frustumCulled = false;
  }

  /** Text in a stroke font, `size` world units per em, centred on x (or left-aligned), baseline at y = 0. */
  static text(text: string, font: StrokeFontName, size: number, o: TrailOpts & { align?: 'left' | 'center' } = {}) {
    const st = strokeText(text, font, 100);
    const s = size / 100, ox = o.align === 'left' ? 0 : -st.width * s / 2;
    const tr = new LightTrail(st.strokes.map((pts) => pts.map((p) => ({ x: p.x * s + ox, y: -p.y * s }))), o);
    tr.st = st;
    tr.textScale = s;
    tr.ox = ox;
    return tr;
  }

  set reveal(v: number) { this.material.uniforms.reveal!.value = v; }
  get reveal() { return this.material.uniforms.reveal!.value as number; }
  set gain(v: number) { this.material.uniforms.gain!.value = v; }

  /** Local position of the pen at arc length `len` (clamped to the drawing). */
  pointAt(len: number, out = new THREE.Vector3()) {
    len = Math.max(0, Math.min(this.total, len));
    let i = this.strokes.length - 1;
    while (i > 0 && this.start[i]! > len) i--;
    const s = this.strokes[i]!, L = this.lens[i]!, r = len - this.start[i]!;
    let j = 1;
    while (j < s.length - 1 && L[j]! < r) j++;
    const a = s[j - 1] ?? s[0]!, b = s[j] ?? a;
    const u = Math.max(0, Math.min(1, (r - L[j - 1]!) / Math.max(1e-6, L[j]! - L[j - 1]!)));
    return out.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, 0);
  }

  /**
   * For text trails: how far the pen has written at song time t, each word written while it is sung
   * (from its start to the next word's start, at most `maxDur` s). The trail's text must be the line's words
   * joined by single spaces (`lineText(line)`).
   */
  writtenAt(line: Line, t: number, maxDur = 0.55) {
    if (!this.st) return 0;
    const times = (this.times ??= charTimes(this.st, line, maxDur));
    return writtenLength(this.st, times, t) * this.textScale;
  }
}

/** A lyric line's words joined by single spaces: the text to lay out for `writtenAt`. */
export const lineText = (line: Line) => line.words.map((w) => w.w).join(' ');

/** Per-char [start, end] writing times for a stroke layout of a lyric line's text (words in order). */
export function charTimes(st: StrokeText, line: Line, maxDur = 0.55): [number, number][] {
  const n = st.charRange.length;
  const out: [number, number][] = [];
  // walk the line's text: chars of word k are spread over that word's writing window
  const text = line.words.map((w) => w.w).join(' ');
  let k = 0, ci = 0;
  const chars = Array.from(text);
  for (let i = 0; i < n; i++) {
    const ch = chars[i] ?? ' ';
    if (ch === ' ') { const w = line.words[Math.max(0, k - 1)]; out.push([w?.end ?? 0, w?.end ?? 0]); ci = 0; continue; }
    if (i === 0 || chars[i - 1] === ' ') { if (i > 0) k++; ci = 0; }
    const w = line.words[k]!, next = line.words[k + 1];
    const t0 = w.start, t1 = Math.min(t0 + maxDur, next ? next.start : w.end + 0.2, Math.max(w.end, t0 + 0.15));
    const len = Array.from(w.w).length;
    out.push([t0 + ((t1 - t0) * ci) / len, t0 + ((t1 - t0) * (ci + 1)) / len]);
    ci++;
  }
  return out;
}

/**
 * Points along a text's strokes (a stroke font), `spacing` world units apart, for particles that gather into
 * words: positions in the XY plane (centred on x, baseline y = 0) and the word index of each point.
 */
export function sampleStrokeText(text: string, font: StrokeFontName, size: number, spacing: number) {
  const st = strokeText(text, font, 100);
  const s = size / 100, ox = -st.width * s / 2;
  const chars = Array.from(text);
  const wordOf: number[] = [];
  let w = 0;
  chars.forEach((ch, i) => { if (ch === ' ' && i > 0 && chars[i - 1] !== ' ') w++; wordOf.push(ch === ' ' ? -1 : w); });
  const pts: THREE.Vector2[] = [], word: number[] = [];
  st.strokes.forEach((stroke, si) => {
    const wi = Math.max(0, wordOf[st.charOf[si]!] ?? 0);
    const put = (x: number, y: number) => { pts.push(new THREE.Vector2(x * s + ox, -y * s)); word.push(wi); };
    // walk the polyline, dropping a point every `spacing` (long straight segments get their share too)
    put(stroke[0]!.x, stroke[0]!.y);
    let next = spacing / s, run = 0;
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1]!, b = stroke[i]!, seg = Math.hypot(b.x - a.x, b.y - a.y);
      while (run + seg >= next) {
        const u = (next - run) / Math.max(seg, 1e-9);
        put(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
        next += spacing / s;
      }
      run += seg;
    }
    const last = stroke[stroke.length - 1]!;
    if (run + spacing / s * 0.5 < next) put(last.x, last.y);
  });
  return { pts, word, width: st.width * s };
}
