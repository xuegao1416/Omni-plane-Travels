import type { SimulationState } from '../simulation/types';
import type { GameSave } from './db';
import type { ChatMessage } from '../engine/types';
import type { WorldDef } from '../data/worlds-schema';
import { VariableManager } from '../engine/variableManager';
import { readTurnRecovery, recoveryVersion } from '../engine/turnRecovery';
import { getTimeSystemFromWorld } from '../time/worldClock';
import { findWorldDef } from '../data/worldLoader';
import type { GameState } from '../schema/variables';

/** Rebase scope guards, not historical event identities, when importing a copy. */
export function rebindImportedSimulation(state: SimulationState | undefined, saveId: string): SimulationState | undefined {
  if (!state) return undefined;
  const result = structuredClone(state);
  const visit = (snapshot: SimulationState) => {
    if (snapshot.director) {
      if (snapshot.director.pendingReview) snapshot.director.pendingReview.saveId = saveId;
      for (const directive of Object.values(snapshot.director.directives ?? {})) directive.saveId = saveId;
      for (const proposal of Object.values(snapshot.director.offscreenProposals ?? {})) proposal.saveId = saveId;
    }
    for (const child of snapshot.snapshots ?? []) if (child?.snapshot) visit(child.snapshot);
  };
  visit(result);
  return result;
}

/** Validate the source checkpoint before granting it the imported journey's identity. */
export function rebindImportedTurnRecovery(source: GameSave, target: GameSave): ChatMessage[] {
  const messages = structuredClone(target.messages);
  const rebindDecisions = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const state = value as Partial<GameState>;
    if (!Array.isArray(state.narrativeDecisions)) return;
    for (const decision of state.narrativeDecisions) if (decision && decision.status === 'pending' && decision.saveId === source.id) decision.saveId = target.id;
  };
  rebindDecisions(target.gameState);
  for (const message of messages) rebindDecisions(message.snapshot);
  const sourceLast = source.messages?.filter(message => message.role === 'assistant').at(-1);
  const recovery = readTurnRecovery(sourceLast?.turnRecovery);
  for (const message of messages) delete message.turnRecovery;
  if (!recovery || !sourceLast || recovery.aiMsgId !== sourceLast.id || recovery.rawText !== sourceLast.rawText
    || recovery.round !== sourceLast.round || recovery.saveId !== source.id || recovery.worldId !== source.worldId
    || recovery.settlement.narrativeDecisionRequest.saveId !== source.id
    || (recovery.settlement.world && recovery.settlement.world.id !== source.worldId)
    || recovery.memoryVersion !== recoveryVersion({ memoryRuntime: source.memoryRuntime ?? null, vectorMemory: source.vectorMemory ?? [] })) return messages;
  try {
    const sourceWorld = source.customWorld as unknown as WorldDef | undefined ?? findWorldDef(source.worldId);
    const original = VariableManager.fromJSON({ state: source.gameState, saveId: source.id, moduleStates: source.moduleStates,
      moduleCheckpoints: source.moduleCheckpoints }, getTimeSystemFromWorld(sourceWorld));
    if (recovery.stateVersion !== recoveryVersion(original.getState())) return messages;
    recovery.saveId = target.id; recovery.worldId = target.worldId;
    recovery.settlement.narrativeDecisionRequest.saveId = target.id;
    rebindDecisions(recovery.settlement.protectedState);
    if (recovery.settlement.world) recovery.settlement.world.id = target.worldId;
    const targetWorld = target.customWorld as unknown as WorldDef | undefined ?? findWorldDef(target.worldId);
    const imported = VariableManager.fromJSON({ state: target.gameState, saveId: target.id, moduleStates: target.moduleStates,
      moduleCheckpoints: target.moduleCheckpoints }, getTimeSystemFromWorld(targetWorld));
    recovery.stateVersion = recoveryVersion(imported.getState());
    const last = messages.filter(message => message.role === 'assistant').at(-1);
    if (last?.id === recovery.aiMsgId && last.rawText === recovery.rawText) last.turnRecovery = recovery;
  } catch { /* Invalid state cannot acquire a new recovery owner; the paid narrative is retained. */ }
  return messages;
}
