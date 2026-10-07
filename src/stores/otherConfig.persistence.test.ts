import 'fake-indexeddb/auto';
import { expect, spyOn, test } from 'bun:test';
import { useNovelConfigStore, DEFAULT_NOVEL_CONFIG } from './novelConfigStore';
import { useImageStore } from './imageStore';
import { DEFAULT_IMAGE_CONFIG } from '../api/imageGenTypes';
import { STORAGE_KEYS } from '../config/storageKeys';
import * as vault from '../security/keyVault';
import type { UnsealResult, SealResult } from '../security/keyVault';

async function fixture() {
  await new Promise(resolve => setTimeout(resolve, 0)); // Drain the existing startup load before replacing its storage port.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  return { values, storage, restore: () => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); } };
}
test('unreadable image configuration cannot be replaced by automatically encrypted defaults', async () => {
  const f = await fixture(), raw = '{broken';
  f.values.set(STORAGE_KEYS.IMAGE_CONFIG, raw);
  try {
    await useImageStore.getState().initImageConfig();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.values.get(STORAGE_KEYS.IMAGE_CONFIG)).toBe(raw);
  } finally { f.restore(); }
});
test('novel configuration decrypt failure preserves both the record and committed key', async () => {
  const f = await fixture();
  const current = { ...DEFAULT_NOVEL_CONFIG, api: { ...DEFAULT_NOVEL_CONFIG.api, apiKey: 'committed' } };
  const raw = JSON.stringify({ ...current, api: { ...current.api, apiKey: 'enc:v1:broken' } });
  f.values.set('omni-plane-travels.novel-config.v1', raw);
  useNovelConfigStore.setState({ config: current, loaded: false });
  const decrypt = spyOn(vault, 'unsealResult').mockResolvedValue({ status: 'error', message: 'decrypt failed' });
  try {
    await expect(useNovelConfigStore.getState().initialize()).rejects.toThrow('decrypt failed');
    expect(f.values.get('omni-plane-travels.novel-config.v1')).toBe(raw);
    expect(useNovelConfigStore.getState().config.api.apiKey).toBe('committed');
  } finally { decrypt.mockRestore(); f.restore(); }
});
test('image and novel encryption failures never persist fallback plaintext', async () => {
  const f = await fixture();
  f.values.set(STORAGE_KEYS.IMAGE_CONFIG, 'old image record');
  f.values.set('omni-plane-travels.novel-config.v1', 'old novel record');
  const encrypt = spyOn(vault, 'sealResult').mockResolvedValue({ status: 'error', message: 'vault failed' });
  try {
    await expect(useImageStore.getState().setConfig({ ...DEFAULT_IMAGE_CONFIG, apiKey: 'synthetic-new' })).rejects.toThrow('vault failed');
    await expect(useNovelConfigStore.getState().save({ ...DEFAULT_NOVEL_CONFIG, api: { ...DEFAULT_NOVEL_CONFIG.api, apiKey: 'synthetic-new' } })).rejects.toThrow('vault failed');
    expect(f.values.get(STORAGE_KEYS.IMAGE_CONFIG)).toBe('old image record');
    expect(f.values.get('omni-plane-travels.novel-config.v1')).toBe('old novel record');
  } finally { encrypt.mockRestore(); f.restore(); }
});
test('storage failures preserve committed config and allow retrying the captured draft', async () => {
  const f = await fixture(), previousImage = structuredClone(useImageStore.getState().config), previousNovel = structuredClone(useNovelConfigStore.getState().config);
  const image = { ...DEFAULT_IMAGE_CONFIG, model: 'synthetic-image', apiKey: 'synthetic-key' };
  const novel = { ...DEFAULT_NOVEL_CONFIG, api: { ...DEFAULT_NOVEL_CONFIG.api, model: 'synthetic-novel', apiKey: 'synthetic-key' } };
  const encrypt = spyOn(vault, 'sealResult').mockImplementation(async key => ({ status: 'encrypted', value: `enc:v1:${key}` }));
  const write = f.storage.setItem;
  f.storage.setItem = () => { throw Error('quota'); };
  try {
    await expect(useImageStore.getState().setConfig(image)).rejects.toThrow('quota');
    await expect(useNovelConfigStore.getState().save(novel)).rejects.toThrow('quota');
    expect(useImageStore.getState().config).toEqual(previousImage);
    expect(useNovelConfigStore.getState().config).toEqual(previousNovel);
    f.storage.setItem = write;
    await useImageStore.getState().setConfig(image); await useNovelConfigStore.getState().save(novel);
    expect(useImageStore.getState().config.model).toBe('synthetic-image');
    expect(useNovelConfigStore.getState().config.api.model).toBe('synthetic-novel');
  } finally { encrypt.mockRestore(); f.restore(); }
});
test('late configuration hydration cannot replace a newer accepted save', async () => {
  const f = await fixture();
  f.values.set(STORAGE_KEYS.IMAGE_CONFIG, JSON.stringify({ ...DEFAULT_IMAGE_CONFIG, model: 'old', apiKey: 'enc:v1:old' }));
  let release!: (value: UnsealResult) => void;
  const decrypt = spyOn(vault, 'unsealResult').mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue({ status: 'empty', value: '' });
  const encrypt = spyOn(vault, 'sealResult').mockImplementation(async key => ({ status: 'encrypted', value: `enc:v1:${key}` }));
  try {
    const loading = useImageStore.getState().initImageConfig();
    await useImageStore.getState().setConfig({ ...DEFAULT_IMAGE_CONFIG, model: 'new', apiKey: 'new' });
    release({ status: 'ok', value: 'old' }); await loading;
    expect(useImageStore.getState().config.model).toBe('new');
    expect(JSON.parse(f.values.get(STORAGE_KEYS.IMAGE_CONFIG)!).model).toBe('new');
  } finally { decrypt.mockRestore(); encrypt.mockRestore(); f.restore(); }
});
test('queued novel saves freeze their input and cannot finish out of order', async () => {
  const f = await fixture();
  let release!: (value: SealResult) => void;
  const encrypt = spyOn(vault, 'sealResult').mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockImplementation(async key => ({ status: 'encrypted', value: `enc:v1:${key}` }));
  try {
    const first = { ...DEFAULT_NOVEL_CONFIG, api: { ...DEFAULT_NOVEL_CONFIG.api, model: 'first' } };
    const saving = useNovelConfigStore.getState().save(first);
    first.api.model = 'late mutation';
    await new Promise(resolve => setTimeout(resolve, 0));
    const newer = useNovelConfigStore.getState().save({ ...DEFAULT_NOVEL_CONFIG, api: { ...DEFAULT_NOVEL_CONFIG.api, model: 'newer' } });
    release({ status: 'encrypted', value: 'enc:v1:first' }); await Promise.all([saving, newer]);
    expect(JSON.parse(f.values.get('omni-plane-travels.novel-config.v1')!).api.model).toBe('newer');
    expect(useNovelConfigStore.getState().config.api.model).toBe('newer');
  } finally { encrypt.mockRestore(); f.restore(); }
});
