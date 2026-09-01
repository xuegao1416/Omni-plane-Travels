import type {
  GameplayChange,
  GameplayComparator,
  GameplayCondition,
  GameplayEffect,
  GameplayEvent,
  GameplayEventInput,
  GameplayExecutionContext,
  GameplayExecutionResult,
  GameplayValue,
  GameplayLiteral,
  GameplayLogEntry,
  GameplayRuntimeState,
  GameplayStateRoot,
  GameplayTransaction,
  GameplayStatModifier,
  GameplayStatRuntime,
  GameplaySurvivalRuntime,
  GameplayBusinessRuntime,
} from './types';

export type {
  GameplayChange,
  GameplayCondition,
  GameplayEffect,
  GameplayEvent,
  GameplayEventInput,
  GameplayExecutionContext,
  GameplayExecutionResult,
  GameplayRuntimeState,
  GameplayStateRoot,
  GameplayTransaction,
  GameplayStatModifier,
  GameplayStatRuntime,
  GameplaySurvivalRuntime,
  GameplayBusinessRuntime,
} from './types';

export const GAMEPLAY_SCHEMA_VERSION = 1;
const MAX_LOGS = 200;
const MAX_EVENT_HISTORY = 200;
const MAX_PENDING_EVENTS = 100;
const MAX_SCHEDULED_EVENTS = 100;
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function clone<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function splitSafePath(path: string): string[] | null {
  const parts = path.split('.').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some(part => DANGEROUS_PATH_SEGMENTS.has(part))) return null;
  return parts;
}

export function getGameplayPath(root: unknown, path: string): unknown {
  const parts = splitSafePath(path);
  if (!parts) return undefined;
  let current = root;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getParentForPath(root: GameplayStateRoot, path: string, create: boolean): {
  parent: Record<string, unknown>;
  key: string;
} | null {
  const parts = splitSafePath(path);
  if (!parts) return null;
  let current = root as Record<string, unknown>;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    const next = current[part];
    if (next == null) {
      if (!create) return null;
      current[part] = {};
      current = current[part] as Record<string, unknown>;
      continue;
    }
    if (typeof next !== 'object' || Array.isArray(next)) return null;
    current = next as Record<string, unknown>;
  }
  return { parent: current, key: parts.at(-1)! };
}

export function setGameplayPath(root: GameplayStateRoot, path: string, value: unknown, create = true): boolean {
  const target = getParentForPath(root, path, create);
  if (!target) return false;
  target.parent[target.key] = clone(value);
  return true;
}

function isPlainGameplayRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Convert an already-normalized state transition into kernel effects.
 * Arrays and scalar values are replaced as a unit; plain objects are diffed
 * recursively so a chat update does not copy the entire save into one log.
 */
export function createGameplayStateDiff(
  before: GameplayStateRoot,
  after: GameplayStateRoot,
): GameplayEffect[] {
  const effects: GameplayEffect[] = [];
  const visit = (left: unknown, right: unknown, path: string): void => {
    if (Object.is(left, right)) return;
    if (isPlainGameplayRecord(left) && isPlainGameplayRecord(right)) {
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) visit(left[key], right[key], path ? `${path}.${key}` : key);
      return;
    }
    if (right === undefined) {
      if (left !== undefined) effects.push({ remove: { path } });
      return;
    }
    effects.push({ set: { path, value: clone(right) as GameplayValue } });
  };
  visit(before, after, '');
  return effects;
}

export function removeGameplayPath(root: GameplayStateRoot, path: string): boolean {
  const target = getParentForPath(root, path, false);
  if (!target || !(target.key in target.parent)) return false;
  delete target.parent[target.key];
  return true;
}

export function compareGameplayValues(op: GameplayComparator, left: unknown, right: GameplayLiteral): boolean {
  switch (op) {
    case '==': return left === right;
    case '!=': return left !== right;
    case '>': return Number(left) > Number(right);
    case '>=': return Number(left) >= Number(right);
    case '<': return Number(left) < Number(right);
    case '<=': return Number(left) <= Number(right);
    case 'in': return Array.isArray(right) && right.includes(left as never);
    case 'contains':
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      if (Array.isArray(left)) return left.includes(right as never);
      return false;
  }
}

function eventMatches(
  actual: GameplayEventInput,
  expected: Extract<GameplayCondition, { event: unknown }>['event'],
): boolean {
  if (actual.type !== expected.type) return false;
  if (!expected.where) return true;
  if (!actual.payload) return false;
  return Object.entries(expected.where).every(([key, value]) => actual.payload?.[key] === value);
}

export function evaluateGameplayCondition(
  condition: GameplayCondition,
  state: GameplayStateRoot,
  events: readonly GameplayEventInput[] = [],
): boolean {
  if ('all' in condition) return condition.all.every(item => evaluateGameplayCondition(item, state, events));
  if ('any' in condition) return condition.any.some(item => evaluateGameplayCondition(item, state, events));
  if ('not' in condition) return !evaluateGameplayCondition(condition.not, state, events);
  if ('state' in condition) {
    return compareGameplayValues(condition.state.op, getGameplayPath(state, condition.state.path), condition.state.value);
  }
  return events.some(event => eventMatches(event, condition.event));
}

export function createDefaultGameplayRuntime(): GameplayRuntimeState {
  return {
    schemaVersion: GAMEPLAY_SCHEMA_VERSION,
    sequence: 0,
    pendingEvents: [],
    eventHistory: [],
    scheduledEvents: [],
    logs: [],
    appliedMigrations: [],
    settlementKeys: {},
    stat: { modifiers: {}, base: {}, derived: {} },
    survival: { unlockedRecipes: [], statuses: {} },
    business: { inventory: {}, productionCycles: {} },
  };
}

export function ensureGameplayRuntime(state: GameplayStateRoot): GameplayRuntimeState {
  const existing = state.gameplay;
  if (!existing || typeof existing !== 'object') {
    state.gameplay = createDefaultGameplayRuntime();
    return state.gameplay;
  }
  existing.schemaVersion = Number.isInteger(existing.schemaVersion) ? existing.schemaVersion : 0;
  existing.sequence = Number.isInteger(existing.sequence) && existing.sequence >= 0 ? existing.sequence : 0;
  if (!Array.isArray(existing.pendingEvents)) existing.pendingEvents = [];
  if (!Array.isArray(existing.eventHistory)) existing.eventHistory = [];
  if (!Array.isArray(existing.scheduledEvents)) existing.scheduledEvents = [];
  if (!Array.isArray(existing.logs)) existing.logs = [];
  if (!Array.isArray(existing.appliedMigrations)) existing.appliedMigrations = [];
  if (!existing.settlementKeys || typeof existing.settlementKeys !== 'object') existing.settlementKeys = {};
  if (!existing.stat || typeof existing.stat !== 'object') existing.stat = { modifiers: {}, base: {}, derived: {} };
  if (!existing.stat.modifiers || typeof existing.stat.modifiers !== 'object') existing.stat.modifiers = {};
  if (!existing.stat.base || typeof existing.stat.base !== 'object') existing.stat.base = {};
  if (!existing.stat.derived || typeof existing.stat.derived !== 'object') existing.stat.derived = {};
  if (!existing.survival || typeof existing.survival !== 'object') existing.survival = { unlockedRecipes: [], statuses: {} };
  if (!Array.isArray(existing.survival.unlockedRecipes)) existing.survival.unlockedRecipes = [];
  if (!existing.survival.statuses || typeof existing.survival.statuses !== 'object') existing.survival.statuses = {};
  if (!existing.business || typeof existing.business !== 'object') existing.business = { inventory: {}, productionCycles: {} };
  if (!existing.business.inventory || typeof existing.business.inventory !== 'object') existing.business.inventory = {};
  if (!existing.business.productionCycles || typeof existing.business.productionCycles !== 'object') existing.business.productionCycles = {};
  return existing;
}

function buildEvent(
  input: GameplayEventInput,
  sequence: number,
  index: number,
  transaction: GameplayTransaction,
  context: GameplayExecutionContext,
): GameplayEvent {
  return {
    ...clone(input),
    id: `gameplay-event-${sequence}-${index + 1}`,
    tick: context.tick,
    sequence,
    source: transaction.source,
    moduleId: transaction.moduleId,
    transactionId: transaction.id,
  };
}

function appendLog(runtime: GameplayRuntimeState, log: GameplayLogEntry): void {
  runtime.logs.push(log);
  if (runtime.logs.length > MAX_LOGS) runtime.logs = runtime.logs.slice(-MAX_LOGS);
}

function finishResult<TState extends GameplayStateRoot>(
  state: TState,
  transaction: GameplayTransaction,
  context: GameplayExecutionContext,
  sequence: number,
  status: GameplayExecutionResult<TState>['status'],
  changes: GameplayChange[],
  events: GameplayEvent[],
  warnings: string[],
  reason?: string,
): GameplayExecutionResult<TState> {
  const runtime = ensureGameplayRuntime(state);
  const log: GameplayLogEntry = {
    id: `gameplay-log-${sequence}`,
    sequence,
    tick: context.tick,
    transactionId: transaction.id,
    moduleId: transaction.moduleId,
    source: transaction.source,
    label: transaction.label,
    status,
    reason,
    changes,
    eventIds: events.map(event => event.id),
    warnings: warnings.length > 0 ? [...warnings] : undefined,
  };
  appendLog(runtime, log);
  return { state, status, reason, changes, events, warnings, log };
}

function isAppendableScalar(value: unknown): value is GameplayScalar {
  return value !== null && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
}

function applyEffect(
  state: GameplayStateRoot,
  effect: GameplayEffect,
  changes: GameplayChange[],
  eventInputs: GameplayEventInput[],
  runtime: GameplayRuntimeState,
  transaction: GameplayTransaction,
  context: GameplayExecutionContext,
  sequence: number,
  warnings: string[],
  bestEffort = false,
): void {
  if ('set' in effect) {
    const before = clone(getGameplayPath(state, effect.set.path));
    if (!setGameplayPath(state, effect.set.path, effect.set.value)) throw new Error(`无法写入路径 ${effect.set.path}`);
    changes.push({ path: effect.set.path, operation: 'set', before, after: clone(effect.set.value) });
    return;
  }
  if ('add' in effect) {
    const current = getGameplayPath(state, effect.add.path);
    const shouldCreate = bestEffort || effect.add.create === true;
    if (current === undefined && !shouldCreate) throw new Error(`数值路径不存在：${effect.add.path}`);
    const before = current === undefined ? 0 : Number(current);
    if (!Number.isFinite(before) || !Number.isFinite(effect.add.delta)) throw new Error(`数值路径无效：${effect.add.path}`);
    let after = before + effect.add.delta;
    if (effect.add.min !== undefined) after = Math.max(effect.add.min, after);
    if (effect.add.max !== undefined) after = Math.min(effect.add.max, after);
    if (!setGameplayPath(state, effect.add.path, after, shouldCreate)) throw new Error(`无法写入路径 ${effect.add.path}`);
    changes.push({ path: effect.add.path, operation: 'add', before, after });
    return;
  }
  if ('append' in effect) {
    const rawCurrent = getGameplayPath(state, effect.append.path);
    const shouldCreate = bestEffort || effect.append.create === true;
    let current: unknown[] | undefined;
    if (rawCurrent === undefined || rawCurrent === null) {
      if (!shouldCreate) throw new Error(`数组路径不存在：${effect.append.path}`);
      current = undefined;
    } else if (Array.isArray(rawCurrent)) {
      current = rawCurrent;
    } else if (bestEffort && isAppendableScalar(rawCurrent)) {
      // AI 经常把原本是标量的字段当成数组来追加；bestEffort 下自动包装成数组
      current = [rawCurrent];
      warnings.push(`路径 ${effect.append.path} 原值为标量，已自动转为数组`);
    } else {
      throw new Error(`路径不是数组：${effect.append.path}`);
    }
    const before = clone(current ?? []);
    const next = [...(current ?? []), clone(effect.append.value)];
    const limited = effect.append.limit && effect.append.limit > 0 ? next.slice(-effect.append.limit) : next;
    if (!setGameplayPath(state, effect.append.path, limited, shouldCreate)) throw new Error(`无法写入路径 ${effect.append.path}`);
    changes.push({ path: effect.append.path, operation: 'append', before, after: clone(limited) });
    return;
  }
  if ('remove' in effect) {
    const before = clone(getGameplayPath(state, effect.remove.path));
    if (before === undefined) {
      warnings.push(`删除路径不存在，已跳过：${effect.remove.path}`);
      return;
    }
    if (!removeGameplayPath(state, effect.remove.path)) throw new Error(`无法删除路径 ${effect.remove.path}`);
    changes.push({ path: effect.remove.path, operation: 'remove', before, after: undefined });
    return;
  }
  if ('emit' in effect) {
    eventInputs.push(effect.emit);
    return;
  }
  const dueTick = context.tick + Math.max(1, Math.trunc(effect.schedule.after));
  const event = buildEvent(effect.schedule.event, sequence, runtime.scheduledEvents.length, transaction, {
    ...context,
    tick: dueTick,
  });
  runtime.scheduledEvents.push({ dueTick, event });
  if (runtime.scheduledEvents.length > MAX_SCHEDULED_EVENTS) {
    runtime.scheduledEvents = runtime.scheduledEvents.slice(-MAX_SCHEDULED_EVENTS);
    warnings.push('延迟事件超过容量上限，已保留最新条目');
  }
}

/**
 * Execute one gameplay transaction against a cloned state.
 * 默认严格模式：任一 effect 失败即回滚全部 costs/effects/rewards。
 * 当 context.bestEffort 为 true 时（如 AI 变量更新），单个 effect/cost 失败仅记录警告，
 * 不影响其余内容继续应用。
 */
export function executeGameplayTransaction<TState extends GameplayStateRoot>(
  stateIn: TState,
  transaction: GameplayTransaction,
  context: GameplayExecutionContext,
): GameplayExecutionResult<TState> {
  const state = clone(stateIn);
  const runtime = ensureGameplayRuntime(state);
  runtime.schemaVersion = GAMEPLAY_SCHEMA_VERSION;
  runtime.sequence += 1;
  const sequence = runtime.sequence;
  const changes: GameplayChange[] = [];
  const warnings: string[] = [];

  if (transaction.moduleId && context.enabledModules && !context.enabledModules.includes(transaction.moduleId)) {
    return finishResult(state, transaction, context, sequence, 'blocked', [], [], warnings, `模块 ${transaction.moduleId} 未启用`);
  }

  const eventsForConditions = [...(context.events ?? []), ...runtime.pendingEvents];
  if (!(transaction.conditions ?? []).every(condition => evaluateGameplayCondition(condition, state, eventsForConditions))) {
    return finishResult(state, transaction, context, sequence, 'blocked', [], [], warnings, '条件未满足');
  }

  for (const cost of transaction.costs ?? []) {
    const available = Number(getGameplayPath(state, cost.path));
    if (!Number.isFinite(available) || !Number.isFinite(cost.amount) || cost.amount < 0 || available < cost.amount) {
      const label = cost.label || cost.id || cost.path;
      return finishResult(state, transaction, context, sequence, 'blocked', [], [], warnings, `${label}不足`);
    }
  }

  try {
    for (const cost of transaction.costs ?? []) {
      const applyOneCost = () => {
        const before = Number(getGameplayPath(state, cost.path));
        const after = before - cost.amount;
        if (!setGameplayPath(state, cost.path, after, false)) throw new Error(`无法扣除消耗 ${cost.path}`);
        changes.push({ path: cost.path, operation: 'cost', before, after, label: cost.label });
      };
      if (context.bestEffort) {
        try { applyOneCost(); } catch (err) { warnings.push(err instanceof Error ? err.message : String(err)); }
      } else {
        applyOneCost();
      }
    }

    const eventInputs = [...(transaction.events ?? [])];
    const effects = [
      ...(transaction.effects ?? []),
      ...(transaction.rewards ?? []).flatMap(reward => reward.effects),
    ];
    for (const effect of effects) {
      if (context.bestEffort) {
        try {
          applyEffect(state, effect, changes, eventInputs, runtime, transaction, context, sequence, warnings, true);
        } catch (err) {
          warnings.push(err instanceof Error ? err.message : String(err));
        }
      } else {
        applyEffect(state, effect, changes, eventInputs, runtime, transaction, context, sequence, warnings, false);
      }
    }

    const events = eventInputs.map((input, index) => buildEvent(input, sequence, index, transaction, context));
    runtime.pendingEvents.push(...events);
    runtime.eventHistory.push(...events);
    if (runtime.pendingEvents.length > MAX_PENDING_EVENTS) runtime.pendingEvents = runtime.pendingEvents.slice(-MAX_PENDING_EVENTS);
    if (runtime.eventHistory.length > MAX_EVENT_HISTORY) runtime.eventHistory = runtime.eventHistory.slice(-MAX_EVENT_HISTORY);

    return finishResult(state, transaction, context, sequence, 'applied', changes, events, warnings);
  } catch (error) {
    const failedState = clone(stateIn);
    const failedRuntime = ensureGameplayRuntime(failedState);
    failedRuntime.schemaVersion = GAMEPLAY_SCHEMA_VERSION;
    failedRuntime.sequence = sequence;
    return finishResult(
      failedState,
      transaction,
      context,
      sequence,
      'failed',
      [],
      [],
      warnings,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function advanceGameplayEvents<TState extends GameplayStateRoot>(
  stateIn: TState,
  tick: number,
): { state: TState; events: GameplayEvent[] } {
  const state = clone(stateIn);
  const runtime = ensureGameplayRuntime(state);
  const due = runtime.scheduledEvents
    .filter(item => item.dueTick <= tick)
    .sort((left, right) => left.dueTick - right.dueTick || left.event.sequence - right.event.sequence);
  runtime.scheduledEvents = runtime.scheduledEvents.filter(item => item.dueTick > tick);
  const events = due.map(item => ({ ...item.event, tick: item.dueTick }));
  runtime.pendingEvents.push(...events);
  runtime.eventHistory.push(...events);
  if (runtime.pendingEvents.length > MAX_PENDING_EVENTS) runtime.pendingEvents = runtime.pendingEvents.slice(-MAX_PENDING_EVENTS);
  if (runtime.eventHistory.length > MAX_EVENT_HISTORY) runtime.eventHistory = runtime.eventHistory.slice(-MAX_EVENT_HISTORY);
  return { state, events };
}

export function consumeGameplayEvents<TState extends GameplayStateRoot>(
  stateIn: TState,
  predicate: (event: GameplayEvent) => boolean = () => true,
): { state: TState; events: GameplayEvent[] } {
  const state = clone(stateIn);
  const runtime = ensureGameplayRuntime(state);
  const events = runtime.pendingEvents.filter(predicate);
  const consumedIds = new Set(events.map(event => event.id));
  runtime.pendingEvents = runtime.pendingEvents.filter(event => !consumedIds.has(event.id));
  return { state, events };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

/**
 * Apply a compensating transaction for one previously applied transaction.
 * The current value of every changed path must still equal the value written by
 * the original transaction. This prevents an old undo from overwriting newer
 * gameplay and keeps event queues/history aligned with state changes.
 */
export function revertGameplayTransaction<TState extends GameplayStateRoot>(
  stateIn: TState,
  transactionId: string,
  context: GameplayExecutionContext,
): GameplayExecutionResult<TState> {
  const state = clone(stateIn);
  const runtime = ensureGameplayRuntime(state);
  const target = [...runtime.logs].reverse().find(log => log.transactionId === transactionId && log.status === 'applied');
  const sequence = runtime.sequence + 1;
  runtime.sequence = sequence;
  const transaction: GameplayTransaction = {
    id: `revert:${transactionId}:${sequence}`,
    moduleId: target?.moduleId,
    source: 'system:revert',
    label: `撤销 ${target?.label ?? transactionId}`,
  };
  if (!target) return finishResult(state, transaction, context, sequence, 'blocked', [], [], [], '事务不存在或已撤销');

  const uniqueChanges = Array.from(target.changes.reduce((map, change) => {
    const existing = map.get(change.path);
    if (!existing) map.set(change.path, { ...change });
    else existing.after = change.after;
    return map;
  }, new Map<string, GameplayChange>()).values());
  for (const change of [...uniqueChanges].reverse()) {
    const current = getGameplayPath(state, change.path);
    if (!valuesEqual(current, change.after)) {
      return finishResult(state, transaction, context, sequence, 'blocked', [], [], [], `事务已被后续变化覆盖：${change.path}`);
    }
  }

  const changes: GameplayChange[] = [];
  for (const change of [...uniqueChanges].reverse()) {
    const before = clone(getGameplayPath(state, change.path));
    if (change.before === undefined) removeGameplayPath(state, change.path);
    else if (!setGameplayPath(state, change.path, change.before, true)) {
      return finishResult(stateIn, transaction, context, sequence, 'failed', [], [], [], `无法恢复路径 ${change.path}`);
    }
    changes.push({ path: change.path, operation: 'set', before, after: clone(change.before), label: `撤销：${change.label ?? ''}` });
  }

  const eventIds = new Set(target.eventIds);
  runtime.pendingEvents = runtime.pendingEvents.filter(event => event.transactionId !== transactionId && !eventIds.has(event.id));
  runtime.eventHistory = runtime.eventHistory.filter(event => event.transactionId !== transactionId && !eventIds.has(event.id));
  runtime.scheduledEvents = runtime.scheduledEvents.filter(item => item.event.transactionId !== transactionId && !eventIds.has(item.event.id));
  target.status = 'reverted';
  target.revertedBy = transaction.id;
  return finishResult(state, transaction, context, sequence, 'applied', changes, [], [], undefined);
}
