import type { GameState } from '../schema/variables';
import { getDB } from '../storage/db';
import { createInitialCustomModuleState, migrateCustomModuleState } from './stateStore';
import { listCustomGameplayModules, resolveCustomGameplayModulesForWorld } from './storage';
import { validateCustomGameplayModule } from './validator';

/** A once-only additive migration. Existing progress is never reset or initialized again. */
export async function pinCustomModuleDefinitions(gameState: GameState, worldId: string): Promise<string[]> {
  if (gameState.customModuleBindingsInitialized) return gameState.customModuleBindingWarnings ?? [];
  const [resolved, registry] = await Promise.all([resolveCustomGameplayModulesForWorld(worldId), listCustomGameplayModules()]);
  const warnings = [...resolved.warnings];
  const existing = gameState.customModules;
  if (existing && Object.keys(existing).length > 0) {
    for (const [id, current] of Object.entries(existing)) {
      const record = registry.find(record => record.module.id === id);
      const definition = current.definition ?? [record?.worldDefinitions?.[worldId], record?.module].find(candidate => candidate?.version === current.moduleVersion);
      const checked = definition && validateCustomGameplayModule(definition, 'internal');
      if (!checked || !checked.valid || !checked.normalized) {
        warnings.push(`模块 ${id} 的存档版本 ${current.moduleVersion} 定义缺失，请在工坊手动应用可用版本。`);
        continue;
      }
      const migrated = migrateCustomModuleState(current, checked.normalized);
      if (!migrated.state) { warnings.push(...migrated.conflicts.map(conflict => `${id}: ${conflict}`)); continue; }
      existing[id] = migrated.state;
    }
  } else {
    gameState.customModules = Object.fromEntries(resolved.modules.map(record => [record.module.id, createInitialCustomModuleState(record.module)]));
  }
  gameState.customModuleBindingsInitialized = true;
  gameState.customModuleBindingWarnings = warnings;
  return warnings;
}

/** Persist migration even if the player only loads and exits, including an empty binding set. */
export async function ensureSaveCustomModuleDefinitions(saveId: string): Promise<void> {
  const db = await getDB();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const original = await db.get('saves', saveId);
    if (!original || original.gameState?.customModuleBindingsInitialized) return;
    const next = structuredClone(original);
    await pinCustomModuleDefinitions(next.gameState, next.worldId);
    const tx = db.transaction('saves', 'readwrite');
    const current = await tx.store.get(saveId);
    if (JSON.stringify(current) !== JSON.stringify(original)) { await tx.done; continue; }
    await tx.store.put(next);
    await tx.done;
    return;
  }
  throw new Error('存档正在变化，暂时无法固定模块版本，请重试。');
}
