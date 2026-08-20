import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../../schema/variables';
import {
  extractModulePartitions,
  materializeModulePartitions,
  moduleIdForGameplayPath,
} from './facade';

describe('partitioned gameplay state facade', () => {
  test('extracts module state from the persisted narrative core and materializes it losslessly', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态 = { 血量: 80, 体力值: 55, dim1: 12 };
    state.玩家.当前段位索引 = 2;
    state.玩家.当前经验值 = 45;
    state.玩家.生存资源 = { water: { 数量: 3, name: '水' } };
    state.玩家.生存配方 = [{ id: 'tea', name: '茶', inputs: { water: 1 }, output: { resourceId: 'tea', amount: 1 }, description: '' }];
    state.玩家.经营资产 = { 资金: 900, 资产列表: [] };
    state.dice = { history: [], lastRoll: { attributeName: '身法', attributeValue: 12, modifier: 1, d20: 15, total: 16, dc: 12, success: true, isNatural20: false, isNatural1: false, timestamp: 1 } };
    state.玩家.能力系统 = { 天赋点: 0, 技能点: 2, 已解锁天赋: {}, 已掌握技能: {} };
    state.玩家.技能系统 = { 潜行: { 品质: '普通', 描述: '隐蔽行动', 类型: '职业技能' } };

    const extracted = extractModulePartitions(state, 'save-a');

    expect((extracted.coreState as any).玩家.生存资源).toBeUndefined();
    expect((extracted.coreState as any).玩家.生存配方).toBeUndefined();
    expect((extracted.coreState as any).玩家.经营资产).toBeUndefined();
    expect((extracted.coreState as any).玩家.能力系统).toBeUndefined();
    expect((extracted.coreState as any).dice).toBeUndefined();
    expect(extracted.records.map(record => record.moduleId)).toEqual([
      'stat', 'progression', 'survival', 'business', 'dice', 'profession',
    ]);

    const restored = materializeModulePartitions(extracted.coreState, extracted.records);
    expect(restored.玩家.生存状态).toEqual(state.玩家.生存状态);
    expect(restored.玩家.当前段位索引).toBe(2);
    expect(restored.玩家.生存资源).toEqual(state.玩家.生存资源);
    expect(restored.玩家.生存配方).toEqual(state.玩家.生存配方);
    expect(restored.玩家.经营资产).toEqual(state.玩家.经营资产);
    expect(restored.dice).toEqual(state.dice);
    expect(restored.玩家.能力系统).toEqual(state.玩家.能力系统);
    expect(restored.玩家.技能系统).toEqual(state.玩家.技能系统);
  });

  test('routes legacy gameplay paths to their authoritative partitions', () => {
    expect(moduleIdForGameplayPath('玩家.生存状态.血量')).toBe('stat');
    expect(moduleIdForGameplayPath('玩家.当前经验值')).toBe('progression');
    expect(moduleIdForGameplayPath('玩家.生存资源.water.数量')).toBe('survival');
    expect(moduleIdForGameplayPath('玩家.生存配方.0')).toBe('survival');
    expect(moduleIdForGameplayPath('玩家.经营资产.资金')).toBe('business');
    expect(moduleIdForGameplayPath('dice.lastRoll')).toBe('dice');
    expect(moduleIdForGameplayPath('玩家.能力系统.技能点')).toBe('profession');
    expect(moduleIdForGameplayPath('人物档案.甲.关系数据.好感度')).toBeUndefined();
  });
});
