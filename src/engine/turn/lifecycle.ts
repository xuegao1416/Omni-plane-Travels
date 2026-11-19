/**
 * lifecycle.ts — 一个回合的确定性结算步骤：回合开始（正文之前）与回合结算（正文、变量都被接受之后）。
 * 正常发送与“恢复未完成回合”走同一套函数，不会各算一遍。
 */
import type { HostOutcome } from '../../core/host';
import type { PipelineResult } from '../pipelineExecutor';
import { settleAcceptedTurn, type TurnSettlementInput } from '../turnSettlement';
import type { VariableManager } from '../variableManager';
import { announceAcceptedTurn, announceTurnStart, type TurnRef } from './dispatch';

export type { TurnRef } from './dispatch';

/**
 * 回合开始结算：推进回合数、投放到期事件、触发监听回合开始的规则。
 * 产生结果时已写回管理器并发布；同一回合重复调用时宿主直接返回 blocked。
 */
export function beginTurn(manager: VariableManager, turn: TurnRef, options: { assertCurrent?: () => void } = {}): HostOutcome | null {
  const started = manager.gameplayHost().startTurn(manager.getState(), { turnId: turn.turnId, round: turn.round, userText: turn.userText });
  // 计算期间回合可能已被取消：先确认仍是当前回合再写回。
  options.assertCurrent?.();
  if (started.status !== 'applied') return null;
  manager.setState(started.state);
  announceTurnStart(started, turn);
  return started;
}

/** 正文成功且有内容；开启变量提取时，变量阶段必须成功或被跳过。 */
export function readyToSettle(result: PipelineResult, variableEnabled: boolean): boolean {
  if (result.status.stages.main.status !== 'success' || !result.mainResult?.parsed.content?.trim()) return false;
  return !variableEnabled || ['success', 'skipped'].includes(result.status.stages.variable.status);
}

/**
 * 正文、变量都被接受后结算本回合：叙事决策、世界时钟、回合周期、宿主回合结束。
 * 每个回合只结算一次（settlement.done）；返回本次是否真的结算了。
 */
export function settleTurnOnce(
  manager: VariableManager,
  settlement: TurnSettlementInput,
  result: PipelineResult,
  turn: TurnRef,
  options: { variableEnabled: boolean; encounter?: unknown },
): boolean {
  if (settlement.done || !readyToSettle(result, options.variableEnabled)) return false;
  const accepted = settleAcceptedTurn(manager.getState(), settlement, result, turn.turnId, turn.round, turn.userText);
  manager.setState(accepted.state);
  settlement.done = true;
  announceAcceptedTurn(manager, accepted, turn, options.encounter ?? settlement.encounter);
  return true;
}
