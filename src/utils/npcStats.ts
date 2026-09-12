import type { StatModuleSchema } from '../modules/schema';
import type { GameState, SurvivalStats } from '../schema/variables';

type NumericRecord = Record<string, unknown>;

function finiteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function midpoint(range: unknown): number | undefined {
  if (!Array.isArray(range) || range.length < 2) return undefined;
  const low = finiteNumber(range[0]);
  const high = finiteNumber(range[1]);
  if (low === undefined || high === undefined) return undefined;
  return Math.round((low + high) / 2);
}

/** Materialize only numeric fields configured by the world's stat module. */
export function materializeNpcSurvivalStats(
  existing: NumericRecord | undefined,
  statConfig?: Partial<StatModuleSchema>,
): SurvivalStats {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(existing ?? {})) {
    const numeric = finiteNumber(value);
    if (numeric !== undefined) result[key] = numeric;
  }

  result.血量 ??= finiteNumber(statConfig?.attrA?.current)
    ?? finiteNumber(statConfig?.attrA?.max)
    ?? 100;
  result.体力值 ??= finiteNumber(statConfig?.attrB?.current)
    ?? finiteNumber(statConfig?.attrB?.max)
    ?? 100;

  for (const key of ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const) {
    const definition = statConfig?.[key];
    if (!definition || result[key] !== undefined) continue;
    result[key] = finiteNumber(definition.value) ?? midpoint(definition.range) ?? 0;
  }
  for (const special of statConfig?.special ?? []) {
    if (!special?.id || result[special.id] !== undefined) continue;
    result[special.id] = finiteNumber(special.value) ?? midpoint(special.range) ?? 0;
  }

  return result as SurvivalStats;
}

export function materializeNpcTierIndex(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0) return numeric;
  const fallbackNumeric = Number(fallback);
  return Number.isInteger(fallbackNumeric) && fallbackNumeric >= 0 ? fallbackNumeric : 0;
}

function sameNumericRecord(left: NumericRecord, right: SurvivalStats): boolean {
  const leftEntries = Object.entries(left).filter(([, value]) => finiteNumber(value) !== undefined);
  return leftEntries.length === Object.keys(right).length
    && leftEntries.every(([key, value]) => finiteNumber(value) === right[key]);
}

/** Apply deterministic module defaults after runtime NPC creation or legacy load. */
export function ensureNpcModuleDefaults(
  state: GameState,
  statConfig?: Partial<StatModuleSchema>,
  tierFallback?: number,
): boolean {
  let changed = false;
  for (const npc of Object.values(state.人物档案 ?? {})) {
    const currentStats = npc.生存状态 ?? {};
    const nextStats = materializeNpcSurvivalStats(currentStats, statConfig);
    if (!sameNumericRecord(currentStats, nextStats)) {
      npc.生存状态 = nextStats as typeof npc.生存状态;
      changed = true;
    }
    if (tierFallback !== undefined) {
      const currentTier = npc.成长状态?.当前段位索引;
      const nextTier = materializeNpcTierIndex(currentTier, tierFallback);
      if (currentTier !== nextTier) {
        npc.成长状态 = { ...(npc.成长状态 ?? {}), 当前段位索引: nextTier };
        changed = true;
      }
    }
  }
  return changed;
}
