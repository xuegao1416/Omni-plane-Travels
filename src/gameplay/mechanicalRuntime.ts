/**
 * 玩法结算回执。
 *
 * 确定性结算全部由玩法宿主完成（回合开始 startTurn、回合结束 endTurn），
 * 这里只在结果提交后记一张回执，供「世界动态 → 机械日志」逐轮展示。不发起任何模型请求。
 */
import type { SimulationState } from '../simulation/types';
import type { HostOutcome } from '../core/host';

export interface TurnSettlementReceipt {
  round: number;
  turnId: string;
  /** 世界时间文本。 */
  time: string;
  /** 当前回合数（simulationRuntime.tick）。 */
  tick: number;
  /** 本次结算的玩法变量变化数。 */
  effectCount: number;
  /** 本次结算产生的事件卡与战斗请求数。 */
  notificationCount: number;
}

/** 从宿主结果统计回执数字。 */
export function receiptCounts(outcome: Pick<HostOutcome, 'changes' | 'cards' | 'combats'>): { effectCount: number; notificationCount: number } {
  return { effectCount: outcome.changes.length, notificationCount: outcome.cards.length + outcome.combats.length };
}

/**
 * 记录一次已提交的结算（写进推演状态的 mechanics，供机械日志展示）。同一回合的开始与结束合并成一张回执；
 * 重复记录同一回合同一阶段由调用方保证不会发生（宿主按 turnId 拒绝重复结算）。
 * 剧情导演不再承担机械结算：它只保存这份状态，回执由引擎的结果分发（engine/turn/dispatch.ts）写入。
 */
export function recordSettlementReceipt(state: SimulationState, receipt: TurnSettlementReceipt): void {
  const previous = state.mechanics;
  const sameTurn = previous?.lastTurnId === receipt.turnId;
  const base = sameTurn ? previous?.lastSettlement : undefined;
  state.mechanics = {
    lastTurnId: receipt.turnId,
    lastRound: receipt.round,
    lastTime: receipt.time,
    tickCount: Math.max(0, Math.trunc(receipt.tick)),
    lastSettlement: {
      round: receipt.round,
      turnId: receipt.turnId,
      time: receipt.time,
      effectCount: (base?.effectCount ?? 0) + receipt.effectCount,
      notificationCount: (base?.notificationCount ?? 0) + receipt.notificationCount,
      origin: 'live',
    },
  };
}
