// (stub, being written)
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { Stage } from '../lib/stage';
import { col } from '../lib/palette';

export default class Stub extends Scene {
  st = new Stage(45, 0.05, 400);
  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    this.st.bg.copy(col('night', 0.3));
    this.st.render(this.ctx.renderer, out);
  }
}
