/**
 * 地形场：由地区（中心 + 半径 + 地貌）、大地形和种子噪声确定性地生成海拔与地貌。
 * 2D 底图（栅格 + 等高线）和 3D 沙盘共用同一个场，两种视图的山川海岸一致。
 *
 * 海拔 h 约在 -1..1：h < 0 为水面，0.4 以上为丘陵，0.7 以上为山地，0.85 以上积雪。
 * 星域（landform = space）没有海拔，只有星云密度 density。
 */
import { isSpace } from './config';
import { MAP_TERRAINS, type MapLocation, type MapModuleSchema, type MapTerrain } from './types';
import { createFeatureSampler } from './features';

// ── Seeded 2D simplex noise ───────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export type Noise2D = (x: number, y: number) => number;

export function createNoise2D(seed: number): Noise2D {
  const random = mulberry32(seed || 1);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = p[i]!; p[i] = p[j]!; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;
  return (xin, yin) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[perm[ii + perm[jj]!]! & 7]!; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[perm[ii + i1 + perm[jj + j1]!]! & 7]!; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[perm[ii + 1 + perm[jj + 1]!]! & 7]!; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  };
}

export function fbm(noise: Noise2D, x: number, y: number, octaves: number, lacunarity = 2.03, gain = 0.5): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let index = 0; index < octaves; index++) {
    sum += amplitude * noise(x * frequency, y * frequency);
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

export function ridged(noise: Noise2D, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 0.6;
  let frequency = 1;
  let weight = 1;
  for (let index = 0; index < octaves; index++) {
    let signal = 1 - Math.abs(noise(x * frequency, y * frequency));
    signal *= signal * weight;
    weight = Math.min(1, Math.max(0, signal * 1.6));
    sum += signal * amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return sum;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── Terrain field ─────────────────────────────────────────────────────

/** 各地貌的目标海拔、起伏与山脊强度。 */
const TARGET: Record<MapTerrain, number> = {
  sea: -0.58, lake: -0.3, plains: 0.12, farmland: 0.09, forest: 0.17, hills: 0.4, mountains: 0.76, snow: 0.88,
  desert: 0.15, swamp: 0.025, urban: 0.1, wasteland: 0.17, void: -1, nebula: -1, asteroid: -1,
};
const ROUGH: Record<MapTerrain, number> = {
  sea: 0.14, lake: 0.04, plains: 0.05, farmland: 0.025, forest: 0.07, hills: 0.13, mountains: 0.16, snow: 0.15,
  desert: 0.06, swamp: 0.02, urban: 0.018, wasteland: 0.1, void: 0, nebula: 0, asteroid: 0,
};
const RIDGE: Partial<Record<MapTerrain, number>> = { mountains: 0.42, snow: 0.38, hills: 0.12, wasteland: 0.04 };

const FLAT_KINDS = new Set<MapLocation['kind']>(['capital', 'city', 'town', 'market', 'academy', 'station', 'home', 'village']);

export interface TerrainSample {
  /** 海拔（星域为 -1）。 */
  h: number;
  /** 主导地区序号（-1 为无主之地）。 */
  region: number;
  /** 主导地区的影响权重 0..1。 */
  weight: number;
  biome: MapTerrain;
  /** 星云 / 小行星带密度 0..1（星域）。 */
  density: number;
}

export interface TerrainField {
  readonly width: number;
  readonly height: number;
  readonly space: boolean;
  sample(x: number, y: number): TerrainSample;
  /** 只要海拔（3D 摆放道具、路线贴地用）。 */
  heightAt(x: number, y: number): number;
  noise: Noise2D;
}

interface LocationBucket { cell: number; cols: number; rows: number; items: MapLocation[][] }

function bucketLocations(locations: readonly MapLocation[], width: number, height: number): LocationBucket {
  const cell = 48;
  const cols = Math.max(1, Math.ceil(width / cell));
  const rows = Math.max(1, Math.ceil(height / cell));
  const items: MapLocation[][] = Array.from({ length: cols * rows }, () => []);
  for (const location of locations) {
    const cx = Math.min(cols - 1, Math.max(0, Math.floor(location.x / cell)));
    const cy = Math.min(rows - 1, Math.max(0, Math.floor(location.y / cell)));
    items[cy * cols + cx]!.push(location);
  }
  return { cell, cols, rows, items };
}

export function createTerrainField(config: Pick<MapModuleSchema, 'width' | 'height' | 'seed' | 'landform' | 'regions' | 'locations' | 'features'>): TerrainField {
  const { width, height, regions } = config;
  const space = isSpace(config);
  const noise = createNoise2D(config.seed);
  const warpNoise = createNoise2D(config.seed + 101);
  const detailNoise = createNoise2D(config.seed + 211);
  const freq = 4.4 / Math.max(width, height);
  const side = config.seed % 4;
  const buckets = bucketLocations(config.locations, width, height);
  const waterRegion = regions.map(region => region.terrain === 'sea' || region.terrain === 'lake');
  // 手绘要素：陆地轮廓决定海岸线，水面 / 地块 / 河流在地区混合之后写进去。
  const features = space ? undefined : createFeatureSampler(config);
  const authored = Boolean(features);

  const baseElevation = (nx: number, ny: number, x: number, y: number, coast?: number): number => {
    const swell = fbm(noise, x * freq * 0.7 + 3.1, y * freq * 0.7 - 7.7, 3);
    if (coast !== undefined) {
      return coast >= 0
        ? 0.05 + 0.3 * smoothstep(0, 190, coast) + 0.1 * swell
        : -0.06 - 0.5 * smoothstep(0, 110, -coast) + 0.03 * swell;
    }
    switch (config.landform) {
      case 'island': {
        const d2 = nx * nx * 0.92 + ny * ny * 1.18;
        return 0.44 - 0.98 * d2 + 0.14 * swell;
      }
      case 'archipelago': {
        const d2 = nx * nx + ny * ny;
        return 0.04 + 0.62 * fbm(noise, x * freq * 1.25 + 9.2, y * freq * 1.25 + 1.3, 4) - 0.34 * d2;
      }
      case 'coast': {
        const t = side === 0 ? nx : side === 1 ? -nx : side === 2 ? ny : -ny;
        return 0.3 - 0.82 * smoothstep(0.02, 0.95, t + 0.18 * swell) + 0.1 * swell;
      }
      case 'inland':
        return 0.2 + 0.07 * swell;
      default: {
        const edge = Math.max(Math.abs(nx) * 0.94, Math.abs(ny) * 1.04);
        return 0.34 - 0.78 * Math.pow(edge, 3.1) + 0.13 * swell;
      }
    }
  };

  const sample = (x: number, y: number): TerrainSample => {
    // 领域扭曲：让地区边界与海岸线不那么圆。
    const wx = x + 64 * fbm(warpNoise, x * freq + 11.3, y * freq + 2.7, 3);
    const wy = y + 64 * fbm(warpNoise, x * freq - 5.9, y * freq + 13.1, 3);
    let sumWeight = 0;
    let sumTarget = 0;
    let sumRough = 0;
    let sumRidge = 0;
    let best = -1;
    let bestWeight = 0;
    let density = 0;
    for (let index = 0; index < regions.length; index++) {
      const region = regions[index]!;
      const dx = wx - region.x;
      const dy = wy - region.y;
      const d2 = (dx * dx + dy * dy) / (region.radius * region.radius);
      if (d2 > 6) continue;
      const weight = Math.exp(-d2 * 2.1);
      sumWeight += weight;
      sumTarget += weight * TARGET[region.terrain];
      sumRough += weight * ROUGH[region.terrain];
      sumRidge += weight * (RIDGE[region.terrain] ?? 0);
      if (region.terrain === 'nebula' || region.terrain === 'asteroid') density += weight;
      if (weight > bestWeight) { bestWeight = weight; best = index; }
    }
    if (space) {
      const cloud = 0.55 + 0.45 * fbm(detailNoise, wx * freq * 2.2, wy * freq * 2.2, 4);
      return { h: -1, region: bestWeight > 0.14 ? best : -1, weight: bestWeight, biome: bestWeight > 0.14 ? regions[best]!.terrain : 'void', density: Math.min(1, density * cloud) };
    }
    const nx = (x / width) * 2 - 1;
    const ny = (y / height) * 2 - 1;
    const coast = features?.coast?.(x, y);
    const base = baseElevation(nx, ny, x, y, coast);
    const influence = Math.min(1, sumWeight * 1.35);
    const regionTarget = sumWeight > 1e-6 ? sumTarget / sumWeight : base;
    let h = base + (regionTarget - base) * influence * 0.9;
    const rough = sumWeight > 1e-6 ? (sumRough / sumWeight) * (0.55 + 0.45 * influence) + 0.05 * (1 - influence) : 0.06;
    h += fbm(detailNoise, wx * freq * 2.6, wy * freq * 2.6, 5) * rough * 1.6;
    const ridge = sumWeight > 1e-6 ? sumRidge / sumWeight * influence : 0;
    if (ridge > 0) h += (ridged(noise, wx * freq * 1.9 + 40, wy * freq * 1.9 - 12, 4) - 0.32) * ridge;
    if (best >= 0 && coast === undefined) {
      if (waterRegion[best] && bestWeight > 0.3) h = Math.min(h, -0.06 - 0.3 * bestWeight);
      else if (!waterRegion[best] && bestWeight > 0.46) h = Math.max(h, 0.02 + 0.06 * bestWeight);
    }
    let forced: MapTerrain | undefined;
    if (features) {
      if (coast !== undefined) h = coast >= 0 ? Math.max(h, 0.012 + Math.min(0.04, coast * 0.002)) : Math.min(h, -0.02 + Math.max(-0.4, coast * 0.004));
      const result = features.apply(x, y, h, ridged(noise, x * freq * 1.9 + 40, y * freq * 1.9 - 12, 4));
      h = result.h;
      forced = result.biome;
    }
    // 地点脚下一定是陆地，城镇周围压平一些（3D 里摆得下房子）。
    // 手绘地图的水面是画出来的：只保住地点正下方一小块，不把旁边的河湖填平。
    const keep = authored ? 9 : 40;
    const bx = Math.floor(x / buckets.cell);
    const by = Math.floor(y / buckets.cell);
    for (let cy = by - 1; cy <= by + 1; cy++) {
      if (cy < 0 || cy >= buckets.rows) continue;
      for (let cx = bx - 1; cx <= bx + 1; cx++) {
        if (cx < 0 || cx >= buckets.cols) continue;
        for (const location of buckets.items[cy * buckets.cols + cx]!) {
          const d = Math.hypot(x - location.x, y - location.y);
          if (d > keep) continue;
          if (location.kind !== 'port') {
            const k = authored ? smoothstep(keep, 3, d) : smoothstep(40, 10, d);
            if (h < 0.05) h += (0.05 - h) * k;
          }
          if (authored && h <= 0) continue;
          if (FLAT_KINDS.has(location.kind)) {
            const k = smoothstep(26, 4, d) * 0.75;
            const flat = Math.min(0.24, Math.max(0.06, h));
            h += (flat - h) * k;
          }
        }
      }
    }
    let biome: MapTerrain;
    const dominant = best >= 0 && bestWeight > 0.16 ? regions[best]!.terrain : undefined;
    const forcedWater = forced === 'lake' || forced === 'sea';
    if (h < 0) biome = forcedWater ? forced! : dominant === 'lake' || config.landform === 'inland' ? 'lake' : 'sea';
    else if (forced && !forcedWater && !((forced === 'mountains' || forced === 'hills') && h > 0.9)) biome = forced;
    else if (h > 0.86) biome = 'snow';
    else if (dominant && !waterRegion[best]) biome = dominant;
    else biome = h > 0.68 ? 'mountains' : h > 0.42 ? 'hills' : 'plains';
    if (!forced && (biome === 'mountains' || biome === 'hills') && h < 0.3 && dominant !== biome) biome = 'plains';
    return { h, region: bestWeight > 0.08 ? best : -1, weight: bestWeight, biome, density: 0 };
  };

  return { width, height, space, sample, heightAt: (x, y) => sample(x, y).h, noise };
}

// ── Sampled grid ──────────────────────────────────────────────────────

export interface TerrainGrid {
  cols: number;
  rows: number;
  width: number;
  height: number;
  space: boolean;
  heights: Float32Array;
  regions: Int16Array;
  weights: Float32Array;
  /** MAP_TERRAINS 序号。 */
  biomes: Uint8Array;
  density: Float32Array;
}

const BIOME_INDEX = new Map(MAP_TERRAINS.map((terrain, index) => [terrain, index] as const));

export function biomeAt(grid: TerrainGrid, index: number): MapTerrain {
  return MAP_TERRAINS[grid.biomes[index]!] ?? 'plains';
}

const gridCache = new WeakMap<object, Map<string, TerrainGrid>>();

/** 按 cols × rows 个顶点采样（同一份配置与分辨率只算一次）。 */
export function sampleTerrainGrid(config: MapModuleSchema, cols: number, rows: number, field?: TerrainField): TerrainGrid {
  const cached = gridCache.get(config)?.get(`${cols}x${rows}`);
  if (cached) return cached;
  const terrain = field ?? createTerrainField(config);
  const count = cols * rows;
  const grid: TerrainGrid = {
    cols, rows, width: config.width, height: config.height, space: terrain.space,
    heights: new Float32Array(count), regions: new Int16Array(count), weights: new Float32Array(count),
    biomes: new Uint8Array(count), density: new Float32Array(count),
  };
  for (let row = 0; row < rows; row++) {
    const y = (row / (rows - 1)) * config.height;
    for (let col = 0; col < cols; col++) {
      const x = (col / (cols - 1)) * config.width;
      const sample = terrain.sample(x, y);
      const index = row * cols + col;
      grid.heights[index] = sample.h;
      grid.regions[index] = sample.region;
      grid.weights[index] = sample.weight;
      grid.biomes[index] = BIOME_INDEX.get(sample.biome) ?? 0;
      grid.density[index] = sample.density;
    }
  }
  let perConfig = gridCache.get(config);
  if (!perConfig) { perConfig = new Map(); gridCache.set(config, perConfig); }
  perConfig.set(`${cols}x${rows}`, grid);
  return grid;
}

/** 双线性插值取网格上的海拔。 */
export function gridHeight(grid: TerrainGrid, x: number, y: number): number {
  const fx = Math.min(grid.cols - 1.0001, Math.max(0, (x / grid.width) * (grid.cols - 1)));
  const fy = Math.min(grid.rows - 1.0001, Math.max(0, (y / grid.height) * (grid.rows - 1)));
  const col = Math.floor(fx);
  const row = Math.floor(fy);
  const tx = fx - col;
  const ty = fy - row;
  const index = row * grid.cols + col;
  const a = grid.heights[index]!;
  const b = grid.heights[index + 1]!;
  const c = grid.heights[index + grid.cols]!;
  const d = grid.heights[index + grid.cols + 1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * 水系：先用优先级填洼（priority-flood）让每个格子都能流到海或地图边缘，再按汇流量取出主干河道。
 * 返回地图单位的折线（从源头到入海口）与每条的最大汇流量；只用于渲染。
 */
export function computeRivers(grid: TerrainGrid, options: { threshold: number; maxRivers: number; minLength: number }): Array<{ points: Array<[number, number]>; flows: number[]; flow: number }> {
  if (grid.space) return [];
  const { cols, rows } = grid;
  const count = cols * rows;
  const filled = new Float32Array(count);
  const parent = new Int32Array(count).fill(-1);
  const order: number[] = [];
  const done = new Uint8Array(count);
  // 二叉堆（按填洼后的海拔）
  const heap: number[] = [];
  const keys = new Float32Array(count);
  const push = (index: number, key: number) => {
    keys[index] = key;
    heap.push(index);
    let child = heap.length - 1;
    while (child > 0) {
      const up = (child - 1) >> 1;
      if (keys[heap[up]!]! <= keys[heap[child]!]!) break;
      [heap[up], heap[child]] = [heap[child]!, heap[up]!];
      child = up;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let node = 0;
      for (;;) {
        const left = node * 2 + 1;
        const right = left + 1;
        let smallest = node;
        if (left < heap.length && keys[heap[left]!]! < keys[heap[smallest]!]!) smallest = left;
        if (right < heap.length && keys[heap[right]!]! < keys[heap[smallest]!]!) smallest = right;
        if (smallest === node) break;
        [heap[node], heap[smallest]] = [heap[smallest]!, heap[node]!];
        node = smallest;
      }
    }
    return top;
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const h = grid.heights[index]!;
      if (h < 0 || col === 0 || row === 0 || col === cols - 1 || row === rows - 1) {
        done[index] = 1;
        filled[index] = Math.min(h, 0);
        push(index, filled[index]!);
      }
    }
  }
  const EPS = 1e-4;
  while (heap.length) {
    const index = pop();
    order.push(index);
    const col = index % cols;
    const row = (index - col) / cols;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
        const next = r * cols + c;
        if (done[next]) continue;
        done[next] = 1;
        filled[next] = Math.max(grid.heights[next]!, filled[index]! + EPS);
        parent[next] = index;
        push(next, filled[next]!);
      }
    }
  }
  // 汇流量：从高到低把每格的流量交给下游。
  const flow = new Float32Array(count);
  for (let index = 0; index < count; index++) flow[index] = grid.heights[index]! >= 0 ? 1 : 0;
  for (let step = order.length - 1; step >= 0; step--) {
    const index = order[step]!;
    const down = parent[index]!;
    if (down >= 0 && grid.heights[index]! >= 0) flow[down]! += flow[index]!;
  }
  const isRiver = (index: number) => grid.heights[index]! >= 0 && flow[index]! >= options.threshold;
  // 源头：自己够格、上游没有够格的格子。
  const upstream = new Uint8Array(count);
  for (let index = 0; index < count; index++) {
    const down = parent[index]!;
    if (down >= 0 && isRiver(index)) upstream[down] = 1;
  }
  const sources: number[] = [];
  for (let index = 0; index < count; index++) if (isRiver(index) && !upstream[index]) sources.push(index);
  // 高处的源头先走：主干先成形，支流在汇合处停下。
  sources.sort((a, b) => grid.heights[b]! - grid.heights[a]!);
  const taken = new Uint8Array(count);
  const rivers: Array<{ points: Array<[number, number]>; flows: number[]; flow: number }> = [];
  const point = (index: number): [number, number] => {
    const col = index % cols;
    return [(col / (cols - 1)) * grid.width, (((index - col) / cols) / (rows - 1)) * grid.height];
  };
  for (const source of sources) {
    const points: Array<[number, number]> = [];
    const flows: number[] = [];
    let index = source;
    let peak = 0;
    for (let guard = 0; guard < count && index >= 0; guard++) {
      points.push(point(index));
      flows.push(flow[index]!);
      peak = Math.max(peak, flow[index]!);
      if (grid.heights[index]! < 0) break;
      if (taken[index] && points.length > 1) break;
      taken[index] = 1;
      index = parent[index]!;
    }
    if (points.length >= options.minLength) rivers.push({ points, flows, flow: peak });
  }
  return rivers.sort((a, b) => b.flow - a.flow).slice(0, options.maxRivers);
}
