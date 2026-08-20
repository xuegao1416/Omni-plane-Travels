import type { GameState } from '../../schema/variables';
import type { StatModuleSchema } from '../../modules/schema';
import {
  executeGameplayTransaction,
  getGameplayPath,
  ensureGameplayRuntime,
  type GameplayExecutionContext,
  type GameplayExecutionResult,
  type GameplayStateRoot,
} from '../kernel';
import type { GameplayStatModifier } from '../types';

export interface StatChangeRequest {
  statId: string;
  delta?: number;
  set?: number;
  reason?: string;
  source?: string;
}

export type StatPointAllocation = Record<string, number>;

interface StatTarget {
  path: string;
  min: number;
  max: number;
  label: string;
}

function resolveStatTarget(config: StatModuleSchema, statId: string): StatTarget | null {
  if (statId === 'attrA') {
    return { path: '玩家.生存状态.attrA', min: 0, max: Math.max(0, Number(config.attrA.max) || 0), label: config.attrA.name };
  }
  if (statId === 'attrB') {
    return { path: '玩家.生存状态.体力值', min: 0, max: Math.max(0, Number(config.attrB.max) || 0), label: config.attrB.name };
  }
  if (/^dim[1-6]$/.test(statId)) {
    const definition = config[statId as keyof Pick<StatModuleSchema, 'dim1' | 'dim2' | 'dim3' | 'dim4' | 'dim5' | 'dim6'>];
    if (!definition) return null;
    return {
      path: `玩家.生存状态.${statId}`,
      min: Number(definition.range?.[0]) || 0,
      max: Number(definition.range?.[1]) || 100,
      label: definition.name,
    };
  }
  const special = config.special?.find(item => item.id === statId);
  if (!special) return null;
  return {
    path: `玩家.生存状态.${statId}`,
    min: Number(special.range?.[0]) || 0,
    max: Number(special.range?.[1]) || 100,
    label: special.name,
  };
}

function pathForTarget(state: GameState, target: StatTarget): string {
  if (target.path === '玩家.生存状态.attrA' && typeof state.玩家.生存状态.attrA !== 'number') return '玩家.生存状态.血量';
  if (target.path === '玩家.生存状态.attrB' && typeof state.玩家.生存状态.attrB !== 'number') return '玩家.生存状态.体力值';
  return target.path;
}

function blockedStat(state: GameState, context: GameplayExecutionContext, id: string): GameplayExecutionResult<GameState & GameplayStateRoot> {
  return executeGameplayTransaction(state, {
    id,
    moduleId: 'stat',
    source: 'player',
    conditions: [{ state: { path: '__gameplay.statAllocationAllowed', op: '==', value: true } }],
  }, context);
}

/** Spend the player's unallocated points on configured stats in one transaction. */
export function allocateStatPoints(
  state: GameState,
  config: StatModuleSchema,
  allocations: StatPointAllocation,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const available = Math.max(0, Math.trunc(Number(state.玩家.可用属性点) || 0));
  const entries = Object.entries(allocations)
    .map(([statId, amount]) => [statId, Math.trunc(Number(amount) || 0)] as const)
    .filter(([, amount]) => amount > 0);
  const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
  if (!entries.length || total > available) return blockedStat(state, context, `stat:allocate:blocked:${context.tick}`);

  const effects: Parameters<typeof executeGameplayTransaction>[1]['effects'] = [];
  for (const [statId, amount] of entries) {
    const target = resolveStatTarget(config, statId);
    if (!target) return blockedStat(state, context, `stat:allocate:invalid:${statId}:${context.tick}`);
    effects.push({ add: { path: pathForTarget(state, target), delta: amount, min: target.min, max: target.max } });
  }
  return executeGameplayTransaction(state, {
    id: `stat:allocate:${context.tick}`,
    moduleId: 'stat',
    source: 'player',
    label: `分配${total}点属性点`,
    costs: [{ path: '玩家.可用属性点', amount: total, label: '属性点' }],
    effects,
    events: [{ type: 'stat.points-allocated', payload: { allocations: Object.fromEntries(entries), total } }],
  }, context);
}

function statValue(state: GameState, config: StatModuleSchema, statId: string, tick = Number.POSITIVE_INFINITY, seen = new Set<string>()): number {
  const target = resolveStatTarget(config, statId);
  if (target) {
    const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot).stat!;
    const base = Number(getGameplayPath(state, pathForTarget(state, target)));
    const raw = Number.isFinite(base) ? base : 0;
    let flat = 0;
    let percent = 0;
    for (const modifier of Object.values(runtime.modifiers)) {
      if (modifier.statId !== statId || (modifier.expiresAtTick !== undefined && modifier.expiresAtTick <= tick)) continue;
      if (modifier.mode === 'percent') percent += Number(modifier.delta) || 0;
      else flat += Number(modifier.delta) || 0;
    }
    const result = (raw + flat) * (1 + percent / 100);
    return Math.min(target.max, Math.max(target.min, result));
  }
  const derived = config.derived?.find(item => item.id === statId);
  if (!derived || seen.has(statId)) return Number(getGameplayPath(state, `玩家.生存状态.${statId}`)) || 0;
  seen.add(statId);
  const values = derived.inputs.map(input => input.includes('.')
    ? Number(getGameplayPath(state, input)) || 0
    : statValue(state, config, input, tick, new Set(seen)));
  const formula = derived.formula ?? 'sum';
  const aggregate = formula === 'average' ? (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
    : formula === 'min' ? Math.min(...values)
      : formula === 'max' ? Math.max(...values)
        : formula === 'ratio' ? (values[1] ? values[0] / values[1] : 0)
          : values.reduce((a, b) => a + b, 0);
  const result = aggregate * (derived.scale ?? 1) + (derived.offset ?? 0);
  return Math.min(derived.max ?? Number.POSITIVE_INFINITY, Math.max(derived.min ?? Number.NEGATIVE_INFINITY, result));
}

function derivedSnapshot(state: GameState, config: StatModuleSchema, tick: number): Record<string, number> {
  return Object.fromEntries((config.derived ?? []).map(item => [item.id, statValue(state, config, item.id, tick)]));
}

export function getEffectiveStatValue(state: GameState, config: StatModuleSchema, statId: string, tick = Number.POSITIVE_INFINITY): number {
  return statValue(state, config, statId, tick);
}

export function addStatModifier(
  state: GameState,
  config: StatModuleSchema,
  modifier: Omit<GameplayStatModifier, 'expiresAtTick'> & { durationTicks?: number },
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  const existing = runtime.stat?.modifiers ?? {};
  const expiresAtTick = modifier.durationTicks && modifier.durationTicks > 0 ? context.tick + Math.trunc(modifier.durationTicks) : undefined;
  const next = { ...existing, [modifier.id]: { ...modifier, ...(expiresAtTick === undefined ? {} : { expiresAtTick }) } };
  const preview = typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state)) as GameState;
  const previewRuntime = ensureGameplayRuntime(preview as GameState & GameplayStateRoot);
  previewRuntime.stat!.modifiers = next;
  return executeGameplayTransaction(state, {
    id: `stat:modifier:${modifier.id}:${context.tick}`,
    moduleId: 'stat', source: modifier.source ?? 'system', label: `应用${modifier.id}修正`,
    effects: [
      { set: { path: 'gameplay.stat.modifiers', value: next as unknown as Record<string, never> } },
      { set: { path: 'gameplay.stat.derived', value: derivedSnapshot(preview, config, context.tick) as unknown as Record<string, never> } },
    ],
    events: [{ type: 'stat.modifier-added', payload: { modifierId: modifier.id, statId: modifier.statId } }],
  }, context);
}

export function expireStatModifiers(
  state: GameState,
  config: StatModuleSchema,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  const next = Object.fromEntries(Object.entries(runtime.stat?.modifiers ?? {}).filter(([, item]) => item.expiresAtTick === undefined || item.expiresAtTick > context.tick));
  const preview = typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state)) as GameState;
  const previewRuntime = ensureGameplayRuntime(preview as GameState & GameplayStateRoot);
  previewRuntime.stat!.modifiers = next;
  const derived = derivedSnapshot(preview, config, context.tick);
  if (Object.keys(next).length === Object.keys(runtime.stat?.modifiers ?? {}).length) {
    return executeGameplayTransaction(state, { id: `stat:expire:none:${context.tick}`, moduleId: 'stat', source: 'system', conditions: [{ state: { path: '__gameplay.noExpiredStatModifier', op: '==', value: true } }] }, context);
  }
  return executeGameplayTransaction(state, {
    id: `stat:expire:${context.tick}`, moduleId: 'stat', source: 'system', effects: [
      { set: { path: 'gameplay.stat.modifiers', value: next as unknown as Record<string, never> } },
      { set: { path: 'gameplay.stat.derived', value: derived as unknown as Record<string, never> } },
    ], events: [{ type: 'stat.modifiers-expired', payload: { tick: context.tick } }],
  }, context);
}

export function applyStatChange(
  state: GameState,
  config: StatModuleSchema,
  request: StatChangeRequest,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const target = resolveStatTarget(config, request.statId);
  if (!target) {
    return executeGameplayTransaction(state, {
      id: `stat:${request.statId}:invalid`, moduleId: 'stat', source: request.source ?? 'system',
      conditions: [{ state: { path: '__gameplay.invalidStat', op: '==', value: true } }],
    }, context);
  }

  const path = pathForTarget(state, target);
  const current = Number(getGameplayPath(state, path));
  const rawNext = request.set !== undefined ? request.set : current + (request.delta ?? 0);
  const next = Math.min(target.max, Math.max(target.min, Number.isFinite(rawNext) ? rawNext : current));
  const preview = typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state)) as GameState;
  const previewTarget = path.split('.').reduce<Record<string, unknown> | undefined>((value, key, index, parts) => {
    if (index === parts.length - 1) { if (value) value[key] = next; return value; }
    const child = value?.[key];
    return child && typeof child === 'object' && !Array.isArray(child) ? child as Record<string, unknown> : undefined;
  }, preview as unknown as Record<string, unknown>);
  void previewTarget;
  return executeGameplayTransaction(state, {
    id: `stat:${request.statId}:${context.tick}`,
    moduleId: 'stat',
    source: request.source ?? 'system',
    label: request.reason ?? `${target.label}变化`,
    effects: [
      { set: { path, value: next } },
      { set: { path: `gameplay.stat.base.${request.statId}`, value: next } },
      { set: { path: 'gameplay.stat.derived', value: derivedSnapshot(preview, config, context.tick) as unknown as Record<string, never> } },
    ],
    events: [{ type: 'stat.changed', payload: { statId: request.statId, value: next, reason: request.reason ?? '' } }],
  }, context);
}
