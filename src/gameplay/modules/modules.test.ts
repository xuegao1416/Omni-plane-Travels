import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../../schema/variables';
import { createDiceRoll } from './dice';

describe('six built-in gameplay modules', () => {
  // 天赋四项（解锁事务、技能消耗与冷却、前置与互斥、熟练度/觉醒/装备/重置）已迁移到 src/domains/abilities/abilities.test.ts。
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

  // 属性三项（属性点分配、范围钳制、加成/派生/到期）已迁移到 src/domains/stats/stats.test.ts。
  // 成长三项（行动经验与发点、职业点、突破关卡）已迁移到 src/domains/progression/progression.test.ts。
  // 骰子历史记录已迁移到 src/domains/dice/dice.test.ts。
  // 生存四项（制作原子性、解锁与耗时、采集、周期只结算一次）已迁移到 src/domains/resources/resources.test.ts。

  // 经营三项（结算、生产链、购置/升级/人手）已迁移到 src/domains/economy/economy.test.ts。
});
