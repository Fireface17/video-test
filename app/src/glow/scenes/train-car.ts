// The `train` scene's subway car (local frame: origin on the floor at the middle, x along the car — the train
// runs toward +x — z across, the platform side is -z): stainless shell with windows, longitudinal bucket seats,
// poles and grab bars with hanging straps that swing with the ride, two pairs of sliding doors per side (with
// scratched windows), ceiling light strips that can flicker per fixture, ads on the coves.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash, noise1 } from '../../engine/util';
import { F, font } from '../../engine/type';
import { boxG, canvasTex, glassMat, litMat, type LightU } from './train-gfx';

export const CAR = {
  hl: 9, hw: 1.38, wo: 1.5, top: 2.05, ceil: 2.25, win0: 0.95, win1: 1.86,
  doors: [-4.6, 4.6], doorHW: 0.7, doorH: 1.98, seatY: 0.46, seatZ: 0.92, barZ: 0.64, barY: 1.98,
};
/** Wall segments along x: pillar, window, door. */
const SEGS: [number, number, 'p' | 'w' | 'd'][] = [
  [-9, -8.6, 'p'], [-8.6, -6.0, 'w'], [-6.0, -5.3, 'p'], [-5.3, -3.9, 'd'], [-3.9, -3.2, 'p'], [-3.2, -1.15, 'w'], [-1.15, -1.0, 'p'],
  [-1.0, 1.0, 'w'], [1.0, 1.15, 'p'], [1.15, 3.2, 'w'], [3.2, 3.9, 'p'], [3.9, 5.3, 'd'], [5.3, 6.0, 'p'], [6.0, 8.6, 'w'], [8.6, 9, 'p'],
];
export const WINDOWS = SEGS.filter((s) => s[2] === 'w').map((s) => [s[0], s[1]] as [number, number]);
/** Bench sections along x. */
export const BENCHES: [number, number][] = [[-8.95, -5.32], [-3.88, 3.88], [5.32, 8.95]];
const STRAP_DX = 0.55;

export class Car extends THREE.Group {
  body: THREE.ShaderMaterial;
  fix: THREE.InstancedMesh;
  fixLevel = new Float32Array(10).fill(1);
  straps: THREE.InstancedMesh;
  strapPos: { x: number; z: number; seed: number }[] = [];
  leaves: { mesh: THREE.Group; side: number; door: number; dir: number }[] = [];
  glass: THREE.ShaderMaterial;
  glassMeshes: THREE.Mesh[] = [];
  doorOpen = [0, 0, 0, 0]; // (side -1, door 0), (-1, 1), (+1, 0), (+1, 1)
  private m4 = new THREE.Matrix4();

  constructor(public U: LightU) {
    super();
    const H = CAR;
    this.body = litMat(U, { color: new THREE.Color(0.2, 0.215, 0.23), pattern: 0, spec: 0.08 });
    const skin = litMat(U, { color: new THREE.Color(0.2, 0.21, 0.23), pattern: 3, spec: 0.6, shin: 30 });
    const floorM = litMat(U, { color: new THREE.Color(0.035, 0.036, 0.042), pattern: 1, spec: 0.1 });
    const seatM = litMat(U, { color: new THREE.Color(0.02, 0.07, 0.15), pattern: 2, spec: 0.3, shin: 20 });
    const steel = litMat(U, { color: new THREE.Color(0.32, 0.33, 0.35), spec: 1.4, shin: 50 });
    const dark = litMat(U, { color: new THREE.Color(0.012, 0.012, 0.014) });
    const ceilM = litMat(U, { color: new THREE.Color(0.25, 0.26, 0.27) });

    // ---- shell: inner walls (interior paint) and outer skin, around windows and door openings
    const inner: THREE.BufferGeometry[] = [], outer: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      const zi0 = s * H.hw, zi1 = s * 1.42, zo0 = s * 1.47, zo1 = s * H.wo;
      const zr = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)] as const;
      for (const [x0, x1, k] of SEGS) {
        const ys: [number, number][] = k === 'p' ? [[0, H.top]] : k === 'w' ? [[0, H.win0], [H.win1, H.top]] : [[H.doorH, H.top]];
        for (const [y0, y1] of ys) {
          const [a, b] = zr(zi0, zi1), [c, d] = zr(zo0, zo1);
          inner.push(boxG(x0, x1, y0, y1, a, b));
          outer.push(boxG(x0, x1, y0, y1, c, d));
        }
        // the window recess between the two skins
        if (k === 'w') for (const y of [H.win0, H.win1]) { const [a, b] = zr(zi1, zo0); inner.push(boxG(x0, x1, y - 0.01, y + 0.01, a, b)); }
      }
      // the skin above the wall line up to the roof
      const [c, d] = zr(s * 1.38, zo1);
      outer.push(boxG(-H.hl, H.hl, H.top, 2.32, c, d));
      outer.push(boxG(-H.hl, H.hl, -0.35, 0, c, d));
    }
    // end walls with the gangway doors
    for (const e of [-1, 1]) {
      const x0 = e * 8.97, x1 = e * 9.05;
      const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)];
      inner.push(boxG(a, b, 0, H.ceil, -H.wo, -0.45), boxG(a, b, 0, H.ceil, 0.45, H.wo), boxG(a, b, 1.8, H.ceil, -0.45, 0.45));
    }
    this.add(new THREE.Mesh(mergeGeometries(inner), this.body), new THREE.Mesh(mergeGeometries(outer), skin));
    // the gangway doors: dark panels with a window into the next car (dimly lit)
    const nextCar = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.012, 0.016, 0.03) });
    for (const e of [-1, 1]) {
      const d = new THREE.Mesh(mergeGeometries([boxG(-0.03, 0.03, 0, 1.0, -0.45, 0.45), boxG(-0.03, 0.03, 1.65, 1.8, -0.45, 0.45), boxG(-0.03, 0.03, 1.0, 1.65, -0.45, -0.3), boxG(-0.03, 0.03, 1.0, 1.65, 0.3, 0.45)]), skin);
      d.position.x = e * 9.0;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.65), nextCar);
      w.position.set(e * 9.03, 1.325, 0);
      w.rotation.y = -e * Math.PI / 2;
      this.add(d, w);
    }
    // floor, ceiling and coves, roof, underframe
    this.add(new THREE.Mesh(boxG(-H.hl, H.hl, -0.06, 0, -H.wo, H.wo), floorM));
    const ceil = new THREE.Mesh(boxG(-H.hl, H.hl, H.ceil, H.ceil + 0.05, -1.0, 1.0), ceilM);
    const roof = new THREE.Mesh(boxG(-H.hl, H.hl, 2.3, 2.42, -H.wo, H.wo), skin);
    const under = new THREE.Mesh(boxG(-H.hl + 0.4, H.hl - 0.4, -0.95, -0.06, -1.3, 1.3), dark);
    this.add(ceil, roof, under);
    for (const s of [-1, 1]) {
      const cove = new THREE.Mesh(new THREE.PlaneGeometry(2 * H.hl, Math.hypot(0.38, 0.2)), ceilM);
      cove.position.set(0, (H.top + H.ceil) / 2, s * 1.19);
      cove.lookAt(new THREE.Vector3(0, (H.top + H.ceil) / 2 - 0.38, s * 1.19 - s * 0.2));
      this.add(cove);
    }
    // ---- seats
    const seats: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) for (const [x0, x1] of BENCHES) {
      const zr = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)] as const;
      const [a, b] = zr(s * H.seatZ, s * H.hw), [c, d] = zr(s * 1.0, s * H.hw), [e, f] = zr(s * 1.28, s * H.hw);
      seats.push(boxG(x0, x1, 0.4, H.seatY, a, b), boxG(x0, x1, 0.0, 0.4, c, d), boxG(x0, x1, H.seatY, H.win0 - 0.02, e, f));
    }
    this.add(new THREE.Mesh(mergeGeometries(seats), seatM));
    // ---- poles and bars
    const poles: THREE.BufferGeometry[] = [];
    const vpole = (x: number, z: number) => { const g = new THREE.CylinderGeometry(0.019, 0.019, H.ceil, 10); g.translate(x, H.ceil / 2, z); return g; };
    for (const x of [-5.36, -3.84, 3.84, 5.36]) for (const z of [-0.93, 0.93]) poles.push(vpole(x, z));
    for (const z of [-H.barZ, H.barZ]) {
      const g = new THREE.CylinderGeometry(0.016, 0.016, 2 * H.hl - 0.2, 8);
      g.rotateZ(Math.PI / 2);
      g.translate(0, H.barY, z);
      poles.push(g);
      for (let x = -8.4; x <= 8.4; x += 2.1) { const br = new THREE.CylinderGeometry(0.01, 0.01, H.ceil - H.barY, 6); br.translate(x, (H.ceil + H.barY) / 2, z); poles.push(br); }
    }
    this.add(new THREE.Mesh(mergeGeometries(poles), steel));
    // ---- straps (instanced): a dark band and a pale handle, pivot on the bar
    const band = new THREE.BoxGeometry(0.026, 0.22, 0.005);
    band.translate(0, -0.11, 0);
    const ring = new THREE.TorusGeometry(0.052, 0.009, 6, 18);
    ring.translate(0, -0.27, 0);
    band.deleteAttribute('uv'); ring.deleteAttribute('uv');
    const vc = (g: THREE.BufferGeometry, c: number) => g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position!.count * 3).fill(c), 3));
    vc(band, 0.12); vc(ring, 1.0);
    const sg = mergeGeometries([band, ring]);
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(sg.attributes.position!.count * 2), 2));
    for (const z of [-H.barZ, H.barZ]) for (let x = -8.5; x <= 8.51; x += STRAP_DX) this.strapPos.push({ x, z, seed: this.strapPos.length });
    this.straps = new THREE.InstancedMesh(sg, litMat(U, { color: new THREE.Color(0.32, 0.31, 0.29), vcol: true, spec: 0.3 }), this.strapPos.length);
    this.straps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.straps.frustumCulled = false;
    this.add(this.straps);
    // ---- ceiling light fixtures (two lines of ten), levels per fixture
    const fg = new THREE.BoxGeometry(1.55, 0.025, 0.13);
    this.fix = new THREE.InstancedMesh(fg, new THREE.MeshBasicMaterial({ color: 0xffffff }), 20);
    for (let i = 0; i < 20; i++) {
      this.fix.setMatrixAt(i, this.m4.makeTranslation(-8.1 + 1.8 * (i % 10), H.ceil - 0.012, i < 10 ? -0.55 : 0.55));
      this.fix.setColorAt(i, new THREE.Color(1, 1, 1));
    }
    this.add(this.fix);
    // ---- window glass
    this.glass = glassMat(U);
    for (const s of [-1, 1]) for (const [x0, x1] of WINDOWS) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, H.win1 - H.win0), this.glass);
      g.position.set((x0 + x1) / 2, (H.win0 + H.win1) / 2, s * 1.445);
      g.renderOrder = -1;
      this.glassMeshes.push(g);
      this.add(g);
    }
    // ---- doors: two leaves each, sliding into the pockets inside the wall
    const leafG = mergeGeometries([boxG(0, 0.7, 0, 1.0, 0, 0.045), boxG(0, 0.7, 1.72, H.doorH, 0, 0.045), boxG(0, 0.14, 1.0, 1.72, 0, 0.045), boxG(0.56, 0.7, 1.0, 1.72, 0, 0.045)]);
    const leafM = litMat(U, { color: new THREE.Color(0.17, 0.18, 0.2), pattern: 0, spec: 0.7, shin: 40 });
    const edgeM = litMat(U, { color: new THREE.Color(0.01, 0.01, 0.01) });
    const scratch = scratchedGlass(U);
    for (const s of [-1, 1]) H.doors.forEach((dx, di) => {
      for (const dir of [-1, 1]) {
        const grp = new THREE.Group();
        const leaf = new THREE.Mesh(leafG, leafM);
        const edge = new THREE.Mesh(boxG(dir < 0 ? 0.665 : 0, dir < 0 ? 0.7 : 0.035, 0, H.doorH, -0.005, 0.05), edgeM);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.72), scratch);
        gl.position.set(0.35, 1.36, 0.0225);
        gl.renderOrder = -1;
        grp.add(leaf, edge, gl);
        grp.position.set(dx + (dir < 0 ? -0.7 : 0), 0, s * 1.4225 - 0.0225);
        this.leaves.push({ mesh: grp, side: s, door: di, dir });
        this.add(grp);
      }
    });
    // ---- ads on the coves
    const ads = adAtlas();
    const adM = litMat(U, { color: new THREE.Color(0.45, 0.45, 0.45), map: ads, spec: 0.15 });
    let ai = 0;
    for (const s of [-1, 1]) for (const [x0, x1] of WINDOWS) {
      const n = Math.max(1, Math.round((x1 - x0) / 1.05));
      for (let k = 0; k < n; k++) {
        const cx = x0 + ((k + 0.5) * (x1 - x0)) / n;
        if (s > 0 && cx > -1.5 && cx < 1.9) continue; // the line map hangs there
        const g = new THREE.PlaneGeometry(0.92, 0.27);
        const id = Math.floor(hash(ai++, 3) * 6);
        const uv = g.attributes.uv as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setX(i, (id + uv.getX(i)) / 6);
        const m = new THREE.Mesh(g, adM);
        m.position.set(cx, (H.top + H.ceil) / 2 + 0.0, s * 1.19 - s * 0.012);
        m.lookAt(new THREE.Vector3(cx, (H.top + H.ceil) / 2 - 0.38, s * 1.19 - s * 0.2 - s * 0.012));
        this.add(m);
      }
    }
  }

  /** Per frame: strap swing (fore-aft lean from braking `acc` m/s², the car's sway), fixture levels, doors. */
  update(t: number, acc: number, speed: number) {
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    const lean = Math.atan2(acc, 9.8);
    this.strapPos.forEach((s, i) => {
      const n1 = noise1(t * 0.9 + s.seed * 0.37, 3), n2 = noise1(t * 0.7 + s.seed * 0.21, 7);
      const sway = 0.07 * Math.sin(t * 2.1 + s.x * 0.15) * (speed > 0.5 ? 1 : 0.3);
      e.set(sway + 0.04 * n1 * (0.3 + speed / 15), 0, -lean * 0.9 + 0.035 * n2);
      q.setFromEuler(e);
      p.set(s.x, CAR.barY, s.z);
      this.m4.compose(p, q, one);
      this.straps.setMatrixAt(i, this.m4);
    });
    this.straps.instanceMatrix.needsUpdate = true;
    const c = new THREE.Color();
    for (let i = 0; i < 20; i++) {
      const l = this.fixLevel[i % 10]!;
      this.fix.setColorAt(i, c.setRGB(0.78, 0.86, 1.0).multiplyScalar(0.03 + 0.95 * l));
    }
    this.fix.instanceColor!.needsUpdate = true;
    for (const L of this.leaves) {
      const k = this.doorOpen[(L.side < 0 ? 0 : 2) + L.door]!;
      L.mesh.position.x = CAR.doors[L.door]! + (L.dir < 0 ? -0.7 : 0) + L.dir * 0.7 * k;
    }
  }

  /** World position of the handle of strap i (after update). */
  strapHandle(i: number, out = new THREE.Vector3()) {
    this.straps.getMatrixAt(i, this.m4);
    out.set(0, -0.27, 0).applyMatrix4(this.m4);
    return this.localToWorld(out);
  }

  /** Index of the strap nearest (x, z) (car-local). */
  strapNear(x: number, z: number) {
    let best = 0, bd = 1e9;
    this.strapPos.forEach((s, i) => { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = i; } });
    return best;
  }
}

/** The door windows: scratched glass (scratches and etched tags catching the light), plus the rain. */
function scratchedGlass(U: LightU) {
  const m = glassMat(U);
  m.fragmentShader = m.fragmentShader.replace('gl_FragColor = vec4(col * uK, 1.0);', /* glsl */ `
        // scratches: thin random strokes that glint
        vec2 sp = vec2(u, y) * 9.0;
        float sc = 0.0;
        for (int k = 0; k < 6; k++) {
          vec2 id = floor(sp + float(k) * 0.37);
          float h1 = hsh(id + float(k) * 7.0), h2 = hsh(id + float(k) * 13.0);
          float a = h1 * 3.14159;
          vec2 dir = vec2(cos(a), sin(a));
          vec2 o = fract(sp + float(k) * 0.37) - 0.5;
          float along = dot(o, dir), across = dot(o, vec2(-dir.y, dir.x));
          sc += smoothstep(0.012, 0.0, abs(across)) * step(abs(along), 0.25 + 0.2 * h2) * step(0.45, h2);
        }
        col += vec3(0.5, 0.52, 0.55) * sc * 0.08 + uOut * sc * 0.06;
        gl_FragColor = vec4(col * uK, 1.0);`);
  return m;
}

/** Six ad cards side by side (the fake light: smiles, screens, sleep). */
function adAtlas() {
  return canvasTex(6 * 512, 150, (c) => {
    const W = 512, H = 150;
    const ads: ((x: number) => void)[] = [
      (x) => { c.fillStyle = '#f2d24b'; c.fillRect(x, 0, W, H); c.fillStyle = '#1b1b1b'; c.font = font(F.archivo(125, 900), 70); c.fillText('SMILE', x + 30, 95); c.lineWidth = 12; c.strokeStyle = '#1b1b1b'; c.beginPath(); c.arc(x + 400, 55, 50, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke(); },
      (x) => { const g = c.createLinearGradient(x, 0, x + W, H); g.addColorStop(0, '#2b5cff'); g.addColorStop(1, '#8a3cff'); c.fillStyle = g; c.fillRect(x, 0, W, H); c.fillStyle = '#fff'; c.fillRect(x + 40, 20, 60, 110); c.fillStyle = '#9fd0ff'; c.fillRect(x + 46, 30, 48, 88); c.font = font(F.archivo(100, 700), 34); c.fillStyle = '#fff'; c.fillText('ALWAYS ON', x + 130, 70); c.font = font(F.archivo(100, 400), 22); c.fillText('never miss a thing', x + 132, 105); },
      (x) => { c.fillStyle = '#0d1a2a'; c.fillRect(x, 0, W, H); c.fillStyle = '#e8eef5'; c.font = font(F.archivo(87, 800), 44); c.fillText('SLEEP IS', x + 30, 62); c.fillText('FOR LATER', x + 30, 112); c.fillStyle = '#ff5a3c'; c.beginPath(); c.arc(x + 430, 75, 40, 0, Math.PI * 2); c.fill(); },
      (x) => { c.fillStyle = '#e9e4da'; c.fillRect(x, 0, W, H); c.fillStyle = '#c33'; c.fillRect(x, 0, 18, H); c.fillStyle = '#222'; c.font = font(F.archivo(100, 900), 40); c.fillText('DR. LEE', x + 40, 60); c.font = font(F.archivo(100, 500), 24); c.fillText('teeth whitening · 2nd fl', x + 40, 100); },
      (x) => { c.fillStyle = '#ff7eb6'; c.fillRect(x, 0, W, H); c.fillStyle = '#fff'; c.font = font(F.archivo(125, 900), 58); c.fillText('BE HAPPY', x + 30, 90); c.font = font(F.archivo(100, 500), 20); c.fillText('download now', x + 34, 125); },
      (x) => { c.fillStyle = '#123'; c.fillRect(x, 0, W, H); for (let i = 0; i < 9; i++) { c.fillStyle = `hsl(${200 + i * 12},70%,${40 + i * 4}%)`; c.fillRect(x + 20 + i * 52, 30, 40, 90); } },
    ];
    ads.forEach((f, i) => { c.save(); c.beginPath(); c.rect(i * W, 0, W, H); c.clip(); f(i * W); c.restore(); });
  });
}
