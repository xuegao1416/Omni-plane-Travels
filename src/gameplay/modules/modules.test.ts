import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../../schema/variables';
import type { ProgressionConfig, StatModuleSchema, SurvivalRecipe } from '../../modules/schema';
import { addStatModifier, allocateStatPoints, applyStatChange, expireStatModifiers, getEffectiveStatValue } from './stat';
import { breakthroughProgression, settleProgressionActivity } from './progression';
import { learnSkill, unlockTalent, useSkill, awakenAbility, respecAbilities, equipAbility } from './talent';
import { createDiceRoll, recordDiceRoll } from './dice';
import { applySurvivalStatus, craftSurvivalRecipe, expireSurvivalStatuses, gatherSurvivalResource, settleSurvivalCycle, unlockSurvivalRecipe } from './survival';
import { assignBusinessStaff, previewBusinessModule, purchaseBusinessAsset, settleBusinessCycle, upgradeBusinessAsset } from './business';

describe('six built-in gameplay modules', () => {
  test('allocates available attribute points atomically through the stat module', () => {
    const state = createDefaultGameState();
    state.玩家.可用属性点 = 3;
    state.玩家.生存状态.dim1 = 10;
    const result = allocateStatPoints(state, {
      attrA: { name: '生命', current: 100, max: 120 },
      attrB: { name: '能量', current: 50, max: 80 },
      dim1: { name: '力量', value: 10, range: [0, 20] },
      special: [],
    }, { dim1: 2, attrA: 1 }, { tick: 1, enabledModules: ['stat'] });

    expect(result.status).toBe('applied');
    expect(result.state.玩家.可用属性点).toBe(0);
    expect(result.state.玩家.生存状态.dim1).toBe(12);
    expect(result.state.玩家.生存状态.血量).toBe(101);
  });

  test('stat changes obey the configured range', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.血量 = 95;
    const result = applyStatChange(state, {
      attrA: { name: '气血', current: 95, max: 100 },
      attrB: { name: '内力', current: 50, max: 80 },
      special: [],
    }, { statId: 'attrA', delta: 20, reason: '治疗' }, { tick: 1, enabledModules: ['stat'] });

    expect(result.status).toBe('applied');
    expect(result.state.玩家.生存状态.血量).toBe(100);
  });

  test('progression settles an activity and grants cross-module points on promotion', () => {
    const state = createDefaultGameState();
    state.玩家.当前段位索引 = 0;
    state.玩家.当前经验值 = 90;
    state.玩家.能力系统 = { 天赋点: 0, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {} };
    const result = settleProgressionActivity(state, {
      mode: 'level',
      xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 },
      levelData: {
        maxLevel: 5,
        baseStats: { attrAMax: 100, attrBMax: 100, dim1Max: 10, dim2Max: 10, dim3Max: 10, dim4Max: 10, dim5Max: 10, dim6Max: 10 },
        growthPerLevel: { attrAMax: 10, attrBMax: 10, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 },
      },
      activityRewards: [{ id: 'study', label: '研习', keywords: ['研习'], rate: 0.2 }],
      pointsPerTier: { talent: 1, skill: 2 },
    }, '研习账册', { tick: 2, enabledModules: ['progression'] });

    expect(result.execution.status).toBe('applied');
    expect(result.execution.state.玩家.当前段位索引).toBe(1);
    expect(result.execution.state.玩家.当前经验值).toBe(10);
    expect(result.execution.state.玩家.能力系统?.天赋点).toBe(1);
    expect(result.execution.state.玩家.能力系统?.技能点).toBe(2);
  });

  test('profession worlds receive ability points without duplicating legacy skill points', () => {
    const state = createDefaultGameState();
    state.玩家.当前经验值 = 90;
    state.玩家.能力系统 = {
      天赋点: 0, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {},
      职业状态: { 职业ID: 'warrior', 职业名称: '战士', 职业等级: 1, 能力点: 1, 已解锁能力: {} },
    };
    const result = settleProgressionActivity(state, {
      mode: 'level', xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 },
      levelData: { maxLevel: 3, baseStats: { attrAMax: 1, attrBMax: 1, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 }, growthPerLevel: { attrAMax: 1, attrBMax: 1, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 } },
      activityRewards: [{ id: 'study', label: '研习', keywords: ['研习'], rate: 0.2 }],
      pointsPerTier: { skill: 2 },
    }, '研习', { tick: 3, enabledModules: ['progression', 'profession'] });
    expect(result.execution.state.玩家.能力系统?.职业状态).toMatchObject({ 职业等级: 2, 能力点: 3 });
    expect(result.execution.state.玩家.能力系统?.技能点).toBe(0);
  });

  test('stat modifiers, derived values and expiration share the gameplay runtime', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.血量 = 50;
    const config: StatModuleSchema = {
      attrA: { name: '生命', current: 50, max: 100 }, attrB: { name: '能量', current: 50, max: 100 }, special: [],
      derived: [{ id: 'power', name: '力量', inputs: ['attrA'], scale: 2 }],
    };
    const buffed = addStatModifier(state, config, { id: 'blessing', statId: 'attrA', delta: 10, durationTicks: 2 }, { tick: 1, enabledModules: ['stat'] });
    expect(getEffectiveStatValue(buffed.state, config, 'attrA', 1)).toBe(60);
    expect(getEffectiveStatValue(buffed.state, config, 'power', 1)).toBe(120);
    const expired = expireStatModifiers(buffed.state, config, { tick: 3, enabledModules: ['stat'] });
    expect(expired.status).toBe('applied');
    expect(getEffectiveStatValue(expired.state, config, 'attrA', 3)).toBe(50);
  });

  test('progression breakthrough gates promotion with conditions, costs and rewards', () => {
    const state = createDefaultGameState();
    state.玩家.当前经验值 = 90;
    state.玩家.经营资产 = { 资金: 20, 资产列表: [], 交易日志: [] };
    const config: ProgressionConfig = {
      mode: 'level' as const,
      xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 },
      levelData: { maxLevel: 3, baseStats: { attrAMax: 1, attrBMax: 1, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 }, growthPerLevel: { attrAMax: 1, attrBMax: 1, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 } },
      breakthroughs: [{ tierIndex: 1, conditions: [{ state: { path: '玩家.当前目标', op: '==', value: '突破' } }], costs: [{ path: '玩家.经营资产.资金', amount: 5 }], rewards: [{ set: { path: '玩家.性格', value: '觉醒' } }] }],
      activityRewards: [{ id: 'study', label: '研习', keywords: ['研习'], rate: 0.2 }],
    };
    state.玩家.当前目标 = '突破';
    const result = settleProgressionActivity(state, config, '研习', { tick: 2, enabledModules: ['progression'] });
    expect(result.execution.status).toBe('applied');
    expect(result.execution.state.玩家.经营资产?.资金).toBe(15);
    expect(result.execution.state.玩家.性格).toBe('觉醒');
  });

  test('talent unlocks are transactional and can affect another module', () => {
    const state = createDefaultGameState();
    state.玩家.能力系统 = { 天赋点: 2, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {} };
    state.玩家.经营资产 = { 资金: 100, 资产列表: [] };
    const result = unlockTalent(state, {
      categories: [{
        id: 'trade', name: '商道', description: '', talents: [{
          id: 'keen_eye', name: '慧眼', description: '', rarity: '精良', pointCost: 1,
          mechanics: { onUnlock: [{ add: { path: '玩家.经营资产.资金', delta: 5 } }] },
        }],
      }],
    }, 'keen_eye', { tick: 3, enabledModules: ['talent'] });

    expect(result.status).toBe('applied');
    expect(result.state.玩家.能力系统?.天赋点).toBe(1);
    expect(result.state.玩家.能力系统?.已解锁天赋.keen_eye.等级).toBe(1);
    expect(result.state.玩家.经营资产?.资金).toBe(105);
  });

  test('skills learn and activate with costs, cooldown and cross-module effects', () => {
    const state = createDefaultGameState();
    state.玩家.能力系统 = { 天赋点: 0, 技能点: 2, 已解锁天赋: {}, 已掌握技能: {} };
    state.玩家.生存状态.体力值 = 20;
    state.玩家.经营资产 = { 资金: 10, 资产列表: [] };
    const config = {
      categories: [],
      skills: [{
        id: 'bargain', name: '议价', description: '', rarity: '普通' as const,
        pointCost: 1, cooldownTicks: 2,
        activation: {
          costs: [{ path: '玩家.生存状态.体力值', amount: 3 }],
          effects: [{ add: { path: '玩家.经营资产.资金', delta: 5 } }],
        },
      }],
    };

    const learned = learnSkill(state, config, 'bargain', { tick: 7, enabledModules: ['talent'] });
    expect(learned.status).toBe('applied');
    expect(learned.state.玩家.能力系统?.技能点).toBe(1);
    const used = useSkill(learned.state, config, 'bargain', { tick: 8, enabledModules: ['talent'] });
    expect(used.status).toBe('applied');
    expect(used.state.玩家.生存状态.体力值).toBe(17);
    expect(used.state.玩家.经营资产?.资金).toBe(15);
    expect(used.state.玩家.能力系统?.已掌握技能.bargain.冷却至轮次).toBe(10);
    expect(useSkill(used.state, config, 'bargain', { tick: 9, enabledModules: ['talent'] }).status).toBe('blocked');
  });

  test('talent graph gates prerequisites and exclusive branches', () => {
    const state = createDefaultGameState();
    state.玩家.能力系统 = { 天赋点: 3, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {} };
    const config = { categories: [{ id: 'rpg', name: '流派', description: '', talents: [
      { id: 'root', name: '根基', description: '', rarity: '普通' as const, pointCost: 1 },
      { id: 'blade', name: '剑术', description: '', rarity: '稀有' as const, prerequisites: ['root'], exclusiveGroup: 'style', pointCost: 1 },
      { id: 'magic', name: '法术', description: '', rarity: '稀有' as const, prerequisites: ['root'], exclusiveGroup: 'style', pointCost: 1 },
    ] }] };
    expect(unlockTalent(state, config, 'blade', { tick: 1, enabledModules: ['talent'] }).status).toBe('blocked');
    const root = unlockTalent(state, config, 'root', { tick: 2, enabledModules: ['talent'] });
    const blade = unlockTalent(root.state, config, 'blade', { tick: 3, enabledModules: ['talent'] });
    expect(blade.status).toBe('applied');
    expect(unlockTalent(blade.state, config, 'magic', { tick: 4, enabledModules: ['talent'] }).status).toBe('blocked');
  });

  test('skill proficiency, awakening, equipment and respec are transactional', () => {
    const state = createDefaultGameState();
    state.玩家.能力系统 = { 天赋点: 0, 技能点: 2, 已解锁天赋: {}, 已掌握技能: {} };
    const config = { categories: [], equipmentSlots: [{ id: 'core', name: '核心', capacity: 1 }], respec: { enabled: true }, skills: [{
      id: 'focus', name: '专注', description: '', rarity: '普通' as const, pointCost: 1, maxRank: 2, proficiency: { gainPerUse: 10, thresholdPerRank: 10 }, equipmentSlot: 'core',
      awakening: { name: '心流', description: '', pointCost: 0 },
    }] };
    const learned = learnSkill(state, config, 'focus', { tick: 1, enabledModules: ['talent'] });
    const used = useSkill(learned.state, config, 'focus', { tick: 2, enabledModules: ['talent'] });
    expect(used.state.玩家.能力系统?.已掌握技能.focus.等级).toBe(2);
    const equipped = equipAbility(used.state, config, 'focus', 'core', { tick: 3, enabledModules: ['talent'] });
    expect(equipped.state.玩家.能力系统?.装备槽?.core).toEqual(['focus']);
    const awakened = awakenAbility(equipped.state, config, 'focus', { tick: 4, enabledModules: ['talent'] });
    expect(awakened.state.玩家.能力系统?.已觉醒?.focus).toBeDefined();
    const reset = respecAbilities(awakened.state, config, { tick: 5, enabledModules: ['talent'] });
    expect(reset.state.玩家.能力系统?.已掌握技能).toEqual({});
    expect(reset.state.玩家.能力系统?.技能点).toBe(3);
  });

  test('dice checks use configuration and persist a bounded history through the kernel', () => {
    const state = createDefaultGameState();
    state.dice = { history: [] };
    const roll = createDiceRoll({ sides: 20, modifierBase: 10, modifierStep: 2 }, {
      attributeId: 'dim1', attributeName: '筋骨', attributeValue: 14, dc: 15, timestamp: 4,
    }, () => 0.999);
    const result = recordDiceRoll(state, roll, { historyLimit: 10 }, { tick: 4, enabledModules: ['dice'] });

    expect(roll.d20).toBe(20);
    expect(roll.modifier).toBe(2);
    expect(roll.isNatural20).toBe(true);
    expect(result.state.dice?.history).toHaveLength(1);
    expect(result.events[0].type).toBe('dice.resolved');
  });

  test('dice returns one graded outcome and includes talent bonuses', () => {
    const roll = createDiceRoll({ sides: 20, modifierBase: 10, modifierStep: 2, partialSuccessMargin: 2 }, {
      attributeName: '筋骨', attributeValue: 10, dc: 12, timestamp: 4, talentModifier: 2,
    }, () => 0.45);
    expect(roll.modifier).toBe(2);
    expect(roll.total).toBe(12);
    expect(roll.resultTier).toBe('success');
    const partial = createDiceRoll({ sides: 20, modifierBase: 10, modifierStep: 2, partialSuccessMargin: 2 }, {
      attributeName: '筋骨', attributeValue: 10, dc: 12, timestamp: 4,
    }, () => 0.45);
    expect(partial.resultTier).toBe('partial');
  });

  test('survival crafting consumes all inputs atomically', () => {
    const state = createDefaultGameState();
    state.玩家.生存资源 = {
      wood: { 数量: 2 }, stone: { 数量: 1 }, axe: { 数量: 0 },
    };
    const recipe = { id: 'axe', name: '石斧', inputs: { wood: 2, stone: 1 }, output: { resourceId: 'axe', amount: 1 }, description: '' };
    const first = craftSurvivalRecipe(state, recipe, { tick: 5, enabledModules: ['survival'] });
    expect(first.status).toBe('applied');
    expect(first.state.玩家.生存资源?.wood.数量).toBe(0);
    expect(first.state.玩家.生存资源?.axe.数量).toBe(1);

    const second = craftSurvivalRecipe(first.state, recipe, { tick: 6, enabledModules: ['survival'] });
    expect(second.status).toBe('blocked');
    expect(second.state.玩家.生存资源?.stone.数量).toBe(0);
    expect(second.state.玩家.生存资源?.axe.数量).toBe(1);
  });

  test('survival recipe unlock, crafting time and expiring status are deterministic', () => {
    const state = createDefaultGameState();
    state.玩家.当前目标 = '允许';
    state.玩家.生存资源 = { wood: { 数量: 2 }, axe: { 数量: 0 } };
    const recipe: SurvivalRecipe = { id: 'axe', name: '石斧', inputs: { wood: 1 }, output: { resourceId: 'axe', amount: 1 }, description: '', unlockConditions: [{ state: { path: '玩家.当前目标', op: '==', value: '允许' } }], craftTimeMinutes: 30 };
    const unlocked = unlockSurvivalRecipe(state, recipe, { tick: 1, enabledModules: ['survival'] });
    expect(unlocked.status).toBe('applied');
    const crafted = craftSurvivalRecipe(unlocked.state, recipe, { tick: 2, enabledModules: ['survival'] });
    expect(crafted.status).toBe('applied');
    expect(crafted.state.玩家.生存资源?.axe.数量).toBe(1);
    const status = applySurvivalStatus(crafted.state, { id: 'fatigued', durationTicks: 1 }, { tick: 2, enabledModules: ['survival'] });
    expect(expireSurvivalStatuses(status.state, { tick: 4, enabledModules: ['survival'] }).status).toBe('applied');
  });

  test('survival gathering atomically adds resources, spends stamina and advances the clock', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.体力值 = 20;
    state.玩家.生存资源 = { wood: { 数量: 0, 最大值: 10 } };
    state.世界.时间系统.时钟 = {
      schemaVersion: 1,
      calendar: {
        mode: 'gregorian', calendarName: '公历', eraName: '',
        start: { year: 2026, month: 1, day: 1, hour: 8, minute: 0 },
        months: Array.from({ length: 12 }, (_, i) => ({ name: `${i + 1}月`, days: 30 })),
        weekdays: ['日', '一', '二', '三', '四', '五', '六'], defaultTurnMinutes: 20,
        timeOfDayLabels: [],
      },
      current: { year: 2026, month: 1, day: 1, hour: 8, minute: 0 }, elapsedMinutes: 0,
    };
    const config = {
      description: '', resources: [{ id: 'wood', name: '木材', symbol: '', amount: 0, max: 10, scarce: false, description: '', gatherAmount: 2, gatherTimeMinutes: 45, gatherStaminaCost: 5 }],
      rules: { cycleName: '天', consumePerCycle: '', criticalThreshold: 1 },
    };
    const result = gatherSurvivalResource(state, config, 'wood', { tick: 3, enabledModules: ['survival'] });
    expect(result.status).toBe('applied');
    expect(result.state.玩家.生存资源?.wood.数量).toBe(2);
    expect(result.state.玩家.生存状态.体力值).toBe(15);
    expect(result.state.世界.时间系统.时钟?.elapsedMinutes).toBe(45);
  });

  test('survival settles a world period only once', () => {
    const state = createDefaultGameState();
    state.玩家.生存资源 = { water: { 数量: 3 } };
    const config = {
      description: '', resources: [{ id: 'water', name: '水', symbol: '', amount: 3, max: 10, scarce: true, description: '' }],
      rules: { cycleName: '天', consumePerCycle: '', criticalThreshold: 1 },
      consumption: { perCycle: { water: 1 } },
    };
    const first = settleSurvivalCycle(state, config, { tick: 5, enabledModules: ['survival'] }, 'day:2');
    const duplicate = settleSurvivalCycle(first.state, config, { tick: 6, enabledModules: ['survival'] }, 'day:2');
    expect(first.state.玩家.生存资源?.water.数量).toBe(2);
    expect(duplicate.status).toBe('blocked');
    expect(duplicate.state.玩家.生存资源?.water.数量).toBe(2);
  });

  test('business settlement accounts for staff, market and maintenance without random income', () => {
    const state = createDefaultGameState();
    state.玩家.经营资产 = {
      资金: 100,
      资产列表: [{
        id: 'shop', 名称: '杂货铺', 类型: '零售', 等级: 2, 最高等级: 5, 描述: '', 状态: 'active',
        基础收益: 100, 每级收益: 20, 维护费: 30, 员工效率: 1.1, 市场标签: ['粮食'],
      }],
      交易日志: [],
    };
    const result = settleBusinessCycle(state, {
      description: '', funds: 100, cycleName: '天', assets: [],
      market: { items: [{ name: '粮食', basePrice: 10, trend: 'up', changePercent: 10 }] },
      economy: { marketWeight: 0.5 },
    }, 'day:2', { tick: 6, enabledModules: ['business'] });

    expect(result.execution.status).toBe('applied');
    expect(result.breakdown.grossIncome).toBe(138.6);
    expect(result.breakdown.maintenance).toBe(30);
    expect(result.execution.state.玩家.经营资产?.资金).toBe(208.6);
    expect(result.execution.state.玩家.经营资产?.上次结算周期).toBe('day:2');
    expect(previewBusinessModule({
      description: '', funds: 100, cycleName: '天',
      assets: [{
        id: 'shop', name: '杂货铺', type: '零售', level: 2, maxLevel: 5, description: '', status: 'active',
        income: { base: 100, perLevel: 20, cycle: '天' }, maintenance: 30,
        staff: { current: 1, max: 1, efficiency: 1.1 }, marketTags: ['粮食'],
      }],
      market: { items: [{ name: '粮食', basePrice: 10, trend: 'up', changePercent: 10 }] },
      economy: { marketWeight: 0.5 },
    }).net).toBe(108.6);
  });

  test('business settlement runs an input/output production chain into persistent inventory', () => {
    const state = createDefaultGameState();
    state.玩家.经营资产 = { 资金: 0, 资产列表: [], 库存: { grain: 2 }, 交易日志: [] };
    const result = settleBusinessCycle(state, {
      description: '', funds: 0, cycleName: '天', assets: [],
      economy: { production: [{ id: 'flour', name: '面粉', inputs: { grain: 2 }, outputs: { flour: 3 } }] },
    }, 'day:1', { tick: 1, enabledModules: ['business'] });
    expect(result.execution.status).toBe('applied');
    expect(result.execution.state.玩家.经营资产?.库存).toEqual({ grain: 0, flour: 3 });
  });

  test('business asset lifecycle atomically purchases, upgrades and staffs an asset', () => {
    const state = createDefaultGameState();
    state.玩家.经营资产 = { 资金: 100, 资产列表: [], 库存: { steel: 2 }, 交易日志: [] };
    const config = {
      description: '', funds: 100, cycleName: '天', assets: [{
        id: 'forge', name: '工坊', type: '制造', level: 1, maxLevel: 3, description: '', status: 'active' as const,
        income: { base: 10, perLevel: 2, cycle: '天' }, maintenance: 1, purchaseCost: 30, upgradeCost: 20, upgradeMaterials: { steel: 1 }, purchaseMaterials: { steel: 1 },
      }],
    };
    const purchased = purchaseBusinessAsset(state, config, 'forge', { tick: 1, enabledModules: ['business'] });
    expect(purchased.status).toBe('applied');
    expect(purchased.state.玩家.经营资产?.资金).toBe(70);
    const upgraded = upgradeBusinessAsset(purchased.state, config, 'forge', { tick: 2, enabledModules: ['business'] });
    expect(upgraded.status).toBe('applied');
    expect(upgraded.state.玩家.经营资产?.资产列表[0].等级).toBe(2);
    const staffed = assignBusinessStaff(upgraded.state, 'forge', 2, 1.25, { tick: 3, enabledModules: ['business'] });
    expect(staffed.status).toBe('applied');
    expect((staffed.state.玩家.经营资产?.资产列表[0] as unknown as Record<string, number>)['员工效率']).toBe(1.25);
  });
});
