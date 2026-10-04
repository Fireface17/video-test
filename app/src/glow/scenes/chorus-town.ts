// Chorus C: "So sing it like we're never coming down / Loud enough to wake the whole town".
// Lanterns rise out of a sleeping town and never come down; the camera cranes up with them and finds a
// long apartment block whose windows spell the next line word by word as it is sung; on "town" every
// window in town wakes up in a wave.
import * as THREE from 'three';
import type { Frame, SceneCtx } from '../../engine/scene';
import type { Line } from '../../engine/lyrics';
import { clamp, ease, hash, lerp, mulberry32, noise1, prog, pulse, smoothstep } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col, STICKS } from '../lib/palette';
import { NeonLine, flickerOn, splitRows } from '../lib/neon';

// 3x5 pixel font for lit windows: five rows of three cells, top to bottom ('#' = lit)
const FONT: Record<string, string> = {
  A: '.#. #.# ### #.# #.#',
  B: '##. #.# ##. #.# ##.',
  C: '### #.. #.. #.. ###',
  D: '##. #.# #.# #.# ##.',
  E: '### #.. ##. #.. ###',
  F: '### #.. ##. #.. #..',
  G: '### #.. #.# #.# ###',
  H: '#.# #.# ### #.# #.#',
  I: '### .#. .#. .#. ###',
  J: '..# ..# ..# #.# ###',
  K: '#.# #.# ##. #.# #.#',
  L: '#.. #.. #.. #.. ###',
  M: '#.# ### ### #.# #.#',
  N: '##. #.# #.# #.# #.#',
  O: '### #.# #.# #.# ###',
  P: '### #.# ### #.. #..',
  Q: '### #.# #.# ### ..#',
  R: '### #.# ##. #.# #.#',
  S: '### #.. ### ..# ###',
  T: '### .#. .#. .#. .#.',
  U: '#.# #.# #.# #.# ###',
  V: '#.# #.# #.# #.# .#.',
  W: '#.# #.# ### ### #.#',
  X: '#.# #.# .#. #.# #.#',
  Y: '#.# #.# .#. .#. .#.',
  Z: '### ..# .#. #.. ###',
  "'": '.#. .#. ... ... ...',
  ',': '... ... ... .#. #..',
  ' ': '... ... ... ... ...',
};
const glyph = (ch: string) => (FONT[ch] ?? FONT[' ']!).replace(/ /g, '');

const WIN = 0.52; // window pitch on the block (m)

export class Town {
  st = new Stage(40, 0.1, 600);
  wins!: THREE.InstancedMesh; // the block's facade windows
  cols = 0;
  rows = 0;
  /** per facade window: [wordIndex in line (or -1), line (0/1)] */
  winWord: Int16Array = new Int16Array(0);
  winLine: Int8Array = new Int8Array(0);
  houseWins!: THREE.InstancedMesh;
  houseWinDelay: Float32Array = new Float32Array(0);
  lanterns!: THREE.InstancedMesh;
  lanternData: { x: number; z: number; t0: number; v: number; c: THREE.Color; s: number }[] = [];
  l12?: NeonLine;
  private c = new THREE.Color();
  private m = new THREE.Matrix4();

  constructor(private ctx: SceneCtx, private ls: Line[], private n: number) {}

  async init() {
    const S = this.st;
    S.bg.copy(col('night'));
    S.fog(col('dusk', 0.7), 0.012);
    const sky = new THREE.HemisphereLight(new THREE.Color('#3048a0'), new THREE.Color('#05060f'), 0.35);
    const moon = new THREE.DirectionalLight(new THREE.Color('#8fa8ff'), 0.25);
    moon.position.set(-20, 30, 10);
    S.add(sky, moon);
    const rnd = mulberry32(31 + this.n);
    // ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: new THREE.Color('#0b0e1e'), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    S.add(ground);

    // houses: boxes with gable roofs on a street grid, in front of the block
    const houseMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c2244'), roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#141a38'), roughness: 0.8 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    const roofGeo = new THREE.CylinderGeometry(0.72, 0.72, 1, 3); // a triangular prism
    roofGeo.rotateZ(Math.PI / 2);
    roofGeo.rotateX(Math.PI / 2);
    const houses: { x: number; z: number; w: number; d: number; h: number }[] = [];
    for (let gx = -7; gx <= 7; gx++)
      for (let gz = -5; gz <= 2; gz++) {
        if (gx % 4 === 0 || gz === -2) continue; // streets
        if (rnd() < 0.2) continue;
        const w = 1.6 + rnd() * 1.4, d = 1.6 + rnd() * 1.2, h = 1.6 + rnd() * 2.2;
        houses.push({ x: gx * 3.2 + (rnd() - 0.5) * 0.6, z: gz * 3.4 - 6 + (rnd() - 0.5) * 0.6, w, d, h });
      }
    const hb = new THREE.InstancedMesh(box, houseMat, houses.length);
    const hr = new THREE.InstancedMesh(roofGeo, roofMat, houses.length);
    const winGeo = new THREE.PlaneGeometry(0.34, 0.42);
    const hwList: { x: number; y: number; z: number; d: number }[] = [];
    houses.forEach((h, i) => {
      this.m.compose(new THREE.Vector3(h.x, h.h / 2, h.z), new THREE.Quaternion(), new THREE.Vector3(h.w, h.h, h.d));
      hb.setMatrixAt(i, this.m);
      this.m.compose(new THREE.Vector3(h.x, h.h + 0.32, h.z), new THREE.Quaternion(), new THREE.Vector3(h.w * 0.98, 0.9, h.d * 1.05));
      hr.setMatrixAt(i, this.m);
      // windows on the front face, two per floor
      const floors = Math.max(1, Math.floor(h.h / 1.15));
      for (let f = 0; f < floors; f++)
        for (const s of [-1, 1]) hwList.push({ x: h.x + s * h.w * 0.24, y: 0.7 + f * 1.05, z: h.z + h.d / 2 + 0.01, d: 0 });
    });
    S.add(hb, hr);
    this.houseWins = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), hwList.length);
    this.houseWinDelay = new Float32Array(hwList.length);
    hwList.forEach((w, i) => {
      this.m.makeTranslation(w.x, w.y, w.z);
      this.houseWins.setMatrixAt(i, this.m);
      this.houseWins.setColorAt(i, new THREE.Color(0, 0, 0));
      // the wave starts at the block (far) and comes toward the camera
      this.houseWinDelay[i] = clamp((w.z + 30) / 38, 0, 1) * 0.55 + hash(i, 7) * 0.12;
    });
    S.add(this.houseWins);

    // the apartment block: its window grid spells the second line (or both lines if it has room)
    const l13 = this.ls[1];
    const text = (l13?.text ?? '').toUpperCase().replace(/[^A-Z' ,]/g, '');
    const lines = text.length > 22 ? splitAt(text, 2) : [text];
    this.cols = Math.max(...lines.map((s) => s.length * 4 - 1)) + 4;
    this.rows = lines.length * 5 + (lines.length - 1) * 2 + 4 + 6; // (+6 floors under the text, above the houses)
    const blockW = this.cols * WIN, blockH = this.rows * WIN + 1.2;
    const block = new THREE.Mesh(new THREE.BoxGeometry(blockW + 1, blockH, 3), new THREE.MeshStandardMaterial({ color: new THREE.Color('#1a2042'), roughness: 0.9 }));
    block.position.set(0, blockH / 2, -32);
    S.add(block);
    const bwGeo = new THREE.PlaneGeometry(WIN * 0.72, WIN * 0.78);
    this.wins = new THREE.InstancedMesh(bwGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), this.cols * this.rows);
    this.winWord = new Int16Array(this.cols * this.rows).fill(-1);
    this.winLine = new Int8Array(this.cols * this.rows);
    // which word each character belongs to
    const wordAt: number[][] = lines.map(() => []);
    let wi = 0;
    lines.forEach((s, li) => {
      for (let k = 0; k < s.length; k++) {
        wordAt[li]!.push(s[k] === ' ' ? -1 : wi);
        if (s[k] === ' ' && k > 0 && s[k - 1] !== ' ') wi++;
      }
      wi++;
    });
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        this.m.makeTranslation((c - (this.cols - 1) / 2) * WIN, blockH - 0.6 - (r + 0.5) * WIN, -32 + 1.51);
        this.wins.setMatrixAt(i, this.m);
        this.wins.setColorAt(i, new THREE.Color(0, 0, 0));
        // text pixel?
        const tr = r - 2;
        const li = Math.floor(tr / 7), gr = tr % 7;
        if (tr < 0 || li >= lines.length || gr >= 5) continue;
        const s = lines[li]!;
        const x0 = Math.floor((this.cols - (s.length * 4 - 1)) / 2);
        const cc = c - x0;
        if (cc < 0 || cc >= s.length * 4) continue;
        const ch = Math.floor(cc / 4), gc = cc % 4;
        if (gc === 3) continue;
        if (glyph(s[ch]!)[gr * 3 + gc] === '#') { this.winWord[i] = wordAt[li]![ch]!; this.winLine[i] = li; }
      }
    S.add(this.wins);

    // lanterns
    const lgeo = new THREE.SphereGeometry(1, 12, 8);
    this.lanterns = new THREE.InstancedMesh(lgeo, new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true }), 46);
    const l12 = this.ls[0];
    const t0 = l12 ? l12.start - 0.8 : 0;
    for (let i = 0; i < 46; i++) {
      const k = STICKS[i % STICKS.length]!;
      this.lanternData.push({ x: (rnd() - 0.5) * 40, z: -28 + rnd() * 22, t0: t0 + rnd() * 1.6, v: 3.4 + rnd() * 3.0, c: col(this.n === 3 ? 'gold' : k, 1), s: 0.3 + rnd() * 0.3 });
    }
    S.add(this.lanterns);

    if (l12) {
      this.l12 = new NeonLine(l12, splitRows(l12, 2), { font: 'script', size: 1.25, color: col('white', 2), leading: 1.35 });
      S.add(this.l12);
    }
  }

  render(f: Frame, segStart: number, segEnd: number, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, [l12, l13] = this.ls;
    const main = col(this.n === 2 ? 'phosphor' : this.n === 3 ? 'gold' : 'pink', 1);
    const second = l13?.start ?? segEnd;
    // facade windows: each word's pixels flicker on when the word is sung; a few sleepy windows elsewhere
    for (let i = 0; i < this.wins.count; i++) {
      const wi = this.winWord[i]!;
      if (wi >= 0 && l13) {
        const w = l13.words[wi];
        const on = w ? flickerOn(t, w.start, wi) : 0;
        this.c.copy(main).multiplyScalar(on * 2.4);
      } else {
        const sleepy = hash(i, 3) > 0.94 ? 0.05 : 0;
        const wake = l13 ? smoothstep(l13.end - 0.2, l13.end + 0.6, t) * (hash(i, 9) > 0.55 ? 0.35 : 0.08) : 0;
        this.c.setRGB(1, 0.75, 0.45).multiplyScalar(sleepy + wake);
      }
      this.wins.setColorAt(i, this.c);
    }
    this.wins.instanceColor!.needsUpdate = true;
    // houses wake up in a wave on "town"
    const town = l13?.words.find((w) => /town/i.test(w.w));
    for (let i = 0; i < this.houseWins.count; i++) {
      const on = town ? flickerOn(t, town.start + this.houseWinDelay[i]!, i) : 0;
      const warm = hash(i, 5);
      this.c.setRGB(1, 0.72 + 0.2 * warm, 0.4 + 0.3 * warm).multiplyScalar(on * (0.9 + 0.8 * hash(i, 6)));
      if (hash(i, 8) > 0.7) this.c.copy(col(STICKS[i % 4]!, on * 1.3));
      this.houseWins.setColorAt(i, this.c);
    }
    this.houseWins.instanceColor!.needsUpdate = true;
    // lanterns rise forever
    const q = new THREE.Quaternion();
    this.lanternData.forEach((L, i) => {
      const dt = Math.max(0, t - L.t0);
      const y = 1.5 + dt * L.v + 0.3 * Math.sin(dt * 1.7 + i);
      const k = smoothstep(0, 0.6, dt) * (0.85 + 0.15 * noise1(t * 2 + i, i));
      this.m.compose(new THREE.Vector3(L.x + noise1(t * 0.3, i) * 1.2, y, L.z), q, new THREE.Vector3(L.s, L.s * 1.2, L.s).multiplyScalar(k > 0 ? 1 : 0.0001));
      this.lanterns.setMatrixAt(i, this.m);
      this.lanterns.setColorAt(i, this.c.copy(L.c).multiplyScalar(2.2 * k));
    });
    this.lanterns.instanceMatrix.needsUpdate = true;
    this.lanterns.instanceColor!.needsUpdate = true;

    // camera: from the street looking up at the rising lanterns, craning up to face the block
    const up = ease.inOutCubic(prog(t, second - 1.4, second + 0.2));
    const p1 = prog(t, segStart, second);
    const pos = new THREE.Vector3(lerp(-2, 0.5, p1), lerp(lerp(2.2, 6, ease.inOutQuad(p1)), 9.5, up), lerp(14, 4.5, up));
    const tgt = new THREE.Vector3(0, lerp(lerp(9, 14, p1), 5.2, up), lerp(-2, -32, up));
    pos.add(new THREE.Vector3(noise1(t * 0.6, 1) * 0.2, noise1(t * 0.6, 2) * 0.15, 0));
    aim(S.cam, pos, tgt, noise1(t * 0.25, 4) * 0.025 + lerp(0.04, 0, up));
    // the first line rides up with the lanterns, in front of the camera
    if (this.l12 && l12) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(S.cam.quaternion);
      const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(S.cam.quaternion);
      this.l12.position.copy(S.cam.position).addScaledVector(fwd, 12).addScaledVector(camUp, lerp(-0.6, 1.8, prog(t, l12.start, second)));
      this.l12.quaternion.copy(S.cam.quaternion);
      this.l12.visible = t < second + 0.2;
      this.l12.sing(t, 1 - smoothstep(second - 0.3, second + 0.2, t));
    }
    S.render(this.ctx.renderer, out);
    return { bloom: 1.0, bloomThreshold: 0.75 };
  }
}

/** Split text into n lines at spaces, balancing lengths. */
function splitAt(s: string, n: number): string[] {
  const words = s.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur && (cur.length + w.length + 1 > s.length / n + 3) && out.length < n - 1) { out.push(cur); cur = w; }
    else cur = cur ? `${cur} ${w}` : w;
  }
  out.push(cur);
  return out;
}
