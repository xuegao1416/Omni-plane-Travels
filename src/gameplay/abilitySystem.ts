import type {
  InnateTalentDef,
  ProfessionAbilityDef,
  SkillDef,
  TalentDef,
} from '../modules/schema';
import type { CombatActionDefinition } from '../modules/schema';
import type { GameplayCost, GameplayEffect, GameplayReward } from './types';
import type {
  AbilityCategory,
  AbilityDefinition,
  AbilityInstance,
  AbilityProposal,
  AbilityRarity,
  AbilityRuntime,
} from './protocols';
import { normalizeAbilityProposal } from './protocols';
import type { GameState } from '../schema/variables';

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

type AbilityMechanics = NonNullable<AbilityDefinition['mechanics']>;

interface LegacyActivation {
  costs?: GameplayCost[];
  effects?: GameplayEffect[];
  rewards?: GameplayReward[];
  combatAction?: CombatActionDefinition;
}

function mechanicsFromLegacy(source: {
  activation?: LegacyActivation;
  passiveEffects?: GameplayEffect[];
  mechanics?: ProfessionAbilityDef['mechanics'];
  cooldownTicks?: number;
  diceModifier?: number;
  proficiency?: SkillDef['proficiency'];
}): AbilityMechanics | undefined {
  const activation = source.activation;
  const mechanics: AbilityMechanics = {
    ...(activation?.costs?.length ? { costs: clone(activation.costs) } : {}),
    ...(activation?.effects?.length ? { effects: clone(activation.effects) } : {}),
    ...(activation?.rewards?.length ? { rewards: clone(activation.rewards) } : {}),
    ...(source.passiveEffects?.length ? { passiveEffects: clone(source.passiveEffects) } : {}),
    ...(source.mechanics?.combat ? { combat: clone(source.mechanics.combat) } : {}),
    ...(source.mechanics?.checks?.length ? { checks: clone(source.mechanics.checks) } : {}),
    ...(activation?.combatAction ? { combatAction: clone(activation.combatAction) } : {}),
    ...(Number.isFinite(Number(source.cooldownTicks)) ? { cooldownRounds: Math.max(0, Math.trunc(Number(source.cooldownTicks))) } : {}),
    ...(Number.isFinite(Number(source.diceModifier)) ? { diceModifier: Number(source.diceModifier) } : {}),
    ...(source.proficiency ? {
      proficiency: {
        gainPerUse: Math.max(0, Math.trunc(source.proficiency.gainPerUse ?? 1)),
        thresholdPerRank: Math.max(1, Math.trunc(source.proficiency.thresholdPerRank ?? 10)),
        ...(source.proficiency.maxRank === undefined ? {} : { maxRank: Math.max(1, Math.trunc(source.proficiency.maxRank)) }),
      },
    } : {}),
  };
  return Object.keys(mechanics).length ? mechanics : undefined;
}

/**
 * Every active combat ability must have a real runtime cost. Older profession
 * packs often declared a combat action and cooldown but omitted its cost,
 * which made the battle UI show a zero energy cost and effectively created free
 * skills. Explicit costs are preserved; only missing/zero-only costs receive
 * the controlled single-resource default.
 */
export function ensureCombatAbilityDefaults(source: AbilityDefinition): AbilityDefinition {
  const definition = clone(source);
  const mechanics = definition.mechanics;
  const combatAction = mechanics?.combatAction;
  const active = definition.category !== 'combat_item'
    && definition.category !== 'innate_talent'
    && definition.abilityType !== 'passive'
    && definition.abilityType !== 'specialization'
    && (definition.abilityType === undefined || definition.abilityType === 'active' || definition.abilityType === 'ultimate');
  if (!mechanics || !combatAction || !active) return definition;
  const hasPositiveCost = mechanics.costs?.some(cost => Number.isFinite(Number(cost.amount)) && Number(cost.amount) > 0) === true;
  if (!hasPositiveCost) {
    const tier = Math.max(1, Math.trunc(definition.tier ?? 1));
    const amount = definition.abilityType === 'ultimate'
      ? Math.min(8, 4 + Math.ceil(tier / 2))
      : Math.min(5, 1 + Math.ceil(tier / 2));
    mechanics.costs = [{ path: 'resource', amount, label: '能量' }];
  }
  if (mechanics.cooldownRounds === undefined && combatAction.cooldownRounds !== undefined) {
    mechanics.cooldownRounds = Math.max(0, Math.trunc(combatAction.cooldownRounds));
  }
  return definition;
}

export function abilityDefinitionFromProfessionAbility(source: ProfessionAbilityDef, professionId?: string): AbilityDefinition {
  const mechanics = mechanicsFromLegacy(source);
  return ensureCombatAbilityDefaults({
    schemaVersion: 2,
    id: source.id,
    name: source.name,
    description: source.description,
    category: 'profession',
    abilityType: source.type,
    rarity: '普通',
    ...(professionId ? { professionId } : {}),
    ...(source.tier === undefined ? {} : { tier: source.tier }),
    maxRank: Math.max(1, Math.trunc(source.maxRank ?? 1)),
    pointCost: Math.max(0, Math.trunc(source.pointCost ?? 1)),
    ...(source.rankCosts ? { rankCosts: source.rankCosts.map(cost => Math.max(0, Math.trunc(cost))) } : {}),
    ...(source.requiredProfessionLevel === undefined ? {} : { requiredProfessionLevel: source.requiredProfessionLevel }),
    prerequisites: [...(source.prerequisites ?? [])],
    prerequisiteMode: source.prerequisiteMode ?? 'all',
    ...(source.exclusiveGroup ? { exclusiveGroup: source.exclusiveGroup } : {}),
    tags: [...(source.tags ?? [])],
    ...(source.iconKey ? { iconKey: source.iconKey } : {}),
    ...(mechanics ? { mechanics } : {}),
    legacy: clone(source) as unknown as Record<string, unknown>,
  });
}

export function abilityDefinitionFromInnateTalent(source: InnateTalentDef): AbilityDefinition {
  const mechanics: AbilityMechanics = {
    ...(source.effects?.length ? { effects: clone(source.effects) } : {}),
    ...(source.mechanics?.combat ? { combat: clone(source.mechanics.combat) } : {}),
    ...(source.mechanics?.checks?.length ? { checks: clone(source.mechanics.checks) } : {}),
  };
  return {
    schemaVersion: 2,
    id: source.id,
    name: source.name,
    description: source.description,
    category: 'innate_talent',
    abilityType: 'passive',
    rarity: source.rarity ?? '普通',
    maxRank: 1,
    pointCost: Math.max(0, Math.trunc(source.cost)),
    prerequisites: [...(source.prerequisites ?? [])],
    prerequisiteMode: 'all',
    ...(source.exclusiveGroup ? { exclusiveGroup: source.exclusiveGroup } : {}),
    tags: [...(source.tags ?? [])],
    ...(source.iconKey ? { iconKey: source.iconKey } : {}),
    ...(Object.keys(mechanics).length ? { mechanics } : {}),
    legacy: clone(source) as unknown as Record<string, unknown>,
  };
}

/** Adapter for the older generic talent module; the module remains a compatibility shell. */
export function abilityDefinitionFromTalent(source: TalentDef): AbilityDefinition {
  const mechanics: AbilityMechanics = {
    ...(source.mechanics?.passive?.length ? { passiveEffects: clone(source.mechanics.passive) } : {}),
    ...(source.mechanics?.onUnlock?.length ? { effects: clone(source.mechanics.onUnlock) } : {}),
    ...(Number.isFinite(Number(source.diceModifier)) ? { diceModifier: Number(source.diceModifier) } : {}),
  };
  return {
    schemaVersion: 2,
    id: source.id,
    name: source.name,
    description: source.description,
    category: 'dynamic',
    abilityType: 'passive',
    rarity: source.rarity,
    maxRank: Math.max(1, Math.trunc(source.maxRank ?? 1)),
    pointCost: Math.max(0, Math.trunc(source.pointCost ?? 1)),
    ...(source.rankCosts ? { rankCosts: source.rankCosts.map(cost => Math.max(0, Math.trunc(cost))) } : {}),
    prerequisites: [...(source.prerequisites ?? [])],
    prerequisiteMode: 'all',
    ...(source.exclusiveGroup ? { exclusiveGroup: source.exclusiveGroup } : {}),
    tags: source.branch ? [source.branch] : [],
    ...(Object.keys(mechanics).length ? { mechanics } : {}),
    legacy: clone(source) as unknown as Record<string, unknown>,
  };
}

export function abilityDefinitionFromSkill(source: SkillDef): AbilityDefinition {
  const mechanics = mechanicsFromLegacy(source);
  return ensureCombatAbilityDefaults({
    schemaVersion: 2,
    id: source.id,
    name: source.name,
    description: source.description,
    category: 'free_skill',
    abilityType: 'active',
    rarity: source.rarity,
    maxRank: Math.max(1, Math.trunc(source.maxRank ?? source.proficiency?.maxRank ?? 1)),
    pointCost: Math.max(0, Math.trunc(source.pointCost ?? 0)),
    ...(source.rankCosts ? { rankCosts: source.rankCosts.map(cost => Math.max(0, Math.trunc(cost))) } : {}),
    prerequisites: [...(source.prerequisites ?? [])],
    prerequisiteMode: 'all',
    ...(source.exclusiveGroup ? { exclusiveGroup: source.exclusiveGroup } : {}),
    tags: [...(source.tags ?? [])],
    ...(mechanics ? { mechanics } : {}),
    legacy: clone(source) as unknown as Record<string, unknown>,
  });
}

export function abilityRankCost(definition: AbilityDefinition, rank: number): number {
  return Math.max(0, definition.rankCosts?.[Math.max(0, rank - 1)] ?? definition.pointCost);
}

export function createAbilityRuntime(rank = 1): AbilityRuntime {
  return { rank: Math.max(0, Math.trunc(rank)), uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: false };
}

export function createAbilityInstance(definition: AbilityDefinition, source: AbilityCategory = definition.category, acquiredAt = Date.now()): AbilityInstance {
  return {
    definitionId: definition.id,
    source,
    acquiredAt,
    runtime: createAbilityRuntime(1),
  };
}

const RARITY_POWER: Record<AbilityRarity, number> = {
  普通: 1,
  精良: 2,
  稀有: 3,
  史诗: 4,
  传说: 5,
};

function combatTarget(target: AbilityProposal['target']): 'enemy' | 'ally' | 'self' | 'area' | 'none' {
  return target;
}

export function balanceAbilityProposal(proposal: AbilityProposal): AbilityDefinition {
  const power = RARITY_POWER[proposal.rarity];
  const target = proposal.target;
  const passive = proposal.category === 'innate_talent';
  const healing = target === 'self' || target === 'ally' ? power * 2 : 0;
  const damage = passive || healing > 0 ? 0 : power * (target === 'area' ? 3 : 2);
  const cooldownRounds = passive ? 0 : Math.max(1, 5 - Math.ceil(power / 2));
  const resourceCost = passive ? 0 : Math.max(1, Math.ceil(power / 2));
  const semanticTags = proposal.tags.map(tag => tag.toLowerCase());
  const status = !passive && damage > 0
    ? semanticTags.some(tag => /毒|poison/.test(tag))
      ? { id: 'poisoned', name: '中毒', durationRounds: 2, damagePerRound: Math.max(1, Math.ceil(power / 2)) }
      : semanticTags.some(tag => /火|燃|burn|fire/.test(tag))
        ? { id: 'burning', name: '灼烧', durationRounds: 2, damagePerRound: Math.max(1, Math.ceil(power / 2)) }
        : semanticTags.some(tag => /控|眩|stun|control/.test(tag))
          ? { id: 'off-balance', name: '失衡', durationRounds: 1, modifiers: { accuracy: -Math.max(1, power) } }
          : undefined
    : undefined;
  const mechanics: AbilityMechanics = passive
    ? { combat: { armor: power >= 4 ? 1 : 0, initiative: power >= 5 ? 1 : 0 }, checks: [{ statIds: ['dim4'], value: power }] }
    : {
      costs: [{ path: 'resource', amount: resourceCost, label: '能量' }],
      cooldownRounds,
      proficiency: { gainPerUse: 1, thresholdPerRank: 10, maxRank: proposal.category === 'free_skill' || proposal.category === 'dynamic' ? 5 : 1 },
      combat: { ...(damage ? { damage } : {}), ...(healing ? { healing } : {}) },
      ...(status ? { statuses: [status.name] } : {}),
      combatAction: {
        id: proposal.id,
        name: proposal.name,
        description: proposal.description,
        target: combatTarget(target),
        actionCost: 1,
        accuracy: 10 + power,
        ...(damage ? { damage } : {}),
        ...(healing ? { healing } : {}),
        cooldownRounds,
        ...(status ? { appliesStatus: status } : {}),
        scaling: [{ statId: target === 'self' || target === 'ally' ? 'dim4' : 'dim1', coefficient: 0.05 + power * 0.02, appliesTo: healing ? 'healing' : 'damage' }],
      },
    };
  return {
    schemaVersion: 2,
    id: proposal.id,
    name: proposal.name,
    description: proposal.description,
    category: proposal.category,
    abilityType: passive ? 'passive' : 'active',
    rarity: proposal.rarity,
    maxRank: proposal.category === 'free_skill' ? 5 : 1,
    pointCost: Math.min(5, 1 + Math.floor(power / 2)),
    prerequisites: [],
    prerequisiteMode: 'all',
    tags: [...proposal.tags],
    mechanics,
    legacy: { source: 'AbilityProposal', semanticOnly: true },
  };
}

export interface PendingAbilityProposal {
  proposal: AbilityProposal;
  preview: AbilityDefinition;
}

export interface AbilityLibraryRuntime {
  definitions: Record<string, AbilityDefinition>;
  pending: Record<string, PendingAbilityProposal>;
  instances: Record<string, AbilityInstance>;
}

export function createAbilityLibraryRuntime(): AbilityLibraryRuntime {
  return { definitions: {}, pending: {}, instances: {} };
}

export function stageAbilityProposal(runtime: AbilityLibraryRuntime, proposal: AbilityProposal): { state: AbilityLibraryRuntime; preview: AbilityDefinition } {
  const preview = balanceAbilityProposal(proposal);
  const state = clone(runtime);
  state.pending[proposal.id] = { proposal: clone(proposal), preview: clone(preview) };
  return { state, preview };
}

export function confirmAbilityProposal(runtime: AbilityLibraryRuntime, proposalId: string): { state: AbilityLibraryRuntime; definition?: AbilityDefinition } {
  const state = clone(runtime);
  const pending = state.pending[proposalId];
  if (!pending) return { state };
  state.definitions[proposalId] = clone(pending.preview);
  delete state.pending[proposalId];
  return { state, definition: clone(pending.preview) };
}

export function isMechanicalAbilityDefinition(definition: AbilityDefinition): boolean {
  const mechanics = definition.mechanics;
  if (!mechanics) return false;
  return Boolean(
    mechanics.costs?.length
    || mechanics.effects?.length
    || mechanics.rewards?.length
    || mechanics.passiveEffects?.length
    || mechanics.combatAction
    || mechanics.checks?.length
    || Object.values(mechanics.combat ?? {}).some(value => Number(value) !== 0)
    || mechanics.cooldownRounds
    || mechanics.proficiency
    || mechanics.diceModifier
    || mechanics.multiplier
    || mechanics.statuses?.length,
  );
}

function ensureV3State(state: GameState): NonNullable<GameState['v3']> {
  state.v3 ??= {
    schemaVersion: 3,
    featureFlags: { professionsEnabled: false, combatEnabled: false, combatRiskMode: 'normal' },
  };
  return state.v3;
}

/** Stage a semantic-only model proposal. Existing owned abilities always win. */
export function stageAbilityProposalOnGameState(stateInput: GameState, proposalInput: unknown): { state: GameState; proposal?: AbilityProposal; staged: boolean } {
  const state = clone(stateInput);
  const proposal = normalizeAbilityProposal(proposalInput);
  if (!proposal || proposal.category === 'combat_item' || proposal.category === 'innate_talent' || proposal.category === 'profession') {
    return { state, staged: false };
  }
  const v3 = ensureV3State(state);
  if (v3.abilityDefinitions?.[proposal.id] || v3.abilityInstances?.[proposal.id]) return { state, proposal, staged: false };
  v3.pendingAbilityProposals = { ...(v3.pendingAbilityProposals ?? {}), [proposal.id]: proposal };
  return { state, proposal, staged: true };
}

/** Confirm/reject is local and deterministic; model-supplied mechanical fields are never read. */
export function resolveAbilityProposalOnGameState(
  stateInput: GameState,
  proposalId: string,
  decision: 'accept' | 'reject',
  acquiredAt = Date.now(),
): { state: GameState; definition?: AbilityDefinition; resolved: boolean } {
  const state = clone(stateInput);
  const v3 = ensureV3State(state);
  const proposal = v3.pendingAbilityProposals?.[proposalId];
  if (!proposal) return { state, resolved: false };
  const remaining = { ...(v3.pendingAbilityProposals ?? {}) };
  delete remaining[proposalId];
  if (Object.keys(remaining).length) v3.pendingAbilityProposals = remaining;
  else delete v3.pendingAbilityProposals;
  if (decision === 'reject') return { state, resolved: true };

  const definition = balanceAbilityProposal(proposal);
  v3.abilityDefinitions = { ...(v3.abilityDefinitions ?? {}), [definition.id]: definition };
  v3.abilityInstances = { ...(v3.abilityInstances ?? {}), [definition.id]: createAbilityInstance(definition, definition.category, acquiredAt) };
  state.玩家.技能系统 = {
    ...(state.玩家.技能系统 ?? {}),
    [definition.id]: { 品质: definition.rarity, 描述: definition.description, 类型: definition.category === 'pet' ? '宠物能力' : definition.category === 'summon' ? '召唤能力' : '自由技能' },
  };
  const abilityState = state.玩家.能力系统 ?? {
    天赋点: 0,
    技能点: 0,
    已解锁天赋: {},
    已掌握技能: {},
  };
  abilityState.已掌握技能 = {
    ...abilityState.已掌握技能,
    [definition.id]: { 等级: 1, 使用次数: 0, 熟练度: 0 },
  };
  state.玩家.能力系统 = abilityState;
  return { state, definition, resolved: true };
}
