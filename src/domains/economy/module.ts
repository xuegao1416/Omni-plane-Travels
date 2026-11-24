/**
 * 经营模块：产业、仓库、多市场买卖、订单与声望。
 *
 * - 钱统一走主货币（钱袋）。旧版「经营资金」在迁移时并入钱袋，并在账本里留一条记录。
 * - 产业按周期（默认每天）结算收益、维护、工钱、生产链与损耗；风险会带来事故。
 * - 市场价格按种子随机游走并受成交量冲击；订单有期限，按时交货得酬金与声望，过期扣声望。
 * - 每个周期写一份经营日报，摘要作为已结算事实写进下一轮正文。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { BusinessModuleSchema } from '../../modules/schema';
import type { FactSpec, WriteSource } from '../../core/facts';
import type { GameplayModule, ModuleHookContext } from '../../core/host';
import type { CycleTick } from '../../core/cycles';
import type { JsonRecord } from '../../core/ops';
import { normalizeEconomyConfig, type EconomyConfig, type GoodsDef, type HoldingDef, type MarketDef, type RiskLevel } from './config';
import {
  clearLegacyEconomyFields,
  emptyEconomyState,
  holdingFromLegacyAsset,
  migrateLegacyEconomy,
  normalizeEconomyState,
  type ContractState,
  type EconomyLedgerEntry,
  type EconomyState,
  type HoldingState,
} from './state';
import { applyPressure, driftMarkets, ensureMarkets, findGoods, findMarket, marketGoods, midPrice, quote, roundPrice } from './market';

export const ECONOMY_MODULE_ID = 'economy';
const WRITERS: readonly WriteSource[] = ['ai', 'event', 'custom', 'director'];
const WEAR: Record<RiskLevel, number> = { low: 0.5, medium: 1.2, high: 2.5 };
const INCIDENT_CHANCE: Record<RiskLevel, number> = { low: 0.015, medium: 0.04, high: 0.08 };

export interface EconomyModuleConfig {
  config: EconomyConfig;
  world?: WorldDef;
}

type Ctx = ModuleHookContext<EconomyModuleConfig>;

export function economyConfigFromWorld(world: WorldDef | undefined): EconomyConfig | undefined {
  const module = world?.modules?.find(item => item.moduleId === 'business' && item.enabled);
  if (!module) return undefined;
  return normalizeEconomyConfig(module.moduleConfig as BusinessModuleSchema | undefined);
}

/** 原地取用经营状态，同一次结算中所有引用指向同一对象。 */
export function economyState(state: GameState): EconomyState {
  const current = state.economy as EconomyState | undefined;
  if (current && current.version === 2) {
    current.holdings ??= {};
    current.warehouse ??= {};
    current.markets ??= {};
    current.contracts ??= [];
    current.reputation ??= {};
    current.ledger ??= [];
    current.reports ??= [];
    current.totals ??= { revenue: 0, costs: 0, trades: 0, contractsDone: 0 };
    return current;
  }
  state.economy = normalizeEconomyState(current) ?? emptyEconomyState();
  return state.economy;
}

export function holdingDef(config: EconomyConfig, economy: EconomyState | undefined, id: string): HoldingDef | undefined {
  return economy?.holdings?.[id]?.custom ?? config.holdings.find(def => def.id === id || def.name === id);
}

export function ownedHoldings(config: EconomyConfig, economy: EconomyState | undefined): Array<{ id: string; def: HoldingDef; state: HoldingState }> {
  return Object.entries(economy?.holdings ?? {}).flatMap(([id, holding]) => {
    const def = holdingDef(config, economy, id);
    return def ? [{ id, def, state: holding }] : [];
  });
}

export function warehouseCapacity(config: EconomyConfig, economy: EconomyState | undefined): number {
  return config.warehouseCapacity + ownedHoldings(config, economy)
    .filter(item => item.state.status !== 'idle')
    .reduce((sum, item) => sum + item.def.storage * item.state.level, 0);
}

export function warehouseUsed(economy: EconomyState | undefined): number {
  return Object.values(economy?.warehouse ?? {}).reduce((sum, amount) => sum + Math.max(0, Number(amount) || 0), 0);
}

function staffFactor(def: HoldingDef, holding: HoldingState): number {
  if (def.staff.max <= 0) return 1;
  return (0.5 + 0.5 * Math.min(1, holding.staff / def.staff.max)) * def.staff.efficiency;
}

/** 单个产业每周期的预计毛收入（不含随机事故）。 */
export function holdingGross(def: HoldingDef, holding: HoldingState): number {
  if (holding.status === 'idle') return 0;
  const base = def.income.base + def.income.perLevel * Math.max(0, holding.level - 1);
  const condition = holding.status === 'damaged' ? 0.3 : Math.max(0.4, holding.condition / 100);
  return Math.round(base * staffFactor(def, holding) * condition * 100) / 100;
}

export function holdingUpkeep(def: HoldingDef, holding: HoldingState): number {
  if (holding.status === 'idle') return Math.round(def.upkeep * 0.3 * 100) / 100;
  return Math.round((def.upkeep + holding.staff * def.staff.wage) * 100) / 100;
}

function day(context: Ctx, state: GameState): number {
  return Math.max(1, Math.trunc(Number(context.facts.read(state, 'world.day') ?? 1)));
}

function wallet(context: Ctx, state: GameState): number {
  return Number(context.facts.read(state, 'player.currency') ?? 0);
}

function record(state: GameState, context: Ctx, entry: Omit<EconomyLedgerEntry, 'turn' | 'day'>): void {
  const economy = economyState(state);
  economy.ledger = [...economy.ledger, { ...entry, turn: context.turn, day: day(context, state) }].slice(-context.config.config.rules.logLimit);
}

function pay(state: GameState, context: Ctx, amount: number, label: string): boolean {
  if (amount <= 0) return true;
  if (wallet(context, state) < amount) return false;
  return context.apply([{ op: 'add', path: 'player.currency', value: -amount, strict: true, label }], 'system');
}

function earn(context: Ctx, amount: number, label: string): void {
  if (amount > 0) context.apply([{ op: 'add', path: 'player.currency', value: amount, label }], 'system');
}

type MaterialKey = { kind: 'goods' | 'resource' | 'item'; id: string; label: string; have: number };

function material(state: GameState, context: Ctx, key: string): MaterialKey {
  const config = context.config.config;
  if (key.startsWith('resource:')) {
    const id = key.slice(9);
    return { kind: 'resource', id, label: String(context.facts.label(`player.resources.${id}`)).replace(/^物资·/, ''), have: Number(context.facts.read(state, `player.resources.${id}`) ?? 0) };
  }
  if (key.startsWith('item:')) {
    const id = key.slice(5);
    return { kind: 'item', id, label: id, have: Number(state.玩家.物品栏?.[id]?.数量 ?? 0) };
  }
  const goods = findGoods(config, key);
  const id = goods?.id ?? key;
  return { kind: 'goods', id, label: goods?.name ?? key, have: Number(economyState(state).warehouse[id] ?? 0) };
}

function checkMaterials(state: GameState, context: Ctx, materials: Record<string, number>): string | null {
  for (const [key, amount] of Object.entries(materials)) {
    const item = material(state, context, key);
    if (item.have < amount) return `${item.label}不足：需要 ${amount}，现有 ${item.have}`;
  }
  return null;
}

function consumeMaterials(state: GameState, context: Ctx, materials: Record<string, number>): void {
  for (const [key, amount] of Object.entries(materials)) {
    const item = material(state, context, key);
    if (item.kind === 'goods') {
      const economy = economyState(state);
      economy.warehouse[item.id] = Math.max(0, (economy.warehouse[item.id] ?? 0) - amount);
      if (economy.warehouse[item.id] === 0) delete economy.warehouse[item.id];
    } else if (item.kind === 'resource') {
      context.apply([{ op: 'add', path: `player.resources.${item.id}`, value: -amount }], 'system');
    } else {
      context.apply([{ op: 'add', path: `player.items.${item.id}`, value: -amount }], 'system');
    }
  }
}

function marketAccess(state: GameState, context: Ctx, market: MarketDef): string | null {
  if (market.locations.length === 0) return null;
  // 地图模块：当前所在地点挂接了这个市场就能交易（未启用地图时读不到，按地名关键词判断）。
  const here = context.facts.read(state, 'map.here.markets');
  if (Array.isArray(here) && here.includes(market.id)) return null;
  const location = String(context.facts.read(state, 'world.location') ?? '');
  return market.locations.some(keyword => location.includes(keyword)) ? null : `${market.name}只能在${market.locations.join('、')}一带交易（当前：${location || '未知'}）`;
}

function storeGoods(state: GameState, context: Ctx, goodsId: string, amount: number): number {
  const config = context.config.config;
  const economy = economyState(state);
  const free = Math.max(0, warehouseCapacity(config, economy) - warehouseUsed(economy));
  const stored = Math.max(0, Math.min(free, amount));
  if (stored > 0) economy.warehouse[goodsId] = (economy.warehouse[goodsId] ?? 0) + stored;
  return stored;
}

function quantityArg(value: unknown): number | string {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : '数量必须是正整数';
}

function contractValue(config: EconomyConfig, economy: EconomyState, goods: GoodsDef, quantity: number, market?: MarketDef): number {
  const target = market ?? config.markets[0];
  return target ? midPrice(config, economy, target, goods) * quantity : goods.basePrice * quantity;
}

function openContract(state: GameState, context: Ctx, input: JsonRecord, source: string): ContractState | string {
  const config = context.config.config;
  const economy = economyState(state);
  const goods = findGoods(config, String(input.goods ?? ''));
  if (!goods) return `订单商品未知；可用：${config.goods.map(item => item.name).join('、')}`;
  const quantity = quantityArg(input.quantity);
  if (typeof quantity === 'string') return quantity;
  const market = input.market ? findMarket(config, String(input.market)) : undefined;
  const value = contractValue(config, economy, goods, quantity, market);
  const requested = Number(input.reward);
  // AI/事件给的酬金限制在货值的 3 倍以内，防止一笔订单直接撑爆经济。
  const reward = Math.round(Math.min(value * 3, Math.max(value * 0.8, Number.isFinite(requested) && requested > 0 ? requested : value * 1.35)));
  const days = Math.max(1, Math.min(60, Math.trunc(Number(input.days) || 5)));
  const contract: ContractState = {
    id: `contract:${context.turn}:${economy.contracts.length + 1}:${context.rng.int(100, 999)}`,
    title: String(input.title || `${goods.name}订单`).slice(0, 40),
    client: String(input.client || '客商').slice(0, 24),
    goods: goods.id,
    quantity,
    reward,
    ...(market ? { market: market.id } : {}),
    deadlineDay: day(context, state) + days,
    status: 'open',
    createdTurn: context.turn,
    source,
    penalty: Math.round(reward * 0.1),
  };
  economy.contracts = [...economy.contracts.filter(item => item.status === 'open' || context.turn - item.createdTurn < 30), contract].slice(-20);
  context.emit('economy.contractOffered', { id: contract.id, goods: goods.name, quantity, reward, deadlineDay: contract.deadlineDay });
  return contract;
}

function settle(state: GameState, context: Ctx, periods: number, label: string): void {
  const config = context.config.config;
  const economy = economyState(state);
  const lines: string[] = [];
  let income = 0;
  let costs = 0;
  for (const { id, def, state: holding } of ownedHoldings(config, economy)) {
    const gross = context.modifiers.apply('economy.income', holdingGross(def, holding) * periods);
    const upkeep = holdingUpkeep(def, holding) * periods;
    income += gross;
    costs += upkeep;
    if (holding.status !== 'idle' && def.production) {
      let runs = 0;
      for (let index = 0; index < Math.min(periods, 14); index++) {
        if (checkMaterials(state, context, def.production.inputs)) break;
        consumeMaterials(state, context, def.production.inputs);
        for (const [key, amount] of Object.entries(def.production.outputs)) {
          if (key.startsWith('resource:')) context.apply([{ op: 'add', path: `player.resources.${key.slice(9)}`, value: amount }], 'system');
          else storeGoods(state, context, findGoods(config, key)?.id ?? key, amount * holding.level);
        }
        runs += 1;
      }
      if (runs > 0) lines.push(`${def.name}完成 ${runs} 批生产`);
    }
    if (holding.status === 'active') {
      holding.condition = Math.max(0, Math.round((holding.condition - WEAR[def.risk.level] * periods) * 10) / 10);
      if (context.rng.chance(Math.min(0.6, INCIDENT_CHANCE[def.risk.level] * periods))) {
        const damage = context.rng.int(15, 35);
        holding.condition = Math.max(0, holding.condition - damage);
        if (holding.condition < 30) holding.status = 'damaged';
        const text = `${def.name}出了状况${def.risk.description ? `（${def.risk.description}）` : ''}，状况 -${damage}`;
        lines.push(text);
        record(state, context, { kind: 'incident', description: text, amount: 0 });
        context.emit('economy.incident', { id, name: def.name, damage, damaged: holding.status === 'damaged' });
      } else if (holding.condition < 30 && holding.status === 'active') {
        holding.status = 'damaged';
        lines.push(`${def.name}年久失修，效率大降，需要修缮`);
      }
    }
  }
  income = Math.round(income * 100) / 100;
  costs = Math.round(costs * 100) / 100;
  let net = Math.round((income - costs) * 100) / 100;
  if (net < 0 && wallet(context, state) + net < 0 && config.rules.autoIdleOnDeficit) {
    const candidates = ownedHoldings(config, economy).filter(item => item.state.status !== 'idle')
      .sort((left, right) => (holdingGross(left.def, left.state) - holdingUpkeep(left.def, left.state)) - (holdingGross(right.def, right.state) - holdingUpkeep(right.def, right.state)));
    for (const candidate of candidates) {
      if (wallet(context, state) + net >= 0) break;
      const before = holdingGross(candidate.def, candidate.state) - holdingUpkeep(candidate.def, candidate.state);
      candidate.state.status = 'idle';
      const after = -holdingUpkeep(candidate.def, candidate.state);
      net = Math.round((net - (before - after) * periods) * 100) / 100;
      lines.push(`钱袋见底，${candidate.def.name}暂停营业`);
      context.emit('economy.holdingIdled', { id: candidate.id, name: candidate.def.name });
    }
  }
  if (net > 0) earn(context, net, label);
  else if (net < 0) context.apply([{ op: 'add', path: 'player.currency', value: Math.max(net, -wallet(context, state)), label }], 'system');
  if (income || costs) {
    record(state, context, { kind: net >= 0 ? 'income' : 'upkeep', description: `${label}：收入 +${income}，支出 -${costs}`, amount: net });
    economy.totals.revenue += income;
    economy.totals.costs += costs;
  }
  const moves = driftMarkets(config, economy, context.rng, periods).slice(0, 2)
    .filter(move => Math.abs(move.to / Math.max(0.01, move.from) - 1) >= 0.04);
  for (const move of moves) lines.push(`${move.market}的${move.goods}${move.to > move.from ? '涨' : '跌'}到 ${move.to}（${move.to > move.from ? '+' : ''}${Math.round((move.to / Math.max(0.01, move.from) - 1) * 100)}%）`);
  const today = day(context, state);
  for (const contract of economy.contracts) {
    if (contract.status !== 'open' || contract.deadlineDay >= today) continue;
    contract.status = 'failed';
    const market = contract.market ?? config.markets[0]?.id ?? 'local';
    economy.reputation[market] = Math.max(-100, (economy.reputation[market] ?? 0) - 6);
    lines.push(`订单「${contract.title}」过期作废，声望下降`);
    context.emit('economy.contractFailed', { id: contract.id, title: contract.title });
  }
  if (config.goods.length && config.rules.contractChance > 0 && economy.contracts.filter(item => item.status === 'open').length < 3
    && context.rng.chance(Math.min(0.9, config.rules.contractChance * periods))) {
    const template = config.contracts.length ? config.contracts[context.rng.int(0, config.contracts.length - 1)] : undefined;
    const goods = template ? findGoods(config, template.goods) : config.goods[context.rng.int(0, config.goods.length - 1)];
    if (goods) {
      const quantity = template ? context.rng.int(template.quantity[0], template.quantity[1]) : context.rng.int(5, 20);
      const market = template?.market ? findMarket(config, template.market) : config.markets[context.rng.int(0, Math.max(0, config.markets.length - 1))];
      const value = contractValue(config, economy, goods, quantity, market);
      const contract = openContract(state, context, {
        title: template?.title ?? `收购${goods.name}`,
        client: template?.client ?? '路过的客商',
        goods: goods.id,
        quantity,
        reward: Math.round(value * (template?.premium ?? 1.35)),
        days: template ? context.rng.int(template.days[0], template.days[1]) : context.rng.int(3, 6),
        market: market?.id,
      }, 'generated');
      if (typeof contract !== 'string') lines.push(`${contract.client}想要 ${contract.quantity} ${goods.unit}${goods.name}，${contract.deadlineDay - today} 天内交货付 ${contract.reward}`);
    }
  }
  const report = { day: today, income, costs, net, lines };
  if (income || costs || lines.length) {
    economy.reports = [...economy.reports, report].slice(-14);
    const parts = [income || costs ? `收入 +${income}，支出 -${costs}，净 ${net >= 0 ? '+' : ''}${net}` : '', ...lines].filter(Boolean);
    context.note(`【经营日报】${parts.join('；')}。`, 'fact');
  }
}

function legacyAssets(config: EconomyConfig, economy: EconomyState | undefined): Array<Record<string, unknown>> {
  return ownedHoldings(config, economy).map(({ id, def, state }) => ({
    id, 名称: def.name, 类型: def.type, 等级: state.level, 最高等级: def.maxLevel, 描述: def.description,
    状态: state.status, 基础收益: def.income.base, 每级收益: def.income.perLevel, 维护费: def.upkeep, 员工人数: state.staff,
  }));
}

function economyFacts(holder: EconomyModuleConfig): FactSpec[] {
  const config = holder.config;
  const goodsEnum = () => config.goods.map(goods => ({ params: { id: goods.id }, label: goods.name }));
  return [
    {
      id: 'economy.funds', module: ECONOMY_MODULE_ID, type: 'number', label: '钱袋（经营收支）', writable: WRITERS,
      aliases: ['玩家.经营资产.资金', '经营资产.资金', 'player.business.funds', 'business.funds'], bounds: { min: 0 },
      description: '经营与个人共用的主货币。',
      read: state => Number(state.玩家?.货币资源?.主货币?.数量 ?? 0),
      write: (state, _params, value) => {
        state.玩家.货币资源 ??= { 主货币: { 名称: '', 数量: 0 } };
        state.玩家.货币资源.主货币.数量 = Math.max(0, Math.round(Number(value) * 100) / 100);
        return true;
      },
    },
    {
      id: 'economy.goods.{id}', module: ECONOMY_MODULE_ID, type: 'number', label: '仓库·{name}', writable: WRITERS,
      aliases: ['玩家.经营资产.库存.{id}', 'gameplay.business.inventory.{id}', 'warehouse.{id}'], bounds: { min: 0, integer: true },
      read: (state, { id }) => {
        const goods = findGoods(config, id);
        return goods ? Number(state.economy?.warehouse?.[goods.id] ?? 0) : undefined;
      },
      write: (state, { id }, value) => {
        const goods = findGoods(config, id);
        if (!goods) return `未知商品「${id}」；可用：${config.goods.map(item => `${item.id}(${item.name})`).join('、')}`;
        const economy = economyState(state);
        const quantity = Math.max(0, Math.trunc(Number(value) || 0));
        const others = warehouseUsed(economy) - (economy.warehouse[goods.id] ?? 0);
        const capped = Math.min(quantity, Math.max(0, warehouseCapacity(config, economy) - others));
        if (capped <= 0) delete economy.warehouse[goods.id];
        else economy.warehouse[goods.id] = capped;
        return true;
      },
      enumerate: goodsEnum,
    },
    {
      id: 'economy.price.{market}.{goods}', module: ECONOMY_MODULE_ID, type: 'number', label: '{market}·{goods}行情', writable: [],
      read: (state, { market, goods }) => {
        const m = findMarket(config, market);
        const g = findGoods(config, goods);
        return m && g ? midPrice(config, state.economy ?? emptyEconomyState(), m, g) : undefined;
      },
      enumerate: () => config.markets.flatMap(market => marketGoods(config, market).map(goods => ({ params: { market: market.id, goods: goods.id }, label: `${market.name}·${goods.name}` }))),
    },
    {
      id: 'economy.holding.{id}.level', module: ECONOMY_MODULE_ID, type: 'number', label: '产业·{name}等级', writable: [],
      read: (state, { id }) => state.economy?.holdings?.[id]?.level ?? 0,
      enumerate: state => ownedHoldings(config, state.economy).map(item => ({ params: { id: item.id }, label: item.def.name })),
    },
    {
      id: 'economy.holding.{id}.owned', module: ECONOMY_MODULE_ID, type: 'boolean', label: '拥有产业·{name}', writable: [],
      read: (state, { id }) => Boolean(state.economy?.holdings?.[id]),
      enumerate: () => config.holdings.map(def => ({ params: { id: def.id }, label: def.name })),
    },
    {
      id: 'economy.holding.{id}.status', module: ECONOMY_MODULE_ID, type: 'string', label: '产业·{name}状态', writable: [],
      read: (state, { id }) => state.economy?.holdings?.[id]?.status ?? 'none',
      enumerate: state => ownedHoldings(config, state.economy).map(item => ({ params: { id: item.id }, label: item.def.name })),
    },
    {
      id: 'economy.reputation.{market}', module: ECONOMY_MODULE_ID, type: 'number', label: '{name}声望', writable: WRITERS,
      bounds: { min: -100, max: 100 },
      read: (state, { market }) => Number(state.economy?.reputation?.[findMarket(config, market)?.id ?? market] ?? 0),
      write: (state, { market }, value) => {
        const target = findMarket(config, market);
        if (!target) return `未知市场「${market}」；可用：${config.markets.map(item => `${item.id}(${item.name})`).join('、')}`;
        economyState(state).reputation[target.id] = Math.round(Number(value));
        return true;
      },
      enumerate: () => config.markets.map(market => ({ params: { market: market.id }, label: market.name })),
    },
    { id: 'economy.contracts.open', module: ECONOMY_MODULE_ID, type: 'number', label: '进行中的订单', writable: [],
      read: state => (state.economy?.contracts ?? []).filter(item => item.status === 'open').length },
    { id: 'economy.holdings.count', module: ECONOMY_MODULE_ID, type: 'number', label: '产业数量', writable: [], aliases: ['player.business.assetCount'],
      read: state => Object.keys(state.economy?.holdings ?? {}).length },
    { id: 'economy.warehouse.capacity', module: ECONOMY_MODULE_ID, type: 'number', label: '仓库容量', writable: [],
      read: state => warehouseCapacity(config, state.economy) },
    { id: 'economy.warehouse.used', module: ECONOMY_MODULE_ID, type: 'number', label: '仓库已用', writable: [],
      read: state => warehouseUsed(state.economy) },
    {
      id: 'economy.holdings.legacy', module: ECONOMY_MODULE_ID, type: 'list', label: '产业列表', visibility: 'hidden', writable: WRITERS,
      aliases: ['玩家.经营资产.资产列表', '经营资产.资产列表'],
      read: state => legacyAssets(config, state.economy),
      write: (state, _params, value) => {
        if (!Array.isArray(value)) return '产业列表必须是数组';
        const economy = economyState(state);
        let added = 0;
        value.forEach((entry, index) => {
          if (!entry || typeof entry !== 'object') return;
          const raw = entry as Record<string, unknown>;
          const id = String(raw.id || '').trim() || `asset-${Object.keys(economy.holdings).length + 1}`;
          if (economy.holdings[id]) return;
          const configDef = config.holdings.find(def => def.id === id);
          const custom = configDef ? undefined : holdingFromLegacyAsset(raw as never, index);
          if (custom) {
            // AI 叙事里新增的产业：收益与维护限制在合理范围内。
            custom.income.base = Math.max(0, Math.min(500, custom.income.base));
            custom.income.perLevel = Math.max(0, Math.min(250, custom.income.perLevel));
            custom.upkeep = Math.max(0, Math.min(500, custom.upkeep));
          }
          economy.holdings[id] = {
            level: Math.max(1, Math.min((configDef ?? custom)!.maxLevel, Math.trunc(Number(raw.等级) || 1))),
            status: raw.状态 === 'idle' ? 'idle' : raw.状态 === 'damaged' ? 'damaged' : 'active',
            staff: Math.max(0, Math.trunc(Number(raw.员工人数) || 0)),
            condition: 100,
            acquiredTurn: Math.max(0, Math.trunc(Number(state.simulationRuntime?.tick) || 0)),
            ...(custom ? { custom } : {}),
          };
          added += 1;
        });
        return added > 0 || value.length <= legacyAssets(config, economy).length ? true : '没有可新增的产业';
      },
    },
    {
      id: 'economy.ledger.legacy', module: ECONOMY_MODULE_ID, type: 'list', label: '经营账本', visibility: 'hidden', writable: WRITERS,
      aliases: ['玩家.经营资产.交易日志', '经营资产.交易日志'],
      read: state => (state.economy?.ledger ?? []).map(entry => ({ 类型: entry.kind, 描述: entry.description, 金额: entry.amount })),
      write: (state, _params, value) => {
        if (!Array.isArray(value)) return '账本必须是数组';
        const economy = economyState(state);
        const existing = economy.ledger.length;
        const additions = value.slice(existing).filter(entry => entry && typeof entry === 'object') as Array<Record<string, unknown>>;
        for (const entry of additions) {
          economy.ledger.push({ turn: Math.trunc(Number(state.simulationRuntime?.tick) || 0), day: 0, kind: 'note', description: String(entry.描述 ?? entry.description ?? ''), amount: Number(entry.金额 ?? entry.amount) || 0 });
        }
        economy.ledger = economy.ledger.slice(-config.rules.logLimit);
        return true;
      },
    },
    {
      id: 'economy.legacy', module: ECONOMY_MODULE_ID, type: 'object', label: '经营概况', visibility: 'hidden', writable: [],
      aliases: ['玩家.经营资产'],
      read: state => ({
        资金: Number(state.玩家?.货币资源?.主货币?.数量 ?? 0),
        资产列表: legacyAssets(config, state.economy),
        库存: { ...(state.economy?.warehouse ?? {}) },
        交易日志: (state.economy?.ledger ?? []).map(entry => ({ 类型: entry.kind, 描述: entry.description, 金额: entry.amount })),
      }),
    },
  ];
}

function holdingOrFail(state: GameState, context: Ctx, id: unknown): { id: string; def: HoldingDef; holding: HoldingState } | string {
  const config = context.config.config;
  const economy = economyState(state);
  const key = String(id ?? '');
  const def = holdingDef(config, economy, key);
  const resolvedId = economy.holdings[key] ? key : def?.id ?? key;
  const holding = economy.holdings[resolvedId];
  if (!def || !holding) return '你没有这处产业';
  return { id: resolvedId, def, holding };
}

export const economyModule: GameplayModule<EconomyModuleConfig> = {
  id: ECONOMY_MODULE_ID,
  label: '经营',
  order: 30,
  resolveConfig: world => {
    const config = economyConfigFromWorld(world);
    return config ? { config, world } : undefined;
  },
  facts: holder => economyFacts(holder),
  domainEvents: () => [
    { type: 'economy.traded', label: '买卖成交', payload: 'side 为 buy/sell、goods、quantity、total' },
    { type: 'economy.acquired', label: '购置产业', payload: 'id、name' },
    { type: 'economy.upgraded', label: '产业升级', payload: 'id、level' },
    { type: 'economy.repaired', label: '产业修复', payload: 'id' },
    { type: 'economy.holdingIdled', label: '产业停业', payload: 'id' },
    { type: 'economy.incident', label: '经营意外', payload: 'id、damage、damaged' },
    { type: 'economy.contractOffered', label: '收到订单', payload: 'id、goods、quantity、reward' },
    { type: 'economy.contractFulfilled', label: '交付订单', payload: 'id、reward' },
    { type: 'economy.contractFailed', label: '订单失败或放弃', payload: 'id、abandoned' },
  ],
  prepare: (state, context) => {
    const config = context.config.config;
    let economy = normalizeEconomyState(state.economy);
    if (!economy) {
      // 旧版开局必定写入 玩家.经营资产；gameplay.business 的空壳由内核默认创建，不算旧数据。
      const legacy = state.玩家.经营资产 !== undefined || Object.keys(state.gameplay?.business?.inventory ?? {}).length > 0;
      if (legacy) {
        const migrated = migrateLegacyEconomy(state, config, context.turn);
        economy = migrated.economy;
        if (migrated.legacyFunds > 0) {
          state.玩家.货币资源 ??= { 主货币: { 名称: '', 数量: 0 } };
          state.玩家.货币资源.主货币.数量 = Math.round((Number(state.玩家.货币资源.主货币.数量) || 0) + migrated.legacyFunds);
          economy.ledger.push({ turn: context.turn, day: 0, kind: 'legacy', description: `旧版经营资金并入钱袋 +${migrated.legacyFunds}`, amount: migrated.legacyFunds });
        }
      } else {
        economy = emptyEconomyState();
        for (const def of config.holdings.filter(item => item.initiallyOwned)) {
          economy.holdings[def.id] = { level: def.initialLevel, status: 'active', staff: Math.min(def.initialStaff, def.staff.max || def.initialStaff), condition: 100, acquiredTurn: context.turn };
        }
        if (config.startingFunds > 0) {
          state.玩家.货币资源 ??= { 主货币: { 名称: '', 数量: 0 } };
          state.玩家.货币资源.主货币.数量 = Math.round((Number(state.玩家.货币资源.主货币.数量) || 0) + config.startingFunds);
          economy.ledger.push({ turn: context.turn, day: 0, kind: 'note', description: `启动资金 +${config.startingFunds}`, amount: config.startingFunds });
        }
      }
      economy.fundsMerged = true;
    }
    ensureMarkets(config, economy);
    state.economy = economy;
    clearLegacyEconomyFields(state);
  },
  commands: {
    buy: (state, args, context) => {
      const config = context.config.config;
      const economy = economyState(state);
      const market = findMarket(config, args.market ? String(args.market) : undefined);
      const goods = findGoods(config, String(args.goods ?? ''));
      if (!market || !goods) return { ok: false, reason: '没有这个市场或商品' };
      if (!marketGoods(config, market).some(item => item.id === goods.id)) return { ok: false, reason: `${market.name}不卖${goods.name}` };
      const access = marketAccess(state, context, market);
      if (access) return { ok: false, reason: access };
      const quantity = quantityArg(args.quantity);
      if (typeof quantity === 'string') return { ok: false, reason: quantity };
      const free = warehouseCapacity(config, economy) - warehouseUsed(economy);
      if (quantity > free) return { ok: false, reason: `仓库放不下：还能放 ${Math.max(0, free)}` };
      const price = quote(config, economy, market, goods, quantity, 'buy', economy.reputation[market.id] ?? 0);
      const cost = Math.round(context.modifiers.apply('economy.price.buy', price.total) * 100) / 100;
      if (!pay(state, context, cost, `在${market.name}买入${goods.name}`)) return { ok: false, reason: `钱不够：需要 ${cost}，钱袋 ${wallet(context, state)}` };
      storeGoods(state, context, goods.id, quantity);
      applyPressure(economy, market, goods, price.pressureAfter);
      economy.totals.trades += 1;
      record(state, context, { kind: 'trade', description: `在${market.name}买入 ${quantity}${goods.unit}${goods.name}（单价 ${roundPrice(cost / quantity)}）`, amount: -cost });
      context.emit('economy.traded', { side: 'buy', market: market.id, goods: goods.id, quantity, total: cost });
      context.note(`你在${market.name}买进 ${quantity}${goods.unit}${goods.name}，花了 ${cost}。`, 'fact');
      return { ok: true, message: `买入 ${goods.name}×${quantity}，-${cost}` };
    },
    sell: (state, args, context) => {
      const config = context.config.config;
      const economy = economyState(state);
      const market = findMarket(config, args.market ? String(args.market) : undefined);
      const goods = findGoods(config, String(args.goods ?? ''));
      if (!market || !goods) return { ok: false, reason: '没有这个市场或商品' };
      if (!marketGoods(config, market).some(item => item.id === goods.id)) return { ok: false, reason: `${market.name}不收${goods.name}` };
      const access = marketAccess(state, context, market);
      if (access) return { ok: false, reason: access };
      const quantity = quantityArg(args.quantity);
      if (typeof quantity === 'string') return { ok: false, reason: quantity };
      const have = economy.warehouse[goods.id] ?? 0;
      if (have < quantity) return { ok: false, reason: `仓库里只有 ${have}${goods.unit}${goods.name}` };
      const price = quote(config, economy, market, goods, quantity, 'sell', economy.reputation[market.id] ?? 0);
      const revenue = Math.round(context.modifiers.apply('economy.price.sell', price.total) * 100) / 100;
      economy.warehouse[goods.id] = have - quantity;
      if (economy.warehouse[goods.id] === 0) delete economy.warehouse[goods.id];
      earn(context, revenue, `在${market.name}卖出${goods.name}`);
      applyPressure(economy, market, goods, price.pressureAfter);
      economy.reputation[market.id] = Math.min(100, (economy.reputation[market.id] ?? 0) + Math.min(2, quantity / Math.max(1, market.depth)));
      economy.totals.trades += 1;
      economy.totals.revenue += revenue;
      record(state, context, { kind: 'trade', description: `在${market.name}卖出 ${quantity}${goods.unit}${goods.name}（单价 ${roundPrice(revenue / quantity)}）`, amount: revenue });
      context.emit('economy.traded', { side: 'sell', market: market.id, goods: goods.id, quantity, total: revenue });
      context.note(`你在${market.name}卖出 ${quantity}${goods.unit}${goods.name}，进账 ${revenue}。`, 'fact');
      return { ok: true, message: `卖出 ${goods.name}×${quantity}，+${revenue}` };
    },
    acquire: (state, args, context) => {
      const config = context.config.config;
      const economy = economyState(state);
      const def = config.holdings.find(item => item.id === args.id || item.name === args.id);
      if (!def) return { ok: false, reason: '没有这处产业' };
      if (economy.holdings[def.id]) return { ok: false, reason: `${def.name}已经是你的了` };
      const missing = checkMaterials(state, context, def.purchaseMaterials);
      if (missing) return { ok: false, reason: missing };
      if (!pay(state, context, def.purchaseCost, `购置${def.name}`)) return { ok: false, reason: `钱不够：购置需要 ${def.purchaseCost}` };
      consumeMaterials(state, context, def.purchaseMaterials);
      economy.holdings[def.id] = { level: 1, status: 'active', staff: 0, condition: 100, acquiredTurn: context.turn };
      record(state, context, { kind: 'build', description: `购置${def.name}`, amount: -def.purchaseCost });
      context.emit('economy.acquired', { id: def.id, name: def.name });
      context.note(`你盘下了${def.name}。`, 'fact');
      return { ok: true, message: `购置了${def.name}` };
    },
    upgrade: (state, args, context) => {
      const found = holdingOrFail(state, context, args.id);
      if (typeof found === 'string') return { ok: false, reason: found };
      const { def, holding, id } = found;
      if (holding.level >= def.maxLevel) return { ok: false, reason: `${def.name}已经是最高等级` };
      const cost = Math.round(def.upgradeCost * holding.level);
      const missing = checkMaterials(state, context, def.upgradeMaterials);
      if (missing) return { ok: false, reason: missing };
      if (!pay(state, context, cost, `升级${def.name}`)) return { ok: false, reason: `钱不够：升级需要 ${cost}` };
      consumeMaterials(state, context, def.upgradeMaterials);
      holding.level += 1;
      holding.condition = Math.min(100, holding.condition + 20);
      record(state, context, { kind: 'build', description: `${def.name}升到 ${holding.level} 级`, amount: -cost });
      context.emit('economy.upgraded', { id, name: def.name, level: holding.level });
      return { ok: true, message: `${def.name}升到 ${holding.level} 级` };
    },
    staff: (state, args, context) => {
      const found = holdingOrFail(state, context, args.id);
      if (typeof found === 'string') return { ok: false, reason: found };
      const { def, holding } = found;
      if (def.staff.max <= 0) return { ok: false, reason: `${def.name}不需要雇人` };
      const count = Math.trunc(Number(args.count));
      if (!Number.isFinite(count) || count < 0 || count > def.staff.max) return { ok: false, reason: `人手必须在 0 到 ${def.staff.max} 之间` };
      holding.staff = count;
      return { ok: true, message: `${def.name}现在有 ${count} 个人手` };
    },
    repair: (state, args, context) => {
      const found = holdingOrFail(state, context, args.id);
      if (typeof found === 'string') return { ok: false, reason: found };
      const { def, holding, id } = found;
      if (holding.condition >= 100 && holding.status !== 'damaged') return { ok: false, reason: `${def.name}状况良好，不需要修缮` };
      const cost = Math.max(1, Math.round((100 - holding.condition) / 100 * Math.max(def.upgradeCost, def.purchaseCost, 50) * 0.5));
      if (!pay(state, context, cost, `修缮${def.name}`)) return { ok: false, reason: `钱不够：修缮需要 ${cost}` };
      holding.condition = 100;
      if (holding.status === 'damaged') holding.status = 'active';
      record(state, context, { kind: 'build', description: `修缮${def.name}`, amount: -cost });
      context.emit('economy.repaired', { id, name: def.name });
      return { ok: true, message: `修缮了${def.name}` };
    },
    setActive: (state, args, context) => {
      const found = holdingOrFail(state, context, args.id);
      if (typeof found === 'string') return { ok: false, reason: found };
      const { def, holding } = found;
      const active = args.active !== false && args.active !== 'false';
      if (holding.status === 'damaged' && active) return { ok: false, reason: `${def.name}受损，先修缮再开张` };
      holding.status = active ? 'active' : 'idle';
      return { ok: true, message: active ? `${def.name}重新开张` : `${def.name}暂停营业` };
    },
    deliver: (state, args, context) => {
      const config = context.config.config;
      const economy = economyState(state);
      const contract = economy.contracts.find(item => item.id === args.id && item.status === 'open');
      if (!contract) return { ok: false, reason: '这份订单已经不在了' };
      const goods = findGoods(config, contract.goods);
      const have = economy.warehouse[contract.goods] ?? 0;
      if (have < contract.quantity) return { ok: false, reason: `还差 ${contract.quantity - have}${goods?.unit ?? ''}${goods?.name ?? contract.goods}` };
      if (contract.market) {
        const market = findMarket(config, contract.market);
        const access = market ? marketAccess(state, context, market) : null;
        if (access) return { ok: false, reason: `交货地点不对：${access}` };
      }
      economy.warehouse[contract.goods] = have - contract.quantity;
      if (economy.warehouse[contract.goods] === 0) delete economy.warehouse[contract.goods];
      earn(context, contract.reward, `订单「${contract.title}」`);
      contract.status = 'done';
      const market = contract.market ?? config.markets[0]?.id ?? 'local';
      economy.reputation[market] = Math.min(100, (economy.reputation[market] ?? 0) + 5);
      economy.totals.contractsDone += 1;
      record(state, context, { kind: 'contract', description: `交付订单「${contract.title}」`, amount: contract.reward });
      context.emit('economy.contractFulfilled', { id: contract.id, title: contract.title, reward: contract.reward });
      context.note(`你按约把 ${contract.quantity}${goods?.unit ?? ''}${goods?.name ?? ''}交给${contract.client}，拿到 ${contract.reward}。`, 'fact');
      return { ok: true, message: `交付订单，+${contract.reward}` };
    },
    offerContract: (state, args, context) => {
      const contract = openContract(state, context, args, context.source);
      if (typeof contract === 'string') return { ok: false, reason: contract };
      const goods = findGoods(context.config.config, contract.goods);
      context.note(`${contract.client}托你办一件事：「${contract.title}」，${contract.quantity}${goods?.unit ?? ''}${goods?.name ?? ''}，期限到第 ${contract.deadlineDay} 天，酬金 ${contract.reward}。`, 'hint');
      return { ok: true, message: `新订单：${contract.title}` };
    },
    abandonContract: (state, args, context) => {
      const economy = economyState(state);
      const contract = economy.contracts.find(item => item.id === args.id && item.status === 'open');
      if (!contract) return { ok: false, reason: '这份订单已经不在了' };
      contract.status = 'failed';
      const market = contract.market ?? context.config.config.markets[0]?.id ?? 'local';
      economy.reputation[market] = Math.max(-100, (economy.reputation[market] ?? 0) - 3);
      context.emit('economy.contractFailed', { id: contract.id, title: contract.title, abandoned: true });
      return { ok: true, message: `放弃了订单「${contract.title}」` };
    },
    addHolding: (state, args, context) => {
      const economy = economyState(state);
      const raw = (args.holding && typeof args.holding === 'object' ? args.holding : args) as Record<string, unknown>;
      const name = String(raw.name ?? raw.名称 ?? '').trim();
      if (!name) return { ok: false, reason: '产业需要名称' };
      const id = String(raw.id ?? '').trim() || `holding_${Object.keys(economy.holdings).length + 1}`;
      if (economy.holdings[id]) return { ok: false, reason: '已有同名产业' };
      const custom = holdingFromLegacyAsset({ id, 名称: name, 类型: String(raw.type ?? raw.类型 ?? ''), 描述: String(raw.description ?? raw.描述 ?? ''),
        等级: 1, 最高等级: Number(raw.maxLevel ?? raw.最高等级 ?? 3), 状态: 'active', 基础收益: Number(raw.income ?? raw.基础收益 ?? 0),
        每级收益: Number(raw.perLevel ?? raw.每级收益 ?? 0), 维护费: Number(raw.upkeep ?? raw.维护费 ?? 0) } as never, 0);
      custom.income.base = Math.max(0, Math.min(500, custom.income.base));
      custom.income.perLevel = Math.max(0, Math.min(250, custom.income.perLevel));
      custom.upkeep = Math.max(0, Math.min(500, custom.upkeep));
      economy.holdings[id] = { level: 1, status: 'active', staff: 0, condition: 100, acquiredTurn: context.turn, custom };
      context.emit('economy.acquired', { id, name });
      return { ok: true, message: `新增产业：${name}` };
    },
  },
  onCycle: (state, context, cycle: CycleTick) => {
    const period = context.config.config.cycle;
    if (period === 'turn' || (period === 'day' && cycle.period !== 'day') || (period === 'week' && cycle.period !== 'week')) return;
    settle(state, context, cycle.count, period === 'week' ? '每周结算' : cycle.count > 1 ? `${cycle.count} 天的经营` : '今日经营');
  },
  onTurnEnd: (state, context) => {
    if (context.config.config.cycle === 'turn') settle(state, context, 1, '本回合经营');
  },
  summarize: (state, context, audience) => {
    const config = context.config.config;
    const economy = state.economy;
    if (!economy) return undefined;
    const money = Number(context.facts.read(state, 'player.currency') ?? 0);
    const holdings = ownedHoldings(config, economy).map(({ def, state: holding }) =>
      `${def.name} ${holding.level}级${holding.status === 'idle' ? '（停业）' : holding.status === 'damaged' ? '（受损）' : ''}，${config.cycleLabel}约 +${holdingGross(def, holding)} / -${holdingUpkeep(def, holding)}`);
    const warehouse = Object.entries(economy.warehouse).map(([id, amount]) => `${findGoods(config, id)?.name ?? id}×${amount}`);
    const market = config.markets[0];
    const prices = market ? marketGoods(config, market).slice(0, 6).map(goods => {
      const price = midPrice(config, economy, market, goods);
      const previous = economy.markets[market.id]?.previous[goods.id] ?? price;
      return `${goods.name} ${price}${price > previous ? '↑' : price < previous ? '↓' : ''}`;
    }) : [];
    const contracts = economy.contracts.filter(item => item.status === 'open').map(item => {
      const goods = findGoods(config, item.goods);
      return `「${item.title}」${item.quantity}${goods?.unit ?? ''}${goods?.name ?? item.goods}，第 ${item.deadlineDay} 天前，酬金 ${item.reward}`;
    });
    if (audience === 'extraction') {
      return [
        `经营：钱用 player.currency 增减；仓库 economy.goods.<商品id>（${config.goods.map(goods => `${goods.id}=${goods.name}`).join('，') || '无'}）；声望 economy.reputation.<市场id>（${config.markets.map(item => `${item.id}=${item.name}`).join('，')}）。`,
        '正文里谈成的买卖、委托用 commands：economy.sell / economy.buy {market, goods, quantity}（价格由本地行情计算，不要自己写价钱）、economy.offerContract {client, title, goods, quantity, days}。',
      ].join('\n');
    }
    return [
      `经营：钱袋 ${money}`,
      holdings.length ? `产业：${holdings.join('；')}` : '',
      warehouse.length ? `仓库：${warehouse.join('、')}（${warehouseUsed(economy)}/${warehouseCapacity(config, economy)}）` : '',
      prices.length ? `${market!.name}行情：${prices.join('、')}` : '',
      contracts.length ? `订单：${contracts.join('；')}` : '',
    ].filter(Boolean).join('。');
  },
};
