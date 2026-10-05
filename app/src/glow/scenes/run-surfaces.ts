// Surfaces near the lens for the street scenes (citydrop, run, overpass): concrete (cast, with formwork joints,
// stains and rust streaks), paving slabs, asphalt (aggregate, lane paint, cracks, oil, puddles), a tar-and-gravel
// roof (membrane seams, gravel, puddles) and brick (running bond, mortar, soot). Lit like the city (sky, moon,
// the street light map, the glowing people via lib/city's shared uniforms and GLSL) plus up to 16 lights of the
// scene's own (string lights, lamps, a DJ's gear) set per frame, with wet reflections of the sky and the lights.
// Patterns are in the city's (plan) coordinates, so they stay put under the floating origin (run-props shiftRender).
import * as THREE from 'three';
import { CITY_GLSL, type City } from '../lib/city';

export const SURF = { CONCRETE: 0, SLABS: 1, ASPHALT: 2, TAR: 3, BRICK: 4 } as const;
export type SurfKind = (typeof SURF)[keyof typeof SURF];
const MAXL = 16;

/** Scene lights shared by every surface material of a scene: set(i, plan position, colour, radius) per frame. */
export class SurfLights {
  P = Array.from({ length: MAXL }, () => new THREE.Vector4(0, -1e5, 0, 1));
  C = Array.from({ length: MAXL }, () => new THREE.Vector4());
  n = { value: 0 };
  /** `spec`: how much it shows in the wet (0 for soft pools of light, like the glow round a person's feet). */
  set(i: number, p: THREE.Vector3Like, c: THREE.Color, r: number, spec = 1) {
    if (i >= MAXL || !Number.isFinite(p.x + p.y + p.z + c.r + c.g + c.b + r)) return;
    this.P[i]!.set(p.x, p.y, p.z, r);
    this.C[i]!.set(c.r, c.g, c.b, spec);
    this.n.value = Math.max(this.n.value, i + 1);
  }
  clear() { this.n.value = 0; }
}

export interface SurfOpts {
  /** Base albedo (linear). */
  alb?: THREE.Color;
  /** 0..1 wetness (puddles grow with it). */
  wet?: number;
  /** For asphalt: x of the walkway's edge (lane paint is laid out from it, as on lib/city's overpass deck). */
  lanesFrom?: number;
  /** How much of the city's street light map reaches it (0 on a roof or a deck high up). */
  street?: number;
  side?: THREE.Side;
}

export function surfaceMaterial(city: City, kind: SurfKind, lights: SurfLights, o: SurfOpts = {}) {
  const alb = o.alb ?? (kind === SURF.BRICK ? new THREE.Color(0.24, 0.085, 0.05) : kind === SURF.TAR ? new THREE.Color(0.05, 0.048, 0.046) : kind === SURF.ASPHALT ? new THREE.Color(0.06, 0.06, 0.064) : new THREE.Color(0.28, 0.275, 0.26));
  return new THREE.ShaderMaterial({
    side: o.side ?? THREE.FrontSide,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    defines: { KIND: kind, MAXL },
    uniforms: {
      ...(city.U as unknown as Record<string, THREE.IUniform>),
      uLP: { value: lights.P }, uLC: { value: lights.C }, uLN: lights.n,
      uAlb: { value: alb }, uWet: { value: o.wet ?? 0.4 }, uLanes: { value: o.lanesFrom ?? 0 }, uStreet: { value: o.street ?? 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW, vN;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      uniform vec4 uLP[MAXL]; uniform vec4 uLC[MAXL]; uniform int uLN;
      uniform vec3 uAlb; uniform float uWet, uLanes, uStreet;
      varying vec3 vW, vN;
      float fb(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 3.1) + 0.2 * vnoise(p * 4.37 + 7.7); }
      void main() {
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        vec3 P = vW - uOrigin;
        bool flat_ = abs(N.y) > 0.5;
        vec2 uv = flat_ ? P.xz : vec2(abs(N.x) > 0.5 ? P.z : P.x, P.y);
        vec3 alb = uAlb;
        float wet = 0.0, gloss = 0.0;
        float grit = vnoise(uv * 23.0) * 0.6 + vnoise(uv * 61.0) * 0.4;
#if KIND == 0
        // cast concrete: mottled, formwork panels, dark streaks running down from the top, rust under posts
        alb *= (0.78 + 0.35 * fb(uv * 0.6)) * (0.88 + 0.22 * grit);
        if (!flat_) {
          float jx = abs(fract(uv.x / 1.22) - 0.5), jy = abs(fract(uv.y / 0.61 + 0.3) - 0.5);
          alb *= 1.0 - 0.28 * smoothstep(0.485, 0.497, jx) - 0.12 * smoothstep(0.485, 0.497, jy);
          float streak = smoothstep(0.55, 0.9, vnoise(vec2(uv.x * 2.7, uv.y * 0.12 + 4.0))) * 0.45;
          alb *= 1.0 - streak;
          float rq = (fract(uv.x / 2.0) - 0.5) / 0.03, rust = exp(-rq * rq) * smoothstep(0.0, 1.0, vnoise(vec2(uv.x * 9.0, uv.y * 0.8)));
          alb = mix(alb, vec3(0.16, 0.07, 0.03), rust * 0.5);
        } else {
          float jz = abs(fract(uv.y / 1.5) - 0.5);
          alb *= 1.0 - 0.3 * smoothstep(0.488, 0.497, jz);
        }
        wet = flat_ ? smoothstep(0.62, 0.7, fb(uv * 0.35 + 5.0)) * uWet : 0.0;
#elif KIND == 1
        // paving slabs (1.5 m), each its own tone, joints, grit, gum spots, a puddle here and there
        vec2 cell = floor(uv / vec2(1.5, 1.5)), f = fract(uv / 1.5);
        alb *= 0.85 + 0.3 * h12(cell) ;
        alb *= 0.86 + 0.22 * grit;
        float joint = max(smoothstep(0.485, 0.497, abs(f.x - 0.5)), smoothstep(0.485, 0.497, abs(f.y - 0.5)));
        alb *= 1.0 - 0.45 * joint;
        float gum = step(0.993, h12(floor(uv * 9.0))) ;
        alb *= 1.0 - 0.5 * gum;
        alb *= 1.0 - 0.3 * smoothstep(0.55, 0.85, fb(uv * 0.25 + 9.0));
        wet = smoothstep(0.6, 0.68, fb(uv * 0.3 + 1.7)) * uWet;
#elif KIND == 2
        // asphalt: aggregate, lane paint laid out from the walkway's edge, sealed cracks, oil, puddles
        alb *= (0.7 + 0.55 * grit) * (0.85 + 0.3 * fb(uv * 0.2));
        float x = P.x - uLanes;
        float dash = step(abs(mod(x - 3.0, 4.0) - 2.0), 0.08) * step(fract(P.z / 12.0), 0.3) * step(x, 21.5) * step(4.5, x);
        float edge = step(abs(x - 3.75), 0.07) + step(abs(x - 20.8), 0.07);
        float cen = step(abs(abs(x - 11.0) - 0.12), 0.06);
        float paintK = clamp(dash + edge, 0.0, 1.0) * (0.75 + 0.25 * vnoise(uv * 13.0));
        alb = mix(alb, vec3(0.55, 0.55, 0.52), paintK);
        alb = mix(alb, vec3(0.55, 0.4, 0.08), cen * (0.8 + 0.2 * vnoise(uv * 11.0)));
        float crack = smoothstep(0.03, 0.0, abs(fb(uv * vec2(0.9, 0.25) + 2.0) - 0.5)) * smoothstep(0.4, 0.7, vnoise(uv * 0.4));
        alb *= 1.0 - 0.6 * crack;
        float oil = smoothstep(0.6, 0.8, fb(vec2(x * 1.6, P.z * 0.3) + 4.0)) * step(abs(mod(x - 3.0, 4.0) - 2.0) - 1.0, 0.0);
        alb *= 1.0 - 0.35 * oil;
        // expansion joints across the deck: a steel plate every 36 m
        float ej = smoothstep(0.2, 0.14, abs(mod(P.z, 36.0) - 18.0));
        alb = mix(alb, vec3(0.12, 0.12, 0.13), ej);
        gloss = ej * 0.6 + oil * 0.4;
        wet = max(smoothstep(0.58, 0.66, fb(uv * 0.22 + 3.3)), oil * 0.6) * uWet;
#elif KIND == 3
        // a tar roof: membrane sheets (1 m, lapped), gravel scattered in patches, stains, puddles in the low spots
        float lap = abs(fract(uv.x / 1.0) - 0.08);
        alb *= 0.85 + 0.25 * fb(uv * 0.8);
        alb *= 1.0 + 0.35 * smoothstep(0.06, 0.0, lap);
        float gr = step(0.6, vnoise(uv * 55.0)) * smoothstep(0.3, 0.7, fb(uv * 0.7 + 2.0));
        alb = mix(alb, vec3(0.13, 0.125, 0.12) * (0.6 + 0.8 * vnoise(uv * 120.0)), gr * 0.45);
        alb *= 1.0 - 0.35 * smoothstep(0.6, 0.85, fb(uv * 0.35 + 6.0));
        wet = smoothstep(0.6, 0.67, fb(uv * 0.28 + 8.0)) * uWet;
#else
        // brick, running bond: 0.215 × 0.065 with 10 mm joints; each brick its own colour; soot streaks
        vec2 b = uv / vec2(0.225, 0.075);
        b.x += 0.5 * mod(floor(b.y), 2.0);
        vec2 bi = floor(b), bf = fract(b);
        float mort = max(smoothstep(0.92, 0.96, bf.x), smoothstep(0.84, 0.9, bf.y));
        vec3 brick = alb * (0.75 + 0.5 * h12(bi)) * (0.9 + 0.2 * vnoise(uv * 30.0));
        alb = mix(brick, vec3(0.16, 0.15, 0.14), mort);
        alb *= 1.0 - 0.4 * smoothstep(0.5, 0.9, vnoise(vec2(uv.x * 1.3, uv.y * 0.15)));
#endif
        float p = power(vW.xz);
        vec3 L = ambient(N) * 1.2 + peopleGlow(vW, N) + streetLight(vW.xz, vW.y, p) * uStreet + sunLow(vW, N);
        vec3 V = normalize(vW - cameraPosition), R = reflect(V, N);
        vec3 spec = vec3(0.0);
        for (int i = 0; i < MAXL; i++) {
          if (i >= uLN) break;
          vec3 lp = uLP[i].xyz + uOrigin, d = lp - vW;
          float dd = dot(d, d), r = uLP[i].w;
          vec3 dir = d * inversesqrt(max(dd, 1e-4));
          L += uLC[i].rgb * (0.15 + 0.85 * max(dot(N, dir), 0.0)) / (1.0 + dd / (r * r));
          spec += uLC[i].rgb * uLC[i].w * pow(max(dot(R, dir), 0.0), 90.0) * 6.0 / (1.0 + dd / (r * r * 16.0));
        }
        float fres = 0.04 + 0.96 * pow(1.0 - clamp(abs(dot(V, N)), 0.0, 1.0), 5.0);
        vec3 c = alb * L * (1.0 - 0.5 * wet);
        c += (skyRefl(R) * 0.7 + spec) * (wet * (0.25 + 0.75 * fres) + gloss * 0.15 * fres);
        gl_FragColor = vec4(cityFog(c, vW, p), 1.0);
      }`,
  });
}

/** A flat rectangle (x0..x1, z0..z1) at height y, facing up, as a mesh for a surface material. */
export function floorRect(x0: number, z0: number, x1: number, z1: number, y: number, mat: THREE.Material) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, 1, 1).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

/** A box (centre, size) for a surface material (walls, parapets, fascias). */
export function surfBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: THREE.Material) {
  const g = new THREE.BoxGeometry(sx, sy, sz).translate(cx, cy, cz);
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

/**
 * A profile (x, y pairs, in order, the outside on the left of the path) swept along z from z0 to z1 at (x0, y0):
 * a jersey barrier, a kerb, a parapet's coping. Flat-shaded per segment; open ends.
 */
export function profileRun(pts: [number, number][], x0: number, y0: number, z0: number, z1: number, mat: THREE.Material) {
  const pos: number[] = [], nor: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!;
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    // (walking the profile from a to b, bottom-left over the top to bottom-right, the outward normal is (-dy, dx))
    const nx = -dy / l, ny = dx / l;
    const A = [x0 + ax, y0 + ay], B = [x0 + bx, y0 + by];
    const quad = [[A, z0], [B, z1], [B, z0], [A, z0], [A, z1], [B, z1]] as const;
    for (const [p, z] of quad) { pos.push(p[0]!, p[1]!, z); nor.push(nx, ny, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}
