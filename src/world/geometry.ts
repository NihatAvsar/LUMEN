import { BufferGeometry, CatmullRomCurve3, Float32BufferAttribute, IcosahedronGeometry, Vector3 } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
import { mulberry32 } from '../core/math';

const n3 = createNoise3D(mulberry32(99));

/** Tube along a smooth curve whose radius tapers from r0 to r1. */
export function taperedTube(points: Vector3[], r0: number, r1: number, segments = 16, radial = 8, flare = 0) {
  const curve = new CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segments, false);
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    let r = r0 + (r1 - r0) * Math.pow(t, 0.8);
    r *= 1 + flare * Math.pow(1 - t, 6);
    const N = frames.normals[i];
    const B = frames.binormals[i];
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      n.set(c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z);
      const bump = 1 + n3(p.x * 0.8 + c, p.y * 0.8, p.z * 0.8 + s) * 0.12;
      pos.push(p.x + n.x * r * bump, p.y + n.y * r * bump, p.z + n.z * r * bump);
      nrm.push(n.x, n.y, n.z);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** Noise-displaced icosphere blob. */
export function blob(radius: number, detail: number, seed: number, amp = 0.25, squashY = 1, freq = 1.2) {
  let g: BufferGeometry = new IcosahedronGeometry(radius, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const pos = g.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.clone().normalize();
    const k = 1 + n3(d.x * freq + seed, d.y * freq, d.z * freq - seed) * amp + n3(d.x * 3 + seed, d.y * 3, d.z * 3) * amp * 0.35;
    v.multiplyScalar(k);
    v.y *= squashY;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Normalize attributes so geometries can be merged. */
export function prep(g: BufferGeometry) {
  let out = g.index ? g.toNonIndexed() : g;
  if (out.attributes.uv) out.deleteAttribute('uv');
  if (!out.attributes.normal) out.computeVertexNormals();
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  }
  return out;
}

export function merge(geos: BufferGeometry[]) {
  const m = mergeGeometries(geos.map(prep), false);
  if (!m) throw new Error('merge failed');
  return m;
}
