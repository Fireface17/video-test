// Verse 2 and the build, "We've been ghosts in a crowded room": a big dark hall with a tall arched window and
// the moon. A crowd of real people stands about as translucent ghosts, each alone (arms crossed, head down, a
// phone lighting a face). L18 grows as frost on the window glass. L19 "Holding on to the friends": a man and a
// woman turn to each other and take hands, then a third joins; where their hands meet a warm light kindles and
// writes the line, and warmth flows into them. L20: the night swallows the moon, and the line curving around it;
// the hall goes dark. L21 "Then we'll light up the spot": the friends become people of light, and the light
// runs from hand to hand through the whole crowd (everyone is one chain, a double spiral around the friends),
// each ghost turning to take the next one's hand and turning into light, until the hall is full of it; the line
// hangs above them in small warm lights. The build: the joined hands rise in waves on the beats, the roof opens
// panel by panel to the night sky, lights float up from the hands, the camera rises with them, "here we go"
// punches in neon, and the last beat floods into white.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { norm, type Line } from '../../engine/lyrics';
import { clamp, ease, frameIdx, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { flickerOn } from '../lib/neon';
import { GlowPoints } from '../lib/points';
import { LightMotes, RealFigure, loadBody } from '../lib/people';
import { LightTrail, lineText } from '../lib/lightpaint';
import { displayTextGeometry, loadDisplayFont } from '../lib/fonts';
import {
  CEIL_N, GLASS_Z, HALL, LightMap, MOON, MOON_L, Shafts, WIN, backWallGeometry, ceilingPanelGeometry, glassMaterial, haloMaterial,
  moonAtJS, moonMaterial, mullionGeometry, roomMaterial, skyMaterial, worldUniforms,
} from './ghosts-gfx';
import {
  Crowd, LINK, LONELY, Phones, RAISE, SPACING, bakeBody, floorPt, heroMaterial, lighten, poseLinked, poseLonely, restLegs, type BodyBake, type Lonely,
} from './ghosts-people';
import { arcText, frostText, lightLetters, subLine } from './ghosts-text';

/** Debug: log where the camera comes closer than 1.1 m to anyone (init). */
const DEBUG_CLEAR = false;
/** Centre of the crowd: the woman of the three friends stands here. */
const O = new THREE.Vector3(0, 0, -2.5);
/** Gap between the turns of the double spiral (m). */
const GAP = 1.5;
/** How much of Michelle's hair buns is kept (1 = the model as is). */
const HAIR = 0.4;
const SPIRAL_R = 7.3;
const UP = new THREE.Vector3(0, 1, 0);
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

interface Person {
  arm: 1 | 2; k: number; body: number; pose: Lonely; v: number;
  link: THREE.Vector3; linkYaw: number; lone: THREE.Vector3; loneYaw: number;
  s: number; seed: number; tL: number; near: number; warm: THREE.Color; r: number;
}
interface Hero {
  fig: RealFigure; mat: THREE.ShaderMaterial; lonely: Lonely; v: number;
  lone: THREE.Vector3; loneYaw: number; link: THREE.Vector3; warm: THREE.Color;
}
interface Shot { pos: THREE.Vector3; tgt: THREE.Vector3; fov: number; roll: number }

const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};

export default class Ghosts extends Scene {
  st = new Stage(46, 0.05, 400);
  U = worldUniforms();
  T: Record<string, number> = {};
  L: Record<string, Line> = {};
  bars: number[] = [];
  beats: number[] = [];
  cold = col('#a8c4ff', 0.55);
  // people
  people: Person[] = [];
  crowd!: Crowd;
  phones!: Phones;
  phoneIds: number[] = [];
  heroes: Hero[] = [];
  /** The chain, in order: ('p', i) a crowd person, ('h', i) a friend. */
  chain: ['p' | 'h', number][] = [];
  motes: LightMotes[] = [];
  waves: number[] = [];
  // light
  map = new LightMap(320);
  clasps!: GlowPoints;
  rising!: GlowPoints;
  risers: { c: number; t0: number; seed: number }[] = [];
  claspUp: THREE.Vector3[] = [];
  dust!: GlowPoints;
  dust0: THREE.Vector3[] = [];
  // the hall and outside
  moonMat!: THREE.ShaderMaterial;
  haloMat!: THREE.ShaderMaterial;
  moonGrp = new THREE.Group();
  shafts!: Shafts;
  panes: { c: THREE.Vector3; w: number; h: number; k: number }[] = [];
  ceil!: THREE.InstancedMesh;
  ceilT: { x: number; z: number; t0: number; seed: number }[] = [];
  glass!: THREE.Mesh;
  // lyrics
  frost: { tr: LightTrail; line: Line }[] = [];
  trails: { tr: LightTrail; line: Line; from: number }[] = [];
  trailGrp = new THREE.Group();
  arcs: { tr: LightTrail; line: Line }[] = [];
  letters!: GlowPoints;
  letterPts: { x: number; y: number; t: number; seed: number }[] = [];
  letterGrp = new THREE.Group();
  letterBox = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
  pens!: GlowPoints;
  hereGo: { grp: THREE.Group; words: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t0: number }[] }[] = [];

  override async init() {
    const { lyrics, audio, start, end } = this.ctx;
    const S = this.st.scene, U = this.U;
    this.st.bg.copy(col('night'));
    U.uFogCol.value.copy(col('dusk', 1.2));
    U.uFogD.value = 0.034;
    U.uMoonCol.value.copy(col('#b4c8ff', 1.0));
    U.uHandCol.value.copy(col('#ffae6e', 1.0));
    U.uMap.value = this.map.rt.texture;

    // ---- timing
    const L = this.L;
    L.l18 = lyrics.get('We’ve been ghosts');
    L.l19 = lyrics.get('Holding on to the friends');
    L.l20 = lyrics.get('swallow the moon');
    L.l21 = lyrics.get('light up the spot');
    L.l22 = lyrics.get('here we go', lyrics.find('here we go').findIndex((l) => l.start > L.l21!.start));
    const wd = (l: Line, w: string, nth = 0) => l.words.filter((x) => norm(x.w) === norm(w))[nth]!.start;
    const T = this.T;
    T.s18 = L.l18.start; T.e18 = L.l18.end;
    T.s19 = L.l19.start; T.on = wd(L.l19, 'on'); T.friends = wd(L.l19, 'friends'); T.that = wd(L.l19, 'that'); T.got = wd(L.l19, 'got'); T.e19 = L.l19.end;
    T.s20 = L.l20.start; T.nights = wd(L.l20, 'night’s'); T.swallow = wd(L.l20, 'swallow'); T.moon = wd(L.l20, 'moon'); T.e20 = L.l20.end;
    T.s21 = L.l21.start; T.light = wd(L.l21, 'light'); T.spot = wd(L.l21, 'spot'); T.e21 = L.l21.end;
    T.oh = L.l22.words[0]!.start; T.here1 = L.l22.words[1]!.start; T.go1 = L.l22.words[3]!.start; T.here2 = L.l22.words[4]!.start; T.go2 = L.l22.words[6]!.start;
    this.bars = audio.downbeats.filter((d) => d >= start - 0.5 && d <= end + 0.5);
    this.beats = audio.beats.filter((d) => d >= start - 0.5 && d <= end + 0.5);
    const beatAfter = (t: number) => this.beats.find((b) => b >= t - 0.02) ?? t;
    const barAfter = (t: number) => this.bars.find((b) => b >= t - 0.02) ?? t;
    T.whip1 = beatAfter(T.e18); // to the friends
    T.cut2 = barAfter(T.e19); // cut to the moon on the downbeat
    T.cut3 = beatAfter(T.e20 - 0.2); // cut back to the friends just before "Then"
    T.whip2 = T.cut2; T.whip3 = T.cut3;
    T.crane = beatAfter(T.spot + 0.1);
    T.build = barAfter(T.e21 - 0.4);
    T.roof = barAfter(T.build + 0.5);
    T.rise = barAfter(T.oh - 0.8);
    T.last = barAfter(T.go2 - 0.2);
    T.end = end;
    // waves of raised hands: every bar, then every two beats, then every beat
    const bi = (t: number) => Math.round(audio.beatAt(t));
    for (let b = bi(T.build); b <= bi(end); b++) {
      const t = audio.timeOfBeat(b);
      const n = b - bi(T.build);
      if (t < T.roof - 0.05 ? n % 4 === 0 : t < T.rise - 0.05 ? n % 2 === 0 : true) this.waves.push(t);
    }

    // ---- the hall
    const floorMat = roomMaterial(U, 0, col('#5f5a5c'));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL.x1 - HALL.x0, HALL.z1 - WIN.z), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((HALL.x0 + HALL.x1) / 2, 0, (HALL.z1 + WIN.z) / 2);
    const wallMat = roomMaterial(U, 1, col('#3e3f4e'));
    const back = new THREE.Mesh(backWallGeometry(), wallMat);
    const sideGeo = new THREE.PlaneGeometry(HALL.z1 - WIN.z, HALL.h);
    const wallL = new THREE.Mesh(sideGeo, wallMat);
    wallL.rotation.y = Math.PI / 2;
    wallL.position.set(HALL.x0, HALL.h / 2, (HALL.z1 + WIN.z) / 2);
    const wallR = new THREE.Mesh(sideGeo, wallMat);
    wallR.rotation.y = -Math.PI / 2;
    wallR.position.set(HALL.x1, HALL.h / 2, (HALL.z1 + WIN.z) / 2);
    const front = new THREE.Mesh(new THREE.PlaneGeometry(HALL.x1 - HALL.x0, HALL.h), wallMat);
    front.rotation.y = Math.PI;
    front.position.set(0, HALL.h / 2, HALL.z1);
    const frameMat = roomMaterial(U, 3, col('#2e3450'));
    const mull = new THREE.Mesh(mullionGeometry(), frameMat);
    const colGeo = new THREE.CylinderGeometry(0.42, 0.48, HALL.h, 24, 1, true);
    colGeo.translate(0, HALL.h / 2, 0);
    const cols: [number, number][] = [[-10, -10.2], [-6.2, -10.2], [6.2, -10.2], [10, -10.2], [-10.4, 9.6], [-10.4, -0.3], [10.4, -0.3], [10.4, 9.6]];
    const colMesh = new THREE.InstancedMesh(colGeo, roomMaterial(U, 3, col('#3b4161')), cols.length);
    cols.forEach(([x, z], i) => colMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, z)));
    // the ceiling: coffered panels that fly off one after another, from the middle out, when the roof opens
    this.ceil = new THREE.InstancedMesh(ceilingPanelGeometry(), roomMaterial(U, 2, col('#34343f')), CEIL_N * CEIL_N);
    this.ceil.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ceil.frustumCulled = false;
    const cs = (HALL.x1 - HALL.x0) / CEIL_N;
    const order: { x: number; z: number; d: number; seed: number }[] = [];
    for (let i = 0; i < CEIL_N; i++) for (let j = 0; j < CEIL_N; j++) {
      const x = HALL.x0 + (i + 0.5) * cs, z = -HALL.z1 + (j + 0.5) * cs;
      order.push({ x, z, d: Math.hypot(x - O.x, z - O.z) + hash(i, j, 3) * 1.2, seed: i * CEIL_N + j });
    }
    order.sort((a, b) => a.d - b.d);
    const roofBeats = this.beats.filter((b) => b >= T.roof - 0.02 && b < T.rise + 0.4);
    order.forEach((o, k) => {
      const bt = roofBeats[Math.min(roofBeats.length - 1, Math.floor((k / order.length) * roofBeats.length))] ?? T.roof;
      this.ceilT.push({ x: o.x, z: o.z, t0: bt + (k % 3) * 0.035, seed: o.seed });
    });
    S.add(floor, back, wallL, wallR, front, mull, colMesh, this.ceil);

    // ---- outside: the sky dome, the moon with its halo (and the line that curves around it)
    const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 48, 24), skyMaterial(U));
    sky.renderOrder = 5; // after the walls, so only the window and the open roof shade the stars
    sky.frustumCulled = false;
    this.moonMat = moonMaterial(U);
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(MOON.r * 2, MOON.r * 2), this.moonMat);
    moon.renderOrder = -4;
    this.haloMat = haloMaterial(U);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(MOON.r * 8, MOON.r * 8), this.haloMat);
    halo.position.z = -0.3;
    halo.renderOrder = -3;
    this.moonGrp.add(moon, halo);
    this.moonGrp.position.copy(MOON.pos);
    this.moonGrp.lookAt(this.shot3(T.s20 + 1).pos);
    S.add(sky, this.moonGrp);
    // the window glass, with condensation
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(WIN.hw * 2, WIN.ys + WIN.hw - WIN.y0), glassMaterial(U));
    this.glass.position.set(WIN.x, (WIN.ys + WIN.hw + WIN.y0) / 2, GLASS_Z);
    S.add(this.glass);

    // ---- moonlight: one wide shaft from the window down to its patch on the floor (the bars come from the mask)
    this.panes.push({ c: V3(WIN.x, (WIN.y0 + WIN.ys + WIN.hw) / 2, WIN.z), w: WIN.hw * 2, h: WIN.ys + WIN.hw - WIN.y0, k: 1 });
    this.shafts = new Shafts(this.panes.length, U);
    S.add(this.shafts);

    // ---- people
    const [rpm, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    const bakes: BodyBake[] = [
      bakeBody(new RealFigure(rpm, 'rpm', col('white')), false, 0.3),
      bakeBody(new RealFigure(rpm, 'rpm', col('white'), undefined, { hat: true }), true, 0.7),
      bakeBody(new RealFigure(mi, 'michelle', col('white')), false, 0.6, 0.016, HAIR),
    ];
    // the three friends: a man (A), a woman (B, in the middle), a man in a hat (C); a line facing +x
    const warmHero = [col('#ffb06c', 1.1), col('#ffc08e', 1.1), col('#ffc47e', 1.05)];
    const heroDef: [typeof rpm, 'rpm' | 'michelle', boolean, Lonely, number, number, number][] = [
      [rpm, 'rpm', false, 'pockets', 0.7, 1, 2.35],
      [mi, 'michelle', false, 'phone', 0.6, 0, -0.5],
      [rpm, 'rpm', true, 'crossed', 0.35, -1, 0.9],
    ];
    heroDef.forEach(([g, kind, hat, lonely, v, k, loneYaw], i) => {
      const mat = heroMaterial(U, this.cold.clone(), warmHero[i]!, i * 3.7 + 1);
      const fig = new RealFigure(g, kind, col('white'), mat, { prepass: true, hat });
      lighten(fig, 0.011, kind === 'michelle' ? HAIR : 1);
      const link = O.clone().add(V3(0, 0, k * SPACING));
      const lone = link.clone().add(V3(0.12 * (i - 1), 0, k * 0.35));
      this.heroes.push({ fig, mat, lonely, v, lone, loneYaw, link, warm: warmHero[i]! });
      S.add(fig);
      const motes = new LightMotes(90, 0.03, 2.2);
      this.motes.push(motes);
      S.add(motes);
    });
    this.buildCrowd(bakes);
    S.add(this.crowd, this.phones);

    // ---- glows: the clasped hands, the lights that float up, dust in the moonlight
    this.clasps = new GlowPoints(this.chain.length * 2 + 16, 0.05);
    S.add(this.clasps);
    this.buildRisers();
    this.dust = new GlowPoints(300, 0.011);
    const dr = mulberry32(77);
    for (let i = 0; i < this.dust.n; i++) this.dust0.push(V3(lerp(-6, 7, dr()), lerp(0.25, 5.5, dr()), lerp(-11, 3, dr())));
    S.add(this.dust);
    this.pens = new GlowPoints(24, 0.05);
    S.add(this.pens);

    // ---- the lyrics
    await this.buildLyrics();
    if (DEBUG_CLEAR) this.debugClearance();
  }

  // -------------------------------------------------------------------------------------------------
  // the crowd: a double spiral of people around the friends (one chain), each first standing alone nearby

  private buildCrowd(bakes: BodyBake[]) {
    const T = this.T, rnd = mulberry32(1717);
    // arm 1 continues the friends' line from C (2D: u along the line A->C, v to the left of it), arm 2 from A
    const b = GAP / Math.PI;
    const dense: [number, number][] = [];
    for (let th = 0; ; th += 0.002) { const r = SPACING + b * th; if (r > SPIRAL_R + 1) break; dense.push([r * Math.cos(th), r * Math.sin(th)]); }
    const arm: [number, number][] = [];
    let acc = 0, next = SPACING;
    for (let i = 1; i < dense.length; i++) {
      acc += Math.hypot(dense[i]![0] - dense[i - 1]![0], dense[i]![1] - dense[i - 1]![1]);
      if (acc >= next) { if (Math.hypot(...dense[i]!) > SPIRAL_R) break; arm.push(dense[i]!); next += SPACING; }
    }
    // world: u -> -z, v -> +x (the friends face +x)
    const W = (u: number, v: number) => V3(O.x + v, 0, O.z - u);
    const n = arm.length;
    // light times along each arm: the first neighbour on "spot", slow at first, then racing to the end
    const tA = T.spot! + 0.02, tB = T.build! - 0.15;
    const q16 = (t: number) => { const b0 = this.ctx.audio.beatAt(t); return this.ctx.audio.timeOfBeat(Math.floor(b0)) + Math.round((b0 - Math.floor(b0)) * 4) / 4 * (this.ctx.audio.timeOfBeat(Math.floor(b0) + 1) - this.ctx.audio.timeOfBeat(Math.floor(b0))); };
    const tOf = (k: number) => q16(tA + (tB - tA) * (1 - Math.pow(1 - (k - 1) / Math.max(1, n - 1), 2.6)));
    const warmPal = [col('#ffb066'), col('#ffc485'), col('#ffa060'), col('#ffd4a2'), col('#ffb98a'), col('#ffcf95')];
    const bodies = [0, 0, 1, 2, 2, 0, 2];
    const mk = (a: 1 | 2, k: number, p: [number, number]) => {
      const sgn = a === 1 ? 1 : -1;
      const pos = W(p[0] * sgn, p[1] * sgn);
      const pose = LONELY[Math.floor(rnd() * LONELY.length)]!;
      const body = bodies[Math.floor(rnd() * bodies.length)]!;
      const person: Person = {
        arm: a, k, body, pose, v: rnd(), link: pos, linkYaw: 0, lone: pos.clone(), loneYaw: 0,
        s: 0.97 + rnd() * 0.06, seed: this.people.length + 1, tL: tOf(k), near: a === 1 ? -1 : 1,
        warm: warmPal[Math.floor(rnd() * warmPal.length)]!.clone().multiplyScalar(0.9 + 0.25 * rnd()), r: pos.clone().sub(O).setY(0).length(),
      };
      this.people.push(person);
      return this.people.length - 1;
    };
    const a1 = arm.map((p, k) => mk(1, k + 1, p)), a2 = arm.map((p, k) => mk(2, k + 1, p));
    this.chain = [...a2.slice().reverse().map((i) => ['p', i] as ['p', number]), ['h', 0], ['h', 1], ['h', 2], ...a1.map((i) => ['p', i] as ['p', number])];
    // facing: each person's left hand holds the next one along the chain
    const posOf = (c: ['p' | 'h', number]) => (c[0] === 'p' ? this.people[c[1]]!.link : this.heroes[c[1]]!.link);
    this.chain.forEach((c, j) => {
      if (c[0] !== 'p') return;
      const a = posOf(this.chain[Math.max(0, j - 1)]!), bq = posOf(this.chain[Math.min(this.chain.length - 1, j + 1)]!);
      const d = bq.clone().sub(a).setY(0).normalize();
      const f = V3(-d.z, 0, d.x);
      this.people[c[1]]!.linkYaw = Math.atan2(f.x, f.z);
    });
    // standing alone: nudged off the spiral, turned any which way, clear of the camera and its sightlines
    const cams: { p: THREE.Vector3; d: THREE.Vector3 }[] = [];
    for (let t = this.ctx.start - 0.3; t < T.crane! + 0.3; t += 0.04) {
      const s = this.camAt(t);
      cams.push({ p: s.pos, d: s.tgt.clone().sub(s.pos).setY(0).normalize() });
    }
    const sight: [THREE.Vector3, THREE.Vector3][] = [];
    for (let t = T.whip1!; t < T.cut2!; t += 0.1) { const s = this.camAt(t); for (const h of this.heroes) sight.push([s.pos, h.lone]); }
    for (let t = T.cut3!; t < T.crane!; t += 0.1) { const s = this.camAt(t); for (const h of this.heroes) sight.push([s.pos, h.link]); }
    const segD = (a: THREE.Vector3, bq: THREE.Vector3, x: number, z: number) => {
      const dx = bq.x - a.x, dz = bq.z - a.z, L2 = dx * dx + dz * dz || 1;
      const u = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
      return { d: Math.hypot(a.x + dx * u - x, a.z + dz * u - z), u, cx: a.x + dx * u, cz: a.z + dz * u };
    };
    const P = this.people;
    for (const p of P) {
      p.loneYaw = p.linkYaw + (rnd() - 0.5) * 3.4;
      p.lone.copy(p.link).add(V3((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6));
    }
    const away = (lp: THREE.Vector3, x: number, z: number, k: number) => { const v = V3(lp.x - x, 0, lp.z - z); const l = v.length() || 1; lp.addScaledVector(v, k / l); };
    for (let it = 0; it < 80; it++) {
      for (const p of P) {
        const lp = p.lone;
        for (const c of cams) {
          const vx = lp.x - c.p.x, vz = lp.z - c.p.z, dd = Math.hypot(vx, vz);
          const ahead = (vx * c.d.x + vz * c.d.z) / (dd || 1);
          if (dd < 1.05) { away(lp, c.p.x, c.p.z, 0.05); break; }
          if (dd < 2.6 && ahead > 0.78) {
            // in the near view cone: step sideways out of it
            const sx = -c.d.z, sz = c.d.x, side = vx * sx + vz * sz >= 0 ? 1 : -1;
            lp.x += sx * side * 0.05; lp.z += sz * side * 0.05;
            break;
          }
        }
        for (const [a, bq] of sight) {
          const r = segD(a, bq, lp.x, lp.z);
          if (r.d < 0.75 && r.u > 0.05 && r.u < 1) { away(lp, r.cx, r.cz, 0.05); break; }
        }
        for (const h of this.heroes) if (Math.hypot(h.lone.x - lp.x, h.lone.z - lp.z) < 0.85) away(lp, h.lone.x, h.lone.z, 0.05);
      }
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const a = P[i]!.lone, bq = P[j]!.lone, d = Math.hypot(a.x - bq.x, a.z - bq.z);
        if (d < 0.78) { const k = (0.78 - d) * 0.5; away(a, bq.x, bq.z, k); away(bq, a.x, a.z, k); }
      }
    }
    // anyone still in the way finds the nearest free spot around their place in the chain
    const ok = (lp: THREE.Vector3, self: Person) => {
      for (const c of cams) {
        const vx = lp.x - c.p.x, vz = lp.z - c.p.z, dd = Math.hypot(vx, vz);
        if (dd < 1.0 || (dd < 2.5 && (vx * c.d.x + vz * c.d.z) / (dd || 1) > 0.8)) return false;
      }
      for (const [a, bq] of sight) { const r = segD(a, bq, lp.x, lp.z); if (r.d < 0.65 && r.u > 0.05 && r.u < 1) return false; }
      for (const h of this.heroes) if (Math.hypot(h.lone.x - lp.x, h.lone.z - lp.z) < 0.8) return false;
      for (const q of P) if (q !== self && Math.hypot(q.lone.x - lp.x, q.lone.z - lp.z) < 0.68) return false;
      return true;
    };
    for (const p of P) {
      if (ok(p.lone, p)) continue;
      search: for (let r = 0.3; r < 4; r += 0.2) for (let a = 0; a < 16; a++) {
        const c = p.link.clone().add(V3(Math.cos(a * 0.3927 + r) * r, 0, Math.sin(a * 0.3927 + r) * r));
        if (ok(c, p)) { p.lone.copy(c); break search; }
      }
    }
    this.crowd = new Crowd(bakes, this.people.map((p) => ({ body: p.body, pose: p.pose })), this.U, this.cold);
    this.phoneIds = this.people.map((_, i) => i).filter((i) => this.crowd.phones[i]);
    this.phones = new Phones(this.phoneIds.length + 1);
  }

  private debugClearance() {
    const rows: string[] = [];
    for (let t = this.ctx.start; t < this.ctx.end; t += 0.1) {
      const c = this.camAt(t).pos;
      let best = 1e9, who = '';
      this.chain.forEach((ch, ci) => {
        const p = ch[0] === 'p' ? this.personAt(this.people[ch[1]]!, t, ci).pos : this.heroes[ch[1]]!.link;
        const d = Math.hypot(p.x - c.x, p.z - c.z) + Math.max(0, c.y - 2.0);
        if (d < best) { best = d; who = `${ch[0]}${ch[1]}${ch[0] === 'p' ? ` arm${this.people[ch[1]]!.arm} k${this.people[ch[1]]!.k}` : ''}`; }
      });
      if (best < 1.1) rows.push(`t=${t.toFixed(1)} cam (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) nearest ${who} at ${best.toFixed(2)}`);
    }
    console.warn('[ghosts] clearance\n' + rows.join('\n'));
  }

  /** Lights that leave the joined hands at each wave and float up out of the hall. */
  private buildRisers() {
    const ch = this.chain;
    for (let j = 0; j < ch.length - 1; j++) this.claspUp.push(V3(0, 0, 0));
    const r = mulberry32(99);
    this.waves.forEach((w, wi) => {
      for (let c = 0; c < ch.length - 1; c++) {
        if (wi > 1 && r() < 0.35) continue;
        this.risers.push({ c, t0: w + 0.14 + this.waveDelay(c) + r() * 0.08, seed: this.risers.length });
      }
    });
    // the last bar: everyone lets their light go
    for (let c = 0; c < ch.length - 1; c++) for (let k = 0; k < 3; k++) this.risers.push({ c, t0: this.T.last! + 0.04 + this.waveDelay(c) * 0.5 + k * 0.07 + r() * 0.06, seed: this.risers.length });
    this.rising = new GlowPoints(this.risers.length + 8, 0.045);
    this.st.scene.add(this.rising);
  }

  /** Delay of a wave from the friends to clasp/person at chain index c (the wave runs out along both arms). */
  private waveDelay(c: number) {
    const mid = this.chain.findIndex((x) => x[0] === 'h' && x[1] === 1);
    return Math.abs(c - mid) * 0.018;
  }

  // -------------------------------------------------------------------------------------------------
  // lyrics

  private async buildLyrics() {
    const L = this.L, S = this.st.scene;
    // L18: frost on the glass, two rows in the middle panes
    const l18 = L.l18!, n18 = l18.words.length;
    const r18 = [subLine(l18, 0, 3), subLine(l18, 3, n18)];
    const iceC = col('#cfe0ff', 0.85);
    r18.forEach((line, i) => {
      const tr = frostText(lineText(line), 'script', 1, iceC, 0.05, i * 7);
      const w = (tr.st!.width) * tr.textScale;
      const sc = Math.min(4.25 / w, 0.95);
      tr.scale.setScalar(sc);
      tr.position.set(WIN.x - 0.04 + (i ? 0.14 : -0.12), i ? 3.2 : 3.98, GLASS_Z + 0.015);
      this.frost.push({ tr, line });
      S.add(tr);
    });
    // L19: written by the warm light rising from the joined hands, above the friends
    const l19 = L.l19!, split = l19.words.findIndex((w) => norm(w.w) === 'friends');
    const r19 = [subLine(l19, 0, split), subLine(l19, split, l19.words.length)];
    r19.forEach((line, i) => {
      const tr = LightTrail.text(lineText(line), 'script', 0.46, { width: 0.016, color: col('#ffb27e', 1.25), tipLen: 0.35, seed: i * 3 + 1 });
      tr.position.set(i ? 0.16 : -0.2, i ? 2.0 : 2.55, 0);
      this.trails.push({ tr, line, from: i });
      this.trailGrp.add(tr);
    });
    this.trailGrp.position.set(O.x + 0.25, 0, O.z);
    this.trailGrp.rotation.y = Math.PI / 2;
    S.add(this.trailGrp);
    // L20: around the moon (moon plane, metres; the moon radius MOON.r), the night swallows it with the moon
    const l20 = L.l20!, s20 = l20.words.findIndex((w) => norm(w.w) === 'swallow');
    const silver = col('#dfe8ff', 1.1);
    const top = subLine(l20, 0, s20), bot = subLine(l20, s20, l20.words.length);
    const em = MOON.r * 0.66;
    const ta = arcText(lineText(top), 'script', em, { apex: MOON.r + 0.55, radius: 14, below: false, color: silver, width: 0.034, R: MOON.r, fit: 19, seed: 2 });
    const tb = arcText(lineText(bot), 'script', em, { apex: MOON.r + 0.55, radius: 14, below: true, color: silver, width: 0.034, R: MOON.r, fit: 16, seed: 5 });
    for (const [tr, line] of [[ta, top], [tb, bot]] as const) { tr.position.z = 0.4; this.moonGrp.add(tr); this.arcs.push({ tr, line }); }
    // L21: letters of small warm lights above the friends
    const l21 = L.l21!, s21 = l21.words.findIndex((w) => norm(w.w) === 'up');
    const rows = [
      { text: l21.words.slice(0, s21).map((w) => w.w).join(' '), y: 0.62, words: l21.words.slice(0, s21) },
      { text: l21.words.slice(s21).map((w) => w.w).join(' '), y: 0, words: l21.words.slice(s21) },
    ];
    this.letterPts = lightLetters(rows, 'script', 0.6, 0.011);
    for (const p of this.letterPts) { const B = this.letterBox; B.x0 = Math.min(B.x0, p.x); B.x1 = Math.max(B.x1, p.x); B.y0 = Math.min(B.y0, p.y); B.y1 = Math.max(B.y1, p.y); }
    this.letters = new GlowPoints(this.letterPts.length, 0.02);
    S.add(this.letters);
    // L22: "here we go" in neon, punched on the words
    const font = await loadDisplayFont('tiltneon');
    const l22 = L.l22!;
    const groups = [[0, 1, 2, 3], [4, 5, 6]];
    groups.forEach((ids, gi) => {
      const grp = new THREE.Group();
      const geos = ids.map((i) => displayTextGeometry(font, l22.words[i]!.w.replace(/[,.]/g, '').toUpperCase(), 1, { curveSegments: 10 }));
      const ws = geos.map((g) => g.boundingBox!.max.x - g.boundingBox!.min.x);
      const gap = 0.32, total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
      let x = -total / 2;
      const words = ids.map((wi, k) => {
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(geos[k]!, mat);
        mesh.position.x = x + ws[k]! / 2;
        mesh.renderOrder = 50;
        x += ws[k]! + gap;
        grp.add(mesh);
        return { mesh, mat, t0: l22.words[wi]!.start };
      });
      this.hereGo.push({ grp, words });
      S.add(grp);
      void gi;
    });
  }

  // -------------------------------------------------------------------------------------------------
  // camera: shots joined by swings that land on beats

  private shot1(t: number): Shot {
    const T = this.T, k = prog(t, this.ctx.start - 0.3, T.whip1! + 0.4);
    const surge = this.bars.filter((d) => d < T.whip1!).reduce((a, d) => a + 0.25 * ease.outExpo(clamp((t - d) / 0.8)), 0);
    const u = clamp(k * 0.8 + surge * 0.4);
    const pos = V3(0.8, 1.6, -5.0).lerp(V3(0.36, 1.66, -6.6), u);
    const tgt = V3(0.05, 3.2, GLASS_Z).lerp(V3(0.0, 3.55, GLASS_Z), k);
    return { pos, tgt, fov: 50, roll: 0.008 };
  }

  private shot2(t: number): Shot {
    const T = this.T, k = prog(t, T.whip1! - 0.4, T.cut2!);
    const surge = this.bars.filter((d) => d > T.whip1! && d < T.cut2!).reduce((a, d) => a + 0.3 * ease.outExpo(clamp((t - d) / 0.8)), 0);
    const ang = lerp(0.36, 0.12, k) - surge * 0.07, r = lerp(4.1, 3.55, k) - surge * 0.18;
    const pos = O.clone().add(V3(Math.cos(ang) * r, lerp(1.48, 1.56, k), Math.sin(ang) * r));
    const tgt = O.clone().add(V3(0, lerp(1.85, 1.95, k), lerp(0.12, -0.04, k)));
    return { pos, tgt, fov: 44, roll: -0.012 };
  }

  shot3(t: number): Shot {
    const T = this.T, k = prog(t, T.cut2!, T.cut3!);
    // close under the window, looking up through the middle pane at the moon
    const pos = V3(0.22, 1.06, -9.1).lerp(V3(0.16, 0.98, -9.36), ease.inOutQuad(k));
    const tgt = MOON.pos.clone().add(V3(0, -MOON.r * 0.12, 0));
    return { pos, tgt, fov: lerp(27, 24.5, ease.inOutQuad(k)), roll: 0.0 };
  }

  private shot4(t: number): Shot {
    const T = this.T;
    const k = prog(t, T.cut3!, T.crane!);
    // low, in front of the friends; then the crane rises and pulls back to see the light run through everyone
    const c = ease.inOutCubic(prog(t, T.crane!, T.build!));
    const surge = this.bars.filter((d) => d > T.crane! && d < T.build!).reduce((a, d) => a + 0.1 * ease.outExpo(clamp((t - d) / 0.9)), 0);
    const cc = clamp(c + surge * 0.6, 0, 1.2);
    const ang = lerp(lerp(0.3, 0.22, k), -0.5, cc);
    const r = lerp(lerp(3.5, 3.2, k), 9.6, cc);
    const pos = O.clone().add(V3(Math.cos(ang) * r, lerp(1.2, 7.8, cc), Math.sin(ang) * r));
    const tgt = O.clone().add(V3(0, lerp(1.95, 0.3, cc), lerp(-0.05, 0, cc)));
    return { pos, tgt, fov: lerp(44, 50, cc), roll: lerp(0, -0.03, cc) };
  }

  private shot5(t: number): Shot {
    const T = this.T;
    // the build: from the edge of the hall, the crowd below and the roof opening above; turning on the bars
    const k = prog(t, T.build!, T.rise!);
    const surge = this.bars.filter((d) => d > T.build! + 0.1 && d < T.rise!).reduce((a, d) => a + ease.outExpo(clamp((t - d) / 0.7)), 0);
    const ang = 1.85 + 0.05 * k + 0.1 * surge, r = 10.2 - 0.3 * surge;
    const pos = O.clone().add(V3(Math.cos(ang) * r, 1.9 + 0.6 * k + 0.45 * surge, Math.sin(ang) * r));
    const tgt = O.clone().add(V3(0, 3.5 + 0.5 * surge, 0));
    return { pos, tgt, fov: 62, roll: 0.02 };
  }

  private shot6(t: number): Shot {
    const T = this.T;
    // up to the open roof, looking down at everyone with their hands up while the lights float up past the
    // lens; on the last bar the camera turns up and shoots up with the lights into the sky
    const k = ease.inOutQuad(prog(t, T.rise!, T.last!));
    const w = ease.inQuad(prog(t, T.last!, T.end! + 0.25));
    const pos = O.clone().add(V3(lerp(5.0, 2.7, k) - 0.8 * w, lerp(4.6, 9.4, k) + 2.5 * w, lerp(5.4, 3.7, k) - 0.6 * w));
    const surge = this.bars.filter((d) => d > T.rise! + 0.1 && d < T.last! - 0.1).reduce((a, d) => a + 0.45 * ease.outExpo(clamp((t - d) / 0.6)), 0);
    pos.y += surge;
    const tgt = O.clone().add(V3(-1.7, 0.6, -3.3));
    return { pos, tgt, fov: lerp(56, 60, k) + 12 * w, roll: 0.03 * Math.sin(t * 1.3) + 0.05 * w };
  }

  /** Camera at t (pure). */
  camAt(t: number): Shot {
    const T = this.T;
    const blend = (a: Shot, b: Shot, k: number): Shot => {
      const da = a.tgt.clone().sub(a.pos).normalize(), db = b.tgt.clone().sub(b.pos).normalize();
      const ya = Math.atan2(da.x, da.z), yb = Math.atan2(db.x, db.z);
      const pa = Math.asin(clamp(da.y, -1, 1)), pb = Math.asin(clamp(db.y, -1, 1));
      const y = lerpAngle(ya, yb, k), p = lerp(pa, pb, k);
      const pos = a.pos.clone().lerp(b.pos, k);
      const dir = V3(Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p));
      return { pos, tgt: pos.clone().addScaledVector(dir, 6), fov: lerp(a.fov, b.fov, k), roll: lerp(a.roll, b.roll, k) };
    };
    const sw = (t0: number, d: number) => ease.inOutCubic(prog(t, t0, t0 + d));
    let s: Shot;
    if (t < T.whip1!) s = this.shot1(t);
    else if (t < T.whip1! + 0.4) s = blend(this.shot1(t), this.shot2(t), sw(T.whip1!, 0.4));
    else if (t < T.cut2!) s = this.shot2(t);
    else if (t < T.cut3!) s = this.shot3(t);
    else if (t < T.build!) s = this.shot4(t);
    else if (t < T.rise!) s = this.shot5(t);
    else if (t < T.rise! + 0.45) s = blend(this.shot5(t), this.shot6(t), sw(T.rise!, 0.45));
    else s = this.shot6(t);
    // handheld
    s.pos.x += noise1(t * 0.35, 3) * 0.03;
    s.pos.y += noise1(t * 0.3, 5) * 0.02;
    s.pos.z += noise1(t * 0.33, 8) * 0.03;
    s.tgt.x += noise1(t * 0.42, 11) * 0.05;
    s.tgt.y += noise1(t * 0.37, 12) * 0.04;
    return s;
  }

  // -------------------------------------------------------------------------------------------------
  // per-frame posing

  /** Raised-hands level of chain element c at t (waves running out from the friends; all up at the end). */
  private raiseAt(c: number, t: number) {
    const T = this.T, dl = this.waveDelay(c);
    let k = 0;
    for (const w of this.waves) {
      const a = t - (w + dl);
      if (a < -0.05 || a > 1.2) continue;
      const up = ease.outCubic(clamp(a / 0.16)), down = 1 - ease.inOutQuad(clamp((a - 0.22) / 0.55));
      k = Math.max(k, Math.min(up, down));
    }
    k = Math.max(k, ease.outCubic(prog(t, T.last! + dl - 0.05, T.last! + dl + 0.2)));
    return k * prog(t, T.build! - 0.2, T.build! + 0.05);
  }

  private poseHeroes(t: number, kick: number) {
    const T = this.T, H = this.heroes;
    const yawLink = Math.PI / 2;
    const ci = (i: number) => this.chain.findIndex((x) => x[0] === 'h' && x[1] === i);
    const up = H.map((_, i) => this.raiseAt(ci(i), t));
    // clasp points (world): A-B, B-C, and each friend's outer hand to the first person of the spiral arm
    const handPt = (h: Hero, side: number, k: number) => {
      const y = lerp(LINK.y, RAISE.y, k), x = lerp(LINK.x, RAISE.x, k), z = lerp(LINK.z, RAISE.z, k);
      return h.link.clone().add(V3(z, y, -side * x)); // facing +x: the figure's left (+x local) is world -z
    };
    const cAB = handPt(H[0]!, 1, (up[0]! + up[1]!) / 2).lerp(handPt(H[1]!, -1, (up[0]! + up[1]!) / 2), 0.5);
    const cBC = handPt(H[1]!, 1, (up[1]! + up[2]!) / 2).lerp(handPt(H[2]!, -1, (up[1]! + up[2]!) / 2), 0.5);
    const first2 = this.people.find((p) => p.arm === 2 && p.k === 1)!, first1 = this.people.find((p) => p.arm === 1 && p.k === 1)!;
    const personHand = (p: Person, side: number, k: number) => {
      const y = lerp(LINK.y, RAISE.y, k), x = lerp(LINK.x, RAISE.x, k), z = lerp(LINK.z, RAISE.z, k);
      const c = Math.cos(p.linkYaw), s = Math.sin(p.linkYaw);
      return p.link.clone().add(V3(side * x * c + z * s, y, -side * x * s + z * c));
    };
    const cA = personHand(first2, 1, up[0]!).lerp(handPt(H[0]!, -1, up[0]!), 0.5);
    const cC = personHand(first1, -1, up[2]!).lerp(handPt(H[2]!, 1, up[2]!), 0.5);
    // timing of each hand: [reach start, contact]
    const reachAB: [number, number] = [T.whip1! - 0.25, T.s19!], reachBC: [number, number] = [T.on! - 0.05, T.friends!];
    const outer: [number, number] = [T.spot! - 0.42, first1.tL];
    // [hand 0 (right, toward A's side), hand 1 (left, toward C's side)] targets and timings per friend
    const plan: [THREE.Vector3, [number, number]][][] = [
      [[cA, [outer[0], first2.tL]], [cAB, reachAB]],
      [[cAB, reachAB], [cBC, reachBC]],
      [[cBC, reachBC], [cC, outer]],
    ];
    const lookAt: number[] = [0, 0, 0];
    const tLight = T.light!;
    H.forEach((h, i) => {
      const f = h.fig;
      const kHand = plan[i]!.map(([, [a, b]]) => ease.inOutCubic(prog(t, a, b)));
      const kBody = ease.inOutCubic(prog(t, Math.min(...plan[i]!.map((p) => p[1][0])) - 0.1, Math.min(...plan[i]!.map((p) => p[1][1])) + 0.5));
      // turn toward the partner while reaching, then settle facing front
      const turnTo = i === 0 ? 0.6 : i === 2 ? -0.6 : 0;
      const settle = ease.inOutCubic(prog(t, T.got! - 0.2, T.e19! - 0.2));
      const yaw = lerpAngle(h.loneYaw, yawLink + turnTo * (1 - settle), kBody);
      f.position.copy(h.lone).lerp(h.link, kBody).setY(f.hipHeight + 0.005 * Math.sin(t * 1.7 + i));
      f.rotation.set(0, yaw, 0);
      for (const k of [0, 1]) { f.setFoot(k, 0); f.setHand(k, 0.3); }
      const lp = poseLonely(f, h.lonely, h.v, false);
      restLegs(f, lp.stand, lp.relax * (1 - kBody));
      const linked = [-0.05 * Math.max(...up), 0, -0.05 - 0.32 * Math.max(...up), 0];
      const sp = lp.spine.map((x, j) => lerp(x, linked[j]!, kBody)) as [number, number, number, number];
      // looking at the partner as they reach, chins up once they hold on
      f.setSpine(sp[0], sp[1], sp[2] - 0.1 * kBody * (1 - settle), sp[3]);
      for (const k of [0, 1]) {
        if (kHand[k]! <= 0) continue;
        const from = f.hand(k);
        const [tgt] = plan[i]![k]!;
        const target = from.clone().lerp(tgt, kHand[k]!);
        target.y += Math.sin(Math.PI * kHand[k]!) * 0.08;
        f.reach(k, target, V3(k ? 0.35 : -0.35, -1, -0.45));
        f.setHand(k, lerp(0.35, 0.6, kHand[k]!));
      }
      lookAt[i] = (i === 0 ? 1 : i === 2 ? -1 : (t < T.on! ? -1 : 1)) * (1 - settle) * kBody;
      f.time = t;
      // head turn toward the partner (after the pose is applied)
      f.updateMatrixWorld(true);
      const turn = lookAt[i]! * 0.55;
      if (Math.abs(turn) > 1e-3) for (const b of ['Neck', 'Head']) {
        const bone = f.bone(b), pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
        const q = new THREE.Quaternion().setFromAxisAngle(UP, turn / 2);
        bone.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
        bone.updateMatrixWorld(true);
      }
      // warmth flows in from the first clasp; the light at "light"
      const mat = h.mat, uni = mat.uniforms;
      const first = i === 2 ? T.friends! : T.s19!;
      (uni.uFlowO!.value as THREE.Vector3).copy(i === 2 ? cBC : cAB);
      uni.uFlow!.value = prog(t, first, first + 1.6, ease.outQuad);
      uni.uTintMax!.value = 0.7;
      const lk = prog(t, tLight - 0.04, tLight + 0.5, ease.outCubic);
      uni.uLight!.value = lk;
      uni.uGain!.value = (1 + 1.6 * pulse(t, tLight, 0.16) + 0.35 * pulse(t, first, 0.2)) * (1 + 0.1 * kick * lk) * (1 - 0.15 * (1 - this.U.uMoonK.value) * (1 - lk));
      const phoneK = i === 1 ? 1 - prog(t, T.on! - 0.1, T.friends! - 0.2) : 0;
      if (i === 1 && phoneK > 0) {
        const hp = f.hand(1).clone().lerp(f.hand(0), t < T.s19! - 0.2 ? 0.5 : 0);
        (uni.uPhoneP!.value as THREE.Vector4).set(hp.x, hp.y + 0.03, hp.z, phoneK);
      } else (uni.uPhoneP!.value as THREE.Vector4).w = 0;
      // motes of light drifting off them once they glow
      this.motes[i]!.update(f, t, h.warm.clone().multiplyScalar(1.6), 0.9 * lk + 0.25 * prog(t, first, first + 1));
    });
    // the clasped hands glow (uniforms for the room and the bodies)
    const hk0 = t < T.s19! ? 0 : 1 + 2.2 * pulse(t, T.s19!, 0.14) + 0.3 * kick;
    const hk1 = t < T.friends! ? 0 : 1 + 2.2 * pulse(t, T.friends!, 0.14) + 0.3 * kick;
    const dark = 1 - this.U.uMoonK.value;
    this.U.uHand0.value.copy(cAB);
    this.U.uHand1.value.copy(cBC);
    const boom = 1 + 2.5 * pulse(t, T.light!, 0.25);
    this.U.uHandK.value.set(hk0 * (1 + 0.6 * dark) * boom, hk1 * (1 + 0.6 * dark) * boom);
    return { cAB, cBC, cA, cC, hk0, hk1 };
  }

  /** Crowd person i at t: position, yaw, morph and state. */
  private personAt(p: Person, t: number, c: number) {
    const tL = p.tL;
    const kb = ease.inOutCubic(prog(t, tL - 0.5, tL + 0.06));
    const kn = ease.inOutCubic(prog(t, tL - 0.42, tL));
    const kf = ease.inOutCubic(prog(t, tL + 0.04, tL + 0.46));
    const up = this.raiseAt(c, t);
    const pos = p.lone.clone().lerp(p.link, kb);
    const yaw = lerpAngle(p.loneYaw, p.linkYaw, kb);
    const flow = prog(t, tL - 0.02, tL + 0.62);
    const kL = p.near > 0 ? kn : kf, kR = p.near > 0 ? kf : kn;
    return { pos, yaw, kb, kL, kR, up, flow };
  }

  // -------------------------------------------------------------------------------------------------

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T, U = this.U, cam = this.st.cam, S = this.st.scene;
    const kick = f.a.kick;
    U.uTime.value = t;
    U.uFrame.value = frameIdx(t);

    // ---- camera
    const shot = this.camAt(t);
    cam.fov = shot.fov;
    cam.updateProjectionMatrix();
    aim(cam, shot.pos, shot.tgt, shot.roll);

    // ---- the moon: swallowed by the night from "swallow"; the hall goes dark
    // the night creeps in on "night's", takes the moon through "swallow the moon", then closes over everything
    const eat = prog(t, T.nights! + 0.2, T.swallow!, ease.inOutQuad) * 0.36 + prog(t, T.swallow!, T.moon! + 0.5, ease.inOutQuad) * 0.36
      + prog(t, T.moon! + 0.5, T.cut3! - 0.08, ease.inQuad) * 0.28;
    for (const m of [this.moonMat, this.haloMat]) m.uniforms.uEat!.value = eat;
    // the line around the moon is read first, then swallowed last, as the night closes over everything
    for (const a of this.arcs) a.tr.material.uniforms.uEat!.value = prog(eat, 0.7, 1.0);
    const vis = 1 - smoothstep(0.45, 0.82, eat);
    U.uMoonK.value = vis * (0.95 + 0.05 * Math.sin(t * 0.7));
    this.haloMat.uniforms.uK!.value = vis;
    U.uAmb.value = lerp(0.05, 0.16, vis);
    this.moonGrp.visible = t < T.whip3! + 0.5;

    // ---- the roof opens
    const cs = (HALL.x1 - HALL.x0) / CEIL_N, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler();
    let opened = 0;
    this.ceilT.forEach((c, i) => {
      const a = Math.max(0, t - c.t0);
      const lift = a > 0 ? 0.6 * a + 4.5 * a * a : 0;
      const dir = V3(c.x - O.x, 0, c.z - O.z).normalize();
      const p = V3(c.x + dir.x * 1.2 * a * a, HALL.h + 0.15 + lift, c.z + dir.z * 1.2 * a * a);
      e3.set((hash(c.seed, 1) - 0.5) * 1.4 * a + dir.z * 0.5 * Math.min(a, 1), 0, (hash(c.seed, 2) - 0.5) * 1.4 * a - dir.x * 0.5 * Math.min(a, 1));
      q.setFromEuler(e3);
      const shake = a === 0 && t > c.t0 - 0.4 ? 0.02 * Math.sin(t * 60 + c.seed) * prog(t, c.t0 - 0.4, c.t0) : 0;
      p.y += shake;
      m4.compose(p, q, V3(1, 1, 1));
      this.ceil.setMatrixAt(i, m4);
      if (a > 0) opened++;
      void cs;
    });
    this.ceil.instanceMatrix.needsUpdate = true;
    U.uOpen.value = opened / this.ceilT.length;

    // ---- people
    const H = this.poseHeroes(t, kick);
    const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), sc = new THREE.Vector3();
    const lit = (tl: number) => prog(t, tl, tl + 0.6);
    this.map.begin();
    let fillN = 0;
    const fillC = new THREE.Color(0, 0, 0);
    const gainG = 0.85 + 0.15 * U.uMoonK.value;
    const surgeEnd = 1 + 0.9 * ease.inQuad(prog(t, T.last!, T.end! + 0.2));
    const phM = new THREE.Matrix4(), phQ = new THREE.Quaternion();
    let phN = 0;
    this.chain.forEach((c, ci) => {
      if (c[0] !== 'p') return;
      const p = this.people[c[1]]!, s = this.personAt(p, t, ci);
      qq.setFromAxisAngle(UP, s.yaw + 0.03 * Math.sin(t * 0.45 + p.seed) * (1 - s.kb));
      sc.setScalar(p.s);
      m.compose(s.pos.clone().setY(0.004 * Math.sin(t * 1.4 + p.seed)), qq, sc);
      const phone = this.crowd.phones[c[1]] ? 1 - smoothstep(0.05, 0.3, s.kb) : 0;
      const gain = (1 + 1.4 * pulse(t, p.tL, 0.13)) * (s.flow > 0 ? (1 + 0.12 * kick) * (1 + 0.22 * s.up) * surgeEnd : gainG);
      this.crowd.set(c[1], m, [s.kb, s.kL, s.kR, s.up], [s.flow, p.seed * 0.137 % 1 + p.seed, gain, phone], p.warm, p.near);
      const ph = this.crowd.phones[c[1]];
      if (ph) {
        phQ.setFromUnitVectors(V3(0, 0, 1), ph.n);
        phM.compose(ph.p, phQ, V3(1, 1, 1)).premultiply(m);
        this.phones.setMatrixAt(phN, phM);
        this.phones.aK.array[phN] = phone * (0.85 + 0.15 * noise1(t * 2 + p.seed, 4));
        phN++;
      }
      const L = lit(p.tL);
      if (L > 0) {
        this.map.add(s.pos.x, s.pos.z, 2.0, p.warm, 0.5 * L * (1 + 1.4 * pulse(t, p.tL, 0.15)));
        fillC.add(p.warm.clone().multiplyScalar(L));
        fillN++;
      }
    });
    this.phones.count = phN;
    this.phones.instanceMatrix.needsUpdate = true;
    this.phones.aK.needsUpdate = true;
    this.crowd.commit();
    // the friends' warmth in the light map
    const lk = prog(t, T.light!, T.light! + 0.5);
    this.heroes.forEach((h) => { const fp = h.fig.position; this.map.add(fp.x, fp.z, 2.4, h.warm, 0.25 * lk + 0.15 * prog(t, T.s19!, T.s19! + 1)); });
    this.map.add(H.cAB.x, H.cAB.z, 2.2, U.uHandCol.value, 0.35 * U.uHandK.value.x);
    this.map.add(H.cBC.x, H.cBC.z, 2.2, U.uHandCol.value, 0.35 * U.uHandK.value.y);
    this.map.render(this.ctx.renderer);
    U.uMapK.value = 1;
    U.uFill.value.copy(fillC).multiplyScalar(0.011 * (1 + 0.15 * kick)).add(col('#ffb070', 0.02 * lk));

    // ---- the clasped hands along the chain, and the lights that float up from them
    this.poseClasps(t, kick, H);

    // ---- moonlight shafts
    for (let i = 0; i < this.panes.length; i++) {
      const pn = this.panes[i]!;
      const len = pn.c.y / MOON_L.y;
      const b = pn.c.clone().addScaledVector(MOON_L, -len);
      this.shafts.set(i, pn.c, b, pn.w * 1.3, pn.w * 2.6, 0.16 * (0.88 + 0.12 * noise1(t * 0.6, i)), cam.position);
    }
    this.shafts.commit();
    this.shafts.visible = U.uMoonK.value > 0.01;
    this.poseDust(t);

    // ---- lyrics
    this.poseLyrics(t, H);

        this.st.render(this.ctx.renderer, out);
    void S;
    const end = T.end!;
    const flash = 0.03 * pulse(t, T.light!, 0.06) + 0.2 * ease.inQuad(prog(t, end - 0.25, end + 0.2));
    const db = this.bars.reduce((a, d) => a + pulse(t, d, 0.18), 0);
    return {
      bloom: 0.95 + 0.4 * prog(t, T.build!, end), bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45 - 0.2 * prog(t, T.rise!, end), grain: 0.05, ca: 0.8,
      flash, zoom: 1 + 0.004 * kick + 0.006 * db + 0.04 * ease.inQuad(prog(t, T.last!, end + 0.2)), exposure: 1 + 1.1 * ease.inQuad(prog(t, T.last!, end + 0.2)),
    };
  }

  private poseClasps(t: number, kick: number, H: ReturnType<Ghosts['poseHeroes']>) {
    const ch = this.chain, G = this.clasps, warm = col('#ffbd85');
    let n = 0;
    const handOf = (c: ['p' | 'h', number], side: number, up: number) => {
      if (c[0] === 'h') return null;
      const p = this.people[c[1]]!, x = lerp(LINK.x, RAISE.x, up), y = lerp(LINK.y, RAISE.y, up), z = lerp(LINK.z, RAISE.z, up);
      const cy = Math.cos(p.linkYaw), sy = Math.sin(p.linkYaw);
      return p.link.clone().add(V3((side * x * cy + z * sy) * p.s, y * p.s, (-side * x * sy + z * cy) * p.s));
    };
    for (let j = 0; j < ch.length - 1; j++) {
      const a = ch[j]!, b = ch[j + 1]!;
      // light time of the clasp: when the later of the two is lit
      const tl = Math.max(a[0] === 'p' ? this.people[a[1]]!.tL : this.T.s19!, b[0] === 'p' ? this.people[b[1]]!.tL : this.T.s19!);
      const up = (this.raiseAt(j, t) + this.raiseAt(j + 1, t)) / 2;
      let pos: THREE.Vector3 | null = null;
      if (a[0] === 'h' && b[0] === 'h') pos = a[1] === 0 ? H.cAB : H.cBC;
      else if (a[0] === 'h') pos = H.cC; // C -> first of arm 1
      else if (b[0] === 'h') pos = H.cA; // last of arm 2 -> A
      else pos = handOf(a, 1, up)!.lerp(handOf(b, -1, up)!, 0.5);
      // raised clasp (for the risers)
      const hu = a[0] === 'p' && b[0] === 'p' ? handOf(a, 1, 1)!.lerp(handOf(b, -1, 1)!, 0.5) : pos.clone().setY(RAISE.y);
      this.claspUp[j]!.copy(hu);
      if (t < tl) continue;
      const k = (1 + 2.5 * pulse(t, tl, 0.12)) * (0.8 + 0.25 * kick) * (1 + 0.5 * up);
      if (a[0] === 'h' && b[0] === 'h') continue; // the friends' clasps are drawn below
      G.set(n++, pos.x, pos.y, pos.z, warm, 1.2 * k, 1.1);
      G.set(n++, pos.x, pos.y, pos.z, warm, 0.25 * k, 4.5);
      this.map.add(pos.x, pos.z, 1.2, warm, 0.06 * k);
    }
    // the friends' clasps: a hot core and a soft halo
    const T = this.T, hk = [H.hk0, H.hk1], cp = [H.cAB, H.cBC];
    for (let c = 0; c < 2; c++) {
      if (hk[c]! <= 0) continue;
      const p = cp[c]!;
      G.set(n++, p.x, p.y, p.z, col('#ffe0c4'), hk[c]! * 1.8, 1.4);
      G.set(n++, p.x, p.y, p.z, warm, hk[c]! * 0.45, 7);
    }
    // the last beat: a light swells from the middle of the spiral
    const burst = ease.inQuad(prog(t, T.last!, T.end! + 0.2));
    if (burst > 0) {
      G.set(n++, O.x, 1.6, O.z, col('#fff1e0'), 2.5 * burst, 6 + 30 * burst);
      G.set(n++, O.x, 1.6, O.z, warm, 1.2 * burst, 40 + 90 * burst);
    }
    G.commit(n);
    // risers
    const R = this.rising;
    let r = 0;
    for (const s of this.risers) {
      const a = t - s.t0;
      if (a < 0 || a > 6) continue;
      const p0 = this.claspUp[s.c]!;
      const fast = s.t0 >= this.T.last! - 0.01;
      const y = p0.y + (fast ? 4 * a + 62 * a * a : 0.9 * a + 0.55 * a * a);
      if (y > 60) continue;
      const x = p0.x + noise1(a * 0.8 + s.seed, 7) * 0.5 * a, z = p0.z + noise1(a * 0.8 + s.seed, 9) * 0.5 * a;
      const k = smoothstep(0, 0.15, a) * (0.75 + 0.25 * Math.sin(t * 7 + s.seed));
      R.set(r++, x, y, z, warm, (fast ? 2.6 : 1.7) * k, (fast ? 2.4 : 1.3) + 0.8 * hash(s.seed, 3));
    }
    R.commit(r);
  }

  private poseDust(t: number) {
    const U = this.U, moonK = U.uMoonK.value;
    const moonC = U.uMoonCol.value, warm = col('#ffc89a');
    const fill = Math.min(1, (U.uFill.value.r + U.uFill.value.g) * 1.2);
    const c = new THREE.Color();
    this.dust0.forEach((p0, i) => {
      const x = p0.x + noise1(t * 0.13 + i, 1) * 0.35;
      const y = p0.y + noise1(t * 0.11 + i, 2) * 0.3 + 0.06 * Math.sin(t * 0.4 + i) + 0.4 * Math.max(0, t - this.T.build!) * (0.5 + hash(i, 3));
      const z = p0.z + noise1(t * 0.12 + i, 3) * 0.35;
      const inMoon = moonAtJS(x, y, z) * moonK;
      const tw = 0.6 + 0.4 * Math.sin(t * (1.5 + (i % 7) * 0.3) + i);
      c.copy(moonC).multiplyScalar(0.1 + 1.6 * inMoon).lerp(warm, fill).multiplyScalar(1 + 1.2 * fill);
      this.dust.set(i, x, y, z, c, tw, 0.7 + 0.6 * hash(i, 4));
    });
    this.dust.commit();
  }

  /** Where the L21 letters sit for a camera: block centre at 47% above the frame centre, 3.4 m away, 56% wide. */
  private letterPose(c: Shot | { pos: THREE.Vector3; q: THREE.Quaternion; fov: number }) {
    let q: THREE.Quaternion;
    if ('q' in c) q = c.q.clone();
    else { const tmp = new THREE.PerspectiveCamera(); aim(tmp, c.pos, c.tgt, c.roll); q = tmp.quaternion.clone(); }
    const d = 3.4, tv = Math.tan(THREE.MathUtils.degToRad(c.fov / 2));
    const fwd = V3(0, 0, -1).applyQuaternion(q), up = V3(0, 1, 0).applyQuaternion(q);
    const B = this.letterBox, s = (0.56 * 2 * tv * (16 / 9) * d) / (B.x1 - B.x0);
    const centre = c.pos.clone().addScaledVector(fwd, d).addScaledVector(up, 0.47 * tv * d);
    const pos = centre.sub(V3((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, 0).multiplyScalar(s).applyQuaternion(q));
    return { pos, q, s };
  }

  private poseLyrics(t: number, H: ReturnType<Ghosts['poseHeroes']>) {
    const T = this.T, cam = this.st.cam;
    // L18: frost; it melts away as the camera leaves the window
    for (const { tr, line } of this.frost) {
      tr.visible = t > line.words[0]!.start - 0.05 && t < T.whip2!;
      tr.reveal = tr.writtenAt(line, t, 0.5);
      tr.material.uniforms.uTime!.value = t;
      tr.material.uniforms.melt!.value = prog(t, T.whip1! + 0.5, T.whip1! + 2.5);
      tr.material.uniforms.gain!.value = 1.0 * (0.4 + 0.6 * this.U.uMoonK.value);
    }
    this.glass.visible = true;
    // L19: written by the warm light from the joined hands; a spark leaps from the hands to the pen
    const P = this.pens;
    let pn = 0;
    const warmW = col('#ffd9b8');
    this.trails.forEach(({ tr, line, from }) => {
      const t0 = line.words[0]!.start;
      tr.visible = t > t0 && t < T.cut3!;
      const lag = 0.14;
      tr.reveal = tr.writtenAt(line, t - lag, 0.55);
      tr.gain = 1 + 0.6 * pulse(t, T.got!, 0.3);
      const src = from === 0 ? H.cAB : H.cBC;
      tr.updateMatrixWorld(true);
      const head = tr.localToWorld(tr.pointAt(tr.reveal));
      const jump = prog(t, t0, t0 + lag, ease.outCubic);
      if (t > t0 && t < t0 + 6) {
        const writing = tr.reveal < tr.total - 1e-3;
        const pp = src.clone().lerp(tr.localToWorld(tr.pointAt(0)), jump);
        const at = jump < 1 ? pp : head;
        if (jump < 1 || writing) {
          P.set(pn++, at.x, at.y, at.z, warmW, 2.0, 0.9);
          P.set(pn++, at.x, at.y, at.z, col('#ffa868'), 0.45, 3);
        }
        if (jump < 1) for (let k = 1; k < 5; k++) { const q = src.clone().lerp(at, 1 - k * 0.2); P.set(pn++, q.x, q.y, q.z, col('#ffa868'), 0.6 * (1 - k * 0.18), 0.7); }
      }
    });
    // L20: around the moon, written in silver, swallowed with it
    for (const { tr, line } of this.arcs) {
      tr.reveal = tr.writtenAt(line, t, 0.42);
      tr.material.uniforms.uTime!.value = t;
      tr.visible = t > line.words[0]!.start - 0.05;
      const pen = tr.reveal < tr.total - 1e-3 && t > line.words[0]!.start;
      if (pen) {
        tr.updateMatrixWorld(true);
        const hp = tr.localToWorld(tr.pointAt(tr.reveal));
        P.set(pn++, hp.x, hp.y, hp.z, col('#f0f4ff'), 2.2 * this.U.uMoonK.value, 7);
      }
    }
    P.commit(pn);
    // L21: letters of small warm lights above the friends; in the build they float up with the others
    const G = this.letters, grp = this.letterGrp;
    // hung above the friends (where the camera sees them at the start of the crane), then carried along with
    // the camera through the crane so the held "spot" stays readable, the block in the upper part of the frame
    const held = this.letterPose(this.camAt(T.crane!)), live = this.letterPose({ pos: cam.position, q: cam.quaternion, fov: cam.fov });
    const kc = ease.inOutCubic(prog(t, T.crane!, T.crane! + 1.4));
    grp.position.copy(held.pos).lerp(live.pos, kc);
    grp.quaternion.copy(held.q).slerp(live.q, kc);
    grp.scale.setScalar(lerp(held.s, live.s, kc));
    grp.updateMatrixWorld(true);
    const v = new THREE.Vector3(), warm = col('#ffc690'), hot = col('#fff0dc');
    let li = 0;
    for (const p of this.letterPts) {
      if (t < p.t) continue;
      const a = t - p.t;
      const rel = T.build! + 0.4 + hash(p.seed, 2) * 3.2;
      const fl = Math.max(0, t - rel);
      v.set(p.x, p.y, 0).applyMatrix4(grp.matrixWorld);
      v.x += noise1(fl * 0.6 + p.seed, 3) * 0.6 * fl;
      v.z += noise1(fl * 0.6 + p.seed, 5) * 0.6 * fl;
      v.y += 0.6 * fl + 0.8 * fl * fl;
      const on = smoothstep(0, 0.06, a) * (1 + 1.6 * Math.exp(-a * 6));
      const c = hot.clone().lerp(warm, smoothstep(0, 0.4, a));
      G.set(li++, v.x, v.y, v.z, c, 1.3 * on * (0.85 + 0.15 * Math.sin(t * 5 + p.seed)) * (1 + 0.3 * prog(t, T.crane!, T.build!)), 0.9 + 0.4 * hash(p.seed, 7));
    }
    G.commit(li);
    // L22: "here we go" in neon, punched on the words, in front of the camera
    const fwd = V3(0, 0, -1).applyQuaternion(cam.quaternion), upv = V3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.hereGo.forEach((hg, k) => {
      const t0 = hg.words[0]!.t0, t1 = k === 0 ? T.here2! - 0.04 : 1e9;
      hg.grp.visible = t > t0 - 0.05 && t < t1;
      const d = 6;
      const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * d;
      hg.grp.position.copy(cam.position).addScaledVector(fwd, d).addScaledVector(upv, (k === 0 ? 0.6 : 0.5) * tv);
      hg.grp.quaternion.copy(cam.quaternion);
      hg.grp.scale.setScalar(tv * (k === 0 ? 0.26 : 0.4));
      hg.words.forEach((w) => {
        const on = flickerOn(t, w.t0, k * 3 + 1);
        const punch = 1 + 0.3 * pulse(t, w.t0, 0.08);
        w.mesh.scale.setScalar(punch);
        w.mat.color.copy(col('#fff3e6', 2.2).lerp(col('#ffb070', 2.0), 0.35)).multiplyScalar(on * (k === 1 ? 1.15 : 1));
      });
    });
  }
}
