/**
 * 路网：合并世界地图与存档里新增的地点/路线，估算每段路的时长、体力与风险，按时长求最短路。
 * 另含自动连路（相对邻域图，保证连通）、错开重叠地点与按方位放置新地点的工具。
 */
import { lineLength, routeLine } from './features';
import { defaultMinutesPerUnit, nearestRegion } from './config';
import type { MapLocation, MapModuleSchema, MapRegion, MapRoute, MapRouteKind, MapRuntimeState, MapTerrain } from './types';

export interface MapGraph {
  config: MapModuleSchema;
  locations: Map<string, MapLocation>;
  regions: Map<string, MapRegion>;
  routes: MapRoute[];
  adjacency: Map<string, Array<{ route: MapRoute; to: string }>>;
}

export function allLocations(config: MapModuleSchema, runtime?: MapRuntimeState): MapLocation[] {
  const extra = (runtime?.extraLocations ?? []).filter(item => !config.locations.some(location => location.id === item.id));
  return [...config.locations, ...extra];
}

export function allRoutes(config: MapModuleSchema, runtime?: MapRuntimeState): MapRoute[] {
  const extra = (runtime?.extraRoutes ?? []).filter(item => !config.routes.some(route => route.id === item.id));
  return [...config.routes, ...extra];
}

/** 路线是否对玩家可见：隐秘路线要先发现，两端至少有一端已知。 */
export function routeKnown(route: MapRoute, runtime: MapRuntimeState | undefined): boolean {
  if (route.hidden && !runtime?.routes.includes(route.id)) return false;
  if (!runtime) return true;
  return runtime.discovered.includes(route.from) || runtime.discovered.includes(route.to);
}

export function buildGraph(config: MapModuleSchema, runtime?: MapRuntimeState, options: { knownOnly?: boolean } = {}): MapGraph {
  const locations = new Map(allLocations(config, runtime).map(location => [location.id, location] as const));
  const regions = new Map(config.regions.map(region => [region.id, region] as const));
  const routes = allRoutes(config, runtime).filter(route => locations.has(route.from) && locations.has(route.to)
    // 没有进度（旧存档还没整理出 state.map）时按全部已知处理，不能因为读不到进度就崩掉。
    && (!options.knownOnly || !runtime || (routeKnown(route, runtime) && runtime.discovered.includes(route.from) && runtime.discovered.includes(route.to))));
  const adjacency = new Map<string, Array<{ route: MapRoute; to: string }>>();
  const link = (from: string, to: string, route: MapRoute) => {
    const list = adjacency.get(from);
    if (list) list.push({ route, to }); else adjacency.set(from, [{ route, to }]);
  };
  for (const route of routes) {
    link(route.from, route.to, route);
    if (!route.oneWay) link(route.to, route.from, route);
  }
  return { config, locations, regions, routes, adjacency };
}

const KIND_SPEED: Record<MapRouteKind, number> = {
  road: 1, trail: 1.35, mountain: 1.9, river: 0.62, sea: 0.5, rail: 0.22, highway: 0.16, air: 0.07, warp: 0.02, secret: 1.25,
};
const KIND_STAMINA: Record<MapRouteKind, number> = {
  road: 5, trail: 7, mountain: 11, river: 2, sea: 2, rail: 1, highway: 1, air: 0.5, warp: 0, secret: 8,
};
const WALKING = new Set<MapRouteKind>(['road', 'trail', 'mountain', 'secret']);
const TERRAIN_SLOWDOWN: Partial<Record<MapTerrain, number>> = {
  mountains: 1.25, snow: 1.35, swamp: 1.3, forest: 1.12, desert: 1.2, hills: 1.1, wasteland: 1.15, urban: 0.9,
};

/** 默认检定属性：山路、小径、密道考灵巧（dim3），水路体魄（dim2），其余感知（dim6）。 */
export function defaultCheckStat(kind: MapRouteKind): string {
  return kind === 'mountain' || kind === 'trail' || kind === 'secret' ? 'dim3' : kind === 'river' || kind === 'sea' ? 'dim2' : 'dim6';
}

export interface LegEstimate {
  route: MapRoute;
  from: string;
  to: string;
  minutes: number;
  stamina: number;
  danger: number;
  dc: number;
  checkStat: string;
  currency: number;
  resources: Record<string, number>;
}

export interface LegContext {
  /** 体力倍率：体力上限 / 100（数值属性未启用时为 0，不消耗体力）。 */
  staminaScale: number;
  /** 统一加成：`map.travel.time` / `map.travel.stamina`。 */
  modify?: (target: string, base: number) => number;
}

function regionTerrain(graph: MapGraph, location: MapLocation | undefined): MapTerrain | undefined {
  if (!location) return undefined;
  const region = (location.regionId ? graph.regions.get(location.regionId) : undefined) ?? nearestRegion(graph.config.regions, location.x, location.y);
  return region?.terrain;
}

export function distanceBetween(a: Pick<MapLocation, 'x' | 'y'>, b: Pick<MapLocation, 'x' | 'y'>): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function estimateLeg(graph: MapGraph, route: MapRoute, from: string, context: LegContext): LegEstimate {
  const to = route.from === from ? route.to : route.from;
  const a = graph.locations.get(from);
  const b = graph.locations.get(to);
  const config = graph.config;
  let minutes = route.minutes ?? 0;
  if (!minutes) {
    const line = a && b ? routeLine(route, a, b) : undefined;
    const distance = a && b ? (line ? lineLength(line) : distanceBetween(a, b)) : 100;
    const perUnit = config.travel?.minutesPerUnit ?? defaultMinutesPerUnit(config.scale);
    const slow = WALKING.has(route.kind)
      ? ((TERRAIN_SLOWDOWN[regionTerrain(graph, a) ?? 'plains'] ?? 1) + (TERRAIN_SLOWDOWN[regionTerrain(graph, b) ?? 'plains'] ?? 1)) / 2
      : 1;
    minutes = distance * perUnit * KIND_SPEED[route.kind] * slow;
    minutes = route.kind === 'warp' ? Math.max(20, minutes) : Math.max(5, minutes);
  }
  minutes = context.modify ? context.modify('map.travel.time', minutes) : minutes;
  minutes = Math.max(1, Math.round(minutes / 5) * 5 || Math.round(minutes));
  const perHour = WALKING.has(route.kind) && config.travel?.staminaPerHour !== undefined
    ? config.travel.staminaPerHour * (KIND_STAMINA[route.kind] / KIND_STAMINA.road)
    : KIND_STAMINA[route.kind];
  let stamina = context.staminaScale > 0 ? (minutes / 60) * perHour * context.staminaScale + (route.cost?.stamina ?? 0) : 0;
  if (stamina > 0 && context.modify) stamina = context.modify('map.travel.stamina', stamina);
  const danger = Math.max(0, Math.min(5, route.danger ?? 0));
  const resources: Record<string, number> = { ...(route.cost?.resources ?? {}) };
  for (const [id, per8h] of Object.entries(config.travel?.supplies ?? {})) {
    const amount = Math.round(per8h * (minutes / 480) * 100) / 100;
    if (amount >= 0.5) resources[id] = Math.round(((resources[id] ?? 0) + amount) * 100) / 100;
  }
  return {
    route, from, to, minutes,
    stamina: Math.max(0, Math.round(Math.min(stamina, 999))),
    danger,
    dc: route.check?.dc ?? 8 + danger * 2,
    checkStat: route.check?.stat ?? defaultCheckStat(route.kind),
    currency: route.cost?.currency ?? 0,
    resources,
  };
}

export interface PathResult {
  nodes: string[];
  legs: LegEstimate[];
  minutes: number;
  stamina: number;
  danger: number;
}

/** 按时长求最短路（Dijkstra）；不可达返回 null。 */
export function shortestPath(graph: MapGraph, from: string, to: string, context: LegContext, allow?: (route: MapRoute, from: string) => boolean): PathResult | null {
  if (from === to || !graph.locations.has(from) || !graph.locations.has(to)) return null;
  const dist = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, LegEstimate>();
  const done = new Set<string>();
  for (;;) {
    let current: string | undefined;
    let best = Infinity;
    for (const [id, value] of dist) if (!done.has(id) && value < best) { best = value; current = id; }
    if (current === undefined) return null;
    if (current === to) break;
    done.add(current);
    for (const { route, to: next } of graph.adjacency.get(current) ?? []) {
      if (done.has(next) || (allow && !allow(route, current))) continue;
      const leg = estimateLeg(graph, route, current, context);
      const total = best + leg.minutes + leg.danger * 20;
      if (total < (dist.get(next) ?? Infinity)) { dist.set(next, total); previous.set(next, leg); }
    }
  }
  const legs: LegEstimate[] = [];
  let cursor = to;
  while (cursor !== from) {
    const leg = previous.get(cursor);
    if (!leg) return null;
    legs.unshift(leg);
    cursor = leg.from;
  }
  return {
    nodes: [from, ...legs.map(leg => leg.to)],
    legs,
    minutes: legs.reduce((sum, leg) => sum + leg.minutes, 0),
    stamina: legs.reduce((sum, leg) => sum + leg.stamina, 0),
    danger: Math.max(0, ...legs.map(leg => leg.danger)),
  };
}

export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} 分钟`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  if (days > 0) return `${days} 天${hours ? ` ${hours} 小时` : ''}`;
  return `${hours} 小时${rest ? ` ${rest} 分` : ''}`;
}

// ── Layout helpers (editor & AI repair) ───────────────────────────────

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * 相对邻域图：两点之间没有比它们彼此更近的第三点时连一条路。图天然连通，路网疏密自然。
 * existing 中已有的连线保留，只补缺的；maxLength 以上的长路除非为了连通否则不加。
 */
export function suggestRoutes(locations: readonly MapLocation[], existing: readonly MapRoute[], options: { landform: MapModuleSchema['landform']; maxLength?: number }): MapRoute[] {
  const present = new Set(existing.map(route => pairKey(route.from, route.to)));
  const points = locations;
  const out: MapRoute[] = [];
  const taken = new Set(existing.map(route => route.id));
  let next = existing.length + 1;
  const makeId = () => { let id: string; do { id = `route_${next++}`; } while (taken.has(id)); taken.add(id); return id; };
  const kindFor = (a: MapLocation, b: MapLocation): MapRouteKind => {
    if (options.landform === 'space') return 'warp';
    if (a.kind === 'port' && b.kind === 'port') return 'sea';
    if (['cave', 'wild', 'ruin'].includes(a.kind) || ['cave', 'wild', 'ruin'].includes(b.kind)) return 'trail';
    return 'road';
  };
  // 并查集：先把已有路线的连通块记下，再按相对邻域图补边。
  const parent = new Map(points.map(point => [point.id, point.id] as const));
  const find = (id: string): string => { let root = id; while (parent.get(root) !== root) root = parent.get(root)!; parent.set(id, root); return root; };
  const union = (a: string, b: string) => parent.set(find(a), find(b));
  for (const route of existing) if (parent.has(route.from) && parent.has(route.to)) union(route.from, route.to);
  const candidates: Array<{ a: MapLocation; b: MapLocation; d: number }> = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i]!;
      const b = points[j]!;
      const d = distanceBetween(a, b);
      let blocked = false;
      for (let k = 0; k < points.length && !blocked; k++) {
        if (k === i || k === j) continue;
        const c = points[k]!;
        if (Math.max(distanceBetween(a, c), distanceBetween(b, c)) < d) blocked = true;
      }
      if (!blocked) candidates.push({ a, b, d });
    }
  }
  candidates.sort((left, right) => left.d - right.d);
  const maxLength = options.maxLength ?? Infinity;
  for (const { a, b, d } of candidates) {
    if (present.has(pairKey(a.id, b.id))) continue;
    const joins = find(a.id) !== find(b.id);
    if (!joins && d > maxLength) continue;
    present.add(pairKey(a.id, b.id));
    union(a.id, b.id);
    out.push({ id: makeId(), from: a.id, to: b.id, kind: kindFor(a, b) });
  }
  return out;
}

/** 把挨得太近的地点推开（AI 常把几个地点写在同一坐标）。 */
export function spreadLocations(locations: MapLocation[], width: number, height: number, minDistance = 26): MapLocation[] {
  const out = locations.map(location => ({ ...location }));
  for (let pass = 0; pass < 40; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDistance) continue;
        if (d < 0.01) { const angle = (i * 2.399 + j) % (Math.PI * 2); dx = Math.cos(angle); dy = Math.sin(angle); d = 1; }
        const push = (minDistance - d) / 2 + 0.5;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
        moved = true;
      }
    }
    for (const location of out) {
      location.x = Math.round(Math.min(width - 12, Math.max(12, location.x)) * 10) / 10;
      location.y = Math.round(Math.min(height - 12, Math.max(12, location.y)) * 10) / 10;
    }
    if (!moved) break;
  }
  return out;
}

const DIRECTIONS: Array<[RegExp, number]> = [
  [/东北|northeast|north-east|\bne\b/i, -45], [/西北|northwest|north-west|\bnw\b/i, -135],
  [/东南|southeast|south-east|\bse\b/i, 45], [/西南|southwest|south-west|\bsw\b/i, 135],
  [/北|上方|north|\bn\b/i, -90], [/南|下方|south|\bs\b/i, 90], [/东|右|east|\be\b/i, 0], [/西|左|west|\bw\b/i, 180],
];

/** 在 anchor 附近按方位与远近放一个新地点，避开已有地点。 */
export function placeNear(config: Pick<MapModuleSchema, 'width' | 'height' | 'scale' | 'travel'>, existing: readonly MapLocation[], anchor: Pick<MapLocation, 'x' | 'y'> | undefined, hint: { direction?: string; distance?: string | number; seed: number }): { x: number; y: number } {
  const origin = anchor ?? { x: config.width / 2, y: config.height / 2 };
  const matched = hint.direction ? DIRECTIONS.find(([pattern]) => pattern.test(hint.direction!)) : undefined;
  let angle = matched ? (matched[1] * Math.PI) / 180 : ((hint.seed % 360) * Math.PI) / 180;
  let distance = 90;
  if (typeof hint.distance === 'number' && hint.distance > 0) {
    distance = hint.distance / (config.travel?.minutesPerUnit ?? defaultMinutesPerUnit(config.scale));
  } else if (typeof hint.distance === 'string') {
    if (/近|附近|旁|隔壁|near|close/i.test(hint.distance)) distance = 48;
    else if (/远|遥|far/i.test(hint.distance)) distance = 170;
  }
  distance = Math.min(Math.max(distance, 32), Math.max(config.width, config.height) * 0.4);
  const margin = 24;
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = Math.min(config.width - margin, Math.max(margin, origin.x + Math.cos(angle) * distance));
    const y = Math.min(config.height - margin, Math.max(margin, origin.y + Math.sin(angle) * distance));
    if (existing.every(location => distanceBetween(location, { x, y }) > 26)) return { x: Math.round(x), y: Math.round(y) };
    angle += (attempt % 2 ? -1 : 1) * 0.35 * (attempt + 1);
    if (attempt % 6 === 5) distance *= 1.2;
  }
  return { x: Math.round(Math.min(config.width - margin, Math.max(margin, origin.x + 30))), y: Math.round(Math.min(config.height - margin, Math.max(margin, origin.y + 30))) };
}
