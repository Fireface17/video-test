// A three.js scene + perspective camera that renders into the engine's linear HDR target.
import * as THREE from 'three';
import { W, H } from '../../engine/gl';
import { noise1 } from '../../engine/util';

export class Stage {
  scene = new THREE.Scene();
  cam: THREE.PerspectiveCamera;
  /** Linear clear colour. */
  bg = new THREE.Color(0, 0, 0);

  constructor(fov = 40, near = 0.05, far = 500) {
    this.cam = new THREE.PerspectiveCamera(fov, W / H, near, far);
  }

  fog(color: THREE.Color, density: number) {
    this.scene.fog = new THREE.FogExp2(color, density);
    return this;
  }

  add(...o: THREE.Object3D[]) {
    this.scene.add(...o);
    return this;
  }

  /** Clear `out` to the background and draw the scene (pass clear=false to draw over what is there). */
  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, clear = true) {
    renderer.setRenderTarget(out);
    if (clear) {
      renderer.setClearColor(this.bg, 1);
      renderer.clear(true, true, true);
    } else renderer.clearDepth();
    renderer.render(this.scene, this.cam);
  }
}

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Matrix4();

/**
 * Point the camera from `pos` at `target`, keeping `up` (default +y) toward the top of the frame, then
 * roll (radians, positive = counter-clockwise on screen). Works when looking straight along `up`.
 */
export function aim(cam: THREE.Camera, pos: THREE.Vector3Like, target: THREE.Vector3Like, roll = 0, up: THREE.Vector3Like = { x: 0, y: 1, z: 0 }) {
  _f.set(target.x - pos.x, target.y - pos.y, target.z - pos.z).normalize();
  _u.set(up.x, up.y, up.z).normalize();
  if (Math.abs(_f.dot(_u)) > 0.9999) _u.set(0, 0, -1).applyAxisAngle(_f, 0.0001);
  _r.crossVectors(_f, _u).normalize();
  _u.crossVectors(_r, _f).normalize();
  if (roll) { _r.applyAxisAngle(_f, roll); _u.applyAxisAngle(_f, roll); }
  _m.makeBasis(_r, _u, _f.clone().negate());
  cam.position.set(pos.x, pos.y, pos.z);
  cam.quaternion.setFromRotationMatrix(_m);
  cam.updateMatrixWorld();
}

/** Orient `obj` (built in the XY plane facing +z) to face the camera squarely, upright on screen. */
export function faceCamera(obj: THREE.Object3D, cam: THREE.Camera) {
  obj.quaternion.copy(cam.quaternion);
}

/** Smooth deterministic handheld drift: a small offset that wanders with t. */
export function drift(t: number, amp: number, speed = 0.35, seed = 1) {
  return new THREE.Vector3(noise1(t * speed, seed) * amp, noise1(t * speed, seed + 7) * amp, noise1(t * speed, seed + 13) * amp * 0.5);
}

/** Fullscreen-sky sphere with a vertical gradient (linear colours), rendered behind everything. */
export function skyDome(top: THREE.Color, horizon: THREE.Color, bottom = top, radius = 300) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: top }, horizon: { value: horizon }, bottom: { value: bottom }, glow: { value: new THREE.Color(0, 0, 0) }, glowDir: { value: new THREE.Vector3(0, 0, -1) } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, bottom, glow; uniform vec3 glowDir;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(clamp(y, 0.0, 1.0), 0.45)) : mix(horizon, bottom, pow(clamp(-y, 0.0, 1.0), 0.35));
        float g = max(dot(normalize(vDir), normalize(glowDir)), 0.0);
        c += glow * (pow(g, 8.0) * 0.6 + pow(g, 64.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
