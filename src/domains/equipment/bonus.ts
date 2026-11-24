/**
 * 装备对属性的加成。只依赖属性定义的形状（id、存档字段、名称、范围），
 * 属性模块直接引用这里计算有效值，避免与装备模块互相引用。
 *
 * 加成写在物品的 属性加成 里：键可以是属性 id（dim1、attrA）、存档字段（血量）或中文名，
 * 值为加减数值。单件单项、全部装备合计都有上限（按属性范围的 25% / 50%），
 * 防止剧情里写出一件把属性拉满的装备。
 */

export interface BonusStat {
  id: string;
  field: string;
  name: string;
  kind: 'vital' | 'dimension' | 'special';
  range: [number, number];
}

type BonusSource = { 属性加成?: unknown } | null | undefined;

const VITAL_ALIASES: Record<string, string[]> = {
  attrA: ['hp', '生命', '血量', 'attrA'],
  attrB: ['stamina', '体力', '体力值', 'attrB'],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

export function bonusLimits(def: Pick<BonusStat, 'range'>): { item: number; total: number } {
  const span = Math.abs(Number(def.range[1]) - Number(def.range[0])) || 100;
  return { item: Math.max(1, Math.round(span * 0.25)), total: Math.max(1, Math.round(span * 0.5)) };
}

export function bonusKeys(def: BonusStat): string[] {
  return [...new Set([def.id, def.field, def.name, ...(VITAL_ALIASES[def.id] ?? [])].filter(Boolean))];
}

/** 一件装备对某个属性的加成（按单件上限钳制）。 */
export function itemStatBonus(item: BonusSource, def: BonusStat): number {
  const bonuses = item?.属性加成;
  if (!isRecord(bonuses)) return 0;
  const keys = bonusKeys(def);
  let sum = 0;
  for (const [key, value] of Object.entries(bonuses)) {
    if (!keys.includes(key.trim())) continue;
    const number = Number(value);
    if (Number.isFinite(number)) sum += number;
  }
  return round(clamp(sum, bonusLimits(def).item));
}

/** 装备栏里全部装备对某个属性的加成合计（按合计上限钳制）。 */
export function equipmentStatBonus(equipment: unknown, def: BonusStat): number {
  if (!isRecord(equipment)) return 0;
  let total = 0;
  for (const item of Object.values(equipment)) total += itemStatBonus(isRecord(item) ? item : undefined, def);
  return round(clamp(total, bonusLimits(def).total));
}
