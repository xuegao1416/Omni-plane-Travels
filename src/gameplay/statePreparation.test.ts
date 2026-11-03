import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import type { WorldModule } from '../data/worlds-schema';
import { prepareGameplayState } from './statePreparation';

const modules: WorldModule[] = [
  {
    moduleId: 'stat', name: '属性', enabled: true,
    moduleConfig: {
      attrA: { name: '气血', max: 120 }, attrB: { name: '内力', max: 80 },
      dim1: { name: '筋骨', range: [0, 20] }, special: [],
    },
    initialState: { attrA: 96, attrB: 48, dim1: 6 },
  },
  {
    moduleId: 'progression', name: '成长', enabled: true,
    moduleConfig: { mode: 'level', xpFormula: { baseXP: 100, exponent: 1.5, scaleFactor: 1 }, levelData: { maxLevel: 20 } },
    initialState: { currentTierIndex: 0, currentXP: 0 },
  },
  {
    moduleId: 'talent', name: '能力', enabled: true,
    moduleConfig: { categories: [], skills: [], pointRules: { initialTalentPoints: 2, initialSkillPoints: 3 } },
  },
  { moduleId: 'dice', name: '判定', enabled: true, moduleConfig: {} },
  {
    moduleId: 'survival', name: '生存', enabled: true,
    moduleConfig: {
      description: '', resources: [
        { id: 'food', name: '口粮', symbol: 'F', amount: 5, max: 10, scarce: false, description: '' },
        { id: 'water', name: '清水', symbol: 'W', amount: 3, max: 10, scarce: false, description: '' },
      ],
      rules: { cycleName: '天', consumePerCycle: '', criticalThreshold: 2 },
    },
  },
  {
    moduleId: 'business', name: '经营', enabled: true,
    moduleConfig: { description: '', funds: 100, cycleName: '天', assets: [{
      id: 'shop', name: '商铺', type: '零售', level: 1, maxLevel: 3, description: '', status: 'active',
      income: { base: 12, perLevel: 3, cycle: '天' }, maintenance: 2,
      staff: { current: 2, max: 4, efficiency: 1.2 }, marketTags: ['粮食'],
      risk: { level: 'medium', description: '行情波动' }, upgradeCost: 30,
    }] },
  },
];

describe('gameplay state preparation', () => {
  test('uses world initial values for a new journey', () => {
    const result = prepareGameplayState(createDefaultGameState(), modules, { mode: 'new' });
    expect(result.state.玩家.生存状态.血量).toBe(96);
    expect(result.state.玩家.生存状态.体力值).toBe(48);
    expect(result.state.玩家.生存状态.dim1).toBe(6);
  });

  test('normalizes runtime fields without overwriting existing save progress', () => {
    const state = createDefaultGameState();
    state.玩家.能力系统 = {
      天赋点: 7,
      技能点: 4,
      已解锁天赋: { focus: { 等级: 2, 解锁轮次: 3 } },
      已掌握技能: { 识字: { 等级: 2, 使用次数: 9 } },
    };
    state.玩家.生存资源 = { food: { 数量: 2, 最大值: 10, name: '已有口粮', symbol: 'F', scarce: false } };
    state.玩家.经营资产 = { 资金: 88, 资产列表: [], 交易日志: [] };

    const result = prepareGameplayState(state, modules, { mode: 'load' });
    expect(result.state.玩家.能力系统?.天赋点).toBe(7);
    expect(result.state.玩家.能力系统?.已觉醒).toEqual({});
    expect(result.state.玩家.能力系统?.装备槽).toEqual({});
    expect(result.state.玩家.能力系统?.已掌握技能.识字?.使用次数).toBe(9);
    expect(result.state.玩家.生存资源?.food?.数量).toBe(2);
    expect(result.state.玩家.生存资源?.food?.name).toBe('已有口粮');
    expect(result.state.玩家.生存资源?.water?.数量).toBe(3);
    expect(result.state.玩家.经营资产?.资金).toBe(88);
    expect(result.state.玩家.经营资产?.交易日志).toEqual([]);
  });

});
