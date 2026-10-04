// Neon signs: single-stroke lettering (engine/stroke.ts) built as glass tubes, one mesh per word so
// each word can switch on when it is sung.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { strokeText, type StrokeFontName } from '../../engine/stroke';
import type { Line } from '../../engine/lyrics';
import { frameIdx, hash, noise1 } from '../../engine/util';

/** Tube along a planar polyline (x right, y up, z = 0), with round caps. */
function tube(pts: THREE.Vector2[], r: number, radial = 7): THREE.BufferGeometry | null {
  // drop duplicate points
  const p: THREE.Vector2[] = [];
  for (const q of pts) if (!p.length || q.distanceTo(p[p.length - 1]!) > r * 0.15) p.push(q);
  if (p.length < 2) return pts.length ? ball(pts[0]!, r * 1.05, radial) : null;
  const n = p.length;
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let px = 0, py = 1; // last good in-plane normal (hairpins, e.g. in I and 1, have no tangent)
  for (let i = 0; i < n; i++) {
    const a = p[Math.max(0, i - 1)]!, b = p[Math.min(n - 1, i + 1)]!;
    let tx = b.x - a.x, ty = b.y - a.y;
    if (Math.hypot(tx, ty) < 1e-6) { tx = p[Math.min(n - 1, i + 1)]!.x - p[i]!.x; ty = p[Math.min(n - 1, i + 1)]!.y - p[i]!.y; }
    const tl = Math.hypot(tx, ty);
    if (tl > 1e-6) { px = -ty / tl; py = tx / tl; }
    const nx = px, ny = py; // in-plane normal
    for (let k = 0; k < radial; k++) {
      const th = (k / radial) * Math.PI * 2;
      const cx = Math.cos(th), cz = Math.sin(th);
      const ox = nx * cx, oy = ny * cx, oz = cz;
      pos.push(p[i]!.x + ox * r, p[i]!.y + oy * r, oz * r);
      nor.push(ox, oy, oz);
    }
  }
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k, b = i * radial + ((k + 1) % radial), c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return mergeGeometries([g, ball(p[0]!, r, radial), ball(p[n - 1]!, r, radial)], false);
}

/** Round cap / dot: an indexed sphere with position + normal only (so it merges with the tubes). */
function ball(q: THREE.Vector2, r: number, radial: number) {
  const s = new THREE.SphereGeometry(r, radial, Math.max(3, radial >> 1));
  s.deleteAttribute('uv');
  s.translate(q.x, q.y, 0);
  return s;
}

/**
 * Neon material: lit tubes have a white-hot core and saturated edges (view-angle based), unlit
 * tubes are dark glass with a faint rim. `on` 0..1 fades between them; > 1 overdrives.
 */
export function neonMaterial(color: THREE.Color, glass = new THREE.Color(0.018, 0.02, 0.035)) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: color.clone() }, glass: { value: glass }, on: { value: 0 },
    }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); // (the name fog_vertex expects)
        vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 color, glass; uniform float on;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = abs(dot(normalize(vN + vec3(0.0, 0.0, 1e-5)), normalize(vV)));
        vec3 dark = glass * (0.35 + 1.6 * pow(1.0 - f, 3.0)) + vec3(0.05) * pow(f, 40.0);
        float lum = max(max(color.r, color.g), color.b);
        vec3 lit = color * (0.55 + 1.1 * pow(f, 1.4)) + vec3(lum) * 0.9 * pow(f, 7.0);
        gl_FragColor = vec4(mix(dark, lit * max(on, 0.0), clamp(on, 0.0, 1.0)), 1.0);
        #include <fog_fragment>
      }`,
  });
}

/**
 * Switch-on curve of a neon word sung at t0: dark before, a short stutter (on/off over ~110 ms,
 * keyed to frames so motion blur doesn't smear it), then steady with a faint hum.
 */
export function flickerOn(t: number, t0: number, seed = 0, lead = 0.0): number {
  const dt = t - (t0 - lead);
  if (dt < 0) return 0;
  if (dt < 0.11) {
    const fi = frameIdx(t);
    const pat = [1, 0.15, 0.9, 0.05, 1, 0.6, 1];
    return pat[Math.min(pat.length - 1, Math.floor(dt / 0.016))]! * (0.7 + 0.3 * hash(fi, seed));
  }
  return 1 + 0.035 * noise1(t * 9, seed);
}

export interface NeonWord { text: string; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; x0: number; x1: number }

export interface NeonOpts {
  font?: StrokeFontName;
  /** World units per em. */
  size?: number;
  /** Tube radius in world units (default size * 0.018). */
  radius?: number;
  color?: THREE.Color;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
}

/** A line of neon lettering, origin at the baseline (aligned per opts.align), in the XY plane. */
export class NeonSign extends THREE.Group {
  words: NeonWord[] = [];
  width = 0;
  capHeight = 0;

  constructor(public text: string, o: NeonOpts = {}) {
    super();
    const size = o.size ?? 1, font = o.font ?? 'script';
    const st = strokeText(text, font, 100, o.tracking ?? 0);
    const s = size / 100, r = o.radius ?? size * 0.018;
    this.width = st.width * s;
    this.capHeight = st.capHeight * s;
    const ox = o.align === 'center' ? -this.width / 2 : o.align === 'right' ? -this.width : 0;
    // char -> word index
    const chars = Array.from(text);
    const wordOf: number[] = [];
    let w = 0;
    chars.forEach((ch, i) => { if (ch === ' ' && i > 0 && chars[i - 1] !== ' ') w++; wordOf.push(ch === ' ' ? -1 : w); });
    const parts = text.split(/\s+/).filter(Boolean);
    const geos: THREE.BufferGeometry[][] = parts.map(() => []);
    const bx: [number, number][] = parts.map(() => [Infinity, -Infinity]);
    st.strokes.forEach((stroke, i) => {
      const wi = wordOf[st.charOf[i]!]!;
      if (wi < 0) return;
      const pts = stroke.map((p) => new THREE.Vector2(p.x * s + ox, -p.y * s));
      const g = tube(pts, r);
      if (g) geos[wi]!.push(g);
      for (const q of pts) { bx[wi]![0] = Math.min(bx[wi]![0], q.x); bx[wi]![1] = Math.max(bx[wi]![1], q.x); }
    });
    const color = o.color ?? new THREE.Color(1, 1, 1);
    parts.forEach((p, i) => {
      const geo = geos[i]!.length ? mergeGeometries(geos[i]!, false) : new THREE.BufferGeometry();
      const mat = neonMaterial(color);
      const mesh = new THREE.Mesh(geo, mat);
      this.add(mesh);
      this.words.push({ text: p, mesh, mat, x0: bx[i]![0], x1: bx[i]![1] });
    });
  }

  setLevel(i: number, on: number) { const w = this.words[i]; if (w) w.mat.uniforms.on!.value = on; }
  setColor(i: number, c: THREE.Color) { const w = this.words[i]; if (w) (w.mat.uniforms.color!.value as THREE.Color).copy(c); }
  setAll(on: number) { for (let i = 0; i < this.words.length; i++) this.setLevel(i, on); }

  /** Karaoke: each word flickers on at its sung start (words of `line`, matched by index). */
  sing(line: Line, t: number, gain = 1, lead = 0) {
    this.words.forEach((_, i) => {
      const w = line.words[i];
      this.setLevel(i, w ? flickerOn(t, w.start, i * 7 + line.i, lead) * gain : 0);
    });
  }

  override dispose() { for (const w of this.words) { w.mesh.geometry.dispose(); w.mat.dispose(); } }
}

/**
 * A sung line as neon in several rows (word indices per row, top to bottom), centred, `leading` between
 * baselines. `sing(t)` lights each word at its sung start.
 */
export class NeonLine extends THREE.Group {
  rows: { sign: NeonSign; ids: number[] }[] = [];

  constructor(public line: Line, rows: number[][], o: NeonOpts & { leading?: number } = {}) {
    super();
    const lead = o.leading ?? (o.size ?? 1) * 1.05;
    rows.forEach((ids, r) => {
      const sign = new NeonSign(ids.map((i) => line.words[i]!.w).join(' '), { align: 'center', ...o });
      sign.position.y = (rows.length - 1 - r) * lead;
      this.add(sign);
      this.rows.push({ sign, ids });
    });
  }

  sing(t: number, gain = 1) {
    for (const { sign, ids } of this.rows)
      ids.forEach((wi, k) => {
        const w = this.line.words[wi];
        sign.setLevel(k, w ? flickerOn(t, w.start, wi * 7 + this.line.i) * gain : 0);
      });
  }

  setColor(c: THREE.Color) { for (const { sign } of this.rows) sign.words.forEach((_, i) => sign.setColor(i, c)); }

  override dispose() { for (const { sign } of this.rows) sign.dispose(); }
}

/** Split a line's words into `n` rows of similar length (word indices per row). */
export function splitRows(line: Line, n: number): number[][] {
  const ws = line.words, total = ws.reduce((s, w) => s + w.w.length + 1, 0);
  const rows: number[][] = [];
  let acc = 0, cur: number[] = [];
  ws.forEach((w, i) => {
    cur.push(i);
    acc += w.w.length + 1;
    if (rows.length < n - 1 && acc >= (total * (rows.length + 1)) / n && i < ws.length - 1) { rows.push(cur); cur = []; }
  });
  if (cur.length) rows.push(cur);
  return rows;
}
