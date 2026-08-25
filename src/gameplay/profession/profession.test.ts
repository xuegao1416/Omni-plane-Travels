import { describe, expect, test } from 'bun:test';
import type { ProfessionModuleSchema } from '../../modules/schema';
import { createDefaultGameState } from '../../schema/variables';
import {
  initializeProfessionSelection,
  resolveProfessionBonuses,
  resolveOwnedAbility,
  unlockProfessionAbility,
  validateProfessionSelection,
} from './profession';

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

describe('profession domain', () => {
  test('validates creation-only talent budget, conflicts, and no-profession choice', () => {
    expect(validateProfessionSelection(config, null, ['lucky']).ok).toBe(true);
    expect(validateProfessionSelection(config, 'warrior', ['brave', 'calm']).reason).toContain('互斥');
    expect(validateProfessionSelection(config, 'warrior', ['brave', 'lucky']).ok).toBe(true);
    expect(validateProfessionSelection(config, 'missing', []).ok).toBe(false);
  });

  test('initializes profession, innate talents, and preserves unrelated free skills', () => {
    const state = createDefaultGameState();
    state.玩家.技能系统.烹饪 = { 品质: '普通', 描述: '做饭', 类型: '生活' };
    const initialized = initializeProfessionSelection(state, config, 'warrior', ['brave']);

    expect(initialized.玩家.能力系统?.职业状态).toMatchObject({ 职业ID: 'warrior', 能力点: 2 });
    expect(initialized.玩家.能力系统?.先天天赋?.brave.选择时间).toBe('creation');
    expect(initialized.玩家.技能系统.烹饪).toBeDefined();
  });

  test('unlocks only the selected profession tree with prerequisites and level gates', () => {
    let state = initializeProfessionSelection(createDefaultGameState(), config, 'warrior', []);
    expect(unlockProfessionAbility(state, config, 'slash', { tick: 1, enabledModules: ['profession'] }).status).toBe('blocked');
    state = unlockProfessionAbility(state, config, 'guard', { tick: 2, enabledModules: ['profession'] }).state;
    state = unlockProfessionAbility(state, config, 'slash', { tick: 3, enabledModules: ['profession'] }).state;
    expect(state.玩家.能力系统?.职业状态?.已解锁能力.slash.等级).toBe(1);
    expect(unlockProfessionAbility(state, config, 'last_stand', { tick: 4, enabledModules: ['profession'] }).status).toBe('blocked');
  });

  test('resolves task abilities by stable id or compatible display name', () => {
    let state = initializeProfessionSelection(createDefaultGameState(), config, 'warrior', []);
    state = unlockProfessionAbility(state, config, 'guard', { tick: 1, enabledModules: ['profession'] }).state;
    expect(resolveOwnedAbility(state, config, 'guard')?.id).toBe('guard');
    expect(resolveOwnedAbility(state, config, '守势')?.id).toBe('guard');
    expect(resolveOwnedAbility(state, config, '重斩')).toBeUndefined();
  });

  test('applies only selected innate talents and actually unlocked profession nodes', () => {
    let state = initializeProfessionSelection(createDefaultGameState(), config, 'warrior', ['brave']);
    expect(resolveProfessionBonuses(state, config).combat.armor).toBe(0);
    state = unlockProfessionAbility(state, config, 'guard', { tick: 1, enabledModules: ['profession'] }).state;
    const bonuses = resolveProfessionBonuses(state, config);
    expect(bonuses.combat.armor).toBe(2);
    expect(bonuses.checks.map(item => item.source)).toEqual(expect.arrayContaining(['无畏', '守势']));
    expect(bonuses.checks.some(item => item.source === '重斩')).toBe(false);
  });
});
