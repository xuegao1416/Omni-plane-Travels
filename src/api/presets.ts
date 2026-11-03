import type { ApiConfig } from './types';

export interface ApiPreset {
  id: string;
  name: string;
  config: ApiConfig;
  createdAt: number;
  rateLimitMs?: number;
}

/** Memory's request port carries connection identity and timeout policy; generation params stay out. */
export type MemoryApiPort = Pick<ApiConfig, 'baseUrl' | 'apiKey' | 'model'>
  & Partial<Pick<ApiConfig, 'provider' | 'requestTimeoutMs'>>;

export function memoryApiPort(config: ApiConfig): MemoryApiPort {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    provider: config.provider,
    requestTimeoutMs: config.requestTimeoutMs,
  };
}

export function resolvePreset(presets: readonly ApiPreset[], id: string | null | undefined): MemoryApiPort | null {
  const config = id ? presets.find(preset => preset.id === id)?.config : undefined;
  return config ? memoryApiPort(config) : null;
}
