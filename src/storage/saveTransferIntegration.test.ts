import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { importSaveFromFile, loadGame, getDB, deleteSave } from './db';
import { encodeSaveFile } from './saveFileCodec';
import { createDefaultGameState } from '../schema/variables';
import { createEmptySimState } from '../simulation/types';
import { normalizeCustomGameplayModule } from '../custom-modules/normalize';
import { applySaveModuleApplication, previewSaveModuleApplication, restoreSaveModuleRecovery } from '../custom-modules/saveApplication';

test('ZIP file import, module application and recovery preserve compressed rollback history', async () => {
  const id = `save_${Date.now()}_zipboundary`;
  const gameState = createDefaultGameState();
  gameState.customModuleBindingsInitialized = true;
  const memoryRuntime = { sourceEvents: [{ assistantText: '历史记忆。'.repeat(2000) }], checkpoints: [{ id: 'memory:1', snapshot: { history: '完整记忆。'.repeat(2000) } }] };
  const simulationState = { ...createEmptySimState(), snapshots: [{
    id: 'sim:1', createdAt: 1, msgIndex: 0, tickCount: 0, gameTime: '',
    activeEventCount: 0, storylineCount: 0, pendingInteractionCount: 0, isInitial: true,
    snapshot: createEmptySimState(),
  }] };
  const messages = [{ id: 'turn:1', role: 'assistant', round: 1, timestamp: 1, rawText: '原始正文', snapshot: gameState, memoryCheckpointId: 'memory:1', simulationSnapshotId: 'sim:1' }];
  const payload = { type: 'omni-plane-travels-save', version: '2.0', save: { id, name: 'ZIP boundary', timestamp: 1, worldId: 'default', gameState, messages, memoryRuntime, simulationState } };
  const zip = await encodeSaveFile(new Blob([JSON.stringify(payload)]));
  const meta = await importSaveFromFile(new File([await zip.arrayBuffer()], 'boundary.save.zip'));
  try {
    const db = await getDB();
    const before = await db.get('saves', meta.id);
    expect(before.encodedHistory).toBeDefined();
    const normalized = normalizeCustomGameplayModule({
      kind: 'custom-gameplay-module', schemaVersion: 2, id: 'compressed-boundary', name: 'Boundary', version: '1.0.0', author: 'test', scope: 'world', inputs: {},
      state: { count: { type: 'number', default: 0, min: 0 } },
      logic: { onGameStart: [{ actions: [{ type: 'add', path: 'count', value: 1 }] }], onTick: [], onTurnEnd: [], onChoice: [], onButton: [] },
      permissions: { read: [], write: 'own-state-only' },
    });
    if (!normalized.ok) throw new Error(JSON.stringify(normalized.errors));
    const preview = await previewSaveModuleApplication(meta.id, normalized.data);
    expect(preview.conflicts).toEqual([]);
    const recovery = await applySaveModuleApplication(preview);
    expect((await db.get('saves', meta.id)).encodedHistory).toEqual(before.encodedHistory);
    expect((await loadGame(meta.id))!.gameState.customModules?.['compressed-boundary'].values.count).toBe(1);
    await restoreSaveModuleRecovery(recovery.id);
    const restored = (await loadGame(meta.id))!;
    expect(restored.gameState.customModules?.['compressed-boundary']).toBeUndefined();
    expect(restored.memoryRuntime).toEqual(memoryRuntime);
    expect(restored.simulationState).toEqual(simulationState);
    expect(restored.messages[0].rawText).toBe('原始正文');
    expect(restored.messages[0].snapshot).toEqual(gameState);
    expect(restored.messages[0].memoryCheckpointId).toBe('memory:1');
    expect(restored.messages[0].simulationSnapshotId).toBe('sim:1');
    expect((await db.get('saves', meta.id)).encodedHistory).toEqual(before.encodedHistory);
  } finally {
    await deleteSave(meta.id);
  }
});
