// (test: running cycles)
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import type { RealFigure } from '../lib/people';
import { makeHeroes, PaperLantern, StarSticker, holdIn } from '../lib/heroes';
import { Crowd } from '../lib/crowd';
import { loadCycle, type CycleMotion } from './run-motion';

export default class Run extends Scene {
  st = new Stage(40, 0.05, 400);
  he!: RealFigure;
  she!: RealFigure;
  ra!: CycleMotion;
  rb!: CycleMotion;
  star = new StarSticker();
  lantern = new PaperLantern();
  crowd = new Crowd({ dust: [8, 40, 100] });
  jm?: import('../lib/motion').Motion;

  override async init() {
    const S = this.st;
    S.bg.copy(col('night', 0.35));
    const [{ he, she }, a, b] = await Promise.all([makeHeroes(), loadCycle('09_01'), loadCycle('16_35')]);
    this.he = he; this.she = she; this.ra = a; this.rb = b;
    S.add(he, she, this.star, this.lantern);
    await this.crowd.init(['77_02']);
    this.jm = await (await import('../lib/motion')).loadMotion('40_07');
    this.crowd.addMotion('run', a);
    this.crowd.addMotion('jog', b);
    for (let i = 0; i < 6; i++) {
      this.crowd.addPerson({ pos: new THREE.Vector3(0, 0, 0), yaw: Math.PI / 2, look: i < 2 ? 'light' : 'dust', color: col('cyan', 1.2), k: 1, clips: [{ clip: i % 2 ? 'run' : 'jog', from: 0 }] });
    }
    S.add(this.crowd);
    const grid = new THREE.GridHelper(400, 400, col('blue', 0.2).getHex(), col('blue', 0.1).getHex());
    S.add(grid);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.lt, S = this.st;
    const { he, she } = this;
    const va = this.ra.speed(he), vb = this.rb.speed(she);
    he.position.set(-20 + va * t, he.hipHeight, 0); he.rotation.y = Math.PI / 2;
    she.position.set(-20 + vb * t, she.hipHeight, 1.2); she.rotation.y = Math.PI / 2;
    this.ra.apply(he, t);
    this.rb.apply(she, t + 0.3);
    if (this.jm) {
      // test: 40_07 windows on him, standing at the origin facing +x
      const w = f.t < 140 ? [52.4, 54.6] : f.t < 150 ? [17.3, 19.0] : [10.4, 12.6];
      const u = w[0]! + ((f.t % 10) / 10) * (w[1]! - w[0]!);
      he.position.set(0, he.hipHeight, 0); he.rotation.y = Math.PI / 2;
      this.jm.apply(he, u, { inPlace: false });
    }
    he.time = she.time = f.t;
    holdIn(he, 1, this.star, -0.02);
    this.star.level = 1;
    holdIn(she, 0, this.lantern, 0.27);
    this.lantern.lit = 1; this.lantern.time = f.t; this.lantern.update();
    this.crowd.people.forEach((p, i) => {
      const m = i % 2 ? this.ra : this.rb;
      const fig = p.body === 1 ? she : he;
      p.pos.set(-20 + m.speed(fig) * t - 3 - 1.5 * i, 0, -2 - (i % 3) * 1.4);
    });
    this.crowd.update(t, S.cam);
    const cx = 0;
    aim(S.cam, new THREE.Vector3(cx, 1.1, 7), new THREE.Vector3(cx - 1, 0.9, 0));
    S.render(this.ctx.renderer, out);
    return { bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85, vignette: 0.4, grain: 0.03 };
  }
}
