/**
 * 经营面板的界面数据。界面只读这里，不自行合并配置与存档。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { createGameplayHost } from '../../core/registry';
import type { EconomyConfig } from './config';
import { findGoods, findMarket, marketGoods, midPrice, quote } from './market';
import { holdingGross, holdingUpkeep, ownedHoldings, warehouseCapacity, warehouseUsed } from './module';

export interface EconomyGoodsRow {
  id: string;
  name: string;
  unit: string;
  mid: number;
  buy: number;
  sell: number;
  changePct: number;
  trend: 'up' | 'down' | 'flat';
  owned: number;
}

export interface EconomyMarketModel {
  id: string;
  name: string;
  description: string;
  accessible: boolean;
  accessNote?: string;
  reputation: number;
  goods: EconomyGoodsRow[];
}

export interface EconomyHoldingModel {
  id: string;
  name: string;
  type: string;
  description: string;
  level: number;
  maxLevel: number;
  status: 'active' | 'idle' | 'damaged';
  statusLabel: string;
  condition: number;
  staff: number;
  staffMax: number;
  wage: number;
  gross: number;
  upkeep: number;
  net: number;
  risk: string;
  upgradeCost?: number;
  repairCost?: number;
  productionText?: string;
  storage: number;
}

export interface EconomyOfferModel {
  id: string;
  name: string;
  type: string;
  description: string;
  cost: number;
  materials: string;
  incomeText: string;
  affordable: boolean;
}

export interface EconomyContractModel {
  id: string;
  title: string;
  client: string;
  goods: string;
  unit: string;
  quantity: number;
  have: number;
  reward: number;
  daysLeft: number;
  market?: string;
  status: 'open' | 'done' | 'failed';
  canDeliver: boolean;
}

export interface EconomyViewModel {
  title: string;
  description: string;
  cycleLabel: string;
  wallet: number;
  currencyName: string;
  projected: { income: number; upkeep: number; net: number };
  alerts: string[];
  markets: EconomyMarketModel[];
  warehouse: { used: number; capacity: number; items: Array<{ id: string; name: string; unit: string; quantity: number; value: number }> };
  holdings: EconomyHoldingModel[];
  offers: EconomyOfferModel[];
  contracts: EconomyContractModel[];
  reports: Array<{ day: number; income: number; costs: number; net: number; lines: string[] }>;
  ledger: Array<{ key: string; day: number; kind: string; description: string; amount: number }>;
}

const STATUS_LABEL = { active: '营业中', idle: '停业', damaged: '受损' } as const;
const RISK_LABEL = { low: '风险低', medium: '风险中', high: '风险高' } as const;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function materialText(config: EconomyConfig, materials: Record<string, number>): string {
  return Object.entries(materials).map(([key, amount]) => {
    const name = key.startsWith('resource:') ? key.slice(9) : key.startsWith('item:') ? key.slice(5) : findGoods(config, key)?.name ?? key;
    return `${name}×${amount}`;
  }).join('、');
}

export function buildEconomyViewModel(stateInput: GameState, world: WorldDef | undefined, title?: string): EconomyViewModel | null {
  const host = createGameplayHost(world, stateInput);
  const holder = host.configOf<{ config: EconomyConfig }>('economy');
  if (!holder) return null;
  const config = holder.config;
  const state = host.prepare(stateInput);
  const economy = state.economy!;
  const wallet = Number(host.facts.read(state, 'player.currency') ?? 0);
  const location = String(host.facts.read(state, 'world.location') ?? '');
  const today = Math.max(1, Math.trunc(Number(host.facts.read(state, 'world.day') ?? 1)));
  const alerts: string[] = [];

  const markets: EconomyMarketModel[] = config.markets.map(market => {
    const accessible = market.locations.length === 0 || market.locations.some(keyword => location.includes(keyword));
    const reputation = Math.round(economy.reputation[market.id] ?? 0);
    return {
      id: market.id,
      name: market.name,
      description: market.description,
      accessible,
      ...(accessible ? {} : { accessNote: `需要身处${market.locations.join('、')}一带` }),
      reputation,
      goods: marketGoods(config, market).map(goods => {
        const mid = midPrice(config, economy, market, goods);
        const previous = economy.markets[market.id]?.previous[goods.id] ?? mid;
        const changePct = previous > 0 ? Math.round((mid / previous - 1) * 1000) / 10 : 0;
        return {
          id: goods.id,
          name: goods.name,
          unit: goods.unit,
          mid,
          buy: quote(config, economy, market, goods, 1, 'buy', reputation).unitPrice,
          sell: quote(config, economy, market, goods, 1, 'sell', reputation).unitPrice,
          changePct,
          trend: changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'flat',
          owned: economy.warehouse[goods.id] ?? 0,
        };
      }),
    };
  });

  const firstMarket = config.markets[0];
  const capacity = warehouseCapacity(config, economy);
  const used = warehouseUsed(economy);
  if (capacity > 0 && used >= capacity) alerts.push('仓库已满');

  let income = 0;
  let upkeep = 0;
  const holdings: EconomyHoldingModel[] = ownedHoldings(config, economy).map(({ id, def, state: holding }) => {
    const gross = holdingGross(def, holding);
    const cost = holdingUpkeep(def, holding);
    income += gross;
    upkeep += cost;
    if (holding.status === 'damaged') alerts.push(`${def.name}受损，收益只剩三成`);
    const production = def.production
      ? `${materialText(config, def.production.inputs) || '无投入'} → ${materialText(config, def.production.outputs)}`
      : undefined;
    return {
      id,
      name: def.name,
      type: def.type,
      description: def.description,
      level: holding.level,
      maxLevel: def.maxLevel,
      status: holding.status,
      statusLabel: STATUS_LABEL[holding.status],
      condition: Math.round(holding.condition),
      staff: holding.staff,
      staffMax: def.staff.max,
      wage: def.staff.wage,
      gross,
      upkeep: cost,
      net: round(gross - cost),
      risk: `${RISK_LABEL[def.risk.level]}${def.risk.description ? `：${def.risk.description}` : ''}`,
      ...(holding.level < def.maxLevel ? { upgradeCost: Math.round(def.upgradeCost * holding.level) } : {}),
      ...(holding.condition < 100 || holding.status === 'damaged'
        ? { repairCost: Math.max(1, Math.round((100 - holding.condition) / 100 * Math.max(def.upgradeCost, def.purchaseCost, 50) * 0.5)) }
        : {}),
      ...(production ? { productionText: production } : {}),
      storage: def.storage * holding.level,
    };
  });

  const offers: EconomyOfferModel[] = config.holdings.filter(def => !economy.holdings[def.id]).map(def => ({
    id: def.id,
    name: def.name,
    type: def.type,
    description: def.description,
    cost: def.purchaseCost,
    materials: materialText(config, def.purchaseMaterials),
    incomeText: `${config.cycleLabel} +${def.income.base} / 维护 -${def.upkeep}${def.storage ? ` / 仓位 +${def.storage}` : ''}`,
    affordable: wallet >= def.purchaseCost,
  }));

  const contracts: EconomyContractModel[] = economy.contracts
    .filter(item => item.status === 'open' || today - item.deadlineDay <= 3)
    .map(item => {
      const goods = findGoods(config, item.goods);
      const have = economy.warehouse[item.goods] ?? 0;
      const daysLeft = item.deadlineDay - today;
      if (item.status === 'open' && daysLeft <= 1) alerts.push(`订单「${item.title}」${daysLeft <= 0 ? '今天' : '明天'}到期`);
      const market = item.market ? findMarket(config, item.market) : undefined;
      return {
        id: item.id,
        title: item.title,
        client: item.client,
        goods: goods?.name ?? item.goods,
        unit: goods?.unit ?? '',
        quantity: item.quantity,
        have,
        reward: item.reward,
        daysLeft,
        ...(market ? { market: market.name } : {}),
        status: item.status,
        canDeliver: item.status === 'open' && have >= item.quantity,
      };
    })
    .sort((left, right) => (left.status === 'open' ? 0 : 1) - (right.status === 'open' ? 0 : 1) || left.daysLeft - right.daysLeft);

  return {
    title: title || '商号',
    description: config.description,
    cycleLabel: config.cycleLabel,
    wallet,
    currencyName: String(host.facts.read(state, 'player.currencyName') || '钱'),
    projected: { income: round(income), upkeep: round(upkeep), net: round(income - upkeep) },
    alerts: [...new Set(alerts)].slice(0, 4),
    markets,
    warehouse: {
      used,
      capacity,
      items: Object.entries(economy.warehouse).map(([id, quantity]) => {
        const goods = findGoods(config, id);
        return { id, name: goods?.name ?? id, unit: goods?.unit ?? '', quantity, value: goods && firstMarket ? round(midPrice(config, economy, firstMarket, goods) * quantity) : 0 };
      }),
    },
    holdings,
    offers,
    contracts,
    reports: [...economy.reports].reverse().slice(0, 7),
    ledger: [...economy.ledger].reverse().slice(0, 20).map((entry, index) => ({ key: `${entry.turn}:${index}`, day: entry.day, kind: entry.kind, description: entry.description, amount: entry.amount })),
  };
}
