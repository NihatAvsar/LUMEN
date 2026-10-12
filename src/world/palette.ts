import { Color, DoubleSide, MeshStandardMaterial } from 'three';
import { awakenMaterial } from './materials';

export const GLOW_COLORS = [
  new Color(0.15, 1.0, 0.8), // teal
  new Color(0.3, 0.7, 1.0), // sky
  new Color(0.62, 0.35, 1.0), // violet
  new Color(1.0, 0.35, 0.78), // magenta
  new Color(0.55, 1.0, 0.35), // lime
  new Color(1.0, 0.65, 0.25), // amber
];

/** Pick a glow colour with regional coherence. */
export function regionColor(x: number, z: number, jitter: number) {
  const a = Math.atan2(z, x) / (Math.PI * 2) + 0.5;
  const r = Math.hypot(x, z) / 200;
  let k = (a * 4.0 + r * 1.3 + jitter * 0.9) % 1;
  if (k < 0) k += 1;
  const idx = Math.floor(k * GLOW_COLORS.length) % GLOW_COLORS.length;
  return GLOW_COLORS[idx].clone();
}

export interface Materials {
  bark: MeshStandardMaterial;
  leaf: MeshStandardMaterial;
  cap: MeshStandardMaterial;
  stem: MeshStandardMaterial;
  flower: MeshStandardMaterial;
  rock: MeshStandardMaterial;
  crystal: MeshStandardMaterial;
  rune: MeshStandardMaterial;
}

let cached: Materials | null = null;

export function getMaterials(): Materials {
  if (cached) return cached;

  const bark = awakenMaterial(
    { color: new Color(0.075, 0.062, 0.06), roughness: 0.9, emissive: 0xffffff },
    {
      key: 'bark', occlude: true,
      emissive: /* glsl */ `
        {
          float cr = 1.0 - abs(snoise(vec3(vAwPos.x * 1.6, vAwPos.y * 0.22, vAwPos.z * 1.6)));
          float lines = pow(cr, 22.0);
          float climb = 0.55 + 0.45 * sin(uTime * 1.8 - vAwPos.y * 0.7 + vAwPos.x * 0.3);
          totalEmissiveRadiance = vec3(0.2, 0.8, 1.0) * lines * climb * mix(0.02, 1.1, aw);
        }`,
    },
  );

  const leaf = awakenMaterial(
    { color: new Color(0.16, 0.2, 0.22), roughness: 0.75, emissive: 0xffffff, side: DoubleSide },
    {
      key: 'leaf', occlude: true,
      color: 'diffuseColor.rgb = vec3(0.07, 0.09, 0.1) + instCol * 0.06;',
      emissive: /* glsl */ `
        {
          float sp = snoise(vAwPos * 0.75 + vec3(0.0, uTime * 0.07, 0.0));
          float spots = smoothstep(0.42, 0.85, sp);
          float under = smoothstep(-0.15, -0.85, vAwNrm.y);
          float pulse = 0.72 + 0.28 * sin(uTime * 1.1 + vAwPos.x * 0.13 + vAwPos.z * 0.09);
          totalEmissiveRadiance = instCol * (spots * 1.5 + under * 0.32 + 0.04) * pulse * mix(0.025, 1.0, aw);
        }`,
    },
  );

  const cap = awakenMaterial(
    { color: 0xffffff, roughness: 0.55, emissive: 0xffffff, side: DoubleSide },
    {
      key: 'cap', occlude: true,
      color: 'diffuseColor.rgb = mix(vec3(0.12), instCol * 0.45, 0.6);',
      emissive: /* glsl */ `
        {
          float under = smoothstep(-0.2, -0.7, vAwNrm.y);
          float sp = smoothstep(0.35, 0.75, snoise(vAwLocal * 5.0 + vAwPos * 0.2));
          float pulse = 0.8 + 0.2 * sin(uTime * 1.7 + vAwPos.x * 0.5 + vAwPos.z * 0.3);
          totalEmissiveRadiance = instCol * (under * 2.4 + sp * 0.9 + 0.12) * pulse * mix(0.035, 1.0, aw);
        }`,
    },
  );

  const stem = awakenMaterial(
    { color: new Color(0.42, 0.42, 0.4), roughness: 0.7, emissive: 0xffffff },
    {
      key: 'stem', occlude: true,
      emissive: 'totalEmissiveRadiance = instCol * 0.1 * aw + vec3(0.02) * aw;',
    },
  );

  const flower = awakenMaterial(
    { color: new Color(0.05, 0.12, 0.06), roughness: 0.6, emissive: 0xffffff },
    {
      key: 'flower',
      color: 'if (vAwLocal.y > 0.6) diffuseColor.rgb = instCol * 0.5;',
      emissive: /* glsl */ `
        {
          float head = smoothstep(0.58, 0.66, vAwLocal.y);
          float tw = 0.75 + 0.25 * sin(uTime * 2.6 + vAwPos.x * 3.0 + vAwPos.z * 2.0);
          totalEmissiveRadiance = instCol * head * 3.2 * tw * mix(0.04, 1.0, aw);
        }`,
    },
  );

  const rock = awakenMaterial(
    { color: 0xffffff, roughness: 0.95, emissive: 0xffffff, flatShading: true },
    {
      key: 'rock', occlude: true,
      color: /* glsl */ `
        {
          float nn = snoise(vAwPos * 0.5) * 0.5 + 0.5;
          vec3 stone = vec3(0.11, 0.11, 0.125) * (0.7 + 0.6 * nn);
          vec3 moss = vec3(0.04, 0.1, 0.07);
          diffuseColor.rgb = mix(stone, moss, smoothstep(0.45, 0.8, vAwNrm.y + nn * 0.2));
        }`,
      emissive: /* glsl */ `
        {
          float lich = smoothstep(0.55, 0.85, snoise(vAwPos * 1.3)) * smoothstep(0.3, 0.8, vAwNrm.y);
          totalEmissiveRadiance = vec3(0.2, 0.9, 0.75) * lich * 0.9 * aw;
        }`,
    },
  );

  const crystal = awakenMaterial(
    { color: new Color(0.25, 0.22, 0.4), roughness: 0.15, metalness: 0.3, emissive: 0xffffff, flatShading: true },
    {
      key: 'crystal', occlude: true,
      drain: 0.5,
      color: 'diffuseColor.rgb = instCol * 0.25;',
      emissive: /* glsl */ `
        {
          float hgt = clamp(vAwLocal.y * 0.6 + 0.4, 0.0, 1.0);
          float shim = 0.7 + 0.3 * sin(uTime * 2.2 + vAwPos.y * 2.0 + vAwPos.x);
          totalEmissiveRadiance = instCol * (0.3 + hgt * 1.0) * shim * mix(0.15, 1.0, aw);
        }`,
    },
  );

  const rune = awakenMaterial(
    { color: new Color(0.1, 0.1, 0.11), roughness: 0.85, emissive: 0xffffff },
    {
      key: 'rune', occlude: true,
      drain: 0.4,
      emissive: /* glsl */ `
        {
          vec2 q = vAwLocal.xy * vec2(2.6, 1.6);
          vec2 cell = floor(q);
          vec2 f = fract(q) - 0.5;
          float h = lnHash12(cell + floor(vAwLocal.z * 3.0) * 7.0);
          float w = 0.06;
          float g = 0.0;
          if (h < 0.25) g = 1.0 - smoothstep(0.0, w, abs(f.x));
          else if (h < 0.5) g = 1.0 - smoothstep(0.0, w, abs(length(f) - 0.28));
          else if (h < 0.7) g = 1.0 - smoothstep(0.0, w, abs(f.x - f.y));
          else if (h < 0.85) g = (1.0 - smoothstep(0.0, w, abs(f.y))) * step(abs(f.x), 0.3);
          g *= step(max(abs(f.x), abs(f.y)), 0.42);
          float front = smoothstep(0.7, 0.95, abs(vAwNrm.x) + abs(vAwNrm.z));
          float band = step(abs(vAwLocal.y - 0.3), 1.6);
          float pulse = 0.7 + 0.3 * sin(uTime * 1.3 + vAwPos.x + vAwPos.z);
          totalEmissiveRadiance = vec3(1.0, 0.75, 0.35) * g * front * band * pulse * mix(0.35, 2.4, aw);
        }`,
    },
  );

  cached = { bark, leaf, cap, stem, flower, rock, crystal, rune };
  return cached;
}
