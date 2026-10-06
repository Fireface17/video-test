// The lyrics of the drops as star-text: each word ignites when it is sung — a flock of stars flies into the
// shape of its letters, the letters glow hot while sung and settle into a steady light — and the line fades
// when the next begins. Flat glowing glyphs (Tilt Neon) in screen space over a dimmed patch of galaxy.
import * as THREE from 'three';
import { clamp, hash, lerp, mulberry32, smoothstep } from '../../engine/util';
import type { Line, Lyrics } from '../../engine/lyrics';
import { GlowPoints } from '../lib/points';
import { displayTextGeometry, loadDisplayFont } from '../lib/fonts';

interface WordGeo { geo: THREE.BufferGeometry; w: number; pts: Float32Array; n: number }
interface Placed { line: Line; x: number[]; sz: number; width: number; tOut: number }

export class StarText {
  group = new THREE.Group();
  sparks: GlowPoints;
  private font!: Awaited<ReturnType<typeof loadDisplayFont>>;
  private geos = new Map<string, WordGeo>();
  private meshes = new Map<number, THREE.Mesh>();
  private mat: THREE.MeshBasicMaterial;
  private lines: Placed[] = [];
  /** screen (ndc) centre line of the text */
  y = -0.62;

  constructor(private lyrics: Lyrics, private t0: number, private t1: number, private tint: THREE.Color, private hot: THREE.Color, maxSparks = 1600) {
    this.sparks = new GlowPoints(maxSparks, 1);
    this.sparks.renderOrder = 6;
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    this.group.add(this.sparks);
  }

  async init() {
    this.font = await loadDisplayFont('tiltneon');
    const ls = this.lyrics.linesIn(this.t0 - 0.2, this.t1 + 0.2).filter((l) => l.start >= this.t0 - 0.3);
    ls.forEach((l, i) => {
      const next = ls[i + 1];
      const tOut = Math.min(l.end + 0.7, next ? next.start + 0.05 : 1e9);
      const gs = l.words.map((w) => this.geo(w.w));
      const gap = 0.4;
      const total = gs.reduce((a, g) => a + g.w, 0) + gap * (gs.length - 1);
      const sz = clamp(2.55 / Math.max(total, 1e-3), 0.12, 0.34);
      let x = -total / 2;
      const xs = gs.map((g) => { const c = x + g.w / 2; x += g.w + gap; return c * sz; });
      this.lines.push({ line: l, x: xs, sz, width: total * sz, tOut });
    });
  }

  private geo(word: string): WordGeo {
    let g = this.geos.get(word);
    if (g) return g;
    const geo = displayTextGeometry(this.font, word, 1);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    // centre vertically on the x-height-ish middle
    geo.translate(0, -0.3, 0);
    // sample points inside the glyph triangles (area weighted)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute, idx = geo.index;
    const tri: number[][] = [];
    const nT = idx ? idx.count / 3 : pos.count / 3;
    let area = 0;
    const cum: number[] = [];
    for (let i = 0; i < nT; i++) {
      const a = idx ? idx.getX(i * 3) : i * 3, b = idx ? idx.getX(i * 3 + 1) : i * 3 + 1, c = idx ? idx.getX(i * 3 + 2) : i * 3 + 2;
      const ax = pos.getX(a), ay = pos.getY(a), bx = pos.getX(b), by = pos.getY(b), cx = pos.getX(c), cy = pos.getY(c);
      area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
      cum.push(area);
      tri.push([ax, ay, bx, by, cx, cy]);
    }
    const n = Math.round(clamp(16 + (bb.max.x - bb.min.x) * 34, 20, 70));
    const r = mulberry32(Math.floor(hash(word.length, word.charCodeAt(0)) * 1e6));
    const pts = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const u = r() * area;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m]! < u) lo = m + 1; else hi = m; }
      const T = tri[lo]!;
      let s = r(), t = r();
      if (s + t > 1) { s = 1 - s; t = 1 - t; }
      pts[k * 2] = T[0]! + s * (T[2]! - T[0]!) + t * (T[4]! - T[0]!);
      pts[k * 2 + 1] = T[1]! + s * (T[3]! - T[1]!) + t * (T[5]! - T[1]!);
    }
    g = { geo, w: bb.max.x - bb.min.x, pts, n };
    this.geos.set(word, g);
    return g;
  }

  private mesh(key: number, g: WordGeo) {
    let m = this.meshes.get(key);
    if (!m) {
      m = new THREE.Mesh(g.geo, this.mat.clone());
      m.renderOrder = 5;
      this.meshes.set(key, m);
      this.group.add(m);
    }
    return m;
  }

  /** The line on screen at t (for the scrim), or null. */
  active(t: number): Placed | null {
    for (const p of this.lines) if (t >= p.line.start - 0.12 && t < p.tOut + 0.4) return p;
    return null;
  }

  /** Draws the words; returns the scrim strength (0..1) and the half width of the line. */
  update(t: number, kick: number): { k: number; hw: number } {
    for (const m of this.meshes.values()) m.visible = false;
    let ns = 0;
    const S = this.sparks;
    let scrim = 0, hw = 1;
    for (let li = 0; li < this.lines.length; li++) {
      const p = this.lines[li]!;
      if (t < p.line.start - 0.12 || t > p.tOut + 0.4) continue;
      const fade = 1 - smoothstep(p.tOut, p.tOut + 0.35, t);
      const inn = smoothstep(p.line.start - 0.12, p.line.start + 0.05, t);
      scrim = Math.max(scrim, fade * inn);
      hw = p.width / 2 + 0.35;
      p.line.words.forEach((w, wi) => {
        const g = this.geo(w.w);
        const age = t - (w.start - 0.03);
        if (age < 0) return;
        const m = this.mesh(li * 64 + wi, g);
        const e = clamp(age / 0.32);
        const pop = 1 + 0.3 * Math.pow(1 - e, 2.2);
        const sung = t >= w.start && t < w.end + 0.05 ? 1 : 0;
        const heat = sung ? 1 : 0.55 + 0.45 * Math.exp(-(t - w.end) * 2.2);
        const a = smoothstep(0, 0.16, age) * fade;
        const k = (1.1 + 1.5 * heat + 0.4 * kick * sung) * a;
        const c = (m.material as THREE.MeshBasicMaterial).color;
        c.copy(this.tint).lerp(this.hot, 0.35 + 0.65 * heat * (1 - 0.5 * (1 - sung))).multiplyScalar(k);
        m.visible = true;
        m.scale.setScalar(p.sz * pop);
        m.position.set(p.x[wi]!, this.y, 0);
        // the stars that make the word: they fly in during the first third of a second, then twinkle
        const fly = 1 - Math.pow(1 - e, 3);
        for (let s = 0; s < g.n && ns < S.n; s++) {
          const hx = hash(li, wi, s, 1), hy = hash(li, wi, s, 2), hz = hash(li, wi, s, 3);
          const ox = (hx - 0.5) * 1.6 * (1 - fly), oy = (hy - 0.5) * 1.1 * (1 - fly) + 0.15 * (1 - fly);
          const tw = Math.pow(0.5 + 0.5 * Math.sin(t * (5 + 6 * hz) + hx * 40), 3);
          const br = (0.5 + 1.8 * tw) * a * (0.6 + 0.8 * heat) * (0.4 + 0.6 * fly);
          S.set(ns++, m.position.x + (g.pts[s * 2]! + ox) * p.sz * pop, this.y + (g.pts[s * 2 + 1]! + oy) * p.sz * pop, 0.01, this.hot, br, 0.012 * (0.7 + 0.8 * hy));
        }
      });
    }
    for (let i = ns; i < S.n; i++) S.hide(i);
    S.commit(Math.max(ns, 1));
    return { k: scrim, hw };
  }

  dispose() {
    this.sparks.geometry.dispose();
    this.mat.dispose();
    for (const m of this.meshes.values()) (m.material as THREE.Material).dispose();
    for (const g of this.geos.values()) g.geo.dispose();
  }
}
void lerp;
