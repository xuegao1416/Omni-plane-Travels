import type { WorldBookEntryDef } from '../data/worlds-schema';

export interface NovelModuleConflict {
  moduleId: string;
  sourceRule: string;
  reason: string;
}

const MODULE_CONFLICT_PATTERNS: Record<string, Array<{ pattern: RegExp; reason: string }>> = {
  business: [
    { pattern: /(?:不存在|没有|禁用|禁止)[^。；\n]{0,10}(?:货币|交易|商业)/, reason: '原著明确排除了货币、交易或商业体系' },
  ],
  progression: [
    { pattern: /(?:境界|力量|能力)[^。；\n]{0,12}(?:终生固定|无法提升|不能提升|不可提升)/, reason: '原著明确规定力量或境界不能成长' },
    { pattern: /(?:禁止|无法|不能|不可)[^。；\n]{0,8}(?:升级|成长|进阶)/, reason: '原著明确禁止成长或升级' },
  ],
  combat: [
    { pattern: /(?:禁止|无法|不能|不可)[^。；\n]{0,8}(?:战斗|攻击|造成伤害)/, reason: '原著明确禁止战斗或伤害行为' },
  ],
  survival: [
    { pattern: /(?:无需|不需要)[^。；\n]{0,8}(?:进食|饮水|睡眠|生存资源)/, reason: '原著明确排除了常规生存消耗' },
  ],
  stat: [
    { pattern: /(?:不存在|禁止|无法使用)[^。；\n]{0,8}(?:属性|数值|能力值)/, reason: '原著明确排除了数值属性体系' },
  ],
};

/** Conservative detector: only explicit negation rules are treated as conflicts. */
export function findNovelModuleConflicts(entries: WorldBookEntryDef[] | undefined, moduleIds: string[]): NovelModuleConflict[] {
  const sourceRules = (entries ?? [])
    .filter(entry => entry.entryType === 'rules' && entry.content.trim())
    .map(entry => entry.content.trim());
  const conflicts: NovelModuleConflict[] = [];
  for (const moduleId of moduleIds) {
    const patterns = MODULE_CONFLICT_PATTERNS[moduleId] ?? [];
    const match = sourceRules.flatMap(sourceRule => patterns.map(item => ({ ...item, sourceRule })))
      .find(item => item.pattern.test(item.sourceRule));
    if (match) conflicts.push({ moduleId, sourceRule: match.sourceRule, reason: match.reason });
  }
  return conflicts;
}
