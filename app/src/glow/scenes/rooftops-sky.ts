// Chorus 1, "Every broken piece becomes a star": the dark sky over the city is a pane of black glass; it cracks
// from a point above the two of them (bright cracks running outward), the pieces come loose, tumble (catching the
// moon and the city's glow on their faces), fold into five-pointed stars and rise. Built as a Voronoi tiling of
// a dome above the bridge; each piece is a fan of 10 triangles whose rim morphs from its cell's outline to a
// star's. "Look how beautiful we are" then has them as stars in the sky.
import * as THREE from 'three';
import { clamp, ease, mulberry32, noise1, smoothstep } from '../../engine/util';
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

  /** A dome of radius R around `o`, from elevation `el0` up; the cracks start above `impact` (a direction). */
  constructor(public o: THREE.Vector3, public R = 70, el0 = 0.42, n = 130, seed = 3, impact = new THREE.Vector3(0.1, 1, -0.2).normalize()) {
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
      this.shards.push({ c: cw, n: nrm, u, v, poly: rim, star, edges, d: cw.distanceTo(ip), seed: r() * 100, axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize() });
    }
    // geometry: per shard a fan of RIM triangles (centre + rim pairs), written every frame
    const nt = this.shards.length * RIM;
    this.pos = new Float32Array(nt * 9);
    this.col = new Float32Array(nt * 9);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.mesh.frustumCulled = false;
    this.cracks = new GlowLines(ne + 8, 0.06);
    this.glints = new GlowPoints(this.shards.length * 2, 1);
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
    const tmp = new THREE.Vector3(), q = new THREE.Quaternion(), V = new THREE.Vector3();
    const white = new THREE.Color(0.75, 0.85, 1.0), warm = new THREE.Color(1.0, 0.8, 0.5);
    for (const s of this.shards) {
      // the crack front reaches this piece; it comes loose a little after; it folds into a star
      const front = t0 + Math.min(0.9, s.d / 90);
      const cr = clamp((t - front) / 0.12);
      const loose = ease.inOutCubic(clamp((t - (t1 + s.d / 160 + (s.seed % 1) * 0.25)) / 0.6));
      const morph = ease.inOutCubic(clamp((t - (t2 - 0.45 + (s.seed % 1) * 0.2 + s.d / 400)) / 0.5));
      const rise = Math.max(0, t - t2 - (s.seed % 1) * 0.2);
      // motion: drop a little toward the viewers as it comes loose, tumble, then rise and spread out over the city
      const centre = this.flight(s, loose, rise);
      centre.addScaledVector(s.u, noise1(s.seed + t * 0.3, 1) * 1.5 * loose).addScaledVector(s.v, noise1(s.seed + t * 0.3, 2) * 1.5 * loose);
      const tumble = loose * (1 - morph) * (0.9 + 0.6 * Math.sin(s.seed)) * Math.min(1, (t - t1) * 0.8);
      q.setFromAxisAngle(s.axis, tumble * 1.2 + morph * 0.0);
      // the stars turn to face the city below (toward the dome centre) and slowly spin
      const spin = new THREE.Quaternion().setFromAxisAngle(s.n, morph * (t - t2) * 0.4);
      q.premultiply(spin);
      const shrink = (1 - 0.55 * clamp(rise / 2.5)) * 0.72;
      const k = morph;
      // colours: dark glass (only its glints) → bright star
      const nrm = s.n.clone().applyQuaternion(q);
      const view = tmp.copy(camPos).sub(centre).normalize();
      const refl = nrm.clone().reflect(view).multiplyScalar(-1);
      const glint = Math.pow(Math.max(0, refl.dot(moonDir)), 30) * 1.5 + 0.04 * Math.pow(1 - Math.abs(nrm.dot(view)), 3);
      const glass = (0.02 + glint) * loose * (1 - k);
      const starC = warm.clone().lerp(white, 0.1).multiplyScalar(k * (0.5 + 0.2 * Math.sin(t * 3 + s.seed)) * (1 - clamp((rise - 1.6) / 0.6)));
      const edgeK = cr * (1 - loose * 0.7) * (1 - k);
      for (let i = 0; i < RIM; i++) {
        const a = s.poly[i]!.clone().lerp(s.star[i]!, k).multiplyScalar(shrink), b = s.poly[(i + 1) % RIM]!.clone().lerp(s.star[(i + 1) % RIM]!, k).multiplyScalar(shrink);
        const pa = V.copy(s.u).multiplyScalar(a.x).addScaledVector(s.v, a.y).applyQuaternion(q).add(centre);
        P[o] = centre.x; P[o + 1] = centre.y; P[o + 2] = centre.z;
        P[o + 3] = pa.x; P[o + 4] = pa.y; P[o + 5] = pa.z;
        const pb = V.copy(s.u).multiplyScalar(b.x).addScaledVector(s.v, b.y).applyQuaternion(q).add(centre);
        P[o + 6] = pb.x; P[o + 7] = pb.y; P[o + 8] = pb.z;
        // the star is brighter at its heart, the glass at its rim
        const cc = starC.r * 1.4 + glass, rr = starC.r * 0.6 + glass * 1.6;
        C[o] = (starC.r * 1.4 + glass * 0.6) * gain; C[o + 1] = (starC.g * 1.4 + glass * 0.7) * gain; C[o + 2] = (starC.b * 1.4 + glass) * gain;
        for (const j of [3, 6]) { C[o + j] = (starC.r * 0.55 + glass * 1.4) * gain; C[o + j + 1] = (starC.g * 0.55 + glass * 1.5) * gain; C[o + j + 2] = (starC.b * 0.55 + glass * 1.8) * gain; }
        void cc; void rr;
        o += 9;
      }
      // the cracks along the cell's edges, white-hot as the front passes, then fading as the pieces part
      if (edgeK > 0.01) for (const [ea, eb] of s.edges) {
        if (ne >= this.nEdges) break;
        const fresh = 1 + 3 * Math.exp(-(t - front) * 8);
        this.cracks.set(ne++, ea.clone().addScaledVector(s.n, -2.5 * loose), eb.clone().addScaledVector(s.n, -2.5 * loose), white, edgeK * 0.55 * fresh * gain);
      }
      if (k > 0.05) this.glints.set(ng++, centre.x, centre.y, centre.z, warm, k * 0.5 * gain * (1 - clamp((rise - 1.6) / 0.6)), 5 * shrink + 4 * clamp(rise / 3));
      else if (glint * loose > 0.2) this.glints.set(ng++, centre.x, centre.y, centre.z, white, glint * loose * 0.5 * gain, 3);
    }
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
