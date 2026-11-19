import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../schema/variables';
import { Rng, createRngState } from './rng';
import { FactRegistry } from './facts';
import { coreFactSpecs, coreModule } from './coreModule';
import { compareValues, evaluateCondition } from './conditions';
import { applyOps } from './ops';
import { GameplayHost, type GameplayModule } from './host';
import { ModifierQuery, addModifier } from './modifiers';
import { crossedCycles, periodFromCycleName } from './cycles';
import { normalizeTimeSystemConfig } from '../time/worldClock';

function baseState(): GameState {
  const state = createDefaultGameState();
  state.玩家.姓名 = '测试者';
  state.玩家.货币资源.主货币 = { 名称: '铜钱', 数量: 100 };
  state.人物档案.林晚 = { 关系数据: { 好感度: 10, 关系类型: '熟人' } } as never;
  return state;
}

describe('种子随机', () => {
  test('同一种子与计数得到同一序列，计数随取数推进', () => {
    const left = new Rng(createRngState('seed'));
    const right = new Rng(createRngState('seed'));
    const sequence = [left.next(), left.int(1, 20), left.weightedIndex([1, 0, 3])];
    expect([right.next(), right.int(1, 20), right.weightedIndex([1, 0, 3])]).toEqual(sequence);
    expect(left.state.counter).toBe(3);
    expect(new Rng(createRngState('other')).next()).not.toBe(sequence[0]);
  });
});

describe('变量注册表', () => {
  const facts = new FactRegistry(coreFactSpecs());

  test('规范路径、旧中文别名与自创模块路径指向同一存储', () => {
    const state = baseState();
    expect(facts.read(state, 'player.currency')).toBe(100);
    expect(facts.read(state, '玩家.货币资源.主货币.数量')).toBe(100);
    expect(facts.read(state, 'player.currency.primary')).toBe(100);
    expect(facts.read(state, '人物档案.林晚.关系数据.好感度')).toBe(10);
    expect(facts.resolve('npc.林晚.affinity')?.storagePath).toBe('人物档案.林晚.关系数据.好感度');
  });

  test('数值写入按范围钳位，严格扣减不足时拒绝', () => {
    const state = baseState();
    expect(facts.add(state, 'npc.林晚.affinity', 500, 'ai').ok).toBe(true);
    expect(state.人物档案.林晚.关系数据.好感度).toBe(100);
    const pay = facts.add(state, 'player.currency', -150, 'event', { strict: true });
    expect(pay.ok).toBe(false);
    expect(pay.reason).toContain('不足');
    expect(state.玩家.货币资源.主货币.数量).toBe(100);
  });

  test('物品数量写入自动建档，清零后移除', () => {
    const state = baseState();
    facts.add(state, 'player.items.火把', 2, 'event');
    expect(state.玩家.物品栏.火把.数量).toBe(2);
    facts.add(state, '玩家.物品栏.火把.数量', -2, 'ai');
    expect(state.玩家.物品栏.火把).toBeUndefined();
  });

  test('只读变量拒绝 AI 写入，未登记路径只在允许的根下按原路径读写', () => {
    const state = baseState();
    expect(facts.set(state, 'world.time', '明天', 'ai').ok).toBe(false);
    expect(facts.set(state, '玩家.性格', '沉稳', 'ai').ok).toBe(true);
    expect(state.玩家.性格).toBe('沉稳');
    expect(facts.set(state, 'gameplay.logs', [], 'ai').ok).toBe(false);
  });
});

describe('条件', () => {
  const facts = new FactRegistry(coreFactSpecs());

  test('数字字符串与数字按数值比较（旧卡片 flow.branch 的 compareValue 是字符串）', () => {
    expect(compareValues('==', 50, '50')).toBe(true);
    expect(compareValues('>=', '7', 5)).toBe(true);
    expect(compareValues('==', true, 1)).toBe(false);
  });

  test('旧 state 条件经别名读取，事件条件支持通配', () => {
    const state = baseState();
    expect(evaluateCondition({ all: [
      { state: { path: '玩家.货币资源.主货币.数量', op: '>=', value: 100 } },
      { fact: 'npc.林晚.known', op: '==', value: true },
      { event: { type: 'resources.*' } },
    ] }, { state, facts, events: [{ type: 'resources.depleted', payload: { id: 'food' } }] })).toBe(true);
    expect(evaluateCondition({ hours: [20, 4] }, { state, facts, hourOfDay: 2 })).toBe(true);
    expect(evaluateCondition({ hours: [20, 4] }, { state, facts, hourOfDay: 12 })).toBe(false);
  });
});

describe('效果语言', () => {
  const facts = new FactRegistry(coreFactSpecs());

  test('非尽力模式下任一效果失败则整体不生效', () => {
    const state = baseState();
    const outcome = applyOps(state, [
      { op: 'add', path: 'player.currency', value: -30 },
      { op: 'add', path: 'player.currency', value: -500, strict: true },
    ], { facts, source: 'event', turn: 1, rng: new Rng(createRngState('x')) });
    expect(outcome.status).toBe('failed');
    expect(outcome.state.玩家.货币资源.主货币.数量).toBe(100);
  });

  test('条件分支、备注、抽卡与修正器一起输出', () => {
    const state = baseState();
    const outcome = applyOps(state, [
      { op: 'if', when: { fact: 'player.currency', op: '>=', value: 50 }, then: [
        { op: 'add', path: 'player.currency', value: -50, strict: true },
        { op: 'note', text: '你付了五十文。' },
        { op: 'modifier', modifier: { id: 'm1', target: 'dice.check', mode: 'flat', value: 1, turns: 2 } },
      ], else: [{ op: 'card', eventId: 'broke' }] },
    ], { facts, source: 'event', turn: 3, rng: new Rng(createRngState('x')) });
    expect(outcome.status).toBe('applied');
    expect(outcome.state.玩家.货币资源.主货币.数量).toBe(50);
    expect(outcome.notes[0].text).toBe('你付了五十文。');
    expect(outcome.cards).toEqual([]);
    expect(new ModifierQuery(outcome.state).apply('dice.check.dim3', 10)).toBe(11);
    expect(outcome.changes.some(change => change.path === '玩家.货币资源.主货币.数量')).toBe(true);
  });
});

describe('修正器', () => {
  test('flat 先加，mult 后乘；更具体的查询包含通用目标', () => {
    const state = baseState();
    addModifier(state, { id: 'a', target: 'economy.price', mode: 'mult', value: 0.1, source: 'talent' });
    addModifier(state, { id: 'b', target: 'economy.price.sell', mode: 'flat', value: 2, source: 'status' });
    const query = new ModifierQuery(state);
    expect(query.apply('economy.price.sell', 10)).toBeCloseTo(13.2);
    expect(query.apply('economy.price.buy', 10)).toBeCloseTo(11);
  });
});

describe('周期', () => {
  test('时钟前进跨过的小时、天数', () => {
    const config = normalizeTimeSystemConfig({});
    const ticks = crossedCycles({ schemaVersion: 1, elapsedMinutes: 0 }, { schemaVersion: 1, elapsedMinutes: 60 * 30 }, config);
    expect(ticks.find(tick => tick.period === 'hour')?.count).toBe(30);
    expect(ticks.find(tick => tick.period === 'day')?.count).toBeGreaterThanOrEqual(1);
    expect(crossedCycles({ schemaVersion: 1, elapsedMinutes: 10 }, { schemaVersion: 1, elapsedMinutes: 10 }, config)).toEqual([]);
  });

  test('世界配置里的周期名映射', () => {
    expect(periodFromCycleName('一天')).toBe('day');
    expect(periodFromCycleName('趟')).toBe('day');
    expect(periodFromCycleName('回合')).toBe('turn');
    expect(periodFromCycleName('周')).toBe('week');
  });
});

describe('玩法宿主', () => {
  const counter: GameplayModule<{ step: number }> = {
    id: 'counter',
    label: '计数',
    resolveConfig: () => ({ step: 2 }),
    prepare: state => { (state as any).counter ??= { value: 0, days: 0 }; },
    facts: () => [{ id: 'counter.value', module: 'counter', type: 'number', label: '计数', storage: 'counter.value', bounds: { min: 0 }, writable: ['event'] }],
    commands: {
      bump: (state, args, context) => {
        const amount = Number(args.amount ?? context.config.step);
        if (amount <= 0) return { ok: false, reason: '数量必须为正' };
        (state as any).counter.value += amount;
        context.emit('counter.bumped', { value: (state as any).counter.value });
        return { ok: true, message: `+${amount}` };
      },
    },
    onCycle: (state, _context, cycle) => { if (cycle.period === 'day') (state as any).counter.days += cycle.count; },
    on: {
      'counter.bumped': (state, event, context) => { if (Number(event.payload.value) >= 4) context.note('计数到了四。'); },
    },
  };

  test('命令失败不改状态；成功后事件链触发备注并写入日志', () => {
    const state = baseState();
    const host = new GameplayHost(undefined, [coreModule, counter], state);
    const prepared = host.prepare(state);
    expect(host.dispatch(prepared, 'counter.bump', { amount: -1 }).status).toBe('failed');
    const first = host.dispatch(prepared, 'counter.bump', {});
    const second = host.dispatch(first.state, 'counter.bump', {});
    expect((second.state as any).counter.value).toBe(4);
    expect(second.notes.map(note => note.text)).toEqual(['计数到了四。']);
    expect(second.state.gameplay?.logs.at(-1)?.changes.some(change => change.path === 'counter.value')).toBe(true);
    expect(host.dispatch(prepared, 'missing.command').status).toBe('failed');
  });

  test('回合开始推进回合数且同一回合只结算一次；回合结束按时钟跨天结算', () => {
    const state = baseState();
    state.世界.时间系统.时钟 = { schemaVersion: 1, elapsedMinutes: 0 };
    const host = new GameplayHost(undefined, [coreModule, counter], state);
    const prepared = host.prepare(state);
    const started = host.startTurn(prepared, { turnId: 't1', round: 1 });
    expect(started.state.simulationRuntime?.tick).toBe(1);
    expect(host.startTurn(started.state, { turnId: 't1', round: 1 }).status).toBe('blocked');
    const advanced = structuredClone(started.state);
    advanced.世界.时间系统.时钟 = { schemaVersion: 1, elapsedMinutes: 60 * 49 };
    const ended = host.endTurn(advanced, { turnId: 't1', round: 1, previousClock: { schemaVersion: 1, elapsedMinutes: 0 } });
    expect((ended.state as any).counter.days).toBeGreaterThanOrEqual(2);
    expect(ended.events.some(event => event.type === 'time.day')).toBe(true);
    expect(host.endTurn(ended.state, { turnId: 't1', round: 1, previousClock: { schemaVersion: 1, elapsedMinutes: 0 } }).status).toBe('blocked');
  });
});
