// 生图配置 + 运行时任务 Zustand Store
import { create } from 'zustand';
import { STORAGE_KEYS } from '@/config/storageKeys';
import type { ImageGenConfig, ImageTask } from '@/api/imageGenTypes';
import { DEFAULT_IMAGE_CONFIG } from '@/api/imageGenTypes';

const CONFIG_KEY = STORAGE_KEYS.IMAGE_CONFIG;

// ─── 持久化读取 ───

function loadImageConfig(): ImageGenConfig {
  try {
    const saved = localStorage.getItem(CONFIG_KEY);
    if (saved) return { ...DEFAULT_IMAGE_CONFIG, ...JSON.parse(saved) };
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
  addTask: (task: ImageTask) => void;
  updateTask: (id: string, updates: Partial<ImageTask>) => void;
  removeTask: (id: string) => void;
  setTasks: (tasks: ImageTask[]) => void;
  setComfyData: (data: ImageStoreState['comfyData']) => void;
}

export const useImageStore = create<ImageStoreState>((set) => ({
  config: loadImageConfig(),
  tasks: [],
  comfyData: { models: [], samplers: [], schedulers: [], vaes: [], loras: [], objectInfo: {} },

  updateConfig: (key, value) => {
    set((state) => {
      const newConfig = { ...state.config, [key]: value };
      localStorage.setItem(CONFIG_KEY, JSON.stringify(newConfig));
      return { config: newConfig };
    });
  },

  setConfig: (config) => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    set({ config });
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
