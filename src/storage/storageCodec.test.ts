import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import JSZip from 'jszip';
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

test('shared historical branches are serialized once and restored without expanding their graph', async () => {
  const shared = { facts: Array.from({ length: 200 }, (_, index) => ({ id: index, text: '完整历史事实'.repeat(30) })) };
  const value = { checkpoints: Array.from({ length: 120 }, (_, round) => ({ round, snapshot: { shared, changed: { round } } })) };
  const encoded = await encodeStorageValue(value);
  expect(encoded).toMatchObject({ version: 2, type: 'zip-json-graph' });
  const graphJson = await (await JSZip.loadAsync(encoded!.data)).file('value.json')!.async('string');
  expect(graphJson.length).toBeLessThan(JSON.stringify(value).length / 20);
  const restored = await decodeStorageValue(encoded!) as typeof value;
  expect(restored).toEqual(value);
  expect(restored.checkpoints[0]!.snapshot.shared).toBe(restored.checkpoints[119]!.snapshot.shared);
  expect(restored.checkpoints[0]!.snapshot.changed).not.toBe(restored.checkpoints[1]!.snapshot.changed);
  expect(JSON.parse(JSON.stringify(restored))).toEqual(value);
});

test('graph encoding cannot confuse user keys or array values with reference markers', async () => {
  const shared = JSON.parse('{"__proto__":{"polluted":true},"constructor":"user","root":[0],"nodes":[["object",[]]],"type":"reference","index":0}');
  const value = { text: 'large'.repeat(2000), shared, second: shared, arrays: [[0], [1], ['array', []]] };
  const restored = await decodeStorageValue((await encodeStorageValue(value))!) as typeof value;
  expect(restored).toEqual(value);
  expect(restored.shared).toBe(restored.second);
  expect(Object.prototype.hasOwnProperty.call(restored.shared, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(restored.shared)).toBe(Object.prototype);
  expect(({} as any).polluted).toBeUndefined();
});

test('codec keeps small canonical values plain even when graph metadata would be larger', async () => {
  const small = Array.from({ length: 500 }, () => ({}));
  expect(JSON.stringify(small).length).toBeLessThan(4096);
  expect(await encodeStorageValue(small)).toBeUndefined();
  expect(await encodeStorageValue(undefined)).toBeUndefined();
});

test('graph encoding preserves canonical JSON values and rejects cyclic input', async () => {
  const value = { text: 'json'.repeat(2000), omitted: undefined, array: [undefined, Number.NaN, Number.POSITIVE_INFINITY, false], empty: {}, date: new Date('2026-10-08T00:00:00Z') };
  expect(await decodeStorageValue((await encodeStorageValue(value))!)).toEqual(JSON.parse(JSON.stringify(value)));
  const cyclic: any = { text: 'cyclic'.repeat(2000) }; cyclic.self = cyclic;
  await expect(encodeStorageValue(cyclic)).rejects.toThrow();
});

test('direct previous zip-json encoding remains readable', async () => {
  const value = { text: 'previous'.repeat(2000), nested: [{ old: true }] };
  const zip = new JSZip(); zip.file('value.json', JSON.stringify(value));
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  expect(await decodeStorageValue({ version: 1, type: 'zip-json', data })).toEqual(value);
  await expect(decodeStorageValue({ version: 1, type: 'zip-json-graph', data } as any)).rejects.toThrow();
});

test('previous zip-json shards and save heads load through the canonical persistence adapter', async () => {
  const id = `previous-encoding-${Date.now()}`;
  const snapshot = { text: 'old snapshot'.repeat(2000) };
  const history = { memoryRuntime: { checkpoints: [{ id: 'old-cp', snapshot: { text: 'memory'.repeat(2000) } }] }, simulationState: { snapshots: [] } };
  const encodePrevious = async (value: unknown) => {
    const zip = new JSZip(); zip.file('value.json', JSON.stringify(value));
    return { version: 1 as const, type: 'zip-json' as const, data: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) };
  };
  const message = { id: 'old', role: 'assistant', round: 1, timestamp: 1, seq: 0 } as any;
  const db = await getDB();
  await db.put('messages', { key: `${id}#0`, saveId: id, seq: 0, message, encodedSnapshot: await encodePrevious(snapshot) });
  await db.put('saves', { id, name: 'previous encoding', timestamp: 1, schemaVersion: SAVE_SCHEMA_VERSION, round: 1, worldId: 'default', gameState: {} as any, messageCount: 1, lastMessageSeq: 0, encodedHistory: await encodePrevious(history) });
  const loaded = await loadGame(id);
  expect(loaded?.messages).toEqual([{ ...message, snapshot }]);
  expect(loaded?.memoryRuntime).toEqual(history.memoryRuntime);
  expect(loaded?.simulationState as unknown).toEqual(history.simulationState);
  expect((await db.get('saves', id)).encodedHistory.version).toBe(1);
});

test('graph decoder rejects malformed references, cycles, duplicate keys and unexpected zip entries', async () => {
  const badGraphs = [
    { root: [1], nodes: [['object', []]] },
    { root: [-1], nodes: [['object', []]] },
    { root: [0.5], nodes: [['object', []]] },
    { root: [0, 1], nodes: [['object', []]] },
    { root: [0], nodes: [['object', [['self', [0]]]]] },
    { root: [0], nodes: [['object', [['x', [1]]]], ['array', [[0]]]] },
    { root: [0], nodes: [['object', [['x', 1], ['x', 2]]]] },
    { root: [0], nodes: [['unexpected', []]] },
    { root: [0], nodes: [['object', [['bad', { reference: 0 }]]]] },
    { root: null, nodes: [], overwritten: true },
  ];
  for (const graph of badGraphs) {
    const zip = new JSZip(); zip.file('value.json', JSON.stringify(graph));
    const data = await zip.generateAsync({ type: 'uint8array' });
    await expect(decodeStorageValue({ version: 2, type: 'zip-json-graph', data } as any)).rejects.toThrow();
  }
  const zip = new JSZip(); zip.file('value.json', '{"root":null,"nodes":[]}'); zip.file('extra.json', '{}');
  await expect(decodeStorageValue({ version: 2, type: 'zip-json-graph', data: await zip.generateAsync({ type: 'uint8array' }) } as any)).rejects.toThrow();
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

test('snapshot optimization preserves exact historical relationship state through storage', async () => {
  const { optimizeSnapshots } = await import('./db');
  const id = `trim-${Date.now()}`;
  const messages = Array.from({ length: 25 }, (_, seq) => ({ id: `m${seq}`, seq, role: 'assistant', round: seq, timestamp: seq, snapshotTime: seq, snapshot: { text: 'rollback'.repeat(2000) } })) as any;
  await putMessages(id, messages, 0);
  const db = await getDB();
  expect((await db.get('messages', `${id}#1`)).encodedSnapshot).toBeDefined();
  const trimmed = optimizeSnapshots(await getAllMessages(id));
  await putMessages(id, trimmed, 0);
  expect(trimmed).toEqual(messages);
  expect((await db.get('messages', `${id}#1`)).encodedSnapshot).toBeDefined();
  expect((await getMessageRange(id, 1, 1))[0].snapshot).toEqual(messages[1].snapshot);
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
