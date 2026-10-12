import { Mesh, PlaneGeometry } from 'three';
import { WORLD_SIZE, WATER_Y } from '../config';
import { awakenMaterial } from './materials';
import type { Heightfield } from './Heightfield';

export function createTerrain(hf: Heightfield) {
  const geo = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 256, 256);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, hf.height(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();
  geo.deleteAttribute('uv');

  const mat = awakenMaterial(
    { color: 0xffffff, roughness: 0.92, metalness: 0.0 },
    {
      key: 'terrain',
      drain: 0.8,
      frontGlow: 0.9,
      color: /* glsl */ `
        {
          float slope = 1.0 - vAwNrm.y;
          float nn = snoise(vec3(vAwPos.xz * 0.06, 0.0)) * 0.5 + 0.5;
          float nf = snoise(vec3(vAwPos.xz * 0.4, 3.0)) * 0.5 + 0.5;
          vec3 moss = mix(vec3(0.035, 0.085, 0.07), vec3(0.07, 0.13, 0.08), nn) * (0.8 + 0.4 * nf);
          vec3 soil = vec3(0.075, 0.06, 0.055) * (0.8 + 0.4 * nf);
          vec3 rock = vec3(0.13, 0.13, 0.15) * (0.75 + 0.5 * nf);
          vec3 shore = vec3(0.10, 0.11, 0.12);
          vec3 c = mix(moss, soil, smoothstep(0.18, 0.34, slope + nn * 0.12));
          c = mix(c, rock, smoothstep(0.32, 0.5, slope));
          c = mix(c, rock * 1.15, smoothstep(26.0, 44.0, vAwPos.y));
          c = mix(c, shore, 1.0 - smoothstep(${(WATER_Y + 0.25).toFixed(2)}, ${(WATER_Y + 1.3).toFixed(2)}, vAwPos.y));
          diffuseColor.rgb = c;
        }`,
      emissive: /* glsl */ `
        {
          float slope = 1.0 - vAwNrm.y;
          float v1 = 1.0 - abs(snoise(vec3(vAwPos.xz * 0.04, 1.7)));
          float v2 = 1.0 - abs(snoise(vec3(vAwPos.xz * 0.12, 4.2)));
          float veins = pow(v1, 42.0) * 1.0 + pow(v2, 60.0) * 0.55;
          float pulse = 0.65 + 0.35 * sin(uTime * 1.4 - length(vAwPos.xz) * 0.12);
          float hue = snoise(vec3(vAwPos.xz * 0.008, 9.0)) * 0.5 + 0.5;
          vec3 vc = mix(vec3(0.1, 0.95, 0.85), vec3(0.65, 0.3, 1.0), hue);
          float flat_ = 1.0 - smoothstep(0.3, 0.55, slope);
          float under = smoothstep(${(WATER_Y - 0.2).toFixed(2)}, ${(WATER_Y + 0.6).toFixed(2)}, vAwPos.y);
          totalEmissiveRadiance += vc * veins * pulse * flat_ * under * mix(0.04, 0.95, aw);
        }`,
    },
  );

  const mesh = new Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
