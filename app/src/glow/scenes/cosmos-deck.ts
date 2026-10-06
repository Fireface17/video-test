// DROP 3 (gold, the finale): one continuous flight through the cosmos. The painted plates of cosmos-plates.ts
// (black hole, spiral galaxy, pillars, pulsar, binary, ringed planet, cluster, cosmic web, remnant, gas ribbon,
// eclipse, the "eye", the star nebula) stand in space along our path as huge billboards with soft edges, the dark
// ones (the black hole's shadow, the planet, the moon of the eclipse, the pillars' dust) blocking what lies behind
// them; we fly at them, through them (the galaxy's core, the web, the remnant's shell, the eye's ring, the star
// nebula) and past them (the planet below us, the pulsar's jets beside us), in streaking stars and drifting dust.
// The beat drives the flight: the camera passes an object every third beat while the chops are sung, every second
// beat from bar 9, every beat in the roll; each kick surges the speed (a time warp that pushes ahead and settles,
// never back), lifts the exposure and widens the lens; two downbeats are hyperjumps (a flash, a radial streak, a
// leap ahead). The flight ends with the Earth ahead of us: the ending (cosmos-ending.ts) takes the fall from there.
//
// The chop lines stay on screen, rock steady, in the lower third: each syllable lights on its own onset (vertical
// slam only: syllables touch, they never overlap) with a soft darkness cut out behind the words.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides } from '../../engine/scene';
import { FSPass, Layer2D, W, H, makeRT } from '../../engine/gl';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, mulberry32, smoothstep, frameIdx } from '../../engine/util';
import { PlateDeck, PLATE } from './cosmos-plates';
import { loadPhosphorFont, PHOS_FONT } from '../lib/phosphor';
import { StarStreaks } from './fall-stars';
import { GlowPoints } from '../lib/points';
import { Earth } from '../lib/earth';
import { aim } from '../lib/stage';
import { col } from '../lib/palette';
import { EARTH_END } from './cosmos-ending';

const AS = 16 / 9;
/** world units between two passes */
const SP = 60;

type Mode = 'through' | 'left' | 'right' | 'up' | 'down';
interface Obj { t: number; plate: number; mode: Mode; h: number; crop: [number, number, number]; rot: number; gain: number; L: number; x: number; y: number; mesh?: THREE.Mesh; mat?: THREE.ShaderMaterial }
interface Piece { text: string; x: number; t: number; tAll: number[] }
interface TLine { line: Line; rows: { pieces: Piece[]; y: number; size: number }[]; t0: number; t1: number }

const SPRITE_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SPRITE_FRAG = /* glsl */ `
uniform sampler2D map; uniform vec3 crop; uniform float k, rot;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;                       // -1..1 over the sprite
  vec2 qr = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * vec2(q.x * ${AS.toFixed(4)}, q.y);
  vec2 uv = crop.xy + vec2(qr.x / ${AS.toFixed(4)}, qr.y) * 0.5 / crop.z;
  vec4 s = texture2D(map, uv);
  float m = 1.0 - smoothstep(0.42, 0.97, length(q));
  m *= smoothstep(0.0, 0.05, min(uv.x, 1.0 - uv.x)) * smoothstep(0.0, 0.08, min(uv.y, 1.0 - uv.y));
  gl_FragColor = vec4(s.rgb * m * k, s.a * m * min(k, 1.0));
}`;

const COMP = /* glsl */ `
uniform sampler2D P, TL, TD;
uniform float expo, blur, textK, darkK, warp, wT;
const float ASP = ${AS.toFixed(6)};
vec3 at(vec2 s) { return texture(P, vec2(s.x / (2.0 * ASP) + 0.5, s.y * 0.5 + 0.5)).rgb; }
void main() {
  vec2 s = (vUv - 0.5) * vec2(2.0 * ASP, 2.0);
  vec3 col = vec3(0.0);
  if (blur > 0.002) {
    float j = hash12(gl_FragCoord.xy);
    for (int i = 0; i < 10; i++) col += at(s * (1.0 - blur * (float(i) + j) / 10.0));
    col /= 10.0;
  } else col = at(s);
  col *= expo;
  if (warp > 0.002) {
    float rr = length(s), aa = atan(s.y, s.x);
    float N = 240.0, u = (aa / 6.2831853 + 0.5) * N, cell = floor(u), fc = fract(u) - 0.5;
    if (hash11(cell + 11.0) > 0.45) {
      float sp = 0.7 + 1.6 * hash11(cell + 3.1);
      float head = fract(hash11(cell * 1.7) + wT * sp * 0.55) * 2.6;
      float len = 0.06 + 0.45 * warp * head;
      float ad = abs(fc - (hash11(cell + 7.0) - 0.5) * 0.5) * 6.2831853 / N * rr;
      float st = smoothstep(head - len, head, rr) * step(rr, head) * exp(-ad * ad / (0.0016 * 0.0016));
      col += vec3(1.0, 0.82, 0.55) * st * warp * 1.6 * smoothstep(0.15, 0.5, rr) * (0.4 + 0.6 * hash11(cell + 5.0));
    }
  }
  float m = clamp(texture(TD, vUv).r * 1.3, 0.0, 1.0) * darkK;
  col = col / (1.0 + col * 3.0 * m);
  col *= 1.0 - 0.9 * m;
  col += texture(TL, vUv).rgb * textK;
  fragColor = vec4(col, 1.0);
}`;

export default class CosmosDeck extends Scene {
  deck!: PlateDeck;
  comp!: FSPass;
  rt = makeRT(W, H);
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(62, W / H, 0.1, 4000);
  streaks = new StarStreaks(2600, 0.05, { maxPx: 3 });
  dust = new GlowPoints(160, 1);
  earth = new Earth();
  TL = new Layer2D();
  TD = new Layer2D(W / 2, H / 2, 1);
  objs: Obj[] = [];
  lines: TLine[] = [];
  keys: [number, number][] = [];   // (time, path length) of the passes
  jumps: number[] = [];
  surges: [number, number][] = [];
  starSeed: number[] = [];
  tEnd = 0;

  override async init() {
    const { audio: au, lyrics, start, end, renderer } = this.ctx;
    await loadPhosphorFont();
    await this.earth.init();
    this.deck = new PlateDeck(renderer);
    this.tEnd = end;
    this.comp = new FSPass(COMP, {
      P: { value: this.rt.texture }, TL: { value: this.TL.texture }, TD: { value: this.TD.texture },
      expo: { value: 1 }, blur: { value: 0 }, textK: { value: 1 }, darkK: { value: 0 }, warp: { value: 0 }, wT: { value: 0 },
    });
    this.buildText();

    // ---- the journey: one pass every third beat while the chops are sung, every second beat from bar 9, every beat
    // in the roll; two hyperjumps (bar 9, the roll)
    const beats = au.beats.filter((b) => b > start - 0.01 && b < end + 0.5);
    const near = (x: number) => beats.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a), beats[0]!);
    const tJ1 = near(start + 14.2), tJ2 = near(end - 1.6);
    this.jumps = [tJ1, tJ2];
    const passT: number[] = [];
    for (let i = 3; ; i += 3) { const b = beats[i]; if (!b || b > tJ1 - 0.6) break; passT.push(b); }
    const i1 = beats.indexOf(tJ1);
    for (let i = i1 + 2; beats[i]! < tJ2 - 0.5; i += 2) passT.push(beats[i]!);
    const i2 = beats.indexOf(tJ2);
    passT.push(beats[i2 + 1]!, beats[i2 + 2]!);
    // what we pass, how, how big; the black hole on "dark", the star nebula on the "Glo-"s
    const P = PLATE;
    const plan: [number, Mode, number, [number, number, number], number][] = [
      [P.SPIRAL, 'through', 46, [0.5, 0.5, 1.0], 0], [P.CLUSTER, 'right', 20, [0.52, 0.5, 1.0], 0.3], [P.PULSAR, 'left', 18, [0.5, 0.5, 1.2], 0],
      [P.WEB, 'through', 34, [0.5, 0.5, 1.0], 0.5], [P.PLANET, 'down', 24, [0.5, 0.5, 1.0], 0], [P.STARNEB, 'through', 22, [0.5, 0.5, 1.0], 0],
      [P.REMNANT, 'through', 24, [0.5, 0.5, 1.0], 0.4], [P.AURORA, 'up', 26, [0.5, 0.5, 1.0], 0], [P.EYE, 'through', 22, [0.5, 0.5, 1.0], 0.6],
      [P.BLACKHOLE, 'left', 22, [0.5, 0.5, 1.0], 0.1], [P.BINARY, 'right', 22, [0.5, 0.5, 1.0], 0],
      // from bar 9
      [P.PILLARS, 'down', 30, [0.5, 0.5, 1.0], 0], [P.ECLIPSE, 'right', 20, [0.5, 0.5, 1.0], 0], [P.SPIRAL, 'left', 26, [0.5, 0.5, 1.2], 2.2],
      [P.CLUSTER, 'through', 22, [0.52, 0.5, 1.6], 1.0], [P.PULSAR, 'right', 18, [0.5, 0.5, 1.0], 1.5], [P.STARNEB, 'through', 20, [0.5, 0.5, 1.0], 0.3],
      [P.WEB, 'through', 30, [0.35, 0.6, 1.4], 2.0], [P.REMNANT, 'left', 20, [0.5, 0.5, 1.0], 1.0], [P.EYE, 'through', 20, [0.5, 0.5, 1.3], 2.5],
      [P.PLANET, 'left', 22, [0.5, 0.5, 1.0], 0.2], [P.BLACKHOLE, 'right', 20, [0.5, 0.5, 1.2], -0.15],
      // the roll
      [P.AURORA, 'through', 24, [0.5, 0.5, 1.0], 0], [P.BINARY, 'left', 18, [0.5, 0.5, 1.2], 0.2],
    ];
    // pin the star nebula / the black hole to the words: the pass nearest each "Glo-" / "dark" gets that plate
    const chopL = lyrics.linesIn(start, end).filter((l) => l.kind === 'chop' && l.start < end - 0.5);
    const want = new Map<number, number>();
    const nearestPass = (tw: number) => passT.reduce((a, b, i) => (Math.abs(b - tw) < Math.abs(passT[a]! - tw) ? i : a), 0);
    for (const l of chopL) if (/^glo/i.test(l.words[0]?.w ?? '')) { const j = nearestPass((l.words[0]!.syl?.[1]?.[0] ?? l.start) + 0.1); if (!want.has(j)) want.set(j, P.STARNEB); }
    const dk = chopL.flatMap((l) => l.words).find((w) => /^dark/i.test(w.w));
    if (dk) want.set(nearestPass(dk.start), P.BLACKHOLE);
    for (const [j, plate] of want) {
      if (j >= plan.length || plan[j]![0] === plate) continue;
      // take the nearest entry of that plate and swap it in
      let k = -1;
      for (let d = 1; d < plan.length && k < 0; d++) for (const c of [j + d, j - d]) if (c >= 0 && c < plan.length && plan[c]![0] === plate && !want.has(c)) { k = c; break; }
      if (k >= 0) { const tmp = plan[j]!; plan[j] = plan[k]!; plan[k] = tmp; }
    }
    let L = SP * 1.4;
    this.keys = [[start - 0.6, 0]];
    passT.forEach((t, i) => {
      if (this.jumps.some((j) => j < t && j > (passT[i - 1] ?? start))) { this.keys.push([this.jumps.find((j) => j < t)! - 0.001, L - SP * 0.4]); L += SP * 3; this.keys.push([this.jumps.find((j) => j < t)! + 0.12, L - SP * 0.7]); }
      const p = plan[i % plan.length]!;
      const [plate, mode, h, crop, rot] = p;
      const off = mode === 'through' ? [0, 0] : mode === 'left' ? [-h * 1.05, 0] : mode === 'right' ? [h * 1.05, 0] : mode === 'up' ? [0, h * 0.75] : [0, -h * 0.75];
      this.objs.push({ t, plate, mode, h, crop, rot, gain: 1, L, x: off[0]!, y: off[1]!, });
      this.keys.push([t, L]);
      L += SP * (t < tJ1 ? 1.0 : 1.15);
    });
    this.keys.push([end + 1.5, L + SP * 1.5]);
    // kicks surge the flight
    this.surges = au.events('kick', start, end).filter(([, s]) => s >= 0.85).map(([t, s]) => [t, s]);

    // ---- the objects
    for (const o of this.objs) {
      const tex = this.deck.get(o.plate);
      const mat = new THREE.ShaderMaterial({
        vertexShader: SPRITE_VERT, fragmentShader: SPRITE_FRAG, transparent: true, depthWrite: false, depthTest: false,
        blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
        uniforms: { map: { value: tex }, crop: { value: new THREE.Vector3(...o.crop) }, k: { value: 1 }, rot: { value: o.rot } },
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * AS * o.h, 2 * o.h), mat);
      mesh.frustumCulled = false;
      o.mesh = mesh; o.mat = mat;
      this.scene.add(mesh);
    }
    const r = mulberry32(5);
    for (let i = 0; i < this.streaks.n; i++) this.starSeed.push(r(), r(), r(), r());
    this.streaks.renderOrder = -2;
    this.dust.renderOrder = -1;
    this.scene.add(this.streaks, this.dust, this.earth);
    this.earth.visible = false;
  }

  private buildText() {
    const { lyrics, audio, start, end } = this.ctx;
    const chops = lyrics.linesIn(start - 0.1, end).filter((l) => l.start >= start - 0.2 && l.start < end - 0.5 && l.kind === 'chop');
    const mc = document.createElement('canvas').getContext('2d')!;
    const meas = (s: string, size: number) => { mc.font = `${size}px "${PHOS_FONT}"`; return mc.measureText(s).width; };
    const onsets = (audio.onsets.chop ?? []).map(([t]) => t);
    chops.forEach((l, li) => {
      const [w0, ...rest] = l.words;
      if (!w0) return;
      // the first word in its syllables (split at the hyphens; each piece lights on its own onset)
      const parts = w0.w.split(/(?=-)/);
      const syl = (w0 as { syl?: [number, number][] }).syl?.map((s) => s[0]) ?? onsets.filter((o) => o >= w0.start - 0.03 && o < w0.end - 0.02);
      const s1 = rest.length ? 196 : 210, s2 = 118;
      const pieces1: Piece[] = [];
      let x = -meas(parts.join(''), s1) / 2;
      parts.forEach((txt, k) => {
        const t = syl[k] ?? lerp(w0.start, w0.end, k / parts.length);
        // syllables beyond the pieces re-strike the last piece
        const extra = k === parts.length - 1 ? syl.slice(parts.length) : [];
        pieces1.push({ text: txt, x, t, tAll: [t, ...extra] });
        x += meas(txt, s1);
      });
      const r2 = rest.map((w) => w.w);
      const gap = meas(' ', s2);
      const tot = r2.reduce((a, s) => a + meas(s, s2), 0) + gap * Math.max(0, r2.length - 1);
      let x2 = -tot / 2;
      const pieces2 = rest.map((w, k) => { const p = { text: r2[k]!, x: x2, t: w.start, tAll: [w.start] }; x2 += meas(r2[k]!, s2) + gap; return p; });
      const next = chops[li + 1];
      const rows = [{ pieces: pieces1, y: rest.length ? 858 : 930, size: s1 }];
      if (pieces2.length) rows.push({ pieces: pieces2, y: 1000, size: s2 });
      this.lines.push({ line: l, rows, t0: w0.start - 0.04, t1: Math.min(l.end + 1.0, next ? next.start - 0.3 : 1e9) });
    });
  }

  private drawText(t: number) {
    const L = this.TL.ctx, D = this.TD.ctx;
    this.TL.clear('#000');
    this.TD.clear('#000');
    let any = false;
    for (const tl of this.lines) {
      if (t < tl.t0 || t > tl.t1 + 0.35) continue;
      const out = 1 - smoothstep(tl.t1, tl.t1 + 0.35, t);
      any = true;
      D.save();
      D.globalAlpha = out * smoothstep(tl.t0, tl.t0 + 0.08, t);
      D.fillStyle = '#fff';
      D.filter = 'blur(40px)';
      D.globalAlpha *= 0.5;
      const yc = tl.rows.reduce((a, r) => a + r.y, 0) / tl.rows.length / 2 - 30;
      D.beginPath(); D.ellipse(W / 4, yc, 520, 150, 0, 0, Math.PI * 2); D.fill();
      D.globalAlpha /= 0.5;
      D.filter = 'blur(14px)';
      D.lineWidth = 16; D.strokeStyle = '#fff'; D.lineJoin = 'round';
      for (const row of tl.rows) {
        D.font = `${row.size / 2}px "${PHOS_FONT}"`;
        for (const p of row.pieces) if (t >= p.t - 0.02) { D.strokeText(p.text, (W / 2 + p.x) / 2, row.y / 2); D.fillText(p.text, (W / 2 + p.x) / 2, row.y / 2); }
      }
      D.filter = 'none';
      D.restore();
      for (const row of tl.rows) for (const p of row.pieces) {
        if (t < p.t - 0.02) continue;
        const last = p.tAll.filter((x) => x <= t + 0.02).pop() ?? p.t;
        const age = t - last;
        const a = clamp((t - p.t) / 0.03 + 1) * out;
        const slam = 1 + 0.3 * Math.pow(1 - clamp(age / 0.14), 3);
        const hot = Math.exp(-Math.max(age, 0) / 0.22);
        L.save();
        L.font = `${row.size}px "${PHOS_FONT}"`;
        L.textBaseline = 'alphabetic';
        const wdt = L.measureText(p.text).width;
        const cx = W / 2 + p.x + wdt / 2, cy = row.y - row.size * 0.33;
        L.translate(cx, cy); L.scale(1, slam); L.translate(-cx, -cy);   // (vertical only: pieces touch, they must never overlap)
        L.globalAlpha = a;
        L.shadowColor = 'rgba(255,170,50,0.9)';
        L.shadowBlur = 28 + 30 * hot;
        L.fillStyle = `rgb(255,${Math.round(lerp(200, 250, hot))},${Math.round(lerp(110, 230, hot))})`;
        L.fillText(p.text, W / 2 + p.x, row.y);
        L.restore();
      }
    }
    this.TL.upload(); this.TD.upload();
    return any;
  }

  /** the path length at t: through the passes (monotone cubic), warped ahead by the kicks */
  private pathL(t: number) {
    let tw = t;
    for (const [tk, s] of this.surges) if (t > tk && t - tk < 2) { const x = t - tk; tw += 0.07 * s * (Math.exp(-x / 0.45) - Math.exp(-x / 0.05)); }
    const K = this.keys;
    if (tw <= K[0]![0]) return K[0]![1];
    for (let i = 1; i < K.length; i++) if (tw <= K[i]![0]) {
      const [t0, l0] = K[i - 1]!, [t1, l1] = K[i]!;
      const u = (tw - t0) / Math.max(1e-4, t1 - t0);
      // a gentle ease between passes so we slow a touch by each object and speed up between them
      const e = u + 0.12 * Math.sin(2 * Math.PI * u) / (2 * Math.PI) * 0;
      return lerp(l0, l1, e);
    }
    return K[K.length - 1]![1];
  }
  private sway(L: number): [number, number] { return [3.0 * Math.sin(L * 0.009), 1.8 * Math.sin(L * 0.0063 + 1.0)]; }

  render(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t, cam = this.cam;
    const L = this.pathL(t), L2 = this.pathL(t + 0.02);
    const v = (L2 - L) / 0.02;
    const [sx, sy] = this.sway(L);
    const pos = new THREE.Vector3(sx, sy, -L);
    const [ax, ay] = this.sway(L + 40);
    const kick = f.a.kick;
    const roll = 0.12 * Math.sin(L * 0.004) + 0.05 * Math.sin(t * 0.7);
    aim(cam, pos, new THREE.Vector3(ax, ay, -L - 40), roll);
    // jumps: a leap, a flash, a radial streak
    let jump = 0;
    for (const j of this.jumps) if (t >= j) jump = Math.max(jump, Math.exp(-(t - j) / 0.12));
    const eonF = smoothstep(this.tEnd - 1.6, this.tEnd - 0.4, t);
    cam.fov = 62 + (6 * kick + 14 * jump + clamp((v - 50) / 200, 0, 1) * 10) * (1 - eonF);
    cam.updateProjectionMatrix();

    // the objects: billboards facing us; fade in from far, out as we go through them (or as they pass)
    for (const o of this.objs) {
      const d = o.L - L;
      const m = o.mesh!, mat = o.mat!;
      const vis = d > -o.h * 0.6 && d < 260;
      m.visible = vis;
      if (!vis) continue;
      const [ox, oy] = this.sway(o.L);
      m.position.set(ox + o.x, oy + o.y, -o.L);
      m.quaternion.copy(cam.quaternion);
      const fin = smoothstep(260, 170, d);
      const fout = o.mode === 'through' ? smoothstep(o.h * 0.08, o.h * 0.75, d) : smoothstep(-o.h * 0.5, o.h * 0.4, d);
      mat.uniforms.k!.value = fin * fout * o.gain * (1 + 0.25 * kick);
    }
    // stars in a tube round the path, recycled ahead of us
    const S = this.streaks, span = 520;
    for (let i = 0; i < S.n; i++) {
      const a = this.starSeed[i * 4]!, b = this.starSeed[i * 4 + 1]!, c = this.starSeed[i * 4 + 2]!, e = this.starSeed[i * 4 + 3]!;
      const zr = ((a * span - L) % span + span) % span;   // distance ahead, 0..span
      const z = -L - (span - zr) + 30;
      const ang = b * Math.PI * 2, rad = 4 + Math.pow(c, 0.7) * 90;
      const [px, py] = this.sway(-z);
      const tint = e < 0.12 ? col('gold', 1) : e < 0.2 ? col('cyan', 1) : col('white', 1);
      S.set(i, px + Math.cos(ang) * rad, py + Math.sin(ang) * rad * 0.7, z, tint, 0.6 + 1.8 * e * e, 0.8 + 1.4 * e);
    }
    S.setMotion(new THREE.Vector3(0, 0, Math.max(v, 1)), 1 / 40);
    S.commit();
    // drifting gold dust, close by
    const D = this.dust;
    for (let i = 0; i < D.n; i++) {
      const zr = ((hash(i, 3) * 120 - L) % 120 + 120) % 120;
      const z = -L - (120 - zr) + 8;
      const [px, py] = this.sway(-z);
      D.set(i, px + (hash(i, 4) - 0.5) * 30, py + (hash(i, 5) - 0.5) * 18, z, col(hash(i, 6) < 0.5 ? 'gold' : 'white', 1), 0.06 + 0.1 * hash(i, 7), 0.5 + 1.5 * hash(i, 8));
    }
    D.commit();
    // the Earth ahead at the end of the flight (the ending's fall starts from exactly this view)
    const tE = this.tEnd;
    const eon = smoothstep(tE - 1.6, tE - 0.9, t);
    this.earth.visible = eon > 0.001;
    if (this.earth.visible) EARTH_END.place(this.earth, cam, t, eon);

    const r = this.ctx.renderer;
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, true);
    r.render(this.scene, cam);

    // composite: exposure on the kicks, the jumps' streak, the warp in the roll, the words
    const U = this.comp.u;
    U.expo!.value = 1 + 0.18 * kick + 0.35 * jump;
    U.blur!.value = 0.12 * jump;
    const e = clamp((t - this.jumps[0]!) / (this.jumps[1]! - this.jumps[0]!));
    U.warp!.value = (t > this.jumps[0]! ? 0.25 + 0.5 * e : 0) * (1 - eon);
    U.wT!.value = t;
    const txt = this.drawText(t);
    U.textK!.value = txt ? 1.25 : 0;
    U.darkK!.value = txt ? 1 : 0;
    this.comp.render(r, out);
    const fi = frameIdx(t), sh = 3 * kick + 14 * jump;
    return {
      bloom: 0.8, bloomThreshold: 0.75, bloomRadius: 0.8, vignette: 0.42, grain: 0.035, ca: 0.6 + 2 * jump + 0.6 * kick, halation: 0.08,
      zoom: 1 + 0.02 * kick, shake: [(hash(fi, 1) - 0.5) * 2 * sh, (hash(fi, 2) - 0.5) * 2 * sh], flash: 0.05 * jump,
    };
  }

  override dispose() { this.deck.dispose(); this.comp.mat.dispose(); this.rt.dispose(); }
}
void ease;
