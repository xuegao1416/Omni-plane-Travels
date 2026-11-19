/**
 * 统一加成系统。
 *
 * 天赋、职业、状态（饥饿/受伤）、装备、事件结果对其他模块的影响都表示为修正器，
 * 按目标路径查询：修正器目标 `dice.check` 同时作用于 `dice.check.dim3` 等更具体的查询。
 * 存档里只保存「有时效」的修正器；常驻加成由模块按配置实时提供，不写进存档。
 */
import type { GameState } from '../schema/variables';
import { ensureGameplayRuntime } from './state';
import type { GameplayStateRoot } from '../gameplay/types';

export interface ModifierRecord {
  id: string;
  /** 作用目标，如 `dice.check`、`stat.dim1`、`resources.upkeep.food`、`economy.price.sell`。 */
  target: string;
  mode: 'flat' | 'mult';
  /** flat 为加减值；mult 为倍率增量（0.2 = +20%）。 */
  value: number;
  source: string;
  label?: string;
  /** 在这一回合（含）之后失效。 */
  expiresAfterTurn?: number;
  /** 世界时钟到达这一分钟后失效。 */
  expiresAtMinute?: number;
}

export interface ModifierSummary {
  flat: number;
  mult: number;
  entries: ModifierRecord[];
}

export type ModifierProvider = (state: GameState) => readonly ModifierRecord[];

type WithModifiers = { gameplay?: { modifiers?: Record<string, ModifierRecord> } };

export function storedModifiers(state: GameState): Record<string, ModifierRecord> {
  const gameplay = ensureGameplayRuntime(state as GameState & GameplayStateRoot) as WithModifiers['gameplay'] & object;
  if (!gameplay.modifiers || typeof gameplay.modifiers !== 'object') gameplay.modifiers = {};
  return gameplay.modifiers;
}

export function targetMatches(modifierTarget: string, query: string): boolean {
  return query === modifierTarget || query.startsWith(`${modifierTarget}.`);
}

export function addModifier(state: GameState, record: ModifierRecord): void {
  if (!record.id || !record.target || !Number.isFinite(record.value)) return;
  storedModifiers(state)[record.id] = { ...record };
}

export function removeModifier(state: GameState, id: string): boolean {
  const modifiers = storedModifiers(state);
  if (!(id in modifiers)) return false;
  delete modifiers[id];
  return true;
}

/** 移除到期修正器，返回被移除的记录。 */
export function expireModifiers(state: GameState, turn: number, minute?: number): ModifierRecord[] {
  const modifiers = storedModifiers(state);
  const expired: ModifierRecord[] = [];
  for (const [id, record] of Object.entries(modifiers)) {
    const turnDone = record.expiresAfterTurn !== undefined && turn > record.expiresAfterTurn;
    const minuteDone = record.expiresAtMinute !== undefined && minute !== undefined && minute >= record.expiresAtMinute;
    if (turnDone || minuteDone) {
      expired.push(record);
      delete modifiers[id];
    }
  }
  return expired;
}

export class ModifierQuery {
  constructor(private readonly state: GameState, private readonly providers: readonly ModifierProvider[] = []) {}

  list(query: string): ModifierRecord[] {
    const stored = Object.values((this.state as WithModifiers).gameplay?.modifiers ?? {});
    const provided = this.providers.flatMap(provider => provider(this.state));
    return [...stored, ...provided].filter(record => targetMatches(record.target, query));
  }

  summarize(query: string): ModifierSummary {
    const entries = this.list(query);
    return {
      flat: entries.filter(entry => entry.mode === 'flat').reduce((sum, entry) => sum + entry.value, 0),
      mult: entries.filter(entry => entry.mode === 'mult').reduce((sum, entry) => sum + entry.value, 0),
      entries,
    };
  }

  /** (base + flat) × (1 + mult)，倍率总和不低于 -100%。 */
  apply(query: string, base: number): number {
    const summary = this.summarize(query);
    return (base + summary.flat) * Math.max(0, 1 + summary.mult);
  }
}
