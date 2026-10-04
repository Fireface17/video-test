// Verse 2, "Ghosts in a crowded room": a big dark hall with a tall arched window and a large moon outside.
// A crowd of translucent pale-blue ghosts stands still, facing every which way; the camera glides between
// them at eye level, and each sung line hangs in the air as cold neon script.
// L18 establishes the crowd. L19 "Holding on to the friends": two, then three ghosts turn and take hands;
// the clasped hands light up warm, a chain of light, the first warm colour in the hall. L20: the camera
// turns to the window and the night swallows the moon; the hall goes dark. L21 "Then we'll light up the
// spot": a spotlight strikes the middle of the hall, the mirror ball ignites, spots sweep the walls and the
// ghosts, and the ghosts warm up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Scene, type Frame } from '../../engine/scene';
import { norm, type Line } from '../../engine/lyrics';
import { clamp, ease, frameIdx, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { figureGeometry } from '../lib/shapes';
import { NeonLine, flickerOn } from '../lib/neon';
import { GlowPoints } from '../lib/points';
import {
  ARM_LEN, Auras, HALL, MOON_L, Shafts, WIN, armGeometry, backWallGeometry, ballMaterial, bodyGeometry, coneGeometry, coneMaterial,
  discoDirections, ghostMaterial, haloMaterial, moonAtJS, moonMaterial, mullionGeometry, roomMaterial, skyMaterial, worldUniforms,
} from './ghosts-gfx';

const DEBUG_SAFE = true; // warn when a lit sign leaves the title-safe area
const EYE = 1.6;
const N_CROWD = 66;
const MOON_POS = new THREE.Vector3(-7.9, 13.3, -44);
const MOON_R = 4.2;
const BALL = new THREE.Vector3(2.55, 3.65, -7.6);
const POOL = { x: 2.4, z: -7.0, r: 1.75 };
const TRIO_Q = new THREE.Vector3(3.45, 0, -0.2); // centre of the three friends
const TRIO_GAP = 1.15;

/** Neon switch-off: steady, a short stutter, then dark (frame-keyed like flickerOn). */
function flickerOff(t: number, t0: number, seed = 0): number {
  const dt = t - t0;
  if (dt < 0) return 1;
  if (dt > 0.13) return 0;
  const pat = [0.25, 1, 0.1, 0.8, 0, 0.45, 0, 0.15];
  return pat[Math.min(pat.length - 1, Math.floor(dt / 0.016))]! * (0.7 + 0.3 * hash(frameIdx(t), seed));
}

/** ∫ smoothstep(a, a + d, x) dx from a to t (a ramp that eases into a constant rate 1). */
function easedRamp(t: number, a: number, d: number) {
  if (t <= a) return 0;
  if (t >= a + d) return d * 0.5 + (t - a - d);
  const u = (t - a) / d;
  return d * (u * u * u - (u * u * u * u) / 2);
}

const nlerp = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k).normalize();

interface Ghost { x: number; z: number; yaw: number; s: number; hover: number; seed: number; tint: THREE.Color; dPool: number; inPool: boolean }
interface Friend { pos: THREE.Vector3; face: number; yaw0: number; turnT: number }
interface SignDef {
  nl: NeonLine; line: Line; anchor: THREE.Vector3; tShow: number; tOff: number; rise: number; name: string;
  /** Screen-stable (held at sx, sy, depth d in front of the lens) until `until`, then settling into the anchor. */
  lock?: { d: number; sx: number; sy: number; until: number }; cy: number;
}

export default class Ghosts extends Scene {
  st = new Stage(50, 0.05, 220);
  U = worldUniforms();
  // timing
  L18!: Line; L19!: Line; L20!: Line; L21!: Line;
  T: Record<string, number> = {};
  bars: number[] = [];
  // camera
  curve!: THREE.CatmullRomCurve3;
  sTab: Float32Array = new Float32Array(0);
  sT0 = 0; sDt = 1 / 120;
  aims: Record<string, THREE.Vector3> = {};
  // crowd
  ghosts: Ghost[] = [];
  crowd!: THREE.InstancedMesh;
  trioBodies!: THREE.InstancedMesh;
  trioArms!: THREE.InstancedMesh;
  friends: Friend[] = [];
  hands: THREE.Vector3[] = [];
  beads!: GlowPoints;
  auras!: Auras;
  cold = col('#94bbff', 0.62);
  dust!: GlowPoints;
  dust0: THREE.Vector3[] = [];
  // the hall and outside
  moonMat!: THREE.ShaderMaterial;
  haloMat!: THREE.ShaderMaterial;
  shafts!: Shafts;
  panes: { c: THREE.Vector3; w: number; h: number; k: number }[] = [];
  spotCone!: THREE.Mesh;
  ballBeam!: THREE.Mesh;
  discoBeams!: THREE.Mesh;
  ball!: THREE.Mesh;
  cable!: THREE.Mesh;
  ballMat!: THREE.ShaderMaterial;
  spotSrc = new THREE.Vector3();
  ballSrc = new THREE.Vector3(-7.5, 8.9, 2.0);
  signs: SignDef[] = [];

  override async init() {
    const { lyrics, audio, start, end } = this.ctx;
    const S = this.st.scene, U = this.U;
    this.st.bg.copy(col('night'));
    U.uFogCol.value.copy(col('dusk', 1.5));
    U.uFogD.value = 0.042;
    U.uMoonCol.value.copy(col('#a9c2ff', 1.0));
    U.uMoonPos.value.copy(MOON_POS);
    U.uMoonR.value = MOON_R;
    U.uBall.value.copy(BALL);
    U.uPool.value.set(POOL.x, POOL.z, POOL.r, 0);
    U.uPoolCol.value.copy(col('#ffe2f0', 1.0));
    U.uHandCol.value.copy(col('pink', 1.0));

    // ---- timing: lines, words, bars
    this.L18 = lyrics.get('We’ve been ghosts');
    this.L19 = lyrics.get('Holding on to the friends');
    this.L20 = lyrics.get('swallow the moon');
    this.L21 = lyrics.get('light up the spot');
    const wd = (l: Line, w: string) => l.words.find((x) => norm(x.w) === norm(w))!.start;
    this.bars = audio.downbeats.filter((d) => d >= start - 0.01 && d <= end + 0.01);
    const nextBar = (t: number) => this.bars.find((d) => d >= t - 0.02) ?? end;
    const T = this.T;
    T.s18 = this.L18.start; T.e18 = this.L18.end;
    T.s19 = this.L19.start; T.on = wd(this.L19, 'on'); T.friends = wd(this.L19, 'friends'); T.that = wd(this.L19, 'that'); T.got = wd(this.L19, 'got'); T.e19 = this.L19.end;
    T.s20 = this.L20.start; T.nights = wd(this.L20, 'night’s'); T.swallow = wd(this.L20, 'swallow'); T.moon = wd(this.L20, 'moon'); T.e20 = this.L20.end;
    T.s21 = this.L21.start; T.light = wd(this.L21, 'light'); T.spot = wd(this.L21, 'spot');
    T.turn = nextBar(T.nights); // the turn to the window lands on the bar after "night’s"

    // ---- camera path (positions), arc-length timing with surges on the downbeats
    this.curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(8.7, EYE, 3.45),
      new THREE.Vector3(6.4, EYE - 0.02, 2.65),
      new THREE.Vector3(5.15, EYE - 0.03, 1.9),
      new THREE.Vector3(5.6, EYE + 0.02, 0.25),
      new THREE.Vector3(5.75, EYE + 0.12, -1.6),
    ], false, 'centripetal');
    this.buildTiming();
    this.aims = {
      a18: new THREE.Vector3(-5.4, 1.48, -1.9),
      a19: new THREE.Vector3(TRIO_Q.x, 1.4, TRIO_Q.z),
      a20: new THREE.Vector3(WIN.x + 0.3, 3.9, WIN.z),
      a21: new THREE.Vector3(BALL.x - 1.25, 2.45, BALL.z),
    };

    // ---- the hall
    const floorMat = roomMaterial(U, 0, col('#59617f'));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALL.x1 - HALL.x0, HALL.z1 - WIN.z), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((HALL.x0 + HALL.x1) / 2, 0, (HALL.z1 + WIN.z) / 2);
    const wallMat = roomMaterial(U, 1, col('#363c5a'));
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
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(HALL.x1 - HALL.x0, HALL.z1 - WIN.z), roomMaterial(U, 2, col('#2a2f48')));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, HALL.h, (HALL.z1 + WIN.z) / 2);
    const frameMat = roomMaterial(U, 3, col('#2e3450'));
    const mull = new THREE.Mesh(mullionGeometry(), frameMat);
    // two rows of columns (front and back; the back row leaves the window clear)
    const colGeo = new THREE.CylinderGeometry(0.42, 0.48, HALL.h, 20, 1, true);
    colGeo.translate(0, HALL.h / 2, 0);
    const cols: [number, number][] = [[-10, -10.2], [-6.2, -10.2], [6.2, -10.2], [10, -10.2], [-10, 9.2], [-5.2, 9.2], [-0.4, 9.2], [4.4, 9.2], [9.2, 9.2]];
    const colMesh = new THREE.InstancedMesh(colGeo, roomMaterial(U, 3, col('#3a4060')), cols.length);
    cols.forEach(([x, z], i) => colMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, z)));
    S.add(floor, back, wallL, wallR, front, ceil, mull, colMesh);

    // ---- outside: sky, moon, halo
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(220, 120), skyMaterial(U));
    sky.position.set(-6, 14, -70);
    sky.renderOrder = -5;
    this.moonMat = moonMaterial(U);
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(MOON_R * 2, MOON_R * 2), this.moonMat);
    moon.position.copy(MOON_POS);
    moon.renderOrder = -4;
    this.haloMat = haloMaterial(U);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(MOON_R * 8, MOON_R * 8), this.haloMat);
    halo.position.copy(MOON_POS).add(new THREE.Vector3(0, 0, 0.5));
    halo.renderOrder = -3;
    for (const m of [moon, halo]) m.lookAt(new THREE.Vector3(3, EYE, 0));
    S.add(sky, moon, halo);

    // ---- moonlight shafts, one per window pane
    const xs = [-WIN.hw, WIN.cols[0]!, WIN.cols[1]!, WIN.hw];
    const ys = [WIN.y0, ...WIN.rows, WIN.ys + WIN.hw];
    const pr = mulberry32(31);
    for (let ci = 0; ci < 3; ci++)
      for (let ri = 0; ri < 4; ri++) {
        const x0 = xs[ci]!, x1 = xs[ci + 1]!, y0 = ys[ri]!;
        let y1 = ys[ri + 1]!;
        const cx = (x0 + x1) / 2;
        if (ri === 3) y1 = WIN.ys + Math.sqrt(Math.max(0, WIN.hw * WIN.hw - cx * cx)) * 0.92;
        this.panes.push({ c: new THREE.Vector3(WIN.x + cx, (y0 + y1) / 2, WIN.z), w: x1 - x0 - 2 * WIN.mull, h: y1 - y0 - 2 * WIN.mull, k: 0.75 + 0.5 * pr() });
      }
    this.shafts = new Shafts(this.panes.length, U, 'moon');
    S.add(this.shafts);

    // ---- the crowd
    this.placeFriends();
    this.placeCrowd();
    const cold = this.cold;
    const ghostMat = ghostMaterial(U, cold);
    const mkInst = (geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, n: number) => {
      const g = geo.clone();
      g.setAttribute('aG', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.InstancedMesh(g, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      return m;
    };
    this.crowd = mkInst(figureGeometry(0), ghostMat, this.ghosts.length);
    this.trioBodies = mkInst(bodyGeometry(), ghostMat, 3);
    this.trioArms = mkInst(armGeometry(), ghostMaterial(U, cold, true), 6);
    this.auras = new Auras(this.ghosts.length + 3, U);
    S.add(this.auras, this.crowd, this.trioBodies, this.trioArms);
    this.beads = new GlowPoints(64, 0.05);
    S.add(this.beads);

    // ---- dust motes drifting through the shafts
    this.dust = new GlowPoints(260, 0.011);
    const dr = mulberry32(77);
    for (let i = 0; i < this.dust.n; i++) this.dust0.push(new THREE.Vector3(lerp(-3.5, 9, dr()), lerp(0.25, 4.6, dr()), lerp(-9, 4.8, dr())));
    S.add(this.dust);

    // ---- the light: spotlight cone onto the pool, a beam onto the mirror ball, the ball and its beams
    this.spotSrc.set(POOL.x + 0.9, HALL.h - 0.15, POOL.z + 0.7);
    const poolC = new THREE.Vector3(POOL.x, 0, POOL.z);
    const dSpot = poolC.clone().sub(this.spotSrc);
    this.spotCone = new THREE.Mesh(coneGeometry(0.12, POOL.r * 0.95, dSpot.length(), 36), coneMaterial(U, col('#ffe6f2', 0.32)));
    this.spotCone.position.copy(this.spotSrc);
    this.spotCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dSpot.clone().normalize());
    const dBall = BALL.clone().sub(this.ballSrc);
    this.ballBeam = new THREE.Mesh(coneGeometry(0.05, 0.42, dBall.length(), 20), coneMaterial(U, col('#f2f4ff', 0.9)));
    this.ballBeam.position.copy(this.ballSrc);
    this.ballBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dBall.clone().normalize());
    this.ballMat = ballMaterial(U);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.4, 40, 28), this.ballMat);
    this.ball.position.copy(BALL);
    const cable = (this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, HALL.h - BALL.y), frameMat));
    cable.position.set(BALL.x, (HALL.h + BALL.y) / 2, BALL.z);
    // beams from the ball along some of its spot directions (they rotate with it)
    const h12 = (x: number, y: number) => {
      const fr = (v: number) => v - Math.floor(v);
      let a = fr(x * 0.1031), b = fr(y * 0.1031), c = fr(x * 0.1031);
      const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
      a += d; b += d; c += d;
      return fr((a + b) * c);
    };
    const dirs = discoDirections((j, k) => j >= 3 && j <= 13 && h12(j * 3.1 + 1, k + 0.5) > 0.3 && hash(j, k, 5) < 0.12);
    const parts = dirs.map((d, i) => {
      const g = coneGeometry(0.004, 0.16, 11, 6, 0.6 + 0.8 * hash(i, 9));
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d));
      return g;
    });
    this.discoBeams = new THREE.Mesh(mergeGeometries(parts, false)!, coneMaterial(U, col('#f4f0ff', 0.16)));
    (this.discoBeams.material as THREE.ShaderMaterial).uniforms.uFall!.value = 3.2;
    this.discoBeams.position.copy(BALL);
    S.add(this.spotCone, this.ball, cable, this.discoBeams);

    // ---- the sung lines, as cold neon script hanging in the air
    this.buildSigns();
    if (DEBUG_SAFE) {
      const p = new THREE.Vector3(), d = new THREE.Vector3();
      const rows = [95.2, 96.5, 97.9, 98.5, 99.5, 100.5, 101.5, 102.3, 102.8, 103.4, 104.4, 105.0, 105.5, 106.0, 107.0, 108.0, 108.7].map((t) => {
        this.camAt(t, p, d);
        const yaw = (Math.atan2(-d.x, -d.z) * 180) / Math.PI, pitch = (Math.asin(d.y) * 180) / Math.PI;
        return `${t}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) yaw ${yaw.toFixed(1)} pitch ${pitch.toFixed(1)}`;
      });
      console.warn('[ghosts] camera\n' + rows.join('\n') + '\nT ' + JSON.stringify(this.T));
    }
  }

  // -------------------------------------------------------------------------------------------------
  // camera

  /** Arc-length progress table: slow glide (slower while watching the friends) plus surges on the bars. */
  private buildTiming() {
    const { start, end } = this.ctx, T = this.T;
    const speed = (t: number) =>
      0.78 + (0.42 - 0.78) * smoothstep(T.s19! - 0.6, T.s19! + 0.4, t) + (0.5 - 0.42) * smoothstep(T.turn!, T.turn! + 1, t) +
      (0.55 - 0.5) * smoothstep(T.light!, T.light! + 1, t);
    this.sT0 = start - 1;
    const n = Math.ceil((end + 1 - this.sT0) / this.sDt) + 1;
    const tab = new Float32Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      const t = this.sT0 + i * this.sDt;
      const surge = this.bars.reduce((a, d) => a + 0.16 * ease.outExpo(clamp((t - d) / 0.85)), 0)
        + 0.3 * ease.outExpo(clamp((t - T.light!) / 0.9)) + 0.2 * ease.outExpo(clamp((t - T.spot!) / 0.9));
      tab[i] = s + surge;
      s += speed(t) * this.sDt;
    }
    // normalise so that the window maps onto the whole curve
    const a = this.lookup(tab, start), b = this.lookup(tab, end);
    for (let i = 0; i < n; i++) tab[i] = (tab[i]! - a) / (b - a);
    this.sTab = tab;
  }

  private lookup(tab: Float32Array, t: number) {
    const x = (t - this.sT0) / this.sDt, i = clamp(Math.floor(x), 0, tab.length - 2), f = clamp(x - i, 0, 1);
    return lerp(tab[i]!, tab[i + 1]!, f);
  }

  /** Camera position and view direction at t (pure). */
  camAt(t: number, pos: THREE.Vector3, dir: THREE.Vector3) {
    const T = this.T, A = this.aims;
    const u = clamp(this.lookup(this.sTab, t), 0, 1);
    pos.copy(this.curve.getPointAt(u));
    pos.x += noise1(t * 0.35, 3) * 0.04;
    pos.y += noise1(t * 0.3, 5) * 0.025;
    pos.z += noise1(t * 0.33, 8) * 0.04;
    const to = (p: THREE.Vector3) => p.clone().sub(pos).normalize();
    let d = to(A.a18!);
    d = nlerp(d, to(A.a19!), prog(t, T.e18! + 0.02, T.s19! - 0.04, ease.inOutCubic));
    d = nlerp(d, to(A.a20!), prog(t, T.s20! + 0.02, T.turn! + 0.05, ease.inOutCubic));
    d = nlerp(d, to(A.a21!), prog(t, T.light! - 0.3, T.light! + 1.1, ease.inOutCubic));
    // handheld wander
    d.x += noise1(t * 0.42, 11) * 0.012;
    d.y += noise1(t * 0.37, 12) * 0.01;
    dir.copy(d.normalize());
  }

  // -------------------------------------------------------------------------------------------------
  // the friends (three ghosts that take hands) and the crowd

  private placeFriends() {
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    this.camAt(this.T.got!, pos, dir);
    const face = Math.atan2(pos.x - TRIO_Q.x, pos.z - TRIO_Q.z); // turned toward the camera
    const right = new THREE.Vector3(Math.cos(face), 0, -Math.sin(face));
    const T = this.T;
    const yaw0 = [face + 2.0, face - 1.4, face + 2.9];
    const turnT = [T.s19!, T.s19! + 0.08, T.friends!];
    [-1, 0, 1].forEach((k, i) => {
      this.friends.push({ pos: TRIO_Q.clone().addScaledVector(right, k * TRIO_GAP), face, yaw0: yaw0[i]!, turnT: turnT[i]! });
    });
    // clasp points: between neighbours' shoulders (facing the camera), down and a little forward, so that a
    // straight arm of ARM_LEN reaches them exactly
    const fwd = new THREE.Vector3(Math.sin(face), 0, Math.cos(face));
    const hd = (TRIO_GAP - 0.46) / 2, fz = 0.13, dy = Math.sqrt(ARM_LEN * ARM_LEN - hd * hd - fz * fz);
    for (let i = 0; i < 2; i++) {
      const m = this.friends[i]!.pos.clone().add(this.friends[i + 1]!.pos).multiplyScalar(0.5);
      this.hands.push(m.addScaledVector(fwd, fz).setY(1.36 - dy));
    }
  }

  private placeCrowd() {
    const rnd = mulberry32(1717);
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    // camera samples: path points (to keep clear) and views (to fill)
    const { start, end } = this.ctx;
    const path: THREE.Vector3[] = [];
    for (let i = 0; i <= 60; i++) { this.camAt(lerp(start, end, i / 60), pos, dir); path.push(pos.clone()); }
    const views: { p: THREE.Vector3; d: THREE.Vector3 }[] = [];
    for (let i = 0; i <= 16; i++) { this.camAt(lerp(start, end, i / 16), pos, dir); views.push({ p: pos.clone(), d: dir.clone() }); }
    const seen = (x: number, z: number) => views.some(({ p, d }) => {
      const v = new THREE.Vector3(x - p.x, 0, z - p.z);
      const dist = v.length();
      if (dist > 15 || dist < 1.2) return false;
      const dh = new THREE.Vector3(d.x, 0, d.z).normalize();
      return v.normalize().dot(dh) > Math.cos(0.8);
    });
    // sightlines from the camera (while the friends are on screen) to each of them
    const sight: [THREE.Vector3, THREE.Vector3][] = [];
    for (let k = 0; k <= 6; k++) {
      this.camAt(lerp(this.T.s19! - 0.2, this.T.turn!, k / 6), pos, dir);
      for (const fr of this.friends) sight.push([pos.clone(), fr.pos.clone()]);
    }
    const segDist = (a: THREE.Vector3, b: THREE.Vector3, x: number, z: number) => {
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      const u = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1.1);
      return Math.hypot(a.x + dx * u - x, a.z + dz * u - z);
    };
    const tints = [col('pink'), col('violet'), col('#ffc4e4'), col('pink'), col('violet'), col('#ffc4e4'), col('cyan')];
    const pts: Ghost[] = [];
    // two ghosts standing in the spot pool, lit when the light comes on
    const fixed: [number, number][] = [[POOL.x - 0.55, POOL.z + 0.25], [POOL.x + 0.6, POOL.z - 0.35]];
    for (let tries = 0; pts.length < N_CROWD && tries < 6000; tries++) {
      const f = fixed[pts.length];
      const x = f ? f[0] : lerp(-8.5, 9.8, rnd()), z = f ? f[1] : lerp(-10.8, 6.8, rnd());
      if (!f) {
        if (path.some((p) => Math.hypot(p.x - x, p.z - z) < 0.85)) continue;
        if (this.friends.some((g) => Math.hypot(g.pos.x - x, g.pos.z - z) < 1.15)) continue;
        if (sight.some(([p, m]) => segDist(p, m, x, z) < 0.6)) continue;
        if (Math.hypot(x - POOL.x, z - POOL.z) < 1.2) continue;
        if (pts.some((g) => Math.hypot(g.x - x, g.z - z) < 1.15)) continue;
        if (!seen(x, z)) continue;
      }
      const dPool = Math.hypot(x - POOL.x, z - POOL.z);
      pts.push({
        x, z, yaw: rnd() * Math.PI * 2, s: 0.92 + rnd() * 0.14, hover: 0.04 + rnd() * 0.08, seed: pts.length + 1,
        tint: dPool < POOL.r ? col('#ffd9ec') : tints[Math.floor(rnd() * tints.length)]!, dPool, inPool: dPool < POOL.r,
      });
    }
    this.ghosts = pts;
  }

  // -------------------------------------------------------------------------------------------------
  // signs

  private buildSigns() {
    const T = this.T, S = this.st.scene;
    const cyan = col('cyan', 2.1), ice = col('#8fb8ff', 2.3), pink = col('pink', 2.4);
    /** A line in rows, anchored in the world where the camera at `at.t` sees it at screen (sx, sy), distance d. */
    const mk = (line: Line, rows: number[][], color: THREE.Color, at: { t: number; d: number; sx: number; sy: number }, tShow: number, tOff: number, rise: number, name: string, lockUntil?: number) => {
      const size = 0.052 * at.d, lead = size * 1.08;
      const nl = new NeonLine(line, rows, { font: 'script', size, color, leading: lead });
      S.add(nl);
      const cy = ((rows.length - 1) * lead) / 2 + nl.rows[0]!.sign.capHeight * 0.45; // block centre above the origin
      const anchor = this.screenPoint(at.t, at.d, at.sx, at.sy).add(new THREE.Vector3(0, -cy, 0));
      this.signs.push({ nl, line, anchor, tShow, tOff, rise, name, cy, lock: lockUntil ? { d: at.d, sx: at.sx, sy: at.sy, until: lockUntil } : undefined });
      return nl;
    };
    // L18: low among the ghosts' misty legs, left of centre
    mk(this.L18, [[0, 1, 2], [3, 4, 5, 6]], cyan, { t: (T.s18! + T.e18!) / 2, d: 5.2, sx: -0.3, sy: -0.52 }, T.s18! - 0.3, T.e18! + 0.06, 0.6, 'L18');
    // L19: upper left, in the dark of the hall (the friends below, the moon to the right)
    const s19 = mk(this.L19, [[0, 1, 2, 3, 4], [5, 6, 7]], cyan, { t: T.friends!, d: 5.6, sx: -0.35, sy: 0.45 }, T.s19! - 0.25, T.s20! - 0.02, 0.5, 'L19');
    s19.rows[0]!.sign.setColor(4, pink); // "friends": the first warm word
    // L20: takes over L19's place at the line change, held steady on screen through the turn to the window
    mk(this.L20, [[0, 1, 2, 3], [4, 5, 6]], ice, { t: T.turn! + 0.5, d: 5.6, sx: -0.4, sy: 0.45 }, T.s20! - 0.02, T.e20!, 0.5, 'L20', T.turn! + 0.05);
    // L21: lower left; the light and the mirror ball take the right
    const s21 = mk(this.L21, [[0, 1, 2], [3, 4, 5]], ice, { t: T.spot! + 0.6, d: 4.6, sx: -0.44, sy: -0.5 }, T.s21! - 0.12, 1e9, 0, 'L21');
    s21.rows[0]!.sign.setColor(2, col('#ffe9f6', 2.6));
    for (let k = 0; k < 3; k++) s21.rows[1]!.sign.setColor(k, pink);
    if (DEBUG_SAFE) this.verifySigns();
  }

  /** World point that the camera at time t sees at normalised screen position (sx, sy), at depth d. */
  private screenPoint(t: number, d: number, sx: number, sy: number) {
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    this.camAt(t, pos, dir);
    const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const tv = Math.tan(THREE.MathUtils.degToRad(this.st.cam.fov / 2)), th = tv * this.st.cam.aspect;
    return pos.addScaledVector(dir, d).addScaledVector(right, d * sx * th).addScaledVector(up, d * sy * tv);
  }

  /** Pose a sign at t for a camera at camPos: anchored, bobbing gently, rising away once switched off. */
  private placeSign(s: SignDef, t: number, cam: THREE.PerspectiveCamera) {
    s.nl.position.copy(s.anchor);
    if (s.lock && t < s.lock.until + 0.6) {
      const { d, sx, sy } = s.lock, q = cam.quaternion;
      const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)), th = tv * cam.aspect;
      const p = cam.position.clone()
        .addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(q), d)
        .addScaledVector(new THREE.Vector3(1, 0, 0).applyQuaternion(q), d * sx * th)
        .addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(q), d * sy * tv);
      p.y -= s.cy;
      s.nl.position.lerpVectors(p, s.anchor, smoothstep(s.lock.until, s.lock.until + 0.6, t));
    }
    s.nl.position.y += s.rise * ease.inCubic(clamp((t - s.tOff) / 1.5)) + 0.02 * Math.sin((t - s.tShow) * 1.3 + s.line.i);
    s.nl.quaternion.copy(cam.quaternion); // square to the lens, level on screen
  }

  private poseSigns(t: number) {
    const cam = this.st.cam;
    for (const s of this.signs) {
      const vis = t >= s.tShow && t < s.tOff + 0.14;
      s.nl.visible = vis;
      if (!vis) continue;
      this.placeSign(s, t, cam);
      s.nl.sing(t, flickerOff(t, s.tOff, s.line.i));
    }
  }

  /** Debug: screen extent of every sign over its whole sung interval (warns outside title-safe). */
  private verifySigns() {
    const cam = this.st.cam.clone(), pos = new THREE.Vector3(), dir = new THREE.Vector3(), v = new THREE.Vector3();
    const report: string[] = [];
    for (const s of this.signs) {
      let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, h0 = 1e9, h1 = -1e9;
      const ta = s.line.words[0]!.start, tb = Math.min(s.tOff, s.line.end, this.ctx.end);
      for (let t = ta; t <= tb; t += 1 / 30) {
        this.camAt(t, pos, dir);
        aim(cam, pos, pos.clone().addScaledVector(dir, 5));
        this.placeSign(s, t, cam);
        s.nl.updateMatrixWorld(true);
        let ya = 1e9, yb = -1e9;
        for (const { sign, ids } of s.nl.rows) sign.words.forEach((w, k) => {
          if ((s.line.words[ids[k]!]?.start ?? 1e9) > t) return; // only words already lit
          const g = w.mesh.geometry;
          if (!g.boundingBox) g.computeBoundingBox();
          const bb = g.boundingBox!;
          for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) {
            v.set(cx, cy, 0).applyMatrix4(w.mesh.matrixWorld).project(cam);
            const sx = ((v.x + 1) / 2) * 1920, sy = ((1 - v.y) / 2) * 1080;
            x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
            ya = Math.min(ya, sy); yb = Math.max(yb, sy);
          }
        });
        if (yb > ya) { h0 = Math.min(h0, yb - ya); h1 = Math.max(h1, yb - ya); }
      }
      const ok = x0 >= 96 && x1 <= 1824 && y0 >= 96 && y1 <= 984;
      report.push(`${s.name}: x ${x0.toFixed(0)}..${x1.toFixed(0)}  y ${y0.toFixed(0)}..${y1.toFixed(0)}  block h ${h0.toFixed(0)}..${h1.toFixed(0)}px ${ok ? 'ok' : 'OUTSIDE TITLE-SAFE'}`);
    }
    console.warn('[ghosts] signs\n' + report.join('\n'));
  }

  // -------------------------------------------------------------------------------------------------

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, T = this.T, U = this.U, cam = this.st.cam;
    const kick = f.a.kick;
    U.uTime.value = t;
    U.uFrame.value = frameIdx(t);
    U.uKick.value = kick;

    // ---- camera
    const pos = new THREE.Vector3(), dir = new THREE.Vector3();
    this.camAt(t, pos, dir);
    aim(cam, pos, pos.clone().addScaledVector(dir, 5), noise1(t * 0.21, 4) * 0.012);

    // ---- moon: swallowed by the night from "swallow" to the end of "moon"; the hall darkens
    const eat = prog(t, T.nights! + 0.25, T.swallow!, ease.inQuad) * 0.18 + prog(t, T.swallow!, T.e20! - 0.15, ease.inOutCubic) * 0.82;
    this.moonMat.uniforms.uEat!.value = eat;
    const vis = 1 - smoothstep(0.08, 0.97, eat);
    U.uMoonK.value = vis * (0.95 + 0.05 * Math.sin(t * 0.7));
    this.haloMat.uniforms.uK!.value = vis;
    U.uAmb.value = lerp(0.07, 0.2, vis);

    // ---- the light (L21)
    const ign = flickerOn(t, T.light!, 3);
    const full = flickerOn(t, T.spot!, 5);
    const poolK = ign * (1.2 + 0.9 * pulse(t, T.light!, 0.18) + 0.25 * kick) + 0.35 * full;
    U.uPool.value.w = poolK;
    (this.spotCone.material as THREE.ShaderMaterial).uniforms.uK!.value = ign * (0.75 + 0.15 * kick) + 0.25 * full;
    (this.ballBeam.material as THREE.ShaderMaterial).uniforms.uK!.value = full * (0.8 + 0.2 * kick);
    U.uDisco.value = ign * 0.3 + full * (0.75 + 0.9 * pulse(t, T.spot!, 0.2) + 0.25 * kick);
    U.uBallRot.value = 0.12 * (t - this.ctx.start) + 0.25 * easedRamp(t, T.light!, 0.5) + 0.35 * easedRamp(t, T.spot!, 1.0);
    this.discoBeams.rotation.y = U.uBallRot.value;
    (this.discoBeams.material as THREE.ShaderMaterial).uniforms.uK!.value = full * (0.8 + 0.3 * kick) + ign * 0.15;
    this.ballMat.uniforms.uLit!.value = Math.min(1, ign * 0.6 + full);
    (this.ballMat.uniforms.uSrc!.value as THREE.Vector3).copy(full > 0 ? this.ballSrc : this.spotSrc);
    this.ball.rotation.y = U.uBallRot.value;
    this.ballBeam.visible = full > 0.001;
    this.ball.visible = this.cable.visible = U.uMoonK.value < 0.12 || ign > 0; // unseen in the dark until the moon is gone
    this.spotCone.visible = ign > 0.001;
    this.discoBeams.visible = ign > 0.001;

    // ---- moonlight shafts
    for (let i = 0; i < this.panes.length; i++) {
      const p = this.panes[i]!;
      const len = p.c.y / MOON_L.y;
      const b = p.c.clone().addScaledVector(MOON_L, -len);
      const wa = 0.5 * Math.sqrt(p.w * p.h) * 0.85;
      this.shafts.set(i, p.c, b, wa, wa * 1.3, 0.15 * p.k * (0.85 + 0.15 * noise1(t * 0.6, i)), cam.position);
    }
    this.shafts.commit();

    // ---- ghosts
    this.poseCrowd(t, kick);
    this.poseFriends(t, kick);
    this.poseDust(t);

    // ---- signs
    this.poseSigns(t);

    this.st.render(this.ctx.renderer, out);
    const flash = 0.025 * pulse(t, T.light!, 0.05) + 0.02 * pulse(t, T.spot!, 0.05);
    const db = this.bars.reduce((a, d) => a + pulse(t, d, 0.18), 0);
    return {
      bloom: 0.95, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.05, ca: 0.8,
      flash, zoom: 1 + 0.004 * kick + 0.006 * db,
    };
  }

  private poseCrowd(t: number, kick: number) {
    const T = this.T, m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const G = (this.crowd.geometry.getAttribute('aG') as THREE.InstancedBufferAttribute).array as Float32Array;
    const C = (this.crowd.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute).array as Float32Array;
    const dark = 1 - this.U.uMoonK.value, ac = new THREE.Color();
    this.ghosts.forEach((g, i) => {
      const bob = 0.025 * Math.sin(t * 1.9 + g.seed * 2.3);
      p.set(g.x, g.hover + bob, g.z);
      q.setFromAxisAngle(Y, g.yaw + 0.04 * Math.sin(t * 0.5 + g.seed));
      s.setScalar(g.s);
      m.compose(p, q, s);
      this.crowd.setMatrixAt(i, m);
      // warm wave from the spot outward once the light is on
      const w0 = T.spot! - 0.25 + g.dPool * 0.075;
      const warm = g.inPool ? Math.max(prog(t, T.light!, T.light! + 0.5, ease.outCubic), prog(t, w0, w0 + 0.8, ease.outCubic)) : prog(t, w0, w0 + 0.9, ease.outCubic);
      const gain = (1 - 0.35 * dark) * (1 + 0.12 * kick) * (1 + 0.4 * warm) * (0.9 + 0.1 * noise1(t * 1.3, g.seed));
      G.set([warm * 0.85, g.seed * 0.137, gain, 0], i * 4);
      C.set([g.tint.r, g.tint.g, g.tint.b], i * 3);
      ac.copy(this.cold).lerp(g.tint, warm * 0.85);
      this.auras.setAura(i, p, 1.25 * g.s, 2.3 * g.s, ac, 0.055 * gain);
    });
    this.crowd.instanceMatrix.needsUpdate = true;
    (this.crowd.geometry.getAttribute('aG') as THREE.InstancedBufferAttribute).needsUpdate = true;
    (this.crowd.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute).needsUpdate = true;
  }

  private poseFriends(t: number, kick: number) {
    const T = this.T, U = this.U;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const BG = (this.trioBodies.geometry.getAttribute('aG') as THREE.InstancedBufferAttribute).array as Float32Array;
    const BC = (this.trioBodies.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute).array as Float32Array;
    const AG = (this.trioArms.geometry.getAttribute('aG') as THREE.InstancedBufferAttribute).array as Float32Array;
    const AC = (this.trioArms.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute).array as Float32Array;
    const contact = [T.on!, T.that!];
    const reach = [T.on! - 0.42, T.that! - 0.36];
    // hand glow: flash at the clasp, then steady, pulsing on the kicks
    const hk = contact.map((c) => (t < c ? 0 : 1 + 1.6 * pulse(t, c, 0.14) + 0.35 * kick + 0.4 * pulse(t, T.got!, 0.3)));
    const dark = 1 - U.uMoonK.value;
    U.uHand0.value.copy(this.hands[0]!);
    U.uHand1.value.copy(this.hands[1]!);
    U.uHandK.value.set(hk[0]! * (1 + 0.5 * dark), hk[1]! * (1 + 0.5 * dark));
    const warmBody = prog(t, T.got!, T.got! + 0.9, ease.outCubic) * 0.35 + prog(t, T.spot!, T.spot! + 1, ease.outCubic) * 0.4;
    const pink = col('pink'), auraC = new THREE.Color();
    let bi = 0;
    const shoulder = new THREE.Vector3(), hang = new THREE.Vector3(), tgt = new THREE.Vector3(), d = new THREE.Vector3();
    this.friends.forEach((fr, i) => {
      const k = prog(t, fr.turnT, fr.turnT + 0.62, ease.inOutCubic);
      const yaw = lerp(fr.yaw0, fr.face, k);
      const bob = 0.02 * Math.sin(t * 1.6);
      const p = fr.pos.clone().setY(0.06 + bob);
      q.setFromAxisAngle(Y, yaw);
      m.compose(p, q, one);
      this.trioBodies.setMatrixAt(i, m);
      BG.set([warmBody, 0.5 + i * 0.21, (1 - 0.25 * dark) * (1 + 0.1 * kick), 0], i * 4);
      this.auras.setAura(this.ghosts.length + i, p, 1.3, 2.3, auraC.copy(this.cold).lerp(pink, Math.min(1, 0.3 * Math.min(1, hk[0]!) + warmBody)), 0.06 + 0.04 * Math.min(1, hk[0]!));
      BC.set([pink.r, pink.g * 1.6, pink.b], i * 3);
      // arms: side -1 (local -x) and +1; linked arms reach for the clasp point
      for (const side of [-1, 1]) {
        const ai = i * 2 + (side > 0 ? 1 : 0);
        shoulder.set(0.23 * side, 1.36, 0).applyQuaternion(q).add(p);
        hang.set(Math.sin(0.12) * side, -Math.cos(0.12), 0.05).normalize().applyQuaternion(q);
        const link = side > 0 ? i : i - 1; // clasp index this arm belongs to
        let glow = 0;
        d.copy(hang);
        if (link >= 0 && link < 2) {
          const r = prog(t, reach[link]!, contact[link]!, ease.inOutCubic);
          tgt.copy(this.hands[link]!).setY(this.hands[link]!.y + bob).sub(shoulder).normalize();
          d.copy(hang).lerp(tgt, r).normalize();
          glow = hk[link]!;
        }
        q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
        m.compose(shoulder, q, one);
        this.trioArms.setMatrixAt(ai, m);
        q.setFromAxisAngle(Y, yaw);
        AG.set([warmBody, 0.9 + ai * 0.17, (1 - 0.25 * dark) * (1 + 0.1 * kick), glow * 0.8], ai * 4);
        AC.set([pink.r, pink.g * 1.6, pink.b], ai * 3);
        // beads of warm light along the linked arm, brightest at the hand
        if (glow > 0) {
          for (let b = 0; b < 6; b++) {
            const u = (b + 1) / 6;
            const x = shoulder.clone().addScaledVector(d, ARM_LEN * u * 0.97);
            this.beads.set(bi++, x.x, x.y, x.z, pink, glow * (0.35 + 1.4 * u * u) * (0.9 + 0.1 * Math.sin(t * 9 + b)), 0.6 + 0.5 * u);
          }
        }
      }
    });
    // the clasped hands: a hot core and a soft halo
    for (let c = 0; c < 2; c++) {
      if (hk[c]! <= 0) continue;
      const h = this.hands[c]!.clone();
      h.y += 0.02 * Math.sin(t * 1.6);
      this.beads.set(bi++, h.x, h.y, h.z, col('#ffd0e8'), hk[c]! * 2.2, 1.6);
      this.beads.set(bi++, h.x, h.y, h.z, pink, hk[c]! * 0.6, 7.5);
    }
    // on "got": a pulse of light travels along the whole chain
    if (t > T.got! && t < T.got! + 1.4) {
      const f0 = this.friends[0]!, f2 = this.friends[2]!;
      const chain = [
        f0.pos.clone().setY(1.36), this.hands[0]!.clone(), this.friends[1]!.pos.clone().setY(1.25), this.hands[1]!.clone(), f2.pos.clone().setY(1.36),
      ];
      const u = ease.inOutCubic(clamp((t - T.got!) / 1.1)) * (chain.length - 1);
      const a = Math.min(chain.length - 2, Math.floor(u));
      const x = chain[a]!.clone().lerp(chain[a + 1]!, u - a);
      const k = 1 - smoothstep(1.0, 1.4, t - T.got!);
      this.beads.set(bi++, x.x, x.y, x.z, col('#fff0f8'), 2.6 * k, 2.2);
      this.beads.set(bi++, x.x, x.y, x.z, pink, 0.8 * k, 9);
    }
    this.beads.commit(bi);
    this.auras.commit();
    this.trioBodies.instanceMatrix.needsUpdate = true;
    this.trioArms.instanceMatrix.needsUpdate = true;
    for (const im of [this.trioBodies, this.trioArms]) {
      (im.geometry.getAttribute('aG') as THREE.InstancedBufferAttribute).needsUpdate = true;
      (im.geometry.getAttribute('aTint') as THREE.InstancedBufferAttribute).needsUpdate = true;
    }
  }

  private poseDust(t: number) {
    const U = this.U, moonK = U.uMoonK.value, poolK = U.uPool.value.w, disco = U.uDisco.value;
    const moonC = U.uMoonCol.value, warm = col('#ffe0ef');
    const c = new THREE.Color();
    this.dust0.forEach((p0, i) => {
      const x = p0.x + noise1(t * 0.13 + i, 1) * 0.35;
      const y = p0.y + noise1(t * 0.11 + i, 2) * 0.3 + 0.06 * Math.sin(t * 0.4 + i);
      const z = p0.z + noise1(t * 0.12 + i, 3) * 0.35;
      const inMoon = moonAtJS(x, y, z) * moonK;
      const inPool = poolK > 0 ? (1 - smoothstep(POOL.r * 0.5, POOL.r * 1.1, Math.hypot(x - POOL.x, z - POOL.z))) * poolK : 0;
      const tw = 0.6 + 0.4 * Math.sin(t * (1.5 + (i % 7) * 0.3) + i);
      c.copy(moonC).multiplyScalar(0.12 + 1.6 * inMoon).lerp(warm, clamp(inPool + disco * 0.3)).multiplyScalar(1 + 1.5 * inPool + 0.4 * disco);
      this.dust.set(i, x, y, z, c, tw, 0.7 + 0.6 * hash(i, 4));
    });
    this.dust.commit();
  }
}
