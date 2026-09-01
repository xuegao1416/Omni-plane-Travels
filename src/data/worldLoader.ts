// 世界数据加载器 —— 从 worlds.json 加载内置世界定义
import type { WorldDef, WorldBookEntryDef } from './worlds-schema';
import { STORAGE_KEYS } from '../config/storageKeys';
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

/** 全部内置世界定义（从 worlds.json 加载） */
export const WORLDS: WorldDef[] = worldsData as WorldDef[];

// The original wuxia payload modelled weapon arts and life arts as one flat
// talent list. Keep worlds.json import-compatible, but expose the corrected
// profession domain to all runtime consumers.
const wuxiaWorld = WORLDS.find(world => world.id === 'wuxia_world');
if (wuxiaWorld?.modules) {
  wuxiaWorld.modules = wuxiaWorld.modules.map(module => module.moduleId === 'talent' ? {
    moduleId: 'profession',
    name: '职业体系',
    description: '引用江湖武学职业典藏；职业树与世界正文分离维护。',
    enabled: module.enabled,
    moduleConfig: { packIds: ['wuxia-core'], professionsEnabled: true },
  } : module);
  const legacyTalentEntry = wuxiaWorld.worldBookEntries?.find(entry => entry.comment.includes('天赋体系'));
  if (legacyTalentEntry) {
    legacyTalentEntry.comment = '[模块] 职业体系 - 叙事规则';
    legacyTalentEntry.key = ['职业', '剑客', '刀客', '枪客', '拳师', '能力', '天赋', '医术', '琴艺'];
    legacyTalentEntry.content = `【职业体系】
- 当前职业决定可成长的职业能力树；不得把其他职业能力写入玩家状态。
- 先天天赋在角色创建时确定，游戏内不得通过技能点购买。
- 剧情中获得的特殊禀赋记录为后天天赋，与先天天赋分开。
- 医术、琴艺、书法、绘画、茶道、卜算属于自由生活技能，不是职业树节点。
- 具体已选职业、已解锁能力与相关天赋由本轮动态模块上下文提供。`;
  }
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
      customs.push(w);
    }
  } catch { /* ignore */ }
  const builtinIds = new Set(WORLDS.map(w => w.id));
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
  // 清除 entryId避免冲突
  forked.entryId = null;
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
  localStorage.setItem(STORAGE_KEYS.WORLD_DRAFTS, JSON.stringify(drafts));
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
  localStorage.setItem(STORAGE_KEYS.WORLD_DRAFTS, JSON.stringify(drafts));
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
  localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify(customs));
  deleteWorldDraft(draft.id);
  return world;
}

/** 获取当前 CUSTOM_WORLDS 列表（不含草稿） */
function getCustomWorlds(): WorldDef[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
  } catch { return []; }
}
