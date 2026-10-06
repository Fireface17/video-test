// The drops (params.n = 1, 3): the galaxy, as stars and light only — a real spiral (two arms, spurs, a
// bulge), dust lanes, nebulae, star clusters, and five-pointed phosphor star stickers sparkling through it
// (cosmos-shader.ts). The camera is a 2D flight (centre, zoom, roll, tilt) between a few deliberate shots on a
// list of keyframes that land on downbeats; between them it holds with a slow settle and flies on a quintic
// ease (the centre moves in proportion to the zoom, so every dive goes straight at its target).
// The lyrics of the drop are star-text (cosmos-text.ts): each word ignites as it is sung.
//
// Drop 1 (cyan): out of the star-dust spiral of the scene before — punch into the core, pull back through
// ten octaves to the whole galaxy, fly down an arm into a cluster; "Take my hand" (1): two stars trailing
// streams of light curve in from the sides and join on "hand" (cosmos-motif.ts); across a dust lane to the
// next cluster, "Take my hand" (2): the same from the corners; then a dive into the core, white, for the cut.
// Drop 3 (gold, the finale): core punch, the golden galaxy at full power, an arm, a nebula, an oblique view,
// a dust lane, a huge pull-back that makes the galaxy a small spiral in a field of stars, a push to the core
// where two stars (gold and phosphor) join into a sun with a shockwave, then everything converges into one
// star (the outro starts from stars).
import * as THREE from 'three';
import { Scene, type Frame, type SceneCtx } from '../../engine/scene';
import { clamp, hash, smoothstep, frameIdx } from '../../engine/util';
import { col } from '../lib/palette';
import { armAt, clusterNear, galaxyMaterial, type Cfg, type Look } from './cosmos-shader';
import { StarText } from './cosmos-text';
import { Details, type Nova } from './cosmos-details';
import { Motif, type Fx, type Join } from './cosmos-motif';
import { NovaFx } from './cosmos-nova';

const ASP = 16 / 9;
const quint = (x: number) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const sm3 = (u: number) => u * u * (3 - 2 * u);

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
  text!: StarText;
  motif = new Motif();
  details!: Details;
  novae: Nova[] = [];
  pulsar: [number, number] = [0.8, 0.5];
  /** drop 1's supernova: when, where (world), the camera zoom then */
  sn: { t: number; at: [number, number]; z: number } | null = null;
  snFx: NovaFx;
  keys: Key[] = [];
  joins: { ev: Join; slot: number }[] = [];
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
    this.text = new StarText(ctx.lyrics, this.t0, this.t1, tint, hot);
    this.details = new Details(ctx.audio.beats, this.t0, this.t1, tint, hot, this.n === 3 ? 0.55 : 0.3);
    this.snFx = new NovaFx(ASP, { hot: col('#FFFFFF').multiplyScalar(1.4), shell: col('#7FE3FF').multiplyScalar(1.1), gas: col('#2E8CFF'), gas2: col('#9B5CFF') });
    this.scene.add(this.details.pts, this.text.group, this.motif.group, this.snFx.mesh);
    this.buildShots();
    this.punchUp();
    this.buildNovae();
  }

  override async init() { await this.text.init(); }

  /** downbeat bar k of the drop (bar 0 = the downbeat at the section start) */
  private bar(k: number) { return this.bars[k] ?? this.bars[this.bars.length - 1]! + (k - this.bars.length + 1) * 1.58; }

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
        { t: B(0), c: [0, 0], z: 0.12, rot: 0.3, tilt: 0.15, fl: 0, dz: 0.15 },
        { t: B(1), c: [0, 0.02], z: 1.0, rot: -0.4, tilt: 0.5, fl: 1.45, dz: -0.1, dr: 0.18 },
        { t: B(3), c: A.c, z: 0.15, rot: A.rot, tilt: 0.3, fl: 1.55, dz: -0.1, dr: -0.05 },
        { t: B(5), c: Bm.c, z: 0.11, rot: Bm.rot, tilt: 0.25, fl: 1.0, dz: -0.1, dr: 0.05 },
        { t: B(7), c: [0, 0], z: 0.06, rot: Bm.rot + 1.3, tilt: 0.1, fl: 1.3, dz: -0.5, dr: 0.3 },
      ];
      const hands = this.ctx.lyrics.linesIn(this.t0, this.t1).filter((l) => /take my hand/i.test(l.text));
      const cL = col('#33E6FF'), cR = col('#B6FF6A'), cJ = col('#EFFBFF');
      hands.forEach((l, i) => {
        const hand = l.words[l.words.length - 1]!;
        this.joins.push({
          slot: 0,
          ev: i === 0
            ? { t: hand.start + 0.04, dur: 1.5, L: { S: [-2.4, -0.3], C: [-1.1, 0.85] }, R: { S: [2.4, -0.3], C: [1.1, 0.85] }, M: [0, 0.2], cL, cR, cJ, keep: 1.9 }
            : { t: hand.start + 0.04, dur: 1.5, L: { S: [-2.4, 0.95], C: [-0.7, -0.15] }, R: { S: [2.4, -0.55], C: [0.7, 0.75] }, M: [0, 0.2], cL, cR, cJ, keep: 1.7 },
        });
      });
    } else {
      const A = onArm(0.62, 1, -0.3), Bm = onArm(0.35, 0, 0.4), D = onArm(0.26, 1, 0.1);
      this.keys = [
        { t: B(0), c: [0, 0], z: 0.12, rot: 0, tilt: 0.1, fl: 0, dz: 0.2 },
        { t: B(2), c: [0, 0], z: 0.95, rot: 0.35, tilt: 0.35, fl: 1.9, dz: -0.1, dr: 0.2 },
        { t: B(4), c: A.c, z: 0.14, rot: A.rot, tilt: 0.3, fl: 1.5, dz: -0.1, dr: -0.06 },
        { t: B(6), c: Bm.c, z: 0.075, rot: Bm.rot, tilt: 0.2, fl: 1.4, dz: -0.12, dr: 0.08 },
        { t: B(8), c: [0.04, 0], z: 0.6, rot: 2.0, tilt: 0.8, fl: 1.5, dz: -0.1, dr: 0.12 },
        { t: B(9), c: D.c, z: 0.04, rot: D.rot, tilt: 0.15, fl: 1.1, dz: -0.15, dr: 0.06 },
        { t: B(11), c: [0, 0], z: 1.9, rot: 0.6, tilt: 0.55, fl: 2.2, dz: -0.08, dr: 0.1 },
        { t: B(13), c: [0, 0], z: 0.25, rot: 0.9, tilt: 0.25, fl: 2.0, dz: -0.1, dr: 0.1 },
        { t: B(16), c: [0, 0], z: 0.003, rot: 1.2, tilt: 0.1, fl: 2.4 },
      ];
      this.joins.push({
        slot: 0,
        ev: { t: B(13), dur: 1.6, L: { S: [-2.4, 0.5], C: [-1.3, -0.45] }, R: { S: [2.4, 0.5], C: [1.3, -0.45] }, M: [0, 0.04], cL: col('#FFC247'), cR: col('#B6FF6A'), cJ: col('#FFF2C8'), keep: 3.4, size: 0.2 },
      });
    }
  }

  /** hard-hitting version of the list: flights are short whips into each downbeat; long holds get an extra reframe on a bar */
  private punchUp() {
    const bl = 1.58, out: Key[] = [];
    this.keys.forEach((k, i) => {
      const nx = this.keys[i + 1];
      out.push({ ...k, fl: Math.min(k.fl, 0.55) });
      if (nx && i < this.keys.length - 2 && nx.t - k.t > 1.9 * bl) {
        const n = Math.floor((nx.t - k.t) / bl + 0.01);
        for (let j = 1; j < n; j++) {
          const u = j / n, odd = j % 2;
          out.push({
            t: k.t + (nx.t - k.t) * u, c: [k.c[0] + (nx.c[0] - k.c[0]) * 0.3 * u, k.c[1] + (nx.c[1] - k.c[1]) * 0.3 * u],
            z: Math.sqrt(k.z * nx.z) * (odd ? 0.7 : 1.5), rot: k.rot + (odd ? 0.9 : -0.7) * j, tilt: k.tilt, fl: 0.4, dz: -0.12, dr: odd ? 0.15 : -0.15,
          });
        }
      }
    });
    this.keys = out.filter((k, i) => i === 0 || k.t > out[i - 1]!.t + 0.2);
  }

  private buildNovae() {
    const cfg = this.look.cfg, B = (k: number) => this.bar(k);
    const at = (r: number, k: number): [number, number] => { const a = armAt(cfg, r, k), c = clusterNear(a.x, a.y, 0.12); return c ? [c.x, c.y] : [a.x, a.y]; };
    if (this.n === 1) {
      // one supernova, on the hardest hit of the drop's first half, where the camera lands for it
      this.novae = [];
      // placed off the core (where the sky behind it is dark), to the right of the frame's centre
      const t = B(2) + 0.0, c = this.camAt(t + 0.05);
      const u: [number, number] = [0.42, 0.1];
      const pr = [(Math.cos(c.rot) * u[0] - Math.sin(c.rot) * u[1]) * c.z, (Math.sin(c.rot) * u[0] + Math.cos(c.rot) * u[1]) * c.z];
      this.sn = { t, at: [c.c[0] + pr[0]!, c.c[1] + pr[1]! / Math.cos(c.tilt)], z: c.z };
    }
    else this.novae = [
      { t: B(5) + 0.02, at: at(0.55, 0), scale: 1 }, { t: B(8) + 0.02, at: at(0.7, 1), scale: 1.2 },
      { t: B(10) + 0.02, at: at(0.3, 0), scale: 1.2 }, { t: B(12) + 0.02, at: [0.35, 0.2], scale: 2.2 },
    ];
    const a = armAt(cfg, 0.8, 1);
    this.pulsar = [a.x + 0.05, a.y + 0.05];
  }

  /** the camera at song time t */
  private camAt(t: number): Cam {
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
    U.uKick!.value = kick;
    U.uPulseR!.value = age * 0.9;
    U.uPulseA!.value = 1.3 * Math.pow(Math.max(0, 1 - age / 1.2), 1.5);
    // exposure: the kicks breathe it; drop 1 whites out into the cut, drop 3 converges into one star
    let expo = 1 + 0.35 * kick;
    if (this.n === 1) expo *= 1 + 2.2 * smoothstep(this.bar(7) + 0.45, this.t1, t);
    else { expo *= 1 - 0.3 * smoothstep(this.bar(14) + 1.0, this.bar(16) - 0.2, t); U.uGalaxy!.value = 1 - smoothstep(this.bar(14) + 1.2, this.bar(16) - 0.7, t); }
    // the supernova: its flash, then the galaxy looks dimmer next to it for a moment
    let snA = -9;
    if (this.sn) {
      snA = t - this.sn.t;
      const [x, y] = this.projUV(cam, this.sn.at);
      this.snFx.update([x, y], 0.78 * (this.sn.z / cam.z), snA, out.height);
      if (snA > 0) expo *= 1 - 0.35 * Math.exp(-snA / 0.6);
    }
    U.uExpo!.value = expo;

    // the lyrics and their scrim
    const tx = this.text.update(t, kick);
    U.uScrim!.value.set(0, this.text.y, tx.hw + 0.25, 0.32);
    U.uScrimK!.value = 0.62 * tx.k;

    // the small life
    const cs = Math.cos(-cam.rot), sn = Math.sin(-cam.rot), ct = Math.cos(cam.tilt);
    this.details.update(t, f.beatPhase, kick, {
      z: cam.z,
      uv: (x, y) => { const px = x - cam.c[0], py = (y - cam.c[1]) * ct; return [(cs * px - sn * py) / cam.z, (sn * px + cs * py) / cam.z]; },
    }, this.novae, this.pulsar);
    // events
    const fx: Fx = { sun: [0, 0, 0, 1], shock: [0, 0, 0, 0] };
    this.motif.begin();
    for (const j of this.joins) this.motif.join(j.ev, t, j.slot, fx);
    if (this.n === 3) {
      const c = this.coreUV(cam);
      const tj = this.joins[0]!.ev.t;
      // the merged star swells into the sun, and as everything converges only the star is left
      const sun = smoothstep(tj, tj + 1.8, t) * (1 - smoothstep(this.bar(15), this.bar(16) - 0.3, t));
      fx.sun[2] += 0.9 * sun;
      fx.sun[3] = Math.max(fx.sun[3], 1) + sun * 0.6;
      fx.sun[0] = c[0]; fx.sun[1] = c[1];
      const lone = smoothstep(this.bar(14) + 0.6, this.bar(16) - 0.5, t);
      if (lone > 0) this.motif.lone(0, 0, 0.15 + 0.015 * Math.sin(t * 2), col('#FFF2C8'), 1.7 * lone, t);
      // (the explosion's own ring and the lyrics are over by then)
    }
    this.motif.end();
    U.uSun!.value.set(fx.sun[0], fx.sun[1], fx.sun[2], fx.sun[3]);
    U.uShock!.value.set(fx.shock[0], fx.shock[1], fx.shock[2], fx.shock[3]);

    // punch: every kick pushes in and shakes; every new framing lands with a slam and a flash; snares strobe
    let since = 9;
    for (const k of this.keys) if (k.t <= t) since = t - k.t;
    const slam = Math.exp(-since / 0.14);
    const snare = Math.min(1, f.a.snare);
    const fi = frameIdx(t), sh = 6 * kick + 10 * slam;
    const boom = snA >= 0 ? Math.exp(-snA / 0.12) : 0;
    const sh2 = sh + 22 * boom;
    const post = {
      zoom: 1 + (this.n === 3 ? 0.07 : 0.05) * kick + 0.07 * slam + 0.09 * boom,
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
    return [(cs * px - sn * py) / c.z, (sn * px + cs * py) / c.z];
  }

  /** where the core of the galaxy is on screen (ndc) */
  private coreUV(c: Cam): [number, number] {
    const px = -c.c[0], py = -c.c[1] * Math.cos(c.tilt);
    const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
    return [(cs * px - sn * py) / c.z, (sn * px + cs * py) / c.z];
  }

  override dispose() {
    this.mat.dispose();
    this.text.dispose();
    this.snFx.dispose();
  }
}
void ASP;
