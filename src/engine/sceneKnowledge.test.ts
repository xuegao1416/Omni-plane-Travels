import { expect, test } from 'bun:test';
import { VariableManager } from './variableManager';
import { admitAuthoredNPCs, applyPlayerObservations, collectSceneObservations, initializePlayerKnowledge, selectPlayerKnownNPCs } from './playerKnowledge';
import { createDefaultGameState, type NPCData } from '../schema/variables';

function seeded() {
  const state = createDefaultGameState();
  state.人物档案.old = { 姓名: '老人', 人物分类: '在场', 关系数据: { 好感度: 10, 关系类型: '熟人' } } as NPCData;
  return initializePlayerKnowledge(state, { turnId: 'base', eventId: 'base', quote: '开局既有人物' });
}

test('好感度用 observed 模式也会被接受（关系面板不再永久冻结）', () => {
  const result = applyPlayerObservations(seeded(), {
    id: 'r2', turnId: 't2', eventId: 'e2', turnNumber: 2, committed: true, text: '老人对你露出了赞许的目光。',
    observations: [
      { npcId: 'old', path: '关系数据.好感度', value: 20, quote: '赞许的目光', mode: 'observed' },
      { npcId: 'old', path: '关系数据.关系类型', value: '挚友', quote: '赞许的目光', mode: 'observed' },
    ],
  });
  expect(result.rejected).toHaveLength(0);
  expect(selectPlayerKnownNPCs(result.state).old?.关系数据).toEqual({ 好感度: 20, 关系类型: '挚友' });
});

test('正文里出现的新角色会被投影进面板，秘密字段仍留在幕后', () => {
  const state = seeded();
  const vm = new VariableManager(state);
  const text = '你遇见了一位自称神秘老人的家伙。';
  const applied = vm.applyAiUpdateVariable(JSON.stringify({
    id: 't1', source: 'ai', label: '变量裁定', effects: [
      { set: { path: '人物档案.神秘老人', value: {
        姓名: '神秘老人', 种族: '人类', 性别: '男', 年龄: 80, 人物分类: '在场',
        社会身份: { 职业: '智者' }, 关系数据: { 好感度: 3, 关系类型: '初次见面' },
        个人信息: { 外貌: '白发', 表性格: '温和', 里性格: '多疑', 当前想法: '他在试探我', 当前状态: '注视着你' },
        当前行动: '向你走来', 人物事迹: ['初次相遇'],
      } } },
    ],
  }));
  expect(applied).toBe(true);

  const observations = collectSceneObservations(vm.getState(), text);
  const result = applyPlayerObservations(vm.getState(), {
    id: 'scene:t1', turnId: 't1', eventId: 'e1', turnNumber: 1, committed: true, text, observations,
  });
  expect(result.rejected).toHaveLength(0);
  const known = selectPlayerKnownNPCs(result.state)['神秘老人'];
  expect(known?.姓名).toBe('神秘老人');
  expect(known?.关系数据).toEqual({ 好感度: 3, 关系类型: '初次见面' });
  expect(known?.个人信息?.当前状态).toBe('注视着你');
  // 秘密字段不得随投影泄露
  expect(known?.个人信息?.里性格).toBeUndefined();
  expect(known?.个人信息?.当前想法).toBeUndefined();
  // 社会身份/年龄等属于"被介绍才知道"，仍要等正文披露（职业栏为空是设计，不是 bug）
  expect(known?.社会身份).toBeUndefined();
  // 正文没提到的离场角色不会被动刷新
  expect(collectSceneObservations(vm.getState(), '与那位旅人无关的一段旁白。').some(o => o.npcId === 'old')).toBe(false);
  // 姓名在正文里没出现的新建角色不会被凭空放进面板
  const phantom = vm.applyAiUpdateVariable(JSON.stringify({
    id: 't2', source: 'ai', label: '变量裁定', effects: [
      { set: { path: '人物档案.裁缝', value: { 姓名: '裁缝', 种族: '人类', 人物分类: '在场', 社会身份: { 职业: '裁缝' } } } },
    ],
  }));
  expect(phantom).toBe(true);
  expect(collectSceneObservations(vm.getState(), text).some(o => o.npcId === '裁缝')).toBe(false);
});

test('开局自建角色（setInitialNPCs 路径）会登记为玩家已知', () => {
  const vm = new VariableManager(seeded());
  const current = vm.getState();
  current.人物档案['NPC_同伴'] = {
    姓名: '同伴', 种族: '人类', 性别: '女', 年龄: 20, 人物分类: '在场',
    关系数据: { 好感度: 0, 关系类型: '同伴' }, 个人信息: { 当前状态: '正常' }, 重要NPC: true,
  } as NPCData;
  const admitted = admitAuthoredNPCs(current, ['NPC_同伴'], { turnId: 'character-creation', eventId: 'character-creation', quote: '玩家在开局创建的角色' });
  vm.setState(admitted);
  const known = selectPlayerKnownNPCs(vm.getState());
  expect(Object.keys(known).sort()).toEqual(['NPC_同伴', 'old'].sort());
  expect(known['NPC_同伴']?.关系数据?.关系类型).toBe('同伴');
});
