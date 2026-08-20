import type { GameState } from '../../schema/variables';
import type {
  GameplayBusinessRuntime,
  GameplayStatRuntime,
  GameplaySurvivalRuntime,
} from '../types';
import type { ModuleRuntimeId, ModuleStateRecord } from './types';

export interface StatPartitionState {
  playerState: GameState['玩家']['生存状态'];
  runtime?: GameplayStatRuntime;
}

export interface ProgressionPartitionState {
  currentTierIndex?: number;
  currentXP?: number;
  availableStatPoints?: number;
}

export interface SurvivalPartitionState {
  resources?: GameState['玩家']['生存资源'];
  recipes?: GameState['玩家']['生存配方'];
  runtime?: GameplaySurvivalRuntime;
}

export interface BusinessPartitionState {
  assets?: GameState['玩家']['经营资产'];
  runtime?: GameplayBusinessRuntime;
}

export interface DicePartitionState {
  dice?: GameState['dice'];
}

export interface ProfessionPartitionState {
  abilities?: GameState['玩家']['能力系统'];
  freeSkills: GameState['玩家']['技能系统'];
}

export type ModulePartitionState =
  | StatPartitionState
  | ProgressionPartitionState
  | SurvivalPartitionState
  | BusinessPartitionState
  | DicePartitionState
  | ProfessionPartitionState;

export interface ExtractedModulePartitions {
  coreState: GameState;
  records: ModuleStateRecord<ModulePartitionState>[];
}

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeRecord<T extends ModulePartitionState>(
  saveId: string,
  moduleId: ModuleRuntimeId,
  state: T,
): ModuleStateRecord<T> {
  return {
    saveId,
    moduleId,
    revision: 0,
    schemaVersion: 1,
    updatedAt: Date.now(),
    state,
  };
}

export function moduleIdForGameplayPath(path: string): ModuleRuntimeId | undefined {
  if (path === '玩家.生存状态' || path.startsWith('玩家.生存状态.') || path === 'gameplay.stat' || path.startsWith('gameplay.stat.')) return 'stat';
  if (path === '玩家.当前段位索引' || path === '玩家.当前经验值' || path === '玩家.可用属性点') return 'progression';
  if (path === '玩家.生存资源' || path.startsWith('玩家.生存资源.') || path === '玩家.生存配方' || path.startsWith('玩家.生存配方.') || path === 'gameplay.survival' || path.startsWith('gameplay.survival.')) return 'survival';
  if (path === '玩家.经营资产' || path.startsWith('玩家.经营资产.') || path === 'gameplay.business' || path.startsWith('gameplay.business.')) return 'business';
  if (path === 'dice' || path.startsWith('dice.')) return 'dice';
  if (path === '玩家.能力系统' || path.startsWith('玩家.能力系统.') || path === '玩家.技能系统' || path.startsWith('玩家.技能系统.')) return 'profession';
  return undefined;
}

/** Split the persisted narrative document from independently saved module states. */
export function extractModulePartitions(state: GameState, saveId: string): ExtractedModulePartitions {
  const coreState = clone(state);
  const source = state as any;
  const core = coreState as any;
  const records: ModuleStateRecord<ModulePartitionState>[] = [];
  const revisions: Partial<Record<ModuleRuntimeId, number>> = {};

  records.push(makeRecord(saveId, 'stat', {
    playerState: clone(source.玩家.生存状态),
    ...(source.gameplay?.stat ? { runtime: clone(source.gameplay.stat) } : {}),
  }));
  delete core.玩家.生存状态;
  if (core.gameplay) delete core.gameplay.stat;
  revisions.stat = 0;

  const progression: ProgressionPartitionState = {
    ...(source.玩家.当前段位索引 === undefined ? {} : { currentTierIndex: source.玩家.当前段位索引 }),
    ...(source.玩家.当前经验值 === undefined ? {} : { currentXP: source.玩家.当前经验值 }),
    ...(source.玩家.可用属性点 === undefined ? {} : { availableStatPoints: source.玩家.可用属性点 }),
  };
  if (Object.keys(progression).length > 0) {
    records.push(makeRecord(saveId, 'progression', progression));
    delete core.玩家.当前段位索引;
    delete core.玩家.当前经验值;
    delete core.玩家.可用属性点;
    revisions.progression = 0;
  }

  if (source.玩家.生存资源 !== undefined || source.玩家.生存配方 !== undefined || source.gameplay?.survival !== undefined) {
    records.push(makeRecord(saveId, 'survival', {
      ...(source.玩家.生存资源 === undefined ? {} : { resources: clone(source.玩家.生存资源) }),
      ...(source.玩家.生存配方 === undefined ? {} : { recipes: clone(source.玩家.生存配方) }),
      ...(source.gameplay?.survival === undefined ? {} : { runtime: clone(source.gameplay.survival) }),
    }));
    delete core.玩家.生存资源;
    delete core.玩家.生存配方;
    if (core.gameplay) delete core.gameplay.survival;
    revisions.survival = 0;
  }

  if (source.玩家.经营资产 !== undefined || source.gameplay?.business !== undefined) {
    records.push(makeRecord(saveId, 'business', {
      ...(source.玩家.经营资产 === undefined ? {} : { assets: clone(source.玩家.经营资产) }),
      ...(source.gameplay?.business === undefined ? {} : { runtime: clone(source.gameplay.business) }),
    }));
    delete core.玩家.经营资产;
    if (core.gameplay) delete core.gameplay.business;
    revisions.business = 0;
  }

  if (source.dice !== undefined) {
    records.push(makeRecord(saveId, 'dice', { dice: clone(source.dice) }));
    delete core.dice;
    revisions.dice = 0;
  }

  const hasAbilities = source.玩家.能力系统 !== undefined;
  const hasFreeSkills = Object.keys(source.玩家.技能系统 ?? {}).length > 0;
  if (hasAbilities || hasFreeSkills) {
    records.push(makeRecord(saveId, 'profession', {
      ...(hasAbilities ? { abilities: clone(source.玩家.能力系统) } : {}),
      freeSkills: clone(source.玩家.技能系统 ?? {}),
    }));
    delete core.玩家.能力系统;
    delete core.玩家.技能系统;
    revisions.profession = 0;
  }

  core.moduleRevisions = revisions;
  return { coreState, records };
}

/** Materialize the legacy GameState view for existing gameplay and UI callers. */
export function materializeModulePartitions(
  coreState: GameState,
  records: readonly ModuleStateRecord[],
): GameState {
  const state = clone(coreState) as any;
  state.玩家 ??= {};

  for (const record of records) {
    const partition = clone(record.state) as any;
    switch (record.moduleId) {
      case 'stat':
        state.玩家.生存状态 = partition.playerState;
        if (partition.runtime) (state.gameplay ??= {}).stat = partition.runtime;
        break;
      case 'progression':
        if (partition.currentTierIndex !== undefined) state.玩家.当前段位索引 = partition.currentTierIndex;
        if (partition.currentXP !== undefined) state.玩家.当前经验值 = partition.currentXP;
        if (partition.availableStatPoints !== undefined) state.玩家.可用属性点 = partition.availableStatPoints;
        break;
      case 'survival':
        if (partition.resources !== undefined) state.玩家.生存资源 = partition.resources;
        if (partition.recipes !== undefined) state.玩家.生存配方 = partition.recipes;
        if (partition.runtime) (state.gameplay ??= {}).survival = partition.runtime;
        break;
      case 'business':
        if (partition.assets !== undefined) state.玩家.经营资产 = partition.assets;
        if (partition.runtime) (state.gameplay ??= {}).business = partition.runtime;
        break;
      case 'dice':
        if (partition.dice !== undefined) state.dice = partition.dice;
        break;
      case 'profession':
        if (partition.abilities !== undefined) state.玩家.能力系统 = partition.abilities;
        state.玩家.技能系统 = partition.freeSkills ?? {};
        break;
    }
  }

  return state as GameState;
}
