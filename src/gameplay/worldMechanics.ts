import type { WorldDef } from '../data/worlds-schema';
import type { GameState } from '../schema/variables';
import type { MechanicalRuntime } from './mechanicalRuntime';
import type { MechanicsSettlement } from '../simulation/types';
import { createDefaultWorldDynamics } from '../modules/defaults';

export interface WorldMechanicsInput {
  gameState: GameState;
  world?: WorldDef;
  round: number;
  turnId: string;
}

/**
 * Deterministic gameplay/mechanical settlement. This path is intentionally
 * independent from the Director/background-AI toggle: disabling the Director
 * must never disable time/resource/event mechanics.
 */
export async function prepareWorldMechanics(
  engine: MechanicalRuntime,
  input: WorldMechanicsInput,
): Promise<MechanicsSettlement> {
  const world = input.world;
  const gameTime = { current: input.gameState.世界?.时间系统?.当前时间 ?? '' };
  const simRulesMod = world?.modules?.find(m => m.moduleId === 'simulation' && m.enabled);
  const simRules = (simRulesMod?.moduleConfig as import('../modules/schema').WorldDynamics | undefined) ?? createDefaultWorldDynamics();
  const survivalMod = world?.modules?.find(m => m.moduleId === 'survival' && m.enabled);
  const resources = (survivalMod?.moduleConfig as { resourceEvolution?: import('../modules/schema').ResourceEvolutionStep[] } | undefined)?.resourceEvolution;
  return engine.settleMechanics(
    input.gameState,
    gameTime,
    input.round,
    world?.description ?? world?.name ?? '未知世界',
    simRules,
    resources,
    input.turnId,
  );
}

export async function commitWorldMechanics(
  engine: MechanicalRuntime & { saveState: () => void },
  settlement: MechanicsSettlement,
  isCurrent: () => boolean,
): Promise<boolean> {
  if (!settlement.settled || !isCurrent()) return false;
  if (!engine.commitMechanics(settlement)) return false;
  await engine.publishMechanicalEvents(settlement, isCurrent);
  engine.saveState();
  return true;
}
