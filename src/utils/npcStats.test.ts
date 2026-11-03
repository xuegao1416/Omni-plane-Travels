import { describe, expect, test } from 'bun:test';
import type { StatModuleSchema } from '../modules/schema';
import { createDefaultGameState } from '../schema/variables';
import { ensureNpcModuleDefaults, materializeNpcSurvivalStats, materializeNpcTierIndex } from './npcStats';

const statConfig: StatModuleSchema = {
  attrA: { name: '气血', current: 80, max: 100 },
  attrB: { name: '真气', current: 40, max: 60 },
  dim1: { name: '力道', value: 12, range: [0, 20] },
  dim2: { name: '根骨', value: Number.NaN, range: [10, 30] },
  special: [{ id: '剑意', name: '剑意', value: 3, range: [0, 10], description: '' }],
};

describe('NPC module stat defaults', () => {
  test('fills configured missing stats without overwriting explicit zero or inventing absent dimensions', () => {
    expect(materializeNpcSurvivalStats({ dim1: 0, dim2: '' }, statConfig)).toEqual({
      血量: 80,
      体力值: 40,
      dim1: 0,
      dim2: 20,
      剑意: 3,
    });
  });

  test('keeps tier zero and falls back only for an invalid or missing tier', () => {
    expect(materializeNpcTierIndex(0, 3)).toBe(0);
    expect(materializeNpcTierIndex(undefined, 3)).toBe(3);
    expect(materializeNpcTierIndex(1.5, 3)).toBe(3);
  });

  test('repairs runtime NPC records once using the enabled module defaults', () => {
    const state = createDefaultGameState();
    state.人物档案.npc = {
      姓名: '阿青', 种族: '人类', 性别: '', 年龄: '', 生存状态: { 血量: 70, 体力值: 20 },
      社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: 0, 关系类型: '同伴' },
      个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' },
      重要NPC: false, _关注: false, $time: 0,
    };

    expect(ensureNpcModuleDefaults(state, statConfig, 0)).toBe(true);
    expect(state.人物档案.npc.生存状态).toMatchObject({ 血量: 70, 体力值: 20, dim1: 12, dim2: 20 });
    expect(state.人物档案.npc.成长状态?.当前段位索引).toBe(0);
    expect(ensureNpcModuleDefaults(state, statConfig, 0)).toBe(false);
  });
});
