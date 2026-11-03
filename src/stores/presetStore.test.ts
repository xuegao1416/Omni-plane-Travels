import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { applyOverrides, usePresetStore } from './presetStore';
import { getBuiltinPreset } from '../data/builtinPresets';
import { STORAGE_KEYS } from '../config/storageKeys';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const initialState = usePresetStore.getState();
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  } });
  usePresetStore.setState({ builtinOverrides: {}, builtinContentOverrides: {} });
});
afterEach(() => {
  usePresetStore.setState(initialState, true);
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('built-in preset graphical edits', () => {
  test('replaces overrides against canonical defaults, including toggling back and resetting content', () => {
    const base = getBuiltinPreset('default');
    const changed = { ...base, prompts: base.prompts.map(p => p.identifier === 'writing_style'
      ? { ...p, enabled: false, content: 'custom style' } : p) };
    usePresetStore.getState().saveBuiltinEdits(changed);
    expect(applyOverrides(base, usePresetStore.getState().builtinOverrides,
      usePresetStore.getState().builtinContentOverrides).prompts.find(p => p.identifier === 'writing_style')?.content).toBe('custom style');
    usePresetStore.getState().saveBuiltinEdits(base);
    expect(usePresetStore.getState().builtinOverrides[base.id]).toBeUndefined();
    expect(usePresetStore.getState().builtinContentOverrides[base.id]).toBeUndefined();
    expect(JSON.parse(data.get(STORAGE_KEYS.BUILTIN_OVERRIDES)!)).toEqual({});
  });

  test('publishes a whole group in one store notification and persists all selections', () => {
    const base = getBuiltinPreset('default');
    let notifications = 0;
    const unsubscribe = usePresetStore.subscribe(() => { notifications++; });
    try {
      usePresetStore.getState().saveBuiltinEdits({ ...base, prompts: base.prompts.map(p =>
        p.identifier === 'writing_style' ? { ...p, enabled: false } :
        p.identifier === 'style_banter' ? { ...p, enabled: true } : p) });
      expect(notifications).toBe(1);
      const persisted = JSON.parse(data.get(STORAGE_KEYS.BUILTIN_OVERRIDES)!);
      expect(persisted.default).toEqual({ writing_style: false, style_banter: true });
      expect(applyOverrides(base, persisted).prompts.find(p => p.identifier === 'style_banter')?.enabled).toBe(true);
    } finally { unsubscribe(); }
  });

  test('failed second write rolls back storage and does not publish state', () => {
    const base = getBuiltinPreset('default');
    const storage = localStorage;
    storage.setItem = (key, value) => {
      if (key === STORAGE_KEYS.BUILTIN_CONTENT_OVERRIDES) throw new Error('write failed');
      data.set(key, value);
    };
    expect(() => usePresetStore.getState().saveBuiltinEdits({ ...base, prompts: base.prompts.map(p =>
      p.identifier === 'writing_style' ? { ...p, enabled: false, content: 'custom' } : p) })).toThrow('write failed');
    expect(usePresetStore.getState().builtinOverrides).toEqual({});
    expect(data.has(STORAGE_KEYS.BUILTIN_OVERRIDES)).toBe(false);
  });
});
