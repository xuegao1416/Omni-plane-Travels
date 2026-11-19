/**
 * 经营模块的存档状态（`gameState.economy`，存盘在 business 分区 v2）。
 * 钱不在这里：经营收支直接进出主货币（player.currency），旧版「经营资金」迁移时并入钱袋。
 */
import type { GameState } from '../../schema/variables';
import type { EconomyConfig, HoldingDef, RiskLevel } from './config';

export const ECONOMY_STATE_VERSION = 2;

export interface HoldingState {
  level: number;
  status: 'active' | 'idle' | 'damaged';
  staff: number;
  /** 0..100，低于 30 视为受损。 */
  condition: number;
  acquiredTurn: number;
  /** 游戏中由 AI/事件新增、世界配置里没有的产业。 */
  custom?: HoldingDef;
}

export interface MarketState {
  /** 当前行情中间价。 */
  prices: Record<string, number>;
  /** 价格压力：正数表示被买多了（更贵），负数表示被卖多了（更便宜）。 */
  pressure: Record<string, number>;
  /** 上一次结算前的价格，用于显示涨跌。 */
  previous: Record<string, number>;
}

export interface ContractState {
  id: string;
  title: string;
  client: string;
  goods: string;
  quantity: number;
  reward: number;
  market?: string;
  /** 截止的绝对日序号（world.day）。 */
  deadlineDay: number;
  status: 'open' | 'done' | 'failed';
  createdTurn: number;
  source: string;
  penalty?: number;
}

export interface EconomyLedgerEntry {
  turn: number;
  day: number;
  kind: 'trade' | 'income' | 'upkeep' | 'build' | 'contract' | 'incident' | 'note' | 'legacy';
  description: string;
  /** 对钱袋的影响（正为收入）。 */
  amount: number;
}

export interface DailyReport {
  day: number;
  income: number;
  costs: number;
  net: number;
  lines: string[];
}

export interface EconomyState {
  version: 2;
  holdings: Record<string, HoldingState>;
  warehouse: Record<string, number>;
  markets: Record<string, MarketState>;
  contracts: ContractState[];
  reputation: Record<string, number>;
  ledger: EconomyLedgerEntry[];
  reports: DailyReport[];
  /** 累计统计。 */
  totals: { revenue: number; costs: number; trades: number; contractsDone: number };
  /** 迁移/开局时已并入钱袋的启动资金（防重复）。 */
  fundsMerged: boolean;
}

export function emptyEconomyState(): EconomyState {
  return {
    version: ECONOMY_STATE_VERSION,
    holdings: {},
    warehouse: {},
    markets: {},
    contracts: [],
    reputation: {},
    ledger: [],
    reports: [],
    totals: { revenue: 0, costs: 0, trades: 0, contractsDone: 0 },
    fundsMerged: false,
  };
}

type LegacyAsset = NonNullable<GameState['玩家']['经营资产']>['资产列表'][number];

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function riskLevel(value: unknown): RiskLevel {
  return value === 'high' || value === 'medium' ? value : 'low';
}

/** 旧版运行时资产 → 产业定义（世界配置里没有的资产按存档内容建档）。 */
export function holdingFromLegacyAsset(asset: LegacyAsset, index: number): HoldingDef {
  return {
    id: String(asset.id || `asset-${index + 1}`),
    name: String(asset.名称 || asset.类型 || asset.id || '未命名产业'),
    type: String(asset.类型 || ''),
    description: String(asset.描述 || ''),
    maxLevel: Math.max(1, Math.trunc(finite(asset.最高等级, 3))),
    purchaseCost: 0,
    upgradeCost: Math.max(0, finite(asset.升级费用, 100)),
    purchaseMaterials: {},
    upgradeMaterials: {},
    income: { base: finite(asset.基础收益, 0), perLevel: finite(asset.每级收益, 0) },
    upkeep: Math.max(0, finite(asset.维护费, 0)),
    staff: { max: Math.max(Math.trunc(finite(asset.员工人数, 0)), 0), wage: 0, efficiency: Math.max(0.1, finite(asset.员工效率, 1)) },
    risk: { level: riskLevel(asset.风险等级), description: '' },
    storage: 0,
    initiallyOwned: false,
    initialLevel: Math.max(1, Math.trunc(finite(asset.等级, 1))),
    initialStaff: Math.max(0, Math.trunc(finite(asset.员工人数, 0))),
    tags: Array.isArray(asset.市场标签) ? asset.市场标签.map(String) : [],
  };
}

export function holdingStateFromLegacy(asset: LegacyAsset, def: HoldingDef | undefined, turn: number): HoldingState {
  const status = asset.状态 === 'idle' ? 'idle' : asset.状态 === 'damaged' || asset.状态 === 'destroyed' ? 'damaged' : 'active';
  return {
    level: Math.max(1, Math.min(def?.maxLevel ?? 99, Math.trunc(finite(asset.等级, 1)))),
    status,
    staff: Math.max(0, Math.trunc(finite(asset.员工人数, def?.initialStaff ?? 0))),
    condition: status === 'damaged' ? 25 : 100,
    acquiredTurn: turn,
  };
}

/**
 * 旧字段（玩家.经营资产 / gameplay.business）→ v2。
 * 旧版资金并入钱袋这一步在模块的 prepare 里做（需要变量注册表写主货币）。
 */
export function migrateLegacyEconomy(state: GameState, config: EconomyConfig, turn: number): { economy: EconomyState; legacyFunds: number } {
  const next = emptyEconomyState();
  const legacy = state.玩家.经营资产;
  const runtime = state.gameplay?.business;
  const defs = new Map(config.holdings.map(def => [def.id, def]));
  (legacy?.资产列表 ?? []).forEach((asset, index) => {
    if (!asset || typeof asset !== 'object') return;
    const id = String(asset.id || `asset-${index + 1}`);
    const def = defs.get(id);
    const holding = holdingStateFromLegacy(asset, def, turn);
    if (!def) holding.custom = holdingFromLegacyAsset(asset, index);
    next.holdings[id] = holding;
  });
  for (const [goods, amount] of Object.entries({ ...(runtime?.inventory ?? {}), ...(legacy?.库存 ?? {}) })) {
    const quantity = Math.max(0, finite(amount, 0));
    if (quantity > 0) next.warehouse[goods] = quantity;
  }
  for (const entry of legacy?.交易日志 ?? []) {
    if (!entry || typeof entry !== 'object') continue;
    next.ledger.push({ turn, day: 0, kind: 'legacy', description: String(entry.描述 ?? ''), amount: finite(entry.金额, 0) });
  }
  next.ledger = next.ledger.slice(-config.rules.logLimit);
  return { economy: next, legacyFunds: Math.max(0, finite(legacy?.资金, 0)) };
}

export function normalizeEconomyState(raw: unknown): EconomyState | undefined {
  if (!raw || typeof raw !== 'object' || (raw as EconomyState).version !== ECONOMY_STATE_VERSION) return undefined;
  const value = raw as Partial<EconomyState>;
  const base = emptyEconomyState();
  return {
    ...base,
    ...value,
    version: ECONOMY_STATE_VERSION,
    holdings: { ...(value.holdings ?? {}) },
    warehouse: { ...(value.warehouse ?? {}) },
    markets: { ...(value.markets ?? {}) },
    contracts: [...(value.contracts ?? [])],
    reputation: { ...(value.reputation ?? {}) },
    ledger: [...(value.ledger ?? [])],
    reports: [...(value.reports ?? [])],
    totals: { ...base.totals, ...(value.totals ?? {}) },
    fundsMerged: value.fundsMerged === true,
  };
}

export function clearLegacyEconomyFields(state: GameState): void {
  const player = state.玩家 as unknown as Record<string, unknown>;
  delete player.经营资产;
  if (state.gameplay) delete state.gameplay.business;
}
