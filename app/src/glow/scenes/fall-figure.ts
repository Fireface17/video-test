// Posable glowing figures for the bridge (`fall`): a jointed mannequin of tapered capsules and a lathed
// torso, posed every frame by limb directions (plus 2-bone IK for the held hands), drawn in a self-lit
// glass material that can be tinted by the light around it and turned to gold from a point outward.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clamp } from '../../engine/util';

const DOWN = new THREE.Vector3(0, -1, 0);

/** Capsule hanging from a joint at the origin along -y: radius r0 at the joint, r1 at the far end. */
function limb(r0: number, r1: number, len: number) {
  const g = new THREE.CapsuleGeometry(r0, len, 4, 12);
  g.deleteAttribute('uv');
  g.translate(0, -len / 2, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  const k = r1 / r0;
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i);
    const s = 1 + (k - 1) * clamp(-y / len);
    if (y < -len) y = -len + (y + len) * k;
    p.setXYZ(i, p.getX(i) * s, y, p.getZ(i) * s);
  }
  return g; // (normals kept: the taper is a couple of degrees)
}

function ball(r: number, sx = 1, sy = 1, sz = 1, w = 14, h = 10) {
  const g = new THREE.SphereGeometry(r, w, h);
  g.deleteAttribute('uv');
  g.scale(sx, sy, sz);
  return g;
}

/** A body made of light: hot facing core, bright saturated fresnel rim; `gold` spreads from `goldO` out to `goldR`. */
export function figureMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: color.clone() },
      tint: { value: new THREE.Color(0, 0, 0) },
      tintK: { value: 0 },
      gold: { value: new THREE.Color(0, 0, 0) },
      goldO: { value: new THREE.Vector3() },
      goldR: { value: -1 },
      level: { value: 1 },
    }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mvPosition = viewMatrix * w;
        vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 color, tint, gold, goldO; uniform float tintK, goldR, level;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        float f = abs(dot(normalize(vN), normalize(vV)));
        float rim = 1.0 - f;
        float gk = 1.0 - smoothstep(goldR - 0.5, goldR, distance(vW, goldO));
        vec3 c = mix(color, tint, tintK);
        c = mix(c, gold, gk);
        float lum = max(c.r, max(c.g, c.b));
        vec3 col = c * (0.3 + 0.5 * pow(f, 3.0) + 1.7 * pow(rim, 2.2)) + vec3(lum) * 0.32 * pow(f, 6.0);
        gl_FragColor = vec4(col * level, 1.0);
        #include <fog_fragment>
      }`,
  });
}

/** Limb direction from angles, in the parent's frame (figure faces +z, `side` -1 = -x, +1 = +x). */
export function limbDir(side: number, raise: number, fwd: number, out = new THREE.Vector3()) {
  return out.set(side * Math.sin(raise) * Math.cos(fwd), -Math.cos(raise) * Math.cos(fwd), Math.sin(fwd)).normalize();
}

/** Bend `u` toward `toward` (any vector) by angle `a`: the second segment of a limb. */
export function bend(u: THREE.Vector3, toward: THREE.Vector3, a: number, out = new THREE.Vector3()) {
  const n = toward.clone().addScaledVector(u, -toward.dot(u));
  if (n.lengthSq() < 1e-8) return out.copy(u);
  n.normalize();
  return out.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(n, Math.sin(a)).normalize();
}

/** A ~1.78 m mannequin, origin at the pelvis, facing +z. Sides: index 0 = -x, 1 = +x. */
export class GlowFigure extends THREE.Group {
  static readonly UPPER = 0.27;
  static readonly FORE = 0.25;
  static readonly HAND = 0.045;
  static readonly THIGH = 0.42;
  static readonly SHIN = 0.4;
  mat: THREE.ShaderMaterial;
  spine = new THREE.Group();
  neck = new THREE.Group();
  sh: THREE.Group[] = [];
  el: THREE.Group[] = [];
  hip: THREE.Group[] = [];
  kn: THREE.Group[] = [];
  private _m = new THREE.Matrix4();
  private _q = new THREE.Quaternion();

  constructor(color: THREE.Color) {
    super();
    const mat = (this.mat = figureMaterial(color));
    const M = (g: THREE.BufferGeometry) => new THREE.Mesh(g, mat);
    const F = GlowFigure;
    // pelvis + torso (lathed, flattened front to back)
    this.add(M(ball(0.125, 1.08, 0.78, 0.74)));
    this.add(this.spine);
    const prof = [
      [0.0, -0.06], [0.1, -0.05], [0.128, 0.02], [0.118, 0.12], [0.11, 0.2], [0.13, 0.3], [0.152, 0.39],
      [0.158, 0.45], [0.145, 0.5], [0.1, 0.545], [0.04, 0.565], [0.0, 0.57],
    ].map(([r, y]) => new THREE.Vector2(r!, y!));
    const torso = new THREE.LatheGeometry(prof, 18);
    torso.deleteAttribute('uv');
    torso.scale(1, 1, 0.66);
    this.spine.add(M(torso));
    // neck + head
    this.neck.position.set(0, 0.55, 0);
    this.spine.add(this.neck);
    const neckG = limb(0.042, 0.045, 0.07);
    neckG.rotateZ(Math.PI); // pointing up
    this.neck.add(M(neckG));
    const head = M(ball(0.108, 0.9, 1.1, 0.98, 16, 12));
    head.position.set(0, 0.18, 0.01);
    this.neck.add(head);
    // arms (hand = a ball at the end of the forearm)
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(0.172 * s, 0.47, 0);
      this.spine.add(sh);
      sh.add(M(ball(0.06, 1, 1, 1, 10, 8)));
      sh.add(M(limb(0.052, 0.04, F.UPPER)));
      const el = new THREE.Group();
      el.position.set(0, -F.UPPER, 0);
      sh.add(el);
      const hand = ball(F.HAND, 0.85, 1.25, 0.6, 10, 8);
      hand.translate(0, -F.FORE - F.HAND * 0.7, 0);
      el.add(M(mergeGeometries([limb(0.04, 0.033, F.FORE), hand], false)!));
      this.sh.push(sh);
      this.el.push(el);
      // legs (a small pointed foot at the end of the shin)
      const hip = new THREE.Group();
      hip.position.set(0.084 * s, -0.05, 0);
      this.add(hip);
      hip.add(M(limb(0.07, 0.052, F.THIGH)));
      const kn = new THREE.Group();
      kn.position.set(0, -F.THIGH, 0);
      hip.add(kn);
      const foot = new THREE.CapsuleGeometry(0.036, 0.1, 3, 8);
      foot.deleteAttribute('uv');
      foot.rotateX(0.5);
      foot.translate(0, -F.SHIN - 0.06, 0.03);
      kn.add(M(mergeGeometries([limb(0.05, 0.036, F.SHIN), foot], false)!));
      this.hip.push(hip);
      this.kn.push(kn);
    }
  }

  /** Curl the upper body toward +z (arch) and sideways toward +x (lean); nod/tilt the head. */
  setSpine(arch: number, lean: number, nod = 0, tilt = 0) {
    this.spine.rotation.set(arch, 0, -lean);
    this.neck.rotation.set(nod, 0, -tilt);
  }

  /** Arm `i` (0 = -x, 1 = +x) along u1 (upper) and u2 (forearm), directions in the spine frame. */
  setArm(i: number, u1: THREE.Vector3, u2: THREE.Vector3) {
    this.aimPair(this.sh[i]!, this.el[i]!, u1, u2);
  }

  /** Leg `i` along u1 (thigh) and u2 (shin), directions in the figure frame. */
  setLeg(i: number, u1: THREE.Vector3, u2: THREE.Vector3) {
    this.aimPair(this.hip[i]!, this.kn[i]!, u1, u2);
  }

  private aimPair(a: THREE.Group, b: THREE.Group, u1: THREE.Vector3, u2: THREE.Vector3) {
    a.quaternion.setFromUnitVectors(DOWN, u1);
    const l = u2.clone().applyQuaternion(this._q.copy(a.quaternion).invert());
    b.quaternion.setFromUnitVectors(DOWN, l.normalize());
  }

  /**
   * 2-bone IK: put the centre of hand `i` at `target` (world), elbow bending toward `pole` (spine frame).
   * Call after the figure's own transform and spine are set; returns the reach (0..1 of the arm length).
   */
  reach(i: number, target: THREE.Vector3, pole: THREE.Vector3) {
    this.updateMatrixWorld(true);
    const T = target.clone().applyMatrix4(this._m.copy(this.spine.matrixWorld).invert());
    const S = this.sh[i]!.position;
    const L1 = GlowFigure.UPPER, L2 = GlowFigure.FORE + GlowFigure.HAND * 0.7;
    const D = T.clone().sub(S);
    const d = clamp(D.length(), 0.08, (L1 + L2) * 0.999);
    D.normalize();
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const u1 = bend(D, pole, a);
    const E = S.clone().addScaledVector(u1, L1);
    const u2 = T.clone().sub(E);
    if (u2.lengthSq() < 1e-8) u2.copy(D);
    this.setArm(i, u1, u2.normalize());
    return d / (L1 + L2);
  }

  /** World position of the centre of hand `i` (call after posing; updates world matrices). */
  hand(i: number, out = new THREE.Vector3()) {
    this.updateMatrixWorld(true);
    return out.set(0, -GlowFigure.FORE - GlowFigure.HAND * 0.7, 0).applyMatrix4(this.el[i]!.matrixWorld);
  }

  /** World position of a point in the spine frame (e.g. the chest), for halos and light. */
  spinePoint(x: number, y: number, z: number, out = new THREE.Vector3()) {
    this.updateMatrixWorld(true);
    return out.set(x, y, z).applyMatrix4(this.spine.matrixWorld);
  }

  override dispose() {
    this.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    this.mat.dispose();
  }
}
