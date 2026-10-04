// TEMPORARY (perf comparison with the original city; deleted after measuring)
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage, aim, skyDome } from '../lib/stage';
import { City } from '../lib/zz-city-old-tmp';
export default class LabCityOld extends Scene {
  st = new Stage(50, 0.3, 14000);
  city!: City;
  override async init() {
    this.city = new City({ seed: 11, half: 1700, centre: [80, -950], downtownR: 520, fog: 0.00075, clouds: 800 });
    this.st.add(skyDome(new THREE.Color(0.003, 0.004, 0.012), new THREE.Color(0.045, 0.03, 0.032), new THREE.Color(0.02, 0.014, 0.018), 9000), this.city);
  }
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, cam = this.st.cam;
    if (t < 4) aim(cam, new THREE.Vector3(-20, 46, 30), new THREE.Vector3(-60, 70, -1100));
    else aim(cam, new THREE.Vector3(-125 + 7.5, 1.6, 222), new THREE.Vector3(-124, 4, -700));
    this.city.update(t, cam.position);
    this.st.render(this.ctx.renderer, out);
    return { bloom: 0.85, bloomThreshold: 0.8 };
  }
}
