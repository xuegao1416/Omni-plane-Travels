import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import { initializePlayerKnowledge, applyPlayerObservations, selectPlayerKnownNPCs, type PlayerObservationReceipt } from './playerKnowledge';

function fixture() {
  const state = createDefaultGameState();
  state.人物档案.witness = { 姓名: '证人', 生存状态: { 血量: 100, 体力值: 100 }, 个人信息: { 当前状态: '健康', 当前想法: '保守秘密' }, 关系数据: { 好感度: 20, 关系类型: '相识' } } as NPCData;
  return initializePlayerKnowledge(state, { turnId: 'opening', eventId: 'legacy-import', quote: '旧档人物资料' });
}
function receipt(): PlayerObservationReceipt {
  return { id: 'meeting', turnId: 'turn-2', eventId: 'event-2', turnNumber: 2, committed: true, text: '证人左臂包扎着绷带。', observations: [{ npcId: 'witness', path: '个人信息.当前状态', value: '左臂受伤', quote: '证人左臂包扎着绷带', mode: 'observed' }] };
}
describe('player knowledge boundary', () => {
  test('offscreen injury and changed affection do not refresh or reorder known records', () => {
    const state = fixture();
    state.人物档案.friend = { ...structuredClone(state.人物档案.witness), 姓名: '朋友' };
    const observed = applyPlayerObservations(state, { ...receipt(), id: 'friend-introduction', text: '朋友来到门前。', observations: [{ npcId: 'friend', path: '姓名', value: '朋友', mode: 'observed', quote: '朋友来到门前', introduces: true }] }).state;
    observed.人物档案.witness.生存状态.血量 = 30;
    observed.人物档案.witness.关系数据.好感度 = -80;
    observed.人物档案.friend.关系数据.好感度 = 100;
    observed.人物档案.stranger = { ...structuredClone(state.人物档案.witness), 姓名: '陌生人' };
    const known = selectPlayerKnownNPCs(observed);
    expect(Object.keys(known)).toEqual(['witness', 'friend']);
    expect(known.witness?.生存状态?.血量).toBe(100);
    expect(known.witness?.关系数据?.好感度).toBe(20);
  });
  test('meeting updates only observed field, never hidden thoughts or exact health', () => {
    const state = fixture();
    state.人物档案.witness.个人信息.当前想法 = '秘密加入教团';
    const request = receipt();
    request.observations.push({ npcId: 'witness', path: '个人信息.当前想法', value: '秘密加入教团', quote: '证人左臂包扎着绷带', mode: 'observed' });
    const result = applyPlayerObservations(state, request);
    expect(result.rejected).toHaveLength(1);
    expect(selectPlayerKnownNPCs(result.state).witness?.个人信息).toEqual({ 当前状态: '左臂受伤', 当前想法: '保守秘密' });
    expect(selectPlayerKnownNPCs(result.state).witness?.生存状态?.血量).toBe(100);
    expect(result.state.人物档案.witness.个人信息.当前想法).toBe('秘密加入教团');
  });
  test('uncommitted, fabricated quotes, unknown paths and undiscovered characters are rejected', () => {
    const state = fixture();
    expect(applyPlayerObservations(state, { ...receipt(), committed: false }).applied).toBe(0);
    const request = receipt();
    request.observations = [
      { ...request.observations[0]!, quote: '没有这个原文' },
      { ...request.observations[0]!, npcId: 'unknown' },
      { ...request.observations[0]!, path: '__proto__.polluted' },
    ];
    expect(applyPlayerObservations(state, request).rejected).toHaveLength(3);
  });
  test('a confirmed introduction adds only disclosed fields', () => {
    const state = fixture();
    state.人物档案.stranger = { ...structuredClone(state.人物档案.witness), 姓名: '阿青' };
    const result = applyPlayerObservations(state, { ...receipt(), text: '她自称阿青。', observations: [{ npcId: 'stranger', path: '姓名', value: '阿青', quote: '她自称阿青', mode: 'disclosed', introduces: true }] });
    expect(selectPlayerKnownNPCs(result.state).stranger).toEqual({ 姓名: '阿青' });
  });
  test('projection, reader inspection and rollback clones cannot mutate observation history', () => {
    const state = fixture();
    const checkpoint = structuredClone(state);
    const projection = selectPlayerKnownNPCs(state);
    projection.witness!.个人信息!.当前想法 = 'bad';
    const result = applyPlayerObservations(state, receipt());
    expect(state).toEqual(checkpoint);
    expect(selectPlayerKnownNPCs(checkpoint).witness?.个人信息?.当前状态).toBe('健康');
    expect(selectPlayerKnownNPCs(result.state).witness?.个人信息?.当前状态).toBe('左臂受伤');
    expect(applyPlayerObservations(result.state, receipt()).state).toBe(result.state);
  });
  test('initialization is explicit and once only, and stale receipts cannot replace newer knowledge', () => {
    expect(selectPlayerKnownNPCs(createDefaultGameState())).toEqual({});
    const state = applyPlayerObservations(fixture(), receipt()).state;
    const stale = { ...receipt(), id: 'stale', turnNumber: 1 };
    stale.observations[0]!.value = '健康';
    expect(applyPlayerObservations(state, stale).applied).toBe(0);
    expect(initializePlayerKnowledge(state, { turnId: 'reload', eventId: 'reload', quote: 'reload' })).toBe(state);
  });
  test('explicitly disclosed secrets retain field-specific provenance', () => {
    const request = receipt();
    request.text = '证人坦白：我加入了教团。';
    request.observations = [{ npcId: 'witness', path: '个人信息.当前想法', value: '效忠教团', quote: '证人坦白：我加入了教团', mode: 'disclosed' }];
    const result = applyPlayerObservations(fixture(), request);
    expect(result.applied).toBe(1);
    expect(result.state.playerKnowledge?.characters.witness?.fields['个人信息.当前想法']?.source).toEqual({ turnId: request.turnId, eventId: request.eventId, quote: request.observations[0]!.quote });
  });
  test('previous Chinese observation schema migrates once without merging fresh truth', () => {
    const state = createDefaultGameState();
    state.人物档案.n = { 姓名: '幕后姓名', 个人信息: { 当前位置: '新城', 当前想法: '秘密' } } as NPCData;
    (state as any).人物已知资料 = { version: 1, characters: { n: { observed: { 姓名: '旧名', 个人信息: { 当前位置: '旧城' } }, fields: { '个人信息.当前位置': { value: '旧城', turnId: 'turn-old' } } } } };
    const migrated = initializePlayerKnowledge(state, { turnId: 'load', eventId: 'migration', quote: '旧存档' });
    expect((migrated as any).人物已知资料).toBeUndefined();
    expect(selectPlayerKnownNPCs(migrated).n).toEqual({ 姓名: '旧名', 个人信息: { 当前位置: '旧城' } });
    expect(migrated.playerKnowledge?.characters.n?.fields['个人信息.当前位置']?.source.turnId).toBe('turn-old');
  });
});
