/**
 * 地形底图：把地形网格按画风上色（地貌底色 × 山体明暗 × 纸纹/噪点），画进 canvas 并缓存成 dataURL。
 * 输出尺寸是网格的 2 倍，海拔双线性插值、地貌按最近点，再叠一层像素级颗粒，放大后仍有质感。
 */
import { biomeAt, createNoise2D, fbm, type TerrainGrid } from '../../../domains/map/terrain';
import type { MapModuleSchema, MapTerrain, MapTheme } from '../../../domains/map/types';

type RGB = [number, number, number];

interface Palette {
  land: Record<MapTerrain, RGB>;
  shallow: RGB;
  deep: RGB;
  /** 山体明暗强度。 */
  shade: number;
  /** 像素颗粒幅度。 */
  grain: number;
  /** 大块污渍 / 色斑幅度。 */
  stain: number;
  /** 边缘做旧（古卷）。 */
  burn: number;
  /** 海岸浅滩亮边宽度（海拔）。 */
  shore: number;
  shoreColor: RGB;
  /** 平地的明暗比例（0 = 平地不打阴影）。 */
  flatShade: number;
}

const PALETTES: Record<MapTheme, Palette> = {
  ancient: {
    land: {
      sea: [168, 184, 166], lake: [168, 184, 166], plains: [232, 214, 170], farmland: [226, 210, 158], forest: [203, 202, 148],
      hills: [226, 204, 156], mountains: [218, 194, 150], snow: [241, 236, 221], desert: [238, 212, 152], swamp: [197, 197, 150],
      urban: [228, 207, 166], wasteland: [214, 189, 150], void: [232, 214, 170], nebula: [232, 214, 170], asteroid: [232, 214, 170],
    },
    shallow: [178, 192, 172], deep: [134, 156, 146], shade: 0.42, grain: 7, stain: 0.09, burn: 0.34, shore: 0.05, shoreColor: [206, 206, 176], flatShade: 0.55,
  },
  modern: {
    land: {
      sea: [164, 206, 238], lake: [164, 206, 238], plains: [238, 235, 226], farmland: [233, 232, 210], forest: [200, 225, 190],
      hills: [231, 227, 213], mountains: [219, 213, 199], snow: [247, 248, 250], desert: [242, 229, 196], swamp: [208, 225, 202],
      urban: [229, 226, 220], wasteland: [225, 217, 200], void: [238, 235, 226], nebula: [238, 235, 226], asteroid: [238, 235, 226],
    },
    shallow: [170, 213, 242], deep: [128, 183, 230], shade: 0.3, grain: 1.6, stain: 0.015, burn: 0, shore: 0.035, shoreColor: [196, 228, 248], flatShade: 0.12,
  },
  scifi: {
    land: {
      sea: [4, 14, 26], lake: [4, 16, 30], plains: [10, 34, 46], farmland: [10, 38, 44], forest: [8, 40, 44],
      hills: [14, 46, 60], mountains: [18, 58, 76], snow: [40, 92, 112], desert: [32, 40, 46], swamp: [8, 32, 38],
      urban: [16, 30, 52], wasteland: [28, 30, 40], void: [3, 7, 16], nebula: [3, 7, 16], asteroid: [3, 7, 16],
    },
    shallow: [5, 22, 40], deep: [2, 8, 18], shade: 0.5, grain: 3, stain: 0.04, burn: 0, shore: 0.03, shoreColor: [20, 120, 150], flatShade: 0.5,
  },
};

function hexToRgb(hex: string): RGB {
  const value = parseInt(hex.replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const cache = new Map<string, string>();
const MAX_CACHE = 12;

export interface RasterInput {
  config: MapModuleSchema;
  grid: TerrainGrid;
  theme: MapTheme;
  /** 星域：各地区（星云）的颜色。 */
  regionColors: string[];
  key: string;
  /** 网页地图的平涂风格（测绘画风 + 手绘要素）：山体明暗减半、不加颗粒。 */
  flat?: boolean;
}

/** 画出底图并返回 dataURL（同一 key 只画一次）。 */
export function paintTerrain({ config, grid, theme, regionColors, key, flat = false }: RasterInput): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const scale = 2;
  const width = (grid.cols - 1) * scale;
  const height = (grid.rows - 1) * scale;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(width, height);
  const data = image.data;
  const palette = flat ? { ...PALETTES[theme], shade: PALETTES[theme].shade * 0.55, grain: 0.6, stain: 0 } : PALETTES[theme];
  const grainNoise = createNoise2D(config.seed + 17);
  const colors = regionColors.map(hexToRgb);
  const { cols, rows } = grid;
  const at = (col: number, row: number) => grid.heights[Math.min(rows - 1, row) * cols + Math.min(cols - 1, col)]!;
  // 山体明暗：光从西北上方来。
  const light = [-0.62, -0.56, 0.55];
  const lightNorm = Math.hypot(light[0]!, light[1]!, light[2]!);
  let random = (config.seed ^ 0x9e3779b9) >>> 0 || 1;
  const rand = () => {
    random ^= random << 13; random >>>= 0;
    random ^= random >>> 17;
    random ^= random << 5; random >>>= 0;
    return random / 4294967296;
  };

  for (let py = 0; py < height; py++) {
    const gy = py / scale;
    const row = Math.floor(gy);
    const ty = gy - row;
    for (let px = 0; px < width; px++) {
      const gx = px / scale;
      const col = Math.floor(gx);
      const tx = gx - col;
      const h00 = at(col, row), h10 = at(col + 1, row), h01 = at(col, row + 1), h11 = at(col + 1, row + 1);
      const h = (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
      const nearest = Math.min(rows - 1, Math.round(gy)) * cols + Math.min(cols - 1, Math.round(gx));
      const mapX = (px / width) * config.width;
      const mapY = (py / height) * config.height;
      let color: RGB;
      if (grid.space) {
        // 星域：深空底色 + 各星云的颜色按密度叠加。
        const density = grid.density[nearest]!;
        const region = grid.regions[nearest]!;
        const base = palette.land.void;
        const tint = region >= 0 && colors[region] ? colors[region]! : [80, 110, 200] as RGB;
        const swirl = 0.5 + 0.5 * fbm(grainNoise, mapX * 0.012, mapY * 0.012, 4);
        const glow = Math.pow(Math.min(1, density * (0.5 + swirl)), 1.35);
        color = mix(base, tint, glow * 0.55);
        color = mix(color, [235, 240, 255], Math.pow(glow, 3) * 0.18);
      } else if (h < 0) {
        const depth = Math.min(1, -h / 0.6);
        // 平涂风格的海近岸几乎不变色（网页地图的水面是平的），河口画进海里也看不出接缝。
        color = mix(palette.shallow, palette.deep, flat ? Math.pow(depth, 1.6) * 0.45 : Math.pow(depth, 0.8));
        if (-h < palette.shore) color = mix(palette.shoreColor, color, -h / palette.shore);
      } else {
        const biome = biomeAt(grid, nearest);
        // 平涂风格：陆地底色统一（地块要素自己上色），免得地区地貌在底图上露出锯齿色块。
        color = flat ? palette.land.plains : palette.land[biome];
        if (theme === 'scifi') color = mix(color, [24, 92, 110], Math.min(1, h * 0.55));
        // 坡度明暗
        const dx = (at(col + 1, row) - at(Math.max(0, col - 1), row)) * 6;
        const dy = (at(col, row + 1) - at(col, Math.max(0, row - 1))) * 6;
        const nx = -dx, ny = -dy, nz = 1;
        const norm = Math.hypot(nx, ny, nz);
        const lit = (nx * light[0]! + ny * light[1]! + nz * light[2]!) / (norm * lightNorm);
        const relief = Math.min(1, Math.max(0, (h - 0.12) * 2.2));
        const shade = 1 + (lit - 0.7) * palette.shade * (palette.flatShade + (1.25 - palette.flatShade) * relief);
        color = [color[0] * shade, color[1] * shade, color[2] * shade];
        if (h < palette.shore * 0.8 && theme !== 'scifi') color = mix(palette.shoreColor, color, Math.min(1, h / (palette.shore * 0.8)));
      }
      // 大块色斑与像素颗粒
      const stain = palette.stain ? fbm(grainNoise, mapX * 0.006 + 40, mapY * 0.006 - 13, 3) * palette.stain : 0;
      const grain = (rand() - 0.5) * palette.grain;
      let tone = 1 + stain;
      if (palette.burn) {
        const ex = Math.min(px, width - 1 - px) / width;
        const ey = Math.min(py, height - 1 - py) / height;
        const edge = Math.min(ex, ey);
        tone *= 1 - palette.burn * Math.pow(Math.max(0, 1 - edge / 0.09), 2.2) - 0.07 * Math.pow(Math.max(0, 1 - edge / 0.3), 2);
      }
      const offset = (py * width + px) * 4;
      data[offset] = Math.max(0, Math.min(255, color[0] * tone + grain));
      data[offset + 1] = Math.max(0, Math.min(255, color[1] * tone + grain * 0.92));
      data[offset + 2] = Math.max(0, Math.min(255, color[2] * tone + grain * 0.8));
      data[offset + 3] = 255;
    }
  }
  if (grid.space) {
    // 星点：亮度不一的恒星，少数带十字星芒。
    const stars = Math.round((width * height) / 900);
    for (let index = 0; index < stars; index++) {
      const x = Math.floor(rand() * width);
      const y = Math.floor(rand() * height);
      const brightness = Math.pow(rand(), 3);
      const offset = (y * width + x) * 4;
      const value = 140 + brightness * 115;
      data[offset] = Math.max(data[offset]!, value * 0.92);
      data[offset + 1] = Math.max(data[offset + 1]!, value * 0.96);
      data[offset + 2] = Math.max(data[offset + 2]!, value);
    }
  }
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return url;
}
