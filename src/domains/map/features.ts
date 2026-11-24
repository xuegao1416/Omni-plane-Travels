/**
 * 手绘地理要素（MapFeature）的几何工具：点在多边形内、到折线的距离、平滑曲线，
 * 以及把水面 / 陆地 / 地块 / 河流写进地形采样的 sampler（2D 底图与 3D 沙盘共用）。
 */
import type { MapFeature, MapModuleSchema, MapRoute, MapTerrain, MapTheme } from './types';

export type Point2 = [number, number];

export function polygonContains(points: readonly Point2[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

function segmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const length = vx * vx + vy * vy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / length)) : 0;
  const dx = px - (ax + vx * t);
  const dy = py - (ay + vy * t);
  return dx * dx + dy * dy;
}

/** 点到折线（closed 时含首尾相连的边）的最短距离。 */
export function distanceToLine(points: readonly Point2[], x: number, y: number, closed = false): number {
  let best = Infinity;
  const count = points.length;
  const edges = closed ? count : count - 1;
  for (let index = 0; index < edges; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % count]!;
    const d = segmentDistance2(x, y, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

export function lineLength(points: readonly Point2[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
  return total;
}

/** Catmull-Rom 平滑：每段插 steps 个点（closed 为闭合曲线）。 */
export function smoothLine(points: readonly Point2[], steps = 4, closed = false): Point2[] {
  if (points.length < 3 || steps <= 1) return points.map(point => [point[0], point[1]] as Point2);
  const count = points.length;
  const at = (index: number): Point2 => closed ? points[(index + count) % count]! : points[Math.max(0, Math.min(count - 1, index))]!;
  const out: Point2[] = [];
  const segments = closed ? count : count - 1;
  for (let index = 0; index < segments; index++) {
    const p0 = at(index - 1), p1 = at(index), p2 = at(index + 1), p3 = at(index + 2);
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push([points[count - 1]![0], points[count - 1]![1]]);
  return out;
}

/** 沿折线取一半长度处的点与切线角（放路名、危险标记用）。 */
export function pointAlong(points: readonly Point2[], ratio = 0.5): { x: number; y: number; angle: number } {
  const total = lineLength(points);
  let target = total * ratio;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (target <= length || index === points.length - 1) {
      const t = length > 0 ? Math.min(1, target / length) : 0;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
    }
    target -= length;
  }
  const last = points[points.length - 1] ?? [0, 0];
  return { x: last[0], y: last[1], angle: 0 };
}

/** 路线沿途的折线（两端 + 途经点）；没写途经点时返回 undefined，由画面自己画弧线。 */
export function routeLine(route: Pick<MapRoute, 'path'>, a: { x: number; y: number }, b: { x: number; y: number }): Point2[] | undefined {
  if (!route.path?.length) return undefined;
  return [[a.x, a.y], ...route.path.map(point => [point[0], point[1]] as Point2), [b.x, b.y]];
}

export function hasFeatures(config: Pick<MapModuleSchema, 'features'>, kind?: MapFeature['kind']): boolean {
  return Boolean(config.features?.some(feature => !kind || feature.kind === kind));
}

/**
 * 测绘画风按网页地图平涂（统一陆地底色、不画等高线和地区分界）要有手绘地块或建筑撑着；
 * 只画了几条河、一圈海岸的地图（比如 AI 生成的）照旧按地貌上色。
 */
export function paintsFlat(config: Pick<MapModuleSchema, 'features'>, theme: MapTheme): boolean {
  return theme === 'modern' && Boolean(config.features?.some(feature => feature.kind === 'area' || feature.kind === 'building'));
}

// ── Terrain sampler ───────────────────────────────────────────────────

interface Indexed {
  feature: MapFeature;
  x0: number; y0: number; x1: number; y1: number;
}

function index(feature: MapFeature, pad: number): Indexed {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of feature.points) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { feature, x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 会改海拔的地块：山地抬高、城区压平；林地、田野等只换地貌颜色，起伏仍由地区决定。 */
const AREA_TARGET: Partial<Record<MapTerrain, number>> = {
  hills: 0.4, mountains: 0.74, snow: 0.86, urban: 0.1, swamp: 0.03,
};

export interface FeatureSampler {
  /** 有手绘陆地轮廓：返回到海岸的有符号距离（陆地为正）；没有时为 undefined。 */
  coast?: (x: number, y: number) => number;
  /** 把水面、地块、河流写进海拔与地貌（ridge 为该点的山脊噪声 0..1，抬山用）。 */
  apply: (x: number, y: number, h: number, ridge: number) => { h: number; biome?: MapTerrain };
}

/** 只取会改写地形的要素；没有时返回 undefined（不影响旧地图的采样速度）。 */
export function createFeatureSampler(config: Pick<MapModuleSchema, 'features'>): FeatureSampler | undefined {
  const features = config.features ?? [];
  const lands = features.filter(feature => feature.kind === 'land' && feature.points.length >= 3).map(feature => index(feature, 160));
  const waters = features.filter(feature => feature.kind === 'water' && feature.points.length >= 3).map(feature => index(feature, 10));
  const areas = features.filter(feature => feature.kind === 'area' && feature.terrain && feature.points.length >= 3).map(feature => index(feature, 2));
  const rivers = features.filter(feature => feature.kind === 'river' && feature.points.length >= 2).map(feature => ({
    ...index(feature, Math.max(8, (feature.width ?? 3) * 2.5)),
    points: smoothLine(feature.points, 3),
    half: Math.max(0.8, (feature.width ?? 3) / 2),
  }));
  const islands = lands.filter(item => item.feature.level === 'island').map(item => index(item.feature, 2));
  if (!lands.length && !waters.length && !areas.length && !rivers.length) return undefined;

  const coast = lands.length ? (x: number, y: number): number => {
    let inside = -Infinity;
    let outside = Infinity;
    for (const item of lands) {
      if (x < item.x0 || x > item.x1 || y < item.y0 || y > item.y1) continue;
      const d = distanceToLine(item.feature.points, x, y, true);
      if (polygonContains(item.feature.points, x, y)) inside = Math.max(inside, d);
      else outside = Math.min(outside, d);
    }
    if (inside > -Infinity) return inside;
    return outside === Infinity ? -200 : -outside;
  } : undefined;

  const apply = (x: number, y: number, input: number, ridge: number) => {
    let h = input;
    let biome: MapTerrain | undefined;
    for (const item of areas) {
      if (x < item.x0 || x > item.x1 || y < item.y0 || y > item.y1) continue;
      const points = item.feature.points;
      if (!polygonContains(points, x, y)) continue;
      const terrain = item.feature.terrain!;
      if (terrain === 'sea' || terrain === 'lake') continue;
      const depth = distanceToLine(points, x, y, true);
      const k = smoothstep(0, terrain === 'mountains' || terrain === 'snow' ? 60 : terrain === 'hills' ? 34 : 14, depth);
      const target = AREA_TARGET[terrain];
      if (target !== undefined) {
        const lifted = terrain === 'mountains' || terrain === 'snow' ? target + (ridge - 0.4) * 0.45 : terrain === 'hills' ? target + (ridge - 0.4) * 0.12 : target;
        h += (lifted - h) * k * (terrain === 'mountains' || terrain === 'snow' || terrain === 'hills' ? 0.9 : 0.55);
      }
      if (h < 0.02) h = 0.02;
      biome = terrain;
    }
    for (const item of waters) {
      if (x < item.x0 || x > item.x1 || y < item.y0 || y > item.y1) continue;
      const points = item.feature.points;
      const d = distanceToLine(points, x, y, true);
      if (polygonContains(points, x, y)) {
        const shallow = item.feature.level === 'shallow';
        h = Math.min(h, shallow ? -0.012 - 0.03 * smoothstep(0, 20, d) : -0.03 - 0.42 * smoothstep(0, 70, d));
        biome = item.feature.terrain === 'lake' ? 'lake' : 'sea';
      } else if (d < 7 && h > 0.02 && item.feature.level !== 'shallow') {
        // 岸边缓一缓，免得水边是陡崖。
        h = 0.02 + (h - 0.02) * (0.35 + 0.65 * smoothstep(0, 7, d));
      }
    }
    for (const item of rivers) {
      if (x < item.x0 || x > item.x1 || y < item.y0 || y > item.y1) continue;
      const d = distanceToLine(item.points, x, y);
      const bank = Math.max(6, item.half * 4);
      // 河道只压低成谷地、不压到海平面以下：否则 2D 会沿两岸描出海岸线。河面由矢量线（2D）和水带（3D）画。
      if (d < item.half) {
        h = Math.min(h, 0.012);
      } else if (d < item.half + bank && h > 0.02) {
        h -= (h - 0.02) * 0.55 * (1 - (d - item.half) / bank);
      }
    }
    // 湖心岛（level 'island' 的陆地）在水面之后再抬出来。
    for (const item of islands) {
      if (x < item.x0 || x > item.x1 || y < item.y0 || y > item.y1) continue;
      if (!polygonContains(item.feature.points, x, y)) continue;
      const d = distanceToLine(item.feature.points, x, y, true);
      h = Math.max(h, 0.025 + 0.06 * smoothstep(0, 12, d));
      if (biome === 'lake' || biome === 'sea') biome = undefined;
    }
    return { h, ...(biome ? { biome } : {}) };
  };

  return { ...(coast ? { coast } : {}), apply };
}
