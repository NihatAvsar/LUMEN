import { createNoise2D } from 'simplex-noise';
import { DataTexture, DataUtils, HalfFloatType, LinearFilter, RGFormat, ClampToEdgeWrapping, Vector3 } from 'three';
import { WORLD_SIZE, WORLD_HALF, WATER_Y, LAKE, SEED_SPOTS, SKY_STAIR_SEED, CLEARING_RADIUS } from '../config';
import { mulberry32, smoothstep, lerp, clamp } from '../core/math';

export const HM_RES = 513;
export const HM_STEP = WORLD_SIZE / (HM_RES - 1);

const n2 = createNoise2D(mulberry32(7331));

function fbm(x: number, z: number, oct: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * n2(x * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

function ridged(x: number, z: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(n2(x * f, z * f));
    s += n * n * a;
    f *= 2.1;
    a *= 0.5;
  }
  return s;
}

function smoothMax(a: number, b: number, k: number) {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(a, b, h) + k * h * (1 - h);
}

function baseHeight(x: number, z: number) {
  let h = 4 + fbm(x * 0.0062, z * 0.0062, 5) * 13 + ridged(x * 0.011 + 7.3, z * 0.011 - 2.1) * 8 - 3;
  h += n2(x * 0.09, z * 0.09) * 0.3;
  // Keep everything above water outside the lake basin.
  h = smoothMax(h, WATER_Y + 1.0, 1.5);
  return h;
}

/** Analytic height function used to bake the heightmap. */
function rawHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  let h = baseHeight(x, z);

  // Small plateaus at seed spots so they read as places.
  for (let i = 0; i < SEED_SPOTS.length; i++) {
    if (i === 0 || i === SKY_STAIR_SEED) continue;
    const s = SEED_SPOTS[i];
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < 22) {
      const target = baseHeight(s.x, s.z);
      h = lerp(target, h, smoothstep(7, 20, d));
    }
  }

  // Central clearing with the Ancient Tree.
  const c = smoothstep(CLEARING_RADIUS * 0.55, CLEARING_RADIUS * 1.6, r);
  h = lerp(1.4 + n2(x * 0.05, z * 0.05) * 0.35 + r * 0.02, h, c);

  // Lake basin.
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + n2(x * 0.035, z * 0.035) * 5;
  const lk = 1 - smoothstep(LAKE.r * 0.45, LAKE.r * 1.12, dl);
  h = lerp(h, WATER_Y - 4.5, lk);

  // Ring of mountains bounding the world.
  const m = smoothstep(138, 205, r);
  h += m * m * 80 * (0.65 + 0.35 * ridged(x * 0.01, z * 0.01));
  return h;
}

export class Heightfield {
  readonly heights = new Float32Array(HM_RES * HM_RES);
  readonly mask = new Float32Array(HM_RES * HM_RES);
  texture!: DataTexture;

  build() {
    const { heights, mask } = this;
    for (let j = 0; j < HM_RES; j++) {
      const z = -WORLD_HALF + j * HM_STEP;
      for (let i = 0; i < HM_RES; i++) {
        const x = -WORLD_HALF + i * HM_STEP;
        heights[j * HM_RES + i] = rawHeight(x, z);
      }
    }
    const nrm = new Vector3();
    for (let j = 0; j < HM_RES; j++) {
      const z = -WORLD_HALF + j * HM_STEP;
      for (let i = 0; i < HM_RES; i++) {
        const x = -WORLD_HALF + i * HM_STEP;
        const h = heights[j * HM_RES + i];
        this.normalAt(x, z, nrm);
        const slope = 1 - nrm.y;
        const r = Math.hypot(x, z);
        let m = smoothstep(WATER_Y + 0.25, WATER_Y + 1.0, h);
        m *= 1 - smoothstep(0.22, 0.45, slope);
        m *= 1 - smoothstep(24, 38, h);
        m *= smoothstep(4.5, 8.5, r);
        m *= clamp(0.55 + 0.6 * (n2(x * 0.025 + 40, z * 0.025) * 0.5 + 0.5), 0, 1);
        mask[j * HM_RES + i] = m;
      }
    }

    const data = new Uint16Array(HM_RES * HM_RES * 2);
    for (let k = 0; k < HM_RES * HM_RES; k++) {
      data[k * 2] = DataUtils.toHalfFloat(heights[k]);
      data[k * 2 + 1] = DataUtils.toHalfFloat(mask[k]);
    }
    const tex = new DataTexture(data, HM_RES, HM_RES, RGFormat, HalfFloatType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.texture = tex;
  }

  /** Bilinear sample of the baked heightmap. */
  height(x: number, z: number) {
    const fx = clamp((x + WORLD_HALF) / HM_STEP, 0, HM_RES - 1.001);
    const fz = clamp((z + WORLD_HALF) / HM_STEP, 0, HM_RES - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * HM_RES + i;
    const h = this.heights;
    const a = h[k], b = h[k + 1], c = h[k + HM_RES], d = h[k + HM_RES + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  grassMask(x: number, z: number) {
    const i = Math.round(clamp((x + WORLD_HALF) / HM_STEP, 0, HM_RES - 1));
    const j = Math.round(clamp((z + WORLD_HALF) / HM_STEP, 0, HM_RES - 1));
    return this.mask[j * HM_RES + i];
  }

  /** Walkable surface: terrain or water surface (the spirit hovers over water). */
  ground(x: number, z: number) {
    return Math.max(this.height(x, z), WATER_Y + 0.05);
  }

  normalAt(x: number, z: number, out: Vector3) {
    const e = HM_STEP;
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }
}

/** GLSL helpers matching the baked texture layout. */
export const HEIGHTMAP_GLSL = /* glsl */ `
uniform sampler2D uHeight;
vec2 hmUV(vec2 xz) { return ((xz + ${WORLD_HALF.toFixed(1)}) / ${HM_STEP.toFixed(6)} + 0.5) / ${HM_RES.toFixed(1)}; }
vec2 hmSample(vec2 xz) { return texture2D(uHeight, hmUV(xz)).rg; }
`;
