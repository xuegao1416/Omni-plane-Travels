// ============================================================
//  世界模块化系统 v2 — XP 算法
//  段位制和等级制统一入口，内部按 mode 分支
// ============================================================

import type { XpFormula, TierDef, StatBonuses, LevelData, ProgressionModuleSchema } from './schema';

// ─── 公共计算 ───

/** 计算升到第N级需要的单级XP（增量） */
export function calculateXpForLevel(level: number, formula: XpFormula): number {
  if (level <= 0) return 0;
  return Math.floor(formula.baseXP * Math.pow(level, formula.exponent) * formula.scaleFactor);
}

/** 计算升到第N级累计需要的XP */
export function calculateCumulativeXp(level: number, formula: XpFormula): number {
  let total = 0;
  for (let i = 1; i <= level; i++) {
    total += calculateXpForLevel(i, formula);
  }
  return total;
}

// ─── 段位制专用 ───

/** 填充tiers数组的xpRequired字段 */
export function populateTierXp(tiers: TierDef[], formula: XpFormula): TierDef[] {
  return tiers.map((tier, index) => ({
    ...tier,
    xpRequired: calculateCumulativeXp(index, formula),
  }));
}

// ─── 等级制专用 ───

/** 计算指定等级的属性天花板 */
export function getLevelStatBonuses(level: number, levelData: LevelData): StatBonuses {
  const bs = levelData.baseStats;
  const gl = levelData.growthPerLevel;
  return {
    attrAMax: (bs?.attrAMax ?? 100) + level * (gl?.attrAMax ?? 10),
    attrBMax: (bs?.attrBMax ?? 100) + level * (gl?.attrBMax ?? 10),
    dim1Max: (bs?.dim1Max ?? 100) + level * (gl?.dim1Max ?? 8),
    dim2Max: (bs?.dim2Max ?? 100) + level * (gl?.dim2Max ?? 8),
    dim3Max: (bs?.dim3Max ?? 100) + level * (gl?.dim3Max ?? 8),
    dim4Max: (bs?.dim4Max ?? 100) + level * (gl?.dim4Max ?? 8),
    dim5Max: (bs?.dim5Max ?? 100) + level * (gl?.dim5Max ?? 8),
    dim6Max: (bs?.dim6Max ?? 100) + level * (gl?.dim6Max ?? 8),
  };
}

// ─── 统一入口（按 mode 分支） ───

/** 获取成长体系的上限（段位数或等级上限） */
function getMaxIndex(progression: ProgressionModuleSchema): number {
  if (progression.mode === 'level' && progression.levelData) {
    return progression.levelData.maxLevel;
  }
  return progression.tiers?.length ?? 0;
}

/** 获取升到下一级需要的XP（增量） */
export function getXpForNextTier(progression: ProgressionModuleSchema): number {
  const currentTierIndex = progression.currentTierIndex ?? 0;
  const nextIndex = currentTierIndex + 1;
  const maxIndex = getMaxIndex(progression);
  if (nextIndex >= maxIndex) return Infinity; // 已满级
  if (!progression.xpFormula) return 0; // 防御：xpFormula 缺失
  // 防御：xpFormula 属性缺失
  const { baseXP, exponent, scaleFactor } = progression.xpFormula;
  if (baseXP == null || exponent == null || scaleFactor == null) return 0;
  return calculateXpForLevel(nextIndex, progression.xpFormula);
}

/** 获取当前级别内的XP进度百分比（0-1） */
export function getTierProgress(progression: ProgressionModuleSchema): number {
  const xpNeeded = getXpForNextTier(progression);
  if (xpNeeded === Infinity || xpNeeded === 0) return 1;
  const currentXP = progression.currentXP ?? 0;
  return Math.min(1, currentXP / xpNeeded);
}

/** 获取当前等级/段位的属性天花板 */
export function getCurrentLevelCap(progression: ProgressionModuleSchema): StatBonuses | null {
  const currentTierIndex = progression.currentTierIndex ?? 0;
  if (progression.mode === 'level' && progression.levelData) {
    return getLevelStatBonuses(currentTierIndex, progression.levelData);
  }
  if (progression.mode === 'tiered' && progression.tiers) {
    return progression.tiers[currentTierIndex]?.statBonuses ?? null;
  }
  return null;
}

// ─── 骰子相关 ───

/** 计算属性修正值（骰子检定用） */
export function calcModifier(attributeValue: number): number {
  return Math.floor((attributeValue - 10) / 2);
}

/** 执行骰子检定 */
export function rollDice(attributeValue: number, dc: number): {
  d20: number; modifier: number; total: number;
  success: boolean; isNatural20: boolean; isNatural1: boolean;
} {
  const d20 = Math.floor(Math.random() * 20) + 1;
  const modifier = calcModifier(attributeValue);
  const total = d20 + modifier;
  return { d20, modifier, total, success: total >= dc, isNatural20: d20 === 20, isNatural1: d20 === 1 };
}

/** 获取可检定属性列表（从数值属性模块提取） */
export function getCheckableAttributes(
  statModule: import('./schema').StatModuleSchema
): Array<{ id: string; name: string; value: number }> {
  const dims = [statModule.dim1, statModule.dim2, statModule.dim3, statModule.dim4, statModule.dim5, statModule.dim6];
  const attrs: Array<{ id: string; name: string; value: number }> = [];
  dims.forEach((d, i) => {
    if (d) attrs.push({ id: `dim${i + 1}`, name: d.name, value: d.value });
  });
  for (const sp of statModule.special) {
    attrs.push({ id: sp.id, name: sp.name, value: sp.value });
  }
  return attrs;
}
