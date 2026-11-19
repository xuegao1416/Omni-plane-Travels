/**
 * 经营模块配置（世界里的 `business` 模块）规范化。
 *
 * 旧配置只有静态资产收益表和一张不参与结算的行情表。新配置把它拆成：
 * 商品（基准价、波动、走势）、市场（进货/出货价差、所需地点）、产业（收益、维护、员工、风险、生产）、
 * 仓库容量、订单模板与规则。旧配置在加载时一次性转换，世界作者和 AI 生成的旧格式继续可用。
 */
import type { BusinessAsset, BusinessModuleSchema, MarketItem } from '../../modules/schema';
import type { CoreCondition } from '../../core/conditions';
import { periodFromCycleName } from '../../core/cycles';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface GoodsDef {
  id: string;
  name: string;
  basePrice: number;
  /** 每日价格波动幅度（0.2 = ±20%）。 */
  volatility: number;
  /** 长期走势：每天额外偏移的比例。 */
  drift: number;
  unit: string;
  description: string;
}

export interface MarketDef {
  id: string;
  name: string;
  description: string;
  /** 该市场的商品价格倍率；未列出的商品按 1。 */
  priceFactor: Record<string, number>;
  /** 买入价相对行情的溢价（0.1 = 贵 10%）。 */
  buyMarkup: number;
  /** 卖出价相对行情的折价（0.1 = 便宜 10%）。 */
  sellDiscount: number;
  /** 市场深度：单次成交多少件会把价格推高/压低约 10%。 */
  depth: number;
  /** 只交易这些商品；空表示全部。 */
  goods: string[];
  /** 需要身处的地点关键词（任一命中即可）；空表示随处可交易。 */
  locations: string[];
}

export interface ProductionDef {
  inputs: Record<string, number>;
  outputs: Record<string, number>;
}

export interface HoldingDef {
  id: string;
  name: string;
  type: string;
  description: string;
  maxLevel: number;
  purchaseCost: number;
  /** 升到下一级的费用 = upgradeCost × 当前等级。 */
  upgradeCost: number;
  purchaseMaterials: Record<string, number>;
  upgradeMaterials: Record<string, number>;
  income: { base: number; perLevel: number };
  upkeep: number;
  staff: { max: number; wage: number; efficiency: number };
  risk: { level: RiskLevel; description: string };
  production?: ProductionDef;
  /** 提供的仓库容量。 */
  storage: number;
  initiallyOwned: boolean;
  initialLevel: number;
  initialStaff: number;
  tags: string[];
}

export interface ContractTemplate {
  id: string;
  title: string;
  client: string;
  goods: string;
  quantity: [number, number];
  /** 酬金相对行情货值的倍数。 */
  premium: number;
  days: [number, number];
  market?: string;
}

export interface EconomyConfig {
  version: 2;
  description: string;
  cycle: 'day' | 'week' | 'turn';
  cycleLabel: string;
  startingFunds: number;
  goods: GoodsDef[];
  markets: MarketDef[];
  holdings: HoldingDef[];
  warehouseCapacity: number;
  contracts: ContractTemplate[];
  rules: {
    autoIdleOnDeficit: boolean;
    /** 每天自动出现订单的概率。 */
    contractChance: number;
    /** 价格压力每天恢复的比例。 */
    demandRecovery: number;
    logLimit: number;
  };
  unlock?: CoreCondition;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function goodsIdFromName(name: string, index: number): string {
  const ascii = name.replace(/[^A-Za-z0-9_-]/g, '');
  return ascii.length >= 2 ? ascii.toLowerCase() : name.replace(/[.\s/\\]+/g, '_') || `goods_${index + 1}`;
}

function record(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, amount] of Object.entries(value as Record<string, unknown>)) {
    const parsed = Number(amount);
    if (key && Number.isFinite(parsed) && parsed > 0) out[key] = parsed;
  }
  return out;
}

function normalizeGoods(raw: MarketItem & Record<string, unknown>, index: number): GoodsDef {
  const name = text(raw.name, `商品 ${index + 1}`) || `商品 ${index + 1}`;
  const change = num(raw.changePercent, 10, 0, 300) / 100;
  const volatility = raw.volatility !== undefined ? num(raw.volatility, 0.1, 0, 1) : Math.min(0.35, Math.max(0.03, change / 2));
  const trend = text(raw.trend);
  const drift = raw.drift !== undefined ? num(raw.drift, 0, -0.2, 0.2) : trend === 'up' ? volatility / 6 : trend === 'down' ? -volatility / 6 : 0;
  return {
    id: text(raw.id) || goodsIdFromName(name, index),
    name,
    basePrice: Math.max(0.01, num(raw.basePrice, 10, 0.01)),
    volatility,
    drift,
    unit: text(raw.unit, '件') || '件',
    description: text(raw.description),
  };
}

function normalizeHolding(raw: BusinessAsset & Record<string, unknown>, index: number): HoldingDef {
  const income = (raw.income ?? {}) as Partial<BusinessAsset['income']>;
  const staff = (raw.staff ?? {}) as Partial<NonNullable<BusinessAsset['staff']>> & { wage?: number };
  const risk = (raw.risk ?? {}) as Partial<NonNullable<BusinessAsset['risk']>>;
  const production = income.inputs || income.outputs || raw.production
    ? {
      inputs: record((raw.production as ProductionDef | undefined)?.inputs ?? income.inputs),
      outputs: record((raw.production as ProductionDef | undefined)?.outputs ?? income.outputs),
    }
    : undefined;
  const maxLevel = Math.max(1, Math.trunc(num(raw.maxLevel, 3, 1, 20)));
  return {
    id: text(raw.id) || `holding_${index + 1}`,
    name: text(raw.name, `产业 ${index + 1}`) || `产业 ${index + 1}`,
    type: text(raw.type),
    description: text(raw.description),
    maxLevel,
    purchaseCost: Math.max(0, num(raw.purchaseCost, num(raw.upgradeCost, 0, 0) * 2, 0)),
    upgradeCost: Math.max(0, num(raw.upgradeCost, 100, 0)),
    purchaseMaterials: record(raw.purchaseMaterials),
    upgradeMaterials: record(raw.upgradeMaterials),
    income: { base: num(income.base, 0), perLevel: num(income.perLevel, 0) },
    upkeep: Math.max(0, num(raw.maintenance ?? raw.upkeep, 0, 0)),
    staff: { max: Math.max(0, Math.trunc(num(staff.max, 0, 0, 999))), wage: Math.max(0, num(staff.wage, 0, 0)), efficiency: num(staff.efficiency, 1, 0.1, 3) },
    risk: { level: risk.level === 'high' || risk.level === 'medium' ? risk.level : 'low', description: text(risk.description) },
    ...(production && (Object.keys(production.inputs).length || Object.keys(production.outputs).length) ? { production } : {}),
    storage: Math.max(0, Math.trunc(num(raw.storage, 0, 0))),
    // 与旧版一致：没有明确写 initiallyOwned: false 的资产开局即拥有。
    initiallyOwned: raw.initiallyOwned !== false,
    initialLevel: Math.max(1, Math.min(maxLevel, Math.trunc(num(raw.level ?? raw.initialLevel, 1, 1)))),
    initialStaff: Math.max(0, Math.trunc(num(staff.current ?? raw.initialStaff, 0, 0))),
    tags: Array.isArray(raw.tags ?? raw.marketTags) ? ((raw.tags ?? raw.marketTags) as unknown[]).map(tag => text(tag)).filter(Boolean) : [],
  };
}

function normalizeMarket(raw: Record<string, unknown>, index: number): MarketDef {
  return {
    id: text(raw.id) || `market_${index + 1}`,
    name: text(raw.name, `市场 ${index + 1}`) || `市场 ${index + 1}`,
    description: text(raw.description),
    priceFactor: record(raw.priceFactor),
    buyMarkup: num(raw.buyMarkup, 0.08, 0, 2),
    sellDiscount: num(raw.sellDiscount, 0.08, 0, 0.95),
    depth: Math.max(1, num(raw.depth, 30, 1)),
    goods: Array.isArray(raw.goods) ? (raw.goods as unknown[]).map(item => text(item)).filter(Boolean) : [],
    locations: Array.isArray(raw.locations) ? (raw.locations as unknown[]).map(item => text(item)).filter(Boolean) : [],
  };
}

function normalizeContract(raw: Record<string, unknown>, index: number): ContractTemplate | null {
  const goods = text(raw.goods);
  if (!goods) return null;
  const pair = (value: unknown, fallback: [number, number]): [number, number] => {
    if (Array.isArray(value) && value.length === 2) {
      const low = Math.max(1, Math.trunc(num(value[0], fallback[0], 1)));
      return [low, Math.max(low, Math.trunc(num(value[1], fallback[1], 1)))];
    }
    const single = Math.trunc(num(value, NaN, 1));
    return Number.isFinite(single) ? [single, single] : fallback;
  };
  return {
    id: text(raw.id) || `contract_${index + 1}`,
    title: text(raw.title, '供货订单') || '供货订单',
    client: text(raw.client, '客商') || '客商',
    goods,
    quantity: pair(raw.quantity, [5, 15]),
    premium: num(raw.premium, 1.35, 1, 5),
    days: pair(raw.days, [3, 6]),
    ...(text(raw.market) ? { market: text(raw.market) } : {}),
  };
}

/** 世界配置（旧版 BusinessModuleSchema 或 v2）→ v2。 */
export function normalizeEconomyConfig(raw: BusinessModuleSchema | EconomyConfig | undefined | null): EconomyConfig {
  const source = (raw ?? {}) as BusinessModuleSchema & Record<string, unknown>;
  const v2 = (source as Record<string, unknown>).version === 2;
  const goodsSource = (v2 ? (source as Record<string, unknown>).goods : source.market?.items) as Array<MarketItem & Record<string, unknown>> | undefined;
  const goods: GoodsDef[] = [];
  for (const [index, item] of (Array.isArray(goodsSource) ? goodsSource : []).entries()) {
    const def = normalizeGoods(item, index);
    if (!goods.some(existing => existing.id === def.id)) goods.push(def);
  }
  const marketSource = (source as Record<string, unknown>).markets;
  const markets = Array.isArray(marketSource) && marketSource.length
    ? (marketSource as Record<string, unknown>[]).map(normalizeMarket)
    : goods.length ? [normalizeMarket({ id: 'local', name: '本地市场', description: '日常买卖的地方。' }, 0)] : [];
  const holdingSource = (v2 ? (source as Record<string, unknown>).holdings : source.assets) as Array<BusinessAsset & Record<string, unknown>> | undefined;
  const holdings = (Array.isArray(holdingSource) ? holdingSource : []).map(normalizeHolding);
  const rules = ((source as Record<string, unknown>).rules ?? {}) as Record<string, unknown>;
  const economy = (source.economy ?? {}) as NonNullable<BusinessModuleSchema['economy']>;
  // 旧版生产链挂到第一个产业上，没有产业时生成一个「作坊」承载。
  for (const [index, production] of (economy.production ?? []).entries()) {
    const target = holdings[index] ?? holdings[0];
    const def = { inputs: record(production.inputs), outputs: record(production.outputs) };
    if (target && !target.production) target.production = def;
  }
  const cycleSource = text((source as Record<string, unknown>).cycle) || text(source.cycleName);
  const period = periodFromCycleName(cycleSource, 'day');
  const cycle: EconomyConfig['cycle'] = period === 'turn' ? 'turn' : period === 'week' || period === 'month' ? 'week' : 'day';
  const contractSource = (source as Record<string, unknown>).contracts;
  return {
    version: 2,
    description: text(source.description),
    cycle,
    cycleLabel: cycle === 'turn' ? '每回合' : cycle === 'week' ? '每周' : '每日',
    startingFunds: Math.max(0, num(v2 ? (source as Record<string, unknown>).startingFunds : source.funds, 0, 0)),
    goods,
    markets,
    holdings,
    warehouseCapacity: Math.max(0, Math.trunc(num((source as Record<string, unknown>).warehouseCapacity, 60, 0))),
    contracts: (Array.isArray(contractSource) ? contractSource as Record<string, unknown>[] : []).map(normalizeContract).filter((item): item is ContractTemplate => Boolean(item)),
    rules: {
      autoIdleOnDeficit: (rules.autoIdleOnDeficit ?? economy.autoIdleOnDeficit) !== false,
      contractChance: num(rules.contractChance, goods.length ? 0.18 : 0, 0, 1),
      demandRecovery: num(rules.demandRecovery, 0.35, 0, 1),
      logLimit: Math.max(10, Math.min(200, Math.trunc(num(rules.logLimit ?? economy.logLimit, 60, 10)))),
    },
    ...((source as Record<string, unknown>).unlock ? { unlock: (source as Record<string, unknown>).unlock as CoreCondition } : {}),
  };
}
