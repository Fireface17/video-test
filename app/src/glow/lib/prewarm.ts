// Pre-warming a scene in init(): its shader programs linked and its textures uploaded before its first frame,
// so the live preview does not stall (and skip frames) at the moment the scene comes on. Each scene/camera pair
// is rendered once into a tiny throwaway target of the same kind as the engine's (HalfFloat), with everything
// in it made visible for that one render.
import * as THREE from 'three';
import { makeRT } from '../../engine/gl';

export function prewarm(r: THREE.WebGLRenderer, items: { scene: THREE.Object3D; cam: THREE.Camera }[], textures: THREE.Texture[] = []) {
  const rt = makeRT(8, 8, { pxScale: 1 });
  const prev = r.getRenderTarget();
  for (const t of textures) r.initTexture(t);
  for (const it of items) {
    const hidden: THREE.Object3D[] = [];
    it.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    r.setRenderTarget(rt);
    r.render(it.scene, it.cam);
    for (const o of hidden) o.visible = false;
  }
  r.setRenderTarget(prev);
  rt.dispose();
}
