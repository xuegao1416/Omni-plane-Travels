import {
AddEquation,
AdditiveBlending,
CustomBlending,
OneFactor,
OneMinusSrcAlphaFactor,
BackSide,
Color,
CubeTexture,
DoubleSide,
FrontSide,
GLSL3,
LinearFilter,
Matrix4,
Mesh,
OrthographicCamera,
PlaneGeometry,
RawShaderMaterial,
RepeatWrapping,
RGBAFormat,
Scene,
ShaderMaterial,
Texture,
UnsignedByteType,
Vector2,
Vector3,
WebGL3DRenderTarget,
type WebGLRenderer,
} from 'three';
import { COLOR,NOISE_2D,NOISE_3D,PHASE } from './glsl';

/**
 * Hand-written shaders for everything that standard PBR cannot do well:
 * faceted refracting crystals, the ray-marched bonfire, embers, sunlit dust,
 * the sky with its cloud sea and far crystal peaks, and the hall light columns.
 */

/* ─── 3D noise volume ────────────────────────────────────────────────────── */

const NOISE_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }
`;

const NOISE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform float uZ;
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
vec3 grad(vec3 c, float P) { return normalize(hash33(mod(c, P)) * 2. - 1. + 1e-4); }
float gnoise(vec3 p, float P) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  float a = dot(grad(i, P), f);
  float b = dot(grad(i + vec3(1, 0, 0), P), f - vec3(1, 0, 0));
  float c = dot(grad(i + vec3(0, 1, 0), P), f - vec3(0, 1, 0));
  float d = dot(grad(i + vec3(1, 1, 0), P), f - vec3(1, 1, 0));
  float e = dot(grad(i + vec3(0, 0, 1), P), f - vec3(0, 0, 1));
  float g = dot(grad(i + vec3(1, 0, 1), P), f - vec3(1, 0, 1));
  float h = dot(grad(i + vec3(0, 1, 1), P), f - vec3(0, 1, 1));
  float k = dot(grad(i + vec3(1, 1, 1), P), f - vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
float worley(vec3 p, float P) {
  vec3 id = floor(p), f = fract(p);
  float md = 1.;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(x, y, z);
    vec3 r = o + hash33(mod(id + o, P)) - f;
    md = min(md, dot(r, r));
  }
  return 1. - sqrt(md);
}
void main() {
  vec3 p = vec3(vUv, uZ);
  float f = 0., a = .5, P = 4.;
  for (int i = 0; i < 5; i++) { f += a * gnoise(p * P, P); P *= 2.; a *= .5; }
  float hf = 0.; a = .5; P = 8.;
  for (int i = 0; i < 4; i++) { hf += a * gnoise(p * P, P); P *= 2.; a *= .5; }
  float w = worley(p * 4., 4.) * .625 + worley(p * 8., 8.) * .25 + worley(p * 16., 16.) * .125;
  float w2 = worley(p * 12., 12.);
  outColor = vec4(clamp(f * .9 + .5, 0., 1.), w, clamp(hf * .9 + .5, 0., 1.), w2);
}
`;

/** Tileable 64³ RGBA noise (fbm, billow Worley, high fbm, fine Worley), generated on the GPU. */
export function bakeNoiseVolume(renderer: WebGLRenderer, size = 64) {
  const target = new WebGL3DRenderTarget(size, size, size, { format: RGBAFormat, type: UnsignedByteType, depthBuffer: false });
  const tex = target.texture;
  tex.wrapS = tex.wrapT = tex.wrapR = RepeatWrapping;
  tex.minFilter = tex.magFilter = LinearFilter;
  tex.generateMipmaps = false;
  const material = new RawShaderMaterial({ vertexShader: NOISE_VERT, fragmentShader: NOISE_FRAG, glslVersion: GLSL3, uniforms: { uZ: { value: 0 } } });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  for (let z = 0; z < size; z++) {
    material.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(target, z);
    renderer.render(scene, camera);
  }
  renderer.setRenderTarget(previous);
  material.dispose();
  quad.geometry.dispose();
  return target;
}

/* ─── Shared light uniforms ──────────────────────────────────────────────── */

export interface SharedUniforms {
  uTime: { value: number };
  uSunDir: { value: Vector3 };
  uSunColor: { value: Vector3 };
  uFirePos: { value: Vector3 };
  uFireColor: { value: Vector3 };
  uFireLight: { value: number };
  tNoise: { value: Texture | null };
  tShadow: { value: Texture | null };
  uShadowMatrix: { value: Matrix4 };
  uResolution: { value: Vector2 };
  uPixelRatio: { value: number };
  /** xz of the bonfire's vertical axis. */
  uFireAxis: { value: Vector2 };
  /** Crystal layering around the flames (see CrystalPass). */
  uCrystalPass: { value: number };
}

/**
 * Crystals are drawn in two halves around the bonfire (pipeline.ts): first the
 * fragments that lie beyond the point where their view ray passes the fire's
 * axis, then the fire, then the fragments on the near side. No crystal stands
 * inside the flame volume, so the split always falls between the stones and the
 * flames on any ray that crosses both. 0 draws everything in one pass.
 */
export type CrystalPass = -1 | 0 | 1;
export const CRYSTAL_PASS = { all: 0, beyondFire: 1, nearFire: -1 } as const satisfies Record<string, CrystalPass>;

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new Vector3(-0.55, 0.62, -0.56).normalize() },
    uSunColor: { value: new Vector3(1, 0.93, 0.8) },
    uFirePos: { value: new Vector3(0, 2.6, 0) },
    uFireColor: { value: new Vector3(1, 0.5, 0.18) },
    uFireLight: { value: 1 },
    tNoise: { value: null },
    tShadow: { value: null },
    uShadowMatrix: { value: new Matrix4() },
    uResolution: { value: new Vector2(1, 1) },
    uPixelRatio: { value: 1 },
    uFireAxis: { value: new Vector2(0, 0) },
    uCrystalPass: { value: 0 },
  };
}

/* ─── Crystal ────────────────────────────────────────────────────────────── */

const CRYSTAL_VERT = /* glsl */ `
attribute vec3 edge;
attribute float cseed;
attribute float ctint;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vEdge;
varying float vSeed;
varying float vTint;
varying vec3 vLocal;
void main() {
  vec4 p = vec4(position, 1.);
  vec3 n = normal;
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  n = mat3(instanceMatrix) * n;
  #endif
  vec4 w = modelMatrix * p;
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * n);
  vEdge = edge;
  vSeed = cseed;
  vTint = ctint;
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const CRYSTAL_FRAG = /* glsl */ `
precision highp sampler2DShadow;
uniform samplerCube tEnv;
uniform sampler2D tScene;
uniform float uSceneOn;
uniform vec2 uResolution;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uFirePos;
uniform vec3 uFireColor;
uniform float uFireLight;
uniform float uTime;
uniform vec3 uGlowColor;
uniform float uGlow;
uniform float uEdge;
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMatrix;
uniform vec2 uFireAxis;
uniform float uCrystalPass;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vEdge;
varying float vSeed;
varying float vTint;
varying vec3 vLocal;
${NOISE_2D}
void main() {
  if (uCrystalPass != 0.) {
    // Where along the view ray (fragment at 1) it passes closest to the fire's axis.
    vec3 ray = vWorld - cameraPosition;
    float flat2 = dot(ray.xz, ray.xz);
    float tAxis = flat2 > 1e-6 ? dot(uFireAxis - cameraPosition.xz, ray.xz) / flat2 : 2.;
    if ((1. - tAxis) * uCrystalPass < 0.) discard;
  }
  vec3 N = normalize(vNormalW);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(cameraPosition - vWorld);
  float NdV = clamp(dot(N, V), 0., 1.);
  float F = .05 + .95 * pow(1. - NdV, 5.);
  vec3 R = reflect(-V, N);
  vec3 refl = textureLod(tEnv, R, 1.).rgb;

  // Per-facet inner mirror: light refracts in, bounces off a hidden facet, refracts out.
  vec3 jit = vec3(hash11(vSeed * 91.7), hash11(vSeed * 37.1 + 3.), hash11(vSeed * 13.3 + 7.)) - .5;
  vec3 Nb = normalize(-N + jit * 1.3);
  vec3 iors = vec3(1.56, 1.6, 1.645);
  vec3 refr = vec3(0.);
  vec2 suvBase = gl_FragCoord.xy / uResolution;
  for (int c = 0; c < 3; c++) {
    vec3 T = refract(-V, N, 1. / iors[c]);
    vec3 To = refract(T, -Nb, iors[c]);
    if (dot(To, To) < .01) To = reflect(T, -Nb);
    float envc = textureLod(tEnv, To, 2.).rgb[c];
    float scr = envc;
    if (uSceneOn > .5) {
      vec2 dv = (viewMatrix * vec4(To + V, 0.)).xy;
      vec2 suv = clamp(suvBase + dv * .07, vec2(.002), vec2(.998));
      scr = textureLod(tScene, suv, 1.).rgb[c];
    }
    refr[c] = mix(envc, scr, .62);
  }

  // Beer–Lambert absorption: teal stones swallow red.
  float thick = mix(.35, 1.5, 1. - NdV) * (.75 + .5 * hash11(vSeed * 7.));
  vec3 kDeep = vec3(2.3, .34, .52);
  vec3 kPale = vec3(.55, .1, .16);
  refr *= exp(-mix(kPale, kDeep, vTint) * thick);

  // Inner light: drifting veins and a slow pulse.
  float vein = smoothstep(.55, .95, vnoise(vLocal.xy * 5.5 + vLocal.z * 3. + vSeed * 17.));
  float pulse = .7 + .3 * sin(uTime * .9 + vSeed * 6.2831);
  vec3 glow = uGlowColor * uGlow * (.25 + vein * .9) * pulse * mix(.5, 1., vTint);

  // Firelight passing through the stone.
  vec3 toF = uFirePos - vWorld;
  float dF = length(toF);
  vec3 Lf = toF / dF;
  float through = clamp(dot(-N, Lf) * .5 + .5, 0., 1.);
  vec3 fireT = uFireColor * uFireLight * (.2 + through * .9) / (1. + dF * dF * .09);
  fireT *= mix(vec3(1.), vec3(.55, 1., .85), vTint * .7);

  // Sun visibility for glints.
  vec4 sc = uShadowMatrix * vec4(vWorld + N * .05, 1.);
  float lit = 1.;
  if (sc.x > 0. && sc.x < 1. && sc.y > 0. && sc.y < 1. && sc.z < 1.) lit = texture(tShadow, vec3(sc.xy, sc.z - .001));
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.), 700.) * 60. * lit;
  vec3 Hf = normalize(Lf + V);
  float specF = pow(max(dot(N, Hf), 0.), 240.) * 10. * uFireLight / (1. + dF * dF * .08);
  float sparkle = pow(hash11(vSeed * 3.7 + floor(uTime * 2.3 + vSeed * 9.)), 40.) * 6. * lit * pow(1. - NdV, .5);

  float e = min(min(vEdge.x, vEdge.y), vEdge.z);
  float fw = fwidth(e);
  float edgeLine = 1. - smoothstep(fw * .6, fw * 2., e);
  vec3 edgeCol = mix(vec3(.82, 1., .96), vec3(1., .93, .78), .35) * uEdge * (.35 + F * 1.5 + lit * .4);

  vec3 col = refl * F * 1.25 + refr * (1. - F) + glow + fireT * .55 + uSunColor * (spec + sparkle) + uFireColor * specF + edgeLine * edgeCol;
  gl_FragColor = vec4(col, 1.);
}
`;

export interface CrystalUniforms extends SharedUniforms {
  tEnv: { value: CubeTexture | Texture | null };
  tScene: { value: Texture | null };
  uSceneOn: { value: number };
  uGlowColor: { value: Color };
  uGlow: { value: number };
  uEdge: { value: number };
}

export function crystalMaterial(shared: SharedUniforms, extra: { glow?: number; glowColor?: string; edge?: number } = {}) {
  const uniforms: CrystalUniforms = {
    ...shared,
    tEnv: { value: null },
    tScene: { value: null },
    uSceneOn: { value: 1 },
    uGlowColor: { value: new Color(extra.glowColor ?? '#3fe0c6') },
    uGlow: { value: extra.glow ?? 0.35 },
    uEdge: { value: extra.edge ?? 0.9 },
  };
  const material = new ShaderMaterial({
    uniforms: uniforms as unknown as ShaderMaterial['uniforms'],
    vertexShader: CRYSTAL_VERT,
    fragmentShader: CRYSTAL_FRAG,
    side: FrontSide,
  });
  return { material, uniforms };
}

/* ─── Bonfire volume ─────────────────────────────────────────────────────── */

const FIRE_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FIRE_FRAG = /* glsl */ `
uniform vec3 uOrigin;
uniform float uRadius;
uniform float uBound;
uniform float uHeight;
uniform float uTime;
uniform float uIntensity;
uniform float uFlare;
uniform int uSteps;
uniform sampler2D tSceneDepth;
uniform float uDepthOn;
uniform vec2 uResolution;
varying vec3 vWorld;
${NOISE_2D}
${NOISE_3D}
${COLOR}
// Upward-scrolling turbulence, stretched along the flow; small eddies rise faster.
// Lobes shape the licks; the fine octaves rag their edges and streak their insides.
// Both are centred on 0 with a spread of roughly ±.5.
float lobeNoise(vec3 q, float t) {
  float a = texture(tNoise, vec3(q.x * .19, q.y * .1 - t * .52, q.z * .19)).r;
  float b = texture(tNoise, vec3(q.x * .47 + .31, q.y * .25 - t * 1.1, q.z * .47 + .57)).b;
  return (a * .6 + b * .4 - .5) * 2.4;
}
float fineNoise(vec3 q, float t) {
  float c = texture(tNoise, vec3(q.x * 1.05 + .63, q.y * .55 - t * 2.1, q.z * 1.05 + .23)).r;
  float d = texture(tNoise, vec3(q.x * 2.3 + .17, q.y * 1.25 - t * 3.4, q.z * 2.3 + .41)).b;
  return (c * .62 + d * .38 - .5) * 2.4;
}
// One flame tongue: 1 on its axis, 0 at its skin. xz in fire radii, h in fire heights.
float tongue(vec2 xz, float h, vec2 c, float top, float rad) {
  float u = h / top;
  if (u >= 1.) return -1.;
  // Air drawn in at the base pushes the side tongues toward the central plume.
  vec2 axis = c * (1. - .5 * u * (2. - u));
  float R = rad * (.72 + .28 * smoothstep(0., .14, u)) * pow(1. - u, .62);
  return 1. - length(xz - axis) / max(R, 1e-3);
}
// Black-body colour for the flame, normalised temperature k (≈1000 K → 2600 K).
vec3 fireColor(float k) {
  vec3 c = mix(vec3(.62, .035, .004), vec3(.95, .13, .012), smoothstep(0., .3, k));
  c = mix(c, vec3(1., .3, .04), smoothstep(.25, .55, k));
  c = mix(c, vec3(1., .5, .1), smoothstep(.5, .8, k));
  c = mix(c, vec3(1., .68, .22), smoothstep(.78, 1., k));
  return c;
}
// x: flame (0..1), the luminous gas fraction; y: normalised temperature.
vec2 fireField(vec3 p) {
  float H = uHeight * (1. + uFlare * .35);
  float h = p.y / H;
  if (h <= 0. || h >= 1.) return vec2(0.);
  float t = uTime;
  vec3 q = p;
  // The whole column sways, the top more than the base.
  q.xz -= vec2(sin(t * .71 + p.y * .35), cos(t * .53 + p.y * .29)) * .12 * h * h * uRadius;
  // Large rising eddies bend the licks sideways; the warp grows with height.
  vec3 wq = vec3(q.x * .07, q.y * .045 - t * .24, q.z * .07);
  vec2 w = (vec2(texture(tNoise, wq).r, texture(tNoise, wq + vec3(.37, .11, .73)).r) - .5) * 4.;
  q.xz += w * uRadius * (.06 + .5 * h);
  vec2 xz = q.xz / uRadius;
  // A broad burning mass over the logs…
  float hb = h / .36;
  float shape = hb < 1. ? 1. - length(xz) / max(.94 * sqrt(1. - hb * hb) * (.8 + .2 * smoothstep(0., .25, hb)), 1e-3) : -1.;
  // …from which six tongues of different heights lick upward, leaning in and swaying.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float a = fi * 1.0472 + .4 + .35 * sin(fi * 2.3);
    float top = .36 + .4 * fract(fi * .618 + .2) + .09 * sin(t * (1.1 + fi * .23) + fi * 1.7);
    vec2 c = vec2(cos(a), sin(a)) * (.3 + .28 * fract(fi * .37 + .1));
    vec2 lean = vec2(sin(t * (.8 + fi * .13) + fi * 2.9), cos(t * (.7 + fi * .11) + fi * 1.3)) * .16;
    shape = max(shape, tongue(xz - lean * h * h, h, c, top, .3 + .12 * fract(fi * .71)));
  }
  // Big rising lobes carve the licks; fine turbulence rags their edges. Both grow
  // with height so the tips tear off while the base stays whole.
  float nl = lobeNoise(q, t);
  float nf = fineNoise(q, t);
  float f = shape + nl * (1. + 1.6 * h) + nf * (.18 + .4 * h) - .06 - .22 * h;
  // Rising puffs (~1 Hz, the flicker of a fire this size) pinch the upper flame into separate licks.
  f -= h * h * (.25 + .25 * sin(p.y * 2.4 - t * 6.2 + nl * 4.));
  f *= smoothstep(0., .035, h);
  f *= smoothstep(uBound, uBound * .82, length(p.xz));
  // A crisp skin: the luminous gas fills the eroded shape.
  float d = smoothstep(0., .07, f);
  // Hottest deep inside and low down; the skin and the tips run cooler. The fine
  // turbulence streaks the temperature so the body is not one flat colour.
  float temp = clamp(.3 + .6 * smoothstep(0., .8, f) + .18 * shape * (1. - h) - .3 * h + .18 * nf, 0., 1.);
  return vec2(d, temp);
}
vec2 cylHit(vec3 ro, vec3 rd, float R) {
  float a = dot(rd.xz, rd.xz);
  float b = dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - R * R;
  float disc = b * b - a * c;
  if (disc < 0.) return vec2(1e9, -1e9);
  float s = sqrt(disc);
  return vec2((-b - s) / a, (-b + s) / a);
}
void main() {
  vec3 ro = cameraPosition - uOrigin;
  vec3 rd = normalize(vWorld - cameraPosition);
  float H = uHeight * (1. + uFlare * .35);
  vec2 tc = cylHit(ro, rd, uBound);
  vec2 ty = vec2((0. - ro.y) / rd.y, (H - ro.y) / rd.y);
  if (ty.x > ty.y) ty = ty.yx;
  float t0 = max(max(tc.x, ty.x), 0.);
  float t1 = min(tc.y, ty.y);
  if (uDepthOn > .5) {
    // Stop at the opaque surface (logs, coals, the bowl): view depth → distance along the ray.
    vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    float zv = texture(tSceneDepth, gl_FragCoord.xy / uResolution).r;
    t1 = min(t1, zv / max(dot(rd, fwd), 1e-3));
  }
  if (t1 <= t0) discard;
  float steps = float(uSteps);
  float dt = (t1 - t0) / steps;
  float jit = ign(gl_FragCoord.xy + fract(uTime * 7.13) * 17.);
  vec3 E = vec3(0.);
  float T = 1.;
  for (int i = 0; i < 64; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);
    vec2 ft = fireField(p);
    if (ft.x > .002) {
      float k = ft.y;
      // Black-body: colour from temperature, radiance rising steeply with it. This is
      // the brightness of optically thick flame, well above sunlit marble.
      float k2 = k * k;
      vec3 S = fireColor(k) * (1.2 + 8. * k2 * k2);
      // Hot glowing soot is thick; the cool ragged tips are thin and let the hall through.
      float a = 1. - exp(-ft.x * (.8 + 2.8 * k) * dt);
      E += T * S * a;
      T *= 1. - a;
    }
  }
  // Premultiplied: emission plus soot occlusion, so the flame keeps its colour over white marble.
  gl_FragColor = vec4(E * uIntensity, 1. - T);
}
`;

/** The march volume is wider than the flame so wind-bent licks are not clipped. */
export const FIRE_BOUND_SCALE = 1.3;

export function fireMaterial(shared: SharedUniforms, origin: Vector3, radius: number, height: number) {
  const uniforms = {
    tNoise: shared.tNoise,
    uTime: shared.uTime,
    uOrigin: { value: origin },
    uRadius: { value: radius },
    uBound: { value: radius * FIRE_BOUND_SCALE },
    uHeight: { value: height },
    uIntensity: { value: 1 },
    uFlare: { value: 0 },
    uSteps: { value: 32 },
    tSceneDepth: { value: null as Texture | null },
    uDepthOn: { value: 0 },
    uResolution: shared.uResolution,
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    transparent: true,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    depthWrite: false,
    side: FrontSide,
  });
  return { material, uniforms };
}

/* ─── Embers ─────────────────────────────────────────────────────────────── */

const EMBER_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uFlare;
uniform vec3 uOrigin;
uniform vec2 uResolution;
uniform float uPixelRatio;
varying float vAge;
varying float vBright;
varying vec2 vVel;
varying float vStretch;
vec3 emberPos(float t, vec4 s) {
  vec3 p = uOrigin + vec3((s.x - .5) * 1.8, .9 + s.y * .8, (s.z - .5) * 1.8);
  // Thrown up by the plume, then drag takes over and they drift on the warm air.
  float rise = 1.3 + s.w * 1.9 + uFlare * 2.;
  p.y += rise * 1.45 * (1. - exp(-t * 1.1)) + t * .35;
  float sw = t * (.9 + s.x * 1.6);
  float rad = .15 + t * (.25 + s.z * .35);
  p.x += sin(sw + s.y * 6.2831) * rad;
  p.z += cos(sw * .8 + s.w * 6.2831) * rad;
  return p;
}
void main() {
  float life = 1.1 + aSeed.y * 2.4;
  float age01 = fract((uTime + aSeed.w * 37.) / life);
  float t = age01 * life;
  vec3 p = emberPos(t, aSeed);
  vec3 p2 = emberPos(t + .045, aSeed);
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vec4 c1 = projectionMatrix * mv;
  vec4 c2 = projectionMatrix * (modelViewMatrix * vec4(p2, 1.));
  vec2 vel = (c2.xy / c2.w - c1.xy / c1.w) * uResolution * .5;
  float speed = length(vel);
  vVel = speed > 1e-3 ? vel / speed : vec2(0., 1.);
  vStretch = clamp(speed * .3, 1., 3.5);
  vAge = age01;
  float flick = .55 + .45 * sin(uTime * 17. + aSeed.x * 91.);
  vBright = (1. - age01) * (1. - age01) * flick * smoothstep(0., .06, age01) * (1. + uFlare);
  float size = (.6 + aSeed.z * aSeed.z * 1.6) * 20. / max(-mv.z, .5);
  gl_PointSize = clamp(size * vStretch * uPixelRatio, 1.5, 40.);
  gl_Position = c1;
}
`;

const EMBER_FRAG = /* glsl */ `
varying float vAge;
varying float vBright;
varying vec2 vVel;
varying float vStretch;
${COLOR}
void main() {
  vec2 q = gl_PointCoord - .5;
  q.y = -q.y;
  vec2 r = vec2(dot(q, vVel), dot(q, vec2(-vVel.y, vVel.x)));
  float d = length(vec2(r.x * 2., r.y * 2. * vStretch));
  float a = smoothstep(1., .0, d);
  a *= a;
  if (a < .003) discard;
  // Sparks leave the flame yellow-orange and cool to a dull red as they climb.
  vec3 c = flameRamp(.8 - vAge * .62) * (1.5 + 4.5 * (1. - vAge));
  float k = a * clamp(vBright, 0., 1.);
  gl_FragColor = vec4(c * a * vBright, k * .6);
}
`;

export function emberMaterial(shared: SharedUniforms, origin: Vector3) {
  const uniforms = {
    uTime: shared.uTime,
    uResolution: shared.uResolution,
    uPixelRatio: shared.uPixelRatio,
    uFlare: { value: 0 },
    uOrigin: { value: origin },
  };
  return {
    material: new ShaderMaterial({
      uniforms, vertexShader: EMBER_VERT, fragmentShader: EMBER_FRAG, transparent: true, depthWrite: false,
      blending: CustomBlending, blendEquation: AddEquation, blendSrc: OneFactor, blendDst: OneMinusSrcAlphaFactor,
    }),
    uniforms,
  };
}

/* ─── Sunlit dust ────────────────────────────────────────────────────────── */

const MOTE_VERT = /* glsl */ `
precision highp sampler2DShadow;
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uSunDir;
uniform sampler2DShadow tShadow;
uniform mat4 uShadowMatrix;
uniform float uPixelRatio;
varying float vBright;
void main() {
  float ang = aSeed.x * 6.2831853 + uTime * .006 * (aSeed.y - .5);
  float rad = sqrt(aSeed.y) * 15.5;
  float y = .3 + pow(aSeed.z, 1.3) * 17.;
  vec3 p = vec3(cos(ang) * rad, y, sin(ang) * rad);
  p += vec3(sin(uTime * .11 + aSeed.w * 40.), sin(uTime * .07 + aSeed.x * 30.) * .7, cos(uTime * .09 + aSeed.z * 50.)) * .7;
  vec4 sc = uShadowMatrix * vec4(p, 1.);
  float lit = 1.;
  if (sc.x > 0. && sc.x < 1. && sc.y > 0. && sc.y < 1. && sc.z < 1.) lit = texture(tShadow, vec3(sc.xy, sc.z - .002));
  vec4 mv = modelViewMatrix * vec4(p, 1.);
  vec3 V = normalize(cameraPosition - p);
  float mu = dot(-V, uSunDir);
  float phase = .25 + 3. * pow(max(mu, 0.), 5.);
  float tw = .55 + .45 * sin(uTime * (1.3 + aSeed.w * 2.6) + aSeed.x * 60.);
  vBright = (lit * phase + .04) * tw;
  float size = (.6 + aSeed.w * 1.4) * 24. / max(-mv.z, .5);
  gl_PointSize = clamp(size * uPixelRatio, 1., 7.);
  gl_Position = projectionMatrix * mv;
}
`;

const MOTE_FRAG = /* glsl */ `
varying float vBright;
void main() {
  float d = length(gl_PointCoord - .5) * 2.;
  float a = smoothstep(1., 0., d);
  a = a * a * a;
  if (a < .004) discard;
  gl_FragColor = vec4(vec3(1., .96, .86) * a * vBright * 1.6, 1.);
}
`;

export function moteMaterial(shared: SharedUniforms) {
  return new ShaderMaterial({
    uniforms: { uTime: shared.uTime, uSunDir: shared.uSunDir, tShadow: shared.tShadow, uShadowMatrix: shared.uShadowMatrix, uPixelRatio: shared.uPixelRatio },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/* ─── Sky ────────────────────────────────────────────────────────────────── */

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.);
  vDir = w.xyz - cameraPosition;
  vec4 c = projectionMatrix * viewMatrix * w;
  gl_Position = c.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
varying vec3 vDir;
${NOISE_2D}
float ring1(float az, float k, float s) { return fbm2(vec2(cos(az), sin(az)) * k + s); }
float cloudDensity(vec2 uv) { return fbm2(uv * .45) * .74 + fbm2lo(uv * 1.7 + 3.) * .36; }
vec3 skyColor(vec3 d) {
  float y = d.y;
  float mu = dot(d, uSunDir);
  vec3 zenith = vec3(.13, .38, .76);
  vec3 horizon = vec3(.84, .93, .97);
  vec3 col = mix(horizon, zenith, pow(clamp(y, 0., 1.), .46));
  vec2 dh = normalize(d.xz + 1e-5);
  float sunAz = max(dot(dh, normalize(uSunDir.xz)), 0.);
  col += vec3(1., .84, .62) * pow(1. - clamp(abs(y), 0., 1.), 7.) * (.12 + .42 * pow(sunAz, 3.));
  col += uSunColor * (pow(max(mu, 0.), 5.) * .22 + pow(max(mu, 0.), 40.) * .8 + pow(max(mu, 0.), 700.) * 5.);
  col += uSunColor * smoothstep(.99955, .9998, mu) * 60.;

  // Pale planet hanging in the day sky (upper right), with a faint ring.
  vec3 P = normalize(vec3(.62, .4, -.68));
  float cp = dot(d, P);
  float rho = .27;
  vec3 Tx = normalize(cross(P, vec3(0., 1., 0.)));
  vec3 Ty = cross(Tx, P);
  vec2 q = vec2(dot(d, Tx), dot(d, Ty)) / sin(rho);
  float qr = length(q);
  if (cp > 0.) {
    float ring = 0.;
    vec2 rq = mat2(.94, .34, -.34, .94) * q;
    float e = length(rq * vec2(1., 3.6));
    ring = smoothstep(1.32, 1.4, e) * (1. - smoothstep(1.62, 1.74, e)) * (.7 + .3 * sin(e * 60.));
    ring *= (rq.y > 0. && qr < 1.) ? 0. : 1.;
    if (qr < 1.) {
      vec3 n = vec3(q, sqrt(1. - qr * qr));
      vec3 ls = normalize(vec3(-.8, .5, .45));
      float lamb = clamp(dot(n, ls), 0., 1.);
      float land = smoothstep(.48, .62, fbm2(q * 2.6 + vec2(uTime * .002, 0.) + 4.));
      vec3 pc = mix(vec3(.66, .86, .88), vec3(.97, .99, .98), land) * (.45 + .75 * lamb);
      float limb = smoothstep(1., .9, qr);
      col = mix(col, pc, .36 * limb);
      col += vec3(.7, .95, 1.) * pow(qr, 8.) * .18 * limb;
    }
    col = mix(col, vec3(.95, .99, 1.), ring * .22);
  }

  // Fair-weather cumulus on a high plane: thicker toward the horizon, lit from the sun's side.
  if (y > 0.) {
    vec2 uv = d.xz / (y + .12) * .62 + vec2(uTime * .006, uTime * .002);
    float c = cloudDensity(uv);
    float cover = smoothstep(.5, .74, c) * smoothstep(.0, .22, y);
    if (cover > 0.) {
      // Self-shadowing: density a step toward the sun says how deep inside the cloud we are.
      float cs = cloudDensity(uv + normalize(uSunDir.xz) * .09);
      float lit = clamp((c - cs) * 5. + .58, 0., 1.);
      float rim = pow(max(mu, 0.), 6.) * smoothstep(.74, .5, c);
      vec3 bright = vec3(1.1, 1.07, 1.02) * 1.45 + uSunColor * (pow(max(mu, 0.), 3.) * .5 + rim * .9);
      vec3 shade = vec3(.56, .68, .8);
      vec3 cc = mix(shade, bright, lit);
      col = mix(col, cc, cover * .92);
    }
  }

  // Far peaks rising out of the cloud sea, with crystal spires catching the sun.
  float az = atan(d.z, d.x);
  float h1 = .015 + .075 * pow(ring1(az, 2.2, 1.3), 2.2);
  float h2 = -.004 + .11 * pow(ring1(az, 3.4, 7.1), 2.6);
  float slope1 = ring1(az + .02, 2.2, 1.3) - ring1(az - .02, 2.2, 1.3);
  float slope2 = ring1(az + .02, 3.4, 7.1) - ring1(az - .02, 3.4, 7.1);
  float sunSide = sign(dot(vec2(-dh.y, dh.x), normalize(uSunDir.xz)));
  if (y < h1) {
    vec3 m = mix(vec3(.66, .78, .79), horizon, .55) * (1. + clamp(slope1 * sunSide * 6., -.2, .25));
    col = mix(col, m, smoothstep(h1, h1 - .003, y));
  }
  if (y < h2) {
    vec3 m = mix(vec3(.48, .63, .64), horizon, .38) * (1. + clamp(slope2 * sunSide * 7., -.25, .3));
    col = mix(col, m, smoothstep(h2, h2 - .002, y));
  }
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float sa = -2.6 + fi * 1.07 + sin(fi * 7.1) * .3;
    float w = .012 + .006 * fract(fi * .37);
    float sh = .05 + .07 * fract(fi * .61);
    float dd = abs(atan(sin(az - sa), cos(az - sa)));
    float spire = sh * max(0., 1. - dd / w);
    float spire2 = sh * .6 * max(0., 1. - abs(atan(sin(az - sa - w * 1.4), cos(az - sa - w * 1.4))) / (w * .6));
    float top = max(spire, spire2);
    if (y < top && y > -.01) {
      float facet = step(0., sin((az - sa) * 400.));
      vec3 sc = mix(vec3(.55, .9, .86), vec3(.92, 1., .98), facet) * (1.1 + .4 * pow(max(mu, 0.), 2.));
      col = mix(col, mix(sc, horizon, .35), smoothstep(top, top - .002, y));
    }
  }

  // Cloud sea below.
  if (y < .01) {
    float yy = max(-y, .002);
    vec2 uv = d.xz / (yy + .03) * .35 + vec2(uTime * .01, uTime * .004);
    float b = fbm2(uv * .5) * .7 + fbm2(uv * 1.6 + 5.) * .3;
    vec3 sea = mix(vec3(.74, .84, .87), vec3(1.08, 1.05, 1.), smoothstep(.35, .75, b));
    sea += uSunColor * pow(max(mu, 0.), 6.) * .3 * smoothstep(.5, .8, b);
    col = mix(col, sea, smoothstep(.008, -.02, y) * .95);
  }
  return col;
}
void main() {
  vec3 d = normalize(vDir);
  gl_FragColor = vec4(skyColor(d), 1.);
}
`;

export function skyMaterial(shared: SharedUniforms) {
  return new ShaderMaterial({
    uniforms: { uSunDir: shared.uSunDir, uSunColor: shared.uSunColor, uTime: shared.uTime },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: BackSide,
    depthWrite: false,
  });
}

/* ─── Hall light columns ─────────────────────────────────────────────────── */

const COLUMN_VERT = /* glsl */ `
attribute float aGlow;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vGlow;
varying vec3 vColor;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = cameraPosition - wp.xyz;
  vY = position.y;
  vGlow = aGlow;
  #ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
  #else
  vColor = vec3(.5, 1., .9);
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying float vY;
varying float vGlow;
varying vec3 vColor;
void main() {
  float f = abs(dot(normalize(vN), normalize(vV)));
  float body = pow(f, 2.4) * pow(1. - vY, 1.4) * smoothstep(0., .06, vY);
  float streak = .65 + .35 * sin(vY * 26. - uTime * 3.2 + f * 4.);
  vec3 c = mix(vColor, vec3(1., .97, .9), .35) * body * streak * vGlow * 2.4;
  gl_FragColor = vec4(c, 1.);
}
`;

export function lightColumnMaterial(shared: SharedUniforms) {
  return new ShaderMaterial({
    uniforms: { uTime: shared.uTime },
    vertexShader: COLUMN_VERT,
    fragmentShader: COLUMN_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

export { PHASE };
