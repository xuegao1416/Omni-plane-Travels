import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { encodeStorageValue, decodeStorageValue } from './storageCodec';
import { getDB, putMessages, getAllMessages, getRecentMessages, getMessageRange, saveGameIncremental, loadGame, loadSaveWithMigration, exportSave, SAVE_SCHEMA_VERSION } from './db';

test('storage codec preserves large JSON and rejects unknown or corrupt encodings', async () => {
  const value = { text: '历史快照'.repeat(4000), nested: [1, null, true] };
  const encoded = await encodeStorageValue(value);
  expect(encoded).toBeDefined();
  expect(encoded!.data.byteLength).toBeLessThan(JSON.stringify(value).length);
  expect(await decodeStorageValue(encoded!)).toEqual(value);
  expect(await encodeStorageValue({ small: true })).toBeUndefined();
  await expect(decodeStorageValue({ ...encoded!, version: 9 } as any)).rejects.toThrow();
  await expect(decodeStorageValue({ ...encoded!, data: new Uint8Array([1, 2]) })).rejects.toThrow();
});

test('mixed message shards and compressed head restore canonical saves and JSON exports', async () => {
  const id = `compressed-${Date.now()}`;
  const snapshot = { data: 'snapshot'.repeat(4000) };
  const large = { id: 'large', role: 'assistant', round: 1, timestamp: 1, seq: 1, snapshot } as any;
  const plain = { id: 'plain', role: 'user', round: 0, timestamp: 0, seq: 0 } as any;
  const memoryRuntime = { data: 'memory'.repeat(5000) };
  const simulationState = { data: 'simulation'.repeat(4000) } as any;
  await putMessages(id, [plain], 0);
  await saveGameIncremental(id, { id, name: 'codec', timestamp: 1, schemaVersion: SAVE_SCHEMA_VERSION, round: 1, worldId: 'default', gameState: {} as any, memoryRuntime, simulationState }, [large]);
  const db = await getDB();
  const shard = await db.get('messages', `${id}#1`);
  const head = await db.get('saves', id);
  expect(shard.message.snapshot).toBeUndefined();
  expect(shard.encodedSnapshot).toBeDefined();
  expect(head.memoryRuntime).toBeUndefined();
  expect(head.simulationState).toBeUndefined();
  expect(head.encodedHistory).toBeDefined();
  expect(await getAllMessages(id)).toEqual([plain, large]);
  expect(await getRecentMessages(id, 1)).toEqual([large]);
  expect(await getMessageRange(id, 0, 1)).toEqual([plain, large]);
  expect((await loadGame(id))?.memoryRuntime).toEqual(memoryRuntime);
  expect((await loadSaveWithMigration(id))?.simulationState).toEqual(simulationState);
  const exported = JSON.parse(await (await exportSave(id)).text());
  expect(exported.version).toBe('2.0');
  expect(exported.save.messages).toEqual([plain, large]);
  expect(exported.save.simulationState).toEqual(simulationState);
  expect(exported.save.encodedHistory).toBeUndefined();
  await saveGameIncremental(id, { ...head, memoryRuntime, simulationState }, [{ ...large, snapshot: undefined }]);
  expect((await db.get('messages', `${id}#1`)).encodedSnapshot).toBeUndefined();
  expect((await getAllMessages(id))[1].snapshot).toBeUndefined();
  await db.put('messages', { ...shard, encodedSnapshot: { ...shard.encodedSnapshot, version: 99 } });
  await expect(getAllMessages(id)).rejects.toThrow();
  await db.put('saves', { ...head, encodedHistory: { ...head.encodedHistory, data: new Uint8Array([0]) } });
  await expect(loadGame(id)).rejects.toThrow();
  expect((await db.get('saves', id)).encodedHistory.data).toEqual(new Uint8Array([0]));
});

test('direct previous compact v4 loads plain shards without rewriting history', async () => {
  const id = `previous-${Date.now()}`;
  const db = await getDB();
  const message = { id: 'old', role: 'user', round: 0, timestamp: 1, seq: 0, snapshot: { old: true } } as any;
  await db.put('messages', { key: `${id}#0`, saveId: id, seq: 0, message });
  await db.put('saves', { id, name: 'v4', timestamp: 1, schemaVersion: 4, round: 0, gameState: {}, worldId: 'default', messageCount: 1, lastMessageSeq: 0, memoryRuntime: { old: true } });
  expect((await loadGame(id))?.messages).toEqual([message]);
  expect((await db.get('saves', id)).schemaVersion).toBe(5);
  expect((await db.get('messages', `${id}#0`)).message).toEqual(message);
});

test('putMessages compresses snapshots and optimized rewrites remove stale encoded snapshots', async () => {
  const { optimizeSnapshots } = await import('./db');
  const id = `trim-${Date.now()}`;
  const messages = Array.from({ length: 25 }, (_, seq) => ({ id: `m${seq}`, seq, role: 'assistant', round: seq, timestamp: seq, snapshotTime: seq, snapshot: { text: 'rollback'.repeat(2000) } })) as any;
  await putMessages(id, messages, 0);
  const db = await getDB();
  expect((await db.get('messages', `${id}#1`)).encodedSnapshot).toBeDefined();
  const trimmed = optimizeSnapshots(await getAllMessages(id));
  await putMessages(id, trimmed, 0);
  expect((await db.get('messages', `${id}#1`)).encodedSnapshot).toBeUndefined();
  expect((await getMessageRange(id, 1, 1))[0].snapshot).toBeUndefined();
  expect((await getMessageRange(id, 10, 10))[0].snapshot).toEqual(messages[10].snapshot);
});

test('v4 migration rereads the current head atomically instead of overwriting a concurrent save', async () => {
  const id = `migration-race-${Date.now()}`;
  const db = await getDB();
  const oldHead = { id, name: 'old', timestamp: 1, schemaVersion: 4, round: 0, worldId: 'default', gameState: { customModuleBindingsInitialized: true }, messageCount: 0, lastMessageSeq: -1 };
  const currentHead = { ...oldHead, schemaVersion: 5, timestamp: 2, name: 'new', gameState: { ...oldHead.gameState, marker: 'new progress' } };
  await db.put('saves', oldHead);
  const originalGet = db.get.bind(db);
  let reads = 0;
  (db as any).get = async (store: string, key: string) => {
    const result = await originalGet(store, key);
    if (store === 'saves' && key === id && ++reads === 3) {
      await db.put('saves', currentHead);
      return result; // A readonly result became stale immediately before migration.
    }
    return result;
  };
  try {
    const loaded = await loadSaveWithMigration(id);
    expect(loaded?.name).toBe('new');
    expect((await originalGet('saves', id)).gameState.marker).toBe('new progress');
  } finally {
    (db as any).get = originalGet;
  }
});

test('encoded history cannot overwrite save identity or current gameState', async () => {
  const id = `history-envelope-${Date.now()}`;
  const db = await getDB();
  const encodedHistory = await encodeStorageValue({ memoryRuntime: { text: 'history'.repeat(3000) }, gameState: { overwrite: true }, id: 'wrong' });
  await db.put('saves', { id, name: 'history', timestamp: 1, schemaVersion: 5, round: 0, worldId: 'default', gameState: { customModuleBindingsInitialized: true }, messageCount: 0, lastMessageSeq: -1, encodedHistory });
  await expect(loadSaveWithMigration(id)).rejects.toThrow('存档历史压缩数据损坏');
  expect((await db.get('saves', id)).id).toBe(id);
});
