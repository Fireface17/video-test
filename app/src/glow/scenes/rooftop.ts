// Pre-chorus 1 — a person made of light alone on a rooftop above the night city.
// "Put your hands up if you've ever felt low": he raises his hand and the light in it flies out and writes the
// line in the sky (the second row sags on "low"). "(felt low)": all over the city other lights answer and
// rise like lanterns; "Tonight we let it all go": they gather in the sky into the words. "Turn the pain into
// gold": the lanterns regroup into the next line and on "gold" a golden wave runs through the lanterns, the
// city and him. "Here we go, here we go": the lanterns stream into one star above him, the words punch in
// neon on the beat, he raises both arms, and the star bursts into the chorus.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import type { Line } from '../../engine/lyrics';
import { Stage, aim, skyDome } from '../lib/stage';
import { col } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { City } from '../lib/city';
import { Landmarks } from '../lib/landmarks';
import { LightMotes, RealFigure, bend, limbDir, loadBody } from '../lib/people';
import { LightTrail, lineText, sampleStrokeText } from '../lib/lightpaint';
import { displayTextGeometry, loadDisplayFont } from '../lib/fonts';
import { flickerOn } from '../lib/neon';

const ROOF = 48;
const HERO = new THREE.Vector3(0, ROOF, -10);
const LANTERN = new THREE.Color(1.0, 0.82, 0.55);
const GOLD = col('gold', 1.6);
/** Landmark spots (x, z, clear radius): Empire State, Chrysler, One WTC. */
const LM: [number, number, number][] = [[-280, -1150, 95], [360, -1480, 60], [820, -2050, 75]];

interface Lantern { from: THREE.Vector3; launch: number; seed: number; tgt: (THREE.Vector3 | null)[]; arrive: number[] }

export default class Rooftop extends Scene {
  st = new Stage(46, 0.05, 8000);
  city!: City;
  sky!: THREE.Mesh;
  stars = new GlowPoints(2500, 1.4);
  roof = new THREE.Group();
  hero!: RealFigure;
  heroLight = new GlowPoints(24, 0.05);
  motes = new LightMotes(160, 0.03);
  rowA!: LightTrail;
  rowB!: LightTrail;
  textGrp = new THREE.Group();
  L: Record<string, Line> = {};
  lanterns: Lantern[] = [];
  lp!: GlowPoints;
  star = new GlowPoints(8, 0.5);
  hereGo: { grp: THREE.Group; words: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t0: number }[] }[] = [];
  redLight!: THREE.Mesh;
  roofMat!: THREE.ShaderMaterial;
  lm!: Landmarks;

  override async init() {
    const { lyrics } = this.ctx;
    const S = this.st;
    S.bg.copy(col('night', 0.4));
    this.L.put = lyrics.get('Put your hands up');
    this.L.tonight = lyrics.get('Tonight we let it all go');
    this.L.turn = lyrics.get('Turn the pain into gold');
    this.L.here = lyrics.get('Here we go, here we go');

    // sky: a deep blue glow above the city, stars, a thin moon
    this.sky = skyDome(new THREE.Color(0.003, 0.004, 0.012), new THREE.Color(0.045, 0.03, 0.032), new THREE.Color(0.02, 0.014, 0.018), 6000);
    const sr = mulberry32(21);
    for (let i = 0; i < this.stars.n; i++) {
      const a = sr() * Math.PI * 2, u = 0.05 + Math.pow(sr(), 0.7) * 0.95, R = 5000;
      this.stars.set(i, Math.cos(a) * Math.sqrt(1 - u * u) * R, u * R, Math.sin(a) * Math.sqrt(1 - u * u) * R, col('white', 0.5 + sr() * 1.5), 1, 0.5 + sr() * sr() * 2.5);
    }
    this.stars.commit();
    S.add(this.sky, this.stars);

    // the city, his own block left clear
    this.city = new City({ seed: 11, half: 1700, centre: [80, -950], downtownR: 520, clear: [[0, -10, 40], ...LM.map(([x, z, r]) => [x, z, r] as [number, number, number])], fog: 0.00075, clouds: 750 });
    S.add(this.city);
    // the Empire State, the Chrysler and One World Trade Center on the skyline
    this.lm = new Landmarks(this.city);
    this.lm.esb.position.set(LM[0]![0], 0, LM[0]![1]);
    this.lm.esb.rotation.y = 0.12;
    this.lm.chrysler.position.set(LM[1]![0], 0, LM[1]![1]);
    this.lm.chrysler.rotation.y = -0.3;
    this.lm.wtc.position.set(LM[2]![0], 0, LM[2]![1]);
    this.lm.wtc.rotation.y = 0.2;
    S.add(this.lm);

    // his roof: a slab with a parapet, a water tank, vents, an antenna with a red light
    // roof membrane: dark gravel with seams, lit only by the city's glow and by him (a pool of light at his feet)
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const cx = cv.getContext('2d')!, img = cx.createImageData(512, 512), gr = mulberry32(5);
    for (let i = 0; i < 512 * 512; i++) {
      const x = i % 512, y = Math.floor(i / 512);
      const seam = (x % 128 < 2 || y % 96 < 2) ? -18 : 0;
      const v = 40 + (gr() + gr() + gr() - 1.5) * 26 + seam + noise1(x * 0.03, y * 0.01) * 8;
      img.data[i * 4] = img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 6; img.data[i * 4 + 3] = 255;
    }
    cx.putImageData(img, 0, 0);
    const gt = new THREE.CanvasTexture(cv);
    gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
    gt.repeat.set(4, 4);
    gt.anisotropy = 8;
    gt.colorSpace = THREE.SRGBColorSpace;
    this.roofMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: gt }, hero: { value: new THREE.Vector3() }, heroC: { value: new THREE.Color() } },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: `uniform sampler2D map; uniform vec3 hero, heroC; varying vec2 vUv; varying vec3 vW;
        void main(){ vec3 a = texture2D(map, vUv * 4.0).rgb; float d = length(vW.xz - hero.xz);
          vec3 c = a * (vec3(0.025, 0.03, 0.06) + heroC * (0.5 * exp(-d * d / 6.0) + 0.12 * exp(-d / 5.0)));
          gl_FragColor = vec4(c, 1.0); }`,
    });
    const dark = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.007, 0.012) });
    const rim = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.008, 0.009, 0.014) });
    // (the slab uses the city's window shader, so its facade has windows too)
    const sg = new THREE.BoxGeometry(1, 1, 1);
    sg.translate(0, 0.5, 0);
    sg.setAttribute('aB', new THREE.InstancedBufferAttribute(new Float32Array([42, 0.35, 0.8, 0]), 4));
    sg.setAttribute('aTop', new THREE.InstancedBufferAttribute(new Float32Array([ROOF]), 1));
    const slab = new THREE.InstancedMesh(sg, this.city.mat, 1);
    slab.setMatrixAt(0, new THREE.Matrix4().makeScale(34, ROOF, 30).setPosition(0, 0, -12));
    slab.frustumCulled = false;
    const top = new THREE.Mesh(new THREE.BoxGeometry(34.2, 0.3, 30.2), this.roofMat);
    top.position.set(0, ROOF + 0.15, -12);
    const parapet = (w: number, d: number, x: number, z: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.0, d), rim); m.position.set(x, ROOF + 0.5, z); return m; };
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 3.4, 20), dark);
    tank.position.set(9, ROOF + 4.6, -4);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 2.6), rim);
    legs.position.set(9, ROOF + 1.5, -4);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 14, 6), rim);
    ant.position.set(-11, ROOF + 7, -20);
    this.redLight = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.1, 0.05) }));
    this.redLight.position.set(-11, ROOF + 14.1, -20);
    const vents: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) { const v = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 1.4), rim); v.position.set(-8 + i * 2.2, ROOF + 0.55, 0); vents.push(v); }
    this.roof.add(slab, top, parapet(34, 0.4, 0, -26.8), parapet(34, 0.4, 0, 2.8), parapet(0.4, 30, -16.8, -12), parapet(0.4, 30, 16.8, -12), tank, legs, ant, this.redLight, ...vents);
    S.add(this.roof);

    // him, at the edge, facing the city (-z)
    const rpm = await loadBody('rpm');
    this.hero = new RealFigure(rpm, 'rpm', col('cyan', 1.1).lerp(col('blue', 1.3), 0.35));
    this.hero.position.copy(HERO).setY(ROOF + 0.3 + this.hero.hipHeight);
    this.hero.rotation.y = Math.PI;
    S.add(this.hero, this.heroLight, this.motes);

    // "Put your hands up / if you've ever felt low" — written in the sky by the light from his hand
    const put = this.L.put!;
    const split = put.words.findIndex((w) => /^if$/i.test(w.w));
    const lineA = { ...put, words: put.words.slice(0, split) }, lineB = { ...put, words: put.words.slice(split) };
    this.rowA = LightTrail.text(lineText(lineA), 'script', 4.2, { width: 0.12, color: col('white', 1.2).lerp(col('phosphor', 1.2), 0.2), tipLen: 2.5, seed: 1 });
    this.rowB = LightTrail.text(lineText(lineB), 'script', 4.2, { width: 0.12, color: col('white', 1.2).lerp(col('phosphor', 1.2), 0.2), tipLen: 2.5, seed: 4 });
    (this.rowA as any).line = lineA;
    (this.rowB as any).line = lineB;
    this.rowB.position.set(2.0, -5.0, 0);
    this.rowB.rotation.z = -0.06;
    this.textGrp.add(this.rowA, this.rowB);
    this.textGrp.position.set(-5, 68, -50);
    this.textGrp.lookAt(new THREE.Vector3(9, 54, -6));
    S.add(this.textGrp);

    // lanterns: rise from roofs all over the city; most gather into the words of the next two lines
    const ton = this.L.tonight!, turn = this.L.turn!;
    const tC = new THREE.Vector3(10, 135, -300);
    const look = new THREE.Vector3(-30, 95, 60);
    const basis = new THREE.Matrix4().lookAt(tC, look, new THREE.Vector3(0, 1, 0)); // faces the aerial camera
    const toWorld = (p: THREE.Vector2, dy: number) => new THREE.Vector3(-p.x, p.y + dy, 0).applyMatrix4(new THREE.Matrix4().extractRotation(basis)).add(tC);
    const clean = (l: Line) => lineText(l).replace(/[,.!?]/g, '');
    const A = sampleStrokeText(clean(ton), 'readable', 28, 1.3), B = sampleStrokeText(clean(turn), 'readable', 28, 1.3);
    const N = Math.max(A.pts.length, B.pts.length) + 900;
    this.lp = new GlowPoints(N, 1.0);
    S.add(this.lp);
    const lr = mulberry32(77);
    const roofs = this.city.boxes.filter(([x, z]) => z < 0 && z > -1500 && Math.abs(x) < 1100);
    // pairing: sort both targets and launch spots by x so paths don't cross much
    const aIdx = A.pts.map((_, i) => i).sort((a, b) => A.pts[a]!.x - A.pts[b]!.x);
    const bIdx = B.pts.map((_, i) => i).sort((a, b) => B.pts[a]!.x - B.pts[b]!.x);
    for (let i = 0; i < N; i++) {
      const b = roofs[Math.floor(lr() * roofs.length)]!;
      const from = new THREE.Vector3(b[0] + (lr() - 0.5) * b[2], b[4] + 2, b[1] + (lr() - 0.5) * b[3]);
      const ia = i < A.pts.length ? aIdx[Math.floor((i * aIdx.length) / A.pts.length)]! : -1;
      const ib = i < Math.max(A.pts.length, B.pts.length) ? bIdx[Math.floor((i * bIdx.length) / Math.max(A.pts.length, B.pts.length)) % bIdx.length]! : -1;
      const tA = ia >= 0 ? toWorld(A.pts[ia]!, 0) : null, tB = ib >= 0 ? toWorld(B.pts[ib]!, 0) : null;
      const arriveA = ia >= 0 ? ton.words[A.word[ia]!]!.start : Infinity;
      const arriveB = ib >= 0 ? turn.words[B.word[ib]!]!.start : Infinity;
      this.lanterns.push({ from, launch: 33.85 + lr() * 0.9 + (ia < 0 && ib < 0 ? lr() * 2 : 0), seed: i, tgt: [tA, tB], arrive: [arriveA, arriveB] });
    }
    // sort the launch spots by x too, for the text lanterns
    const textL = this.lanterns.filter((l) => l.tgt[0]);
    const spots = textL.map((l) => l.from).sort((a, b) => a.x - b.x);
    textL.sort((a, b) => a.tgt[0]!.x - b.tgt[0]!.x).forEach((l, k) => (l.from = spots[k]!));
    void look;

    // "HERE WE GO" in neon (Tilt Neon), twice, the second bigger
    const font = await loadDisplayFont('tiltneon');
    const here = this.L.here!;
    for (const half of [0, 1]) {
      const grp = new THREE.Group();
      const ws = here.words.slice(half * 3, half * 3 + 3);
      const words = ws.map((w, i) => {
        const g = displayTextGeometry(font, w.w.replace(/[,.]/g, '').toUpperCase(), 1, {});
        g.computeBoundingBox();
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
        const mesh = new THREE.Mesh(g, mat);
        mesh.position.x = (i - 1) * 2.6;
        grp.add(mesh);
        return { mesh, mat, t0: w.start };
      });
      this.hereGo.push({ grp, words });
      S.add(grp);
    }
    S.add(this.star);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, cam = S.cam;
    const L = this.L, ton = L.tonight!, turn = L.turn!, here = L.here!;
    const tGold = turn.words.find((w) => /gold/i.test(w.w))!.start;
    const goldK = ease.inOutCubic(prog(t, tGold - 0.05, tGold + 1.2));
    const hereT = here.words[0]!.start, here2 = here.words[3]?.start ?? hereT + 1.4;
    const burst = this.ctx.end;

    // ---- city ----
    this.city.update(t, cam.position);
    // the Empire State's crown: white, then gold on "gold"
    this.lm.update(t, new THREE.Color(0.9, 0.88, 0.8).lerp(new THREE.Color(1.0, 0.7, 0.25), goldK));
    this.city.gold = goldK > 0 ? 0.9 : 0;
    this.city.goldWave(HERO, goldK > 0 ? lerp(0, 2600, ease.inQuad(prog(t, tGold - 0.05, tGold + 1.6))) : 1e9);
    (this.redLight.material as THREE.MeshBasicMaterial).color.setRGB(3 * (Math.sin(t * Math.PI * 1.25) > 0.6 ? 1 : 0.05), 0.1, 0.05);

    // ---- him ----
    const h = this.hero, put = L.put!;
    const raise = ease.inOutCubic(prog(t, put.words[0]!.start - 0.25, put.words[3]!.start + 0.05)); // arm up by "up"
    const open = ease.inOutCubic(prog(t, ton.start, ton.start + 1.2)) * (1 - prog(t, hereT - 0.3, hereT + 0.4));
    const both = ease.outCubic(prog(t, hereT - 0.2, hereT + 0.6));
    const bob = Math.sin(f.beat * Math.PI) * 0.02;
    // head up to the sky; on "open" he lifts his face and opens his arms low and soft, palms forward
    const look = Math.max(raise * (1 - open), both);
    h.setSpine(-0.05 - 0.1 * both - 0.08 * open, 0.04 * Math.sin(t * 0.7) + 0.05 * open, -0.12 - 0.35 * look - 0.3 * open, 0.12 * open);
    // left arm (index 1): up to the sky with the light, then open, then both up (not symmetric)
    const upA = limbDir(1, lerp(0.15, 2.55, raise), lerp(0.05, 0.55, raise));
    const openA = limbDir(1, 0.62, 0.3);
    const bothA = limbDir(1, 2.6, 0.3);
    const ua1 = upA.clone().lerp(openA, open).lerp(bothA, both).normalize();
    h.setArm(1, ua1, bend(ua1, new THREE.Vector3(-0.2, 0.25, 1), 0.25 + 0.15 * open), -0.4 * raise * (1 - open));
    const ua0 = limbDir(-1, lerp(0.15, 0.62, open), lerp(0.1, 0.3, open)).lerp(limbDir(-1, 2.85, 0.15), both).normalize();
    h.setArm(0, ua0, bend(ua0, new THREE.Vector3(0.2, 0.25, 1), 0.3 + 0.1 * open));
    h.setHand(1, raise > 0.98 ? 0.12 : 0.6);
    h.setHand(0, 0.12 + 0.2 * (1 - open));
    // weight on one leg, the other knee soft
    const l0 = limbDir(-1, 0.04, 0.1), l1 = limbDir(1, 0.1, -0.03);
    h.setLeg(0, l0, bend(l0, new THREE.Vector3(0, 0, 1), -0.25));
    h.setLeg(1, l1, l1);
    h.time = t;
    this.motes.update(h, t, (h.mat.uniforms.color!.value as THREE.Color).clone().lerp(GOLD, goldK).multiplyScalar(1.4), 1);
    h.position.y = ROOF + 0.3 + h.hipHeight + bob * both;
    const gu = h.mat.uniforms;
    (gu.gold!.value as THREE.Color).copy(GOLD);
    (gu.goldO!.value as THREE.Vector3).copy(h.hand(1));
    gu.goldR!.value = goldK > 0 ? lerp(0, 2.5, goldK) : -1;
    (this.roofMat.uniforms.hero!.value as THREE.Vector3).copy(h.position);
    (this.roofMat.uniforms.heroC!.value as THREE.Color).copy(gu.color!.value as THREE.Color).lerp(GOLD, goldK).multiplyScalar(0.5);
    gu.level!.value = 1 + 0.3 * pulse(t, hereT, 0.3) + 0.3 * pulse(t, here2, 0.3) + 0.5 * prog(t, burst - 0.6, burst);

    // ---- the light: in his hand, then out to write the first line ----
    const rowA = this.rowA, rowB = this.rowB;
    const la = (rowA as any).line as Line, lb = (rowB as any).line as Line;
    rowA.reveal = rowA.writtenAt(la, t, 0.5);
    rowB.reveal = rowB.writtenAt(lb, t, 0.5);
    const writeEnd = (lb.words.at(-1)!.end) + 0.3;
    const textFade = 1 - prog(t, ton.start - 0.1, ton.start + 0.4);
    rowA.gain = rowB.gain = textFade * (1 + 0.5 * goldK);
    this.textGrp.visible = textFade > 0.001;
    this.textGrp.updateMatrixWorld(true);
    const handP = h.hand(1);
    let pen: THREE.Vector3;
    const startA = rowA.localToWorld(rowA.pointAt(0));
    if (t < la.words[0]!.start) pen = handP.clone().lerp(startA, ease.inOutCubic(prog(t, la.words[0]!.start - 0.22, la.words[0]!.start)));
    else if (rowB.reveal <= 0) pen = rowA.localToWorld(rowA.pointAt(rowA.reveal));
    else pen = rowB.localToWorld(rowB.pointAt(rowB.reveal));
    let hp = 0;
    const penOn = t < writeEnd ? 1 : Math.max(0, 1 - (t - writeEnd) / 0.4);
    if (penOn > 0) {
      this.heroLight.set(hp++, pen.x, pen.y, pen.z, col('white', 3), penOn, t < la.words[0]!.start - 0.22 ? 3 : 14);
      for (let k = 1; k < 16; k++) {
        const q = pen.clone().add(new THREE.Vector3(noise1(t * 6 + k, 1), noise1(t * 6 + k, 2), noise1(t * 6 + k, 3)).multiplyScalar(0.25 * k * 0.15));
        this.heroLight.set(hp++, q.x, q.y - k * 0.04, q.z, col('phosphor', 1.5), penOn * (1 - k / 16) * 0.6, 3);
      }
    }
    this.heroLight.commit(hp);

    // ---- lanterns ----
    const lp = this.lp;
    const morph = (l: Lantern) => (l.tgt[1] ? ease.inOutCubic(prog(t, l.arrive[1]! - 0.55, l.arrive[1]!)) : 0);
    const star = new THREE.Vector3(0, ROOF + 9, -11);
    this.lanterns.forEach((l, i) => {
      if (t < l.launch) { lp.hide(i); return; }
      const age = t - l.launch;
      const r1 = noise1(l.seed * 0.37 + t * 0.4, 5), r2 = noise1(l.seed * 0.53 + t * 0.35, 9);
      // free rise: slow, wobbling, up and a bit toward the camera's sky
      const free = l.from.clone().add(new THREE.Vector3(r1 * 6 + age * 1.2, age * (7 + (l.seed % 7)), r2 * 6 - age * 4));
      let p = free;
      if (l.tgt[0]) {
        const k = ease.inOutCubic(prog(t, l.launch + 0.15, Math.max(l.launch + 0.6, l.arrive[0]! - 0.02)));
        const arc = free.clone().lerp(l.tgt[0], k);
        arc.y += Math.sin(k * Math.PI) * 40;
        p = arc.add(new THREE.Vector3(r1, r2, 0).multiplyScalar(0.6 * k));
      }
      const m = morph(l);
      if (m > 0 && l.tgt[1]) { p = p.clone().lerp(l.tgt[1], m); p.y += Math.sin(m * Math.PI) * 25; }
      // "here we go": everything streams into the star above him
      const into = ease.inCubic(prog(t, i % 2 ? here2 - 0.2 : hereT - 0.2, (i % 2 ? here2 : hereT) + 0.9 + (i % 5) * 0.08));
      if (into > 0) p = p.clone().lerp(star, into);
      const flick = 0.75 + 0.25 * noise1(t * 3 + l.seed, 11);
      const c = LANTERN.clone().lerp(GOLD, goldK).multiplyScalar(flick * (l.tgt[0] || morph(l) > 0.5 ? 2.4 : 1.3) * (1 - 0.8 * into));
      const inText = !!l.tgt[0] || morph(l) > 0.5;
      lp.set(i, p.x, p.y, p.z, c, smoothstep(0, 0.3, age), inText ? 4.0 : 2.4 + (l.seed % 3) * 0.8);
    });
    lp.commit();
    // the star
    const sK = smoothstep(hereT - 0.1, hereT + 0.8, t);
    const beatPulse = pulse(t, f.a ? this.ctx.audio.timeOfBeat(Math.floor(f.beat)) : t, 0.12);
    this.star.set(0, star.x, star.y, star.z, GOLD.clone().lerp(col('white', 3), 0.4), sK * (1 + 0.6 * beatPulse + 2 * prog(t, burst - 0.8, burst)), 6 + 10 * prog(t, here2, burst));
    this.star.set(1, star.x, star.y, star.z, GOLD, sK * 0.5, 30 + 30 * prog(t, here2, burst));
    this.star.commit(2);

    // ---- "HERE WE GO" ×2 ----
    this.hereGo.forEach((hg, k) => {
      const t0 = hg.words[0]!.t0, t1 = k === 0 ? here2 - 0.05 : burst + 0.3;
      hg.grp.visible = t > t0 - 0.05 && t < t1;
      hg.words.forEach((w) => {
        const on = flickerOn(t, w.t0, k * 3 + 1);
        const punch = 1 + 0.35 * pulse(t, w.t0, 0.08);
        w.mesh.scale.setScalar(punch);
        w.mat.color.copy(col('white', 2.2).lerp(GOLD, 0.55)).multiplyScalar(on * (k === 1 ? 1.2 : 1));
      });
    });

    // ---- camera: six shots, cut or snapped on downbeats ----
    const B = this.ctx.audio.downbeats.filter((d) => d > this.ctx.start - 0.5 && d < burst + 1);
    const shot = (a: number) => B.filter((d) => d <= t).length - 1 >= a;
    void shot;
    const pos = new THREE.Vector3(), tgt = new THREE.Vector3();
    let fov = 46, roll = 0;
    const tB = B[1] ?? 32.0; // first downbeat inside: the wider shot of the writing
    if (t < tB) {
      const k = prog(t, this.ctx.start - 0.4, tB);
      pos.set(2.6 - 0.8 * k, ROOF + 1.9, -5.2 + 0.6 * k);
      tgt.set(-3, 60 + 2 * k, -50);
    } else if (t < ton.start - 0.3) {
      const k = ease.outExpo(prog(t, tB, tB + 0.45)), d = prog(t, tB, ton.start);
      pos.set(lerp(3, 16, k) + d * 2, ROOF + lerp(2.0, 7.0, k) + d * 2, lerp(-2, -9, k));
      tgt.set(-4, 64, -50);
      roll = -0.04 * k;
    } else if (t < tGold - 1.8) {
      const k = prog(t, ton.start - 0.3, tGold - 1.8);
      pos.set(-40 + 20 * k, 85 + 15 * k, 60 - 30 * k);
      tgt.set(10, 115 + 10 * k, -300);
      fov = 50;
    } else if (t < tGold + 0.9) {
      const k = prog(t, tGold - 1.8, tGold + 0.9);
      pos.set(30 - 10 * k, 70 + 6 * k, -60 + 30 * k);
      tgt.set(10, 135, -300);
      fov = 58;
      roll = 0.05;
    } else if (t < hereT - 0.05) {
      const k = prog(t, tGold + 0.9, hereT);
      pos.set(-1.6 + 0.6 * k, ROOF + 0.75, -6.6 - 0.4 * k);
      tgt.set(0.25, ROOF + 2.2, -14);
      fov = 40;
      fov = 52;
    } else {
      const k = ease.inOutCubic(prog(t, hereT - 0.05, burst));
      // in front of him, low, looking up past him to the star; pushing into the star at the end
      pos.set(1.6 - 0.8 * k, ROOF + 0.9 + 0.8 * k, -15.5 + 2 * k);
      tgt.set(0, ROOF + 2.4 + 6 * ease.inCubic(k), -10.5);
      fov = 50 - 12 * ease.inCubic(prog(t, burst - 0.8, burst));
      roll = 0.03 * Math.sin(t * 2);
      // the punches shake the frame
      const sh = 0.05 * (pulse(t, here.words[0]!.start, 0.1) + pulse(t, here2, 0.1));
      pos.x += sh * noise1(t * 40, 3); pos.y += sh * noise1(t * 40, 4);
    }
    pos.x += noise1(t * 0.5, 31) * 0.15;
    pos.y += noise1(t * 0.45, 32) * 0.1;
    aim(cam, pos, tgt, roll);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    // the neon words float in front of the camera, in the lower third
    this.hereGo.forEach((hg, k) => {
      const d = 6.5;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion), upv = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      hg.grp.position.copy(cam.position).addScaledVector(fwd, d).addScaledVector(upv, k === 0 ? 1.05 : -0.5);
      hg.grp.quaternion.copy(cam.quaternion);
      hg.grp.scale.setScalar(k === 0 ? 0.62 : 0.9);
    });
    this.sky.position.copy(cam.position);
    this.stars.position.copy(cam.position);

    S.render(this.ctx.renderer, out);
    const flash = prog(t, burst - 0.25, burst + 0.05);
    return {
      bloom: 0.95 + 0.3 * goldK, bloomThreshold: 0.75, bloomRadius: 0.85, halation: 0.15, vignette: 0.5, grain: 0.05, ca: 0.7,
      flash: flash * flash,
    };
  }
}
