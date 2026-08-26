import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { applyStatModuleInitData } from './useGameEngine';

describe('applyStatModuleInitData', () => {
  test('consumes materialized special-object values', () => {
    const state = createDefaultGameState();

    applyStatModuleInitData(state, {
      attrA: { current: 90 },
      special: {
        reputation: { value: 14 },
        insight: 6,
      },
    });

    expect(state.玩家.生存状态.血量).toBe(90);
    expect(state.玩家.生存状态.reputation).toBe(14);
    expect(state.玩家.生存状态.insight).toBe(6);
  });

  test('keeps legacy special-array values compatible', () => {
    const state = createDefaultGameState();

    applyStatModuleInitData(state, {
      special: [{ id: 'legacy', value: 8 }],
    });

    expect(state.玩家.生存状态.legacy).toBe(8);
  });
});
