import { expect, test } from 'bun:test';
import { createPipelineStatus } from '../engine/pipelineTypes';
import { canReviewCommittedTurn } from './commitBarrier';

test('failed or degraded writes block director progress; successful retry releases the barrier', () => {
  const status = createPipelineStatus(1);
  for (const stage of Object.values(status.stages)) stage.status = 'skipped';
  status.stages.main.status = 'success';
  expect(canReviewCommittedTurn(status)).toBe(true);
  status.stages.variable.status = 'error';
  expect(canReviewCommittedTurn(status)).toBe(false);
  status.stages.variable.status = 'success';
  status.stages.memory_write.status = 'warning';
  expect(canReviewCommittedTurn(status)).toBe(false);
  status.stages.memory_write.status = 'success';
  status.stages.memory_rerank.status = 'warning';
  expect(canReviewCommittedTurn(status)).toBe(true);
});
