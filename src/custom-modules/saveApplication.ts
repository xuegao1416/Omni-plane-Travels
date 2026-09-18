import type { GameState } from '../schema/variables';
import { getDB, loadSaveWithMigration, MODULE_STATES_STORE, MODULE_CHECKPOINTS_STORE, type CompactSaveRecord } from '../storage/db';
import { extractModulePartitions, materializeModulePartitions } from '../gameplay/moduleRuntime/facade';
import type { ModuleStateRecord } from '../gameplay/moduleRuntime/types';
import type { CustomGameplayModuleDefinition } from './schema';
import { migrateCustomModuleState } from './stateStore';
import { executeCustomModuleInGame } from './hostRuntime';
import { validateCustomGameplayModule } from './validator';
import { versionSatisfies } from './storage';

const activeSaves = new Map<string, Set<symbol>>();
/** Mounted gameplay owns this lease; a persisted F5 bookmark is not a running game. */
export function setCustomModuleActiveSave(saveId: string): () => void {
  const token = Symbol(saveId);
  const leases = activeSaves.get(saveId) ?? new Set<symbol>();
  leases.add(token);
  activeSaves.set(saveId, leases);
  return () => { leases.delete(token); if (!leases.size) activeSaves.delete(saveId); };
}
function assertInactive(saveId: string): void {
  if (activeSaves.has(saveId)) throw new Error('请先退出正在运行的存档，再应用或恢复模块。');
}
const recoveryKey = (saveId: string) => `customModuleSaveRecoveries.v1:${saveId}`;
const revision = (head: CompactSaveRecord) => JSON.stringify(head);
function orderedRecords(records: Array<ModuleStateRecord & { key?: string }>): ModuleStateRecord[] {
  return records.map(({ key: _key, ...record }) => record).sort((a, b) => a.moduleId.localeCompare(b.moduleId));
}
const moduleRevision = (records: ModuleStateRecord[]) => JSON.stringify(orderedRecords(records));

export interface SaveModuleApplicationPreview {
  saveId: string;
  saveName: string;
  worldId: string;
  module: CustomGameplayModuleDefinition;
  baseRevision: string;
  baseModuleRevision: string;
  changes: string[];
  conflicts: string[];
  nextGameState: GameState;
}
export interface SaveModuleRecovery {
  id: string;
  saveId: string;
  saveName: string;
  createdAt: number;
  moduleId: string;
  moduleName: string;
  previousGameState: GameState;
  previousModuleStates: ModuleStateRecord[];
  appliedRevision: string;
  appliedModuleRevision: string;
  restoredAt?: number;
}
export async function listSaveModuleCandidates(worldId: string): Promise<{ id: string; name: string; timestamp: number; active: boolean }[]> {
  const db = await getDB();
  const saves = await db.getAll('saves') as CompactSaveRecord[];
  return saves.filter(save => save.worldId === worldId && save.lifecycle !== 'ended')
    .map(({ id, name, timestamp }) => ({ id, name, timestamp, active: activeSaves.has(id) }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

function planApplication(head: CompactSaveRecord, input: CustomGameplayModuleDefinition, records: ModuleStateRecord[]): SaveModuleApplicationPreview {
  const validation = validateCustomGameplayModule(input);
  if (!validation.valid || !validation.normalized) throw new Error(validation.errors.map(error => error.message).join('；'));
  const module = validation.normalized;
  const nextGameState = materializeModulePartitions(head.gameState, records);
  const conflicts: string[] = [];
  if (head.lifecycle === 'ended') conflicts.push('已结束的存档不可应用模块。');
  for (const dependency of module.dependencies ?? []) {
    const current = nextGameState.customModules?.[dependency.id];
    if (!dependency.optional && (!current?.enabled || !current.definition || !versionSatisfies(current.definition.version, dependency.version))) {
      conflicts.push(`存档缺少可用依赖 ${dependency.id}${dependency.version ? ` >= ${dependency.version}` : ''}`);
    }
  }
  const current = nextGameState.customModules?.[module.id];
  const changes = [current ? `更新 ${module.name}：${current.moduleVersion} → ${module.version}；保留兼容状态，不重复发放开局奖励。` : `新增 ${module.name} ${module.version}，仅执行该模块的开局初始化。`];
  if (current) {
    const migrated = migrateCustomModuleState(current, module);
    conflicts.push(...migrated.conflicts);
    if (migrated.state) nextGameState.customModules![module.id] = migrated.state;
  } else if (!conflicts.length) {
    const result = executeCustomModuleInGame(nextGameState, module, 'onGameStart', { eventId: `install:${module.id}`, now: 0 });
    Object.assign(nextGameState, result.gameState);
    conflicts.push(...result.warnings);
  }
  nextGameState.customModuleBindingsInitialized = true;
  const before = materializeModulePartitions(head.gameState, records);
  const currencyDelta = nextGameState.玩家.货币资源.主货币.数量 - before.玩家.货币资源.主货币.数量;
  if (currencyDelta) changes.push(`主货币：${currencyDelta > 0 ? '+' : ''}${currencyDelta}`);
  for (const [name, item] of Object.entries(nextGameState.玩家.物品栏)) {
    const delta = item.数量 - (before.玩家.物品栏[name]?.数量 ?? 0);
    if (delta) changes.push(`物品「${name}」：${delta > 0 ? '+' : ''}${delta}`);
  }
  for (const [id, resource] of Object.entries(nextGameState.玩家.生存资源 ?? {})) {
    const delta = resource.数量 - (before.玩家.生存资源?.[id]?.数量 ?? 0);
    if (delta) changes.push(`资源「${id}」：${delta > 0 ? '+' : ''}${delta}`);
  }
  return { saveId: head.id, saveName: head.name, worldId: head.worldId, module, baseRevision: revision(head), baseModuleRevision: moduleRevision(records), changes, conflicts, nextGameState };
}

export async function previewSaveModuleApplication(saveId: string, module: CustomGameplayModuleDefinition): Promise<SaveModuleApplicationPreview> {
  if (!await loadSaveWithMigration(saveId)) throw new Error('找不到可用存档。');
  const tx = (await getDB()).transaction(['saves', MODULE_STATES_STORE], 'readonly');
  const head = await tx.objectStore('saves').get(saveId) as CompactSaveRecord | undefined;
  const records = orderedRecords(await tx.objectStore(MODULE_STATES_STORE).index('saveId').getAll(saveId));
  await tx.done;
  if (!head) throw new Error('存档已删除。');
  return planApplication(head, module, records);
}

export async function applySaveModuleApplication(preview: SaveModuleApplicationPreview): Promise<SaveModuleRecovery> {
  assertInactive(preview.saveId);
  const db = await getDB();
  const tx = db.transaction(['saves', 'global', MODULE_STATES_STORE, MODULE_CHECKPOINTS_STORE], 'readwrite');
  try {
    const head = await tx.objectStore('saves').get(preview.saveId) as CompactSaveRecord | undefined;
    const previousRecords = orderedRecords(await tx.objectStore(MODULE_STATES_STORE).index('saveId').getAll(preview.saveId));
    assertInactive(preview.saveId);
    if (!head || head.worldId !== preview.worldId || revision(head) !== preview.baseRevision || moduleRevision(previousRecords) !== preview.baseModuleRevision) throw new Error('存档已变化，请重新预览后应用。');
    const verified = planApplication(head, preview.module, previousRecords);
    if (verified.conflicts.length) throw new Error(verified.conflicts.join('；'));
    const extracted = extractModulePartitions(verified.nextGameState, head.id);
    const nextRecords: ModuleStateRecord[] = [];
    for (const record of extracted.records) {
      const previousRecord = previousRecords.find(item => item.moduleId === record.moduleId);
      if (previousRecord && JSON.stringify(previousRecord.state) === JSON.stringify(record.state)) { nextRecords.push(previousRecord); continue; }
      if (previousRecord) {
        const key = `${head.id}#${record.moduleId}#${previousRecord.revision}`;
        if (!await tx.objectStore(MODULE_CHECKPOINTS_STORE).get(key)) await tx.objectStore(MODULE_CHECKPOINTS_STORE).put({ ...previousRecord, key });
      }
      let nextRevision = (previousRecord?.revision ?? 0) + 1;
      while (await tx.objectStore(MODULE_CHECKPOINTS_STORE).get(`${head.id}#${record.moduleId}#${nextRevision}`)) nextRevision += 1;
      const next = { ...record, revision: nextRevision };
      nextRecords.push(next);
      await tx.objectStore(MODULE_STATES_STORE).put({ ...next, key: `${head.id}#${record.moduleId}` });
      await tx.objectStore(MODULE_CHECKPOINTS_STORE).put({ ...next, key: `${head.id}#${record.moduleId}#${nextRevision}` });
    }
    // Host capabilities cannot delete another built-in module's partition.
    for (const previous of previousRecords) if (!nextRecords.some(record => record.moduleId === previous.moduleId)) nextRecords.push(previous);
    extracted.coreState.moduleRevisions = Object.fromEntries(nextRecords.map(record => [record.moduleId, record.revision]));
    const applied = { ...head, gameState: extracted.coreState };
    const recovery: SaveModuleRecovery = {
      id: crypto.randomUUID(), saveId: head.id, saveName: head.name, createdAt: Date.now(), moduleId: preview.module.id, moduleName: preview.module.name,
      previousGameState: head.gameState, previousModuleStates: previousRecords, appliedRevision: revision(applied), appliedModuleRevision: moduleRevision(nextRecords),
    };
    const key = recoveryKey(head.id);
    const previous = await tx.objectStore('global').get(key);
    await tx.objectStore('global').put({ key, value: [...(previous?.value ?? []), recovery] });
    await tx.objectStore('saves').put(applied);
    await tx.done;
    return structuredClone(recovery);
  } catch (error) {
    try { tx.abort(); } catch { /* Transaction may already have aborted. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
export async function listSaveModuleRecoveries(saveId: string): Promise<SaveModuleRecovery[]> {
  const record = await (await getDB()).get('global', recoveryKey(saveId));
  return (record?.value ?? []).slice().sort((a: SaveModuleRecovery, b: SaveModuleRecovery) => b.createdAt - a.createdAt);
}
export async function restoreSaveModuleRecovery(recoveryId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['saves', 'global', MODULE_STATES_STORE], 'readwrite');
  try {
    const records = await tx.objectStore('global').getAll();
    const record = records.find(record => record.key.startsWith('customModuleSaveRecoveries.v1:') && record.value.some((item: SaveModuleRecovery) => item.id === recoveryId));
    const recovery: SaveModuleRecovery | undefined = record?.value.find((item: SaveModuleRecovery) => item.id === recoveryId);
    if (!recovery || !record) throw new Error('恢复点不存在。');
    assertInactive(recovery.saveId);
    const head = await tx.objectStore('saves').get(recovery.saveId) as CompactSaveRecord | undefined;
    const currentRecords = orderedRecords(await tx.objectStore(MODULE_STATES_STORE).index('saveId').getAll(recovery.saveId));
    if (!head || recovery.restoredAt || revision(head) !== recovery.appliedRevision || moduleRevision(currentRecords) !== recovery.appliedModuleRevision) throw new Error('存档在应用后已变化，不能覆盖后续进度；请使用匹配当前存档的恢复点。');
    assertInactive(recovery.saveId);
    for (const current of currentRecords) {
      if (!recovery.previousModuleStates.some(previous => previous.moduleId === current.moduleId)) await tx.objectStore(MODULE_STATES_STORE).delete(`${recovery.saveId}#${current.moduleId}`);
    }
    for (const previous of recovery.previousModuleStates) await tx.objectStore(MODULE_STATES_STORE).put({ ...previous, key: `${recovery.saveId}#${previous.moduleId}` });
    await tx.objectStore('saves').put({ ...head, gameState: recovery.previousGameState });
    recovery.restoredAt = Date.now();
    await tx.objectStore('global').put(record);
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* Already completed or aborted. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}
