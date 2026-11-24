/**
 * 地图界面数据：地点状态（所在 / 到过 / 知道 / 未知）、与其他模块的关联（市场、产业、可采集物资、
 * 职业会馆、人物、任务）、路线可见性与赶路预估。界面、编辑器预览与世界档案都只读这里。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { createGameplayHost } from '../../core/registry';
import { selectPlayerKnownNPCs } from '../../engine/playerKnowledge';
import { normalizeEconomyConfig } from '../economy/config';
import { normalizeResourcesConfig } from '../resources/config';
import type { BusinessModuleSchema, SurvivalModuleSchema } from '../../modules/schema';
import { regionAccent, resolveMapTheme } from './config';
import { allLocations, allRoutes, buildGraph, estimateLeg, formatMinutes, routeKnown, shortestPath } from './graph';
import {
  configWithMap, currentLocationOf, legContextFor, mapModuleConfigFor, mapStateOf, regionOf, routeRequirementBlock, type MapModuleConfig,
} from './module';
import { resolveLocation } from './resolve';
import {
  routeKindLabel,
  type MapEffect, type MapLocation, type MapModuleSchema, type MapRegion, type MapRoute, type MapRuntimeState, type MapTheme,
} from './types';

export type MapLocationStatus = 'current' | 'visited' | 'known' | 'unknown';

export interface MapLocationView {
  location: MapLocation;
  status: MapLocationStatus;
  region?: MapRegion;
  people: Array<{ id: string; name: string; role: string }>;
  quests: string[];
  markets: Array<{ id: string; name: string }>;
  holdings: Array<{ id: string; name: string; owned: boolean }>;
  gather: Array<{ id: string; name: string; bonus?: number }>;
  professions: Array<{ id: string; name: string }>;
  events: number;
  effects: string[];
}

export interface MapRouteView {
  route: MapRoute;
  known: boolean;
  /** 走过这条路（足迹）。 */
  walked: boolean;
}

export interface MapRegionView {
  region: MapRegion;
  accent: string;
  known: boolean;
}

export interface MapViewModel {
  config: MapModuleSchema;
  theme: MapTheme;
  /** atlas：没有存档（编辑器、世界档案）时全图可见。 */
  mode: 'play' | 'atlas';
  title: string;
  current?: MapLocationView;
  locations: MapLocationView[];
  routes: MapRouteView[];
  regions: MapRegionView[];
  /** 最近走过的地点（旧 → 新）。 */
  trail: string[];
  /** 整理过的存档进度（旧存档读进来还没有 state.map 时也有值）；atlas 模式为空。 */
  runtime?: MapRuntimeState;
  stats: { known: number; visited: number; total: number };
  links: Pick<MapModuleConfig, 'stats' | 'survival' | 'dice' | 'combat' | 'progression' | 'profession' | 'business'>;
}

export interface TravelLegView {
  from: string;
  to: string;
  toName: string;
  routeName: string;
  kind: MapRoute['kind'];
  minutes: number;
  stamina: number;
  danger: number;
  dc: number;
  checkLabel: string;
  currency: number;
  supplies: Array<{ name: string; amount: number }>;
  blocked?: string;
}

export interface TravelPlanView {
  ok: boolean;
  reason?: string;
  nodes: string[];
  minutes: number;
  minutesLabel: string;
  stamina: number;
  danger: number;
  legs: TravelLegView[];
}

const TARGET_LABELS: Array<[RegExp, string]> = [
  [/^resources\.upkeep\.(.+)$/, '{1}消耗'], [/^resources\.gather\.(.+)$/, '{1}采集'], [/^resources\.gatherCost\.(.+)$/, '采集{1}的体力'],
  [/^economy\.price\.buy$/, '买入价'], [/^economy\.price\.sell$/, '卖出价'], [/^economy\.income$/, '产业收入'],
  [/^dice\.check\.(.+)$/, '{1}检定'], [/^dice\.check$/, '所有检定'], [/^stat\.(.+)$/, '{1}'],
  [/^map\.travel\.time$/, '赶路时间'], [/^map\.travel\.stamina$/, '赶路体力'],
];

export function describeEffect(effect: MapEffect, names: Record<string, string> = {}): string {
  let label = effect.target;
  for (const [pattern, template] of TARGET_LABELS) {
    const match = effect.target.match(pattern);
    if (match) { label = template.replace('{1}', names[match[1] ?? ''] ?? match[1] ?? ''); break; }
  }
  const amount = effect.mode === 'flat'
    ? `${effect.value > 0 ? '+' : ''}${effect.value}`
    : `${effect.value > 0 ? '+' : ''}${Math.round(effect.value * 100)}%`;
  return `${effect.label ? `${effect.label}：` : ''}${label} ${amount}`;
}

function moduleConfigOf<T>(world: WorldDef | undefined, id: string): T | undefined {
  return world?.modules?.find(module => module.moduleId === id && module.enabled)?.moduleConfig as T | undefined;
}

function questText(quest: unknown): string {
  if (!quest || typeof quest !== 'object') return '';
  const record = quest as Record<string, unknown>;
  return ['任务名', '目标', '描述', '来源'].map(key => typeof record[key] === 'string' ? record[key] as string : '').join(' ');
}

export function buildMapViewModel(world: WorldDef | undefined, state?: GameState | null, options: { atlas?: boolean; config?: MapModuleSchema } = {}): MapViewModel | null {
  const config = options.config ? configWithMap(options.config, world) : mapModuleConfigFor(world);
  if (!config) return null;
  const map = config.map;
  const atlas = options.atlas || !state;
  const runtime: MapRuntimeState | undefined = atlas ? undefined : mapStateOf(state ? createGameplayHost(world, state).prepare(state) : undefined);
  const locations = allLocations(map, runtime);
  const known = (id: string) => atlas || Boolean(runtime?.discovered.includes(id));
  const visited = new Set(runtime?.visited ?? []);

  const economy = config.business ? normalizeEconomyConfig(moduleConfigOf<BusinessModuleSchema>(world, 'business')) : undefined;
  const marketNames = new Map((economy?.markets ?? []).map(market => [market.id, market.name] as const));
  const holdingNames = new Map((economy?.holdings ?? []).map(holding => [holding.id, holding.name] as const));
  const resources = config.survival ? normalizeResourcesConfig(moduleConfigOf<SurvivalModuleSchema>(world, 'survival')) : undefined;
  const resourceNames = new Map((resources?.resources ?? []).map(resource => [resource.id, resource.name] as const));
  const effectNames: Record<string, string> = { ...Object.fromEntries(resourceNames), ...config.statNames };

  const people = new Map<string, MapLocationView['people']>();
  const quests = new Map<string, string[]>();
  if (state && !atlas) {
    for (const [id, npc] of Object.entries(selectPlayerKnownNPCs(state))) {
      const record = npc as unknown as { 姓名?: string; 个人信息?: { 当前位置?: string }; 社会身份?: { 职业?: string }; 人物分类?: string };
      const where = resolveLocation(record.个人信息?.当前位置, locations);
      if (!where || !record.姓名) continue;
      const list = people.get(where.id) ?? [];
      list.push({ id, name: record.姓名, role: record.社会身份?.职业 ?? '' });
      people.set(where.id, list);
    }
    for (const [key, quest] of Object.entries(state.玩家?.任务系统?.活跃任务 ?? {})) {
      const text = questText(quest);
      const name = (quest as { 任务名?: string }).任务名 || key;
      for (const location of locations) {
        if (location.name.length >= 2 && text.includes(location.name)) {
          const list = quests.get(location.id) ?? [];
          if (!list.includes(name)) list.push(name);
          quests.set(location.id, list);
        }
      }
    }
  }

  const ownedHoldings = new Set(Object.keys(state?.economy?.holdings ?? {}));
  const viewOf = (location: MapLocation): MapLocationView => {
    const region = regionOf(map, location);
    const status: MapLocationStatus = runtime?.current === location.id ? 'current'
      : visited.has(location.id) ? 'visited' : known(location.id) ? 'known' : 'unknown';
    const links = location.links ?? {};
    // 经营模块里写了地点关键词的市场，在地名命中时也算此地的市场。
    const keywordMarkets = (economy?.markets ?? []).filter(market => market.locations.some(keyword => keyword && location.name.includes(keyword))).map(market => market.id);
    return {
      location, status, ...(region ? { region } : {}),
      people: people.get(location.id) ?? [],
      quests: quests.get(location.id) ?? [],
      markets: [...new Set([...(links.markets ?? []), ...keywordMarkets])].filter(id => !economy || marketNames.has(id)).map(id => ({ id, name: marketNames.get(id) ?? id })),
      holdings: (links.holdings ?? []).filter(id => !economy || holdingNames.has(id)).map(id => ({ id, name: holdingNames.get(id) ?? id, owned: ownedHoldings.has(id) })),
      gather: (links.gather ?? []).filter(item => !resources || resourceNames.has(item.id)).map(item => ({ id: item.id, name: resourceNames.get(item.id) ?? item.id, ...(item.bonus ? { bonus: item.bonus } : {}) })),
      professions: (links.professions ?? []).map(id => ({ id, name: config.professionNames[id] ?? id })),
      events: links.events?.length ?? 0,
      effects: [...(region?.effects ?? []), ...(location.effects ?? [])].map(effect => describeEffect(effect, effectNames)),
    };
  };
  const views = locations.map(viewOf);
  const walked = new Set<string>();
  const trail = (runtime?.trail ?? []).map(entry => entry.to);
  for (const entry of runtime?.trail ?? []) if (entry.from) walked.add([entry.from, entry.to].sort().join('|'));
  const routes = allRoutes(map, runtime).map(route => ({
    route,
    known: atlas || (routeKnown(route, runtime) && known(route.from) && known(route.to)),
    walked: walked.has([route.from, route.to].sort().join('|')),
  }));
  const regions = map.regions.map((region, index) => ({
    region,
    accent: regionAccent(region, index, config.theme),
    known: atlas || views.some(view => view.status !== 'unknown' && view.region?.id === region.id),
  }));
  const current = views.find(view => view.status === 'current');
  return {
    config: map,
    theme: config.theme,
    mode: atlas ? 'atlas' : 'play',
    title: map.title || world?.name || '世界舆图',
    ...(current ? { current } : {}),
    locations: views,
    routes,
    regions,
    trail,
    ...(runtime ? { runtime } : {}),
    stats: { known: views.filter(view => view.status !== 'unknown').length, visited: visited.size, total: views.length },
    links: {
      stats: config.stats, survival: config.survival, dice: config.dice, combat: config.combat,
      progression: config.progression, profession: config.profession, business: config.business,
    },
  };
}

/** 从当前位置到目标的赶路预估（与 map.travel 的结算口径一致，随机结果除外）。 */
export function planMapTravel(world: WorldDef | undefined, state: GameState, targetId: string): TravelPlanView {
  const empty: TravelPlanView = { ok: false, nodes: [], minutes: 0, minutesLabel: '', stamina: 0, danger: 0, legs: [] };
  const config = mapModuleConfigFor(world);
  if (!config) return { ...empty, reason: '这个世界没有地图' };
  const host = createGameplayHost(world, state);
  const prepared = host.prepare(state);
  const runtime = mapStateOf(prepared);
  const here = currentLocationOf(config.map, runtime);
  if (!runtime || !here) return { ...empty, reason: '还不知道你在哪' };
  if (here.id === targetId) return { ...empty, reason: '你就在这里' };
  if (!runtime.discovered.includes(targetId)) return { ...empty, reason: '还不知道这个地方在哪' };
  const graph = buildGraph(config.map, runtime, { knownOnly: true });
  const modifiers = host.modifierQuery(prepared);
  const context = legContextFor(config, (key, base) => modifiers.apply(key, base));
  const path = shortestPath(graph, here.id, targetId, context);
  if (!path) return { ...empty, reason: '没有已知的路通往这里' };
  const read = (fact: string) => host.facts.read(prepared, fact);
  const legs = path.legs.map(planned => {
    const leg = estimateLeg(graph, planned.route, planned.from, context);
    const blocked = routeRequirementBlock(prepared, config, leg.route, read);
    return {
      from: leg.from, to: leg.to, toName: graph.locations.get(leg.to)?.name ?? leg.to,
      routeName: leg.route.name || routeKindLabel(leg.route.kind, config.theme), kind: leg.route.kind,
      minutes: leg.minutes, stamina: leg.stamina, danger: leg.danger, dc: leg.dc,
      checkLabel: config.statNames[leg.checkStat] ?? leg.checkStat,
      currency: leg.currency,
      supplies: config.survival ? Object.entries(leg.resources).map(([id, amount]) => ({ name: config.resourceNames[id] ?? id, amount: Math.max(0.5, Math.round(amount * 2) / 2) })) : [],
      ...(blocked ? { blocked } : {}),
    };
  });
  const stamina = Number(read('player.stamina') ?? 0);
  const firstBlock = legs[0]?.blocked;
  const tooTired = config.stats && legs[0] && legs[0].stamina > stamina ? `体力不足（需要 ${legs[0].stamina}，现有 ${Math.floor(stamina)}）` : undefined;
  return {
    ok: !firstBlock && !tooTired,
    ...(firstBlock || tooTired ? { reason: firstBlock ?? tooTired } : {}),
    nodes: path.nodes,
    minutes: path.minutes,
    minutesLabel: formatMinutes(path.minutes),
    stamina: path.stamina,
    danger: path.danger,
    legs,
  };
}

export { formatMinutes, resolveMapTheme };
