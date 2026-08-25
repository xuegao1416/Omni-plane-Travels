import type { ChatMessage } from '../engine/types';
import type { GameSave } from '../storage/db';
import type { GameState, NPCData, SurvivalStats } from '../schema/variables';
import type { ModuleStateRecord } from './moduleRuntime/types';
import type { SimulationState } from '../simulation/types';
import type { CombatActionDefinition, CombatScalingStatId } from '../modules/schema';
import type {
  AbilityDefinition,
  AbilityInstance,
  AbilityProposal,
  AbilityProposalTarget,
  CombatActionRecordV2,
  CombatCommandInputV2,
  CombatEncounterProposal,
  CombatEncounterRequest,
  CombatItemDefinition,
  CombatItemPurpose,
  CombatMechanicalReportV2,
  CombatParticipantV2,
  CombatResourceChangeV2,
  CombatResult,
  CombatSessionV2,
  CombatStatusChangeV2,
  CombatStatusV2,
  CombatStateBindingV2,
  CombatThreatBand,
  CombatWaveV2,
} from './protocols';
import { balanceAbilityProposal, ensureCombatAbilityDefaults } from './abilitySystem';
import { canRollbackCombat, normalizeCombatEncounterProposal, normalizeCombatEncounterRequest, normalizeCombatRiskMode } from './protocols';
import { executeGameplayTransaction, getGameplayPath, setGameplayPath } from './kernel';

export interface CombatStatRanges {
  attrA?: [number, number];
  attrB?: [number, number];
  dim1?: [number, number];
  dim2?: [number, number];
  dim3?: [number, number];
  dim4?: [number, number];
  dim5?: [number, number];
  dim6?: [number, number];
}

export interface CombatRosterOptions {
  selectedAllyIds?: string[];
  statRanges?: CombatStatRanges;
}

export interface CombatRosterUnit extends CombatParticipantV2 {
  source: 'player' | 'ally' | 'enemy' | 'pet' | 'summon' | 'temporary';
}

export interface CombatRosterPlan {
  proposal: CombatEncounterProposal;
  playerPool: CombatRosterUnit[];
  selectedPlayerIds: string[];
  enemyPool: CombatRosterUnit[];
  enemyWaves: CombatRosterUnit[][];
}

export interface CombatRosterValidation {
  ok: boolean;
  errors: string[];
  plan?: CombatRosterPlan;
}

export function prepareCombatEncounterRequest(state: GameState, request: CombatEncounterRequest | unknown, options: CombatRosterOptions = {}): CombatRosterValidation {
  const normalized = normalizeCombatEncounterRequest(request);
  if (!normalized || (normalized.source === 'variable-hostile-action' && !normalized.hostileAction?.occurred)) return { ok: false, errors: ['遭遇请求缺少结构化触发或已发生的敌对行动证明'] };
  if (normalized.source === 'variable-hostile-action') {
    const hostileAction = normalized.hostileAction;
    if (!hostileAction) return { ok: false, errors: ['遭遇请求缺少已发生的敌对行动证明'] };
    const actorSides = new Map<string, 'friendly' | 'enemy' | 'neutral'>([
      ...normalized.proposal.allies.map(actor => [actor.id, 'friendly'] as const),
      ...normalized.proposal.enemies.map(actor => [actor.id, 'enemy'] as const),
      ...normalized.proposal.neutrals.map(actor => [actor.id, 'neutral'] as const),
      ['player', 'friendly'],
    ]);
    const actorIds = new Set(actorSides.keys());
    actorIds.add('player');
    if (state.玩家.姓名) actorIds.add(state.玩家.姓名);
    if (!actorIds.has(hostileAction.subjectId) || !actorIds.has(hostileAction.targetId)) {
      return { ok: false, errors: ['敌对行动主体或目标不在本次遭遇提案中'] };
    }
    const subjectSide = actorSides.get(hostileAction.subjectId) ?? (hostileAction.subjectId === state.玩家.姓名 ? 'friendly' : undefined);
    const targetSide = actorSides.get(hostileAction.targetId) ?? (hostileAction.targetId === state.玩家.姓名 ? 'friendly' : undefined);
    if (!subjectSide || !targetSide || subjectSide === 'neutral' || targetSide === 'neutral' || subjectSide === targetSide) {
      return { ok: false, errors: ['敌对行动必须跨对立阵营，不能由中立或友方互殴触发'] };
    }
  }
  return buildValidatedCombatRoster(state, normalized.proposal, options);
}

export interface CombatSessionOptions {
  seed: number;
  riskMode?: 'normal' | 'hard' | 'inferno';
  selectedAllyIds?: string[];
  statRanges?: CombatStatRanges;
  statLabels?: { health: string; resource: string };
  messages?: ChatMessage[];
  memoryRuntime?: unknown;
  vectorMemory?: unknown[];
  worldSimulationState?: SimulationState;
  moduleStates?: ModuleStateRecord[];
  moduleCheckpoints?: ModuleStateRecord[];
  itemDefinitions?: Record<string, CombatItemDefinition>;
  itemQuantities?: Record<string, Record<string, number>>;
  now?: number;
}

export interface CombatCheckpointCaptureInput {
  messages?: ChatMessage[];
  memoryRuntime?: unknown;
  vectorMemory?: unknown[];
  worldSimulationState?: SimulationState;
  moduleStates?: ModuleStateRecord[];
  moduleCheckpoints?: ModuleStateRecord[];
  now?: number;
}

export interface CombatCheckpointRestore {
  gameState: GameState;
  messages?: ChatMessage[];
  memoryRuntime?: unknown;
  vectorMemory?: unknown[];
  worldSimulationState?: SimulationState;
  moduleStates?: ModuleStateRecord[];
  moduleCheckpoints?: ModuleStateRecord[];
}

export interface CombatCommandResolution {
  session: CombatSessionV2;
  record: CombatActionRecordV2;
  alreadyProcessed: boolean;
}

export type CombatAutoStrategy = 'aggressive' | 'balanced' | 'defensive' | 'support';

export interface CombatResultSettlement {
  sessionId: string;
  riskMode: 'normal' | 'hard' | 'inferno';
  playerDied: boolean;
  result: CombatResult;
}

function clone<T>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeWorldAttribute(value: number, range: [number, number]): number {
  const low = Math.min(range[0], range[1]);
  const high = Math.max(range[0], range[1]);
  if (high <= low) return 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp((numeric - low) / (high - low), 0, 1) : 0;
}

function statValue(stats: SurvivalStats | undefined, key: keyof CombatStatRanges): number {
  if (!stats) return 0;
  if (key === 'attrA') return Number(stats.血量 ?? 0);
  if (key === 'attrB') return Number(stats.体力值 ?? 0);
  return Number(stats[key] ?? 0);
}

function normalizedStats(stats: SurvivalStats | undefined, ranges: CombatStatRanges = {}): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of ['attrA', 'attrB', 'dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const) {
    result[key] = normalizeWorldAttribute(statValue(stats, key), ranges[key] ?? [0, 20]);
  }
  return result;
}

function identityStats(source: SurvivalStats | undefined, ranges: CombatStatRanges, threatMultiplier = 1, preserveCurrentRatio = true): Pick<CombatParticipantV2, 'hp' | 'maxHp' | 'resource' | 'maxResource' | 'attackPower' | 'healingPower' | 'armor' | 'accuracy' | 'evasion' | 'critChance' | 'initiative' | 'normalizedAttributes'> {
  const originalMaxHp = originalLimit(source, '血量', '血量上限');
  const originalMaxResource = originalLimit(source, '体力值', '体力上限');
  const normalized = normalizedStats(source ? {
    ...source,
    血量: originalMaxHp,
    体力值: originalMaxResource,
  } : source, ranges);
  const maxHp = Math.max(1, Math.round((40 + normalized.attrA * 60) * threatMultiplier));
  const maxResource = Math.max(1, Math.round(20 + normalized.attrB * 80));
  const hpRatio = preserveCurrentRatio ? clamp(Number(source?.血量 ?? originalMaxHp) / originalMaxHp, 0, 1) : 1;
  const resourceRatio = preserveCurrentRatio ? clamp(Number(source?.体力值 ?? originalMaxResource) / originalMaxResource, 0, 1) : 1;
  return {
    hp: Math.round(maxHp * hpRatio),
    maxHp,
    resource: Math.round(maxResource * resourceRatio),
    maxResource,
    attackPower: Math.max(1, Math.round(4 + normalized.dim1 * 12) * threatMultiplier),
    healingPower: Math.max(1, Math.round(4 + normalized.dim4 * 12) * threatMultiplier),
    armor: Math.max(0, Math.round(normalized.dim2 * 8 * threatMultiplier)),
    accuracy: 10 + Math.round(normalized.dim6 * 6),
    evasion: Math.round(normalized.dim3 * 6),
    critChance: clamp(0.05 + normalized.dim3 * 0.2, 0.05, 0.35),
    initiative: 10 + Math.round(normalized.dim3 * 20),
    normalizedAttributes: Object.fromEntries(Object.entries(normalized).map(([key, value]) => [key, Math.round(value * 100)])),
  };
}

function itemQuantities(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([id, item]) => {
    const quantity = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>).数量 : item;
    return Number.isFinite(Number(quantity)) ? [[id, Math.max(0, Math.trunc(Number(quantity)))]] : [];
  }));
}

function combatItemPurpose(value: unknown): CombatItemPurpose | undefined {
  if (value === 'heal' || value === 'resource' || value === 'damage' || value === 'cleanse' || value === 'buff') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  const safeTypes: Record<string, CombatItemPurpose> = {
    '治疗': 'heal', '治疗品': 'heal', '恢复品': 'heal', '药剂': 'heal',
    '能量补给': 'resource', '体力补给': 'resource', '资源补给': 'resource',
    '战斗消耗品': 'damage', '投掷物': 'damage',
    '净化物品': 'cleanse', '解毒剂': 'cleanse',
    '增益物品': 'buff', '强化药剂': 'buff',
  };
  return safeTypes[normalized];
}

function inferCombatItemPurpose(itemId: string, item: Record<string, unknown>): CombatItemPurpose | undefined {
  const text = [itemId, item.name, item.id, item.description, item.描述, item.用途, item.备注]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .trim();
  if (!text) return undefined;
  if (/食物|零食|饮品|饮料|口粮|能量补给|干粮/.test(text)) return 'resource';
  if (/药剂|药品|绷带|医疗包|治疗|急救|疗伤/.test(text)) return 'heal';
  if (/解毒|净化/.test(text)) return 'cleanse';
  if (/炸弹|爆弹|投掷物|手雷/.test(text)) return 'damage';
  return undefined;
}

function combatItemMetadata(itemId: string, item: unknown): { purpose?: CombatItemPurpose; target?: AbilityProposalTarget; description?: string; rarity?: AbilityProposal['rarity'] } {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return {};
  const raw = item as Record<string, unknown>;
  const semantic = raw.战斗用途 && typeof raw.战斗用途 === 'object' && !Array.isArray(raw.战斗用途)
    ? raw.战斗用途 as Record<string, unknown>
    : undefined;
  const explicitPurpose = combatItemPurpose(semantic?.purpose ?? semantic?.类型 ?? raw.战斗用途);
  const purpose = explicitPurpose ?? combatItemPurpose(raw.类型) ?? inferCombatItemPurpose(itemId, raw);
  const requestedTarget = semantic?.target ?? semantic?.目标;
  const target: AbilityProposalTarget | undefined = requestedTarget === 'enemy' || requestedTarget === 'ally' || requestedTarget === 'self'
    ? requestedTarget
    : purpose === 'damage' ? 'enemy' : purpose ? 'self' : undefined;
  const rarity = raw.品质 === '精良' || raw.品质 === '稀有' || raw.品质 === '史诗' || raw.品质 === '传说' ? raw.品质 : '普通';
  return {
    ...(purpose ? { purpose } : {}),
    ...(target ? { target } : {}),
    ...(typeof raw.备注 === 'string' && raw.备注.trim() ? { description: raw.备注.trim() } : {}),
    rarity,
  };
}

/**
 * Converts inventory semantics into a controlled combat loadout. Unknown items
 * remain visible as narrative-only definitions and can never gain mechanics
 * merely because their display name resembles a weapon or potion.
 */
export function buildCombatItemLoadout(
  state: GameState,
  units: CombatParticipantV2[],
): { definitions: Record<string, CombatItemDefinition>; quantities: Record<string, Record<string, number>> } {
  const definitions: Record<string, CombatItemDefinition> = {};
  const quantities: Record<string, Record<string, number>> = {};
  for (const unit of units) {
    const binding = unit.stateBinding;
    const inventory = binding?.inventoryPath ? getGameplayPath(state, binding.inventoryPath) : undefined;
    const recordInventory = inventory && typeof inventory === 'object' && !Array.isArray(inventory)
      ? inventory as Record<string, unknown>
      : {};
    quantities[unit.id] = itemQuantities(recordInventory);
    for (const [itemId, item] of Object.entries(recordInventory)) {
      if (definitions[itemId]) continue;
      const metadata = combatItemMetadata(itemId, item);
      const definition = normalizeCombatItemDefinition({
        schemaVersion: 2,
        id: itemId,
        name: itemId,
        description: metadata.description ?? itemId,
        rarity: metadata.rarity,
        ...(metadata.purpose ? { purpose: metadata.purpose } : {}),
        ...(metadata.target ? { target: metadata.target } : {}),
      });
      if (definition) definitions[itemId] = definition;
    }
  }
  return { definitions, quantities };
}

function originalLimit(stats: SurvivalStats | undefined, currentKey: '血量' | '体力值', limitKey: string): number {
  const current = Number(stats?.[currentKey] ?? 0);
  const configured = Number(stats?.[limitKey] ?? current);
  return Math.max(current, Number.isFinite(configured) ? configured : current, 1);
}

function worldBinding(
  kind: CombatStateBindingV2['kind'],
  id: string,
  stats: SurvivalStats | undefined,
  paths: Pick<CombatStateBindingV2, 'hpPath' | 'resourcePath' | 'inventoryPath' | 'injuryPath'>,
  inventory: unknown,
): CombatStateBindingV2 {
  return {
    kind,
    id,
    ...paths,
    originalHp: Math.max(0, Number(stats?.血量 ?? 0)),
    originalMaxHp: originalLimit(stats, '血量', '血量上限'),
    originalResource: Math.max(0, Number(stats?.体力值 ?? 0)),
    originalMaxResource: originalLimit(stats, '体力值', '体力上限'),
    originalItemQuantities: itemQuantities(inventory),
  };
}

function threatMultiplier(threat: CombatThreatBand): number {
  return { weak: 0.65, matched: 1, dangerous: 1.3, boss: 1.75, overwhelming: 2.2 }[threat];
}

function npcIsAlly(npc: NPCData): boolean {
  const relation = npc.关系数据?.关系类型?.toLowerCase() ?? '';
  return /友|盟|伙伴|同伴|ally|friend/.test(relation) && npc.人物分类 !== '离场';
}

function npcIsHostile(npc: NPCData): boolean {
  const relation = npc.关系数据?.关系类型?.toLowerCase() ?? '';
  return /敌|仇|对立|hostile|enemy|rival/.test(relation);
}

function abilityMaps(state: GameState): { definitions: Record<string, AbilityDefinition>; instances: Record<string, AbilityInstance> } {
  return {
    definitions: Object.fromEntries(Object.entries(state.v3?.abilityDefinitions ?? {}).map(([id, definition]) => [id, ensureCombatAbilityDefaults(definition)])),
    instances: clone(state.v3?.abilityInstances ?? {}),
  };
}

function participant(
  id: string,
  identity: string,
  side: CombatParticipantV2['side'],
  source: CombatRosterUnit['source'],
  stats: Pick<CombatParticipantV2, 'hp' | 'maxHp' | 'resource' | 'maxResource' | 'attackPower' | 'healingPower' | 'armor' | 'accuracy' | 'evasion' | 'critChance' | 'initiative' | 'normalizedAttributes'>,
  temporary: boolean,
  definitions: Record<string, AbilityDefinition> = {},
  instances: Record<string, AbilityInstance> = {},
  stateBinding?: CombatStateBindingV2,
): CombatRosterUnit {
  const unit: CombatRosterUnit = {
    id,
    side,
    identity,
    hp: stats.hp,
    maxHp: stats.maxHp,
    armor: stats.armor ?? 0,
    initiative: stats.initiative ?? 0,
    statuses: [],
    cooldowns: {},
    items: [],
    actedRound: 0,
    source,
    temporary,
    resource: stats.resource,
    maxResource: stats.maxResource,
    attackPower: stats.attackPower,
    healingPower: stats.healingPower,
    accuracy: stats.accuracy,
    evasion: stats.evasion,
    critChance: stats.critChance,
    normalizedAttributes: clone(stats.normalizedAttributes ?? {}),
    abilityDefinitions: definitions,
    abilityInstances: instances,
    itemQuantities: {},
    typedStatuses: [],
    ...(stateBinding ? { stateBinding } : {}),
  };
  for (const definition of Object.values(definitions)) {
    const instance = instances[definition.id];
    if (instance?.runtime.cooldownRemaining && instance.runtime.cooldownRemaining > 0) unit.cooldowns[definition.id] = instance.runtime.cooldownRemaining;
    const passive = definition.abilityType === 'passive' || definition.abilityType === 'specialization' || definition.category === 'innate_talent';
    if (!passive) continue;
    const combat = definition.mechanics?.combat;
    const rankMultiplier = 1 + Math.max(0, (instance?.runtime.rank ?? 1) - 1) * 0.2;
    if (combat?.damage) unit.attackPower = (unit.attackPower ?? 0) + Math.round(combat.damage * rankMultiplier);
    if (combat?.healing) unit.healingPower = (unit.healingPower ?? 0) + Math.round(combat.healing * rankMultiplier);
    if (combat?.armor) unit.armor = (unit.armor ?? 0) + Math.round(combat.armor * rankMultiplier);
    if (combat?.accuracy) unit.accuracy = (unit.accuracy ?? 0) + Math.round(combat.accuracy * rankMultiplier);
    if (combat?.initiative) unit.initiative = (unit.initiative ?? 0) + Math.round(combat.initiative * rankMultiplier);
  }
  return unit;
}

function petAndSummonPool(state: GameState, ranges: CombatStatRanges): CombatRosterUnit[] {
  const maps = abilityMaps(state);
  return Object.values(maps.instances).flatMap(instance => {
    if (instance.runtime.rank <= 0) return [];
    const definition = maps.definitions[instance.definitionId];
    if (!definition || (definition.category !== 'pet' && definition.category !== 'summon')) return [];
    const source = definition.category;
    const id = `${source}:${definition.id}`;
    const stats = identityStats(state.玩家.生存状态, ranges, 0.8);
    return [participant(id, definition.name, 'ally', source, stats, false, { [definition.id]: definition }, { [definition.id]: instance })];
  });
}

function npcUnit(id: string, npc: NPCData, ranges: CombatStatRanges, source: 'ally' | 'enemy', multiplier = 1): CombatRosterUnit {
  const binding = worldBinding('npc', id, npc.生存状态, {
    hpPath: `人物档案.${id}.生存状态.血量`,
    resourcePath: `人物档案.${id}.生存状态.体力值`,
    inventoryPath: npc.物品列表 && typeof npc.物品列表 === 'object' && !Array.isArray(npc.物品列表) ? `人物档案.${id}.物品列表` : undefined,
    injuryPath: `人物档案.${id}.战斗状态`,
  }, npc.物品列表);
  const unit = participant(id, npc.姓名 || id, source, source, identityStats(npc.生存状态, ranges, multiplier), false, {}, {}, binding);
  unit.itemQuantities = clone(binding.originalItemQuantities);
  return unit;
}

function temporaryEnemy(actorId: string, identity: string, sourceState: SurvivalStats | undefined, ranges: CombatStatRanges, multiplier: number): CombatRosterUnit {
  return participant(actorId, identity, 'enemy', 'temporary', identityStats(sourceState, ranges, multiplier, false), true);
}

export function buildValidatedCombatRoster(state: GameState, proposalInput: CombatEncounterProposal, options: CombatRosterOptions = {}): CombatRosterValidation {
  const proposal = normalizeCombatEncounterProposal(proposalInput);
  if (!proposal) return { ok: false, errors: ['遭遇提案结构无效'] };
  if (state.v3 && state.v3.featureFlags?.combatEnabled !== true) return { ok: false, errors: ['v3 战斗模块未启用'] };
  const ranges = options.statRanges ?? {};
  const maps = abilityMaps(state);
  const errors: string[] = [];
  const pool: CombatRosterUnit[] = [];
  if (Number(state.玩家.生存状态.血量 ?? 0) <= 0) return { ok: false, errors: ['玩家当前无法战斗'] };
  const playerStats = identityStats(state.玩家.生存状态, ranges);
  const playerDefinitions = Object.fromEntries(Object.entries(maps.definitions).filter(([id]) => (maps.instances[id]?.runtime.rank ?? 0) > 0));
  const playerBinding = worldBinding('player', 'player', state.玩家.生存状态, {
    hpPath: '玩家.生存状态.血量',
    resourcePath: '玩家.生存状态.体力值',
    inventoryPath: '玩家.物品栏',
    injuryPath: '玩家.战斗状态',
  }, state.玩家.物品栏);
  const player = participant('player', state.玩家.姓名 || '玩家', 'player', 'player', playerStats, false, playerDefinitions, maps.instances, playerBinding);
  player.itemQuantities = clone(playerBinding.originalItemQuantities);
  pool.push(player);

  // Only allies explicitly present in the encounter may enter the selectable
  // roster. This keeps off-scene friendly NPCs out of battle while the local
  // relationship record remains authoritative over an AI-proposed identity.
  const addedAllies = new Set<string>();
  for (const actor of proposal.allies) {
    if (actor.id === 'player') continue;
    const knownEntry = state.人物档案[actor.id]
      ? { id: actor.id, npc: state.人物档案[actor.id] }
      : Object.entries(state.人物档案).map(([id, npc]) => ({ id, npc })).find(entry => entry.npc.姓名 === actor.identity);
    if (!knownEntry) {
      errors.push(`友方身份「${actor.identity}」不存在于本地人物档案`);
      continue;
    }
    if (!npcIsAlly(knownEntry.npc)) {
      errors.push(`友方身份「${actor.identity}」未被本地人物档案标记为友方`);
      continue;
    }
    if (Number(knownEntry.npc.生存状态?.血量 ?? 0) <= 0) {
      errors.push(`友方身份「${actor.identity}」当前已无法战斗`);
      continue;
    }
    if (!addedAllies.has(knownEntry.id)) {
      pool.push(npcUnit(knownEntry.id, knownEntry.npc, ranges, 'ally'));
      addedAllies.add(knownEntry.id);
    }
  }
  pool.push(...petAndSummonPool(state, ranges));

  const enemyPool: CombatRosterUnit[] = [];
  const multiplier = threatMultiplier(proposal.threatBand);
  for (const actor of proposal.enemies) {
    const knownEntry = state.人物档案[actor.id]
      ? { id: actor.id, npc: state.人物档案[actor.id] }
      : Object.entries(state.人物档案).map(([id, npc]) => ({ id, npc })).find(entry => entry.npc.姓名 === actor.identity);
    const known = knownEntry?.npc;
    if (known) {
      if (!npcIsHostile(known)) {
        errors.push(`敌对身份「${actor.identity}」未被本地人物档案标记为敌对`);
        continue;
      }
      if (Number(known.生存状态?.血量 ?? 0) <= 0) {
        errors.push(`敌对身份「${actor.identity}」当前已无法战斗`);
        continue;
      }
      // A proposal id is AI/input data. Bind the unit to the authoritative
      //人物档案 key resolved locally, especially when the proposal matched by name.
      enemyPool.push(npcUnit(knownEntry!.id, known, ranges, 'enemy', multiplier));
    } else if (actor.temporary) {
      enemyPool.push(temporaryEnemy(actor.id, actor.identity, state.玩家.生存状态, ranges, multiplier));
    } else {
      errors.push(`敌对身份「${actor.identity}」不存在且未声明为临时单位`);
    }
  }
  if (enemyPool.length === 0) errors.push('没有可锁定的敌方单位');
  const selected = [...new Set(['player', ...(options.selectedAllyIds ?? [])])];
  if (selected.length > 4) errors.push('出战单位最多 4 名');
  const selectedPlayerIds = selected.filter(id => pool.some(unit => unit.id === id));
  if (!selectedPlayerIds.includes('player')) errors.push('玩家必须默认加入出战阵容');
  if (selectedPlayerIds.length !== selected.length) errors.push('选择了不存在或不可用的友方单位');
  const enemyWaves: CombatRosterUnit[][] = [];
  for (let index = 0; index < enemyPool.length; index += 4) enemyWaves.push(enemyPool.slice(index, index + 4));
  const plan: CombatRosterPlan = { proposal, playerPool: pool, selectedPlayerIds, enemyPool, enemyWaves };
  return { ok: errors.length === 0, errors, ...(errors.length === 0 ? { plan } : {}) };
}

function emptyResult(): CombatResult {
  return { status: 'draw', rewardEffects: [], rewardsApplied: false, narration: { status: 'pending', attempts: 0 } };
}

export function captureCombatCheckpoint(sessionId: string, gameState: GameState, input: CombatCheckpointCaptureInput = {}): import('./protocols').CombatCheckpointV2 {
  return {
    schemaVersion: 2 as const,
    sessionId,
    capturedAt: input.now ?? Date.now(),
    round: 0,
    seed: 0,
    randomCursor: 0,
    participants: [],
    gameState: clone(gameState),
    ...(input.messages ? { messages: clone(input.messages) } : {}),
    ...(input.memoryRuntime !== undefined ? { memoryRuntime: clone(input.memoryRuntime) } : {}),
    ...(input.vectorMemory ? { vectorMemory: clone(input.vectorMemory) } : {}),
    ...(input.worldSimulationState ? { worldSimulationState: clone(input.worldSimulationState) } : {}),
    ...(input.moduleStates ? { moduleStates: clone(input.moduleStates) } : {}),
    ...(input.moduleCheckpoints ? { moduleCheckpoints: clone(input.moduleCheckpoints) } : {}),
    checkpointRevision: 1,
  };
}

export function restoreCombatCheckpoint(checkpoint: import('./protocols').CombatCheckpointV2): CombatCheckpointRestore {
  return {
    gameState: clone(checkpoint.gameState),
    ...(checkpoint.messages ? { messages: clone(checkpoint.messages) } : {}),
    ...(checkpoint.memoryRuntime !== undefined ? { memoryRuntime: clone(checkpoint.memoryRuntime) } : {}),
    ...(checkpoint.vectorMemory ? { vectorMemory: clone(checkpoint.vectorMemory) } : {}),
    ...(checkpoint.worldSimulationState ? { worldSimulationState: clone(checkpoint.worldSimulationState) } : {}),
    ...(checkpoint.moduleStates ? { moduleStates: clone(checkpoint.moduleStates) } : {}),
    ...(checkpoint.moduleCheckpoints ? { moduleCheckpoints: clone(checkpoint.moduleCheckpoints) } : {}),
  };
}

function sessionId(proposal: CombatEncounterProposal, seed: number): string {
  return `combat-v2-${proposal.id}-${Math.trunc(seed)}`;
}

export function createPreparingCombatSession(state: GameState, plan: CombatRosterPlan, options: CombatSessionOptions): CombatSessionV2 {
  const id = sessionId(plan.proposal, options.seed);
  const checkpoint = captureCombatCheckpoint(id, state, options);
  checkpoint.seed = Math.trunc(options.seed);
  checkpoint.round = 1;
  checkpoint.participants = clone([...plan.playerPool, ...plan.enemyPool]);
  const enemyPool = plan.enemyPool;
  const derivedItems = buildCombatItemLoadout(state, [...plan.playerPool, ...enemyPool]);
  const itemDefinitions = { ...derivedItems.definitions, ...(options.itemDefinitions ?? {}) };
  const quantitiesFor = (unit: CombatParticipantV2) => clone(
    options.itemQuantities?.[unit.id]
      ?? derivedItems.quantities[unit.id]
      ?? unit.itemQuantities
      ?? {},
  );
  const waves: CombatWaveV2[] = plan.enemyWaves.map((wave, index) => ({ id: `${id}:wave:${index + 1}`, unitIds: wave.map(unit => unit.id) }));
  return {
    schemaVersion: 2,
    id,
    encounter: clone(plan.proposal),
    riskMode: normalizeCombatRiskMode(options.riskMode),
    statLabels: {
      health: options.statLabels?.health?.trim() || '生命',
      resource: options.statLabels?.resource?.trim() || '能量',
    },
    seed: Math.trunc(options.seed),
    round: 1,
    activeUnitId: '',
    actionPointsPerTurn: 0,
    participants: [],
    actionSequence: [],
    preCombatCheckpoint: checkpoint,
    status: 'active',
    lifecycle: 'preparing',
    availableAllyPool: clone(plan.playerPool).map(unit => ({ ...unit, itemQuantities: quantitiesFor(unit) })),
    availableEnemyPool: clone(enemyPool).map(unit => ({ ...unit, itemQuantities: quantitiesFor(unit) })),
    resolvedParticipants: [],
    lockedEnemyIds: enemyPool.map(unit => unit.id),
    waves,
    initiativeOrder: [],
    randomCursor: 0,
    appliedTransactionIds: [],
    abilityDefinitions: clone(state.v3?.abilityDefinitions ?? {}),
    abilityInstances: clone(state.v3?.abilityInstances ?? {}),
    itemDefinitions: clone(itemDefinitions),
    rewardEffects: [],
    result: undefined,
  };
}

export function attachCombatItems(sessionInput: CombatSessionV2, definitions: Record<string, CombatItemDefinition>, quantities: Record<string, Record<string, number>> = {}): CombatSessionV2 {
  const session = clone(sessionInput);
  session.itemDefinitions = clone(definitions);
  for (const participant of [...session.availableAllyPool, ...session.participants]) {
    participant.itemQuantities = clone(quantities[participant.id] ?? participant.itemQuantities ?? {});
  }
  return session;
}

function currentWave(session: CombatSessionV2): CombatParticipantV2[] {
  const wave = session.waves[0];
  if (!wave) return [];
  return session.availableEnemyPool.filter(unit => wave.unitIds.includes(unit.id));
}

export function selectCombatants(session: CombatSessionV2, selectedIds: string[]): { ok: boolean; errors: string[]; session?: CombatSessionV2 } {
  if (session.lifecycle !== 'preparing') return { ok: false, errors: ['战斗已开始，不能重新选择阵容'] };
  const unique = [...new Set(selectedIds)];
  if (unique.length > 4) return { ok: false, errors: ['出战单位最多 4 名'] };
  if (!unique.includes('player')) return { ok: false, errors: ['玩家必须加入出战阵容'] };
  const allies = unique.map(id => session.availableAllyPool.find(unit => unit.id === id)).filter((unit): unit is CombatParticipantV2 => Boolean(unit));
  if (allies.length !== unique.length) return { ok: false, errors: ['出战阵容含有不可用单位'] };
  const next = clone(session);
  next.participants = [...allies, ...currentWave(session)].map(unit => ({ ...clone(unit), actedRound: 0 }));
  return { ok: true, errors: [], session: next };
}

export function startPreparedCombat(session: CombatSessionV2): CombatSessionV2 {
  if (session.lifecycle !== 'preparing') return clone(session);
  const next = clone(session);
  next.lifecycle = 'active';
  next.status = 'active';
  const initiativeOrder = next.participants
    .slice()
    .sort((left, right) => (right.initiative ?? 0) - (left.initiative ?? 0) || left.id.localeCompare(right.id))
    .map(unit => unit.id);
  // The graphical battle opens on a player decision. Initiative still orders
  // every other unit, but a newly opened encounter must never resolve enemy
  // actions before the player has had a chance to operate the command deck.
  const playerId = next.participants.find(unit => unit.id === 'player' || unit.source === 'player')?.id;
  next.initiativeOrder = playerId
    ? [playerId, ...initiativeOrder.filter(id => id !== playerId)]
    : initiativeOrder;
  next.activeUnitId = next.initiativeOrder.find(id => next.participants.some(unit => unit.id === id && unit.hp > 0)) ?? '';
  return next;
}

function nextRandom(session: CombatSessionV2): number {
  const value = Math.sin((session.seed + 1) * 12_989.8 + session.randomCursor * 78_233.3) * 43_758.5453;
  session.randomCursor += 1;
  return value - Math.floor(value);
}

function unitById(session: CombatSessionV2, id: string): CombatParticipantV2 | undefined {
  return session.participants.find(unit => unit.id === id);
}

function living(session: CombatSessionV2, side?: CombatParticipantV2['side']): CombatParticipantV2[] {
  return session.participants.filter(unit => unit.hp > 0 && (!side || unit.side === side));
}

function combatTeam(side: CombatParticipantV2['side']): 'friendly' | 'enemy' {
  return side === 'enemy' ? 'enemy' : 'friendly';
}

function sameCombatTeam(left: CombatParticipantV2, right: CombatParticipantV2): boolean {
  return combatTeam(left.side) === combatTeam(right.side);
}

function livingRelativeTo(session: CombatSessionV2, actor: CombatParticipantV2, sameTeam: boolean): CombatParticipantV2[] {
  return living(session).filter(target => sameCombatTeam(actor, target) === sameTeam);
}

function statusModifier(unit: CombatParticipantV2, key: string): number {
  return (unit.typedStatuses ?? []).reduce((total, status) => total + Number(status.modifiers?.[key] ?? 0) * Math.max(1, status.stacks), 0);
}

/** Action accuracy uses 10 as its neutral value and modifies the actor's own
 * accuracy; it never replaces the actor stat. This keeps a normal matchup near
 * 70% while still allowing agile targets, status effects and accurate skills
 * to matter. */
export function combatHitChanceV2(actor: CombatParticipantV2, target: CombatParticipantV2, actionAccuracy = 10): number {
  const declared = Number.isFinite(Number(actionAccuracy)) ? Number(actionAccuracy) : 10;
  const actorAccuracy = Number.isFinite(Number(actor.accuracy)) ? Number(actor.accuracy) : 10;
  const targetEvasion = Number.isFinite(Number(target.evasion)) ? Number(target.evasion) : 0;
  const accuracyDelta = (actorAccuracy - 10) + (declared - 10) + statusModifier(actor, 'accuracy') - targetEvasion;
  return clamp(0.7 + accuracyDelta * 0.05, 0.15, 0.98);
}

function targetFor(session: CombatSessionV2, actor: CombatParticipantV2, targetIds: string[], targetMode: AbilityProposalTarget = 'enemy'): CombatParticipantV2 | undefined {
  const requested = targetIds.map(id => unitById(session, id)).find(target => target && target.hp > 0);
  if (requested && ((targetMode === 'enemy' && !sameCombatTeam(actor, requested)) || (targetMode === 'ally' && sameCombatTeam(actor, requested)) || (targetMode === 'self' && requested.id === actor.id))) return requested;
  if (targetMode === 'self') return actor;
  const candidates = livingRelativeTo(session, actor, targetMode === 'ally');
  return candidates.sort((left, right) => left.hp - right.hp || left.id.localeCompare(right.id))[0];
}

function targetsFor(session: CombatSessionV2, actor: CombatParticipantV2, targetIds: string[], targetMode: AbilityProposalTarget = 'enemy'): CombatParticipantV2[] {
  if (targetMode === 'none') return [];
  if (targetMode === 'area') return livingRelativeTo(session, actor, false);
  const target = targetFor(session, actor, targetIds, targetMode);
  return target ? [target] : [];
}

function scalingBonus(action: CombatActionDefinition | undefined, actor: CombatParticipantV2, appliesTo: 'damage' | 'healing' | 'accuracy'): number {
  return (action?.scaling ?? []).reduce((total, scaling) => {
    if ((scaling.appliesTo ?? 'damage') !== appliesTo) return total;
    const statId = scaling.statId as CombatScalingStatId;
    const canonicalValue = Number(actor.normalizedAttributes?.[statId] ?? 0);
    const coefficient = Number(scaling.coefficient);
    if (!Number.isFinite(canonicalValue) || !Number.isFinite(coefficient)) return total;
    return total + clamp(canonicalValue, 0, 100) * clamp(coefficient, -1, 1);
  }, 0);
}

function abilityPowerMultiplier(definition: AbilityDefinition | undefined, instance: AbilityInstance | undefined): number {
  const rank = Math.max(1, Math.trunc(instance?.runtime.rank ?? 1));
  const declared = Number(definition?.mechanics?.multiplier ?? 1);
  const controlled = Number.isFinite(declared) ? clamp(declared, 0.1, 3) : 1;
  return controlled * (1 + Math.max(0, rank - 1) * 0.1);
}

function abilityDamageValue(
  actor: CombatParticipantV2,
  definition: AbilityDefinition | undefined,
  instance: AbilityInstance | undefined,
  action: CombatActionDefinition | undefined,
): number {
  if (!definition) return Math.max(0, Math.round(actor.attackPower ?? 1));
  const declared = Number(action?.damage ?? definition.mechanics?.combat?.damage ?? 0);
  if (!Number.isFinite(declared) || declared <= 0) return 0;
  const base = (actor.attackPower ?? 1) + declared + scalingBonus(action, actor, 'damage');
  return Math.max(0, Math.round(base * abilityPowerMultiplier(definition, instance)));
}

function abilityHealingValue(
  actor: CombatParticipantV2,
  definition: AbilityDefinition | undefined,
  instance: AbilityInstance | undefined,
  action: CombatActionDefinition | undefined,
): number {
  const declared = Number(action?.healing ?? definition?.mechanics?.combat?.healing ?? 0);
  if (!Number.isFinite(declared) || declared <= 0) return 0;
  const base = (actor.healingPower ?? 0) + declared + scalingBonus(action, actor, 'healing');
  return Math.max(0, Math.round(base * abilityPowerMultiplier(definition, instance)));
}

function actionRecord(input: CombatCommandInputV2, session: CombatSessionV2): CombatActionRecordV2 {
  return {
    id: `${session.id}:action:${input.commandId}`,
    commandId: input.commandId,
    transactionId: `${session.id}:transaction:${input.commandId}`,
    round: session.round,
    unitId: input.unitId,
    kind: input.kind,
    targetIds: [...input.targetIds],
    input: clone(input),
    damage: 0,
    healing: 0,
    statusChanges: [],
    resourceChanges: [],
    itemChanges: [],
    resolved: false,
  };
}

function rejectCommand(session: CombatSessionV2, input: CombatCommandInputV2, reason: string): CombatCommandResolution {
  const record = actionRecord(input, session);
  record.rejected = true;
  record.reason = reason;
  session.actionSequence.push(record);
  return { session, record, alreadyProcessed: false };
}

function applyStatus(target: CombatParticipantV2, status: CombatStatusV2, record: CombatActionRecordV2): void {
  target.typedStatuses ??= [];
  const existing = target.typedStatuses.find(item => item.id === status.id);
  if (existing) {
    existing.stacks = clamp(existing.stacks + status.stacks, 1, 99);
    existing.remainingRounds = Math.max(existing.remainingRounds, status.remainingRounds);
    record.statusChanges.push({ targetId: target.id, statusId: status.id, operation: 'stacked', stacks: existing.stacks });
  } else {
    target.typedStatuses.push(clone(status));
    record.statusChanges.push({ targetId: target.id, statusId: status.id, operation: 'applied', stacks: status.stacks });
  }
}

function abilityInstanceFor(session: CombatSessionV2, actor: CombatParticipantV2, definitionId: string): AbilityInstance | undefined {
  const instance = actor.abilityInstances?.[definitionId] ?? session.abilityInstances[definitionId];
  return instance && instance.runtime.rank > 0 ? instance : undefined;
}

export interface CombatAbilityCostV2 {
  pool: 'resource' | 'health';
  label: string;
  amount: number;
}

function controlledCombatCost(actor: CombatParticipantV2, path: string, amount: number, labels?: { health: string; resource: string }): CombatAbilityCostV2 | undefined {
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  const normalizedPath = path.trim();
  const resource = normalizedPath === 'resource'
    || normalizedPath === 'combat.resource'
    || normalizedPath === '战斗资源'
    || normalizedPath === actor.stateBinding?.resourcePath;
  if (resource) return { pool: 'resource', label: labels?.resource?.trim() || '能量', amount };
  const health = normalizedPath === 'health'
    || normalizedPath === 'combat.health'
    || normalizedPath === '生命'
    || normalizedPath === '血量'
    || normalizedPath === actor.stateBinding?.hpPath;
  return health ? { pool: 'health', label: labels?.health?.trim() || '生命', amount } : undefined;
}

export function getCombatAbilityCostsV2(actor: CombatParticipantV2 | undefined, definition: AbilityDefinition, labels: { health: string; resource: string } = { health: '生命', resource: '能量' }): { costs: CombatAbilityCostV2[]; reason: string } {
  if (!actor) return { costs: [], reason: '当前没有行动单位' };
  const normalizedDefinition = ensureCombatAbilityDefaults(definition);
  const costs: CombatAbilityCostV2[] = [];
  for (const cost of normalizedDefinition.mechanics?.costs ?? []) {
    const controlled = controlledCombatCost(actor, cost.path, Number(cost.amount), labels);
    if (!controlled) return { costs: [], reason: '存在未受控战斗成本' };
    if (controlled.amount > 0) costs.push(controlled);
  }
  const resource = costs.filter(cost => cost.pool === 'resource').reduce((total, cost) => total + cost.amount, 0);
  const health = costs.filter(cost => cost.pool === 'health').reduce((total, cost) => total + cost.amount, 0);
  if ((actor.resource ?? 0) < resource) return { costs, reason: `${labels.resource}不足（需 ${resource}）` };
  if (health > 0 && actor.hp <= health) return { costs, reason: `${labels.health}不足（需保留至少 1 点）` };
  return { costs, reason: '' };
}

export interface CombatAbilityPreviewV2 {
  costs: CombatAbilityCostV2[];
  cooldownRounds: number;
  targetCount: number;
  hitChance?: number;
  damage?: number;
  criticalDamage?: number;
  healing?: number;
  reason: string;
}

function projectedDamage(target: CombatParticipantV2, rawDamage: number): number {
  const reduced = target.defending ? Math.ceil(rawDamage * 0.5) : rawDamage;
  return Math.max(0, reduced - Math.max(0, (target.armor ?? 0) + statusModifier(target, 'armor')));
}

/**
 * Uses the exact local combat formula to explain a skill before the player
 * spends anything. This is deliberately deterministic: random rolls are not
 * consumed and the UI receives a chance plus normal/critical damage instead
 * of a misleading promise that an attack will hit.
 */
export function previewCombatAbilityV2(
  session: CombatSessionV2,
  actorId: string,
  abilityId: string,
  targetId?: string,
): CombatAbilityPreviewV2 {
  const actor = unitById(session, actorId);
  const rawDefinition = actor?.abilityDefinitions?.[abilityId];
  if (!actor || !rawDefinition) return { costs: [], cooldownRounds: 0, targetCount: 0, reason: '技能不可用' };
  const definition = ensureCombatAbilityDefaults(rawDefinition);
  const instance = abilityInstanceFor(session, actor, definition.id);
  const action = definition.mechanics?.combatAction;
  if (!instance || !action) return { costs: [], cooldownRounds: 0, targetCount: 0, reason: '技能未获得或没有战斗效果' };
  const cooldownRounds = actor.cooldowns[definition.id] ?? instance.runtime.cooldownRemaining ?? 0;
  const costState = getCombatAbilityCostsV2(actor, definition, session.statLabels);
  const targets = targetsFor(session, actor, targetId ? [targetId] : [], action.target);
  const baseDamage = abilityDamageValue(actor, definition, instance, action);
  const baseHealing = abilityHealingValue(actor, definition, instance, action);
  const actionAccuracy = (action.accuracy ?? 10) + scalingBonus(action, actor, 'accuracy');
  const target = targets[0];
  const normalRaw = Math.max(0, Math.round(baseDamage + statusModifier(actor, 'damage')));
  const damage = target && baseDamage > 0 ? projectedDamage(target, normalRaw) : undefined;
  const criticalDamage = target && baseDamage > 0 ? projectedDamage(target, normalRaw * 2) : undefined;
  const healing = baseHealing > 0 ? baseHealing : undefined;
  const reason = cooldownRounds > 0
    ? `冷却中（${cooldownRounds}轮）`
    : costState.reason
      ? costState.reason
      : action.target !== 'none' && targets.length === 0
        ? '当前没有合法目标'
        : '';
  return {
    costs: costState.costs,
    cooldownRounds,
    targetCount: targets.length,
    ...(target && baseDamage > 0 ? { hitChance: combatHitChanceV2(actor, target, actionAccuracy) } : {}),
    ...(damage === undefined ? {} : { damage }),
    ...(criticalDamage === undefined ? {} : { criticalDamage }),
    ...(healing === undefined ? {} : { healing }),
    reason,
  };
}

function applyCost(actor: CombatParticipantV2, definition: AbilityDefinition, record: CombatActionRecordV2, labels?: { health: string; resource: string }): boolean {
  const preview = getCombatAbilityCostsV2(actor, definition, labels);
  if (preview.reason) return false;
  const resource = preview.costs.filter(cost => cost.pool === 'resource').reduce((total, cost) => total + cost.amount, 0);
  const health = preview.costs.filter(cost => cost.pool === 'health').reduce((total, cost) => total + cost.amount, 0);
  if (resource > 0) {
    actor.resource = (actor.resource ?? 0) - resource;
    record.resourceChanges.push({ unitId: actor.id, resource: 'resource', delta: -resource });
  }
  if (health > 0) {
    actor.hp -= health;
    record.resourceChanges.push({ unitId: actor.id, resource: 'health', delta: -health });
  }
  return true;
}

function applyCooldown(actor: CombatParticipantV2, definitionId: string, rounds: number): void {
  const stored = Math.max(0, Math.trunc(rounds) > 0 ? Math.trunc(rounds) + 1 : 0);
  actor.cooldowns[definitionId] = stored;
  const instance = actor.abilityInstances?.[definitionId];
  if (instance) instance.runtime.cooldownRemaining = stored;
}

function recordAbilityUse(session: CombatSessionV2, actor: CombatParticipantV2, definition: AbilityDefinition): void {
  const instance = abilityInstanceFor(session, actor, definition.id);
  if (!instance) return;
  instance.runtime.uses += 1;
  const proficiency = definition.mechanics?.proficiency;
  const gain = Math.max(0, Math.trunc(proficiency?.gainPerUse ?? 1));
  const threshold = Math.max(1, Math.trunc(proficiency?.thresholdPerRank ?? 10));
  const maxRank = Math.max(1, Math.trunc(proficiency?.maxRank ?? definition.maxRank));
  const total = instance.runtime.proficiency + gain;
  const rankGain = Math.min(Math.max(0, maxRank - instance.runtime.rank), Math.floor(total / threshold));
  instance.runtime.proficiency = total - rankGain * threshold;
  instance.runtime.rank = Math.min(maxRank, instance.runtime.rank + rankGain);
  actor.abilityInstances ??= {};
  actor.abilityInstances[definition.id] = instance;
  session.abilityInstances[definition.id] = clone(instance);
}

function resolveAttack(session: CombatSessionV2, actor: CombatParticipantV2, target: CombatParticipantV2, baseDamage: number, actionAccuracy: number, critChance: number, record: CombatActionRecordV2): void {
  const roll = nextRandom(session);
  const hit = roll <= combatHitChanceV2(actor, target, actionAccuracy);
  record.hit = hit;
  if (!hit) return;
  const critical = nextRandom(session) < clamp(critChance, 0, 0.95);
  const raw = Math.max(0, Math.round(baseDamage + statusModifier(actor, 'damage')) * (critical ? 2 : 1));
  const reduced = target.defending ? Math.ceil(raw * 0.5) : raw;
  const damage = Math.max(0, reduced - Math.max(0, (target.armor ?? 0) + statusModifier(target, 'armor')));
  target.hp = Math.max(0, target.hp - damage);
  record.critical = critical;
  record.damage += damage;
}

function resolveHealing(target: CombatParticipantV2, amount: number, record: CombatActionRecordV2): void {
  const healing = Math.max(0, Math.min(target.maxHp - target.hp, Math.round(amount)));
  target.hp += healing;
  record.healing += healing;
}

function tickRound(session: CombatSessionV2): void {
  for (const unit of session.participants) {
    unit.defending = false;
    for (const [abilityId, cooldown] of Object.entries(unit.cooldowns)) {
      unit.cooldowns[abilityId] = Math.max(0, cooldown - 1);
      const instance = unit.abilityInstances?.[abilityId] ?? session.abilityInstances[abilityId];
      if (instance) {
        instance.runtime.cooldownRemaining = unit.cooldowns[abilityId];
        session.abilityInstances[abilityId] = clone(instance);
      }
    }
    const statuses = unit.typedStatuses ?? [];
    const remaining: CombatStatusV2[] = [];
    for (const status of statuses) {
      if (status.damagePerRound && unit.hp > 0) unit.hp = Math.max(0, unit.hp - status.damagePerRound * Math.max(1, status.stacks));
      if (status.healingPerRound && unit.hp > 0) unit.hp = Math.min(unit.maxHp, unit.hp + status.healingPerRound * Math.max(1, status.stacks));
      const nextRounds = status.remainingRounds - 1;
      if (nextRounds > 0) remaining.push({ ...status, remainingRounds: nextRounds });
    }
    unit.typedStatuses = remaining;
    unit.actedRound = 0;
  }
  session.round += 1;
  finishIfTerminal(session);
}

function moveToNextActor(session: CombatSessionV2): void {
  const next = session.initiativeOrder
    .map(id => unitById(session, id))
    .find(unit => unit && unit.hp > 0 && unit.actedRound !== session.round);
  if (next) {
    session.activeUnitId = next.id;
    return;
  }
  tickRound(session);
  if (session.lifecycle !== 'active') return;
  session.activeUnitId = session.initiativeOrder.map(id => unitById(session, id)).find(unit => unit && unit.hp > 0)?.id ?? '';
}

function reportUnitStatus(unit: CombatParticipantV2, riskMode: CombatSessionV2['riskMode']): CombatMechanicalReportV2['participants'][number]['status'] {
  if (unit.hp <= 0) return riskMode === 'normal' ? 'incapacitated' : 'dead';
  if (unit.hp < unit.maxHp * 0.25) return 'incapacitated';
  if (unit.hp < unit.maxHp) return 'wounded';
  return 'active';
}

function allCombatParticipants(session: CombatSessionV2): CombatParticipantV2[] {
  const byId = new Map<string, CombatParticipantV2>();
  for (const unit of [...(session.resolvedParticipants ?? []), ...session.participants]) byId.set(unit.id, unit);
  return [...byId.values()];
}

function buildMechanicalReport(session: CombatSessionV2): CombatMechanicalReportV2 {
  const participants = allCombatParticipants(session).map(unit => ({
    id: unit.id,
    identity: unit.identity,
    side: unit.side,
    ...(unit.source ? { source: unit.source } : {}),
    hp: unit.hp,
    maxHp: unit.maxHp,
    ...(unit.resource === undefined ? {} : { resource: unit.resource }),
    status: reportUnitStatus(unit, session.riskMode),
  }));
  const injuries = participants
    .filter(unit => unit.status !== 'active')
    .map(unit => ({ unitId: unit.id, hp: unit.hp, status: unit.status as 'wounded' | 'incapacitated' | 'dead' }));
  const skillsUsed = [...new Set(session.actionSequence.flatMap(action => action.resolved && action.kind === 'skill' && action.input?.abilityId ? [action.input.abilityId] : []))];
  const itemsUsed = [...new Set(session.actionSequence.flatMap(action => action.resolved && action.kind === 'item' && action.input?.itemId ? [action.input.itemId] : []))];
  return {
    encounter: { id: session.encounter.id, context: session.encounter.context, threatBand: session.encounter.threatBand },
    riskMode: session.riskMode,
    participants,
    actions: clone(session.actionSequence),
    skillsUsed,
    itemsUsed,
    injuries,
    deaths: participants.filter(unit => unit.status === 'dead').map(unit => unit.id),
    rewards: clone(session.rewardEffects ?? []),
    finalState: {
      status: session.status === 'active' ? 'draw' : session.status,
      round: session.round,
      activeUnitId: session.activeUnitId,
      units: participants.map(unit => ({ id: unit.id, hp: unit.hp, ...(unit.resource === undefined ? {} : { resource: unit.resource }) })),
    },
  };
}

function terminalResult(session: CombatSessionV2, status: CombatResult['status']): CombatResult {
  const result: CombatResult = {
    ...emptyResult(),
    status,
    rewardEffects: clone(session.rewardEffects ?? []),
    terminalTransactionId: `${session.id}:terminal:${status}:${session.round}`,
  };
  result.report = buildMechanicalReport(session);
  if (session.riskMode === 'inferno' && result.report.deaths.some(id => {
    const unit = allCombatParticipants(session).find(participant => participant.id === id);
    return unit?.source === 'player' || id === 'player';
  })) {
    result.endedAt = Date.now();
  }
  return result;
}

function finishIfTerminal(session: CombatSessionV2): void {
  const players = living(session).filter(unit => unit.side !== 'enemy');
  const enemies = living(session, 'enemy');
  if (players.length === 0) {
    session.status = 'defeat';
    session.lifecycle = 'terminal';
    session.result = terminalResult(session, 'defeat');
  } else if (enemies.length === 0) {
    const defeated = session.participants.filter(unit => unit.side === 'enemy' && unit.hp <= 0);
    session.resolvedParticipants = [...(session.resolvedParticipants ?? []).filter(previous => !defeated.some(unit => unit.id === previous.id)), ...clone(defeated)];
    const nextWave = session.waves.slice(1);
    if (nextWave.length > 0) {
      session.waves = nextWave;
      const waveUnits = currentWave(session);
      session.participants = [...session.participants.filter(unit => unit.side !== 'enemy'), ...waveUnits];
      session.initiativeOrder = session.participants.sort((left, right) => (right.initiative ?? 0) - (left.initiative ?? 0) || left.id.localeCompare(right.id)).map(unit => unit.id);
      session.activeUnitId = session.initiativeOrder[0] ?? '';
    } else {
      session.status = 'victory';
      session.lifecycle = 'terminal';
      session.result = terminalResult(session, 'victory');
    }
  }
}

export function resolveCombatCommandV2(sessionInput: CombatSessionV2, input: CombatCommandInputV2): CombatCommandResolution {
  const session = clone(sessionInput);
  const previous = session.actionSequence.find(record => record.commandId === input.commandId);
  if (previous) return { session: clone(sessionInput), record: clone(previous), alreadyProcessed: true };
  const record = actionRecord(input, session);
  if (session.lifecycle !== 'active') return rejectCommand(session, input, '战斗不在进行中');
  const actor = unitById(session, input.unitId);
  if (!actor || actor.hp <= 0) return rejectCommand(session, input, '行动单位无效或已退场');
  if (session.activeUnitId !== actor.id || actor.actedRound === session.round) return rejectCommand(session, input, '每单位每轮只能行动一次，或当前不是该单位回合');
  const storedDefinition = input.abilityId ? actor.abilityDefinitions?.[input.abilityId] : undefined;
  const definition = storedDefinition ? ensureCombatAbilityDefaults(storedDefinition) : undefined;
  const instance = input.abilityId ? abilityInstanceFor(session, actor, input.abilityId) : undefined;
  if (input.kind === 'skill' && (!definition || !instance || (actor.cooldowns[input.abilityId!] ?? instance.runtime.cooldownRemaining ?? 0) > 0 || instance.runtime.cooldownRemaining > 0)) return rejectCommand(session, input, '技能未获得、等级无效或仍在冷却');
  if (input.kind === 'item') {
    const item = input.itemId ? session.itemDefinitions[input.itemId] : undefined;
    const quantity = item ? actor.itemQuantities?.[item.id] ?? 0 : 0;
    if (!item || item.narrativeOnly || quantity <= 0) return rejectCommand(session, input, '道具不存在、不可用于战斗或数量不足');
    const itemTarget = targetFor(session, actor, input.targetIds, item.target);
    if (!itemTarget) return rejectCommand(session, input, '道具目标无效');
    actor.itemQuantities![item.id] = quantity - 1;
    record.itemChanges.push({ unitId: actor.id, itemId: item.id, delta: -1 });
    if (item.purpose === 'heal') resolveHealing(itemTarget, item.amount, record);
    if (item.purpose === 'damage') resolveAttack(session, actor, itemTarget, item.amount, 10, actor.critChance ?? 0.05, record);
    if (item.purpose === 'resource') {
      itemTarget.resource = Math.min(itemTarget.maxResource ?? itemTarget.resource ?? 0, (itemTarget.resource ?? 0) + item.amount);
      record.resourceChanges.push({ unitId: itemTarget.id, resource: 'resource', delta: item.amount });
    }
    if (item.purpose === 'cleanse') {
      const before = itemTarget;
      const removed = before.typedStatuses?.filter(status => !item.statusId || status.id === item.statusId) ?? [];
      before.typedStatuses = item.statusId ? (before.typedStatuses ?? []).filter(status => status.id !== item.statusId) : [];
      for (const status of removed) record.statusChanges.push({ targetId: before.id, statusId: status.id, operation: 'removed', stacks: status.stacks });
    }
    if (item.status) applyStatus(itemTarget, item.status, record);
  } else if (input.kind === 'defend') {
    actor.defending = true;
  } else if (input.kind === 'flee') {
    const chance = clamp(0.25 + (actor.evasion ?? 0) / 20 - ({ weak: 0, matched: 0.05, dangerous: 0.12, boss: 0.2, overwhelming: 0.3 }[session.encounter.threatBand]) + session.round * 0.02, 0.05, 0.9);
    record.hit = nextRandom(session) < chance;
    if (record.hit) {
      session.status = 'escaped';
      session.lifecycle = 'terminal';
      session.result = terminalResult(session, 'escaped');
    }
  } else {
    const action = definition?.mechanics?.combatAction;
    const mode = action?.target ?? 'enemy';
    const resolvedTargets = targetsFor(session, actor, input.targetIds, mode);
    if (mode !== 'none' && resolvedTargets.length === 0) return rejectCommand(session, input, '技能目标无效');
    record.targetIds = resolvedTargets.map(target => target.id);
    if (definition) {
      const costState = getCombatAbilityCostsV2(actor, definition, session.statLabels);
      if (costState.reason) return rejectCommand(session, input, costState.reason);
      if (!applyCost(actor, definition, record, session.statLabels)) return rejectCommand(session, input, '技能消耗结算失败');
    }
    if (definition) {
      applyCooldown(actor, definition.id, definition.mechanics?.cooldownRounds ?? action?.cooldownRounds ?? 0);
      recordAbilityUse(session, actor, definition);
    }
    if (definition?.mechanics?.rewards?.length) session.rewardEffects = [...(session.rewardEffects ?? []), ...clone(definition.mechanics.rewards).flatMap(reward => reward.effects)];
    const damage = abilityDamageValue(actor, definition, instance, action);
    const healing = abilityHealingValue(actor, definition, instance, action);
    const accuracy = (action?.accuracy ?? 10) + scalingBonus(action, actor, 'accuracy');
    for (const resolvedTarget of resolvedTargets) {
      if (damage > 0 && (mode === 'enemy' || mode === 'area')) resolveAttack(session, actor, resolvedTarget, damage, accuracy, actor.critChance ?? 0.05, record);
      if (healing > 0) resolveHealing(resolvedTarget, healing, record);
      if (action?.appliesStatus) applyStatus(resolvedTarget, { id: action.appliesStatus.id, name: action.appliesStatus.name, remainingRounds: action.appliesStatus.durationRounds ?? 1, stacks: 1, damagePerRound: action.appliesStatus.damagePerRound, modifiers: action.appliesStatus.modifiers }, record);
    }
  }
  actor.actedRound = session.round;
  record.resolved = true;
  session.actionSequence.push(record);
  session.appliedTransactionIds.push(record.transactionId);
  finishIfTerminal(session);
  if (session.result) session.result.report = buildMechanicalReport(session);
  if (session.lifecycle === 'active') moveToNextActor(session);
  return { session, record, alreadyProcessed: false };
}

export function chooseAutomaticCommand(session: CombatSessionV2, unitId: string, strategy: CombatAutoStrategy): CombatCommandInputV2 {
  const actor = unitById(session, unitId);
  const enemies = actor ? livingRelativeTo(session, actor, false) : [];
  const allies = actor ? livingRelativeTo(session, actor, true) : [];
  const usableSkills = actor
    ? Object.values(actor.abilityDefinitions ?? {}).map(ensureCombatAbilityDefaults).filter(definition => {
      const action = definition.mechanics?.combatAction;
      const instance = abilityInstanceFor(session, actor, definition.id);
      const costState = getCombatAbilityCostsV2(actor, definition, session.statLabels);
      return Boolean(action) && Boolean(instance) && (actor.cooldowns[definition.id] ?? instance?.runtime.cooldownRemaining ?? 0) <= 0 && !costState.reason;
    })
    : [];
  const healingAbility = usableSkills.find(definition => (definition.mechanics?.combatAction?.healing ?? definition.mechanics?.combat?.healing ?? 0) > 0);
  const weakestAlly = allies.sort((left, right) => left.hp / left.maxHp - right.hp / right.maxHp)[0];
  if (strategy === 'support' && healingAbility && weakestAlly && weakestAlly.hp < weakestAlly.maxHp) {
    return { commandId: `${session.id}:auto:${unitId}:${session.round}:support`, unitId, kind: 'skill', abilityId: healingAbility.id, targetIds: [weakestAlly.id] };
  }
  if (strategy === 'defensive' && actor && actor.hp / actor.maxHp <= 0.6) {
    return { commandId: `${session.id}:auto:${unitId}:${session.round}:defend`, unitId, kind: 'defend', targetIds: [unitId] };
  }
  const target = enemies.sort((left, right) => left.hp - right.hp || left.id.localeCompare(right.id))[0];
  const damagingSkills = usableSkills
    .filter(definition => (definition.mechanics?.combatAction?.damage ?? definition.mechanics?.combat?.damage ?? 0) > 0)
    .sort((left, right) => (right.mechanics?.combatAction?.damage ?? right.mechanics?.combat?.damage ?? 0) - (left.mechanics?.combatAction?.damage ?? left.mechanics?.combat?.damage ?? 0));
  const chosenSkill = strategy === 'aggressive' ? damagingSkills[0] : strategy === 'balanced' || strategy === 'support' ? usableSkills[0] : undefined;
  return {
    commandId: `${session.id}:auto:${unitId}:${session.round}:${strategy}`,
    unitId,
    kind: chosenSkill ? 'skill' : 'attack',
    ...(chosenSkill ? { abilityId: chosenSkill.id } : {}),
    targetIds: target ? [target.id] : [],
  };
}

export function advanceAutomaticTurns(sessionInput: CombatSessionV2, strategies: Record<string, CombatAutoStrategy>): CombatSessionV2 {
  let session = clone(sessionInput);
  let guard = 0;
  while (session.lifecycle === 'active' && guard < 64) {
    const actor = unitById(session, session.activeUnitId);
    if (!actor || !strategies[actor.id]) break;
    session = resolveCombatCommandV2(session, chooseAutomaticCommand(session, actor.id, strategies[actor.id])).session;
    guard += 1;
  }
  return session;
}

export function balanceCombatItemProposal(proposal: AbilityProposal & { itemPurpose: CombatItemPurpose }): CombatItemDefinition {
  const target: AbilityProposalTarget = proposal.itemPurpose === 'damage' ? 'enemy' : proposal.target === 'ally' ? 'ally' : 'self';
  const ability = balanceAbilityProposal({ ...proposal, category: 'combat_item', target });
  const power = { 普通: 1, 精良: 2, 稀有: 3, 史诗: 4, 传说: 5 }[proposal.rarity];
  const amount = proposal.itemPurpose === 'damage' ? power * 2 : proposal.itemPurpose === 'resource' ? power * 5 : proposal.itemPurpose === 'heal' ? power * 2 : 0;
  const status = proposal.itemPurpose === 'buff' ? { id: `combat-item:${proposal.id}:buff`, name: `${proposal.name}增益`, remainingRounds: 2, stacks: 1, modifiers: { armor: power } } : undefined;
  return { schemaVersion: 2, id: proposal.id, name: proposal.name, description: proposal.description, purpose: proposal.itemPurpose, target, amount, ...(status ? { status } : {}), ability: { ...ability, category: 'combat_item' }, narrativeOnly: false };
}

export function normalizeCombatItemDefinition(input: unknown): CombatItemDefinition | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const description = typeof raw.description === 'string' ? raw.description.trim() : '';
  if (!id || !name) return undefined;
  const purpose = raw.purpose === 'heal' || raw.purpose === 'resource' || raw.purpose === 'damage' || raw.purpose === 'cleanse' || raw.purpose === 'buff'
    ? raw.purpose
    : raw.type === 'heal' || raw.type === 'resource' || raw.type === 'damage' || raw.type === 'cleanse' || raw.type === 'buff'
      ? raw.type
      : inferCombatItemPurpose(id, raw);
  const target = raw.target === 'enemy' || raw.target === 'ally' || raw.target === 'self' ? raw.target : purpose === 'damage' ? 'enemy' : 'self';
  const rarity = raw.rarity === '精良' || raw.rarity === '稀有' || raw.rarity === '史诗' || raw.rarity === '传说' ? raw.rarity : '普通';
  const proposal: AbilityProposal & { itemPurpose: CombatItemPurpose } = {
    schemaVersion: 2,
    id,
    name,
    description: description || name,
    category: 'combat_item',
    rarity,
    target,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 16) : [],
    itemPurpose: purpose ?? 'buff',
  };
  const controlled = balanceCombatItemProposal(proposal);
  if (!purpose) {
    const narrative = { ...controlled, purpose: 'buff' as const, target: 'none' as const, amount: 0, narrativeOnly: true };
    delete narrative.status;
    return narrative;
  }
  if (purpose === 'cleanse' && typeof raw.statusId === 'string' && raw.statusId.trim()) controlled.statusId = raw.statusId.trim();
  return { ...controlled, narrativeOnly: raw.narrativeOnly === true };
}

export function retryCombatSession(sessionInput: CombatSessionV2): { ok: boolean; reason?: string; session?: CombatSessionV2; restore?: CombatCheckpointRestore } {
  if (!canRollbackCombat(sessionInput.riskMode, sessionInput.lifecycle)) return { ok: false, reason: '炼狱战斗禁止重打或历史回滚' };
  const session = clone(sessionInput);
  const checkpoint = session.preCombatCheckpoint;
  const restore = restoreCombatCheckpoint(checkpoint);
  const checkpointEnemies = checkpoint.participants.filter(unit => unit.side === 'enemy');
  const checkpointAllies = checkpoint.participants.filter(unit => unit.side !== 'enemy');
  if (checkpointAllies.length > 0) session.availableAllyPool = clone(checkpointAllies);
  if (checkpointEnemies.length > 0) {
    session.availableEnemyPool = clone(checkpointEnemies);
    session.lockedEnemyIds = checkpointEnemies.map(unit => unit.id);
    session.waves = [];
    for (let index = 0; index < checkpointEnemies.length; index += 4) session.waves.push({ id: `${session.id}:retry-wave:${index / 4 + 1}`, unitIds: checkpointEnemies.slice(index, index + 4).map(unit => unit.id) });
  }
  if (checkpoint.gameState?.v3?.abilityInstances) session.abilityInstances = clone(checkpoint.gameState.v3.abilityInstances);
  session.lifecycle = 'preparing';
  session.status = 'active';
  session.round = 1;
  session.randomCursor = checkpoint.randomCursor;
  session.actionSequence = [];
  session.appliedTransactionIds = [];
  session.result = undefined;
  session.participants = [];
  session.resolvedParticipants = [];
  session.activeUnitId = '';
  session.initiativeOrder = [];
  return { ok: true, session, restore };
}

export function applyCombatResultToSave(saveInput: GameSave, settlement: CombatResultSettlement): GameSave {
  const save = clone(saveInput);
  if (save.lifecycle === 'ended') return save;
  if (settlement.riskMode === 'inferno' && settlement.playerDied) {
    save.lifecycle = 'ended';
    save.endedAt = settlement.result.endedAt ?? Date.now();
    save.endReason = '炼狱战斗中玩家死亡，存档已封存为只读。';
  }
  return save;
}

function worldValueForRatio(ratio: number, originalMax: number, riskMode: CombatSessionV2['riskMode']): number {
  if (ratio <= 0 && riskMode === 'normal') return Math.max(1, Math.ceil(originalMax * 0.1));
  return Math.max(0, Math.round(clamp(ratio, 0, 1) * originalMax));
}

function applyInventoryBinding(state: GameState, binding: CombatStateBindingV2, quantities: Record<string, number>): void {
  if (!binding.inventoryPath) return;
  const inventory = getGameplayPath(state, binding.inventoryPath);
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) return;
  const recordInventory = inventory as Record<string, unknown>;
  for (const [itemId, quantity] of Object.entries(quantities)) {
    const item = recordInventory[itemId];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const itemRecord = item as Record<string, unknown>;
      if ('数量' in itemRecord) itemRecord.数量 = Math.max(0, Math.trunc(quantity));
    } else if (typeof item === 'number') {
      recordInventory[itemId] = Math.max(0, Math.trunc(quantity));
    }
  }
}

function applyParticipantBinding(state: GameState, session: CombatSessionV2, unit: CombatParticipantV2): void {
  const binding = unit.stateBinding;
  if (!binding || binding.kind === 'temporary') return;
  const hpRatio = unit.maxHp > 0 ? unit.hp / unit.maxHp : 0;
  const resourceRatio = unit.maxResource && unit.maxResource > 0 ? (unit.resource ?? 0) / unit.maxResource : 0;
  if (binding.hpPath) setGameplayPath(state, binding.hpPath, worldValueForRatio(hpRatio, binding.originalMaxHp, session.riskMode), false);
  if (binding.resourcePath) setGameplayPath(state, binding.resourcePath, worldValueForRatio(resourceRatio, binding.originalMaxResource, 'hard'), false);
  applyInventoryBinding(state, binding, unit.itemQuantities ?? binding.originalItemQuantities);
  if (binding.injuryPath) {
    const status = unit.hp <= 0
      ? session.riskMode === 'normal' ? '失去战力' : '死亡'
      : unit.hp < unit.maxHp * 0.35 ? '重伤' : '正常';
    setGameplayPath(state, binding.injuryPath, status, false);
  }
}

function persistAbilityRuntime(state: GameState, session: CombatSessionV2): void {
  if (!state.v3) return;
  // Combat cooldowns are encounter-local round counters. They must never be
  // projected into the world/simulation tick timeline or poison the next
  // encounter. Usage and proficiency persist; cooldowns end with this battle.
  const persistedInstances = Object.fromEntries(
    Object.entries(session.abilityInstances).map(([id, instance]) => [id, {
      ...clone(instance),
      runtime: { ...clone(instance.runtime), cooldownRemaining: 0 },
    }]),
  );
  state.v3.abilityInstances = { ...(state.v3.abilityInstances ?? {}), ...persistedInstances };
  const playerSkills = state.玩家.能力系统?.已掌握技能;
  const professionSkills = state.玩家.能力系统?.职业状态?.已解锁能力;
  for (const [id, instance] of Object.entries(session.abilityInstances)) {
    const runtime = instance.runtime;
    if (playerSkills?.[id]) playerSkills[id] = { ...playerSkills[id], 等级: runtime.rank, 使用次数: runtime.uses, 熟练度: runtime.proficiency };
    if (professionSkills?.[id]) professionSkills[id] = { ...professionSkills[id], 等级: runtime.rank, 使用次数: runtime.uses };
  }
}

function applyCombatConsequences(state: GameState, session: CombatSessionV2): void {
  for (const unit of allCombatParticipants(session)) applyParticipantBinding(state, session, unit);
  persistAbilityRuntime(state, session);
}

export function settleCombatResult(stateInput: GameState, sessionInput: CombatSessionV2): { state: GameState; result: CombatResult; alreadyApplied: boolean } {
  const state = clone(stateInput);
  const session = clone(sessionInput);
  const result = clone(session.result ?? { ...emptyResult(), status: session.status === 'active' ? 'draw' : session.status });
  const transactionId = result.terminalTransactionId ?? `${session.id}:terminal:${result.status}`;
  if (state.v3?.combatResult?.terminalTransactionId === transactionId && state.v3.combatResult.rewardsApplied) return { state, result: clone(state.v3.combatResult), alreadyApplied: true };
  result.report ??= buildMechanicalReport(session);
  const consequenceState = clone(state);
  applyCombatConsequences(consequenceState, session);
  const execution = result.rewardEffects.length > 0
    ? executeGameplayTransaction(consequenceState, { id: transactionId, moduleId: 'combat', source: 'combat.result', effects: result.rewardEffects }, { tick: session.round, enabledModules: ['combat'] })
    : { state: consequenceState, status: 'applied' as const };
  if (execution.status !== 'applied') return { state, result, alreadyApplied: false };
  const next = clone(execution.state);
  const settledResult: CombatResult = { ...result, rewardsApplied: true, terminalTransactionId: transactionId };
  session.result = settledResult;
  next.v3 = {
    ...(next.v3 ?? { schemaVersion: 3, featureFlags: { professionsEnabled: false, combatEnabled: true, combatRiskMode: session.riskMode } }),
    combatSession: session,
    combatResult: settledResult,
  };
  return { state: next, result: settledResult, alreadyApplied: false };
}

/** Persist the complete immutable combat snapshot into the v3 save state. */
export function persistCombatSession(stateInput: GameState, sessionInput: CombatSessionV2): GameState {
  const state = clone(stateInput);
  state.v3 = {
    ...(state.v3 ?? { schemaVersion: 3 }),
    schemaVersion: 3,
    featureFlags: {
      professionsEnabled: state.v3?.featureFlags?.professionsEnabled ?? false,
      combatEnabled: state.v3?.featureFlags?.combatEnabled ?? true,
      combatRiskMode: state.v3?.featureFlags?.combatRiskMode ?? sessionInput.riskMode,
    },
    combatSession: clone(sessionInput),
    ...(sessionInput.result ? { combatResult: clone(sessionInput.result) } : {}),
  };
  return state;
}

export { canRollbackCombat };
