// Drops (×3, params.n): a dark field, a crowd of silhouettes and hundreds of glow sticks thrown into the
// air on the beat. The vocal chops slam syllables of GLO-O-OWING / DA-A-ANCE, one colour per chop; the
// camera cuts to a new angle every two bars. Drop 1 has "take my hand" twice in neon; the break after
// chorus 2 floats instead of bouncing; the big drop ends with every stick thrown up into the sky, where
// they become stars (and the outro picks up in that sky).
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim, skyDome } from '../lib/stage';
import { col, STICKS } from '../lib/palette';
import { glowStickGeometry, figureGeometry } from '../lib/shapes';
import { BlockText } from '../lib/extrude';
import { NeonLine, splitRows } from '../lib/neon';
import { GlowPoints } from '../lib/points';
import { Beams } from './chorus-dancers';

const N_STICKS = 460;
const N_PEOPLE = 150;
const SYLLABLES = [['GLO-', 'O-', 'OWING'], ['DA-', 'A-', 'ANCE']];

interface Stick { x: number; z: number; period: number; phase: number; h: number; spin: THREE.Vector3; c: THREE.Color }
interface Chop { t: number; phrase: number; k: number }

export default class Rave extends Scene {
  st = new Stage(46, 0.1, 900);
  n = 1;
  sticks!: THREE.InstancedMesh;
  stickData: Stick[] = [];
  people: THREE.InstancedMesh[] = [];
  personPos: { x: number; z: number; ry: number; s: number }[] = [];
  lights: THREE.PointLight[] = [];
  sky!: THREE.Mesh;
  stars!: GlowPoints;
  syl: BlockText[][] = []; // [word][syllable]
  chops: Chop[] = [];
  phrases: number[] = []; // phrase start times (every 2 bars)
  hands: NeonLine[] = [];
  beams!: Beams;
  lasers!: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private c = new THREE.Color();

  override async init() {
    const { audio, lyrics, params, start, end } = this.ctx;
    this.n = params.n ?? 1;
    const S = this.st;
    S.bg.copy(col('night'));
    S.fog(col('dusk', 0.55), this.n === 2 ? 0.02 : 0.026);
    this.sky = skyDome(col('night'), col('dusk', 1.1), col('night'), 800);
    S.add(this.sky);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: new THREE.Color('#0a0c18'), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    S.add(ground);
    S.add(new THREE.HemisphereLight(new THREE.Color('#1c2a6a'), new THREE.Color('#05060f'), 0.25));
    for (let i = 0; i < 4; i++) {
      const L = new THREE.PointLight(col(STICKS[i]!, 1), 30, 40, 1.6);
      this.lights.push(L);
      S.add(L);
    }
    const rnd = mulberry32(100 + this.n);

    // crowd: three poses (arms down, half, up), each person shows one pose per beat
    const poses = [0.05, 0.55, 1].map((a) => figureGeometry(a));
    const pmat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2a3060'), roughness: 0.45, metalness: 0.2 });
    for (const g of poses) {
      const im = new THREE.InstancedMesh(g, pmat, N_PEOPLE);
      this.people.push(im);
      S.add(im);
    }
    for (let i = 0; i < N_PEOPLE; i++) {
      const r = Math.sqrt(rnd()) * 16, a = rnd() * Math.PI * 2;
      this.personPos.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, ry: rnd() * Math.PI * 2, s: 0.9 + rnd() * 0.25 });
    }
    // sticks: each thrown on its own beat cycle (2, 4 or 8 beats), from somewhere in the crowd
    const geo = glowStickGeometry(0.85, 0.045);
    this.sticks = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), N_STICKS);
    S.add(this.sticks);
    for (let i = 0; i < N_STICKS; i++) {
      const r = Math.sqrt(rnd()) * 15, a = rnd() * Math.PI * 2;
      const period = [2, 4, 4, 8][Math.floor(rnd() * 4)]!;
      const sc = this.n === 3 && rnd() < 0.3 ? 'gold' : STICKS[i % STICKS.length]!;
      this.stickData.push({
        x: Math.cos(a) * r, z: Math.sin(a) * r, period, phase: Math.floor(rnd() * period), h: 4 + rnd() * 9,
        spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize().multiplyScalar(4 + rnd() * 8), c: col(sc, 2.2 + rnd() * 0.8),
      });
    }
    // the rig: beams sweeping through the haze, two fans of lasers from the back
    this.beams = new Beams(8, STICKS.map((k) => col(k, 1.2)), 20);
    S.add(this.beams);
    const lg = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true);
    lg.translate(0, 0.5, 0);
    this.lasers = new THREE.InstancedMesh(lg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }), 24);
    this.lasers.frustumCulled = false;
    S.add(this.lasers);
    // stars for the end of the big drop (the sticks become them)
    this.stars = new GlowPoints(N_STICKS, 0.09);
    S.add(this.stars);

    // chops -> syllables; phrases are two bars
    const D = audio.downbeats.filter((d) => d >= start - 0.01 && d < end - 0.05);
    for (let i = 0; i < D.length; i += 2) this.phrases.push(D[i]!);
    const ch = audio.events('chop', start, end);
    const count = new Map<number, number>();
    for (const [t] of ch) {
      const ph = Math.max(0, this.phrases.filter((p) => p <= t + 0.02).length - 1);
      const k = count.get(ph) ?? 0;
      count.set(ph, k + 1);
      this.chops.push({ t, phrase: ph, k });
    }
    for (const word of SYLLABLES) {
      const pieces = word.map((s, k) => new BlockText(s, { size: 1, depth: 0.32, bevel: 0.025, align: 'left', face: col(STICKS[k]!, 1.6), side: col(STICKS[k]!, 0.3) }));
      // lay the syllables out in a row, centred
      const W = pieces.reduce((s, p) => s + p.width, 0) + 0.15 * (pieces.length - 1);
      let x = -W / 2;
      for (const p of pieces) { p.userData.x = x; x += p.width + 0.15; p.visible = false; S.add(p); }
      this.syl.push(pieces);
    }
    // "take my hand" lines (drop 1, outro chops)
    for (const l of lyrics.lines.filter((l: Line) => l.start >= start && l.start < end)) {
      const nl = new NeonLine(l, splitRows(l, 1), { font: 'script', size: 1.6, color: col(this.hands.length % 2 ? 'cyan' : 'pink', 2.4) });
      nl.visible = false;
      S.add(nl);
      this.hands.push(nl);
    }
  }

  /** Camera setups, one per phrase. */
  private camera(t: number, phrase: number, pp: number) {
    const S = this.st, kick = this.ctx.audio.hit('kick', t, 0.1);
    const setups = this.n === 2 ? [2, 1, 4, 2] : [0, 1, 2, 3, 4, 1];
    const setup = setups[phrase % setups.length]!;
    const sgn = phrase % 2 ? -1 : 1;
    let pos: THREE.Vector3, tgt: THREE.Vector3;
    switch (setup) {
      case 0: // in the crowd, looking up into the falling sticks
        pos = new THREE.Vector3(sgn * lerp(-1, 1, pp), 1.6, lerp(6, 4, pp));
        tgt = new THREE.Vector3(0, 9, -6);
        break;
      case 1: // wide, above the crowd, slow orbit
        { const a = sgn * lerp(-0.4, 0.4, pp) + phrase; pos = new THREE.Vector3(Math.sin(a) * 26, lerp(12, 9, pp), Math.cos(a) * 26); tgt = new THREE.Vector3(0, 3, 0); }
        break;
      case 2: // tracking along the front row
        pos = new THREE.Vector3(lerp(-14, 14, pp) * sgn, 2.4, 17);
        tgt = new THREE.Vector3(lerp(-6, 6, pp) * sgn, 4.5, 0);
        break;
      case 3: // close, low, sticks spinning past
        pos = new THREE.Vector3(sgn * 3, 2.2, 9 - pp * 2);
        tgt = new THREE.Vector3(-sgn * 1, 5.5, 0);
        break;
      default: // crane up from the crowd to the sky
        pos = new THREE.Vector3(sgn * 4, lerp(2, 16, ease.inOutCubic(pp)), 20);
        tgt = new THREE.Vector3(0, lerp(4, 12, pp), 0);
    }
    pos.add(new THREE.Vector3(noise1(t * 30, 1) * 0.08 * kick, noise1(t * 30, 2) * 0.08 * kick, 0));
    aim(S.cam, pos, tgt, noise1(t * 0.4, 5) * 0.05);
    S.cam.fov = 46 - kick * 2;
    S.cam.updateProjectionMatrix();
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, { audio } = this.ctx, S = this.st, n = this.n;
    const beatT = audio.beatAt(t);
    const phrase = Math.max(0, this.phrases.filter((p) => p <= t).length - 1);
    const p0 = this.phrases[phrase] ?? this.ctx.start, p1 = this.phrases[phrase + 1] ?? this.ctx.end;
    const pp = prog(t, p0, p1);
    // the big drop's ending: every stick thrown up into the sky, becoming stars
    const lastBars = n === 3 ? audio.downbeats.filter((d) => d < this.ctx.end - 0.1).slice(-2)[0] ?? this.ctx.end - 3 : Infinity;
    const ascend = n === 3 ? smoothstep(lastBars, this.ctx.end, t) : 0;
    const g = n === 2 ? 2.2 : 9.8 * 0.55;

    // sticks
    this.stickData.forEach((s, i) => {
      const per = s.period;
      const cyc = Math.floor((beatT - s.phase) / per);
      const b0 = s.phase + cyc * per;
      const t0 = audio.timeOfBeat(b0), T = audio.timeOfBeat(b0 + per) - t0;
      const dt = t - t0;
      // up and back down to hand height within one cycle (n = 2: drifting, never quite falling)
      const vy = (g * T) / 2;
      let y = 1.9 + vy * dt - 0.5 * g * dt * dt;
      if (n === 2) y = 2.5 + s.h * 0.6 + Math.sin((t + i) * 0.7) * 1.2;
      const drift = hash(i, cyc) - 0.5;
      let x = s.x + drift * 2.2 * (dt / T), z = s.z + (hash(i, cyc, 3) - 0.5) * 2.2 * (dt / T);
      // ascend: everything goes up
      y += ascend * ascend * (30 + s.h * 4);
      this.q.setFromAxisAngle(s.spin.clone().normalize(), s.spin.length() * (n === 2 ? 0.25 : 1) * (t - this.ctx.start) + i);
      const sc = 1 - smoothstep(0.55, 0.95, ascend);
      this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(sc, sc, sc).addScalar(1e-4));
      this.sticks.setMatrixAt(i, this.m);
      const flare = 1 + 0.6 * pulse(t, t0, 0.15);
      this.sticks.setColorAt(i, this.c.copy(s.c).multiplyScalar(flare));
      if (ascend > 0.5) this.stars.set(i, x, y, z, s.c, 0.6 * smoothstep(0.5, 0.9, ascend), 1 + hash(i, 1));
      else this.stars.hide(i);
    });
    this.sticks.instanceMatrix.needsUpdate = true;
    this.sticks.instanceColor!.needsUpdate = true;
    this.stars.commit();

    // crowd: pose per beat, a small bounce
    const bt = Math.floor(beatT);
    for (const im of this.people) im.count = N_PEOPLE;
    this.personPos.forEach((p, i) => {
      const pose = n === 2 ? (hash(i, 7) > 0.5 ? 2 : 1) : Math.floor(hash(i, bt) * 2.999);
      const bounce = n === 2 ? 0 : Math.abs(Math.sin((beatT + hash(i, 2)) * Math.PI)) * 0.12;
      this.people.forEach((im, k) => {
        const on = k === pose ? 1 : 0;
        this.m.compose(new THREE.Vector3(p.x, bounce, p.z), this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry), new THREE.Vector3(p.s * on + 1e-4, p.s * on + 1e-4, p.s * on + 1e-4));
        im.setMatrixAt(i, this.m);
      });
    });
    for (const im of this.people) im.instanceMatrix.needsUpdate = true;
    // coloured lights over the crowd, swinging with the beat
    this.lights.forEach((L, i) => {
      const a = beatT * 0.5 + (i * Math.PI) / 2;
      L.position.set(Math.cos(a) * 9, 7 + Math.sin(beatT * Math.PI + i) * 1.5, Math.sin(a) * 9);
      L.intensity = (n === 2 ? 18 : 30) * (0.6 + 0.6 * audio.env('low', t));
    });

    // beams and lasers: lasers fan on the drop's phrases, off in the floating break
    this.beams.pose(beatT, (n === 2 ? 0.6 : 1) * (0.6 + 0.6 * audio.env('rms', t)) * (1 - smoothstep(0, 0.6, ascend)), 16);
    this.beams.visible = ascend < 0.6;
    const laserOn = n === 2 ? 0 : (0.5 + 0.5 * audio.env('high', t)) * (1 - ascend);
    for (let i = 0; i < 24; i++) {
      const fan = i < 12 ? -1 : 1, j = i % 12;
      const spread = (j / 11 - 0.5) * 1.6 + Math.sin(beatT * Math.PI * 0.5 + fan) * 0.5;
      const tilt = 0.35 + 0.25 * Math.sin(beatT * Math.PI * 0.25 + j * 0.3);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + tilt, 0, spread * fan + fan * 0.3, 'YXZ'));
      this.m.compose(new THREE.Vector3(fan * 10, 9, -22), q, new THREE.Vector3(1, 60, 1));
      this.lasers.setMatrixAt(i, this.m);
      const on = laserOn * (hash(i, Math.floor(beatT)) > 0.35 ? 1 : 0.15);
      this.lasers.setColorAt(i, this.c.copy(col(i % 2 ? 'cyan' : 'pink', 3.5 * on)));
    }
    this.lasers.instanceMatrix.needsUpdate = true;
    this.lasers.instanceColor!.needsUpdate = true;

    this.camera(t, phrase, pp);
    if (ascend > 0) {
      // tilt up after the sticks
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.cam.quaternion);
      aim(S.cam, S.cam.position, S.cam.position.clone().addScaledVector(fwd, 10).add(new THREE.Vector3(0, ease.inOutCubic(ascend) * 25, 0)));
    }

    // chop syllables, billboarded in front of the camera
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.cam.quaternion);
    const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(S.cam.quaternion);
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(S.cam.quaternion);
    const word = this.syl[phrase % 2]!;
    for (const w of this.syl) for (const p of w) p.visible = false;
    const inPhrase = this.chops.filter((c) => c.phrase === phrase && c.t <= t + 0.001);
    const handOn = this.hands.some((h) => t >= h.line.start - 0.3 && t < h.line.end + 0.5);
    if (inPhrase.length && !handOn && ascend === 0) {
      const lastChop = inPhrase[inPhrase.length - 1]!;
      const fade = 1 - smoothstep(p1 - 0.25, p1, t);
      const shown = Math.min(word.length, inPhrase.length);
      word.forEach((piece, k) => {
        if (k >= shown) return;
        const ck = inPhrase[k]!;
        const hit = pulse(t, ck.t, 0.12);
        piece.visible = true;
        const dist = 9.2;
        piece.position.copy(S.cam.position).addScaledVector(fwd, dist).addScaledVector(camRight, (piece.userData.x as number) * 1.05).addScaledVector(camUp, 0.25);
        piece.quaternion.copy(S.cam.quaternion);
        piece.scale.setScalar((1 + hit * 0.25) * fade);
        const kcol = STICKS[(k + phrase) % STICKS.length]!;
        for (const w of piece.words) {
          w.face.color.copy(col(kcol, 1.6 + 3 * hit));
          w.side.color.copy(col(kcol, 0.3 + hit));
        }
      });
      // extra chops beyond the syllables re-flash the whole word
      if (inPhrase.length > word.length) {
        const hit = pulse(t, lastChop.t, 0.1);
        for (const piece of word) for (const w of piece.words) w.face.color.multiplyScalar(1 + 2 * hit);
      }
    }
    // take my hand
    this.hands.forEach((h, i) => {
      const l = h.line;
      h.visible = t >= l.start - 0.3 && t < l.end + 0.6;
      if (!h.visible) return;
      h.position.copy(S.cam.position).addScaledVector(fwd, 10).addScaledVector(camUp, -0.6);
      h.quaternion.copy(S.cam.quaternion);
      h.sing(t, 1 - smoothstep(l.end + 0.2, l.end + 0.6, t));
    });

    // sky: the horizon warms through the big drop
    const skyU = (this.sky.material as THREE.ShaderMaterial).uniforms;
    (skyU.horizon!.value as THREE.Color).copy(col('dusk', 0.8)).lerp(col('violet', 0.12), n === 2 ? 0.5 : 0.15 + 0.15 * audio.env('low', t));
    S.render(this.ctx.renderer, out);
    const kick = audio.hit('kick', t, 0.08);
    const start = 0; // (the drops come in through the shatter transition)
    return {
      bloom: 1.0, bloomThreshold: 0.78, bloomRadius: 0.85, halation: 0.12, vignette: 0.42, grain: 0.05, ca: 1.0 + kick,
      flash: start, zoom: 1 + 0.012 * kick,
    };
  }
}
