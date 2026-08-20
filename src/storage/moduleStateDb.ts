import type { ModuleRuntimeId, ModuleStateRecord } from '../gameplay/moduleRuntime/types';
import { getDB, MODULE_CHECKPOINTS_STORE, MODULE_STATES_STORE } from './db';

interface StoredModuleState<T = unknown> extends ModuleStateRecord<T> {
  key: string;
}

const stateKey = (saveId: string, moduleId: ModuleRuntimeId) => `${saveId}#${moduleId}`;
const checkpointKey = (saveId: string, moduleId: ModuleRuntimeId, revision: number) => `${saveId}#${moduleId}#${revision}`;

function withoutKey<T>(record: StoredModuleState<T>): ModuleStateRecord<T> {
  const { key: _key, ...value } = record;
  return value;
}

export async function putModuleStates(records: readonly ModuleStateRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(MODULE_STATES_STORE, 'readwrite');
  for (const record of records) {
    await tx.store.put({ ...record, key: stateKey(record.saveId, record.moduleId) });
  }
  await tx.done;
}

export async function getModuleStates(saveId: string): Promise<ModuleStateRecord[]> {
  const db = await getDB();
  const tx = db.transaction(MODULE_STATES_STORE, 'readonly');
  const records = await tx.store.index('saveId').getAll(saveId) as StoredModuleState[];
  return records
    .map(withoutKey)
    .sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}

export async function getModuleState<T>(saveId: string, moduleId: ModuleRuntimeId): Promise<ModuleStateRecord<T> | undefined> {
  const db = await getDB();
  const record = await db.get(MODULE_STATES_STORE, stateKey(saveId, moduleId)) as StoredModuleState<T> | undefined;
  return record ? withoutKey(record) : undefined;
}

export async function putModuleCheckpoints(records: readonly ModuleStateRecord[]): Promise<void> {
  if (records.length === 0) return;
  const db = await getDB();
  const tx = db.transaction(MODULE_CHECKPOINTS_STORE, 'readwrite');
  for (const record of records) {
    await tx.store.put({
      ...record,
      key: checkpointKey(record.saveId, record.moduleId, record.revision),
    });
  }
  await tx.done;
}

export async function getModuleCheckpoint<T>(
  saveId: string,
  moduleId: ModuleRuntimeId,
  revision: number,
): Promise<ModuleStateRecord<T> | undefined> {
  const db = await getDB();
  const record = await db.get(
    MODULE_CHECKPOINTS_STORE,
    checkpointKey(saveId, moduleId, revision),
  ) as StoredModuleState<T> | undefined;
  return record ? withoutKey(record) : undefined;
}

export async function getModuleCheckpoints(saveId: string): Promise<ModuleStateRecord[]> {
  const db = await getDB();
  const tx = db.transaction(MODULE_CHECKPOINTS_STORE, 'readonly');
  const records = await tx.store.index('saveId').getAll(saveId) as StoredModuleState[];
  return records
    .map(withoutKey)
    .sort((a, b) => a.moduleId.localeCompare(b.moduleId) || a.revision - b.revision);
}

/** 只保留仍被消息快照或当前状态引用的修订，避免长存档无限累积模块正文。 */
export async function pruneModuleCheckpoints(saveId: string, keep: ReadonlySet<string>): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(MODULE_CHECKPOINTS_STORE, 'readwrite');
  const index = tx.store.index('saveId');
  let cursor = await index.openCursor(IDBKeyRange.only(saveId));
  while (cursor) {
    const record = cursor.value as StoredModuleState;
    if (!keep.has(`${record.moduleId}#${record.revision}`)) await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

async function deleteBySaveId(storeName: string, saveId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  const index = tx.store.index('saveId');
  let cursor = await index.openCursor(IDBKeyRange.only(saveId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function deleteModuleRuntimeForSave(saveId: string): Promise<void> {
  await deleteBySaveId(MODULE_STATES_STORE, saveId);
  await deleteBySaveId(MODULE_CHECKPOINTS_STORE, saveId);
}
