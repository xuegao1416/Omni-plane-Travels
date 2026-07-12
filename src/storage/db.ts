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
  // 生存状态/属性（当世界启用数值属性模块时填充）
  // 结构与玩家 SurvivalStats 一致：血量/体力值 + dim1~dim6
  survivalStats?: Record<string, number>;
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
export interface SaveMeta {
  id: string;
  name: string;
  timestamp: number;
  preview: string;
  /** 预估存档大小（字节），用于配额预警 */
  estBytes?: number;
  /** 消息数量 */
  messageCount?: number;
}

// ─── DB 常量 ──────────────────────────────────────────

const DB_NAME = 'omni-plane-travels';
const DB_VERSION = 4;  // v4: 消息分片存储
const SAVES_STORE = 'saves';
const GLOBAL_STORE = 'global';
const MESSAGES_STORE = 'messages';  // 新增：消息分片 store

/** localStorage key：当前活跃存档 ID（F5 恢复用） */
export const ACTIVE_SAVE_KEY = STORAGE_KEYS.ACTIVE_SAVE;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, newVersion, transaction) {
        // v1-v3: 原有 store
        if (!db.objectStoreNames.contains(SAVES_STORE)) {
          const store = db.createObjectStore(SAVES_STORE, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains(GLOBAL_STORE)) {
          db.createObjectStore(GLOBAL_STORE, { keyPath: 'key' });
        }

        // v4: 新增 messages 分片 store
        if (oldVersion < 4) {
          const msgStore = db.createObjectStore(MESSAGES_STORE, { keyPath: 'key' });
          msgStore.createIndex('saveId', 'saveId');
          msgStore.createIndex('saveId_seq', ['saveId', 'seq']);
        }
      },
    });
  }

  return dbPromise;
}

// ─── 消息分片类型 ─────────────────────────────────────

/** 消息分片记录（写入 messages store） */
export interface MessageRecord {
  /** 复合 key: `${saveId}#${seq}` */
  key: string;
  /** 所属存档 ID */
  saveId: string;
  /** 消息序号（单调递增） */
  seq: number;
  /** 完整消息 */
  message: ChatMessage;
}

// ─── 消息分片操作 ─────────────────────────────────────

/** 获取指定存档的最后一条消息的 seq */
export async function getLastMessageSeq(saveId: string): Promise<number> {
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.store.index('saveId_seq');

  // 使用 IDBKeyRange 获取该 saveId 的最后一条记录
  const range = IDBKeyRange.bound(
    [saveId, 0],
    [saveId, Number.MAX_SAFE_INTEGER],
  );

  let lastSeq = -1;
  let cursor = await index.openCursor(range, 'prev');
  if (cursor) {
    lastSeq = cursor.value.seq;
  }

  return lastSeq;
}

/** 获取指定存档的最近 N 条消息 */
export async function getRecentMessages(saveId: string, count: number): Promise<ChatMessage[]> {
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.store.index('saveId_seq');

  // 先获取最后一条的 seq
  const lastSeq = await getLastMessageSeq(saveId);
  if (lastSeq < 0) return [];

  // 计算起始 seq
  const startSeq = Math.max(0, lastSeq - count + 1);
  const range = IDBKeyRange.bound(
    [saveId, startSeq],
    [saveId, lastSeq],
  );

  const messages: ChatMessage[] = [];
  let cursor = await index.openCursor(range, 'prev');
  while (cursor) {
    messages.unshift(cursor.value.message);
    cursor = await cursor.continue();
  }

  return messages;
}

/** 获取指定存档的指定 seq 范围的消息 */
export async function getMessageRange(saveId: string, startSeq: number, endSeq: number): Promise<ChatMessage[]> {
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.store.index('saveId_seq');

  const range = IDBKeyRange.bound(
    [saveId, startSeq],
    [saveId, endSeq],
  );

  const messages: ChatMessage[] = [];
  let cursor = await index.openCursor(range, 'next');
  while (cursor) {
    messages.push(cursor.value.message);
    cursor = await cursor.continue();
  }

  return messages;
}

/** 增量写入消息（批量 put，幂等：key 含 seq） */
export async function putMessages(saveId: string, messages: ChatMessage[], startSeq: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');

  for (let i = 0; i < messages.length; i++) {
    const seq = startSeq + i;
    const record: MessageRecord = {
      key: `${saveId}#${seq}`,
      saveId,
      seq,
      message: messages[i],
    };
    await tx.store.put(record);
  }

  await tx.done;
}

/**
 * 直接更新 saves store 中头部记录的指定字段
 * 不涉及 messages，用于 rename 等轻量操作
 */
export async function updateSaveHead(saveId: string, patch: { name?: string; timestamp?: number }): Promise<void> {
  const db = await getDB();
  const record = await db.get(SAVES_STORE, saveId);
  if (!record) return;

  if (patch.name !== undefined) record.name = patch.name;
  if (patch.timestamp !== undefined) record.timestamp = patch.timestamp;

  await db.put(SAVES_STORE, record);
}

/** 删除指定存档的所有消息 */
export async function deleteMessages(saveId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');
  const index = tx.store.index('saveId');

  let cursor = await index.openCursor(IDBKeyRange.only(saveId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}

/**
 * 删除指定存档中 seq > maxSeq 的消息（用于重roll后清理被截断的旧消息）
 */
export async function deleteMessagesAboveSeq(saveId: string, maxSeq: number): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');
  const index = tx.store.index('saveId_seq');

  // 只遍历 seq > maxSeq 的记录
  const range = IDBKeyRange.bound(
    [saveId, maxSeq + 1],
    [saveId, Number.MAX_SAFE_INTEGER],
  );

  let cursor = await index.openCursor(range);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }

  await tx.done;
}

// ─── 配额管理 ─────────────────────────────────────────

/** 配额检查结果 */
export interface QuotaInfo {
  /** 是否接近配额上限（剩余 < 10%） */
  isNearQuota: boolean;
  /** 已使用字节数 */
  usage: number;
  /** 配额上限字节数 */
  quota: number;
  /** 使用百分比 */
  usagePercent: number;
}

/**
 * 检查 IndexedDB 配额使用情况
 * 使用 navigator.storage.estimate() API
 */
export async function checkQuota(): Promise<QuotaInfo> {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      const usagePercent = quota > 0 ? (usage / quota) * 100 : 0;

      return {
        isNearQuota: usagePercent > 90, // 剩余 < 10% 时告警
        usage,
        quota,
        usagePercent,
      };
    }
  } catch (err) {
    console.warn('[配额] 无法获取配额信息:', err);
  }

  // 无法获取配额信息时，返回安全默认值
  return { isNearQuota: false, usage: 0, quota: 0, usagePercent: 0 };
}

/**
 * 清理最旧的冷消息（配额不足时调用）
 *
 * 策略：
 * - 保留最近 keepRecent 条消息
 * - 保留关键 keyframe（每 10 条保留 1 条）
 * - 删除其余冷消息
 *
 * @param saveId 存档 ID
 * @param keepRecent 保留最近 N 条（默认 200）
 * @returns 删除的消息数量
 */
export async function pruneColdMessages(saveId: string, keepRecent: number = 200): Promise<number> {
  const db = await getDB();

  // 获取该存档的最后 seq
  const lastSeq = await getLastMessageSeq(saveId);
  if (lastSeq < keepRecent) return 0; // 消息太少，不需要清理

  // 计算需要保留的 seq 范围
  const keepFromSeq = lastSeq - keepRecent + 1;

  // 收集需要删除的 seq（排除 keyframe）
  const toDelete: number[] = [];
  for (let seq = 0; seq < keepFromSeq; seq++) {
    // 关键 keyframe：每 10 条保留 1 条
    if (seq % 10 === 0) continue;
    toDelete.push(seq);
  }

  if (toDelete.length === 0) return 0;

  // 批量删除
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');
  for (const seq of toDelete) {
    const key = `${saveId}#${seq}`;
    await tx.store.delete(key);
  }
  await tx.done;

  console.log(`[配额] 已清理 ${toDelete.length} 条冷消息（保留最近 ${keepRecent} 条 + keyframe）`);
  return toDelete.length;
}

/**
 * 自动配额治理：检查配额，不足时自动清理
 * 应在每次保存前调用
 */
export async function autoPruneIfNeeded(saveId: string): Promise<void> {
  const quotaInfo = await checkQuota();

  if (quotaInfo.isNearQuota) {
    console.warn(`[配额] 配额使用 ${quotaInfo.usagePercent.toFixed(1)}%，开始自动清理...`);
    const deleted = await pruneColdMessages(saveId, 200);
    if (deleted > 0) {
      console.log(`[配额] 自动清理完成，删除了 ${deleted} 条冷消息`);
    }
  }
}

/**
 * 重新迁移存档（修复 seq 缺失问题）
 * 删除旧的 messages 分片，重新从 saves 记录迁移
 */
export async function remigrateSave(saveId: string): Promise<boolean> {
  try {
    const db = await getDB();

    // 1) 删除旧的 messages 分片
    await deleteMessages(saveId);

    // 2) 读取 saves 记录
    const record = await db.get(SAVES_STORE, saveId);
    if (!record) return false;

    // 3) 检查是否有内联的 messages（老格式）
    const oldSave = record as any;
    if (!oldSave.messages || !Array.isArray(oldSave.messages)) {
      console.warn(`[重新迁移] 存档 ${saveId} 没有内联 messages，跳过`);
      return false;
    }

    // 4) 重新迁移（这次会正确分配 seq）
    const messages = oldSave.messages as ChatMessage[];

    // 给消息对象分配 seq 字段
    for (let i = 0; i < messages.length; i++) {
      messages[i].seq = i;
    }

    // 写入 messages 分片
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    for (let i = 0; i < messages.length; i++) {
      const record: MessageRecord = {
        key: `${saveId}#${i}`,
        saveId,
        seq: i,
        message: messages[i],
      };
      await tx.store.put(record);
    }
    await tx.done;

    // 5) 更新 saves 记录为新格式（删除内联 messages）
    const compactHead: CompactSaveRecord = {
      id: oldSave.id,
      name: oldSave.name,
      timestamp: oldSave.timestamp,
      schemaVersion: SAVE_SCHEMA_VERSION,
      round: messages.reduce((max, m) => Math.max(max, m.round), 0),
      gameState: oldSave.gameState,
      worldId: oldSave.worldId,
      personalInfo: oldSave.personalInfo,
      characterHistory: oldSave.characterHistory,
      memoryRuntime: oldSave.memoryRuntime,
      memoryConfig: oldSave.memoryConfig,
      vectorMemory: oldSave.vectorMemory,
      variableConfig: oldSave.variableConfig,
      customWorld: oldSave.customWorld,
      simulationState: oldSave.simulationState,
      messageCount: messages.length,
      lastMessageSeq: messages.length - 1,
    };

    await db.put(SAVES_STORE, compactHead as any);

    console.log(`[重新迁移] 成功重新迁移存档 ${saveId}，共 ${messages.length} 条消息`);
    return true;
  } catch (err) {
    console.error(`[重新迁移] 存档 ${saveId} 重新迁移失败:`, err);
    return false;
  }
}

/** 获取指定存档的全量消息（用于导出） */
export async function getAllMessages(saveId: string): Promise<ChatMessage[]> {
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.store.index('saveId_seq');

  const range = IDBKeyRange.bound(
    [saveId, 0],
    [saveId, Number.MAX_SAFE_INTEGER],
  );

  const messages: ChatMessage[] = [];
  let cursor = await index.openCursor(range, 'next');
  while (cursor) {
    messages.push(cursor.value.message);
    cursor = await cursor.continue();
  }

  return messages;
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

// ─── 老存档迁移 ────────────────────────────────────────

/** 存档 schema 版本 */
export const SAVE_SCHEMA_VERSION = 4;

/** 紧凑头部（不含 messages） */
export interface CompactSaveRecord {
  id: string;
  name: string;
  timestamp: number;
  schemaVersion: number;
  round: number;
  gameState: GameState;
  worldId: string;
  personalInfo?: PlayerProfile;
  characterHistory?: string;
  memoryRuntime?: unknown;
  memoryConfig?: unknown;
  vectorMemory?: unknown[];
  variableConfig?: { apiPresetId?: string };
  customWorld?: Record<string, unknown>;
  simulationState?: SimulationState;
  messageCount: number;
  lastMessageSeq: number;
  estBytes?: number;
}

/**
 * 纯函数：规划 v3（内联 messages）→ v4（分片）迁移。
 * 不接触 IndexedDB，便于单测（L-16）。
 * - 已为新格式（schemaVersion >= SAVE_SCHEMA_VERSION）→ 返回 null（跳过）
 * - 否则返回紧凑头部 compactHead + 消息分片记录 messageRecords
 *   - 无消息 → messageRecords 为空，compactHead.messageCount=0 / lastMessageSeq=-1
 *   - 有消息 → 每条消息生成一条分片，seq 从 0 递增
 */
export function planV2ToV3Migration(oldSave: GameSave): {
  head: CompactSaveRecord;
  messageRecords: MessageRecord[];
} | null {
  if ((oldSave as any).schemaVersion >= SAVE_SCHEMA_VERSION) {
    return null; // 已迁移，跳过
  }

  const messages = oldSave.messages || [];

  const compactHead: CompactSaveRecord = {
    id: oldSave.id,
    name: oldSave.name,
    timestamp: oldSave.timestamp,
    schemaVersion: SAVE_SCHEMA_VERSION,
    round: messages.reduce((max, m) => Math.max(max, m.round), 0),
    gameState: oldSave.gameState,
    worldId: oldSave.worldId,
    personalInfo: oldSave.personalInfo,
    characterHistory: oldSave.characterHistory,
    memoryRuntime: oldSave.memoryRuntime,
    memoryConfig: oldSave.memoryConfig,
    vectorMemory: oldSave.vectorMemory,
    variableConfig: oldSave.variableConfig,
    customWorld: oldSave.customWorld,
    simulationState: oldSave.simulationState,
    messageCount: messages.length,
    lastMessageSeq: messages.length > 0 ? messages.length - 1 : -1,
  };

  const messageRecords: MessageRecord[] = messages.map((m, i) => ({
    key: `${oldSave.id}#${i}`,
    saveId: oldSave.id,
    seq: i,
    message: { ...m, seq: i },
  }));

  return { head: compactHead, messageRecords };
}

/**
 * 迁移老存档（v3 内联 messages）到新格式（v4 分片存储）
 * - 将内联的 messages 拆到 messages store
 * - 生成紧凑头部（不含 messages）
 * - 一次性事务完成，失败不动老记录
 * 实现基于纯函数 planV2ToV3Migration，保证迁移逻辑可单测。
 */
export async function migrateV2ToV3(oldSave: GameSave): Promise<boolean> {
  try {
    const plan = planV2ToV3Migration(oldSave);
    if (!plan) return true; // 已迁移，跳过

    const db = await getDB();
    const { head: compactHead, messageRecords } = plan;

    if (messageRecords.length > 0) {
      // 一次性事务：写消息分片 + 更新头部
      const tx = db.transaction([MESSAGES_STORE, SAVES_STORE], 'readwrite');
      const msgStore = tx.objectStore(MESSAGES_STORE);
      for (const rec of messageRecords) {
        await msgStore.put(rec);
      }
      await tx.objectStore(SAVES_STORE).put(compactHead as any);
      await tx.done;
    } else {
      await db.put(SAVES_STORE, compactHead as any);
    }

    console.log(`[存档迁移] 成功迁移存档 ${oldSave.id}，共 ${messageRecords.length} 条消息`);
    return true;
  } catch (err) {
    console.warn(`[存档迁移] 迁移存档 ${oldSave.id} 失败（不影响原存档）:`, err);
    return false;
  }
}

/**
 * 加载存档时自动迁移（按需）
 * 如果检测到老格式存档，自动迁移到新格式
 */
export async function loadSaveWithMigration(saveId: string): Promise<GameSave | null> {
  const db = await getDB();
  const record = await db.get(SAVES_STORE, saveId);

  if (!record) return null;

  // 检查是否需要迁移
  const schemaVersion = (record as any).schemaVersion ?? 0;
  if (schemaVersion < SAVE_SCHEMA_VERSION && (record as any).messages) {
    // 老格式，需要迁移
    const oldSave = record as GameSave;
    const migrated = await migrateV2ToV3(oldSave);
    if (migrated) {
      // 迁移成功，重新读取（现在是紧凑头部）
      return await db.get(SAVES_STORE, saveId) as any;
    }
    // 迁移失败，返回原记录（兼容回退）
    return oldSave;
  }

  // 新格式，直接返回
  return record as any;
}

// ─── 存档 CRUD ────────────────────────────────────────

/**
 * 增量保存存档（新架构：分片消息 + 紧凑头部）
 *
 * @param saveId 存档 ID
 * @param compactHead 紧凑头部（不含 messages）
 * @param newMessages 新增消息列表（每条消息必须有 seq 字段）
 */
export async function saveGameIncremental(
  saveId: string,
  compactHead: Omit<CompactSaveRecord, 'messageCount' | 'lastMessageSeq'>,
  newMessages: ChatMessage[],
): Promise<void> {
  const db = await getDB();

  // 1) 增量写消息（单事务批量 put，幂等：key 含 seq）
  let maxSeq = -1;
  if (newMessages.length > 0) {
    const tx = db.transaction(MESSAGES_STORE, 'readwrite');
    for (const msg of newMessages) {
      const seq = msg.seq ?? 0;
      const record: MessageRecord = {
        key: `${saveId}#${seq}`,
        saveId,
        seq,
        message: msg,
      };
      await tx.store.put(record);
      maxSeq = Math.max(maxSeq, seq);
    }
    await tx.done;
  }

  // 2) 写紧凑头部（无 messages，体积稳定）
  // 计算最后 seq：取 maxSeq 和当前头部中的 lastMessageSeq 的较大值
  const currentLastSeq = (compactHead as any).lastMessageSeq ?? -1;
  const newLastSeq = Math.max(currentLastSeq, maxSeq);
  const fullHead: CompactSaveRecord = {
    ...compactHead,
    schemaVersion: SAVE_SCHEMA_VERSION,
    messageCount: newLastSeq + 1,
    lastMessageSeq: newLastSeq,
  };
  await db.put(SAVES_STORE, fullHead as any);
}

/**
 * 加载完整存档（兼容新旧格式，自动迁移）
 * @param id 存档 ID
 * @param messageLimit 消息加载限制（0 = 全量，> 0 = 只加载最近 N 条）
 */
export async function loadGame(id: string, messageLimit: number = 0): Promise<GameSave | undefined> {
  try {
    const db = await getDB();
    const record = await db.get(SAVES_STORE, id);
    if (!record) return undefined;

    // 检查是否是新格式（有 schemaVersion，无 messages）
    const schemaVersion = (record as any).schemaVersion ?? 0;
    if (schemaVersion >= SAVE_SCHEMA_VERSION && !(record as any).messages) {
      // 新格式：从 messages store 加载消息
      const compactHead = record as CompactSaveRecord;
      let messages = messageLimit > 0
        ? await getRecentMessages(id, messageLimit)  // lazy 加载：只加载最近 N 条
        : await getAllMessages(id);                    // 全量加载

      // 检查消息是否有 seq 字段，如果没有则补充
      const hasSeq = messages.some(m => m.seq !== undefined);
      if (!hasSeq && messages.length > 0) {
        console.log(`[DB] 新格式存档 ${id} 的消息缺少 seq 字段，补充 seq...`);
        messages = messages.map((m, i) => ({ ...m, seq: i }));
      }

      return {
        id: compactHead.id,
        name: compactHead.name,
        timestamp: compactHead.timestamp,
        messages,
        gameState: compactHead.gameState,
        worldId: compactHead.worldId,
        personalInfo: compactHead.personalInfo,
        characterHistory: compactHead.characterHistory,
        memoryRuntime: compactHead.memoryRuntime,
        memoryConfig: compactHead.memoryConfig,
        vectorMemory: compactHead.vectorMemory,
        variableConfig: compactHead.variableConfig,
        customWorld: compactHead.customWorld,
        simulationState: compactHead.simulationState,
      };
    }

    // 老格式（schemaVersion < 4 且有 messages）：自动迁移
    if (schemaVersion < SAVE_SCHEMA_VERSION && (record as any).messages) {
      console.log(`[DB] 检测到老格式存档 ${id}，开始自动迁移...`);
      const oldSave = record as GameSave;
      const migrated = await migrateV2ToV3(oldSave);
      if (migrated) {
        // 迁移成功，重新读取（现在是新格式）
        const newRecord = await db.get(SAVES_STORE, id);
        if (newRecord) {
          const compactHead = newRecord as CompactSaveRecord;
          const messages = messageLimit > 0
            ? await getRecentMessages(id, messageLimit)
            : await getAllMessages(id);
          return {
            id: compactHead.id,
            name: compactHead.name,
            timestamp: compactHead.timestamp,
            messages,
            gameState: compactHead.gameState,
            worldId: compactHead.worldId,
            personalInfo: compactHead.personalInfo,
            characterHistory: compactHead.characterHistory,
            memoryRuntime: compactHead.memoryRuntime,
            memoryConfig: compactHead.memoryConfig,
            vectorMemory: compactHead.vectorMemory,
            variableConfig: compactHead.variableConfig,
            customWorld: compactHead.customWorld,
            simulationState: compactHead.simulationState,
          };
        }
      }
      // 迁移失败，返回原记录（兼容回退）
      console.warn(`[DB] 存档 ${id} 迁移失败，使用原格式加载`);
      return oldSave;
    }

    // 其他情况直接返回
    const result = record as GameSave;

    // 检查消息是否有 seq 字段，如果没有则自动重新迁移
    if (result.messages && result.messages.length > 0) {
      const hasSeq = result.messages.some((m: any) => m.seq !== undefined);
      if (!hasSeq) {
        console.log(`[DB] 检测到消息缺少 seq 字段，自动重新迁移存档 ${id}...`);
        const remigrated = await remigrateSave(id);
        if (remigrated) {
          // 重新加载
          return loadGame(id, messageLimit);
        }
      }
    }

    return result;
  } catch (err) {
    console.error('[DB] 加载失败:', err);
    throw new Error('存档加载失败');
  }
}

/** 删除存档（同时清理 messages 分片） */
export async function deleteSave(id: string): Promise<void> {
  try {
    const db = await getDB();

    // 同一事务删除 saves 记录 + messages 分片
    const tx = db.transaction([SAVES_STORE, MESSAGES_STORE], 'readwrite');

    // 删除 saves 记录
    await tx.objectStore(SAVES_STORE).delete(id);

    // 删除 messages 分片
    const msgIndex = tx.objectStore(MESSAGES_STORE).index('saveId');
    let cursor = await msgIndex.openCursor(IDBKeyRange.only(id));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    await tx.done;
    console.log(`[DB] 存档 ${id} 已删除（含 messages 分片）`);
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

/** 导出存档为 JSON Blob（不包含 API 配置，API 是应用级设置）
 *  注意：导出全量消息，不走 loadGame 的 200 条限制
 */
export async function exportSave(saveId: string): Promise<Blob> {
  const db = await getDB();
  const record = await db.get(SAVES_STORE, saveId);
  if (!record) throw new Error('存档不存在');

  let messages: ChatMessage[];
  const schemaVersion = (record as any).schemaVersion ?? 0;

  if (schemaVersion >= SAVE_SCHEMA_VERSION && !(record as any).messages) {
    // 新格式：从 messages store 拉全量
    messages = await getAllMessages(saveId);
  } else {
    // 老格式：直接用内联的 messages
    messages = (record as GameSave).messages || [];
  }

  const exportData = {
    type: 'omni-plane-travels-save',
    version: '2.0',
    exportedAt: Date.now(),
    save: {
      id: record.id,
      name: record.name,
      timestamp: record.timestamp,
      messages,
      gameState: record.gameState,
      worldId: record.worldId,
      personalInfo: record.personalInfo,
      characterHistory: record.characterHistory,
      memoryRuntime: record.memoryRuntime ? slimMemoryRuntimeForSave(record.memoryRuntime) : undefined,
      memoryConfig: record.memoryConfig,
      vectorMemory: record.vectorMemory,
      customWorld: record.customWorld,
      simulationState: record.simulationState,
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

  // 走分片存储
  const messages = saveData.messages || [];
  // 给消息分配 seq（如果没有的话）
  messages.forEach((msg, i) => {
    if (msg.seq === undefined) {
      msg.seq = i;
    }
  });
  const compactHead: Omit<CompactSaveRecord, 'messageCount' | 'lastMessageSeq'> = {
    id: saveData.id,
    name: saveData.name,
    timestamp: saveData.timestamp,
    schemaVersion: SAVE_SCHEMA_VERSION,
    round: messages.reduce((max, m) => Math.max(max, m.round), 0),
    gameState: saveData.gameState,
    worldId: saveData.worldId,
    personalInfo: saveData.personalInfo,
    characterHistory: saveData.characterHistory,
    memoryRuntime: saveData.memoryRuntime,
    memoryConfig: saveData.memoryConfig,
    vectorMemory: saveData.vectorMemory,
    variableConfig: saveData.variableConfig,
    customWorld: saveData.customWorld,
    simulationState: saveData.simulationState,
  };

  await saveGameIncremental(finalId, compactHead, messages);

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
    desire_metropolis: '烟火人间',
    wasteland_apocalypse: '余烬废土',
    japanese_school: '日式校园',
    wuxia_world: '武林风云',
    stranded_island: '孤岛求生',
    border_trade: '绥芬边贸',
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

export type { GameSave, PlayerProfile, CustomNpc };
