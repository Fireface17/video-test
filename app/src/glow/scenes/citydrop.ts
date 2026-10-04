// (test: the new city at street level)
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { City } from '../lib/city';

export default class CityDrop extends Scene {
  st = new Stage(50, 0.1, 6000);
  city!: City;
  override async init() {
    this.city = new City({});
    this.st.add(this.city);
    this.st.bg.copy(col('night', 0.3));
  }
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const S = this.st, u = f.p;
    const views: [number, number, number, number, number, number, number][] = [
      [760, 1400, 101, 760, 0, 100, 40], // map: x 340..1180
      [395, 1.5, 34, 1100, 3, 40, 55], // wide street j=0 looking east to the river
      [470, 1.6, 113, 520, 8, 128, 55], // street j=1: walk-ups with fire escapes
      [1080, 30, 60, 1144, 8, 40, 55], // toward the overpass
    ];
    const v = views[Math.min(3, Math.floor(u * 4))]!;
    S.cam.fov = v[6]; S.cam.updateProjectionMatrix();
    aim(S.cam, new THREE.Vector3(v[0], v[1], v[2]), new THREE.Vector3(v[3], v[4], v[5]), 0, v[1] > 1000 ? { x: 0, y: 0, z: -1 } : undefined);
    this.city.update(f.t, S.cam.position);
    S.render(this.ctx.renderer, out);
    return { bloom: 0.8, bloomThreshold: 0.8, bloomRadius: 0.8, vignette: 0.4, grain: 0.03 };
  }
}
