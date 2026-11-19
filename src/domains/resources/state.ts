/**
 * 资源模块的存档状态（`gameState.resources`，存盘在 survival 分区 v2）。
 * 世界定义（名字、上限、消耗）留在配置里；存档只记数量、运行时变化和账本。
 */
import type { GameState } from '../../schema/variables';
import { normalizeRecipe, type RecipeDef, type ResourceDef, type ResourcesConfig } from './config';

export const RESOURCES_STATE_VERSION = 2;

export interface ResourceLedgerEntry {
  turn: number;
  minute: number;
  reason: string;
  changes: Array<{ id: string; delta: number; after: number }>;
}

export interface ActiveStatus {
  since: number;
  sinceMinute: number;
  untilMinute?: number;
  source: string;
}

export interface ResourcesState {
  version: 2;
  stocks: Record<string, number>;
  /** 运行时上限（初始取配置，可被储物设施等提高）。 */
  capacity: Record<string, number>;
  /** 游戏中新发现的资源定义。 */
  discovered: Record<string, ResourceDef>;
  /** 已被淘汰的配置资源。 */
  retired: string[];
  unlockedRecipes: string[];
  customRecipes: RecipeDef[];
  statuses: Record<string, ActiveStatus>;
  evolved: string[];
  ledger: ResourceLedgerEntry[];
}

export const LEDGER_LIMIT = 40;

type LegacyResource = {
  数量?: number;
  最大值?: number;
  name?: string;
  symbol?: string;
  scarce?: boolean;
  description?: string;
  gatherRate?: string;
  usage?: string;
};

export function emptyResourcesState(): ResourcesState {
  return {
    version: RESOURCES_STATE_VERSION,
    stocks: {},
    capacity: {},
    discovered: {},
    retired: [],
    unlockedRecipes: [],
    customRecipes: [],
    statuses: {},
    evolved: [],
    ledger: [],
  };
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 旧存档字段（玩家.生存资源 / 玩家.生存配方 / gameplay.survival / simulationRuntime.evolvedSteps）→ v2。 */
export function migrateLegacyResources(state: GameState, config: ResourcesConfig): ResourcesState {
  const next = emptyResourcesState();
  const player = state.玩家 as GameState['玩家'] & { 生存资源?: Record<string, LegacyResource>; 生存配方?: unknown[] };
  const legacy = player.生存资源 ?? {};
  const known = new Map(config.resources.map(resource => [resource.id, resource]));
  for (const [id, entry] of Object.entries(legacy)) {
    if (!entry || typeof entry !== 'object') continue;
    const def = known.get(id);
    const quantity = Math.max(0, finite(entry.数量, 0));
    next.stocks[id] = quantity;
    const max = finite(entry.最大值, def?.max ?? Math.max(quantity, 10));
    if (!def || max !== def.max) next.capacity[id] = Math.max(1, max);
    if (!def) {
      next.discovered[id] = {
        id,
        name: entry.name || id,
        symbol: entry.symbol || '',
        kind: 'material',
        initial: quantity,
        max: Math.max(1, max),
        scarce: entry.scarce === true,
        description: entry.description || '游戏中发现的资源',
        upkeep: 0,
        lowAt: 0,
        spoilage: 0,
        gatherText: entry.gatherRate,
        usageText: entry.usage,
      };
    }
  }
  const legacyRecipes = Array.isArray(player.生存配方) ? player.生存配方 : [];
  next.customRecipes = legacyRecipes
    .filter(recipe => recipe && typeof recipe === 'object')
    .map((recipe, index) => normalizeRecipe(recipe as never, index, true));
  const runtime = state.gameplay?.survival;
  next.unlockedRecipes = Array.isArray(runtime?.unlockedRecipes) ? [...new Set(runtime!.unlockedRecipes.map(String))] : [];
  for (const [id, status] of Object.entries(runtime?.statuses ?? {})) {
    next.statuses[id] = { since: 0, sinceMinute: 0, source: status?.source ?? 'legacy' };
  }
  const evolved = state.simulationRuntime?.evolvedSteps;
  next.evolved = Array.isArray(evolved) ? evolved.filter(step => config.evolution.some(item => item.id === step)) : [];
  return next;
}

export function normalizeResourcesState(raw: unknown): ResourcesState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<ResourcesState>;
  if (value.version !== RESOURCES_STATE_VERSION) return undefined;
  const base = emptyResourcesState();
  return {
    ...base,
    ...value,
    version: RESOURCES_STATE_VERSION,
    stocks: { ...(value.stocks ?? {}) },
    capacity: { ...(value.capacity ?? {}) },
    discovered: { ...(value.discovered ?? {}) },
    retired: [...(value.retired ?? [])],
    unlockedRecipes: [...(value.unlockedRecipes ?? [])],
    customRecipes: [...(value.customRecipes ?? [])],
    statuses: { ...(value.statuses ?? {}) },
    evolved: [...(value.evolved ?? [])],
    ledger: [...(value.ledger ?? [])].slice(-LEDGER_LIMIT),
  };
}

export function clearLegacyResourceFields(state: GameState): void {
  const player = state.玩家 as unknown as Record<string, unknown>;
  delete player.生存资源;
  delete player.生存配方;
  if (state.gameplay) delete state.gameplay.survival;
}
