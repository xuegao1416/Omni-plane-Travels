import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { clearCustomGameplayModules, bindCustomGameplayModule, saveCustomGameplayModule } from './storage';
import type { CustomGameplayModule } from './schema';
import { runCustomModulesForWorldAndCommit } from './engineBridge';

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
});
