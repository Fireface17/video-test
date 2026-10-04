// The plan of the night city (no three.js here): a Manhattan grid of avenues and streets, blocks cut into
// lots, a building on each lot (brick walk-ups, pre-war apartment houses, lofts, post-war slabs, modern towers,
// glass curtain walls, art-deco setback towers), their tiers, roofs (bulkheads, water towers, AC units,
// chimneys, antennas), fire escapes and balconies; and along the streets the lamps, signals, trees, shops,
// parked cars and all the small things. Everything is seeded and deterministic.
//
// Axes: x runs across the avenues (avenues are lines x = const, running along z), z along them (streets are
// lines z = const). Ground at y = 0, sidewalks 0.15 m higher. Metres.
import { mulberry32 } from '../../engine/util';

export const ST = { WALKUP: 0, PREWAR: 1, GLASS: 2, DECO: 3, MODERN: 4, POSTWAR: 5, LOFT: 6, PLANT: 7 } as const;
/** Face bits: which side of a box (by outward normal). */
export const F = { W: 1, E: 2, N: 4, S: 8 } as const; // W = -x, E = +x, N = -z, S = +z
export const faceNormal = (bit: number): [number, number] => (bit === F.W ? [-1, 0] : bit === F.E ? [1, 0] : bit === F.N ? [0, -1] : [0, 1]);

export interface GridSpec {
  avPitch: number; avRoad: number; avWalk: number;
  stPitch: number; stRoad: number; stWalk: number;
  /** every n-th street is a wide two-way crosstown street */
  wideEvery: number; wideRoad: number; wideWalk: number;
  /** x of avenue 0, z of street 0 (centrelines) */
  ax0: number; sz0: number;
}

export const GRID: GridSpec = { avPitch: 250, avRoad: 21, avWalk: 5.5, stPitch: 80, stRoad: 10.4, stWalk: 4.3, wideEvery: 6, wideRoad: 18, wideWalk: 5.5, ax0: 125, sz0: 40 };

export class Grid {
  constructor(public s: GridSpec = GRID) {}
  avX(i: number) { return this.s.ax0 + i * this.s.avPitch; }
  stZ(j: number) { return this.s.sz0 + j * this.s.stPitch; }
  wide(j: number) { const w = this.s.wideEvery; return ((j % w) + w) % w === 0; }
  /** half width curb to curb, and to the building line */
  avRoadH() { return this.s.avRoad / 2; }
  avHalf() { return this.s.avRoad / 2 + this.s.avWalk; }
  stRoadH(j: number) { return (this.wide(j) ? this.s.wideRoad : this.s.stRoad) / 2; }
  stHalf(j: number) { return this.stRoadH(j) + (this.wide(j) ? this.s.wideWalk : this.s.stWalk); }
  /** nearest avenue / street index */
  avI(x: number) { return Math.floor((x - this.s.ax0) / this.s.avPitch + 0.5); }
  stJ(z: number) { return Math.floor((z - this.s.sz0) / this.s.stPitch + 0.5); }
  /** the block (i, j) containing a point: between avenues i and i+1 and streets j and j+1 */
  blockOf(x: number, z: number): [number, number] { return [Math.floor((x - this.s.ax0) / this.s.avPitch), Math.floor((z - this.s.sz0) / this.s.stPitch)]; }
  /** building lines of block (i, j): [x0, z0, x1, z1] */
  blockRect(i: number, j: number): [number, number, number, number] {
    return [this.avX(i) + this.avHalf(), this.stZ(j) + this.stHalf(j), this.avX(i + 1) - this.avHalf(), this.stZ(j + 1) - this.stHalf(j + 1)];
  }
  /** avenue i's one-way direction along z (+1/-1); street j's along x (0 = two-way) */
  avDir(i: number) { return ((i % 2) + 2) % 2 === 0 ? 1 : -1; }
  stDir(j: number) { return this.wide(j) ? 0 : ((j % 2) + 2) % 2 === 0 ? 1 : -1; }
  /** GLSL constants + helpers (same numbers as here) */
  glsl() {
    const s = this.s, f = (v: number) => v.toFixed(3);
    return /* glsl */ `
      const float AV_PITCH = ${f(s.avPitch)}, AV_ROADH = ${f(s.avRoad / 2)}, AV_HALF = ${f(s.avRoad / 2 + s.avWalk)};
      const float ST_PITCH = ${f(s.stPitch)}, ST_ROADH = ${f(s.stRoad / 2)}, ST_HALF = ${f(s.stRoad / 2 + s.stWalk)};
      const float WIDE_EVERY = ${f(s.wideEvery)}, WIDE_ROADH = ${f(s.wideRoad / 2)}, WIDE_HALF = ${f(s.wideRoad / 2 + s.wideWalk)};
      const float AX0 = ${f(s.ax0)}, SZ0 = ${f(s.sz0)};
      // nearest avenue: index, signed offset from its centreline
      vec2 avNear(float x) { float i = floor((x - AX0) / AV_PITCH + 0.5); return vec2(i, x - (AX0 + i * AV_PITCH)); }
      vec2 stNear(float z) { float j = floor((z - SZ0) / ST_PITCH + 0.5); return vec2(j, z - (SZ0 + j * ST_PITCH)); }
      float stWide(float j) { return step(abs(j - WIDE_EVERY * floor(j / WIDE_EVERY + 0.5)), 0.1); }
    `;
  }
}

export interface Tier { cx: number; cz: number; w: number; d: number; y0: number; h: number }
export interface WaterTower { x: number; z: number; y: number; r: number; h: number; stand: number; seed: number }
export interface Landing { x: number; y: number; z: number; nx: number; nz: number; w: number; first: boolean; top: boolean; b: number }
export interface Balcony { x: number; y: number; z: number; nx: number; nz: number; w: number; b: number }
export interface RoofBox { x: number; y: number; z: number; w: number; h: number; d: number; kind: number } // 0 AC, 1 vent, 2 chimney, 3 antenna, 4 skylight, 5 dish

export interface Building {
  id: number; style: number; seed: number;
  x0: number; z0: number; x1: number; z1: number;
  /** top of the highest tier (without bulkheads, towers, spires) */
  h: number;
  fH: number; gH: number; bayW: number; winW: number; winH: number; sill: number; pairs: number;
  wall: [number, number, number]; density: number; warmth: number;
  winFaces: number; shopFaces: number; front: number;
  tiers: Tier[]; plant: Tier[];
  cornice: { proj: number; h: number } | null;
  crown: number; spire: number;
  water: WaterTower[]; landings: Landing[]; balconies: Balcony[]; roof: RoofBox[];
  block: [number, number];
}

export interface Shop { x: number; z: number; nx: number; nz: number; w: number; h: number; kind: number; lit: boolean; seed: number; sign: string; neon: string; awning: number; b: number }
export interface Lamp { x: number; z: number; ax: number; az: number; h: number; kind: number }
export interface Signal { x: number; z: number; ix: number; iz: number; i: number; j: number; corner: number }
export interface Tree { x: number; z: number; s: number; seed: number }
export interface Prop { kind: number; x: number; z: number; rot: number; seed: number }
export interface Parked { x: number; z: number; dx: number; dz: number; type: number; color: number; seed: number }
export interface Steam { x: number; z: number; stack: boolean; seed: number }

/** Shop kinds: what they look like at 3 am. */
export const SHOP = {
  DELI: 0, LAUNDRY: 1, CAFE: 2, PIZZA: 3, BAR: 4, PHARMACY: 5, NAILS: 6, GATE: 7, RESTAURANT: 8, LIQUOR: 9, DINER: 10, BANK: 11, VACANT: 12, LOBBY: 13,
} as const;
const SHOP_NAMES: Record<number, string[]> = {
  0: ['DELI & GROCERY', '24 HR DELI', 'GOURMET DELI', 'DELI · GROCERY', 'MINI MARKET'],
  1: ['LAUNDROMAT', 'WASH & FOLD', 'COIN LAUNDRY'],
  2: ['CAFÉ', 'ESPRESSO BAR', 'COFFEE SHOP', 'BAKERY'],
  3: ['PIZZA', 'FAMOUS PIZZA', 'PIZZERIA'],
  4: ['BAR', 'TAVERN', 'LOUNGE', 'PUB'],
  5: ['PHARMACY', 'DRUGS', 'CHEMIST'],
  6: ['NAILS', 'NAIL SPA', 'BEAUTY'],
  7: ['HARDWARE', 'FLOWERS', 'TAILOR', 'BARBER', 'OPTICAL', 'SHOE REPAIR', 'CLEANERS', 'CELL PHONES', 'BAGELS', 'BOOKS', 'RECORDS'],
  8: ['THAI', 'SUSHI', 'TACOS', 'NOODLES', 'TRATTORIA', 'CHINESE FOOD', 'BISTRO'],
  9: ['LIQUORS', 'WINE & SPIRITS'],
  10: ['DINER', 'COFFEE SHOP'],
  11: ['SAVINGS BANK', 'BANK'],
  12: ['FOR RENT'],
  13: [''],
};
const SHOP_NEON: Record<number, string[]> = {
  0: ['OPEN 24 HRS', 'OPEN', 'LOTTO', 'ATM', 'COLD BEER'], 1: ['OPEN', 'OPEN 24 HRS'], 2: [''], 3: ['PIZZA', 'OPEN'], 4: ['BEER', 'COCKTAILS', 'BAR'], 5: ['OPEN 24 HRS'], 6: ['NAILS'],
  7: [''], 8: [''], 9: ['LIQUORS', 'OPEN'], 10: ['OPEN', 'DINER'], 11: ['ATM'], 12: [''], 13: [''],
};

export interface PlanOpts {
  seed: number;
  /** generated area [x0, z0, x1, z1] */
  bounds: [number, number, number, number];
  /** tall clusters: [x, z, radius, strength] */
  centres: [number, number, number, number][];
  /** keep these circles free of generated buildings */
  clear: [number, number, number][];
  /** a park [x0, z0, x1, z1] (snapped to whole blocks), or null */
  park: [number, number, number, number] | null;
  /** the river: water east of this x (a highway along its edge), or null */
  river: number | null;
  /** the avenue (index) the elevated line runs along, or null */
  el: number | null;
  /** density of the street detail 0..1 */
  detail: number;
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);

/** Brick, stone and paint (linear albedo). */
const WALLS = {
  redBrick: [0.3, 0.1, 0.06], brownBrick: [0.2, 0.1, 0.065], darkBrick: [0.13, 0.07, 0.05], tanBrick: [0.4, 0.27, 0.16], buffBrick: [0.46, 0.36, 0.24],
  brownstone: [0.2, 0.12, 0.08], limestone: [0.48, 0.43, 0.35], greyStone: [0.36, 0.36, 0.35], whiteBrick: [0.55, 0.52, 0.47], cream: [0.58, 0.52, 0.4],
  paintGrey: [0.3, 0.31, 0.32], paintGreen: [0.12, 0.2, 0.16], paintRed: [0.32, 0.08, 0.06], concrete: [0.34, 0.34, 0.33], darkGlass: [0.025, 0.03, 0.036],
  blueGlass: [0.02, 0.035, 0.05], greenGlass: [0.02, 0.04, 0.038], bronze: [0.06, 0.045, 0.03],
} as const;
type WallKey = keyof typeof WALLS;

export class CityPlan {
  grid: Grid;
  buildings: Building[] = [];
  shops: Shop[] = [];
  lamps: Lamp[] = [];
  signals: Signal[] = [];
  trees: Tree[] = [];
  props: Prop[] = [];
  parked: Parked[] = [];
  steam: Steam[] = [];
  /** blocks that were generated: [i, j, kind (0 city, 1 park)] */
  blocks: [number, number, number][] = [];
  /** avenue / street index ranges that carry streets */
  iRange: [number, number]; jRange: [number, number];
  parkRect: [number, number, number, number] | null = null;
  o: PlanOpts;

  constructor(o: PlanOpts, grid = new Grid()) {
    this.o = o;
    this.grid = grid;
    const g = grid, [X0, Z0, X1, Z1] = o.bounds;
    const r = mulberry32(o.seed * 7919 + 13);
    const i0 = Math.floor((X0 - g.s.ax0) / g.s.avPitch), i1 = Math.ceil((X1 - g.s.ax0) / g.s.avPitch);
    const j0 = Math.floor((Z0 - g.s.sz0) / g.s.stPitch), j1 = Math.ceil((Z1 - g.s.sz0) / g.s.stPitch);
    this.iRange = [i0, i1]; this.jRange = [j0, j1];
    if (o.park) {
      const [a, b] = g.blockOf(o.park[0] + 1, o.park[1] + 1), [c, d] = g.blockOf(o.park[2] - 1, o.park[3] - 1);
      this.parkRect = [g.avX(a) + g.avHalf(), g.stZ(b) + g.stHalf(b), g.avX(c + 1) - g.avHalf(), g.stZ(d + 1) - g.stHalf(d + 1)];
    }
    for (let i = i0; i < i1; i++) {
      for (let j = j0; j < j1; j++) {
        const [bx0, bz0, bx1, bz1] = g.blockRect(i, j);
        if (o.river !== null && bx1 > o.river - g.avHalf() * 2) continue;
        const cx = (bx0 + bx1) / 2, cz = (bz0 + bz1) / 2;
        if (cx < X0 || cx > X1 || cz < Z0 || cz > Z1) continue;
        const pr = this.parkRect;
        if (pr && cx > pr[0] && cx < pr[2] && cz > pr[1] && cz < pr[3]) { this.blocks.push([i, j, 1]); continue; }
        this.blocks.push([i, j, 0]);
        this.fillBlock(i, j, bx0, bz0, bx1, bz1, mulberry32(Math.floor(r() * 1e9)));
      }
    }
    this.streets(mulberry32(o.seed * 31 + 7));
  }

  /** 0 (low-rise neighbourhood) .. 1 (the heart of midtown) */
  tall(x: number, z: number) {
    let t = 0;
    for (const [cx, cz, cr, k] of this.o.centres) {
      const d2 = ((x - cx) ** 2 + (z - cz) ** 2) / (cr * cr);
      t = Math.max(t, k * Math.exp(-d2));
    }
    return t;
  }

  private clear(x0: number, z0: number, x1: number, z1: number) {
    for (const [qx, qz, qr] of this.o.clear) {
      const dx = Math.max(x0 - qx, 0, qx - x1), dz = Math.max(z0 - qz, 0, qz - z1);
      if (dx * dx + dz * dz < qr * qr) return false;
    }
    return true;
  }

  private fillBlock(i: number, j: number, bx0: number, bz0: number, bx1: number, bz1: number, r: () => number) {
    const g = this.grid, D = bz1 - bz0, cz = (bz0 + bz1) / 2, cx = (bx0 + bx1) / 2;
    const T = this.tall(cx, cz);
    const nearEl = this.o.el !== null && Math.abs(g.avX(this.o.el) - cx) < 260;
    const nearRiver = this.o.river !== null && this.o.river - cx < 420;
    // avenue ends: corner buildings facing the avenue
    const endW = () => clamp(16 + r() * 16 + T * 26 * r(), 14, 60);
    const wE = endW(), eE = endW();
    const ends: [number, number, number][] = [[bx0, bx0 + wE, F.W], [bx1 - eE, bx1, F.E]];
    for (const [x0, x1, face] of ends) {
      const full = T > 0.45 ? r() < 0.75 : r() < 0.3;
      if (full) this.lot(x0, bz0, x1, bz1, face | F.N | F.S, face, true, T, nearEl, nearRiver, r, [i, j]);
      else {
        const zm = bz0 + D * (0.42 + r() * 0.16);
        this.lot(x0, bz0, x1, zm, face | F.N, face, true, T, nearEl, nearRiver, r, [i, j]);
        this.lot(x0, zm, x1, bz1, face | F.S, face, true, T, nearEl, nearRiver, r, [i, j]);
      }
    }
    // the middle of the block: tower sites (full depth) and two rows of lots with rear yards between
    let x = bx0 + wE;
    const xEnd = bx1 - eE;
    const sites: [number, number][] = [];
    if (T > 0.3) {
      const n = r() < T ? (r() < T * 0.6 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        const w = 32 + r() * (30 + T * 40), a = x + (xEnd - x - w) * r();
        if (sites.every(([s0, s1]) => a + w < s0 - 8 || a > s1 + 8) && a > x && a + w < xEnd) sites.push([a, a + w]);
      }
      sites.sort((p, q) => p[0] - q[0]);
    }
    const segs: [number, number][] = [];
    for (const [s0, s1] of sites) { segs.push([x, s0]); this.lot(s0, bz0, s1, bz1, F.N | F.S, F.S, false, T, nearEl, nearRiver, r, [i, j], true); x = s1; }
    segs.push([x, xEnd]);
    for (const [a, b] of segs) {
      for (const side of [0, 1]) {
        let xx = a;
        while (b - xx > 4) {
          // a run of similar buildings (one builder's row of tenements)
          const st = this.pickStyle(T, false, nearEl, nearRiver, r);
          const lw = st === ST.WALKUP ? 6.2 + r() * 2.6 : st === ST.LOFT ? 12 + r() * 14 : st === ST.PREWAR ? 15 + r() * 22 : st === ST.POSTWAR ? 20 + r() * 25 : 16 + r() * 22;
          const n = st === ST.WALKUP ? 1 + Math.floor(r() * 5) : 1;
          const runSeed = r();
          for (let k = 0; k < n && b - xx > 4; k++) {
            let w = Math.min(lw, b - xx);
            if (b - xx - w < 5) w = b - xx;
            const depth = st === ST.WALKUP ? 15 + r() * 6 : st === ST.LOFT ? Math.min(D / 2, 22 + r() * 9) : Math.min(D / 2, 20 + r() * 10);
            const z0 = side === 0 ? bz0 : bz1 - depth, z1 = side === 0 ? bz0 + depth : bz1;
            this.lot(xx, z0, xx + w, z1, side === 0 ? F.N | F.S : F.S | F.N, side === 0 ? F.N : F.S, false, T, nearEl, nearRiver, r, [i, j], false, st, runSeed);
            xx += w;
          }
        }
      }
    }
  }

  private pickStyle(T: number, avenue: boolean, nearEl: boolean, nearRiver: boolean, r: () => number) {
    const u = r();
    if (T > 0.6) return u < 0.38 ? ST.GLASS : u < 0.55 ? ST.DECO : u < 0.78 ? ST.PREWAR : u < 0.92 ? ST.MODERN : ST.WALKUP;
    if (T > 0.28) return u < 0.15 ? ST.GLASS : u < 0.22 ? ST.DECO : u < 0.55 ? ST.PREWAR : u < 0.68 ? ST.POSTWAR : u < 0.8 ? ST.MODERN : ST.WALKUP;
    if (nearEl || nearRiver) return u < 0.45 ? ST.WALKUP : u < 0.75 ? ST.LOFT : u < 0.88 ? ST.PREWAR : u < 0.95 ? ST.POSTWAR : ST.MODERN;
    if (avenue) return u < 0.5 ? ST.WALKUP : u < 0.78 ? ST.PREWAR : u < 0.88 ? ST.POSTWAR : u < 0.95 ? ST.MODERN : ST.LOFT;
    return u < 0.66 ? ST.WALKUP : u < 0.8 ? ST.PREWAR : u < 0.87 ? ST.LOFT : u < 0.94 ? ST.POSTWAR : ST.MODERN;
  }

  /** One lot: choose a building and generate it. `faces`: which sides face a street; `front`: the main one. */
  private lot(x0: number, z0: number, x1: number, z1: number, faces: number, front: number, avenue: boolean, T: number, nearEl: boolean, nearRiver: boolean, r: () => number, block: [number, number], site = false, style?: number, runSeed?: number) {
    if (x1 - x0 < 3 || z1 - z0 < 3) return;
    const id = this.buildings.length;
    const rs = runSeed !== undefined ? mulberry32(Math.floor(runSeed * 1e9)) : r; // a row shares looks
    let st = style ?? (site ? (r() < 0.55 ? ST.GLASS : r() < 0.5 ? ST.DECO : ST.MODERN) : this.pickStyle(T, avenue, nearEl, nearRiver, r));
    // a little local variation of heights
    const T2 = clamp(T * (0.6 + r() * 0.8), 0, 1.2);
    let floors: number, fH: number, gH: number, bayW: number, winW: number, winH: number, sill: number, pairs = 1, wall: WallKey, density: number;
    let cornice: { proj: number; h: number } | null = null, crown = 0, spire = 0;
    const pick = <K>(a: K[], u = r()) => a[Math.floor(u * a.length) % a.length]!;
    switch (st) {
      case ST.WALKUP:
        floors = 4 + Math.floor(rs() * (avenue ? 3 : 2.6)); fH = 3.05; gH = avenue || rs() < 0.25 ? 4.1 : 3.3; bayW = 2.25 + rs() * 0.3; winW = 0.42; winH = 0.56; sill = 0.26;
        wall = pick<WallKey>(['redBrick', 'brownBrick', 'darkBrick', 'tanBrick', 'brownstone', 'redBrick', 'buffBrick', 'paintGrey', 'cream'], rs()); density = 0.28 + r() * 0.3;
        if (rs() < 0.88) cornice = { proj: 0.45 + rs() * 0.45, h: 0.8 + rs() * 0.6 };
        break;
      case ST.PREWAR:
        floors = 8 + Math.floor(r() * 7 + T2 * 12); fH = 3.15; gH = 4.6; bayW = 3.0 + r() * 0.4; winW = 0.3; winH = 0.56; sill = 0.25; pairs = 2;
        wall = pick<WallKey>(['buffBrick', 'tanBrick', 'brownBrick', 'redBrick', 'limestone', 'buffBrick', 'darkBrick']); density = 0.25 + r() * 0.3;
        if (r() < 0.75) cornice = { proj: 0.8 + r() * 0.7, h: 1.2 + r() * 0.8 };
        break;
      case ST.POSTWAR:
        floors = 10 + Math.floor(r() * 9 + T2 * 8); fH = 2.8; gH = 3.8; bayW = 3.4 + r() * 0.6; winW = 0.7; winH = 0.5; sill = 0.28;
        wall = pick<WallKey>(['whiteBrick', 'whiteBrick', 'tanBrick', 'concrete', 'redBrick']); density = 0.22 + r() * 0.28;
        break;
      case ST.LOFT:
        floors = 5 + Math.floor(rs() * 5); fH = 3.9; gH = 4.8; bayW = 3.6 + rs() * 0.8; winW = 0.62; winH = 0.66; sill = 0.18; pairs = rs() < 0.4 ? 2 : 1;
        wall = pick<WallKey>(['redBrick', 'darkBrick', 'cream', 'paintGrey', 'paintGreen', 'brownBrick', 'paintRed'], rs()); density = 0.2 + r() * 0.3;
        if (rs() < 0.55) cornice = { proj: 0.5 + rs() * 0.5, h: 0.9 + rs() * 0.6 };
        break;
      case ST.MODERN:
        floors = 12 + Math.floor(r() * 14 + T2 * 22); fH = 3.05; gH = 5.2; bayW = 3.0 + r() * 0.8; winW = 0.84; winH = 0.8; sill = 0.08;
        wall = pick<WallKey>(['concrete', 'darkGlass', 'greyStone', 'concrete', 'bronze']); density = 0.25 + r() * 0.3;
        break;
      case ST.GLASS:
        floors = 16 + Math.floor(r() * 16 + T2 * 40); fH = 4.0; gH = 8.0; bayW = 1.52; winW = 1; winH = 0.72; sill = 0.28;
        wall = pick<WallKey>(['darkGlass', 'blueGlass', 'greenGlass', 'darkGlass', 'bronze']); density = 0.12 + r() * 0.3;
        if (floors > 45 && r() < 0.35) crown = 2;
        if (floors > 55 && r() < 0.4) spire = 20 + r() * 50;
        break;
      default: // DECO
        st = ST.DECO;
        floors = 20 + Math.floor(r() * 16 + T2 * 30); fH = 3.6; gH = 6.5; bayW = 2.3 + r() * 0.3; winW = 0.5; winH = 0.6; sill = 0.24;
        wall = pick<WallKey>(['limestone', 'buffBrick', 'greyStone', 'tanBrick', 'limestone']); density = 0.2 + r() * 0.3;
        crown = 1;
        if (floors > 40 && r() < 0.5) spire = 15 + r() * 30;
        break;
    }
    const xw = x1 - x0, zd = z1 - z0;
    // small lots can't carry tall buildings
    if (st !== ST.WALKUP && Math.min(xw, zd) < 14) floors = Math.min(floors, 9);
    if (st === ST.GLASS || st === ST.DECO) floors = Math.min(floors, Math.floor(10 + Math.min(xw, zd) * 1.6));
    if (!this.clear(x0, z0, x1, z1)) return;
    const h0 = gH + (floors - 1) * fH;
    const b: Building = {
      id, style: st, seed: Math.floor(r() * 997) + 1, x0, z0, x1, z1, h: h0, fH, gH, bayW, winW, winH, sill, pairs,
      wall: [...WALLS[wall]] as [number, number, number], density, warmth: r(), winFaces: faces, shopFaces: 0, front,
      tiers: [], plant: [], cornice, crown, spire, water: [], landings: [], balconies: [], roof: [], block,
    };
    // slight per-building tint so a row of the same brick isn't uniform
    const tint = 0.85 + rs() * 0.3;
    b.wall = b.wall.map((c) => c * tint * (0.92 + r() * 0.16)) as [number, number, number];
    // towers have windows all round; row houses only front and back (party walls are blank)
    if (st === ST.GLASS || st === ST.DECO || st === ST.MODERN || st === ST.POSTWAR || site) b.winFaces = 15;
    // shops on the avenue and some streets
    const shops = (st === ST.WALKUP || st === ST.PREWAR || st === ST.LOFT || st === ST.POSTWAR) && (avenue ? r() < 0.95 : r() < 0.3);
    if (shops) b.shopFaces = avenue ? front | (r() < 0.6 ? faces & (F.N | F.S) : 0) : front;
    if (!shops) b.gH = Math.min(b.gH, st === ST.GLASS || st === ST.DECO || st === ST.MODERN ? b.gH : fH + 0.4);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const fz = front === F.N ? -1 : front === F.S ? 1 : 0, fx = front === F.W ? -1 : front === F.E ? 1 : 0;
    const snap = (y: number) => b.gH + Math.round((y - b.gH) / fH) * fH;
    // ---- massing ----
    const tiers: Tier[] = [];
    const H = b.h + 0.9;
    if (st === ST.DECO) {
      // a base filling the lot, then setbacks, the crown
      let w = xw, d = zd, y = 0, n = 2 + Math.floor(r() * 3);
      const base = snap(H * (0.28 + r() * 0.15));
      tiers.push({ cx, cz, w, d, y0: 0, h: base }); y = base;
      for (let k = 0; k < n; k++) {
        const last = k === n - 1;
        w *= 0.72 + r() * 0.12; d *= 0.72 + r() * 0.12;
        const hh = last ? Math.max(H - y, fH * 3) : snap((H - y) * (0.45 + r() * 0.2) + y) - y;
        tiers.push({ cx, cz, w, d, y0: y, h: hh }); y += hh;
      }
      // the crown: a small stepped lantern
      const cw = w * 0.6, cd = d * 0.6;
      tiers.push({ cx, cz, w: cw, d: cd, y0: y, h: fH * 2 });
      tiers.push({ cx, cz, w: cw * 0.6, d: cd * 0.6, y0: y + fH * 2, h: fH * 1.5 });
      b.h = y;
    } else if (st === ST.GLASS) {
      const podium = r() < 0.4 && xw > 30 && zd > 30;
      let y = 0, w = xw, d = zd;
      if (podium) { const ph = snap(gH + fH * (2 + Math.floor(r() * 5))); tiers.push({ cx, cz, w, d, y0: 0, h: ph }); y = ph; w *= 0.62 + r() * 0.2; d *= 0.62 + r() * 0.2; }
      else { w -= 2; d -= 2; }
      const tx = cx + (r() - 0.5) * (xw - w) * 0.6, tz = cz + (r() - 0.5) * (zd - d) * 0.6;
      if (r() < 0.3 && !podium) {
        // a setback near the top
        const hh = snap(H * (0.6 + r() * 0.2));
        tiers.push({ cx: tx, cz: tz, w, d, y0: y, h: hh - y });
        tiers.push({ cx: tx, cz: tz, w: w * 0.8, d: d * 0.8, y0: hh, h: H - hh });
      } else tiers.push({ cx: tx, cz: tz, w, d, y0: y, h: H - y });
      // mechanical floors on top
      const last = tiers[tiers.length - 1]!;
      b.plant.push({ cx: last.cx, cz: last.cz, w: last.w * 0.7, d: last.d * 0.7, y0: H, h: 5 + r() * 3 });
    } else if (st === ST.MODERN) {
      const podium = r() < 0.5 && xw > 25 && zd > 25;
      if (podium) {
        const ph = snap(gH + fH * (1 + Math.floor(r() * 4)));
        tiers.push({ cx, cz, w: xw, d: zd, y0: 0, h: ph });
        const w = xw * (0.55 + r() * 0.25), d = zd * (0.55 + r() * 0.25);
        tiers.push({ cx: cx + (r() - 0.5) * (xw - w) * 0.5, cz: cz - fz * (zd - d) * 0.3, w, d, y0: ph, h: H - ph });
      } else tiers.push({ cx, cz, w: xw, d: zd, y0: 0, h: H });
    } else if (st === ST.PREWAR && floors >= 12 && r() < 0.65) {
      // a wedding cake: the top floors step back from the street
      const sb = snap(H - fH * (2 + Math.floor(r() * 3)));
      tiers.push({ cx, cz, w: xw, d: zd, y0: 0, h: sb });
      const back = 2.5 + r() * 2;
      tiers.push({ cx: cx - fx * back / 2, cz: cz - fz * back / 2, w: xw - Math.abs(fx) * back - 2 * (1 - Math.abs(fx)) * (r() < 0.5 ? 0 : 1.5), d: zd - Math.abs(fz) * back, y0: sb, h: H - sb });
      if (r() < 0.4) {
        const t1 = tiers[1]!, y2 = t1.y0 + t1.h;
        tiers.push({ cx: t1.cx - fx, cz: t1.cz - fz, w: t1.w * 0.6, d: t1.d * 0.6, y0: y2, h: fH * 2 });
      }
    } else tiers.push({ cx, cz, w: xw, d: zd, y0: 0, h: H });
    b.tiers = tiers;
    const top = tiers.reduce((m, t) => (t.y0 + t.h > m.y0 + m.h ? t : m), tiers[0]!);
    b.h = top.y0 + top.h;
    // ---- roof ----
    const roofSpot = (t: Tier, w: number, d: number, edge = 1.2): [number, number] => [t.cx + (r() - 0.5) * Math.max(0, t.w - w - edge * 2), t.cz + (r() - 0.5) * Math.max(0, t.d - d - edge * 2)];
    if (st !== ST.GLASS && st !== ST.DECO) {
      // stair bulkhead (and an elevator room on the bigger ones)
      const bw = 2.6 + r() * 1.2, bd = 3 + r() * 1.5;
      if (top.w > bw + 3 && top.d > bd + 3) { const [px, pz] = roofSpot(top, bw, bd, 2); b.plant.push({ cx: px, cz: pz, w: bw, d: bd, y0: b.h, h: 2.6 + r() * 0.6 }); }
      if (st !== ST.WALKUP && top.w > 12 && top.d > 12) { const [px, pz] = roofSpot(top, 5, 5, 2); b.plant.push({ cx: px, cz: pz, w: 4 + r() * 2, d: 4 + r() * 2, y0: b.h, h: 3.5 + r() * 1.5 }); }
    }
    const wantWater = st === ST.PREWAR ? r() < 0.72 : st === ST.WALKUP ? floors >= 6 && r() < 0.5 : st === ST.LOFT ? r() < 0.6 : st === ST.POSTWAR ? r() < 0.25 : false;
    if (wantWater && top.w > 5 && top.d > 5) {
      const wr = 1.5 + r() * (st === ST.WALKUP ? 0.5 : 1.2), [px, pz] = roofSpot(top, wr * 2, wr * 2, 1.5);
      b.water.push({ x: px, z: pz, y: b.h, r: wr, h: 3.2 + r() * 2.2, stand: 2.2 + r() * 2.5, seed: r() });
      if (st === ST.PREWAR && top.w > 25 && r() < 0.3) { const [qx, qz] = roofSpot(top, 4, 4, 1.5); if (Math.hypot(qx - px, qz - pz) > wr * 2 + 3) b.water.push({ x: qx, z: qz, y: b.h, r: wr * 0.9, h: 3.4 + r() * 1.5, stand: 2.5 + r() * 2, seed: r() }); }
    }
    const nAC = st === ST.WALKUP ? Math.floor(r() * 2.2) : st === ST.GLASS || st === ST.DECO ? 0 : 1 + Math.floor(r() * 5 * Math.min(1, top.w * top.d / 600));
    for (let k = 0; k < nAC; k++) { const [px, pz] = roofSpot(top, 2, 2); b.roof.push({ x: px, y: b.h, z: pz, w: 1.2 + r() * 1.4, h: 0.9 + r() * 0.7, d: 0.9 + r() * 1.2, kind: 0 }); }
    const nVent = 1 + Math.floor(r() * 4);
    for (let k = 0; k < nVent; k++) { const [px, pz] = roofSpot(top, 0.6, 0.6); b.roof.push({ x: px, y: b.h, z: pz, w: 0.35 + r() * 0.3, h: 0.6 + r() * 1.2, d: 0.35 + r() * 0.3, kind: 1 }); }
    if (st === ST.WALKUP || st === ST.LOFT) {
      // brick chimneys on the party walls
      const nC = 1 + Math.floor(r() * 2.5);
      for (let k = 0; k < nC; k++) {
        const side = r() < 0.5 ? -1 : 1, along = (r() - 0.5) * (top.d - 3);
        b.roof.push({ x: top.cx + side * (top.w / 2 - 0.45), y: b.h, z: top.cz + along, w: 0.7, h: 1.2 + r() * 1.4, d: 0.9 + r() * 0.6, kind: 2 });
      }
    }
    if ((st === ST.GLASS || st === ST.DECO || st === ST.MODERN || st === ST.POSTWAR) && r() < (b.h > 120 ? 0.85 : 0.25)) {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) { const [px, pz] = roofSpot(top, 1, 1, 3); b.roof.push({ x: px, y: b.h + (b.plant.length ? b.plant[0]!.h * (r() < 0.5 ? 1 : 0) : 0), z: pz, w: 0.25, h: 8 + r() * (b.h > 150 ? 25 : 10), d: 0.25, kind: 3 }); }
    }
    if (r() < 0.06) { const [px, pz] = roofSpot(top, 1.5, 1.5); b.roof.push({ x: px, y: b.h, z: pz, w: 1.2, h: 1.2, d: 0.3, kind: 5 }); }
    if (st !== ST.GLASS && r() < 0.25) { const [px, pz] = roofSpot(top, 2, 2); b.roof.push({ x: px, y: b.h, z: pz, w: 1.2 + r(), h: 0.5, d: 1.2 + r() * 1.5, kind: 4 }); }
    // ---- fire escapes (tenements and lofts, on the street front) ----
    if ((st === ST.WALKUP && rs() < 0.72) || (st === ST.LOFT && rs() < 0.45)) {
      const fw = (front === F.N || front === F.S) ? xw : zd;
      const nb = Math.max(1, Math.floor((fw - 1.2) / bayW + 0.5)), bw = (fw - 1.2) / nb;
      const span = Math.min(nb, nb >= 4 ? 2 + Math.floor(rs() * 2) : nb);
      const firstBay = Math.floor((nb - span) * (rs() < 0.5 ? 0.5 : rs()));
      const uc = -fw / 2 + 0.6 + (firstBay + span / 2) * bw; // along the face, from its centre
      const [nx, nz] = faceNormal(front);
      const tx = nz, tz = -nx; // the face's tangent (cross(up, N))
      const px = cx + nx * (Math.abs(nx) ? xw / 2 : 0) + tx * uc, pz = cz + nz * (Math.abs(nz) ? zd / 2 : 0) + tz * uc;
      for (let f = 1; f < floors; f++) {
        const y = b.gH + (f - 1) * fH;
        b.landings.push({ x: px, y, z: pz, nx, nz, w: span * bw - 0.2, first: f === 1, top: f === floors - 1, b: id });
      }
    }
    // ---- balconies (modern towers) ----
    if (st === ST.MODERN && r() < 0.35) {
      const t0 = tiers[tiers.length - 1]!;
      for (const fb of [F.N, F.S, F.W, F.E]) {
        if (!(fb & faces) || r() < 0.4) continue;
        const [nx, nz] = faceNormal(fb), fw = nx ? t0.d : t0.w;
        const nb = Math.max(1, Math.floor((fw - 1.2) / bayW + 0.5)), bw = (fw - 1.2) / nb;
        const every = r() < 0.5 ? 2 : 3, off = Math.floor(r() * every);
        for (let k = off; k < nb; k += every) {
          const uc = -fw / 2 + 0.6 + (k + 0.5) * bw, tx = nz, tz = -nx;
          const px = t0.cx + nx * t0.w / 2 + tx * uc, pz = t0.cz + nz * t0.d / 2 + tz * uc;
          for (let f = Math.max(1, Math.ceil((t0.y0 - b.gH) / fH) + 1); b.gH + (f - 1) * fH < t0.y0 + t0.h - fH; f++) b.balconies.push({ x: px, y: b.gH + (f - 1) * fH, z: pz, nx, nz, w: bw * 0.9, b: id });
        }
      }
    }
    this.buildings.push(b);
    // ---- shops ----
    if (b.shopFaces) {
      const t0 = tiers[0]!;
      for (const fb of [F.W, F.E, F.N, F.S]) {
        if (!(b.shopFaces & fb)) continue;
        const [nx, nz] = faceNormal(fb), fw = nx ? t0.d : t0.w, tx = nz, tz = -nx;
        const n = Math.max(1, Math.round((fw - 1.2) / (6 + r() * 3))), uw = (fw - 1.2) / n;
        for (let k = 0; k < n; k++) {
          const uc = -fw / 2 + 0.6 + (k + 0.5) * uw;
          this.shops.push(this.makeShop(t0.cx + nx * t0.w / 2 + tx * uc, t0.cz + nz * t0.d / 2 + tz * uc, nx, nz, uw, b.gH, avenue, r, id));
        }
      }
    } else if (st !== ST.GLASS) {
      // a lit lobby door on the front
      const t0 = tiers[0]!, [nx, nz] = faceNormal(front), fw = nx ? t0.d : t0.w, tx = nz, tz = -nx;
      const uc = (r() - 0.5) * Math.max(0, fw - 6);
      const s = this.makeShop(t0.cx + nx * t0.w / 2 + tx * uc, t0.cz + nz * t0.d / 2 + tz * uc, nx, nz, st === ST.WALKUP ? 1.8 : 3.2, Math.min(b.gH, 3.3), false, r, id);
      s.kind = SHOP.LOBBY; s.lit = r() < 0.85; s.sign = ''; s.neon = ''; s.awning = st === ST.PREWAR && r() < 0.6 ? 100 : -1;
      this.shops.push(s);
    } else {
      // a glass tower's lobby: the whole ground floor of the front
      const t0 = tiers[0]!, [nx, nz] = faceNormal(front), fw = nx ? t0.d : t0.w;
      const s = this.makeShop(t0.cx + nx * t0.w / 2, t0.cz + nz * t0.d / 2, nx, nz, fw - 2, b.gH - 0.6, false, r, id);
      s.kind = SHOP.LOBBY; s.lit = true; s.sign = ''; s.neon = ''; s.awning = -1;
      this.shops.push(s);
    }
  }

  private makeShop(x: number, z: number, nx: number, nz: number, w: number, h: number, avenue: boolean, r: () => number, b: number): Shop {
    const u = r();
    const kind = u < 0.13 ? SHOP.DELI : u < 0.19 ? SHOP.LAUNDRY : u < 0.28 ? SHOP.CAFE : u < 0.34 ? SHOP.PIZZA : u < 0.41 ? SHOP.BAR : u < 0.45 ? SHOP.PHARMACY : u < 0.5 ? SHOP.NAILS
      : u < 0.72 ? SHOP.GATE : u < 0.82 ? SHOP.RESTAURANT : u < 0.86 ? SHOP.LIQUOR : u < 0.9 ? SHOP.DINER : u < 0.93 ? SHOP.BANK : SHOP.VACANT;
    // open at 3 am: delis, laundromats (some), bars, diners, the odd pharmacy; the rest closed (gate down or dark)
    const litP: Record<number, number> = { 0: 0.92, 1: 0.6, 2: 0.15, 3: 0.45, 4: 0.75, 5: 0.5, 6: 0.15, 7: 0.0, 8: 0.15, 9: 0.35, 10: 0.85, 11: 0.9, 12: 0.0 };
    const pick = (a: string[]) => a[Math.floor(r() * a.length) % a.length]!;
    const lit = r() < (litP[kind] ?? 0);
    const sign = pick(SHOP_NAMES[kind]!), neon = lit && r() < 0.75 ? pick(SHOP_NEON[kind]!) : '';
    const awning = kind !== SHOP.GATE && kind !== SHOP.BANK && r() < (avenue ? 0.35 : 0.45) ? Math.floor(r() * 8) : -1;
    return { x, z, nx, nz, w, h, kind, lit, seed: r(), sign, neon, awning, b };
  }

  /** Lamps, signals, trees, hydrants, parked cars, steam along every street and avenue. */
  private streets(r: () => number) {
    const g = this.grid, [i0, i1] = this.iRange, [j0, j1] = this.jRange;
    const [X0, Z0, X1, Z1] = this.o.bounds;
    const riverX = this.o.river ?? Infinity;
    const xMax = Math.min(X1, riverX - g.avHalf()), zMin = Z0, zMax = Z1;
    const detail = this.o.detail;
    const inPark = (x: number, z: number) => { const p = this.parkRect; return !!p && x > p[0] - 1 && x < p[2] + 1 && z > p[1] - 1 && z < p[3] + 1; };
    const elX = this.o.el !== null ? g.avX(this.o.el) : NaN;
    // ---- avenues (lines x = avX(i), along z) ----
    for (let i = i0; i <= i1; i++) {
      const ax = g.avX(i);
      if (ax < X0 - 1 || ax > xMax) continue;
      const isEl = ax === elX;
      for (const side of [-1, 1]) {
        const curb = ax + side * g.avRoadH();
        let k = 0;
        for (let z = zMin + (side > 0 ? 16 : 0); z < zMax; z += 32, k++) {
          const jn = g.stJ(z);
          if (Math.abs(z - g.stZ(jn)) < g.stHalf(jn) + 3) continue;
          this.lamps.push({ x: curb - side * 0.6, z, ax: -side, az: 0, h: 9, kind: isEl ? 2 : 0 });
        }
        // parked cars in the parking lane
        for (let z = zMin; z < zMax; z += 6.2) {
          const jn = g.stJ(z);
          if (Math.abs(z - g.stZ(jn)) < g.stHalf(jn) + 8) continue;
          if (r() < 0.55 * detail) this.parked.push({ x: curb - side * 1.25, z: z + (r() - 0.5) * 0.8, dx: 0, dz: g.avDir(i), type: r() < 0.25 ? 1 : r() < 0.06 ? 3 : 0, color: Math.floor(r() * 16), seed: r() });
        }
        // trees, hydrants, kiosks, bus stops, subway stairs along the avenue sidewalks
        const walk = ax + side * (g.avRoadH() + 1.2);
        for (let z = zMin; z < zMax; z += 9) {
          const jn = g.stJ(z);
          const dz = Math.abs(z - g.stZ(jn)) - g.stHalf(jn);
          if (dz < 4 || inPark(walk, z)) continue;
          const u = r();
          if (u < 0.22 * detail) this.trees.push({ x: walk + side * 0.4, z, s: 0.8 + r() * 0.5, seed: r() });
          else if (u < 0.27) this.props.push({ kind: 0, x: walk, z, rot: 0, seed: r() }); // hydrant
          else if (u < 0.3) this.props.push({ kind: 5, x: walk + side * 0.2, z, rot: side > 0 ? Math.PI / 2 : -Math.PI / 2, seed: r() }); // LinkNYC kiosk
          else if (u < 0.32) this.props.push({ kind: 6, x: walk + side * 1.0, z, rot: side > 0 ? -Math.PI / 2 : Math.PI / 2, seed: r() }); // bus shelter
          else if (u < 0.34) this.props.push({ kind: 3, x: walk, z, rot: 0, seed: r() }); // mailbox
          else if (u < 0.4) this.props.push({ kind: 2, x: walk, z, rot: 0, seed: r() }); // trash can
          else if (u < 0.43) this.props.push({ kind: 4, x: walk, z, rot: 0, seed: r() }); // newspaper boxes
        }
      }
      // intersections along this avenue: signals, subway stairs, steam, manholes
      for (let j = j0; j <= j1; j++) {
        const sz = g.stZ(j);
        if (sz < zMin || sz > zMax) continue;
        const rh = g.avRoadH(), sh = g.stRoadH(j);
        this.signals.push({ x: ax - rh - 0.8, z: sz - sh - 0.8, ix: ax, iz: sz, i, j, corner: 0 });
        this.signals.push({ x: ax + rh + 0.8, z: sz + sh + 0.8, ix: ax, iz: sz, i, j, corner: 1 });
        if (r() < 0.12 && !isEl) this.props.push({ kind: 7, x: ax + (r() < 0.5 ? -1 : 1) * (g.avRoadH() + 2.6), z: sz + (r() < 0.5 ? -1 : 1) * (g.stHalf(j) + 7), rot: 0, seed: r() }); // subway stairs
        if (r() < 0.16 * detail) this.steam.push({ x: ax + (r() - 0.5) * 12, z: sz + (r() < 0.5 ? -1 : 1) * (sh + 10 + r() * 50), stack: r() < 0.4, seed: r() });
        if (r() < 0.5) this.props.push({ kind: 2, x: ax + (r() < 0.5 ? -1 : 1) * (rh + 1.0), z: sz + (r() < 0.5 ? -1 : 1) * (g.stHalf(j) - 0.8), rot: 0, seed: r() });
      }
    }
    // ---- streets (lines z = stZ(j), along x) ----
    for (let j = j0; j <= j1; j++) {
      const sz = g.stZ(j);
      if (sz < zMin - 1 || sz > zMax) continue;
      const wide = g.wide(j), rh = g.stRoadH(j);
      for (const side of [-1, 1]) {
        const curb = sz + side * rh;
        let k = 0;
        for (let x = X0 + (side > 0 ? 18 : 0); x < xMax; x += 36, k++) {
          const ia = g.avI(x);
          if (Math.abs(x - g.avX(ia)) < g.avHalf() + 3) continue;
          this.lamps.push({ x, z: curb - side * 0.6, ax: 0, az: -side, h: wide ? 9 : 8, kind: 0 });
        }
        for (let x = X0; x < xMax; x += 5.9) {
          const ia = g.avI(x);
          if (Math.abs(x - g.avX(ia)) < g.avHalf() + 7) continue;
          if (r() < 0.78 * detail) this.parked.push({ x: x + (r() - 0.5) * 0.6, z: curb - side * 1.2, dx: wide ? -side : g.stDir(j) || 1, dz: 0, type: r() < 0.22 ? 1 : r() < 0.04 ? 3 : 0, color: Math.floor(r() * 16), seed: r() });
        }
        const walk = sz + side * (rh + 1.1);
        for (let x = X0; x < xMax; x += 7.5) {
          const ia = g.avI(x);
          const dx = Math.abs(x - g.avX(ia)) - g.avHalf();
          if (dx < 5 || inPark(x, walk)) continue;
          const u = r();
          if (u < 0.6 * detail) this.trees.push({ x: x + (r() - 0.5) * 2, z: walk + side * 0.3, s: 0.7 + r() * 0.6, seed: r() });
          else if (u < 0.64) this.props.push({ kind: 0, x, z: walk, rot: 0, seed: r() });
          else if (u < 0.68) this.props.push({ kind: 2, x, z: walk, rot: 0, seed: r() });
          else if (u < 0.7) this.props.push({ kind: 8, x, z: walk + side * 0.2, rot: 0, seed: r() }); // bike rack + bikes
        }
      }
      for (let i = i0; i < i1; i++) {
        const xa = g.avX(i) + g.avHalf(), xb = g.avX(i + 1) - g.avHalf();
        if (xa > xMax) continue;
        if (r() < 0.12 * detail) this.steam.push({ x: xa + 20 + r() * (xb - xa - 40), z: sz + (r() - 0.5) * rh, stack: r() < 0.35, seed: r() });
      }
    }
    // ---- park: lamps along paths, trees ----
    if (this.parkRect) {
      const [px0, pz0, px1, pz1] = this.parkRect;
      for (let x = px0 + 6; x < px1 - 6; x += 7 + r() * 6) for (let z = pz0 + 6; z < pz1 - 6; z += 7 + r() * 6) {
        const path = Math.abs((x - px0) / (px1 - px0) - (z - pz0) / (pz1 - pz0)) < 0.03 || Math.abs((z - (pz0 + pz1) / 2)) < 3;
        if (!path && r() < 0.55) this.trees.push({ x: x + (r() - 0.5) * 4, z: z + (r() - 0.5) * 4, s: 1.1 + r() * 0.9, seed: r() });
      }
      for (let x = px0 + 10; x < px1; x += 26) {
        this.lamps.push({ x, z: (pz0 + pz1) / 2 + 3.5, ax: 0, az: 0, h: 4.2, kind: 1 });
        const z = pz0 + ((x - px0) / (px1 - px0)) * (pz1 - pz0);
        this.lamps.push({ x: x + 2.5, z, ax: 0, az: 0, h: 4.2, kind: 1 });
      }
    }
  }

  /** Building footprints [x, z, w, d, h] (the old City.boxes). */
  boxes(): [number, number, number, number, number][] {
    return this.buildings.map((b) => [(b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, b.z1 - b.z0, b.h]);
  }
}
