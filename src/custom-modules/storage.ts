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
const AGENT_SESSION_KEY = 'customModuleAgentSession.v2';
const AGENT_PHASES = new Set(['discovery', 'designing', 'draft_ready', 'revising']);
const BRIEF_LIST_FIELDS = ['triggers', 'inputs', 'state', 'behavior', 'outputs', 'assumptions', 'unresolved'] as const;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isValidAgentSessionSnapshot(value: unknown): value is CustomModuleAgentSession {
  if (!isRecord(value) || value.sessionVersion !== 1 || !AGENT_PHASES.has(String(value.phase))) return false;
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

  const brief = value.brief;
  if (!isRecord(brief) || typeof brief.goal !== 'string' || typeof brief.presentation !== 'string') return false;
  if (!BRIEF_LIST_FIELDS.every((key) => isStringArray(brief[key]))) return false;

  for (const draft of [value.draft, value.lastValidDraft]) {
    if (draft === undefined) continue;
    if (!validateCustomGameplayModule(draft).valid) return false;
  }
  return true;
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

/** Draft sessions are deliberately stored separately from installed modules. */
export async function saveCustomModuleAgentSession(session: CustomModuleAgentSession): Promise<void> {
  await putGlobal(AGENT_SESSION_KEY, copy(session));
}

export async function loadCustomModuleAgentSession(): Promise<CustomModuleAgentSession | undefined> {
  const session = await getGlobal<unknown>(AGENT_SESSION_KEY);
  return isValidAgentSessionSnapshot(session) ? copy(session) : undefined;
}

export async function clearCustomModuleAgentSession(): Promise<void> {
  await putGlobal(AGENT_SESSION_KEY, undefined);
}

