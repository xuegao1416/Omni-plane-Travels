import { getDB, NOVEL_CHECKPOINTS_STORE } from '../storage/db';

export interface NovelProductKey { datasetId: string; kind: 'background' | 'story' | 'evidence' | 'overview'; inputHash: string }
export interface NovelPaidProduct<T = unknown> extends NovelProductKey { id: string; productVersion: 1; createdAt: number; value: T }
const retained = new Map<string, NovelPaidProduct>();
const generations = new Map<string, number>();
const deletions = new Map<string, Promise<void>>();
const keyId = (key: NovelProductKey) => `paid:${key.datasetId}:${key.kind}:${key.inputHash}`;

function isJsonValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  seen.add(value);
  // Protocol parsers use optional undefined object fields; JSON omits these fields.
  const values = Array.isArray(value) ? value : Object.values(value).filter(item => item !== undefined);
  const valid = values.every(item => isJsonValue(item, seen));
  seen.delete(value);
  return valid;
}

export function validateNovelPaidProduct(value: unknown, datasetId: string): NovelPaidProduct {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('小说成果记录损坏');
  const item = value as NovelPaidProduct;
  if (item.productVersion !== 1 || item.datasetId !== datasetId || !datasetId.trim()
    || !['background', 'story', 'evidence', 'overview'].includes(item.kind)
    || typeof item.inputHash !== 'string' || !item.inputHash.trim()
    || item.id !== keyId(item) || !Number.isFinite(item.createdAt) || item.createdAt < 0
    || !Object.hasOwn(item, 'value') || !isJsonValue(item.value)) throw new Error('小说成果记录损坏或不属于当前资料');
  return JSON.parse(JSON.stringify(item)) as NovelPaidProduct;
}

/** Called by the dataset deletion owner before deleting durable records. */
export function forgetNovelPaidProducts(datasetId: string): void {
  generations.set(datasetId, (generations.get(datasetId) ?? 0) + 1);
  for (const [id, product] of retained) if (product.datasetId === datasetId) retained.delete(id);
}

/** Fence async completions until the deletion owner knows whether its transaction committed. */
export function beginNovelPaidProductDeletion(datasetId: string): (committed: boolean) => void {
  if (deletions.has(datasetId)) throw new Error('小说资料正在删除');
  let release!: () => void;
  deletions.set(datasetId, new Promise<void>(resolve => { release = resolve; }));
  let finished = false;
  return committed => {
    if (finished) return;
    finished = true;
    if (committed) forgetNovelPaidProducts(datasetId);
    deletions.delete(datasetId);
    release();
  };
}

export async function waitForNovelPaidProductDeletion(datasetId: string): Promise<void> {
  while (deletions.has(datasetId)) await deletions.get(datasetId);
}

export function novelPaidProductEpoch(datasetId: string): number { return generations.get(datasetId) ?? 0; }

export async function assertNovelPaidProductEpoch(datasetId: string, epoch: number): Promise<void> {
  await waitForNovelPaidProductDeletion(datasetId);
  if (epoch !== novelPaidProductEpoch(datasetId)) throw new Error('小说资料已删除，迟到成果已丢弃');
}

/** A failed atomic import retains its already validated complete products for export/retry. */
export function retainNovelPaidProducts(products: NovelPaidProduct[]): void {
  for (const product of products) retained.set(product.id, structuredClone(product));
}

export function releaseNovelPaidProducts(products: NovelPaidProduct[]): void {
  for (const product of products) {
    const current = retained.get(product.id);
    if (current?.createdAt === product.createdAt && JSON.stringify(current.value) === JSON.stringify(product.value)) retained.delete(product.id);
  }
}

/** Generated products have their own durability, before acceptance into editable material. */
export async function obtainNovelProduct<T>(key: NovelProductKey, generate: () => Promise<T>, options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const generation = novelPaidProductEpoch(key.datasetId);
  await assertNovelPaidProductEpoch(key.datasetId, generation);
  const id = keyId(key);
  const db = await getDB();
  const existing = retained.get(id) ?? (options.refresh ? undefined : await db.get(NOVEL_CHECKPOINTS_STORE, id)) as NovelPaidProduct<T> | undefined;
  await assertNovelPaidProductEpoch(key.datasetId, generation);
  if (existing) {
    validateNovelPaidProduct(existing, key.datasetId);
    // A prior quota/write failure retries durability, never the model request.
    if (retained.has(id)) { await db.put(NOVEL_CHECKPOINTS_STORE, existing); retained.delete(id); }
    return structuredClone(existing.value) as T;
  }
  const value = await generate();
  await assertNovelPaidProductEpoch(key.datasetId, generation);
  const product: NovelPaidProduct<T> = { ...key, id, productVersion: 1, createdAt: Date.now(), value: structuredClone(value) };
  validateNovelPaidProduct(product, key.datasetId);
  retained.set(id, product);
  try { await db.put(NOVEL_CHECKPOINTS_STORE, product); retained.delete(id); }
  catch (error) { throw new Error(`成果已生成并保留在当前窗口，保存失败；释放空间后继续可复用成果：${error instanceof Error ? error.message : String(error)}`); }
  return structuredClone(value);
}

export async function listNovelPaidProducts(datasetId: string): Promise<NovelPaidProduct[]> {
  const db = await getDB();
  const stored = await db.getAllFromIndex(NOVEL_CHECKPOINTS_STORE, 'datasetId', datasetId) as NovelPaidProduct[];
  const products = new Map(stored.filter(item => item.id?.startsWith('paid:') || 'productVersion' in item)
    .map(item => validateNovelPaidProduct(item, datasetId)).map(item => [item.id, item]));
  for (const item of retained.values()) if (item.datasetId === datasetId) products.set(item.id, item);
  return structuredClone([...products.values()]);
}

/** Paid request identity includes complete input, without credentials or live callbacks. */
export async function novelProductInputHash(input: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(input)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
