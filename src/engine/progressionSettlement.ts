import type { ProgressionConfig } from '../modules/schema';
import { calculateXpForLevel } from '../modules/xpAlgorithm';
import type { VariableManager } from './variableManager';

export interface ProgressionBaseline {
  tierIndex: number;
  currentXP: number;
}

export interface ProgressionSettlement {
  category: 'combat' | 'training' | 'exploration';
  xpGained: number;
  tierBefore: number;
  tierAfter: number;
  xpBefore: number;
  xpAfter: number;
}

const ACTION_RULES: Array<{
  category: ProgressionSettlement['category'];
  rate: number;
  pattern: RegExp;
}> = [
  {
    category: 'combat',
    rate: 0.1,
    pattern: /攻击|迎战|战斗|交战|出招|挥剑|挥刀|砍击|刺击|射击|开火|施法攻击|突袭|反击|格挡|闪避|搏斗|击杀|斩杀|attack|fight|shoot|strike/i,
  },
  {
    category: 'training',
    rate: 0.08,
    pattern: /训练|修炼|练习|学习|钻研|冥想|锻炼|研习|闭关|train|practice|study/i,
  },
  {
    category: 'exploration',
    rate: 0.05,
    pattern: /探索|调查|解谜|追踪|侦查|采集|制作|交涉|谈判|寻找|冒险|explore|investigate|craft|search/i,
  },
];

function maxTierIndex(config: ProgressionConfig): number {
  if (config.mode === 'level') return Math.max(0, config.levelData?.maxLevel ?? 0);
  return Math.max(0, (config.tiers?.length ?? 1) - 1);
}

function xpRequiredForNextTier(tierIndex: number, config: ProgressionConfig): number {
  if (tierIndex >= maxTierIndex(config)) return Infinity;
  const formula = config.xpFormula;
  if (!formula?.baseXP || !formula?.exponent || !formula?.scaleFactor) return Infinity;
  return Math.max(1, calculateXpForLevel(tierIndex + 1, formula));
}

/**
 * 对明确的成长型玩家行动做本地确定性结算。
 * 同类行动始终按“下一级所需经验”的固定比例奖励，不再交给 AI 随机决定。
 */
export function settleProgressionAction(
  manager: VariableManager,
  config: ProgressionConfig | undefined,
  userText: string,
  baseline: ProgressionBaseline,
): ProgressionSettlement | null {
  if (!config) return null;
  const rule = ACTION_RULES.find(item => item.pattern.test(userText));
  if (!rule) return null;

  const firstThreshold = xpRequiredForNextTier(baseline.tierIndex, config);
  if (!Number.isFinite(firstThreshold)) return null;
  const xpGained = Math.max(1, Math.round(firstThreshold * rule.rate));

  let tierIndex = baseline.tierIndex;
  let currentXP = Math.max(0, baseline.currentXP) + xpGained;
  const maxIndex = maxTierIndex(config);

  while (tierIndex < maxIndex) {
    const threshold = xpRequiredForNextTier(tierIndex, config);
    if (!Number.isFinite(threshold) || currentXP < threshold) break;
    currentXP -= threshold;
    tierIndex += 1;
  }

  const state = manager.getState();
  state.玩家.当前段位索引 = tierIndex;
  state.玩家.当前经验值 = currentXP;

  if (state.simulationRuntime) {
    state.simulationRuntime.effectLog.push({
      tick: state.simulationRuntime.tick ?? 0,
      source: 'ai',
      module: 'progression',
      variable: 'xp',
      before: baseline.currentXP,
      after: currentXP,
      reason: `${rule.category} 行动固定经验 +${xpGained}`,
    });
    if (state.simulationRuntime.effectLog.length > 100) {
      state.simulationRuntime.effectLog = state.simulationRuntime.effectLog.slice(-100);
    }
  }

  manager.setState(state);
  return {
    category: rule.category,
    xpGained,
    tierBefore: baseline.tierIndex,
    tierAfter: tierIndex,
    xpBefore: baseline.currentXP,
    xpAfter: currentXP,
  };
}
