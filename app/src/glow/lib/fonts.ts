// Display fonts for the artist name and titles (OFL / Apache, from Fontsource, in public/fonts/glow/),
// parsed with opentype.js on demand and turned into flat or extruded three.js geometry.
import * as THREE from 'three';
import * as opentype from 'opentype.js';

export const DISPLAY_FONTS = {
  tiltneon: 'TiltNeon.woff',
  monoton: 'Monoton.woff',
  neonderthaw: 'Neonderthaw.woff',
  orbitron: 'Orbitron-800.woff',
  syncopate: 'Syncopate-700.woff',
  unbounded: 'Unbounded-700.woff',
} as const;
export type DisplayFont = keyof typeof DISPLAY_FONTS;

const cache = new Map<DisplayFont, Promise<opentype.Font>>();

export function loadDisplayFont(k: DisplayFont): Promise<opentype.Font> {
  let p = cache.get(k);
  if (!p) {
    p = fetch(`fonts/glow/${DISPLAY_FONTS[k]}`).then((r) => {
      if (!r.ok) throw new Error(`font ${k}: HTTP ${r.status}`);
      return r.arrayBuffer();
    }).then((b) => opentype.parse(b));
    cache.set(k, p);
  }
  return p;
}

/**
 * Outline of `text` in `font`, `size` world units per em, centred on x, baseline at y = 0, y up, facing +z.
 * `depth` 0 gives a flat ShapeGeometry, otherwise an extrusion (front face at z = depth). `tracking` in em.
 */
export function displayTextGeometry(font: opentype.Font, text: string, size: number, o: { depth?: number; bevel?: number; tracking?: number; curveSegments?: number } = {}) {
  const px = 100, s = size / px, track = (o.tracking ?? 0) * px;
  const path = new THREE.ShapePath();
  let x = 0;
  const glyphs = font.stringToGlyphs(text);
  glyphs.forEach((g, i) => {
    for (const c of g.getPath(x, 0, px).commands as any[]) {
      if (c.type === 'M') path.moveTo(c.x, -c.y);
      else if (c.type === 'L') path.lineTo(c.x, -c.y);
      else if (c.type === 'Q') path.quadraticCurveTo(c.x1, -c.y1, c.x, -c.y);
      else if (c.type === 'C') path.bezierCurveTo(c.x1, -c.y1, c.x2, -c.y2, c.x, -c.y);
    }
    const next = glyphs[i + 1];
    x += (g.advanceWidth ?? 0) * (px / font.unitsPerEm) + (next ? font.getKerningValue(g, next) * (px / font.unitsPerEm) : 0) + (next ? track : 0);
  });
  const shapes = path.toShapes();
  const depth = o.depth ?? 0, bevel = o.bevel ?? 0;
  const geo = depth > 0
    ? new THREE.ExtrudeGeometry(shapes, { depth: Math.max(1e-3, depth / s - 2 * bevel / s), bevelEnabled: bevel > 0, bevelThickness: bevel / s, bevelSize: (bevel / s) * 0.7, bevelSegments: 2, curveSegments: o.curveSegments ?? 8 })
    : new THREE.ShapeGeometry(shapes, o.curveSegments ?? 8);
  if (depth > 0) geo.translate(0, 0, bevel / s);
  geo.translate(-x / 2, 0, 0);
  geo.scale(s, s, s);
  geo.computeBoundingBox();
  return geo;
}
