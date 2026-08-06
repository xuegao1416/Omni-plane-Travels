import type { GameState } from '../schema/variables';
import { executeCustomModuleLifecycle, type CustomModuleLifecycle } from './runtime';
import { installCustomModuleState } from './stateStore';
import { getCustomGameplayModulesForWorld } from './storage';

export interface CustomModuleBridgeResult {
  activeModuleIds: string[];
  applied: number;
  warnings: string[];
}

export interface CustomModuleLifecycleCommitCallbacks {
  commit: (gameState: GameState) => void;
  notify?: () => void;
  autoSave?: () => void;
}

/**
 * Connects persisted world bindings to the pure runtime. The bridge owns no
 * game rules and only replaces the cloned GameState passed by the caller.
 */
export async function runCustomModulesForWorld(
  gameState: GameState,
  worldId: string,
  lifecycle: CustomModuleLifecycle,
  now = 0,
): Promise<CustomModuleBridgeResult> {
  const active = await getCustomGameplayModulesForWorld(worldId);
  const warnings: string[] = [];
  let applied = 0;

  for (const record of active) {
    const current = installCustomModuleState(gameState, record.module, true);
    const result = executeCustomModuleLifecycle(record.module, current, lifecycle, { now });
    gameState.customModules![record.module.id] = result.nextState;
    applied += result.applied;
    warnings.push(...result.warnings.map((warning) => `${record.module.id}: ${warning}`));
  }

  return { activeModuleIds: active.map((record) => record.module.id), applied, warnings };
}

/**
 * Runs a lifecycle and commits its result before notifying consumers or saving.
 * The ordering is important for asynchronous tick lifecycles: a UI render or
 * auto-save must never observe the state from before the module ran.
 */
export async function runCustomModulesForWorldAndCommit(
  gameState: GameState,
  worldId: string,
  lifecycle: CustomModuleLifecycle,
  now = 0,
  callbacks: CustomModuleLifecycleCommitCallbacks,
): Promise<CustomModuleBridgeResult> {
  const result = await runCustomModulesForWorld(gameState, worldId, lifecycle, now);
  if (result.activeModuleIds.length > 0) {
    callbacks.commit(gameState);
    callbacks.notify?.();
    callbacks.autoSave?.();
  }
  return result;
}

