// Real towers of the New York skyline, modelled from their massing (approximate published dimensions, metres):
// the Empire State Building (setback tiers, the mooring mast, floodlit crown, antenna), the Chrysler Building
// (terraced stainless-steel crown of arches with triangular windows lit at night, the needle) and One World Trade
// Center (a square that turns into a square rotated 45°, eight triangular glass faces, the spire with its beacon).
// Facades use the city's interior-mapped windows (lib/city.ts FACADE_GLSL); crowns are floodlit or emissive.
import * as THREE from 'three';
import { FACADE_GLSL, type City } from './city';
import { GlowPoints } from './points';

function towerMaterial(city: City, B: [number, number, number, number], flood: { y: number; c: THREE.Color }) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...city.mat.uniforms,
      B: { value: new THREE.Vector4(...B) },
      floodY: { value: flood.y }, floodC: { value: flood.c.clone() }, top: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vW;
      void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float fogD, wake, gold, t, gain, floodY, top; uniform vec3 fogC, skyTop, skyHor, floodC; uniform vec4 B;
      varying vec3 vN; varying vec3 vW;
      ${FACADE_GLSL}
      void main() {
        vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
        vec3 c;
        if (abs(N.y) > 0.8) c = vec3(0.012, 0.012, 0.015) + floodC * 0.3 * step(floodY, vW.y);
        else {
          float wa;
          vec3 Nh = normalize(vec3(N.x, 0.0, N.z));
          c = facade(vW, Nh, V, B, top, wake, skyTop, skyHor, wa);
          // floodlights wash the upper setbacks from below: brightest at each tier's foot
          float fk = step(floodY, vW.y);
          c += floodC * fk * (1.0 - wa * 0.6) * (0.55 + 0.45 * smoothstep(0.0, 1.0, fract(vW.y / 14.0)));
        }
        float lum = max(c.r, max(c.g, c.b));
        c = mix(c, vec3(1.0, 0.68, 0.2) * lum * 1.1, gold * 0.8);
        c *= gain;
        float d = length(vW - cameraPosition);
        c = mix(fogC, c, exp(-fogD * fogD * d * d * 0.45));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** An emissive material that fogs a little (crown lights, spires). */
function glowMat(c: THREE.Color) {
  return new THREE.MeshBasicMaterial({ color: c.clone(), fog: false });
}

function box(w: number, h: number, d: number, y: number, mat: THREE.Material) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y + h / 2, 0);
  return new THREE.Mesh(g, mat);
}

export class Landmarks extends THREE.Group {
  esb = new THREE.Group();
  chrysler = new THREE.Group();
  wtc = new THREE.Group();
  esbFlood: THREE.ShaderMaterial;
  esbMast: THREE.MeshBasicMaterial;
  chryslerArches: THREE.ShaderMaterial;
  beacons = new GlowPoints(8, 2.2);
  mats: THREE.ShaderMaterial[] = [];

  constructor(city: City) {
    super();
    // ---- Empire State Building: 381 m roof, antenna to 443 m ----
    this.esbFlood = towerMaterial(city, [17, 0.7, 0.7, 4], { y: 268, c: new THREE.Color(0.25, 0.22, 0.18) });
    this.esbFlood.uniforms.top!.value = 381;
    const m = this.esbFlood;
    const tiers: [number, number, number, number][] = [
      [128, 25, 57, 0], [112, 60, 50, 25], [86, 17, 44, 85], [66, 19, 40, 102], [50, 171, 36, 121], [42, 28, 30, 292], [32, 18, 24, 320], [24, 14, 20, 338],
    ];
    for (const [w, h, d, y] of tiers) this.esb.add(box(w, h, d, y, m));
    // the mast: stepped octagonal drums, floodlit, then the antenna
    this.esbMast = glowMat(new THREE.Color(0.9, 0.85, 0.75));
    const drums: [number, number, number][] = [[9.5, 8, 352], [8, 7, 360], [6.5, 6, 367], [4.5, 5, 373]];
    for (const [r, h, y] of drums) {
      const g = new THREE.CylinderGeometry(r * 0.92, r, h, 8);
      g.translate(0, y + h / 2, 0);
      this.esb.add(new THREE.Mesh(g, this.esbMast));
    }
    const ant = new THREE.CylinderGeometry(0.5, 1.6, 64, 8);
    ant.translate(0, 378 + 32, 0);
    this.esb.add(new THREE.Mesh(ant, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.08, 0.09) })));

    // ---- Chrysler Building: 319 m ----
    const cm = towerMaterial(city, [53, 0.55, 0.6, 4], { y: 1e9, c: new THREE.Color(0, 0, 0) });
    cm.uniforms.top!.value = 242;
    const ct: [number, number, number, number][] = [[61, 56, 61, 0], [48, 60, 48, 56], [40, 90, 40, 116], [34, 36, 34, 206]];
    for (const [w, h, d, y] of ct) this.chrysler.add(box(w, h, d, y, cm));
    // the crown: seven terraced tiers of arches, each side a half-ring band with triangular windows that glow
    this.chryslerArches = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { k: { value: 1 }, gold: city.mat.uniforms.gold, fogD: city.mat.uniforms.fogD, fogC: city.mat.uniforms.fogC },
      vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: /* glsl */ `
        uniform float k, gold, fogD; uniform vec3 fogC; varying vec2 vUv; varying vec3 vW;
        void main() {
          // vUv.x along the arch (0..1), vUv.y across the band (0 inner .. 1 outer)
          float n = 9.0;
          float tooth = abs(fract(vUv.x * n) - 0.5) * 2.0;           // 1 at the gaps, 0 mid-window
          float tri = step(vUv.y, 0.85 - tooth * 0.75) * step(0.12, vUv.y);
          vec3 steel = vec3(0.05, 0.05, 0.055) + vec3(0.12) * pow(vUv.y, 3.0);
          vec3 light = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.75, 0.3), gold) * 2.2 * k;
          vec3 c = mix(steel, light, tri);
          float d = length(vW - cameraPosition);
          c = mix(fogC, c, exp(-fogD * fogD * d * d * 0.45));
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const steel = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.03, 0.035) });
    for (let i = 0; i < 7; i++) {
      const half = 15 - i * 1.9, y0 = 242 + i * 6.2, r1 = half, r0 = half - 2.6;
      // the solid core of this tier
      this.chrysler.add(box(half * 2 - 3, 6.2, half * 2 - 3, y0, steel));
      for (let s = 0; s < 4; s++) {
        const g = new THREE.RingGeometry(r0, r1, 40, 1, 0, Math.PI);
        // ring uv -> (angle 0..1, radius 0..1)
        const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
        for (let v = 0; v < pos.count; v++) {
          const x = pos.getX(v), y = pos.getY(v);
          uv.setXY(v, Math.atan2(y, x) / Math.PI, (Math.hypot(x, y) - r0) / (r1 - r0));
        }
        g.translate(0, 0, half + 0.05);
        g.rotateY((s * Math.PI) / 2);
        g.translate(0, y0 + 1.5, 0);
        this.chrysler.add(new THREE.Mesh(g, this.chryslerArches));
      }
    }
    const needle = new THREE.ConeGeometry(2.4, 33, 8);
    needle.translate(0, 286 + 16.5, 0);
    this.chrysler.add(new THREE.Mesh(needle, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.34, 0.33) })));

    // ---- One World Trade Center: 417 m roof, spire to 541 m ----
    const wm = towerMaterial(city, [88, 0.82, 0.2, 1], { y: 1e9, c: new THREE.Color(0, 0, 0) });
    wm.uniforms.top!.value = 417;
    this.wtc.add(box(61, 56, 61, 0, wm));
    const S = 30.5, Tt = 45 / Math.SQRT2 * 1.0, y0 = 56, y1 = 412;
    const b = [[S, S], [-S, S], [-S, -S], [S, -S]]; // corners of the base square
    const tp = [[0, Tt], [-Tt, 0], [0, -Tt], [Tt, 0]]; // top square: its corners face the base's edges
    const P: number[] = [];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i]!, b1 = b[(i + 1) % 4]!, t0 = tp[i]!, t1 = tp[(i + 1) % 4]!;
      P.push(b0[0]!, y0, b0[1]!, t0[0]!, y1, t0[1]!, b1[0]!, y0, b1[1]!); // pointing up
      P.push(b1[0]!, y0, b1[1]!, t0[0]!, y1, t0[1]!, t1[0]!, y1, t1[1]!); // pointing down
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    wg.computeVertexNormals();
    this.wtc.add(new THREE.Mesh(wg, wm));
    const parapet = new THREE.CylinderGeometry(Tt * 1.02, Tt * 1.02, 5, 4, 1, true);
    parapet.rotateY(Math.PI / 4);
    parapet.translate(0, y1 + 2.5, 0);
    this.wtc.add(new THREE.Mesh(parapet, glowMat(new THREE.Color(0.55, 0.6, 0.7))));
    const spire = new THREE.CylinderGeometry(0.8, 2.2, 124, 8);
    spire.translate(0, 417 + 62, 0);
    this.wtc.add(new THREE.Mesh(spire, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.21, 0.23) })));
    this.mats = [m, cm, wm];
    this.add(this.esb, this.chrysler, this.wtc, this.beacons);
  }

  /** Per frame: the ESB crown colour, the beacons. */
  update(t: number, crown: THREE.Color) {
    this.esbFlood.uniforms.floodC!.value.copy(crown).multiplyScalar(0.3);
    this.esbMast.color.copy(crown).multiplyScalar(1.4);
    const blink = (ph: number) => (Math.sin((t + ph) * Math.PI * 0.9) > 0.7 ? 1 : 0.06);
    const w = (g: THREE.Group, y: number) => new THREE.Vector3(0, y, 0).applyMatrix4(g.matrixWorld);
    this.updateMatrixWorld(true);
    const e = w(this.esb, 443), c = w(this.chrysler, 320), o = w(this.wtc, 542);
    this.beacons.set(0, e.x, e.y, e.z, new THREE.Color(1, 0.1, 0.05), blink(0.3) * 2, 1);
    this.beacons.set(1, c.x, c.y, c.z, new THREE.Color(1, 0.1, 0.05), blink(0.9) * 2, 1);
    this.beacons.set(2, o.x, o.y, o.z, new THREE.Color(1, 1, 1), (Math.sin(t * Math.PI * 0.7) > 0.8 ? 3 : 0.3), 1.6);
    this.beacons.commit(3);
  }
}
