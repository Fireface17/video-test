// The two people the story follows (docs/glow/TREATMENT.md) and the things they carry, so every scene shows
// the same people: HIM — a person of light in cool blue, carrying a glow-in-the-dark star sticker from his
// bedroom ceiling; HER — the neighbour across the street, rose-peach, carrying a paper lantern that won't
// light (until his star lights it). Scenes pose them (lib/motion.ts for real motion, setArm/reach on top).
import * as THREE from 'three';
import { RealFigure, glowBodyMaterial, loadBody } from './people';
import { col } from './palette';
import { starGeometry } from './shapes';
import { noise1 } from '../../engine/util';

/** His light (cool blue) and hers (rose-peach); together they turn gold (`col('gold')`). */
export const heColor = () => col('cyan', 1.12).lerp(col('blue', 1.3), 0.32);
export const sheColor = () => col('pink', 1.2).lerp(col('gold', 1.2), 0.18);

/** Him (Ready Player Me body) and her (Michelle), people of light. */
export async function makeHeroes(): Promise<{ he: RealFigure; she: RealFigure }> {
  const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
  const he = new RealFigure(rp, 'rpm', heColor(), glowBodyMaterial(heColor()));
  const she = new RealFigure(mi, 'michelle', sheColor(), glowBodyMaterial(sheColor()));
  return { he, she };
}

let haloTex: THREE.DataTexture | null = null;
/** A soft round glow texture (shared). */
export function haloTexture() {
  if (haloTex) return haloTex;
  const n = 64, d = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1, r2 = dx * dx + dy * dy;
    const v = r2 < 1 ? Math.min(1, Math.exp(-r2 * 5) * 0.8 + Math.exp(-r2 * 30) * 0.5) : 0;
    const b = Math.round(v * 255);
    d.set([b, b, b, b], (y * n + x) * 4);
  }
  haloTex = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  haloTex.magFilter = haloTex.minFilter = THREE.LinearFilter;
  haloTex.needsUpdate = true;
  return haloTex;
}

function halo(c: THREE.Color, size: number) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(size);
  return s;
}

/** His star: a phosphor-green sticker star (5 cm) with its glow; `level` 0..1 (+ flashes above 1). */
export class StarSticker extends THREE.Group {
  private mat: THREE.MeshBasicMaterial;
  private glow: THREE.Sprite;
  private c = col('phosphor', 1.3).lerp(col('white', 1.3), 0.15);

  constructor(public size = 0.05) {
    super();
    this.mat = new THREE.MeshBasicMaterial({ color: this.c.clone() });
    const star = new THREE.Mesh(starGeometry(0.12, 0.05), this.mat);
    star.scale.setScalar(size);
    this.glow = halo(col('phosphor', 0.5), size * 9);
    this.add(star, this.glow);
  }

  set level(k: number) {
    this.mat.color.copy(this.c).multiplyScalar(0.25 + 0.75 * k);
    this.glow.material.color.copy(col('phosphor', 0.5)).multiplyScalar(k);
    this.glow.scale.setScalar(this.size * (7 + 4 * Math.min(k, 2)));
  }
}

/**
 * Her paper lantern: a ribbed paper globe (~22 cm) on a wire handle. `lit` 0..1: unlit it's pale paper
 * that only catches light; lit, a warm flame glows through the paper with a gentle flicker (`time`).
 */
export class PaperLantern extends THREE.Group {
  lit = 0;
  time = 0;
  private paper: THREE.ShaderMaterial;
  private glow: THREE.Sprite;
  private flame: THREE.Sprite;

  constructor(public r = 0.11) {
    super();
    // the profile of a round paper lantern with flat rims, revolved
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = -Math.PI / 2 + (i / 24) * Math.PI;
      prof.push(new THREE.Vector2(Math.max(0.28, Math.cos(a)) * r, Math.sin(a) * r * 1.1));
    }
    const g = new THREE.LatheGeometry(prof, 48);
    this.paper = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { lit: { value: 0 }, warm: { value: col('gold', 1.6).lerp(col('ember', 1.6), 0.25) }, paperC: { value: col('white', 0.07).lerp(col('pink', 0.07), 0.3) } },
      vertexShader: /* glsl */ `varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() { vP = position; vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float lit; uniform vec3 warm, paperC; varying vec3 vP; varying vec3 vN; varying vec3 vV;
        void main() {
          float a = atan(vP.z, vP.x + 1e-5);
          float rib = 0.55 + 0.45 * smoothstep(0.0, 0.25, abs(fract(a * 16.0 / 6.2831) - 0.5) * 2.0);
          float h = vP.y / ${(r * 1.1).toFixed(4)};
          float core = exp(-h * h * 1.8);
          float f = abs(dot(normalize(vN), normalize(vV)));
          // unlit: pale paper, its ribs and its rim catching light; lit: the flame through the paper
          vec3 c = paperC * rib * (0.35 + 1.1 * pow(1.0 - f, 2.0)) + warm * lit * rib * (0.35 + 0.65 * core) * (0.55 + 0.45 * f);
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const globe = new THREE.Mesh(g, this.paper);
    // rims and the wire handle
    const wire = new THREE.MeshBasicMaterial({ color: col('night', 2.5) });
    const rimT = new THREE.Mesh(new THREE.TorusGeometry(r * 0.29, r * 0.03, 6, 24), wire);
    rimT.rotation.x = Math.PI / 2; rimT.position.y = r * 1.1;
    const rimB = rimT.clone(); rimB.position.y = -r * 1.1;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(r * 0.45, r * 0.02, 4, 20, Math.PI), wire);
    handle.position.y = r * 1.1;
    this.glow = halo(new THREE.Color(0, 0, 0), r * 14);
    this.flame = halo(new THREE.Color(0, 0, 0), r * 1.4);
    this.add(globe, rimT, rimB, handle, this.glow, this.flame);
  }

  /** Call once per frame after setting `lit` and `time`. */
  update() {
    const fl = 1 + 0.07 * noise1(this.time * 6.0, 3) + 0.04 * noise1(this.time * 13.0, 5);
    const k = this.lit * fl;
    this.paper.uniforms.lit!.value = k;
    this.glow.material.color.copy(col('gold', 0.55).lerp(col('ember', 0.55), 0.3)).multiplyScalar(k);
    this.flame.material.color.copy(col('gold', 2.2).lerp(col('white', 2.2), 0.3)).multiplyScalar(k);
  }
}

/** Put `obj` in hand `i` of `fig` (at the palm, hanging `drop` below it); call after posing the figure. */
export function holdIn(fig: RealFigure, i: number, obj: THREE.Object3D, drop = 0) {
  fig.hand(i, obj.position);
  obj.position.y -= drop;
}
