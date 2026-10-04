// Lab (not in the edit; render with `--lab lab-crowd`): lib/crowd.ts — six people of light in front, sixty of
// stardust behind; everyone stands low (sad) and on t = 3 s their hands go up (very happy), each on their own
// clip time.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { mulberry32 } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { Crowd } from '../lib/crowd';

export default class LabCrowd extends Scene {
  st = new Stage(45, 0.05, 400);
  crowd = new Crowd({ dust: [8, 80, 200] });

  override async init() {
    const S = this.st;
    S.bg.copy(col('night', 0.3));
    await this.crowd.init(['79_71', '142_15', '79_69', '80_43', '77_02']);
    S.add(this.crowd);
    const r = mulberry32(3);
    const sad = ['79_71', '142_15', '77_02'], up = ['79_69', '80_43'];
    for (let i = 0; i < 66; i++) {
      const light = i < 6;
      const pos = light ? new THREE.Vector3((i - 2.5) * 1.1, 0, 0) : new THREE.Vector3((r() - 0.5) * 30, 0, -4 - r() * 30);
      const c = [col('cyan', 1.1), col('pink', 1.1), col('gold', 1.1)][i % 3]!;
      this.crowd.addPerson({
        pos, yaw: (r() - 0.5) * 0.8, look: light ? 'light' : 'dust', color: c, k: (t) => 0.35 + 0.65 * Math.min(1, Math.max(0, (t - 3 - r() * 0) / 0.5)),
        clips: [{ clip: sad[i % 3]!, from: 0 }, { clip: up[i % 2]!, from: 3 + (i % 5) * 0.08 }],
      });
    }
    const grid = new THREE.GridHelper(80, 80, col('blue', 0.2).getHex(), col('blue', 0.08).getHex());
    S.add(grid);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const S = this.st;
    aim(S.cam, new THREE.Vector3(0, 1.6, 6), new THREE.Vector3(0, 1.0, -6));
    this.crowd.update(f.t, S.cam);
    S.render(this.ctx.renderer, out);
    return { bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85, vignette: 0.4, grain: 0.03 };
  }
}
