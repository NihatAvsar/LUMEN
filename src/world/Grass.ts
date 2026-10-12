import {
  BufferGeometry, Color, DoubleSide, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry,
  Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector3,
} from 'three';
import { NOISE_GLSL, AWAKE_GLSL } from '../shaders/chunks';
import { HEIGHTMAP_GLSL, type Heightfield } from './Heightfield';
import type { Awakening } from './Awakening';
import { Rng } from '../core/math';

export const GRASS_LAYER = 1;
const MAX_BLADES = 200_000;

function bladeGeometry() {
  // 4 segments, tapered. x in [-0.5, 0.5], y in [0, 1].
  const segs = 4;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const w = 0.5 * (1 - t * 0.92);
    if (i === segs) {
      pos.push(0, 1, 0);
    } else {
      pos.push(-w, t, 0, w, t, 0);
    }
  }
  for (let i = 0; i < segs - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segs - 1) * 2;
  idx.push(last, last + 1, last + 2);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Grass {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private geo: InstancedBufferGeometry;
  readonly tile: number;

  constructor(awakening: Awakening, hf: Heightfield, playerLightColor: Color, tile = 96) {
    this.tile = tile;
    const base = bladeGeometry();
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);

    const rng = new Rng(4242);
    const off = new Float32Array(MAX_BLADES * 2);
    const rnd = new Float32Array(MAX_BLADES * 4);
    for (let i = 0; i < MAX_BLADES; i++) {
      off[i * 2] = rng.next() * tile;
      off[i * 2 + 1] = rng.next() * tile;
      rnd[i * 4] = rng.next();
      rnd[i * 4 + 1] = rng.next();
      rnd[i * 4 + 2] = rng.next();
      rnd[i * 4 + 3] = rng.next();
    }
    geo.setAttribute('aOff', new InstancedBufferAttribute(off, 2));
    geo.setAttribute('aRnd', new InstancedBufferAttribute(rnd, 4));
    geo.instanceCount = 60_000;
    this.geo = geo;

    this.material = new ShaderMaterial({
      side: DoubleSide,
      fog: true,
      uniforms: UniformsUtils.merge([
        UniformsLib.fog,
        {
          uHeight: { value: hf.texture },
          uCenter: { value: new Vector3() },
          uTile: { value: tile },
          uPlayer: { value: new Vector3() },
          uPlayerLight: { value: 1 },
          uPlayerLightCol: { value: playerLightColor },
          uHeartLight: { value: 0.3 },
          uMoonCol: { value: new Color(0.55, 0.65, 1.0) },
        },
      ]),
      vertexShader: /* glsl */ `
        uniform vec3 uCenter;
        uniform float uTile;
        uniform vec3 uPlayer;
        attribute vec2 aOff;
        attribute vec4 aRnd;
        varying float vH;
        varying vec3 vWP;
        varying float vRnd;
        varying float vAw;
        varying float vAwF;
        varying float vGloom;
        ${NOISE_GLSL}
        ${AWAKE_GLSL}
        ${HEIGHTMAP_GLSL}
        #include <fog_pars_vertex>

        void main() {
          vec2 wp = aOff + uTile * floor((uCenter.xz - aOff) / uTile + 0.5);
          wp += (vec2(aRnd.z, aRnd.w) - 0.5) * 0.4;
          vec2 hs = hmSample(wp);
          float ground = hs.r;
          float mask = hs.g;
          float distC = length(wp - uCenter.xz);
          float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.49, distC);
          float clump = vnoise(wp * 0.13);
          float present = step(aRnd.w, mask * 1.15);
          float hgt = (0.18 + aRnd.x * 0.32 + clump * 0.5) * fade * present * smoothstep(0.05, 0.4, mask);

          float ang = aRnd.y * 6.2831;
          float t = position.y;
          float width = 0.07 + aRnd.z * 0.07;
          vec3 local = vec3(position.x * width, t * hgt, 0.0);
          float c = cos(ang), s = sin(ang);
          local = vec3(local.x * c, local.y, local.x * s);

          // Wind + player push.
          vec2 windDir = normalize(vec2(1.0, 0.45));
          float gust = vnoise(wp * 0.035 + uTime * vec2(0.28, 0.12)) * 2.0 - 1.0;
          float sway = sin(uTime * 1.8 + wp.x * 0.35 + wp.y * 0.25 + aRnd.x * 6.0) * 0.12 + gust * 0.55;
          vec2 toP = wp - uPlayer.xz;
          float dp = length(toP);
          float push = (1.0 - smoothstep(0.2, 2.4, dp)) * (1.0 - smoothstep(1.2, 3.5, uPlayer.y - ground));
          vec2 bend = windDir * sway + (toP / max(dp, 0.001)) * push * 1.5;
          float tt = t * t;
          local.xz += bend * tt * hgt;
          local.y -= length(bend) * tt * hgt * 0.35;

          vec3 world = vec3(wp.x, ground, wp.y) + local;
          vWP = world;
          vH = t;
          vRnd = aRnd.x;
          vAw = awakeAmt(wp);
          vAwF = awakeFront(wp);
          vGloom = gloomAmt(world);

          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uPlayer;
        uniform float uPlayerLight;
        uniform vec3 uPlayerLightCol;
        uniform float uHeartLight;
        uniform vec3 uMoonCol;
        uniform float uTime;
        varying float vH;
        varying vec3 vWP;
        varying float vRnd;
        varying float vAw;
        varying float vAwF;
        varying float vGloom;
        #include <fog_pars_fragment>

        void main() {
          vec3 dullBase = vec3(0.01, 0.013, 0.02);
          vec3 dullTip = vec3(0.038, 0.046, 0.064);
          vec3 awBase = vec3(0.004, 0.03, 0.025);
          vec3 awTip = mix(vec3(0.04, 0.26, 0.2), vec3(0.12, 0.3, 0.09), vRnd);
          vec3 base = mix(dullBase, awBase, vAw);
          vec3 tip = mix(dullTip, awTip, vAw);
          vec3 col = mix(base, tip, vH);

          col *= 0.45 + uMoonCol * (0.25 + 0.6 * vH);

          float dp = distance(vWP, uPlayer);
          col += (tip * 1.5 + vec3(0.0, 0.025, 0.03)) * uPlayerLightCol * uPlayerLight * 4.0 / (1.0 + dp * dp * 0.3);
          float dh = length(vWP.xz);
          col += (tip + 0.015) * vec3(1.0, 0.8, 0.5) * uHeartLight * 9.0 / (1.0 + dh * dh * 0.05);

          float glowBlade = step(0.84, fract(vRnd * 13.7));
          vec3 gc = mix(vec3(0.1, 1.0, 0.8), vec3(0.85, 0.3, 1.0), step(0.5, fract(vRnd * 7.3)));
          float flick = 0.7 + 0.3 * sin(uTime * 2.0 + vRnd * 40.0);
          col += gc * glowBlade * pow(vH, 3.0) * mix(0.03, 1.8, vAw) * flick;
          col += AWAKE_FRONT_COLOR_G * vAwF * vH * 0.9;
          col *= 1.0 - vGloom * 0.8;

          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
        }`,
    });
    // AWAKE_FRONT_COLOR is defined in the vertex chunk only.
    this.material.fragmentShader = this.material.fragmentShader.replace(
      'void main() {',
      'const vec3 AWAKE_FRONT_COLOR_G = vec3(0.45, 1.0, 0.85);\nvoid main() {',
    );
    this.material.uniforms.uAwake = awakening.uniforms.uAwake;
    this.material.uniforms.uGloom = awakening.uniforms.uGloom;
    this.material.uniforms.uTime = awakening.uniforms.uTime;

    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(GRASS_LAYER);
  }

  setCount(n: number) {
    this.geo.instanceCount = Math.min(MAX_BLADES, n);
  }

  update(center: Vector3, player: Vector3, playerLight: number, heartLight: number) {
    const u = this.material.uniforms;
    u.uCenter.value.copy(center);
    u.uPlayer.value.copy(player);
    u.uPlayerLight.value = playerLight;
    u.uHeartLight.value = heartLight;
  }
}
