import type { GameState } from '../schema/variables';
import type { CustomModuleLifecycle } from './runtime';
import { executeCustomModuleInGame } from './hostRuntime';
import { buildCustomModuleHostContext, sanitizeCustomModuleEvent, type CustomModuleContextOptions } from './context';
import { pinCustomModuleDefinitions } from './saveDefinitions';

export interface CustomModuleBridgeResult {
  activeModuleIds: string[];
  applied: number;
  warnings: string[];
}
export interface CustomModuleLifecycleCommitCallbacks {
  commit: (gameState: GameState) => void;
  notify?: () => void;
  autoSave?: () => void;
  /** Re-read the owner's state after queued work, then refuse a stale commit. */
  getCurrentState?: () => GameState;
  isCurrent?: () => boolean;
}
export type CustomModuleBridgeContext = CustomModuleContextOptions & { eventId?: string };

export async function runCustomModulesForWorld(
  gameState: GameState,
  worldId: string,
  lifecycle: CustomModuleLifecycle,
  nowOrContext: number | CustomModuleBridgeContext = 0,
): Promise<CustomModuleBridgeResult> {
  const options: CustomModuleBridgeContext = typeof nowOrContext === 'number' ? {} : nowOrContext;
  if ((lifecycle === 'onChoice' && options.event?.type !== 'choice') || (lifecycle === 'onButton' && options.event?.type !== 'button')) return { activeModuleIds: [], applied: 0, warnings: [] };
  const warnings = [...await pinCustomModuleDefinitions(gameState, worldId)];
  const target = options.event?.type === 'button' ? options.event.moduleId : undefined;
  const modules = Object.entries(gameState.customModules ?? {}).filter(([id, state]) => state.enabled && state.definition && (!target || target === id));
  const now = typeof nowOrContext === 'number' ? nowOrContext : options.now ?? Date.now();
  // Explicit IDs identify retries. Each button dispatch is a distinct user intent.
  const eventId = options.eventId ?? (lifecycle === 'onGameStart' ? 'game-start'
    : lifecycle === 'onTurnEnd' ? `turn:${options.round ?? gameState.世界?.时间系统?.当前时间 ?? now}`
    : lifecycle === 'onChoice' ? `choice:${JSON.stringify(options.event)}:${options.round ?? gameState.世界?.时间系统?.当前时间 ?? ''}`
    : lifecycle === 'onTick' ? `tick:${now}` : `button:${crypto.randomUUID()}`);
  let applied = 0;
  for (const [id, state] of modules) {
    const context = buildCustomModuleHostContext(gameState, { ...options, event: sanitizeCustomModuleEvent(options.event) });
    const result = executeCustomModuleInGame(gameState, state.definition!, lifecycle, { eventId, now, context });
    Object.assign(gameState, result.gameState);
    applied += result.applied;
    warnings.push(...result.warnings.map(warning => `${id}: ${warning}`));
  }
  return { activeModuleIds: modules.map(([id]) => id), applied, warnings };
}

// Serialize lifecycle commits, then read the owner's latest state.
let pending: Promise<unknown> = Promise.resolve();
export function runCustomModulesForWorldAndCommit(
  gameState: GameState,
  worldId: string,
  lifecycle: CustomModuleLifecycle,
  nowOrContext: number | CustomModuleBridgeContext = 0,
  callbacks: CustomModuleLifecycleCommitCallbacks,
): Promise<CustomModuleBridgeResult> {
  const run = async (): Promise<CustomModuleBridgeResult> => {
    const stale = (): CustomModuleBridgeResult => ({ activeModuleIds: [], applied: 0, warnings: ['游戏状态已切换或变化，本次模块执行未提交。'] });
    if (callbacks.isCurrent?.() === false) return stale();
    const source = callbacks.getCurrentState?.() ?? gameState;
    const baseline = JSON.stringify(source);
    const draft = structuredClone(source);
    const result = await runCustomModulesForWorld(draft, worldId, lifecycle, nowOrContext);
    if (callbacks.isCurrent?.() === false || (callbacks.getCurrentState && JSON.stringify(callbacks.getCurrentState()) !== baseline)) return stale();
    if (baseline !== JSON.stringify(draft)) {
      Object.assign(gameState, draft);
      callbacks.commit(draft);
      callbacks.notify?.();
      callbacks.autoSave?.();
    }
    return result;
  };
  const result = pending.then(run, run);
  pending = result.catch(() => undefined);
  return result;
}

/** The engine has already accepted the mechanical clock before dispatching these lifecycles. */
export async function runCustomModuleTurnLifecycles(
  gameState: GameState, worldId: string,
  context: { round: number; tick: number; settled: boolean; time?: string; now?: number },
  callbacks: CustomModuleLifecycleCommitCallbacks,
): Promise<CustomModuleBridgeResult> {
  const combined: CustomModuleBridgeResult = { activeModuleIds: [], applied: 0, warnings: [] };
  for (const lifecycle of (context.settled ? ['onTick', 'onTurnEnd'] : ['onTurnEnd']) as CustomModuleLifecycle[]) {
    const result = await runCustomModulesForWorldAndCommit(gameState, worldId, lifecycle, {
      round: context.round, time: context.time, now: context.now,
      eventId: lifecycle === 'onTick' ? `tick:${context.tick}` : `turn:${context.round}`,
    }, callbacks);
    combined.activeModuleIds = [...new Set([...combined.activeModuleIds, ...result.activeModuleIds])];
    combined.applied += result.applied;
    combined.warnings.push(...result.warnings);
  }
  return combined;
}
