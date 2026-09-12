import { create } from 'zustand';
import type { ApiConfig } from '../api/types';
import { seal, unseal } from '../security/keyVault';

export interface NovelWorkbenchConfig {
  api: ApiConfig;
  embeddingMode: 'off' | 'inherit' | 'local_endpoint';
  embeddingEndpoint: string;
  embeddingModel: string;
  /** 拆解分析请求的最小间隔（毫秒），独立于游戏内限流；0 表示不限流。 */
  analysisRateLimitMs: number;
  /** 向量检索请求的批间间隔（毫秒）；0 表示不限流。 */
  embeddingRateLimitMs: number;
}
export const DEFAULT_NOVEL_CONFIG: NovelWorkbenchConfig = {
  api: { provider: 'custom', baseUrl: '', apiKey: '', model: '', temperature: 0.2, maxTokens: 8192, stream: true },
  embeddingMode: 'off', embeddingEndpoint: 'http://127.0.0.1:1234/v1', embeddingModel: '',
  analysisRateLimitMs: 3000, embeddingRateLimitMs: 1000,
};
const STORAGE_KEY = 'omni-plane-travels.novel-config.v1';
export const useNovelConfigStore = create<{
  config: NovelWorkbenchConfig; loaded: boolean;
  initialize: () => Promise<void>; save: (config: NovelWorkbenchConfig) => Promise<void>;
}>((set, get) => ({
  config: DEFAULT_NOVEL_CONFIG, loaded: false,
  initialize: async () => {
    if (get().loaded) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as NovelWorkbenchConfig;
        set({ config: { ...DEFAULT_NOVEL_CONFIG, ...stored, api: { ...DEFAULT_NOVEL_CONFIG.api, ...stored.api, apiKey: await unseal(stored.api.apiKey) } } });
      }
    } finally { set({ loaded: true }); }
  },
  save: async config => {
    const persisted = { ...config, api: { ...config.api, apiKey: await seal(config.api.apiKey) } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
    set({ config });
  },
}));
