// A night city in the manner of New York (docs/glow/TREATMENT.md: «Город без света»): a Manhattan grid of avenues
// and streets with real blocks of real buildings — brick walk-ups with fire escapes, cornices and water tanks,
// pre-war apartment houses with stone bands and setbacks, lofts, white-brick post-war slabs, glass curtain-wall
// towers that mirror the sky and the neighbours, art-deco setback towers with floodlit crowns — rooftops full of
// bulkheads, AC units, chimneys and antennas with blinking red lights; streets at human scale (wet asphalt with
// reflections, crosswalks, curbs, lamps, signals, shops, traffic, trees, steam), a park, the river with a highway
// along it, an elevated line; haze, the moon, clouds, a distant skyline.
//
// Electric light is a function of place and time — `city.power` (a level, waves from points, a block mask) —
// evaluated in every shader: at 0 the city goes black (moonlit rims, the sky's glow, cars keep their lights);
// when power comes back windows pop on floor by floor with a flicker. `anchors()` gives places for people in the
// architecture. See docs/glow/SCENES.md.
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';
import { GlowPoints } from './points';
import { CityPlan, F, Grid, GRID, ST, faceNormal, type Building, type Tier } from './city-plan';
import { cityUniforms, type CityUniforms } from './city-glsl';
import {
  KitBuilder, M, antennaGeometry, balconyGeometry, buildingBatch, buildingMaterial, fireEscapeGeometry, kitBatch, kitMaterial, ringBatch, ringGeometry, ringMaterial, roofBoxGeometry, waterTowerGeometry,
  type BInst, type KInst, type RInst,
} from './city-build';
import { bakeLightMap, cobraGeometry, groundMaterial, lampColor, lightAt, parkLampGeometry, slabMaterial, slabMesh, type LightMapInfo } from './city-street';
import { cloudMaterial, skyMaterial, skylineMaterial, waterMaterial } from './city-sky';
import { CityLife } from './city-life';

export { FACADE_GLSL, CITY_GLSL } from './city-glsl';
export { GRID, Grid, ST, F } from './city-plan';

export interface CityOpts {
  seed?: number;
  /** Half-size of the generated area (m): [-half, half]² unless `bounds` is given. */
  half?: number;
  bounds?: [number, number, number, number];
  /** Midtown: tall towers around this point (x, z) within this radius. */
  centre?: [number, number];
  downtownR?: number;
  /** More clusters of tall buildings: [x, z, radius, strength 0..1]. Default: one downtown at [820, -2050]. */
  centres?: [number, number, number, number][];
  /** Keep these circles (x, z, r) free of generated buildings. */
  clear?: [number, number, number] | [number, number, number][];
  /** A park [x0, z0, x1, z1] (snapped to blocks); null for none. */
  park?: [number, number, number, number] | null;
  /** The river: water east of x (with the highway overpass along it); null for none. */
  river?: number | null;
  /** The avenue index of the elevated line (x = 125 + 250 i); null for none. */
  el?: number | null;
  /** Distance fog (FogExp2-like density) and colour. */
  fog?: number;
  fogColor?: THREE.Color;
  /** A cloud deck at this height (m), or 0 / undefined for none. */
  clouds?: number;
  /** The sky dome (moon, stars, glow, dawn). Default true. */
  sky?: boolean;
  /** The distant skyline bands. Default true. */
  skyline?: boolean;
  /** Wet streets reflect the city (an extra low-res render). Default true. */
  mirror?: boolean;
  /** Street detail density 0..1 (trees, parked cars, props). Default 1. */
  detail?: number;
  /** Moving traffic density 0..1. Default 1. */
  traffic?: number;
  /** Multiplies the distances at which small things are drawn. Default 1. */
  lod?: number;
  /** Block-grid of the city (avenues along z every 250 m, streets every 80 m). */
  grid?: typeof GRID;
  /** (old options, ignored: the grid is GRID) */
  block?: number;
  street?: number;
}

export type AnchorKind = 'window' | 'balcony' | 'fireEscape' | 'roofEdge' | 'roof' | 'sidewalk' | 'entrance' | 'el';
export interface Anchor {
  kind: AnchorKind;
  /** World position: windows — the bottom centre of the opening on the facade plane (sill); balconies / fire
   * escapes — the middle of the platform floor; roofs — on the roof; sidewalks — on the pavement (y 0.15). */
  pos: THREE.Vector3;
  /** Outward (horizontal) unit normal: the way a person there looks out. */
  facing: THREE.Vector3;
  /** Building id (index into city.plan.buildings), -1 for street places. */
  building: number;
  floor: number;
  /** Opening / platform size [w, h] (m). */
  size: [number, number];
}
export interface AnchorQuery {
  x: number; z: number; r: number;
  kinds?: AnchorKind[];
  max?: number;
  seed?: number;
  minY?: number; maxY?: number;
  /** Only places that face this point (e.g. the camera). */
  from?: THREE.Vector3;
  /** Minimum distance between returned anchors (m). */
  spacing?: number;
}

export interface PowerWave {
  x: number; z: number;
  /** Radius of the front (m). */
  r: number;
  /** Width of the front (m), default 120. */
  soft?: number;
  /** Level inside the front (0 = blackout spreading, 1 = power coming back). */
  to: number;
}

/** The city's electric power: `level` everywhere, then up to 4 waves applied in order, times a block mask. */
export class CityPower {
  level = 1;
  waves: (PowerWave | null)[] = [null, null, null, null];
  private mask: Uint8Array;
  maskTex: THREE.DataTexture;
  constructor(private city: City, public ni: number, public nj: number, public i0: number, public j0: number) {
    this.mask = new Uint8Array(ni * nj * 4).fill(255);
    this.maskTex = new THREE.DataTexture(this.mask, ni, nj, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.NearestFilter;
    this.maskTex.wrapS = this.maskTex.wrapT = THREE.ClampToEdgeWrapping;
    this.maskTex.needsUpdate = true;
  }
  /** One wave from (x, z): everything within r goes to `to`. Slot 0..3. */
  wave(slot: number, w: PowerWave | null) { this.waves[slot] = w; }
  clear() { this.level = 1; this.waves = [null, null, null, null]; this.blocks(() => 1); }
  /** Power of block (i, j) — the block between avenues i, i+1 and streets j, j+1 (see city.grid). */
  setBlock(i: number, j: number, v: number) {
    const a = i - this.i0, b = j - this.j0;
    if (a < 0 || b < 0 || a >= this.ni || b >= this.nj) return;
    const o = (b * this.ni + a) * 4;
    this.mask[o] = this.mask[o + 1] = this.mask[o + 2] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    this.maskTex.needsUpdate = true;
  }
  /** Set every block's power: fn(i, j, centreX, centreZ) → 0..1. */
  blocks(fn: (i: number, j: number, x: number, z: number) => number) {
    const g = this.city.grid;
    for (let b = 0; b < this.nj; b++) for (let a = 0; a < this.ni; a++) {
      const i = a + this.i0, j = b + this.j0;
      const v = Math.max(0, Math.min(1, fn(i, j, (g.avX(i) + g.avX(i + 1)) / 2, (g.stZ(j) + g.stZ(j + 1)) / 2)));
      const o = (b * this.ni + a) * 4;
      this.mask[o] = this.mask[o + 1] = this.mask[o + 2] = Math.round(v * 255);
    }
    this.maskTex.needsUpdate = true;
  }
  /** The power at a place (same as the shaders). */
  at(x: number, z: number) {
    let p = this.level;
    for (const w of this.waves) {
      if (!w) continue;
      const soft = w.soft ?? 120, d = Math.hypot(x - w.x, z - w.z);
      const t = Math.max(0, Math.min(1, (d - (w.r - soft)) / Math.max(soft, 1e-3)));
      const k = 1 - t * t * (3 - 2 * t);
      p += (w.to - p) * k;
    }
    const g = this.city.grid, [i, j] = g.blockOf(x, z);
    const a = Math.max(0, Math.min(this.ni - 1, i - this.i0)), b = Math.max(0, Math.min(this.nj - 1, j - this.j0));
    p *= this.mask[(b * this.ni + a) * 4]! / 255;
    const U = this.city.U;
    const dw = Math.hypot(x - U.wakeFrom.value.x, z - U.wakeFrom.value.z);
    const ws = U.wakeSoft.value, wr = U.wakeR.value;
    const t2 = Math.max(0, Math.min(1, (dw - (wr - ws)) / Math.max(ws, 1e-3)));
    p *= Math.max(0, Math.min(1, U.wake.value)) * (1 - t2 * t2 * (3 - 2 * t2));
    return Math.max(0, Math.min(1, p));
  }
  /** (internal) push to the uniforms */
  sync(U: CityUniforms) {
    U.uPow.value = this.level;
    this.waves.forEach((w, i) => {
      const a = U.uWave.value[i]!, k = U.uWaveK.value[i]!;
      if (w) { a.set(w.x, w.z, w.r, Math.max(w.soft ?? 120, 0.01)); k.set(w.to, 1, 0, 0); } else k.set(0, 0, 0, 0);
    });
  }
}

/** Tiles: big ones carry the buildings and the mid-distance things, small ones the small things seen up close. */
const TILE_X = 500, TILE_Z = 480, NEAR_X = 250, NEAR_Z = 240;

/** Instances of each kind of thing, gathered per tile. */
export class TileSet<T> {
  map = new Map<string, { origin: THREE.Vector3; lists: Map<string, T[]> }>();
  constructor(public sx: number, public sz: number) {}
  add(kind: string, x: number, z: number, item: T) {
    const a = Math.floor(x / this.sx), b = Math.floor(z / this.sz), k = `${a},${b}`;
    let t = this.map.get(k);
    if (!t) { t = { origin: new THREE.Vector3((a + 0.5) * this.sx, 0, (b + 0.5) * this.sz), lists: new Map() }; this.map.set(k, t); }
    let l = t.lists.get(kind);
    if (!l) t.lists.set(kind, (l = []));
    l.push(item);
  }
  /** Build every tile into a LOD (drawn within `dist`) using make(kind, list, origin) → mesh. */
  build(parent: THREE.Object3D, dist: number, make: (kind: string, list: T[], origin: THREE.Vector3) => THREE.Object3D | null, lods: THREE.Object3D[]) {
    for (const t of this.map.values()) {
      const g = new THREE.Group();
      for (const [kind, list] of t.lists) { const m = make(kind, list, t.origin); if (m) g.add(m); }
      if (!g.children.length) continue;
      const lod = new THREE.LOD();
      lod.position.copy(t.origin);
      g.position.set(-t.origin.x, 0, -t.origin.z);
      lod.addLevel(g, 0);
      lod.addLevel(new THREE.Object3D(), dist);
      parent.add(lod);
      lods.push(lod);
    }
  }
}

export class City extends THREE.Group {
  plan: CityPlan;
  grid: Grid;
  U: CityUniforms;
  power: CityPower;
  /** The buildings' material (its uniforms are the shared city uniforms). */
  mat: THREE.ShaderMaterial;
  groundMat: THREE.ShaderMaterial;
  /** Lamp heads (GlowPoints; colours are rewritten by update() from the power). */
  lamps: GlowPoints;
  lampHalos: GlowPoints;
  beacons: GlowPoints;
  /** Building footprints (x, z, w, d, h). */
  boxes: [number, number, number, number, number][];
  lm: LightMapInfo;
  life: CityLife;
  sky?: THREE.Mesh;
  cloudMat?: THREE.ShaderMaterial;
  ground: THREE.Mesh;
  /** The elevated line (if any): avenue x, rail-top height, extent along z, the station's z. */
  el: { x: number; y: number; z0: number; z1: number; station: number; tracks: [number, number] } | null = null;
  /** The highway overpass along the river (if any): its centre x, deck height, extent along z. */
  overpass: { x: number; y: number; z0: number; z1: number; lanes: number[] } | null = null;
  /** Multipliers for the lamps' glow and the shop signs (e.g. pulses on the kicks). */
  lampGain = 1;
  private lampSeeds: number[] = [];
  private lampBase: Float32Array;
  private beaconSpots: [number, number, number, number][] = [];
  private mirror?: Mirror;
  /** the distance-drawn groups of small things (hidden from the mirror pass) */
  lods: THREE.Object3D[] = [];
  midTiles!: TileSet<unknown>;
  nearTiles!: TileSet<unknown>;
  private o: CityOpts;
  private t = 0;

  constructor(o: CityOpts = {}) {
    super();
    this.o = o;
    const half = o.half ?? 1700;
    const bounds = o.bounds ?? [-half, -half, half, half];
    const centre = o.centre ?? [80, -950];
    const clears = !o.clear ? [] : Array.isArray(o.clear[0]) ? (o.clear as [number, number, number][]) : [o.clear as [number, number, number]];
    this.grid = new Grid(o.grid ?? GRID);
    const river = o.river === undefined ? 1160 : o.river;
    const el = o.el === undefined ? 1 : o.el;
    this.plan = new CityPlan({
      seed: o.seed ?? 3, bounds, clear: clears,
      centres: [[centre[0], centre[1], o.downtownR ?? 520, 1], ...(o.centres ?? [[820, -2050, 380, 0.9] as [number, number, number, number]])],
      park: o.park === undefined ? [-625, -440, -375, -120] : o.park,
      river, el, detail: o.detail ?? 1,
    }, this.grid);
    const plan = this.plan, g = this.grid;
    this.boxes = plan.boxes();
    this.U = cityUniforms({ fog: o.fog ?? 0.0006, fogColor: o.fogColor ?? new THREE.Color(0.016, 0.018, 0.045) });
    const U = this.U;
    // power mask over the blocks
    const [i0, i1] = plan.iRange, [j0, j1] = plan.jRange;
    this.power = new CityPower(this, i1 - i0 + 1, j1 - j0 + 1, i0, j0);
    U.uBlockMask.value = this.power.maskTex;
    U.uMaskRect.value.set(g.avX(i0), g.stZ(j0), 1 / ((i1 - i0 + 1) * g.s.avPitch), 1 / ((j1 - j0 + 1) * g.s.stPitch));
    // light map
    const lr = mulberry32((o.seed ?? 3) * 101 + 1);
    this.lampSeeds = plan.lamps.map(() => lr());
    this.lm = bakeLightMap(plan, this.lampSeeds);
    U.uLightMap.value = this.lm.tex;
    U.uLMRect.value.copy(this.lm.rect);

    // ---- buildings ----
    this.mat = buildingMaterial(U);
    const ringMat = ringMaterial(U);
    const kitMat = kitMaterial(U), kitMat2 = kitMaterial(U, { side: THREE.DoubleSide, streetK: 1.2 });
    // buildings in big tiles (always drawn), small things in tiles drawn only within a distance
    const big = new Map<string, BInst[]>(), bigO = new Map<string, THREE.Vector3>();
    const mid = new TileSet<unknown>(TILE_X, TILE_Z), near = new TileSet<unknown>(NEAR_X, NEAR_Z);
    for (const b of plan.buildings) {
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, a = Math.floor(cx / TILE_X), c = Math.floor(cz / TILE_Z), k = `${a},${c}`;
      if (!big.has(k)) { big.set(k, []); bigO.set(k, new THREE.Vector3((a + 0.5) * TILE_X, 0, (c + 0.5) * TILE_Z)); }
      this.addBuilding(b, big.get(k)!, mid, near);
    }
    plan.lamps.forEach((l, i) => {
      if (l.kind === 1) near.add('park', l.x, l.z, { x: l.x, y: 0.15, z: l.z, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.5 + this.lampSeeds[i]! * 0.49 } as KInst);
      else if (l.kind === 0) near.add('cobra', l.x, l.z, { x: l.x, y: 0.15, z: l.z, yaw: Math.atan2(-l.az, l.ax), sx: 1, sy: l.h / 9, sz: 1, col: [1, 1, 1], k: 0.5 + this.lampSeeds[i]! * 0.49 } as KInst);
    });
    const lod = o.lod ?? 1;
    const geoRingC = ringGeometry([[0, 0, 0], [0.22, 0.25, 0], [0.3, 0.3, 0], [0.42, 0.38, 0], [0.7, 0.92, 0], [0.82, 1, 0], [1, 1, 0]], 0.35, false);
    const geoRingP = ringGeometry([[0, 0, 0.0], [1, 0, 0.0], [1, 0, 0.06]], 0.32, true);
    const geo: Record<string, THREE.BufferGeometry> = {
      water: waterTowerGeometry(), roofBox: roofBoxGeometry(), ant: antennaGeometry(), fe: fireEscapeGeometry(), bal: balconyGeometry(), cobra: cobraGeometry(), park: parkLampGeometry(),
    };
    const rad: Record<string, number> = { water: 8, roofBox: 3, ant: 1, fe: 4, bal: 2, cobra: 10, park: 5 };
    for (const [k, list] of big) this.add(buildingBatch(list, this.mat, bigO.get(k)!));
    this.lods = [];
    const make = (kind: string, list: unknown[], origin: THREE.Vector3) => {
      if (kind === 'cornice') return ringBatch(geoRingC, list as RInst[], ringMat, origin);
      if (kind === 'parapet') return ringBatch(geoRingP, list as RInst[], ringMat, origin);
      const g = geo[kind];
      if (!g) return null;
      return kitBatch(g, list as KInst[], kind === 'fe' || kind === 'bal' ? kitMat2 : kitMat, origin, rad[kind] ?? 4);
    };
    mid.build(this, 1500 * lod, make, this.lods);
    near.build(this, 430 * lod, make, this.lods);
    this.midTiles = mid; this.nearTiles = near;

    // ---- ground, sidewalks, water ----
    const elX = el !== null ? g.avX(el) : null;
    this.groundMat = groundMaterial(U, g.glsl(), river, elX);
    (this.groundMat.uniforms as Record<string, THREE.IUniform>).uVein = { value: new THREE.Vector4(0, 0, 0, 0) };
    (this.groundMat.uniforms as Record<string, THREE.IUniform>).uVeinC = { value: new THREE.Color(1, 0.7, 0.3) };
    const gx0 = bounds[0] - 4000, gx1 = river !== null ? river + 15 : bounds[2] + 4000, gz0 = bounds[1] - 4000, gz1 = bounds[3] + 4000;
    const gg = new THREE.PlaneGeometry(gx1 - gx0, gz1 - gz0);
    gg.rotateX(-Math.PI / 2);
    gg.translate((gx0 + gx1) / 2, 0, (gz0 + gz1) / 2);
    this.ground = new THREE.Mesh(gg, this.groundMat);
    this.ground.frustumCulled = false;
    this.ground.renderOrder = -1;
    this.add(this.ground);
    const slabs = slabMesh(plan, slabMaterial(U));
    this.add(slabs);
    const mirrorHide: THREE.Object3D[] = [this.ground, slabs, ...this.lods];
    if (river !== null) {
      const wg = new THREE.PlaneGeometry(16000, 16000);
      wg.rotateX(-Math.PI / 2);
      wg.translate(river + 15 + 8000, -1.3, 0);
      const water = new THREE.Mesh(wg, waterMaterial(U));
      water.frustumCulled = false;
      this.add(water);
      mirrorHide.push(water);
      // the bulkhead along the water
      const wallGeo = new KitBuilder().box(0, 0.5, 0, 1, 1, 1, [0.2, 0.19, 0.18, M.ALB]).geometry();
      const wall = kitBatch(wallGeo, [{ x: river + 15.4, y: -1.45, z: (bounds[1] + bounds[3]) / 2, yaw: 0, sx: 0.8, sy: 1.6, sz: bounds[3] - bounds[1] + 8000, col: [1, 1, 1], k: 0 }], kitMaterial(U), new THREE.Vector3(river, 0, 0));
      wall.frustumCulled = false;
      this.add(wall);
    }

    // ---- traffic, signals, shops, signs, trees, props, steam, the el, the overpass ----
    this.life = new CityLife(this, o);
    this.add(this.life);
    mirrorHide.push(...this.life.mirrorHide);
    if (el !== null) {
      const x = g.avX(el);
      this.el = { x, y: 9.6, z0: bounds[1], z1: bounds[3], station: g.stZ(0), tracks: [x - 2.1, x + 2.1] };
    }
    if (river !== null) this.overpass = { x: river - 16, y: 8.5, z0: bounds[1] - 600, z1: bounds[3] + 600, lanes: [-5.4, -1.8, 1.8, 5.4].map((d) => river - 16 + d) };

    // ---- lamps: glow sprites at the heads (+ soft halos in the haze) ----
    const lampPos = plan.lamps.map((l) => (l.kind === 1 ? [l.x, l.h, l.z] : [l.x + l.ax * 1.95, l.h * 0.955, l.z + l.az * 1.95]));
    this.lamps = new GlowPoints(lampPos.length, 0.9, { fogDensity: (o.fog ?? 0.0006) * 0.9 });
    this.lampHalos = new GlowPoints(lampPos.length, 7, { fogDensity: (o.fog ?? 0.0006) * 0.9 });
    lampPos.forEach(([x, y, z], i) => {
      const c = lampColor(plan.lamps[i]!, this.lampSeeds[i]!);
      this.lamps.set(i, x!, y!, z!, c, 2.4, plan.lamps[i]!.kind === 1 ? 0.8 : 1);
      this.lampHalos.set(i, x!, y!, z!, c, 0.035, 1);
    });
    this.lamps.commit(); this.lampHalos.commit();
    this.lampBase = this.lamps.colors.slice();
    this.add(this.lamps, this.lampHalos);
    // aviation lights: antennas and the tallest roofs
    for (const b of plan.buildings) {
      for (const a of b.roof) if (a.kind === 3) this.beaconSpots.push([a.x, a.y + a.h, a.z, b.seed / 997]);
      if (b.h > 140 && !b.roof.some((a) => a.kind === 3)) { const t = b.tiers[b.tiers.length - 1]!; this.beaconSpots.push([t.cx, b.h + 1 + (b.spire || 0), t.cz, b.seed / 997]); }
    }
    this.beacons = new GlowPoints(Math.max(1, this.beaconSpots.length), 1.6, { fogDensity: (o.fog ?? 0.0006) * 0.5 });
    this.add(this.beacons);

    // ---- sky, clouds, the far skyline ----
    if (o.sky !== false) {
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), skyMaterial(U));
      this.sky.renderOrder = -10;
      this.sky.frustumCulled = false;
      this.add(this.sky);
    }
    if (o.clouds) {
      this.cloudMat = cloudMaterial(U);
      const deck = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), this.cloudMat);
      deck.rotation.x = -Math.PI / 2;
      deck.position.y = o.clouds;
      deck.renderOrder = -2;
      deck.frustumCulled = false;
      this.add(deck);
    }
    if (o.skyline !== false) {
      const R = 5200;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 300, 256, 1, true).translate(0, 150, 0), skylineMaterial(U, { ring: true, tall: 220, seed: 3 }));
      ring.frustumCulled = false;
      this.add(ring);
      if (river !== null) {
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(14000, 160).translate(0, 80, 0), skylineMaterial(U, { ring: false, tall: 70, seed: 9 }));
        strip.rotation.y = -Math.PI / 2;
        strip.position.set(river + 1300, 0, 0);
        strip.frustumCulled = false;
        this.add(strip);
      }
    }
    // ---- the wet ground's reflections ----
    if (o.mirror !== false) {
      this.mirror = new Mirror(this, mirrorHide);
      this.ground.onBeforeRender = (renderer, scene, camera) => this.mirror!.update(renderer, scene, camera as THREE.PerspectiveCamera);
    }
  }

  /** Building → instances in its tile. */
  private addBuilding(b: Building, bl: BInst[], mid: TileSet<unknown>, near: TileSet<unknown>) {
    const t = {
      b: bl,
      cornice: { push: (r: RInst) => mid.add('cornice', r.x, r.z, r) }, parapet: { push: (r: RInst) => mid.add('parapet', r.x, r.z, r) },
      water: { push: (q: KInst) => mid.add('water', q.x, q.z, q) }, ant: { push: (q: KInst) => mid.add('ant', q.x, q.z, q) },
      roofBox: { push: (q: KInst) => near.add('roofBox', q.x, q.z, q) }, fe: { push: (q: KInst) => near.add('fe', q.x, q.z, q) }, bal: { push: (q: KInst) => near.add('bal', q.x, q.z, q) },
    };
    const stoneish: [number, number, number] = [b.wall[0] * 0.9 + 0.1, b.wall[1] * 0.9 + 0.09, b.wall[2] * 0.9 + 0.08];
    const masks = (top: boolean, base: boolean) => (base ? b.winFaces : 15) + 16 * (base ? b.shopFaces : 0) + (top ? 0 : 0);
    const f3 = (tr: Tier) => [masks(false, tr.y0 < 0.5), b.h, b.crown + 4 * b.pairs, b.warmth];
    for (const tr of b.tiers) {
      t.b.push({ x: tr.cx, y0: tr.y0, z: tr.cz, w: tr.w, h: tr.h, d: tr.d, f0: [b.seed, b.style, b.fH, b.gH], f1: [b.bayW, b.winW, b.winH, b.sill], f2: [...b.wall, b.density], f3: f3(tr) });
      // the roof edge of every tier: a cornice on the old ones (main tier), a parapet with coping on the rest
      const top = tr.y0 + tr.h;
      const old = b.cornice && (tr === b.tiers[0] || b.style === ST.PREWAR) && tr.h > 6;
      if (old) t.cornice.push({ x: tr.cx, y0: top - b.cornice!.h * 0.8, z: tr.cz, hx: tr.w / 2, hz: tr.d / 2, h: b.cornice!.h, proj: b.cornice!.proj, col: b.style === ST.WALKUP && b.seed % 3 === 0 ? [0.12, 0.11, 0.1] : stoneish, fancy: 1 });
      else t.parapet.push({ x: tr.cx, y0: top, z: tr.cz, hx: tr.w / 2, hz: tr.d / 2, h: b.style === ST.GLASS ? 1.3 : 0.95, proj: 0, col: b.style === ST.GLASS ? [0.1, 0.11, 0.12] : stoneish, fancy: 0 });
    }
    // the shop cornice above the storefronts
    if (b.shopFaces) { const t0 = b.tiers[0]!; t.cornice.push({ x: t0.cx, y0: b.gH - 0.3, z: t0.cz, hx: t0.w / 2, hz: t0.d / 2, h: 0.45, proj: 0.28, col: [0.08, 0.075, 0.07], fancy: 0 }); }
    for (const pl of b.plant) {
      const glassTop = b.style === ST.GLASS;
      t.b.push({ x: pl.cx, y0: pl.y0, z: pl.cz, w: pl.w, h: pl.h, d: pl.d, f0: [b.seed + 0.5, ST.PLANT, 3, 0], f1: [glassTop ? 1 : 0, glassTop ? 0 : 1, 0, 0], f2: glassTop ? [0.06, 0.065, 0.07, 0] : [...b.wall.map((c) => c * 0.8), 0] as number[], f3: [0, b.h, 0, 0] });
      t.parapet.push({ x: pl.cx, y0: pl.y0 + pl.h, z: pl.cz, hx: pl.w / 2, hz: pl.d / 2, h: 0.4, proj: 0.05, col: [0.15, 0.15, 0.15], fancy: 0 });
    }
    for (const w of b.water) t.water.push({ x: w.x, y: w.y, z: w.z, yaw: w.seed * 6.28, sx: w.r, sy: (w.stand + w.h + 1.1) / 7.7, sz: w.r, col: [1, 1, 1], k: 0 });
    for (const a of b.roof) {
      if (a.kind === 3) { t.ant.push({ x: a.x, y: a.y, z: a.z, yaw: 0, sx: a.w, sy: a.h, sz: a.w, col: [1, 1, 1], k: 0.6 }); continue; }
      const col: [number, number, number] = a.kind === 0 ? [0.42, 0.42, 0.4] : a.kind === 1 ? [0.22, 0.22, 0.23] : a.kind === 2 ? [b.wall[0] * 0.8, b.wall[1] * 0.8, b.wall[2] * 0.8] : a.kind === 4 ? [0.05, 0.06, 0.07] : [0.5, 0.5, 0.5];
      t.roofBox.push({ x: a.x, y: a.y, z: a.z, yaw: 0, sx: a.w, sy: a.h, sz: a.d, col, k: 0 });
    }
    for (const l of b.landings) t.fe.push({ x: l.x, y: l.y, z: l.z, yaw: Math.atan2(l.nx, l.nz), sx: l.w, sy: b.fH / 3.05, sz: 1, col: [1, 1, 1], k: 0 });
    for (const l of b.balconies) t.bal.push({ x: l.x, y: l.y, z: l.z, yaw: Math.atan2(l.nx, l.nz), sx: l.w, sy: 1, sz: 1, col: [1, 1, 1], k: 0 });
  }

  // ------------------------------------------------------------------ per frame

  /** Per frame: time, traffic, lamps and beacons following the power. */
  update(t: number, camPos: THREE.Vector3) {
    const U = this.U;
    this.t = t;
    U.uTime.value = t; U.t.value = t;
    this.updateMatrixWorld();
    U.uOrigin.value.setFromMatrixPosition(this.matrixWorld);
    this.power.sync(U);
    // how lit the city around the camera is (sky glow, haze colour)
    let s = 0, n = 0;
    for (const [dx, dz] of [[0, 0], [600, 0], [-600, 0], [0, 600], [0, -600], [1200, -1200], [-1200, -1200], [0, -1600], [1200, 1200], [-1200, 1200]] as const) {
      s += this.power.at(camPos.x + dx, camPos.z + dz); n++;
    }
    U.uGlowK.value = (s / n) * (1 - 0.7 * U.uDawn.value);
    // lamps: power with a threshold per lamp (they come on one by one, sodium warming red → orange)
    const L = this.lamps, H = this.lampHalos, base = this.lampBase;
    const dawn = U.uDawn.value;
    for (let i = 0; i < L.n; i++) {
      const p = this.power.at(L.pos[i * 3]!, L.pos[i * 3 + 2]!);
      const th = 0.08 + 0.55 * this.lampSeeds[i]!, d = p - th;
      let k = d < 0 ? 0 : d > 0.12 ? 1 : (Math.sin((t * 23 + i * 7.1) * 1.7) > -0.2 ? 0.25 + 4 * d : 0.05);
      k *= this.lampGain * (1 - 0.95 * dawn);
      const warm = Math.min(1, Math.max(0, d / 0.3));
      const r = base[i * 3]!, gg = base[i * 3 + 1]!, b = base[i * 3 + 2]!;
      L.colors[i * 3] = r * k; L.colors[i * 3 + 1] = gg * k * (0.45 + 0.55 * warm); L.colors[i * 3 + 2] = b * k * (0.3 + 0.7 * warm);
      H.colors[i * 3] = L.colors[i * 3]! * 0.035 / 2.4; H.colors[i * 3 + 1] = L.colors[i * 3 + 1]! * 0.035 / 2.4; H.colors[i * 3 + 2] = L.colors[i * 3 + 2]! * 0.035 / 2.4;
    }
    L.commit(); H.commit();
    // aviation lights blink (on their own backup power: dim in a blackout, never off)
    this.beaconSpots.forEach(([x, y, z, ph], i) => {
      const on = Math.sin((t + ph * 3) * Math.PI * 0.8) > 0.55 ? 1 : 0.06;
      const p = 0.35 + 0.65 * this.power.at(x, z);
      this.beacons.set(i, x, y, z, [1, 0.07, 0.03], on * 2.4 * p, 1);
    });
    this.beacons.commit(this.beaconSpots.length);
    this.life.update(t, camPos);
  }

  // ------------------------------------------------------------------ looks

  /** Gold (0..1) inside the gold wave (old API). */
  set gold(k: number) { this.U.gold.value = k; }
  /** Old API: a factor on the power everywhere (0.1 = a dark town). Prefer `power`. */
  set wake(k: number) { this.U.wake.value = k; }
  /** A golden wave: inside radius `r` (m) around `from` the lights turn gold; the front flares. */
  goldWave(from: THREE.Vector3, r: number) { this.U.goldFrom.value.copy(from); this.U.goldR.value = r; }
  /** Dawn 0..1: a low warm sun, mist, the lights going out. */
  set dawn(k: number) { this.U.uDawn.value = k; }
  get dawn() { return this.U.uDawn.value; }
  /** Brightness of the windows (1 = normal; pulse it on the beat). */
  set windowGain(k: number) { this.U.gain.value = k; }
  /** Window flashes: a fraction k of all rooms (even empty ones) flash on, picked by `seed` (change it per hit). */
  flash(k: number, seed = 0) { this.life.flash(k, seed); }
  /** Light from glowing people on the walls, windows, streets: up to 16 of {pos, color (× intensity), radius}. */
  setGlows(list: { pos: THREE.Vector3; color: THREE.Color; radius: number }[]) {
    const U = this.U, n = Math.min(16, list.length);
    for (let i = 0; i < n; i++) {
      const g = list[i]!;
      U.uPGlowP.value[i]!.set(g.pos.x, g.pos.y, g.pos.z, g.radius);
      U.uPGlowC.value[i]!.set(g.color.r, g.color.g, g.color.b, 0);
    }
    U.uPGlowN.value = n;
  }
  /** The moon's direction (unit, toward the moon) and light colour. */
  setMoon(dir: THREE.Vector3, color?: THREE.Color) { this.U.uMoonDir.value.copy(dir).normalize(); if (color) this.U.uMoonCol.value.copy(color); }
  setSun(dir: THREE.Vector3, color?: THREE.Color) { this.U.uSunDir.value.copy(dir).normalize(); if (color) this.U.uSunCol.value.copy(color); }
  /** Drop pulse along the roads: k (0..1) of colour c. */
  veins(k: number, c?: THREE.Color) {
    const u = this.groundMat.uniforms as Record<string, THREE.IUniform>;
    (u.uVein!.value as THREE.Vector4).x = k;
    if (c) (u.uVeinC!.value as THREE.Color).copy(c);
  }

  // ------------------------------------------------------------------ places

  /** The static street light at a place (lamps, shops) times the power there — to light things you add. */
  lightAt(x: number, z: number) {
    const [r, g, b] = lightAt(this.lm, x, z), p = this.power.at(x, z);
    return new THREE.Color(r * p, g * p, b * p);
  }

  /** The building whose top tier's roof is nearest (x, z). */
  roofNear(x: number, z: number) {
    let best: Building | null = null, bd = Infinity;
    for (const b of this.plan.buildings) {
      const t = b.tiers.reduce((m, q) => (q.y0 + q.h > m.y0 + m.h ? q : m), b.tiers[0]!);
      const dx = Math.max(t.cx - t.w / 2 - x, 0, x - t.cx - t.w / 2), dz = Math.max(t.cz - t.d / 2 - z, 0, z - t.cz - t.d / 2);
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) return null;
    const t = best.tiers.reduce((m, q) => (q.y0 + q.h > m.y0 + m.h ? q : m), best.tiers[0]!);
    return { building: best, x0: t.cx - t.w / 2, z0: t.cz - t.d / 2, x1: t.cx + t.w / 2, z1: t.cz + t.d / 2, y: t.y0 + t.h, cx: t.cx, cz: t.cz };
  }

  /** Centre of the intersection of avenue i and street j. */
  intersection(i: number, j: number) { return new THREE.Vector3(this.grid.avX(i), 0, this.grid.stZ(j)); }

  /** Places for people in the architecture near (x, z). */
  anchors(q: AnchorQuery): Anchor[] {
    const kinds = new Set<AnchorKind>(q.kinds ?? ['window', 'balcony', 'fireEscape', 'roofEdge']);
    const out: Anchor[] = [];
    const r2 = q.r * q.r;
    const near = (x: number, z: number) => (x - q.x) ** 2 + (z - q.z) ** 2 <= r2;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    for (const b of this.plan.buildings) {
      const bx = (b.x0 + b.x1) / 2, bz = (b.z0 + b.z1) / 2, br = Math.hypot(b.x1 - b.x0, b.z1 - b.z0) / 2;
      if (Math.hypot(bx - q.x, bz - q.z) > q.r + br) continue;
      if (kinds.has('window')) {
        for (const tr of b.tiers) {
          const base = tr.y0 < 0.5, faces = base ? b.winFaces : 15;
          for (const fb of [F.W, F.E, F.N, F.S]) {
            if (!(faces & fb)) continue;
            const [nx, nz] = faceNormal(fb), fw = nx ? tr.d : tr.w, tx = nz, tz = -nx;
            const glass = b.style === ST.GLASS, pier = glass ? 0 : 0.55, avail = Math.max(fw - 2 * pier, 0.5);
            const nb = Math.max(1, Math.floor(avail / b.bayW + 0.5)), bw = avail / nb;
            const sub = b.pairs > 1.5 ? 2 : 1, ww = Math.min(b.winW * sub, 0.96) * bw / sub;
            const fx = tr.cx + nx * tr.w / 2, fz = tr.cz + nz * tr.d / 2;
            const f0 = Math.max(0, Math.ceil((tr.y0 - b.gH) / b.fH - 1e-3)), f1 = Math.floor((tr.y0 + tr.h - 0.95 - b.gH) / b.fH - b.sill - b.winH + 1e-3);
            for (let f = f0; f <= f1; f++) {
              const y = b.gH + f * b.fH + b.sill * b.fH;
              for (let k = 0; k < nb; k++) for (let s = 0; s < sub; s++) {
                const u = -fw / 2 + pier + (k + (s + 0.5) / sub) * bw;
                const x = fx + tx * u, z = fz + tz * u;
                if (!near(x, z)) continue;
                out.push({ kind: 'window', pos: V(x, y, z), facing: V(nx, 0, nz), building: b.id, floor: f + 1, size: [ww, b.winH * b.fH] });
              }
            }
          }
        }
      }
      if (kinds.has('fireEscape')) for (const l of b.landings) if (near(l.x, l.z)) out.push({ kind: 'fireEscape', pos: V(l.x + l.nx * 0.6, l.y, l.z + l.nz * 0.6), facing: V(l.nx, 0, l.nz), building: b.id, floor: Math.round((l.y - b.gH) / b.fH) + 1, size: [l.w, 1.15] });
      if (kinds.has('balcony')) for (const l of b.balconies) if (near(l.x, l.z)) out.push({ kind: 'balcony', pos: V(l.x + l.nx * 0.8, l.y + 0.09, l.z + l.nz * 0.8), facing: V(l.nx, 0, l.nz), building: b.id, floor: Math.round((l.y - b.gH) / b.fH) + 1, size: [l.w, 1.5] });
      const top = b.tiers.reduce((m, t) => (t.y0 + t.h > m.y0 + m.h ? t : m), b.tiers[0]!);
      if (kinds.has('roofEdge')) {
        for (const fb of [F.W, F.E, F.N, F.S]) {
          const [nx, nz] = faceNormal(fb), fw = nx ? top.d : top.w, tx = nz, tz = -nx;
          const n = Math.max(1, Math.floor(fw / 3));
          for (let k = 0; k < n; k++) {
            const u = -fw / 2 + (k + 0.5) * fw / n;
            const x = top.cx + nx * (top.w / 2 - 0.7) + tx * u, z = top.cz + nz * (top.d / 2 - 0.7) + tz * u;
            if (near(x, z)) out.push({ kind: 'roofEdge', pos: V(x, top.y0 + top.h, z), facing: V(nx, 0, nz), building: b.id, floor: -1, size: [fw / n, 1] });
          }
        }
      }
      if (kinds.has('roof')) {
        const rr = mulberry32(b.id * 7 + 1);
        for (let k = 0; k < 4; k++) {
          const x = top.cx + (rr() - 0.5) * (top.w - 4), z = top.cz + (rr() - 0.5) * (top.d - 4);
          if (b.water.some((w) => Math.hypot(w.x - x, w.z - z) < w.r + 1.5)) continue;
          const a = rr() * Math.PI * 2;
          if (near(x, z)) out.push({ kind: 'roof', pos: V(x, top.y0 + top.h, z), facing: V(Math.cos(a), 0, Math.sin(a)), building: b.id, floor: -1, size: [2, 2] });
        }
      }
    }
    const g = this.grid;
    if (kinds.has('entrance')) for (const s of this.plan.shops) if (near(s.x, s.z)) out.push({ kind: 'entrance', pos: V(s.x + s.nx * 1.2, 0.15, s.z + s.nz * 1.2), facing: V(s.nx, 0, s.nz), building: s.b, floor: 0, size: [s.w, s.h] });
    if (kinds.has('sidewalk')) {
      // along the sidewalks near the query, every ~4 m, facing along the street
      const step = 4;
      for (let x = Math.floor((q.x - q.r) / step) * step; x <= q.x + q.r; x += step) {
        for (let z = Math.floor((q.z - q.r) / step) * step; z <= q.z + q.r; z += step) {
          if (!near(x, z)) continue;
          const ia = g.avI(x), jn = g.stJ(z);
          const dx = Math.abs(x - g.avX(ia)), dz = Math.abs(z - g.stZ(jn));
          const onAvWalk = dx > g.avRoadH() + 0.8 && dx < g.avHalf() - 0.8, onStWalk = dz > g.stRoadH(jn) + 0.8 && dz < g.stHalf(jn) - 0.8;
          if (onAvWalk && dz > g.stHalf(jn)) out.push({ kind: 'sidewalk', pos: V(x, 0.15, z), facing: V(0, 0, (Math.floor(x + z) % 2) ? 1 : -1), building: -1, floor: 0, size: [1, 1] });
          else if (onStWalk && dx > g.avHalf()) out.push({ kind: 'sidewalk', pos: V(x, 0.15, z), facing: V((Math.floor(x + z) % 2) ? 1 : -1, 0, 0), building: -1, floor: 0, size: [1, 1] });
        }
      }
    }
    if (kinds.has('el') && this.el) {
      const e = this.el;
      for (let z = e.station - 60; z <= e.station + 60; z += 4) for (const side of [-1, 1]) {
        const x = e.x + side * 5.6;
        if (near(x, z)) out.push({ kind: 'el', pos: V(x, e.y - 0.45, z), facing: V(-side, 0, 0), building: -1, floor: 0, size: [3, 3] });
      }
    }
    // filter, shuffle (seeded), space out
    let list = out.filter((a) => a.pos.y >= (q.minY ?? -1) && a.pos.y <= (q.maxY ?? 1e5) && (!q.from || a.facing.dot(new THREE.Vector3().subVectors(q.from, a.pos)) > 0));
    const rr = mulberry32(q.seed ?? 1);
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [list[i], list[j]] = [list[j]!, list[i]!]; }
    if (q.spacing) {
      const kept: Anchor[] = [];
      for (const a of list) { if (kept.every((k) => k.pos.distanceToSquared(a.pos) >= q.spacing! ** 2)) kept.push(a); if (q.max && kept.length >= q.max) break; }
      list = kept;
    }
    return q.max ? list.slice(0, q.max) : list;
  }

  /**
   * A building of your own in the city's style (e.g. a hero's roof): a box with the city's facades, a parapet or
   * cornice. style: 'walkup' | 'prewar' | 'loft' | 'modern' | 'glass'. Add the returned group to your scene.
   */
  slab(x: number, z: number, w: number, d: number, h: number, o: { style?: 'walkup' | 'prewar' | 'loft' | 'modern' | 'glass' | 'postwar'; seed?: number; wall?: [number, number, number]; density?: number; cornice?: boolean; shops?: boolean } = {}) {
    const styleId = { walkup: ST.WALKUP, prewar: ST.PREWAR, loft: ST.LOFT, modern: ST.MODERN, glass: ST.GLASS, postwar: ST.POSTWAR }[o.style ?? 'prewar'];
    const P = {
      [ST.WALKUP]: [3.05, 3.4, 2.4, 0.42, 0.56, 0.26, 1], [ST.PREWAR]: [3.15, 4.6, 3.2, 0.3, 0.56, 0.25, 2], [ST.LOFT]: [3.9, 4.8, 3.8, 0.62, 0.66, 0.18, 1],
      [ST.MODERN]: [3.05, 5.2, 3.2, 0.84, 0.8, 0.08, 1], [ST.GLASS]: [4.0, 8, 1.52, 1, 0.72, 0.28, 1], [ST.POSTWAR]: [2.8, 3.8, 3.6, 0.7, 0.5, 0.28, 1],
    }[styleId]!;
    const wall = o.wall ?? (styleId === ST.GLASS ? [0.025, 0.03, 0.036] : styleId === ST.WALKUP ? [0.3, 0.1, 0.06] : [0.44, 0.34, 0.22]);
    const seed = o.seed ?? 42;
    const grp = new THREE.Group();
    const origin = new THREE.Vector3(x, 0, z);
    grp.add(buildingBatch([{ x, y0: 0, z, w, h, d, f0: [seed, styleId, P[0]!, P[1]!], f1: [P[2]!, P[3]!, P[4]!, P[5]!], f2: [...wall, o.density ?? 0.3], f3: [15 + (o.shops ? 16 * 15 : 0), h, 4 * P[6]!, 0.6] }], this.mat, origin));
    const cor = o.cornice ?? (styleId === ST.WALKUP || styleId === ST.PREWAR || styleId === ST.LOFT);
    const col: [number, number, number] = [wall[0] * 0.9 + 0.1, wall[1] * 0.9 + 0.09, wall[2] * 0.9 + 0.08];
    if (cor) grp.add(ringBatch(ringGeometry([[0, 0, 0], [0.22, 0.25, 0], [0.3, 0.3, 0], [0.42, 0.38, 0], [0.7, 0.92, 0], [0.82, 1, 0], [1, 1, 0]], 0.35, false), [{ x, y0: h - 1.0, z, hx: w / 2, hz: d / 2, h: 1.3, proj: 0.7, col, fancy: 1 }], ringMaterial(this.U), origin));
    else grp.add(ringBatch(ringGeometry([[0, 0, 0.0], [1, 0, 0.0], [1, 0, 0.06]], 0.32, true), [{ x, y0: h, z, hx: w / 2, hz: d / 2, h: 0.95, proj: 0, col, fancy: 0 }], ringMaterial(this.U), origin));
    return grp;
  }
}

/** Renders the scene mirrored in the ground plane (y = 0) at low resolution for the wet streets and the river. */
class Mirror {
  rt: THREE.WebGLRenderTarget | null = null;
  cam = new THREE.PerspectiveCamera();
  private busy = false;
  constructor(private city: City, private hide: THREE.Object3D[]) {}
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const U = this.city.U;
    if (this.busy) return;
    if (!camera.isPerspectiveCamera || camera.position.y > 220 || camera.position.y < 0.05) { U.uMirrorOn.value = 0; return; }
    const cur = renderer.getRenderTarget();
    const W = Math.max(64, Math.round((cur ? cur.width : renderer.domElement.width) / 3)), H = Math.max(36, Math.round((cur ? cur.height : renderer.domElement.height) / 3));
    if (!this.rt || this.rt.width !== W || this.rt.height !== H) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true });
    }
    const v = this.cam;
    v.copy(camera, false);
    // the camera reflected in y = 0: position, target and up reflected (a proper rotation, so culling stays right)
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    v.position.set(camera.position.x, -camera.position.y, camera.position.z);
    v.up.set(up.x, -up.y, up.z);
    v.lookAt(camera.position.x + fwd.x, -(camera.position.y + fwd.y), camera.position.z + fwd.z);
    v.updateMatrixWorld(true);
    v.projectionMatrix.copy(camera.projectionMatrix);
    // texture matrix: world → mirror uv
    const tm = U.uMirrorMat.value;
    tm.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    tm.multiply(v.projectionMatrix).multiply(v.matrixWorldInverse);
    // oblique near plane at y = 0 (nothing below the street in the reflection)
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(v.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = v.projectionMatrix.elements;
    const q4 = new THREE.Vector4((Math.sign(clip.x) + pm[8]!) / pm[0]!, (Math.sign(clip.y) + pm[9]!) / pm[5]!, -1, (1 + pm[10]!) / pm[14]!);
    clip.multiplyScalar(2 / clip.dot(q4));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1 - 0.003; pm[14] = clip.w;
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert();
    this.busy = true;
    U.uMirrorOn.value = 0;
    const vis = this.hide.map((o) => o.visible);
    this.hide.forEach((o) => (o.visible = false));
    const clearC = new THREE.Color(); renderer.getClearColor(clearC); const clearA = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(scene, v);
    renderer.setRenderTarget(cur);
    renderer.setClearColor(clearC, clearA);
    this.hide.forEach((o, i) => (o.visible = vis[i]!));
    this.busy = false;
    U.uMirror.value = this.rt.texture;
    U.uMirrorOn.value = 1;
  }
}
