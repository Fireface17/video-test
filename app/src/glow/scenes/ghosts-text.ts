// Lyrics as part of the image in the `ghosts` scene: frost growing on the window glass, the warm light trail that
// rises from the friends' joined hands and writes, a line curving around the moon that the night swallows with
// it, letters made of small warm lights hanging in the hall, and the neon punches of "here we go".
import * as THREE from 'three';
import type { Line } from '../../engine/lyrics';
import { LightTrail, lineText, sampleStrokeText } from '../lib/lightpaint';
import type { StrokeFontName } from '../../engine/stroke';
import { GLSL_EAT } from './ghosts-gfx';

/** A sub-line (some of a line's words) usable with LightTrail.writtenAt. */
export function subLine(l: Line, a: number, b: number): Line {
  return { ...l, words: l.words.slice(a, b), text: l.words.slice(a, b).map((w) => w.w).join(' ') };
}

const RIBBON_VERT = /* glsl */ `
  attribute vec3 aTan; attribute float aSide, aAlong, aCap;
  uniform float width;
  varying float vSide, vAlong, vCap; varying vec3 vLP;
  void main() {
    vLP = position;
  #ifdef FLAT
    // a flat ribbon in the text's own plane
    vec2 t = aTan.xy; float tl = length(t); t = tl > 1e-6 ? t / tl : vec2(1.0, 0.0);
    vec3 p = position + vec3(-t.y, t.x, 0.0) * aSide * width + vec3(t, 0.0) * aCap * width;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
  #else
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 tv = (modelViewMatrix * vec4(aTan, 0.0)).xyz;
    float tl = length(tv);
    tv = tl > 1e-6 ? tv / tl : vec3(1.0, 0.0, 0.0);
    vec3 sd = cross(tv, normalize(-mv.xyz));
    float sl = length(sd);
    sd = sl > 1e-6 ? sd / sl : vec3(0.0, 1.0, 0.0);
    mv.xyz += sd * aSide * width + tv * aCap * width;
  #endif
    vSide = aSide; vAlong = aAlong; vCap = aCap;
    gl_Position = projectionMatrix * mv;
  }`;

const HASH = /* glsl */ `float hh(float x) { return fract(sin(x * 127.1 + 31.7) * 43758.5453); }`;

/**
 * L18: frost crystals growing along the letters on the inside of the window glass (flat ribbons), glinting
 * in the moonlight; `melt` fades them.
 */
export function frostMaterial(color: THREE.Color, width: number) {
  return new THREE.ShaderMaterial({
    defines: { FLAT: 1 },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      color: { value: color.clone() }, width: { value: width }, reveal: { value: 0 }, gain: { value: 1 }, tipLen: { value: 0.12 },
      seed: { value: 0 }, uTime: { value: 0 }, melt: { value: 0 },
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float reveal, gain, tipLen, seed, uTime, melt;
      varying float vSide, vAlong, vCap; varying vec3 vLP;
      ${HASH}
      void main() {
        if (vAlong > reveal) discard;
        float d = reveal - vAlong;
        float grow = smoothstep(0.0, tipLen, d);
        // feathery ice: spikes along the stroke, of varying length, on both sides
        float u = vAlong * 140.0 + seed;
        float cell = floor(u), fu = fract(u);
        float spike = (1.0 - abs(fu - 0.5) * 2.0) * (0.35 + 0.65 * hh(cell + sign(vSide) * 13.0));
        float halfW = mix(0.25, 1.0, grow) * (0.52 + 0.48 * spike);
        // melting: the ice thins from its edges, in patches
        float patchM = hh(floor(vAlong * 9.0) + seed * 3.0);
        halfW *= 1.0 - smoothstep(patchM * 0.6, patchM * 0.6 + 0.4, melt);
        float r = sqrt(vSide * vSide + vCap * vCap);
        if (r > halfW) discard;
        float core = 1.0 - smoothstep(0.0, max(halfW, 1e-3), r);
        float tw = step(0.92, hh(floor(vAlong * 420.0) + floor((vSide + 1.0) * 2.0) * 7.1 + seed));
        float sparkle = tw * (0.5 + 0.5 * sin(uTime * 7.0 + vAlong * 90.0));
        vec3 c = color * (0.3 + 0.7 * core) + vec3(0.85, 0.92, 1.0) * sparkle * 1.4;
        c += vec3(0.8, 0.9, 1.0) * exp(-d / max(tipLen * 0.35, 1e-4)) * 2.0;
        gl_FragColor = vec4(c * gain, 1.0);
      }`,
  });
}

/** Text as frost: a LightTrail's geometry with the frost material (flat in its XY plane). */
export function frostText(text: string, font: StrokeFontName, size: number, color: THREE.Color, width: number, seed = 0) {
  const tr = LightTrail.text(text, font, size, { width });
  tr.material = frostMaterial(color, width);
  tr.material.uniforms.seed!.value = seed;
  return tr;
}

/**
 * L20: lettering in the moon's plane (moon at the local origin), bent onto an arc around it; written by a
 * silver pen, swallowed by the same night that eats the moon (moon-plane mask). `R` = moon radius.
 */
export function arcText(text: string, font: StrokeFontName, size: number, opts: { cy: number; radius: number; below: boolean; color: THREE.Color; width: number; R: number; seed?: number }) {
  const tr = LightTrail.text(text, font, size, { width: opts.width, color: opts.color, tipLen: size * 0.6, seed: opts.seed ?? 0 });
  // bend: x along the arc, y radial. Above: the baseline is a circle of `radius` around (0, cy), text outward.
  // Below: the baseline is a circle around (0, cy) too, the text upright, its top toward the centre.
  const pos = tr.geometry.getAttribute('position') as THREE.BufferAttribute, tan = tr.geometry.getAttribute('aTan') as THREE.BufferAttribute;
  const map = (x: number, y: number): [number, number] => {
    if (!opts.below) {
      const a = x / opts.radius, r = opts.radius + y;
      return [Math.sin(a) * r, opts.cy + Math.cos(a) * r];
    }
    const a = x / opts.radius, r = opts.radius - y;
    return [Math.sin(a) * r, opts.cy - Math.cos(a) * r];
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const [px, py] = map(x, y);
    const e = 1e-3;
    const [qx, qy] = map(x + tan.getX(i) * e, y + tan.getY(i) * e);
    pos.setXYZ(i, px, py, 0);
    const l = Math.hypot(qx - px, qy - py) || 1;
    tan.setXYZ(i, (qx - px) / l, (qy - py) / l, 0);
  }
  pos.needsUpdate = true; tan.needsUpdate = true;
  tr.material = new THREE.ShaderMaterial({
    defines: { FLAT: 1 },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      color: { value: opts.color.clone() }, width: { value: opts.width }, reveal: { value: 0 }, gain: { value: 1 }, tipLen: { value: size * 0.5 },
      seed: { value: opts.seed ?? 0 }, uTime: { value: 0 }, uEat: { value: 0 }, uEatDir: { value: new THREE.Vector2(-0.8, 0.6).normalize() }, uR: { value: opts.R },
    },
    vertexShader: RIBBON_VERT,
    fragmentShader: /* glsl */ `
      uniform vec3 color; uniform float reveal, gain, tipLen, seed, uTime, uR;
      varying float vSide, vAlong, vCap; varying vec3 vLP;
      ${GLSL_EAT}
      void main() {
        if (vAlong > reveal) discard;
        float r2 = vSide * vSide + vCap * vCap;
        if (r2 > 1.0) discard;
        float core = exp(-r2 * 7.0), halo = exp(-r2 * 2.2) * 0.4;
        float d = reveal - vAlong;
        float hot = exp(-d / max(tipLen, 1e-4));
        float wob = 0.85 + 0.15 * sin(vAlong * 9.0 + seed);
        vec3 c = color * (core * 1.4 + halo) * wob + vec3(1.0) * core * (0.2 + 1.8 * hot);
        float dark = eatMask(vLP.xy / uR, uTime);
        gl_FragColor = vec4(c * gain * (1.0 - dark), 1.0);
      }`,
  });
  return tr;
}

/**
 * L21: letters made of many small warm lights (points along the strokes), each lighting up as its word is
 * sung, sweeping through the word. Positions in the text's local plane (x centred, baseline y = 0).
 */
export function lightLetters(rows: { text: string; y: number; words: { start: number; end: number }[] }[], font: StrokeFontName, size: number, spacing: number) {
  const pts: { x: number; y: number; t: number; seed: number }[] = [];
  for (const row of rows) {
    const S = sampleStrokeText(row.text, font, size, spacing);
    // rank of each point within its word (sampling order = writing order)
    const count = new Map<number, number>(), rank: number[] = [];
    S.word.forEach((w) => { rank.push(count.get(w) ?? 0); count.set(w, (count.get(w) ?? 0) + 1); });
    S.pts.forEach((p, i) => {
      const w = row.words[S.word[i]!]!;
      const dur = Math.min(0.42, Math.max(0.16, (w.end - w.start) * 0.8));
      const n = count.get(S.word[i]!)!;
      pts.push({ x: p.x, y: p.y + row.y, t: w.start + (dur * rank[i]!) / Math.max(1, n - 1), seed: pts.length });
    });
  }
  return pts;
}

/** Re-export for the scene. */
export { lineText };
