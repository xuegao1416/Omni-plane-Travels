/**
 * 事件导演（events 模块）。
 *
 * - 触发：任何领域事件（资源耗尽、交易完成、时间跨日、回合结束……）都会检查监听它的规则与卡片；
 *   规则立即执行效果，卡片进入待处理队列（存档内，读档后仍在）。
 * - 周期规则：每 N 回合在回合结束时执行。
 * - 旧节点工作流：每回合结束时整体运行一次，读取本回合发生的全部事件。
 * - 随机牌堆：没有触发器、也没被规则点名的卡片按节奏在回合结束时抽取（正文之后出现）。
 * - 结算：玩家在卡片上做选择（events.resolveChoice），效果、检定与后续事件在一次操作内完成。
 */
import type { GameState } from '../schema/variables';
import type { DomainEvent, GameplayModule, ModuleHookContext } from '../core/host';
import type { FactSpec } from '../core/facts';
import type { Op } from '../core/ops';
import { evaluateCondition, type EventLike } from '../core/conditions';
import { executeWorkflow } from '../modules/workflowEngine';
import '../modules/nodeExecutors';
import { getEventCatalog, isDeckEvent } from './catalog';
import { actionPermission, pendingActionPermission, pendingActionToOps, ruleActionToOps, withDefaultPack } from './effects';
import { legacyReadView } from './cards';
import { resolveEventChoice, type EventsLookup } from './resolve';
import {
  DEFAULT_PACING, HISTORY_CAP, PACING_CHANCE_CAP, PACING_LABELS, PACING_RULES, QUEUE_CAP, SIGNAL_CAP, isPacingLevel,
  canFire, directorOf, markFired, migrateLegacyEventRuntime, readDirector,
} from './state';
import type { EventCatalog, EventDefinition, PacingLevel } from './types';

export const EVENTS_MODULE_ID = 'events';

export interface EventsConfig extends EventsLookup {
  catalog: EventCatalog;
  byEventId: ReadonlyMap<string, readonly EventDefinition[]>;
  /** 监听领域事件的规则与卡片（按优先级从高到低）。 */
  listeners: readonly EventDefinition[];
  deck: readonly EventDefinition[];
  workflows: readonly EventDefinition[];
}

type Context = ModuleHookContext<EventsConfig>;

const indexes = new WeakMap<EventCatalog, EventsConfig>();

export function indexCatalog(catalog: EventCatalog): EventsConfig {
  const cached = indexes.get(catalog);
  if (cached) return cached;
  const byKey = new Map<string, EventDefinition>();
  const byEventId = new Map<string, EventDefinition[]>();
  const listeners: EventDefinition[] = [];
  const deck: EventDefinition[] = [];
  const workflows: EventDefinition[] = [];
  for (const def of catalog.definitions) {
    byKey.set(def.key, def);
    byEventId.set(def.eventId, [...(byEventId.get(def.eventId) ?? []), def]);
    if (def.kind === 'workflow') {
      if (def.workflow) workflows.push(def);
      continue;
    }
    if (isDeckEvent(def) && def.kind === 'card') deck.push(def);
    if (def.trigger.on.some(type => type !== 'deck')) listeners.push(def);
  }
  listeners.sort((left, right) => right.priority - left.priority);
  const findCard = (eventId: string, packId?: string): EventDefinition | undefined => {
    if (!eventId) return undefined;
    if (packId) {
      const exact = byKey.get(`${packId}/${eventId}`);
      if (exact?.kind === 'card') return exact;
    }
    if (eventId.includes('/')) {
      const exact = byKey.get(eventId);
      if (exact?.kind === 'card') return exact;
    }
    const candidates = (byEventId.get(eventId) ?? []).filter(def => def.kind === 'card');
    return candidates.find(def => def.source === 'world') ?? candidates[0];
  };
  const config: EventsConfig = { catalog, byKey, byEventId, listeners, deck, workflows, findCard };
  indexes.set(catalog, config);
  return config;
}

function typeMatches(pattern: string, type: string): boolean {
  return pattern === '*' || pattern === type || (pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1)));
}

function eventLike(event: DomainEvent): EventLike {
  return { type: event.type, payload: event.payload };
}

function conditionHolds(state: GameState, def: EventDefinition, context: Context): boolean {
  if (!def.trigger.when) return true;
  return evaluateCondition(def.trigger.when, {
    state, facts: context.facts, events: context.events().map(eventLike), rng: context.rng, hourOfDay: context.hourOfDay,
  });
}

export function isCombatBusy(state: GameState): boolean {
  const v3 = state.v3;
  return Boolean(v3?.pendingEncounterRequest || (v3?.combatSession && v3.combatSession.lifecycle !== 'terminal'));
}

function enqueue(state: GameState, def: EventDefinition, context: Context, reason: string): boolean {
  const director = directorOf(state);
  if (director.queue.some(item => item.key === def.key)) return false;
  if (director.queue.length >= QUEUE_CAP) {
    context.warn(`待处理的事件已有 ${QUEUE_CAP} 张，「${def.name}」这次没有加入`);
    return false;
  }
  director.queue.push({ key: def.key, packId: def.packId, eventId: def.eventId, turn: context.turn, reason });
  director.pacing.lastCardTurn = context.turn;
  director.pacing.quietTurns = 0;
  context.emit('events.cardQueued', { key: def.key, eventId: def.eventId, packId: def.packId, reason });
  return true;
}

function compileRule(def: EventDefinition, context: Context): Op[] {
  const out: Op[] = [...(def.program ?? [])];
  for (const action of def.actions ?? []) {
    const permission = actionPermission(action);
    if (def.permissions && permission && !def.permissions.includes(permission)) {
      context.warn(`「${def.name}」缺少权限 ${permission}，跳过了一个动作`);
      continue;
    }
    out.push(...ruleActionToOps(action, context.facts));
  }
  return withDefaultPack(out, def.packId);
}

/** 触发一个事件定义（条件已判定）。返回是否真的生效。 */
function fire(state: GameState, def: EventDefinition, context: Context, reason: string, options: { force?: boolean } = {}): boolean {
  if (def.kind === 'card') {
    if (!enqueue(state, def, context, reason)) return false;
    markFired(def, directorOf(state), context.turn);
  } else if (def.kind === 'rule') {
    // 先记账再执行：效果引发的连锁事件不会让一次性规则重入。
    markFired(def, directorOf(state), context.turn);
    const ops = compileRule(def, context);
    if (ops.length) context.apply(ops, 'event');
  } else if (def.kind === 'workflow' && options.force) {
    runWorkflow(state, def, context, []);
    return true;
  } else {
    return false;
  }
  // 触发记录在导演状态里（fired），不再额外发记账事件，以免大批规则挤占单次事件上限。
  return true;
}

function tryFire(state: GameState, def: EventDefinition, context: Context, reason: string): boolean {
  const director = directorOf(state);
  if (!canFire(def, director, context.turn)) return false;
  if (def.trigger.everyTurns) {
    const elapsed = context.turn - (def.trigger.offsetTurns ?? 0);
    if (elapsed <= 0 || elapsed % def.trigger.everyTurns !== 0) return false;
  }
  if (def.kind === 'card' && director.queue.some(item => item.key === def.key)) return false;
  if (!conditionHolds(state, def, context)) return false;
  if (def.trigger.chance !== undefined && !context.rng.chance(def.trigger.chance)) return false;
  return fire(state, def, context, reason);
}

function bufferSignal(state: GameState, event: DomainEvent): void {
  const director = directorOf(state);
  director.signals = [...director.signals, { type: event.type, payload: { ...event.payload } }].slice(-SIGNAL_CAP);
}

/** 新领域事件 → 旧节点工作流认识的事件形状。 */
function legacySignals(signal: { type: string; payload: Record<string, unknown> }): Array<{ type: string; [key: string]: unknown }> {
  const out: Array<{ type: string; [key: string]: unknown }> = [{ ...signal.payload, type: signal.type }];
  if (signal.type === 'events.resolved') {
    out.push({ type: 'choice_made', card_id: signal.payload.eventId, choice_id: String(signal.payload.option ?? ''), pack_id: signal.payload.packId });
  }
  if (typeof signal.payload.tag === 'string' && signal.payload.tag) {
    out.push({ type: 'scheduled_tick', tag: signal.payload.tag, payload: signal.payload });
  }
  return out;
}

function runWorkflow(state: GameState, def: EventDefinition, context: Context, signals: Array<{ type: string; [key: string]: unknown }>, signalCache = new Map<string, unknown>()): void {
  if (!def.workflow) return;
  let result: ReturnType<typeof executeWorkflow>;
  try {
    result = executeWorkflow(def.workflow, {
      tick: context.turn,
      events: signals,
      permissions: def.permissions ?? ['read_world_state', 'modify_world_state', 'add_card', 'register_tick', 'emit_world_event'],
      gameState: legacyReadView(state, context.facts),
      signalCache,
      // 节点数上限已经约束了工作量；放宽墙钟上限，避免慢设备上结果随机中止。
      limits: { maxWallMs: 250 },
    });
  } catch (error) {
    context.warn(`节点工作流「${def.name}」执行失败：${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (result.aborted) {
    context.warn(`节点工作流「${def.name}」中止：${result.abortReason ?? '超出限制'}`);
    return;
  }
  const ops: Op[] = [];
  for (const action of result.pendingActions) {
    const permission = pendingActionPermission(action);
    if (def.permissions && permission && !def.permissions.includes(permission)) {
      context.warn(`「${def.name}」缺少权限 ${permission}，跳过了一个动作`);
      continue;
    }
    ops.push(...pendingActionToOps(action, context.facts));
  }
  if (!ops.length) return;
  markFired(def, directorOf(state), context.turn);
  context.apply(withDefaultPack(ops, def.packId), 'event');
}

function runWorkflows(state: GameState, context: Context): void {
  const director = directorOf(state);
  const signals = director.signals.flatMap(legacySignals);
  director.signals = [];
  const cache = new Map<string, unknown>();
  for (const def of context.config.workflows) {
    if (!canFire(def, directorOf(state), context.turn)) continue;
    runWorkflow(state, def, context, signals, cache);
  }
}

/** 节奏牌堆：冷场越久越容易出卡，两张卡之间至少隔 gap 回合；有待处理卡片或正在战斗时不抽。 */
function drawFromDeck(state: GameState, context: Context): void {
  const director = directorOf(state);
  const level = director.pacing.level;
  if (level === 'off' || context.config.deck.length === 0) return;
  if (director.queue.length > 0 || isCombatBusy(state)) return;
  const rule = PACING_RULES[level];
  if (context.turn - director.pacing.lastCardTurn < rule.gap) return;
  const chance = Math.min(PACING_CHANCE_CAP, rule.base + rule.step * director.pacing.quietTurns);
  director.pacing.quietTurns += 1;
  if (!context.rng.chance(chance)) return;
  const candidates = context.config.deck.filter(def => canFire(def, director, context.turn) && conditionHolds(state, def, context));
  const index = context.rng.weightedIndex(candidates.map(def => def.trigger.weight ?? 1));
  if (index < 0) return;
  fire(state, candidates[index], context, '随机事件');
}

function onDomainEvent(state: GameState, event: DomainEvent, context: Context): void {
  if (event.type === 'card.requested') {
    const eventId = String(event.payload.eventId ?? '');
    const packId = typeof event.payload.packId === 'string' ? event.payload.packId : undefined;
    const def = context.config.findCard(eventId, packId);
    if (!def) {
      context.warn(`找不到事件卡「${eventId}」`);
      return;
    }
    if (!canFire(def, directorOf(state), context.turn) || !conditionHolds(state, def, context)) return;
    fire(state, def, context, typeof event.payload.reason === 'string' && event.payload.reason ? event.payload.reason : '规则触发');
    return;
  }
  // 自己发出的记账事件不再触发规则（防止自激），玩家的选择结果除外。
  if (event.source === EVENTS_MODULE_ID && event.type !== 'events.resolved') return;
  if (context.config.workflows.length > 0 && event.type !== 'turn.ended') bufferSignal(state, event);
  for (const def of context.config.listeners) {
    if (!def.trigger.on.some(pattern => pattern !== 'deck' && typeMatches(pattern, event.type))) continue;
    tryFire(state, def, context, event.type === 'turn.ended' ? '回合结束' : `事件 ${event.type}`);
  }
  if (event.type === 'turn.ended') {
    runWorkflows(state, context);
    drawFromDeck(state, context);
  }
}

function eventCount(state: GameState, id: string): number {
  const director = readDirector(state);
  return Object.entries(director.fired)
    .filter(([key]) => key === id || key.endsWith(`/${id}`))
    .reduce((sum, [, item]) => sum + item.count, 0);
}

function lastTurn(state: GameState, id: string): number {
  const director = readDirector(state);
  return Object.entries(director.fired)
    .filter(([key]) => key === id || key.endsWith(`/${id}`))
    .reduce((latest, [, item]) => Math.max(latest, item.lastTurn), -1);
}

function eventFacts(config: EventsConfig): FactSpec[] {
  const ids = [...new Set(config.catalog.definitions.map(def => def.eventId))];
  return [
    { id: 'events.pending', module: EVENTS_MODULE_ID, type: 'number', label: '待处理事件数', writable: [],
      read: state => state.eventDirector?.queue?.length ?? 0 },
    { id: 'events.pacing', module: EVENTS_MODULE_ID, type: 'string', label: '随机事件节奏', writable: [],
      description: 'off / low / normal / high', read: state => readDirector(state).pacing.level },
    { id: 'events.count.{id}', module: EVENTS_MODULE_ID, type: 'number', label: '事件「{id}」发生次数', writable: [],
      read: (state, { id }) => eventCount(state, id), enumerate: () => ids.map(id => ({ params: { id } })) },
    { id: 'events.lastTurn.{id}', module: EVENTS_MODULE_ID, type: 'number', label: '事件「{id}」最近发生的回合', writable: [], visibility: 'hidden',
      read: (state, { id }) => lastTurn(state, id) },
  ];
}

function pacingLevel(value: unknown): PacingLevel | undefined {
  return isPacingLevel(value) ? value : undefined;
}

/** 世界的默认随机事件节奏（不写为「偶尔」）。 */
export function worldPacing(world: { eventPacing?: unknown } | undefined): PacingLevel {
  return pacingLevel(world?.eventPacing) ?? DEFAULT_PACING;
}

export const eventsModule: GameplayModule<EventsConfig> = {
  id: EVENTS_MODULE_ID,
  label: '事件',
  order: 90,
  resolveConfig: world => indexCatalog(getEventCatalog(world)),
  facts: eventFacts,
  domainEvents: () => [
    { type: 'events.cardQueued', label: '事件卡进入待处理', payload: 'eventId、packId' },
    { type: 'events.resolved', label: '玩家处理完一张事件卡', payload: 'eventId、option、label、success' },
    { type: 'events.dismissed', label: '玩家跳过事件卡', payload: 'eventId' },
    { type: 'check.rolled', label: '事件卡检定', payload: 'stat、success' },
  ],
  prepare: (state, context) => {
    // 新开局（或从没有事件导演的旧存档读入）时按世界设定的节奏起步；已有的设定（含玩家改过的）保留。
    const fresh = !state.eventDirector;
    const director = directorOf(state);
    if (fresh) director.pacing.level = worldPacing(context.world);
    migrateLegacyEventRuntime(state, context.turn, (eventId, packId) => context.config.findCard(eventId, packId));
  },
  on: { '*': onDomainEvent },
  commands: {
    resolveChoice: (state, args, context) => resolveEventChoice(state, args, context),
    dismiss: (state, args, context) => {
      const director = directorOf(state);
      const key = String(args.key ?? '');
      const entry = director.queue.find(item => item.key === key);
      if (!entry) return { ok: false, reason: '这张事件卡已经处理过了' };
      director.queue = director.queue.filter(item => item.key !== key);
      const name = context.config.byKey.get(key)?.name ?? entry.eventId;
      director.history = [...director.history, { key, name, turn: context.turn, dismissed: true }].slice(-HISTORY_CAP);
      context.emit('events.dismissed', { key, eventId: entry.eventId, packId: entry.packId });
      return { ok: true, message: `已跳过「${name}」` };
    },
    setPacing: (state, args) => {
      const level = pacingLevel(args.level);
      if (!level) return { ok: false, reason: `未知的事件节奏：${String(args.level)}` };
      const director = directorOf(state);
      if (director.pacing.level === level) return { ok: false, reason: `随机事件已经是「${PACING_LABELS[level]}」` };
      director.pacing.level = level;
      return { ok: true, message: `随机事件：${PACING_LABELS[level]}` };
    },
    /** 手动触发（编辑器试玩、旧 EVENT_CARD 广播）：忽略一次性与冷却，仍受队列上限约束。 */
    trigger: (state, args, context) => {
      const key = typeof args.key === 'string' ? args.key : '';
      const eventId = typeof args.eventId === 'string' ? args.eventId : '';
      const packId = typeof args.packId === 'string' && args.packId ? args.packId : undefined;
      const def = (key ? context.config.byKey.get(key) : undefined)
        ?? context.config.findCard(eventId, packId)
        ?? (packId ? context.config.byKey.get(`${packId}/${eventId}`) : undefined);
      if (!def) return { ok: false, reason: `找不到事件「${key || eventId}」` };
      if (def.kind === 'card' && directorOf(state).queue.some(item => item.key === def.key)) return { ok: false, reason: `「${def.name}」已在待处理列表中` };
      if (!fire(state, def, context, String(args.reason ?? '手动触发'), { force: true })) return { ok: false, reason: `「${def.name}」没有生效` };
      return { ok: true, message: `已触发「${def.name}」` };
    },
  },
  summarize: (state, context, audience) => {
    const director = readDirector(state);
    const pending = director.queue.map(item => context.config.byKey.get(item.key)?.name ?? item.eventId);
    if (audience === 'main') {
      if (!pending.length) return undefined;
      return `【待玩家处理的事件】${pending.map(name => `「${name}」`).join('、')}正在等玩家亲自选择。正文不要替玩家做出选择，也不要写出事件的结果；可以自然地描写事件的开端。`;
    }
    if (audience === 'director') {
      const recent = director.history.slice(-5).map(item => `第${item.turn}回合「${item.name}」${item.dismissed ? '（跳过）' : item.choice ? `→${item.choice}` : ''}`);
      return [
        `随机事件节奏：${PACING_LABELS[director.pacing.level]}`,
        pending.length ? `待处理：${pending.join('、')}` : '',
        recent.length ? `最近事件：${recent.join('；')}` : '',
      ].filter(Boolean).join('\n');
    }
    return undefined;
  },
};
