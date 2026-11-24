/**
 * 行囊容量：格子数有限，背包类物品扩充格数。纯函数，界面、命令与结算检查共用。
 *
 * - 每种物品（物品栏里的一个键）占 1 格，同名叠放不占新格；穿在身上的装备不在物品栏里，不占格。
 * - 背包类物品（写了 扩容，或类型/名称是背包、行囊、包袱…）放进「行囊位」后不占格，
 *   并按 扩容（缺省按品质 4~12）增加格数；行囊位有限，多出来的背包和普通物品一样占格。
 * - 玩家与 NPC 规则不同：NPC 的随身空间更小。
 */
import type { InventoryItem } from '../../schema/variables';

export type InventoryOwner = 'player' | 'npc';

export interface InventoryRules {
  /** 不靠背包的随身格数。 */
  base: number;
  /** 同时能用的背包数（行囊位）。 */
  bagSlots: number;
}

export const INVENTORY_RULES: Readonly<Record<InventoryOwner, InventoryRules>> = {
  player: { base: 12, bagSlots: 3 },
  npc: { base: 8, bagSlots: 2 },
};

export const ITEM_QUALITIES = ['普通', '精良', '稀有', '史诗', '传说'] as const;
export type ItemQuality = typeof ITEM_QUALITIES[number];

/** 单只背包最多扩充的格数（防止一条剧情写出「扩容 999」）。 */
export const MAX_BAG_SIZE = 24;
const BAG_SIZE_BY_QUALITY: Record<ItemQuality, number> = { 普通: 4, 精良: 6, 稀有: 8, 史诗: 10, 传说: 12 };
const BAG_TYPES = new Set(['背包', '背囊', '行囊', '包袋', '收纳', '储物', '储物袋']);
const BAG_NAME = /(背包|背囊|行囊|包袱|褡裢|挎包|腰包|背篓|皮囊|布袋|储物袋|乾坤袋|储物戒|百宝囊|收纳箱|行李箱|旅行箱|登山包|双肩包)$/;

export interface InventoryEntry {
  /** 物品栏里的键（即物品名）。 */
  key: string;
  item: InventoryItem;
  /** 来自 NPC 的静态 物品列表：只展示与计格，剧情不直接增减。 */
  legacy?: boolean;
}

export interface BagView {
  key: string;
  name: string;
  size: number;
  item: InventoryItem;
}

export interface InventoryCell extends InventoryEntry {
  /** 这一格里的数量（背包叠放时扣掉已放进行囊位的那几只）。 */
  count: number;
  /** 背包，但行囊位已满，只能当普通物品占格。 */
  spareBag?: boolean;
}

export interface InventoryLayout {
  rules: InventoryRules;
  capacity: number;
  bags: BagView[];
  cells: InventoryCell[];
  used: number;
  free: number;
  overflow: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function quality(value: unknown): ItemQuality {
  return ITEM_QUALITIES.includes(value as ItemQuality) ? value as ItemQuality : '普通';
}

function positiveInt(value: unknown, fallback: number): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/** 物品对象补齐必填字段；字符串当备注，数字当数量。其余字段（装备部位、属性加成、扩容…）原样保留。 */
export function normalizeInventoryItem(raw: unknown): InventoryItem {
  if (typeof raw === 'number') return { 数量: positiveInt(raw, 1), 类型: '', 品质: '普通', 备注: '' };
  if (typeof raw === 'string') return { 数量: 1, 类型: '', 品质: '普通', 备注: raw };
  const record = isRecord(raw) ? raw : {};
  return {
    ...(record as Partial<InventoryItem>),
    数量: positiveInt(record.数量, 1),
    类型: typeof record.类型 === 'string' ? record.类型 : '',
    品质: quality(record.品质),
    备注: typeof record.备注 === 'string' ? record.备注 : typeof record.描述 === 'string' ? record.描述 : '',
  } as InventoryItem;
}

/** 物品栏（对象）或旧的 物品列表（对象 / 名称数组）→ 格子条目。数量归零的条目视为已消失。 */
export function inventoryEntries(source: unknown, legacy = false): InventoryEntry[] {
  if (Array.isArray(source)) {
    const seen = new Map<string, number>();
    for (const value of source) {
      const name = typeof value === 'string' ? value.trim()
        : isRecord(value) ? String(value.名称 ?? value.name ?? value.物品名 ?? '').trim() : '';
      if (name) seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    return [...seen].map(([key, count]) => ({ key, item: { 数量: count, 类型: '', 品质: '普通', 备注: '' }, ...(legacy ? { legacy } : {}) }));
  }
  if (!isRecord(source)) return [];
  return Object.entries(source).flatMap(([key, value]) => {
    if (!key.trim() || value === null || value === undefined) return [];
    if (isRecord(value) && typeof value.数量 === 'number' && value.数量 <= 0) return [];
    return [{ key, item: normalizeInventoryItem(value), ...(legacy ? { legacy } : {}) }];
  });
}

/** NPC 的行囊：会随剧情增减的 物品栏 + 建档时写的 物品列表（同名以 物品栏 为准）。 */
export function npcInventoryEntries(npc: unknown): InventoryEntry[] {
  const record = isRecord(npc) ? npc : {};
  const live = inventoryEntries(record.物品栏);
  const names = new Set(live.map(entry => entry.key));
  return [...live, ...inventoryEntries(record.物品列表, true).filter(entry => !names.has(entry.key))];
}

/** 背包能扩充的格数；不是背包返回 0。写了 扩容: 0 表示明确不是背包。 */
export function bagSize(name: string, item: Partial<InventoryItem> | undefined): number {
  const explicit = Number(item?.扩容);
  if (item?.扩容 !== undefined && Number.isFinite(explicit)) return explicit > 0 ? Math.min(MAX_BAG_SIZE, Math.max(1, Math.round(explicit))) : 0;
  const type = String(item?.类型 ?? '').trim();
  if (BAG_TYPES.has(type) || BAG_NAME.test(name.trim())) return BAG_SIZE_BY_QUALITY[quality(item?.品质)];
  return 0;
}

export function inventoryLayout(entries: readonly InventoryEntry[], rules: InventoryRules): InventoryLayout {
  // 背包按大小挑进行囊位（同样大小按物品栏顺序）；叠放的背包逐只计算。
  const units = entries.flatMap((entry, order) => {
    const size = bagSize(entry.key, entry.item);
    if (size <= 0) return [];
    return Array.from({ length: Math.min(entry.item.数量, rules.bagSlots) }, () => ({ entry, size, order }));
  }).sort((left, right) => right.size - left.size || left.order - right.order);
  const active = units.slice(0, rules.bagSlots);
  const activeCount = new Map<string, number>();
  for (const unit of active) activeCount.set(unit.entry.key, (activeCount.get(unit.entry.key) ?? 0) + 1);
  const cells: InventoryCell[] = [];
  for (const entry of entries) {
    const inBags = activeCount.get(entry.key) ?? 0;
    const count = entry.item.数量 - inBags;
    if (count <= 0) continue;
    cells.push({ ...entry, count, ...(bagSize(entry.key, entry.item) > 0 ? { spareBag: true } : {}) });
  }
  const capacity = rules.base + active.reduce((sum, unit) => sum + unit.size, 0);
  return {
    rules,
    capacity,
    bags: active.map(unit => ({ key: unit.entry.key, name: unit.entry.key, size: unit.size, item: unit.entry.item })),
    cells,
    used: cells.length,
    free: Math.max(0, capacity - cells.length),
    overflow: Math.max(0, cells.length - capacity),
  };
}

export function playerInventoryLayout(items: unknown): InventoryLayout {
  return inventoryLayout(inventoryEntries(items), INVENTORY_RULES.player);
}

export function npcInventoryLayout(npc: unknown): InventoryLayout {
  return inventoryLayout(npcInventoryEntries(npc), INVENTORY_RULES.npc);
}

/** 改动是否让行囊更挤：超载格数增加即不接受（原本就超载时只要不更糟就行）。 */
export function makesOverflowWorse(before: InventoryLayout, after: InventoryLayout): boolean {
  return after.overflow > before.overflow;
}

/**
 * 一次操作结束时检查：新放进来的物品超出容量就退回（最新放进来的先退），返回被退回的物品名。
 * 已有物品叠放、原本就超载的部分不动；extra 是不受剧情增减的静态条目（NPC 的 物品列表）。
 */
export function rejectNewOverflow(
  after: Record<string, unknown>,
  before: Record<string, unknown> | undefined,
  rules: InventoryRules,
  extra: readonly InventoryEntry[] = [],
): string[] {
  const layoutOf = (items: Record<string, unknown>) => {
    const live = inventoryEntries(items);
    const names = new Set(live.map(entry => entry.key));
    return inventoryLayout([...live, ...extra.filter(entry => !names.has(entry.key))], rules);
  };
  let current = layoutOf(after);
  if (current.overflow === 0) return [];
  const previous = isRecord(before) ? before : {};
  const limit = layoutOf(previous).overflow;
  const fresh = Object.keys(after).filter(key => !Object.hasOwn(previous, key)).reverse();
  const rejected: string[] = [];
  for (const key of fresh) {
    if (current.overflow <= limit) break;
    if (!current.cells.some(cell => cell.key === key)) continue;
    delete after[key];
    rejected.unshift(key);
    current = layoutOf(after);
  }
  return rejected;
}

export function formatCapacity(layout: InventoryLayout): string {
  return `${layout.used}/${layout.capacity} 格`;
}
