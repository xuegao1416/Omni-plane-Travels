import { describe, expect, test } from 'bun:test';
import { VariableManager } from './variableManager';
import { createDefaultGameState } from '../schema/variables';
import { settleProgressionAction } from './progressionSettlement';

describe('progression settlement integration', () => {
  test('commits progression and cross-module points through the gameplay kernel', () => {
    const state = createDefaultGameState();
    state.玩家.当前经验值 = 90;
    state.玩家.能力系统 = { 天赋点: 0, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {} };
    state.simulationRuntime = { tick: 7, evolvedSteps: [], effectLog: [], periodicCounters: {}, triggeredPeriodicEvents: [] };
    const manager = new VariableManager(state);

    const result = settleProgressionAction(manager, {
      mode: 'level',
      xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 },
      levelData: {
        maxLevel: 3,
        baseStats: { attrAMax: 100, attrBMax: 100, dim1Max: 10, dim2Max: 10, dim3Max: 10, dim4Max: 10, dim5Max: 10, dim6Max: 10 },
        growthPerLevel: { attrAMax: 1, attrBMax: 1, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 },
      },
      activityRewards: [{ id: 'study', label: '研习', rate: 0.2, keywords: ['研习'] }],
      pointsPerTier: { talent: 1, skill: 2 },
    }, '研习古籍', { tierIndex: 0, currentXP: 90 });

    const next = manager.getState();
    expect(result?.tierAfter).toBe(1);
    expect(next.玩家.能力系统?.天赋点).toBe(1);
    expect(next.玩家.能力系统?.技能点).toBe(2);
    expect(next.gameplay?.logs.at(-1)?.moduleId).toBe('progression');
  });

  test('awards independent profession points without leaking into legacy talent or skill points', () => {
    const state = createDefaultGameState();
    state.玩家.当前经验值 = 90;
    state.玩家.能力系统 = {
      天赋点: 0,
      技能点: 0,
      已解锁天赋: {},
      已掌握技能: {},
      职业状态: { 职业ID: 'warrior', 职业名称: '战士', 职业等级: 1, 能力点: 0, 已解锁能力: {} },
    };
    const manager = new VariableManager(state);

    settleProgressionAction(manager, {
      mode: 'level',
      xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 },
      levelData: {
        maxLevel: 3,
        baseStats: { attrAMax: 100, attrBMax: 100, dim1Max: 10, dim2Max: 10, dim3Max: 10, dim4Max: 10, dim5Max: 10, dim6Max: 10 },
        growthPerLevel: { attrAMax: 1, attrBMax: 1, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 },
      },
      activityRewards: [{ id: 'study', label: '研习', rate: 0.2, keywords: ['研习'] }],
      pointsPerTier: { talent: 9, skill: 9 },
    }, '研习战技', { tierIndex: 0, currentXP: 90 }, 2);

    const next = manager.getState().玩家.能力系统!;
    expect(next.职业状态).toMatchObject({ 职业等级: 2, 能力点: 2 });
    expect(next.天赋点).toBe(0);
    expect(next.技能点).toBe(0);
  });
});
