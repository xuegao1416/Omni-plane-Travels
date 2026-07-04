import type { ApiConfig } from '../../api/types';
import { STORAGE_KEYS } from '@/config/storageKeys';

export const PRESETS_KEY = STORAGE_KEYS.API_PRESETS;
export const VARIABLE_ENABLED_KEY = STORAGE_KEYS.VARIABLE_ENABLED;

export interface ApiPreset {
  id: string;
  name: string;
  config: ApiConfig;
  createdAt: number;
  /** API 调用限流间隔（毫秒） */
  rateLimitMs?: number;
}

export function loadPresets(): ApiPreset[] {
  try {
    const saved = localStorage.getItem(PRESETS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

export function savePresets(presets: ApiPreset[]) {
  localStorage.setItem(PRESETS_KEY, JSON.stringify(presets));
}

/** 解析 API preset 为记忆系统可用的窄配置（baseUrl + apiKey + model） */
export function resolvePreset(
  presets: ApiPreset[],
  presetId: string | null | undefined,
): { baseUrl: string; apiKey: string; model: string } | null {
  if (!presetId) return null;
  const preset = presets.find(p => p.id === presetId);
  return preset
    ? { baseUrl: preset.config.baseUrl, apiKey: preset.config.apiKey, model: preset.config.model }
    : null;
}
