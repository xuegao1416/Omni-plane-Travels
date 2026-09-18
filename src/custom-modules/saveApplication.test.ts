import 'fake-indexeddb/auto';
import { afterEach, expect, test } from 'bun:test';
import { getDB, loadGame, SAVE_SCHEMA_VERSION } from '../storage/db';
import { createDefaultGameState } from '../schema/variables';
import { bindCustomGameplayModule, clearCustomGameplayModules, saveCustomGameplayModule, getCustomGameplayModulesForWorld } from './storage';
import { applySaveModuleApplication, listSaveModuleCandidates, listSaveModuleRecoveries, previewSaveModuleApplication, restoreSaveModuleRecovery, setCustomModuleActiveSave } from './saveApplication';
import { ensureSaveCustomModuleDefinitions } from './saveDefinitions';
import { createInitialCustomModuleState } from './stateStore';
import { normalizeCustomGameplayModule } from './normalize';
import { runCustomModulesForWorld } from './engineBridge';
import { extractModulePartitions, materializeModulePartitions } from '../gameplay/moduleRuntime/facade';
import { getModuleStates, putModuleStates } from '../storage/moduleStateDb';

const definition = (version = '1.0.0', increment = 1) => ({
  kind: 'custom-gameplay-module', schemaVersion: 2, id: 'save-pin', name: 'Pin', version, author: 'test', scope: 'world', inputs: {},
  state: { count: { type: 'number', default: 0, min: 0 } },
  logic: { onGameStart: [{ actions: [{ type: 'add', path: 'count', value: increment }] }], onTick: [{ actions: [{ type: 'add', path: 'count', value: increment }] }], onTurnEnd: [], onChoice: [], onButton: [] },
  permissions: { read: [], write: 'own-state-only' },
});
async function seed(id = 'pin-save') {
  const db = await getDB();
  await db.put('saves', { id, name: id, timestamp: 1, worldId: 'pin-world', schemaVersion: SAVE_SCHEMA_VERSION, round: 0, gameState: createDefaultGameState(), messageCount: 0, lastMessageSeq: -1 });
  return id;
}
afterEach(async () => {
  await clearCustomGameplayModules();
  const db = await getDB();
  await db.clear('saves');
  await db.clear('global');
  await db.clear('module_states');
  await db.clear('module_checkpoints');
});

test('application and recovery include partitioned survival resources atomically', async () => {
  const id = await seed('partitioned-save');
  const db = await getDB();
  const original = createDefaultGameState();
  original.玩家.生存资源 = { energy: { 数量: 20, 最大值: 100 } };
  const partitioned = extractModulePartitions(original, id);
  const head = await db.get('saves', id);
  await db.put('saves', { ...head, gameState: partitioned.coreState });
  await putModuleStates(partitioned.records);
  const normalized = (await saveCustomGameplayModule({
    ...definition(), schemaVersion: 3, capabilities: ['survival'], items: {},
    logic: { onGameStart: [{ id: 'energy-cost', actions: [{ type: 'survival.consume', resourceId: 'energy', amount: 5 }] }], onTick: [], onTurnEnd: [], onChoice: [], onButton: [] },
  })).module;
  const preview = await previewSaveModuleApplication(id, normalized);
  expect(preview.conflicts).toEqual([]);
  const recovery = await applySaveModuleApplication(preview);
  const changed = materializeModulePartitions((await db.get('saves', id)).gameState, await getModuleStates(id));
  expect(changed.玩家.生存资源!.energy.数量).toBe(15);
  expect((await db.get('saves', id)).gameState.玩家.生存资源).toBeUndefined();
  await restoreSaveModuleRecovery(recovery.id);
  const restored = materializeModulePartitions((await db.get('saves', id)).gameState, await getModuleStates(id));
  expect(restored.玩家.生存资源!.energy.数量).toBe(20);
});
test('world binding retains saved definition until explicitly rebound', async () => {
  await saveCustomGameplayModule(definition());
  await bindCustomGameplayModule('save-pin', 'pin-world');
  await saveCustomGameplayModule(definition('2.0.0', 10));
  expect((await getCustomGameplayModulesForWorld('pin-world'))[0].module.version).toBe('1.0.0');
});
test('loading pins definitions once and later bindings cannot change a save', async () => {
  await saveCustomGameplayModule(definition());
  await bindCustomGameplayModule('save-pin', 'pin-world');
  const id = await seed();
  const saved = (await loadGame(id))!;
  expect(saved.gameState.customModules?.['save-pin'].definition?.version).toBe('1.0.0');
  await saveCustomGameplayModule(definition('2.0.0', 10));
  await bindCustomGameplayModule('save-pin', 'pin-world');
  const loaded = (await loadGame(id))!;
  await runCustomModulesForWorld(loaded.gameState, 'pin-world', 'onTick', 10);
  expect(loaded.gameState.customModules?.['save-pin'].values.count).toBe(1);
  const emptyId = await seed('empty-save');
  await clearCustomGameplayModules();
  await loadGame(emptyId);
  await saveCustomGameplayModule(definition());
  await bindCustomGameplayModule('save-pin', 'pin-world');
  const empty = (await loadGame(emptyId))!;
  await runCustomModulesForWorld(empty.gameState, 'pin-world', 'onTick', 10);
  expect(empty.gameState.customModules?.['save-pin']).toBeUndefined();
});
test('manual application initializes only new module; updates preserve state and atomic recovery restores it', async () => {
  const id = await seed();
  const module = (await saveCustomGameplayModule(definition())).module;
  const first = await previewSaveModuleApplication(id, module);
  expect(first.conflicts).toEqual([]);
  await applySaveModuleApplication(first);
  expect((await loadGame(id))!.gameState.customModules?.['save-pin'].values.count).toBe(1);
  const next = (await saveCustomGameplayModule(definition('2.0.0', 10))).module;
  const preview = await previewSaveModuleApplication(id, next);
  const recovery = await applySaveModuleApplication(preview);
  expect((await loadGame(id))!.gameState.customModules?.['save-pin'].values.count).toBe(1);
  expect((await listSaveModuleRecoveries(id)).length).toBe(2);
  await restoreSaveModuleRecovery(recovery.id);
  expect((await loadGame(id))!.gameState.customModules?.['save-pin'].definition?.version).toBe('1.0.0');
});
test('stale preview, incompatible state, and genuinely running save reject without a recovery write', async () => {
  const id = await seed();
  const module = (await saveCustomGameplayModule(definition())).module;
  const initial = await previewSaveModuleApplication(id, module);
  const release = setCustomModuleActiveSave(id);
  expect((await listSaveModuleCandidates('pin-world'))[0].active).toBe(true);
  await expect(applySaveModuleApplication(initial)).rejects.toThrow('运行');
  release();
  expect((await listSaveModuleCandidates('pin-world'))[0].active).toBe(false);
  await applySaveModuleApplication(initial);
  await expect(applySaveModuleApplication(initial)).rejects.toThrow('已变化');
  const bad = { ...module, version: '3.0.0', state: { count: { type: 'number' as const, default: 0, max: 0 } } };
  const preview = await previewSaveModuleApplication(id, bad);
  expect(preview.conflicts.length).toBeGreaterThan(0);
  await expect(applySaveModuleApplication(preview)).rejects.toThrow();
  expect((await listSaveModuleRecoveries(id)).length).toBe(1);
});
test('pinning keeps an unresolvable saved definition and records a manual-application warning', async () => {
  const id = await seed('orphan-save');
  const db = await getDB();
  const head = await db.get('saves', id);
  const normalized = normalizeCustomGameplayModule(definition());
  if (!normalized.ok) throw new Error('Invalid orphan fixture');
  const orphan = createInitialCustomModuleState(normalized.data);
  orphan.definition = undefined;
  orphan.moduleVersion = '9.9.9';
  orphan.values.count = 4;
  await db.put('saves', { ...head, gameState: { ...head.gameState, customModules: { 'save-pin': orphan } } });
  await ensureSaveCustomModuleDefinitions(id);
  const saved = await db.get('saves', id);
  expect(saved.gameState.customModuleBindingsInitialized).toBe(true);
  expect(saved.gameState.customModuleBindingWarnings.join(' ')).toContain('定义缺失');
  expect(saved.gameState.customModules['save-pin'].moduleVersion).toBe('9.9.9');
  expect(saved.gameState.customModules['save-pin'].values.count).toBe(4);
});
