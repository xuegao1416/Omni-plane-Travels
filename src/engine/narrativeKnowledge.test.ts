import { expect, test } from 'bun:test';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import { applyNarrativeKnowledge } from './narrativeKnowledge';
import { selectPlayerKnownNPCs, type PlayerObservationReceipt } from './playerKnowledge';

function fixture(category: string) {
  const state = createDefaultGameState();
  state.人物档案.n = { 姓名: '旅人', 人物分类: category, 关系数据: { 好感度: 15, 关系类型: '同行' } } as NPCData;
  state.playerKnowledge = { schemaVersion: 1, characters: {}, processedReceiptIds: [] };
  return state;
}
function receipt(): PlayerObservationReceipt {
  return { id: 'observation:n1', eventId: 'n1', turnId: 't1', turnNumber: 49, committed: true, text: '旅人跟你一起前进。',
    observations: [{ npcId: 'n', path: '关系数据.关系类型', value: '同行', quote: '旅人', mode: 'observed' }] };
}
test('unknown character observations cannot silently succeed while the relationship panel stays empty', () => {
  const state = fixture('离场');
  expect(() => applyNarrativeKnowledge(state, receipt())).toThrow('人物观察未能写入');
  expect(state.playerKnowledge?.processedReceiptIds).toEqual([]);
  expect(selectPlayerKnownNPCs(state)).toEqual({});
});
test('a present character can be introduced by the evidenced scene fallback', () => {
  const state = applyNarrativeKnowledge(fixture('在场'), receipt());
  expect(selectPlayerKnownNPCs(state).n?.关系数据).toEqual({ 好感度: 15, 关系类型: '同行' });
});
test('valid explicit introductions work without revealing unobserved offscreen truth', () => {
  const input = receipt();
  input.observations.unshift({ npcId: 'n', path: '姓名', value: '旅人', quote: '旅人', mode: 'observed', introduces: true });
  const state = applyNarrativeKnowledge(fixture('离场'), input);
  expect(selectPlayerKnownNPCs(state).n).toEqual({ 姓名: '旅人', 人物分类: '离场', 关系数据: { 关系类型: '同行' } });
});
