import type { ApiConfig } from '../api/types';
import { STORAGE_KEYS } from '../config/storageKeys';
import { apiPresetStore, type ApiPresetStore } from '../stores/apiPresetStore';

/** Resolve at request time so a saved choice also works before opening settings. */
export async function resolveDirectorApiConfig(fallback: ApiConfig, owner: ApiPresetStore = apiPresetStore): Promise<ApiConfig> {
  let id: string | null = null;
  try {
    id = localStorage.getItem(STORAGE_KEYS.SIM_API_PRESET);
  } catch { /* Main connection does not depend on preset storage. */ }
  const selected = id ? (await owner.getPresets()).find(preset => preset.id === id)?.config : undefined;
  return { ...(selected?.baseUrl && selected.model ? selected : fallback), stream: false };
}
