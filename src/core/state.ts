/**
 * 状态存取的底层工具：安全的点路径读写、玩法运行时账本（state.gameplay）的创建与修复、
 * 状态差异转成效果。原先在 gameplay/kernel.ts，内核退役后由核心层持有。
 */
import type { GameState } from '../schema/variables';
import type { GameplayRuntimeState, GameplayStateRoot } from '../gameplay/types';
import { diffStates } from './diff';
import type { Op } from './ops';

export const GAMEPLAY_SCHEMA_VERSION = 1;
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function clone<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return structuredClone(value);
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

function getParentForPath(root: GameplayStateRoot, path: string, create: boolean): { parent: Record<string, unknown>; key: string } | null {
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

export function removeGameplayPath(root: GameplayStateRoot, path: string): boolean {
  const target = getParentForPath(root, path, false);
  if (!target || !(target.key in target.parent)) return false;
  delete target.parent[target.key];
  return true;
}

export function createDefaultGameplayRuntime(): GameplayRuntimeState {
  return {
    schemaVersion: GAMEPLAY_SCHEMA_VERSION,
    sequence: 0,
    pendingEvents: [],
    eventHistory: [],
    scheduledEvents: [],
    logs: [],
    settlementKeys: {},
    stat: { modifiers: {}, base: {}, derived: {} },
    survival: { unlockedRecipes: [], statuses: {} },
    business: { inventory: {}, productionCycles: {} },
  };
}

/** 读档或旧存档缺字段时就地补齐账本结构，返回可写的运行时对象。 */
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

/**
 * 把两份状态的差异转成 set/remove 效果。数组与标量整体替换，普通对象逐层比较，
 * 这样一次结算不会把整份存档复制进日志。账本字段（见 diff.ts）不参与。
 */
export function stateDiffOps(before: unknown, after: unknown): Op[] {
  return diffStates(before, after).map(change => change.after === undefined
    ? { op: 'remove' as const, path: change.path }
    : { op: 'set' as const, path: change.path, value: clone(change.after) });
}

export type { GameState };
