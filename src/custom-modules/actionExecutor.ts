import type {
  CustomGameplayModule,
  CustomModuleAction,
  JsonValue,
  StateFieldDefinition,
} from './schema';
import type { CustomModuleRuntimeState } from './stateStore';

export interface ActionExecutionResult {
  nextState: CustomModuleRuntimeState;
  applied: number;
  warnings: string[];
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

function findField(module: CustomGameplayModule, path: string): StateFieldDefinition | undefined {
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

export function executeCustomModuleActions(
  module: CustomGameplayModule,
  state: CustomModuleRuntimeState,
  actions: CustomModuleAction[],
  lifecycle: string,
  now = 0,
  maxActions = 128,
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
    if (action.type === 'set') nextValue = action.value;
    if (action.type === 'toggle' && typeof current === 'boolean') nextValue = !current;
    if ((action.type === 'add' || action.type === 'subtract') && typeof current === 'number') {
      const delta = action.type === 'add' ? action.value : -action.value;
      nextValue = current + delta;
      if (field.type === 'number') {
        if (field.min !== undefined) nextValue = Math.max(field.min, nextValue);
        if (field.max !== undefined) nextValue = Math.min(field.max, nextValue);
      }
    }
    if ((action.type === 'append' || action.type === 'remove') && Array.isArray(current)) {
      const values = current.map((item) => clone(item as JsonValue));
      if (action.type === 'append') {
        const maxItems = field.type === 'array' ? field.maxItems : values.length;
        if (values.length < maxItems) values.push(clone(action.value));
      } else {
        const index = values.findIndex((item) => equal(item, action.value));
        if (index >= 0) values.splice(index, 1);
      }
      nextValue = values;
    }

    if (nextValue === undefined || !writePath(nextState.values, action.path, nextValue)) {
      warnings.push(`忽略与状态类型不匹配的动作：${action.type} ${action.path}`);
      continue;
    }
    applied++;
  }

  if (actions.length > maxActions) warnings.push(`动作数量超过上限，已截断为 ${maxActions} 条`);
  return { nextState, applied, warnings };
}

