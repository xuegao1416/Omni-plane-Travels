// 生图配置 + 运行时任务 Zustand Store
import { create } from 'zustand';
import { STORAGE_KEYS } from '@/config/storageKeys';
import type { ImageGenConfig, ImageTask } from '@/api/imageGenTypes';
import { DEFAULT_IMAGE_CONFIG } from '@/api/imageGenTypes';
import { seal, unseal } from '@/security/keyVault';

const CONFIG_KEY = STORAGE_KEYS.IMAGE_CONFIG;

// ─── 持久化读取 ───

/** 加密含 apiKey 的字段（apiKey / openaiCompatibleApiKey），其余原样 */
async function sealImageConfig(cfg: ImageGenConfig): Promise<ImageGenConfig> {
  return {
    ...cfg,
    apiKey: await seal(cfg.apiKey ?? ''),
    openaiCompatibleApiKey: await seal((cfg as any).openaiCompatibleApiKey ?? ''),
  };
}

/** 解密含 apiKey 的字段，返回内存态明文 */
async function unsealImageConfig(cfg: ImageGenConfig): Promise<ImageGenConfig> {
  return {
    ...cfg,
    apiKey: await unseal(cfg.apiKey ?? ''),
    openaiCompatibleApiKey: await unseal((cfg as any).openaiCompatibleApiKey ?? ''),
  };
}

async function loadImageConfig(): Promise<ImageGenConfig> {
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) return { ...DEFAULT_IMAGE_CONFIG, ...(await unsealImageConfig(JSON.parse(saved))) };
  } catch (e) {
    console.warn('[imageStore] loadImageConfig 解析失败，使用默认值:', e);
  }
  return { ...DEFAULT_IMAGE_CONFIG };
}

// ─── Store ───

interface ImageStoreState {
  config: ImageGenConfig;
  tasks: ImageTask[];
  comfyData: {
    models: string[];
    samplers: string[];
    schedulers: string[];
    vaes: string[];
    loras: string[];
    objectInfo: Record<string, unknown>;
  };
  // Actions
  updateConfig: <K extends keyof ImageGenConfig>(key: K, value: ImageGenConfig[K]) => void;
  setConfig: (config: ImageGenConfig) => void;
  /** 应用启动时异步加载（解密）已持久化的生图配置 */
  initImageConfig: () => void;
  addTask: (task: ImageTask) => void;
  updateTask: (id: string, updates: Partial<ImageTask>) => void;
  removeTask: (id: string) => void;
  setTasks: (tasks: ImageTask[]) => void;
  setComfyData: (data: ImageStoreState['comfyData']) => void;
}

export const useImageStore = create<ImageStoreState>((set) => ({
  config: { ...DEFAULT_IMAGE_CONFIG }, // 由 initImageConfig 异步加载（解密）
  tasks: [],
  comfyData: { models: [], samplers: [], schedulers: [], vaes: [], loras: [], objectInfo: {} },

  updateConfig: (key, value) => {
    set((state) => {
      const newConfig = { ...state.config, [key]: value };
      // 落库前加密 apiKey 字段（异步，不阻塞 UI）
      sealImageConfig(newConfig)
        .then((sealed) => localStorage.setItem(CONFIG_KEY, JSON.stringify(sealed)))
        .catch((err) => console.warn('[imageStore] 加密失败:', err));
      return { config: newConfig };
    });
  },

  setConfig: async (config) => {
    // 落库前加密 apiKey 字段
    const sealed = await sealImageConfig(config);
    localStorage.setItem(CONFIG_KEY, JSON.stringify(sealed));
    set({ config });
  },

  initImageConfig: () => {
    loadImageConfig()
      .then((cfg) => {
        // 迁移：将遗留明文重新加密落库
        sealImageConfig(cfg)
          .then((sealed) => localStorage.setItem(CONFIG_KEY, JSON.stringify(sealed)))
          .catch(() => {});
        set({ config: cfg });
      })
      .catch((err) => console.warn('[imageStore] 初始化生图配置失败:', err));
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
