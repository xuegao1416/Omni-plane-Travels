import type { GameState } from '../schema/variables';
import { executeCustomModuleLifecycle, type CustomModuleLifecycle } from './runtime';
import { installCustomModuleState } from './stateStore';
import { getCustomGameplayModulesForWorld } from './storage';
import { buildCustomModuleHostContext, sanitizeCustomModuleEvent, type CustomModuleContextOptions } from './context';

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

export type CustomModuleBridgeContext = CustomModuleContextOptions;

/**
 * Connects persisted world bindings to the pure runtime. The bridge owns no
 * game rules and only replaces the cloned GameState passed by the caller.
 */
export async function runCustomModulesForWorld(
  gameState: GameState,
  worldId: string,
  lifecycle: CustomModuleLifecycle,
  nowOrContext: number | CustomModuleBridgeContext = 0,
): Promise<CustomModuleBridgeResult> {
  const contextOptions: CustomModuleContextOptions = typeof nowOrContext === 'number' ? {} : nowOrContext;
  if (lifecycle === 'onChoice' && contextOptions.event?.type !== 'choice') {
    return { activeModuleIds: [], applied: 0, warnings: [] };
  }
  if (lifecycle === 'onButton' && contextOptions.event?.type !== 'button') {
    return { activeModuleIds: [], applied: 0, warnings: [] };
  }

  const active = await getCustomGameplayModulesForWorld(worldId);
  const warnings: string[] = [];
  let applied = 0;

  const now = typeof nowOrContext === 'number' ? nowOrContext : contextOptions.now ?? Date.now();
  const context = buildCustomModuleHostContext(gameState, {
    ...contextOptions,
    event: sanitizeCustomModuleEvent(contextOptions.event),
  });
  const buttonModuleId = contextOptions.event?.type === 'button' ? contextOptions.event.moduleId : undefined;
  const activeForLifecycle = lifecycle === 'onButton' && buttonModuleId
    ? active.filter((record) => record.module.id === buttonModuleId)
    : active;

  for (const record of activeForLifecycle) {
    const current = installCustomModuleState(gameState, record.module, true);
    const result = executeCustomModuleLifecycle(record.module, current, lifecycle, { now, context });
    gameState.customModules![record.module.id] = result.nextState;
    applied += result.applied;
    warnings.push(...result.warnings.map((warning) => `${record.module.id}: ${warning}`));
  }

  return { activeModuleIds: activeForLifecycle.map((record) => record.module.id), applied, warnings };
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
  nowOrContext: number | CustomModuleBridgeContext = 0,
  callbacks: CustomModuleLifecycleCommitCallbacks,
): Promise<CustomModuleBridgeResult> {
  const result = await runCustomModulesForWorld(gameState, worldId, lifecycle, nowOrContext);
  if (result.activeModuleIds.length > 0) {
    callbacks.commit(gameState);
    callbacks.notify?.();
    callbacks.autoSave?.();
  }
  return result;
}

