/**
 * 装备部位与物品识别：哪些物品能穿、穿在哪、旧数据里的部位名怎么对上。纯函数，界面与模块共用。
 *
 * 存档里装备栏的键是中文部位名（武器/头部/手部/胸部/腿部/脚部/饰品一/饰品二），
 * code 只给界面做样式钩子。剧情或旧数据写的「头盔」「首饰」「饰品」之类会归到对应部位。
 */
import type { EquippedItem, InventoryItem } from '../../schema/variables';
import { bagSize, normalizeInventoryItem } from '../inventory/capacity';

export type SlotKind = 'weapon' | 'head' | 'hands' | 'chest' | 'legs' | 'feet' | 'accessory';

export interface EquipmentSlotDef {
  /** 存档里的键。 */
  key: string;
  code: 'weapon' | 'head' | 'hands' | 'chest' | 'legs' | 'feet' | 'accessory1' | 'accessory2';
  kind: SlotKind;
  label: string;
}

export const EQUIPMENT_SLOTS: readonly EquipmentSlotDef[] = [
  { key: '武器', code: 'weapon', kind: 'weapon', label: '武器' },
  { key: '头部', code: 'head', kind: 'head', label: '头部' },
  { key: '手部', code: 'hands', kind: 'hands', label: '手部' },
  { key: '胸部', code: 'chest', kind: 'chest', label: '胸部' },
  { key: '腿部', code: 'legs', kind: 'legs', label: '腿部' },
  { key: '脚部', code: 'feet', kind: 'feet', label: '脚部' },
  { key: '饰品一', code: 'accessory1', kind: 'accessory', label: '饰品·壹' },
  { key: '饰品二', code: 'accessory2', kind: 'accessory', label: '饰品·贰' },
];

export const SLOT_KIND_LABEL: Record<SlotKind, string> = {
  weapon: '武器', head: '头部', hands: '手部', chest: '胸部', legs: '腿部', feet: '脚部', accessory: '饰品',
};

const KIND_ALIASES: Record<SlotKind, readonly string[]> = {
  weapon: ['武器', '兵器', '兵刃', '主手', '手持', '持械', 'weapon', 'mainhand'],
  head: ['头', '头部', '头饰', '头盔', '帽子', '帽', '冠', 'head', 'helmet'],
  hands: ['手', '手部', '双手', '护手', '手套', '手腕', '腕', '副手', '盾', '盾牌', 'hands', 'hand', 'gloves', 'offhand'],
  chest: ['胸', '胸部', '身', '身体', '躯干', '上身', '衣服', '衣着', '服装', '护甲', '铠甲', '盔甲', '防具', '外套', 'chest', 'body', 'armor'],
  legs: ['腿', '腿部', '下身', '裤子', '裤', '护腿', '下装', 'legs', 'pants'],
  feet: ['脚', '脚部', '足', '足部', '鞋', '鞋子', '靴', '靴子', 'feet', 'boots', 'shoes'],
  accessory: ['饰品', '首饰', '配饰', '饰物', '挂件', '佩饰', '戒指', '项链', '护符', '护身符', 'accessory', 'ring', 'amulet', 'trinket'],
};
const ACCESSORY_INDEX: Record<string, EquipmentSlotDef['code']> = {
  饰品1: 'accessory1', 饰品一: 'accessory1', 饰品壹: 'accessory1', 'accessory1': 'accessory1', 左饰: 'accessory1',
  饰品2: 'accessory2', 饰品二: 'accessory2', 饰品贰: 'accessory2', 'accessory2': 'accessory2', 右饰: 'accessory2',
};

/** 明确是装备的类型。只有类型在这里（或写了 装备部位）的物品才能穿，避免把药、食物、钥匙当装备。 */
const EQUIPMENT_TYPES: Record<string, SlotKind | 'armor'> = {
  武器: 'weapon', 兵器: 'weapon', 兵刃: 'weapon', 枪械: 'weapon', 弓弩: 'weapon', 暗器: 'weapon', 法器: 'weapon', 法杖: 'weapon',
  防具: 'armor', 护甲: 'armor', 盔甲: 'armor', 铠甲: 'armor', 装备: 'armor', 服饰: 'armor', 服装: 'armor', 衣服: 'chest', 衣物: 'chest', 外衣: 'chest',
  头盔: 'head', 帽子: 'head', 头饰: 'head', 发饰: 'head',
  手套: 'hands', 护腕: 'hands', 护手: 'hands', 盾牌: 'hands', 盾: 'hands',
  裤子: 'legs', 护腿: 'legs', 下装: 'legs',
  鞋子: 'feet', 鞋: 'feet', 靴子: 'feet', 靴: 'feet',
  饰品: 'accessory', 首饰: 'accessory', 配饰: 'accessory', 戒指: 'accessory', 项链: 'accessory', 护符: 'accessory', 护身符: 'accessory', 挂件: 'accessory', 玉佩: 'accessory',
};

const NAME_HINTS: ReadonlyArray<[SlotKind, RegExp]> = [
  ['head', /(盔|帽|冠|巾|簪|钗|面具|面罩|头带|发带|兜帽|斗笠|眼镜|护目镜)/],
  ['hands', /(手套|护手|护腕|臂甲|臂鞲|拳套|手甲|腕甲|盾)/],
  ['feet', /(鞋|靴|履|屐|袜)/],
  ['legs', /(裤|护腿|胫甲|腿甲|裙|绑腿|护膝)/],
  ['accessory', /(戒|指环|项链|项圈|吊坠|坠子|玉佩|佩玉|护符|符牌|手镯|手链|镯|耳环|耳坠|徽章|香囊|念珠|佛珠)/],
  ['chest', /(甲|衣|袍|衫|铠|背心|外套|大衣|斗篷|披风|夹克|制服|长袍|劲装|裙装|战袍)/],
];

const WEAPON_NAME = /(剑|刀|枪|戟|棍|棒|斧|锤|弓|弩|匕首|短刃|鞭|杖|矛|镰|叉|钩|扇|拳刃|手枪|步枪|霰弹枪|猎枪|左轮|球棒|撬棍|砍刀)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function kindFromAlias(text: string): SlotKind | undefined {
  const value = text.trim();
  if (!value) return undefined;
  if (ACCESSORY_INDEX[value]) return 'accessory';
  for (const [kind, aliases] of Object.entries(KIND_ALIASES) as Array<[SlotKind, readonly string[]]>) {
    if (aliases.includes(value) || aliases.includes(value.toLowerCase())) return kind;
  }
  return undefined;
}

/** 部位键 / code / 别名 → 部位。只说「饰品」时选第一个空着的饰品位（都满了选第一个）。 */
export function resolveSlot(input: unknown, occupied?: Record<string, unknown>): EquipmentSlotDef | undefined {
  const value = String(input ?? '').trim();
  if (!value) return undefined;
  const exact = EQUIPMENT_SLOTS.find(slot => slot.key === value || slot.code === value);
  if (exact) return exact;
  const indexed = ACCESSORY_INDEX[value];
  if (indexed) return EQUIPMENT_SLOTS.find(slot => slot.code === indexed);
  const kind = kindFromAlias(value);
  return kind ? slotForKind(kind, occupied) : undefined;
}

export function slotsOfKind(kind: SlotKind): EquipmentSlotDef[] {
  return EQUIPMENT_SLOTS.filter(slot => slot.kind === kind);
}

export function slotForKind(kind: SlotKind, occupied?: Record<string, unknown>): EquipmentSlotDef {
  const slots = slotsOfKind(kind);
  return slots.find(slot => !occupied?.[slot.key]) ?? slots[0]!;
}

/** 物品能穿在哪类部位；不是装备返回 undefined。背包类物品放进行囊位扩容，不当装备穿。 */
export function itemSlotKind(name: string, item: Partial<InventoryItem> | undefined): SlotKind | undefined {
  if (bagSize(name, item) > 0) return undefined;
  const explicit = typeof item?.装备部位 === 'string' ? kindFromAlias(item.装备部位) : undefined;
  if (explicit) return explicit;
  const type = String(item?.类型 ?? '').trim();
  const byType = EQUIPMENT_TYPES[type] ?? Object.entries(EQUIPMENT_TYPES).find(([key]) => type.length > 1 && type.endsWith(key))?.[1];
  if (!byType) return undefined;
  if (byType !== 'armor') return byType;
  const label = name.trim();
  for (const [kind, pattern] of NAME_HINTS) if (pattern.test(label)) return kind;
  return WEAPON_NAME.test(label) ? 'weapon' : 'chest';
}

export function isEquipmentItem(name: string, item: Partial<InventoryItem> | undefined): boolean {
  return itemSlotKind(name, item) !== undefined;
}

/** 属性加成只留数值；resolveStat 给出时把属性名 / 字段名统一成属性 id。 */
export function normalizeBonuses(raw: unknown, resolveStat?: (key: string) => string | undefined): Record<string, number> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    const number = Number(value);
    if (!key.trim() || !Number.isFinite(number) || number === 0) continue;
    const id = resolveStat?.(key.trim()) ?? key.trim();
    out[id] = Math.round(((out[id] ?? 0) + number) * 100) / 100;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 物品数据 → 装备栏条目（数量固定为 1，名称存进条目里）。 */
export function toEquippedItem(name: string, raw: unknown, slot: EquipmentSlotDef, resolveStat?: (key: string) => string | undefined): EquippedItem {
  const item = normalizeInventoryItem(raw);
  const bonuses = normalizeBonuses(item.属性加成, resolveStat);
  const { 数量: _count, 属性加成: _bonuses, 扩容: _size, ...rest } = item;
  return { ...rest, 名称: name, 数量: 1, 装备部位: SLOT_KIND_LABEL[slot.kind], ...(bonuses ? { 属性加成: bonuses } : {}) };
}

/** 装备栏条目 → 放回物品栏的物品数据。 */
export function toInventoryItem(equipped: EquippedItem): InventoryItem {
  const { 名称: _name, ...rest } = equipped;
  return normalizeInventoryItem({ ...rest, 数量: 1 });
}

/** 「无」「未知」之类的占位不当装备。 */
const PLACEHOLDER_NAMES = new Set(['无', '未知', '暂无', '没有', '不详', '空', '空着', '-', '—', 'none', 'null']);

/** 装备栏里的一项：对象要有名称，字符串就是名称本身（旧的 装备列表 常这样写）。 */
export function readEquippedItem(raw: unknown, fallbackName = ''): EquippedItem | undefined {
  if (typeof raw === 'string') {
    const text = raw.trim();
    return text && !PLACEHOLDER_NAMES.has(text) ? { 名称: text, 数量: 1, 类型: '', 品质: '普通', 备注: '' } : undefined;
  }
  if (!isRecord(raw)) return undefined;
  const name = String(raw.名称 ?? raw.name ?? raw.物品名 ?? fallbackName).trim();
  if (!name || PLACEHOLDER_NAMES.has(name)) return undefined;
  const item = normalizeInventoryItem(raw);
  return { ...item, 名称: name, 数量: 1 };
}

export interface EquipmentReading {
  /** 部位键 → 装备。 */
  slots: Record<string, EquippedItem>;
  /** 对不上部位或部位重复的条目（界面放在「其他随身装备」里）。 */
  extras: Array<{ label: string; item: EquippedItem }>;
}

/**
 * 读出一份装备记录。键可以是部位名或别名，键对不上时按物品推断部位；
 * fill 为 true 时只往空位里放（用于把旧的 装备列表 叠到 装备栏 下面）。
 */
export function readEquipment(source: unknown, base?: EquipmentReading): EquipmentReading {
  const reading: EquipmentReading = base ? { slots: { ...base.slots }, extras: [...base.extras] } : { slots: {}, extras: [] };
  if (!isRecord(source)) return reading;
  for (const [key, raw] of Object.entries(source)) {
    const item = readEquippedItem(raw, isRecord(raw) ? key : '');
    if (!item) continue;
    // 字符串值的键就是部位（{ 武器: '铁剑' }）；对象值优先认键，其次认物品自己的部位/类型。
    const direct = resolveSlot(key, reading.slots);
    const inferredKind = itemSlotKind(item.名称, item);
    const slot = direct && !reading.slots[direct.key] ? direct
      : inferredKind ? slotsOfKind(inferredKind).find(candidate => !reading.slots[candidate.key]) : undefined;
    if (slot && !reading.slots[slot.key]) reading.slots[slot.key] = item;
    else reading.extras.push({ label: key, item });
  }
  return reading;
}

/** NPC 的装备：会随剧情变化的 装备栏 优先，建档时写的 装备列表 补进空位。 */
export function readNpcEquipment(npc: unknown): EquipmentReading {
  const record = isRecord(npc) ? npc : {};
  return readEquipment(record.装备列表, readEquipment(record.装备栏));
}
