import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial, Vector3 } from 'three';
import { NOISE_GLSL, AWAKE_GLSL } from '../shaders/chunks';
import { HEIGHTMAP_GLSL, type Heightfield } from '../world/Heightfield';
import type { Awakening } from '../world/Awakening';
import { Rng } from '../core/math';
import { WATER_Y } from '../config';

export interface FireflyOptions {
  max: number;
  tile: number;
  size: number;
  heightRange: [number, number];
  dim: number;
  bright: number;
  speed: number;
  dust?: boolean;
}

/**
 * Shader-animated fireflies (or dust motes) that tile infinitely around the player.
 */
export class Fireflies {
  readonly points: Points;
  readonly material: ShaderMaterial;
  private geo: BufferGeometry;

  constructor(awakening: Awakening, hf: Heightfield, o: FireflyOptions, seed: number) {
    const rng = new Rng(seed);
    const off = new Float32Array(o.max * 3);
    const rnd = new Float32Array(o.max * 4);
    for (let i = 0; i < o.max; i++) {
      off[i * 3] = rng.next() * o.tile;
      off[i * 3 + 1] = rng.range(o.heightRange[0], o.heightRange[1]);
      off[i * 3 + 2] = rng.next() * o.tile;
      rnd[i * 4] = rng.next();
      rnd[i * 4 + 1] = rng.next();
      rnd[i * 4 + 2] = rng.next();
      rnd[i * 4 + 3] = rng.next();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(off, 3));
    geo.setAttribute('aRnd', new Float32BufferAttribute(rnd, 4));
    this.geo = geo;

    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uHeight: { value: hf.texture },
        uCenter: { value: new Vector3() },
        uTile: { value: o.tile },
        uScale: { value: 500 },
        uSize: { value: o.size },
        uDim: { value: o.dim },
        uBright: { value: o.bright },
        uSpeed: { value: o.speed },
        uPlayer: { value: new Vector3() },
        uBoost: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uCenter;
        uniform float uTile;
        uniform float uScale;
        uniform float uSize;
        uniform float uDim;
        uniform float uBright;
        uniform float uSpeed;
        uniform vec3 uPlayer;
        uniform float uBoost;
        attribute vec4 aRnd;
        varying vec3 vColor;
        varying float vAlpha;
        ${NOISE_GLSL}
        ${AWAKE_GLSL}
        ${HEIGHTMAP_GLSL}

        void main() {
          vec2 base = position.xz + uTile * floor((uCenter.xz - position.xz) / uTile + 0.5);
          float t = uTime * uSpeed;
          vec2 drift = vec2(sin(t * (0.3 + aRnd.x * 0.4) + aRnd.y * 20.0), cos(t * (0.25 + aRnd.z * 0.4) + aRnd.w * 20.0)) * (1.2 + aRnd.z * 1.5);
          vec2 xz = base + drift;
          float ground = max(hmSample(xz).r, ${WATER_Y.toFixed(2)});
          float y = ground + position.y + sin(t * (0.6 + aRnd.w * 0.6) + aRnd.x * 30.0) * 0.6;

          float aw = awakeAmt(xz);
          float gm = gloomAmt(vec3(xz.x, y, xz.y));
          float fade = 1.0 - smoothstep(uTile * 0.3, uTile * 0.5, length(xz - uCenter.xz));
          float blink = pow(0.5 + 0.5 * sin(uTime * (0.8 + aRnd.y * 1.6) + aRnd.x * 60.0), 3.0);
          float lit = mix(uDim, uBright, clamp(aw + uBoost, 0.0, 1.0));
          vAlpha = fade * (0.25 + 0.75 * blink) * lit * (1.0 - gm);

          float k = aRnd.z;
          vec3 c = k < 0.45 ? vec3(0.75, 1.0, 0.35) : (k < 0.75 ? vec3(0.3, 1.0, 0.9) : (k < 0.9 ? vec3(0.85, 0.45, 1.0) : vec3(1.0, 0.75, 0.4)));
          vColor = c;

          vec4 mv = viewMatrix * vec4(xz.x, y, xz.y, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (0.6 + aRnd.w * 0.8) * uScale / -mv.z;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = exp(-d * d * 10.0);
          float halo = exp(-d * 3.0) * 0.35;
          float a = (core + halo) * (1.0 - smoothstep(0.8, 1.0, d));
          gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
        }`,
    });
    this.material.uniforms.uAwake = awakening.uniforms.uAwake;
    this.material.uniforms.uGloom = awakening.uniforms.uGloom;
    this.material.uniforms.uTime = awakening.uniforms.uTime;

    this.points = new Points(geo, this.material);
    this.points.frustumCulled = false;
    this.setCount(o.max);
  }

  setCount(n: number) {
    this.geo.setDrawRange(0, n);
  }

  update(center: Vector3, scale: number) {
    this.material.uniforms.uCenter.value.copy(center);
    this.material.uniforms.uScale.value = scale;
  }
}
