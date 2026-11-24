/**
 * 行囊模块（inventory）：所有世界都有。物品栏的格子有限，背包类物品扩充格数（规则见 ./capacity.ts）。
 *
 * - 一次操作（AI 更新、事件卡、规则、玩家命令）结束时检查：新放进来的物品超出容量就退回，
 *   给正文留一条结算备注并发出 inventory.full；原有物品叠放、原本就超载的部分不动。
 * - 玩家与 NPC 分别计算；NPC 的静态 物品列表 也占格，刚建档的 NPC 随身物品原样接受。
 * - 命令：inventory.discard（界面丢弃物品；丢背包会让行囊放不下时拒绝）。
 */
import type { GameState, InventoryItem } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { FactSpec } from '../../core/facts';
import type { GameplayModule } from '../../core/host';
import {
  INVENTORY_RULES, formatCapacity, inventoryEntries, inventoryLayout, makesOverflowWorse, npcInventoryLayout,
  playerInventoryLayout, rejectNewOverflow, type InventoryLayout,
} from './capacity';
import { equipmentConfigFor, returnToInventory } from '../equipment/module';
import { readEquippedItem } from '../equipment/slots';

export const INVENTORY_MODULE_ID = 'inventory';

export interface InventoryConfig {
  world?: WorldDef;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameKeys(left: unknown, right: unknown): boolean {
  const a = isRecord(left) ? Object.keys(left) : [];
  const b = isRecord(right) ? Object.keys(right) : [];
  return a.length === b.length && a.every(key => b.includes(key));
}

function bagsText(layout: InventoryLayout): string {
  return layout.bags.length ? `（背包：${layout.bags.map(bag => `${bag.name}+${bag.size}`).join('、')}）` : '';
}

function stateText(layout: InventoryLayout): string {
  if (layout.overflow > 0) return `，超载 ${layout.overflow} 件`;
  return layout.free === 0 ? '，已满' : '';
}

function names(list: readonly string[]): string {
  return list.map(name => `「${name}」`).join('、');
}

function inventoryFacts(): FactSpec[] {
  const base = { module: INVENTORY_MODULE_ID, type: 'number' as const, writable: [] as const, unit: '格' };
  return [
    { ...base, id: 'player.inventory.capacity', label: '行囊容量', description: '随身格数 + 背包扩充的格数', read: state => playerInventoryLayout(state.玩家?.物品栏).capacity },
    { ...base, id: 'player.inventory.used', label: '行囊已用格数', read: state => playerInventoryLayout(state.玩家?.物品栏).used },
    { ...base, id: 'player.inventory.free', label: '行囊空格', read: state => playerInventoryLayout(state.玩家?.物品栏).free },
  ];
}

export const inventoryModule: GameplayModule<InventoryConfig> = {
  id: INVENTORY_MODULE_ID,
  label: '行囊',
  order: 5,
  resolveConfig: world => ({ world }),
  /** 世界关掉了装备体系（或没有数值属性）时，身上的装备放回物品栏，不让它们留在看不见的装备栏里。 */
  prepare: (state, context) => {
    const worn = state.玩家?.装备栏;
    if (!isRecord(worn) || Object.keys(worn).length === 0 || equipmentConfigFor(context.config.world, state)) return;
    state.玩家.物品栏 ??= {};
    for (const raw of Object.values(worn)) {
      const item = readEquippedItem(raw);
      if (item) returnToInventory(state.玩家.物品栏, item);
    }
    delete state.玩家.装备栏;
  },
  facts: () => inventoryFacts(),
  domainEvents: () => [
    { type: 'inventory.full', label: '行囊放不下新物品', payload: 'owner 为 player 或人物 id，item 为没收下的物品名，capacity 为格数' },
    { type: 'inventory.discarded', label: '丢弃物品', payload: 'item 为物品名，count 为数量' },
  ],
  commands: {
    discard: (state, args, context) => {
      const name = String(args.item ?? args.name ?? '').trim();
      const inventory = state.玩家.物品栏 ?? {};
      const item = inventory[name];
      if (!name || !item) return { ok: false, reason: `行囊里没有「${name}」` };
      const have = Math.max(1, Math.trunc(Number(item.数量) || 1));
      const amount = args.count === undefined ? have : Math.min(have, Math.max(1, Math.trunc(Number(args.count) || 1)));
      const next: Record<string, InventoryItem> = { ...inventory };
      if (amount >= have) delete next[name];
      else next[name] = { ...item, 数量: have - amount };
      const before = playerInventoryLayout(inventory);
      const after = playerInventoryLayout(next);
      if (makesOverflowWorse(before, after)) {
        return { ok: false, reason: `丢掉「${name}」后行囊只剩 ${after.capacity} 格，放不下现有的 ${after.used} 件物品，先腾出 ${after.overflow} 格` };
      }
      state.玩家.物品栏 = next;
      context.emit('inventory.discarded', { item: name, count: amount });
      return { ok: true, message: `丢弃了「${name}」${amount > 1 ? `×${amount}` : ''}` };
    },
  },
  onSettle: (state, context, before) => {
    const items = state.玩家?.物品栏;
    if (isRecord(items) && !sameKeys(items, before.玩家?.物品栏)) {
      const rejected = rejectNewOverflow(items, before.玩家?.物品栏, INVENTORY_RULES.player);
      if (rejected.length) {
        const layout = playerInventoryLayout(items);
        context.note(`行囊已满（${formatCapacity(layout)}），${names(rejected)}没能收进行囊，仍留在原处。`, 'fact');
        for (const item of rejected) context.emit('inventory.full', { owner: 'player', item, capacity: layout.capacity });
      }
    }
    for (const [id, npc] of Object.entries(state.人物档案 ?? {})) {
      const previous = before.人物档案?.[id];
      const live = npc?.物品栏;
      // 刚建档的 NPC：随身物品是人物设定的一部分，原样接受。
      if (!previous || !isRecord(live) || sameKeys(live, previous.物品栏)) continue;
      const rejected = rejectNewOverflow(live, previous.物品栏, INVENTORY_RULES.npc, inventoryEntries(npc.物品列表, true));
      if (!rejected.length) continue;
      const layout = npcInventoryLayout(npc);
      context.note(`${npc.姓名 || id}的行囊已满（${formatCapacity(layout)}），${names(rejected)}没能收下。`, 'fact');
      for (const item of rejected) context.emit('inventory.full', { owner: id, item, capacity: layout.capacity });
    }
  },
  summarize: (state, _context, audience) => {
    const layout = playerInventoryLayout(state.玩家?.物品栏);
    const player = `行囊 ${formatCapacity(layout)}${bagsText(layout)}${stateText(layout)}`;
    if (audience !== 'extraction') return player;
    const present = Object.entries(state.人物档案 ?? {})
      .filter(([, npc]) => npc?.人物分类 === '在场')
      .map(([id, npc]) => {
        const npcLayout = npcInventoryLayout(npc);
        return `${npc.姓名 || id} ${formatCapacity(npcLayout)}${stateText(npcLayout)}`;
      });
    return [
      `${player}。每种物品占 1 格，同名物品叠放不占新格；穿在身上的装备、正在使用的背包不占格。`,
      `行囊满了新物品放不进来：不要 set 新物品，正文里应当让主角先丢弃、交出或放下别的东西；硬写进去的会被系统退回。`,
      `背包类物品（类型写「背包」，可写 扩容: 格数，缺省按品质 4~12 格）会自动扩充行囊，主角最多同时用 ${INVENTORY_RULES.player.bagSlots} 个，NPC ${INVENTORY_RULES.npc.bagSlots} 个；丢失背包会让行囊变小。`,
      present.length ? `在场人物的行囊（随身 ${INVENTORY_RULES.npc.base} 格起）：${present.join('；')}。` : '',
    ].filter(Boolean).join('\n');
  },
};

/** 界面用：玩家与某个 NPC 的行囊格局。 */
export function playerInventoryView(state: GameState): InventoryLayout {
  return playerInventoryLayout(state.玩家?.物品栏);
}

export function npcInventoryView(npc: unknown): InventoryLayout {
  return npcInventoryLayout(npc);
}

export { inventoryLayout };
