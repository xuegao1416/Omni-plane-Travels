import { expect, test } from 'bun:test';
import { createEmptyDirectorState } from './types';
import { refreshSourceExhaustion } from './sourceAdapter';

function fixture(mode: 'all' | 'any') {
  const director = createEmptyDirectorState();
  for (const id of ['a', 'b', 'c']) director.plans[id] = { id, intent: id, participants: [], dependencies: [], status: 'ready', priority: 80, source: 'authored', visibility: 'foreground', createdAt: 1, updatedAt: 1, stageId: id === 'c' ? 's2' : 's1' };
  director.sourceBinding = { type: 'authored', sourceId: 'source', version: '1', boundAt: 1, stages: [
    { id: 's1', title: '调查', planIds: ['a', 'b'], completionPlanIds: ['a', 'b'], mode, status: 'pending' },
    { id: 's2', title: '终章', planIds: ['c'], completionPlanIds: ['c'], mode: 'all', status: 'pending' },
  ] };
  return director;
}

test('alternative route completion closes unused proposals without fabricating their occurrence', () => {
  const director = fixture('any');
  refreshSourceExhaustion(director);
  expect(director.sourceBinding?.currentStageId).toBe('s1');
  director.plans.a.status = 'occurred';
  expect(refreshSourceExhaustion(director)).toBe(false);
  expect(director.plans.b.status).toBe('superseded');
  expect(director.sourceBinding?.currentStageId).toBe('s2');
  director.plans.c.status = 'occurred';
  expect(refreshSourceExhaustion(director)).toBe(true);
});

test('all-route stage requires actual receipts, and rejection is failure rather than success', () => {
  const director = fixture('all');
  director.plans.a.status = 'directed';
  refreshSourceExhaustion(director);
  expect(director.sourceBinding?.currentStageId).toBe('s1');
  director.plans.a.status = 'occurred';
  director.plans.b.status = 'invalid';
  refreshSourceExhaustion(director);
  expect(director.sourceBinding?.stages?.[0].status).toBe('failed');
  expect(director.sourceBinding?.currentStageId).toBe('s2');
});
