import { useEffect, useSyncExternalStore } from 'react';
import type { ApiPreset } from '../api/presets';
import { STORAGE_KEYS } from '../config/storageKeys';
import { isSealed, sealResult, unsealResult, type SealResult, type UnsealResult } from '../security/keyVault';

interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; }
interface Secrets { seal(key: string): Promise<SealResult>; unseal(key: string): Promise<UnsealResult>; }
interface PresetSnapshot { presets: ApiPreset[]; initialized: boolean; error: string | null; warning: string | null; }
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function parse(raw: string | null): ApiPreset[] {
  const parsed: unknown = raw === null ? [] : JSON.parse(raw);
  const ids = new Set<string>();
  if (!Array.isArray(parsed)) throw new Error('API 预设格式无效，原记录已保留。');
  for (const preset of parsed) {
    const config = preset?.config;
    if (!preset || typeof preset.id !== 'string' || !preset.id || ids.has(preset.id) || typeof preset.name !== 'string'
      || !Number.isFinite(preset.createdAt) || !config || typeof config.apiKey !== 'string'
      || typeof config.baseUrl !== 'string' || typeof config.model !== 'string'
      || !['openai', 'deepseek', 'google', 'custom'].includes(config.provider)) {
      throw new Error('API 预设格式无效，原记录已保留。');
    }
    ids.add(preset.id);
  }
  return parsed;
}

/** One committed preset list for UI and all request pipelines. Writes publish only after storage accepts them. */
export class ApiPresetStore {
  private snapshot: PresetSnapshot = freeze({ presets: [], initialized: false, error: null, warning: null });
  private listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private initialization: Promise<void> | null = null;
  private raw: string | null = null;
  constructor(private readonly storage: () => StoragePort = () => localStorage,
    private readonly secrets: Secrets = { seal: sealResult, unseal: unsealResult }) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(snapshot: PresetSnapshot) { this.snapshot = freeze(snapshot); this.listeners.forEach(listener => listener()); }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(action); this.queue = operation.catch(() => {}); return operation;
  }
  private async encode(presets: ApiPreset[]) {
    const warnings: string[] = [];
    const encoded = await Promise.all(presets.map(async preset => {
      if (isSealed(preset.config.apiKey)) throw new Error('预设密钥尚未解密，未保存。');
      const sealed = await this.secrets.seal(preset.config.apiKey);
      if (sealed.status === 'error') throw new Error(sealed.message);
      if (sealed.status === 'degraded') warnings.push(sealed.warning);
      return { ...preset, config: { ...preset.config, apiKey: sealed.value } };
    }));
    return { raw: JSON.stringify(encoded), warning: [...new Set(warnings)].join('；') || null };
  }
  private write(raw: string) {
    const storage = this.storage();
    if (storage.getItem(STORAGE_KEYS.API_PRESETS) !== this.raw) throw new Error('API 预设已在其他页面变化，请重新读取后重试。');
    storage.setItem(STORAGE_KEYS.API_PRESETS, raw);
    this.raw = raw;
  }
  initialize = (): Promise<void> => {
    if (this.initialization) return this.initialization;
    this.initialization = this.enqueue(async () => {
      try {
        this.raw = this.storage().getItem(STORAGE_KEYS.API_PRESETS);
        const stored = parse(this.raw);
        const presets = await Promise.all(stored.map(async preset => {
          const decoded = await this.secrets.unseal(preset.config.apiKey);
          if (decoded.status === 'error') throw new Error(decoded.message);
          return { ...preset, config: { ...preset.config, apiKey: decoded.value } };
        }));
        if (this.storage().getItem(STORAGE_KEYS.API_PRESETS) !== this.raw) throw new Error('读取期间 API 预设发生变化，请重新读取。');
        this.publish({ presets, initialized: true, error: null, warning: null });
        if (stored.some(preset => preset.config.apiKey && !isSealed(preset.config.apiKey))) {
          try {
            const encoded = await this.encode(presets); this.write(encoded.raw);
            this.publish({ ...this.snapshot, warning: encoded.warning });
          } catch (error) {
            this.publish({ ...this.snapshot, warning: `预设加密迁移未完成，原记录已保留：${message(error)}` });
          }
        }
      } catch (error) {
        this.publish({ ...this.snapshot, initialized: true, error: message(error) });
      }
    });
    return this.initialization;
  };
  reload = (): Promise<void> => { this.initialization = null; return this.initialize(); };
  getPresets = async (): Promise<ApiPreset[]> => {
    await this.initialize();
    if (this.storage().getItem(STORAGE_KEYS.API_PRESETS) !== this.raw) await this.reload();
    if (this.snapshot.error) throw new Error(this.snapshot.error);
    return structuredClone(this.snapshot.presets);
  };
  change = async (before: ApiPreset | null, after: ApiPreset | null): Promise<void> => {
    const expected = structuredClone(before), next = structuredClone(after);
    await this.initialize();
    return this.enqueue(async () => {
      if (this.snapshot.error) throw new Error(this.snapshot.error);
      const id = expected?.id ?? next?.id;
      if (!id || (expected && next && expected.id !== next.id)) throw new Error('API 预设身份不匹配。');
      const presets = structuredClone(this.snapshot.presets);
      const index = presets.findIndex(preset => preset.id === id);
      if (JSON.stringify(index < 0 ? null : presets[index]) !== JSON.stringify(expected)) throw new Error('API 预设已变化，请核对后重试。');
      if (index >= 0) { if (next) presets[index] = next; else presets.splice(index, 1); }
      else if (next) presets.push(next);
      parse(JSON.stringify(presets));
      const encoded = await this.encode(presets); this.write(encoded.raw);
      this.publish({ presets, initialized: true, error: null, warning: encoded.warning });
    });
  };
}

export const apiPresetStore = new ApiPresetStore();
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === STORAGE_KEYS.API_PRESETS || event.key === null) void apiPresetStore.reload();
});
export function useApiPresets() {
  const snapshot = useSyncExternalStore(apiPresetStore.subscribe, apiPresetStore.getSnapshot);
  useEffect(() => { void apiPresetStore.initialize(); }, []);
  return snapshot;
}
