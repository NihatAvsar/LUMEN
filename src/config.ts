import { Vector3 } from 'three';

export const WORLD_SIZE = 400;
export const WORLD_HALF = WORLD_SIZE / 2;
export const PLAY_RADIUS = 168;
export const WATER_Y = -1.2;
export const LAKE = { x: 78, z: -48, r: 34 };
export const CLEARING_RADIUS = 30;

/** Direction towards the moon (normalized). */
export const MOON_DIR = new Vector3(-0.42, 0.3, -0.86).normalize();
export const MOON_DISTANCE = 780;

export const SEED_COUNT = 7;
export const PEDESTAL_RADIUS = 13;
export const TREE_HEART_Y = 7;

/** Player floats this far above the ground. */
export const HOVER = 1.0;

export interface SeedSpot {
  name: string;
  x: number;
  z: number;
  /** Absolute y. If undefined it is derived from the terrain. */
  y?: number;
  lift: number;
  guards: number;
}

export const SEED_SPOTS: SeedSpot[] = [
  { name: 'Göl Kalbi', x: LAKE.x, z: LAKE.z, lift: 2.4, guards: 1 },
  { name: 'Mantar Korusu', x: -62, z: -96, lift: 1.6, guards: 2 },
  { name: 'Kristal Vadisi', x: 118, z: 68, lift: 1.6, guards: 2 },
  { name: 'Yankı Tepesi', x: 18, z: 124, lift: 1.8, guards: 2 },
  { name: 'Kadim Taşlar', x: -126, z: -18, lift: 2.2, guards: 3 },
  { name: 'Gök Merdiveni', x: -96, z: 86, lift: 1.6, guards: 2 },
  { name: 'Sisli Geçit', x: 34, z: -140, lift: 1.6, guards: 3 },
];

/** Index of the seed placed on top of the floating platforms. */
export const SKY_STAIR_SEED = 5;
