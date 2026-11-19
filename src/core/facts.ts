/**
 * 变量（事实）注册表。
 *
 * 游戏里所有可读写的数值都在这里登记：规范路径（如 `player.resources.food`）、类型、范围、
 * 谁可以写、给玩家/导演看还是隐藏，以及旧版中文路径别名（如 `玩家.生存资源.food.数量`）。
 * 事件条件、事件效果、AI 变量提取、自创模块、宏和生成器提示词都通过它访问状态，
 * 存储位置变化时只需改登记，不再到处改路径字符串。
 */
import type { GameState } from '../schema/variables';
import { getGameplayPath, removeGameplayPath, setGameplayPath } from './state';
import type { GameplayStateRoot } from '../gameplay/types';

export type FactType = 'number' | 'string' | 'boolean' | 'list' | 'object' | 'any';
export type WriteSource = 'ai' | 'event' | 'player' | 'system' | 'custom' | 'director';
export type FactParams = Record<string, string>;
export type FactVisibility = 'player' | 'director' | 'hidden';

export interface FactBounds {
  min?: number;
  max?: number;
  integer?: boolean;
}

export interface FactSpec {
  /** 规范路径模式，`{name}` 匹配一段，如 `player.resources.{id}`。 */
  id: string;
  module: string;
  type: FactType;
  /** 中文名，可含 `{name}` 占位。 */
  label: string;
  description?: string;
  unit?: string;
  /** 旧路径模式，参数名必须与 id 一致。 */
  aliases?: readonly string[];
  /** 存储路径模式；给出时默认按路径读写。 */
  storage?: string;
  /** 允许直接 set/add 的来源；未列出的来源只能通过模块命令改动。 */
  writable?: readonly WriteSource[];
  visibility?: FactVisibility;
  bounds?: FactBounds | ((state: GameState, params: FactParams) => FactBounds);
  read?: (state: GameState, params: FactParams) => unknown;
  /** 自定义写入；返回 false 或拒绝原因表示拒绝。value 已按 bounds 钳位。 */
  write?: (state: GameState, params: FactParams, value: unknown) => boolean | string;
  /** 列出当前存档里这个模式对应的全部具体事实（供目录、编辑器和提示词）。 */
  enumerate?: (state: GameState) => Array<{ params: FactParams; label?: string }>;
}

export interface ResolvedFact {
  spec?: FactSpec;
  params: FactParams;
  /** 规范路径（raw 时等于原路径）。 */
  path: string;
  /** 实际存储路径（自定义读写时可能为空）。 */
  storagePath?: string;
  via: 'canonical' | 'alias' | 'raw';
}

export interface FactChange {
  path: string;
  fact?: string;
  before: unknown;
  after: unknown;
  source: WriteSource;
  label?: string;
}

export interface FactWriteResult {
  ok: boolean;
  change?: FactChange;
  reason?: string;
  /** 数值被钳位时记录原始请求值。 */
  clampedFrom?: unknown;
}

export interface CatalogEntry {
  path: string;
  pattern: string;
  label: string;
  type: FactType;
  module: string;
  writable: readonly WriteSource[];
  visibility: FactVisibility;
  bounds?: FactBounds;
  value: unknown;
  unit?: string;
  description?: string;
}

/** 没有登记的路径只允许在这些根下按原路径读写（兼容旧事件包和旧 AI 输出）。 */
export const RAW_FACT_ROOTS = new Set(['世界', '玩家', '人物档案', 'flags']);
const DANGEROUS = new Set(['__proto__', 'prototype', 'constructor']);

type Segment = { literal: string } | { param: string };

interface CompiledPattern {
  spec: FactSpec;
  segments: Segment[];
  kind: 'canonical' | 'alias';
}

function compile(pattern: string): Segment[] {
  return pattern.split('.').map(part => {
    const match = part.match(/^\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
    return match ? { param: match[1] } : { literal: part };
  });
}

export function normalizeFactPath(path: string): string {
  return path.trim().replace(/^\//, '').replaceAll('/', '.').replace(/\.{2,}/g, '.').replace(/\.$/, '');
}

function fill(pattern: string, params: FactParams): string {
  return pattern.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => params[name] ?? `{${name}}`);
}

function boundsOf(spec: FactSpec, state: GameState, params: FactParams): FactBounds | undefined {
  return typeof spec.bounds === 'function' ? spec.bounds(state, params) : spec.bounds;
}

function clampNumber(value: number, bounds: FactBounds | undefined): number {
  let next = value;
  if (bounds?.integer) next = Math.round(next);
  if (bounds?.min !== undefined) next = Math.max(bounds.min, next);
  if (bounds?.max !== undefined) next = Math.min(bounds.max, next);
  return next;
}

function cloneValue<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return structuredClone(value);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

export class FactRegistry {
  private readonly patterns: CompiledPattern[] = [];
  private readonly specs = new Map<string, FactSpec>();
  /** true：任何安全路径都按原路径读写（只给本地内部事务用，AI 与事件写入不用）。 */
  private readonly anyRoot: boolean;

  constructor(specs: readonly FactSpec[] = [], options: { anyRoot?: boolean } = {}) {
    this.anyRoot = options.anyRoot === true;
    for (const spec of specs) this.register(spec);
  }

  register(spec: FactSpec): this {
    if (this.specs.has(spec.id)) {
      // 后注册的覆盖先注册的（模块可以精化核心事实）。
      for (let index = this.patterns.length - 1; index >= 0; index--) {
        if (this.patterns[index].spec.id === spec.id) this.patterns.splice(index, 1);
      }
    }
    this.specs.set(spec.id, spec);
    this.patterns.push({ spec, segments: compile(spec.id), kind: 'canonical' });
    for (const alias of spec.aliases ?? []) this.patterns.push({ spec, segments: compile(alias), kind: 'alias' });
    // 字面量多的模式优先匹配，避免 `player.{x}` 吃掉 `player.currency`。
    this.patterns.sort((left, right) => {
      const literals = (segments: Segment[]) => segments.filter(segment => 'literal' in segment).length;
      return literals(right.segments) - literals(left.segments) || right.segments.length - left.segments.length;
    });
    return this;
  }

  list(): FactSpec[] {
    return [...this.specs.values()];
  }

  get(id: string): FactSpec | undefined {
    return this.specs.get(id);
  }

  resolve(rawPath: string): ResolvedFact | null {
    const path = normalizeFactPath(rawPath);
    const parts = path.split('.');
    if (!path || parts.some(part => !part || DANGEROUS.has(part))) return null;
    for (const entry of this.patterns) {
      if (entry.segments.length !== parts.length) continue;
      const params: FactParams = {};
      let matched = true;
      for (let index = 0; index < parts.length; index++) {
        const segment = entry.segments[index];
        if ('literal' in segment) {
          if (segment.literal !== parts[index]) { matched = false; break; }
        } else {
          params[segment.param] = parts[index];
        }
      }
      if (!matched) continue;
      return {
        spec: entry.spec,
        params,
        path: fill(entry.spec.id, params),
        storagePath: entry.spec.storage ? fill(entry.spec.storage, params) : undefined,
        via: entry.kind,
      };
    }
    if (!RAW_FACT_ROOTS.has(parts[0]) && !this.anyRoot) return null;
    return { params: {}, path, storagePath: path, via: 'raw' };
  }

  /**
   * 解析失败返回 undefined；raw 路径按原样读取。
   * 未登记的其他路径（如旧事件包条件里的 `dice.lastRoll.total`）只读不写。
   */
  read(state: GameState, path: string): unknown {
    const resolved = this.resolve(path);
    if (!resolved) {
      const raw = normalizeFactPath(path);
      const parts = raw.split('.');
      if (!raw || parts.some(part => !part || DANGEROUS.has(part))) return undefined;
      return getGameplayPath(state, raw);
    }
    if (resolved.spec?.read) return resolved.spec.read(state, resolved.params);
    return resolved.storagePath ? getGameplayPath(state, resolved.storagePath) : undefined;
  }

  canWrite(path: string, source: WriteSource): boolean {
    const resolved = this.resolve(path);
    if (!resolved) return false;
    if (!resolved.spec) return source !== 'custom';
    return (resolved.spec.writable ?? ['system']).includes(source) || source === 'system';
  }

  set(state: GameState, path: string, value: unknown, source: WriteSource, label?: string): FactWriteResult {
    const resolved = this.resolve(path);
    if (!resolved) return { ok: false, reason: `未知变量路径：${path}` };
    if (!this.canWrite(path, source)) return { ok: false, reason: `${resolved.spec?.label ?? path} 不允许由 ${source} 直接修改` };
    const spec = resolved.spec;
    let next = cloneValue(value);
    let clampedFrom: unknown;
    if (spec?.type === 'number') {
      const numeric = Number(next);
      if (!Number.isFinite(numeric)) return { ok: false, reason: `${spec.label} 需要数字，收到 ${JSON.stringify(value)}` };
      const clamped = clampNumber(numeric, boundsOf(spec, state, resolved.params));
      if (clamped !== numeric) clampedFrom = numeric;
      next = clamped;
    } else if (spec?.type === 'string' && typeof next !== 'string') {
      if (next === null || next === undefined || typeof next === 'object') return { ok: false, reason: `${spec.label} 需要文本` };
      next = String(next);
    } else if (spec?.type === 'boolean' && typeof next !== 'boolean') {
      next = next === 'true' ? true : next === 'false' ? false : Boolean(next);
    }
    const before = cloneValue(this.read(state, path));
    if (sameValue(before, next)) return { ok: true, clampedFrom };
    const ok = spec?.write
      ? spec.write(state, resolved.params, next)
      : resolved.storagePath ? setGameplayPath(state as unknown as GameplayStateRoot, resolved.storagePath, next) : false;
    if (typeof ok === 'string') return { ok: false, reason: ok };
    if (!ok) return { ok: false, reason: `${spec ? fill(spec.label, resolved.params) : path} 写入失败` };
    return {
      ok: true,
      clampedFrom,
      change: { path: resolved.storagePath ?? resolved.path, fact: resolved.via === 'raw' ? undefined : resolved.path,
        before, after: cloneValue(this.read(state, path)), source, label },
    };
  }

  /** 数值增减。strict=true 时结果越界直接拒绝（用于「支付」类消耗）。 */
  add(state: GameState, path: string, delta: number, source: WriteSource, options: { strict?: boolean; label?: string; create?: boolean; min?: number; max?: number } = {}): FactWriteResult {
    const resolved = this.resolve(path);
    if (!resolved) return { ok: false, reason: `未知变量路径：${path}` };
    if (resolved.spec && resolved.spec.type !== 'number' && resolved.spec.type !== 'any') {
      return { ok: false, reason: `数值路径无效：${fill(resolved.spec.label, resolved.params)} 不是数值` };
    }
    if (!Number.isFinite(delta)) return { ok: false, reason: `增量不是有效数字：${delta}` };
    const current = this.read(state, path);
    if (current === undefined && resolved.via === 'raw' && options.create === false) return { ok: false, reason: `${path} 不存在` };
    const base = Number(current ?? 0);
    if (!Number.isFinite(base)) return { ok: false, reason: `数值路径无效：${resolved.spec ? fill(resolved.spec.label, resolved.params) : path} 当前值不是数字` };
    let target = base + delta;
    if (options.min !== undefined && Number.isFinite(options.min)) target = Math.max(options.min, target);
    if (options.max !== undefined && Number.isFinite(options.max)) target = Math.min(options.max, target);
    if (options.strict && resolved.spec) {
      const bounds = boundsOf(resolved.spec, state, resolved.params);
      if (bounds?.min !== undefined && target < bounds.min) {
        return { ok: false, reason: `${fill(resolved.spec.label, resolved.params)} 不足：需要 ${Math.abs(delta)}，现有 ${base}` };
      }
    }
    return this.set(state, path, target, source, options.label);
  }

  remove(state: GameState, path: string, source: WriteSource, label?: string): FactWriteResult {
    const resolved = this.resolve(path);
    if (!resolved?.storagePath) return { ok: false, reason: `不能删除：${path}` };
    if (!this.canWrite(path, source)) return { ok: false, reason: `${path} 不允许由 ${source} 删除` };
    const before = cloneValue(getGameplayPath(state, resolved.storagePath));
    if (before === undefined) return { ok: true };
    if (!removeGameplayPath(state as unknown as GameplayStateRoot, resolved.storagePath)) return { ok: false, reason: `${path} 删除失败` };
    return { ok: true, change: { path: resolved.storagePath, fact: resolved.via === 'raw' ? undefined : resolved.path, before, after: undefined, source, label } };
  }

  label(path: string): string {
    const resolved = this.resolve(path);
    if (!resolved?.spec) return path;
    return fill(resolved.spec.label, resolved.params);
  }

  /** 展开为当前存档里的具体事实列表。 */
  catalog(state: GameState, options: { audience?: FactVisibility; module?: string } = {}): CatalogEntry[] {
    const out: CatalogEntry[] = [];
    for (const spec of this.specs.values()) {
      if (options.module && spec.module !== options.module) continue;
      const visibility = spec.visibility ?? 'player';
      if (options.audience === 'player' && visibility !== 'player') continue;
      if (options.audience === 'director' && visibility === 'hidden') continue;
      const instances = spec.id.includes('{')
        ? (spec.enumerate?.(state) ?? [])
        : [{ params: {} as FactParams, label: undefined as string | undefined }];
      for (const instance of instances) {
        const path = fill(spec.id, instance.params);
        const labelParams = { ...instance.params, name: instance.label ?? instance.params.name ?? instance.params.id ?? '' };
        out.push({
          path,
          pattern: spec.id,
          label: instance.label ? fill(spec.label, labelParams) : fill(spec.label, labelParams),
          type: spec.type,
          module: spec.module,
          writable: spec.writable ?? ['system'],
          visibility,
          bounds: boundsOf(spec, state, instance.params),
          value: this.read(state, path),
          unit: spec.unit,
          description: spec.description,
        });
      }
    }
    return out;
  }
}
