import type { GameState } from '../../schema/variables';
import type { TalentDef, SkillDef, TalentModuleSchema } from '../../modules/schema';
import { executeGameplayTransaction, evaluateGameplayCondition, type GameplayExecutionContext, type GameplayExecutionResult, type GameplayStateRoot } from '../kernel';

type AbilityState = NonNullable<GameState['玩家']['能力系统']>;
type AbilityResult = GameplayExecutionResult<GameState & GameplayStateRoot>;
function blockedTalent(state: GameState, context: GameplayExecutionContext, id: string): AbilityResult { return executeGameplayTransaction(state, { id, moduleId: 'talent', source: 'player', conditions: [{ state: { path: '__gameplay.talentAllowed', op: '==', value: true } }] }, context); }
function getAbility(state: GameState): AbilityState | undefined { return state.玩家.能力系统; }
function allConditionsMet(state: GameState, conditions: TalentDef['unlockConditions'] | SkillDef['unlockConditions'], context: GameplayExecutionContext): boolean { return (conditions ?? []).every(c => evaluateGameplayCondition(c, state as GameState & GameplayStateRoot, context.events ?? [])); }
function talentOwned(state: GameState, id: string): boolean { return (getAbility(state)?.已解锁天赋[id]?.等级 ?? 0) > 0; }
function skillOwned(state: GameState, id: string): boolean { return (getAbility(state)?.已掌握技能[id]?.等级 ?? 0) > 0; }
function prerequisitesMet(state: GameState, ids?: string[]): boolean { return (ids ?? []).every(id => talentOwned(state, id) || skillOwned(state, id)); }
function findTalent(config: TalentModuleSchema, id: string): TalentDef | undefined { return config.categories.flatMap(c => c.talents ?? []).find(t => t.id === id); }
function findSkill(config: TalentModuleSchema, id: string): SkillDef | undefined { return config.skills?.find(s => s.id === id); }
function hasConflict(state: GameState, group: string | undefined, id: string, config: TalentModuleSchema): boolean {
  if (!group) return false;
  return config.categories.flatMap(c => c.talents ?? []).some(t => t.id !== id && t.exclusiveGroup === group && talentOwned(state, t.id)) || (config.skills ?? []).some(s => s.id !== id && s.exclusiveGroup === group && skillOwned(state, s.id));
}
function rankCost(def: { pointCost?: number; rankCosts?: number[] }, rank: number): number { return Math.max(0, def.rankCosts?.[rank - 1] ?? def.pointCost ?? 1); }

export function canUnlockTalent(state: GameState, config: TalentModuleSchema, id: string, context: GameplayExecutionContext): { ok: boolean; reason?: string } {
  const def = findTalent(config, id), current = getAbility(state)?.已解锁天赋[id]?.等级 ?? 0;
  if (!def) return { ok: false, reason: '天赋不存在' }; if (current >= Math.max(1, def.maxRank ?? 1)) return { ok: false, reason: '已达到最高等级' };
  if (!prerequisitesMet(state, def.prerequisites)) return { ok: false, reason: '前置节点未完成' }; if (hasConflict(state, def.exclusiveGroup, id, config)) return { ok: false, reason: '互斥分支已选择' }; if (!allConditionsMet(state, def.unlockConditions, context)) return { ok: false, reason: '条件未满足' };
  return (getAbility(state)?.天赋点 ?? 0) >= rankCost(def, current + 1) ? { ok: true } : { ok: false, reason: '天赋点不足' };
}
export function unlockTalent(state: GameState, config: TalentModuleSchema, id: string, context: GameplayExecutionContext): AbilityResult {
  const def = findTalent(config, id), ability = getAbility(state), current = ability?.已解锁天赋[id]?.等级 ?? 0, check = canUnlockTalent(state, config, id, context);
  if (!def || !ability || !check.ok) return blockedTalent(state, context, `talent:blocked:${id}:${context.tick}`);
  const unlocked = { ...ability.已解锁天赋, [id]: { 等级: current + 1, 解锁轮次: ability.已解锁天赋[id]?.解锁轮次 ?? context.tick } };
  return executeGameplayTransaction(state, { id: `talent:unlock:${id}:${context.tick}`, moduleId: 'talent', source: 'player', label: `${current ? '提升' : '解锁'}天赋「${def.name}」`, conditions: def.unlockConditions, costs: [{ path: '玩家.能力系统.天赋点', amount: rankCost(def, current + 1), label: '天赋点' }], effects: [{ set: { path: '玩家.能力系统.已解锁天赋', value: unlocked } }, ...(def.mechanics?.passive ?? []), ...(def.mechanics?.onUnlock ?? [])], events: [{ type: 'talent.unlocked', payload: { talentId: id, name: def.name, rank: current + 1 } }] }, context);
}

export function canLearnSkill(state: GameState, config: TalentModuleSchema, id: string, context: GameplayExecutionContext): { ok: boolean; reason?: string } {
  const def = findSkill(config, id), current = getAbility(state)?.已掌握技能[id]?.等级 ?? 0;
  if (!def) return { ok: false, reason: '技能不存在' }; if (current >= Math.max(1, def.maxRank ?? 1)) return { ok: false, reason: '已达到最高等级' }; if (!prerequisitesMet(state, def.prerequisites)) return { ok: false, reason: '前置能力未完成' }; if (hasConflict(state, def.exclusiveGroup, id, config)) return { ok: false, reason: '互斥分支已选择' }; if (!allConditionsMet(state, def.unlockConditions, context)) return { ok: false, reason: '条件未满足' };
  return (getAbility(state)?.技能点 ?? 0) >= rankCost(def, current + 1) ? { ok: true } : { ok: false, reason: '技能点不足' };
}
export function learnSkill(state: GameState, config: TalentModuleSchema, id: string, context: GameplayExecutionContext): AbilityResult {
  const def = findSkill(config, id), ability = getAbility(state), current = ability?.已掌握技能[id]?.等级 ?? 0, check = canLearnSkill(state, config, id, context);
  if (!def || !ability || !check.ok) return blockedTalent(state, context, `skill:blocked:${id}:${context.tick}`);
  const old = ability.已掌握技能[id], learned = { ...ability.已掌握技能, [id]: { 等级: current + 1, 使用次数: old?.使用次数 ?? 0, 熟练度: old?.熟练度 ?? 0, ...(old?.冷却至轮次 === undefined ? {} : { 冷却至轮次: old.冷却至轮次 }) } };
  const content = { ...state.玩家.技能系统, [def.name]: { 品质: def.rarity, 描述: def.description, 类型: def.tags?.join('、') || def.categoryId || '通用技能' } };
  return executeGameplayTransaction(state, { id: `skill:learn:${id}:${context.tick}`, moduleId: 'talent', source: 'player', label: `${current ? '提升' : '学习'}技能「${def.name}」`, conditions: def.unlockConditions, costs: [{ path: '玩家.能力系统.技能点', amount: rankCost(def, current + 1), label: '技能点' }], effects: [{ set: { path: '玩家.能力系统.已掌握技能', value: learned } }, { set: { path: '玩家.技能系统', value: content as unknown as Record<string, never> } }], events: [{ type: 'skill.learned', payload: { skillId: id, name: def.name, rank: current + 1 } }] }, context);
}
export function useSkill(state: GameState, config: TalentModuleSchema, id: string, context: GameplayExecutionContext): AbilityResult {
  const def = findSkill(config, id), ability = getAbility(state), learned = ability?.已掌握技能[id];
  if (!def || !ability || !learned) return blockedTalent(state, context, `skill:not-learned:${id}:${context.tick}`); if ((learned.冷却至轮次 ?? 0) > context.tick) return blockedTalent(state, context, `skill:cooldown:${id}:${context.tick}`);
  const gain = Math.max(0, def.proficiency?.gainPerUse ?? 1), threshold = Math.max(1, def.proficiency?.thresholdPerRank ?? 10), maxRank = Math.max(1, def.proficiency?.maxRank ?? def.maxRank ?? 1), proficiency = Math.max(0, learned.熟练度 ?? 0) + gain, rankGain = Math.min(maxRank - learned.等级, Math.floor(proficiency / threshold));
  const next = { ...ability.已掌握技能, [id]: { ...learned, 使用次数: learned.使用次数 + 1, 熟练度: proficiency - rankGain * threshold, 等级: learned.等级 + rankGain, ...(def.cooldownTicks && def.cooldownTicks > 0 ? { 冷却至轮次: context.tick + Math.trunc(def.cooldownTicks) } : {}) } };
  return executeGameplayTransaction(state, { id: `skill:use:${id}:${context.tick}`, moduleId: 'talent', source: 'player', label: `使用技能「${def.name}」`, costs: def.activation?.costs, effects: [{ set: { path: '玩家.能力系统.已掌握技能', value: next } }, ...(def.activation?.effects ?? [])], rewards: def.activation?.rewards, events: [{ type: 'skill.used', payload: { skillId: id, name: def.name, rank: next[id].等级, proficiency: next[id].熟练度 ?? 0 } }] }, context);
}

export function awakenAbility(state: GameState, config: TalentModuleSchema, id: string, context: GameplayExecutionContext): AbilityResult {
  const talent = findTalent(config, id), skill = talent ? undefined : findSkill(config, id), awakening = talent?.awakening ?? skill?.awakening, ability = getAbility(state);
  if (!ability || !awakening || ability.已觉醒?.[id]) return blockedTalent(state, context, `ability:awaken:blocked:${id}:${context.tick}`);
  if (!(talent ? talentOwned(state, id) : skillOwned(state, id)) || !allConditionsMet(state, awakening.conditions, context)) return blockedTalent(state, context, `ability:awaken:condition:${id}:${context.tick}`);
  const pointPath = talent ? '玩家.能力系统.天赋点' : '玩家.能力系统.技能点', awakened = { ...(ability.已觉醒 ?? {}), [id]: { 轮次: context.tick, 名称: awakening.name } };
  return executeGameplayTransaction(state, { id: `ability:awaken:${id}:${context.tick}`, moduleId: 'talent', source: 'player', label: `觉醒「${awakening.name}」`, costs: awakening.pointCost ? [{ path: pointPath, amount: awakening.pointCost, label: talent ? '天赋点' : '技能点' }] : undefined, effects: [{ set: { path: '玩家.能力系统.已觉醒', value: awakened } }, ...(awakening.effects ?? [])], events: [{ type: 'ability.awakened', payload: { abilityId: id, name: awakening.name } }] }, context);
}
export function respecAbilities(state: GameState, config: TalentModuleSchema, context: GameplayExecutionContext): AbilityResult {
  const ability = getAbility(state); if (!ability || config.respec?.enabled === false) return blockedTalent(state, context, `ability:respec:blocked:${context.tick}`);
  const refund = (entries: Record<string, { 等级: number }>, defs: Array<TalentDef | SkillDef>) => Object.entries(entries).reduce((sum, [id, value]) => { const def = defs.find(item => item.id === id); if (!def) return sum; return sum + Array.from({ length: value.等级 }, (_, i) => rankCost(def, i + 1)).reduce((a, b) => a + b, 0); }, 0);
  const talentRefund = refund(ability.已解锁天赋, config.categories.flatMap(c => c.talents ?? [])), skillRefund = refund(ability.已掌握技能, config.skills ?? []);
  return executeGameplayTransaction(state, { id: `ability:respec:${context.tick}`, moduleId: 'talent', source: 'player', label: '重置天赋与技能', costs: config.respec?.cost, effects: [{ set: { path: '玩家.能力系统.已解锁天赋', value: {} } }, { set: { path: '玩家.能力系统.已掌握技能', value: {} } }, { set: { path: '玩家.能力系统.已觉醒', value: {} } }, { set: { path: '玩家.能力系统.装备槽', value: {} } }, { add: { path: '玩家.能力系统.天赋点', delta: talentRefund, min: 0 } }, { add: { path: '玩家.能力系统.技能点', delta: skillRefund, min: 0 } }], events: [{ type: 'ability.respec', payload: { refundedTalent: talentRefund, refundedSkill: skillRefund } }] }, context);
}
export function equipAbility(state: GameState, config: TalentModuleSchema, id: string, slotId: string, context: GameplayExecutionContext): AbilityResult {
  const ability = getAbility(state), def = findTalent(config, id) ?? findSkill(config, id), slot = config.equipmentSlots?.find(item => item.id === slotId);
  if (!ability || !def || !slot || !(talentOwned(state, id) || skillOwned(state, id)) || (def.equipmentSlot && def.equipmentSlot !== slotId)) return blockedTalent(state, context, `ability:equip:blocked:${id}:${context.tick}`);
  const slots = Object.fromEntries(Object.entries(ability.装备槽 ?? {}).map(([key, ids]) => [key, ids.filter(item => item !== id)])), current = slots[slotId] ?? [];
  if (current.length >= Math.max(1, slot.capacity ?? 1)) return blockedTalent(state, context, `ability:equip:full:${slotId}:${context.tick}`);
  slots[slotId] = [...current, id];
  return executeGameplayTransaction(state, { id: `ability:equip:${id}:${slotId}:${context.tick}`, moduleId: 'talent', source: 'player', effects: [{ set: { path: '玩家.能力系统.装备槽', value: slots } }], events: [{ type: 'ability.equipped', payload: { abilityId: id, slotId } }] }, context);
}
export function unequipAbility(state: GameState, id: string, context: GameplayExecutionContext): AbilityResult {
  const ability = getAbility(state); if (!ability) return blockedTalent(state, context, `ability:unequip:blocked:${id}:${context.tick}`);
  const slots = Object.fromEntries(Object.entries(ability.装备槽 ?? {}).map(([key, ids]) => [key, ids.filter(item => item !== id)]));
  return executeGameplayTransaction(state, { id: `ability:unequip:${id}:${context.tick}`, moduleId: 'talent', source: 'player', effects: [{ set: { path: '玩家.能力系统.装备槽', value: slots } }], events: [{ type: 'ability.unequipped', payload: { abilityId: id } }] }, context);
}
