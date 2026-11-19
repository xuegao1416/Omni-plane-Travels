import { settleTurnCycles } from '../gameplay/settleTurnCycles';
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { PipelineResult } from './pipelineExecutor';
import { VariableManager } from './variableManager';
import { extractContentForPrompt } from './responseExtractor';
import { settleNarrativeResponse } from '../gameplay/narrativeDecision';
import { preserveCombatOwnedState } from '../gameplay/combatRuntime';
import { advanceWorldClockForTurn, ensureWorldClockOnGameState, formatWorldClock, getTimeSystemFromWorld, resolveTurnTimeAdvance, type WorldClockState } from '../time/worldClock';
import { GameplayHost, type HostOutcome } from '../core/host';
import type { ResourceChangeLog } from '../gameplay/settleTurnCycles';

export interface TurnSettlementInput {
  world?: WorldDef;
  /** 旧版恢复记录里的成长基线；现已不用，保留字段以便读取旧的回合恢复数据。 */
  progressionBaseline?: { tierIndex: number; currentXP: number };
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
  const { world: settlementWorld, narrativeDecisionRequest, internalContinuation } = input;
  const settlementManager = new VariableManager(state, undefined, getTimeSystemFromWorld(settlementWorld));
  settlementManager.bindWorld(settlementWorld);

  // Advance the authoritative clock exactly once, after a successful narrative turn.
  const mainResult = pipelineResult.mainResult;
  const mainContent = mainResult?.parsed.content?.trim() || extractContentForPrompt(mainResult?.text || '').trim();
  const clockBeforeTurn = structuredClone(settlementManager.getState().世界?.时间系统?.时钟) as WorldClockState | undefined;
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

  // 成长（行动经验、领域事件经验、升级发点）由玩法宿主的成长模块在回合结束时结算；
  // 经验变量不对 AI 开放，不再需要回退到回合开始时的基线。
  if (input.protectedState) {
    settlementManager.setState(preserveCombatOwnedState(settlementManager.getState(), input.protectedState!));
  }

  if (internalContinuation) return { state: settlementManager.getState(), changeLog: undefined, gameplay: undefined };
  const cycles = settleTurnCycles(settlementManager.getState(), settlementWorld, aiMsgId, round);
  // 本回合正文已经读过上一批结算备注；清空后再写入本回合结束产生的新备注。
  const consumed = structuredClone(cycles.state);
  GameplayHost.takeNotes(consumed);
  settlementManager.setState(consumed);
  const gameplay = settlementManager.gameplayHost().endTurn(settlementManager.getState(), {
    turnId: aiMsgId, round, userText, narrative: mainContent, previousClock: clockBeforeTurn,
  });
  return { state: gameplay.state, changeLog: resourceChangeLog(gameplay) ?? cycles.changeLog, gameplay };
}

/** 兼容 TURN_SETTLED 的旧载荷：把本回合的物资账本变化整理成变更日志。 */
function resourceChangeLog(outcome: HostOutcome): ResourceChangeLog | undefined {
  const before = new Map<string, number>();
  const changes: ResourceChangeLog['changes'] = [];
  for (const change of outcome.changes) {
    const match = /^resources\.stocks\.([^.]+)$/.exec(change.path);
    if (!match) continue;
    const id = match[1];
    const def = outcome.state.resources?.discovered?.[id];
    if (!before.has(id)) before.set(id, Number(change.before) || 0);
    changes.push({ resourceId: id, resourceName: def?.name ?? id, symbol: def?.symbol ?? '', before: Number(change.before) || 0, after: Number(change.after) || 0,
      reason: Number(change.after) < Number(change.before) ? '每日消耗' : '获得补给' });
  }
  return changes.length ? { tick: outcome.state.simulationRuntime?.tick ?? 0, timestamp: Date.now(), changes } : undefined;
}
