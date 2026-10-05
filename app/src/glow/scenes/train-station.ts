// The `train` scene's elevated station, in the New York manner: a concrete platform with the yellow tactile
// strip, a cream tile wall with grime, a mosaic frieze and the station's name in mosaic tablets, riveted
// I-beam columns painted green, a canopy with rows of fluorescent fixtures (each pouring a pool of light — the
// lighting model in train-gfx.ts), wooden benches, framed posters (one torn, one tagged), a trash can, a
// MetroCard machine, a hanging clock and an exit sign; the long stair down to the avenue, whose risers carry
// the words painted in light, and the green entrance globes at its foot.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { F, font } from '../../engine/type';
import { mulberry32 } from '../../engine/util';
import { GlowPoints } from '../lib/points';
import { FLOOR_Y, ST_LIGHT, boxG, canvasTex, glowMat, litMat, type LightU } from './train-gfx';
import { RISE, ST, STAIR_FOOT } from './train-world';

/** Columns: [x, z] (the riveted-steel pattern knows the three z lines). */
const COLS: [number, number][] = [
  [-26, -5.6], [-20, -5.6], [-14, -5.6], [-8, -5.6], [-2.5, -5.6],
  [-24, -9.0], [-16, -9.0], [-8, -9.0], [10.5, -9.0], [16.5, -9.0], [22.5, -9.0],
  [17, -2.65], [23, -2.65],
];

export class Station extends THREE.Group {
  lightsOn = new Float32Array(ST_LIGHT.n);
  fixtures: THREE.InstancedMesh;
  riserMat: THREE.ShaderMaterial;
  globes = new GlowPoints(8, 0.6);
  globePos: THREE.Vector3[] = [];
  /** caged bulbs on brackets along the stair's far balustrade */
  stairLamps: THREE.Vector3[] = [];
  private clockHands: THREE.Group[] = [];

  constructor(U: LightU, riser: { sharp: THREE.Texture; glow: THREE.Texture; boxes: THREE.Vector4[] }) {
    super();
    const Y = FLOOR_Y;
    const { x0, x1, zWall, zEdge, stairX, sz0, sz1 } = ST;
    const concrete = litMat(U, { color: new THREE.Color(0.15, 0.15, 0.155), pattern: 9 });
    const rough = litMat(U, { color: new THREE.Color(0.1, 0.1, 0.105), pattern: 5 });
    const tiles = litMat(U, { color: new THREE.Color(0.42, 0.4, 0.34), pattern: 4 });
    const green = litMat(U, { color: new THREE.Color(0.02, 0.07, 0.04), pattern: 8, spec: 0.5, shin: 30 });
    const dark = litMat(U, { color: new THREE.Color(0.02, 0.021, 0.024), spec: 0.3 });
    const yellow = litMat(U, { color: new THREE.Color(0.62, 0.42, 0.02), pattern: 10 });
    const wood = litMat(U, { color: new THREE.Color(0.2, 0.1, 0.045), pattern: 5, spec: 0.25 });
    const chrome = litMat(U, { color: new THREE.Color(0.35, 0.36, 0.38), spec: 1.4, shin: 60 });

    // ---- the platform, cut for the stairwell; its edge strip and the drop to the track
    const pf = [
      boxG(x0, x1, Y - 0.3, Y, sz1, zEdge - 0.6),
      boxG(x0, stairX - 0.3, Y - 0.3, Y, zWall, sz1),
      boxG(x0, x1, Y - 0.3, Y, zWall, sz0),
    ];
    this.add(new THREE.Mesh(mergeGeometries(pf), concrete));
    this.add(new THREE.Mesh(boxG(x0, x1, Y - 0.3, Y + 0.006, zEdge - 0.6, zEdge), yellow));
    this.add(new THREE.Mesh(boxG(x0, x1, Y - 1.1, Y - 0.3, zEdge - 0.25, zEdge), rough));

    // ---- the wall: cream tiles with grime; a mosaic frieze along the top and a stripe low down
    this.add(new THREE.Mesh(boxG(x0, x1, Y - 0.3, ST.canopy, zWall - 0.3, zWall), tiles));
    const frieze = friezeTexture();
    frieze.wrapS = THREE.RepeatWrapping;
    frieze.repeat.set((x1 - x0) / 2.4, 1);
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.42), litMat(U, { color: new THREE.Color(0.7, 0.7, 0.7), map: frieze, spec: 0.4 }));
    fr.position.set((x0 + x1) / 2, Y + 3.42, zWall + 0.006);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.16), litMat(U, { color: new THREE.Color(0.7, 0.7, 0.7), map: frieze, spec: 0.4 }));
    stripe.position.set((x0 + x1) / 2, Y + 0.98, zWall + 0.006);
    this.add(fr, stripe);
    // the station's name in mosaic tablets
    const name = nameTexture();
    for (const x of [-6.6, -18.6, -27.2, 13.5, 20.5]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.72), litMat(U, { color: new THREE.Color(0.75, 0.75, 0.75), map: name, spec: 0.5 }));
      m.position.set(x, Y + 1.75, zWall + 0.008);
      this.add(m);
    }

    // ---- the canopy: steel roof on cross girders, rows of fluorescent fixtures in their housings
    this.add(new THREE.Mesh(boxG(x0, x1, ST.canopy, ST.canopy + 0.25, zWall, zEdge + 0.6), dark));
    const girders: THREE.BufferGeometry[] = [];
    for (let x = x0 + 1.5; x < x1; x += 3) girders.push(boxG(x - 0.08, x + 0.08, ST.canopy - 0.32, ST.canopy, zWall, zEdge + 0.5), boxG(x - 0.14, x + 0.14, ST.canopy - 0.34, ST.canopy - 0.3, zWall, zEdge + 0.5));
    for (const z of [-5.6, -2.65]) girders.push(boxG(x0, x1, ST.canopy - 0.36, ST.canopy - 0.02, z - 0.1, z + 0.1));
    this.add(new THREE.Mesh(mergeGeometries(girders), green));
    const n = ST_LIGHT.n, segL = (x1 - x0) / n;
    const housings: THREE.BufferGeometry[] = [];
    this.fixtures = new THREE.InstancedMesh(new THREE.BoxGeometry(segL * 0.8, 0.035, 0.05), new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 4);
    for (let i = 0; i < n; i++) for (let r = 0; r < 2; r++) {
      const x = x0 + (i + 0.5) * segL, z = ST_LIGHT.z[r]!;
      housings.push(boxG(x - segL * 0.41, x + segL * 0.41, ST_LIGHT.y + 0.02, ST_LIGHT.y + 0.1, z - 0.13, z + 0.13));
      for (const k of [0, 1]) {
        housings.push(boxG(x - segL * 0.3 + k * segL * 0.6 - 0.01, x - segL * 0.3 + k * segL * 0.6 + 0.01, ST_LIGHT.y + 0.1, ST.canopy - 0.32, z - 0.01, z + 0.01));
        this.fixtures.setMatrixAt((i * 2 + r) * 2 + k, new THREE.Matrix4().makeTranslation(x, ST_LIGHT.y, z + (k ? 0.05 : -0.05)));
        this.fixtures.setColorAt((i * 2 + r) * 2 + k, new THREE.Color(0, 0, 0));
      }
    }
    this.add(new THREE.Mesh(mergeGeometries(housings), dark), this.fixtures);

    // ---- riveted I-beam columns (flanges facing along the platform), knee braces up to the girders
    const beams: THREE.BufferGeometry[] = [];
    for (const [cx, cz] of COLS) {
      const yb = cz === -2.65 || cz === -9.0 || cx < stairX - 0.5 ? Y : Y;
      const yt = ST.canopy - 0.3;
      beams.push(boxG(cx - 0.11, cx - 0.09, yb, yt, cz - 0.13, cz + 0.13), boxG(cx + 0.09, cx + 0.11, yb, yt, cz - 0.13, cz + 0.13), boxG(cx - 0.09, cx + 0.09, yb, yt, cz - 0.012, cz + 0.012));
      beams.push(boxG(cx - 0.2, cx + 0.2, yb, yb + 0.04, cz - 0.22, cz + 0.22));
      for (const s of [-1, 1]) {
        const brace = boxG(-0.5, 0.5, -0.03, 0.03, -0.03, 0.03);
        brace.rotateZ(s * Math.PI / 4);
        brace.translate(cx + s * 0.35, yt - 0.35, cz);
        beams.push(brace);
      }
    }
    this.add(new THREE.Mesh(mergeGeometries(beams), green));
    // the structure under the platform
    const under: THREE.BufferGeometry[] = [];
    for (let x = x0 + 1; x < x1; x += 7) for (const z of [-3.0, -8.9]) under.push(boxG(x - 0.25, x + 0.25, 0, Y - 0.3, z - 0.25, z + 0.25));
    under.push(boxG(x0, x1, Y - 0.75, Y - 0.3, -9.1, -8.7), boxG(x0, x1, Y - 0.75, Y - 0.3, -3.2, -2.8));
    this.add(new THREE.Mesh(mergeGeometries(under), green));

    // ---- benches (wooden slats on steel), a trash can, a MetroCard machine
    const slats: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [];
    for (const x of [-1.2, -12, -22]) {
      const zb = zWall + 0.25;
      for (let k = 0; k < 4; k++) slats.push(boxG(x - 0.95, x + 0.95, Y + 0.44, Y + 0.47, zb + 0.08 + k * 0.105, zb + 0.17 + k * 0.105));
      for (let k = 0; k < 3; k++) slats.push(boxG(x - 0.95, x + 0.95, Y + 0.55 + k * 0.13, Y + 0.64 + k * 0.13, zb + 0.02, zb + 0.05));
      for (const s of [-0.8, 0, 0.8]) frames.push(boxG(x + s - 0.03, x + s + 0.03, Y, Y + 0.44, zb + 0.1, zb + 0.42), boxG(x + s - 0.03, x + s + 0.03, Y + 0.44, Y + 0.95, zb, zb + 0.04));
    }
    this.add(new THREE.Mesh(mergeGeometries(slats), wood), new THREE.Mesh(mergeGeometries(frames), dark));
    const can = new THREE.CylinderGeometry(0.27, 0.25, 0.82, 16, 1, true);
    can.translate(1.1, Y + 0.41, zWall + 0.45);
    const rim = new THREE.TorusGeometry(0.27, 0.02, 6, 16);
    rim.rotateX(Math.PI / 2);
    rim.translate(1.1, Y + 0.82, zWall + 0.45);
    const bag = new THREE.CylinderGeometry(0.255, 0.255, 0.04, 16);
    bag.translate(1.1, Y + 0.8, zWall + 0.45);
    this.add(new THREE.Mesh(mergeGeometries([can, rim].map((g) => { g.deleteAttribute('uv'); return g; })), litMat(U, { color: new THREE.Color(0.05, 0.12, 0.08), spec: 0.5, side: THREE.DoubleSide })));
    this.add(new THREE.Mesh(bag, dark));
    const mvm = new THREE.Mesh(boxG(-0.36, 0.36, 0, 1.68, -0.22, 0.22), dark);
    mvm.position.set(-4.3, Y, zWall + 0.25);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.58), glowMat(U, new THREE.Color(1, 1, 1), machineTexture()));
    face.position.set(-4.3, Y + 0.85, zWall + 0.475);
    this.add(mvm, face);

    // ---- framed posters (one torn, one tagged)
    const posters = posterTextures();
    const frameM = litMat(U, { color: new THREE.Color(0.25, 0.26, 0.27), spec: 0.9, shin: 40 });
    [[-1.2, 0], [-8.6, 1], [-10.2, 2], [-15.2, 3], [-25, 0], [11.9, 1], [15.1, 2], [18.6, 3], [24.6, 0]].forEach(([x, k]) => {
      const fm = new THREE.Mesh(boxG(-0.6, 0.6, -0.85, 0.85, 0, 0.03), frameM);
      fm.position.set(x!, Y + 1.85, zWall);
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 1.58), litMat(U, { color: new THREE.Color(0.8, 0.8, 0.8), map: posters[k!], spec: 0.6, shin: 50 }));
      pm.position.set(x!, Y + 1.85, zWall + 0.034);
      this.add(fm, pm);
    });

    // ---- a clock hanging from the canopy, an exit sign over the stair
    const clockTex = clockTexture();
    const clock = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 28), dark);
    body.rotation.z = Math.PI / 2;
    const rod = new THREE.Mesh(boxG(-0.015, 0.015, 0.3, ST.canopy - 0.3 - (Y + 3.05), -0.015, 0.015), dark);
    clock.add(body, rod);
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.CircleGeometry(0.27, 28), glowMat(U, new THREE.Color(0.55, 0.55, 0.5), clockTex));
      f.position.x = s * 0.052;
      f.rotation.y = s * Math.PI / 2;
      const hands = new THREE.Group();
      const hm = new THREE.MeshBasicMaterial({ color: 0x050505 });
      const hh = new THREE.Mesh(new THREE.PlaneGeometry(0.02, 0.15), hm); hh.position.y = 0.06;
      const mh = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.23), hm); mh.position.y = 0.1;
      const hg = new THREE.Group(); hg.add(hh); const mg = new THREE.Group(); mg.add(mh);
      hands.add(hg, mg);
      hands.position.x = s * 0.056;
      hands.rotation.y = s * Math.PI / 2;
      this.clockHands.push(hg, mg);
      clock.add(f, hands);
    }
    clock.position.set(0.8, Y + 3.05, -5.6);
    this.add(clock);
    const exit = exitTexture();
    for (const s of [-1, 1]) {
      const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.34), glowMat(U, new THREE.Color(1, 1, 1), exit));
      sg.position.set(8.0 + s * 0.02, ST.canopy - 0.75, -6.0);
      sg.rotation.y = s * Math.PI / 2;
      this.add(sg);
    }
    this.add(new THREE.Mesh(boxG(7.96, 8.04, ST.canopy - 0.6, ST.canopy - 0.3, -6.01, -5.99), dark));

    // ---- the stair: solid steps (risers painted with the words), yellow nosings, balustrades and handrails
    this.riserMat = riserMaterial(U, riser);
    const steps: THREE.BufferGeometry[] = [], noses: THREE.BufferGeometry[] = [];
    for (let i = 0; i < ST.stairN - 1; i++) {
      const xa = stairX + i * ST.run, xb = xa + ST.run, yTop = Y - (i + 1) * RISE;
      steps.push(boxG(xa, xb, Math.max(0, yTop - RISE - 0.3), yTop, sz0, sz1));
      noses.push(boxG(xa - 0.002, xa + 0.05, yTop - 0.004, yTop + 0.006, sz0 + 0.05, sz1 - 0.05));
    }
    this.add(new THREE.Mesh(mergeGeometries(steps), this.riserMat), new THREE.Mesh(mergeGeometries(noses), yellow));
    const L = Math.hypot(STAIR_FOOT - stairX, Y), ang = Math.atan2(Y, STAIR_FOOT - stairX);
    const slope = (o: THREE.Object3D, z: number) => { o.position.set((stairX + STAIR_FOOT) / 2, Y / 2, z); o.rotation.z = -ang; return o; };
    this.add(slope(new THREE.Mesh(boxG(-L / 2, L / 2, 0, 1.05, -0.08, 0.08), green), sz1 - 0.08));
    this.add(slope(new THREE.Mesh(boxG(-L / 2, L / 2, 0, 1.05, -0.08, 0.08), green), sz0 - 0.08));
    this.add(slope(new THREE.Mesh(boxG(-L / 2, L / 2, 0.92, 0.98, -0.03, 0.03), chrome), sz1 - 0.2));
    this.add(slope(new THREE.Mesh(boxG(-L / 2, L / 2, 0.92, 0.98, -0.03, 0.03), chrome), sz0 + 0.12));
    this.add(slope(new THREE.Mesh(boxG(-L / 2, L / 2, -0.5, 0, sz0, sz1), rough), 0));
    // the railing round the opening on the platform
    const rails: THREE.BufferGeometry[] = [boxG(stairX, x1, Y + 1.0, Y + 1.06, sz1 - 0.03, sz1 + 0.03), boxG(stairX, x1, Y + 0.5, Y + 0.53, sz1 - 0.02, sz1 + 0.02)];
    for (let x = stairX + 0.4; x < x1; x += 1.2) rails.push(boxG(x - 0.02, x + 0.02, Y, Y + 1.0, sz1 - 0.02, sz1 + 0.02));
    this.add(new THREE.Mesh(mergeGeometries(rails), green));

    // ---- the entrance globes at the stair's foot (green: open all night)
    const globeM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.6, 0.55) });
    for (const z of [sz0 - 0.35, sz1 + 0.35]) {
      const post = new THREE.Mesh(boxG(-0.05, 0.05, 0, 2.55, -0.05, 0.05), green);
      post.position.set(STAIR_FOOT + 0.8, 0, z);
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), globeM);
      gl.position.set(STAIR_FOOT + 0.8, 2.75, z);
      this.add(post, gl);
      this.globePos.push(gl.position.clone());
    }
    this.globePos.forEach((p, i) => this.globes.set(i, p.x, p.y, p.z, new THREE.Color(0.3, 1.0, 0.45), 1.2, 4.5));
    const brackets: THREE.BufferGeometry[] = [];
    for (const f of [0.22, 0.5, 0.78]) {
      const x = stairX + f * (STAIR_FOOT - stairX), y = Y * (1 - f) + 1.7;
      brackets.push(boxG(x - 0.03, x + 0.03, y - 1.75, y + 0.05, sz0 - 0.16, sz0 - 0.1), boxG(x - 0.02, x + 0.02, y, y + 0.03, sz0 - 0.16, sz0 + 0.12));
      this.stairLamps.push(new THREE.Vector3(x, y - 0.08, sz0 + 0.12));
    }
    this.add(new THREE.Mesh(mergeGeometries(brackets), green));
    this.stairLamps.forEach((p, i) => this.globes.set(this.globePos.length + i, p.x, p.y, p.z, new THREE.Color(1.0, 0.72, 0.42), 2.2, 1.6));
    this.globes.commit(this.globePos.length + this.stairLamps.length);
    this.add(this.globes);
  }

  /** Station lights: segment levels 0..1; the clock's hands at song time t. */
  update(t: number) {
    const c = new THREE.Color();
    for (let i = 0; i < this.lightsOn.length; i++) for (let k = 0; k < 4; k++) this.fixtures.setColorAt(i * 4 + k, c.setRGB(0.85, 0.92, 1.0).multiplyScalar(0.03 + 1.9 * this.lightsOn[i]!));
    this.fixtures.instanceColor!.needsUpdate = true;
    // 1:47 a.m. and a few seconds
    const min = 47 + t / 60, hr = 1 + min / 60;
    for (let i = 0; i < this.clockHands.length; i += 2) {
      this.clockHands[i]!.rotation.z = -(hr / 12) * Math.PI * 2;
      this.clockHands[i + 1]!.rotation.z = -(min / 60) * Math.PI * 2;
    }
  }
}

/**
 * Concrete steps whose risers (the faces toward +x) carry words painted in light, laid out in the stair's
 * stair's own frame (across, and up the flight), so seen from the front of the stair they read as one image.
 */
function riserMaterial(U: LightU, riser: { sharp: THREE.Texture; glow: THREE.Texture; boxes: THREE.Vector4[] }) {
  const m = litMat(U, { color: new THREE.Color(0.1, 0.1, 0.105), pattern: 5 });
  const boxes = riser.boxes.slice(0, 8);
  while (boxes.length < 8) boxes.push(new THREE.Vector4());
  m.uniforms.uSharp = { value: riser.sharp };
  m.uniforms.uGlowT = { value: riser.glow };
  m.uniforms.uBox = { value: boxes };
  m.uniforms.uLv = { value: new Float32Array(8) };
  m.uniforms.uWC = { value: new THREE.Color(0.25, 0.95, 1.0) };
  m.fragmentShader = m.fragmentShader
    .replace('void main() {', /* glsl */ `
      uniform sampler2D uSharp, uGlowT; uniform vec4 uBox[8]; uniform float uLv[8]; uniform vec3 uWC;
      void main() {`)
    .replace('gl_FragColor = vec4(fogged(c, vW), 1.0);', /* glsl */ `
        // up the stair: half by height, half by run, so a riser and the tread above it continue one another (the
        // image is whole whether the risers or the treads face the lens)
        vec2 e = vec2((${ST.tz1.toFixed(3)} - vW.z) / ${(ST.tz1 - ST.tz0).toFixed(3)},
          0.5 * vW.y / ${FLOOR_Y.toFixed(3)} + 0.5 * (${STAIR_FOOT.toFixed(3)} + ${(ST.run * 0.5).toFixed(3)} - vW.x) / ${(STAIR_FOOT - ST.stairX + ST.run).toFixed(3)});
        if (e.x > -0.05 && e.x < 1.05 && e.y > 0.0 && e.y < 1.0) {
          float lv = 0.0;
          for (int i = 0; i < 8; i++) { vec4 b = uBox[i]; if (e.x > b.x && e.x < b.z && e.y > b.y && e.y < b.w) lv = uLv[i]; }
          float riser = smoothstep(0.5, 0.8, n.x);
          float s = texture2D(uSharp, e).r, g = texture2D(uGlowT, e).r;
          c += uWC * lv * (s * (1.5 * riser + 1.1 * (1.0 - riser)) + g * 0.28) + vec3(lv * s * (0.45 * riser + 0.3 * (1.0 - riser)));
        }
        gl_FragColor = vec4(fogged(c, vW), 1.0);`);
  return m;
}

// ------------------------------------------------------------------------------------------------- textures

/** A mosaic frieze: a maroon meander on cream between blue rules, in small tiles. */
function friezeTexture() {
  return canvasTex(512, 96, (c) => {
    c.fillStyle = '#d9cfb4'; c.fillRect(0, 0, 512, 96);
    c.fillStyle = '#1f3a7a'; c.fillRect(0, 0, 512, 12); c.fillRect(0, 84, 512, 12);
    c.strokeStyle = '#7a2420'; c.lineWidth = 10;
    for (let x = 0; x < 512; x += 64) {
      c.beginPath(); c.moveTo(x, 70); c.lineTo(x, 26); c.lineTo(x + 44, 26); c.lineTo(x + 44, 56); c.lineTo(x + 18, 56); c.lineTo(x + 18, 42); c.stroke();
      c.beginPath(); c.moveTo(x + 44, 70); c.lineTo(x + 64, 70); c.stroke();
    }
    // the tesserae
    c.strokeStyle = 'rgba(40,30,20,0.35)'; c.lineWidth = 1;
    for (let x = 0; x <= 512; x += 6) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 96); c.stroke(); }
    for (let y = 0; y <= 96; y += 6) { c.beginPath(); c.moveTo(0, y); c.lineTo(512, y); c.stroke(); }
  });
}

/** The station's name in a mosaic tablet: "14 ST" in cream tesserae on deep blue, a border of maroon. */
function nameTexture() {
  return canvasTex(760, 288, (c) => {
    c.fillStyle = '#7a2420'; c.fillRect(0, 0, 760, 288);
    c.fillStyle = '#d9cfb4'; c.fillRect(14, 14, 732, 260);
    c.fillStyle = '#1b3270'; c.fillRect(30, 30, 700, 228);
    c.fillStyle = '#e6dcc2'; c.font = font(F.archivo(87, 800), 170); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('14 ST', 380, 150);
    const r = mulberry32(3);
    for (let y = 0; y < 288; y += 8) for (let x = 0; x < 760; x += 8) { c.fillStyle = `rgba(0,0,0,${0.1 + r() * 0.18})`; c.fillRect(x, y, 8, 1); c.fillRect(x, y, 1, 8); }
  });
}

function machineTexture() {
  return canvasTex(256, 612, (c) => {
    c.fillStyle = '#0d1a33'; c.fillRect(0, 0, 256, 612);
    c.fillStyle = '#f2c230'; c.fillRect(0, 0, 256, 70);
    c.fillStyle = '#111'; c.font = font(F.archivo(87, 900), 34); c.fillText('MetroCard', 30, 48);
    c.fillStyle = '#1f6fe0'; c.fillRect(30, 100, 196, 150);
    c.fillStyle = '#bfe3ff'; c.fillRect(40, 110, 176, 130);
    c.fillStyle = '#1f6fe0'; c.font = font(F.archivo(100, 700), 22); c.fillText('touch to start', 56, 180);
    for (let k = 0; k < 12; k++) { c.fillStyle = '#9aa3ad'; c.fillRect(40 + (k % 3) * 60, 290 + Math.floor(k / 3) * 42, 46, 30); }
    c.fillStyle = '#f2c230'; c.fillRect(40, 480, 176, 14);
    c.fillStyle = '#e33'; c.fillRect(40, 520, 80, 40);
  }, {});
}

/** Four posters: a concert bill, a "SEE SOMETHING" style notice (no words), a phone ad torn half off, a tagged one. */
function posterTextures() {
  const W = 256, H = 376;
  const mk = (draw: (c: CanvasRenderingContext2D) => void) => canvasTex(W, H, draw);
  const torn = (c: CanvasRenderingContext2D, seed: number, from: number) => {
    const r = mulberry32(seed);
    c.fillStyle = '#e8e2d2';
    c.beginPath(); c.moveTo(W, from); let y = from;
    for (let x = W; x > W * 0.15; x -= 10) { y += 6 + r() * 14; c.lineTo(x, y + (r() - 0.5) * 16); }
    c.lineTo(0, H); c.lineTo(W, H); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(0,0,0,0.25)'; c.stroke();
  };
  return [
    mk((c) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#2a0f45'); g.addColorStop(1, '#e0457b'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.fillStyle = '#ffd34d'; c.beginPath(); c.arc(W / 2, 140, 70, 0, 7); c.fill(); c.fillStyle = '#fff'; c.font = font(F.archivo(125, 900), 44); c.textAlign = 'center'; c.fillText('LIVE', W / 2, 270); c.font = font(F.archivo(100, 500), 18); c.fillText('FRI · SAT · SUN', W / 2, 310); }),
    mk((c) => { c.fillStyle = '#f4f1ea'; c.fillRect(0, 0, W, H); c.fillStyle = '#0e3b8c'; c.fillRect(0, 0, W, 90); c.fillStyle = '#e8b21c'; c.beginPath(); c.arc(W / 2, 200, 60, 0, 7); c.fill(); c.fillStyle = '#0e3b8c'; c.fillRect(W / 2 - 8, 160, 16, 50); c.fillRect(W / 2 - 8, 222, 16, 16); for (let k = 0; k < 5; k++) { c.fillStyle = '#9aa'; c.fillRect(30, 290 + k * 14, W - 60 - (k % 2) * 40, 6); } }),
    mk((c) => { const g = c.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#2b5cff'); g.addColorStop(1, '#00d0ff'); c.fillStyle = g; c.fillRect(0, 0, W, H); c.fillStyle = '#0a0f2a'; c.fillRect(70, 60, 116, 230); c.fillStyle = '#bfe8ff'; c.fillRect(80, 76, 96, 196); c.fillStyle = '#fff'; c.font = font(F.archivo(125, 900), 30); c.fillText('BRIGHTER', 40, 340); torn(c, 7, 150); }),
    mk((c) => { c.fillStyle = '#1b1b1b'; c.fillRect(0, 0, W, H); c.fillStyle = '#ff7a1a'; c.fillRect(20, 20, W - 40, H - 40); c.fillStyle = '#1b1b1b'; c.beginPath(); c.arc(W / 2, H / 2, 70, 0, 7); c.fill(); c.strokeStyle = '#33e0ff'; c.lineWidth = 7; c.beginPath(); c.moveTo(20, 260); c.bezierCurveTo(80, 180, 120, 330, 170, 240); c.bezierCurveTo(200, 190, 230, 260, 240, 220); c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = 4; c.beginPath(); c.moveTo(40, 300); c.lineTo(90, 270); c.lineTo(130, 310); c.lineTo(200, 260); c.stroke(); }),
  ];
}

function clockTexture() {
  return canvasTex(256, 256, (c) => {
    c.fillStyle = '#f1efe6'; c.beginPath(); c.arc(128, 128, 126, 0, 7); c.fill();
    c.fillStyle = '#222';
    for (let k = 0; k < 60; k++) { const a = (k / 60) * Math.PI * 2, r0 = k % 5 ? 112 : 98; c.save(); c.translate(128, 128); c.rotate(a); c.fillRect(-(k % 5 ? 1.5 : 4), -120, k % 5 ? 3 : 8, 120 - r0); c.restore(); }
  });
}

function exitTexture() {
  return canvasTex(330, 102, (c) => {
    c.fillStyle = '#0b0b0b'; c.fillRect(0, 0, 330, 102);
    c.fillStyle = '#f2f2f2'; c.font = font(F.archivo(100, 800), 56); c.fillText('EXIT', 24, 72);
    c.strokeStyle = '#f2f2f2'; c.lineWidth = 9; c.beginPath(); c.moveTo(210, 30); c.lineTo(290, 74); c.moveTo(250, 76); c.lineTo(292, 76); c.lineTo(292, 36); c.stroke();
  });
}
