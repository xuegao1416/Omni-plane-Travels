/**
 * 地图配置的规范化：世界定义、AI 生成结果和编辑器草稿都先过这里。
 * 坐标钳进画布、补齐缺省值、修正引用（地点所属地区、路线端点），不合法的条目直接丢弃。
 */
import type { WorldDef } from '../../data/worlds-schema';
import {
  MAP_LOCATION_KINDS, MAP_ROUTE_KINDS, MAP_SERVICES, MAP_TERRAINS,
  type MapEffect, type MapFeature, type MapFeatureKind, type MapLandform, type MapLocation, type MapLocationKind, type MapLocationLinks,
  type MapModuleSchema, type MapRegion, type MapRoute, type MapRouteKind, type MapScale, type MapTerrain, type MapTheme, type MapThemeSetting,
  type MapTravelSettings,
} from './types';

export const MAP_MODULE_ID = 'map';
export const DEFAULT_MAP_WIDTH = 1000;
export const DEFAULT_MAP_HEIGHT = 700;

type Rec = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const THEMES: readonly MapThemeSetting[] = ['auto', 'ancient', 'modern', 'scifi'];
const LANDFORMS: readonly MapLandform[] = ['continent', 'island', 'archipelago', 'coast', 'inland', 'space'];
const SCALES: readonly MapScale[] = ['world', 'region', 'city'];

function rec(value: unknown): Rec | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;
}

function text(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' ? String(value) : '';
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown, max = 24): string[] {
  return [...new Set(list(value).map(item => text(item, 80)).filter(Boolean))].slice(0, max);
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T : fallback;
}

/** 地貌的常见别称（AI 常写成中文或近义词）：「海洋」→ sea、「山地」→ mountains。 */
const TERRAIN_ALIASES: ReadonlyArray<readonly [RegExp, MapTerrain]> = [
  [/星云|nebula/i, 'nebula'], [/小行星|陨石|asteroid/i, 'asteroid'], [/虚空|深空|void/i, 'void'],
  [/海|洋|ocean|sea|bay|gulf/i, 'sea'], [/湖|泊|潭|lake|pond/i, 'lake'], [/雪|冰|snow|ice|tundra|glacier/i, 'snow'],
  [/山|峰|岭|mountain|peak/i, 'mountains'], [/丘|hill/i, 'hills'], [/林|森|forest|jungle|wood/i, 'forest'],
  [/沙|漠|desert|dune/i, 'desert'], [/沼|泽|swamp|marsh|wetland/i, 'swamp'], [/田|农|farm/i, 'farmland'],
  [/废|荒|辐射|waste|ruin/i, 'wasteland'], [/城|市|镇|都|urban|city|town/i, 'urban'], [/原|plain|grass|steppe/i, 'plains'],
];

/** 地貌取值：合法值原样，别称换成对应地貌，认不出来返回 undefined。 */
export function terrainOf(value: unknown): MapTerrain | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const key = value.trim();
  if ((MAP_TERRAINS as readonly string[]).includes(key)) return key as MapTerrain;
  return TERRAIN_ALIASES.find(([pattern]) => pattern.test(key))?.[1];
}

/** 字符串的稳定哈希（地形种子、生成 id 用）。 */
export function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 合法 id 原样保留；中文名等不合法的 id 按前缀与序号生成，并保证不重复。 */
function claimId(raw: unknown, prefix: string, taken: Set<string>): string {
  const candidate = text(raw, 48);
  let id = ID_PATTERN.test(candidate) ? candidate : '';
  if (!id || taken.has(id)) {
    let index = taken.size + 1;
    do { id = `${prefix}_${index++}`; } while (taken.has(id));
  }
  taken.add(id);
  return id;
}

function normalizeEffects(value: unknown): MapEffect[] | undefined {
  const effects = list(value).flatMap(item => {
    const raw = rec(item);
    const target = text(raw?.target, 80);
    const amount = num(raw?.value, NaN);
    if (!raw || !/^[A-Za-z][\w.-]*$/.test(target) || !Number.isFinite(amount) || amount === 0) return [];
    const effect: MapEffect = { target, mode: raw.mode === 'flat' ? 'flat' : 'mult', value: Math.round(clamp(amount, -1000, 1000) * 1000) / 1000 };
    const label = text(raw.label, 40);
    if (label) effect.label = label;
    return [effect];
  }).slice(0, 12);
  return effects.length ? effects : undefined;
}

/** 按中文地名猜地点类型（AI 漏写或旧数据没有类型时）。 */
export function guessLocationKind(name: string, description = ''): MapLocationKind {
  const sample = `${name}`;
  const rules: Array<[RegExp, MapLocationKind]> = [
    [/(王都|帝都|京城|都城|皇城|首都|首府|王城|主城|中枢|母星)/, 'capital'],
    [/(港|渡|码头|湾|船坞|空港|机场|港口)/, 'port'],
    [/(寺|庙|观|殿|教堂|神殿|祠|圣所|圣殿|佛|道院)/, 'temple'],
    [/(学院|书院|学府|学校|学园|大学|高中|校|研究所|图书馆)/, 'academy'],
    [/(市集|集市|商会|市场|商场|商业街|夜市|集|贸易站)/, 'market'],
    [/(驿|车站|站|中转|哨站)/, 'station'],
    [/(遗迹|废墟|古墓|陵|旧址|残骸)/, 'ruin'],
    [/(洞|窟|穴|矿|地宫|地下)/, 'cave'],
    [/(营|寨|营地|据点|避难所)/, 'camp'],
    [/(关|堡|要塞|城塞|基地|哨塔|军营|塔)/, 'fortress'],
    [/(家|宅|居|宿舍|公寓|府邸|庄园|小屋)/, 'home'],
    [/(村|庄|屯|聚落|社区)/, 'village'],
    [/(镇|街|坊|巷|区)/, 'town'],
    [/(城|市)/, 'city'],
    [/(山|峰|湖|泉|瀑|谷|林|岛|海|原|台|阁|楼|桥|碑)/, 'landmark'],
  ];
  for (const [pattern, kind] of rules) if (pattern.test(sample)) return kind;
  return /危险|禁地|秘境|荒野|深处/.test(description) ? 'wild' : 'town';
}

/** 路线类型缺省时按两端地点推断：港口之间走航线，其余走官道。 */
function guessRouteKind(from: MapLocation | undefined, to: MapLocation | undefined, landform: MapLandform): MapRouteKind {
  if (landform === 'space') return 'warp';
  if (from?.kind === 'port' && to?.kind === 'port') return 'sea';
  if (from?.kind === 'cave' || to?.kind === 'cave' || from?.kind === 'wild' || to?.kind === 'wild') return 'trail';
  return 'road';
}

function normalizeRegion(raw: Rec, index: number, taken: Set<string>, width: number, height: number): MapRegion | null {
  const name = text(raw.name, 40);
  if (!name) return null;
  const region: MapRegion = {
    id: claimId(raw.id, 'region', taken),
    name,
    terrain: terrainOf(raw.terrain) ?? 'plains',
    x: Math.round(clamp(num(raw.x, width * (0.2 + 0.6 * ((index * 0.37) % 1))), 0, width)),
    y: Math.round(clamp(num(raw.y, height * (0.2 + 0.6 * ((index * 0.61) % 1))), 0, height)),
    radius: Math.round(clamp(num(raw.radius, Math.min(width, height) * 0.26), 30, Math.max(width, height) * 0.7)),
  };
  const description = text(raw.description, 600);
  if (description) region.description = description;
  const danger = num(raw.danger, 0);
  if (danger > 0) region.danger = Math.round(clamp(danger, 0, 5));
  const faction = text(raw.faction, 40);
  if (faction) region.faction = faction;
  const color = text(raw.color, 7);
  if (COLOR_PATTERN.test(color)) region.color = color.toLowerCase();
  const minTier = num(raw.minTier, -1);
  if (minTier >= 0) region.minTier = Math.trunc(minTier);
  const effects = normalizeEffects(raw.effects);
  if (effects) region.effects = effects;
  const encounters = strings(raw.encounters, 6);
  if (encounters.length) region.encounters = encounters;
  return region;
}

function normalizeLinks(value: unknown): MapLocationLinks | undefined {
  const raw = rec(value);
  if (!raw) return undefined;
  const links: MapLocationLinks = {};
  const markets = strings(raw.markets, 8);
  if (markets.length) links.markets = markets;
  const holdings = strings(raw.holdings, 8);
  if (holdings.length) links.holdings = holdings;
  const gather = list(raw.gather).flatMap(item => {
    const entry = typeof item === 'string' ? { id: item } : rec(item);
    const id = text(entry?.id, 48);
    if (!id) return [];
    const bonus = num((entry as Rec | undefined)?.bonus, 0);
    return [bonus ? { id, bonus: Math.round(clamp(bonus, -0.9, 5) * 100) / 100 } : { id }];
  }).slice(0, 8);
  if (gather.length) links.gather = gather;
  const events = list(raw.events).flatMap(item => {
    const entry = typeof item === 'string' ? { eventId: item } : rec(item);
    const eventId = text(entry?.eventId ?? (entry as Rec | undefined)?.id, 80);
    if (!eventId) return [];
    const packId = text((entry as Rec).packId, 80);
    return [{ eventId, ...(packId ? { packId } : {}), ...((entry as Rec).repeat === true ? { repeat: true } : {}) }];
  }).slice(0, 6);
  if (events.length) links.events = events;
  const professions = strings(raw.professions, 8);
  if (professions.length) links.professions = professions;
  const lore = text(raw.lore, 80);
  if (lore) links.lore = lore;
  return Object.keys(links).length ? links : undefined;
}

function normalizeLocation(raw: Rec, taken: Set<string>, width: number, height: number, regions: MapRegion[]): MapLocation | null {
  const name = text(raw.name, 40);
  if (!name) return null;
  const description = text(raw.description, 800);
  const location: MapLocation = {
    id: claimId(raw.id, 'loc', taken),
    name,
    kind: oneOf(raw.kind, MAP_LOCATION_KINDS, guessLocationKind(name, description)),
    x: Math.round(clamp(num(raw.x, width / 2), 0, width) * 10) / 10,
    y: Math.round(clamp(num(raw.y, height / 2), 0, height) * 10) / 10,
  };
  const regionId = text(raw.regionId ?? raw.region, 48);
  const region = regions.find(item => item.id === regionId || item.name === regionId) ?? nearestRegion(regions, location.x, location.y);
  if (region) location.regionId = region.id;
  if (description) location.description = description;
  const aliases = strings(raw.aliases, 8).filter(alias => alias !== name);
  if (aliases.length) location.aliases = aliases;
  if (raw.known === true) location.known = true;
  const danger = num(raw.danger, 0);
  if (danger > 0) location.danger = Math.round(clamp(danger, 0, 5));
  const minTier = num(raw.minTier, -1);
  if (minTier >= 0) location.minTier = Math.trunc(minTier);
  const services = strings(raw.services, 5).filter((item): item is NonNullable<MapLocation['services']>[number] => (MAP_SERVICES as readonly string[]).includes(item));
  if (services.length) location.services = services;
  const restPrice = num(raw.restPrice, 0);
  if (restPrice > 0) location.restPrice = Math.round(restPrice * 100) / 100;
  const effects = normalizeEffects(raw.effects);
  if (effects) location.effects = effects;
  const links = normalizeLinks(raw.links);
  if (links) location.links = links;
  if (raw.origin === 'story') location.origin = 'story';
  return location;
}

const FEATURE_KINDS: readonly MapFeatureKind[] = ['water', 'land', 'area', 'river', 'road', 'rail', 'border', 'building', 'label'];
const POLYGON_FEATURES = new Set<MapFeatureKind>(['water', 'land', 'area', 'building']);
const MAX_FEATURES = 1200;
const MAX_FEATURE_POINTS = 400;

/** 折线 / 多边形顶点：钳进画布、丢掉坏点，保留一位小数。 */
function points(value: unknown, width: number, height: number, max: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const item of list(value)) {
    const pair = Array.isArray(item) ? item : rec(item) ? [(item as Rec).x, (item as Rec).y] : null;
    if (!pair) continue;
    const x = num(pair[0], NaN);
    const y = num(pair[1], NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push([Math.round(clamp(x, -width * 0.1, width * 1.1) * 10) / 10, Math.round(clamp(y, -height * 0.1, height * 1.1) * 10) / 10]);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeFeature(raw: Rec, width: number, height: number): MapFeature | null {
  const kind = oneOf(raw.kind, FEATURE_KINDS, 'label');
  if (raw.kind !== kind) return null;
  const pts = points(raw.points, width, height, MAX_FEATURE_POINTS);
  if (pts.length < (kind === 'label' ? 1 : POLYGON_FEATURES.has(kind) ? 3 : 2)) return null;
  const feature: MapFeature = { kind, points: pts };
  const name = text(raw.name, 40);
  if (name) feature.name = name;
  else if (kind === 'label') return null;
  const terrain = terrainOf(raw.terrain);
  if (terrain) feature.terrain = terrain;
  const level = text(raw.level, 24);
  if (level) feature.level = level;
  const lineWidth = num(raw.width, 0);
  if (lineWidth > 0) feature.width = Math.round(clamp(lineWidth, 0.2, 200) * 10) / 10;
  const color = text(raw.color, 7);
  if (COLOR_PATTERN.test(color)) feature.color = color.toLowerCase();
  const tall = num(raw.height, 0);
  if (tall > 0) feature.height = Math.round(clamp(tall, 0.1, 40) * 100) / 100;
  return feature;
}

function normalizeRoute(raw: Rec, taken: Set<string>, byKey: Map<string, MapLocation>, landform: MapLandform, width = DEFAULT_MAP_WIDTH, height = DEFAULT_MAP_HEIGHT): MapRoute | null {
  const from = byKey.get(text(raw.from, 48));
  const to = byKey.get(text(raw.to, 48));
  if (!from || !to || from.id === to.id) return null;
  const route: MapRoute = {
    id: claimId(raw.id, 'route', taken),
    from: from.id,
    to: to.id,
    kind: oneOf(raw.kind, MAP_ROUTE_KINDS, guessRouteKind(from, to, landform)),
  };
  const name = text(raw.name, 40);
  if (name) route.name = name;
  const minutes = num(raw.minutes, 0);
  if (minutes > 0) route.minutes = Math.round(clamp(minutes, 1, 60 * 24 * 60));
  const danger = num(raw.danger, 0);
  if (danger > 0) route.danger = Math.round(clamp(danger, 0, 5));
  const check = rec(raw.check);
  if (check) {
    const stat = text(check.stat, 40);
    const dc = num(check.dc, 0);
    if (stat || dc > 0) route.check = { ...(stat ? { stat } : {}), ...(dc > 0 ? { dc: Math.round(clamp(dc, 2, 40)) } : {}) };
  }
  const cost = rec(raw.cost);
  if (cost) {
    const stamina = num(cost.stamina, 0);
    const currency = num(cost.currency, 0);
    const resources = Object.fromEntries(Object.entries(rec(cost.resources) ?? {})
      .map(([id, amount]) => [text(id, 48), Math.round(clamp(num(amount, 0), 0, 999) * 100) / 100] as const)
      .filter(([id, amount]) => id && amount > 0));
    const normalized: NonNullable<MapRoute['cost']> = {};
    if (stamina > 0) normalized.stamina = Math.round(clamp(stamina, 0, 999));
    if (currency > 0) normalized.currency = Math.round(currency * 100) / 100;
    if (Object.keys(resources).length) normalized.resources = resources;
    if (Object.keys(normalized).length) route.cost = normalized;
  }
  const requires = rec(raw.requires);
  if (requires) {
    const professions = strings(requires.professions, 8);
    const item = text(requires.item, 40);
    const minTier = num(requires.minTier, -1);
    const normalized: NonNullable<MapRoute['requires']> = {};
    if (professions.length) normalized.professions = professions;
    if (item) normalized.item = item;
    if (minTier >= 0) normalized.minTier = Math.trunc(minTier);
    if (Object.keys(normalized).length) route.requires = normalized;
  }
  if (raw.hidden === true) route.hidden = true;
  if (raw.oneWay === true) route.oneWay = true;
  const path = points(raw.path, width, height, 120);
  if (path.length) route.path = path;
  return route;
}

function normalizeTravel(value: unknown): MapTravelSettings | undefined {
  const raw = rec(value);
  if (!raw) return undefined;
  const travel: MapTravelSettings = {};
  const minutesPerUnit = num(raw.minutesPerUnit, 0);
  if (minutesPerUnit > 0) travel.minutesPerUnit = Math.round(clamp(minutesPerUnit, 0.01, 60) * 1000) / 1000;
  const staminaPerHour = num(raw.staminaPerHour, -1);
  if (staminaPerHour >= 0) travel.staminaPerHour = Math.round(clamp(staminaPerHour, 0, 100) * 10) / 10;
  const supplies = Object.fromEntries(Object.entries(rec(raw.supplies) ?? {})
    .map(([id, amount]) => [text(id, 48), Math.round(clamp(num(amount, 0), 0, 99) * 100) / 100] as const)
    .filter(([id, amount]) => id && amount > 0));
  if (Object.keys(supplies).length) travel.supplies = supplies;
  if (raw.ambush === false) travel.ambush = false;
  return Object.keys(travel).length ? travel : undefined;
}

export function nearestRegion(regions: readonly MapRegion[], x: number, y: number): MapRegion | undefined {
  let best: MapRegion | undefined;
  let bestScore = Infinity;
  for (const region of regions) {
    if (region.terrain === 'sea') continue;
    const score = Math.hypot(region.x - x, region.y - y) / Math.max(1, region.radius);
    if (score < bestScore) { best = region; bestScore = score; }
  }
  return best ?? regions[0];
}

/** 把任意输入（世界定义、AI 输出、编辑器草稿）整理成可用的地图。 */
export function normalizeMapConfig(input: unknown): MapModuleSchema {
  const raw = rec(input) ?? {};
  const width = Math.round(clamp(num(raw.width, DEFAULT_MAP_WIDTH), 200, 4000));
  const height = Math.round(clamp(num(raw.height, DEFAULT_MAP_HEIGHT), 200, 4000));
  const landform = oneOf(raw.landform, LANDFORMS, 'continent');
  const regionIds = new Set<string>();
  const regions = list(raw.regions).flatMap((item, index) => {
    const region = rec(item) ? normalizeRegion(item as Rec, index, regionIds, width, height) : null;
    return region ? [region] : [];
  }).slice(0, 40);
  const locationIds = new Set<string>();
  const locations = list(raw.locations).flatMap(item => {
    const location = rec(item) ? normalizeLocation(item as Rec, locationIds, width, height, regions) : null;
    return location ? [location] : [];
  }).slice(0, 160);
  // 路线端点既接受 id 也接受地名（AI 常写地名）。
  const byKey = new Map<string, MapLocation>();
  for (const location of locations) {
    byKey.set(location.id, location);
    if (!byKey.has(location.name)) byKey.set(location.name, location);
  }
  const routeIds = new Set<string>();
  const pairs = new Set<string>();
  const routes = list(raw.routes).flatMap(item => {
    const route = rec(item) ? normalizeRoute(item as Rec, routeIds, byKey, landform, width, height) : null;
    if (!route) return [];
    const pair = [route.from, route.to].sort().join('|') + `|${route.kind}`;
    if (pairs.has(pair)) return [];
    pairs.add(pair);
    return [route];
  }).slice(0, 400);
  const start = text(raw.startLocationId, 48);
  const startLocation = byKey.get(start)
    ?? locations.find(item => item.kind === 'capital')
    ?? locations.find(item => item.kind === 'city' || item.kind === 'town')
    ?? locations[0];
  const config: MapModuleSchema = {
    version: 1,
    theme: oneOf(raw.theme, THEMES, 'auto'),
    landform,
    scale: oneOf(raw.scale, SCALES, 'world'),
    seed: Math.trunc(Math.abs(num(raw.seed, hashString(JSON.stringify(locations.map(item => item.name)))))) % 2147483647,
    width,
    height,
    fog: raw.fog !== false,
    regions,
    locations,
    routes,
  };
  const title = text(raw.title, 40);
  if (title) config.title = title;
  if (startLocation) config.startLocationId = startLocation.id;
  const travel = normalizeTravel(raw.travel);
  if (travel) config.travel = travel;
  const features = list(raw.features).flatMap(item => {
    const feature = rec(item) ? normalizeFeature(item as Rec, width, height) : null;
    return feature ? [feature] : [];
  }).slice(0, MAX_FEATURES);
  if (features.length) config.features = features;
  const metersPerUnit = num(raw.metersPerUnit, 0);
  if (metersPerUnit > 0) config.metersPerUnit = Math.round(clamp(metersPerUnit, 0.1, 100000) * 100) / 100;
  return config;
}

/** 1 个地图单位代表的米数。 */
export function metersPerUnitOf(config: Pick<MapModuleSchema, 'scale' | 'metersPerUnit'>): number {
  return config.metersPerUnit ?? (config.scale === 'city' ? 10 : config.scale === 'region' ? 50 : 200);
}

/** 新开地图模块时的空白地图（种子随机，避免每张新图都长得一样）。 */
export function createDefaultMapModule(): MapModuleSchema {
  return {
    version: 1, theme: 'auto', landform: 'continent', scale: 'world', seed: Math.floor(Math.random() * 2147483646) + 1,
    width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT, fog: true, regions: [], locations: [], routes: [],
  };
}

const configCache = new WeakMap<object, MapModuleSchema>();

/** 世界启用地图模块且至少有一个地点时返回规范化后的地图。 */
export function mapConfigOf(world: Pick<WorldDef, 'modules'> | undefined | null): MapModuleSchema | undefined {
  const module = world?.modules?.find(item => item.moduleId === MAP_MODULE_ID && item.enabled);
  const raw = module?.moduleConfig;
  if (!raw) return undefined;
  let config = configCache.get(raw);
  if (!config) {
    config = normalizeMapConfig(raw);
    configCache.set(raw, config);
  }
  return config.locations.length > 0 ? config : undefined;
}

export function isMapModuleEnabled(world: Pick<WorldDef, 'modules'> | undefined | null): boolean {
  return Boolean(world?.modules?.some(item => item.moduleId === MAP_MODULE_ID && item.enabled));
}

const SCIFI_WORDS = /(科幻|星际|宇宙|太空|星舰|飞船|赛博|未来|机甲|外星|银河|星域|殖民星|空间站|仿生|人工智能|赛博朋克|量子|星球)/;
const MODERN_WORDS = /(都市|现代|当代|校园|学园|城市|职场|公司|末日|废土|丧尸|年代|上世纪|九十年代|80年代|90年代|边境贸易|商战|警察|侦探|直播|网红|日常|高中|大学)/;

/** 「自动」画风：按世界的标签、名称与简介选择；没有线索时用古卷。 */
export function resolveMapTheme(setting: MapThemeSetting | undefined, world?: Pick<WorldDef, 'name' | 'description' | 'tags'> | null): MapTheme {
  if (setting && setting !== 'auto') return setting;
  const sample = `${(world?.tags ?? []).join(' ')} ${world?.name ?? ''} ${world?.description ?? ''}`;
  if (SCIFI_WORDS.test(sample)) return 'scifi';
  if (MODERN_WORDS.test(sample)) return 'modern';
  return 'ancient';
}

/** 地图尺度对应的默认步行速度（分钟 / 地图单位）。 */
export function defaultMinutesPerUnit(scale: MapScale): number {
  return scale === 'city' ? 0.12 : scale === 'region' ? 0.6 : 2.4;
}

export function terrainIsWater(terrain: MapTerrain): boolean {
  return terrain === 'sea' || terrain === 'lake';
}

export function isSpace(config: Pick<MapModuleSchema, 'landform'>): boolean {
  return config.landform === 'space';
}

/** 主题默认色板里的地区强调色（地区没有指定颜色时按序号取）。 */
export const REGION_ACCENTS: Record<MapTheme, readonly string[]> = {
  ancient: ['#8c2f1c', '#2f5d50', '#6b3f8a', '#8a6a1f', '#29507a', '#7a2f4f', '#4f6b26', '#6b4a2f'],
  modern: ['#3a7bd5', '#2f9e6f', '#d9822b', '#8e5bd8', '#d64f6a', '#2aa3b8', '#7a8a3a', '#b8742a'],
  scifi: ['#3ee8ff', '#ff4fd8', '#8aff6b', '#ffb84f', '#7a7dff', '#ff6b6b', '#4fffc4', '#e6ff4f'],
};

export function regionAccent(region: Pick<MapRegion, 'color'>, index: number, theme: MapTheme): string {
  return region.color ?? REGION_ACCENTS[theme][index % REGION_ACCENTS[theme].length]!;
}
