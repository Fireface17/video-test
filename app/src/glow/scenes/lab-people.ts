// Lab (not in the edit; render with `--lab lab-people`): test frames for the people of light.
// t in [0,1): the bodies side by side; [1,2): ghosts in a dark room; [2,3): a crowd with their hands up
// under the stars; [3,4): a close-up of one person raising a glow stick.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { mulberry32 } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { glowStickGeometry } from '../lib/shapes';
import { RealFigure, bakePose, bend, ghostBodyMaterial, limbDir, loadBody } from '../lib/people';
import { lightBodyMaterial } from './chorus-dancers';

export default class LabPeople extends Scene {
  st = new Stage(40, 0.05, 900);
  modes: THREE.Group[] = [];
  stars = new GlowPoints(3000, 0.6);
  hero!: RealFigure;
  stick!: THREE.Mesh;

  override async init() {
    const [xb, mi, rp] = await Promise.all([loadBody('xbot'), loadBody('michelle'), loadBody('rpm')]);
    const S = this.st;
    S.bg.copy(col('night', 0.6));
    const r = mulberry32(5);
    for (let i = 0; i < this.stars.n; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, R = 400;
      const y = Math.abs(u) * 0.95 + 0.02;
      this.stars.set(i, Math.cos(a) * Math.sqrt(1 - y * y) * R, y * R, Math.sin(a) * Math.sqrt(1 - y * y) * R, col('white', 0.5 + r() * 1.5), 1, 0.4 + r() * r() * 2);
    }
    this.stars.commit();
    S.add(this.stars);
    for (let i = 0; i < 4; i++) { const g = new THREE.Group(); this.modes.push(g); S.add(g); }

    // 0: line-up — X Bot, X Bot without its joint shells, Michelle
    const line = [new RealFigure(rp, 'rpm', col('cyan', 1.2), undefined, { hat: true }), new RealFigure(rp, 'rpm', col('cyan', 1.2)), new RealFigure(mi, 'michelle', col('pink', 1.2))];
    line.forEach((f, i) => { f.position.set((i - 1) * 1.0, f.hipHeight, 0); this.modes[0]!.add(f); });

    // 1: ghosts standing in a dark room, two of them holding hands
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: col('night', 1.4) }));
    floor.rotation.x = -Math.PI / 2;
    this.modes[1]!.add(floor);
    const ghostC = col('blue', 0.7).lerp(col('white', 0.8), 0.5);
    for (let i = 0; i < 14; i++) {
      const body = i % 2 ? mi : rp, kind = i % 2 ? 'michelle' : 'rpm';
      const g = new RealFigure(body, kind, ghostC, ghostBodyMaterial(ghostC), { prepass: true, hat: i % 4 === 0 });
      const x = (r() - 0.5) * 7, z = -1 - r() * 9;
      g.position.set(x, g.hipHeight, z);
      g.rotation.y = (r() - 0.5) * 1.2 + (x > 0 ? -0.3 : 0.3);
      g.setSpine(0.05 + r() * 0.08, (r() - 0.5) * 0.08, 0.2 + r() * 0.25, (r() - 0.5) * 0.2);
      for (const k of [0, 1]) {
        const sx = k ? 1 : -1;
        const u1 = limbDir(sx, 0.08 + r() * 0.06, 0.05);
        g.setArm(k, u1, bend(u1, new THREE.Vector3(0, 0, 1), 0.15 + r() * 0.2));
        g.setHand(k, 0.25);
      }
      this.modes[1]!.add(g);
    }
    const warmC = ghostC.clone().lerp(col('gold', 1.3), 0.7);
    const pair = [new RealFigure(rp, 'rpm', warmC, ghostBodyMaterial(warmC), { prepass: true }), new RealFigure(mi, 'michelle', warmC, ghostBodyMaterial(warmC), { prepass: true })];
    pair.forEach((g, i) => {
      g.position.set(i ? 0.38 : -0.38, g.hipHeight, 1.2);
      g.rotation.y = i ? -0.25 : 0.25;
      g.setSpine(0.04, 0, 0.15, i ? 0.15 : -0.15);
      this.modes[1]!.add(g);
    });
    this.pairs = pair;

    // 2: a crowd seen from behind, hands up, under the stars (baked poses, instanced)
    const poser = [new RealFigure(rp, 'rpm', col('white')), new RealFigure(mi, 'michelle', col('white')), new RealFigure(rp, 'rpm', col('white'), undefined, { hat: true })];
    const geos: THREE.BufferGeometry[] = [];
    for (const f of poser) {
      for (let p = 0; p < 4; p++) {
        for (const k of [0, 1]) {
          const sx = k ? 1 : -1;
          const up = p === 0 || (p === 1 && k === 1) || p === 2;
          const u1 = up ? limbDir(sx, p === 2 ? 2.75 : 2.55, 0.15) : limbDir(sx, 0.12, 0.05);
          f.setArm(k, u1, up ? bend(u1, new THREE.Vector3(-sx, 0, 0.3), p === 2 ? 0.5 : 0.2) : bend(u1, new THREE.Vector3(0, 0, 1), 0.2));
          f.setHand(k, up ? (p === 2 ? 0.8 : 0.1) : 0.3);
        }
        f.setSpine(p === 3 ? 0.02 : -0.06, 0, p === 3 ? 0.1 : -0.25, 0);
        geos.push(bakePose(f));
      }
    }
    const mat = lightBodyMaterial(1);
    const N = 420, per = Math.ceil(N / geos.length);
    const palette = [col('gold', 1.0), col('white', 0.9), col('gold', 0.8).lerp(col('ember', 1), 0.4)];
    geos.forEach((g, gi) => {
      const im = new THREE.InstancedMesh(g, mat, per);
      im.frustumCulled = false;
      const m = new THREE.Matrix4();
      for (let i = 0; i < per; i++) {
        const x = (r() - 0.5) * 34, z = -2 - r() * 40, s = 0.95 + r() * 0.1;
        m.compose(new THREE.Vector3(x, 0.95, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI + (r() - 0.5) * 0.8, 0)), new THREE.Vector3(s, s, s));
        im.setMatrixAt(i, m);
        im.setColorAt(i, palette[Math.floor(r() * palette.length)]!.clone().multiplyScalar(0.6 + r() * 0.5));
      }
      this.modes[2]!.add(im);
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: col('night', 0.8) }));
    ground.rotation.x = -Math.PI / 2;
    this.modes[2]!.add(ground);

    // 3: close-up: one person raising a glow stick
    this.hero = new RealFigure(rp, 'rpm', col('cyan', 1.1).lerp(col('blue', 1.2), 0.3));
    this.hero.position.set(0, this.hero.hipHeight, 0);
    this.stick = new THREE.Mesh(glowStickGeometry(0.24, 0.014), [new THREE.MeshBasicMaterial({ color: col('pink', 3) }), new THREE.MeshBasicMaterial({ color: col('night', 2) })]);
    this.modes[3]!.add(this.hero, this.stick);
  }

  pairs: RealFigure[] = [];

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const mode = Math.max(0, Math.min(3, Math.floor(f.t)));
    const k = f.t - mode;
    this.modes.forEach((g, i) => (g.visible = i === mode));
    const S = this.st, cam = S.cam;
    S.scene.fog = mode === 1 ? new THREE.FogExp2(col('night', 1).getHex(), 0.09) : null;
    this.stars.visible = mode !== 1;
    if (mode === 0) aim(cam, new THREE.Vector3(0, 1.0, 4.6 - 2.6 * k), new THREE.Vector3(0, 0.95 + 0.6 * k, 0));
    else if (mode === 1) {
      // the held hands meet between them
      const meet = new THREE.Vector3(0, 0.82, 1.45);
      this.pairs.forEach((g, i) => g.reach(i ? 0 : 1, meet.clone().add(new THREE.Vector3(i ? 0.03 : -0.03, 0, 0)), new THREE.Vector3(0, -0.5, -0.6)));
      aim(cam, new THREE.Vector3(0.4, 1.55, 5.2 - k), new THREE.Vector3(0, 1.1, -2));
    } else if (mode === 2) aim(cam, new THREE.Vector3(0, 3.2, 7), new THREE.Vector3(0, 3.5, -40));
    else {
      const h = this.hero;
      h.rotation.y = 0.35;
      h.setSpine(-0.1, -0.05, -0.45, 0.1);
      const u1 = limbDir(1, 2.6, 0.2);
      h.setArm(1, u1, bend(u1, new THREE.Vector3(-1, 0, 0.4), 0.35), -0.6);
      h.setHand(1, 0.85);
      const u0 = limbDir(-1, 0.25, 0.1);
      h.setArm(0, u0, bend(u0, new THREE.Vector3(0, 0, 1), 0.4));
      h.setHand(0, 0.25);
      const hp = h.hand(1), dir = hp.clone().sub(h.bone('LeftForeArm').getWorldPosition(new THREE.Vector3())).normalize();
      this.stick.position.copy(hp).addScaledVector(dir, 0.02);
      this.stick.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      aim(cam, new THREE.Vector3(1.4, 0.9, 2.6), new THREE.Vector3(0, 1.35, 0));
    }
    S.render(this.ctx.renderer, out);
    return { bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.04 };
  }
}
