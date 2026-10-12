/** Shared GLSL snippets. */

export const NOISE_GLSL = /* glsl */ `
vec3 lnMod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 lnMod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 lnPermute(vec4 x) { return lnMod289(((x * 34.0) + 1.0) * x); }
vec4 lnTaylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = lnMod289(i);
  vec4 p = lnPermute(lnPermute(lnPermute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = lnTaylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float lnHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = lnHash12(i), b = lnHash12(i + vec2(1.0, 0.0));
  float c = lnHash12(i + vec2(0.0, 1.0)), d = lnHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`;

/**
 * Awakening field: up to 8 expanding waves of life (xz centre, radius, front intensity)
 * plus "gloom" from nearby Extinguishers (xyz, strength).
 */
export const AWAKE_GLSL = /* glsl */ `
uniform vec4 uAwake[8];
uniform vec4 uGloom[12];
uniform float uTime;

float awakeNoise(vec2 p) {
  return (vnoise(p * 0.06) - 0.5) * 14.0 + (vnoise(p * 0.21) - 0.5) * 4.0;
}

float awakeAmt(vec2 p) {
  float n = awakeNoise(p);
  float a = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 w = uAwake[i];
    float d = length(p - w.xy) + n;
    a = max(a, (1.0 - smoothstep(w.z - 10.0, w.z, d)) * clamp(w.z * 0.1, 0.0, 1.0));
  }
  return a;
}

float awakeFront(vec2 p) {
  float n = awakeNoise(p);
  float f = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 w = uAwake[i];
    if (w.w <= 0.001) continue;
    float d = length(p - w.xy) + n;
    float x = (d - w.z) * 0.28;
    f += exp(-x * x) * w.w;
  }
  return f;
}

float gloomAmt(vec3 p) {
  float g = 0.0;
  for (int i = 0; i < 12; i++) {
    vec4 s = uGloom[i];
    if (s.w <= 0.001) continue;
    float d = distance(p, s.xyz);
    g += (1.0 - smoothstep(1.5, 9.0, d)) * s.w;
  }
  return clamp(g, 0.0, 1.0);
}

const vec3 AWAKE_FRONT_COLOR = vec3(0.45, 1.0, 0.85);
`;
