// Highway scene, the fuel gauge insert: a macro shot of the instrument cluster. A backlit dial (E ½ F, red
// reserve zone), a glowing needle that sinks to E, the amber low-fuel lamp blinking on the beat, a chrome
// bezel and the cover glass, swept by the reflections of the passing streetlights.
import * as THREE from 'three';
import { F, font } from '../../engine/type';
import { canvasTex } from './highway-tex';

const C = (hex: string, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const DEG = Math.PI / 180;
/** Needle angle (radians, 0 = pointing right, CCW positive) for a fuel level 0 (E) .. 1 (F). */
export const fuelAngle = (lvl: number) => (215 - 250 * lvl) * DEG;

function dialCanvases(size = 2048) {
  const base = document.createElement('canvas'), glow = document.createElement('canvas');
  base.width = base.height = glow.width = glow.height = size;
  const b = base.getContext('2d')!, g = glow.getContext('2d')!;
  const c0 = size / 2, R = size * 0.47;
  // ---- base: deep charcoal with a fine concentric brushed finish and a soft vignette
  const grad = b.createRadialGradient(c0, c0, 0, c0, c0, R);
  grad.addColorStop(0, '#16181d'); grad.addColorStop(0.85, '#0c0d10'); grad.addColorStop(1, '#060608');
  b.fillStyle = '#050506'; b.fillRect(0, 0, size, size);
  b.fillStyle = grad; b.beginPath(); b.arc(c0, c0, R, 0, Math.PI * 2); b.fill();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const r = rnd() * R;
    b.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.012 + rnd() * 0.02})`;
    b.lineWidth = 0.6 + rnd() * 1.4;
    b.beginPath(); b.arc(c0, c0, r, rnd() * 6.28, rnd() * 6.28 + 1 + rnd() * 3); b.stroke();
  }
  // ---- backlit graphics (white-ice), on black
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const ang = (lvl: number) => -fuelAngle(lvl); // canvas y is down
  const tick = (lvl: number, r0: number, r1: number, w: number, col: string) => {
    const a = ang(lvl);
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(c0 + Math.cos(a) * r0, c0 + Math.sin(a) * r0); g.lineTo(c0 + Math.cos(a) * r1, c0 + Math.sin(a) * r1); g.stroke();
  };
  // reserve zone: a red band from E to 1/8
  g.strokeStyle = '#ff2a1c'; g.lineWidth = R * 0.07;
  g.beginPath(); g.arc(c0, c0, R * 0.86, ang(0), ang(0.125), true); g.stroke();
  for (let i = 0; i <= 16; i++) {
    const lvl = i / 16, major = i % 4 === 0, mid = i % 2 === 0;
    tick(lvl, R * (major ? 0.7 : mid ? 0.76 : 0.79), R * 0.9, major ? R * 0.032 : mid ? R * 0.018 : R * 0.011, lvl < 0.13 ? '#ff4636' : '#e9f3ff');
  }
  g.fillStyle = '#e9f3ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lab = (lvl: number, s: string, px: number, r = 0.53) => {
    const a = ang(lvl);
    g.font = font(F.archivo(100, 700), px);
    g.fillText(s, c0 + Math.cos(a) * R * r, c0 + Math.sin(a) * R * r);
  };
  g.fillStyle = '#ff4636'; lab(0, 'E', R * 0.2);
  g.fillStyle = '#e9f3ff'; lab(1, 'F', R * 0.2); lab(0.5, '½', R * 0.15);
  lab(0.25, '¼', R * 0.1, 0.58); lab(0.75, '¾', R * 0.1, 0.58);
  // the fuel-pump pictogram + filler arrow, small, under the hub
  const pump = (ctx: CanvasRenderingContext2D, x: number, y: number, s: number) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.beginPath();
    ctx.rect(-0.5, -0.8, 0.7, 1.4); // body
    ctx.moveTo(0.2, -0.45); ctx.lineTo(0.42, -0.45); ctx.lineTo(0.52, -0.3); ctx.lineTo(0.52, 0.35); ctx.lineTo(0.62, 0.45); ctx.lineTo(0.72, 0.35); ctx.lineTo(0.72, -0.4);
    ctx.lineTo(0.55, -0.62);
    ctx.lineWidth = 0.12; ctx.stroke();
    ctx.fillRect(-0.62, 0.6, 0.94, 0.16);
    ctx.clearRect(-0.36, -0.66, 0.42, 0.42);
    ctx.restore();
  };
  g.strokeStyle = '#e9f3ff'; g.fillStyle = '#e9f3ff';
  pump(g, c0 - R * 0.04, c0 + R * 0.38, R * 0.11);
  g.beginPath(); g.moveTo(c0 + R * 0.1, c0 + R * 0.38); g.lineTo(c0 + R * 0.16, c0 + R * 0.34); g.lineTo(c0 + R * 0.16, c0 + R * 0.42); g.closePath(); g.fill();
  // the outer chapter ring (fine line)
  g.strokeStyle = 'rgba(233,243,255,0.5)'; g.lineWidth = R * 0.006;
  g.beginPath(); g.arc(c0, c0, R * 0.93, ang(0), ang(1), true); g.stroke();
  // low-fuel lamp (separate texture: amber pictogram)
  const lamp = document.createElement('canvas');
  lamp.width = lamp.height = 256;
  const l = lamp.getContext('2d')!;
  l.fillStyle = '#000'; l.fillRect(0, 0, 256, 256);
  l.strokeStyle = '#fff'; l.fillStyle = '#fff';
  pump(l, 118, 128, 110);
  return { base, glow, lamp };
}

export class Gauge {
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.05, 100);
  needle: THREE.Group;
  needleMat: THREE.MeshBasicMaterial;
  dialU: Record<string, THREE.IUniform>;
  lampMat: THREE.MeshBasicMaterial;
  glassU: Record<string, THREE.IUniform>;
  chromeU: Record<string, THREE.IUniform>;
  speedNeedle: THREE.Group;

  constructor() {
    const { base, glow, lamp } = dialCanvases();
    const baseT = canvasTex(base), glowT = canvasTex(glow), lampT = canvasTex(lamp);
    // dial face: lit dimly by the sweeping streetlight + backlit graphics
    this.dialU = { base: { value: baseT }, glow: { value: glowT }, back: { value: 1 }, sweep: { value: 0 }, sweepCol: { value: C('#ff9a3c', 1) } };
    const dialMat = new THREE.ShaderMaterial({
      uniforms: this.dialU,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform sampler2D base, glow; uniform float back, sweep; uniform vec3 sweepCol; varying vec2 vUv;
        void main(){
          vec3 b = texture2D(base, vUv).rgb;
          vec3 g = texture2D(glow, vUv).rgb;
          // light leaking from the passing lamps across the dial
          float band = exp(-pow((vUv.x + vUv.y * 0.6 - sweep * 2.6 + 0.6) / 0.35, 2.0));
          vec3 c = b * (0.08 + sweepCol * band * 0.35) + g * vec3(0.75, 0.88, 1.0) * back * 1.9;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const dial = new THREE.Mesh(new THREE.CircleGeometry(1, 128), dialMat);
    // cylindrical recess (the dial sits in a deep binnacle)
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.35, 96, 1, true), new THREE.MeshBasicMaterial({ color: C('#0a0b0e'), side: THREE.BackSide }));
    wall.rotation.x = Math.PI / 2; wall.position.z = 0.17;
    // chrome bezel (fake environment: the sodium sweep)
    this.chromeU = { sweep: this.dialU.sweep!, sweepCol: this.dialU.sweepCol! };
    const chromeMat = new THREE.ShaderMaterial({
      uniforms: this.chromeU,
      vertexShader: /* glsl */ `varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float sweep; uniform vec3 sweepCol; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          vec3 r = reflect(-vV, normalize(vN));
          float env = 0.02 + 0.05 * smoothstep(-0.2, 1.0, r.y);
          float a = atan(vP.y, vP.x);
          float hl = exp(-pow((a - (sweep * 6.0 - 2.2)) / 0.35, 2.0)) * smoothstep(0.0, 0.6, r.z);
          vec3 c = vec3(env) + sweepCol * hl * 2.2 + vec3(0.6, 0.75, 1.0) * 0.05 * pow(max(r.y, 0.0), 4.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(1.04, 0.05, 20, 160), chromeMat);
    bezel.position.z = 0.36;
    // needle: tapered glowing blade + dark hub with a chrome rim
    this.needle = new THREE.Group();
    const blade = new THREE.Shape();
    blade.moveTo(-0.16, -0.028); blade.lineTo(0.86, -0.009); blade.lineTo(0.88, 0); blade.lineTo(0.86, 0.009); blade.lineTo(-0.16, 0.028); blade.closePath();
    this.needleMat = new THREE.MeshBasicMaterial({ color: C('#ff5a1e', 2.6) });
    const bm = new THREE.Mesh(new THREE.ExtrudeGeometry(blade, { depth: 0.015, bevelEnabled: false }), this.needleMat);
    const core = new THREE.Mesh(new THREE.ExtrudeGeometry(blade, { depth: 0.002, bevelEnabled: false }), new THREE.MeshBasicMaterial({ color: C('#fff1d0', 3.5) }));
    core.scale.set(0.95, 0.3, 1); core.position.z = 0.016;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.06, 48), new THREE.MeshBasicMaterial({ color: C('#060607') }));
    hub.rotation.x = Math.PI / 2; hub.position.z = 0.03;
    const hubRim = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 10, 64), chromeMat);
    hubRim.position.z = 0.06;
    this.needle.add(bm, core, hub, hubRim);
    this.needle.position.z = 0.02;
    // low-fuel lamp (amber pictogram beside the hub)
    this.lampMat = new THREE.MeshBasicMaterial({ color: C('#ffa01e', 0.0), map: lampT, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    const lampM = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), this.lampMat);
    lampM.position.set(0.42, -0.5, 0.005);
    // cover glass: sweeping reflection bands + faint dust
    this.glassU = { sweep: this.dialU.sweep!, sweepCol: this.dialU.sweepCol!, k: { value: 1 } };
    const glassMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: this.glassU,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float sweep, k; uniform vec3 sweepCol; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){
          vec2 p = vUv * 2.0 - 1.0;
          float s = p.x * 0.8 + p.y * 0.5 - (sweep * 3.4 - 1.7);
          float band = exp(-s * s / 0.02) * 0.5 + exp(-s * s / 0.3) * 0.12;
          float dust = step(0.9965, h(floor(vUv * 900.0))) * 0.6 + 0.04 * h(floor(vUv * 300.0));
          float rim = smoothstep(0.82, 1.0, length(p));
          vec3 c = sweepCol * band * (0.6 + dust * 2.0) * k + vec3(0.6, 0.7, 0.9) * 0.012 * rim;
          gl_FragColor = vec4(c * step(length(p), 1.0), 1.0);
        }`,
    });
    const glass = new THREE.Mesh(new THREE.CircleGeometry(1.06, 96), glassMat);
    glass.position.z = 0.4;
    // the cluster hood around (dark grained plastic) and a sliver of the speedometer to the left
    const hood = new THREE.Mesh(new THREE.RingGeometry(1.09, 6, 96, 1), new THREE.ShaderMaterial({
      uniforms: { sweep: this.dialU.sweep!, sweepCol: this.dialU.sweepCol! },
      vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float sweep; uniform vec3 sweepCol; varying vec3 vP;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main(){ float g = h(floor(vP.xy * 160.0)) * 0.4 + 0.6; float r = length(vP.xy);
          float band = exp(-pow((vP.x * 0.4 + vP.y * 0.25 - (sweep * 3.0 - 1.4)) / 0.5, 2.0));
          vec3 c = vec3(0.006, 0.0065, 0.008) * g * (1.0 + 2.0 * smoothstep(1.4, 1.1, r)) + sweepCol * band * 0.02 * g;
          gl_FragColor = vec4(c, 1.0); }`,
    }));
    hood.position.z = 0.36;
    const speedo = new THREE.Group();
    const sp = new THREE.Mesh(new THREE.RingGeometry(0.78, 0.9, 120, 1, -40 * DEG, 260 * DEG), new THREE.MeshBasicMaterial({ color: C('#bcd6ff', 0.25) }));
    const ticks: THREE.BufferGeometry[] = [];
    for (let i = 0; i <= 26; i++) {
      const a = (-40 + i * 10) * DEG;
      const gq = new THREE.PlaneGeometry(i % 2 ? 0.08 : 0.15, i % 2 ? 0.012 : 0.022);
      gq.translate(0.8 - (i % 2 ? 0.04 : 0.075), 0, 0); gq.rotateZ(a);
      ticks.push(gq);
    }
    for (const tg of ticks) speedo.add(new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: C('#e9f3ff', 1.2) })));
    this.speedNeedle = new THREE.Group();
    const sb = new THREE.Mesh(new THREE.ExtrudeGeometry(blade, { depth: 0.01, bevelEnabled: false }), this.needleMat);
    this.speedNeedle.add(sb);
    speedo.add(sp, this.speedNeedle);
    speedo.scale.setScalar(1.25);
    speedo.position.set(-2.75, 0.2, -0.05);
    this.scene.add(dial, wall, bezel, this.needle, lampM, glass, hood, speedo);
  }

  /** fuel 0..1, lamp 0..1, sweep phase (0..1, lamp passing), shot progress for the camera push. */
  update(fuel: number, lamp: number, sweep: number, push: number, shake: [number, number], roll: number) {
    this.needle.rotation.z = fuelAngle(fuel);
    this.speedNeedle.rotation.z = (-40 + 260 * (1 - 128 / 260)) * DEG + 0.01 * Math.sin(sweep * 40);
    this.lampMat.color.copy(C('#ff9a1a', 3.2 * lamp));
    this.dialU.sweep!.value = sweep;
    this.dialU.back!.value = 1;
    const z = 3.6 - 0.55 * push;
    this.cam.position.set(0.55 - 0.25 * push + shake[0], -0.25 + 0.06 * push + shake[1], z);
    this.cam.lookAt(0.12 - 0.08 * push, -0.08, 0);
    this.cam.rotateZ(roll);
    this.cam.updateMatrixWorld();
  }

  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget) {
    renderer.setRenderTarget(out);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, true);
    renderer.render(this.scene, this.cam);
  }
}
