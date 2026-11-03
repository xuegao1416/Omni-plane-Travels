import { type WorldBookManager, createWorldBookManager, convertWorldBookDefsToEntries } from '../worldbook/index';
import { findWorldDef } from '../data/worldLoader';

export async function loadWorldBook(): Promise<WorldBookManager> {
  // 世界书已统一存放在 WorldDef.worldBookEntries；管理器从空状态创建，
  // 随后由 applyWorld() 注入当前世界条目。
  return createWorldBookManager([]);
}

/**
 * 将世界专属条目应用到世界书管理器
 * - 世界叙事条目统一从 WorldDef.worldBookEntries 注入
 */
export function applyWorld(wb: WorldBookManager, worldId: string) {
  // 先清除上一轮的世界专属条目（负 ID），避免切换世界时旧条目残留
  wb.clearWorldEntries();

  if (worldId !== 'default') {
    // 使用 findWorldDef 同时涵盖内置 + localStorage 自建/外部世界
    const world = findWorldDef(worldId);

    // 加载嵌入式世界书条目（内置 + 自建 + 外部导入均支持）
    const worldBookEntries = world?.worldBookEntries ?? [];
    if (worldBookEntries.length > 0) {
      wb.addEntries(convertWorldBookDefsToEntries(worldBookEntries));
    }
  }
}
