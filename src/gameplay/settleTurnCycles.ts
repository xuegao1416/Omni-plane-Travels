import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
export interface ResourceChangeLog { tick: number; timestamp: number; changes: Array<{ resourceId: string; resourceName: string; symbol: string; before: number; after: number; reason: string }> }
import { isCombatInteractionPaused } from '../gameplay/combatRuntime';
import { prepareGameplayState } from '../gameplay/statePreparation';

/** Successful turn settlement belongs to the turn, never to React mount/event timing. */
export function settleTurnCycles(input: GameState, world: WorldDef | undefined, turnId: string, round: number) {
  if (!world || isCombatInteractionPaused(input)) return { state: input, changeLog: undefined };
  let state = prepareGameplayState(input, world.modules ?? [], { mode: 'load' }).state;
  // 经营的周期结算已移到经营模块（domains/economy），由 GameplayHost.endTurn 按世界时钟执行。
  // 生存物资的周期结算已移到资源模块（domains/resources），由 GameplayHost.endTurn 按世界时钟执行。
  const changeLog: ResourceChangeLog | undefined = undefined;
  return { state, changeLog };
}
