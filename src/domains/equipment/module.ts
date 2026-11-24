/**
 * 装备模块（equipment）：武器、头、手、胸、腿、脚与两件饰品，和数值属性绑定。
 *
 * - 世界启用数值属性时随之启用（属性配置 equipment.enabled = false 关闭）。
 * - 状态：玩家.装备栏（部位 → 装备）。穿上的物品离开物品栏、不占行囊格；卸下时放回，行囊放不下就不卸。
 * - 加成：物品的 属性加成 由属性模块计入有效值（domains/stats），生命/体力的加成提高上限；
 *   卸下后上限降低时，当前值随之压回上限。
 * - 命令：equipment.equip / unequip / break；AI 只能通过命令换装（装备栏对 AI、事件只读）。
 * - NPC 的装备写在 人物档案.<id>.装备栏（剧情直接维护），读取时与旧的 装备列表 合并。
 */
import type { EquippedItem, GameState, InventoryItem } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { FactSpec } from '../../core/facts';
import type { GameplayModule, ModuleHookContext } from '../../core/host';
import { findStat, isEquipmentEnabled, statCap, statDefinitions, statsModule, type StatsConfig } from '../stats/module';
import { itemStatBonus } from './bonus';
import { makesOverflowWorse, playerInventoryLayout } from '../inventory/capacity';
import {
  EQUIPMENT_SLOTS, SLOT_KIND_LABEL, itemSlotKind, normalizeBonuses, readEquipment, resolveSlot, slotsOfKind,
  toEquippedItem, toInventoryItem, type EquipmentSlotDef,
} from './slots';

export const EQUIPMENT_MODULE_ID = 'equipment';

export interface EquipmentConfig {
  stats: StatsConfig;
  world?: WorldDef;
}

type Ctx = ModuleHookContext<EquipmentConfig>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 属性名、字段名 → 属性 id，便于加成统一按 id 存。 */
export function statResolver(stats: StatsConfig): (key: string) => string | undefined {
  return key => findStat(stats.stat, key)?.id;
}

/** 世界是否启用装备体系（界面据此决定显示纸娃娃）。 */
export function equipmentConfigFor(world: WorldDef | undefined, state: GameState): EquipmentConfig | undefined {
  const stats = statsModule.resolveConfig(world, state);
  if (!stats || !isEquipmentEnabled(stats.stat)) return undefined;
  return { stats, world };
}

/** 加成文本：{dim1: 3, dim3: -1} → 「膂力+3、身法-1」。 */
export function describeBonuses(stats: StatsConfig, bonuses: unknown): string {
  if (!isRecord(bonuses)) return '';
  return Object.entries(bonuses)
    .map(([key, value]) => [findStat(stats.stat, key)?.name ?? key, Number(value)] as const)
    .filter(([, value]) => Number.isFinite(value) && value !== 0)
    .map(([name, value]) => `${name}${value > 0 ? '+' : ''}${value}`)
    .join('、');
}

/** 把装备放回物品栏（同名叠放）。 */
export function returnToInventory(inventory: Record<string, InventoryItem>, equipped: EquippedItem): void {
  const existing = inventory[equipped.名称];
  if (existing) inventory[equipped.名称] = { ...existing, 数量: Math.max(0, Math.trunc(Number(existing.数量) || 0)) + 1 };
  else inventory[equipped.名称] = toInventoryItem(equipped);
}

function vitalCaps(state: GameState, stats: StatsConfig): Record<string, number> {
  return Object.fromEntries(statDefinitions(stats.stat).filter(def => def.kind === 'vital').map(def => [def.field, statCap(stats, state, def)]));
}

/** 装备变化让生命/体力上限降低时，当前值压回新上限（原本就超出旧上限的老存档数值不动）。 */
function settleVitals(state: GameState, stats: StatsConfig, previous: Record<string, number>): void {
  const now = vitalCaps(state, stats);
  for (const [field, cap] of Object.entries(now)) {
    const before = previous[field];
    const current = Number(state.玩家.生存状态?.[field]);
    if (before === undefined || cap >= before || !Number.isFinite(current) || current <= cap || current > before) continue;
    state.玩家.生存状态[field] = cap;
  }
}

function equipmentOf(state: GameState): Record<string, EquippedItem> {
  if (!isRecord(state.玩家.装备栏)) state.玩家.装备栏 = {};
  return state.玩家.装备栏!;
}

/** 读档/开局：部位别名归位、加成统一成属性 id；对不上部位的条目放回物品栏。幂等。 */
function prepareEquipment(state: GameState, stats: StatsConfig): void {
  const raw = state.玩家?.装备栏;
  if (raw === undefined) return;
  if (!isRecord(raw)) { state.玩家.装备栏 = {}; return; }
  const resolveStat = statResolver(stats);
  const reading = readEquipment(raw);
  const next: Record<string, EquippedItem> = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const item = reading.slots[slot.key];
    if (!item) continue;
    const bonuses = normalizeBonuses(item.属性加成, resolveStat);
    const { 属性加成: _bonuses, ...rest } = item;
    next[slot.key] = { ...rest, 装备部位: SLOT_KIND_LABEL[slot.kind], ...(bonuses ? { 属性加成: bonuses } : {}) };
  }
  if (reading.extras.length) {
    state.玩家.物品栏 ??= {};
    for (const extra of reading.extras) returnToInventory(state.玩家.物品栏, extra.item);
  }
  if (JSON.stringify(next) !== JSON.stringify(raw)) state.玩家.装备栏 = next;
}

/** NPC 的装备由剧情直接写：只把加成键统一成属性 id（战斗按 id 读加成），部位与结构保持原样。 */
function normalizeNpcBonuses(npc: unknown, resolveStat: (key: string) => string | undefined): void {
  const equipment = isRecord(npc) ? npc.装备栏 : undefined;
  if (!isRecord(equipment)) return;
  for (const item of Object.values(equipment)) {
    if (!isRecord(item) || !isRecord(item.属性加成)) continue;
    const normalized = normalizeBonuses(item.属性加成, resolveStat);
    if (JSON.stringify(normalized ?? {}) === JSON.stringify(item.属性加成)) continue;
    if (normalized) item.属性加成 = normalized;
    else delete item.属性加成;
  }
}

function pickSlot(kind: NonNullable<ReturnType<typeof itemSlotKind>>, requested: unknown, equipment: Record<string, EquippedItem>): EquipmentSlotDef | 'mismatch' {
  if (requested !== undefined && requested !== null && String(requested).trim()) {
    const slot = resolveSlot(requested, equipment);
    if (!slot || slot.kind !== kind) return 'mismatch';
    return slot;
  }
  const slots = slotsOfKind(kind);
  return slots.find(slot => !equipment[slot.key]) ?? slots[0]!;
}

function slotItem(state: GameState, slot: string): EquippedItem | undefined {
  const def = resolveSlot(slot);
  return def ? state.玩家?.装备栏?.[def.key] : undefined;
}

function equipmentFacts(): FactSpec[] {
  const readOnly = { module: EQUIPMENT_MODULE_ID, writable: [] as const };
  return [
    { ...readOnly, id: 'player.equipment.{slot}', type: 'string', label: '装备栏·{slot}', aliases: ['玩家.装备栏.{slot}'],
      description: '部位：武器/头部/手部/胸部/腿部/脚部/饰品一/饰品二；值为装备名称，空着为空串。换装只能用 equipment.* 命令。',
      read: (state, { slot }) => resolveSlot(slot) ? slotItem(state, slot)?.名称 ?? '' : undefined,
      enumerate: () => EQUIPMENT_SLOTS.map(slot => ({ params: { slot: slot.key }, label: slot.label })) },
    { ...readOnly, id: 'player.equipment.count', type: 'number', label: '已穿戴装备件数',
      read: state => Object.keys(isRecord(state.玩家?.装备栏) ? state.玩家.装备栏! : {}).length },
    // 下面几项只为拦住 AI / 事件对装备栏的直接改写（换装必须走命令，才能和物品栏、行囊容量联动）。
    { ...readOnly, id: 'player.equipment', type: 'object', label: '装备栏', aliases: ['玩家.装备栏'], visibility: 'hidden',
      read: state => state.玩家?.装备栏 ?? {} },
    { ...readOnly, id: 'player.equipment.{slot}.{field}', type: 'any', label: '装备栏·{slot}·{field}', aliases: ['玩家.装备栏.{slot}.{field}'], visibility: 'hidden',
      read: (state, { slot, field }) => (slotItem(state, slot) as Record<string, unknown> | undefined)?.[field] },
    { ...readOnly, id: 'player.equipment.{slot}.{field}.{key}', type: 'any', label: '装备栏·{slot}·{field}·{key}', aliases: ['玩家.装备栏.{slot}.{field}.{key}'], visibility: 'hidden',
      read: (state, { slot, field, key }) => {
        const value = (slotItem(state, slot) as Record<string, unknown> | undefined)?.[field];
        return isRecord(value) ? value[key] : undefined;
      } },
  ];
}

function describeEquipped(stats: StatsConfig, item: EquippedItem): string {
  const bonus = describeBonuses(stats, item.属性加成);
  return `${item.名称}${item.品质 && item.品质 !== '普通' ? `·${item.品质}` : ''}${bonus ? `（${bonus}）` : ''}`;
}

/** 给 AI 的单件加成建议：按世界六维的范围换算（范围 0~20 与 0~100 的世界量级不同）。 */
function bonusGuide(stats: StatsConfig): string {
  const dims = statDefinitions(stats.stat).filter(def => def.kind === 'dimension');
  const spans = dims.map(def => Math.abs(def.range[1] - def.range[0])).filter(span => span > 0).sort((a, b) => a - b);
  const span = spans[Math.floor(spans.length / 2)] ?? 100;
  const at = (ratio: number) => Math.max(1, Math.round(span * ratio));
  const band = (low: number, high: number) => (at(low) === at(high) ? `${at(low)}` : `${at(low)}~${at(high)}`);
  return `普通 ${band(0.02, 0.05)}、精良 ${band(0.05, 0.08)}、稀有 ${band(0.08, 0.12)}、史诗 ${band(0.12, 0.18)}、传说 ${band(0.18, 0.25)}（单件单项上限约 ${at(0.25)}，超出会被截断）`;
}

export const equipmentModule: GameplayModule<EquipmentConfig> = {
  id: EQUIPMENT_MODULE_ID,
  label: '装备',
  order: 12,
  resolveConfig: (world, state) => equipmentConfigFor(world, state),
  facts: () => equipmentFacts(),
  domainEvents: () => [
    { type: 'equipment.equipped', label: '穿上装备', payload: 'slot 为部位，item 为装备名，replaced 为换下的装备名' },
    { type: 'equipment.unequipped', label: '卸下装备', payload: 'slot 为部位，item 为装备名' },
    { type: 'equipment.broken', label: '装备损毁或被夺走', payload: 'slot 为部位，item 为装备名，reason 为原因' },
  ],
  prepare: (state, context) => {
    prepareEquipment(state, context.config.stats);
    const resolveStat = statResolver(context.config.stats);
    for (const npc of Object.values(state.人物档案 ?? {})) normalizeNpcBonuses(npc, resolveStat);
  },
  commands: {
    equip: (state, args, context: Ctx) => {
      const name = String(args.item ?? args.name ?? args.id ?? '').trim();
      if (!name) return { ok: false, reason: '没有指定要装备的物品' };
      state.玩家.物品栏 ??= {};
      const inventory = state.玩家.物品栏;
      const raw = inventory[name];
      if (!raw) return { ok: false, reason: `行囊里没有「${name}」` };
      const kind = itemSlotKind(name, raw);
      if (!kind) return { ok: false, reason: `「${name}」不是可以穿戴的装备` };
      const equipment = equipmentOf(state);
      const slot = pickSlot(kind, args.slot, equipment);
      if (slot === 'mismatch') return { ok: false, reason: `「${name}」只能装备在${SLOT_KIND_LABEL[kind]}` };
      const previous = equipment[slot.key];
      const nextInventory: Record<string, InventoryItem> = { ...inventory };
      const count = Math.max(1, Math.trunc(Number(raw.数量) || 1));
      if (count > 1) nextInventory[name] = { ...raw, 数量: count - 1 };
      else delete nextInventory[name];
      if (previous) returnToInventory(nextInventory, previous);
      if (makesOverflowWorse(playerInventoryLayout(inventory), playerInventoryLayout(nextInventory))) {
        return { ok: false, reason: `行囊已满，换下的「${previous?.名称 ?? ''}」放不进去，先腾出 1 格` };
      }
      const caps = vitalCaps(state, context.config.stats);
      state.玩家.物品栏 = nextInventory;
      equipment[slot.key] = toEquippedItem(name, raw, slot, statResolver(context.config.stats));
      settleVitals(state, context.config.stats, caps);
      context.emit('equipment.equipped', { slot: slot.key, item: name, ...(previous ? { replaced: previous.名称 } : {}) });
      return { ok: true, message: previous ? `装备「${name}」，换下「${previous.名称}」` : `装备了「${name}」（${slot.label}）` };
    },
    unequip: (state, args, context: Ctx) => {
      const equipment = equipmentOf(state);
      const named = String(args.item ?? args.name ?? '').trim();
      const slot = resolveSlot(args.slot, equipment)
        ?? (named ? EQUIPMENT_SLOTS.find(candidate => equipment[candidate.key]?.名称 === named) : undefined);
      const current = slot ? equipment[slot.key] : undefined;
      if (!slot || !current) return { ok: false, reason: '这个部位没有装备' };
      state.玩家.物品栏 ??= {};
      const nextInventory: Record<string, InventoryItem> = { ...state.玩家.物品栏 };
      returnToInventory(nextInventory, current);
      if (makesOverflowWorse(playerInventoryLayout(state.玩家.物品栏), playerInventoryLayout(nextInventory))) {
        return { ok: false, reason: `行囊已满，卸下的「${current.名称}」放不进去，先腾出 1 格` };
      }
      const caps = vitalCaps(state, context.config.stats);
      state.玩家.物品栏 = nextInventory;
      delete equipment[slot.key];
      settleVitals(state, context.config.stats, caps);
      context.emit('equipment.unequipped', { slot: slot.key, item: current.名称 });
      return { ok: true, message: `卸下了「${current.名称}」` };
    },
    break: (state, args, context: Ctx) => {
      const equipment = equipmentOf(state);
      const named = String(args.item ?? args.name ?? '').trim();
      const slot = resolveSlot(args.slot, equipment)
        ?? (named ? EQUIPMENT_SLOTS.find(candidate => equipment[candidate.key]?.名称 === named) : undefined);
      const current = slot ? equipment[slot.key] : undefined;
      if (!slot || !current) return { ok: false, reason: '这个部位没有装备' };
      const caps = vitalCaps(state, context.config.stats);
      delete equipment[slot.key];
      settleVitals(state, context.config.stats, caps);
      const reason = String(args.reason ?? '').trim();
      context.emit('equipment.broken', { slot: slot.key, item: current.名称, ...(reason ? { reason } : {}) });
      return { ok: true, message: `「${current.名称}」${reason ? `（${reason}）` : ''}没了` };
    },
  },
  summarize: (state, context, audience) => {
    const stats = context.config.stats;
    const equipment = isRecord(state.玩家?.装备栏) ? state.玩家.装备栏! : {};
    const worn = EQUIPMENT_SLOTS.filter(slot => equipment[slot.key]).map(slot => `${slot.key} ${describeEquipped(stats, equipment[slot.key]!)}`);
    const empty = EQUIPMENT_SLOTS.filter(slot => !equipment[slot.key]).map(slot => slot.key);
    const current = worn.length ? `穿戴：${worn.join('；')}${empty.length ? `。空着：${empty.join('、')}` : ''}` : '身上没有穿戴装备';
    if (audience !== 'extraction') return current;
    const ids = statDefinitions(stats.stat).map(def => `${def.id}=${def.name}`).join('，');
    return [
      `${current}。装备栏（玩家.装备栏）对你只读，主角换装只用命令：equipment.equip {item, slot?} 穿上行囊里的装备（同部位旧装备自动放回行囊）、equipment.unequip {slot} 卸下、equipment.break {slot, reason} 装备损毁或被夺走。`,
      `可穿戴的新物品在物品对象里写 装备部位（武器/头部/手部/胸部/腿部/脚部/饰品）与 属性加成（属性 id → 数值，如 {"dim1":2}；可用 id：${ids}）。单项加成建议：${bonusGuide(stats)}；负数表示代价。`,
      'NPC 的装备：set 人物档案.角色名.装备栏.部位 写完整物品对象（含 名称、品质，可带 属性加成）；换下或损毁用 remove 删除该部位。',
    ].join('\n');
  },
  onSettle: (state, context, before) => {
    const stats = context.config.stats;
    const resolveStat = statResolver(stats);
    for (const [id, npc] of Object.entries(state.人物档案 ?? {})) {
      if (JSON.stringify(npc?.装备栏 ?? null) !== JSON.stringify(before.人物档案?.[id]?.装备栏 ?? null)) normalizeNpcBonuses(npc, resolveStat);
    }
    // 命令之外的来源改了装备（如内部事务），同样把生命/体力压回新上限。
    if (JSON.stringify(state.玩家?.装备栏 ?? {}) === JSON.stringify(before.玩家?.装备栏 ?? {})) return;
    settleVitals(state, stats, vitalCaps(before, stats));
  },
};

/** 一件物品穿上后对每个属性的加成（界面比较用）。 */
export function itemBonusById(stats: StatsConfig, item: { 属性加成?: unknown } | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of statDefinitions(stats.stat)) {
    const value = itemStatBonus(item, def);
    if (value) out[def.id] = value;
  }
  return out;
}
