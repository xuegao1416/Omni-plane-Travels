import { getDB, getGlobal, putGlobal } from '../storage/db';
import { validateCustomGameplayModule } from './validator';
import type { CustomGameplayModuleDefinition, ModuleStatus } from './schema';

export interface StoredCustomGameplayModule {
  module: CustomGameplayModuleDefinition;
  status: ModuleStatus;
  worldIds: string[];
  installedAt: number;
  updatedAt: number;
  /** Explicit world bindings retain their definition when the latest draft changes. */
  worldDefinitions?: Record<string, CustomGameplayModuleDefinition>;
}

const REGISTRY_KEY = 'customGameplayModules.v1';

function copy<T>(value: T): T {
  return structuredClone(value);
}

export interface CustomModuleDependencyResolution {
  modules: StoredCustomGameplayModule[];
  warnings: string[];
}

async function readRegistry(): Promise<StoredCustomGameplayModule[]> {
  const records = await getGlobal<StoredCustomGameplayModule[]>(REGISTRY_KEY);
  return Array.isArray(records) ? normalizeRegistry(records) : [];
}

function normalizeRegistry(records: StoredCustomGameplayModule[]): StoredCustomGameplayModule[] {
  return records.map(record => ({
    ...record,
    module: validateCustomGameplayModule(record.module, 'internal').normalized ?? record.module,
    worldDefinitions: Object.fromEntries(record.worldIds.map(worldId => {
      const definition = record.worldDefinitions?.[worldId] ?? record.module;
      return [worldId, validateCustomGameplayModule(definition, 'internal').normalized ?? definition];
    })),
  }));
}

async function mutateRegistry<T>(mutate: (records: StoredCustomGameplayModule[]) => T): Promise<T> {
  const db = await getDB();
  const tx = db.transaction('global', 'readwrite');
  const record = await tx.store.get(REGISTRY_KEY);
  const records = normalizeRegistry(Array.isArray(record?.value) ? record.value : []);
  const result = mutate(records);
  await tx.store.put({ key: REGISTRY_KEY, value: records });
  await tx.done;
  return copy(result);
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
  return mutateRegistry((records) => {
  const now = Date.now();
  const existing = records.find((item) => item.module.id === module.id);
  const saved: StoredCustomGameplayModule = {
    module,
    status: existing?.status ?? 'installed',
    worldIds: existing?.worldIds ?? [],
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
    worldDefinitions: existing?.worldDefinitions ?? Object.fromEntries((existing?.worldIds ?? []).map(worldId => [worldId, copy(existing!.module)])),
  };
  if (existing) records[records.indexOf(existing)] = saved;
  else records.push(saved);
  return saved;
  });
}

export async function bindCustomGameplayModule(id: string, worldId: string): Promise<StoredCustomGameplayModule> {
  return mutateRegistry((records) => {
  const index = records.findIndex((item) => item.module.id === id);
  if (index < 0) throw new Error(`找不到自定义玩法模块：${id}`);
  const current = records[index];
  const worldIds = current.worldIds.includes(worldId) ? current.worldIds : [...current.worldIds, worldId];
  const updated = { ...current, worldIds, worldDefinitions: { ...current.worldDefinitions, [worldId]: copy(current.module) }, status: 'enabled' as const, updatedAt: Date.now() };
  records[index] = updated;
  return updated;
  });
}

export async function disableCustomGameplayModuleForWorld(id: string, worldId: string): Promise<StoredCustomGameplayModule> {
  return mutateRegistry(records => {
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
  delete updated.worldDefinitions?.[worldId];
  return updated;
  });
}

function parseVersion(version: string | undefined): [number, number, number] | undefined {
  const match = typeof version === 'string' ? version.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

export function versionSatisfies(actual: string, required?: string): boolean {
  if (!required) return true;
  const actualVersion = parseVersion(actual);
  const requiredVersion = parseVersion(required);
  if (!actualVersion || !requiredVersion) return false;
  return actualVersion[0] > requiredVersion[0]
    || (actualVersion[0] === requiredVersion[0] && (actualVersion[1] > requiredVersion[1]
      || (actualVersion[1] === requiredVersion[1] && actualVersion[2] >= requiredVersion[2])));
}

/**
 * Resolve enabled modules without allowing a module to run against a missing,
 * disabled, unbound, or too-old required dependency.
 */
export async function resolveCustomGameplayModulesForWorld(worldId: string): Promise<CustomModuleDependencyResolution> {
  const records = (await readRegistry()).map(record => ({ ...record, module: record.worldDefinitions?.[worldId] ?? record.module }));
  const byId = new Map(records.map((record) => [record.module.id, record]));
  const warnings: string[] = [];
  const warningSet = new Set<string>();
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();
  const warn = (message: string) => { if (!warningSet.has(message)) { warningSet.add(message); warnings.push(message); } };

  const usable = (id: string, requiredBy: string): boolean => {
    if (memo.has(id)) return memo.get(id)!;
    const record = byId.get(id);
    if (!record) { warn(`模块 ${requiredBy} 缺少依赖 ${id}`); memo.set(id, false); return false; }
    if (record.status !== 'enabled') { warn(`模块 ${requiredBy} 的依赖 ${id} 未启用`); memo.set(id, false); return false; }
    if (!record.worldIds.includes(worldId)) { warn(`模块 ${requiredBy} 的依赖 ${id} 未绑定当前世界`); memo.set(id, false); return false; }
    const validation = validateCustomGameplayModule(record.module, 'internal');
    if (!validation.valid) { warn(`模块 ${id} 无法启用：${validation.errors.map(error => error.message).join('；')}`); memo.set(id, false); return false; }
    if (visiting.has(id)) { warn(`模块依赖存在循环：${id}`); memo.set(id, false); return false; }
    visiting.add(id);
    let ok = true;
    for (const dependency of record.module.dependencies ?? []) {
      const dependencyRecord = byId.get(dependency.id);
      if (!dependencyRecord || dependencyRecord.status !== 'enabled' || !dependencyRecord.worldIds.includes(worldId) || !versionSatisfies(dependencyRecord.module.version, dependency.version)) {
        if (dependency.optional) {
          warn(`模块 ${id} 的可选依赖 ${dependency.id} 不可用`);
        } else {
          if (!dependencyRecord) warn(`模块 ${id} 缺少依赖 ${dependency.id}`);
          else if (dependencyRecord.status !== 'enabled') warn(`模块 ${id} 的依赖 ${dependency.id} 未启用`);
          else if (!dependencyRecord.worldIds.includes(worldId)) warn(`模块 ${id} 的依赖 ${dependency.id} 未绑定当前世界`);
          else warn(`模块 ${id} 的依赖 ${dependency.id} 版本不满足（需要 ${dependency.version}，当前 ${dependencyRecord.module.version}）`);
          ok = false;
        }
        continue;
      }
      if (!usable(dependency.id, id)) {
        if (dependency.optional) warn(`模块 ${id} 的可选依赖 ${dependency.id} 不可用`);
        else ok = false;
      }
    }
    visiting.delete(id);
    memo.set(id, ok);
    return ok;
  };

  const modules = records.filter((record) => record.status === 'enabled' && record.worldIds.includes(worldId) && usable(record.module.id, record.module.id));
  return { modules: copy(modules), warnings };
}

export async function getCustomGameplayModulesForWorld(worldId: string): Promise<StoredCustomGameplayModule[]> {
  const result = await resolveCustomGameplayModulesForWorld(worldId);
  return result.modules;
}

export async function deleteCustomGameplayModule(id: string): Promise<void> {
  await mutateRegistry(records => { const index = records.findIndex(item => item.module.id === id); if (index >= 0) records.splice(index, 1); });
}

/** Restore an exact registry record during an atomic workshop rollback. */
export async function restoreCustomGameplayModule(record: StoredCustomGameplayModule): Promise<void> {
  await mutateRegistry(records => { const index = records.findIndex(item => item.module.id === record.module.id); if (index >= 0) records[index] = copy(record); else records.push(copy(record)); });
}

/** Test/reset helper and a safe recovery path for a future module manager. */
export async function clearCustomGameplayModules(): Promise<void> {
  await putGlobal(REGISTRY_KEY, []);
}

