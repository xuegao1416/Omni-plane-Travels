/**
 * 统一条件语言。事件触发器、卡片分支、规则、模块解锁条件都用它。
 * 兼容旧内核的 `{ state: { path, op, value } }` 写法，路径经变量注册表解析（含旧中文别名）。
 */
import type { GameState } from '../schema/variables';
import type { FactRegistry } from './facts';
import type { Rng } from './rng';

export type Literal = string | number | boolean | null | string[] | number[];
export type Comparator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'contains' | 'exists' | 'missing';

export interface EventLike {
  type: string;
  payload?: Record<string, unknown>;
}

export type CoreCondition =
  | { all: CoreCondition[] }
  | { any: CoreCondition[] }
  | { not: CoreCondition }
  | { fact: string; op: Comparator; value?: Literal }
  | { state: { path: string; op: Comparator; value?: Literal } }
  | { event: { type: string; where?: Record<string, Literal> } }
  /** 0..1 的种子概率；必须提供 rng，否则视为不满足。 */
  | { chance: number }
  /** 世界时钟小时区间（含首不含尾，可跨午夜，如 [20, 4]）。 */
  | { hours: [number, number] }
  /** 当前位置文本包含任一关键词。 */
  | { location: string[] };

export interface ConditionContext {
  state: GameState;
  facts: FactRegistry;
  events?: readonly EventLike[];
  rng?: Rng;
  hourOfDay?: number;
  maxDepth?: number;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return null;
}

export function compareValues(op: Comparator, left: unknown, right: Literal | undefined): boolean {
  switch (op) {
    case 'exists': return left !== undefined && left !== null && left !== '' && left !== false;
    case 'missing': return left === undefined || left === null || left === '' || left === false;
    case '==':
    case '!=': {
      const l = numeric(left);
      const r = numeric(right);
      const equal = l !== null && r !== null && (typeof left !== 'boolean' || typeof right === 'boolean')
        ? l === r
        : left === right || (left == null && right == null);
      return op === '==' ? equal : !equal;
    }
    case '>': case '>=': case '<': case '<=': {
      const l = numeric(left);
      const r = numeric(right);
      if (l === null || r === null) return false;
      if (op === '>') return l > r;
      if (op === '>=') return l >= r;
      if (op === '<') return l < r;
      return l <= r;
    }
    case 'in': return Array.isArray(right) && (right as unknown[]).some(item => item === left || numeric(item) !== null && numeric(item) === numeric(left));
    case 'contains':
      if (typeof left === 'string' && typeof right === 'string') return left.includes(right);
      if (Array.isArray(left)) return left.includes(right as never);
      if (left && typeof left === 'object' && typeof right === 'string') return right in (left as Record<string, unknown>);
      return false;
  }
}

function eventMatches(event: EventLike, expected: { type: string; where?: Record<string, Literal> }): boolean {
  const type = expected.type.trim();
  if (type !== '*' && event.type !== type && !(type.endsWith('.*') && event.type.startsWith(type.slice(0, -1)))) return false;
  if (!expected.where) return true;
  return Object.entries(expected.where).every(([key, value]) => compareValues('==', event.payload?.[key], value));
}

export function evaluateCondition(condition: CoreCondition | undefined | null, context: ConditionContext, depth = 0): boolean {
  if (!condition) return true;
  if (depth > (context.maxDepth ?? 12)) return false;
  if ('all' in condition) return condition.all.every(item => evaluateCondition(item, context, depth + 1));
  if ('any' in condition) return condition.any.some(item => evaluateCondition(item, context, depth + 1));
  if ('not' in condition) return !evaluateCondition(condition.not, context, depth + 1);
  if ('fact' in condition) return compareValues(condition.op, context.facts.read(context.state, condition.fact), condition.value);
  if ('state' in condition) return compareValues(condition.state.op, context.facts.read(context.state, condition.state.path), condition.state.value);
  if ('event' in condition) return (context.events ?? []).some(event => eventMatches(event, condition.event));
  if ('chance' in condition) return context.rng ? context.rng.chance(Number(condition.chance)) : false;
  if ('hours' in condition) {
    const hour = context.hourOfDay;
    if (hour === undefined) return false;
    const [from, to] = condition.hours;
    return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
  }
  if ('location' in condition) {
    const location = String(context.facts.read(context.state, 'world.location') ?? '');
    return condition.location.some(keyword => keyword && location.includes(keyword));
  }
  return false;
}

/** 列出条件引用的全部变量路径（用于校验与编辑器提示）。 */
export function conditionPaths(condition: CoreCondition | undefined | null, out: string[] = []): string[] {
  if (!condition) return out;
  if ('all' in condition) condition.all.forEach(item => conditionPaths(item, out));
  else if ('any' in condition) condition.any.forEach(item => conditionPaths(item, out));
  else if ('not' in condition) conditionPaths(condition.not, out);
  else if ('fact' in condition) out.push(condition.fact);
  else if ('state' in condition) out.push(condition.state.path);
  return out;
}
