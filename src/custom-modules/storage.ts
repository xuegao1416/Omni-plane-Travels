import { getGlobal, putGlobal } from '../storage/db';
import { validateCustomGameplayModule } from './validator';
import type { CustomGameplayModule, ModuleStatus } from './schema';

export interface StoredCustomGameplayModule {
  module: CustomGameplayModule;
  status: ModuleStatus;
  worldIds: string[];
  installedAt: number;
  updatedAt: number;
}

const REGISTRY_KEY = 'customGameplayModules.v1';

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function readRegistry(): Promise<StoredCustomGameplayModule[]> {
  const records = await getGlobal<StoredCustomGameplayModule[]>(REGISTRY_KEY);
  return Array.isArray(records) ? records : [];
}

async function writeRegistry(records: StoredCustomGameplayModule[]): Promise<void> {
  await putGlobal(REGISTRY_KEY, records);
}

export async function listCustomGameplayModules(): Promise<StoredCustomGameplayModule[]> {
  return copy(await readRegistry());
}

export async function getCustomGameplayModule(id: string): Promise<StoredCustomGameplayModule | undefined> {
  const record = (await readRegistry()).find((item) => item.module.id === id);
  return record ? copy(record) : undefined;
}

export async function saveCustomGameplayModule(input: unknown): Promise<StoredCustomGameplayModule> {
  const result = validateCustomGameplayModule(input);
  if (!result.valid || !result.normalized) {
    throw new Error(`自定义玩法模块校验失败：${result.errors.map((item) => item.message).join('；')}`);
  }

  const module = result.normalized;
  const records = await readRegistry();
  const now = Date.now();
  const existing = records.find((item) => item.module.id === module.id);
  const saved: StoredCustomGameplayModule = {
    module,
    status: existing?.status ?? 'installed',
    worldIds: existing?.worldIds ?? [],
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };
  const next = existing
    ? records.map((item) => item.module.id === module.id ? saved : item)
    : [...records, saved];
  await writeRegistry(next);
  return copy(saved);
}

export async function bindCustomGameplayModule(id: string, worldId: string): Promise<StoredCustomGameplayModule> {
  const records = await readRegistry();
  const index = records.findIndex((item) => item.module.id === id);
  if (index < 0) throw new Error(`找不到自定义玩法模块：${id}`);
  const current = records[index];
  const worldIds = current.worldIds.includes(worldId) ? current.worldIds : [...current.worldIds, worldId];
  const updated = { ...current, worldIds, status: 'enabled' as const, updatedAt: Date.now() };
  records[index] = updated;
  await writeRegistry(records);
  return copy(updated);
}

export async function disableCustomGameplayModuleForWorld(id: string, worldId: string): Promise<StoredCustomGameplayModule> {
  const records = await readRegistry();
  const index = records.findIndex((item) => item.module.id === id);
  if (index < 0) throw new Error(`找不到自定义玩法模块：${id}`);
  const current = records[index];
  const updated = {
    ...current,
    worldIds: current.worldIds.filter((boundWorldId) => boundWorldId !== worldId),
    status: current.worldIds.filter((boundWorldId) => boundWorldId !== worldId).length > 0 ? current.status : 'disabled' as const,
    updatedAt: Date.now(),
  };
  records[index] = updated;
  await writeRegistry(records);
  return copy(updated);
}

export async function getCustomGameplayModulesForWorld(worldId: string): Promise<StoredCustomGameplayModule[]> {
  const records = await readRegistry();
  return copy(records.filter((item) => item.status === 'enabled' && item.worldIds.includes(worldId)));
}

export async function deleteCustomGameplayModule(id: string): Promise<void> {
  const records = await readRegistry();
  await writeRegistry(records.filter((item) => item.module.id !== id));
}

/** Test/reset helper and a safe recovery path for a future module manager. */
export async function clearCustomGameplayModules(): Promise<void> {
  await putGlobal(REGISTRY_KEY, []);
}

