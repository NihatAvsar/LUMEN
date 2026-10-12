import { CircleGeometry, Color, Matrix4, PerspectiveCamera, UniformsLib, UniformsUtils, Vector3 } from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { LAKE, WATER_Y } from '../config';
import { NOISE_GLSL, AWAKE_GLSL } from '../shaders/chunks';
import { HEIGHTMAP_GLSL } from './Heightfield';
import type { Awakening } from './Awakening';
import type { Heightfield } from './Heightfield';

const WaterShader = {
  name: 'LumenWater',
  uniforms: UniformsUtils.merge([
    UniformsLib.fog,
    {
      color: { value: null as Color | null },
      tDiffuse: { value: null },
      textureMatrix: { value: null as Matrix4 | null },
      uHeight: { value: null },
      uPlayer: { value: new Vector3() },
      uAwake: { value: [] },
      uGloom: { value: [] },
      uTime: { value: 0 },
    },
  ]),
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <fog_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform vec3 uPlayer;
    varying vec4 vUv;
    varying vec3 vWorld;
    ${NOISE_GLSL}
    ${AWAKE_GLSL}
    ${HEIGHTMAP_GLSL}
    #include <fog_pars_fragment>

    void main() {
      vec2 p = vWorld.xz;
      float t = uTime;
      float aw = awakeAmt(p);
      float awF = awakeFront(p);

      // Player ripples.
      float dp = length(p - uPlayer.xz);
      float near = 1.0 - smoothstep(1.0, 4.0, abs(uPlayer.y - vWorld.y - 1.0));
      float ripple = sin(dp * 5.0 - t * 7.0) * exp(-dp * 0.45) * near;

      vec2 dist = vec2(snoise(vec3(p * 0.12, t * 0.22)), snoise(vec3(p * 0.12 + 17.0, t * 0.22))) * 0.018;
      dist += vec2(snoise(vec3(p * 0.7, t * 0.6)), snoise(vec3(p * 0.7 + 5.0, t * 0.6))) * 0.006;
      dist += normalize(p - uPlayer.xz + 0.001) * ripple * 0.03;

      vec4 uv = vUv;
      uv.xy += dist * uv.w;
      vec3 refl = texture2DProj(tDiffuse, uv).rgb;

      vec3 V = normalize(cameraPosition - vWorld);
      float fres = 0.12 + 0.88 * pow(1.0 - max(V.y, 0.0), 4.0);

      vec3 deep = mix(vec3(0.004, 0.008, 0.016), vec3(0.0, 0.03, 0.045), aw);
      vec3 col = mix(deep, refl * vec3(0.85, 0.92, 1.0), fres);

      // Bioluminescent plankton.
      float sp = pow(max(snoise(vec3(p * 0.9, t * 0.35)), 0.0), 7.0) + pow(max(snoise(vec3(p * 2.3, t * 0.8 + 4.0)), 0.0), 12.0);
      col += vec3(0.1, 0.75, 1.0) * sp * mix(0.05, 2.0, aw);

      // Shoreline glow.
      float ground = hmSample(p).r;
      float depth = vWorld.y - ground;
      float shore = 1.0 - smoothstep(0.0, 1.0, depth);
      col += vec3(0.25, 0.85, 1.0) * shore * mix(0.06, 0.9, aw) * (0.6 + 0.4 * sin(t * 1.7 + p.x * 0.25 + p.y * 0.2));

      col += vec3(0.4, 0.95, 1.0) * max(ripple, 0.0) * 0.35 * (0.3 + aw);
      col += AWAKE_FRONT_COLOR * awF * 0.8;
      col *= 1.0 - gloomAmt(vWorld) * 0.6;

      gl_FragColor = vec4(col, 1.0);
      #include <fog_fragment>
    }`,
};

export function createWater(awakening: Awakening, hf: Heightfield, mainCamera: PerspectiveCamera, resolution: number) {
  const geo = new CircleGeometry(LAKE.r * 1.35, 64);
  const w = Math.max(256, Math.floor(window.innerWidth * resolution));
  const h = Math.max(256, Math.floor(window.innerHeight * resolution));
  const water = new Reflector(geo, {
    textureWidth: w,
    textureHeight: h,
    clipBias: 0.003,
    color: 0xffffff,
    shader: WaterShader,
    multisample: 0,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, WATER_Y, LAKE.z);
  const mat = water.material as import('three').ShaderMaterial;
  mat.fog = true;
  mat.uniforms.uAwake = awakening.uniforms.uAwake;
  mat.uniforms.uGloom = awakening.uniforms.uGloom;
  mat.uniforms.uTime = awakening.uniforms.uTime;
  mat.uniforms.uHeight.value = hf.texture;

  // Reflections skip the grass layer (layer 1) to keep the extra pass cheap.
  const reflCam = (water as unknown as { getReflectionCamera(c: PerspectiveCamera): PerspectiveCamera }).getReflectionCamera(mainCamera);
  reflCam.layers.set(0);
  return water;
}
