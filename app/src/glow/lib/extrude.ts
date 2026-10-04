// Solid 3D lettering: font outlines (engine/type.ts, opentype) extruded with a bevel, one mesh per word.
import * as THREE from 'three';
import { F, layout, textPathCommands } from '../../engine/type';

/**
 * Extruded outline of `text` set in `family` at `sizePx`: x from the left edge, baseline at y = 0, y up,
 * front face at z = depth (bevel included), back at z = 0. Units are font px times `scale`.
 * Geometry groups: 0 = front/back caps, 1 = walls (incl. bevel).
 */
export function textGeometry(text: string, family: string, sizePx: number, o: { depth: number; bevel?: number; scale?: number; curveSegments?: number }) {
  const path = new THREE.ShapePath();
  for (const c of textPathCommands(text, family, sizePx) as any[]) {
    if (c.type === 'M') path.moveTo(c.x, -c.y);
    else if (c.type === 'L') path.lineTo(c.x, -c.y);
    else if (c.type === 'Q') path.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
    else if (c.type === 'C') path.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
  }
  const shapes = path.toShapes(); // (r186 finds holes by nesting, whatever the font's winding)
  const s = o.scale ?? 1, bevel = o.bevel ?? 0;
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(1e-3, o.depth / s - 2 * bevel / s), bevelEnabled: bevel > 0, bevelThickness: bevel / s, bevelSize: (bevel / s) * 0.7,
    bevelSegments: 2, curveSegments: o.curveSegments ?? 5,
  });
  geo.translate(0, 0, bevel / s);
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  return geo;
}

export interface BlockWord { text: string; mesh: THREE.Mesh; face: THREE.MeshBasicMaterial; side: THREE.MeshBasicMaterial; x0: number; x1: number }

export interface BlockOpts {
  family?: string;
  /** World units per em. */
  size?: number;
  depth?: number;
  bevel?: number;
  align?: 'left' | 'center' | 'right';
  tracking?: number;
  /** Face and wall colours (linear; > 1 glows). */
  face?: THREE.Color;
  side?: THREE.Color;
  fog?: boolean;
}

/**
 * A line of extruded words, origin at the baseline (aligned per opts.align), facing +z. Words keep
 * their place in the line's layout (font kerning), so they can be animated independently.
 */
export class BlockText extends THREE.Group {
  words: BlockWord[] = [];
  width = 0;
  capHeight = 0;

  constructor(public text: string, o: BlockOpts = {}) {
    super();
    const family = o.family ?? F.archivo(125, 900);
    const px = 200, s = (o.size ?? 1) / px;
    const lay = layout(text, family, px, o.tracking ?? 0);
    this.width = lay.width * s;
    this.capHeight = 0.7 * (o.size ?? 1);
    const ox = o.align === 'center' ? -this.width / 2 : o.align === 'right' ? -this.width : 0;
    let i = 0;
    for (const part of text.split(' ')) {
      if (!part) { i++; continue; }
      const gx = lay.glyphs[i]?.x ?? 0;
      const geo = textGeometry(part, family, px, { depth: o.depth ?? 0.25 * (o.size ?? 1), bevel: o.bevel ?? 0.02 * (o.size ?? 1), scale: s });
      const face = new THREE.MeshBasicMaterial({ color: o.face ?? new THREE.Color(1, 1, 1), fog: o.fog ?? true });
      const side = new THREE.MeshBasicMaterial({ color: o.side ?? new THREE.Color(0.2, 0.2, 0.2), fog: o.fog ?? true });
      const mesh = new THREE.Mesh(geo, [face, side]);
      mesh.position.x = ox + gx * s;
      this.add(mesh);
      const bb = geo.boundingBox!;
      this.words.push({ text: part, mesh, face, side, x0: mesh.position.x + bb.min.x, x1: mesh.position.x + bb.max.x });
      i += Array.from(part).length + 1;
    }
  }

  override dispose() { for (const w of this.words) { w.mesh.geometry.dispose(); w.face.dispose(); w.side.dispose(); } }
}
