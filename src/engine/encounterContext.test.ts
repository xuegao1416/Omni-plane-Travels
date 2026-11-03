import { expect, test } from 'bun:test';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import { initializePlayerKnowledge, selectPlayerKnownNPCs } from './playerKnowledge';
import { buildEncounterContext } from './encounterContext';

test('a planned reunion can describe changed outward facts without revealing secrets or changing known data', () => {
  let state = createDefaultGameState();
  state.人物档案.n = { 姓名: '甲', 人物分类: '离场', 个人信息: { 当前状态: '正常', 当前位置: '旧城', 里性格: '秘密动机' }, 内心想法: '暗杀密令', 短期目标: '背叛' } as NPCData;
  state = initializePlayerKnowledge(state, { turnId: 'initial', eventId: 'initial', quote: '旧资料' });
  state.人物档案.n.个人信息.当前状态 = '右臂包扎';
  expect(buildEncounterContext(state)).toBe('');
  const original = JSON.stringify(state);
  const context = buildEncounterContext(state, ['n']);
  expect(context).toContain('右臂包扎');
  for (const secret of ['秘密动机', '暗杀密令', '背叛']) expect(context).not.toContain(secret);
  expect(context).toContain('必须先满足自然的地点和接触条件');
  expect(JSON.stringify(state)).toBe(original);
  expect(selectPlayerKnownNPCs(state).n.个人信息?.当前状态).toBe('正常');
});
