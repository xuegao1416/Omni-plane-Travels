import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import {
  applyNarrativeDecision,
  createNarrativeDecisionRecord,
  getPendingNarrativeDecisions,
  getPendingNarrativeDecisionsForSave,
  getNarrativeDecisionPromptSnapshot,
  normalizeNarrativeDecisionAction,
  settleNarrativeResponse,
  narrativeDecisionFromChoice,
} from './narrativeDecision';

describe('narrative decision persistence', () => {
  test('applies a typed effect and persists it exactly once by decision id', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.血量 = 40;
    const record = createNarrativeDecisionRecord({
      id: 'decision-save-a-1',
      saveId: 'save-a',
      eventPackId: 'pack-a',
      cardId: 'card-a',
      blockId: 'choice-0',
      selectedIndex: 0,
      action: {
        type: 'apply_effects',
        effects: [{ type: 'delta', effect: { statId: '血量', delta: 5 } }],
      },
      createdAt: 100,
    });

    const first = applyNarrativeDecision(state, record);
    const second = applyNarrativeDecision(first.state, record);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.state.玩家.生存状态.血量).toBe(45);
    expect(getPendingNarrativeDecisions(second.state)).toHaveLength(1);
  });

  test('keeps the record after a failed正文 and consumes it after the next successful正文', () => {
    const state = createDefaultGameState();
    const record = createNarrativeDecisionRecord({
      id: 'decision-retry-1', saveId: 'save-a', eventPackId: 'pack-a', cardId: 'card-a', blockId: 'choice-0',
      selectedIndex: 0, action: { type: 'narrative', instruction: '承接玩家选择' }, createdAt: 100,
    });
    const pending = applyNarrativeDecision(state, record).state;

    const requestSnapshot = getNarrativeDecisionPromptSnapshot(pending, 'save-a');
    const lateRecord = createNarrativeDecisionRecord({
      id: 'decision-retry-late', saveId: 'save-a', eventPackId: 'pack-a', cardId: 'card-b', blockId: 'choice-0',
      selectedIndex: 1, action: { type: 'narrative', instruction: '下一次正文承接' }, createdAt: 101,
    });
    const pendingWithLateDecision = applyNarrativeDecision(pending, lateRecord).state;
    const afterFailure = settleNarrativeResponse(pendingWithLateDecision, {
      status: 'failure', narrativeId: 'failed-1', saveId: 'save-a', decisionIds: requestSnapshot.decisionIds,
    });
    const afterSuccess = settleNarrativeResponse(afterFailure, {
      status: 'success', narrativeId: 'narrative-1', content: '正文已生成', saveId: 'save-a', decisionIds: requestSnapshot.decisionIds,
    });

    expect(getPendingNarrativeDecisions(afterFailure)).toHaveLength(2);
    expect(getPendingNarrativeDecisions(afterSuccess)).toHaveLength(1);
    expect(afterSuccess.narrativeDecisions?.[0]?.consumedByNarrativeId).toBe('narrative-1');
    expect(afterSuccess.narrativeDecisions?.[1]?.status).toBe('pending');
  });

  test('filters pending records by save id so decisions never cross saves', () => {
    const first = createDefaultGameState();
    const second = createDefaultGameState();
    const record = (saveId: string) => createNarrativeDecisionRecord({
      id: `${saveId}-1`, saveId, eventPackId: 'pack', cardId: 'card', blockId: 'choice-0', selectedIndex: 0,
      action: { type: 'narrative', instruction: '只属于当前存档' }, createdAt: 100,
    });

    const firstWithDecision = applyNarrativeDecision(first, record('save-a')).state;
    const secondWithDecision = applyNarrativeDecision(second, record('save-b')).state;

    expect(getPendingNarrativeDecisionsForSave(firstWithDecision, 'save-a')).toHaveLength(1);
    expect(getPendingNarrativeDecisionsForSave(firstWithDecision, 'save-b')).toHaveLength(0);
    expect(getPendingNarrativeDecisionsForSave(secondWithDecision, 'save-a')).toHaveLength(0);
  });

  test('maps legacy string and object event-card choices to typed actions', () => {
    expect(narrativeDecisionFromChoice('继续前进', {
      id: 'legacy-1', saveId: 'save-a', eventPackId: 'pack', cardId: 'card', blockId: 'choice-0', selectedIndex: 0,
    }).action).toEqual({ type: 'narrative', instruction: '继续前进' });
    expect(narrativeDecisionFromChoice({ label: '战斗', effect: { statId: '血量', delta: -2 } }, {
      id: 'legacy-2', saveId: 'save-a', eventPackId: 'pack', cardId: 'card', blockId: 'choice-0', selectedIndex: 1,
    }).action).toEqual({ type: 'apply_effects', effects: [{ type: 'delta', effect: { statId: '血量', delta: -2 } }] });
    expect(narrativeDecisionFromChoice({ label: '发起战斗', action: { type: 'start_combat', proposalId: 'encounter-1' } }, {
      id: 'typed-3', saveId: 'save-a', eventPackId: 'pack', cardId: 'card', blockId: 'choice-0', selectedIndex: 2,
    }).action).toEqual({ type: 'start_combat', proposalId: 'encounter-1' });
  });

  test('rejects malformed typed actions instead of inferring behavior from a label', () => {
    expect(normalizeNarrativeDecisionAction({ type: 'start_combat', proposalId: '' })).toBeUndefined();
    expect(normalizeNarrativeDecisionAction({ type: 'narrative', instruction: '继续' })).toEqual({ type: 'narrative', instruction: '继续' });
  });
});
