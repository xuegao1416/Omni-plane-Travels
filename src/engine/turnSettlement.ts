import { settleTurnCycles } from '../gameplay/settleTurnCycles';
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { PipelineResult } from './pipelineExecutor';
import { VariableManager } from './variableManager';
import { extractContentForPrompt } from './responseExtractor';
import { settleNarrativeResponse } from '../gameplay/narrativeDecision';
import { preserveCombatOwnedState } from '../gameplay/combatRuntime';
import { isProfessionModuleEnabled } from '../gameplay/profession/featureGate';
import { resolveProfessionBinding } from '../data/professions';
import { settleProgressionAction, type ProgressionBaseline } from './progressionSettlement';
import { advanceWorldClockForTurn, ensureWorldClockOnGameState, formatWorldClock, getTimeSystemFromWorld, resolveTurnTimeAdvance } from '../time/worldClock';

export interface TurnSettlementInput {
  world?: WorldDef;
  progressionBaseline: ProgressionBaseline;
  narrativeDecisionRequest: { saveId: string; decisionIds: string[] };
  internalContinuation: boolean;
  protectedState?: GameState;
  done: boolean;
  modulesDone?: boolean;
  mechanicalTickSettled?: boolean;
  encounter?: import('../gameplay/protocols').CombatEncounterRequest;
}

/** The same deterministic settlement runs after generation and after durable recovery. */
export function settleAcceptedTurn(state: GameState, input: TurnSettlementInput, pipelineResult: PipelineResult, aiMsgId: string, round: number, userText: string) {
  const { world: settlementWorld, progressionBaseline, narrativeDecisionRequest, internalContinuation } = input;
  const settlementManager = new VariableManager(state, undefined, getTimeSystemFromWorld(settlementWorld));

  // 战斗、训练、探索类成长由本地固定规则结算，不再让辅助 AI 随机决定经验。
  // 只覆盖这些明确类别；任务奖励等其他来源仍保留各自的结构化更新。
  // Advance the authoritative clock exactly once, after a successful narrative turn.
  const mainResult = pipelineResult.mainResult;
  const mainContent = mainResult?.parsed.content?.trim() || extractContentForPrompt(mainResult?.text || '').trim();
  if (pipelineResult.status.stages.main.status === 'success' && mainContent) {
    let narrativeState = settleNarrativeResponse(settlementManager.getState(), {
      status: 'success',
      narrativeId: aiMsgId,
      content: mainContent,
      saveId: narrativeDecisionRequest.saveId,
      decisionIds: narrativeDecisionRequest.decisionIds,
    });
    if (input.protectedState) {
      narrativeState = preserveCombatOwnedState(narrativeState, input.protectedState!);
    }
    settlementManager.setState(narrativeState);
    if (!internalContinuation) {
      const stateBeforeClock = settlementManager.getState();
      const worldDefForClock = settlementWorld;
      const clockConfigForTurn = getTimeSystemFromWorld(worldDefForClock);
      ensureWorldClockOnGameState(stateBeforeClock, worldDefForClock);
      const currentClock = stateBeforeClock.世界.时间系统.时钟!;
      const suggestion = resolveTurnTimeAdvance({
        rawResponse: mainResult?.text || '',
        narrativeText: mainContent,
        userText,
        clock: currentClock,
        config: clockConfigForTurn,
      });
      if (suggestion && suggestion.minutes > 0) {
        const nextClock = advanceWorldClockForTurn(currentClock, clockConfigForTurn, suggestion.minutes, {
          reason: suggestion.reason,
          source: suggestion.source === 'player-explicit' ? 'local-estimate' : 'ai',
          turnId: aiMsgId,
          round,
        });
        if (nextClock.elapsedMinutes !== currentClock.elapsedMinutes) {
          stateBeforeClock.世界.时间系统.时钟 = nextClock;
          stateBeforeClock.世界.时间系统.当前时间 = formatWorldClock(nextClock, clockConfigForTurn);
          settlementManager.setState(stateBeforeClock);
        }
      }
    }
  }

  const progressionModule = settlementWorld?.modules
    ?.find(m => m.moduleId === 'progression' && m.enabled);
  const progressionConfigBase = (
    progressionModule?.moduleConfig
  ) as unknown as import('../modules/schema').ProgressionConfig | undefined;
  const talentModule = settlementWorld?.modules
    ?.find(m => m.moduleId === 'talent' && m.enabled);
  const talentConfig = (talentModule?.moduleConfig) as import('../modules/schema').TalentModuleSchema | undefined;
  const worldForSettlement = settlementWorld;
  const professionModule = isProfessionModuleEnabled(worldForSettlement) ? worldForSettlement?.modules
    ?.find(m => m.moduleId === 'profession' && m.enabled) : undefined;
  const professionConfig = professionModule ? resolveProfessionBinding(professionModule.moduleConfig) : undefined;
  const progressionConfig = progressionConfigBase ? {
    ...progressionConfigBase,
    pointsPerTier: {
      ...progressionConfigBase.pointsPerTier,
      ...(!professionModule && talentModule ? {
        talent: progressionConfigBase.pointsPerTier?.talent
          ?? talentConfig?.pointRules?.talentPointsPerTier
          ?? 1,
        skill: progressionConfigBase.pointsPerTier?.skill
          ?? talentConfig?.pointRules?.skillPointsPerTier
          ?? ((talentConfig?.skills?.length ?? 0) > 0 ? 1 : 0),
      } : {}),
    },
  } : undefined;
  if (!internalContinuation && pipelineResult.status.stages.main.status === 'success' && mainContent) {
    settleProgressionAction(
      settlementManager,
      progressionConfig,
      userText,
      progressionBaseline,
      professionConfig?.abilityPointsPerTier,
    );
  }

  if (input.protectedState) {
    settlementManager.setState(preserveCombatOwnedState(settlementManager.getState(), input.protectedState!));
  }

  return internalContinuation ? { state: settlementManager.getState(), changeLog: undefined } : settleTurnCycles(settlementManager.getState(), settlementWorld, aiMsgId, round);
}
