// Lab (not in the edit; `--lab rooftop-lab`): the rooftop set's props up close, at dawn (t < 8) and at night
// (t ≥ 8) — each 2 s a view: his garden, the table and grill, his bulkhead with the bike, her roof.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage, aim } from '../lib/stage';
import { RoofWorld } from './rooftop-world';

export default class RooftopLab extends Scene {
  st = new Stage(50, 0.05, 16000);
  w!: RoofWorld;
  override async init() {
    this.w = new RoofWorld();
    this.st.add(this.w);
  }
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, w = this.w, set = w.set, S = this.st;
    const day = t < 8;
    w.dawn = day ? 1 : 0;
    w.setSun(new THREE.Vector3(0.75, 0.22, -0.62).normalize());
    w.power = day ? 0.3 : 0;
    const H = set.his, R = set.hers, hy = set.heSpot.y, sy = set.sheSpot.y;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const views: [THREE.Vector3, THREE.Vector3][] = [
      [V(H.x1 - 3.6, hy + 1.7, H.z0 + 3.0), V(H.x1 - 1.0, hy + 0.5, H.z0 + 8.0)],
      [V(1.0, hy + 1.6, H.z0 + 4.8), V(4.0, hy + 0.6, H.z0 + 9.5)],
      [V(H.x0 + 6.5, hy + 1.6, H.z1 - 7.5), V(H.x0 + 3.0, hy + 0.8, H.z1 - 2.5)],
      [V(2.6, sy + 1.6, R.z1 - 1.6), V(-3.4, sy + 0.3, R.z1 - 6.0)],
    ];
    const v = views[Math.floor(t / 2) % 4]!;
    aim(S.cam, v[0], v[1]);
    w.update(t, S.cam);
    S.render(this.ctx.renderer, out);
    return { bloom: 0.6, bloomThreshold: 0.85, vignette: 0.3, grain: 0.03, exposure: day ? 1 : 1.15 };
  }
}
