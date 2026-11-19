import {
AddEquation,
BufferAttribute,
BufferGeometry,
CustomBlending,
DepthTexture,
GLSL3,
HalfFloatType,
LinearFilter,
LinearMipmapLinearFilter,
Matrix4,
Mesh,
NearestFilter,
NoBlending,
OneFactor,
OrthographicCamera,
RawShaderMaterial,
RedFormat,
Scene,
Texture,
UnsignedIntType,
Vector2,
Vector3,
WebGLRenderTarget,
type Blending,
type Camera,
type PerspectiveCamera,
type WebGLRenderer,
} from 'three';
import { COLOR,NOISE_2D,PHASE } from './glsl';
import { CRYSTAL_PASS,type CrystalPass } from './shaders';
import type { QualitySettings } from './quality';

/**
 * HDR frame pipeline:
 *   mirror pass (floor reflection) → main HDR pass (opaque, fire, refraction
 *   copy, crystals, effects) → volumetric light (ray-marched against the sun
 *   shadow map, temporally accumulated) → combine + heat haze → bloom chain →
 *   ACES tone map, grade, mist vignette, grain → screen.
 */

const QUAD_VERT = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() { vUv = position.xy * .5 + .5; gl_Position = vec4(position.xy, 0., 1.); }
`;

const COPY_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tSrc;
void main() { outColor = texture(tSrc, vUv); }
`;

// View-space depth of the opaque pass, so the fire volume can stop at the logs.
const LINEAR_DEPTH_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
void main() {
  float z = texture(tDepth, vUv).r * 2. - 1.;
  outColor = vec4(2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)), 0., 0., 1.);
}
`;

const VOLUME_FRAG = /* glsl */ `
precision highp float;
precision highp sampler2DShadow;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tDepth;
uniform sampler2D tHistory;
uniform sampler2DShadow tShadow;
uniform sampler3D tNoise;
uniform mat4 uShadowMatrix;
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform mat4 uPrevViewProj;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbient;
uniform vec3 uFirePos;
uniform vec3 uFireColor;
uniform float uFireLight;
uniform float uTime;
uniform int uSteps;
uniform float uMaxDist;
uniform float uDensity;
uniform float uFrame;
uniform float uHistoryMix;
${NOISE_2D}
${PHASE}
float density(vec3 p) {
  float h = max(p.y, 0.);
  float r = length(p.xz);
  // Incense dust hangs thickest up in the drum and dome, where the window beams cross;
  // eye level stays clear enough to see across the hall; a thin mist pools on the floor.
  // Outside the colonnade only a faint aerial haze, so the sky stays blue.
  float inside = 1. - smoothstep(12.6, 15.5, r);
  float upper = smoothstep(5., 14., h) * smoothstep(33., 25., h);
  float mist = exp(-h * 1.5);
  vec3 q = p * .03 + vec3(uTime * .012, -uTime * .003, uTime * .007);
  float n = texture(tNoise, q).r;
  float n2 = texture(tNoise, p * .085 + vec3(-uTime * .02, uTime * .011, 0.)).g;
  float dust = (.45 + 1.3 * smoothstep(.32, .74, n)) * (.7 + .55 * n2);
  float interior = (.14 + upper * 2.3) * dust + mist * 1.1 * (.5 + .9 * n2);
  float exterior = .035 + mist * .4 * n2;
  return uDensity * mix(exterior, interior, inside);
}
void main() {
  float depth = texture(tDepth, vUv).r;
  vec4 ndc = vec4(vUv * 2. - 1., depth * 2. - 1., 1.);
  vec4 vp = uInvProj * ndc;
  vp /= vp.w;
  vec3 wp = (uCamWorld * vec4(vp.xyz, 1.)).xyz;
  vec3 rd = wp - uCamPos;
  float dist = length(rd);
  rd /= dist;
  if (depth >= .99999) dist = 420.;
  float march = min(dist, uMaxDist);
  float steps = float(uSteps);
  float jit = fract(ign(gl_FragCoord.xy) + uFrame * .618034);
  float mu = dot(rd, uSunDir);
  // Fine dust scatters strongly forward (shafts blaze when you look toward the sun)
  // with a broad side lobe so they still read from the gallery above.
  float phSun = phaseHG(mu, .8) * .55 + phaseHG(mu, .2) * .45;
  float phIso = .0796;
  vec3 L = vec3(0.);
  float T = 1.;
  float prevT = 0.;
  for (int i = 0; i < 96; i++) {
    if (i >= uSteps) break;
    // Quadratic step distribution: dense near the camera where shafts are read.
    float u1 = (float(i) + jit) / steps;
    float t = march * u1 * u1;
    float dt = t - prevT;
    prevT = t;
    vec3 p = uCamPos + rd * t;
    float sig = density(p);
    vec4 sc = uShadowMatrix * vec4(p, 1.);
    float vis = 1.;
    if (sc.x > 0. && sc.x < 1. && sc.y > 0. && sc.y < 1. && sc.z < 1.) vis = texture(tShadow, vec3(sc.xy, sc.z - .0012));
    vec3 fd = p - uFirePos;
    float fire = uFireLight / (1. + dot(fd, fd) * .2);
    vec3 S = uSunColor * vis * phSun + uAmbient * phIso + uFireColor * fire * phIso * 3.;
    float tr = exp(-sig * dt);
    L += T * S * (1. - tr);
    T *= tr;
  }
  // Beyond the marched range: unshadowed aerial haze for far geometry. The sky
  // shader already carries its own horizon haze, so sky pixels get none.
  float rest = depth >= .99999 ? 0. : clamp(dist, uMaxDist, 420.) - uMaxDist;
  if (rest > 0.) {
    float sigFar = uDensity * .04;
    float tr = exp(-sigFar * rest);
    vec3 S = uSunColor * phSun * .8 + uAmbient * phIso * 2.;
    L += T * S * (1. - tr);
    T *= tr;
  }
  vec4 cur = vec4(L, T);
  // Temporal accumulation with reprojection of the surface point.
  vec3 anchor = uCamPos + rd * min(dist, 420.);
  vec4 pc = uPrevViewProj * vec4(anchor, 1.);
  vec2 puv = pc.xy / pc.w * .5 + .5;
  float valid = step(0., puv.x) * step(puv.x, 1.) * step(0., puv.y) * step(puv.y, 1.);
  vec4 hist = texture(tHistory, puv);
  float k = mix(1., uHistoryMix, valid);
  outColor = mix(hist, cur, k);
}
`;

const COMBINE_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tScene;
uniform sampler2D tVolume;
uniform float uTime;
uniform vec4 uHaze; // x,y = fire top in uv, z = width, w = height
uniform float uHazeOn;
uniform float uView;
${NOISE_2D}
void main() {
  vec2 uv = vUv;
  if (uHazeOn > .5) {
    vec2 d = (uv - uHaze.xy) / uHaze.zw;
    float m = exp(-d.x * d.x * 2.2) * smoothstep(-.35, .1, d.y) * smoothstep(1.6, .2, d.y);
    vec2 n = vec2(vnoise(uv * vec2(60., 30.) + vec2(0., -uTime * 3.)), vnoise(uv * vec2(48., 26.) + vec2(4., -uTime * 2.6))) - .5;
    uv += n * m * .006;
  }
  vec3 c = texture(tScene, uv).rgb;
  vec4 v = texture(tVolume, vUv);
  if (uView > .5 && uView < 1.5) { outColor = vec4(v.rgb, 1.); return; }
  if (uView > 1.5) { outColor = vec4(c, 1.); return; }
  outColor = vec4(c * v.a + v.rgb, 1.);
}
`;

const DOWN_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
vec3 karis(vec3 c) { return c / (1. + max(max(c.r, c.g), c.b) * .25); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture(tSrc, vUv + t * vec2(-2., 2.)).rgb;
  vec3 b = texture(tSrc, vUv + t * vec2(0., 2.)).rgb;
  vec3 c = texture(tSrc, vUv + t * vec2(2., 2.)).rgb;
  vec3 d = texture(tSrc, vUv + t * vec2(-2., 0.)).rgb;
  vec3 e = texture(tSrc, vUv).rgb;
  vec3 f = texture(tSrc, vUv + t * vec2(2., 0.)).rgb;
  vec3 g = texture(tSrc, vUv + t * vec2(-2., -2.)).rgb;
  vec3 h = texture(tSrc, vUv + t * vec2(0., -2.)).rgb;
  vec3 i = texture(tSrc, vUv + t * vec2(2., -2.)).rgb;
  vec3 j = texture(tSrc, vUv + t * vec2(-1., 1.)).rgb;
  vec3 k = texture(tSrc, vUv + t * vec2(1., 1.)).rgb;
  vec3 l = texture(tSrc, vUv + t * vec2(-1., -1.)).rgb;
  vec3 m = texture(tSrc, vUv + t * vec2(1., -1.)).rgb;
  vec3 o;
  if (uFirst > .5) {
    o = karis(e) * .125 + karis((a + c + g + i) * .25) * .125 + karis((b + d + f + h) * .25) * .25 + karis((j + k + l + m) * .25) * .5;
    // Soft-knee threshold: only the fire, glints and sun-struck marble bloom.
    float br = max(max(o.r, o.g), o.b);
    float knee = clamp(br - 1.1, 0., 1.2);
    float w = max(knee * knee / 4.8, br - 2.3) / max(br, 1e-4);
    o *= w;
  } else {
    o = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
  }
  outColor = vec4(o, 1.);
}
`;

const UP_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uRadius;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture(tSrc, vUv).rgb * 4.;
  s += (texture(tSrc, vUv + vec2(-t.x, 0.)).rgb + texture(tSrc, vUv + vec2(t.x, 0.)).rgb + texture(tSrc, vUv + vec2(0., -t.y)).rgb + texture(tSrc, vUv + vec2(0., t.y)).rgb) * 2.;
  s += texture(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture(tSrc, vUv + vec2(t.x, t.y)).rgb;
  outColor = vec4(s / 16., 1.);
}
`;

const FINAL_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tComp;
uniform sampler2D tBloom;
uniform float uBloom;
uniform float uExposure;
uniform float uTime;
uniform vec2 uResolution;
uniform float uFlash;
uniform vec3 uMist;
uniform vec2 uSunUv;
uniform float uSunOn;
uniform float uHueKeep;
${NOISE_2D}
${COLOR}
void main() {
  vec2 uv = vUv;
  vec2 cc = uv - .5;
  float r2 = dot(cc, cc);
  // Faint lateral chromatic aberration toward the frame edge.
  vec2 ca = cc * r2 * .006;
  vec3 hdr;
  hdr.r = texture(tComp, uv - ca).r;
  hdr.g = texture(tComp, uv).g;
  hdr.b = texture(tComp, uv + ca).b;
  vec3 bloom = texture(tBloom, uv).rgb;
  vec3 c = hdr + bloom * uBloom;
  // Soft sun glare streaks when the sun is on screen.
  if (uSunOn > 0.) {
    vec2 sd = (uv - uSunUv) * vec2(uResolution.x / uResolution.y, 1.);
    float streak = exp(-abs(sd.y) * 90.) * exp(-abs(sd.x) * 3.5) + exp(-abs(sd.x) * 120.) * exp(-abs(sd.y) * 9.) * .4;
    c += vec3(1., .92, .78) * streak * uSunOn * .6;
  }
  c *= uExposure;
  c += vec3(1., .97, .9) * uFlash * 2.5;
  c = filmic(c, uHueKeep);
  // Split tone: cool mist in the shadows, warm cream in the highlights.
  float l = luma(c);
  c = mix(c, c * vec3(.96, 1.02, 1.03), (1. - l) * .5);
  c = mix(c, c * vec3(1.03, 1., .95), l * l * .4);
  // Mist vignette: the frame edge dissolves into morning haze instead of darkening.
  float v = smoothstep(.18, .75, r2 * 1.9);
  c = mix(c, uMist, v * .22);
  c = linearToSrgb(c);
  float g = hash12(gl_FragCoord.xy + fract(uTime) * 311.) - .5;
  c += g * (.018 + .01 * (1. - l));
  outColor = vec4(c, 1.);
}
`;

class FullscreenPass {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mesh: Mesh;

  constructor() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new Mesh(g);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  run(renderer: WebGLRenderer, material: RawShaderMaterial, target: WebGLRenderTarget | null) {
    this.mesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose() { this.mesh.geometry.dispose(); }
}

const raw = (fragmentShader: string, uniforms: Record<string, { value: unknown }>, blending: Blending = NoBlending) => new RawShaderMaterial({
  vertexShader: QUAD_VERT,
  fragmentShader,
  uniforms,
  glslVersion: GLSL3,
  depthTest: false,
  depthWrite: false,
  blending,
});

const hdrTarget = (w: number, h: number, opts: { samples?: number; depth?: boolean; mips?: boolean } = {}) => {
  const rt = new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: HalfFloatType,
    samples: opts.samples ?? 0,
    depthBuffer: opts.depth ?? false,
    generateMipmaps: opts.mips ?? false,
    minFilter: opts.mips ? LinearMipmapLinearFilter : LinearFilter,
    magFilter: LinearFilter,
  });
  return rt;
};

export interface FrameScenes {
  opaque: Scene;
  fire: Scene;
  crystal: Scene;
  fx: Scene;
}

export interface FrameHooks {
  /** Called around the mirror pass so the world can hide the floor, swap shader quality, etc. */
  beforeMirror(): void;
  afterMirror(): void;
  /** Crystals must not sample the refraction copy while it is being written. */
  setRefraction(texture: Texture | null, size: Vector2): void;
  /** Linear view depth of the opaque pass for the fire volume (null in the mirror pass). */
  setSceneDepth(texture: Texture | null): void;
  /** Which half of the crystals the next crystal render draws (shaders.ts CrystalPass). */
  setCrystalPass(pass: CrystalPass): void;
}

export interface FrameParams {
  time: number;
  exposure: number;
  bloom: number;
  density: number;
  ambient: Vector3;
  sunDir: Vector3;
  sunColor: Vector3;
  firePos: Vector3;
  fireColor: Vector3;
  fireLight: number;
  shadowMap: Texture | null;
  shadowMatrix: Matrix4;
  noise: Texture | null;
  haze: { x: number; y: number; w: number; h: number } | null;
  flash: number;
  mist: Vector3;
  sunUv: Vector2 | null;
  sunOn: number;
  historyMix: number;
  /** How much of the hue-preserving tone curve to blend in (0 = plain ACES). */
  hueKeep: number;
  /** QA: 0 final, 1 volumetric light only, 2 surfaces only. */
  view?: number;
}

export class Pipeline {
  private width = 1;
  private height = 1;
  private readonly fs = new FullscreenPass();
  private hdr!: WebGLRenderTarget;
  private depthLinear!: WebGLRenderTarget;
  private refraction!: WebGLRenderTarget;
  private mirror: WebGLRenderTarget | null = null;
  private volA!: WebGLRenderTarget;
  private volB!: WebGLRenderTarget;
  private comp!: WebGLRenderTarget;
  private bloom: WebGLRenderTarget[] = [];
  private frame = 0;
  private readonly prevViewProj = new Matrix4();
  private readonly mirrorCamera: PerspectiveCamera;
  readonly reflectMatrix = new Matrix4();

  private readonly copyMat = raw(COPY_FRAG, { tSrc: { value: null } });
  private readonly linearDepthMat = raw(LINEAR_DEPTH_FRAG, { tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 700 } });
  private readonly volMat = raw(VOLUME_FRAG, {
    tDepth: { value: null }, tHistory: { value: null }, tShadow: { value: null }, tNoise: { value: null },
    uShadowMatrix: { value: new Matrix4() }, uInvProj: { value: new Matrix4() }, uCamWorld: { value: new Matrix4() }, uPrevViewProj: { value: new Matrix4() },
    uCamPos: { value: new Vector3() }, uSunDir: { value: new Vector3() }, uSunColor: { value: new Vector3() }, uAmbient: { value: new Vector3() },
    uFirePos: { value: new Vector3() }, uFireColor: { value: new Vector3() }, uFireLight: { value: 1 },
    uTime: { value: 0 }, uSteps: { value: 32 }, uMaxDist: { value: 46 }, uDensity: { value: 0.02 }, uFrame: { value: 0 }, uHistoryMix: { value: 0.2 },
  });
  private readonly combineMat = raw(COMBINE_FRAG, { tScene: { value: null }, tVolume: { value: null }, uTime: { value: 0 }, uHaze: { value: [0, 0, 1, 1] }, uHazeOn: { value: 0 }, uView: { value: 0 } });
  private readonly downMat = raw(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uFirst: { value: 0 } });
  private readonly upMat = (() => {
    const m = raw(UP_FRAG, { tSrc: { value: null }, uTexel: { value: new Vector2() }, uRadius: { value: 1 } }, CustomBlending);
    m.blendEquation = AddEquation;
    m.blendSrc = OneFactor;
    m.blendDst = OneFactor;
    return m;
  })();
  private readonly finalMat = raw(FINAL_FRAG, {
    tComp: { value: null }, tBloom: { value: null }, uBloom: { value: 0.6 }, uExposure: { value: 1 }, uTime: { value: 0 },
    uResolution: { value: new Vector2() }, uFlash: { value: 0 }, uMist: { value: new Vector3(0.93, 0.96, 0.95) }, uSunUv: { value: new Vector2() }, uSunOn: { value: 0 },
    uHueKeep: { value: 0.6 },
  });

  constructor(private readonly renderer: WebGLRenderer, private settings: QualitySettings, mirrorCamera: PerspectiveCamera) {
    this.mirrorCamera = mirrorCamera;
  }

  get size() { return new Vector2(this.width, this.height); }

  configure(settings: QualitySettings, width: number, height: number) {
    this.settings = settings;
    this.dispose(false);
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    const { width: w, height: h } = this;
    const depthTexture = new DepthTexture(w, h, UnsignedIntType);
    this.hdr = new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: settings.msaa, depthBuffer: true, depthTexture, magFilter: LinearFilter, minFilter: LinearFilter });
    this.depthLinear = new WebGLRenderTarget(w, h, { type: HalfFloatType, format: RedFormat, depthBuffer: false, magFilter: NearestFilter, minFilter: NearestFilter });
    this.refraction = hdrTarget(w >> 1, h >> 1, { mips: true });
    this.mirror = settings.reflectionScale > 0 ? hdrTarget(Math.round(w * settings.reflectionScale), Math.round(h * settings.reflectionScale), { depth: true, mips: true }) : null;
    const vw = Math.round(w * settings.volumeScale);
    const vh = Math.round(h * settings.volumeScale);
    this.volA = hdrTarget(vw, vh);
    this.volB = hdrTarget(vw, vh);
    this.comp = hdrTarget(w, h);
    this.bloom = [];
    let bw = w >> 1;
    let bh = h >> 1;
    for (let i = 0; i < settings.bloomLevels && bw > 2 && bh > 2; i++) {
      this.bloom.push(hdrTarget(bw, bh));
      bw >>= 1;
      bh >>= 1;
    }
    this.frame = 0;
  }

  get mirrorTexture() { return this.mirror?.texture ?? null; }

  /** Builds the mirrored camera for the floor plane y = 0 (same maths as three's Reflector). */
  private updateMirror(camera: PerspectiveCamera) {
    const virtual = this.mirrorCamera;
    const camPos = new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const normal = new Vector3(0, 1, 0);
    if (camPos.y <= 0.02) return false;
    const view = camPos.clone();
    view.reflect(normal).negate();
    const rot = new Matrix4().extractRotation(camera.matrixWorld);
    const look = new Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const target = new Vector3().sub(look).reflect(normal).negate();
    virtual.position.copy(view);
    virtual.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    virtual.lookAt(target);
    virtual.far = camera.far;
    virtual.near = camera.near;
    virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(camera.projectionMatrix);
    this.reflectMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.reflectMatrix.multiply(virtual.projectionMatrix);
    this.reflectMatrix.multiply(virtual.matrixWorldInverse);
    // Oblique near plane so nothing below the floor leaks into the reflection.
    const plane = new Vector3(0, 1, 0).transformDirection(virtual.matrixWorldInverse);
    const pointView = new Vector3(0, 0, 0).applyMatrix4(virtual.matrixWorldInverse);
    const constant = -plane.dot(pointView);
    const clip = [plane.x, plane.y, plane.z, constant];
    const pm = virtual.projectionMatrix.elements;
    const q = [
      (Math.sign(clip[0]) + pm[8]) / pm[0],
      (Math.sign(clip[1]) + pm[9]) / pm[5],
      -1,
      (1 + pm[10]) / pm[14],
    ];
    const dot = clip[0] * q[0] + clip[1] * q[1] + clip[2] * q[2] + clip[3] * q[3];
    const s = 2 / dot;
    pm[2] = clip[0] * s;
    pm[6] = clip[1] * s;
    pm[10] = clip[2] * s + 1 - 0.003;
    pm[14] = clip[3] * s;
    virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
    return true;
  }

  render(scenes: FrameScenes, camera: PerspectiveCamera, params: FrameParams, hooks: FrameHooks) {
    const r = this.renderer;
    r.autoClear = false;
    r.setClearColor(0x000000, 1);

    // 1. Floor mirror, layered like the main pass but without refraction.
    if (this.mirror && this.updateMirror(camera)) {
      hooks.beforeMirror();
      hooks.setRefraction(null, this.size);
      r.setRenderTarget(this.mirror);
      r.clear(true, true, false);
      r.render(scenes.opaque, this.mirrorCamera);
      hooks.setCrystalPass(CRYSTAL_PASS.beyondFire);
      r.render(scenes.crystal, this.mirrorCamera);
      r.render(scenes.fire, this.mirrorCamera);
      hooks.setCrystalPass(CRYSTAL_PASS.nearFire);
      r.render(scenes.crystal, this.mirrorCamera);
      hooks.setCrystalPass(CRYSTAL_PASS.all);
      hooks.afterMirror();
    }

    // 2. Main HDR pass. The crystals beyond the fire go first and refract the hall
    //    behind them; the flames then cover them. The fire marches only up to the
    //    opaque depth, so logs in front of the flames stay dark silhouettes. The
    //    crystals on the near side go last and refract the flames.
    r.setRenderTarget(this.hdr);
    r.clear(true, true, false);
    hooks.setRefraction(null, this.size);
    hooks.setSceneDepth(null);
    r.render(scenes.opaque, camera);
    const ld = this.linearDepthMat.uniforms;
    ld.tDepth.value = this.hdr.depthTexture;
    ld.uNear.value = camera.near;
    ld.uFar.value = camera.far;
    this.fs.run(r, this.linearDepthMat, this.depthLinear);
    this.captureRefraction(hooks);
    hooks.setCrystalPass(CRYSTAL_PASS.beyondFire);
    r.render(scenes.crystal, camera);
    hooks.setSceneDepth(this.depthLinear.texture);
    r.render(scenes.fire, camera);
    hooks.setSceneDepth(null);
    this.captureRefraction(hooks);
    hooks.setCrystalPass(CRYSTAL_PASS.nearFire);
    r.render(scenes.crystal, camera);
    hooks.setCrystalPass(CRYSTAL_PASS.all);
    r.render(scenes.fx, camera);

    // 3. Volumetric light.
    const vm = this.volMat.uniforms;
    const read = this.frame % 2 ? this.volA : this.volB;
    const write = this.frame % 2 ? this.volB : this.volA;
    vm.tDepth.value = this.hdr.depthTexture;
    vm.tHistory.value = read.texture;
    vm.tShadow.value = params.shadowMap;
    vm.tNoise.value = params.noise;
    (vm.uShadowMatrix.value as Matrix4).copy(params.shadowMatrix);
    (vm.uInvProj.value as Matrix4).copy(camera.projectionMatrixInverse);
    (vm.uCamWorld.value as Matrix4).copy(camera.matrixWorld);
    (vm.uPrevViewProj.value as Matrix4).copy(this.prevViewProj);
    (vm.uCamPos.value as Vector3).setFromMatrixPosition(camera.matrixWorld);
    (vm.uSunDir.value as Vector3).copy(params.sunDir);
    (vm.uSunColor.value as Vector3).copy(params.sunColor);
    (vm.uAmbient.value as Vector3).copy(params.ambient);
    (vm.uFirePos.value as Vector3).copy(params.firePos);
    (vm.uFireColor.value as Vector3).copy(params.fireColor);
    vm.uFireLight.value = params.fireLight;
    vm.uTime.value = params.time;
    vm.uSteps.value = this.settings.volumeSteps;
    vm.uDensity.value = params.density;
    vm.uFrame.value = this.frame % 64;
    vm.uHistoryMix.value = this.frame === 0 ? 1 : params.historyMix;
    this.fs.run(r, this.volMat, write);
    this.prevViewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    // 4. Combine scene + light, with heat shimmer above the fire.
    const cm = this.combineMat.uniforms;
    cm.tScene.value = this.hdr.texture;
    cm.tVolume.value = write.texture;
    cm.uTime.value = params.time;
    cm.uHazeOn.value = params.haze ? 1 : 0;
    cm.uView.value = params.view ?? 0;
    if (params.haze) cm.uHaze.value = [params.haze.x, params.haze.y, params.haze.w, params.haze.h];
    this.fs.run(r, this.combineMat, this.comp);

    // 5. Bloom.
    let src: Texture = this.comp.texture;
    let sw = this.width;
    let sh = this.height;
    for (let i = 0; i < this.bloom.length; i++) {
      this.downMat.uniforms.tSrc.value = src;
      (this.downMat.uniforms.uTexel.value as Vector2).set(1 / sw, 1 / sh);
      this.downMat.uniforms.uFirst.value = i === 0 ? 1 : 0;
      this.fs.run(r, this.downMat, this.bloom[i]);
      src = this.bloom[i].texture;
      sw = this.bloom[i].width;
      sh = this.bloom[i].height;
    }
    for (let i = this.bloom.length - 1; i > 0; i--) {
      this.upMat.uniforms.tSrc.value = this.bloom[i].texture;
      (this.upMat.uniforms.uTexel.value as Vector2).set(1 / this.bloom[i].width, 1 / this.bloom[i].height);
      this.fs.run(r, this.upMat, this.bloom[i - 1]);
    }

    // 6. Tone map to the canvas.
    const fm = this.finalMat.uniforms;
    fm.tComp.value = this.comp.texture;
    fm.tBloom.value = this.bloom[0]?.texture ?? this.comp.texture;
    fm.uBloom.value = this.bloom.length ? params.bloom : 0;
    fm.uExposure.value = params.exposure;
    fm.uTime.value = params.time;
    (fm.uResolution.value as Vector2).set(this.width, this.height);
    fm.uFlash.value = params.flash;
    fm.uHueKeep.value = params.hueKeep;
    (fm.uMist.value as Vector3).copy(params.mist);
    fm.uSunOn.value = params.sunUv ? params.sunOn : 0;
    if (params.sunUv) (fm.uSunUv.value as Vector2).copy(params.sunUv);
    this.fs.run(r, this.finalMat, null);
    this.frame++;
  }

  /** Copies what the HDR buffer holds so far for the crystals to refract, then resumes drawing into it. */
  private captureRefraction(hooks: FrameHooks) {
    hooks.setRefraction(null, this.size);
    this.copyMat.uniforms.tSrc.value = this.hdr.texture;
    this.fs.run(this.renderer, this.copyMat, this.refraction);
    this.renderer.setRenderTarget(this.hdr);
    hooks.setRefraction(this.refraction.texture, this.size);
  }

  /** Drops temporal history (after a camera cut). */
  resetHistory() { this.frame = 0; }

  dispose(all = true) {
    for (const rt of [this.hdr, this.depthLinear, this.refraction, this.mirror, this.volA, this.volB, this.comp, ...this.bloom]) {
      if (!rt) continue;
      rt.depthTexture?.dispose();
      rt.dispose();
    }
    this.bloom = [];
    if (all) {
      for (const m of [this.copyMat, this.linearDepthMat, this.volMat, this.combineMat, this.downMat, this.upMat, this.finalMat]) m.dispose();
      this.fs.dispose();
    }
  }
}

export type { Camera };
