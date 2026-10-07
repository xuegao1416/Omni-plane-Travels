// IndexedDB 图片 Blob 存储

import { openDB, type IDBPDatabase } from 'idb';
import { ImageUrlPool } from './imageUrls';

const DB_NAME = 'WorldTravelGuideImageDB';
const DB_VERSION = 1;
const STORE_NAME = 'imageBlobs';

export interface ImageGenerationMetadata {
  id: string;
  prompt: string;
  negativePrompt: string;
  category: 'story' | 'character' | 'player';
  characterName: string;
  params: Record<string, unknown>;
  createdAt: number;
  deliveryKey?: string;
  sourcePrompt?: string;
  sessionId?: string;
  worldId?: string;
  messageId?: string;
  npcId?: string;
}

export interface ImageBlobRecord {
  key: string;
  blob: Blob;
  mimeType: string;
  size: number;
  createdAt: number;
  /** 关联的 NPC 名字（头像专用，用于按名字查找） */
  npcName?: string;
  generation?: ImageGenerationMetadata;
}

type StoredImage = ImageBlobRecord & { writeId?: string; _saveImportOwner?: string };
function publicRecord(record: StoredImage): ImageBlobRecord {
  const { writeId: _, _saveImportOwner: _owner, ...value } = record;
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function metadata(record: StoredImage): string { const { blob: _, ...value } = record; return canonical(value); }
async function identical(left: StoredImage, right: ImageBlobRecord): Promise<boolean> {
  if (metadata(publicRecord(left)) !== metadata(right)) return false;
  const [a, b] = await Promise.all([left.blob.arrayBuffer(), right.blob.arrayBuffer()]);
  const bytes = new Uint8Array(a), other = new Uint8Array(b);
  return bytes.length === other.length && bytes.every((byte, index) => byte === other[index]);
}

async function transferBaseline(records: readonly ImageBlobRecord[]): Promise<Map<string, StoredImage | undefined>> {
  const db = await getDB(), baseline = new Map<string, StoredImage | undefined>();
  for (const record of records) {
    if (baseline.has(record.key)) throw new Error(`图片 ${record.key} 在备份中重复`);
    const existing = await db.get(STORE_NAME, record.key) as StoredImage | undefined;
    const retained = retainedGenerationResults.get(record.key);
    if (retained && !await identical(retained, record)) throw new Error(`图片标识 ${record.key} 与本机尚未保存的生成内容冲突，未覆盖本机图片。`);
    if (existing && !await identical(existing, record)) throw new Error(`图片标识 ${record.key} 与本机内容或元数据冲突，未覆盖本机图片。`);
    baseline.set(record.key, existing);
  }
  return baseline;
}

function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    },
  });
}

const portraitKeysByName = new Map<string, string>();
let portraitIndexRevision = 0;
let portraitIndexPromise: Promise<void> | null = null;
const retainedGenerationResults = new Map<string, ImageBlobRecord>();

function invalidateDisplays(keys?: readonly string[]) {
  portraitIndexRevision++;
  portraitIndexPromise = null;
  portraitKeysByName.clear();
  imageUrls.invalidate(keys);
}

function withRetained(records: ImageBlobRecord[]): ImageBlobRecord[] {
  const merged = new Map(records.map(record => [record.key, record]));
  for (const [key, record] of retainedGenerationResults) merged.set(key, record);
  return [...merged.values()];
}

async function storeImageRecord(record: ImageBlobRecord, isCurrent?: () => boolean): Promise<string> {
  const db = await getDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  void tx.done.catch(() => {});
  try {
    if (isCurrent && !isCurrent()) throw new Error('画像目标已改变');
    await tx.store.put({ ...record, writeId: crypto.randomUUID() } satisfies StoredImage);
    if (isCurrent && !isCurrent()) throw new Error('画像目标已改变');
    await tx.done;
    retainedGenerationResults.delete(record.key);
    invalidateDisplays([record.key]);
    return record.key;
  } catch (error) {
    try { tx.abort(); } catch { /* Already aborted. */ }
    await tx.done.catch(() => {});
    throw error;
  }
}

function ensurePortraitIndex(): Promise<void> {
  if (!portraitIndexPromise) {
    const revision = portraitIndexRevision;
    portraitIndexPromise = (async () => {
      const db = await getDB();
      const records = withRetained(await db.getAll(STORE_NAME) as ImageBlobRecord[]).sort((a, b) => b.createdAt - a.createdAt);
      if (revision !== portraitIndexRevision) return ensurePortraitIndex();
      for (const record of records) {
        if (!record.key.startsWith('portrait-') || !record.npcName || !record.blob) continue;
        if (!portraitKeysByName.has(record.npcName)) {
          portraitKeysByName.set(record.npcName, record.key);
        }
      }
    })().catch(err => {
      portraitIndexPromise = null;
      throw err;
    });
  }
  return portraitIndexPromise;
}

export const imageDb = {
  async saveBlob(key: string, blob: Blob, mimeType?: string, npcName?: string, generation?: ImageGenerationMetadata, isCurrent?: () => boolean): Promise<string> {
    try {
      const data: ImageBlobRecord = {
        key,
        blob,
        mimeType: mimeType || blob.type || 'image/png',
        size: blob.size,
        createdAt: Date.now(),
        npcName,
        generation,
      };
      return await storeImageRecord(data, isCurrent);
    } catch (err) {
      console.error('[imageDb] saveBlob 失败:', err);
      throw err;
    }
  },

  async getBlob(key: string): Promise<ImageBlobRecord | null> {
    const retained = retainedGenerationResults.get(key);
    if (retained) return retained;
    try {
      const db = await getDB();
      const result = await db.get(STORE_NAME, key);
      return result ? publicRecord(result) : null;
    } catch (err) {
      console.error('[imageDb] getBlob 失败:', err);
      return null;
    }
  },

  async deleteBlob(key: string): Promise<void> {
    try {
      const db = await getDB();
      await db.delete(STORE_NAME, key);
      retainedGenerationResults.delete(key);
      invalidateDisplays([key]);
    } catch (err) {
      console.error('[imageDb] deleteBlob 失败:', err);
      throw err;
    }
  },

  async getAllBlobs(): Promise<ImageBlobRecord[]> {
    try {
      const db = await getDB();
      return withRetained((await db.getAll(STORE_NAME)).map(publicRecord));
    } catch (err) {
      console.error('[imageDb] getAllBlobs 失败:', err);
      return [...retainedGenerationResults.values()];
    }
  },

  /** Backups must fail visibly on storage errors rather than silently omit images. */
  async getAllBlobsStrict(): Promise<ImageBlobRecord[]> {
    return withRetained((await (await getDB()).getAll(STORE_NAME)).map(publicRecord));
  },

  retainGenerated(record: ImageBlobRecord): void { retainedGenerationResults.set(record.key, record); invalidateDisplays([record.key]); },

  async saveGenerated(record: ImageBlobRecord, isCurrent?: () => boolean): Promise<string> {
    return storeImageRecord(record, isCurrent);
  },

  async checkTransferRecords(records: readonly ImageBlobRecord[]): Promise<void> {
    await transferBaseline(records);
  },

  async installTransferRecords(records: readonly ImageBlobRecord[], owner: string): Promise<void> {
    if (!records.length) return;
    const baseline = await transferBaseline(records);
    const tx = (await getDB()).transaction(STORE_NAME, 'readwrite');
    void tx.done.catch(() => {});
    try {
      // Blob comparison happens before opening the transaction. Recheck every writer under its lock.
      for (const record of records) {
        const current = await tx.store.get(record.key) as StoredImage | undefined;
        const expected = baseline.get(record.key);
        if (Boolean(current) !== Boolean(expected) || (current && expected && metadata(current) !== metadata(expected))) {
          throw new Error(`图片 ${record.key} 在导入期间发生变化，请重试；本机图片已保留。`);
        }
      }
      for (const record of records) if (!baseline.get(record.key)) {
        await tx.store.add({ ...record, writeId: crypto.randomUUID(), _saveImportOwner: owner } satisfies StoredImage);
      }
      await tx.done;
      invalidateDisplays(records.map(record => record.key));
    } catch (error) {
      try { tx.abort(); } catch { /* Already aborted. */ }
      await tx.done.catch(() => {});
      throw error;
    }
  },

  async rollbackTransferRecords(keys: readonly string[], owner: string): Promise<void> {
    const tx = (await getDB()).transaction(STORE_NAME, 'readwrite');
    void tx.done.catch(() => {});
    try {
      for (const key of keys) {
        const current = await tx.store.get(key) as StoredImage | undefined;
        if (current?._saveImportOwner === owner) await tx.store.delete(key);
      }
      await tx.done;
      invalidateDisplays(keys);
    } catch (error) {
      try { tx.abort(); } catch { /* Already aborted. */ }
      await tx.done.catch(() => {});
      throw error;
    }
  },

  async clearAll(): Promise<void> {
    try {
      const db = await getDB();
      await db.clear(STORE_NAME);
      retainedGenerationResults.clear();
      invalidateDisplays();
    } catch (err) {
      console.error('[imageDb] clearAll 失败:', err);
      throw err;
    }
  },

  /** 获取所有 key（不加载 blob，轻量） */
  async getAllKeys(): Promise<string[]> {
    try {
      const db = await getDB();
      const keys = await db.getAllKeys(STORE_NAME);
      return [...new Set([...keys.map(String), ...retainedGenerationResults.keys()])];
    } catch (err) {
      console.error('[imageDb] getAllKeys 失败:', err);
      return [];
    }
  },

  /**
   * Resolve a stable key; mounted displays acquire their own URL lease.
   */
  async findPortraitKeyByName(npcName: string): Promise<string | null> {
    if (!npcName) return null;
    try {
      await ensurePortraitIndex();
      return portraitKeysByName.get(npcName) || null;
    } catch (err) {
      console.warn('[imageDb] findPortraitKeyByName 失败:', err);
    }
    return null;
  },
};

export const imageUrls = new ImageUrlPool(key => imageDb.getBlob(key));
