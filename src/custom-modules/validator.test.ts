import { describe, expect, test } from 'bun:test';
import { normalizeCustomGameplayModule } from './normalize';
import { validateCustomGameplayModule } from './validator';

const baseModule = {
  kind: 'custom-gameplay-module',
  schemaVersion: 1,
  id: 'focus-system',
  name: 'Focus System',
  version: '1.0.0',
  author: 'player',
  scope: 'world',
  state: {
    score: { type: 'number', default: 0, min: 0, max: 100 },
    title: { type: 'string', default: 'new', maxLength: 32 },
    enabled: { type: 'boolean', default: true },
    tags: {
      type: 'array',
      items: { type: 'string', default: '' },
      default: [],
      maxItems: 8,
      maxDepth: 2,
      maxSize: 512,
    },
    profile: {
      type: 'object',
      fields: { visits: { type: 'number', default: 0, min: 0, max: 100 } },
      default: { visits: 0 },
      maxProperties: 4,
      maxDepth: 2,
      maxSize: 512,
    },
  },
  logic: {
    onGameStart: [],
    onTurnEnd: [],
    onTick: [],
    onChoice: [],
  },
  permissions: { read: [], write: 'own-state-only' },
};

describe('custom gameplay module validation', () => {
  test('normalizes omitted optional sections and metadata without changing the module contract', () => {
    const result = normalizeCustomGameplayModule({
      ...baseModule,
      id: '  focus-system  ',
      name: '  Focus System  ',
      author: '  player  ',
      logic: undefined,
      permissions: undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('focus-system');
      expect(result.data.name).toBe('Focus System');
      expect(result.data.logic.onTick).toEqual([]);
      expect(result.data.permissions.write).toBe('own-state-only');
      expect(result.data.view).toBeUndefined();
    }
  });

  test('rejects invalid state references and incompatible component bindings', () => {
    const result = validateCustomGameplayModule({
      ...baseModule,
      logic: {
        ...baseModule.logic,
        onTick: [{ actions: [{ type: 'add', path: 'missing', value: 1 }] }],
      },
      view: {
        slot: 'right-panel',
        components: [
          { type: 'number', path: 'title' },
          { type: 'list', path: 'score' },
          { type: 'text', path: 'not-defined' },
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unknown-state-path', 'type-mismatch']),
    );
  });

  test('rejects paths into core game state and permissions that attempt to write it', () => {
    const result = validateCustomGameplayModule({
      ...baseModule,
      permissions: { read: ['玩家.生存状态.血量'], write: 'own-state-only' },
      logic: {
        ...baseModule.logic,
        onTick: [{ actions: [{ type: 'set', path: '玩家.生存状态.血量', value: 0 }] }],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['forbidden-state-path']),
    );

    const invalidPermission = validateCustomGameplayModule({
      ...baseModule,
      permissions: { read: [], write: 'player-state' },
    });
    expect(invalidPermission.errors.map((issue) => issue.code)).toContain('invalid-permission');
  });

  test('rejects oversized rules, labels, unsupported components, and duplicate enum values', () => {
    const result = validateCustomGameplayModule({
      ...baseModule,
      state: {
        ...baseModule.state,
        mode: { type: 'enum', values: ['a', 'a'], default: 'a' },
      },
      logic: {
        ...baseModule.logic,
        onTick: [
          {
            actions: Array.from({ length: 33 }, () => ({ type: 'log', message: 'x' })),
          },
        ],
      },
      view: {
        slot: 'right-panel',
        components: [
          { type: 'unknown-widget', label: 'x' },
          { type: 'text', text: 'x'.repeat(4097) },
        ],
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  test('returns a normalized executable module only when there are no errors', () => {
    const result = validateCustomGameplayModule({
      ...baseModule,
      logic: undefined,
      view: { slot: 'right-panel', components: [{ type: 'number', path: 'score' }] },
    });

    expect(result.valid).toBe(true);
    expect(result.normalized?.logic.onGameStart).toEqual([]);
    expect(result.normalized?.view?.slot).toBe('right-panel');
  });
});
