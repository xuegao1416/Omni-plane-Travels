/**
 * 事件校验：检查卡片选项、触发器与规则节点引用的属性、物资、商品、命令、变量、后续卡、领域事件在当前世界里是否存在。
 *
 * 内置卡的测试、事件编辑器、AI 生成事件包的「校验 → 修复」都用它，报错信息直接给作者看。
 */
import type { WorldDef } from '../data/worlds-schema';
import { createDefaultGameState, type GameState } from '../schema/variables';
import type { StatModuleSchema } from '../modules/schema';
import { createGameplayHost } from '../core/registry';
import type { GameplayHost } from '../core/host';
import { conditionPaths, type CoreCondition } from '../core/conditions';
import type { ResourcesModuleConfig } from '../domains/resources/module';
import type { EconomyModuleConfig } from '../domains/economy/module';
import { resourcePath, statPath } from './effects';
import { statInfo } from './cards';
import { getEventCatalog } from './catalog';
import { getNodeExecutor } from '../modules/nodeRegistry';
import '../modules/nodeExecutors';
import { indexCatalog } from './module';
import type { CardEffectSpec, CardOptionSpec, EventCatalog, EventDefinition } from './types';

export interface EventIssue {
  key: string;
  /** 选项下标（从 0 开始）；卡片或触发器本身的问题为空。 */
  option?: number;
  level: 'error' | 'warning';
  message: string;
}

const VITALS = new Set(['attrA', 'attrB', 'hp', 'stamina', '血量', '体力值']);
const DIMENSIONS = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const;

function statKnown(world: WorldDef | undefined, stat: string): boolean {
  if (VITALS.has(stat)) return true;
  const config = world?.modules?.find(module => module.moduleId === 'stat' && module.enabled)?.moduleConfig as StatModuleSchema | undefined;
  if (!config) return false;
  const key = statInfo(world, stat).key;
  return VITALS.has(key) || DIMENSIONS.some(dim => dim === key && Boolean(config[dim])) || Boolean(config.special?.some(item => item.id === key));
}

/** 卡片工作流里各选项节点的原始选项。 */
export function cardOptions(def: EventDefinition): CardOptionSpec[] {
  const out: CardOptionSpec[] = [];
  for (const node of def.card?.nodes ?? []) {
    if (!String(node.typeId).startsWith('choice.')) continue;
    const values = node.widgetValues ?? {};
    for (const raw of [values.options, values.fallback]) {
      let parsed: unknown = raw;
      if (typeof raw === 'string') {
        try { parsed = JSON.parse(raw); } catch { parsed = []; }
      }
      if (Array.isArray(parsed)) out.push(...parsed.filter(item => item && typeof item === 'object') as CardOptionSpec[]);
    }
  }
  return out;
}

interface Context {
  world?: WorldDef;
  host: GameplayHost;
  state: GameState;
  findCard(eventId: string, packId?: string): EventDefinition | undefined;
}

function pathResolvable(path: string, context: Context): boolean {
  return Boolean(context.host.facts.resolve(path)) || /^(dice|simulationRuntime|gameplay)\./.test(path);
}

function checkStat(stat: string, context: Context): string | undefined {
  const trimmed = stat.trim();
  if (!trimmed) return '检定缺少属性';
  if (trimmed.includes('.')) return pathResolvable(statPath(trimmed), context) ? undefined : `检定变量「${trimmed}」不存在`;
  return statKnown(context.world, trimmed) ? undefined : `属性「${trimmed}」在这个世界不存在`;
}

function effectIssue(effect: CardEffectSpec, context: Context): string | undefined {
  if (!effect || typeof effect !== 'object') return '效果格式不对';
  const { host } = context;
  if ('stat' in effect) {
    if (!Number.isFinite(Number(effect.delta))) return `属性「${effect.stat}」的增减不是数字`;
    return checkStat(effect.stat, context);
  }
  if ('resource' in effect) {
    if (!Number.isFinite(Number(effect.delta))) return `物资「${effect.resource}」的增减不是数字`;
    const path = resourcePath(host.facts, effect.resource);
    if (path === 'player.currency') return undefined;
    if (path.startsWith('player.resources.')) {
      const id = path.slice('player.resources.'.length);
      const resources = host.configOf<ResourcesModuleConfig>('resources')?.config.resources ?? [];
      return resources.some(item => item.id === id || item.name === id) ? undefined : `物资「${effect.resource}」在这个世界不存在`;
    }
    if (path.startsWith('economy.goods.')) return undefined;
    return `物资「${effect.resource}」在这个世界不存在（世界没有启用物资模块）`;
  }
  if ('fact' in effect) {
    if (!pathResolvable(effect.fact, context)) return `变量「${effect.fact}」不存在`;
    if (!host.facts.canWrite(effect.fact, 'event')) return `事件不能直接修改「${host.facts.label(effect.fact)}」`;
    if (effect.fact.startsWith('economy.goods.')) {
      const id = effect.fact.slice('economy.goods.'.length);
      const goods = host.configOf<EconomyModuleConfig>('economy')?.config.goods ?? [];
      if (!goods.some(item => item.id === id || item.name === id)) return `商品「${id}」在这个世界不存在`;
    }
    if (effect.fact.startsWith('economy.reputation.')) {
      const id = effect.fact.slice('economy.reputation.'.length);
      const markets = host.configOf<EconomyModuleConfig>('economy')?.config.markets ?? [];
      if (!markets.some(item => item.id === id)) return `市场「${id}」在这个世界不存在`;
    }
    return undefined;
  }
  if ('currency' in effect) return Number.isFinite(Number(effect.currency)) ? undefined : '钱的增减不是数字';
  if ('item' in effect) return effect.item?.trim() && Number.isFinite(Number(effect.delta)) ? undefined : '物品效果缺少名称或数量';
  if ('flag' in effect) return effect.flag?.trim() ? undefined : '标记缺少名称';
  if ('status' in effect || 'clearStatus' in effect) {
    const id = 'status' in effect ? effect.status : effect.clearStatus;
    const config = host.configOf<ResourcesModuleConfig>('resources')?.config;
    if (!config) return `状态「${id}」需要启用物资模块`;
    return config.statuses.some(item => item.id === id) || id.startsWith('deprived:') ? undefined : `状态「${id}」没有定义`;
  }
  if ('command' in effect) return host.commandNames().includes(effect.command) ? undefined : `命令「${effect.command}」在这个世界不可用`;
  if ('npc' in effect) return Number.isFinite(Number(effect.affinity)) ? undefined : `${effect.npc} 的好感增减不是数字`;
  if ('note' in effect) return effect.note?.trim() ? undefined : '备注为空';
  return '无法识别的效果';
}

function conditionIssues(condition: CoreCondition | undefined, context: Context): string[] {
  return conditionPaths(condition).filter(path => !pathResolvable(path, context)).map(path => `条件里的变量「${path}」不存在`);
}

function validateOption(def: EventDefinition, option: CardOptionSpec, index: number, context: Context, push: (issue: EventIssue) => void): void {
  const error = (message: string) => push({ key: def.key, option: index, level: 'error', message });
  if (!option.label?.trim()) error('选项没有文字');
  if (option.effect && (option.effect.statId || option.effect.resourcePath)) {
    const legacy: CardEffectSpec = option.effect.resourcePath ? { resource: option.effect.resourcePath, delta: option.effect.delta } : { stat: option.effect.statId!, delta: option.effect.delta };
    const issue = effectIssue(legacy, context);
    if (issue) error(issue);
  }
  for (const effect of option.effects ?? []) {
    const issue = effectIssue(effect, context);
    if (issue) error(issue);
  }
  if (option.check) {
    const issue = checkStat(option.check.stat, context);
    if (issue) error(issue);
    const dc = Number(option.check.dc);
    if (!Number.isFinite(dc) || dc < 2 || dc > 30) error(`检定难度 ${String(option.check.dc)} 不在 2~30 之间`);
    if (!option.success && !option.failure) push({ key: def.key, option: index, level: 'warning', message: '有检定但成功和失败没有区别' });
  }
  for (const [label, outcome] of [['成功', option.success], ['失败', option.failure]] as const) {
    if (!outcome) continue;
    for (const effect of outcome.effects ?? []) {
      const issue = effectIssue(effect, context);
      if (issue) error(`${label}：${issue}`);
    }
    if (outcome.next && !context.findCard(outcome.next.split('/').pop()!, outcome.next.includes('/') ? outcome.next.slice(0, outcome.next.lastIndexOf('/')) : def.packId)) {
      error(`${label}后的后续事件「${outcome.next}」不存在`);
    }
  }
  if ((option.success || option.failure) && !option.check) push({ key: def.key, option: index, level: 'warning', message: '写了成功/失败分支但没有检定，分支不会生效' });
  if (option.next && !context.findCard(option.next.split('/').pop()!, option.next.includes('/') ? option.next.slice(0, option.next.lastIndexOf('/')) : def.packId)) {
    error(`后续事件「${option.next}」不存在`);
  }
  for (const issue of conditionIssues(option.requires, context)) error(`可选条件：${issue}`);
}

function resourceIssue(key: string, context: Context): string | undefined {
  const config = context.host.configOf<ResourcesModuleConfig>('resources')?.config;
  if (!config) return `物资「${key}」需要启用物资模块`;
  return config.resources.some(item => item.id === key || item.name === key) ? undefined : `物资「${key}」在这个世界不存在`;
}

/** 规则节点工作流：节点类型必须存在；属性 key、物资 id、后续卡、监听的事件类型必须是本世界有的。 */
function validateWorkflow(def: EventDefinition, context: Context, push: (issue: EventIssue) => void): void {
  const domainEvents = new Set(context.host.domainEvents().map(spec => spec.type));
  for (const node of def.workflow?.nodes ?? []) {
    const label = node.label || node.typeId;
    const error = (message: string) => push({ key: def.key, level: 'error', message: `节点「${label}」：${message}` });
    if (!getNodeExecutor(node.typeId)) { error(`未知的节点类型 ${node.typeId}`); continue; }
    const values = node.widgetValues ?? {};
    const stat = typeof values.stat_key === 'string' ? values.stat_key : '';
    if (/\.(check_stat|modify_stat|get_stat)$/.test(node.typeId)) {
      const issue = checkStat(stat, context);
      if (issue) error(issue);
    }
    const resource = typeof values.resource_key === 'string' ? values.resource_key.trim() : '';
    if (/\.(check_resource|modify_resource|get_resource)$/.test(node.typeId)) {
      const issue = resource ? resourceIssue(resource, context) : '缺少物资 id';
      if (issue) error(issue);
    }
    if (node.typeId === 'actions.add_event') {
      const eventId = typeof values.event_id === 'string' ? values.event_id.trim() : '';
      const packId = typeof values.event_pack_id === 'string' && values.event_pack_id ? values.event_pack_id : undefined;
      if (!eventId) error('缺少事件 id');
      else if (!context.findCard(eventId, packId)) error(`弹出的事件「${eventId}」不存在`);
    }
    if (node.typeId === 'triggers.world_event') {
      const type = typeof values.match_type === 'string' ? values.match_type.trim() : '';
      if (type && !domainEvents.has(type) && !LEGACY_SIGNALS.has(type)) {
        push({ key: def.key, level: 'warning', message: `节点「${label}」：监听的事件「${type}」在这个世界不会发生` });
      }
    }
  }
}

/** 旧节点工作流认识的事件（由新领域事件转换而来，见 events/module legacySignals）。 */
const LEGACY_SIGNALS = new Set(['choice_made', 'scheduled_tick']);

/** 校验世界（及已加载事件包）的全部事件；返回问题列表，没有问题时为空数组。 */
export function validateEventCatalog(world: WorldDef | undefined, options: { catalog?: EventCatalog; state?: GameState } = {}): EventIssue[] {
  const catalog = options.catalog ?? getEventCatalog(world);
  const config = indexCatalog(catalog);
  const base = options.state ?? createDefaultGameState();
  const host = createGameplayHost(world, base);
  const context: Context = { world, host, state: host.prepare(base), findCard: config.findCard };
  const issues: EventIssue[] = [];
  const push = (issue: EventIssue) => issues.push(issue);
  for (const def of catalog.definitions) {
    if (def.kind === 'card') cardOptions(def).forEach((option, index) => validateOption(def, option, index, context, push));
    if (def.workflow) validateWorkflow(def, context, push);
    for (const issue of conditionIssues(def.trigger.when, context)) push({ key: def.key, level: 'error', message: `触发条件：${issue}` });
  }
  return issues;
}
