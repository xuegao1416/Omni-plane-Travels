import 'fake-indexeddb/auto';
import { afterEach, describe, expect, test } from 'bun:test';
import { clearCustomGameplayModules, getCustomGameplayModulesForWorld } from './custom-modules/storage';
import { installWorkshopItem } from './workshopRuntime';

const moduleDefinition = {
  kind: 'custom-gameplay-module',
  schemaVersion: 1,
  id: 'workshop-module',
  name: 'Workshop Module',
  version: '1.0.0',
  author: 'test',
  scope: 'world',
  state: { count: { type: 'number', default: 0 } },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [] },
  permissions: { read: [], write: 'own-state-only' },
} as const;

afterEach(async () => { await clearCustomGameplayModules(); });

describe('workshop gameplay module installation', () => {
  test('enables and binds a module only to the explicit target world, and rollback removes it', async () => {
    const operation = await installWorkshopItem(
      { id: 'workshop-item', type: 'gameplay_module', version: '1.0.0', title: 'Workshop Module' },
      moduleDefinition,
      { worldId: 'world-a' },
    );
    expect((await getCustomGameplayModulesForWorld('world-a')).map((item) => item.module.id)).toEqual(['workshop-module']);
    expect(await getCustomGameplayModulesForWorld('world-b')).toEqual([]);
    await operation.rollback();
    expect(await getCustomGameplayModulesForWorld('world-a')).toEqual([]);
  });
});
