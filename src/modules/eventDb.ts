// ============================================================
// Web 端 Event 存储层（IndexedDB via idb）
//   与 src/storage/db.ts 同款 openDB 约定，但独立 DB 以避免与游戏存档升级版本冲突。
//   Web 端无 Tauri/Rust 文件系统，事件注册表与文件内容均落 IndexedDB。
// ============================================================
import { openDB, type IDBPDatabase } from 'idb';
import type { Manifest, EventMeta, EventRegistryEntry, EventRegistryStatus, Collection } from './schema';

const DB_NAME = 'opt-events';
const DB_VERSION = 2;
const STORE = 'events';
const COLLECTION_STORE = 'collections';

/** IndexedDB 中的一条事件记录（含内联文件内容，便于导出时重建 .opt-event） */
export interface WebEventRecord {
  id: string;
  manifest: Manifest;
  enabled: boolean;
  status: EventRegistryStatus;
  installedAt: string;
  /** 路径 → 内容（string=json/text，Blob=资源图片等） */
  files: Record<string, string | Blob>;
  /** 内置标记：来自世界树关联的事件包，不可删除，事件中心显示为「内置」 */
  builtin?: boolean;
  /** 来源世界 ID（仅 builtin=true 时有值，用于展示归属） */
  worldId?: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'id' });
          }
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(COLLECTION_STORE)) {
            db.createObjectStore(COLLECTION_STORE, { keyPath: 'id' });
          }
        }
      },
    });
  }
  return dbPromise;
}

export async function putWebEvent(rec: WebEventRecord): Promise<void> {
  const db = await getDb();
  await db.put(STORE, rec);
}

export async function getWebEvent(id: string): Promise<WebEventRecord | undefined> {
  const db = await getDb();
  return db.get(STORE, id);
}

export async function deleteWebEvent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function allWebEvents(): Promise<WebEventRecord[]> {
  const db = await getDb();
  return db.getAll(STORE);
}

/** Manifest → EventMeta（列表/发现态所需字段） */
export function manifestToMeta(m: Manifest): EventMeta {
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    author: m.author,
    description: m.description,
    type: m.type,
    coverColor: m.coverColor,
    icon: m.icon,
    schemaVersion: m.schemaVersion,
    minAppVersion: m.minAppVersion,
    loadOrder: m.loadOrder ?? 100,
    enabledByDefault: m.enabledByDefault ?? false,
  };
}

/** WebEventRecord → EventRegistryEntry（注册表条目） */
export function recordToEntry(rec: WebEventRecord): EventRegistryEntry {
  return {
    meta: manifestToMeta(rec.manifest),
    enabled: rec.enabled,
    status: rec.status,
    registeredAt: rec.installedAt,
    builtin: rec.builtin,
  };
}

// ─────────────────────────────────────────────────────────────
//  事件包（event pack）按存档的加载 / 卸载 —— 数据层 API
//
//  注意：此 API 仅供 EventConfigPanel 的游戏内开关使用。
//  主流程（GameScreen 注册）已改为从 IndexedDB 读全局 rec.enabled。
//  这些函数将逐步废弃。
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
//  合集（Collection）CRUD — 数据层 API
// ─────────────────────────────────────────────────────────────

export async function putCollection(col: Collection): Promise<void> {
  const db = await getDb();
  await db.put(COLLECTION_STORE, col);
}

export async function getCollection(id: string): Promise<Collection | undefined> {
  const db = await getDb();
  return db.get(COLLECTION_STORE, id);
}

export async function deleteCollection(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(COLLECTION_STORE, id);
}

export async function allCollections(): Promise<Collection[]> {
  const db = await getDb();
  return db.getAll(COLLECTION_STORE);
}

