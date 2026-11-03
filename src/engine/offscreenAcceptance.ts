import type { GameState } from '../schema/variables';
import { executeGameplayTransaction, type GameplayEffect } from '../gameplay/kernel';
import { evaluateDependency } from '../director/align';
import { evolutionFactVersion } from '../simulation/turnCoordinator';
import type { DirectorReadContext, DirectorState, OffscreenEventProposal, OffscreenEventReceipt } from '../director/types';
import { isNpcDead } from '../utils/npcHelpers';

/** The variable owner rechecks current facts and commits through the normal transaction kernel. */
export function acceptOffscreenEvent(proposal: OffscreenEventProposal, gameState: GameState, director: DirectorState, currentStateVersion: string, context?: DirectorReadContext): { state: GameState; receipt: OffscreenEventReceipt } {
  const result = (status: OffscreenEventReceipt['status'], reason?: string, state = gameState): { state: GameState; receipt: OffscreenEventReceipt } => ({ state, receipt: {
    id: `offscreen_receipt:${proposal.logicalEventKey}`, proposalId: proposal.proposalId, logicalEventKey: proposal.logicalEventKey,
    status, reason, committedAt: status === 'accepted' ? Date.now() : undefined, stateVersion: currentStateVersion,
    consumers: { variables: status === 'accepted' ? 'done' : 'pending', memory: 'pending' },
  } });
  if (!context || context.saveId !== proposal.saveId || context.worldId !== proposal.worldId || context.completedTurnId !== proposal.basedOnTurnId) return result('rejected', 'scope_mismatch');
  const existing = director.offscreenReceipts[proposal.logicalEventKey];
  if (existing?.status === 'accepted') return { state: gameState, receipt: existing };
  if (proposal.baseStateVersion !== currentStateVersion || evolutionFactVersion(gameState) !== currentStateVersion) return result('rejected', 'base_state_version_mismatch');
  const plan = proposal.planId ? director.plans[proposal.planId] : undefined;
  if (!plan || plan.status !== 'ready' || plan.visibility === 'foreground') return result('rejected', 'plan_not_ready_for_offscreen');
  const actual = { ...context, stateVersion: currentStateVersion, variableProjection: gameState };
  if (plan.dependencies.some(dep => evaluateDependency(dep, director, actual) !== 'true')) return result('rejected', 'plan_precondition_not_true');
  // A declared `truth` is never evidence. Re-evaluate each extra read against live facts.
  if (proposal.prerequisites.some(dep => evaluateDependency(dep, director, actual) !== 'true')) return result('rejected', 'prerequisite_not_true');
  if (!proposal.description.trim() || !proposal.logicalEventKey.trim() || proposal.occurredAt !== gameState.世界.时间系统.当前时间) return result('rejected', 'invalid_event_time_or_description');
  for (const id of proposal.subjectIds) {
    if (id === 'player' || !Object.hasOwn(gameState.人物档案, id) || !plan.participants.includes(id) || id.includes('.') || ['__proto__', 'constructor', 'prototype'].includes(id)) return result('rejected', 'subject_missing');
    const npc = gameState.人物档案[id];
    if (npc.人物分类 !== '离场' || isNpcDead(npc)) return result('rejected', 'subject_present_or_dead');
  }
  const effects: GameplayEffect[] = [];
  if (proposal.kind === 'character_moved' || proposal.kind === 'character_injured') {
    if (proposal.subjectIds.length !== 1) return result('rejected', 'invalid_subject_count');
    const value = proposal.kind === 'character_moved' ? proposal.payload.location : proposal.payload.status;
    if (typeof value !== 'string' || !value.trim() || value.length > 500 || /死亡|身亡|复活/.test(value)) return result('rejected', 'invalid_payload');
    effects.push({ set: { path: `人物档案.${proposal.subjectIds[0]}.个人信息.${proposal.kind === 'character_moved' ? '当前位置' : '当前状态'}`, value } });
  } else if (proposal.kind !== 'world_event') return result('rejected', 'unsupported_event_kind');
  const transaction = executeGameplayTransaction(gameState, { id: `offscreen:${proposal.logicalEventKey}`, source: 'pipeline:offscreen', label: proposal.description, effects, events: [{ type: 'world.offscreen.accepted', payload: { eventId: proposal.logicalEventKey } }] }, { tick: gameState.simulationRuntime?.tick ?? 0 });
  if (transaction.status !== 'applied') return result('rejected', 'variable_transaction_rejected');
  return result('accepted', undefined, transaction.state as GameState);
}
