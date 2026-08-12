import { describe, expect, test } from 'bun:test';
import { deleteCustomWorldFromList } from './customWorldLifecycle';
import type { WorldDef } from './worlds-schema';

const world = (id: string) => ({ id, name: id, description: '', modules: [] } as unknown as WorldDef);

describe('custom world deletion guard', () => {
  const builtins = new Set(['japanese_school']);

  test('built-in worlds are never removable', () => {
    const worlds = [world('japanese_school')];
    const result = deleteCustomWorldFromList(worlds, 'japanese_school', builtins);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'builtin' });
    expect(result.worlds).toBe(worlds);
  });

  test('an unreferenced custom world is removed without mutating the input', () => {
    const worlds = [world('custom_1'), world('custom_2')];
    const result = deleteCustomWorldFromList(worlds, 'custom_1', builtins);
    expect(result).toMatchObject({ ok: true });
    expect(result.worlds.map(item => item.id)).toEqual(['custom_2']);
    expect(worlds).toHaveLength(2);
  });

  test('a save reference blocks deletion', () => {
    const worlds = [world('custom_1')];
    const result = deleteCustomWorldFromList(worlds, 'custom_1', builtins, new Set(['custom_1']));
    expect(result).toMatchObject({ ok: false, reason: 'referenced' });
    expect(result.worlds).toBe(worlds);
  });

  test('cancellation leaves the list untouched because the transition is not invoked', () => {
    const worlds = [world('custom_1')];
    const confirmed = false;
    const result = confirmed ? deleteCustomWorldFromList(worlds, 'custom_1', builtins) : null;
    expect(result).toBeNull();
    expect(worlds).toHaveLength(1);
  });
});
