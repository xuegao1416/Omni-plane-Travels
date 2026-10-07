import { expect, test } from 'bun:test';
import { DirectorRuntime } from './engine';
import { SIM_STORAGE_KEY } from './storage';

test('a detached opening snapshot cannot replace the active director cache', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([[SIM_STORAGE_KEY, 'old director cache']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  try {
    const staging = new DirectorRuntime();
    staging.createSnapshot(0, '开局', true, '开局', [], { persist: false });
    expect(staging.state.snapshots).toHaveLength(1);
    expect(values.get(SIM_STORAGE_KEY)).toBe('old director cache');
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
