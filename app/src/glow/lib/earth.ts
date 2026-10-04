// The night Earth seen from space: dark moonlit continents, city lights (textures from the three.js
// examples, see app/public/textures/earth/CREDITS.md), a cloud shell and a thin blue atmosphere rim with an
// optional dawn arc. City lights can "wake" in a wave spreading from a point (`wake(dir, angle)`).
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
let maps: Promise<THREE.Texture[]> | null = null;
function loadMaps() {
  maps ??= Promise.all(['earth_atmos_2048.jpg', 'earth_lights_2048.png', 'earth_clouds_1024.png'].map(async (f) => {
    const t = await loader.loadAsync(`textures/earth/${f}`);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }));
  return maps;
}

export class Earth extends THREE.Group {
  surface!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  clouds!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  air!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(public radius = 6.371) { super(); }

  async init() {
    const [day, lights, clouds] = await loadMaps();
    const R = this.radius;
    this.surface = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), new THREE.ShaderMaterial({
      uniforms: {
        day: { value: day }, lights: { value: lights },
        moon: { value: new THREE.Vector3(0.3, 0.6, 0.75).normalize() },
        sun: { value: new THREE.Vector3(-1, 0, 0) }, dawn: { value: 0 },
        cityGain: { value: 1 }, cityTint: { value: new THREE.Color(1.0, 0.62, 0.28) },
        wakeDir: { value: new THREE.Vector3(0, 1, 0) }, wakeAngle: { value: 4 }, wakeSoft: { value: 0.08 },
        t: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vObjN; varying vec3 vV;
        void main() {
          vUv = uv; vObjN = normalize(position);
          vec4 w = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - w.xyz);
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D day, lights; uniform vec3 moon, sun, cityTint, wakeDir; uniform float dawn, cityGain, wakeAngle, wakeSoft, t;
        varying vec2 vUv; varying vec3 vN; varying vec3 vObjN; varying vec3 vV;
        float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec3 d = texture2D(day, vUv).rgb; d = pow(d, vec3(2.2));
          float land = smoothstep(0.03, 0.09, d.g + d.r * 0.5 - d.b * 0.4);
          // moonlit: faint cold continents, a moon glint on the sea
          float ml = max(dot(vN, moon), 0.0);
          vec3 c = d * vec3(0.03, 0.045, 0.09) * (0.2 + ml);
          vec3 hv = normalize(moon + vV);
          c += vec3(0.06, 0.08, 0.14) * pow(max(dot(vN, hv), 0.0), 60.0) * (1.0 - land) * 0.6;
          // city lights, waking in a wave from wakeDir
          float L = texture2D(lights, vUv).r;
          float ang = acos(clamp(dot(vObjN, normalize(wakeDir)), -1.0, 1.0));
          float awake = 1.0 - smoothstep(wakeAngle - wakeSoft, wakeAngle, ang);
          float fq = (ang - wakeAngle) / max(wakeSoft, 1e-3);
          float front = exp(-fq * fq) * step(0.001, wakeAngle);
          float tw = 0.85 + 0.15 * h(floor(vUv * 2048.0) + floor(t * 6.0));
          c += cityTint * (pow(L, 1.6) * 3.2 + pow(L, 3.0) * 4.0) * cityGain * awake * tw;
          c += cityTint * pow(L, 0.8) * front * 3.0 * cityGain;
          // dawn: the day side creeping in along the terminator
          float sl = dot(vN, normalize(sun));
          c = mix(c, d * vec3(1.0, 0.75, 0.55) * 0.9, smoothstep(-0.05, 0.25, sl) * dawn);
          float sq = sl / 0.07;
          c += vec3(1.0, 0.45, 0.15) * exp(-sq * sq) * 0.25 * dawn;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }));
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(R * 1.008, 128, 64), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: clouds }, lights: { value: lights }, moon: { value: new THREE.Vector3(0.3, 0.6, 0.75).normalize() }, k: { value: 1 }, rot: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN;
        void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map, lights; uniform vec3 moon; uniform float k, rot;
        varying vec2 vUv; varying vec3 vN;
        void main() {
          vec2 uv = vUv + vec2(rot, 0.0);
          vec4 cm = texture2D(map, uv);
          float a = min(cm.a, cm.r); // (white clouds in alpha, or grey clouds on opaque black)
          float L = texture2D(lights, vUv).r;
          vec3 c = vec3(0.07, 0.09, 0.16) * (0.3 + max(dot(vN, moon), 0.0)) + vec3(1.0, 0.6, 0.3) * L * 0.35;
          gl_FragColor = vec4(c, a * 0.6 * k);
        }`,
    }));
    this.air = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 96, 48), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      uniforms: { color: { value: new THREE.Color(0.12, 0.3, 1.0) }, k: { value: 1 }, sun: { value: new THREE.Vector3(-1, 0, 0) }, dawn: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color, sun; uniform float k, dawn;
        varying vec3 vN; varying vec3 vV; varying vec3 vW;
        void main() {
          float f = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
          float rim = pow(f, 5.0) * 1.4 + pow(f, 14.0) * 2.0;
          vec3 c = color * rim;
          float s = dot(normalize(vW), normalize(sun));
          c += vec3(1.0, 0.5, 0.18) * rim * smoothstep(-0.2, 0.3, s) * dawn * 2.0;
          gl_FragColor = vec4(c * k, 1.0);
        }`,
    }));
    this.add(this.surface, this.clouds, this.air);
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
    this.clouds.material.uniforms.rot!.value = t * 0.0015;
  }
}
