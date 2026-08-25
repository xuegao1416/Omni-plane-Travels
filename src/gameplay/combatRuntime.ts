import type { GameState } from '../schema/variables';
import type { NarrativeDecisionAction } from './narrativeDecision';
import type {
  CombatCommandInputV2,
  CombatEncounterProposal,
  CombatEncounterRequest,
  CombatResult,
  CombatSessionV2,
  CombatStateBindingV2,
} from './protocols';
import {
  applyCombatResultToSave,
  buildValidatedCombatRoster,
  createPreparingCombatSession,
  resolveCombatCommandV2,
  retryCombatSession,
  selectCombatants,
  settleCombatResult,
  startPreparedCombat,
  persistCombatSession,
  prepareCombatEncounterRequest,
  type CombatCheckpointRestore,
  type CombatSessionOptions,
} from './combatV2';
import { getGameplayPath, setGameplayPath } from './kernel';

function clone<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface V3CombatRuntimeResult {
  ok: boolean;
  state: GameState;
  session?: CombatSessionV2;
  errors: string[];
  alreadyProcessed?: boolean;
}

export interface V3CombatStartOptions extends CombatSessionOptions {
  seed: number;
}

export function isCombatFeatureEnabled(state: GameState): boolean {
  return state.v3?.featureFlags?.combatEnabled === true;
}

export function isCombatSaveEnded(state: GameState): boolean {
  const result = state.v3?.combatResult ?? state.v3?.combatSession?.result;
  if (state.v3?.featureFlags?.combatRiskMode !== 'inferno' || !result) return false;
  return result.report?.deaths.some(id => id === 'player' || result.report?.participants.some(unit => unit.id === id && unit.source === 'player')) === true;
}

/** Ordinary chat, world ticks, and memory writes are suspended while this is true. */
export function isCombatInteractionPaused(state: GameState): boolean {
  if (!isCombatFeatureEnabled(state)) return false;
  if (state.v3?.pendingEncounterRequest) return true;
  const session = state.v3?.combatSession;
  if (!session) return false;
  if (session.lifecycle === 'preparing' || session.lifecycle === 'active') return true;
  return session.result?.narration.status === 'pending' || session.result?.narration.status === 'failed'
    || state.v3?.combatResult?.narration.status === 'pending' || state.v3?.combatResult?.narration.status === 'failed';
}

function hasPendingCombat(state: GameState): boolean {
  if (state.v3?.pendingEncounterRequest) return true;
  const session = state.v3?.combatSession;
  if (!session) return false;
  return session.lifecycle !== 'terminal'
    || session.result?.narration.status === 'pending'
    || session.result?.narration.status === 'failed';
}

export function requestV3CombatEncounter(
  stateInput: GameState,
  request: CombatEncounterRequest | unknown,
  options: V3CombatStartOptions,
): V3CombatRuntimeResult {
  const state = clone(stateInput);
  if (!isCombatFeatureEnabled(state)) return { ok: false, state, errors: ['v3 战斗功能开关未启用'] };
  if (hasPendingCombat(state)) {
    const normalizedRequest = prepareCombatEncounterRequest(state, request);
    if (normalizedRequest.ok && normalizedRequest.plan?.proposal.id === state.v3?.combatSession?.encounter.id) {
      return { ok: true, state, session: state.v3?.combatSession, errors: [], alreadyProcessed: true };
    }
    return { ok: false, state, errors: ['已有未完成的 v3 战斗'] };
  }
  const validation = prepareCombatEncounterRequest(state, request);
  if (!validation.ok || !validation.plan) return { ok: false, state, errors: validation.errors };
  const session = createPreparingCombatSession(state, validation.plan, {
    ...options,
    riskMode: options.riskMode ?? state.v3?.featureFlags?.combatRiskMode ?? 'normal',
  });
  const next = persistCombatSession(state, session);
  return { ok: true, state: next, session, errors: [] };
}

/** Explicit UI/manual entry point; callers must provide a structured proposal. */
export function requestManualV3CombatEncounter(
  state: GameState,
  proposal: CombatEncounterProposal,
  options: V3CombatStartOptions,
): V3CombatRuntimeResult {
  return requestV3CombatEncounter(state, { schemaVersion: 2, source: 'manual', proposal }, options);
}

/** Resolve the proposal carried by a typed event-card action; no label parsing is involved. */
export function requestFromNarrativeAction(
  state: GameState,
  action: NarrativeDecisionAction,
  proposals: Record<string, CombatEncounterRequest>,
  options: V3CombatStartOptions,
): V3CombatRuntimeResult {
  if (action.type === 'combat.encounter.requested') return requestV3CombatEncounter(state, action.request, options);
  if (action.type !== 'start_combat') return { ok: false, state: clone(state), errors: ['不是发起 v3 战斗的类型化动作'] };
  const request = action.request ?? proposals[action.proposalId];
  if (!request) return { ok: false, state: clone(state), errors: ['类型化战斗动作缺少遭遇请求'] };
  return requestV3CombatEncounter(state, request, options);
}

export function startV3Combat(stateInput: GameState, selectedIds: string[]): V3CombatRuntimeResult {
  const state = clone(stateInput);
  const session = state.v3?.combatSession;
  if (!session || session.lifecycle !== 'preparing') return { ok: false, state, errors: ['当前没有等待编队的 v3 战斗'] };
  const selected = selectCombatants(session, selectedIds);
  if (!selected.ok || !selected.session) return { ok: false, state, errors: selected.errors };
  const active = startPreparedCombat(selected.session);
  const next = persistCombatSession(state, active);
  return { ok: true, state: next, session: active, errors: [] };
}

export function applyV3CombatCommand(stateInput: GameState, input: CombatCommandInputV2): V3CombatRuntimeResult {
  const state = clone(stateInput);
  const session = state.v3?.combatSession;
  if (!session || session.lifecycle !== 'active') return { ok: false, state, errors: ['当前没有可操作的 v3 战斗'] };
  const resolution = resolveCombatCommandV2(session, input);
  if (resolution.alreadyProcessed) return { ok: true, state, session, errors: [], alreadyProcessed: true };
  const next = persistCombatSession(state, resolution.session);
  return { ok: !resolution.record.rejected, state: next, session: resolution.session, errors: resolution.record.rejected ? [resolution.record.reason ?? '战斗行动被拒绝'] : [] };
}

export interface V3CombatRetryResult extends V3CombatRuntimeResult {
  restore?: CombatCheckpointRestore;
}

export function retryV3Combat(stateInput: GameState): V3CombatRetryResult {
  const state = clone(stateInput);
  const session = state.v3?.combatSession;
  if (!session) return { ok: false, state, errors: ['当前没有可重打的 v3 战斗'] };
  const retry = retryCombatSession(session);
  if (!retry.ok || !retry.session) return { ok: false, state, errors: [retry.reason ?? '战斗不能重打'] };
  // Return the full bundle to the caller and also make the pure state result ready
  // for atomic application. Messages/memory/simulation/module stores are applied by
  // the runtime owner because they do not live inside GameState.
  const restoredState = retry.restore?.gameState ? clone(retry.restore.gameState) : state;
  const next = persistCombatSession(restoredState, retry.session);
  return { ok: true, state: next, session: retry.session, restore: retry.restore, errors: [] };
}

function setNarrationState(stateInput: GameState, resultInput: CombatResult, status: CombatResult['narration']['status'], attempts: number, error?: string): GameState {
  const state = clone(stateInput);
  const result: CombatResult = {
    ...clone(resultInput),
    narration: {
      ...clone(resultInput.narration),
      status,
      attempts,
      ...(resultInput.terminalTransactionId ? { requestId: `${resultInput.terminalTransactionId}:narration` } : {}),
      ...(error ? { error } : {}),
    },
  };
  state.v3 = { ...(state.v3 ?? { schemaVersion: 3, featureFlags: { professionsEnabled: false, combatEnabled: true, combatRiskMode: 'normal' } }), combatResult: result };
  if (state.v3.combatSession) state.v3.combatSession = { ...state.v3.combatSession, result };
  return state;
}

export function buildCombatContinuationPrompt(result: CombatResult): string {
  return [
    '请承接刚刚结束的战斗。以下是本地确定性机械战报，只能叙述其中已发生的事实。',
    '禁止重算伤害、修改胜负、复活角色、改变伤势或再次发放奖励。',
    '请直接写出完整的中文承接正文，不要道歉，不要解释规则，也不要返回空内容。若当前预设要求正文标签，请把正文放入 <contenttext> 中。',
    '【CombatResult】',
    JSON.stringify(result.report ?? result),
  ].join('\n');
}

/** Provider-side empty replies must never strand a completed local battle. */
export function buildLocalCombatContinuation(result: CombatResult): string {
  const report = result.report;
  const statusText = { victory: '战斗以我方胜利告终', defeat: '战斗以我方败退告终', escaped: '众人成功脱离了战场', draw: '双方暂时未能分出胜负' }[result.status];
  if (!report) return `${statusText}。尘埃渐渐落定，旅程从战斗结束后的这一刻继续。`;
  const allies = report.participants.filter(unit => unit.side !== 'enemy').map(unit => unit.identity).join('、') || '我方';
  const enemies = report.participants.filter(unit => unit.side === 'enemy').map(unit => unit.identity).join('、') || '敌方';
  const injuries = report.injuries.map(item => report.participants.find(unit => unit.id === item.unitId)?.identity).filter(Boolean);
  const injuryText = injuries.length ? `，${injuries.join('、')}带着战斗留下的伤势` : '';
  return `${statusText}。${allies}与${enemies}的交锋已经落幕${injuryText}。四周重新安静下来，眼前的局势也随这场战斗有了新的走向。`;
}

export type CombatNarrationGateway = (prompt: string, result: CombatResult, protectedState: GameState) => Promise<string | null | undefined>;

export interface CombatNarrationOutcome {
  state: GameState;
  result: CombatResult;
  duplicate: boolean;
}

/** Local settlement is completed before the single model continuation begins. */
export class CombatNarrationCoordinator {
  private readonly inFlight = new Set<string>();

  async continue(stateInput: GameState, gateway: CombatNarrationGateway, persistPending?: (state: GameState) => Promise<void> | void): Promise<CombatNarrationOutcome> {
    const state = clone(stateInput);
    const session = state.v3?.combatSession;
    if (!session || session.lifecycle !== 'terminal') throw new Error('战斗尚未进入终局');
    const settled = settleCombatResult(state, session);
    const settledState = settled.state;
    const result = settled.result;
    if (result.narration.status === 'succeeded') return { state: settledState, result, duplicate: false };
    const transactionId = result.terminalTransactionId ?? `${session.id}:terminal`;
    if (this.inFlight.has(transactionId)) return { state: settledState, result, duplicate: true };
    this.inFlight.add(transactionId);
    const attemptState = setNarrationState(settledState, result, 'pending', result.narration.attempts + 1);
    try {
      await persistPending?.(attemptState);
      const text = await gateway(buildCombatContinuationPrompt(result), result, attemptState);
      if (!text?.trim()) {
        const failedState = setNarrationState(attemptState, result, 'failed', attemptState.v3?.combatResult?.narration.attempts ?? result.narration.attempts, '主模型返回空正文');
        return { state: failedState, result: failedState.v3!.combatResult!, duplicate: false };
      }
      const succeededState = setNarrationState(attemptState, result, 'succeeded', attemptState.v3?.combatResult?.narration.attempts ?? result.narration.attempts);
      return { state: succeededState, result: succeededState.v3!.combatResult!, duplicate: false };
    } catch (error) {
      const failedState = setNarrationState(attemptState, result, 'failed', attemptState.v3?.combatResult?.narration.attempts ?? result.narration.attempts, error instanceof Error ? error.message : String(error));
      return { state: failedState, result: failedState.v3!.combatResult!, duplicate: false };
    } finally {
      this.inFlight.delete(transactionId);
    }
  }
}

/** Keep combat-owned slices authoritative after the normal narration variable pipeline. */
export function preserveCombatOwnedState(stateInput: GameState, authoritativeInput: GameState): GameState {
  const state = clone(stateInput);
  const authoritative = authoritativeInput;
  if (!authoritative.v3) return state;
  state.v3 = {
    ...(state.v3 ?? {}),
    schemaVersion: 3,
    featureFlags: clone(authoritative.v3.featureFlags),
    ...(authoritative.v3.combatSession ? { combatSession: clone(authoritative.v3.combatSession) } : {}),
    ...(authoritative.v3.combatResult ? { combatResult: clone(authoritative.v3.combatResult) } : {}),
    ...(authoritative.v3.pendingEncounterRequest ? { pendingEncounterRequest: clone(authoritative.v3.pendingEncounterRequest) } : {}),
    ...(authoritative.v3.abilityDefinitions ? { abilityDefinitions: clone(authoritative.v3.abilityDefinitions) } : {}),
    ...(authoritative.v3.abilityInstances ? { abilityInstances: clone(authoritative.v3.abilityInstances) } : {}),
  };
  if (!authoritative.v3.pendingEncounterRequest) delete state.v3.pendingEncounterRequest;
  const session = authoritative.v3.combatSession;
  const bindings: CombatStateBindingV2[] = session
    ? [...(session.participants ?? []), ...(session.resolvedParticipants ?? [])].map(unit => unit.stateBinding).filter((binding): binding is CombatStateBindingV2 => Boolean(binding))
    : [];
  for (const binding of bindings) {
    for (const path of [binding.hpPath, binding.resourcePath, binding.inventoryPath, binding.injuryPath]) {
      if (!path) continue;
      const value = getGameplayPath(authoritative, path);
      if (value !== undefined) setGameplayPath(state, path, value, false);
    }
  }
  if (authoritative.玩家.能力系统) {
    state.玩家.能力系统 = clone(authoritative.玩家.能力系统);
  }
  return state;
}

export { applyCombatResultToSave };
