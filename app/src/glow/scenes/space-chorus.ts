// Placeholder until the scene is built: a dark frame with the entry id.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage } from '../lib/stage';

export default class Stub extends Scene {
  st = new Stage();
  override render(_f: Frame, out: THREE.WebGLRenderTarget) {
    this.st.bg.setRGB(0.02, 0.02, 0.05);
    this.st.render(this.ctx.renderer, out);
  }
}
