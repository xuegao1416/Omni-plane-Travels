import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { clearCustomGameplayModules, bindCustomGameplayModule, saveCustomGameplayModule } from './storage';
import type { CustomGameplayModule, CustomGameplayModuleDefinition } from './schema';
import { runCustomModulesForWorldAndCommit } from './engineBridge';

const cardOverlaySource = readFileSync(new URL('../components/event/CardOverlay.tsx', import.meta.url), 'utf8');
const startScreenSource = readFileSync(new URL('../components/start/useStartScreen.ts', import.meta.url), 'utf8');

const moduleDefinition = {
  kind: 'custom-gameplay-module',
  schemaVersion: 1,
  id: 'background-pulse',
  name: 'Background Pulse',
  version: '1.0.0',
  author: 'test',
  scope: 'world',
  state: { pulseCount: { type: 'number', default: 0 } },
  logic: {
    onGameStart: [],
    onTurnEnd: [],
    onTick: [{ actions: [{ type: 'add', path: 'pulseCount', value: 1 }] }],
    onChoice: [],
  },
  permissions: { read: [], write: 'own-state-only' },
} satisfies CustomGameplayModule;

const secondWorldModule = {
  ...moduleDefinition,
  id: 'world-b-pulse',
} satisfies CustomGameplayModule;

afterEach(async () => {
  await clearCustomGameplayModules();
});

describe('custom module lifecycle commit bridge', () => {
  test('keeps card closing and world creation independent from custom module failures', () => {
    expect(cardOverlaySource.indexOf('setTimeout(close, 600)')).toBeLessThan(cardOverlaySource.indexOf('onChoice?.({'));
    expect(cardOverlaySource).toContain('Promise.resolve');
    expect(cardOverlaySource).toContain('console.warn');

    const gameStartSection = startScreenSource.slice(
      startScreenSource.indexOf("'onGameStart'"),
      startScreenSource.indexOf('// 构建初始消息列表'),
    );
    expect(gameStartSection).toContain('catch');
    expect(gameStartSection).toContain('console.warn');
    expect(gameStartSection).not.toContain('autoSave');
    expect(gameStartSection).not.toContain('scheduleAutoSave');
  });

  test('routes game start, choice, and the exact module button through the same commit bridge', async () => {
    const lifecycleModule = {
      ...moduleDefinition,
      id: 'lifecycle-pulse',
      schemaVersion: 2,
      inputs: {},
      state: {
        starts: { type: 'number', default: 0 },
        choices: { type: 'number', default: 0 },
        buttons: { type: 'number', default: 0 },
      },
      logic: {
        onGameStart: [{ actions: [{ type: 'add', path: 'starts', value: 1 }] }],
        onTurnEnd: [], onTick: [],
        onChoice: [{ actions: [{ type: 'add', path: 'choices', value: 1 }] }],
        onButton: [{ actions: [{ type: 'add', path: 'buttons', value: 1 }] }],
      },
    } as unknown as CustomGameplayModuleDefinition;
    await saveCustomGameplayModule(lifecycleModule);
    await bindCustomGameplayModule(lifecycleModule.id, 'world-a');
    const gameState = createDefaultGameState();
    const commits: number[] = [];
    const commit = (nextState: typeof gameState) => commits.push(Object.keys(nextState.customModules ?? {}).length);
    await runCustomModulesForWorldAndCommit(gameState, 'world-a', 'onGameStart', { round: 0, now: 1 }, { commit });
    await runCustomModulesForWorldAndCommit(gameState, 'world-a', 'onChoice', { event: { type: 'choice', selectedIndex: 1 }, now: 2 }, { commit });
    await runCustomModulesForWorldAndCommit(gameState, 'world-a', 'onButton', { event: { type: 'button', moduleId: lifecycleModule.id, event: 'refresh' }, now: 3 }, { commit });
    const values = gameState.customModules?.[lifecycleModule.id]?.values;
    expect(values).toEqual({ starts: 1, choices: 1, buttons: 1 });
    expect(commits).toHaveLength(3);
  });

  test('does not run choice or button lifecycles without the matching event context', async () => {
    const lifecycleModule = {
      ...moduleDefinition,
      id: 'guarded-events',
      schemaVersion: 2,
      inputs: {},
      logic: {
        onGameStart: [], onTurnEnd: [], onTick: [],
        onChoice: [{ actions: [{ type: 'add', path: 'pulseCount', value: 1 }] }],
        onButton: [{ actions: [{ type: 'add', path: 'pulseCount', value: 1 }] }],
      },
    } as unknown as CustomGameplayModuleDefinition;
    await saveCustomGameplayModule(lifecycleModule);
    await bindCustomGameplayModule(lifecycleModule.id, 'world-a');
    const gameState = createDefaultGameState();
    const commits: string[] = [];

    const choice = await runCustomModulesForWorldAndCommit(gameState, 'world-a', 'onChoice', { now: 1 }, { commit: () => commits.push('choice') });
    const button = await runCustomModulesForWorldAndCommit(gameState, 'world-a', 'onButton', { now: 2 }, { commit: () => commits.push('button') });

    expect(choice.activeModuleIds).toEqual([]);
    expect(button.activeModuleIds).toEqual([]);
    expect(gameState.customModules?.[lifecycleModule.id]).toBeUndefined();
    expect(commits).toEqual([]);
  });

  test('runs an onButton event only for its target module', async () => {
    const makeButtonModule = (id: string) => ({
      ...moduleDefinition,
      id,
      schemaVersion: 2,
      inputs: {},
      logic: {
        onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [],
        onButton: [{ actions: [{ type: 'add', path: 'pulseCount', value: 1 }] }],
      },
    }) as unknown as CustomGameplayModuleDefinition;
    const target = makeButtonModule('button-target');
    const other = makeButtonModule('button-other');
    await saveCustomGameplayModule(target);
    await saveCustomGameplayModule(other);
    await bindCustomGameplayModule(target.id, 'world-a');
    await bindCustomGameplayModule(other.id, 'world-a');
    const gameState = createDefaultGameState();

    const result = await runCustomModulesForWorldAndCommit(gameState, 'world-a', 'onButton', {
      event: { type: 'button', moduleId: target.id, event: 'refresh' }, now: 3,
    }, { commit: () => undefined });

    expect(result.activeModuleIds).toEqual([target.id]);
    expect(gameState.customModules?.[target.id]?.values.pulseCount).toBe(1);
    expect(gameState.customModules?.[other.id]).toBeUndefined();
  });

  test('commits state before notifying React and scheduling auto-save', async () => {
    await saveCustomGameplayModule(moduleDefinition);
    await bindCustomGameplayModule(moduleDefinition.id, 'world-a');
    const gameState = createDefaultGameState();
    const events: string[] = [];

    const result = await runCustomModulesForWorldAndCommit(gameState, 'world-a', 'onTick', 100, {
      commit: (nextState) => events.push(`commit:${nextState.customModules?.[moduleDefinition.id]?.values.pulseCount}`),
      notify: () => events.push('notify'),
      autoSave: () => events.push('auto-save'),
    });

    expect(result.applied).toBe(1);
    expect(events).toEqual(['commit:1', 'notify', 'auto-save']);
  });

  test('resolves lifecycle modules from the currently selected world', async () => {
    await saveCustomGameplayModule(moduleDefinition);
    await saveCustomGameplayModule(secondWorldModule);
    await bindCustomGameplayModule(moduleDefinition.id, 'world-a');
    await bindCustomGameplayModule(secondWorldModule.id, 'world-b');

    const gameState = createDefaultGameState();
    const result = await runCustomModulesForWorldAndCommit(gameState, 'world-b', 'onTick', 200, {
      commit: () => undefined,
    });

    expect(result.activeModuleIds).toEqual([secondWorldModule.id]);
    expect(gameState.customModules?.[secondWorldModule.id]?.values.pulseCount).toBe(1);
    expect(gameState.customModules?.[moduleDefinition.id]).toBeUndefined();
  });

  test('blocks a module when a required dependency is not enabled and reports the reason', async () => {
    const dependency = { ...moduleDefinition, id: 'required-core', version: '2.0.0' };
    const dependent = {
      ...moduleDefinition,
      id: 'dependent-feature',
      dependencies: [{ id: dependency.id, version: '2.1.0' }],
    };
    await saveCustomGameplayModule(dependency);
    await saveCustomGameplayModule(dependent);
    await bindCustomGameplayModule(dependent.id, 'world-a');
    const gameState = createDefaultGameState();
    const result = await runCustomModulesForWorldAndCommit(gameState, 'world-a', 'onTick', 1, { commit: () => undefined });
    expect(result.activeModuleIds).toEqual([]);
    expect(result.warnings.join('\n')).toContain('required-core');
    expect(gameState.customModules?.[dependent.id]).toBeUndefined();
  });
});
