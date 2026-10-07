import { expect, test } from 'bun:test';
import { ApiPresetStore } from './apiPresetStore';
import { STORAGE_KEYS } from '../config/storageKeys';
import type { ApiPreset } from '../api/presets';
import type { SealResult, UnsealResult } from '../security/keyVault';

const preset = (id: string): ApiPreset => ({ id, name: id, createdAt: 1,
  config: { provider: 'openai', baseUrl: 'https://synthetic.invalid', model: id, apiKey: `synthetic-${id}` } });
function fixture(initial: string | null = null) {
  let raw = initial;
  const storage = { getItem: (_key: string) => raw, setItem: (_key: string, value: string) => { raw = value; } };
  const secrets = {
    seal: async (key: string): Promise<SealResult> => ({ status: 'encrypted', value: `enc:v1:${key}` }),
    unseal: async (key: string): Promise<UnsealResult> => ({ status: 'ok', value: key.replace(/^enc:v1:/, '') }),
  };
  const store = new ApiPresetStore(() => storage, secrets);
  return { store, storage, secrets, raw: () => raw };
}
test('legacy presets migrate in place and requests receive isolated decrypted snapshots', async () => {
  const f = fixture(JSON.stringify([preset('old')]));
  const values = await f.store.getPresets();
  expect(JSON.parse(f.raw()!)[0].config.apiKey).toBe('enc:v1:synthetic-old');
  values[0].config.apiKey = 'changed';
  expect((await f.store.getPresets())[0].config.apiKey).toBe('synthetic-old');
  const reopened = new ApiPresetStore(() => f.storage, f.secrets);
  expect((await reopened.getPresets())[0].id).toBe('old');
});
test('corrupt or undecryptable records remain intact and cannot be overwritten as an empty list', async () => {
  for (const raw of ['broken json', '{}', JSON.stringify([preset('same'), preset('same')])]) {
    const f = fixture(raw);
    await expect(f.store.getPresets()).rejects.toThrow();
    await expect(f.store.change(null, preset('new'))).rejects.toThrow();
    expect(f.raw()).toBe(raw);
  }
  const f = fixture(JSON.stringify([{ ...preset('old'), config: { ...preset('old').config, apiKey: 'enc:v1:broken' } }]));
  f.secrets.unseal = async () => ({ status: 'error', message: 'decrypt failed' });
  await expect(f.store.getPresets()).rejects.toThrow('decrypt failed');
  expect(f.raw()).toContain('enc:v1:broken');
  f.secrets.unseal = async () => ({ status: 'ok', value: 'recovered' });
  await f.store.reload();
  expect((await f.store.getPresets())[0].config.apiKey).toBe('recovered');
});
test('migration encryption failure preserves usable old values and reports the incomplete migration', async () => {
  const raw = JSON.stringify([preset('old')]), f = fixture(raw);
  f.secrets.seal = async () => ({ status: 'error', message: 'vault failed' });
  expect((await f.store.getPresets())[0].id).toBe('old');
  expect(f.raw()).toBe(raw);
  expect(f.store.getSnapshot().warning).toContain('vault failed');
  await expect(f.store.change(null, preset('new'))).rejects.toThrow('vault failed');
  expect(f.raw()).toBe(raw);
});
test('failed save/delete do not publish success; retry uses the retained committed list', async () => {
  const f = fixture(); await f.store.change(null, preset('old'));
  const raw = f.raw(), write = f.storage.setItem;
  f.storage.setItem = () => { throw Error('quota'); };
  await expect(f.store.change(null, preset('new'))).rejects.toThrow('quota');
  await expect(f.store.change(preset('old'), null)).rejects.toThrow('quota');
  expect(f.raw()).toBe(raw);
  expect((await f.store.getPresets()).map(p => p.id)).toEqual(['old']);
  f.storage.setItem = write; await f.store.change(null, preset('new'));
  expect((await f.store.getPresets()).map(p => p.id)).toEqual(['old', 'new']);
});
test('queued edits merge unrelated presets and encrypt the frozen input before publishing', async () => {
  const f = fixture(); await f.store.initialize();
  let release!: (result: SealResult) => void;
  f.secrets.seal = () => new Promise(resolve => { release = resolve; });
  const first = preset('one'), save = f.store.change(null, first);
  first.config.model = 'late edit';
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(f.store.getSnapshot().presets).toHaveLength(0);
  f.secrets.seal = async key => ({ status: 'encrypted', value: `enc:v1:${key}` });
  const second = f.store.change(null, preset('two'));
  release({ status: 'encrypted', value: 'enc:v1:synthetic-one' });
  await Promise.all([save, second]);
  expect((await f.store.getPresets()).map(p => p.config.model)).toEqual(['one', 'two']);
  await expect(f.store.change(null, preset('one'))).rejects.toThrow('已变化');
});
test('another page changing storage during encryption is preserved, then reload can merge', async () => {
  const f = fixture(); await f.store.initialize();
  f.secrets.seal = async key => {
    f.storage.setItem(STORAGE_KEYS.API_PRESETS, JSON.stringify([preset('external')]));
    return { status: 'encrypted', value: `enc:v1:${key}` };
  };
  await expect(f.store.change(null, preset('new'))).rejects.toThrow('其他页面');
  expect(JSON.parse(f.raw()!)[0].id).toBe('external');
  f.secrets.seal = async key => ({ status: 'encrypted', value: `enc:v1:${key}` });
  await f.store.reload(); await f.store.change(null, preset('new'));
  expect((await f.store.getPresets()).map(p => p.id)).toEqual(['external', 'new']);
});
test('restricted encryption reports degradation instead of silently claiming encrypted storage', async () => {
  const f = fixture();
  f.secrets.seal = async key => ({ status: 'degraded', value: key, warning: 'crypto unavailable' });
  await f.store.change(null, preset('new'));
  expect(f.store.getSnapshot().warning).toBe('crypto unavailable');
});
test('request-time reads observe another page update without requiring a settings visit', async () => {
  const f = fixture(); await f.store.getPresets();
  f.storage.setItem(STORAGE_KEYS.API_PRESETS, JSON.stringify([preset('external')]));
  expect((await f.store.getPresets())[0].config.model).toBe('external');
});
