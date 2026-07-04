// IndexedDB 存储层
import { openDB, type IDBPDatabase } from 'idb';
import type { ChatMessage } from '../engine/types';
import type { GameState } from '../schema/variables';
import { STORAGE_KEYS } from '@/config/storageKeys';
import { slimMemoryRuntimeForSave } from '@/memory/memoryStore';
import type { SimulationState } from '@/simulation/types';

// ─── 类型定义 ─────────────────────────────────────────

/** 自建NPC（向导阶段玩家创建，注入到初始人物档案） */
interface CustomNpc {
  id: string;
  // 基础信息
  name: string;
  gender: string;
  age: string;
  race: string;
  relationshipType: string;
  // 社会身份
  occupation: string;
  socialStatus: string;
  // 性格与内在
  personality: string;
  hiddenPersonality: string;
  currentThought: string;
  // 外在
  appearance: string;
  currentOutfit: string;
  // 状态
  currentAction: string;
  currentLocation: string;
  currentState: string;
  // 目标
  shortTermGoal: string;
  longTermGoal: string;
  // 其他
  background: string;
  chronicles: string[];
  skillsList: Record<string, { 描述: string; 类型: string; 品质: string }>;
  itemsList: Record<string, { 数量: number; 类型: string; 品质: string; 备注: string }>;
  // 属性（当世界启用数值属性模块时填充）
  attrs?: Record<string, number>;
  // 段位索引（当世界启用成长体系模块时填充）
  tierIndex?: number;
}

interface PlayerProfile {
  // 基础信息
  name: string;
  gender: string;
  age: string;
  background: string;
  personality: string;  // 性格
  appearance: string;   // 外貌

  // 身份信息 → PlayerState.身份信息
  career: string;
  socialClass: string;
  organization: string;
  specialIdentity: string;

  // 叙事视角
  perspective: '第一人称' | '第二人称' | '第三人称';

  // 初始技能 → PlayerState.技能系统
  initialSkills: Record<string, {
    品质: '普通' | '精良' | '稀有' | '史诗' | '传说';
    描述: string;
    类型: string;
  }>;

  // 初始物品 → PlayerState.物品栏
  initialItems: Record<string, {
    数量: number;
    类型: string;
    品质: '普通' | '精良' | '稀有' | '史诗' | '传说';
    备注: string;
  }>;

  // 自建NPC → GameState.人物档案
  customNpcs: CustomNpc[];

  // 模块初始数据（角色创建时玩家设定的初始属性值）
  moduleInitData?: Record<string, unknown>;
}

/** 完整存档记录（写入 IndexedDB saves store） */
interface GameSave {
  id: string;
  name: string;
  timestamp: number;
  messages: ChatMessage[];
  gameState: GameState;
  worldId: string;
  personalInfo?: PlayerProfile;
  characterHistory?: string;
  /** 记忆系统运行态快照 */
  memoryRuntime?: unknown;
  /** 记忆系统配置 */
  memoryConfig?: unknown;
  /** 向量记忆数据 */
  vectorMemory?: unknown[];
  /** 变量提取 API 配置（per-save） */
  variableConfig?: { apiPresetId?: string };
  /** 自建世界完整定义（仅自建世界时保存，确保导出可移植） */
  customWorld?: Record<string, unknown>;
  /** 世界推演模拟状态（每个存档独立，解决串存档问题） */
  simulationState?: SimulationState;
}

/** 轻量元数据（写入 global store，运行时缓存用于列表展示） */
interface SaveMeta {
  id: string;
  name: string;
  timestamp: number;
  preview: string;
}

// ─── DB 常量 ──────────────────────────────────────────

const DB_NAME = 'omni-plane-travels';
const DB_VERSION = 3;
const SAVES_STORE = 'saves';
const GLOBAL_STORE = 'global';

/** localStorage key：当前活跃存档 ID（F5 恢复用） */
export const ACTIVE_SAVE_KEY = STORAGE_KEYS.ACTIVE_SAVE;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(SAVES_STORE)) {
          const store = db.createObjectStore(SAVES_STORE, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains(GLOBAL_STORE)) {
          db.createObjectStore(GLOBAL_STORE, { keyPath: 'key' });
        }
      },
    });
  }

  return dbPromise;
}

// ─── Global store（键值对，存元数据列表等） ─────────────

async function getGlobal<T = any>(key: string): Promise<T | undefined> {
  const db = await getDB();
  const record = await db.get(GLOBAL_STORE, key);
  return record?.value as T | undefined;
}

async function putGlobal(key: string, value: any): Promise<void> {
  const db = await getDB();
  await db.put(GLOBAL_STORE, { key, value });
}

// ─── 存档元数据管理 ─────────────────────────────────

let cachedSaveMeta: SaveMeta[] | null = null;

/** 读取所有存档元数据（轻量，不加载完整存档） */
export async function getAllSaveMeta(): Promise<SaveMeta[]> {
  if (cachedSaveMeta) {
    // 重新计算预览文本（修复世界 ID 显示问题）
    return cachedSaveMeta.map(meta => ({
      ...meta,
      preview: rebuildPreview(meta),
    }));
  }
  const metas = await getGlobal<SaveMeta[]>('saves');
  cachedSaveMeta = metas || [];
  // 重新计算预览文本
  return cachedSaveMeta.map(meta => ({
    ...meta,
    preview: rebuildPreview(meta),
  }));
}

/** 重新构建预览文本（从 SaveMeta 中提取信息） */
function rebuildPreview(meta: SaveMeta): string {
  // 如果预览文本已经包含中文世界名，直接返回
  if (meta.preview && !meta.preview.includes('custom_') && !meta.preview.includes('_')) {
    return meta.preview;
  }

  // 尝试从预览文本中提取角色名
  const parts = meta.preview?.split(' · ') || [];
  const characterName = parts[0] || '';

  // 尝试从存档名中提取世界名（格式：角色名 - 世界名）
  const nameParts = meta.name?.split(' - ') || [];
  const worldNameFromName = nameParts.length > 1 ? nameParts[1] : '';

  if (characterName && worldNameFromName) {
    return `${characterName} · ${worldNameFromName}`;
  }

  // 如果都提取不到，返回原始预览文本
  return meta.preview || '世界漫游';
}

/** 持久化存档元数据列表 */
export async function saveAllSaveMeta(metas: SaveMeta[]): Promise<void> {
  cachedSaveMeta = metas;
  await putGlobal('saves', metas);
}

/** 使缓存失效（导入/删除后调用） */
export function invalidateSaveMetaCache(): void {
  cachedSaveMeta = null;
}

// ─── 存档 CRUD ────────────────────────────────────────

/** 保存完整存档（写入 saves store） */
export async function saveGame(save: GameSave): Promise<void> {
  try {
    // 存档大小防护：超阈值时告警（不阻断保存，避免丢数据）
    const estimatedSize = JSON.stringify(save).length;
    if (estimatedSize > 50 * 1024 * 1024) {
      console.warn(`[DB] 存档大小 ${(estimatedSize / 1024 / 1024).toFixed(1)}MB 超过 50MB 阈值，可能导致加载缓慢或崩溃`);
    }
    const db = await getDB();
    await db.put(SAVES_STORE, save);
  } catch (err) {
    console.error('[DB] 保存失败:', err);
    throw new Error('存档保存失败，可能是浏览器存储空间不足或处于隐私模式');
  }
}

/** 加载完整存档 */
export async function loadGame(id: string): Promise<GameSave | undefined> {
  try {
    const db = await getDB();
    return db.get(SAVES_STORE, id);
  } catch (err) {
    console.error('[DB] 加载失败:', err);
    throw new Error('存档加载失败');
  }
}

/** 删除存档 */
export async function deleteSave(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(SAVES_STORE, id);
    console.log(`[DB] 存档 ${id} 已删除`);
  } catch (err) {
    console.error('[DB] 删除失败:', err);
    throw new Error('存档删除失败');
  }
}

/** 强制删除存档（不读取数据，直接按 key 删除，用于处理损坏/膨胀存档） */
export async function forceDeleteSave(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(SAVES_STORE, id);
    // 同时清理元数据中的对应条目
    const metas = await getAllSaveMeta();
    const filtered = metas.filter(s => s.id !== id);
    await saveAllSaveMeta(filtered);
    // 清理 localStorage 活跃存档引用
    if (localStorage.getItem(ACTIVE_SAVE_KEY) === id) {
      localStorage.removeItem(ACTIVE_SAVE_KEY);
    }
    console.log(`[DB] 强制删除存档 ${id} 完成`);
  } catch (err) {
    console.error('[DB] 强制删除失败:', err);
    throw new Error('强制删除失败');
  }
}

/** 生成存档 ID */
export function generateSaveId(): string {
  return `save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── 快照优化 ─────────────────────────────────────

/**
 * 保存前瘦身消息快照：
 * 1. 始终保留第一条消息的快照（兜底）
 * 2. 始终保留最后 10 条消息的快照（高频悔棋/重发）
 * 3. 更早的消息每隔 10 条保留一个关键帧快照
 */
export function optimizeSnapshots(messages: ChatMessage[]): ChatMessage[] {
  if (!messages || messages.length === 0) return messages;

  const total = messages.length;
  let firstSnapshotFound = false;

  return messages.map((msg, i) => {
    if (!msg.snapshot) return msg;

    // 始终保留第一条有 snapshot 的消息
    if (!firstSnapshotFound) {
      firstSnapshotFound = true;
      return msg;
    }

    const isRecent = i >= total - 10;
    const isKeyframe = i % 10 === 0;

    if (!isRecent && !isKeyframe) {
      // 清除冗余快照，释放内存
      const { snapshot, snapshotTime, ...rest } = msg;
      return rest as ChatMessage;
    }

    return msg;
  });
}

// ─── 导出/导入 ────────────────────────────────────────

/** 导出存档为 JSON Blob（不包含 API 配置，API 是应用级设置） */
export async function exportSave(saveId: string): Promise<Blob> {
  const save = await loadGame(saveId);
  if (!save) throw new Error('存档不存在');

  const exportData = {
    type: 'omni-plane-travels-save',
    version: '2.0',
    exportedAt: Date.now(),
    save: {
      id: save.id,
      name: save.name,
      timestamp: save.timestamp,
      messages: save.messages,
      gameState: save.gameState,
      worldId: save.worldId,
      personalInfo: save.personalInfo,
      characterHistory: save.characterHistory,
      memoryRuntime: save.memoryRuntime ? slimMemoryRuntimeForSave(save.memoryRuntime) : undefined,
      memoryConfig: save.memoryConfig,
      vectorMemory: save.vectorMemory,
      customWorld: save.customWorld,
      simulationState: save.simulationState,
    },
  };

  return new Blob([JSON.stringify(exportData)], { type: 'application/json' });
}

/** 从文件导入存档，返回新 SaveMeta */
export async function importSaveFromFile(file: File): Promise<SaveMeta> {
  const text = await file.text();
  let rawData: any;
  try {
    rawData = JSON.parse(text);
  } catch {
    throw new Error('文件格式无效，无法解析 JSON');
  }

  return importSaveFromData(rawData);
}

/** 从原始数据导入存档（normalize + 新 ID + 唯一名称） */
export async function importSaveFromData(rawData: any): Promise<SaveMeta> {
  if (!rawData || typeof rawData !== 'object' || !rawData.save) {
    throw new Error('存档数据格式无效');
  }

  const save = rawData.save;
  if (!save.messages && !save.gameState) {
    throw new Error('文件中未找到有效存档数据');
  }

  // 生成新 ID 避免冲突
  const metas = await getAllSaveMeta();
  let finalId = String(save.id || '').trim() || generateSaveId();
  while (metas.some(s => s.id === finalId)) {
    finalId = generateSaveId();
  }

  // 确保名称唯一
  const baseName = String(save.name || '').trim() || '导入存档';
  const finalName = getUniqueImportName(baseName, metas);

  const finalTimestamp = Number(save.timestamp) || Date.now();

  const saveData: GameSave = {
    id: finalId,
    name: finalName,
    timestamp: finalTimestamp,
    messages: Array.isArray(save.messages) ? save.messages : [],
    gameState: save.gameState || {},
    worldId: save.worldId || 'default',
    personalInfo: save.personalInfo || undefined,
    characterHistory: save.characterHistory || undefined,
    memoryRuntime: save.memoryRuntime || undefined,
    memoryConfig: save.memoryConfig || undefined,
    vectorMemory: Array.isArray(save.vectorMemory) ? save.vectorMemory : undefined,
    variableConfig: save.variableConfig || undefined,
    customWorld: save.customWorld || undefined,
    simulationState: save.simulationState || undefined,
  };

  // 如果导入的存档包含自建世界，注册到 localStorage 以便 findWorldDef 能找到
  if (saveData.customWorld && saveData.worldId) {
    try {
      const existing: Record<string, unknown>[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
      if (!existing.some((w: any) => w?.id === saveData.worldId)) {
        existing.push(saveData.customWorld);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify(existing));
      }
    } catch { /* localStorage 不可用时静默失败 */ }
  }

  await saveGame(saveData);

  const meta: SaveMeta = {
    id: finalId,
    name: finalName,
    timestamp: finalTimestamp,
    preview: buildPreview(saveData),
  };

  const updated = [...metas, meta];
  await saveAllSaveMeta(updated);

  return meta;
}

/** 确保导入的存档名称不重复 */
function getUniqueImportName(baseName: string, metas: SaveMeta[]): string {
  if (!metas.some(s => s.name === baseName)) return baseName;

  let index = 1;
  let candidate = `${baseName}（导入）`;
  while (metas.some(s => s.name === candidate)) {
    index++;
    candidate = `${baseName}（导入${index}）`;
  }
  return candidate;
}

/** 构建预览文本 */
export function buildPreview(save: GameSave): string {
  const parts: string[] = [];
  if (save.personalInfo?.name) parts.push(save.personalInfo.name);
  // 优先使用世界名，如果没有则使用世界 ID
  if (save.worldId && save.worldId !== 'default') {
    const worldName = getWorldNameById(save.worldId);
    parts.push(worldName);
  }
  return parts.join(' · ') || '世界漫游';
}

/** 根据世界 ID 获取世界名（支持内置世界和自建世界） */
function getWorldNameById(worldId: string): string {
  // 内置世界 ID → 中文名映射
  const BUILTIN_WORLD_NAMES: Record<string, string> = {
    cyberpunk_city: '赛博朋克',
    desire_metropolis: '欲望都市',
    wasteland_apocalypse: '废土末日',
    japanese_school: '日系校园',
    crystal_world: '绯晶之乡',
    wuxia_world: '武侠江湖',
    palace_intrigue: '宫斗权谋',
  };

  // 先检查内置世界
  if (BUILTIN_WORLD_NAMES[worldId]) {
    return BUILTIN_WORLD_NAMES[worldId];
  }

  // 再检查自建世界
  try {
    const createdWorlds = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
    const world = createdWorlds.find((w: any) => w.id === worldId);
    if (world?.name) {
      return world.name;
    }
  } catch {
    // 忽略解析错误
  }

  // 都找不到，返回原始 ID
  return worldId;
}

export type { GameSave, PlayerProfile, CustomNpc, SaveMeta };
