import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { createGameplayHost } from '../../core/registry';
import { ModifierQuery } from '../../core/modifiers';
import { normalizeResourcesConfig, parseUpkeepText } from './config';
import { buildResourcesViewModel } from './viewModel';
import { VariableManager } from '../../engine/variableManager';

function world(config: Record<string, unknown>, mode: 'relative' | 'gregorian' = 'relative'): WorldDef {
  return { id: 'res_world', name: '物资世界', description: '', modules: [{ moduleId: 'survival', enabled: true, moduleConfig: config }],
    worldBookEntries: mode === 'relative' ? [] : undefined } as unknown as WorldDef;
}

const island = {
  description: '荒岛',
  resources: [
    { id: 'water', name: '淡水', symbol: '💧', amount: 3, max: 10, scarce: true, description: '每天每人消耗1单位。' },
    { id: 'food', name: '食物', symbol: '🍖', amount: 2, max: 10, scarce: true, description: '来源包括捕鱼。' },
    { id: 'wood', name: '木材', symbol: '🪵', amount: 0, max: 20, scarce: false, description: '建造用', gatherAmount: 2, gatherTimeMinutes: 45, gatherStaminaCost: 5 },
    { id: 'stone', name: '石材', symbol: '🪨', amount: 0, max: 15, scarce: false, description: '' },
    { id: 'axe', name: '石斧', symbol: '🪓', amount: 0, max: 3, scarce: false, description: '' },
  ],
  recipes: [{ id: 'axe', name: '石斧', inputs: { wood: 2, stone: 1 }, output: { resourceId: 'axe', amount: 1 }, description: '', craftTimeMinutes: 30 }],
  rules: { cycleName: '一天', consumePerCycle: '每人每天消耗1淡水 + 1食物；生病或受伤时消耗加倍', criticalThreshold: 2 },
};

function setup(config: Record<string, unknown> = island, legacy?: GameState['玩家']['生存资源']) {
  const def = world(config);
  const state = createDefaultGameState();
  state.世界.时间系统.时钟 = { schemaVersion: 2, elapsedMinutes: 6 * 60 };
  state.玩家.生存状态.体力值 = 20;
  if (legacy) state.玩家.生存资源 = legacy;
  const host = createGameplayHost(def, state);
  return { def, host, state: host.prepare(state) };
}

describe('配置规范化', () => {
  test('从规则文字读出每日消耗，消耗品成为必需品并带匮乏状态', () => {
    const config = normalizeResourcesConfig(island as never);
    const water = config.resources.find(item => item.id === 'water')!;
    expect(water.upkeep).toBe(1);
    expect(water.kind).toBe('vital');
    expect(config.resources.find(item => item.id === 'wood')!.kind).toBe('material');
    expect(config.statuses.some(status => status.id === water.depletedStatus && status.name === '缺水')).toBe(true);
    expect(parseUpkeepText('每天喝 2 淡水', [{ id: 'water', name: '淡水' }])).toEqual({ water: 2 });
    expect(normalizeResourcesConfig(config).resources).toEqual(config.resources);
  });
});

describe('旧存档迁移', () => {
  test('玩家.生存资源 / 生存配方 / gameplay.survival 迁入资源模块，旧字段清除', () => {
    const state = createDefaultGameState();
    state.玩家.生存资源 = { water: { 数量: 4, 最大值: 12 }, shells: { 数量: 3, 最大值: 9, name: '贝壳', symbol: '🐚' } };
    state.玩家.生存配方 = [{ id: 'cup', name: '椰壳杯', inputs: { shells: 1 }, output: { resourceId: 'water', amount: 1 }, description: '' }];
    state.gameplay = { schemaVersion: 1, sequence: 0, pendingEvents: [], eventHistory: [], scheduledEvents: [], logs: [], settlementKeys: {},
      survival: { unlockedRecipes: ['axe'], statuses: { deprived_water: { value: 1, source: 'legacy' } } } };
    const host = createGameplayHost(world(island), state);
    const migrated = host.prepare(state);
    expect(migrated.玩家.生存资源).toBeUndefined();
    expect(migrated.玩家.生存配方).toBeUndefined();
    expect(migrated.gameplay?.survival).toBeUndefined();
    expect(migrated.resources?.stocks).toMatchObject({ water: 4, shells: 3, food: 2, wood: 0 });
    expect(host.facts.read(migrated, 'player.resources.water.max')).toBe(12);
    expect(migrated.resources?.discovered.shells.name).toBe('贝壳');
    expect(migrated.resources?.customRecipes[0]).toMatchObject({ id: 'cup', outputs: { water: 1 }, custom: true });
    expect(migrated.resources?.unlockedRecipes).toEqual(['axe']);
    expect(host.prepare(migrated)).toEqual(migrated);
  });
});

describe('采集与制作', () => {
  test('采集一次性加物资、扣体力、推进时钟；满仓或体力不足时不改任何状态', () => {
    const { host, state } = setup();
    const gathered = host.dispatch(state, 'resources.gather', { id: 'wood' });
    expect(gathered.status).toBe('applied');
    expect(gathered.state.resources?.stocks.wood).toBe(2);
    expect(gathered.state.玩家.生存状态.体力值).toBe(15);
    expect(gathered.state.世界.时间系统.时钟?.elapsedMinutes).toBe(6 * 60 + 45);
    expect(gathered.notes[0].text).toContain('木材');
    const tired = structuredClone(gathered.state);
    tired.玩家.生存状态.体力值 = 3;
    const refused = host.dispatch(tired, 'resources.gather', { id: 'wood' });
    expect(refused.status).toBe('failed');
    expect(refused.state).toEqual(tired);
  });

  test('制作原子地消耗全部材料；材料不足时不扣不产也不耗时', () => {
    const { host, state } = setup(island, { wood: { 数量: 2 }, stone: { 数量: 1 }, axe: { 数量: 0 } } as never);
    const first = host.dispatch(state, 'resources.craft', { id: 'axe' });
    expect(first.status).toBe('applied');
    expect(first.state.resources?.stocks).toMatchObject({ wood: 0, stone: 0, axe: 1 });
    expect(first.state.世界.时间系统.时钟?.elapsedMinutes).toBe(6 * 60 + 30);
    const second = host.dispatch(first.state, 'resources.craft', { id: 'axe' });
    expect(second.status).toBe('failed');
    expect(second.state).toEqual(first.state);
  });

  test('产出受容量限制，材料照常扣除，配方定义不被改动', () => {
    const config = { ...island, recipes: [{ id: 'plank', name: '木板', inputs: { wood: 2 }, output: { resourceId: 'stone', amount: 5 }, description: '' }] };
    const { host, state } = setup(config, { wood: { 数量: 8, 最大值: 20 }, stone: { 数量: 13, 最大值: 15 } } as never);
    const result = host.dispatch(state, 'resources.craft', { id: 'plank' });
    expect(result.state.resources?.stocks).toMatchObject({ wood: 6, stone: 15 });
    expect(config.recipes[0].output.amount).toBe(5);
  });

  test('配方解锁条件与费用；未解锁不能制作', () => {
    const config = { ...island, recipes: [{ id: 'axe', name: '石斧', inputs: { wood: 1 }, output: { resourceId: 'axe', amount: 1 }, description: '',
      unlockConditions: [{ state: { path: '玩家.当前目标', op: '==', value: '允许' } }], unlockCost: [{ path: '玩家.生存资源.stone.数量', amount: 1 }], craftTimeMinutes: 30 }] };
    const { host, state } = setup(config, { wood: { 数量: 2 }, stone: { 数量: 1 } } as never);
    expect(host.dispatch(state, 'resources.craft', { id: 'axe' }).status).toBe('failed');
    expect(host.dispatch(state, 'resources.unlockRecipe', { id: 'axe' }).status).toBe('failed');
    state.玩家.当前目标 = '允许';
    const unlocked = host.dispatch(state, 'resources.unlockRecipe', { id: 'axe' });
    expect(unlocked.status).toBe('applied');
    expect(unlocked.state.resources?.stocks.stone).toBe(0);
    expect(host.dispatch(unlocked.state, 'resources.craft', { id: 'axe' }).state.resources?.stocks.axe).toBe(1);
  });
});

describe('每日结算', () => {
  function endDay(host: ReturnType<typeof setup>['host'], state: GameState, turnId: string, hours = 24) {
    const previousClock = structuredClone(state.世界.时间系统.时钟!);
    const next = structuredClone(state);
    next.世界.时间系统.时钟 = { ...previousClock, elapsedMinutes: previousClock.elapsedMinutes + hours * 60 };
    return host.endTurn(next, { turnId, round: 1, previousClock });
  }

  test('跨一天只扣一次必需品；同一回合重复结算不会再扣', () => {
    const { host, state } = setup();
    const ended = endDay(host, state, 't1');
    expect(ended.state.resources?.stocks).toMatchObject({ water: 2, food: 1, wood: 0 });
    expect(host.endTurn(ended.state, { turnId: 't1', round: 1, previousClock: state.世界.时间系统.时钟 }).status).toBe('blocked');
    expect(ended.state.resources?.ledger.at(-1)?.reason).toBe('每日消耗');
  });

  test('必需品不够时进入匮乏：每天掉生命体力、检定减值；补充后解除', () => {
    const { host, state } = setup(island, { water: { 数量: 0 }, food: { 数量: 5 } } as never);
    const ended = endDay(host, state, 't1');
    expect(ended.state.resources?.statuses['deprived:water']).toBeDefined();
    expect(ended.events.some(event => event.type === 'status.applied')).toBe(true);
    expect(ended.notes.some(note => note.text.includes('缺水'))).toBe(true);
    // 断水的当天就算一天匮乏。
    expect(ended.state.玩家.生存状态.血量).toBe(85);
    const thirsty = endDay(host, ended.state, 't2');
    expect(thirsty.state.玩家.生存状态.血量).toBe(70);
    // 状态加成由模块实时提供，不写进存档。
    expect(Object.keys(thirsty.state.gameplay?.modifiers ?? {})).toEqual([]);
    expect(new ModifierQuery(thirsty.state).apply('dice.check.dim1', 10)).toBe(10);
    expect(host.modifierQuery(thirsty.state).apply('dice.check.dim1', 10)).toBe(8);
    const refilled = host.dispatch(thirsty.state, 'resources.grant', { id: 'water', amount: 3 });
    expect(refilled.state.resources?.statuses['deprived:water']).toBeUndefined();
    expect(refilled.events.some(event => event.type === 'resources.restored')).toBe(true);
  });

  test('按回合消耗的世界每个成功回合扣一次', () => {
    const { host, state } = setup({ ...island, rules: { cycleName: '回合', consumePerCycle: '' }, consumption: { perCycle: { water: 1 } } });
    const ended = host.endTurn(state, { turnId: 'r1', round: 1, previousClock: state.世界.时间系统.时钟 });
    expect(ended.state.resources?.stocks.water).toBe(2);
    expect(ended.state.resources?.stocks.food).toBe(2);
  });
});

// 由 __tests__/variableManager.test 的 applyModuleEffects 用例移植：旧的「机械层统一结算」入口已删除，
// 同样的写入现在由 AI 更新（applyUpdateVariable）经宿主落到资源模块。
describe('AI 写入物资', () => {
  test('同一次跨模块写入作为一笔事务提交并记账', () => {
    const { def, state } = setup();
    state.玩家.经营资产 = { 资金: 20, 资产列表: [] };
    const manager = new VariableManager(state);
    manager.bindWorld(def);
    expect(manager.applyUpdateVariable(JSON.stringify({ effects: [
      { add: { path: '玩家.生存资源.water.数量', delta: -2 } },
      { add: { path: '玩家.经营资产.资金', delta: 5 } },
    ] }))).toBe(true);
    const next = manager.getState();
    expect(next.resources?.stocks.water).toBe(1);
    expect(next.玩家.经营资产?.资金).toBe(25);
    const paths = next.gameplay?.logs.at(-1)?.changes.map(change => change.path) ?? [];
    expect(paths).toEqual(expect.arrayContaining(['resources.stocks.water', '玩家.经营资产.资金']));
  });

  test('扣减在 0 处钳制，物资名称与图标保留', () => {
    const { def, state } = setup();
    const manager = new VariableManager(state);
    manager.bindWorld(def);
    expect(manager.applyUpdateVariable(JSON.stringify({ effects: [{ add: { path: '玩家.生存资源.water.数量', delta: -10 } }] }))).toBe(true);
    expect(manager.getState().resources?.stocks.water).toBe(0);
    const water = buildResourcesViewModel(manager.getState(), def)!.resources.find(item => item.id === 'water')!;
    expect(water.name).toBe('淡水');
    expect(water.symbol).toBe('💧');
  });

  test('旧存档里的新物资迁入时保留全部可选元数据', () => {
    const { state } = setup(island, { ore: { 数量: 1, name: '矿石', symbol: '⛏️', 最大值: 99, scarce: true, description: '罕见', gatherRate: '2', usage: '锻造' } } as never);
    expect(state.resources?.stocks.ore).toBe(1);
    expect(state.resources?.discovered.ore).toMatchObject({ name: '矿石', symbol: '⛏️', max: 99, scarce: true, description: '罕见', gatherText: '2', usageText: '锻造' });
  });
});

describe('变量与演化', () => {
  test('旧路径写入走资源模块并按容量钳位；未知物资拒绝并给出可用列表', () => {
    const { def, state } = setup();
    const manager = new VariableManager(state);
    manager.bindWorld(def);
    expect(manager.applyUpdateVariable(JSON.stringify({ effects: [{ add: { path: '玩家.生存资源.water.数量', delta: 50 } }] }))).toBe(true);
    expect(manager.getState().resources?.stocks.water).toBe(10);
    expect(manager.getState().玩家.生存资源).toBeUndefined();
    expect(manager.applyUpdateVariable(JSON.stringify({ effects: [{ set: { path: '玩家.生存资源.gold.数量', value: 3 } }] }))).toBe(false);
    expect(manager.getLastAiUpdateRejection()).toContain('water(淡水)');
  });

  test('演化步骤按回合或剧情关键词触发一次，带来新物资', () => {
    const config = { ...island, resourceEvolution: [{ id: 'reef', trigger: { keywords: ['礁石'] }, add: [{ id: 'shell', name: '贝壳', symbol: '🐚', amount: 2, max: 9, scarce: false, description: '' }], narrateHint: '退潮后礁石露出来了。' }] };
    const { host, state } = setup(config);
    const quiet = host.endTurn(state, { turnId: 'a', round: 1, previousClock: state.世界.时间系统.时钟, userText: '休息' });
    expect(quiet.state.resources?.discovered.shell).toBeUndefined();
    const found = host.endTurn(quiet.state, { turnId: 'b', round: 2, previousClock: state.世界.时间系统.时钟, narrative: '你走到礁石边。' });
    expect(found.state.resources?.stocks.shell).toBe(2);
    expect(found.notes.some(note => note.text.includes('礁石露出来'))).toBe(true);
  });

  test('界面数据给出剩余天数、告急与可制作状态', () => {
    const { def, state } = setup(island, { water: { 数量: 1 }, food: { 数量: 5 }, wood: { 数量: 2 }, stone: { 数量: 1 } } as never);
    const view = buildResourcesViewModel(state, def)!;
    const water = view.resources.find(item => item.id === 'water')!;
    expect(water.remainingLabel).toBe('约 1 天');
    expect(water.tone).toBe('low');
    expect(view.alerts.some(alert => alert.includes('淡水'))).toBe(true);
    expect(view.recipes[0]).toMatchObject({ id: 'axe', craftable: true });
  });
});
