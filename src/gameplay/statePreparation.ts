import type { WorldModule } from '../data/worlds-schema';
import type { ProfessionModuleSchema } from '../modules/schema';
import { resolveProfessionBinding } from '../data/professions';
import type { GameState } from '../schema/variables';
import { createDefaultGameplayRuntime, ensureGameplayRuntime, GAMEPLAY_SCHEMA_VERSION } from '../core/state';

export type GameplayPrepareMode = 'new' | 'load';

export interface PrepareGameplayOptions {
  mode: GameplayPrepareMode;
}

export interface PrepareGameplayResult {
  state: GameState;
}

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
  return record(module.moduleConfig);
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


}

function initializeDice(state: GameState, mode: GameplayPrepareMode): void {
  if (mode === 'new' || !state.dice || typeof state.dice !== 'object') state.dice = { history: [] };
  if (!Array.isArray(state.dice.history)) state.dice.history = [];
  if (state.dice.history.length > 20) state.dice.history = state.dice.history.slice(-20);
}

export function prepareGameplayState(
  stateIn: GameState,
  modules: readonly WorldModule[] = [],
  options: PrepareGameplayOptions = { mode: 'load' },
): PrepareGameplayResult {
  const state = clone(stateIn);
  if (options.mode === 'new') state.gameplay = createDefaultGameplayRuntime();
  const runtime = ensureGameplayRuntime(state);
  runtime.schemaVersion = GAMEPLAY_SCHEMA_VERSION;

  for (const module of modules) {
    if (!module.enabled) continue;
    switch (module.moduleId) {
      case 'stat': initializeStats(state, module, options.mode); break;
      case 'progression': initializeProgression(state, module, options.mode); break;
      case 'talent': initializeAbilities(state, module, options.mode); break;
      case 'profession': initializeProfession(state, module, options.mode); break;
      case 'dice': initializeDice(state, options.mode); break;
      // survival：由资源模块（domains/resources）在 GameplayHost.prepare 中初始化与迁移。
      // business：由经营模块（domains/economy）在 GameplayHost.prepare 中初始化与迁移。
    }
  }

  return { state };
}
