// The two of them in the bridge (`fall`): HIM and HER (lib/heroes) hand in hand — his right hand in her left with
// his star between their palms, her lantern in his free (left) hand. They jump off the overpass's edge with a
// captured standing jump (CMU 13_11: the crouch, the arm swing, the push), and from the top of the leap their limbs
// ease into a skydiver's float (arms out and bent, knees soft, toes pointed) while the formation tips forward,
// belly to the ground, and turns slowly. Everything is a pure function of t; the blend from the captured pose to
// the float goes limb by limb through their directions, so nothing snaps.
import * as THREE from 'three';
import type { RealFigure } from '../lib/people';
import { bend, limbDir } from '../lib/people';
import { applyLayers } from '../lib/motion';
import { PaperLantern, StarSticker } from '../lib/heroes';
import type { CycleMotion } from './run-motion';
import { clamp, noise1 } from '../../engine/util';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const SIDES = ['Right', 'Left'] as const;

/** The pose of the pair for one frame. */
export interface PairPose {
  /** Centre between their pelvises (world). */
  O: THREE.Vector3;
  /** Their common orientation: x = their left (−side), y = head, z = front (figure frame axes). */
  Q: THREE.Quaternion;
  /** Half the distance between their pelvises. */
  gap: number;
  /** Clip time into the jump (clamped to the span; the pose is held at its end). */
  jumpT: number;
  /** 0 = the captured jump, 1 = the float. */
  floatK: number;
  /** Arms opening wide (the golden lines), 0..1. */
  open: number;
  /** Heads turned to each other ("me and you"), 0..1. */
  look: number;
  /** Where the joined hands are, from the middle of their inner shoulders (y toward their heads, z to their front). */
  grip: THREE.Vector3;
  /** Which way the air rushes past (world, unit; the lantern trails along it), and how hard (0..1). */
  wind: THREE.Vector3;
  windK: number;
  t: number;
}

/** Direction of `a`→`b` bones of `fig` (world). */
function boneDir(fig: RealFigure, a: string, b: string, out = V()) {
  const pa = fig.bone(a).getWorldPosition(V());
  return out.copy(fig.bone(b).getWorldPosition(V())).sub(pa).normalize();
}

/** The figure's spine frame (world rotation), recovered from spinePoint. */
function spineFrame(fig: RealFigure) {
  const o = fig.spinePoint(0, 0, 0), x = fig.spinePoint(1, 0, 0).sub(o), y = fig.spinePoint(0, 1, 0).sub(o), z = fig.spinePoint(0, 0, 1).sub(o);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** Slerp between two unit directions. */
function slerpDir(a: THREE.Vector3, b: THREE.Vector3, k: number) {
  if (k <= 0) return a.clone();
  if (k >= 1) return b.clone();
  const q = new THREE.Quaternion().setFromUnitVectors(a, b);
  return a.clone().applyQuaternion(new THREE.Quaternion().slerp(q, k)).normalize();
}

export class Pair {
  /** hand positions after posing: his right, her left (held), his left (lantern), her right (free) */
  heldHe = V(); heldShe = V(); lanternHand = V(); freeHand = V();
  /** The swing of the lantern on its wire (for the trail). */
  lanternTop = V();

  constructor(public he: RealFigure, public she: RealFigure, public jump: CycleMotion, public star: StarSticker, public lantern: PaperLantern) {}

  pose(P: PairPose) {
    const { he, she } = this;
    const side = V(-1, 0, 0).applyQuaternion(P.Q); // their right (toward her for him)
    const up = V(0, 1, 0).applyQuaternion(P.Q), front = V(0, 0, 1).applyQuaternion(P.Q);
    const t = P.t;
    ([he, she] as RealFigure[]).forEach((fig, i) => {
      const s = i === 0 ? -1 : 1; // he on −side, she on +side
      const nz = (f: number, sd: number) => noise1(t * f, sd + 31 * i);
      // where: either side of the centre, a little apart along their front as they float (never in lock-step)
      const pos = P.O.clone().addScaledVector(side, s * P.gap)
        .addScaledVector(up, (fig.hipHeight - 0.95) * (1 - P.floatK) + 0.05 * nz(0.37, 3) * P.floatK)
        .addScaledVector(front, 0.06 * nz(0.29, 5) * P.floatK);
      fig.position.copy(pos);
      // a slight roll toward each other and a breath of independent sway while floating
      // ("me and you": they turn their faces to each other)
      const own = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.07 * nz(0.23, 7) * P.floatK, (-s * 0.1 - s * 0.35 * P.look) * P.floatK + 0.05 * nz(0.21, 9) * P.floatK, (s * 0.12 + s * 0.15 * P.look) * P.floatK + 0.05 * nz(0.19, 11) * P.floatK));
      fig.quaternion.copy(P.Q).multiply(own);
      // the captured jump (her a hair late: they jump together, not in lock-step)
      applyLayers(fig, [{ m: this.jump, t: P.jumpT - (i ? 0.03 : 0), mirror: i === 1 }]);
      fig.updateMatrixWorld(true);
      fig.time = t;
      // ease each free limb from the capture into the float
      if (P.floatK > 0.001) {
        const Sq = spineFrame(fig), Si = Sq.clone().invert();
        const Fq = fig.getWorldQuaternion(new THREE.Quaternion()), Fi = Fq.clone().invert();
        const free = i === 0 ? 1 : 0; // his left (the lantern), her right
        const sx = free === 0 ? -1 : 1;
        {
          const sn = SIDES[free]!;
          const c1 = boneDir(fig, `${sn}Arm`, `${sn}ForeArm`).applyQuaternion(Si), c2 = boneDir(fig, `${sn}ForeArm`, `${sn}Hand`).applyQuaternion(Si);
          const raise = 1.35 + 0.12 * nz(0.31, 13) + 0.75 * P.open, back = -0.35 + 0.1 * nz(0.27, 15) + 0.15 * P.open;
          const u1 = limbDir(sx, raise, back);
          const u2 = bend(u1, V(0, 1, 0.35), 1.15 - 0.85 * P.open + 0.1 * nz(0.33, 17));
          fig.setArm(free, slerpDir(c1, u1, P.floatK), slerpDir(c2, u2, P.floatK));
          fig.setHand(free, 0.2 + 0.25 * (1 - P.open));
        }
        for (const k of [0, 1]) {
          const sn = SIDES[k]!, lx = k === 0 ? -1 : 1;
          const c1 = boneDir(fig, `${sn}UpLeg`, `${sn}Leg`).applyQuaternion(Fi), c2 = boneDir(fig, `${sn}Leg`, `${sn}Foot`).applyQuaternion(Fi);
          // knees soft and uneven, one leg trailing a little more; a slow flutter in the air
          const lead = (k === 0) === (i === 0) ? 1 : 0;
          const u1 = limbDir(lx, 0.13 + 0.04 * nz(0.4, 19 + k), -0.3 - 0.25 * lead + 0.1 * nz(0.35, 23 + k));
          const u2 = bend(u1, V(0, 0, -1), 0.75 + 0.45 * lead + 0.15 * nz(0.45, 27 + k));
          fig.setLeg(k, slerpDir(c1, u1, P.floatK), slerpDir(c2, u2, P.floatK));
          fig.setFoot(k, 0.85 * P.floatK);
        }
        void Fq;
      }
    });
    // the held hands: both reach for the grip point, palms together (the star between them) — placed from their
    // inner shoulders (`grip`: x unused, y = below/above the shoulders, z = in front, in their frame)
    he.updateMatrixWorld(true); she.updateMatrixWorld(true);
    const shMid = he.bone('RightArm').getWorldPosition(V()).lerp(she.bone('LeftArm').getWorldPosition(V()), 0.5);
    const grip = shMid.addScaledVector(up, P.grip.y).addScaledVector(front, P.grip.z);
    // (during the jump the grip follows their own swing, half his, half hers)
    const swing = he.hand(0).lerp(she.hand(1), 0.5);
    const g = grip.lerp(swing, 0.4 * (1 - P.floatK));
    he.reach(0, g.clone().addScaledVector(side, -0.035), V(-0.4, -0.6, -0.5));
    she.reach(1, g.clone().addScaledVector(side, 0.035), V(0.4, -0.6, -0.5));
    he.setHand(0, 0.55); she.setHand(1, 0.55);
    // heads: a slight turn toward each other
    he.updateMatrixWorld(true); she.updateMatrixWorld(true);
    this.heldHe.copy(he.hand(0)); this.heldShe.copy(she.hand(1));
    this.lanternHand.copy(he.hand(1)); this.freeHand.copy(she.hand(0));
    // the star between their palms
    this.star.position.copy(this.heldHe).lerp(this.heldShe, 0.5);
    // the lantern on its wire below his hand — blown up behind the hand as the air rushes past, swinging
    const hang = V(0, -1, 0).lerp(P.wind, clamp(P.windK)).normalize();
    hang.x += 0.12 * noise1(t * 1.3, 41); hang.z += 0.12 * noise1(t * 1.1, 43);
    hang.normalize();
    const L = this.lantern;
    L.position.copy(this.lanternHand).addScaledVector(hang, 0.26);
    L.quaternion.setFromUnitVectors(V(0, -1, 0), hang);
    this.lanternTop.copy(this.lanternHand);
  }
}
