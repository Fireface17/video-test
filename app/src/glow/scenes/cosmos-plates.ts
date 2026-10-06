// The deck of drop 3: thirteen procedural cosmic plates, each a still painted once (lazily, the first time it is
// needed) by its own fragment shader into a 2560x1440 HDR texture, then cut between on the kicks by cosmos-deck.ts.
// Painting once keeps every frame cheap and every plate clean: no per-frame noise, no shimmer, no aliasing on fine
// stars (they are gaussians at least ~1 texel wide, and the deck only ever magnifies a plate, never minifies it
// below ~0.75 texel/px). Palette: gold (ember -> amber -> gold -> white-hot), with deep blue / teal / black as contrast.
//
//   0 BLACKHOLE  lensed accretion disk (thin bright disk across, the lensed far side as a halo, photon ring)
//   1 SPIRAL     a face-on spiral galaxy: gold core, blue-white arms, dust lanes, star-forming knots
//   2 PILLARS    pillars of dust rim-lit against glowing gas (gold / teal, the Hubble palette)
//   3 PULSAR     a pulsar with helical jets, its equatorial torus and a filamentary wind nebula
//   4 BINARY     a gold giant spilling a stream of gas onto a blue-white companion's accretion disk
//   5 PLANET     a ringed planet backlit by its star: gold crescent, forward-scattering rings, starburst
//   6 CLUSTER    a globular cluster: thousands of stars, gold giants, blue stragglers
//   7 WEB        the cosmic web: gold filaments and bright nodes over deep blue voids
//   8 REMNANT    a gold supernova remnant: filamentary shell, crisp blast wave, ejecta fingers
//   9 AURORA     a ribbon of glowing gas curtains over a dark planet limb
//  10 ECLIPSE    a total eclipse: black disc, streamered corona, prominences, the diamond ring
//  11 EYE        a planetary nebula (the "eye"): ring, cometary knots, teal core, white dwarf
//  12 STARNEB    the motif: a five-pointed star sticker made of glowing gas
import * as THREE from 'three';
import { FSPass, SCALE } from '../../engine/gl';

export const PLATE = { BLACKHOLE: 0, SPIRAL: 1, PILLARS: 2, PULSAR: 3, BINARY: 4, PLANET: 5, CLUSTER: 6, WEB: 7, REMNANT: 8, AURORA: 9, ECLIPSE: 10, EYE: 11, STARNEB: 12 } as const;
export const PLATE_NAMES = Object.keys(PLATE);
export const PLATE_W = 2560, PLATE_H = 1440;

// ------------------------------------------------------------------------------------------- shared GLSL
const LIB = /* glsl */ `
uniform vec2 uRes;
float PX;                          // plate units per texel (the plate is x in [-16/9, 16/9], y in [-1, 1])
const float AS = 1.7777778;

float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbv(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 9; i++) { if (i >= oct) break; s += a * vn(p); n += a; p = rot2(0.7) * p * 2.03 + 17.3; a *= 0.5; }
  return s / n;
}
// ridged multifractal 0..1 (thin bright ridges: filaments)
float ridge(vec2 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; float v = 1.0 - abs(snoise(p)); s += a * v * v; n += a; p = rot2(0.5) * p * 2.1 + 5.1; a *= 0.5; }
  return s / n;
}
float ridge3(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; float v = 1.0 - abs(snoise(p)); s += a * v * v; n += a; p = p * 2.1 + 5.1; a *= 0.5; }
  return s / n;
}
// star colour: 0 red-orange .. 0.55 gold-white .. 1 blue-white
vec3 starTint(float k) {
  vec3 a = vec3(1.0, 0.42, 0.14), b = vec3(1.0, 0.85, 0.62), c = vec3(0.6, 0.76, 1.0);
  return k < 0.6 ? mix(a, b, k / 0.6) : mix(b, c, (k - 0.6) / 0.4);
}
// gold ramp: 0 black, ember, amber, gold, 1 white-hot (x > 1 keeps rising, HDR)
vec3 gold(float x) {
  x = max(x, 0.0);
  vec3 c = mix(vec3(0.30, 0.05, 0.01), vec3(1.0, 0.36, 0.06), smoothstep(0.0, 0.35, x));
  c = mix(c, vec3(1.0, 0.70, 0.30), smoothstep(0.3, 0.7, x));
  c = mix(c, vec3(1.0, 0.93, 0.80), smoothstep(0.65, 1.1, x));
  return c * x;
}
// one layer of fine stars on a jittered grid (one star per cell at most, kept away from the cell edges)
vec3 starLayer(vec2 p, float cell, float dens, float seed, float blue) {
  vec2 g = p / cell + seed * 13.1; vec2 id = floor(g), f = fract(g);
  if (hash12(id + seed) > dens) return vec3(0.0);
  vec2 sp = 0.22 + 0.56 * hash22(id * 1.37 + seed);
  vec2 d = (f - sp) * cell / PX;
  float m = hash12(id * 2.1 + seed + 5.0);
  float mag = 0.1 + 0.45 * m * m * m + 2.6 * pow(m, 16.0);
  float rad = 0.72 + 0.8 * pow(m, 6.0);
  float r2 = dot(d, d);
  vec3 tint = starTint(clamp(hash12(id + seed * 7.7) * (0.75 + 0.45 * blue), 0.0, 1.0));
  return tint * mag * exp(-r2 / (rad * rad));
}
vec3 starfield(vec2 p, float dens, float seed, float blue) {
  vec3 s = starLayer(p, 0.0085, 0.16 * dens, seed + 1.0, blue) * 0.6;
  s += starLayer(p, 0.019, 0.22 * dens, seed + 2.0, blue) * 0.9;
  s += starLayer(p, 0.045, 0.3 * dens, seed + 3.0, blue) * 1.3;
  return s;
}
// bright stars with 4-point diffraction spikes (3x3 neighbour cells, spikes windowed inside one cell)
vec3 brightStars(vec2 p, float cell, float prob, float seed, float gain, float blue) {
  vec2 id0 = floor(p / cell);
  vec3 acc = vec3(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 id = id0 + vec2(float(i), float(j));
    if (hash12(id + seed * 3.17) > prob) continue;
    vec2 sp = (id + 0.2 + 0.6 * hash22(id + seed)) * cell;
    vec2 dw = p - sp;
    vec2 d = dw / PX;
    float m = hash12(id + seed + 9.1);
    float mag = gain * (0.35 + 2.2 * m * m * m);
    float r = length(d);
    vec3 tint = starTint(clamp(hash12(id + seed + 2.2) * (0.8 + 0.4 * blue), 0.0, 1.0));
    float core = exp(-r * r / 2.4) * 3.0 + exp(-r / 4.0) * 0.4 + exp(-r / 16.0) * 0.07;
    vec2 a = abs(d);
    float L = 14.0 + 46.0 * m;
    float spk = (exp(-a.y * 0.9 - a.x / L) + exp(-a.x * 0.9 - a.y / L)) * 0.8;
    spk *= 1.0 - smoothstep(0.55 * cell, 0.9 * cell, length(dw));
    acc += tint * mag * (core + spk);
  }
  return acc;
}
// signed distance to a five-pointed star (iq)
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292), k2 = vec2(-0.809016994375, -0.587785252292);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}
// a starburst (lens): core, long thin rays (n of them), an anamorphic streak
vec3 burst(vec2 p, vec2 c, float k, float rays, float rot, vec3 tint) {
  vec2 d = p - c; float r = length(d) / PX; float a = atan(d.y, d.x) + rot;
  float ray = pow(abs(cos(a * rays * 0.5)), 900.0) * exp(-r / 110.0) + pow(abs(cos(a * rays * 0.5 + 0.8)), 400.0) * exp(-r / 45.0) * 0.4;
  float core = exp(-r * r / 30.0) * 6.0 + exp(-r / 14.0) * 1.2 + exp(-r / 70.0) * 0.25;
  float streak = exp(-abs(d.y) / PX / 1.4) * exp(-abs(d.x) / PX / 260.0) * 0.3;
  return tint * k * (core + ray * 1.4 + streak);
}
`;

// ------------------------------------------------------------------------------------------- the plates
const PLATES: string[] = [];

// 0 BLACK HOLE
PLATES[0] = /* glsl */ `
float diskI(float R, float rin, float rout) {
  float x = (R - rin) / (rout - rin);
  return pow(rin / max(R, 1e-3), 2.4) * smoothstep(rin * 0.96, rin * 1.06, R) * (1.0 - smoothstep(0.2, 1.0, x));
}
vec3 diskCol(float R, float th, float rin, float rout, float beam, float seed) {
  float I = diskI(R, rin, rout);
  if (I <= 0.0) return vec3(0.0);
  // streaks along the orbit: noise periodic in the angle, fast in radius
  vec3 q = vec3(cos(th) * 1.6, sin(th) * 1.6, R * 46.0 + seed);
  float s = 0.5 + 0.5 * fbm(q, 5);
  float s2 = 0.5 + 0.5 * snoise(vec3(cos(th) * 4.0, sin(th) * 4.0, R * 160.0 + seed));
  float tex = 0.35 + 1.1 * s * s + 0.25 * s2;
  float heat = I * beam * tex;
  vec3 c = gold(heat * 1.25);
  // the approaching side is whiter, the receding side redder
  c = mix(c, c * vec3(0.85, 0.95, 1.25), clamp((beam - 1.0) * 0.4, 0.0, 0.4));
  return c * 1.6;
}
vec3 plate(vec2 p) {
  float rs = 0.33;
  float roll = -0.07;
  vec2 q = rot2(roll) * p;
  float r = length(q);
  float ci = 0.13;
  float rin = rs * 1.45, rout = rs * 5.2;
  // lensed background: deep field of gold and blue stars, a faint haze
  vec2 src = q - q / max(r, 1e-3) * (rs * rs * 2.2 / max(r, rs * 0.6));
  vec3 bg = starfield(src * 1.3, 0.8, 4.0, 0.6) + brightStars(src, 0.35, 0.2, 11.0, 0.5, 0.6);
  float hz = fbv(src * 1.6 + 3.0, 6);
  bg += vec3(0.004, 0.010, 0.035) * (0.4 + hz) + vec3(0.06, 0.025, 0.005) * pow(hz, 3.0);
  float shadow = smoothstep(rs, rs + PX * 1.5, r);
  vec3 col = bg * shadow;
  // the disk, direct image
  vec2 dc = vec2(q.x, q.y / ci);
  float R = length(dc), th = atan(dc.y, dc.x);
  float beam = mix(0.32, 1.9, pow(0.5 - 0.5 * cos(th), 1.3));
  vec3 dsk = diskCol(R, th, rin, rout, beam, 0.0);
  // thin: the disk image fades quickly out of its plane (a smooth vertical profile, not a hard ellipse)
  bool far = dc.y > 0.0;
  col += dsk * (far ? shadow : 1.0);
  // the lensed far side of the disk: a halo over the top of the shadow (wide) and a thin ring under it
  if (r > rs) {
    float ph = atan(q.y, q.x);
    float bm = mix(0.32, 1.9, pow(0.5 - 0.5 * cos(ph), 1.3));
    float up = smoothstep(-0.25, 0.55, sin(ph));
    float Rt = rin + (r - rs * 1.05) * 3.4;
    vec3 top = diskCol(Rt, -ph, rin, rout, bm, 7.0) * up;
    float Rb = rin + (r - rs * 1.035) * 9.0;
    vec3 bot = diskCol(Rb, ph, rin, rout, bm, 13.0) * smoothstep(0.3, -0.5, sin(ph)) * 0.75;
    // where the front of the disk crosses, the halo is behind it (the disk is emissive: just add)
    col += (top * 1.5 + bot) * (1.0 - 0.6 * smoothstep(0.0, 0.03, -q.y) * step(abs(q.y), ci * rout * 0.25));
    // photon ring
    float pr = exp(-pow((r - rs * 1.018) / (PX * 1.3 + 0.0012), 2.0)) * 2.0 + exp(-pow((r - rs * 1.045) / 0.003, 2.0)) * 0.5;
    col += gold(1.0) * pr * bm * 0.8;
  }
  // a warm glow around the whole disk
  float g = exp(-length(vec2(q.x * 0.55, q.y * 2.2)) / 0.28);
  col += vec3(1.0, 0.45, 0.1) * g * 0.10 * shadow;
  return col;
}`;

// 1 SPIRAL GALAXY, face-on
PLATES[1] = /* glsl */ `
vec3 plate(vec2 p) {
  vec2 q = rot2(0.4) * p / 0.95;
  q.y /= 0.9;
  float r = length(q), th = atan(q.y, q.x);
  float warp = fbv(q * 2.2 + 3.0, 5) - 0.5;
  float ph = th - 2.6 * log(r + 0.025) + warp * 0.8;
  float armA = pow(0.5 + 0.5 * cos(2.0 * ph), 2.6);
  float spur = pow(0.5 + 0.5 * cos(4.0 * ph + 1.9 + 3.0 * warp), 4.0) * smoothstep(0.25, 0.6, r);
  float arm = clamp(armA + 0.35 * spur, 0.0, 1.0);
  float edge = 1.0 - smoothstep(0.6, 1.2, r);
  float disk = exp(-r * 2.8) * edge;
  // flocculent texture along the arms (smeared along the spiral, not speckle)
  vec2 sq = vec2(ph * 1.2, log(r + 0.025) * 6.0);
  float flock = 0.6 + 0.8 * fbv(vec2(sq.x * 3.0, sq.y * 1.0) + 7.0, 5);
  // dust lanes: continuous dark lanes on the inner edge of each arm
  float lane = pow(0.5 + 0.5 * cos(2.0 * ph - 0.8), 8.0) * smoothstep(0.06, 0.2, r) * edge;
  float dust = lane * (0.55 + 0.6 * fbv(vec2(sq.x * 6.0, sq.y * 2.5) + 2.0, 5));
  float ab = exp(-2.4 * dust);
  vec3 old = vec3(1.0, 0.6, 0.26);
  vec3 young = vec3(0.42, 0.62, 1.0);
  vec3 col = vec3(0.0);
  col += old * disk * 0.7 * (0.35 + 0.65 * arm) * ab;
  col += young * disk * arm * flock * 1.5 * smoothstep(0.1, 0.42, r) * ab;
  float bul = exp(-r * 11.0) * 1.7 + exp(-r * r * 800.0) * 2.6;
  col += gold(1.0) * bul * mix(1.0, ab, 0.4);
  col += vec3(1.0, 0.55, 0.2) * exp(-r * 4.5) * 0.18;
  // star-forming knots along the arms
  vec2 cc = q / 0.035; vec2 cid = floor(cc);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = cid + vec2(float(i), float(j));
    float h = hash12(g + 3.0);
    vec2 cp = (g + 0.2 + 0.6 * hash22(g + 1.0)) * 0.035;
    float rr = length(cp);
    float ag = pow(0.5 + 0.5 * cos(2.0 * (atan(cp.y, cp.x) - 2.6 * log(rr + 0.025) + warp * 0.8)), 3.0);
    if (h > 0.22 * ag * smoothstep(0.15, 0.4, rr) * (1.0 - smoothstep(0.75, 1.0, rr))) continue;
    vec2 d = (q - cp) / PX;
    float k = hash12(g + 8.0);
    vec3 tint = k > 0.55 ? vec3(1.0, 0.45, 0.3) : vec3(0.7, 0.82, 1.0);
    col += tint * (exp(-dot(d, d) / 7.0) * 1.1 + exp(-length(d) / 6.0) * 0.2) * ab;
  }
  float sd = clamp(disk * (0.5 + 2.0 * arm), 0.0, 1.0);
  col += starfield(q * 1.4, sd, 21.0, 0.8) * 0.8 * ab;
  col += starfield(p, 0.35, 33.0, 0.4) * 0.6;
  col += brightStars(p, 0.42, 0.2, 5.0, 0.5, 0.4);
  col += vec3(0.0015, 0.003, 0.01);
  return col;
}`;

// 2 PILLARS
PLATES[2] = /* glsl */ `
float pillar(vec2 p, float x0, float lean, float yTop, float w0, float seed) {
  float y = min(p.y, yTop);
  float u = clamp((y + 1.1) / (yTop + 1.1), 0.0, 1.0);
  float xc = x0 + lean * (y + 1.1) + 0.05 * sin(y * 2.6 + seed);
  float w = w0 * (1.25 - 0.6 * u) * (0.7 + 0.6 * vn(vec2(y * 2.4, seed * 7.0)));
  float dx = abs(p.x - xc) - w;
  return p.y < yTop ? dx : length(vec2(p.x - xc, (p.y - yTop) * 1.35)) - w;
}
vec3 plate(vec2 p) {
  // glowing gas behind: gold where dense and lit, teal where thin, dark clouds in front of it
  vec2 w = vec2(fbv(p * 1.5 + 1.0, 5), fbv(p * 1.5 + 9.0, 5)) - 0.5;
  float g1 = fbv(p * 1.9 + w * 1.6 + 4.0, 8);
  float g2 = fbv(p * 4.5 + w * 2.0 + 11.0, 6);
  float lit = smoothstep(-1.2, 1.0, p.y + 0.4 * p.x);
  float gas = pow(g1, 3.0) * (0.35 + 1.3 * lit) + 0.2 * pow(g2, 4.0);
  vec3 teal = vec3(0.02, 0.2, 0.28);
  vec3 bg = mix(teal, vec3(1.0, 0.55, 0.16), smoothstep(0.08, 0.4, gas)) * gas * 2.3;
  bg *= 0.25 + 0.75 * smoothstep(0.3, 0.62, fbv(p * 3.0 + w + 20.0, 6));
  bg += vec3(0.001, 0.003, 0.008);
  bg += starfield(p, 0.6, 7.0, 0.3) * 0.7;
  // the pillars: three columns with billowing edges and knobbly tops
  float n1 = fbv(p * 5.0 + 2.0, 6) - 0.5, n2 = fbv(p * 18.0 + 5.0, 5) - 0.5, n3 = fbv(p * 50.0 + 1.0, 4) - 0.5;
  float d = pillar(p, -0.9, 0.14, 0.66, 0.19, 0.0);
  d = smin(d, pillar(p, 0.08, -0.06, 0.08, 0.13, 2.0), 0.1);
  d = smin(d, pillar(p, 0.98, -0.16, 0.36, 0.16, 4.0), 0.1);
  d += n1 * 0.16 + n2 * 0.045 + n3 * 0.012;
  float inside = smoothstep(PX * 1.2, -PX * 1.2, d);
  float tx = fbv(p * 12.0 + 3.0, 6);
  float sub = exp(min(d, 0.0) / 0.03);
  float face = smoothstep(-0.3, 0.9, p.y + 0.5);
  vec3 dustC = vec3(0.018, 0.008, 0.003) * (0.3 + 1.4 * tx) + vec3(0.9, 0.4, 0.1) * sub * 0.3 * (0.4 + tx) * face;
  float rim = exp(-abs(d) / 0.005) * (0.5 + 0.9 * fbv(p * 30.0, 4));
  vec3 rimC = gold(1.15) * rim * (0.25 + 1.5 * face);
  float veil = exp(-max(d, 0.0) / 0.045) * (1.0 - inside) * 0.4 * face * (0.4 + g2);
  vec3 col = mix(bg, dustC, inside) + rimC + vec3(1.0, 0.58, 0.22) * veil;
  col += brightStars(p, 0.38, 0.22, 3.0, 0.6, 0.3) * (1.0 - inside * 0.9);
  return col;
}`;

// 3 PULSAR
PLATES[3] = /* glsl */ `
vec3 plate(vec2 p) {
  vec2 u = rot2(-0.42) * p;            // jets along u.y
  float r = length(p);
  vec3 col = vec3(0.002, 0.004, 0.012);
  col += starfield(p, 0.7, 41.0, 0.5) * 0.8;
  // the wind nebula: an ellipse of gold and red filaments, blue synchrotron haze inside
  vec2 e = rot2(0.2) * p / vec2(1.25, 0.82);
  float env = smoothstep(1.0, 0.45, length(e) + 0.15 * (fbv(p * 3.0, 4) - 0.5));
  vec2 wq = p + 0.25 * vec2(fbv(p * 2.0 + 1.0, 4) - 0.5, fbv(p * 2.0 + 7.0, 4) - 0.5);
  float fil = pow(ridge(wq * 3.2, 7), 5.0);
  float fil2 = pow(ridge(wq * 7.5 + 3.0, 5), 7.0);
  col += (vec3(1.0, 0.42, 0.10) * fil * 1.4 + vec3(1.0, 0.75, 0.35) * fil2 * 0.9) * env;
  col += vec3(0.25, 0.45, 1.0) * exp(-length(p / vec2(0.75, 0.52)) * 2.4) * 0.30 * (0.6 + 0.6 * fbv(p * 6.0, 5));
  // the equatorial torus and its wisps (inclined rings, perpendicular to the jets)
  float et = length(vec2(u.x / 0.36, u.y / 0.11));
  float wisp = 0.5 + 0.5 * sin(et * 26.0 + 4.0 * fbv(u * 8.0, 3));
  col += vec3(1.0, 0.82, 0.55) * (exp(-pow((et - 1.0) / 0.09, 2.0)) * 1.2 + exp(-pow((et - 0.55) / 0.06, 2.0)) * 0.6) * (0.5 + 0.7 * wisp);
  col += vec3(0.6, 0.75, 1.0) * exp(-et * 1.8) * 0.18 * wisp;
  // the jets: narrow, knotted, a slow helix, blue-white
  float ay = abs(u.y);
  float hel = 0.018 * sin(ay * 22.0) * ay;
  float wj = 0.004 + 0.035 * ay;
  float knots = 0.55 + 0.45 * pow(0.5 + 0.5 * sin(ay * 48.0 - 1.0), 3.0);
  float jet = exp(-pow((u.x - hel * sign(u.y)) / wj, 2.0)) * exp(-ay / 0.55) * knots * smoothstep(1.3, 0.2, ay);
  col += vec3(0.6, 0.78, 1.0) * jet * 2.0;
  // the neutron star
  col += burst(p, vec2(0.0), 1.6, 4.0, 0.42, vec3(0.75, 0.86, 1.0));
  col += brightStars(p, 0.45, 0.2, 9.0, 0.5, 0.5);
  return col;
}`;

// 4 BINARY
PLATES[4] = /* glsl */ `
float bezD(vec2 p, vec2 a, vec2 b, vec2 c, out float tt) {
  float best = 1e9; tt = 0.0;
  vec2 prev = a;
  for (int i = 1; i <= 32; i++) {
    float t = float(i) / 32.0;
    vec2 cur = mix(mix(a, b, t), mix(b, c, t), t);
    vec2 pa = p - prev, ba = cur - prev;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d = length(pa - ba * h);
    if (d < best) { best = d; tt = (float(i - 1) + h) / 32.0; }
    prev = cur;
  }
  return best;
}
vec3 plate(vec2 p) {
  vec2 G = vec2(-0.66, -0.04), C = vec2(0.78, 0.12);
  float Rg = 0.56;
  vec3 col = vec3(0.0015, 0.0025, 0.008) + vec3(0.008, 0.02, 0.06) * pow(fbv(p * 1.2 + 4.0, 5), 2.0);
  col += starfield(p, 0.7, 51.0, 0.6) * 0.8;
  vec2 dG = p - G; float rg = length(dG);
  vec2 dir = normalize(C - G);
  float pull = pow(max(0.0, dot(dG / max(rg, 1e-4), dir)), 8.0);
  float Rl = Rg * (1.0 + 0.24 * pull);
  float dd = rg - Rl;
  float inG = smoothstep(PX * 1.2, -PX * 1.2, dd);
  float mu = sqrt(max(0.0, 1.0 - pow(rg / Rl, 2.0)));
  float gran = 0.72 + 0.5 * fbv(dG * 24.0, 5) + 0.12 * fbv(dG * 80.0, 3);
  float spots = 1.0 - 0.45 * smoothstep(0.68, 0.82, fbv(dG * 6.0 + 3.0, 5));
  vec3 surf = mix(vec3(0.9, 0.16, 0.02), vec3(1.0, 0.6, 0.2), pow(mu, 0.7)) * (0.2 + 0.8 * pow(mu, 0.7)) * gran * spots * 1.7;
  col = mix(col, surf, inG);
  col += vec3(1.0, 0.36, 0.06) * (exp(-max(dd, 0.0) / 0.025) * 0.45 + exp(-max(dd, 0.0) / 0.22) * 0.1) * (1.0 - inG);
  // the stream: from the inner Lagrange point, curving into the disk
  vec2 L1 = G + dir * Rl * 0.995;
  float tt;
  float ds = bezD(p, L1, mix(L1, C, 0.5) + vec2(0.02, 0.36), C + vec2(-0.08, 0.07), tt);
  float ws = 0.012 + 0.035 * (1.0 - tt) * (1.0 - tt);
  float st = exp(-pow(ds / ws, 2.0)) * (0.55 + 0.8 * fbv(vec2(tt * 34.0, ds * 200.0), 3));
  col += gold(0.75 + 0.6 * tt) * st * 1.4 * (1.0 - inG);
  vec2 dc = rot2(0.15) * (p - C);
  float e = length(vec2(dc.x / 0.24, dc.y / 0.06));
  float th = atan(dc.y / 0.06, dc.x / 0.24);
  float sp = 0.55 + 0.45 * sin(th * 2.0 + e * 12.0);
  float diskI = smoothstep(1.05, 0.25, e) * (0.25 + 0.75 / (e * 4.0 + 0.4)) * sp;
  col += mix(vec3(1.0, 0.62, 0.28), vec3(0.75, 0.85, 1.0), smoothstep(0.7, 0.15, e)) * diskI * 1.5;
  col += burst(p, C, 1.2, 6.0, 0.3, vec3(0.7, 0.82, 1.0));
  col += brightStars(p, 0.42, 0.18, 2.0, 0.5, 0.6) * (1.0 - inG);
  return col;
}`;

// 5 RINGED PLANET, backlit
PLATES[5] = /* glsl */ `
vec3 plate(vec2 p) {
  vec2 Pc = vec2(0.32, -0.38);
  float Rp = 0.66;
  vec2 dS = normalize(vec2(-0.62, 0.78));
  vec2 S = Pc + dS * Rp * 0.99;
  vec2 d = p - Pc; float r = length(d);
  float inP = smoothstep(Rp + PX, Rp - PX, r);
  vec3 col = mix(vec3(0.001, 0.003, 0.011), vec3(0.005, 0.014, 0.045), smoothstep(-1.0, 1.0, p.y - p.x * 0.3));
  col += starfield(p, 0.6, 61.0, 0.7) * 0.75;
  col += brightStars(p, 0.5, 0.16, 4.0, 0.45, 0.7);
  vec2 rq = rot2(0.32) * d; vec2 rr = vec2(rq.x, rq.y / 0.2);
  float er = length(rr) / Rp;
  float ringlets = 0.6 + 0.2 * sin(er * 260.0) + 0.2 * sin(er * 97.0 + 1.0) + 0.3 * (fbv(vec2(er * 150.0, 0.5), 3) - 0.5);
  float band = smoothstep(1.3, 1.34, er) * (1.0 - smoothstep(2.0, 2.12, er)) * (1.0 - 0.9 * smoothstep(1.62, 1.635, er) * (1.0 - smoothstep(1.685, 1.70, er)));
  band *= 0.6 + 0.4 * smoothstep(2.05, 1.4, er);
  float fwd = exp(-length(p - S) / 0.3) * 3.5 + exp(-length(p - S) / 0.9) * 0.6 + 0.1;
  vec3 ringC = vec3(1.0, 0.76, 0.45) * band * max(ringlets, 0.0) * fwd * 0.4;
  bool front = rr.y < 0.0;
  float cosA = dot(d / max(r, 1e-4), dS);
  float out1 = r - Rp;
  float cres = pow(max(cosA, 0.0), 2.5);
  float atm = exp(-max(out1, 0.0) / 0.016) * smoothstep(-0.003, 0.0, out1) * cres;
  float atm2 = exp(-abs(out1 - 0.014) / 0.005) * pow(max(cosA, 0.0), 1.2) * 0.5;
  float scat = exp(-max(out1, 0.0) / 0.12) * pow(max(cosA, 0.0), 4.0) * 0.35;
  col = col * (1.0 - inP);
  col += vec3(1.0, 0.58, 0.2) * atm * 3.2 + vec3(0.35, 0.55, 1.0) * atm2 + vec3(1.0, 0.5, 0.15) * scat * (1.0 - inP);
  col = front ? col * (1.0 - 0.6 * band) + ringC : col + ringC * (1.0 - inP);
  col += burst(p, S, 2.0, 6.0, 0.25, vec3(1.0, 0.86, 0.6)) * (0.3 + 0.7 * (1.0 - inP));
  return col;
}`;

// 6 GLOBULAR CLUSTER
PLATES[6] = /* glsl */ `
vec3 plate(vec2 p) {
  vec2 q = p - vec2(0.1, 0.02);
  float r = length(q);
  float king = 1.0 / (1.0 + pow(r / 0.13, 2.0)) * (1.0 - smoothstep(0.6, 1.6, r));
  vec3 col = vec3(0.0015, 0.0025, 0.008);
  col += vec3(1.0, 0.7, 0.4) * (king * 0.14 + exp(-r / 0.05) * 0.4);
  float dens = clamp(king * 2.2, 0.0, 1.0);
  col += starLayer(q, 0.0058, dens * 0.95, 1.0, 0.2) * 1.3;
  col += starLayer(q, 0.0102, dens * 0.95, 2.0, 0.3) * 1.9;
  col += starLayer(q, 0.019, clamp(dens * 1.2, 0.0, 0.95), 3.0, 0.4) * 2.4;
  col += starfield(p, 0.35, 71.0, 0.5) * 0.6;
  col += brightStars(q, 0.1, 0.45 * smoothstep(0.85, 0.05, r), 6.0, 0.4, 0.5);
  col += brightStars(p, 0.45, 0.2, 8.0, 0.45, 0.6);
  return col;
}`;

// 7 COSMIC WEB
PLATES[7] = /* glsl */ `
vec3 vor(vec2 p, float seed, out float w) {
  vec2 id0 = floor(p); vec3 F = vec3(9.0); vec2 i1 = vec2(0.0), i2 = vec2(0.0);
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 id = id0 + vec2(float(i), float(j));
    vec2 c = id + 0.5 + 0.84 * (hash22(id + seed) - 0.5);
    float d = length(p - c);
    if (d < F.x) { F.z = F.y; F.y = F.x; i2 = i1; F.x = d; i1 = id; } else if (d < F.y) { F.z = F.y; F.y = d; i2 = id; } else if (d < F.z) F.z = d;
  }
  w = hash12(i1 + i2 + seed * 1.7);
  return F;
}
vec3 plate(vec2 p) {
  vec2 w = vec2(fbv(p * 1.3 + 2.0, 5), fbv(p * 1.3 + 8.0, 5)) - 0.5;
  vec2 q = p + w * 0.45;
  float wa, wb, wc;
  vec3 A = vor(q * 1.6, 1.0, wa);
  vec3 B = vor(q * 4.2 + 3.0, 7.0, wb);
  vec3 Cc = vor(q * 11.0 + 9.0, 3.0, wc);
  float eA = (A.y - A.x) / 1.6, eB = (B.y - B.x) / 4.2, eC = (Cc.y - Cc.x) / 11.0;
  float big = 0.35 + 1.1 * smoothstep(0.3, 0.7, fbv(q * 0.9 + 40.0, 4));
  float sA = (0.25 + 1.6 * wa * wa) * big, sB = (0.1 + 0.9 * wb * wb * wb) * big, sC = 0.25 * wc * wc * big;
  // the filaments: fuzzy density, made of many tiny galaxies
  float f = exp(-eA / 0.022) * sA + exp(-eB / 0.010) * sB * (0.3 + 1.2 * exp(-eA / 0.12)) + exp(-eC / 0.004) * sC * exp(-eB / 0.05);
  float knots = exp(-((A.z - A.x) / 1.6) / 0.025) * sA * 1.6 + exp(-((B.z - B.x) / 4.2) / 0.008) * sB * 0.8;
  float clump = 0.4 + 1.0 * fbv(q * 14.0, 4);
  vec3 col = vec3(0.001, 0.0025, 0.009) + vec3(0.004, 0.014, 0.045) * fbv(q * 2.0 + 5.0, 6);
  col += vec3(1.0, 0.55, 0.2) * f * 0.16 * clump + vec3(0.35, 0.5, 1.0) * exp(-eA / 0.09) * sA * 0.025;
  col += starLayer(q, 0.0042, clamp(f * 0.9, 0.0, 1.0), 13.0, 0.25) * 1.3;
  col += starLayer(q, 0.009, clamp(f * 0.6, 0.0, 1.0), 17.0, 0.25) * 1.6;
  col += gold(1.1) * knots * (0.25 + 0.4 * clump);
  col += starLayer(q, 0.006, clamp(knots, 0.0, 1.0), 23.0, 0.2) * 2.5;
  col += starfield(p, 0.2, 77.0, 0.6) * 0.35;
  return col;
}`;

// 8 SUPERNOVA REMNANT (gold)
PLATES[8] = /* glsl */ `
vec3 plate(vec2 p) {
  vec2 q = p;
  float r = length(q), th = atan(q.y, q.x);
  vec3 ang = vec3(cos(th), sin(th), 0.0);
  float Rs = 0.66 * (1.0 + 0.1 * snoise(ang * 1.3 + 2.0) + 0.04 * snoise(ang * 4.0 + 5.0));
  float rho = r / Rs;
  vec3 col = vec3(0.0015, 0.003, 0.009);
  col += starfield(p, 0.65, 91.0, 0.6) * 0.75;
  vec2 wq = q + 0.12 * vec2(fbv(q * 3.0, 4) - 0.5, fbv(q * 3.0 + 4.0, 4) - 0.5);
  float fil = pow(ridge(wq * 5.0 + 1.0, 7), 5.0);
  float fil2 = pow(ridge(wq * 13.0 + 6.0, 5), 7.0);
  float limb = rho < 1.0 ? 1.0 / sqrt(max(1.0 - rho * rho, 0.03)) : 0.0;
  float edge = smoothstep(1.0 + PX * 2.0 / Rs, 1.0 - PX * 2.0 / Rs, rho);
  float shell = smoothstep(0.55, 0.97, rho) * edge * limb * 0.22;
  col += vec3(1.0, 0.42, 0.1) * shell * (0.25 + 2.0 * fil) + vec3(1.0, 0.82, 0.5) * shell * fil2 * 1.6;
  // the inside: dim teal-blue gas, red knots of ejecta, a few bright gold filaments crossing it
  col += vec3(0.1, 0.35, 0.6) * exp(-rho * 1.8) * 0.22 * (0.4 + fbv(q * 6.0, 5)) * edge;
  float knots = pow(fbv(q * 9.0 + 3.0, 6), 7.0) * 9.0 * smoothstep(1.0, 0.5, rho);
  col += vec3(1.0, 0.25, 0.06) * knots;
  col += vec3(1.0, 0.6, 0.25) * pow(ridge(wq * 3.0 + 8.0, 6), 9.0) * smoothstep(0.9, 0.3, rho) * 0.8;
  // ejecta fingers poking past the edge
  float sec = th / 6.2831853 * 90.0;
  float sid = floor(sec), sf = fract(sec) - 0.5;
  float hk = hash11(sid * 1.7 + 3.0);
  float len = 0.04 + 0.16 * hash11(sid + 9.0);
  float wdt = 0.004 / max(r, 0.2) * 90.0 / 6.2831853;
  float finger = hk > 0.78 ? exp(-pow(sf / wdt, 2.0)) * smoothstep(1.0 + len / Rs, 0.99, rho) * smoothstep(0.96, 1.0, rho) : 0.0;
  col += vec3(1.0, 0.68, 0.32) * finger * 1.3;
  // the blast wave: a faint, broken blue haze just outside
  float bw = exp(-max(rho - 1.06, 0.0) / 0.03) * smoothstep(1.02, 1.06, rho) * smoothstep(0.45, 0.8, fbv(vec2(th * 6.0, r * 8.0), 4));
  col += vec3(0.4, 0.62, 1.0) * bw * 0.22;
  col += burst(p, vec2(0.0), 0.8, 4.0, 0.3, vec3(0.8, 0.88, 1.0));
  col += brightStars(p, 0.45, 0.2, 4.0, 0.45, 0.5);
  return col;
}`;

// 9 AURORA RIBBON
PLATES[9] = /* glsl */ `
vec3 plate(vec2 p) {
  vec3 col = mix(vec3(0.001, 0.003, 0.011), vec3(0.004, 0.009, 0.03), smoothstep(1.0, -0.8, p.y));
  col += starfield(p, 0.75, 101.0, 0.6) * 0.8;
  col += brightStars(p, 0.45, 0.2, 2.0, 0.45, 0.6);
  // a twisted ribbon of glowing gas: an S across the frame, turning edge-on and back
  float x = p.x;
  float cy = 0.08 + 0.36 * sin(x * 1.05 + 0.4) + 0.06 * sin(x * 2.7 + 1.0);
  float tw = cos(x * 1.55 + 0.35);
  float hw = 0.012 + 0.2 * abs(tw);
  float v = (p.y - cy) / hw;
  float inR = smoothstep(1.0 + PX / hw * 1.5, 1.0 - PX / hw * 1.5, abs(v));
  float stri = 0.45 + 0.9 * pow(fbv(vec2(x * 46.0 + 3.0 * v * sign(tw), v * 1.4), 4), 1.4);
  float edgeOn = 0.012 / hw;
  float face = tw > 0.0 ? 1.0 : 0.0;
  vec3 cFront = mix(vec3(1.0, 0.62, 0.2), vec3(1.0, 0.9, 0.65), pow(abs(v), 3.0));
  vec3 cBack = mix(vec3(0.75, 0.22, 0.04), vec3(1.0, 0.55, 0.2), pow(abs(v), 3.0));
  vec3 rib = mix(cBack, cFront, face) * (0.35 + 0.65 * pow(abs(v), 2.0) + 0.6 * edgeOn) * stri;
  col += rib * inR * 1.2;
  // bright rims along both edges (a thread of the clip's phosphor green on the lower one)
  float dEdge = abs(abs(v) - 1.0) * hw;
  vec3 rimC = v < 0.0 ? mix(vec3(0.71, 1.0, 0.42), vec3(1.0, 0.9, 0.6), 0.5) : vec3(1.0, 0.85, 0.55);
  col += rimC * exp(-dEdge / 0.004) * (0.6 + 0.6 * stri) * (0.6 + edgeOn);
  // a soft glow around it and auroral rays rising from its upper edge
  float out1 = max(abs(v) - 1.0, 0.0) * hw;
  col += vec3(1.0, 0.5, 0.15) * exp(-out1 / 0.05) * 0.12 * (1.0 - inR);
  float up = p.y - (cy + hw);
  float rays = pow(fbv(vec2(x * 60.0 + 4.0 * sin(x * 2.0), up * 1.5), 4), 1.8) * 1.6;
  col += vec3(1.0, 0.45, 0.1) * (up > 0.0 ? exp(-up / 0.28) * rays * 0.35 * smoothstep(0.0, 0.02, up) : 0.0);
  return col;
}`;

// 10 ECLIPSE
PLATES[10] = /* glsl */ `
vec3 plate(vec2 p) {
  vec2 C = vec2(0.0, 0.0);
  float Rm = 0.30;
  vec2 d = p - C; float r = length(d), th = atan(d.y, d.x);
  vec3 col = mix(vec3(0.001, 0.0025, 0.01), vec3(0.004, 0.01, 0.035), exp(-r * 0.8));
  col += starfield(p, 0.45, 111.0, 0.7) * 0.6;
  if (r > Rm) {
    float lr = log(r / Rm);
    vec3 a = vec3(cos(th), sin(th), 0.0);
    float s1 = 0.5 + 0.5 * snoise(vec3(a.xy * 2.5, lr * 1.2));
    float s2 = 0.5 + 0.5 * snoise(vec3(a.xy * 9.0, lr * 1.6 + 3.0));
    float s3 = 0.5 + 0.5 * snoise(vec3(a.xy * 30.0, lr * 2.4 + 7.0));
    float str = 0.35 + 0.8 * s1 * s1 + 0.45 * s2 + 0.3 * s3 * s3;
    // two big helmet streamers near the equator
    float hel = exp(-pow((sin(th - 0.25)) / 0.22, 2.0)) * pow(Rm / r, 1.2) * 0.8;
    float base = pow(Rm / r, 3.0);
    float I = base * str * 1.2 + hel * (0.5 + 0.5 * s2);
    I += exp(-(r - Rm) / 0.012) * 2.5 * (0.6 + 0.6 * s3);
    col += mix(vec3(1.0, 0.8, 0.5), vec3(0.95, 0.95, 1.0), exp(-(r - Rm) / 0.05)) * I * 0.8;
    // prominences: small red-gold arcs on the limb
    for (int k = 0; k < 3; k++) {
      float a0 = k == 0 ? 2.5 : k == 1 ? 4.15 : 5.6;
      float da = atan(sin(th - a0), cos(th - a0));
      float h = 0.035 + 0.02 * float(k);
      float arc = exp(-pow(da / 0.05, 2.0)) * exp(-pow((r - Rm - h * 0.5) / (h * 0.5), 2.0));
      arc *= 0.5 + fbv(vec2(th * 60.0, r * 80.0), 4);
      col += vec3(1.0, 0.18, 0.12) * arc * 2.4;
    }
  }
  // the moon: black, sharp
  col *= smoothstep(Rm - PX, Rm + PX, r);
  // the diamond ring: one bead of sunlight on the limb
  vec2 B = C + vec2(cos(0.78), sin(0.78)) * Rm * 1.004;
  col += burst(p, B, 2.6, 8.0, 0.2, vec3(1.0, 0.95, 0.85));
  return col;
}`;

// 11 PLANETARY NEBULA, the "eye"
PLATES[11] = /* glsl */ `
vec3 plate(vec2 p) {
  vec2 q = rot2(0.35) * p;
  vec2 e = vec2(q.x, q.y / 0.84);
  float r = length(e), th = atan(e.y, e.x);
  float rho = r / 0.52;
  vec3 col = vec3(0.0015, 0.003, 0.01);
  col += starfield(p, 0.6, 121.0, 0.6) * 0.75;
  float n = fbv(q * 5.0 + 3.0, 6);
  float ring = exp(-pow((rho - 1.0) / 0.2, 2.0)) * (0.5 + 1.0 * n);
  col += vec3(1.0, 0.36, 0.08) * ring * 1.1 + vec3(1.0, 0.7, 0.35) * exp(-pow((rho - 0.9) / 0.1, 2.0)) * n * 0.7;
  col += vec3(0.12, 0.55, 0.75) * exp(-rho * rho * 2.5) * 0.55 * (0.6 + 0.6 * fbv(q * 8.0, 4));
  // cometary knots on the inner edge: bright heads, tails pointing away from the star
  float sec = th / 6.2831853 * 260.0;
  float sid = floor(sec), sf = fract(sec) - 0.5;
  for (int k = 0; k < 2; k++) {
    float id = sid + float(k) * 1000.0;
    float h = hash11(id * 0.37 + 1.0);
    if (h < 0.35) continue;
    float rk = 0.62 + 0.3 * hash11(id + 5.0);
    float off = (hash11(id + 7.0) - 0.5) * 0.6;
    float dx = (sf - off) * 6.2831853 / 260.0 * r / 0.52;
    float dr = rho - rk;
    float head = exp(-(dx * dx + dr * dr) / (0.006 * 0.006)) * 2.0;
    float tail = dr > 0.0 ? exp(-pow(dx / 0.004, 2.0)) * exp(-dr / 0.07) * 0.6 : 0.0;
    col += vec3(1.0, 0.75, 0.4) * (head + tail) * (0.5 + h);
  }
  col += vec3(1.0, 0.5, 0.2) * exp(-pow((rho - 1.55) / 0.12, 2.0)) * 0.12 * (0.4 + fbv(q * 3.0, 4));
  col += burst(p, vec2(0.0), 0.8, 4.0, 0.0, vec3(0.75, 0.86, 1.0));
  col += brightStars(p, 0.45, 0.18, 6.0, 0.45, 0.6);
  return col;
}`;

// 12 STAR NEBULA (the motif in the sky)
PLATES[12] = /* glsl */ `
vec3 plate(vec2 p) {
  vec2 q = rot2(0.12) * (p - vec2(0.0, -0.03));
  vec2 w = vec2(fbv(q * 2.5 + 1.0, 5), fbv(q * 2.5 + 6.0, 5)) - 0.5;
  float d = sdStar5(q + w * 0.07, 0.64, 0.46) - 0.05;
  float n = fbv(q * 4.0 + w * 2.0, 7);
  float n2 = fbv(q * 14.0 + 3.0, 5);
  vec3 col = vec3(0.0015, 0.003, 0.009) + vec3(0.006, 0.018, 0.05) * pow(fbv(p * 1.5, 5), 2.0);
  col += starfield(p, 0.7, 131.0, 0.6) * 0.75;
  float inS = smoothstep(0.01, -0.06, d);
  float gas = pow(n, 2.4) * 1.6;
  float dust = smoothstep(0.5, 0.7, fbv(q * 6.0 + w * 3.0 + 9.0, 6));
  float rim = exp(-abs(d) / 0.007) * (0.35 + 1.0 * n2) + exp(-abs(d) / 0.03) * 0.25;
  float halo = exp(-max(d, 0.0) / 0.1) * 0.22 * n * (1.0 - inS);
  vec3 gasC = mix(vec3(0.7, 0.16, 0.02), vec3(1.0, 0.72, 0.32), smoothstep(0.35, 0.75, n)) * (0.15 + 1.5 * pow(n, 2.2));
  col = col * (1.0 - 0.7 * inS) + gasC * inS * (1.0 - 0.9 * dust) + gold(1.3) * rim + vec3(1.0, 0.45, 0.1) * halo;
  col += vec3(0.15, 0.4, 0.7) * inS * exp(-length(q) / 0.25) * 0.25;
  col += starLayer(q, 0.012, clamp(inS * gas, 0.0, 1.0), 4.0, 0.2) * 1.2;
  col += burst(p, vec2(0.0, 0.0), 0.6, 4.0, 0.0, vec3(1.0, 0.92, 0.75));
  col += brightStars(p, 0.42, 0.22, 3.0, 0.5, 0.5);
  return col;
}`;

const MAIN = /* glsl */ `
void main() {
  PX = 2.0 / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(2.0 * AS, 2.0);
  vec3 c = plate(p);
  fragColor = vec4(max(c, vec3(0.0)), 1.0);
}`;

/** The plates, each painted the first time it is asked for. */
export class PlateDeck {
  private rts = new Map<number, THREE.WebGLRenderTarget>();
  constructor(private renderer: THREE.WebGLRenderer) {}
  static count = PLATES.length;
  get(i: number): THREE.Texture {
    let rt = this.rts.get(i);
    if (!rt) {
      const s = Math.min(SCALE, 1.5);
      const w = Math.round(PLATE_W * s), h = Math.round(PLATE_H * s);
      rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      rt.texture.wrapS = rt.texture.wrapT = THREE.MirroredRepeatWrapping;
      const pass = new FSPass(LIB + PLATES[i]! + MAIN, { uRes: { value: new THREE.Vector2(w, h) } });
      pass.render(this.renderer, rt);
      pass.mat.dispose();
      this.rts.set(i, rt);
    }
    return rt.texture;
  }
  dispose() { for (const rt of this.rts.values()) rt.dispose(); this.rts.clear(); }
}
