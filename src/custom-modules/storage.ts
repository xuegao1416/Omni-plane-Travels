import { getGlobal, putGlobal } from '../storage/db';
import { validateCustomGameplayModule } from './validator';
import type { CustomGameplayModuleDefinition, ModuleStatus } from './schema';
import type { CustomModuleAgentSession } from './agentSession';

export interface StoredCustomGameplayModule {
  module: CustomGameplayModuleDefinition;
  status: ModuleStatus;
  worldIds: string[];
  installedAt: number;
  updatedAt: number;
}

const REGISTRY_KEY = 'customGameplayModules.v1';
const AGENT_SESSION_KEY = 'customModuleAgentSessions.v3';
const LEGACY_AGENT_SESSION_KEY = 'customModuleAgentSession.v2';
const AGENT_PHASES = new Set(['discovery', 'designing', 'draft_ready', 'revising']);
const BRIEF_LIST_FIELDS = ['triggers', 'inputs', 'state', 'behavior', 'outputs', 'assumptions', 'unresolved'] as const;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface CustomModuleDependencyResolution {
  modules: StoredCustomGameplayModule[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidAgentSessionSnapshot(value: unknown): value is CustomModuleAgentSession {
  if (!isRecord(value) || (value.sessionVersion !== 1 && value.sessionVersion !== 2) || !AGENT_PHASES.has(String(value.phase))) return false;
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0) return false;

  const world = value.world;
  if (!isRecord(world) || typeof world.id !== 'string' || typeof world.name !== 'string') return false;
  if (world.description !== undefined && typeof world.description !== 'string') return false;
  if (world.survivalResourceIds !== undefined && !isStringArray(world.survivalResourceIds)) return false;
  if (world.availability !== undefined) {
    const availability = world.availability;
    if (!isRecord(availability)) return false;
    if (!['stat', 'survival', 'business', 'currency'].every((key) => typeof availability[key] === 'boolean')) return false;
  }

  if (value.conversation !== undefined && (!Array.isArray(value.conversation) || !value.conversation.every((item) => (
    isRecord(item) && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string'
  )))) return false;
  const brief = value.brief;
  if (!isRecord(brief) || typeof brief.goal !== 'string' || typeof brief.presentation !== 'string') return false;
  if (!BRIEF_LIST_FIELDS.every((key) => isStringArray(brief[key]))) return false;

  for (const draft of [value.draft, value.lastValidDraft]) {
    if (draft === undefined) continue;
    if (!validateCustomGameplayModule(draft).valid) return false;
  }
  return true;
}

function normalizeAgentSession(value: CustomModuleAgentSession): CustomModuleAgentSession {
  return {
    ...copy(value),
    sessionVersion: 2,
    conversation: Array.isArray((value as CustomModuleAgentSession & { conversation?: unknown }).conversation)
      ? copy((value as CustomModuleAgentSession & { conversation: CustomModuleAgentSession['conversation'] }).conversation)
      : [],
  };
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

function parseVersion(version: string | undefined): [number, number, number] | undefined {
  const match = typeof version === 'string' ? version.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function versionSatisfies(actual: string, required?: string): boolean {
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
  const records = await readRegistry();
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
  const records = await readRegistry();
  await writeRegistry(records.filter((item) => item.module.id !== id));
}

/** Restore an exact registry record during an atomic workshop rollback. */
export async function restoreCustomGameplayModule(record: StoredCustomGameplayModule): Promise<void> {
  const records = await readRegistry();
  await writeRegistry([...records.filter((item) => item.module.id !== record.module.id), copy(record)]);
}

/** Test/reset helper and a safe recovery path for a future module manager. */
export async function clearCustomGameplayModules(): Promise<void> {
  await putGlobal(REGISTRY_KEY, []);
}

/** Draft sessions are deliberately stored separately from installed modules. */
export async function saveCustomModuleAgentSession(session: CustomModuleAgentSession): Promise<void> {
  if (!isValidAgentSessionSnapshot(session)) return;
  const current = await getGlobal<Record<string, unknown>>(AGENT_SESSION_KEY);
  const sessions = isRecord(current) ? current : {};
  sessions[session.world.id] = normalizeAgentSession(session);
  await putGlobal(AGENT_SESSION_KEY, sessions);
}

export async function loadCustomModuleAgentSession(worldId?: string): Promise<CustomModuleAgentSession | undefined> {
  const stored = await getGlobal<unknown>(AGENT_SESSION_KEY);
  if (isRecord(stored)) {
    const candidate = worldId ? stored[worldId] : Object.values(stored)[0];
    if (isValidAgentSessionSnapshot(candidate)) return normalizeAgentSession(candidate);
  }

  // One-time read compatibility for the pre-v3 single-session record.
  const legacy = await getGlobal<unknown>(LEGACY_AGENT_SESSION_KEY);
  if (isValidAgentSessionSnapshot(legacy) && (!worldId || legacy.world.id === worldId)) {
    const normalized = normalizeAgentSession(legacy);
    await saveCustomModuleAgentSession(normalized);
    return normalized;
  }
  return undefined;
}

export async function clearCustomModuleAgentSession(): Promise<void> {
  await putGlobal(AGENT_SESSION_KEY, undefined);
  await putGlobal(LEGACY_AGENT_SESSION_KEY, undefined);
}

