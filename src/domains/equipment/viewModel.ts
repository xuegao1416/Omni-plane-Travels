/**
 * 装备界面的数据：玩家纸娃娃（部位、可换的物品、加成合计）与 NPC 装备环。
 * 界面只读这里的结果，加成、上限、比较都按属性模块的同一套规则算。
 */
import type { EquippedItem, GameState, InventoryItem } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import {
  baseStat, baseStatCap, effectiveStat, equipmentBonus, statCap, statDefinitions, statsModule,
  type StatDefinition, type StatsConfig,
} from '../stats/module';
import { equipmentStatBonus, itemStatBonus } from './bonus';
import { equipmentConfigFor } from './module';
import { EQUIPMENT_SLOTS, itemSlotKind, readEquipment, readNpcEquipment, slotsOfKind, type EquipmentSlotDef, type SlotKind } from './slots';

export interface StatChip {
  id: string;
  name: string;
  value: number;
  kind: StatDefinition['kind'];
}

export interface EquipmentSlotView {
  slot: EquipmentSlotDef;
  item?: EquippedItem;
  bonuses: StatChip[];
  /** 物品栏里能放进这个部位的物品名。 */
  candidates: string[];
}

export interface StatTotalView {
  id: string;
  name: string;
  kind: StatDefinition['kind'];
  base: number;
  bonus: number;
  effective: number;
  /** 生命/体力：含装备的上限；其余属性：成长上限。 */
  cap: number;
  baseCap: number;
}

export interface EquipmentView {
  slots: EquipmentSlotView[];
  extras: Array<{ label: string; item: EquippedItem; bonuses: StatChip[] }>;
  totals: StatTotalView[];
  worn: number;
}

export interface CandidateComparison {
  slot: EquipmentSlotDef;
  current?: EquippedItem;
  /** 换上之后每个属性的变化（新装备加成 - 旧装备加成），只列有变化的。 */
  delta: StatChip[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function statsConfigFor(world: WorldDef | undefined, state: GameState): StatsConfig | undefined {
  return statsModule.resolveConfig(world, state);
}

/** 一件物品对各属性的加成（按单件上限截断后），名称用世界里的属性名。 */
export function itemBonusChips(stats: StatsConfig | undefined, item: { 属性加成?: unknown } | undefined): StatChip[] {
  if (!stats || !item) return [];
  return statDefinitions(stats.stat).flatMap(def => {
    const value = itemStatBonus(item, def);
    return value ? [{ id: def.id, name: def.name, value, kind: def.kind }] : [];
  });
}

function candidatesFor(slot: EquipmentSlotDef, inventory: Record<string, InventoryItem> | undefined): string[] {
  return Object.entries(inventory ?? {})
    .filter(([name, item]) => item && Number(item.数量 ?? 1) > 0 && itemSlotKind(name, item) === slot.kind)
    .map(([name]) => name);
}

export function buildPlayerEquipmentView(state: GameState, world: WorldDef | undefined): EquipmentView | undefined {
  const config = equipmentConfigFor(world, state);
  if (!config) return undefined;
  const stats = config.stats;
  const reading = readEquipment(state.玩家?.装备栏);
  const inventory = state.玩家?.物品栏;
  const slots = EQUIPMENT_SLOTS.map(slot => {
    const item = reading.slots[slot.key];
    return { slot, ...(item ? { item } : {}), bonuses: itemBonusChips(stats, item), candidates: candidatesFor(slot, inventory) };
  });
  const totals = statDefinitions(stats.stat).map(def => ({
    id: def.id, name: def.name, kind: def.kind,
    base: baseStat(state, def),
    bonus: equipmentBonus(stats, state, def),
    effective: effectiveStat(stats, state, def),
    cap: statCap(stats, state, def),
    baseCap: baseStatCap(stats, state, def),
  }));
  return {
    slots,
    extras: reading.extras.map(extra => ({ ...extra, bonuses: itemBonusChips(stats, extra.item) })),
    totals,
    worn: slots.filter(slot => slot.item).length,
  };
}

/** 换上行囊里的某件物品会怎样：去哪个部位、替下谁、各属性怎么变。 */
export function compareCandidate(state: GameState, world: WorldDef | undefined, name: string, slotKey?: string): CandidateComparison | undefined {
  const config = equipmentConfigFor(world, state);
  const item = state.玩家?.物品栏?.[name];
  const kind = item ? itemSlotKind(name, item) : undefined;
  if (!config || !item || !kind) return undefined;
  const equipment = isRecord(state.玩家?.装备栏) ? state.玩家.装备栏! : {};
  const slot = slotKey ? slotsOfKind(kind).find(candidate => candidate.key === slotKey) ?? slotForCompare(kind, equipment) : slotForCompare(kind, equipment);
  const current = equipment[slot.key];
  const delta = statDefinitions(config.stats.stat).flatMap(def => {
    const value = Math.round((itemStatBonus(item, def) - itemStatBonus(current, def)) * 100) / 100;
    return value ? [{ id: def.id, name: def.name, value, kind: def.kind }] : [];
  });
  return { slot, ...(current ? { current } : {}), delta };
}

function slotForCompare(kind: SlotKind, equipment: Record<string, EquippedItem>): EquipmentSlotDef {
  const slots = slotsOfKind(kind);
  return slots.find(slot => !equipment[slot.key]) ?? slots[0]!;
}

export interface NpcEquipmentView {
  slots: Array<{ slot: EquipmentSlotDef; item?: EquippedItem; bonuses: StatChip[] }>;
  extras: Array<{ label: string; item: EquippedItem; bonuses: StatChip[] }>;
  /** NPC 的属性加上装备后的数值（世界没有数值属性时为空）。 */
  totals: Array<{ id: string; name: string; base: number; bonus: number }>;
  worn: number;
}

export function buildNpcEquipmentView(npc: unknown, world: WorldDef | undefined, state: GameState): NpcEquipmentView {
  const stats = statsConfigFor(world, state);
  const geared = stats && equipmentConfigFor(world, state) ? stats : undefined;
  const reading = readNpcEquipment(npc);
  const slots = EQUIPMENT_SLOTS.map(slot => {
    const item = reading.slots[slot.key];
    return { slot, ...(item ? { item } : {}), bonuses: itemBonusChips(geared, item) };
  });
  const survival = isRecord(npc) && isRecord(npc.生存状态) ? npc.生存状态 : {};
  // 生命/体力的装备加成提高的是上限，不能和当前值相加展示，这里只列六维与特色属性。
  const totals = geared ? statDefinitions(geared.stat).filter(def => def.kind !== 'vital').flatMap(def => {
    const raw = Number(survival[def.field] ?? survival[def.id]);
    if (!Number.isFinite(raw)) return [];
    return [{ id: def.id, name: def.name, base: raw, bonus: equipmentStatBonus(reading.slots, def) }];
  }) : [];
  return {
    slots,
    extras: reading.extras.map(extra => ({ ...extra, bonuses: itemBonusChips(geared, extra.item) })),
    totals,
    worn: slots.filter(slot => slot.item).length,
  };
}
