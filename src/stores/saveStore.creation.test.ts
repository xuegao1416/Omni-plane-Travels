import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import {
  ACTIVE_SAVE_KEY, SAVE_SCHEMA_VERSION, deleteSave, getDB, loadGame, saveGameIncremental,
  type CompactSaveRecord, type GameSave, type SaveMeta,
} from '../storage/db';
import { createEmptySimState } from '../simulation/types';
import type { ModuleStateRecord } from '../gameplay/moduleRuntime/types';

if (typeof localStorage === 'undefined') {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
}
const { useSaveStore } = await import('./saveStore');
const createdIds: string[] = [];
let originalState = useSaveStore.getState();
let originalMarker: string | null;
const OLD_ID = 'save_1_creationoldowner';

beforeEach(() => {
  originalState = useSaveStore.getState();
  originalMarker = localStorage.getItem(ACTIVE_SAVE_KEY);
  localStorage.setItem(ACTIVE_SAVE_KEY, OLD_ID);
  useSaveStore.setState({ currentSaveId: OLD_ID, currentSaveName: '原旅程', currentAssetSourceSessionIds: ['old-assets'] });
});

afterEach(async () => {
  for (const id of createdIds.splice(0)) await deleteSave(id);
  useSaveStore.setState(originalState);
  if (originalMarker === null) localStorage.removeItem(ACTIVE_SAVE_KEY);
  else localStorage.setItem(ACTIVE_SAVE_KEY, originalMarker);
});

function fixture(label: string): GameSave {
  const id = `save_${Date.now()}_${label}${Math.random().toString(36).slice(2)}`;
  createdIds.push(id);
  const module: ModuleStateRecord = { saveId: id, moduleId: 'progression', revision: 2, schemaVersion: 1, updatedAt: 1, state: { currentXP: 27 } };
  const gameState = createDefaultGameState();
  gameState.moduleRevisions = { progression: 2 };
  return {
    id, name: id, timestamp: 1, worldId: 'default', gameState,
    messages: [{ id: `${id}:opening`, role: 'assistant', rawText: '原始开局正文', seq: 0, round: 0, timestamp: 1, snapshot: gameState }],
    moduleStates: [module], moduleCheckpoints: [structuredClone(module)], simulationState: createEmptySimState(),
    memoryConfig: { enabled: false }, characterHistory: '原始开局正文', lifecycle: 'active',
  };
}

function head(save: GameSave): Omit<CompactSaveRecord, 'messageCount' | 'lastMessageSeq'> {
  const { messages: _messages, moduleStates: _states, moduleCheckpoints: _checkpoints, ...capture } = save;
  return { ...capture, schemaVersion: SAVE_SCHEMA_VERSION, round: 0 };
}

function meta(save: GameSave): SaveMeta {
  return { id: save.id, name: save.name, timestamp: save.timestamp, preview: '原始开局正文', messageCount: save.messages.length, lifecycle: 'active' };
}

async function durableMetas(): Promise<SaveMeta[]> {
  return (await (await getDB()).get('global', 'saves'))?.value ?? [];
}

function expectOldOwner() {
  expect(localStorage.getItem(ACTIVE_SAVE_KEY)).toBe(OLD_ID);
  expect(useSaveStore.getState().currentSaveId).toBe(OLD_ID);
  expect(useSaveStore.getState().currentSaveName).toBe('原旅程');
  expect(useSaveStore.getState().currentAssetSourceSessionIds).toEqual(['old-assets']);
}

test('createSave commits the head, messages, modules, checkpoints and metadata while preserving the active owner', async () => {
  const save = fixture('createcomplete');
  await useSaveStore.getState().createSave(save);
  const db = await getDB();
  expect(await db.get('saves', save.id)).toMatchObject({ id: save.id, name: save.name, schemaVersion: 5, messageCount: 1, lastMessageSeq: 0 });
  expect((await durableMetas()).find(item => item.id === save.id)).toMatchObject({ name: save.name, messageCount: 1 });
  expect(useSaveStore.getState().savesMeta.find(item => item.id === save.id)).toMatchObject({ name: save.name, messageCount: 1 });
  const loaded = await loadGame(save.id);
  expect(loaded?.messages[0].rawText).toBe('原始开局正文');
  expect(loaded?.moduleStates).toEqual(save.moduleStates);
  expect(loaded?.moduleCheckpoints).toEqual(save.moduleCheckpoints);
  expect(loaded?.simulationState).toEqual(save.simulationState);
  expectOldOwner();
});

test('a late checkpoint serialization failure rolls back the created head, message, module state and metadata together', async () => {
  const save = fixture('createrollback');
  const beforeMetas = await durableMetas();
  const invalid: ModuleStateRecord = { ...save.moduleCheckpoints![0], state: { uncloneable: () => {} } };
  await expect(saveGameIncremental(save.id, head(save), save.messages, save.moduleStates, [invalid], { createCommit: meta(save) })).rejects.toThrow();
  const db = await getDB();
  expect(await db.get('saves', save.id)).toBeUndefined();
  expect(await db.getAllFromIndex('messages', 'saveId', save.id)).toEqual([]);
  expect(await db.getAllFromIndex('module_states', 'saveId', save.id)).toEqual([]);
  expect(await db.getAllFromIndex('module_checkpoints', 'saveId', save.id)).toEqual([]);
  expect(await durableMetas()).toEqual(beforeMetas);
  expectOldOwner();
  await useSaveStore.getState().createSave(save);
  expect((await loadGame(save.id))?.moduleCheckpoints).toEqual(save.moduleCheckpoints);
});

test('duplicate creation id rejects before replacing existing head, message and module data or metadata', async () => {
  const save = fixture('createduplicateid');
  await useSaveStore.getState().createSave(save);
  const beforeMetas = await durableMetas();
  const beforeStoreMeta = useSaveStore.getState().savesMeta;
  const duplicate = structuredClone(save);
  duplicate.name = '恶意替换的名称';
  duplicate.messages[0].rawText = '不应落盘的正文';
  duplicate.moduleStates![0].revision = 3;
  duplicate.moduleStates![0].state = { currentXP: 99 };
  await expect(useSaveStore.getState().createSave(duplicate)).rejects.toThrow('存档身份已存在');
  const loaded = await loadGame(save.id);
  expect(loaded?.name).toBe(save.name);
  expect(loaded?.messages[0].rawText).toBe('原始开局正文');
  expect(loaded?.moduleStates).toEqual(save.moduleStates);
  expect(await durableMetas()).toEqual(beforeMetas);
  expect(useSaveStore.getState().savesMeta).toBe(beforeStoreMeta);
  expectOldOwner();
});

test('a duplicate name rejects the entire new save and leaves the original metadata and owner intact', async () => {
  const first = fixture('createnamefirst');
  const second = fixture('createnameother');
  second.name = first.name;
  await useSaveStore.getState().createSave(first);
  const beforeMetas = await durableMetas();
  const beforeStoreMeta = useSaveStore.getState().savesMeta;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const createElement = mock(() => ({ href: '', download: '', click: mock(() => {}) }));
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement } });
  try {
    await expect(useSaveStore.getState().createSave(second)).rejects.toThrow('存档名称已存在');
    expect(createElement).not.toHaveBeenCalled();
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
  const db = await getDB();
  expect(await db.get('saves', second.id)).toBeUndefined();
  expect(await db.getAllFromIndex('messages', 'saveId', second.id)).toEqual([]);
  expect(await db.getAllFromIndex('module_states', 'saveId', second.id)).toEqual([]);
  expect(await durableMetas()).toEqual(beforeMetas);
  expect(useSaveStore.getState().savesMeta).toBe(beforeStoreMeta);
  expect((await loadGame(first.id))?.name).toBe(first.name);
  expectOldOwner();
});

test('racing creations with the same name commit exactly one complete journey', async () => {
  const first = fixture('createracefirst');
  const second = fixture('createracesecond');
  second.name = first.name;
  const outcomes = await Promise.allSettled([useSaveStore.getState().createSave(first), useSaveStore.getState().createSave(second)]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
  const loaded = await Promise.all([loadGame(first.id), loadGame(second.id)]);
  expect(loaded.filter(Boolean)).toHaveLength(1);
  const winner = loaded.find(Boolean)!;
  expect(winner.messages).toHaveLength(1);
  expect(winner.moduleStates).toHaveLength(1);
  expect(winner.moduleCheckpoints).toHaveLength(1);
  expect((await durableMetas()).filter(item => item.name === first.name)).toHaveLength(1);
  expect(useSaveStore.getState().savesMeta.filter(item => item.name === first.name)).toHaveLength(1);
  expectOldOwner();
});

test('a durable head absent from stale metadata still reserves its name against creation', async () => {
  const original = fixture('createorphanhead');
  const candidate = fixture('createorphannew');
  candidate.name = original.name;
  const beforeMetas = await durableMetas();
  await saveGameIncremental(original.id, head(original), original.messages, original.moduleStates, original.moduleCheckpoints);
  expect((await durableMetas()).some(item => item.id === original.id)).toBe(false);
  await expect(useSaveStore.getState().createSave(candidate)).rejects.toThrow('存档名称已存在');
  const db = await getDB();
  expect(await db.get('saves', candidate.id)).toBeUndefined();
  expect(await db.getAllFromIndex('messages', 'saveId', candidate.id)).toEqual([]);
  expect(await durableMetas()).toEqual(beforeMetas);
  expect((await loadGame(original.id))?.messages[0].rawText).toBe(original.messages[0].rawText);
  expectOldOwner();
});
