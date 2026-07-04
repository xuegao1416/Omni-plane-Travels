// ============================================================
//  世界模块化系统 v2 — 统一导出
// ============================================================

// Schema 类型
export type {
  SixDimStat,
  SpecialStat,
  StatModuleSchema,
  TierDef,
  XpFormula,
  ProgressionModuleSchema,
  SurvivalResource,
  SurvivalRecipe,
  SurvivalModuleSchema,
  BusinessModuleSchema,
  DiceRoll,
  DiceModuleSchema,
  WorldSystemData,
} from './schema';

// 默认值
export {
  STAT_DEFAULTS,
  PROGRESSION_DEFAULTS,
  SURVIVAL_DEFAULTS,
  BUSINESS_DEFAULTS,
  DICE_DEFAULTS,
  createDefaultStatModule,
  createDefaultProgressionModule,
  createDefaultSurvivalModule,
  createDefaultBusinessModule,
  createDefaultDiceModule,
  createDefaultWorldSystem,
} from './defaults';

// XP 算法
export {
  calculateXpForLevel,
  calculateCumulativeXp,
  populateTierXp,
  getXpForNextTier,
  getTierProgress,
  calcModifier,
  rollDice,
  getCheckableAttributes,
} from './xpAlgorithm';

// Prompt 模板
export {
  buildStatThemePrompt,
  buildStatGenPrompt,
  STAT_UPDATE_RULES,
  buildProgressionGenPrompt,
  PROGRESSION_UPDATE_RULES,
  buildSurvivalGenPrompt,
  SURVIVAL_UPDATE_RULES,
  buildRecipeGenPrompt,
  buildBusinessGenPrompt,
  BUSINESS_UPDATE_RULES,
  DICE_RULES_PROMPT,
  DICE_UPDATE_RULES,
} from './prompts';

// 管线
export type { BuildContext } from './buildContext';
export { createBuildContext } from './buildContext';
export type { PipelineConfig } from './buildPipeline';
export { executeBuildPipeline } from './buildPipeline';

// 运行时
export { extractWorldSystemData, getProgressionDisplay, getStatColor } from './runtime';
