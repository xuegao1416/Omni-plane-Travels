import { create } from 'zustand';
import type { GameSave, SaveMeta } from '@/storage/db';
import {
  saveGame as saveGameToDb,
  loadGame as loadGameFromDb,
  deleteSave as deleteSaveFromDb,
  forceDeleteSave as forceDeleteSaveFromDb,
  getAllSaveMeta,
  saveAllSaveMeta,
  invalidateSaveMetaCache,
  generateSaveId,
  buildPreview,
  exportSave as exportSaveFromDb,
  importSaveFromData,
  ACTIVE_SAVE_KEY,
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

  // 初始化（加载元数据）
  initialize: () => Promise<void>;

  // CRUD
  createNewGame: (saveName: string) => Promise<string>;
  loadSave: (saveId: string) => Promise<GameSave | null>;
  deleteSave: (saveId: string) => Promise<void>;
  forceDeleteSave: (saveId: string) => Promise<void>;
  renameSave: (saveId: string, newName: string) => Promise<void>;
  importSave: (data: any) => Promise<SaveMeta | null>;
  exportSave: (saveId: string) => Promise<Blob>;

  // 保存（写入 DB + 更新元数据）
  performSave: (saveData: GameSave) => Promise<void>;

  // Coalescing save（防并发）
  saveGame: (buildSaveData: () => GameSave | null) => Promise<void>;

  // Debounce 自动存档
  scheduleAutoSave: () => void;
  flushAutoSave: (buildSaveData: () => GameSave | null) => Promise<void>;
}

let _savePromise: Promise<void> | null = null;
let _saveQueued = false;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useSaveStore = create<SaveState>((set, get) => ({
  savesMeta: [],
  currentSaveId: validateSaveId(localStorage.getItem(ACTIVE_SAVE_KEY)),
  currentSaveName: '',

  initialize: async () => {
    try {
      const metas = await getAllSaveMeta();
      set({ savesMeta: metas });
    } catch (err) {
      console.warn('[存档] 初始化失败:', err);
    }
  },

  createNewGame: async (saveName) => {
    const { savesMeta } = get();
    if (savesMeta.some(s => s.name === saveName)) {
      throw new Error('存档名称已存在');
    }

    const saveId = generateSaveId();
    localStorage.setItem(ACTIVE_SAVE_KEY, saveId);
    set({ currentSaveId: saveId, currentSaveName: saveName });

    return saveId;
  },

  loadSave: async (saveId) => {
    try {
      const saveData = await loadGameFromDb(saveId);
      if (!saveData) return null;

      localStorage.setItem(ACTIVE_SAVE_KEY, saveId);
      set({ currentSaveId: saveId, currentSaveName: saveData.name });

      return saveData;
    } catch (err) {
      console.error('[存档] 加载失败:', err);
      return null;
    }
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
    }

    set(changes);
    invalidateSaveMetaCache();
    console.log(`[存档] 强制删除完成`);
  },

  renameSave: async (saveId, newName) => {
    const fullSave = await loadGameFromDb(saveId);
    if (!fullSave) return;

    fullSave.name = newName;
    fullSave.timestamp = Date.now();
    await saveGameToDb(fullSave);

    const meta: SaveMeta = {
      id: fullSave.id,
      name: newName,
      timestamp: fullSave.timestamp,
      preview: buildPreview(fullSave),
    };

    const { savesMeta, currentSaveId } = get();
    const updated = savesMeta.map(m => m.id === saveId ? meta : m);

    const changes: Partial<SaveState> = { savesMeta: updated };
    if (currentSaveId === saveId) {
      changes.currentSaveName = newName;
    }

    set(changes);
    await saveAllSaveMeta(updated);
  },

  importSave: async (data) => {
    try {
      const meta = await importSaveFromData(data);
      const metas = await getAllSaveMeta();
      set({ savesMeta: metas });
      return meta;
    } catch (err) {
      console.error('[存档] 导入失败:', err);
      return null;
    }
  },

  exportSave: async (saveId) => {
    return exportSaveFromDb(saveId);
  },

  performSave: async (saveData) => {
    await saveGameToDb(saveData);

    const meta: SaveMeta = {
      id: saveData.id,
      name: saveData.name,
      timestamp: saveData.timestamp,
      preview: buildPreview(saveData),
    };

    const { savesMeta } = get();
    const idx = savesMeta.findIndex(m => m.id === meta.id);
    const updated = idx >= 0
      ? savesMeta.map((m, i) => i === idx ? meta : m)
      : [...savesMeta, meta];

    set({ savesMeta: updated });
    await saveAllSaveMeta(updated);
  },

  saveGame: async (buildSaveData) => {
    if (_savePromise) {
      _saveQueued = true;
      return _savePromise;
    }

    const run = async () => {
      do {
        _saveQueued = false;
        const saveData = buildSaveData();
        if (saveData) {
          await get().performSave(saveData);
        }
      } while (_saveQueued);
    };

    _savePromise = run();
    try {
      await _savePromise;
    } finally {
      _savePromise = null;
    }
  },

  scheduleAutoSave: () => {
    if (_saveTimer) clearTimeout(_saveTimer);
    // debounce 500ms 后通过全局注入的 _autoSaveBuilder 执行保存
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      if (_autoSaveBuilder) {
        console.log('[auto-save] 触发自动存档...');
        get().saveGame(_autoSaveBuilder).catch(err => console.warn('[auto-save] 保存失败:', err));
      } else {
        console.warn('[auto-save] _autoSaveBuilder 未注入，跳过存档');
      }
    }, 500);
  },

  flushAutoSave: async (buildSaveData) => {
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
    await get().saveGame(buildSaveData);
  },
}));

// ─── 自动存档 builder（由 GameContext 注入） ───

let _autoSaveBuilder: (() => GameSave | null) | null = null;

/** 注入自动存档的 buildSaveData 函数（由 GameContext 调用） */
export function setAutoSaveBuilder(builder: () => GameSave | null) {
  console.log('[auto-save] 注入 _autoSaveBuilder');
  _autoSaveBuilder = builder;
}

/** 重置模块级变量，防止新建存档时旧存档的数据污染 */
export function resetForNewGame() {
  if (_saveTimer) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
  _saveQueued = false;
  _savePromise = null;
  // 注意：不要清空 _autoSaveBuilder，否则自动存档会失效
  // _autoSaveBuilder 由 GameContext 的 useEffect 注入，生命周期与组件一致
}
