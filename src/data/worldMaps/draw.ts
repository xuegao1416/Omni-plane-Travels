/**
 * 内置地图的绘制工具：确定性的随机数、带噪声的轮廓、平滑曲线、街网与街区建筑。
 * 只在模块加载时跑一次，产出 MapFeature 列表（坐标为地图单位，默认画布 1000 × 700）。
 */
import type { MapFeature, MapTerrain } from '../../domains/map/types';

export type P = [number, number];

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (value: number) => Math.round(value * 10) / 10;
const pt = (x: number, y: number): P => [r1(x), r1(y)];

/** 平滑的低频噪声（几组正弦叠加，按种子错相）。 */
function wave(seed: number): (t: number) => number {
  const random = rng(seed);
  const terms = Array.from({ length: 4 }, (_, index) => ({ f: index + 1 + random() * 0.6, p: random() * Math.PI * 2, a: 1 / (index + 1.4) }));
  return t => terms.reduce((sum, term) => sum + term.a * Math.sin(t * term.f + term.p), 0) / 1.4;
}

/** 带噪声的闭合轮廓（湖、岛、公园、林地）。 */
export function blob(cx: number, cy: number, rx: number, ry: number, seed: number, jag = 0.14, count = 44, rotate = 0): P[] {
  const noise = wave(seed);
  const noise2 = wave(seed + 7);
  const cos = Math.cos(rotate), sin = Math.sin(rotate);
  return Array.from({ length: count }, (_, index) => {
    const t = (index / count) * Math.PI * 2;
    const k = 1 + jag * noise(t) + jag * 0.35 * noise2(t * 3);
    const x = Math.cos(t) * rx * k;
    const y = Math.sin(t) * ry * k;
    return pt(cx + x * cos - y * sin, cy + x * sin + y * cos);
  });
}

/** 把折线细分到每段不超过 step，再沿法向加噪声（海岸、河流、山路更自然）。 */
export function wobble(points: readonly P[], amount: number, seed: number, step = 14, closed = false): P[] {
  const dense: P[] = [];
  const count = points.length;
  const segments = closed ? count : count - 1;
  for (let index = 0; index < segments; index++) {
    const a = points[index]!;
    const b = points[(index + 1) % count]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const parts = Math.max(1, Math.ceil(length / step));
    for (let part = 0; part < parts; part++) {
      const t = part / parts;
      dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (!closed) dense.push([points[count - 1]![0], points[count - 1]![1]]);
  const noise = wave(seed);
  let travelled = 0;
  return dense.map((point, index) => {
    const prev = dense[Math.max(0, index - 1)]!;
    const next = dense[Math.min(dense.length - 1, index + 1)]!;
    if (index > 0) travelled += Math.hypot(point[0] - prev[0], point[1] - prev[1]);
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const length = Math.hypot(tx, ty) || 1;
    const edge = !closed && (index === 0 || index === dense.length - 1) ? 0 : 1;
    const offset = noise(travelled / 60) * amount * edge;
    return pt(point[0] - (ty / length) * offset, point[1] + (tx / length) * offset);
  });
}

/** 旋转矩形（建筑、操场、站台）。 */
export function rect(cx: number, cy: number, w: number, h: number, angle = 0): P[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as P[]).map(([x, y]) => pt(cx + x * cos - y * sin, cy + x * sin + y * cos));
}

/** 局部坐标系：以 origin 为原点、旋转 angle（弧度）；街网、校园都在这里排。 */
export function frame(origin: P, angle: number) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return (u: number, v: number): P => pt(origin[0] + u * cos - v * sin, origin[1] + u * sin + v * cos);
}

export function inside(polygon: readonly P[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) hit = !hit;
  }
  return hit;
}

/** 把一条线裁成落在多边形里的若干段（采样裁剪，足够画街道用）。 */
export function clipLine(line: readonly P[], polygon: readonly P[], step = 3): P[][] {
  const out: P[][] = [];
  let current: P[] = [];
  for (let index = 0; index < line.length - 1; index++) {
    const a = line[index]!;
    const b = line[index + 1]!;
    const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let part = 0; part <= parts; part++) {
      if (part === parts && index < line.length - 2) continue;
      const t = part / parts;
      const p = pt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (inside(polygon, p[0], p[1])) current.push(p);
      else if (current.length) { if (current.length > 1) out.push(current); current = []; }
    }
  }
  if (current.length > 1) out.push(current);
  return out.map(points => simplify(points));
}

/** 去掉共线的中间点。 */
function simplify(points: P[]): P[] {
  if (points.length <= 2) return points;
  const out: P[] = [points[0]!];
  for (let index = 1; index < points.length - 1; index++) {
    const a = out[out.length - 1]!;
    const b = points[index]!;
    const c = points[index + 1]!;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 0.6) out.push(b);
  }
  out.push(points[points.length - 1]!);
  return out;
}

export interface GridOptions {
  origin: P;
  angle: number;
  /** 街道间距（局部 u / v 方向）。 */
  du: number;
  dv: number;
  /** 局部坐标范围。 */
  u0: number; u1: number; v0: number; v1: number;
  clip: readonly P[];
  seed: number;
  /** 每段街道被省略的概率（让街网不那么规整）。 */
  gaps?: number;
  /** 整条街每 major 条升一级为主干道。 */
  majorEvery?: number;
  /** 弯曲幅度。 */
  bend?: number;
}

/** 规整街网（局部网格裁进城区轮廓）：返回 { minor, major } 两级街道。 */
export function streetGrid(options: GridOptions): { minor: P[][]; major: P[][]; cells: Array<{ u: number; v: number }> } {
  const random = rng(options.seed);
  const at = frame(options.origin, options.angle);
  const minor: P[][] = [];
  const major: P[][] = [];
  const bend = options.bend ?? 0;
  const lineAlong = (fixed: number, from: number, to: number, horizontal: boolean, seed: number): P[] => {
    const noise = wave(seed);
    const points: P[] = [];
    for (let t = from; t <= to + 0.01; t += Math.max(6, (to - from) / 24)) {
      const wiggle = bend * noise(t / 40);
      points.push(horizontal ? at(t, fixed + wiggle) : at(fixed + wiggle, t));
    }
    return points;
  };
  let row = 0;
  for (let v = options.v0; v <= options.v1 + 0.01; v += options.dv, row++) {
    const isMajor = Boolean(options.majorEvery && row % options.majorEvery === 0);
    for (const part of clipLine(lineAlong(v, options.u0, options.u1, true, options.seed + row * 13), options.clip)) {
      if (!isMajor && random() < (options.gaps ?? 0)) continue;
      (isMajor ? major : minor).push(part);
    }
  }
  let col = 0;
  for (let u = options.u0; u <= options.u1 + 0.01; u += options.du, col++) {
    const isMajor = Boolean(options.majorEvery && col % options.majorEvery === 0);
    for (const part of clipLine(lineAlong(u, options.v0, options.v1, false, options.seed + 500 + col * 17), options.clip)) {
      if (!isMajor && random() < (options.gaps ?? 0)) continue;
      (isMajor ? major : minor).push(part);
    }
  }
  const cells: Array<{ u: number; v: number }> = [];
  for (let v = options.v0; v < options.v1; v += options.dv) for (let u = options.u0; u < options.u1; u += options.du) cells.push({ u: u + options.du / 2, v: v + options.dv / 2 });
  return { minor, major, cells };
}

/** 在街区格子里排建筑轮廓（沿街退界、大小随机，避开 avoid 返回 true 的位置）。 */
export function blockBuildings(options: {
  origin: P; angle: number; du: number; dv: number; cells: Array<{ u: number; v: number }>;
  clip: readonly P[]; seed: number; street: number; fill?: number; tall?: (x: number, y: number) => number; avoid?: (x: number, y: number) => boolean;
}): MapFeature[] {
  const random = rng(options.seed);
  const at = frame(options.origin, options.angle);
  const out: MapFeature[] = [];
  const innerU = options.du - options.street * 2;
  const innerV = options.dv - options.street * 2;
  for (const cell of options.cells) {
    const center = at(cell.u, cell.v);
    if (!inside(options.clip, center[0], center[1]) || options.avoid?.(center[0], center[1])) continue;
    if (random() > (options.fill ?? 0.85)) continue;
    // 每个街区切成 1~3 × 1~2 块，各放一栋。
    const splitsU = innerU > 14 ? 1 + Math.floor(random() * 3) : 1;
    const splitsV = innerV > 12 ? 1 + Math.floor(random() * 2) : 1;
    for (let i = 0; i < splitsU; i++) {
      for (let j = 0; j < splitsV; j++) {
        if (random() < 0.12) continue;
        const cu = cell.u - innerU / 2 + (innerU / splitsU) * (i + 0.5);
        const cv = cell.v - innerV / 2 + (innerV / splitsV) * (j + 0.5);
        const w = (innerU / splitsU) * (0.62 + random() * 0.3);
        const h = (innerV / splitsV) * (0.6 + random() * 0.32);
        const c = at(cu, cv);
        if (!inside(options.clip, c[0], c[1]) || options.avoid?.(c[0], c[1])) continue;
        const height = Math.round((options.tall ? options.tall(c[0], c[1]) : 1) * (0.7 + random() * 0.8) * 100) / 100;
        out.push({ kind: 'building', points: rect(c[0], c[1], w, h, options.angle), height });
      }
    }
  }
  return out;
}

// ── Feature shorthands ────────────────────────────────────────────────

export const water = (points: P[], terrain: 'sea' | 'lake' = 'sea', name?: string, level?: string): MapFeature => ({ kind: 'water', points, terrain, ...(name ? { name } : {}), ...(level ? { level } : {}) });
export const land = (points: P[], level?: 'island'): MapFeature => ({ kind: 'land', points, ...(level ? { level } : {}) });
export const area = (points: P[], terrain: MapTerrain, level?: string, name?: string): MapFeature => ({ kind: 'area', points, terrain, ...(level ? { level } : {}), ...(name ? { name } : {}) });
export const river = (points: P[], width: number, name?: string): MapFeature => ({ kind: 'river', points, width, ...(name ? { name } : {}) });
export const road = (points: P[], level: 'highway' | 'major' | 'street' | 'path', name?: string, width?: number): MapFeature => ({ kind: 'road', points, level, ...(name ? { name } : {}), ...(width ? { width } : {}) });
export const rail = (points: P[], level?: 'metro' | 'tunnel', name?: string, color?: string): MapFeature => ({ kind: 'rail', points, ...(level ? { level } : {}), ...(name ? { name } : {}), ...(color ? { color } : {}) });
export const border = (points: P[], level: 'national' | 'region' | 'wall' = 'national', name?: string): MapFeature => ({ kind: 'border', points, level, ...(name ? { name } : {}) });
export const building = (points: P[], height = 1): MapFeature => ({ kind: 'building', points, height });
export const label = (x: number, y: number, name: string, level: 'country' | 'district' | 'water' | 'peak' | 'range' = 'district'): MapFeature => ({ kind: 'label', points: [pt(x, y)], name, level });

/** 一条线的一段（按点序号），用作路线的途经点。 */
export function between(points: readonly P[], from: number, to: number): P[] {
  const slice = from <= to ? points.slice(from, to + 1) : points.slice(to, from + 1).reverse();
  return slice.map(point => [point[0], point[1]] as P);
}

/** 一条线上离 from、to 最近两点之间的一段（按 from → to 的方向），抽稀到最多 maxPoints 个点。 */
export function along(points: readonly P[], from: P, to: P, maxPoints = 40): P[] {
  const nearest = (target: P) => {
    let best = 0;
    let bestDistance = Infinity;
    points.forEach((point, index) => {
      const d = Math.hypot(point[0] - target[0], point[1] - target[1]);
      if (d < bestDistance) { bestDistance = d; best = index; }
    });
    return best;
  };
  const a = nearest(from);
  const b = nearest(to);
  const slice = a <= b ? points.slice(a, b + 1) : points.slice(b, a + 1).reverse();
  const step = Math.max(1, Math.ceil(slice.length / maxPoints));
  const out = slice.filter((_, index) => index % step === 0 || index === slice.length - 1);
  return out.map(point => [point[0], point[1]] as P);
}

/** 折线的平行线：d > 0 偏到前进方向左侧（画布坐标，y 向下）。 */
export function offset(points: readonly P[], d: number): P[] {
  return points.map((point, index) => {
    const prev = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const length = Math.hypot(tx, ty) || 1;
    return pt(point[0] + (ty / length) * d, point[1] - (tx / length) * d);
  });
}

/** 把一条线落在多边形外的部分切成若干段（街道绕开校园、公园）。 */
export function outside(line: readonly P[], polygon: readonly P[], step = 3): P[][] {
  const out: P[][] = [];
  let current: P[] = [];
  for (let index = 0; index < line.length - 1; index++) {
    const a = line[index]!;
    const b = line[index + 1]!;
    const parts = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let part = 0; part <= parts; part++) {
      if (part === parts && index < line.length - 2) continue;
      const t = part / parts;
      const p = pt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      if (!inside(polygon, p[0], p[1])) current.push(p);
      else if (current.length) { if (current.length > 1) out.push(current); current = []; }
    }
  }
  if (current.length > 1) out.push(current);
  return out;
}

/** 椭圆（跑道、广场）。 */
export function ellipse(cx: number, cy: number, rx: number, ry: number, angle = 0, count = 40): P[] {
  return blob(cx, cy, rx, ry, 1, 0, count, angle);
}
