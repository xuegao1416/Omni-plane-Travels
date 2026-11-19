/**
 * 内部事务：本地代码（导演的既定后果、离屏事件、自创模块规则、战斗奖励）把一组效果一次性提交。
 *
 * 与宿主 apply 的区别：不跑模块钩子，可以写任何安全路径（AI 与事件写入仍走宿主的白名单）。
 * 效果用统一效果语言（Op），整体生效或整体不生效；发出的事件放进 gameplay.pendingEvents，
 * 下回合开始时由宿主交给各模块；写入记进 gameplay.logs，变量面板可以按事务撤销。
 */
import type { GameState } from '../schema/variables';
import type { GameplayChange, GameplayCost, GameplayEvent, GameplayEventInput, GameplayLogEntry, GameplayRuntimeState, GameplayStateRoot, GameplayValue } from '../gameplay/types';
import { FactRegistry } from './facts';
import { applyOpsInPlace, type Op } from './ops';
import { Rng, createRngState } from './rng';
import { BOOKKEEPING_PATHS, diffStates } from './diff';
import { GAMEPLAY_SCHEMA_VERSION, ensureGameplayRuntime, getGameplayPath, removeGameplayPath, setGameplayPath } from './state';

const MAX_LOGS = 200;
const MAX_EVENT_HISTORY = 200;
const MAX_PENDING_EVENTS = 100;
const MAX_SCHEDULED_EVENTS = 100;

/** 内部事务用的变量表：任何安全路径按原路径读写。 */
const INTERNAL_FACTS = new FactRegistry([], { anyRoot: true });
/** 日志只记玩法数据；运行时账本（事件队列、日志本身）不进撤销范围。 */
const LOG_IGNORE = [...BOOKKEEPING_PATHS, 'gameplay'];

export interface InternalTransaction {
  id: string;
  /** 记账来源，如 `director:authored`、`combat.result`。 */
  source: string;
  label?: string;
  moduleId?: string;
  /** 默认取 simulationRuntime.tick。 */
  tick?: number;
  /** 先检查付得起，再一起扣除。 */
  costs?: readonly GameplayCost[];
  ops?: readonly Op[];
  events?: readonly GameplayEventInput[];
}

export interface TransactionResult {
  state: GameState;
  status: 'applied' | 'blocked' | 'failed';
  reason?: string;
  changes: GameplayChange[];
  events: GameplayEvent[];
}

function clone<T>(value: T): T {
  return value === undefined || value === null || typeof value !== 'object' ? value : structuredClone(value);
}

function tickOf(state: GameState, tick?: number): number {
  return Math.max(0, Math.trunc(Number(tick ?? state.simulationRuntime?.tick) || 0));
}

function runtimeOf(state: GameState): GameplayRuntimeState {
  return ensureGameplayRuntime(state as GameState & GameplayStateRoot);
}

function appendLog(state: GameState, log: GameplayLogEntry): void {
  const runtime = runtimeOf(state);
  runtime.logs = [...runtime.logs, log].slice(-MAX_LOGS);
}

/** 原子提交一笔内部事务。付不起或任一效果失败时返回原状态。 */
export function commitTransaction(source: GameState, transaction: InternalTransaction): TransactionResult {
  const tick = tickOf(source, transaction.tick);
  for (const cost of transaction.costs ?? []) {
    const available = Number(getGameplayPath(source, cost.path));
    if (!Number.isFinite(available) || !Number.isFinite(cost.amount) || cost.amount < 0 || available < cost.amount) {
      return { state: source, status: 'blocked', reason: `${cost.label || cost.id || cost.path}不足`, changes: [], events: [] };
    }
  }
  const draft = clone(source);
  const runtime = runtimeOf(draft);
  runtime.schemaVersion = GAMEPLAY_SCHEMA_VERSION;
  const ops: Op[] = [
    ...(transaction.costs ?? []).map(cost => ({ op: 'add' as const, path: cost.path, value: -cost.amount, create: false, label: cost.label })),
    ...(transaction.ops ?? []),
  ];
  const result = applyOpsInPlace(draft, ops, {
    facts: INTERNAL_FACTS, source: 'system', turn: tick, rng: new Rng(createRngState(transaction.id)), bestEffort: false, sourceLabel: transaction.source,
  });
  if (result.failure) return { state: source, status: 'failed', reason: result.failure, changes: [], events: [] };

  runtime.sequence += 1;
  const sequence = runtime.sequence;
  const inputs: GameplayEventInput[] = [
    ...(transaction.events ?? []),
    ...result.emitted.map(event => ({ type: event.type, ...(event.payload ? { payload: event.payload as Record<string, GameplayValue> } : {}) })),
  ];
  const stamp = (input: GameplayEventInput, index: number, at: number): GameplayEvent => ({
    ...clone(input), id: `gameplay-event-${sequence}-${index + 1}`, tick: at, sequence,
    source: transaction.source, ...(transaction.moduleId ? { moduleId: transaction.moduleId } : {}), transactionId: transaction.id,
  });
  const events = inputs.map((input, index) => stamp(input, index, tick));
  runtime.pendingEvents = [...runtime.pendingEvents, ...events].slice(-MAX_PENDING_EVENTS);
  runtime.eventHistory = [...runtime.eventHistory, ...events].slice(-MAX_EVENT_HISTORY);
  result.scheduled.forEach((item, index) => {
    const dueTick = tick + Math.max(1, Math.trunc(item.afterTurns));
    runtime.scheduledEvents.push({ dueTick, event: stamp({ type: item.type, ...(item.payload ? { payload: item.payload as Record<string, GameplayValue> } : {}) }, inputs.length + index, dueTick) });
  });
  if (runtime.scheduledEvents.length > MAX_SCHEDULED_EVENTS) runtime.scheduledEvents = runtime.scheduledEvents.slice(-MAX_SCHEDULED_EVENTS);

  const changes: GameplayChange[] = diffStates(source, draft, LOG_IGNORE).map(change => ({
    path: change.path, operation: change.after === undefined ? 'remove' : 'set', before: change.before, after: change.after,
  }));
  if (changes.length === 0 && events.length === 0 && result.scheduled.length === 0) {
    return { state: source, status: 'blocked', reason: '没有产生任何变化', changes: [], events: [] };
  }
  appendLog(draft, {
    id: `gameplay-log-${sequence}`, sequence, tick, transactionId: transaction.id,
    ...(transaction.moduleId ? { moduleId: transaction.moduleId } : {}),
    source: transaction.source, ...(transaction.label ? { label: transaction.label } : {}),
    status: 'applied', changes, eventIds: events.map(event => event.id),
    ...(result.warnings.length ? { warnings: result.warnings.slice(0, 20) } : {}),
  });
  return { state: draft, status: 'applied', changes, events };
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

/**
 * 撤销一笔已提交的事务（宿主或内部事务都行）。只有它写过的每个路径都还是当时写入的值时才执行，
 * 防止旧的撤销覆盖后来的变化；同时移除这笔事务发出、尚未处理的事件。被阻止时也记一条日志说明原因。
 */
export function revertTransaction(source: GameState, transactionId: string, options: { tick?: number } = {}): TransactionResult {
  const state = clone(source);
  const runtime = runtimeOf(state);
  const tick = tickOf(source, options.tick);
  const target = [...runtime.logs].reverse().find(log => log.transactionId === transactionId && log.status === 'applied');
  runtime.sequence += 1;
  const sequence = runtime.sequence;
  const id = `revert:${transactionId}:${sequence}`;
  const finish = (status: TransactionResult['status'], changes: GameplayChange[], reason?: string): TransactionResult => {
    appendLog(state, {
      id: `gameplay-log-${sequence}`, sequence, tick, transactionId: id, ...(target?.moduleId ? { moduleId: target.moduleId } : {}),
      source: 'system:revert', label: `撤销 ${target?.label ?? transactionId}`, status, ...(reason ? { reason } : {}), changes, eventIds: [],
    });
    return { state, status, ...(reason ? { reason } : {}), changes, events: [] };
  };
  if (!target) return finish('blocked', [], '事务不存在或已撤销');

  const unique = Array.from(target.changes.reduce((map, change) => {
    const existing = map.get(change.path);
    if (!existing) map.set(change.path, { ...change });
    else existing.after = change.after;
    return map;
  }, new Map<string, GameplayChange>()).values());
  for (const change of [...unique].reverse()) {
    if (!valuesEqual(getGameplayPath(state, change.path), change.after)) return finish('blocked', [], `事务已被后续变化覆盖：${change.path}`);
  }
  const changes: GameplayChange[] = [];
  for (const change of [...unique].reverse()) {
    const before = clone(getGameplayPath(state, change.path));
    if (change.before === undefined) removeGameplayPath(state as GameState & GameplayStateRoot, change.path);
    else if (!setGameplayPath(state as GameState & GameplayStateRoot, change.path, change.before, true)) {
      return { ...finish('failed', [], `无法恢复路径 ${change.path}`), state: source };
    }
    changes.push({ path: change.path, operation: 'set', before, after: clone(change.before), label: `撤销：${change.label ?? ''}` });
  }
  const eventIds = new Set(target.eventIds);
  runtime.pendingEvents = runtime.pendingEvents.filter(event => event.transactionId !== transactionId && !eventIds.has(event.id));
  runtime.eventHistory = runtime.eventHistory.filter(event => event.transactionId !== transactionId && !eventIds.has(event.id));
  runtime.scheduledEvents = runtime.scheduledEvents.filter(item => item.event.transactionId !== transactionId && !eventIds.has(item.event.id));
  target.status = 'reverted';
  target.revertedBy = id;
  return finish('applied', changes);
}
