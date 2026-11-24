/**
 * 3D 沙盘的着色器：水面（深浅、浪纹、岸边浪花）、路线（虚线 / 流光）、光柱、全息网格（科幻）。
 */
import {
  AdditiveBlending, CanvasTexture, Color, DataTexture, DoubleSide, LinearFilter, NormalBlending, RedFormat, ShaderMaterial,
  SRGBColorSpace, UnsignedByteType, type Texture,
} from 'three';
import type { TerrainGrid } from '../../../domains/map/terrain';

const NOISE = /* glsl */`
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}`;

/** 地形海拔编码成单通道贴图（0..255 ↔ -1..1），水面按它取深浅。 */
export function heightTexture(grid: TerrainGrid): DataTexture {
  const data = new Uint8Array(grid.cols * grid.rows);
  for (let index = 0; index < data.length; index++) data[index] = Math.max(0, Math.min(255, Math.round((grid.heights[index]! * 0.5 + 0.5) * 255)));
  const texture = new DataTexture(data, grid.cols, grid.rows, RedFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createWaterMaterial(options: { heights: Texture; shallow: string; deep: string; foam: string; sky: string; sunDir: [number, number, number]; scifi: boolean }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: true,
    uniforms: {
      time: { value: 0 },
      heights: { value: options.heights },
      shallow: { value: new Color(options.shallow) },
      deep: { value: new Color(options.deep) },
      foam: { value: new Color(options.foam) },
      sky: { value: new Color(options.sky) },
      sunDir: { value: options.sunDir },
      scifi: { value: options.scifi ? 1 : 0 },
      fogColor: { value: new Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform sampler2D heights; uniform vec3 shallow; uniform vec3 deep; uniform vec3 foam; uniform vec3 sky;
      uniform vec3 sunDir; uniform float scifi;
      varying vec2 vUv; varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        float h = texture2D(heights, vec2(vUv.x, 1.0 - vUv.y)).r * 2.0 - 1.0;
        float depth = clamp(-h / 0.55, 0.0, 1.0);
        vec3 color = mix(shallow, deep, pow(depth, 0.75));
        vec2 p = vWorld.xz * 0.42;
        float n1 = vnoise(p + vec2(time * 0.22, time * 0.15));
        float n2 = vnoise(p * 2.1 - vec2(time * 0.18, -time * 0.27));
        vec3 normal = normalize(vec3((n1 - 0.5) * 0.55, 1.0, (n2 - 0.5) * 0.55));
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
        color = mix(color, sky, fresnel * 0.55);
        vec3 sun = normalize(sunDir);
        float spec = pow(max(dot(reflect(-sun, normal), viewDir), 0.0), 140.0);
        float shore = smoothstep(0.03, 0.0, -h);
        float swell = smoothstep(0.09, 0.03, -h) * (1.0 - shore);
        float surf = shore * (0.5 + 0.5 * sin(time * 1.4 + vWorld.x * 0.9 + vWorld.z * 0.7 + n1 * 4.0));
        color = mix(color, foam, clamp(surf * 0.55 + swell * 0.05, 0.0, 1.0)) + spec * (scifi > 0.5 ? 0.1 : 0.07);
        if (scifi > 0.5) {
          vec2 grid = abs(fract(vWorld.xz / 6.0 - 0.5) - 0.5) / fwidth(vWorld.xz / 6.0);
          float line = 1.0 - min(min(grid.x, grid.y), 1.0);
          color += vec3(0.08, 0.55, 0.65) * line * 0.35 + foam * shore * 0.4;
        }
        gl_FragColor = vec4(color, mix(0.78, 0.96, depth));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

/** 路线：沿管子长度画虚线或流光；glow = 叠加发光（科幻、规划中的路线）。 */
export function createRouteMaterial(options: { color: string; length: number; dash: number; gap: number; flow: number; opacity: number; glow: boolean }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: !options.glow,
    blending: options.glow ? AdditiveBlending : NormalBlending,
    side: DoubleSide,
    uniforms: {
      time: { value: 0 },
      color: { value: new Color(options.color) },
      length: { value: options.length },
      dash: { value: options.dash },
      gap: { value: options.gap },
      flow: { value: options.flow },
      opacity: { value: options.opacity },
      glow: { value: options.glow ? 1 : 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform vec3 color; uniform float length; uniform float dash; uniform float gap; uniform float flow; uniform float opacity; uniform float glow;
      varying vec2 vUv;
      void main() {
        float along = vUv.x * length - time * flow;
        float period = dash + gap;
        if (gap > 0.0 && mod(along, period) > dash) discard;
        float edge = abs(vUv.y - 0.5) * 2.0;
        float alpha = opacity * (glow > 0.5 ? (1.0 - edge * edge) * 0.9 : 1.0);
        vec3 tint = color;
        if (glow > 0.5) {
          float pulse = 0.65 + 0.35 * sin(vUv.x * length * 0.8 - time * 3.0);
          tint *= 1.4 * pulse;
        }
        gl_FragColor = vec4(tint, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** 当前位置的光柱：底部最亮、向上渐隐，缓慢脉动。 */
export function createBeamMaterial(color: string): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { time: { value: 0 }, color: { value: new Color(color) } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform vec3 color;
      varying vec2 vUv;
      void main() {
        float fade = pow(1.0 - vUv.y, 2.2);
        float ripple = 0.72 + 0.28 * sin(vUv.y * 22.0 - time * 3.2);
        float side = 0.55 + 0.45 * sin(vUv.x * 6.2831 * 3.0 + time * 1.4);
        gl_FragColor = vec4(color * 1.15, fade * ripple * (0.22 + 0.16 * side));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** 科幻地表的全息叠层：等高线 + 网格 + 扫描环，叠加混合。 */
export function createHoloMaterial(options: { color: string; heightScale: number; contours?: boolean; gridSize?: number }): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      time: { value: 0 }, color: { value: new Color(options.color) }, heightScale: { value: options.heightScale }, origin: { value: [0, 0] },
      contours: { value: options.contours === false ? 0 : 1 }, gridSize: { value: options.gridSize ?? 4 },
    },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      void main() { vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
    fragmentShader: /* glsl */`
      uniform float time; uniform vec3 color; uniform float heightScale; uniform vec2 origin; uniform float contours; uniform float gridSize;
      varying vec3 vWorld;
      void main() {
        float contour = 0.0;
        if (contours > 0.5) {
          float level = vWorld.y / heightScale * 12.0;
          contour = 1.0 - min(abs(fract(level - 0.5) - 0.5) / max(fwidth(level), 1e-4), 1.0);
        }
        vec2 cell = vWorld.xz / gridSize;
        vec2 g = abs(fract(cell - 0.5) - 0.5) / max(fwidth(cell), vec2(1e-4));
        float grid = 1.0 - min(min(g.x, g.y), 1.0);
        float dist = length(vWorld.xz - origin);
        float ring = smoothstep(2.5, 0.0, abs(mod(dist - time * 14.0, 70.0) - 35.0)) * 0.6;
        float fade = contours > 0.5 ? 1.0 : smoothstep(80.0, 20.0, length(vWorld.xz));
        float glow = (contour * 0.55 + grid * (contours > 0.5 ? 0.12 : 0.32) + ring * 0.35) * fade;
        gl_FragColor = vec4(color * glow, glow);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

/** 柔光点贴图（星云、光晕、星点）。 */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.45)'));
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** 画布背景：中心亮、四周暗的径向渐变。 */
export function backgroundTexture(center: string, edge: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(256, 220, 20, 256, 256, 380);
  gradient.addColorStop(0, center);
  gradient.addColorStop(1, edge);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
