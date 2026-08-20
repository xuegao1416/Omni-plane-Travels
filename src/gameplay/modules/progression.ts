import type { GameState } from '../../schema/variables';
import type { ProgressionConfig } from '../../modules/schema';
import { calculateXpForLevel } from '../../modules/xpAlgorithm';
import {
  executeGameplayTransaction,
  type GameplayExecutionContext,
  type GameplayExecutionResult,
  type GameplayStateRoot,
} from '../kernel';

const DEFAULT_ACTIVITY_REWARDS: NonNullable<ProgressionConfig['activityRewards']> = [
  { id: 'combat', label: '战斗', rate: 0.1, keywords: ['攻击', '战斗', '迎战', '交战', '反击', '击杀'] },
  { id: 'training', label: '训练', rate: 0.08, keywords: ['训练', '修炼', '练习', '学习', '研习', '锻炼'] },
  { id: 'exploration', label: '探索', rate: 0.05, keywords: ['探索', '调查', '解谜', '追踪', '采集', '制作', '交涉'] },
];

export interface ProgressionActivitySettlement {
  activityId: string;
  activityLabel: string;
  xpGained: number;
  tierBefore: number;
  tierAfter: number;
  xpBefore: number;
  xpAfter: number;
}

export interface ProgressionActivityResult {
  execution: GameplayExecutionResult<GameState & GameplayStateRoot>;
  settlement: ProgressionActivitySettlement | null;
}

export interface ProgressionRewardPolicy {
  /**
   * 新职业体系每次晋级发放的职业能力点。它来自独立职业包，不能再借用
   * 旧天赋模块的 skillPointsPerTier，否则两套技能状态会重新混在一起。
   */
  professionAbilityPointsPerTier?: number;
}

function maxTierIndex(config: ProgressionConfig): number {
  return config.mode === 'level'
    ? Math.max(0, Math.trunc(config.levelData?.maxLevel ?? 0))
    : Math.max(0, (config.tiers?.length ?? 1) - 1);
}

function thresholdFor(tierIndex: number, config: ProgressionConfig): number {
  if (tierIndex >= maxTierIndex(config)) return Infinity;
  if (config.mode === 'tiered') {
    const explicit = Number(config.tiers?.[tierIndex + 1]?.xpRequired);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
  }
  const formula = config.xpFormula;
  if (!formula || formula.baseXP <= 0 || formula.exponent <= 0 || formula.scaleFactor <= 0) return Infinity;
  return Math.max(1, calculateXpForLevel(tierIndex + 1, formula));
}

export function breakthroughProgression(
  state: GameState,
  config: ProgressionConfig,
  targetTier: number,
  context: GameplayExecutionContext,
  rewardPolicy: ProgressionRewardPolicy = {},
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const gate = config.breakthroughs?.find(item => item.tierIndex === targetTier);
  const currentTier = Math.max(0, Math.trunc(state.玩家.当前段位索引 ?? 0));
  const currentXP = Math.max(0, Number(state.玩家.当前经验值 ?? 0));
  const requiredXP = thresholdFor(currentTier, config);
  if (!gate || targetTier !== currentTier + 1 || (Number.isFinite(requiredXP) && currentXP < requiredXP)) {
    return blockedProgression(state, context, `progression:breakthrough:blocked:${targetTier}:${context.tick}`);
  }
  const abilityState = state.玩家.能力系统;
  const professionRuntime = abilityState?.职业状态;
  const points = config.pointsPerTier ?? {};
  const professionPoints = professionRuntime?.职业ID
    ? Math.max(0, Number(rewardPolicy.professionAbilityPointsPerTier) || 0)
    : 0;
  return executeGameplayTransaction(state, {
    id: `progression:breakthrough:${targetTier}:${context.tick}`, moduleId: 'progression', source: 'player',
    label: gate.description ?? `突破至${targetTier}`,
    conditions: gate.conditions,
    costs: gate.costs,
    effects: [
      { set: { path: '玩家.当前段位索引', value: targetTier } },
      { set: { path: '玩家.当前经验值', value: Number.isFinite(requiredXP) ? Math.max(0, currentXP - requiredXP) : currentXP } },
      ...(points.attribute ? [{ add: { path: '玩家.可用属性点', delta: points.attribute, create: true, min: 0 } }] : []),
      ...(professionRuntime ? [
        { set: { path: '玩家.能力系统.职业状态.职业等级', value: Math.max(1, targetTier + 1) } },
        ...(professionPoints > 0 ? [{ add: { path: '玩家.能力系统.职业状态.能力点', delta: professionPoints, min: 0 } }] : []),
      ] : abilityState ? [
        ...(points.talent ? [{ add: { path: '玩家.能力系统.天赋点', delta: points.talent, min: 0 } }] : []),
        ...(points.skill ? [{ add: { path: '玩家.能力系统.技能点', delta: points.skill, min: 0 } }] : []),
      ] : []),
      ...(gate.rewards ?? []),
    ],
    events: [{ type: 'progression.breakthrough', payload: { targetTier } }],
  }, context);
}

function blockedProgression(
  state: GameState,
  context: GameplayExecutionContext,
  id: string,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  return executeGameplayTransaction(state, {
    id, moduleId: 'progression', source: 'system',
    conditions: [{ state: { path: '__gameplay.progressionAllowed', op: '==', value: true } }],
  }, context);
}

export function settleProgressionActivity(
  state: GameState,
  config: ProgressionConfig,
  activityText: string,
  context: GameplayExecutionContext,
  rewardPolicy: ProgressionRewardPolicy = {},
): ProgressionActivityResult {
  const reward = (config.activityRewards?.length ? config.activityRewards : DEFAULT_ACTIVITY_REWARDS)
    .find(item => item.keywords.some(keyword => activityText.toLowerCase().includes(keyword.toLowerCase())));
  if (!reward) return { execution: blockedProgression(state, context, `progression:no-activity:${context.tick}`), settlement: null };

  const tierBefore = Math.max(0, Math.trunc(state.玩家.当前段位索引 ?? 0));
  const xpBefore = Math.max(0, Number(state.玩家.当前经验值 ?? 0));
  const firstThreshold = thresholdFor(tierBefore, config);
  if (!Number.isFinite(firstThreshold)) {
    return { execution: blockedProgression(state, context, `progression:max:${context.tick}`), settlement: null };
  }
  const rate = Math.min(1, Math.max(0, Number(reward.rate) || 0));
  const xpGained = Math.max(1, Math.round(firstThreshold * rate));
  let tierAfter = tierBefore;
  let xpAfter = xpBefore + xpGained;
  const maxTier = maxTierIndex(config);
  while (tierAfter < maxTier) {
    const threshold = thresholdFor(tierAfter, config);
    if (!Number.isFinite(threshold) || xpAfter < threshold) break;
    xpAfter -= threshold;
    tierAfter += 1;
  }

  const promoted = tierAfter - tierBefore;
  const breakthroughs = Array.from({ length: promoted }, (_, index) => config.breakthroughs?.find(item => item.tierIndex === tierBefore + index + 1))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const breakthroughConditions = breakthroughs.flatMap(item => item.conditions ?? []);
  const breakthroughCosts = breakthroughs.flatMap(item => item.costs ?? []);
  const effects: Parameters<typeof executeGameplayTransaction>[1]['effects'] = [
    { set: { path: '玩家.当前段位索引', value: tierAfter } },
    { set: { path: '玩家.当前经验值', value: xpAfter } },
  ];
  if (promoted > 0) {
    const points = config.pointsPerTier ?? {};
    if (points.attribute) effects.push({ add: { path: '玩家.可用属性点', delta: points.attribute * promoted, create: true, min: 0 } });
    const abilityState = state.玩家.能力系统;
    const professionRuntime = abilityState?.职业状态;
    if (professionRuntime) {
      effects.push({ set: { path: '玩家.能力系统.职业状态.职业等级', value: Math.max(1, tierAfter + 1) } });
      const professionPoints = professionRuntime.职业ID
        ? Math.max(0, Number(rewardPolicy.professionAbilityPointsPerTier) || 0)
        : 0;
      if (professionPoints) effects.push({ add: { path: '玩家.能力系统.职业状态.能力点', delta: professionPoints * promoted, min: 0 } });
    } else if (abilityState) {
      if (points.talent) effects.push({ add: { path: '玩家.能力系统.天赋点', delta: points.talent * promoted, min: 0 } });
      if (points.skill) effects.push({ add: { path: '玩家.能力系统.技能点', delta: points.skill * promoted, min: 0 } });
    }
    for (const breakthrough of breakthroughs) effects.push(...(breakthrough.rewards ?? []));
  }

  const execution = executeGameplayTransaction(state, {
    id: `progression:${reward.id}:${context.tick}`,
    moduleId: 'progression',
    source: 'player',
    label: `${reward.label}成长`,
    conditions: breakthroughConditions,
    costs: breakthroughCosts,
    effects,
    events: [{
      type: promoted > 0 ? 'progression.promoted' : 'progression.gained',
      payload: { activityId: reward.id, xpGained, tierBefore, tierAfter, xpAfter },
    }],
  }, context);

  return {
    execution,
    settlement: { activityId: reward.id, activityLabel: reward.label, xpGained, tierBefore, tierAfter, xpBefore, xpAfter },
  };
}
