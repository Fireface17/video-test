// The life of the night city's streets: storefronts (lit interiors — a deli's fridges, a laundromat's washers, a bar's
// bottles, a closed café — sign bands and neon from the sign atlas, roll-down gates with graffiti, papered-up
// vacant shops, lit lobbies), awnings; parked cars; moving traffic (a green wave on the avenues, queues at red on
// the crosstown streets) with head-, tail- and brake lights that reflect in the wet streets; traffic signals on
// mast arms cycling; street trees in pits, hydrants, trash cans and bags, mailboxes, newspaper boxes, kiosks, bus
// shelters, subway stairs with their green globes; steam from the manholes and the striped stacks.
import * as THREE from 'three';
import { mulberry32 } from '../../engine/util';
import type { City, CityOpts } from './city';
import { CITY_GLSL, type CityUniforms } from './city-glsl';
import { CAR_PAINT_GLSL, KitBuilder, M, TileSet, kitBatch, kitMaterial, type KInst } from './city-build';
import { carDetailGeometry } from './city-cars';
import { SHOP } from './city-plan';
import { signAtlas, type SignAtlas } from './city-signs';
import { overpassCars } from './city-rail';
import { SCALE } from '../../engine/gl';

/** Signal timing: a 30 s cycle; avenue green 0–16, yellow –19; street green 20–27, yellow –29. Green wave at V_WAVE m/s. */
export const SIG = { P: 30, V_WAVE: 11 } as const;

const AWNINGS: [number, number, number][] = [[0.45, 0.05, 0.04], [0.04, 0.22, 0.1], [0.05, 0.08, 0.25], [0.3, 0.04, 0.08], [0.12, 0.12, 0.12], [0.5, 0.25, 0.04], [0.45, 0.05, 0.04], [0.05, 0.2, 0.25]];
const CAR_COLORS: [number, number, number][] = [
  [0.02, 0.02, 0.022], [0.5, 0.5, 0.52], [0.3, 0.31, 0.33], [0.6, 0.6, 0.6], [0.08, 0.1, 0.16], [0.25, 0.03, 0.03], [0.04, 0.04, 0.05], [0.35, 0.33, 0.3],
  [0.62, 0.45, 0.04], [0.62, 0.45, 0.04], [0.1, 0.14, 0.12], [0.45, 0.45, 0.47], [0.02, 0.025, 0.04], [0.15, 0.15, 0.16], [0.62, 0.45, 0.04], [0.55, 0.55, 0.56],
];
const TAXI: [number, number, number] = [0.66, 0.46, 0.03];

// ---------------------------------------------------------------- storefronts

function shopMaterial(U: CityUniforms, atlas: SignAtlas, near: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { ...(U as unknown as Record<string, THREE.IUniform>), uAtlas: { value: atlas.tex }, uAtlasGrid: { value: new THREE.Vector2(atlas.cols, atlas.rows) } },
    defines: { SHOP_NEAR: near ? 1 : 0 },
    vertexShader: /* glsl */ `
      attribute vec4 iPos; attribute vec4 iSize; attribute vec4 iSign;
      varying vec3 vW, vN; varying vec2 vS, vFk; varying vec4 vSize, vSign; varying float vP;
      ${CITY_GLSL}
      void main() {
        float c = cos(iPos.w), s = sin(iPos.w);
        vec3 lp = vec3(position.x * iSize.x, position.y * iSize.y, 0.04);
        vec3 wp = vec3(c * lp.x + s * lp.z, lp.y, -s * lp.x + c * lp.z) + iPos.xyz;
        vec4 w = modelMatrix * vec4(wp, 1.0);
        vW = w.xyz; vN = vec3(s, 0.0, c); vS = vec2((position.x + 0.5) * iSize.x, position.y * iSize.y);
        vSize = iSize; vSign = iSign; vP = power(w.xz); vFk = fogK(w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas; uniform vec2 uAtlasGrid;
      varying vec3 vW, vN; varying vec2 vS, vFk; varying vec4 vSize, vSign; varying float vP;
      ${CITY_GLSL}
      float atlas(float cell, vec2 uv) {
        if (cell < 0.0) return 0.0;
        vec2 cr = vec2(mod(cell, uAtlasGrid.x), floor(cell / uAtlasGrid.x));
        vec2 q = (cr + clamp(uv, 0.0, 1.0)) / uAtlasGrid;
        return texture2D(uAtlas, vec2(q.x, 1.0 - (cr.y + 1.0 - clamp(uv.y, 0.0, 1.0)) / uAtlasGrid.y)).a * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      }
      void main() {
        float w = vSize.x, h = vSize.y, kind = vSize.z, seed = vSize.w;
        float sx = vS.x, sy = vS.y;
        vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
        float p = vP;
        // open at this hour, and powered (each shop switches on at its own threshold, with a flicker)
        float th = 0.15 + 0.5 * fract(seed * 13.1), dp = p - th;
        float pw = step(0.0, dp) * mix(step(0.4, h12(vec2(seed * 77.0, floor(uTime * 16.0)))), 1.0, smoothstep(0.02, 0.08, dp));
        float lit = vSign.w * pw;
        float lobby = step(12.5, kind);
        float pil = (step(sx, 0.3) + step(w - 0.3, sx)) * (1.0 - lobby);
        float band = step(h - 1.05, sy) * step(sy, h - 0.12) * (1.0 - pil) * (1.0 - lobby);
        float doorL = step(0.5, fract(seed * 7.3));
        float dx0 = mix(w - 1.45, 0.35, doorL);
        float door = step(dx0, sx) * step(sx, dx0 + 1.1) * step(sy, h - 1.12) * (1.0 - lobby);
        float glassZ = (1.0 - pil) * (1.0 - band) * step(sy, h - 1.12) * max(step(0.55, sy), door);
        if (lobby > 0.5) { glassZ = step(0.15, sx) * step(sx, w - 0.15) * step(sy, h - 0.35); door = glassZ; }
        float gated = (1.0 - vSign.w) * (1.0 - lobby) * (1.0 - step(abs(kind - 12.0), 0.1)) * max(step(abs(kind - 7.0), 0.1), step(0.35, fract(seed * 3.3)));
        float gateZ = gated * (1.0 - pil) * step(sy, h - 1.05) * step(0.3, sx) * step(sx, w - 0.3);
        vec3 Lw = ambient(N) + streetLight(vW.xz + N.xz * 1.5, vW.y, p) + peopleGlow(vW, N);
        // light colour of the shop
        vec3 Lc = kind < 0.5 ? vec3(0.9, 0.97, 1.0) : kind < 1.5 ? vec3(0.85, 0.95, 1.0) : kind < 2.5 ? vec3(1.0, 0.62, 0.32) : kind < 3.5 ? vec3(1.0, 0.75, 0.45)
          : kind < 4.5 ? vec3(1.0, 0.35, 0.18) : kind < 5.5 ? vec3(0.9, 1.0, 0.95) : kind < 6.5 ? vec3(1.0, 0.75, 0.88) : kind < 8.5 ? vec3(1.0, 0.6, 0.35)
          : kind < 9.5 ? vec3(0.95, 0.95, 1.0) : kind < 10.5 ? vec3(1.0, 0.8, 0.55) : kind < 11.5 ? vec3(0.7, 0.85, 1.0) : vec3(1.0, 0.72, 0.42);
        float Lk = (kind < 1.5 || abs(kind - 5.0) < 0.1 || abs(kind - 9.0) < 0.1 ? 1.1 : abs(kind - 4.0) < 0.1 || abs(kind - 2.0) < 0.1 || abs(kind - 8.0) < 0.1 ? 0.35 : 0.75) * lit;
        Lc *= mix(1.0, 0.7, gold) ;
        // ---- the shop interior behind the glass ----
        vec3 inside = vec3(0.004, 0.004, 0.005) + Lc * Lk * 0.25;
        #if SHOP_NEAR
          {
            vec3 T = vec3(N.z, 0.0, -N.x);
            vec3 rd = normalize(vec3(dot(V, T), V.y, dot(V, -N)));
            vec3 R = vec3(max(w - 0.6, 1.0), h - 1.15, lobby > 0.5 ? 4.0 : 6.5);
            vec3 ro = vec3(clamp(sx - 0.3, 0.01, R.x - 0.01), clamp(sy, 0.01, R.y - 0.01), 0.05);
            vec3 tm = (mix(vec3(0.0), R, step(0.0, rd)) - ro) / (rd + sign(rd + 1e-6) * 1e-4);
            float t = min(tm.x, min(tm.y, tm.z));
            vec3 q = ro + rd * t;
            float back = step(tm.z, t + 1e-4), ceilF = step(tm.y, t + 1e-4) * step(0.0, rd.y), floorF = step(tm.y, t + 1e-4) * step(rd.y, 0.0);
            float sideF = 1.0 - min(back + ceilF + floorF, 1.0);
            // shelves of goods (deli, pharmacy, liquor), washers (laundromat), bottles (bar), chairs up on tables (café, restaurant), ATMs (bank)
            float shelfY = step(fract(q.y / 0.48), 0.12);
            vec2 gcell = floor(vec2((q.x + q.z) * 7.0, q.y / 0.48 * 3.0));
            vec3 goods = mix(vec3(0.9, 0.3, 0.2), mix(vec3(0.2, 0.5, 0.9), vec3(0.95, 0.85, 0.3), h12(gcell + 3.0)), h12(gcell));
            vec3 wallC = vec3(0.75, 0.75, 0.72);
            float stock = step(abs(kind), 0.1) + step(abs(kind - 5.0), 0.1) + step(abs(kind - 9.0), 0.1);
            vec3 cb = mix(wallC, mix(goods, vec3(0.2), shelfY), stock * step(q.y, 2.1));
            // laundromat: two rows of round washer doors
            vec2 wq = vec2(fract(q.x / 0.75) - 0.5, q.y - 0.55 - step(1.0, q.y) * 0.75);
            float washer = step(abs(kind - 1.0), 0.1) * step(length(wq * vec2(0.75, 1.0)), 0.26) * step(q.y, 1.75);
            cb = mix(cb, vec3(0.15, 0.2, 0.25) + vec3(0.6) * smoothstep(0.2, 0.26, length(wq * vec2(0.75, 1.0))), washer);
            cb = mix(cb, vec3(0.92), step(abs(kind - 1.0), 0.1) * (1.0 - washer) * step(q.y, 1.8) * 0.6);
            // bar: backlit bottles
            float bottles = step(abs(kind - 4.0), 0.1) * step(abs(q.y - 1.5), 0.45) * step(0.55, fract(q.x * 5.0)) * step(0.3, h12(floor(vec2(q.x * 5.0, q.y * 2.0))));
            cb = mix(cb * 0.5, vec3(1.0, 0.65, 0.25) * 2.0, bottles);
            // café / restaurant: chairs up on the tables, a counter
            float chairs = (step(abs(kind - 2.0), 0.1) + step(abs(kind - 8.0), 0.1)) * step(0.75, fract(q.x * 1.4 + q.z * 0.3)) * step(q.y, 1.4);
            cb *= 1.0 - 0.7 * chairs;
            // bank: the ATMs' screens
            float atm = step(abs(kind - 11.0), 0.1) * step(abs(fract(q.x / 1.4) - 0.5), 0.16) * step(abs(q.y - 1.3), 0.15);
            cb = mix(cb, vec3(0.3, 0.8, 1.0) * 2.5, atm);
            // lobby: marble, a brass mailbox wall, a pendant
            cb = mix(cb, vec3(0.8, 0.75, 0.65) * (0.8 + 0.2 * sin(q.x * 3.0 + q.y * 1.7)), lobby);
            // ceiling: fluorescent strips (or a warm pendant), floor tiles
            float strip = step(abs(fract(q.z / 1.6) - 0.5), 0.07) * step(abs(q.x - R.x * 0.5), R.x * 0.42);
            float pend = exp(-dot(q.xz - vec2(R.x * 0.5, R.z * 0.4), q.xz - vec2(R.x * 0.5, R.z * 0.4)) * 1.5);
            float warmShop = step(abs(kind - 2.0), 0.1) + step(abs(kind - 4.0), 0.1) + step(abs(kind - 8.0), 0.1) + step(abs(kind - 10.0), 0.1) + lobby;
            vec3 cc = vec3(0.7) + vec3(4.0) * mix(strip, pend, warmShop);
            vec3 cf = vec3(0.5) * (0.75 + 0.25 * mod(floor(q.x * 3.3) + floor(q.z * 3.3), 2.0));
            // side walls: the deli's fridges glow
            vec3 cs = mix(wallC * 0.8, vec3(0.8, 0.95, 1.0) * 2.2 * step(0.08, fract(q.z / 0.9)) * step(0.4, q.y) * step(q.y, 2.0), step(abs(kind), 0.1));
            vec3 room = (cb * back + cc * ceilF + cf * floorF + cs * sideF) * Lc * Lk * 0.42 * (1.0 - 0.4 * clamp(t / R.z, 0.0, 1.0));
            inside = mix(inside, room, step(0.01, lit));
          }
        #else
          inside += Lc * Lk * 0.3;
        #endif
        // papered-up windows of a vacant shop, FOR RENT
        float vacant = step(abs(kind - 12.0), 0.1);
        inside = mix(inside, vec3(0.32, 0.24, 0.15) * (0.75 + 0.3 * vnoise(vec2(sx, sy) * 3.0)) * Lw, vacant);
        // neon in the window
        vec2 nuv = vec2((sx - (w * 0.5 - 1.15 + (doorL - 0.5) * 0.8)) / 2.3, (sy - (h - 2.15)) / 0.58);
        float neon = atlas(vSign.y, nuv) * lit;
        vec3 neonC = kind < 0.5 ? (fract(seed * 5.0) < 0.5 ? vec3(1.0, 0.1, 0.15) : vec3(0.2, 0.5, 1.0)) : kind < 3.5 ? vec3(1.0, 0.15, 0.1) : kind < 4.5 ? vec3(1.0, 0.55, 0.1) : kind < 6.5 ? vec3(1.0, 0.25, 0.65) : kind < 9.5 ? vec3(1.0, 0.2, 0.1) : vec3(0.2, 1.0, 0.45);
        neonC *= 0.75 + 0.25 * step(0.04, h12(vec2(seed * 13.0, floor(uTime * 24.0)))) ;
        // glass: the room, reflections of the street, a little sky
        vec3 Rf = reflect(V, N);
        float fres = pow(1.0 - clamp(abs(dot(V, N)), 0.0, 1.0), 3.0);
        vec3 glass = inside + skyRefl(Rf) * (0.05 + 0.4 * fres) + streetLight(vW.xz + N.xz * 4.0, 1.5, p) * 0.06 + neonC * neon * 2.2;
        float frame = (step(abs(sy - (h - 1.12)), 0.04) + step(abs(sx - dx0), 0.04) * (1.0 - lobby) + step(abs(sx - dx0 - 1.1), 0.04) * (1.0 - lobby) + step(abs(sy - 0.55), 0.03) * (1.0 - door)) ;
        glass = mix(glass, vec3(0.06, 0.06, 0.065) * Lw + Lc * Lk * 0.05, clamp(frame, 0.0, 1.0) * glassZ);
        // the sign band: a backlit panel with the shop's name
        float si = vSign.z;
        vec3 sc = si < 0.5 ? vec3(0.9, 0.12, 0.08) : si < 1.5 ? vec3(0.08, 0.45, 0.2) : si < 2.5 ? vec3(0.95, 0.75, 0.12) : si < 3.5 ? vec3(0.1, 0.25, 0.8) : si < 4.5 ? vec3(0.85, 0.85, 0.82) : si < 5.5 ? vec3(0.05, 0.05, 0.06) : si < 6.5 ? vec3(0.75, 0.1, 0.45) : vec3(0.95, 0.45, 0.08);
        float bandLit = pw * step(0.3, fract(seed * 9.1) + vSign.w);
        float letters = atlas(vSign.x, vec2((sx - 0.35) / max(w - 0.7, 0.5), (sy - (h - 1.05)) / 0.93));
        vec3 txtC = si > 3.5 && si < 4.5 ? vec3(0.08, 0.06, 0.05) : mix(vec3(1.0, 0.97, 0.9), vec3(1.0, 0.9, 0.4), step(4.5, si));
        vec3 bandC = sc * (Lw * 0.9 + bandLit * 0.55) ;
        bandC = mix(bandC, txtC * (Lw + bandLit * 1.4), letters);
        // the roll-down gate: corrugated steel, graffiti tags, a lock slot; its housing above
        vec2 gq = vec2(sx, sy);
        float rib = 0.75 + 0.25 * sin(sy * 69.8);
        vec3 gateC = mix(vec3(0.3, 0.31, 0.32), mix(vec3(0.12, 0.22, 0.14), vec3(0.32, 0.1, 0.08), step(0.5, fract(seed * 4.7))), step(0.6, fract(seed * 2.9)));
        float g1 = fbm3(gq * vec2(0.9, 1.4) + seed * 17.0);
        float tag = smoothstep(0.035, 0.0, abs(vnoise(gq * vec2(2.6, 3.2) + seed * 9.0) - 0.5)) * step(0.62, vnoise(gq * 0.6 + seed));
        vec3 paint = mix(mix(vec3(0.9, 0.2, 0.5), vec3(0.2, 0.7, 0.95), fract(seed * 6.1)), vec3(0.95, 0.8, 0.2), step(0.5, fract(seed * 8.3)));
        gateC = mix(gateC, paint * 0.8, smoothstep(0.58, 0.62, g1) * step(sy, 2.4));
        gateC = mix(gateC, vec3(0.02), tag * 0.9);
        gateC *= rib * (Lw + Lc * 0.02);
        gateC *= 1.0 - 0.6 * step(sy, 0.08) - 0.5 * step(abs(sx - w * 0.5), 0.25) * step(abs(sy - 0.2), 0.04);
        // walls: pilasters (stone / painted), bulkhead tiles
        vec3 pilC = mix(vec3(0.32, 0.3, 0.27), vec3(0.1, 0.1, 0.11), step(0.5, fract(seed * 5.9))) * Lw;
        vec3 bulk = vec3(0.1, 0.09, 0.08) * (0.8 + 0.2 * step(0.5, fract(sx * 3.0))) * Lw;
        vec3 c = bulk;
        c = mix(c, glass, glassZ);
        c = mix(c, gateC, gateZ);
        c = mix(c, bandC, band);
        c = mix(c, pilC, pil);
        // a lobby's door light
        c += vec3(1.0, 0.75, 0.45) * lobby * lit * 2.5 * exp(-((sx - w * 0.5) * (sx - w * 0.5) * 6.0 + (sy - h + 0.1) * (sy - h + 0.1) * 40.0));
        gl_FragColor = vec4(applyFog(c, vFk, p), 1.0);
      }`,
  });
}

// ---------------------------------------------------------------- geometries

function awningGeometry() {
  const k = new KitBuilder(), v = [1, 1, 1, M.STRIPES];
  k.poly4([-0.5, 0, 0], [0.5, 0, 0], [0.5, -0.55, 1.4], [-0.5, -0.55, 1.4], v);
  k.poly4([-0.5, -0.55, 1.4], [0.5, -0.55, 1.4], [0.5, -0.85, 1.4], [-0.5, -0.85, 1.4], [1, 1, 1, M.TINT]);
  k.poly4([-0.5, 0, 0], [-0.5, -0.55, 1.4], [-0.5, -0.85, 1.4], [-0.5, -0.3, 0], [1, 1, 1, M.TINT]);
  k.poly4([0.5, 0, 0], [0.5, -0.3, 0], [0.5, -0.85, 1.4], [0.5, -0.55, 1.4], [1, 1, 1, M.TINT]);
  return k.geometry();
}

/** A car pointing +z: 0 sedan, 1 SUV, 2 taxi, 3 van. y = 0 the road. Built from a side profile: body, greenhouse, wheels. */
export function carGeometry(type: number) {
  const k = new KitBuilder();
  // side profile (z, y) from the front bumper over the roof to the rear bumper; the belt line splits body and glass
  const prof: [number, number][] = type === 1
    ? [[2.42, 0.32], [2.46, 0.78], [2.3, 1.02], [1.25, 1.12], [0.75, 1.72], [-1.95, 1.76], [-2.4, 1.6], [-2.46, 0.78], [-2.42, 0.32]]
    : type === 3
      ? [[2.62, 0.3], [2.66, 0.8], [2.45, 1.08], [1.75, 1.3], [1.35, 2.15], [-2.6, 2.18], [-2.66, 2.0], [-2.66, 0.8], [-2.62, 0.3]]
      : [[2.35, 0.28], [2.39, 0.66], [2.22, 0.8], [0.95, 0.94], [0.22, 1.42], [-0.95, 1.43], [-1.7, 1.02], [-2.32, 0.98], [-2.4, 0.64], [-2.36, 0.28]];
  const W = type === 3 ? 2.0 : type === 1 ? 1.95 : 1.84, belt = type === 1 ? 1.12 : type === 3 ? 1.2 : 0.96, tuck = type === 3 ? 0.05 : 0.17;
  const paint = [1, 1, 1, M.TINT], glass = [0.025, 0.03, 0.035, M.GLASS], dark = [0.02, 0.02, 0.022, M.ALB];
  const half = (y: number) => W / 2 - (y > belt ? tuck * Math.min(1, (y - belt) / 0.35) : 0);
  // the strip across the top: each profile segment a quad (windshield and rear window are glass)
  for (let i = 0; i + 1 < prof.length; i++) {
    const [z0, y0] = prof[i]!, [z1, y1] = prof[i + 1]!;
    const isGlass = y0 > belt - 0.01 && y1 > belt - 0.01 && Math.abs(y1 - y0) > 0.15;
    const h0 = half(y0), h1 = half(y1);
    k.poly4([-h0, y0, z0], [h0, y0, z0], [h1, y1, z1], [-h1, y1, z1], isGlass ? glass : paint);
  }
  // the sides: body below the belt line (paint), greenhouse above it (glass with a dark pillar)
  const side = (sx: number) => {
    const body = prof.map(([z, y]) => [z, Math.min(y, belt)] as [number, number]);
    const tris = THREE.ShapeUtils.triangulateShape(body.map(([z, y]) => new THREE.Vector2(z, y)), []);
    for (const [a, b, c] of tris) {
      const P = [body[a]!, body[b]!, body[c]!].map(([z, y]) => [sx * half(y), y, z]);
      if (sx > 0) k.tri(P[0]!, P[2]!, P[1]!, paint); else k.tri(P[0]!, P[1]!, P[2]!, paint);
    }
    const gh = prof.filter(([, y]) => y >= belt - 0.01);
    if (gh.length >= 2) {
      const zf = gh[0]![0], zb = gh[gh.length - 1]![0];
      const poly: [number, number][] = [[zf, belt], ...gh.filter(([, y]) => y > belt + 0.01), [zb, belt]];
      const t2 = THREE.ShapeUtils.triangulateShape(poly.map(([z, y]) => new THREE.Vector2(z, y)), []);
      for (const [a, b, c] of t2) {
        const P = [poly[a]!, poly[b]!, poly[c]!].map(([z, y]) => [sx * (half(y) + 0.002), y, z]);
        if (sx > 0) k.tri(P[0]!, P[2]!, P[1]!, glass); else k.tri(P[0]!, P[1]!, P[2]!, glass);
      }
      // the B-pillar
      const zp = (zf + zb) / 2 - 0.1, yt = belt + 0.42;
      k.poly4([sx * (half(belt) + 0.004), belt, zp + 0.06], [sx * (half(belt) + 0.004), belt, zp - 0.06], [sx * (half(yt) + 0.004), yt, zp - 0.06], [sx * (half(yt) + 0.004), yt, zp + 0.06], dark);
    }
    // a dark rocker panel and wheel arches
    k.poly4([sx * (W / 2 + 0.003), 0.28, 2.0], [sx * (W / 2 + 0.003), 0.28, -2.0], [sx * (W / 2 + 0.003), 0.4, -2.0], [sx * (W / 2 + 0.003), 0.4, 2.0], dark);
    // a side mirror
    k.quad(sx * (W / 2 + 0.06), belt + 0.08, (prof[3]?.[0] ?? 1) - 0.15, 0.18, 0.12, paint, Math.PI / 2);
  };
  side(1); side(-1);
  // wheels: tyres and hubs
  const wz = type === 3 ? 1.75 : 1.42, wr = type === 1 ? 0.37 : 0.33;
  for (const zz of [wz, -wz]) for (const sx of [-1, 1]) {
    // a tyre: a dark octagon on the outside, the hub's lighter centre
    const ox = sx * (W / 2 + 0.004), oc = [0.015, 0.015, 0.016, M.ALB];
    for (let a = 0; a < 8; a += 2) {
      const p0 = (a * Math.PI) / 4, p1 = ((a + 1) * Math.PI) / 4, p2 = ((a + 2) * Math.PI) / 4;
      const P = (ph: number) => [ox, wr + Math.sin(ph) * wr, zz + Math.cos(ph) * wr];
      if (sx > 0) k.poly4([ox, wr, zz], P(p0), P(p1), P(p2), oc); else k.poly4([ox, wr, zz], P(p2), P(p1), P(p0), oc);
    }
    k.quad(sx * (W / 2 + 0.008), wr, zz, wr * 0.9, wr * 0.9, [0.2, 0.2, 0.21, M.ALB], sx * Math.PI / 2);
  }
  // lights (the instance's k lights them; parked cars 0), the grille, the plates
  const fz = prof[0]![0] + 0.035, bz = prof[prof.length - 1]![0] - 0.035;
  const ly = type === 1 ? 0.88 : type === 3 ? 0.9 : 0.68;
  for (const x of [-1, 1]) {
    k.quad(x * (W / 2 - 0.3), ly, fz + 0.02, 0.36, 0.12, [1.0, 0.92, 0.8, M.LIGHT]);
    k.quad(x * (W / 2 - 0.22), ly + 0.1, bz - 0.02, 0.3, 0.14, [1.0, 0.04, 0.02, M.LIGHT], Math.PI);
  }
  k.quad(0, ly - 0.02, fz + 0.015, W * 0.42, 0.16, dark);
  k.quad(0, 0.5, fz + 0.02, 0.34, 0.12, [0.5, 0.5, 0.48, M.ALB]);
  k.quad(0, 0.62, bz - 0.02, 0.34, 0.15, [0.55, 0.52, 0.45, M.ALB], Math.PI);
  if (type === 2) {
    // the taxi's roof sign (lit when it's free)
    k.box(0, 1.55, -0.3, 0.8, 0.22, 0.26, [1.0, 0.85, 0.5, M.LIGHT]);
  }
  return k.geometry();
}

/** A traffic-signal pole with a mast arm over the avenue (+x), heads for the avenue (facing -z) and the street (facing -x). */
function signalGeometry() {
  const k = new KitBuilder(), pole = [0.1, 0.1, 0.09, M.ALB], head = [0.03, 0.03, 0.025, M.ALB];
  k.cyl(0, 3.3, 0, 0.09, 0.12, 6.6, 6, pole, true);
  k.box(4.0, 6.3, 0, 8.0, 0.14, 0.14, pole);
  k.box(7.6, 5.55, 0, 0.36, 1.15, 0.3, head);
  k.box(-0.25, 3.2, 0, 0.3, 1.15, 0.36, head);
  k.box(0, 2.6, -0.2, 0.32, 0.32, 0.2, head);
  // lenses: aV = (lens 0 red / 0.5 yellow / 1 green, phase 0 avenue / 1 street / 0.5 walk, -, SIGNAL)
  [[0, 5.9], [0.5, 5.55], [1, 5.2]].forEach(([l, y]) => k.quad(7.6, y!, -0.16, 0.24, 0.24, [l!, 0, 0, M.SIGNAL], Math.PI));
  [[0, 3.55], [0.5, 3.2], [1, 2.85]].forEach(([l, y]) => k.quad(-0.41, y!, 0, 0.24, 0.24, [l!, 1, 0, M.SIGNAL], -Math.PI / 2));
  k.quad(0, 2.6, -0.31, 0.24, 0.24, [0, 0.5, 0, M.SIGNAL], Math.PI);
  return k.geometry();
}

function treeGeometry(variant: number) {
  const k = new KitBuilder();
  const bark = [0.06, 0.05, 0.04, M.ALB];
  k.cyl(0, 1.75, 0, 0.08, 0.15, 3.5, 6, bark, true);
  // a few limbs into the crown
  const rr = (i: number) => { const x = Math.sin(i * 12.9898 + variant * 78.233) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rr(i) * 0.8;
    k.cyl(Math.cos(a) * 0.45, 4.0 + rr(i + 9) * 0.6, Math.sin(a) * 0.45, 0.03, 0.06, 1.6, 4, bark, true, Math.sin(a) * 0.7, -Math.cos(a) * 0.7);
  }
  // the crown: clusters of leaves, each two crossed cards (alpha-tested in the shader)
  const N = 22;
  for (let i = 0; i < N; i++) {
    const u = rr(i * 3 + 1), v = rr(i * 3 + 2), w = rr(i * 3 + 3);
    const th = u * Math.PI * 2, ph = Math.acos(1 - 2 * v) * 0.9;
    const R = 0.55 + 0.45 * Math.cbrt(w);
    const x = Math.sin(ph) * Math.cos(th) * 2.0 * R, y = 5.0 + Math.cos(ph) * 1.35 * R, z = Math.sin(ph) * Math.sin(th) * 2.0 * R;
    const sz = 1.5 + rr(i + 50) * 0.9, yaw = rr(i + 70) * Math.PI;
    const g = 0.75 + rr(i + 90) * 0.5;
    const col = [0.028 * g, 0.055 * g, 0.022 * g, M.CARD];
    k.quad(x, y, z, sz, sz * 0.85, col, yaw, (rr(i + 30) - 0.5) * 0.8);
    k.quad(x, y, z, sz, sz * 0.85, col, yaw + Math.PI / 2, (rr(i + 40) - 0.5) * 0.8);
  }
  // the tree pit, its low steel guard
  k.quad(0, 0.012, 0, 1.4, 1.4, [0.03, 0.025, 0.02, M.ALB], 0, -Math.PI / 2);
  for (const r of [0, 1, 2, 3]) k.quad(Math.sin((r * Math.PI) / 2) * 0.7, 0.22, Math.cos((r * Math.PI) / 2) * 0.7, 1.4, 0.42, [0.05, 0.05, 0.055, M.BARS], (r * Math.PI) / 2);
  return k.geometry();
}

/** Props: 0 hydrant, 2 trash can (+ bags), 3 mailbox, 4 newspaper boxes, 5 kiosk, 6 bus shelter, 7 subway stairs, 8 bike rack. */
function propGeometry(kind: number) {
  const k = new KitBuilder();
  if (kind === 0) {
    k.cyl(0, 0.38, 0, 0.13, 0.15, 0.76, 7, [1, 1, 1, M.TINT]);
    k.sphere(0, 0.78, 0, 0.15, [1, 1, 1, M.TINT], 1, 0.7, 1, 0);
    k.cyl(0, 0.5, 0, 0.06, 0.06, 0.44, 5, [1, 1, 1, M.TINT], false, 0, Math.PI / 2);
  } else if (kind === 2) {
    k.cyl(0, 0.45, 0, 0.32, 0.27, 0.9, 7, [0.06, 0.12, 0.07, M.BARS], true);
    k.cyl(0, 0.04, 0, 0.27, 0.27, 0.06, 7, [0.06, 0.12, 0.07, M.ALB]);
    k.sphere(0.55, 0.3, 0.1, 0.38, [0.012, 0.012, 0.014, M.GLASS], 1, 0.8, 1, 1, 0.25);
    k.sphere(0.9, 0.25, -0.25, 0.3, [0.012, 0.012, 0.014, M.GLASS], 1, 0.85, 1, 1, 0.25);
    k.sphere(0.72, 0.62, -0.05, 0.22, [0.3, 0.3, 0.32, M.GLASS], 1, 0.9, 1, 1, 0.3);
  } else if (kind === 3) {
    k.box(0, 0.55, 0, 0.48, 1.1, 0.5, [0.04, 0.12, 0.35, M.ALB]);
    k.cyl(0, 1.1, 0, 0.25, 0.25, 0.48, 8, [0.04, 0.12, 0.35, M.ALB], false, 0, Math.PI / 2);
  } else if (kind === 4) {
    const cols = [[0.55, 0.05, 0.04], [0.05, 0.2, 0.5], [0.6, 0.55, 0.1]];
    cols.forEach((c, i) => k.box((i - 1) * 0.5, 0.55, 0, 0.45, 1.1, 0.45, [...c, M.ALB]));
  } else if (kind === 5) {
    k.box(0, 1.45, 0, 0.9, 2.9, 0.3, [0.12, 0.12, 0.13, M.ALB]);
    k.quad(0, 1.7, 0.155, 0.7, 1.6, [0.5, 0.7, 1.0, M.LAMP]);
    k.quad(0, 1.7, -0.155, 0.7, 1.6, [0.9, 0.6, 0.5, M.LAMP], Math.PI);
  } else if (kind === 6) {
    k.box(0, 2.45, 0, 4.2, 0.1, 1.6, [0.2, 0.2, 0.21, M.ALB]);
    for (const x of [-2, 2]) k.box(x, 1.2, -0.7, 0.08, 2.4, 0.08, [0.2, 0.2, 0.21, M.ALB]);
    k.quad(0, 1.25, -0.75, 4.0, 2.2, [0.02, 0.025, 0.03, M.GLASS]);
    k.quad(2.05, 1.25, 0, 1.4, 2.2, [0.85, 0.75, 0.9, M.LAMP], Math.PI / 2);
    k.box(0, 0.5, -0.5, 3.0, 0.08, 0.4, [0.2, 0.2, 0.21, M.ALB]);
  } else if (kind === 7) {
    // subway stairs: railings round an opening, two green globes
    const rail = [0.1, 0.12, 0.1, M.ALB];
    k.box(-0.9, 0.5, 0, 0.08, 1.0, 4.0, rail).box(0.9, 0.5, 0, 0.08, 1.0, 4.0, rail).box(0, 0.5, -2.0, 1.8, 1.0, 0.08, rail);
    k.quad(0, 0.02, 0, 1.75, 3.9, [0.005, 0.005, 0.006, M.ALB], 0, -Math.PI / 2);
    for (const x of [-0.9, 0.9]) { k.cyl(x, 1.6, 2.0, 0.04, 0.05, 1.2, 5, rail); k.sphere(x, 2.35, 2.0, 0.2, [0.25, 1.0, 0.45, M.LAMP], 1, 1, 1, 1); }
  } else if (kind === 8) {
    for (let i = 0; i < 4; i++) {
      k.box(i * 0.9 - 1.35, 0.42, 0, 0.05, 0.84, 0.05, [0.2, 0.2, 0.2, M.ALB]);
      k.box(i * 0.9 - 1.35, 0.55, 0.3, 0.06, 0.6, 1.7, [0.08, 0.2, 0.55, M.ALB]);
    }
  }
  return k.geometry();
}

/** A sidewalk shed: unit length along x, out from the facade along +z; green panels, posts, lights underneath. */
function shedGeometry() {
  const k = new KitBuilder(), green = [0.05, 0.13, 0.08, M.ALB], steel = [0.12, 0.13, 0.12, M.ALB];
  k.box(0, 3.15, 1.2, 1, 0.14, 2.45, green);
  k.quad(0, 3.5, 2.43, 1, 0.75, green);
  k.box(0, 3.85, 1.2, 1, 0.05, 2.45, [0.09, 0.09, 0.1, M.ALB]);
  for (const x of [-0.5, 0]) { k.box(x, 1.55, 2.3, 0.025, 3.1, 0.08, steel); k.box(x, 1.55, 0.15, 0.025, 3.1, 0.08, steel); }
  k.quad(0, 3.07, 1.2, 0.9, 0.12, [0.85, 0.92, 1.0, M.LAMP], 0, Math.PI / 2);
  return k.geometry();
}

function stackGeometry() {
  const k = new KitBuilder();
  k.cyl(0, 1.2, 0, 0.32, 0.36, 2.4, 8, [1.0, 0.35, 0.05, M.STRIPES], true);
  k.cyl(0, 0.05, 0, 0.5, 0.5, 0.1, 8, [0.9, 0.85, 0.8, M.ALB]);
  return k.geometry();
}

// ---------------------------------------------------------------- traffic

interface CarBuf { mesh: THREE.Mesh; iPos: THREE.InstancedBufferAttribute; iCol: THREE.InstancedBufferAttribute }

/** A moving car: L = (kind 0 avenue / 1 street / 2 highway, lane coordinate, direction, s0 | queue x), S = (slot k, copy, offsets | highway params). */
export interface MovingCar { L: number[]; S: number[]; col: number[]; type: number }

/** Where a car is at time t (avenues: the green wave; streets: queues at the lights; the highway), its heading, brakes. */
export function carPose(c: MovingCar, t: number, z0: number, loop: number, pitch: number, out: { x: number; y: number; z: number; dx: number; dz: number; brake: number; vis: boolean }) {
  const L = c.L, S = c.S;
  out.brake = 0; out.vis = true; out.y = 0;
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  if (L[0]! > 1.5) {
    const s = mod(L[3]! + S[0]! * t, S[3]!);
    out.dx = 0; out.dz = L[2]!; out.x = L[1]!; out.y = S[1]!; out.z = L[2]! > 0 ? S[2]! + s : S[2]! + S[3]! - s;
    return out;
  }
  if (L[0]! < 0.5) {
    const s = mod(L[3]! + SIG.V_WAVE * t, loop);
    out.dx = 0; out.dz = L[2]!; out.x = L[1]!; out.z = L[2]! > 0 ? z0 + s : z0 + loop - s;
    return out;
  }
  const P = SIG.P, k = S[0]!, g0 = S[2]! + 21 + k * 1.6;
  const n = Math.floor((t - g0) / P) - S[1]!;
  const td = g0 + n * P, tau = t - td;
  const v = 10, Ta = 3.5, Tb = 4, D = pitch, T = D / v + 0.5 * (Ta + Tb);
  const s = tau < Ta ? (0.5 * v * tau * tau) / Ta : tau < T - Tb ? v * (tau - 0.5 * Ta) : tau < T ? D - (0.5 * v * (T - tau) * (T - tau)) / Tb : D;
  const gn = S[3]! + 21 + k * 1.6;
  const tnext = gn + Math.ceil((td + T - gn) / P) * P;
  out.vis = t <= tnext;
  const sm = Math.min(1, Math.max(0, tau / 0.6));
  out.brake = Math.max(tau >= T - Tb ? 1 : 0, 1 - sm * sm * (3 - 2 * sm));
  out.dx = L[2]!; out.dz = 0; out.x = L[3]! + L[2]! * s; out.z = L[1]!;
  return out;
}

function carMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 aV; attribute vec3 aL;
      attribute vec4 iPos; attribute vec4 iCol; // x, y, z, heading; rgb, brake
      varying vec3 vW, vN, vLight, vL; varying vec4 vV, vCol; varying vec2 vFk; varying float vP;
      ${CITY_GLSL}
      void main() {
        vec2 dir = vec2(sin(iPos.w), cos(iPos.w));
        vec3 lp = position;
        vec3 rp = vec3(dir.y * lp.x + dir.x * lp.z, lp.y, -dir.x * lp.x + dir.y * lp.z);
        vec3 n = vec3(dir.y * normal.x + dir.x * normal.z, normal.y, -dir.x * normal.x + dir.y * normal.z);
        vec4 w = modelMatrix * vec4(rp + iPos.xyz, 1.0);
        vW = w.xyz; vN = n; vV = aV; vCol = iCol; vL = aL;
        vP = power(w.xz);
        vLight = ambient(n) * 1.3 + streetLight(w.xz, w.y, vP) + sunLow(w.xyz, n) + peopleGlow(w.xyz, n);
        vFk = fogK(w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW, vN, vLight, vL; varying vec4 vV, vCol; varying vec2 vFk; varying float vP;
      ${CITY_GLSL}
      ${CAR_PAINT_GLSL}
      void main() {
        float mode = vV.a;
        vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
        vec3 alb = mode < 0.5 || mode > 13.5 ? vCol.rgb : vV.rgb;
        vec3 c = alb * vLight;
        if (mode > 13.5) { c = carPaint(c, alb, vL, vN, vW, vLight); gl_FragColor = vec4(applyFog(c, vFk, vP), 1.0); return; }
        // paint: the sky and the street light in it; glass; head- and taillights (brighter on the brakes)
        float fres = pow(1.0 - clamp(abs(dot(V, N)), 0.0, 1.0), 3.0);
        c += (skyRefl(reflect(V, N)) * 0.25 + vLight * 0.15) * fres * step(mode, 0.5);
        if (mode > 2.5 && mode < 3.5) c = alb * vLight * 0.4 + skyRefl(reflect(V, N)) * (0.15 + 0.6 * fres);
        float tail = step(vV.g, 0.2) * step(0.5, vV.r);
        if (mode > 3.5 && mode < 4.5) c = vV.rgb * (tail > 0.5 ? 1.2 + 2.5 * vCol.a : 3.0);
        gl_FragColor = vec4(applyFog(c, vFk, vP), 1.0);
      }`,
  });
}

/** Head- and taillights as glowing points (they bloom and reflect in the wet streets). Positions from the CPU. */
function carLightMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...(U as unknown as Record<string, THREE.IUniform>), pxScale: { value: (1080 * SCALE) / 2 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aL; // heading x, heading z, head (1) / tail (0), brake
      uniform float pxScale;
      varying vec3 vC;
      ${CITY_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * w;
        float d = -mv.z;
        vec3 fwd = vec3(aL.x, 0.0, aL.y);
        vec3 toCam = normalize(cameraPosition - w.xyz);
        // a headlight shines forward, a taillight back: brightest seen from in front / behind
        float facing = aL.z > 0.5 ? dot(fwd, toCam) : -dot(fwd, toCam);
        float k = aL.z > 0.5 ? 1.6 : 0.5 + 1.4 * aL.w;
        vec3 c = aL.z > 0.5 ? vec3(1.0, 0.9, 0.75) : vec3(1.0, 0.05, 0.02);
        vC = c * k * (0.25 + 0.75 * smoothstep(-0.2, 0.6, facing));
        vec2 fk = fogK(w.xyz);
        vC *= fk.y * (1.0 - 0.7 * fk.x);
        float px = 0.35 * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
        float m = clamp(px, 1.5, 60.0);
        // (far away a car is still a visible spark: streams of headlights along the avenues)
        vC *= max(min(1.0, (px * px) / (m * m)), 0.3) * smoothstep(0.5, 2.0, d);
        gl_PointSize = m;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vC * (exp(-r2 * 4.0) + 0.6 * exp(-r2 * 24.0)), 1.0);
      }`,
  });
}

/** Signal lenses' glow: one point per head at its lit lens (state from the clock, the power). */
function signalGlowMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...(U as unknown as Record<string, THREE.IUniform>), pxScale: { value: (1080 * SCALE) / 2 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aSig; // offset, phase (0 avenue, 1 street), head yaw, -
      uniform float pxScale;
      varying vec3 vC;
      ${CITY_GLSL}
      void main() {
        float ph = mod(uTime - aSig.x, ${SIG.P.toFixed(1)});
        float st = aSig.y < 0.5 ? (ph < 16.0 ? 2.0 : ph < 19.0 ? 1.0 : 0.0) : (ph >= 20.0 && ph < 27.0 ? 2.0 : ph >= 27.0 && ph < 29.0 ? 1.0 : 0.0);
        vec3 c = st > 1.5 ? vec3(0.15, 1.0, 0.55) : st > 0.5 ? vec3(1.0, 0.55, 0.05) : vec3(1.0, 0.07, 0.03);
        float p = power(position.xz);
        float on = step(0.12 + 0.3 * fract(aSig.x * 0.37), p);
        vec3 wp = position + vec3(0.0, (1.0 - st) * 0.35, 0.0);
        vec4 mv = viewMatrix * modelMatrix * vec4(wp, 1.0);
        float d = -mv.z;
        // seen from the front only (the heads face the oncoming traffic)
        vec3 face = vec3(sin(aSig.z), 0.0, cos(aSig.z));
        float fr = smoothstep(-0.1, 0.4, dot(face, normalize(cameraPosition - wp)));
        vec2 fk = fogK(wp);
        vC = c * 1.6 * on * fr * fk.y * (1.0 - 0.7 * fk.x);
        float px = 0.5 * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
        float m = clamp(px, 1.5, 70.0);
        vC *= min(1.0, (px * px) / (m * m));
        gl_PointSize = m;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC;
      void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * (exp(-r2 * 4.0) + 0.6 * exp(-r2 * 24.0)), 1.0); }`,
  });
}

/** Steam rising from manholes and stacks, lit by the street. */
function steamMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { ...(U as unknown as Record<string, THREE.IUniform>), pxScale: { value: (1080 * SCALE) / 2 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 aSt; // seed, particle phase, stack, -
      uniform float pxScale;
      varying vec3 vC; varying float vA;
      ${CITY_GLSL}
      void main() {
        float rate = 0.16 + 0.06 * fract(aSt.x * 3.1);
        float age = fract(uTime * rate + aSt.y);
        float sw = aSt.x * 40.0 + aSt.y * 13.0;
        vec3 wind = vec3(1.2, 0.0, 0.5) * age * age * 3.0;
        vec3 wp = position + vec3(sin(sw + uTime * 0.7) * 0.6 * age, (aSt.z > 0.5 ? 2.4 : 0.1) + age * (5.5 + 3.0 * fract(aSt.x * 7.0)), cos(sw * 1.3 + uTime * 0.5) * 0.6 * age) + wind;
        vec4 mv = viewMatrix * modelMatrix * vec4(wp, 1.0);
        float d = -mv.z;
        float p = power(position.xz);
        vec3 L = streetLight(wp.xz, wp.y, p) * 0.5 + uMoonCol * 1.5 + uHazeCol * uGlowK * 0.5 + peopleGlow(wp, vec3(0.0, 1.0, 0.0)) * 0.4;
        vec2 fk = fogK(wp);
        vA = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.45, 1.0, age));
        vC = L * 0.32 * vA * fk.y * (1.0 - 0.6 * fk.x);
        float size = 0.9 + 3.5 * age;
        float px = size * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
        float m = clamp(px, 1.0, 300.0);
        vC *= min(1.0, (px * px) / (m * m)) * smoothstep(0.5, 3.0, d);
        gl_PointSize = m;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vC; varying float vA;
      void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * exp(-r2 * 2.5) * (1.0 - r2), 1.0); }`,
  });
}

// ---------------------------------------------------------------- the street life

export class CityLife extends THREE.Group {
  /** objects that are not drawn into the wet-street reflection */
  mirrorHide: THREE.Object3D[] = [];
  atlas: SignAtlas;
  lods: THREE.Object3D[] = [];
  /** moving cars (see carPose), drawn as meshes within `carDist` of the camera, their lights everywhere */
  cars: MovingCar[] = [];
  carDist = 520;
  private carMeshes: { type: number; list: MovingCar[]; near: CarBuf; far: CarBuf }[] = [];
  /** moving cars closer than this get the detailed body */
  carDetail = 110;
  /** parked cars closer than this (m) get the detailed body */
  parkedNearR: THREE.IUniform<number> = { value: 90 };
  private parkedGrid = new Map<string, { x: number; z: number; yaw: number; type: number; col: [number, number, number] }[]>();
  private parkedNear: { type: number; mesh: THREE.Mesh; iPos: THREE.InstancedBufferAttribute; iCol: THREE.InstancedBufferAttribute; max: number }[] = [];
  private lights!: THREE.Points;
  private lightPos!: THREE.BufferAttribute;
  private lightL!: THREE.BufferAttribute;
  private traffic = { z0: 0, loop: 1, pitch: 250 };
  private pose = { x: 0, y: 0, z: 0, dx: 0, dz: 1, brake: 0, vis: true };

  constructor(private city: City, o: CityOpts) {
    super();
    const plan = city.plan, g = city.grid, U = city.U;
    const r = mulberry32((o.seed ?? 3) * 977 + 5);
    const lod = o.lod ?? 1;
    // ---- the sign atlas ----
    const bands = [...new Set(plan.shops.map((s) => s.sign).filter(Boolean)), 'FOR RENT'];
    const neons = [...new Set(plan.shops.map((s) => s.neon).filter(Boolean))];
    this.atlas = signAtlas({ band: bands, neon: neons, blade: [] });
    // ---- storefronts: near (rooms, signs) and mid (lit strips) ----
    const shopNear = shopMaterial(U, this.atlas, true), shopFar = shopMaterial(U, this.atlas, false);
    const shopTiles = new TileSet<number>(125, 120);
    plan.shops.forEach((s, i) => shopTiles.add('s', s.x, s.z, i));
    const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    for (const t of shopTiles.map.values()) {
      const list = t.lists.get('s')!;
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = quad.index; geo.setAttribute('position', quad.attributes.position!);
      const n = list.length, iPos = new Float32Array(n * 4), iSize = new Float32Array(n * 4), iSign = new Float32Array(n * 4);
      list.forEach((si, k) => {
        const s = plan.shops[si]!;
        iPos.set([s.x - t.origin.x, 0.15, s.z - t.origin.z, Math.atan2(s.nx, s.nz)], k * 4);
        iSize.set([s.w, Math.max(2.4, s.h - 0.15), s.kind, s.seed], k * 4);
        const bandCell = s.kind === SHOP.VACANT ? this.atlas.cell('FOR RENT', 'band') : this.atlas.cell(s.sign, 'band');
        iSign.set([bandCell, s.kind === SHOP.VACANT ? -1 : this.atlas.cell(s.neon, 'neon'), Math.floor(s.seed * 97) % 8, s.lit ? 1 : 0], k * 4);
      });
      geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 4));
      geo.setAttribute('iSize', new THREE.InstancedBufferAttribute(iSize, 4));
      geo.setAttribute('iSign', new THREE.InstancedBufferAttribute(iSign, 4));
      geo.instanceCount = n;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 3, 0), 110);
      const l = new THREE.LOD();
      l.position.copy(t.origin);
      l.addLevel(new THREE.Mesh(geo, shopNear), 0);
      l.addLevel(new THREE.Mesh(geo, shopFar), 160 * lod);
      l.addLevel(new THREE.Object3D(), 1600 * lod);
      this.add(l);
    }
    // ---- small things in near tiles ----
    const near = new TileSet<KInst>(250, 240), mid = new TileSet<KInst>(500, 480);
    for (const s of plan.shops) {
      if (s.awning < 0 || s.kind === SHOP.LOBBY && s.awning !== 100) continue;
      const lobby = s.awning === 100;
      const col = lobby ? [0.06, 0.06, 0.07] as [number, number, number] : AWNINGS[s.awning % AWNINGS.length]!;
      near.add('awning', s.x, s.z, { x: s.x + s.nx * 0.05, y: s.h - (lobby ? 0.3 : 0.7), z: s.z + s.nz * 0.05, yaw: Math.atan2(s.nx, s.nz), sx: s.w - 0.4, sy: lobby ? 1 : 1, sz: lobby ? 3.6 : 1, col, k: s.seed < 0.4 ? 0.75 : 0.25 });
    }
    for (const p of plan.parked) {
      const type = p.type === 1 ? 1 : p.type === 3 ? 3 : 0;
      near.add('car' + type, p.x, p.z, { x: p.x, y: 0, z: p.z, yaw: Math.atan2(p.dx, p.dz), sx: 1, sy: 1, sz: 1, col: CAR_COLORS[p.color % CAR_COLORS.length]!, k: 0 });
    }
    for (const t of plan.trees) near.add('tree' + Math.floor(t.seed * 3), t.x, t.z, { x: t.x, y: 0.15, z: t.z, yaw: t.seed * 6.28, sx: t.s, sy: t.s * (0.9 + 0.2 * t.seed), sz: t.s, col: [1, 1, 1], k: 0, x4: [0, t.s, t.seed * 10, 0] });
    for (const p of plan.props) {
      const col: [number, number, number] = p.kind === 0 ? (p.seed < 0.5 ? [0.45, 0.06, 0.04] : p.seed < 0.8 ? [0.5, 0.45, 0.08] : [0.35, 0.36, 0.38]) : [1, 1, 1];
      near.add('prop' + p.kind, p.x, p.z, { x: p.x, y: 0.15, z: p.z, yaw: p.rot, sx: 1, sy: 1, sz: 1, col, k: 0.5 + p.seed * 0.49 });
    }
    for (const s of plan.signals) {
      const off = ((g.avDir(s.i) * s.iz) / SIG.V_WAVE % SIG.P + SIG.P) % SIG.P;
      near.add('signal', s.x, s.z, { x: s.x, y: 0.15, z: s.z, yaw: s.corner ? Math.PI : 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.5 + fract(off * 0.37) * 0.49, x4: [off, 0, 0, 0] });
    }
    for (const s of plan.steam) if (s.stack) near.add('stack', s.x, s.z, { x: s.x, y: 0, z: s.z, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0 });
    for (const sh of plan.sheds) near.add('shed', sh.x, sh.z, { x: sh.x, y: 0.15, z: sh.z, yaw: Math.atan2(sh.nx, sh.nz), sx: sh.w, sy: 1, sz: 1, col: [1, 1, 1], k: 0.5 + sh.seed * 0.49 });
    const kitM = kitMaterial(U), kitM2 = kitMaterial(U, { side: THREE.DoubleSide });
    const geos: Record<string, THREE.BufferGeometry> = {
      awning: awningGeometry(), shed: shedGeometry(), car0: carGeometry(0), car1: carGeometry(1), car3: carGeometry(3), tree0: treeGeometry(0), tree1: treeGeometry(1), tree2: treeGeometry(2), signal: signalGeometry(), stack: stackGeometry(),
    };
    for (const k of [0, 2, 3, 4, 5, 6, 7, 8]) geos['prop' + k] = propGeometry(k);
    const dists: Record<string, number> = { awning: 520, tree: 520, signal: 650 };
    const detail: Record<string, THREE.BufferGeometry> = { car0: carDetailGeometry(0), car1: carDetailGeometry(1), car3: carDetailGeometry(3) };
    const kitCull = kitMaterial(U, { side: THREE.DoubleSide, cullNear: this.parkedNearR });
    // the detailed parked cars near the camera: a grid to find them, a dynamic batch per type
    for (const p of plan.parked) {
      const type = p.type === 1 ? 1 : p.type === 3 ? 3 : 0;
      const key = `${Math.floor(p.x / 50)},${Math.floor(p.z / 50)}`;
      let cell = this.parkedGrid.get(key);
      if (!cell) this.parkedGrid.set(key, (cell = []));
      cell.push({ x: p.x, z: p.z, yaw: Math.atan2(p.dx, p.dz), type, col: CAR_COLORS[p.color % CAR_COLORS.length]! });
    }
    for (const type of [0, 1, 3]) {
      const max = 600, base = detail['car' + type]!;
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      for (const k of ['position', 'normal', 'aV', 'aL']) geo.setAttribute(k, base.attributes[k]!);
      const iPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
      const iCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iPos', iPos); geo.setAttribute('iCol', iCol);
      geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3));
      geo.setAttribute('iX', new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4));
      geo.instanceCount = 0;
      const m = new THREE.Mesh(geo, kitM2);
      m.frustumCulled = false;
      this.add(m);
      this.mirrorHide.push(m);
      this.parkedNear.push({ type, mesh: m, iPos, iCol, max });
    }
    const make = (kind: string, list: KInst[], origin: THREE.Vector3) => {
      const geo = geos[kind];
      if (!geo) return null;
      // parked cars: the cheap body here (hidden close to the camera, where update() draws the detailed one)
      if (detail[kind]) return kitBatch(geo, list, kitCull, origin, 6);
      return kitBatch(geo, list, kind === 'awning' || kind === 'shed' || kind.startsWith('tree') || kind.startsWith('prop') || kind.startsWith('car') ? kitM2 : kitM, origin, kind === 'signal' ? 8 : 6);
    };
    near.build(this, 430 * lod, make, this.lods);
    void mid; void dists;

    // ---- laundry lines and wires (catenaries), the clothes on them, pigeons, moths round the lamps ----
    {
      const LP: number[] = [], seg = 10;
      for (const ln of plan.lines) {
        const P = (t: number) => [ln.a[0] + (ln.b[0] - ln.a[0]) * t, ln.a[1] + (ln.b[1] - ln.a[1]) * t - ln.sag * 4 * t * (1 - t), ln.a[2] + (ln.b[2] - ln.a[2]) * t];
        for (let i = 0; i < seg; i++) LP.push(...P(i / seg), ...P((i + 1) / seg));
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(LP, 3));
      const lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({
        uniforms: U as unknown as Record<string, THREE.IUniform>,
        vertexShader: `varying vec3 vC; varying vec2 vFk; varying float vP;
          ${CITY_GLSL}
          void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = power(w.xz);
            vC = vec3(0.012) + streetLight(w.xz, w.y, vP) * 0.08 + uMoonCol * 0.3 + sunLit(vec3(0.0, 1.0, 0.0), 1.0) * 0.1; vFk = fogK(w.xyz);
            gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `varying vec3 vC; varying vec2 vFk; varying float vP;
          ${CITY_GLSL}
          void main() { gl_FragColor = vec4(applyFog(vC, vFk, vP), 1.0); }`,
      }));
      lines.frustumCulled = false;
      this.add(lines);
      this.mirrorHide.push(lines);
      // clothes pegged on the laundry lines
      const cl: KInst[] = [];
      const cols: [number, number, number][] = [[0.6, 0.6, 0.58], [0.5, 0.1, 0.08], [0.1, 0.2, 0.45], [0.55, 0.5, 0.2], [0.15, 0.35, 0.2], [0.6, 0.35, 0.45], [0.05, 0.05, 0.06], [0.45, 0.45, 0.5]];
      for (const ln of plan.lines) {
        if (ln.kind !== 0) continue;
        const n = 3 + Math.floor(fract(ln.seed * 7.7) * 9);
        for (let k = 0; k < n; k++) {
          const t = 0.08 + 0.84 * fract(ln.seed * 13.1 + k * 0.618);
          const x = ln.a[0] + (ln.b[0] - ln.a[0]) * t, y = ln.a[1] + (ln.b[1] - ln.a[1]) * t - ln.sag * 4 * t * (1 - t), z = ln.a[2] + (ln.b[2] - ln.a[2]) * t;
          const big = fract(ln.seed * 31.3 + k * 0.37);
          cl.push({ x, y, z, yaw: Math.PI / 2 + (fract(k * 0.77) - 0.5) * 0.3, sx: 0.35 + big * 0.6, sy: 0.4 + big * 0.5, sz: 1, col: cols[Math.floor(fract(ln.seed * 5.3 + k * 0.29) * 8)]!, k: 0 });
        }
      }
      const cloth = new KitBuilder().quad(0, -0.5, 0, 1, 1, [1, 1, 1, M.TINT]).geometry();
      const ct = new TileSet<KInst>(250, 240);
      for (const c of cl) ct.add('c', c.x, c.z, c);
      ct.build(this, 500 * lod, (_k, list, origin) => kitBatch(cloth, list, kitM2, origin, 2), this.lods);
      // pigeons on the wires
      const bt = new TileSet<KInst>(250, 240);
      for (const [x, y, z, yaw] of plan.birds) bt.add('b', x, z, { x, y, z, yaw, sx: 1, sy: 1, sz: 1, col: [0.06, 0.06, 0.07], k: 0 });
      const bird = new KitBuilder().box(0, 0.09, 0, 0.12, 0.13, 0.26, [1, 1, 1, M.TINT]).box(0, 0.2, 0.11, 0.07, 0.07, 0.08, [1, 1, 1, M.TINT]).box(0, 0.07, -0.17, 0.08, 0.03, 0.14, [1, 1, 1, M.TINT]).geometry();
      bt.build(this, 300 * lod, (_k, list, origin) => kitBatch(bird, list, kitM, origin, 1), this.lods);
      // moths round the street lamps
      const mp: number[] = [], ma: number[] = [];
      plan.lamps.forEach((l, i) => {
        if (l.kind === 3) return;
        const hx = l.kind === 0 ? l.x + l.ax * 1.95 : l.x, hz = l.kind === 0 ? l.z + l.az * 1.95 : l.z, hy = l.kind === 0 ? l.h * 0.94 : l.h;
        for (let k = 0; k < 3; k++) { mp.push(hx, hy - 0.4, hz); ma.push(fract(i * 0.37 + k * 0.29), 0.5 + fract(i * 0.71 + k * 0.53) * 1.4, k, 0); }
      });
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
      mg.setAttribute('aM', new THREE.Float32BufferAttribute(ma, 4));
      const moths = new THREE.Points(mg, new THREE.ShaderMaterial({
        uniforms: { ...(U as unknown as Record<string, THREE.IUniform>), pxScale: { value: (1080 * SCALE) / 2 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute vec4 aM; uniform float pxScale; varying vec3 vC;
          ${CITY_GLSL}
          void main() {
            float a = uTime * (2.0 + 3.0 * aM.x) + aM.x * 40.0, r = aM.y * (0.7 + 0.3 * sin(uTime * 1.7 + aM.z));
            vec3 wp = position + vec3(cos(a) * r, sin(uTime * 3.1 + aM.x * 20.0) * 0.35 - 0.2, sin(a * 1.3) * r);
            vec4 mv = viewMatrix * modelMatrix * vec4(wp, 1.0);
            float d = -mv.z, p = power(position.xz);
            vC = vec3(1.0, 0.8, 0.55) * 0.9 * step(0.3, p) * (1.0 - uDawn) * smoothstep(80.0, 20.0, d);
            float px = 0.05 * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
            float m = clamp(px, 1.0, 8.0);
            vC *= min(1.0, (px * px) / (m * m));
            gl_PointSize = m;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `varying vec3 vC; void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * exp(-r2 * 3.0), 1.0); }`,
      }));
      moths.frustumCulled = false;
      this.add(moths);
      this.mirrorHide.push(moths);
    }

    // ---- strings of bulbs over the roof terraces ----
    {
      const bp: number[] = [], ba: number[] = [];
      for (const s of plan.bulbs) {
        const len = Math.hypot(s.b[0] - s.a[0], s.b[2] - s.a[2]), n = Math.max(3, Math.round(len / 0.45));
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          bp.push(s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t - s.sag * 4 * t * (1 - t), s.a[2] + (s.b[2] - s.a[2]) * t);
          ba.push(s.seed, fract(i * 0.618 + s.seed * 3.1), 0, 0);
        }
      }
      if (bp.length) {
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
        bg.setAttribute('aB', new THREE.Float32BufferAttribute(ba, 4));
        const bulbs = new THREE.Points(bg, new THREE.ShaderMaterial({
          uniforms: { ...(U as unknown as Record<string, THREE.IUniform>), pxScale: { value: (1080 * SCALE) / 2 } },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
          vertexShader: `attribute vec4 aB; uniform float pxScale; varying vec3 vC;
            ${CITY_GLSL}
            void main() {
              vec4 w = modelMatrix * vec4(position, 1.0);
              vec4 mv = viewMatrix * w;
              float d = -mv.z, p = power(w.xz);
              float on = step(0.15 + 0.5 * aB.x, p) * (1.0 - uDawn * 0.9);
              vec3 c = mix(vec3(1.0, 0.72, 0.38), vec3(1.0, 0.85, 0.6), aB.y) * (0.9 + 0.25 * sin(uTime * 2.0 + aB.y * 30.0));
              vec2 fk = fogK(w.xyz);
              vC = c * 1.8 * on * fk.y * (1.0 - 0.7 * fk.x);
              float px = 0.07 * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
              float m = clamp(px, 1.2, 12.0);
              vC *= max(min(1.0, (px * px) / (m * m)), 0.25);
              gl_PointSize = m;
              gl_Position = projectionMatrix * mv;
            }`,
          fragmentShader: `varying vec3 vC; void main() { vec2 p = gl_PointCoord * 2.0 - 1.0; float r2 = dot(p, p); if (r2 > 1.0) discard; gl_FragColor = vec4(vC * (exp(-r2 * 4.0) + 0.5 * exp(-r2 * 20.0)), 1.0); }`,
        }));
        bulbs.frustumCulled = false;
        this.add(bulbs);
      }
    }

    // ---- moving traffic ----
    const [X0, Z0, X1, Z1] = plan.o.bounds;
    const zLoop = Z1 - Z0 + 1200, z0 = Z0 - 600;
    const traffic = o.traffic ?? 1;
    const cars: MovingCar[] = [];
    const riverX = plan.o.river ?? Infinity;
    const P = SIG.P, V = SIG.V_WAVE;
    for (let i = plan.iRange[0]; i <= plan.iRange[1]; i++) {
      const ax = g.avX(i);
      if (ax < X0 || ax > Math.min(X1, riverX - g.avHalf())) continue;
      const dir = g.avDir(i);
      for (const lane of [-3.2, 0, 3.2, 6.4]) {
        // platoons: cars only where the wave is green (phase 1..15 s of the 30 s cycle)
        for (let s0 = 0; s0 < zLoop; s0 += 6 + r() * 34) {
          const ph = (((-s0 / V) % P) + P) % P;
          if (ph < 1.5 || ph > 14.5 || r() > 0.55 * traffic) continue;
          const taxi = r() < 0.3;
          cars.push({ L: [0, ax + lane * dir, dir, s0], S: [0, 0, 0, 0], col: taxi ? TAXI : CAR_COLORS[Math.floor(r() * 16)]!, type: taxi ? 2 : r() < 0.25 ? 1 : r() < 0.05 ? 3 : 0 });
        }
      }
    }
    for (let j = plan.jRange[0]; j <= plan.jRange[1]; j++) {
      const sz = g.stZ(j);
      if (sz < Z0 || sz > Z1) continue;
      const wide = g.wide(j);
      const flows: [number, number][] = wide ? [[1, 1.6], [1, 4.9], [-1, -1.6], [-1, -4.9]] : [[g.stDir(j), g.stDir(j) * 1.4]];
      for (const [dir, lane] of flows) {
        const nq = Math.floor(r() * (wide ? 3.5 : 3.0) * traffic);
        if (!nq) continue;
        for (let i = plan.iRange[0]; i < plan.iRange[1]; i++) {
          // the queue before avenue `ia` (the one the cars cross first), driving to the next one
          const ia = dir > 0 ? i + 1 : i, ib = dir > 0 ? i + 2 : i - 1;
          const ax = g.avX(ia);
          if (ax < X0 || ax > Math.min(X1, riverX - g.avHalf()) || g.avX(ib) > riverX - g.avHalf() || g.avX(ib) < X0) continue;
          const off = (((g.avDir(ia) * sz) / V) % P + P) % P, offN = (((g.avDir(ib) * sz) / V) % P + P) % P;
          const xs = ax - dir * (g.avHalf() + 5.2);
          for (let k = 0; k < nq; k++) for (const c of [0, 1]) {
            const taxi = r() < 0.3;
            cars.push({ L: [1, sz + lane, dir, xs - dir * k * 6.6], S: [k, c, off, offN], col: taxi ? TAXI : CAR_COLORS[Math.floor(r() * 16)]!, type: taxi ? 2 : r() < 0.25 ? 1 : 0 });
          }
        }
      }
    }
    if (city.overpass) for (const c of overpassCars(city.overpass, r)) cars.push({ L: c.L, S: c.S, col: CAR_COLORS[Math.floor(r() * 16)]!, type: c.type });
    this.cars = cars;
    const carM = carMaterial(U);
    for (const type of [0, 1, 2, 3]) {
      const list = cars.filter((c) => c.type === type);
      if (!list.length) continue;
      const mk = (base: THREE.BufferGeometry) => {
        const geo = new THREE.InstancedBufferGeometry();
        geo.index = base.index;
        for (const k of ['position', 'normal', 'aV', 'aL']) geo.setAttribute(k, base.attributes[k]!);
        const iPos = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4).setUsage(THREE.DynamicDrawUsage);
        const iCol = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 4), 4).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('iPos', iPos); geo.setAttribute('iCol', iCol);
        geo.instanceCount = 0;
        const m = new THREE.Mesh(geo, carM);
        m.frustumCulled = false;
        this.add(m);
        this.mirrorHide.push(m);
        return { mesh: m, iPos, iCol };
      };
      this.carMeshes.push({ type, list, near: mk(carDetailGeometry(type)), far: mk(carGeometry(type)) });
    }
    // their lights: 4 points a car, written every frame
    const nl = cars.length * 4;
    const lg = new THREE.BufferGeometry();
    this.lightPos = new THREE.BufferAttribute(new Float32Array(nl * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.lightL = new THREE.BufferAttribute(new Float32Array(nl * 4), 4).setUsage(THREE.DynamicDrawUsage);
    lg.setAttribute('position', this.lightPos);
    lg.setAttribute('aL', this.lightL);
    this.lights = new THREE.Points(lg, carLightMaterial(U));
    this.lights.frustumCulled = false;
    this.add(this.lights);
    this.traffic = { z0, loop: zLoop, pitch: g.s.avPitch };

    // ---- signal glows: the avenue head on the arm, the street head on the pole ----
    const sp: number[] = [], sa: number[] = [];
    for (const s of plan.signals) {
      const off = ((g.avDir(s.i) * s.iz) / V % P + P) % P, rot = s.corner ? Math.PI : 0, c = Math.cos(rot), sn = Math.sin(rot);
      const at = (lx: number, ly: number, lz: number) => [s.x + c * lx + sn * lz, 0.15 + ly, s.z - sn * lx + c * lz];
      sp.push(...at(7.6, 5.2, -0.3)); sa.push(off, 0, rot + Math.PI, 0);
      sp.push(...at(-0.5, 2.85, 0)); sa.push(off, 1, rot - Math.PI / 2, 0);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    sg.setAttribute('aSig', new THREE.Float32BufferAttribute(sa, 4));
    const sigGlow = new THREE.Points(sg, signalGlowMaterial(U));
    sigGlow.frustumCulled = false;
    this.add(sigGlow);

    // ---- steam ----
    const st: number[] = [], sv: number[] = [];
    for (const s of plan.steam) for (let k = 0; k < 26; k++) { st.push(s.x + (r() - 0.5) * 0.6, 0.05, s.z + (r() - 0.5) * 0.6); sv.push(s.seed, k / 26 + r() * 0.02, s.stack ? 1 : 0, 0); }
    const stg = new THREE.BufferGeometry();
    stg.setAttribute('position', new THREE.Float32BufferAttribute(st, 3));
    stg.setAttribute('aSt', new THREE.Float32BufferAttribute(sv, 4));
    const steam = new THREE.Points(stg, steamMaterial(U));
    steam.frustumCulled = false;
    this.add(steam);
    this.mirrorHide.push(steam, ...this.lods);
  }

  flash(k: number, seed: number) { this.city.U.uFlash.value.set(k, seed); }
  /** Per frame: the cars' poses (meshes near the camera, lights everywhere). */
  update(t: number, cam: THREE.Vector3) {
    const tr = this.traffic, P = this.pose, o = this.city.U.uOrigin.value;
    const cx = cam.x - o.x, cz = cam.z - o.z, R2 = this.carDist * this.carDist;
    const lp = this.lightPos.array as Float32Array, ll = this.lightL.array as Float32Array;
    let nl = 0;
    const D2 = this.carDetail * this.carDetail;
    for (const cm of this.carMeshes) {
      const cnt = [0, 0];
      const Lz = cm.type === 3 ? 2.65 : 2.36, W = cm.type === 3 ? 0.7 : 0.62;
      for (const c of cm.list) {
        carPose(c, t, tr.z0, tr.loop, tr.pitch, P);
        if (!P.vis) continue;
        const d2 = (P.x - cx) ** 2 + (P.z - cz) ** 2;
        if (d2 < R2) {
          const which = d2 < D2 ? 0 : 1, buf = which ? cm.far : cm.near, n = cnt[which]!++;
          const ip = buf.iPos.array as Float32Array, ic = buf.iCol.array as Float32Array;
          ip[n * 4] = P.x; ip[n * 4 + 1] = P.y; ip[n * 4 + 2] = P.z; ip[n * 4 + 3] = Math.atan2(P.dx, P.dz);
          ic[n * 4] = c.col[0]!; ic[n * 4 + 1] = c.col[1]!; ic[n * 4 + 2] = c.col[2]!; ic[n * 4 + 3] = P.brake;
        }
        // lights: (x across, z along) in the car's frame
        for (const [lx, ly, lz, head] of [[-W, 0.72, Lz + 0.05, 1], [W, 0.72, Lz + 0.05, 1], [-W, 0.8, -Lz - 0.05, 0], [W, 0.8, -Lz - 0.05, 0]] as const) {
          lp[nl * 3] = P.x + P.dz * lx + P.dx * lz; lp[nl * 3 + 1] = P.y + ly; lp[nl * 3 + 2] = P.z - P.dx * lx + P.dz * lz;
          ll[nl * 4] = P.dx; ll[nl * 4 + 1] = P.dz; ll[nl * 4 + 2] = head; ll[nl * 4 + 3] = P.brake;
          nl++;
        }
      }
      [cm.near, cm.far].forEach((buf, i) => {
        const n = cnt[i]!;
        (buf.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
        buf.iPos.needsUpdate = buf.iCol.needsUpdate = true;
        buf.iPos.addUpdateRange(0, n * 4); buf.iCol.addUpdateRange(0, n * 4);
      });
    }
    this.lightPos.needsUpdate = this.lightL.needsUpdate = true;
    this.lights.geometry.setDrawRange(0, nl);
    // detailed parked cars round the camera (the cheap ones hide themselves within the same radius)
    const R = this.parkedNearR.value, cnt: Record<number, number> = { 0: 0, 1: 0, 3: 0 };
    const pn = Object.fromEntries(this.parkedNear.map((q) => [q.type, q]));
    for (let gx = Math.floor((cx - R) / 50); gx <= Math.floor((cx + R) / 50); gx++) for (let gz = Math.floor((cz - R) / 50); gz <= Math.floor((cz + R) / 50); gz++) {
      for (const c of this.parkedGrid.get(`${gx},${gz}`) ?? []) {
        if ((c.x - cx) ** 2 + (c.z - cz) ** 2 >= R * R) continue;
        const q = pn[c.type]!, n = cnt[c.type]!;
        if (n >= q.max) continue;
        (q.iPos.array as Float32Array).set([c.x, 0, c.z, c.yaw], n * 4);
        (q.iCol.array as Float32Array).set([c.col[0], c.col[1], c.col[2], 0], n * 4);
        cnt[c.type] = n + 1;
      }
    }
    for (const q of this.parkedNear) {
      const n = cnt[q.type]!;
      (q.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount = n;
      q.iPos.needsUpdate = q.iCol.needsUpdate = true;
      q.iPos.addUpdateRange(0, n * 4); q.iCol.addUpdateRange(0, n * 4);
    }
  }
}

const fract = (x: number) => x - Math.floor(x);
