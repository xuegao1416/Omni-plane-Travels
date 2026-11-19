/**
 * dispatch.ts — 玩法结算结果交给外部：机械日志回执、战斗请求、界面刷新事件。
 * 回合开始、回合结算、玩家命令三条路径共用，Hook 里不再各写一份。
 */
import type { HostOutcome } from '../../core/host';
import type { PlayerCommandResult } from '../../core/playerCommands';
import { receiptCounts, recordSettlementReceipt } from '../../gameplay/mechanicalRuntime';
import { getSimulationEngine } from '../../simulation/SimulationApi';
import { useSimulationStore } from '../../stores/simulationStore';
import { eventBus, EVENTS } from '../eventBus';
import type { ResourceChangeLog } from '../../gameplay/settleTurnCycles';
import type { VariableManager } from '../variableManager';

export interface TurnRef {
  turnId: string;
  round: number;
  userText: string;
}

function publishCombats(outcome: HostOutcome): void {
  for (const request of outcome.combats) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, request);
}

/** 记回执，战斗请求交给战斗界面。事件卡已经在存档队列里，由事件卡浮层读取。 */
export function publishGameplayOutcome(outcome: HostOutcome, turn: Pick<TurnRef, 'round' | 'turnId'>): void {
  const engine = getSimulationEngine();
  const counts = receiptCounts(outcome);
  recordSettlementReceipt(engine.state, {
    round: turn.round, turnId: turn.turnId,
    time: outcome.state.世界?.时间系统?.当前时间 ?? '',
    tick: outcome.state.simulationRuntime?.tick ?? 0,
    ...counts,
  });
  engine.saveState();
  useSimulationStore.getState().syncFromEngine(engine.state);
  publishCombats(outcome);
}

/** 回合开始结算已写回：发布结果并让界面刷新。 */
export function announceTurnStart(outcome: HostOutcome, turn: TurnRef): void {
  publishGameplayOutcome(outcome, turn);
  eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
}

/** 本回合已结算：旧版 TURN_SETTLED 载荷、玩法结果、正文边界拦下的战斗、界面刷新。 */
export function announceAcceptedTurn(
  manager: VariableManager,
  accepted: { changeLog?: ResourceChangeLog; gameplay?: HostOutcome },
  turn: TurnRef,
  encounter?: unknown,
): void {
  eventBus.emit(EVENTS.TURN_SETTLED, manager, accepted.changeLog);
  if (accepted.gameplay) publishGameplayOutcome(accepted.gameplay, turn);
  if (encounter) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, encounter);
  eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
}

/** 玩家命令成功后：只把命令引出的战斗交出去（界面刷新由提交状态时统一发出）。 */
export function announcePlayerCommand(result: PlayerCommandResult): void {
  if (result.ok && result.outcome) publishCombats(result.outcome);
}
