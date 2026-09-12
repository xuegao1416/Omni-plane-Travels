import { expect, test } from 'bun:test';
import { extractPlayerObservations } from './variableExtraction';
import { applyPlayerObservations, initializePlayerKnowledge, selectPlayerKnownNPCs } from './playerKnowledge';
import { createDefaultGameState, type NPCData } from '../schema/variables';

test('extraction metadata updates only evidenced observed fields after a committed narrative', () => {
  const original = createDefaultGameState();
  original.人物档案.witness = { 姓名: '证人', 个人信息: { 当前状态: '正常', 当前位置: '旧城' } } as NPCData;
  let state = initializePlayerKnowledge(original, { turnId: 'start', eventId: 'start', quote: '最初认识的证人' });
  state.人物档案.witness.个人信息!.当前位置 = '新城';
  const observations = extractPlayerObservations({ playerObservations: [
    { npcId: 'witness', path: '个人信息.当前状态', value: '手臂受伤', quote: '你看见证人手臂受伤', mode: 'observed' },
    { npcId: 'witness', path: '个人信息.当前想法', value: '伺机报复', quote: '你看见证人手臂受伤', mode: 'observed' },
    { npcId: 'witness', path: '个人信息.当前位置', value: '新城', quote: '证人说他到了新城', mode: 'disclosed' },
    { npcId: 'witness', path: '姓名', value: '替身', mode: 'invented' },
  ] });
  const receipt = { id: 'r', turnId: 't1', eventId: 'n1', turnNumber: 1, committed: true, text: '你看见证人手臂受伤。', observations };
  const result = applyPlayerObservations(state, receipt);
  expect(result.applied).toBe(1);
  expect(result.rejected).toHaveLength(2);
  const known = selectPlayerKnownNPCs(result.state).witness;
  expect(known.个人信息?.当前状态).toBe('手臂受伤');
  expect(known.个人信息?.当前位置).toBe('旧城');
  expect(known.个人信息?.当前想法).toBeUndefined();
  expect(applyPlayerObservations(state, { ...receipt, committed: false }).applied).toBe(0);
});
