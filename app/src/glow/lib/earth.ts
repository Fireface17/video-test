// The night Earth, built to hold up from a whole-disc view down to a few hundred kilometres: 4096 px maps from the
// three.js examples (NASA Blue Marble / Black Marble derived, see app/public/textures/earth/CREDITS.md):
//   earth_day_4096.jpg                    the surface (seen by moonlight only: cold, faint, with relief)
//   earth_night_4096.jpg                  city lights at real density (Black Marble)
//   earth_bump_roughness_clouds_4096.jpg  R relief, G roughness (low = water), B clouds
// Surface: moonlit relief from the bump map, a moon glint on the sea, city lights in their own colours with a
// soft light-pollution glow and, close up, a breakup into single lights (only where a texel is bigger than a pixel,
// so it never shimmers from afar). Clouds: their own shell, lit by the moon and from below by the cities. Air: an
// analytic limb (the ray's closest approach to the planet: a thin dense blue band hugging the limb) plus the green
// airglow line ~100 km up, the way it looks from orbit at night. Optional dawn on the terminator.
// City lights can "wake" in a wave spreading from a point (`wake(dir, angle)`).
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
let maps: Promise<THREE.Texture[]> | null = null;
function loadMaps() {
  maps ??= Promise.all(['earth_day_4096.jpg', 'earth_night_4096.jpg', 'earth_bump_roughness_clouds_4096.jpg'].map(async (f, i) => {
    const t = await loader.loadAsync(`textures/earth/${f}`);
    t.colorSpace = i < 2 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 16;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  }));
  return maps;
}

const COMMON = /* glsl */ `
float eh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float evn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(eh(i), eh(i + vec2(1, 0)), f.x), mix(eh(i + vec2(0, 1)), eh(i + vec2(1, 1)), f.x), f.y); }
`;

export class Earth extends THREE.Group {
  surface!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  clouds!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  air!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(public radius = 6.371) { super(); }

  async init() {
    const [day, night, brc] = await loadMaps();
    const R = this.radius;
    const moon = new THREE.Vector3(0.3, 0.6, 0.75).normalize();
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(R, 256, 128), new THREE.ShaderMaterial({
      uniforms: {
        day: { value: day }, night: { value: night }, brc: { value: brc },
        moon: { value: moon }, sun: { value: new THREE.Vector3(-1, 0, 0) }, dawn: { value: 0 },
        cityGain: { value: 1 }, moonK: { value: 1 },
        wakeDir: { value: new THREE.Vector3(0, 1, 0) }, wakeAngle: { value: 4 }, wakeSoft: { value: 0.08 },
        t: { value: 0 }, cloudRot: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vObjN; varying vec3 vW; varying vec3 vN0; varying vec3 vE; varying vec3 vNo;
        void main() {
          vUv = uv; vObjN = normalize(position);
          vec3 on = vObjN, eO = normalize(cross(vec3(0.0, 1.0, 0.0), on) + vec3(1e-5, 0.0, 0.0));
          vN0 = mat3(modelMatrix) * on; vE = mat3(modelMatrix) * eO; vNo = mat3(modelMatrix) * cross(on, eO);
          vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D day, night, brc; uniform vec3 moon, sun, wakeDir; uniform float dawn, cityGain, moonK, wakeAngle, wakeSoft, t, cloudRot;
        varying vec2 vUv; varying vec3 vObjN; varying vec3 vW; varying vec3 vN0; varying vec3 vE; varying vec3 vNo;
        void main() {
          vec3 on = normalize(vObjN);
          vec3 N0 = normalize(vN0);
          vec3 V = normalize(cameraPosition - vW);
          // relief: the bump map's gradient on the sphere's east / north frame
          vec2 tx = vec2(1.0 / 4096.0, 1.0 / 2048.0);
          float hC = texture2D(brc, vUv).r;
          float hE = texture2D(brc, vUv + vec2(tx.x, 0.0)).r, hN = texture2D(brc, vUv + vec2(0.0, tx.y)).r;
          vec3 N = normalize(N0 - 5.0 * ((hE - hC) * -normalize(vE) + (hN - hC) * normalize(vNo)));
          vec4 m = texture2D(brc, vUv);
          float land = smoothstep(0.12, 0.3, m.g);
          vec3 d = texture2D(day, vUv).rgb;
          // the moon: cold, faint light; relief on land, a glint (with wave glitter) on the sea
          float ml = max(dot(N, moon), 0.0);
          vec3 moonC = vec3(0.045, 0.06, 0.1) * moonK;
          vec3 c = d * moonC * (0.15 + 1.2 * ml) * mix(0.6, 1.0, land);
          vec2 fp = fwidth(vUv) * vec2(4096.0, 2048.0);
          float close = 1.0 - smoothstep(0.6, 2.0, max(fp.x, fp.y));
          vec3 Ns = normalize(N0 + close * 0.04 * vec3(evn(vUv * 9000.0) - 0.5, evn(vUv * 9000.0 + 7.0) - 0.5, 0.0));
          vec3 hv = normalize(moon + V);
          float gl = max(dot(Ns, hv), 0.0);
          c += (vec3(0.11, 0.14, 0.24) * pow(gl, 900.0) * 1.2 + vec3(0.006, 0.009, 0.02) * pow(gl, 60.0)) * (1.0 - land) * moonK;
          // the cities: Black Marble in its own colours; a soft glow of light pollution; close up, single lights
          vec3 L = pow(texture2D(night, vUv).rgb, vec3(2.0));
          vec3 Lglow = pow(texture2D(night, vUv, 3.0).rgb, vec3(2.0));
          float br = 0.35 + 1.3 * pow(evn(vUv * vec2(16384.0, 8192.0)), 2.5) * (0.6 + 0.8 * evn(vUv * vec2(3000.0, 1500.0)));
          L *= mix(1.0, br, close);
          float ang = acos(clamp(dot(on, normalize(wakeDir)), -1.0, 1.0));
          float awake = 1.0 - smoothstep(wakeAngle - wakeSoft, wakeAngle, ang);
          float fq = (ang - wakeAngle) / max(wakeSoft, 1e-3);
          float front = exp(-fq * fq) * step(0.001, wakeAngle);
          // under thick cloud the lights are dimmed and spread
          float cl = texture2D(brc, vUv + vec2(cloudRot, 0.0)).b;
          vec3 city = (L * 5.5 + Lglow * 1.1) * mix(1.0, 0.35, smoothstep(0.3, 0.9, cl));
          c += city * cityGain * awake;
          c += vec3(1.0, 0.7, 0.35) * pow(max(L.r, 0.0), 0.6) * front * 2.5 * cityGain;
          // dawn: the day side creeping in along the terminator
          float sl = dot(N0, normalize(sun));
          c = mix(c, d * vec3(1.0, 0.8, 0.62) * (0.2 + 0.8 * max(dot(N, normalize(sun)), 0.0)), smoothstep(-0.04, 0.2, sl) * dawn);
          float sq = sl / 0.06;
          c += vec3(1.0, 0.42, 0.12) * exp(-sq * sq) * 0.3 * dawn;
          // looking through more air toward the limb: a blue veil
          float mu = max(dot(N0, V), 0.0);
          c = mix(c, vec3(0.01, 0.025, 0.08) * moonK + c * 0.6, (1.0 - smoothstep(0.0, 0.35, mu)) * 0.55);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.004, 192, 96), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { brc: { value: brc }, night: { value: night }, moon: { value: moon }, k: { value: 1 }, rot: { value: 0 }, moonK: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: COMMON + /* glsl */ `
        uniform sampler2D brc, night; uniform vec3 moon; uniform float k, rot, moonK;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main() {
          vec2 uv = vUv + vec2(rot, 0.0);
          float a = texture2D(brc, uv).b;
          vec2 fp = fwidth(vUv) * vec2(4096.0, 2048.0);
          float close = 1.0 - smoothstep(0.6, 2.0, max(fp.x, fp.y));
          a *= mix(1.0, 0.55 + 0.9 * evn(vUv * vec2(20000.0, 10000.0)), close * 0.6);
          a = smoothstep(0.08, 0.85, a);
          float ml = max(dot(normalize(vN), moon), 0.0);
          vec3 below = pow(texture2D(night, vUv, 4.0).rgb, vec3(2.0));
          vec3 c = vec3(0.09, 0.11, 0.17) * (0.12 + ml) * moonK + below * 1.4;
          float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0);
          gl_FragColor = vec4(c, a * 0.9 * k * smoothstep(0.0, 0.12, mu));
        }`,
    }));
    this.air = new THREE.Mesh(new THREE.SphereGeometry(R * 1.03, 160, 80), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      uniforms: { R: { value: R }, ctr: { value: new THREE.Vector3() }, color: { value: new THREE.Color(0.1, 0.26, 1.0) }, k: { value: 1 }, sun: { value: new THREE.Vector3(-1, 0, 0) }, dawn: { value: 0 }, glowK: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color, sun, ctr; uniform float k, dawn, R, glowK;
        varying vec3 vW;
        void main() {
          vec3 ro = cameraPosition, rd = normalize(vW - cameraPosition);
          vec3 oc = ctr - ro;
          float tc = dot(oc, rd);
          float dmin = length(oc - rd * tc);           // the ray's closest approach to the centre
          float h = (dmin - R) / R;                     // its altitude (fraction of R)
          float hit = step(dmin, R) * step(0.0, tc);    // the ray meets the ground
          vec3 c = vec3(0.0);
          if (hit < 0.5) {
            // the limb: dense air low down, a thin bright band, a faint wide halo
            c += color * (exp(-h / 0.0018) * 1.4 + exp(-h / 0.008) * 0.18);
            // airglow: the thin green line ~100 km up
            c += vec3(0.25, 0.9, 0.35) * exp(-pow((h - 0.0155) / 0.0006, 2.0)) * 0.16 * glowK;
            vec3 p = ro + rd * tc;
            float s = dot(normalize(p - ctr), normalize(sun));
            c += vec3(1.0, 0.5, 0.18) * exp(-h / 0.006) * smoothstep(-0.2, 0.3, s) * dawn * 2.0;
          } else {
            // over the disc, toward the limb: the haze over the ground thickens
            vec3 pg = ro + rd * (tc - sqrt(max(R * R - dmin * dmin, 0.0)));
            float mu = max(dot(normalize(pg - ctr), -rd), 0.0);
            c += color * 0.12 * pow(1.0 - mu, 6.0);
          }
          gl_FragColor = vec4(c * k, 1.0);
        }`,
    }));
    this.add(this.surface, this.clouds, this.air);
    this.surface.onBeforeRender = () => {
      this.surface.getWorldPosition(this.air.material.uniforms.ctr!.value as THREE.Vector3);
    };
  }

  /** City lights awake within `angle` (rad) of the surface direction `dir` (object space). */
  wake(dir: THREE.Vector3, angle: number, soft = 0.08) {
    const u = this.surface.material.uniforms;
    (u.wakeDir!.value as THREE.Vector3).copy(dir);
    u.wakeAngle!.value = angle;
    u.wakeSoft!.value = soft;
  }

  set time(t: number) {
    this.surface.material.uniforms.t!.value = t;
    this.clouds.material.uniforms.rot!.value = t * 0.0006;
    this.surface.material.uniforms.cloudRot!.value = t * 0.0006;
    this.updateMatrixWorld(true);
    this.surface.getWorldPosition(this.air.material.uniforms.ctr!.value as THREE.Vector3);
    this.air.material.uniforms.R!.value = this.radius * this.scale.x;
  }
}
