import { describe, expect, test } from 'bun:test';
import { buildNpcFillPrompt, buildVariableExtractionPrompt } from './editor-prompts';

describe('NPC fill prompt', () => {
  test('asks for survival stats when the world enables the stat module', () => {
    const prompt = buildNpcFillPrompt({
      worldSetting: '武侠世界', playerName: '李默', playerGender: '男', playerAge: '20', playerBackground: '',
      npc: {
        name: '阿青', gender: '', age: '', race: '', relationshipType: '同伴', occupation: '', socialStatus: '',
        personality: '', hiddenPersonality: '', appearance: '', currentOutfit: '', currentThought: '',
        currentAction: '', currentLocation: '', currentState: '', shortTermGoal: '', longTermGoal: '', background: '',
      },
      statModule: {
        attrA: { name: '气血', max: 100 }, attrB: { name: '真气', max: 80 },
        dim1: { name: '力道', range: [0, 20] }, dim2: { name: '根骨', range: [0, 20] },
        dim3: { name: '身法', range: [0, 20] }, dim4: { name: '悟性', range: [0, 20] },
        dim5: { name: '定力', range: [0, 20] }, dim6: { name: '感知', range: [0, 20] },
      },
      hasProgression: true,
    });

    expect(prompt).toContain('"survivalStats"');
    expect(prompt).toContain('"血量"');
    expect(prompt).toContain('"dim1"');
    expect(prompt).toContain('"tierIndex"');
  });

  test('requires a complete survival state when runtime extraction creates an NPC', () => {
    const prompt = buildVariableExtractionPrompt({
      数值属性: {
        attrA: { name: '气血', current: 80, max: 100 },
        attrB: { name: '真气', current: 50, max: 80 },
        dim1: { name: '力道', value: 10, range: [0, 20] },
        dim2: { name: '根骨', value: 10, range: [0, 20] },
        dim3: { name: '身法', value: 10, range: [0, 20] },
        dim4: { name: '悟性', value: 10, range: [0, 20] },
        dim5: { name: '定力', value: 10, range: [0, 20] },
        dim6: { name: '感知', value: 10, range: [0, 20] },
        special: [],
      },
    });

    expect(prompt).toContain('人物档案.角色名.生存状态');
  });
});
