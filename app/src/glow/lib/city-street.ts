// Streets of the night city: wet asphalt with lane lines, crosswalks, stop lines, bus and bike lanes, manholes,
// patches and puddles reflecting the lit city (City's mirror pass); sidewalks of concrete flags with granite
// curbs; rear yards; the static street light baked into a light map (lamp pools, shopfront spill), which every
// city material samples, scaled by the power at the place.
import * as THREE from 'three';
import { CITY_GLSL, type CityUniforms } from './city-glsl';
import { SHOP, type CityPlan, type Lamp, type Shop } from './city-plan';
import { KitBuilder, M } from './city-build';

// ---------------------------------------------------------------- light map

export interface LightMapInfo { tex: THREE.DataTexture; rect: THREE.Vector4; x0: number; z0: number; res: number; w: number; h: number; data: Float32Array }

/** Lamp colours: sodium, a few white LED heads, park lanterns. */
export function lampColor(l: Lamp, seed: number): [number, number, number] {
  if (l.kind === 1) return [1.0, 0.72, 0.42];
  if (l.kind === 2) return [1.0, 0.62, 0.3];
  return seed < 0.16 ? [0.82, 0.86, 0.95] : [1.0, 0.52, 0.2];
}

export function shopLight(s: Shop): [number, number, number] {
  switch (s.kind) {
    case SHOP.DELI: case SHOP.LAUNDRY: case SHOP.PHARMACY: case SHOP.LIQUOR: return [0.85, 0.95, 1.0];
    case SHOP.BAR: return [1.0, 0.35, 0.18];
    case SHOP.BANK: return [0.75, 0.85, 1.0];
    case SHOP.NAILS: return [1.0, 0.7, 0.85];
    default: return [1.0, 0.75, 0.45];
  }
}

export function bakeLightMap(plan: CityPlan, lampSeeds: number[], extra: { x: number; z: number; c: [number, number, number]; s: number; k: number }[] = []): LightMapInfo {
  const [X0, Z0, X1, Z1] = plan.o.bounds;
  const res = 1.6, pad = 120;
  const x0 = X0 - pad, z0 = Z0 - pad;
  const w = Math.ceil((Math.min(X1, (plan.o.river ?? X1) + 60) + pad - x0) / res), h = Math.ceil((Z1 + pad - z0) / res);
  const data = new Float32Array(w * h * 3);
  const splat = (x: number, z: number, c: [number, number, number], sigma: number, k: number) => {
    const cx = (x - x0) / res, cz = (z - z0) / res, R = Math.ceil((sigma * 2.6) / res);
    const i0 = Math.max(1, Math.floor(cx - R)), i1 = Math.min(w - 2, Math.ceil(cx + R)), j0 = Math.max(1, Math.floor(cz - R)), j1 = Math.min(h - 2, Math.ceil(cz + R));
    const inv = (res * res) / (2 * sigma * sigma);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d2 = ((i - cx) ** 2 + (j - cz) ** 2) * inv;
      if (d2 > 7) continue;
      const e = Math.exp(-d2) * k, o = (j * w + i) * 3;
      data[o] += c[0] * e; data[o + 1] += c[1] * e; data[o + 2] += c[2] * e;
    }
  };
  plan.lamps.forEach((l, i) => {
    const c = lampColor(l, lampSeeds[i]!);
    const hx = l.x + l.ax * 1.8, hz = l.z + l.az * 1.8;
    if (l.kind === 1) { splat(hx, hz, c, 4.5, 0.9); splat(hx, hz, c, 10, 0.12); return; }
    splat(hx, hz, c, 6.5, 1.25);
    splat(hx, hz, c, 15, 0.22);
  });
  for (const s of plan.shops) {
    if (!s.lit) continue;
    const c = shopLight(s), k = s.kind === SHOP.LOBBY ? 0.35 : s.kind === SHOP.BAR || s.kind === SHOP.RESTAURANT ? 0.5 : 0.85;
    const tx = s.nz, tz = -s.nx, n = Math.max(1, Math.round(s.w / 2.2));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5;
      splat(s.x + tx * u * s.w + s.nx * 1.6, s.z + tz * u * s.w + s.nz * 1.6, c, 2.2, k * (2.2 / Math.max(2.2, s.w / n)) * 1.2);
      splat(s.x + tx * u * s.w + s.nx * 4.5, s.z + tz * u * s.w + s.nz * 4.5, c, 4.5, k * 0.25);
    }
  }
  for (const e of extra) splat(e.x, e.z, e.c, e.s, e.k);
  // encode sqrt(v / 4) in RGBA8
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    for (let c = 0; c < 3; c++) px[i * 4 + c] = Math.round(Math.sqrt(Math.min(1, data[i * 3 + c]! / 4)) * 255);
    px[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return { tex, rect: new THREE.Vector4(x0, z0, 1 / (w * res), 1 / (h * res)), x0, z0, res, w, h, data };
}

/** CPU read of the light map (for lighting things scenes add). */
export function lightAt(lm: LightMapInfo, x: number, z: number): [number, number, number] {
  const i = Math.round((x - lm.x0) / lm.res), j = Math.round((z - lm.z0) / lm.res);
  if (i < 0 || j < 0 || i >= lm.w || j >= lm.h) return [0, 0, 0];
  const o = (j * lm.w + i) * 3;
  return [lm.data[o]!, lm.data[o + 1]!, lm.data[o + 2]!];
}

// ---------------------------------------------------------------- the wet ground

const WET_GLSL = /* glsl */ `
  uniform sampler2D uMirror; uniform mat4 uMirrorMat;
  // what the wet ground reflects at W: the mirror pass (blurred along the screen's vertical) or, without it, the sky
  vec3 wetReflection(vec3 W, vec2 nrm, float rough, float p) {
    if (uMirrorOn > 0.5) {
      vec4 mp = uMirrorMat * vec4(W, 1.0);
      vec2 uv = mp.xy / max(mp.w, 1e-3) + nrm * 0.012;
      vec3 r = vec3(0.0);
      float s = rough * 0.022;
      r += texture2D(uMirror, uv + vec2(0.0, -2.0 * s)).rgb * 0.12;
      r += texture2D(uMirror, uv + vec2(0.0, -1.0 * s)).rgb * 0.22;
      r += texture2D(uMirror, uv).rgb * 0.32;
      r += texture2D(uMirror, uv + vec2(0.0, 1.0 * s)).rgb * 0.22;
      r += texture2D(uMirror, uv + vec2(0.0, 2.0 * s)).rgb * 0.12;
      return r;
    }
    vec3 V = normalize(W - cameraPosition);
    return envRefl(reflect(V, vec3(nrm.x, 1.0, nrm.y) / length(vec3(nrm.x, 1.0, nrm.y))), 0.0) * 0.6 + lightMap(W.xz) * p * 0.12;
  }
`;

export function groundMaterial(U: CityUniforms, gridGlsl: string, riverX: number | null, elX: number | null) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      ${gridGlsl}
      ${WET_GLSL}
      uniform vec4 uVein; uniform vec3 uVeinC;
      varying vec3 vW;
      const float RIVER_X = ${(riverX ?? 1e9).toFixed(1)}, EL_X = ${(elX ?? 1e9).toFixed(1)};
      void main() {
        vec2 xz = vW.xz - uOrigin.xz;
        vec2 an = avNear(xz.x), sn = stNear(xz.y);
        float wide = stWide(sn.x);
        float sRoadH = mix(ST_ROADH, WIDE_ROADH, wide), sHalf = mix(ST_HALF, WIDE_HALF, wide);
        float dx = an.y, dz = sn.y, adx = abs(dx), adz = abs(dz);
        float onAv = step(adx, AV_ROADH), onSt = step(adz, sRoadH);
        float px = max(fwidth(xz.x), fwidth(xz.y));
        float p = power(vW.xz);
        // ---- asphalt ----
        float agg = vnoise(xz * 7.0) * smoothstep(0.08, 0.02, px);
        float patchN = fbm3(xz * 0.07 + 11.0);
        vec3 alb = vec3(0.075, 0.075, 0.08) * (0.85 + 0.25 * agg);
        alb *= mix(1.0, 0.75, smoothstep(0.55, 0.6, patchN));                         // patches of newer asphalt
        alb = mix(alb, alb * 1.3, smoothstep(0.62, 0.66, fbm3(xz * 0.11 + 4.0)) * 0.5);
        // tar snakes: thin dark squiggles
        float snake = smoothstep(0.02, 0.0, abs(fbm3(xz * 0.35 + 2.0) - 0.5)) * smoothstep(0.1, 0.03, px);
        alb *= 1.0 - 0.5 * snake;
        // ---- markings ----
        float mk = 0.0; vec3 mkC = vec3(0.6, 0.6, 0.58);
        float aw = clamp(px * 0.8, 0.02, 0.5);
        // avenue lanes: dashed lines between 5 lanes; the parking lanes' edge; a red bus lane on some avenues
        float avBlock = onAv * (1.0 - onSt);
        float lane = abs(mod(dx + 1.6, 3.2) - 1.6);
        float dashZ = step(fract(xz.y / 12.0), 0.25);
        mk += avBlock * smoothstep(0.08 + aw, 0.08, lane) * dashZ * step(adx, 6.0);
        mk += avBlock * smoothstep(0.07 + aw, 0.07, abs(adx - 8.0));
        float bus = avBlock * step(h11(an.x * 3.7), 0.45) * step(-8.0, dx * sign(h11(an.x * 5.1) - 0.5)) * step(dx * sign(h11(an.x * 5.1) - 0.5), -4.8) * step(abs(an.x * 250.0 + AX0 - EL_X), 1.0) * 0.0;
        float busLane = avBlock * step(h11(an.x * 3.7), 0.45) * step(4.8, dx) * step(dx, 8.0);
        alb = mix(alb, vec3(0.22, 0.045, 0.035), busLane * 0.85);
        float bike = avBlock * step(0.55, h11(an.x * 3.7)) * step(-8.0, dx) * step(dx, -6.2);
        alb = mix(alb, vec3(0.05, 0.16, 0.07), bike * 0.85);
        // streets: a double yellow on the wide two-way ones
        float stBlock = onSt * (1.0 - onAv);
        mk += stBlock * wide * smoothstep(0.07 + aw, 0.07, abs(adz - 0.18));
        float yellow = stBlock * wide * smoothstep(0.07 + aw, 0.07, abs(adz - 0.18));
        mk += stBlock * smoothstep(0.07 + aw, 0.07, abs(adz - sRoadH + 2.3)) * (1.0 - wide) * 0.0;
        // crosswalks (ladder bars) and stop lines, at every intersection
        float cwA = onAv * step(sRoadH + 0.6, adz) * step(adz, sRoadH + 3.8) * step(adx, AV_ROADH - 0.3);
        mk += cwA * smoothstep(0.5 + aw * 2.0, 0.5, abs(fract(dx / 1.3) - 0.5) * 2.0 + 0.0) * 0.0;
        mk += cwA * step(fract(dx / 1.3), 0.55);
        mk += onAv * smoothstep(0.2 + aw, 0.2, abs(adz - sRoadH - 4.6)) * step(adx, AV_ROADH - 0.3);
        float cwS = onSt * step(AV_ROADH + 0.6, adx) * step(adx, AV_ROADH + 3.8) * step(adz, sRoadH - 0.3);
        mk += cwS * step(fract(dz / 1.3), 0.55);
        mk += onSt * smoothstep(0.2 + aw, 0.2, abs(adx - AV_ROADH - 4.6)) * step(adz, sRoadH - 0.3);
        mk = clamp(mk, 0.0, 1.0) * (1.0 - onAv * onSt);
        // worn paint
        mk *= 0.55 + 0.45 * smoothstep(0.3, 0.7, vnoise(xz * 1.3));
        mkC = mix(mkC, vec3(0.55, 0.4, 0.08), yellow);
        alb = mix(alb, mkC, mk);
        // manholes: round covers in the lanes
        vec2 mc = vec2(onAv > 0.5 ? (floor(dx / 3.2) + 0.5) * 3.2 : floor(xz.x / 23.0) * 23.0 + 11.5, onAv > 0.5 ? floor(xz.y / 27.0) * 27.0 + 13.5 : (floor(dz / 2.8) + 0.5) * 2.8);
        vec2 mrel = onAv > 0.5 ? vec2(dx - mc.x, xz.y - mc.y) : vec2(xz.x - mc.x, dz - mc.y);
        float mh = step(0.62, h12(floor(onAv > 0.5 ? vec2(an.x * 9.0 + floor(dx / 3.2), xz.y / 27.0) : vec2(xz.x / 23.0, sn.x * 7.0 + floor(dz / 2.8))))) * max(onAv, onSt);
        float mr = length(mrel);
        float cover = mh * smoothstep(0.42, 0.38, mr);
        alb = mix(alb, vec3(0.06, 0.055, 0.05) * (0.8 + 0.4 * step(0.5, fract((mrel.x + mrel.y) * 6.0))), cover);
        float rim = mh * smoothstep(0.03, 0.0, abs(mr - 0.4));
        // ---- beyond the streets (lots under buildings, the city's edge) ----
        float road = max(onAv, onSt);
        alb = mix(vec3(0.035, 0.035, 0.035), alb, road);
        // ---- wet: puddles, gutters; the crown of the road drier ----
        float gutter = max(onAv * (1.0 - onSt) * smoothstep(AV_ROADH - 1.4, AV_ROADH, adx), onSt * (1.0 - onAv) * smoothstep(sRoadH - 1.2, sRoadH, adz));
        float pud = smoothstep(0.52, 0.6, fbm3(xz * 0.09 + 3.1) + 0.12 * vnoise(xz * 0.8));
        float wet = clamp(0.45 + 0.55 * max(pud, gutter) - 0.15 * patchN, 0.0, 1.0) * road;
        float mirrorK = max(pud, gutter * 0.8);
        // ---- light ----
        vec3 N = vec3(0.0, 1.0, 0.0);
        vec3 L = ambient(N, p) + streetLight(vW.xz, 0.0, p) * (1.0 - 0.8 * uDawn) + sunLight(vW, N) + peopleGlow(vW, N);
        alb *= 1.0 - 0.45 * wet;                            // wet asphalt is darker
        vec3 c = alb * L;
        c += rim * 0.0;
        // reflections: sharp in puddles, smeared on the wet asphalt
        vec3 V = normalize(vW - cameraPosition);
        float cosv = clamp(-V.y, 0.0, 1.0);
        float fres = 0.04 + 0.96 * pow(1.0 - cosv, 5.0);
        vec2 ripple = (vec2(vnoise(xz * 2.3 + uTime * 0.3), vnoise(xz * 2.3 + 17.0 - uTime * 0.25)) - 0.5) * (1.0 - mirrorK * 0.8);
        vec3 refl = wetReflection(vW, ripple, mix(1.0, 0.15, mirrorK), p);
        c += refl * wet * fres * mix(0.55, 1.0, mirrorK) * (1.0 - mk * 0.5);
        // the avenues' pulse (drop): rings of light running along the roads
        if (uVein.x > 0.0) {
          float d = uVein.w > 0.5 ? length(xz - uVein.yz) : abs(xz.y - uVein.y);
          float centre = max(onAv * exp(-dx * dx / 18.0), onSt * exp(-dz * dz / 8.0));
          c += uVeinC * uVein.x * road * (0.25 + centre) ;
        }
        c = cityFog(c, vW, p);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

/** Sidewalk slabs (one per block, 0.15 m high): concrete flags, granite curbs; the rear yards inside. */
export function slabMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      attribute vec4 aRect; attribute vec4 aWalk; attribute vec2 aKind;
      varying vec3 vW, vN; varying vec4 vRect, vWalk; varying vec2 vKind;
      void main() {
        vec3 p = vec3(mix(aRect.x, aRect.z, position.x + 0.5), position.y * 0.15, mix(aRect.y, aRect.w, position.z + 0.5));
        vec4 w = modelMatrix * vec4(p, 1.0);
        vW = w.xyz; vN = normal; vRect = aRect; vWalk = aWalk; vKind = aKind;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      ${WET_GLSL}
      varying vec3 vW, vN; varying vec4 vRect, vWalk; varying vec2 vKind;
      void main() {
        vec3 N = normalize(vN);
        vec2 xz = vW.xz - uOrigin.xz;
        float p = power(vW.xz);
        float px = max(fwidth(xz.x), fwidth(xz.y));
        vec3 c;
        // distance in from each edge
        float dW = xz.x - vRect.x, dE = vRect.z - xz.x, dN = xz.y - vRect.y, dS = vRect.w - xz.y;
        float walk = max(max(step(dW, vWalk.x), step(dE, vWalk.y)), max(step(dN, vWalk.z), step(dS, vWalk.w)));
        vec3 L = ambient(N, p) + streetLight(vW.xz + N.xz * 0.5, 0.15, p) * (1.0 - 0.8 * uDawn) + sunLight(vW, N) + peopleGlow(vW, N);
        if (N.y > 0.5) {
          vec3 alb;
          if (vKind.x > 0.5) {
            // a park: lawns, paths, a little fog of leaves
            float path = step(abs((xz.x - vRect.x) / (vRect.z - vRect.x) - (xz.y - vRect.y) / (vRect.w - vRect.y)) * (vRect.z - vRect.x), 2.2) + step(abs(xz.y - (vRect.y + vRect.w) * 0.5), 2.6);
            alb = mix(vec3(0.035, 0.06, 0.03) * (0.7 + 0.6 * fbm3(xz * 0.3)), vec3(0.22, 0.2, 0.18), clamp(path, 0.0, 1.0));
            alb = mix(alb, vec3(0.3, 0.3, 0.29), walk);
          } else if (walk > 0.5) {
            // concrete flags, joints, gum, stains; the granite curb edge
            vec2 f = fract(xz / 1.52);
            float joint = (step(f.x, 0.012) + step(f.y, 0.012)) * smoothstep(0.08, 0.02, px);
            alb = vec3(0.3, 0.295, 0.285) * (0.85 + 0.2 * h12(floor(xz / 1.52))) * (1.0 - 0.35 * clamp(joint, 0.0, 1.0));
            alb *= 0.9 + 0.1 * vnoise(xz * 3.0);
            alb *= 1.0 - 0.4 * step(0.985, h12(floor(xz * 9.0))) * smoothstep(0.05, 0.01, px);
            float edge = min(min(dW, dE), min(dN, dS));
            alb = mix(alb, vec3(0.38, 0.38, 0.4), smoothstep(0.42, 0.38, edge));
          } else {
            // rear yards: dirt, paving, a bit of green
            float g = fbm3(xz * 0.25 + 7.0);
            alb = mix(vec3(0.07, 0.065, 0.06), vec3(0.03, 0.05, 0.025), smoothstep(0.4, 0.6, g));
          }
          // wet sidewalks reflect a little
          vec3 V = normalize(vW - cameraPosition);
          float fres = 0.04 + 0.96 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
          float wet = (0.3 + 0.5 * smoothstep(0.55, 0.62, fbm3(xz * 0.2 + 5.0))) * walk;
          alb *= 1.0 - 0.3 * wet;
          c = alb * L + wetReflection(vW, vec2(0.0), 0.8, p) * wet * fres * 0.45;
        } else {
          // the curb: granite, lit from the street
          c = vec3(0.33, 0.33, 0.34) * (0.85 + 0.2 * h12(floor(vec2(xz.x + xz.y, 0.0) / 1.8))) * (L + streetLight(vW.xz + N.xz * 1.5, 0.0, p) * 0.4);
        }
        c = cityFog(c, vW, p);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export function slabMesh(plan: CityPlan, mat: THREE.Material) {
  const g = plan.grid;
  const list: number[][] = [];
  for (const [i, j, kind] of plan.blocks) {
    const x0 = g.avX(i) + g.avRoadH(), x1 = g.avX(i + 1) - g.avRoadH(), z0 = g.stZ(j) + g.stRoadH(j), z1 = g.stZ(j + 1) - g.stRoadH(j + 1);
    list.push([x0, z0, x1, z1, g.s.avWalk, g.s.avWalk, g.stHalf(j) - g.stRoadH(j), g.stHalf(j + 1) - g.stRoadH(j + 1), kind]);
  }
  const base = new THREE.BoxGeometry(1, 1, 1);
  base.translate(0, 0.5, 0);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position!);
  geo.setAttribute('normal', base.attributes.normal!);
  const n = list.length, rect = new Float32Array(n * 4), walk = new Float32Array(n * 4), kind = new Float32Array(n * 2);
  list.forEach((q, i) => { rect.set(q.slice(0, 4), i * 4); walk.set(q.slice(4, 8), i * 4); kind.set([q[8]!, 0], i * 2); });
  geo.setAttribute('aRect', new THREE.InstancedBufferAttribute(rect, 4));
  geo.setAttribute('aWalk', new THREE.InstancedBufferAttribute(walk, 4));
  geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kind, 2));
  geo.instanceCount = n;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

// ---------------------------------------------------------------- lamp posts

/** A cobra-head street light: octagonal pole, an arm reaching over the road (+x), the head with its lens. Height 9. */
export function cobraGeometry() {
  const k = new KitBuilder();
  const pole = [0.09, 0.095, 0.1, M.ALB];
  k.cyl(0, 4.2, 0, 0.08, 0.14, 8.4, 6, pole, true);
  k.box(0.95, 8.55, 0, 1.9, 0.09, 0.09, pole, 0, 0, 0.12);
  k.box(1.9, 8.72, 0, 0.75, 0.2, 0.36, [0.12, 0.12, 0.13, M.ALB]);
  k.quad(1.95, 8.61, 0, 0.55, 0.26, [1.0, 0.8, 0.55, M.LAMP], 0, Math.PI / 2);
  return k.geometry();
}

/** A park lamp: a slim post with a lantern globe. Height 4.2. */
export function parkLampGeometry() {
  const k = new KitBuilder();
  k.cyl(0, 2.0, 0, 0.05, 0.09, 4.0, 6, [0.04, 0.05, 0.045, M.ALB], true);
  k.sphere(0, 4.2, 0, 0.26, [1.0, 0.85, 0.6, M.LAMP], 1, 1.15, 1, 0);
  k.cyl(0, 4.52, 0, 0.02, 0.18, 0.14, 6, [0.04, 0.05, 0.045, M.ALB], true);
  return k.geometry();
}
