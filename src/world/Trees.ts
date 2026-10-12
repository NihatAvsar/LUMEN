import { BufferGeometry, ConeGeometry, CircleGeometry, Group, Matrix4, Quaternion, SphereGeometry, Vector3, Euler } from 'three';
import { Rng } from '../core/math';
import { taperedTube, blob, merge } from './geometry';
import { buildChunks, InstanceItem } from './instancing';
import { getMaterials, regionColor } from './palette';
import { CLEARING_RADIUS, LAKE, SEED_SPOTS, SKY_STAIR_SEED } from '../config';
import type { Heightfield } from './Heightfield';
import type { Colliders } from './Colliders';

interface Variant {
  parts: { bark?: BufferGeometry; leaf?: BufferGeometry; cap?: BufferGeometry; stem?: BufferGeometry };
  trunkR: number;
  trunkH: number;
}

function glowTree(rng: Rng): Variant {
  const h = rng.range(7, 11);
  const lx = rng.range(-1, 1) * 0.9, lz = rng.range(-1, 1) * 0.9;
  const pts = [
    new Vector3(0, -0.5, 0),
    new Vector3(lx * 0.15 + rng.range(-0.3, 0.3), h * 0.33, lz * 0.15 + rng.range(-0.3, 0.3)),
    new Vector3(lx * 0.55, h * 0.68, lz * 0.55),
    new Vector3(lx, h, lz),
  ];
  const r0 = rng.range(0.32, 0.48);
  const bark: BufferGeometry[] = [taperedTube(pts, r0, r0 * 0.3, 18, 8, 1.4)];
  const leaves: BufferGeometry[] = [];
  const nb = rng.int(3, 5);
  for (let i = 0; i < nb; i++) {
    const t = rng.range(0.5, 0.85);
    const s = pts[1].clone().lerp(pts[2], (t - 0.33) / 0.35).add(new Vector3(0, 0, 0));
    s.y = h * t;
    const a = (i / nb) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const len = rng.range(2.4, 4.4);
    const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
    const m = s.clone().addScaledVector(dir, len * 0.5).add(new Vector3(0, len * 0.35, 0));
    const e = s.clone().addScaledVector(dir, len).add(new Vector3(0, len * 0.65, 0));
    bark.push(taperedTube([s, m, e], r0 * 0.38, r0 * 0.12, 8, 6));
    const b = blob(rng.range(1.5, 2.5), 2, rng.range(0, 100), 0.3, 0.72);
    b.translate(e.x, e.y + 0.4, e.z);
    leaves.push(b);
  }
  const top = blob(rng.range(2.3, 3.2), 2, rng.range(0, 100), 0.28, 0.75);
  top.translate(lx, h + 0.9, lz);
  leaves.push(top);
  return { parts: { bark: merge(bark), leaf: merge(leaves) }, trunkR: r0, trunkH: h };
}

function spireTree(rng: Rng): Variant {
  const h = rng.range(11, 16);
  const pts = [
    new Vector3(0, -0.5, 0),
    new Vector3(rng.range(-0.2, 0.2), h * 0.5, rng.range(-0.2, 0.2)),
    new Vector3(rng.range(-0.3, 0.3), h, rng.range(-0.3, 0.3)),
  ];
  const r0 = rng.range(0.3, 0.42);
  const bark = taperedTube(pts, r0, r0 * 0.25, 16, 7, 1.2);
  const leaves: BufferGeometry[] = [];
  const layers = rng.int(5, 7);
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = h * (0.3 + t * 0.68);
    const r = (1 - t) * 2.9 + 0.7;
    const c = new ConeGeometry(r, r * 1.25, 9, 1, false);
    c.rotateY(rng.range(0, Math.PI));
    c.translate(pts[1].x * (1 - t) + pts[2].x * t, y, pts[1].z * (1 - t) + pts[2].z * t);
    leaves.push(c);
  }
  return { parts: { bark, leaf: merge(leaves) }, trunkR: r0, trunkH: h };
}

function giantMushroom(rng: Rng): Variant {
  const h = rng.range(4.5, 8.5);
  const bx = rng.range(-1, 1) * 0.8, bz = rng.range(-1, 1) * 0.8;
  const pts = [new Vector3(0, -0.4, 0), new Vector3(bx * 0.4, h * 0.5, bz * 0.4), new Vector3(bx, h, bz)];
  const r0 = rng.range(0.35, 0.6);
  const stem = taperedTube(pts, r0, r0 * 0.7, 14, 10, 0.9);
  const capR = rng.range(2.0, 3.6);
  const cap = new SphereGeometry(capR, 24, 8, 0, Math.PI * 2, 0, Math.PI * 0.45);
  cap.scale(1, 0.55, 1);
  cap.translate(bx, h - 0.2, bz);
  const gills = new CircleGeometry(capR * 0.97, 24);
  gills.rotateX(Math.PI / 2);
  gills.translate(bx, h - 0.2 + capR * 0.55 * Math.cos(Math.PI * 0.45) - 0.02, bz);
  return { parts: { stem, cap: merge([cap, gills]) }, trunkR: r0, trunkH: h };
}

export interface TreeResult {
  group: Group;
  count: number;
}

export function createTrees(hf: Heightfield, colliders: Colliders, rng: Rng, density: number): TreeResult {
  const mats = getMaterials();
  const variants: { kind: 'glow' | 'spire' | 'mush'; v: Variant }[] = [];
  for (let i = 0; i < 4; i++) variants.push({ kind: 'glow', v: glowTree(rng) });
  for (let i = 0; i < 3; i++) variants.push({ kind: 'spire', v: spireTree(rng) });
  for (let i = 0; i < 3; i++) variants.push({ kind: 'mush', v: giantMushroom(rng) });

  const items: { parts: Map<string, InstanceItem[]> }[] = variants.map(() => ({ parts: new Map() }));
  const placed: { x: number; z: number }[] = [];
  const target = Math.floor(330 * density);
  const nrm = new Vector3();
  const grove = SEED_SPOTS[1];
  const stair = SEED_SPOTS[SKY_STAIR_SEED];
  let attempts = 0;

  while (placed.length < target && attempts < target * 40) {
    attempts++;
    const x = rng.range(-195, 195), z = rng.range(-195, 195);
    const r = Math.hypot(x, z);
    if (r < CLEARING_RADIUS + 6 || r > 192) continue;
    const h = hf.height(x, z);
    if (h > 34) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.2) continue;
    if (SEED_SPOTS.some((s) => Math.hypot(x - s.x, z - s.z) < 11)) continue;
    if (Math.hypot(x - stair.x, z - stair.z) < 16) continue;
    hf.normalAt(x, z, nrm);
    if (nrm.y < 0.8) continue;
    const dGrove = Math.hypot(x - grove.x, z - grove.z);
    const minD = dGrove < 40 ? 5 : 6.5;
    if (placed.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD)) continue;
    if (!colliders.isFree(x, z, 2)) continue;

    let kind: 'glow' | 'spire' | 'mush';
    const roll = rng.next();
    if (dGrove < 40) kind = roll < 0.7 ? 'mush' : 'glow';
    else if (r > 140) kind = roll < 0.7 ? 'spire' : 'glow';
    else kind = roll < 0.5 ? 'glow' : roll < 0.82 ? 'spire' : 'mush';

    const candidates = variants.map((v, i) => ({ v, i })).filter((c) => c.v.kind === kind);
    const pick = rng.pick(candidates);
    const s = rng.range(0.8, 1.35) * (kind === 'mush' && dGrove < 40 ? rng.range(1, 1.5) : 1);
    const m = new Matrix4().compose(
      new Vector3(x, h - 0.2, z),
      new Quaternion().setFromEuler(new Euler(rng.range(-0.04, 0.04), rng.range(0, Math.PI * 2), rng.range(-0.04, 0.04))),
      new Vector3(s, s, s),
    );
    const color = regionColor(x, z, rng.next());
    for (const part of Object.keys(pick.v.v.parts)) {
      let arr = items[pick.i].parts.get(part);
      if (!arr) items[pick.i].parts.set(part, (arr = []));
      arr.push({ matrix: m, color });
    }
    placed.push({ x, z });
    colliders.add({ x, z, r: pick.v.v.trunkR * s + 0.25, bottom: h - 2, top: h + pick.v.v.trunkH * s * 0.8, walkable: false });
  }

  const group = new Group();
  variants.forEach((v, i) => {
    for (const [part, list] of items[i].parts) {
      const geo = (v.v.parts as Record<string, BufferGeometry>)[part];
      const mat = (mats as unknown as Record<string, import('three').Material>)[part];
      group.add(buildChunks(geo, mat, list, { castShadow: true, receiveShadow: part !== 'leaf', name: 'tree-' + part }));
    }
  });
  return { group, count: placed.length };
}
