import 'fake-indexeddb/auto';
import { afterEach, expect, test } from 'bun:test';
import { STORAGE_KEYS } from '../config/storageKeys';
import { deleteSave, exportSave, getDB, getGlobal, importSaveFromData, loadGame, putGlobal, recoverPendingSaveImports, saveGameIncremental } from './db';
import { deleteWebEvent, getWebEvent, putWebEvent } from '../modules/eventDb';
import { directorDefinitionKey, getDirectorDefinition } from '../director/definitionStore';
import type { DirectorDefinition } from '../director/definitionTypes';
import { applyImportedEvents, applyImportedWorld, prepareSaveDependencies } from './saveDependencyImport';
import { createDefaultGameState } from '../schema/variables';
import { VariableManager } from '../engine/variableManager';
import { createPipelineStatus } from '../engine/pipelineTypes';
import { recoveryVersion, readTurnRecovery } from '../engine/turnRecovery';
import { getTimeSystemFromWorld } from '../time/worldClock';

const uid = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const saves: string[] = [], events: string[] = [], definitions: DirectorDefinition[] = [];
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const values = new Map<string, string>();
let rejectWorldRollback = false;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (rejectWorldRollback && key === STORAGE_KEYS.CUSTOM_WORLDS && value === '[]') throw new Error('world storage unavailable');
    values.set(key, value);
  },
} });
afterEach(async () => {
  rejectWorldRollback = false;
  await recoverPendingSaveImports();
  for (const id of saves.splice(0)) await deleteSave(id);
  for (const id of events.splice(0)) await deleteWebEvent(id);
  for (const definition of definitions.splice(0)) await (await getDB()).delete('director_definitions', directorDefinitionKey(definition.id, definition.version));
  values.clear();
});
import { afterAll } from 'bun:test';
afterAll(() => { if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });
function fixture() {
  const id = `save_${uid()}`, worldId = `world_${uid()}`; saves.push(id);
  return { type: 'omni-plane-travels-save', version: '2.0', save: {
    id, name: id, worldId, customWorld: { id: worldId, name: 'Imported world' },
    gameState: {}, messages: [], eventPacks: [] as any[], directorDefinitions: [] as DirectorDefinition[],
  } };
}
function event(worldId?: string) {
  const id = `event_${uid()}`; events.push(id);
  return { id, manifest: { id, name: id, version: '1.0.0', author: 'test', engine: 'opt-event', schemaVersion: 1,
    minAppVersion: '1.0.0', type: 'bundle', coverColor: '#112233', icon: 'test', ...(worldId ? { worldId } : {}) }, files: {} as Record<string, string | Blob> };
}
function story(): DirectorDefinition {
  const result: DirectorDefinition = { schemaVersion: 1, id: `story_${uid()}`, version: '1', title: 'Story', source: { kind: 'author', text: 'Story' },
    coreConflict: 'Story', anchors: [], characters: [], stages: [{ id: 's', title: 'Story', description: 'Story', nodeIds: ['n'] }],
    nodes: [{ id: 'n', stageId: 's', title: 'Story', intent: 'Story', actorIds: [], execution: 'foreground', conditions: [], dependsOn: [], constraints: [], sourceRefs: ['author:0:5'] }],
    coverage: { complete: false, gaps: [], boundary: 'Story' }, createdAt: 1, editedByAuthor: false };
  definitions.push(result); return result;
}
function failSave(id: string) {
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function(value: any, ...args: any[]) {
    if (this.name === 'saves' && value.id === id) throw new Error('injected save failure');
    return original.apply(this, [value, ...args] as any);
  };
  return () => { IDBObjectStore.prototype.put = original; };
}

test('failed production import compensates world and events and never publishes a director version', async () => {
  const input = fixture(), pack = event(), definition = story();
  input.save.eventPacks.push(pack); input.save.directorDefinitions.push(definition);
  const restore = failSave(input.save.id);
  try { await expect(importSaveFromData(input)).rejects.toThrow('injected'); } finally { restore(); }
  expect(await loadGame(input.save.id)).toBeUndefined();
  expect(await getDirectorDefinition(definition.id, definition.version)).toBeUndefined();
  expect(await getWebEvent(pack.id)).toBeUndefined();
  expect(JSON.parse(values.get(STORAGE_KEYS.CUSTOM_WORLDS) ?? '[]')).toEqual([]);
});

test('event dependency validation finishes before any world or director write', async () => {
  const input = fixture(), pack = event(), definition = story();
  (pack.manifest as any).dependencies = [`missing_${uid()}`];
  input.save.eventPacks.push(pack); input.save.directorDefinitions.push(definition);
  await expect(importSaveFromData(input)).rejects.toThrow('依赖');
  expect(await getDirectorDefinition(definition.id, definition.version)).toBeUndefined();
  expect(await getWebEvent(pack.id)).toBeUndefined();
  expect(values.get(STORAGE_KEYS.CUSTOM_WORLDS)).toBeUndefined();
});

test('event identity collisions reject instead of silently binding a different local package', async () => {
  const input = fixture(), pack = event(); input.save.eventPacks.push(pack);
  await putWebEvent({ id: pack.id, manifest: pack.manifest as any, enabled: false, status: 'disabled', installedAt: 'old', files: { 'local.txt': 'player edit' } });
  await expect(importSaveFromData(input)).rejects.toThrow('冲突');
  expect((await getWebEvent(pack.id))?.files['local.txt']).toBe('player edit');
  expect(await loadGame(input.save.id)).toBeUndefined();
});

test('a conflicting embedded world gets an independent identity and event scope before commit', async () => {
  const input = fixture(), pack = event(input.save.worldId); input.save.eventPacks.push(pack);
  values.set(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify([{ id: input.save.worldId, name: 'Local author world' }]));
  const meta = await importSaveFromData(input); const imported = (await loadGame(meta.id))!;
  expect(imported.worldId).not.toBe(input.save.worldId);
  expect(imported.customWorld?.id).toBe(imported.worldId);
  expect((await getWebEvent(pack.id))?.manifest.worldId).toBe(imported.worldId);
  expect(JSON.parse(values.get(STORAGE_KEYS.CUSTOM_WORLDS)!)[0].name).toBe('Local author world');
});

test('production JSON event backups preserve binary resource bytes and MIME type', async () => {
  const input = fixture(), pack = event(); pack.files['image.png'] = new Blob([new Uint8Array([0, 128, 255])], { type: 'image/png' });
  input.save.eventPacks.push(pack);
  const first = await importSaveFromData(input);
  const exported = JSON.parse(await (await exportSave(first.id)).text());
  await deleteWebEvent(pack.id);
  const second = await importSaveFromData(exported); saves.push(second.id);
  const blob = (await getWebEvent(pack.id))?.files['image.png'] as Blob;
  expect(blob).toBeInstanceOf(Blob); expect(blob.type).toBe('image/png');
  expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 128, 255]);
});

async function interrupted(input = fixture()) {
  const owner = crypto.randomUUID(), plan = await prepareSaveDependencies(input.save as any, input.save.directorDefinitions, input.save.eventPacks, owner);
  const journalKey = `save-import:${owner}`;
  const journal = { owner, saveId: input.save.id, keys: [], phase: 'applying', world: plan.world,
    events: plan.events.filter(event => !event.existing).map(event => ({ id: event.value.id, owner })) };
  await putGlobal(journalKey, journal);
  applyImportedWorld(plan); await applyImportedEvents(plan.events, owner);
  return { input, plan, journalKey, journal };
}

test('restart compensates interrupted dependencies and retains later author world and event edits', async () => {
  const input = fixture(), first = event(), edited = event(); input.save.eventPacks.push(first, edited);
  const interruptedImport = await interrupted(input);
  const worlds = JSON.parse(values.get(STORAGE_KEYS.CUSTOM_WORLDS)!);
  worlds[0].name = 'Later author edit';
  values.set(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify(worlds));
  const current = (await getWebEvent(edited.id))!;
  await putWebEvent({ ...current, files: { ...current.files, 'note.txt': 'Later player edit' } });
  await recoverPendingSaveImports(); await recoverPendingSaveImports();
  expect(await getWebEvent(first.id)).toBeUndefined();
  expect((await getWebEvent(edited.id))?.files['note.txt']).toBe('Later player edit');
  expect(JSON.parse(values.get(STORAGE_KEYS.CUSTOM_WORLDS)!)[0].name).toBe('Later author edit');
  expect(await getGlobal(interruptedImport.journalKey)).toBeUndefined();
});

test('failed compensation reports recovery needed and keeps the journal until refresh recovery succeeds', async () => {
  const input = fixture(), pack = event(); input.save.eventPacks.push(pack);
  rejectWorldRollback = true;
  const restore = failSave(input.save.id);
  try { await expect(importSaveFromData(input)).rejects.toThrow('恢复未完成'); } finally { restore(); }
  const records = (await (await getDB()).getAll('global')).filter(record => record.key.startsWith('save-import:'));
  expect(records).toHaveLength(1);
  expect(await getWebEvent(pack.id)).toBeUndefined();
  rejectWorldRollback = false;
  await recoverPendingSaveImports();
  expect(JSON.parse(values.get(STORAGE_KEYS.CUSTOM_WORLDS)!)).toEqual([]);
  expect(await getGlobal(records[0].key)).toBeUndefined();
});

test('committed dependency journal cleanup never compensates a complete save on refresh', async () => {
  const input = fixture(), pack = event(), definition = story(); input.save.eventPacks.push(pack); input.save.directorDefinitions.push(definition);
  const { plan, journalKey } = await interrupted(input);
  const { messages, eventPacks: _packs, directorDefinitions: _definitions, ...head } = input.save;
  await saveGameIncremental(input.save.id, { ...head, schemaVersion: 5, round: 0 } as any, [], [], [], { importCommit: {
    journalKey, meta: { id: head.id, name: head.name, timestamp: 1, preview: '', messageCount: 0 }, directorDefinitions: plan.definitions,
  } });
  expect((await getGlobal<{ phase: string }>(journalKey))?.phase).toBe('committed');
  await recoverPendingSaveImports();
  expect(await loadGame(input.save.id)).toBeDefined();
  expect(await getWebEvent(pack.id)).toBeDefined();
  expect(await getDirectorDefinition(definition.id, definition.version)).toBeDefined();
  expect(JSON.parse(values.get(STORAGE_KEYS.CUSTOM_WORLDS)!)[0].id).toBe(input.save.worldId);
});

test('identical event content keeps local enable state, but an edit after preflight rejects installation', async () => {
  const input = fixture(), pack = event(); input.save.eventPacks.push(pack);
  await putWebEvent({ id: pack.id, manifest: pack.manifest as any, files: {}, enabled: false, status: 'disabled', installedAt: 'old' });
  const plan = await prepareSaveDependencies(input.save as any, [], input.save.eventPacks, 'same');
  await applyImportedEvents(plan.events, 'same');
  expect((await getWebEvent(pack.id))?.enabled).toBe(false);
  const current = (await getWebEvent(pack.id))!;
  await putWebEvent({ ...current, files: { 'note.txt': 'author edit' } });
  await expect(applyImportedEvents(plan.events, 'same')).rejects.toThrow('已改变');
  expect((await getWebEvent(pack.id))?.files['note.txt']).toBe('author edit');
});

test('complete export includes disabled transitive event dependencies and rejects missing closure', async () => {
  const input = fixture(), root = event(), dependency = event();
  (root.manifest as any).dependencies = [dependency.id]; input.save.eventPacks.push(root, dependency);
  const meta = await importSaveFromData(input);
  const stored = (await getWebEvent(dependency.id))!;
  await putWebEvent({ ...stored, enabled: false, status: 'disabled' });
  const exported = JSON.parse(await (await exportSave(meta.id)).text());
  expect(exported.save.eventPacks.map((pack: any) => pack.id)).toContain(dependency.id);
  expect(exported.save.eventPacks.find((pack: any) => pack.id === dependency.id).enabled).toBe(false);
  await deleteWebEvent(dependency.id);
  await expect(exportSave(meta.id)).rejects.toThrow('缺少依赖');
});

function recoverableFixture() {
  const input = fixture(), initial = createDefaultGameState();
  initial.customModules = {}; initial.customModuleBindingsInitialized = true; initial.customModuleBindingWarnings = [];
  initial.narrativeDecisions = [{ id: 'pending-choice', saveId: input.save.id, status: 'pending', action: { type: 'narrative', instruction: 'chosen result' } } as any];
  const manager = new VariableManager(initial, undefined, getTimeSystemFromWorld(input.save.customWorld as any));
  const state = manager.getState(), status = createPipelineStatus(1);
  status.stages.main.status = 'success'; status.stages.variable.status = 'error';
  Object.assign(input.save, { gameState: manager.createModulePersistenceBundle(input.save.id).coreState,
    moduleStates: manager.createModulePersistenceBundle(input.save.id).current, memoryRuntime: null, vectorMemory: [],
    messages: [{ id: 'assistant', role: 'assistant', rawText: 'paid response', timestamp: 1, seq: 0, round: 1, turnRecovery: {
      version: 1, worldId: input.save.worldId, saveId: input.save.id, aiMsgId: 'assistant', round: 1,
      userText: 'continue', rawText: 'paid response', stateVersion: recoveryVersion(state), memoryVersion: recoveryVersion({ memoryRuntime: null, vectorMemory: [] }),
      config: { executionOrder: [['main'], ['variable']], variableEnabled: true, variableDelayMs: 0, variableMaxRetries: 1, memoryEnabled: false },
      result: { status, mainResult: { text: 'paid response', parsed: { content: 'paid response' } } }, memory: {},
      settlement: { world: input.save.customWorld, protectedState: state, progressionBaseline: { tierIndex: 0, currentXP: 0 },
        narrativeDecisionRequest: { saveId: input.save.id, decisionIds: ['pending-choice'] }, done: false, internalContinuation: false },
    } }],
  });
  return input;
}
test('a validated latest paid turn checkpoint follows a copied save and world identity', async () => {
  const input = recoverableFixture();
  const first = await importSaveFromData(input);
  values.set(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify([{ id: input.save.worldId, name: 'A different local world' }]));
  const second = await importSaveFromData(input); saves.push(second.id);
  const saved = (await loadGame(second.id))!, checkpoint = readTurnRecovery(saved.messages[0].turnRecovery)!;
  expect(second.id).not.toBe(first.id);
  expect(checkpoint.saveId).toBe(second.id); expect(checkpoint.worldId).toBe(saved.worldId);
  expect(checkpoint.settlement.narrativeDecisionRequest.saveId).toBe(second.id);
  expect(checkpoint.settlement.world?.id).toBe(saved.worldId);
  expect(saved.gameState.narrativeDecisions?.[0].saveId).toBe(second.id);
  expect(checkpoint.settlement.protectedState?.narrativeDecisions?.[0].saveId).toBe(second.id);
  const rebuilt = VariableManager.fromJSON({ state: saved.gameState, saveId: saved.id, moduleStates: saved.moduleStates }, getTimeSystemFromWorld(saved.customWorld as any));
  expect(checkpoint.stateVersion).toBe(recoveryVersion(rebuilt.getState()));
});
test('stale imported paid turn checkpoints cannot be rebased onto changed state or text', async () => {
  const stale = recoverableFixture(); (stale.save.messages as any[])[0].rawText = 'edited response';
  const first = await importSaveFromData(stale);
  expect((await loadGame(first.id))?.messages[0].turnRecovery).toBeUndefined();
  const staleState = recoverableFixture();
  (staleState.save.gameState as any).玩家.姓名 = 'Changed player';
  const second = await importSaveFromData(staleState);
  expect((await loadGame(second.id))?.messages[0].turnRecovery).toBeUndefined();
});
