// ============================================================
//  世界模块化系统 v2 — 管线 Context
//  管线执行过程中传递的上下文数据
// ============================================================

import type { StatModuleSchema, ProgressionModuleSchema, SurvivalModuleSchema, BusinessModuleSchema, TalentModuleSchema } from './schema';
import type { WorldBookEntryDef } from '../data/worlds-schema';

/** 数值属性配置（静态，存入世界定义/世界书） */
export interface StatConfig {
  attrA: { name: string; max: number };
  attrB: { name: string; max: number };
  dim1: { name: string; range: [number, number] };
  dim2: { name: string; range: [number, number] };
  dim3: { name: string; range: [number, number] };
  dim4: { name: string; range: [number, number] };
  dim5: { name: string; range: [number, number] };
  dim6: { name: string; range: [number, number] };
  special: Array<{ id: string; name: string; range: [number, number]; description: string }>;
}

/** 数值属性状态（动态，存入变量系统） */
export interface StatState {
  attrA: number;
  attrB: number;
  dim1: number;
  dim2: number;
  dim3: number;
  dim4: number;
  dim5: number;
  dim6: number;
  special: Record<string, number>;
}

/** 等级制属性天花板 */
interface StatBonuses {
  attrAMax: number;
  attrBMax: number;
  dim1Max: number;
  dim2Max: number;
  dim3Max: number;
  dim4Max: number;
  dim5Max: number;
  dim6Max: number;
}

/** 成长体系配置（静态，存入世界定义/世界书） */
export interface ProgressionConfig {
  mode: 'tiered' | 'level';
  tiers?: Array<{ name: string; description: string }>;
  levelData?: {
    maxLevel: number;
    baseStats: StatBonuses;
    growthPerLevel: StatBonuses;
  };
  xpFormula: { baseXP: number; exponent: number; scaleFactor: number };
}

/** 资源演化蓝图条目（静态配置） */
export interface ResourceEvolutionConfig {
  id: string;
  trigger: { keywords: string[] };
  add?: Array<{
    id: string; name: string; symbol: string;
    amount: number; max: number; scarce: boolean;
    gatherRate?: string; usage?: string; description?: string;
  }>;
  remove?: string[];
  narrateHint?: string;
}

/** 生存资源配置（静态，存入世界定义/世界书） */
export interface SurvivalConfig {
  description: string;
  resources: Array<{
    id: string; name: string; symbol: string;
    amount: number; max: number; scarce: boolean;
    gatherRate?: string; usage?: string;
    description: string;
  }>;
  rules: {
    cycleName: string;
    consumePerCycle: string;
    criticalThreshold: number;
  };
  /** 资源演化蓝图 */
  resourceEvolution?: ResourceEvolutionConfig[];
}

/** 经营资产配置（静态，存入世界定义/世界书） */
export interface BusinessConfig {
  description: string;
  funds: number;
  cycleName: string;
  assets: Array<{
    id: string; name: string; type: string;
    level: number; maxLevel: number; description: string;
    income: { base: number; perLevel: number; resource?: string; cycle: string };
    maintenance: number;
    upgradeCost?: number;
    staff?: { current: number; max: number; efficiency: number };
    risk?: { level: string; description: string };
    status: string;
  }>;
  market?: { items: Array<{ name: string; basePrice: number; trend: string; changePercent: number }> };
}

/** 世界创建管线的上下文数据 */
export interface BuildContext {
  /** 世界描述（用户输入） */
  description: string;
  /** 用户选中的模块ID列表 */
  selectedModules: string[];
  /** 阶段1提取的主题信息 */
  theme?: {
    theme: string;
    tone: string;
    era: string;
    attrAName: string;
    attrBName: string;
    dim1Name: string;
    dim2Name: string;
    dim3Name: string;
    dim4Name: string;
    dim5Name: string;
    dim6Name: string;
  };
  /** 阶段2生成的属性数据（原始格式，用于合成） */
  statData?: StatModuleSchema;
  /** 阶段2生成的成长数据（原始格式，用于合成） */
  progressionData?: ProgressionModuleSchema;
  /** 阶段2生成的生存资源数据（原始格式，用于合成）（占位） */
  survivalData?: SurvivalModuleSchema;
  /** 阶段2生成的经营资产数据（原始格式，用于合成）（占位） */
  businessData?: BusinessModuleSchema;
  /** 阶段3生成的天赋数据 */
  talentData?: TalentModuleSchema;
  /** 阶段4生成的世界书条目 */
  worldBookEntries?: WorldBookEntryDef[];

  // ── 分离的配置和状态 ──
  /** 数值属性配置 */
  statConfig?: StatConfig;
  /** 数值属性初始状态 */
  statState?: StatState;
  /** 成长体系配置 */
  progressionConfig?: ProgressionConfig;
  /** 生存资源配置（占位） */
  survivalConfig?: SurvivalConfig;
  /** 经营资产配置（占位） */
  businessConfig?: BusinessConfig;

  /** 用户对生存资源的额外描述（可选） */
  survivalUserDesc?: string;
  /** 用户对经营资产的额外描述（可选） */
  businessUserDesc?: string;
  /** 阶段5合成的最终结果 */
  result?: Record<string, unknown>;
}

/** 创建空的BuildContext */
export function createBuildContext(description: string, selectedModules: string[]): BuildContext {
  return { description, selectedModules };
}
