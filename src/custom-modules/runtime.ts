import type { Condition, CustomGameplayModuleDefinition, CustomModuleReference, CustomModuleValue, JsonValue, V2Condition } from './schema';
import type { CustomModuleRuntimeState } from './stateStore';
import { executeCustomModuleActions, type CustomModuleOperandContext } from './actionExecutor';
import { validateCustomGameplayModule } from './validator';
import type { CustomModuleHostContext } from './context';

export type CustomModuleLifecycle = 'onGameStart' | 'onTurnEnd' | 'onTick' | 'onChoice' | 'onButton';

export interface CustomModuleRuntimeOptions {
  now?: number;
  maxRules?: number;
  maxActions?: number;
  maxConditionDepth?: number;
  context?: CustomModuleHostContext;
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

function isReference(value: CustomModuleValue): value is CustomModuleReference {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'source' in value && 'path' in value);
}

function resolveReference(
  value: CustomModuleValue,
  state: Record<string, JsonValue>,
  operands: CustomModuleOperandContext,
): JsonValue | undefined {
  if (!isReference(value)) return value;
  const root = value.source === 'state' ? state : value.source === 'input' ? operands.input : operands.event;
  return readPath(root, value.path);
}

function evaluateV2Condition(
  condition: V2Condition,
  state: Record<string, JsonValue>,
  operands: CustomModuleOperandContext,
  depth: number,
  maxDepth: number,
): boolean {
  if (depth > maxDepth) return false;
  if (condition.type === 'all') return condition.conditions.every((item) => evaluateV2Condition(item, state, operands, depth + 1, maxDepth));
  if (condition.type === 'any') return condition.conditions.some((item) => evaluateV2Condition(item, state, operands, depth + 1, maxDepth));
  if (condition.type === 'not') return !evaluateV2Condition(condition.condition, state, operands, depth + 1, maxDepth);

  const left = 'left' in condition ? condition.left : { source: condition.source, path: condition.path };
  const value = 'right' in condition ? condition.right : condition.value;
  const leftRoot = left.source === 'state' ? state : left.source === 'input' ? operands.input : operands.event;
  const actual = readPath(leftRoot, left.path);
  const expected = resolveReference(value, state, operands);
  if (actual === undefined || expected === undefined) return false;
  switch (condition.operator) {
    case 'eq': return equal(actual, expected);
    case 'neq': return !equal(actual, expected);
    case 'gt': return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte': return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt': return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte': return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'in': return Array.isArray(expected) && expected.some((item) => equal(item, actual));
    case 'contains': return typeof actual === 'string'
      ? typeof expected === 'string' && actual.includes(expected)
      : Array.isArray(actual) && actual.some((item) => equal(item, expected));
  }
}

function buildV2Operands(module: CustomGameplayModuleDefinition, context?: CustomModuleHostContext): CustomModuleOperandContext {
  const input: Record<string, JsonValue> = {};
  if (module.schemaVersion === 2 && context) {
    for (const [alias, binding] of Object.entries(module.inputs)) {
      const path = typeof binding === 'string' ? binding : binding.path;
      const value = readPath(context as unknown as Record<string, JsonValue>, path);
      if (value !== undefined) input[alias] = clone(value);
    }
  }
  return {
    input,
    event: context?.event ? clone(context.event as unknown as Record<string, JsonValue>) : {},
  };
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
  module: CustomGameplayModuleDefinition,
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
  const rules = ((normalized.logic as unknown as Record<string, Array<{ when?: Condition | V2Condition; actions: never[] }>>)[lifecycle] ?? []).slice(0, options.maxRules ?? DEFAULT_MAX_RULES);
  const warnings: string[] = [];
  let nextState = clone(state);
  let applied = 0;
  let actionBudget = options.maxActions ?? DEFAULT_MAX_ACTIONS;
  const now = options.now ?? 0;
  const operands = buildV2Operands(normalized, options.context);

  for (const rule of rules) {
    if (actionBudget <= 0) {
      warnings.push(`生命周期动作预算已耗尽：${lifecycle}`);
      break;
    }
    const matches = !rule.when || (normalized.schemaVersion === 2
      ? evaluateV2Condition(rule.when as V2Condition, nextState.values, operands, 0, options.maxConditionDepth ?? DEFAULT_MAX_CONDITION_DEPTH)
      : evaluateCondition(rule.when as Condition, nextState.values, 0, options.maxConditionDepth ?? DEFAULT_MAX_CONDITION_DEPTH));
    if (!matches) continue;
    const result = executeCustomModuleActions(normalized, nextState, rule.actions as never[], lifecycle, now, actionBudget, operands);
    nextState = result.nextState;
    applied += result.applied;
    actionBudget -= rule.actions.length;
    warnings.push(...result.warnings);
  }

  const allRules = (normalized.logic as unknown as Record<string, unknown[]>)[lifecycle] ?? [];
  if (allRules.length > rules.length) warnings.push(`规则数量超过上限，已截断为 ${rules.length} 条`);
  if (applied > 0) {
    nextState.runtime.lastLifecycle = lifecycle;
    nextState.runtime.lastRunAt = now;
  }
  return { nextState, applied, warnings };
}

