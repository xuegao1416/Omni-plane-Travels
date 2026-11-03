import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { getDB, NOVEL_CHECKPOINTS_STORE } from '../storage/db';
import { listNovelPaidProducts, obtainNovelProduct } from './paidProducts';

test('quota failure retains the paid product and retries persistence without another generation', async () => {
  const key = { datasetId: `quota-${crypto.randomUUID()}`, kind: 'background' as const, inputHash: 'source' };
  await getDB(); const put = IDBObjectStore.prototype.put; let calls = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === NOVEL_CHECKPOINTS_STORE) throw new DOMException('quota', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try {
    await expect(obtainNovelProduct(key, async () => { calls++; return { summary: '已付费生成' }; })).rejects.toThrow('成果已生成并保留');
    expect((await listNovelPaidProducts(key.datasetId))[0].value).toEqual({ summary: '已付费生成' });
  } finally { IDBObjectStore.prototype.put = put; }
  expect(await obtainNovelProduct(key, async () => { calls++; return { summary: '不应再次生成' }; }, { refresh: true })).toEqual({ summary: '已付费生成' });
  expect(calls).toBe(1); expect((await listNovelPaidProducts(key.datasetId))).toHaveLength(1);
});

test('a complete late product is durable but cancellation does not authorize acceptance into material', async () => {
  const key = { datasetId: `cancel-${crypto.randomUUID()}`, kind: 'story' as const, inputHash: 'source' };
  const controller = new AbortController(); let release!: (value: { summary: string }) => void;
  const held = new Promise<{ summary: string }>(resolve => { release = resolve; });
  const generated = obtainNovelProduct(key, () => held, { signal: controller.signal });
  await Bun.sleep(1); controller.abort(); release({ summary: '已完整返回的成果' });
  expect(await generated).toEqual({ summary: '已完整返回的成果' });
  expect((await listNovelPaidProducts(key.datasetId))).toHaveLength(1);
  await expect(obtainNovelProduct(key, async () => ({ summary: '不应执行' }), { signal: controller.signal })).rejects.toThrow();
});

test('corrupt durable records cannot bypass generation identity or leak into exports', async () => {
  const key = { datasetId: crypto.randomUUID(), kind: 'story' as const, inputHash: 'source' };
  const db = await getDB();
  const id = `paid:${key.datasetId}:${key.kind}:${key.inputHash}`;
  await db.put(NOVEL_CHECKPOINTS_STORE, { ...key, id, productVersion: 99, createdAt: Date.now(), value: {} });
  let calls = 0;
  await expect(obtainNovelProduct(key, async () => { calls++; return {}; })).rejects.toThrow('成果记录');
  await expect(listNovelPaidProducts(key.datasetId)).rejects.toThrow('成果记录');
  expect(calls).toBe(0);
  await db.delete(NOVEL_CHECKPOINTS_STORE, id);
});
