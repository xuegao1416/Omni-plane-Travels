/**
 * 事件目录：把世界内置事件与已安装事件包编译成统一的事件定义。
 *
 * 目录由游戏界面在进入世界、切换本局事件包时加载（loadEventCatalog），事件导演同步读取。
 * 没写触发器、也没被任何规则 addEvent 引用的卡片进入节奏牌堆，因此所有事件卡都会在游玩中出现。
 * 规则动作在触发时才按当前变量注册表翻译，目录本身不依赖存档。
 */
import type { WorldDef } from '../data/worlds-schema';
import type { Action, CardWorkflowDefinition, EventRule, PeriodicRule, RuleFile } from '../modules/schema';
import type { WorkflowDefinition } from '../modules/workflowSchema';
import type { CoreCondition } from '../core/conditions';
import { gameplayConditionToCore } from '../core/legacy';
import { bumpGameplayGeneration } from '../core/generation';
import type { EventCatalog, EventDefinition, TriggerSpec } from './types';

/** 卡片触发器的写法（世界定义 events[].trigger 与事件包 schema/triggers.json 共用）。 */
export type TriggerInput = Partial<TriggerSpec> & { once?: boolean; cooldownTurns?: number; priority?: number; description?: string };

interface EmbeddedEventEntry {
  id: string;
  name: string;
  workflow?: CardWorkflowDefinition;
  trigger?: TriggerInput;
}

export interface RuntimePackLike {
  id: string;
  manifest: { name?: string; worldId?: string; permissions?: string[] };
  files: Record<string, string>;
}

interface CardSource {
  packId: string;
  id: string;
  name: string;
  workflow: CardWorkflowDefinition;
  trigger?: TriggerInput;
  source: 'world' | 'user';
  permissions?: string[];
}

const catalogs = new Map<string, EventCatalog>();
const worldCatalogs = new WeakMap<WorldDef, EventCatalog>();
const listeners = new Set<(worldId: string) => void>();

function eventTypesIn(condition: unknown, out: string[] = []): string[] {
  if (!condition || typeof condition !== 'object') return out;
  const value = condition as Record<string, unknown>;
  if (value.event && typeof value.event === 'object' && typeof (value.event as { type?: unknown }).type === 'string') out.push((value.event as { type: string }).type);
  for (const key of ['all', 'any']) if (Array.isArray(value[key])) for (const item of value[key] as unknown[]) eventTypesIn(item, out);
  if (value.not) eventTypesIn(value.not, out);
  return out;
}

function toCondition(raw: unknown): CoreCondition | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  try {
    return gameplayConditionToCore(raw as never);
  } catch {
    return raw as CoreCondition;
  }
}

function normalizeTrigger(raw: TriggerInput | undefined, fallback: string[]): TriggerSpec {
  const on = Array.isArray(raw?.on) && raw!.on.length ? raw!.on.map(String) : fallback;
  const when = raw?.when ? toCondition(raw.when) : undefined;
  return {
    on,
    ...(when ? { when } : {}),
    ...(raw?.chance !== undefined ? { chance: Math.min(1, Math.max(0, Number(raw.chance) || 0)) } : {}),
    ...(raw?.everyTurns ? { everyTurns: Math.max(1, Math.trunc(Number(raw.everyTurns))) } : {}),
    ...(raw?.offsetTurns ? { offsetTurns: Math.max(0, Math.trunc(Number(raw.offsetTurns))) } : {}),
    ...(raw?.weight !== undefined ? { weight: Math.max(0, Number(raw.weight) || 0) } : {}),
  };
}

/** 事件包安全上限（与旧规则引擎一致）：每包规则数、单规则动作数、条件树深。 */
export const RULE_LIMITS = { maxRulesPerPack: 128, maxActionsPerRule: 16, maxConditionDepth: 6 } as const;

const ACTION_KINDS = new Set(['set', 'addEvent', 'requestCombat', 'modifyResource', 'scheduleTick']);

function conditionDepth(condition: unknown, depth = 1): number {
  if (!condition || typeof condition !== 'object') return depth;
  const value = condition as Record<string, unknown>;
  const children = [...(Array.isArray(value.all) ? value.all : []), ...(Array.isArray(value.any) ? value.any : []), ...(value.not ? [value.not] : [])];
  return children.reduce<number>((max, child) => Math.max(max, conditionDepth(child, depth + 1)), depth);
}

function checkedActions(packId: string, ruleId: string, actions: readonly Action[] | undefined, warnings: string[]): Action[] {
  const known = (actions ?? []).filter(action => {
    const kind = action && typeof action === 'object' ? Object.keys(action)[0] : undefined;
    if (kind && ACTION_KINDS.has(kind)) return true;
    warnings.push(`[${packId}] 规则 ${ruleId} 含无法识别的动作，已忽略`);
    return false;
  });
  if (known.length > RULE_LIMITS.maxActionsPerRule) {
    warnings.push(`[${packId}] 规则 ${ruleId} 动作数 ${known.length} 超过上限 ${RULE_LIMITS.maxActionsPerRule}，只保留前 ${RULE_LIMITS.maxActionsPerRule} 个`);
  }
  return known.slice(0, RULE_LIMITS.maxActionsPerRule);
}

function ruleDefinitions(packId: string, rules: readonly EventRule[], periodic: readonly PeriodicRule[], source: 'world' | 'user', warnings: string[], permissions?: string[]): EventDefinition[] {
  const out: EventDefinition[] = [];
  if (rules.length > RULE_LIMITS.maxRulesPerPack) warnings.push(`[${packId}] 规则数 ${rules.length} 超过上限 ${RULE_LIMITS.maxRulesPerPack}，只加载前 ${RULE_LIMITS.maxRulesPerPack} 条`);
  if (periodic.length > RULE_LIMITS.maxRulesPerPack) warnings.push(`[${packId}] 周期规则数 ${periodic.length} 超过上限 ${RULE_LIMITS.maxRulesPerPack}，只加载前 ${RULE_LIMITS.maxRulesPerPack} 条`);
  for (const rule of rules.slice(0, RULE_LIMITS.maxRulesPerPack)) {
    if (!rule?.id) continue;
    if (conditionDepth(rule.when) > RULE_LIMITS.maxConditionDepth) {
      warnings.push(`[${packId}] 规则 ${rule.id} 条件树深超过 ${RULE_LIMITS.maxConditionDepth} 层，已停用`);
      continue;
    }
    const events = eventTypesIn(rule.when);
    const when = toCondition(rule.when);
    out.push({
      key: `${packId}/${rule.id}`,
      packId,
      eventId: rule.id,
      name: rule.id,
      kind: 'rule',
      source,
      trigger: { on: events.length ? [...new Set(events)] : ['turn.ended'], ...(when ? { when } : {}) },
      once: rule.once === true,
      cooldownTurns: Math.max(0, Math.trunc(Number(rule.cooldownTicks) || 0)),
      priority: Number(rule.priority) || 0,
      actions: checkedActions(packId, rule.id, rule.then, warnings),
      ...(permissions ? { permissions } : {}),
    });
  }
  for (const rule of periodic.slice(0, RULE_LIMITS.maxRulesPerPack)) {
    if (!rule?.id) continue;
    if (conditionDepth(rule.when) > RULE_LIMITS.maxConditionDepth) {
      warnings.push(`[${packId}] 周期规则 ${rule.id} 条件树深超过 ${RULE_LIMITS.maxConditionDepth} 层，已停用`);
      continue;
    }
    const when = toCondition(rule.when);
    out.push({
      key: `${packId}/${rule.id}`,
      packId,
      eventId: rule.id,
      name: rule.name ?? rule.id,
      kind: 'rule',
      source,
      trigger: {
        on: ['turn.ended'],
        everyTurns: Math.max(1, Math.trunc(Number(rule.intervalTicks) || 1)),
        ...(rule.offsetTicks ? { offsetTurns: Math.max(0, Math.trunc(Number(rule.offsetTicks))) } : {}),
        ...(when ? { when } : {}),
      },
      once: false,
      cooldownTurns: 0,
      priority: 0,
      actions: checkedActions(packId, rule.id, rule.actions, warnings),
      ...(rule.description ? { description: rule.description } : {}),
      ...(permissions ? { permissions } : {}),
    });
  }
  return out;
}

function workflowDefinition(pack: RuntimePackLike, workflow: WorkflowDefinition): EventDefinition {
  const events = (workflow.nodes ?? []).flatMap(node => {
    const typed = node as { typeId?: string; widgetValues?: Record<string, unknown> };
    return typed.typeId === 'triggers.world_event' && typeof typed.widgetValues?.match_type === 'string' && typed.widgetValues.match_type
      ? [typed.widgetValues.match_type]
      : [];
  });
  return {
    key: `${pack.id}/workflow`,
    packId: pack.id,
    eventId: 'workflow',
    name: pack.manifest.name ?? pack.id,
    kind: 'workflow',
    source: 'user',
    // 节点工作流每回合结束时整体运行一次，读取本回合发生的全部事件。
    trigger: { on: ['turn.ended'] },
    once: false,
    cooldownTurns: 0,
    priority: 0,
    workflow,
    permissions: pack.manifest.permissions ?? [],
    ...(events.length ? { description: `监听：${[...new Set(events)].join('、')}` } : {}),
  };
}

/** 被规则或节点工作流 addEvent 引用的卡片（eventId 与 packId/eventId 两种写法）。 */
function referencedCards(definitions: readonly EventDefinition[]): Set<string> {
  const out = new Set<string>();
  const add = (eventId: unknown, packId?: unknown) => {
    if (typeof eventId !== 'string' || !eventId) return;
    out.add(eventId);
    if (typeof packId === 'string' && packId) out.add(`${packId}/${eventId}`);
  };
  for (const def of definitions) {
    for (const action of def.actions ?? []) if ('addEvent' in action) add(action.addEvent.eventId, action.addEvent.eventPackId);
    for (const op of def.program ?? []) if (op.op === 'card') add(op.eventId, op.packId);
    for (const node of def.workflow?.nodes ?? []) {
      const typed = node as { typeId?: string; widgetValues?: Record<string, unknown> };
      if (typed.typeId === 'actions.add_event') add(typed.widgetValues?.event_id, typed.widgetValues?.event_pack_id);
    }
  }
  return out;
}

/** 卡片选项里 `next` 指向的后续卡（它们只作为接续出现，不进随机牌堆）。 */
function followUpCards(cards: readonly CardSource[], out: Set<string>): Set<string> {
  for (const card of cards) {
    for (const node of card.workflow.nodes ?? []) {
      const raw = (node as { widgetValues?: Record<string, unknown> }).widgetValues?.options;
      let options: unknown = raw;
      if (typeof raw === 'string') {
        try { options = JSON.parse(raw); } catch { options = undefined; }
      }
      if (!Array.isArray(options)) continue;
      for (const option of options as Array<Record<string, unknown>>) {
        for (const next of [option?.next, (option?.success as Record<string, unknown> | undefined)?.next, (option?.failure as Record<string, unknown> | undefined)?.next]) {
          if (typeof next !== 'string' || !next) continue;
          out.add(next.includes('/') ? next : `${card.packId}/${next}`);
        }
      }
    }
  }
  return out;
}

function cardDefinitions(cards: readonly CardSource[], referenced: Set<string>): EventDefinition[] {
  return cards.map(card => {
    const trigger = card.trigger;
    const isReferenced = referenced.has(card.id) || referenced.has(`${card.packId}/${card.id}`);
    const fallback = isReferenced ? [] : ['deck'];
    const spec = normalizeTrigger(trigger, fallback);
    const inDeck = spec.on.includes('deck');
    return {
      key: `${card.packId}/${card.id}`,
      packId: card.packId,
      eventId: card.id,
      name: card.name || card.workflow.name || card.id,
      kind: 'card' as const,
      source: card.source,
      trigger: spec,
      once: trigger?.once === true,
      // 牌堆卡默认 6 回合内不重复出现。
      cooldownTurns: Math.max(0, Math.trunc(Number(trigger?.cooldownTurns ?? (inDeck ? 6 : 0)) || 0)),
      priority: Number(trigger?.priority) || 0,
      card: card.workflow,
      ...(trigger?.description || card.workflow.description ? { description: trigger?.description ?? card.workflow.description } : {}),
      ...(card.permissions ? { permissions: card.permissions } : {}),
    };
  });
}

function parseJson<T>(raw: string | undefined): T | undefined {
  if (typeof raw !== 'string') return undefined;
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}

function worldSources(world: WorldDef | undefined, warnings: string[]): { rules: EventDefinition[]; cards: CardSource[] } {
  const rules: EventDefinition[] = [];
  const cards: CardSource[] = [];
  for (const pack of world?.eventPacks ?? []) {
    rules.push(...ruleDefinitions(pack.id, pack.rules ?? [], pack.periodicRules ?? [], 'world', warnings));
    for (const event of pack.events ?? []) {
      const entry = event as EmbeddedEventEntry;
      if (!entry.workflow) continue;
      cards.push({ packId: pack.id, id: entry.id, name: entry.name, workflow: { ...entry.workflow, id: entry.id, name: entry.workflow.name || entry.name }, trigger: entry.trigger, source: 'world' });
    }
  }
  return { rules, cards };
}

function packSources(pack: RuntimePackLike, readCards: (files: Record<string, string>) => CardWorkflowDefinition[], warnings: string[]): { rules: EventDefinition[]; cards: CardSource[] } {
  const permissions = pack.manifest.permissions ?? [];
  const ruleFile = parseJson<RuleFile>(pack.files['schema/rules.json']);
  const workflow = parseJson<WorkflowDefinition>(pack.files['schema/workflow.json']);
  const triggers = parseJson<{ triggers?: Record<string, TriggerInput> }>(pack.files['schema/triggers.json'])?.triggers ?? {};
  const rules = workflow && Array.isArray(workflow.nodes)
    ? [workflowDefinition(pack, workflow)]
    : ruleDefinitions(pack.id, ruleFile?.rules ?? [], ruleFile?.periodicRules ?? [], 'user', warnings, permissions);
  let workflows: CardWorkflowDefinition[] = [];
  try {
    workflows = readCards(pack.files);
  } catch (error) {
    warnings.push(`[${pack.id}] 卡片读取失败：${error instanceof Error ? error.message : String(error)}`);
    workflows = [];
  }
  return {
    rules,
    cards: workflows.map(card => ({ packId: pack.id, id: card.id, name: card.name, workflow: card, trigger: triggers[card.id], source: 'user', permissions })),
  };
}

/** 编译事件定义：先编译规则，再按全局引用关系决定卡片是否进牌堆。 */
export function compileEventCatalog(world: WorldDef | undefined, packs: readonly RuntimePackLike[] = [],
  readCards: (files: Record<string, string>) => CardWorkflowDefinition[] = () => []): { definitions: EventDefinition[]; warnings: string[] } {
  const warnings: string[] = [];
  const sources = [worldSources(world, warnings), ...packs.map(pack => packSources(pack, readCards, warnings))];
  const rules = sources.flatMap(item => item.rules);
  const cards = sources.flatMap(item => item.cards);
  const referenced = followUpCards(cards, referencedCards(rules));
  const seen = new Set<string>();
  const out: EventDefinition[] = [];
  for (const def of [...rules, ...cardDefinitions(cards, referenced)]) {
    if (seen.has(def.key)) {
      warnings.push(`事件 ${def.key} 重复，只保留第一个`);
      continue;
    }
    seen.add(def.key);
    out.push(def);
  }
  return { definitions: out, warnings };
}

export function compileEventDefinitions(world: WorldDef | undefined, packs: readonly RuntimePackLike[] = [],
  readCards: (files: Record<string, string>) => CardWorkflowDefinition[] = () => []): EventDefinition[] {
  return compileEventCatalog(world, packs, readCards).definitions;
}

/** 单个已安装事件包（测试与编辑器预览用；不含跨包引用）。 */
export function compileRuntimePack(pack: RuntimePackLike, readCards: (files: Record<string, string>) => CardWorkflowDefinition[]): EventDefinition[] {
  return compileEventDefinitions(undefined, [pack], readCards);
}

function summarize(definitions: readonly EventDefinition[], packs: number, skipped: number): string {
  const count = (kind: EventDefinition['kind']) => definitions.filter(item => item.kind === kind).length;
  const deck = definitions.filter(item => item.trigger.on.includes('deck')).length;
  return `事件 ${definitions.length} 个（卡片 ${count('card')}，其中随机牌堆 ${deck}；规则 ${count('rule')}；节点工作流 ${count('workflow')}）`
    + `${packs ? `，来自事件包 ${packs} 个` : ''}${skipped ? `，读取失败 ${skipped} 个` : ''}`;
}

/** 当前世界的事件目录：已加载的完整目录，或仅含世界内置事件的同步目录。 */
export function getEventCatalog(world: WorldDef | undefined): EventCatalog {
  const worldId = world?.id ?? '';
  const loaded = catalogs.get(worldId);
  if (loaded) return loaded;
  if (world) {
    const cached = worldCatalogs.get(world);
    if (cached) return cached;
  }
  const { definitions, warnings } = compileEventCatalog(world);
  const catalog: EventCatalog = { worldId, definitions, warnings, summary: `${summarize(definitions, 0, 0)}；已安装事件包尚未加载` };
  if (world) worldCatalogs.set(world, catalog);
  return catalog;
}

export function setEventCatalog(catalog: EventCatalog): void {
  catalogs.set(catalog.worldId, catalog);
  bumpGameplayGeneration();
  for (const listener of listeners) listener(catalog.worldId);
}

export function clearEventCatalog(worldId?: string): void {
  if (worldId === undefined) catalogs.clear();
  else catalogs.delete(worldId);
  bumpGameplayGeneration();
}

export function onEventCatalogChange(listener: (worldId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isDeckEvent(def: EventDefinition): boolean {
  return def.trigger.on.includes('deck');
}

/**
 * 加载世界的完整事件目录：安装世界内置包（供编辑器浏览）→ 取本局启用的包 → 编译。
 * 世界内置事件以世界定义为准（含触发器），已安装副本只用于用户包。
 */
export async function loadEventCatalog(world: WorldDef | undefined, options: { activePackIds?: readonly string[] } = {}): Promise<EventCatalog> {
  const worldId = world?.id ?? '';
  const worldPackIds = new Set((world?.eventPacks ?? []).map(pack => pack.id));
  const packs: RuntimePackLike[] = [];
  let skipped = 0;
  let readCards: (files: Record<string, string>) => CardWorkflowDefinition[] = () => [];
  try {
    const [{ installWorldEventPacks }, { installWorldCardWorkflows }, api, { selectRuntimePacksForWorld }, { readCanonicalEventPack }] = await Promise.all([
      import('../modules/webEventStore'), import('../modules/cardWorldBindings'), import('../modules/eventApi'), import('../modules/eventRuntime'), import('../modules/eventPackFormat'),
    ]);
    readCards = files => [...readCanonicalEventPack(files).workflows];
    if (world) {
      try {
        await installWorldEventPacks(world);
        await installWorldCardWorkflows(world);
      } catch (error) {
        console.warn('[事件] 世界内置事件包安装失败（已跳过）', error);
      }
    }
    let ids = options.activePackIds ? [...options.activePackIds] : undefined;
    if (!ids) {
      try {
        ids = (await api.listPacks(true)).filter(entry => entry.enabled).map(entry => entry.meta.id);
      } catch {
        ids = [];
      }
    }
    const loaded: RuntimePackLike[] = [];
    for (const id of ids) {
      // 世界内置事件以世界定义为准；旧版自动生成的 `world:<id>:rules` 轮播工作流已由节奏牌堆取代。
      if (worldPackIds.has(id) || (worldId && id.startsWith(`world:${worldId}:`))) continue;
      try { loaded.push(await api.getRuntimePack(id) as unknown as RuntimePackLike); } catch { skipped += 1; }
    }
    packs.push(...(selectRuntimePacksForWorld(loaded as never, worldId) as unknown as RuntimePackLike[]));
  } catch (error) {
    console.warn('[事件] 事件包加载失败，仅使用世界内置事件', error);
  }
  const { definitions, warnings } = compileEventCatalog(world, packs, readCards);
  const catalog: EventCatalog = { worldId, definitions, warnings, summary: summarize(definitions, packs.length, skipped) };
  setEventCatalog(catalog);
  return catalog;
}
