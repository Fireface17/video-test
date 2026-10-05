// Drop 1, its first eight bars — the city is alive: the power is back after the blackout. On a wide crosstown
// street of tenements (lib/city.ts, street 6 between avenues −3 and −2) light runs down the roads on every
// kick like blood through veins, through the lamps and the traffic lights; the windows flash on the vocal
// chops; people dance on the fire escapes and the roofs in small groups, everyone their own dance (motion
// capture, own offsets and mirrors; people of light near the camera, stardust further away): a couple outside
// their kitchen window, kids on a low roof under string lights, a DJ's moving lights on a high roof. On the
// last "Glo-o-owing in the dark" everyone's light lifts off them like sparks, rises above the roofs and
// streams up into a turning spiral in the sky — the galaxy of people (scenes/cosmos.ts) begins. No words.
//
// Bars (downbeats from the drop): 0 the drop — diving down into the street with the first pulse; 1 along the
// fire escapes; 2 the kids' roof; 3 "Da-a-ance": the couple outside their kitchen; 4 "da-a-ance": close among
// the dancers on the DJ's roof; 5 the street wide, the lights start to lift ("Glo-"); 6 rising with them above
// the roofs; 7 looking up into the spiral they make.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, hash, mulberry32, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { City } from '../lib/city';
import { Crowd, type Person } from '../lib/crowd';
import { GlowPoints } from '../lib/points';
import { kidsRoof, djRoof, type RoofParty } from './citydrop-roofs';
import { Beams, Lifts, SpiralGlow, Veins, type LiftSource } from './citydrop-fx';
import { mirrorOnly, shiftRender } from './run-props';
import { cullOffscreen } from './run-people';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** The street: wide street 6 (z = 520) between avenues −3 (x = −625) and −2 (x = −375). */
const SZ = 520, AXW = -625, AXE = -375;
const DANCES = ['05_02', '05_12', '49_09', '49_12', '55_01', '55_02', '60_02', '61_02', '111_05', '113_04', '141_12', '94_01', '120_05', '80_43', '79_69'];

interface Dancer { p: Person; chest: THREE.Vector3; shot: number; group: number }

export default class CityDrop extends Scene {
  st = new Stage(52, 0.1, 9000);
  /** Everything in the world (the city and all), shifted to a floating origin for the draw (run-props shiftRender). */
  world = new THREE.Group();
  city!: City;
  crowd = new Crowd({ dust: [14, 90, 260], dustGain: 0.11 });
  dancers: Dancer[] = [];
  lifts!: Lifts;
  veins!: Veins;
  beads!: GlowPoints;
  beadD: { p: THREE.Vector3; d: number; c: THREE.Color }[] = [];
  beams = new Beams(5, 70, 7);
  bulbs!: GlowPoints;
  bulbPos: THREE.Vector3[] = [];
  B: number[] = [];
  chops: [number, number][] = [];
  T: Record<string, number> = {};
  /** Where things are (from the city's plan). */
  P: Record<string, THREE.Vector3> = {};
  couple: Person[] = [];
  spiral!: SpiralGlow;
  /** The two roof parties, dressed (citydrop-roofs). */
  roofs: RoofParty[] = [];

  override async init() {
    const { audio, start } = this.ctx;
    const S = this.st;
    S.bg.copy(col('night', 0.3));
    this.B = audio.downbeats.filter((d) => d >= start - 0.05).slice(0, 10);
    while (this.B.length < 10) this.B.push(this.B[this.B.length - 1]! + 1.6);
    this.chops = audio.events('chop', start - 0.1, this.ctx.end + 0.5);
    this.T.lift = this.chops.find(([t]) => t > this.B[5]! + 0.4)?.[0] ?? this.B[5]! + 0.8; // the last "Glo-"

    // ---- the city ----
    this.city = new City({});
    S.add(this.world);
    this.world.add(this.city);
    const plan = this.city.plan;
    const bld = (id: number) => plan.buildings.find((b) => b.id === id);
    const roofOf = (id: number) => { const b = bld(id); if (!b) return null; const t = b.tiers.reduce((m, q) => (q.y0 + q.h > m.y0 + m.h ? q : m), b.tiers[0]!); return { x: t.cx, z: t.cz, w: t.w, d: t.d, y: t.y0 + t.h }; };

    // ---- people ----
    await this.crowd.init([...DANCES, '77_02', '111_28']);
    this.world.add(this.crowd);
    const r = mulberry32(606);
    const pal = [col('cyan', 1.2), col('white', 1.2).lerp(col('cyan', 1.2), 0.4), col('violet', 1.15).lerp(col('white', 1.15), 0.45), col('blue', 1.2).lerp(col('cyan', 1.2), 0.5), col('white', 1.1).lerp(col('pink', 1.1), 0.3), col('gold', 1.15).lerp(col('white', 1.15), 0.4), col('#ffb38a', 1.15), col('white', 1.25)];
    let di = 0;
    const add = (pos: THREE.Vector3, yaw: number, o: Partial<Person> & { shot?: number; group?: number } = {}) => {
      const k = di++;
      const clip = DANCES[Math.floor(hash(k, 3) * DANCES.length)]!;
      const { shot, group, ...po } = o;
      const p = this.crowd.addPerson({
        pos: pos.clone(), yaw, look: 'dust', body: (hash(k, 5) < 0.5 ? 0 : 1) as 0 | 1, color: pal[Math.floor(hash(k, 7) * pal.length)]!.clone(),
        k: 1, offset: hash(k, 9) * 9, mirror: hash(k, 11) < 0.5, clips: [{ clip, from: -1e9 }], ...po,
      });
      this.dancers.push({ p, chest: pos.clone().add(V(0, 1.25 * (po.scale ?? 1), 0)), shot: shot ?? -1, group: group ?? -1 });
      return p;
    };
    // fire escapes on both sides of the street: groups of one to three on many of the landings
    const fe = this.city.anchors({ x: (AXW + AXE) / 2, z: SZ, r: 150, kinds: ['fireEscape'], seed: 3 }).filter((a) => Math.abs(a.pos.z - SZ) < 20);
    // people of light along the near fire escapes (bar 1)
    const near = fe.filter((a) => a.pos.z < SZ && a.pos.x > -468 && a.pos.x < -405 && a.pos.y > 3 && a.pos.y < 14).slice(0, 7);
    near.forEach((a, i) => {
      const along = V(a.facing.z, 0, -a.facing.x);
      const pos = a.pos.clone().addScaledVector(along, (hash(i, 41) - 0.5) * 2.4);
      add(pos, Math.atan2(a.facing.x, a.facing.z) + (hash(i, 42) - 0.5) * 1.2, { look: 'light', shot: 1, body: (i % 2) as 0 | 1, color: pal[i % pal.length]!.clone().multiplyScalar(0.95) });
    });
    fe.forEach((a, i) => {
      if (near.includes(a) || hash(i, 21) > 0.55) return;
      const n = 1 + Math.floor(hash(i, 22) * 2.6);
      const along = V(a.facing.z, 0, -a.facing.x);
      for (let k = 0; k < n; k++) {
        const u = (k - (n - 1) / 2) * 1.5 + (hash(i, k, 23) - 0.5) * 0.4;
        const pos = a.pos.clone().addScaledVector(along, u).addScaledVector(a.facing, (hash(i, k, 24) - 0.5) * 0.2);
        add(pos, Math.atan2(a.facing.x, a.facing.z) + (hash(i, k, 25) - 0.5) * 1.6, { group: i });
      }
    });
    // roofs: small groups along the edges facing the street
    const rf = this.city.anchors({ x: (AXW + AXE) / 2, z: SZ, r: 170, kinds: ['roofEdge'], seed: 5, spacing: 5 }).filter((a) => a.facing.dot(V(0, 0, Math.sign(SZ - a.pos.z))) > 0.5);
    rf.forEach((a, i) => {
      if (hash(i, 31) > 0.35) return;
      const n = 2 + Math.floor(hash(i, 32) * 3);
      const along = V(a.facing.z, 0, -a.facing.x);
      for (let k = 0; k < n; k++) {
        const pos = a.pos.clone().addScaledVector(along, (k - (n - 1) / 2) * 1.3).addScaledVector(a.facing, -1.2 - hash(i, k, 33) * 2.5);
        add(pos, Math.atan2(a.facing.x, a.facing.z) + (hash(i, k, 34) - 0.5) * 2.2, { group: 1000 + i });
      }
    });
    // further away, roofs all round (stardust: the whole neighbourhood dances)
    const far = this.city.anchors({ x: (AXW + AXE) / 2, z: SZ, r: 420, kinds: ['roof'], seed: 9, spacing: 22, max: 70 }).filter((a) => Math.abs(a.pos.z - SZ) > 30 || Math.abs(a.pos.x - (AXW + AXE) / 2) > 130);
    far.forEach((a, i) => { for (let k = 0; k < 2; k++) add(a.pos.clone().add(V(k * 1.2 - 0.6, 0, 0)), r() * 6.28, { group: 2000 + i }); });

    // the couple outside their kitchen window (building 7182's third landing): a salsa, the window lit behind them
    const cl = bld(7182)?.landings[2];
    const cpos = cl ? V(cl.x + cl.nx * 0.6, cl.y, cl.z + cl.nz * 0.6) : V(-430.5, 9.4, 506.1);
    this.P.couple = cpos;
    this.couple = [
      add(cpos.clone().add(V(-0.45, 0, 0)), Math.PI / 2, { look: 'light', body: 0, color: col('cyan', 1.05).lerp(col('white', 1.05), 0.45), offset: 2.0, mirror: false, clips: [{ clip: '60_02', from: -1e9 }], shot: 3 }),
      add(cpos.clone().add(V(0.45, 0, 0)), -Math.PI / 2, { look: 'light', body: 1, color: col('gold', 1.05).lerp(col('white', 1.05), 0.55), offset: 2.0, mirror: false, clips: [{ clip: '61_02', from: -1e9 }], shot: 3 }),
    ];
    // their kitchen window behind them, warm (a lit room seen through the glass: a soft glow on our side of it)
    const win = this.city.anchors({ x: cpos.x, z: cpos.z, r: 4, kinds: ['window'], minY: cpos.y - 0.2, maxY: cpos.y + 1.6 }).sort((a, b) => a.pos.distanceToSquared(cpos) - b.pos.distanceToSquared(cpos))[0];
    if (win) {
      // the window cut open: their kitchen behind them, its warm light on their backs
      this.city.openWindow(0, win, { light: col('#ffb36b', 1.2), depth: 3.6 });
      const halo = new GlowPoints(1, 2.2);
      const hp = win.pos.clone().addScaledVector(win.facing, 0.4).add(V(0, win.size[1] / 2, 0));
      halo.set(0, hp.x, hp.y, hp.z, col('#ffb36b', 0.12), 1, 1);
      halo.commit();
      this.world.add(halo);
      this.P.kitchen = hp;
    }
    // kids on a low roof (7194), under string lights
    const kr = roofOf(7194) ?? { x: -546.3, z: 543.9, w: 7.2, d: 18.8, y: 13.3 };
    this.P.kids = V(kr.x, kr.y, kr.z - kr.d / 2 + 3.2);
    for (let i = 0; i < 4; i++) {
      const pos = this.P.kids.clone().add(V((i - 1.5) * 1.3, 0, (hash(i, 51) - 0.5) * 1.6));
      add(pos, Math.PI + (hash(i, 52) - 0.5) * 1.5, { look: i < 3 ? 'light' : 'dust', shot: 2, scale: 0.6 + 0.1 * hash(i, 53), body: (i % 2) as 0 | 1, clips: [{ clip: ['79_69', '80_43', '49_09', '79_69'][i]!, from: -1e9 }], color: [col('white', 1.15), col('cyan', 1.1).lerp(col('white', 1.1), 0.5), col('gold', 1.05).lerp(col('white', 1.05), 0.6), col('violet', 1.1)][i]! });
    }
    const pr = mulberry32(77);
    for (let s = 0; s < 3; s++) {
      const a = this.P.kids.clone().add(V(-3 + s * 3, 2.6, 6)), b = this.P.kids.clone().add(V(-3.4 + s * 3.3 + (pr() - 0.5), 1.9, -2.6));
      for (let i = 0; i <= 14; i++) { const u = i / 14; this.bulbPos.push(a.clone().lerp(b, u).add(V(0, -0.7 * 4 * u * (1 - u), 0))); }
    }
    this.bulbs = new GlowPoints(this.bulbPos.length, 0.12);
    this.world.add(this.bulbs);
    const kb = bld(7194);
    if (kb) this.roofs.push(kidsRoof(this.city, kb, this.P.kids, this.bulbPos, 15, [7192, 7193, 7195, 7196].map(bld).filter((q): q is NonNullable<typeof q> => !!q)));
    // the DJ's roof: the tallest on the street (7177), its south edge over the street
    const dj = roofOf(7177) ?? { x: -474.9, z: 490.3, w: 19.4, d: 22.7, y: 40.1 };
    this.P.dj = V(dj.x, dj.y, dj.z + dj.d / 2 - 3.5);
    this.beams.position.copy(this.P.dj).add(V(0, 1.3, 1.5));
    this.world.add(this.beams);
    const djDance = ['05_02', '49_09', '141_12', '55_01', '113_04'];
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 1.6 - 0.8, rr = 2.2 + hash(i, 61) * 1.5;
      const pos = this.P.dj.clone().add(V(Math.sin(ang) * rr, 0, Math.min(-0.75, -1.7 + Math.cos(ang) * rr * 0.6)));
      add(pos, Math.atan2(this.P.dj.x - pos.x, this.P.dj.z + 2 - pos.z) + (hash(i, 62) - 0.5) * 0.8, { look: i < 3 ? 'light' : 'dust', shot: 4, body: (i % 2) as 0 | 1, clips: [{ clip: djDance[i]!, from: -1e9 }], offset: 1.3 * i, color: pal[(i + 2) % pal.length]!.clone() });
    }
    add(this.P.dj.clone().add(V(0, 0, 0.9)), Math.PI, { clips: [{ clip: '111_28', from: -1e9 }], color: col('white', 1.2), body: 0 });
    const db = bld(7177);
    if (db) this.roofs.push(djRoof(this.city, db, this.P.dj));
    this.world.add(...this.roofs);

    // ---- light down the streets on the kicks ----
    const lines: { pts: THREE.Vector3[]; d0: number; w: number }[] = [];
    const g = this.city.grid;
    const roadH = g.stRoadH(6), avH = g.avRoadH();
    for (const off of [-roadH + 0.3, -3.2, 0, 3.2, roadH - 0.3]) {
      lines.push({ pts: [V(AXE, 0.04, SZ + off), V(AXW - 260, 0.04, SZ + off)], d0: 0, w: Math.abs(off) > 5 ? 0.12 : 0.18 });
      lines.push({ pts: [V(AXE, 0.04, SZ + off), V(AXE + 380, 0.04, SZ + off)], d0: 0, w: 0.15 });
    }
    for (const ax of [AXE, AXW]) for (const off of [-avH + 0.3, -3.5, 0, 3.5, avH - 0.3]) for (const dir of [-1, 1]) {
      lines.push({ pts: [V(ax + off, 0.04, SZ), V(ax + off, 0.04, SZ + dir * 600)], d0: Math.abs(ax - AXE), w: 0.15 });
    }
    this.veins = new Veins(lines, col('cyan', 1.4).lerp(col('white', 1.4), 0.35));
    this.veins.material.uniforms.speed!.value = 150;
    this.veins.setKicks(audio.events('kick', start - 0.05, this.ctx.end).filter(([, s]) => s > 0.5));
    this.world.add(this.veins);
    // beads of light on the lamps and signals along those streets, flaring as the pulse goes by
    for (const l of plan.lamps) {
      const onSt = Math.abs(l.z - SZ) < 14 && l.x > AXW - 260 && l.x < AXE + 380, onAv = (Math.abs(l.x - AXE) < 14 || Math.abs(l.x - AXW) < 14) && Math.abs(l.z - SZ) < 600;
      if (!onSt && !onAv) continue;
      const d = onSt ? Math.abs(l.x - AXE) : Math.abs(l.x - AXE) + Math.abs(l.z - SZ);
      this.beadD.push({ p: V(l.x + l.ax * 1.95, l.h * 0.955, l.z + l.az * 1.95), d, c: col('cyan', 1).lerp(col('white', 1), 0.5) });
    }
    for (const s of plan.signals) {
      if (Math.abs(s.iz - SZ) > 2 || (Math.abs(s.ix - AXE) > 2 && Math.abs(s.ix - AXW) > 2)) continue;
      this.beadD.push({ p: V(s.x, 4.2, s.z), d: Math.abs(s.ix - AXE) + 2, c: col('phosphor', 1).lerp(col('cyan', 1), 0.5) });
    }
    this.beads = new GlowPoints(Math.max(1, this.beadD.length), 0.35);
    this.world.add(this.beads);

    // ---- everyone's light lifts off them (the last "Glo-o-owing") ----
    const sources: LiftSource[] = this.dancers.map((d, i) => ({
      pos: d.chest, t0: this.T.lift + 0.05 + Math.pow(hash(i, 71), 1.5) * 0.9, dur: 2.0, color: d.p.color.clone().lerp(col('white', 1.2), 0.12).multiplyScalar(d.p.look === 'light' ? 1.4 : 1.1), n: d.p.look === 'light' ? 26 : 8,
    }));
    this.lifts = new Lifts(sources);
    this.lifts.axis.set((AXW + AXE) / 2 + 20, 165, SZ - 20);
    this.world.add(this.lifts);
    this.spiral = new SpiralGlow(170, col('cyan', 0.5).lerp(col('white', 0.5), 0.4));
    this.spiral.position.copy(this.lifts.axis);
    this.world.add(this.spiral);
    mirrorOnly(this.city, [this.crowd, this.lifts, this.beads, this.bulbs, this.beams, ...this.roofs]);
  }

  private bar(t: number) {
    let i = 0;
    for (let k = 0; k < 8; k++) if (this.B[k]! <= t) i = k;
    return i;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, B = this.B;
    const bi = this.bar(t), u = clamp((t - B[bi]!) / (B[bi + 1]! - B[bi]!));

    // ---- the street's pulse; the windows on the chops ----
    this.veins.time = t;
    let chop = 0, seed = 0;
    for (const [ct, s] of this.chops) if (ct <= t && t - ct < 0.6) { const k = s * Math.exp(-(t - ct) / 0.14); if (k > chop) { chop = k; seed = ct; } }
    this.city.flash(clamp(0.55 * chop), Math.floor(seed * 100) % 997);
    this.city.windowGain = 1 + 0.6 * chop + 0.15 * f.a.kick;
    this.city.lampGain = 1 + 0.5 * f.a.kick;
    this.city.veins(0.06 + 0.22 * f.a.kick, col('cyan', 1).lerp(col('white', 1), 0.4));
    this.beadD.forEach((b, i) => this.beads.set(i, b.p.x, b.p.y, b.p.z, b.c, 0.15 + 1.6 * Math.min(2, this.veins.level(b.d, t)), 1));
    this.beads.commit();
    this.bulbPos.forEach((p, i) => {
      const c = [col('gold', 1.4), col('ember', 1.3), col('white', 1.4), col('pink', 1.2)][i % 4]!;
      this.bulbs.set(i, p.x, p.y, p.z, c, 0.9 + 0.5 * Math.sin(t * 3 + i * 1.7) * (i % 3 === 0 ? 1 : 0.2) + 0.6 * f.a.kick, 1);
    });
    this.bulbs.commit();
    this.beams.update(t, f.beat, [col('cyan', 1), col('violet', 1), col('white', 1), col('pink', 1)], 1 - 0.6 * smoothstep(this.T.lift, this.T.lift + 2, t));

    // ---- people dancing; then their light lifting off them ----
    this.dancers.forEach((d, i) => {
      const t0 = this.lifts.sources[i]!.t0, a = t - t0;
      d.p.k = 1 - 0.4 * smoothstep(0, 2, a) + 1.4 * (a > 0 ? Math.exp(-a * 4) : 0) + 0.25 * f.a.kick;
    });

    this.camera(bi, u, t);
    this.lifts.update(t, S.cam.position);
    this.spiral.update(t, smoothstep(this.T.lift + 1.6, this.T.lift + 3.6, t) * 0.3, this.lifts.spin);
    cullOffscreen(this.crowd.people, S.cam);
    // (the wet street's reflection only where the street is in the picture)
    this.city.mirrorOn = bi === 0 || bi === 1 || bi === 5;
    this.crowd.update(t, S.cam);
    // the people light the walls around them (the nearest)
    const gl = this.dancers.map((d) => ({ d: d.chest.distanceToSquared(S.cam.position), pos: d.chest, color: d.p.color.clone().multiplyScalar(0.09), radius: 3 })).sort((a, b) => a.d - b.d).slice(0, 11);
    if (this.P.kitchen) gl.push({ d: 0, pos: this.P.kitchen, color: col('#ffb36b', 0.35), radius: 3.5 });
    // the roofs: drawn only near the camera; their bulbs, gear and the dancers' feet light their floors
    for (const R of this.roofs) {
      R.visible = R.centre.distanceTo(S.cam.position) < 90;
      if (!R.visible) continue;
      const kOf = (p: Person) => (typeof p.k === 'number' ? p.k : p.k(t));
      const feet = this.dancers.filter((d) => Math.abs(d.chest.y - 1.0 - R.centre.y) < 1.5 && Math.hypot(d.chest.x - R.centre.x, d.chest.z - R.centre.z) < 9 && kOf(d.p) > 0.05)
        .map((d) => ({ p: d.chest.clone().setY(R.centre.y + 0.35), c: d.p.color.clone().multiplyScalar((d.p.look === 'light' ? 0.06 : 0.025) * Math.min(1.5, kOf(d.p))) }));
      R.update(t, f.a.kick, f.beat, feet);
      if (R.centre.distanceTo(S.cam.position) < 30) for (const q of R.keyLights) if (gl.length < 16) gl.push({ d: 0, ...q });
    }
    this.city.setGlows(gl);
    this.city.update(t, S.cam.position);
    shiftRender(this.ctx.renderer, S.scene, S.cam, this.world, this.city, out, S.bg);
    const hit = pulse(t, B[0]!, 0.25);
    return { bloom: 0.95, bloomThreshold: 0.75, bloomRadius: 0.85, halation: 0.14, vignette: 0.42, grain: 0.05, ca: 0.8 + 1.5 * hit, flash: 0.12 * hit, shake: [0.004 * f.a.kick, 0.004 * f.a.kick] as [number, number] };
  }

  private camera(bi: number, u: number, t: number) {
    const S = this.st, P = this.P;
    let pos: THREE.Vector3, tgt: THREE.Vector3, fov = 52, roll = 0;
    const e = ease.inOutCubic(u);
    switch (bi) {
      case 0: {
        // the drop: diving down into the street from above the avenue, the first pulse racing ahead of us
        const k = ease.outCubic(u);
        pos = V(-362, 46, 540).lerp(V(-405, 12, 523), k);
        tgt = V(-470, 0, 520).lerp(V(-560, 9, 518), k);
        fov = 62 - 10 * k;
        roll = 0.25 * (1 - k);
        break;
      }
      case 1: {
        // across the street at the second floor, along the fire escapes full of dancers
        pos = V(-408 - 22 * e, 9.5 + 1.5 * e, 517.5);
        tgt = V(-424 - 22 * e, 9.0, 504.5);
        fov = 54;
        break;
      }
      case 2: {
        // on the kids' roof, at their height, string lights over them, the street's fire escapes behind
        // (inside the parapet, the roof behind them: the bulkhead's lit door, the couch, the strings, the row behind)
        const a = 0.55 - 0.9 * e;
        pos = P.kids!.clone().add(V(Math.sin(a) * 2.75, 1.2, -Math.cos(a) * 2.5));
        tgt = P.kids!.clone().add(V(-0.3 * Math.sin(a), 0.85, 1.2));
        fov = 52;
        break;
      }
      case 3: {
        // "Da-a-ance": the couple outside their kitchen window, a slow push in from across the street
        const c = P.couple!;
        pos = c.clone().add(V(4 - 3 * e, 1.4 - 0.3 * e, 13 - 7.5 * e));
        tgt = c.clone().add(V(0, 1.0, 0));
        fov = 40 - 6 * e;
        break;
      }
      case 4: {
        // "da-a-ance": low among the dancers on the DJ's roof, the beams over the street (a whip on each beat)
        const d = P.dj!;
        const bt = this.ctx.audio.beatAt(t), ph = bt - Math.floor(bt), wh = Math.floor(bt) % 2 ? 1 : -1;
        const swing = wh * 0.35 * (1 - ease.outExpo(clamp(ph * 2.5)));
        pos = d.clone().add(V(-3.2 + 2.2 * e, 0.75, -4.8));
        tgt = d.clone().add(V(1.2 - 1.5 * e + Math.sin(swing) * 6, 1.6, 4));
        fov = 58;
        roll = -0.06 + swing * 0.2;
        break;
      }
      case 5: {
        // the whole street from mid-height: everyone dancing; "Glo-": the lights begin to lift off them
        pos = V(-385, 9 + 3 * e, 520.5);
        tgt = V(-520, 6 + 4 * e, 519);
        fov = 56;
        break;
      }
      case 6: {
        // rising with the lights above the roofs, looking up
        const k = ease.inOutQuad(u);
        // (close to the fire escapes: the lights lift off the people on them and stream up past us)
        pos = V(-437, 8.5 + 20 * k, 515 + 4 * k);
        tgt = V(-447, 10.5 + 40 * k, 505.5).lerp(V(-460, 80, 505), k * 0.4);
        fov = 60;
        roll = 0.08 * k;
        break;
      }
      default: {
        // up into the spiral the lights are making in the sky
        const k = ease.inQuad(u);
        pos = V(-448, 26 + 16 * k, 522);
        tgt = this.lifts.axis.clone().lerp(V(-470, 50, 512), 0.4 * (1 - k));
        fov = 68 + 6 * k;
        roll = 0.08 + 0.5 * k;
        break;
      }
    }
    S.cam.fov = fov;
    S.cam.updateProjectionMatrix();
    aim(S.cam, pos, tgt, roll);
  }
}
