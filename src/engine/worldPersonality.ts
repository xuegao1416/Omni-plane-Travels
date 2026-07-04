import { type WorldBookManager, createWorldBookManager, parseWorldBook, convertWorldBookDefsToEntries } from '../worldbook/index';
import { WORLDS, findWorldDef } from '../data/worldLoader';
import type { WorldDef } from '../data/worlds-schema';

export async function loadWorldBook(): Promise<WorldBookManager> {
  try {
    const resp = await fetch('/card.json');
    if (resp.ok) {
      const cardData = await resp.json();
      return createWorldBookManager(parseWorldBook(cardData));
    }
  } catch { /* fall through */ }
  // 没有 card.json 时返回空管理器，applyWorld() 会注入世界专属条目
  return createWorldBookManager([]);
}

/**
 * 将世界专属条目应用到世界书管理器
 * - 禁用所有 [WB] 前缀的条目（card.json 中的通用条目）
 * - 如果世界有 entryId，启用该条目（旧模式兼容）
 * - 如果世界有 worldBookEntries，将它们添加到管理器（v2.0 新模式）
 */
export function applyWorld(wb: WorldBookManager, worldId: string) {
  // 先清除上一轮的世界专属条目（负 ID），避免切换世界时旧条目残留
  wb.clearWorldEntries();
  wb.disableEntriesByPrefix('[WB]');

  if (worldId !== 'default') {
    // 使用 findWorldDef 同时涵盖内置 + localStorage 自建/外部世界
    const world = findWorldDef(worldId);

    // 旧模式兼容：通过 entryId 启用
    if (world?.entryId != null) {
      wb.enableEntry(world.entryId);
    }

    // v2.0 新模式：加载嵌入式世界书条目（内置 + 自建 + 外部导入均支持）
    const worldBookEntries = world?.worldBookEntries ?? [];
    if (worldBookEntries.length > 0) {
      wb.addEntries(convertWorldBookDefsToEntries(worldBookEntries));
    }
  }
}
