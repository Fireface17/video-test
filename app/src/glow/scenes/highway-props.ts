// Highway scene, props: the sign gantries (neon lyric lines), the dashboard fuel gauge, the calendar
// billboards with phosphor smiles painted on them, the gas station (canopy, pumps, a price pylon whose
// digit drums roll to ANY COST) and the sun that rises where it sank.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Line } from '../../engine/lyrics';
import type { StrokeFontName } from '../../engine/stroke';
import { F, font } from '../../engine/type';
import { SCALE } from '../../engine/gl';
import { mulberry32, smoothstep } from '../../engine/util';
import { col } from '../lib/palette';
import { NeonLine, NeonSign, neonMaterial } from '../lib/neon';

// ------------------------------------------------------------------ small geometry helpers

/** Box from (x, y, z) centre and size, optionally rotated about z (in-plane braces) then about y. */
function box(out: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, rz = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  out.push(g);
}

/** A beam between two points in the XY plane at depth z. */
function beam(out: THREE.BufferGeometry[], x0: number, y0: number, x1: number, y1: number, z: number, t: number) {
  const L = Math.hypot(x1 - x0, y1 - y0);
  box(out, L, t, t, (x0 + x1) / 2, (y0 + y1) / 2, z, Math.atan2(y1 - y0, x1 - x0));
}

function merged(parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  g.computeBoundingSphere();
  return g;
}

/** Soft additive glow card (rounded box falloff), colour * k. */
export function glowCard(c: THREE.Color, round = 0.6) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { c: { value: c.clone() }, k: { value: 0 }, round: { value: round } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform vec3 c; uniform float k, round; varying vec2 vUv;
      void main(){ vec2 p = abs(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(round, 1.0, p.x)) * (1.0 - smoothstep(round * 0.6, 1.0, p.y));
        gl_FragColor = vec4(c * k * a * a, 1.0); }`,
  });
}

// ------------------------------------------------------------------ neon glass that can stay hidden

/**
 * The toolkit's neon look (lib/neon.ts neonMaterial) plus `glassK`, the visibility of the unlit glass:
 * a line's dark tubes fade in only shortly before it is sung (the karaoke shows a line dimly at most
 * ~0.5 s ahead), instead of reading as grey script from far away.
 */
export function hidingNeonMaterial(color: THREE.Color, glass = new THREE.Color(0.018, 0.02, 0.035)) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: color.clone() }, glass: { value: glass }, on: { value: 0 }, glassK: { value: 1 },
    }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 color, glass; uniform float on, glassK;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = clamp(abs(dot(normalize(vN + vec3(0.0, 0.0, 1e-5)), normalize(vV))), 0.0, 1.0);
        vec3 dark = (glass * (0.35 + 1.6 * pow(1.0 - f, 3.0)) + vec3(0.05) * pow(f, 40.0)) * glassK;
        float lum = max(max(color.r, color.g), color.b);
        vec3 lit = color * (0.55 + 1.1 * pow(f, 1.4)) + vec3(lum) * 0.9 * pow(f, 7.0);
        gl_FragColor = vec4(mix(dark, lit * max(on, 0.0), clamp(on, 0.0, 1.0)), 1.0);
        #include <fog_fragment>
      }`,
  });
}

/** Swap a sign's word materials for hiding ones (setLevel/sing keep working through word.mat). */
export function useHidingGlass(sign: NeonSign) {
  for (const w of sign.words) {
    const m = hidingNeonMaterial(w.mat.uniforms.color!.value as THREE.Color);
    w.mat.dispose();
    w.mat = m;
    w.mesh.material = m;
  }
}
export function setGlass(sign: NeonSign, k: number) { for (const w of sign.words) w.mat.uniforms.glassK!.value = k; }

// ------------------------------------------------------------------ gantry with a neon lyric line

export interface GantryOpts {
  rows: number[][];
  /** Ink width of the widest row (m); the em size follows. */
  inkWidth: number;
  /** Horizontal condensing of the lettering. */
  sx: number;
  color: THREE.Color;
  font?: StrokeFontName;
  /** Height of the lettering's vertical centre above the road (m). */
  centerY: number;
  span?: number;
}

/**
 * An overhead sign bridge: two posts, a box truss, a dark sign panel hung from it with the lyric line in
 * neon script. Origin on the road centre line under the bridge; the sign faces +z (the oncoming camera).
 */
export class Gantry extends THREE.Group {
  sign: NeonLine;
  glows: { mat: THREE.ShaderMaterial; wi: number }[] = [];
  em: number;
  inkW: number;
  inkH: number;
  panelW: number;
  panelH: number;
  signZ = 0.95;
  /** height of the lettering's centre */
  cy: number;

  constructor(public line: Line, o: GantryOpts, steel: THREE.Material, raceway: THREE.Material) {
    super();
    this.cy = o.centerY;
    const font = o.font ?? 'script';
    // em size from the widest row
    const probe = new NeonLine(line, o.rows, { font, size: 1 });
    const widest = Math.max(...probe.rows.map((r) => r.sign.width));
    probe.dispose();
    const em = o.inkWidth / (widest * o.sx);
    this.em = em;
    const lead = em * 1.08;
    this.sign = new NeonLine(line, o.rows, { font, size: em, color: o.color, leading: lead, radius: em * 0.02 });
    this.sign.scale.x = o.sx;
    for (const r of this.sign.rows) useHidingGlass(r.sign);
    const nr = o.rows.length;
    // vertical extent of the ink: descenders of the bottom row (-0.42 em) to ascenders of the top (+0.72 em)
    const top = (nr - 1) * lead + 0.72 * em, bot = -0.42 * em;
    this.inkW = o.inkWidth;
    this.inkH = top - bot;
    const baseY = o.centerY - (top + bot) / 2;
    this.sign.position.set(0, baseY, this.signZ);
    this.add(this.sign);

    // open lettering: each row mounted on a slim raceway, hung from the truss
    this.panelW = o.inkWidth + em * 0.6;
    this.panelH = this.inkH + em * 0.3;
    const rw: THREE.BufferGeometry[] = [];
    for (const { sign } of this.sign.rows) {
      const y = baseY + sign.position.y + em * 0.17;
      box(rw, sign.width * o.sx + em * 0.5, em * 0.11, 0.16, 0, y, this.signZ - 0.14);
    }
    const ys = this.sign.rows.map(({ sign }) => baseY + sign.position.y + em * 0.17);
    const yTop = o.centerY + this.panelH / 2 + 0.55;
    for (const x of [-0.3, 0.3]) box(rw, 0.05, yTop - Math.min(...ys), 0.05, x * o.inkWidth, (yTop + Math.min(...ys)) / 2, this.signZ - 0.14);
    this.add(new THREE.Mesh(merged(rw), raceway));
    // word glows on the panel (the neon lighting its own board)
    for (const { sign, ids } of this.sign.rows) {
      sign.words.forEach((w, k) => {
        const mat = glowCard(o.color, 0.45);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        const cx = ((w.x0 + w.x1) / 2) * o.sx;
        m.scale.set((w.x1 - w.x0) * o.sx + em * 0.9, em * 1.25, 1);
        m.position.set(cx, baseY + sign.position.y + em * 0.16, this.signZ - 0.08);
        this.add(m);
        this.glows.push({ mat, wi: ids[k]! });
      });
    }

    // the bridge: posts and a box truss above the panel
    const span = o.span ?? 23;
    const yb = o.centerY + this.panelH / 2 + 0.55, yt = yb + 1.05;
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      box(parts, 0.42, yt + 0.25, 0.42, s * span / 2, (yt + 0.25) / 2, 0);
      box(parts, 0.9, 0.25, 0.9, s * span / 2, 0.12, 0);
    }
    const bays = 10;
    for (const z of [-0.5, 0.5]) {
      beam(parts, -span / 2, yb, span / 2, yb, z, 0.16);
      beam(parts, -span / 2, yt, span / 2, yt, z, 0.16);
      for (let i = 0; i <= bays; i++) {
        const x = -span / 2 + (span * i) / bays;
        beam(parts, x, yb, x, yt, z, 0.09);
        if (i < bays) {
          const x1 = -span / 2 + (span * (i + 1)) / bays;
          if (i % 2) beam(parts, x, yb, x1, yt, z, 0.07);
          else beam(parts, x, yt, x1, yb, z, 0.07);
        }
      }
    }
    for (let i = 0; i <= bays; i += 2) box(parts, 0.07, 0.07, 1.0, -span / 2 + (span * i) / bays, yb, 0);
    const bridge = new THREE.Mesh(merged(parts), steel);
    this.add(bridge);
  }

  /** Light each word at its sung start; glows follow the words. Returns the lit fraction (0..1). */
  update(t: number, fog = 1, gain = 1) {
    this.sign.sing(t, gain);
    const glass = smoothstep(this.line.start - 0.6, this.line.start - 0.1, t);
    for (const r of this.sign.rows) setGlass(r.sign, glass);
    let lit = 0;
    for (const g of this.glows) {
      const r = this.sign.rows.find((r) => r.ids.includes(g.wi))!;
      const k = r.sign.words[r.ids.indexOf(g.wi)]!.mat.uniforms.on!.value as number;
      g.mat.uniforms.k!.value = 0.07 * k * fog;
      lit += k;
    }
    return lit / Math.max(1, this.glows.length);
  }
}

// ------------------------------------------------------------------ dashboard fuel gauge

/** Fuel-pump pictogram on a canvas (white on transparent), for the low-fuel lamp. */
function pumpIcon() {
  const n = 128, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d')!;
  c.strokeStyle = c.fillStyle = '#fff';
  c.lineWidth = 9; c.lineJoin = 'round'; c.lineCap = 'round';
  // pump body with a window
  c.beginPath(); c.roundRect(26, 22, 50, 86, 8); c.stroke();
  c.fillRect(36, 34, 30, 22);
  c.fillRect(18, 104, 66, 10);
  // hose and nozzle
  c.beginPath(); c.moveTo(76, 44); c.lineTo(94, 44); c.quadraticCurveTo(104, 46, 104, 60); c.lineTo(104, 92); c.quadraticCurveTo(104, 100, 96, 98); c.stroke();
  c.beginPath(); c.moveTo(104, 60); c.lineTo(110, 50); c.lineTo(106, 30); c.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/**
 * The instrument cluster of the car we start in: a dark dash across the bottom of the frame and a large
 * half-dial fuel gauge (E..F) with a needle and an amber low-fuel lamp. Built in camera space (child of
 * the camera): the dial is centred below the line of sight.
 */
export class Dashboard extends THREE.Group {
  needle: THREE.Group;
  lampMat: THREE.ShaderMaterial;
  ticks: THREE.MeshBasicMaterial[] = [];
  glow: THREE.ShaderMaterial;
  needleMat: THREE.MeshBasicMaterial;
  letters: NeonSign[] = [];
  ring: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  R: number;
  /** angle of fuel level 0 (E) and 1 (F), radians from +x */
  static A0 = Math.PI * 0.86;
  static A1 = Math.PI * 0.14;

  constructor(R = 0.15) {
    super();
    this.R = R;
    const cx = 0, cy = -0.31, cz = -1.0; // pivot of the needle, camera space
    const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#151a33'), roughness: 0.75, metalness: 0.1 });
    // the dash: a wide slab whose far edge sits low in the frame, and a hood over the gauge
    const slab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.5, 1.5), dark);
    slab.position.set(0, cy - 0.25 - 0.012, cz + 0.1);
    slab.rotation.x = -0.04;
    this.add(slab);
    const hoodG = new THREE.CylinderGeometry(R * 1.32, R * 1.32, 0.26, 40, 1, true, -Math.PI / 2, Math.PI);
    hoodG.rotateX(Math.PI / 2);
    const hood = new THREE.Mesh(hoodG, new THREE.MeshStandardMaterial({ color: new THREE.Color('#10142a'), roughness: 0.6, side: THREE.DoubleSide }));
    hood.position.set(cx, cy, cz - 0.08);
    this.add(hood);
    // dial face (half disc, dark glass) and a dim ring
    const face = new THREE.Mesh(new THREE.CircleGeometry(R * 1.12, 48, 0, Math.PI), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.006, 0.008, 0.02) }));
    face.position.set(cx, cy, cz - 0.004);
    this.add(face);
    this.ring = new THREE.MeshBasicMaterial({ color: col('cyan', 0.5) });
    const ring = new THREE.Mesh(new THREE.RingGeometry(R * 1.1, R * 1.125, 64, 1, 0, Math.PI), this.ring);
    ring.position.set(cx, cy, cz);
    this.add(ring);
    // ticks: 9 from E to F; majors at E, 1/2, F; the reserve zone near E in pink
    for (let i = 0; i <= 8; i++) {
      const f = i / 8, a = Dashboard.A0 + (Dashboard.A1 - Dashboard.A0) * f;
      const major = i % 4 === 0;
      const len = major ? R * 0.2 : R * 0.11;
      const m = new THREE.MeshBasicMaterial({ color: i <= 1 ? col('pink', 1.8) : col('cyan', 1.6) });
      const g = new THREE.PlaneGeometry(len, major ? R * 0.034 : R * 0.022);
      const tk = new THREE.Mesh(g, m);
      const r = R * 0.98 - len / 2;
      tk.position.set(cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz + 0.002);
      tk.rotation.z = a;
      this.add(tk);
      this.ticks.push(m);
    }
    // E and F
    for (const [s, f, c] of [['E', 0, col('pink', 2.2)], ['F', 1, col('cyan', 2.0)]] as const) {
      const L = new NeonSign(s, { font: 'sans', size: R * 0.32, align: 'center', color: c, radius: R * 0.013 });
      const a = Dashboard.A0 + (Dashboard.A1 - Dashboard.A0) * f;
      L.position.set(cx + Math.cos(a) * R * 1.36, cy + Math.sin(a) * R * 1.36 - R * 0.1, cz + 0.003);
      L.setAll(1);
      this.add(L);
      this.letters.push(L);
    }
    // needle: a tapered blade from the pivot, with a hub
    const ng = new THREE.BufferGeometry();
    const w0 = R * 0.035, w1 = R * 0.008, L0 = -R * 0.12, L1 = R * 0.95;
    ng.setAttribute('position', new THREE.Float32BufferAttribute([L0, -w0, 0, L1, -w1, 0, L1, w1, 0, L0, -w0, 0, L1, w1, 0, L0, w0, 0], 3));
    this.needleMat = new THREE.MeshBasicMaterial({ color: col('pink', 2.6) });
    this.needle = new THREE.Group();
    this.needle.add(new THREE.Mesh(ng, this.needleMat));
    const hub = new THREE.Mesh(new THREE.CircleGeometry(R * 0.075, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.02, 0.022, 0.04) }));
    hub.position.z = 0.002;
    this.needle.add(hub);
    this.needle.position.set(cx, cy, cz + 0.006);
    this.add(this.needle);
    // low-fuel lamp (amber pump icon) inside the dial
    this.lampMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { map: { value: pumpIcon() }, c: { value: col('#ff9a1f', 2.4) }, k: { value: 0 }, dim: { value: col('#ff9a1f', 0.05) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform sampler2D map; uniform vec3 c, dim; uniform float k; varying vec2 vUv;
        void main(){ float a = texture2D(map, vUv).a; gl_FragColor = vec4((dim + c * k) * a, 1.0); }`,
    });
    const lamp = new THREE.Mesh(new THREE.PlaneGeometry(R * 0.26, R * 0.26), this.lampMat);
    lamp.position.set(cx, cy + R * 0.42, cz + 0.004);
    this.add(lamp);
    // soft light spill of the dial on the dash, and a real (small) light for the hood and slab
    this.glow = glowCard(col('cyan'), 0.2);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(R * 4.2, R * 1.6), this.glow);
    gl.rotation.x = -Math.PI / 2 + 0.04;
    gl.position.set(cx, cy - 0.006, cz + 0.18);
    this.add(gl);
    this.light = new THREE.PointLight(col('#7fb8ff'), 0.0, 1.2, 2);
    this.light.position.set(cx, cy + R * 0.5, cz + 0.12);
    this.add(this.light);
  }

  /** fuel 0..1 (needle), lamp 0..1, power 0..1 (cluster brightness). */
  update(fuel: number, lamp: number, power = 1) {
    this.needle.rotation.z = Dashboard.A0 + (Dashboard.A1 - Dashboard.A0) * fuel;
    this.lampMat.uniforms.k!.value = lamp;
    this.needleMat.color.copy(col('pink', 2.6 * power));
    this.ring.color.copy(col('cyan', 0.5 * power));
    this.ticks.forEach((m, i) => m.color.copy(i <= 1 ? col('pink', 1.8 * power) : col('cyan', 1.6 * power)));
    this.letters.forEach((L) => L.setAll(power));
    this.glow.uniforms.k!.value = 0.02 * power + 0.03 * lamp;
    this.light.intensity = 0.35 * power + 0.25 * lamp;
    this.light.color.copy(col('#7fb8ff')).lerp(col('#ff9a1f'), 0.5 * lamp);
  }
}

// ------------------------------------------------------------------ billboards with painted smiles

/** A hand-drawn smiley as brush strokes (board units: face radius 1), in drawing order. */
function smileyStrokes(seed: number): THREE.Vector2[][] {
  const r = mulberry32(seed);
  const ph1 = r() * 6.28, ph2 = r() * 6.28;
  const wob = (a: number) => 1 + 0.03 * Math.sin(a * 2 + ph1) + 0.012 * Math.sin(a * 5 + ph2);
  const circle: THREE.Vector2[] = [];
  const a0 = Math.PI * (0.55 + r() * 0.2), sweep = Math.PI * 2.08;
  for (let i = 0; i <= 72; i++) {
    const a = a0 + (sweep * i) / 72;
    const k = wob(a) * (1 - 0.04 * (i / 72));
    circle.push(new THREE.Vector2(Math.cos(a) * k, Math.sin(a) * k * 0.97));
  }
  const eye = (x: number) => {
    const p: THREE.Vector2[] = [];
    for (let i = 0; i <= 6; i++) p.push(new THREE.Vector2(x + 0.015 * Math.sin(i), 0.46 - (i / 6) * 0.3));
    return p;
  };
  const smile: THREE.Vector2[] = [];
  for (let i = 0; i <= 28; i++) {
    const u = i / 28, a = Math.PI * (1.18 + 0.64 * u);
    smile.push(new THREE.Vector2(Math.cos(a) * 0.6, Math.sin(a) * 0.55 + 0.05 + 0.03 * Math.sin(u * 9 + seed)));
  }
  // little upturned ends
  return [circle, eye(-0.34), eye(0.34), smile];
}

/**
 * Glowing paint strokes revealed progressively (per stroke 0..1), flat ribbons in the XY plane, with a
 * brighter wet head where the brush is.
 */
export class Paint extends THREE.Mesh {
  declare material: THREE.ShaderMaterial;
  constructor(strokes: THREE.Vector2[][], width: number, c: THREE.Color) {
    const pos: number[] = [], aS: number[] = [], aA: number[] = [], aK: number[] = [], idx: number[] = [];
    const lens: number[] = [];
    strokes.forEach((st, k) => {
      let L = 0;
      const cum = st.map((p, i) => (i ? (L += p.distanceTo(st[i - 1]!)) : 0));
      lens.push(L);
      const base = pos.length / 3;
      st.forEach((p, i) => {
        const a = st[Math.max(0, i - 1)]!, b = st[Math.min(st.length - 1, i + 1)]!;
        const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
        const nx = -ty / tl, ny = tx / tl;
        // brush pressure: thinner at the ends
        const u = cum[i]! / (L || 1);
        const w = width * (0.65 + 0.35 * Math.sin(Math.PI * Math.min(1, u * 1.15)));
        for (const s of [-1, 1]) {
          pos.push(p.x + nx * w * 0.5 * s, p.y + ny * w * 0.5 * s, 0);
          aS.push(cum[i]!); aA.push(s); aK.push(k);
        }
        if (i < st.length - 1) { const q = base + i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(aA, 1));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(aK, 1));
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { prog: { value: new THREE.Vector4() }, lens: { value: new THREE.Vector4(...[0, 1, 2, 3].map((i) => lens[i] ?? 1)) }, c: { value: c.clone() }, k: { value: 1 } },
      vertexShader: /* glsl */ `attribute float aS, aA, aK; varying float vS, vA, vK;
        void main(){ vS = aS; vA = aA; vK = aK; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform vec4 prog, lens; uniform vec3 c; uniform float k; varying float vS, vA, vK;
        void main(){
          float p = vK < 0.5 ? prog.x : vK < 1.5 ? prog.y : vK < 2.5 ? prog.z : prog.w;
          float L = vK < 0.5 ? lens.x : vK < 1.5 ? lens.y : vK < 2.5 ? lens.z : lens.w;
          float s = p * L;
          if (vS > s || p <= 0.0) discard;
          float edge = 1.0 - smoothstep(0.45, 1.0, abs(vA));
          float bristle = 0.8 + 0.2 * sin(vA * 9.0 + vS * 3.0);
          float head = (p < 0.999) ? exp(-(s - vS) * 6.0) : 0.0;
          gl_FragColor = vec4(c * k * edge * bristle * (1.0 + 1.6 * head), 1.0);
        }`,
    });
    super(g, mat);
  }
  setProgress(a: number, b: number, c: number, d: number) { (this.material.uniforms.prog!.value as THREE.Vector4).set(a, b, c, d); }
}

/**
 * A roadside billboard styled as a calendar page: a dark board on legs, two binder rings on top, the day
 * in cyan neon over a pink rule, and a smiley painted on it in phosphor. Faces +z; origin at its foot.
 */
export class Billboard extends THREE.Group {
  paint: Paint;
  label: NeonSign;
  rule: THREE.MeshBasicMaterial;
  W = 7.8;
  H = 5.4;

  constructor(day: string, seed: number, mats: { board: THREE.Material; steel: THREE.Material }) {
    super();
    const { W, H } = this;
    const y0 = 0.8; // board bottom
    const board = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.25), mats.board);
    board.position.set(0, y0 + H / 2, 0);
    this.add(board);
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-W * 0.3, W * 0.3]) box(parts, 0.22, y0 + 0.4, 0.22, x, (y0 + 0.4) / 2, -0.25);
    box(parts, W * 0.8, 0.12, 0.12, 0, y0 * 0.55, -0.25);
    this.add(new THREE.Mesh(merged(parts), mats.steel));
    // binder rings (calendar)
    const ringG = new THREE.TorusGeometry(0.17, 0.035, 8, 20);
    for (const x of [-W * 0.27, W * 0.27]) {
      const r = new THREE.Mesh(ringG, mats.steel);
      r.position.set(x, y0 + H + 0.02, 0.05);
      r.rotation.y = Math.PI / 2;
      this.add(r);
    }
    this.label = new NeonSign(day, { font: 'readable', size: 1.05, align: 'center', color: col('cyan', 2.2), radius: 0.04, tracking: 6 });
    this.label.position.set(0, y0 + H - 1.02, 0.2);
    this.add(this.label);
    this.rule = new THREE.MeshBasicMaterial({ color: col('pink', 1.6) });
    const rule = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.84, 0.07), this.rule);
    rule.position.set(0, y0 + H - 1.3, 0.14);
    this.add(rule);
    this.paint = new Paint(smileyStrokes(seed), 0.15, col('phosphor', 2.2));
    this.paint.scale.setScalar(1.55);
    this.paint.position.set(0, y0 + (H - 1.3) / 2 - 0.02, 0.15);
    this.add(this.paint);
  }

  update(labelOn: number, prog: [number, number, number, number], fog = 1) {
    this.label.setAll(labelOn);
    this.rule.color.copy(col('pink', 1.6 * labelOn * fog));
    this.paint.setProgress(...prog);
    this.paint.material.uniforms.k!.value = fog;
  }
}

// ------------------------------------------------------------------ the gas station

/** Glyph strip for the price drums: digits, then each target letter after two blanks (so a drum landing
 * on a letter, motion blur included, never shows another letter). */
const DRUM = '0123456789  A  N  Y  C  O  S  T  ';
export const drumIndex = (ch: string) => DRUM.indexOf(ch);

function drumAtlas() {
  const k = Math.min(1.7, SCALE), gw = Math.round(112 * k), gh = Math.round(144 * k), n = DRUM.length; // (taller than 8192 px fails)
  const cv = document.createElement('canvas');
  cv.width = gw; cv.height = gh * n;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.font = font(F.archivo(87.5, 900), 114 * k);
  for (let i = 0; i < n; i++) if (DRUM[i] !== ' ') c.fillText(DRUM[i]!, gw / 2, gh * i + gh * 0.5 + 114 * k * 0.36);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** One digit drum: a window onto a vertical glyph strip at fractional position `pos`, motion-blurred. */
function drumMaterial(atlas: THREE.Texture, c: THREE.Color) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { atlas: { value: null }, n: { value: DRUM.length }, wrap: { value: DRUM.length }, pos: { value: 0 }, blur: { value: 0 }, c: { value: c.clone() }, k: { value: 1 } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D atlas; uniform float n, wrap, pos, blur, k; uniform vec3 c; varying vec2 vUv;
      void main(){
        float a = 0.0;
        for (int i = 0; i < 7; i++) {
          float q = mod(pos + (1.0 - vUv.y) + (float(i) / 6.0 - 0.5) * blur, wrap); // spinning: digits only
          a += texture2D(atlas, vec2(vUv.x, 1.0 - q / n)).a;
        }
        a /= 7.0;
        // the window: dark glass with a faint inner shade at top and bottom (the drum's curvature)
        float shade = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
        vec3 glass = vec3(0.016, 0.022, 0.05) * (0.5 + 0.5 * shade);
        gl_FragColor = vec4(glass + c * k * a * (0.55 + 0.45 * shade), 1.0);
        #include <fog_fragment>
      }`,
  });
}

export interface Drum { mat: THREE.ShaderMaterial; row: number; i: number; from: number; to: number }

/**
 * Gas station at the roadside: a canopy with a glowing cyan fascia and bright underside, pump islands,
 * and in front a tall price pylon: "And I'd pay" in pink neon over two rows of price drums (3 and 4)
 * that roll and stop on ANY / COST. Origin at the pylon's foot; the pylon faces +z.
 */
export class Station extends THREE.Group {
  header: NeonSign;
  drums: Drum[] = [];
  dots: THREE.MeshBasicMaterial[] = [];
  fascia: THREE.MeshBasicMaterial;
  under: THREE.MeshBasicMaterial;
  spots!: THREE.MeshBasicMaterial;
  pumpScreens: THREE.MeshBasicMaterial[] = [];
  frame: THREE.ShaderMaterial;
  frameGlow: THREE.ShaderMaterial;
  light: THREE.PointLight;
  /** pylon panel centre (local) */
  panelY: number;
  panelW = 7.6;
  panelH = 8.4;
  canopy: THREE.Group;
  headerFrom: number;

  constructor(line: Line, mats: { steel: THREE.Material; board: THREE.Material; slab: THREE.Material }) {
    super();
    this.headerFrom = line.start;
    const { panelW: PW, panelH: PH } = this;
    const pole = 2.7;
    this.panelY = pole + PH / 2;
    // pylon: two legs and the panel
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-PW * 0.32, PW * 0.32]) box(parts, 0.35, pole + 0.4, 0.35, x, (pole + 0.4) / 2, -0.1);
    this.add(new THREE.Mesh(merged(parts), mats.steel));
    const panel = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, 0.5), mats.board);
    panel.position.set(0, this.panelY, -0.1);
    this.add(panel);
    // neon frame around the panel (pink, dim) as a thin tube loop
    const fr: THREE.Vector3[] = [];
    const fw = PW / 2 - 0.18, fh = PH / 2 - 0.18;
    for (const [x, y] of [[-fw, -fh], [fw, -fh], [fw, fh], [-fw, fh], [-fw, -fh]] as const) fr.push(new THREE.Vector3(x, this.panelY + y, 0.2));
    this.frame = neonMaterial(col('pink', 1.4));
    const frame = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fr, false, 'catmullrom', 0), 64, 0.045, 6, false), this.frame);
    this.add(frame);
    // header: the sung words "And I'd pay"
    const words = line.words.map((w) => w.w);
    this.header = new NeonSign(words.slice(0, 3).join(' '), { font: 'script', size: 1.28, align: 'center', color: col('pink', 2.1), radius: 0.03 });
    this.header.scale.x = 0.9;
    useHidingGlass(this.header);
    this.header.position.set(0, this.panelY + PH / 2 - 1.85, 0.22);
    this.add(this.header);
    this.frameGlow = glowCard(col('pink'), 0.5);
    const hg = new THREE.Mesh(new THREE.PlaneGeometry(PW * 0.95, 2.2), this.frameGlow);
    hg.position.set(0, this.panelY + PH / 2 - 1.55, 0.16);
    this.add(hg);
    // price drums: rows of 3 and 4, a decimal dot after the first drum
    const atlas = drumAtlas();
    const cw = 1.32, ch = 1.78, gap = 0.16;
    const rows = [{ to: 'ANY', from: '419', y: this.panelY - 0.55 }, { to: 'COST', from: '4599', y: this.panelY - 2.75 }];
    rows.forEach((r, ri) => {
      const n = r.to.length, w = n * cw + (n - 1) * gap + 0.25;
      for (let i = 0; i < n; i++) {
        const mat = drumMaterial(atlas, col('cyan', 2.0));
        mat.uniforms.atlas!.value = atlas;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), mat);
        const x = -w / 2 + cw / 2 + i * (cw + gap) + (i > 0 ? 0.25 : 0);
        m.position.set(x, r.y, 0.18);
        this.add(m);
        this.drums.push({ mat, row: ri, i, from: drumIndex(r.from[i]!), to: drumIndex(r.to[i]!) });
      }
      const dm = new THREE.MeshBasicMaterial({ color: col('cyan', 2.0) });
      const dot = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), dm);
      dot.position.set(-w / 2 + cw + gap / 2 + 0.12, r.y - ch / 2 + 0.2, 0.19);
      this.add(dot);
      this.dots.push(dm);
    });

    // the canopy behind the pylon, to the right, with pump islands under it
    this.canopy = new THREE.Group();
    const cy = 5.4, cwid = 15, cdep = 19, cth = 1.05;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(cwid, cth, cdep), mats.board);
    roof.position.set(0, cy + cth / 2, 0);
    this.canopy.add(roof);
    this.fascia = new THREE.MeshBasicMaterial({ color: col('cyan', 1.6) });
    // glowing bands around the fascia (top and bottom edges)
    for (const yy of [cy + 0.12, cy + cth - 0.12]) {
      for (const [w, d, x, z] of [[cwid + 0.04, 0.12, 0, cdep / 2 + 0.02], [cwid + 0.04, 0.12, 0, -cdep / 2 - 0.02], [0.12, cdep + 0.04, cwid / 2 + 0.02, 0], [0.12, cdep + 0.04, -cwid / 2 - 0.02, 0]] as const) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.11, d), this.fascia);
        b.position.set(x, yy, z);
        this.canopy.add(b);
      }
    }
    this.under = new THREE.MeshBasicMaterial({ color: col('#dff3ff', 1.3) });
    const ul = new THREE.Mesh(new THREE.PlaneGeometry(cwid - 1.2, cdep - 1.2), this.under);
    ul.rotation.x = Math.PI / 2;
    ul.position.set(0, cy - 0.01, 0);
    this.canopy.add(ul);
    // downlights: a grid of bright discs under the roof
    this.spots = new THREE.MeshBasicMaterial({ color: col('#e8f6ff', 2.4) });
    const spotG: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const g = new THREE.CircleGeometry(0.32, 16);
      g.rotateX(Math.PI / 2);
      g.translate((i - 1) * cwid * 0.3, cy - 0.03, (j - 1.5) * cdep * 0.22);
      spotG.push(g);
    }
    this.canopy.add(new THREE.Mesh(merged(spotG), this.spots));
    const cparts: THREE.BufferGeometry[] = [];
    for (const x of [-cwid * 0.3, cwid * 0.3]) for (const z of [-cdep * 0.3, cdep * 0.3]) box(cparts, 0.45, cy, 0.45, x, cy / 2, z);
    // pump islands
    for (const x of [-cwid * 0.3, cwid * 0.3]) {
      box(cparts, 1.3, 0.22, 7.5, x, 0.11, 0);
      for (const z of [-2.2, 2.2]) box(cparts, 0.8, 1.9, 0.55, x, 1.17, z);
    }
    this.canopy.add(new THREE.Mesh(merged(cparts), mats.steel));
    for (const x of [-cwid * 0.3, cwid * 0.3]) for (const z of [-2.2, 2.2]) {
      const sm = new THREE.MeshBasicMaterial({ color: col(z < 0 ? 'pink' : 'cyan', 1.4) });
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.36), sm);
      s.position.set(x, 1.55, z + 0.29);
      this.canopy.add(s);
      this.pumpScreens.push(sm);
    }
    const slab = new THREE.Mesh(new THREE.BoxGeometry(cwid + 8, 0.06, cdep + 10), mats.slab);
    slab.position.set(0, 0.03, 0);
    this.canopy.add(slab);
    this.light = new THREE.PointLight(col('#cfe9ff'), 0, 30, 1.6);
    this.light.position.set(0, cy - 0.6, 0);
    this.canopy.add(this.light);
    this.add(this.canopy);
  }

  /**
   * t: time; words: the sung line; roll0: when the drums start rolling; lands: per row, the landing time.
   */
  update(t: number, sing: (i: number) => number, roll0: number, lands: number[], power = 1) {
    for (let i = 0; i < 3; i++) this.header.setLevel(i, sing(i));
    setGlass(this.header, smoothstep(this.headerFrom - 0.6, this.headerFrom - 0.1, t));
    const hl = this.header.words.reduce((s, w) => s + (w.mat.uniforms.on!.value as number), 0) / 3;
    this.frameGlow.uniforms.k!.value = 0.12 * hl;
    this.frame.uniforms.on!.value = 0.35 * power + 0.25 * hl;
    for (const d of this.drums) {
      const land = lands[d.row]! + d.i * 0.045;
      let pos: number, blur = 0;
      if (t < roll0) pos = d.from;
      else if (t < land) {
        // spin up: phase grows with an ease-in, speed up to ~16 glyphs/s; stay within the digits
        const dt = t - roll0, v = 16;
        const ph = dt < 0.35 ? (v * dt * dt) / (2 * 0.35) : v * (dt - 0.175);
        pos = (d.from + ph + d.i * 2.3) % 10;
        blur = Math.min(1.4, (v * Math.min(1, dt / 0.35)) / 14);
      } else {
        // drop onto the letter: from the blank above it, a short spring settle
        const dt = t - land;
        const s = 1 - Math.exp(-dt * 26) * Math.cos(dt * 34);
        pos = d.to - 0.98 * (1 - s);
        blur = Math.max(0, 0.6 * Math.exp(-dt * 20));
      }
      d.mat.uniforms.pos!.value = pos;
      d.mat.uniforms.blur!.value = blur;
      d.mat.uniforms.wrap!.value = t < land ? 10 : DRUM.length;
      d.mat.uniforms.k!.value = power * (t >= land ? 1.25 : 1);
    }
    this.dots.forEach((m, r) => m.color.copy(col('cyan', 2.0 * power * (1 - smoothstep(roll0, roll0 + 0.2, t)) * (t < lands[r]! ? 1 : 0))));
  }
}

// ------------------------------------------------------------------ the sun

/** The sun disc (gold core, ember limb), far away; the ground plane hides what is below the horizon. */
export function makeSun() {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { k: { value: 0 }, core: { value: col('gold', 2.3) }, rim: { value: col('ember', 1.5) } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float k; uniform vec3 core, rim; varying vec2 vUv;
      void main(){ float r = length(vUv - 0.5) * 2.0;
        float disc = 1.0 - smoothstep(0.985, 1.0, r);
        vec3 c = mix(core, rim, smoothstep(0.2, 1.0, r * r));
        gl_FragColor = vec4(c * k * disc, disc); }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  m.renderOrder = -5;
  return m;
}

