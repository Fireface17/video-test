// The video's palette (docs/glow/TREATMENT.md). three.js converts the sRGB hex values to the linear
// working space; anything multiplied above ~0.85 blooms.
import * as THREE from 'three';

export const GLOW_HEX = {
  night: '#05060F', // background
  dusk: '#0E1230', // fog, far haze
  ink: '#1B2150', // unlit surfaces
  phosphor: '#B6FF6A', // glow-in-the-dark green: stickers, "glowing"
  pink: '#FF3FA4',
  cyan: '#33E6FF',
  violet: '#9B5CFF',
  gold: '#FFC247', // "gold", "golden", the sun: earned moments only
  ember: '#FF8A2A',
  blue: '#3D6BFF', // the bridge
  white: '#FFFFFF',
} as const;
export type GlowKey = keyof typeof GLOW_HEX;

/** The glow-stick colours, in the order the rave and the chorus cycle through them. */
export const STICKS: GlowKey[] = ['pink', 'cyan', 'phosphor', 'violet'];

/** Linear colour of a palette key (or any CSS colour) times an intensity. */
export function col(k: GlowKey | string, intensity = 1): THREE.Color {
  return new THREE.Color((GLOW_HEX as Record<string, string>)[k] ?? k).multiplyScalar(intensity);
}

/** Linear [r, g, b] of a palette key. */
export function lin(k: GlowKey | string, intensity = 1): [number, number, number] {
  const c = col(k, intensity);
  return [c.r, c.g, c.b];
}

/** GLSL constants for the palette (linear), for custom shaders. */
export const GLSL_GLOW_PALETTE = Object.entries(GLOW_HEX)
  .map(([k, v]) => {
    const c = new THREE.Color(v);
    return `const vec3 G_${k.toUpperCase()} = vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)});`;
  })
  .join('\n');
