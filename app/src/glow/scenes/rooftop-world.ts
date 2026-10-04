// The rooftop location, shared by `rooftop` (pre-chorus 1), `rooftops` (chorus 1) and `dawn` (final chorus): the
// city of lib/city.ts (seed 11, midtown to the north), shifted so our street runs along x at z = 0, the two hero
// buildings and their roofs (rooftop-set.ts), and the small living things: pigeons on her parapet, a cat,
// steam from a chimney, his string lights, red lights on the masts. Every call into the city goes through here
// (power, waves, glows, gold, dawn, anchors), in world coordinates.
import * as THREE from 'three';
import { clamp, frameIdx, hash, mulberry32, noise1 } from '../../engine/util';
import { City, type Anchor, type AnchorKind } from '../lib/city';
import { KitBuilder, M, kitBatch, kitMaterial, type KInst } from '../lib/city-build';
import { GlowPoints } from '../lib/points';
import { CITY_OFF, RoofSet } from './rooftop-set';

export interface Glow { pos: THREE.Vector3; color: THREE.Color; radius: number }

/** The moon: north-east, low, so it rims the roofs seen from his roof and backs the bridge seen from the street. */
export const MOON_DIR = new THREE.Vector3(0.55, 0.36, -0.75).normalize();

export class RoofWorld extends THREE.Group {
  city: City;
  set: RoofSet;
  bulbs: GlowPoints;
  reds: GlowPoints;
  steam: GlowPoints;
  pigeons: THREE.Mesh;
  private pigeonBase: { p: THREE.Vector3; yaw: number; seed: number }[] = [];
  /** 0..1: the pigeons take off (from this time on) — set per scene. */
  pigeonsFly = Infinity;
  cat: THREE.Mesh;
  catPose = { p: new THREE.Vector3(0, -100, 0), yaw: 0 };

  constructor(o: { clouds?: number; mirror?: boolean } = {}) {
    super();
    const clear = RoofSet.clears();
    this.city = new City({ seed: 11, half: 1700, centre: [80, -950], downtownR: 520, clouds: o.clouds ?? 800, clear, mirror: o.mirror ?? false });
    this.city.position.copy(CITY_OFF);
    this.add(this.city);
    this.city.setMoon(MOON_DIR, new THREE.Color(0.075, 0.085, 0.12));
    this.set = new RoofSet(this.city);
    this.add(this.set);

    const S = this.set;
    this.bulbs = new GlowPoints(S.bulbs.length, 0.05);
    this.reds = new GlowPoints(4, 0.35);
    this.steam = new GlowPoints(S.steamFrom.length * 40, 1);
    this.add(this.bulbs, this.reds, this.steam);

    // pigeons: a body, a head with a beak, a tail — grey with a little sheen
    const kit = kitMaterial(this.city.U);
    const pk = new KitBuilder();
    const grey = [0.2, 0.21, 0.23, M.ALB], dark = [0.08, 0.08, 0.09, M.ALB];
    pk.sphere(0, 0.1, 0, 0.1, grey, 0.95, 0.8, 1.5, 1);
    pk.sphere(0, 0.2, 0.12, 0.055, grey, 1, 1, 1, 1);
    pk.box(0, 0.19, 0.18, 0.015, 0.015, 0.04, dark);
    pk.box(0, 0.1, -0.17, 0.09, 0.02, 0.14, dark, 0, -0.3);
    pk.box(0.02, 0.03, 0.0, 0.012, 0.06, 0.012, [0.3, 0.1, 0.08, M.ALB]).box(-0.02, 0.03, 0.0, 0.012, 0.06, 0.012, [0.3, 0.1, 0.08, M.ALB]);
    const list: KInst[] = [];
    S.perches.forEach((q, i) => {
      this.pigeonBase.push({ p: q.p.clone(), yaw: q.yaw, seed: i * 3.7 + 1 });
      list.push({ x: q.p.x, y: q.p.y, z: q.p.z, yaw: q.yaw, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0 });
    });
    this.pigeons = kitBatch(pk.geometry(), list, kit, new THREE.Vector3(0, 0, 0), 40);
    this.pigeons.frustumCulled = false;
    this.add(this.pigeons);
    // a black cat (sits by the girl on her fire escape)
    const ck = new KitBuilder();
    const fur = [0.025, 0.025, 0.03, M.ALB];
    ck.sphere(0, 0.17, 0, 0.13, fur, 0.85, 1.25, 1.0, 1);
    ck.sphere(0, 0.36, 0.06, 0.075, fur, 1, 0.92, 0.95, 1);
    ck.add(new THREE.ConeGeometry(0.03, 0.06, 4), new THREE.Matrix4().makeTranslation(0.04, 0.44, 0.06), fur).add(new THREE.ConeGeometry(0.03, 0.06, 4), new THREE.Matrix4().makeTranslation(-0.04, 0.44, 0.06), fur);
    ck.sphere(0.02, 0.37, 0.125, 0.009, [0.9, 0.85, 0.3, M.LIGHT]).sphere(-0.02, 0.37, 0.125, 0.009, [0.9, 0.85, 0.3, M.LIGHT]);
    ck.add(new THREE.TorusGeometry(0.12, 0.018, 5, 12, Math.PI * 1.2), new THREE.Matrix4().compose(new THREE.Vector3(0.0, 0.07, -0.16), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)), new THREE.Vector3(1, 1, 1)), fur);
    this.cat = kitBatch(ck.geometry(), [{ x: 0, y: -100, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.6 }], kit, new THREE.Vector3(0, 0, 0), 2);
    this.cat.frustumCulled = false;
    this.add(this.cat);
  }

  // ---------------------------------------------------------------- the city's controls, in world coordinates

  /** Electric power everywhere (0 = blackout). */
  set power(k: number) { this.city.power.level = k; }
  /** A wave of power from `from` (world): within r the level goes to `to`. */
  powerWave(slot: number, from: THREE.Vector3 | null, r = 0, to = 1, soft = 150) {
    this.city.power.wave(slot, from ? { x: from.x - CITY_OFF.x, z: from.z - CITY_OFF.z, r, soft, to } : null);
  }
  powerAt(p: THREE.Vector3) { return this.city.power.at(p.x - CITY_OFF.x, p.z - CITY_OFF.z); }
  /** The people's light on the walls (world positions; up to 16). */
  glows(list: Glow[]) { this.city.setGlows(list.slice(0, 16)); }
  /** Gold inside radius r around `from` (world). */
  gold(k: number, from: THREE.Vector3, r: number) {
    this.city.gold = k;
    this.city.goldWave(from.clone().sub(CITY_OFF), r);
  }
  set dawn(k: number) { this.city.dawn = k; }
  setSun(dir: THREE.Vector3, c?: THREE.Color) { this.city.setSun(dir, c); }

  /** Places for people in the city's architecture (world coordinates). */
  anchors(x: number, z: number, r: number, kinds: AnchorKind[], o: { max?: number; seed?: number; from?: THREE.Vector3; spacing?: number; minY?: number; maxY?: number } = {}): Anchor[] {
    const list = this.city.anchors({ x: x - CITY_OFF.x, z: z - CITY_OFF.z, r, kinds, max: o.max, seed: o.seed, spacing: o.spacing, minY: o.minY, maxY: o.maxY, from: o.from?.clone().sub(CITY_OFF) });
    return list.map((a) => ({ ...a, pos: a.pos.clone().add(CITY_OFF) }));
  }

  // ---------------------------------------------------------------- per frame

  update(t: number, cam: THREE.Camera, o: { wind?: number } = {}) {
    this.city.update(t, cam.position);
    this.set.update(t, o.wind ?? 0.5);
    const S = this.set;
    // his string lights: on with the power on his roof, each bulb flickering in as it warms
    const p = this.powerAt(S.heSpot);
    S.bulbs.forEach((b, i) => {
      const th = 0.15 + 0.6 * hash(i, 4);
      const d = p - th;
      const on = d < 0 ? 0 : d > 0.1 ? 1 : (hash(i, frameIdx(t)) > 0.5 ? 0.6 : 0.1);
      this.bulbs.set(i, b.x, b.y, b.z, [1.0, 0.62 + 0.1 * hash(i, 2), 0.3], on * 2.2 * (1 - 0.8 * this.city.dawn), 1);
    });
    this.bulbs.commit();
    // red lights on the masts: on their own batteries, blinking
    S.redLights.forEach((q, i) => {
      const on = Math.sin((t + i * 0.7) * Math.PI * 0.9) > 0.5 ? 1 : 0.05;
      this.reds.set(i, q.x, q.y, q.z, [1, 0.06, 0.03], on * 2.5, 1);
    });
    this.reds.commit(S.redLights.length);
    // steam from the chimney: soft puffs, drifting with the wind, lit by the moon (warm once the power is back)
    let n = 0;
    S.steamFrom.forEach((s, si) => {
      const pw = this.powerAt(s);
      for (let k = 0; k < 40; k++) {
        const life = 3.2, ph = hash(k, si) * life, cyc = Math.floor((t + ph) / life), age = (t + ph - cyc * life) / life;
        const x = s.x + age * 1.6 + noise1(t * 0.6 + k, si) * 0.25 * age, y = s.y + age * 2.4, z = s.z - age * 0.7 + noise1(t * 0.5 + k, si + 9) * 0.25 * age;
        const c = new THREE.Color(0.045, 0.05, 0.065).lerp(new THREE.Color(0.08, 0.055, 0.035), pw);
        this.steam.set(n++, x, y, z, c, Math.sin(Math.PI * age) * (0.6 + 0.4 * hash(k, cyc)), 0.35 + age * 0.9);
      }
    });
    this.steam.commit(n);
    // pigeons: they shuffle, turn and peck; when they fly, they go up and away over the street
    const pos = (this.pigeons.geometry as THREE.InstancedBufferGeometry).getAttribute('iPos') as THREE.InstancedBufferAttribute;
    this.pigeonBase.forEach((b, i) => {
      const fly = clamp((t - this.pigeonsFly - (i % 4) * 0.12) / 2.5);
      const peck = Math.max(0, Math.sin(t * 2.3 + b.seed * 4.0)) ** 8 * 0.05;
      const step = noise1(t * 0.3, b.seed) * 0.12;
      const turn = b.yaw + noise1(t * 0.25, b.seed + 3) * 1.2;
      const dir = new THREE.Vector3(Math.sin(b.seed * 7.1) * 0.6, 0.55, 0.8 + Math.cos(b.seed) * 0.3);
      const x = b.p.x + step + dir.x * fly * fly * 30, y = b.p.y - peck + dir.y * fly * fly * 30 + Math.sin(fly * 60) * 0.05 * fly, z = b.p.z + dir.z * fly * fly * 30;
      pos.setXYZW(i, x, y, z, fly > 0 ? Math.atan2(dir.x, dir.z) : turn);
    });
    pos.needsUpdate = true;
    const cp = (this.cat.geometry as THREE.InstancedBufferGeometry).getAttribute('iPos') as THREE.InstancedBufferAttribute;
    cp.setXYZW(0, this.catPose.p.x, this.catPose.p.y, this.catPose.p.z, this.catPose.yaw + noise1(t * 0.4, 77) * 0.25);
    cp.needsUpdate = true;
  }
}

/** A deterministic shuffle helper for scenes. */
export function shuffled<T>(a: T[], seed: number) {
  const r = mulberry32(seed), out = a.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
