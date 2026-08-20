import type { WorldModule } from '../data/worlds-schema';
import type { ProfessionModuleSchema } from '../modules/schema';
import { resolveProfessionBinding } from '../data/professions';
import type { GameState } from '../schema/variables';
import {
  createDefaultGameplayRuntime,
  ensureGameplayRuntime,
  GAMEPLAY_SCHEMA_VERSION,
} from './kernel';

export type GameplayPrepareMode = 'new' | 'load';

export interface PrepareGameplayOptions {
  mode: GameplayPrepareMode;
}

export interface PrepareGameplayResult {
  state: GameState;
  appliedMigrations: string[];
}

const RUNTIME_V1_MIGRATION = 'gameplay-runtime-v1';
const COMBAT_RUNTIME_V1_MIGRATION = 'combat-runtime-v1';

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function moduleSource(module: WorldModule): Record<string, unknown> {
  return record(module.moduleConfig ?? module.data);
}

function initialSource(module: WorldModule): Record<string, unknown> {
  const initial = record(module.initialState);
  return Object.keys(initial).length > 0 ? initial : moduleSource(module);
}

function assignNumber(
  target: Record<string, number>,
  key: string,
  raw: unknown,
  mode: GameplayPrepareMode,
  fallback: number,
): void {
  if (mode === 'load' && Number.isFinite(target[key])) return;
  const source = record(raw);
  const value = source.current ?? source.value ?? raw;
  target[key] = finite(value, fallback);
}

function initializeStats(state: GameState, module: WorldModule, mode: GameplayPrepareMode): void {
  const source = initialSource(module);
  const stats = state.玩家.生存状态 as Record<string, number>;
  assignNumber(stats, '血量', source.attrA, mode, 80);
  assignNumber(stats, '体力值', source.attrB, mode, 60);
  for (let index = 1; index <= 6; index++) {
    const id = `dim${index}`;
    const raw = source[id] ?? source[`${id}Value`];
    if (raw !== undefined) assignNumber(stats, id, raw, mode, 50);
  }

  const config = moduleSource(module);
  const configuredSpecial = Array.isArray(config.special) ? config.special : [];
  const initialSpecial = record(source.special);
  for (const item of configuredSpecial) {
    const definition = record(item);
    const id = typeof definition.id === 'string' ? definition.id : '';
    if (!id) continue;
    const value = initialSpecial[id] ?? definition.value;
    if (mode === 'new' || !Number.isFinite(stats[id])) stats[id] = finite(value, 0);
  }
  const gameplay = ensureGameplayRuntime(state as GameState & import('./types').GameplayStateRoot);
  for (const id of ['attrA', 'attrB', 'dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6', ...configuredSpecial.map(item => String(record(item).id ?? '')).filter(Boolean)]) {
    const target = id === 'attrA' ? (typeof stats.attrA === 'number' ? stats.attrA : stats.血量)
      : id === 'attrB' ? (typeof stats.attrB === 'number' ? stats.attrB : stats.体力值)
        : stats[id];
    if (Number.isFinite(target)) gameplay.stat!.base[id] = Number(target);
  }
  const modifierDefinitions = Array.isArray(config.modifiers) ? config.modifiers : [];
  if (mode === 'new') {
    gameplay.stat!.modifiers = Object.fromEntries(modifierDefinitions
      .filter(item => record(item).permanent !== false && record(item).durationTicks === undefined)
      .map(item => {
        const definition = record(item);
        const id = String(definition.id ?? '');
        return [id, {
          id,
          statId: String(definition.statId ?? ''),
          delta: finite(definition.delta, 0),
          mode: definition.mode === 'percent' ? 'percent' : 'flat',
          source: typeof definition.source === 'string' ? definition.source : 'world',
        }];
      }).filter(([id]) => Boolean(id)));
  }
}

function initializeProgression(state: GameState, module: WorldModule, mode: GameplayPrepareMode): void {
  const source = initialSource(module);
  if (mode === 'new' || !Number.isInteger(state.玩家.当前段位索引)) {
    state.玩家.当前段位索引 = Math.max(0, Math.trunc(finite(source.currentTierIndex, 0)));
  }
  if (mode === 'new' || !Number.isFinite(state.玩家.当前经验值)) {
    state.玩家.当前经验值 = Math.max(0, finite(source.currentXP, 0));
  }
  if (mode === 'new' || !Number.isFinite(state.玩家.可用属性点)) {
    state.玩家.可用属性点 = Math.max(0, finite(source.availableStatPoints, 0));
  }
}

function initializeAbilities(state: GameState, module: WorldModule, mode: GameplayPrepareMode): void {
  const config = moduleSource(module);
  const pointRules = record(config.pointRules);
  const hasTalents = Array.isArray(config.categories) && config.categories.length > 0;
  const hasSkills = Array.isArray(config.skills) && config.skills.length > 0;
  const existing = state.玩家.能力系统;
  if (mode === 'new' || !existing) {
    state.玩家.能力系统 = {
      天赋点: Math.max(0, finite(pointRules.initialTalentPoints, hasTalents ? 1 : 0)),
      技能点: Math.max(0, finite(pointRules.initialSkillPoints, hasSkills ? 1 : 0)),
      已解锁天赋: {},
      已掌握技能: {},
    };
  }
  const abilities = state.玩家.能力系统!;
  abilities.天赋点 = Math.max(0, finite(abilities.天赋点, 0));
  abilities.技能点 = Math.max(0, finite(abilities.技能点, 0));
  if (!abilities.已解锁天赋 || typeof abilities.已解锁天赋 !== 'object') abilities.已解锁天赋 = {};
  if (!abilities.已掌握技能 || typeof abilities.已掌握技能 !== 'object') abilities.已掌握技能 = {};
  if (!abilities.已觉醒 || typeof abilities.已觉醒 !== 'object') abilities.已觉醒 = {};
  if (!abilities.装备槽 || typeof abilities.装备槽 !== 'object') abilities.装备槽 = {};

  // Old saves store learned skill content by display name. Seed only the new
  // mechanical metadata; the original detail object remains the content source.
  for (const skillName of Object.keys(state.玩家.技能系统 ?? {})) {
    if (!abilities.已掌握技能[skillName]) {
      abilities.已掌握技能[skillName] = { 等级: 1, 使用次数: 0 };
    }
  }
}

function initializeProfession(state: GameState, module: WorldModule, mode: GameplayPrepareMode): void {
  const config = moduleSource(module);
  const professionConfig: ProfessionModuleSchema = resolveProfessionBinding(config);
  const existing = state.玩家.能力系统;
  if (!existing) {
    state.玩家.能力系统 = {
      天赋点: 0,
      技能点: 0,
      已解锁天赋: {},
      已掌握技能: {},
    };
  }
  const abilities = state.玩家.能力系统!;
  abilities.已解锁天赋 ??= {};
  abilities.已掌握技能 ??= {};
  abilities.已觉醒 ??= {};
  abilities.装备槽 ??= {};
  abilities.先天天赋 ??= {};
  abilities.后天天赋 ??= {};
  if (mode === 'new' || !abilities.职业状态) {
    abilities.职业状态 = {
      职业ID: null,
      职业名称: '无职业',
      职业等级: 1,
      能力点: Math.max(0, Math.trunc(finite(professionConfig.initialAbilityPoints, 0))),
      已解锁能力: {},
    };
  } else {
    abilities.职业状态.职业等级 = Math.max(1, Math.trunc(finite(abilities.职业状态.职业等级, 1)));
    abilities.职业状态.能力点 = Math.max(0, Math.trunc(finite(abilities.职业状态.能力点, 0)));
    abilities.职业状态.已解锁能力 ??= {};
  }

  if (mode !== 'load') return;
  if (!Array.isArray(professionConfig.professions) || professionConfig.professions.length === 0) return;

  const legacySkillKeys = new Set([
    ...Object.keys(state.玩家.技能系统 ?? {}),
    ...Object.keys(abilities.已掌握技能 ?? {}),
  ]);
  let selected = professionConfig.professions.find(item => item.id === abilities.职业状态?.职业ID);
  if (!selected) {
    const legacyCareer = String(state.玩家.身份信息?.职业 ?? '').trim().toLowerCase();
    selected = professionConfig.professions.find(item => (
      item.id.toLowerCase() === legacyCareer || item.name.toLowerCase() === legacyCareer
    ));
  }
  if (!selected && legacySkillKeys.size > 0) {
    const scored = professionConfig.professions.map(profession => ({
      profession,
      score: profession.abilities.filter(ability => (
        legacySkillKeys.has(ability.id) || legacySkillKeys.has(ability.name)
      )).length,
    })).sort((left, right) => right.score - left.score);
    if (scored[0]?.score > 0 && scored[0].score > (scored[1]?.score ?? 0)) selected = scored[0].profession;
  }
  if (!selected || !abilities.职业状态) {
    // 旧的机械技能若无法安全归属职业，转为自由技能，不能静默丢失。
    for (const skillKey of Object.keys(abilities.已掌握技能 ?? {})) {
      state.玩家.技能系统[skillKey] ??= { 品质: '普通', 描述: '由旧存档保留的自由技能。', 类型: '自由技能' };
      delete abilities.已掌握技能[skillKey];
    }
    return;
  }

  abilities.职业状态.职业ID = selected.id;
  abilities.职业状态.职业名称 = selected.name;
  const abilityByLegacyKey = new Map(selected.abilities.flatMap(ability => [
    [ability.id, ability] as const,
    [ability.name, ability] as const,
  ]));
  for (const skillKey of legacySkillKeys) {
    const ability = abilityByLegacyKey.get(skillKey);
    const legacyMastery = abilities.已掌握技能?.[skillKey];
    if (!ability) {
      if (legacyMastery) {
        state.玩家.技能系统[skillKey] ??= { 品质: '普通', 描述: '由旧存档保留的自由技能。', 类型: '自由技能' };
        delete abilities.已掌握技能[skillKey];
      }
      continue;
    }
    abilities.职业状态.已解锁能力[ability.id] ??= {
      名称: ability.name,
      类型: ability.type,
      等级: Math.max(1, Math.trunc(finite(legacyMastery?.等级, 1))),
      解锁轮次: 0,
      使用次数: Math.max(0, Math.trunc(finite(legacyMastery?.使用次数, 0))),
    };
    delete state.玩家.技能系统[skillKey];
    delete abilities.已掌握技能[skillKey];
  }
}

function initializeDice(state: GameState, mode: GameplayPrepareMode): void {
  if (mode === 'new' || !state.dice || typeof state.dice !== 'object') state.dice = { history: [] };
  if (!Array.isArray(state.dice.history)) state.dice.history = [];
  if (state.dice.history.length > 20) state.dice.history = state.dice.history.slice(-20);
}

function initializeSurvival(state: GameState, module: WorldModule, mode: GameplayPrepareMode): void {
  const config = moduleSource(module);
  const definitions = Array.isArray(config.resources) ? config.resources : [];
  const existing = state.玩家.生存资源 && typeof state.玩家.生存资源 === 'object'
    ? state.玩家.生存资源
    : {};
  const resources: NonNullable<GameState['玩家']['生存资源']> = mode === 'new' ? {} : existing;
  for (const raw of definitions) {
    const definition = record(raw);
    const id = typeof definition.id === 'string' ? definition.id : '';
    if (!id) continue;
    if (mode === 'load' && resources[id]) continue;
    resources[id] = {
      数量: Math.max(0, finite(definition.amount, 0)),
      最大值: Math.max(0, finite(definition.max, 0)),
      name: typeof definition.name === 'string' ? definition.name : id,
      symbol: typeof definition.symbol === 'string' ? definition.symbol : '',
      scarce: definition.scarce === true,
      description: typeof definition.description === 'string' ? definition.description : '',
      gatherRate: typeof definition.gatherRate === 'string' ? definition.gatherRate : undefined,
      usage: typeof definition.usage === 'string' ? definition.usage : undefined,
    };
  }
  state.玩家.生存资源 = resources;
  if (mode === 'new') state.玩家.生存配方 = [];
}

function normalizeAssetStatus(value: unknown): 'active' | 'idle' | 'damaged' | 'destroyed' {
  return value === 'idle' || value === 'damaged' || value === 'destroyed' ? value : 'active';
}

function initializeBusiness(state: GameState, module: WorldModule, mode: GameplayPrepareMode): void {
  if (mode === 'load' && state.玩家.经营资产 && typeof state.玩家.经营资产 === 'object') {
    if (!state.玩家.经营资产.库存) state.玩家.经营资产.库存 = {};
    if (!Array.isArray(state.玩家.经营资产.资产列表)) state.玩家.经营资产.资产列表 = [];
    if (!Array.isArray(state.玩家.经营资产.交易日志)) state.玩家.经营资产.交易日志 = [];
    return;
  }
  const config = moduleSource(module);
  const assets = Array.isArray(config.assets) ? config.assets : [];
  const transactionLog = Array.isArray(config.transactionLog) ? config.transactionLog : [];
  const inventory = record(config.inventory);
  state.玩家.经营资产 = {
    资金: Math.max(0, finite(config.funds, 0)),
    资产列表: assets.filter(raw => record(raw).initiallyOwned !== false).map((raw, index) => {
      const asset = record(raw);
      const income = record(asset.income);
      const staff = record(asset.staff);
      const risk = record(asset.risk);
      const marketTags = Array.isArray(asset.marketTags)
        ? asset.marketTags.filter((tag): tag is string => typeof tag === 'string')
        : [];
      return {
        id: typeof asset.id === 'string' && asset.id ? asset.id : `asset-${index + 1}`,
        名称: typeof asset.name === 'string' ? asset.name : '未命名资产',
        类型: typeof asset.type === 'string' ? asset.type : '',
        等级: Math.max(1, Math.trunc(finite(asset.level, 1))),
        最高等级: Math.max(1, Math.trunc(finite(asset.maxLevel, 3))),
        描述: typeof asset.description === 'string' ? asset.description : '',
        状态: normalizeAssetStatus(asset.status),
        基础收益: finite(income.base, 0),
        每级收益: finite(income.perLevel, 0),
        维护费: Math.max(0, finite(asset.maintenance, 0)),
        ...(Object.keys(staff).length > 0 ? {
          员工人数: Math.max(0, Math.trunc(finite(staff.current, 0))),
          员工效率: Math.max(0, finite(staff.efficiency, 1)),
        } : {}),
        ...(marketTags.length > 0 ? { 市场标签: marketTags } : {}),
        ...(risk.level === 'low' || risk.level === 'medium' || risk.level === 'high'
          ? { 风险等级: risk.level }
          : {}),
        ...(asset.upgradeCost !== undefined ? { 升级费用: Math.max(0, finite(asset.upgradeCost, 0)) } : {}),
      };
    }),
    交易日志: transactionLog.map(raw => {
      const entry = record(raw);
      const type = entry.type;
      return {
        类型: type === 'expense' || type === 'upgrade' || type === 'event'
          ? type
          : type === 'acquire' ? 'purchase'
            : 'income',
        描述: typeof entry.description === 'string' ? entry.description : '',
        金额: finite(entry.amount, 0),
      };
    }),
    库存: Object.fromEntries(Object.entries(inventory).map(([key, value]) => [key, Math.max(0, finite(value, 0))])),
  };
}

/** Normalize combat sessions from early saves without changing their progress. */
function migrateCombatRuntime(state: GameState): void {
  const combat = state.combat as unknown as Record<string, unknown> | undefined;
  if (!combat || typeof combat !== 'object') return;
  const sessions = [combat.active, ...(Array.isArray(combat.history) ? combat.history : [])];
  for (const raw of sessions) {
    const session = record(raw);
    const participants = Array.isArray(session.participants) ? session.participants.map(item => record(item)) : [];
    if (participants.length === 0) continue;
    session.participants = participants;
    if (!Array.isArray(session.turnOrder) || session.turnOrder.length === 0) {
      session.turnOrder = participants
        .slice()
        .sort((left, right) => finite(right.initiative, 0) - finite(left.initiative, 0) || (left.side === 'player' ? -1 : 1))
        .map(item => String(item.id ?? ''))
        .filter(Boolean);
    }
    if (typeof session.activeActorId !== 'string' || !session.activeActorId) session.activeActorId = 'player';
    for (const participant of participants) {
      if (!Array.isArray(participant.statuses)) participant.statuses = [];
      if (!participant.cooldowns || typeof participant.cooldowns !== 'object') participant.cooldowns = {};
    }
  }
}

/**
 * Upgrade one GameState to the unified gameplay runtime and initialize the six
 * built-in modules without overwriting existing progress during load.
 */
export function prepareGameplayState(
  stateIn: GameState,
  modules: readonly WorldModule[] = [],
  options: PrepareGameplayOptions = { mode: 'load' },
): PrepareGameplayResult {
  const state = clone(stateIn);
  if (options.mode === 'new') state.gameplay = createDefaultGameplayRuntime();
  const runtime = ensureGameplayRuntime(state);
  const appliedMigrations: string[] = [];

  if (!runtime.appliedMigrations.includes(RUNTIME_V1_MIGRATION)) {
    runtime.appliedMigrations.push(RUNTIME_V1_MIGRATION);
    appliedMigrations.push(RUNTIME_V1_MIGRATION);
  }
  runtime.schemaVersion = GAMEPLAY_SCHEMA_VERSION;

  for (const module of modules) {
    if (!module.enabled) continue;
    switch (module.moduleId) {
      case 'stat': initializeStats(state, module, options.mode); break;
      case 'progression': initializeProgression(state, module, options.mode); break;
      case 'talent': initializeAbilities(state, module, options.mode); break;
      case 'profession': initializeProfession(state, module, options.mode); break;
      case 'dice': initializeDice(state, options.mode); break;
      case 'survival': initializeSurvival(state, module, options.mode); break;
      case 'business': initializeBusiness(state, module, options.mode); break;
    }
  }

  if (!runtime.appliedMigrations.includes(COMBAT_RUNTIME_V1_MIGRATION)) {
    migrateCombatRuntime(state);
    runtime.appliedMigrations.push(COMBAT_RUNTIME_V1_MIGRATION);
    appliedMigrations.push(COMBAT_RUNTIME_V1_MIGRATION);
  }

  return { state, appliedMigrations };
}
