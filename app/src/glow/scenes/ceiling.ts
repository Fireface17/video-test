// Intro / outro: lying in bed in the dark, looking up at a ceiling of glow-in-the-dark stickers.
// Intro: a sticker lights on every beat. Hidden among them are two figures; when the last star is lit, a
// point of light draws them as a constellation — two people, one raising a hand — and on the next downbeat
// it joins their hands. The ceiling dissolves into the night sky, we fly up into space, the same light
// writes the title, the artist's name switches on in neon, and the camera turns and dives at the night
// Earth (into the highway). One sticker comes loose on the way and falls into his raised hand (he keeps it:
// the star he carries through the video); out in the sky the constellation fills in as two people of stardust,
// him in blue and her in rose. Outro: the same ceiling, every sticker lit; they go out on the beat, the light
// joins the two hands again on "take my hand", the two last stars drift together, merge, and go out on the
// final downbeat — and in that dark a warm light comes on across the street: her lantern.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { starGeometry } from '../lib/shapes';
import { GlowPoints } from '../lib/points';
import { LightTrail } from '../lib/lightpaint';
import { displayTextGeometry, loadDisplayFont } from '../lib/fonts';
import { flickerOn } from '../lib/neon';
import { Earth } from '../lib/earth';
import { RealFigure, glowBodyMaterial, loadBody } from '../lib/people';
import { Stardust, StardustBody } from '../lib/stardust';
import { StarStreaks } from './fall-stars';
import { nebulaMap, nebulaSphere } from './fall-sky';

const CEIL = 2.6;
const EYE = new THREE.Vector3(0, 0.55, -0.1);
/** The smoke detector on the ceiling (u, v), its green LED blinking on every fourth beat. */
const DET: [number, number] = [1.62, -0.78];
/** Cars passing in the street below: their headlights throw the window's panes across the ceiling
 *  (start, seconds after the entry's start; duration; direction). */
const SWEEPS_IN: [number, number, number][] = [[3.3, 2.4, 1], [9.6, 1.9, -1]];
const SWEEPS_OUT: [number, number, number][] = [[2.6, 2.6, 1]];

/** The two figures, in ceiling coordinates (u right, v up the frame; metres). B's outer hand is raised. */
const J: Record<string, [number, number]> = {
  aHead: [-0.52, 0.74], aNeck: [-0.52, 0.52], aShL: [-0.72, 0.46], aShR: [-0.32, 0.46], aElL: [-0.86, 0.2], aHaL: [-0.92, -0.06],
  aElR: [-0.27, 0.22], aHaR: [-0.15, 0.06], aHip: [-0.52, -0.08], aKnL: [-0.66, -0.46], aFtL: [-0.72, -0.84], aKnR: [-0.4, -0.47], aFtR: [-0.36, -0.85],
  bHead: [0.52, 0.76], bNeck: [0.52, 0.54], bShL: [0.32, 0.48], bShR: [0.72, 0.48], bElL: [0.27, 0.24], bHaL: [0.15, 0.06],
  bElR: [0.86, 0.72], bHaR: [0.94, 0.98], bHip: [0.52, -0.06], bKnL: [0.4, -0.45], bFtL: [0.35, -0.83], bKnR: [0.65, -0.44], bFtR: [0.72, -0.82],
};
/** The pen's path through them (polylines; the pen jumps between them). */
const PATH = [
  ['aFtL', 'aKnL', 'aHip', 'aKnR', 'aFtR'], ['aHip', 'aNeck', 'aHead'], ['aHaL', 'aElL', 'aShL', 'aNeck', 'aShR', 'aElR', 'aHaR'],
  ['bHaL', 'bElL', 'bShL', 'bNeck', 'bShR', 'bElR', 'bHaR'], ['bHead', 'bNeck', 'bHip'], ['bFtL', 'bKnL', 'bHip', 'bKnR', 'bFtR'],
];
/** The figures' keys in the order of lib/stars STAR_JOINTS (head, neck, shoulders, elbows, hands, hip, knees, feet). */
const JOINT_KEYS = ['Head', 'Neck', 'ShL', 'ShR', 'ElL', 'ElR', 'HaL', 'HaR', 'Hip', 'KnL', 'KnR', 'FtL', 'FtR'];
/** Outro: the order the figures' stars go out (feet first, hands last). */
const FIG_OUT = ['aFtL', 'bFtR', 'aFtR', 'bFtL', 'aKnL', 'bKnR', 'aKnR', 'bKnL', 'aHip', 'bHip', 'aHaL', 'bHaR', 'aElL', 'bElR', 'aHead', 'bHead', 'aShL', 'bShR', 'aNeck', 'bNeck', 'aShR', 'bShL', 'aElR', 'bElL'];

interface Sticker { key: string; u: number; v: number; r: number; mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; halo: THREE.Mesh; hmat: THREE.ShaderMaterial; tOn: number; tOff: number; seed: number }

function plaster(): THREE.Texture {
  const n = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d')!, img = c.createImageData(n, n), rnd = mulberry32(7);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    // fine grain + soft blotches (sprayed plaster)
    const b = noise1(x * 0.02 + noise1(y * 0.02, 3) * 2, 5) * 10 + noise1(y * 0.013, 9) * 6;
    const v = 196 + b + (rnd() + rnd() + rnd() - 1.5) * 16;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = clamp(v, 0, 255);
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default class Ceiling extends Scene {
  st = new Stage(60, 0.02, 3000);
  outro = false;
  B: number[] = [];
  beats: number[] = [];
  room = new THREE.Group();
  detector = new THREE.Group();
  ledMat!: THREE.MeshBasicMaterial;
  ledHalo!: THREE.ShaderMaterial;
  ceilMat!: THREE.ShaderMaterial;
  wallMat!: THREE.MeshStandardMaterial;
  moonLight!: THREE.SpotLight;
  stickers: Sticker[] = [];
  byKey = new Map<string, Sticker>();
  /** The constellation (stickers' sky stars + trails) lives in this group so it can recede into the sky. */
  con = new THREE.Group();
  body!: LightTrail;
  join!: LightTrail;
  conStars = new GlowPoints(64, 0.05);
  pen = new GlowPoints(40, 0.06);
  sky = new THREE.Group();
  field = new GlowPoints(5000, 0.9);
  neb!: THREE.Mesh;
  streaks = new StarStreaks(1600, 0.035);
  title!: LightTrail;
  titleGrp = new THREE.Group();
  titlePen = new GlowPoints(16, 0.06);
  name = new THREE.Group();
  nameMat!: THREE.MeshBasicMaterial;
  nameGlow!: THREE.MeshBasicMaterial;
  earth = new Earth();
  earthDir = new THREE.Vector3();
  dis = -1;
  /** Intro: the constellation's two people of stardust; the hand that catches the falling sticker. */
  dust?: Stardust;
  hand?: RealFigure;
  caught?: Sticker;
  tCatch = 0;

  override async init() {
    const { audio, params, start, end } = this.ctx;
    this.outro = params.mode === 'outro';
    const S = this.st;
    S.bg.copy(col('night', 0.25));
    this.B = audio.downbeats.filter((d) => d >= start - 2 && d <= end + 2);
    this.beats = audio.beats.filter((b) => b >= start - 0.05 && b <= end + 1);

    // ---- the room: a plaster ceiling (dissolves from the middle out), walls, moonlight from a window ----
    const map = plaster();
    this.ceilMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { map: { value: map }, light: { value: col('blue', 0.03) }, dis: { value: -1 }, glow: { value: new THREE.Color(0, 0, 0) }, moonK: { value: 1 }, warm: { value: 0 }, time: { value: 0 }, sweep: { value: new THREE.Vector2(-9, 0) } },
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; uniform vec3 light, glow; uniform float dis, moonK, warm, time; uniform vec2 sweep;
        varying vec2 vUv; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
        void main() {
          vec3 a = texture2D(map, vUv * 3.0).rgb; a = pow(a, vec3(2.2));
          // moonlight through a window on the left: a soft barred patch near the wall
          vec2 m = (vP.xy - vec2(-1.55, 0.35)) / vec2(0.75, 0.55);
          float mpatch = (1.0 - smoothstep(0.55, 1.0, length(m))) * smoothstep(0.03, 0.08, abs(fract(m.x * 1.0 + 0.5) - 0.5)) * smoothstep(0.03, 0.08, abs(m.y));
          // the curtain, half drawn, breathes in the draught: its soft shadow edge drifts across the patch
          float ce = -0.42 + 0.09 * sin(time * 0.55) + 0.035 * sin(time * 1.3 + m.y * 3.0);
          mpatch *= mix(0.3, 1.0, smoothstep(ce - 0.14, ce + 0.14, m.x));
          // a car passing below: its headlights throw the window's panes across the ceiling, sheared
          vec2 sp = vP.xy - vec2(sweep.x, 0.25); sp.x -= 0.5 * sp.y;
          vec2 sq = sp / vec2(0.62, 0.46);
          float spatch = (1.0 - smoothstep(0.5, 1.0, max(abs(sq.x), abs(sq.y)))) * smoothstep(0.02, 0.07, abs(fract(sq.x + 0.5) - 0.5)) * smoothstep(0.02, 0.07, abs(sq.y));
          // a warm window light across the street (outro): the same panes, larger and softer, spilling in
          vec2 w = (vP.xy - vec2(-1.55, 0.35)) / vec2(1.35, 0.95);
          float wpatch = (1.0 - smoothstep(0.2, 1.0, length(w))) * (0.55 + 0.45 * smoothstep(0.02, 0.09, abs(fract(w.x * 1.6 + 0.5) - 0.5)) * smoothstep(0.02, 0.07, abs(w.y)));
          vec3 c = a * (light + col_moon() * mpatch * moonK + glow + vec3(0.95, 0.55, 0.22) * wpatch * warm + vec3(1.0, 0.86, 0.62) * spatch * sweep.y);
          // dissolve: burns away from the centre with a glowing edge
          vec2 q = vP.xy * 9.0; vec2 fi = floor(q), fr = fract(q); fr = fr * fr * (3.0 - 2.0 * fr);
          float vn = mix(mix(h(fi), h(fi + vec2(1.0, 0.0)), fr.x), mix(h(fi + vec2(0.0, 1.0)), h(fi + vec2(1.0, 1.0)), fr.x), fr.y);
          float r = length(vP.xy) + (vn - 0.5) * 0.16;
          if (r < dis) discard;
          float edge = exp(-pow((r - dis) / 0.05, 2.0)) * step(0.0, dis);
          c += vec3(0.7, 1.0, 0.4) * edge * 1.5;
          gl_FragColor = vec4(c, 1.0);
        }`.replace('col_moon()', 'vec3(0.05, 0.075, 0.16)'),
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), this.ceilMat);
    ceil.rotation.x = Math.PI / 2; // facing down; local (x, y) = world (x, z), the shader's ceiling coordinates
    ceil.position.y = CEIL;
    this.wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6a7290'), roughness: 0.95, transparent: true });
    const wallN = new THREE.Mesh(new THREE.PlaneGeometry(9, 3), this.wallMat);
    wallN.position.set(0, CEIL - 1.5, 1.9);
    wallN.rotation.y = Math.PI;
    const wallW = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), this.wallMat);
    wallW.rotation.y = Math.PI / 2;
    wallW.position.set(-2.4, CEIL - 1.5, 0);
    this.moonLight = new THREE.SpotLight(new THREE.Color('#5a74c8'), 0.6, 12, 0.6, 0.8, 1);
    this.moonLight.position.set(-3, 0.8, 0.4);
    this.moonLight.target.position.set(-1.2, CEIL, 0.3);
    this.room.add(ceil, wallN, wallW, this.moonLight, this.moonLight.target);
    // a smoke detector: a white puck with a vent ring and a green LED
    const plastic = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d9d7cf'), roughness: 0.55 });
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.028, 40), plastic);
    puck.position.y = -0.014;
    const vent = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.003, 6, 40), new THREE.MeshStandardMaterial({ color: new THREE.Color('#8d8b84'), roughness: 0.8 }));
    vent.rotation.x = Math.PI / 2;
    vent.position.y = -0.0285;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) }));
    led.position.set(0.022, -0.029, 0.018);
    this.ledHalo = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { k: { value: 0 }, c: { value: col('#3dff6a', 1) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float k; uniform vec3 c; varying vec2 vUv;
        void main(){ float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(c * k * (exp(-r * r * 9.0) + 0.6 * exp(-r * r * 80.0)) * (1.0 - smoothstep(0.85, 1.0, r)), 1.0); }`,
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07), this.ledHalo);
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0.022, -0.031, 0.018);
    this.ledMat = led.material;
    this.detector.add(puck, vent, led, halo);
    this.detector.position.set(DET[0], CEIL, DET[1]);
    this.room.add(this.detector);
    S.add(this.room);

    // ---- stickers: the two figures, and scattered stars around them ----
    const rnd = mulberry32(5);
    const pts: { key: string; u: number; v: number; r: number }[] = Object.entries(J).map(([key, [u, v]]) => ({ key, u, v, r: 0.075 + rnd() * 0.03 }));
    for (let tries = 0; pts.length < 50 && tries < 6000; tries++) {
      const r = 0.05 + Math.pow(rnd(), 2) * 0.09;
      const u = (rnd() * 2 - 1) * 2.1, v = (rnd() * 2 - 1) * 1.15;
      if (Math.hypot(u - DET[0], v - DET[1]) > r * 1.6 + 0.16 && pts.every((p) => Math.hypot(p.u - u, p.v - v) > (p.r + r) * 1.6 + 0.08)) pts.push({ key: `s${pts.length}`, u, v, r });
    }
    // ignition: one sticker per beat to begin with, faster as the bars go by; the figures' stars come last
    const scattered = pts.filter((p) => p.key.startsWith('s')).sort((a, b) => Math.hypot(a.u * 0.7, a.v) - Math.hypot(b.u * 0.7, b.v));
    const figure = Object.keys(J).map((k) => pts.find((p) => p.key === k)!).sort((a, b) => b.v - a.v);
    const order = [...scattered, ...figure];
    const counts: number[] = [];
    for (let b = 0; b < 32; b++) counts.push(b < 10 ? 1 : b < 22 ? (b % 2 ? 2 : 1) : 2);
    let left = order.length - counts.reduce((a, b) => a + b, 0);
    for (let b = 31; left > 0; b = b === 22 ? 31 : b - 1) { counts[b]!++; left--; }
    const onTimes: number[] = [];
    counts.forEach((c, b) => { for (let k = 0; k < c; k++) onTimes.push(this.beatT(b) + k * 0.06); });
    // outro: scattered stars out over 2 bars from bar 1, the figures over 2 bars after "take my hand"
    const outB = (k: number) => this.beatT(4 + k);
    const geo = starGeometry(0.1, 0.04);
    order.forEach((p, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#cfe8b0'), roughness: 0.5, emissive: col('phosphor'), emissiveIntensity: 0, transparent: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.set(Math.PI / 2, 0, rnd() * Math.PI * 2);
      mesh.scale.setScalar(p.r);
      mesh.position.set(p.u, CEIL - 0.012, p.v);
      const hmat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { k: { value: 0 }, c: { value: col('phosphor', 0.2) } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float k; uniform vec3 c; varying vec2 vUv;
          void main(){ float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(c * k * (exp(-r * r * 6.0) + 0.25 * exp(-r * r * 40.0)) * (1.0 - smoothstep(0.85, 1.0, r)), 1.0); }`,
      });
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hmat);
      halo.rotation.x = Math.PI / 2;
      halo.scale.setScalar(p.r * 9);
      halo.position.set(p.u, CEIL - 0.006, p.v);
      let tOff = Infinity;
      if (this.outro) {
        const si = scattered.indexOf(p), fi = FIG_OUT.indexOf(p.key);
        if (si >= 0) tOff = outB(Math.floor((si * 8) / scattered.length)) + (si % 3) * 0.05;
        else if (fi >= 0) tOff = outB(12 + Math.floor((fi * 8) / FIG_OUT.length)) + (fi % 3) * 0.05;
      }
      const s: Sticker = { key: p.key, u: p.u, v: p.v, r: p.r, mesh, mat, halo, hmat, tOn: this.outro ? -Infinity : onTimes[i]!, tOff, seed: i };
      this.stickers.push(s);
      this.byKey.set(p.key, s);
      this.room.add(mesh, halo);
    });

    // ---- the constellation: the pen's trails on the ceiling plane (u, v) ----
    const P = (k: string) => ({ x: J[k]![0], y: J[k]![1] });
    this.body = new LightTrail(PATH.map((pl) => pl.map(P)), { width: 0.011, color: col('phosphor', 1.1).lerp(col('white', 1), 0.25), tipLen: 0.3, seed: 2 });
    this.join = new LightTrail([[P('aHaR'), P('bHaL')]], { width: 0.013, color: col('gold', 1.4), tipLen: 0.2, seed: 5 });
    this.con.add(this.body, this.join, this.conStars, this.pen);
    // trails are built in XY; lay them on the ceiling (local y -> world z), facing down
    this.con.rotation.x = Math.PI / 2;
    this.con.position.y = CEIL - 0.02;
    S.add(this.con);

    // ---- sky: stars at infinity, a faint nebula, streaking dust for the flight ----
    const sr = mulberry32(17);
    for (let i = 0; i < this.field.n; i++) {
      const u = sr() * 2 - 1, a = sr() * Math.PI * 2, R = 1200;
      const band = Math.exp(-Math.pow((u - 0.25 * Math.sin(a * 2)) / 0.18, 2)); // a milky band
      const c = col('white', 0.35 + sr() * 1.3 + band * sr() * 1.5).lerp(col(sr() < 0.5 ? 'blue' : 'gold', 1), sr() * 0.2);
      this.field.set(i, Math.sqrt(1 - u * u) * Math.cos(a) * R, u * R, Math.sqrt(1 - u * u) * Math.sin(a) * R, c, 1, 0.35 + sr() * sr() * 2.2);
    }
    this.field.commit();
    this.neb = nebulaSphere(nebulaMap(512, 256, 4), 4, 1500);
    (this.neb.material as THREE.ShaderMaterial).uniforms.gain!.value = 0.5;
    this.sky.add(this.field, this.neb);
    S.add(this.sky, this.streaks);

    if (!this.outro) {
      // title, written by the light; the artist's name in neon below it
      this.title = LightTrail.text('Glowing in the Dark', 'script', 1.1, { width: 0.018, color: col('phosphor', 1.2).lerp(col('cyan', 1.2), 0.25), tipLen: 0.5, seed: 9 });
      const font = await loadDisplayFont('tiltneon');
      const g = displayTextGeometry(font, 'FIREFACE17', 0.5, { tracking: 0.08 });
      this.nameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0) });
      this.nameGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
      const n1 = new THREE.Mesh(g, this.nameMat), n2 = new THREE.Mesh(g, this.nameGlow);
      n2.scale.setScalar(1.02);
      n2.position.z = -0.01;
      this.name.add(n2, n1);
      this.name.position.y = -1.0;
      this.titleGrp.add(this.title, this.name, this.titlePen);
      S.add(this.titleGrp);
      await this.earth.init();
      S.add(this.earth);
      // dive at the lights of New York (the video's city: its avenues, its el, its taxis): that point of the
      // globe faces the camera from below, the Atlantic dark on one side
      const lat = 40.7 * Math.PI / 180, lon = -74.0 * Math.PI / 180;
      const th = Math.PI / 2 - lat, ph = lon + Math.PI;
      this.earthDir.set(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th));
      this.earth.quaternion.setFromUnitVectors(this.earthDir, new THREE.Vector3(0, 1, 0));

      const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
      // the constellation's people of stardust (in the constellation's plane: they recede with it)
      this.dust = new Stardust([new StardustBody(new RealFigure(rp, 'rpm', col('white')), 22000, 1), new StardustBody(new RealFigure(mi, 'michelle', col('white')), 22000, 2)], [2, 2, 2], { gain: 0.07 });
      this.dust.visible = false;
      this.con.add(this.dust);
      // his hand, rising into view from the bed to catch a falling sticker: he lies on his back below the
      // camera, head toward the top of the frame (+z), face up
      const hand = new RealFigure(rp, 'rpm', col('cyan', 1.0), glowBodyMaterial(col('cyan', 1.0).lerp(col('white', 1), 0.2)));
      hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
      hand.position.set(EYE.x + 0.02, EYE.y - 0.34, EYE.z - 0.62);
      hand.visible = false;
      this.hand = hand;
      S.add(hand);
      // the sticker that comes loose: a lit one low in the frame, falling on bar 6 into the open hand
      this.tCatch = this.B[6] ?? this.beatT(24);
      const cands = this.stickers.filter((x) => x.key.startsWith('s') && x.tOn < this.tCatch - 1.2 && Math.abs(x.u) < 0.7 && x.v < -0.25 && x.v > -1.0);
      this.caught = cands.sort((x, y) => y.r - x.r)[0] ?? this.stickers.find((x) => x.key.startsWith('s') && x.tOn < this.tCatch - 1.2);
    }
  }

  /**
   * Intro: a lit sticker comes loose two beats before bar 6 and falls; his hand rises into the frame from
   * below, open, palm up, catches it on the downbeat, closes round it (the light glows between the fingers)
   * and takes it down out of view.
   */
  private catchStar(t: number) {
    const s = this.caught, h = this.hand;
    if (!s || !h) return;
    const tc = this.tCatch, beat = 60 / 151;
    const t0 = tc - 2 * beat;
    // the camera (his eyes) rises a little over the first bars (see renderIntro); keep the body just below it
    const camY = EYE.y + 0.25 * ease.inOutQuad(prog(t, 0, this.B[8] ?? this.beatT(32)));
    h.position.y = camY - 0.22;
    const palm = new THREE.Vector3(EYE.x + 0.06, camY + 0.27, EYE.z - 0.08);
    const rise = ease.outCubic(prog(t, t0 - 0.9, t0 + 0.2)), down = ease.inOutCubic(prog(t, tc + 0.9, tc + 1.9));
    h.visible = t > t0 - 0.9 && t < tc + 2.0;
    if (!h.visible && t < t0) return;
    const target = palm.clone().add(new THREE.Vector3(0.08 * (1 - rise), -0.4 * (1 - rise) - 0.45 * down, -0.06 * down));
    // the catch pulls the hand down a little, like the star had weight
    target.y -= 0.025 * Math.sin(Math.PI * clamp((t - tc) / 0.35)) * (t > tc ? 1 : 0);
    h.time = t;
    if (h.visible) {
      h.reach(0, target, new THREE.Vector3(-0.6, -0.4, -0.7));
      const close = ease.inOutCubic(prog(t, tc + 0.05, tc + 0.35));
      h.setHand(0, 0.12 + 0.75 * close);
      h.setHand(1, 0.3);
    }
    if (t < t0) return;
    // the sticker: falls (gravity, a lazy spin) into the palm; in the fist only its glow shows
    const from = new THREE.Vector3(s.u, CEIL - 0.012, s.v);
    const hp = h.hand(0).add(new THREE.Vector3(0, 0.03, 0));
    const k = clamp((t - t0) / (tc - t0));
    const p = from.clone().lerp(hp, k * k).add(new THREE.Vector3(0.05 * Math.sin(k * 3.1), 0, 0.03 * Math.sin(k * 2.3)).multiplyScalar(1 - k));
    if (t >= tc) p.copy(hp);
    s.mesh.position.copy(p);
    s.mesh.rotation.set(Math.PI / 2 + k * 2.4, k * 1.3, s.seed + k * 3.0);
    s.halo.position.copy(p).add(new THREE.Vector3(0, -0.01, 0));
    const shut = prog(t, tc + 0.15, tc + 0.4);
    s.mesh.visible = shut < 1 && h.visible;
    s.halo.visible = h.visible;
    s.mat.opacity = 1;
    s.mat.emissiveIntensity = 1.1 + 2.5 * pulse(t, tc, 0.3);
    s.hmat.uniforms.k!.value = (1.1 + 3 * pulse(t, tc, 0.35)) * (1 - 0.55 * shut) * (1 - down);
    s.halo.scale.setScalar(s.r * 9 * (1 - 0.4 * shut));
  }

  /** Time of beat k of this entry (k = 0 is the entry's first beat). */
  beatT(k: number) {
    const a = this.ctx.audio, b0 = Math.ceil(a.beatAt(this.ctx.start) - 0.05);
    return a.timeOfBeat(b0 + k);
  }

  /** The room's small life: the curtain, cars' headlights sweeping the ceiling, the detector's LED. */
  private poseRoom(t: number, sweeps: [number, number, number][]) {
    const U = this.ceilMat.uniforms;
    U.time!.value = t;
    const sw = U.sweep!.value as THREE.Vector2;
    sw.set(-9, 0);
    for (const [a, d, dir] of sweeps) {
      const p = (t - this.ctx.start - a) / d;
      if (p <= 0 || p >= 1) continue;
      sw.set(dir * lerp(-3.4, 3.4, ease.inOutQuad(p)), 0.13 * Math.pow(Math.sin(Math.PI * p), 0.6));
    }
    let tb = -Infinity;
    for (let i = 0; i < this.beats.length && this.beats[i]! <= t; i++) if (i % 4 === 0) tb = this.beats[i]!;
    const blink = Math.exp(-Math.max(0, t - tb) / 0.07);
    this.ledMat.color.copy(col('#3dff6a', 0.08 + 1.6 * blink));
    this.ledHalo.uniforms.k!.value = 0.04 + 0.5 * blink;
    this.detector.visible = Math.hypot(DET[0], DET[1]) > this.dis;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    return this.outro ? this.renderOutro(f, out) : this.renderIntro(f, out);
  }

  /** Stickers: lit from tOn (flash, then the steady phosphor), out at tOff (a quick fade on the beat). */
  private poseStickers(t: number, gain: number, room: number) {
    for (const s of this.stickers) {
      const on = t >= s.tOn ? 1 : 0;
      const flash = pulse(t, s.tOn, 0.09) * 2.6 + pulse(t, s.tOn, 0.5) * 0.8;
      const off = t < s.tOff ? 1 : Math.max(0, 1 - (t - s.tOff) / 0.18) * 0.6 * Math.pow(0.5, (t - s.tOff) / 0.25);
      const breathe = 1 + 0.06 * noise1(t * 0.7, s.seed);
      const k = on * (1.1 * breathe + flash) * off * gain;
      const burnt = room * (Math.hypot(s.u, s.v) > this.dis ? 1 : 0);
      s.mat.emissiveIntensity = k * 0.9;
      s.mat.opacity = burnt;
      s.mesh.visible = s.halo.visible = burnt > 0;
      s.hmat.uniforms.k!.value = k * burnt;
    }
  }

  private setConStars(t: number, gain: number) {
    let i = 0;
    for (const s of this.stickers) {
      if (!s.key.startsWith('a') && !s.key.startsWith('b')) continue;
      this.conStars.set(i++, s.u, s.v, 0, col('phosphor', 1).lerp(col('white', 1), 0.5), (t >= s.tOn ? 1 : 0) * gain, 1.4);
    }
    this.conStars.commit(i);
  }

  private renderIntro(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, cam = S.cam;
    const B = (n: number) => this.B[n] ?? this.ctx.start + n * 1.6;
    const T8 = B(8), T9 = B(9), T10 = B(10), T11 = B(11);
    const E = this.ctx.end; // the cut into the highway (the beat before "We were", ≈ T11 + 2 beats)
    // ---- the room ----
    const dis = t < T9 ? -1 : ease.inCubic(prog(t, T9, T9 + 0.9)) * 6;
    const room = 1 - prog(t, T9 + 0.4, T9 + 1.0);
    this.room.visible = room > 0.001;
    this.ceilMat.uniforms.dis!.value = dis;
    this.dis = dis;
    this.poseRoom(t, SWEEPS_IN);
    this.ceilMat.uniforms.moonK!.value = smoothstep(0, 1.2, t);
    this.wallMat.opacity = room;
    // the stickers' own light on the plaster
    const lit = this.stickers.reduce((a, s) => a + (t >= s.tOn ? 1 : 0), 0);
    (this.ceilMat.uniforms.glow!.value as THREE.Color).copy(col('phosphor', 0.0025 * lit));
    this.poseStickers(t, 1, room);
    this.catchStar(t);

    // ---- the constellation: drawn after the last sticker, hands joined on the downbeat ----
    const draw = ease.inOutQuad(prog(t, T8 + 0.05, T9 - 0.2));
    this.body.reveal = draw * this.body.total;
    this.join.reveal = prog(t, T9 - 0.12, T9) * this.join.total;
    // (an undrawn trail would still show its glowing tip at the start of the path)
    const joinFlash = pulse(t, T9, 0.3);
    const fillK = ease.inOutCubic(prog(t, T9 + 0.05, T9 + 1.4));
    // as the stardust bodies fill in, the pen's lines go (quicker): people, not a stick drawing
    const lineK = ease.inOutQuad(prog(t, T9 + 0.1, T9 + 0.9));
    this.body.gain = (1 + 0.5 * pulse(t, T9, 0.4)) * (1 - lineK);
    this.join.gain = (1 + joinFlash * 2) * (1 - 0.7 * lineK);
    this.body.visible = this.body.reveal > 0 && lineK < 1;
    this.join.visible = this.join.reveal > 0;
    let pi = 0;
    if (draw > 0 && draw < 1) {
      const p = this.body.pointAt(this.body.reveal);
      this.pen.set(pi++, p.x, p.y, 0.002, col('white', 2.5), 1, 2.2);
      for (let k = 1; k < 10; k++) { // a short comet tail of sparks
        const q = this.body.pointAt(this.body.reveal - k * 0.035);
        this.pen.set(pi++, q.x + noise1(t * 9 + k, 3) * 0.01, q.y + noise1(t * 9 + k, 4) * 0.01, 0.002, col('phosphor', 1.6), (1 - k / 10) * 0.8, 0.8);
      }
    }
    if (joinFlash > 0.01) { const m = this.join.pointAt(this.join.total / 2); this.pen.set(pi++, m.x, m.y, 0.002, col('gold', 3), joinFlash, 6); }
    this.pen.commit(pi);
    // after the dissolve the stickers live on as stars of the constellation, which recedes into the sky —
    // and fills in as two people of stardust (him blue, her rose); the pen's lines fade out
    this.setConStars(t, prog(t, T9 + 0.2, T9 + 0.9));
    const fill = fillK;
    if (this.dust) {
      const D = this.dust;
      D.visible = fill > 0;
      if (fill > 0) {
        D.time = t * 3;
        D.begin(cam);
        const sway = (k: number) => new THREE.Vector3(0.012 * Math.sin(t * 1.3 + k), 0.01 * Math.sin(t * 1.1 + k * 2), 0);
        const pts = (p: string) => JOINT_KEYS.map((k, i) => new THREE.Vector3(J[p + k]![0], J[p + k]![1], 0).add(sway(i * 0.7 + (p === 'b' ? 3 : 0)).multiplyScalar(i === 0 || i >= 4 ? 1 : 0.3)));
        D.figure(pts('a'), 0, col('cyan', 1.5).lerp(col('white', 1.5), 0.35), 1, { color2: col('blue', 1.1), draw: fill, seed: 1 });
        D.figure(pts('b'), 1, col('pink', 1.4).lerp(col('gold', 1.4), 0.25).lerp(col('white', 1.4), 0.2), 1, { color2: col('violet', 1.0), draw: fill, seed: 2 });
        D.end();
      }
    }

    // ---- camera: in bed, looking up; lift-off at T9, the title, then turn and dive at the Earth ----
    const vUp = (x: number) => (x < T9 ? 0 : 55 * ease.inCubic(prog(x, T9, T9 + 1.6)) * (1 - prog(x, E - 1.15, E - 0.6)));
    // integrate the climb (a cheap closed form: the speed ramps, then fades)
    let climb = 0;
    for (let x = T9; x < Math.min(t, E - 0.55); x += 1 / 120) climb += vUp(x) / 120;
    const pos = EYE.clone().add(new THREE.Vector3(0, 0.25 * ease.inOutQuad(prog(t, 0, T8)) + 0.15 * ease.inOutCubic(prog(t, T8, T9)), 0));
    pos.y += climb;
    pos.x += noise1(t * 0.3, 1) * 0.03;
    pos.z += noise1(t * 0.27, 2) * 0.03;
    // look up (screen up = +z); at T11 the view swings over (through +z) to look straight down
    const turn = ease.inOutCubic(prog(t, E - 1.0, E - 0.42)) * Math.PI;
    const dir = new THREE.Vector3(0, Math.cos(turn), Math.sin(turn));
    const upv = new THREE.Vector3(0, -Math.sin(turn), Math.cos(turn));
    const roll = 0.06 * Math.sin(t * 0.25) * (1 - prog(t, T9, T10)) + 0.08 * ease.inOutCubic(prog(t, T9 + 0.3, T10 + 0.5)) * (1 - prog(t, E - 1.2, E - 0.5));
    // the dive: from T11 + 0.85 the camera falls at the Earth, faster and faster
    const R = this.earth.radius, A0 = 3.2;
    const dive = prog(t, E - 0.62, E + 0.26);
    const alt = A0 * Math.exp(-3.0 * ease.inQuad(dive));
    const posPitch = EYE.clone().setY(EYE.y + climb);
    this.earth.position.copy(posPitch).add(new THREE.Vector3(0, -R - A0, 0));
    if (turn > 0) pos.y = posPitch.y - (A0 - alt);
    aim(cam, pos, pos.clone().add(dir), roll, upv);
    cam.fov = 60 + 18 * ease.inCubic(prog(t, T9, T9 + 1.2)) * (1 - prog(t, T10, T11)) + 12 * dive;
    cam.updateProjectionMatrix();

    // ---- sky ----
    const space = prog(t, T9 - 0.1, T9 + 0.8);
    this.sky.visible = space > 0;
    this.sky.position.copy(cam.position);
    this.field.material.uniforms.size!.value = 0.9;
    (this.neb.material as THREE.ShaderMaterial).uniforms.gain!.value = 0.45 * space;
    // the constellation recedes: its distance grows while its angular size shrinks slowly
    if (t > T9) {
      const k = prog(t, T9, T11);
      const D0 = CEIL - 0.02 - EYE.y - 0.4, D = D0 * Math.exp(4.5 * ease.inQuad(k));
      this.con.position.set(0, cam.position.y + D, D * Math.tan(0.2 * ease.inOutCubic(prog(t, T9 + 0.2, T10))));
      this.con.scale.setScalar((D / D0) * (1 - 0.5 * k));
    } else {
      this.con.position.set(0, CEIL - 0.02, 0);
      this.con.scale.setScalar(1);
    }
    // flight streaks: dust in a column around the climb, wrapped around the camera
    const v = vUp(t), sr = mulberry32(99);
    const showStreaks = t > T9 && t < E - 0.55;
    for (let i = 0; i < this.streaks.n; i++) {
      const x = (sr() - 0.5) * 60, z = (sr() - 0.5) * 60, y0 = sr() * 240, c = sr();
      if (!showStreaks || Math.hypot(x, z) < 1.2) { this.streaks.hide(i); sr(); continue; }
      const y = cam.position.y - 60 + ((((y0 - climb) % 240) + 240) % 240);
      this.streaks.set(i, x, y, z, col(c < 0.15 ? 'gold' : c < 0.3 ? 'cyan' : 'white', 0.6 + sr() * 1.2), 1, 1);
    }
    // (no motion means no streak direction: hide them rather than feed the shader a zero vector)
    this.streaks.visible = showStreaks && v > 0.5;
    this.streaks.setMotion(new THREE.Vector3(0, -Math.max(v, 0.5), 0), 1 / 30);
    this.streaks.commit();

    // ---- title: written by the light above us while we climb; the name switches on below ----
    const tw0 = T9 + 0.55, tw1 = T10 + 0.45;
    const tk = prog(t, tw0, tw1);
    this.titleGrp.visible = t > tw0 - 0.1 && turn < Math.PI * 0.75;
    const ahead = 7.5 - 1.5 * ease.outCubic(prog(t, tw0, E - 0.8));
    this.titleGrp.position.copy(cam.position).add(new THREE.Vector3(0, ahead, -ahead * 0.1));
    this.titleGrp.rotation.set(Math.PI / 2, 0, 0);
    this.titleGrp.scale.setScalar(1 + 0.08 * prog(t, tw0, E - 0.6));
    this.title.reveal = ease.inOutQuad(tk) * this.title.total;
    this.title.gain = 1 + 0.6 * pulse(t, tw1, 0.4);
    const nameOn = flickerOn(t, this.beatT(41), 4);
    this.nameMat.color.copy(col('white', 2.4).lerp(col('pink', 2.4), 0.3)).multiplyScalar(nameOn);
    this.nameGlow.color.copy(col('pink', 0.7)).multiplyScalar(nameOn);
    // the title's pen
    let tp = 0;
    if (tk > 0 && tk < 1) {
      const p = this.title.pointAt(this.title.reveal);
      this.titlePen.set(tp++, p.x, p.y, 0.01, col('white', 2.5), 1, 2.6);
      for (let k = 1; k < 12; k++) {
        const q = this.title.pointAt(this.title.reveal - k * 0.06);
        this.titlePen.set(tp++, q.x + noise1(t * 7 + k, 5) * 0.02, q.y + noise1(t * 7 + k, 6) * 0.02, 0.01, col('cyan', 1.5), (1 - k / 12) * 0.7, 1);
      }
    }
    this.titlePen.commit(tp);

    // ---- the Earth below ----
    this.earth.visible = turn > 0.3;
    this.earth.time = t;
    this.earth.wake(new THREE.Vector3(0, 1, 0).applyQuaternion(this.earth.quaternion.clone().invert()), 4);

    S.render(this.ctx.renderer, out);
    const hit = pulse(t, T9, 0.25);
    return {
      bloom: 0.95 + 0.4 * hit, bloomThreshold: 0.75, bloomRadius: 0.85, halation: 0.14, vignette: 0.5, grain: 0.05, ca: 0.6 + 2 * dive,
      exposure: smoothstep(0, 0.5, t) * 1,
    };
  }

  private renderOutro(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, cam = S.cam;
    const lines = this.ctx.lyrics.linesIn(this.ctx.start - 1, this.ctx.end);
    const hand = lines.find((l) => /take my hand/i.test(l.text));
    const tHand = hand ? hand.words[0]!.start : this.beatT(14);
    const tEnd = this.B.filter((d) => d <= this.ctx.end - 0.3).pop() ?? this.ctx.end - 1.5; // the last downbeat
    // the stickers go out on the beat; the two hands stay
    this.poseStickers(t, 1, 1);
    const ha = this.byKey.get('aHaR')!, hb = this.byKey.get('bHaL')!;
    // the hands: they drift together after the figures are gone, merge, and go out on the last downbeat
    const meet = ease.inOutCubic(prog(t, this.beatT(22), tEnd - 0.8));
    const mid = new THREE.Vector2((J.aHaR![0] + J.bHaL![0]) / 2, (J.aHaR![1] + J.bHaL![1]) / 2);
    for (const [s, k] of [[ha, J.aHaR!], [hb, J.bHaL!]] as const) {
      s.u = lerp(k[0], mid.x, meet);
      s.v = lerp(k[1], mid.y, meet);
      s.mesh.position.set(s.u, CEIL - 0.012, s.v);
      s.halo.position.set(s.u, CEIL - 0.006, s.v);
      const flare = 1 + 1.2 * pulse(t, tHand, 0.6) + 0.5 * smoothstep(tHand, tHand + 0.4, t) * (1 - meet);
      const last = t < tEnd ? 1 : Math.pow(0.5, (t - tEnd) / 0.12);
      const chop = this.ctx.audio.hit('vocal', t, 0.2) * smoothstep(this.beatT(22), this.beatT(26), t);
      s.mat.emissiveIntensity = (1.0 + 0.4 * chop) * flare * last * (1 + 0.6 * meet);
      s.hmat.uniforms.k!.value = (1.0 + 0.6 * chop) * flare * last * (1 + 0.8 * meet);
      s.mesh.scale.setScalar(s.r * (1 - 0.35 * meet));
    }
    // the figures' lines fade with their stars; the hands' line draws on "take my hand" and fades as they meet
    const figGone = prog(t, this.beatT(12), this.beatT(20));
    this.body.reveal = this.body.total;
    this.body.gain = 0.55 * (1 - figGone);
    this.join.reveal = prog(t, tHand, tHand + 0.7) * this.join.total;
    this.join.gain = (1.2 + 1.5 * pulse(t, tHand + 0.7, 0.4)) * (1 - prog(t, this.beatT(22), this.beatT(26)));
    this.pen.commit(0);
    this.setConStars(t, 0);
    this.sky.visible = false;
    this.streaks.visible = false;
    this.ceilMat.uniforms.dis!.value = -1;
    this.dis = -1;
    this.poseRoom(t, SWEEPS_OUT);
    this.ceilMat.uniforms.moonK!.value = 1 - prog(t, tEnd - 1, tEnd + 0.5);
    // ...and in the dark, a warm light comes on across the street: her lantern
    this.ceilMat.uniforms.warm!.value = 0.75 * flickerOn(t, tEnd + 0.12, 3) * (1 + 0.06 * noise1(t * 3, 7));
    const lit = this.stickers.reduce((a, s) => a + (t < s.tOff ? 1 : 0), 0);
    (this.ceilMat.uniforms.glow!.value as THREE.Color).copy(col('phosphor', 0.0025 * lit));
    // camera: in bed, looking up, drifting slowly in toward the hands
    const k = ease.inOutQuad(prog(t, this.ctx.start, tEnd));
    const pos = EYE.clone().add(new THREE.Vector3(mid.x * 0.6 * k, 0.15 + 0.85 * k, mid.y * 0.6 * k));
    pos.x += noise1(t * 0.3, 1) * 0.03;
    pos.z += noise1(t * 0.27, 2) * 0.03;
    aim(cam, pos, pos.clone().add(new THREE.Vector3(0, 1, 0)), 0.05 * Math.sin(t * 0.2), new THREE.Vector3(0, 0, 1));
    cam.fov = 60 - 8 * k;
    cam.updateProjectionMatrix();
    S.render(this.ctx.renderer, out);
    return { bloom: 0.95, bloomThreshold: 0.75, bloomRadius: 0.85, halation: 0.14, vignette: 0.5, grain: 0.05, ca: 0.5 };
  }
}
