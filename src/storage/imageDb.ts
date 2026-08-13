// IndexedDB 图片 Blob 存储

import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'WorldTravelGuideImageDB';
const DB_VERSION = 1;
const STORE_NAME = 'imageBlobs';

interface ImageBlobRecord {
  key: string;
  blob: Blob;
  mimeType: string;
  size: number;
  createdAt: number;
  /** 关联的 NPC 名字（头像专用，用于按名字查找） */
  npcName?: string;
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

const portraitUrlsByName = new Map<string, string>();
let portraitIndexPromise: Promise<void> | null = null;

function ensurePortraitIndex(): Promise<void> {
  if (!portraitIndexPromise) {
    portraitIndexPromise = (async () => {
      const db = await getDB();
      const records = await db.getAll(STORE_NAME) as ImageBlobRecord[];
      for (const record of records) {
        if (!record.key.startsWith('portrait-') || !record.npcName || !record.blob) continue;
        if (!portraitUrlsByName.has(record.npcName)) {
          portraitUrlsByName.set(record.npcName, URL.createObjectURL(record.blob));
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
  async saveBlob(key: string, blob: Blob, mimeType?: string, npcName?: string): Promise<string> {
    try {
      const db = await getDB();
      const data: ImageBlobRecord = {
        key,
        blob,
        mimeType: mimeType || 'image/png',
        size: blob.size,
        createdAt: Date.now(),
        npcName,
      };
      await db.put(STORE_NAME, data);
      if (npcName) portraitUrlsByName.set(npcName, URL.createObjectURL(blob));
      return key;
    } catch (err) {
      console.error('[imageDb] saveBlob 失败:', err);
      throw err;
    }
  },

  async getBlob(key: string): Promise<ImageBlobRecord | null> {
    try {
      const db = await getDB();
      const result = await db.get(STORE_NAME, key);
      return result || null;
    } catch (err) {
      console.error('[imageDb] getBlob 失败:', err);
      return null;
    }
  },

  async deleteBlob(key: string): Promise<void> {
    try {
      const db = await getDB();
      const record = await db.get(STORE_NAME, key) as ImageBlobRecord | undefined;
      await db.delete(STORE_NAME, key);
      if (record?.npcName) {
        // There may be another portrait record for the same name; rebuild lazily on demand.
        portraitUrlsByName.clear();
        portraitIndexPromise = null;
      }
    } catch (err) {
      console.error('[imageDb] deleteBlob 失败:', err);
    }
  },

  async getAllBlobs(): Promise<ImageBlobRecord[]> {
    try {
      const db = await getDB();
      return db.getAll(STORE_NAME);
    } catch (err) {
      console.error('[imageDb] getAllBlobs 失败:', err);
      return [];
    }
  },

  async clearAll(): Promise<void> {
    try {
      const db = await getDB();
      await db.clear(STORE_NAME);
      portraitUrlsByName.clear();
      portraitIndexPromise = null;
    } catch (err) {
      console.error('[imageDb] clearAll 失败:', err);
    }
  },

  /** 获取所有 key（不加载 blob，轻量） */
  async getAllKeys(): Promise<string[]> {
    try {
      const db = await getDB();
      const keys = await db.getAllKeys(STORE_NAME);
      return keys.map(String);
    } catch (err) {
      console.error('[imageDb] getAllKeys 失败:', err);
      return [];
    }
  },

  /**
   * 按 NPC 名字查找头像 URL
   * 首次读取时一次性建立名字索引；后续查询共享同一索引与 object URL。
   */
  async findPortraitUrlByName(npcName: string): Promise<string | null> {
    if (!npcName) return null;
    try {
      await ensurePortraitIndex();
      return portraitUrlsByName.get(npcName) || null;
    } catch (err) {
      console.warn('[imageDb] findPortraitUrlByName 失败:', err);
    }
    return null;
  },
};
