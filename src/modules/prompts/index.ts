// 模块 Prompt 模板 — 统一导出
export { buildStatThemePrompt, buildStatGenPrompt, STAT_UPDATE_RULES } from './stat';
export { buildProgressionGenPrompt, PROGRESSION_UPDATE_RULES } from './progression';
export { buildSurvivalGenPrompt, SURVIVAL_UPDATE_RULES, buildRecipeGenPrompt } from './survival';
export { buildBusinessGenPrompt, BUSINESS_UPDATE_RULES, buildBusinessExtractionPrompt } from './business';
export { DICE_RULES_PROMPT, DICE_UPDATE_RULES } from './dice';
export { buildTalentGenPrompt, TALENT_RULES_PROMPT, TALENT_UPDATE_RULES } from './talent';
export { buildSimulationRulesPrompt, validateSimulationRules } from './simulation';
