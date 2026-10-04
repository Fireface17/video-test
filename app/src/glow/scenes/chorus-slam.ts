// Karaoke in solid letters: a sung line set in rows of extruded words that drop and slam into place
// exactly on their sung starts (they are hidden before, so the highlight never runs ahead of the voice).
import * as THREE from 'three';
import { BlockText } from '../lib/extrude';
import type { Line, Word } from '../../engine/lyrics';
import { clamp, ease, pulse } from '../../engine/util';

export interface SlamWord { row: number; bt: BlockText; idx: number; word: Word; home: THREE.Vector3 }

export class SlamLine extends THREE.Group {
  words: SlamWord[] = [];
  rows: BlockText[] = [];

  /**
   * `rows` = word indices of `line` per row (top to bottom). Rows are centred, `size` world units per em,
   * `leading` between baselines. Text is upper-cased.
   */
  /**
   * `pieces`: words sung in pieces (a stutter like glo-glo-glo-glowing) -> the pieces with their own times;
   * each piece slams on its own.
   */
  constructor(public line: Line, rows: number[][], o: { size: number; leading?: number; depth?: number; face: THREE.Color; side: THREE.Color; maxWidth?: number;
    pieces?: Map<number, { text: string; start: number; end: number }[]> }) {
    super();
    const lead = o.leading ?? o.size * 0.92;
    // the units that slam: words, or the pieces of a split word
    const unitsOf = (wi: number): Word[] => {
      const ps = o.pieces?.get(wi);
      const w = line.words[wi]!;
      return ps ? ps.map((p) => ({ ...w, w: p.text, start: p.start, end: p.end })) : [w];
    };
    rows.forEach((ids, r) => {
      const units = ids.flatMap(unitsOf);
      const text = units.map((u) => u.w.toUpperCase()).join(' ');
      const bt = new BlockText(text, { size: o.size, depth: o.depth ?? o.size * 0.32, bevel: o.size * 0.025, align: 'center', face: o.face.clone(), side: o.side.clone() });
      bt.position.y = (rows.length - 1 - r) * lead;
      this.add(bt);
      this.rows.push(bt);
      // a vertical gradient baked into the letters (bright top, darker foot) so faces don't read flat
      for (const bw of bt.words) {
        const g = bw.mesh.geometry, pos = g.getAttribute('position');
        const cols = new Float32Array(pos.count * 3);
        for (let v = 0; v < pos.count; v++) {
          const y = pos.getY(v) / (o.size * 0.72);
          const k = 0.55 + 0.45 * Math.min(1, Math.max(0, y)) + 0.1 * Math.max(0, y - 1);
          cols[v * 3] = cols[v * 3 + 1] = cols[v * 3 + 2] = k;
        }
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        bw.face.vertexColors = bw.side.vertexColors = true;
      }
      units.forEach((u, k) => {
        const m = bt.words[k]!.mesh;
        this.words.push({ row: r, bt, idx: k, word: u, home: m.position.clone() });
      });
    });
    const widest = Math.max(...this.rows.map((r) => r.width));
    if (o.maxWidth && widest > o.maxWidth) this.scale.setScalar(o.maxWidth / widest);
  }

  /**
   * Pose the words at time t: each drops from `fall` above in the `lead` seconds before its start, lands on
   * the start with a squash, then sits lit. Returns the words that landed within the last frame window
   * (for ripples / shake). `exit` (0..1) tips every word backward flat (when the next line takes over).
   */
  pose(t: number, fall = 3, lead = 0.12, exit = 0, faceK = 1, sideK = 1) {
    const landed: SlamWord[] = [];
    for (const w of this.words) {
      const m = w.bt.words[w.idx]!.mesh;
      const face = w.bt.words[w.idx]!.face, side = w.bt.words[w.idx]!.side;
      const s = w.word.start;
      const vis = t >= s - lead;
      m.visible = vis;
      if (!vis) continue;
      const k = clamp((t - (s - lead)) / lead, 0, 1);
      const y = (1 - ease.inQuad(k)) * fall;
      const sq = pulse(t, s, 0.07);
      // tip backward around the baseline when the next line takes over, then sink through the floor
      const ex = clamp(exit * 1.15 - w.idx * 0.04, 0, 1);
      m.position.set(w.home.x, w.home.y + y - ease.inCubic(ex) * (w.home.y + 1.2), w.home.z);
      m.scale.set(1 + sq * 0.12, 1 - sq * 0.18, 1);
      m.rotation.x = -ease.inOutCubic(ex) * (Math.PI / 2);
      if (ex >= 1) m.visible = false;
      const lit = t >= s ? 1 : 0.15;
      (face.userData.base as THREE.Color | undefined) ?? (face.userData.base = face.color.clone());
      (side.userData.base as THREE.Color | undefined) ?? (side.userData.base = side.color.clone());
      face.color.copy(face.userData.base).multiplyScalar(lit * faceK * (1 + 1.5 * pulse(t, s, 0.18)));
      side.color.copy(side.userData.base).multiplyScalar(lit * sideK * (1 + 2 * pulse(t, s, 0.18)));
      if (t >= s && t - s < 1 / 30) landed.push(w);
    }
    return landed;
  }

  /** World position of a word's centre (for effects). */
  centre(w: SlamWord) {
    const m = w.bt.words[w.idx]!;
    const v = new THREE.Vector3((m.x0 + m.x1) / 2, w.home.y, 0);
    return w.bt.localToWorld(v);
  }

  override dispose() { for (const r of this.rows) r.dispose(); }
}
