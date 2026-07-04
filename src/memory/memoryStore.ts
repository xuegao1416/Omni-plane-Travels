// ============================================================
// 记忆系统 Zustand Store
// 核心状态管理 + 配置 + 运行态 + 公开 API
// ============================================================

import { create } from 'zustand';
import type {
  MemorySystemConfig,
  NarrativeMemoryRuntime,
  VectorMemoryItem,
  DebugLog,
  SceneAnchor,
  NarrativeThread,
  NarrativeStateSlot,
  NarrativeRelationEdge,
  NarrativeRelationNetworkItem,
  NarrativeEventCard,
  NarrativeEntityCard,
  NarrativeArchiveCard,
  NarrativeCheckpoint,
  NarrativeMutation,
  SummarySaveRecord,
  CompiledContextSnapshot,
  RuntimeFlowSnapshot,
  RetrievePlanSnapshot,
  CompiledNarrativeContext,
  NarrativeQueryPackage,
  NarrativeRetrieveCandidate,
  VectorFact,
} from './types';
import {
  createDefaultMemorySystemConfig,
  normalizeMemorySystemConfig,
} from './memoryConfig';
import {
  normalizeThread,
  normalizeEventCard,
  normalizeEntityCard,
} from './normalize';
import { STORAGE_KEYS } from '@/config/storageKeys';

// ─── Loading 引用计数（防止并行任务提前关闭 loading 状态） ───
let _loadingRefCount = 0;

// ─── localStorage 持久化 ───

const MEMORY_CONFIG_STORAGE_KEY = STORAGE_KEYS.MEMORY_CONFIG;

function loadMemoryConfigFromStorage(): MemorySystemConfig {
  try {
    const saved = localStorage.getItem(MEMORY_CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      return normalizeMemorySystemConfig(parsed);
    }
  } catch {
    // 忽略解析错误
  }
  return createDefaultMemorySystemConfig();
}

function saveMemoryConfigToStorage(config: MemorySystemConfig): void {
  try {
    localStorage.setItem(MEMORY_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // 忽略存储错误
  }
}

// ─── Store 接口 ───

interface MemoryStoreState {
  // 配置
  config: MemorySystemConfig;

  // 运行态
  memoryRuntime: NarrativeMemoryRuntime | null;

  // 向量记忆（独立于运行态）
  vectorMemory: VectorMemoryItem[];

  // 调试日志
  writeDebugLogs: DebugLog[];
  retrieveDebugLogs: DebugLog[];
  compileDebugLogs: DebugLog[];

  // 编译结果缓存
  lastCompiledContext: CompiledContextSnapshot | null;
  lastRuntimeFlow: RuntimeFlowSnapshot | null;
  lastRetrievePlan: RetrievePlanSnapshot | null;

  // UI 状态
  isLoading: boolean;
  loadingStage: string;
  error: string | null;

  // 版本号（用于触发 UI 刷新）
  runtimeVersion: number;
}

interface MemoryStoreActions {
  // 配置
  setConfig: (config: Partial<MemorySystemConfig>) => void;
  resetConfig: () => void;

  // 运行态管理
  initMemoryRuntime: (bankId?: string) => void;
  getMemoryRuntime: () => NarrativeMemoryRuntime;
  resetMemoryRuntime: () => void;
  bumpRuntimeVersion: () => void;

  // 场景锚点
  updateSceneAnchor: (patch: Partial<SceneAnchor>) => void;

  // 线程管理
  upsertThread: (thread: NarrativeThread) => void;
  removeThread: (id: string) => void;

  // 状态槽管理
  upsertStateSlot: (slot: NarrativeStateSlot) => void;
  removeStateSlot: (id: string) => void;

  // 关系边管理
  upsertRelationEdge: (edge: NarrativeRelationEdge) => void;

  // 关系网管理
  upsertRelationNetworkItem: (item: NarrativeRelationNetworkItem) => void;

  // 事件卡管理
  upsertEventCard: (card: NarrativeEventCard) => void;

  // 实体档案管理
  upsertEntityCard: (card: NarrativeEntityCard) => void;

  // 归档卡管理
  upsertArchiveCard: (card: NarrativeArchiveCard) => void;

  // 向量记忆管理
  setVectorMemory: (memories: VectorMemoryItem[]) => void;
  appendVectorMemories: (memories: VectorMemoryItem[]) => void;
  clearVectorMemory: () => void;

  // Checkpoint
  createCheckpoint: () => NarrativeCheckpoint | null;
  restoreCheckpoint: (checkpointId: string) => boolean;

  // Mutation 日志
  appendMutation: (mutation: NarrativeMutation) => void;

  // 摘要历史
  appendSummarySaveRecord: (record: SummarySaveRecord) => void;

  // 编译结果缓存
  setCompiledContext: (snapshot: CompiledContextSnapshot | null) => void;
  setRuntimeFlow: (snapshot: RuntimeFlowSnapshot | null) => void;
  setRetrievePlan: (plan: RetrievePlanSnapshot | null) => void;
  clearPipelineOutputs: () => void;

  // 调试日志
  appendWriteDebugLog: (log: DebugLog) => void;
  appendRetrieveDebugLog: (log: DebugLog) => void;
  appendCompileDebugLog: (log: DebugLog) => void;
  clearDebugLogs: () => void;

  // Loading 状态
  setLoading: (loading: boolean, stage?: string) => void;
  setError: (error: string | null) => void;

  // 序列化（用于存档）
  toJSON: () => { memoryRuntime: NarrativeMemoryRuntime | null; vectorMemory: VectorMemoryItem[]; config: MemorySystemConfig };
  fromJSON: (data: { memoryRuntime?: unknown; vectorMemory?: unknown[]; config?: unknown }) => void;
}

// ─── 默认运行态 ───

function createDefaultMemoryRuntime(bankId = ''): NarrativeMemoryRuntime {
  return {
    version: 'compiled_context_v2',
    bankId,
    lastIngestCursor: 0,
    lastIngestAttemptAt: 0,
    lastIngestSuccessAt: 0,
    lastIngestFailure: null,
    lastRebuildAt: 0,
    entityCanonicalVersion: 2,
    sceneAnchor: null,
    activeThreads: [],
    stateSlots: [],
    relationEdges: [],
    relationNetwork: [],
    eventCards: [],
    entityCards: [],
    archiveCards: [],
    mutationLog: [],
    checkpoints: [],
    lastCompiledContext: null,
    lastRuntimeFlow: null,
    lastSummarySave: null,
    summarySaveHistory: [],
    lastRetrievePlan: null,
    writeDebugLogs: [],
    retrieveDebugLogs: [],
    compileDebugLogs: [],
    vectorMemory: [],
  };
}

// ─── 运行态归一化 ───

function normalizeMemoryRuntime(raw: unknown): NarrativeMemoryRuntime {
  const defaults = createDefaultMemoryRuntime();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;

  const safe = raw as Record<string, unknown>;
  const normalizeArray = (val: unknown): unknown[] => Array.isArray(val) ? val : [];

  return {
    ...defaults,
    ...safe,
    version: typeof safe.version === 'string' ? safe.version : defaults.version,
    bankId: typeof safe.bankId === 'string' ? safe.bankId : defaults.bankId,
    lastIngestCursor: Math.max(0, Math.floor(Number(safe.lastIngestCursor) || 0)),
    lastIngestAttemptAt: Math.max(0, Math.floor(Number(safe.lastIngestAttemptAt) || 0)),
    lastIngestSuccessAt: Math.max(0, Math.floor(Number(safe.lastIngestSuccessAt) || 0)),
    lastIngestFailure: safe.lastIngestFailure && typeof safe.lastIngestFailure === 'object'
      ? safe.lastIngestFailure as NarrativeMemoryRuntime['lastIngestFailure']
      : null,
    sceneAnchor: safe.sceneAnchor && typeof safe.sceneAnchor === 'object'
      ? safe.sceneAnchor as SceneAnchor
      : null,
    activeThreads: normalizeArray(safe.activeThreads)
      .map((t: unknown) => t && typeof t === 'object' ? normalizeThread(t as Record<string, unknown>) : t)
      .slice(-30) as NarrativeThread[],
    stateSlots: normalizeArray(safe.stateSlots).slice(-30) as NarrativeStateSlot[],
    relationEdges: normalizeArray(safe.relationEdges).slice(-50) as NarrativeRelationEdge[],
    relationNetwork: normalizeArray(safe.relationNetwork).slice(-50) as NarrativeRelationNetworkItem[],
    eventCards: (normalizeArray(safe.eventCards) as unknown[])
      .map((c: unknown) => c && typeof c === 'object' ? normalizeEventCard(c as Record<string, unknown>) : c)
      .sort((a: any, b: any) => (Number(b.importance || 0) - Number(a.importance || 0)) || (Number(b.updatedAt || 0) - Number(a.updatedAt || 0)))
      .slice(0, 50) as NarrativeEventCard[],
    entityCards: normalizeArray(safe.entityCards)
      .map((c: unknown) => c && typeof c === 'object' ? normalizeEntityCard(c as Record<string, unknown>) : c)
      .slice(-30) as NarrativeEntityCard[],
    archiveCards: normalizeArray(safe.archiveCards).slice(-30) as NarrativeArchiveCard[],
    mutationLog: normalizeArray(safe.mutationLog).slice(-50) as NarrativeMutation[],
    checkpoints: normalizeArray(safe.checkpoints).slice(-5) as NarrativeCheckpoint[],
    summarySaveHistory: normalizeArray(safe.summarySaveHistory).slice(-10) as SummarySaveRecord[],
    lastSummarySave: safe.lastSummarySave && typeof safe.lastSummarySave === 'object'
      ? safe.lastSummarySave as SummarySaveRecord
      : null,
    lastCompiledContext: safe.lastCompiledContext && typeof safe.lastCompiledContext === 'object'
      ? safe.lastCompiledContext as CompiledContextSnapshot
      : null,
    lastRuntimeFlow: safe.lastRuntimeFlow && typeof safe.lastRuntimeFlow === 'object'
      ? safe.lastRuntimeFlow as RuntimeFlowSnapshot
      : null,
    lastRetrievePlan: safe.lastRetrievePlan && typeof safe.lastRetrievePlan === 'object'
      ? safe.lastRetrievePlan as RetrievePlanSnapshot
      : null,
    writeDebugLogs: normalizeArray(safe.writeDebugLogs).slice(-100) as DebugLog[],
    retrieveDebugLogs: normalizeArray(safe.retrieveDebugLogs).slice(-100) as DebugLog[],
    compileDebugLogs: normalizeArray(safe.compileDebugLogs).slice(-100) as DebugLog[],
    vectorMemory: normalizeArray(safe.vectorMemory) as VectorMemoryItem[],
  };
}

// ─── 存档瘦身 ───

const SUMMARY_TEXT_MAX_LENGTH = 240;
const SUMMARY_KEYWORDS_MAX = 8;
const SUMMARY_ITEMS_MAX = 8;

/** 截断 summaryData 中的长文本和条数，防止存档膨胀（兜底安全网） */
function slimSummaryData(data: any): any {
  if (!data || typeof data !== 'object') return data;
  const slim = (items: any[] | undefined) => {
    if (!Array.isArray(items)) return items;
    // 保留最新的条目（slice(-N)），丢弃最旧的
    return items.slice(-SUMMARY_ITEMS_MAX).map((item: any) => {
      if (!item || typeof item !== 'object') return item;
      return {
        ...item,
        summary: typeof item.summary === 'string' ? item.summary.slice(0, SUMMARY_TEXT_MAX_LENGTH) : item.summary,
        keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, SUMMARY_KEYWORDS_MAX) : item.keywords,
      };
    });
  };
  return {
    ...data,
    otherCharacterMemories: slim(data.otherCharacterMemories),
    playerMemories: slim(data.playerMemories),
    itemMemories: slim(data.itemMemories),
  };
}

/** 瘦身 checkpoint 内的 snapshot：清空 debug logs、嵌套 checkpoints，截断 summaryData */
function slimCheckpointSnapshot(snapshot: any): any {
  if (!snapshot || typeof snapshot !== 'object') return snapshot;
  return {
    ...snapshot,
    writeDebugLogs: [],
    retrieveDebugLogs: [],
    compileDebugLogs: [],
    checkpoints: [],
    summarySaveHistory: Array.isArray(snapshot.summarySaveHistory)
      ? snapshot.summarySaveHistory.map((r: any) => ({
          ...r,
          summaryData: r.summaryData ? slimSummaryData(r.summaryData) : r.summaryData,
        }))
      : snapshot.summarySaveHistory,
    lastSummarySave: snapshot.lastSummarySave
      ? { ...snapshot.lastSummarySave, summaryData: snapshot.lastSummarySave.summaryData ? slimSummaryData(snapshot.lastSummarySave.summaryData) : undefined }
      : snapshot.lastSummarySave,
  };
}

/** 瘦身 memoryRuntime 用于存档：清空 debug logs、截断 summaryData、瘦身 checkpoint snapshots */
export function slimMemoryRuntimeForSave(runtime: any): any {
  if (!runtime || typeof runtime !== 'object') return runtime;
  return {
    ...runtime,
    writeDebugLogs: [],
    retrieveDebugLogs: [],
    compileDebugLogs: [],
    summarySaveHistory: Array.isArray(runtime.summarySaveHistory)
      ? runtime.summarySaveHistory.map((r: any) => ({
          ...r,
          summaryData: r.summaryData ? slimSummaryData(r.summaryData) : r.summaryData,
        }))
      : runtime.summarySaveHistory,
    lastSummarySave: runtime.lastSummarySave
      ? { ...runtime.lastSummarySave, summaryData: runtime.lastSummarySave.summaryData ? slimSummaryData(runtime.lastSummarySave.summaryData) : undefined }
      : runtime.lastSummarySave,
    checkpoints: Array.isArray(runtime.checkpoints)
      ? runtime.checkpoints.map((cp: any) => ({
          ...cp,
          snapshot: cp.snapshot ? slimCheckpointSnapshot(cp.snapshot) : cp.snapshot,
        }))
      : runtime.checkpoints,
  };
}

// ─── Zustand Store ───

export const useMemoryStore = create<MemoryStoreState & MemoryStoreActions>()((set, get) => ({
  // 初始状态 - 从 localStorage 加载配置，避免刷新后丢失用户设置
  config: loadMemoryConfigFromStorage(),
  memoryRuntime: null,
  vectorMemory: [],
  writeDebugLogs: [],
  retrieveDebugLogs: [],
  compileDebugLogs: [],
  lastCompiledContext: null,
  lastRuntimeFlow: null,
  lastRetrievePlan: null,
  isLoading: false,
  loadingStage: '',
  error: null,
  runtimeVersion: 0,

  // ─── 配置 ───

  setConfig: (patch) => {
    set((state) => {
      const newConfig = normalizeMemorySystemConfig({ ...state.config, ...patch });
      // 同时保存到 localStorage，避免刷新后丢失
      saveMemoryConfigToStorage(newConfig);
      return { config: newConfig };
    });
  },

  resetConfig: () => {
    const defaultConfig = createDefaultMemorySystemConfig();
    saveMemoryConfigToStorage(defaultConfig);
    set({ config: defaultConfig });
  },

  // ─── 运行态管理 ───

  initMemoryRuntime: (bankId = '') => {
    // 始终创建新的运行时，防止跨存档污染
    set({
      memoryRuntime: createDefaultMemoryRuntime(bankId),
      vectorMemory: [],
      lastCompiledContext: null,
      lastRuntimeFlow: null,
      lastRetrievePlan: null,
      writeDebugLogs: [],
      retrieveDebugLogs: [],
      compileDebugLogs: [],
      runtimeVersion: 0,
    });
  },

  getMemoryRuntime: () => {
    const state = get();
    if (!state.memoryRuntime) {
      const runtime = createDefaultMemoryRuntime();
      set({ memoryRuntime: runtime });
      return runtime;
    }
    return state.memoryRuntime;
  },

  resetMemoryRuntime: () => {
    // 注意：只重置运行态数据，保留用户的配置设置
    // 配置应该通过 setConfig 或 fromJSON 单独管理
    set({
      memoryRuntime: null,
      vectorMemory: [],
      lastCompiledContext: null,
      lastRuntimeFlow: null,
      lastRetrievePlan: null,
      writeDebugLogs: [],
      retrieveDebugLogs: [],
      compileDebugLogs: [],
      isLoading: false,
      loadingStage: '',
      error: null,
      runtimeVersion: 0,
    });
  },

  bumpRuntimeVersion: () => {
    set((state) => ({
      runtimeVersion: state.runtimeVersion + 1,
      // 创建新引用，确保 Zustand 检测到变化并触发 React 刷新
      memoryRuntime: state.memoryRuntime ? { ...state.memoryRuntime } : null,
    }));
  },

  // ─── 场景锚点 ───

  updateSceneAnchor: (patch) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const existing = state.memoryRuntime.sceneAnchor;
      return {
        memoryRuntime: {
          ...state.memoryRuntime,
          sceneAnchor: {
            timeLabel: '',
            locationLabel: '',
            presentEntities: [],
            immediateGoal: '',
            immediateRisk: '',
            conversationFocus: '',
            recentChange: '',
            confidence: 0.5,
            ...existing,
            ...patch,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  // ─── 线程管理 ───

  upsertThread: (thread) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const threads = [...state.memoryRuntime.activeThreads];
      const idx = threads.findIndex(t => t.id === thread.id);
      if (idx >= 0) {
        threads[idx] = { ...threads[idx], ...thread, updatedAt: Date.now() };
      } else {
        threads.push({ ...thread, createdAt: thread.createdAt || Date.now(), updatedAt: Date.now() });
      }
      return { memoryRuntime: { ...state.memoryRuntime, activeThreads: threads.slice(-30) } };
    });
  },

  removeThread: (id) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      return {
        memoryRuntime: {
          ...state.memoryRuntime,
          activeThreads: state.memoryRuntime.activeThreads.filter(t => t.id !== id),
        },
      };
    });
  },

  // ─── 状态槽管理 ───

  upsertStateSlot: (slot) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const slots = [...state.memoryRuntime.stateSlots];
      const idx = slots.findIndex(s => s.id === slot.id);
      if (idx >= 0) {
        slots[idx] = { ...slots[idx], ...slot, updatedAt: Date.now() };
      } else {
        slots.push({ ...slot, createdAt: slot.createdAt || Date.now(), updatedAt: Date.now() });
      }
      return { memoryRuntime: { ...state.memoryRuntime, stateSlots: slots.slice(-30) } };
    });
  },

  removeStateSlot: (id) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      return {
        memoryRuntime: {
          ...state.memoryRuntime,
          stateSlots: state.memoryRuntime.stateSlots.filter(s => s.id !== id),
        },
      };
    });
  },

  // ─── 关系边管理 ───

  upsertRelationEdge: (edge) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const edges = [...state.memoryRuntime.relationEdges];
      const idx = edges.findIndex(e => e.id === edge.id);
      if (idx >= 0) {
        edges[idx] = { ...edges[idx], ...edge, updatedAt: Date.now() };
      } else {
        edges.push({ ...edge, createdAt: edge.createdAt || Date.now(), updatedAt: Date.now() });
      }
      return { memoryRuntime: { ...state.memoryRuntime, relationEdges: edges.slice(-50) } };
    });
  },

  // ─── 关系网管理 ───

  upsertRelationNetworkItem: (item) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const network = [...state.memoryRuntime.relationNetwork];
      const idx = network.findIndex(n => n.id === item.id);
      if (idx >= 0) {
        network[idx] = { ...network[idx], ...item, updatedAt: Date.now() };
      } else {
        network.push({ ...item, createdAt: item.createdAt || Date.now(), updatedAt: Date.now() });
      }
      return { memoryRuntime: { ...state.memoryRuntime, relationNetwork: network.slice(-50) } };
    });
  },

  // ─── 事件卡管理 ───

  upsertEventCard: (card) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const cards = [...state.memoryRuntime.eventCards];
      const idx = cards.findIndex(c => c.id === card.id);
      if (idx >= 0) {
        cards[idx] = { ...cards[idx], ...card, updatedAt: Date.now() };
      } else {
        cards.push({ ...card, createdAt: card.createdAt || Date.now(), updatedAt: Date.now() });
      }
      return { memoryRuntime: { ...state.memoryRuntime, eventCards: cards.slice(-50) } };
    });
  },

  // ─── 实体档案管理 ───

  upsertEntityCard: (card) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const cards = [...state.memoryRuntime.entityCards];
      const idx = cards.findIndex(c => c.id === card.id);
      if (idx >= 0) {
        cards[idx] = { ...cards[idx], ...card, updatedAt: Date.now() };
      } else {
        cards.push({ ...card, createdAt: card.createdAt || Date.now(), updatedAt: Date.now() });
      }
      return { memoryRuntime: { ...state.memoryRuntime, entityCards: cards.slice(-30) } };
    });
  },

  // ─── 归档卡管理 ───

  upsertArchiveCard: (card) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const cards = [...state.memoryRuntime.archiveCards];
      const idx = cards.findIndex(c => c.id === card.id);
      if (idx >= 0) {
        cards[idx] = { ...cards[idx], ...card };
      } else {
        cards.push({ ...card, createdAt: card.createdAt || Date.now(), archivedAt: Date.now() });
      }
      return { memoryRuntime: { ...state.memoryRuntime, archiveCards: cards.slice(-30) } };
    });
  },

  // ─── 向量记忆管理 ───

  setVectorMemory: (memories) => {
    set({ vectorMemory: memories });
  },

  appendVectorMemories: (memories) => {
    set((state) => {
      const maxVector = state.config.retention.maxVectorMemories;
      const combined = [...state.vectorMemory, ...memories];
      // 如果超过上限，保留最新的（后面的）
      const trimmed = maxVector > 0 ? combined.slice(-maxVector) : combined;
      return { vectorMemory: trimmed };
    });
  },

  clearVectorMemory: () => {
    set({ vectorMemory: [] });
  },

  // ─── Checkpoint ───

  createCheckpoint: () => {
    const state = get();
    if (!state.memoryRuntime) return null;

    // 执行 retention 策略，防止运行态数组无限增长
    const retention = state.config.retention;
    const currentRound = state.memoryRuntime.lastIngestCursor;

    // 1. 归档已解决的 threads（超过 N 轮未更新）
    const activeThreads = state.memoryRuntime.activeThreads.filter(t => {
      if (t.status === 'resolved' && currentRound - (t.sourceEndIndex || 0) > retention.archiveResolvedThreadsAfter) {
        return false; // 移除，后续可移到 archiveCards
      }
      return true;
    });

    // 2. 限制 eventCards 数量（保留最新的）
    const eventCards = state.memoryRuntime.eventCards.length > retention.maxHotEventCards
      ? state.memoryRuntime.eventCards.slice(-retention.maxHotEventCards)
      : state.memoryRuntime.eventCards;

    // 3. 更新运行态（应用裁剪）
    const prunedRuntime = {
      ...state.memoryRuntime,
      activeThreads,
      eventCards,
    };

    const checkpoint: NarrativeCheckpoint = {
      id: `cp_${Date.now()}`,
      createdAt: Date.now(),
      lastIngestCursor: prunedRuntime.lastIngestCursor,
      activeThreadCount: prunedRuntime.activeThreads.length,
      eventCount: prunedRuntime.eventCards.length,
      entityCount: prunedRuntime.entityCards.length,
      snapshot: JSON.parse(JSON.stringify(slimCheckpointSnapshot(prunedRuntime))),
    };

    set((s) => {
      if (!s.memoryRuntime) return s;
      const MAX_CHECKPOINTS = 10;
      const checkpoints = [...s.memoryRuntime.checkpoints, checkpoint].slice(-MAX_CHECKPOINTS);
      return { memoryRuntime: { ...prunedRuntime, checkpoints } };
    });

    return checkpoint;
  },

  restoreCheckpoint: (checkpointId) => {
    const state = get();
    if (!state.memoryRuntime) return false;

    const checkpoint = state.memoryRuntime.checkpoints.find(cp => cp.id === checkpointId);
    if (!checkpoint?.snapshot) return false;

    const restored = normalizeMemoryRuntime(checkpoint.snapshot);
    restored.checkpoints = state.memoryRuntime.checkpoints;

    // 清除向量记忆（checkpoint 不含 vectorMemory，保留会导致与 runtime 不一致）
    set({ memoryRuntime: restored, vectorMemory: [], runtimeVersion: state.runtimeVersion + 1 });
    return true;
  },

  // ─── Mutation 日志 ───

  appendMutation: (mutation) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const MAX_MUTATION_LOG = 50;
      const mutationLog = [...state.memoryRuntime.mutationLog, { ...mutation, createdAt: mutation.createdAt || Date.now() }].slice(-MAX_MUTATION_LOG);
      return { memoryRuntime: { ...state.memoryRuntime, mutationLog } };
    });
  },

  // ─── 摘要历史 ───

  appendSummarySaveRecord: (record) => {
    set((state) => {
      if (!state.memoryRuntime) return state;
      const MAX_SUMMARY_HISTORY = 10;
      // 写入时截断：防止 AI 产出过多条目导致存档膨胀
      const cappedRecord = record.summaryData ? {
        ...record,
        summaryData: {
          otherCharacterMemories: (record.summaryData.otherCharacterMemories ?? []).slice(0, 4),
          playerMemories: (record.summaryData.playerMemories ?? []).slice(0, 1),
          itemMemories: (record.summaryData.itemMemories ?? []).slice(0, 3),
        },
      } : record;
      const summarySaveHistory = [...state.memoryRuntime.summarySaveHistory, cappedRecord].slice(-MAX_SUMMARY_HISTORY);
      return {
        memoryRuntime: {
          ...state.memoryRuntime,
          summarySaveHistory,
          lastSummarySave: cappedRecord,
        },
      };
    });
  },

  // ─── 编译结果缓存 ───

  setCompiledContext: (snapshot) => {
    set((state) => ({
      lastCompiledContext: snapshot,
      memoryRuntime: state.memoryRuntime
        ? { ...state.memoryRuntime, lastCompiledContext: snapshot }
        : null,
    }));
  },

  setRuntimeFlow: (snapshot) => {
    set((state) => ({
      lastRuntimeFlow: snapshot,
      memoryRuntime: state.memoryRuntime
        ? { ...state.memoryRuntime, lastRuntimeFlow: snapshot }
        : null,
    }));
  },

  setRetrievePlan: (plan) => {
    set((state) => ({
      lastRetrievePlan: plan,
      memoryRuntime: state.memoryRuntime
        ? { ...state.memoryRuntime, lastRetrievePlan: plan }
        : null,
    }));
  },

  clearPipelineOutputs: () => {
    set((state) => ({
      lastCompiledContext: null,
      lastRuntimeFlow: null,
      lastRetrievePlan: null,
      memoryRuntime: state.memoryRuntime
        ? { ...state.memoryRuntime, lastCompiledContext: null, lastRuntimeFlow: null, lastRetrievePlan: null }
        : null,
    }));
  },

  // ─── 调试日志 ───

  appendWriteDebugLog: (log) => {
    set((state) => {
      const maxLogs = state.config.debug.maxLogs;
      const logs = [...state.writeDebugLogs, { ...log, timestamp: log.timestamp || Date.now() }];
      return {
        writeDebugLogs: logs.length > maxLogs ? logs.slice(-maxLogs) : logs,
        memoryRuntime: state.memoryRuntime ? {
          ...state.memoryRuntime,
          writeDebugLogs: logs.length > maxLogs ? logs.slice(-maxLogs) : logs,
        } : null,
      };
    });
  },

  appendRetrieveDebugLog: (log) => {
    set((state) => {
      const maxLogs = state.config.debug.maxLogs;
      const logs = [...state.retrieveDebugLogs, { ...log, timestamp: log.timestamp || Date.now() }];
      return {
        retrieveDebugLogs: logs.length > maxLogs ? logs.slice(-maxLogs) : logs,
        memoryRuntime: state.memoryRuntime ? {
          ...state.memoryRuntime,
          retrieveDebugLogs: logs.length > maxLogs ? logs.slice(-maxLogs) : logs,
        } : null,
      };
    });
  },

  appendCompileDebugLog: (log) => {
    set((state) => {
      const maxLogs = state.config.debug.maxLogs;
      const logs = [...state.compileDebugLogs, { ...log, timestamp: log.timestamp || Date.now() }];
      return {
        compileDebugLogs: logs.length > maxLogs ? logs.slice(-maxLogs) : logs,
        memoryRuntime: state.memoryRuntime ? {
          ...state.memoryRuntime,
          compileDebugLogs: logs.length > maxLogs ? logs.slice(-maxLogs) : logs,
        } : null,
      };
    });
  },

  clearDebugLogs: () => {
    set((state) => ({
      writeDebugLogs: [],
      retrieveDebugLogs: [],
      compileDebugLogs: [],
      memoryRuntime: state.memoryRuntime ? {
        ...state.memoryRuntime,
        writeDebugLogs: [],
        retrieveDebugLogs: [],
        compileDebugLogs: [],
      } : null,
    }));
  },

  // ─── Loading 状态 ───

  setLoading: (loading, stage = '') => {
    if (loading) {
      _loadingRefCount++;
      set({ isLoading: true, loadingStage: stage });
    } else {
      _loadingRefCount = Math.max(0, _loadingRefCount - 1);
      if (_loadingRefCount === 0) {
        set({ isLoading: false, loadingStage: '' });
      }
      // 如果还有其他任务在运行，不关闭 loading
    }
  },

  setError: (error) => {
    set({ error });
  },

  // ─── 序列化 ───

  toJSON: () => {
    const state = get();
    return {
      memoryRuntime: state.memoryRuntime ? slimMemoryRuntimeForSave(state.memoryRuntime) : null,
      vectorMemory: state.vectorMemory,
      config: state.config,
    };
  },

  fromJSON: (data) => {
    // 如果存档中有配置则使用存档的配置，否则保留当前配置（避免丢失用户设置）
    const currentConfig = get().config;
    const config = data.config
      ? normalizeMemorySystemConfig(data.config)
      : currentConfig;

    // 加载时瘦身：旧存档可能包含膨胀的 debug logs、嵌套 checkpoint 等冗余数据
    const memoryRuntime = data.memoryRuntime
      ? slimMemoryRuntimeForSave(normalizeMemoryRuntime(data.memoryRuntime))
      : null;

    const vectorMemory = Array.isArray(data.vectorMemory)
      ? data.vectorMemory as VectorMemoryItem[]
      : [];

    // 同时保存到 localStorage，避免刷新后丢失
    saveMemoryConfigToStorage(config);
    set({ config, memoryRuntime, vectorMemory });
  },
}));
