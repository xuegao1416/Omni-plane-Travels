import type { ProgressionConfig } from '../modules/schema';
import { settleProgressionActivity } from '../gameplay/modules/progression';
import type { VariableManager } from './variableManager';

export interface ProgressionBaseline {
  tierIndex: number;
  currentXP: number;
}

export interface ProgressionSettlement {
  category: string;
  xpGained: number;
  tierBefore: number;
  tierAfter: number;
  xpBefore: number;
  xpAfter: number;
}

/**
 * 将正文行动交给统一成长模块结算。baseline 是本轮生成前的权威进度，
 * 避免 AI 同时改写经验后造成双重奖励。
 */
export function settleProgressionAction(
  manager: VariableManager,
  config: ProgressionConfig | undefined,
  userText: string,
  baseline: ProgressionBaseline,
  professionAbilityPointsPerTier?: number,
): ProgressionSettlement | null {
  if (!config) return null;
  const state = manager.getState();
  state.玩家.当前段位索引 = baseline.tierIndex;
  state.玩家.当前经验值 = baseline.currentXP;
  const tick = state.simulationRuntime?.tick ?? 0;
  const result = settleProgressionActivity(state, config, userText, {
    tick,
    enabledModules: ['progression'],
  }, { professionAbilityPointsPerTier });
  if (!result.settlement || result.execution.status !== 'applied') return null;

  manager.setState(result.execution.state);
  const settlement = result.settlement;
  const committed = manager.getState();
  if (committed.simulationRuntime) {
    committed.simulationRuntime.effectLog.push({
      tick,
      source: 'ai',
      module: 'progression',
      variable: 'xp',
      before: settlement.xpBefore,
      after: settlement.xpAfter,
      reason: `${settlement.activityLabel}行动固定经验 +${settlement.xpGained}`,
    });
    if (committed.simulationRuntime.effectLog.length > 100) {
      committed.simulationRuntime.effectLog = committed.simulationRuntime.effectLog.slice(-100);
    }
    manager.setState(committed);
  }

  return {
    category: settlement.activityId,
    xpGained: settlement.xpGained,
    tierBefore: settlement.tierBefore,
    tierAfter: settlement.tierAfter,
    xpBefore: settlement.xpBefore,
    xpAfter: settlement.xpAfter,
  };
}
