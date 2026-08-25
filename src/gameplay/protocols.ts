import type {
  CombatActionDefinition,
  CombatScalingStatId,
  ProfessionAccentKey,
  ProfessionAbilityType,
  ProfessionPack,
} from '../modules/schema';
import type { GameplayCost, GameplayEffect, GameplayReward } from './types';
import { createDefaultGameState, type GameState } from '../schema/variables';
import type { NarrativeDecisionRecord } from './narrativeDecision';
import type { ChatMessage } from '../engine/types';
import type { SimulationState } from '../simulation/types';
import type { ModuleStateRecord } from './moduleRuntime/types';

export type AbilityCategory = 'innate_talent' | 'profession' | 'free_skill' | 'dynamic' | 'pet' | 'summon' | 'combat_item';
export type AbilityRarity = '普通' | '精良' | '稀有' | '史诗' | '传说';
export type AbilityProposalTarget = 'self' | 'ally' | 'enemy' | 'area' | 'none';
export type CombatItemPurpose = 'heal' | 'resource' | 'damage' | 'cleanse' | 'buff';

/** AI may suggest meaning only; local code turns the proposal into balanced mechanics. */
export interface AbilityProposal {
  schemaVersion: 2;
  id: string;
  name: string;
  description: string;
  category: AbilityCategory;
  rarity: AbilityRarity;
  target: AbilityProposalTarget;
  tags: string[];
  /** Structured semantic hint for a combat item; never contains mechanical numbers. */
  itemPurpose?: CombatItemPurpose;
}

export interface AbilityDefinition {
  schemaVersion: 2;
  id: string;
  name: string;
  description: string;
  category: AbilityCategory;
  abilityType?: ProfessionAbilityType;
  rarity: AbilityRarity;
  professionId?: string;
  tier?: number;
  maxRank: number;
  pointCost: number;
  rankCosts?: number[];
  requiredProfessionLevel?: number;
  prerequisites: string[];
  prerequisiteMode?: 'all' | 'any';
  exclusiveGroup?: string;
  tags: string[];
  iconKey?: string;
  mechanics?: {
    costs?: GameplayCost[];
    effects?: GameplayEffect[];
    rewards?: GameplayReward[];
    passiveEffects?: GameplayEffect[];
    cooldownRounds?: number;
    proficiency?: { gainPerUse: number; thresholdPerRank: number; maxRank?: number };
    diceModifier?: number;
    multiplier?: number;
    statuses?: string[];
    combat?: { damage?: number; healing?: number; accuracy?: number; armor?: number; initiative?: number };
    checks?: Array<{ statIds?: CombatScalingStatId[]; value: number }>;
    combatAction?: CombatActionDefinition;
  };
  /** Original fields retained for lossless v1/v2 round trips and editor repair. */
  legacy?: Record<string, unknown>;
}

export interface AbilityRuntime {
  rank: number;
  uses: number;
  proficiency: number;
  cooldownRemaining: number;
  equipped: boolean;
}

export interface AbilityInstance {
  definitionId: string;
  source: AbilityCategory;
  acquiredAt: number;
  runtime: AbilityRuntime;
}

export interface ProfessionPackManifestV2 {
  id: string;
  name: string;
  version: string;
  schemaVersion: 2;
  description?: string;
  author?: string;
  createdAt?: number;
  updatedAt?: number;
  builtin?: boolean;
  tags: string[];
}

export interface ProfessionDefinitionV2 {
  id: string;
  name: string;
  description: string;
  archetype?: string;
  tags: string[];
  visual?: { emblemKey?: string; accentKey?: import('../modules/schema').ProfessionAccentKey };
  abilities: AbilityDefinition[];
}

export interface ProfessionPackV2 {
  schemaVersion: 2;
  manifest: ProfessionPackManifestV2;
  professions: ProfessionDefinitionV2[];
  innateTalents: AbilityDefinition[];
  freeSkills: AbilityDefinition[];
  creationTalentBudget: number;
  allowNoProfession: boolean;
  initialAbilityPoints: number;
  abilityPointsPerTier: number;
  baselineStatus?: 'v3-complete' | 'legacy-v1-incomplete';
  legacy?: Record<string, unknown>;
}

const LOCAL_PROFESSION_ICON_KEYS = new Set([
  'warrior', 'mage', 'ranger', 'rogue', 'cleric', 'paladin',
  'swordsman', 'bladesman', 'spearmaster', 'unarmed', 'healer', 'qimen',
]);
const LOCAL_PROFESSION_ACCENT_KEYS = new Set(['crimson', 'amber', 'jade', 'azure', 'violet', 'silver']);

export type CombatRiskMode = 'normal' | 'hard' | 'inferno';
export type CombatThreatBand = 'weak' | 'matched' | 'dangerous' | 'boss' | 'overwhelming';
export type CombatUnitSide = 'player' | 'ally' | 'enemy' | 'neutral';

export interface CombatEncounterActorProposal {
  id: string;
  identity: string;
  temporary: boolean;
  source?: 'player' | 'npc' | 'pet' | 'summon' | 'temporary';
}

export interface CombatEncounterProposal {
  schemaVersion: 2;
  id: string;
  context: string;
  threatBand: CombatThreatBand;
  allies: CombatEncounterActorProposal[];
  enemies: CombatEncounterActorProposal[];
  neutrals: CombatEncounterActorProposal[];
}

export type CombatEncounterRequestSource = 'event-workflow' | 'variable-hostile-action' | 'manual';

export interface CombatEncounterRequest {
  schemaVersion: 2;
  source: CombatEncounterRequestSource;
  proposal: CombatEncounterProposal;
  /** Variable-pipeline requests must prove that hostile action already occurred. */
  hostileAction?: {
    occurred: true;
    subjectId: string;
    targetId: string;
  };
}

export type CombatActionKind = 'attack' | 'skill' | 'item' | 'defend' | 'flee';

export interface CombatCommandInputV2 {
  commandId: string;
  unitId: string;
  kind: CombatActionKind;
  abilityId?: string;
  itemId?: string;
  targetIds: string[];
}

export interface CombatStatusV2 {
  id: string;
  name: string;
  remainingRounds: number;
  stacks: number;
  damagePerRound?: number;
  healingPerRound?: number;
  modifiers?: Record<string, number>;
}

export interface CombatStatusChangeV2 {
  targetId: string;
  statusId: string;
  operation: 'applied' | 'stacked' | 'removed' | 'expired';
  stacks: number;
}

export interface CombatResourceChangeV2 {
  unitId: string;
  resource: string;
  delta: number;
}

export interface CombatItemChangeV2 {
  unitId: string;
  itemId: string;
  delta: number;
}

export interface CombatStateBindingV2 {
  kind: 'player' | 'npc' | 'temporary';
  id: string;
  hpPath?: string;
  resourcePath?: string;
  inventoryPath?: string;
  injuryPath?: string;
  originalHp: number;
  originalMaxHp: number;
  originalResource: number;
  originalMaxResource: number;
  originalItemQuantities: Record<string, number>;
}

export interface CombatActionRecordV2 {
  id: string;
  commandId: string;
  transactionId: string;
  round: number;
  unitId: string;
  kind: CombatActionKind;
  targetIds: string[];
  input?: CombatCommandInputV2;
  hit?: boolean;
  critical?: boolean;
  damage: number;
  healing: number;
  statusChanges: CombatStatusChangeV2[];
  resourceChanges: CombatResourceChangeV2[];
  itemChanges: CombatItemChangeV2[];
  resolved: boolean;
  rejected?: boolean;
  reason?: string;
}

export interface CombatParticipantV2 {
  id: string;
  side: CombatUnitSide;
  identity: string;
  hp: number;
  maxHp: number;
  statuses: string[];
  cooldowns: Record<string, number>;
  items: string[];
  actedRound: number;
  source?: 'player' | 'ally' | 'enemy' | 'pet' | 'summon' | 'temporary';
  temporary?: boolean;
  resource?: number;
  maxResource?: number;
  attackPower?: number;
  healingPower?: number;
  armor?: number;
  accuracy?: number;
  evasion?: number;
  critChance?: number;
  initiative?: number;
  /** World attributes normalized to a canonical 0–100 scale for formulas. */
  normalizedAttributes?: Partial<Record<CombatScalingStatId, number>>;
  defending?: boolean;
  abilityDefinitions?: Record<string, AbilityDefinition>;
  abilityInstances?: Record<string, AbilityInstance>;
  itemQuantities?: Record<string, number>;
  typedStatuses?: CombatStatusV2[];
  stateBinding?: CombatStateBindingV2;
}

export interface CombatWaveV2 {
  id: string;
  unitIds: string[];
}

export interface CombatItemDefinition {
  schemaVersion: 2;
  id: string;
  name: string;
  description: string;
  purpose: CombatItemPurpose;
  target: AbilityProposalTarget;
  amount: number;
  statusId?: string;
  status?: CombatStatusV2;
  ability: AbilityDefinition;
  narrativeOnly: boolean;
}

export interface CombatItemInstance {
  definitionId: string;
  quantity: number;
}

export interface CombatCheckpointV2 {
  schemaVersion: 2;
  sessionId: string;
  capturedAt: number;
  round: number;
  seed: number;
  randomCursor: number;
  participants: CombatParticipantV2[];
  gameState: GameState;
  messages?: ChatMessage[];
  memoryRuntime?: unknown;
  vectorMemory?: unknown[];
  worldSimulationState?: SimulationState;
  moduleStates?: ModuleStateRecord[];
  moduleCheckpoints?: ModuleStateRecord[];
  checkpointRevision: number;
}

export interface CombatResult {
  status: 'victory' | 'defeat' | 'escaped' | 'draw';
  rewardEffects: GameplayEffect[];
  rewardsApplied: boolean;
  narration: {
    status: 'pending' | 'succeeded' | 'failed';
    attempts: number;
    requestId?: string;
    error?: string;
  };
  terminalTransactionId?: string;
  endedAt?: number;
  report?: CombatMechanicalReportV2;
}

export interface CombatMechanicalReportV2 {
  encounter: { id: string; context: string; threatBand: CombatThreatBand };
  riskMode: CombatRiskMode;
  participants: Array<{
    id: string;
    identity: string;
    side: CombatUnitSide;
    source?: CombatParticipantV2['source'];
    hp: number;
    maxHp: number;
    resource?: number;
    status: 'active' | 'wounded' | 'incapacitated' | 'dead';
  }>;
  actions: CombatActionRecordV2[];
  skillsUsed: string[];
  itemsUsed: string[];
  injuries: Array<{ unitId: string; hp: number; status: 'wounded' | 'incapacitated' | 'dead' }>;
  deaths: string[];
  rewards: GameplayEffect[];
  finalState: {
    status: CombatResult['status'];
    round: number;
    activeUnitId: string;
    units: Array<{ id: string; hp: number; resource?: number }>;
  };
}

export interface CombatSessionV2 {
  schemaVersion: 2;
  id: string;
  encounter: CombatEncounterProposal;
  riskMode: CombatRiskMode;
  /** World-facing names for the canonical health/resource pools. */
  statLabels?: { health: string; resource: string };
  seed: number;
  round: number;
  activeUnitId: string;
  actionPointsPerTurn: number;
  participants: CombatParticipantV2[];
  actionSequence: CombatActionRecordV2[];
  preCombatCheckpoint: CombatCheckpointV2;
  status: 'active' | 'victory' | 'defeat' | 'escaped' | 'draw';
  lifecycle: 'preparing' | 'active' | 'terminal';
  availableAllyPool: CombatParticipantV2[];
  availableEnemyPool: CombatParticipantV2[];
  resolvedParticipants?: CombatParticipantV2[];
  lockedEnemyIds: string[];
  waves: CombatWaveV2[];
  initiativeOrder: string[];
  randomCursor: number;
  appliedTransactionIds: string[];
  abilityDefinitions: Record<string, AbilityDefinition>;
  abilityInstances: Record<string, AbilityInstance>;
  itemDefinitions: Record<string, CombatItemDefinition>;
  rewardEffects?: GameplayEffect[];
  result?: CombatResult;
}

export interface V3FeatureFlags {
  professionsEnabled: boolean;
  combatEnabled: boolean;
  combatRiskMode: CombatRiskMode;
}

export interface V3GameStateRuntime {
  schemaVersion: 3;
  featureFlags: V3FeatureFlags;
  /** Validated proposal waiting for the typed encounter decision card. */
  pendingEncounterRequest?: CombatEncounterRequest;
  combatSession?: CombatSessionV2;
  combatResult?: CombatResult;
  /** Unified definitions/instances; absent keeps old saves unchanged. */
  abilityDefinitions?: Record<string, AbilityDefinition>;
  abilityInstances?: Record<string, AbilityInstance>;
  pendingAbilityProposals?: Record<string, AbilityProposal>;
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function number(value: unknown, fallback: number, min = -999999, max = 999999): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function integer(value: unknown, fallback: number, min = 0, max = 999999): number {
  return Math.trunc(number(value, fallback, min, max));
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim()))]
    : [];
}

function abilityCategory(value: unknown, fallback: AbilityCategory): AbilityCategory {
  return value === 'innate_talent' || value === 'profession' || value === 'free_skill'
    || value === 'dynamic' || value === 'pet' || value === 'summon' || value === 'combat_item'
    ? value
    : fallback;
}

function abilityType(value: unknown): ProfessionAbilityType | undefined {
  return value === 'active' || value === 'passive' || value === 'specialization' || value === 'ultimate' ? value : undefined;
}

export function normalizeAbilityProposal(input: unknown): AbilityProposal | undefined {
  const raw = record(input);
  if (!raw) return undefined;
  const id = text(raw.id, '');
  const name = text(raw.name, '');
  if (!id || !name || typeof raw.description !== 'string' || !raw.description.trim()) return undefined;
  const target = raw.target === 'self' || raw.target === 'ally' || raw.target === 'enemy' || raw.target === 'area' ? raw.target : 'none';
  return {
    schemaVersion: 2,
    id,
    name,
    description: raw.description.trim(),
    category: abilityCategory(raw.category, 'dynamic'),
    rarity: rarity(raw.rarity),
    target,
    tags: strings(raw.tags),
    ...(raw.itemPurpose === 'heal' || raw.itemPurpose === 'resource' || raw.itemPurpose === 'damage' || raw.itemPurpose === 'cleanse' || raw.itemPurpose === 'buff'
      ? { itemPurpose: raw.itemPurpose }
      : {}),
  };
}

function rarity(value: unknown): AbilityRarity {
  return value === '精良' || value === '稀有' || value === '史诗' || value === '传说' ? value : '普通';
}

function copiedArray<T>(value: unknown): T[] | undefined {
  return Array.isArray(value) ? clone(value) as T[] : undefined;
}

function normalizeAbility(value: unknown, fallbackCategory: AbilityCategory, professionId?: string): AbilityDefinition | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const id = text(raw.id, '');
  if (!id) return undefined;
  const mechanics = record(raw.mechanics);
  const activation = record(raw.activation);
  const combat = record(mechanics?.combat);
  const checks = Array.isArray(mechanics?.checks)
    ? mechanics.checks.map(item => {
      const check = record(item);
      if (!check) return undefined;
      return { statIds: strings(check.statIds) as CombatScalingStatId[], value: number(check.value, 0) };
    }).filter((item): item is { statIds: CombatScalingStatId[]; value: number } => Boolean(item))
    : undefined;
  const combatModifiers = combat ? {
    ...(Number.isFinite(Number(combat.damage)) ? { damage: number(combat.damage, 0) } : {}),
    ...(Number.isFinite(Number(combat.healing)) ? { healing: number(combat.healing, 0) } : {}),
    ...(Number.isFinite(Number(combat.accuracy)) ? { accuracy: number(combat.accuracy, 0) } : {}),
    ...(Number.isFinite(Number(combat.armor)) ? { armor: number(combat.armor, 0) } : {}),
    ...(Number.isFinite(Number(combat.initiative)) ? { initiative: number(combat.initiative, 0) } : {}),
  } : undefined;
  const costs = copiedArray<GameplayCost>(Array.isArray(mechanics?.costs) && mechanics.costs.length ? mechanics.costs : activation?.costs);
  const effects = copiedArray<GameplayEffect>(Array.isArray(mechanics?.effects) && mechanics.effects.length ? mechanics.effects : activation?.effects);
  const rewards = copiedArray<GameplayReward>(Array.isArray(mechanics?.rewards) && mechanics.rewards.length ? mechanics.rewards : activation?.rewards);
  const passiveEffects = copiedArray<GameplayEffect>(Array.isArray(mechanics?.passiveEffects) && mechanics.passiveEffects.length ? mechanics.passiveEffects : raw.passiveEffects);
  const combatActionRaw = record(mechanics?.combatAction) ?? record(activation?.combatAction);
  const combatAction = combatActionRaw ? clone(combatActionRaw) as unknown as CombatActionDefinition : undefined;
  const cooldownValue = mechanics?.cooldownRounds ?? raw.cooldownRounds ?? raw.cooldownTicks;
  const proficiencyRaw = record(mechanics?.proficiency ?? raw.proficiency);
  const proficiency = proficiencyRaw ? {
    gainPerUse: integer(proficiencyRaw.gainPerUse, 1, 0, 999),
    thresholdPerRank: integer(proficiencyRaw.thresholdPerRank, 10, 1, 999999),
    ...(Number.isFinite(Number(proficiencyRaw.maxRank)) ? { maxRank: integer(proficiencyRaw.maxRank, 1, 1, 99) } : {}),
  } : undefined;
  const statuses = strings(mechanics?.statuses);
  const legacySource = record(raw.legacy);
  const legacy = legacySource ? clone(legacySource) : clone(raw);
  const normalizedMechanics = {
    ...(costs?.length ? { costs } : {}),
    ...(effects?.length ? { effects } : {}),
    ...(rewards?.length ? { rewards } : {}),
    ...(passiveEffects?.length ? { passiveEffects } : {}),
    ...(Number.isFinite(Number(cooldownValue)) ? { cooldownRounds: integer(cooldownValue, 0, 0, 999999) } : {}),
    ...(proficiency ? { proficiency } : {}),
    ...(Number.isFinite(Number(mechanics?.diceModifier ?? raw.diceModifier)) ? { diceModifier: number(mechanics?.diceModifier ?? raw.diceModifier, 0) } : {}),
    ...(Number.isFinite(Number(mechanics?.multiplier)) ? { multiplier: number(mechanics?.multiplier, 1, 0, 100) } : {}),
    ...(statuses.length ? { statuses } : {}),
    ...(combatModifiers && Object.keys(combatModifiers).length > 0 ? { combat: combatModifiers } : {}),
    ...(checks?.length ? { checks } : {}),
    ...(combatAction ? { combatAction } : {}),
  };
  return {
    schemaVersion: 2,
    id,
    name: text(raw.name, id),
    description: text(raw.description, ''),
    category: abilityCategory(raw.category, fallbackCategory),
    abilityType: abilityType(raw.abilityType ?? raw.type),
    rarity: rarity(raw.rarity),
    ...(professionId ? { professionId } : {}),
    ...(Number.isFinite(Number(raw.tier)) ? { tier: integer(raw.tier, 1, 1, 99) } : {}),
    maxRank: integer(raw.maxRank, 1, 1, 99),
    pointCost: integer(raw.pointCost ?? raw.cost, 1, 0, 999),
    ...(Array.isArray(raw.rankCosts) ? { rankCosts: raw.rankCosts.map(item => integer(item, 0, 0, 999)) } : {}),
    ...(Number.isFinite(Number(raw.requiredProfessionLevel)) ? { requiredProfessionLevel: integer(raw.requiredProfessionLevel, 1, 1, 99) } : {}),
    prerequisites: strings(raw.prerequisites),
    prerequisiteMode: raw.prerequisiteMode === 'any' ? 'any' : 'all',
    ...(typeof raw.exclusiveGroup === 'string' && raw.exclusiveGroup.trim() ? { exclusiveGroup: raw.exclusiveGroup.trim() } : {}),
    tags: strings(raw.tags),
    ...(typeof raw.iconKey === 'string' && LOCAL_PROFESSION_ICON_KEYS.has(raw.iconKey.trim()) ? { iconKey: raw.iconKey.trim() } : {}),
    ...(Object.keys(normalizedMechanics).length ? { mechanics: normalizedMechanics } : {}),
    legacy,
  };
}

function normalizeManifest(value: unknown): ProfessionPackManifestV2 {
  const raw = record(value);
  const id = text(raw?.id, 'profession-pack');
  return {
    id,
    name: text(raw?.name, id),
    version: text(raw?.version, '1.0.0'),
    schemaVersion: 2,
    ...(typeof raw?.description === 'string' ? { description: raw.description } : {}),
    ...(typeof raw?.author === 'string' ? { author: raw.author } : {}),
    ...(Number.isFinite(Number(raw?.createdAt)) ? { createdAt: number(raw?.createdAt, 0) } : {}),
    ...(Number.isFinite(Number(raw?.updatedAt)) ? { updatedAt: number(raw?.updatedAt, 0) } : {}),
    ...(typeof raw?.builtin === 'boolean' ? { builtin: raw.builtin } : {}),
    tags: strings(raw?.tags),
  };
}

export function migrateProfessionPack(input: unknown): ProfessionPackV2 {
  const raw = record(input) ?? {};
  const manifest = normalizeManifest(raw.manifest);
  const packLegacy = record(raw.legacy) ? clone(raw.legacy) as Record<string, unknown> : clone(raw);
  const professions = Array.isArray(raw.professions)
    ? raw.professions.map(item => {
      const profession = record(item);
      if (!profession) return undefined;
      const id = text(profession.id, 'profession');
      const visual = record(profession.visual);
      return {
        id,
        name: text(profession.name, id),
        description: text(profession.description, ''),
        ...(typeof profession.archetype === 'string' ? { archetype: profession.archetype } : {}),
        ...(visual ? { visual: {
          ...(typeof visual.emblemKey === 'string' && LOCAL_PROFESSION_ICON_KEYS.has(visual.emblemKey) ? { emblemKey: visual.emblemKey } : {}),
          ...(typeof visual.accentKey === 'string' && LOCAL_PROFESSION_ACCENT_KEYS.has(visual.accentKey) ? { accentKey: visual.accentKey as ProfessionAccentKey } : {}),
        } } : {}),
        tags: strings(profession.tags),
        abilities: Array.isArray(profession.abilities)
          ? profession.abilities.map(item => normalizeAbility(item, 'profession', id)).filter((item): item is AbilityDefinition => Boolean(item))
          : [],
      };
    }).filter((item): item is ProfessionDefinitionV2 => Boolean(item))
    : [];
  const innateTalents = (Array.isArray(raw.innateTalents) ? raw.innateTalents : [])
    .map(item => normalizeAbility(item, 'innate_talent')).filter((item): item is AbilityDefinition => Boolean(item));
  const freeSkillSource = Array.isArray(raw.freeSkills) ? raw.freeSkills : raw.freeSkillCatalog;
  const freeSkills = (Array.isArray(freeSkillSource) ? freeSkillSource : [])
    .map(item => normalizeAbility(item, 'free_skill')).filter((item): item is AbilityDefinition => Boolean(item));
  return {
    schemaVersion: 2,
    manifest,
    professions,
    innateTalents,
    freeSkills,
    creationTalentBudget: integer(raw.creationTalentBudget, 0, 0, 999),
    allowNoProfession: raw.allowNoProfession !== false,
    initialAbilityPoints: integer(raw.initialAbilityPoints, 0, 0, 999),
    abilityPointsPerTier: integer(raw.abilityPointsPerTier, 1, 0, 999),
    legacy: packLegacy,
  };
}

const THREAT_BANDS = new Set<CombatThreatBand>(['weak', 'matched', 'dangerous', 'boss', 'overwhelming']);

function normalizeActors(value: unknown): CombatEncounterActorProposal[] | undefined {
  if (!Array.isArray(value)) return [];
  const actors: CombatEncounterActorProposal[] = [];
  for (const item of value) {
    const raw = record(item);
    if (!raw) continue;
    const id = text(raw.id, '');
    const identity = text(raw.identity, '');
    if (!id || !identity || actors.some(actor => actor.id === id)) continue;
    actors.push({
      id,
      identity,
      temporary: raw.temporary === true,
      ...(raw.source === 'player' || raw.source === 'npc' || raw.source === 'pet' || raw.source === 'summon' || raw.source === 'temporary' ? { source: raw.source } : {}),
    });
  }
  return actors.length <= 64 ? actors : undefined;
}

export function normalizeCombatEncounterProposal(input: unknown): CombatEncounterProposal | undefined {
  const raw = record(input);
  if (!raw || typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.context !== 'string' || !raw.context.trim() || !THREAT_BANDS.has(raw.threatBand as CombatThreatBand)) return undefined;
  const allies = normalizeActors(raw.allies);
  const enemies = normalizeActors(raw.enemies);
  const neutrals = normalizeActors(raw.neutrals);
  if (!allies || !enemies || !neutrals || enemies.length === 0) return undefined;
  const actorIds = [...allies, ...enemies, ...neutrals].map(actor => actor.id);
  if (new Set(actorIds).size !== actorIds.length) return undefined;
  return {
    schemaVersion: 2,
    id: raw.id.trim(),
    context: raw.context.trim(),
    threatBand: raw.threatBand as CombatThreatBand,
    allies,
    enemies,
    neutrals,
  };
}

export function normalizeCombatEncounterRequest(input: unknown): CombatEncounterRequest | undefined {
  const raw = record(input);
  const proposal = normalizeCombatEncounterProposal(raw?.proposal);
  if (!raw || !proposal) return undefined;
  const canonicalSource = raw.schemaVersion === 2 && (
    raw.source === 'event-workflow'
    || raw.source === 'variable-hostile-action'
    || raw.source === 'manual'
  ) ? raw.source : undefined;
  const source = canonicalSource ?? ((raw.type === 'event.combat.encounter.requested' || raw.type === 'combat.encounter.requested')
    ? 'event-workflow'
    : raw.type === 'manual.attack' || raw.type === 'manual.combat'
      ? 'manual'
      : raw.type === 'variable.hostile-action'
        ? 'variable-hostile-action'
        : undefined);
  if (!source) return undefined;
  if (source === 'variable-hostile-action') {
    const hostile = record(raw.hostileAction);
    if (hostile?.occurred !== true || typeof hostile.subjectId !== 'string' || typeof hostile.targetId !== 'string') return undefined;
    return { schemaVersion: 2, source, proposal, hostileAction: { occurred: true, subjectId: hostile.subjectId, targetId: hostile.targetId } };
  }
  return { schemaVersion: 2, source, proposal };
}

function normalizeSide(value: unknown): CombatUnitSide {
  return value === 'player' || value === 'ally' || value === 'enemy' || value === 'neutral' ? value : 'neutral';
}

function normalizeStateBinding(value: unknown): CombatStateBindingV2 | undefined {
  const raw = record(value);
  const kind = raw?.kind === 'player' || raw?.kind === 'npc' || raw?.kind === 'temporary' ? raw.kind : undefined;
  if (!raw || !kind || typeof raw.id !== 'string' || !raw.id.trim()) return undefined;
  return {
    kind,
    id: raw.id.trim(),
    ...(typeof raw.hpPath === 'string' ? { hpPath: raw.hpPath } : {}),
    ...(typeof raw.resourcePath === 'string' ? { resourcePath: raw.resourcePath } : {}),
    ...(typeof raw.inventoryPath === 'string' ? { inventoryPath: raw.inventoryPath } : {}),
    ...(typeof raw.injuryPath === 'string' ? { injuryPath: raw.injuryPath } : {}),
    originalHp: number(raw.originalHp, 0, 0, 999999),
    originalMaxHp: number(raw.originalMaxHp, number(raw.originalHp, 1, 1, 999999), 1, 999999),
    originalResource: number(raw.originalResource, 0, 0, 999999),
    originalMaxResource: number(raw.originalMaxResource, number(raw.originalResource, 1, 1, 999999), 1, 999999),
    originalItemQuantities: record(raw.originalItemQuantities)
      ? Object.fromEntries(Object.entries(raw.originalItemQuantities as Record<string, unknown>).flatMap(([id, quantity]) => Number.isFinite(Number(quantity)) ? [[id, integer(quantity, 0, 0, 999999)]] : []))
      : {},
  };
}

function normalizeParticipants(value: unknown, limit = 8): CombatParticipantV2[] {
  if (!Array.isArray(value)) return [];
  return value.map<CombatParticipantV2>(item => {
    const raw = record(item) ?? {};
    const id = text(raw.id, 'unit');
    const maxHp = number(raw.maxHp, 1, 1, 999999);
    const typedStatuses = Array.isArray(raw.typedStatuses)
      ? raw.typedStatuses.map(status => {
        const itemStatus = record(status);
        if (!itemStatus) return undefined;
        return {
          id: text(itemStatus.id, 'status'),
          name: text(itemStatus.name, text(itemStatus.id, '状态')),
          remainingRounds: integer(itemStatus.remainingRounds, 1, 0, 999),
          stacks: integer(itemStatus.stacks, 1, 1, 999),
          ...(Number.isFinite(Number(itemStatus.damagePerRound)) ? { damagePerRound: number(itemStatus.damagePerRound, 0, 0, 999999) } : {}),
          ...(Number.isFinite(Number(itemStatus.healingPerRound)) ? { healingPerRound: number(itemStatus.healingPerRound, 0, 0, 999999) } : {}),
          ...(record(itemStatus.modifiers) ? { modifiers: Object.fromEntries(Object.entries(itemStatus.modifiers as Record<string, unknown>).flatMap(([key, itemValue]) => Number.isFinite(Number(itemValue)) ? [[key, number(itemValue, 0)]] : [])) } : {}),
        };
      }).filter((status): status is CombatStatusV2 => Boolean(status))
      : undefined;
    return {
      id,
      side: normalizeSide(raw.side),
      identity: text(raw.identity, id),
      hp: number(raw.hp, maxHp, 0, maxHp),
      maxHp,
      statuses: strings(raw.statuses),
      cooldowns: Object.fromEntries(Object.entries(record(raw.cooldowns) ?? {})
        .map(([key, value]) => [key, integer(value, 0, 0, 999)])),
      items: strings(raw.items),
      actedRound: integer(raw.actedRound, 0, 0, 999999),
      ...(raw.source === 'player' || raw.source === 'ally' || raw.source === 'enemy' || raw.source === 'pet' || raw.source === 'summon' || raw.source === 'temporary' ? { source: raw.source } : {}),
      ...(typeof raw.temporary === 'boolean' ? { temporary: raw.temporary } : {}),
      ...(Number.isFinite(Number(raw.resource)) ? { resource: number(raw.resource, 0, 0, 999999) } : {}),
      ...(Number.isFinite(Number(raw.maxResource)) ? { maxResource: number(raw.maxResource, 0, 0, 999999) } : {}),
      ...(Number.isFinite(Number(raw.attackPower)) ? { attackPower: number(raw.attackPower, 0, 0, 999999) } : {}),
      ...(Number.isFinite(Number(raw.healingPower)) ? { healingPower: number(raw.healingPower, 0, 0, 999999) } : {}),
      ...(Number.isFinite(Number(raw.armor)) ? { armor: number(raw.armor, 0, 0, 999999) } : {}),
      ...(Number.isFinite(Number(raw.accuracy)) ? { accuracy: number(raw.accuracy, 0, -999, 999) } : {}),
      ...(Number.isFinite(Number(raw.evasion)) ? { evasion: number(raw.evasion, 0, -999, 999) } : {}),
      ...(Number.isFinite(Number(raw.critChance)) ? { critChance: number(raw.critChance, 0, 0, 1) } : {}),
      ...(Number.isFinite(Number(raw.initiative)) ? { initiative: number(raw.initiative, 0, -999, 999) } : {}),
      ...(record(raw.normalizedAttributes) ? {
        normalizedAttributes: Object.fromEntries(Object.entries(raw.normalizedAttributes as Record<string, unknown>).flatMap(([key, itemValue]) => (
          /^attr[AB]$|^dim[1-6]$/.test(key) && Number.isFinite(Number(itemValue))
            ? [[key, number(itemValue, 0, 0, 100)]]
            : []
        ))) as Partial<Record<CombatScalingStatId, number>>,
      } : {}),
      ...(typeof raw.defending === 'boolean' ? { defending: raw.defending } : {}),
      ...(record(raw.abilityDefinitions) ? { abilityDefinitions: clone(raw.abilityDefinitions) as Record<string, AbilityDefinition> } : {}),
      ...(record(raw.abilityInstances) ? { abilityInstances: clone(raw.abilityInstances) as Record<string, AbilityInstance> } : {}),
      ...(record(raw.itemQuantities) ? { itemQuantities: Object.fromEntries(Object.entries(raw.itemQuantities as Record<string, unknown>).flatMap(([key, itemValue]) => Number.isFinite(Number(itemValue)) ? [[key, integer(itemValue, 0, 0, 999)]] : [])) } : {}),
      ...(typedStatuses ? { typedStatuses } : {}),
      ...(normalizeStateBinding(raw.stateBinding) ? { stateBinding: normalizeStateBinding(raw.stateBinding) } : {}),
    };
  }).slice(0, limit);
}

function normalizeActionRecord(value: unknown, index: number): CombatActionRecordV2 | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const kind = raw.kind === 'attack' || raw.kind === 'skill' || raw.kind === 'item' || raw.kind === 'defend' || raw.kind === 'flee' ? raw.kind : undefined;
  if (!kind) return undefined;
  const targetIds = strings(raw.targetIds);
  const commandId = text(raw.commandId, text(raw.id, `legacy-command-${index}`));
  const transactionId = text(raw.transactionId, `combat:legacy:${commandId}`);
  return {
    id: text(raw.id, `combat-action-${index}`),
    commandId,
    transactionId,
    round: integer(raw.round, 1, 1, 999999),
    unitId: text(raw.unitId, 'unit'),
    kind,
    targetIds,
    ...(record(raw.input) ? { input: clone(raw.input) as CombatCommandInputV2 } : {}),
    ...(typeof raw.hit === 'boolean' ? { hit: raw.hit } : {}),
    ...(typeof raw.critical === 'boolean' ? { critical: raw.critical } : {}),
    damage: number(raw.damage, 0, 0, 999999),
    healing: number(raw.healing, 0, 0, 999999),
    statusChanges: Array.isArray(raw.statusChanges) ? clone(raw.statusChanges) as CombatStatusChangeV2[] : [],
    resourceChanges: Array.isArray(raw.resourceChanges) ? clone(raw.resourceChanges) as CombatResourceChangeV2[] : [],
    itemChanges: Array.isArray(raw.itemChanges) ? clone(raw.itemChanges) as CombatItemChangeV2[] : [],
    resolved: raw.resolved === true,
    ...(raw.rejected === true ? { rejected: true } : {}),
    ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
  };
}

export function normalizeCombatSessionV2(input: unknown): CombatSessionV2 | undefined {
  const raw = record(input);
  if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) return undefined;
  const participants = normalizeParticipants(raw.participants);
  const seed = integer(raw.seed, 0, 0, 2147483647);
  const round = integer(raw.round, 1, 1, 999999);
  const id = raw.id.trim();
  const encounter = normalizeCombatEncounterProposal(raw.encounter) ?? {
    schemaVersion: 2, id: `${id}:encounter`, context: '旧存档战斗', threatBand: 'matched' as const,
    allies: [], enemies: [{ id: 'enemy-1', identity: '未知敌人', temporary: true }], neutrals: [],
  };
  const rawCheckpoint = record(raw.preCombatCheckpoint);
  const checkpointGameState = record(rawCheckpoint?.gameState)
    ? clone(rawCheckpoint?.gameState) as GameState
    : createDefaultGameState();
  const checkpoint: CombatCheckpointV2 = {
    schemaVersion: 2,
    sessionId: id,
    capturedAt: integer(rawCheckpoint?.capturedAt, Date.now(), 0, 9999999999999),
    round: integer(rawCheckpoint?.round, 0, 0, 999999),
    seed: integer(rawCheckpoint?.seed, seed, 0, 2147483647),
    randomCursor: integer(rawCheckpoint?.randomCursor, 0, 0, 2147483647),
    participants: Array.isArray(rawCheckpoint?.participants) ? normalizeParticipants(rawCheckpoint.participants, 64) : clone(participants),
    gameState: checkpointGameState,
    ...(Array.isArray(rawCheckpoint?.messages) ? { messages: clone(rawCheckpoint.messages) as ChatMessage[] } : {}),
    ...(rawCheckpoint?.memoryRuntime !== undefined ? { memoryRuntime: clone(rawCheckpoint.memoryRuntime) } : {}),
    ...(Array.isArray(rawCheckpoint?.vectorMemory) ? { vectorMemory: clone(rawCheckpoint.vectorMemory) } : {}),
    ...(record(rawCheckpoint?.worldSimulationState) ? { worldSimulationState: clone(rawCheckpoint?.worldSimulationState) as SimulationState } : {}),
    ...(Array.isArray(rawCheckpoint?.moduleStates) ? { moduleStates: clone(rawCheckpoint.moduleStates) as ModuleStateRecord[] } : {}),
    ...(Array.isArray(rawCheckpoint?.moduleCheckpoints) ? { moduleCheckpoints: clone(rawCheckpoint.moduleCheckpoints) as ModuleStateRecord[] } : {}),
    checkpointRevision: integer(rawCheckpoint?.checkpointRevision, 1, 0, 999999),
  };
  const status = raw.status === 'victory' || raw.status === 'defeat' || raw.status === 'escaped' || raw.status === 'draw' ? raw.status : 'active';
  const actionSequence = Array.isArray(raw.actionSequence)
    ? raw.actionSequence.map((action, index) => normalizeActionRecord(action, index)).filter((action): action is CombatActionRecordV2 => Boolean(action))
    : [];
  const itemDefinitions = record(raw.itemDefinitions) ? clone(raw.itemDefinitions) as Record<string, CombatItemDefinition> : {};
  return {
    schemaVersion: 2,
    id,
    encounter,
    riskMode: raw.riskMode === 'hard' || raw.riskMode === 'inferno' ? raw.riskMode : 'normal',
    statLabels: {
      health: text(record(raw.statLabels)?.health, '生命'),
      resource: text(record(raw.statLabels)?.resource, '能量'),
    },
    seed,
    round,
    activeUnitId: text(raw.activeUnitId, participants[0]?.id ?? 'player'),
    actionPointsPerTurn: integer(raw.actionPointsPerTurn, 1, 1, 5),
    participants,
    actionSequence,
    preCombatCheckpoint: checkpoint,
    status,
    lifecycle: raw.lifecycle === 'preparing' || raw.lifecycle === 'terminal' ? raw.lifecycle : status === 'active' ? 'active' : 'terminal',
    availableAllyPool: Array.isArray(raw.availableAllyPool) ? normalizeParticipants(raw.availableAllyPool, 4) : clone(participants.filter(unit => unit.side !== 'enemy')),
    availableEnemyPool: Array.isArray(raw.availableEnemyPool) ? normalizeParticipants(raw.availableEnemyPool, 64) : clone(participants.filter(unit => unit.side === 'enemy')),
    ...(Array.isArray(raw.resolvedParticipants) ? { resolvedParticipants: normalizeParticipants(raw.resolvedParticipants, 64) } : {}),
    lockedEnemyIds: Array.isArray(raw.lockedEnemyIds) ? strings(raw.lockedEnemyIds) : participants.filter(unit => unit.side === 'enemy').map(unit => unit.id),
    waves: Array.isArray(raw.waves) ? clone(raw.waves) as CombatWaveV2[] : [{ id: `${id}:wave:1`, unitIds: participants.filter(unit => unit.side === 'enemy').map(unit => unit.id) }],
    initiativeOrder: Array.isArray(raw.initiativeOrder) ? strings(raw.initiativeOrder) : participants.map(unit => unit.id),
    randomCursor: integer(raw.randomCursor, 0, 0, 2147483647),
    appliedTransactionIds: strings(raw.appliedTransactionIds),
    abilityDefinitions: record(raw.abilityDefinitions) ? clone(raw.abilityDefinitions) as Record<string, AbilityDefinition> : {},
    abilityInstances: record(raw.abilityInstances) ? clone(raw.abilityInstances) as Record<string, AbilityInstance> : {},
    itemDefinitions,
    ...(Array.isArray(raw.rewardEffects) ? { rewardEffects: clone(raw.rewardEffects) as GameplayEffect[] } : {}),
    ...(record(raw.result) ? { result: clone(raw.result) as CombatResult } : {}),
  };
}

export function createDefaultV3FeatureFlags(): V3FeatureFlags {
  return { professionsEnabled: false, combatEnabled: false, combatRiskMode: 'normal' };
}

export function normalizeCombatRiskMode(value: unknown): CombatRiskMode {
  return value === 'hard' || value === 'inferno' ? value : 'normal';
}

/** Single guard shared by UI, engine rollback and snapshot restoration. */
export function canRollbackCombat(riskMode: CombatRiskMode = 'normal', lifecycle: 'preparing' | 'active' | 'terminal' | 'ended' = 'active'): boolean {
  return lifecycle !== 'ended' && riskMode !== 'inferno';
}

function migrateLegacyCombatSession(value: unknown, checkpointState?: GameState): CombatSessionV2 | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const id = text(raw.encounterId, '');
  if (!id) return undefined;
  const legacyParticipants = Array.isArray(raw.participants) ? raw.participants : [];
  const participantsInput = legacyParticipants.map(item => {
    const participant = record(item) ?? {};
    return {
      id: text(participant.id, 'unit'),
      side: normalizeSide(participant.side),
      identity: text(participant.name, text(participant.id, '单位')),
      hp: participant.hp,
      maxHp: participant.maxHp,
      statuses: [],
      cooldowns: participant.cooldowns,
      items: [],
      actedRound: 0,
    };
  });
  const participants = normalizeParticipants(participantsInput);
  const actors = participants.map(participant => ({ id: participant.id, identity: participant.identity, temporary: false }));
  const proposal: CombatEncounterProposal = {
    schemaVersion: 2,
    id,
    context: text(raw.encounterName, '旧存档战斗'),
    threatBand: 'matched',
    allies: actors.filter(actor => participants.find(item => item.id === actor.id)?.side === 'ally'),
    enemies: actors.filter(actor => participants.find(item => item.id === actor.id)?.side === 'enemy'),
    neutrals: actors.filter(actor => participants.find(item => item.id === actor.id)?.side === 'neutral'),
  };
  if (proposal.enemies.length === 0) return undefined;
  return normalizeCombatSessionV2({
    id,
    encounter: proposal,
    riskMode: 'normal',
    seed: 0,
    round: raw.round,
    activeUnitId: raw.activeActorId,
    actionPointsPerTurn: raw.actionPointsPerTurn,
    participants: participants.map(participant => ({ ...participant })),
    ...(checkpointState ? {
      preCombatCheckpoint: {
        capturedAt: Date.now(),
        round: 0,
        seed: 0,
        randomCursor: 0,
        participants,
        gameState: clone(checkpointState),
        checkpointRevision: 1,
      },
    } : {}),
  });
}

export function migrateGameStateToV3(state: GameState): GameState {
  const next = clone(state);
  next.narrativeDecisions = Array.isArray(next.narrativeDecisions) ? next.narrativeDecisions : [];
  const current = next.v3;
  const normalizedCurrentCombat = current?.combatSession
    ? normalizeCombatSessionV2(current.combatSession) ?? clone(current.combatSession)
    : undefined;
  const pendingEncounterRequest = current?.pendingEncounterRequest
    ? normalizeCombatEncounterRequest(current.pendingEncounterRequest)
    : undefined;
  next.v3 = {
    ...(current ?? {}),
    schemaVersion: 3,
    featureFlags: {
      ...createDefaultV3FeatureFlags(),
      ...(current?.featureFlags ?? {}),
    },
    ...(normalizedCurrentCombat ? { combatSession: normalizedCurrentCombat } : {}),
    ...(current?.combatResult ? { combatResult: clone(current.combatResult) } : {}),
    ...(pendingEncounterRequest ? { pendingEncounterRequest } : {}),
    ...(current?.abilityDefinitions ? { abilityDefinitions: clone(current.abilityDefinitions) } : {}),
    ...(current?.abilityInstances ? { abilityInstances: clone(current.abilityInstances) } : {}),
    ...(current?.pendingAbilityProposals ? { pendingAbilityProposals: clone(current.pendingAbilityProposals) } : {}),
  };
  if (!next.v3.combatSession && state.combat?.active) {
    const migratedCombat = migrateLegacyCombatSession(state.combat.active, state);
    if (migratedCombat) next.v3.combatSession = migratedCombat;
  }
  return next;
}

/** The loaded world's enabled modules override stale flags created by older migrations. */
export function synchronizeV3FeatureFlagsForWorld(
  stateInput: GameState,
  options: { professionsEnabled: boolean; combatEnabled: boolean; fallbackRiskMode?: CombatRiskMode },
): GameState {
  const state = migrateGameStateToV3(stateInput);
  state.v3!.featureFlags = {
    professionsEnabled: options.professionsEnabled,
    combatEnabled: options.combatEnabled,
    combatRiskMode: normalizeCombatRiskMode(stateInput.v3?.featureFlags?.combatRiskMode ?? options.fallbackRiskMode),
  };
  return state;
}

export function isProfessionPackV2(value: unknown): value is ProfessionPackV2 {
  const raw = record(value);
  return raw?.schemaVersion === 2 && record(raw.manifest)?.schemaVersion === 2;
}

export function isLegacyProfessionPack(value: unknown): value is ProfessionPack {
  const raw = record(value);
  return raw?.schemaVersion !== 2 && Array.isArray(raw?.professions) && record(raw?.manifest) !== undefined;
}

export type { NarrativeDecisionRecord };
