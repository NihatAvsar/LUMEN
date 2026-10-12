import { MeshStandardMaterial, MeshStandardMaterialParameters, IUniform } from 'three';
import { NOISE_GLSL, AWAKE_GLSL } from '../shaders/chunks';
import type { Awakening } from './Awakening';

let awakening: Awakening;
export function setAwakening(a: Awakening) {
  awakening = a;
}
export function getAwakening() {
  return awakening;
}

const OCCLUDE_GLSL = /* glsl */ `
{
  vec3 ab = uViewTarget - cameraPosition;
  float abl = max(dot(ab, ab), 1e-4);
  float t = clamp(dot(vAwPos - cameraPosition, ab) / abl, 0.0, 1.0);
  float dLine = distance(vAwPos, cameraPosition + ab * t);
  float dCam = distance(vAwPos, cameraPosition);
  float fade = 1.0 - smoothstep(1.2, 3.2, dCam);
  fade = max(fade, (1.0 - smoothstep(1.0, 2.6, dLine)) * step(t, 0.9) * 0.85);
  float dither = lnHash12(floor(gl_FragCoord.xy));
  if (dither < fade) discard;
}
`;

// Cool moonlit rim so silhouettes read in the dark.
const RIM_GLSL = /* glsl */ `
{
  vec3 rimV = normalize(cameraPosition - vAwPos);
  float rim = pow(1.0 - abs(dot(normalize(vAwNrm), rimV)), 3.0);
  totalEmissiveRadiance += vec3(0.035, 0.055, 0.11) * rim * (1.0 + aw * 1.5);
}
`;

export interface AwakenOptions {
  key: string;
  /** Runs after the albedo is known; may modify `diffuseColor`. Has aw, awF, gloom. */
  color?: string;
  /** Adds to `totalEmissiveRadiance` (already scaled by aw). */
  emissive?: string;
  /** Extra uniforms / functions available in the fragment shader. */
  fragHead?: string;
  uniforms?: Record<string, IUniform>;
  /** Strength of the bright wave front glow. */
  frontGlow?: number;
  /** How grey/dark the sleeping world is (0..1, 1 = fully drained). */
  drain?: number;
  /** Dither away when between the camera and the player (foliage, trunks, rocks). */
  occlude?: boolean;
}

/**
 * Creates a MeshStandardMaterial that reacts to the awakening field:
 * desaturated and dark while asleep, vivid and glowing once awake.
 */
export function awakenMaterial(params: MeshStandardMaterialParameters, opts: AwakenOptions) {
  const mat = new MeshStandardMaterial(params);
  const drain = (opts.drain ?? 0.85).toFixed(3);
  const front = (opts.frontGlow ?? 0.55).toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAwake = awakening.uniforms.uAwake;
    shader.uniforms.uGloom = awakening.uniforms.uGloom;
    shader.uniforms.uTime = awakening.uniforms.uTime;
    shader.uniforms.uViewTarget = awakening.uniforms.uViewTarget;
    if (opts.uniforms) Object.assign(shader.uniforms, opts.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vAwPos;
varying vec3 vAwLocal;
varying vec3 vAwNrm;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 awWp = vec4(transformed, 1.0);
vec3 awN = objectNormal;
#ifdef USE_INSTANCING
  awWp = instanceMatrix * awWp;
  awN = mat3(instanceMatrix) * awN;
#endif
awWp = modelMatrix * awWp;
vAwPos = awWp.xyz;
vAwLocal = position;
vAwNrm = normalize(mat3(modelMatrix) * awN);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vAwPos;
varying vec3 vAwLocal;
varying vec3 vAwNrm;
uniform vec3 uViewTarget;
${NOISE_GLSL}
${AWAKE_GLSL}
${opts.fragHead ?? ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${opts.occlude ? OCCLUDE_GLSL : ''}
float aw = awakeAmt(vAwPos.xz);
float awF = awakeFront(vAwPos.xz);
float gloom = gloomAmt(vAwPos);
vec3 instCol = vec3(1.0);
#ifdef USE_COLOR
  instCol = vColor.rgb;
#endif
${opts.color ?? ''}
{
  float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  vec3 dull = vec3(lum) * vec3(0.55, 0.62, 0.82) * 0.75;
  diffuseColor.rgb = mix(mix(diffuseColor.rgb, dull, ${drain}), diffuseColor.rgb, aw);
  diffuseColor.rgb *= 1.0 - gloom * 0.75;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance *= aw;
${opts.emissive ?? ''}
${opts.occlude ? RIM_GLSL : ''}
totalEmissiveRadiance *= 1.0 - gloom * 0.9;
totalEmissiveRadiance += AWAKE_FRONT_COLOR * awF * ${front};`,
      );
  };
  mat.customProgramCacheKey = () => 'awaken-' + opts.key;
  return mat;
}
