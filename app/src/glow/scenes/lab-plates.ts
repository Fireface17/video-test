// Lab: the drop-3 plate deck, one plate per second of song time (plate floor(t) mod count), full frame, unmoved.
// render.ts stills --lab lab-plates --t 0.5,1.5,...
import type * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { PlateDeck } from './cosmos-plates';

export default class LabPlates extends Scene {
  deck!: PlateDeck;
  override init() { this.deck = new PlateDeck(this.ctx.renderer); }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const i = Math.floor(f.t) % PlateDeck.count;
    this.ctx.comp.draw(this.ctx.renderer, this.deck.get(i), out, { mode: 'replace' });
    return { bloom: 0.6, vignette: 0.2, grain: 0.03 };
  }
}
