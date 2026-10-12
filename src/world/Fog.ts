import { ShaderChunk } from 'three';
import { MOON_DIR, WATER_Y } from '../config';

/**
 * Replaces three.js' fog with a height-aware exponential fog that also
 * scatters some moonlight. Must run before any material compiles.
 */
export function installFog() {
  const m = MOON_DIR;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;

  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);
#endif`;

  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogH = exp(-max(vFogWorld.y - (${WATER_Y.toFixed(2)}), 0.0) * 0.05);
    float fogD = vFogDepth * fogDensity;
    float fogFactor = 1.0 - exp(-fogD * fogD * (0.55 + 1.1 * fogH));
    vec3 fogView = normalize(vFogWorld - cameraPosition);
    float fogMoon = pow(max(dot(fogView, vec3(${m.x.toFixed(4)}, ${m.y.toFixed(4)}, ${m.z.toFixed(4)})), 0.0), 5.0);
    vec3 fogC = fogColor + vec3(0.05, 0.07, 0.13) * fogMoon;
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    vec3 fogC = fogColor;
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogFactor);
#endif`;
}
