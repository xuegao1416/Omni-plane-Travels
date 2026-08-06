import type { Condition, CustomGameplayModule, JsonValue } from './schema';
import type { CustomModuleRuntimeState } from './stateStore';
import { executeCustomModuleActions } from './actionExecutor';
import { validateCustomGameplayModule } from './validator';

export type CustomModuleLifecycle = 'onGameStart' | 'onTurnEnd' | 'onTick' | 'onChoice';

export interface CustomModuleRuntimeOptions {
  now?: number;
  maxRules?: number;
  maxActions?: number;
  maxConditionDepth?: number;
}

export interface CustomModuleExecutionResult {
  nextState: CustomModuleRuntimeState;
  applied: number;
  warnings: string[];
}

const DEFAULT_MAX_RULES = 64;
const DEFAULT_MAX_ACTIONS = 128;
const DEFAULT_MAX_CONDITION_DEPTH = 16;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readPath(values: Record<string, JsonValue>, path: string): JsonValue | undefined {
  const parts = path.split('.');
  let current: unknown = values;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as JsonValue;
}

function equal(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function evaluateCondition(condition: Condition, values: Record<string, JsonValue>, depth: number, maxDepth: number): boolean {
  if (depth > maxDepth) return false;
  if (condition.type === 'all') return condition.conditions.every((item) => evaluateCondition(item, values, depth + 1, maxDepth));
  if (condition.type === 'any') return condition.conditions.some((item) => evaluateCondition(item, values, depth + 1, maxDepth));
  if (condition.type === 'not') return !evaluateCondition(condition.condition, values, depth + 1, maxDepth);

  const actual = readPath(values, condition.path);
  if (actual === undefined) return false;
  switch (condition.operator) {
    case 'eq': return equal(actual, condition.value);
    case 'neq': return !equal(actual, condition.value);
    case 'gt': return typeof actual === 'number' && typeof condition.value === 'number' && actual > condition.value;
    case 'gte': return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
    case 'lt': return typeof actual === 'number' && typeof condition.value === 'number' && actual < condition.value;
    case 'lte': return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value;
    case 'in': return Array.isArray(condition.value) && condition.value.some((item) => equal(item, actual));
    case 'contains':
      return typeof actual === 'string'
        ? typeof condition.value === 'string' && actual.includes(condition.value)
        : Array.isArray(actual) && actual.some((item) => equal(item, condition.value));
  }
}

export function executeCustomModuleLifecycle(
  module: CustomGameplayModule,
  state: CustomModuleRuntimeState,
  lifecycle: CustomModuleLifecycle,
  options: CustomModuleRuntimeOptions = {},
): CustomModuleExecutionResult {
  const validation = validateCustomGameplayModule(module);
  if (!validation.valid || !validation.normalized) {
    return {
      nextState: clone(state),
      applied: 0,
      warnings: validation.errors.map((item) => `${item.code}: ${item.message}`),
    };
  }
  if (!state.enabled) return { nextState: clone(state), applied: 0, warnings: [] };

  const normalized = validation.normalized;
  const rules = normalized.logic[lifecycle].slice(0, options.maxRules ?? DEFAULT_MAX_RULES);
  const warnings: string[] = [];
  let nextState = clone(state);
  let applied = 0;
  let actionBudget = options.maxActions ?? DEFAULT_MAX_ACTIONS;
  const now = options.now ?? 0;

  for (const rule of rules) {
    if (actionBudget <= 0) {
      warnings.push(`生命周期动作预算已耗尽：${lifecycle}`);
      break;
    }
    if (rule.when && !evaluateCondition(rule.when, nextState.values, 0, options.maxConditionDepth ?? DEFAULT_MAX_CONDITION_DEPTH)) continue;
    const result = executeCustomModuleActions(normalized, nextState, rule.actions, lifecycle, now, actionBudget);
    nextState = result.nextState;
    applied += result.applied;
    actionBudget -= rule.actions.length;
    warnings.push(...result.warnings);
  }

  if (normalized.logic[lifecycle].length > rules.length) warnings.push(`规则数量超过上限，已截断为 ${rules.length} 条`);
  if (applied > 0) {
    nextState.runtime.lastLifecycle = lifecycle;
    nextState.runtime.lastRunAt = now;
  }
  return { nextState, applied, warnings };
}

