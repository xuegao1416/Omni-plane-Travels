// 模块 Prompt 模板 — 统一导出
export { buildStatThemePrompt, buildStatGenPrompt, STAT_UPDATE_RULES } from './stat';
export { buildProgressionGenPrompt, PROGRESSION_UPDATE_RULES } from './progression';
export { buildSurvivalGenPrompt, SURVIVAL_UPDATE_RULES, buildRecipeGenPrompt } from './survival';
export { buildBusinessGenPrompt, BUSINESS_UPDATE_RULES, buildBusinessExtractionPrompt } from './business';
export { DICE_RULES_PROMPT, DICE_UPDATE_RULES } from './dice';
export { buildTalentGenPrompt, TALENT_RULES_PROMPT, TALENT_UPDATE_RULES } from './talent';
export { COMBAT_RULES_PROMPT, COMBAT_TEXT_FALLBACK_PROMPT, normalizeCombatConfig } from './combat';

/** Shared contract for clients that do not expose the graphical module panels. */
export const GAMEPLAY_TEXT_FALLBACK_PROMPT = `【玩法模块文本降级契约】
当图形化面板不可用时，仍按同一份本地玩法状态和结算日志进行文本交互：数值只描述当前值与上限，成长只描述当前等级/段位与经验，天赋与技能只允许使用已解锁能力并遵守点数、前置、冷却和消耗，骰子只引用已结算的骰面与结果，资源只引用已结算的库存、采集和制作结果，经营只引用已结算的资金、资产、投入产出与周期结算。AI 只能叙述这些事实，不得自行修改数值、跳过条件、伪造奖励或替代本地结算。`;
