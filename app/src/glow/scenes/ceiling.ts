// Intro / outro: lying on the bed, looking up at a bedroom ceiling of glow-in-the-dark stickers.
// Intro: the lamp clicks off on the first downbeat, a sticker ignites on every airy "oh", the ceiling
// dissolves into the night sky and the stars spell out the title. Outro: back down to the ceiling, the
// phosphor decays star by star, two stars meet on "take my hand", and the lamp clicks back on at the
// very end, so the last frame is the first one and the video loops.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim, faceCamera, skyDome } from '../lib/stage';
import { col } from '../lib/palette';
import { starGeometry } from '../lib/shapes';
import { NeonSign, flickerOn } from '../lib/neon';
import { GlowPoints } from '../lib/points';

const CEIL = 2.6; // ceiling height (m)
const N_STARS = 46;

interface Sticker { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; x: number; z: number; r: number; rot: number; t0: number; tOut: number; seed: number }

/** A soft plaster texture for the ceiling (deterministic noise). */
function plaster(): THREE.Texture {
  const n = 256, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d')!, img = c.createImageData(n, n), rnd = mulberry32(7);
  for (let i = 0; i < n * n; i++) {
    const v = 200 + Math.floor((rnd() + rnd() + rnd()) * 18);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export default class Ceiling extends Scene {
  st = new Stage(64, 0.05, 600);
  outro = false;
  stickers: Sticker[] = [];
  ceilMat!: THREE.MeshStandardMaterial;
  wallMat!: THREE.MeshStandardMaterial;
  lampMat!: THREE.MeshBasicMaterial;
  lampDisc!: THREE.Mesh;
  haloMat: THREE.ShaderMaterial[] = [];
  lamp!: THREE.PointLight;
  hemi!: THREE.HemisphereLight;
  moon!: THREE.Mesh;
  sky!: THREE.Mesh;
  field!: GlowPoints;
  title!: NeonSign;
  artist!: NeonSign;
  hand?: NeonSign;
  meteors!: GlowPoints;
  bars: number[] = [];

  override async init() {
    const { audio, params, start, end, lyrics } = this.ctx;
    this.outro = params.mode === 'outro';
    const S = this.st.scene;
    this.st.bg.copy(col('night'));
    // bars of this entry (downbeat times)
    this.bars = audio.downbeats.filter((d) => d >= start - 0.01 && d <= end + 2);

    // room: ceiling, two walls, a lamp
    this.ceilMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#9aa3c4'), map: plaster(), roughness: 0.95, transparent: true });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(9, 8), this.ceilMat);
    ceil.rotation.x = Math.PI / 2; // facing down
    ceil.position.y = CEIL;
    this.wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6d7598'), roughness: 0.9, transparent: true });
    const wallN = new THREE.Mesh(new THREE.PlaneGeometry(9, 3), this.wallMat);
    wallN.position.set(0, CEIL - 1.5, -2.3);
    const wallE = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), this.wallMat);
    wallE.rotation.y = -Math.PI / 2;
    wallE.position.set(3.1, CEIL - 1.5, 0);
    this.lampMat = new THREE.MeshBasicMaterial({ color: col('#ffd9a0', 1.2), transparent: true });
    this.lampDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 40), this.lampMat);
    this.lampDisc.position.set(1.05, CEIL - 0.03, -1.05);
    this.lamp = new THREE.PointLight(new THREE.Color('#ffcf94'), 4, 0, 1.6);
    this.lamp.position.set(1.05, CEIL - 0.3, -1.05);
    this.hemi = new THREE.HemisphereLight(new THREE.Color('#2a3a80'), new THREE.Color('#05060f'), 0.05);
    this.hemi.position.set(0, -1, 0); // the "sky" colour lights the downward-facing ceiling
    // moonlight from the window: a soft cool patch on the ceiling near the north wall
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { k: { value: 0 }, c: { value: col('blue', 0.22) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float k; uniform vec3 c; varying vec2 vUv;
        void main(){ vec2 p = abs(vUv - 0.5) * 2.0; float a = (1.0 - smoothstep(0.55, 1.0, p.x)) * (1.0 - smoothstep(0.35, 1.0, p.y));
          float bars = smoothstep(0.02, 0.06, abs(fract(vUv.x * 2.0) - 0.5)) * smoothstep(0.02, 0.06, abs(vUv.y - 0.5));
          gl_FragColor = vec4(c * a * bars * k, 1.0); }`,
    }));
    this.moon.rotation.x = Math.PI / 2;
    this.moon.position.set(-0.9, CEIL - 0.005, -1.35);
    S.add(ceil, wallN, wallE, this.lampDisc, this.lamp, this.hemi, this.moon);

    // stickers: scattered over the ceiling, not too close to each other
    const rnd = mulberry32(this.outro ? 11 : 5);
    const geo = starGeometry(0.1, 0.04);
    const pts: { x: number; z: number; r: number }[] = [];
    for (let tries = 0; pts.length < N_STARS && tries < 4000; tries++) {
      const r = 0.06 + Math.pow(rnd(), 2.2) * 0.13;
      const x = (rnd() * 2 - 1) * 2.4, z = (rnd() * 2 - 1) * 1.7 - 0.2;
      if (pts.every((p) => Math.hypot(p.x - x, p.z - z) > (p.r + r) * 1.9)) pts.push({ x, z, r });
    }
    // ignition times: the airy vocal notes of the intro (after the lamp goes off), then the plucks
    const off = this.bars[1] ?? start + 1.6;
    const vo = audio.events('vocal', off + 0.2, (this.bars[8] ?? start + 12.8) - 0.1).map(([t]) => t);
    const order = pts.map((_, i) => i).sort((a, b) => Math.abs(pts[a]!.x) + Math.abs(pts[a]!.z + 0.2) * 1.3 - (Math.abs(pts[b]!.x) + Math.abs(pts[b]!.z + 0.2) * 1.3));
    const outT0 = this.bars[2] ?? start + 3.2, outT1 = (this.bars[10] ?? end - 2) - 0.4;
    pts.forEach((p, i) => {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d6efb8'), roughness: 0.55, emissive: col('phosphor'), emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      const rot = rnd() * Math.PI * 2;
      mesh.rotation.z = rot;
      mesh.scale.setScalar(p.r);
      mesh.position.set(p.x, CEIL - 0.012, p.z);
      S.add(mesh);
      const k = order.indexOf(i);
      const t0 = k < vo.length ? vo[k]! : off + 1.5 + (k - vo.length) * 0.2 + rnd() * 0.1;
      // outro: decay order random, the last star dies just before the lamp comes back on
      const tOut = lerp(outT0, outT1, Math.pow(rnd(), 0.8));
      this.stickers.push({ mesh, mat, x: p.x, z: p.z, r: p.r, rot, t0, tOut, seed: i });
      const hm = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { k: { value: 0 }, c: { value: col('phosphor', 0.16) } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform float k; uniform vec3 c; varying vec2 vUv;
          void main(){ float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(c * k * exp(-r * r * 5.0) * (1.0 - smoothstep(0.8, 1.0, r)), 1.0); }`,
      });
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hm);
      halo.rotation.x = Math.PI / 2;
      halo.scale.setScalar(p.r * 7);
      halo.position.set(p.x, CEIL - 0.004, p.z);
      (mesh as any).halo = halo;
      S.add(halo);
      this.haloMat.push(hm);
    });
    if (this.outro) {
      // the two stars that meet on "take my hand": the closest pair near the centre; they die last
      const a = this.stickers.reduce((b, s) => (Math.hypot(s.x, s.z + 0.2) < Math.hypot(b.x, b.z + 0.2) ? s : b));
      const b = this.stickers.filter((s) => s !== a).reduce((m, s) => (Math.hypot(s.x - a.x, s.z - a.z) < Math.hypot(m.x - a.x, m.z - a.z) ? s : m));
      a.tOut = b.tOut = outT1 + 0.2;
      (a as any).pair = 1; (b as any).pair = -1;
    }

    // the sky beyond the ceiling
    this.sky = skyDome(col('night'), col('dusk', 0.9), col('night'), 400);
    S.add(this.sky);
    this.field = new GlowPoints(1400, 0.9);
    const fr = mulberry32(3);
    for (let i = 0; i < this.field.n; i++) {
      // upper hemisphere, denser near the zenith
      const u = fr(), v = fr();
      const th = u * Math.PI * 2, ph = Math.acos(1 - v * 0.95);
      const R = 120 + fr() * 120;
      const c = fr() < 0.12 ? col('cyan') : fr() < 0.2 ? col('pink') : col('#e8ecff');
      this.field.set(i, Math.sin(ph) * Math.cos(th) * R, CEIL + Math.cos(ph) * R, Math.sin(ph) * Math.sin(th) * R, c, 0.5 + fr() * 1.2, 0.7 + Math.pow(fr(), 3) * 2.5);
    }
    this.field.commit();
    S.add(this.field);

    // shooting stars across the sky while the title comes on (trails of points)
    this.meteors = new GlowPoints(2 * 60, 0.06);
    S.add(this.meteors);
    // title: the song in neon script, the artist in a thin sans tube
    this.title = new NeonSign('Glowing in the Dark', { font: 'script', size: 0.74, align: 'center', color: col('phosphor', 2.2) });
    this.artist = new NeonSign('FIREFACE17', { font: 'readable', size: 0.24, align: 'center', color: col('cyan', 2.4), tracking: 10 });
    S.add(this.title, this.artist);
    if (this.outro) {
      const l = lyrics.find('Take my hand').filter((x) => x.start >= start - 0.5)[0];
      if (l) {
        this.hand = new NeonSign(l.text, { font: 'script', size: 0.32, align: 'center', color: col('pink', 2.4) });
        (this.hand as any).line = l;
        S.add(this.hand);
      }
    }
  }

  /** Camera path: lying on the bed, the frame's top toward the north wall. */
  private camera(t: number) {
    const b = this.bars, B = (k: number) => b[Math.min(k, b.length - 1)] ?? this.ctx.end;
    let rise: number, tilt: number;
    if (!this.outro) {
      // slow drift up toward the ceiling, then up through it into the sky from bar 8
      rise = lerp(0.72, 1.45, prog(t, this.ctx.start, B(8), ease.inOutQuad)) + prog(t, B(8) - 0.4, B(11), ease.inOutCubic) * 3.2;
      tilt = lerp(0.45, 0.2, prog(t, this.ctx.start, B(8), ease.inOutQuad)) - prog(t, B(8), B(11), ease.inOutCubic) * 0.15;
    } else {
      rise = lerp(4.6, 0.75, prog(t, this.ctx.start, B(2), ease.outCubic));
      tilt = lerp(0.05, 0.42, prog(t, this.ctx.start, B(2), ease.inOutCubic));
    }
    const sway = noise1(t * 0.18, 4) * 0.08;
    const pos = new THREE.Vector3(sway * 2, rise, 0.55 + noise1(t * 0.15, 9) * 0.1);
    const target = new THREE.Vector3(sway, CEIL + 2, pos.z - tilt * 2.4);
    aim(this.st.cam, pos, target, noise1(t * 0.11, 2) * 0.05 + (this.outro ? 0 : t * 0.006), { x: 0, y: 0, z: -1 });
  }

  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, { audio } = this.ctx;
    const b = this.bars, B = (k: number) => b[Math.min(k, b.length - 1)] ?? this.ctx.end;
    const lastBar = audio.downbeats.filter((d) => d <= audio.duration - 0.6).pop() ?? audio.duration;
    // lamp: on until the first downbeat of the intro; back on at the last downbeat of the outro
    const lampOn = this.outro ? (t >= lastBar ? 1 : 0) : (t < B(1) ? 1 : 0);
    this.lamp.intensity = 4 * lampOn;
    if (lampOn) this.lampMat.color.copy(col('#ffd9a0', 1.2));
    else this.lampMat.color.copy(col('ink', 0.18));
    this.hemi.intensity = lampOn ? 0.35 : 0.5;
    (this.moon.material as THREE.ShaderMaterial).uniforms.k!.value = 1 - lampOn;

    // the ceiling dissolves into the sky (intro, from bar 8) / re-forms (outro, first two bars)
    const open = this.outro ? 1 - prog(t, B(0) + 0.6, B(2), ease.inOutCubic) : prog(t, B(8) - 0.5, B(9), ease.inOutCubic);
    this.ceilMat.opacity = 1 - open;
    this.wallMat.opacity = 1 - open;
    this.ceilMat.visible = this.wallMat.visible = open < 0.999;
    this.lampMat.opacity = 1 - open;
    this.lampDisc.visible = open < 0.999;
    this.field.visible = open > 0.001;
    (this.field.material as THREE.ShaderMaterial).uniforms.size!.value = 0.9 * open;
    this.sky.visible = open > 0.001;

    // stickers
    const oth = audio.env('other', t);
    for (const s of this.stickers) {
      let g: number;
      if (!this.outro) {
        g = t < s.t0 ? (lampOn ? 0 : 0.02) : 0.75 + 0.25 * smoothstep(s.t0, s.t0 + 2, t) + 2.2 * pulse(t, s.t0, 0.12);
        g *= 0.9 + 0.25 * oth * (0.5 + 0.5 * noise1(t * 3 + s.seed, s.seed));
      } else {
        // phosphorescence: ~1/(1 + t/tau) decay, each star dimming out from its own moment
        const age = Math.max(0, t - this.ctx.start);
        g = 1.05 / (1 + age / 6) * (1 - smoothstep(s.tOut - 1.2, s.tOut, t));
        g += 0.6 * audio.hit('chop', t, 0.12) * (noise1(s.seed * 3.1, 1) > 0.2 ? 1 : 0) * (t < s.tOut ? 1 : 0);
      }
      s.mat.emissiveIntensity = g * 1.7;
      const halo = (s.mesh as any).halo as THREE.Mesh;
      (halo.material as THREE.ShaderMaterial).uniforms.k!.value = g * (1 - open);
      // flying off into the sky (intro) / settling back (outro)
      const fly = open;
      const h = fly * (6 + (s.seed % 7) * 2.2);
      let x = s.x * (1 + fly * 1.8), z = s.z * (1 + fly * 1.8);
      const pair = (s as any).pair as number | undefined;
      if (pair && this.hand) {
        const l = (this.hand as any).line;
        const k = prog(t, l.words[0].start, l.words[l.words.length - 1].end + 0.3, ease.inOutCubic);
        const other = this.stickers.find((o) => (o as any).pair === -pair)!;
        const mx = (s.x + other.x) / 2, mz = (s.z + other.z) / 2;
        const d = Math.hypot(s.x - other.x, s.z - other.z) || 1;
        x = lerp(s.x, mx + ((s.x - other.x) / d) * s.r * 0.9, k);
        z = lerp(s.z, mz + ((s.z - other.z) / d) * s.r * 0.9, k);
      }
      s.mesh.position.set(x, CEIL - 0.012 + h, z);
      halo.position.set(x, CEIL - 0.004, z);
      s.mesh.rotation.z = s.rot + fly * (s.seed % 2 ? 1 : -1) * 1.5;
      s.mesh.scale.setScalar(s.r * (1 + fly * 2.2));
    }

    this.camera(t);
    // two shooting stars in the sky part (intro), each a bright head with a fading tail
    {
      const cam = this.st.cam;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const shots = this.outro ? [] : [{ t0: B(9) + 0.3, y: 3.4, dir: 1 }, { t0: B(10) + 0.9, y: 2.8, dir: -1 }];
      for (let m = 0; m < 2; m++) {
        const sh = shots[m];
        for (let j = 0; j < 60; j++) {
          const i = m * 60 + j;
          const dt = sh ? t - sh.t0 - j * 0.0035 : -1;
          if (!sh || dt < 0 || dt > 0.9) { this.meteors.hide(i); continue; }
          const u = dt / 0.9;
          const p = cam.position.clone().addScaledVector(fwd, 14).addScaledVector(right, sh.dir * (-7 + u * 14)).addScaledVector(camUp, sh.y - u * 2.2);
          this.meteors.set(i, p.x, p.y, p.z, col(j < 3 ? 'white' : 'cyan'), (1 - j / 60) * 2.6 * Math.sin(Math.PI * u), j < 3 ? 2.8 : 2.0 - (1.4 * j) / 60);
        }
      }
      this.meteors.commit();
    }

    // title in the sky (intro): words switch on across bars 9-10, the artist after them
    this.title.visible = this.artist.visible = !this.outro && t > B(9) - 0.3;
    if (this.title.visible) {
      const cam = this.st.cam;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const base = cam.position.clone().addScaledVector(fwd, 5.2);
      this.title.position.copy(base).addScaledVector(up, 0.25);
      faceCamera(this.title, cam);
      this.artist.position.copy(base).addScaledVector(up, -0.45);
      faceCamera(this.artist, cam);
      const beats = [0, 1, 2, 4].map((k) => audio.timeOfBeat(audio.beatAt(B(9)) + k));
      this.title.words.forEach((_, i) => this.title.setLevel(i, flickerOn(t, beats[i]!, i + 3)));
      this.artist.setAll(flickerOn(t, audio.timeOfBeat(audio.beatAt(B(10)) + 2), 9) * 0.9);
      // everything fades out in the last beat before the cut
      const fade = 1 - smoothstep(this.ctx.end - 0.25, this.ctx.end, t);
      this.title.words.forEach((w, i) => this.title.setLevel(i, (w.mat.uniforms.on!.value as number) * fade));
    }
    if (this.hand) {
      const l = (this.hand as any).line;
      const a = this.stickers.find((s) => (s as any).pair === 1)!;
      this.hand.position.set(a.x, CEIL - 0.02, a.z + 0.38);
      // facing down at a camera that looks up with -z at the top of the frame: text runs along -x, up is -z
      this.hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0)));
      this.hand.visible = t > l.start - 0.5 && t < a.tOut;
      this.hand.sing(l, t, 1 - smoothstep(a.tOut - 1.5, a.tOut, t));
    }

    this.st.render(this.ctx.renderer, out);
    const fadeIn = this.outro ? 0 : 1 - smoothstep(0, 0.35, t);
    return { bloom: 0.95, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.5, grain: 0.05, ca: 0.8, fade: fadeIn * 0 };
  }
}
