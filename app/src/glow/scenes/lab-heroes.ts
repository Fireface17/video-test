// Lab (not in the edit; render with `--lab lab-heroes`): him and her (lib/heroes.ts) with their things.
// t in [0,2): standing (idle motion), her lantern unlit, his star in his open hand; [2,4): he holds the star to
// her lantern and it lights; t ≥ 4: close on the lit lantern.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { prog, ease } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import type { RealFigure } from '../lib/people';
import { loadMotion, type Motion } from '../lib/motion';
import { PaperLantern, StarSticker, holdIn, makeHeroes } from '../lib/heroes';

export default class LabHeroes extends Scene {
  st = new Stage(40, 0.05, 200);
  he!: RealFigure;
  she!: RealFigure;
  idleA!: Motion;
  idleB!: Motion;
  star = new StarSticker();
  lantern = new PaperLantern();

  override async init() {
    const S = this.st;
    S.bg.copy(col('night', 0.35));
    const [{ he, she }, a, b] = await Promise.all([makeHeroes(), loadMotion('111_28'), loadMotion('77_02')]);
    this.he = he; this.she = she; this.idleA = a; this.idleB = b;
    S.add(he, she, this.star, this.lantern);
    const grid = new THREE.GridHelper(10, 20, col('blue', 0.2).getHex(), col('blue', 0.1).getHex());
    S.add(grid);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st;
    const { he, she } = this;
    he.position.set(-0.45, he.hipHeight, 0); he.rotation.y = 0.5;
    she.position.set(0.45, she.hipHeight, 0); she.rotation.y = -0.5;
    this.idleA.apply(he, t + 3, { loop: true });
    this.idleB.apply(she, t + 1, { loop: true, mirror: true });
    he.time = she.time = t;
    // her lantern hangs from her right hand (index 0), held a little forward
    she.reach(0, she.spinePoint(-0.18, 0.05, 0.3), new THREE.Vector3(-0.5, -0.6, -0.4));
    she.setHand(0, 0.7);
    holdIn(she, 0, this.lantern, 0.27);
    // his star: in his open left hand, then held to the lantern
    const k = ease.inOutCubic(prog(t, 2, 3));
    const p0 = he.spinePoint(0.15, 0.1, 0.32), p1 = this.lantern.position.clone().add(new THREE.Vector3(-0.08, 0.02, 0.05));
    he.reach(1, p0.lerp(p1, k), new THREE.Vector3(0.6, -0.5, -0.4));
    he.setHand(1, 0.15);
    holdIn(he, 1, this.star, -0.02);
    this.star.level = 1 + 2 * Math.exp(-Math.abs(t - 3) * 6);
    this.lantern.lit = ease.outCubic(prog(t, 3, 3.6));
    this.lantern.time = t;
    this.lantern.update();
    const close = prog(t, 4, 4.01);
    aim(S.cam, new THREE.Vector3(0.2, 1.3 - 0.2 * close, 3.6 - 2.2 * close), new THREE.Vector3(0.1, 1.0, 0));
    S.render(this.ctx.renderer, out);
    return { bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85, vignette: 0.4, grain: 0.03 };
  }
}
