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

export const imageDb = {
  async saveBlob(key: string, blob: Blob, mimeType?: string): Promise<string> {
    try {
      const db = await getDB();
      const data: ImageBlobRecord = {
        key,
        blob,
        mimeType: mimeType || 'image/png',
        size: blob.size,
        createdAt: Date.now(),
      };
      await db.put(STORE_NAME, data);
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
      await db.delete(STORE_NAME, key);
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
    } catch (err) {
      console.error('[imageDb] clearAll 失败:', err);
    }
  },
};
