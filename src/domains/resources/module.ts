/**
 * 资源模块：生存物资、材料与商品的统一库存。
 *
 * - 按世界时钟每日结算消耗与腐坏，必需品见底时进入匮乏状态（每天掉生命/体力、检定减值）。
 * - 采集、制作、解锁配方是玩家命令，会消耗体力与时间；事件和 AI 通过变量增减。
 * - 状态通过统一加成影响骰子、属性等其他模块；变化记入账本，告急/耗尽/恢复发出领域事件。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { SurvivalModuleSchema } from '../../modules/schema';
import type { FactSpec, WriteSource } from '../../core/facts';
import type { GameplayModule, ModuleHookContext } from '../../core/host';
import type { ModifierRecord } from '../../core/modifiers';
import type { CycleTick } from '../../core/cycles';
import { MAX_STEPPED_DAYS } from '../../core/cycles';
import { evaluateCondition } from '../../core/conditions';
import { advanceStateClock } from '../../core/clock';
import { normalizeRecipe, normalizeResourcesConfig, type RecipeDef, type ResourceDef, type ResourcesConfig, type StatusDef } from './config';
import {
  LEDGER_LIMIT,
  clearLegacyResourceFields,
  emptyResourcesState,
  migrateLegacyResources,
  normalizeResourcesState,
  type ResourcesState,
} from './state';

export const RESOURCES_MODULE_ID = 'resources';
const WRITERS: readonly WriteSource[] = ['ai', 'event', 'custom', 'director', 'player'];

export interface ResourcesModuleConfig {
  config: ResourcesConfig;
  world?: WorldDef;
}

type Ctx = ModuleHookContext<ResourcesModuleConfig>;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function resourcesConfigFromWorld(world: WorldDef | undefined): ResourcesConfig | undefined {
  const module = world?.modules?.find(item => item.moduleId === 'survival' && item.enabled);
  if (!module) return undefined;
  return normalizeResourcesConfig(module.moduleConfig as SurvivalModuleSchema | undefined);
}

/** 原地取用（必要时补齐字段），保证同一次结算里所有引用指向同一个对象。 */
export function resourcesState(state: GameState): ResourcesState {
  const current = state.resources as ResourcesState | undefined;
  if (current && current.version === 2) {
    current.stocks ??= {};
    current.capacity ??= {};
    current.discovered ??= {};
    current.retired ??= [];
    current.unlockedRecipes ??= [];
    current.customRecipes ??= [];
    current.statuses ??= {};
    current.evolved ??= [];
    current.ledger ??= [];
    return current;
  }
  state.resources = normalizeResourcesState(current) ?? emptyResourcesState();
  return state.resources;
}

/** 当前生效的资源定义（配置 + 运行时发现，去掉已淘汰）。 */
export function activeResourceDefs(config: ResourcesConfig, state: GameState): ResourceDef[] {
  const runtime = state.resources;
  const retired = new Set(runtime?.retired ?? []);
  const defs = config.resources.filter(resource => !retired.has(resource.id));
  for (const def of Object.values(runtime?.discovered ?? {})) {
    if (!retired.has(def.id) && !defs.some(item => item.id === def.id)) defs.push(def);
  }
  return defs;
}

export function resourceDef(config: ResourcesConfig, state: GameState, id: string): ResourceDef | undefined {
  return activeResourceDefs(config, state).find(resource => resource.id === id || resource.name === id);
}

export function resourceCapacity(config: ResourcesConfig, state: GameState, id: string): number {
  const def = resourceDef(config, state, id);
  return Math.max(0, Number(state.resources?.capacity?.[def?.id ?? id] ?? def?.max ?? 0));
}

export function allRecipes(config: ResourcesConfig, state: GameState): RecipeDef[] {
  const custom = state.resources?.customRecipes ?? [];
  return [...config.recipes, ...custom.filter(recipe => !config.recipes.some(item => item.id === recipe.id))];
}

export function statusDef(config: ResourcesConfig, id: string): StatusDef | undefined {
  return config.statuses.find(status => status.id === id);
}

function ledger(state: GameState, context: Ctx, reason: string, changes: Array<{ id: string; delta: number; after: number }>): void {
  const relevant = changes.filter(change => change.delta !== 0);
  if (relevant.length === 0) return;
  const runtime = resourcesState(state);
  runtime.ledger = [...runtime.ledger, { turn: context.turn, minute: context.minute, reason, changes: relevant }].slice(-LEDGER_LIMIT);
}

/** 改库存并处理告急/耗尽/恢复事件；返回实际变化量。 */
function changeStock(state: GameState, context: Ctx, id: string, delta: number): { delta: number; after: number } {
  const config = context.config.config;
  const def = resourceDef(config, state, id);
  if (!def) return { delta: 0, after: 0 };
  const runtime = resourcesState(state);
  const before = Number(runtime.stocks[def.id] ?? 0);
  const capacity = resourceCapacity(config, state, def.id);
  const after = round(Math.min(capacity, Math.max(0, before + delta)));
  runtime.stocks[def.id] = after;
  const applied = round(after - before);
  if (applied === 0) return { delta: 0, after };
  if (after <= 0 && before > 0) context.emit('resources.depleted', { id: def.id, name: def.name });
  else if (def.lowAt > 0 && after <= def.lowAt && before > def.lowAt) context.emit('resources.low', { id: def.id, name: def.name, amount: after });
  if (after > 0 && before <= 0) {
    context.emit('resources.restored', { id: def.id, name: def.name, amount: after });
    if (def.depletedStatus && runtime.statuses[def.depletedStatus]) clearStatus(state, context, def.depletedStatus, `${def.name}已补充`);
  }
  return { delta: applied, after };
}

function applyStatus(state: GameState, context: Ctx, id: string, source: string, days?: number): boolean {
  const def = statusDef(context.config.config, id);
  if (!def) return false;
  const runtime = resourcesState(state);
  const existing = runtime.statuses[id];
  const duration = days ?? def.days;
  runtime.statuses[id] = {
    since: existing?.since ?? context.turn,
    sinceMinute: existing?.sinceMinute ?? context.minute,
    ...(duration ? { untilMinute: context.minute + duration * 1440 } : {}),
    source,
  };
  if (!existing) {
    context.emit('status.applied', { id, name: def.name, severity: def.severity });
    context.note(`你陷入「${def.name}」：${describeStatus(def)}`, 'fact');
  }
  return true;
}

function clearStatus(state: GameState, context: Ctx, id: string, reason: string): boolean {
  const runtime = resourcesState(state);
  if (!runtime.statuses[id]) return false;
  delete runtime.statuses[id];
  const def = statusDef(context.config.config, id);
  context.emit('status.cleared', { id, name: def?.name ?? id, reason });
  context.note(`「${def?.name ?? id}」解除了（${reason}）。`, 'fact');
  return true;
}

export function describeStatus(def: StatusDef): string {
  const parts: string[] = [];
  if (def.perDay?.hp) parts.push(`每天生命 ${def.perDay.hp > 0 ? '+' : ''}${def.perDay.hp}`);
  if (def.perDay?.stamina) parts.push(`每天体力 ${def.perDay.stamina > 0 ? '+' : ''}${def.perDay.stamina}`);
  for (const modifier of def.modifiers ?? []) {
    const label = modifier.target.startsWith('dice.check') ? '检定' : modifier.target;
    parts.push(`${label} ${modifier.mode === 'mult' ? `${Math.round(modifier.value * 100)}%` : `${modifier.value > 0 ? '+' : ''}${modifier.value}`}`);
  }
  return parts.join('，') || def.description || '影响行动';
}

function stockOf(state: GameState, id: string): number {
  return Number(state.resources?.stocks?.[id] ?? 0);
}

function itemCount(state: GameState, name: string): number {
  return Number(state.玩家?.物品栏?.[name]?.数量 ?? 0);
}

/** `item:名字` 走物品栏，其余走资源库存。 */
function availableInput(state: GameState, key: string): number {
  return key.startsWith('item:') ? itemCount(state, key.slice(5)) : stockOf(state, key);
}

function inputLabel(config: ResourcesConfig, state: GameState, key: string): string {
  if (key.startsWith('item:')) return key.slice(5);
  return resourceDef(config, state, key)?.name ?? key;
}

function consumeDay(state: GameState, context: Ctx, days: number, reason: string): void {
  const config = context.config.config;
  const changes: Array<{ id: string; delta: number; after: number }> = [];
  const runtime = resourcesState(state);
  for (const def of activeResourceDefs(config, state)) {
    if (def.upkeep > 0) {
      const need = round(Math.max(0, context.modifiers.apply(`resources.upkeep.${def.id}`, def.upkeep)) * days);
      const have = stockOf(state, def.id);
      if (def.depletedStatus && runtime.statuses[def.depletedStatus] && have >= need) {
        clearStatus(state, context, def.depletedStatus, `${def.name}已补充`);
      }
      const taken = changeStock(state, context, def.id, -Math.min(have, need));
      changes.push({ id: def.id, ...taken });
      if (have < need && def.depletedStatus) applyStatus(state, context, def.depletedStatus, `resources:${def.id}`);
    }
    if (def.spoilage > 0) {
      const have = stockOf(state, def.id);
      if (have > 0) {
        const lost = Math.max(1, Math.floor(have * def.spoilage * days));
        changes.push({ id: def.id, ...changeStock(state, context, def.id, -Math.min(have, lost)) });
      }
    }
  }
  ledger(state, context, reason, changes);
  // 状态的每日代价。
  for (const [id] of Object.entries(runtime.statuses)) {
    const def = statusDef(config, id);
    if (!def?.perDay) continue;
    const hp = (def.perDay.hp ?? 0) * days;
    const stamina = (def.perDay.stamina ?? 0) * days;
    if (hp) context.apply([{ op: 'add', path: 'player.hp', value: hp, label: def.name }], 'system');
    if (stamina) context.apply([{ op: 'add', path: 'player.stamina', value: stamina, label: def.name }], 'system');
    if (hp < 0 && Number(context.facts.read(state, 'player.hp') ?? 1) <= 0) {
      context.emit('player.collapsed', { cause: id, name: def.name });
      context.note(`你因「${def.name}」体力不支倒下了，必须尽快得到救治或补给。`, 'fact');
    }
  }
  // 有时效的状态到期。
  for (const [id, status] of Object.entries(runtime.statuses)) {
    if (status.untilMinute !== undefined && context.minute >= status.untilMinute) clearStatus(state, context, id, '持续时间结束');
  }
}

function addDiscovered(state: GameState, context: Ctx, raw: Partial<ResourceDef> & { id?: string; name?: string }, amount: number): ResourceDef | string {
  const config = context.config.config;
  const id = String(raw.id ?? '').trim().replace(/[.\s]+/g, '_');
  const name = String(raw.name ?? '').trim();
  if (!id || !name) return '新资源需要 id 和名称';
  const existing = resourceDef(config, state, id);
  if (existing) {
    changeStock(state, context, existing.id, amount);
    return existing;
  }
  const max = Math.max(1, Math.trunc(Number(raw.max) || Math.max(10, amount)));
  const def: ResourceDef = {
    id, name,
    symbol: String(raw.symbol ?? ''),
    kind: raw.kind === 'vital' || raw.kind === 'consumable' || raw.kind === 'goods' ? raw.kind : 'material',
    initial: 0,
    max,
    scarce: raw.scarce === true,
    description: String(raw.description ?? '游戏中发现的资源'),
    upkeep: Math.max(0, Number(raw.upkeep) || 0),
    lowAt: Math.max(0, Number(raw.lowAt) || 0),
    spoilage: Math.min(1, Math.max(0, Number(raw.spoilage) || 0)),
    gather: raw.gather,
  };
  const runtime = resourcesState(state);
  runtime.discovered[id] = def;
  runtime.retired = runtime.retired.filter(item => item !== id);
  runtime.stocks[id] = 0;
  changeStock(state, context, id, amount);
  context.emit('resources.discovered', { id, name });
  return def;
}

function legacyObject(state: GameState, config: ResourcesConfig, id: string): Record<string, unknown> | undefined {
  const def = resourceDef(config, state, id);
  if (!def) return undefined;
  return { 数量: stockOf(state, def.id), 最大值: resourceCapacity(config, state, def.id), name: def.name, symbol: def.symbol, scarce: def.scarce, description: def.description };
}

function resourceFacts(holder: ResourcesModuleConfig): FactSpec[] {
  const config = holder.config;
  const enumerate = (state: GameState) => activeResourceDefs(config, state).map(def => ({ params: { id: def.id }, label: def.name }));
  return [
    {
      id: 'player.resources.{id}', module: RESOURCES_MODULE_ID, type: 'number', label: '物资·{name}',
      aliases: ['玩家.生存资源.{id}.数量', '生存资源.{id}', 'resources.{id}.amount', 'survival.{id}'],
      writable: WRITERS,
      bounds: (state, { id }) => ({ min: 0, max: resourceCapacity(config, state, id) }),
      read: (state, { id }) => {
        const def = resourceDef(config, state, id);
        return def ? stockOf(state, def.id) : undefined;
      },
      write: (state, { id }, value) => {
        const def = resourceDef(config, state, id);
        if (!def) return `未知物资「${id}」；可用：${activeResourceDefs(config, state).map(item => `${item.id}(${item.name})`).join('、')}`;
        resourcesState(state).stocks[def.id] = round(Number(value) || 0);
        return true;
      },
      enumerate,
    },
    {
      id: 'player.resources.{id}.max', module: RESOURCES_MODULE_ID, type: 'number', label: '物资上限·{name}',
      aliases: ['玩家.生存资源.{id}.最大值'], writable: ['event', 'custom', 'system'], bounds: { min: 0, integer: true },
      read: (state, { id }) => resourceDef(config, state, id) ? resourceCapacity(config, state, id) : undefined,
      write: (state, { id }, value) => {
        const def = resourceDef(config, state, id);
        if (!def) return `未知物资「${id}」`;
        resourcesState(state).capacity[def.id] = Math.max(0, Math.trunc(Number(value) || 0));
        return true;
      },
      enumerate,
    },
    {
      id: 'player.resources.{id}.entry', module: RESOURCES_MODULE_ID, type: 'object', label: '物资记录·{name}',
      aliases: ['玩家.生存资源.{id}'], writable: WRITERS, visibility: 'hidden',
      read: (state, { id }) => legacyObject(state, config, id),
      write: (state, { id }, value) => {
        const def = resourceDef(config, state, id);
        if (!def) return `未知物资「${id}」；新物资请用 resources.discover 命令`;
        const record = value && typeof value === 'object' ? value as Record<string, unknown> : { 数量: value };
        const runtime = resourcesState(state);
        if (record.数量 !== undefined && Number.isFinite(Number(record.数量))) {
          runtime.stocks[def.id] = round(Math.min(resourceCapacity(config, state, def.id), Math.max(0, Number(record.数量))));
        }
        if (record.最大值 !== undefined && Number.isFinite(Number(record.最大值))) runtime.capacity[def.id] = Math.max(0, Math.trunc(Number(record.最大值)));
        return true;
      },
    },
    {
      id: 'player.status.{id}', module: RESOURCES_MODULE_ID, type: 'boolean', label: '状态·{name}',
      writable: ['event', 'custom', 'ai', 'director'],
      read: (state, { id }) => Boolean(state.resources?.statuses?.[id]),
      enumerate: () => config.statuses.map(status => ({ params: { id: status.id }, label: status.name })),
    },
    {
      id: 'player.statuses', module: RESOURCES_MODULE_ID, type: 'list', label: '当前状态', writable: [],
      read: state => Object.keys(state.resources?.statuses ?? {}).map(id => statusDef(config, id)?.name ?? id),
    },
  ];
}

function requireNumber(value: unknown, label: string): number | string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return `${label}必须是正数`;
  return parsed;
}

export const resourcesModule: GameplayModule<ResourcesModuleConfig> = {
  id: RESOURCES_MODULE_ID,
  label: '物资',
  order: 20,
  resolveConfig: world => {
    const config = resourcesConfigFromWorld(world);
    return config ? { config, world } : undefined;
  },
  facts: holder => resourceFacts(holder),
  domainEvents: () => [
    { type: 'resources.gathered', label: '采集', payload: 'id 为物资 id、amount' },
    { type: 'resources.crafted', label: '制作物品', payload: 'id 为配方 id' },
    { type: 'resources.low', label: '物资告急', payload: 'id 为物资 id、amount' },
    { type: 'resources.depleted', label: '物资耗尽', payload: 'id 为物资 id' },
    { type: 'resources.restored', label: '物资脱离告急', payload: 'id 为物资 id' },
    { type: 'resources.discovered', label: '发现新物资', payload: 'id、name' },
    { type: 'resources.recipeUnlocked', label: '解锁配方', payload: 'id 为配方 id' },
    { type: 'resources.recipeAdded', label: '新增配方', payload: 'id 为配方 id' },
    { type: 'resources.retired', label: '物资被淘汰', payload: 'id 为物资 id' },
    { type: 'resources.evolved', label: '物资演化步骤发生', payload: 'id 为演化步骤 id' },
    { type: 'status.applied', label: '进入状态（如匮乏、生病）', payload: 'id、name、severity' },
    { type: 'status.cleared', label: '状态解除', payload: 'id、name' },
    { type: 'player.collapsed', label: '因匮乏倒下', payload: 'cause 为状态 id' },
  ],
  prepare: (state, context) => {
    const config = context.config.config;
    let runtime = normalizeResourcesState(state.resources);
    const player = state.玩家 as unknown as Record<string, unknown>;
    if (!runtime && (player.生存资源 !== undefined || player.生存配方 !== undefined || state.gameplay?.survival)) {
      runtime = migrateLegacyResources(state, config);
    }
    runtime ??= emptyResourcesState();
    // 新游戏或世界更新后新增的资源：按初始值建档。
    for (const def of config.resources) {
      if (runtime.retired.includes(def.id)) continue;
      if (runtime.stocks[def.id] === undefined) runtime.stocks[def.id] = def.initial;
    }
    state.resources = runtime;
    clearLegacyResourceFields(state);
  },
  modifiers: (state, holder) => {
    const out: ModifierRecord[] = [];
    for (const id of Object.keys(state.resources?.statuses ?? {})) {
      const def = statusDef(holder.config, id);
      def?.modifiers?.forEach((modifier, index) => out.push({
        id: `status:${id}:${index}`, target: modifier.target, mode: modifier.mode, value: modifier.value,
        source: `status:${id}`, label: def.name,
      }));
    }
    return out;
  },
  commands: {
    gather: (state, args, context) => {
      const config = context.config.config;
      const def = resourceDef(config, state, String(args.id ?? ''));
      if (!def) return { ok: false, reason: '没有这种物资' };
      if (!def.gather) return { ok: false, reason: `${def.name}无法直接采集` };
      const capacity = resourceCapacity(config, state, def.id);
      if (stockOf(state, def.id) >= capacity) return { ok: false, reason: `${def.name}已经装满了` };
      const stamina = Number(context.facts.read(state, 'player.stamina') ?? 0);
      const cost = Math.round(context.modifiers.apply(`resources.gatherCost.${def.id}`, def.gather.stamina));
      if (cost > 0 && stamina < cost) return { ok: false, reason: `体力不足：需要 ${cost}，现有 ${stamina}` };
      const amount = Math.max(1, Math.round(context.modifiers.apply(`resources.gather.${def.id}`, def.gather.amount)));
      if (cost > 0) context.apply([{ op: 'add', path: 'player.stamina', value: -cost, label: `采集${def.name}` }], 'system');
      const change = changeStock(state, context, def.id, amount);
      advanceStateClock(state, context.config.world, def.gather.minutes, `采集${def.name}`);
      ledger(state, context, `采集${def.name}`, [{ id: def.id, ...change }]);
      context.emit('resources.gathered', { id: def.id, name: def.name, amount: change.delta, minutes: def.gather.minutes, stamina: cost });
      context.note(`你花了约 ${def.gather.minutes} 分钟采集${def.name}，得到 ${change.delta}${def.symbol ? ` ${def.symbol}` : ''}（体力 -${cost}）。`, 'fact');
      return { ok: true, message: `${def.name} +${change.delta}` };
    },
    craft: (state, args, context) => {
      const config = context.config.config;
      const recipe = allRecipes(config, state).find(item => item.id === args.id);
      if (!recipe) return { ok: false, reason: '没有这个配方' };
      const runtime = resourcesState(state);
      const locked = Boolean(recipe.unlockCondition || recipe.unlockCost) && !runtime.unlockedRecipes.includes(recipe.id);
      if (locked) return { ok: false, reason: `「${recipe.name}」尚未解锁` };
      if (recipe.tool && itemCount(state, recipe.tool) <= 0) return { ok: false, reason: `需要工具「${recipe.tool}」` };
      for (const [key, amount] of Object.entries(recipe.inputs)) {
        if (availableInput(state, key) < amount) return { ok: false, reason: `${inputLabel(config, state, key)}不足：需要 ${amount}，现有 ${availableInput(state, key)}` };
      }
      const stamina = Number(context.facts.read(state, 'player.stamina') ?? 0);
      if (recipe.stamina > 0 && stamina < recipe.stamina) return { ok: false, reason: `体力不足：需要 ${recipe.stamina}` };
      for (const key of Object.keys(recipe.outputs)) {
        if (!key.startsWith('item:') && !resourceDef(config, state, key)) return { ok: false, reason: `配方产物「${key}」不是已知物资` };
      }
      const changes: Array<{ id: string; delta: number; after: number }> = [];
      for (const [key, amount] of Object.entries(recipe.inputs)) {
        if (key.startsWith('item:')) context.apply([{ op: 'add', path: `player.items.${key.slice(5)}`, value: -amount }], 'system');
        else changes.push({ id: key, ...changeStock(state, context, key, -amount) });
      }
      const produced: string[] = [];
      for (const [key, amount] of Object.entries(recipe.outputs)) {
        if (key.startsWith('item:')) {
          context.apply([{ op: 'add', path: `player.items.${key.slice(5)}`, value: amount }], 'system');
          produced.push(`${key.slice(5)}×${amount}`);
        } else {
          const change = changeStock(state, context, key, amount);
          changes.push({ id: key, ...change });
          produced.push(`${resourceDef(config, state, key)?.name ?? key}×${change.delta}`);
        }
      }
      if (recipe.stamina > 0) context.apply([{ op: 'add', path: 'player.stamina', value: -recipe.stamina, label: `制作${recipe.name}` }], 'system');
      if (recipe.minutes > 0) advanceStateClock(state, context.config.world, recipe.minutes, `制作${recipe.name}`);
      ledger(state, context, `制作${recipe.name}`, changes);
      context.emit('resources.crafted', { id: recipe.id, name: recipe.name });
      context.note(`你制作了「${recipe.name}」，得到 ${produced.join('、')}${recipe.minutes ? `，用时约 ${recipe.minutes} 分钟` : ''}。`, 'fact');
      return { ok: true, message: `制作了${recipe.name}` };
    },
    unlockRecipe: (state, args, context) => {
      const config = context.config.config;
      const recipe = allRecipes(config, state).find(item => item.id === args.id);
      if (!recipe) return { ok: false, reason: '没有这个配方' };
      const runtime = resourcesState(state);
      if (runtime.unlockedRecipes.includes(recipe.id)) return { ok: false, reason: '已经解锁' };
      if (recipe.unlockCondition && !evaluateCondition(recipe.unlockCondition, { state, facts: context.facts, rng: context.rng, hourOfDay: context.hourOfDay })) {
        return { ok: false, reason: `还不满足「${recipe.name}」的解锁条件` };
      }
      for (const [key, amount] of Object.entries(recipe.unlockCost ?? {})) {
        const available = key.startsWith('fact:') ? Number(context.facts.read(state, key.slice(5)) ?? 0) : availableInput(state, key);
        if (available < amount) return { ok: false, reason: `解锁需要 ${inputLabel(config, state, key.replace(/^fact:/, ''))}×${amount}` };
      }
      for (const [key, amount] of Object.entries(recipe.unlockCost ?? {})) {
        if (key.startsWith('fact:')) context.apply([{ op: 'add', path: key.slice(5), value: -amount, strict: true }], 'system');
        else if (key.startsWith('item:')) context.apply([{ op: 'add', path: `player.items.${key.slice(5)}`, value: -amount }], 'system');
        else changeStock(state, context, key, -amount);
      }
      runtime.unlockedRecipes = [...runtime.unlockedRecipes, recipe.id];
      context.emit('resources.recipeUnlocked', { id: recipe.id, name: recipe.name });
      return { ok: true, message: `解锁了${recipe.name}` };
    },
    addRecipe: (state, args, context) => {
      const config = context.config.config;
      const raw = args.recipe && typeof args.recipe === 'object' ? args.recipe as Record<string, unknown> : args;
      const recipe = normalizeRecipe(raw as never, (state.resources?.customRecipes?.length ?? 0) + config.recipes.length, true);
      if (allRecipes(config, state).some(item => item.id === recipe.id)) recipe.id = `${recipe.id}_${context.turn}_${context.rng.int(10, 99)}`;
      const keys = [...Object.keys(recipe.inputs), ...Object.keys(recipe.outputs)];
      if (Object.keys(recipe.inputs).length === 0 || Object.keys(recipe.outputs).length === 0) return { ok: false, reason: '配方必须有投入和产出' };
      const unknown = keys.filter(key => !key.startsWith('item:') && !resourceDef(config, state, key));
      if (unknown.length > 0) return { ok: false, reason: `配方引用了未知物资：${unknown.join('、')}` };
      const runtime = resourcesState(state);
      runtime.customRecipes = [...runtime.customRecipes, recipe];
      context.emit('resources.recipeAdded', { id: recipe.id, name: recipe.name });
      return { ok: true, message: `新配方：${recipe.name}` };
    },
    removeRecipe: (state, args) => {
      const runtime = resourcesState(state);
      const before = runtime.customRecipes.length;
      runtime.customRecipes = runtime.customRecipes.filter(recipe => recipe.id !== args.id);
      return runtime.customRecipes.length < before ? { ok: true } : { ok: false, reason: '只能删除游戏中创建的配方' };
    },
    consume: (state, args, context) => {
      const def = resourceDef(context.config.config, state, String(args.id ?? ''));
      if (!def) return { ok: false, reason: `没有物资「${String(args.id ?? '')}」` };
      const amount = requireNumber(args.amount, '数量');
      if (typeof amount === 'string') return { ok: false, reason: amount };
      if (stockOf(state, def.id) < amount) return { ok: false, reason: `${def.name}不足：需要 ${amount}，现有 ${stockOf(state, def.id)}` };
      const change = changeStock(state, context, def.id, -amount);
      ledger(state, context, String(args.reason ?? `消耗${def.name}`), [{ id: def.id, ...change }]);
      return { ok: true };
    },
    grant: (state, args, context) => {
      const def = resourceDef(context.config.config, state, String(args.id ?? ''));
      if (!def) return { ok: false, reason: `没有物资「${String(args.id ?? '')}」` };
      const amount = requireNumber(args.amount, '数量');
      if (typeof amount === 'string') return { ok: false, reason: amount };
      const change = changeStock(state, context, def.id, amount);
      ledger(state, context, String(args.reason ?? `获得${def.name}`), [{ id: def.id, ...change }]);
      return { ok: true };
    },
    discover: (state, args, context) => {
      const raw = args.resource && typeof args.resource === 'object' ? args.resource as Record<string, unknown> : args;
      const result = addDiscovered(state, context, raw as Partial<ResourceDef>, Math.max(0, Number(args.amount ?? raw.amount ?? 0) || 0));
      if (typeof result === 'string') return { ok: false, reason: result };
      context.note(`你发现了新的物资「${result.name}」。`, 'fact');
      return { ok: true };
    },
    retire: (state, args, context) => {
      const def = resourceDef(context.config.config, state, String(args.id ?? ''));
      if (!def) return { ok: false, reason: '没有这种物资' };
      const runtime = resourcesState(state);
      runtime.retired = [...new Set([...runtime.retired, def.id])];
      delete runtime.stocks[def.id];
      context.emit('resources.retired', { id: def.id, name: def.name });
      return { ok: true };
    },
    applyStatus: (state, args, context) => applyStatus(state, context, String(args.id ?? ''), String(args.source ?? 'event'), args.days ? Number(args.days) : undefined)
      ? { ok: true } : { ok: false, reason: `没有状态「${String(args.id ?? '')}」` },
    clearStatus: (state, args, context) => clearStatus(state, context, String(args.id ?? ''), String(args.reason ?? '得到处理'))
      ? { ok: true } : { ok: false, reason: '该状态未生效' },
  },
  onCycle: (state, context, cycle: CycleTick) => {
    const period = context.config.config.cycle;
    if (period === 'turn' || cycle.period !== period) return;
    const unit = period === 'day' ? '天' : '小时';
    const stepped = Math.min(cycle.count, period === 'day' ? MAX_STEPPED_DAYS : 48);
    for (let index = 0; index < stepped; index++) consumeDay(state, context, 1, cycle.count > 1 ? `第 ${index + 1}/${cycle.count} ${unit}的消耗` : period === 'day' ? '每日消耗' : '每小时消耗');
    if (cycle.count > stepped) consumeDay(state, context, cycle.count - stepped, `其余 ${cycle.count - stepped} ${unit}的消耗`);
  },
  /** AI 或事件直接改了库存（没走模块命令）时，补发告急/耗尽/恢复事件，并解除对应的匮乏状态。 */
  onSettle: (state, context, before) => {
    if (!state.resources) return;
    const emitted = context.events();
    const already = (type: string, id: string) => emitted.some(event => event.type === type && event.payload.id === id);
    for (const def of activeResourceDefs(context.config.config, state)) {
      const previous = Number(before.resources?.stocks?.[def.id] ?? 0);
      const after = stockOf(state, def.id);
      if (previous === after) continue;
      if (after <= 0 && previous > 0) {
        if (!already('resources.depleted', def.id)) context.emit('resources.depleted', { id: def.id, name: def.name });
      } else if (def.lowAt > 0 && after <= def.lowAt && previous > def.lowAt) {
        if (!already('resources.low', def.id)) context.emit('resources.low', { id: def.id, name: def.name, amount: after });
      }
      if (after > 0 && previous <= 0 && !already('resources.restored', def.id)) {
        context.emit('resources.restored', { id: def.id, name: def.name, amount: after });
        const runtime = resourcesState(state);
        if (def.depletedStatus && runtime.statuses[def.depletedStatus]) clearStatus(state, context, def.depletedStatus, `${def.name}已补充`);
      }
    }
  },
  onTurnEnd: (state, context, input) => {
    const config = context.config.config;
    if (config.cycle === 'turn') consumeDay(state, context, 1, '本回合消耗');
    const runtime = resourcesState(state);
    const text = `${input.userText ?? ''}\n${input.narrative ?? ''}`.toLowerCase();
    const day = Number(context.facts.read(state, 'world.day') ?? 1);
    for (const step of config.evolution) {
      if (runtime.evolved.includes(step.id)) continue;
      const byTurn = step.afterTurns !== undefined && context.turn >= step.afterTurns;
      const byDay = step.afterDays !== undefined && day >= step.afterDays;
      const byKeyword = step.keywords.some(keyword => text.includes(keyword.toLowerCase()));
      if (!byTurn && !byDay && !byKeyword) continue;
      runtime.evolved = [...runtime.evolved, step.id];
      for (const resource of step.add) addDiscovered(state, context, resource, resource.initial);
      for (const id of step.remove) {
        runtime.retired = [...new Set([...runtime.retired, id])];
        delete runtime.stocks[id];
      }
      context.emit('resources.evolved', { id: step.id });
      context.note(step.hint ?? `局势变化：${[...step.add.map(item => `出现了${item.name}`), ...step.remove.map(id => `${id}不再可用`)].join('，')}。`, 'fact');
    }
  },
  summarize: (state, context, audience) => {
    const config = context.config.config;
    const defs = activeResourceDefs(config, state);
    if (defs.length === 0) return undefined;
    const runtime = state.resources;
    const parts = defs.map(def => {
      const amount = stockOf(state, def.id);
      const capacity = resourceCapacity(config, state, def.id);
      const flags = [
        def.upkeep > 0 ? `${config.cycle === 'turn' ? '每回合' : config.cycle === 'hour' ? '每小时' : '每日'} -${def.upkeep}${amount > 0 ? `，约 ${Math.floor(amount / def.upkeep)} ${config.cycle === 'turn' ? '回合' : config.cycle === 'hour' ? '小时' : '天'}` : ''}` : '',
        amount <= 0 && def.kind === 'vital' ? '已耗尽' : def.lowAt > 0 && amount <= def.lowAt ? '告急' : '',
      ].filter(Boolean).join('，');
      return audience === 'extraction'
        ? `${def.id}=${def.name} ${amount}/${capacity}`
        : `${def.name} ${amount}/${capacity}${flags ? `（${flags}）` : ''}`;
    });
    const statuses = Object.keys(runtime?.statuses ?? {}).map(id => {
      const def = statusDef(config, id);
      return def ? `${def.name}：${describeStatus(def)}` : id;
    });
    if (audience === 'extraction') {
      return `物资变量 player.resources.<id>（数量/上限）：${parts.join('，')}。正文里拾取、消耗、交易物资时用 add 增减；新出现的物资不要直接写，交给玩家采集或事件。`;
    }
    return `物资：${parts.join('；')}${statuses.length ? `。当前状态：${statuses.join('；')}` : ''}`;
  },
};
