import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import JSZip from 'jszip';
import { cloneSnapshotWithSharing } from '../utils/snapshotSharing';
import { createEmptySimState } from '../simulation/types';
import { ModuleRuntimeRegistry } from '../gameplay/moduleRuntime/registry';
import type { ModuleStateRecord } from '../gameplay/moduleRuntime/types';
import type { NarrativeMemoryRuntime, VectorMemoryItem } from '../memory/types';
import { getDB, loadGame, saveGameIncremental, SAVE_SCHEMA_VERSION } from './db';
import { decodeStorageValue } from './storageCodec';

test('100 growing turns retain exact shared histories through captured save heads and module persistence', async () => {
  const id = `history-sharing-${Date.now()}`;
  const rounds = 100;
  const sourceEvents: Array<{ id: string; round: number; userText: string; assistantText: string; createdAt: number }> = [];
  const vectors: Array<VectorMemoryItem & { embedding: number[] }> = [];
  const assets: Array<{ id: string; quantity: number; description: string }> = [];
  const checkpoints: Array<{ id: string; createdAt: number; lastIngestCursor: number; activeThreadCount: number; eventCount: number; entityCount: number; snapshot: NarrativeMemoryRuntime; vectorMemory: typeof vectors }> = [];
  const modules: ModuleStateRecord[] = [];
  const simulationState = createEmptySimState();
  const emptyMemory: NarrativeMemoryRuntime = {
    version: 'compiled_context_v2', bankId: id, lastIngestCursor: 0, lastIngestAttemptAt: 0, lastIngestSuccessAt: 0,
    lastIngestFailure: null, lastRebuildAt: 0, entityCanonicalVersion: 2, sceneAnchor: null,
    activeThreads: [], stateSlots: [], relationEdges: [], relationNetwork: [], eventCards: [], entityCards: [],
    archiveCards: [], mutationLog: [], checkpoints: [], lastCompiledContext: null, lastRuntimeFlow: null,
    lastSummarySave: null, summarySaveHistory: [], lastRetrievePlan: null, writeDebugLogs: [],
    retrieveDebugLogs: [], compileDebugLogs: [], vectorMemory: [], sourceEvents: [], offscreenFacts: [],
  };
  const messages: any[] = [];
  let previousMemory: typeof checkpoints[number]['snapshot'] | undefined;
  let previousVectors: typeof vectors | undefined;
  let previousModule: { assets: typeof assets } | undefined;
  let previousSimulation: typeof simulationState | undefined;

  for (let round = 1; round <= rounds; round++) {
    sourceEvents.push({ id: `source-${round}`, round, userText: `行动 ${round}`, assistantText: `第 ${round} 轮发生的完整故事事实。`.repeat(40), createdAt: round });
    vectors.push({ id: `vector-${round}`, fact: `向量事实 ${round}`, keywords: [], entities: [], primaryType: 'event', secondaryTypes: [],
      characters: [], locations: [], factions: [], items: [], abilities: [], events: [], rules: [], timeMarkers: [], importance: 1,
      timeScope: 'long', state: 'active', embedding: Array.from({ length: 256 }, (_, dimension) => Number(Math.sin(round * 257 + dimension).toFixed(6))) });
    assets.push({ id: `asset-${round}`, quantity: round, description: `第 ${round} 项经营资产的完整属性。`.repeat(8) });
    const snapshot = cloneSnapshotWithSharing({ ...emptyMemory, lastIngestCursor: round, sourceEvents }, previousMemory);
    const vectorMemory = cloneSnapshotWithSharing(vectors, previousVectors);
    const moduleState = cloneSnapshotWithSharing({ assets }, previousModule);
    checkpoints.push({ id: `cp-${round}`, createdAt: round, lastIngestCursor: round, activeThreadCount: 0, eventCount: 0, entityCount: 0, snapshot, vectorMemory });
    modules.push({ saveId: id, moduleId: 'business', revision: round, schemaVersion: 1, updatedAt: round, state: moduleState });
    const simSnapshot = cloneSnapshotWithSharing({ ...simulationState, tickCount: round, snapshots: [] }, previousSimulation);
    simulationState.snapshots.push({ id: `sim-${round}`, createdAt: round, msgIndex: round - 1, tickCount: round, gameTime: `day ${round}`, activeEventCount: 0, storylineCount: 0, pendingInteractionCount: 0, snapshot: simSnapshot, isInitial: false });
    messages.push({ id: `message-${round}`, role: 'assistant', round, timestamp: round, seq: round - 1, rawText: `正文 ${round}`, snapshot: { moduleRevisions: { business: round }, round }, memoryCheckpointId: `cp-${round}`, simulationSnapshotId: `sim-${round}` });
    previousMemory = snapshot; previousVectors = vectorMemory; previousModule = moduleState; previousSimulation = simSnapshot;
  }

  const memoryRuntime = { ...emptyMemory, lastIngestCursor: rounds, sourceEvents: previousMemory!.sourceEvents, checkpoints };
  const captured = structuredClone({ memoryRuntime, simulationState, modules });
  expect(captured.memoryRuntime.checkpoints[0]!.snapshot.sourceEvents[0]).toBe(captured.memoryRuntime.checkpoints[99]!.snapshot.sourceEvents[0]);
  expect(captured.memoryRuntime.checkpoints[0]!.vectorMemory[0]!.embedding).toBe(captured.memoryRuntime.checkpoints[99]!.vectorMemory[0]!.embedding);
  expect((captured.modules[0]!.state as typeof previousModule)!.assets[0]).toBe((captured.modules[99]!.state as typeof previousModule)!.assets[0]);
  expect(captured.simulationState.snapshots[0]!.snapshot.events).toBe(captured.simulationState.snapshots[99]!.snapshot.events);

  await saveGameIncremental(id, { id, name: 'long history', timestamp: rounds, schemaVersion: SAVE_SCHEMA_VERSION, round: rounds, worldId: 'default', gameState: {} as any, memoryRuntime: captured.memoryRuntime, simulationState: captured.simulationState, vectorMemory: vectors }, messages, [captured.modules[99]!], captured.modules);
  const db = await getDB();
  const persisted = await db.get('saves', id);
  expect(persisted.encodedHistory).toMatchObject({ version: 2, type: 'zip-json-graph' });
  const expandedBytes = new TextEncoder().encode(JSON.stringify({ memoryRuntime: captured.memoryRuntime, simulationState: captured.simulationState })).byteLength;
  const uniquePayloadBytes = new TextEncoder().encode(JSON.stringify({ snapshot: checkpoints[99]!.snapshot, vectorMemory: checkpoints[99]!.vectorMemory, simulation: simulationState.snapshots[99]!.snapshot })).byteLength;
  const graphJson = await (await JSZip.loadAsync(persisted.encodedHistory.data)).file('value.json')!.async('string');
  const graphBytes = new TextEncoder().encode(graphJson).byteLength;
  const encodedBytes = persisted.encodedHistory.data.byteLength;
  expect(graphBytes).toBeLessThan(uniquePayloadBytes * 4);
  expect(graphBytes).toBeLessThan(expandedBytes / 10);
  expect(encodedBytes).toBeLessThan(uniquePayloadBytes);

  const decoded = await decodeStorageValue(persisted.encodedHistory) as Pick<typeof captured, 'memoryRuntime' | 'simulationState'>;
  const loaded = (await loadGame(id))!;
  const restored = loaded.memoryRuntime as typeof memoryRuntime;
  expect(restored.checkpoints).toHaveLength(rounds);
  expect(loaded.messages).toHaveLength(rounds);
  expect(loaded.moduleCheckpoints).toHaveLength(rounds);
  expect(restored.checkpoints[0]!.snapshot.sourceEvents[0]).toBe(restored.checkpoints[99]!.snapshot.sourceEvents[0]);
  expect(restored.checkpoints[0]!.vectorMemory[0]!.embedding).toBe(restored.checkpoints[99]!.vectorMemory[0]!.embedding);
  expect(decoded.memoryRuntime.checkpoints[0]!.snapshot.sourceEvents[0]).toBe(decoded.memoryRuntime.checkpoints[99]!.snapshot.sourceEvents[0]);
  expect(decoded.simulationState.snapshots[0]!.snapshot.events).toBe(decoded.simulationState.snapshots[99]!.snapshot.events);

  const registry = new ModuleRuntimeRegistry(id);
  for (const record of loaded.moduleCheckpoints!) registry.importHistoryRecord(record);
  const restoredModules = registry.listCheckpointRecords();
  expect((restoredModules[0]!.state as typeof previousModule)!.assets[0]).toBe((restoredModules[99]!.state as typeof previousModule)!.assets[0]);
  for (let round = 1; round <= rounds; round++) {
    const checkpoint = restored.checkpoints[round - 1]!;
    expect(checkpoint.snapshot.lastIngestCursor).toBe(round);
    expect(checkpoint.snapshot.sourceEvents).toEqual(sourceEvents.slice(0, round));
    expect(checkpoint.vectorMemory).toEqual(vectors.slice(0, round));
    expect(loaded.simulationState!.snapshots[round - 1]!.snapshot.tickCount).toBe(round);
    expect(loaded.messages[round - 1]!.memoryCheckpointId).toBe(checkpoint.id);
    expect(loaded.messages[round - 1]!.simulationSnapshotId).toBe(`sim-${round}`);
    registry.restore({ business: round });
    expect(registry.read<{ assets: typeof assets }>('business')!.assets).toEqual(assets.slice(0, round));
  }
  const editable = structuredClone(restored.checkpoints[0]!.snapshot);
  editable.sourceEvents[0]!.assistantText = 'edited after rollback';
  expect(restored.checkpoints[0]!.snapshot.sourceEvents[0]!.assistantText).toBe(sourceEvents[0]!.assistantText);
});
