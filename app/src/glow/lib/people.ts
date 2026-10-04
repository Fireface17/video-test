// People of light: realistic rigged human bodies (the Mixamo rigs from the three.js examples: X Bot, a smooth
// mannequin, and Michelle; see app/public/models/CREDITS.md), posed procedurally and drawn self-lit.
// `RealFigure` has the bridge's GlowFigure API (limb directions, spine, 2-bone IK for the hands), so a scene
// poses it the same way; `bakePose` freezes a posed body into a static geometry for instanced crowds.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { clamp } from '../../engine/util';
import { GlowPoints } from './points';

export type BodyKind = 'xbot' | 'michelle' | 'rpm';
const FILES: Record<BodyKind, string> = { xbot: 'models/Xbot.glb', michelle: 'models/Michelle.glb', rpm: 'models/readyplayer.me.glb' };
/** Standing height (m) each body is scaled to. */
const HEIGHT: Record<BodyKind, number> = { xbot: 1.8, michelle: 1.7, rpm: 1.8 };

const gltfs = new Map<BodyKind, Promise<GLTF>>();
export function loadBody(kind: BodyKind): Promise<GLTF> {
  let p = gltfs.get(kind);
  if (!p) {
    p = new GLTFLoader().loadAsync(FILES[kind]);
    gltfs.set(kind, p);
  }
  return p;
}

const SKIN_VERT = /* glsl */ `
  #include <common>
  #include <skinning_pars_vertex>
  #include <fog_pars_vertex>
  varying vec3 vN; varying vec3 vV; varying vec3 vW;
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 w = modelMatrix * vec4(transformed, 1.0);
    vW = w.xyz;
    vec4 mvPosition = viewMatrix * w;
    vN = normalMatrix * objectNormal; vV = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }`;

/**
 * A body made of light (skinned): see-through glowing glass — a soft inner glow, a bright rim that runs to white
 * at the silhouette, light flowing up through the body in slow bands and fine glints; additive (the figure is
 * drawn with a depth prepass so only its nearest surface shows). `tint` colours it; `gold` spreads from `goldO`
 * out to `goldR`. Set `time` (song seconds) for the flow.
 */
export function glowBodyMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      color: { value: color.clone() },
      tint: { value: new THREE.Color(0, 0, 0) },
      tintK: { value: 0 },
      gold: { value: new THREE.Color(0, 0, 0) },
      goldO: { value: new THREE.Vector3() },
      goldR: { value: -1 },
      level: { value: 1 },
      time: { value: 0 },
    }]),
    vertexShader: SKIN_VERT,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 color, tint, gold, goldO; uniform float tintK, goldR, level, time;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float n3(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      void main() {
        float ln = length(vN), lv = length(vV);
        vec3 n = ln > 1e-5 ? vN / ln : vec3(0.0, 0.0, 1.0), v = lv > 1e-5 ? vV / lv : vec3(0.0, 0.0, 1.0);
        float f = clamp(abs(dot(n, v)), 0.0, 1.0);
        float rim = 1.0 - f;
        float gk = 1.0 - smoothstep(goldR - 0.5, goldR, distance(vW, goldO));
        vec3 c = mix(color, tint, tintK);
        c = mix(c, gold, gk);
        float lum = max(c.r, max(c.g, c.b));
        // light rising through the body in soft bands, and fine glints that twinkle
        float flow = n3(vec3(vW.x * 3.0, vW.y * 2.2 - time * 1.1, vW.z * 3.0));
        float bands = smoothstep(0.55, 0.9, flow);
        float glint = step(0.985, h3(floor(vW * 90.0) + floor(time * 8.0))) * f;
        float r2 = rim * rim, r4 = r2 * r2;
        vec3 col = c * (0.07 + 0.35 * bands + 0.9 * r2 + 2.2 * r4 * r2) + mix(c, vec3(lum), 0.6) * 1.6 * r4 * r4 + vec3(lum) * (0.12 * pow(f, 8.0) + 1.5 * glint);
        gl_FragColor = vec4(col * level, 1.0);
        #include <fog_fragment>
      }`,
  });
}

/** A see-through ghost (skinned): faint body, pale rim; additive, no depth write. */
export function ghostBodyMaterial(color: THREE.Color) {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { color: { value: color.clone() }, level: { value: 1 } }]),
    vertexShader: SKIN_VERT,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform vec3 color; uniform float level;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() {
        float ln = length(vN), lv = length(vV);
        vec3 n = ln > 1e-5 ? vN / ln : vec3(0.0, 0.0, 1.0), v = lv > 1e-5 ? vV / lv : vec3(0.0, 0.0, 1.0);
        float rim = 1.0 - clamp(abs(dot(n, v)), 0.0, 1.0);
        gl_FragColor = vec4(color * level * (0.08 + 0.35 * pow(rim, 1.5) + 0.9 * pow(rim, 4.0)), 1.0);
        #include <fog_fragment>
      }`,
  });
}

const DOWN = new THREE.Vector3(0, -1, 0);
// (pushed back a hair, so the body's own colour pass always wins the depth test against it)
const DEPTH_ONLY = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
const SIDES = ['Right', 'Left'] as const; // index 0 = -x (the body's right), 1 = +x (its left)
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'] as const;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

/**
 * A realistic body, origin at the pelvis, facing +z, y up. Sides: index 0 = -x, 1 = +x.
 * Pose with setSpine / setArm / setLeg / setHand / setFoot (or reach for IK); the pose is applied lazily
 * from the rest pose, so the setters can be called in any order.
 */
export class RealFigure extends THREE.Group {
  mat: THREE.ShaderMaterial;
  meshes: THREE.SkinnedMesh[] = [];
  /** Segment lengths (m): upper arm, forearm to the palm centre, thigh, shin; pelvis height above the soles. */
  upper = 0; fore = 0; thigh = 0; shin = 0; hipHeight = 0;
  private body = new THREE.Group();
  private bones = new Map<string, THREE.Bone>();
  private rest: [THREE.Bone, THREE.Quaternion][] = [];
  private spine = [0, 0, 0, 0]; // arch, lean, nod, tilt
  private arms: ([THREE.Vector3, THREE.Vector3] | null)[] = [null, null];
  private legs: ([THREE.Vector3, THREE.Vector3] | null)[] = [null, null];
  private twist = [0, 0];
  private curl = [0.3, 0.3];
  private point = [0, 0];
  private dirty = true;
  private applying = false;

  /**
   * `material` replaces the self-lit default (e.g. ghostBodyMaterial); `prepass` first lays down the body's depth
   * (no colour), so a see-through material shows only the nearest surface, not the layers inside.
   */
  constructor(gltf: GLTF, readonly kind: BodyKind, color: THREE.Color, material?: THREE.ShaderMaterial, o: { prepass?: boolean; hat?: boolean } = {}) {
    super();
    this.mat = material ?? glowBodyMaterial(color);
    const root = cloneSkinned(gltf.scene);
    const skinned: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name.replace(/^mixamorig:?/, ''), o as THREE.Bone);
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    for (const m of skinned) {
      // (the avatar's hat is left out unless asked for)
      const name = Array.isArray(m.material) ? '' : (m.material as THREE.Material).name;
      if (!o.hat && /Headwear/.test(name)) { m.removeFromParent(); continue; }
      m.material = this.mat;
      m.frustumCulled = false;
      this.meshes.push(m);
      if (o.prepass ?? this.mat.transparent) {
        const d = new THREE.SkinnedMesh(m.geometry, DEPTH_ONLY);
        d.bind(m.skeleton, m.bindMatrix);
        d.position.copy(m.position); d.quaternion.copy(m.quaternion); d.scale.copy(m.scale);
        d.frustumCulled = false;
        d.renderOrder = -10;
        m.parent!.add(d);
      }
    }
    for (const b of this.bones.values()) this.rest.push([b, b.quaternion.clone()]);
    this.body.add(root);
    this.add(this.body);
    // face +z (toes forward) and stand `HEIGHT` tall, pelvis at the origin
    super.updateMatrixWorld(true);
    const fwd = this.wpos('LeftToe_End').sub(this.wpos('LeftFoot')).setY(0).normalize();
    root.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), Math.atan2(fwd.x, fwd.z) * -1);
    super.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root, true);
    const s = HEIGHT[kind] / (box.max.y - box.min.y);
    this.body.scale.setScalar(s);
    super.updateMatrixWorld(true);
    this.hipHeight = this.wpos('Hips').y - box.min.y * s;
    this.body.position.copy(this.wpos('Hips')).multiplyScalar(-1);
    super.updateMatrixWorld(true);
    if (this.wpos('LeftArm').x < 0) throw new Error(`${kind}: the body's left is not at +x`);
    this.upper = this.wpos('LeftForeArm').distanceTo(this.wpos('LeftArm'));
    this.fore = this.wpos('LeftHand').distanceTo(this.wpos('LeftForeArm')) + 0.55 * this.wpos('LeftHandMiddle1').distanceTo(this.wpos('LeftHand'));
    this.thigh = this.wpos('LeftLeg').distanceTo(this.wpos('LeftUpLeg'));
    this.shin = this.wpos('LeftFoot').distanceTo(this.wpos('LeftLeg'));
  }

  /** Song time for the material's flowing light. */
  set time(t: number) { const u = this.mat.uniforms.time; if (u) u.value = t; }

  bone(name: string) {
    const b = this.bones.get(name);
    if (!b) throw new Error(`${this.kind}: no bone ${name}`);
    return b;
  }

  private wpos(name: string, out = new THREE.Vector3()) {
    return this.bone(name).getWorldPosition(out);
  }

  /** Curl the upper body toward +z (arch) and sideways toward +x (lean); nod/tilt the head. */
  setSpine(arch: number, lean: number, nod = 0, tilt = 0) {
    this.spine = [arch, lean, nod, tilt];
    this.dirty = true;
  }

  /** Arm `i` (0 = -x, 1 = +x) along u1 (upper) and u2 (forearm), directions in the spine frame; `twist` rolls the upper arm. */
  setArm(i: number, u1: THREE.Vector3, u2: THREE.Vector3, twist = 0) {
    this.arms[i] = [u1.clone(), u2.clone()];
    this.twist[i] = twist;
    this.dirty = true;
  }

  /** Leg `i` along u1 (thigh) and u2 (shin), directions in the figure frame. */
  setLeg(i: number, u1: THREE.Vector3, u2: THREE.Vector3) {
    this.legs[i] = [u1.clone(), u2.clone()];
    this.dirty = true;
  }

  /** Fingers of hand `i`: 0 = open, 1 = fist. */
  setHand(i: number, curl: number) {
    this.curl[i] = curl;
    this.dirty = true;
  }

  /** Point the toes of foot `i` (0 = flat, 1 = fully pointed). */
  setFoot(i: number, point: number) {
    this.point[i] = point;
    this.dirty = true;
  }

  override updateMatrixWorld(force?: boolean) {
    if (this.dirty && !this.applying) this.apply();
    super.updateMatrixWorld(force);
  }

  /** Spine frame (world): the figure's rotation followed by the spine's arch/lean. */
  private spineQ(out: THREE.Quaternion) {
    this.getWorldQuaternion(out);
    return out.multiply(_q2.setFromEuler(new THREE.Euler(this.spine[0]!, 0, -this.spine[1]!)));
  }

  /** Rotate `bone` by the world-space rotation `q` about its own joint. */
  private rot(bone: THREE.Bone, q: THREE.Quaternion) {
    const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
    bone.updateMatrixWorld(true);
  }

  /** Turn `bone` so that the direction to `child` becomes `dir` (world). */
  private aim(bone: THREE.Bone, child: THREE.Bone, dir: THREE.Vector3) {
    const a = bone.getWorldPosition(_v1), b = child.getWorldPosition(_v2);
    this.rot(bone, _q1.setFromUnitVectors(b.sub(a).normalize(), dir));
  }

  private apply() {
    this.applying = true;
    this.dirty = false;
    for (const [b, q] of this.rest) b.quaternion.copy(q);
    super.updateMatrixWorld(true);
    const F = this.getWorldQuaternion(new THREE.Quaternion());
    const toWorld = (q: THREE.Quaternion) => F.clone().multiply(q).multiply(F.clone().invert());
    // spine: arch and lean spread over the three spine bones
    const [arch, lean, nod, tilt] = this.spine as [number, number, number, number];
    const third = new THREE.Quaternion().slerp(toWorld(new THREE.Quaternion().setFromEuler(new THREE.Euler(arch, 0, -lean))), 1 / 3);
    for (const n of ['Spine', 'Spine1', 'Spine2']) this.rot(this.bone(n), third);
    const S = this.spineQ(new THREE.Quaternion());
    const head = S.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(nod, 0, -tilt))).multiply(S.clone().invert());
    const half = new THREE.Quaternion().slerp(head, 0.5);
    this.rot(this.bone('Neck'), half);
    this.rot(this.bone('Head'), half);
    // arms (hanging relaxed unless set), a shrug when raised above the shoulder, fingers
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i]!, sx = i === 0 ? -1 : 1;
      const [u1, u2] = this.arms[i] ?? [new THREE.Vector3(sx * 0.12, -1, 0.02).normalize(), new THREE.Vector3(sx * 0.1, -1, 0.15).normalize()];
      const d1 = u1.clone().applyQuaternion(S), d2 = u2.clone().applyQuaternion(S);
      const lift = clamp((Math.acos(clamp(-u1.y, -1, 1)) - Math.PI / 2) / (Math.PI / 2));
      if (lift > 0) this.rot(this.bone(`${side}Shoulder`), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1).applyQuaternion(S), sx * 0.32 * lift));
      this.aim(this.bone(`${side}Arm`), this.bone(`${side}ForeArm`), d1);
      if (this.twist[i]) this.rot(this.bone(`${side}Arm`), new THREE.Quaternion().setFromAxisAngle(d1, this.twist[i]!));
      this.aim(this.bone(`${side}ForeArm`), this.bone(`${side}Hand`), d2);
      this.fingers(i, this.curl[i]!);
    }
    // legs
    for (let i = 0; i < 2; i++) {
      const side = SIDES[i]!, leg = this.legs[i];
      if (leg) {
        this.aim(this.bone(`${side}UpLeg`), this.bone(`${side}Leg`), leg[0].clone().applyQuaternion(F));
        this.aim(this.bone(`${side}Leg`), this.bone(`${side}Foot`), leg[1].clone().applyQuaternion(F));
      }
      if (this.point[i]) {
        const foot = this.bone(`${side}Foot`), shinDir = foot.getWorldPosition(_v3).sub(this.bone(`${side}Leg`).getWorldPosition(new THREE.Vector3())).normalize();
        const toe = this.bone(`${side}ToeBase`).getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(new THREE.Vector3())).normalize();
        const axis = new THREE.Vector3().crossVectors(toe, shinDir).normalize();
        if (axis.lengthSq() > 0.5) this.rot(foot, new THREE.Quaternion().setFromAxisAngle(axis, 0.9 * this.point[i]!));
      }
    }
    this.applying = false;
  }

  /** Curl the fingers of hand `i` toward the palm (0 = open, 1 = fist). */
  private fingers(i: number, curl: number) {
    const side = SIDES[i]!;
    const h = this.wpos(`${side}Hand`);
    const toI = this.wpos(`${side}HandIndex1`).sub(h), toP = this.wpos(`${side}HandPinky1`).sub(h);
    const palm = new THREE.Vector3().crossVectors(toI, toP).normalize().multiplyScalar(i === 1 ? -1 : 1);
    const bendTo = (b: THREE.Bone, c: THREE.Bone, a: number) => {
      const d = c.getWorldPosition(_v2).sub(b.getWorldPosition(_v1)).normalize();
      const axis = new THREE.Vector3().crossVectors(d, palm);
      if (axis.lengthSq() < 1e-8) return;
      this.rot(b, _q1.setFromAxisAngle(axis.normalize(), a));
    };
    const relax = 0.12; // even an open hand is a little curled
    for (const f of FINGERS) [0.75, 1.05, 0.8].forEach((a, j) => bendTo(this.bone(`${side}Hand${f}${j + 1}`), this.bone(`${side}Hand${f}${j + 2}`), (relax + curl) * a * (f === 'Pinky' ? 1.1 : 1)));
    [0.15, 0.35, 0.45].forEach((a, j) => bendTo(this.bone(`${side}HandThumb${j + 1}`), this.bone(`${side}HandThumb${j + 2}`), (relax + curl) * a));
  }

  /**
   * 2-bone IK: put the centre of hand `i` at `target` (world), elbow bending toward `pole` (spine frame).
   * Call after the figure's own transform and spine are set; returns the reach (0..1 of the arm length).
   */
  reach(i: number, target: THREE.Vector3, pole: THREE.Vector3) {
    this.updateMatrixWorld(true);
    const S = this.spineQ(new THREE.Quaternion()), Si = S.clone().invert(), O = this.getWorldPosition(new THREE.Vector3());
    const T = target.clone().sub(O).applyQuaternion(Si);
    const sh = this.wpos(`${SIDES[i]}Arm`).sub(O).applyQuaternion(Si);
    const L1 = this.upper, L2 = this.fore;
    const D = T.clone().sub(sh);
    const d = clamp(D.length(), 0.08, (L1 + L2) * 0.999);
    D.normalize();
    const a = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    const n = pole.clone().addScaledVector(D, -pole.dot(D));
    const u1 = n.lengthSq() < 1e-8 ? D.clone() : D.clone().multiplyScalar(Math.cos(a)).addScaledVector(n.normalize(), Math.sin(a)).normalize();
    const E = sh.clone().addScaledVector(u1, L1);
    const u2 = T.clone().sub(E);
    if (u2.lengthSq() < 1e-8) u2.copy(D);
    this.setArm(i, u1, u2.normalize(), this.twist[i]);
    return d / (L1 + L2);
  }

  /** World position of the centre of hand `i` (after posing). */
  hand(i: number, out = new THREE.Vector3()) {
    this.updateMatrixWorld(true);
    const side = SIDES[i]!;
    const h = this.wpos(`${side}Hand`);
    return out.copy(h).lerp(this.wpos(`${side}HandMiddle1`), 0.55);
  }

  /** World position of the ball of foot `i`. */
  foot(i: number, out = new THREE.Vector3()) {
    this.updateMatrixWorld(true);
    return this.wpos(`${SIDES[i]}ToeBase`, out);
  }

  /** World position of a point in the spine frame (pelvis origin; e.g. the chest at y = 0.3). */
  spinePoint(x: number, y: number, z: number, out = new THREE.Vector3()) {
    this.updateMatrixWorld(true);
    return out.set(x, y, z).applyQuaternion(this.spineQ(new THREE.Quaternion())).add(this.getWorldPosition(new THREE.Vector3()));
  }

  /** World position of the head (between the eyes). */
  headPoint(out = new THREE.Vector3()) {
    this.updateMatrixWorld(true);
    return this.wpos('Head', out).lerp(this.wpos('HeadTop_End'), 0.45);
  }

  override dispose() {
    this.mat.dispose();
  }
}

/**
 * Freeze the current pose of `fig` into one static indexed geometry (positions + normals in the figure's
 * frame), for InstancedMesh crowds.
 */
export function bakePose(fig: RealFigure): THREE.BufferGeometry {
  fig.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(fig.matrixWorld).invert();
  const parts: THREE.BufferGeometry[] = [];
  for (const m of fig.meshes) {
    const src = m.geometry;
    const pos = src.attributes.position as THREE.BufferAttribute, nor = src.attributes.normal as THREE.BufferAttribute;
    const si = src.attributes.skinIndex as THREE.BufferAttribute, sw = src.attributes.skinWeight as THREE.BufferAttribute;
    m.skeleton.update();
    const bm = m.skeleton.boneMatrices!;
    const toFig = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld).multiply(m.bindMatrixInverse);
    const P = new Float32Array(pos.count * 3), N = new Float32Array(pos.count * 3);
    const M = new THREE.Matrix4(), K = new THREE.Matrix4(), v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
    for (let i = 0; i < pos.count; i++) {
      K.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w === 0) continue;
        M.fromArray(bm, si.getComponent(i, k) * 16);
        for (let e = 0; e < 16; e++) K.elements[e]! += w * M.elements[e]!;
      }
      K.multiply(m.bindMatrix).premultiply(toFig);
      v.fromBufferAttribute(pos, i).applyMatrix4(K);
      n.fromBufferAttribute(nor, i).applyMatrix3(nm.getNormalMatrix(K)).normalize();
      P.set([v.x, v.y, v.z], i * 3);
      N.set([n.x, n.y, n.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    if (src.index) g.setIndex(src.index.clone());
    parts.push(g);
  }
  return mergeIndexed(parts);
}

function mergeIndexed(parts: THREE.BufferGeometry[]) {
  let nv = 0, ni = 0;
  for (const g of parts) { nv += g.attributes.position!.count; ni += g.index ? g.index.count : g.attributes.position!.count; }
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const g of parts) {
    P.set(g.attributes.position!.array as Float32Array, ov * 3);
    N.set(g.attributes.normal!.array as Float32Array, ov * 3);
    const c = g.attributes.position!.count;
    if (g.index) for (let k = 0; k < g.index.count; k++) I[oi++] = g.index.getX(k) + ov;
    else for (let k = 0; k < c; k++) I[oi++] = k + ov;
    ov += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setIndex(new THREE.BufferAttribute(I, 1));
  out.computeBoundingSphere();
  return out;
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

export { DOWN };

/**
 * A dance step on the beat grid: poses `fig` for continuous beat position `beat` in one of four styles
 * (0 arms-up pump, 1 overhead wave, 2 jump, 3 point and swap), scaled by `energy` (0..1). Returns the
 * vertical bounce (m) to add to the figure's height.
 */
export function dance(fig: RealFigure, beat: number, style: number, energy = 1, seed = 0): number {
  const b = Math.floor(beat), ph = beat - b;
  const hit = Math.exp(-ph * 6); // sharp on the beat
  const sw = Math.sin((beat + seed) * Math.PI * 0.5);
  const e = energy;
  let bounce = 0;
  for (const i of [0, 1]) { const th = limbDir(i ? 1 : -1, 0.06, 0); fig.setLeg(i, th, th); }
  const arm = (i: number, raise: number, fwd: number, elbow: number, twist = 0) => {
    const s = i ? 1 : -1;
    const u = limbDir(s, raise, fwd);
    fig.setArm(i, u, bend(u, new THREE.Vector3(-s * 0.4, 0.1, 1), elbow), twist);
  };
  if (style === 0) {
    const pump = 0.35 * hit * e;
    arm(0, 2.5 - pump, 0.2, 0.25 + pump);
    arm(1, 2.5 - pump, 0.2, 0.25 + pump);
    bounce = -0.06 * hit * e;
    fig.setSpine(-0.1 * e, 0.06 * sw * e, -0.25 + 0.15 * hit * e, 0.1 * sw);
  } else if (style === 1) {
    arm(0, 2.6 + 0.35 * sw * e, 0.1, 0.35, -0.3);
    arm(1, 2.6 - 0.35 * sw * e, 0.1, 0.35, 0.3);
    fig.setSpine(-0.05, 0.18 * sw * e, -0.2, 0.15 * sw * e);
  } else if (style === 2) {
    const crouch = Math.max(0, Math.sin(ph * Math.PI * 2 + 1.2)) * 0.5 * e;
    const air = Math.max(0, Math.sin(ph * Math.PI)) * 0.25 * e;
    bounce = air - 0.12 * crouch;
    arm(0, 1.2 + 1.5 * (1 - crouch), 0.3, 0.5);
    arm(1, 1.2 + 1.5 * (1 - crouch), 0.3, 0.5);
    for (const i of [0, 1]) {
      const s = i ? 1 : -1, th = limbDir(s, 0.08, 0.5 * crouch);
      fig.setLeg(i, th, bend(th, new THREE.Vector3(0, 0, -1), 1.2 * crouch));
    }
    fig.setSpine(0.15 * crouch, 0, -0.2, 0);
  } else {
    const which = b % 4 < 2 ? 0 : 1;
    arm(which, 2.9, 0.35, 0.05);
    arm(1 - which, 0.6 + 0.4 * hit * e, 0.5, 1.4);
    fig.setSpine(-0.05, (which ? 0.12 : -0.12) * e, -0.3, (which ? -0.1 : 0.1));
    bounce = -0.04 * hit * e;
  }
  for (const i of [0, 1]) fig.setHand(i, style === 3 ? 0.7 : 0.15);
  return bounce;
}

const MOTE_BONES = ['Hips', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];

/** Motes of light drifting up off a figure of light, a pure function of t: `update(fig, t, colour, k)` per frame. */
export class LightMotes extends GlowPoints {
  constructor(n = 140, size = 0.035, public life = 1.8) { super(n, size); }

  update(fig: RealFigure, t: number, c: THREE.Color, k = 1) {
    fig.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (let i = 0; i < this.n; i++) {
      const ph = hash01(i, 1) * this.life, cyc = Math.floor((t + ph) / this.life), age = t + ph - cyc * this.life, u = age / this.life;
      const bone = MOTE_BONES[Math.floor(hash01(i, cyc) * MOTE_BONES.length)]!;
      fig.bone(bone).getWorldPosition(p);
      p.x += (hash01(i, cyc + 3) - 0.5) * 0.25 + Math.sin(age * 2.3 + i) * 0.05 * u;
      p.z += (hash01(i, cyc + 5) - 0.5) * 0.25 + Math.cos(age * 1.9 + i) * 0.05 * u;
      p.y += (hash01(i, cyc + 7) - 0.5) * 0.2 + age * (0.25 + 0.3 * hash01(i, 9));
      this.set(i, p.x, p.y, p.z, c, k * Math.sin(Math.PI * u) * (0.4 + 0.6 * hash01(i, cyc + 11)), 0.5 + hash01(i, 13) * 1.2);
    }
    this.commit();
  }
}

function hash01(a: number, b: number) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
