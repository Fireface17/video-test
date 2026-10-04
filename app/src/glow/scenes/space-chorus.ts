// Chorus ×3 — "people become stars, in space". Every person who feels low is a small light in the dark; when
// people reach out their lights join and become stars; together we glow. No lyrics on screen.
//   A  "We don't gotta be okay to dance / …take my hand": out of the burst the lights rise from the night city
//      through the clouds into space, and above the Earth's curve they gather into people of stars, dancing in
//      rows; on "take my hand" one of two big figures in front, who stood low and dim, takes the other's hand —
//      a flash, she lights up, and the joined hands run out along the rows.
//   B  "Every broken piece becomes a star / Look how beautiful we are": a glass heart floats over them; on
//      "broken" it cracks and bursts on the beat, every piece heats up and becomes a star, the stars fly round
//      the planet and become people; on "beautiful" the camera pulls far back: rings of people holding hands
//      around the Earth.
//   C  "So sing it like we're never coming down / Loud enough to wake the whole town": one star falls; we dive
//      after it into the dark city (New York), into the hands of someone sitting alone on a roof edge; she stands
//      and lifts it, and on "wake" it bursts — the town lights up in a wave from her, rings run along the streets.
//   D  "We don't gotta be okay to dance / We'll be glowing in the dark": lights rise from every window, back up
//      to space; the whole planet glows, the rings dance; the camera pulls away on the riser and everything
//      collapses into one point of light on the last beat. (Chorus 2: violet/pink, "glo-glo-glo" as three
//      hits. Chorus 3: gold, a sunrise over the limb, A + B and the finale.)
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { makeRT } from '../../engine/gl';
import { Transitions, type TransitionSpec } from '../../engine/transitions';
import { aim } from '../lib/stage';
import { col, lin } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { RealFigure, loadBody } from '../lib/people';
import { PoseBank } from './space-chorus-figs';
import { Crowd, RINGS, type CrowdLook, type CrowdTimes } from './space-chorus-crowd';
import { GlassHeart } from './space-chorus-heart';
import { R, SpaceWorld, type SpaceLook } from './space-chorus-space';
import { CityWorld, type Spot } from './space-chorus-city';

type V3 = THREE.Vector3;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
type WorldName = 'space' | 'city';
interface Cam { p: V3; tg: V3; fov: number; roll: number }
interface Shot { t0: number; w: WorldName; cam: (t: number) => Cam; into?: TransitionSpec; name: string }

/** a → b over [t0, t1] with an ease. */
const mv = (t: number, t0: number, t1: number, a: V3, b: V3, e: (x: number) => number = ease.inOutCubic) => a.clone().lerp(b, prog(t, t0, t1, e));
const cam = (p: V3, tg: V3, fov = 50, roll = 0): Cam => ({ p, tg, fov, roll });

interface Look { crowd: CrowdLook; space: SpaceLook; heart: [THREE.Color, THREE.Color, THREE.Color]; city: THREE.Color }
const LOOKS: Record<number, () => Look> = {
  1: () => ({
    crowd: { star: col('white', 2.1).lerp(col('cyan', 2.1), 0.12), line: col('cyan', 0.42).lerp(col('blue', 0.42), 0.45), accent: col('cyan', 1.8), hero: [col('cyan', 2.2), col('pink', 2.2)] },
    space: { neb: new THREE.Color(0.75, 0.9, 1.25), nebGain: 0, aurora: [col('phosphor', 1.3), col('cyan', 0.6).lerp(col('violet', 0.6), 0.5)], shell: new THREE.Color(1.0, 0.78, 0.5), air: new THREE.Color(0.12, 0.3, 1.0) },
    heart: [col('pink', 1.3), col('cyan', 1.0).lerp(col('white', 1), 0.4), col('white', 2.6).lerp(col('pink', 2.6), 0.25)],
    city: col('cyan', 1.0).lerp(col('white', 1.0), 0.35),
  }),
  2: () => ({
    crowd: { star: col('white', 2.1).lerp(col('pink', 2.1), 0.15), line: col('violet', 0.5).lerp(col('pink', 0.5), 0.3), accent: col('pink', 1.8), hero: [col('violet', 2.2), col('pink', 2.2)] },
    space: { neb: new THREE.Color(1.5, 0.55, 1.25), nebGain: 0.8, aurora: [col('pink', 1.2), col('violet', 0.9)], shell: new THREE.Color(1.0, 0.55, 0.85), air: new THREE.Color(0.35, 0.18, 1.0) },
    heart: [col('violet', 1.3), col('pink', 1.0).lerp(col('white', 1), 0.35), col('white', 2.6).lerp(col('violet', 2.6), 0.3)],
    city: col('pink', 1.0).lerp(col('violet', 1.0), 0.4),
  }),
  3: () => ({
    crowd: { star: col('gold', 2.0).lerp(col('white', 2.0), 0.45), line: col('gold', 0.5).lerp(col('ember', 0.5), 0.35), accent: col('gold', 2.0), hero: [col('gold', 2.4), col('ember', 2.2)] },
    space: { neb: new THREE.Color(1.4, 0.75, 0.3), nebGain: 0.16, aurora: [col('gold', 1), col('ember', 0.6)], shell: new THREE.Color(1.0, 0.7, 0.3), air: new THREE.Color(0.25, 0.35, 1.0) },
    heart: [col('gold', 1.4), col('white', 1.0).lerp(col('gold', 1), 0.4), col('white', 2.6).lerp(col('gold', 2.6), 0.4)],
    city: col('gold', 1.0),
  }),
};

/** The times everything keys off, from the lyrics and the beat grid. */
interface Keys {
  s: number; e: number; lines: Line[];
  A: number; B: number; C: number; D: number; F: number;
  spaceA: number; glowA: number; take: number; my: number; hand: number;
  every: number; broken: number; shatter: number; becomes: number; star: number; fly0: number; look: number; beautiful: number; pull: number; we: number; are: number;
  so: number; dive1: number; down: number; land: number; loud: number; raise: number; wake: number; town: number;
  dance2: number; spaceD: number; last: number; glowing: number; pullD: number; inn: number; the: number; dark: number;
  glos: number[];
}

export default class SpaceChorus extends Scene {
  n = 1;
  K!: Keys;
  look!: Look;
  space!: SpaceWorld;
  city?: CityWorld;
  crowd!: Crowd;
  heart!: GlassHeart;
  streams = new GlowPoints(1400, 0.1);
  shards!: GlowPoints;
  shots: Shot[] = [];
  tr = new Transitions();
  rtA = makeRT();
  rtB = makeRT();
  heartPos = new THREE.Vector3(0, R + 9.6, 8);
  spot: Spot = { x: -130, z: 430, h: 74, face: 0 };

  override async init() {
    const { params } = this.ctx;
    this.n = params.n ?? 1;
    this.look = LOOKS[this.n]!();
    this.K = this.keys();
    const K = this.K, n = this.n;

    // ---- the worlds ----
    this.space = new SpaceWorld(this.look.space);
    const cities: Record<number, [[number, number], [number, number], V3]> = {
      1: [[50, 8], [40.7, -74], V(0, 0.55, 0.84)],
      2: [[37, 127], [40.7, -74], V(-0.35, 0.5, 0.8)],
      3: [[42, 12], [28, 77], V(0.3, 0.45, 0.85)],
    };
    const [ca, cc, cw] = cities[n]!;
    const bodies = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    await this.space.init(ca, cc, cw.normalize());
    if (n !== 3) {
      if (n === 2) this.spot = { x: 720, z: 360, h: 80, face: 0 };
      this.city = new CityWorld(n, this.spot, this.look.city);
      await this.city.init();
    }
    // ---- the people of stars ----
    const banks = [new PoseBank(new RealFigure(bodies[0], 'rpm', col('white'))), new PoseBank(new RealFigure(bodies[1], 'michelle', col('white')))];
    const heroes = [new RealFigure(bodies[0], 'rpm', col('white')), new RealFigure(bodies[1], 'michelle', col('white'))];
    this.crowd = new Crowd(banks, heroes, this.look.crowd, n * 13);
    this.crowd.beatAt = (t) => this.ctx.audio.beatAt(t);
    this.crowd.T = this.crowdTimes();
    // ---- the glass heart ----
    const [hi, hr, hc] = this.look.heart;
    this.heart = new GlassHeart(7 + n, hi, hr, hc, 62);
    this.heart.T = { crack0: K.every, crack1: K.shatter, shatter: K.shatter, ign0: K.becomes, ign1: K.star };
    this.heart.scale.setScalar(1.7);
    this.shards = new GlowPoints(this.heart.pieces.length + 32, 0.1);
    this.assignBirths();
    const S = this.space.st;
    S.add(this.crowd.sf, this.crowd.links, this.crowd.lights, this.streams, this.heart, this.shards);
    this.shots = n === 3 ? this.shots3() : this.shots12();
    // the lights stream past the camera while it rises with them (A) and when every window lets go (D)
    if (this.city) {
      const shot = (name: string) => this.shots.find((x) => x.name === name)!;
      const rise = shot('rise'), lights = shot('lights');
      const next = (sh: Shot) => this.shots[this.shots.indexOf(sh) + 1]!.t0;
      this.city.escorts.push({ a: rise.t0 - (n === 1 ? 0.4 : 0.6), b: next(rise), path: (t) => rise.cam(t).p, c: new THREE.Color(1.0, 0.8, 0.5) });
      this.city.escorts.push({ a: lights.t0 + 0.3, b: next(lights), path: (t) => lights.cam(t).p, c: new THREE.Color(1.0, 0.85, 0.6).lerp(this.look.city, 0.35) });
    }
  }

  private keys(): Keys {
    const { lyrics, audio, start, end } = this.ctx;
    const lines = lyrics.lines.filter((l) => l.words[0]!.start >= start - 0.1 && l.words[0]!.start < end - 0.3);
    const w = (l: Line | undefined, re: RegExp, fb: number) => l?.words.find((x) => re.test(x.w))?.start ?? fb;
    const beatBefore = (x: number) => audio.timeOfBeat(Math.floor(audio.beatAt(x + 0.03)));
    const beatAfter = (x: number) => audio.timeOfBeat(Math.ceil(audio.beatAt(x - 0.03)));
    const dbAfter = (x: number) => audio.downbeats.find((d) => d >= x - 0.03) ?? x;
    const dbNear = (x: number, tol = 0.25) => { const d = audio.downbeats.find((q) => q >= x - tol); return d !== undefined && d - x < 0.35 ? d : beatAfter(x); };
    const L = (i: number) => lines[Math.min(i, lines.length - 1)]!;
    const s = start, e = end, three = this.n === 3;
    const A = s;
    const B = beatBefore(L(2).start);
    const C = three ? e : beatBefore(L(4).start);
    const D = three ? e : beatBefore(L(6).start);
    const F = three ? beatBefore(L(4).start) : e;
    const first = dbAfter(s + 0.3);
    const spaceA = three ? s : audio.downbeats.find((d) => d > first + 0.3) ?? first + 1.6;
    const take = w(L(1), /take/i, L(1).start + 2), my = w(L(1), /^my/i, take + 0.4), hand = w(L(1), /hand/i, my + 0.3);
    const every = L(2).start, broken = w(L(2), /broken/i, every + 0.4);
    const shatter = dbNear(broken);
    const becomes = w(L(2), /becomes/i, shatter + 0.6), star = w(L(2), /star/i, becomes + 0.5);
    const fly0 = dbAfter(star + 0.15);
    const look = L(3).start, beautiful = w(L(3), /beautiful/i, look + 0.6);
    const pull = beatBefore(beautiful + 0.1);
    const we = w(L(3), /^we/i, beautiful + 1.9), are = w(L(3), /are/i, we + 0.2);
    const last = three ? L(4) : L(7);
    const so = three ? e : L(4).start, down = three ? e : w(L(4), /down/i, so + 2);
    const land = three ? e : dbNear(down, 0.3);
    const dive1 = three ? e : beatBefore(land - 0.75);
    const loud = three ? e : L(5).start, wake = three ? e : w(L(5), /wake/i, loud + 0.9), town = three ? e : w(L(5), /town/i, wake + 1);
    const raise = three ? e : dbAfter(loud + 0.1);
    const dance2 = three ? e : L(6).start;
    const spaceD = three ? e : audio.downbeats.filter((d) => d > D + 0.3)[1] ?? D + 2.4;
    const gw = last.words.find((x) => /glo/i.test(x.w));
    const inn = w(last, /^in$/i, e - 0.7), the = w(last, /^the$/i, inn + 0.2), dark = w(last, /dark/i, the + 0.15);
    // "glo-glo-glo-glowing": the three stutters on the vocal onsets (the beats if the onsets are missing)
    let glos: number[] = [];
    if (gw && gw.w.split('-').length > 2) {
      glos = audio.events('vocal', gw.start - 0.06, gw.end).map(([x]) => x).slice(0, 4);
      while (glos.length < 4) glos.push(audio.timeOfBeat(audio.beatAt(glos[glos.length - 1] ?? gw.start) + 1));
    }
    const glowing = glos.length ? glos[3]! : gw?.start ?? last.start + 0.4;
    const pullD = dbAfter(glowing);
    const glowA = w(L(1), /glo/i, L(1).start + 0.6);
    return { s, e, lines, A, B, C, D, F, spaceA, glowA, take, my, hand, every, broken, shatter, becomes, star, fly0, look, beautiful, pull, we, are, so, dive1, down, land, loud, raise, wake, town, dance2, spaceD, last: last.start, glowing, pullD, inn, the, dark, glos };
  }

  private beatPulse(t: number, hl = 0.09) {
    const a = this.ctx.audio, b = a.timeOfBeat(Math.floor(a.beatAt(t)));
    return pulse(t, b, hl);
  }

  private crowdTimes(): CrowdTimes {
    const K = this.K, n = this.n, three = n === 3;
    const endD = three ? K.e : K.e;
    const stut = (t: number) => K.glos.slice(0, 3).reduce((a, g) => a + 1.6 * pulse(t, g, 0.1), 0);
    const imp = (t: number) => {
      const st = (x: number, k: number) => k * ease.outExpo(prog(t, x, x + 0.18));
      return Math.max(st(K.inn, 0.25), st(K.the, 0.5), st(K.dark, 0.8)) + 0.2 * prog(t, K.dark + 0.18, K.e, ease.inCubic);
    };
    return {
      form0: K.fly0, form1: K.pull + 0.9,
      take: K.take, my: K.my, hand: K.hand,
      energy: (t) => (t < K.hand ? (t < K.glowA ? 0.75 : 0.95) : t < (three ? K.F : K.spaceD) ? 0.55 : 1),
      chain: (t) => {
        const on = smoothstep(K.hand + 0.1, K.hand + 0.7, t);
        const off = three ? 0 : smoothstep(K.spaceD - 0.3, K.spaceD + 0.2, t) * (1 - smoothstep(K.glowing, K.glowing + 0.5, t));
        const fin = three ? smoothstep(K.glowing - 0.2, K.glowing + 0.4, t) * 0 : 0;
        return Math.max(0, on - off) + fin;
      },
      chainUp: (t) => {
        const b = ease.inOutCubic(prog(t, K.pull, K.pull + 0.5)) * (1 - ease.inOutCubic(prog(t, K.we - 0.3, K.are + 0.4)) * 0.6);
        const fin = smoothstep(K.glowing, K.glowing + 0.6, t);
        return Math.max(b, fin);
      },
      spin: (t, ring) => {
        const w = [0.035, -0.026, 0.02][ring]!;
        const u = Math.max(0, t - (K.pull + 0.9));
        const acc = Math.max(0, t - K.pullD);
        return w * u + w * 1.6 * acc * acc;
      },
      glow: (t) => {
        const e = this.ctx.audio.env('rms', t);
        let g = 0.85 + 0.25 * e + 0.35 * this.beatPulse(t) * (t > (three ? K.s : K.D) ? 1 : 0.4);
        g += 0.5 * smoothstep(K.glowing, K.glowing + 1.5, t) + 0.6 * smoothstep(K.pullD, endD, t);
        g += 0.8 * pulse(t, K.glowA, 0.25);
        return g * (1 - 0.85 * imp(t));
      },
      implode: imp,
      lowHero: !three,
      links: (t) => (three ? 1 : 1 - smoothstep(K.spaceD - 0.3, K.spaceD + 0.1, t) * (1 - smoothstep(K.glowing - 0.1, K.glowing + 0.4, t))),
      flash: (t) => stut(t) + (0.7 * pulse(t, K.inn, 0.1) + 0.8 * pulse(t, K.the, 0.1) + 1.0 * pulse(t, K.dark, 0.12)) * (1 - 0.7 * imp(t)),
    };
  }

  /** Who is born when, from what: formation figures from lights off the planet (or the golden star), the rest from the heart's pieces. */
  private assignBirths() {
    const K = this.K, figs = this.crowd.figs, audio = this.ctx.audio;
    const three = this.n === 3;
    // formation: in four waves on the beats, centre first
    const form = figs.filter((f) => f.formA).sort((a, b) => Math.abs(a.th0) - Math.abs(b.th0) + (a.ring - b.ring) * 0.05);
    const b0 = Math.ceil(audio.beatAt(K.spaceA + 0.1));
    const starP = V(0, R + 4.6, 6);
    form.forEach((f, k) => {
      const wave = Math.floor((k / form.length) * 4);
      if (three) {
        f.src = 'star';
        f.born = K.s + 0.3 + (k / form.length) * Math.max(0.4, audio.downbeats.find((d) => d > K.s + 0.4)! - K.s - 0.3);
        f.lights = [{ from: starP.clone(), t0: K.s - 0.05 }];
      } else {
        f.src = 'rise';
        f.born = audio.timeOfBeat(b0 + wave) + hash(f.i, f.ring, 5) * 0.08;
        const F = this.crowd.frame(f, f.born);
        for (let j = 0; j < 13; j++) {
          const from = F.p.clone().add(V((hash(f.i, j, 1) - 0.5) * 10, 0, (hash(f.i, j, 2) - 0.5) * 6)).normalize().multiplyScalar(R + 0.05);
          f.lights.push({ from, t0: f.born - 1.0 - hash(f.i, j, 3) * 0.7 });
        }
      }
    });
    // the rings: born round the planet from the top down, half of them from the heart's pieces
    const rest = figs.filter((f) => !f.formA).sort((a, b) => Math.abs(a.th0) - Math.abs(b.th0));
    const P = this.heart.pieces.length;
    const t0 = K.fly0 + 0.5, t1 = K.pull + 0.6;
    // where each piece is when the stars fly off (the heart stops turning when it bursts)
    this.poseHeart(K.shatter + 0.01);
    this.heart.updateMatrixWorld(true);
    const pieceAt = this.heart.pieces.map((_, i) => this.heart.localToWorld(this.heart.pieceLocal(i, K.fly0)));
    const pieceOrder = pieceAt.map((p, i) => [Math.atan2(p.x - this.heartPos.x, p.y - this.heartPos.y), i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
    const shardFigs = rest.filter((_, k) => k % 2 === 0 || P > rest.length).slice(0, P).sort((a, b) => a.th0 + a.ring * 0.01 - b.th0 - b.ring * 0.01);
    shardFigs.forEach((f, k) => {
      const i = pieceOrder[k]!;
      f.src = 'shard';
      f.shard = i;
      f.born = lerp(t0, t1, Math.abs(f.th0) / Math.PI) + hash(f.i, f.ring, 7) * 0.15;
      f.lights = [{ from: pieceAt[i]!.clone(), t0: K.fly0 }];
    });
    for (const f of rest) {
      if (f.src === 'shard') continue;
      f.src = 'rise';
      f.born = lerp(t0 + 0.2, t1 + 0.2, Math.abs(f.th0) / Math.PI) + hash(f.i, f.ring, 8) * 0.2;
      const F = this.crowd.frame(f, f.born);
      f.lights = [{ from: F.p.clone().normalize().multiplyScalar(R + 0.05), t0: f.born - 1.1 }];
    }
  }

  /** The heart's place: it floats and turns slowly until it bursts, then stays put. */
  private poseHeart(t: number) {
    const K = this.K, h = this.heart;
    const u = Math.min(t, K.shatter);
    h.position.copy(this.heartPos).add(V(0, 0.15 * Math.sin(u * 1.3), 0));
    h.rotation.set(0.08 * Math.sin(u * 0.9), 0.32 * Math.sin(u * 0.75) + 0.12, 0.05 * Math.sin(u * 0.6));
  }

  // ---------------------------------------------------------------- shots (chorus 1 and 2)
  private shots12(): Shot[] {
    const K = this.K, n = this.n, m = n === 2 ? -1 : 1, sp = this.spot, a = this.ctx.audio;
    const beat = (x: number, k: number) => a.timeOfBeat(Math.round(a.beatAt(x)) + k);
    const H = this.heartPos, top = R + 3.5;
    const shots: Shot[] = [];
    const her = () => this.city!.sitPos;
    const S = (name: string, t0: number, w: WorldName, c: (t: number) => Cam, into?: TransitionSpec) => shots.push({ name, t0, w, cam: c, into });
    const firstDb = a.downbeats.find((d) => d > K.s + 0.3)!;
    // A — the lights rise from the city into space
    if (n === 1) {
      S('burst', K.s - 0.5, 'city', (t) => {
        const k = prog(t, K.s - 0.4, firstDb);
        return cam(V(4.5 - 2 * k, 49.6 + 6 * ease.inQuad(k), 5 + 2 * k), V(-0.5, 54.5 + 28 * ease.inQuad(k), -16), 58 + 4 * k, -0.04);
      });
      S('rise', firstDb, 'city', (t) => {
        const k = prog(t, firstDb, K.spaceA);
        const y = 70 + 860 * ease.inCubic(k);
        const pitch = lerp(-0.95, 1.05, ease.inOutCubic(prog(t, firstDb + 0.3, K.spaceA - 0.15)));
        const p = V(-40 + 30 * k, y, 90 - 50 * k);
        return cam(p, p.clone().add(V(0.15, Math.sin(pitch), -Math.cos(pitch))), 62, 0.12 * Math.sin(k * 3));
      });
    } else {
      S('skyline', K.s - 0.5, 'city', (t) => {
        const k = prog(t, K.s - 0.3, firstDb);
        const p = V(sp.x + 420 - 80 * k, 210 + 40 * k, sp.z + 260 - 60 * k);
        return cam(p, V(sp.x - 300, 150 + 80 * k, sp.z - 900), 54, 0.06);
      });
      S('rise', firstDb, 'city', (t) => {
        const k = prog(t, firstDb, K.spaceA);
        const p = V(sp.x + 300 - 60 * k, 200 + 760 * ease.inCubic(k), sp.z + 150);
        const pitch = lerp(0.15, 1.3, ease.inOutCubic(k));
        return cam(p, p.clone().add(V(-0.3, Math.sin(pitch), -Math.cos(pitch))), 62, -0.1);
      });
    }
    S('arrive', K.spaceA, 'space', (t) => {
      const k = prog(t, K.spaceA, K.glowA, ease.outCubic);
      return cam(V(m * 3 - m * 3 * k, R + 1.0 + 2 * k, 21 - 3 * k), V(0, R + 6.5 - 1.5 * k, -6), 56 - 4 * k, m * 0.05 * (1 - k));
    }, { kind: 'light', dur: 0.4, color: lin('white', 1.2) });
    const tTrack = beat(K.glowA, 0), tPair = beat(K.take, 0) <= K.take - 0.02 ? beat(K.take, 0) : beat(K.take, -1);
    S('track', tTrack, 'space', (t) => {
      const k = ease.outExpo(prog(t, tTrack, tTrack + 0.5)) * 0.5 + 0.5 * prog(t, tTrack, tPair);
      const x = m * lerp(-17, -3, k);
      return cam(V(x, top + 1.4, 9.5), V(x + m * 7, top + 0.6, -9), 50, -m * 0.07);
    });
    S('pair', tPair, 'space', (t) => {
      const k = prog(t, tPair, K.B, ease.inOutQuad);
      return cam(V(m * (2.6 - 1.8 * k), top + 1.4 - 0.3 * k, 18 - 3.5 * k), V(0, top + 0.9, 5), 44 - 6 * k, m * 0.03);
    });
    // B — the heart
    S('heart', K.B, 'space', (t) => {
      const k = prog(t, K.B, K.shatter, ease.inOutQuad);
      return cam(V(m * (1.8 - 1.2 * k), H.y + 0.5 - 0.3 * k, H.z + 7.5 - 2.2 * k), H.clone().add(V(0, -0.4, 0)), 42 - 2 * k, 0);
    });
    S('burst', K.shatter, 'space', (t) => {
      const k = ease.outExpo(prog(t, K.shatter, K.shatter + 1.0));
      const d = prog(t, K.shatter, K.fly0);
      return cam(V(m * (0.6 - 2 * d), H.y + 0.2 + 0.8 * d, H.z + 5.3 + 5 * k + 2 * d), H.clone().add(V(0, -0.6 * d, 0)), 42 + 8 * k, m * 0.04 * k);
    });
    S('fly', K.fly0, 'space', (t) => {
      const k = prog(t, K.fly0, K.pull, ease.inOutCubic);
      return cam(V(m * (-2 + 10 * k), H.y + 1 + 16 * k, H.z + 13 + 40 * k), V(0, H.y - 2 - (H.y - 2) * k, 0), 52 - 4 * k, -m * 0.06 * k);
    });
    S('beautiful', K.pull, 'space', (t) => {
      const k = ease.outExpo(prog(t, K.pull, K.pull + 1.6));
      const d = prog(t, K.pull, K.C);
      return cam(V(m * (8 + 8 * k + 6 * d), 34 - 8 * k, 50 + 50 * k + 4 * d), V(0, 3 * (1 - k), 0), 48 - 4 * k, -m * 0.08 * (1 - k));
    });
    const tOrbit = a.downbeats.find((d) => d > K.pull + 1.2 && d < K.C - 0.3);
    if (tOrbit !== undefined) S('orbit', tOrbit, 'space', (t) => {
      const k = prog(t, tOrbit, K.C + 0.3);
      const ang = m * (-0.75 + 0.25 * k);
      return cam(V(Math.sin(ang) * 96, 40 - 10 * k, Math.cos(ang) * 96), V(0, 0, 0), 42, m * 0.1);
    });
    // C — the dive into the dark city
    const dC = this.space.dirC;
    S('dive', K.C, 'space', (t) => {
      // a push in, then on the downbeat the plunge
      const tDb = a.downbeats.find((d) => d > K.C + 0.2 && d < K.dive1 - 0.2) ?? K.C + 0.8;
      const k1 = prog(t, K.C, tDb, ease.outCubic), k2 = prog(t, tDb, K.dive1 + 0.35, ease.inCubic);
      const far = dC.clone().multiplyScalar(100).add(V(m * 12, 16, 0)), mid = dC.clone().multiplyScalar(66).add(V(m * 6, 8, 0));
      const near = dC.clone().multiplyScalar(R + 0.4);
      const p = far.clone().lerp(mid, k1).lerp(near, k2);
      return cam(p, dC.clone().multiplyScalar(R * lerp(0.2 * k1, 0.98, k2)), 42 + 24 * k2, m * (0.05 * k1 + 0.25 * k2));
    });
    S('descend', K.dive1, 'city', (t) => {
      const k = ease.outCubic(prog(t, K.dive1 - 0.25, K.land));
      const star = this.city!.fallPos(t);
      const ang = m * lerp(0.9, 0.25, k), r = lerp(260, 9, k);
      const p = star.clone().add(V(Math.sin(ang) * r, lerp(150, 3.5, k), Math.cos(ang) * r));
      return cam(p, star.clone().add(V(0, lerp(-60, 0.5, k), lerp(-120, -6, k))), 62 - 14 * k, m * 0.18 * (1 - k));
    }, { kind: 'zoom', dur: 0.5, centre: [0.5, 0.5], color: lin('white', 1.0) });
    S('alone', K.land, 'city', (t) => {
      const k = prog(t, K.land, K.raise, ease.inOutQuad);
      const c = her();
      return cam(c.clone().add(V(m * (-2.6 + 0.8 * k), 1.5 - 0.3 * k, 3.4 - 1.2 * k)), c.clone().add(V(m * 0.6, 0.9 + 1.5 * k, -9)), 50 - 4 * k, m * 0.03);
    });
    S('lift', K.raise, 'city', (t) => {
      const k = prog(t, K.raise, K.wake);
      const c = her();
      return cam(c.clone().add(V(m * (1.5 - 0.3 * k), 0.65, 3.7 - 0.5 * k)), c.clone().add(V(-m * 0.6, 5.5 + 1.5 * k, -16)), 56, -m * 0.04);
    });
    S('wave', K.wake, 'city', (t) => {
      const k = ease.outExpo(prog(t, K.wake, K.town + 0.4));
      const c = her();
      const p = c.clone().add(V(m * (1.4 + 30 * k), 0.65 + 170 * k, 3.4 + 230 * k));
      return cam(p, c.clone().add(V(0, 3, -12)).lerp(V(c.x - m * 60, 30, c.z - 900), Math.min(1, k * 1.2)), 54 + 6 * k, -m * 0.05 * (1 - k));
    });
    S('town', beat(K.town, 0), 'city', (t) => {
      const k = prog(t, beat(K.town, 0), K.D + 0.5);
      return cam(V(sp.x - m * 420 + m * 90 * k, 240 - 30 * k, sp.z + 260 - 160 * k), V(sp.x - m * 120, 70, sp.z - 1000), 54, m * 0.05);
    });
    // D — lights from every window, back up to space; the planet glows; pull away; collapse
    S('lights', K.D, 'city', (t) => {
      const k = prog(t, K.D, K.spaceD);
      const y = 160 + 480 * ease.inCubic(k);
      const pitch = lerp(-0.7, 1.15, ease.inOutCubic(prog(t, K.D + 0.6, K.spaceD - 0.1)));
      const p = V(sp.x + m * 200, y, sp.z + 380 - 300 * k);
      return cam(p, p.clone().add(V(-m * 0.25, Math.sin(pitch), -Math.cos(pitch))), 60 + 6 * k, m * 0.1 * Math.sin(k * 3));
    }, { kind: 'whip', dur: 0.35, dir: [0, 1] });
    S('planet', K.spaceD, 'space', (t) => {
      const k = prog(t, K.spaceD, K.pullD);
      if (n === 2) return cam(V(-9 + 5 * k, R + 1.6 + 1.6 * k, 16 - 3 * k), V(2, R + 5.5, -6), 60 - 4 * k, 0.08);
      const up = dC.clone();
      const side = new THREE.Vector3().crossVectors(up, V(0, 0, 1)).normalize();
      const p = up.clone().multiplyScalar(R + 2.5 + 5 * k).addScaledVector(side, m * (4 - 3 * k));
      return cam(p, V(0, R + 4, 0), 62 - 6 * k, m * 0.1);
    }, { kind: 'light', dur: 0.4, color: lin('white', 1.4) });
    // "glo-glo-glo": three jump cuts in on the rings, one per stutter
    K.glos.slice(0, 3).forEach((g, k) => {
      const off = [V(4, 2.2, 21), V(-3.2, 1.6, 13.5), V(1.2, 1.1, 8.5)][k]!;
      S(`glo${k + 1}`, g, 'space', (t) => {
        const u = prog(t, g, g + 0.45, ease.outCubic);
        return cam(V(off.x, top + off.y, off.z - 1.2 * u), V(0, top + 0.9, 0), 48 - 2 * k, [0.08, -0.1, 0.04][k]!);
      });
    });
    const tBuild = a.downbeats.find((d) => d > K.pullD + 0.8 && d < K.e - 0.8);
    const awayEnd = tBuild ?? K.e + 0.5;
    S('away', K.pullD, 'space', (t) => {
      const k = prog(t, K.pullD, awayEnd + (tBuild ? 0 : 0), ease.inOutCubic);
      const dir = this.space.dirC.clone().add(V(0, 1, 0)).normalize();
      const p = dir.clone().multiplyScalar(lerp(R + 10, tBuild ? 105 : 150, k)).add(V(m * 20 * k, 0, 0));
      return cam(p, V(0, 0, 0).lerp(V(0, R, 0), 1 - k), 56 - 10 * k, m * 0.12 * k);
    });
    // the riser: a slow orbit closing in while the rings spin up, then everything falls into one point
    if (tBuild !== undefined) S('build', tBuild, 'space', (t) => {
      const k = prog(t, tBuild, K.e + 0.5);
      const ang = m * (0.9 - 0.7 * ease.inOutQuad(k));
      const r = lerp(118, 82, ease.inCubic(k));
      return cam(V(Math.sin(ang) * r, 48 - 18 * k, Math.cos(ang) * r), V(0, 2, 0), 44 - 6 * ease.inCubic(k), -m * (0.1 + 0.25 * ease.inCubic(k)));
    });
    return shots.sort((x, y) => x.t0 - y.t0);
  }

  // ---------------------------------------------------------------- shots (chorus 3)
  private shots3(): Shot[] {
    const K = this.K, a = this.ctx.audio, H = this.heartPos, top = R + 3.5;
    const dbs = a.downbeats.filter((d) => d > K.s + 0.3 && d < K.e - 0.1);
    const beat = (x: number, k: number) => a.timeOfBeat(Math.round(a.beatAt(x)) + k);
    const shots: Shot[] = [];
    const S = (name: string, t0: number, c: (t: number) => Cam, into?: TransitionSpec) => shots.push({ name, t0, w: 'space', cam: c, into });
    S('star', K.s - 0.5, (t) => {
      const k = prog(t, K.s - 0.4, dbs[0]!, ease.outCubic);
      return cam(V(0, top + 1.2, 16 + 6 * k), V(0, top + 1 - 0.4 * k, 4), 52 + 6 * k, 0);
    });
    S('low', dbs[0]!, (t) => {
      const k = prog(t, dbs[0]!, dbs[1]!);
      return cam(V(-4 + 3 * k, R + 1.2, 19 - 2 * k), V(0, R + 6.2, -10), 58, 0.06);
    });
    S('track', dbs[1]!, (t) => {
      const k = ease.outExpo(prog(t, dbs[1]!, dbs[1]! + 0.5)) * 0.5 + 0.5 * prog(t, dbs[1]!, dbs[2]!);
      const x = lerp(16, 2, k);
      return cam(V(x, top + 1.5, 9.5), V(x - 7, top + 0.5, -9), 50, 0.07);
    });
    const tPair = beat(K.take, 0) <= K.take - 0.02 ? beat(K.take, 0) : beat(K.take, -1);
    S('behind', dbs[2]!, (t) => {
      const k = prog(t, dbs[2]!, tPair);
      return cam(V(-6 + 4 * k, top + 6 - 2 * k, -24 + 4 * k), V(0, top + 1, 4), 50, -0.05);
    });
    S('pair', tPair, (t) => {
      const k = prog(t, tPair, K.B, ease.inOutQuad);
      return cam(V(-2.4 + 1.8 * k, top + 1.3, 17.5 - 3.5 * k), V(0, top + 0.9, 5), 44 - 6 * k, -0.03);
    });
    S('heart', K.B, (t) => {
      const k = prog(t, K.B, K.shatter, ease.inOutQuad);
      return cam(V(-1.5 + 1 * k, H.y + 0.4, H.z + 7 - 1.8 * k), H.clone().add(V(0, -0.4, 0)), 42, 0);
    });
    S('burst', K.shatter, (t) => {
      const k = ease.outExpo(prog(t, K.shatter, K.shatter + 1.0));
      const d = prog(t, K.shatter, K.fly0);
      return cam(V(-0.5 + 2 * d, H.y + 0.2 + 0.8 * d, H.z + 5.2 + 5 * k + 2 * d), H.clone().add(V(0, -0.6 * d, 0)), 42 + 8 * k, -0.04 * k);
    });
    S('fly', K.fly0, (t) => {
      const k = prog(t, K.fly0, K.pull, ease.inOutCubic);
      return cam(V(2 - 12 * k, H.y + 1 + 14 * k, H.z + 13 + 36 * k), V(0, (H.y - 2) * (1 - k), 0), 52 - 4 * k, 0.06 * k);
    });
    S('beautiful', K.pull, (t) => {
      const k = ease.outExpo(prog(t, K.pull, K.pull + 1.6));
      const d = prog(t, K.pull, K.F);
      return cam(V(-8 - 10 * k - 6 * d, 34 - 8 * k, 48 + 72 * k + 4 * d), V(0, 3 * (1 - k), 0), 48 - 4 * k, 0.08 * (1 - k));
    });
    // the finale: low over the ring with the sun breaking over the limb, then pull away into the flash
    // the finale: low over the ring with the sun about to break over the limb; it breaks on "glowing";
    // the last bar pulls away and everything falls into one golden point
    const tSun = a.downbeats.find((d) => d >= K.glowing - 0.2 && d < K.e - 1) ?? K.glowing;
    const tLast = a.downbeats.find((d) => d > tSun + 0.8 && d < K.e - 0.6);
    S('finale', K.F, (t) => {
      const k = prog(t, K.F, tSun, ease.inOutQuad);
      return cam(V(3 - 4 * k, top + 2.2 + 0.6 * k, 15 - 2 * k), V(0, top + 4.5, -14), 52, 0.04);
    }, { kind: 'light', dur: 0.4, color: lin('gold', 1.4) });
    S('sunrise', tSun, (t) => {
      const k = prog(t, tSun, tLast ?? K.e + 0.5, ease.outCubic);
      return cam(V(-2 - 16 * k, top + 3 + 20 * k, 16 + 50 * k), V(0, top + 2 - 16 * k, -6 + 6 * k), 54 - 6 * k, -0.06 * k);
    });
    if (tLast !== undefined) S('last', tLast, (t) => {
      const k = prog(t, tLast, K.e + 0.5, ease.inOutCubic);
      const ang = -0.45 + 0.35 * k;
      const r = lerp(85, 125, k);
      return cam(V(Math.sin(ang) * r, 30 - 8 * k, Math.cos(ang) * r), V(0, 4 * (1 - k), 0), 44, -0.1 - 0.2 * ease.inCubic(k));
    });
    return shots.sort((x, y) => x.t0 - y.t0);
  }

  // ---------------------------------------------------------------- per frame
  private poseSpace(t: number, c: Cam) {
    const K = this.K, sw = this.space, n = this.n, three = n === 3;
    const st = sw.st;
    this.applyCam(st.cam, c);
    sw.update(t);
    // the planet: its lights wake in a wave from the dive city in D, flare on "glowing"; a beat pulse
    const wA = three ? 0 : smoothstep(K.spaceD - 0.2, K.glowing, t);
    const dC = sw.dirC;
    const flare = (three ? smoothstep(K.glowing - 0.3, K.glowing + 1.5, t) : smoothstep(K.glowing - 0.2, K.glowing + 1.2, t)) + 0.6 * smoothstep(K.pullD, K.e, t);
    sw.wave(dC, three ? Math.PI : (wA > 0 ? lerp(0.05, Math.PI, ease.outCubic(wA)) : 0), 0.35 + 1.0 * flare + (three ? 0.15 : 0), 0.25 * this.beatPulse(t) + this.crowd.T.flash(t) * 0.2, 0.18);
    sw.earth.surface.material.uniforms.cityGain!.value = 1 + 0.6 * flare;
    const gather = three ? 0 : smoothstep(K.spaceD - 0.3, K.spaceD + 0.8, t);
    const ak = three ? 0 : 1.4 * gather + 0.6 * flare;
    sw.aurora.material.uniforms.k!.value = ak;
    sw.aurora.visible = ak > 0.01;
    // (the light shell only matters once the planet wakes; the nebula only where it is a backdrop: chorus 2, 3)
    sw.shell.visible = three || t > K.spaceD - 0.6;
    sw.neb.visible = this.look.space.nebGain > 0.05;
    (sw.neb.material as THREE.ShaderMaterial).uniforms.gain!.value = this.look.space.nebGain * (1 + 0.5 * flare);
    ((sw.neb.material as THREE.ShaderMaterial).uniforms.tint!.value as THREE.Color).copy(this.look.space.neb);
    if (three) {
      ((sw.neb.material as THREE.ShaderMaterial).uniforms.gk!.value as number) = 0.85;
      (sw.neb.material as THREE.ShaderMaterial).uniforms.gk!.value = 0.85;
    }
    // the sun (chorus 3): behind the limb as seen from the camera, rising until it breaks out on "glowing"
    if (three) {
      const toE = st.cam.position.clone().normalize().negate();
      const camUp = V(0, 1, 0).applyQuaternion(st.cam.quaternion);
      const dist = st.cam.position.length(), limb = Math.asin(Math.min(0.999, R / dist));
      const rise = smoothstep(K.s, K.glowing + 0.3, t);
      const ang = limb * lerp(0.93, 1.05, rise) + 0.012 * pulse(t, K.glowing, 0.6);
      const axis = new THREE.Vector3().crossVectors(toE, camUp).normalize();
      const dir = toE.clone().applyAxisAngle(axis, ang);
      sw.setSun(dir, 0.8 + 0.8 * rise + 0.8 * pulse(t, K.glowing, 0.5), 0.5 + 0.5 * rise, 1400);
    } else sw.setSun(V(0, 0, -1), 0, 0);
    // the implosion: the planet shrinks into the point everything falls into
    const imp = this.crowd.T.implode(t);
    const ip = dC.clone().multiplyScalar(R * 0.2);
    if (three) ip.copy(st.cam.position).normalize().multiplyScalar(R * 0.3);
    this.crowd.implodeAt.copy(ip);
    sw.earth.scale.setScalar((R / 6.371) * (1 - 0.97 * imp));
    sw.earth.position.copy(ip).multiplyScalar(imp);
    // the heart
    this.heart.visible = t > K.B - 0.6 && t < K.fly0 + 1.5;
    if (this.heart.visible) {
      this.poseHeart(t);
      this.heart.pose(t, this.ctx.audio.beatAt(t), this.n === 1 ? 0.75 : 0.6);
    }
    // the people of stars
    const camDist = st.cam.position.distanceTo(V(0, R + 4, 0));
    this.crowd.update(t, camDist, {
      shardPos: (i, tt, out) => {
        const k = this.heart.starK(i, tt);
        if (k <= 0) return null;
        return this.heart.localToWorld(out.copy(this.heart.pieceLocal(i, tt)));
      },
    });
    // the pieces' stars while they are still near the heart
    let ns = 0;
    if (this.heart.visible) {
      const p = new THREE.Vector3();
      this.heart.pieces.forEach((_, i) => {
        const k = this.heart.starK(i, t);
        if (k <= 0 || t >= K.fly0) return;
        this.heart.localToWorld(p.copy(this.heart.pieceLocal(i, t)));
        this.shards.set(ns++, p.x, p.y, p.z, this.look.crowd.star, k * (1 + 1.5 * pulse(t, K.star, 0.15)), 1.2);
      });
    }
    // the falling star (C): leaves the ring and drops toward the city
    if (!three && t > K.C - 0.2 && t < K.dive1 + 0.6) {
      // it leaves the inner ring where it passes nearest the city, and falls in an arc
      const from = dC.clone().setZ(0).normalize().multiplyScalar(RINGS[0]!.r + 0.5), to = dC.clone().multiplyScalar(R + 0.2);
      const at = (x: number) => {
        const k = ease.inOutCubic(prog(x, K.C + 0.1, K.dive1 + 0.35));
        return from.clone().lerp(to, k).addScaledVector(dC, Math.sin(k * Math.PI) * 4);
      };
      const p = at(t);
      this.shards.set(ns++, p.x, p.y, p.z, col('white', 3), 1.6, 9);
      this.shards.set(ns++, p.x, p.y, p.z, this.look.crowd.accent, 0.7, 26);
      for (let j = 1; j < 24; j++) { const q = at(t - j * 0.02); this.shards.set(ns++, q.x, q.y, q.z, this.look.crowd.accent, (1 - j / 24) * 0.9, 4 - j * 0.12); }
    }
    // the implosion's point
    if (imp > 0) {
      this.shards.set(ns++, ip.x, ip.y, ip.z, col('white', 3), imp * 3, 6 + 56 * imp);
      this.shards.set(ns++, ip.x, ip.y, ip.z, this.look.crowd.accent, imp * 2, 84 * imp);
    }
    this.shards.commit(ns);
    this.poseStreams(t);
  }

  /** Lights rising off the planet: as the formation gathers (A) and from every city in D. */
  private poseStreams(t: number) {
    const K = this.K, three = this.n === 3, s = this.streams;
    const winA: [number, number] = [K.spaceA - 1.5, K.glowA], winD: [number, number] = three ? [K.F, K.e] : [K.spaceD - 1.0, K.e];
    const dC = this.space.dirC, up = V(0, 1, 0);
    const c = this.look.crowd.star, imp = this.crowd.T.implode(t);
    let n = 0;
    const P = 2.4;
    for (let i = 0; i < s.n; i++) {
      const ph = hash(i, 1), cyc = Math.floor((t - ph * P) / P), t0 = cyc * P + ph * P, age = t - t0;
      const inA = t0 > winA[0] && t0 < winA[1], inD = t0 > winD[0] && t0 < winD[1];
      if (!inA && !inD) continue;
      const centre = inD && !three ? dC : up;
      const spread = inD ? 0.75 : 0.45;
      const a = hash(i, cyc, 2) * Math.PI * 2, r = Math.sqrt(hash(i, cyc, 3)) * spread;
      const t1 = new THREE.Vector3().crossVectors(centre, V(0.3, 0.1, 1)).normalize(), t2 = new THREE.Vector3().crossVectors(centre, t1);
      const d = centre.clone().multiplyScalar(Math.cos(r)).addScaledVector(t1, Math.sin(r) * Math.cos(a)).addScaledVector(t2, Math.sin(r) * Math.sin(a));
      const h = 0.1 + age * (1.2 + hash(i, 4) * 1.5) + age * age * (1 + hash(i, 5) * 2.5);
      const p = d.multiplyScalar(R + h);
      if (imp > 0) p.lerp(this.crowd.implodeAt, imp);
      const k = smoothstep(0, 0.3, age) * (1 - smoothstep(P * 0.6, P, age)) * (0.6 + 0.8 * hash(i, 6));
      s.set(n++, p.x, p.y, p.z, c, k * (inD ? 0.9 : 0.55), 0.6 + hash(i, 7) * 0.8);
    }
    s.commit(n);
  }

  private applyCam(c: THREE.PerspectiveCamera, k: Cam) {
    aim(c, k.p, k.tg, k.roll);
    c.fov = k.fov;
    c.updateProjectionMatrix();
  }

  private renderShot(f: Frame, shot: Shot, out: THREE.WebGLRenderTarget) {
    const t = f.t, c = shot.cam(t);
    // a little life in every shot
    const dn = V(noise1(t * 0.6, 3), noise1(t * 0.55, 5), noise1(t * 0.5, 7)).multiplyScalar(shot.w === 'city' ? (c.p.y > 200 ? 3 : 0.05) : 0.1);
    c.p.add(dn);
    c.tg.add(dn);
    if (shot.w === 'space') {
      this.poseSpace(t, c);
      this.space.st.render(this.ctx.renderer, out);
    } else {
      const cw = this.city!;
      this.applyCam(cw.st.cam, c);
      cw.update(t);
      cw.st.render(this.ctx.renderer, out);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, K = this.K, n = this.n;
    if (this.city) this.city.T = this.cityTimes();
    const shots = this.shots;
    let i = shots.length - 1;
    while (i > 0 && shots[i]!.t0 > t) i--;
    const cur = shots[i]!, next = shots[i + 1];
    // around a cut with a transition, draw both sides
    const tr = next?.into && t > next.t0 - next.into.dur / 2 ? next : cur.into && i > 0 && t < cur.t0 + cur.into.dur / 2 ? cur : null;
    if (tr) {
      const j = shots.indexOf(tr), prev = shots[j - 1]!, spec = tr.into!;
      this.renderShot(f, prev, this.rtA);
      this.renderShot(f, tr, this.rtB);
      this.tr.render(this.ctx.renderer, spec, this.rtA.texture, this.rtB.texture, (t - (tr.t0 - spec.dur / 2)) / spec.dur, out);
    } else this.renderShot(f, cur, out);

    // ---- post: hits on the beat, flashes on the big moments ----
    const a = this.ctx.audio; void a;
    const hot = n === 3 || t > K.D - 0.1 ? 1 : t > K.C ? 0.6 : 0.35;
    const bp = this.beatPulse(t, 0.07) * hot;
    const shatter = pulse(t, K.shatter, 0.12);
    const wake = n === 3 ? 0 : pulse(t, K.wake, 0.15);
    const stut = K.glos.slice(0, 3).reduce((s, g) => s + pulse(t, g, 0.09), 0);
    const fin = this.crowd.T.flash(t) - K.glos.slice(0, 3).reduce((s, g) => s + 1.6 * pulse(t, g, 0.1), 0);
    const inFlash = t < K.s + 0.4 ? (n === 3 ? 0 : Math.pow(0.5, Math.max(0, t - K.s) / 0.05) * 0.5 * smoothstep(f.win[0], K.s, t)) : 0;
    const endFlash = smoothstep(K.e - 0.3, K.e, t);
    const sh = 7 * shatter + 9 * wake + 6 * stut + 4 * bp * (t > K.D ? 1 : 0.3) + 3 * fin;
    const z = 1 + 0.018 * bp + 0.05 * stut + K.glos.slice(0, 3).reduce((s, g, k) => s + (t > g ? 0.02 * (k + 1) * (1 - smoothstep(K.glos[3]!, K.glos[3]! + 0.4, t)) : 0), 0);
    const city = cur.w === 'city';
    return {
      bloom: 0.95 + 0.35 * shatter + 0.25 * stut + 0.3 * endFlash, bloomThreshold: city ? 0.8 : 0.72, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.05,
      ca: 0.7 + 2.5 * shatter + 2 * stut + 1.5 * endFlash,
      flash: Math.max(inFlash, 0.1 * wake, endFlash * endFlash * 1.1),
      shake: [noise1(t * 47, 1) * sh, noise1(t * 47, 2) * sh] as [number, number],
      zoom: z,
    };
  }

  private cityTimes() {
    const K = this.K, a = this.ctx.audio;
    const rb: number[] = [];
    for (let b = Math.ceil(a.beatAt(K.wake + 0.2)); a.timeOfBeat(b) < K.e; b++) rb.push(a.timeOfBeat(b));
    return {
      burst: K.s, riseA: this.n === 1 ? K.s : K.s - 0.7, fall0: K.dive1 - 0.3, land: K.land, stand: K.loud, raise: K.raise, wake: K.wake, town: K.town,
      riseD: K.D + 0.15, ringBeats: rb, beatAt: (t: number) => a.beatAt(t),
    };
  }
}
