import 'fake-indexeddb/auto';
import { afterEach, expect, test } from 'bun:test';
import JSZip from 'jszip';
import { createDefaultGameState } from '../schema/variables';
import { deleteSave, exportSave, exportSaveCapture, getDB, getGlobal, importSaveFromData, loadGame, putGlobal, recoverPendingSaveImports, saveGameIncremental, type GameSave } from './db';
import { imageDb } from './imageDb';
import { decodeSaveFile, encodeSaveFile } from './saveFileCodec';

const saves: string[] = [], keys: string[] = [];
const unique = () => crypto.randomUUID();
function fixture(): GameSave {
  const id = `save_${Date.now()}_${unique().replaceAll('-', '')}`; saves.push(id);
  return { id, name: id, timestamp: 1, worldId: 'default', gameState: createDefaultGameState(), messages: [] };
}
async function asset(text = 'paid-image') {
  const key = `portrait-${unique()}`; keys.push(key);
  await imageDb.saveBlob(key, new Blob([text], { type: 'image/png' }), 'image/png');
  return key;
}
async function persist(save: GameSave) {
  const { messages, ...head } = save;
  await saveGameIncremental(save.id, { ...head, schemaVersion: 5, round: 0 }, messages);
}
afterEach(async () => {
  for (const id of saves.splice(0)) await deleteSave(id);
  for (const key of keys.splice(0)) await imageDb.deleteBlob(key);
});

test('the production export and import preserve image bytes used by current and rollback state', async () => {
  const save = fixture(), current = await asset('current'), historical = await asset('historical');
  save.messages = [{ id: unique(), role: 'assistant', rawText: '正文', timestamp: 1, round: 1, seq: 0,
    snapshot: { gameState: { imageBlobKey: historical } } } as any];
  (save.gameState as any).portraitBlobKey = current;
  await persist(save);
  const zip = await encodeSaveFile(await exportSave(save.id));
  const archive = await JSZip.loadAsync(await zip.arrayBuffer());
  expect(archive.file('assets/manifest.json')).not.toBeNull();
  expect((await archive.file('save.json')!.async('string')).includes('base64')).toBe(false);
  await imageDb.deleteBlob(current); await imageDb.deleteBlob(historical);
  const meta = await importSaveFromData(await decodeSaveFile(zip)); saves.push(meta.id);
  expect(await (await imageDb.getBlob(current))?.blob.text()).toBe('current');
  expect(await (await imageDb.getBlob(historical))?.blob.text()).toBe('historical');
  expect((await loadGame(meta.id))?.messages[0]?.rawText).toBe('正文');
});

test('missing referenced images cannot silently produce a supposedly complete backup', async () => {
  const save = fixture(); (save.gameState as any).imageBlobKey = `missing-${unique()}`;
  await persist(save);
  await expect(exportSave(save.id)).rejects.toThrow('缺少图片');
});

test('import image collisions preserve the local asset and create no partial save', async () => {
  const save = fixture(), key = await asset('local image');
  (save.gameState as any).imageBlobKey = key;
  const input = { type: 'omni-plane-travels-save', version: '2.0', save: { ...save, assets: [{
    key, mimeType: 'image/png', createdAt: 1, size: 6, base64: btoa('remote'),
  }] } };
  await expect(importSaveFromData(input)).rejects.toThrow('冲突');
  expect(await (await imageDb.getBlob(key))?.blob.text()).toBe('local image');
  expect(await loadGame(save.id)).toBeUndefined();
});

test('a database failure after installing images rolls back only the imported assets and metadata', async () => {
  const save = fixture(), key = `paid-${unique()}`; keys.push(key);
  const image = { key, mimeType: 'image/png', createdAt: 1, size: 6, base64: btoa('remote') };
  const originalPut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value: any, ...args: any[]) {
    if (this.name === 'module_states' && value.saveId === save.id) throw new Error('injected module write failure');
    return originalPut.apply(this, [value, ...args] as any);
  };
  try {
    await expect(importSaveFromData({ type: 'omni-plane-travels-save', version: '2.0', save: {
      ...save, assets: [image], moduleStates: [{ saveId: save.id, moduleId: 'stat', revision: 1, schemaVersion: 1, updatedAt: 1, state: {} }],
    } })).rejects.toThrow('injected');
  } finally { IDBObjectStore.prototype.put = originalPut; }
  expect(await imageDb.getBlob(key)).toBeNull();
  expect(await loadGame(save.id)).toBeUndefined();
  expect((await getGlobal<Array<{ id: string }>>('saves'))?.some(meta => meta.id === save.id) ?? false).toBe(false);
  expect((await (await getDB()).getAllKeys('global')).some(key => String(key).startsWith('save-image-import:'))).toBe(false);
});

test('restart compensates interrupted image installation but preserves a later player edit', async () => {
  const save = fixture(), owner = unique(), first = `interrupted-${unique()}`, edited = `edited-${unique()}`;
  keys.push(first, edited);
  const records = [first, edited].map(key => ({ key, blob: new Blob(['first'], { type: 'image/png' }), size: 5, mimeType: 'image/png', createdAt: 1 }));
  await putGlobal(`save-image-import:${owner}`, { owner, saveId: save.id, keys: [first, edited], phase: 'applying' });
  await imageDb.installTransferRecords(records, owner);
  await imageDb.saveBlob(edited, new Blob(['player edit'], { type: 'image/png' }));
  await recoverPendingSaveImports();
  expect(await imageDb.getBlob(first)).toBeNull();
  expect(await (await imageDb.getBlob(edited))?.blob.text()).toBe('player edit');
  expect(await getGlobal(`save-image-import:${owner}`)).toBeUndefined();
});

test('the import commit marker becomes durable with the save, so restart cannot delete its images', async () => {
  const save = fixture(), owner = unique(), key = `committed-${unique()}`; keys.push(key);
  await imageDb.installTransferRecords([{ key, blob: new Blob(['kept'], { type: 'image/png' }), size: 4, mimeType: 'image/png', createdAt: 1 }], owner);
  const journalKey = `save-image-import:${owner}`;
  await putGlobal(journalKey, { owner, saveId: save.id, keys: [key], phase: 'applying' });
  const { messages, ...head } = save;
  await saveGameIncremental(save.id, { ...head, schemaVersion: 5, round: 0 }, messages, [], [],
    { importCommit: { journalKey, meta: { id: save.id, name: save.name, timestamp: 1, preview: '', messageCount: 0 } } });
  expect((await getGlobal<{ phase: string }>(journalKey))?.phase).toBe('committed');
  await recoverPendingSaveImports();
  expect(await (await imageDb.getBlob(key))?.blob.text()).toBe('kept');
  expect((await loadGame(save.id))?.id).toBe(save.id);
});

test('an unsaved recovery export includes scoped paid assets and retains scope after id-changing imports', async () => {
  const save = fixture(), id = `result-${unique()}`, unrelated = `result-${unique()}`; keys.push(id, unrelated);
  const generation = { id, prompt: 'paid', negativePrompt: '', category: 'story' as const, characterName: '', params: { seed: 42 }, createdAt: 1, sessionId: save.id };
  await imageDb.saveBlob(id, new Blob(['paid'], { type: 'image/png' }), 'image/png', undefined, generation);
  await imageDb.saveBlob(unrelated, new Blob(['other'], { type: 'image/png' }), 'image/png', undefined, { ...generation, id: unrelated, sessionId: 'another-save' });
  const envelope = await (await exportSaveCapture(save)).text();
  expect(JSON.parse(envelope).save.assets.map((record: any) => record.key)).toEqual([id]);
  await persist(save);
  const imported = await importSaveFromData(JSON.parse(envelope)); saves.push(imported.id);
  expect(imported.id).not.toBe(save.id);
  expect((await loadGame(imported.id))?.assetSourceSessionIds).toContain(save.id);
  const reexport = JSON.parse(await (await exportSave(imported.id)).text());
  expect(reexport.save.assets[0].generation.params).toEqual({ seed: 42 });
});

test('ZIP assets reject missing or duplicated blobs before any import', async () => {
  const key = `missing-${unique()}`;
  const zip = new JSZip().file('save.json', JSON.stringify({ type: 'omni-plane-travels-save', version: '2.0', save: fixture() }))
    .file('assets/manifest.json', JSON.stringify({ version: 1, assets: [{ key, path: 'assets/blobs/0.bin', mimeType: 'image/png', size: 4, createdAt: 1 }] }));
  await expect(decodeSaveFile(new Blob([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))]))).rejects.toThrow('文件缺失');
  zip.file('assets/blobs/0.bin', 'kept');
  zip.file('assets/manifest.json', JSON.stringify({ version: 1, assets: [0, 1].map(() => ({ key, path: 'assets/blobs/0.bin', mimeType: 'image/png', size: 4, createdAt: 1 })) }));
  await expect(decodeSaveFile(new Blob([new Uint8Array(await zip.generateAsync({ type: 'uint8array' }))]))).rejects.toThrow('资源路径');
});

test('delivery rejects a target invalidated during the image write and keeps the previous portrait', async () => {
  const key = await asset('previous portrait');
  let checks = 0;
  await expect(imageDb.saveGenerated({ key, blob: new Blob(['late result'], { type: 'image/png' }),
    mimeType: 'image/png', size: 11, createdAt: 2 }, () => ++checks === 1)).rejects.toThrow('目标已改变');
  expect(await (await imageDb.getBlob(key))?.blob.text()).toBe('previous portrait');
});

test('a paid image retained after quota failure is included in a recoverable save export', async () => {
  const save = fixture(), key = `retained-${unique()}`; keys.push(key);
  const generation = { id: key, prompt: 'paid', negativePrompt: '', category: 'story' as const,
    characterName: '', params: { seed: 99 }, createdAt: 1, sessionId: save.id };
  imageDb.retainGenerated({ key, blob: new Blob(['paid'], { type: 'image/png' }), mimeType: 'image/png', size: 4, createdAt: 1, generation });
  const input = JSON.parse(await (await exportSaveCapture(save)).text());
  expect(input.save.assets[0].base64).toBe(btoa('paid'));
  expect(input.save.assets[0].generation.params.seed).toBe(99);
});

test('an import adds its metadata without replacing another save update after the list was cached', async () => {
  const save = fixture(), preservedId = `preserved-${unique()}`;
  const existing = await getGlobal<Array<{ id: string }>>('saves') ?? [];
  await putGlobal('saves', [...existing, { id: preservedId, name: 'another journey', timestamp: 1, preview: '', messageCount: 0 }]);
  try {
    await importSaveFromData({ type: 'omni-plane-travels-save', version: '2.0', save });
    const metas = await getGlobal<Array<{ id: string }>>('saves');
    expect(metas?.some(meta => meta.id === preservedId)).toBe(true);
    expect(metas?.some(meta => meta.id === save.id)).toBe(true);
  } finally {
    const latest = await getGlobal<Array<{ id: string }>>('saves') ?? [];
    await putGlobal('saves', latest.filter(meta => meta.id !== preservedId));
  }
});
