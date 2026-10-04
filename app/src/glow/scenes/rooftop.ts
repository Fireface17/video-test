// (work in progress: location test)
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage, aim } from '../lib/stage';
import { RoofWorld } from './rooftop-world';

export default class Rooftop extends Scene {
  st = new Stage(46, 0.1, 12000);
  w!: RoofWorld;

  override async init() {
    this.w = new RoofWorld();
    this.st.add(this.w);
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, w = this.w, set = w.set;
    const k = Math.floor((t - 30.81) / 1.6);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const he = set.heSpot, she = set.sheSpot;
    const views: [THREE.Vector3, THREE.Vector3, number][] = [
      [he.clone().add(V(1.5, 1.7, 2.5)), she.clone().add(V(-3, 1, -40)), 50],
      [he.clone().add(V(0.5, 1.7, 1.0)), V(-60, 60, -1000), 50],
      [V(-30, 14, 0), V(0, 20, 0), 50],
      [V(0, 2, 3), V(0, 22, 0), 60],
      [V(40, 60, 60), V(0, 10, 0), 45],
      [V(0, 180, 120), V(0, 0, -80), 50],
      [she.clone().add(V(-1, 1.7, -2.5)), he.clone().add(V(0, 1, 0)), 50],
      [V(-15, 26, -2), V(5, 20, 3), 55],
    ];
    const v = views[Math.max(0, Math.min(views.length - 1, k))]!;
    w.power = k >= 4 && k < 6 ? 1 : 0;
    S.cam.fov = v[2];
    S.cam.updateProjectionMatrix();
    aim(S.cam, v[0], v[1]);
    w.update(t, S.cam);
    S.render(this.ctx.renderer, out);
    return { bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.04, ca: 0.6 };
  }
}
