// Recurring props: glow-in-the-dark stars, glow sticks, simple figures.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Rounded n-point star outline in the XY plane, outer radius 1. */
export function starShape(points = 5, inner = 0.46, round = 0.14) {
  const v: THREE.Vector2[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / points;
    const r = i % 2 === 0 ? 1 : inner;
    v.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  const sh = new THREE.Shape();
  const n = v.length;
  for (let i = 0; i < n; i++) {
    const p = v[i]!, a = v[(i - 1 + n) % n]!, b = v[(i + 1) % n]!;
    const k = i % 2 === 0 ? round : round * 0.5;
    const p0 = p.clone().lerp(a, k), p1 = p.clone().lerp(b, k);
    if (i === 0) sh.moveTo(p0.x, p0.y);
    else sh.lineTo(p0.x, p0.y);
    sh.quadraticCurveTo(p.x, p.y, p1.x, p1.y);
  }
  sh.closePath();
  return sh;
}

/** Plastic sticker star: thin, bevelled, facing +z, outer radius 1. */
export function starGeometry(depth = 0.12, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(starShape(), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Glow stick along +y, centred: the light-filled tube (group 0) and the two plastic end caps (group 1). */
export function glowStickGeometry(length = 1, radius = 0.045, radial = 10) {
  const body = new THREE.CapsuleGeometry(radius, length - 2 * radius, 3, radial);
  body.deleteAttribute('uv');
  const capH = length * 0.07;
  const caps = [-1, 1].map((s) => {
    const c = new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, capH, radial);
    c.deleteAttribute('uv');
    c.translate(0, s * (length / 2 - capH / 2), 0);
    return c;
  });
  const g = mergeGeometries([body, mergeGeometries(caps, false)!], true)!;
  return g;
}

/** A simple standing figure (torso, head, limbs), about 1.75 tall, feet at y = 0, facing +z. */
export function figureGeometry(armsUp = 0) {
  const parts: THREE.BufferGeometry[] = [];
  const cap = (r: number, len: number, x: number, y: number, z: number, rz = 0, rx = 0) => {
    const g = new THREE.CapsuleGeometry(r, len, 3, 8);
    g.deleteAttribute('uv');
    g.rotateX(rx);
    g.rotateZ(rz);
    g.translate(x, y, z);
    parts.push(g);
  };
  cap(0.17, 0.42, 0, 1.12, 0); // torso
  const head = new THREE.SphereGeometry(0.13, 12, 8);
  head.deleteAttribute('uv');
  head.translate(0, 1.6, 0);
  parts.push(head);
  cap(0.07, 0.62, -0.1, 0.42, 0); // legs
  cap(0.07, 0.62, 0.1, 0.42, 0);
  // arms: hanging (armsUp 0) to raised (armsUp 1)
  for (const s of [-1, 1]) {
    const a = THREE.MathUtils.lerp(0.12, Math.PI * 0.92, armsUp) * s;
    const L = 0.56;
    const sx = 0.23 * s, sy = 1.36;
    cap(0.055, L, sx + Math.sin(a) * (L / 2 + 0.05), sy - Math.cos(a) * (L / 2 + 0.05), 0, a);
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}
