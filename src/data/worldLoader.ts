// 世界数据加载器 —— 从 worlds/ 目录逐个加载，同时重新导出类型
import type { WorldDef, WorldBookEntryDef } from './worlds-schema';
import { STORAGE_KEYS } from '../config/storageKeys';
import { normalizeModules } from '../modules/normalizeModule';

// ── 逐个导入世界 JSON（Bun 会内联打包） ──
import desireMetropolis from './worlds/desire_metropolis.json';
import wastelandApocalypse from './worlds/wasteland_apocalypse.json';
import japaneseSchool from './worlds/japanese_school.json';
import wuxiaWorld from './worlds/wuxia_world.json';
import strandedIsland from './worlds/stranded_island.json';
import borderTrade from './worlds/border_trade.json';

export type {
  WorldDef, FactionDef, PresetNPCDef,
  // ── v2.0 通用框架类型 ──
  StatDef, ProgressionDef, ConflictDef,
  ResourceDef, ResourceManagementDef,
  RelationType, RelationshipDef,
  WorldEventDef, PlaystyleGuideDef, NarrativeStyleDef,
  WorldBookEntryDef,
} from './worlds-schema';

/** 全部世界定义（从分拆文件加载） */
export const WORLDS: WorldDef[] = [
  ...(japaneseSchool as unknown as WorldDef[]),
  ...(desireMetropolis as unknown as WorldDef[]),
  ...(wuxiaWorld as unknown as WorldDef[]),
  ...(wastelandApocalypse as unknown as WorldDef[]),
  ...(strandedIsland as unknown as WorldDef[]),
  ...(borderTrade as unknown as WorldDef[]),
];

/** 按 id 查找世界（仅内置） */
export function getWorldById(id: string): WorldDef | undefined {
  return WORLDS.find(w => w.id === id);
}

/** 按 id 查找世界（自建优先 + 内置兜底） */
export function findWorldDef(worldId: string): WorldDef | undefined {
  // 先查 localStorage 中的自建/修改世界（优先级最高，确保修改后的内置世界不被原版覆盖）
  try {
    const custom: WorldDef[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
    const found = custom.find((w: WorldDef) => w.id === worldId);
    if (found) {
      if (found.modules) found.modules = normalizeModules(found.modules);
      return found;
    }
  } catch { /* ignore */ }
  // 兜底：内置世界
  return WORLDS.find(w => w.id === worldId);
}

/** 获取指定世界的嵌入式世界书条目（自建世界优先，内置兜底） */
export function getWorldBookEntriesForWorld(worldId: string): WorldBookEntryDef[] {
  const world = findWorldDef(worldId);
  return world?.worldBookEntries ?? [];
}
