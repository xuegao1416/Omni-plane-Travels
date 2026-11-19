import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { createGameplayHost } from '../../core/registry';
import { VariableManager } from '../../engine/variableManager';
import { normalizeEconomyConfig } from './config';
import { buildEconomyViewModel } from './viewModel';

function world(config: Record<string, unknown>): WorldDef {
  return { id: 'trade_world', name: '商路', description: '', modules: [{ moduleId: 'business', enabled: true, moduleConfig: config }] } as unknown as WorldDef;
}

const trade = {
  description: '边贸', funds: 500, cycleName: '天',
  market: { items: [
    { name: '羽绒服', basePrice: 80, trend: 'up', changePercent: 20 },
    { name: '方便面', basePrice: 8, trend: 'stable', changePercent: 5 },
  ] },
  markets: [
    { id: 'wholesale', name: '批发市场', priceFactor: { 羽绒服: 0.8 }, depth: 20 },
    { id: 'border', name: '口岸', priceFactor: { 羽绒服: 1.4 }, depth: 20, locations: ['口岸'] },
  ],
  assets: [
    { id: 'stall', name: '货摊', type: '零售', level: 1, maxLevel: 3, description: '', status: 'active', income: { base: 60, perLevel: 25, cycle: '天' }, maintenance: 15 },
    { id: 'warehouse', name: '仓库', type: '仓储', level: 1, maxLevel: 2, description: '', initiallyOwned: false, purchaseCost: 300, income: { base: 0, perLevel: 0, cycle: '天' }, maintenance: 5, storage: 40 },
  ],
  warehouseCapacity: 30,
  rules: { contractChance: 0 },
};

function setup(config: Record<string, unknown> = trade, mutate?: (state: GameState) => void) {
  const def = world(config);
  const state = createDefaultGameState();
  state.世界.时间系统.时钟 = { schemaVersion: 2, elapsedMinutes: 8 * 60 };
  state.玩家.货币资源.主货币 = { 名称: '卢布', 数量: 100 };
  mutate?.(state);
  const host = createGameplayHost(def, state);
  return { def, host, state: host.prepare(state) };
}

function nextDay(host: ReturnType<typeof setup>['host'], state: GameState, turnId: string, days = 1) {
  const previousClock = structuredClone(state.世界.时间系统.时钟!);
  const next = structuredClone(state);
  next.世界.时间系统.时钟 = { ...previousClock, elapsedMinutes: previousClock.elapsedMinutes + days * 1440 };
  return host.endTurn(next, { turnId, round: 1, previousClock });
}

describe('配置规范化', () => {
  test('旧行情表变成商品，资产变成产业；默认开局拥有未标记 initiallyOwned:false 的资产', () => {
    const config = normalizeEconomyConfig(trade as never);
    expect(config.goods.map(goods => goods.name)).toEqual(['羽绒服', '方便面']);
    expect(config.goods[0].drift).toBeGreaterThan(0);
    expect(config.holdings.find(item => item.id === 'stall')?.initiallyOwned).toBe(true);
    expect(config.holdings.find(item => item.id === 'warehouse')?.initiallyOwned).toBe(false);
    expect(config.cycle).toBe('day');
    expect(normalizeEconomyConfig(config)).toEqual(config);
  });
});

describe('开局与旧存档迁移', () => {
  test('新开局：启动资金并入钱袋，开局产业就位', () => {
    const { state } = setup();
    expect(state.玩家.货币资源.主货币.数量).toBe(600);
    expect(state.economy?.holdings.stall.level).toBe(1);
    expect(state.economy?.holdings.warehouse).toBeUndefined();
    expect(state.economy?.fundsMerged).toBe(true);
  });

  test('旧版经营资产：资金并入钱袋，资产、库存、日志迁入，旧字段清除且只迁一次', () => {
    const { host, state } = setup(trade, legacy => {
      legacy.玩家.经营资产 = {
        资金: 765,
        资产列表: [{ id: 'kiosk', 名称: '口岸小亭', 类型: '零售', 等级: 2, 最高等级: 3, 描述: '', 状态: 'active', 基础收益: 40, 每级收益: 10, 维护费: 5 }],
        库存: { 羽绒服: 4 },
        交易日志: [{ 类型: 'sale', 描述: '卖出一批方便面', 金额: 120 }],
      };
    });
    expect(state.玩家.经营资产).toBeUndefined();
    expect(state.玩家.货币资源.主货币.数量).toBe(865);
    expect(state.economy?.holdings.kiosk).toMatchObject({ level: 2, status: 'active' });
    expect(state.economy?.holdings.kiosk.custom?.income.base).toBe(40);
    expect(state.economy?.warehouse['羽绒服']).toBe(4);
    expect(state.economy?.ledger.some(entry => entry.description.includes('并入钱袋 +765'))).toBe(true);
    expect(host.prepare(state)).toEqual(state);
  });
});

describe('产业结算', () => {
  // 由 gameplay/modules/modules.test.ts 的经营结算用例迁移：收益、人手、维护确定可算。
  test('每日结算计入人手效率与维护，收入直接进钱袋', () => {
    const config = { ...trade, assets: [{ id: 'shop', name: '杂货铺', type: '零售', level: 2, maxLevel: 5, description: '', status: 'active',
      income: { base: 100, perLevel: 20, cycle: '天' }, maintenance: 30, staff: { current: 2, max: 2, efficiency: 1.1 } }], funds: 0 };
    const { host, state } = setup(config);
    const ended = nextDay(host, state, 'd1');
    expect(ended.state.玩家.货币资源.主货币.数量).toBe(100 + 132 - 30);
    expect(ended.state.economy?.reports.at(-1)).toMatchObject({ income: 132, costs: 30, net: 102 });
    expect(ended.notes.some(note => note.text.startsWith('【经营日报】'))).toBe(true);
    expect(nextDay(host, ended.state, 'd1').status).toBe('blocked');
  });

  test('生产链按投入产出进仓库', () => {
    const config = { ...trade, funds: 0, assets: [{ id: 'mill', name: '磨坊', type: '加工', level: 1, maxLevel: 2, description: '', status: 'active',
      income: { base: 0, perLevel: 0, cycle: '天', inputs: { grain: 2 }, outputs: { flour: 3 } }, maintenance: 0 }] };
    const { host, state } = setup(config, initial => { initial.玩家.经营资产 = { 资金: 0, 资产列表: [{ id: 'mill', 名称: '磨坊', 类型: '加工', 等级: 1, 最高等级: 2, 描述: '', 状态: 'active', 基础收益: 0, 每级收益: 0, 维护费: 0 }], 库存: { grain: 2 }, 交易日志: [] }; });
    const ended = nextDay(host, state, 'd1');
    expect(ended.state.economy?.warehouse).toEqual({ flour: 3 });
  });

  test('购置、升级、雇人是原子操作；钱或材料不够时不改任何状态', () => {
    const config = { ...trade, funds: 0, assets: [{ id: 'forge', name: '工坊', type: '制造', level: 1, maxLevel: 3, description: '', status: 'active', initiallyOwned: false,
      income: { base: 10, perLevel: 2, cycle: '天' }, maintenance: 1, purchaseCost: 30, upgradeCost: 20, upgradeMaterials: { steel: 1 }, purchaseMaterials: { steel: 1 },
      staff: { current: 0, max: 2, efficiency: 1.25 } }] };
    const { host, state } = setup(config, initial => { initial.玩家.经营资产 = { 资金: 0, 资产列表: [], 库存: { steel: 2 }, 交易日志: [] }; });
    const bought = host.dispatch(state, 'economy.acquire', { id: 'forge' });
    expect(bought.status).toBe('applied');
    expect(bought.state.玩家.货币资源.主货币.数量).toBe(70);
    const upgraded = host.dispatch(bought.state, 'economy.upgrade', { id: 'forge' });
    expect(upgraded.state.economy?.holdings.forge.level).toBe(2);
    expect(upgraded.state.economy?.warehouse.steel).toBeUndefined();
    const staffed = host.dispatch(upgraded.state, 'economy.staff', { id: 'forge', count: 2 });
    expect(staffed.state.economy?.holdings.forge.staff).toBe(2);
    const again = host.dispatch(staffed.state, 'economy.upgrade', { id: 'forge' });
    expect(again.status).toBe('failed');
    expect(again.state).toEqual(staffed.state);
  });

  test('钱袋见底时按规则先停掉亏损最多的产业', () => {
    const config = { ...trade, funds: 0, assets: [{ id: 'sink', name: '赔钱铺', type: '', level: 1, maxLevel: 1, description: '', status: 'active', income: { base: 0, perLevel: 0, cycle: '天' }, maintenance: 500 }] };
    const { host, state } = setup(config);
    const ended = nextDay(host, state, 'd1');
    expect(ended.state.economy?.holdings.sink.status).toBe('idle');
    expect(ended.state.玩家.货币资源.主货币.数量).toBeGreaterThanOrEqual(0);
  });
});

describe('市场与订单', () => {
  test('买得越多越贵；仓库容量与地点限制生效；卖出提升声望', () => {
    const { host, state } = setup();
    const small = host.dispatch(state, 'economy.buy', { market: 'wholesale', goods: '方便面', quantity: 1 });
    const big = host.dispatch(state, 'economy.buy', { market: 'wholesale', goods: '方便面', quantity: 20 });
    const unitSmall = 600 - small.state.玩家.货币资源.主货币.数量;
    const unitBig = (600 - big.state.玩家.货币资源.主货币.数量) / 20;
    expect(unitBig).toBeGreaterThan(unitSmall);
    expect(host.dispatch(state, 'economy.buy', { market: 'wholesale', goods: '方便面', quantity: 31 }).reason).toContain('仓库放不下');
    expect(host.dispatch(big.state, 'economy.sell', { market: 'border', goods: '方便面', quantity: 5 }).reason).toContain('口岸');
    const there = structuredClone(big.state);
    there.世界.空间定位.当前位置 = '绥芬河口岸';
    const sold = host.dispatch(there, 'economy.sell', { market: 'border', goods: '方便面', quantity: 10 });
    expect(sold.status).toBe('applied');
    expect(sold.state.economy?.warehouse['fangbianmian'] ?? sold.state.economy?.warehouse[Object.keys(sold.state.economy!.warehouse)[0]]).toBe(10);
    expect(sold.state.economy?.reputation.border).toBeGreaterThan(0);
  });

  test('同一种子下行情走势可复现，并向基准价回归', () => {
    const first = setup();
    const second = setup();
    second.state.gameplay!.rng = structuredClone(first.state.gameplay!.rng);
    const a = nextDay(first.host, first.state, 'd1', 3);
    const b = nextDay(second.host, second.state, 'd1', 3);
    expect(a.state.economy?.markets).toEqual(b.state.economy?.markets);
    const price = a.state.economy!.markets.border.prices[Object.keys(a.state.economy!.markets.border.prices)[0]];
    expect(price).toBeGreaterThan(80 * 1.4 * 0.4);
    expect(price).toBeLessThan(80 * 1.4 * 2.5);
  });

  test('AI 给的订单酬金被限制在货值 3 倍内；按时交货得钱和声望，过期作废扣声望', () => {
    const { host, state } = setup();
    const offered = host.apply(state, [{ op: 'command', command: 'economy.offerContract', args: { goods: '方便面', quantity: 5, reward: 99999, days: 2, client: '谢尔盖' } }], { source: 'ai', label: 'ai' });
    const contract = offered.state.economy!.contracts[0];
    expect(contract.reward).toBeLessThanOrEqual(Math.round(8 * 5 * 3));
    const stocked = host.dispatch(offered.state, 'economy.buy', { market: 'wholesale', goods: '方便面', quantity: 5 });
    const delivered = host.dispatch(stocked.state, 'economy.deliver', { id: contract.id });
    expect(delivered.state.economy!.contracts[0].status).toBe('done');
    expect(delivered.state.玩家.货币资源.主货币.数量).toBeGreaterThan(stocked.state.玩家.货币资源.主货币.数量);
    const lapsed = nextDay(host, offered.state, 'late', 4);
    expect(lapsed.state.economy!.contracts[0].status).toBe('failed');
    expect(lapsed.state.economy!.reputation.wholesale).toBeLessThan(0);
  });
});

describe('变量兼容', () => {
  test('旧路径：资金写钱袋，追加资产列表建新产业，追加交易日志记账', () => {
    const { def, state } = setup();
    const manager = new VariableManager(state);
    manager.bindWorld(def);
    expect(manager.applyUpdateVariable(JSON.stringify({ effects: [
      { add: { path: '玩家.经营资产.资金', delta: 300 } },
      { append: { path: '玩家.经营资产.资产列表', value: { id: 'cart', 名称: '马车', 类型: '运输', 等级: 1, 最高等级: 2, 描述: '', 状态: 'active', 基础收益: 9999, 每级收益: 0, 维护费: 3 } } },
      { append: { path: '玩家.经营资产.交易日志', value: { 类型: 'sale', 描述: '和娜塔莎谈成一单', 金额: 0 } } },
    ] }))).toBe(true);
    const next = manager.getState();
    expect(next.玩家.货币资源.主货币.数量).toBe(900);
    expect(next.economy?.holdings.cart.custom?.income.base).toBe(500);
    expect(next.economy?.ledger.at(-1)?.description).toBe('和娜塔莎谈成一单');
    expect(next.玩家.经营资产).toBeUndefined();
  });

  test('界面数据：行情、买卖价差、可购置产业与预计净额', () => {
    const { def, state } = setup();
    const view = buildEconomyViewModel(state, def)!;
    expect(view.wallet).toBe(600);
    expect(view.projected.net).toBe(45);
    const coat = view.markets[0].goods.find(goods => goods.name === '羽绒服')!;
    expect(coat.buy).toBeGreaterThan(coat.sell);
    expect(view.offers.map(offer => offer.id)).toEqual(['warehouse']);
    expect(view.markets[1].accessible).toBe(false);
  });
});
