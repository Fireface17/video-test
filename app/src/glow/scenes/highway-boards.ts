// Highway scene, the calendar billboards of line 2 ("Painting smiles on the days that we lost"): big roadside
// billboards, each a tear-off calendar page (MONDAY, TUESDAY, WEDNESDAY) lit by floodlights. When the words
// are sung they are brush-painted onto the page in glowing paint, and a smile is painted over the date.
// The painting is baked once: one canvas holds the bristly brush coverage, another the time at which the
// brush passes each pixel, so a shader reveals the strokes exactly in sync with the voice.
import * as THREE from 'three';
import { strokeText } from '../../engine/stroke';
import { F, font } from '../../engine/type';
import { mulberry32 } from '../../engine/util';
import { HU, HW_GLSL, boxAt, litMat, merge, rod } from './highway-common';
import { canvasTex } from './highway-tex';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const PW = 2048, PH = 788; // page canvas
export const BOARD_W = 13, BOARD_H = BOARD_W * (PH / PW);

export interface BoardWord { text: string; t0: number; t1: number }
export interface BoardSpec {
  day: string; date: string; month: string;
  lines: BoardWord[][]; // words per painted line
  smile: [number, number]; // when the smile is painted
  seed: number;
}

interface Pt { x: number; y: number }

function resample(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [pts[0]!];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    let s = step - carry;
    while (s < L) { out.push({ x: a.x + ((b.x - a.x) * s) / L, y: a.y + ((b.y - a.y) * s) / L }); s += step; }
    carry = L - (s - step);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/**
 * Paint one brush stroke into the coverage (cv) and time (tc) contexts. `tOf(k)` maps the k-th resampled
 * point to its normalised paint time (0..1).
 */
function brush(cv: CanvasRenderingContext2D, tc: CanvasRenderingContext2D, raw: Pt[], width: number, tOf: (u: number) => number, rnd: () => number) {
  const pts = resample(raw, 2.5);
  const n = pts.length;
  if (n < 2) return;
  const nor = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(n - 1, i + 1)]!;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  });
  const wOf = (i: number) => {
    const u = i / (n - 1);
    const press = 0.78 + 0.3 * Math.sin(Math.PI * Math.min(1, u * 1.2));
    const taper = Math.min(1, (u + 0.02) / 0.06) * (0.55 + 0.45 * Math.min(1, (1 - u) / 0.12));
    return width * press * taper;
  };
  // time channel: the whole stroke width, darkest (earliest) wins
  tc.lineCap = 'round';
  for (let i = 1; i < n; i++) {
    const v = Math.min(254, Math.ceil(1 + 253 * tOf((i - 1) / (n - 1)) + 0.5)); // (rounded late, never early)
    tc.strokeStyle = `rgb(${v},${v},${v})`;
    tc.lineWidth = wOf(i) * 1.15 + 3;
    tc.beginPath(); tc.moveTo(pts[i - 1]!.x, pts[i - 1]!.y); tc.lineTo(pts[i]!.x, pts[i]!.y); tc.stroke();
  }
  // coverage: a soft body plus bristles with dry-brush gaps toward the end
  cv.lineCap = 'round';
  cv.globalAlpha = 0.55;
  cv.strokeStyle = '#fff';
  for (let i = 1; i < n; i++) {
    cv.lineWidth = wOf(i) * 0.9;
    cv.beginPath(); cv.moveTo(pts[i - 1]!.x, pts[i - 1]!.y); cv.lineTo(pts[i]!.x, pts[i]!.y); cv.stroke();
  }
  const K = 11;
  for (let j = 0; j < K; j++) {
    const o = (j / (K - 1) - 0.5) * 2 * 0.92;
    const bw = 0.16 + rnd() * 0.16, ba = 0.55 + rnd() * 0.45, ph = rnd() * 100, fr = 0.05 + rnd() * 0.08;
    cv.globalAlpha = ba;
    cv.lineWidth = Math.max(1.2, width * bw);
    cv.beginPath();
    let pen = false;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const dry = Math.sin(i * fr + ph) * 0.5 + 0.5;
      const gap = dry > 0.9 - 0.5 * Math.max(0, u - 0.55) - 0.25 * Math.abs(o);
      const w = wOf(i) * 0.5;
      const x = pts[i]!.x + nor[i]!.x * o * w, y = pts[i]!.y + nor[i]!.y * o * w;
      if (gap) { pen = false; continue; }
      if (!pen) { cv.moveTo(x, y); pen = true; } else cv.lineTo(x, y);
    }
    cv.stroke();
  }
  cv.globalAlpha = 1;
}

function pageCanvas(spec: BoardSpec) {
  const cv = document.createElement('canvas');
  cv.width = PW; cv.height = PH;
  const c = cv.getContext('2d')!;
  const r = mulberry32(spec.seed);
  // paper with grain and a little weathering
  c.fillStyle = '#ece6d8'; c.fillRect(0, 0, PW, PH);
  for (let i = 0; i < 9000; i++) {
    c.fillStyle = `rgba(${r() < 0.5 ? '80,70,60' : '255,255,255'},${0.02 + r() * 0.05})`;
    c.fillRect(r() * PW, r() * PH, 1 + r() * 3, 1 + r() * 3);
  }
  // vertical weather streaks
  for (let i = 0; i < 60; i++) {
    const x = r() * PW;
    const g = c.createLinearGradient(0, PH * 0.2, 0, PH);
    g.addColorStop(0, 'rgba(60,55,50,0)'); g.addColorStop(1, `rgba(60,55,50,${0.03 + r() * 0.07})`);
    c.fillStyle = g; c.fillRect(x, PH * 0.2, 2 + r() * 10, PH);
  }
  // header band
  const band = PH * 0.24;
  c.fillStyle = '#a8231c'; c.fillRect(0, 0, PW, band);
  c.fillStyle = 'rgba(0,0,0,0.18)'; c.fillRect(0, band - 6, PW, 6);
  // spiral binding: holes along the top
  for (let x = 60; x < PW; x += 74) {
    c.fillStyle = '#1b1712'; c.beginPath(); c.ellipse(x, 22, 13, 9, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#8a8f96'; c.lineWidth = 5; c.beginPath(); c.arc(x, 4, 16, 0.2, Math.PI - 0.2); c.stroke();
  }
  c.fillStyle = '#f7efe4';
  c.textBaseline = 'alphabetic';
  c.font = font(F.archivo(125, 900), band * 0.62);
  c.fillText(spec.day, 64, band * 0.82);
  c.textAlign = 'right';
  c.font = font(F.archivo(100, 700), band * 0.32);
  c.fillText(spec.month, PW - 64, band * 0.72);
  c.textAlign = 'left';
  // big date numeral
  c.fillStyle = '#26221e';
  c.font = font(F.archivo(87, 900), PH * 0.5);
  c.textAlign = 'center';
  c.fillText(spec.date, PW * 0.19, PH * 0.83);
  c.textAlign = 'left';
  // small print: week number, a thin rule, tear perforation
  c.fillStyle = '#6b6258';
  c.font = font(F.archivo(100, 500), 30);
  c.fillText(`WEEK ${41 + (spec.seed % 3)}`, 76, band + 46);
  c.fillRect(PW * 0.4, band + 60, PW * 0.56, 2);
  for (let x = 0; x < PW; x += 14) { c.fillStyle = 'rgba(40,30,20,0.35)'; c.fillRect(x, band + 2, 7, 3); }
  return cv;
}

function paintCanvases(spec: BoardSpec) {
  const cov = document.createElement('canvas'), tim = document.createElement('canvas');
  cov.width = tim.width = PW; cov.height = tim.height = PH;
  const cv = cov.getContext('2d')!, tc = tim.getContext('2d')!;
  cv.fillStyle = '#000'; cv.fillRect(0, 0, PW, PH);
  tc.fillStyle = '#fff'; tc.fillRect(0, 0, PW, PH);
  tc.globalCompositeOperation = 'darken';
  const r = mulberry32(spec.seed * 31 + 7);
  const allWords = spec.lines.flat();
  const T0 = Math.min(...allWords.map((w) => w.t0), spec.smile[0]);
  const T1 = Math.max(...allWords.map((w) => w.t1), spec.smile[1]);
  const norm = (t: number) => (t - T0) / (T1 - T0);
  // the words: brush script on the right two thirds, one line per row
  const x0 = PW * 0.4, x1 = PW - 70;
  const rows = spec.lines.length;
  const band = PH * 0.24;
  spec.lines.forEach((words, li) => {
    const text = words.map((w) => w.text).join(' ');
    let size = 300;
    let st = strokeText(text, 'script', size);
    const maxW = x1 - x0, maxH = (PH - band - 60) / rows;
    size = Math.min(size * maxW / st.width, maxH * 1.25);
    st = strokeText(text, 'script', size);
    const ox = x0 + (maxW - st.width) / 2;
    const base = band + 40 + maxH * (li + 0.78);
    // char -> word index
    const wordOf: number[] = [];
    let wi = 0;
    Array.from(text).forEach((ch, i, arr) => { if (ch === ' ' && i > 0 && arr[i - 1] !== ' ') wi++; wordOf.push(ch === ' ' ? -1 : wi); });
    // each word's strokes are painted across its sung span
    const wStart: number[] = words.map(() => Infinity), wLen: number[] = words.map(() => 0);
    st.strokes.forEach((_, si) => {
      const w = wordOf[st.charOf[si]!]!;
      if (w < 0) return;
      wStart[w] = Math.min(wStart[w]!, st.startLen[si]!);
      wLen[w]! += st.lens[si]![st.lens[si]!.length - 1] ?? 0;
    });
    const wAcc: number[] = words.map(() => 0);
    st.strokes.forEach((stroke, si) => {
      const w = wordOf[st.charOf[si]!]!;
      if (w < 0) return;
      const L = st.lens[si]![st.lens[si]!.length - 1] ?? 0;
      const a = wAcc[w]!; wAcc[w]! += L;
      const ww = words[w]!;
      const pts = stroke.map((p) => ({ x: ox + p.x, y: base + p.y }));
      brush(cv, tc, pts, size * 0.075, (u) => norm(ww.t0 + ((a + u * L) / Math.max(1, wLen[w]!)) * (ww.t1 - ww.t0)), r);
    });
  });
  // the smile over the date numeral: a wobbly arc and two eyes
  const sx = PW * 0.19, sy = PH * 0.6, sr = PH * 0.33;
  const [s0, s1] = spec.smile;
  // the face: one loose circle, started at the top-left and overshooting a little
  const face: Pt[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = -2.2 + (i / 64) * (Math.PI * 2 + 0.35);
    const rr = sr * (1 + 0.035 * Math.sin(i * 0.7 + spec.seed));
    face.push({ x: sx + Math.cos(a) * rr * 1.08, y: sy + Math.sin(a) * rr });
  }
  brush(cv, tc, face, sr * 0.14, (u) => norm(s0 + (s1 - s0) * 0.45 * u), r);
  const eye = (ex: number) => [{ x: ex, y: sy - sr * 0.62 }, { x: ex + 3, y: sy - sr * 0.42 }];
  brush(cv, tc, eye(sx - sr * 0.4), sr * 0.15, (u) => norm(s0 + (s1 - s0) * (0.45 + 0.08 * u)), r);
  brush(cv, tc, eye(sx + sr * 0.4), sr * 0.15, (u) => norm(s0 + (s1 - s0) * (0.53 + 0.08 * u)), r);
  const arc: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const a = Math.PI * (0.16 + 0.68 * (i / 40));
    arc.push({ x: sx - Math.cos(a) * sr * 0.66 + (r() - 0.5) * 2, y: sy + sr * 0.32 + Math.sin(a) * sr * 0.38 + (r() - 0.5) * 2 });
  }
  brush(cv, tc, arc, sr * 0.15, (u) => norm(s0 + (s1 - s0) * (0.62 + 0.38 * u)), r);
  // merge into one RGBA: R coverage, G time
  const out = document.createElement('canvas');
  out.width = PW; out.height = PH;
  const o = out.getContext('2d')!;
  const id = o.createImageData(PW, PH);
  const a = cv.getImageData(0, 0, PW, PH).data, b = tc.getImageData(0, 0, PW, PH).data;
  for (let i = 0; i < PW * PH; i++) { id.data[i * 4] = a[i * 4]!; id.data[i * 4 + 1] = b[i * 4]!; id.data[i * 4 + 2] = 0; id.data[i * 4 + 3] = 255; }
  o.putImageData(id, 0, 0);
  return { canvas: out, T0, T1 };
}

export class CalendarBoard extends THREE.Group {
  u: Record<string, THREE.IUniform>;
  T0: number; T1: number;
  lamps: THREE.Mesh;
  cones: THREE.Mesh;
  coneU = { k: { value: 1 } };
  floodLocal: THREE.Vector3[] = [];

  constructor(public spec: BoardSpec) {
    super();
    const page = canvasTex(pageCanvas(spec), { aniso: 16 });
    const { canvas, T0, T1 } = paintCanvases(spec);
    this.T0 = T0; this.T1 = T1;
    const paint = canvasTex(canvas, { srgb: false, aniso: 16 });
    this.u = { ...HU, page: { value: page }, paint: { value: paint }, prog: { value: 0 }, paintCol: { value: C('#b6ff6a', 1) }, flood: { value: 1 } };
    const face = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: HW_GLSL + /* glsl */ `
        uniform sampler2D page, paint; uniform float prog, flood; uniform vec3 paintCol;
        varying vec2 vUv; varying vec3 vW;
        void main() {
          vec3 pg = texture2D(page, vUv).rgb;
          vec4 pt = texture2D(paint, vUv);
          float tt = (pt.g * 255.0 - 1.0) / 253.0;
          float vis = pt.r * smoothstep(tt, tt + 0.006, prog) * step(pt.g, 0.996);
          float wet = vis * exp(-max(prog - tt, 0.0) * 45.0);
          // three floodlights from below: bright fans on the lower half, falling off upward
          float fl = 0.0;
          for (int i = 0; i < 3; i++) { float cx = 0.17 + 0.33 * float(i); fl += exp(-pow((vUv.x - cx) / 0.2, 2.0)) * (0.35 + 0.65 * exp(-vUv.y * 1.3)); }
          vec3 lit = pg * (vec3(1.0, 0.93, 0.82) * fl * 0.16 * flood + uAmbHi * 2.0 + hwHead(vW, vec3(0.0, 0.0, 1.0)) * 0.8);
          vec3 c = mix(lit, paintCol * (1.6 + 5.0 * wet), clamp(vis * 1.15, 0.0, 1.0));
          gl_FragColor = vec4(hwFog(c, vW, cameraPosition), 1.0);
        }`,
    });
    const faceM = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), face);
    const yC = 6.3;
    faceM.position.set(0, yC, 0.12);
    // frame, back, legs, catwalk, flood arms
    const steel = litMat({ color: C('#6d747e', 0.45), rough: 0.5, metal: 0.6, spec: 0.7, grime: 0.6 });
    const parts: THREE.BufferGeometry[] = [];
    parts.push(boxAt(BOARD_W + 0.4, BOARD_H + 0.4, 0.2, 0, yC, 0));
    for (const x of [-BOARD_W * 0.28, BOARD_W * 0.28]) parts.push(boxAt(0.55, yC, 0.55, x, yC / 2, -0.5));
    parts.push(boxAt(BOARD_W + 0.6, 0.08, 1.2, 0, yC - BOARD_H / 2 - 0.35, 0.65));
    for (let i = 0; i <= 12; i++) parts.push(boxAt(0.035, 0.45, 0.035, -BOARD_W / 2 + (BOARD_W * i) / 12, yC - BOARD_H / 2 - 0.12, 1.2));
    parts.push(boxAt(BOARD_W + 0.6, 0.04, 0.04, 0, yC - BOARD_H / 2 + 0.1, 1.2));
    const lampPos: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const x = -BOARD_W / 2 + BOARD_W * (0.17 + 0.33 * i);
      const a = new THREE.Vector3(x, yC - BOARD_H / 2 - 0.3, 0.6), b = new THREE.Vector3(x, yC - BOARD_H / 2 - 0.1, 1.9);
      parts.push(rod(a, b, 0.04, 0.04, 6));
      parts.push(boxAt(0.6, 0.18, 0.4, x, b.y + 0.05, b.z, 0, 0, -0.9));
      lampPos.push(b);
    }
    this.add(new THREE.Mesh(merge(parts), steel), faceM);
    // flood lenses and their haze fans
    const lg = merge(lampPos.map((p) => { const g = new THREE.PlaneGeometry(0.5, 0.3); g.rotateX(-Math.PI / 2 + 0.9); g.translate(p.x, p.y + 0.16, p.z - 0.05); return g; }));
    this.lamps = new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: C('#fff1d6', 6) }));
    const cg = merge(lampPos.map((p) => {
      const g = new THREE.CylinderGeometry(3.0, 0.25, BOARD_H * 1.05, 20, 1, true);
      g.rotateX(-0.28); g.translate(p.x, p.y + BOARD_H * 0.52, p.z - 0.8);
      return g;
    }));
    this.cones = new THREE.Mesh(cg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { ...this.coneU },
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vW; varying float vY; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vY = uv.y; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `uniform float k; varying vec3 vN; varying vec3 vW; varying float vY;
        void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(abs(dot(normalize(vN), V)), 2.0);
          float d = length(vW - cameraPosition);
          gl_FragColor = vec4(vec3(1.0, 0.9, 0.75) * 0.035 * f * pow(1.0 - vY, 1.5) * smoothstep(1.0, 0.9, 1.0 - vY) * k * smoothstep(2.0, 8.0, d), 1.0); }`,
    }));
    this.add(this.lamps, this.cones);
    this.floodLocal = lampPos.map((p) => p.clone().add(new THREE.Vector3(0, 0.3, 0.15)));
  }

  /** World positions of the floodlights (the moths fly round them). */
  floodSpots() {
    this.updateMatrixWorld(true);
    return this.floodLocal.map((p) => this.localToWorld(p.clone()));
  }

  update(t: number) {
    this.u.prog!.value = (t - this.T0) / (this.T1 - this.T0);
  }
}
