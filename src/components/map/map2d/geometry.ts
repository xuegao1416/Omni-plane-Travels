/**
 * 2D 地图的矢量层：海岸线、水纹、等高线、地区边界、河流、地貌符号（山、丘、林、沼、沙）与地区名锚点。
 * 全部由地形网格确定性地算出，按配置与画风缓存。
 */
import { contourLines, labelBoundaries, lineLength, polylinePath, smoothPolyline, type Point, type Polyline } from '../../../domains/map/contours';
import { paintsFlat } from '../../../domains/map/features';
import { biomeAt, computeRivers, createNoise2D, gridHeight, type TerrainGrid } from '../../../domains/map/terrain';
import type { MapLocation, MapModuleSchema, MapRegion, MapTerrain, MapTheme } from '../../../domains/map/types';

export type GlyphKind = 'mountain' | 'hill' | 'tree' | 'tuft' | 'dune' | 'rock' | 'park' | 'asteroid';

export interface Glyph {
  kind: GlyphKind;
  x: number;
  y: number;
  size: number;
  variant: number;
  snow?: boolean;
}

export interface RegionLabel {
  id: string;
  name: string;
  x: number;
  y: number;
  size: number;
  water: boolean;
  /** 文字沿着走的弧线（textPath）。 */
  arc: string;
  width: number;
}

export interface MapGeometry {
  coast: string[];
  ripples: Array<{ d: string; opacity: number }>;
  contours: Array<{ d: string; level: number }>;
  borders: string[];
  rivers: Array<{ d: string; width: number }>;
  urban: string[];
  glyphs: Glyph[];
  regionLabels: RegionLabel[];
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const length = vx * vx + vy * vy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length)) : 0;
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function jitter(line: Polyline, amount: number, seed: number): Polyline {
  if (!amount) return line;
  const noise = createNoise2D(seed);
  return {
    closed: line.closed,
    points: line.points.map(([x, y]) => [x + noise(x * 0.045, y * 0.045) * amount, y + noise(x * 0.045 + 17.3, y * 0.045 - 4.1) * amount] as Point),
  };
}

function paths(lines: Polyline[], options: { min: number; smooth: number; jitter?: number; seed?: number }): string[] {
  return lines
    .filter(line => lineLength(line) >= options.min)
    .map(line => polylinePath(jitter(smoothPolyline(line, options.smooth), options.jitter ?? 0, options.seed ?? 1)));
}

const cache = new WeakMap<object, Map<string, MapGeometry>>();

export function buildMapGeometry(config: MapModuleSchema, grid: TerrainGrid, theme: MapTheme, locations: readonly MapLocation[], routes: ReadonlyArray<{ ax: number; ay: number; bx: number; by: number }>): MapGeometry {
  const key = `${theme}|${grid.cols}x${grid.rows}|${routes.length}|${locations.length}`;
  const hit = cache.get(config)?.get(key);
  if (hit) return hit;
  const size = { width: config.width, height: config.height };
  const { cols, rows } = grid;
  const ancient = theme === 'ancient';
  const geometry: MapGeometry = { coast: [], ripples: [], contours: [], borders: [], rivers: [], urban: [], glyphs: [], regionLabels: [] };
  // 手绘要素替代对应的程序生成层：画了河就不再按汇流算河，画了街道就不铺网格街区；
  // 测绘画风有要素时走网页地图的平涂风格（不画等高线，海岸线由水面 / 陆地要素自己描边）。
  const features = config.features ?? [];
  const authoredRivers = features.some(feature => feature.kind === 'river');
  const authoredRoads = features.some(feature => feature.kind === 'road');
  const flat = paintsFlat(config, theme);
  const authoredCoast = theme === 'modern' && features.some(feature => feature.kind === 'water' || feature.kind === 'land');

  if (!grid.space) {
    if (!authoredCoast) geometry.coast = paths(contourLines(grid.heights, cols, rows, 0, size), { min: 14, smooth: 2, jitter: ancient ? 1.1 : 0, seed: config.seed });
    if (ancient) {
      // 古地图沿海岸向外的平行水纹。
      [-0.025, -0.06, -0.105, -0.16].forEach((level, index) => {
        for (const d of paths(contourLines(grid.heights, cols, rows, level, size), { min: 24, smooth: 2, jitter: 0.8, seed: config.seed + index })) {
          geometry.ripples.push({ d, opacity: 0.5 - index * 0.1 });
        }
      });
    }
    const levels = theme === 'ancient' || flat ? [] : theme === 'modern' ? [0.22, 0.36, 0.5, 0.64, 0.78] : [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    for (const level of levels) {
      for (const d of paths(contourLines(grid.heights, cols, rows, level, size), { min: 30, smooth: 2 })) geometry.contours.push({ d, level });
    }
    // 地区边界：只画陆地上、两侧都属于某个地区、且两边影响都不弱的分界（网页地图风格不画这种虚构的分界）。
    if (!flat) geometry.borders = paths(labelBoundaries(grid.regions, cols, rows, size, (a, b, ia, ib) =>
      a >= 0 && b >= 0 && grid.heights[ia]! > 0.01 && grid.heights[ib]! > 0.01
      && config.regions[a]?.terrain !== 'sea' && config.regions[b]?.terrain !== 'sea'
      && config.regions[a]?.terrain !== 'lake' && config.regions[b]?.terrain !== 'lake'
      && grid.weights[ia]! > 0.12 && grid.weights[ib]! > 0.12), { min: 40, smooth: 3, jitter: ancient ? 0.6 : 0, seed: config.seed + 5 });
    if (theme !== 'scifi' && !authoredRivers) {
      // 水系：按汇流量取主干与支流，越往下游越宽。
      let land = 0;
      for (let index = 0; index < grid.heights.length; index++) if (grid.heights[index]! >= 0) land++;
      const threshold = Math.max(110, land * (ancient ? 0.0045 : 0.007));
      for (const river of computeRivers(grid, { threshold, maxRivers: ancient ? 12 : 6, minLength: 12 })) {
        const width = (flow: number) => Math.min(2.6, 0.55 + Math.log(flow / threshold + 1) * 0.55);
        const smooth = smoothPolyline(jitter({ points: river.points, closed: false }, ancient ? 0.9 : 0.3, config.seed + 7), 2).points;
        const ratio = (river.points.length - 1) / Math.max(1, smooth.length - 1);
        const chunk = 24;
        for (let start = 0; start < smooth.length - 1; start += chunk) {
          const slice = smooth.slice(start, Math.min(smooth.length, start + chunk + 1));
          if (slice.length < 2) continue;
          const flow = river.flows[Math.min(river.flows.length - 1, Math.round((start + chunk / 2) * ratio))] ?? threshold;
          geometry.rivers.push({ d: polylinePath({ points: slice, closed: false }), width: width(flow) });
        }
      }
    }
    if ((theme === 'modern' || theme === 'scifi') && !authoredRoads) {
      // 城区轮廓（现代：街区网格的裁剪区；科幻：发光的城区块）。
      const urban = new Float32Array(cols * rows);
      for (let index = 0; index < urban.length; index++) urban[index] = biomeAt(grid, index) === 'urban' && grid.heights[index]! >= 0 ? 1 : 0;
      geometry.urban = contourLines(urban, cols, rows, 0.5, size).filter(line => line.closed && lineLength(line) > 60).map(line => polylinePath(smoothPolyline(line, 2)));
    }
  }

  // 地貌符号
  const random = mulberry(config.seed + 311);
  const avoid = (x: number, y: number, locationGap: number, routeGap: number) =>
    locations.some(location => Math.hypot(location.x - x, location.y - y) < locationGap)
    || routes.some(route => segmentDistance(x, y, route.ax, route.ay, route.bx, route.by) < routeGap);
  const biomeNear = (x: number, y: number): MapTerrain => {
    const col = Math.min(cols - 1, Math.max(0, Math.round((x / config.width) * (cols - 1))));
    const row = Math.min(rows - 1, Math.max(0, Math.round((y / config.height) * (rows - 1))));
    return biomeAt(grid, row * cols + col);
  };
  const scatter = (spacing: number, accept: (x: number, y: number, h: number, biome: MapTerrain) => Glyph | null) => {
    for (let y = spacing * 0.6; y < config.height - spacing * 0.4; y += spacing * 0.86) {
      const offset = (Math.round(y / spacing) % 2) * spacing * 0.5;
      for (let x = spacing * 0.5 + offset; x < config.width - spacing * 0.4; x += spacing) {
        const px = x + (random() - 0.5) * spacing * 0.7;
        const py = y + (random() - 0.5) * spacing * 0.6;
        const h = gridHeight(grid, px, py);
        const glyph = accept(px, py, h, biomeNear(px, py));
        if (glyph) geometry.glyphs.push(glyph);
      }
    }
  };
  if (ancient && !grid.space) {
    scatter(19, (x, y, h, biome) => {
      if (!(h > 0.5 || ((biome === 'mountains' || biome === 'snow') && h > 0.42)) || avoid(x, y, 20, 6)) return null;
      // 越高越可能成峰、也越大；低处的山零散一些。
      if (random() > 0.45 + Math.min(0.5, (h - 0.42) * 1.6)) return null;
      const lift = Math.max(0, h - 0.42);
      return { kind: 'mountain', x, y, size: 8 + Math.min(16, lift * 34) * (0.75 + random() * 0.5), variant: Math.floor(random() * 3), snow: h > 0.8 || (biome === 'snow' && h > 0.55) };
    });
    scatter(21, (x, y, h, biome) => {
      if (!(h > 0.28 && h <= 0.5 && (biome === 'hills' || biome === 'mountains' || h > 0.36)) || avoid(x, y, 18, 6) || random() > 0.8) return null;
      return { kind: 'hill', x, y, size: 7 + random() * 4, variant: Math.floor(random() * 2) };
    });
    scatter(10.5, (x, y, h, biome) => biome === 'forest' && h > 0.02 && h < 0.5 && random() < 0.78 && !avoid(x, y, 16, 5)
      ? { kind: 'tree', x, y, size: 4.2 + random() * 2.4, variant: Math.floor(random() * 3) } : null);
    scatter(17, (x, y, h, biome) => biome === 'swamp' && h >= 0 && random() < 0.6 && !avoid(x, y, 15, 5)
      ? { kind: 'tuft', x, y, size: 4 + random() * 2, variant: Math.floor(random() * 2) } : null);
    scatter(23, (x, y, h, biome) => biome === 'desert' && h >= 0.02 && random() < 0.55 && !avoid(x, y, 16, 6)
      ? { kind: 'dune', x, y, size: 7 + random() * 5, variant: Math.floor(random() * 2) } : null);
    scatter(19, (x, y, h, biome) => biome === 'wasteland' && h >= 0.02 && random() < 0.45 && !avoid(x, y, 15, 5)
      ? { kind: 'rock', x, y, size: 3.5 + random() * 2.5, variant: Math.floor(random() * 3) } : null);
  } else if (theme === 'modern' && !grid.space && !flat) {
    scatter(12, (x, y, h, biome) => biome === 'forest' && h > 0.01 && random() < 0.42 && !avoid(x, y, 12, 5)
      ? { kind: 'park', x, y, size: 2.2 + random() * 1.6, variant: 0 } : null);
  } else if (grid.space) {
    scatter(11, (x, y, _h, biome) => biome === 'asteroid' && random() < 0.42 && !avoid(x, y, 18, 6)
      ? { kind: 'asteroid', x, y, size: 0.7 + Math.pow(random(), 2.2) * 3.2, variant: Math.floor(random() * 8) } : null);
  }
  // 地区名：在地区陆地重心附近挑一个不压地点的位置，字号随半径。
  config.regions.forEach((region: MapRegion, index) => {
    let sx = 0, sy = 0, count = 0;
    for (let row = 0; row < rows; row += 2) {
      for (let col = 0; col < cols; col += 2) {
        const cell = row * cols + col;
        if (grid.regions[cell] !== index) continue;
        sx += (col / (cols - 1)) * config.width;
        sy += (row / (rows - 1)) * config.height;
        count++;
      }
    }
    const water = region.terrain === 'sea' || region.terrain === 'lake';
    const cx = count > 6 ? sx / count : region.x;
    const cy = count > 6 ? sy / count : region.y;
    const sizeBase = Math.min(theme === 'scifi' ? 15 : 23, Math.max(11, region.radius / (theme === 'modern' ? 11 : 8.5)));
    const width = Math.min(region.radius * 1.5, region.name.length * sizeBase * 1.9 + 20);
    const height = sizeBase * 1.4;
    const offsets: Array<[number, number]> = [[0, 0], [0, -0.32], [0, 0.32], [-0.3, 0], [0.3, 0], [-0.25, -0.28], [0.25, 0.28], [0.25, -0.28], [-0.25, 0.28]];
    let best = { x: cx, y: cy, score: Infinity };
    for (const [ox, oy] of offsets) {
      const x = Math.min(config.width - width / 2 - 10, Math.max(width / 2 + 10, cx + ox * region.radius));
      const y = Math.min(config.height - 20, Math.max(24, cy + oy * region.radius));
      const crowd = locations.filter(location => Math.abs(location.x - x) < width / 2 + 16 && Math.abs(location.y - y) < height / 2 + 18).length;
      const score = crowd * 10 + Math.hypot(x - cx, y - cy) / region.radius;
      if (score < best.score) best = { x, y, score };
    }
    const { x, y } = best;
    const bend = ancient ? width * 0.1 : 0;
    geometry.regionLabels.push({
      id: region.id, name: region.name, x, y, size: sizeBase, water, width,
      arc: `M${(x - width / 2).toFixed(1)},${(y + bend / 2).toFixed(1)} Q${x.toFixed(1)},${(y - bend).toFixed(1)} ${(x + width / 2).toFixed(1)},${(y + bend / 2).toFixed(1)}`,
    });
  });
  // 地区名底下清出一块，字不被山林符号压住。
  if (ancient) {
    geometry.glyphs = geometry.glyphs.filter(glyph => !geometry.regionLabels.some(label =>
      !label.water && Math.abs(glyph.x - label.x) < label.width / 2 + 4 && glyph.y > label.y - label.size * 0.9 && glyph.y < label.y + label.size * 1.6));
  }
  geometry.glyphs.sort((a, b) => a.y - b.y);

  let perConfig = cache.get(config);
  if (!perConfig) { perConfig = new Map(); cache.set(config, perConfig); }
  perConfig.set(key, geometry);
  return geometry;
}
