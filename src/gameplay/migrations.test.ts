import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import type { WorldModule } from '../data/worlds-schema';
import { prepareGameplayState } from './migrations';

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

describe('gameplay save migration', () => {
  test('upgrades legacy state once while preserving existing player progress', () => {
    const legacy = createDefaultGameState();
    legacy.玩家.当前经验值 = 7;
    legacy.玩家.技能系统 = { 识字: { 品质: '普通', 类型: '知识', 描述: '能够阅读' } };
    delete legacy.玩家.生存资源;
    delete legacy.玩家.经营资产;
    delete legacy.dice;

    const first = prepareGameplayState(legacy, modules, { mode: 'load' });
    expect(first.state.玩家.当前经验值).toBe(7);
    expect(first.state.玩家.生存资源?.food?.数量).toBe(5);
    expect(first.state.玩家.经营资产?.资金).toBe(100);
    expect(first.state.玩家.经营资产?.资产列表[0]).toMatchObject({
      员工效率: 1.2, 市场标签: ['粮食'], 风险等级: 'medium', 升级费用: 30,
    });
    expect(first.state.dice?.history).toEqual([]);
    expect(first.state.玩家.能力系统?.天赋点).toBe(2);
    expect(first.state.玩家.能力系统?.已掌握技能.识字?.等级).toBe(1);
    expect(first.state.gameplay?.appliedMigrations).toEqual(expect.arrayContaining(['gameplay-runtime-v1', 'combat-runtime-v1']));

    const second = prepareGameplayState(first.state, modules, { mode: 'load' });
    expect(second.appliedMigrations).toEqual([]);
    expect(second.state.gameplay?.appliedMigrations).toEqual(expect.arrayContaining(['gameplay-runtime-v1', 'combat-runtime-v1']));
  });

  test('uses world initial values for a new journey', () => {
    const result = prepareGameplayState(createDefaultGameState(), modules, { mode: 'new' });
    expect(result.state.玩家.生存状态.血量).toBe(96);
    expect(result.state.玩家.生存状态.体力值).toBe(48);
    expect(result.state.玩家.生存状态.dim1).toBe(6);
  });

  test('fills newly added runtime fields without overwriting existing save progress', () => {
    const legacy = createDefaultGameState();
    legacy.玩家.能力系统 = {
      天赋点: 7,
      技能点: 4,
      已解锁天赋: { focus: { 等级: 2, 解锁轮次: 3 } },
      已掌握技能: { 识字: { 等级: 2, 使用次数: 9 } },
    };
    legacy.玩家.生存资源 = { food: { 数量: 2, 最大值: 10, name: '旧口粮', symbol: 'F', scarce: false } };
    legacy.玩家.经营资产 = { 资金: 88, 资产列表: [], 交易日志: [] };

    const result = prepareGameplayState(legacy, modules, { mode: 'load' });
    expect(result.state.玩家.能力系统?.天赋点).toBe(7);
    expect(result.state.玩家.能力系统?.已觉醒).toEqual({});
    expect(result.state.玩家.能力系统?.装备槽).toEqual({});
    expect(result.state.玩家.能力系统?.已掌握技能.识字?.使用次数).toBe(9);
    expect(result.state.玩家.生存资源?.food?.数量).toBe(2);
    expect(result.state.玩家.生存资源?.food?.name).toBe('旧口粮');
    expect(result.state.玩家.生存资源?.water?.数量).toBe(3);
    expect(result.state.玩家.经营资产?.资金).toBe(88);
    expect(result.state.玩家.经营资产?.交易日志).toEqual([]);
  });

  test('moves safely matched legacy skills into the selected profession and preserves unmatched free skills', () => {
    const legacy = createDefaultGameState();
    legacy.玩家.身份信息.职业 = '剑客';
    legacy.玩家.技能系统 = {
      重斩: { 品质: '精良', 类型: '武学', 描述: '蓄力斩击' },
      医术: { 品质: '普通', 类型: '生活', 描述: '处理伤势' },
    };
    legacy.玩家.能力系统 = {
      天赋点: 0, 技能点: 0, 已解锁天赋: {},
      已掌握技能: { 重斩: { 等级: 2, 使用次数: 5 }, 医术: { 等级: 1, 使用次数: 2 } },
    };
    const professionModule: WorldModule = {
      moduleId: 'profession', name: '职业', enabled: true,
      moduleConfig: {
        professions: [{ id: 'swordsman', name: '剑客', description: '', abilities: [
          { id: 'heavy_slash', name: '重斩', description: '', type: 'active' },
        ] }],
        innateTalents: [], creationTalentBudget: 0, initialAbilityPoints: 1,
      },
    };

    const first = prepareGameplayState(legacy, [professionModule], { mode: 'load' }).state;
    expect(first.玩家.能力系统?.职业状态).toMatchObject({ 职业ID: 'swordsman', 职业名称: '剑客' });
    expect(first.玩家.能力系统?.职业状态?.已解锁能力.heavy_slash).toMatchObject({ 名称: '重斩', 等级: 2, 使用次数: 5 });
    expect(first.玩家.技能系统.重斩).toBeUndefined();
    expect(first.玩家.技能系统.医术?.描述).toBe('处理伤势');

    const second = prepareGameplayState(first, [professionModule], { mode: 'load' }).state;
    expect(second.玩家.能力系统?.职业状态?.已解锁能力.heavy_slash.等级).toBe(2);
    expect(second.玩家.技能系统.医术).toBeDefined();
  });
});
