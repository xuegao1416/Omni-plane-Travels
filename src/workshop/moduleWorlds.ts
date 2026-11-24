/**
 * 「已安装」里玩法模块的世界与存档：在哪些世界启用、启用到别的世界、停用，以及能应用到哪些已有存档。
 *
 * 启用只影响之后新开的游戏（开局时把模块固定进存档）；已有存档固定使用开局时的模块，
 * 要手动应用（custom-modules/saveApplication：预览 → 创建恢复点并应用 → 需要时恢复）。
 */
import type { WorldDef } from '../data/worlds-schema';
import { getAllWorlds } from '../data/worldLoader';
import type { CustomGameplayModuleDefinition } from '../custom-modules/schema';
import { bindCustomGameplayModule, disableCustomGameplayModuleForWorld, getCustomGameplayModule } from '../custom-modules/storage';
import { listSaveModuleCandidates } from '../custom-modules/saveApplication';

export interface ModuleWorldOption {
  id: string;
  name: string;
  /** 世界已经被删除（仍然可以停用）。 */
  missing?: boolean;
}

export interface ModuleWorldStatus {
  moduleId: string;
  moduleName: string;
  version: string;
  enabled: ModuleWorldOption[];
  available: ModuleWorldOption[];
}

export interface ModuleSaveOption {
  saveId: string;
  saveName: string;
  worldId: string;
  worldName: string;
  /** 正在游戏中的存档不能应用。 */
  active: boolean;
  /** 应用到这个存档时用的模块定义（在该世界启用时固定下来的版本）。 */
  module: CustomGameplayModuleDefinition;
}

type WorldLike = Pick<WorldDef, 'id' | 'name'>;

function emitModulesChanged(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event('custom-modules-changed'));
}

/** 模块当前在哪些世界启用、还能启用到哪些世界。模块不在本机时返回 undefined。 */
export async function getModuleWorldStatus(moduleId: string, worlds: readonly WorldLike[] = getAllWorlds()): Promise<ModuleWorldStatus | undefined> {
  const record = await getCustomGameplayModule(moduleId);
  if (!record) return undefined;
  const names = new Map(worlds.map(world => [world.id, world.name || world.id]));
  const enabledIds = record.status === 'enabled' ? record.worldIds : [];
  return {
    moduleId,
    moduleName: record.module.name,
    version: record.module.version,
    enabled: enabledIds.map(id => (names.has(id) ? { id, name: names.get(id)! } : { id, name: id, missing: true })),
    available: worlds.filter(world => !enabledIds.includes(world.id)).map(world => ({ id: world.id, name: world.name || world.id })),
  };
}

export async function enableModuleInWorld(moduleId: string, worldId: string): Promise<void> {
  await bindCustomGameplayModule(moduleId, worldId);
  emitModulesChanged();
}

export async function disableModuleInWorld(moduleId: string, worldId: string): Promise<void> {
  await disableCustomGameplayModuleForWorld(moduleId, worldId);
  emitModulesChanged();
}

/** 已启用世界里还没结束的存档，最近玩过的在前。 */
export async function listModuleSaveOptions(moduleId: string, worlds: readonly WorldLike[] = getAllWorlds()): Promise<ModuleSaveOption[]> {
  const record = await getCustomGameplayModule(moduleId);
  if (!record || record.status !== 'enabled') return [];
  const names = new Map(worlds.map(world => [world.id, world.name || world.id]));
  const options: Array<ModuleSaveOption & { timestamp: number }> = [];
  for (const worldId of record.worldIds) {
    const module = record.worldDefinitions?.[worldId] ?? record.module;
    for (const save of await listSaveModuleCandidates(worldId)) {
      options.push({ saveId: save.id, saveName: save.name, worldId, worldName: names.get(worldId) ?? worldId, active: save.active, module, timestamp: save.timestamp });
    }
  }
  return options.sort((left, right) => right.timestamp - left.timestamp).map(({ timestamp: _timestamp, ...option }) => option);
}
