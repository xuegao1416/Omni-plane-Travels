import { describe, expect, it } from 'bun:test';
import { stateFingerprint } from './stateFingerprint';

function canonicalJSON(value: unknown): string | undefined {
  return JSON.stringify(value, (key, item) => key === 'moduleRevisions' ? undefined
    : item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
      : item);
}

async function referenceFingerprint(value: unknown): Promise<string> {
  const input = new TextEncoder().encode(canonicalJSON(value));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

describe('stateFingerprint', () => {
  it('matches Web Crypto for canonical JSON primitives and SHA-256 block boundaries', async () => {
    const values: unknown[] = [
      null, undefined, true, false, 0, -0, 1.234e-20, 1e25,
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      Symbol('ignored'), () => {}, '', {}, [],
      ...Array.from({ length: 130 }, (_, length) => 'x'.repeat(length)),
    ];
    for (const value of values) {
      expect(stateFingerprint(value)).toBe(await referenceFingerprint(value));
    }
  });

  it('preserves JSON string escapes, Unicode, and lone surrogate behavior', async () => {
    const values = [
      'quote" slash/ backslash\\', '\b\t\n\f\r',
      Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join(''),
      '中文 🧭😀 🧑🏽‍💻 \u2028\u2029', '\ud800', '\udfff', '\ud800x\udfff',
      '\ud800\ud800\udc00\udc00', 'a'.repeat(63) + '😀' + 'b'.repeat(65),
    ];
    for (const value of values) {
      expect(stateFingerprint(value)).toBe(await referenceFingerprint(value));
    }
  });

  it('sorts object keys, preserves arrays, and ignores revision pointers throughout the tree', async () => {
    const state = {
      z: [{ b: 2, moduleRevisions: { ignored: true }, a: 1 }, undefined, () => {}, Symbol('x')],
      a: { missing: undefined, fn: () => {}, symbol: Symbol('x'), value: Number.NaN },
      '10': 'ten', '2': 'two', '4294967295': 'not an array index', '01': 'leading zero',
      moduleRevisions: { large: 'x'.repeat(100_000) },
    };
    expect(stateFingerprint(state)).toBe(await referenceFingerprint(state));
    expect(stateFingerprint({ b: 2, a: 1 })).toBe(stateFingerprint({ a: 1, b: 2 }));
    expect(stateFingerprint({ value: 1, moduleRevisions: 'a' })).toBe(stateFingerprint({ value: 1, moduleRevisions: 'b' }));
    expect(stateFingerprint([1, 2])).not.toBe(stateFingerprint([2, 1]));
    expect(stateFingerprint({ value: 1 })).not.toBe(stateFingerprint({ value: 2 }));
  });

  it('handles sparse arrays, shared objects, and toJSON with its property key', async () => {
    const shared = { b: 2, a: 1 };
    const sparse = new Array(4);
    sparse[2] = shared;
    const value = {
      sparse, first: shared, second: shared,
      date: new Date('2026-10-08T00:00:00.000Z'),
      custom: { toJSON: (key: string) => ({ key, b: 2, a: 1 }) },
    };
    expect(stateFingerprint(value)).toBe(await referenceFingerprint(value));
  });

  it('matches a large multi-block history while keeping the fingerprint fixed length', async () => {
    const value = {
      rounds: Array.from({ length: 2_000 }, (_, round) => ({
        round, memory: `第${round}轮 🧭 ${'content '.repeat(50)}`,
        state: { z: [round, null, '😀'], a: { active: true } },
      })),
    };
    const fingerprint = stateFingerprint(value);
    expect(fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fingerprint).toBe(await referenceFingerprint(value));
  });

  it('streams without calling JSON.stringify on the input or its strings', () => {
    const original = JSON.stringify;
    JSON.stringify = (() => { throw new Error('full JSON allocation'); }) as typeof JSON.stringify;
    try {
      expect(stateFingerprint({ text: '😀\\\n'.repeat(20_000), value: 42 })).toMatch(/^sha256:[0-9a-f]{64}$/);
    } finally {
      JSON.stringify = original;
    }
  });

  it('rejects circular objects and BigInt, but ignores circular revision pointers', () => {
    const object: Record<string, unknown> = {};
    object.self = object;
    const array: unknown[] = [];
    array.push(array);
    expect(() => stateFingerprint(object)).toThrow(TypeError);
    expect(() => stateFingerprint(array)).toThrow(TypeError);
    expect(() => stateFingerprint({ value: 1n })).toThrow(TypeError);
    const ignored: Record<string, unknown> = { value: 1 };
    ignored.moduleRevisions = ignored;
    expect(stateFingerprint(ignored)).toBe(stateFingerprint({ value: 1 }));
  });
});
