// Lab (not in the edit; `--lab lab-city`): test frames of the night city (lib/city.ts). Each 4 s is one setup:
//  0 aerial from a rooftop (45 m) across to midtown      1 high aerial (300 m) over the grid
//  2 street level (1.6 m) down an avenue                3 on the elevated line
//  4 blackout from the rooftop (power 0)                5 power coming back in a wave from a point (20–26 s)
//  7 the river and the overpass                         8 a side street at eye level (walk-ups, fire escapes, trees)
//  9 dawn                                               10 anchors: glowing people in windows, on fire escapes, balconies, roof edges
import * as THREE from 'three';
import { Scene, type Frame } from '../../engine/scene';
import { clamp, ease, lerp, prog } from '../../engine/util';
import { Stage, aim } from '../lib/stage';
import { GlowPoints } from '../lib/points';
import { City, type Anchor } from '../lib/city';

interface Shot { a: number; b: number; pos: (k: number) => THREE.Vector3; at: (k: number) => THREE.Vector3; fov?: number; setup?: (t: number, k: number) => void }

export default class LabCity extends Scene {
  st = new Stage(50, 0.3, 14000);
  city!: City;
  dots = new GlowPoints(600, 0.12);
  anchors: Anchor[] = [];
  shots: Shot[] = [];

  override async init() {
    const S = this.st;
    this.city = new City({ seed: 11, half: 1700, centre: [80, -950], downtownR: 520, clouds: 800 });
    S.add(this.city, this.dots);
    (window as unknown as { __labCity: LabCity }).__labCity = this;
    // stats: instanced vertices per kind of mesh
    const st: Record<string, [number, number, number]> = {};
    this.city.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.Points).isPoints) return;
      const g = m.geometry as THREE.InstancedBufferGeometry;
      const v = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
      const n = g.instanceCount ?? 1, key = (m.material as THREE.ShaderMaterial).uuid.slice(0, 4) + ':' + v;
      const e = st[key] ?? (st[key] = [0, 0, 0]);
      e[0]++; e[1] += n === Infinity ? 1 : n; e[2] += v * (n === Infinity ? 1 : n);
    });
    console.warn('CITY STATS ' + Object.entries(st).sort((a, b) => b[1][2] - a[1][2]).slice(0, 25).map(([k, [c, n, v]]) => `${k} meshes=${c} inst=${n} idx=${(v / 1e6).toFixed(2)}M`).join(' | ') + ` buildings=${this.city.plan.buildings.length} shops=${this.city.plan.shops.length} lamps=${this.city.plan.lamps.length} trees=${this.city.plan.trees.length} parked=${this.city.plan.parked.length}`);
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const c = this.city;
    this.anchors = c.anchors({ x: 40, z: 130, r: 140, kinds: ['window', 'fireEscape', 'balcony', 'roofEdge'], max: 60, seed: 3, spacing: 6, from: V(60, 30, 260) });
    const P = c.power;
    const reset = () => { P.clear(); c.dawn = 0; c.setGlows([]); this.dots.visible = false; };
    this.shots = [
      { a: 0, b: 4, pos: (k) => V(lerp(-20, 10, k), 46, 30), at: () => V(-60, 70, -1100), setup: reset },
      { a: 4, b: 8, pos: (k) => V(lerp(700, 560, k), 300, lerp(500, 380, k)), at: () => V(0, 0, -500), setup: reset },
      { a: 8, b: 12, pos: (k) => V(-125 + 7.5, 1.6, lerp(222, 214, k)), at: () => V(-125 + 1, 4, -700), fov: 55, setup: reset },
      { a: 12, b: 16, pos: (k) => V(375 + 2.1, 11.3, lerp(160, 120, k)), at: (k) => V(375, 9, lerp(-400, -440, k)), fov: 55, setup: reset },
      { a: 16, b: 20, pos: (k) => V(lerp(-20, 10, k), 46, 30), at: () => V(-60, 70, -1100), setup: () => { reset(); P.level = 0; } },
      { a: 20, b: 26, pos: (k) => V(lerp(60, 80, k), 140, 250), at: () => V(-60, 0, -500), setup: (t) => { reset(); P.level = 0; P.wave(0, { x: -100, z: -380, r: (t - 20.3) * 260, soft: 160, to: 1 }); } },
      { a: 26, b: 30, pos: (k) => V(1150, 22, lerp(420, 380, k)), at: () => V(900, 30, -900), setup: reset },
      { a: 30, b: 34, pos: (k) => V(lerp(30, 40, k), 1.6, 120 + 3.6), at: () => V(400, 6, 116), fov: 55, setup: reset },
      { a: 34, b: 38, pos: (k) => V(lerp(-20, 10, k), 46, 30), at: () => V(-60, 70, -1100), setup: () => { reset(); c.dawn = 1; } },
      {
        a: 38, b: 42, pos: (k) => V(lerp(55, 70, k), 22, 262), at: () => V(30, 14, 120), fov: 45,
        setup: (t) => {
          reset();
          P.level = 0.0;
          this.dots.visible = true;
          const glows: { pos: THREE.Vector3; color: THREE.Color; radius: number }[] = [];
          this.anchors.forEach((a, i) => {
            const p = a.pos.clone().addScaledVector(a.facing, 0.25).add(new THREE.Vector3(0, 1.0, 0));
            const col = i % 2 ? new THREE.Color(0.4, 0.8, 1.0) : new THREE.Color(1.0, 0.65, 0.5);
            this.dots.set(i, p.x, p.y, p.z, col, 3, 6);
            if (glows.length < 16) glows.push({ pos: p, color: col.clone().multiplyScalar(0.6), radius: 3 });
          });
          for (let i = this.anchors.length; i < this.dots.n; i++) this.dots.hide(i);
          this.dots.commit();
          c.setGlows(glows);
          void t;
        },
      },
    ];
  }

  override render(f: Frame, out: THREE.WebGLRenderTarget) {
    const t = f.t, S = this.st, cam = S.cam;
    const sh = this.shots.find((s) => t >= s.a && t < s.b) ?? this.shots[0]!;
    const k = clamp((t - sh.a) / (sh.b - sh.a));
    sh.setup?.(t, k);
    cam.fov = sh.fov ?? 50;
    cam.updateProjectionMatrix();
    aim(cam, sh.pos(ease.inOutQuad(k)), sh.at(k));
    this.city.update(t, cam.position);
    S.render(this.ctx.renderer, out);
    void prog;
    return { bloom: 0.85, bloomThreshold: 0.8, bloomRadius: 0.8, halation: 0.1, vignette: 0.4, grain: 0.04, ca: 0.6 };
  }
}
