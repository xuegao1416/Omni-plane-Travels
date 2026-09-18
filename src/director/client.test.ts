import { expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { createEmptyDirectorState, type DirectorReadContext } from './types';
import { applyDirectorDecision, decisionSchema, type DirectorDecision } from './client';
import { alignDirectorPlans } from './align';

test('free-form conditions need real evidence and expire when authoritative facts change', () => {
  const director = createEmptyDirectorState();
  director.plans.meeting = { id: 'meeting', intent: '赴约', participants: [], dependencies: [{ kind: 'condition', ref: 'delivered', note: '信件确实送达' }], status: 'waiting', priority: 80, visibility: 'foreground', source: 'authored', createdAt: 1, updatedAt: 1 };
  const context: DirectorReadContext = { saveId: 's', worldId: 'w', completedTurnId: 't', stateVersion: 'v1', variableProjection: createDefaultGameState(), memories: [{ id: 'letter', text: '信件已经送达', provenance: 't0', layer: 'inference' }] };
  const decision: DirectorDecision = { conditions: [{ planId: 'meeting', ref: 'delivered', truth: 'true', evidence: [{ kind: 'memory', ref: 'letter', quote: '信件已经送达' }] }], plans: [], offscreen: [] };
  applyDirectorDecision(director, decision, context);
  alignDirectorPlans(director, context);
  expect(director.plans.meeting.status).toBe('waiting');
  context.memories[0].layer = 'fact';
  applyDirectorDecision(director, decision, context);
  alignDirectorPlans(director, context);
  expect(director.plans.meeting.status).toBe('ready');
  alignDirectorPlans(director, { ...context, stateVersion: 'v2' });
  expect(director.plans.meeting.status).toBe('waiting');
});

test('new actor plans cannot invent canonical people, overwrite sources or revive a rejected plan', () => {
  const director = createEmptyDirectorState();
  const context: DirectorReadContext = { saveId: 's', worldId: 'w', completedTurnId: 't', stateVersion: 'v', variableProjection: createDefaultGameState(), narrative: '雨势加大。', memories: [] };
  const decision: DirectorDecision = { conditions: [], offscreen: [], plans: [{ id: 'rain', intent: '雨水影响道路', participants: [], constraints: [], priority: 50, visibility: 'reader_only', evidence: [{ kind: 'narrative', quote: '雨势加大' }] }] };
  const before = JSON.stringify(context);
  applyDirectorDecision(director, decision, context);
  director.plans['actor:rain'].status = 'invalid';
  applyDirectorDecision(director, decision, context);
  expect(director.plans['actor:rain'].status).toBe('invalid');
  decision.plans[0] = { ...decision.plans[0], id: 'ghost', participants: ['invented'] };
  applyDirectorDecision(director, decision, context);
  expect(director.plans['actor:ghost']).toBeUndefined();
  expect(JSON.stringify(context)).toBe(before);
});


test('director priority remains a strict 0-70 protocol boundary', () => {
  const base = { conditions: [], offscreen: [], plans: [{ id: 'x', intent: 'x', participants: [], constraints: [], visibility: 'foreground', evidence: [{ kind: 'narrative', quote: 'x' }] }] };
  expect(decisionSchema.safeParse({ ...base, plans: [{ ...base.plans[0], priority: 70 }] }).success).toBe(true);
  expect(decisionSchema.safeParse({ ...base, plans: [{ ...base.plans[0], priority: 71 }] }).success).toBe(false);
  expect(decisionSchema.safeParse({ ...base, plans: [{ ...base.plans[0], priority: 69.5 }] }).success).toBe(false);
  expect(decisionSchema.safeParse({ ...base, plans: [{ ...base.plans[0], priority: '70' }] }).success).toBe(false);
});
