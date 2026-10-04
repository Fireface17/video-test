// Lab (not in the edit; render with `--lab lab-motion`): motion-capture clips on our bodies, to choose them.
// t in [10k, 10k + 10): clip k of CLIPS at clip time t - 10k, on a person of light (left) and a person of stardust
// (right, mirrored).
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { RealFigure, loadBody } from '../lib/people';
import { starJoints } from '../lib/stars';
import { Stardust, StardustBody } from '../lib/stardust';
import { loadMotion, type Motion } from '../lib/motion';

export const CLIPS = ['05_02', '05_12', '49_09', '49_12', '55_01', '55_02', '60_02', '61_02', '111_05', '113_04', '141_12', '120_05', '22_08', '23_08', '79_71', '142_15', '140_06', '77_02', '111_28', '141_16', '90_30', '94_01'];

export default class LabMotion extends Scene {
  st = new Stage(38, 0.05, 200);
  ms: Motion[] = [];
  a!: RealFigure;
  b!: RealFigure;
  dust!: Stardust;
  js: THREE.Vector3[] = [];

  override async init() {
    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    this.ms = await Promise.all(CLIPS.map((c) => loadMotion(c)));
    const S = this.st;
    S.bg.copy(col('night', 0.4));
    this.a = new RealFigure(rp, 'rpm', col('cyan', 1.1));
    this.b = new RealFigure(mi, 'michelle', col('white'));
    this.b.visible = false;
    S.add(this.a, this.b);
    this.dust = new Stardust([new StardustBody(new RealFigure(mi, 'michelle', col('white')), 22000, 2)], 4);
    S.add(this.dust);
    const grid = new THREE.GridHelper(10, 20, col('blue', 0.25).getHex(), col('blue', 0.12).getHex());
    S.add(grid);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const k = Math.max(0, Math.min(this.ms.length - 1, Math.floor(f.t / 10)));
    const t = f.t - k * 10, m = this.ms[k]!;
    this.a.position.set(-0.7, this.a.hipHeight, 0);
    m.apply(this.a, t, { loop: true });
    this.a.time = f.t;
    this.b.position.set(0.7, this.b.hipHeight, 0);
    m.apply(this.b, t, { loop: true, mirror: true });
    this.b.updateMatrixWorld(true);
    starJoints(this.b, this.js);
    this.dust.time = f.t * 3;
    this.dust.begin(this.st.cam);
    this.dust.figure(this.js, 0, col('pink', 1.5).lerp(col('white', 1.5), 0.2), 1, { color2: col('violet', 1.2) });
    this.dust.end();
    aim(this.st.cam, new THREE.Vector3(0, 1.1, 5.2), new THREE.Vector3(0, 0.9, 0));
    this.st.render(this.ctx.renderer, out);
    return { bloom: 0.8, bloomThreshold: 0.8, bloomRadius: 0.8, vignette: 0.4, grain: 0.03 };
  }
}
