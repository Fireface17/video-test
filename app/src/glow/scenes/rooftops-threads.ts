// Chorus 1, "Look how beautiful we are": seen from above, threads of light run from the two of them to the
// nearest glowing people, and from each of those on to theirs, until every glowing person in the dark city is
// joined — a constellation drawn by people across the map of the city. A nearest-neighbour graph (each person to
// their 2–3 nearest), revealed breadth-first from the two of them, each thread drawn from the end that is already
// lit to the other; a soft pulse runs out along them; every person gets a star when their thread arrives.
import * as THREE from 'three';
import { clamp, pulse } from '../../engine/util';
import { GlowLines } from '../lib/stars';
import { GlowPoints } from '../lib/points';

export class Threads extends THREE.Group {
  lines: GlowLines;
  stars: GlowPoints;
  edges: { a: number; b: number; t: number }[] = [];
  arrive: number[] = [];

  /** `pts` the people (world), `roots` the indices of the two of them; t0 the first thread, `dt` per hop. */
  constructor(public pts: THREE.Vector3[], roots: number[], t0: number, dt = 0.11, k = 3, width = 0.45) {
    super();
    const n = pts.length;
    const nb: number[][] = pts.map((p, i) => pts.map((q, j) => [j, (p.x - q.x) ** 2 + (p.z - q.z) ** 2 + 0.3 * (p.y - q.y) ** 2] as [number, number]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, k).map(([j]) => j));
    const adj: Set<number>[] = pts.map(() => new Set());
    nb.forEach((l, i) => l.forEach((j) => { adj[i]!.add(j); adj[j]!.add(i); }));
    // breadth-first from the roots: hop count and time of arrival (distance matters a little too)
    this.arrive = new Array(n).fill(Infinity);
    const q: number[] = [];
    for (const r of roots) { this.arrive[r] = t0; q.push(r); }
    const seen = new Set<string>();
    while (q.length) {
      const i = q.shift()!;
      for (const j of adj[i]!) {
        const key = i < j ? `${i},${j}` : `${j},${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = Math.hypot(pts[i]!.x - pts[j]!.x, pts[i]!.z - pts[j]!.z);
        const tj = this.arrive[i]! + dt + d / 900;
        this.edges.push({ a: i, b: j, t: this.arrive[i]! });
        if (tj < this.arrive[j]!) { this.arrive[j] = tj; q.push(j); }
      }
    }
    // people the graph never reached: join them to the nearest reached one
    for (let i = 0; i < n; i++) if (!isFinite(this.arrive[i]!)) { const j = nb[i]![0]!; this.arrive[i] = (isFinite(this.arrive[j]!) ? this.arrive[j]! : t0 + 2) + dt; this.edges.push({ a: j, b: i, t: this.arrive[i]! - dt }); }
    this.lines = new GlowLines(this.edges.length, width);
    this.stars = new GlowPoints(n, 1);
    this.add(this.lines, this.stars);
  }

  /** Per frame: k overall brightness; colour of a thread from its two people. */
  update(t: number, k: number, color: (i: number) => THREE.Color, starSize = 3, grow = 0.28) {
    let n = 0;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Color();
    for (const e of this.edges) {
      const u = clamp((t - e.t) / grow);
      if (u <= 0) continue;
      a.copy(this.pts[e.a]!); b.copy(this.pts[e.a]!).lerp(this.pts[e.b]!, u);
      c.copy(color(e.a)).lerp(color(e.b), 0.5);
      // a pulse running out along the network, and the fresh end brighter
      const p = 1 + 1.5 * pulse(t, e.t + grow, 0.25) + 0.25 * Math.sin(t * 4 - e.t * 6);
      this.lines.set(n++, a, b, c, k * 0.55 * p);
    }
    this.lines.commit(n);
    for (let i = 0; i < this.pts.length; i++) {
      const on = clamp((t - this.arrive[i]!) / 0.2);
      if (on <= 0) { this.stars.hide(i); continue; }
      const p = this.pts[i]!;
      this.stars.set(i, p.x, p.y, p.z, color(i), k * on * (1 + 2 * pulse(t, this.arrive[i]!, 0.2)), starSize);
    }
    this.stars.commit();
  }
}
