import { describe, expect, test } from 'bun:test';
import { createInitialCustomModuleState } from './stateStore';
import { executeCustomModuleLifecycle } from './runtime';
import type { CustomGameplayModule } from './schema';

const moduleDefinition = {
  kind: 'custom-gameplay-module',
  schemaVersion: 1,
  id: 'focus-system',
  name: 'Focus System',
  version: '1.0.0',
  author: 'player',
  scope: 'world',
  state: {
    score: { type: 'number', default: 0, min: 0, max: 3 },
    enabled: { type: 'boolean', default: false },
    tags: {
      type: 'array',
      items: { type: 'string', default: '' },
      default: [],
      maxItems: 2,
      maxDepth: 2,
      maxSize: 256,
    },
  },
  logic: {
    onGameStart: [],
    onTurnEnd: [
      {
        when: { type: 'compare', path: 'score', operator: 'lt', value: 3 },
        actions: [
          { type: 'add', path: 'score', value: 2 },
          { type: 'toggle', path: 'enabled' },
          { type: 'append', path: 'tags', value: 'turn' },
          { type: 'log', message: 'turn completed', level: 'info' },
        ],
      },
    ],
    onTick: [],
    onChoice: [],
  },
  permissions: { read: [], write: 'own-state-only' },
} satisfies CustomGameplayModule;

describe('custom gameplay module runtime', () => {
  test('runs a lifecycle deterministically, clamps numbers, and writes only the module namespace', () => {
    const initial = createInitialCustomModuleState(moduleDefinition);
    const first = executeCustomModuleLifecycle(moduleDefinition, initial, 'onTurnEnd', { now: 100 });
    const second = executeCustomModuleLifecycle(moduleDefinition, initial, 'onTurnEnd', { now: 100 });

    expect(first.nextState.values).toEqual({ score: 2, enabled: true, tags: ['turn'] });
    expect(first.nextState.runtime.log[0]).toEqual({ lifecycle: 'onTurnEnd', message: 'turn completed', at: 100 });
    expect(first.applied).toBe(4);
    expect(first.nextState).toEqual(second.nextState);
    expect(first.warnings).toEqual([]);
  });

  test('does not apply a false condition and clamps a later numeric increment to max', () => {
    const current = createInitialCustomModuleState(moduleDefinition);
    current.values.score = 2;
    const result = executeCustomModuleLifecycle(moduleDefinition, current, 'onTurnEnd', { now: 200 });

    expect(result.nextState.values.score).toBe(3);
    expect(result.nextState.values.tags).toEqual(['turn']);

    const noMatch = executeCustomModuleLifecycle(moduleDefinition, {
      ...current,
      values: { ...current.values, score: 3 },
    }, 'onTurnEnd', { now: 200 });
    expect(noMatch.applied).toBe(0);
    expect(noMatch.nextState.values).toEqual({ score: 3, enabled: false, tags: [] });
  });

  test('rejects an invalid module before execution and never follows a core-state path', () => {
    const invalid = {
      ...moduleDefinition,
      logic: {
        ...moduleDefinition.logic,
        onTick: [{ actions: [{ type: 'set', path: '玩家.生存状态.血量', value: 0 }] }],
      },
    } as unknown as CustomGameplayModule;
    const initial = createInitialCustomModuleState(moduleDefinition);
    const result = executeCustomModuleLifecycle(invalid, initial, 'onTick');

    expect(result.applied).toBe(0);
    expect(result.nextState).toEqual(initial);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
