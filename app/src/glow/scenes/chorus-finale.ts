// Chorus E (final chorus only): "We'll be glowing in the dark!" — the last line slams onto the dance
// floor while a golden sun rises behind it out of the night, glow sticks raised all around; white-out
// into the big drop.
import * as THREE from 'three';
import type { Frame, SceneCtx } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { ease, lerp, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim, skyDome } from '../lib/stage';
import { col, STICKS } from '../lib/palette';
import { glowStickGeometry } from '../lib/shapes';
import { DanceFloor } from './chorus-floor';
import { SlamLine } from './chorus-slam';
import { Dancers, Beams } from './chorus-dancers';
import { hash } from '../../engine/util';

export class Finale {
  st = new Stage(42, 0.1, 900);
  floor = new DanceFloor(30, 1.0);
  slam?: SlamLine;
  sun!: THREE.Mesh;
  sky!: THREE.Mesh;
  sticks!: THREE.InstancedMesh;
  stickPos: { x: number; z: number; ph: number; c: THREE.Color }[] = [];
  dancers!: Dancers;
  beams!: Beams;
  private m = new THREE.Matrix4();

  constructor(private ctx: SceneCtx, private ls: Line[]) {}

  async init() {
    const S = this.st;
    S.bg.copy(col('night'));
    S.fog(col('dusk', 0.6), 0.03);
    this.sky = skyDome(col('night'), col('dusk', 1.0), col('night'), 800);
    S.add(this.sky, this.floor);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshBasicMaterial({ color: col('night', 0.6), fog: true }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.2;
    S.add(ground);
    // the sun: a disc with a hot core and a soft corona, far behind the floor
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { k: { value: 0 }, core: { value: col('gold', 3.5) }, rim: { value: col('ember', 1.2) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float k; uniform vec3 core, rim; varying vec2 vUv;
        void main(){ float r = length(vUv - 0.5) * 2.0;
          float disc = 1.0 - smoothstep(0.30, 0.315, r);
          float corona = exp(-r * 4.0) * 0.9 + exp(-r * 1.6) * 0.25;
          gl_FragColor = vec4((core * disc + rim * corona) * k, 1.0); }`,
    }));
    this.sun.scale.setScalar(160);
    S.add(this.sun);
    // glow sticks raised around the floor
    const geo = glowStickGeometry(0.9, 0.05);
    this.sticks = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), 70);
    for (let i = 0; i < 70; i++) {
      const a = (i / 70) * Math.PI * 2;
      const r = 11 + (i % 3) * 1.6;
      this.stickPos.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * 0.8 - 2, ph: i * 1.7, c: col(STICKS[i % STICKS.length]!, 2.2) });
    }
    S.add(this.sticks);
    const spots: { x: number; z: number }[] = [];
    for (let i = 0; i < 16; i++) { const s = i % 2 ? 1 : -1; spots.push({ x: s * (4.4 + hash(i, 1) * 4.5), z: -5 + hash(i, 2) * 10 }); }
    for (let i = 0; i < 12; i++) spots.push({ x: (i / 11 - 0.5) * 15, z: -3.5 - hash(i, 4) * 4 });
    this.dancers = new Dancers(spots, ['gold', 'pink', 'cyan', 'phosphor'].map((k) => col(k, 1.4)));
    this.beams = new Beams(6, ['gold', 'pink', 'cyan'].map((k) => col(k, 1)));
    S.add(this.dancers, this.beams);
    const l = this.ls[0];
    if (l) {
      this.slam = new SlamLine(l, rowsOf(l), { size: 1.05, leading: 1.15, face: col('gold', 1.5), side: col('ember', 0.35), maxWidth: 7 });
      this.slam.position.z = -1.2;
      S.add(this.slam);
    }
  }

  render(f: Frame, segStart: number, segEnd: number, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, { audio } = this.ctx;
    const p = prog(t, segStart, segEnd);
    const rise = ease.outCubic(p);
    // sun rises from below the horizon; the sky warms with it
    this.sun.position.set(150, lerp(-55, 26, rise), -420);
    (this.sun.material as THREE.ShaderMaterial).uniforms.k!.value = smoothstep(0, 0.25, p) * (1 + 0.15 * f.a.kick);
    const skyU = (this.sky.material as THREE.ShaderMaterial).uniforms;
    (skyU.horizon!.value as THREE.Color).copy(col('dusk', 1)).lerp(col('ember', 0.5), smoothstep(0.1, 0.9, p));
    (skyU.glow!.value as THREE.Color).copy(col('gold', 0.8 * rise));
    (skyU.glowDir!.value as THREE.Vector3).set(0.34, lerp(-0.12, 0.06, rise), -1);
    const ripples: { t: number; x: number; z: number; c: THREE.Color }[] = [];
    let shake = 0;
    if (this.slam) {
      this.slam.pose(t, 3.4, 0.12, 0, 1 + 0.6 * smoothstep(segEnd - 1.2, segEnd, t), 1.3);
      for (const w of this.slam.words) {
        if (t >= w.word.start && t - w.word.start < 1.2) { const c = this.slam.centre(w); ripples.push({ t: w.word.start, x: c.x, z: 0.6, c: col('gold', 1.2) }); }
        shake = Math.max(shake, pulse(t, w.word.start, 0.06));
      }
    }
    this.floor.light(t, audio.beatAt(t), ['gold', 'pink', 'cyan', 'phosphor'].map((k) => col(k, 1)), 0.7 + 0.3 * audio.env('rms', t), smoothstep(segEnd - 1.5, segEnd, t), col('gold', 1.3), ripples);
    // sticks wave on the beat
    const beat = audio.beatAt(t);
    this.dancers.pose(beat, 0.7 + 0.3 * audio.env('rms', t), 1 + rise);
    this.beams.pose(beat, 0.8 + 0.4 * rise);
    this.stickPos.forEach((s, i) => {
      const sw = Math.sin(beat * Math.PI + s.ph) * 0.5;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 * Math.cos(beat * Math.PI * 0.5 + s.ph), 0, sw));
      this.m.compose(new THREE.Vector3(s.x, 2.1 + 0.25 * Math.abs(Math.sin(beat * Math.PI + s.ph)), s.z), q, new THREE.Vector3(1, 1, 1));
      this.sticks.setMatrixAt(i, this.m);
      this.sticks.setColorAt(i, s.c);
    });
    this.sticks.instanceMatrix.needsUpdate = true;
    this.sticks.instanceColor!.needsUpdate = true;
    // camera: low in front of the letters, the sun behind them
    const pos = new THREE.Vector3(lerp(2.2, -1.5, ease.inOutQuad(p)), lerp(1.0, 1.7, p), lerp(13.5, 10.5, ease.outCubic(p)));
    pos.x += noise1(t * 40, 1) * 0.07 * shake;
    pos.y += noise1(t * 40, 2) * 0.07 * shake;
    aim(S.cam, pos, new THREE.Vector3(0, 2.7, -6), noise1(t * 0.3, 3) * 0.03);
    S.render(this.ctx.renderer, out);
    return {
      flash: smoothstep(segEnd - 0.3, segEnd, t) * 0.3,
      shake: [noise1(t * 50, 1) * 6 * shake, noise1(t * 50, 2) * 6 * shake] as [number, number],
      halation: 0.3,
    };
  }
}

/** "We'll be glowing in the dark!" -> WE'LL BE / GLOWING / IN THE DARK! (split around the longest word). */
function rowsOf(l: Line): number[][] {
  const n = l.words.length;
  const g = l.words.reduce((b, w, i) => (w.w.length > l.words[b]!.w.length ? i : b), 0);
  return [Array.from({ length: g }, (_, i) => i), [g], Array.from({ length: n - g - 1 }, (_, i) => g + 1 + i)].filter((r) => r.length);
}
