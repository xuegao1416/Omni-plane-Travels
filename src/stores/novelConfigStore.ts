import { create } from 'zustand';
import type { ApiConfig } from '../api/types';
import { isSealed, sealResult, unsealResult } from '../security/keyVault';

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
let revision = 0;
let initialization: Promise<void> | null = null;
let saveQueue: Promise<unknown> = Promise.resolve();
export const useNovelConfigStore = create<{
  config: NovelWorkbenchConfig; loaded: boolean;
  recoveryError: string | null; warning: string | null;
  initialize: () => Promise<void>; save: (config: NovelWorkbenchConfig) => Promise<void>;
}>((set, get) => ({
  config: structuredClone(DEFAULT_NOVEL_CONFIG), loaded: false, recoveryError: null, warning: null,
  initialize: () => {
    if (initialization) return initialization;
    if (get().loaded) return Promise.resolve();
    const expected = revision;
    initialization = (async () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const stored = raw ? JSON.parse(raw) as NovelWorkbenchConfig : DEFAULT_NOVEL_CONFIG;
        if (!stored || typeof stored !== 'object' || !stored.api || typeof stored.api.apiKey !== 'string') throw Error('拆解配置格式无效，原记录已保留。');
        const decoded = await unsealResult(stored.api.apiKey);
        if (decoded.status === 'error') throw Error(decoded.message);
        if (revision !== expected) return;
        if (localStorage.getItem(STORAGE_KEY) !== raw) throw Error('拆解配置在读取期间已变化，请重新读取。');
        set({ config: { ...DEFAULT_NOVEL_CONFIG, ...stored, api: { ...DEFAULT_NOVEL_CONFIG.api, ...stored.api, apiKey: decoded.value } }, loaded: true, recoveryError: null });
        if (raw && stored.api.apiKey && !isSealed(stored.api.apiKey)) {
          try {
            const sealed = await sealResult(decoded.value);
            if (sealed.status === 'error') throw Error(sealed.message);
            if (revision === expected && localStorage.getItem(STORAGE_KEY) === raw) {
              localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stored, api: { ...stored.api, apiKey: sealed.value } }));
              set({ warning: sealed.status === 'degraded' ? sealed.warning : null });
            }
          } catch (error) {
            if (revision === expected) set({ warning: `拆解配置加密迁移未完成：${error instanceof Error ? error.message : String(error)}` });
          }
        }
      } catch (error) {
        if (revision === expected) set({ loaded: false, recoveryError: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    })().finally(() => { initialization = null; });
    return initialization;
  },
  save: config => {
    const captured = structuredClone(config); revision++;
    const operation = saveQueue.then(async () => {
      const original = localStorage.getItem(STORAGE_KEY);
      if (isSealed(captured.api.apiKey)) throw Error('拆解密钥尚未解密，未保存。');
      const sealed = await sealResult(captured.api.apiKey);
      if (sealed.status === 'error') throw Error(sealed.message);
      if (localStorage.getItem(STORAGE_KEY) !== original) throw Error('拆解配置在其他页面已变化，请重新读取后保存。');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...captured, api: { ...captured.api, apiKey: sealed.value } }));
      set({ config: captured, loaded: true, recoveryError: null, warning: sealed.status === 'degraded' ? sealed.warning : null });
    });
    saveQueue = operation.catch(() => {});
    return operation;
  },
}));
