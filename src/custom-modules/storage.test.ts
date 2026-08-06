import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import {
  bindCustomGameplayModule,
  clearCustomGameplayModules,
  deleteCustomGameplayModule,
  disableCustomGameplayModuleForWorld,
  getCustomGameplayModulesForWorld,
  listCustomGameplayModules,
  saveCustomGameplayModule,
} from './storage';
import { createInitialCustomModuleState, installCustomModuleState } from './stateStore';
import type { CustomGameplayModule } from './schema';

const moduleDefinition = {
  kind: 'custom-gameplay-module',
  schemaVersion: 1,
  id: 'mood-system',
  name: 'Mood System',
  version: '1.0.0',
  author: 'player',
  scope: 'world',
  state: {
    mood: { type: 'number', default: 50, min: 0, max: 100 },
    tags: {
      type: 'array',
      items: { type: 'string', default: '' },
      default: ['calm'],
      maxItems: 8,
      maxDepth: 2,
      maxSize: 512,
    },
  },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [] },
  permissions: { read: [], write: 'own-state-only' },
} satisfies CustomGameplayModule;

afterEach(async () => {
  await clearCustomGameplayModules();
});

describe('custom gameplay module storage', () => {
  test('creates, updates, lists and deletes module definitions', async () => {
    const saved = await saveCustomGameplayModule(moduleDefinition);
    expect(saved.module.id).toBe('mood-system');
    expect(saved.status).toBe('installed');

    const updated = await saveCustomGameplayModule({ ...moduleDefinition, name: 'Updated Mood' });
    expect(updated.module.name).toBe('Updated Mood');
    expect((await listCustomGameplayModules()).length).toBe(1);

    await deleteCustomGameplayModule('mood-system');
    expect(await listCustomGameplayModules()).toEqual([]);
  });

  test('binds a module to a world and disabled modules are not active', async () => {
    await saveCustomGameplayModule(moduleDefinition);
    await bindCustomGameplayModule('mood-system', 'world-a');
    expect((await getCustomGameplayModulesForWorld('world-a')).map((item) => item.module.id)).toEqual(['mood-system']);

    await disableCustomGameplayModuleForWorld('mood-system', 'world-a');
    expect(await getCustomGameplayModulesForWorld('world-a')).toEqual([]);
  });

  test('initializes only the customModules namespace and preserves core game state', () => {
    const gameState = createDefaultGameState();
    const before = JSON.stringify(gameState.玩家);

    const initial = createInitialCustomModuleState(moduleDefinition);
    expect(initial.values).toEqual({ mood: 50, tags: ['calm'] });
    installCustomModuleState(gameState, moduleDefinition);

    expect(JSON.stringify(gameState.玩家)).toBe(before);
    expect(gameState.customModules?.['mood-system']?.values).toEqual({ mood: 50, tags: ['calm'] });
  });
});
