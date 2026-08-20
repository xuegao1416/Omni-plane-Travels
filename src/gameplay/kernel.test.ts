import { describe, expect, test } from 'bun:test';
import {
  advanceGameplayEvents,
  executeGameplayTransaction,
  revertGameplayTransaction,
  type GameplayStateRoot,
} from './kernel';

interface KernelTestState extends GameplayStateRoot {
  玩家: {
    经营资产: { 资金: number };
    当前经验值: number;
  };
}

function createState(): KernelTestState {
  return {
    玩家: {
      经营资产: { 资金: 10 },
      当前经验值: 0,
    },
  };
}

describe('unified gameplay kernel', () => {
  test('atomically applies conditions, costs, rewards, events and logs', () => {
    const original = createState();
    const result = executeGameplayTransaction(original, {
      id: 'business-training',
      moduleId: 'business',
      source: 'player',
      label: '经营研修',
      conditions: [
        { state: { path: '玩家.经营资产.资金', op: '>=', value: 4 } },
      ],
      costs: [
        { id: 'tuition', label: '学费', path: '玩家.经营资产.资金', amount: 4 },
      ],
      rewards: [
        {
          id: 'experience',
          label: '研修经验',
          effects: [{ add: { path: '玩家.当前经验值', delta: 3 } }],
        },
      ],
      events: [{ type: 'training.completed', payload: { discipline: 'business' } }],
    }, { tick: 7, enabledModules: ['business', 'progression'] });

    expect(result.status).toBe('applied');
    expect((result.state.玩家 as any).经营资产.资金).toBe(6);
    expect((result.state.玩家 as any).当前经验值).toBe(3);
    expect((original.玩家 as any).经营资产.资金).toBe(10);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('training.completed');
    expect(result.state.gameplay?.logs.at(-1)?.changes).toHaveLength(2);
  });

  test('rejects an unaffordable transaction without partial state changes', () => {
    const result = executeGameplayTransaction(createState(), {
      id: 'expensive-upgrade',
      moduleId: 'business',
      source: 'player',
      costs: [{ path: '玩家.经营资产.资金', amount: 11 }],
      effects: [{ set: { path: '玩家.经营资产.等级', value: 2 } }],
    }, { tick: 8, enabledModules: ['business'] });

    expect(result.status).toBe('blocked');
    expect((result.state.玩家 as any).经营资产.资金).toBe(10);
    expect((result.state.玩家 as any).经营资产.等级).toBeUndefined();
    expect(result.reason).toContain('不足');
    expect(result.state.gameplay?.logs.at(-1)?.status).toBe('blocked');
  });

  test('releases scheduled events only when their gameplay tick is due', () => {
    const scheduled = executeGameplayTransaction(createState(), {
      id: 'schedule-market-shift',
      moduleId: 'business',
      source: 'system',
      effects: [{
        schedule: {
          after: 2,
          event: { type: 'market.shift', payload: { trend: 'up' } },
        },
      }],
    }, { tick: 3, enabledModules: ['business'] });

    const early = advanceGameplayEvents(scheduled.state, 4);
    expect(early.events).toHaveLength(0);
    expect(early.state.gameplay?.scheduledEvents).toHaveLength(1);

    const due = advanceGameplayEvents(early.state, 5);
    expect(due.events).toHaveLength(1);
    expect(due.events[0].type).toBe('market.shift');
    expect(due.state.gameplay?.scheduledEvents).toHaveLength(0);
  });

  test('reverts an applied transaction only while its writes are still current', () => {
    const applied = executeGameplayTransaction(createState(), {
      id: 'undoable', moduleId: 'business', source: 'player',
      effects: [{ add: { path: '玩家.经营资产.资金', delta: 5 } }],
      events: [{ type: 'business.test' }],
    }, { tick: 9, enabledModules: ['business'] });
    const reverted = revertGameplayTransaction(applied.state, 'undoable', { tick: 10, enabledModules: ['business'] });
    expect(reverted.status).toBe('applied');
    expect(reverted.state.玩家.经营资产.资金).toBe(10);
    expect(reverted.state.gameplay?.pendingEvents).toHaveLength(0);
    expect(reverted.state.gameplay?.logs.find(log => log.transactionId === 'undoable')?.status).toBe('reverted');

    const changed = executeGameplayTransaction(applied.state, {
      id: 'later', moduleId: 'business', source: 'player',
      effects: [{ add: { path: '玩家.经营资产.资金', delta: 1 } }],
    }, { tick: 10, enabledModules: ['business'] });
    expect(revertGameplayTransaction(changed.state, 'undoable', { tick: 11, enabledModules: ['business'] }).status).toBe('blocked');
  });
});
