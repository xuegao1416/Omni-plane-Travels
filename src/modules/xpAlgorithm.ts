// ============================================================
//  世界模块化系统 v2 — XP 算法
//  段位制和等级制统一入口，内部按 mode 分支
// ============================================================

import type { XpFormula, TierDef, StatBonuses, LevelData, ProgressionConfig, ProgressionModuleSchema, SixDimSemanticRole, StatModuleSchema } from './schema';

export const SIX_DIM_SEMANTICS: Record<`dim${1 | 2 | 3 | 4 | 5 | 6}`, { role: SixDimSemanticRole; label: string; keywords: string[] }> = {
  dim1: { role: 'power', label: '力量・攻击类', keywords: ['力量', '气力', '攻击', '外攻', '武力', '破坏', '强壮', '蛮力'] },
  dim2: { role: 'guard', label: '体魄・防护类', keywords: ['体魄', '防御', '护甲', '耐力', '坚韧', '生命', '抗性', '承受'] },
  dim3: { role: 'agility', label: '灵巧・速度类', keywords: ['敏捷', '灵巧', '速度', '身法', '反应', '闪避', '潜行', '手艺'] },
  dim4: { role: 'intellect', label: '智识・技术类', keywords: ['智力', '学识', '技术', '法术', '精神', '调查', '研究', '投资', '经营'] },
  dim5: { role: 'social', label: '意志・交涉类', keywords: ['魅力', '交涉', '意志', '领导', '威慑', '社交', '情商', '信仰'] },
  dim6: { role: 'perception', label: '感知・机运类', keywords: ['感知', '洞察', '幸运', '机运', '观察', '侦察', '直觉', '品味'] },
};

export function getSixDimSemantic(key: `dim${1 | 2 | 3 | 4 | 5 | 6}`, stat?: { semanticRole?: SixDimSemanticRole }): { role: SixDimSemanticRole; label: string; keywords: string[] } {
  // 六维是跨世界、跨职业包的规范坐标。世界只能改显示名和说明，不能把
  // dim1 从力量类改成智识类，否则职业公式会在不同世界指向不同含义。
  void stat;
  return SIX_DIM_SEMANTICS[key];
}

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
  statModule: StatModuleSchema
): Array<{ id: string; name: string; value: number; semanticLabel?: string; description?: string }> {
  const dims = [statModule.dim1, statModule.dim2, statModule.dim3, statModule.dim4, statModule.dim5, statModule.dim6];
  const attrs: Array<{ id: string; name: string; value: number; semanticLabel?: string; description?: string }> = [];
  dims.forEach((d, i) => {
    if (d) {
      const id = `dim${i + 1}` as `dim${1 | 2 | 3 | 4 | 5 | 6}`;
      attrs.push({ id, name: d.name, value: d.value, semanticLabel: getSixDimSemantic(id, d).label, description: d.description });
    }
  });
  for (const sp of statModule.special) {
    attrs.push({ id: sp.id, name: sp.name, value: sp.value });
  }
  return attrs;
}

/** Repair AI/legacy progression payloads without discarding generated caps. */
export function normalizeProgressionConfig(progression: ProgressionModuleSchema): ProgressionConfig {
  const numberOr = (value: unknown, fallback: number) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const xpFormula: XpFormula = {
    baseXP: Math.max(1, numberOr(progression.xpFormula?.baseXP, 100)),
    exponent: Math.max(0.1, numberOr(progression.xpFormula?.exponent, 1.5)),
    scaleFactor: Math.max(0.01, numberOr(progression.xpFormula?.scaleFactor, 1)),
  };
  const config: ProgressionConfig = {
    mode: progression.mode === 'level' ? 'level' : 'tiered',
    xpFormula,
  };
  if (config.mode === 'tiered' && Array.isArray(progression.tiers)) {
    const statKeys = ['attrAMax', 'attrBMax', 'dim1Max', 'dim2Max', 'dim3Max', 'dim4Max', 'dim5Max', 'dim6Max'] as const;
    const fallbackCaps: StatBonuses = { attrAMax: 100, attrBMax: 100, dim1Max: 50, dim2Max: 50, dim3Max: 50, dim4Max: 50, dim5Max: 50, dim6Max: 50 };
    let previousCaps = fallbackCaps;
    let previousXp = 0;
    const tiers: TierDef[] = progression.tiers.map((tier, index) => {
      const statBonuses = Object.fromEntries(statKeys.map(key => {
        const generated = numberOr(tier?.statBonuses?.[key], 0);
        const prior = numberOr(previousCaps[key], fallbackCaps[key]);
        const fallback = index === 0 ? fallbackCaps[key] : Math.round(prior * 1.25);
        return [key, generated > 0 ? generated : fallback];
      })) as unknown as StatBonuses;
      previousCaps = statBonuses;
      const requestedXp = numberOr(tier?.xpRequired, -1);
      const calculatedXp = calculateCumulativeXp(index, xpFormula);
      const xpRequired = index === 0
        ? 0
        : requestedXp > previousXp
          ? Math.round(requestedXp)
          : Math.max(previousXp + 1, calculatedXp);
      previousXp = xpRequired;
      return {
        name: tier?.name?.trim() || `第${index + 1}段`,
        description: tier?.description?.trim() || '尚未填写段位描述',
        xpRequired,
        statBonuses,
      };
    });
    config.tiers = tiers;
  }
  if (config.mode === 'level' && progression.levelData) config.levelData = progression.levelData;
  if (progression.narrativeStyle) config.narrativeStyle = progression.narrativeStyle;
  if (progression.activityRewards) config.activityRewards = progression.activityRewards;
  if (progression.pointsPerTier) config.pointsPerTier = progression.pointsPerTier;
  if (progression.breakthroughs) config.breakthroughs = progression.breakthroughs;
  return config;
}

/** 将 AI 给出的检定名称收敛到当前世界真实属性；不把选择权暴露给玩家。 */
export function resolveCheckableAttribute(statModule: StatModuleSchema, requested: string) {
  const attributes = getCheckableAttributes(statModule);
  if (!attributes.length) return undefined;
  const normalized = requested.toLowerCase().replace(/[\s·・_\-]/g, '').replace(/(属性|检定|鉴定|判定)$/g, '');
  const exact = attributes.find(item => item.id.toLowerCase() === normalized || item.name.toLowerCase() === normalized);
  if (exact) return exact;
  let best = attributes[0];
  let bestScore = -1;
  for (const item of attributes) {
    const haystack = `${item.id}${item.name}${item.semanticLabel ?? ''}${item.description ?? ''}`.toLowerCase().replace(/[\s·・_\-]/g, '');
    let score = haystack.includes(normalized) || normalized.includes(item.name.toLowerCase()) ? 40 : 0;
    if (/^dim[1-6]$/.test(item.id)) {
      const semantic = getSixDimSemantic(item.id as `dim${1 | 2 | 3 | 4 | 5 | 6}`, statModule[item.id as keyof StatModuleSchema] as { semanticRole?: SixDimSemanticRole });
      score += semantic.keywords.reduce((sum, keyword) => sum + (normalized.includes(keyword) ? 8 : 0), 0);
    }
    if (score > bestScore) { best = item; bestScore = score; }
  }
  return best;
}
