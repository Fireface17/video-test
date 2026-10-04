// Light painting for the `snap` scene: a sung line laid out in a single-stroke script and written by a
// moving pen in time with its words (PenLine), and glowing 3D trail segments with a white-hot core and a
// soft coloured halo (TrailBatch), drawn inside the stage's own render pass so solid things occlude them.
import * as THREE from 'three';
import { strokeText, type StrokeFontName } from '../../engine/stroke';
import type { Line } from '../../engine/lyrics';
import { W, H } from '../../engine/gl';
import { clamp, ease } from '../../engine/util';

type P2 = { x: number; y: number };

/** Centripetal Catmull-Rom resampling of a polyline (end points kept), steps of at most `step`. */
function smoothStroke(pts: P2[], step: number): P2[] {
  const p: P2[] = [];
  for (const q of pts) if (!p.length || Math.hypot(q.x - p[p.length - 1]!.x, q.y - p[p.length - 1]!.y) > step * 0.05) p.push(q);
  if (p.length < 2) return p.length ? [p[0]!, { x: p[0]!.x + step * 0.3, y: p[0]!.y }] : [];
  const n = p.length;
  const at = (i: number): P2 => {
    if (i < 0) return { x: 2 * p[0]!.x - p[1]!.x, y: 2 * p[0]!.y - p[1]!.y };
    if (i >= n) return { x: 2 * p[n - 1]!.x - p[n - 2]!.x, y: 2 * p[n - 1]!.y - p[n - 2]!.y };
    return p[i]!;
  };
  const out: P2[] = [p[0]!];
  for (let i = 0; i < n - 1; i++) {
    const P0 = at(i - 1), P1 = at(i), P2_ = at(i + 1), P3 = at(i + 2);
    const d = (a: P2, b: P2) => Math.max(1e-9, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
    const t0 = 0, t1 = t0 + d(P0, P1), t2 = t1 + d(P1, P2_), t3 = t2 + d(P2_, P3);
    const len = Math.hypot(P2_.x - P1.x, P2_.y - P1.y);
    const m = Math.max(1, Math.ceil(len / step));
    for (let j = 1; j <= m; j++) {
      const t = t1 + ((t2 - t1) * j) / m;
      const L = (a: P2, b: P2, ta: number, tb: number): P2 => {
        const u = (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      };
      const A1 = L(P0, P1, t0, t1), A2 = L(P1, P2_, t1, t2), A3 = L(P2_, P3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(j === m ? { ...P2_ } : L(B1, B2, t1, t2));
    }
  }
  return out;
}

/** A pen move: from (ax, ay) at t0 to (bx, by) at t1; `draw` leaves a trail; `word` (-1 for air moves). */
interface PenSeg { ax: number; ay: number; bx: number; by: number; t0: number; t1: number; draw: boolean; word: number; ease?: (u: number) => number }

export interface PenOpts {
  font?: StrokeFontName;
  /** World units per em. */
  size: number;
  /** Word indices per row (top to bottom). */
  rows: number[][];
  /** Baseline-to-baseline distance in em (default 0.92). */
  leading?: number;
  /** Horizontal stagger of the rows in em (row r shifted by (r - (n-1)/2) * stagger). */
  stagger?: number;
  /** The last word must be written by this time (e.g. the scene's end). */
  endBy?: number;
  /** Where the pen comes from (local units) and how long before the first word it starts moving. */
  from?: P2;
  approach?: number;
  /** Longest a word may take to write, as a + b * chars (s); the pen then waits / moves on early. */
  maxDur?: [number, number];
}

/**
 * One sung line written in the air. Local coordinates: metres in the text plane, x right, y up, the
 * block's ink box centred on the origin. `head(t)` is the pen position; `emit()` pushes the trail written
 * so far (with each piece's age) through a callback.
 */
export class PenLine {
  segs: PenSeg[] = [];
  /** Drawn pieces only, in writing order. */
  drawn: PenSeg[] = [];
  /** Ink box (local). */
  box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  /** Writing window of each word [start, end] (s). */
  wordWin: [number, number][] = [];
  tStart = 0;
  tEnd = 0;
  /** World units per em. */
  size: number;

  constructor(public line: Line, o: PenOpts) {
    this.size = o.size;
    const font = o.font ?? 'script', s = o.size / 100, lead = (o.leading ?? 0.92) * o.size;
    const nr = o.rows.length;
    // strokes per word, in local units
    const wordStrokes: P2[][][] = line.words.map(() => []);
    o.rows.forEach((ids, r) => {
      const text = ids.map((i) => line.words[i]!.w).join(' ');
      const st = strokeText(text, font, 100);
      const chars = Array.from(text);
      const wordOf: number[] = [];
      let k = 0;
      chars.forEach((ch, ci) => { if (ch === ' ' && ci > 0 && chars[ci - 1] !== ' ') k++; wordOf.push(ch === ' ' ? -1 : ids[k]!); });
      const ox = -st.width / 2 + (r - (nr - 1) / 2) * (o.stagger ?? 0) * 100;
      const by = ((nr - 1) / 2 - r) * lead;
      st.strokes.forEach((stroke, si) => {
        const wi = wordOf[st.charOf[si]!]!;
        if (wi < 0) return;
        const pts = stroke.map((p) => ({ x: (p.x + ox) * s, y: -p.y * s + by }));
        const sm = smoothStroke(pts, o.size * 0.012);
        for (const q of sm) {
          this.box.x0 = Math.min(this.box.x0, q.x); this.box.x1 = Math.max(this.box.x1, q.x);
          this.box.y0 = Math.min(this.box.y0, q.y); this.box.y1 = Math.max(this.box.y1, q.y);
        }
        if (sm.length) wordStrokes[wi]!.push(sm);
      });
    });
    // centre the ink box on the origin
    const cx = (this.box.x0 + this.box.x1) / 2, cy = (this.box.y0 + this.box.y1) / 2;
    for (const ws of wordStrokes) for (const st of ws) for (const q of st) { q.x -= cx; q.y -= cy; }
    this.box = { x0: this.box.x0 - cx, x1: this.box.x1 - cx, y0: this.box.y0 - cy, y1: this.box.y1 - cy };

    // timing: word k is written over [ws, we] (its sung start, never before), the pen flies between words
    const words = line.words;
    const AIR = o.size * 9; // air speed (units/s)
    const [ma, mb] = o.maxDur ?? [0.3, 0.11];
    const first = (k: number) => wordStrokes[k]![0]?.[0] ?? { x: 0, y: 0 };
    const last = (k: number) => { const w = wordStrokes[k]!; const st = w[w.length - 1]; return st ? st[st.length - 1]! : first(k); };
    const n = words.length;
    const ws: number[] = [], we: number[] = [];
    for (let k = 0; k < n; k++) {
      const start = Math.max(words[k]!.start, k > 0 ? we[k - 1]! + 0.03 : -Infinity);
      const nextStart = k + 1 < n ? words[k + 1]!.start : (o.endBy ?? Infinity);
      const fly = k + 1 < n ? clamp(Math.hypot(first(k + 1).x - last(k).x, first(k + 1).y - last(k).y) / AIR, 0.05, 0.16) : 0;
      const chars = Array.from(words[k]!.w).length;
      let end = Math.min(words[k]!.end, nextStart - fly, start + ma + mb * chars);
      if (k + 1 === n && o.endBy !== undefined) end = Math.min(end, o.endBy);
      end = Math.max(end, start + 0.05);
      ws.push(start); we.push(end);
    }
    this.wordWin = ws.map((a, k) => [a, we[k]!]);

    // the pen path
    const segs = this.segs;
    const app = o.approach ?? 0.35;
    const from = o.from ?? { x: this.box.x0 - o.size * 2, y: this.box.y0 - o.size * 1.5 };
    const p0 = first(0);
    segs.push({ ax: from.x, ay: from.y, bx: from.x, by: from.y, t0: -1e9, t1: ws[0]! - app, draw: false, word: -1 });
    segs.push({ ax: from.x, ay: from.y, bx: p0.x, by: p0.y, t0: ws[0]! - app, t1: ws[0]!, draw: false, word: -1, ease: ease.outCubic });
    for (let k = 0; k < n; k++) {
      // the word's own moves: strokes (drawn) and pen lifts inside the word (fast air moves), by weighted length
      const parts: { a: P2; b: P2; draw: boolean; w: number }[] = [];
      const strokes = wordStrokes[k]!;
      strokes.forEach((st, i) => {
        if (i > 0) {
          const pe = strokes[i - 1]![strokes[i - 1]!.length - 1]!, ps = st[0]!;
          parts.push({ a: pe, b: ps, draw: false, w: Math.hypot(ps.x - pe.x, ps.y - pe.y) * 0.45 + o.size * 0.04 });
        }
        for (let j = 1; j < st.length; j++) parts.push({ a: st[j - 1]!, b: st[j]!, draw: true, w: Math.hypot(st[j]!.x - st[j - 1]!.x, st[j]!.y - st[j - 1]!.y) });
      });
      const total = parts.reduce((x, p) => x + p.w, 0) || 1;
      let acc = 0;
      for (const p of parts) {
        const ta = ws[k]! + ((we[k]! - ws[k]!) * acc) / total;
        acc += p.w;
        const tb = ws[k]! + ((we[k]! - ws[k]!) * acc) / total;
        const sg: PenSeg = { ax: p.a.x, ay: p.a.y, bx: p.b.x, by: p.b.y, t0: ta, t1: tb, draw: p.draw, word: k };
        segs.push(sg);
        if (p.draw) this.drawn.push(sg);
      }
      // fly to the next word (wait, then an eased move that lands on its start)
      const e = last(k);
      if (k + 1 < n) {
        const b = first(k + 1);
        const tFly = Math.max(we[k]!, ws[k + 1]! - Math.max(0.12, clamp(Math.hypot(b.x - e.x, b.y - e.y) / AIR, 0.05, 0.3)));
        if (tFly > we[k]!) segs.push({ ax: e.x, ay: e.y, bx: e.x, by: e.y, t0: we[k]!, t1: tFly, draw: false, word: -1 });
        segs.push({ ax: e.x, ay: e.y, bx: b.x, by: b.y, t0: tFly, t1: Math.max(tFly + 1e-3, ws[k + 1]!), draw: false, word: -1, ease: ease.inOutCubic });
      } else segs.push({ ax: e.x, ay: e.y, bx: e.x, by: e.y, t0: we[k]!, t1: 1e9, draw: false, word: -1 });
    }
    this.tStart = ws[0]!;
    this.tEnd = we[n - 1]!;
  }

  /** Re-aim the pen's entrance: it waits at `from` (local) and reaches the first stroke `approach` s before the first word. */
  setFrom(from: P2, approach: number, fn: (u: number) => number = ease.inOutCubic) {
    const s1 = this.segs[1]!, t1 = s1.t1;
    this.segs[0] = { ax: from.x, ay: from.y, bx: from.x, by: from.y, t0: -1e9, t1: t1 - approach, draw: false, word: -1 };
    this.segs[1] = { ax: from.x, ay: from.y, bx: s1.bx, by: s1.by, t0: t1 - approach, t1, draw: false, word: -1, ease: fn };
  }

  /** Pen position at t (local). */
  head(t: number): P2 {
    const s = this.segs;
    let lo = 0, hi = s.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m]!.t0 <= t) lo = m; else hi = m - 1; }
    const g = s[lo]!;
    const u0 = clamp((t - g.t0) / Math.max(1e-6, g.t1 - g.t0));
    const u = g.ease ? g.ease(u0) : u0;
    return { x: g.ax + (g.bx - g.ax) * u, y: g.ay + (g.by - g.ay) * u };
  }

  /** True while a word is being written (the pen is drawing). */
  writing(t: number) { return this.wordWin.some(([a, b]) => t >= a && t < b); }

  /** The word being written (or last written) at t, -1 before the first. */
  wordAt(t: number) { let k = -1; this.wordWin.forEach(([a], i) => { if (t >= a) k = i; }); return k; }

  /**
   * Calls `fn(ax, ay, bx, by, age, word)` for every trail piece written by t (the piece under the pen is
   * cut at the pen). `age` = seconds since the pen passed the piece's end (0 for the piece being drawn).
   */
  emit(t: number, fn: (ax: number, ay: number, bx: number, by: number, age: number, word: number) => void) {
    for (const g of this.drawn) {
      if (g.t0 >= t) break;
      if (t >= g.t1) fn(g.ax, g.ay, g.bx, g.by, t - g.t1, g.word);
      else {
        const u = (t - g.t0) / Math.max(1e-6, g.t1 - g.t0);
        fn(g.ax, g.ay, g.ax + (g.bx - g.ax) * u, g.ay + (g.by - g.ay) * u, 0, g.word);
      }
    }
  }
}

const TRAIL_VERT = /* glsl */ `
precision highp float;
in vec3 position;                 // quad corner: x in {0,1} along the piece, y in {-1,1} across
in vec3 iA; in vec3 iB;           // end points (world)
in vec4 iColor;                   // linear rgb (may exceed 1), a = gain
in vec2 iWidth;                   // core width, halo width (world units)
uniform mat4 projectionMatrix; uniform mat4 modelViewMatrix;
uniform vec2 res; uniform float pxScale; uniform float fogD;
out vec2 vLocal; out float vLen; out float vCore; out float vGlow; out vec3 vColor;
void main() {
  vec4 va = modelViewMatrix * vec4(iA, 1.0), vb = modelViewMatrix * vec4(iB, 1.0);
  vec4 ca = projectionMatrix * va, cb = projectionMatrix * vb;
  if (ca.w <= 0.01 || cb.w <= 0.01) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 hres = 0.5 * res * pxScale;
  vec2 sa = ca.xy / ca.w * hres, sb = cb.xy / cb.w * hres;   // physical px, centred
  float ppx = projectionMatrix[1][1] * hres.y / mix(ca.w, cb.w, position.x); // px per world unit here
  float core = max(iWidth.x * ppx * 0.5, 0.45 * pxScale);
  float glow = max(iWidth.y * ppx * 0.5, 1.0);
  float hw = max(core + 1.5, glow * 2.4);
  vec2 d = sb - sa; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float along = mix(-hw, len + hw, position.x);
  vec2 p = sa + dir * along + nrm * position.y * hw;
  float z = mix(ca.z / ca.w, cb.z / cb.w, position.x);
  gl_Position = vec4(p / hres, z, 1.0);
  vLocal = vec2(along, position.y * hw);
  vLen = len; vCore = core; vGlow = glow;
  float dist = length(mix(va.xyz, vb.xyz, 0.5));
  vColor = iColor.rgb * iColor.a * exp(-fogD * fogD * dist * dist);
}`;

const TRAIL_FRAG = /* glsl */ `
precision highp float;
in vec2 vLocal; in float vLen; in float vCore; in float vGlow; in vec3 vColor;
uniform float hot, glowGain;
out vec4 fragColor;
void main() {
  float x = clamp(vLocal.x, 0.0, vLen);
  float d = length(vec2(vLocal.x - x, vLocal.y));
  float core = clamp(vCore + 0.5 - d, 0.0, 1.0);
  float g = exp(-(d * d) / (vGlow * vGlow));
  float m = max(vColor.r, max(vColor.g, vColor.b));
  vec3 c = (vColor + vec3(m) * hot) * core + vColor * g * glowGain;
  if (max(c.r, max(c.g, c.b)) < 1e-4) discard;
  fragColor = vec4(c, 1.0);
}`;

/**
 * Glowing segments in 3D (world coordinates), drawn with max blending (joints don't double up) and a
 * depth test against the scene. Add `.mesh` to the stage; per frame: begin(), seg()..., commit(out).
 */
export class TrailBatch {
  mesh: THREE.Mesh;
  geo = new THREE.InstancedBufferGeometry();
  mat: THREE.RawShaderMaterial;
  private a: Float32Array; private b: Float32Array; private c: Float32Array; private w: Float32Array;
  private attrs: THREE.InstancedBufferAttribute[];
  count = 0;

  constructor(public capacity: number, o: { hot?: number; glowGain?: number; fogDensity?: number } = {}) {
    const quad = new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]);
    this.geo.setAttribute('position', new THREE.BufferAttribute(quad, 3));
    this.geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.a = new Float32Array(capacity * 3); this.b = new Float32Array(capacity * 3);
    this.c = new Float32Array(capacity * 4); this.w = new Float32Array(capacity * 2);
    this.attrs = [
      new THREE.InstancedBufferAttribute(this.a, 3), new THREE.InstancedBufferAttribute(this.b, 3),
      new THREE.InstancedBufferAttribute(this.c, 4), new THREE.InstancedBufferAttribute(this.w, 2),
    ];
    this.attrs.forEach((x) => x.setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('iA', this.attrs[0]!); this.geo.setAttribute('iB', this.attrs[1]!);
    this.geo.setAttribute('iColor', this.attrs[2]!); this.geo.setAttribute('iWidth', this.attrs[3]!);
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      uniforms: {
        res: { value: new THREE.Vector2(W, H) }, pxScale: { value: 1 }, fogD: { value: o.fogDensity ?? 0 },
        hot: { value: o.hot ?? 0.45 }, glowGain: { value: o.glowGain ?? 0.55 },
      },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  begin() { this.count = 0; }

  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, core: number, glow: number, r: number, g: number, b: number, gain = 1) {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    this.a[i * 3] = ax; this.a[i * 3 + 1] = ay; this.a[i * 3 + 2] = az;
    this.b[i * 3] = bx; this.b[i * 3 + 1] = by; this.b[i * 3 + 2] = bz;
    this.c[i * 4] = r; this.c[i * 4 + 1] = g; this.c[i * 4 + 2] = b; this.c[i * 4 + 3] = gain;
    this.w[i * 2] = core; this.w[i * 2 + 1] = glow;
  }

  /** Upload for this frame; `pxScale` = physical px per logical px of the target being drawn. */
  commit(pxScale: number) {
    for (const at of this.attrs) { at.needsUpdate = true; at.clearUpdateRanges(); at.addUpdateRange(0, this.count * at.itemSize); }
    this.geo.instanceCount = this.count;
    this.mat.uniforms.pxScale!.value = pxScale;
    this.mesh.visible = this.count > 0;
  }
}
