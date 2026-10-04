// Lyrics inside the `train` scene's world: letters wiped by a finger into the condensation on a window (the
// wiped strokes show the city sharp through the milky fog), an amber dot-matrix info display, the LED line map
// whose stops are named by the words as they are sung, letters of small lights hanging in the car, and canvas
// "paint" with per-word light levels (the stair risers).
import * as THREE from 'three';
import type { Line } from '../../engine/lyrics';
import { F, font } from '../../engine/type';
import { LightTrail, lineText, sampleStrokeText } from '../lib/lightpaint';
import type { StrokeFontName } from '../../engine/stroke';
import { GlowPoints } from '../lib/points';
import { flickerOn } from '../lib/neon';
import { hash } from '../../engine/util';

/** Some of a line's words, usable with LightTrail.writtenAt. */
export function subLine(l: Line, a: number, b: number): Line {
  return { ...l, words: l.words.slice(a, b), text: l.words.slice(a, b).map((w) => w.w).join(' ') };
}

const RIBBON_FLAT = /* glsl */ `
  attribute vec3 aTan; attribute float aSide, aAlong, aCap;
  uniform float width;
  varying float vSide, vAlong, vCap; varying vec3 vLP;
  void main() {
    vLP = position;
    vec2 t = aTan.xy; float tl = length(t); t = tl > 1e-6 ? t / tl : vec2(1.0, 0.0);
    vec3 p = position + vec3(-t.y, t.x, 0.0) * aSide * width + vec3(t, 0.0) * aCap * width;
    vSide = aSide; vAlong = aAlong; vCap = aCap;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

// ------------------------------------------------------------------------------------------------- fog writing

/**
 * Condensation on a window with words wiped into it by a finger: `fog` is a milky layer on the glass; each
 * row is a ribbon drawn first as a depth mask (so the fog is not drawn where the finger wiped) and again as
 * the wet bright edges of the wipe. Local frame: x along the glass, y up, the fog at z = 0, facing +z.
 */
export class FogWriting extends THREE.Group {
  fog: THREE.Mesh;
  fogMat: THREE.ShaderMaterial;
  rows: { mask: LightTrail; edge: THREE.Mesh; line: Line }[] = [];

  constructor(w: number, h: number, rows: { line: Line; x: number; y: number }[], size: number, fontName: StrokeFontName = 'script') {
    super();
    this.fogMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uC: { value: new THREE.Color(0.05, 0.06, 0.075) }, uDens: { value: 1.0 }, uSize: { value: new THREE.Vector2(w, h) }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC; uniform float uDens; uniform vec2 uSize; uniform float uTime; varying vec2 vUv;
        float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hsh(i), hsh(i + vec2(1, 0)), f.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), f.x), f.y); }
        void main() {
          vec2 p = vUv * uSize;
          float n = 0.6 * n2(p * 6.0) + 0.4 * n2(p * 17.0);
          // thicker toward the bottom and the frame, thinner in a patch where breath has gone
          vec2 e = min(vUv, 1.0 - vUv) * uSize;
          float edge = smoothstep(0.0, 0.25, min(e.x, e.y));
          float dens = uDens * (0.72 + 0.28 * n) * (0.85 + 0.15 * (1.0 - vUv.y)) * (0.6 + 0.4 * edge);
          // droplets: tiny bright beads in the mist
          vec2 g = p * 160.0; vec2 id = floor(g);
          float b = smoothstep(0.3, 0.1, length(fract(g) - 0.5)) * step(0.985, hsh(id));
          vec3 c = uC * (0.8 + 0.4 * n) + uC * 1.2 * b;
          gl_FragColor = vec4(c, clamp(dens, 0.0, 0.95));
        }`,
    });
    this.fog = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.fogMat);
    this.fog.renderOrder = -2;
    this.add(this.fog);
    const maskMat = new THREE.ShaderMaterial({
      transparent: true,
      colorWrite: false,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: { width: { value: size * 0.034 }, reveal: { value: 0 }, gain: { value: 1 }, tipLen: { value: 0.1 }, seed: { value: 0 }, color: { value: new THREE.Color() } },
      vertexShader: RIBBON_FLAT,
      fragmentShader: /* glsl */ `
        uniform float reveal; varying float vSide, vAlong, vCap;
        void main() { if (vAlong > reveal) discard; if (vSide * vSide + vCap * vCap > 1.0) discard; gl_FragColor = vec4(0.0); }`,
    });
    rows.forEach((r, i) => {
      const mask = LightTrail.text(lineText(r.line), fontName, size, { width: size * 0.034, seed: i * 5 + 1 });
      mask.material = maskMat.clone();
      mask.renderOrder = -3;
      mask.position.set(r.x, r.y, 0.004);
      const edgeMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: { width: { value: size * 0.046 }, reveal: { value: 0 }, uC: { value: new THREE.Color(0.16, 0.19, 0.24) }, uK: { value: 1 }, seed: { value: i * 3.7 } },
        vertexShader: RIBBON_FLAT,
        fragmentShader: /* glsl */ `
          uniform float reveal, uK, seed; uniform vec3 uC; varying float vSide, vAlong, vCap;
          float hsh(float x) { return fract(sin(x * 127.1 + seed) * 43758.5453); }
          void main() {
            if (vAlong > reveal) discard;
            float r = sqrt(vSide * vSide + vCap * vCap);
            if (r > 1.0) discard;
            // a wet ridge where the finger pushed the mist aside; beads along it
            // a soft wet ridge where the finger pushed the mist aside (stronger on the lower side), beads along it
            float ridge = smoothstep(0.72, 0.9, r) * smoothstep(1.0, 0.9, r) * (vSide < 0.0 ? 0.55 : 0.2);
            float bead = step(0.86, hsh(floor(vAlong * 260.0) + sign(vSide) * 3.0)) * smoothstep(0.75, 0.9, r);
            float fresh = exp(-(reveal - vAlong) * 12.0);
            vec3 c = uC * (ridge * (0.6 + 1.0 * fresh) + bead * 1.2);
            gl_FragColor = vec4(c * uK, 1.0);
          }`,
      });
      const edge = new THREE.Mesh(mask.geometry, edgeMat);
      edge.position.copy(mask.position).setZ(0.006);
      edge.renderOrder = -1;
      this.rows.push({ mask, edge, line: r.line });
      this.add(mask, edge);
    });
  }

  /** Write at song time t (each word as it is sung); `light` = the brightness of the light in the car. */
  update(t: number, light: number) {
    for (const r of this.rows) {
      const rev = r.mask.writtenAt(r.line, t, 0.45);
      r.mask.reveal = rev;
      (r.edge.material as THREE.ShaderMaterial).uniforms.reveal!.value = rev;
      (r.edge.material as THREE.ShaderMaterial).uniforms.uK!.value = 0.4 + 0.8 * light;
    }
    this.fogMat.uniforms.uC!.value.setRGB(0.1, 0.115, 0.145).multiplyScalar(0.55 + 0.9 * light);
    this.fogMat.uniforms.uTime!.value = t;
  }

  /** The finger: where the wipe is (local) at song time t, or null when nothing is being written. */
  pen(t: number) {
    for (const r of this.rows) {
      const w0 = r.line.words[0]!.start, w1 = r.line.words.at(-1)!;
      if (t < w0 || t > Math.min(w1.end, w1.start + 0.45)) continue;
      const rev = r.mask.writtenAt(r.line, t, 0.45);
      if (rev >= r.mask.total - 1e-3) continue;
      return r.mask.pointAt(rev).add(r.mask.position);
    }
    return null;
  }
}

// ------------------------------------------------------------------------------------------------- 5×7 LED font

const GLYPHS: Record<string, string> = {
  A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.',
  C: '.###.#...##....#....#....#...#.###.', D: '###..#..#.#...##...##...##..#.###..',
  E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#',
  I: '.###...#....#....#....#....#...###.', J: '..###...#....#....#....#.#..#..##..',
  K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#',
  O: '.###.#...##...##...##...##...#.###.', P: '####.#...##...#####.#....#....#....',
  Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..',
  U: '#...##...##...##...##...##...#.###.', V: '#...##...##...##...##...#.#.#...#..',
  W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####',
  '’': '..#....#...#.......................', ' ': '...................................',
  '>': '#.....#.....#.....#...#...#...#....', '1': '..#...##....#....#....#....#...###.',
  '4': '...#...##..#.#.#..#.#####...#....#.', '7': '#####....#...#...#...#....#....#...',
};

/**
 * An amber dot-matrix display: pages of text rows (5×7 cells), each character tagged with a word id whose level
 * is set per frame (`lv[id]`, 0 = dark). Plane in XY facing +z, `w` × `h` m.
 */
export class DotMatrix extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  lv = new Float32Array(16);
  page = 0;

  constructor(w: number, pages: { text: string; ids: number[] }[][], cols: number, color = new THREE.Color(1.0, 0.45, 0.08)) {
    const rowsN = Math.max(...pages.map((p) => p.length));
    const R = rowsN * 8 + 1;
    const data = new Uint8Array(cols * R * pages.length * 4);
    pages.forEach((rows, pi) => rows.forEach((row, ri) => {
      const chars = Array.from(row.text.toUpperCase().replace(/'/g, '’'));
      const x0 = Math.floor((cols - (chars.length * 6 - 1)) / 2);
      chars.forEach((ch, ci) => {
        const bits = (GLYPHS[ch] ?? GLYPHS[' ']!).padEnd(35, '.');
        for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
          if (bits[r * 5 + c] !== '#') continue;
          const x = x0 + ci * 6 + c, y = R - 1 - (1 + ri * 8 + r) + pi * R;
          if (x < 0 || x >= cols) continue;
          const i = (y * cols + x) * 4;
          data[i] = 255; data[i + 1] = row.ids[ci] ?? 0; data[i + 3] = 255;
        }
      });
    }));
    const tex = new THREE.DataTexture(data, cols, R * pages.length, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    const h = (w * R) / cols;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uDots: { value: tex }, uLv: { value: new Float32Array(16) }, uPage: { value: 0 }, uC: { value: color.clone() }, uK: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uDots; uniform float uLv[16]; uniform float uPage, uK; uniform vec3 uC; varying vec2 vUv;
        void main() {
          vec2 g = vUv * vec2(${cols.toFixed(1)}, ${R.toFixed(1)});
          vec2 id = floor(g), f = fract(g) - 0.5;
          vec4 d = texture2D(uDots, (vec2(id.x, id.y + uPage * ${R.toFixed(1)}) + 0.5) / vec2(${cols.toFixed(1)}, ${(R * pages.length).toFixed(1)}));
          int wi = int(d.g * 255.0 + 0.5);
          float lv = 0.0;
          for (int i = 0; i < 16; i++) if (i == wi) lv = uLv[i];
          float on = d.r * lv;
          float r = length(f);
          float dotm = smoothstep(0.46, 0.32, r), core = smoothstep(0.3, 0.0, r);
          vec3 c = vec3(0.012, 0.007, 0.004) * dotm + uC * on * (dotm * 1.1 + core * 2.2) + uC * on * 0.08;
          gl_FragColor = vec4(c * uK, 1.0);
        }`,
    });
    super(new THREE.PlaneGeometry(w, h), mat);
  }

  sync() {
    (this.material.uniforms.uLv!.value as Float32Array).set(this.lv);
    this.material.uniforms.uPage!.value = this.page;
  }
}

// ------------------------------------------------------------------------------------------------- the line map

/**
 * The car's LED line map: a route with stops; the stops' names are words of a sung line, lit (backlit
 * print) as each word is sung, and the "you are here" light runs from stop to stop. Plane XY facing +z.
 */
export class LineMap extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  boxes: THREE.Vector4[] = [];
  stopsU: number[] = [];

  constructor(public w: number, public h: number, stops: { words: string[]; above: boolean }[]) {
    const PX = 2400, PY = Math.round((PX * h) / w);
    const cv = document.createElement('canvas');
    cv.width = PX; cv.height = PY;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#000'; c.fillRect(0, 0, PX, PY);
    const ly = PY * 0.72, margin = PX * 0.03;
    // the route line (R: print), with arrows at the ends
    c.fillStyle = 'rgb(255,0,0)';
    c.fillRect(margin * 0.5, ly - PY * 0.045, PX - margin, PY * 0.09);
    const boxes: THREE.Vector4[] = [];
    const stopsU: number[] = [];
    let px = Math.round(PY * 0.36);
    const gapW = PX * 0.035;
    const measure = () => { c.font = font(F.archivo(62, 800), px); const ws = stops.map((s) => c.measureText(s.words.join(' ')).width); return { ws, total: ws.reduce((a, b) => a + b, 0) + gapW * (stops.length - 1) }; };
    let { ws: widths, total } = measure();
    if (total > PX * 0.94) { px = Math.floor(px * (PX * 0.94) / total); ({ ws: widths, total } = measure()); }
    let sx = (PX - total) / 2;
    stops.forEach((s, i) => {
      const x = sx + widths[i]! / 2;
      sx += widths[i]! + gapW;
      stopsU.push(x / PX);
      c.beginPath(); c.arc(x, ly, PY * 0.11, 0, Math.PI * 2); c.fillStyle = 'rgb(255,0,0)'; c.fill();
      c.beginPath(); c.arc(x, ly, PY * 0.065, 0, Math.PI * 2); c.fillStyle = 'rgb(0,0,0)'; c.fill();
      // the name (G) above the stop, one box per word
      let wx = x - widths[i]! / 2;
      const by = ly - PY * 0.16;
      s.words.forEach((wd) => {
        const ww = c.measureText(wd).width;
        c.fillStyle = 'rgb(0,255,0)';
        c.fillText(wd, wx, by);
        boxes.push(new THREE.Vector4((wx - 4) / PX, 1 - (by + 8) / PY, (wx + ww + 4) / PX, 1 - (by - px * 0.8) / PY));
        wx += ww + c.measureText(' ').width;
      });
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 8;
    while (boxes.length < 12) boxes.push(new THREE.Vector4());
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uBox: { value: boxes }, uLv: { value: new Float32Array(12) }, uHere: { value: -1 }, uPrint: { value: 1 }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform vec4 uBox[12]; uniform float uLv[12]; uniform float uHere, uPrint, uTime; varying vec2 vUv;
        void main() {
          vec4 s = texture2D(uTex, vUv);
          float lv = 0.0;
          for (int i = 0; i < 12; i++) { vec4 b = uBox[i]; if (vUv.x > b.x && vUv.x < b.z && vUv.y > b.y && vUv.y < b.w) lv = uLv[i]; }
          vec3 c = vec3(0.012, 0.013, 0.016);
          c += vec3(1.0, 0.42, 0.1) * s.r * 0.22 * uPrint;
          c += vec3(1.0, 0.97, 0.92) * s.g * lv * 1.6;
          // you are here: a blinking red LED on the line
          float d = length((vUv - vec2(uHere, 0.28)) * vec2(${(w / h).toFixed(3)}, 1.0));
          float blink = 0.65 + 0.35 * step(0.5, fract(uTime * 2.5));
          c += vec3(1.0, 0.1, 0.05) * smoothstep(0.11, 0.04, d) * 3.0 * blink * step(0.0, uHere);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    super(new THREE.PlaneGeometry(w, h), mat);
    this.boxes = boxes;
    this.stopsU = stopsU;
  }
}

// ------------------------------------------------------------------------------------------------- mote letters

/**
 * Letters of small lights hanging in the air (points along a stroke font), each word lighting as it is sung,
 * sweeping through the word. Rows in the local XY plane (centred on x, baselines at row.y).
 */
export class MoteLetters extends GlowPoints {
  pts: { x: number; y: number; t: number; seed: number; word: number }[] = [];

  constructor(rows: { line: Line; y: number }[], fontName: StrokeFontName, size: number, spacing: number, pointSize = 0.02) {
    const pts: MoteLetters['pts'] = [];
    let wbase = 0;
    for (const row of rows) {
      const S = sampleStrokeText(lineText(row.line), fontName, size, spacing);
      const count = new Map<number, number>(), rank: number[] = [];
      S.word.forEach((w) => { rank.push(count.get(w) ?? 0); count.set(w, (count.get(w) ?? 0) + 1); });
      S.pts.forEach((p, i) => {
        const w = row.line.words[S.word[i]!]!;
        const dur = Math.min(0.3, Math.max(0.12, (w.end - w.start) * 0.7));
        const n = count.get(S.word[i]!)!;
        pts.push({ x: p.x, y: p.y + row.y, t: w.start + (dur * rank[i]!) / Math.max(1, n - 1), seed: pts.length, word: wbase + S.word[i]! });
      });
      wbase += row.line.words.length;
    }
    super(pts.length, pointSize);
    this.pts = pts;
  }

  /** Light the letters at t: colour `c`, gain `k`; the group's matrix places them. */
  update(t: number, c: THREE.Color, k: number, warm: THREE.Color, warmK: number) {
    let n = 0;
    const cc = new THREE.Color();
    for (const p of this.pts) {
      if (t < p.t) continue;
      const a = t - p.t;
      const on = Math.min(1, a / 0.05) * (1 + 2.0 * Math.exp(-a * 7));
      const tw = 0.85 + 0.15 * Math.sin(t * 6 + p.seed * 1.7);
      cc.copy(c).lerp(warm, warmK * (0.6 + 0.4 * hash(p.seed, 2)));
      this.set(n++, p.x + 0.004 * Math.sin(t * 1.3 + p.seed), p.y + 0.004 * Math.cos(t * 1.1 + p.seed * 0.7), 0, cc, on * tw * k, 0.8 + 0.5 * hash(p.seed, 7));
    }
    this.commit(n);
  }
}

// ------------------------------------------------------------------------------------------------- painted words

/**
 * Words painted in light onto a surface through a canvas texture: rows of words (Archivo black), each word a
 * uv box with its own level. `glowTex` blurs the same layout for the halo.
 */
export function wordCanvas(rows: { words: string[]; size: number }[], W: number, H: number, family = F.archivo(100, 900)) {
  const boxes: THREE.Vector4[] = [];
  const draw = (c: CanvasRenderingContext2D, blur: number) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
    if (blur) c.filter = `blur(${blur}px)`;
    const totalH = rows.reduce((a, r) => a + r.size, 0) * 1.12;
    let y = (H - totalH) / 2;
    for (const r of rows) {
      y += r.size * 1.0;
      c.font = font(family, r.size);
      const text = r.words.join(' ');
      let x = (W - c.measureText(text).width) / 2;
      for (const wd of r.words) {
        const ww = c.measureText(wd).width;
        c.fillStyle = '#fff';
        c.fillText(wd, x, y);
        if (!blur) boxes.push(new THREE.Vector4((x - 10) / W, 1 - (y + r.size * 0.12) / H, (x + ww + 10) / W, 1 - (y - r.size * 0.85) / H));
        x += ww + c.measureText(' ').width;
      }
      y += r.size * 0.12;
    }
    c.filter = 'none';
  };
  const mk = (blur: number) => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    draw(cv.getContext('2d')!, blur);
    const t = new THREE.CanvasTexture(cv);
    t.anisotropy = 8;
    return t;
  };
  const sharp = mk(0), glow = mk(Math.round(rows[0]!.size * 0.18));
  return { sharp, glow, boxes };
}

export { flickerOn };
