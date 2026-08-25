// ============================================================
//  世界模块化系统 v2 — 默认值
//  框架层零指向性，所有命名由AI生成时注入
// ============================================================

import type {
  StatModuleSchema,
  ProgressionModuleSchema,
  SurvivalModuleSchema,
  BusinessModuleSchema,
  DiceModuleSchema,
  TalentModuleSchema,
  ProfessionModuleSchema,
  ProfessionWorldBinding,
  CombatModuleSchema,
  CombatRulesetBinding,
  WorldSystemData,
  WorldDynamics,
} from './schema';
import { resolveProfessionBinding } from '../data/professions';
import { createDefaultCombatBinding as createCombatBinding, resolveCombatRuleset } from '../gameplay/combatRulesets';

/** 数值属性模块默认值 */
export const STAT_DEFAULTS = {
  attrACurrent: 80,
  attrAMax: 100,
  attrBCurrent: 60,
  attrBMax: 100,
  dimRange: [0, 100] as [number, number],
  dimInitial: 50,
  specialRange: [0, 100] as [number, number],
};

/** 成长体系模块默认值 */
export const PROGRESSION_DEFAULTS = {
  mode: 'tiered' as const,
  baseXP: 100,
  exponent: 1.5,
  scaleFactor: 1.0,
  initialTierIndex: 0,
  initialXP: 0,
};

/** 生存资源模块默认值 */
export const SURVIVAL_DEFAULTS = {
  initialAmount: 5,
  maxAmount: 10,
  criticalThreshold: 2,
};

/** 经营资产模块默认值 */
export const BUSINESS_DEFAULTS = {
  initialFunds: 500,
  maxAssets: 10,
  defaultCycleName: '天',
};

/** 骰子检定模块默认值 */
export const DICE_DEFAULTS = {
  maxHistory: 10,
  defaultDC: 10,
};

/** 创建默认的数值属性模块数据 */
export function createDefaultStatModule(): StatModuleSchema {
  return {
    attrA: { name: '生命', current: STAT_DEFAULTS.attrACurrent, max: STAT_DEFAULTS.attrAMax },
    attrB: { name: '能量', current: STAT_DEFAULTS.attrBCurrent, max: STAT_DEFAULTS.attrBMax },
    dim1: { name: '攻击', value: STAT_DEFAULTS.dimInitial, range: [...STAT_DEFAULTS.dimRange], semanticRole: 'power', description: '力量、外攻与直接破坏能力。' },
    dim2: { name: '防御', value: STAT_DEFAULTS.dimInitial, range: [...STAT_DEFAULTS.dimRange], semanticRole: 'guard', description: '体魄、耐力与承受伤害能力。' },
    dim3: { name: '速度', value: STAT_DEFAULTS.dimInitial, range: [...STAT_DEFAULTS.dimRange], semanticRole: 'agility', description: '灵巧、反应与行动速度。' },
    dim4: { name: '智力', value: STAT_DEFAULTS.dimInitial, range: [...STAT_DEFAULTS.dimRange], semanticRole: 'intellect', description: '智识、学习、技术与施法能力。' },
    dim5: { name: '魅力', value: STAT_DEFAULTS.dimInitial, range: [...STAT_DEFAULTS.dimRange], semanticRole: 'social', description: '意志、交涉、领导与影响能力。' },
    dim6: { name: '幸运', value: STAT_DEFAULTS.dimInitial, range: [...STAT_DEFAULTS.dimRange], semanticRole: 'perception', description: '感知、直觉、机运与发现能力。' },
    special: [],
  };
}

/** 创建默认的成长体系模块数据（段位制） */
export function createDefaultProgressionModule(): ProgressionModuleSchema {
  return {
    mode: PROGRESSION_DEFAULTS.mode,
    tiers: [],
    xpFormula: {
      baseXP: PROGRESSION_DEFAULTS.baseXP,
      exponent: PROGRESSION_DEFAULTS.exponent,
      scaleFactor: PROGRESSION_DEFAULTS.scaleFactor,
    },
    currentTierIndex: PROGRESSION_DEFAULTS.initialTierIndex,
    currentXP: PROGRESSION_DEFAULTS.initialXP,
  };
}

/** 创建默认的生存资源模块数据 */
export function createDefaultSurvivalModule(): SurvivalModuleSchema {
  return {
    description: '',
    resources: [],
    rules: {
      cycleName: '一天',
      consumePerCycle: '',
      criticalThreshold: SURVIVAL_DEFAULTS.criticalThreshold,
    },
  };
}

/** 创建默认的经营资产模块数据 */
export function createDefaultBusinessModule(): BusinessModuleSchema {
  return {
    description: '',
    funds: BUSINESS_DEFAULTS.initialFunds,
    cycleName: BUSINESS_DEFAULTS.defaultCycleName,
    assets: [],
    market: { items: [] },
    transactionLog: [],
    economy: { marketWeight: 0.35, autoIdleOnDeficit: true, logLimit: 50 },
  };
}

/** 创建默认的骰子检定模块数据 */
export function createDefaultDiceModule(): DiceModuleSchema {
  return {
    history: [],
    sides: 20,
    defaultDC: DICE_DEFAULTS.defaultDC,
    historyLimit: 10,
    modifierBase: 10,
    modifierStep: 2,
    criticalSuccess: 20,
    criticalFailure: 1,
  };
}

/** 创建默认的天赋体系模块数据 */
export function createDefaultTalentModule(): TalentModuleSchema {
  return {
    categories: [],
    skills: [],
    pointRules: {
      initialTalentPoints: 1,
      initialSkillPoints: 1,
      talentPointsPerTier: 1,
      skillPointsPerTier: 1,
    },
  };
}

export function createDefaultProfessionModule(): ProfessionModuleSchema {
  return resolveProfessionBinding(createDefaultProfessionBinding());
}

/** 新世界只保存职业包引用，不再复制五棵树。 */
export function createDefaultProfessionBinding(): ProfessionWorldBinding {
  return { packIds: ['fantasy-core'] };
}

/** 创建默认的独立战斗规则域；不配置遭遇时运行时完全不启用。 */
export function createDefaultCombatModule(): CombatModuleSchema {
  return resolveCombatRuleset(createDefaultCombatBinding());
}

export function createDefaultCombatBinding(): CombatRulesetBinding {
  return createCombatBinding();
}

/** 创建默认的世界动态配置（通用兜底规则，不含周期事件） */
export function createDefaultWorldDynamics(): WorldDynamics {
  return {
    worldStateRules: [],
    narrativeGuardrails: {
      maxDeltaPerStat: {
        hp: 30,
        mp: 30,
      },
      maxDeltaPerResource: {},
      setAllowedVars: [],
      allowCreateResources: true, // 允许 AI 动态创建新资源（如发现铁矿）
      newResourceDefaultMax: 100,
    },
  };
}

/** 创建默认的世界系统数据 */
export function createDefaultWorldSystem(): WorldSystemData {
  return {};
}

/**
 * 创建兜底模块（模块生成失败时使用，确保 UI 卡片能正常显示）
 * 返回完整的 WorldModule，包含 moduleConfig/data/initialState
 */
export function createFallbackModule(moduleId: string, name: string): import('../data/worlds-schema').WorldModule {
  const base: import('../data/worlds-schema').WorldModule = { moduleId, name, description: '', enabled: true };
  switch (moduleId) {
    case 'stat': {
      const ds = createDefaultStatModule();
      return {
        ...base,
        moduleConfig: {
          attrA: { name: ds.attrA.name, max: ds.attrA.max },
          attrB: { name: ds.attrB.name, max: ds.attrB.max },
          dim1: ds.dim1 ? { name: ds.dim1.name, range: ds.dim1.range } : undefined,
          dim2: ds.dim2 ? { name: ds.dim2.name, range: ds.dim2.range } : undefined,
          dim3: ds.dim3 ? { name: ds.dim3.name, range: ds.dim3.range } : undefined,
          dim4: ds.dim4 ? { name: ds.dim4.name, range: ds.dim4.range } : undefined,
          dim5: ds.dim5 ? { name: ds.dim5.name, range: ds.dim5.range } : undefined,
          dim6: ds.dim6 ? { name: ds.dim6.name, range: ds.dim6.range } : undefined,
          special: [],
        },
        initialState: {
          attrA: ds.attrA.current,
          attrB: ds.attrB.current,
          dim1: ds.dim1?.value, dim2: ds.dim2?.value, dim3: ds.dim3?.value,
          dim4: ds.dim4?.value, dim5: ds.dim5?.value, dim6: ds.dim6?.value,
          special: {},
        },
      };
    }
    case 'progression': {
      const dp = createDefaultProgressionModule();
      return {
        ...base,
        moduleConfig: { mode: dp.mode, xpFormula: dp.xpFormula, tiers: dp.tiers },
        initialState: { currentTierIndex: dp.currentTierIndex, currentXP: dp.currentXP },
      };
    }
    case 'survival':
      return { ...base, moduleConfig: createDefaultSurvivalModule() };
    case 'business':
      return { ...base, moduleConfig: createDefaultBusinessModule() };
    case 'dice':
      return { ...base, moduleConfig: createDefaultDiceModule() as unknown as Record<string, unknown> };
    case 'talent':
      return { ...base, moduleConfig: createDefaultTalentModule() as unknown as Record<string, unknown> };
    case 'profession':
      return { ...base, moduleConfig: createDefaultProfessionBinding() as unknown as Record<string, unknown> };
    case 'combat':
      return { ...base, moduleConfig: createDefaultCombatBinding() as unknown as Record<string, unknown> };
    case 'simulation':
      return { ...base, moduleConfig: createDefaultWorldDynamics() as unknown as Record<string, unknown> };
    default:
      return base;
  }
}
