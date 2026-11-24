/**
 * 地图模块（map）：当前位置、发现与赶路。
 *
 * - 玩家在地图上点「前往」：按已知路网求最短路，逐段结算——推进世界时钟（生存资源按周期消耗）、
 *   扣体力（数值属性）、扣路费与补给（经营 / 生存资源）、危险路段过检定（骰子）、可能遇伏（战斗）、
 *   检查路线要求（职业、成长阶段、通行物品）；抵达时揭开周边地点、弹出到达事件卡。
 * - 正文或 AI 改了「当前位置」、或调用 map.travel / map.discover：只移动标记与扩展地图，不重复扣时间。
 * - 身处某地时，地区与地点的修正（采集加成、物资消耗、价格、检定）经统一加成系统作用于其他模块；
 *   经营模块按 `map.here.markets` 放行此地挂接的市场。
 * - 发现新地点、初到某地发出领域事件，成长模块据此给经验，事件卡可以监听。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { FactSpec } from '../../core/facts';
import type { DomainEventSpec, GameplayModule, ModuleHookContext } from '../../core/host';
import { currentTurn } from '../../core/host';
import type { ModifierRecord } from '../../core/modifiers';
import type { JsonRecord } from '../../core/ops';
import { advanceStateClock } from '../../core/clock';
import type { ProgressionModuleSchema, StatModuleSchema } from '../../modules/schema';
import { resolveProfessionBinding } from '../../data/professions';
import { isProfessionModuleEnabled } from '../../gameplay/profession/featureGate';
import { MAP_MODULE_ID, guessLocationKind, hashString, mapConfigOf, nearestRegion, resolveMapTheme } from './config';
import { allLocations, buildGraph, estimateLeg, formatMinutes, placeNear, shortestPath, type LegContext, type LegEstimate, type MapGraph } from './graph';
import { mentionedLocations, resolveLocation } from './resolve';
import {
  LOCATION_KIND_LABELS, MAP_LOCATION_KINDS, MAP_ROUTE_KINDS, TERRAIN_LABELS, routeKindLabel,
  type MapLocation, type MapModuleSchema, type MapRegion, type MapRoute, type MapRuntimeState, type MapTerrain, type MapTheme,
} from './types';

export interface MapModuleConfig {
  map: MapModuleSchema;
  world?: WorldDef;
  theme: MapTheme;
  /** 各联动模块是否启用。 */
  stats: boolean;
  survival: boolean;
  dice: boolean;
  combat: boolean;
  progression: boolean;
  profession: boolean;
  business: boolean;
  staminaMax: number;
  hpMax: number;
  staminaName: string;
  hpName: string;
  statNames: Record<string, string>;
  professionNames: Record<string, string>;
  resourceNames: Record<string, string>;
  tierNames: string[];
}

type Ctx = ModuleHookContext<MapModuleConfig>;

const MAX_TRAIL = 30;
const MAX_EXTRA = 48;

// ── Runtime state ─────────────────────────────────────────────────────

export function emptyMapState(): MapRuntimeState {
  return { version: 1, discovered: [], visited: [], routes: [], extraLocations: [], extraRoutes: [], trail: [], fired: [] };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))] : [];
}

/** 读档时整理 state.map（缺字段补空、去重）。 */
export function normalizeMapState(raw: unknown): MapRuntimeState | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Partial<MapRuntimeState>;
  return {
    version: 1,
    ...(typeof value.current === 'string' && value.current ? { current: value.current } : {}),
    discovered: strings(value.discovered),
    visited: strings(value.visited),
    routes: strings(value.routes),
    extraLocations: Array.isArray(value.extraLocations) ? value.extraLocations.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string').slice(-MAX_EXTRA) : [],
    extraRoutes: Array.isArray(value.extraRoutes) ? value.extraRoutes.filter(item => item && typeof item.id === 'string' && typeof item.from === 'string' && typeof item.to === 'string').slice(-MAX_EXTRA * 2) : [],
    trail: Array.isArray(value.trail) ? value.trail.filter(item => item && typeof item.to === 'string').slice(-MAX_TRAIL) : [],
    fired: strings(value.fired),
  };
}

export function mapStateOf(state: GameState | undefined): MapRuntimeState | undefined {
  return normalizeMapState((state as { map?: unknown } | undefined)?.map);
}

function runtimeOf(state: GameState): MapRuntimeState {
  const holder = state as GameState & { map?: MapRuntimeState };
  if (!holder.map || typeof holder.map !== 'object') holder.map = emptyMapState();
  return holder.map;
}

// ── Lookups ───────────────────────────────────────────────────────────

export function regionOf(config: MapModuleSchema, location: MapLocation | undefined): MapRegion | undefined {
  if (!location) return undefined;
  return config.regions.find(region => region.id === location.regionId) ?? nearestRegion(config.regions, location.x, location.y);
}

/** 写进「当前位置」的地名：地区 · 地点（地名里已含地区名时只写地点）。 */
export function placeLabel(config: MapModuleSchema, location: MapLocation): string {
  const region = regionOf(config, location);
  return region && !location.name.includes(region.name) && region.terrain !== 'sea' ? `${region.name} · ${location.name}` : location.name;
}

export function currentLocationOf(config: MapModuleSchema, runtime: MapRuntimeState | undefined): MapLocation | undefined {
  if (!runtime?.current) return undefined;
  return allLocations(config, runtime).find(location => location.id === runtime.current);
}

function routeLabel(route: MapRoute, theme?: MapTheme): string {
  return route.name || routeKindLabel(route.kind, theme);
}

export function isKnownAtStart(location: MapLocation, config: MapModuleSchema): boolean {
  return config.fog === false || location.known === true || location.kind === 'capital';
}

/** 地点周边（一段路可达）的地点 id。 */
function neighborIds(graph: MapGraph, id: string, runtime: MapRuntimeState): string[] {
  return (graph.adjacency.get(id) ?? [])
    .filter(edge => !edge.route.hidden || runtime.routes.includes(edge.route.id))
    .map(edge => edge.to);
}

export function legContextFor(config: MapModuleConfig, modify?: (target: string, base: number) => number): LegContext {
  return { staminaScale: config.stats ? config.staminaMax / 100 : 0, ...(modify ? { modify } : {}) };
}

function tierLabel(config: MapModuleConfig, tier: number): string {
  return config.tierNames[tier] ?? `第 ${tier + 1} 阶`;
}

/** 路线要求（职业、成长阶段、通行物品）；满足返回 null。 */
export function routeRequirementBlock(state: GameState, config: MapModuleConfig, route: MapRoute, readFact: (path: string) => unknown): string | null {
  const requires = route.requires;
  if (!requires) return null;
  if (requires.minTier !== undefined && config.progression) {
    const tier = Math.trunc(Number(readFact('player.level') ?? 0));
    if (tier < requires.minTier) return `「${routeLabel(route, config.theme)}」要到「${tierLabel(config, requires.minTier)}」才走得了`;
  }
  if (requires.professions?.length && config.profession) {
    const profession = state.玩家?.能力系统?.职业状态?.职业ID ?? '';
    if (!requires.professions.includes(profession)) {
      return `只有${requires.professions.map(id => config.professionNames[id] ?? id).join('、')}才认得「${routeLabel(route, config.theme)}」`;
    }
  }
  if (requires.item) {
    const count = Number(readFact(`player.items.${requires.item}`) ?? 0);
    if (!(count > 0)) return `需要「${requires.item}」才能通过「${routeLabel(route, config.theme)}」`;
  }
  return null;
}

// ── Config ────────────────────────────────────────────────────────────

function resolveModuleConfig(world: WorldDef | undefined): MapModuleConfig | undefined {
  const map = mapConfigOf(world);
  return map ? configWithMap(map, world) : undefined;
}

/** 给定地图（编辑器草稿也行）与世界，算出地图模块的联动配置。 */
export function configWithMap(map: MapModuleSchema, world: Pick<WorldDef, 'modules' | 'name' | 'description' | 'tags'> | undefined): MapModuleConfig {
  const enabled = (id: string) => Boolean(world?.modules?.some(module => module.moduleId === id && module.enabled));
  const stat = world?.modules?.find(module => module.moduleId === 'stat' && module.enabled)?.moduleConfig as StatModuleSchema | undefined;
  const progression = world?.modules?.find(module => module.moduleId === 'progression' && module.enabled)?.moduleConfig as ProgressionModuleSchema | undefined;
  const professionEnabled = isProfessionModuleEnabled(world);
  let professionNames: Record<string, string> = {};
  if (professionEnabled) {
    try {
      const binding = resolveProfessionBinding(world?.modules?.find(module => module.moduleId === 'profession')?.moduleConfig);
      professionNames = Object.fromEntries(binding.professions.map(item => [item.id, item.name] as const));
    } catch { professionNames = {}; }
  }
  const statNames: Record<string, string> = {};
  for (const dim of ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const) if (stat?.[dim]?.name) statNames[dim] = stat[dim]!.name;
  const survival = world?.modules?.find(module => module.moduleId === 'survival' && module.enabled)?.moduleConfig as { resources?: Array<{ id?: unknown; name?: unknown }> } | undefined;
  const resourceNames = Object.fromEntries((Array.isArray(survival?.resources) ? survival.resources : [])
    .filter(item => typeof item?.id === 'string' && typeof item?.name === 'string').map(item => [item.id as string, item.name as string] as const));
  return {
    map,
    world: world as WorldDef | undefined,
    theme: resolveMapTheme(map.theme, world),
    stats: Boolean(stat),
    survival: enabled('survival'),
    dice: enabled('dice') && Boolean(stat),
    combat: enabled('combat'),
    progression: Boolean(progression),
    profession: professionEnabled,
    business: enabled('business'),
    staminaMax: Math.max(1, Number(stat?.attrB?.max) || 100),
    hpMax: Math.max(1, Number(stat?.attrA?.max) || 100),
    staminaName: stat?.attrB?.name || '体力',
    hpName: stat?.attrA?.name || '生命',
    statNames,
    professionNames,
    resourceNames,
    tierNames: progression?.mode === 'level'
      ? Array.from({ length: Math.min(200, Math.max(1, (progression.levelData?.maxLevel ?? 1) + 1)) }, (_, index) => `Lv.${index}`)
      : (progression?.tiers ?? []).map(tier => tier.name),
  };
}

// ── Discovery & arrival ───────────────────────────────────────────────

function discover(state: GameState, context: Ctx, ids: readonly string[], source: string): string[] {
  const runtime = runtimeOf(state);
  const locations = allLocations(context.config.map, runtime);
  const added: string[] = [];
  for (const id of ids) {
    if (runtime.discovered.includes(id)) continue;
    const location = locations.find(item => item.id === id);
    if (!location) continue;
    runtime.discovered = [...runtime.discovered, id];
    added.push(id);
    context.emit('map.discovered', { id, name: location.name, kind: location.kind, source });
  }
  return added;
}

function arrive(state: GameState, context: Ctx, location: MapLocation, info: { via: 'travel' | 'story'; minutes: number; from?: string }): void {
  const config = context.config.map;
  const runtime = runtimeOf(state);
  const graph = buildGraph(config, runtime);
  const previousRegion = regionOf(config, currentLocationOf(config, runtime));
  const firstVisit = !runtime.visited.includes(location.id);
  runtime.current = location.id;
  if (firstVisit) runtime.visited = [...runtime.visited, location.id];
  discover(state, context, [location.id], info.via === 'travel' ? 'arrival' : 'story');
  const revealed = discover(state, context, neighborIds(graph, location.id, runtime), 'nearby');
  runtime.trail = [...runtime.trail, { ...(info.from ? { from: info.from } : {}), to: location.id, turn: context.turn, minutes: info.minutes, via: info.via }].slice(-MAX_TRAIL);
  const region = regionOf(config, location);
  if (region && region.id !== previousRegion?.id) {
    context.emit('map.regionEntered', { id: region.id, name: region.name, terrain: region.terrain, danger: region.danger ?? 0 });
  }
  context.emit('map.arrived', {
    id: location.id, name: location.name, kind: location.kind, regionId: region?.id ?? '', regionName: region?.name ?? '',
    firstVisit, via: info.via, minutes: info.minutes,
  });
  for (const event of location.links?.events ?? []) {
    const key = `${location.id}/${event.eventId}`;
    if (!event.repeat && runtime.fired.includes(key)) continue;
    if (!event.repeat) runtime.fired = [...runtime.fired, key];
    context.card(event.eventId, event.packId, `抵达${location.name}`);
  }
  if (revealed.length && info.via === 'travel') {
    const names = revealed.map(id => graph.locations.get(id)?.name).filter(Boolean).slice(0, 4);
    if (names.length) context.note(`从${location.name}望去，能认出去往${names.join('、')}的路。`, 'hint');
  }
}

const DEFAULT_ENCOUNTERS: Record<MapTheme, Partial<Record<MapTerrain, string[]>> & { default: string[] }> = {
  ancient: { forest: ['林中山匪', '饿狼'], mountains: ['拦路的山贼', '岩羊般敏捷的刺客'], desert: ['沙匪'], swamp: ['沼泽毒蛇'], sea: ['海寇'], default: ['拦路的匪徒', '流寇'] },
  modern: { urban: ['街头混混', '抢劫犯'], wasteland: ['拾荒帮', '变异野狗'], forest: ['偷猎者'], default: ['可疑的跟踪者', '地痞'] },
  scifi: { void: ['海盗巡逻艇', '失控的无人机群'], nebula: ['星云掠夺者'], asteroid: ['矿区劫掠者'], urban: ['义体打手'], default: ['失控的安保机兵', '星际海盗'] },
};

function encounterIdentity(context: Ctx, region: MapRegion | undefined): string {
  const pool = region?.encounters?.length ? region.encounters
    : DEFAULT_ENCOUNTERS[context.config.theme][region?.terrain ?? 'plains'] ?? DEFAULT_ENCOUNTERS[context.config.theme].default;
  return pool[context.rng.int(0, pool.length - 1)] ?? '拦路的敌人';
}

// ── Player travel ─────────────────────────────────────────────────────

interface LegResult { ok: boolean; stop?: boolean; reason?: string; text?: string }

function checkStatId(config: MapModuleConfig, stat: string): { attributeId?: string; attribute?: string; label: string } {
  if (/^dim[1-6]$/.test(stat)) return { attributeId: stat, label: config.statNames[stat] ?? stat };
  return { attribute: stat, label: stat };
}

/** 一段路：先查要求与消耗，全部满足再一起扣，最后过检定、可能遇伏。 */
function travelLeg(state: GameState, context: Ctx, graph: MapGraph, leg: LegEstimate, index: number): LegResult {
  const config = context.config;
  const read = (path: string) => context.facts.read(state, path);
  const target = graph.locations.get(leg.to)!;
  const blocked = routeRequirementBlock(state, config, leg.route, read);
  if (blocked) return { ok: false, reason: blocked };
  if (leg.stamina > 0) {
    const stamina = Number(read('player.stamina') ?? 0);
    if (stamina < leg.stamina) return { ok: false, reason: `${config.staminaName}不足：去${target.name}要 ${leg.stamina}，现在只有 ${Math.floor(stamina)}` };
  }
  if (leg.currency > 0) {
    const wallet = Number(read('player.currency') ?? 0);
    if (wallet < leg.currency) return { ok: false, reason: `盘缠不够：「${routeLabel(leg.route, config.theme)}」要 ${leg.currency}，钱袋里只有 ${wallet}` };
  }
  const supplies = config.survival ? Object.entries(leg.resources).map(([id, amount]) => [id, Math.max(0.5, Math.round(amount * 2) / 2)] as const) : [];
  for (const [id, amount] of supplies) {
    const stock = Number(read(`player.resources.${id}`));
    if (Number.isFinite(stock) && stock < amount) return { ok: false, reason: `补给不足：去${target.name}要带 ${amount} 份${config.resourceNames[id] ?? id}` };
  }
  const label = `${graph.locations.get(leg.from)?.name ?? ''} → ${target.name}`;
  if (leg.stamina > 0) context.apply([{ op: 'add', path: 'player.stamina', value: -leg.stamina, label: `赶路 ${label}` }], 'system');
  if (leg.currency > 0) context.apply([{ op: 'add', path: 'player.currency', value: -leg.currency, strict: true, label: `路费 ${label}` }], 'system');
  for (const [id, amount] of supplies) context.apply([{ op: 'command', command: 'resources.consume', args: { id, amount, reason: `赶路 ${label}` } }], 'system');
  let minutes = advanceStateClock(state, config.world, leg.minutes, `赶路 ${label}`);
  context.emit('map.departed', { from: leg.from, to: leg.to, route: leg.route.id, kind: leg.route.kind, minutes: leg.minutes });
  const parts: string[] = [];
  let stop = false;
  if (leg.danger >= 2) {
    const stat = checkStatId(config, leg.checkStat);
    let success = true;
    let rolled = false;
    if (config.dice) {
      const requestId = `map:${context.turn}:${context.minute}:${leg.route.id}:${index}`;
      rolled = context.apply([{ op: 'command', command: 'dice.roll', args: { ...stat, dc: leg.dc, requestId } }], 'system');
      const roll = state.dice?.lastRoll;
      if (rolled && roll?.requestId === requestId) success = roll.success;
      else rolled = false;
    }
    if (!rolled) success = context.rng.chance(Math.max(0.35, 0.92 - leg.danger * 0.1));
    context.emit('map.hazard', { route: leg.route.id, success, dc: leg.dc, stat: leg.checkStat, danger: leg.danger });
    if (!success) {
      const delay = Math.round(leg.minutes * 0.35 / 5) * 5;
      if (delay > 0) minutes += advanceStateClock(state, config.world, delay, `路上耽搁 ${label}`);
      let hurt = 0;
      if (config.stats) {
        hurt = Math.max(1, Math.round(leg.danger * 3 * config.hpMax / 100));
        context.apply([{ op: 'add', path: 'player.hp', value: -hurt, label: `路上受伤 ${label}` }], 'system');
      }
      parts.push(`途经「${routeLabel(leg.route, config.theme)}」时出了岔子${rolled ? `（${stat.label}检定未过）` : ''}，多耽搁了${formatMinutes(delay)}${hurt ? `，${config.hpName} -${hurt}` : ''}`);
    }
    const ambushChance = leg.danger * 0.06 + (success ? 0 : 0.15);
    if (config.combat && config.map.travel?.ambush !== false && context.rng.chance(ambushChance)) {
      const region = regionOf(config.map, target);
      const identity = encounterIdentity(context, region);
      const enemies = Array.from({ length: leg.danger >= 4 ? 2 : 1 }, (_, n) => ({ id: `map_ambush_${n + 1}`, identity, temporary: true }));
      context.combat({
        schemaVersion: 2,
        source: 'event-workflow',
        proposal: {
          schemaVersion: 2,
          id: `map-ambush:${leg.route.id}:${context.turn}:${context.minute}`,
          context: `在去往${target.name}的「${routeLabel(leg.route, config.theme)}」上遭到${identity}伏击`,
          threatBand: leg.danger >= 5 ? 'dangerous' : leg.danger >= 4 ? 'matched' : 'weak',
          allies: [], enemies, neutrals: [],
        },
      });
      context.emit('map.ambush', { route: leg.route.id, to: target.id, identity });
      parts.push(`快到${target.name}时，${identity}从暗处扑了出来`);
      stop = true;
    }
  }
  if (leg.route.hidden) {
    const runtime = runtimeOf(state);
    if (!runtime.routes.includes(leg.route.id)) runtime.routes = [...runtime.routes, leg.route.id];
  }
  arrive(state, context, target, { via: 'travel', minutes, from: leg.from });
  return { ok: true, stop, text: parts.join('；') };
}

function playerTravel(state: GameState, context: Ctx, target: MapLocation): ReturnType<NonNullable<GameplayModule<MapModuleConfig>['commands']>[string]> {
  const config = context.config;
  const runtime = runtimeOf(state);
  const origin = currentLocationOf(config.map, runtime);
  if (!origin) return { ok: false, reason: '还不知道你在地图上的位置' };
  if (!runtime.discovered.includes(target.id)) return { ok: false, reason: `还不知道「${target.name}」在哪` };
  const graph = buildGraph(config.map, runtime, { knownOnly: true });
  const legContext = legContextFor(config, (key, base) => context.modifiers.apply(key, base));
  const path = shortestPath(graph, origin.id, target.id, legContext);
  if (!path) return { ok: false, reason: `没有已知的路通往「${target.name}」` };
  const stops: string[] = [];
  const troubles: string[] = [];
  let walked = 0;
  let spent = 0;
  const staminaBefore = Number(context.facts.read(state, 'player.stamina') ?? 0);
  for (let index = 0; index < path.legs.length; index++) {
    // 前一段可能改了时间与加成，重新估算这一段。
    const planned = path.legs[index]!;
    const leg = estimateLeg(graph, planned.route, planned.from, legContext);
    const before = state.世界?.时间系统?.时钟?.elapsedMinutes ?? 0;
    const result = travelLeg(state, context, graph, leg, index);
    if (!result.ok) {
      if (index === 0) return { ok: false, reason: result.reason ?? '走不了' };
      troubles.push(`${result.reason}，只好在${graph.locations.get(leg.from)?.name}停下`);
      break;
    }
    walked += 1;
    spent += Math.max(0, (state.世界?.时间系统?.时钟?.elapsedMinutes ?? before) - before) || leg.minutes;
    stops.push(graph.locations.get(leg.to)!.name);
    if (result.text) troubles.push(result.text);
    if (result.stop) {
      if (index < path.legs.length - 1) troubles.push(`去${target.name}的路只好先放一放`);
      break;
    }
  }
  const here = currentLocationOf(config.map, runtimeOf(state))!;
  state.世界.空间定位 = { ...(state.世界.空间定位 ?? { 当前位置: '' }), 当前位置: placeLabel(config.map, here) };
  const staminaAfter = Number(context.facts.read(state, 'player.stamina') ?? 0);
  const staminaText = config.stats && staminaBefore > staminaAfter ? `，${config.staminaName} -${Math.round(staminaBefore - staminaAfter)}` : '';
  const via = stops.length > 1 ? `经${stops.slice(0, -1).join('、')}，` : '';
  context.note(`你从${origin.name}出发，${via}抵达${here.name}，路上约${formatMinutes(spent)}${staminaText}。${troubles.length ? `${troubles.join('；')}。` : ''}`, 'fact');
  return { ok: true, message: walked === path.legs.length ? `抵达${here.name}（${formatMinutes(spent)}）` : `走到了${here.name}` };
}

// ── Module ────────────────────────────────────────────────────────────

function mapFacts(config: MapModuleConfig): FactSpec[] {
  const map = config.map;
  const here = (state: GameState) => currentLocationOf(map, mapStateOf(state));
  const enumerateLocations = (state: GameState) => allLocations(map, mapStateOf(state)).map(location => ({ params: { id: location.id }, label: location.name }));
  return [
    { id: 'map.location', module: MAP_MODULE_ID, type: 'string', label: '地图·当前地点（id）', writable: [], read: state => mapStateOf(state)?.current },
    { id: 'map.locationName', module: MAP_MODULE_ID, type: 'string', label: '地图·当前地点', writable: [], read: state => here(state)?.name },
    { id: 'map.locationKind', module: MAP_MODULE_ID, type: 'string', label: '地图·当前地点类型', writable: [], read: state => here(state)?.kind },
    { id: 'map.region', module: MAP_MODULE_ID, type: 'string', label: '地图·当前地区（id）', writable: [], read: state => regionOf(map, here(state))?.id },
    { id: 'map.regionName', module: MAP_MODULE_ID, type: 'string', label: '地图·当前地区', writable: [], read: state => regionOf(map, here(state))?.name },
    { id: 'map.terrain', module: MAP_MODULE_ID, type: 'string', label: '地图·当前地貌', writable: [], read: state => regionOf(map, here(state))?.terrain },
    { id: 'map.danger', module: MAP_MODULE_ID, type: 'number', label: '地图·当前危险度', writable: [],
      read: state => { const location = here(state); return Math.max(location?.danger ?? 0, regionOf(map, location)?.danger ?? 0); } },
    { id: 'map.discoveredCount', module: MAP_MODULE_ID, type: 'number', label: '地图·已知地点数', writable: [], read: state => mapStateOf(state)?.discovered.length ?? 0 },
    { id: 'map.visitedCount', module: MAP_MODULE_ID, type: 'number', label: '地图·到过的地点数', writable: [], read: state => mapStateOf(state)?.visited.length ?? 0 },
    { id: 'map.visited.{id}', module: MAP_MODULE_ID, type: 'boolean', label: '到过{id}', writable: [],
      read: (state, { id }) => Boolean(mapStateOf(state)?.visited.includes(id)), enumerate: enumerateLocations },
    { id: 'map.discovered.{id}', module: MAP_MODULE_ID, type: 'boolean', label: '知道{id}', writable: [],
      read: (state, { id }) => Boolean(mapStateOf(state)?.discovered.includes(id)), enumerate: enumerateLocations },
    { id: 'map.here.markets', module: MAP_MODULE_ID, type: 'list', label: '此地可交易的市场', writable: [], visibility: 'hidden',
      read: state => here(state)?.links?.markets ?? [] },
    { id: 'map.here.services', module: MAP_MODULE_ID, type: 'list', label: '此地的服务', writable: [], read: state => here(state)?.services ?? [] },
  ];
}

export const MAP_DOMAIN_EVENTS: readonly DomainEventSpec[] = [
  { type: 'map.departed', label: '出发赶路', payload: 'from、to 为地点 id，route 为路线 id，minutes' },
  { type: 'map.arrived', label: '抵达地点', payload: 'id、name、kind、regionId、firstVisit（是否初到）、via（travel/story）' },
  { type: 'map.discovered', label: '发现新地点', payload: 'id、name、source（arrival/nearby/story/rumor）' },
  { type: 'map.regionEntered', label: '进入新地区', payload: 'id、name、terrain、danger' },
  { type: 'map.hazard', label: '危险路段检定', payload: 'route、success、dc、danger' },
  { type: 'map.ambush', label: '赶路遇伏', payload: 'route、to、identity' },
  { type: 'map.rested', label: '在某地休整', payload: 'id、hours' },
];

function textArg(value: unknown, max = 60): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export const mapModule: GameplayModule<MapModuleConfig> = {
  id: MAP_MODULE_ID,
  label: '地图',
  order: 45,
  resolveConfig: world => resolveModuleConfig(world),
  facts: mapFacts,
  domainEvents: () => MAP_DOMAIN_EVENTS,
  prepare: (state, context) => {
    const config = context.config.map;
    const holder = state as GameState & { map?: MapRuntimeState };
    const runtime = normalizeMapState(holder.map) ?? emptyMapState();
    holder.map = runtime;
    const locations = allLocations(config, runtime);
    if (!runtime.current || !locations.some(location => location.id === runtime.current)) {
      const start = resolveLocation(state.世界?.空间定位?.当前位置, locations)
        ?? locations.find(location => location.id === config.startLocationId) ?? locations[0];
      if (!start) return;
      runtime.current = start.id;
      if (!runtime.visited.includes(start.id)) runtime.visited = [...runtime.visited, start.id];
      if (!runtime.trail.length) runtime.trail = [{ to: start.id, turn: currentTurn(state), minutes: 0, via: 'start' }];
    }
    const graph = buildGraph(config, runtime);
    const known = new Set([
      ...runtime.discovered,
      ...locations.filter(location => isKnownAtStart(location, config)).map(location => location.id),
      ...runtime.visited,
      runtime.current!,
      ...runtime.visited.flatMap(id => neighborIds(graph, id, runtime)),
    ]);
    const next = locations.filter(location => known.has(location.id)).map(location => location.id);
    if (next.length !== runtime.discovered.length || next.some(id => !runtime.discovered.includes(id))) runtime.discovered = next;
    if (state.世界?.空间定位 && !String(state.世界.空间定位.当前位置 ?? '').trim()) {
      const here = currentLocationOf(config, runtime);
      if (here) state.世界.空间定位.当前位置 = placeLabel(config, here);
    }
  },
  modifiers: (state, config) => {
    const runtime = mapStateOf(state);
    const here = currentLocationOf(config.map, runtime);
    if (!here) return [];
    const region = regionOf(config.map, here);
    const out: ModifierRecord[] = [];
    region?.effects?.forEach((effect, index) => out.push({
      id: `map:region:${region.id}:${index}`, target: effect.target, mode: effect.mode ?? 'mult', value: effect.value,
      source: `map:${region.id}`, label: effect.label || region.name,
    }));
    here.effects?.forEach((effect, index) => out.push({
      id: `map:location:${here.id}:${index}`, target: effect.target, mode: effect.mode ?? 'mult', value: effect.value,
      source: `map:${here.id}`, label: effect.label || here.name,
    }));
    for (const gather of here.links?.gather ?? []) {
      if (gather.bonus) out.push({ id: `map:gather:${here.id}:${gather.id}`, target: `resources.gather.${gather.id}`, mode: 'mult', value: gather.bonus, source: `map:${here.id}`, label: `${here.name}物产` });
    }
    return out;
  },
  commands: {
    travel: (state, args, context) => {
      const config = context.config.map;
      const runtime = runtimeOf(state);
      const locations = allLocations(config, runtime);
      const target = resolveLocation(args.to ?? args.id ?? args.name, locations);
      if (!target) return { ok: false, reason: `地图上没有「${textArg(args.to ?? args.name) || '这个地点'}」` };
      if (runtime.current === target.id) return { ok: false, reason: `已经在${target.name}了` };
      if (context.source === 'player') return playerTravel(state, context, target);
      // 正文、事件、导演带来的移动：正文已经写了路上的事，这里只移动标记，沿途的地点一并记为知道。
      const origin = currentLocationOf(config, runtime);
      const path = origin ? shortestPath(buildGraph(config, runtime), origin.id, target.id, legContextFor(context.config)) : null;
      if (path) discover(state, context, path.nodes, 'story');
      arrive(state, context, target, { via: 'story', minutes: 0, ...(origin ? { from: origin.id } : {}) });
      state.世界.空间定位 = { ...(state.世界.空间定位 ?? { 当前位置: '' }), 当前位置: placeLabel(config, target) };
      return { ok: true, message: `位置：${target.name}` };
    },
    discover: (state, args, context) => {
      const config = context.config.map;
      const runtime = runtimeOf(state);
      const locations = allLocations(config, runtime);
      const name = textArg(args.name, 40);
      const existing = resolveLocation(args.id ?? name, locations);
      if (existing && (!name || existing.name === name || existing.aliases?.includes(name) || existing.id === args.id)) {
        if (runtime.discovered.includes(existing.id)) return { ok: false, reason: `「${existing.name}」已经在地图上了` };
        discover(state, context, [existing.id], 'story');
        return { ok: true, message: `地图上标出了「${existing.name}」` };
      }
      if (!name) return { ok: false, reason: '新地点需要名字' };
      if (context.source === 'player') return { ok: false, reason: '新地点要在故事里出现后才会画上地图' };
      if (runtime.extraLocations.length >= MAX_EXTRA) return { ok: false, reason: '地图上的新地点太多了' };
      const anchor = resolveLocation(args.near, locations) ?? currentLocationOf(config, runtime);
      const position = placeNear(config, locations, anchor, {
        ...(typeof args.direction === 'string' ? { direction: args.direction } : {}),
        ...(typeof args.distance === 'string' || typeof args.distance === 'number' ? { distance: args.distance as string | number } : typeof args.minutes === 'number' ? { distance: args.minutes } : {}),
        seed: hashString(name),
      });
      const taken = new Set(locations.map(location => location.id));
      let serial = runtime.extraLocations.length + 1;
      while (taken.has(`story_${serial}`)) serial++;
      const description = textArg(args.description, 240);
      const kind = typeof args.kind === 'string' && (MAP_LOCATION_KINDS as readonly string[]).includes(args.kind) ? args.kind as MapLocation['kind'] : guessLocationKind(name, description);
      const location: MapLocation = {
        id: `story_${serial}`, name, kind, x: position.x, y: position.y, origin: 'story',
        ...(nearestRegion(config.regions, position.x, position.y) ? { regionId: nearestRegion(config.regions, position.x, position.y)!.id } : {}),
        ...(description ? { description } : {}),
      };
      runtime.extraLocations = [...runtime.extraLocations, location];
      if (anchor) {
        const kindArg = typeof args.route === 'string' && (MAP_ROUTE_KINDS as readonly string[]).includes(args.route) ? args.route as MapRoute['kind'] : undefined;
        runtime.extraRoutes = [...runtime.extraRoutes, {
          id: `story_route_${serial}`, from: anchor.id, to: location.id,
          kind: kindArg ?? (config.landform === 'space' ? 'warp' : location.kind === 'cave' || location.kind === 'wild' || location.kind === 'ruin' ? 'trail' : 'road'),
        }];
      }
      discover(state, context, [location.id], 'story');
      return { ok: true, message: `地图上新添了「${name}」` };
    },
    rest: (state, args, context) => {
      const config = context.config;
      const here = currentLocationOf(config.map, runtimeOf(state));
      if (!here?.services?.includes('rest')) return { ok: false, reason: '这里没有可以歇脚的地方' };
      const hours = Math.min(12, Math.max(1, Math.round(Number(args.hours) || 8)));
      const price = here.restPrice ?? 0;
      if (price > 0) {
        const wallet = Number(context.facts.read(state, 'player.currency') ?? 0);
        if (wallet < price) return { ok: false, reason: `休整要 ${price}，钱袋里只有 ${wallet}` };
        context.apply([{ op: 'add', path: 'player.currency', value: -price, strict: true, label: `在${here.name}休整` }], 'system');
      }
      advanceStateClock(state, config.world, hours * 60, `在${here.name}休整`);
      const share = Math.min(1, hours / 8);
      const stamina = Math.round((config.stats ? config.staminaMax : 100) * share);
      const before = Number(context.facts.read(state, 'player.stamina') ?? 0);
      if (config.stats) {
        context.apply([
          { op: 'add', path: 'player.stamina', value: stamina, label: `在${here.name}休整` },
          { op: 'add', path: 'player.hp', value: Math.round(config.hpMax * 0.15 * share), label: `在${here.name}休整` },
        ], 'system');
      } else {
        context.apply([{ op: 'set', path: 'player.stamina', value: Math.min(100, before + stamina) }], 'system');
      }
      const after = Number(context.facts.read(state, 'player.stamina') ?? 0);
      context.emit('map.rested', { id: here.id, hours });
      context.note(`你在${here.name}休整了 ${hours} 小时${price ? `，花了 ${price}` : ''}，${config.staminaName}恢复 ${Math.max(0, Math.round(after - before))}。`, 'fact');
      return { ok: true, message: `休整 ${hours} 小时` };
    },
  },
  /** 正文或 AI 直接改了「当前位置」：对到地图上的地点就移动标记（不扣时间）。 */
  onSettle: (state, context, before) => {
    const text = String(state.世界?.空间定位?.当前位置 ?? '').trim();
    const previous = String(before.世界?.空间定位?.当前位置 ?? '').trim();
    if (!text || text === previous) return;
    if (context.events().some(event => event.type === 'map.arrived')) return;
    const config = context.config.map;
    const runtime = runtimeOf(state);
    const target = resolveLocation(text, allLocations(config, runtime));
    if (!target || target.id === runtime.current) return;
    const origin = currentLocationOf(config, runtime);
    arrive(state, context, target, { via: 'story', minutes: 0, ...(origin ? { from: origin.id } : {}) });
  },
  /** 正文提到地图上还不知道的地点：标到地图上（听说过）。 */
  onTurnEnd: (state, context, input) => {
    const narrative = `${input.narrative ?? ''}`;
    if (!narrative.trim()) return;
    const runtime = runtimeOf(state);
    const unknown = allLocations(context.config.map, runtime).filter(location => !runtime.discovered.includes(location.id));
    const hits = mentionedLocations(narrative, unknown, 3);
    if (hits.length) discover(state, context, hits.map(location => location.id), 'rumor');
  },
  summarize: (state, context, audience) => {
    const config = context.config.map;
    const runtime = mapStateOf(state);
    const here = currentLocationOf(config, runtime);
    if (!runtime || !here) return undefined;
    const region = regionOf(config, here);
    const graph = buildGraph(config, runtime, { knownOnly: true });
    const legContext = legContextFor(context.config, (key, base) => context.modifiers.apply(key, base));
    const exits = (graph.adjacency.get(here.id) ?? []).slice(0, 6).map(edge => {
      const leg = estimateLeg(graph, edge.route, here.id, legContext);
      const to = graph.locations.get(edge.to)!;
      return `${to.name}（${routeLabel(edge.route, context.config.theme)}，约${formatMinutes(leg.minutes)}${leg.danger ? `，危险 ${leg.danger}` : ''}）`;
    });
    const known = allLocations(config, runtime).filter(location => runtime.discovered.includes(location.id));
    if (audience === 'extraction') {
      return `主角在地图上的「${here.name}」。正文里主角去了地图上的另一处时写 command map.travel {"to":"地名"}（本地只移动标记，不扣时间）；`
        + `出现地图上没有的新地点写 map.discover {"name","near","direction","description"}。已知地点：${known.slice(0, 28).map(location => location.name).join('、')}。`;
    }
    const traits = [
      region ? `${region.name}${region.terrain !== 'sea' ? `·${TERRAIN_LABELS[region.terrain]}` : ''}` : '',
      LOCATION_KIND_LABELS[here.kind],
      Math.max(here.danger ?? 0, region?.danger ?? 0) ? `危险 ${Math.max(here.danger ?? 0, region?.danger ?? 0)}` : '',
    ].filter(Boolean).join('，');
    const detail = (here.description ?? '').replace(/\s+/g, ' ').slice(0, audience === 'director' ? 120 : 80).replace(/[。．.！!？?；;，,、\s]+$/, '');
    const services = [
      here.links?.markets?.length ? '有市场' : '',
      here.services?.includes('rest') ? '可休整' : '',
      here.links?.gather?.length ? '可采集' : '',
      here.links?.professions?.length ? '有职业会馆' : '',
    ].filter(Boolean).join('、');
    const progress = audience === 'director' ? `已知 ${known.length} 处，到过 ${runtime.visited.length} 处。` : '';
    return `所在：${here.name}（${traits}）${detail ? `：${detail}` : ''}。${exits.length ? `可前往：${exits.join('、')}。` : ''}${services ? `此地${services}。` : ''}${progress}`;
  },
};

/** 方便界面与预览：直接拿到某世界的地图模块配置。 */
export function mapModuleConfigFor(world: WorldDef | undefined): MapModuleConfig | undefined {
  return resolveModuleConfig(world);
}

export type MapCommandArgs = JsonRecord;
