import type { GameState } from '../../schema/variables';
import type { DiceAdvantageMode, DiceModuleSchema, DiceRoll, TalentModuleSchema } from '../../modules/schema';

export interface DiceRollRequest {
  requestId?: string;
  attributeId?: string;
  attributeName: string;
  attributeValue: number;
  dc: number;
  timestamp: number;
  advantageMode?: DiceAdvantageMode;
  talentModifier?: number;
  bonuses?: Array<{ source: string; value: number }>;
  /** 已按属性量纲换算好的修正（骰子模块按属性范围计算时传入）；缺省按 modifierBase/modifierStep 计算。 */
  attributeModifier?: number;
}

export function getTalentDiceBonuses(state: GameState, config: TalentModuleSchema): Array<{ source: string; value: number }> {
  const ability = state.玩家.能力系统;
  if (!ability) return [];
  const definitions = [
    ...config.categories.flatMap(category => category.talents ?? []),
    ...(config.skills ?? []),
  ];
  const skillIds = new Set((config.skills ?? []).map(skill => skill.id));
  return definitions.flatMap(definition => {
    const owned = skillIds.has(definition.id)
      ? (ability.已掌握技能[definition.id]?.等级 ?? 0) > 0
      : (ability.已解锁天赋[definition.id]?.等级 ?? 0) > 0;
    const value = Number(definition.diceModifier ?? 0);
    return owned && Number.isFinite(value) && value !== 0 ? [{ source: definition.name, value }] : [];
  });
}

export function createDiceRoll(
  config: DiceModuleSchema,
  request: DiceRollRequest,
  random: () => number = Math.random,
): DiceRoll {
  const sides = Math.max(2, Math.min(1000, Math.trunc(config.sides ?? 20)));
  const base = Number.isFinite(config.modifierBase) ? Number(config.modifierBase) : 10;
  const step = Math.max(1, Number(config.modifierStep) || 2);
  const rollDie = () => {
    const sample = Math.min(0.999999999, Math.max(0, Number(random()) || 0));
    return Math.floor(sample * sides) + 1;
  };
  const mode = request.advantageMode ?? 'normal';
  const firstDie = rollDie();
  const secondDie = mode === 'normal' ? undefined : rollDie();
  const die = secondDie === undefined
    ? firstDie
    : mode === 'advantage' ? Math.max(firstDie, secondDie) : Math.min(firstDie, secondDie);
  const attributeModifier = Number.isFinite(request.attributeModifier)
    ? Math.trunc(Number(request.attributeModifier))
    : Math.floor((Number(request.attributeValue) - base) / step);
  const bonuses = request.bonuses ?? [];
  const talentModifier = Number(request.talentModifier ?? 0) + bonuses.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const modifier = attributeModifier + talentModifier;
  const total = die + modifier;
  const naturalSuccess = Math.max(2, Math.min(sides, Math.trunc(config.criticalSuccess ?? sides)));
  const naturalFailure = Math.max(1, Math.min(sides - 1, Math.trunc(config.criticalFailure ?? 1)));
  const natural20 = die >= naturalSuccess;
  const natural1 = die <= naturalFailure;
  const partialMargin = Math.max(0, Number(config.partialSuccessMargin ?? 2));
  const resultTier = natural1 ? 'critical-failure' : natural20 ? 'critical-success'
    : total >= request.dc ? 'success' : total >= request.dc - partialMargin ? 'partial' : 'failure';
  return {
    requestId: request.requestId,
    attributeId: request.attributeId,
    attributeName: request.attributeName,
    attributeValue: request.attributeValue,
    modifier,
    d20: die,
    total,
    dc: request.dc,
    success: !natural1 && (natural20 || total >= request.dc),
    isNatural20: natural20,
    isNatural1: natural1,
    timestamp: request.timestamp,
    ...(secondDie === undefined ? {} : { diceRolls: [firstDie, secondDie] }),
    advantageMode: mode,
    resultTier,
    talentModifier,
    ...(bonuses.length ? { bonuses } : {}),
  };
}
