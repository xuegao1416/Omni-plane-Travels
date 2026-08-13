import { describe, expect, test } from 'bun:test';
import { createInitialCustomModuleState } from './stateStore';
import { executeCustomModuleLifecycle } from './runtime';
import { executeCustomModuleActions } from './actionExecutor';
import type { CustomGameplayModule, CustomGameplayModuleDefinition } from './schema';

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
  test('runs V2 input conditions and reference-valued actions while keeping writes in module state', () => {
    const v2 = {
      ...moduleDefinition,
      schemaVersion: 2 as const,
      inputs: { health: 'player.stats.attrA', currency: 'player.currency.primary' },
      permissions: { read: ['player.stats.attrA', 'player.currency.primary'], write: 'own-state-only' as const },
      logic: {
        onGameStart: [], onTurnEnd: [], onTick: [],
        onChoice: [],
        onButton: [{
          when: { type: 'compare' as const, source: 'input' as const, path: 'health', operator: 'gt' as const, value: 50 },
          actions: [{ type: 'set' as const, path: 'score', value: { source: 'input' as const, path: 'currency' } }],
        }],
      },
    } as unknown as CustomGameplayModuleDefinition;
    const initial = createInitialCustomModuleState(v2);
    const result = executeCustomModuleLifecycle(v2, initial, 'onButton', {
      now: 300,
      context: {
        game: { round: 1, time: 'day 1' },
        player: { stats: { attrA: 80 }, currency: { primary: 12 }, survival: {} },
        event: { button: { type: 'button', moduleId: 'focus-system', event: 'refresh' } },
      },
    });
    expect(result.nextState.values.score).toBe(12);
    expect(result.nextState.values.enabled).toBe(false);
  });

  test('keeps the runtime state type-safe if a damaged record bypasses installation validation', () => {
    const initial = createInitialCustomModuleState(moduleDefinition);
    const result = executeCustomModuleActions(
      moduleDefinition,
      initial,
      [{ type: 'set', path: 'score', value: { source: 'input', path: 'label' } }],
      'onButton',
      1,
      10,
      { input: { label: 'not-a-number' }, event: {} },
    );

    expect(result.nextState.values.score).toBe(0);
    expect(result.applied).toBe(0);
    expect(result.warnings).toHaveLength(1);
  });
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
