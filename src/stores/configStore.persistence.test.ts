import 'fake-indexeddb/auto';
import { expect, spyOn, test } from 'bun:test';
import { useConfigStore } from './configStore';
import * as vault from '../security/keyVault';
import { STORAGE_KEYS } from '../config/storageKeys';

const config = (model: string) => ({ provider: 'openai' as const, baseUrl: 'https://synthetic.invalid', apiKey: 'synthetic-key', model });
function storage() {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const access = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: access });
  return { values, access, restore: () => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); } };
}
test('encryption failure cannot replace committed configuration with plaintext', async () => {
  const local = storage(); local.values.set(STORAGE_KEYS.API_CONFIG, 'original encrypted record');
  useConfigStore.setState({ apiConfig: config('committed') });
  const encrypt = spyOn(vault, 'sealResult').mockResolvedValue({ status: 'error', message: 'vault unavailable' });
  try {
    await expect(useConfigStore.getState().setApiConfig(config('draft'))).rejects.toThrow('vault unavailable');
    expect(local.values.get(STORAGE_KEYS.API_CONFIG)).toBe('original encrypted record');
    expect(useConfigStore.getState().apiConfig?.model).toBe('committed');
  } finally { encrypt.mockRestore(); local.restore(); }
});
test('a proxy write failure restores the previous API record and keeps the draft uncommitted', async () => {
  const local = storage(); local.values.set(STORAGE_KEYS.API_CONFIG, 'old record'); local.values.set(STORAGE_KEYS.PROXY_URL, 'old proxy');
  useConfigStore.setState({ apiConfig: config('committed') });
  const encrypt = spyOn(vault, 'sealResult').mockResolvedValue({ status: 'encrypted', value: 'enc:v1:synthetic' });
  const write = spyOn(local.access, 'setItem').mockImplementation((key, value) => { if (key === STORAGE_KEYS.PROXY_URL && value !== 'old proxy') throw Error('quota'); local.values.set(key, value); });
  try {
    await expect(useConfigStore.getState().setApiConfig(config('draft'), { proxyUrl: 'https://draft-proxy.invalid' })).rejects.toThrow('quota');
    expect(local.values.get(STORAGE_KEYS.API_CONFIG)).toBe('old record');
    expect(local.values.get(STORAGE_KEYS.PROXY_URL)).toBe('old proxy');
    expect(useConfigStore.getState().apiConfig?.model).toBe('committed');
  } finally { write.mockRestore(); encrypt.mockRestore(); local.restore(); }
});
test('unreadable ciphertext remains preserved instead of becoming an empty committed key', async () => {
  const local = storage(); const record = JSON.stringify({ ...config('unreadable'), apiKey: 'enc:v1:corrupted' });
  local.values.set(STORAGE_KEYS.API_CONFIG, record); useConfigStore.setState({ apiConfig: config('current') });
  try {
    await useConfigStore.getState().initApiConfig();
    expect(local.values.get(STORAGE_KEYS.API_CONFIG)).toBe(record);
    expect(useConfigStore.getState().apiConfig?.model).toBe('current');
    expect(useConfigStore.getState().apiRecoveryError).toContain('无法解密');
  } finally { local.restore(); }
});
