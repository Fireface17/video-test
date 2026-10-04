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
import { KitBuilder, M, TileSet, kitBatch, kitMaterial, type KInst } from './city-build';
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
    k.cyl(sx * (W / 2 - 0.12), wr, zz, wr, wr, 0.24, 6, [0.015, 0.015, 0.016, M.ALB], true, 0, Math.PI / 2);
    k.quad(sx * (W / 2 + 0.005), wr, zz, wr * 1.1, wr * 1.1, [0.22, 0.22, 0.23, M.ALB], Math.PI / 2);
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

function treeGeometry() {
  const k = new KitBuilder();
  k.cyl(0, 1.7, 0, 0.09, 0.15, 3.4, 5, [0.06, 0.05, 0.04, M.ALB], true);
  k.cyl(0.35, 3.6, 0.1, 0.05, 0.08, 1.4, 4, [0.06, 0.05, 0.04, M.ALB], true, 0.2, -0.5);
  // a ragged crown of lumpy clumps (dark leaves; the street lamps light them from below)
  const blobs: [number, number, number, number][] = [[0, 4.9, 0, 1.75], [1.1, 5.4, 0.4, 1.25], [-1.0, 5.1, -0.5, 1.3], [0.2, 6.1, -0.3, 1.15], [-0.4, 4.3, 0.9, 1.05]];
  blobs.forEach(([x, y, z, r], i) => k.sphere(x, y, z, r, [0.03 + 0.01 * (i % 2), 0.05 + 0.012 * (i % 3), 0.022, M.LEAVES], 1.1, 0.85, 1.1, 0, 0.55));
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
    k.sphere(0.55, 0.32, 0.1, 0.38, [0.015, 0.015, 0.018, M.GLASS], 1, 0.85, 1, 0);
    k.sphere(0.9, 0.26, -0.25, 0.3, [0.015, 0.015, 0.018, M.GLASS], 1, 0.9, 1, 0);
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

function stackGeometry() {
  const k = new KitBuilder();
  k.cyl(0, 1.2, 0, 0.32, 0.36, 2.4, 8, [1.0, 0.35, 0.05, M.STRIPES], true);
  k.cyl(0, 0.05, 0, 0.5, 0.5, 0.1, 8, [0.9, 0.85, 0.8, M.ALB]);
  return k.geometry();
}

// ---------------------------------------------------------------- traffic

/** GLSL: where a car is at uTime (avenues: the green wave; streets: queues at the lights), its heading, its brakes. */
const TRAFFIC_GLSL = /* glsl */ `
  uniform float uZ0, uLoop, uPitch;
  const float SIG_P = ${SIG.P.toFixed(1)}, V_WAVE = ${SIG.V_WAVE.toFixed(1)};
  // L = (type 0 avenue / 1 street, lane coordinate, direction, s0 | queue x), S = (slot k, copy c, offset here, offset next)
  vec3 carPose(vec4 L, vec4 S, out vec2 dir, out float brake, out float vis) {
    brake = 0.0; vis = 1.0;
    if (L.x > 1.5) {
      // the highway: S = (speed, deck height, z0, length)
      float s = mod(L.w + S.x * uTime, S.w);
      dir = vec2(0.0, L.z);
      return vec3(L.y, S.y, L.z > 0.0 ? S.z + s : S.z + S.w - s);
    }
    if (L.x < 0.5) {
      float s = mod(L.w + V_WAVE * uTime, uLoop);
      dir = vec2(0.0, L.z);
      return vec3(L.y, 0.0, L.z > 0.0 ? uZ0 + s : uZ0 + uLoop - s);
    }
    float k = S.x, g0 = S.z + 21.0 + k * 1.6;
    float n = floor((uTime - g0) / SIG_P) - S.y;
    float td = g0 + n * SIG_P, tau = uTime - td;
    float v = 10.0, Ta = 3.5, Tb = 4.0, D = uPitch;
    float T = D / v + 0.5 * (Ta + Tb);
    float s = tau < Ta ? 0.5 * v * tau * tau / Ta : tau < T - Tb ? v * (tau - 0.5 * Ta) : tau < T ? D - 0.5 * v * (T - tau) * (T - tau) / Tb : D;
    float gn = S.w + 21.0 + k * 1.6;
    float tnext = gn + ceil((td + T - gn) / SIG_P) * SIG_P;
    vis = step(uTime, tnext);
    brake = max(step(T - Tb, tau), 1.0 - smoothstep(0.0, 0.6, tau));
    dir = vec2(L.z, 0.0);
    return vec3(L.w + L.z * s, 0.0, L.y);
  }
`;

function carMaterial(U: CityUniforms, tu: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { ...(U as unknown as Record<string, THREE.IUniform>), ...tu },
    vertexShader: /* glsl */ `
      attribute vec4 aV; attribute vec3 aL;
      attribute vec4 iLane; attribute vec4 iSeg; attribute vec4 iCol;
      varying vec3 vW, vN, vLight; varying vec4 vV, vCol; varying vec2 vFk; varying float vP, vBrake;
      ${CITY_GLSL}
      ${TRAFFIC_GLSL}
      void main() {
        vec2 dir; float brake, vis;
        vec3 o = carPose(iLane, iSeg, dir, brake, vis);
        vec3 lp = position;
        vec3 rp = vec3(dir.y * lp.x + dir.x * lp.z, lp.y, -dir.x * lp.x + dir.y * lp.z);
        vec3 n = vec3(dir.y * normal.x + dir.x * normal.z, normal.y, -dir.x * normal.x + dir.y * normal.z);
        vec4 w = modelMatrix * vec4(rp + o, 1.0);
        vW = w.xyz; vN = n; vV = aV; vCol = iCol; vBrake = brake;
        vP = power(w.xz);
        vLight = ambient(n) * 1.3 + streetLight(w.xz, w.y, vP) + sunLight(w.xyz, n) + peopleGlow(w.xyz, n);
        vFk = fogK(w.xyz);
        float far = step(900.0, length(w.xyz - cameraPosition));
        gl_Position = projectionMatrix * viewMatrix * w;
        if (vis < 0.5 || far > 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW, vN, vLight; varying vec4 vV, vCol; varying vec2 vFk; varying float vP, vBrake;
      ${CITY_GLSL}
      void main() {
        float mode = vV.a;
        vec3 N = normalize(vN), V = normalize(vW - cameraPosition);
        vec3 alb = mode < 0.5 ? vCol.rgb : vV.rgb;
        vec3 c = alb * vLight;
        // paint: a highlight of the street light, the sky in it
        float fres = pow(1.0 - clamp(abs(dot(V, N)), 0.0, 1.0), 3.0);
        c += (skyRefl(reflect(V, N)) * 0.25 + vLight * 0.15) * fres * step(mode, 0.5);
        if (mode > 2.5 && mode < 3.5) c = alb * vLight * 0.4 + skyRefl(reflect(V, N)) * (0.15 + 0.6 * fres);
        // lights: headlights always on; tail lights brighter on the brakes
        float tail = step(vV.g, 0.2) * step(0.5, vV.r);
        if (mode > 3.5 && mode < 4.5) c = vV.rgb * (tail > 0.5 ? 1.2 + 2.5 * vBrake : 3.0);
        gl_FragColor = vec4(applyFog(c, vFk, vP), 1.0);
      }`,
  });
}

/** Head- and taillights as glowing points (they bloom and reflect in the wet streets). */
function carLightMaterial(U: CityUniforms, tu: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    uniforms: { ...(U as unknown as Record<string, THREE.IUniform>), ...tu, pxScale: { value: (1080 * SCALE) / 2 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec4 iLane; attribute vec4 iSeg; attribute vec4 aOff;
      uniform float pxScale;
      varying vec3 vC;
      ${CITY_GLSL}
      ${TRAFFIC_GLSL}
      void main() {
        vec2 dir; float brake, vis;
        vec3 o = carPose(iLane, iSeg, dir, brake, vis);
        vec3 lp = aOff.xyz;
        vec3 rp = vec3(dir.y * lp.x + dir.x * lp.z, lp.y, -dir.x * lp.x + dir.y * lp.z);
        vec4 w = modelMatrix * vec4(rp + o, 1.0);
        vec4 mv = viewMatrix * w;
        float d = -mv.z;
        vec3 fwd = vec3(dir.x, 0.0, dir.y);
        vec3 toCam = normalize(cameraPosition - w.xyz);
        // a headlight shines forward, a taillight back: brightest seen from in front / behind
        float facing = aOff.w > 0.5 ? dot(fwd, toCam) : -dot(fwd, toCam);
        float k = aOff.w > 0.5 ? 1.6 : 0.5 + 1.4 * brake;
        vec3 c = aOff.w > 0.5 ? vec3(1.0, 0.9, 0.75) : vec3(1.0, 0.05, 0.02);
        vC = c * k * (0.25 + 0.75 * smoothstep(-0.2, 0.6, facing)) * vis;
        vec2 fk = fogK(w.xyz);
        vC *= fk.y * (1.0 - 0.7 * fk.x);
        float px = 0.35 * projectionMatrix[1][1] * pxScale / max(d, 1e-3);
        float m = clamp(px, 1.5, 60.0);
        vC *= min(1.0, (px * px) / (m * m)) * smoothstep(0.5, 2.0, d);
        gl_PointSize = m;
        gl_Position = projectionMatrix * mv;
        if (vis < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
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
  private tu: Record<string, THREE.IUniform>;

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
    for (const t of plan.trees) near.add('tree', t.x, t.z, { x: t.x, y: 0.15, z: t.z, yaw: t.seed * 6.28, sx: t.s, sy: t.s * (0.9 + 0.2 * t.seed), sz: t.s, col: [1, 1, 1], k: 0 });
    for (const p of plan.props) {
      const col: [number, number, number] = p.kind === 0 ? (p.seed < 0.5 ? [0.45, 0.06, 0.04] : p.seed < 0.8 ? [0.5, 0.45, 0.08] : [0.35, 0.36, 0.38]) : [1, 1, 1];
      near.add('prop' + p.kind, p.x, p.z, { x: p.x, y: 0.15, z: p.z, yaw: p.rot, sx: 1, sy: 1, sz: 1, col, k: 0.5 + p.seed * 0.49 });
    }
    for (const s of plan.signals) {
      const off = ((g.avDir(s.i) * s.iz) / SIG.V_WAVE % SIG.P + SIG.P) % SIG.P;
      near.add('signal', s.x, s.z, { x: s.x, y: 0.15, z: s.z, yaw: s.corner ? Math.PI : 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0.5 + fract(off * 0.37) * 0.49, x4: [off, 0, 0, 0] });
    }
    for (const s of plan.steam) if (s.stack) near.add('stack', s.x, s.z, { x: s.x, y: 0, z: s.z, yaw: 0, sx: 1, sy: 1, sz: 1, col: [1, 1, 1], k: 0 });
    const kitM = kitMaterial(U), kitM2 = kitMaterial(U, { side: THREE.DoubleSide });
    const geos: Record<string, THREE.BufferGeometry> = {
      awning: awningGeometry(), car0: carGeometry(0), car1: carGeometry(1), car3: carGeometry(3), tree: treeGeometry(), signal: signalGeometry(), stack: stackGeometry(),
    };
    for (const k of [0, 2, 3, 4, 5, 6, 7, 8]) geos['prop' + k] = propGeometry(k);
    const dists: Record<string, number> = { awning: 520, tree: 520, signal: 650 };
    const make = (kind: string, list: KInst[], origin: THREE.Vector3) => {
      const geo = geos[kind];
      if (!geo) return null;
      return kitBatch(geo, list, kind === 'awning' || kind === 'tree' || kind.startsWith('prop') || kind.startsWith('car') ? kitM2 : kitM, origin, kind === 'signal' ? 8 : 6);
    };
    near.build(this, 430 * lod, make, this.lods);
    void mid; void dists;
    this.mirrorHide.push(...this.lods);

    // ---- moving traffic ----
    const [X0, Z0, X1, Z1] = plan.o.bounds;
    const zLoop = Z1 - Z0 + 1200, z0 = Z0 - 600;
    this.tu = { uZ0: { value: z0 }, uLoop: { value: zLoop }, uPitch: { value: g.s.avPitch } };
    const traffic = o.traffic ?? 1;
    const cars: { L: number[]; S: number[]; col: number[]; type: number }[] = [];
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
    const carM = carMaterial(U, this.tu);
    for (const type of [0, 1, 2, 3]) {
      const list = cars.filter((c) => c.type === type);
      if (!list.length) continue;
      const base = carGeometry(type);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      for (const k of ['position', 'normal', 'aV', 'aL']) geo.setAttribute(k, base.attributes[k]!);
      geo.setAttribute('iLane', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((c) => c.L)), 4));
      geo.setAttribute('iSeg', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((c) => c.S)), 4));
      geo.setAttribute('iCol', new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap((c) => [...c.col, 1])), 4));
      geo.instanceCount = list.length;
      const m = new THREE.Mesh(geo, carM);
      m.frustumCulled = false;
      this.add(m);
      this.mirrorHide.push(m);
    }
    // their lights
    const lg = new THREE.BufferGeometry();
    const LP: number[] = [], LL: number[] = [], LS: number[] = [], LO: number[] = [];
    for (const c of cars) {
      const Lz = c.type === 3 ? 2.65 : 2.36, W = c.type === 3 ? 0.7 : 0.62;
      for (const [x, y, z, head] of [[-W, 0.72, Lz, 1], [W, 0.72, Lz, 1], [-W, 0.8, -Lz, 0], [W, 0.8, -Lz, 0]] as const) {
        LP.push(0, 0, 0); LL.push(...c.L); LS.push(...c.S); LO.push(x, y, z + (head ? 0.05 : -0.05), head);
      }
    }
    lg.setAttribute('position', new THREE.Float32BufferAttribute(LP, 3));
    lg.setAttribute('iLane', new THREE.Float32BufferAttribute(LL, 4));
    lg.setAttribute('iSeg', new THREE.Float32BufferAttribute(LS, 4));
    lg.setAttribute('aOff', new THREE.Float32BufferAttribute(LO, 4));
    const lights = new THREE.Points(lg, carLightMaterial(U, this.tu));
    lights.frustumCulled = false;
    this.add(lights);

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
    this.mirrorHide.push(steam);
  }

  flash(k: number, seed: number) { this.city.U.uFlash.value.set(k, seed); }
  update(_t: number, _cam: THREE.Vector3) {}
}

const fract = (x: number) => x - Math.floor(x);
