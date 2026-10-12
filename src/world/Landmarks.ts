import { BoxGeometry, Euler, Group, Matrix4, Quaternion, Vector3, BufferGeometry } from 'three';
import { Rng } from '../core/math';
import { blob, merge } from './geometry';
import { buildChunks, InstanceItem } from './instancing';
import { getMaterials, GLOW_COLORS } from './palette';
import { crystalCluster } from './Flora';
import { SEED_SPOTS, SKY_STAIR_SEED, CLEARING_RADIUS, LAKE } from '../config';
import type { Heightfield } from './Heightfield';
import type { Colliders } from './Colliders';

function monolithGeo() {
  const g = new BoxGeometry(1.5, 5, 0.85, 2, 6, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 - (y + 2.5) / 5 * 0.25;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
    if (y > 2.4) p.setY(i, y + Math.sin(p.getX(i) * 3) * 0.15);
  }
  g.computeVertexNormals();
  return merge([g]);
}

function platformGeo(seed: number) {
  const g = blob(1, 3, seed, 0.22, 1, 1.4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setY(i, y > 0 ? y * 0.12 : y * 1.5);
  }
  g.computeVertexNormals();
  return g;
}

export interface LandmarkResult {
  group: Group;
  /** Top centre of the highest floating platform (where the seed floats). */
  stairTop: Vector3;
}

export function createLandmarks(hf: Heightfield, colliders: Colliders, rng: Rng): LandmarkResult {
  const mats = getMaterials();
  const group = new Group();

  // ---------- Monoliths ----------
  const mono = monolithGeo();
  const monoItems: InstanceItem[] = [];
  const addMono = (x: number, z: number, s: number, faceTo?: { x: number; z: number }) => {
    const h = hf.height(x, z);
    const yaw = faceTo ? Math.atan2(faceTo.x - x, faceTo.z - z) : rng.range(0, Math.PI * 2);
    const m = new Matrix4().compose(
      new Vector3(x, h + 2.5 * s - 0.6, z),
      new Quaternion().setFromEuler(new Euler(rng.range(-0.06, 0.06), yaw, rng.range(-0.06, 0.06))),
      new Vector3(s, s, s),
    );
    monoItems.push({ matrix: m });
    colliders.add({ x, z, r: 0.85 * s, bottom: h - 1, top: h + 5 * s - 0.6, walkable: true });
  };
  const stones = SEED_SPOTS[4];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    addMono(stones.x + Math.cos(a) * 10, stones.z + Math.sin(a) * 10, rng.range(0.9, 1.3), stones);
  }
  // Gate stones along the paths from the clearing.
  for (let i = 0; i < SEED_SPOTS.length; i++) {
    const s = SEED_SPOTS[i];
    const a = Math.atan2(s.z, s.x);
    const d = CLEARING_RADIUS + 8;
    const px = Math.cos(a) * d, pz = Math.sin(a) * d;
    const ox = -Math.sin(a) * 3.2, oz = Math.cos(a) * 3.2;
    addMono(px + ox, pz + oz, 0.8, { x: 0, z: 0 });
    addMono(px - ox, pz - oz, 0.8, { x: 0, z: 0 });
  }
  for (let i = 0; i < 14; i++) {
    const x = rng.range(-160, 160), z = rng.range(-160, 160);
    if (Math.hypot(x, z) < CLEARING_RADIUS + 15 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.1) continue;
    if (!colliders.isFree(x, z, 2)) continue;
    addMono(x, z, rng.range(0.7, 1.2));
  }
  group.add(buildChunks(mono, mats.rune, monoItems, { castShadow: true, receiveShadow: true, name: 'monoliths' }));

  // ---------- Sky stair: spiral of floating islands ----------
  const stair = SEED_SPOTS[SKY_STAIR_SEED];
  const base = hf.height(stair.x, stair.z);
  const platGeos = [0, 1, 2].map((i) => platformGeo(i * 31.1 + 5));
  const platItems: InstanceItem[][] = platGeos.map(() => []);
  const crystalGeo = crystalCluster(rng);
  const crystalItems: InstanceItem[] = [];
  const steps = 8;
  let top = new Vector3();
  for (let i = 0; i < steps; i++) {
    const last = i === steps - 1;
    const a = i * 0.95 + 0.6;
    const rad = last ? 0 : 8.5 - i * 0.35;
    const x = stair.x + Math.cos(a) * rad;
    const z = stair.z + Math.sin(a) * rad;
    const topY = base + 2.6 + i * 3.0;
    const s = last ? 3.6 : rng.range(2.3, 2.9);
    const m = new Matrix4().compose(
      new Vector3(x, topY - 0.1 * s, z),
      new Quaternion().setFromEuler(new Euler(0, rng.range(0, Math.PI * 2), 0)),
      new Vector3(s, s, s),
    );
    platItems[i % platGeos.length].push({ matrix: m });
    colliders.add({ x, z, r: s * 0.92, bottom: topY - s * 1.4, top: topY, walkable: true });
    // Glowing crystals hanging beneath.
    const cm = new Matrix4().compose(
      new Vector3(x, topY - s * 0.9, z),
      new Quaternion().setFromEuler(new Euler(Math.PI, rng.range(0, 6), 0)),
      new Vector3(s * 0.45, s * 0.45, s * 0.45),
    );
    crystalItems.push({ matrix: cm, color: GLOW_COLORS[i % 2 === 0 ? 1 : 2].clone() });
    if (last) top = new Vector3(x, topY, z);
  }
  platGeos.forEach((g, i) => group.add(buildChunks(g, mats.rock, platItems[i], { castShadow: true, receiveShadow: true, name: 'platforms' })));
  group.add(buildChunks(crystalGeo, mats.crystal, crystalItems, { name: 'platform-crystals' }));

  return { group, stairTop: top };
}

export type { BufferGeometry };
