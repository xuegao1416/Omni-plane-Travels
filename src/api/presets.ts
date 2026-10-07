import type { ApiConfig } from './types';

export interface ApiPreset {
  id: string;
  name: string;
  config: ApiConfig;
  createdAt: number;
  rateLimitMs?: number;
}

/** Memory's request port intentionally accepts only connection identity. */
export function resolvePreset(presets: readonly ApiPreset[], id: string | null | undefined) {
  const config = id ? presets.find(preset => preset.id === id)?.config : undefined;
  return config ? { baseUrl: config.baseUrl, apiKey: config.apiKey, model: config.model } : null;
}
