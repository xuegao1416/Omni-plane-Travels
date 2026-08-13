import type {
  CustomGameplayModuleDefinition,
  CustomModuleAction,
  CustomModuleReference,
  CustomModuleValue,
  V2Action,
  JsonValue,
  StateFieldDefinition,
} from './schema';
import type { CustomModuleRuntimeState } from './stateStore';

export interface ActionExecutionResult {
  nextState: CustomModuleRuntimeState;
  applied: number;
  warnings: string[];
}

export interface CustomModuleOperandContext {
  input: Record<string, JsonValue>;
  event: Record<string, JsonValue>;
}

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safePath(path: string): string[] | undefined {
  const parts = path.split('.');
  if (parts.length === 0 || parts.some((part) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(part) || UNSAFE_KEYS.has(part))) return undefined;
  return parts;
}

function readPath(values: Record<string, JsonValue>, path: string): JsonValue | undefined {
  const parts = safePath(path);
  if (!parts) return undefined;
  let current: unknown = values;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as JsonValue;
}

function writePath(values: Record<string, JsonValue>, path: string, value: JsonValue): boolean {
  const parts = safePath(path);
  if (!parts) return false;
  let current: Record<string, unknown> = values;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return false;
    current = next as Record<string, unknown>;
  }
  if (!Object.prototype.hasOwnProperty.call(current, parts.at(-1)!)) return false;
  current[parts.at(-1)!] = clone(value);
  return true;
}

function findField(module: CustomGameplayModuleDefinition, path: string): StateFieldDefinition | undefined {
  const parts = path.split('.');
  let field = module.state[parts[0]];
  if (!field) return undefined;
  for (const part of parts.slice(1)) {
    if (field.type !== 'object') return undefined;
    field = field.fields[part];
    if (!field) return undefined;
  }
  return field;
}

function isRuntimeValueCompatible(field: StateFieldDefinition, value: JsonValue): boolean {
  switch (field.type) {
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'string': return typeof value === 'string' && (field.maxLength === undefined || value.length <= field.maxLength);
    case 'boolean': return typeof value === 'boolean';
    case 'enum': return typeof value === 'string' && field.values.includes(value);
    case 'array': return Array.isArray(value)
      && value.length <= field.maxItems
      && value.every((item) => isRuntimeValueCompatible(field.items, item));
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const entries = Object.entries(value);
      return entries.length <= field.maxProperties
        && entries.every(([key, item]) => Boolean(field.fields[key]) && isRuntimeValueCompatible(field.fields[key], item))
        && Object.keys(field.fields).every((key) => Object.prototype.hasOwnProperty.call(value, key));
    }
  }
}

function equal(a: JsonValue, b: JsonValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function copyState(state: CustomModuleRuntimeState): CustomModuleRuntimeState {
  return {
    ...state,
    values: clone(state.values),
    runtime: { ...state.runtime, log: [...state.runtime.log] },
  };
}

function isReference(value: CustomModuleValue): value is CustomModuleReference {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'source' in value && 'path' in value);
}

function resolveValue(
  value: CustomModuleValue,
  state: Record<string, JsonValue>,
  operands?: CustomModuleOperandContext,
): JsonValue | undefined {
  if (!isReference(value)) return clone(value);
  const root = value.source === 'state' ? state : value.source === 'input' ? operands?.input : operands?.event;
  return root ? readPath(root, value.path) : undefined;
}

export function executeCustomModuleActions(
  module: CustomGameplayModuleDefinition,
  state: CustomModuleRuntimeState,
  actions: Array<CustomModuleAction | V2Action>,
  lifecycle: string,
  now = 0,
  maxActions = 128,
  operands?: CustomModuleOperandContext,
): ActionExecutionResult {
  const nextState = copyState(state);
  const warnings: string[] = [];
  let applied = 0;

  for (const action of actions.slice(0, maxActions)) {
    if (action.type === 'log') {
      nextState.runtime.log.push({ lifecycle, message: action.message, at: now });
      nextState.runtime.log = nextState.runtime.log.slice(-100);
      applied++;
      continue;
    }

    const current = readPath(nextState.values, action.path);
    const field = findField(module, action.path);
    if (current === undefined || !field) {
      warnings.push(`忽略无效状态路径：${action.path}`);
      continue;
    }

    let nextValue: JsonValue | undefined;
    if (action.type === 'set') nextValue = resolveValue(action.value, nextState.values, operands);
    if (action.type === 'toggle' && typeof current === 'boolean') nextValue = !current;
    if ((action.type === 'add' || action.type === 'subtract') && typeof current === 'number') {
      const resolved = typeof action.value === 'number' ? action.value : resolveValue(action.value, nextState.values, operands);
      const delta = typeof resolved === 'number' ? (action.type === 'add' ? resolved : -resolved) : undefined;
      if (delta !== undefined) nextValue = current + delta;
      if (field.type === 'number' && typeof nextValue === 'number') {
        if (field.min !== undefined) nextValue = Math.max(field.min, nextValue);
        if (field.max !== undefined) nextValue = Math.min(field.max, nextValue);
      }
    }
    if ((action.type === 'append' || action.type === 'remove') && Array.isArray(current)) {
      const values = current.map((item) => clone(item as JsonValue));
      if (action.type === 'append') {
        const maxItems = field.type === 'array' ? field.maxItems : values.length;
        const resolved = resolveValue(action.value, nextState.values, operands);
        if (resolved !== undefined && values.length < maxItems) values.push(clone(resolved));
      } else {
        const resolved = resolveValue(action.value, nextState.values, operands);
        const index = resolved === undefined ? -1 : values.findIndex((item) => equal(item, resolved));
        if (index >= 0) values.splice(index, 1);
      }
      nextValue = values;
    }

    if (nextValue === undefined || !isRuntimeValueCompatible(field, nextValue) || !writePath(nextState.values, action.path, nextValue)) {
      warnings.push(`忽略与状态类型不匹配的动作：${action.type} ${action.path}`);
      continue;
    }
    applied++;
  }

  if (actions.length > maxActions) warnings.push(`动作数量超过上限，已截断为 ${maxActions} 条`);
  return { nextState, applied, warnings };
}

