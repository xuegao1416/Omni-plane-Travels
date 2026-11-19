/**
 * 事件导演的存档状态（gameState.eventDirector）与旧事件运行态迁移。
 *
 * 旧版把规则的一次性/冷却记录放在 simulationRuntime.eventRuntimes，
 * 待弹卡片放在 pendingAddEvents，延迟事件放在 scheduledTicks。读档时一次性搬进新结构。
 */
import type { GameState } from '../schema/variables';
import type { GameplayStateRoot } from '../gameplay/types';
import { ensureGameplayRuntime } from '../core/state';
import type { EventDefinition, EventDirectorState, PacingLevel, QueuedCard } from './types';

export const QUEUE_CAP = 3;
export const HISTORY_CAP = 30;
export const SIGNAL_CAP = 40;

export const PACING_LEVELS: readonly PacingLevel[] = ['off', 'low', 'normal', 'high'];

export const PACING_LABELS: Record<PacingLevel, string> = {
  off: '关闭随机事件',
  low: '偶尔',
  normal: '适中',
  high: '频繁',
};

/** base：冷场第一回合的出卡概率；step：每多冷场一回合增加；gap：两张卡之间至少隔几回合。 */
export const PACING_RULES: Record<Exclude<PacingLevel, 'off'>, { base: number; step: number; gap: number }> = {
  low: { base: 0.12, step: 0.06, gap: 4 },
  normal: { base: 0.22, step: 0.08, gap: 2 },
  high: { base: 0.35, step: 0.1, gap: 1 },
};

export const PACING_CHANCE_CAP = 0.8;

/** 新开局的随机事件节奏；世界可在 WorldDef.eventPacing 里改，玩家可在事件面板里改。 */
export const DEFAULT_PACING: PacingLevel = 'low';

export function isPacingLevel(value: unknown): value is PacingLevel {
  return PACING_LEVELS.includes(value as PacingLevel);
}

export function createDirectorState(level: PacingLevel = DEFAULT_PACING): EventDirectorState {
  return {
    version: 1,
    fired: {},
    cooldowns: {},
    queue: [],
    history: [],
    pacing: { level, lastCardTurn: 0, quietTurns: 0 },
    signals: [],
    serial: 0,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** 规范化（容错读取被手改或旧版本写坏的数据）。 */
export function normalizeDirector(raw: unknown): EventDirectorState {
  const base = createDirectorState();
  const value = record(raw);
  if (!value) return base;
  const pacing = record(value.pacing);
  const level = isPacingLevel(pacing?.level) ? pacing!.level : DEFAULT_PACING;
  const fired: EventDirectorState['fired'] = {};
  for (const [key, item] of Object.entries(record(value.fired) ?? {})) {
    const entry = record(item);
    if (entry) fired[key] = { count: Math.max(0, Math.trunc(finite(entry.count))), lastTurn: Math.trunc(finite(entry.lastTurn)) };
  }
  const cooldowns: EventDirectorState['cooldowns'] = {};
  for (const [key, turn] of Object.entries(record(value.cooldowns) ?? {})) if (Number.isFinite(Number(turn))) cooldowns[key] = Math.trunc(Number(turn));
  const queue = (Array.isArray(value.queue) ? value.queue : [])
    .map(record)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item.key === 'string' && typeof item.eventId === 'string'))
    .map(item => ({
      key: String(item.key), packId: String(item.packId ?? ''), eventId: String(item.eventId),
      turn: Math.trunc(finite(item.turn)), reason: String(item.reason ?? ''),
    }))
    .slice(0, QUEUE_CAP);
  const history = (Array.isArray(value.history) ? value.history : [])
    .map(record)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item.key === 'string'))
    .map(item => ({
      key: String(item.key), name: String(item.name ?? item.key), turn: Math.trunc(finite(item.turn)),
      ...(typeof item.choice === 'string' ? { choice: item.choice } : {}),
      ...(typeof item.success === 'boolean' ? { success: item.success } : {}),
      ...(item.dismissed === true ? { dismissed: true } : {}),
      ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
    }))
    .slice(-HISTORY_CAP);
  const signals = (Array.isArray(value.signals) ? value.signals : [])
    .map(record)
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item.type === 'string'))
    .map(item => ({ type: String(item.type), payload: record(item.payload) ?? {} }))
    .slice(-SIGNAL_CAP);
  return {
    version: 1,
    fired,
    cooldowns,
    queue,
    history,
    pacing: { level, lastCardTurn: Math.trunc(finite(pacing?.lastCardTurn)), quietTurns: Math.max(0, Math.trunc(finite(pacing?.quietTurns))) },
    signals,
    serial: Math.max(0, Math.trunc(finite(value.serial))),
  };
}

/** 取（必要时创建）草稿上的导演状态。 */
export function directorOf(state: GameState): EventDirectorState {
  const current = state.eventDirector;
  if (current && current.version === 1 && Array.isArray(current.queue) && Array.isArray(current.signals)) return current;
  state.eventDirector = normalizeDirector(current);
  return state.eventDirector;
}

/** 只读：没有导演状态时返回空状态（不写入）。 */
export function readDirector(state: GameState | undefined): EventDirectorState {
  return state?.eventDirector ? normalizeDirector(state.eventDirector) : createDirectorState();
}

export function canFire(def: EventDefinition, director: EventDirectorState, turn: number): boolean {
  if (def.once && (director.fired[def.key]?.count ?? 0) > 0) return false;
  const until = director.cooldowns[def.key];
  return until === undefined || turn > until;
}

export function markFired(def: EventDefinition, director: EventDirectorState, turn: number): void {
  const previous = director.fired[def.key];
  director.fired[def.key] = { count: (previous?.count ?? 0) + 1, lastTurn: turn };
  if (def.cooldownTurns > 0) director.cooldowns[def.key] = turn + def.cooldownTurns;
  // 过期的冷却记录不必留在存档里。
  for (const [key, until] of Object.entries(director.cooldowns)) if (until < turn) delete director.cooldowns[key];
}

/**
 * 旧事件运行态 → 导演状态。返回是否迁移了数据。
 * lookup：按 eventId（可带 packId）找到事件定义，用来给旧待弹卡片补上正确的事件包。
 */
export function migrateLegacyEventRuntime(state: GameState, turn: number, lookup: (eventId: string, packId?: string) => EventDefinition | undefined): boolean {
  const runtime = state.simulationRuntime as (NonNullable<GameState['simulationRuntime']> & Record<string, unknown>) | undefined;
  if (!runtime) return false;
  const hasLegacy = runtime.eventRuntimes !== undefined || runtime.pendingAddEvents !== undefined || runtime.scheduledTicks !== undefined;
  if (!hasLegacy) return false;
  const director = directorOf(state);
  for (const [packId, packRuntime] of Object.entries(runtime.eventRuntimes ?? {})) {
    for (const [ruleId, fired] of Object.entries(packRuntime?.onceFired ?? {})) {
      if (fired) director.fired[`${packId}/${ruleId}`] ??= { count: 1, lastTurn: turn };
    }
    for (const [ruleId, remaining] of Object.entries(packRuntime?.cooldownRemaining ?? {})) {
      const left = Math.trunc(Number(remaining) || 0);
      if (left > 0) director.cooldowns[`${packId}/${ruleId}`] = Math.max(director.cooldowns[`${packId}/${ruleId}`] ?? 0, turn + left);
    }
  }
  for (const pending of runtime.pendingAddEvents ?? []) {
    if (director.queue.length >= QUEUE_CAP) break;
    const def = lookup(pending.eventId, pending.eventPackId) ?? lookup(pending.eventId);
    if (!def || def.kind !== 'card' || director.queue.some(item => item.key === def.key)) continue;
    director.queue.push({ key: def.key, packId: def.packId, eventId: def.eventId, turn, reason: '旧版待处理事件' } satisfies QueuedCard);
  }
  if (runtime.scheduledTicks?.length) {
    const gameplay = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
    for (const entry of runtime.scheduledTicks) {
      gameplay.sequence += 1;
      const payload = record(entry.payload) ?? {};
      gameplay.scheduledEvents.push({
        dueTick: Math.max(turn + 1, Math.trunc(Number(entry.scheduledAt) || 0)),
        event: {
          id: `sched:legacy:${gameplay.sequence}`,
          type: typeof payload.type === 'string' && payload.type ? payload.type : 'scheduled',
          payload: (record(payload.where) ?? {}) as never,
          tick: turn,
          sequence: gameplay.sequence,
          source: entry.ruleId ? `legacy:${entry.ruleId}` : 'legacy',
          transactionId: 'legacy-migration',
        },
      });
    }
  }
  delete runtime.eventRuntimes;
  delete runtime.pendingAddEvents;
  delete runtime.scheduledTicks;
  return true;
}
