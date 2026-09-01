import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import { createVariableExtractionSnapshot } from './variableExtraction';

function npc(name: string, category: NPCData['人物分类']): NPCData {
  return {
    姓名: name, 种族: '人类', 性别: '', 年龄: '', 生存状态: { 血量: 100, 体力值: 100 },
    社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: 0, 关系类型: '陌生人' },
    个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' },
    重要NPC: false, _关注: false, $time: 0, 人物分类: category, 人物事迹: ['旧事'],
  };
}

describe('variable extraction snapshot', () => {
  test('keeps present and mentioned NPCs while omitting unrelated off-scene records', () => {
    const state = createDefaultGameState();
    state.人物档案 = {
      present: npc('阿青', '在场'),
      focus: npc('师父', '重点'),
      mentioned: npc('老周', '离场'),
      unrelated: npc('赵掌柜', '离场'),
    };
    (state.人物档案.present as any).portraitBlobKey = 'portrait-present';
    state.人物档案.present.背景 = '很长的静态背景';
    state.人物档案.present.技能列表 = { 巨型技能表: { 描述: '变量提取不需要的静态定义' } };

    const snapshot = createVariableExtractionSnapshot(state, '老周托人送来一封信。');

    expect(Object.keys(snapshot.人物档案)).toEqual(['present', 'focus', 'mentioned']);
    expect((snapshot.人物档案.present as any).portraitBlobKey).toBeUndefined();
    expect(snapshot.人物档案.present.背景).toBeUndefined();
    expect(snapshot.人物档案.present.技能列表).toBeUndefined();
  });
});
