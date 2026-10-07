import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { deleteSave, getDB, loadGame, planMessageSave, type GameSave } from '../storage/db';
import type { ChatMessage } from '../engine/types';

if (typeof localStorage === 'undefined') {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
}
const { useSaveStore } = await import('./saveStore');
const persist = (save: GameSave) => useSaveStore.getState().performSave(save);
function fixture(label: string): GameSave {
  const id = `save_${Date.now()}_${label}`;
  const messages: ChatMessage[] = Array.from({ length: 14 }, (_, seq) => ({
    id: `${id}:${seq}`, seq, round: Math.floor(seq / 2), role: seq % 2 ? 'assistant' : 'user',
    timestamp: seq + 1, rawText: `正文${seq}`,
  }));
  return { id, name: label, timestamp: 1, worldId: 'default', gameState: createDefaultGameState(), messages };
}

test('resending a saved turn at the same sequence replaces the durable timeout body', async () => {
  const save = fixture('resendsame');
  save.messages.at(-1)!.rawText = '[错误: Request timeout exceeded]';
  await persist(save);
  try {
    const latest = save.messages.at(-1)!;
    save.messages[save.messages.length - 1] = { ...latest, id: `${latest.id}:retry`, rawText: '重发成功的正文', snapshot: createDefaultGameState() };
    await persist(save);
    const restored = await loadGame(save.id);
    expect(restored?.messages.at(-1)?.id).toBe(`${latest.id}:retry`);
    expect(restored?.messages.at(-1)?.rawText).toBe('重发成功的正文');
    expect(restored?.messages.at(-1)?.snapshot).toEqual(createDefaultGameState());
    expect(restored?.messages).toHaveLength(14);
  } finally { await deleteSave(save.id); }
});

test('editing an older message and accepting a later snapshot both survive save and reload', async () => {
  const save = fixture('editandsnapshot');
  await persist(save);
  try {
    save.messages[1] = { ...save.messages[1]!, rawText: '玩家修订的历史正文' };
    const snapshot = createDefaultGameState();
    snapshot.玩家.姓名 = '结算已完成';
    save.messages[13] = { ...save.messages[13]!, snapshot, memoryCheckpointId: 'checkpoint-new', simulationSnapshotId: 'director-new' };
    await persist(save);
    const restored = await loadGame(save.id);
    expect(restored?.messages[1]?.rawText).toBe('玩家修订的历史正文');
    expect(restored?.messages[13]?.snapshot).toEqual(snapshot);
    expect(restored?.messages[13]?.memoryCheckpointId).toBe('checkpoint-new');
    expect(restored?.messages[13]?.simulationSnapshotId).toBe('director-new');
  } finally { await deleteSave(save.id); }
});

test('an invalid revised capture leaves the previous durable body intact and can be retried', async () => {
  const save = fixture('revisefailure');
  await persist(save);
  try {
    save.messages[1] = { ...save.messages[1]!, rawText: '修改后的正文' };
    const invalid: GameSave = { ...save, moduleStates: [{ saveId: save.id, moduleId: 'stat', revision: 1, schemaVersion: 1, updatedAt: 2, state: { invalid: () => {} } }] };
    await expect(persist(invalid)).rejects.toThrow();
    expect((await loadGame(save.id))?.messages[1]?.rawText).toBe('正文1');
    await persist(save);
    expect((await loadGame(save.id))?.messages[1]?.rawText).toBe('修改后的正文');
  } finally { await deleteSave(save.id); }
});

test('unchanged compressed checkpoints are skipped while same-slot snapshot revisions and removed slots are detected', async () => {
  const save = fixture('selectchanges');
  const snapshot = createDefaultGameState();
  snapshot.玩家.姓名 = 'A'.repeat(6000);
  save.messages[13] = { ...save.messages[13]!, snapshot };
  await persist(save);
  try {
    expect((await planMessageSave(save.id, save.messages)).changedMessages).toHaveLength(0);
    save.messages[13] = { ...save.messages[13]!, snapshot: { ...snapshot, 测试值: 'accepted' } };
    expect((await planMessageSave(save.id, save.messages)).changedMessages.map(message => message.seq)).toEqual([13]);
    await persist(save);
    const loaded = await loadGame(save.id);
    expect(loaded?.messages[13]?.snapshot).toEqual(save.messages[13]?.snapshot);
    expect((await planMessageSave(save.id, loaded!.messages)).changedMessages).toHaveLength(0);
    save.messages = save.messages.slice(0, 12);
    expect((await planMessageSave(save.id, save.messages)).replaceMessages).toBe(true);
    await persist(save);
    expect((await loadGame(save.id))?.messages).toHaveLength(12);

    const db = await getDB();
    const record = await db.get('messages', `${save.id}#1`);
    delete record.contentFingerprint;
    await db.put('messages', record);
    expect((await planMessageSave(save.id, save.messages)).changedMessages.map(message => message.seq)).toEqual([1]);
    await persist(save);
    expect((await planMessageSave(save.id, save.messages)).changedMessages).toHaveLength(0);
  } finally { await deleteSave(save.id); }
});

test('batched durable comparisons cover the full history and preserve revisions across batch boundaries', async () => {
  const save = fixture('batchcomparison');
  save.messages = Array.from({ length: 97 }, (_, seq) => ({ ...save.messages[seq % 14]!, id: `${save.id}:${seq}`, seq }));
  await persist(save);
  try {
    expect((await planMessageSave(save.id, save.messages)).changedMessages).toEqual([]);
    save.messages[32] = { ...save.messages[32]!, rawText: '第一批之后的编辑' };
    save.messages[96] = { ...save.messages[96]!, rawText: '最后一批的编辑' };
    expect((await planMessageSave(save.id, save.messages)).changedMessages.map(message => message.seq)).toEqual([32, 96]);
    await persist(save);
    expect((await loadGame(save.id))?.messages[96]?.rawText).toBe('最后一批的编辑');
    save.messages = save.messages.slice(0, 32);
    expect((await planMessageSave(save.id, save.messages)).replaceMessages).toBe(true);
  } finally { await deleteSave(save.id); }
});
