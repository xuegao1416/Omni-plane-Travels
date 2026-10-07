// 生图配置 + 运行时任务 Zustand Store
import { create } from 'zustand';
import { STORAGE_KEYS } from '@/config/storageKeys';
import type { ImageGenConfig, ImageTask } from '@/api/imageGenTypes';
import { DEFAULT_IMAGE_CONFIG } from '@/api/imageGenTypes';
import { sealResult, unsealResult, isSealed } from '@/security/keyVault';

const CONFIG_KEY = STORAGE_KEYS.IMAGE_CONFIG;

// ─── 持久化读取 ───

/** 加密含 apiKey 的字段（apiKey / openaiCompatibleApiKey / kreaApiKey），其余原样 */
async function sealImageConfig(cfg: ImageGenConfig): Promise<{ config: ImageGenConfig; warning: string | null }> {
  const encoded = structuredClone(cfg);
  const warnings: string[] = [];
  for (const key of ['apiKey', 'openaiCompatibleApiKey', 'kreaApiKey'] as const) {
    if (isSealed(cfg[key] ?? '')) throw Error('生图密钥尚未解密，未保存。');
    const result = await sealResult(cfg[key] ?? '');
    if (result.status === 'error') throw Error(result.message);
    if (result.status === 'degraded') warnings.push(result.warning);
    encoded[key] = result.value;
  }
  return { config: encoded, warning: [...new Set(warnings)].join('；') || null };
}

/** 解密含 apiKey 的字段，返回内存态明文 */
async function unsealImageConfig(cfg: ImageGenConfig): Promise<ImageGenConfig> {
  const decoded = structuredClone(cfg);
  for (const key of ['apiKey', 'openaiCompatibleApiKey', 'kreaApiKey'] as const) {
    if (cfg[key] !== undefined && typeof cfg[key] !== 'string') throw Error('生图密钥格式无效，原记录已保留。');
    const result = await unsealResult(cfg[key] ?? '');
    if (result.status === 'error') throw Error(result.message);
    decoded[key] = result.value;
  }
  return decoded;
}
let configRevision = 0;
let configInitialization: Promise<void> | null = null;
let configSaveQueue: Promise<unknown> = Promise.resolve();

// ─── Store ───

interface ImageStoreState {
  config: ImageGenConfig;
  configLoaded: boolean;
  configRecoveryError: string | null;
  configWarning: string | null;
  tasks: ImageTask[];
  comfyData: {
    models: string[];
    unetModels: string[];
    samplers: string[];
    schedulers: string[];
    vaes: string[];
    loras: string[];
    objectInfo: Record<string, unknown>;
  };
  // Actions
  setConfig: (config: ImageGenConfig) => Promise<void>;
  /** 应用启动时异步加载（解密）已持久化的生图配置 */
  initImageConfig: () => Promise<void>;
  addTask: (task: ImageTask) => void;
  updateTask: (id: string, updates: Partial<ImageTask>) => void;
  removeTask: (id: string) => void;
  setTasks: (tasks: ImageTask[]) => void;
  setComfyData: (data: ImageStoreState['comfyData']) => void;
}

export const useImageStore = create<ImageStoreState>((set) => ({
  config: structuredClone(DEFAULT_IMAGE_CONFIG), // 由 initImageConfig 异步加载（解密）
  configLoaded: false, configRecoveryError: null, configWarning: null,
  tasks: [],
  comfyData: { models: [], unetModels: [], samplers: [], schedulers: [], vaes: [], loras: [], objectInfo: {} },

  setConfig: config => {
    const captured = structuredClone(config); configRevision++;
    const operation = configSaveQueue.then(async () => {
      const original = localStorage.getItem(CONFIG_KEY);
      const sealed = await sealImageConfig(captured);
      if (localStorage.getItem(CONFIG_KEY) !== original) throw Error('生图配置在其他页面已变化，请重新读取后保存。');
      localStorage.setItem(CONFIG_KEY, JSON.stringify(sealed.config));
      set({ config: captured, configLoaded: true, configRecoveryError: null, configWarning: sealed.warning });
    });
    configSaveQueue = operation.catch(() => {});
    return operation;
  },

  initImageConfig: () => {
    if (configInitialization) return configInitialization;
    const expected = configRevision;
    configInitialization = (async () => {
      try {
        const raw = localStorage.getItem(CONFIG_KEY);
        const stored = raw ? JSON.parse(raw) as ImageGenConfig : DEFAULT_IMAGE_CONFIG;
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw Error('生图配置格式无效，原记录已保留。');
        const config = { ...structuredClone(DEFAULT_IMAGE_CONFIG), ...await unsealImageConfig(stored) };
        if (configRevision !== expected) return;
        if (localStorage.getItem(CONFIG_KEY) !== raw) throw Error('生图配置在读取期间已变化，请重新读取。');
        set({ config, configLoaded: true, configRecoveryError: null });
        // Only a successfully decoded legacy record may be migrated. No record means no write.
        if (raw && ['apiKey', 'openaiCompatibleApiKey', 'kreaApiKey'].some(key => {
          const value = stored[key as keyof ImageGenConfig]; return typeof value === 'string' && value && !isSealed(value);
        })) {
          try {
            const sealed = await sealImageConfig(config);
            if (configRevision === expected && localStorage.getItem(CONFIG_KEY) === raw) {
              localStorage.setItem(CONFIG_KEY, JSON.stringify(sealed.config));
              set({ configWarning: sealed.warning });
            }
          } catch (error) {
            if (configRevision === expected) set({ configRecoveryError: `生图配置加密迁移未完成：${error instanceof Error ? error.message : String(error)}` });
          }
        }
      } catch (error) {
        if (configRevision === expected) set({ configLoaded: false, configRecoveryError: error instanceof Error ? error.message : String(error) });
      }
    })().finally(() => { configInitialization = null; });
    return configInitialization;
  },

  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),

  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  removeTask: (id) => set((state) => ({ tasks: state.tasks.filter((t) => t.id !== id) })),

  setTasks: (tasks) => set({ tasks }),

  setComfyData: (comfyData) => set({ comfyData }),
}));

// 应用启动时异步加载（解密）已持久化的生图配置
useImageStore.getState().initImageConfig();
