// CUT KIT for the phosphor scenes that cut hard (phos-pre, phos-chorus): the language of the sister clip carried into
// the glow look. A 2D camera that is never at rest and jumps on hard cuts; type that SLAMS in on its sung onset;
// palette inversions (ink on phosphor); the sticker field seen through the camera with parallax; delay-line echoes.
//
//   Cam {x, y, z, r}          the point of the world at the frame centre, zoom, roll. camXf(cam) -> 2D affine (world -> screen)
//   Shot {t, cam(t)}          a framing that starts on a hard cut at t; shotAt(shots, t) picks the live one
//   slamK(t, on, o)           scale factor of a word that slams in at `on` (big -> 1 in ~0.1 s), 0 before it
//   pulses(t, ts, hl)         max of decaying pulses at times ts (camera punches, flashes)
//   txt(c, text, x, y, size, family, glow, tone, o)   phosphor-coloured text in any face (Archivo for the pressure type)
//   ink(c, text, ...)         black type (for inversions: the frame is flooded with phosphor, the word is a hole)
//   Field                     the sticker field in the dark, parallax through the camera (one draw into a StarField)
import { W, H } from '../../engine/gl';
import { F } from '../../engine/type';
import { clamp, hash, lerp, TAU } from '../../engine/util';
import { phosphorCss, PHOS_FONT, type Glow, type Tone, type StarField } from './phosphor';

export const CX = W / 2, CY = H / 2;

export interface Cam { x: number; y: number; z: number; r: number }
export const cam = (x = CX, y = CY, z = 1, r = 0): Cam => ({ x, y, z, r });
/** Blend two cameras (zoom in log space). */
export const mixCam = (a: Cam, b: Cam, k: number): Cam =>
  ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), k)), r: lerp(a.r, b.r, k) });

export interface Xf { a: number; b: number; c: number; d: number; e: number; f: number }
/** world -> screen: s = C + z R(r) (p - cam) (+ shake). */
export function camXf(k: Cam, sx = 0, sy = 0): Xf {
  const cs = Math.cos(k.r) * k.z, sn = Math.sin(k.r) * k.z;
  return { a: cs, b: sn, c: -sn, d: cs, e: CX + sx - (cs * k.x - sn * k.y), f: CY + sy - (sn * k.x + cs * k.y) };
}
export const apply = (m: Xf, x: number, y: number): [number, number] => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
export const scaleOf = (m: Xf) => Math.hypot(m.a, m.b);
export const rotOf = (m: Xf) => Math.atan2(m.b, m.a);
export function useXf(c: CanvasRenderingContext2D, m: Xf) { c.setTransform(m.a, m.b, m.c, m.d, m.e, m.f); }

export interface Shot { t: number; cam: (t: number) => Cam; id?: string }
/** The shot live at t (shots sorted by t); the first one before its start. */
export function shotAt(shots: Shot[], t: number): Shot {
  let s = shots[0]!;
  for (const x of shots) if (x.t <= t) s = x; else break;
  return s;
}

/** A word that slams in at `on`: 0 before (minus `pre`), then a scale that drops from `from` to 1 (time constant `tau`). */
export function slamK(t: number, on: number, o: { from?: number; tau?: number; pre?: number } = {}): number {
  const pre = o.pre ?? 0.0;
  if (t < on - pre) return 0;
  const dt = Math.max(0, t - on);
  return 1 + ((o.from ?? 1.6) - 1) * Math.exp(-dt / (o.tau ?? 0.035));
}
/** max over ts of a pulse that halves every hl seconds (0 before each). */
export function pulses(t: number, ts: number[], hl = 0.1, amp = 1): number {
  let v = 0;
  for (const x of ts) if (t >= x && t - x < hl * 12) v = Math.max(v, Math.pow(0.5, (t - x) / hl));
  return v * amp;
}

/** Phosphor-coloured text (left/centre/right aligned at x, baseline y) in any family (default Tilt Neon). */
export function txt(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, g: Glow, tone: Tone = 'green',
  o: { family?: string; align?: CanvasTextAlign; sx?: number; sy?: number; rot?: number; alpha?: number } = {}) {
  if (g.level < 0.004 && g.flash < 0.004) return;
  c.save();
  c.translate(x, y);
  if (o.rot) c.rotate(o.rot);
  if ((o.sx ?? 1) !== 1 || (o.sy ?? 1) !== 1) c.scale(o.sx ?? 1, o.sy ?? 1);
  c.font = `${size}px "${o.family ?? PHOS_FONT}"`;
  c.textAlign = o.align ?? 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = phosphorCss(g, tone, o.alpha ?? 1);
  c.fillText(text, 0, 0);
  c.restore();
}
/** Archivo family at a width (62..125 %) and weight (300..900). */
export const arch = (width: number, weight = 900) => F.archivo(width, weight);

/** Flood the whole frame (screen space) with a phosphor colour: the ground of an inversion. */
export function flood(c: CanvasRenderingContext2D, g: Glow, tone: Tone) {
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
  // a saturated ground (the phosphor ramp goes white at high levels): the tone's hue at a fixed value, plus the flash
  const base = tone === 'gold' ? [196, 124, 18] : tone === 'green' ? [112, 186, 34] : tone === 'violet' ? [96, 44, 200] : tone === 'cyan' ? [20, 160, 190] : null;
  if (base) {
    const k = clamp(g.level / 0.85, 0, 1.2), f = clamp(g.flash);
    c.fillStyle = `rgb(${base.map((v) => Math.round(Math.min(255, v * k + (255 - v * k) * f * 0.8))).join(',')})`;
  } else c.fillStyle = phosphorCss(g, tone);
  c.fillRect(-4, -4, W + 8, H + 8);
  c.restore();
}

// --------------------------------------------------------------------------------------------- field
export interface FieldStar { x: number; y: number; d: number; s: number; r: number; k: number; gold: boolean }
/**
 * The sticker field: stickers in a TW x TH tile that wraps, each at a depth d (0.25..1, 1 = on the type's plane). The
 * camera moves them by d (parallax) and zooms them by a damped z^d; roll turns them all.
 */
export class Field {
  stars: FieldStar[] = [];
  constructor(n: number, seed = 1, public TW = 2600, public TH = 2000) {
    for (let i = 0; i < n; i++) this.stars.push({
      x: hash(i, 1, seed) * TW, y: hash(i, 2, seed) * TH, d: 0.25 + 0.75 * Math.pow(hash(i, 3, seed), 1.3),
      s: 4 + 15 * Math.pow(hash(i, 4, seed), 2.4), r: hash(i, 5, seed) * TAU, k: hash(i, 6, seed), gold: hash(i, 7, seed) < 0.07,
    });
  }
  /** Screen position, size scale and visibility (0 off-screen) of star i under camera k with drift (dx, dy) px. */
  place(s: FieldStar, k: Cam, dx = 0, dy = 0): [number, number, number] {
    const z = Math.max(0.55, Math.pow(k.z, 0.45 * s.d));
    let rx = s.x + dx * s.d - k.x * s.d, ry = s.y + dy * s.d - k.y * s.d;
    rx = ((rx % this.TW) + this.TW) % this.TW - this.TW / 2;
    ry = ((ry % this.TH) + this.TH) % this.TH - this.TH / 2;
    const cs = Math.cos(k.r), sn = Math.sin(k.r);
    const x = CX + z * (cs * rx - sn * ry), y = CY + z * (sn * rx + cs * ry);
    const vis = x > -60 && x < W + 60 && y > -60 && y < H + 60 ? 1 : 0;
    return [x, y, vis * z];
  }
}

/** Draw a StarField sticker in world space through a transform. */
export function starW(sf: StarField, i: number, m: Xf, x: number, y: number, size: number, rot: number, g: Glow, tone: Tone, body = 0) {
  const [sx, sy] = apply(m, x, y), z = scaleOf(m);
  if (sx < -size * z * 2 - 40 || sx > W + size * z * 2 + 40 || sy < -size * z * 2 - 40 || sy > H + size * z * 2 + 40) return i;
  sf.set(i, sx, sy, size * z, rot + rotOf(m), g, tone, body);
  return i + 1;
}

export { clamp };
