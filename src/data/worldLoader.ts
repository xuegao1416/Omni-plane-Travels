// 世界数据加载器 —— 从 worlds.json 加载内置世界定义
import type { WorldDef, WorldBookEntryDef, WorldModule } from './worlds-schema';
import { BUILTIN_WORLD_MAPS } from './worldMaps';
import { STORAGE_KEYS } from '../config/storageKeys';
import { safeSetItem } from '../storage/safeStorage';
import { normalizeModules } from '../modules/normalizeModule';

// ── 从 worlds.json 导入内置世界定义 ──
import worldsData from './worlds.json';

export type {
  WorldDef, FactionDef, PresetNPCDef,
  // ── v2.0 通用框架类型 ──
  StatDef, ProgressionDef, ConflictDef,
  ResourceDef, ResourceManagementDef,
  RelationType, RelationshipDef,
  WorldEventDef, PlaystyleGuideDef, NarrativeStyleDef,
  WorldBookEntryDef,
} from './worlds-schema';

function builtinMapModule(worldId: string): WorldModule | undefined {
  const entry = BUILTIN_WORLD_MAPS[worldId];
  if (!entry) return undefined;
  return { moduleId: 'map', name: '世界地图', description: entry.description, enabled: true, moduleConfig: entry.build() as unknown as Record<string, unknown> };
}

/** 全部内置世界定义（从 worlds.json 加载；地图来自 worldMaps/） */
export const WORLDS: WorldDef[] = (worldsData as WorldDef[]).map(world => {
  const modules = world.modules ? normalizeModules(world.modules) : undefined;
  const map = builtinMapModule(world.id);
  if (!map) return { ...world, ...(modules ? { modules } : {}) };
  return { ...world, modules: [...(modules ?? []).filter(module => module.moduleId !== 'map'), map] };
});

const BUILTIN_BY_ID = new Map(WORLDS.map(world => [world.id, world] as const));

export function isBuiltinWorldId(id: string | undefined): boolean {
  return Boolean(id && BUILTIN_BY_ID.has(id));
}

/**
 * 内置世界的副本（存档里的世界快照、改过职业绑定或世界书后存下的副本）跟上内置定义的更新：
 * 地图总是换成内置的最新版（内置世界的地图在界面里改不了），副本里没有的内置模块补上。
 * 不是内置 id 的世界原样返回。
 */
export function withBuiltinUpdates<T extends WorldDef | undefined>(world: T): T {
  if (!world) return world;
  const builtin = BUILTIN_BY_ID.get(world.id);
  if (!builtin?.modules?.length || builtin === world) return world;
  const own = world.modules ?? [];
  const builtinMap = builtin.modules.find(module => module.moduleId === 'map');
  let changed = false;
  const modules = own.map(module => {
    if (module.moduleId !== 'map' || !builtinMap || module.moduleConfig === builtinMap.moduleConfig) return module;
    changed = true;
    return { ...builtinMap, enabled: module.enabled !== false };
  });
  const ids = new Set(own.map(module => module.moduleId));
  for (const module of builtin.modules) {
    if (ids.has(module.moduleId)) continue;
    modules.push(module);
    changed = true;
  }
  return (changed ? { ...world, modules } : world) as T;
}

/** 写进 localStorage 前去掉内置副本里的地图数据（读出来时由 withBuiltinUpdates 换回最新版），免得每份副本都存一整张地图。 */
export function compactBuiltinCopy<T extends WorldDef | Record<string, unknown>>(world: T): T {
  const id = (world as { id?: unknown }).id;
  const modules = (world as { modules?: unknown }).modules;
  if (typeof id !== 'string' || !BUILTIN_BY_ID.has(id) || !Array.isArray(modules)) return world;
  if (!modules.some(module => module && (module as WorldModule).moduleId === 'map' && (module as WorldModule).moduleConfig)) return world;
  return {
    ...world,
    modules: modules.map(module => module && (module as WorldModule).moduleId === 'map'
      ? (({ moduleConfig: _drop, ...rest }) => rest)(module as WorldModule)
      : module),
  } as T;
}

/** 按 id 查找世界（仅内置） */
export function getWorldById(id: string): WorldDef | undefined {
  return WORLDS.find(w => w.id === id);
}

/** 获取所有世界（自建 + 内置，自建在前，去重） */
export function getAllWorlds(): WorldDef[] {
  const customs: WorldDef[] = [];
  try {
    const raw: WorldDef[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
    for (const w of raw) {
      if (w.modules) w.modules = normalizeModules(w.modules);
      customs.push(withBuiltinUpdates(w));
    }
  } catch { /* ignore */ }
  const builtin = WORLDS.filter(w => !customs.some(c => c.id === w.id));
  return [...customs, ...builtin];
}

/** 按 id 查找世界（自建优先 + 内置兜底） */
export function findWorldDef(worldId: string): WorldDef | undefined {
  // 先查 localStorage 中的自建/修改世界（优先级最高，确保修改后的内置世界不被原版覆盖）
  try {
    const custom: WorldDef[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
    const found = custom.find((w: WorldDef) => w.id === worldId);
    if (found) {
      if (found.modules) found.modules = normalizeModules(found.modules);
      return withBuiltinUpdates(found);
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

// ── 世界草稿（fork 场景）────────────────────────────────────────────

export interface WorldDraft extends WorldDef {
  isDraft: true;
  forkedFrom: string;       // 派生来源内置世界 id
  draftName: string;        // 展示用草稿名，如 "日式校园 - 草稿 1"
  draftCreatedAt: number;   // 创建时间戳
  draftUpdatedAt: number;   // 最后更新时间戳
}

/** 深拷贝一个世界，生成草稿副本（新 id，标记 isDraft） */
export function forkWorld(world: WorldDef, draftName: string): WorldDraft {
  const now = Date.now();
  // 生成唯一草稿 id
  const base = `${world.id}_fork_${now}`;
  const forked: WorldDef = JSON.parse(JSON.stringify(world));
  forked.id = base;
  return {
    ...forked,
    isDraft: true,
    forkedFrom: world.id,
    draftName,
    draftCreatedAt: now,
    draftUpdatedAt: now,
  } as WorldDraft;
}

/** 保存草稿到 localStorage（覆盖同名草稿，或新增） */
export function saveWorldDraft(draft: WorldDraft): void {
  const drafts = listWorldDrafts();
  const idx = drafts.findIndex(d => d.id === draft.id);
  if (idx >= 0) drafts[idx] = draft;
  else drafts.push(draft);
  safeSetItem(STORAGE_KEYS.WORLD_DRAFTS, JSON.stringify(drafts));
}

/** 列出所有草稿 */
export function listWorldDrafts(): WorldDraft[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.WORLD_DRAFTS) || '[]');
  } catch { return []; }
}

/** 删除草稿 */
export function deleteWorldDraft(draftId: string): void {
  const drafts = listWorldDrafts().filter(d => d.id !== draftId);
  safeSetItem(STORAGE_KEYS.WORLD_DRAFTS, JSON.stringify(drafts));
}

/** 将草稿正式保存为自定义世界（从草稿移除，写入 CUSTOM_WORLDS） */
export function promoteDraftToCustomWorld(draft: WorldDraft): WorldDef {
  const world: WorldDef = { ...draft };
  delete (world as any).isDraft;
  delete (world as any).forkedFrom;
  delete (world as any).draftName;
  delete (world as any).draftCreatedAt;
  delete (world as any).draftUpdatedAt;
  const customs = getCustomWorlds();
  const idx = customs.findIndex(w => w.id === world.id);
  if (idx >= 0) customs[idx] = world;
  else customs.push(world);
  safeSetItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify(customs));
  deleteWorldDraft(draft.id);
  return world;
}

/** 获取当前 CUSTOM_WORLDS 列表（不含草稿） */
function getCustomWorlds(): WorldDef[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
  } catch { return []; }
}
