import { CircleGeometry, Euler, Group, IcosahedronGeometry, Matrix4, OctahedronGeometry, Quaternion, SphereGeometry, Vector3, BufferGeometry, Color } from 'three';
import { Rng } from '../core/math';
import { taperedTube, blob, merge } from './geometry';
import { buildChunks, InstanceItem } from './instancing';
import { getMaterials, regionColor, GLOW_COLORS } from './palette';
import { CLEARING_RADIUS, LAKE, SEED_SPOTS, WATER_Y } from '../config';
import type { Heightfield } from './Heightfield';
import type { Colliders } from './Colliders';

function mushroomParts() {
  const stem = taperedTube([new Vector3(0, -0.1, 0), new Vector3(0.05, 0.5, 0.02), new Vector3(0, 1, 0)], 0.09, 0.065, 5, 6);
  const cap = new SphereGeometry(0.34, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cap.scale(1, 0.6, 1);
  cap.translate(0, 0.98, 0);
  const under = new CircleGeometry(0.335, 14);
  under.rotateX(Math.PI / 2);
  under.translate(0, 0.975, 0);
  return { stem: merge([stem]), cap: merge([cap, under]) };
}

function flowerGeo() {
  const stem = taperedTube([new Vector3(0, 0, 0), new Vector3(0.04, 0.32, 0.02), new Vector3(0.08, 0.62, 0)], 0.02, 0.012, 5, 4);
  const head = new IcosahedronGeometry(0.075, 1);
  head.scale(1, 0.75, 1);
  head.translate(0.08, 0.68, 0);
  const petals: BufferGeometry[] = [stem, head];
  for (let i = 0; i < 5; i++) {
    const p = new SphereGeometry(0.06, 6, 4);
    p.scale(1.4, 0.3, 0.7);
    const a = (i / 5) * Math.PI * 2;
    p.rotateY(-a);
    p.translate(0.08 + Math.cos(a) * 0.08, 0.66, Math.sin(a) * 0.08);
    petals.push(p);
  }
  return merge(petals);
}

function crystalCluster(rng: Rng) {
  const parts: BufferGeometry[] = [];
  const n = rng.int(5, 9);
  for (let i = 0; i < n; i++) {
    const c = new OctahedronGeometry(0.4, 0);
    const len = rng.range(1.2, 3.2) * (i === 0 ? 1.4 : 1);
    c.scale(rng.range(0.35, 0.6), len, rng.range(0.35, 0.6));
    c.translate(0, len * 0.35, 0);
    c.rotateZ(rng.range(-0.6, 0.6) * (i === 0 ? 0.2 : 1));
    c.rotateX(rng.range(-0.6, 0.6) * (i === 0 ? 0.2 : 1));
    c.rotateY(rng.range(0, Math.PI * 2));
    c.translate(rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4));
    parts.push(c);
  }
  return merge(parts);
}

function avoid(x: number, z: number, seedR = 5) {
  if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 0.95) return true;
  if (SEED_SPOTS.some((s) => Math.hypot(x - s.x, z - s.z) < seedR)) return true;
  return false;
}

function compose(x: number, y: number, z: number, s: number, rng: Rng, tilt = 0.1, sy = s) {
  return new Matrix4().compose(
    new Vector3(x, y, z),
    new Quaternion().setFromEuler(new Euler(rng.range(-tilt, tilt), rng.range(0, Math.PI * 2), rng.range(-tilt, tilt))),
    new Vector3(s, sy, s),
  );
}

export function createFlora(hf: Heightfield, colliders: Colliders, rng: Rng, density: number) {
  const mats = getMaterials();
  const group = new Group();
  const nrm = new Vector3();

  // ---------- Mushrooms ----------
  const mush = mushroomParts();
  const mushItems: InstanceItem[] = [];
  const grove = SEED_SPOTS[1];
  const clusters = Math.floor(150 * density);
  for (let c = 0; c < clusters; c++) {
    let cx: number, cz: number;
    if (c < clusters * 0.3) {
      const a = rng.range(0, Math.PI * 2), d = rng.range(4, 38);
      cx = grove.x + Math.cos(a) * d;
      cz = grove.z + Math.sin(a) * d;
    } else {
      cx = rng.range(-175, 175);
      cz = rng.range(-175, 175);
    }
    if (Math.hypot(cx, cz) > 172 || Math.hypot(cx, cz) < 9 || avoid(cx, cz)) continue;
    const color = regionColor(cx, cz, rng.next() * 2);
    const n = rng.int(3, 8);
    for (let i = 0; i < n; i++) {
      const x = cx + rng.range(-1.8, 1.8), z = cz + rng.range(-1.8, 1.8);
      const h = hf.height(x, z);
      if (h < WATER_Y + 0.3) continue;
      const s = rng.range(0.35, 1.25) * (rng.next() < 0.08 ? 2.2 : 1);
      mushItems.push({ matrix: compose(x, h - 0.05, z, s, rng, 0.25), color });
    }
  }
  group.add(buildChunks(mush.stem, mats.stem, mushItems, { castShadow: false, receiveShadow: true, name: 'mush-stem' }));
  group.add(buildChunks(mush.cap, mats.cap, mushItems, { castShadow: true, receiveShadow: false, name: 'mush-cap' }));

  // ---------- Flowers ----------
  const fgeo = flowerGeo();
  const flowerItems: InstanceItem[] = [];
  const patches = Math.floor(170 * density);
  for (let p = 0; p < patches; p++) {
    const px = rng.range(-170, 170), pz = rng.range(-170, 170);
    const pr = Math.hypot(px, pz);
    if (pr > 168 || avoid(px, pz, 3)) continue;
    const color = GLOW_COLORS[rng.int(0, GLOW_COLORS.length - 1)].clone();
    const n = rng.int(6, 16);
    for (let i = 0; i < n; i++) {
      const x = px + rng.range(-3, 3), z = pz + rng.range(-3, 3);
      if (Math.hypot(x, z) < 7) continue;
      const h = hf.height(x, z);
      if (h < WATER_Y + 0.4) continue;
      hf.normalAt(x, z, nrm);
      if (nrm.y < 0.82) continue;
      const s = rng.range(0.7, 1.6);
      flowerItems.push({ matrix: compose(x, h - 0.03, z, s, rng, 0.2), color });
    }
  }
  // Ring of flowers around the clearing.
  for (let i = 0; i < 160 * density; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(CLEARING_RADIUS * 0.4, CLEARING_RADIUS * 1.1);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h = hf.height(x, z);
    flowerItems.push({ matrix: compose(x, h - 0.03, z, rng.range(0.8, 1.5), rng, 0.2), color: GLOW_COLORS[rng.int(0, 5)].clone() });
  }
  group.add(buildChunks(fgeo, mats.flower, flowerItems, { name: 'flowers' }));

  // ---------- Rocks ----------
  const rockGeos = [0, 1, 2, 3].map((i) => {
    const g = blob(1, 2, i * 13.7, 0.32, 0.65, 1.6);
    g.translate(0, 0.25, 0);
    return g;
  });
  const rockItems: InstanceItem[][] = rockGeos.map(() => []);
  const rocks = Math.floor(190 * density);
  for (let i = 0; i < rocks; i++) {
    const x = rng.range(-185, 185), z = rng.range(-185, 185);
    const r = Math.hypot(x, z);
    if (r < CLEARING_RADIUS * 0.8 || r > 190 || avoid(x, z, 6)) continue;
    const h = hf.height(x, z);
    const s = rng.range(0.4, 1) ** 2 * 3.2 + 0.3;
    if (!colliders.isFree(x, z, s)) continue;
    const k = rng.int(0, rockGeos.length - 1);
    rockItems[k].push({ matrix: compose(x, h - s * 0.25, z, s, rng, 0.25, s * rng.range(0.7, 1.2)) });
    if (s > 1.3) colliders.add({ x, z, r: s * 0.85, bottom: h - 2, top: h + s * 0.55, walkable: true });
  }
  rockGeos.forEach((g, i) => group.add(buildChunks(g, mats.rock, rockItems[i], { castShadow: true, receiveShadow: true, name: 'rocks' })));

  // ---------- Crystals ----------
  const crystalGeos = [0, 1, 2].map(() => crystalCluster(rng));
  const crystalItems: InstanceItem[][] = crystalGeos.map(() => []);
  const valley = SEED_SPOTS[2];
  const placeCrystal = (x: number, z: number, s: number, color: Color) => {
    if (avoid(x, z, 4)) return;
    if (!colliders.isFree(x, z, s * 0.6)) return;
    const h = hf.height(x, z);
    const k = rng.int(0, crystalGeos.length - 1);
    crystalItems[k].push({ matrix: compose(x, h - 0.2, z, s, rng, 0.2), color });
    if (s > 0.9) colliders.add({ x, z, r: s * 0.7, bottom: h - 1, top: h + s * 2.2, walkable: false });
  };
  for (let i = 0; i < 46 * density; i++) {
    const a = rng.range(0, Math.PI * 2), d = rng.range(5, 34);
    placeCrystal(valley.x + Math.cos(a) * d, valley.z + Math.sin(a) * d, rng.range(0.6, 2.0), rng.next() < 0.6 ? GLOW_COLORS[2].clone() : GLOW_COLORS[1].clone());
  }
  for (let i = 0; i < 50 * density; i++) {
    const x = rng.range(-175, 175), z = rng.range(-175, 175);
    if (Math.hypot(x, z) < CLEARING_RADIUS || Math.hypot(x, z) > 175) continue;
    placeCrystal(x, z, rng.range(0.5, 1.4), regionColor(x, z, rng.next()));
  }
  crystalGeos.forEach((g, i) => group.add(buildChunks(g, mats.crystal, crystalItems[i], { castShadow: true, name: 'crystals' })));

  return group;
}

export { crystalCluster };
