/**
 * rules.ts — 天赋、技能、职业能力能否解锁/学习的判定（纯函数，界面按钮与模块命令共用）。
 * 规则沿用旧 gameplay/modules/talent.ts 与 profession.ts：等级上限、前置、互斥、职业等级、点数、解锁条件。
 */
import type { ProfessionModuleSchema, SkillDef, TalentDef, TalentModuleSchema } from '../../modules/schema';
import type { GameState } from '../../schema/variables';
import type { GameplayCondition } from '../../gameplay/types';
import { abilityDefinitionFromProfessionAbility, abilityDefinitionFromSkill, abilityDefinitionFromTalent, abilityRankCost } from '../../gameplay/abilitySystem';
import { evaluateCondition, type EventLike } from '../../core/conditions';
import { FactRegistry } from '../../core/facts';
import { gameplayConditionToCore } from '../../core/legacy';

export interface AbilityRuleContext {
  tick: number;
  /** 条件里 state 路径的读法（宿主的变量注册表）；不传时按原始路径读。 */
  facts?: FactRegistry;
  events?: readonly EventLike[];
}

export type RuleCheck = { ok: boolean; reason?: string };

type AbilityState = NonNullable<GameState['玩家']['能力系统']>;

export function abilityState(state: GameState): AbilityState | undefined {
  return state.玩家?.能力系统;
}

export function conditionsMet(state: GameState, conditions: readonly GameplayCondition[] | undefined, context: AbilityRuleContext): boolean {
  if (!conditions?.length) return true;
  const facts = context.facts ?? new FactRegistry();
  return conditions.every(condition => evaluateCondition(gameplayConditionToCore(condition), { state, facts, events: context.events ?? [] }));
}

export function findTalent(config: TalentModuleSchema, id: string): TalentDef | undefined {
  return config.categories.flatMap(category => category.talents ?? []).find(talent => talent.id === id);
}

export function findSkill(config: Pick<TalentModuleSchema, 'skills'>, id: string): SkillDef | undefined {
  return config.skills?.find(skill => skill.id === id);
}

export function talentOwned(state: GameState, id: string): boolean {
  return (abilityState(state)?.已解锁天赋?.[id]?.等级 ?? 0) > 0;
}

export function skillOwned(state: GameState, id: string): boolean {
  return (abilityState(state)?.已掌握技能?.[id]?.等级 ?? 0) > 0;
}

function prerequisitesMet(state: GameState, ids?: string[]): boolean {
  return (ids ?? []).every(id => talentOwned(state, id) || skillOwned(state, id));
}

function hasConflict(state: GameState, group: string | undefined, id: string, config: TalentModuleSchema): boolean {
  if (!group) return false;
  return config.categories.flatMap(category => category.talents ?? []).some(talent => talent.id !== id && talent.exclusiveGroup === group && talentOwned(state, talent.id))
    || (config.skills ?? []).some(skill => skill.id !== id && skill.exclusiveGroup === group && skillOwned(state, skill.id));
}

export function talentRankCost(def: TalentDef, rank: number): number {
  return abilityRankCost(abilityDefinitionFromTalent(def), rank);
}

export function skillRankCost(def: SkillDef, rank: number): number {
  return abilityRankCost(abilityDefinitionFromSkill(def), rank);
}

export function canUnlockTalent(state: GameState, config: TalentModuleSchema, id: string, context: AbilityRuleContext): RuleCheck {
  const def = findTalent(config, id);
  const current = abilityState(state)?.已解锁天赋?.[id]?.等级 ?? 0;
  if (!def) return { ok: false, reason: '天赋不存在' };
  if (current >= Math.max(1, def.maxRank ?? 1)) return { ok: false, reason: '已达到最高等级' };
  if (!prerequisitesMet(state, def.prerequisites)) return { ok: false, reason: '前置节点未完成' };
  if (hasConflict(state, def.exclusiveGroup, id, config)) return { ok: false, reason: '互斥分支已选择' };
  if (!conditionsMet(state, def.unlockConditions, context)) return { ok: false, reason: '条件未满足' };
  return (abilityState(state)?.天赋点 ?? 0) >= talentRankCost(def, current + 1) ? { ok: true } : { ok: false, reason: '天赋点不足' };
}

export function canLearnSkill(state: GameState, config: TalentModuleSchema, id: string, context: AbilityRuleContext): RuleCheck {
  const def = findSkill(config, id);
  const current = abilityState(state)?.已掌握技能?.[id]?.等级 ?? 0;
  if (!def) return { ok: false, reason: '技能不存在' };
  if (current >= Math.max(1, def.maxRank ?? 1)) return { ok: false, reason: '已达到最高等级' };
  if (!prerequisitesMet(state, def.prerequisites)) return { ok: false, reason: '前置能力未完成' };
  if (hasConflict(state, def.exclusiveGroup, id, config)) return { ok: false, reason: '互斥分支已选择' };
  if (!conditionsMet(state, def.unlockConditions, context)) return { ok: false, reason: '条件未满足' };
  return (abilityState(state)?.技能点 ?? 0) >= skillRankCost(def, current + 1) ? { ok: true } : { ok: false, reason: '技能点不足' };
}

export function selectedProfession(state: GameState, config: ProfessionModuleSchema) {
  const id = abilityState(state)?.职业状态?.职业ID;
  return config.professions.find(item => item.id === id);
}

export function canUnlockProfessionAbility(state: GameState, config: ProfessionModuleSchema, abilityId: string): RuleCheck {
  const runtime = abilityState(state)?.职业状态;
  const profession = selectedProfession(state, config);
  const ability = profession?.abilities.find(item => item.id === abilityId);
  if (!runtime || !profession) return { ok: false, reason: '尚未选择职业' };
  if (!ability) return { ok: false, reason: '能力不属于当前职业' };
  const definition = abilityDefinitionFromProfessionAbility(ability, profession.id);
  const currentRank = runtime.已解锁能力[abilityId]?.等级 ?? 0;
  if (currentRank >= Math.max(1, definition.maxRank)) return { ok: false, reason: '已达到最高等级' };
  const prerequisites = definition.prerequisites;
  const met = definition.prerequisiteMode === 'any'
    ? (prerequisites.length === 0 || prerequisites.some(id => Boolean(runtime.已解锁能力[id])))
    : prerequisites.every(id => Boolean(runtime.已解锁能力[id]));
  if (!met) return { ok: false, reason: '前置能力尚未解锁' };
  if ((definition.requiredProfessionLevel ?? 1) > runtime.职业等级) return { ok: false, reason: '职业等级不足' };
  if (definition.exclusiveGroup && profession.abilities.some(item => item.id !== definition.id && item.exclusiveGroup === definition.exclusiveGroup && runtime.已解锁能力[item.id])) {
    return { ok: false, reason: '互斥专精已经选择' };
  }
  if (runtime.能力点 < abilityRankCost(definition, currentRank + 1)) return { ok: false, reason: '能力点不足' };
  return { ok: true };
}
