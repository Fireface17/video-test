// Constellations: glowing line segments (camera-facing, instanced, rewritten every frame) and star-figures —
// people drawn as constellations, a star on each joint of a posed realistic body (lib/people.ts) joined by
// faint lines, so they can dance on the beat as figures made of stars.
import * as THREE from 'three';
import type { RealFigure } from './people';
import { GlowPoints } from './points';

/** Instanced glowing segments: set(i, a, b, color, k) per frame, then commit(n). Width is in world units. */
export class GlowLines extends THREE.Mesh {
  declare geometry: THREE.InstancedBufferGeometry;
  declare material: THREE.ShaderMaterial;
  private aA: THREE.InstancedBufferAttribute;
  private aB: THREE.InstancedBufferAttribute;
  private aC: THREE.InstancedBufferAttribute;

  constructor(public n: number, width = 0.02) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const aA = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const aB = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const aC = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aA', aA); g.setAttribute('aB', aB); g.setAttribute('aC', aC);
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { width: { value: width } },
      vertexShader: /* glsl */ `
        attribute vec3 aA, aB, aC; uniform float width;
        varying vec3 vC; varying float vS;
        void main() {
          vec4 a = modelViewMatrix * vec4(aA, 1.0), b = modelViewMatrix * vec4(aB, 1.0);
          vec4 p = mix(a, b, position.x);
          vec3 d = b.xyz - a.xyz; float dl = length(d);
          vec3 dir = dl > 1e-6 ? d / dl : vec3(1.0, 0.0, 0.0);
          vec3 sd = cross(dir, normalize(-p.xyz)); float sl = length(sd);
          sd = sl > 1e-6 ? sd / sl : vec3(0.0, 1.0, 0.0);
          p.xyz += sd * position.y * width;
          vC = aC; vS = position.y;
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; varying float vS;
        void main() { float k = exp(-vS * vS * 6.0) + 0.35 * exp(-vS * vS * 1.2); gl_FragColor = vec4(vC * k, 1.0); }`,
    });
    super(g, mat);
    this.aA = aA; this.aB = aB; this.aC = aC;
    this.frustumCulled = false;
  }

  set(i: number, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Color, k = 1) {
    this.aA.setXYZ(i, a.x, a.y, a.z);
    this.aB.setXYZ(i, b.x, b.y, b.z);
    this.aC.setXYZ(i, c.r * k, c.g * k, c.b * k);
  }

  commit(n: number) {
    this.geometry.instanceCount = n;
    this.aA.needsUpdate = this.aB.needsUpdate = this.aC.needsUpdate = true;
  }
}

/** The joints a star-figure shows, and how they are joined (bone names of the Mixamo rig). */
export const STAR_JOINTS = ['Head', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'Hips', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'] as const;
export const STAR_EDGES: [number, number][] = [[0, 1], [1, 2], [1, 3], [2, 4], [4, 6], [3, 5], [5, 7], [1, 8], [8, 9], [9, 11], [8, 10], [10, 12]];

/**
 * World positions of a posed figure's star joints (after its pose is set). The head star sits at the
 * middle of the head; shoulders use the arm roots so the figure reads as broad.
 */
export function starJoints(fig: RealFigure, out: THREE.Vector3[] = []): THREE.Vector3[] {
  fig.updateMatrixWorld(true);
  const names = ['Head', 'Neck', 'LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand', 'Hips', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot'];
  names.forEach((n, i) => {
    const v = out[i] ?? (out[i] = new THREE.Vector3());
    if (n === 'Head') fig.headPoint(v);
    else fig.bone(n).getWorldPosition(v);
  });
  return out;
}

/** Draw star-figures: a star per joint (GlowPoints) and lines along the edges (GlowLines). */
export class StarFigures extends THREE.Group {
  points: GlowPoints;
  lines: GlowLines;
  private np = 0;
  private nl = 0;

  constructor(maxFigures: number, starSize = 0.06, lineWidth = 0.012) {
    super();
    this.points = new GlowPoints(maxFigures * STAR_JOINTS.length * 2, starSize);
    this.lines = new GlowLines(maxFigures * STAR_EDGES.length, lineWidth);
    this.add(this.lines, this.points);
  }

  begin() { this.np = 0; this.nl = 0; }

  /** Add one figure from its joints; `draw` (0..1) reveals the edges in order, `k` scales the light. */
  figure(j: THREE.Vector3[], star: THREE.Color, line: THREE.Color, k = 1, draw = 1, starScale = 1) {
    j.forEach((p, i) => this.points.set(this.np++, p.x, p.y, p.z, star, k, (i === 0 ? 1.6 : i === 6 || i === 7 ? 1.25 : 1) * starScale));
    const n = STAR_EDGES.length, shown = draw * n;
    STAR_EDGES.forEach(([a, b], e) => {
      const u = Math.max(0, Math.min(1, shown - e));
      if (u <= 0) return;
      const pa = j[a]!, pb = pa.clone().lerp(j[b]!, u);
      this.lines.set(this.nl++, pa, pb, line, k);
    });
  }

  /** An extra star (e.g. a flash where two hands meet). */
  star(p: THREE.Vector3, c: THREE.Color, k = 1, size = 1) { this.points.set(this.np++, p.x, p.y, p.z, c, k, size); }

  end() { this.points.commit(this.np); this.lines.commit(this.nl); }
}
