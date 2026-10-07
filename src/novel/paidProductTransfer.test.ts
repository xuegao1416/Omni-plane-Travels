import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { getDB, NOVEL_CHECKPOINTS_STORE } from '../storage/db';
import { obtainNovelProduct, listNovelPaidProducts, forgetNovelPaidProducts } from './paidProducts';
import { exportNovelPaidProductPackage, importNovelPaidProductPackage, exportNovelRecoveryPackage, parseNovelRecoveryPackage, restoreNovelRecoveryPackage } from './paidProductTransfer';
import { createNovelDatasetFromText } from './plainText';
import { getNovelDataset, saveNovelDataset, saveNovelJob, saveNovelChunks, listNovelChunks, novelRecoveryRevision } from './novelStore';
import { buildNovelChunks, novelEmbeddingInputHash } from './semanticIndex';

test('quota-retained completed products can be exported and imported without generation', async () => {
  const key = { datasetId: crypto.randomUUID(), kind: 'background' as const, inputHash: 'source' };
  await getDB(); const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    if (this.name === NOVEL_CHECKPOINTS_STORE) throw new DOMException('quota', 'QuotaExceededError');
    return original.apply(this, args);
  };
  let exported!: string;
  try {
    await expect(obtainNovelProduct(key, async () => ({ summary: 'paid' }))).rejects.toThrow('成果已生成并保留');
    exported = await exportNovelPaidProductPackage(key.datasetId);
  } finally { IDBObjectStore.prototype.put = original; }
  forgetNovelPaidProducts(key.datasetId);
  expect(await importNovelPaidProductPackage(exported, key.datasetId)).toEqual({ imported: 1, skipped: 0 });
  expect(await importNovelPaidProductPackage(exported, key.datasetId)).toEqual({ imported: 0, skipped: 1 });
  let requests = 0;
  expect(await obtainNovelProduct(key, async () => { requests++; return {}; })).toEqual({ summary: 'paid' });
  expect(requests).toBe(0);
});

test('invalid, foreign and conflicting packages cannot write any records', async () => {
  const key = { datasetId: crypto.randomUUID(), kind: 'story' as const, inputHash: 'source' };
  await obtainNovelProduct(key, async () => ({ summary: 'original' }));
  const original = await exportNovelPaidProductPackage(key.datasetId);
  await expect(importNovelPaidProductPackage(original, 'foreign')).rejects.toThrow();
  for (const mutate of [
    (pack: any) => { pack.version = 2; },
    (pack: any) => { pack.products[0].id = 'forged'; },
    (pack: any) => { pack.products[0].kind = 'unknown'; },
    (pack: any) => { pack.products[0].value = undefined; },
    (pack: any) => { pack.products.push({ ...pack.products[0], inputHash: 'other', id: `paid:${key.datasetId}:story:other` }); pack.products[0].value = { summary: 'conflict' }; },
  ]) {
    const pack = JSON.parse(original); mutate(pack);
    await expect(importNovelPaidProductPackage(JSON.stringify(pack), key.datasetId)).rejects.toThrow();
  }
  expect((await listNovelPaidProducts(key.datasetId)).map(item => item.value)).toEqual([{ summary: 'original' }]);
});

test('complete late product after cancellation remains exportable', async () => {
  const key = { datasetId: crypto.randomUUID(), kind: 'story' as const, inputHash: 'late' };
  let release!: (value: unknown) => void;
  const held = new Promise(resolve => { release = resolve; });
  const abort = new AbortController();
  const result = obtainNovelProduct(key, () => held, { signal: abort.signal });
  await Bun.sleep(1); abort.abort(); release({ summary: 'complete' });
  await result;
  expect(JSON.parse(await exportNovelPaidProductPackage(key.datasetId)).products[0].value).toEqual({ summary: 'complete' });
});

test('forgetting a deleted dataset clears retained products and discards its late completion', async () => {
  const key = { datasetId: crypto.randomUUID(), kind: 'story' as const, inputHash: 'late' };
  let release!: (value: unknown) => void;
  const result = obtainNovelProduct(key, () => new Promise(resolve => { release = resolve; }));
  await Bun.sleep(1); forgetNovelPaidProducts(key.datasetId); release({ summary: 'deleted' });
  await expect(result).rejects.toThrow('已删除');
  expect(await listNovelPaidProducts(key.datasetId)).toEqual([]);
});

test('quota during import rolls back durable writes and retains the full validated package', async () => {
  const datasetId = crypto.randomUUID();
  for (const inputHash of ['a', 'b']) await obtainNovelProduct({ datasetId, kind: 'story', inputHash }, async () => ({ summary: inputHash }));
  const exported = await exportNovelPaidProductPackage(datasetId);
  const db = await getDB();
  for (const product of await listNovelPaidProducts(datasetId)) await db.delete(NOVEL_CHECKPOINTS_STORE, product.id);
  const original = IDBObjectStore.prototype.put; let writes = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    if (this.name === NOVEL_CHECKPOINTS_STORE && ++writes === 2) throw new DOMException('quota', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try {
    await expect(importNovelPaidProductPackage(exported, datasetId)).rejects.toThrow('已保留');
    expect(await db.getAllFromIndex(NOVEL_CHECKPOINTS_STORE, 'datasetId', datasetId)).toEqual([]);
    expect(JSON.parse(await exportNovelPaidProductPackage(datasetId)).products).toHaveLength(2);
  } finally { IDBObjectStore.prototype.put = original; }
  expect(await importNovelPaidProductPackage(exported, datasetId)).toEqual({ imported: 0, skipped: 2 });
  expect(await db.getAllFromIndex(NOVEL_CHECKPOINTS_STORE, 'datasetId', datasetId)).toHaveLength(2);
});

test('single recovery file preserves source, accepted materials, arbitrary metadata and complete paid response fields', async () => {
  const dataset = createNovelDatasetFromText('恢复书', '第一章 旧城\n旧城以铜币交易。');
  dataset.staticMaterial.summary = '玩家已接纳的设定';
  dataset.segments[0].summary = '已完成剧情';
  dataset.importMetadata = { credentials: '小说中的通行凭证', nested: { password: '城门暗号', authorization: '故事中的通行许可', title: '保留' } };
  const response = { summary: '完整响应', scene: { password: '红月', credentials: ['城卫徽章'] } };
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    if (this.name === NOVEL_CHECKPOINTS_STORE) throw new DOMException('quota', 'QuotaExceededError');
    return original.apply(this, args);
  };
  let file!: string;
  try {
    await expect(obtainNovelProduct({ datasetId: dataset.id, kind: 'story', inputHash: 'paid' }, async () => response)).rejects.toThrow();
    file = await exportNovelRecoveryPackage(dataset);
  } finally { IDBObjectStore.prototype.put = original; }
  const recovered = parseNovelRecoveryPackage(file);
  expect(recovered.dataset.id).toBe(dataset.id);
  expect(recovered.dataset.chapters.map(chapter => [chapter.id, chapter.content])).toEqual(dataset.chapters.map(chapter => [chapter.id, chapter.content]));
  expect(recovered.dataset.staticMaterial.summary).toBe('玩家已接纳的设定');
  expect(recovered.dataset.segments[0].summary).toBe('已完成剧情');
  expect(recovered.dataset.importMetadata).toMatchObject(dataset.importMetadata);
  expect(JSON.parse(recovered.paidProducts).products[0].value).toEqual(response);
  forgetNovelPaidProducts(dataset.id);
  expect(await importNovelPaidProductPackage(recovered.paidProducts, dataset.id)).toEqual({ imported: 1, skipped: 0 });
});

test('recovery parsing validates both source and every product before returning or writing', async () => {
  const dataset = createNovelDatasetFromText('恢复书', '第一章\n原文。');
  await obtainNovelProduct({ datasetId: dataset.id, kind: 'story', inputHash: 'paid' }, async () => ({ summary: '完整响应' }));
  const original = await exportNovelRecoveryPackage(dataset);
  for (const mutate of [
    (pack: any) => { pack.version = 2; },
    (pack: any) => { pack.dataset.chapters[0].content = 12; },
    (pack: any) => { pack.dataset.id = 'foreign'; },
    (pack: any) => { pack.paidProducts.products[0].productVersion = 2; },
    (pack: any) => { pack.paidProducts.products.push(pack.paidProducts.products[0]); },
  ]) {
    const pack = JSON.parse(original); mutate(pack);
    expect(() => parseNovelRecoveryPackage(JSON.stringify(pack))).toThrow();
  }
  expect(() => parseNovelRecoveryPackage('{bad')).toThrow();
  expect((await listNovelPaidProducts(dataset.id))).toHaveLength(1);
});

test('full recovery is atomic and never implicitly overwrites local author work', async () => {
  const dataset = createNovelDatasetFromText('付费恢复', '第一章\n城里有古井。');
  const chunks = buildNovelChunks(dataset.id, dataset.chapters).map(chunk => ({ ...chunk, embedding: [0.3, 0.7], embeddingDimension: 2,
    embeddingModel: 'paid-vector', embeddingIdentity: 'endpoint:model', embeddingInputHash: novelEmbeddingInputHash(chunk) }));
  await saveNovelChunks(dataset.id, chunks);
  await obtainNovelProduct({ datasetId: dataset.id, kind: 'evidence', inputHash: 'paid' }, async () => ({ summary: '完整付费响应' }));
  await saveNovelJob({ id: crypto.randomUUID(), datasetId: dataset.id, status: 'running', phase: 'evidence', goal: 'background', runId: 'old-window', startSegmentIndex: 0, total: 2, completed: 1, failed: 0, retryCount: 0, createdAt: 1, updatedAt: 2 });
  const file = await exportNovelRecoveryPackage(dataset); const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
    if (this.name === NOVEL_CHECKPOINTS_STORE) throw new DOMException('quota', 'QuotaExceededError');
    return original.apply(this, args);
  };
  try {
    await expect(restoreNovelRecoveryPackage(file)).rejects.toThrow('恢复保存失败'); expect(await getNovelDataset(dataset.id)).toBeUndefined();
  } finally { IDBObjectStore.prototype.put = original; }
  await restoreNovelRecoveryPackage(file); const restored = (await getNovelDataset(dataset.id))!;
  expect(restored.rawText).toBe(dataset.rawText);
  expect(await listNovelChunks(dataset.id)).toEqual(chunks);
  const jobs = parseNovelRecoveryPackage(file).jobs;
  expect(jobs[0].status).toBe('paused'); expect(jobs[0].runId).toBeUndefined(); expect(jobs[0].goal).toBe('background');
  await saveNovelDataset({ ...restored, title: '本机新修改' });
  await expect(restoreNovelRecoveryPackage(file, novelRecoveryRevision(restored))).rejects.toThrow('未覆盖');
  await expect(restoreNovelRecoveryPackage(file)).rejects.toThrow('未覆盖'); expect((await getNovelDataset(dataset.id))!.title).toBe('本机新修改');
  const current = (await getNovelDataset(dataset.id))!;
  await restoreNovelRecoveryPackage(file, novelRecoveryRevision(current));
  expect((await getNovelDataset(dataset.id))!.title).toBe(dataset.title);
});
