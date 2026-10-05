// The night city's sky and edges: a dome with the city's light pollution on the horizon, the moon with its halo,
// stars (more of them when the power is out), dawn colours and the low sun; a cloud deck lit from below by the
// city; a distant skyline beyond the generated blocks and across the river; the river itself, reflecting.
import * as THREE from 'three';
import { CITY_GLSL, OCC_GLSL, type CityUniforms } from './city-glsl';

export function skyMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    side: THREE.BackSide, depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vD;
      void main() { vD = position; gl_Position = projectionMatrix * viewMatrix * vec4(cameraPosition + position, 1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      varying vec3 vD;
      ${OCC_GLSL}
      vec3 h33(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
      void main() {
        OCCLUDED_RETURN
        vec3 d = normalize(vD);
        float y = d.y;
        // night: deep navy overhead, the city's sodium glow low down (less when the power is out); the horizon is
        // exactly the haze colour, so distant buildings melt into it
        vec3 hz = hazeColor(uGlowK);
        vec3 hor = mix(skyHor, hz, 0.85);
        vec3 c = y > 0.0 ? mix(hor, skyTop, pow(clamp(y * 1.25, 0.0, 1.0), 0.38)) : hz;
        c += vec3(0.006, 0.002, 0.012) * exp(-abs(y - 0.18) * 8.0) * uGlowK;
        c += uHazeCol * uGlowK * 0.35 * exp(-max(y, 0.0) * 22.0);
        // stars, more of them in the blackout
        vec3 q = d * 380.0;
        vec3 cell = floor(q);
        vec3 sp = cell + 0.2 + 0.6 * h33(cell);
        float sd = length(q - sp);
        float sh = h13(cell * 0.37 + 1.7);
        float vis = mix(0.996, 0.982, 1.0 - uGlowK) ;
        float star = step(vis, sh) * smoothstep(0.09, 0.0, sd - 0.02) * (0.4 + 2.5 * pow(h13(cell + 3.1), 3.0)) * smoothstep(0.02, 0.25, y);
        c += vec3(0.85, 0.9, 1.0) * star * (1.0 - 0.75 * uGlowK) * (1.0 - uDawn);
        // the moon: a disc with seas, and its halo in the haze
        float m = dot(d, uMoonDir);
        float rad = 0.022;
        float ang = sqrt(max(2.0 * (1.0 - m), 0.0));
        vec3 mt = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0)), mb = cross(mt, uMoonDir);
        vec2 mq = vec2(dot(d, mt), dot(d, mb)) / rad;
        float disc = smoothstep(1.0, 0.96, length(mq)) * step(0.0, m);
        float seas = 0.8 + 0.1 * sin(mq.x * 4.3 + 1.0) * sin(mq.y * 3.7 + 2.0) + 0.1 * sin(mq.x * 7.9 - mq.y * 6.1 + 0.5);
        vec3 moonC = vec3(1.0, 0.97, 0.9) * 3.2 * seas * (1.0 - 0.25 * smoothstep(0.6, 1.0, length(mq)));
        c = mix(c, moonC, disc * (1.0 - 0.6 * uDawn));
        float halo = exp(-ang * 9.0) * 0.08 + exp(-ang * 40.0) * 0.18;
        c += vec3(0.75, 0.8, 0.95) * halo * (1.0 - 0.7 * uDawn);
        // dawn: a gold horizon toward the sun, pink above it, pale blue overhead; the sun's disc
        if (uDawn > 0.0) {
          float s = max(dot(d, uSunDir), 0.0);
          vec3 dz = mix(vec3(0.95, 0.55, 0.35), vec3(0.32, 0.42, 0.62), pow(clamp(y, 0.0, 1.0), 0.5));
          dz = mix(dz, vec3(1.2, 0.68, 0.32), pow(s, 6.0) * 0.8);
          dz += vec3(1.0, 0.6, 0.3) * pow(s, 60.0) * 1.5 + vec3(4.0, 3.0, 2.0) * smoothstep(0.9994, 0.9997, s);
          if (y < 0.0) dz = vec3(0.5, 0.35, 0.3);
          c = mix(c, dz, uDawn);
        }
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export function cloudMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      varying vec3 vW;
      void main() {
        vec2 p = vW.xz / 1100.0 + vec2(uTime * 0.004, uTime * 0.0018);
        float d = fbm3(p + vec2(sin(p.y * 2.1 + 1.3), cos(p.x * 1.7 + 0.4)) * 0.45);
        float a = smoothstep(0.45, 0.78, d);
        float dist = length(vW.xz - cameraPosition.xz);
        // lit from below by the city (orange), the moon on the thin edges; at dawn pink and gold
        vec3 under = uHazeCol * uGlowK * 0.6 * (0.35 + 0.8 * d) + uMoonCol * 0.6 * (1.0 - a) + skyTop;
        vec3 c = mix(under, mix(vec3(0.75, 0.45, 0.4), vec3(1.0, 0.7, 0.45), d), uDawn);
        c = mix(c, vec3(1.0, 0.7, 0.25) * 0.12 * (0.4 + d), gold * 0.6);
        a *= smoothstep(14000.0, 3000.0, dist) * 0.6;
        gl_FragColor = vec4(c, a);
      }`,
  });
}

/** A distant skyline drawn on a band (a ring around the city, or a strip across the river). */
export function skylineMaterial(U: CityUniforms, o: { ring: boolean; tall: number; seed: number }) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vW; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      varying vec3 vW; varying vec2 vUv;
      ${OCC_GLSL}
      const float TALL = ${o.tall.toFixed(1)}, SEED = ${o.seed.toFixed(1)};
      void main() {
        OCCLUDED_RETURN
        float u = ${o.ring ? 'atan(vW.z, vW.x + 1e-4) * 5200.0' : 'vW.z'};
        float y = vW.y;
        // buildings: runs of widths, heights clustered
        float cw = 26.0 + 30.0 * h11(floor(u / 60.0) + SEED);
        float id = floor(u / cw);
        float cl = vnoise(vec2(u / 900.0, SEED));
        float hgt = 18.0 + TALL * pow(h11(id * 1.7 + SEED), 3.0) * (0.3 + cl) + 30.0 * h11(id + SEED * 3.0);
        if (y > hgt) discard;
        float fx = fract(u / 3.2), fy = fract(y / 3.4);
        float win = step(0.3, fx) * step(fx, 0.75) * step(0.3, fy) * step(fy, 0.8);
        float lit = step(h12(vec2(floor(u / 3.2), floor(y / 3.4)) + SEED), 0.28 * (0.6 + 0.8 * h11(id)));
        float p = power(vW.xz);
        vec3 wc = mix(vec3(1.0, 0.66, 0.36), vec3(0.8, 0.88, 1.0), h11(id * 3.3));
        vec3 hz = hazeColor(p);
        vec3 c = hz * (0.45 + 0.35 * smoothstep(60.0, 0.0, y)) + wc * win * lit * 0.9 * p;
        c += vec3(1.0, 0.1, 0.05) * step(hgt - 1.0, y) * step(0.7, h11(id * 9.1)) * step(0.5, fract(uTime * 0.5 + h11(id))) * 2.0 * step(80.0, hgt);
        c = mix(c, vec3(0.3, 0.25, 0.25) * 0.25 + vec3(0.04, 0.03, 0.04) * win * lit, uDawn);
        vec2 fk = fogK(vW);
        c = mix(c, hz, clamp(fk.x, 0.0, 0.6));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}

export function waterMaterial(U: CityUniforms) {
  return new THREE.ShaderMaterial({
    uniforms: U as unknown as Record<string, THREE.IUniform>,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: /* glsl */ `
      ${CITY_GLSL}
      uniform sampler2D uMirror; uniform mat4 uMirrorMat;
      varying vec3 vW;
      ${OCC_GLSL}
      void main() {
        OCCLUDED_RETURN
        vec2 xz = vW.xz;
        float p = power(xz);
        vec2 n = vec2(vnoise(xz * 0.21 + vec2(uTime * 0.35, 0.0)), vnoise(xz * 0.17 + 9.0 - vec2(0.0, uTime * 0.3))) - 0.5;
        vec3 V = normalize(vW - cameraPosition);
        float fres = 0.03 + 0.97 * pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
        vec3 refl;
        if (uMirrorOn > 0.5) {
          vec4 mp = uMirrorMat * vec4(vW.x, 0.0, vW.z, 1.0);
          vec2 uv = mp.xy / max(mp.w, 1e-3);
          refl = vec3(0.0);
          refl = (texture2D(uMirror, uv + n * 0.03 + vec2(0.0, -0.008)).rgb + texture2D(uMirror, uv + n * 0.03 + vec2(0.0, 0.008)).rgb) * 0.5;
        } else refl = envRefl(reflect(V, normalize(vec3(n.x * 0.15, 1.0, n.y * 0.15))), 0.0);
        vec3 c = vec3(0.004, 0.006, 0.009) + refl * fres * 0.9 + ambient(vec3(0.0, 1.0, 0.0)) * 0.05;
        c = cityFog(c, vW, p);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
}
