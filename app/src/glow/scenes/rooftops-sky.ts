// Chorus 1, "Every broken piece becomes a star": the dark sky over the city is a pane of black glass; it cracks
// from a point above the two of them — cracks that catch the moon and split it into colour, glittering along
// their length — then the pieces come loose: thick slabs of black glass with glossy faces (the moon and the
// city's glow slide across them as they tumble, their edges lit green-cyan like real glass), a few falling right
// past the camera; the rest fold into five-pointed stars and rise. Behind the broken dark: the real stars.
// Built as a shattered-pane tiling of a dome above the bridge; each piece is a prism (front, back, sides) whose
// rim morphs from its cell's outline to a star's.
import * as THREE from 'three';
import { clamp, ease, hash, mulberry32, noise1, smoothstep } from '../../engine/util';
import { GlowLines } from '../lib/stars';
import { GlowPoints } from '../lib/points';

interface Shard {
  c: THREE.Vector3; // centre on the dome (world)
  n: THREE.Vector3; // outward normal (toward the dome centre is -n)
  u: THREE.Vector3; v: THREE.Vector3; // tangent frame
  poly: THREE.Vector2[]; // 10 rim points, local (u, v) metres
  star: THREE.Vector2[];
  edges: [THREE.Vector3, THREE.Vector3][]; // the cell's edges (world), for the cracks
  d: number; // distance from the impact (for the crack front and the order things happen)
  seed: number;
  axis: THREE.Vector3;
  /** falls past the camera (toward `pass`) instead of becoming a star */
  fall: THREE.Vector3 | null;
}

const RIM = 10;

export class SkyShards extends THREE.Group {
  shards: Shard[] = [];
  mesh: THREE.Mesh;
  cracks: GlowLines;
  glints: GlowPoints;
  private pos: Float32Array;
  private col: Float32Array;
  private nEdges = 0;
  private impactP = new THREE.Vector3();

  /** A dome of radius R around `o`, from elevation `el0` up; the cracks start above `impact` (a direction). */
  constructor(public o: THREE.Vector3, public R = 70, el0 = 0.42, n = 130, seed = 3, impact = new THREE.Vector3(0.1, 1, -0.2).normalize(), pass: { cam: THREE.Vector3; look: THREE.Vector3; n: number } | null = null) {
    super();
    const r = mulberry32(seed);
    // seeds on the projected disc (direction (x, 1, z) normalised): rings around the point of impact with
    // jittered angles, so the cells are wedges between radial cracks and rings — a shattered pane, small
    // pieces at the impact, big ones far from it
    const rMax = Math.tan(Math.PI / 2 - el0);
    const qi = new THREE.Vector2(impact.x / Math.max(impact.y, 0.2), impact.z / Math.max(impact.y, 0.2));
    const S: THREE.Vector2[] = [qi.clone().add(new THREE.Vector2(0.01, 0.0))];
    for (let k = 0; S.length < n && k < 40; k++) {
      const rad = 0.06 * Math.pow(1.38, k), m = 5 + 3 * k, ph = r() * 6.28;
      for (let j = 0; j < m && S.length < n; j++) {
        const a = ph + ((j + (r() - 0.5) * 0.55) / m) * Math.PI * 2, rr = rad * (0.8 + 0.4 * r());
        const q = qi.clone().add(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
        if (q.length() < rMax * 0.98) S.push(q);
      }
      if (rad > rMax * 2.2) break;
    }
    const toDome = (q: THREE.Vector2) => new THREE.Vector3(q.x, 1, q.y).normalize().multiplyScalar(this.R).add(this.o);
    const ip = impact.clone().multiplyScalar(this.R).add(this.o);
    this.impactP.copy(ip);
    let ne = 0;
    for (let i = 0; i < S.length; i++) {
      const si = S[i]!;
      // the Voronoi cell: a square clipped by the bisectors with the nearest seeds
      let poly: THREE.Vector2[] = [new THREE.Vector2(-1, -1), new THREE.Vector2(1, -1), new THREE.Vector2(1, 1), new THREE.Vector2(-1, 1)].map((p) => p.multiplyScalar(rMax * 0.6).add(si));
      const nb = S.map((p, j) => [j, p.distanceToSquared(si)] as [number, number]).filter(([j]) => j !== i).sort((a, b) => a[1] - b[1]).slice(0, 14);
      for (const [j] of nb) {
        const sj = S[j]!, m = si.clone().add(sj).multiplyScalar(0.5), dvec = sj.clone().sub(si);
        const inside = (p: THREE.Vector2) => p.clone().sub(m).dot(dvec) <= 0;
        const out: THREE.Vector2[] = [];
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k]!, b = poly[(k + 1) % poly.length]!;
          const ia = inside(a), ib = inside(b);
          if (ia) out.push(a);
          if (ia !== ib) {
            const ta = a.clone().sub(m).dot(dvec), tb = b.clone().sub(m).dot(dvec);
            out.push(a.clone().lerp(b, ta / (ta - tb)));
          }
        }
        poly = out;
        if (poly.length < 3) break;
      }
      if (poly.length < 3 || poly.some((p) => p.length() > rMax * 1.02)) continue;
      // the cell on the dome: centre, a tangent frame, the outline in local metres
      const cw = toDome(si), nrm = cw.clone().sub(this.o).normalize();
      const u = new THREE.Vector3(0, 1, 0).cross(nrm);
      if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
      u.normalize();
      const v = nrm.clone().cross(u).normalize();
      const world = poly.map(toDome);
      const local = world.map((p) => new THREE.Vector2(p.clone().sub(cw).dot(u), p.clone().sub(cw).dot(v)));
      // resample the outline into RIM points by arc length
      const per: number[] = [0];
      for (let k = 1; k <= local.length; k++) per.push(per[k - 1]! + local[k % local.length]!.distanceTo(local[k - 1]!));
      const tot = per[per.length - 1]!;
      const rim: THREE.Vector2[] = [];
      for (let k = 0; k < RIM; k++) {
        const s = (k / RIM) * tot;
        let e = 1;
        while (e < per.length - 1 && per[e]! < s) e++;
        const a = local[e - 1]!, b = local[e % local.length]!;
        rim.push(a.clone().lerp(b, (s - per[e - 1]!) / Math.max(per[e]! - per[e - 1]!, 1e-6)));
      }
      // the star it becomes: 5 points, about as big as the piece, turned to match the first rim point
      const size = Math.min(Math.sqrt(tot * tot / 40), 3.2);
      const a0 = Math.atan2(rim[0]!.y, rim[0]!.x);
      const star: THREE.Vector2[] = [];
      for (let k = 0; k < RIM; k++) { const rr = (k % 2 === 0 ? 1 : 0.42) * size * 1.15, a = a0 + (k / RIM) * Math.PI * 2; star.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr)); }
      const edges: [THREE.Vector3, THREE.Vector3][] = world.map((p, k) => [p, world[(k + 1) % world.length]!]);
      ne += edges.length;
      this.shards.push({ c: cw, n: nrm, u, v, poly: rim, star, edges, d: cw.distanceTo(ip), seed: r() * 100, axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), fall: null });
    }
    // the pieces nearest the camera's line of sight fall at it and past it
    if (pass) {
      const dir = pass.look.clone().sub(pass.cam).normalize();
      const near = this.shards.map((sh, i) => [i, sh.c.clone().sub(pass.cam).normalize().dot(dir)] as [number, number]).sort((a, b) => b[1] - a[1]).slice(0, pass.n);
      near.forEach(([i], j) => {
        const side = new THREE.Vector3(Math.cos(j * 2.4), 0, Math.sin(j * 2.4)).multiplyScalar(1.2 + (j % 3) * 0.9);
        this.shards[i]!.fall = pass.cam.clone().add(side).add(new THREE.Vector3(0, -6, 0)).addScaledVector(dir, -4);
      });
    }
    // geometry: per shard a prism — front fan, back fan, side quads (RIM × 4 triangles), written every frame
    const nt = this.shards.length * RIM * 4;
    this.pos = new Float32Array(nt * 9);
    this.col = new Float32Array(nt * 9);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false }));
    this.mesh.frustumCulled = false;
    this.cracks = new GlowLines(ne * 4 + 8, 0.035);
    this.glints = new GlowPoints(this.shards.length * 6 + 16, 1);
    this.nEdges = ne;
    this.add(this.mesh, this.cracks, this.glints);
  }

  /**
   * t0 crack (the first crack at the impact), t1 the pieces come loose, t2 they are stars; then they rise.
   * `cam` for the glints; `gain` overall.
   */
  update(t: number, t0: number, t1: number, t2: number, cam: THREE.Camera, moonDir: THREE.Vector3, gain = 1) {
    const camPos = cam.position;
    const P = this.pos, C = this.col;
    let o = 0, ne = 0, ng = 0;
    const q = new THREE.Quaternion(), V = new THREE.Vector3(), N = new THREE.Vector3(), R = new THREE.Vector3(), view = new THREE.Vector3();
    const white = new THREE.Color(0.8, 0.9, 1.0), warm = new THREE.Color(1.0, 0.8, 0.5);
    const sky = [0.003, 0.0045, 0.01], edgeTint = [0.04, 0.1, 0.09];
    const fr: number[] = [], bk: number[] = [];
    // the light a glossy face of black glass shows: what it reflects (the sky, the city's glow, the moon)
    const shade = (n: THREE.Vector3, at: THREE.Vector3, out: number[], base: number[], k = 1) => {
      view.copy(at).sub(camPos).normalize();
      if (n.dot(view) > 0) N.copy(n).negate(); else N.copy(n);
      R.copy(view).reflect(N);
      const cosi = Math.max(0, -view.dot(N)), fres = 0.04 + 0.96 * Math.pow(1 - cosi, 5);
      const m = Math.max(0, R.dot(moonDir));
      const spec = Math.pow(m, 220) * 9 + Math.pow(m, 18) * 0.25;
      const env = R.y < 0 ? [0.018, 0.014, 0.013] : [0.008 + 0.012 * (1 - R.y), 0.011 + 0.012 * (1 - R.y), 0.022];
      out[0] = (base[0]! + (env[0]! * fres + spec * 0.85) * k); out[1] = (base[1]! + (env[1]! * fres + spec * 0.9) * k); out[2] = (base[2]! + (env[2]! * fres + spec) * k);
      return spec;
    };
    const put = (p: THREE.Vector3, c: number[]) => { P[o] = p.x; P[o + 1] = p.y; P[o + 2] = p.z; C[o] = c[0]! * gain; C[o + 1] = c[1]! * gain; C[o + 2] = c[2]! * gain; o += 3; };
    const ra: THREE.Vector3[] = [], rb: THREE.Vector3[] = [];
    for (const s of this.shards) {
      // the crack front reaches this piece; it comes loose a little after; it folds into a star (or falls)
      const front = t0 + Math.min(0.9, s.d / 90);
      const cr = clamp((t - front) / 0.12);
      if (cr <= 0) continue;
      const loose = ease.inOutCubic(clamp((t - (t1 + s.d / 160 + (s.seed % 1) * 0.25)) / 0.6));
      const morph = s.fall ? 0 : ease.inOutCubic(clamp((t - (t2 - 0.45 + (s.seed % 1) * 0.2 + s.d / 400)) / 0.5));
      const rise = Math.max(0, t - t2 - (s.seed % 1) * 0.2);
      let centre = this.flight(s, loose, s.fall ? 0 : rise);
      centre.addScaledVector(s.u, noise1(s.seed + t * 0.3, 1) * 1.5 * loose).addScaledVector(s.v, noise1(s.seed + t * 0.3, 2) * 1.5 * loose);
      let tumble = loose * (1 - morph) * (0.9 + 0.6 * Math.sin(s.seed)) * Math.min(1, Math.max(0, t - t1) * 0.8);
      let scale = 1;
      if (s.fall) {
        // a piece falling at the camera and past it, spinning
        const u = clamp((t - t1 - 0.15 - (s.seed % 1) * 0.3) / 1.4);
        if (u >= 1) continue;
        centre = centre.lerp(s.fall, ease.inQuad(u));
        tumble += u * u * 9;
        scale = 0.45;
      }
      q.setFromAxisAngle(s.axis, tumble * 1.2);
      q.premultiply(new THREE.Quaternion().setFromAxisAngle(s.n, morph * (t - t2) * 0.4));
      const shrink = (1 - 0.55 * clamp(rise / 2.5)) * (0.72 + 0.28 * (1 - morph)) * scale;
      const k = morph, thick = 0.45 * (1 - k) * scale;
      const fadeStar = 1 - clamp((rise - 1.6) / 0.6);
      const nrm = s.n.clone().applyQuaternion(q);
      // the face colours: black glass catching light → a warm star
      const spec = shade(nrm, centre, fr, sky, loose * 0.85 + 0.15);
      const starK = k * (0.5 + 0.2 * Math.sin(t * 3 + s.seed)) * fadeStar;
      const mix = (c: number[], sk: number, w: THREE.Color) => [c[0]! * (1 - k) + w.r * sk, c[1]! * (1 - k) + w.g * sk, c[2]! * (1 - k) + w.b * sk];
      const face = mix(fr, starK * 1.5, warm), rimC = mix(fr, starK * 0.6, warm);
      shade(nrm.clone().negate(), centre, bk, sky, loose);
      const back = mix(bk, starK * 0.8, warm);
      if (k > 0.98 && fadeStar <= 0) continue;
      ra.length = rb.length = 0;
      const off = nrm.clone().multiplyScalar(thick);
      for (let i = 0; i < RIM; i++) {
        const a = s.poly[i]!.clone().lerp(s.star[i]!, k).multiplyScalar(shrink);
        const p = V.copy(s.u).multiplyScalar(a.x).addScaledVector(s.v, a.y).applyQuaternion(q).add(centre);
        ra.push(p.clone().sub(off.clone().multiplyScalar(0.5))); rb.push(p.clone().add(off.clone().multiplyScalar(0.5)));
      }
      const ca = centre.clone().sub(off.clone().multiplyScalar(0.5)), cb = centre.clone().add(off.clone().multiplyScalar(0.5));
      // the lit edges: green-cyan glass, brighter where the moon grazes them, hot while the crack is fresh
      const fresh = Math.exp(-(t - front) * 5);
      for (let i = 0; i < RIM; i++) {
        const j = (i + 1) % RIM;
        put(ca, face); put(ra[i]!, rimC); put(ra[j]!, rimC);
        put(cb, back); put(rb[j]!, back); put(rb[i]!, back);
        const sideN = ra[j]!.clone().sub(ra[i]!).cross(nrm).normalize();
        const e: number[] = [0, 0, 0];
        const es = shade(sideN, ra[i]!, e, [edgeTint[0]! * 0.4, edgeTint[1]! * 0.4, edgeTint[2]! * 0.4], 1);
        const ek = 1 + 6 * es + 3 * fresh;
        const ec = mix([e[0]! * ek * 0.6 + edgeTint[0]! * loose, e[1]! * ek * 0.6 + edgeTint[1]! * loose, e[2]! * ek * 0.6 + edgeTint[2]! * loose], starK * 0.9, warm);
        put(ra[i]!, ec); put(rb[i]!, ec); put(rb[j]!, ec);
        put(ra[i]!, ec); put(rb[j]!, ec); put(ra[j]!, ec);
      }
      // the cracks: thin lines of split light along the cell's edges, glittering along their length
      const edgeK = cr * (1 - loose * 0.8) * (1 - k);
      if (edgeK > 0.01 && !s.fall) for (const [ea, eb] of s.edges) {
        if (ne >= this.cracks.n - 4) break;
        const fr2 = 1 + 3 * Math.exp(-(t - front) * 7);
        for (let m = 0; m < 4; m++) {
          const a = ea.clone().lerp(eb, m / 4).addScaledVector(s.n, -2.5 * loose - 0.05), b = ea.clone().lerp(eb, (m + 1) / 4).addScaledVector(s.n, -2.5 * loose - 0.05);
          const h = hash(s.seed, m, Math.floor(ea.x * 7));
          // refraction: each bit of a crack splits the moonlight into a different colour
          const hue = new THREE.Color().setHSL((h + 0.55) % 1, 0.55, 0.62);
          const sparkle = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(t * 9 + h * 40), 3);
          this.cracks.set(ne++, a, b, white.clone().lerp(hue, 0.6), edgeK * 0.85 * fr2 * sparkle * gain);
          if (m === 1 && sparkle > 0.8 && ng < this.glints.n - 4) this.glints.set(ng++, a.x, a.y, a.z, white.clone().lerp(hue, 0.4), edgeK * 0.9 * sparkle * gain, 1.4);
        }
      }
      if (k > 0.05) this.glints.set(ng++, centre.x, centre.y, centre.z, warm, k * 0.5 * gain * fadeStar, 5 * shrink + 4 * clamp(rise / 3));
      else if (spec * loose > 0.3) this.glints.set(ng++, centre.x, centre.y, centre.z, white, Math.min(2, spec * loose) * 0.6 * gain, 4 * scale);
    }
    // the impact: a white star of light where the first crack starts
    const ip = this.impactP;
    const ik = clamp((t - t0) / 0.05) * Math.exp(-Math.max(0, t - t0) * 2.5);
    if (ik > 0.01) { this.glints.set(ng++, ip.x, ip.y, ip.z, white, 2.5 * ik * gain, 7); this.glints.set(ng++, ip.x, ip.y, ip.z, white, 0.6 * ik * gain, 24); }
    const g = this.mesh.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, o / 3);
    this.cracks.commit(ne);
    this.glints.commit(ng);
    this.visible = t > t0 - 0.05;
  }

  /** A piece's centre: loose → a little toward the viewers; rising → up and out, spreading over the city. */
  private flight(s: Shard, loose: number, rise: number) {
    const out = s.c.clone().sub(this.o).setY(0);
    const spread = rise * rise * 4 + rise * 6;
    return s.c.clone().addScaledVector(s.n, -2.5 * loose).addScaledVector(out.normalize(), spread).add(new THREE.Vector3(0, rise * 9 + rise * rise * 14, 0));
  }
}

export { smoothstep };
