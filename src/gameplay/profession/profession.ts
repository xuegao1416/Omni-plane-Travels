import type {
  DiceRuntimeBonus,
  ProfessionAbilityDef,
  ProfessionAbilityMechanics,
  ProfessionCombatModifiers,
  ProfessionModuleSchema,
  StatModuleSchema,
} from '../../modules/schema';
import type { GameState } from '../../schema/variables';
import { abilityDefinitionFromInnateTalent, abilityDefinitionFromProfessionAbility, abilityDefinitionFromSkill, createAbilityInstance } from '../abilitySystem';
import { combatStatLabel, describeCombatActionFormula } from '../combatMath';
import { FactRegistry } from '../../core/facts';
import { gameplayEffectToOp } from '../../core/legacy';
import { applyOps, type Op } from '../../core/ops';
import { Rng, createRngState } from '../../core/rng';
import { DIVINE_TALENT_COST } from '../creation/creationPoints';

export interface ResolvedProfessionBonuses {
  combat: Required<ProfessionCombatModifiers>;
  checks: DiceRuntimeBonus[];
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function validateProfessionSelection(
  config: ProfessionModuleSchema,
  professionId: string | null,
  talentIds: readonly string[],
  budgetOverride?: number,
): { ok: boolean; reason?: string; spent: number; remaining: number } {
  const requestedBudget = budgetOverride ?? config.creationTalentBudget;
  const budget = Number.isFinite(requestedBudget) ? Math.max(0, Math.trunc(requestedBudget)) : 0;
  if (!professionId && config.allowNoProfession === false) {
    return { ok: false, reason: '这个世界必须选择职业', spent: 0, remaining: budget };
  }
  if (professionId && !config.professions.some(item => item.id === professionId)) {
    return { ok: false, reason: '所选职业不存在', spent: 0, remaining: budget };
  }

  const uniqueIds = [...new Set(talentIds)];
  const selected = uniqueIds.map(id => config.innateTalents.find(item => item.id === id));
  if (selected.some(item => !item)) {
    return { ok: false, reason: '包含不存在的先天天赋', spent: 0, remaining: budget };
  }
  const groups = new Set<string>();
  for (const talent of selected) {
    if (!talent?.exclusiveGroup) continue;
    if (groups.has(talent.exclusiveGroup)) {
      return { ok: false, reason: `天赋互斥：${talent.exclusiveGroup}`, spent: 0, remaining: budget };
    }
    groups.add(talent.exclusiveGroup);
  }
  const selectedIds = new Set(uniqueIds);
  for (const talent of selected) {
    if (talent?.prerequisites?.some(id => !selectedIds.has(id))) {
      return { ok: false, reason: `天赋「${talent.name}」缺少前置天赋`, spent: 0, remaining: budget };
    }
  }
  const spent = selected.reduce((sum, item) => {
    const cost = Math.max(0, Math.trunc(item?.cost ?? 0));
    return cost >= DIVINE_TALENT_COST ? sum : sum + cost;
  }, 0);
  if (spent > budget) return { ok: false, reason: '先天天赋预算不足', spent, remaining: budget - spent };
  return { ok: true, spent, remaining: budget - spent };
}

export function initializeProfessionSelection(
  source: GameState,
  config: ProfessionModuleSchema,
  professionId: string | null,
  talentIds: readonly string[],
  options: { talentBudgetOverride?: number } = {},
): GameState {
  const validation = validateProfessionSelection(config, professionId, talentIds, options.talentBudgetOverride);
  if (!validation.ok) throw new Error(validation.reason);
  const state = clone(source);
  const profession = config.professions.find(item => item.id === professionId);
  const previous = state.玩家.能力系统;
  state.玩家.能力系统 = {
    天赋点: previous?.天赋点 ?? 0,
    技能点: previous?.技能点 ?? 0,
    已解锁天赋: previous?.已解锁天赋 ?? {},
    已掌握技能: previous?.已掌握技能 ?? {},
    已觉醒: previous?.已觉醒 ?? {},
    装备槽: previous?.装备槽 ?? {},
    后天天赋: previous?.后天天赋 ?? {},
    先天天赋: Object.fromEntries(talentIds.map(id => {
      const talent = config.innateTalents.find(item => item.id === id)!;
      return [id, { 选择时间: 'creation' as const, 名称: talent.name }];
    })),
    职业状态: {
      职业ID: profession?.id ?? null,
      职业名称: profession?.name ?? '无职业',
      职业等级: 1,
      能力点: Math.max(0, Math.trunc(config.initialAbilityPoints ?? 0)),
      已解锁能力: {},
    },
  };
  state.玩家.身份信息.职业 = profession?.name ?? state.玩家.身份信息.职业;

  const effects = talentIds.flatMap(id => {
    const talent = config.innateTalents.find(item => item.id === id);
    return talent ? abilityDefinitionFromInnateTalent(talent).mechanics?.effects ?? [] : [];
  });
  // 先天天赋的开局效果：整体生效或整体不生效（与旧事务一致）。
  const ops = effects.flatMap(effect => { const op = gameplayEffectToOp(effect); return op ? [op] : [] as Op[]; });
  const initialized = ops.length === 0 ? state : applyOps(state, ops, {
    facts: new FactRegistry(), source: 'system', turn: 0, rng: new Rng(createRngState('profession:creation')), sourceLabel: '应用创建角色先天天赋',
  }).state;
  return synchronizeProfessionAbilities(initialized, config);
}

/**
 * Project owned legacy/runtime profession data into the v3 unified library.
 * This also repairs old saves when they first enter a v3 combat encounter.
 */
export function synchronizeProfessionAbilities(source: GameState, config: ProfessionModuleSchema): GameState {
  const state = clone(source);
  state.v3 ??= {
    schemaVersion: 3,
    featureFlags: { professionsEnabled: true, combatEnabled: false, combatRiskMode: 'normal' },
  };
  const definitions = { ...(state.v3.abilityDefinitions ?? {}) };
  const instances = { ...(state.v3.abilityInstances ?? {}) };
  const abilityState = state.玩家.能力系统;
  const profession = config.professions.find(item => item.id === abilityState?.职业状态?.职业ID);

  const attach = (definition: ReturnType<typeof abilityDefinitionFromProfessionAbility>, rank: number, uses = 0, proficiency = 0, cooldownRemaining = 0) => {
    definitions[definition.id] = definition;
    const existing = instances[definition.id] ?? createAbilityInstance(definition, definition.category, 0);
    instances[definition.id] = {
      ...existing,
      definitionId: definition.id,
      source: definition.category,
      runtime: {
        ...existing.runtime,
        rank: Math.max(1, Math.trunc(rank)),
        uses: Math.max(existing.runtime.uses, Math.trunc(uses)),
        proficiency: Math.max(existing.runtime.proficiency, Math.trunc(proficiency)),
        cooldownRemaining: Math.max(0, Math.trunc(cooldownRemaining)),
      },
    };
  };

  for (const talent of config.innateTalents) {
    if (!abilityState?.先天天赋?.[talent.id]) continue;
    attach(abilityDefinitionFromInnateTalent(talent), 1);
  }
  for (const ability of profession?.abilities ?? []) {
    const owned = abilityState?.职业状态?.已解锁能力?.[ability.id];
    if (!owned) continue;
    attach(
      abilityDefinitionFromProfessionAbility(ability, profession?.id),
      owned.等级,
      owned.使用次数 ?? 0,
      0,
      Math.max(0, (owned.冷却至轮次 ?? 0) - (state.simulationRuntime?.tick ?? 0)),
    );
  }
  for (const skill of config.freeSkills ?? []) {
    const owned = abilityState?.已掌握技能?.[skill.id];
    if (!owned) continue;
    attach(
      abilityDefinitionFromSkill(skill),
      owned.等级,
      owned.使用次数,
      owned.熟练度 ?? 0,
      Math.max(0, (owned.冷却至轮次 ?? 0) - (state.simulationRuntime?.tick ?? 0)),
    );
  }
  state.v3.abilityDefinitions = definitions;
  state.v3.abilityInstances = instances;
  return state;
}

function selectedProfession(state: GameState, config: ProfessionModuleSchema) {
  const id = state.玩家.能力系统?.职业状态?.职业ID;
  return config.professions.find(item => item.id === id);
}

function addMechanics(
  target: ResolvedProfessionBonuses,
  source: string,
  mechanics: ProfessionAbilityMechanics | NonNullable<ReturnType<typeof abilityDefinitionFromProfessionAbility>['mechanics']> | undefined,
): void {
  if (!mechanics) return;
  for (const key of ['damage', 'healing', 'accuracy', 'armor', 'initiative'] as const) {
    const value = Number(mechanics.combat?.[key] ?? 0);
    if (Number.isFinite(value)) target.combat[key] += value;
  }
  for (const check of mechanics.checks ?? []) {
    const value = Number(check.value);
    if (!Number.isFinite(value) || value === 0) continue;
    target.checks.push({ source, value, ...(check.statIds?.length ? { statIds: [...check.statIds] } : {}) });
  }
}

/** 汇总当前角色真正拥有的职业节点与先天天赋；未解锁节点绝不参与结算。 */
export function resolveProfessionBonuses(state: GameState, config: ProfessionModuleSchema | undefined): ResolvedProfessionBonuses {
  const result: ResolvedProfessionBonuses = {
    combat: { damage: 0, healing: 0, accuracy: 0, armor: 0, initiative: 0 },
    checks: [],
  };
  if (!config) return result;
  const runtime = state.玩家.能力系统?.职业状态;
  const profession = config.professions.find(item => item.id === runtime?.职业ID);
  for (const ability of profession?.abilities ?? []) {
    if (!runtime?.已解锁能力?.[ability.id]) continue;
    const definition = abilityDefinitionFromProfessionAbility(ability, profession?.id);
    addMechanics(result, definition.name, definition.mechanics);
    if (Number.isFinite(Number(definition.mechanics?.diceModifier)) && Number(definition.mechanics?.diceModifier) !== 0) {
      result.checks.push({ source: definition.name, value: Number(definition.mechanics?.diceModifier) });
    }
  }
  const innateIds = new Set(Object.keys(state.玩家.能力系统?.先天天赋 ?? {}));
  for (const talent of config.innateTalents) {
    if (innateIds.has(talent.id)) {
      const definition = abilityDefinitionFromInnateTalent(talent);
      addMechanics(result, definition.name, definition.mechanics);
    }
  }
  return result;
}

export function describeProfessionMechanics(mechanics: ProfessionAbilityMechanics | undefined, statConfig?: StatModuleSchema): string {
  if (!mechanics) return '';
  const labels: Record<keyof ProfessionCombatModifiers, string> = {
    damage: '职业行动伤害', healing: '职业治疗', accuracy: '命中', armor: '护甲', initiative: '先手',
  };
  const parts = (Object.entries(mechanics.combat ?? {}) as Array<[keyof ProfessionCombatModifiers, number]>).flatMap(([key, raw]) => {
    const value = Number(raw);
    return Number.isFinite(value) && value !== 0 ? [`${labels[key]} ${value > 0 ? '+' : ''}${value}`] : [];
  });
  for (const check of mechanics.checks ?? []) {
    const names = check.statIds?.length ? check.statIds.map(id => combatStatLabel(id, statConfig)).join(' / ') : '全部';
    parts.push(`${names}检定 ${check.value >= 0 ? '+' : ''}${check.value}`);
  }
  return parts.join(' · ');
}

/** 面向玩家与 AI 的同一份机械说明，避免界面写一套、提示词猜一套。 */
export function describeProfessionAbilityMechanics(
  ability: ProfessionAbilityDef,
  statConfig?: StatModuleSchema,
  state?: GameState,
): string {
  return [
    ability.activation?.combatAction ? describeCombatActionFormula(ability.activation.combatAction, statConfig, state) : '',
    describeProfessionMechanics(ability.mechanics, statConfig),
  ].filter(Boolean).join(' · ');
}

export function resolveOwnedAbility(
  state: GameState,
  config: ProfessionModuleSchema,
  idOrName: string,
): ProfessionAbilityDef | undefined {
  const profession = selectedProfession(state, config);
  const owned = state.玩家.能力系统?.职业状态?.已解锁能力 ?? {};
  return profession?.abilities.find(item => (
    (item.id === idOrName || item.name === idOrName) && Boolean(owned[item.id])
  ));
}
