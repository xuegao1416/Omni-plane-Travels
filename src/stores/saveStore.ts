import { create } from 'zustand';
import { SaveCoordinator, SaveScheduleCancelledError } from '../storage/saveCoordinator';
import type { GameSave, SaveMeta, CompactSaveRecord } from '@/storage/db';
import {
  SaveCreationConflictError,
  saveGameIncremental,
  planMessageSave,
  loadGame as loadGameFromDb,
  deleteSave as deleteSaveFromDb,
  forceDeleteSave as forceDeleteSaveFromDb,
  getAllSaveMeta,
  saveAllSaveMeta,
  invalidateSaveMetaCache,
  buildPreview,
  exportSave as exportSaveFromDb,
  exportSaveCapture,
  recoverPendingSaveImports,
  importSaveFromData,
  autoPruneIfNeeded,
  ACTIVE_SAVE_KEY,
  SAVE_SCHEMA_VERSION,
} from '@/storage/db';

/** 校验 saveId 格式：save_<timestamp>_<random>，过滤 localStorage 脏数据 */
function validateSaveId(raw: string | null): string | null {
  if (!raw) return null;
  if (/^save_\d+_[a-z0-9]{6,}$/.test(raw)) return raw;
  console.warn('[saveStore] 非法 activeSaveId，已忽略:', raw);
  return null;
}

// ─── Store ───

interface SaveState {
  // 状态
  savesMeta: SaveMeta[];
  currentSaveId: string | null;
  currentSaveName: string;
  currentAssetSourceSessionIds: string[];
  /** 本局激活的事件包 id 列表（二级开关：undefined = 用全局已启用列表，[] = 全部关掉） */
  sessionActivePacks: string[] | undefined;

  // 初始化（加载元数据）
  initialize: () => Promise<void>;

  // CRUD
  createSave: (save: GameSave) => Promise<void>;
  loadSave: (saveId: string) => Promise<GameSave | null>;
  activateSave: (save: GameSave) => string | undefined;
  deleteSave: (saveId: string) => Promise<void>;
  forceDeleteSave: (saveId: string) => Promise<void>;
  renameSave: (saveId: string, newName: string) => Promise<void>;
  importSave: (data: any) => Promise<SaveMeta>;
  exportSave: (saveId: string) => Promise<Blob>;

  // 保存（写入 DB + 更新元数据）
  performSave: (saveData: GameSave, options?: { createOnly?: boolean }) => Promise<void>;

  /** 设置本局激活的事件包列表（二级开关） */
  setSessionActivePacks: (packs: string[] | undefined) => void;

  // Coalescing save（防并发）
  saveGame: (buildSaveData: () => GameSave | null) => Promise<void>;

  // Debounce 自动存档
  scheduleAutoSave: () => void;
  flushAutoSave: () => Promise<void>;
  saveFailure: { saveId: string; message: string } | null;
}

const saveCoordinator = new SaveCoordinator({ save: capture => useSaveStore.getState().performSave(capture) });

export const useSaveStore = create<SaveState>((set, get) => ({
  savesMeta: [],
  currentSaveId: validateSaveId(localStorage.getItem(ACTIVE_SAVE_KEY)),
  currentSaveName: '',
  currentAssetSourceSessionIds: [],
  sessionActivePacks: undefined,
  saveFailure: null,

  initialize: async () => {
    try {
      await recoverPendingSaveImports();
      const metas = await getAllSaveMeta();
      set({ savesMeta: metas });
    } catch (err) {
      console.warn('[存档] 初始化失败:', err);
    }
  },

  createSave: save => get().performSave(structuredClone(save), { createOnly: true }),

  loadSave: async (saveId) => {
    try {
      const saveData = await loadGameFromDb(saveId);
      if (!saveData) return null;

      return saveData;
    } catch (err) {
      console.error('[存档] 加载失败:', err);
      return null;
    }
  },

  activateSave: (save) => {
    let warning: string | undefined;
    try { localStorage.setItem(ACTIVE_SAVE_KEY, save.id); }
    catch { warning = '旅程已载入，但未能保存恢复入口。关闭页面前请导出备份。'; }
    set({ currentSaveId: save.id, currentSaveName: save.name, currentAssetSourceSessionIds: save.assetSourceSessionIds ?? [] });
    return warning;
  },

  deleteSave: async (saveId) => {
    console.log(`[存档] 开始删除: ${saveId}`);
    await deleteSaveFromDb(saveId);
    const { savesMeta, currentSaveId } = get();
    const updated = savesMeta.filter(s => s.id !== saveId);
    console.log(`[存档] 删除前 ${savesMeta.length} 条，删除后 ${updated.length} 条`);

    const changes: Partial<SaveState> = { savesMeta: updated };
    if (currentSaveId === saveId) {
      localStorage.removeItem(ACTIVE_SAVE_KEY);
      changes.currentSaveId = null;
      changes.currentSaveName = '';
      changes.currentAssetSourceSessionIds = [];
      console.log(`[存档] 清除 ACTIVE_SAVE_KEY（删除的是当前存档）`);
    }

    set(changes);
    invalidateSaveMetaCache();
    await saveAllSaveMeta(updated);
    console.log(`[存档] 删除完成，已持久化 ${updated.length} 条元数据`);
  },

  forceDeleteSave: async (saveId) => {
    console.log(`[存档] 强制删除: ${saveId}`);
    await forceDeleteSaveFromDb(saveId);
    const { savesMeta, currentSaveId } = get();
    const updated = savesMeta.filter(s => s.id !== saveId);

    const changes: Partial<SaveState> = { savesMeta: updated };
    if (currentSaveId === saveId) {
      changes.currentSaveId = null;
      changes.currentSaveName = '';
      changes.currentAssetSourceSessionIds = [];
    }

    set(changes);
    invalidateSaveMetaCache();
    console.log(`[存档] 强制删除完成`);
  },

  renameSave: async (saveId, newName) => {
    // 只更新头部 name 字段，不涉及 messages（避免把新格式降级回老格式）
    const { savesMeta, currentSaveId } = get();
    const existingMeta = savesMeta.find(m => m.id === saveId);
    if (!existingMeta) return;

    const newTimestamp = Date.now();

    // 更新元数据
    const meta: SaveMeta = {
      ...existingMeta,
      id: saveId,
      name: newName,
      timestamp: newTimestamp,
      preview: existingMeta.preview, // 预览文本不变
    };

    const updated = savesMeta.map(m => m.id === saveId ? meta : m);

    const changes: Partial<SaveState> = { savesMeta: updated };
    if (currentSaveId === saveId) {
      changes.currentSaveName = newName;
    }

    set(changes);
    await saveAllSaveMeta(updated);

    // 直接更新 saves store 中头部记录的 name/timestamp 字段
    try {
      const { updateSaveHead } = await import('@/storage/db');
      await updateSaveHead(saveId, { name: newName, timestamp: newTimestamp });
    } catch (err) {
      console.warn('[存档] 更新头部 name 失败:', err);
    }
  },

  importSave: async (data) => {
    try {
      const meta = await importSaveFromData(data);
      const metas = await getAllSaveMeta();
      set({ savesMeta: metas });
      return meta;
    } catch (err) {
      console.error('[存档] 导入失败:', err);
      throw err;
    }
  },

  exportSave: async (saveId) => {
    return exportSaveFromDb(saveId);
  },

  performSave: async (saveData, options) => {
    // 配额治理：检查配额，不足时自动清理冷消息
    await autoPruneIfNeeded(saveData.id);

    const allMessages = saveData.messages || [];
    const meta: SaveMeta = {
      id: saveData.id, name: saveData.name, timestamp: saveData.timestamp, preview: buildPreview(saveData),
      estBytes: allMessages.length * 500, messageCount: allMessages.length,
      lifecycle: saveData.lifecycle === 'ended' ? 'ended' : 'active', endedAt: saveData.endedAt, endReason: saveData.endReason,
    };
    // Replayed turns, edits and post-generation checkpoints can change a saved
    // sequence. Persist changed content and delete removed slots atomically.
    const { changedMessages: newMessages, replaceMessages: needsFullRewrite } = await planMessageSave(saveData.id, allMessages);

    // 快照只保存模块修订号；持久层也只保留当前修订和仍可回滚到的修订正文。
    const keptModuleRevisions = new Set<string>();
    for (const record of saveData.moduleStates ?? []) {
      keptModuleRevisions.add(`${record.moduleId}#${record.revision}`);
    }
    for (const message of allMessages) {
      const revisions = (message.snapshot as { moduleRevisions?: Record<string, number> } | undefined)?.moduleRevisions;
      if (!revisions) continue;
      for (const [moduleId, revision] of Object.entries(revisions)) {
        if (Number.isFinite(revision)) keptModuleRevisions.add(`${moduleId}#${revision}`);
      }
    }
    const moduleCheckpoints = (saveData.moduleCheckpoints ?? []).filter(record => (
      keptModuleRevisions.has(`${record.moduleId}#${record.revision}`)
    ));

    // 构建紧凑头部（不含 messages）
    const compactHead: Omit<CompactSaveRecord, 'messageCount' | 'lastMessageSeq'> = {
      id: saveData.id,
      name: saveData.name,
      timestamp: saveData.timestamp,
      schemaVersion: SAVE_SCHEMA_VERSION,
      round: allMessages.reduce((max, m) => Math.max(max, m.round), 0),
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

    // 关键写入：存档数据（失败则导出兜底）
    try {
      await saveGameIncremental(
        saveData.id,
        compactHead,
        newMessages,
        saveData.moduleStates,
        moduleCheckpoints,
        { replaceMessages: needsFullRewrite, keptModuleRevisions, createCommit: options?.createOnly ? meta : undefined },
      );
    } catch (err) {
      if (err instanceof SaveCreationConflictError) throw err;
      console.error('[存档] 存档数据写入失败:', err);
      // 尝试兜底导出
      try {
        const blob = await exportSaveCapture(saveData);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `save-backup-${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url);
        console.warn('[存档] 已自动导出备份 JSON');
      } catch (exportErr) {
        console.error('[存档] 导出备份也失败:', exportErr);
      }
      throw err;
    }

    // 非关键写入：元数据更新（失败不阻塞，下次 loadSave 会自愈）

    const { savesMeta } = get();
    const idx = savesMeta.findIndex(m => m.id === meta.id);
    const updated = idx >= 0
      ? savesMeta.map((m, i) => i === idx ? meta : m)
      : [...savesMeta, meta];

    set({ savesMeta: updated });
    if (options?.createOnly) { invalidateSaveMetaCache(); return; }
    try {
      await saveAllSaveMeta(updated);
    } catch (err) {
      // 元数据写入失败不影响存档本身，内存中已更新
      console.warn('[存档] 元数据持久化失败（内存已更新，不影响游戏）:', err);
    }
  },

  saveGame: async (buildSaveData) => {
    const capture = buildSaveData();
    if (!capture) throw new Error('无法捕获当前旅程，进度尚未保存。');
    await saveCoordinator.request(capture);
  },

  scheduleAutoSave: () => {
    const saveId = get().currentSaveId, builder = _autoSaveBuilder;
    if (!saveId || !builder) return;
    void saveCoordinator.scheduleCapture(saveId, () => {
      if (get().currentSaveId !== saveId || _autoSaveBuilder !== builder) return null;
      const capture = builder();
      return capture?.id === saveId ? capture : null;
    }).catch(error => {
      if (!(error instanceof SaveScheduleCancelledError)) console.error('[auto-save] 保存失败，当前完整进度仍可重试或导出:', error);
    });
  },

  flushAutoSave: async () => {
    await saveCoordinator.request(buildCurrentSave());
  },

  setSessionActivePacks: (packs) => {
    set({ sessionActivePacks: packs });
  },

}));

saveCoordinator.subscribe(outcome => {
  if (outcome.status === 'failed') useSaveStore.setState({ saveFailure: {
    saveId: outcome.saveId, message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
  } });
  else if (useSaveStore.getState().saveFailure?.saveId === outcome.saveId) useSaveStore.setState({ saveFailure: null });
});

// A delayed builder reads live engine state. Discard it when its journey owner
// changes; normal leave/navigation flushes the old journey before switching.
useSaveStore.subscribe((state, previous) => {
  if (state.currentSaveId !== previous.currentSaveId && previous.currentSaveId) saveCoordinator.cancelScheduled(previous.currentSaveId);
});

// ─── 自动存档 builder（由 GameContext 注入） ───

let _autoSaveBuilder: (() => GameSave | null) | null = null;

function buildCurrentSave(): GameSave {
  const capture = _autoSaveBuilder?.();
  if (!capture || capture.id !== useSaveStore.getState().currentSaveId) throw new Error('当前旅程身份或捕获尚未就绪，进度未保存。');
  return capture;
}

export function captureCurrentSave(): GameSave {
  return structuredClone(buildCurrentSave());
}

/** 注入自动存档的 buildSaveData 函数（由 GameContext 调用） */
export function setAutoSaveBuilder(builder: () => GameSave | null) {
  console.log('[auto-save] 注入 _autoSaveBuilder');
  saveCoordinator.cancelScheduled();
  _autoSaveBuilder = builder;
}

/** 重置模块级变量，防止新建存档时旧存档的数据污染 */
export function resetForNewGame() {
  saveCoordinator.cancelScheduled();
  // 注意：不要清空 _autoSaveBuilder，否则自动存档会失效
  // _autoSaveBuilder 由 GameContext 的 useEffect 注入，生命周期与组件一致
}
