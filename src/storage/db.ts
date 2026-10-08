// IndexedDB 存储层
import { openDB, type IDBPDatabase } from 'idb';
import { cloneSnapshotWithSharing } from '../utils/snapshotSharing';
import { mapStorageBatch } from './mapStorageBatch';
import { encodeStorageValue, decodeStorageValue, type StorageEncoding } from './storageCodec';
import { decodeSaveFile } from './saveFileCodec';
import { assetReferences, collectSaveAssets, decodePortableAssets } from './saveAssets';
import { imageDb } from './imageDb';
import type { ChatMessage } from '../engine/types';
import type { GameState } from '../schema/variables';
import { STORAGE_KEYS } from '@/config/storageKeys';
import { slimMemoryRuntimeForSave } from '@/memory/memoryStore';
import type { SimulationState } from '@/simulation/types';
import { findWorldDef } from '@/data/worldLoader';
import type { ModuleStateRecord } from '@/gameplay/moduleRuntime/types';
import { extractModulePartitions } from '@/gameplay/moduleRuntime/facade';
import type { CombatRiskMode } from '../gameplay/protocols';
import type { DirectorDefinition } from '../director/definitionTypes';
import { directorDefinitionKey, type DirectorDefinitionRecord } from '../director/definitionStore';
import { applyImportedEvents, applyImportedWorld, encodeEventDependency, equalDirectorContent, prepareSaveDependencies,
  rollbackImportedEvents, rollbackImportedWorld, type ImportedEventChange, type ImportedWorldChange } from './saveDependencyImport';

// ─── 类型定义 ─────────────────────────────────────────

/** 自建NPC（向导阶段玩家创建，注入到初始人物档案） */
export interface CustomNpc {
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

export interface PortraitSettings {
  /** Optional portrait state; absent in legacy saves means use the gender default. */
  source: 'default' | 'custom';
  customDataUrl?: string;
  zoom: number;
  positionX: number;
  positionY: number;
  fileName?: string;
}

export interface PlayerProfile {
  /** Creation-only role selection, fixed to the immutable plot version. */
  directorRole?: import('../director/initialIdentity').DirectorPlayerSelection;
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
  /** Optional, backwards-compatible visual identity shared by creation and game profile. */
  portrait?: PortraitSettings;

  // 模块初始数据（角色创建时玩家设定的初始属性值）
  moduleInitData?: Record<string, unknown>;
  /** 职业模块启用时由条件第五步写入。 */
  professionId?: string | null;
  /** 创建角色时消耗固定预算选择；进入游戏后不可购买。 */
  innateTalentIds?: string[];
  /** v3 combat risk is chosen once during creation and is immutable after start. */
  combatRiskMode?: CombatRiskMode;
  /** 创建期属性加点分配。key: 'attrA'|'attrB'|'dim1'..'dim6'|special id → 点数。 */
  creationPointAllocations?: Record<string, number>;
  /** 创建期天赋抽卡已用次数（上限 CREATION_MAX_DRAWS=5）。 */
  creationDrawCount?: number;
  /** 通过命运抽卡获得的天赋 ID；只计抽卡费，不再重复计入直选花费。 */
  creationDrawnTalentIds?: string[];
}

export type SaveLifecycle = 'active' | 'ended';

/** 完整存档记录（写入 IndexedDB saves store） */
export interface GameSave {
  /** v4/v5 internal save schema marker; imports are normalized before persistence. */
  schemaVersion?: number;
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
  /** 六模块当前运行态；仅作为加载/导出传输载体，实际存于独立 object store。 */
  moduleStates?: ModuleStateRecord[];
  /** 消息快照引用的模块历史修订；实际存于独立 object store。 */
  moduleCheckpoints?: ModuleStateRecord[];
  /** v3 inferno death seals the save without deleting it. */
  lifecycle?: SaveLifecycle;
  endedAt?: number;
  endReason?: string;
  /** Original image-generation scopes retained when a portable save receives a new id. */
  assetSourceSessionIds?: string[];
}

/** Additive lifecycle migration: legacy saves remain active and retryable by default. */
export function normalizeSaveLifecycle(save: GameSave): GameSave {
  return {
    ...save,
    lifecycle: save.lifecycle === 'ended' ? 'ended' : 'active',
    ...(save.lifecycle === 'ended' && Number.isFinite(save.endedAt) ? { endedAt: save.endedAt } : {}),
    ...(save.lifecycle === 'ended' && save.endReason ? { endReason: save.endReason } : {}),
  };
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
  lifecycle?: SaveLifecycle;
  endedAt?: number;
  endReason?: string;
}

// ─── DB 常量 ──────────────────────────────────────────

const DB_NAME = 'omni-plane-travels';
const DB_VERSION = 10; // v10: immutable director definitions and resumable compile jobs
// DB v4 already has compatible saves/global/messages; later stores are additive.
// Database deployment versions are independent of the save payload schema below.
const MIN_UPGRADABLE_DB_VERSION = 4;
const SAVES_STORE = 'saves';
const GLOBAL_STORE = 'global';
const MESSAGES_STORE = 'messages';  // 新增：消息分片 store
export const MODULE_STATES_STORE = 'module_states';
export const MODULE_CHECKPOINTS_STORE = 'module_checkpoints';

// Novel analysis stores
export const NOVEL_CHAPTERS_STORE = 'novel_chapters';
export const NOVEL_CHUNKS_STORE = 'novel_chunks';
export const NOVEL_DATASETS_STORE = 'novel_datasets';
export const NOVEL_JOBS_STORE = 'novel_jobs';
export const NOVEL_SEGMENTS_STORE = 'novel_segments';
export const NOVEL_ARCHIVES_STORE = 'novel_archives';
export const NOVEL_CHECKPOINTS_STORE = 'novel_checkpoints';
export const NOVEL_SOURCES_STORE = 'novel_sources';
export const NOVEL_MATERIALS_STORE = 'novel_materials';
export const DIRECTOR_DEFINITIONS_STORE = 'director_definitions';
export const DIRECTOR_JOBS_STORE = 'director_jobs';

/** localStorage key：当前活跃存档 ID（F5 恢复用） */
export const ACTIVE_SAVE_KEY = STORAGE_KEYS.ACTIVE_SAVE;

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB() {
  if (!dbPromise) {
    let unsupportedVersion: number | undefined;
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        // Report upgrade failures through openDB, including asynchronous index failures.
        void transaction.done.catch(() => {});
        if (oldVersion !== 0 && oldVersion < MIN_UPGRADABLE_DB_VERSION) {
          unsupportedVersion = oldVersion;
          transaction.abort();
          return;
        }
        // Reconcile directly to one canonical layout in the atomic upgrade transaction.
        // Never recreate stores or rewrite records: saves and rollback snapshots stay intact.
        const ensureStore = (name: string, keyPath = 'id') => db.objectStoreNames.contains(name)
          ? transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath });
        const ensureIndex = (store: ReturnType<typeof ensureStore>, name: string, keyPath: string | string[], unique = false) => {
          if (store.indexNames.contains(name)) {
            const index = store.index(name);
            if (JSON.stringify(index.keyPath) === JSON.stringify(keyPath) && index.unique === unique) return;
            // Early novel databases used a single-field datasetId_index.
            store.deleteIndex(name);
          }
          store.createIndex(name, keyPath, { unique });
        };
        ensureIndex(ensureStore(SAVES_STORE), 'timestamp', 'timestamp');
        ensureStore(GLOBAL_STORE, 'key');
        const messages = ensureStore(MESSAGES_STORE, 'key');
        ensureIndex(messages, 'saveId', 'saveId');
        ensureIndex(messages, 'saveId_seq', ['saveId', 'seq']);
        const modules = ensureStore(MODULE_STATES_STORE, 'key');
        ensureIndex(modules, 'saveId', 'saveId');
        ensureIndex(modules, 'saveId_moduleId', ['saveId', 'moduleId'], true);
        const checkpoints = ensureStore(MODULE_CHECKPOINTS_STORE, 'key');
        ensureIndex(checkpoints, 'saveId', 'saveId');
        ensureIndex(checkpoints, 'saveId_module_revision', ['saveId', 'moduleId', 'revision'], true);
        ensureIndex(ensureStore(NOVEL_DATASETS_STORE), 'timestamp', 'timestamp');
        for (const name of [NOVEL_CHAPTERS_STORE, NOVEL_SEGMENTS_STORE, NOVEL_CHUNKS_STORE, NOVEL_JOBS_STORE, NOVEL_ARCHIVES_STORE, NOVEL_CHECKPOINTS_STORE]) {
          const store = ensureStore(name);
          ensureIndex(store, 'datasetId', 'datasetId');
          if (name === NOVEL_SEGMENTS_STORE) ensureIndex(store, 'datasetId_index', ['datasetId', 'index']);
        }
        for (const name of [NOVEL_SOURCES_STORE, NOVEL_MATERIALS_STORE, DIRECTOR_DEFINITIONS_STORE, DIRECTOR_JOBS_STORE]) ensureStore(name);
      },
    }).catch(error => {
      dbPromise = null;
      if (unsupportedVersion !== undefined) throw new Error(`本地数据库 v${unsupportedVersion} 无法直接升级到 v${DB_VERSION}；支持从 v${MIN_UPGRADABLE_DB_VERSION} 及之后版本升级。原数据未修改，请保留网站数据并联系维护者协助迁移。`);
      throw error;
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
  encodedSnapshot?: StorageEncoding;
  /** Digest of the complete decoded message, including accepted checkpoints. */
  contentFingerprint?: string;
}

async function messageFingerprint(message: ChatMessage): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(message));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

/** Sequence identifies a slot, not a revision. Compare against durable content. */
export async function planMessageSave(saveId: string, messages: ChatMessage[]): Promise<{ changedMessages: ChatMessage[]; replaceMessages: boolean }> {
  const db = await getDB();
  // Keep only comparison metadata; getAll also clones every compressed snapshot
  // and recovery payload into memory even though none of it is needed here.
  const fingerprints = new Map<number, string | undefined>();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.store.index('saveId_seq');
  let nextSeq = 0;
  while (nextSeq <= Number.MAX_SAFE_INTEGER) {
    const range = IDBKeyRange.bound([saveId, nextSeq], [saveId, Number.MAX_SAFE_INTEGER]);
    const records = await index.getAll(range, 32) as MessageRecord[];
    for (const record of records) fingerprints.set(record.seq, record.contentFingerprint);
    if (records.length < 32) break;
    nextSeq = records.at(-1)!.seq + 1;
  }
  await tx.done;
  const currentSequences = new Set(messages.map(message => message.seq ?? 0));
  const replaceMessages = [...fingerprints.keys()].some(seq => !currentSequences.has(seq));
  if (replaceMessages) return { changedMessages: messages, replaceMessages };
  const changed = await mapStorageBatch(messages, async message => {
    const previous = fingerprints.get(message.seq ?? 0);
    // Older records acquire a fingerprint on their next successful save.
    return !previous || previous !== await messageFingerprint(message) ? message : undefined;
  });
  return { changedMessages: changed.filter((message): message is ChatMessage => !!message), replaceMessages };
}

async function encodeMessageRecord(saveId: string, message: ChatMessage, seq: number): Promise<MessageRecord> {
  const contentFingerprint = await messageFingerprint(message);
  const encodedSnapshot = await encodeStorageValue(message.snapshot);
  if (!encodedSnapshot) return { key: `${saveId}#${seq}`, saveId, seq, message, contentFingerprint };
  const { snapshot, ...plainMessage } = message;
  return { key: `${saveId}#${seq}`, saveId, seq, message: plainMessage as ChatMessage, encodedSnapshot, contentFingerprint };
}

async function decodeMessageRecord(record: MessageRecord): Promise<ChatMessage> {
  if (record.encodedSnapshot === undefined) return record.message;
  return { ...record.message, snapshot: await decodeStorageValue(record.encodedSnapshot) } as ChatMessage;
}

async function encodeSaveHead<T extends { memoryRuntime?: unknown; simulationState?: SimulationState; encodedHistory?: StorageEncoding }>(head: T): Promise<T> {
  // Opaque compact heads may be passed through metadata/module paths.
  if (head.encodedHistory !== undefined && !('memoryRuntime' in head) && !('simulationState' in head)) return head;
  const { encodedHistory: previousEncoding, ...plainHead } = head;
  const encodedHistory = await encodeStorageValue({ memoryRuntime: head.memoryRuntime, simulationState: head.simulationState });
  if (!encodedHistory) return plainHead as T;
  const { memoryRuntime, simulationState, ...rest } = plainHead;
  return { ...rest, encodedHistory } as T;
}

async function decodeSaveHead(head: CompactSaveRecord): Promise<CompactSaveRecord> {
  if (head.encodedHistory === undefined) return head;
  const { encodedHistory, ...plainHead } = head;
  const history = await decodeStorageValue(encodedHistory);
  if (!history || typeof history !== 'object' || Array.isArray(history)
    || Object.keys(history).some(key => key !== 'memoryRuntime' && key !== 'simulationState')) {
    throw new Error('存档历史压缩数据损坏');
  }
  const payload = history as { memoryRuntime?: unknown; simulationState?: SimulationState };
  return { ...plainHead, memoryRuntime: payload.memoryRuntime, simulationState: payload.simulationState };
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

  // 先获取最后一条的 seq
  const lastSeq = await getLastMessageSeq(saveId);
  if (lastSeq < 0) return [];

  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.store.index('saveId_seq');

  // 计算起始 seq
  const startSeq = Math.max(0, lastSeq - count + 1);
  const range = IDBKeyRange.bound(
    [saveId, startSeq],
    [saveId, lastSeq],
  );

  const records: MessageRecord[] = [];
  let cursor = await index.openCursor(range, 'prev');
  while (cursor) {
    records.unshift(cursor.value);
    cursor = await cursor.continue();
  }

  await tx.done;
  return mapStorageBatch(records, decodeMessageRecord);
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

  const records: MessageRecord[] = [];
  let cursor = await index.openCursor(range, 'next');
  while (cursor) {
    records.push(cursor.value);
    cursor = await cursor.continue();
  }

  await tx.done;
  return mapStorageBatch(records, decodeMessageRecord);
}

/** 增量写入消息（批量 put，幂等：key 含 seq） */
export async function putMessages(saveId: string, messages: ChatMessage[], startSeq: number): Promise<void> {
  const records = await mapStorageBatch(messages, (message, i) => encodeMessageRecord(saveId, message, startSeq + i));
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readwrite');
  for (const record of records) await tx.store.put(record);
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

/** 获取指定存档的全量消息（用于导出） */
export async function getAllMessages(saveId: string): Promise<ChatMessage[]> {
  const db = await getDB();
  const tx = db.transaction(MESSAGES_STORE, 'readonly');
  const index = tx.store.index('saveId_seq');

  const range = IDBKeyRange.bound(
    [saveId, 0],
    [saveId, Number.MAX_SAFE_INTEGER],
  );

  const records: MessageRecord[] = [];
  let cursor = await index.openCursor(range, 'next');
  while (cursor) {
    records.push(cursor.value);
    cursor = await cursor.continue();
  }

  await tx.done;
  return mapStorageBatch(records, decodeMessageRecord);
}

// ─── Global store（键值对，存元数据列表等） ─────────────

export async function getGlobal<T = any>(key: string): Promise<T | undefined> {
  const db = await getDB();
  const record = await db.get(GLOBAL_STORE, key);
  return record?.value as T | undefined;
}

export async function putGlobal(key: string, value: any): Promise<void> {
  const db = await getDB();
  await db.put(GLOBAL_STORE, { key, value });
}

// ─── 存档元数据管理 ─────────────────────────────────

let cachedSaveMeta: SaveMeta[] | null = null;

/** Repair metadata created by older import/rename paths without loading message shards. */
async function repairMissingMessageCounts(metas: SaveMeta[]): Promise<SaveMeta[]> {
  if (!metas.some(meta => meta.messageCount === undefined)) return metas;

  const db = await getDB();
  let changed = false;
  const repaired = await Promise.all(metas.map(async meta => {
    if (meta.messageCount !== undefined) return meta;
    const record = await db.get(SAVES_STORE, meta.id) as CompactSaveRecord | GameSave | undefined;
    if (!record) return meta;
    const count = typeof (record as CompactSaveRecord).messageCount === 'number'
      ? (record as CompactSaveRecord).messageCount
      : Array.isArray((record as GameSave).messages) ? (record as GameSave).messages.length : undefined;
    if (count === undefined) return meta;
    changed = true;
    return { ...meta, messageCount: count };
  }));

  if (changed) {
    cachedSaveMeta = repaired;
    await putGlobal('saves', repaired);
  }
  return repaired;
}

/** 读取所有存档元数据（轻量，不加载完整存档） */
export async function getAllSaveMeta(): Promise<SaveMeta[]> {
  if (!cachedSaveMeta) {
    cachedSaveMeta = await getGlobal<SaveMeta[]>('saves') || [];
  }
  const metas = await repairMissingMessageCounts(cachedSaveMeta);
  // 重新计算预览文本
  return metas.map(meta => ({
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
export const SAVE_SCHEMA_VERSION = 5;

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
  encodedHistory?: StorageEncoding;
  messageCount: number;
  lastMessageSeq: number;
  estBytes?: number;
  lifecycle?: SaveLifecycle;
  endedAt?: number;
  endReason?: string;
  assetSourceSessionIds?: string[];
}

/** Only the direct previous compact schema is migrated; existing shards stay lossless. */
export function planV4ToV5Migration(oldHead: CompactSaveRecord): CompactSaveRecord | null {
  if (oldHead.schemaVersion === SAVE_SCHEMA_VERSION) return null;
  if (oldHead.schemaVersion !== SAVE_SCHEMA_VERSION - 1 || 'messages' in oldHead) {
    throw new Error('不支持的内部存档格式；仅保留 v4 → v5');
  }
  return { ...oldHead, schemaVersion: SAVE_SCHEMA_VERSION };
}

export async function loadSaveWithMigration(saveId: string): Promise<GameSave | null> {
  const db = await getDB();
  let record = await db.get(SAVES_STORE, saveId);
  if (!record) return null;
  const schemaVersion = record.schemaVersion ?? 0;
  if (schemaVersion !== SAVE_SCHEMA_VERSION && schemaVersion !== SAVE_SCHEMA_VERSION - 1) return null;
  if ('messages' in record) return null;
  await (await import('../custom-modules/saveDefinitions')).ensureSaveCustomModuleDefinitions(saveId);
  record = await db.get(SAVES_STORE, saveId);
  if (!record) return null;
  if (record.schemaVersion === SAVE_SCHEMA_VERSION - 1) {
    // Reread under the write lock: a concurrent save may have replaced the head.
    const tx = db.transaction(SAVES_STORE, 'readwrite');
    const current = await tx.store.get(saveId);
    if (!current) {
      await tx.done;
      return null;
    }
    const migrated = planV4ToV5Migration(current);
    if (migrated) await tx.store.put(migrated);
    await tx.done;
    record = migrated ?? current;
  }
  return normalizeSaveLifecycle(await decodeSaveHead(record) as unknown as GameSave);
}

// ─── 存档 CRUD ────────────────────────────────────────

/**
 * 增量保存存档（新架构：分片消息 + 紧凑头部）
 *
 * @param saveId 存档 ID
 * @param compactHead 紧凑头部（不含 messages）
 * @param newMessages 新增消息列表（每条消息必须有 seq 字段）
 */
export class SaveCreationConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'SaveCreationConflictError'; }
}

export async function saveGameIncremental(
  saveId: string,
  compactHead: Omit<CompactSaveRecord, 'messageCount' | 'lastMessageSeq'>,
  newMessages: ChatMessage[],
  moduleStates: readonly ModuleStateRecord[] = [],
  moduleCheckpoints: readonly ModuleStateRecord[] = [],
  options: { replaceMessages?: boolean; keptModuleRevisions?: ReadonlySet<string>; importCommit?: { journalKey?: string; meta: SaveMeta;
    directorDefinitions?: readonly DirectorDefinition[]; directorReferences?: readonly { definitionId: string; version: string }[] }; createCommit?: SaveMeta } = {},
): Promise<void> {
  const db = await getDB();

  // Compression finishes before opening any write transaction.
  const messageRecords = await mapStorageBatch(newMessages, msg => encodeMessageRecord(saveId, msg, msg.seq ?? 0));
  const encodedHead = await encodeSaveHead(compactHead);
  const tx = db.transaction(
    [SAVES_STORE, MESSAGES_STORE, MODULE_STATES_STORE, MODULE_CHECKPOINTS_STORE, ...(options.importCommit || options.createCommit ? [GLOBAL_STORE] : []),
      ...(options.importCommit ? [DIRECTOR_DEFINITIONS_STORE] : [])],
    'readwrite',
  );
  try {
    if (options.importCommit) {
      if (await tx.objectStore(SAVES_STORE).get(saveId)) throw new Error('存档身份在导入期间已被占用，未覆盖已有旅程。');
      const existing = await tx.objectStore(GLOBAL_STORE).get('saves');
      const metas: SaveMeta[] = Array.isArray(existing?.value) ? existing.value : [];
      if (metas.some(meta => meta.name === options.importCommit!.meta.name)) throw new Error('存档同名冲突，请重新导入。');
      let cursor = await tx.objectStore(SAVES_STORE).openCursor();
      while (cursor) {
        if (cursor.value.name === options.importCommit.meta.name) throw new Error('存档同名冲突，请重新导入。');
        cursor = await cursor.continue();
      }
      const definitions = tx.objectStore(DIRECTOR_DEFINITIONS_STORE);
      for (const definition of options.importCommit.directorDefinitions ?? []) {
        const key = directorDefinitionKey(definition.id, definition.version);
        const current = await definitions.get(key) as DirectorDefinitionRecord | undefined;
        if (current && !equalDirectorContent(current.definition, definition)) throw new Error('剧情版本在导入期间发生内容冲突，未覆盖本机版本。');
        if (!current) await definitions.add({ id: key, definition });
      }
      for (const reference of options.importCommit.directorReferences ?? []) {
        if (!await definitions.get(directorDefinitionKey(reference.definitionId, reference.version))) throw new Error('剧情依赖在导入期间被删除，未提交存档。');
      }
    }
    if (options.createCommit) {
      if (await tx.objectStore(SAVES_STORE).get(saveId)) throw new SaveCreationConflictError('存档身份已存在，未覆盖已有旅程。');
      const existing = await tx.objectStore(GLOBAL_STORE).get('saves');
      const metas: SaveMeta[] = Array.isArray(existing?.value) ? existing.value : [];
      if (metas.some(meta => meta.name === options.createCommit!.name)) throw new SaveCreationConflictError('存档名称已存在，请重新命名。');
      // Older metadata writes could fail independently of the durable head.
      // Names remain reserved by those saves even before metadata is repaired.
      let cursor = await tx.objectStore(SAVES_STORE).openCursor();
      while (cursor) {
        if (cursor.value.name === options.createCommit.name) throw new SaveCreationConflictError('存档名称已存在，请重新命名。');
        cursor = await cursor.continue();
      }
    }
    const messageStore = tx.objectStore(MESSAGES_STORE);
    if (options.replaceMessages) {
      let cursor = await messageStore.index('saveId').openCursor(saveId);
      while (cursor) { await cursor.delete(); cursor = await cursor.continue(); }
    }
    for (const record of messageRecords) {
      await messageStore.put(record);
    }
    const last = await messageStore.index('saveId_seq').openCursor(
      IDBKeyRange.bound([saveId, 0], [saveId, Number.MAX_SAFE_INTEGER]), 'prev',
    );
    const fullHead: CompactSaveRecord = {
      ...encodedHead,
      schemaVersion: SAVE_SCHEMA_VERSION,
      messageCount: await messageStore.index('saveId').count(saveId),
      lastMessageSeq: last?.value.seq ?? -1,
    };
    await tx.objectStore(SAVES_STORE).put(fullHead as any);
    const stateStore = tx.objectStore(MODULE_STATES_STORE);
    for (const record of moduleStates) {
      const key = `${saveId}#${record.moduleId}`;
      const persisted = await stateStore.get(key) as ModuleStateRecord | undefined;
      if (persisted?.revision === record.revision) continue;
      await stateStore.put({ ...record, saveId, key });
    }
    const checkpointStore = tx.objectStore(MODULE_CHECKPOINTS_STORE);
    for (const record of moduleCheckpoints) {
      const key = `${saveId}#${record.moduleId}#${record.revision}`;
      if (await checkpointStore.get(key)) continue;
      await checkpointStore.put({ ...record, saveId, key });
    }
    if (options.keptModuleRevisions) {
      let cursor = await checkpointStore.index('saveId').openCursor(saveId);
      while (cursor) {
        if (!options.keptModuleRevisions.has(`${cursor.value.moduleId}#${cursor.value.revision}`)) await cursor.delete();
        cursor = await cursor.continue();
      }
    }
    if (options.importCommit) {
      const global = tx.objectStore(GLOBAL_STORE);
      const key = options.importCommit.journalKey;
      if (key) {
        const journal = await global.get(key);
        if (!journal?.value || journal.value.saveId !== saveId) throw new Error('导入恢复记录缺失，未提交存档。');
        await global.put({ key, value: { ...journal.value, phase: 'committed' } });
      }
      const existing = await global.get('saves');
      const meta = options.importCommit.meta;
      const metas: SaveMeta[] = Array.isArray(existing?.value) ? existing.value : [];
      await global.put({ key: 'saves', value: [...metas.filter(item => item.id !== meta.id), meta] });
    }
    if (options.createCommit) {
      const global = tx.objectStore(GLOBAL_STORE), existing = await global.get('saves');
      const metas: SaveMeta[] = Array.isArray(existing?.value) ? existing.value : [];
      await global.put({ key: 'saves', value: [...metas, options.createCommit] });
    }
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* The database may already have aborted. */ }
    await tx.done.catch(() => {});
    throw error;
  }
}

/**
 * 加载完整存档（当前 v5；仅自动迁移直接上一代 v4）
 * @param id 存档 ID
 * @param messageLimit 消息加载限制（0 = 全量，> 0 = 只加载最近 N 条）
 */
export async function loadGame(id: string, messageLimit: number = 0): Promise<GameSave | undefined> {
  const head = await loadSaveWithMigration(id);
  if (!head) {
    if (await (await getDB()).get(SAVES_STORE, id)) throw new Error('存档使用不受支持的内部格式；当前仅支持 v5 与直接上一代 v4');
    return undefined;
  }
  let messages = messageLimit > 0 ? await getRecentMessages(id, messageLimit) : await getAllMessages(id);
  if (messages.length > 0 && !messages.some(m => m.seq !== undefined)) messages = messages.map((m, i) => ({ ...m, seq: i }));
  return {
    ...head,
    messages,
    moduleStates: await (await import('./moduleStateDb')).getModuleStates(id),
    moduleCheckpoints: await (await import('./moduleStateDb')).getModuleCheckpoints(id),
  };
}

/** 删除存档（同时清理 messages 分片） */
export async function deleteSave(id: string): Promise<void> {
  try {
    const db = await getDB();

    // 同一事务删除 saves 记录 + messages 分片
    const tx = db.transaction(
      [SAVES_STORE, MESSAGES_STORE, MODULE_STATES_STORE, MODULE_CHECKPOINTS_STORE],
      'readwrite',
    );

    // 删除 saves 记录
    await tx.objectStore(SAVES_STORE).delete(id);

    // 删除 messages 分片
    const msgIndex = tx.objectStore(MESSAGES_STORE).index('saveId');
    let cursor = await msgIndex.openCursor(IDBKeyRange.only(id));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }

    for (const storeName of [MODULE_STATES_STORE, MODULE_CHECKPOINTS_STORE]) {
      const index = tx.objectStore(storeName).index('saveId');
      let moduleCursor = await index.openCursor(IDBKeyRange.only(id));
      while (moduleCursor) {
        await moduleCursor.delete();
        moduleCursor = await moduleCursor.continue();
      }
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
    await getDB();
    await deleteSave(id);
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
 * 无损共享相邻快照的不变数据，保留逐轮状态，不能通过丢弃历史状态来节省空间：
 * 重发依赖前一轮的精确变量，旧关键帧会让变量与记忆/导演回到不同轮。
 */
const sharedMessageSnapshots = new WeakMap<object, unknown>();
export function optimizeSnapshots(messages: ChatMessage[]): ChatMessage[] {
  let previous: unknown;
  let changed = false;
  const shared = messages.map(message => {
    const snapshot = message.snapshot;
    if (!snapshot || typeof snapshot !== 'object') return message;
    let compact = sharedMessageSnapshots.get(snapshot);
    if (!compact) {
      compact = cloneSnapshotWithSharing(snapshot, previous);
      sharedMessageSnapshots.set(snapshot, compact);
      sharedMessageSnapshots.set(compact as object, compact);
    }
    previous = compact;
    if (compact === snapshot) return message;
    changed = true;
    return { ...message, snapshot: compact };
  });
  return changed ? shared : messages;
}

// ─── 导出/导入 ────────────────────────────────────────

const SAVE_EXPORT_TYPE = 'omni-plane-travels-save';
const SAVE_EXPORT_VERSION = '2.0';
const PREVIOUS_SAVE_EXPORT_VERSION = '1.0';


/** 导出存档为 JSON Blob（不包含 API 配置，API 是应用级设置）
 *  注意：导出全量消息，不走 loadGame 的 200 条限制
 *  事件包：导出全局已启用的事件包完整内容（排重用）。
 */
export async function exportSave(saveId: string): Promise<Blob> {
  const record = await loadGame(saveId);
  if (!record) throw new Error('存档不存在或格式不受支持');
  return exportSaveCapture(record);
}

/** Use the same complete export for unsaved recovery captures and durable archives. */
export async function exportSaveCapture(capture: GameSave): Promise<Blob> {
  const record = structuredClone(capture);

  // 收集全局已启用的事件包完整内容（供导入时排重恢复）
  const { allWebEvents } = await import('../modules/eventDb');
  const availableEvents = await allWebEvents(), byId = new Map(availableEvents.map(event => [event.id, event]));
  const selectedEvents = new Map(availableEvents.filter(event => event.enabled).map(event => [event.id, event]));
  // Disabled dependencies still belong to the backup's content closure.
  const visitEvent = (id: string, visiting = new Set<string>()) => {
    if (visiting.has(id)) return;
    const event = byId.get(id);
    if (!event) throw new Error(`存档事件包缺少依赖 ${id}，无法生成完整备份。`);
    selectedEvents.set(id, event); visiting.add(id);
    for (const dependency of event.manifest.dependencies ?? []) visitEvent(dependency, visiting);
  };
  for (const id of [...selectedEvents.keys()]) visitEvent(id);
  const eventPacks = await Promise.all([...selectedEvents.values()].map(encodeEventDependency));

  const exportData = {
    type: SAVE_EXPORT_TYPE,
    version: SAVE_EXPORT_VERSION,
    exportedAt: Date.now(),
    save: {
      ...record,
      memoryRuntime: record.memoryRuntime ? slimMemoryRuntimeForSave(record.memoryRuntime) : undefined,
      directorDefinitions: await (await import('../director/dependencies')).collectDirectorDependencies(record),
      lifecycle: record.lifecycle === 'ended' ? 'ended' : 'active',
      endedAt: record.endedAt,
      endReason: record.endReason,
      eventPacks, // 新版：事件包完整内容
      ...await collectSaveAssets(record),
    },
  };

  return new Blob([JSON.stringify(exportData)], { type: 'application/json' });
}

/** 从文件导入存档，返回新 SaveMeta */
export async function importSaveFromFile(file: File): Promise<SaveMeta> {
  return importSaveFromData(await decodeSaveFile(file));
}

/** 从原始数据导入存档（normalize + 新 ID + 唯一名称） */
export function importSaveFromData(rawData: any): Promise<SaveMeta> {
  const captured = structuredClone(rawData);
  return exclusiveImport(async () => {
    await recoverPendingDependencyImports();
    return performSaveImport(captured);
  });
}

const IMAGE_IMPORT_PREFIX = 'save-image-import:';
const SAVE_IMPORT_PREFIX = 'save-import:';
interface SaveImportJournal { owner: string; saveId: string; keys: string[]; phase: 'applying' | 'committed';
  world?: ImportedWorldChange; events?: ImportedEventChange[] }
let importQueue: Promise<unknown> = Promise.resolve();
function exclusiveImport<T>(work: () => Promise<T>): Promise<T> {
  const result = importQueue.then(() => typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('omni-plane-travels-save-import', work) : work());
  importQueue = result.catch(() => {});
  return result;
}

async function recoverPendingDependencyImports(): Promise<void> {
  const db = await getDB();
  const pending = (await db.getAll(GLOBAL_STORE)) as Array<{ key: string; value: SaveImportJournal }>;
  for (const record of pending) if (record.key.startsWith(IMAGE_IMPORT_PREFIX) || record.key.startsWith(SAVE_IMPORT_PREFIX)) {
    const journal = record.value;
    if (!journal || !Array.isArray(journal.keys) || journal.keys.some(key => typeof key !== 'string') || typeof journal.owner !== 'string' || typeof journal.saveId !== 'string'
      || !['applying', 'committed'].includes(journal.phase)
      || (journal.events !== undefined && (!Array.isArray(journal.events) || journal.events.some(change => !change || typeof change.id !== 'string' || change.owner !== journal.owner)))
      || (journal.world !== undefined && (!journal.world || typeof journal.world.id !== 'string' || journal.world.owner !== journal.owner || journal.world.after?.id !== journal.world.id))) throw new Error('导入恢复记录损坏，请保留本机数据。');
    if (journal.phase === 'applying') await compensateSaveImport(journal);
    await db.delete(GLOBAL_STORE, record.key);
  }
}
async function compensateSaveImport(journal: SaveImportJournal): Promise<void> {
  await imageDb.rollbackTransferRecords(journal.keys, journal.owner);
  await rollbackImportedEvents(journal.events ?? []);
  if (journal.world) rollbackImportedWorld(journal.world);
}

/** Recovery and live imports share a queue, so startup cannot undo an import still in flight. */
export function recoverPendingSaveImports(): Promise<void> { return exclusiveImport(recoverPendingDependencyImports); }

async function performSaveImport(rawData: any): Promise<SaveMeta> {
  if (!rawData || typeof rawData !== 'object' || rawData.type !== SAVE_EXPORT_TYPE || !rawData.save) {
    throw new Error('存档数据格式无效');
  }
  const exportVersion = String(rawData.version ?? '');
  if (exportVersion !== SAVE_EXPORT_VERSION && exportVersion !== PREVIOUS_SAVE_EXPORT_VERSION) {
    throw new Error(`不支持的导出存档版本 ${exportVersion || '(missing)'}；当前仅支持 ${SAVE_EXPORT_VERSION} 与直接上一代 ${PREVIOUS_SAVE_EXPORT_VERSION}`);
  }

  const save = rawData.save;
  if (!save.messages && !save.gameState) {
    throw new Error('文件中未找到有效存档数据');
  }
  const assets = save.assets === undefined ? undefined : decodePortableAssets(save.assets);
  if (assets) {
    const suppliedKeys = new Set(assets.map(record => record.key));
    for (const key of assetReferences(save).required) if (!suppliedKeys.has(key)) {
      throw new Error(`图片备份缺少图片 ${key}，未导入存档。`);
    }
    await imageDb.checkTransferRecords(assets);
  }
  const owner = crypto.randomUUID();
  const dependencies = await prepareSaveDependencies(save, save.directorDefinitions, save.eventPacks, owner);

  // 生成新 ID 避免冲突
  const metas = [...await getAllSaveMeta()];
  // Heads also reserve identities/names when an older metadata write was incomplete.
  for (const head of await (await getDB()).getAll(SAVES_STORE)) if (!metas.some(meta => meta.id === head.id)) metas.push(head as SaveMeta);
  let finalId = String(save.id || '').trim() || generateSaveId();
  while (metas.some(s => s.id === finalId) || await (await getDB()).get(SAVES_STORE, finalId)) {
    finalId = generateSaveId();
  }

  // 确保名称唯一
  const baseName = String(save.name || '').trim() || '导入存档';
  const finalName = getUniqueImportName(baseName, metas);

  const finalTimestamp = Number(save.timestamp) || Date.now();

  const importedModuleStates = Array.isArray(save.moduleStates)
    ? (save.moduleStates as ModuleStateRecord[]).map(record => ({ ...record, saveId: finalId }))
    : undefined;
  const importedModuleCheckpoints = Array.isArray(save.moduleCheckpoints)
    ? (save.moduleCheckpoints as ModuleStateRecord[]).map(record => ({ ...record, saveId: finalId }))
    : undefined;
  // Export v1 stored gameplay module state inside gameState. The current v2 export
  // carries independent moduleStates/moduleCheckpoints and never needs this fallback.
  const previousVersionPartitions = exportVersion === PREVIOUS_SAVE_EXPORT_VERSION && !importedModuleStates
    ? extractModulePartitions(save.gameState, finalId)
    : undefined;

  const saveData: GameSave = {
    id: finalId,
    name: finalName,
    timestamp: finalTimestamp,
    messages: Array.isArray(save.messages) ? save.messages : [],
    gameState: structuredClone(previousVersionPartitions?.coreState ?? (save.gameState || {})),
    worldId: dependencies.worldId,
    personalInfo: save.personalInfo || undefined,
    characterHistory: save.characterHistory || undefined,
    memoryRuntime: save.memoryRuntime || undefined,
    memoryConfig: save.memoryConfig || undefined,
    vectorMemory: Array.isArray(save.vectorMemory) ? save.vectorMemory : undefined,
    variableConfig: save.variableConfig || undefined,
    customWorld: dependencies.customWorld,
    simulationState: (await import('./importOwnership')).rebindImportedSimulation(save.simulationState || undefined, finalId),
    lifecycle: save.lifecycle === 'ended' ? 'ended' : 'active',
    endedAt: save.endedAt,
    endReason: save.endReason,
    moduleStates: importedModuleStates ?? previousVersionPartitions?.records,
    moduleCheckpoints: importedModuleCheckpoints ?? previousVersionPartitions?.records,
    assetSourceSessionIds: [...new Set([String(save.id || finalId),
      ...(Array.isArray(save.assetSourceSessionIds) ? save.assetSourceSessionIds.filter((id: unknown) => typeof id === 'string') : [])])],
  };

  if (saveData.simulationState && dependencies.worldId !== save.worldId) {
    const rebind = (state: SimulationState) => {
      if (state.director?.pendingReview) state.director.pendingReview.worldId = dependencies.worldId;
      for (const proposal of Object.values(state.director?.offscreenProposals ?? {})) if (proposal.worldId === save.worldId) proposal.worldId = dependencies.worldId;
      for (const child of state.snapshots ?? []) if (child?.snapshot) rebind(child.snapshot);
    };
    rebind(saveData.simulationState);
  }
  saveData.messages = (await import('./importOwnership')).rebindImportedTurnRecovery(save, saveData);

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
    lifecycle: saveData.lifecycle === 'ended' ? 'ended' : 'active',
    endedAt: saveData.endedAt,
    endReason: saveData.endReason,
    assetSourceSessionIds: saveData.assetSourceSessionIds,
  };

  const meta: SaveMeta = {
    id: finalId,
    name: finalName,
    timestamp: finalTimestamp,
    preview: buildPreview(saveData),
    estBytes: messages.length * 500,
    messageCount: messages.length,
    lifecycle: saveData.lifecycle === 'ended' ? 'ended' : 'active',
    endedAt: saveData.endedAt,
    endReason: saveData.endReason,
  };

  const db = await getDB();
  const journalKey = `${SAVE_IMPORT_PREFIX}${owner}`;
  const journal: SaveImportJournal = { owner, saveId: finalId, keys: assets?.map(record => record.key) ?? [], phase: 'applying',
    world: dependencies.world, events: dependencies.events.filter(plan => !plan.existing).map(plan => ({ id: plan.value.id, owner })) };
  await putGlobal(journalKey, journal);
  try {
    applyImportedWorld(dependencies);
    await applyImportedEvents(dependencies.events, owner);
    if (assets) await imageDb.installTransferRecords(assets, owner);
    await saveGameIncremental(finalId, compactHead, messages, saveData.moduleStates, saveData.moduleCheckpoints,
      { importCommit: { journalKey, meta, directorDefinitions: dependencies.definitions, directorReferences: dependencies.references } });
  } catch (error) {
    // Keep the durable journal if compensation fails; startup/import will retry it.
    try { await compensateSaveImport(journal); await db.delete(GLOBAL_STORE, journalKey); }
    catch (recoveryError) {
      console.error('[导入] 依赖恢复待重试:', recoveryError);
      throw new Error(`导入失败，依赖恢复未完成；请保留本机数据，恢复存储后重新打开或重试导入。原错误：${error instanceof Error ? error.message : String(error)}`, { cause: recoveryError });
    }
    throw error;
  }
  invalidateSaveMetaCache();
  if (journalKey) {
    // A cleanup error is not a failed import: the save and commit marker are already atomic.
    await db.delete(GLOBAL_STORE, journalKey).catch(error => console.warn('[导入] 恢复标记待清理:', error));
  }

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
  return findWorldDef(worldId)?.name || worldId;
}
