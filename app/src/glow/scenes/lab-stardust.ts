// Lab (not in the edit; render with `--lab lab-stardust`): test frames for the people of stardust and the
// chorus story. t in [0,1): alone — someone sits curled up in the dark, other dim lights far away;
// [1,2): "take my hand"; [2,3): a broken person becomes stars (k = shatter); [3,4): the galaxy of people,
// pulling back (k); [4,5): inside an arm of the galaxy — people holding hands.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { mulberry32 } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { RealFigure, bend, dance, limbDir, loadBody } from '../lib/people';
import { starJoints } from '../lib/stars';
import { Stardust, StardustBody } from '../lib/stardust';
import { Galaxy } from '../lib/galaxy';

export default class LabStardust extends Scene {
  st = new Stage(40, 0.05, 5000);
  stars = new GlowPoints(4000, 0.6);
  dust!: Stardust;
  figs: RealFigure[] = [];
  js: THREE.Vector3[][] = [];
  gal!: Galaxy;

  override async init() {
    const [rp, mi] = await Promise.all([loadBody('rpm'), loadBody('michelle')]);
    const S = this.st;
    S.bg.copy(col('night', 0.25));
    const r = mulberry32(5);
    for (let i = 0; i < this.stars.n; i++) {
      const v = new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize().multiplyScalar(3000);
      this.stars.set(i, v.x, v.y, v.z, col('white', 0.4 + r() * 1.2), 1, 0.4 + r() * r() * 2.2);
    }
    this.stars.commit();
    S.add(this.stars);
    const bodies = [new StardustBody(new RealFigure(rp, 'rpm', col('white')), 22000, 1), new StardustBody(new RealFigure(mi, 'michelle', col('white')), 22000, 2)];
    this.dust = new Stardust(bodies, [60, 400, 2200]);
    S.add(this.dust);
    this.figs = [new RealFigure(rp, 'rpm', col('white')), new RealFigure(mi, 'michelle', col('white'))];
    this.js = [[], []];
    this.gal = new Galaxy([new RealFigure(rp, 'rpm', col('white')), new RealFigure(mi, 'michelle', col('white'))], 7);
    S.add(this.gal.group);
  }

  private joints(fi: number, pos: THREE.Vector3, rotY: number, scale: number, pose: (f: RealFigure) => void) {
    const f = this.figs[fi]!;
    f.position.copy(pos);
    f.rotation.set(0, rotY, 0);
    f.scale.setScalar(scale);
    pose(f);
    return starJoints(f, this.js[fi]).map((v) => v.clone());
  }

  /** Low: shoulders forward, head down, arms hanging. */
  private sit(fg: RealFigure) {
    fg.setSpine(0.3, 0.05, 0.85, 0.12);
    for (const i of [0, 1]) {
      const s = i ? 1 : -1, u = limbDir(s, 0.08, 0.28);
      fg.setArm(i, u, bend(u, new THREE.Vector3(-s * 0.3, 0, 1), 0.35), 0.2);
      fg.setHand(i, 0.45);
      const th = limbDir(s, 0.04, 0.05);
      fg.setLeg(i, th, bend(th, new THREE.Vector3(0, 0, -1), 0.12));
    }
  }

  private sitOld(fg: RealFigure) {
    fg.setSpine(0.55, 0.04, 0.75, 0.1);
    for (const i of [0, 1]) {
      const s = i ? 1 : -1, th = limbDir(s, 0.12, 1.95);
      fg.setLeg(i, th, bend(th, new THREE.Vector3(0, -1, -0.4), 2.35));
      fg.setFoot(i, 0.3);
    }
    fg.updateMatrixWorld(true);
    for (const i of [0, 1]) {
      const knee = fg.bone(i ? 'RightLeg' : 'LeftLeg').getWorldPosition(new THREE.Vector3());
      const other = fg.bone(i ? 'LeftLeg' : 'RightLeg').getWorldPosition(new THREE.Vector3());
      fg.reach(i, knee.clone().lerp(other, 0.35).add(new THREE.Vector3(0, -0.12, 0.08).applyQuaternion(fg.quaternion)), new THREE.Vector3(0, -1, 0));
      fg.setHand(i, 0.6);
    }
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const mode = Math.max(0, Math.min(4, Math.floor(f.t)));
    const k = f.t - mode;
    const S = this.st, cam = S.cam, D = this.dust;
    const cyan = col('cyan', 1.6).lerp(col('white', 1.6), 0.25), deep = col('blue', 1.3).lerp(col('violet', 1.3), 0.35);
    const pink = col('pink', 1.6).lerp(col('white', 1.6), 0.2);
    this.gal.group.visible = mode >= 3;
    this.stars.visible = mode < 3;
    if (mode === 0) aim(cam, new THREE.Vector3(1.9, 0.3, 2.4), new THREE.Vector3(0, 0.0, 0));
    else if (mode === 1) aim(cam, new THREE.Vector3(0.3 + k, 0.5, 3.6), new THREE.Vector3(0, 0.2, 0));
    else if (mode === 2) aim(cam, new THREE.Vector3(0.4, 0.6, 4.2 + 2 * k), new THREE.Vector3(0, 0.6 + 1.2 * k, 0));
    else if (mode === 3) aim(cam, new THREE.Vector3(0, 30 + 230 * k, 40 + 120 * k), new THREE.Vector3(0, 0, 0));
    else {
      const P = this.gal.people.filter((p) => p.chain)[60]!;
      const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -f.t * 0.02);
      const c = P.p.clone().applyQuaternion(rot), up = P.up.clone().applyQuaternion(rot);
      const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0));
      aim(cam, c.clone().addScaledVector(side, -3 + 6 * k).addScaledVector(up, -2.5).add(new THREE.Vector3(0, 6, 0)), c.clone().addScaledVector(side, -1 + 2 * k));
    }
    S.cam.updateProjectionMatrix();
    D.time = f.t * 4;
    D.begin(cam);
    if (mode === 0) {
      const j = this.joints(0, new THREE.Vector3(0, 0, 0), 0.6, 1, (fg) => this.sit(fg));
      D.figure(j, 0, cyan, 0.45, { color2: deep });
      const r = mulberry32(3);
      for (let i = 0; i < 10; i++) {
        const fi = i % 2, z = -8 - r() * 40, x = (r() - 0.5) * (-z * 1.3), y = (r() - 0.5) * (-z * 0.6);
        const jj = this.joints(fi, new THREE.Vector3(x, y, z), r() * 6, 1, (fg) => this.sit(fg));
        D.figure(jj, fi, [cyan, pink][fi]!, 0.35, { color2: deep });
      }
    } else if (mode === 1) {
      const meet = new THREE.Vector3(0, 0.35, 0.35);
      const a = this.joints(0, new THREE.Vector3(-0.42, 0, 0), 0.5, 1, (fg) => {
        fg.setSpine(0.05, 0, 0.15, 0);
        const u = limbDir(-1, 0.2, 0.05); fg.setArm(0, u, bend(u, new THREE.Vector3(0, 0, 1), 0.3)); fg.setHand(0, 0.3);
        fg.reach(1, meet.clone().add(new THREE.Vector3(-0.03, 0, 0)), new THREE.Vector3(0, -0.5, -0.6));
      });
      const b = this.joints(1, new THREE.Vector3(0.42, 0, 0), -0.5, 1, (fg) => {
        fg.setSpine(0.05, 0, 0.1, 0);
        const u = limbDir(1, 0.2, 0.05); fg.setArm(1, u, bend(u, new THREE.Vector3(0, 0, 1), 0.3)); fg.setHand(1, 0.3);
        fg.reach(0, meet.clone().add(new THREE.Vector3(0.03, 0, 0)), new THREE.Vector3(0, -0.5, -0.6));
      });
      D.figure(a, 0, cyan, 1, { color2: deep, joints: 0.3 });
      D.figure(b, 1, pink, 1, { color2: col('violet', 1.3), joints: 0.3 });
      D.star(meet, col('white', 1), 2, 0.08);
    } else if (mode === 2) {
      const j = this.joints(1, new THREE.Vector3(0, 0, 0), -0.2, 1, (fg) => {
        fg.setSpine(-0.15, 0, -0.4, 0);
        for (const i of [0, 1]) { const u = limbDir(i ? 1 : -1, 2.3, 0.3); fg.setArm(i, u, bend(u, new THREE.Vector3(0, 0, 1), 0.2)); fg.setHand(i, 0.1); }
      });
      D.figure(j, 1, pink, 1, { color2: col('violet', 1.3), shatter: k });
    } else {
      this.gal.draw(D, f.t * 2.5, f.t, { cam });
    }
    D.end();
    S.render(this.ctx.renderer, out);
    return { bloom: 0.9, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.04 };
  }
}
