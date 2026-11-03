import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fitsInLocalStorage, LOCAL_STORAGE_BUDGET_CHARS, localStorageUsedChars } from './safeStorage';

describe('local storage capacity estimates', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() { return values.size; },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
      },
    });
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  test('counts keys and values for a new entry', () => {
    values.set('old', '123');
    expect(localStorageUsedChars()).toBe(6);
    expect(fitsInLocalStorage('new', '12').projectedChars).toBe(11);
  });

  test('replaces the value without counting its existing key again', () => {
    values.set('world', 'old');
    values.set('other', '12');
    expect(fitsInLocalStorage('world', 'new-value').projectedChars).toBe(21);
  });

  test('accepts the budget boundary and rejects one character above it', () => {
    values.set('k', 'x'.repeat(LOCAL_STORAGE_BUDGET_CHARS - 1));
    expect(fitsInLocalStorage('k', 'x'.repeat(LOCAL_STORAGE_BUDGET_CHARS - 1)).ok).toBe(true);
    expect(fitsInLocalStorage('k', 'x'.repeat(LOCAL_STORAGE_BUDGET_CHARS)).ok).toBe(false);
  });
});
