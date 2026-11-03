import type { ApiConfig } from '../api/types';
import { STORAGE_KEYS } from '../config/storageKeys';

/** Resolve at request time so a saved choice also works before opening settings. */
export function resolveDirectorApiConfig(fallback: ApiConfig): ApiConfig {
  try {
    const id = localStorage.getItem(STORAGE_KEYS.SIM_API_PRESET);
    const presets: Array<{ id: string; config: ApiConfig }> = JSON.parse(localStorage.getItem(STORAGE_KEYS.API_PRESETS) || '[]');
    const selected = Array.isArray(presets) ? presets.find(preset => preset.id === id)?.config : undefined;
    return { ...(selected?.baseUrl && selected.model ? selected : fallback), stream: false };
  } catch { return { ...fallback, stream: false }; }
}
