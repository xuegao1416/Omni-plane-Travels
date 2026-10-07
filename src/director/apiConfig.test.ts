import { expect, spyOn, test } from 'bun:test';
import { resolveDirectorApiConfig } from './apiConfig';
import { STORAGE_KEYS } from '../config/storageKeys';
import * as vault from '../security/keyVault';
import { ApiPresetStore } from '../stores/apiPresetStore';

test('director resolves an encrypted preset to a usable private request config', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const fallback = { provider: 'openai' as const, apiKey: 'main', baseUrl: 'https://main.invalid', model: 'main' };
  const selected = { ...fallback, apiKey: 'enc:v1:synthetic', model: 'director' };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => key === STORAGE_KEYS.SIM_API_PRESET ? 'director' : key === STORAGE_KEYS.API_PRESETS
      ? JSON.stringify([{ id: 'director', name: 'Director', createdAt: 1, config: selected }]) : null,
  } });
  const decrypt = spyOn(vault, 'unsealResult').mockResolvedValue({ status: 'ok', value: 'decoded-synthetic' });
  try {
    const resolved = await resolveDirectorApiConfig(fallback, new ApiPresetStore());
    expect(resolved.apiKey).toBe('decoded-synthetic');
    expect(resolved.model).toBe('director');
    expect(resolved.stream).toBe(false);
  } finally {
    decrypt.mockRestore();
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
