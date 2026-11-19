/**
 * 能力模块（abilities）：天赋树、技能（学习、使用、熟练度、冷却）、觉醒、装备槽、重置，以及职业能力。
 *
 * 判定沿用旧 gameplay/modules/talent.ts 与 profession.ts（见 rules.ts）；写入改走统一效果语言：
 * 点数与能力自带的消耗是严格扣减，能力的效果/奖励由旧格式适配成 Op，结果作为领域事件广播
 * （talent.unlocked、skill.used、profession.ability.used 等），成长、事件规则都能接着反应。
 * 点数不允许 AI 直接改写，只能由模块命令、成长结算和事件卡增减。
 */
import type { WorldDef } from '../../data/worlds-schema';
import { resolveProfessionBinding } from '../../data/professions';
import type { ProfessionModuleSchema, TalentModuleSchema } from '../../modules/schema';
import type { GameState } from '../../schema/variables';
import type { GameplayCost, GameplayEffect, GameplayReward } from '../../gameplay/types';
import { abilityDefinitionFromProfessionAbility, abilityDefinitionFromSkill, abilityDefinitionFromTalent, abilityRankCost } from '../../gameplay/abilitySystem';
import { isProfessionModuleEnabled } from '../../gameplay/profession/featureGate';
import { synchronizeProfessionAbilities } from '../../gameplay/profession/profession';
import type { FactSpec } from '../../core/facts';
import type { GameplayModule, ModuleHookContext } from '../../core/host';
import { gameplayEffectToOp } from '../../core/legacy';
import type { CommandResult, Op } from '../../core/ops';
import {
  abilityState,
  canLearnSkill,
  canUnlockProfessionAbility,
  canUnlockTalent,
  conditionsMet,
  findSkill,
  findTalent,
  selectedProfession,
  skillOwned,
  skillRankCost,
  talentOwned,
  talentRankCost,
  type AbilityRuleContext,
} from './rules';

export const ABILITIES_MODULE_ID = 'abilities';

export interface AbilitiesConfig {
  talent?: TalentModuleSchema;
  profession?: ProfessionModuleSchema;
}

type Ctx = ModuleHookContext<AbilitiesConfig>;

const POINTS = {
  talent: '玩家.能力系统.天赋点',
  skill: '玩家.能力系统.技能点',
  profession: '玩家.能力系统.职业状态.能力点',
} as const;

function fail(reason: string): CommandResult {
  return { ok: false, reason };
}

function ruleContext(context: Ctx): AbilityRuleContext {
  return { tick: context.turn, facts: context.facts, events: context.events() };
}

function costOps(costs: readonly GameplayCost[] | undefined): Op[] {
  return (costs ?? []).map(cost => ({ op: 'add' as const, path: cost.path, value: -Math.abs(Number(cost.amount) || 0), strict: true, min: 0, label: cost.label }));
}

/** 消耗不够时的原因（与旧事务的“X不足”一致）。 */
function missingCost(state: GameState, costs: readonly GameplayCost[] | undefined, context: Ctx): string | null {
  for (const cost of costs ?? []) {
    const available = Number(context.facts.read(state, cost.path));
    if (!Number.isFinite(available) || !Number.isFinite(cost.amount) || cost.amount < 0 || available < cost.amount) return `${cost.label || cost.id || cost.path}不足`;
  }
  return null;
}

function effectOps(effects: readonly GameplayEffect[] = [], rewards: readonly GameplayReward[] = []): Op[] {
  return [...effects, ...rewards.flatMap(reward => reward.effects)].flatMap(effect => {
    const op = gameplayEffectToOp(effect);
    return op ? [op] : [];
  });
}

function run(context: Ctx, ops: readonly Op[], message: string, event: { type: string; payload: Record<string, unknown> }): CommandResult {
  if (!context.apply(ops)) return fail(`${message}未能完成：有效果写入失败`);
  context.emit(event.type, event.payload);
  return { ok: true, message };
}

function requireTalent(context: Ctx): TalentModuleSchema | undefined {
  return context.config.talent;
}

function unlockTalent(state: GameState, args: Record<string, unknown>, context: Ctx): CommandResult {
  const config = requireTalent(context);
  if (!config) return fail('当前世界没有天赋体系');
  const id = String(args.id ?? '');
  const check = canUnlockTalent(state, config, id, ruleContext(context));
  if (!check.ok) return fail(check.reason ?? '条件未满足');
  const def = findTalent(config, id)!;
  const ability = abilityState(state)!;
  const current = ability.已解锁天赋?.[id]?.等级 ?? 0;
  const definition = abilityDefinitionFromTalent(def);
  const unlocked = { ...ability.已解锁天赋, [id]: { 等级: current + 1, 解锁轮次: ability.已解锁天赋?.[id]?.解锁轮次 ?? context.turn } };
  return run(context, [
    { op: 'add', path: POINTS.talent, value: -talentRankCost(def, current + 1), strict: true, min: 0, label: '天赋点' },
    { op: 'set', path: '玩家.能力系统.已解锁天赋', value: unlocked },
    ...effectOps([...(definition.mechanics?.passiveEffects ?? []), ...(definition.mechanics?.effects ?? [])]),
  ], `${current ? '提升' : '解锁'}天赋「${def.name}」`, { type: 'talent.unlocked', payload: { talentId: id, name: def.name, rank: current + 1 } });
}

function learnSkill(state: GameState, args: Record<string, unknown>, context: Ctx): CommandResult {
  const config = requireTalent(context);
  if (!config) return fail('当前世界没有技能体系');
  const id = String(args.id ?? '');
  const check = canLearnSkill(state, config, id, ruleContext(context));
  if (!check.ok) return fail(check.reason ?? '条件未满足');
  const def = findSkill(config, id)!;
  const ability = abilityState(state)!;
  const current = ability.已掌握技能?.[id]?.等级 ?? 0;
  const old = ability.已掌握技能?.[id];
  const learned = { ...ability.已掌握技能, [id]: { 等级: current + 1, 使用次数: old?.使用次数 ?? 0, 熟练度: old?.熟练度 ?? 0, ...(old?.冷却至轮次 === undefined ? {} : { 冷却至轮次: old.冷却至轮次 }) } };
  const content = { ...state.玩家.技能系统, [def.name]: { 品质: def.rarity, 描述: def.description, 类型: def.tags?.join('、') || def.categoryId || '通用技能' } };
  return run(context, [
    { op: 'add', path: POINTS.skill, value: -skillRankCost(def, current + 1), strict: true, min: 0, label: '技能点' },
    { op: 'set', path: '玩家.能力系统.已掌握技能', value: learned },
    { op: 'set', path: '玩家.技能系统', value: content },
  ], `${current ? '提升' : '学习'}技能「${def.name}」`, { type: 'skill.learned', payload: { skillId: id, name: def.name, rank: current + 1 } });
}

function useSkill(state: GameState, args: Record<string, unknown>, context: Ctx): CommandResult {
  const config = requireTalent(context);
  const id = String(args.id ?? '');
  const def = config ? findSkill(config, id) : undefined;
  const ability = abilityState(state);
  const learned = ability?.已掌握技能?.[id];
  if (!def || !ability || !learned) return fail('尚未掌握该技能');
  if ((learned.冷却至轮次 ?? 0) > context.turn) return fail(`技能冷却中（第 ${learned.冷却至轮次} 回合后可用）`);
  const definition = abilityDefinitionFromSkill(def);
  const missing = missingCost(state, definition.mechanics?.costs, context);
  if (missing) return fail(missing);
  const proficiency = definition.mechanics?.proficiency;
  const gain = Math.max(0, proficiency?.gainPerUse ?? 1);
  const threshold = Math.max(1, proficiency?.thresholdPerRank ?? 10);
  const maxRank = Math.max(1, proficiency?.maxRank ?? definition.maxRank);
  const total = Math.max(0, learned.熟练度 ?? 0) + gain;
  const rankGain = Math.min(maxRank - learned.等级, Math.floor(total / threshold));
  const cooldown = definition.mechanics?.cooldownRounds && definition.mechanics.cooldownRounds > 0 ? { 冷却至轮次: context.turn + Math.trunc(definition.mechanics.cooldownRounds) } : {};
  const next = { ...ability.已掌握技能, [id]: { ...learned, 使用次数: learned.使用次数 + 1, 熟练度: total - rankGain * threshold, 等级: learned.等级 + rankGain, ...cooldown } };
  return run(context, [
    ...costOps(definition.mechanics?.costs),
    { op: 'set', path: '玩家.能力系统.已掌握技能', value: next },
    ...effectOps(definition.mechanics?.effects, definition.mechanics?.rewards),
  ], `使用技能「${def.name}」`, { type: 'skill.used', payload: { skillId: id, name: def.name, rank: next[id].等级, proficiency: next[id].熟练度 ?? 0 } });
}

function awaken(state: GameState, args: Record<string, unknown>, context: Ctx): CommandResult {
  const config = requireTalent(context);
  if (!config) return fail('当前世界没有天赋体系');
  const id = String(args.id ?? '');
  const talent = findTalent(config, id);
  const skill = talent ? undefined : findSkill(config, id);
  const awakening = talent?.awakening ?? skill?.awakening;
  const ability = abilityState(state);
  if (!ability || !awakening) return fail('该能力没有觉醒');
  if (ability.已觉醒?.[id]) return fail('已经觉醒过了');
  if (!(talent ? talentOwned(state, id) : skillOwned(state, id))) return fail('需要先掌握这项能力');
  if (!conditionsMet(state, awakening.conditions, ruleContext(context))) return fail('觉醒条件未满足');
  const pointPath = talent ? POINTS.talent : POINTS.skill;
  const costs = awakening.pointCost ? [{ path: pointPath, amount: awakening.pointCost, label: talent ? '天赋点' : '技能点' }] : [];
  const missing = missingCost(state, costs, context);
  if (missing) return fail(missing);
  const awakened = { ...(ability.已觉醒 ?? {}), [id]: { 轮次: context.turn, 名称: awakening.name } };
  return run(context, [
    ...costOps(costs),
    { op: 'set', path: '玩家.能力系统.已觉醒', value: awakened },
    ...effectOps(awakening.effects),
  ], `觉醒「${awakening.name}」`, { type: 'ability.awakened', payload: { abilityId: id, name: awakening.name } });
}

function respec(state: GameState, _args: Record<string, unknown>, context: Ctx): CommandResult {
  const config = requireTalent(context);
  const ability = abilityState(state);
  if (!config || !ability) return fail('当前世界没有天赋体系');
  if (config.respec?.enabled === false) return fail('这个世界不允许重置天赋');
  const missing = missingCost(state, config.respec?.cost, context);
  if (missing) return fail(missing);
  const refund = (entries: Record<string, { 等级: number }>, cost: (id: string, rank: number) => number | undefined) => Object.entries(entries ?? {})
    .reduce((sum, [id, value]) => sum + Array.from({ length: value.等级 }, (_, index) => cost(id, index + 1) ?? 0).reduce((a, b) => a + b, 0), 0);
  const talentRefund = refund(ability.已解锁天赋, (id, rank) => { const def = findTalent(config, id); return def ? talentRankCost(def, rank) : undefined; });
  const skillRefund = refund(ability.已掌握技能, (id, rank) => { const def = findSkill(config, id); return def ? skillRankCost(def, rank) : undefined; });
  return run(context, [
    ...costOps(config.respec?.cost),
    { op: 'set', path: '玩家.能力系统.已解锁天赋', value: {} },
    { op: 'set', path: '玩家.能力系统.已掌握技能', value: {} },
    { op: 'set', path: '玩家.能力系统.已觉醒', value: {} },
    { op: 'set', path: '玩家.能力系统.装备槽', value: {} },
    { op: 'add', path: POINTS.talent, value: talentRefund, min: 0 },
    { op: 'add', path: POINTS.skill, value: skillRefund, min: 0 },
  ], '重置天赋与技能', { type: 'ability.respec', payload: { refundedTalent: talentRefund, refundedSkill: skillRefund } });
}

function equip(state: GameState, args: Record<string, unknown>, context: Ctx): CommandResult {
  const config = requireTalent(context);
  const id = String(args.id ?? '');
  const slotId = String(args.slotId ?? '');
  const ability = abilityState(state);
  const def = config ? findTalent(config, id) ?? findSkill(config, id) : undefined;
  const slot = config?.equipmentSlots?.find(item => item.id === slotId);
  if (!ability || !def || !slot) return fail('能力或装备槽不存在');
  if (!(talentOwned(state, id) || skillOwned(state, id))) return fail('需要先掌握这项能力');
  if (def.equipmentSlot && def.equipmentSlot !== slotId) return fail(`「${def.name}」只能装在「${def.equipmentSlot}」槽`);
  const slots = Object.fromEntries(Object.entries(ability.装备槽 ?? {}).map(([key, ids]) => [key, ids.filter(item => item !== id)]));
  const current = slots[slotId] ?? [];
  if (current.length >= Math.max(1, slot.capacity ?? 1)) return fail(`「${slot.name}」已满`);
  slots[slotId] = [...current, id];
  return run(context, [{ op: 'set', path: '玩家.能力系统.装备槽', value: slots }], `装备「${def.name}」`, { type: 'ability.equipped', payload: { abilityId: id, slotId } });
}

function unequip(state: GameState, args: Record<string, unknown>, context: Ctx): CommandResult {
  const ability = abilityState(state);
  if (!ability) return fail('当前世界没有天赋体系');
  const id = String(args.id ?? '');
  const slots = Object.fromEntries(Object.entries(ability.装备槽 ?? {}).map(([key, ids]) => [key, ids.filter(item => item !== id)]));
  return run(context, [{ op: 'set', path: '玩家.能力系统.装备槽', value: slots }], '卸下能力', { type: 'ability.unequipped', payload: { abilityId: id } });
}

/** 职业能力变化后，同步战斗用的能力定义与实例（v3.abilityDefinitions / abilityInstances）。 */
function syncProfession(state: GameState, config: ProfessionModuleSchema): void {
  const synced = synchronizeProfessionAbilities(state, config);
  state.v3 = synced.v3;
}

function unlockProfession(state: GameState, args: Record<string, unknown>, context: Ctx): CommandResult {
  const config = context.config.profession;
  if (!config) return fail('当前世界没有职业体系');
  const id = String(args.id ?? '');
  const check = canUnlockProfessionAbility(state, config, id);
  if (!check.ok) return fail(check.reason ?? '条件未满足');
  const runtime = abilityState(state)!.职业状态!;
  const ability = selectedProfession(state, config)!.abilities.find(item => item.id === id)!;
  const definition = abilityDefinitionFromProfessionAbility(ability, runtime.职业ID ?? undefined);
  const current = runtime.已解锁能力[id];
  const next = {
    ...runtime.已解锁能力,
    [id]: {
      名称: ability.name, 类型: ability.type, 等级: (current?.等级 ?? 0) + 1, 解锁轮次: current?.解锁轮次 ?? context.turn, 使用次数: current?.使用次数 ?? 0,
      ...(current?.冷却至轮次 === undefined ? {} : { 冷却至轮次: current.冷却至轮次 }),
    },
  };
  const result = run(context, [
    { op: 'add', path: POINTS.profession, value: -abilityRankCost(definition, (current?.等级 ?? 0) + 1), strict: true, min: 0, label: '能力点' },
    { op: 'set', path: '玩家.能力系统.职业状态.已解锁能力', value: next },
    ...(definition.abilityType === 'passive' ? effectOps(definition.mechanics?.passiveEffects) : []),
  ], `解锁职业能力「${ability.name}」`, { type: 'profession.ability.unlocked', payload: { professionId: runtime.职业ID, abilityId: id, name: ability.name } });
  if (result.ok) syncProfession(state, config);
  return result;
}

function useProfession(state: GameState, args: Record<string, unknown>, context: Ctx): CommandResult {
  const config = context.config.profession;
  if (!config) return fail('当前世界没有职业体系');
  const id = String(args.id ?? '');
  const runtime = abilityState(state)?.职业状态;
  const ability = selectedProfession(state, config)?.abilities.find(item => item.id === id);
  const owned = runtime?.已解锁能力[id];
  if (!ability || !runtime || !owned || (ability.type !== 'active' && ability.type !== 'ultimate')) return fail('该能力当前不可主动使用');
  const definition = abilityDefinitionFromProfessionAbility(ability, runtime.职业ID ?? undefined);
  if ((owned.冷却至轮次 ?? 0) > context.turn) return fail('能力仍在冷却');
  const missing = missingCost(state, definition.mechanics?.costs, context);
  if (missing) return fail(missing);
  const next = {
    ...runtime.已解锁能力,
    [id]: { ...owned, 使用次数: (owned.使用次数 ?? 0) + 1, ...(definition.mechanics?.cooldownRounds ? { 冷却至轮次: context.turn + definition.mechanics.cooldownRounds } : {}) },
  };
  const result = run(context, [
    ...costOps(definition.mechanics?.costs),
    { op: 'set', path: '玩家.能力系统.职业状态.已解锁能力', value: next },
    ...effectOps(definition.mechanics?.effects, definition.mechanics?.rewards),
  ], `使用职业能力「${ability.name}」`, { type: 'profession.ability.used', payload: { abilityId: id, name: ability.name } });
  if (result.ok) syncProfession(state, config);
  return result;
}

function abilityFacts(config: AbilitiesConfig): FactSpec[] {
  const out: FactSpec[] = [];
  if (config.talent) {
    out.push(
      { id: POINTS.talent, module: ABILITIES_MODULE_ID, type: 'number', label: '天赋点', bounds: { min: 0, integer: true }, writable: ['system', 'event'], storage: POINTS.talent },
      { id: POINTS.skill, module: ABILITIES_MODULE_ID, type: 'number', label: '技能点', bounds: { min: 0, integer: true }, writable: ['system', 'event'], storage: POINTS.skill },
    );
  }
  if (config.profession) {
    out.push({ id: POINTS.profession, module: ABILITIES_MODULE_ID, type: 'number', label: '职业能力点', bounds: { min: 0, integer: true }, writable: ['system', 'event'], storage: POINTS.profession });
  }
  return out;
}

function resolveConfig(world: WorldDef | undefined): AbilitiesConfig | undefined {
  const talent = world?.modules?.find(item => item.moduleId === 'talent' && item.enabled)?.moduleConfig as TalentModuleSchema | undefined;
  const professionModule = isProfessionModuleEnabled(world) ? world?.modules?.find(item => item.moduleId === 'profession' && item.enabled) : undefined;
  const profession = professionModule ? resolveProfessionBinding(professionModule.moduleConfig) : undefined;
  if (!talent && !profession) return undefined;
  return { ...(talent ? { talent } : {}), ...(profession ? { profession } : {}) };
}

export const abilitiesModule: GameplayModule<AbilitiesConfig> = {
  id: ABILITIES_MODULE_ID,
  label: '能力',
  order: 35,
  resolveConfig,
  facts: abilityFacts,
  domainEvents: config => [
    ...(config.talent ? [
      { type: 'talent.unlocked', label: '解锁或提升天赋', payload: 'talentId、name、rank' },
      { type: 'skill.learned', label: '学会或提升技能', payload: 'skillId、name、rank' },
      { type: 'skill.used', label: '使用技能', payload: 'skillId、name' },
      { type: 'ability.awakened', label: '能力觉醒', payload: 'abilityId、name' },
      { type: 'ability.respec', label: '重置天赋与技能' },
      { type: 'ability.equipped', label: '装备能力', payload: 'abilityId、slotId' },
      { type: 'ability.unequipped', label: '卸下能力', payload: 'abilityId' },
    ] : []),
    ...(config.profession ? [
      { type: 'profession.ability.unlocked', label: '解锁职业能力', payload: 'abilityId、name' },
      { type: 'profession.ability.used', label: '使用职业能力', payload: 'abilityId、name' },
    ] : []),
  ],
  commands: {
    unlockTalent,
    learnSkill,
    useSkill,
    awaken,
    respec,
    equip,
    unequip,
    unlockProfession,
    useProfession,
  },
  summarize: (state, context) => {
    const ability = abilityState(state);
    if (!ability) return undefined;
    const parts: string[] = [];
    if (context.config.talent) {
      const talents = Object.keys(ability.已解锁天赋 ?? {}).map(id => findTalent(context.config.talent!, id)?.name ?? id);
      const skills = Object.keys(ability.已掌握技能 ?? {}).map(id => findSkill(context.config.talent!, id)?.name ?? id);
      parts.push(`天赋点 ${ability.天赋点 ?? 0}、技能点 ${ability.技能点 ?? 0}`);
      if (talents.length) parts.push(`已解锁天赋：${talents.join('、')}`);
      if (skills.length) parts.push(`已掌握技能：${skills.join('、')}`);
    }
    if (context.config.profession && ability.职业状态?.职业ID) {
      const profession = selectedProfession(state, context.config.profession);
      const owned = Object.values(ability.职业状态.已解锁能力 ?? {}).map(item => item.名称);
      parts.push(`职业 ${profession?.name ?? ability.职业状态.职业ID} ${ability.职业状态.职业等级} 级，能力点 ${ability.职业状态.能力点}${owned.length ? `，已掌握：${owned.join('、')}` : ''}`);
    }
    return parts.length ? parts.join('；') : undefined;
  },
};
