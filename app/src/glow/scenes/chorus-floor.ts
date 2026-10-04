// The chorus dance floor: an instanced grid of LED tiles whose light patterns run on the beat grid.
import * as THREE from 'three';
import { hash, smoothstep, clamp } from '../../engine/util';

export class DanceFloor extends THREE.InstancedMesh {
  n: number;
  tile: number;
  private c = new THREE.Color();

  constructor(n = 26, tile = 1.0) {
    const geo = new THREE.BoxGeometry(tile * 0.92, 0.12, tile * 0.92);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    super(geo, mat, n * n);
    this.n = n;
    this.tile = tile;
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        m.makeTranslation((i - (n - 1) / 2) * tile, -0.06, (j - (n - 1) / 2) * tile);
        this.setMatrixAt(i * n + j, m);
        this.setColorAt(i * n + j, new THREE.Color(0, 0, 0));
      }
    this.instanceMatrix.needsUpdate = true;
  }

  /**
   * Light the tiles. `beat` = continuous beat index, `cols` = the colours to cycle (linear),
   * `energy` 0..1 scales brightness; `flood` 0..1 floods every tile with `floodCol` (the "glowing" moment);
   * `ripples` = [time, x, z, colour] rings expanding from hits (slams).
   */
  light(t: number, beat: number, cols: THREE.Color[], energy: number, flood = 0, floodCol?: THREE.Color,
    ripples: { t: number; x: number; z: number; c: THREE.Color }[] = []) {
    const n = this.n, b = Math.floor(beat), ph = beat - b;
    const bar = Math.floor(beat / 4);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = (i - (n - 1) / 2) * this.tile, z = (j - (n - 1) / 2) * this.tile;
        const r = Math.hypot(x, z);
        // base pattern: a ring travelling outward on every beat + a checker that flips each bar
        const ringR = ph * 14;
        const ring = Math.exp(-Math.pow((r - ringR) / 1.1, 2)) * (1 - ph) * 0.9;
        const checker = ((i + j + bar) % 2 === 0 ? 1 : 0) * 0.22 * (0.6 + 0.4 * (1 - ph));
        const sparkle = hash(i, j, b) > 0.93 ? (1 - ph) * 0.8 : 0;
        let k = (ring + checker + sparkle) * energy;
        const ci = (i + j + b) % cols.length;
        this.c.copy(cols[ci]!).multiplyScalar(k);
        for (const rp of ripples) {
          const dt = t - rp.t;
          if (dt < 0 || dt > 1.2) continue;
          const d = Math.hypot(x - rp.x, z - rp.z);
          const w = Math.exp(-Math.pow((d - dt * 9) / 0.9, 2)) * (1 - dt / 1.2) * 1.6;
          this.c.r += rp.c.r * w; this.c.g += rp.c.g * w; this.c.b += rp.c.b * w;
        }
        if (flood > 0 && floodCol) {
          const f = clamp(flood * 1.6 - r / 22, 0, 1) * smoothstep(0, 1, flood);
          this.c.lerp(floodCol, f * 0.85);
        }
        // a faint floor glow so the grid reads even between hits
        this.c.r += 0.006; this.c.g += 0.007; this.c.b += 0.014;
        this.setColorAt(i * n + j, this.c);
      }
    this.instanceColor!.needsUpdate = true;
  }
}
