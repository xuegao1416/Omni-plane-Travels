import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { createEmptySimState } from '../simulation/types';
import { alignDirectorPlans, evaluateDependency, readDirectorPath } from './align';
import { compileDirectorDirective, ensureDirectorState } from './runtime';
import { commitDirectiveOutcome, evaluateDirectiveOutcome } from './outcome';
import type { ApiConfig } from '../api/types';
import type { DirectorReadContext, DirectorOutcomeReceipt } from './types';

function fixture() {
  const sim = createEmptySimState();
  const director = ensureDirectorState(sim);
  const variables = createDefaultGameState();
  variables.玩家.当前目标 = '信已送达';
  const context: DirectorReadContext = { saveId: 'save', worldId: 'world', completedTurnId: 't1', stateVersion: 'v1', variableProjection: variables, memories: [] };
  director.plans.meeting = { id: 'meeting', intent: '证人赴约', participants: [], dependencies: [{ kind: 'variable', ref: '玩家.当前目标', expected: '信已送达' }], status: 'waiting', priority: 50, visibility: 'foreground', source: 'authored', createdAt: 1, updatedAt: 1 };
  return { sim, director, context };
}

describe('director causal plans and actual outcomes', () => {
  test('failed outcome requests remain retryable instead of saving a false negative receipt', async () => {
    const { sim, director, context } = fixture();
    alignDirectorPlans(director, context);
    const directive = compileDirectorDirective(sim, 't1', 'v1')!;
    const input = { director, directive, narrative: '证人来到酒馆。', turnId: 't2', stateVersion: 'v2', config: { apiKey: 'key', baseUrl: 'https://example.test/v1', model: 'test-model', provider: 'custom' } as ApiConfig };
    await expect(evaluateDirectiveOutcome(input, async () => { throw new Error('API 429'); })).rejects.toThrow('API 429');
    expect(director.receipts).toHaveLength(0);
    expect(director.plans.meeting.status).toBe('directed');
    await evaluateDirectiveOutcome(input, async () => ({ text: JSON.stringify([{ planId: 'meeting', outcome: 'realized', evidence: '证人来到酒馆' }]), elapsed: 1 }));
    expect(director.plans.meeting.status).toBe('occurred');
    await evaluateDirectiveOutcome(input, async () => { throw new Error('must not repeat committed audit'); });
    expect(director.receipts).toHaveLength(1);
  });
  test('missing facts and prototype paths never unlock plans', () => {
    const { director, context } = fixture();
    expect(evaluateDependency({ kind: 'variable', ref: '世界.未定义' }, director, context)).toBe('unknown');
    expect(readDirectorPath({}, '__proto__.toString')).toBeUndefined();
    expect(readDirectorPath({}, 'constructor')).toBeUndefined();
  });
  test('intercepting a letter blocks an issued meeting without mutating gameplay', () => {
    const { sim, director, context } = fixture();
    alignDirectorPlans(director, context);
    compileDirectorDirective(sim, 't1', 'v1');
    expect(director.plans.meeting.status).toBe('directed');
    context.variableProjection.玩家.当前目标 = '信被截走';
    const before = JSON.stringify(context);
    alignDirectorPlans(director, context);
    expect(director.plans.meeting.status).toBe('blocked');
    expect(compileDirectorDirective(sim, 't2', 'v2')).toBeUndefined();
    expect(JSON.stringify(context)).toBe(before);
  });
  test('confidence and substring matches cannot turn inferences into evidence', () => {
    const { director, context } = fixture();
    context.memories = [{ id: 'guess', text: '信已送达', confidence: 1, provenance: 't0', layer: 'inference' }];
    expect(evaluateDependency({ kind: 'memory', ref: 'guess' }, director, context)).toBe('unknown');
    context.memories[0].layer = 'fact';
    expect(evaluateDependency({ kind: 'memory', ref: '信已送达' }, director, context)).toBe('unknown');
    expect(evaluateDependency({ kind: 'memory', ref: 'guess' }, director, context)).toBe('true');
  });
  test('unquoted realization does not complete a plan; grounded receipts commit once', () => {
    const { sim, director, context } = fixture();
    alignDirectorPlans(director, context);
    const directive = compileDirectorDirective(sim, 't1', 'v1')!;
    const committed = { turnId: 't2', stateVersion: 'v2' };
    const receipt: DirectorOutcomeReceipt = { id: 'r1', ...committed, directiveId: directive.id, outcomes: [{ planId: 'meeting', outcome: 'realized', evidence: '证人来到酒馆' }], createdAt: 2 };
    commitDirectiveOutcome(director, directive, receipt, '我仍独自等待。', committed);
    expect(director.plans.meeting.status).not.toBe('occurred');
    const realized = { ...receipt, id: 'r2' };
    expect(commitDirectiveOutcome(director, directive, realized, '证人来到酒馆。', committed)).toBe(true);
    expect(director.plans.meeting.status).toBe('occurred');
    expect(commitDirectiveOutcome(director, directive, realized, '证人来到酒馆。', committed)).toBe(false);
    expect(director.receipts).toHaveLength(2);
  });
  test('rejection invalidates downstream plans and stale receipts are ignored', () => {
    const { sim, director, context } = fixture();
    director.plans.reveal = { ...director.plans.meeting, id: 'reveal', dependencies: [{ kind: 'plan', ref: 'meeting' }] };
    alignDirectorPlans(director, context);
    const directive = compileDirectorDirective(sim, 't1', 'v1')!;
    const receipt: DirectorOutcomeReceipt = { id: 'r', turnId: 't2', stateVersion: 'v2', directiveId: directive.id, outcomes: [{ planId: 'meeting', outcome: 'player_rejected', evidence: '我拒绝会面' }], createdAt: 2 };
    expect(commitDirectiveOutcome(director, directive, receipt, '我拒绝会面。', { turnId: 'other', stateVersion: 'v2' })).toBe(false);
    expect(commitDirectiveOutcome(director, directive, receipt, '我拒绝会面。', { turnId: 't2', stateVersion: 'v2' })).toBe(true);
    alignDirectorPlans(director, context);
    expect(director.plans.meeting.status).toBe('invalid');
    expect(director.plans.reveal.status).toBe('invalid');
  });
});
