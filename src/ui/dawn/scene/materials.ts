import {
Color,
DoubleSide,
GLSL3,
LinearMipmapLinearFilter,
LinearFilter,
Matrix4,
Mesh,
MeshPhysicalMaterial,
MeshStandardMaterial,
NoColorSpace,
OrthographicCamera,
PlaneGeometry,
RawShaderMaterial,
RepeatWrapping,
Scene,
Texture,
UnsignedByteType,
Vector2,
Vector3,
Vector4,
WebGLRenderTarget,
type WebGLProgramParametersWithUniforms,
type WebGLRenderer,
} from 'three';
import { NOISE_2D, NOISE_3D, COLOR } from './glsl';

/**
 * Surface materials for the rotunda. Standard three.js PBR shading (sun,
 * hemisphere, environment, shadows) with the surface detail written as code:
 * a baked tileable marble, an analytic floor inlay, coffered dome, bark and
 * embers. All injected through onBeforeCompile so lighting stays physical.
 */

export const MAX_MEDALLIONS = 6;

/* ─── Marble bake ────────────────────────────────────────────────────────── */

const BAKE_VERT = /* glsl */ `
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

const MARBLE_BAKE = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
${NOISE_2D}
float pnoise(vec2 p, float P) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  float a = hash12(mod(i, P)), b = hash12(mod(i + vec2(1, 0), P));
  float c = hash12(mod(i + vec2(0, 1), P)), d = hash12(mod(i + vec2(1, 1), P));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm(vec2 p, float P, int oct) {
  float v = 0., a = .5;
  for (int i = 0; i < 8; i++) { if (i >= oct) break; v += a * pnoise(p, P); p *= 2.; P *= 2.; a *= .5; }
  return v;
}
void main() {
  const float P = 4.;
  vec2 p = vUv * P;
  // Cloudy ground: soft warm/cool drifts.
  float cloud = pfbm(p * 1., P, 6);
  float cloud2 = pfbm(p * 2. + 3.1, P * 2., 5);
  // Main veins: ridged, domain-warped turbulence.
  vec2 w = vec2(pfbm(p + 1.7, P, 5), pfbm(p + 8.3, P, 5));
  float t1 = pfbm(p + w * 2.6, P, 7);
  float ridge = 1. - abs(sin((vUv.x * 2. + vUv.y * 1.) * 6.2831853 + t1 * 11.));
  float vein = pow(ridge, 26.);
  float veinSoft = pow(ridge, 6.) * .35;
  // Hairline veins.
  vec2 w2 = vec2(pfbm(p * 2. + 4.4, P * 2., 4), pfbm(p * 2. + 2.2, P * 2., 4));
  float t2 = pfbm(p * 2. + w2 * 3., P * 2., 6);
  float hair = pow(1. - abs(sin((vUv.x * 3. - vUv.y * 2.) * 6.2831853 + t2 * 14.)), 60.);
  // Rare golden veins (Calacatta) along a third family.
  float t3 = pfbm(p * .5 + w * 1.4 + 9.1, P * .5, 5);
  float goldVein = pow(1. - abs(sin((vUv.x * 1. - vUv.y * 1.) * 6.2831853 + t3 * 9.)), 40.) * smoothstep(.45, .7, cloud2);

  vec3 base = mix(vec3(.84, .855, .84), vec3(.9, .9, .875), cloud);
  base = mix(base, vec3(.8, .83, .83), smoothstep(.55, .8, cloud2) * .5);
  vec3 veinCol = vec3(.4, .47, .47);    // slate / mist-teal grey veins
  vec3 col = base;
  col = mix(col, mix(base, veinCol, .45), veinSoft);
  col = mix(col, veinCol, vein * .85);
  col = mix(col, vec3(.55, .6, .6), hair * .55);
  col = mix(col, vec3(.72, .56, .3), goldVein * .55);
  float rough = .11 + vein * .16 + hair * .08 + (1. - cloud) * .05;
  outColor = vec4(col, clamp(rough, 0., 1.));
}
`;

/** Bakes the tileable marble (RGB albedo, A roughness) once at start-up. */
export function bakeMarble(renderer: WebGLRenderer, size = 1024) {
  const target = new WebGLRenderTarget(size, size, {
    type: UnsignedByteType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    wrapS: RepeatWrapping,
    wrapT: RepeatWrapping,
    depthBuffer: false,
  });
  target.texture.colorSpace = NoColorSpace;
  target.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const material = new RawShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: MARBLE_BAKE, glslVersion: GLSL3 });
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  const scene = new Scene();
  scene.add(quad);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previous);
  material.dispose();
  quad.geometry.dispose();
  return target;
}

/* ─── Shared injection helpers ───────────────────────────────────────────── */

const WORLD_VARYINGS_VERT = /* glsl */ `
varying vec3 vDwPos;
varying vec3 vDwNormal;
`;

const WORLD_VARYINGS_VERT_MAIN = /* glsl */ `
{
  vec4 dwP = vec4(transformed, 1.0);
  vec3 dwN = objectNormal;
  #ifdef USE_INSTANCING
  dwP = instanceMatrix * dwP;
  dwN = mat3(instanceMatrix) * dwN;
  #endif
  dwP = modelMatrix * dwP;
  vDwPos = dwP.xyz;
  vDwNormal = normalize(mat3(modelMatrix) * dwN);
}
`;

// The drum and dome only see the sky through their windows and the oculus, so
// their bounce light is a fraction of the open colonnade's. The darker vault is
// what lets the sun shafts read against it.
const INTERIOR_AO_FN = /* glsl */ `
float dwInteriorAO(vec3 p) {
  return 1. - .62 * smoothstep(10.8, 17.5, p.y) * (1. - smoothstep(13.7, 14.6, length(p.xz)));
}
`;

const TRIPLANAR = /* glsl */ `
varying vec3 vDwPos;
varying vec3 vDwNormal;
${INTERIOR_AO_FN}
uniform sampler2D tMarble;
uniform float uMarbleScale;
uniform vec3 uMarbleTint;
vec4 triMarble(vec3 p, vec3 n) {
  vec3 w = pow(abs(n), vec3(4.));
  w /= (w.x + w.y + w.z + 1e-5);
  vec4 a = texture2D(tMarble, p.zy * uMarbleScale + vec2(.13, .41));
  vec4 b = texture2D(tMarble, p.xz * uMarbleScale + vec2(.37, .07));
  vec4 c = texture2D(tMarble, p.xy * uMarbleScale + vec2(.71, .29));
  return a * w.x + b * w.y + c * w.z;
}
`;

/** Applies the vault occlusion to the indirect light (after three's own AO step). */
const INTERIOR_AO = /* glsl */ `#include <aomap_fragment>
  {
    float dwAO = dwInteriorAO(vDwPos);
    reflectedLight.indirectDiffuse *= dwAO;
    reflectedLight.indirectSpecular *= dwAO;
  }`;

type ShaderHook = (shader: WebGLProgramParametersWithUniforms) => void;

function inject(material: MeshStandardMaterial, key: string, hook: ShaderHook) {
  material.onBeforeCompile = hook;
  material.customProgramCacheKey = () => key;
}

/* ─── Marble ─────────────────────────────────────────────────────────────── */

export function marbleMaterial(marble: Texture, opts: { scale?: number; tint?: string; roughness?: number; clearcoat?: number; side?: typeof DoubleSide } = {}) {
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: opts.roughness ?? 0.3,
    metalness: 0,
    clearcoat: opts.clearcoat ?? 0.35,
    clearcoatRoughness: 0.14,
    ior: 1.55,
  });
  if (opts.side !== undefined) material.side = opts.side;
  const uniforms = {
    tMarble: { value: marble },
    uMarbleScale: { value: opts.scale ?? 0.16 },
    uMarbleTint: { value: new Color(opts.tint ?? '#ffffff') },
  };
  inject(material, `dw-marble-${opts.side ?? 0}`, shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR}`)
      .replace('#include <map_fragment>', `
        vec4 dwM = triMarble(vDwPos, normalize(vDwNormal));
        diffuseColor.rgb *= dwM.rgb * uMarbleTint;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n roughnessFactor *= mix(.7, 1.6, dwM.a * 3.);`)
      .replace('#include <aomap_fragment>', INTERIOR_AO);
  });
  return material;
}

export function goldMaterial(roughness = 0.24) {
  const material = new MeshStandardMaterial({ color: new Color('#f3d08c'), metalness: 1, roughness });
  inject(material, `dw-gold-${roughness}`, shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDwPos;\nvarying vec3 vDwNormal;\n${INTERIOR_AO_FN}`)
      .replace('#include <aomap_fragment>', INTERIOR_AO);
  });
  return material;
}

/** Sooty stone inside the hearth bowl. */
export function sootMaterial() {
  const material = new MeshStandardMaterial({ color: new Color('#3b3430'), roughness: 0.92, metalness: 0 });
  const uniforms = { uTime: { value: 0 }, uFire: { value: 1 } };
  inject(material, 'dw-soot', shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDwPos;\nvarying vec3 vDwNormal;\nuniform float uTime;\nuniform float uFire;\n${NOISE_2D}`)
      .replace('#include <map_fragment>', `
        float dwR = length(vDwPos.xz);
        float dwAsh = vnoise(vDwPos.xz * 7.) * .6 + vnoise(vDwPos.xz * 23.) * .4;
        diffuseColor.rgb = mix(vec3(.05, .045, .04), vec3(.34, .31, .29), smoothstep(.8, 2.2, dwR) * .8 + dwAsh * .2);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float dwGlow = smoothstep(1.7, .3, dwR) * smoothstep(.55, .8, vnoise(vDwPos.xz * 9. + uTime * .15));
        totalEmissiveRadiance += vec3(1., .3, .06) * dwGlow * 2.2 * uFire;`);
  });
  return { material, uniforms };
}

/* ─── Floor ──────────────────────────────────────────────────────────────── */

export interface FloorUniforms {
  tMarble: { value: Texture };
  tReflect: { value: Texture | null };
  uReflectMatrix: { value: Matrix4 };
  uReflectMix: { value: number };
  uTime: { value: number };
  uMedallion: { value: Vector4[] };
  uMedallionColor: { value: Vector3[] };
  uLeyGlow: { value: number[] };
  uHall: { value: number };
  uFirePos: { value: Vector3 };
  uFireLight: { value: number };
  uResolution: { value: Vector2 };
}

const FLOOR_PATTERN = /* glsl */ `
uniform sampler2D tReflect;
uniform mat4 uReflectMatrix;
uniform float uReflectMix;
uniform float uTime;
uniform vec4 uMedallion[${MAX_MEDALLIONS}];
uniform vec3 uMedallionColor[${MAX_MEDALLIONS}];
uniform float uLeyGlow[${MAX_MEDALLIONS}];
uniform float uHall;
uniform vec3 uFirePos;
uniform float uFireLight;
${NOISE_2D}
float dwLine(float d, float w) {
  float fw = max(fwidth(d), 1e-4);
  return 1. - smoothstep(w - fw, w + fw, abs(d));
}
float dwSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.);
  return length(pa - ba * h);
}
// Greek key meander in band coordinates (u along, v 0..1 across).
float dwMeander(vec2 q) {
  vec2 c = vec2(fract(q.x), q.y);
  float d = 1e3;
  d = min(d, dwSeg(c, vec2(0., .08), vec2(1., .08)));
  d = min(d, dwSeg(c, vec2(.1, .08), vec2(.1, .9)));
  d = min(d, dwSeg(c, vec2(.1, .9), vec2(.86, .9)));
  d = min(d, dwSeg(c, vec2(.86, .9), vec2(.86, .3)));
  d = min(d, dwSeg(c, vec2(.86, .3), vec2(.34, .3)));
  d = min(d, dwSeg(c, vec2(.34, .3), vec2(.34, .68)));
  d = min(d, dwSeg(c, vec2(.34, .68), vec2(.62, .68)));
  d = min(d, dwSeg(c, vec2(.62, .68), vec2(.62, .5)));
  return d;
}
struct DwInlay { float gold; float crystal; float joint; float verde; vec3 glow; };
DwInlay dwFloor(vec3 wp) {
  DwInlay o = DwInlay(0., 0., 0., 0., vec3(0.));
  vec2 p = wp.xz;
  float r = length(p);
  float a = atan(p.y, p.x);
  // Tile joints: concentric courses with radial joints, staggered per course.
  float course = floor(r / 1.15);
  float n = max(6., floor(6.2831853 * (course + .5) * 1.15 / 1.25));
  float seg = fract(a / 6.2831853 * n + course * .5);
  float jr = abs(fract(r / 1.15 + .5) - .5) * 1.15;
  float ja = abs(seg - .5) * 2. * 3.14159 * max(r, .5) / n;
  float joint = max(dwLine(jr, .004), dwLine(ja - 3.14159 * max(r, .5) / n, .004));
  o.joint = joint * step(5.3, r) * (1. - step(18.9, r));
  // Border ring around the dais with crystal studs.
  o.gold = max(o.gold, dwLine(r - 5.22, .022));
  o.gold = max(o.gold, dwLine(r - 5.62, .03));
  float studA = fract(a / 6.2831853 * 48.) - .5;
  float stud = 1. - smoothstep(.05, .075, length(vec2(studA * 6.2831853 * 5.42 / 48., r - 5.42)));
  o.crystal = max(o.crystal, stud);
  // Eight-point compass star (long cardinal rays, short diagonals).
  float sector = 6.2831853 / 16.;
  float k = floor(a / sector + .5);
  float lr = mod(k, 2.) < .5 ? (mod(k, 4.) < .5 ? 10.4 : 8.2) : 5.9;
  float k2 = k + 1.;
  float lr2 = mod(k2, 2.) < .5 ? (mod(k2, 4.) < .5 ? 10.4 : 8.2) : 5.9;
  float k0 = k - 1.;
  float lr0 = mod(k0, 2.) < .5 ? (mod(k0, 4.) < .5 ? 10.4 : 8.2) : 5.9;
  vec2 P0 = vec2(cos(k0 * sector), sin(k0 * sector)) * lr0;
  vec2 P1 = vec2(cos(k * sector), sin(k * sector)) * lr;
  vec2 P2 = vec2(cos(k2 * sector), sin(k2 * sector)) * lr2;
  float ds = min(dwSeg(p, P0, P1), dwSeg(p, P1, P2));
  float starOutline = dwLine(ds, .028) * step(5.62, r);
  o.gold = max(o.gold, starOutline);
  // Crystal diamonds at the cardinal tips.
  for (int i = 0; i < 4; i++) {
    float ang = float(i) * 1.5707963;
    vec2 c = vec2(cos(ang), sin(ang)) * 10.95;
    vec2 q = p - c;
    vec2 t = vec2(dot(q, vec2(cos(ang), sin(ang))), dot(q, vec2(-sin(ang), cos(ang))));
    float dia = abs(t.x) / .42 + abs(t.y) / .24;
    o.crystal = max(o.crystal, 1. - smoothstep(.96, 1.02, dia));
    o.gold = max(o.gold, dwLine(dia - 1.12, .045));
  }
  // Meander band.
  if (r > 11.45 && r < 12.15) {
    vec2 bq = vec2(a / 6.2831853 * 96., (r - 11.5) / .6);
    float m = dwMeander(bq);
    o.gold = max(o.gold, dwLine(m * .6, .022));
  }
  o.gold = max(o.gold, dwLine(r - 11.4, .03));
  o.gold = max(o.gold, dwLine(r - 12.22, .03));
  // Outer terrace border.
  o.gold = max(o.gold, dwLine(r - 15.2, .028));
  o.gold = max(o.gold, dwLine(r - 15.45, .014));

  // Hall medallions under every lens, with a ley line back to the dais.
  for (int i = 0; i < ${MAX_MEDALLIONS}; i++) {
    vec4 m = uMedallion[i];
    if (m.z <= 0.) continue;
    vec2 q = p - m.xy;
    float d = length(q);
    float R = m.z;
    float rings = max(dwLine(d - R, R * .022), dwLine(d - R * .78, R * .012));
    float ma = atan(q.y, q.x);
    float rays = dwLine(abs(fract(ma / 6.2831853 * 8.) - .5) * d * .785, R * .012) * step(R * .2, d) * step(d, R * .78);
    float core = 1. - smoothstep(R * .16, R * .2, d);
    float edge = dwLine(d - R * .2, R * .018);
    vec2 dir = normalize(m.xy);
    float ley = dwLine(dwSeg(p, dir * 5.65, m.xy - dir * R), .02);
    o.gold = max(o.gold, max(max(rings, rays), max(edge, ley)) * uHall);
    o.crystal = max(o.crystal, core * uHall);
    float glow = m.w;
    float along = clamp(dot(p - dir * 5.65, dir) / max(length(m.xy) - R - 5.65, .1), 0., 1.);
    float pulse = smoothstep(.0, .15, fract(along - uTime * .55)) * (1. - smoothstep(.15, .45, fract(along - uTime * .55)));
    float leyGlow = exp(-dwSeg(p, dir * 5.65, m.xy - dir * R) * 26.) * (.25 + pulse * 1.6) * uLeyGlow[i];
    float ripple = exp(-abs(d - R * (1. + fract(uTime * .6) * .9)) * 22.) * (1. - fract(uTime * .6));
    o.glow += uMedallionColor[i] * uHall * (glow * (core * 3.5 + exp(-abs(d - R) * 30.) * 1.2 + ripple * .9 * glow) + leyGlow);
  }
  return o;
}
`;

export function floorMaterial(marble: Texture) {
  const material = new MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 0.55,
    clearcoatRoughness: 0.06,
    ior: 1.6,
  });
  const uniforms: FloorUniforms = {
    tMarble: { value: marble },
    tReflect: { value: null },
    uReflectMatrix: { value: new Matrix4() },
    uReflectMix: { value: 0 },
    uTime: { value: 0 },
    uMedallion: { value: Array.from({ length: MAX_MEDALLIONS }, () => new Vector4()) },
    uMedallionColor: { value: Array.from({ length: MAX_MEDALLIONS }, () => new Vector3(0.4, 1, 0.9)) },
    uLeyGlow: { value: Array.from({ length: MAX_MEDALLIONS }, () => 0) },
    uHall: { value: 0 },
    uFirePos: { value: new Vector3() },
    uFireLight: { value: 1 },
    uResolution: { value: new Vector2(1, 1) },
  };
  inject(material, 'dw-floor', shader => {
    Object.assign(shader.uniforms, uniforms, { uMarbleScale: { value: 0.075 }, uMarbleTint: { value: new Color('#ffffff') } });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR}\n${FLOOR_PATTERN}`)
      .replace('#include <map_fragment>', `
        vec4 dwM = texture2D(tMarble, vDwPos.xz * uMarbleScale) * .6 + texture2D(tMarble, vDwPos.zx * uMarbleScale * .43 + .5) * .4;
        DwInlay dwI = dwFloor(vDwPos);
        vec3 dwBase = dwM.rgb;
        dwBase = mix(dwBase, dwBase * vec3(.86, .93, .9), dwI.verde);
        dwBase *= 1. - dwI.joint * .35;
        vec3 dwCrystal = vec3(.08, .55, .5);
        diffuseColor.rgb = mix(dwBase, vec3(.95, .74, .38), dwI.gold);
        diffuseColor.rgb = mix(diffuseColor.rgb, dwCrystal, dwI.crystal);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor * mix(.7, 1.6, dwM.a * 3.) + dwI.joint * .3, .2, dwI.gold);
        roughnessFactor = mix(roughnessFactor, .05, dwI.crystal);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = dwI.gold;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += dwI.crystal * vec3(.1, .75, .66) * (.35 + .15 * sin(uTime * 1.3 + vDwPos.x));
        totalEmissiveRadiance += dwI.glow;`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        {
          vec4 dwRc = uReflectMatrix * vec4(vDwPos, 1.);
          vec2 dwRuv = dwRc.xy / dwRc.w;
          vec2 dwJit = (vec2(vnoise(vDwPos.xz * 3.1), vnoise(vDwPos.xz * 3.1 + 7.)) - .5) * .006 * (1. - dwI.gold);
          vec3 dwRefl = textureLod(tReflect, dwRuv + dwJit, 1. + material.roughness * 8.).rgb;
          float dwMix = uReflectMix * step(length(vDwPos.xz), 18.9);
          radiance = mix(radiance, dwRefl, dwMix);
          #ifdef USE_CLEARCOAT
          clearcoatRadiance = mix(clearcoatRadiance, dwRefl, dwMix);
          #endif
        }`);
  });
  return { material, uniforms };
}

/* ─── Dome ───────────────────────────────────────────────────────────────── */

export function domeMaterial(marble: Texture) {
  const material = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0, clearcoat: 0.1, side: DoubleSide });
  const uniforms = { tMarble: { value: marble }, uMarbleScale: { value: 0.12 }, uMarbleTint: { value: new Color('#ffffff') } };
  inject(material, 'dw-dome', shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS_VERT}\nvarying vec2 vDwUv;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDwUv = uv;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${TRIPLANAR}\nvarying vec2 vDwUv;
        float dwSS(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0., 1.); return t * t * (3. - 2. * t); }
        float dwSSd(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0., 1.); return 6. * t * (1. - t) / (e1 - e0); }
        // Stepped coffer recess (0 on the ribs, 1 deep in the panel) with its uv
        // gradient worked out analytically. Screen derivatives of a stepped height
        // are taken per 2x2 pixel block and break every step edge into dashes.
        float dwCoffer(vec2 uv, out float rosette, out float goldRim, out vec2 grad) {
          vec2 g = vec2(uv.x * 32., uv.y * 6.2);
          vec2 c = fract(g);
          float row = floor(g.y);
          float s = 1. + row * .18;
          float on = step(row, 5.5);
          // Distance to the nearest cell border, in cell units, and its uv gradient.
          float d = c.x * s;
          vec2 gd = vec2(32. * s, 0.);
          if ((1. - c.x) * s < d) { d = (1. - c.x) * s; gd = vec2(-32. * s, 0.); }
          if (c.y < d) { d = c.y; gd = vec2(0., 6.2); }
          if (1. - c.y < d) { d = 1. - c.y; gd = vec2(0., -6.2); }
          // Screen footprint of d from the smooth uv derivatives: high in the vault
          // the cells shrink to a few pixels and every edge widens to stay filtered.
          vec2 ux = dFdx(uv), uy = dFdy(uv);
          float aa = max(abs(dot(gd, ux)) + abs(dot(gd, uy)), 1e-4);
          float h = dwSS(.07 - aa, .11 + aa, d) * .5 + dwSS(.17 - aa, .21 + aa, d) * .3 + dwSS(.26 - aa, .3 + aa, d) * .2;
          float dh = dwSSd(.07 - aa, .11 + aa, d) * .5 + dwSSd(.17 - aa, .21 + aa, d) * .3 + dwSSd(.26 - aa, .3 + aa, d) * .2;
          grad = gd * dh * on;
          vec2 q = (c - .5) * vec2(s, 1.);
          float rr = max(length(q), 1e-4);
          vec2 gr = vec2(q.x * 32. * s, q.y * 6.2) / rr;
          float ra = max(abs(dot(gr, ux)) + abs(dot(gr, uy)), 1e-4);
          rosette = (1. - smoothstep(.115 - ra, .115 + ra, rr)) * on;
          goldRim = (1. - smoothstep(.012 - aa, .012 + aa, abs(d - .08))) * clamp(.012 / aa, 0., 1.) * on;
          return h * on;
        }`)
      .replace('#include <map_fragment>', `
        vec4 dwM = triMarble(vDwPos, normalize(vDwNormal));
        float dwRos, dwRim;
        vec2 dwGrad;
        float dwH = dwCoffer(vDwUv, dwRos, dwRim, dwGrad);
        diffuseColor.rgb *= dwM.rgb * mix(1., .86, dwH);
        float dwGoldMask = max(dwRos, dwRim);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.95, .74, .38), dwGoldMask);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n// Gilded bosses stay half dielectric so they catch the fire and sky bounce instead of mirroring the dark vault.\nmetalnessFactor = max(dwRim, dwRos * .45);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Bump along the recess (negative height: the panels sink into the vault),
          // 0.35 m deep, with the slope chained through the smooth uv derivatives.
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dhx = dot(dwGrad, dFdx(vDwUv)) * -.35, dhy = dot(dwGrad, dFdy(vDwUv)) * -.35;
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1) * faceDirection;
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .3, dwGoldMask);')
      .replace('#include <aomap_fragment>', INTERIOR_AO);
  });
  return material;
}

/* ─── Logs and coals ─────────────────────────────────────────────────────── */

export interface EmberUniforms { uTime: { value: number }; uFire: { value: number }; tNoise: { value: Texture | null } }

export function logMaterial(uniforms: EmberUniforms) {
  const material = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  inject(material, 'dw-log', shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS_VERT}\nvarying vec2 vDwUv;`)
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvDwUv = uv;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDwPos;\nvarying vec3 vDwNormal;\nvarying vec2 vDwUv;\nuniform float uTime;\nuniform float uFire;\n${NOISE_2D}`)
      .replace('#include <map_fragment>', `
        float dwEnd = step(vDwUv.y, -0.5);
        vec2 dwB = vec2(vDwUv.x * 22., vDwUv.y * 2.6);
        float dwStreak = vnoise(dwB) * .55 + vnoise(dwB * vec2(2.3, 4.1)) * .3 + vnoise(dwB * 7.) * .15;
        float dwCrack = smoothstep(.62, .7, vnoise(vec2(vDwUv.x * 9., vDwUv.y * 1.3)) * .7 + vnoise(dwB * 3.) * .3);
        vec3 dwBark = mix(vec3(.035, .024, .018), vec3(.11, .075, .05), dwStreak);
        float dwToFire = clamp(dot(normalize(vDwNormal), normalize(vec3(-vDwPos.x, .4, -vDwPos.z))), 0., 1.);
        float dwHeat = smoothstep(4.2, 1.3, vDwPos.y) * smoothstep(2.4, .4, length(vDwPos.xz));
        float dwChar = clamp(dwHeat * (.75 + dwToFire * .6) + dwCrack * .3, 0., 1.);
        float dwAsh = smoothstep(.55, .8, vnoise(dwB * 2.3)) * dwChar * clamp(normalize(vDwNormal).y, 0., 1.) * .5;
        vec3 dwRing = mix(vec3(.42, .3, .18), vec3(.25, .16, .09), fract(length(vDwPos.xz) * 30.));
        diffuseColor.rgb = mix(mix(dwBark, vec3(.012, .011, .01), dwChar), dwRing * (1. - dwChar * .7), dwEnd);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.42, .4, .38), dwAsh);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float dwFlick = .75 + .25 * sin(uTime * 7.3 + vDwPos.y * 3.) * sin(uTime * 3.1 + vDwPos.x * 5.);
        // Glow only in the charred cracks and on the faces turned to the flames.
        float dwSeam = smoothstep(.78, .9, vnoise(vec2(vDwUv.x * 16., vDwUv.y * 4.5)) * .65 + vnoise(dwB * 4.) * .35);
        float dwEmb = dwChar * (dwSeam * 1.1 + dwCrack * .35) * dwHeat * (.35 + dwToFire * .9);
        totalEmissiveRadiance += mix(vec3(.9, .14, .02), vec3(1., .42, .08), dwSeam) * dwEmb * 3.2 * dwFlick * uFire;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directDiffuse = min(reflectedLight.directDiffuse, vec3(.16, .1, .07));
        reflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(.12, .08, .05));`);
  });
  return material;
}

export function coalMaterial(uniforms: EmberUniforms) {
  const material = new MeshStandardMaterial({ color: new Color('#1d1714'), roughness: 0.95, metalness: 0, flatShading: true });
  inject(material, 'dw-coal', shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYINGS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDwPos;\nvarying vec3 vDwNormal;\nuniform float uTime;\nuniform float uFire;\n${NOISE_2D}\n${NOISE_3D}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float dwN = volFbm(vDwPos * .9 + vec3(0., uTime * .05, 0.));
        float dwCore = smoothstep(.42, .62, dwN);
        float dwBreath = .7 + .3 * sin(uTime * 2.2 + vDwPos.x * 4. + vDwPos.z * 3.);
        totalEmissiveRadiance += mix(vec3(.9, .12, .02), vec3(1., .5, .12), dwCore) * dwCore * 6. * dwBreath * uFire * smoothstep(1.9, .5, length(vDwPos.xz));`);
  });
  return material;
}

export { COLOR };
