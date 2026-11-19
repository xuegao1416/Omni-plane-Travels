/**
 * 市场价格模型（纯函数）。
 * - 每种商品在每个市场有行情中间价：按日随机游走（种子随机），并向「基准价 × 市场倍率」回归。
 * - 成交会推动价格：买得越多越贵、卖得越多越便宜；压力每天按比例恢复。
 * - 买入有溢价、卖出有折价，声望在 ±10% 内修正价差。
 */
import type { Rng } from '../../core/rng';
import type { EconomyConfig, GoodsDef, MarketDef } from './config';
import type { EconomyState, MarketState } from './state';

export function roundPrice(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= 100) return Math.round(value);
  if (value >= 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

export function marketGoods(config: EconomyConfig, market: MarketDef): GoodsDef[] {
  return market.goods.length ? config.goods.filter(goods => market.goods.includes(goods.id) || market.goods.includes(goods.name)) : config.goods;
}

export function findGoods(config: EconomyConfig, key: string): GoodsDef | undefined {
  return config.goods.find(goods => goods.id === key || goods.name === key);
}

export function findMarket(config: EconomyConfig, key: string | undefined): MarketDef | undefined {
  if (!key) return config.markets[0];
  return config.markets.find(market => market.id === key || market.name === key);
}

export function anchorPrice(goods: GoodsDef, market: MarketDef): number {
  const factor = market.priceFactor[goods.id] ?? market.priceFactor[goods.name] ?? 1;
  return goods.basePrice * factor;
}

export function initMarketState(config: EconomyConfig, market: MarketDef): MarketState {
  const prices: Record<string, number> = {};
  for (const goods of marketGoods(config, market)) prices[goods.id] = roundPrice(anchorPrice(goods, market));
  return { prices, pressure: {}, previous: { ...prices } };
}

export function ensureMarkets(config: EconomyConfig, economy: EconomyState): void {
  for (const market of config.markets) {
    const current = economy.markets[market.id];
    if (!current) {
      economy.markets[market.id] = initMarketState(config, market);
      continue;
    }
    for (const goods of marketGoods(config, market)) {
      if (current.prices[goods.id] === undefined) current.prices[goods.id] = roundPrice(anchorPrice(goods, market));
      current.previous[goods.id] ??= current.prices[goods.id];
    }
  }
}

export function midPrice(config: EconomyConfig, economy: EconomyState, market: MarketDef, goods: GoodsDef): number {
  return economy.markets[market.id]?.prices[goods.id] ?? roundPrice(anchorPrice(goods, market));
}

export interface Quote {
  unitPrice: number;
  total: number;
  /** 成交后的价格压力。 */
  pressureAfter: number;
}

/** 按成交量分段累计价格（越买越贵/越卖越便宜）。 */
export function quote(config: EconomyConfig, economy: EconomyState, market: MarketDef, goods: GoodsDef, quantity: number, side: 'buy' | 'sell', reputation = 0): Quote {
  const qty = Math.max(0, Math.trunc(quantity));
  const mid = midPrice(config, economy, market, goods);
  const pressure = economy.markets[market.id]?.pressure[goods.id] ?? 0;
  const impact = 0.1 / Math.max(1, market.depth);
  const rep = Math.max(-100, Math.min(100, reputation)) / 1000;
  const sideFactor = side === 'buy' ? (1 + market.buyMarkup) * (1 - rep) : (1 - market.sellDiscount) * (1 + rep);
  const direction = side === 'buy' ? 1 : -1;
  // 平均冲击 = 当前压力 + 批量中点的冲击。
  const averagePressure = pressure + direction * impact * qty / 2;
  const multiplier = Math.min(3, Math.max(0.3, 1 + averagePressure));
  const unit = mid * sideFactor * multiplier;
  return {
    unitPrice: roundPrice(unit),
    total: Math.round(unit * qty * 100) / 100,
    pressureAfter: Math.max(-0.7, Math.min(2, pressure + direction * impact * qty)),
  };
}

export function applyPressure(economy: EconomyState, market: MarketDef, goods: GoodsDef, pressure: number): void {
  const state = economy.markets[market.id];
  if (state) state.pressure[goods.id] = Math.round(pressure * 10000) / 10000;
}

/** 日结：价格随机游走 + 均值回归，压力恢复。返回涨跌幅最大的几条（用于日报）。 */
export function driftMarkets(config: EconomyConfig, economy: EconomyState, rng: Rng, days = 1): Array<{ market: string; goods: string; from: number; to: number }> {
  const moves: Array<{ market: string; goods: string; from: number; to: number }> = [];
  for (const market of config.markets) {
    const state = economy.markets[market.id];
    if (!state) continue;
    for (const goods of marketGoods(config, market)) {
      const anchor = anchorPrice(goods, market);
      const from = state.prices[goods.id] ?? anchor;
      let price = from;
      for (let day = 0; day < Math.min(days, 14); day++) {
        const shock = (rng.next() * 2 - 1) * goods.volatility;
        price = price * (1 + shock + goods.drift);
        price += (anchor - price) * 0.2;
        price = Math.min(anchor * 2.5, Math.max(anchor * 0.4, price));
      }
      state.previous[goods.id] = from;
      state.prices[goods.id] = roundPrice(price);
      const pressure = state.pressure[goods.id] ?? 0;
      const recovered = pressure * Math.pow(1 - config.rules.demandRecovery, Math.min(days, 14));
      if (Math.abs(recovered) < 0.001) delete state.pressure[goods.id];
      else state.pressure[goods.id] = Math.round(recovered * 10000) / 10000;
      moves.push({ market: market.name, goods: goods.name, from, to: state.prices[goods.id] });
    }
  }
  return moves.sort((left, right) => Math.abs(right.to / Math.max(0.01, right.from) - 1) - Math.abs(left.to / Math.max(0.01, left.from) - 1));
}
