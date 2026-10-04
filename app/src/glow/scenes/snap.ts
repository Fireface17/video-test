// `snap` — "Before the light" (pre-chorus 1 and the build before chorus 2). A glow stick only lights
// when you crack it: until the last beat everything here is unlit plastic, and the only light is the
// light painting its tip leaves in the air, word by word as the line is sung (kept modest, off to one
// side: the stick, the hand, the released sticks and the snap are the subject).
//  n = 1: a dark void with soft fog; a dark arm raises one unlit stick ("Put your hands up") and writes
//         each line of the pre-chorus in the upper left, the camera craning up from line to line.
//         "Tonight we let it all go": dozens of dim sticks drift up like released lanterns. "Turn the
//         pain into gold": a gold crack runs along the stick and "gold" is written in gold. "Here we go":
//         the camera pushes in on every beat while the stick bends; on the last beat it snaps — sparks,
//         the tube floods with light, white-out into the chorus.
//  n = 2: a crowd of silhouettes from behind and below, arms up with unlit sticks that sway and bend
//         faster and faster with the build; one of them writes "Oh, here we go, here we go" above the
//         heads; on the last beat every stick snaps at once.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { rtScale } from '../../engine/gl';
import { clamp, ease, hash, mulberry32, noise1, prog, pulse, smoothstep, springStep, TAU, frameIdx } from '../../engine/util';
import { Stage, aim, skyDome } from '../lib/stage';
import { col, STICKS } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { figureGeometry } from '../lib/shapes';
import { PenLine, TrailBatch } from './snap-trail';
import { FIST_WRIST, HeroStick, Limb, StickSwarm, fistGeometry, lightUniforms, silhouetteMaterial, writerBodyGeometry } from './snap-stick';

const STICK_L = 0.27; // hero stick length (m)
const STICK_R = 0.0125;

interface Written {
  pen: PenLine;
  color: THREE.Color;
  /** Word written in gold (-1: none). */
  gold: number;
  m: THREE.Matrix4;
  center: THREE.Vector3;
  /** When this line starts to fade (the next line's first word); 1e9 for the last. */
  tFade: number;
  /** Total drawn pieces (for the fill light: how much of the line is written). */
  total: number;
}

interface Lantern { x: number; z: number; y0: number; t0: number; v: number; s: number; rx: number; rz: number; spin: number; c: THREE.Color; dim: number; seed: number }
interface Fig { x: number; z: number; s: number; seed: number; ry: number; c: THREE.Color; v: number }

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const inOutSine = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x));

/** Two-bone IK: the elbow for a shoulder and a wrist (limbs stretch up to 30% when out of reach), bent toward `pole`. */
function elbowFor(sh: THREE.Vector3, wr: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3) {
  const d = wr.clone().sub(sh);
  const L = Math.max(1e-4, d.length());
  const s = clamp(L / (l1 + l2) / 0.98, 1, 1.3);
  l1 *= s; l2 *= s;
  const a = (l1 * l1 - l2 * l2 + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  d.multiplyScalar(1 / L);
  const pn = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
  return sh.clone().addScaledVector(d, a).addScaledVector(pn, h);
}

export default class Snap extends Scene {
  st = new Stage(35, 0.02, 300);
  n = 1;
  L = lightUniforms();
  trail = new TrailBatch(14000, { hot: 0.5, glowGain: 0.5 });
  lines: Written[] = [];
  beats: number[] = [];
  snapT = 0;
  em = 0.042;
  // the writer
  stick!: HeroStick;
  fist!: THREE.Mesh;
  fore!: Limb;
  upper!: Limb;
  silMat!: THREE.ShaderMaterial;
  head!: GlowPoints;
  sparks!: GlowPoints;
  dust!: GlowPoints;
  dustSeed: { x: number; y: number; z: number; p: number }[] = [];
  handOffset = new THREE.Vector3(0.1, -0.19, 0.035);
  // n = 1
  frames: THREE.Vector3[] = [];
  D = 0.68;
  lanterns?: StickSwarm;
  lantGlow?: GlowPoints;
  lant: Lantern[] = [];
  // n = 2
  crowd: THREE.InstancedMesh[] = [];
  figs: Fig[][] = [];
  crowdSticks?: StickSwarm;
  sky?: THREE.Mesh;
  body?: THREE.Mesh;
  writerAt = new THREE.Vector3();
  camA = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  camB = { pos: new THREE.Vector3(), tgt: new THREE.Vector3() };

  override async init() {
    const { params, audio, start, end } = this.ctx;
    this.n = params.n === 2 ? 2 : 1;
    this.beats = audio.beats.filter((b) => b >= start - 0.01 && b <= end + 0.01);
    this.snapT = end - (this.n === 2 ? 0.24 : 0.2);
    const S = this.st.scene;
    const fogCol = col('dusk', this.n === 1 ? 0.55 : 0.8);
    this.st.bg.copy(fogCol);
    this.L.uFogCol.value.copy(fogCol);
    this.L.uFogD.value = this.n === 1 ? 0.22 : 0.075;
    this.trail.mat.uniforms.fogD!.value = this.n === 1 ? 0.12 : 0.04;

    // the writer: stick, fist, forearm, upper arm
    this.silMat = silhouetteMaterial(this.L, new THREE.Color(0.0035, 0.004, 0.0075), 2.6, 0.35);
    this.stick = new HeroStick(STICK_L, STICK_R, col(this.n === 1 ? 'pink' : 'cyan'), this.L);
    this.fist = new THREE.Mesh(fistGeometry(STICK_R), this.silMat);
    this.fist.frustumCulled = false;
    this.fore = new Limb(0.037, 0.025, this.silMat);
    this.upper = new Limb(0.046, 0.04, this.silMat);
    S.add(this.stick, this.fist, this.fore, this.upper, this.trail.mesh);

    this.head = new GlowPoints(64, 1, { fogDensity: 0.1 });
    this.sparks = new GlowPoints(this.n === 1 ? 320 : 1800, 1, { fogDensity: 0.05 });
    this.dust = new GlowPoints(420, 1, { fogDensity: this.n === 1 ? 0.25 : 0.08 });
    const dr = mulberry32(17);
    for (let i = 0; i < this.dust.n; i++) this.dustSeed.push({ x: dr(), y: dr(), z: dr(), p: dr() });
    S.add(this.head, this.sparks, this.dust);

    if (this.n === 1) this.initN1();
    else this.initN2();
  }

  // ------------------------------------------------------------------ the lines
  /** A line in a single-stroke script, written by the pen; placed later (`place`) once its ink box is known. */
  private makeLine(l: Line, rows: number[][], color: THREE.Color, o: { gold?: number; endBy: number; size: number }) {
    const pen = new PenLine(l, { size: o.size, rows, leading: 0.92, stagger: 0.3, endBy: o.endBy, maxDur: [0.28, 0.1] });
    const w: Written = { pen, color, gold: o.gold ?? -1, m: new THREE.Matrix4(), center: new THREE.Vector3(), tFade: 1e9, total: pen.drawn.length };
    const prev = this.lines[this.lines.length - 1];
    if (prev) prev.tFade = l.words[0]!.start;
    this.lines.push(w);
    return w;
  }

  private place(w: Written, center: THREE.Vector3, rot = 0) {
    w.center.copy(center);
    w.m.compose(center, new THREE.Quaternion().setFromAxisAngle(Y, rot), new THREE.Vector3(1, 1, 1));
  }

  /** The pen enters line w from a world point (it waits there, then moves in over `approach` s). */
  private enter(w: Written, from: THREE.Vector3, approach: number, fn?: (u: number) => number) {
    const p = from.clone().applyMatrix4(w.m.clone().invert());
    w.pen.setFrom({ x: p.x, y: p.y }, approach, fn);
  }

  private tApproach(w: Written) { return w.pen.segs[1]!.t0; }

  /** World end point of a line (where its pen rests). */
  private lineEnd(w: Written) {
    const s = w.pen.segs[w.pen.segs.length - 1]!;
    return new THREE.Vector3(s.bx, s.by, 0).applyMatrix4(w.m);
  }

  /** The pen (world) at t, and which line it belongs to. */
  private penAt(t: number, out: THREE.Vector3): number {
    let i = 0;
    for (let k = this.lines.length - 1; k >= 0; k--) if (t >= this.tApproach(this.lines[k]!)) { i = k; break; }
    const w = this.lines[i]!;
    const h = w.pen.head(t);
    out.set(h.x, h.y, 0).applyMatrix4(w.m);
    return i;
  }

  // ------------------------------------------------------------------ n = 1
  private initN1() {
    const { lyrics, audio, start } = this.ctx;
    const S = this.st.scene;
    const L4 = lyrics.get('Put your hands up'), L5 = lyrics.get('Tonight we let it all go'), L6 = lyrics.get('Turn the pain into gold'), L7 = lyrics.get('Here we go, here we go');
    const cam = this.st.cam;
    const hh = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const Hp = 2 * this.D * hh, Wp = Hp * cam.aspect;
    const gap = 0.5; // the camera cranes up this much from line to line
    this.frames = [0, 1, 2, 3].map((i) => new THREE.Vector3(0, i * gap, 0));
    const fly = 0.22;
    const goldIdx = L6.words.findIndex((w) => /^gold/i.test(w.w));
    const a = this.makeLine(L4, [[0, 1, 2, 3], [4, 5, 6], [7, 8]], col('pink'), { endBy: L5.words[0]!.start - fly, size: this.em });
    const b = this.makeLine(L5, [[0, 1], [2, 3, 4, 5]], col('cyan'), { endBy: L6.words[0]!.start - fly, size: this.em });
    const c = this.makeLine(L6, [[0, 1, 2], [3, 4, 5]], col('violet', 1.1), { gold: goldIdx, endBy: L7.words[0]!.start - fly, size: this.em });
    const d = this.makeLine(L7, [[0, 1, 2], [3, 4, 5]], col('pink'), { endBy: this.snapT - 0.03, size: this.em });
    // blocks in the upper left of each frame (left edge, centre from the top, as fractions of the frame)
    const lay: [number, number][] = [[0.085, 0.36], [0.12, 0.33], [0.1, 0.34], [0.2, 0.33]];
    [a, b, c, d].forEach((w, i) => {
      const bw = w.pen.box.x1 - w.pen.box.x0;
      const [lx, ty] = lay[i]!;
      this.place(w, this.frames[i]!.clone().add(new THREE.Vector3((lx + bw / Wp / 2 - 0.5) * Wp, (0.5 - ty) * Hp, 0)));
    });
    // the hand swoops up into frame at the cut; then from line to line
    this.enter(a, this.frames[0]!.clone().add(new THREE.Vector3(0.1, -0.2, 0.03)), Math.max(0.3, L4.words[0]!.start - (start - 0.35)), ease.inOutCubic);
    [b, c, d].forEach((w, i) => {
      const prev = [a, b, c][i]!;
      this.enter(w, this.lineEnd(prev), clamp(w.pen.tStart - prev.pen.tEnd, 0.15, 0.6));
    });

    // released lanterns: small dim sticks let go on the beats of "Tonight we let it all go"
    const N = 34;
    this.lanterns = new StickSwarm(N, 0.15, 0.0085, this.L, { gripY: 0, radial: 10 });
    this.lantGlow = new GlowPoints(N, 1, { fogDensity: 0.2 });
    S.add(this.lanterns, this.lantGlow);
    const r = mulberry32(5);
    const b0 = Math.ceil(audio.beatAt(L5.words[0]!.start) - 0.05);
    for (let i = 0; i < N; i++) {
      const front = r() < 0.07;
      const z = front ? 0.25 + r() * 0.3 : -0.25 - Math.pow(r(), 0.7) * 3.6;
      const spread = 0.45 + Math.abs(z) * 0.6;
      let x = (r() * 2 - 1) * spread + 0.08;
      if (front && Math.abs(x) < 0.3) x = Math.sign(x || 1) * (0.3 + r() * 0.15);
      this.lant.push({
        x, z, y0: this.frames[1]!.y - 0.36 - r() * 0.3 - Math.abs(z) * 0.2,
        t0: audio.timeOfBeat(b0 + Math.floor(i / 3) * 0.5 + (i % 3) * 0.13 + r() * 0.06),
        v: 0.3 + r() * 0.22, s: 0.85 + r() * 0.4, rx: (r() * 2 - 1) * 0.7, rz: (r() * 2 - 1) * 0.9, spin: (r() * 2 - 1) * 1.2,
        c: col(STICKS[Math.floor(r() * 4)]!), dim: 0.08 + r() * 0.14, seed: r(),
      });
    }
  }

  // ------------------------------------------------------------------ n = 2
  private initN2() {
    const { lyrics } = this.ctx;
    const S = this.st.scene;
    const cam = this.st.cam;
    cam.fov = 40;
    cam.updateProjectionMatrix();
    // camera: low behind the crowd, creeping in and up through the build; B is the framing for the line
    this.camA.pos.set(0.35, 0.92, 5.0); this.camA.tgt.set(0.1, 2.6, -8);
    this.camB.pos.set(0.15, 1.18, 2.5); this.camB.tgt.set(-0.05, 3.25, -6);
    // a dark hall: haze far ahead (the stage side), nothing else lit
    this.sky = skyDome(col('night'), col('dusk', 1.6), col('night', 0.6), 120);
    (this.sky.material as THREE.ShaderMaterial).uniforms.glowDir!.value.set(0, 0.1, -1).normalize();
    S.add(this.sky);

    // the line, written above the heads in the upper left of the final framing, by a front-row figure
    const L22 = lyrics.get('Oh, here we go, here we go');
    const w = this.makeLine(L22, [[0, 1, 2, 3], [4, 5, 6]], col('cyan'), { endBy: this.snapT - 0.03, size: 0.15 });
    aim(cam, this.camB.pos, this.camB.tgt);
    const zText = -0.3;
    const at = (sx: number, sy: number) => {
      // screen fractions (0..1 from the left / top) -> point on the plane z = zText
      const p = new THREE.Vector3(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam);
      const dir = p.sub(cam.position).normalize();
      return cam.position.clone().addScaledVector(dir, (zText - cam.position.z) / dir.z);
    };
    const bw = w.pen.box.x1 - w.pen.box.x0;
    const frac = (bw / at(0.9, 0.27).distanceTo(at(0.1, 0.27))) * 0.8; // block width as a fraction of the frame width
    this.place(w, at(0.13 + frac / 2, 0.25));
    // the writer stands below and right of the block, facing the stage
    this.writerAt.set(w.center.x + bw * 0.42, 0, zText + 0.32);
    this.body = new THREE.Mesh(writerBodyGeometry(0.88), this.silMat);
    this.body.rotation.y = Math.PI;
    this.body.scale.setScalar(1.1);
    this.body.frustumCulled = false;
    S.add(this.body);
    this.handOffset.set(0.05, -0.21, 0.07);
    this.enter(w, this.writerShoulder(0).add(new THREE.Vector3(-0.08, 0.66, -0.1)), 0.5);

    // the crowd: rows of figures from behind, arms up
    const r = mulberry32(23);
    const geos = [figureGeometry(0.93), figureGeometry(1.0), figureGeometry(0.86)];
    const rows: Fig[][] = [[], [], []];
    for (let j = 0; j < 14; j++) {
      const z = -0.9 - j * 1.0 - r() * 0.3;
      const half = 2.2 + (-z) * 0.8;
      for (let x = -half + r() * 0.5; x < half; x += 0.72 + r() * 0.35) {
        const g = Math.floor(r() * 3);
        const fx = x + (r() - 0.5) * 0.2, fz = z + (r() - 0.5) * 0.35;
        const keep = Math.hypot(fx - this.writerAt.x, fz - this.writerAt.z) >= 0.8;
        const fig = { x: fx, z: fz, s: 0.92 + r() * 0.16, seed: r(), ry: Math.PI + (r() - 0.5) * 0.5, c: col(STICKS[Math.floor(r() * 4)]!), v: r() };
        if (keep) rows[g]!.push(fig);
      }
    }
    const crowdMat = silhouetteMaterial(this.L, new THREE.Color(0.0016, 0.0018, 0.004), 4.5, 0.6);
    for (const m of [this.body, this.fist, this.fore.body, this.fore.ballA, this.upper.body, this.upper.ballA]) m.material = crowdMat;
    rows.forEach((figs, g) => {
      const im = new THREE.InstancedMesh(geos[g]!, crowdMat, figs.length);
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.crowd.push(im);
      this.figs.push(figs);
      S.add(im);
    });
    const total = rows.reduce((s, f) => s + f.length, 0);
    this.crowdSticks = new StickSwarm(total, 0.3, 0.014, this.L, { gripY: -0.1, radial: 8 });
    this.crowdSticks.u.uCapDim.value = 0.12;
    S.add(this.crowdSticks);
  }

  /** The n = 2 writer's right shoulder (world); `lean` shifts the body toward the pen. */
  private writerShoulder(lean: number) {
    return new THREE.Vector3(this.writerAt.x + 0.26 + lean, 1.52, this.writerAt.z);
  }

  // ------------------------------------------------------------------ the writer (arm + stick + pen)
  /** Where the pen is, the lagging hand anchor, and the stick's chord direction (camera-independent). */
  private penPose(t: number) {
    const pen = new THREE.Vector3();
    const li = this.penAt(t, pen);
    // the hand lags the pen (the wrist does the fine motion)
    const anchor = new THREE.Vector3();
    let ws = 0;
    for (let k = 0; k < 8; k++) {
      const w = 1 - k / 9;
      this.penAt(t - k * 0.045, _v);
      anchor.addScaledVector(_v, w);
      ws += w;
    }
    anchor.multiplyScalar(1 / ws).add(this.handOffset);
    const u = pen.clone().sub(anchor).normalize();
    return { pen, anchor, u, li };
  }

  /** Pose stick, fist and arm (after the camera is placed: the stick turns its crack side to it). */
  private poseWriter(pp: { pen: THREE.Vector3; u: THREE.Vector3; anchor: THREE.Vector3 }, bend: number, kink: number, shoulder?: THREE.Vector3) {
    const cam = this.st.cam;
    const { pen, u } = pp;
    const toCam = cam.position.clone().sub(pen).normalize();
    const zA = toCam.clone().addScaledVector(u, -toCam.dot(u)).normalize();
    const xA = new THREE.Vector3().crossVectors(u, zA);
    const qChord = new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(xA, u, zA));
    const su = this.stick.u;
    su.uBend.value = bend;
    su.uKink.value = kink;
    const [bx, by] = this.stick.center(STICK_L / 2);
    const gy = su.uGripY.value;
    const alpha = Math.atan2(bx, by - gy);
    const qStick = qChord.clone().multiply(_q.setFromAxisAngle(Z, alpha));
    const chord = Math.hypot(bx, by - gy);
    const fist = pen.clone().addScaledVector(u, -chord);
    this.stick.quaternion.copy(qStick);
    this.stick.position.copy(fist).sub(new THREE.Vector3(0, gy, 0).applyQuaternion(qStick));
    this.fist.quaternion.copy(qStick);
    this.fist.position.copy(fist);
    const wrist = FIST_WRIST.clone().applyQuaternion(this.fist.quaternion).add(fist);
    // shoulder below the frame (n = 1) or the writer's (n = 2); the elbow bends down and out
    const sh = shoulder ?? pp.anchor.clone().add(new THREE.Vector3(0.16, -0.44, 0.12));
    const elbow = elbowFor(sh, wrist, 0.3, 0.28, new THREE.Vector3(0.75, -0.45, 0.15));
    this.fore.span(elbow, wrist);
    this.upper.span(sh, elbow);
    return { pen, fist };
  }

  /** World position of the stick's kink (the crack) as posed. */
  private kinkPoint() {
    const c = this.stick.center(this.stick.u.uKinkY.value);
    return new THREE.Vector3(c[0], c[1], 0).applyQuaternion(this.stick.quaternion).add(this.stick.position);
  }

  /** Trail of every line (fading after the next line starts); sets the fill light from the newest one. */
  private drawTrails(t: number, gain = 1) {
    const goldC = col('gold', 1.15);
    const fill = this.L.uFillCol.value.setRGB(0, 0, 0);
    for (const w of this.lines) {
      if (t < w.pen.tStart) continue;
      const fade = gain * (1 - 0.72 * smoothstep(w.tFade, w.tFade + 0.7, t)) * (1 - smoothstep(w.tFade + 0.7, w.tFade + 3.5, t));
      if (fade < 0.01) continue;
      const e = w.m.elements;
      const c = w.color;
      const sz = w.pen.size;
      let n = 0;
      w.pen.emit(t, (ax, ay, bx, by, age, word) => {
        n++;
        const cc = word === w.gold ? goldC : c;
        const hot = Math.exp(-age / 0.16);
        const tex = 0.88 + 0.12 * noise1(((ax + ay) * 5) / sz, word);
        const k = fade * (1.7 + 2.6 * hot) * tex;
        this.trail.seg(
          e[0]! * ax + e[4]! * ay + e[12]!, e[1]! * ax + e[5]! * ay + e[13]!, e[2]! * ax + e[6]! * ay + e[14]!,
          e[0]! * bx + e[4]! * by + e[12]!, e[1]! * bx + e[5]! * by + e[13]!, e[2]! * bx + e[6]! * by + e[14]!,
          sz * 0.045 * (1 + 0.5 * hot), sz * 0.16, cc.r * k, cc.g * k, cc.b * k,
        );
      });
      if (fade > 0.05 && n > 0) {
        const k = (n / Math.max(1, w.total)) * fade * 0.55;
        fill.r += c.r * k; fill.g += c.g * k; fill.b += c.b * k;
        this.L.uFillPos.value.copy(w.center).add(_v.set(0, 0, 0.05));
      }
    }
  }

  /** The glowing head at the stick's tip, its light on the scene, sputtering sparks while it writes. */
  private drawHead(t: number, pen: THREE.Vector3, li: number, k0: number) {
    const w = this.lines[li]!;
    const writing = w.pen.wordWin.reduce((m, [a, b]) => Math.max(m, Math.min(smoothstep(a - 0.04, a, t), 1 - smoothstep(b, b + 0.08, t))), 0);
    const word = w.pen.wordAt(t);
    const c = word >= 0 && word === w.gold && writing > 0.3 ? col('gold', 1.15) : w.color;
    const k = k0 * (0.3 + 0.7 * writing);
    const sz = w.pen.size / 0.09;
    this.L.uLightPos.value.copy(pen);
    this.L.uLightCol.value.copy(c).multiplyScalar(2.2 * k);
    const fl = 0.9 + 0.1 * hash(frameIdx(t), 3);
    this.head.set(0, pen.x, pen.y, pen.z, [1, 1, 1], 2.4 * k * fl, 0.011 * sz);
    this.head.set(1, pen.x, pen.y, pen.z, c, 1.6 * k * fl, 0.03 * sz);
    this.head.set(2, pen.x, pen.y, pen.z, c, 0.22 * k, 0.11 * sz);
    const fc = this.L.uFillCol.value, fp = this.L.uFillPos.value;
    this.head.set(3, pen.x, pen.y, pen.z - 0.05, c, 0.035 * k, 0.55 * sz);
    this.head.set(4, fp.x, fp.y, fp.z - 0.1, [fc.r, fc.g, fc.b], 0.16, 1.1 * sz);
    // sputter: particles born at fixed times along the pen path
    const rate = 70, life = 0.42, n0 = Math.floor((t - life) * rate), n1 = Math.floor(t * rate);
    let j = 5;
    for (let nn = n0; nn <= n1 && j < this.head.n; nn++) {
      const tb = nn / rate, age = t - tb;
      if (age < 0) continue;
      const lw = this.lines[this.penAt(tb, _v)]!;
      if (!lw.pen.writing(tb) || hash(nn, 11) > 0.7) continue;
      const lf = life * (0.4 + 0.6 * hash(nn, 12));
      if (age > lf) continue;
      const a = hash(nn, 13) * TAU, sp = (0.25 + hash(nn, 14) * 0.5) * sz;
      const x = _v.x + Math.cos(a) * sp * age, y = _v.y + Math.sin(a) * sp * age * 0.6 - 1.6 * sz * age * age, z = _v.z + (hash(nn, 15) - 0.5) * sp * age;
      const kk = 1 - age / lf;
      this.head.set(j++, x, y, z, lw.color, 1.8 * kk * kk * k0, 0.006 * sz);
    }
    for (; j < this.head.n; j++) this.head.hide(j);
    this.head.commit();
  }

  /** Burst of sparks from `o` starting at t0 (written into this.sparks from index i0). */
  private burst(t: number, t0: number, o: THREE.Vector3, i0: number, n: number, seed: number, c: THREE.Color, speed: number, size = 0.006) {
    const age = t - t0;
    for (let i = 0; i < n; i++) {
      const idx = i0 + i;
      if (idx >= this.sparks.n) return;
      if (age < 0) { this.sparks.hide(idx); continue; }
      const life = 0.25 + 0.7 * hash(i, seed + 3);
      if (age > life) { this.sparks.hide(idx); continue; }
      const th = hash(i, seed) * TAU, cz = hash(i, seed + 1) * 2 - 1, sz = Math.sqrt(1 - cz * cz);
      const v = speed * (0.25 + 0.75 * Math.sqrt(hash(i, seed + 2)));
      const drag = 3.2, d = (1 - Math.exp(-drag * age)) / drag;
      const x = o.x + Math.cos(th) * sz * v * d, y = o.y + Math.sin(th) * sz * v * d - 1.2 * age * age, z = o.z + cz * v * d;
      const k = Math.pow(1 - age / life, 1.5) * this.lensFade(x, y, z);
      const white = hash(i, seed + 4) < 0.35;
      this.sparks.set(idx, x, y, z, white ? [1, 0.95, 0.85] : c, (white ? 3.5 : 2.6) * k, size * (0.6 + 0.8 * hash(i, seed + 5)));
    }
  }

  /** Point sprites grow without limit near the lens: fade them out there. */
  private lensFade(x: number, y: number, z: number) {
    const cp = this.st.cam.position;
    return smoothstep(0.2, 0.45, Math.hypot(x - cp.x, y - cp.y, z - cp.z));
  }

  private drawDust(t: number, center: THREE.Vector3, sx: number, sy: number, sz: number, base: number) {
    const lp = this.L.uLightPos.value, lc = this.L.uLightCol.value;
    for (let i = 0; i < this.dust.n; i++) {
      const d = this.dustSeed[i]!;
      const x = center.x + (d.x - 0.5) * sx + noise1(t * 0.12 + d.p * 50, i) * 0.15;
      const y = center.y + (((d.y + t * 0.012 * (0.5 + d.p)) % 1) - 0.5) * sy;
      const z = center.z + (d.z - 0.5) * sz + noise1(t * 0.1 + d.p * 30, i + 7) * 0.15;
      const dd = (x - lp.x) ** 2 + (y - lp.y) ** 2 + (z - lp.z) ** 2;
      const near = 0.05 / (0.05 + dd);
      const lens = this.lensFade(x, y, z);
      this.dust.set(i, x, y, z, [0.6 + lc.r * near * 1.2, 0.65 + lc.g * near * 1.2, 0.9 + lc.b * near * 1.2], (base * (0.4 + 0.6 * d.p) + near * 0.5) * lens, 0.0035 + d.p * 0.004);
    }
    this.dust.commit();
  }

  // ------------------------------------------------------------------ render
  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    this.trail.begin();
    const post = this.n === 1 ? this.renderN1(t) : this.renderN2(t);
    this.trail.commit(rtScale(out));
    this.st.render(this.ctx.renderer, out);
    return post;
  }

  /** Bend of the hero stick: steps up on every beat from `from` to the snap (tension), springy. */
  private tension(t: number, from: number) {
    let k = 0, n = 0;
    for (const b of this.beats) {
      if (b < from - 0.05 || b > this.snapT) continue;
      n++;
      if (t >= b) k = n - 1 + springStep(t - b, 3.2, 0.32);
    }
    return { k, n };
  }

  /** The white-out into the chorus (and the snap's pop), common to both entries. */
  private snapPost(t: number, sn: number, extra: PostOverrides = {}): PostOverrides {
    const { end } = this.ctx;
    // white-out peaking on the cut (the entry is still drawn under the next one's 'light' transition after it)
    const flash = t <= end ? 1.8 * ease.inCubic(prog(t, end - 0.15, end)) : 1.8 * Math.exp(-(t - end) / 0.03);
    return {
      bloom: 0.95 + (sn > 0 ? 0.35 : 0), bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.14, vignette: 0.5, grain: 0.05, ca: 0.8,
      flash, exposure: 1 + (sn > 0 ? 0.25 * prog(sn, 0, 0.16) : 0),
      shake: sn > 0 ? [Math.exp(-sn * 10) * 6 * (hash(frameIdx(t), 4) - 0.5), Math.exp(-sn * 10) * 6 * (hash(frameIdx(t), 5) - 0.5)] : [0, 0],
      ...extra,
    };
  }

  private renderN1(t: number): PostOverrides {
    const { audio, start, end } = this.ctx;
    const ls = this.lines;
    const L7 = ls[3]!;
    // ---- tension and snap
    const tens = this.tension(t, L7.pen.tStart - 0.05);
    const bend = (tens.k / Math.max(1, tens.n)) * 3.4;
    const sn = t - this.snapT;
    const kink = sn > 0 ? 0.75 * springStep(sn, 7, 0.45) : 0;
    const su = this.stick.u;
    su.uTime.value = t;
    su.uFlood.value = sn > 0 ? 1.4 : 0;
    su.uFloodR.value = sn > 0 ? STICK_L * 1.2 * ease.outQuad(clamp(sn / 0.09)) : 0;
    su.uStress.value = 0.1 * (tens.k / Math.max(1, tens.n)) * (1 + 1.5 * audio.hit('kick', t, 0.1)) + (sn > -0.25 && sn < 0 ? 0.6 * prog(sn, -0.25, 0, ease.inQuad) : 0);
    // gold crack along the stick, from "pain" to "gold"
    const L6 = ls[2]!.pen.line;
    const wPain = L6.words.find((w) => /^pain/i.test(w.w)) ?? L6.words[2]!;
    const wGold = L6.words[ls[2]!.gold] ?? L6.words[4]!;
    su.uCrack.value = prog(t, wPain.start, wGold.start + 0.3, inOutSine);
    su.uGold.value = 0.75 + 0.25 * noise1(t * 4, 2) + 0.6 * pulse(t, wGold.start, 0.25) + 0.25 * audio.hit('kick', t, 0.12) * smoothstep(wGold.start, wGold.start + 0.5, t);

    // ---- the pen and the hand (camera-independent), then the camera
    const pp = this.penPose(t);
    const kpEst = pp.pen.clone().addScaledVector(pp.u, -STICK_L * 0.42);
    const cam = this.st.cam;
    const fr = (i: number) => ({ pos: this.frames[i]!.clone().add(new THREE.Vector3(0.04, -0.05, this.D)), tgt: this.frames[i]!.clone().add(new THREE.Vector3(0, -0.01, 0)) });
    const { pos, tgt } = fr(0);
    for (let i = 1; i < ls.length; i++) {
      const w = ls[i]!;
      const k = prog(t, this.tApproach(w) - 0.06, w.pen.tStart + 0.24, ease.inOutCubic);
      if (k <= 0) break;
      const g = fr(i);
      pos.lerp(g.pos, k);
      tgt.lerp(g.tgt, k);
    }
    // opening: the camera rises with the hand
    const open = prog(t, start - 0.35, ls[0]!.pen.tStart + 0.6, ease.inOutCubic);
    pos.y -= (1 - open) * 0.1;
    pos.z += (1 - open) * 0.08;
    tgt.y -= (1 - open) * 0.05;
    // "Here we go": a push on every beat toward the stick, then a last rush into the snap
    const focus = tgt.clone().lerp(kpEst, 0.5);
    const push = clamp(tens.k * 0.035, 0, 0.22);
    pos.lerp(focus, push);
    tgt.lerp(focus, push * 1.5);
    const rush = ease.inOutCubic(prog(t, this.snapT - 0.1, end));
    pos.lerp(kpEst, rush * 0.14);
    tgt.lerp(kpEst, rush * 0.3);
    // handheld drift
    pos.x += noise1(t * 0.35, 1) * 0.01; pos.y += noise1(t * 0.31, 2) * 0.008;
    tgt.x += noise1(t * 0.27, 3) * 0.006;
    aim(cam, pos, tgt, noise1(t * 0.2, 5) * 0.02 - tens.k * 0.004);

    // ---- writer
    const { pen } = this.poseWriter(pp, bend, kink);
    this.drawTrails(t);
    this.drawHead(t, pen, pp.li, sn > 0 ? Math.max(0, 1 - sn / 0.05) : 1);
    this.L.uRimCol.value.copy(col('dusk', 0.9)).lerp(col('blue', 0.08), 0.5);
    this.L.uRimDir.value.set(-0.3, 0.6, -0.7).normalize();
    if (sn > 0) {
      // the snap lights everything
      const kp = this.kinkPoint();
      this.L.uLightPos.value.copy(kp);
      this.L.uLightCol.value.copy(su.uColor.value).multiplyScalar(6 * Math.min(1, sn / 0.04));
      this.burst(t, this.snapT, kp, 0, 220, 7, col('pink', 1.2), 2.2);
      this.burst(t, this.snapT + 0.012, kp, 220, 100, 9, col('gold', 1.1), 1.4, 0.004);
    } else for (let i = 0; i < this.sparks.n; i++) this.sparks.hide(i);
    this.sparks.commit();

    // ---- lanterns
    const lan = this.lanterns!;
    let j = 0;
    for (const l of this.lant) {
      const a = t - l.t0;
      if (a < -0.01) continue;
      const rise = l.v * a + 0.22 * (1 - Math.exp(-a * 3));
      const x = l.x + noise1(t * 0.3 + l.seed * 20, 4) * 0.1 + Math.sin(a * 0.8 + l.seed * 6) * 0.03;
      const y = l.y0 + rise;
      const z = l.z + noise1(t * 0.25 + l.seed * 20, 9) * 0.1;
      _q.setFromEuler(new THREE.Euler(l.rx + Math.sin(a * 0.9 + l.seed * 5) * 0.2, a * l.spin, l.rz + a * l.spin * 0.35));
      _m.compose(_w.set(x, y, z), _q, _v.setScalar(l.s));
      const flick = 0.85 + 0.3 * audio.hit('kick', t, 0.12) * (l.seed > 0.5 ? 1 : 0.4);
      const on = l.dim * flick * Math.min(1, a / 0.3 + 0.2) * (1 - smoothstep(3, 6, a));
      lan.setStick(j, _m, 0, 0, on, l.seed, l.c);
      this.lantGlow!.set(j, x, y, z, l.c, on * 0.7 * this.lensFade(x, y, z), 0.16 * l.s);
      j++;
    }
    lan.commit(j);
    for (let i = j; i < this.lantGlow!.n; i++) this.lantGlow!.hide(i);
    this.lantGlow!.commit();
    lan.u.uTime.value = t;

    // ---- dust
    this.drawDust(t, new THREE.Vector3(pos.x, pos.y, 0), 3.2, 2.2, 3.2, 0.05);

    return this.snapPost(t, sn);
  }

  private renderN2(t: number): PostOverrides {
    const { audio, start, end } = this.ctx;
    const w = this.lines[0]!;
    const sn = t - this.snapT;
    const b0 = audio.beatAt(start);
    const b = audio.beatAt(t) - b0; // beats into the build
    const nb = audio.beatAt(end) - b0;
    const build = clamp(b / nb);
    // sway rates (cycles per beat) double every two bars: phases are their integrals
    const integ = (seg: readonly (readonly [number, number])[]) => {
      let ph = 0;
      for (let i = 0; i < seg.length; i++) {
        const [s0, r] = seg[i]!;
        const s1 = seg[i + 1]?.[0] ?? 1e9;
        if (b > s0) ph += (Math.min(b, s1) - s0) * r;
      }
      return ph;
    };
    const phase = integ([[0, 0.25], [8, 0.5], [16, 1]]); // bodies
    const sphase = integ([[0, 0.5], [8, 1], [16, 2]]); // sticks (wrists)
    const snare = audio.hit('snare', t, 0.09), kick = audio.hit('kick', t, 0.12);
    const kinkAll = sn > 0 ? 0.8 * springStep(sn, 7, 0.45) : 0;
    // waves of faint light run through the sticks from the back rows to the front: on the beats, then the 8ths
    const rate = b >= 16 ? 2 : 1;
    const wi = Math.floor(b * rate);
    const waves = [wi, wi - 1].map((k) => t - audio.timeOfBeat(b0 + k / rate)).filter((age) => age >= 0 && age < 0.6);
    const amp = (0.03 + 0.22 * build * build) * (sn > 0 ? 0 : 1);

    // ---- camera: low behind the crowd, creeping forward and up until the line, then pushing on beats
    const cam = this.st.cam;
    const kc = inOutSine(prog(t, start, this.tApproach(w) - 0.2));
    const pos = this.camA.pos.clone().lerp(this.camB.pos, kc);
    const tgt = this.camA.tgt.clone().lerp(this.camB.tgt, kc);
    pos.x += noise1(t * 0.3, 1) * 0.03; pos.y += noise1(t * 0.27, 2) * 0.015;
    const jolt = audio.downbeats.reduce((m, d) => (d >= start - 0.01 && d <= t ? Math.max(m, pulse(t, d, 0.12)) : m), 0);
    pos.y += jolt * 0.02 * (0.4 + build);
    const tens = this.tension(t, w.pen.tStart - 0.05);
    pos.lerp(tgt, tens.k * 0.004 + ease.inOutCubic(prog(t, this.snapT - 0.1, end)) * 0.03);
    aim(cam, pos, tgt, Math.sin(phase * TAU * 0.5) * 0.012 * build + noise1(t * 0.2, 6) * 0.015);

    // ---- haze ahead breathes with the kick, brighter as the build rises
    const haze = 0.4 + 0.6 * build;
    const skyU = (this.sky!.material as THREE.ShaderMaterial).uniforms;
    (skyU.glow!.value as THREE.Color).copy(col('violet', 0.09 * haze * (0.55 + 0.75 * kick))).lerp(col('blue', 0.08 * haze), 0.4);
    this.L.uRimCol.value.copy(col('violet', 0.12 * haze * (0.55 + 0.7 * kick + 0.3 * snare * build))).lerp(col('cyan', 0.07 * haze), 0.3);
    this.L.uRimDir.value.set(0, 0.55, -1).normalize();
    this.L.uFogCol.value.copy(col('dusk', 0.85)).lerp(col('violet', 0.06), 0.3 * haze * (0.6 + 0.4 * kick));
    this.st.bg.copy(this.L.uFogCol.value);

    // ---- the crowd
    const sticks = this.crowdSticks!;
    let si = 0;
    const handL = new THREE.Vector3(-0.39, 2.0, 0); // right hand of figureGeometry (facing +z, its right is -x)
    this.crowd.forEach((im, g) => {
      const figs = this.figs[g]!;
      figs.forEach((fg, i) => {
        const sway = Math.sin((phase + fg.seed * 0.35) * TAU) * (0.04 + 0.06 * build) * (0.7 + 0.6 * fg.v);
        const bounce = Math.pow(Math.abs(Math.sin(Math.PI * (b + fg.seed * 0.15))), 2) * (0.03 + 0.09 * build) * (0.5 + fg.v);
        _q.setFromEuler(new THREE.Euler(0, fg.ry, sway));
        _m.compose(_w.set(fg.x, bounce, fg.z), _q, _v.setScalar(fg.s));
        im.setMatrixAt(i, _m);
        // the stick in the right hand, waving and bending with the build
        const hand = handL.clone().applyMatrix4(_m);
        const wave = Math.sin((sphase + fg.seed) * TAU) * (0.15 + 0.3 * build) + (fg.v - 0.5) * 0.6;
        const q2 = _q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25 + (fg.seed - 0.5) * 0.5, 0, 0.35 + wave)));
        const sm = new THREE.Matrix4().compose(hand, q2, _v.setScalar(fg.s));
        const bendK = (0.3 + 1.5 * build * build) * Math.sin((sphase + fg.seed * 1.7) * TAU) + 1.0 * snare * build;
        let pre = 0.012;
        for (const age of waves) {
          const zf = -16 + age * 42; // front sweeps from the back rows toward the camera
          pre += amp * Math.exp(-(((fg.z - zf) / 1.6) ** 2)) * (0.6 + 0.8 * fg.v);
        }
        const flood = sn > 0 ? 1.1 * smoothstep(0, 0.03 + fg.v * 0.03, sn) : Math.min(pre, 0.35);
        sticks.setStick(si++, sm, sn > 0 ? 2.2 : bendK, kinkAll * (0.7 + 0.6 * fg.v), flood, fg.seed, fg.c);
      });
      im.instanceMatrix.needsUpdate = true;
    });
    sticks.commit(si);
    sticks.u.uTime.value = t;

    // ---- the writer: sways with the others, then writes the line; the snap
    const bend = (tens.k / Math.max(1, tens.n)) * 2.6;
    const su = this.stick.u;
    su.uTime.value = t;
    su.uFlood.value = sn > 0 ? 1.4 : 0;
    su.uFloodR.value = sn > 0 ? STICK_L * 1.2 * ease.outQuad(clamp(sn / 0.09)) : 0;
    su.uStress.value = 0.1 * build * (1 + snare) + waves.reduce((m, age) => m + amp * Math.exp(-(((this.writerAt.z - (-16 + age * 42)) / 1.6) ** 2)), 0);
    su.uCrack.value = 0;
    const pp = this.penPose(t);
    // before the line the writer's stick sways with the crowd's
    const free = 1 - prog(t, this.tApproach(w), w.pen.tStart, ease.inOutCubic);
    const swayX = Math.sin((sphase + 0.3) * TAU) * (0.05 + 0.06 * build) * free;
    pp.pen.x += swayX;
    pp.anchor.x += swayX * 0.5;
    pp.u.copy(pp.pen).sub(pp.anchor).normalize();
    const lean = clamp((pp.anchor.x - this.writerAt.x - 0.26) * 0.45, -0.18, 0.18);
    this.body!.position.set(this.writerAt.x + lean * 0.6, Math.pow(Math.abs(Math.sin(Math.PI * b)), 2) * (0.03 + 0.06 * build) * free, this.writerAt.z);
    this.body!.rotation.z = -lean * 0.5;
    const { pen } = this.poseWriter(pp, bend, sn > 0 ? kinkAll : 0, this.writerShoulder(lean).add(_v.set(0, this.body!.position.y, 0)));
    this.drawTrails(t);
    this.drawHead(t, pen, pp.li, (sn > 0 ? Math.max(0, 1 - sn / 0.05) : 1) * (1 - free * 0.85));

    // ---- sparks from every stick at the snap
    if (sn > 0) {
      const kp = this.kinkPoint();
      this.burst(t, this.snapT, kp, 0, 140, 7, col('cyan', 1.2), 1.8);
      let k = 140;
      this.crowd.forEach((im, g) => this.figs[g]!.forEach((fg, i) => {
        if (k + 6 > this.sparks.n) return;
        im.getMatrixAt(i, _m);
        const p = handL.clone().add(_v.set(0, 0.12, 0)).applyMatrix4(_m);
        this.burst(t, this.snapT + fg.v * 0.03, p, k, 6, 31 + Math.floor(fg.seed * 1000), fg.c, 1.5, 0.01);
        k += 6;
      }));
      for (; k < this.sparks.n; k++) this.sparks.hide(k);
      this.L.uLightPos.value.copy(kp);
      this.L.uLightCol.value.copy(col('cyan', 2 * Math.min(1, sn / 0.04)));
    } else for (let i = 0; i < this.sparks.n; i++) this.sparks.hide(i);
    this.sparks.commit();

    this.drawDust(t, new THREE.Vector3(0, 2.2, -2.5), 7, 3.5, 8, 0.06 + 0.06 * build);
    const roll = snare * build * build * 2.5;
    return this.snapPost(t, sn, {
      bloom: 0.95 + (sn > 0 ? 0.15 : 0),
      exposure: 1 + (sn > 0 ? 0.15 * prog(sn, 0, 0.16) : 0) + 0.12 * kick * build,
      shake: [(jolt * 3 * build + roll) * (hash(frameIdx(t), 4) - 0.5), (jolt * 3 * build + roll) * (hash(frameIdx(t), 5) - 0.5)],
    });
  }
}
