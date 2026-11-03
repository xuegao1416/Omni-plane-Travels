import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';

const storage = new Map<string, string>();
if (typeof localStorage === 'undefined') Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} });
const { useSaveStore } = await import('./saveStore');

test('failed import rejects so the screen can report the error and preserves the save list', async () => {
  const before = useSaveStore.getState().savesMeta;
  await expect(useSaveStore.getState().importSave({ type: 'invalid' })).rejects.toThrow('存档数据格式无效');
  expect(useSaveStore.getState().savesMeta).toBe(before);
});
