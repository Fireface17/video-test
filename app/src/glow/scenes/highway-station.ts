// Highway scene, line 4 ("And I'd pay any cost"): a roadside filling station at dawn. A canopy of white LED
// panels over the pumps, a small shop, and the price pylon: a lightbox header, an amber dot-matrix marquee
// that spells AND I'D PAY as it is sung, and two red LED price windows whose characters spin like drums on
// "pay" and land on ANY and COST.
import * as THREE from 'three';
import { F, font } from '../../engine/type';
import { HU, HW_GLSL, boxAt, litMat, merge } from './highway-common';
import { canvasTex } from './highway-tex';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// ------------------------------------------------------------------------------------------- 5×7 LED font

const GLYPHS: Record<string, string> = {
  '0': '.###.#...##..###.#.###..##...#.###.', '1': '..#...##....#....#....#....#...###.',
  '2': '.###.#...#....#...#...#...#...#####', '3': '#####...#...#.....#.....##...#.###.',
  '4': '...#...##..#.#.#..#.#####...#....#.', '5': '######....####.....#....##...#.###.',
  '6': '..##..#...#....####.#...##...#.###.', '7': '#####....#...#...#...#....#....#...',
  '8': '.###.#...##...#.###.#...##...#.###.', '9': '.###.#...##...#.####....#...#..##..',
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
  '.': '..........................##...##..', '’': '..#....#...#.......................',
  ' ': '...................................', '$': '..#...#####.#...###...#.#####...#..',
};
const ORDER = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.’ $';
const NG = ORDER.length;

let glyphCache: THREE.DataTexture | null = null;
export function ledGlyphs() { return (glyphCache ??= glyphTexture()); }
function glyphTexture() {
  const w = NG * 5, h = 7;
  const data = new Uint8Array(w * h * 4);
  for (let g = 0; g < NG; g++) {
    const bits = (GLYPHS[ORDER[g]!] ?? '').padEnd(35, '.').slice(0, 35);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      const on = bits[r * 5 + c] === '#' ? 255 : 0;
      const i = ((6 - r) * w + g * 5 + c) * 4; // row 0 at the top → v = 1
      data[i] = data[i + 1] = data[i + 2] = on; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
export const glyphIndex = (ch: string) => Math.max(0, ORDER.indexOf(ch === "'" ? '’' : ch.toUpperCase()));

/** A row of dot-matrix LED cells (5×7 each, 1 dot of spacing). pos[i] = drum position (glyph index, float). */
export class LedRow extends THREE.Mesh {
  pos: Float32Array;
  on: Float32Array;
  declare material: THREE.ShaderMaterial;
  constructor(public n: number, cellW: number, color: THREE.Color, glyphs: THREE.Texture) {
    const pos = new Float32Array(16), on = new Float32Array(16);
    const mat = new THREE.ShaderMaterial({
      uniforms: { glyphs: { value: glyphs }, cpos: { value: pos }, con: { value: on }, n: { value: n }, col: { value: color.clone() }, k: { value: 1 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D glyphs; uniform float cpos[16]; uniform float con[16]; uniform float n, k; uniform vec3 col;
        varying vec2 vUv;
        void main() {
          // cell grid: each cell 6 dots wide (5 + gap), 8 dots tall (7 + gap)
          float fx = vUv.x * n * 6.0, fy = (1.0 - vUv.y) * 8.0;
          float ci = floor(fx / 6.0);
          float dx = floor(mod(fx, 6.0)), dy = floor(fy);
          vec2 inDot = vec2(fract(fx), fract(fy)) - 0.5;
          int c = int(ci);
          float p = 0.0, o = 0.0;
          for (int i = 0; i < 16; i++) if (i == c) { p = cpos[i]; o = con[i]; }
          // drum: the visible rows scroll through the glyph strip one LED row at a time
          float srow = floor(p * 8.0 + 0.0001) + dy;
          float g = mod(floor(srow / 8.0), ${NG.toFixed(1)});
          float rr = mod(srow, 8.0);
          float lit = 0.0;
          if (dx < 5.0 && rr < 7.0) lit = texture2D(glyphs, vec2((g * 5.0 + dx + 0.5) / ${(NG * 5).toFixed(1)}, 1.0 - (rr + 0.5) / 7.0)).r;
          lit *= o;
          float r = length(inDot);
          float dotm = smoothstep(0.42, 0.3, r);
          float core = smoothstep(0.3, 0.0, r);
          float isDot = step(dx, 4.5);
          vec3 off = vec3(0.02, 0.012, 0.01) * dotm * isDot;
          vec3 c3 = off + col * lit * (dotm * 0.9 + core * 1.6) * k + col * lit * 0.06 * k;
          gl_FragColor = vec4(c3, 1.0);
        }`,
    });
    super(new THREE.PlaneGeometry(cellW * n, cellW * 8 / 6), mat);
    this.pos = pos; this.on = on;
  }
  setText(s: string) { Array.from(s).forEach((ch, i) => { if (i < 16) this.pos[i] = glyphIndex(ch); }); }
}

function pylonFace() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 2048;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#14181f'; c.fillRect(0, 0, 1024, 2048);
  // header lightbox
  c.fillStyle = '#f2f4f6'; c.fillRect(30, 30, 964, 500);
  c.fillStyle = '#b8231a'; c.fillRect(30, 450, 964, 50);
  c.fillStyle = '#12161c';
  c.font = font(F.archivo(125, 900), 250); c.textAlign = 'center';
  c.fillText('FUEL', 512, 330);
  c.font = font(F.archivo(100, 700), 64); c.fillText('OPEN 24 H', 512, 425);
  // grade labels
  c.fillStyle = '#e9edf2'; c.textAlign = 'left';
  c.font = font(F.archivo(87, 800), 70);
  c.fillText('REGULAR', 60, 1265); c.fillText('DIESEL', 60, 1700);
  c.font = font(F.archivo(100, 500), 40); c.fillStyle = '#9aa3ad';
  c.fillText('PER GALLON', 60, 1320); c.fillText('PER GALLON', 60, 1755);
  return cv;
}

export class Station extends THREE.Group {
  pylon = new THREE.Group();
  marquee: LedRow;
  rows: LedRow[] = [];
  canopyMat: THREE.MeshBasicMaterial;
  faceU: Record<string, THREE.IUniform>;
  pumpMat: THREE.MeshBasicMaterial;
  shopMat: THREE.MeshBasicMaterial;
  fasciaMat: THREE.MeshBasicMaterial;
  /** pylon panel centre heights (world, relative to the pylon base) */
  panelY = 7.0;

  constructor() {
    super();
    const glyphs = ledGlyphs();
    // ---- pylon (at the group origin): legs, a tall panel, LED rows
    const steel = litMat({ color: C('#59616c', 0.45), rough: 0.5, metal: 0.6, spec: 0.7, grime: 0.5 });
    const PWd = 3.4, PHt = 6.8, base = 4.0;
    this.panelY = base + PHt / 2;
    this.pylon.add(new THREE.Mesh(merge([
      boxAt(0.45, base + 0.2, 0.45, -1.1, (base + 0.2) / 2, 0), boxAt(0.45, base + 0.2, 0.45, 1.1, (base + 0.2) / 2, 0),
      boxAt(PWd + 0.3, PHt + 0.3, 0.6, 0, base + PHt / 2, -0.15),
    ]), steel));
    const faceTex = canvasTex(pylonFace(), { aniso: 16 });
    this.faceU = { ...HU, map: { value: faceTex }, box: { value: 1 } };
    const face = new THREE.Mesh(new THREE.PlaneGeometry(PWd, PHt), new THREE.ShaderMaterial({
      uniforms: this.faceU,
      vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: HW_GLSL + /* glsl */ `uniform sampler2D map; uniform float box; varying vec2 vUv; varying vec3 vW;
        void main(){ vec3 a = texture2D(map, vUv).rgb;
          float lightbox = step(0.74, vUv.y) * step(vUv.y, 0.985) * step(0.03, vUv.x) * step(vUv.x, 0.97);
          vec3 spec; vec3 d = hwLight(vW, vec3(0.0, 0.0, 1.0), normalize(cameraPosition - vW), 0.5, 0.0, spec);
          vec3 c = a * d + a * lightbox * box * 1.6 + a * hwHead(vW, vec3(0.0, 0.0, 1.0)) * 2.0;
          gl_FragColor = vec4(hwFog(c, vW, cameraPosition), 1.0); }`,
    }));
    face.position.set(0, base + PHt / 2, 0.16);
    this.pylon.add(face);
    const cell = 0.25;
    this.marquee = new LedRow(12, cell, C('#ffa21e', 2.2), glyphs);
    this.marquee.position.set(0, base + PHt * 0.6, 0.17);
    this.marquee.setText('AND I’D PAY ');
    for (let i = 0; i < 2; i++) {
      const r = new LedRow(4, 0.36, C('#ff2f1c', 2.6), glyphs);
      r.position.set(0.72, base + PHt * (0.4 - 0.32 * i) - 0.05, 0.17);
      this.rows.push(r);
      this.pylon.add(r);
    }
    this.rows[0]!.setText('3.89'); this.rows[1]!.setText('4.05');
    this.pylon.add(this.marquee);
    // housings for the LED windows
    for (const m of [this.marquee, ...this.rows]) {
      const g = m.geometry as THREE.PlaneGeometry;
      const w = g.parameters.width + 0.12, h = g.parameters.height + 0.12;
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: C('#020203') }));
      frame.position.copy(m.position); frame.position.z -= 0.005;
      this.pylon.add(frame);
    }
    // the pylon is double-sided: the same face and LED windows on the back (shared materials, same state)
    const kids = this.pylon.children.slice(1);
    for (const k of kids) {
      const m = k as THREE.Mesh;
      const b = new THREE.Mesh(m.geometry, m.material);
      b.position.set(-m.position.x, m.position.y, -0.3 - m.position.z);
      b.rotation.y = Math.PI;
      this.pylon.add(b);
    }
    this.pylon.rotation.y = -0.75; // (the group turns +0.35: the panel faces the oncoming lanes)
    this.add(this.pylon);

    // ---- canopy, pumps, shop (behind the pylon, further from the road)
    const canopy = new THREE.Group();
    const cw = 34, cd = 18, ch = 5.6;
    canopy.add(new THREE.Mesh(merge([
      boxAt(cw, 1.1, cd, 0, ch + 0.55, 0),
      ...[-11, 0, 11].flatMap((x) => [boxAt(0.5, ch, 0.5, x, ch / 2, -4), boxAt(0.5, ch, 0.5, x, ch / 2, 4)]),
    ]), litMat({ color: C('#d9dde2', 0.5), rough: 0.6, spec: 0.4 })));
    // underside LED panels
    this.canopyMat = new THREE.MeshBasicMaterial({ color: C('#eaf4ff', 4) });
    const panels: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
      const g = new THREE.PlaneGeometry(2.6, 1.2); g.rotateX(Math.PI / 2); g.translate(-cw / 2 + 3 + i * 5.6, ch - 0.01, -cd / 2 + 3 + j * 6); panels.push(g);
    }
    canopy.add(new THREE.Mesh(merge(panels), this.canopyMat));
    // fascia stripe (thin, lit)
    this.fasciaMat = new THREE.MeshBasicMaterial({ color: C('#d8261c', 1.2) });
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(cw, 0.22), this.fasciaMat);
    stripe.position.set(0, ch + 0.35, cd / 2 + 0.01);
    canopy.add(stripe);
    // pumps: 3 islands × 2
    this.pumpMat = new THREE.MeshBasicMaterial({ color: C('#bfe6ff', 1.4) });
    const pumpBodies: THREE.BufferGeometry[] = [], screens: THREE.BufferGeometry[] = [];
    for (const x of [-11, 0, 11]) for (const z of [-2.2, 2.2]) {
      pumpBodies.push(boxAt(0.9, 1.9, 0.6, x, 0.95, z), boxAt(1.6, 0.18, 1.0, x, 0.09, z));
      const s = new THREE.PlaneGeometry(0.5, 0.32); s.translate(x, 1.45, z + 0.31); screens.push(s);
    }
    canopy.add(new THREE.Mesh(merge(pumpBodies), litMat({ color: C('#c9ced6', 0.5), rough: 0.4, spec: 0.8 })));
    canopy.add(new THREE.Mesh(merge(screens), this.pumpMat));
    canopy.position.set(24, 0, -30);
    this.add(canopy);
    // the shop: a low box with a lit window band
    this.shopMat = new THREE.MeshBasicMaterial({ color: C('#ffe2b8', 1.1) });
    const shop = new THREE.Group();
    shop.add(new THREE.Mesh(boxAt(22, 4.2, 10, 0, 2.1, 0), litMat({ color: C('#8c9096', 0.4), rough: 0.8, spec: 0.2 })));
    const win = new THREE.Mesh(new THREE.PlaneGeometry(16, 2.2), this.shopMat);
    win.position.set(0, 1.6, 5.01);
    shop.add(win);
    shop.position.set(30, 0, -56);
    shop.rotation.y = -0.15;
    this.add(shop);
  }

  /** Fraction (0..1) of the sun disc (angular radius ar) visible from `from` past the pylon. */
  sunVisible(from: THREE.Vector3, dir: THREE.Vector3, ar: number) {
    const inv = new THREE.Matrix4().copy(this.pylon.matrixWorld).invert();
    const box = new THREE.Box3(new THREE.Vector3(-1.85, 0, -0.5), new THREE.Vector3(1.85, this.panelY + 3.55, 0.25));
    const ray = new THREE.Ray();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(side, dir).normalize();
    let vis = 0, n = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
      if (i * i + j * j > 5) continue;
      const d = dir.clone().addScaledVector(side, (i / 2) * ar).addScaledVector(up, (j / 2) * ar).normalize();
      ray.origin.copy(from).applyMatrix4(inv);
      ray.direction.copy(d).transformDirection(inv);
      if (!ray.intersectsBox(box)) vis++;
      n++;
    }
    return vis / n;
  }

  /** Canopy pool for the shared lighting (world coordinates), scaled by k. */
  pool(k: number) {
    const p = new THREE.Vector3(24, 5.4, -30).applyMatrix4(this.matrixWorld);
    HU.uPoolPos.value.copy(p);
    HU.uPoolCol.value.copy(C('#e6f2ff', 1.6 * k));
    HU.uPoolR.value = 16;
  }
}

/**
 * An overhead variable-message sign on a slim gantry: a black housing with an amber dot-matrix line and
 * four amber beacons at its corners that flash alternately on the beat.
 */
export class VmsGantry extends THREE.Group {
  row: LedRow;
  beacons: THREE.Mesh[] = [];
  constructor(text: string, steel: THREE.Material) {
    super();
    const n = text.length, cell = 0.78;
    this.row = new LedRow(n, cell, C('#ffab2a', 2.4), ledGlyphs());
    const pw = cell * n, ph = cell * 8 / 6;
    const y = 6.6, x = 6.4;
    this.row.position.set(x, y, 0.36);
    this.row.setText(text);
    const span0 = -0.4, span1 = 15.9;
    this.add(new THREE.Mesh(merge([
      boxAt(0.42, y + 1.2, 0.42, span0, (y + 1.2) / 2, 0), boxAt(0.42, y + 1.2, 0.42, span1, (y + 1.2) / 2, 0),
      boxAt(span1 - span0, 0.3, 0.3, (span0 + span1) / 2, y + 1.15, 0), boxAt(span1 - span0, 0.2, 0.2, (span0 + span1) / 2, y + 0.35, -0.2),
      boxAt(pw + 1.4, ph + 0.9, 0.6, x, y, 0),
    ]), steel));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(pw + 0.5, ph + 0.4), new THREE.MeshBasicMaterial({ color: C('#020203') }));
    face.position.set(x, y, 0.33);
    this.add(face, this.row);
    for (const [bx, by] of [[-1, 1], [1, 1], [-1, -1], [1, -1]] as const) {
      const b = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), new THREE.MeshBasicMaterial({ color: C('#ffa020', 0) }));
      b.position.set(x + bx * (pw / 2 + 0.45), y + by * (ph / 2 + 0.15), 0.34);
      this.add(b);
      this.beacons.push(b);
    }
  }
  /** Beacons: alternate pairs, `ph` = beat phase 0..1, k = on. */
  flash(ph: number, k: number) {
    this.beacons.forEach((b, i) => {
      const on = (i === 0 || i === 3) === ph < 0.5 ? 1 : 0;
      (b.material as THREE.MeshBasicMaterial).color.copy(C('#ffa020', 4 * on * k));
    });
  }
}
