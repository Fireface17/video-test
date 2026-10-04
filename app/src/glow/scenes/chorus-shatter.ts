// Chorus B: "Every broken piece becomes a star / Look how beautiful we are".
// A mirror hangs in the dark; on "broken" it cracks and its pieces fly up, shrink and turn into stars;
// on the next line the stars gather into a constellation that spells "beautiful", lines drawing between them.
import * as THREE from 'three';
import type { Frame, SceneCtx } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { strokeText } from '../../engine/stroke';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { NeonLine } from '../lib/neon';
import { GlowPoints } from '../lib/points';
import { makeRT } from '../../engine/gl';
import { Dancers, Beams } from './chorus-dancers';

const MW = 4.6, MH = 2.9, MY = 0.75; // mirror size and centre height

interface Shard { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Vector3; ctr: THREE.Vector3; r: [number, number, number]; target: THREE.Vector3 | null; delay: number }

export class Shatter {
  st = new Stage(42, 0.1, 300);
  shards: Shard[] = [];
  geo = new THREE.BufferGeometry();
  pos!: Float32Array;
  colr!: Float32Array;
  edges!: THREE.LineSegments;
  epos!: Float32Array;
  frame = new THREE.Group();
  frameMat!: THREE.MeshBasicMaterial;
  stars!: GlowPoints;
  lines!: THREE.LineSegments;
  lpos!: Float32Array;
  segs: [number, number][] = [];
  dots!: GlowPoints;
  l10?: NeonLine;
  lookHow?: NeonLine;
  weAre?: NeonLine;
  tb = 0; // break time ("broken")
  // the reflection: what is in front of the mirror (dancers of light behind the camera, beams, the lyric),
  // rendered from the camera mirrored in the mirror's plane; each piece keeps its part when it flies
  reflRT = makeRT(960, 540);
  reflCam = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 300);
  texMatrix = new THREE.Matrix4();
  shardMesh!: THREE.Mesh;
  dancers!: Dancers;
  beams!: Beams;
  beautiful?: { start: number; end: number };

  constructor(private ctx: SceneCtx, private lines10: Line[], private n: number) {}

  async init() {
    const S = this.st;
    S.bg.copy(col('night'));
    S.fog(col('dusk', 0.5), 0.035);
    const [l10, l11] = this.lines10;
    const accent = col(this.n === 2 ? 'violet' : this.n === 3 ? 'gold' : 'cyan', 1);
    const starCol = col(this.n === 3 ? 'gold' : 'phosphor', 1);
    this.tb = l10?.words.find((w) => /broken/i.test(w.w))?.start ?? (l10?.start ?? 0) + 0.4;

    // shards: a jittered grid over the mirror, each cell split into two triangles
    const rnd = mulberry32(17 + this.n);
    const NX = 12, NY = 8;
    const grid: THREE.Vector3[][] = [];
    for (let j = 0; j <= NY; j++) {
      grid.push([]);
      for (let i = 0; i <= NX; i++) {
        const edge = i === 0 || j === 0 || i === NX || j === NY;
        const jx = edge ? 0 : (rnd() - 0.5) * 0.7, jy = edge ? 0 : (rnd() - 0.5) * 0.7;
        grid[j]!.push(new THREE.Vector3(((i + jx) / NX - 0.5) * MW, ((j + jy) / NY - 0.5) * MH + MY, 0));
      }
    }
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const p00 = grid[j]![i]!, p10 = grid[j]![i + 1]!, p01 = grid[j + 1]![i]!, p11 = grid[j + 1]![i + 1]!;
        const tris = rnd() < 0.5 ? [[p00, p10, p11], [p00, p11, p01]] : [[p00, p10, p01], [p10, p11, p01]];
        for (const [a, b, c] of tris) {
          const ctr = a!.clone().add(b!).add(c!).multiplyScalar(1 / 3);
          this.shards.push({ a: a!.clone(), b: b!.clone(), c: c!.clone(), ctr, r: [rnd(), rnd(), rnd()], target: null, delay: 0 });
        }
      }
    const N = this.shards.length;
    this.pos = new Float32Array(N * 9);
    this.colr = new Float32Array(N * 9);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colr, 3).setUsage(THREE.DynamicDrawUsage));
    const orig = new Float32Array(N * 9);
    this.shards.forEach((sh, i) => [sh.a, sh.b, sh.c].forEach((v, k) => orig.set([v.x, v.y, v.z], i * 9 + k * 3)));
    this.geo.setAttribute('orig', new THREE.BufferAttribute(orig, 3));
    const mesh = new THREE.Mesh(this.geo, new THREE.ShaderMaterial({
      side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { tRefl: { value: null }, texMatrix: { value: new THREE.Matrix4() }, reflK: { value: 1 } }]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        attribute vec3 color; attribute vec3 orig;
        uniform mat4 texMatrix;
        varying vec3 vC; varying vec4 vR;
        void main() {
          vC = color; vR = texMatrix * vec4(orig, 1.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform sampler2D tRefl; uniform float reflK;
        varying vec3 vC; varying vec4 vR;
        void main() {
          vec3 r = texture2D(tRefl, vR.xy / vR.w).rgb;
          gl_FragColor = vec4(vC + r * reflK * 0.8, 1.0);
          #include <fog_fragment>
        }`,
    }));
    mesh.frustumCulled = false;
    this.shardMesh = mesh;
    // the room in front of the mirror, behind the camera: only ever seen in the reflection
    const spots: { x: number; z: number }[] = [];
    for (let i = 0; i < 18; i++) spots.push({ x: (i / 17 - 0.5) * 16 + (i % 2 ? 0.6 : -0.6), z: 11 + (i % 3) * 1.8 });
    this.dancers = new Dancers(spots, [this.n === 2 ? 'violet' : this.n === 3 ? 'gold' : 'pink', 'cyan', 'phosphor'].map((k) => col(k, 1.3)));
    this.dancers.rotation.y = 0;
    this.beams = new Beams(5, ['pink', 'cyan', 'violet'].map((k) => col(k, 1)), 12);
    this.beams.position.z = 12;
    S.add(this.dancers, this.beams);
    const eg = new THREE.BufferGeometry();
    this.epos = new Float32Array(N * 18);
    eg.setAttribute('position', new THREE.BufferAttribute(this.epos, 3).setUsage(THREE.DynamicDrawUsage));
    this.edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: accent.clone().multiplyScalar(1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.edges.frustumCulled = false;
    // the frame
    this.frameMat = new THREE.MeshBasicMaterial({ color: accent.clone().multiplyScalar(1.8), fog: true });
    const th = 0.07;
    for (const [w, h, x, y] of [[MW + th * 2, th, 0, MH / 2 + th / 2], [MW + th * 2, th, 0, -MH / 2 - th / 2], [th, MH, -MW / 2 - th / 2, 0], [th, MH, MW / 2 + th / 2, 0]] as const) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, th), this.frameMat);
      m.position.set(x, y + MY, 0);
      this.frame.add(m);
    }
    // a thin wire to hang it from
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 6, 6), new THREE.MeshBasicMaterial({ color: col('ink', 0.6), fog: true }));
    wire.position.set(0, MY + MH / 2 + 3, 0);
    this.frame.add(wire);
    S.add(mesh, this.edges, this.frame);

    // constellation targets: "beautiful" in the script font, resampled along its strokes
    const bw = l11?.words.find((w) => /beautiful/i.test(w.w));
    if (bw) this.beautiful = { start: bw.start, end: bw.end };
    const st = strokeText('beautiful', 'script', 100);
    const size = 3.4, s = size / 100;
    const cx = -st.width * s / 2, cy = 3.6, cz = -3.5;
    const targets: THREE.Vector3[] = [];
    const spacing = 0.3;
    for (const stroke of st.strokes) {
      let acc = spacing, first = targets.length;
      for (let i = 0; i < stroke.length; i++) {
        const p = stroke[i]!, q = stroke[i - 1];
        if (q) acc += Math.hypot(p.x - q.x, p.y - q.y) * s;
        if (i === 0 || acc >= spacing || i === stroke.length - 1) {
          targets.push(new THREE.Vector3(cx + p.x * s, cy - p.y * s, cz));
          if (targets.length - 1 > first) this.segs.push([targets.length - 2, targets.length - 1]);
          acc = 0;
        }
      }
    }
    // shards nearest in x to each target fly there (keeps paths from crossing too much)
    const order = this.shards.map((_, i) => i).sort((a, b) => this.shards[a]!.ctr.x - this.shards[b]!.ctr.x);
    const tOrder = targets.map((_, i) => i).sort((a, b) => targets[a]!.x - targets[b]!.x);
    const take = Math.min(targets.length, N);
    for (let k = 0; k < take; k++) {
      const sh = this.shards[order[Math.floor((k * N) / take)]!]!;
      sh.target = targets[tOrder[k]!]!;
      sh.delay = (k / take) * 0.35;
    }
    // the shards keep their target index for the lines
    this.stars = new GlowPoints(N, 0.05);
    S.add(this.stars);
    const lg = new THREE.BufferGeometry();
    this.lpos = new Float32Array(this.segs.length * 6);
    lg.setAttribute('position', new THREE.BufferAttribute(this.lpos, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: starCol.clone().multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.lines.frustumCulled = false;
    S.add(this.lines);
    this.dots = new GlowPoints(this.segs.length * 6, 0.022);
    S.add(this.dots);
    (this as any).targets = targets;

    // lyrics
    if (l10) {
      this.l10 = new NeonLine(l10, [[0, 1, 2], [3, 4, 5]].map((r) => r.filter((i) => i < l10.words.length)), { font: 'script', size: 0.62, color: col('white', 1.8), leading: 0.62 });
      this.l10.position.set(0, MY - MH / 2 - 0.55, 0.35);
      S.add(this.l10);
    }
    if (l11) {
      const bi = l11.words.findIndex((w) => /beautiful/i.test(w.w));
      this.lookHow = new NeonLine(l11, [l11.words.map((_, i) => i).filter((i) => i < bi)], { font: 'script', size: 1.25, color: col('white', 2.2) });
      this.weAre = new NeonLine(l11, [l11.words.map((_, i) => i).filter((i) => i > bi)], { font: 'script', size: 1.25, color: col('white', 2.2) });
      this.lookHow.position.set(cx + 1.2, cy + 1.75, cz + 0.4);
      this.weAre.position.set(-cx - 1.0, cy - 2.6, cz + 0.4);
      S.add(this.lookHow, this.weAre);
    }
  }

  /** Where shard i is (centre) and how it is turned/scaled at time t. */
  private place(sh: Shard, t: number) {
    const dt = t - this.tb;
    const [ra, rb, rc] = sh.r;
    if (dt <= 0) return { p: sh.ctr.clone(), q: new THREE.Quaternion(), s: 1, star: 0 };
    const out = new THREE.Vector3(sh.ctr.x, sh.ctr.y - MY, 0).normalize();
    const v = new THREE.Vector3(out.x * (1.4 + 2.2 * ra), out.y * (1.0 + 1.5 * ra) + 0.7 + rb * 1.2, 1.2 + 2.6 * rc);
    const fly = (1 - Math.exp(-2.4 * dt)) / 2.4 * 2.6;
    let p = sh.ctr.clone().addScaledVector(v, fly).add(new THREE.Vector3(noise1(t * 0.4, ra * 50) * 0.3, 0.3 * dt, noise1(t * 0.4, rb * 50) * 0.2));
    // gather into the constellation
    if (sh.target && this.beautiful) {
      const g = ease.inOutCubic(clamp((t - (this.beautiful.start - 0.75 + sh.delay)) / 0.9, 0, 1));
      p = p.lerp(sh.target, g);
    }
    const axis = new THREE.Vector3(ra - 0.5, rb - 0.5, rc - 0.5).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, dt * (2.5 + 5 * rb) * Math.exp(-0.25 * dt));
    const s = lerp(1, 0.08, smoothstep(0.35, 1.5, dt));
    return { p, q, s, star: smoothstep(0.45, 1.4, dt) };
  }

  render(f: Frame, segStart: number, segEnd: number, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, n = this.n;
    const [l10, l11] = this.lines10;
    const accent = col(n === 2 ? 'violet' : n === 3 ? 'gold' : 'cyan', 1);
    const starCol = col(n === 3 ? 'gold' : 'phosphor', 1);
    const crack = pulse(t, this.tb, 0.12) * (t >= this.tb - 0.01 ? 1 : 0);
    const sheen = ((t * 0.35) % 3) - 1.5;
    const tmp = new THREE.Vector3();
    this.shards.forEach((sh, i) => {
      const { p, q, s, star } = this.place(sh, t);
      const vs = [sh.a, sh.b, sh.c].map((v) => tmp.copy(v).sub(sh.ctr).multiplyScalar(s).applyQuaternion(q).add(p).clone());
      const nrm = new THREE.Vector3().subVectors(vs[1]!, vs[0]!).cross(new THREE.Vector3().subVectors(vs[2]!, vs[0]!)).normalize();
      const glint = Math.pow(Math.abs(nrm.z), 24) * (t > this.tb ? 1 : 0);
      vs.forEach((v, k) => {
        this.pos.set([v.x, v.y, v.z], i * 9 + k * 3);
        // mirror: dark glass, a slow diagonal sheen, a glint when a flying piece faces the camera
        const ox = (k === 0 ? sh.a : k === 1 ? sh.b : sh.c);
        const d = (ox.x / MW + (ox.y - MY) / MH * 0.6) - sheen;
        const sh0 = Math.exp(-d * d * 40) * 0.42 + Math.exp(-d * d * 6) * 0.05;
        const base = 0.008 + 0.014 * ((ox.y - MY) / MH + 0.5);
        const fade = 1 - star;
        this.colr.set([
          (base * 0.7 + sh0 * 0.9) * fade + accent.r * (glint * 1.4 + crack * 0.15) + starCol.r * star * 1.2,
          (base * 0.8 + sh0 * 0.95) * fade + accent.g * (glint * 1.4 + crack * 0.15) + starCol.g * star * 1.2,
          (base * 1.3 + sh0) * fade + accent.b * (glint * 1.4 + crack * 0.15) + starCol.b * star * 1.2,
        ], i * 9 + k * 3);
      });
      // crack lines: the triangle edges, lit around the break
      const e = [vs[0]!, vs[1]!, vs[1]!, vs[2]!, vs[2]!, vs[0]!];
      e.forEach((v, k) => this.epos.set([v.x, v.y, v.z + 0.003], i * 18 + k * 3));
      // the star the piece becomes
      const tw = 0.75 + 0.25 * noise1(t * 3 + i, i);
      if (star > 0.01) this.stars.set(i, p.x, p.y, p.z, starCol, star * 2.2 * tw, 1.3 + 1.2 * sh.r[0]);
      else this.stars.hide(i);
    });
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.edges.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    const em = this.edges.material as THREE.LineBasicMaterial;
    em.opacity = clamp(crack * 0.8 + smoothstep(this.tb - 0.06, this.tb, t) * (1 - smoothstep(this.tb + 0.05, this.tb + 0.35, t)) * 0.5, 0, 1);
    this.edges.visible = em.opacity > 0.01;
    this.stars.commit();
    const frameK = t < this.tb ? 1 : 1 - smoothstep(this.tb + 0.2, this.tb + 1.6, t);
    this.frameMat.color.copy(accent).multiplyScalar(1.8 * frameK + 1.5 * crack);
    this.frame.visible = frameK > 0.01;

    // constellation lines draw in from "beautiful"
    const targets = (this as any).targets as THREE.Vector3[];
    const byTarget = new Map<THREE.Vector3, Shard>();
    for (const sh of this.shards) if (sh.target) byTarget.set(sh.target, sh);
    const draw = this.beautiful ? clamp((t - this.beautiful.start) / 0.9, 0, 1) : 0;
    const nDraw = Math.floor(draw * this.segs.length);
    this.segs.forEach(([a, b], k) => {
      const sa = byTarget.get(targets[a]!), sb = byTarget.get(targets[b]!);
      const pa = sa ? this.place(sa, t).p : targets[a]!, pb = sb ? this.place(sb, t).p : targets[b]!;
      const on = k < nDraw;
      this.lpos.set(on ? [pa.x, pa.y, pa.z, pb.x, pb.y, pb.z] : [0, 0, 0, 0, 0, 0], k * 6);
      for (let d = 0; d < 6; d++) {
        const u = (d + 0.5) / 6;
        if (on) this.dots.set(k * 6 + d, lerp(pa.x, pb.x, u), lerp(pa.y, pb.y, u), lerp(pa.z, pb.z, u), starCol, 1.1, 1);
        else this.dots.hide(k * 6 + d);
      }
    });
    this.dots.commit();
    (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.lines.visible = draw > 0;

    // lyrics
    if (this.l10 && l10) {
      this.l10.visible = !l11 || t < l11.start;
      this.l10.sing(t, 1 - smoothstep(l11 ? l11.start - 0.4 : segEnd, l11 ? l11.start : segEnd, t));
      // "broken" glitches as it breaks
      const bi = l10.words.findIndex((w) => /broken/i.test(w.w));
      const row = this.l10.rows.find((r) => r.ids.includes(bi));
      if (row && t > this.tb && t < this.tb + 0.35) row.sign.setLevel(row.ids.indexOf(bi), hash(Math.round(t * 60), 3) > 0.45 ? 1.6 : 0.1);
    }
    this.lookHow?.sing(t);
    this.weAre?.sing(t);

    // camera: facing the mirror, pulled back and up to the sky for the constellation
    const up = l11 ? ease.inOutCubic(prog(t, l11.start - 0.6, l11.start + 0.9)) : 0;
    const p = prog(t, segStart, segEnd);
    const side = n === 2 ? -1 : 1;
    const shake = crack;
    const pos = new THREE.Vector3(side * lerp(-0.6, 0.5, p) + noise1(t * 30, 4) * 0.08 * shake, lerp(lerp(0.3, 0.55, p), 0.4, up), lerp(lerp(8.2, 6.8, ease.outCubic(prog(t, segStart, this.tb))), 11.5, up) + smoothstep(this.tb, this.tb + 0.5, t) * 0.8 * (1 - up));
    const tgt = new THREE.Vector3(0, lerp(MY - 0.35, 3.3, up), lerp(0, -3.5, up));
    aim(S.cam, pos, tgt, noise1(t * 0.3, 9) * 0.03);
    // the reflection: mirror the camera in the plane z = 0, render everything but the glass
    const beat = this.ctx.audio.beatAt(t);
    this.dancers.pose(beat, 0.8, 1);
    this.dancers.spots.forEach((sp) => (sp.ry = Math.PI)); // facing the mirror
    this.beams.pose(beat, 0.8, 9);
    const reflOn = t < this.tb + 2.0;
    this.dancers.visible = this.beams.visible = reflOn;
    if (reflOn) {
      const cam = S.cam;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const mirror = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.y, -v.z);
      const target = cam.position.clone().add(fwd);
      aim(this.reflCam, mirror(cam.position), mirror(target), 0, mirror(camUp));
      this.reflCam.fov = cam.fov;
      this.reflCam.updateProjectionMatrix();
      this.shardMesh.visible = false;
      this.edges.visible = false;
      const r = this.ctx.renderer;
      r.setRenderTarget(this.reflRT);
      r.setClearColor(S.bg, 1);
      r.clear(true, true, true);
      r.render(S.scene, this.reflCam);
      this.shardMesh.visible = true;
      this.edges.visible = em.opacity > 0.01;
      this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(this.reflCam.projectionMatrix).multiply(this.reflCam.matrixWorldInverse);
    }
    const su = (this.shardMesh.material as THREE.ShaderMaterial).uniforms;
    su.tRefl!.value = this.reflRT.texture;
    (su.texMatrix!.value as THREE.Matrix4).copy(this.texMatrix);
    su.reflK!.value = reflOn ? 1 - smoothstep(this.tb + 0.3, this.tb + 1.6, t) : 0;
    this.dancers.visible = this.beams.visible = false; // (they only exist in the mirror)
    S.render(this.ctx.renderer, out);
    return { shake: [noise1(t * 50, 1) * 7 * shake, noise1(t * 50, 2) * 7 * shake] as [number, number], flash: crack * 0.08 };
  }
}
