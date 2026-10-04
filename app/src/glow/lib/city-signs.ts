// Lettering for the night city, drawn once on a canvas: shop names for the sign bands over the storefronts, neon
// window signs (OPEN, BEER, ATM…), green street-name blades. Cells of 512×128 px; white on transparent (the
// shaders tint and light them).
import * as THREE from 'three';

export interface SignAtlas { tex: THREE.CanvasTexture; cell: (text: string, style: 'band' | 'neon' | 'blade') => number; cols: number; rows: number }

const FONT = '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", "DejaVu Sans", sans-serif';

export function signAtlas(texts: { band: string[]; neon: string[]; blade: string[] }): SignAtlas {
  const CW = 512, CH = 128, cols = 4;
  const keys: string[] = [];
  for (const t of texts.band) if (t) keys.push('b:' + t);
  for (const t of texts.neon) if (t) keys.push('n:' + t);
  for (const t of texts.blade) if (t) keys.push('s:' + t);
  const uniq = [...new Set(keys)];
  const rows = Math.max(1, Math.ceil(uniq.length / cols));
  const cv = document.createElement('canvas');
  cv.width = CW * cols; cv.height = CH * rows;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, cv.width, cv.height);
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const index = new Map<string, number>();
  uniq.forEach((k, i) => {
    index.set(k, i);
    const x = (i % cols) * CW, y = Math.floor(i / cols) * CH, text = k.slice(2), kind = k[0];
    c.save();
    c.beginPath(); c.rect(x, y, CW, CH); c.clip();
    const fit = (size: number, weight: string, max: number) => {
      let s = size;
      c.font = `${weight} ${s}px ${FONT}`;
      while (c.measureText(text).width > max && s > 12) { s -= 2; c.font = `${weight} ${s}px ${FONT}`; }
      return s;
    };
    if (kind === 'b') {
      // a sign band: bold capitals, slightly condensed
      fit(84, '800', CW - 40);
      c.fillStyle = '#fff';
      c.fillText(text, x + CW / 2, y + CH / 2 + 4);
    } else if (kind === 'n') {
      // neon: a tube with its glow
      fit(76, '600', CW - 70);
      c.shadowColor = 'rgba(255,255,255,0.9)';
      c.lineJoin = 'round';
      for (const [blur, w, a] of [[28, 10, 0.35], [12, 6, 0.6], [0, 3.5, 1]] as const) {
        c.shadowBlur = blur; c.lineWidth = w; c.strokeStyle = `rgba(255,255,255,${a})`;
        c.strokeText(text, x + CW / 2, y + CH / 2 + 3);
      }
    } else {
      // a street blade: white letters, a thin white border (the shader paints the green)
      c.strokeStyle = '#fff'; c.lineWidth = 5;
      c.strokeRect(x + 8, y + 14, CW - 16, CH - 28);
      fit(70, '700', CW - 60);
      c.fillStyle = '#fff';
      c.fillText(text, x + CW / 2, y + CH / 2 + 3);
    }
    c.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  const kindKey = { band: 'b:', neon: 'n:', blade: 's:' } as const;
  return { tex, cols, rows, cell: (t, st) => (t ? index.get(kindKey[st] + t) ?? -1 : -1) };
}
