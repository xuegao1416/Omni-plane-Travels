// AI 生成的模块初始数据校验：内置世界的模块数据全部合格；常见的生成错误都能指出具体字段。
import { describe, expect, test } from 'bun:test';
import { WORLDS } from '../data/worldLoader';
import { buildModuleRepairPrompt, validateGeneratedModule } from './moduleValidation';

const errors = (moduleId: string, value: unknown) => validateGeneratedModule(moduleId, value).filter(issue => issue.level === 'error');

describe('模块数据校验', () => {
  test('内置世界的模块数据都能通过', () => {
    let checked = 0;
    for (const world of WORLDS) {
      for (const module of world.modules ?? []) {
        if (!module.enabled || !['stat', 'progression', 'survival', 'business', 'talent'].includes(module.moduleId)) continue;
        expect({ world: world.id, module: module.moduleId, errors: errors(module.moduleId, module.moduleConfig) }).toEqual({ world: world.id, module: module.moduleId, errors: [] });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  test('属性：缺生命属性、范围颠倒、当前值越界、特色属性 id 撞名', () => {
    const issues = errors('stat', {
      attrB: { name: '体力', current: 120, max: 100 },
      dim1: { name: '力量', value: 30, range: [20, 10] },
      special: [{ id: 'dim1', name: '灵根', value: 1, range: [0, 5] }, { id: 'luck', name: '', value: 9, range: [0, 5] }],
    }).map(issue => `${issue.path}：${issue.message}`);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('attrA：缺少 attrA'),
      expect.stringContaining('attrB.current'),
      expect.stringContaining('dim1.range'),
      expect.stringContaining('special[0].id：id「dim1」重复'),
      expect.stringContaining('special[1].name'),
      expect.stringContaining('special[1].value：value 9 不在 0~5 之间'),
    ]));
  });

  test('成长：模式不对、公式非正、段位太少', () => {
    const paths = errors('progression', { mode: 'tier', xpFormula: { baseXP: 0, exponent: 1, scaleFactor: 1 } }).map(issue => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['mode', 'xpFormula.baseXP']));
    expect(errors('progression', { mode: 'tiered', xpFormula: { baseXP: 100, exponent: 1.2, scaleFactor: 1 }, tiers: [{ name: '凡人' }] }).map(issue => issue.path)).toContain('tiers');
  });

  test('生存：资源 id 重复、数量越界、消耗与配方引用不存在的资源', () => {
    const issues = errors('survival', {
      description: '', rules: { cycleName: '一天', consumePerCycle: '', criticalThreshold: 2 },
      resources: [
        { id: 'water', name: '淡水', symbol: '💧', amount: 12, max: 10, scarce: true, description: '' },
        { id: 'water', name: '雨水', symbol: '💧', amount: 1, max: 5, scarce: false, description: '' },
      ],
      consumption: { perCycle: { food: 1 } },
      recipes: [{ id: 'r', name: '净水', inputs: { 木炭: 1 }, output: { resourceId: 'water', amount: 1 }, description: '' }],
    }).map(issue => `${issue.path}：${issue.message}`);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('resources[0].amount'),
      expect.stringContaining('resources[1].id：id「water」重复'),
      expect.stringContaining('consumption.perCycle.food：消耗的资源「food」不存在'),
      expect.stringContaining('recipes[0].inputs.木炭'),
    ]));
  });

  test('经营：资金为负、等级越界、缺收益', () => {
    const paths = errors('business', { description: '', funds: -5, cycleName: '天', assets: [{ id: 'shop', name: '小铺', type: '零售', level: 3, maxLevel: 2, description: '', income: { cycle: '天' }, maintenance: 1, status: 'active' }] }).map(issue => issue.path);
    expect(paths).toEqual(expect.arrayContaining(['funds', 'assets[0].level', 'assets[0].income.base']));
    expect(errors('business', { description: '', funds: 10, cycleName: '趟', assets: [], market: { items: [] } }).map(issue => issue.path)).toEqual(['assets']);
    expect(errors('business', { description: '', funds: 10, cycleName: '趟', assets: [], market: { items: [{ name: '茶', basePrice: 0, trend: 'up', changePercent: 0 }] } }).map(issue => issue.path)).toEqual(['market.items[0].basePrice']);
  });

  test('天赋：id 重复（天赋与技能共用）、前置不存在、点数不是整数', () => {
    const issues = errors('talent', {
      categories: [{ id: 'blade', name: '剑道', description: '', talents: [
        { id: 'root', name: '根基', description: '', rarity: '普通', pointCost: 1.5 },
        { id: 'cut', name: '斩', description: '', rarity: '普通', prerequisites: ['ghost'] },
      ] }],
      skills: [{ id: 'root', name: '吐纳', description: '', rarity: '普通' }],
    }).map(issue => `${issue.path}：${issue.message}`);
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining('pointCost'),
      expect.stringContaining('前置「ghost」不存在'),
      expect.stringContaining('skills[0].id：id「root」重复'),
    ]));
  });

  test('不是对象时直接报错；修复提示列出字段与原因', () => {
    expect(errors('stat', '{}')).toHaveLength(1);
    const prompt = buildModuleRepairPrompt('survival', validateGeneratedModule('survival', { resources: [] }));
    expect(prompt).toContain('「生存资源」');
    expect(prompt).toContain('resources：至少要有 1 种资源');
  });
});
