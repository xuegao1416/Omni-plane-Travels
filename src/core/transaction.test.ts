// 内部事务（core/transaction.ts）：由 gameplay/kernel.test 的四条用例移植，场景与断言不变；
// 旧内核在付不起时也写一条 blocked 日志，现在直接返回原状态（没有变化就不记账）。
// 定时事件改由宿主在回合开始时投放（旧 advanceGameplayEvents 已删除）。
import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../schema/variables';
import { commitTransaction, revertTransaction } from './transaction';
import { createGameplayHost } from './registry';
import { stateDiffOps } from './state';

function createState(): GameState {
  const state = createDefaultGameState();
  state.玩家.经营资产 = { 资金: 10, 资产列表: [] };
  state.玩家.当前经验值 = 0;
  return state;
}

describe('内部事务', () => {
  test('消耗、奖励、事件与日志一起生效', () => {
    const original = createState();
    const result = commitTransaction(original, {
      id: 'business-training', moduleId: 'business', source: 'player', label: '经营研修', tick: 7,
      costs: [{ id: 'tuition', label: '学费', path: '玩家.经营资产.资金', amount: 4 }],
      ops: [{ op: 'add', path: '玩家.当前经验值', value: 3 }],
      events: [{ type: 'training.completed', payload: { discipline: 'business' } }],
    });

    expect(result.status).toBe('applied');
    expect(result.state.玩家.经营资产?.资金).toBe(6);
    expect(result.state.玩家.当前经验值).toBe(3);
    expect(original.玩家.经营资产?.资金).toBe(10);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('training.completed');
    expect(result.state.gameplay?.logs.at(-1)?.changes).toHaveLength(2);
    expect(result.state.gameplay?.pendingEvents.map(event => event.type)).toEqual(['training.completed']);
  });

  test('付不起时整笔不生效', () => {
    const original = createState();
    const result = commitTransaction(original, {
      id: 'expensive-upgrade', moduleId: 'business', source: 'player',
      costs: [{ path: '玩家.经营资产.资金', amount: 11 }],
      ops: [{ op: 'set', path: '玩家.经营资产.等级', value: 2 }],
    });

    expect(result.status).toBe('blocked');
    expect(result.state.玩家.经营资产?.资金).toBe(10);
    expect((result.state.玩家.经营资产 as Record<string, unknown>).等级).toBeUndefined();
    expect(result.reason).toContain('不足');
    expect(result.state).toBe(original);
  });

  test('任一效果失败时整笔回退', () => {
    const original = createState();
    const result = commitTransaction(original, {
      id: 'partial', source: 'system',
      ops: [{ op: 'add', path: '玩家.当前经验值', value: 3 }, { op: 'set', path: '玩家.__proto__.polluted', value: 1 }],
    });
    expect(result.status).toBe('failed');
    expect(result.state.玩家.当前经验值).toBe(0);
  });

  test('定时事件到期的那一回合才投放', () => {
    const base = createState();
    base.simulationRuntime = { ...base.simulationRuntime!, tick: 3 };
    const scheduled = commitTransaction(base, {
      id: 'schedule-market-shift', moduleId: 'business', source: 'system',
      ops: [{ op: 'schedule', event: 'market.shift', payload: { trend: 'up' }, afterTurns: 2 }],
    });
    expect(scheduled.state.gameplay?.scheduledEvents).toHaveLength(1);

    const host = createGameplayHost(undefined, scheduled.state);
    const early = host.startTurn(scheduled.state, { turnId: 't4', round: 4 });
    expect(early.events.some(event => event.type === 'market.shift')).toBe(false);
    expect(early.state.gameplay?.scheduledEvents).toHaveLength(1);

    const due = host.startTurn(early.state, { turnId: 't5', round: 5 });
    expect(due.events.find(event => event.type === 'market.shift')?.payload).toEqual({ trend: 'up' });
    expect(due.state.gameplay?.scheduledEvents).toHaveLength(0);
  });

  test('只在写入仍是当前值时才能撤销', () => {
    const applied = commitTransaction(createState(), {
      id: 'undoable', moduleId: 'business', source: 'player',
      ops: [{ op: 'add', path: '玩家.经营资产.资金', value: 5 }],
      events: [{ type: 'business.test' }],
    });
    const reverted = revertTransaction(applied.state, 'undoable');
    expect(reverted.status).toBe('applied');
    expect(reverted.state.玩家.经营资产?.资金).toBe(10);
    expect(reverted.state.gameplay?.pendingEvents).toHaveLength(0);
    expect(reverted.state.gameplay?.logs.find(log => log.transactionId === 'undoable')?.status).toBe('reverted');

    const changed = commitTransaction(applied.state, {
      id: 'later', moduleId: 'business', source: 'player',
      ops: [{ op: 'add', path: '玩家.经营资产.资金', value: 1 }],
    });
    const blocked = revertTransaction(changed.state, 'undoable');
    expect(blocked.status).toBe('blocked');
    expect(blocked.reason).toContain('覆盖');
  });

  test('宿主写下的日志也能撤销', () => {
    const state = createState();
    const host = createGameplayHost(undefined, state);
    const applied = host.apply(host.prepare(state), [{ op: 'add', path: '玩家.当前经验值', value: 2 }], { source: 'system', label: '测试', transactionId: 'host-tx' });
    expect(applied.state.玩家.当前经验值).toBe(2);
    const reverted = revertTransaction(applied.state, 'host-tx');
    expect(reverted.status).toBe('applied');
    expect(reverted.state.玩家.当前经验值).toBe(0);
  });

  // 由 gameplay/stateDiff.test 移植。
  test('隔离草稿不记录未变的数组和不可变的模块定义', () => {
    const before = { customModules: { story: { definition: { logic: [{ actions: [{ type: 'set', value: 1 }] }] }, values: { count: 0 }, runtime: { processedEvents: [] } } }, history: [{ changes: [1, 2] }] };
    const after = structuredClone(before);
    after.customModules.story.values.count = 1;
    expect(stateDiffOps(before, after)).toEqual([{ op: 'set', path: 'customModules.story.values.count', value: 1 }]);
    expect(stateDiffOps({ a: { b: 1 } }, { a: {} })).toEqual([{ op: 'remove', path: 'a.b' }]);
  });
});
