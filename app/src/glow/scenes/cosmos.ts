// The drops (params.n = 1, 3): the galaxy, as stars and light only — a real spiral (two arms, spurs, a
// bulge), dust lanes, nebulae, star clusters, and five-pointed phosphor star stickers sparkling through it
// (cosmos-shader.ts). The camera is a 2D flight (centre, zoom, roll, tilt) between a few deliberate shots on a
// list of keyframes that land on downbeats; between them it holds with a slow settle and flies on a quintic
// ease (the centre moves in proportion to the zoom, so every dive goes straight at its target).
// No words in the drops: the lyrics are only heard (and "take my hand" is shown as two stars joining).
//
// Drop 1 (cyan): out of the star-dust spiral of the scene before — punch into the core, pull back through
// ten octaves to the whole galaxy, a supernova, fly down an arm into a cluster; "Take my hand" (1): two stars
// trailing streams of light curve in from the sides and join on "hand" (cosmos-fx.ts); across a dust lane to the
// next cluster, "Take my hand" (2): the same from the corners; then a dive into the core, white, for the cut.
// Every kick surges the camera in; every move streaks the stars along their motion (the shader is given the
// frame's flow), and a near layer of stars flies past faster than the galaxy (parallax), so the flights read in
// depth. Everything over the galaxy is analytic and soft (no sprites, no meshes): nothing reads as pasted in.
// (Drop 3 is cosmos-deck.ts.)
import * as THREE from 'three';
import { Scene, type Frame, type SceneCtx } from '../../engine/scene';
import { clamp, hash, smoothstep, frameIdx } from '../../engine/util';
import { col } from '../lib/palette';
import { armAt, clusterNear, galaxyMaterial, type Cfg, type Look } from './cosmos-shader';
import { CosmosFx, type Fx, type Join } from './cosmos-fx';
import { NovaFx } from './cosmos-nova';
import { loadPhosphorFont, PHOS_FONT } from '../lib/phosphor';
import { prewarm } from '../lib/prewarm';
import { armPhase } from './cosmos-shader';

const ASP = 16 / 9;
const quint = (x: number) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const sm3 = (u: number) => u * u * (3 - 2 * u);
type Cam0 = { c: [number, number]; z: number; rot: number; tilt: number };
/** the screen flow from camera A back to camera B (B = A a shutter earlier): uv_B = M uv_A + c; tilted = the disk's
 *  plane (y foreshortened by cos tilt) */
function flow(A: Cam0, B: Cam0, tilted: boolean) {
  const ctA = tilted ? Math.cos(A.tilt) : 1, ctB = tilted ? Math.cos(B.tilt) : 1;
  // uv -> plane: q = cA + D_A^-1 R(rA) uv zA;  plane -> uv: R(-rB) D_B (q - cB) / zB
  const fwd = (u: number, v: number): [number, number] => {
    const x = (Math.cos(A.rot) * u - Math.sin(A.rot) * v) * A.z, y = (Math.sin(A.rot) * u + Math.cos(A.rot) * v) * A.z / ctA;
    const qx = A.c[0] + x - B.c[0], qy = (A.c[1] + y - B.c[1]) * ctB;
    return [(Math.cos(-B.rot) * qx - Math.sin(-B.rot) * qy) / B.z, (Math.sin(-B.rot) * qx + Math.cos(-B.rot) * qy) / B.z];
  };
  const o = fwd(0, 0), ex = fwd(1, 0), ey = fwd(0, 1);
  return { M: [ex[0] - o[0], ey[0] - o[0], ex[1] - o[1], ey[1] - o[1]] as [number, number, number, number], c: o };
}

interface Key {
  t: number; c: [number, number]; z: number; rot: number; tilt: number;
  /** seconds of flight that end at t */
  fl: number;
  /** slow settle while holding: added on over the hold */
  dz?: number; dr?: number; dc?: [number, number]; dt?: number;
}
interface Cam { c: [number, number]; z: number; rot: number; tilt: number }

const LOOKS: Record<number, Look & { cfg: Cfg }> = {
  1: {
    core: '#CFEFFF', arm: '#2E8CFF', neb1: '#33E6FF', neb2: '#6A5CFF', starA: '#D8F2FF', starB: '#7FC2FF', hot: '#EAF8FF',
    stk1: '#B6FF6A', stk2: '#9FEFFF', bg: '#02030A', uv: '#9B5CFF', sun: '#BFEFFF', shock: '#7FDFFF',
    seed: [0, 0], pat: 0.4, gain: { core: 1.0, arm: 1.5, neb: 0.6, star: 1.3 }, cfg: { seedX: 0, seedY: 0, pat: 0.4 },
  },
  3: {
    core: '#FFE8B0', arm: '#FF9A2A', neb1: '#FFC247', neb2: '#FF6F3C', starA: '#FFF3D6', starB: '#FFC468', hot: '#FFF6E0',
    stk1: '#B6FF6A', stk2: '#FFE9A8', bg: '#070402', uv: '#9B5CFF', sun: '#FFD27A', shock: '#FFC247',
    seed: [11.3, 4.7], pat: 2.1, gain: { core: 0.8, arm: 1.5, neb: 0.65, star: 1.3 }, cfg: { seedX: 11.3, seedY: 4.7, pat: 2.1 },
  },
};

export default class Cosmos extends Scene {
  n: number;
  mat: THREE.ShaderMaterial;
  scene = new THREE.Scene();
  cam = new THREE.OrthographicCamera(-ASP, ASP, 1, -1, 0.1, 10);
  fx: CosmosFx;
  pulsar: [number, number] = [0.8, 0.5];
  /** drop 1's supernova: when, where (world), the camera zoom then */
  sn: { t: number; at: [number, number]; z: number } | null = null;
  snFx: NovaFx;
  keys: Key[] = [];
  kicks: [number, number][] = [];
  joins: { ev: Join }[] = [];
  bars: number[] = [];
  look: Look & { cfg: Cfg };
  t0: number;
  t1: number;

  constructor(ctx: SceneCtx) {
    super(ctx);
    this.n = ctx.params.n ?? 1;
    this.look = LOOKS[this.n] ?? LOOKS[1]!;
    this.mat = galaxyMaterial(this.look);
    this.t0 = ctx.start;
    this.t1 = ctx.end;
    this.cam.position.set(0, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2 * ASP, 2), this.mat);
    quad.frustumCulled = false;
    quad.renderOrder = -1;
    this.scene.add(quad);
    const tint = this.n === 1 ? col('#BFEFFF') : col('#FFE6A8');
    const hot = this.n === 1 ? col('#FFFFFF') : col('#FFF4D8');
    this.fx = new CosmosFx(ASP, hot, tint, 0.3);
    this.snFx = new NovaFx(ASP, { hot: col('#FFFFFF').multiplyScalar(1.4), shell: col('#7FE3FF').multiplyScalar(1.1), gas: col('#2E8CFF'), gas2: col('#9B5CFF') });
    this.scene.add(this.fx.mesh, this.snFx.mesh);
    this.kicks = ctx.audio.events('kick', this.t0 - 1, this.t1 + 1);
    this.buildShots();
    this.matchSpiral();
    this.punchUp();
    this.buildNovae();
  }

  /** downbeat bar k of the drop (bar 0 = the downbeat at the section start) */
  private bar(k: number) { return this.bars[k] ?? this.bars[this.bars.length - 1]! + (k - this.bars.length + 1) * 1.58; }

  override async init() {
    // "Take my hand", written in light under the two stars (the drop's only words)
    await loadPhosphorFont();
    const hands = this.ctx.lyrics.linesIn(this.t0, this.t1).filter((l) => /take my hand/i.test(l.text));
    this.fx.setLines(hands, PHOS_FONT);
    // (compiled and uploaded now: the preview must not stall on the drop's first frame)
    this.mat.uniforms.uRes!.value.set(8, 8);
    prewarm(this.ctx.renderer, [{ scene: this.scene, cam: this.cam }], this.fx.textures());
  }

  /** the arms' phase offset at t: at the drop's first frame the arms lie exactly on the star-dust spiral that
   *  phos-drop (drop1a) closes on, and turn on with it, easing back to the galaxy's own pattern by bar 1 */
  private patAt(t: number) {
    const B0 = this.bar(0), B1 = this.bar(1);
    if (t >= B1) return 0;
    const x = clamp((t - B0) / (B1 - B0));
    const h00 = 2 * x * x * x - 3 * x * x + 1, h10 = x * x * x - 2 * x * x + x;
    return this.d0 * h00 + this.m0 * (B1 - B0) * h10;
  }
  d0 = 0; m0 = 0;

  /** match the spiral of phos-drop's last frame (screen: x = CX + sr cos th * 1.05, y = CY + sr sin th * 0.62, px,
   *  y down; post zoom 1.06) on the disk: tilt so that cos(tilt) = 0.62 / 1.05, mirrored, the radius scale z */
  private matchSpiral() {
    const au = this.ctx.audio, B0 = this.bar(0);
    const tSp = [...au.downbeats].filter((d) => d < B0 - 0.3).pop() ?? B0 - 1.6;
    const sr = 300, th = 3.3 * Math.log(1 + sr / 70) + 0.6 * (B0 - tSp) / Math.sqrt(sr / 120 + 0.6);
    const z = this.keys[0]!.z, r = z * 1.06 * 1.05 * sr / 540, a = th + Math.PI;
    const ph = armPhase(this.look.cfg, r * Math.cos(a), r * Math.sin(a));
    // the arms lie where the phase is a multiple of pi: the offset that puts one here, turning the right way
    let d = -ph; d = ((d % Math.PI) + Math.PI) % Math.PI;
    if (d < 0.3) d += Math.PI;
    this.d0 = d;
    this.m0 = -0.6 / Math.sqrt(sr / 120 + 0.6); // the spiral's own turn (rad/s), continued
  }

  private buildShots() {
    const au = this.ctx.audio;
    let i0 = 0, best = 1e9;
    au.downbeats.forEach((d, i) => { if (Math.abs(d - this.t0) < best) { best = Math.abs(d - this.t0); i0 = i; } });
    this.bars = au.downbeats.slice(i0, i0 + 18);
    const B = (k: number) => this.bar(k);
    const cfg = this.look.cfg;
    // composition helpers: the camera on arm `k` at radius r, rolled so the arm runs across the frame on a diagonal
    const onArm = (r: number, k: number, roll: number, snapCluster = true) => {
      const a = armAt(cfg, r, k);
      const cl = snapCluster ? clusterNear(a.x, a.y, 0.09) : null;
      return { c: (cl ? [cl.x, cl.y] : [a.x, a.y]) as [number, number], rot: a.ang + roll };
    };
    if (this.n === 1) {
      const A = onArm(0.58, 0, 0.3), Bm = onArm(0.4, 1, -0.35);
      this.keys = [
        // the star-dust spiral the drop opens on, matched (see matchSpiral): then into the core on bar 1
        { t: B(0), c: [0, 0], z: 0.95, rot: 0, tilt: Math.acos(0.62 / 1.05), fl: 0, dz: -0.3 },
        { t: B(1), c: [0, 0], z: 0.12, rot: 0.3, tilt: 0.15, fl: 0.9, dz: 0.15 },
        { t: B(3), c: A.c, z: 0.15, rot: A.rot, tilt: 0.3, fl: 1.55, dz: -0.1, dr: -0.05 },
        { t: B(5), c: Bm.c, z: 0.11, rot: Bm.rot, tilt: 0.25, fl: 1.0, dz: -0.1, dr: 0.05 },
        { t: B(7), c: [0, 0], z: 0.06, rot: Bm.rot + 1.3, tilt: 0.1, fl: 1.3, dz: -0.5, dr: 0.3 },
      ];
      const hands = this.ctx.lyrics.linesIn(this.t0, this.t1).filter((l) => /take my hand/i.test(l.text));
      const cL = col('#33E6FF'), cR = col('#B6FF6A'), cJ = col('#EFFBFF');
      hands.forEach((l, i) => {
        const hand = l.words[l.words.length - 1]!;
        this.joins.push({
          ev: i === 0
            ? { t: hand.start + 0.04, dur: 1.5, L: { S: [-2.4, -0.3], C: [-1.1, 0.85] }, R: { S: [2.4, -0.3], C: [1.1, 0.85] }, M: [0, 0.2], cL, cR, cJ, keep: 1.9 }
            : { t: hand.start + 0.04, dur: 1.5, L: { S: [-2.4, 0.95], C: [-0.7, -0.15] }, R: { S: [2.4, -0.55], C: [0.7, 0.75] }, M: [0, 0.2], cL, cR, cJ, keep: 1.7 },
        });
      });
    }
  }

  /** hard-hitting version of the list: flights are short whips into each downbeat; long holds get an extra reframe on a bar */
  private punchUp() {
    const bl = 1.58, out: Key[] = [];
    this.keys.forEach((k, i) => {
      const nx = this.keys[i + 1];
      out.push({ ...k, fl: Math.min(k.fl, 0.55), dz: (k.dz ?? 0) - 0.12, dr: (k.dr ?? 0) * 1.6 });
      if (nx && i < this.keys.length - 2 && nx.t - k.t > 1.9 * bl) {
        const n = Math.floor((nx.t - k.t) / bl + 0.01);
        for (let j = 1; j < n; j++) {
          const u = j / n, odd = j % 2;
          out.push({
            t: k.t + (nx.t - k.t) * u, c: [k.c[0] + (nx.c[0] - k.c[0]) * 0.3 * u, k.c[1] + (nx.c[1] - k.c[1]) * 0.3 * u],
            z: Math.sqrt(k.z * nx.z) * (odd ? 0.7 : 1.5), rot: k.rot + (odd ? 0.9 : -0.7) * j, tilt: k.tilt, fl: 0.4, dz: -0.25, dr: odd ? 0.25 : -0.25,
          });
        }
      }
    });
    this.keys = out.filter((k, i) => i === 0 || k.t > out[i - 1]!.t + 0.2);
  }

  private buildNovae() {
    const cfg = this.look.cfg, B = (k: number) => this.bar(k);
    // one supernova, on the hardest hit of the drop's first half, where the camera lands for it; placed off the
    // core (where the sky behind it is dark), to the right of the frame's centre
    const t = B(2) + 0.0, c = this.camAt(t + 0.05);
    const u: [number, number] = [0.42, 0.1];
    const pr = [(Math.cos(c.rot) * u[0] - Math.sin(c.rot) * u[1]) * c.z, (Math.sin(c.rot) * u[0] + Math.cos(c.rot) * u[1]) * c.z];
    this.sn = { t, at: [c.c[0] + pr[0]!, c.c[1] + pr[1]! / Math.cos(c.tilt)], z: c.z };
    const a = armAt(cfg, 0.8, 1);
    this.pulsar = [a.x + 0.05, a.y + 0.05];
  }

  /** every kick surges the camera in (a fast push, a slower release): 0..~1 */
  private surge(t: number) {
    let s = 0;
    for (const [te, k] of this.kicks) {
      const a = t - te;
      if (a < -0.03) break;
      if (a > 0.9) continue;
      s += Math.min(1, k) * smoothstep(-0.03, 0.03, a) * Math.exp(-Math.max(0, a) / 0.22);
    }
    return Math.min(1.3, s);
  }

  /** the camera at song time t, with the kicks' surges */
  private camAt(t: number): Cam {
    const c = this.camBase(t);
    // (gentler while the spiral is still dissolving into the galaxy: the handover must read as one motion)
    const f = this.calm(t);
    return { ...c, z: c.z * Math.exp(-0.13 * f * this.surge(t)), rot: c.rot + 0.03 * f * this.surge(t - 0.04) };
  }

  private calm(t: number) { return 0.3 + 0.7 * smoothstep(this.bar(0) + 0.3, this.bar(0) + 0.9, t);
  }

  /** the camera at song time t (the shot list) */
  private camBase(t: number): Cam {
    const ks = this.keys;
    const hold = (k: Key, u: number): Cam => {
      const e = sm3(clamp(u));
      return {
        c: [k.c[0] + (k.dc?.[0] ?? 0) * e, k.c[1] + (k.dc?.[1] ?? 0) * e],
        z: k.z * (1 + (k.dz ?? 0) * e), rot: k.rot + (k.dr ?? 0) * e, tilt: k.tilt + (k.dt ?? 0) * e,
      };
    };
    if (t <= ks[0]!.t) return hold(ks[0]!, 0);
    const last = ks[ks.length - 1]!;
    if (t >= last.t) return hold(last, (t - last.t) / Math.max(0.5, this.t1 - last.t));
    let i = 0;
    while (i < ks.length - 2 && t >= ks[i + 1]!.t) i++;
    const a = ks[i]!, b = ks[i + 1]!;
    const dep = Math.max(a.t, b.t - b.fl);
    if (t < dep) return hold(a, (t - a.t) / Math.max(1e-3, dep - a.t));
    const A = hold(a, 1);
    const x = clamp((t - dep) / Math.max(1e-3, b.t - dep));
    const e = Math.pow(x, 2.4) * (1 - 0.0) ; // accelerates into the downbeat: a speed ramp into the hit
    const z = Math.exp(Math.log(A.z) + (Math.log(b.z) - Math.log(A.z)) * e);
    // the centre follows the zoom: straight at the target
    const g = Math.abs(Math.log(b.z / A.z)) > 0.05 ? (1 / z - 1 / A.z) / (1 / b.z - 1 / A.z) : e;
    return {
      c: [A.c[0] + (b.c[0] - A.c[0]) * g, A.c[1] + (b.c[1] - A.c[1]) * g],
      z, rot: A.rot + (b.rot - A.rot) * e, tilt: A.tilt + (b.tilt - A.tilt) * e,
    };
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, au = this.ctx.audio, U = this.mat.uniforms;
    const cam = this.camAt(t);
    const kick = Math.min(1, f.a.kick);
    // beat pulse: a wave of light runs out along the arms from every downbeat
    let db = 0;
    for (const d of au.downbeats) { if (d <= t) db = d; else break; }
    const age = t - db;
    U.uRes!.value.set(out.width, out.height);
    U.uC!.value.set(cam.c[0], cam.c[1]);
    U.uZ!.value = cam.z; U.uRot!.value = cam.rot; U.uCt!.value = Math.cos(cam.tilt);
    U.uT!.value = t;
    U.uMir!.value = -1;
    U.uPat!.value = this.look.cfg.pat + this.patAt(t);
    U.uT0!.value = this.t0 - 2.0;
    U.uKick!.value = kick;
    U.uPulseR!.value = age * 0.9;
    U.uPulseA!.value = 1.3 * Math.pow(Math.max(0, 1 - age / 1.2), 1.5);
    // exposure: the kicks breathe it; drop 1 whites out into the cut, drop 3 converges into one star
    let expo = 1 + 0.35 * kick;
    expo *= 1 + 2.2 * smoothstep(this.bar(7) + 0.45, this.t1, t);
    // the supernova: its flash, then the galaxy looks dimmer next to it for a moment
    let snA = -9;
    if (this.sn) {
      snA = t - this.sn.t;
      const [x, y] = this.projUV(cam, this.sn.at);
      this.snFx.update([x, y], 0.78 * (this.sn.z / cam.z), snA, out.height);
      if (snA > 0) expo *= 1 - 0.35 * Math.exp(-snA / 0.6);
    }
    U.uExpo!.value = expo;

    // no words in the drops: no scrim
    U.uScrimK!.value = 0;

    // motion: the frame's flow (where each pixel's point of the disk was a shutter ago), for streaks; and the near
    // layer of stars (its own camera: zooms and pans faster than the disk, i.e. nearer)
    const prev = this.camAt(t - 1 / 40);
    const fw = flow(cam, prev, true), near = (c: Cam): Cam => ({ c: [c.c[0] * 0.8 * Math.pow(c.z, 0.35), c.c[1] * 0.8 * Math.pow(c.z, 0.35)], z: 0.5 * Math.pow(c.z, 1.35), rot: c.rot, tilt: 0 });
    const nc = near(cam), fn = flow(nc, near(prev), false);
    U.uFlow!.value.set(...fw.M); U.uFlowC!.value.set(...fw.c);
    U.uFlowN!.value.set(...fn.M); U.uFlowNC!.value.set(...fn.c);
    U.uNC!.value.set(nc.c[0], nc.c[1]); U.uNZ!.value = nc.z;

    // the small life: comets, the pulsar, "take my hand"
    this.fx.update(t, out.height, au.beats, this.t0, this.t1, f.beatPhase, this.projUV(cam, this.pulsar));
    const fx: Fx = { sun: [0, 0, 0, 1], shock: [0, 0, 0, 0] };
    this.fx.begin();
    for (const j of this.joins) this.fx.join(j.ev, t, fx);
    this.fx.text(t, kick);
    U.uSun!.value.set(fx.sun[0], fx.sun[1], fx.sun[2], fx.sun[3]);
    U.uShock!.value.set(fx.shock[0], fx.shock[1], fx.shock[2], fx.shock[3]);

    // punch: every kick pushes in and shakes; every new framing lands with a slam and a flash; snares strobe
    let since = 9;
    for (const [i, k] of this.keys.entries()) if (i > 0 && k.t <= t) since = t - k.t;
    const slam = Math.exp(-since / 0.14);
    const snare = Math.min(1, f.a.snare);
    const fi = frameIdx(t), sh = 6 * kick * this.calm(t) + 10 * slam;
    const boom = snA >= 0 ? Math.exp(-snA / 0.12) : 0;
    const sh2 = sh + 22 * boom;
    const post = {
      zoom: 1 + 0.04 * kick * this.calm(t) + 0.07 * slam + 0.09 * boom,
      shake: [(hash(fi, 1) - 0.5) * 2 * sh2, (hash(fi, 2) - 0.5) * 2 * sh2] as [number, number],
      flash: 0.012 * slam * (1 + snare) + 0.3 * (snA >= 0 ? Math.exp(-snA / 0.045) : 0),
      ca: 0.8 + 3 * boom,
    };
    const r = this.ctx.renderer;
    r.setRenderTarget(out);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(this.scene, this.cam);
    return post;
  }

  /** a plane point on screen (ndc) */
  private projUV(c: Cam, w: [number, number]): [number, number] {
    const px = w[0] - c.c[0], py = (w[1] - c.c[1]) * Math.cos(c.tilt);
    const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
    // (the frame is mirrored: uMir = -1)
    return [-(cs * px - sn * py) / c.z, (sn * px + cs * py) / c.z];
  }

  override dispose() {
    this.mat.dispose();
    this.snFx.dispose();
    this.fx.dispose();
  }
}
void ASP;
