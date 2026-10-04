// Lab (not in the edit; `--lab lab-stars`): star-figures dancing in space above the night Earth.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { RealFigure, dance, loadBody } from '../lib/people';
import { StarFigures, starJoints } from '../lib/stars';
import { Earth } from '../lib/earth';

export default class LabStars extends Scene {
  st = new Stage(45, 0.05, 5000);
  figs: RealFigure[] = [];
  sf = new StarFigures(12, 0.16, 0.025);
  earth = new Earth();

  override async init() {
    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    for (let i = 0; i < 6; i++) this.figs.push(new RealFigure(i % 2 ? mi : rp, i % 2 ? 'michelle' : 'rpm', col('white')));
    this.figs.forEach((f, i) => { f.position.set((i - 2.5) * 2.4, 1 + (i % 2) * 0.3, -(i % 3) * 1.5); f.scale.setScalar(1); this.st.add(f); f.visible = false; });
    await this.earth.init();
    this.earth.position.set(0, -6.371 * 3 - 4, -10);
    this.earth.scale.setScalar(3);
    this.st.add(this.earth, this.sf);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const beat = this.ctx.audio.beatAt(f.t);
    this.sf.begin();
    this.figs.forEach((fig, i) => {
      const b = dance(fig, beat + i * 0.13, i % 4, 1, i);
      fig.position.y = 1 + (i % 2) * 0.3 + b;
      const j = starJoints(fig);
      this.sf.figure(j, col('white', 2.2).lerp(col('cyan', 2), (i % 3) * 0.3), col('cyan', 0.7).lerp(col('pink', 0.7), (i % 2) * 0.6), 1, 1);
    });
    this.sf.end();
    this.earth.time = f.t;
    aim(this.st.cam, new THREE.Vector3(0, 1.5, 11), new THREE.Vector3(0, 0.8, 0));
    this.st.render(this.ctx.renderer, out);
    return { bloom: 1.0, bloomThreshold: 0.75, halation: 0.12, vignette: 0.45, grain: 0.04 };
  }
}
