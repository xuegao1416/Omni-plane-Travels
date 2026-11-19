import { describe, expect, test } from 'bun:test';
import type { ProfessionModuleSchema } from '../../modules/schema';
import { createDefaultGameState } from '../../schema/variables';
import { initializeProfessionSelection, validateProfessionSelection } from './profession';

const config: ProfessionModuleSchema = {
  creationTalentBudget: 3,
  allowNoProfession: true,
  initialAbilityPoints: 2,
  innateTalents: [
    { id: 'brave', name: '无畏', description: '', cost: 1, exclusiveGroup: 'temper', mechanics: { checks: [{ statIds: ['dim5'], value: 1 }] } },
    { id: 'calm', name: '冷静', description: '', cost: 1, exclusiveGroup: 'temper' },
    { id: 'lucky', name: '幸运儿', description: '', cost: 2 },
  ],
  professions: [{
    id: 'warrior', name: '战士', description: '', abilities: [
      { id: 'guard', name: '守势', description: '', type: 'passive', pointCost: 1, mechanics: { combat: { armor: 2 }, checks: [{ statIds: ['dim2'], value: 1 }] } },
      { id: 'slash', name: '重斩', description: '', type: 'active', pointCost: 1, prerequisites: ['guard'] },
      { id: 'last_stand', name: '背水一战', description: '', type: 'ultimate', pointCost: 2, prerequisites: ['slash'], requiredProfessionLevel: 3 },
    ],
  }],
};

const extendedBudgetConfig: ProfessionModuleSchema = {
  ...config,
  innateTalents: [
    ...config.innateTalents,
    { id: 'expensive', name: '天生神力', description: '', cost: 4 },
    { id: 'divine', name: '命运神技', description: '', cost: 99999 },
  ],
};

describe('profession domain', () => {
  test('validates creation-only talent budget, conflicts, and no-profession choice', () => {
    expect(validateProfessionSelection(config, null, ['lucky']).ok).toBe(true);
    expect(validateProfessionSelection(config, 'warrior', ['brave', 'calm']).reason).toContain('互斥');
    expect(validateProfessionSelection(config, 'warrior', ['brave', 'lucky']).ok).toBe(true);
    expect(validateProfessionSelection(config, 'missing', []).ok).toBe(false);
  });

  test('accepts an explicit talent budget override and initialize forwards it', () => {
    expect(validateProfessionSelection(extendedBudgetConfig, 'warrior', ['expensive']).ok).toBe(false);
    expect(validateProfessionSelection(extendedBudgetConfig, 'warrior', ['expensive'], 4)).toMatchObject({
      ok: true,
      spent: 4,
      remaining: 0,
    });

    const initialized = initializeProfessionSelection(
      createDefaultGameState(),
      extendedBudgetConfig,
      'warrior',
      ['expensive'],
      { talentBudgetOverride: 4 },
    );
    expect(initialized.玩家.能力系统?.先天天赋?.expensive).toBeDefined();
  });

  test('does not charge divine talents against the creation budget', () => {
    expect(validateProfessionSelection(extendedBudgetConfig, 'warrior', ['divine'])).toMatchObject({
      ok: true,
      spent: 0,
      remaining: 3,
    });
    expect(() => initializeProfessionSelection(
      createDefaultGameState(),
      extendedBudgetConfig,
      'warrior',
      ['divine'],
    )).not.toThrow();
  });

  test('initializes profession, innate talents, and preserves unrelated free skills', () => {
    const state = createDefaultGameState();
    state.玩家.技能系统.烹饪 = { 品质: '普通', 描述: '做饭', 类型: '生活' };
    const initialized = initializeProfessionSelection(state, config, 'warrior', ['brave']);

    expect(initialized.玩家.能力系统?.职业状态).toMatchObject({ 职业ID: 'warrior', 能力点: 2 });
    expect(initialized.玩家.能力系统?.先天天赋?.brave.选择时间).toBe('creation');
    expect(initialized.玩家.技能系统.烹饪).toBeDefined();
  });

  // 解锁三项（能力树前置与等级、按 id/显示名识别、加成只算已解锁节点）已迁移到 src/domains/abilities/abilities.test.ts。
});
