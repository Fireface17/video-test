// Lab (not in the edit; render with `--lab lab-fonts`): the artist name in each candidate display font,
// one per second (t in [i, i+1) shows font i), glowing over the night sky as it would in the intro.
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { mulberry32 } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { col } from '../lib/palette';
import { GlowPoints } from '../lib/points';
import { DISPLAY_FONTS, displayTextGeometry, loadDisplayFont, type DisplayFont } from '../lib/fonts';

const NAME = 'FIREFACE17';
const OPTIONS: { font: DisplayFont; text: string; size: number; tracking: number }[] = [
  { font: 'tiltneon', text: NAME, size: 0.62, tracking: 0.04 },
  { font: 'monoton', text: NAME, size: 0.56, tracking: 0.02 },
  { font: 'neonderthaw', text: 'Fireface17', size: 1.0, tracking: 0 },
  { font: 'orbitron', text: NAME, size: 0.5, tracking: 0.08 },
  { font: 'syncopate', text: NAME, size: 0.42, tracking: 0.1 },
  { font: 'unbounded', text: NAME, size: 0.5, tracking: 0.03 },
];

export default class LabFonts extends Scene {
  st = new Stage(40, 0.05, 900);
  names: THREE.Group[] = [];
  stars = new GlowPoints(2500, 0.5);

  override async init() {
    const S = this.st;
    S.bg.copy(col('night', 0.6));
    const r = mulberry32(9);
    for (let i = 0; i < this.stars.n; i++) {
      const a = r() * Math.PI * 2, b = (r() - 0.5) * 1.2, R = 300;
      this.stars.set(i, Math.sin(a) * Math.cos(b) * R, Math.sin(b) * R, -Math.abs(Math.cos(a) * Math.cos(b)) * R, col('white', 0.4 + r() * 1.2), 1, 0.4 + r() * r() * 2);
    }
    this.stars.commit();
    S.add(this.stars);
    for (const o of OPTIONS) {
      const font = await loadDisplayFont(o.font);
      const g = new THREE.Group();
      // a hot white core over a soft coloured glow layer just behind it
      const core = new THREE.Mesh(displayTextGeometry(font, o.text, o.size, { tracking: o.tracking }), new THREE.MeshBasicMaterial({ color: col('white', 2.2).lerp(col('pink', 2.2), 0.25) }));
      const glow = new THREE.Mesh(displayTextGeometry(font, o.text, o.size, { tracking: o.tracking }), new THREE.MeshBasicMaterial({ color: col('pink', 1.3), transparent: true, opacity: 0.5 }));
      glow.position.z = -0.02;
      glow.scale.setScalar(1.015);
      g.add(glow, core);
      const bb = new THREE.Box3().setFromObject(core);
      g.position.y = -(bb.max.y + bb.min.y) / 2;
      this.names.push(g);
      S.add(g);
    }
    void DISPLAY_FONTS;
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const i = Math.max(0, Math.min(OPTIONS.length - 1, Math.floor(f.t)));
    this.names.forEach((g, k) => (g.visible = k === i));
    aim(this.st.cam, new THREE.Vector3(0, 0, 7), new THREE.Vector3(0, 0, 0));
    this.st.render(this.ctx.renderer, out);
    return { bloom: 1.0, bloomThreshold: 0.8, bloomRadius: 0.85, halation: 0.12, vignette: 0.45, grain: 0.03 };
  }
}
