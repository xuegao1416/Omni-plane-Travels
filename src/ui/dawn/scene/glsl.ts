/**
 * Shared GLSL snippets for the 晨雾琉璃 scene. Everything the scene shows is
 * computed from these functions: there are no image assets.
 */

/** Hashes and 2D value noise (Dave Hoskins style hashes, no sin()). */
export const NOISE_2D = /* glsl */ `
float hash11(float p) { p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float hash13(vec3 p3) { p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm2(vec2 p) {
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = m * p; a *= .5; }
  return v;
}
float fbm2lo(vec2 p) {
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = m * p; a *= .5; }
  return v;
}
// Interleaved gradient noise: cheap per-pixel jitter for ray marching.
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(.06711056, .00583715)))); }
`;

/**
 * 3D noise read from the baked 64³ tileable volume (see noiseVolume.ts).
 * R: 4-octave gradient fbm, G: inverted Worley (billows), B: high-frequency fbm, A: fine Worley.
 */
export const NOISE_3D = /* glsl */ `
precision highp sampler3D;
uniform sampler3D tNoise;
vec4 vol(vec3 p) { return texture(tNoise, p); }
float volFbm(vec3 p) { return texture(tNoise, p).r; }
`;

/** Filmic helpers shared by passes. */
export const COLOR = /* glsl */ `
vec3 acesFilm(vec3 x) {
  // Stephen Hill's fit of the ACES RRT + ODT.
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  vec3 v = inM * x;
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(outM * (a / b), 0., 1.);
}
// Per-channel ACES bleaches bright saturated colour (fire turns cream, sky turns
// milky). Blend it with a hue-preserving curve on the max channel, which itself
// drifts toward white only deep in the highlights (sun disc, fire core).
vec3 filmic(vec3 x, float keep) {
  vec3 a = acesFilm(x);
  float m = max(max(x.r, x.g), x.b);
  float mt = acesFilm(vec3(m)).g;
  vec3 h = x * (mt / max(m, 1e-5));
  h = mix(h, vec3(mt), smoothstep(2., 16., m) * .7);
  return mix(a, h, keep);
}
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.)), vec3(1. / 2.4)) - .055, step(vec3(.0031308), c));
}
float luma(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
// Black-body-ish ramp for flame temperature t in 0..1 (deep red → orange → gold → white).
vec3 flameRamp(float t) {
  t = clamp(t, 0., 1.);
  vec3 c = mix(vec3(.5, .05, .01), vec3(1., .26, .03), smoothstep(.0, .3, t));
  c = mix(c, vec3(1., .55, .12), smoothstep(.25, .6, t));
  c = mix(c, vec3(1., .82, .45), smoothstep(.55, .85, t));
  c = mix(c, vec3(1., .96, .86), smoothstep(.85, 1., t));
  return c;
}
`;

/** Henyey–Greenstein phase function. */
export const PHASE = /* glsl */ `
float phaseHG(float c, float g) {
  float g2 = g * g;
  return (1. - g2) / (12.5663706 * pow(max(1. + g2 - 2. * g * c, 1e-4), 1.5));
}
`;
